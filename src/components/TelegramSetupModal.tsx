import React, { useState } from 'react';
import {
  X,
  Send,
  ShieldCheck,
  AlertCircle,
  CheckCircle2,
  Copy,
} from 'lucide-react';
import { TelegramConfigStatus } from '../types';

interface TelegramSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  telegramStatus: TelegramConfigStatus | null;
  onStatusUpdated?: () => void;
}

export const TelegramSetupModal: React.FC<TelegramSetupModalProps> = ({
  isOpen,
  onClose,
  telegramStatus,
}) => {
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSendTestMessage = async () => {
    setIsSendingTest(true);
    setTestResult(null);

    try {
      const response = await fetch('/api/owner/test-telegram', {
        method: 'POST',
      });
      const data = await response.json();
      if (data.success) {
        setTestResult({
          success: true,
          message:
            data.mode === 'live'
              ? 'Live Telegram test message delivered to your chat!'
              : 'Simulated test notification logged in Mock Mode. (No real credentials provided).',
        });
      } else {
        setTestResult({
          success: false,
          message: data.error || 'Failed to send test message to Telegram',
        });
      }
    } catch (err: unknown) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Network error testing Telegram connection',
      });
    } finally {
      setIsSendingTest(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(label);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const botConfigured = Boolean(telegramStatus?.hasTelegramBotToken || telegramStatus?.botTokenConfigured);
  const chatConfigured = Boolean(telegramStatus?.hasTelegramChatId || telegramStatus?.chatIdConfigured);

  return (
    <div
      id="telegram-setup-modal-backdrop"
      className="fixed inset-0 z-50 bg-stone-950/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tg-modal-title"
    >
      <div
        id="telegram-setup-modal-card"
        className="bg-stone-900 text-stone-100 w-full max-w-xl rounded-3xl border border-stone-800 shadow-2xl p-5 sm:p-6 max-h-[92vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between pb-3 border-b border-stone-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-500/20 text-blue-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 id="tg-modal-title" className="text-lg font-bold text-white">
                Telegram Bot Receipt Delivery
              </h2>
              <p className="text-xs text-stone-400">
                Direct order receipt notification to stall owner Telegram
              </p>
            </div>
          </div>
          <button
            id="btn-close-tg-modal"
            onClick={onClose}
            className="p-2 rounded-xl text-stone-400 hover:text-white hover:bg-stone-800 transition-colors"
            aria-label="Close Telegram setup modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Connection States */}
        <div className="my-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="p-3 rounded-2xl bg-stone-950 border border-stone-800 flex flex-col justify-between">
            <span className="text-[11px] text-stone-400">Bot Token</span>
            <div className="flex items-center gap-1.5 mt-1">
              <span
                className={`w-2 h-2 rounded-full ${botConfigured ? 'bg-emerald-400' : 'bg-red-400'}`}
              />
              <span className={`text-xs font-bold ${botConfigured ? 'text-emerald-400' : 'text-red-400'}`}>
                {botConfigured ? 'Configured' : 'Missing'}
              </span>
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-stone-950 border border-stone-800 flex flex-col justify-between">
            <span className="text-[11px] text-stone-400">Chat ID</span>
            <div className="flex items-center gap-1.5 mt-1">
              <span
                className={`w-2 h-2 rounded-full ${chatConfigured ? 'bg-emerald-400' : 'bg-red-400'}`}
              />
              <span className={`text-xs font-bold ${chatConfigured ? 'text-emerald-400' : 'text-red-400'}`}>
                {chatConfigured ? 'Configured' : 'Missing'}
              </span>
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-stone-950 border border-stone-800 flex flex-col justify-between">
            <span className="text-[11px] text-stone-400">Delivery Mode</span>
            <div className="flex items-center gap-1.5 mt-1">
              <span
                className={`w-2 h-2 rounded-full ${botConfigured && chatConfigured ? 'bg-emerald-400' : 'bg-amber-400'}`}
              />
              <span className={`text-xs font-bold ${botConfigured && chatConfigured ? 'text-emerald-400' : 'text-amber-400'}`}>
                {botConfigured && chatConfigured ? 'Live Telegram' : 'Simulated Mock'}
              </span>
            </div>
          </div>

          <div className="p-3 rounded-2xl bg-stone-950 border border-stone-800 flex flex-col justify-between">
            <span className="text-[11px] text-stone-400">Order Receipts</span>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-xs font-bold text-emerald-400">
                Receipts Only
              </span>
            </div>
          </div>
        </div>

        {/* Test result message */}
        {testResult && (
          <div
            className={`mb-4 p-3 rounded-xl text-xs flex items-start gap-2 border ${
              testResult.success
                ? 'bg-emerald-950/80 border-emerald-700 text-emerald-200'
                : 'bg-red-950/80 border-red-800 text-red-200'
            }`}
          >
            {testResult.success ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            )}
            <span>{testResult.message}</span>
          </div>
        )}

        {/* Test Notification Action */}
        <div className="p-3.5 rounded-2xl bg-stone-950 border border-stone-800 space-y-3 mb-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-stone-300 uppercase tracking-wider">
              Verify Receipt Delivery
            </span>
            <button
              id="btn-send-tg-test"
              onClick={handleSendTestMessage}
              disabled={isSendingTest}
              className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-xs flex items-center gap-1.5 transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSendingTest ? 'Sending Test...' : 'Send Test Receipt'}</span>
            </button>
          </div>
          <p className="text-xs text-stone-400">
            Sends a sample Korean order receipt to the configured stall Telegram chat.
          </p>
        </div>

        {/* Credentials guide */}
        <div className="p-3.5 rounded-2xl bg-stone-950 border border-stone-800 space-y-3 text-xs text-stone-300">
          <span className="font-bold text-stone-300 uppercase tracking-wider block">
            Environment Variables (.env.example)
          </span>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-stone-400">TELEGRAM_BOT_TOKEN</span>
              <button
                onClick={() => copyToClipboard('TELEGRAM_BOT_TOKEN="your_bot_token_here"', 'tok')}
                className="text-[11px] text-amber-400 hover:underline flex items-center gap-1"
              >
                <Copy className="w-3 h-3" />
                <span>{copiedKey === 'tok' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <p className="text-[11px] text-stone-400">Obtained from @BotFather in Telegram.</p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-mono text-stone-400">TELEGRAM_CHAT_ID</span>
              <button
                onClick={() => copyToClipboard('TELEGRAM_CHAT_ID="your_chat_id_here"', 'cid')}
                className="text-[11px] text-amber-400 hover:underline flex items-center gap-1"
              >
                <Copy className="w-3 h-3" />
                <span>{copiedKey === 'cid' ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <p className="text-[11px] text-stone-400">Your personal user ID or stall group chat ID.</p>
          </div>
        </div>

        <div className="mt-5 pt-3 border-t border-stone-800 flex justify-end">
          <button
            id="btn-dismiss-tg-modal"
            onClick={onClose}
            className="px-4 py-2 bg-stone-800 hover:bg-stone-700 text-stone-200 font-semibold rounded-xl text-xs transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
