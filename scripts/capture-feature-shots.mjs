// Real UI captures for the homepage feature cards (`/` → « Les outils
// essentiels »). Each card shows a crop of the actual page rendered by the
// web bundle with synthetic fixtures (no SVG/CSS mock-ups, no real data):
//
//   feature-stock    Produits, grid view with product photos and stock pills
//   feature-sales    Vente rapide, ticket list with payment status
//   feature-invoice  Invoice detail, document lines with HT / TVA / TTC
//   feature-aging    Rapports, receivables aging buckets and rows
//
// Run against an isolated Vite dev server on 127.0.0.1:5173 — never the
// shared Worker preview or a real backend; every /api call is answered from
// the fixtures below and all other origins are blocked.
//
//   CHROME_PATH=/path/to/chromium node scripts/capture-feature-shots.mjs [name…]
//   (falls back to @sparticuz/chromium when CHROME_PATH is unset)
// Optional: DM_SANS_DIR=<@fontsource/dm-sans/files> serves the real font.
import { existsSync, readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';

const base = 'http://127.0.0.1:5173';
const pkgVersion = JSON.parse(readFileSync('package.json', 'utf8')).version.replace(/-.*$/, '');

const img = (n) => `${base}/shots/demo-products/${n}.webp`;
const fixtures = {
  '/api/products': [
    { id: 1, name: 'Marbre Carrara blanc', sku: 'MAR-001', barcode: '200000000001', category: 'Marbre', stock_quantity: 42, low_stock_threshold: 8, price: 420, cost: 260, track_inventory: 1, is_active: 1, tax_rate: 20, image_url: img('marble-white') },
    { id: 2, name: 'Granit noir Zimbabwe', sku: 'GRA-014', barcode: '200000000002', category: 'Granit', stock_quantity: 6, low_stock_threshold: 10, price: 560, cost: 340, track_inventory: 1, is_active: 1, tax_rate: 20, image_url: img('granite-black') },
    { id: 3, name: 'Onyx miel', sku: 'ONX-003', barcode: '200000000003', category: 'Onyx', stock_quantity: 14, low_stock_threshold: 4, price: 980, cost: 610, track_inventory: 1, is_active: 1, tax_rate: 20, image_url: img('onyx-honey') },
    { id: 4, name: 'Travertin classique', sku: 'TRV-020', barcode: '200000000004', category: 'Travertin', stock_quantity: 31, low_stock_threshold: 6, price: 310, cost: 190, track_inventory: 1, is_active: 1, tax_rate: 20, image_url: img('travertine') },
  ],
  '/api/categories': [{ id: 1, name: 'Marbre' }, { id: 2, name: 'Granit' }, { id: 3, name: 'Onyx' }, { id: 4, name: 'Travertin' }],
  '/api/clients': [{ id: 1, name: 'Promo Immo Agadir', city: 'Agadir' }, { id: 2, name: 'Atelier Benali', city: 'Marrakech' }],
  '/api/invoices': [
    ['VR-2026-0148', 'Comptoir', '2026-10-20', 'paid', 2520, 2520],
    ['VR-2026-0147', 'Atelier Benali', '2026-10-20', 'partial', 6860, 3000],
    ['VR-2026-0146', 'Riad Dar Salam', '2026-10-19', 'paid', 11760, 11760],
    ['VR-2026-0145', 'Comptoir', '2026-10-19', 'paid', 930, 930],
    ['VR-2026-0144', 'Promo Immo Agadir', '2026-10-18', 'sent', 18400, 0],
  ].map(([number, client_name, issue_date, status, total, amount_paid], i) => ({ id: 20 + i, number, client_name, issue_date, status, total, amount_paid, doc_kind: 'quick_sale' })),
  '/api/invoices/1': {
    id: 1, number: 'FA-2026-0092', doc_kind: 'invoice', status: 'partial', client_id: 1, client_name: 'Promo Immo Agadir', client_city: 'Agadir',
    client_phone: '0661 23 45 67', client_email: 'achats@promo-immo.ma', client_address: '12, bd Hassan II', client_ice: '001234567000089',
    issue_date: '2026-10-14', due_date: '2026-11-13', subtotal: 15760, tax_amount: 3152, total: 18912, amount_paid: 8000, notes: '',
    items: [
      { id: 1, product_id: 1, product_name: 'Marbre Carrara blanc — 60×60', sku: 'MAR-001', quantity: 24, unit_price: 420, list_price: 420, tax_rate: 20, line_total: 10080 },
      { id: 2, product_id: 3, product_name: 'Onyx miel — plan vasque', sku: 'ONX-003', quantity: 2, unit_price: 980, list_price: 980, tax_rate: 20, line_total: 1960 },
      { id: 3, product_id: 4, product_name: 'Travertin classique — marches', sku: 'TRV-020', quantity: 12, unit_price: 310, list_price: 310, tax_rate: 20, line_total: 3720 },
    ],
  },
  '/api/invoices/1/payments': [{ id: 1, amount: 8000, method: 'bank', paid_at: '2026-10-16' }],
  '/api/reports/aging': {
    as_of: '2026-10-20',
    buckets: { current: 18400, d1_30: 10912, d31_60: 6860, d61_90: 4200, d90_plus: 1800 },
    rows: [
      { id: 1, number: 'FA-2026-0092', client_name: 'Promo Immo Agadir', due_date: '2026-11-13', days_overdue: 0, remaining: 10912, bucket: 'Courant' },
      { id: 2, number: 'FA-2026-0081', client_name: 'Atelier Benali', due_date: '2026-10-02', days_overdue: 18, remaining: 3860, bucket: '1–30 j' },
      { id: 3, number: 'FA-2026-0074', client_name: 'Riad Dar Salam', due_date: '2026-09-04', days_overdue: 46, remaining: 6860, bucket: '31–60 j' },
      { id: 4, number: 'FA-2026-0061', client_name: 'Hôtel Atlas Bay', due_date: '2026-08-01', days_overdue: 80, remaining: 4200, bucket: '61–90 j' },
    ],
  },
};

/** Crop = the real component (`selector`, nth match) clipped to `w`×`h` from its
 *  top-left; `width` is the viewport (1100 keeps tables compact, still desktop). */
const shots = [
  { name: 'feature-stock', path: '/products', expect: 'Granit noir Zimbabwe', selector: '.pc-grid', clip: { w: 532, h: 300 } },
  { name: 'feature-sales', path: '/quick-sale', expect: 'VR-2026-0147', selector: '.ac-panel', nth: 1, clip: { w: 640, h: 360 } },
  { name: 'feature-invoice', path: '/invoices/1', expect: 'Travertin classique', width: 1100, selector: '.card', nth: 7, scroll: true, clip: { w: 640, h: 310 } },
  { name: 'feature-aging', path: '/reports', expect: 'FA-2026-0081', width: 1100, selector: '.ac-panel', nth: 0, clip: { w: 640, h: 360 } },
];

async function launch() {
  if (process.env.CHROME_PATH) return puppeteer.launch({ executablePath: process.env.CHROME_PATH, args: ['--no-sandbox', '--disable-gpu'], headless: true });
  const chromium = (await import('@sparticuz/chromium')).default;
  return puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
}

// Written only after every capture: a write into public/ makes the Vite dev
// server full-reload open pages, which would put the next page back on its
// loading skeleton mid-capture.
const outputs = [];
{
  const fontDir = process.env.DM_SANS_DIR || '';
  const fontCss = fontDir && existsSync(fontDir) ? [400, 500, 600, 700, 800].map((w) => `@font-face{font-family:'DM Sans';font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${readFileSync(`${fontDir}/dm-sans-latin-${w}-normal.woff2`).toString('base64')}) format('woff2');}`).join('') : '';
  const requested = new Set(process.argv.slice(2));
  for (const theme of ['light', 'dark']) {
    for (const shot of shots) {
      if (requested.size && !requested.has(shot.name)) continue;
      // One browser per capture: no shared storage, cache or worker state.
      const browser = await launch();
      try {
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const url = new URL(req.url());
        if (fontCss && url.origin === 'https://fonts.googleapis.com') { void req.respond({ status: 200, contentType: 'text/css', body: fontCss }); return; }
        if (url.origin !== base) void req.abort();
        else void req.continue();
      });
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: theme }]);
      await page.evaluateOnNewDocument((t, ver, data) => {
        const values = { stock_auth_token: 'demo-token', stock_role: 'owner', stock_auth_user: 'demo', stock_display_name: 'Démo', 'atlas-theme': t, atlas_welcome_completed: 'true', 'atlas-whats-new-modal-seen': ver, 'atlas-whats-new-seen': ver, 'atlas-dl-teaser': 'off', atlas_phone_animations: 'off', 'atlas-tour-done': '1', atlas_onboarding: JSON.stringify({ status: 'done', step: 0 }), atlas_desktop_products_view: 'grid' };
        for (const [k, v] of Object.entries(values)) localStorage.setItem(k, v);
        localStorage.setItem('atlas_cookie_consent_v1', JSON.stringify({ version: 1, necessary: true, preferences: false, analytics: false, method: 'necessary_only', decidedAt: '2026-01-01T00:00:00Z' }));
        const original = window.fetch;
        window.fetch = async (input, init) => {
          const u = new URL(typeof input === 'string' ? input : input.url, location.href);
          if (!u.pathname.startsWith('/api/')) return original(input, init);
          let body = [];
          if (Object.prototype.hasOwnProperty.call(data, u.pathname)) body = data[u.pathname];
          else if (u.pathname.includes('/settings')) body = { currency: 'MAD' };
          return new Response(JSON.stringify({ success: true, data: body }), { headers: { 'content-type': 'application/json' } });
        };
      }, theme, pkgVersion, fixtures);
      // The app scrolls inside its own container, so every crop must already be
      // on screen; 1300px covers all four. (Much taller @2x surfaces can hand
      // back a stale frame in headless Chrome.)
      await page.setViewport({ width: shot.width || 1440, height: 1300, deviceScaleFactor: 2 });
      await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36');
      // The dev server occasionally leaves a first load on its skeleton; wait for
      // the fixture text inside the target component and reload if it never shows.
      let ready = false;
      for (let attempt = 0; attempt < 4 && !ready; attempt += 1) {
        if (attempt === 0) await page.goto(base + shot.path, { waitUntil: 'networkidle2', timeout: 90000 });
        else await page.reload({ waitUntil: 'networkidle2', timeout: 90000 });
        ready = await page.waitForFunction((sel, nth, text) => {
          const el = document.querySelectorAll(sel)[nth || 0];
          return !!el && el.textContent.includes(text) && !document.querySelector('[class*="skeleton"]');
        }, { timeout: 15000, polling: 250 }, shot.selector, shot.nth || 0, shot.expect).then(() => true, () => false);
      }
      if (!ready) { console.warn(`skip ${shot.name}-${theme}: content never rendered`); continue; }
      await new Promise((r) => setTimeout(r, 1200));
      if (shot.scroll) {
        // Below the fold: centre it, clear of the floating top bar.
        await page.evaluate((sel, nth) => document.querySelectorAll(sel)[nth || 0]?.scrollIntoView({ block: 'center' }), shot.selector, shot.nth || 0);
        await new Promise((r) => setTimeout(r, 600));
      }
      const box = await page.evaluate((sel, nth) => {
        const el = document.querySelectorAll(sel)[nth || 0];
        if (!el) return null;
        const r = el.getBoundingClientRect();
        // clip is in page coordinates, so add the document scroll offset.
        return { x: r.left + window.scrollX, y: r.top + window.scrollY, w: r.width, h: r.height };
      }, shot.selector, shot.nth || 0);
      const clip = box && shot.clip
        ? { x: box.x, y: box.y, width: Math.min(shot.clip.w, box.w), height: Math.min(shot.clip.h, box.h) }
        : null;
      if (!clip) { console.warn(`skip ${shot.name}: ${shot.selector} not found`); continue; }
      // Two frames so the compositor has painted the final state.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const png = await page.screenshot({ type: 'png', clip, captureBeyondViewport: false });
      outputs.push({ file: `${shot.name}-${theme}.webp`, png, size: `${Math.round(clip.width)}×${Math.round(clip.height)}` });
      } finally {
        await browser.close();
      }
    }
  }
}
for (const out of outputs) {
  await sharp(out.png).webp({ quality: 84, effort: 6 }).toFile(`public/shots/${out.file}`);
  console.log(`${out.file} ← ${out.size} @2x`);
}
