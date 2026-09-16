import { MenuItem } from '../types';
import { formatNaturalSpokenWon } from './orderMath';

export type SpeechRate = 'normal' | 'slower';

export interface SpeechState {
  isPlaying: boolean;
  isPaused: boolean;
  currentItemId: string | null;
  currentIndex: number;
  rate: SpeechRate;
  totalItems: number;
}

export class MenuSpeechSynthesizer {
  private synth: SpeechSynthesis | null = null;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private queue: Array<{ item: MenuItem; index: number }> = [];
  private currentQueueIndex = 0;
  private isReadingFullMenu = false;
  private currentRate: SpeechRate = 'normal';
  private onStateChangeCallback?: (state: SpeechState) => void;
  private onAnnouncementCallback?: (message: string) => void;
  private isPausedInternally = false;
  private speechGenerationId = 0;
  private currentResolve?: (completed: boolean) => void;

  constructor() {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.synth = window.speechSynthesis;
    }
  }

  public setCallbacks(
    onStateChange: (state: SpeechState) => void,
    onAnnounce: (message: string) => void
  ) {
    this.onStateChangeCallback = onStateChange;
    this.onAnnouncementCallback = onAnnounce;
  }

  public isSpeaking(): boolean {
    return Boolean(this.synth?.speaking && !this.isPausedInternally);
  }

  private getSpeechRateValue(): number {
    return this.currentRate === 'slower' ? 0.75 : 0.95;
  }

  private notifyState(itemId: string | null = null) {
    if (!this.onStateChangeCallback) return;
    this.onStateChangeCallback({
      isPlaying: Boolean(this.synth?.speaking && !this.isPausedInternally),
      isPaused: this.isPausedInternally,
      currentItemId: itemId,
      currentIndex: this.currentQueueIndex,
      rate: this.currentRate,
      totalItems: this.queue.length,
    });
  }

  private announce(text: string) {
    if (this.onAnnouncementCallback) {
      this.onAnnouncementCallback(text);
    }
  }

  public setRate(rate: SpeechRate) {
    this.currentRate = rate;
    this.announce(`Speech speed set to ${rate}`);
    this.notifyState();
  }

  public getRate(): SpeechRate {
    return this.currentRate;
  }

  /**
   * Speaks any given text and returns a Promise resolving true when finished,
   * or false if cancelled/interrupted.
   */
  public speakText(text: string, itemId: string | null = null): Promise<boolean> {
    this.stop();
    this.speechGenerationId++;
    const genId = this.speechGenerationId;

    return new Promise((resolve) => {
      this.currentResolve = resolve;

      if (!this.synth) {
        this.announce(text);
        resolve(true);
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      this.currentUtterance = utterance;
      utterance.rate = this.getSpeechRateValue();
      utterance.lang = 'en-US';

      // Pick natural English voice if available
      const voices = this.synth.getVoices();
      const englishVoice =
        voices.find((v) => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha'))) ||
        voices.find((v) => v.lang.startsWith('en'));
      if (englishVoice) {
        utterance.voice = englishVoice;
      }

      utterance.onstart = () => {
        if (this.speechGenerationId === genId) {
          this.isPausedInternally = false;
          this.notifyState(itemId);
          this.announce(text);
        }
      };

      utterance.onend = () => {
        if (this.speechGenerationId === genId) {
          this.notifyState(null);
          this.currentUtterance = null;
          this.currentResolve = undefined;
          resolve(true);
        }
      };

      utterance.onerror = (e) => {
        if (this.speechGenerationId === genId) {
          console.warn('Speech synthesis error or cancel:', e);
          this.notifyState(null);
          this.currentUtterance = null;
          this.currentResolve = undefined;
          resolve(false);
        }
      };

      this.synth.speak(utterance);
    });
  }

  /**
   * Reads a single menu item aloud in natural English
   */
  public readItem(item: MenuItem, index?: number): Promise<boolean> {
    this.stop();
    this.isReadingFullMenu = false;
    this.queue = [{ item, index: index ?? 1 }];
    this.currentQueueIndex = 0;

    const spokenPrice = formatNaturalSpokenWon(item.priceKrw);
    const textToSpeak = index !== undefined
      ? `Item ${index}: ${item.englishName}. ${spokenPrice}.`
      : `${item.englishName}. ${spokenPrice}.`;

    return this.speakText(textToSpeak, item.id);
  }

  /**
   * Reads the entire menu sequentially with pauses between items
   */
  public readFullMenu(items: MenuItem[]): void {
    this.stop();
    const availableItems = items.filter((i) => i.available);
    if (availableItems.length === 0) {
      this.announce('No items available to read.');
      return;
    }

    this.isReadingFullMenu = true;
    this.queue = availableItems.map((item, idx) => ({ item, index: idx + 1 }));
    this.currentQueueIndex = 0;

    this.announce(`Starting full menu readout of ${availableItems.length} items`);
    this.playNextInQueue();
  }

  private playNextInQueue() {
    if (!this.isReadingFullMenu || this.currentQueueIndex >= this.queue.length) {
      this.stop();
      this.announce('Finished reading the menu.');
      return;
    }

    const { item, index } = this.queue[this.currentQueueIndex];
    const spokenPrice = formatNaturalSpokenWon(item.priceKrw);
    const spokenText = `Item ${index}: ${item.englishName}. ${spokenPrice}.`;

    this.speakText(spokenText, item.id).then((completed) => {
      if (completed && this.isReadingFullMenu && !this.isPausedInternally) {
        this.currentQueueIndex++;
        setTimeout(() => {
          if (this.isReadingFullMenu && !this.isPausedInternally) {
            this.playNextInQueue();
          }
        }, 700);
      }
    });
  }

  /**
   * Reads back an order confirmation before visitor sends
   */
  public speakConfirmation(text: string): Promise<boolean> {
    this.stop();
    this.isReadingFullMenu = false;
    return this.speakText(text, null);
  }

  public pause(): void {
    if (this.synth && this.synth.speaking && !this.synth.paused) {
      this.synth.pause();
      this.isPausedInternally = true;
      this.announce('Audio paused');
      this.notifyState(this.queue[this.currentQueueIndex]?.item.id || null);
    }
  }

  public resume(): void {
    if (this.synth && this.synth.paused) {
      this.synth.resume();
      this.isPausedInternally = false;
      this.announce('Audio resumed');
      this.notifyState(this.queue[this.currentQueueIndex]?.item.id || null);
    }
  }

  public stop(): void {
    const wasActive = Boolean(
      this.currentUtterance ||
      (this.synth && (this.synth.speaking || this.synth.paused)) ||
      this.isReadingFullMenu ||
      this.isPausedInternally ||
      this.queue.length > 0
    );

    this.speechGenerationId++;
    if (this.currentResolve) {
      const prevResolve = this.currentResolve;
      this.currentResolve = undefined;
      prevResolve(false);
    }
    if (this.synth) {
      this.synth.cancel();
    }
    this.currentUtterance = null;
    this.isReadingFullMenu = false;
    this.isPausedInternally = false;
    this.queue = [];
    if (wasActive) {
      this.notifyState(null);
    }
  }

  public repeat(): void {
    if (this.queue.length > 0) {
      const current = this.queue[this.currentQueueIndex] || this.queue[0];
      if (this.isReadingFullMenu) {
        this.playNextInQueue();
      } else {
        this.readItem(current.item, current.index);
      }
    }
  }

  public isSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }
}

export const menuVoiceService = new MenuSpeechSynthesizer();
