export interface MenuItem {
  id: string;
  koreanName: string;
  englishName: string;
  priceKrw: number;
  confidence: number;
  needsConfirmation: boolean;
  available: boolean;
  category?: string;
  description?: string;
  isVegetarian?: boolean;
  isSpicy?: boolean;
}

export interface StallMenu {
  stallId: string;
  stallName: string;
  stallNameEn: string;
  stallLocation: string;
  items: MenuItem[];
  published: boolean;
  updatedAt: string;
}

export interface OrderItem {
  menuItemId: string;
  koreanName: string;
  englishName: string;
  unitPriceKrw: number;
  quantity: number;
  specialRequest?: string;
}

export type GuidedVoiceState =
  | 'idle'
  | 'introducing'
  | 'reading_menu'
  | 'awaiting_menu_command'
  | 'listening_for_order'
  | 'processing_order'
  | 'clarifying_order'
  | 'reviewing_order'
  | 'awaiting_confirmation_command'
  | 'listening_for_edit'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'cancelled';

export type OwnerAcknowledgement =
  | 'pending'
  | 'accepted'
  | 'item_unavailable'
  | 'cannot_fulfil_request'
  | 'rejected';

export type OrderLifecycleStatus =
  | 'draft'
  | 'submitting'
  | 'sent_to_telegram'
  | 'accepted'
  | 'item_unavailable'
  | 'cannot_fulfil_request'
  | 'rejected'
  | 'delivery_failed'
  | 'cancelled'
  | 'pending_confirmation'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'unknown';

export interface Order {
  orderId: string;
  publicOrderReference?: string;
  idempotencyKey: string;
  visitorId?: string;
  stallId?: string;
  tableNumber?: string;
  items: OrderItem[];
  subtotalKrw?: number;
  totalKrw: number;
  originalTranscript?: string;
  koreanTranslation: {
    formattedKorean: string;
    specialRequestsKorean?: string;
  };
  status: OrderLifecycleStatus;
  ownerAcknowledgement?: OwnerAcknowledgement;
  ownerNote?: string;
  createdAt: string;
  sentAt?: string;
  acknowledgedAt?: string;
  isMockDemo?: boolean;
  telegramDelivery: {
    attempted: boolean;
    success: boolean;
    mode: 'live' | 'mock';
    messageId?: number;
    error?: string;
    timestamp?: string;
  };
}

export interface VisitorOrderSummary {
  totalSpentKrw: number;
  totalOrdersCount: number;
  acceptedOrdersCount: number;
  pendingOrdersCount: number;
  latestOrder: Order | null;
}

export interface OwnerDashboardSummary {
  acceptedOrdersToday: number;
  pendingOrdersCount: number;
  rejectedOrdersCount: number;
  revenueTodayKrw: number;
  revenue7DaysKrw: number;
  revenue30DaysKrw: number;
  allTimeRevenueKrw: number;
  totalOrdersCount: number;
}

export type OwnerSummary = OwnerDashboardSummary;

export interface TelegramWebhookInfo {
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

export interface ParseSpeechRequest {
  transcript: string;
  menuItems: MenuItem[];
}

export interface ParsedItemMatch {
  menuItemId: string;
  matchedName: string;
  quantity: number;
  specialRequest?: string;
  unitPriceKrw: number;
}

export interface ParseSpeechResponse {
  matchedItems: ParsedItemMatch[];
  unmatchedPhrases: string[];
  needsClarification: boolean;
  clarificationPrompt?: string;
  originalTranscript: string;
  specialRequests?: string[];
  provider?: 'gemini' | 'browser' | 'local';
}

export interface TelegramConfigStatus {
  hasGeminiKey: boolean;
  hasTelegramBotToken: boolean;
  hasTelegramChatId: boolean;
  hasWebhookSecret: boolean;
  botTokenConfigured: boolean;
  chatIdConfigured: boolean;
  webhookSecretConfigured: boolean;
  webhookRegistered: boolean;
  webhookReceivingCallbacks: boolean;
  isLocalOrPreview: boolean;
  warning?: string;
  webhookUrl?: string;
  webhookInfo?: TelegramWebhookInfo | null;
  telegramMode: 'live' | 'mock';
  publicBaseUrl?: string;
  webhookConfigured?: boolean;
  lastWebhookError?: string;
}
