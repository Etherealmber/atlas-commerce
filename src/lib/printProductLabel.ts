export interface ProductLabelInfo {
  id?: number;
  name: string;
  sku?: string;
  barcode?: string;
  price?: number | string;
  unit?: string;
  location?: string;
  showPrice?: boolean;
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Deterministic SVG barcode label fallback (matches server label.svg dimensions 320x180). */
export function buildFallbackLabelSvg(p: ProductLabelInfo): string {
  const code = String(p.barcode || p.sku || (p.id ? `P${p.id}` : '0')).trim();
  const name = String(p.name || 'Produit').slice(0, 34);
  const sub = [code, p.unit || '', p.location || ''].filter(Boolean).join(' · ');
  const priceText =
    p.showPrice !== false && p.price != null && p.price !== '' && Number.isFinite(Number(p.price))
      ? `${Number(p.price).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD`
      : '';

  // Deterministic pseudo-Code128 bar pattern (bounded left of x=204)
  const bars: string[] = [];
  let x = 12;
  const seed = code || '0';
  for (let i = 0; i < seed.length && x < 204; i++) {
    const ch = seed.charCodeAt(i);
    for (let b = 0; b < 4 && x < 204; b++) {
      const w = ((ch >> b) & 1) === 1 ? 3 : 1.5;
      const gap = ((ch >> (b + 2)) & 1) === 1 ? 2.5 : 1.5;
      bars.push(`<rect x="${x.toFixed(1)}" y="108" width="${w}" height="42" fill="#0a0a0a"/>`);
      x += w + gap;
    }
  }
  if (!bars.length) {
    bars.push('<rect x="12" y="108" width="2" height="42" fill="#0a0a0a"/>');
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
<rect width="320" height="180" rx="6" fill="#ffffff" stroke="#d4d4d8"/>
<text x="14" y="24" font-family="system-ui, sans-serif" font-size="15" font-weight="700" fill="#0a0a0a">${escapeHtml(name)}</text>
<text x="14" y="41" font-family="system-ui, sans-serif" font-size="11" fill="#52525b">${escapeHtml(sub.slice(0, 34))}</text>
${priceText ? `<text x="14" y="76" font-family="system-ui, sans-serif" font-size="20" font-weight="800" fill="#0a0a0a">${escapeHtml(priceText)}</text>` : ''}
<g>${bars.join('')}</g>
<text x="14" y="166" font-family="ui-monospace, monospace" font-size="10" fill="#0a0a0a">${escapeHtml(code)}</text>
</svg>`;
}

/** Print a label SVG cleanly using a hidden print iframe (popup-safe) with window fallback. */
export function printLabelSvg(svgMarkup: string, title = 'Étiquette produit') {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: 60mm 35mm; margin: 2mm; }
  html, body { margin: 0; padding: 0; background: #fff; display: flex; align-items: center; justify-content: center; min-height: 100%; }
  svg { width: 100%; height: auto; max-width: 320px; display: block; }
  @media print { body { margin: 0; } }
</style></head><body>${svgMarkup}</body></html>`;

  if (typeof document !== 'undefined') {
    try {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.setAttribute('aria-hidden', 'true');
      document.body.appendChild(iframe);
      const doc = iframe.contentWindow?.document;
      if (doc && iframe.contentWindow) {
        doc.open();
        doc.write(html);
        doc.close();
        setTimeout(() => {
          try {
            iframe.contentWindow?.focus();
            iframe.contentWindow?.print();
          } finally {
            setTimeout(() => iframe.remove(), 1500);
          }
        }, 120);
        return;
      }
      iframe.remove();
    } catch {
      // fall through to window.open
    }
  }

  const w = window.open('', '_blank', 'width=420,height=340');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
  setTimeout(() => {
    try {
      w.focus();
      w.print();
    } catch {
      /* noop */
    }
  }, 120);
}

/** Open a print-friendly product barcode label (PC). */
export function printProductLabel(p: ProductLabelInfo) {
  printLabelSvg(buildFallbackLabelSvg(p), `Étiquette — ${p.name || 'Produit'}`);
}
