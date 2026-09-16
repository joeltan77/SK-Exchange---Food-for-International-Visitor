import { MenuItem, OrderItem } from '../types';

/**
 * Deterministically calculates the total price in Korean Won.
 * strictly uses integer arithmetic to avoid floating-point errors.
 */
export function calculateOrderTotal(items: OrderItem[] = []): number {
  if (!items || !Array.isArray(items)) {
    return 0;
  }
  return items.reduce((sum, item) => {
    if (!item) return sum;
    const qty = Math.max(0, Math.floor(item.quantity || 0));
    const price = Math.max(0, Math.floor(item.unitPriceKrw || 0));
    return sum + qty * price;
  }, 0);
}

/**
 * Formats a KRW amount into standard currency string: "₩8,000"
 */
export function formatKrw(amount: number): string {
  const integerAmount = Math.max(0, Math.floor(amount));
  return `₩${integerAmount.toLocaleString('en-US')}`;
}

/**
 * Formats price in both required formats: "₩8,000" and "8,000 won"
 */
export function formatDualPrice(amount: number): { krw: string; won: string; combined: string } {
  const formatted = Math.max(0, Math.floor(amount)).toLocaleString('en-US');
  return {
    krw: `₩${formatted}`,
    won: `${formatted} won`,
    combined: `₩${formatted} (${formatted} won)`,
  };
}

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const TEENS = [
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function convertUnderThousand(num: number): string {
  let str = '';
  if (num >= 100) {
    const hundreds = Math.floor(num / 100);
    str += `${ONES[hundreds]} hundred`;
    num %= 100;
    if (num > 0) str += ' and ';
  }
  if (num >= 20) {
    const ten = Math.floor(num / 10);
    str += TENS[ten];
    const one = num % 10;
    if (one > 0) str += `-${ONES[one]}`;
  } else if (num >= 10) {
    str += TEENS[num - 10];
  } else if (num > 0) {
    str += ONES[num];
  }
  return str;
}

/**
 * Converts a number into natural English words for speech synthesis.
 * e.g. 8000 -> "eight thousand won"
 * 28000 -> "twenty-eight thousand won"
 * 10500 -> "ten thousand five hundred won"
 */
export function formatNaturalSpokenWon(amount: number): string {
  const num = Math.max(0, Math.floor(amount));
  if (num === 0) return 'zero won';

  const millions = Math.floor(num / 1000000);
  const thousands = Math.floor((num % 1000000) / 1000);
  const remainder = num % 1000;

  const parts: string[] = [];

  if (millions > 0) {
    parts.push(`${convertUnderThousand(millions)} million`);
  }
  if (thousands > 0) {
    parts.push(`${convertUnderThousand(thousands)} thousand`);
  }
  if (remainder > 0) {
    parts.push(convertUnderThousand(remainder));
  }

  return `${parts.join(' ')} won`;
}

/**
 * Deterministic speech/text parser for matching tourist spoken English
 * orders against the active menu list.
 */
const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
};

export interface MatchCandidate {
  menuItem: MenuItem;
  quantity: number;
  specialRequest?: string;
}

