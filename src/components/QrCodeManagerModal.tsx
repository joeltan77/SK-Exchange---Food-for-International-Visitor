import React, { useState, useEffect } from 'react';
import {
  QrCode,
  Copy,
  Check,
  Download,
  ExternalLink,
  Printer,
  X,
  Store,
  Sparkles,
} from 'lucide-react';
import {
  generateQrCodeDataUrl,
  generateTableQrCardDataUrl,
  buildVisitorQrUrl,
} from '../lib/qrCode';
import { StallMenu } from '../types';

interface QrCodeManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  menu: StallMenu;
  initialTable?: string;
  onPreviewVisitor?: (tableId?: string) => void;
}

const TABLE_OPTIONS = [
  { id: 'all', label: 'General Stall Menu (No Table)', short: 'General' },
  { id: 'Table 1', label: 'Table 1 (1번 테이블)', short: 'Table 1' },
  { id: 'Table 2', label: 'Table 2 (2번 테이블)', short: 'Table 2' },
  { id: 'Table 3', label: 'Table 3 (3번 테이블)', short: 'Table 3' },
  { id: 'Table 4', label: 'Table 4 (4번 테이블)', short: 'Table 4' },
  { id: 'Table 5', label: 'Table 5 (5번 테이블)', short: 'Table 5' },
  { id: 'Takeout', label: 'Takeout / Counter (포장/카운터)', short: 'Takeout' },
];

