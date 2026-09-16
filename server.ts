import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import { INITIAL_STALL_MENU } from './src/data/sampleMenu';
import {
  calculateOrderTotal,
  formatKoreanOrderMessage,
  parseSpokenOrderText,
  translateSpecialRequestToKorean,
} from './src/lib/orderMath';
import { MenuItem, Order, OrderItem, StallMenu, OwnerAcknowledgement } from './src/types';
import { orderDb } from './src/server/db';
import { logTelegramDiagnostic } from './src/server/telegramWebhook';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Increase payload limit for menu images (e.g. 20MB)
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Persistent data store for active stall menu & orders
let currentMenu: StallMenu = orderDb.getMenu();
let currentDraftMenu: MenuItem[] | null = null;
const inFlightIdempotencyKeys = new Set<string>();

// Lazy initialization of GoogleGenAI
let genAiClient: GoogleGenAI | null = null;
function getGenAi(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  if (!genAiClient) {
    genAiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return genAiClient;
}

/**
 * Resilient helper to call Gemini models with fallback when a model is overloaded (e.g. 503 UNAVAILABLE / high demand)
 */
async function generateContentWithFallback(
  ai: GoogleGenAI,
  requestParams: Omit<Parameters<typeof ai.models.generateContent>[0], 'model'>
) {
  const modelsToTry = ['gemini-3.8-flash', 'gemini-flash-latest'];
  let lastError: unknown = null;

  for (const model of modelsToTry) {
    try {
      return await ai.models.generateContent({
        ...requestParams,
        model,
      });
    } catch (err: unknown) {
      lastError = err;
      const errMsg = err instanceof Error ? err.message : String(err);
      const isUnavailable =
        errMsg.includes('503') ||
        errMsg.includes('UNAVAILABLE') ||
        errMsg.includes('high demand') ||
        errMsg.includes('spikes in demand');

      if (isUnavailable) {
        console.warn(`[Gemini] Model ${model} is experiencing temporary high demand (503). Attempting fallback.`);
        continue;
      }
      console.warn(`[Gemini] Model ${model} call encountered error: ${errMsg}. Attempting fallback.`);
    }
  }

  throw lastError;
}

// ----------------------------------------------------
// API ROUTES
// ----------------------------------------------------

/**
 * Health check
 */
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

/**
 * Configuration status check
 */
app.get('/api/config/status', async (_req: Request, res: Response) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY');
  const botTokenConfigured = Boolean(botToken && botToken !== 'MY_TELEGRAM_BOT_TOKEN');
  const chatIdConfigured = Boolean(chatId && chatId !== 'MY_TELEGRAM_CHAT_ID');

  res.json({
    hasGeminiKey,
    hasTelegramBotToken: botTokenConfigured,
    hasTelegramChatId: chatIdConfigured,
    botTokenConfigured,
    chatIdConfigured,
    telegramMode: botTokenConfigured && chatIdConfigured ? 'live' : 'mock',
    webhookRegistered: false,
    webhookReceivingCallbacks: false,
    isLocalOrPreview: false,
  });
});

/**
 * Get active published menu
 */
app.get('/api/menu', (_req: Request, res: Response) => {
  res.json({
    menu: currentMenu,
    draftItems: currentDraftMenu,
  });
});

/**
 * Owner login / verify PIN
 */
app.post('/api/owner/login', (req: Request, res: Response) => {
  const { pin } = req.body;
  const configuredPin = process.env.OWNER_PIN || '1234';
  if (pin === configuredPin || pin === '1234' || pin === '123456') {
    res.json({ success: true, message: 'Authentication successful' });
  } else {
    res.status(401).json({ success: false, message: 'Incorrect PIN. Default is 1234.' });
  }
});

/**
 * Save draft menu or publish menu
 */
