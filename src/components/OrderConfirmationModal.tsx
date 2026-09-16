import React, { useState, useEffect, useRef } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Volume2,
  Send,
  XCircle,
  RotateCcw,
  Plus,
  Minus,
  Trash2,
  PlusCircle,
  MessageSquare,
  X,
  ThumbsUp,
} from 'lucide-react';
import { calculateOrderTotal, formatDualPrice, formatNaturalSpokenWon } from '../lib/orderMath';
import { menuVoiceService } from '../lib/speechSynthesis';
import { MenuItem, Order, OrderItem, TelegramConfigStatus, OwnerAcknowledgement } from '../types';
import { getOrCreateVisitorId } from '../lib/visitorStorage';

interface OrderConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderItems?: OrderItem[];
  items?: OrderItem[];
  onOrderItemsChange?: (items: OrderItem[]) => void;
  specialRequest?: string;
  onSpecialRequestChange?: (val: string) => void;
  idempotencyKey: string;
  availableMenu?: MenuItem[];
  originalTranscript?: string;
  transcript?: string;
  onOrderCompleted: (order: Order) => void;
  onAnnounce?: (msg: string) => void;
  telegramStatus: TelegramConfigStatus | null;
  tableNumber?: string;
}

export const OrderConfirmationModal: React.FC<OrderConfirmationModalProps> = ({
  isOpen,
  onClose,
  orderItems: rawOrderItems,
  items: aliasItems,
  onOrderItemsChange,
  specialRequest,
  onSpecialRequestChange,
  idempotencyKey,
  availableMenu = [],
  originalTranscript,
  transcript,
  onOrderCompleted,
  onAnnounce,
  telegramStatus,
  tableNumber,
}) => {
  const orderItems = rawOrderItems || aliasItems || [];
  const activeTranscript = originalTranscript || transcript;

  const [deliveryStatus, setDeliveryStatus] = useState<
    'ready' | 'sending' | 'sent' | 'failed' | 'duplicate_blocked'
  >('ready');
  const [submittedOrder, setSubmittedOrder] = useState<Order | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isReadingBack, setIsReadingBack] = useState(false);
  const [isAddingItem, setIsAddingItem] = useState(false);
  const [editingItemNoteId, setEditingItemNoteId] = useState<string | null>(null);

  const addItemButtonRef = useRef<HTMLButtonElement>(null);
  const itemSelectorRef = useRef<HTMLDivElement>(null);
  const firstAvailableItemRef = useRef<HTMLButtonElement>(null);

  // Deterministically calculate total
  const totalKrw = calculateOrderTotal(orderItems);
  const totalDual = formatDualPrice(totalKrw);

  // Compose speech text for reading back order
  const generateConfirmationSpeechText = (items: OrderItem[], req?: string, total: number = totalKrw): string => {
    if (items.length === 0) {
      return 'Your order is currently empty. Please add items to your order.';
    }

    const itemPhrases = items.map((item) => {
      const unitWords = formatNaturalSpokenWon(item.unitPriceKrw);
      const qtyWord = item.quantity === 1 ? 'one' : String(item.quantity);
      let phrase = `${qtyWord} ${item.englishName} at ${unitWords} each`;
      if (item.specialRequest) {
        phrase += ` with note: ${item.specialRequest}`;
      }
      return phrase;
    });

    const totalWords = formatNaturalSpokenWon(total);
    let speech = `You selected ${itemPhrases.join(', and ')}. Your total is ${totalWords}.`;
    if (req) {
      speech += ` Special request: ${req}.`;
    }
    speech += ' Would you like to send this order to the stall owner?';
    return speech;
  };

  const prevIsOpenRef = useRef(false);
  const prevIdempotencyKeyRef = useRef<string | null>(null);

  // Reset state when a new idempotencyKey is supplied or modal is opened
  useEffect(() => {
    const isNowOpen = isOpen;
    const wasOpen = prevIsOpenRef.current;
    const keyChanged = Boolean(idempotencyKey && idempotencyKey !== prevIdempotencyKeyRef.current);

    if (isNowOpen && (!wasOpen || keyChanged)) {
      prevIdempotencyKeyRef.current = idempotencyKey || null;
      setDeliveryStatus('ready');
      setSubmittedOrder(null);
      setErrorMessage(null);
      setIsAddingItem(false);
      setEditingItemNoteId(null);

      if (orderItems.length > 0) {
        const speech = generateConfirmationSpeechText(orderItems, specialRequest, totalKrw);
        setIsReadingBack(true);
        onAnnounce(speech);
        menuVoiceService.speakConfirmation(speech).finally(() => {
          setIsReadingBack(false);
        });
      }
    } else if (!isNowOpen && wasOpen) {
      menuVoiceService.stop();
      setIsReadingBack(false);
      setIsAddingItem(false);
      setEditingItemNoteId(null);
    }

    prevIsOpenRef.current = isNowOpen;
  }, [isOpen, idempotencyKey, orderItems, specialRequest, totalKrw, onAnnounce]);

  useEffect(() => {
    return () => {
      menuVoiceService.stop();
    };
  }, []);

  // Focus management for item selector
  useEffect(() => {
    if (isAddingItem) {
      // Focus first item or container
      setTimeout(() => {
        if (firstAvailableItemRef.current) {
          firstAvailableItemRef.current.focus();
        } else if (itemSelectorRef.current) {
          itemSelectorRef.current.focus();
        }
      }, 50);
    }
  }, [isAddingItem]);

  const handleReadBackAgain = () => {
    menuVoiceService.stop();
    const speech = generateConfirmationSpeechText(orderItems, specialRequest, totalKrw);
    setIsReadingBack(true);
    onAnnounce('Reading back order summary');
    menuVoiceService.speakConfirmation(speech).finally(() => {
      setIsReadingBack(false);
    });
  };

  // Editing helpers with voice stop & ARIA announcements
  const handleIncreaseQuantity = (index: number) => {
    if (deliveryStatus === 'sending' || deliveryStatus === 'sent') return;
    menuVoiceService.stop();

    const targetItem = orderItems[index];
    const newQuantity = targetItem.quantity + 1;
    const updated = orderItems.map((item, idx) =>
      idx === index ? { ...item, quantity: newQuantity } : item
    );
    onOrderItemsChange(updated);

    const newTotal = calculateOrderTotal(updated);
    onAnnounce(
      `Increased ${targetItem.englishName} quantity to ${newQuantity}. Order total is now ${formatNaturalSpokenWon(
        newTotal
      )}.`
    );
  };

  const handleDecreaseQuantity = (index: number) => {
    if (deliveryStatus === 'sending' || deliveryStatus === 'sent') return;
    menuVoiceService.stop();

    const targetItem = orderItems[index];
    if (targetItem.quantity > 1) {
      const newQuantity = targetItem.quantity - 1;
      const updated = orderItems.map((item, idx) =>
        idx === index ? { ...item, quantity: newQuantity } : item
      );
      onOrderItemsChange(updated);
      const newTotal = calculateOrderTotal(updated);
      onAnnounce(
        `Decreased ${targetItem.englishName} quantity to ${newQuantity}. Order total is now ${formatNaturalSpokenWon(
          newTotal
        )}.`
      );
    } else {
      // Remove item if decreasing from 1
      handleRemoveItem(index);
    }
  };

  const handleRemoveItem = (index: number) => {
    if (deliveryStatus === 'sending' || deliveryStatus === 'sent') return;
    menuVoiceService.stop();

    const targetItem = orderItems[index];
    const updated = orderItems.filter((_, idx) => idx !== index);
    onOrderItemsChange(updated);

    const newTotal = calculateOrderTotal(updated);
    if (updated.length === 0) {
      onAnnounce(`Removed ${targetItem.englishName}. Your order is now empty.`);
    } else {
      onAnnounce(
        `Removed ${targetItem.englishName} from order. Order total is now ${formatNaturalSpokenWon(newTotal)}.`
      );
    }
  };

  const handleAddItemFromMenu = (menuItem: MenuItem) => {
    if (deliveryStatus === 'sending' || deliveryStatus === 'sent') return;
    if (!menuItem.available) return;

    menuVoiceService.stop();

    // Check if item is already in order
    const existingIndex = orderItems.findIndex((i) => i.menuItemId === menuItem.id);
    let updated: OrderItem[];

    if (existingIndex >= 0) {
      updated = orderItems.map((item, idx) =>
        idx === existingIndex ? { ...item, quantity: item.quantity + 1 } : item
      );
    } else {
      updated = [
        ...orderItems,
        {
          menuItemId: menuItem.id,
          englishName: menuItem.englishName,
          koreanName: menuItem.koreanName,
          unitPriceKrw: menuItem.priceKrw,
          quantity: 1,
        },
      ];
    }

    onOrderItemsChange(updated);
    setIsAddingItem(false);

    // Return focus to "Add another item" button
    addItemButtonRef.current?.focus();

    const newTotal = calculateOrderTotal(updated);
    onAnnounce(
      `Added ${menuItem.englishName} to order. Order total is now ${formatNaturalSpokenWon(newTotal)}.`
    );
  };

  const handleCloseAddItemSelector = () => {
    setIsAddingItem(false);
    addItemButtonRef.current?.focus();
  };

  const handleUpdateItemNote = (index: number, note: string) => {
    const trimmed = note.trim();
    const updated = orderItems.map((item, idx) =>
      idx === index ? { ...item, specialRequest: trimmed || undefined } : item
    );
    onOrderItemsChange(updated);
    setEditingItemNoteId(null);
    onAnnounce(trimmed ? `Updated note for ${orderItems[index].englishName}` : `Removed note`);
  };

  // Order receipt is sent directly; no callback polling required
  const handleConfirmAndSend = async () => {
    if (deliveryStatus === 'sending') return; // Guard against double click
    if (orderItems.length === 0) {
      onAnnounce('Cannot send an empty order. Please add items.');
      return;
    }

    setDeliveryStatus('sending');
    setErrorMessage(null);
    menuVoiceService.stop();
    onAnnounce('Sending order to stall owner via Telegram...');

    try {
      const visitorId = getOrCreateVisitorId();
      const response = await fetch('/api/order/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idempotencyKey,
          items: orderItems,
          specialRequest,
          originalTranscript: activeTranscript,
          visitorId,
          tableNumber,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setDeliveryStatus('sent');
        setSubmittedOrder(data.order);
        const orderId = data.order?.publicOrderReference || data.order?.orderId || '';
        const announceMsg = `Order ${orderId} sent successfully to stall owner! Reference number is ${orderId}.`;
        if (onAnnounce) onAnnounce(announceMsg);
        menuVoiceService.speakConfirmation(
          `Your order has been sent to the stall owner. Your order number is ${orderId}.`
        );
      } else if (response.status === 409) {
        // In-flight or duplicate blocked
        setDeliveryStatus('duplicate_blocked');
        setErrorMessage(data.status || data.error || 'This order submission is already being processed.');
        if (onAnnounce) onAnnounce('Duplicate order submission detected.');
      } else {
        setDeliveryStatus('failed');
        setErrorMessage(data.error || data.status || 'Could not reach Telegram stall channel.');
        if (onAnnounce) onAnnounce('Order delivery failed. Please retry.');
      }
    } catch (err: unknown) {
      setDeliveryStatus('failed');
      const errText = err instanceof Error ? err.message : 'Network error';
      setErrorMessage(errText);
      if (onAnnounce) onAnnounce('Network error sending order. Please retry.');
    }
  };

  const handleDone = () => {
    if (submittedOrder) {
      onOrderCompleted(submittedOrder);
    } else {
      onClose();
    }
  };

  if (!isOpen) return null;

  // Filter available menu items
  const availableDishes = (availableMenu || []).filter((item) => item && item.available);
  const totalItemCount = (orderItems || []).reduce((acc, i) => acc + (i?.quantity || 0), 0);

  return (
    <div
      id="order-confirmation-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-order-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto"
    >
      <div className="w-full max-w-lg bg-stone-900 border border-stone-800 rounded-3xl p-5 shadow-2xl text-stone-100 my-auto animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-stone-800 pb-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 id="modal-order-confirm-title" className="text-xl font-black tracking-tight text-white">
                {deliveryStatus === 'sent' ? 'Order Confirmed' : 'Confirm Your Order'}
              </h2>
              {tableNumber && (
                <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 text-xs font-bold border border-amber-500/30">
                  📍 {tableNumber}
                </span>
              )}
            </div>
            <p className="text-xs text-stone-400 mt-0.5">
              {deliveryStatus === 'sent'
                ? 'Your order has been delivered to the food stall owner.'
                : 'Review, adjust quantities, or add items before sending to the stall.'}
            </p>
          </div>
          {deliveryStatus !== 'sending' && (
            <button
              id="btn-close-confirm-modal"
              onClick={deliveryStatus === 'sent' ? handleDone : onClose}
              className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-400 hover:text-white transition-colors"
              aria-label="Close confirmation dialog"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Status Banners */}
        {deliveryStatus === 'sent' && (
          <div
            id="status-banner-sent"
            className="my-3 p-4 rounded-2xl bg-emerald-950/80 border border-emerald-700 text-emerald-200 text-xs flex flex-col gap-2"
            role="status"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-bold text-emerald-400 text-sm">
                <CheckCircle2 className="w-4 h-4" />
                <span>Order sent successfully!</span>
              </div>
              <span className="font-mono text-xs px-2 py-0.5 rounded bg-emerald-900/60 border border-emerald-700 text-emerald-200 font-bold">
                {submittedOrder?.publicOrderReference || submittedOrder?.orderId}
              </span>
            </div>

            {/* Order Receipt Delivery Status */}
            <div className="p-3 rounded-xl bg-stone-900 border border-stone-800 space-y-1.5">
              <div className="text-[11px] font-bold text-stone-400 uppercase tracking-wider flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Order Receipt Delivery:</span>
              </div>

              <div id="receipt-status-delivered" className="flex items-center gap-2.5 text-emerald-300 font-bold text-sm bg-emerald-950/70 p-3 rounded-xl border border-emerald-700/80">
                <ThumbsUp className="w-5 h-5 text-emerald-400 shrink-0" />
                <div>
                  <div className="text-sm font-bold text-emerald-300">Receipt Sent to Stall Bot</div>
                  <div className="text-xs font-normal text-emerald-400/90">주문서 전송 완료 • Saved to Order Transactions</div>
                </div>
              </div>

              {submittedOrder?.ownerNote && (
                <p className="text-[11px] text-stone-300 italic pt-1">
                  Owner Note: "{submittedOrder.ownerNote}"
                </p>
              )}
            </div>

            {submittedOrder?.telegramDelivery?.mode === 'mock' && (
              <span className="text-[10px] text-amber-300/80">
                • Mock Telegram Mode: Receipt output printed to server console.
              </span>
            )}
          </div>
        )}

        {deliveryStatus === 'failed' && (
          <div
            id="status-banner-failed"
            className="my-3 p-3.5 rounded-2xl bg-red-950/90 border border-red-800 text-red-200 text-xs flex flex-col gap-2"
            role="alert"
          >
            <div className="flex items-center gap-2 font-bold text-red-300">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <span>Delivery failed—please try again</span>
            </div>
            <p className="text-stone-300 text-xs">{errorMessage || 'Could not deliver order to stall owner.'}</p>
            <button
              id="btn-retry-telegram"
              onClick={handleConfirmAndSend}
              className="self-start min-h-[44px] px-4 py-2 bg-red-700 hover:bg-red-600 active:scale-95 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Retry sending now</span>
            </button>
          </div>
        )}

        {deliveryStatus === 'duplicate_blocked' && (
          <div
            id="status-banner-duplicate"
            className="my-3 p-3.5 rounded-2xl bg-amber-950 border border-amber-800 text-amber-200 text-xs flex items-center gap-2"
            role="alert"
          >
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Read-back audio control */}
        <div className="my-3 p-3 rounded-2xl bg-stone-950 border border-stone-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Volume2 className={`w-4 h-4 ${isReadingBack ? 'text-amber-400 animate-pulse' : 'text-stone-400'}`} />
            <span className="text-xs text-stone-300">
              {isReadingBack ? 'Speaking order summary aloud...' : 'Voice read-back available'}
            </span>
          </div>
          <button
            id="btn-hear-order-summary"
            onClick={handleReadBackAgain}
            disabled={orderItems.length === 0}
            className="min-h-[44px] px-3 py-1.5 text-xs font-semibold rounded-xl bg-stone-800 hover:bg-stone-700 disabled:opacity-40 text-stone-200 border border-stone-700 transition-colors flex items-center gap-1.5"
            aria-label="Listen to revised order read aloud again"
          >
            <span>Hear again</span>
          </button>
        </div>

        {/* Order Items List */}
        <div className="my-3 border-y border-stone-800 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-stone-400">
              Order Items ({totalItemCount} total)
            </h3>
            {deliveryStatus !== 'sent' && deliveryStatus !== 'sending' && (
              <button
                id="btn-modal-add-item"
                ref={addItemButtonRef}
                onClick={() => setIsAddingItem(!isAddingItem)}
                className="min-h-[44px] px-3 py-1 text-xs font-bold text-amber-400 hover:text-amber-300 bg-amber-950/50 hover:bg-amber-950 border border-amber-800/80 rounded-xl flex items-center gap-1.5 transition-colors"
                aria-label="Add another item from menu to order"
                aria-expanded={isAddingItem}
              >
                <PlusCircle className="w-4 h-4" />
                <span>Add another item</span>
              </button>
            )}
          </div>

          {/* Add Item Dropdown / Selector */}
          {isAddingItem && (
            <div
              id="modal-add-item-selector"
              ref={itemSelectorRef}
              tabIndex={-1}
              className="p-3.5 rounded-2xl bg-stone-950 border border-amber-600/60 shadow-lg space-y-2 animate-in fade-in duration-150"
            >
              <div className="flex items-center justify-between pb-1 border-b border-stone-800">
                <span className="text-xs font-bold text-amber-300">Choose an available dish to add:</span>
                <button
                  onClick={handleCloseAddItemSelector}
                  className="p-1 min-h-[44px] min-w-[44px] flex items-center justify-center text-stone-400 hover:text-stone-200"
                  aria-label="Close dish selector"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {availableDishes.length === 0 ? (
                  <p className="text-xs text-stone-400 py-2">No other dishes currently available.</p>
                ) : (
                  availableDishes.map((dish, idx) => (
                    <button
                      key={dish.id}
                      ref={idx === 0 ? firstAvailableItemRef : undefined}
                      onClick={() => handleAddItemFromMenu(dish)}
                      className="w-full text-left p-2.5 min-h-[44px] rounded-xl bg-stone-900 hover:bg-stone-800 text-stone-100 border border-stone-800 hover:border-amber-500/50 flex items-center justify-between gap-2 transition-colors focus-visible:ring-2 focus-visible:ring-amber-400"
                      aria-label={`Add ${dish.englishName} to order for ${formatNaturalSpokenWon(dish.priceKrw)}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-xs text-white truncate">{dish.englishName}</div>
                        <div className="text-[11px] text-amber-400/90">{dish.koreanName}</div>
                      </div>
                      <span className="font-bold text-xs text-amber-400 shrink-0">
                        {formatDualPrice(dish.priceKrw).krw}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Empty Order State */}
          {orderItems.length === 0 && (
            <div
              id="empty-order-warning"
              className="p-4 rounded-2xl bg-amber-950/70 border border-amber-800 text-amber-200 text-xs font-medium text-center space-y-2"
              role="alert"
            >
              <p className="font-semibold text-amber-100">
                Your order is empty. Add at least one item before sending.
              </p>
              {deliveryStatus !== 'sent' && deliveryStatus !== 'sending' && (
                <button
                  onClick={() => setIsAddingItem(true)}
                  className="min-h-[44px] px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold rounded-xl text-xs inline-flex items-center gap-1.5 shadow"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>Select an item now</span>
                </button>
              )}
            </div>
          )}

          {/* Items with quantity & edit controls */}
          {orderItems.map((item, idx) => {
            const itemSubtotal = item.unitPriceKrw * item.quantity;
            const subtotalDual = formatDualPrice(itemSubtotal);
            const isEditingThisNote = editingItemNoteId === item.menuItemId;

            return (
              <div
                key={`${item.menuItemId}-${idx}`}
                className="p-3 rounded-2xl bg-stone-950 border border-stone-800/90 space-y-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-stone-100 text-sm">{item.englishName}</div>
                    <div className="text-xs text-amber-500/90 font-medium">{item.koreanName}</div>
                    <div className="text-[11px] text-stone-400 mt-0.5">
                      {formatDualPrice(item.unitPriceKrw).krw} each
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="font-bold text-stone-100 text-sm">{subtotalDual.krw}</div>
                    <div className="text-[11px] text-stone-500">{subtotalDual.won}</div>
                  </div>
                </div>

                {/* Item-specific Note */}
                {item.specialRequest && !isEditingThisNote && (
                  <div className="flex items-center justify-between text-xs bg-amber-950/30 border border-amber-900/40 rounded-xl px-2.5 py-1.5 text-amber-200">
                    <span className="italic">Note: "{item.specialRequest}"</span>
                    {deliveryStatus !== 'sending' && deliveryStatus !== 'sent' && (
                      <button
                        onClick={() => setEditingItemNoteId(item.menuItemId)}
                        className="text-[11px] text-amber-400 hover:underline ml-2"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                )}

                {/* Edit Item Note Input */}
                {isEditingThisNote && (
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="text"
                      defaultValue={item.specialRequest || ''}
                      placeholder="e.g. less spicy, no onions"
                      id={`input-item-note-${item.menuItemId}`}
                      aria-label={`Special request for ${item.englishName}`}
                      className="flex-1 text-xs bg-stone-900 border border-amber-600 rounded-xl px-2.5 py-1.5 text-white placeholder-stone-500 focus:outline-none focus:ring-1 focus:ring-amber-400"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleUpdateItemNote(idx, (e.target as HTMLInputElement).value);
                        } else if (e.key === 'Escape') {
                          setEditingItemNoteId(null);
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        const input = document.getElementById(
                          `input-item-note-${item.menuItemId}`
                        ) as HTMLInputElement | null;
                        handleUpdateItemNote(idx, input?.value || '');
                      }}
                      className="min-h-[44px] px-3 text-xs bg-amber-500 text-stone-950 font-bold rounded-xl"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingItemNoteId(null)}
                      className="min-h-[44px] px-2 text-xs text-stone-400 hover:text-stone-200"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Action Row: Quantity Buttons & Remove */}
                {deliveryStatus !== 'sent' && (
                  <div className="flex items-center justify-between pt-1 border-t border-stone-900">
                    {/* Quantity controls */}
                    <div className="flex items-center gap-1 bg-stone-900 rounded-xl p-0.5 border border-stone-800">
                      <button
                        id={`btn-decrease-qty-${item.menuItemId}`}
                        onClick={() => handleDecreaseQuantity(idx)}
                        disabled={deliveryStatus === 'sending'}
                        className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-stone-800 hover:bg-stone-700 active:scale-95 disabled:opacity-40 text-stone-200 transition-colors"
                        aria-label={`Decrease ${item.englishName} quantity`}
                      >
                        <Minus className="w-4 h-4" />
                      </button>

                      <span
                        className="min-w-[32px] text-center font-bold text-sm text-stone-100"
                        aria-live="polite"
                      >
                        {item.quantity}
                      </span>

                      <button
                        id={`btn-increase-qty-${item.menuItemId}`}
                        onClick={() => handleIncreaseQuantity(idx)}
                        disabled={deliveryStatus === 'sending'}
                        className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-stone-800 hover:bg-stone-700 active:scale-95 disabled:opacity-40 text-stone-200 transition-colors"
                        aria-label={`Increase ${item.englishName} quantity`}
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Add note & Remove controls */}
                    <div className="flex items-center gap-2">
                      {!item.specialRequest && !isEditingThisNote && deliveryStatus !== 'sending' && (
                        <button
                          onClick={() => setEditingItemNoteId(item.menuItemId)}
                          className="min-h-[44px] px-2.5 text-xs text-stone-400 hover:text-amber-400 flex items-center gap-1 rounded-xl transition-colors"
                          aria-label={`Add special request note for ${item.englishName}`}
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>Note</span>
                        </button>
                      )}

                      <button
                        id={`btn-remove-item-${item.menuItemId}`}
                        onClick={() => handleRemoveItem(idx)}
                        disabled={deliveryStatus === 'sending'}
                        className="min-h-[44px] px-3 flex items-center gap-1.5 text-xs font-semibold text-red-400 hover:text-red-300 hover:bg-red-950/40 rounded-xl transition-colors disabled:opacity-40"
                        aria-label={`Remove ${item.englishName} from order`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Editable Overall Special Request */}
          {deliveryStatus !== 'sent' ? (
            <div className="mt-2 p-3 rounded-2xl bg-stone-950 border border-stone-800 space-y-1">
              <label
                htmlFor="modal-overall-request"
                className="block text-xs font-bold text-stone-300"
              >
                Overall Special Request (All items):
              </label>
              <input
                id="modal-overall-request"
                type="text"
                value={specialRequest || ''}
                disabled={deliveryStatus === 'sending'}
                onChange={(e) => onSpecialRequestChange(e.target.value)}
                placeholder="e.g. less spicy, no onions, extra napkins"
                className="w-full text-xs bg-stone-900 border border-stone-700 disabled:opacity-50 rounded-xl px-3 py-2 text-white placeholder-stone-500 focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
            </div>
          ) : (
            specialRequest && (
              <div className="mt-2 p-2.5 rounded-xl bg-amber-950/40 border border-amber-900/60 text-xs">
                <span className="font-bold text-amber-300 block mb-0.5">Customer Special Request:</span>
                <span className="text-stone-300 italic">"{specialRequest}"</span>
              </div>
            )
          )}
        </div>

        {/* Deterministic Total Price */}
        <div className="my-3 p-3.5 rounded-2xl bg-stone-950 border border-stone-800 flex items-baseline justify-between">
          <span className="text-sm font-semibold text-stone-400">Total Amount:</span>
          <div className="text-right">
            <span className="text-2xl font-extrabold text-white tracking-tight">
              {totalDual.krw}
            </span>
            <span className="text-xs font-semibold text-stone-400 ml-1.5">
              ({totalDual.won})
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        {deliveryStatus !== 'sent' ? (
          <div className="flex flex-col gap-2 pt-2">
            <button
              id="btn-confirm-and-send"
              onClick={handleConfirmAndSend}
              disabled={deliveryStatus === 'sending' || orderItems.length === 0}
              className="w-full min-h-[48px] py-3 px-4 bg-amber-500 hover:bg-amber-400 active:scale-[0.98] disabled:opacity-50 text-stone-950 font-extrabold rounded-2xl text-base flex items-center justify-center gap-2 shadow-lg transition-all focus-visible:ring-4 focus-visible:ring-amber-400"
              aria-label="Confirm and send order to stall owner"
            >
              <Send className="w-5 h-5" />
              <span>{deliveryStatus === 'sending' ? 'Sending order...' : 'Confirm and send'}</span>
            </button>

            <button
              id="btn-cancel-order"
              onClick={onClose}
              disabled={deliveryStatus === 'sending'}
              className="w-full min-h-[44px] py-2.5 px-3 bg-stone-800 hover:bg-stone-700 text-stone-400 hover:text-stone-200 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 border border-stone-700 transition-colors disabled:opacity-50"
              aria-label="Cancel order and close"
            >
              <XCircle className="w-4 h-4" />
              <span>Cancel</span>
            </button>
          </div>
        ) : (
          <div className="pt-2">
            <button
              id="btn-done-order"
              onClick={handleDone}
              className="w-full min-h-[48px] py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-2xl text-sm flex items-center justify-center gap-2 shadow-md transition-colors"
              aria-label="Back to menu"
            >
              <span>Back to Menu</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
