import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  X,
  Sparkles,
  AlertCircle,
  CornerDownLeft,
  Check,
  PlusCircle,
  RotateCcw,
  Volume2,
} from 'lucide-react';
import { voiceOrderService, RecognitionStatus } from '../lib/speechRecognition';
import { MenuItem, OrderItem } from '../types';

interface VoiceOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableMenu: MenuItem[];
  onOrderInterpreted: (items: OrderItem[], originalTranscript: string, specialRequest?: string) => void;
  onAnnounce: (msg: string) => void;
}

export const VoiceOrderModal: React.FC<VoiceOrderModalProps> = ({
  isOpen,
  onClose,
  availableMenu,
  onOrderInterpreted,
  onAnnounce,
}) => {
  const [status, setStatus] = useState<RecognitionStatus>('idle');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessingApi, setIsProcessingApi] = useState(false);
  const [manualText, setManualText] = useState('');
  const [suggestedPrompts] = useState([
    'Two bulgogi and one tteokbokki',
    'One kimchi stew, no pork please',
    'I want item number three',
    'One bibimbap and two gimbap',
  ]);

  const prevIsOpenRef = useRef(false);

  useEffect(() => {
    if (isOpen) {
      voiceOrderService.setMenuContext(availableMenu);

      voiceOrderService.setCallbacks({
        onStatusChange: (newStatus, msg) => {
          setStatus(newStatus);
          if (msg) {
            onAnnounce(msg);
          }
          if (newStatus === 'error' && msg) {
            setErrorMessage(msg);
          }
        },
        onTranscriptUpdate: (accumulatedFinal, interim) => {
          setFinalTranscript(accumulatedFinal);
          setInterimTranscript(interim);
          const fullCurrent = (accumulatedFinal + (interim ? ` ${interim}` : '')).trim();
          setManualText(fullCurrent);
        },
        onFinalized: (fullFinalText) => {
          setFinalTranscript(fullFinalText);
          setInterimTranscript('');
          setManualText(fullFinalText);
          handleProcessTranscript(fullFinalText);
        },
      });

      // Auto start continuous listening on open if supported
      if (voiceOrderService.isSupported()) {
        voiceOrderService.startListening('order_dictation');
      } else {
        setStatus('unsupported');
      }
    } else if (prevIsOpenRef.current) {
      voiceOrderService.abortListening();
      setFinalTranscript('');
      setInterimTranscript('');
      setErrorMessage(null);
      setIsProcessingApi(false);
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, availableMenu]);

  useEffect(() => {
    return () => {
      voiceOrderService.abortListening();
    };
  }, []);

  const handleToggleMic = () => {
    if (status === 'listening') {
      voiceOrderService.finalize();
      onAnnounce('Processing spoken order...');
    } else {
      setErrorMessage(null);
      voiceOrderService.startListening('order_dictation');
    }
  };

  const handleDoneSpeaking = () => {
    if (voiceOrderService.isListening()) {
      voiceOrderService.finalize();
    } else {
      const fullText = (finalTranscript + (interimTranscript ? ` ${interimTranscript}` : '')).trim() || manualText.trim();
      if (fullText) {
        handleProcessTranscript(fullText);
      }
    }
  };

  const handleAddMore = () => {
    setErrorMessage(null);
    voiceOrderService.addMoreSpeech('order_dictation');
    onAnnounce('Microphone listening: Add more dishes or requests');
  };

  const handleClearTranscript = () => {
    voiceOrderService.abortListening();
    setFinalTranscript('');
    setInterimTranscript('');
    setManualText('');
    setErrorMessage(null);
    onAnnounce('Transcript cleared');
  };

  const handleProcessTranscript = async (textToProcess: string) => {
    const cleanText = textToProcess.trim();
    if (!cleanText) return;

    setIsProcessingApi(true);
    onAnnounce('Understanding your spoken order...');

    try {
      const response = await fetch('/api/order/parse-speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: cleanText,
          menuItems: availableMenu,
        }),
      });

      const data = await response.json();

      if (data.matchedItems && data.matchedItems.length > 0) {
        const orderItems: OrderItem[] = data.matchedItems.map(
          (m: {
            menuItemId: string;
            matchedName: string;
            koreanName: string;
            quantity: number;
            specialRequest?: string;
            unitPriceKrw: number;
          }) => ({
            menuItemId: m.menuItemId,
            englishName: m.matchedName,
            koreanName: m.koreanName,
            quantity: m.quantity,
            specialRequest: m.specialRequest,
            unitPriceKrw: m.unitPriceKrw,
          })
        );

        const combinedSpecial = data.matchedItems
          .map((m: { specialRequest?: string }) => m.specialRequest)
          .filter(Boolean)
          .join(', ');

        onOrderInterpreted(orderItems, cleanText, combinedSpecial || undefined);
        onClose();
      } else {
        setErrorMessage(
          data.clarificationPrompt ||
            'We could not match your speech with any items on our stall menu. Please say the dish name again or select below.'
        );
        onAnnounce('Could not match item. Please repeat or tap Add More.');
      }
    } catch (err) {
      console.warn('Speech parsing network error:', err);
      setErrorMessage('Network error while processing speech. Please try again or tap the menu items directly.');
    } finally {
      setIsProcessingApi(false);
    }
  };

  if (!isOpen) return null;

  const currentDisplaySpeech = (finalTranscript + (interimTranscript ? ` ${interimTranscript}` : '')).trim();

  return (
    <div
      id="voice-order-modal-backdrop"
      className="fixed inset-0 z-50 bg-stone-950/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="voice-modal-title"
    >
      <div
        id="voice-order-modal-sheet"
        className="bg-stone-900 text-stone-100 w-full max-w-lg rounded-t-3xl sm:rounded-3xl border border-stone-800 shadow-2xl p-5 sm:p-6 max-h-[92vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-stone-800">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 id="voice-modal-title" className="text-lg font-bold text-white">
                Speak Your Order
              </h2>
              <p className="text-xs text-stone-400">
                Continuous dictation with multi-dish accumulation
              </p>
            </div>
          </div>
          <button
            id="btn-close-voice-modal"
            onClick={onClose}
            className="p-2 rounded-xl text-stone-400 hover:text-white hover:bg-stone-800 transition-colors focus-visible:ring-2 focus-visible:ring-amber-500"
            aria-label="Close voice order window"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Center Microphone Button */}
        <div className="flex flex-col items-center justify-center py-5 text-center">
          <div className="relative">
            {status === 'listening' && (
              <span className="absolute -inset-3 rounded-full bg-amber-500/30 animate-ping" />
            )}
            <button
              id="btn-main-mic"
              onClick={handleToggleMic}
              disabled={isProcessingApi}
              className={`relative z-10 w-24 h-24 rounded-full flex items-center justify-center shadow-xl transition-all duration-300 focus-visible:ring-4 focus-visible:ring-amber-400 ${
                status === 'listening'
                  ? 'bg-gradient-to-tr from-amber-500 to-red-500 text-stone-950 scale-105 shadow-amber-500/30'
                  : isProcessingApi
                  ? 'bg-stone-700 text-amber-400 animate-pulse'
                  : 'bg-stone-800 hover:bg-stone-700 text-stone-200 border-2 border-stone-700'
              }`}
              aria-label={
                status === 'listening'
                  ? 'Microphone active: Listening for your order. Press to stop.'
                  : 'Press to speak your order in English'
              }
              aria-pressed={status === 'listening'}
            >
              {status === 'listening' ? (
                <Mic className="w-10 h-10 animate-pulse" />
              ) : status === 'unsupported' ? (
                <MicOff className="w-10 h-10 text-stone-500" />
              ) : (
                <Mic className="w-10 h-10" />
              )}
            </button>
          </div>

          {/* Status announcement */}
          <div className="mt-3">
            <span
              id="mic-status-announcement"
              className={`text-sm font-semibold inline-flex items-center gap-1.5 px-3 py-1 rounded-full ${
                status === 'listening'
                  ? 'bg-amber-500/20 text-amber-300'
                  : isProcessingApi
                  ? 'bg-blue-500/20 text-blue-300'
                  : 'bg-stone-800 text-stone-300'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  status === 'listening'
                    ? 'bg-amber-400 animate-ping'
                    : isProcessingApi
                    ? 'bg-blue-400 animate-pulse'
                    : 'bg-stone-500'
                }`}
              />
              {status === 'listening'
                ? 'Listening... Speak continuously or pause when finished'
                : isProcessingApi
                ? 'Matching dishes with menu...'
                : status === 'unsupported'
                ? 'Voice recognition not available'
                : 'Tap microphone to start speaking'}
            </span>
          </div>

          {/* Live Transcript Display with Accumulation */}
          <div className="w-full mt-4 p-4 rounded-2xl bg-stone-950 border border-stone-800 text-left min-h-[84px] flex flex-col justify-between">
            {currentDisplaySpeech ? (
              <div>
                <p className="text-base font-medium text-stone-100">
                  <span>{finalTranscript}</span>
                  {interimTranscript && (
                    <span className="text-amber-400 italic"> {interimTranscript}</span>
                  )}
                </p>
              </div>
            ) : (
              <p className="text-xs text-stone-500">
                Spoken words will accumulate here as you speak (e.g. "Two bulgogi, one kimchi stew, and a tteokbokki")...
              </p>
            )}

            {/* Explicit dictation action controls */}
            {currentDisplaySpeech && (
              <div className="flex items-center justify-between pt-2.5 mt-2 border-t border-stone-800/80">
                <div className="flex items-center gap-2">
                  <button
                    id="btn-voice-done-speaking"
                    onClick={handleDoneSpeaking}
                    disabled={isProcessingApi}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500 hover:bg-emerald-400 text-stone-950 text-xs font-bold rounded-lg transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Done speaking</span>
                  </button>

                  <button
                    id="btn-voice-add-more"
                    onClick={handleAddMore}
                    disabled={isProcessingApi}
                    className="inline-flex items-center gap-1 px-2.5 py-1 bg-stone-800 hover:bg-stone-700 text-stone-300 text-xs font-medium rounded-lg transition-colors border border-stone-700"
                  >
                    <PlusCircle className="w-3.5 h-3.5 text-amber-400" />
                    <span>Add more</span>
                  </button>
                </div>

                <button
                  id="btn-voice-clear"
                  onClick={handleClearTranscript}
                  className="text-stone-400 hover:text-stone-200 text-xs p-1"
                  aria-label="Clear transcript"
                  title="Clear transcript"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Error / Guidance Notice */}
        {errorMessage && (
          <div
            id="voice-order-error"
            className="mb-4 p-3.5 rounded-2xl bg-red-950/70 border border-red-800 text-red-200 text-xs flex items-start gap-2.5"
            role="alert"
          >
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400 mt-0.5" />
            <div>
              <p className="font-semibold">{errorMessage}</p>
              <p className="text-stone-400 mt-1">
                You can try again, select an example below, or type your order manually.
              </p>
            </div>
          </div>
        )}

        {/* Examples of what to say */}
        <div className="mb-4">
          <label className="text-xs font-semibold text-stone-400 mb-2 block">
            Try saying (tap to use):
          </label>
          <div className="flex flex-wrap gap-1.5">
            {suggestedPrompts.map((prompt, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setFinalTranscript(prompt);
                  setInterimTranscript('');
                  setManualText(prompt);
                  handleProcessTranscript(prompt);
                }}
                className="text-xs text-stone-300 bg-stone-800 hover:bg-stone-700 border border-stone-700 px-3 py-1.5 rounded-lg transition-colors text-left"
              >
                "{prompt}"
              </button>
            ))}
          </div>
        </div>

        {/* Manual Keyboard Fallback */}
        <div className="pt-3 border-t border-stone-800">
          <label htmlFor="manual-order-input" className="text-xs font-medium text-stone-400 mb-1.5 block">
            Or type your order in English:
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleProcessTranscript(manualText);
            }}
            className="flex gap-2"
          >
            <input
              id="manual-order-input"
              type="text"
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              placeholder="e.g. 2 bulgogi and 1 kimchi stew"
              className="flex-1 bg-stone-950 border border-stone-700 rounded-xl px-3.5 py-2.5 text-sm text-stone-100 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
            <button
              id="btn-submit-manual-order"
              type="submit"
              disabled={!manualText.trim() || isProcessingApi}
              className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-stone-950 font-bold rounded-xl text-sm flex items-center gap-1.5 transition-colors"
            >
              <span>Order</span>
              <CornerDownLeft className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
