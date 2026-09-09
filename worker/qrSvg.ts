
/**
 * Valid QR → SVG using qrcode-generator (MIT, Kazuhiko Arase).
 */
// @ts-expect-error CJS/UMD interop as ESM default
import qrcode from './vendor/qrcode-generator.js';

export function encodeQrMatrix(text: string): boolean[][] {
  // typeNumber 0 = auto
  const qr = qrcode(0, 'M');
  qr.addData(text);
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

export function qrToSvg(text: string, px = 120, marginModules = 2): string {
  const m = encodeQrMatrix(String(text || ''));
  const n = m.length;
  if (!n) {
    return `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}"><text x="8" y="20" font-size="12">QR error</text></svg>`;
  }
  const margin = marginModules;
  const total = n + margin * 2;
  const scale = px / total;
  // Use path for smaller SVG
  const parts: string[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (m[r][c]) {
        parts.push(`M${c + margin} ${r + margin}h1v1h-1z`);
      }
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <path fill="#0d3b2e" d="${parts.join('')}"/>
</svg>`;
}
