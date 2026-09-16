import crypto from 'crypto';

export interface TelegramWebhookDiagnosticInfo {
  url: string;
  isRegistered: boolean;
  pendingUpdateCount: number;
  lastErrorDate: string | null;
  lastErrorMessage: string | null;
  maxConnections: number;
  allowedUpdates: string[];
  hasCustomCertificate: boolean;
  isReceivingCallbacks: boolean;
  isLocalOrPreview: boolean;
  warning?: string;
}

/**
 * Cleanly constructs the public HTTPS Telegram webhook URL
 * Handles leading/trailing slashes gracefully
 */
export function buildWebhookUrl(baseUrl?: string): string {
  const rawUrl = baseUrl || process.env.APP_URL || '';
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return `${trimmed}/api/telegram/webhook`;
}

/**
 * Checks whether the current APP_URL is a publicly accessible HTTPS deployment
 * that Telegram servers can reach without cookie authentication.
 */
export function evaluateAppUrlReachability(appUrl?: string): {
  isHttps: boolean;
  isPublic: boolean;
  isLocalOrPreview: boolean;
  warning?: string;
} {
  const url = (appUrl || process.env.APP_URL || '').trim();

  if (!url) {
    return {
      isHttps: false,
      isPublic: false,
      isLocalOrPreview: true,
      warning: 'Telegram buttons require a publicly accessible HTTPS deployment. The current webhook URL cannot receive Telegram callbacks.',
    };
  }

  const isHttps = url.startsWith('https://');
  const isLocal =
    url.includes('localhost') ||
    url.includes('127.0.0.1') ||
    url.includes('0.0.0.0') ||
    url.startsWith('http://');

  // Preview environments (such as ais-dev-* behind Google Cloud Run authentication proxies)
  // return HTTP 302 redirects with Google login cookies for unauthenticated external POST requests.
  const isPreview =
    url.includes('ais-dev-') ||
    url.includes('corp.google.com') ||
    url.includes('preview');

  const isLocalOrPreview = !isHttps || isLocal || isPreview;

  return {
    isHttps,
    isPublic: isHttps && !isLocal,
    isLocalOrPreview,
    warning: isLocalOrPreview
      ? 'Telegram buttons require a publicly accessible HTTPS deployment. The current webhook URL cannot receive Telegram callbacks.'
      : undefined,
  };
}

/**
 * Gets or initializes the webhook secret token.
 * Valid Telegram secret tokens are 1-256 chars containing [A-Za-z0-9_-].
 */
let memoryFallbackSecret = '';
export function getTelegramWebhookSecret(): string {
  const envSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (envSecret && envSecret !== 'MY_TELEGRAM_WEBHOOK_SECRET') {
    return envSecret.trim();
  }
  return '';
}

/**
 * Timing-safe string comparison to prevent timing side-channel attacks
 */
export function timingSafeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Log safe diagnostics without exposing secrets, bot tokens, or private bodies
 */
