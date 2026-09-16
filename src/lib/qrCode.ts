import QRCode from 'qrcode';

export interface QrCodeOptions {
  width?: number;
  margin?: number;
  darkColor?: string;
  lightColor?: string;
}

/**
 * Generates high-definition base64 QR Code PNG
 */
export async function generateQrCodeDataUrl(text: string, options?: QrCodeOptions): Promise<string> {
  try {
    return await QRCode.toDataURL(text, {
      width: options?.width || 360,
      margin: options?.margin ?? 2,
      color: {
        dark: options?.darkColor || '#1c1917', // stone-900
        light: options?.lightColor || '#ffffff',
      },
      errorCorrectionLevel: 'M',
    });
  } catch (err) {
    console.error('Failed to generate QR code', err);
    return '';
  }
}

/**
 * Constructs a fully qualified visitor menu URL with optional table parameter
 */
export function buildVisitorQrUrl(baseUrl: string, tableId?: string, autoGuided = false): string {
  try {
    const cleanBase = (baseUrl || (typeof window !== 'undefined' ? window.location.origin : ''))
      .trim()
      .replace(/\/+$/, '');
    const url = new URL(cleanBase || 'http://localhost:3000');
    url.searchParams.set('role', 'visitor');
    if (tableId && tableId !== 'all') {
      url.searchParams.set('table', tableId);
    }
    if (autoGuided) {
      url.searchParams.set('guided', '1');
    }
    return url.toString();
  } catch {
    const tableParam = tableId && tableId !== 'all' ? `?role=visitor&table=${encodeURIComponent(tableId)}` : '?role=visitor';
    return `${baseUrl.replace(/\/+$/, '')}/${tableParam}`;
  }
}

/**
 * Draws a branded table tent card with stall name, table number, and QR code on a Canvas
 * and returns high-resolution PNG data URL for direct download or printing.
 */
export async function generateTableQrCardDataUrl(
  url: string,
  stallName: string,
  stallNameEn: string,
  tableLabel: string
): Promise<string> {
  const qrDataUrl = await generateQrCodeDataUrl(url, { width: 500, margin: 1 });
  if (!qrDataUrl) return '';

  if (typeof document === 'undefined') return qrDataUrl;

  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 820;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      resolve(qrDataUrl);
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // 1. Background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 2. Elegant rounded border
      ctx.strokeStyle = '#e7e5e4'; // stone-200
      ctx.lineWidth = 4;
      ctx.strokeRect(16, 16, canvas.width - 32, canvas.height - 32);

      // 3. Header background accent
      ctx.fillStyle = '#1c1917'; // stone-900
      ctx.fillRect(16, 16, canvas.width - 32, 130);

      // 4. Header Stall Name
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 30px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(stallNameEn, canvas.width / 2, 64);

      ctx.fillStyle = '#f59e0b'; // amber-500
      ctx.font = '600 20px system-ui, -apple-system, sans-serif';
      ctx.fillText(stallName, canvas.width / 2, 100);

      // 5. Table Badge
      ctx.fillStyle = '#fef3c7'; // amber-100
      ctx.beginPath();
      const badgeY = 166;
      const badgeW = 280;
      const badgeH = 46;
      ctx.roundRect((canvas.width - badgeW) / 2, badgeY, badgeW, badgeH, 12);
      ctx.fill();

      ctx.fillStyle = '#92400e'; // amber-800
      ctx.font = 'bold 22px system-ui, -apple-system, sans-serif';
      ctx.fillText(`📍 ${tableLabel}`, canvas.width / 2, badgeY + 31);

      // 6. Draw QR Code
      const qrSize = 400;
      const qrX = (canvas.width - qrSize) / 2;
      const qrY = 236;
      ctx.drawImage(img, qrX, qrY, qrSize, qrSize);

      // 7. Instructions English & Korean
      ctx.fillStyle = '#1c1917';
      ctx.font = 'bold 22px system-ui, -apple-system, sans-serif';
      ctx.fillText('📱 Scan with Smartphone Camera', canvas.width / 2, 672);

      ctx.fillStyle = '#44403c';
      ctx.font = '500 16px system-ui, -apple-system, sans-serif';
      ctx.fillText('Listen to Korean menu in English & order with voice', canvas.width / 2, 706);

      ctx.fillStyle = '#78716c';
      ctx.font = '400 14px system-ui, -apple-system, sans-serif';
      ctx.fillText('스마트폰 카메라로 스캔하여 영어 안내 및 음성 주문', canvas.width / 2, 736);

      // 8. Footer URL
      ctx.fillStyle = '#a8a29e';
      ctx.font = '12px monospace';
      ctx.fillText(url.length > 55 ? `${url.substring(0, 52)}...` : url, canvas.width / 2, 775);

      resolve(canvas.toDataURL('image/png'));
    };

    img.onerror = () => {
      resolve(qrDataUrl);
    };

    img.src = qrDataUrl;
  });
}