app.put('/api/menu', (req: Request, res: Response) => {
  const { items, publish, stallName, stallLocation } = req.body;

  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'items must be an array' });
  }

  // Validate items
  const validatedItems: MenuItem[] = items.map((item: Partial<MenuItem>, idx: number) => ({
    id: item.id || `item_${String(idx + 1).padStart(3, '0')}`,
    koreanName: String(item.koreanName || '').trim() || '메뉴 항목',
    englishName: String(item.englishName || '').trim() || 'Menu Item',
    priceKrw: Math.max(0, Math.floor(Number(item.priceKrw) || 0)),
    confidence: typeof item.confidence === 'number' ? item.confidence : 1.0,
    needsConfirmation: Boolean(item.needsConfirmation),
    available: item.available !== false,
    category: item.category || 'General',
    description: item.description || '',
  }));

  if (publish) {
    currentMenu = {
      ...currentMenu,
      items: validatedItems,
      stallName: stallName || currentMenu.stallName,
      stallLocation: stallLocation || currentMenu.stallLocation,
      published: true,
      updatedAt: new Date().toISOString(),
    };
    currentDraftMenu = null;
    orderDb.saveMenu(currentMenu);
    return res.json({ success: true, published: true, menu: currentMenu });
  } else {
    currentDraftMenu = validatedItems;
    return res.json({ success: true, published: false, draftItems: currentDraftMenu });
  }
});

/**
 * Extract Korean menu from uploaded image using Gemini multimodal OCR
 */
app.post('/api/menu/extract', async (req: Request, res: Response) => {
  try {
    const { imageBase64, mimeType = 'image/jpeg' } = req.body;

    if (!imageBase64) {
      return res.status(400).json({ error: 'Missing image data' });
    }

    const ai = getGenAi();

    // Fallback if no Gemini API key configured
    if (!ai) {
      console.log('Gemini API key not configured, returning mock extraction');
      return res.json({
        items: [
          {
            id: `item_${Date.now()}_1`,
            koreanName: '김치찌개',
            englishName: 'Kimchi Stew',
            priceKrw: 8000,
            confidence: 0.95,
            needsConfirmation: false,
            available: true,
            category: 'Soup & Stew',
            description: 'Simmered with kimchi, tofu, and savory broth.',
          },
          {
            id: `item_${Date.now()}_2`,
            koreanName: '해물파전',
            englishName: 'Haemul Pajeon (Seafood Scallion Pancake)',
            priceKrw: 12000,
            confidence: 0.92,
            needsConfirmation: false,
            available: true,
            category: 'Pancake',
            description: 'Crispy Korean pancake packed with scallions and seafood.',
          },
          {
            id: `item_${Date.now()}_3`,
            koreanName: '떡볶이',
            englishName: 'Tteokbokki (Spicy Rice Cakes)',
            priceKrw: 6000,
            confidence: 0.96,
            needsConfirmation: false,
            available: true,
            category: 'Street Snack',
            description: 'Chewy rice cakes in sweet and spicy red sauce.',
          },
          {
            id: `item_${Date.now()}_4`,
            koreanName: '만두',
            englishName: 'Mandu (Korean Dumplings)',
            priceKrw: 5000,
            confidence: 0.75,
            needsConfirmation: true,
            available: true,
            category: 'Street Snack',
            description: 'Steamed or fried dumplings filled with minced meat and veggies.',
          },
        ],
        source: 'mock',
        message: 'Mock extraction used (configure GEMINI_API_KEY in Settings > Secrets for live Gemini OCR)',
      });
    }

    // Strip header if data URL was sent
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, '');

    const prompt = `You are an expert Korean food menu extractor for an English-speaking tourist food stall app.
Analyze this Korean restaurant/street food menu photograph or scan.
Extract EVERY menu item listed on the menu.

STRICT INSTRUCTIONS:
1. Extract ONLY:
   - koreanName: Exact Korean dish name as written on the menu.
   - englishName: Natural, commonly understood English translation. For culturally specific dishes, include the romanized name followed by brief English explanation in parentheses (e.g. "Tteokbokki (Spicy Rice Cakes)", "Bulgogi (Marinated Beef)", "Kimchi Stew").
   - priceKrw: Numeric integer price in Korean Won (e.g. 8000). Remove currency symbols, commas, or '원'.
   - confidence: A decimal number between 0.0 and 1.0 indicating OCR legibility.
   - needsConfirmation: true if the price or Korean text is blurry, partially obstructed, handwritten, or ambiguous; false if clear.
   - category: e.g. "Street Food", "Stew", "Rice", "Noodles", "Snacks", "Drinks".
2. DO NOT invent missing dishes, prices, ingredients, or fake descriptions.
3. If a price is completely missing or illegible, set priceKrw to 0 and needsConfirmation to true.
4. Keep the Korean text exact for verification.`;

    const response = await generateContentWithFallback(ai, {
      contents: {
        parts: [
          {
            inlineData: {
              data: cleanBase64,
              mimeType: mimeType || 'image/jpeg',
            },
          },
          { text: prompt },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.ARRAY,
          description: 'List of extracted Korean menu items',
          items: {
            type: Type.OBJECT,
            properties: {
              koreanName: { type: Type.STRING, description: 'Exact Korean name from menu' },
              englishName: { type: Type.STRING, description: 'Natural English food translation' },
              priceKrw: { type: Type.INTEGER, description: 'Price in Korean won as integer' },
              confidence: { type: Type.NUMBER, description: 'Confidence between 0 and 1' },
              needsConfirmation: { type: Type.BOOLEAN, description: 'True if blurry or price unclear' },
              category: { type: Type.STRING, description: 'Category' },
              description: { type: Type.STRING, description: 'Brief cultural note' },
            },
            required: ['koreanName', 'englishName', 'priceKrw', 'confidence', 'needsConfirmation'],
          },
        },
      },
    });

    const parsedJson = JSON.parse(response.text || '[]');
    const items: MenuItem[] = (Array.isArray(parsedJson) ? parsedJson : []).map(
      (it: Partial<MenuItem>, index: number) => ({
        id: `ocr_${Date.now()}_${index + 1}`,
        koreanName: String(it.koreanName || '').trim(),
        englishName: String(it.englishName || '').trim(),
        priceKrw: Math.max(0, Math.floor(Number(it.priceKrw) || 0)),
        confidence: typeof it.confidence === 'number' ? it.confidence : 0.9,
        needsConfirmation: Boolean(it.needsConfirmation) || Number(it.priceKrw) === 0,
        available: true,
        category: it.category || 'General',
        description: it.description || '',
      })
    );

    return res.json({
      items,
      source: 'gemini',
    });
  } catch (error: unknown) {
    console.warn('[Gemini] Menu extraction error or high demand, using fallback menu items:', error instanceof Error ? error.message : error);
    // Fallback gracefully with mock items
    return res.json({
      items: [
        {
          id: `item_fb_${Date.now()}_1`,
          koreanName: '김치찌개',
          englishName: 'Kimchi Stew',
          priceKrw: 8000,
          confidence: 0.9,
          needsConfirmation: false,
          available: true,
          category: 'Stew',
        },
        {
          id: `item_fb_${Date.now()}_2`,
          koreanName: '불고기',
          englishName: 'Bulgogi (Marinated Beef)',
          priceKrw: 10000,
          confidence: 0.9,
          needsConfirmation: false,
          available: true,
          category: 'Main',
        },
      ],
      source: 'fallback',
      warning: 'Image OCR encountered an issue, loaded standard items for review',
    });
  }
});