export function logTelegramDiagnostic(event: string, details?: Record<string, any>) {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[TELEGRAM DIAGNOSTIC] ${event}${detailsStr}`);
}

/**
 * Fetches current webhook details from Telegram Bot API via getWebhookInfo
 */
export async function fetchTelegramWebhookInfo(
  botToken?: string
): Promise<TelegramWebhookDiagnosticInfo> {
  const token = botToken || process.env.TELEGRAM_BOT_TOKEN;
  const urlCheck = evaluateAppUrlReachability();

  if (!token || token === 'MY_TELEGRAM_BOT_TOKEN') {
    return {
      url: '',
      isRegistered: false,
      pendingUpdateCount: 0,
      lastErrorDate: null,
      lastErrorMessage: null,
      maxConnections: 40,
      allowedUpdates: [],
      hasCustomCertificate: false,
      isReceivingCallbacks: false,
      isLocalOrPreview: urlCheck.isLocalOrPreview,
      warning: 'Bot token not configured. Running in Mock Telegram Mode.',
    };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    const data = (await res.json()) as any;

    if (!data.ok || !data.result) {
      return {
        url: '',
        isRegistered: false,
        pendingUpdateCount: 0,
        lastErrorDate: null,
        lastErrorMessage: data.description || 'Failed to query Telegram getWebhookInfo',
        maxConnections: 40,
        allowedUpdates: [],
        hasCustomCertificate: false,
        isReceivingCallbacks: false,
        isLocalOrPreview: urlCheck.isLocalOrPreview,
        warning: data.description,
      };
    }

    const r = data.result;
    const isRegistered = Boolean(r.url && r.url.length > 0);
    const lastErrorDate = r.last_error_date ? new Date(r.last_error_date * 1000).toISOString() : null;
    const lastErrorMessage = r.last_error_message || null;

    // Callbacks are considered receiving if registered, no recent delivery errors, and not local/preview
    const isReceivingCallbacks = isRegistered && !lastErrorMessage && !urlCheck.isLocalOrPreview;

    return {
      url: r.url || '',
      isRegistered,
      pendingUpdateCount: Number(r.pending_update_count || 0),
      lastErrorDate,
      lastErrorMessage,
      maxConnections: Number(r.max_connections || 40),
      allowedUpdates: r.allowed_updates || [],
      hasCustomCertificate: Boolean(r.has_custom_certificate),
      isReceivingCallbacks,
      isLocalOrPreview: urlCheck.isLocalOrPreview,
      warning: urlCheck.warning || (lastErrorMessage ? `Telegram Webhook Error: ${lastErrorMessage}` : undefined),
    };
  } catch (err: unknown) {
    const errText = err instanceof Error ? err.message : String(err);
    return {
      url: '',
      isRegistered: false,
      pendingUpdateCount: 0,
      lastErrorDate: null,
      lastErrorMessage: errText,
      maxConnections: 40,
      allowedUpdates: [],
      hasCustomCertificate: false,
      isReceivingCallbacks: false,
      isLocalOrPreview: urlCheck.isLocalOrPreview,
      warning: `Network error querying Telegram: ${errText}`,
    };
  }
}

/**
 * Idempotently registers the webhook with Telegram Bot API via setWebhook
 */
export async function registerTelegramWebhook(options?: {
  botToken?: string;
  webhookUrl?: string;
  secretToken?: string;
  dropPendingUpdates?: boolean;
}): Promise<{ ok: boolean; url: string; description?: string; result?: any }> {
  const token = options?.botToken || process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'MY_TELEGRAM_BOT_TOKEN') {
    return {
      ok: false,
      url: '',
      description: 'TELEGRAM_BOT_TOKEN is not configured.',
    };
  }

  const targetUrl = options?.webhookUrl || buildWebhookUrl();
  if (!targetUrl) {
    return {
      ok: false,
      url: '',
      description: 'APP_URL is not configured.',
    };
  }

  if (!targetUrl.startsWith('https://')) {
    return {
      ok: false,
      url: targetUrl,
      description: 'Telegram requires a public HTTPS webhook URL.',
    };
  }

  const secretToken = options?.secretToken || getTelegramWebhookSecret();

  try {
    logTelegramDiagnostic('Calling setWebhook', {
      url: targetUrl,
      hasSecretToken: Boolean(secretToken),
      allowedUpdates: ['callback_query', 'message'],
    });

    const payload: Record<string, any> = {
      url: targetUrl,
      allowed_updates: ['callback_query', 'message'],
    };

    if (secretToken) {
      payload.secret_token = secretToken;
    }

    if (options?.dropPendingUpdates) {
      payload.drop_pending_updates = true;
    }

    const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as any;
    logTelegramDiagnostic('setWebhook result', { ok: Boolean(data.ok), description: data.description });

    return {
      ok: Boolean(data.ok),
      url: targetUrl,
      description: data.description || (data.ok ? 'Webhook registered successfully' : 'Failed to register webhook'),
      result: data.result,
    };
  } catch (err: unknown) {
    const errText = err instanceof Error ? err.message : String(err);
    logTelegramDiagnostic('setWebhook failed with network error', { error: errText });
    return {
      ok: false,
      url: targetUrl,
      description: `Network error registering webhook: ${errText}`,
    };
  }
}

/**
 * Removes the webhook from Telegram Bot API via deleteWebhook
 */
export async function deleteTelegramWebhook(options?: {
  botToken?: string;
  dropPendingUpdates?: boolean;
}): Promise<{ ok: boolean; description?: string }> {
  const token = options?.botToken || process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'MY_TELEGRAM_BOT_TOKEN') {
    return { ok: true, description: 'No bot token configured to delete' };
  }

  try {
    logTelegramDiagnostic('Calling deleteWebhook');
    const res = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        drop_pending_updates: Boolean(options?.dropPendingUpdates),
      }),
    });

    const data = (await res.json()) as any;
    return {
      ok: Boolean(data.ok),
      description: data.description || (data.ok ? 'Webhook removed' : 'Failed to delete webhook'),
    };
  } catch (err: unknown) {
    const errText = err instanceof Error ? err.message : String(err);
    return { ok: false, description: `Network error: ${errText}` };
  }
}

/**
 * Answers a Telegram callback query so the loading spinner stops spinning
 */
export async function answerTelegramCallbackQuery(
  botToken: string | undefined,
  callbackQueryId: string,
  text?: string,
  showAlert = false
): Promise<boolean> {
  const token = botToken || process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'MY_TELEGRAM_BOT_TOKEN' || !callbackQueryId) {
    // In mock mode or missing token, acknowledge locally
    logTelegramDiagnostic('answerCallbackQuery skipped (mock mode or no token)', { callbackQueryId });
    return true;
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text ? text.substring(0, 200) : undefined,
        show_alert: showAlert,
      }),
    });

    const data = (await res.json()) as any;
    if (data.ok) {
      logTelegramDiagnostic('answerCallbackQuery succeeded', { callbackQueryId });
      return true;
    } else {
      console.error(`[TELEGRAM DIAGNOSTIC] answerCallbackQuery failed: ${data.description || 'unknown error'}`);
      return false;
    }
  } catch (err: unknown) {
    const errText = err instanceof Error ? err.message : String(err);
    console.error(`[TELEGRAM DIAGNOSTIC] answerCallbackQuery network error: ${errText}`);
    return false;
  }
}

/**
 * Updates the original Telegram message with the final bilingual status and removes buttons
 */
export async function editTelegramMessageFinalStatus(options: {
  botToken?: string;
  chatId: string | number;
  messageId: number;
  originalText: string;
  action: 'accepted' | 'rejected' | 'item_unavailable' | 'cannot_fulfil_request';
}): Promise<boolean> {
  const token = options.botToken || process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'MY_TELEGRAM_BOT_TOKEN' || !options.chatId || !options.messageId) {
    logTelegramDiagnostic('editTelegramMessage skipped (mock mode)', { action: options.action });
    return true;
  }

  const finalStatusBlocks: Record<string, string> = {
    accepted: '✅ <b>최종 상태: 주문 수락</b>\n<i>Final status: Order accepted</i>',
    rejected: '❌ <b>최종 상태: 주문 거절</b>\n<i>Final status: Order rejected</i>',
    item_unavailable: '⚠️ <b>최종 상태: 재료 소진</b>\n<i>Final status: Item unavailable</i>',
    cannot_fulfil_request: '🚫 <b>최종 상태: 주문 처리 불가</b>\n<i>Final status: Cannot fulfil order</i>',
  };

  const statusAppend = finalStatusBlocks[options.action] || `최종 상태: ${options.action}`;
  const updatedText = `${options.originalText}\n\n────────────────────\n${statusAppend}`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: options.chatId,
        message_id: options.messageId,
        text: updatedText,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [], // Permanently removes all 4 buttons
        },
      }),
    });

    const data = (await res.json()) as any;
    if (data.ok) {
      logTelegramDiagnostic('Telegram message updated', {
        messageId: options.messageId,
        action: options.action,
      });
      return true;
    } else {
      // If editMessageText fails (e.g. text identical or formatting error), try removing markup at least
      logTelegramDiagnostic('editMessageText failed, attempting editMessageReplyMarkup', {
        error: data.description,
      });
      await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: options.chatId,
          message_id: options.messageId,
          reply_markup: { inline_keyboard: [] },
        }),
      });
      return false;
    }
  } catch (err: unknown) {
    const errText = err instanceof Error ? err.message : String(err);
    console.error(`[TELEGRAM DIAGNOSTIC] editMessageText network error: ${errText}`);
    return false;
  }
}
