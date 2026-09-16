import React, { useState } from 'react';
import {
  X,
  Printer,
  Copy,
  Check,
  Receipt,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Send,
  Store,
} from 'lucide-react';
import { Order } from '../types';
import { formatDualPrice, formatNaturalSpokenWon } from '../lib/orderMath';

interface ReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
  stallName?: string;
  stallLocation?: string;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  isOpen,
  onClose,
  order,
  stallName = '종로 포장마차 (Jongno K-Street Food)',
  stallLocation = 'Gwangjang Market, Stall #42, Seoul',
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen || !order) return null;

  const totalDual = formatDualPrice(order.totalKrw);
  const spokenWon = formatNaturalSpokenWon(order.totalKrw);
  const totalUsd = `~$${(order.totalKrw / 1300).toFixed(2)} USD`;
  const orderRef = order.publicOrderReference || order.orderId;
  const isAccepted = order.ownerAcknowledgement === 'accepted';
  const isRejected = order.ownerAcknowledgement === 'rejected';
  const isUnavailable = order.ownerAcknowledgement === 'item_unavailable';

  const orderDate = new Date(order.createdAt).toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const handlePrint = () => {
    window.print();
  };

  const handleCopyText = () => {
    const lines = [
      `=================================`,
      `       ${stallName}`,
      `       ${stallLocation}`,
      `=================================`,
      `ORDER RECEIPT / 주문 영수증`,
      `Order Ref: #${orderRef}`,
      `Date/Time: ${orderDate}`,
      `Status: ${order.ownerAcknowledgement?.toUpperCase() || 'ACCEPTED'}`,
      `---------------------------------`,
      ...order.items.map(
        (it) =>
          `${it.koreanName} (${it.englishName}) x${it.quantity}\n  ₩${(it.unitPriceKrw * it.quantity).toLocaleString()} (~$${((it.unitPriceKrw * it.quantity) / 1300).toFixed(2)})`
      ),
      `---------------------------------`,
      `TOTAL AMOUNT: ${totalDual.krw} (${totalDual.won}, ${totalUsd})`,
      `SPOKEN WON: ${spokenWon}`,
      order.koreanTranslation?.specialRequestsKorean
        ? `Special Request: ${order.koreanTranslation.specialRequestsKorean}`
        : '',
      order.ownerNote ? `Owner Note: ${order.ownerNote}` : '',
      `=================================`,
      `Thank you! 감사합니다.`,
      `=================================`,
    ]
      .filter(Boolean)
      .join('\n');

    navigator.clipboard.writeText(lines);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      id="receipt-modal-backdrop"
      className="fixed inset-0 z-50 bg-stone-950/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="receipt-modal-title"
    >
      <div
        id="receipt-paper"
        className="bg-stone-50 border border-stone-200 rounded-3xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col my-auto"
      >
        {/* Modal Top Control Bar */}
        <div className="bg-stone-900 text-stone-200 px-5 py-3.5 flex items-center justify-between border-b border-stone-800">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-amber-400" />
            <span id="receipt-modal-title" className="text-xs font-bold uppercase tracking-wider text-amber-300">
              Stall Order Receipt
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              id="btn-copy-receipt-text"
              onClick={handleCopyText}
              className="px-2.5 py-1 text-xs rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 font-semibold flex items-center gap-1 transition-colors"
              title="Copy receipt as text"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button
              id="btn-print-receipt"
              onClick={handlePrint}
              className="px-2.5 py-1 text-xs rounded-lg bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold flex items-center gap-1 transition-colors"
              title="Print receipt"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print</span>
            </button>
            <button
              id="btn-close-receipt-modal"
              onClick={onClose}
              className="p-1 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800 transition-colors ml-1"
              aria-label="Close receipt"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable / Viewable Receipt Paper Area */}
        <div className="p-6 space-y-4 bg-white text-stone-800 font-sans">
          {/* Stall Header */}
          <div className="text-center pb-3 border-b-2 border-dashed border-stone-300 space-y-1">
            <div className="flex items-center justify-center gap-1.5 text-stone-900 font-black text-lg">
              <Store className="w-5 h-5 text-amber-600" />
              <span>{stallName}</span>
            </div>
            <p className="text-xs text-stone-500">{stallLocation}</p>
            <div className="text-[10px] text-stone-400 tracking-widest uppercase font-mono">
              ★ OFFICIAL STREET ORDER TICKET ★
            </div>
          </div>

          {/* Reference & Time Row */}
          <div className="flex items-center justify-between py-1 text-xs border-b border-stone-200">
            <div>
              <span className="text-stone-400 text-[10px] uppercase block font-semibold">Order Ref</span>
              <span className="font-mono font-extrabold text-stone-950 text-base">#{orderRef}</span>
            </div>
            <div className="text-right">
              <span className="text-stone-400 text-[10px] uppercase block font-semibold">Date & Time</span>
              <span className="font-mono text-stone-600 text-xs">{orderDate}</span>
            </div>
          </div>

          {/* Status Badge Banner */}
          <div className="flex items-center justify-between p-2.5 rounded-xl bg-stone-50 border border-stone-200 text-xs">
            <span className="text-stone-500 font-semibold">Order Status:</span>
            {isAccepted && (
              <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-100/80 px-2.5 py-0.5 rounded-full">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Accepted / 접수 완료</span>
              </span>
            )}
            {isRejected && (
              <span className="inline-flex items-center gap-1 font-bold text-red-700 bg-red-100 px-2.5 py-0.5 rounded-full">
                <XCircle className="w-3.5 h-3.5 text-red-600" />
                <span>Declined / 주문 거절</span>
              </span>
            )}
            {isUnavailable && (
              <span className="inline-flex items-center gap-1 font-bold text-amber-700 bg-amber-100 px-2.5 py-0.5 rounded-full">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                <span>Item Unavailable / 품절</span>
              </span>
            )}
            {!isAccepted && !isRejected && !isUnavailable && (
              <span className="inline-flex items-center gap-1 font-bold text-stone-700 bg-stone-200 px-2.5 py-0.5 rounded-full">
                <Clock className="w-3.5 h-3.5 text-stone-500" />
                <span>{order.ownerAcknowledgement?.toUpperCase() || 'SENT'}</span>
              </span>
            )}
          </div>

          {/* Rejection Note Warning if present */}
          {order.ownerNote && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800 space-y-0.5">
              <div className="font-bold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                <span>점주 전달 사유 / Owner Note:</span>
              </div>
              <p className="text-red-700 pl-4">{order.ownerNote}</p>
            </div>
          )}

          {/* Ordered Line Items Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] font-bold text-stone-400 uppercase tracking-wider pb-1 border-b border-stone-200">
              <span>Item & Description</span>
              <span className="text-right">Qty / Price</span>
            </div>

            <div className="divide-y divide-stone-100 space-y-2 pt-1">
              {order.items.map((it, idx) => {
                const linePrice = it.unitPriceKrw * it.quantity;
                const lineDual = formatDualPrice(linePrice);
                return (
                  <div key={idx} className="pt-2 flex items-start justify-between gap-3 text-xs">
                    <div className="space-y-0.5">
                      <div className="font-bold text-stone-900 flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-mono flex items-center justify-center font-extrabold shrink-0">
                          {it.quantity}x
                        </span>
                        <span>{it.koreanName}</span>
                      </div>
                      <div className="text-stone-500 text-[11px] pl-6.5">{it.englishName}</div>
                      {it.specialRequest && (
                        <div className="pl-6.5 text-[10px] text-amber-700 font-semibold">
                          요청: {it.specialRequest}
                        </div>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      <div className="font-mono font-bold text-stone-900">{lineDual.krw}</div>
                      <div className="text-[10px] text-stone-400">~${((it.unitPriceKrw * it.quantity) / 1300).toFixed(2)} USD</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Special Requests Banner */}
          {order.koreanTranslation?.specialRequestsKorean && (
            <div className="p-3 rounded-2xl bg-amber-50/80 border border-amber-200 text-xs text-amber-950 space-y-1">
              <span className="font-bold text-amber-900 block text-[11px] uppercase tracking-wider">
                🍳 조리 요청 사항 (Special Request)
              </span>
              <p className="font-bold text-sm text-stone-900">
                "{order.koreanTranslation.specialRequestsKorean}"
              </p>
              {order.originalTranscript && (
                <p className="text-[11px] text-stone-500">
                  Original: "{order.originalTranscript}"
                </p>
              )}
            </div>
          )}

          {/* Pricing Totals Section */}
          <div className="pt-3 border-t-2 border-dashed border-stone-300 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-stone-500">
              <span>Subtotal</span>
              <span className="font-mono">{totalDual.krw}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-stone-500">
              <span>Tax / Service (VAT included)</span>
              <span className="font-mono">₩0</span>
            </div>

            <div className="flex items-baseline justify-between pt-2 border-t border-stone-200">
              <span className="text-sm font-extrabold text-stone-950 uppercase tracking-wider">
                Total Amount / 총액
              </span>
              <div className="text-right">
                <span className="text-xl font-black text-amber-700">{totalDual.krw}</span>
                <span className="text-xs text-stone-400 block font-normal">{totalUsd}</span>
              </div>
            </div>

            {/* Natural Spoken Korean */}
            <div className="mt-2 p-2.5 rounded-xl bg-stone-100 text-center space-y-0.5">
              <span className="text-[10px] text-stone-500 uppercase font-semibold tracking-wider block">
                Spoken Korean won amount
              </span>
              <div className="font-bold text-stone-900 text-sm">
                "{spokenWon}"
              </div>
              <div className="text-[11px] text-stone-500 font-mono">
                {totalDual.won}
              </div>
            </div>
          </div>

          {/* Delivery & Dispatch Meta */}
          <div className="pt-3 border-t border-stone-100 flex items-center justify-between text-[10px] text-stone-400">
            <div className="flex items-center gap-1">
              <Send className="w-3 h-3 text-stone-400" />
              <span>Telegram Bot Receipt:</span>
              <strong className="text-stone-600">
                {order.telegramDelivery?.mode === 'live' ? 'Live Chat' : 'Simulated Delivery'}
              </strong>
            </div>
            <span className="font-mono">Ref: {order.orderId.slice(-8)}</span>
          </div>

          {/* Barcode Graphic & Footer */}
          <div className="text-center pt-2 space-y-1">
            <div className="h-6 w-48 mx-auto flex items-stretch justify-between px-2 bg-stone-900 rounded-sm opacity-80">
              {Array.from({ length: 28 }).map((_, i) => (
                <div
                  key={i}
                  className={`bg-white ${i % 3 === 0 ? 'w-1' : i % 5 === 0 ? 'w-1.5' : 'w-0.5'}`}
                />
              ))}
            </div>
            <div className="text-[10px] font-mono text-stone-400 tracking-wider">
              *{orderRef}*
            </div>
            <p className="text-xs text-stone-600 font-semibold pt-1">
              감사합니다! 맛있게 드세요. (Enjoy your meal!)
            </p>
          </div>
        </div>

        {/* Modal Bottom Actions */}
        <div className="p-4 bg-stone-100 border-t border-stone-200 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white hover:bg-stone-200 border border-stone-300 text-stone-700 font-bold text-xs transition-colors"
          >
            Close Receipt
          </button>
        </div>
      </div>
    </div>
  );
};
