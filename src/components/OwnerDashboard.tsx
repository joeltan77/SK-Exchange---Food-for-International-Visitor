import React, { useState } from 'react';
import {
  Plus,
  Trash2,
  CheckCircle2,
  FileText,
  QrCode,
  Globe,
  Lock,
  Eye,
  Save,
  Send,
  AlertTriangle,
  DollarSign,
  Info,
} from 'lucide-react';
import { generateQrCodeDataUrl } from '../lib/qrCode';
import { MenuItem, StallMenu, TelegramConfigStatus } from '../types';
import { OwnerTransactionHistory } from './OwnerTransactionHistory';
import { QrCodeManagerModal } from './QrCodeManagerModal';

interface OwnerDashboardProps {
  currentMenu: StallMenu;
  onMenuUpdated: (updatedMenu: StallMenu) => void;
  onPreviewVisitor: () => void;
  telegramStatus: TelegramConfigStatus | null;
  onOpenTelegramSetup: () => void;
  onAnnounce: (msg: string) => void;
}

export const OwnerDashboard: React.FC<OwnerDashboardProps> = ({
  currentMenu,
  onMenuUpdated,
  onPreviewVisitor,
  telegramStatus,
  onOpenTelegramSetup,
  onAnnounce,
}) => {
  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);

  // UI Language toggle: 'ko' (default for owner) or 'en'
  const [ownerLang, setOwnerLang] = useState<'ko' | 'en'>('ko');

  // Working items (draft or active)
  const [editableItems, setEditableItems] = useState<MenuItem[]>(() =>
    JSON.parse(JSON.stringify(currentMenu.items))
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // QR Code state
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);

  // Dictionary for Owner UI bilingual toggle
  const t = {
    ko: {
      ownerTitle: '점주 관리자 대시보드',
      ownerSubtitle: '메뉴 및 가격 관리, 텔레그램 실시간 주문 연동',
      authPrompt: '점주 인증 PIN 번호를 입력해주세요',
      pinPlaceholder: 'PIN 번호 입력 (기본: 1234)',
      unlockBtn: '대시보드 접속',
      wrongPin: '잘못된 PIN 번호입니다. 기본 번호는 1234입니다.',
      reviewTitle: '메뉴 항목 및 가격 관리',
      reviewDesc: '메뉴명, 영어 번역, 가격 및 판매 상태를 설정하고 고객 화면에 발행하세요.',
      addItem: '메뉴 항목 직접 추가',
      colKorean: '한국어 메뉴명',
      colEnglish: '영어 번역',
      colPrice: '가격 (원)',
      colStatus: '상태',
      colActions: '삭제',
      available: '판매중',
      soldOut: '품절',
      saveDraft: '임시저장',
      publishMenu: '메뉴 최종 발행 (고객 화면 적용)',
      previewBtn: '외국인 고객 화면 미리보기',
      qrBtn: '방문객 QR코드 생성',
      telegramConnected: '텔레그램 연동 상태',
      mockModeNotice: '모의 모드 (테스트용)',
      liveModeNotice: '실시간 주문 수신 활성화',
      manageTelegram: '텔레그램 설정',
      needsConfBadge: '확인 필요',
      saveSuccess: '메뉴가 성공적으로 저장 및 발행되었습니다!',
    },
    en: {
      ownerTitle: 'Stall Owner Management Dashboard',
      ownerSubtitle: 'Manage menu dishes, prices, and configure Telegram kitchen orders',
      authPrompt: 'Enter Stall Owner PIN to access dashboard',
      pinPlaceholder: 'Enter PIN (default: 1234)',
      unlockBtn: 'Unlock Dashboard',
      wrongPin: 'Incorrect PIN. Default is 1234.',
      reviewTitle: 'Menu Items & Pricing',
      reviewDesc: 'Manage dish names, English translations, prices, and availability before publishing.',
      addItem: 'Add Menu Item Manually',
      colKorean: 'Korean Name',
      colEnglish: 'English Translation',
      colPrice: 'Price (KRW)',
      colStatus: 'Status',
      colActions: 'Actions',
      available: 'Available',
      soldOut: 'Sold Out',
      saveDraft: 'Save Draft',
      publishMenu: 'Publish Menu to Visitors',
      previewBtn: 'Preview Visitor Screen',
      qrBtn: 'Generate QR Code & Link',
      telegramConnected: 'Telegram Status',
      mockModeNotice: 'Mock Mode (Safe testing)',
      liveModeNotice: 'Live Telegram delivery active',
      manageTelegram: 'Telegram Setup',
      needsConfBadge: 'Needs Confirmation',
      saveSuccess: 'Menu saved and published successfully!',
    },
  }[ownerLang];

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    try {
      const response = await fetch('/api/owner/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinInput }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        setIsAuthenticated(true);
        onAnnounce('Owner dashboard authenticated.');
      } else {
        setAuthError(data.message || t.wrongPin);
      }
    } catch (err) {
      setAuthError('Connection error during authentication.');
    }
  };

  const handleItemChange = (id: string, field: keyof MenuItem, value: any) => {
    setEditableItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const handleAddItem = () => {
    const newItem: MenuItem = {
      id: `item_manual_${Date.now()}`,
      koreanName: '새 메뉴',
      englishName: 'New Dish',
      priceKrw: 5000,
      confidence: 1.0,
      needsConfirmation: false,
      available: true,
      category: 'Special',
    };
    setEditableItems((prev) => [...prev, newItem]);
    onAnnounce('Added a new menu item row');
  };

  const handleRemoveItem = (id: string) => {
    setEditableItems((prev) => prev.filter((i) => i.id !== id));
    onAnnounce('Removed menu item');
  };

  const handleSaveMenu = async (publish: boolean) => {
    setIsSaving(true);
    setSaveSuccessMsg(null);

    try {
      const response = await fetch('/api/menu', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: editableItems,
          publish,
          stallName: currentMenu.stallName,
          stallLocation: currentMenu.stallLocation,
        }),
      });

      const data = await response.json();
      if (response.ok && data.success) {
        if (publish && data.menu) {
          onMenuUpdated(data.menu);
          setSaveSuccessMsg(t.saveSuccess);
          onAnnounce('Menu successfully published to visitors!');
        } else {
          setSaveSuccessMsg('Draft saved successfully.');
          onAnnounce('Draft saved.');
        }
        setTimeout(() => setSaveSuccessMsg(null), 4000);
      }
    } catch (err) {
      console.error('Save menu error:', err);
      alert('Failed to save menu changes.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerateQr = async () => {
    const visitorUrl = window.location.origin;
    const dataUrl = await generateQrCodeDataUrl(visitorUrl);
    setQrCodeUrl(dataUrl);
    setShowQrModal(true);
  };

  // ----------------------------------------------------
  // GATED AUTHENTICATION VIEW
  // ----------------------------------------------------
  if (!isAuthenticated) {
    return (
      <div id="owner-auth-container" className="max-w-md mx-auto my-12 p-6 bg-white rounded-3xl border border-stone-200 shadow-xl text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center mb-4">
          <Lock className="w-7 h-7" />
        </div>
        <h2 className="text-xl font-bold text-stone-900 mb-1">{t.ownerTitle}</h2>
        <p className="text-xs text-stone-500 mb-6">{t.authPrompt}</p>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label htmlFor="owner-pin-input" className="sr-only">
              PIN
            </label>
            <input
              id="owner-pin-input"
              type="password"
              maxLength={8}
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder={t.pinPlaceholder}
              className="w-full text-center tracking-widest text-lg font-bold px-4 py-3 rounded-xl border border-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-500"
              autoFocus
            />
          </div>

          {authError && (
            <p id="owner-auth-error" className="text-xs font-semibold text-red-600">
              {authError}
            </p>
          )}

          <button
            id="btn-owner-unlock"
            type="submit"
            className="w-full min-h-[44px] py-3 bg-stone-900 hover:bg-stone-800 text-white font-bold rounded-xl text-sm transition-colors"
          >
            {t.unlockBtn}
          </button>
        </form>

        <p className="text-[11px] text-stone-400 mt-4">
          Demo Default PIN: <strong>1234</strong>
        </p>
      </div>
    );
  }

  // ----------------------------------------------------
  // MAIN OWNER DASHBOARD
  // ----------------------------------------------------
  return (
    <div id="owner-dashboard-main" className="max-w-4xl mx-auto space-y-6 pb-16">
      {/* Dashboard Top Header with Language Switcher */}
      <div className="bg-white rounded-3xl p-5 sm:p-6 border border-stone-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-xl font-extrabold text-stone-900">{t.ownerTitle}</h2>
            <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-bold">
              {currentMenu.stallName}
            </span>
          </div>
          <p className="text-xs text-stone-500">{t.ownerSubtitle}</p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Korean / English UI Language Switcher */}
          <div className="flex items-center p-1 bg-stone-100 rounded-xl border border-stone-200 text-xs font-semibold" role="group" aria-label="Owner language toggle">
            <button
              id="owner-lang-ko"
              onClick={() => setOwnerLang('ko')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                ownerLang === 'ko' ? 'bg-white text-stone-950 shadow-xs' : 'text-stone-500 hover:text-stone-900'
              }`}
            >
              한국어
            </button>
            <button
              id="owner-lang-en"
              onClick={() => setOwnerLang('en')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                ownerLang === 'en' ? 'bg-white text-stone-950 shadow-xs' : 'text-stone-500 hover:text-stone-900'
              }`}
            >
              English
            </button>
          </div>

          {/* Visitor Preview Button */}
          <button
            id="btn-preview-visitor-screen"
            onClick={onPreviewVisitor}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-xs transition-colors shadow-xs"
          >
            <Eye className="w-4 h-4" />
            <span>{t.previewBtn}</span>
          </button>

          {/* Visitor QR Code Button */}
          <button
            id="btn-show-qr-code"
            onClick={() => setShowQrModal(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-stone-900 hover:bg-stone-800 text-white font-semibold text-xs transition-colors shadow-xs"
          >
            <QrCode className="w-4 h-4" />
            <span>{t.qrBtn}</span>
          </button>
        </div>
      </div>

      {/* Telegram Connection & Status Card */}
      <div className="bg-stone-900 text-stone-100 rounded-3xl p-5 border border-stone-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              telegramStatus?.telegramMode === 'live' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'
            }`}
          >
            <Send className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-stone-400">{t.telegramConnected}</div>
            <div className="text-sm font-bold flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  telegramStatus?.telegramMode === 'live' ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              <span>{telegramStatus?.telegramMode === 'live' ? t.liveModeNotice : t.mockModeNotice}</span>
            </div>
          </div>
        </div>

        <button
          id="btn-dashboard-tg-setup"
          onClick={onOpenTelegramSetup}
          className="px-4 py-2 bg-stone-800 hover:bg-stone-700 border border-stone-700 text-stone-200 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
        >
          <span>{t.manageTelegram}</span>
        </button>
      </div>

      {/* Owner Transaction Ledger & Revenue History */}
      <OwnerTransactionHistory
        ownerLang={ownerLang}
        onAnnounce={onAnnounce}
        ownerPin={pinInput || '1234'}
        stallName={currentMenu.stallName}
        stallLocation="Gwangjang Market, Stall #42, Seoul"
      />

      {/* Menu Items & Pricing Management */}
      <section className="bg-white rounded-3xl p-5 sm:p-6 border border-stone-200 shadow-sm" aria-labelledby="review-section-heading">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <div>
            <h3 id="review-section-heading" className="text-base font-bold text-stone-900">
              {t.reviewTitle}
            </h3>
            <p className="text-xs text-stone-500">{t.reviewDesc}</p>
          </div>
          <button
            id="btn-add-menu-item"
            onClick={handleAddItem}
            className="self-start sm:self-auto flex items-center gap-1.5 px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-900 font-bold rounded-xl text-xs transition-colors border border-stone-200"
          >
            <Plus className="w-4 h-4" />
            <span>{t.addItem}</span>
          </button>
        </div>

        {/* Editable Menu Items Table / Cards */}
        <div className="space-y-3">
          {editableItems.map((item, index) => (
            <div
              key={item.id}
              className={`p-4 rounded-2xl border transition-all ${
                item.needsConfirmation
                  ? 'bg-amber-50/50 border-amber-300'
                  : item.available
                  ? 'bg-white border-stone-200'
                  : 'bg-stone-100 border-stone-200 opacity-60'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-stone-500">#{index + 1}</span>
                  {item.needsConfirmation && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-200 text-amber-900">
                      <AlertTriangle className="w-3 h-3 text-amber-700" />
                      <span>{t.needsConfBadge}</span>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  {/* Availability toggle */}
                  <button
                    onClick={() => handleItemChange(item.id, 'available', !item.available)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                      item.available
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                        : 'bg-stone-200 text-stone-600 border-stone-300'
                    }`}
                  >
                    {item.available ? t.available : t.soldOut}
                  </button>

                  {/* Remove button */}
                  <button
                    onClick={() => handleRemoveItem(item.id)}
                    className="p-1.5 text-stone-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                    aria-label={`Remove ${item.englishName}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Form inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] font-bold text-stone-500 block mb-1">
                    {t.colKorean}
                  </label>
                  <input
                    type="text"
                    value={item.koreanName}
                    onChange={(e) => handleItemChange(item.id, 'koreanName', e.target.value)}
                    className="w-full text-sm font-semibold px-3 py-2 rounded-xl border border-stone-300 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-stone-500 block mb-1">
                    {t.colEnglish}
                  </label>
                  <input
                    type="text"
                    value={item.englishName}
                    onChange={(e) => handleItemChange(item.id, 'englishName', e.target.value)}
                    className="w-full text-sm font-semibold px-3 py-2 rounded-xl border border-stone-300 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-bold text-stone-500 block mb-1">
                    {t.colPrice}
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2 text-stone-400 text-sm">₩</span>
                    <input
                      type="number"
                      step={500}
                      value={item.priceKrw}
                      onChange={(e) => handleItemChange(item.id, 'priceKrw', parseInt(e.target.value, 10) || 0)}
                      className="w-full text-sm font-bold pl-7 pr-3 py-2 rounded-xl border border-stone-300 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Success toast */}
        {saveSuccessMsg && (
          <div className="mt-4 p-3 rounded-2xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs font-bold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>{saveSuccessMsg}</span>
          </div>
        )}

        {/* Bottom Save / Publish Bar */}
        <div className="mt-6 pt-4 border-t border-stone-100 flex flex-col sm:flex-row items-center justify-end gap-2.5">
          <button
            id="btn-save-draft"
            onClick={() => handleSaveMenu(false)}
            disabled={isSaving}
            className="w-full sm:w-auto min-h-[44px] px-4 py-2.5 rounded-xl border border-stone-300 bg-stone-50 hover:bg-stone-100 text-stone-800 font-semibold text-xs transition-colors flex items-center justify-center gap-1.5"
          >
            <Save className="w-4 h-4 text-stone-500" />
            <span>{t.saveDraft}</span>
          </button>

          <button
            id="btn-publish-menu"
            onClick={() => handleSaveMenu(true)}
            disabled={isSaving}
            className="w-full sm:w-auto min-h-[44px] px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-extrabold text-sm transition-transform active:scale-95 flex items-center justify-center gap-2 shadow-md"
          >
            <CheckCircle2 className="w-5 h-5" />
            <span>{t.publishMenu}</span>
          </button>
        </div>
      </section>

      {/* Table QR Code & Tent Card Manager Modal */}
      <QrCodeManagerModal
        isOpen={showQrModal}
        onClose={() => setShowQrModal(false)}
        menu={currentMenu}
        onPreviewVisitor={(tableId) => {
          setShowQrModal(false);
          onPreviewVisitor();
        }}
      />
    </div>
  );
};
