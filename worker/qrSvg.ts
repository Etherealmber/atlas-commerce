/**
 * Valid QR → SVG using qrcode-generator (MIT, Kazuhiko Arase).
 * Center carries Atlas Commerce mark (error correction H).
 */
// @ts-expect-error CJS/UMD interop as ESM default
import qrcode from './vendor/qrcode-generator.js';

/** Atlas “A” mark as compact SVG path (viewBox 0 0 64 64). */
const ATLAS_MARK_PATH =
  'M32 12L50 52H42.2L38.8 43H25.2L21.8 52H14L32 12ZM32 24L27.6 36H36.4L32 24Z';

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
  <rect x="${plateX}" y="${plateY}" width="${plateS}" height="${plateS}" rx="${rx}" fill="#0a0a0a"/>
  <g transform="translate(${plateX},${plateY}) scale(${plateS / 64})">
    <path fill="#fafafa" fill-rule="evenodd" clip-rule="evenodd" d="${ATLAS_MARK_PATH}"/>
  </g>
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