export function parseSpokenOrderText(
  transcript: string,
  availableMenu: MenuItem[]
): {
  matched: MatchCandidate[];
  unmatched: string[];
  specialRequests: string[];
  specialRequest?: string;
} {
  const rawLower = transcript.toLowerCase().trim();
  if (!rawLower) {
    return { matched: [], unmatched: [], specialRequests: [], specialRequest: undefined };
  }
  const normalized = normalizeAlternateSpokenDishName(rawLower);

  // Extract special requests like "no pork", "no spicy", "less spicy", "extra napkin", etc.
  const specialRequests: string[] = [];
  const requestRegex = /\b(no\s+[a-z]+|without\s+[a-z]+|less\s+[a-z]+|extra\s+[a-z]+|not\s+too\s+spicy|allergy\s+to\s+[a-z]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = requestRegex.exec(normalized)) !== null) {
    specialRequests.push(match[0].trim());
  }

  const matched: MatchCandidate[] = [];
  const matchedIds = new Set<string>();

  // 1. Check item number references: e.g. "item number 1", "item 2", "number 3", "two of item 1"
  const itemNumRegex = /(?:(\d+|one|two|three|four|five|six|seven|eight|nine)\s+(?:orders?\s+of\s+|portions?\s+of\s+|of\s+)?)?(?:item|number|dish)\s*(?:number\s*)?(\d+|one|two|three|four|five|six|seven|eight|nine|first|second|third)(?:\s*(?:and|,)\s*(?:item|number|dish)?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|first|second|third))?/gi;
  let numMatch: RegExpExecArray | null;
  while ((numMatch = itemNumRegex.exec(normalized)) !== null) {
    const rawQty = numMatch[1]?.toLowerCase();
    const qty = rawQty ? (NUMBER_WORDS[rawQty] ?? parseInt(rawQty, 10) ?? 1) : 1;

    const rawFirstIndex = numMatch[2]?.toLowerCase();
    const idx1 = NUMBER_WORDS[rawFirstIndex] !== undefined ? NUMBER_WORDS[rawFirstIndex] : parseInt(rawFirstIndex, 10);
    if (!isNaN(idx1) && idx1 >= 1 && idx1 <= availableMenu.length) {
      const targetItem = availableMenu[idx1 - 1];
      if (targetItem && !matchedIds.has(targetItem.id) && targetItem.available) {
        matched.push({
          menuItem: targetItem,
          quantity: Math.max(1, qty),
        });
        matchedIds.add(targetItem.id);
      }
    }

    if (numMatch[3]) {
      const rawSecondIndex = numMatch[3].toLowerCase();
      const idx2 = NUMBER_WORDS[rawSecondIndex] !== undefined ? NUMBER_WORDS[rawSecondIndex] : parseInt(rawSecondIndex, 10);
      if (!isNaN(idx2) && idx2 >= 1 && idx2 <= availableMenu.length) {
        const targetItem = availableMenu[idx2 - 1];
        if (targetItem && !matchedIds.has(targetItem.id) && targetItem.available) {
          matched.push({
            menuItem: targetItem,
            quantity: 1,
          });
          matchedIds.add(targetItem.id);
        }
      }
    }
  }

  // 2. Check each menu item by name & keywords
  for (const item of availableMenu) {
    if (matchedIds.has(item.id) || !item.available) continue;

    // Cleaned item names for comparison
    const engSimple = item.englishName.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const korSimple = item.koreanName.toLowerCase().trim();

    // Distinctive keywords from English name (filtering common stop words)
    const stopWords = new Set(['and', 'the', 'with', 'dish', 'rice', 'soup', 'food', 'hot', 'fried']);
    const words = engSimple.split(/\s+/).filter((w) => w.length >= 3 && !stopWords.has(w));
    const mainKeyWord = words.length > 0 ? words[0] : engSimple.split(/\s+/)[0];

    // Check if whole name, Korean name, or distinctive keywords appear in normalized text
    let matchedKeyword = '';
    let keywordIdx = -1;

    if (engSimple && normalized.includes(engSimple)) {
      matchedKeyword = engSimple;
      keywordIdx = normalized.indexOf(engSimple);
    } else if (korSimple && normalized.includes(korSimple)) {
      matchedKeyword = korSimple;
      keywordIdx = normalized.indexOf(korSimple);
    } else if (mainKeyWord && normalized.includes(mainKeyWord)) {
      matchedKeyword = mainKeyWord;
      keywordIdx = normalized.indexOf(mainKeyWord);
    } else {
      // Check any distinctive word (e.g. "tteokbokki", "bulgogi", "kimchi", "mandu", "bibimbap")
      for (const w of words) {
        if (w.length >= 4 && normalized.includes(w)) {
          matchedKeyword = w;
          keywordIdx = normalized.indexOf(w);
          break;
        }
      }
    }

    if (keywordIdx !== -1 && matchedKeyword) {
      let quantity = 1;

      // Check prefix directly preceding the item keyword
      const prefix = normalized.substring(Math.max(0, keywordIdx - 35), keywordIdx).trim();
      const prefixQtyMatch = prefix.match(
        /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|a|an|another|more)\b(?:\s+(?:orders?|bowls?|plates?|portions?)\s*(?:of)?)?\s*$/i
      );

      if (prefixQtyMatch && prefixQtyMatch[1]) {
        const qStr = prefixQtyMatch[1].toLowerCase();
        if (qStr === 'another' || qStr === 'more') {
          quantity = 1;
        } else {
          quantity = NUMBER_WORDS[qStr] ?? parseInt(qStr, 10) ?? 1;
          if (isNaN(quantity) || quantity < 1) quantity = 1;
        }
      } else {
        // Check suffix directly following the item keyword
        const suffixStart = keywordIdx + matchedKeyword.length;
        const suffix = normalized.substring(suffixStart, Math.min(normalized.length, suffixStart + 25)).trim();
        const suffixQtyMatch = suffix.match(
          /^(?:x|\*|times)?\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/i
        );
        if (suffixQtyMatch && suffixQtyMatch[1]) {
          const sStr = suffixQtyMatch[1].toLowerCase();
          quantity = NUMBER_WORDS[sStr] ?? parseInt(sStr, 10) ?? 1;
          if (isNaN(quantity) || quantity < 1) quantity = 1;
        }
      }

      matched.push({
        menuItem: item,
        quantity,
      });
      matchedIds.add(item.id);
    }
  }

  // Attach special requests if found
  if (specialRequests.length > 0 && matched.length > 0) {
    matched[0].specialRequest = specialRequests.join(', ');
  }

  return {
    matched,
    unmatched: matched.length === 0 ? [transcript] : [],
    specialRequests,
    specialRequest: specialRequests.length > 0 ? specialRequests.join(', ') : undefined,
  };
}

/**
 * Creates polite Korean order message for the stall owner
 */
export function formatKoreanOrderMessage(
  orderId: string,
  items: OrderItem[],
  totalKrw: number,
  specialRequests?: string,
  koreanSpecialRequest?: string,
  tableNumber?: string
): string {
  const itemLines = items
    .map(
      (item) =>
        `• ${item.koreanName} ${item.quantity}개 — ₩${(item.unitPriceKrw * item.quantity).toLocaleString('en-US')} (${item.koreanName} x ${item.quantity})`
    )
    .join('\n');

  let message = `🔔 새 주문 / New Order\n\n주문 번호: <b>${orderId}</b>\n주문 번호 / Order: ${orderId}\n`;

  if (tableNumber && tableNumber.trim()) {
    message += `테이블 / Table: <b>${tableNumber}</b>\n`;
  }

  message += `\n주문 내역:\n${itemLines}\n`;

  if (specialRequests && specialRequests.trim()) {
    const translated = koreanSpecialRequest || translateSpecialRequestToKorean(specialRequests);
    message += `\n요청사항: (Customer Special Request):\n${translated}\n원문: ${specialRequests}\n`;
  }

  message += `\n총 금액: ₩${totalKrw.toLocaleString('en-US')}\n주문 상태: 고객 확인 완료 (Customer Confirmed)`;

  return message;
}

