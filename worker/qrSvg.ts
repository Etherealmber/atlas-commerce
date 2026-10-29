/**
 * Valid QR → SVG using qrcode-generator (MIT, Kazuhiko Arase).
 * Center carries Atlas Commerce mark (error correction H).
 */
// @ts-expect-error CJS/UMD interop as ESM default
import qrcode from './vendor/qrcode-generator.js';

/** v0.7.2 — every generated QR carries the NEW Atlas logo (icon png, base64). */
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
  const margin = marginModules;
  const total = n + margin * 2;
  // Clear ~22% center for logo (H ECC tolerates)
  const logoMods = Math.max(7, Math.round(n * 0.22));
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
  // inset plate slightly
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
  const logoSize = Math.max(7, Math.round(n * 0.22));
  const logoFrom = Math.floor((n - logoSize) / 2);
  for (let r = logoFrom; r < logoFrom + logoSize; r++) {
    for (let c = logoFrom; c < logoFrom + logoSize; c++) {
      if (matrix[r]) matrix[r][c] = false;
    }
  }
  return { matrix, logoFrom, logoSize };
}
