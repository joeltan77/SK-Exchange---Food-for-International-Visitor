import { MenuItem } from '../types';
import { normalizeAlternateSpokenDishName, MENU_CONTEXTUAL_PHRASES } from './orderMath';

// Web Speech API Types
export interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

export interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

export interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

export interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

export interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

export interface SpeechRecognitionGrammarList {
  length: number;
  item(index: number): any;
  addFromString(string: string, weight?: number): void;
}

export interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  grammars?: SpeechRecognitionGrammarList;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
  onresult: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionEvent) => void) | null;
  onerror: ((this: SpeechRecognitionInstance, ev: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((this: SpeechRecognitionInstance, ev: Event) => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    SpeechGrammarList?: new () => SpeechRecognitionGrammarList;
    webkitSpeechGrammarList?: new () => SpeechRecognitionGrammarList;
  }
}

export type RecognitionMode = 'command' | 'order_dictation' | 'special_request';
export type RecognitionStatus = 'idle' | 'listening' | 'processing' | 'error' | 'unsupported';

export interface RecognizerCallbacks {
  onStatusChange?: (status: RecognitionStatus, message?: string) => void;
  onTranscriptUpdate?: (accumulatedFinal: string, currentInterim: string, isFinalSegment: boolean) => void;
  onFinalized?: (finalTranscript: string) => void;
}

/**
 * Enhanced VoiceOrderRecognizer
 * Features:
 * 1. Multi-mode recognition:
 *    - 'command' (one-shot short, continuous=false)
 *    - 'order_dictation' (continuous=true, multi-segment accumulation)
 *    - 'special_request' (continuous=true with punctuation normalization)
 * 2. Multi-segment accumulation: never overwrites earlier final text when a new chunk arrives
 * 3. 1.2s - 1.8s silence detection timer before automatic finalization
 * 4. 15s maximum session safety timeout
 * 5. Menu-aware contextual hints & vocabulary normalization
 * 6. Explicit 'Done speaking' and 'Add more' APIs
 * 7. Safe restart guard: never restarts if cancelled or idle
 * 8. Speech provider fallback abstraction (Browser Web Speech API + Gemini/Server fallback ready)
 */
export class VoiceOrderRecognizer {
  private recognition: SpeechRecognitionInstance | null = null;
  private status: RecognitionStatus = 'idle';
  private mode: RecognitionMode = 'order_dictation';
  private activeMenu: MenuItem[] = [];

  // Accumulated transcripts
  private accumulatedFinalText = '';
  private currentInterimText = '';
  private processedResultIndices = new Set<number>();

  // Timers
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxDurationTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceDelayMs = 1500; // 1.5s (within 1.2s - 1.8s range)
  private maxDurationMs = 15000; // 15s max recording duration

  // Session control
  private sessionActive = false;
  private manuallyStopped = false;
  private sessionId = 0;

  // Callbacks
  private callbacks: RecognizerCallbacks = {};

  constructor() {
    this.initRecognition();
  }

  private initRecognition() {
    if (typeof window !== 'undefined') {
      const SpeechRecognitionConstructor = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognitionConstructor) {
        try {
          this.recognition = new SpeechRecognitionConstructor();
          this.setupEvents();
        } catch (e) {
          console.warn('SpeechRecognition initialization failed:', e);
        }
      }
    }
  }

  public isSupported(): boolean {
    return Boolean(this.recognition);
  }

  public setMode(mode: RecognitionMode) {
    this.mode = mode;
  }

  public getMode(): RecognitionMode {
    return this.mode;
  }

  public setMenuContext(menu: MenuItem[]) {
    this.activeMenu = menu;
    this.configureGrammarHints();
  }

  private configureGrammarHints() {
    if (!this.recognition) return;
    try {
      const GrammarConstructor = window.SpeechGrammarList || window.webkitSpeechGrammarList;
      if (GrammarConstructor) {
        const speechRecognitionList = new GrammarConstructor();
        // Generate JSGF grammar string with Korean street food dish names and common phrases
        const vocabWords = MENU_CONTEXTUAL_PHRASES.join(' | ');
        const grammar = `#JSGF V1.0; grammar korean_menu; public <item> = ${vocabWords} ;`;
        speechRecognitionList.addFromString(grammar, 1);
        this.recognition.grammars = speechRecognitionList;
      }
    } catch (e) {
      // Grammars are non-standard across browsers; ignore failure
    }
  }

  public setCallbacks(callbacks: RecognizerCallbacks) {
    this.callbacks = callbacks;
  }

  private setStatus(status: RecognitionStatus, message?: string) {
    this.status = status;
    this.callbacks.onStatusChange?.(status, message);
  }

  private setupEvents() {
    if (!this.recognition) return;

    this.recognition.onstart = () => {
      this.setStatus('listening', this.mode === 'command' ? 'Listening for command...' : 'Listening for your order... Speak now');
    };

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      if (!this.sessionActive) return;

      let newFinalSegments = '';
      let interim = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        const item = event.results[i];
        const primaryAlternative = item[0];
        const transcriptText = primaryAlternative?.transcript || '';

        if (item.isFinal) {
          if (!this.processedResultIndices.has(i)) {
            this.processedResultIndices.add(i);
            // Post-process with menu-aware pronunciation normalization
            const normalizedSegment = normalizeAlternateSpokenDishName(transcriptText);
            newFinalSegments += (newFinalSegments ? ' ' : '') + normalizedSegment;
          }
        } else {
          interim += (interim ? ' ' : '') + transcriptText;
        }
      }

      if (newFinalSegments) {
        // Accumulate onto any existing final transcript without clearing earlier words!
        this.accumulatedFinalText = this.accumulatedFinalText
          ? `${this.accumulatedFinalText} ${newFinalSegments}`.trim()
          : newFinalSegments.trim();
        this.currentInterimText = '';

        // Reset silence timer on every speech event
        this.resetSilenceTimer();

        // Notify listener of accumulated final text
        this.callbacks.onTranscriptUpdate?.(this.accumulatedFinalText, '', true);

        // In 'command' mode, finalize immediately
        if (this.mode === 'command') {
          this.finalize();
          return;
        }
      } else if (interim) {
        this.currentInterimText = interim;
        this.resetSilenceTimer();
        this.callbacks.onTranscriptUpdate?.(this.accumulatedFinalText, this.currentInterimText, false);
      }
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (!this.sessionActive) return;

      if (event.error === 'no-speech') {
        // No speech detected during pause; if we already have accumulated final text, finalize it
        if (this.accumulatedFinalText.trim().length > 0) {
          this.finalize();
          return;
        }
      }

      let friendlyError = 'An error occurred while listening.';
      if (event.error === 'not-allowed' || event.error === 'permission-denied') {
        friendlyError = 'Microphone permission was denied. Please allow microphone access or use manual input.';
      } else if (event.error === 'audio-capture') {
        friendlyError = 'No microphone was found. Please ensure your microphone is connected.';
      } else if (event.error === 'network') {
        friendlyError = 'Network error during speech recognition. You can type your order instead.';
      } else if (event.error === 'no-speech') {
        friendlyError = 'No speech was detected. Please press the microphone and try again.';
      }

      this.setStatus('error', friendlyError);
    };

    this.recognition.onend = () => {
      // If recognition unexpectedly stopped while session was supposed to be active, restart safely
      if (this.sessionActive && !this.manuallyStopped && this.mode === 'order_dictation') {
        try {
          this.recognition?.start();
          return;
        } catch (e) {
          // Restart failed
        }
      }

      if (this.status === 'listening') {
        this.setStatus('idle', 'Microphone stopped');
      }
    };
  }

  private resetSilenceTimer() {
    this.clearSilenceTimer();
    if (this.mode === 'order_dictation' || this.mode === 'special_request') {
      this.silenceTimer = setTimeout(() => {
        if (this.sessionActive && (this.accumulatedFinalText.trim() || this.currentInterimText.trim())) {
          this.finalize();
        }
      }, this.silenceDelayMs);
    }
  }

  private clearSilenceTimer() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private clearMaxDurationTimer() {
    if (this.maxDurationTimer) {
      clearTimeout(this.maxDurationTimer);
      this.maxDurationTimer = null;
    }
  }

  /**
   * Finalizes the current captured speech and notifies onFinalized
   */
  public finalize() {
    this.clearSilenceTimer();
    this.clearMaxDurationTimer();

    const fullResult = (
      this.accumulatedFinalText + (this.currentInterimText ? ` ${this.currentInterimText}` : '')
    ).trim();

    this.manuallyStopped = true;
    this.sessionActive = false;

    try {
      this.recognition?.stop();
    } catch (e) {
      // ignore
    }

    this.setStatus('idle', 'Done speaking');
    if (fullResult) {
      this.callbacks.onFinalized?.(fullResult);
    }
  }

  /**
   * Starts listening in the configured mode
   * @param appendToExisting If true ("Add more" mode), preserves existing accumulated transcript
   */
  public startListening(mode: RecognitionMode = 'order_dictation', appendToExisting = false) {
    if (!this.recognition) {
      this.setStatus('unsupported', 'Speech recognition is not supported in this browser. Please use manual input.');
      return;
    }

    this.clearSilenceTimer();
    this.clearMaxDurationTimer();

    this.sessionId++;
    this.sessionActive = true;
    this.manuallyStopped = false;
    this.mode = mode;
    this.processedResultIndices.clear();

    if (!appendToExisting) {
      this.accumulatedFinalText = '';
    }
    this.currentInterimText = '';

    // Configure continuous recognition based on mode
    this.recognition.continuous = mode === 'order_dictation' || mode === 'special_request';
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 3;
    this.recognition.lang = 'en-US';

    try {
      this.recognition.abort();
      this.recognition.start();
      this.setStatus('listening', 'Preparing microphone...');

      // 15-second safety timer to prevent endless listening
      this.maxDurationTimer = setTimeout(() => {
        if (this.sessionActive) {
          console.log('[VoiceRecognizer] Max recording duration (15s) reached. Finalizing.');
          this.finalize();
        }
      }, this.maxDurationMs);
    } catch (err: unknown) {
      console.warn('Failed to start recognition:', err);
      this.setStatus('error', 'Could not start voice recognition. Please try again or type below.');
    }
  }

  /**
   * Appends speech to the current order instead of replacing it ("Add more")
   */
  public addMoreSpeech(mode: RecognitionMode = 'order_dictation') {
    this.startListening(mode, true);
  }

  public isListening(): boolean {
    return this.status === 'listening' && this.sessionActive;
  }

  /**
   * Aborts listening immediately and discards any unfinalized recognition
   */
  public abortListening() {
    this.sessionActive = false;
    this.manuallyStopped = true;
    this.clearSilenceTimer();
    this.clearMaxDurationTimer();
    this.accumulatedFinalText = '';
    this.currentInterimText = '';
    this.processedResultIndices.clear();

    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch (e) {
        // ignore
      }
    }
    this.setStatus('idle', 'Microphone aborted');
  }

  public stopListening() {
    this.finalize();
  }

  public getAccumulatedTranscript(): string {
    return this.accumulatedFinalText;
  }

  public setAccumulatedTranscript(text: string) {
    this.accumulatedFinalText = text;
  }

  public getStatus(): RecognitionStatus {
    return this.status;
  }
}

export const voiceOrderService = new VoiceOrderRecognizer();