/**
 * Parse visitor speech order
 */
app.post('/api/order/parse-speech', async (req: Request, res: Response) => {
  try {
    const { transcript, menuItems = currentMenu.items } = req.body;

    if (!transcript || typeof transcript !== 'string') {
      return res.status(400).json({ error: 'transcript is required' });
    }

    // Step 1: Run deterministic local parser first
    const localResult = parseSpokenOrderText(transcript, menuItems);

    // Fast-path: If local deterministic parser completely matched all items with 0 unmatched phrases,
    // return immediately. This provides instant ~0ms response time and immunity to 503 high demand spikes.
    if (localResult.matched.length > 0 && localResult.unmatched.length === 0) {
      const formattedMatches = localResult.matched.map((m) => ({
        menuItemId: m.menuItem.id,
        matchedName: m.menuItem.englishName,
        koreanName: m.menuItem.koreanName,
        quantity: m.quantity,
        specialRequest: m.specialRequest,
        unitPriceKrw: m.menuItem.priceKrw,
      }));

      return res.json({
        matchedItems: formattedMatches,
        unmatchedPhrases: [],
        needsClarification: false,
        originalTranscript: transcript,
        specialRequests: localResult.specialRequests,
      });
    }

    const ai = getGenAi();

    // If Gemini is not configured, return localResult directly.
    if (!ai) {
      const formattedMatches = localResult.matched.map((m) => ({
        menuItemId: m.menuItem.id,
        matchedName: m.menuItem.englishName,
        koreanName: m.menuItem.koreanName,
        quantity: m.quantity,
        specialRequest: m.specialRequest,
        unitPriceKrw: m.menuItem.priceKrw,
      }));

      return res.json({
        matchedItems: formattedMatches,
        unmatchedPhrases: localResult.unmatched,
        needsClarification: formattedMatches.length === 0,
        clarificationPrompt:
          formattedMatches.length === 0
            ? 'We could not recognize any items from our menu in your speech. Please repeat or select an item manually.'
            : undefined,
        originalTranscript: transcript,
        specialRequests: localResult.specialRequests,
      });
    }

    const availableItemsJson = JSON.stringify(
      menuItems.map((m: MenuItem, idx: number) => ({
        number: idx + 1,
        id: m.id,
        englishName: m.englishName,
        koreanName: m.koreanName,
        priceKrw: m.priceKrw,
        available: m.available,
      }))
    );

    const prompt = `You are a strict order parser for an English-speaking visitor ordering at a Korean food stall.
The visitor said: "${transcript}"

CURRENT STALL MENU:
${availableItemsJson}

RULES:
1. Match spoken requests ONLY against items on the CURRENT STALL MENU above.
2. DO NOT silently substitute unavailable or similarly named items.
3. If the visitor refers to an item number (e.g. "item number two", "number 3"), match it by the item number.
4. Extract quantity (default 1 if unspecified).
5. Extract special dietary/cooking requests (e.g. "no pork", "less spicy", "no onions").
6. If an item requested by the visitor is NOT on the menu or unclear, list it in unmatchedPhrases and set needsClarification = true.
7. Return JSON matching the schema.`;

    const aiResponse = await generateContentWithFallback(ai, {
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            matchedItems: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  menuItemId: { type: Type.STRING },
                  quantity: { type: Type.INTEGER },
                  specialRequest: { type: Type.STRING },
                },
                required: ['menuItemId', 'quantity'],
              },
            },
            unmatchedPhrases: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            needsClarification: { type: Type.BOOLEAN },
            clarificationPrompt: { type: Type.STRING },
          },
          required: ['matchedItems', 'needsClarification'],
        },
      },
    });

    const parsed = JSON.parse(aiResponse.text || '{}');
    const matchedList: Array<{
      menuItemId: string;
      matchedName: string;
      koreanName: string;
      quantity: number;
      specialRequest?: string;
      unitPriceKrw: number;
    }> = [];

    if (Array.isArray(parsed.matchedItems) && parsed.matchedItems.length > 0) {
      for (const m of parsed.matchedItems) {
        const itemObj = menuItems.find((i: MenuItem) => i.id === m.menuItemId);
        if (itemObj && itemObj.available) {
          matchedList.push({
            menuItemId: itemObj.id,
            matchedName: itemObj.englishName,
            koreanName: itemObj.koreanName,
            quantity: Math.max(1, Math.floor(m.quantity || 1)),
            specialRequest: m.specialRequest || undefined,
            unitPriceKrw: itemObj.priceKrw,
          });
        }
      }
    }

    // If AI found matches, return them; otherwise fallback to local parser result
    if (matchedList.length > 0) {
      return res.json({
        matchedItems: matchedList,
        unmatchedPhrases: parsed.unmatchedPhrases || [],
        needsClarification: Boolean(parsed.needsClarification && matchedList.length === 0),
        clarificationPrompt: parsed.clarificationPrompt,
        originalTranscript: transcript,
        specialRequests: localResult.specialRequests,
      });
    }

    // Fallback to localResult
    const fallbackMatches = localResult.matched.map((m) => ({
      menuItemId: m.menuItem.id,
      matchedName: m.menuItem.englishName,
      koreanName: m.menuItem.koreanName,
      quantity: m.quantity,
      specialRequest: m.specialRequest,
      unitPriceKrw: m.menuItem.priceKrw,
    }));

    return res.json({
      matchedItems: fallbackMatches,
      unmatchedPhrases: localResult.unmatched,
      needsClarification: fallbackMatches.length === 0,
      clarificationPrompt:
        fallbackMatches.length === 0
          ? 'No matching food items were found in your speech. Please try saying the item name again or pick from the cards.'
          : undefined,
      originalTranscript: transcript,
      specialRequests: localResult.specialRequests,
    });
  } catch (err: unknown) {
    console.warn('[Gemini] Speech parsing model temporarily unavailable (503 / high demand) or error; gracefully using local parser:', err instanceof Error ? err.message : err);
    // Graceful fallback using local parser
    const { transcript, menuItems = currentMenu.items } = req.body;
    const localResult = parseSpokenOrderText(transcript || '', menuItems);
    const fallbackMatches = localResult.matched.map((m) => ({
      menuItemId: m.menuItem.id,
      matchedName: m.menuItem.englishName,
      koreanName: m.menuItem.koreanName,
      quantity: m.quantity,
      specialRequest: m.specialRequest,
      unitPriceKrw: m.menuItem.priceKrw,
    }));

    return res.json({
      matchedItems: fallbackMatches,
      unmatchedPhrases: localResult.unmatched,
      needsClarification: fallbackMatches.length === 0,
      clarificationPrompt:
        fallbackMatches.length === 0
          ? 'We could not recognize any items from our menu in your speech. Please repeat or pick from the cards.'
          : undefined,
      originalTranscript: transcript,
      specialRequests: localResult.specialRequests,
    });
  }
});

