import React, { useState, useEffect } from 'react';
import {
  Clock,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  X,
  Receipt,
  Calendar,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { Order, VisitorOrderSummary } from '../types';
import { formatDualPrice } from '../lib/orderMath';
import { getOrCreateVisitorId } from '../lib/visitorStorage';

interface VisitorOrderHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReorder?: (order: Order) => void;
}

export const VisitorOrderHistoryModal: React.FC<VisitorOrderHistoryModalProps> = ({
  isOpen,
  onClose,
  onReorder,
}) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<VisitorOrderSummary | null>(null);
  const [filter, setFilter] = useState<'all' | 'today'>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const visitorId = getOrCreateVisitorId();
      const res = await fetch(`/api/orders/visitor?visitorId=${encodeURIComponent(visitorId)}&filter=${filter}`);
      if (!res.ok) throw new Error('Failed to load order history');
      const data = await res.json();
      if (data.success) {
        setOrders(data.orders || []);
        setSummary(data.summary || null);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading history');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchHistory();
    }
  }, [isOpen, filter]);

  if (!isOpen) return null;

  return (
    <div
      id="visitor-history-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="visitor-history-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto"
    >
      <div className="w-full max-w-xl bg-stone-900 border border-stone-800 rounded-3xl p-5 shadow-2xl text-stone-100 my-auto animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-stone-800 pb-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 id="visitor-history-title" className="text-lg font-black tracking-tight text-white flex items-center gap-2">
                <Receipt className="w-5 h-5 text-amber-400" />
                <span>My Past Street Food Orders</span>
              </h2>
            </div>
            <p className="text-xs text-stone-400 mt-0.5">
              Saved persistently to your device. View receipt status and stall owner confirmation.
            </p>
          </div>
          <button
            id="btn-close-visitor-history"
            onClick={onClose}
            className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-400 hover:text-white transition-colors"
            aria-label="Close past orders dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Visitor Summary KPI */}
        {summary && (
          <div className="grid grid-cols-3 gap-2 my-3">
            <div className="p-3 rounded-2xl bg-stone-950 border border-stone-800 text-center">
              <div className="text-[11px] text-stone-400 font-medium">Total Orders</div>
              <div className="text-xl font-black text-amber-400">{summary.totalOrdersCount}</div>
            </div>
            <div className="p-3 rounded-2xl bg-stone-950 border border-stone-800 text-center">
              <div className="text-[11px] text-stone-400 font-medium">Accepted</div>
              <div className="text-xl font-black text-emerald-400">{summary.acceptedOrdersCount}</div>
            </div>
            <div className="p-3 rounded-2xl bg-stone-950 border border-stone-800 text-center">
              <div className="text-[11px] text-stone-400 font-medium">Total Spent</div>
              <div className="text-sm font-black text-white mt-1">
                {formatDualPrice(summary.totalSpentKrw).krw}
              </div>
            </div>
          </div>
        )}

        {/* Filter Toggle */}
        <div className="flex items-center justify-between pb-2">
          <div className="flex items-center gap-1.5 p-1 bg-stone-950 rounded-xl border border-stone-800 text-xs">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1 rounded-lg font-bold transition-colors ${
                filter === 'all' ? 'bg-amber-500 text-stone-950' : 'text-stone-400 hover:text-white'
              }`}
            >
              All Orders
            </button>
            <button
              onClick={() => setFilter('today')}
              className={`px-3 py-1 rounded-lg font-bold transition-colors ${
                filter === 'today' ? 'bg-amber-500 text-stone-950' : 'text-stone-400 hover:text-white'
              }`}
            >
              Today Only
            </button>
          </div>

          <button
            onClick={fetchHistory}
            className="text-xs text-stone-400 hover:text-amber-400 flex items-center gap-1 p-1"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        {/* Orders List Container */}
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {isLoading && orders.length === 0 ? (
            <div className="text-center py-10 text-stone-500 text-xs">Loading order history...</div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-red-950/60 border border-red-800 text-red-200 text-xs text-center">
              {error}
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-12 px-4 rounded-2xl bg-stone-950 border border-stone-800/80">
              <Receipt className="w-10 h-10 text-stone-600 mx-auto mb-2" />
              <div className="text-sm font-bold text-stone-300">No orders placed yet</div>
              <p className="text-xs text-stone-500 mt-1 max-w-xs mx-auto">
                Use the voice ordering button or choose dishes manually to place your first street food order!
              </p>
            </div>
          ) : (
            orders.map((ord) => {
              const totalDual = formatDualPrice(ord.totalKrw);
              const dateStr = new Date(ord.createdAt).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <div
                  key={ord.orderId}
                  className="p-3.5 rounded-2xl bg-stone-950 border border-stone-800 space-y-2.5 hover:border-stone-700 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                          {ord.publicOrderReference || ord.orderId}
                        </span>
                        <span className="text-[11px] text-stone-400 flex items-center gap-1">
                          <Calendar className="w-3 h-3 text-stone-500" />
                          {dateStr}
                        </span>
                      </div>
                    </div>

                    <div className="text-right">
                      <div className="font-black text-white text-sm">{totalDual.krw}</div>
                      <div className="text-[10px] text-stone-500">{totalDual.won}</div>
                    </div>
                  </div>

                  {/* Items snapshot */}
                  <div className="space-y-1 pt-1 border-t border-stone-900">
                    {ord.items.map((it, idx) => (
                      <div key={idx} className="flex justify-between text-xs text-stone-300">
                        <span>
                          {it.quantity}x {it.englishName} ({it.koreanName})
                        </span>
                        <span className="text-stone-400 font-mono">
                          {formatDualPrice(it.unitPriceKrw * it.quantity).krw}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Owner Status pill */}
                  <div className="flex items-center justify-between pt-1">
                    <div className="flex items-center gap-1.5">
                      {ord.ownerAcknowledgement === 'accepted' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded-full border border-emerald-800">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>주문 수락됨 (Accepted)</span>
                        </span>
                      ) : ord.ownerAcknowledgement === 'rejected' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-400 bg-red-950 px-2 py-0.5 rounded-full border border-red-800">
                          <AlertTriangle className="w-3 h-3" />
                          <span>주문 거절됨 (Declined)</span>
                        </span>
                      ) : ord.ownerAcknowledgement === 'item_unavailable' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-400 bg-amber-950 px-2 py-0.5 rounded-full border border-amber-800">
                          <AlertTriangle className="w-3 h-3" />
                          <span>재료 소진 (Item Sold Out)</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-stone-400 bg-stone-900 px-2 py-0.5 rounded-full border border-stone-800">
                          <Clock className="w-3 h-3 text-amber-400" />
                          <span>Sent • Pending Owner Tap</span>
                        </span>
                      )}
                    </div>

                    {onReorder && (
                      <button
                        onClick={() => {
                          onReorder(ord);
                          onClose();
                        }}
                        className="text-xs font-bold text-amber-400 hover:text-amber-300 hover:underline flex items-center gap-1"
                      >
                        <Sparkles className="w-3 h-3" />
                        <span>Order Again</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-stone-800 flex justify-end">
          <button
            onClick={onClose}
            className="w-full sm:w-auto min-h-[44px] px-5 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-white font-bold text-xs transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
