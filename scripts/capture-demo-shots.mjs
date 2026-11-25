// Capture local UI with synthetic fixtures only. Run against an isolated Vite
// server, never the shared Worker preview or a real backend.
import { existsSync, readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import sharp from 'sharp';

const pkgVersion = JSON.parse(readFileSync('package.json', 'utf8')).version.replace(/-.*$/, '');
const base = 'http://127.0.0.1:5173';
// THEME=dark writes `<name>-dark.webp` (shown in dark mode by ThemedShot);
// the light captures keep their historical names.
const theme = process.env.THEME === 'dark' ? 'dark' : 'light';
const lang = ['en', 'ar'].includes(process.env.SHOT_LANG) ? process.env.SHOT_LANG : 'fr';
const suffix = lang === 'fr' ? (theme === 'dark' ? '-dark' : '') : `-${lang}-${theme}`;
// CHROME_PATH lets a local Chromium replace the bundled one.
const browser = await puppeteer.launch(process.env.CHROME_PATH
  ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader'], headless: true }
  : { executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  // Optional: DM_SANS_DIR=<@fontsource/dm-sans/files> serves the real font
  // locally (Google Fonts is never contacted), so captures match production.
  const fontDir = process.env.DM_SANS_DIR || '';
  const fontCss = fontDir && existsSync(fontDir) ? [400, 500, 600, 700, 800].map((w) => `@font-face{font-family:'DM Sans';font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${readFileSync(`${fontDir}/dm-sans-latin-${w}-normal.woff2`).toString('base64')}) format('woff2');}`).join('') : '';
  page.on('request', req => {
    const url = new URL(req.url());
    if (fontCss && url.origin === 'https://fonts.googleapis.com') { void req.respond({ status: 200, contentType: 'text/css', body: fontCss }); return; }
    // Assets only; never let a screenshot contact an API or external network.
    if (url.origin !== base || url.pathname.startsWith('/api/')) void req.abort();
    else void req.continue();
  });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.evaluateOnNewDocument((origin, ver, themeName, language) => {
    const values = { 'stock_auth_token': 'demo-token', 'stock_role': 'owner', 'stock_auth_user': 'demo', 'stock_display_name': 'Démo', 'atlas-theme': themeName, 'atlas-sidebar-collapsed': '1', 'atlas_welcome_completed': 'true', 'atlas-whats-new-modal-seen': ver, 'atlas-whats-new-seen': ver, 'atlas-dl-teaser': 'off', 'atlas_phone_animations': 'off' };
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
    localStorage.setItem('atlas_lang', language);
    localStorage.setItem('atlas_cookie_consent_v1', JSON.stringify({ version: 1, necessary: true, preferences: false, analytics: false, method: 'necessary_only', decidedAt: '2026-01-01T00:00:00Z' }));
    const products = [
      { id: 1, name: 'Marbre blanc', sku: 'MAR-001', barcode: '200000000001', category: 'Pierre', stock_quantity: 42, low_stock_threshold: 5, unit_price: 250, price: 250, cost: 160, track_inventory: 1, image_url: `${origin}/shots/demo-marble.svg` },
      { id: 2, name: 'Quartz sable', sku: 'QTZ-012', barcode: '200000000002', category: 'Pierre', stock_quantity: 18, low_stock_threshold: 5, unit_price: 180, price: 180, cost: 110, track_inventory: 1, image_url: `${origin}/shots/demo-marble.svg` },
      { id: 3, name: 'Granit graphite', sku: 'GRA-008', barcode: '200000000003', category: 'Pierre', stock_quantity: 3, low_stock_threshold: 5, unit_price: 320, price: 320, cost: 200, track_inventory: 1, image_url: `${origin}/shots/demo-marble.svg` },
    ];
    const now = new Date();
    const frM = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
    const baseSales = [18400, 24800, 21200, 29400, 32600, 28900];
    const baseExp = [9200, 12100, 9800, 14600, 13200, 11400];
    const monthlySeries = Array.from({ length: 6 }, (_, idx) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - idx), 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const sales = baseSales[idx];
      const expenses = baseExp[idx];
      return {
        key,
        label: `${frM[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`,
        sales,
        expenses,
        profit: sales - expenses,
        invoices_fa: Math.round(sales * 0.68),
        sales_vr: Math.round(sales * 0.32),
        bills: Math.round(expenses * 0.58),
        salaries: Math.round(expenses * 0.42),
        receipts: Math.round(sales * 0.92),
        clients_new: [3, 5, 4, 7, 6, 8][idx],
      };
    });
    const dashboard = {
      productCount: 3,
      lowStockCount: 1,
      currentBalance: 48250,
      stockValue: 14700,
      unpaidSales: { total: 6400, open: 4600, overdue: 1800, count: 3 },
      unpaidPurchases: { total: 2900, open: 2100, overdue: 800, count: 2 },
      todayRevenue: 3250,
      monthlySeries,
      expenseCategories: [
        { category: 'Transport & livraison', total: 4800 },
        { category: 'Loyer & atelier', total: 3600 },
        { category: 'Énergie & eau', total: 1450 },
        { category: 'Fournitures', total: 950 },
      ],
    };
    const finance = { period: '2026-10', currency: 'MAD', opening_balance: 9000, closing_balance: 12850, sales_received: 8000, expenses: 2000, payroll_paid: 1000, supplier_paid: 1500, payroll: { total_due: 0 }, receivables: { total_outstanding: 3200 }, payables: { total_outstanding: 0 } };
    const breakdown = { inflows: { cash: 6000, bank: 2000, total: 8000 }, outflows: { cash: 1200, bank: 1800, total: 3000, not_recorded: 0 }, owner: { contributions: { total: 500 }, withdrawals: { total: 200 } }, expense_categories: [], categories_truncated: false, statement: { balanced: true, consistent_with_breakdown: true } };
    const statement = { period: '2026-10', page: 1, page_size: 50, total: 0, has_more: false, rows: [], totals: { credits: 8000, debits: 3000 }, reconciliation: { balanced: true }, status: 'ok', as_of: '2026-10-20' };
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const u = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (!u.pathname.startsWith('/api/')) return original(input, init);
      let data = [];
      if (u.pathname === '/api/dashboard') data = dashboard;
      else if (u.pathname === '/api/products') data = products;
      else if (u.pathname === '/api/admin/finance/monthly') data = finance;
      else if (u.pathname === '/api/admin/finance/period') data = breakdown;
      else if (u.pathname === '/api/admin/finance/statement') data = statement;
      else if (u.pathname.includes('/mobile-actions/stats')) data = { pending: 2 };
      else if (u.pathname.includes('/assist/next-actions')) data = { items: [{ priority: 1, title: '1 facture impayée', detail: 'Relancer ou enregistrer un paiement', href: '/invoices' }] };
      else if (u.pathname.includes('/settings')) data = { currency: 'MAD' };
      return new Response(JSON.stringify({ success: true, data }), { headers: { 'content-type': 'application/json' } });
    };
  }, base, pkgVersion, theme, lang);
  const requested = new Set(process.argv.slice(2));
  for (const shot of [
    { path: '/m', name: 'phone-home-demo', width: 390, height: 844, mobile: true },
    { path: '/m/products', name: 'phone-products-demo', width: 390, height: 844, mobile: true },
    { path: '/m/balance', name: 'phone-balance-demo', width: 390, height: 844, mobile: true },
    { path: '/products', name: 'desktop-products-demo', width: 1440, height: 900, mobile: false },
  ]) {
    if (requested.size && !requested.has(shot.name)) continue;
    await page.setViewport({ width: shot.width, height: shot.height, deviceScaleFactor: 1, isMobile: shot.mobile, hasTouch: shot.mobile });
    await page.setUserAgent(shot.mobile ? 'Mozilla/5.0 (Linux; Android 13; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36' : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36');
    await page.goto(base + shot.path, { waitUntil: 'networkidle2', timeout: 60000 });
    try {
      await page.waitForSelector(shot.mobile ? '.phone-root' : shot.path === '/products' ? '.atlas-catalog' : '.atlas-page', { timeout: 30000 });
    } catch (err) {
      const text = await page.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => '');
      console.error(`${shot.name}: page did not render (${err.message})\n${text}`);
      process.exitCode = 1;
      continue;
    }
    await new Promise((r) => setTimeout(r, 450));
    const image = await page.screenshot({ type: 'png' });
    await sharp(image).webp({ quality: 86 }).toFile(`public/shots/${shot.name}${suffix}.webp`);
    console.log(`${shot.name}${suffix}: ${new URL(page.url()).pathname}`);
  }
} finally { await browser.close(); }