/**
 * Translates common visitor food requests into polite Korean
 */
export function translateSpecialRequestToKorean(request: string): string {
  const lower = request.toLowerCase();
  const translations: string[] = [];

  if (lower.includes('no pork') || lower.includes('without pork')) {
    translations.push('돼지고기 제외 요청');
  }
  if (lower.includes('no beef') || lower.includes('without beef')) {
    translations.push('소고기 제외 요청');
  }
  if (lower.includes('less spicy') || lower.includes('not too spicy')) {
    translations.push('덜 맵게 조리 요청');
  }
  if (lower.includes('no spicy') || lower.includes('not spicy')) {
    translations.push('안 맵게 조리 요청');
  }
  if (lower.includes('extra spicy')) {
    translations.push('아주 맵게 (더 맵게 요청)');
  }
  if (lower.includes('no onion') || lower.includes('no onions')) {
    translations.push('양파 제외 요청 (양파 빼주세요)');
  }
  if (lower.includes('no egg') || lower.includes('without egg')) {
    translations.push('계란 제외 요청');
  }
  if (lower.includes('vegetarian') || lower.includes('veggie')) {
    translations.push('채식 (고기류 제외) 요청');
  }

  if (translations.length === 0) {
    return `고객 특별 요청: ${request}`;
  }
  return translations.join(', ');
}

/**
 * Spoken item description with stable item numbers and pronunciation
 * Example: "Item one: Kimchi Stew. Korean name, Kimchi Jjigae. Eight thousand won."
 */
export function formatItemSpokenDescription(item: MenuItem, index: number): string {
  const numberWord = ONES[index] || `number ${index}`;
  const priceSpoken = formatNaturalSpokenWon(item.priceKrw);
  const koreanPronunciation = item.koreanName;

  if (item.description) {
    return `Item ${numberWord}: ${item.englishName}, ${item.description}. ${priceSpoken}.`;
  }
  return `Item ${numberWord}: ${item.englishName}. Korean name, ${koreanPronunciation}. ${priceSpoken}.`;
}

/**
 * Reads order references slowly and clearly (e.g. A104 -> "A, one zero four")
 */
export function formatSpokenOrderNumber(orderId: string): string {
  const digitWords: Record<string, string> = {
    '0': 'zero',
    '1': 'one',
    '2': 'two',
    '3': 'three',
    '4': 'four',
    '5': 'five',
    '6': 'six',
    '7': 'seven',
    '8': 'eight',
    '9': 'nine',
  };

  const chars = orderId.trim().split('');
  const spokenParts = chars.map((c) => {
    if (/[a-zA-Z]/.test(c)) {
      return c.toUpperCase();
    }
    if (digitWords[c]) {
      return digitWords[c];
    }
    return c;
  });

  return spokenParts.join(', ');
}

/**
 * Generates spoken readback for an interpreted order:
 * "I understood: two Bulgogi at ten thousand won each, and one Tteokbokki at six thousand won. Your total is twenty-six thousand won."
 */
export function formatSpokenOrderSummary(items: OrderItem[]): string {
  if (items.length === 0) {
    return 'Your order is currently empty.';
  }

  const parts = items.map((item) => {
    const qtyWord = ONES[item.quantity] || `${item.quantity}`;
    const priceWord = formatNaturalSpokenWon(item.unitPriceKrw);
    if (item.quantity > 1) {
      return `${qtyWord} ${item.englishName} at ${priceWord} each`;
    }
    return `${qtyWord} ${item.englishName} at ${priceWord}`;
  });

  let itemsStr = '';
  if (parts.length === 1) {
    itemsStr = parts[0];
  } else if (parts.length === 2) {
    itemsStr = `${parts[0]}, and ${parts[1]}`;
  } else {
    const allButLast = parts.slice(0, -1).join(', ');
    itemsStr = `${allButLast}, and ${parts[parts.length - 1]}`;
  }

  const totalWon = calculateOrderTotal(items);
  const totalSpoken = formatNaturalSpokenWon(totalWon);

  return `I understood: ${itemsStr}. Your total is ${totalSpoken}.`;
}

/**
 * Generates an accessible readback summary of the order including item names, quantities, unit prices,
 * calculated total, and any special requests.
 */
export function buildAccessibleOrderSummarySpeech(items: OrderItem[], specialRequest?: string): string {
  if (items.length === 0) {
    return 'Your order is currently empty.';
  }

  const parts = items.map((item) => {
    const priceWord = formatNaturalSpokenWon(item.unitPriceKrw);
    const unitPart = item.quantity > 1 ? ` at ${priceWord} each` : ` at ${priceWord}`;
    return `${item.quantity} orders of ${item.englishName}${unitPart}`;
  });

  const totalWon = calculateOrderTotal(items);
  const totalSpoken = formatNaturalSpokenWon(totalWon);
  let summary = `Your order consists of: ${parts.join(', ')}. The calculated total is ${totalSpoken}.`;

  if (specialRequest && specialRequest.trim()) {
    summary += ` Special request: ${specialRequest.trim()}.`;
  }

  return summary;
}