export const QrCodeManagerModal: React.FC<QrCodeManagerModalProps> = ({
  isOpen,
  onClose,
  menu,
  initialTable = 'Table 1',
  onLaunchPhoneSimulator,
}) => {
  const [selectedTable, setSelectedTable] = useState<string>(initialTable);
  const [autoGuided, setAutoGuided] = useState<boolean>(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [customHost, setCustomHost] = useState<string>('');

  // Determine current origin
  const defaultOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const effectiveBaseUrl = customHost.trim() || defaultOrigin;

  const currentUrl = buildVisitorQrUrl(
    effectiveBaseUrl,
    selectedTable === 'all' ? undefined : selectedTable,
    autoGuided
  );

  useEffect(() => {
    if (!isOpen) return;
    let isCancelled = false;

    async function loadQr() {
      setIsGenerating(true);
      const url = await generateQrCodeDataUrl(currentUrl, {
        width: 360,
        margin: 2,
        darkColor: '#1c1917',
        lightColor: '#ffffff',
      });
      if (!isCancelled) {
        setQrDataUrl(url);
        setIsGenerating(false);
      }
    }

    loadQr();
    return () => {
      isCancelled = true;
    };
  }, [isOpen, currentUrl]);

  if (!isOpen) return null;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (e) {
      console.warn('Clipboard write failed', e);
    }
  };

  const handleDownloadQr = async () => {
    const tableLabel =
      TABLE_OPTIONS.find((t) => t.id === selectedTable)?.label ||
      (selectedTable === 'all' ? 'Visitor Stall Menu' : selectedTable);

    const cardDataUrl = await generateTableQrCardDataUrl(
      currentUrl,
      menu.stallName,
      menu.stallNameEn,
      tableLabel
    );

    const link = document.createElement('a');
    link.download = `kstreet_qr_${menu.stallNameEn.toLowerCase().replace(/\s+/g, '_')}_${selectedTable.toLowerCase().replace(/\s+/g, '_')}.png`;
    link.href = cardDataUrl || qrDataUrl;
    link.click();
  };

  const handleOpenInNewTab = () => {
    window.open(currentUrl, '_blank', 'noopener,noreferrer');
  };

  const handlePrintTableTent = () => {
    const printWindow = window.open('', '_blank', 'width=800,height=900');
    if (!printWindow) return;

    const tableLabel =
      TABLE_OPTIONS.find((t) => t.id === selectedTable)?.label ||
      (selectedTable === 'all' ? 'Stall Counter' : selectedTable);

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${menu.stallNameEn} - Table QR Stand</title>
          <style>
            body {
              font-family: system-ui, -apple-system, sans-serif;
              margin: 0;
              padding: 30px;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              text-align: center;
              color: #1c1917;
              background: #fff;
            }
            .card {
              border: 3px solid #1c1917;
              border-radius: 20px;
              padding: 36px 28px;
              max-width: 480px;
              box-shadow: 0 4px 20px rgba(0,0,0,0.08);
            }
            h1 { margin: 0 0 6px 0; font-size: 26px; }
            h2 { margin: 0 0 16px 0; font-size: 18px; color: #b45309; }
            .badge {
              display: inline-block;
              background: #fef3c7;
              color: #92400e;
              font-weight: bold;
              font-size: 18px;
              padding: 8px 24px;
              border-radius: 9999px;
              margin-bottom: 20px;
            }
            .qr { width: 300px; height: 300px; margin: 0 auto 20px auto; display: block; }
            .instructions { font-size: 16px; font-weight: bold; margin-bottom: 6px; }
            .sub-instructions { font-size: 13px; color: #57534e; margin-bottom: 16px; }
            .url { font-family: monospace; font-size: 11px; color: #78716c; word-break: break-all; }
            @media print {
              body { padding: 0; }
              .card { border-width: 2px; box-shadow: none; }
              button { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>${menu.stallNameEn}</h1>
            <h2>${menu.stallName} • ${menu.stallLocation}</h2>
            <div class="badge">📍 ${tableLabel}</div>
            <img class="qr" src="${qrDataUrl}" alt="Table QR Code" />
            <div class="instructions">📱 Scan with Camera to View English Menu</div>
            <div class="sub-instructions">Listen to dishes in English & order with voice<br/>스마트폰 카메라로 스캔하여 영어 안내 및 음성 주문</div>
            <div class="url">${currentUrl}</div>
          </div>
          <script>
            window.onload = () => {
              setTimeout(() => { window.print(); }, 400);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <div
      id="qr-code-manager-backdrop"
      className="fixed inset-0 z-50 bg-stone-950/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        id="qr-code-manager-modal"
        className="bg-white rounded-3xl p-5 sm:p-7 max-w-xl w-full border border-stone-200 shadow-2xl space-y-5 my-auto"
      >
        {/* Modal Top Header */}
        <div className="flex items-start justify-between gap-3 border-b border-stone-100 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-stone-900 text-amber-400 flex items-center justify-center shrink-0 shadow-xs">
              <QrCode className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-extrabold text-stone-900">
                  Visitor QR Code & Phone Version
                </h3>
                <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 text-[11px] font-bold">
                  Live Kiosk
                </span>
              </div>
              <p className="text-xs text-stone-500">
                Scan with any smartphone camera or test directly in the phone simulator
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
            aria-label="Close QR Modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Table Selector Pills */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-stone-700 flex items-center justify-between">
            <span>Select Table / Counter Station:</span>
            <span className="text-[11px] font-normal text-stone-500">
              Orders sent to Telegram will display this table
            </span>
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {TABLE_OPTIONS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSelectedTable(tab.id)}
                className={`px-3 py-2 rounded-xl text-xs font-semibold text-center border transition-all ${
                  selectedTable === tab.id
                    ? 'bg-stone-900 text-white border-stone-900 shadow-xs'
                    : 'bg-stone-50 text-stone-700 border-stone-200 hover:bg-stone-100'
                }`}
              >
                {tab.short}
              </button>
            ))}
          </div>
        </div>

        {/* QR Code Display & Quick Actions */}
        <div className="bg-stone-50 rounded-2xl p-4 border border-stone-200 flex flex-col sm:flex-row items-center gap-5">
          {/* QR Canvas / Image */}
          <div className="relative bg-white p-3 rounded-xl border border-stone-200 shrink-0 shadow-xs">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt={`QR code for ${selectedTable}`}
                className="w-44 h-44 sm:w-48 sm:h-48 object-contain rounded-lg"
              />
            ) : (
              <div className="w-44 h-44 flex items-center justify-center text-xs text-stone-400">
                {isGenerating ? 'Generating QR...' : 'Loading'}
              </div>
            )}
            <div className="mt-1 text-center">
              <span className="text-[11px] font-bold text-stone-800 bg-amber-100 px-2 py-0.5 rounded">
                📍 {selectedTable === 'all' ? 'General Menu' : selectedTable}
              </span>
            </div>
          </div>

          {/* Quick Details & Launchers */}
          <div className="flex-1 min-w-0 space-y-3 w-full text-left">
            <div>
              <h4 className="text-sm font-bold text-stone-900">
                {menu.stallNameEn} ({menu.stallName})
              </h4>
              <p className="text-xs text-stone-500">
                Scanning opens the bilingual English visitor kiosk with voice assistant.
              </p>
            </div>

            {/* Open Visitor Menu Action */}
            <button
              type="button"
              id="btn-open-visitor-tab"
              onClick={handleOpenInNewTab}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-extrabold text-xs sm:text-sm flex items-center justify-center gap-2 shadow-sm transition-transform active:scale-98"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Open Visitor Ordering Menu</span>
            </button>

            {/* Secondary actions */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleCopyLink}
                className="min-h-[38px] px-3 py-1.5 rounded-xl bg-stone-900 hover:bg-stone-800 text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                title="Copy order URL to clipboard"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied URL!' : 'Copy Link'}</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadQr}
                className="min-h-[38px] px-3 py-1.5 rounded-xl bg-stone-200 hover:bg-stone-300 text-stone-800 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
                title="Download high-resolution printable QR image"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Save QR PNG</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handlePrintTableTent}
              className="w-full min-h-[36px] px-3 py-1.5 rounded-xl border border-stone-300 bg-white hover:bg-stone-100 text-stone-700 font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors"
            >
              <Printer className="w-3.5 h-3.5 text-stone-600" />
              <span>Print Table Stand Tent Card</span>
            </button>
          </div>
        </div>

        {/* URL Box with 1-Click Copy */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-stone-700">
            <span>Direct Mobile URL:</span>
            <button
              type="button"
              onClick={handleCopyLink}
              className="inline-flex items-center gap-1 text-amber-700 hover:text-amber-800 font-bold"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied to Clipboard!' : 'Copy Link'}</span>
            </button>
          </div>
          <div className="p-2.5 bg-stone-100 rounded-xl text-xs font-mono text-stone-700 break-all border border-stone-200 select-all flex items-center justify-between gap-2">
            <span className="truncate">{currentUrl}</span>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="pt-2 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-800 font-semibold rounded-xl text-xs transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
