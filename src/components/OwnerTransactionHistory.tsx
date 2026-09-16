import React, { useState, useEffect } from 'react';
import {
  Clock,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Search,
  Receipt,
  ThumbsUp,
  XCircle,
  Ban,
  Send,
  X,
  FileText,
} from 'lucide-react';
import { Order, OwnerSummary, OwnerAcknowledgement } from '../types';
import { formatDualPrice } from '../lib/orderMath';
import { ReceiptModal } from './ReceiptModal';

interface OwnerTransactionHistoryProps {
  ownerLang: 'ko' | 'en';
  onAnnounce: (msg: string) => void;
  ownerPin?: string;
  stallName?: string;
  stallLocation?: string;
}

export const OwnerTransactionHistory: React.FC<OwnerTransactionHistoryProps> = ({
  ownerLang,
  onAnnounce,
  ownerPin = '1234',
  stallName,
  stallLocation,
}) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [summary, setSummary] = useState<OwnerSummary | null>(null);
  const [filter, setFilter] = useState<'today' | '7days' | '30days' | 'all'>('today');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchRef, setSearchRef] = useState<string>('');
  const [includeMock, setIncludeMock] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Modals state
  const [selectedReceiptOrder, setSelectedReceiptOrder] = useState<Order | null>(null);
  const [rejectModalOrder, setRejectModalOrder] = useState<Order | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('재료 소진 (Ingredients sold out)');
  const [customRejectNote, setCustomRejectNote] = useState<string>('');
  const [notifyTelegram, setNotifyTelegram] = useState<boolean>(true);
  const [isRejecting, setIsRejecting] = useState<boolean>(false);
  const [actionFeedback, setActionFeedback] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const t = {
    ko: {
      title: '주문 내역 및 실시간 매출 관리',
      subtitle: 'SQLite 영구 저장소 기반 점주 트랜잭션 기록 및 텔레그램 연동',
      revToday: '오늘 확정 매출',
      ordersToday: '오늘 수락 주문',
      allTimeRev: '총 누적 매출',
      filterToday: '오늘',
      filter7Days: '최근 7일',
      filter30Days: '최근 30일',
      filterAll: '전체 내역',
      statusAll: '모든 상태',
      statusPending: '대기중',
      statusAccepted: '수락됨',
      statusRejected: '거절됨',
      statusUnavailable: '재료소진',
      btnAccept: '수락',
      btnReject: '주문 거절',
      btnReceipt: '영수증',
      searchPlaceholder: '주문 번호 검색 (예: A104)...',
      includeMockLabel: '모의/테스트 주문 포함',
      noOrders: '해당 조건의 주문 내역이 없습니다.',
      refresh: '새로고침',
      rejectModalTitle: '주문 거절 및 텔레그램 알림 전송',
      rejectReasonLabel: '거절 사유 선택',
      customReasonLabel: '상세 사유 (선택 입력)',
      notifyTgLabel: '텔레그램 봇으로 거절 알림 즉시 회신',
      btnCancel: '취소',
      btnConfirmReject: '거절 확정 및 알림 전송',
    },
    en: {
      title: 'Order History & Transaction Ledger',
      subtitle: 'Persistent SQLite ledger of stall orders, real-time revenue, and Telegram actions',
      revToday: "Today's Revenue",
      ordersToday: "Today's Accepted Orders",
      allTimeRev: 'All-Time Revenue',
      filterToday: 'Today',
      filter7Days: '7 Days',
      filter30Days: '30 Days',
      filterAll: 'All Time',
      statusAll: 'All Statuses',
      statusPending: 'Pending',
      statusAccepted: 'Accepted',
      statusRejected: 'Declined',
      statusUnavailable: 'Unavailable',
      btnAccept: 'Accept',
      btnReject: 'Reject',
      btnReceipt: 'Receipt',
      searchPlaceholder: 'Search order reference (e.g. A104)...',
      includeMockLabel: 'Include demo/mock orders',
      noOrders: 'No orders found matching this criteria.',
      refresh: 'Refresh',
      rejectModalTitle: 'Reject Order & Send Telegram Reply',
      rejectReasonLabel: 'Select Rejection Reason',
      customReasonLabel: 'Additional Note (Optional)',
      notifyTgLabel: 'Send instant reply notification to Telegram bot',
      btnCancel: 'Cancel',
      btnConfirmReject: 'Confirm Rejection & Send Reply',
    },
  }[ownerLang];

  const fetchOrders = async () => {
    setIsLoading(true);
    try {
      const queryParams = new URLSearchParams({
        filter,
        status: statusFilter,
        reference: searchRef.trim(),
        includeMock: String(includeMock),
        limit: '50',
      });

      const res = await fetch(`/api/owner/orders?${queryParams.toString()}`);
      if (!res.ok) throw new Error('Failed to load transaction history');
      const data = await res.json();
      if (data.success) {
        setOrders(data.orders || []);
        setSummary(data.summary || null);
      }
    } catch (err) {
      console.error('Error fetching owner orders:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [filter, statusFilter, includeMock]);

  const handleUpdateAck = async (
    orderId: string,
    ack: OwnerAcknowledgement,
    note?: string,
    sendTg: boolean = true
  ) => {
    setActionInProgress(orderId);
    setActionFeedback(null);
    try {
      const res = await fetch(`/api/order/${orderId}/acknowledge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Owner-Pin': ownerPin || '1234',
        },
        body: JSON.stringify({
          acknowledgement: ack,
          note,
          force: true,
          notifyTelegram: sendTg,
        }),
      });
      const data = await res.json();
      if (data.success) {
        const statusText = ack === 'rejected' ? 'rejected' : ack;
        const msg = `Order ${orderId} updated to ${statusText}. Telegram reply: ${data.telegramSent ? 'Sent' : 'Mocked'}`;
        setActionFeedback({ text: msg, type: 'success' });
        onAnnounce(`Order updated to ${statusText}`);
        fetchOrders();
      } else {
        setActionFeedback({
          text: data.error || 'Failed to update order status',
          type: 'error',
        });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Network error';
      setActionFeedback({ text: errMsg, type: 'error' });
      console.error('Failed to acknowledge order:', err);
    } finally {
      setActionInProgress(null);
    }
  };

  const openRejectModal = (order: Order) => {
    setRejectModalOrder(order);
    setRejectReason('재료 소진 (Ingredients sold out)');
    setCustomRejectNote('');
    setNotifyTelegram(true);
  };

  const handleConfirmReject = async () => {
    if (!rejectModalOrder) return;
    setIsRejecting(true);
    const finalReason = customRejectNote.trim()
      ? `${rejectReason} - ${customRejectNote.trim()}`
      : rejectReason;

    await handleUpdateAck(rejectModalOrder.orderId, 'rejected', finalReason, notifyTelegram);
    setIsRejecting(false);
    setRejectModalOrder(null);
  };

  return (
    <div id="owner-transaction-history" className="bg-white rounded-3xl p-5 sm:p-6 border border-stone-200 shadow-sm space-y-6">
      {/* Header & Refresh */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-stone-100 pb-4">
        <div>
          <h3 className="text-lg font-bold text-stone-900 flex items-center gap-2">
            <Receipt className="w-5 h-5 text-amber-500" />
            <span>{t.title}</span>
          </h3>
          <p className="text-xs text-stone-500">{t.subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-stone-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeMock}
              onChange={(e) => setIncludeMock(e.target.checked)}
              className="rounded text-amber-500 focus:ring-amber-400"
            />
            <span>{t.includeMockLabel}</span>
          </label>

          <button
            onClick={fetchOrders}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 font-semibold text-xs transition-colors"
          >
            <RotateCcw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>{t.refresh}</span>
          </button>
        </div>
      </div>

      {/* Action feedback banner */}
      {actionFeedback && (
        <div
          className={`p-3 rounded-2xl text-xs font-semibold flex items-center justify-between ${
            actionFeedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
              : 'bg-red-50 text-red-800 border border-red-200'
          }`}
        >
          <span>{actionFeedback.text}</span>
          <button
            onClick={() => setActionFeedback(null)}
            className="text-stone-400 hover:text-stone-600 p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Revenue & Order Metrics (3-column layout without waiting box) */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-4 rounded-2xl bg-amber-50/70 border border-amber-200">
            <div className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">{t.revToday}</div>
            <div className="text-xl font-black text-amber-950 mt-1">
              {formatDualPrice(summary.revenueTodayKrw).krw}
            </div>
            <div className="text-[10px] text-amber-700">{formatDualPrice(summary.revenueTodayKrw).won}</div>
          </div>

          <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200">
            <div className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">{t.ordersToday}</div>
            <div className="text-2xl font-black text-emerald-950 mt-1">
              {summary.acceptedOrdersToday} <span className="text-xs font-normal text-emerald-700">orders</span>
            </div>
          </div>

          <div className="p-4 rounded-2xl bg-stone-100 border border-stone-200">
            <div className="text-[11px] font-bold text-stone-600 uppercase tracking-wider">{t.allTimeRev}</div>
            <div className="text-xl font-black text-stone-900 mt-1">
              {formatDualPrice(summary.allTimeRevenueKrw).krw}
            </div>
            <div className="text-[10px] text-stone-500">
              {summary.totalOrdersCount} total orders logged
            </div>
          </div>
        </div>
      )}

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        {/* Date range filter */}
        <div className="flex items-center gap-1 p-1 bg-stone-100 rounded-xl border border-stone-200 text-xs font-medium">
          {(['today', '7days', '30days', 'all'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setFilter(r)}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                filter === r ? 'bg-white text-stone-900 shadow-xs font-bold' : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              {r === 'today'
                ? t.filterToday
                : r === '7days'
                ? t.filter7Days
                : r === '30days'
                ? t.filter30Days
                : t.filterAll}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-xs font-semibold px-3 py-2 rounded-xl bg-stone-50 border border-stone-200 text-stone-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
        >
          <option value="all">{t.statusAll}</option>
          <option value="pending">{t.statusPending}</option>
          <option value="accepted">{t.statusAccepted}</option>
          <option value="rejected">{t.statusRejected}</option>
          <option value="item_unavailable">{t.statusUnavailable}</option>
        </select>

        {/* Search by reference */}
        <div className="flex-1 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-3" />
            <input
              type="text"
              value={searchRef}
              onChange={(e) => setSearchRef(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && fetchOrders()}
              placeholder={t.searchPlaceholder}
              className="w-full text-xs pl-8 pr-3 py-2 rounded-xl border border-stone-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
          <button
            onClick={fetchOrders}
            className="px-3 py-2 bg-stone-900 text-white rounded-xl text-xs font-bold hover:bg-stone-800"
          >
            Go
          </button>
        </div>
      </div>

      {/* Orders Table */}
      <div className="overflow-x-auto border border-stone-200 rounded-2xl">
        <table className="w-full text-left text-xs text-stone-700">
          <thead className="bg-stone-50 text-stone-500 uppercase tracking-wider text-[11px] border-b border-stone-200">
            <tr>
              <th className="px-4 py-3 font-bold">Order Ref</th>
              <th className="px-4 py-3 font-bold">Date & Time</th>
              <th className="px-4 py-3 font-bold">Ordered Dishes</th>
              <th className="px-4 py-3 font-bold text-right">Total Amount</th>
              <th className="px-4 py-3 font-bold text-center">Status</th>
              <th className="px-4 py-3 font-bold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {orders.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-stone-400">
                  {t.noOrders}
                </td>
              </tr>
            ) : (
              orders.map((ord) => {
                const totalDual = formatDualPrice(ord.totalKrw);
                const isBusy = actionInProgress === ord.orderId;
                const isRejected = ord.ownerAcknowledgement === 'rejected';

                return (
                  <tr key={ord.orderId} className="hover:bg-stone-50/60 transition-colors">
                    {/* Order Reference */}
                    <td className="px-4 py-3 font-mono font-bold text-stone-900 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span>{ord.publicOrderReference || ord.orderId}</span>
                        {ord.isMockDemo && (
                          <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 border border-amber-200">
                            MOCK
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Date */}
                    <td className="px-4 py-3 text-stone-500 whitespace-nowrap text-[11px]">
                      {new Date(ord.createdAt).toLocaleString([], {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>

                    {/* Dishes summary */}
                    <td className="px-4 py-3 max-w-xs">
                      <div className="font-semibold text-stone-900 truncate">
                        {ord.items.map((it) => `${it.quantity}x ${it.koreanName}`).join(', ')}
                      </div>
                      <div className="text-[11px] text-stone-400 truncate">
                        {ord.items.map((it) => `${it.quantity}x ${it.englishName}`).join(', ')}
                      </div>
                      {ord.koreanTranslation?.specialRequestsKorean && (
                        <div className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded mt-0.5 inline-block">
                          요청: {ord.koreanTranslation.specialRequestsKorean}
                        </div>
                      )}
                      {ord.ownerNote && (
                        <div className="text-[10px] text-red-700 bg-red-50 px-1.5 py-0.5 rounded mt-0.5 block truncate">
                          사유: {ord.ownerNote}
                        </div>
                      )}
                    </td>

                    {/* Amount */}
                    <td className="px-4 py-3 text-right font-black text-stone-900 whitespace-nowrap">
                      {totalDual.krw}
                    </td>

                    {/* Status badge */}
                    <td className="px-4 py-3 text-center whitespace-nowrap">
                      {ord.ownerAcknowledgement === 'accepted' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>{t.statusAccepted}</span>
                        </span>
                      ) : ord.ownerAcknowledgement === 'rejected' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-red-700 bg-red-100 px-2.5 py-1 rounded-full">
                          <XCircle className="w-3 h-3 text-red-600" />
                          <span>{t.statusRejected}</span>
                        </span>
                      ) : ord.ownerAcknowledgement === 'item_unavailable' ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-100 px-2.5 py-1 rounded-full">
                          <AlertTriangle className="w-3 h-3 text-amber-600" />
                          <span>{t.statusUnavailable}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-stone-700 bg-stone-100 px-2.5 py-1 rounded-full">
                          <Clock className="w-3 h-3 text-stone-500" />
                          <span>{t.statusPending}</span>
                        </span>
                      )}
                    </td>

                    {/* Actions: View Receipt & Reject/Accept */}
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* View Receipt Button */}
                        <button
                          id={`btn-view-receipt-${ord.orderId}`}
                          onClick={() => setSelectedReceiptOrder(ord)}
                          className="px-2.5 py-1.5 text-xs bg-stone-100 hover:bg-amber-100 text-stone-700 hover:text-amber-900 rounded-xl font-bold flex items-center gap-1 transition-colors border border-stone-200"
                          title="View Receipt"
                        >
                          <FileText className="w-3.5 h-3.5 text-amber-600" />
                          <span>{t.btnReceipt}</span>
                        </button>

                        {/* Accept Button (if not accepted) */}
                        {ord.ownerAcknowledgement !== 'accepted' && (
                          <button
                            id={`btn-accept-order-${ord.orderId}`}
                            onClick={() => handleUpdateAck(ord.orderId, 'accepted')}
                            disabled={isBusy}
                            className="p-1.5 px-2 text-xs bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition-colors flex items-center gap-1"
                            title="Accept Order"
                          >
                            <ThumbsUp className="w-3.5 h-3.5" />
                            <span className="hidden md:inline">{t.btnAccept}</span>
                          </button>
                        )}

                        {/* Reject Order Button */}
                        <button
                          id={`btn-reject-order-${ord.orderId}`}
                          onClick={() => openRejectModal(ord)}
                          disabled={isBusy}
                          className={`p-1.5 px-2 text-xs rounded-xl font-bold transition-colors flex items-center gap-1 border ${
                            isRejected
                              ? 'bg-red-50 text-red-600 border-red-200 hover:bg-red-100'
                              : 'bg-stone-100 hover:bg-red-600 hover:text-white text-stone-700 border-stone-200'
                          }`}
                          title="Reject Order & Reply via Telegram"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span>{isRejected ? (ownerLang === 'ko' ? '사유 수정' : 'Edit Note') : t.btnReject}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Reject Order Dialog Modal */}
      {rejectModalOrder && (
        <div
          id="reject-order-modal-backdrop"
          className="fixed inset-0 z-50 bg-stone-950/70 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-stone-200 space-y-4">
            <div className="flex items-start justify-between border-b border-stone-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-red-100 text-red-600 flex items-center justify-center font-bold">
                  <Ban className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-stone-900">
                    {t.rejectModalTitle}
                  </h3>
                  <p className="text-xs text-stone-500 font-mono">
                    Order Ref: #{rejectModalOrder.publicOrderReference || rejectModalOrder.orderId}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setRejectModalOrder(null)}
                className="text-stone-400 hover:text-stone-600 p-1 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Order Items Preview */}
            <div className="p-3 bg-stone-50 rounded-2xl border border-stone-200 text-xs space-y-1">
              <div className="font-bold text-stone-800">
                {rejectModalOrder.items.map((it) => `${it.quantity}x ${it.koreanName}`).join(', ')}
              </div>
              <div className="text-stone-500 flex justify-between">
                <span>Total:</span>
                <span className="font-bold text-stone-900">
                  {formatDualPrice(rejectModalOrder.totalKrw).krw}
                </span>
              </div>
            </div>

            {/* Rejection reason options */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-stone-700 block">
                {t.rejectReasonLabel}
              </label>
              <div className="grid grid-cols-1 gap-1.5">
                {[
                  '재료 소진 (Ingredients sold out)',
                  '영업 마감 / 준비 중 (Stall closed / prep time)',
                  '특수 조리 요청사항 반영 불가 (Cannot fulfill special request)',
                  '점포 주문 한도 초과 (Stall queue capacity exceeded)',
                  '기타 사유 (Other reason)',
                ].map((reasonOption) => (
                  <button
                    key={reasonOption}
                    type="button"
                    onClick={() => setRejectReason(reasonOption)}
                    className={`text-left px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                      rejectReason === reasonOption
                        ? 'bg-red-50 text-red-900 border-red-300 ring-1 ring-red-400'
                        : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
                    }`}
                  >
                    {reasonOption}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom note textarea */}
            <div className="space-y-1">
              <label className="text-xs font-bold text-stone-700 block">
                {t.customReasonLabel}
              </label>
              <input
                type="text"
                value={customRejectNote}
                onChange={(e) => setCustomRejectNote(e.target.value)}
                placeholder="예: 떡볶이 떡 소진으로 김밥만 가능합니다."
                className="w-full text-xs px-3 py-2 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            {/* Notify via Telegram toggle */}
            <div className="p-3 bg-stone-100 rounded-2xl flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-blue-600 shrink-0" />
                <span className="text-xs text-stone-800 font-semibold">
                  {t.notifyTgLabel}
                </span>
              </div>
              <input
                type="checkbox"
                checked={notifyTelegram}
                onChange={(e) => setNotifyTelegram(e.target.checked)}
                className="rounded text-red-600 focus:ring-red-500"
              />
            </div>

            {/* Modal actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setRejectModalOrder(null)}
                disabled={isRejecting}
                className="px-4 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-xs transition-colors"
              >
                {t.btnCancel}
              </button>
              <button
                type="button"
                id="btn-confirm-reject-order"
                onClick={handleConfirmReject}
                disabled={isRejecting}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs transition-colors flex items-center gap-1.5 shadow-xs"
              >
                <Ban className="w-3.5 h-3.5" />
                <span>{isRejecting ? 'Processing...' : t.btnConfirmReject}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Receipt Modal */}
      <ReceiptModal
        isOpen={Boolean(selectedReceiptOrder)}
        onClose={() => setSelectedReceiptOrder(null)}
        order={selectedReceiptOrder}
        stallName={stallName}
        stallLocation={stallLocation}
      />
    </div>
  );
};