export const buildItemDescriptionSpeech = formatItemSpokenDescription;

/**
 * Finds the cheapest available item on the menu
 */
export function findCheapestItem(items: MenuItem[]): MenuItem | null {
  const available = items.filter((i) => i.available);
  if (available.length === 0) return null;
  return [...available].sort((a, b) => a.priceKrw - b.priceKrw)[0];
}

/**
 * Finds items matching dietary preferences or categories (e.g. vegetarian, spicy)
 */
export function findItemsByCategoryOrDiet(items: MenuItem[], filter: 'vegetarian' | 'spicy'): MenuItem[] {
  if (filter === 'vegetarian') {
    return items.filter((i) => i.available && i.isVegetarian);
  }
  if (filter === 'spicy') {
    return items.filter((i) => i.available && i.isSpicy);
  }
  return items.filter((i) => i.available);
}

/**
 * Answers questions about the cheapest available item using approved menu data
 */
export function getCheapestAvailableItem(items: MenuItem[]): string {
  const available = items.filter((i) => i.available);
  if (available.length === 0) {
    return 'There are currently no items available on the stall menu.';
  }
  const cheapest = [...available].sort((a, b) => a.priceKrw - b.priceKrw)[0];
  return `The cheapest available item is ${cheapest.englishName} at ${formatNaturalSpokenWon(cheapest.priceKrw)}.`;
}

/**
 * Lists all currently available menu items
 */
export function getAvailableItemsSummary(items: MenuItem[]): string {
  const available = items.filter((i) => i.available);
  if (available.length === 0) {
    return 'No items are currently available on the menu.';
  }
  const names = available.map((i) => i.englishName);
  if (names.length === 1) {
    return `The available item is ${names[0]}.`;
  }
  const last = names.pop();
  return `The available items are ${names.join(', ')}, and ${last}.`;
}

/**
 * Checks for allergy concerns in customer special requests and returns safe guidance
 */
export function checkSpecialRequestAllergyWarning(request: string): {
  isAllergy: boolean;
  spokenMessage: string;
} {
  const lower = request.toLowerCase();
  const allergyKeywords = [
    'allergy',
    'allergic',
    'peanut',
    'peanuts',
    'gluten',
    'celiac',
    'shellfish',
    'shrimp',
    'crab',
    'dairy',
    'milk',
    'egg',
    'eggs',
    'nut',
    'nuts',
    'soy',
    'sesame',
  ];

  const hasAllergy = allergyKeywords.some((k) => lower.includes(k));

  if (hasAllergy) {
    return {
      isAllergy: true,
      spokenMessage: `I added the request: ${request}. This request may involve a food allergy. The app cannot guarantee that the food is allergen-free. Please wait for confirmation from the stall owner.`,
    };
  }

  return {
    isAllergy: false,
    spokenMessage: `I added the request: ${request}. The stall must confirm whether it can fulfil this request.`,
  };
}

/**
 * Detects if a spoken phrase matches multiple ambiguous dishes (e.g. "bulgogi" when there's beef and chicken)
 */
export function detectAmbiguousDish(
  spokenText: string,
  availableMenu: MenuItem[]
): { ambiguous: boolean; matches: Array<{ item: MenuItem; index: number }>; prompt?: string } {
  const lower = spokenText.toLowerCase().trim();
  const matchedList: Array<{ item: MenuItem; index: number }> = [];

  availableMenu.forEach((item, idx) => {
    if (!item.available) return;
    const eng = item.englishName.toLowerCase();
    const kor = item.koreanName.toLowerCase();
    if (eng.includes(lower) || kor.includes(lower)) {
      matchedList.push({ item, index: idx + 1 });
    }
  });

  if (matchedList.length > 1) {
    const options = matchedList
      .map((m) => `item ${ONES[m.index] || m.index}, ${m.item.englishName}`)
      .join(', or ');
    return {
      ambiguous: true,
      matches: matchedList,
      prompt: `Did you mean ${options}?`,
    };
  }

  return { ambiguous: false, matches: matchedList };
}

/**
 * Explicit Voice Command Matchers
 */
export function isConfirmationCommand(transcript: string): boolean {
  const t = transcript.toLowerCase().trim();
  const confirmPhrases = [
    'confirm',
    'confirm and send',
    'send order',
    'yes send it',
    'yes, send it',
    'that is correct',
    'place my order',
    'place order',
    'send it',
    'send',
    'yes confirm',
  ];
  return confirmPhrases.some((p) => t === p || t.startsWith(p) || t.endsWith(p));
}

export function isRepeatCommand(transcript: string): boolean {
  const t = transcript.toLowerCase().trim();
  const repeatPhrases = [
    'repeat',
    'read my order',
    'read that again',
    'what did i order',
    'what did i order?',
    'what is the total',
    'what is the total?',
    'read order',
    'hear again',
    'repeat order',
    'say again',
  ];
  return repeatPhrases.some((p) => t === p || t.includes(p));
}

export function isChangeCommand(transcript: string): boolean {
  const t = transcript.toLowerCase().trim();
  const changePhrases = [
    'change order',
    'edit order',
    'i want to change something',
    'that is incorrect',
    'change',
    'edit',
    'modify order',
    'make a change',
  ];
  return changePhrases.some((p) => t === p || t.includes(p));
}

