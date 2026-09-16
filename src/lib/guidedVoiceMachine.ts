import { MenuItem, OrderItem, GuidedVoiceState, Order } from '../types';
import {
  calculateOrderTotal,
  formatItemSpokenDescription,
  formatNaturalSpokenWon,
  formatSpokenOrderNumber,
  formatSpokenOrderSummary,
  getAvailableItemsSummary,
  getCheapestAvailableItem,
  isCancelCommand,
  isChangeCommand,
  isConfirmationCommand,
  isAddMoreCommand,
  isMenuReadCommand,
  isReadyToOrderCommand,
  isRepeatCommand,
  parseSpokenOrderText,
  parseVoiceEditCommand,
  checkSpecialRequestAllergyWarning,
  detectAmbiguousDish,
  MatchCandidate,
} from './orderMath';
import { menuVoiceService, MenuSpeechSynthesizer } from './speechSynthesis';
import { voiceOrderService, VoiceOrderRecognizer } from './speechRecognition';
import { soundEffects } from './soundEffects';
import { getOrCreateVisitorId } from './visitorStorage';

export interface GuidedVoiceContext {
  state: GuidedVoiceState;
  transcript: string;
  interimTranscript: string;
  currentItems: OrderItem[];
  specialRequest?: string;
  orderId?: string;
  idempotencyKey: string;
  menuItems: MenuItem[];
  activeMenuIndex: number;
  unclearAttempts: number;
  clarificationOptions?: MenuItem[];
  statusAnnouncement: string;
  isMicrophoneActive: boolean;
  isSpeaking: boolean;
  sentOrder?: Order;
}

export type GuidedVoiceListener = (context: GuidedVoiceContext) => void;

export class GuidedVoiceController {
  private state: GuidedVoiceState = 'idle';
  private menuItems: MenuItem[] = [];
  private currentItems: OrderItem[] = [];
  private specialRequest?: string;
  private idempotencyKey = '';
  private orderId?: string;
  private sentOrder?: Order;
  private tableNumber?: string;

  private activeMenuIndex = 0;
  private isPaused = false;
  private speechRate: 'normal' | 'slower' = 'normal';
  private unclearAttempts = 0;
  private clarificationOptions?: MenuItem[];

  private currentTranscript = '';
  private interimTranscript = '';
  private statusAnnouncement = '';
  private isMicrophoneActive = false;
  private isSpeakingInternal = false;

  private sessionToken = 0;
  private listeners: Set<GuidedVoiceListener> = new Set();
  private synth: MenuSpeechSynthesizer;
  private recognizer: VoiceOrderRecognizer;

  constructor() {
    this.synth = menuVoiceService;
    this.recognizer = voiceOrderService;
  }

  public subscribe(listener: GuidedVoiceListener): () => void {
    this.listeners.add(listener);
    listener(this.getContext());
    return () => this.listeners.delete(listener);
  }

  private notify() {
    const ctx = this.getContext();
    this.listeners.forEach((fn) => fn(ctx));
  }

  public getContext(): GuidedVoiceContext {
    return {
      state: this.state,
      transcript: this.currentTranscript,
      interimTranscript: this.interimTranscript,
      currentItems: [...this.currentItems],
      specialRequest: this.specialRequest,
      orderId: this.orderId,
      idempotencyKey: this.idempotencyKey,
      menuItems: this.menuItems,
      activeMenuIndex: this.activeMenuIndex,
      unclearAttempts: this.unclearAttempts,
      clarificationOptions: this.clarificationOptions,
      statusAnnouncement: this.statusAnnouncement,
      isMicrophoneActive: this.isMicrophoneActive,
      isSpeaking: this.isSpeakingInternal,
      sentOrder: this.sentOrder,
    };
  }

