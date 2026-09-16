import React, { useEffect, useRef, useState } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  X,
  CheckCircle,
  AlertTriangle,
  RotateCcw,
  Send,
  Plus,
  Minus,
  Trash2,
  HelpCircle,
  Vibrate,
  Loader2,
} from 'lucide-react';
import { MenuItem, OrderItem } from '../types';
import { guidedVoiceController, GuidedVoiceContext } from '../lib/guidedVoiceMachine';
import { soundEffects } from '../lib/soundEffects';
import { calculateOrderTotal } from '../lib/orderMath';

interface GuidedVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  menuItems: MenuItem[];
  initialItems: OrderItem[];
  idempotencyKey?: string;
  triggerButtonRef?: React.RefObject<HTMLButtonElement>;
  onOrderCompleted?: (orderId: string) => void;
  tableNumber?: string;
}

export const GuidedVoiceModal: React.FC<GuidedVoiceModalProps> = ({
  isOpen,
  onClose,
  menuItems,
  initialItems,
  idempotencyKey,
  triggerButtonRef,
  onOrderCompleted,
  tableNumber,
}) => {
  const [ctx, setCtx] = useState<GuidedVoiceContext>(() => guidedVoiceController.getContext());
  const [soundOn, setSoundOn] = useState(() => soundEffects.isSoundEnabled());
  const [vibOn, setVibOn] = useState(() => soundEffects.isVibrationEnabled());
  const [showQuickAddMenu, setShowQuickAddMenu] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const prevIsOpenRef = useRef(false);
  const lastCompletedOrderRef = useRef<string | null>(null);

  const onOrderCompletedRef = useRef(onOrderCompleted);
  onOrderCompletedRef.current = onOrderCompleted;

  const menuItemsRef = useRef(menuItems);
  menuItemsRef.current = menuItems;

  const initialItemsRef = useRef(initialItems);
  initialItemsRef.current = initialItems;

  const idempotencyKeyRef = useRef(idempotencyKey);
  idempotencyKeyRef.current = idempotencyKey;

  const tableNumberRef = useRef(tableNumber);
  tableNumberRef.current = tableNumber;

  // Subscribe to controller state once on mount
  useEffect(() => {
    const unsub = guidedVoiceController.subscribe((newCtx) => {
      setCtx(newCtx);
      if (
        newCtx.state === 'sent' &&
        newCtx.orderId &&
        lastCompletedOrderRef.current !== newCtx.orderId
      ) {
        lastCompletedOrderRef.current = newCtx.orderId;
        onOrderCompletedRef.current?.(newCtx.orderId);
      }
    });
    return () => unsub();
  }, []);

  // Session start / stop lifecycle
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      guidedVoiceController.startSession(
        menuItemsRef.current,
        initialItemsRef.current,
        idempotencyKeyRef.current,
        tableNumberRef.current
      );
      // Accessibility focus management: focus close button or first focusable
      setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 100);
    } else if (!isOpen && prevIsOpenRef.current) {
      guidedVoiceController.stopSession();
      // Restore focus to opener
      triggerButtonRef?.current?.focus();
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, triggerButtonRef]);

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      guidedVoiceController.stopSession();
    };
  }, []);

  // Trap focus & escape key inside modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }

      if (e.key === 'Tab') {
        if (!modalRef.current) return;
        const focusables = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleClose = () => {
    guidedVoiceController.stopSession();
    onClose();
  };

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    soundEffects.setSoundEnabled(next);
  };

  const toggleVibration = () => {
    const next = !vibOn;
    setVibOn(next);
    soundEffects.setVibrationEnabled(next);
  };

  const handleManualQuantity = (itemIndex: number, delta: number) => {
    const updated = [...ctx.currentItems];
    const item = updated[itemIndex];
    const newQty = item.quantity + delta;
    if (newQty <= 0) {
      updated.splice(itemIndex, 1);
    } else {
      updated[itemIndex] = { ...item, quantity: newQty };
    }
    guidedVoiceController.setManualItems(updated);
  };

  const handleManualRemove = (itemIndex: number) => {
    const updated = ctx.currentItems.filter((_, idx) => idx !== itemIndex);
    guidedVoiceController.setManualItems(updated);
  };

  const orderTotal = calculateOrderTotal(ctx.currentItems);

  // Status badges & color
  const getStateBadge = () => {
    switch (ctx.state) {
      case 'introducing':
        return { text: 'Starting...', bg: 'bg-amber-100 text-amber-900 border-amber-300' };
      case 'reading_menu':
        return { text: 'Reading Menu Aloud', bg: 'bg-blue-100 text-blue-900 border-blue-300' };
      case 'awaiting_menu_command':
        return { text: 'Listening for Menu Choice', bg: 'bg-emerald-100 text-emerald-900 border-emerald-300' };
      case 'listening_for_order':
        return { text: 'Listening for Order', bg: 'bg-emerald-100 text-emerald-900 border-emerald-300' };
      case 'processing_order':
        return { text: 'Interpreting Speech...', bg: 'bg-purple-100 text-purple-900 border-purple-300' };
      case 'clarifying_order':
        return { text: 'Clarification Needed', bg: 'bg-amber-100 text-amber-900 border-amber-300' };
      case 'reviewing_order':
        return { text: 'Reading Order Summary', bg: 'bg-blue-100 text-blue-900 border-blue-300' };
      case 'awaiting_confirmation_command':
        return { text: 'Awaiting Voice Confirmation', bg: 'bg-emerald-100 text-emerald-900 border-emerald-300' };
      case 'listening_for_edit':
        return { text: 'Listening for Changes', bg: 'bg-indigo-100 text-indigo-900 border-indigo-300' };
      case 'sending':
        return { text: 'Sending to Stall...', bg: 'bg-purple-100 text-purple-900 border-purple-300' };
      case 'sent':
        return { text: 'Order Sent Successfully', bg: 'bg-green-100 text-green-900 border-green-300' };
      case 'failed':
        return { text: 'Delivery Failed', bg: 'bg-red-100 text-red-900 border-red-300' };
      case 'cancelled':
        return { text: 'Order Cancelled', bg: 'bg-gray-100 text-gray-800 border-gray-300' };
      default:
        return { text: 'Guided Mode Ready', bg: 'bg-gray-100 text-gray-800 border-gray-300' };
    }
  };

  const badge = getStateBadge();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guided-voice-title"
      aria-describedby="guided-voice-desc"
      ref={modalRef}
    >
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden my-auto flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-gray-900 text-white border-b border-gray-800">
          <div className="flex items-center space-x-3">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                ctx.isMicrophoneActive
                  ? 'bg-red-600 text-white animate-pulse ring-4 ring-red-400/40'
                  : ctx.isSpeaking
                  ? 'bg-blue-600 text-white ring-4 ring-blue-400/30'
                  : 'bg-gray-800 text-gray-300'
              }`}
              aria-hidden="true"
            >
              {ctx.isMicrophoneActive ? (
                <Mic className="w-5 h-5" />
              ) : ctx.isSpeaking ? (
                <Volume2 className="w-5 h-5" />
              ) : (
                <MicOff className="w-5 h-5" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="guided-voice-title" className="text-lg font-bold leading-tight">
                  Guided Voice Ordering
                </h2>
                {tableNumber && (
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 text-xs font-bold border border-emerald-500/30">
                    📍 {tableNumber}
                  </span>
                )}
              </div>
              <p id="guided-voice-desc" className="text-xs text-gray-300">
                {ctx.isMicrophoneActive
                  ? 'Listening for your voice...'
                  : ctx.isSpeaking
                  ? 'App is speaking...'
                  : 'Voice session active'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {/* Sound Toggle */}
            <button
              type="button"
              onClick={toggleSound}
              className="p-2.5 rounded-lg text-gray-300 hover:text-white hover:bg-gray-800 min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400"
              aria-label={soundOn ? 'Disable sound effects' : 'Enable sound effects'}
              title={soundOn ? 'Sound feedback on' : 'Sound feedback off'}
            >
              {soundOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5 text-gray-500" />}
            </button>

            {/* Vibration Toggle */}
            <button
              type="button"
              onClick={toggleVibration}
              className="p-2.5 rounded-lg text-gray-300 hover:text-white hover:bg-gray-800 min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400"
              aria-label={vibOn ? 'Disable vibration feedback' : 'Enable vibration feedback'}
              title={vibOn ? 'Vibration feedback on' : 'Vibration feedback off'}
            >
              <Vibrate className={`w-5 h-5 ${vibOn ? 'text-amber-400' : 'text-gray-500'}`} />
            </button>

            {/* Close Button */}
            <button
              ref={closeButtonRef}
              type="button"
              onClick={handleClose}
              className="p-2.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-amber-400"
              aria-label="Close guided voice ordering and return to menu"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Status Badge & ARIA Live Status */}
          <div className="flex items-center justify-between">
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold border ${badge.bg}`}
              role="status"
            >
              {badge.text}
            </span>

            <span className="text-xs text-gray-500 font-medium">
              ID: {ctx.idempotencyKey.slice(0, 14)}...
            </span>
          </div>

          {/* Active Audio State Banner */}
          <div
            className={`p-4 rounded-xl border transition-all ${
              ctx.isMicrophoneActive
                ? 'bg-red-50 border-red-200 text-red-950'
                : ctx.isSpeaking
                ? 'bg-blue-50 border-blue-200 text-blue-950'
                : 'bg-gray-50 border-gray-200 text-gray-800'
            }`}
            aria-live="assertive"
          >
            <div className="flex items-start space-x-3">
              {ctx.isMicrophoneActive ? (
                <Mic className="w-5 h-5 text-red-600 shrink-0 mt-0.5 animate-bounce" />
              ) : ctx.isSpeaking ? (
                <Volume2 className="w-5 h-5 text-blue-600 shrink-0 mt-0.5 animate-pulse" />
              ) : (
                <HelpCircle className="w-5 h-5 text-gray-500 shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <p className="font-semibold text-sm">
                  {ctx.statusAnnouncement || 'Welcome to guided voice ordering.'}
                </p>
                {ctx.isMicrophoneActive && (
                  <p className="text-xs text-red-700 mt-1 font-medium">
                    Speak clearly now. Text-to-speech is paused while listening.
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Speech Transcript Display */}
          {(ctx.transcript || ctx.interimTranscript) && (
            <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl" aria-live="polite">
              <p className="text-xs text-amber-800 font-semibold uppercase tracking-wider mb-1">
                What we heard:
              </p>
              <p className="text-sm font-medium text-gray-900 italic">
                "{ctx.transcript || ctx.interimTranscript}"
              </p>
            </div>
          )}

          {/* Current Understood Order Items */}
          <div className="border border-gray-200 rounded-xl p-4 bg-gray-50/50">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-900">
                Your Spoken Order ({ctx.currentItems.length} {ctx.currentItems.length === 1 ? 'item' : 'items'})
              </h3>
              <span className="text-xs font-semibold text-gray-600">
                Deterministic Total: ₩{orderTotal.toLocaleString('en-US')}
              </span>
            </div>

            {ctx.currentItems.length === 0 ? (
              <p className="text-sm text-gray-500 italic py-2">
                No items added yet. Say “read menu” or “I want two bulgogi”.
              </p>
            ) : (
              <ul className="space-y-2.5 divide-y divide-gray-200" role="list">
                {ctx.currentItems.map((item, idx) => (
                  <li key={`${item.menuItemId}-${idx}`} className="pt-2.5 first:pt-0 flex items-center justify-between">
                    <div className="pr-2">
                      <div className="font-semibold text-sm text-gray-900">
                        {item.englishName}
                      </div>
                      <div className="text-xs text-gray-500">
                        {item.koreanName} • ₩{item.unitPriceKrw.toLocaleString('en-US')} each
                      </div>
                      {item.specialRequest && (
                        <div className="text-xs text-amber-800 font-medium mt-0.5">
                          Note: {item.specialRequest}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center space-x-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleManualQuantity(idx, -1)}
                        className="w-8 h-8 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800 flex items-center justify-center font-bold min-w-[36px] min-h-[36px] focus:ring-2 focus:ring-amber-500"
                        aria-label={`Decrease quantity of ${item.englishName}`}
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span
                        className="w-7 text-center font-bold text-sm text-gray-900"
                        aria-label={`Quantity: ${item.quantity}`}
                      >
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleManualQuantity(idx, 1)}
                        className="w-8 h-8 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800 flex items-center justify-center font-bold min-w-[36px] min-h-[36px] focus:ring-2 focus:ring-amber-500"
                        aria-label={`Increase quantity of ${item.englishName}`}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleManualRemove(idx)}
                        className="w-8 h-8 rounded-lg text-red-600 hover:bg-red-50 flex items-center justify-center ml-1 min-w-[36px] min-h-[36px] focus:ring-2 focus:ring-red-500"
                        aria-label={`Remove ${item.englishName} from order`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* Add More Items Options */}
            <div className="mt-3 pt-3 border-t border-gray-200 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => guidedVoiceController.triggerStartListeningForAdd()}
                disabled={ctx.isSpeaking || ctx.state === 'sending'}
                className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold transition-colors focus:ring-2 focus:ring-amber-400 disabled:opacity-50 min-h-[36px]"
              >
                <Mic className="w-3.5 h-3.5" />
                <span>+ Speak to Add Item</span>
              </button>

              <button
                type="button"
                onClick={() => setShowQuickAddMenu(!showQuickAddMenu)}
                className="inline-flex items-center space-x-1 px-3 py-1.5 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800 text-xs font-semibold transition-colors focus:ring-2 focus:ring-gray-400 min-h-[36px]"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{showQuickAddMenu ? 'Hide Stall Menu' : '+ Add from Menu'}</span>
              </button>
            </div>

            {/* Quick Add Menu Drawer */}
            {showQuickAddMenu && (
              <div className="mt-3 p-3 bg-white border border-gray-200 rounded-xl space-y-2 max-h-52 overflow-y-auto">
                <p className="text-xs font-bold text-gray-700 uppercase tracking-wide">
                  Available Stall Items (Tap to Add):
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {menuItems.filter((m) => m.available).map((menuItem) => (
                    <div
                      key={menuItem.id}
                      className="flex items-center justify-between p-2 rounded-lg bg-gray-50 border border-gray-200 text-xs hover:bg-amber-50/50 transition-colors"
                    >
                      <div className="pr-1 truncate">
                        <div className="font-semibold text-gray-900 truncate">{menuItem.englishName}</div>
                        <div className="text-gray-500 text-[11px]">₩{menuItem.priceKrw.toLocaleString('en-US')}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          guidedVoiceController.addManualItem(menuItem, 1);
                        }}
                        className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white font-bold shrink-0 focus:ring-2 focus:ring-amber-400 min-h-[30px]"
                        aria-label={`Add ${menuItem.englishName} to order`}
                      >
                        + Add
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {ctx.specialRequest && (
              <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-amber-900 bg-amber-50/70 p-2.5 rounded-lg">
                <span className="font-bold">Special Request:</span> {ctx.specialRequest}
              </div>
            )}
          </div>

          {/* Success / Sent State View */}
          {ctx.state === 'sent' && ctx.orderId && (
            <div className="p-4 bg-green-50 border border-green-200 rounded-xl text-green-900 space-y-2">
              <div className="flex items-center space-x-2">
                <CheckCircle className="w-6 h-6 text-green-600" />
                <h4 className="font-bold text-base">Order Delivered to Stall!</h4>
              </div>
              <p className="text-sm">
                Your order number is <strong className="text-lg text-green-950 font-black">{ctx.orderId}</strong>.
              </p>
              <p className="text-xs text-green-800">
                Show this order number to the stall owner when picking up your food.
              </p>
            </div>
          )}

          {/* Failed State View */}
          {ctx.state === 'failed' && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-900 space-y-2">
              <div className="flex items-center space-x-2">
                <AlertTriangle className="w-6 h-6 text-red-600" />
                <h4 className="font-bold text-base">Delivery Unsuccessful</h4>
              </div>
              <p className="text-sm">
                The order could not be delivered to Telegram. You may safely retry.
              </p>
            </div>
          )}

          {/* Spoken Voice Commands Cheatsheet */}
          <div className="border border-gray-200 rounded-xl p-3 bg-white">
            <p className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2 flex items-center">
              <HelpCircle className="w-3.5 h-3.5 mr-1 text-gray-500" />
              Helpful Spoken Voice Commands:
            </p>
            <div className="grid grid-cols-2 gap-1.5 text-xs text-gray-600">
              <span className="bg-gray-100 px-2 py-1 rounded font-medium">“Add another item”</span>
              <span className="bg-gray-100 px-2 py-1 rounded font-medium">“Two bulgogi and one stew”</span>
              <span className="bg-gray-100 px-2 py-1 rounded font-medium">“Read menu”</span>
              <span className="bg-gray-100 px-2 py-1 rounded font-medium">“Confirm and send”</span>
              <span className="bg-gray-100 px-2 py-1 rounded font-medium">“Add mandu”</span>
              <span className="bg-gray-100 px-2 py-1 rounded font-medium">“Change order”</span>
              <span className="bg-gray-100 px-2 py-1 rounded font-medium">“What is the cheapest item?”</span>
              <span className="bg-gray-100 px-2 py-1 rounded font-medium">“Cancel”</span>
            </div>
          </div>
        </div>

        {/* Footer Actions / Accessible Manual Overrides */}
        <div className="px-5 py-3.5 bg-gray-100 border-t border-gray-200 flex flex-wrap items-center justify-between gap-2">
          {/* Quick Trigger Button to Speak Now if micro is idle */}
          <button
            type="button"
            onClick={() => {
              if (ctx.isMicrophoneActive) {
                guidedVoiceController.stopSession();
              } else {
                guidedVoiceController.triggerDirectMic();
              }
            }}
            disabled={ctx.isSpeaking || ctx.state === 'sending'}
            className={`px-4 py-2.5 rounded-xl font-bold text-sm min-h-[44px] flex items-center space-x-2 transition-colors focus:ring-2 focus:ring-amber-500 ${
              ctx.isMicrophoneActive
                ? 'bg-red-600 text-white animate-pulse hover:bg-red-700'
                : 'bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50'
            }`}
            aria-label={ctx.isMicrophoneActive ? 'Stop listening' : 'Start speaking command'}
          >
            {ctx.isMicrophoneActive ? (
              <>
                <Mic className="w-4 h-4" />
                <span>Listening... (Tap to Pause)</span>
              </>
            ) : (
              <>
                <Mic className="w-4 h-4" />
                <span>Speak Voice Command</span>
              </>
            )}
          </button>

          {/* State-specific Primary Action Button */}
          <div className="flex items-center space-x-2">
            {ctx.state === 'failed' && (
              <button
                type="button"
                onClick={() => guidedVoiceController.triggerManualRetry()}
                className="px-4 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-sm min-h-[44px] flex items-center space-x-2 focus:ring-2 focus:ring-amber-400"
                aria-label="Retry sending this order"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Retry Order</span>
              </button>
            )}

            {ctx.state === 'sent' && (
              <button
                type="button"
                onClick={handleClose}
                className="px-5 py-2.5 rounded-xl bg-green-700 hover:bg-green-800 text-white font-bold text-sm min-h-[44px] flex items-center space-x-2 focus:ring-2 focus:ring-green-400"
                aria-label="Done with order and return to menu"
              >
                <span>Back to Menu</span>
              </button>
            )}

            {(ctx.state === 'awaiting_confirmation_command' || ctx.state === 'reviewing_order') && (
              <button
                type="button"
                onClick={() => guidedVoiceController.triggerManualConfirm()}
                disabled={ctx.state === 'sending' || ctx.currentItems.length === 0}
                className="px-5 py-2.5 rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white font-bold text-sm min-h-[44px] flex items-center space-x-2 shadow-sm focus:ring-2 focus:ring-green-400"
                aria-label="Confirm and send order to stall owner"
              >
                {ctx.state === 'sending' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Sending...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>Confirm & Send (₩{orderTotal.toLocaleString('en-US')})</span>
                  </>
                )}
              </button>
            )}

            {ctx.state !== 'sent' && (
              <button
                type="button"
                onClick={handleClose}
                className="px-3.5 py-2.5 rounded-xl bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold text-sm min-h-[44px] focus:ring-2 focus:ring-gray-400"
                aria-label="Cancel and close guided voice ordering"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