export function isCancelCommand(transcript: string): boolean {
  const t = transcript.toLowerCase().trim();
  const cancelPhrases = [
    'cancel',
    'cancel order',
    'stop',
    'go back',
    'nevermind',
    'never mind',
    'close',
  ];
  return cancelPhrases.some((p) => t === p || t.includes(p));
}

export function isMenuReadCommand(transcript: string): boolean {
  const t = transcript.toLowerCase().trim();
  const readPhrases = [
    'read the full menu',
    'read full menu',
    'read menu',
    'read the menu',
    'start menu',
    'yes',
    'hear menu',
  ];
  return readPhrases.some((p) => t === p || t.includes(p));
}

export function isReadyToOrderCommand(transcript: string): boolean {
  const t = transcript.toLowerCase().trim();
  const readyPhrases = [
    'i am ready to order',
    'ready to order',
    'place order',
    'i already know my order',
    'no',
    'order now',
    'start ordering',
    'take order',
  ];
  return readyPhrases.some((p) => t === p || t.includes(p));
}

export function isAddMoreCommand(transcript: string): boolean {
  const t = transcript.toLowerCase().trim();
  const addPhrases = [
    'add another item',
    'add another',
    'add more',
    'add more items',
    'add something else',
    'add item',
    'add an item',
    'order another item',
    'order more',
    'another item',
    'one more item',
    'add one more',
    'more items',
    'want to add',
  ];
  return addPhrases.some((p) => t === p || t.includes(p));
}

export interface VoiceEditResult {
  success: boolean;
  matched?: boolean;
  action?:
    | 'increase'
    | 'decrease'
    | 'set_quantity'
    | 'change_quantity'
    | 'remove'
    | 'remove_item'
    | 'add'
    | 'add_item'
    | 'clear'
    | 'special_request'
    | 'remove_special_request'
    | 'finish';
  quantity?: number;
  specialRequest?: string;
  apply?: (items: OrderItem[]) => OrderItem[];
  updatedItems?: OrderItem[];
  updatedSpecialRequest?: string;
  changeAnnouncement: string;
  clarificationPrompt?: string;
}

/**
 * Parses spoken edit commands in listening_for_edit state
 */