  /**
   * Initializes a fresh guided session
   */
  public startSession(
    menuItems: MenuItem[],
    initialItems: OrderItem[] = [],
    existingIdempotencyKey?: string,
    tableNumber?: string
  ) {
    this.stopAllAudio();
    this.sessionToken++;
    const token = this.sessionToken;

    this.menuItems = menuItems;
    this.currentItems = [...initialItems];
    this.specialRequest = undefined;
    this.idempotencyKey = existingIdempotencyKey || `idemp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    this.orderId = undefined;
    this.sentOrder = undefined;
    this.tableNumber = tableNumber;
    this.activeMenuIndex = 0;
    this.unclearAttempts = 0;
    this.currentTranscript = '';
    this.interimTranscript = '';

    this.setupRecognizerCallbacks(token);

    // If visitor already has items in their cart, offer to review them directly
    if (this.currentItems.length > 0) {
      this.transitionTo('reviewing_order', 'Starting voice review of your current order.');
      this.reviewCurrentOrder(token);
      return;
    }

    // Otherwise, start spoken introduction
    this.transitionTo('introducing', 'Starting guided voice ordering...');
    this.runIntroduction(token);
  }

  /**
   * Stops all active speech, recognition, and resets session
   */
  public stopSession() {
    this.sessionToken++;
    this.stopAllAudio();
    if (this.state !== 'idle') {
      this.transitionTo('idle', 'Guided voice ordering stopped.');
    }
  }

  public cancelSession() {
    this.sessionToken++;
    this.stopAllAudio();
    soundEffects.playListeningStop();
    this.currentItems = [];
    this.specialRequest = undefined;
    this.transitionTo('cancelled', 'Order cancelled.');
    this.speak('Order cancelled. Guided voice session has ended.');
  }

  private stopAllAudio() {
    this.recognizer.abortListening();
    this.isMicrophoneActive = false;
    this.synth.stop();
    this.isSpeakingInternal = false;
  }

  private transitionTo(newState: GuidedVoiceState, announcement?: string) {
    this.state = newState;
    if (announcement) {
      this.statusAnnouncement = announcement;
    }
    this.notify();
  }

  /**
   * Safe speak wrapper that ensures microphone is NEVER active during speech.
   * Resolves only after speech ends.
   */
  private async speak(text: string, onEnd?: () => void): Promise<boolean> {
    const token = this.sessionToken;
    this.recognizer.abortListening();
    this.isMicrophoneActive = false;
    this.isSpeakingInternal = true;
    this.notify();

    const finished = await this.synth.speakText(text);

    if (token !== this.sessionToken) {
      return false;
    }

    this.isSpeakingInternal = false;
    this.notify();

    if (finished && onEnd) {
      onEnd();
    }
    return finished;
  }

  /**
   * Safe listen wrapper: waits a small settling delay (250ms) after speech ends
   * before enabling the microphone to avoid hearing the app's own echo.
   */
  private startListeningForUser(token: number, contextPrompt?: string) {
    if (token !== this.sessionToken) return;

    this.stopAllAudio();
    if (contextPrompt) {
      this.statusAnnouncement = contextPrompt;
      this.notify();
    }

    setTimeout(() => {
      if (token !== this.sessionToken || this.isSpeakingInternal) return;

      soundEffects.playListeningStart();
      this.isMicrophoneActive = true;
      this.currentTranscript = '';
      this.interimTranscript = '';
      this.notify();

      // In order state use 'order_dictation' mode; in command/confirmation states use 'command'
      const mode = (this.state === 'listening_for_order' || this.state === 'listening_for_edit')
        ? 'order_dictation'
        : 'command';

      this.recognizer.startListening(mode);
    }, 250);
  }

  /**
   * Sets up recognition callbacks bound to the current session token
   */
  private setupRecognizerCallbacks(token: number) {
    // Also provide menu context to recognizer
    if (this.menuItems.length > 0) {
      this.recognizer.setMenuContext(this.menuItems);
    }

    this.recognizer.setCallbacks({
      onStatusChange: (status, msg) => {
        if (token !== this.sessionToken) return;
        if (status === 'listening') {
          this.isMicrophoneActive = true;
        } else if (status === 'idle' || status === 'error') {
          this.isMicrophoneActive = false;
          if (status === 'error' && msg) {
            this.handleRecognitionError(token, msg);
          }
        }
        this.notify();
      },
      onTranscriptUpdate: (accumulatedFinal, interim, isFinalSegment) => {
        if (token !== this.sessionToken) return;
        this.currentTranscript = accumulatedFinal.trim();
        this.interimTranscript = interim;
        this.notify();

        // If recognizer is in command mode and finalized a segment, dispatch
        if (this.recognizer.getMode() === 'command' && isFinalSegment && accumulatedFinal.trim()) {
          this.isMicrophoneActive = false;
          soundEffects.playListeningStop();
          this.notify();
          this.handleSpokenInput(token, accumulatedFinal.trim());
        }
      },
      onFinalized: (fullFinalText) => {
        if (token !== this.sessionToken) return;
        const clean = fullFinalText.trim();
        if (clean) {
          this.currentTranscript = clean;
          this.interimTranscript = '';
          this.isMicrophoneActive = false;
          soundEffects.playListeningStop();
          this.notify();
          this.handleSpokenInput(token, clean);
        }
      },
    });
  }

  /**
   * Phase 1: Spoken Introduction
   */
  private async runIntroduction(token: number) {
    const introSpeech =
      'Guided voice ordering has started. I can read the menu, take your order, help you make changes, and send it to the stall owner. You can say “read menu”, “place order”, “repeat”, “help”, or “cancel” at any time. Would you like me to read the full menu?';

    await this.speak(introSpeech, () => {
      if (token !== this.sessionToken) return;
      this.transitionTo('awaiting_menu_command', 'Listening for your response: Say "Yes", "Read menu", or "Place order".');
      this.startListeningForUser(token);
    });
  }

  /**
   * Central spoken input dispatcher according to current state machine state
   */
  public async handleSpokenInput(token: number, transcript: string) {
    if (token !== this.sessionToken) return;
    const lower = transcript.toLowerCase().trim();

    if (!lower) {
      this.handleUnclearInput(token, 'I did not hear you.');
      return;
    }

    // Global commands recognized at any time
    if (isCancelCommand(lower)) {
      this.cancelSession();
      return;
    }

    if (lower === 'help' || lower.includes('what can i say')) {
      this.handleGlobalHelp(token);
      return;
    }

    // If the visitor speaks an order at any introductory or menu browsing stage, immediately interrupt and process
    if (this.state === 'introducing' || this.state === 'awaiting_menu_command' || this.state === 'reading_menu') {
      const orderTest = parseSpokenOrderText(transcript, this.menuItems);
      if (orderTest.matched.length > 0) {
        soundEffects.playCommandAccepted();
        this.synth.stop();
        await this.handleOrderSpeech(token, transcript);
        return;
      }
    }

    switch (this.state) {
      case 'awaiting_menu_command':
        await this.handleMenuCommand(token, transcript);
        break;

      case 'reading_menu':
        await this.handleReadingMenuCommand(token, transcript);
        break;

      case 'listening_for_order':
        await this.handleOrderSpeech(token, transcript);
        break;

      case 'clarifying_order':
        await this.handleClarificationSpeech(token, transcript);
        break;

      case 'reviewing_order':
      case 'awaiting_confirmation_command':
        await this.handleConfirmationCommand(token, transcript);
        break;

      case 'listening_for_edit':
        await this.handleEditCommand(token, transcript);
        break;

      case 'sent':
        await this.handleSentPostAction(token, transcript);
        break;

      case 'failed':
        await this.handleFailedPostAction(token, transcript);
        break;

      default:
        await this.handleUnclearInput(token, 'I am not sure what to do next.');
        break;
    }
  }

  /**
   * Phase 2: Menu Command Handling
   */
  private async handleMenuCommand(token: number, transcript: string) {
    const lower = transcript.toLowerCase().trim();

    // Check menu read
    if (isMenuReadCommand(lower) || lower === 'yes' || lower === 'please') {
      soundEffects.playCommandAccepted();
      this.unclearAttempts = 0;
      this.transitionTo('reading_menu', 'Reading the menu aloud...');
      this.activeMenuIndex = 0;
      this.readNextMenuItem(token);
      return;
    }

    // Ready to place order
    if (isReadyToOrderCommand(lower) || lower.includes('ready') || lower.includes('skip menu')) {
      soundEffects.playCommandAccepted();
      this.unclearAttempts = 0;
      this.transitionTo('listening_for_order', 'Ready to take your order.');
      await this.speak('Please say what you would like to order.', () => {
        this.startListeningForUser(token);
      });
      return;
    }

    // Query: Cheapest item
    if (lower.includes('cheapest') || lower.includes('least expensive')) {
      soundEffects.playCommandAccepted();
      const cheapAns = getCheapestAvailableItem(this.menuItems);
      await this.speak(`${cheapAns} Would you like me to read the full menu or take your order?`, () => {
        this.startListeningForUser(token);
      });
      return;
    }

    // Query: Which items are available
    if (lower.includes('available') || lower.includes('what do you have') || lower.includes('what is available')) {
      soundEffects.playCommandAccepted();
      const availAns = getAvailableItemsSummary(this.menuItems);
      await this.speak(`${availAns} Say “read menu” or “I am ready to order”.`, () => {
        this.startListeningForUser(token);
      });
      return;
    }

    // Repeat intro
    if (isRepeatCommand(lower)) {
      soundEffects.playCommandAccepted();
      this.runIntroduction(token);
      return;
    }

    // Direct add item e.g. "add item two"
    if (lower.startsWith('add ') || lower.startsWith('order ')) {
      soundEffects.playCommandAccepted();
      this.handleOrderSpeech(token, transcript);
      return;
    }

    this.handleUnclearInput(token, 'Would you like me to read the menu, or are you ready to place an order?');
  }

  /**
   * Menu Reading loop with item-by-item navigation
   */
  private async readNextMenuItem(token: number) {
    if (token !== this.sessionToken || this.state !== 'reading_menu') return;

    const available = this.menuItems.filter((i) => i.available);
    if (this.activeMenuIndex >= available.length) {
      // Completed reading menu
      this.transitionTo('awaiting_menu_command', 'Finished reading menu.');
      const doneText =
        'That is the end of the menu. You may say “add item two”, “repeat item two”, “next item”, “previous item”, “continue”, “start over”, or “I am ready to order”.';
      await this.speak(doneText, () => {
        this.startListeningForUser(token);
      });
      return;
    }

    const currentItem = available[this.activeMenuIndex];
    const desc = formatItemSpokenDescription(currentItem, this.activeMenuIndex + 1);

    await this.speak(desc, () => {
      if (token !== this.sessionToken || this.state !== 'reading_menu') return;
      // Prompt user after reading each item to allow pause/add/next
      this.activeMenuIndex++;
      if (this.activeMenuIndex < available.length) {
        setTimeout(() => {
          if (token === this.sessionToken && this.state === 'reading_menu' && !this.isPaused) {
            this.readNextMenuItem(token);
          }
        }, 800);
      } else {
        this.readNextMenuItem(token);
      }
    });
  }

  /**
   * Commands while listening during menu readout
   */
  private async handleReadingMenuCommand(token: number, transcript: string) {
    const lower = transcript.toLowerCase().trim();

    if (lower.includes('pause') || lower.includes('stop reading') || lower.includes('wait')) {
      soundEffects.playCommandAccepted();
      this.isPaused = true;
      this.synth.stop();
      await this.speak('Menu reading paused. Say “continue”, “repeat item”, or “place order”.', () => {
        this.startListeningForUser(token);
      });
      return;
    }

    if (lower.includes('continue') || lower.includes('resume')) {
      soundEffects.playCommandAccepted();
      this.isPaused = false;
      this.readNextMenuItem(token);
      return;
    }

    if (lower.includes('next') || lower.includes('next item')) {
      soundEffects.playCommandAccepted();
      this.activeMenuIndex = Math.min(this.menuItems.length - 1, this.activeMenuIndex + 1);
      this.readNextMenuItem(token);
      return;
    }

    if (lower.includes('previous') || lower.includes('go back')) {
      soundEffects.playCommandAccepted();
      this.activeMenuIndex = Math.max(0, this.activeMenuIndex - 2);
      this.readNextMenuItem(token);
      return;
    }

    if (lower.includes('start over') || lower.includes('start again')) {
      soundEffects.playCommandAccepted();
      this.activeMenuIndex = 0;
      this.readNextMenuItem(token);
      return;
    }

    if (lower.includes('speak slower') || lower.includes('slower')) {
      soundEffects.playCommandAccepted();
      this.speechRate = 'slower';
      this.synth.setRate('slower');
      await this.speak('I will now speak slower.', () => {
        this.readNextMenuItem(token);
      });
      return;
    }

    if (lower.includes('normal speed') || lower.includes('faster')) {
      soundEffects.playCommandAccepted();
      this.speechRate = 'normal';
      this.synth.setRate('normal');
      await this.speak('Speech speed set to normal.', () => {
        this.readNextMenuItem(token);
      });
      return;
    }

    if (isReadyToOrderCommand(lower)) {
      soundEffects.playCommandAccepted();
      this.transitionTo('listening_for_order', 'Ready to take your order.');
      await this.speak('Please say what you would like to order.', () => {
        this.startListeningForUser(token);
      });
      return;
    }

    // Direct addition of item
    if (lower.startsWith('add ') || lower.startsWith('order ')) {
      soundEffects.playCommandAccepted();
      this.handleOrderSpeech(token, transcript);
      return;
    }

    this.handleMenuCommand(token, transcript);
  }

  /**
   * Phase 3: Spoken Order Capture & Ambiguity Clarification
   */
  private async handleOrderSpeech(token: number, transcript: string) {
    this.transitionTo('processing_order', `Understanding "${transcript}"...`);

    // Check ambiguity first (e.g. user says "bulgogi" and stall has multiple bulgogis)
    const ambiguity = detectAmbiguousDish(transcript, this.menuItems);
    if (ambiguity.ambiguous && ambiguity.prompt) {
      soundEffects.playError();
      this.clarificationOptions = ambiguity.matches.map((m) => m.item);
      this.transitionTo('clarifying_order', ambiguity.prompt);
      await this.speak(ambiguity.prompt, () => {
        this.startListeningForUser(token);
      });
      return;
    }

    // Parse order text deterministically
    const parsed = parseSpokenOrderText(transcript, this.menuItems);

    if (parsed.matched.length === 0) {
      soundEffects.playError();
      this.unclearAttempts++;
      if (this.unclearAttempts >= 3) {
        await this.speak(
          'I am still having trouble recognizing food items in your speech. You can use the screen-reader-accessible buttons or say “read menu”.',
          () => {
            this.transitionTo('awaiting_menu_command', 'Try reading the menu or using buttons.');
            this.startListeningForUser(token);
          }
        );
      } else {
        await this.speak(
          'No matching food items were found in your speech. Please try saying the item name again, such as “two bulgogi and one kimchi stew”, or say “read menu”.',
          () => {
            this.transitionTo('listening_for_order', 'Listening for your order...');
            this.startListeningForUser(token);
          }
        );
      }
      return;
    }

    // Found items!
    soundEffects.playCommandAccepted();
    this.unclearAttempts = 0;

    if (this.currentItems.length > 0) {
      // Append or increment to existing order items without wiping them out
      await this.addItemsToCurrentOrder(parsed.matched, token);
      return;
    }

    this.currentItems = parsed.matched.map((m) => ({
      menuItemId: m.menuItem.id,
      englishName: m.menuItem.englishName,
      koreanName: m.menuItem.koreanName,
      unitPriceKrw: m.menuItem.priceKrw,
      quantity: m.quantity,
      specialRequest: m.specialRequest,
    }));

    // Check if any matched items had special requests with allergy warnings
    const combinedReq = parsed.matched
      .map((m) => m.specialRequest)
      .filter(Boolean)
      .join(', ');
    if (combinedReq) {
      this.specialRequest = combinedReq;
    }

    this.reviewCurrentOrder(token);
  }

  /**
   * Appends or increments items in currentItems without wiping existing items
   */
  public async addItemsToCurrentOrder(candidates: MatchCandidate[], token: number) {
    const updated = [...this.currentItems];
    const addedDescriptions: string[] = [];

    for (const cand of candidates) {
      const existingIdx = updated.findIndex((i) => i.menuItemId === cand.menuItem.id);
      if (existingIdx !== -1) {
        updated[existingIdx] = {
          ...updated[existingIdx],
          quantity: updated[existingIdx].quantity + cand.quantity,
          specialRequest: cand.specialRequest || updated[existingIdx].specialRequest,
        };
        addedDescriptions.push(
          `${cand.quantity > 1 ? cand.quantity + ' more ' : 'another '}${cand.menuItem.englishName}`
        );
      } else {
        updated.push({
          menuItemId: cand.menuItem.id,
          englishName: cand.menuItem.englishName,
          koreanName: cand.menuItem.koreanName,
          unitPriceKrw: cand.menuItem.priceKrw,
          quantity: cand.quantity,
          specialRequest: cand.specialRequest,
        });
        addedDescriptions.push(
          `${cand.quantity > 1 ? cand.quantity + ' ' : ''}${cand.menuItem.englishName}`
        );
      }
    }

    this.currentItems = updated;

    // Merge new special requests if any
    const newRequests = candidates.map((m) => m.specialRequest).filter(Boolean);
    if (newRequests.length > 0) {
      const combined = [this.specialRequest, ...newRequests].filter(Boolean).join(', ');
      this.specialRequest = combined;
    }

    this.notify();

    const newTotal = calculateOrderTotal(this.currentItems);
    const summary = formatSpokenOrderSummary(this.currentItems);
    const speech = `Added ${addedDescriptions.join(' and ')}. Your order now has: ${summary}. Your total is ${formatNaturalSpokenWon(newTotal)}. Say “confirm and send”, “add another item”, “change order”, or “cancel”.`;

    this.transitionTo('reviewing_order', `Added ${addedDescriptions.join(', ')}.`);
    await this.speak(speech, () => {
      if (token !== this.sessionToken) return;
      this.transitionTo(
        'awaiting_confirmation_command',
        'Waiting for confirmation: Say "Confirm and send", "Add another item", or "Change order".'
      );
      this.startListeningForUser(token);
    });
  }

  /**
   * Clarification Speech for Ambiguous Items
   */
  private async handleClarificationSpeech(token: number, transcript: string) {
    const lower = transcript.toLowerCase().trim();
    if (!this.clarificationOptions || this.clarificationOptions.length === 0) {
      this.handleOrderSpeech(token, transcript);
      return;
    }

    // Try matching which clarification option user chose
    const matchedChoice = this.clarificationOptions.find((item) => {
      const eng = item.englishName.toLowerCase();
      const kor = item.koreanName.toLowerCase();
      return eng.includes(lower) || kor.includes(lower) || lower.includes(eng);
    });

    if (matchedChoice) {
      soundEffects.playCommandAccepted();
      this.clarificationOptions = undefined;
      await this.addItemsToCurrentOrder(
        [
          {
            menuItem: matchedChoice,
            quantity: 1,
          },
        ],
        token
      );
      return;
    }

    // Fallback: parse entire speech again
    this.clarificationOptions = undefined;
    this.handleOrderSpeech(token, transcript);
  }

  /**
   * Phase 4: Order Review & Confirmation
   */
  public async reviewCurrentOrder(token: number) {
    this.transitionTo('reviewing_order', 'Reviewing your order...');

    const summaryText = formatSpokenOrderSummary(this.currentItems);
    let fullReviewSpeech = `${summaryText} `;

    if (this.specialRequest) {
      const allergyCheck = checkSpecialRequestAllergyWarning(this.specialRequest);
      fullReviewSpeech += `${allergyCheck.spokenMessage} `;
    }

    fullReviewSpeech += 'Say “confirm and send”, “add another item”, “change order”, or “cancel”.';

    await this.speak(fullReviewSpeech, () => {
      if (token !== this.sessionToken) return;
      this.transitionTo('awaiting_confirmation_command', 'Waiting for confirmation: Say "Confirm and send" or "Add another item".');
      this.startListeningForUser(token);
    });
  }

  /**
   * Phase 5: Confirmation Command Handling
   */
  private async handleConfirmationCommand(token: number, transcript: string) {
    const lower = transcript.toLowerCase().trim();

    // 1. Confirm & send
    if (isConfirmationCommand(lower)) {
      soundEffects.playCommandAccepted();
      this.unclearAttempts = 0;
      await this.submitOrder(token);
      return;
    }

    // 2. User says "add another item", "add more", "order more", "add item", "more"
    if (
      isAddMoreCommand(lower) ||
      lower.includes('add another') ||
      lower.includes('add more') ||
      lower.includes('order more') ||
      lower === 'yes' ||
      lower === 'add'
    ) {
      soundEffects.playCommandAccepted();
      this.unclearAttempts = 0;
      this.transitionTo('listening_for_order', 'Ready to add more items.');
      await this.speak('What item would you like to add? Say the item name or number.', () => {
        this.startListeningForUser(token);
      });
      return;
    }

    // 3. User directly speaks food items to add e.g. "two bulgogi", "and kimchi stew", "item 2"
    const orderMatch = parseSpokenOrderText(transcript, this.menuItems);
    if (orderMatch.matched.length > 0) {
      soundEffects.playCommandAccepted();
      this.unclearAttempts = 0;
      await this.addItemsToCurrentOrder(orderMatch.matched, token);
      return;
    }

    // 4. Voice edit command (e.g. remove, change quantity, special request)
    const editCheck = parseVoiceEditCommand(transcript, this.currentItems, this.menuItems, this.specialRequest);
    if (editCheck.success && editCheck.updatedItems !== undefined) {
      soundEffects.playCommandAccepted();
      this.unclearAttempts = 0;
      this.currentItems = editCheck.updatedItems;
      this.specialRequest = editCheck.updatedSpecialRequest;
      this.notify();
      await this.speak(editCheck.changeAnnouncement, () => {
        if (this.currentItems.length === 0) {
          this.transitionTo('listening_for_order', 'Your order is empty. Please say what you would like to order.');
          this.startListeningForUser(token);
        } else {
          this.reviewCurrentOrder(token);
        }
      });
      return;
    }

    // 5. Change / edit explicit prompt
    if (isChangeCommand(lower)) {
      soundEffects.playCommandAccepted();
      this.unclearAttempts = 0;
      this.transitionTo('listening_for_edit', 'Ready to make changes to your order.');
      const editPrompt =
        'What would you like to change? You can add an item, remove an item, change a quantity, or add a special request.';
      await this.speak(editPrompt, () => {
        this.startListeningForUser(token);
      });
      return;
    }

    // 6. Repeat order
    if (isRepeatCommand(lower)) {
      soundEffects.playCommandAccepted();
      this.unclearAttempts = 0;
      this.reviewCurrentOrder(token);
      return;
    }

    // 7. Start over / clear
    if (lower.includes('start over') || lower.includes('clear order') || lower.includes('start again')) {
      soundEffects.playCommandAccepted();
      this.currentItems = [];
      this.specialRequest = undefined;
      this.transitionTo('listening_for_order', 'Order cleared. Ready to start over.');
      await this.speak('Order cleared. Please say what you would like to order, or say “read menu”.', () => {
        this.startListeningForUser(token);
      });
      return;
    }

    // 8. Unclear command
    this.handleUnclearConfirmation(token);
  }

  /**
   * Phase 6: Voice Order Editing
   */
  private async handleEditCommand(token: number, transcript: string) {
    const editResult = parseVoiceEditCommand(
      transcript,
      this.currentItems,
      this.menuItems,
      this.specialRequest
    );

    if (editResult.success && editResult.action === 'finish') {
      soundEffects.playCommandAccepted();
      this.reviewCurrentOrder(token);
      return;
    }

    if (editResult.success && editResult.updatedItems !== undefined) {
      soundEffects.playCommandAccepted();
      this.currentItems = editResult.updatedItems;
      this.specialRequest = editResult.updatedSpecialRequest;
      this.notify();

      if (this.currentItems.length === 0) {
        await this.speak(editResult.changeAnnouncement, () => {
          this.startListeningForUser(token);
        });
        return;
      }

      const promptFollowup = `${editResult.changeAnnouncement} Say another change, read my order, or finish editing.`;
      await this.speak(promptFollowup, () => {
        this.startListeningForUser(token);
      });
      return;
    }

    // Edit failed or unrecognized
    soundEffects.playError();
    await this.speak(editResult.changeAnnouncement, () => {
      this.startListeningForUser(token);
    });
  }

  /**
   * Submits order to backend API endpoint
   */
  public async submitOrderToBackend(payload: {
    idempotencyKey: string;
    items: OrderItem[];
    specialRequest?: string;
    originalTranscript?: string;
    visitorId?: string;
    tableNumber?: string;
  }): Promise<{ ok?: boolean; success?: boolean; error?: string; order?: any; [key: string]: any }> {
    const visitorId = payload.visitorId || getOrCreateVisitorId();
    const response = await fetch('/api/order/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, visitorId }),
    });
    const data = await response.json();
    return { ok: response.ok, ...data };
  }

  /**
   * Phase 7: Order Submission & Telegram Dispatch
   */
  public async submitOrder(token: number) {
    if (this.currentItems.length === 0) {
      soundEffects.playError();
      await this.speak('Your order is empty. Please add at least one item before sending.', () => {
        this.transitionTo('listening_for_order', 'Please add items to your order.');
        this.startListeningForUser(token);
      });
      return;
    }

    this.transitionTo('sending', 'Sending your order to the stall owner...');
    this.synth.stop();
    this.recognizer.abortListening();

    await this.speak('Sending your order to the stall owner. Please wait.');

    try {
      const res = await this.submitOrderToBackend({
        idempotencyKey: this.idempotencyKey,
        items: this.currentItems,
        specialRequest: this.specialRequest,
        originalTranscript: this.currentTranscript,
        tableNumber: this.tableNumber,
      });

      if (token !== this.sessionToken) return;

      const order = res?.body?.order || res?.order;
      const isSuccess = Boolean(res?.body?.success || res?.success || res?.ok || (res?.status === 200 && order));

      if (isSuccess && order) {
        this.sentOrder = order;
        this.orderId = order.orderId;
        soundEffects.playOrderSent();
        this.transitionTo('sent', `Order ${this.orderId} sent successfully.`);

        const spokenOrderNum = formatSpokenOrderNumber(order.orderId);
        const successSpeech = `Your order was sent successfully. Your order number is ${spokenOrderNum}. Say “repeat order number”, “back to menu”, or “start a new order”.`;

        await this.speak(successSpeech, () => {
          this.startListeningForUser(token);
        });
      } else {
        throw new Error(res?.body?.error || res?.error || 'Submission failed');
      }
    } catch (err: unknown) {
      if (token !== this.sessionToken) return;
      soundEffects.playError();
      this.transitionTo('failed', 'Order delivery failed.');
      const failSpeech =
        'Your order was not delivered. Say “retry”, “read my order”, or “cancel”.';
      await this.speak(failSpeech, () => {
        this.startListeningForUser(token);
      });
    }
  }

  /**
   * Post-Send Actions (Sent state)
   */
  private async handleSentPostAction(token: number, transcript: string) {
    const lower = transcript.toLowerCase().trim();

    if (lower.includes('repeat') || lower.includes('order number')) {
      soundEffects.playCommandAccepted();
      if (this.orderId) {
        const spokenOrderNum = formatSpokenOrderNumber(this.orderId);
        await this.speak(`Your order number is ${spokenOrderNum}.`, () => {
          this.startListeningForUser(token);
        });
      }
      return;
    }

    if (lower.includes('new order') || lower.includes('start a new order') || lower.includes('again')) {
      soundEffects.playCommandAccepted();
      this.startSession(this.menuItems);
      return;
    }

    if (lower.includes('menu') || lower.includes('back to menu') || lower.includes('done')) {
      soundEffects.playCommandAccepted();
      this.stopSession();
      return;
    }

    await this.speak('Say “repeat order number”, “back to menu”, or “start a new order”.', () => {
      this.startListeningForUser(token);
    });
  }

  /**
   * Post-Failure Actions (Failed state)
   */
  private async handleFailedPostAction(token: number, transcript: string) {
    const lower = transcript.toLowerCase().trim();

    if (lower.includes('retry') || lower.includes('try again') || lower.includes('send')) {
      soundEffects.playCommandAccepted();
      // Retry with same idempotencyKey as required
      await this.submitOrder(token);
      return;
    }

    if (lower.includes('read') || lower.includes('order')) {
      soundEffects.playCommandAccepted();
      this.reviewCurrentOrder(token);
      return;
    }

    if (isCancelCommand(lower)) {
      this.cancelSession();
      return;
    }

    await this.speak('Say “retry”, “read my order”, or “cancel”.', () => {
      this.startListeningForUser(token);
    });
  }

  /**
   * Help command available anytime
   */
  private async handleGlobalHelp(token: number) {
    soundEffects.playCommandAccepted();
    const helpMessage =
      'You are using guided voice ordering. You can say “read menu”, “place order”, “confirm and send”, “change order”, “speak slower”, or “cancel” at any time. What would you like to do?';
    await this.speak(helpMessage, () => {
      this.startListeningForUser(token);
    });
  }

  /**
   * Handles unclear speech or ambient noise during confirmation
   */
  private async handleUnclearConfirmation(token: number) {
    soundEffects.playError();
    this.unclearAttempts++;

    if (this.unclearAttempts >= 3) {
      await this.speak(
        'I am still having trouble hearing you. You can use the screen-reader-accessible buttons or say “try again”.',
        () => {
          this.startListeningForUser(token);
        }
      );
    } else {
      await this.speak(
        'I did not understand. Say “confirm and send”, “change order”, “repeat order”, or “cancel”.',
        () => {
          this.startListeningForUser(token);
        }
      );
    }
  }

  private async handleUnclearInput(token: number, prompt: string) {
    soundEffects.playError();
    this.unclearAttempts++;

    if (this.unclearAttempts >= 3) {
      await this.speak(
        'I am having trouble understanding your speech. You can use the screen-reader-accessible buttons on screen, or say “help”.',
        () => {
          this.startListeningForUser(token);
        }
      );
    } else {
      const clarification = prompt.toLowerCase().includes('did not catch')
        ? prompt
        : `I did not catch that. Try saying: ${prompt}`;
      await this.speak(clarification, () => {
        this.startListeningForUser(token);
      });
    }
  }

  private handleRecognitionError(token: number, message: string) {
    if (token !== this.sessionToken) return;
    this.isMicrophoneActive = false;
    soundEffects.playError();
    this.statusAnnouncement = message;
    this.notify();
  }

  // Visual/manual override actions that sync directly with the state machine
  public setManualItems(items: OrderItem[]) {
    this.currentItems = [...items];
    this.notify();
  }

  public addManualItem(menuItem: MenuItem, quantity = 1) {
    const updated = [...this.currentItems];
    const existingIdx = updated.findIndex((i) => i.menuItemId === menuItem.id);
    if (existingIdx !== -1) {
      updated[existingIdx] = {
        ...updated[existingIdx],
        quantity: updated[existingIdx].quantity + quantity,
      };
    } else {
      updated.push({
        menuItemId: menuItem.id,
        englishName: menuItem.englishName,
        koreanName: menuItem.koreanName,
        unitPriceKrw: menuItem.priceKrw,
        quantity,
      });
    }
    this.currentItems = updated;
    soundEffects.playCommandAccepted();
    this.notify();

    const newTotal = calculateOrderTotal(this.currentItems);
    this.statusAnnouncement = `Added ${menuItem.englishName}. Order total: ₩${newTotal.toLocaleString('en-US')}`;
    this.notify();
  }

  public triggerStartListeningForAdd() {
    this.stopAllAudio();
    this.transitionTo('listening_for_order', 'Listening for items to add...');
    this.speak('What item would you like to add? Say the item name or number.', () => {
      this.startListeningForUser(this.sessionToken);
    });
  }

  public triggerStartListening(prompt?: string) {
    this.stopAllAudio();
    this.transitionTo('listening_for_order', prompt || 'Listening for your command...');
    this.speak(prompt || 'Listening. Please say your command.', () => {
      this.startListeningForUser(this.sessionToken);
    });
  }

  public triggerDirectMic() {
    this.synth.stop();
    this.isSpeakingInternal = false;
    this.startListeningForUser(this.sessionToken);
  }

  public setManualSpecialRequest(request?: string) {
    this.specialRequest = request;
    this.notify();
  }

  public triggerManualConfirm() {
    this.submitOrder(this.sessionToken);
  }

  public triggerManualRetry() {
    this.submitOrder(this.sessionToken);
  }
}

export const guidedVoiceController = new GuidedVoiceController();
