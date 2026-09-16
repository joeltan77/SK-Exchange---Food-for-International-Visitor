import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  X,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Upload,
  RefreshCw,
  QrCode,
} from 'lucide-react';
import { soundEffects } from '../lib/soundEffects';

interface QrScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (tableNumber: string, fullUrl?: string) => void;
}

export const QrScannerModal: React.FC<QrScannerModalProps> = ({
  isOpen,
  onClose,
  onScanSuccess,
}) => {
  const [cameraActive, setCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scannedResult, setScannedResult] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Stop camera helper
  const stopCamera = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  // Start camera when opened
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setScannedResult(null);
      setCameraError(null);
      return;
    }

    let isCancelled = false;

    async function startCamera() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Camera access is not supported on this browser or iframe');
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 640 } },
        });

        if (isCancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCameraActive(true);
        setCameraError(null);

        // If BarcodeDetector is available natively
        if ('BarcodeDetector' in window) {
          const barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
          const detectLoop = async () => {
            if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
              try {
                const barcodes = await barcodeDetector.detect(videoRef.current);
                if (barcodes && barcodes.length > 0) {
                  const rawVal = barcodes[0].rawValue;
                  handleDetectedString(rawVal);
                  return;
                }
              } catch (e) {
                // frame detection error ignore
              }
            }
            animationFrameRef.current = requestAnimationFrame(detectLoop);
          };
          animationFrameRef.current = requestAnimationFrame(detectLoop);
        }
      } catch (err: unknown) {
        console.warn('Camera could not be started', err);
        setCameraError(
          'Live camera preview is unavailable in this environment. You can use the Quick 1-Tap Table Scanners below to test the exact QR scanning flow!'
        );
      }
    }

    startCamera();

    return () => {
      isCancelled = true;
      stopCamera();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDetectedString = (text: string) => {
    soundEffects.playCommandAccepted();
    setScannedResult(text);
    stopCamera();

    // Parse table param from URL if present
    let table = 'Table 1';
    try {
      const url = new URL(text, window.location.origin);
      const t = url.searchParams.get('table');
      if (t) table = decodeURIComponent(t);
    } catch {
      if (text.toLowerCase().includes('table 2')) table = 'Table 2';
      else if (text.toLowerCase().includes('table 3')) table = 'Table 3';
      else if (text.toLowerCase().includes('table 4')) table = 'Table 4';
      else if (text.toLowerCase().includes('table 5')) table = 'Table 5';
      else if (text.toLowerCase().includes('takeout')) table = 'Takeout';
    }

    setTimeout(() => {
      onScanSuccess(table, text);
      onClose();
    }, 1200);
  };

  const handleSimulateScan = (table: string) => {
    const testUrl = `${window.location.origin}/?role=visitor&table=${encodeURIComponent(table)}`;
    handleDetectedString(testUrl);
  };

  return (
    <div
      id="qr-scanner-backdrop"
      className="fixed inset-0 z-50 bg-stone-950/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-3xl p-5 sm:p-7 max-w-md w-full border border-stone-200 shadow-2xl space-y-4 my-auto text-stone-900">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-stone-100 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-700 flex items-center justify-center shrink-0">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-stone-900">
                Scan Table QR Code
              </h3>
              <p className="text-xs text-stone-500">
                Point at the QR stand at your food stall table
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-stone-400 hover:text-stone-700 hover:bg-stone-100"
            aria-label="Close Scanner"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Viewfinder or Fallback */}
        <div className="relative w-full aspect-square max-w-[280px] mx-auto bg-stone-950 rounded-3xl overflow-hidden border-2 border-stone-800 flex items-center justify-center shadow-inner">
          {cameraActive ? (
            <video
              ref={videoRef}
              playsInline
              muted
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="p-4 text-center space-y-2">
              <QrCode className="w-12 h-12 text-stone-600 mx-auto animate-pulse" />
              <p className="text-xs text-stone-400">
                {cameraError ? 'Camera Standby' : 'Starting Camera Viewfinder...'}
              </p>
            </div>
          )}

          {/* Scanner Targeting Reticle */}
          <div className="absolute inset-8 border-2 border-dashed border-amber-400/80 rounded-2xl pointer-events-none flex items-center justify-center">
            <div className="w-full h-0.5 bg-amber-400/60 shadow-[0_0_8px_rgba(245,158,11,0.8)] animate-bounce" />
          </div>

          {/* Scanned result success banner */}
          {scannedResult && (
            <div className="absolute inset-0 bg-stone-950/90 flex flex-col items-center justify-center p-4 text-center space-y-2">
              <CheckCircle2 className="w-12 h-12 text-emerald-400 animate-scale" />
              <div className="text-sm font-bold text-white">QR Code Recognized!</div>
              <div className="text-xs text-stone-300 font-mono truncate max-w-xs">
                {scannedResult}
              </div>
            </div>
          )}
        </div>

        {/* Informative Note / Camera Error */}
        {cameraError && (
          <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="text-[11px] leading-relaxed">{cameraError}</div>
          </div>
        )}

        {/* 1-Tap Quick Test Scanners */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-stone-700 block">
            ⚡ Quick Test Scan (Simulate Table Scan):
          </label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: 'Table 1', label: 'Scan Table 1' },
              { id: 'Table 2', label: 'Scan Table 2' },
              { id: 'Table 3', label: 'Scan Table 3' },
              { id: 'Takeout', label: 'Scan Takeout' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleSimulateScan(tab.id)}
                className="px-3 py-2 rounded-xl bg-stone-100 hover:bg-amber-100 hover:text-amber-900 text-stone-800 font-semibold text-xs border border-stone-200 transition-colors flex items-center justify-center gap-1.5"
              >
                <QrCode className="w-3.5 h-3.5 text-amber-600" />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="pt-1 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-stone-100 hover:bg-stone-200 text-stone-800 font-semibold text-xs"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