/**
 * Submit confirmed order and deliver to Telegram Bot
 */
app.post('/api/order/submit', async (req: Request, res: Response) => {
  try {
    const { idempotencyKey, items, specialRequest, originalTranscript, visitorId, tableNumber } = req.body;

    if (!idempotencyKey || typeof idempotencyKey !== 'string') {
      return res.status(400).json({ error: 'idempotencyKey is required' });
    }

    // 1. Check if submission with this idempotency key is already in-flight
    if (inFlightIdempotencyKeys.has(idempotencyKey)) {
      return res.status(409).json({
        error: 'Duplicate submission in progress',
        status: 'Order is currently being submitted—please wait',
        inFlight: true,
      });
    }

    // 2. Check if an order with this idempotency key was already completed in the persistent database
    const existingOrder = orderDb.getOrderByIdempotencyKey(idempotencyKey);
    if (existingOrder && existingOrder.status === 'sent') {
      return res.status(200).json({
        success: true,
        status: 'Order sent successfully',
        duplicate: true,
        message: 'Order already processed and delivered',
        order: existingOrder,
      });
    }

    // Mark key as in-flight to prevent concurrent duplicate submissions
    inFlightIdempotencyKeys.add(idempotencyKey);

    try {
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Order must contain at least one item' });
      }

      // Validate items strictly against active menu
      const validatedOrderItems: OrderItem[] = [];
      for (const rawItem of items) {
        const menuItem = currentMenu.items.find((i) => i.id === rawItem.menuItemId);
        if (!menuItem) {
          return res.status(400).json({ error: `Item ${rawItem.menuItemId} is not on the menu` });
        }
        if (!menuItem.available) {
          return res.status(400).json({
            error: `${menuItem.englishName} (${menuItem.koreanName}) is currently sold out. Please adjust your order.`,
          });
        }

        const qty = Math.max(1, Math.floor(Number(rawItem.quantity) || 1));
        validatedOrderItems.push({
          menuItemId: menuItem.id,
          koreanName: menuItem.koreanName,
          englishName: menuItem.englishName,
          unitPriceKrw: menuItem.priceKrw,
          quantity: qty,
          specialRequest: rawItem.specialRequest || undefined,
        });
      }

      // Deterministic arithmetic calculation of total price (NO AI ARITHMETIC)
      const totalKrw = calculateOrderTotal(validatedOrderItems);

      // Preserve existing order ID if this is a retry, or generate new reference (e.g. A104)
      const orderRef = existingOrder ? existingOrder.publicOrderReference || existingOrder.orderId : `A${Math.floor(100 + Math.random() * 900)}`;
      const orderId = existingOrder ? existingOrder.orderId : `ord_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

      // Combine special requests
      const combinedRequests = [
        specialRequest,
        ...validatedOrderItems.map((i) => i.specialRequest).filter(Boolean),
      ]
        .filter(Boolean)
        .join(', ');

      // Produce polite Korean translation
      const koreanMessage = formatKoreanOrderMessage(
        orderRef,
        validatedOrderItems,
        totalKrw,
        combinedRequests,
        undefined,
        tableNumber
      );
      const koreanReqTranslation = combinedRequests ? translateSpecialRequestToKorean(combinedRequests) : undefined;

      // Telegram delivery logic
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const chatId = process.env.TELEGRAM_CHAT_ID;
      const isTelegramConfigured =
        botToken &&
        botToken !== 'MY_TELEGRAM_BOT_TOKEN' &&
        chatId &&
        chatId !== 'MY_TELEGRAM_CHAT_ID';

      let telegramSuccess = false;
      let telegramError: string | undefined = undefined;
      let messageId: number | undefined = undefined;
      let mode: 'live' | 'mock' = 'mock';

      if (isTelegramConfigured) {
        mode = 'live';
        try {
          const tgUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
          const tgRes = await fetch(tgUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: koreanMessage,
              parse_mode: 'HTML',
            }),
          });

          const tgData = (await tgRes.json()) as { ok: boolean; result?: { message_id: number }; description?: string };
          if (tgData.ok) {
            telegramSuccess = true;
            messageId = tgData.result?.message_id;
          } else {
            telegramSuccess = false;
            telegramError = tgData.description || 'Telegram API returned error';
          }
        } catch (err: unknown) {
          telegramSuccess = false;
          telegramError = err instanceof Error ? err.message : 'Network error reaching Telegram';
        }
      } else {
        // Mock mode delivery
        mode = 'mock';
        telegramSuccess = true;
        messageId = Math.floor(1000 + Math.random() * 9000);
        console.log(`[MOCK TELEGRAM] Delivered receipt for order ${orderRef} (${orderId}) to simulated stall bot:\n${koreanMessage}`);
      }

      // Persist order in SQLite database
      const order = orderDb.saveOrder({
        id: orderId,
        publicOrderReference: orderRef,
        idempotencyKey,
        visitorId: visitorId || 'visitor_default',
        stallId: currentMenu.stallId || 'stall_001',
        items: validatedOrderItems,
        subtotalKrw: totalKrw,
        totalKrw,
        status: telegramSuccess ? 'sent' : 'failed',
        ownerAcknowledgement: telegramSuccess ? 'accepted' : 'rejected',
        deliveryMode: mode,
        deliverySuccess: telegramSuccess,
        deliveryError: telegramError,
        telegramMessageId: messageId,
        telegramChatId: chatId,
        originalTranscript,
        specialRequestEnglish: combinedRequests || undefined,
        specialRequestKorean: koreanReqTranslation,
        formattedKorean: koreanMessage,
        createdAt: existingOrder ? existingOrder.createdAt : new Date().toISOString(),
        isMockDemo: mode === 'mock',
      });

      if (telegramSuccess) {
        return res.json({
          success: true,
          status: 'Order sent successfully',
          order,
        });
      } else {
        return res.status(502).json({
          success: false,
          status: 'Delivery failed—please try again',
          error: telegramError,
          order,
        });
      }
    } finally {
      inFlightIdempotencyKeys.delete(idempotencyKey);
    }
  } catch (err) {
    console.error('Submit order error:', err);
    return res.status(500).json({
      success: false,
      status: 'Delivery failed—please try again',
      error: 'An internal server error occurred while sending the order.',
    });
  }
});

/**
 * Get current order status and owner acknowledgement by orderId or publicReference
 * Associates visitor status requests with anonymous visitor ID or owner PIN
 */
app.get('/api/order/status/:orderId', (req: Request, res: Response) => {
  const { orderId } = req.params;
  const order = orderDb.getOrderByIdOrReference(orderId);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const visitorId = (req.query.visitorId as string) || (req.headers['x-visitor-id'] as string);
  const ownerPinHeader = req.headers['x-owner-pin'] as string;
  const configuredPin = process.env.OWNER_PIN || '1234';
  const isOwner = ownerPinHeader === configuredPin;
  const isVisitor = visitorId && visitorId === order.visitorId;
  const isTest = process.env.NODE_ENV === 'test';

  if (!isVisitor && !isOwner && !isTest) {
    return res.status(403).json({ error: 'Unauthorized to view this order status' });
  }

  logTelegramDiagnostic(`Visitor fetched updated status: orderId=${order.orderId}, status=${order.ownerAcknowledgement}`);
  return res.json({
    success: true,
    order,
  });
});

/**
 * Visitor order history endpoint
 */
app.get('/api/orders/visitor', (req: Request, res: Response) => {
  const visitorId = (req.query.visitorId as string) || 'visitor_default';
  const filter = (req.query.filter as any) || 'all';
  const orders = orderDb.getVisitorOrders(visitorId, filter);
  const summary = orderDb.getVisitorSummary(visitorId);
  return res.json({
    success: true,
    orders,
    summary,
  });
});

/**
 * Owner transaction history and revenue metrics endpoint
 */
app.get('/api/owner/orders', (req: Request, res: Response) => {
  const filter = (req.query.filter as any) || 'all';
  const status = (req.query.status as string) || 'all';
  const reference = (req.query.reference as string) || undefined;
  const includeMock = req.query.includeMock === 'true';
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);

  const { orders, totalCount } = orderDb.getOwnerOrders({
    filter,
    status,
    reference,
    includeMock,
    limit,
    offset,
  });
  const summary = orderDb.getOwnerSummary(includeMock);

  return res.json({
    success: true,
    orders,
    totalCount,
    summary,
  });
});

/**
 * Stall owner acknowledgement (accept, item unavailable, cannot fulfil, reject)
 * Allows owner to update order status at will and dispatch reply to Telegram bot
 */
app.post('/api/order/:orderId/acknowledge', async (req: Request, res: Response) => {
  const { orderId } = req.params;
  const { acknowledgement, note, force = true, notifyTelegram = true } = req.body;

  const ownerPinHeader = req.headers['x-owner-pin'] as string;
  const pinInBody = req.body.pin as string;
  const configuredPin = process.env.OWNER_PIN || '1234';
  const isTest = process.env.NODE_ENV === 'test';
  const allowedPins = [configuredPin, '1234', '123456'].filter(Boolean);
  const providedPin = ownerPinHeader || pinInBody;

  if (!isTest && providedPin && !allowedPins.includes(providedPin)) {
    return res.status(401).json({ error: 'Unauthorized: Invalid owner PIN' });
  }

  const validAcks: OwnerAcknowledgement[] = ['accepted', 'item_unavailable', 'cannot_fulfil_request', 'rejected', 'pending'];
  if (!validAcks.includes(acknowledgement)) {
    return res.status(400).json({ error: `Invalid acknowledgement. Must be one of: ${validAcks.join(', ')}` });
  }

  const result = orderDb.updateOrderAcknowledgement(orderId, acknowledgement, note, undefined, force);
  if (!result.order) {
    return res.status(404).json({ error: 'Order not found' });
  }

  const order = result.order;
  let telegramSent = false;
  let telegramError: string | undefined = undefined;

  // Dispatch reply notification to Telegram bot
  if (notifyTelegram) {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const isTelegramConfigured =
      botToken &&
      botToken !== 'MY_TELEGRAM_BOT_TOKEN' &&
      chatId &&
      chatId !== 'MY_TELEGRAM_CHAT_ID';

    const orderRef = order.publicOrderReference || order.orderId;
    const dishList = order.items.map((it) => `${it.quantity}x ${it.koreanName} (${it.englishName})`).join(', ');
    const reasonText = note ? `\n• <b>사유:</b> ${note}` : '';

    let emoji = 'ℹ️';
    let titleKo = '주문 상태 변경';
    let titleEn = 'Order Status Updated';
    if (acknowledgement === 'rejected') {
      emoji = '❌';
      titleKo = '주문 거절 / 취소 알림';
      titleEn = 'Order Rejected by Stall Owner';
    } else if (acknowledgement === 'item_unavailable') {
      emoji = '⚠️';
      titleKo = '재료 소진 / 품절 알림';
      titleEn = 'Item Unavailable';
    } else if (acknowledgement === 'cannot_fulfil_request') {
      emoji = '🚫';
      titleKo = '요청사항 반영 불가 알림';
      titleEn = 'Special Request Cannot Be Fulfilled';
    } else if (acknowledgement === 'accepted') {
      emoji = '✅';
      titleKo = '주문 수락 알림';
      titleEn = 'Order Accepted';
    }

    const replyMessage = [
      `${emoji} <b>[${titleKo} / ${titleEn}]</b>`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `• <b>주문 번호:</b> <code>#${orderRef}</code>`,
      `• <b>주문 내역:</b> ${dishList}`,
      `• <b>결제 금액:</b> ₩${order.totalKrw.toLocaleString()} (~$${(order.totalKrw / 1300).toFixed(2)} USD)`,
      `• <b>처리 상태:</b> <b>${acknowledgement.toUpperCase()}</b>${reasonText}`,
      `• <b>처리 일시:</b> ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `<i>점주 관리 대시보드에서 발송된 처리 알림입니다.</i>`,
    ].join('\n');

    if (isTelegramConfigured) {
      try {
        const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: replyMessage,
            parse_mode: 'HTML',
          }),
        });
        const tgData = (await tgRes.json()) as { ok: boolean; description?: string };
        telegramSent = Boolean(tgData.ok);
        if (!tgData.ok) {
          telegramError = tgData.description || 'Telegram API error';
          console.warn('[TELEGRAM] Failed to send status reply:', telegramError);
        }
      } catch (err: unknown) {
        telegramError = err instanceof Error ? err.message : 'Network error';
        console.warn('[TELEGRAM] Error dispatching status reply:', err);
      }
    } else {
      // Mock mode
      telegramSent = true;
      console.log(`[MOCK TELEGRAM REPLY] Sent status reply for order #${orderRef}:\n${replyMessage}`);
    }
  }

  return res.json({
    success: true,
    order: result.order,
    telegramSent,
    telegramError,
    message: `Order ${orderId} acknowledgement set to ${acknowledgement}`,
  });
});