export function parseVoiceEditCommand(
  transcript: string,
  currentItems: OrderItem[],
  availableMenu: MenuItem[],
  currentSpecialRequest?: string
): VoiceEditResult {
  const normalized = transcript.toLowerCase().trim();
  if (!normalized) {
    return {
      success: false,
      matched: false,
      changeAnnouncement: 'I did not hear a change. You can add an item, remove an item, change a quantity, or say "finish editing".',
    };
  }

  // Finish editing
  if (
    normalized.includes('finish editing') ||
    normalized.includes('done editing') ||
    normalized.includes('finish') ||
    normalized.includes('done') ||
    normalized.includes('ready')
  ) {
    return {
      success: true,
      matched: true,
      action: 'finish',
      apply: (items) => items,
      updatedItems: currentItems,
      updatedSpecialRequest: currentSpecialRequest,
      changeAnnouncement: 'Finished editing. Ready for confirmation.',
    };
  }

  // Remove everything / clear order
  if (
    normalized.includes('remove everything') ||
    normalized.includes('clear order') ||
    normalized.includes('delete all') ||
    normalized.includes('remove all')
  ) {
    return {
      success: true,
      matched: true,
      action: 'clear',
      apply: () => [],
      updatedItems: [],
      updatedSpecialRequest: undefined,
      changeAnnouncement: 'Removed all items. Your order is now empty. Say "add an item", "read menu", or "cancel".',
    };
  }

  // Remove special request
  if (
    normalized.includes('remove my special request') ||
    normalized.includes('remove special request') ||
    normalized.includes('delete special request') ||
    normalized.includes('clear special request')
  ) {
    return {
      success: true,
      matched: true,
      action: 'remove_special_request',
      apply: (items) => items,
      updatedItems: currentItems,
      updatedSpecialRequest: undefined,
      changeAnnouncement: 'Removed your special request.',
    };
  }

  // Add/edit special request e.g. "actually, extra spicy", "no onions", "extra spicy"
  const specialReqMatch =
    normalized.match(/(?:add|with)?\s*(?:a\s+)?special\s+request(?:\s*:)?\s*(.+)/i) ||
    normalized.match(/(?:actually,?\s*)?(no\s+[a-z]+|without\s+[a-z]+|less\s+[a-z]+|extra\s+[a-z]+|not\s+too\s+spicy|allergy\s+to\s+[a-z]+)/i);

  if (specialReqMatch) {
    const rawReq = specialReqMatch[1] || specialReqMatch[0];
    const reqText = rawReq.replace(/^actually,?\s*/i, '').trim();
    const allergyInfo = checkSpecialRequestAllergyWarning(reqText);
    return {
      success: true,
      matched: true,
      action: 'special_request',
      specialRequest: reqText,
      apply: (items) => items,
      updatedItems: currentItems,
      updatedSpecialRequest: reqText,
      changeAnnouncement: allergyInfo.spokenMessage,
    };
  }

  // Change quantity: "make it two bulgogi", "change bulgogi to two", "make bulgogi 2"
  const prefixChangeQtyMatch = normalized.match(/(?:change|make|set)\s+(?:it\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:orders?\s+of\s+)?(.+)/i);
  const suffixChangeQtyMatch = normalized.match(/(?:change|make|set)\s+(.+?)\s+to\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)/i);

  if (prefixChangeQtyMatch || suffixChangeQtyMatch) {
    const targetQtyStr = prefixChangeQtyMatch ? prefixChangeQtyMatch[1].toLowerCase() : suffixChangeQtyMatch![2].toLowerCase();
    const dishTarget = prefixChangeQtyMatch ? prefixChangeQtyMatch[2].trim() : suffixChangeQtyMatch![1].trim();
    const newQty = NUMBER_WORDS[targetQtyStr] || parseInt(targetQtyStr, 10) || 1;

    const itemIdx = findOrderItemIndex(dishTarget, currentItems, availableMenu);
    if (itemIdx === -1) {
      return {
        success: false,
        matched: false,
        changeAnnouncement: `Could not find "${dishTarget}" in your current order.`,
      };
    }

    const targetItem = currentItems[itemIdx];
    const applyFn = (items: OrderItem[]) => {
      const idx = findOrderItemIndex(dishTarget, items, availableMenu);
      if (idx === -1) return items;
      const copy = [...items];
      copy[idx] = { ...copy[idx], quantity: Math.max(1, newQty) };
      return copy;
    };

    const updated = applyFn(currentItems);
    const newTotal = calculateOrderTotal(updated);

    return {
      success: true,
      matched: true,
      action: 'change_quantity',
      quantity: newQty,
      apply: applyFn,
      updatedItems: updated,
      updatedSpecialRequest: currentSpecialRequest,
      changeAnnouncement: `${targetItem.englishName} has been changed to ${newQty}. Your new total is ${formatNaturalSpokenWon(newTotal)}. Say another change, read my order, or finish editing.`,
    };
  }

  // Increase quantity e.g. "increase bulgogi by one", "increase kimchi stew"
  const increaseMatch = normalized.match(/increase\s+(.+?)(?:\s+by\s+(\d+|one|two|three|four|five))?$/i);
  if (increaseMatch) {
    const dishTarget = increaseMatch[1].trim();
    const byQty = increaseMatch[2] ? (NUMBER_WORDS[increaseMatch[2].toLowerCase()] || parseInt(increaseMatch[2], 10) || 1) : 1;

    const itemIdx = findOrderItemIndex(dishTarget, currentItems, availableMenu);
    if (itemIdx === -1) {
      return {
        success: false,
        matched: false,
        changeAnnouncement: `Could not find "${dishTarget}" in your current order to increase.`,
      };
    }

    const targetItem = currentItems[itemIdx];
    const newQty = targetItem.quantity + byQty;
    const applyFn = (items: OrderItem[]) => {
      const idx = findOrderItemIndex(dishTarget, items, availableMenu);
      if (idx === -1) return items;
      const copy = [...items];
      copy[idx] = { ...copy[idx], quantity: copy[idx].quantity + byQty };
      return copy;
    };

    const updated = applyFn(currentItems);
    const newTotal = calculateOrderTotal(updated);
    return {
      success: true,
      matched: true,
      action: 'increase',
      quantity: newQty,
      apply: applyFn,
      updatedItems: updated,
      updatedSpecialRequest: currentSpecialRequest,
      changeAnnouncement: `${targetItem.englishName} has been increased to ${newQty}. Your new total is ${formatNaturalSpokenWon(newTotal)}.`,
    };
  }

  // Decrease quantity e.g. "decrease tteokbokki by one", "decrease bulgogi"
  const decreaseMatch = normalized.match(/decrease\s+(.+?)(?:\s+by\s+(\d+|one|two|three|four|five))?$/i);
  if (decreaseMatch) {
    const dishTarget = decreaseMatch[1].trim();
    const byQty = decreaseMatch[2] ? (NUMBER_WORDS[decreaseMatch[2].toLowerCase()] || parseInt(decreaseMatch[2], 10) || 1) : 1;

    const itemIdx = findOrderItemIndex(dishTarget, currentItems, availableMenu);
    if (itemIdx === -1) {
      return {
        success: false,
        matched: false,
        changeAnnouncement: `Could not find "${dishTarget}" in your current order to decrease.`,
      };
    }

    const targetItem = currentItems[itemIdx];
    const applyFn = (items: OrderItem[]) => {
      const idx = findOrderItemIndex(dishTarget, items, availableMenu);
      if (idx === -1) return items;
      const item = items[idx];
      const after = item.quantity - byQty;
      if (after <= 0) {
        return items.filter((_, i) => i !== idx);
      }
      const copy = [...items];
      copy[idx] = { ...item, quantity: after };
      return copy;
    };

    const updated = applyFn(currentItems);
    const newTotal = calculateOrderTotal(updated);
    return {
      success: true,
      matched: true,
      action: 'decrease',
      apply: applyFn,
      updatedItems: updated,
      updatedSpecialRequest: currentSpecialRequest,
      changeAnnouncement: `${targetItem.englishName} has been decreased. Your new total is ${formatNaturalSpokenWon(newTotal)}.`,
    };
  }

  // Remove specific item e.g. "remove the tteokbokki", "remove bulgogi", "remove item two"
  const removeMatch = normalized.match(/remove\s+(?:the\s+)?(.+)$/i);
  if (removeMatch) {
    const dishTarget = removeMatch[1].trim();
    const itemIdx = findOrderItemIndex(dishTarget, currentItems, availableMenu);
    if (itemIdx === -1) {
      return {
        success: false,
        matched: false,
        changeAnnouncement: `Could not find "${dishTarget}" in your current order to remove.`,
      };
    }

    const removedItem = currentItems[itemIdx];
    const applyFn = (items: OrderItem[]) => {
      const idx = findOrderItemIndex(dishTarget, items, availableMenu);
      if (idx === -1) return items;
      return items.filter((_, i) => i !== idx);
    };

    const updated = applyFn(currentItems);
    const newTotal = calculateOrderTotal(updated);
    return {
      success: true,
      matched: true,
      action: 'remove_item',
      apply: applyFn,
      updatedItems: updated,
      updatedSpecialRequest: currentSpecialRequest,
      changeAnnouncement: `Removed ${removedItem.englishName}. Your new total is ${formatNaturalSpokenWon(newTotal)}. Say another change, read my order, or finish editing.`,
    };
  }

  // Add an item e.g. "add one kimchi stew", "add item four", "add two bulgogi", "and one bulgogi", "two tteokbokki", "item 2"
  const cleanedForAdd = normalized.replace(/^(?:please\s+)?(?:add|and|also|plus|can\s+i\s+have|i\s+want|order)\s+/i, '');
  const parsedOrderInEdit = parseSpokenOrderText(cleanedForAdd, availableMenu);
  const candidatesToAdd = parsedOrderInEdit.matched.length > 0
    ? parsedOrderInEdit.matched
    : parseSpokenOrderText(normalized, availableMenu).matched;

  if (candidatesToAdd.length > 0) {
    const applyFn = (items: OrderItem[]) => {
      const copy = [...items];
      for (const cand of candidatesToAdd) {
        const existingIdx = copy.findIndex((i) => i.menuItemId === cand.menuItem.id);
        if (existingIdx !== -1) {
          copy[existingIdx] = {
            ...copy[existingIdx],
            quantity: copy[existingIdx].quantity + cand.quantity,
          };
        } else {
          copy.push({
            menuItemId: cand.menuItem.id,
            englishName: cand.menuItem.englishName,
            koreanName: cand.menuItem.koreanName,
            unitPriceKrw: cand.menuItem.priceKrw,
            quantity: cand.quantity,
          });
        }
      }
      return copy;
    };

    const updated = applyFn(currentItems);
    const newTotal = calculateOrderTotal(updated);
    const addedDesc = candidatesToAdd
      .map((c) => `${c.quantity > 1 ? c.quantity + ' ' : ''}${c.menuItem.englishName}`)
      .join(' and ');

    return {
      success: true,
      matched: true,
      action: 'add_item',
      quantity: candidatesToAdd[0].quantity,
      apply: applyFn,
      updatedItems: updated,
      updatedSpecialRequest: currentSpecialRequest,
      changeAnnouncement: `Added ${addedDesc}. Your new total is ${formatNaturalSpokenWon(newTotal)}. Say another change, read my order, or finish editing.`,
    };
  }

  const addMatch = normalized.match(/add\s+(?:(\d+|one|two|three|four|five|a|an)\s+)?(?:orders?\s+of\s+)?(.+)$/i);
  if (addMatch) {
    const rawQty = addMatch[1] ? addMatch[1].toLowerCase() : '1';
    const qty = NUMBER_WORDS[rawQty] || parseInt(rawQty, 10) || 1;
    const dishTarget = addMatch[2].trim();

    // Check menu item match
    const menuItem = findMenuItem(dishTarget, availableMenu);
    if (!menuItem) {
      return {
        success: false,
        matched: false,
        changeAnnouncement: `I could not find "${dishTarget}" on the stall menu.`,
      };
    }

    if (!menuItem.available) {
      return {
        success: false,
        matched: false,
        changeAnnouncement: `${menuItem.englishName} is currently sold out and cannot be added.`,
      };
    }

    const applyFn = (items: OrderItem[]) => {
      const existingIdx = items.findIndex((i) => i.menuItemId === menuItem.id);
      if (existingIdx !== -1) {
        const copy = [...items];
        copy[existingIdx] = {
          ...copy[existingIdx],
          quantity: copy[existingIdx].quantity + qty,
        };
        return copy;
      }
      return [
        ...items,
        {
          menuItemId: menuItem.id,
          englishName: menuItem.englishName,
          koreanName: menuItem.koreanName,
          unitPriceKrw: menuItem.priceKrw,
          quantity: qty,
        },
      ];
    };

    const updated = applyFn(currentItems);
    const newTotal = calculateOrderTotal(updated);
    return {
      success: true,
      matched: true,
      action: 'add_item',
      quantity: qty,
      apply: applyFn,
      updatedItems: updated,
      updatedSpecialRequest: currentSpecialRequest,
      changeAnnouncement: `Added ${qty > 1 ? qty + ' ' : ''}${menuItem.englishName}. Your new total is ${formatNaturalSpokenWon(newTotal)}. Say another change, read my order, or finish editing.`,
    };
  }

  return {
    success: false,
    matched: false,
    changeAnnouncement: `I did not understand "${transcript}". You can say "add an item", "remove an item", "change quantity", or "finish editing".`,
  };
}

