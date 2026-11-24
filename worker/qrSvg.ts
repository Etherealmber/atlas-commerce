/**
 * Valid QR → SVG using qrcode-generator (MIT, Kazuhiko Arase).
 * Center carries Atlas Commerce mark (error correction H).
 */
// @ts-expect-error CJS/UMD interop as ESM default
import qrcode from './vendor/qrcode-generator.js';

/** v0.7.2 — every generated QR carries the light-theme Atlas logo (dark details on white, no black box). */
const ATLAS_LOGO_DATA_URL =
  'data:image/png;base64,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';

export function encodeQrMatrix(text: string, ecc: 'L' | 'M' | 'Q' | 'H' = 'H'): boolean[][] {
  const qr = qrcode(0, ecc);
  qr.addData(String(text || ''));
  qr.make();
  const n = qr.getModuleCount();
  const matrix: boolean[][] = [];
  for (let r = 0; r < n; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < n; c++) {
      row.push(!!qr.isDark(r, c));
    }
    matrix.push(row);
  }
  return matrix;
}

/**
 * QR SVG with white quiet zone + Atlas logo plate in the center.
 */
export function qrToSvg(text: string, px = 120, marginModules = 2): string {
  const m = encodeQrMatrix(String(text || ''), 'H');
  const n = m.length;
  if (!n) {
    return `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"><text x="8" y="20" font-size="12">QR error</text></svg>`;
  }
  const margin = Math.max(4, marginModules);
  const total = n + margin * 2;
  // Clear ~20% center for logo (smaller 5x5 plate on compact Version 1-2 matrices)
  const logoMods = n <= 25 ? 5 : Math.max(7, Math.round(n * 0.2));
  const c0 = Math.floor((n - logoMods) / 2);
  const c1 = c0 + logoMods;

  const parts: string[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (r >= c0 && r < c1 && c >= c0 && c < c1) continue;
      if (m[r][c]) {
        parts.push(`M${c + margin} ${r + margin}h1v1h-1z`);
      }
    }
  }

  const logoX = margin + c0;
  const logoY = margin + c0;
  const logoS = logoMods;
  // Clean white center plate + light-theme Atlas sunburst mark in dark ink
  const pad = logoS * 0.08;
  const plateX = logoX + pad;
  const plateY = logoY + pad;
  const plateS = logoS - pad * 2;
  const rx = plateS * 0.18;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <path fill="#0a0a0a" d="${parts.join('')}"/>
  <rect x="${plateX}" y="${plateY}" width="${plateS}" height="${plateS}" rx="${rx}" fill="#ffffff"/>
  <image x="${plateX}" y="${plateY}" width="${plateS}" height="${plateS}" href="${ATLAS_LOGO_DATA_URL}" preserveAspectRatio="xMidYMid meet"/>
</svg>`;
}

/** Matrix for PDF drawing (modules + logo hole metadata). */
export function qrMatrixWithLogo(text: string): {
  matrix: boolean[][];
  logoFrom: number;
  logoSize: number;
} {
  const matrix = encodeQrMatrix(String(text || ''), 'H');
  const n = matrix.length;
  const logoSize = n <= 25 ? 5 : Math.max(7, Math.round(n * 0.2));
  const logoFrom = Math.floor((n - logoSize) / 2);
  for (let r = logoFrom; r < logoFrom + logoSize; r++) {
    for (let c = logoFrom; c < logoFrom + logoSize; c++) {
      if (matrix[r]) matrix[r][c] = false;
    }
  }
  return { matrix, logoFrom, logoSize };
}