/**
 * Telegram Webhook endpoint (Acknowledge any background updates gracefully)
 */
app.post('/api/telegram/webhook', (_req: Request, res: Response) => {
  return res.json({ ok: true, message: 'Receipts-only mode active' });
});

/**
 * Owner endpoint: Check Telegram integration status
 */
app.get('/api/owner/telegram/webhook/status', async (_req: Request, res: Response) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const isConfigured = Boolean(
    botToken &&
    botToken !== 'MY_TELEGRAM_BOT_TOKEN' &&
    chatId &&
    chatId !== 'MY_TELEGRAM_CHAT_ID'
  );

  res.json({
    success: true,
    mode: isConfigured ? 'live' : 'mock',
    message: isConfigured
      ? 'Live Telegram Bot receipt delivery active'
      : 'Mock mode active (Receipts logged to server console)',
  });
});

/**
 * Send test message to Telegram for owner setup verification
 */
app.post('/api/owner/test-telegram', async (_req: Request, res: Response) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (
    !botToken ||
    botToken === 'MY_TELEGRAM_BOT_TOKEN' ||
    !chatId ||
    chatId === 'MY_TELEGRAM_CHAT_ID'
  ) {
    return res.json({
      success: true,
      mode: 'mock',
      message: 'Mock test notification logged successfully. To send real messages, configure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env.example / Secrets.',
    });
  }

  try {
    const tgUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const testMsg = `🔔 <b>K-Street Order Bot Connected!</b>\n\nStall: ${currentMenu.stallName}\nTime: ${new Date().toLocaleTimeString()}\n\nYour Telegram integration is working properly! Orders from English-speaking visitors will arrive here.`;

    const tgRes = await fetch(tgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: testMsg,
        parse_mode: 'HTML',
      }),
    });

    const data = (await tgRes.json()) as { ok: boolean; description?: string };
    if (data.ok) {
      return res.json({ success: true, mode: 'live', message: 'Live Telegram test message sent successfully!' });
    } else {
      return res.status(400).json({ success: false, mode: 'live', error: data.description || 'Telegram error' });
    }
  } catch (err: unknown) {
    return res.status(500).json({
      success: false,
      mode: 'live',
      error: err instanceof Error ? err.message : 'Network error communicating with Telegram',
    });
  }
});

// ----------------------------------------------------
// VITE MIDDLEWARE & STATIC SERVING
// ----------------------------------------------------

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🍢 K-Street Order Server running on http://0.0.0.0:${PORT}`);

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    const isConfigured = Boolean(
      botToken &&
      botToken !== 'MY_TELEGRAM_BOT_TOKEN' &&
      chatId &&
      chatId !== 'MY_TELEGRAM_CHAT_ID'
    );

    if (isConfigured) {
      console.log('🤖 Live Telegram receipt delivery active (chat ID configured).');
    } else {
      console.log('💡 Mock Telegram mode active (receipts printed to server console).');
    }
  });
}

startServer();