function findOrderItemIndex(
  query: string,
  currentItems: OrderItem[],
  availableMenu: MenuItem[]
): number {
  const clean = query.toLowerCase().replace(/^(the|an|a|orders?\s+of)\s+/i, '').trim();

  // Check item number reference e.g. "item two", "item 2"
  const itemNumMatch = clean.match(/(?:item|number)\s*(\d+|one|two|three|four|five|six|seven|eight|nine)/i);
  if (itemNumMatch) {
    const val = itemNumMatch[1].toLowerCase();
    const idx = NUMBER_WORDS[val] !== undefined ? NUMBER_WORDS[val] : parseInt(val, 10);
    if (idx >= 1 && idx <= availableMenu.length) {
      const targetMenu = availableMenu[idx - 1];
      if (targetMenu) {
        return currentItems.findIndex((i) => i.menuItemId === targetMenu.id);
      }
    }
  }

  // Match by name or keyword
  return currentItems.findIndex((i) => {
    const eng = i.englishName.toLowerCase();
    const kor = i.koreanName.toLowerCase();
    return eng.includes(clean) || kor.includes(clean) || clean.includes(eng);
  });
}

function findMenuItem(query: string, availableMenu: MenuItem[]): MenuItem | null {
  const lower = query.toLowerCase().trim();

  // Item number e.g. "item three", "number 3", "dish 4"
  const numMatch = lower.match(/(?:item|number|dish)\s*(?:number\s*)?(\d+|one|two|three|four|five|six|seven|eight|nine|first|second|third|fourth|fifth)/i);
  if (numMatch) {
    const rawVal = numMatch[1].toLowerCase();
    const index = NUMBER_WORDS[rawVal] !== undefined ? NUMBER_WORDS[rawVal] : parseInt(rawVal, 10);
    if (!isNaN(index) && index >= 1 && index <= availableMenu.length) {
      return availableMenu[index - 1] || null;
    }
  }

  // Name match
  for (const item of availableMenu) {
    const eng = item.englishName.toLowerCase();
    const kor = item.koreanName.toLowerCase();
    if (eng.includes(lower) || kor.includes(lower) || lower.includes(eng)) {
      return item;
    }
    const words = eng.split(/\s+/).filter((w) => w.length > 2);
    if (words.some((w) => lower.includes(w))) {
      return item;
    }
  }

  return null;
}

