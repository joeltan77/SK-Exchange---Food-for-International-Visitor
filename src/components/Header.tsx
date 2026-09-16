import React, { useState, useRef, useEffect } from 'react';
import {
  ChefHat,
  ShoppingBag,
  Store,
  Volume2,
  ShieldCheck,
  History,
  QrCode,
  ChevronDown,
  MapPin,
  Check,
} from 'lucide-react';
import { TelegramConfigStatus } from '../types';

interface HeaderProps {
  stallName: string;
  stallNameEn: string;
  stallLocation: string;
  currentRole: 'visitor' | 'owner';
  onRoleChange: (role: 'visitor' | 'owner') => void;
  cartItemCount: number;
  onOpenCart: () => void;
  telegramStatus: TelegramConfigStatus | null;
  onOpenTelegramHelp: () => void;
  onOpenHistory?: () => void;
  onOpenQrCode?: () => void;
  activeTable?: string;
  onTableChange?: (table: string) => void;
}

const TABLE_LIST = [
  'Table 1',
  'Table 2',
  'Table 3',
  'Table 4',
  'Table 5',
  'Takeout / Counter',
];

export const Header: React.FC<HeaderProps> = ({
  stallName,
  stallNameEn,
  stallLocation,
  currentRole,
  onRoleChange,
  cartItemCount,
  onOpenCart,
  telegramStatus,
  onOpenTelegramHelp,
  onOpenHistory,
  onOpenQrCode,
  activeTable = 'Table 1',
  onTableChange,
}) => {
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const tableMenuRef = useRef<HTMLDivElement>(null);

  // Close table dropdown when clicked outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (tableMenuRef.current && !tableMenuRef.current.contains(event.target as Node)) {
        setTableMenuOpen(false);
      }
    }
    if (tableMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [tableMenuOpen]);

  const isLive = telegramStatus?.telegramMode === 'live';

  return (
    <header id="app-header" className="sticky top-0 z-30 bg-stone-950 text-stone-100 border-b border-stone-800/80 shadow-md backdrop-blur-md bg-stone-950/95">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between gap-3 sm:gap-4">
        {/* Stall branding & Table selector */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-gradient-to-br from-amber-500 via-amber-600 to-rose-600 flex items-center justify-center shrink-0 shadow-sm shadow-amber-950/50">
            <Store className="w-5 h-5 text-stone-950 font-bold" aria-hidden="true" />
          </div>

          <div className="min-w-0 flex flex-col justify-center">
            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              <h1 className="text-sm sm:text-base font-extrabold tracking-tight text-white whitespace-nowrap">
                {stallNameEn}
              </h1>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-stone-800/90 text-amber-300/90 font-medium border border-stone-700/60 shrink-0">
                {stallName}
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs text-stone-400 mt-0.5">
              <span className="hidden sm:inline text-stone-400 truncate max-w-[140px] md:max-w-[200px]">
                {stallLocation}
              </span>

              {/* Table Switcher Pill */}
              <div className="relative" ref={tableMenuRef}>
                <button
                  type="button"
                  id="header-table-badge"
                  onClick={() => setTableMenuOpen(!tableMenuOpen)}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 text-[11px] font-semibold border border-amber-500/30 transition-colors cursor-pointer"
                  title="Click to switch table or select Takeout"
                  aria-expanded={tableMenuOpen}
                  aria-haspopup="listbox"
                >
                  <MapPin className="w-3 h-3 text-amber-400 shrink-0" />
                  <span className="whitespace-nowrap font-mono">{activeTable}</span>
                  <ChevronDown className="w-2.5 h-2.5 text-amber-400/80 shrink-0 ml-0.5" />
                </button>

                {tableMenuOpen && onTableChange && (
                  <div className="absolute left-0 mt-1.5 w-48 bg-stone-900 border border-stone-700 rounded-xl shadow-xl py-1.5 z-50 animate-in fade-in zoom-in-95 duration-100">
                    <div className="px-3 py-1 text-[10px] uppercase font-bold tracking-wider text-stone-400 border-b border-stone-800">
                      Select Your Seating
                    </div>
                    {TABLE_LIST.map((tbl) => {
                      const isSelected = activeTable === tbl;
                      return (
                        <button
                          key={tbl}
                          type="button"
                          onClick={() => {
                            onTableChange(tbl);
                            setTableMenuOpen(false);
                          }}
                          className={`w-full px-3 py-1.5 text-left text-xs flex items-center justify-between hover:bg-stone-800 transition-colors ${
                            isSelected ? 'text-amber-400 font-bold bg-stone-800/50' : 'text-stone-300'
                          }`}
                        >
                          <span>{tbl}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-amber-400" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          {/* Telegram Status indicator */}
          <button
            id="header-telegram-status"
            onClick={onOpenTelegramHelp}
            className={`flex items-center gap-1.5 px-2.5 py-1 sm:py-1.5 rounded-full text-[11px] font-medium border transition-colors ${
              isLive
                ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300 hover:bg-emerald-950/70'
                : 'bg-amber-950/40 border-amber-500/40 text-amber-300 hover:bg-amber-950/70'
            }`}
            title={`Telegram: ${isLive ? 'Live Kitchen Bot Connected' : 'Mock Preview Mode'}. Click for Bot Setup.`}
            aria-label={`Telegram bot status: ${isLive ? 'Live' : 'Mock'}`}
          >
            <span
              className={`w-2 h-2 rounded-full shrink-0 ${
                isLive ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
              }`}
            />
            <span className="hidden sm:inline">
              {isLive ? 'Kitchen Live' : 'Bot Mock'}
            </span>
          </button>

          {/* Role Switcher Pill */}
          <div
            className="flex items-center p-0.5 sm:p-1 bg-stone-900 rounded-xl border border-stone-800"
            role="group"
            aria-label="User role switcher"
          >
            <button
              id="role-btn-visitor"
              onClick={() => onRoleChange('visitor')}
              className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                currentRole === 'visitor'
                  ? 'bg-amber-500 text-stone-950 shadow-xs'
                  : 'text-stone-400 hover:text-white'
              }`}
              aria-pressed={currentRole === 'visitor'}
            >
              <Volume2 className="w-3.5 h-3.5" />
              <span>Visitor</span>
            </button>
            <button
              id="role-btn-owner"
              onClick={() => onRoleChange('owner')}
              className={`px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                currentRole === 'owner'
                  ? 'bg-amber-500 text-stone-950 shadow-xs'
                  : 'text-stone-400 hover:text-white'
              }`}
              aria-pressed={currentRole === 'owner'}
            >
              <ChefHat className="w-3.5 h-3.5" />
              <span>Owner</span>
            </button>
          </div>

          {/* Owner-Specific Buttons */}
          {currentRole === 'owner' && onOpenQrCode && (
            <button
              id="header-qr-manager-button"
              onClick={onOpenQrCode}
              className="px-2.5 py-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 hover:text-white border border-stone-700 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              title="Generate, download, or print Table QR tent cards"
            >
              <QrCode className="w-4 h-4 text-amber-400" />
              <span className="hidden sm:inline">QR Tents</span>
            </button>
          )}

          {/* Visitor-Specific Buttons */}
          {currentRole === 'visitor' && (
            <div className="flex items-center gap-1.5 sm:gap-2">
              {onOpenHistory && (
                <button
                  id="header-history-button"
                  onClick={onOpenHistory}
                  className="p-2 sm:px-3 sm:py-1.5 rounded-xl bg-stone-900 border border-stone-800 text-stone-300 hover:text-white hover:bg-stone-800 hover:border-stone-700 transition-colors flex items-center gap-1.5 text-xs font-semibold"
                  title="My Past Orders"
                  aria-label="View past receipts"
                >
                  <History className="w-4 h-4 text-amber-400" />
                  <span className="hidden md:inline">My Orders</span>
                </button>
              )}

              <button
                id="header-cart-button"
                onClick={onOpenCart}
                className={`relative px-3 py-1.5 rounded-xl border font-bold text-xs flex items-center gap-1.5 transition-all ${
                  cartItemCount > 0
                    ? 'bg-amber-500 hover:bg-amber-400 text-stone-950 border-amber-400 shadow-sm'
                    : 'bg-stone-900 border-stone-800 text-stone-300 hover:text-white hover:bg-stone-800'
                }`}
                aria-label={`View cart, currently ${cartItemCount} items`}
              >
                <ShoppingBag className="w-4 h-4" />
                <span className="hidden sm:inline">Cart</span>
                {cartItemCount > 0 && (
                  <span
                    id="header-cart-badge"
                    className="bg-stone-950 text-amber-400 font-extrabold text-[11px] px-1.5 py-0.2 rounded-full ml-0.5"
                  >
                    {cartItemCount}
                  </span>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
