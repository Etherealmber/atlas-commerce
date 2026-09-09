/** Open a print-friendly product barcode label (PC). */
export function printProductLabel(p: {
  name: string;
  sku?: string;
  barcode?: string;
  price?: number | string;
  showPrice?: boolean;
}) {
  const code = String(p.barcode || p.sku || '').trim();
  const name = String(p.name || '').slice(0, 48);
  const price =
    p.showPrice !== false && p.price != null && p.price !== ''
      ? `${Math.round(Number(p.price)).toLocaleString('fr-MA')} MAD`
      : '';
  const w = window.open('', '_blank', 'width=420,height=520');
  if (!w) return;
  w.document.write(`<!DOCTYPE html><html><head><title>Étiquette</title>
<style>
  @page { size: 50mm 30mm; margin: 2mm; }
  body { font-family: system-ui, sans-serif; margin: 12px; text-align: center; }
  .name { font-size: 13px; font-weight: 700; margin-bottom: 6px; }
  .code { font-family: ui-monospace, monospace; font-size: 14px; letter-spacing: 0.08em; margin: 8px 0; }
  .bars { height: 48px; display: flex; justify-content: center; gap: 1px; margin: 8px auto; }
  .bars i { display: inline-block; width: 2px; background: #111; height: 100%; }
  .bars i.w { width: 4px; }
  .price { font-size: 16px; font-weight: 700; margin-top: 6px; }
  .sku { font-size: 11px; color: #444; }
  @media print { button { display: none; } }
</style></head><body>
  <div class="name">${escapeHtml(name)}</div>
  <div class="sku">${escapeHtml(p.sku || '')}</div>
  <div class="bars" id="bars"></div>
  <div class="code">${escapeHtml(code || '—')}</div>
  ${price ? `<div class="price">${escapeHtml(price)}</div>` : ''}
  <button onclick="window.print()" style="margin-top:16px;padding:8px 16px">Imprimer</button>
  <script>
    (function(){
      var s = ${JSON.stringify(code || '0')};
      var el = document.getElementById('bars');
      if (!el) return;
      for (var i = 0; i < s.length; i++) {
        var n = s.charCodeAt(i) % 5;
        var bar = document.createElement('i');
        if (n > 2) bar.className = 'w';
        el.appendChild(bar);
        var gap = document.createElement('i');
        gap.style.background = 'transparent';
        gap.style.width = '1px';
        el.appendChild(gap);
      }
    })();
  </script>
</body></html>`);
  w.document.close();
}

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