/**
 * Common phrases and vocabulary used for Web Speech recognition grammar hints
 */
export const MENU_CONTEXTUAL_PHRASES: string[] = [
  'tteokbokki', 'topokki', 'ddukbokki', 'spicy rice cake', 'rice cakes',
  'eomuk', 'odeng', 'fish cake', 'fish cakes', 'fish cake soup',
  'hotteok', 'sweet pancake', 'sugar pancake',
  'sundae', 'soondae', 'blood sausage',
  'gimbap', 'kimbap', 'seaweed roll',
  'twigim', 'tempura', 'deep fried', 'fried vegetables',
  'mandu', 'dumplings', 'fried dumplings',
  'dakkochi', 'chicken skewer',
  'pajeon', 'scallion pancake', 'seafood pancake',
  'one', 'two', 'three', 'four', 'five', 'orders', 'portions', 'bowls',
  'less spicy', 'not spicy', 'no pork', 'no onions', 'please', 'confirm', 'send order'
];

/**
 * Normalizes speech recognition transcripts for common Korean dish names and phonetic mishearings
 */
export function normalizeAlternateSpokenDishName(text: string): string {
  let normalized = text;
  const replacements: [RegExp, string][] = [
    [/\btopokki\b/gi, 'tteokbokki'],
    [/\bddukbokki\b/gi, 'tteokbokki'],
    [/\btokpokki\b/gi, 'tteokbokki'],
    [/\btokboki\b/gi, 'tteokbokki'],
    [/\bduck boki\b/gi, 'tteokbokki'],
    [/\bduck bokki\b/gi, 'tteokbokki'],
    [/\bspicy rice cake[s]?\b/gi, 'tteokbokki'],
    [/\bfish cake[s]?\b/gi, 'eomuk'],
    [/\bodeng\b/gi, 'eomuk'],
    [/\bo-deng\b/gi, 'eomuk'],
    [/\bsweet pancake[s]?\b/gi, 'hotteok'],
    [/\bho-deok\b/gi, 'hotteok'],
    [/\bhot-teok\b/gi, 'hotteok'],
    [/\bhot dog\b/gi, 'hotteok'],
    [/\bblood sausage\b/gi, 'sundae'],
    [/\bsoon dae\b/gi, 'sundae'],
    [/\bsoondae\b/gi, 'sundae'],
    [/\bkimbap\b/gi, 'gimbap'],
    [/\bkim bap\b/gi, 'gimbap'],
    [/\bgim bap\b/gi, 'gimbap'],
    [/\bseaweed roll[s]?\b/gi, 'gimbap'],
    [/\bdumpling[s]?\b/gi, 'mandu'],
    [/\bpotsticker[s]?\b/gi, 'mandu'],
    [/\bchicken skewer[s]?\b/gi, 'dakkochi'],
    [/\bscallion pancake[s]?\b/gi, 'pajeon'],
  ];

  for (const [regex, rep] of replacements) {
    normalized = normalized.replace(regex, rep);
  }
  return normalized;
}
