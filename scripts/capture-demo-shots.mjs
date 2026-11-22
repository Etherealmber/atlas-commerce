// Capture local UI with synthetic fixtures only. Run against an isolated Vite
// server, never the shared Worker preview or a real backend.
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import sharp from 'sharp';

const base = 'http://127.0.0.1:5173';
const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', req => {
    const url = new URL(req.url());
    // Assets only; never let a screenshot contact an API or external network.
    if (url.origin !== base || url.pathname.startsWith('/api/')) void req.abort();
    else void req.continue();
  });
  await page.evaluateOnNewDocument((origin) => {
    const values = { 'stock_auth_token': 'demo-token', 'stock_role': 'owner', 'stock_auth_user': 'demo', 'stock_display_name': 'Démo', 'atlas-theme': 'light', 'atlas_welcome_completed': 'true', 'atlas-whats-new-modal-seen': '0.9.0', 'atlas-dl-teaser': 'off', 'atlas_phone_animations': 'off' };
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
    localStorage.setItem('atlas_cookie_consent_v1', JSON.stringify({ version: 1, necessary: true, preferences: false, analytics: false, method: 'necessary_only', decidedAt: '2026-01-01T00:00:00Z' }));
    const products = [
      { id: 1, name: 'Marbre blanc', sku: 'MAR-001', barcode: '200000000001', category: 'Pierre', stock_quantity: 42, low_stock_threshold: 5, unit_price: 250, image_url: `${origin}/shots/demo-marble.svg` },
      { id: 2, name: 'Quartz sable', sku: 'QTZ-012', barcode: '200000000002', category: 'Pierre', stock_quantity: 18, low_stock_threshold: 5, unit_price: 180, image_url: `${origin}/shots/demo-marble.svg` },
      { id: 3, name: 'Granit graphite', sku: 'GRA-008', barcode: '200000000003', category: 'Pierre', stock_quantity: 3, low_stock_threshold: 5, unit_price: 320, image_url: `${origin}/shots/demo-marble.svg` },
    ];
    const dashboard = { productCount: 3, lowStockCount: 1, currentBalance: 12850, stockValue: 14700, unpaidSales: { total: 3200, count: 2 }, todayRevenue: 3250, monthlySeries: [{ key: '2026-05', label: 'Mai', sales: 18000, expenses: 8000 }, { key: '2026-06', label: 'Juin', sales: 25000, expenses: 12000 }, { key: '2026-07', label: 'Juil', sales: 21000, expenses: 9000 }, { key: '2026-08', label: 'Août', sales: 29000, expenses: 15000 }, { key: '2026-09', label: 'Sept', sales: 31000, expenses: 13000 }, { key: '2026-10', label: 'Oct', sales: 27000, expenses: 10000 }] };
    const finance = { period: '2026-10', currency: 'MAD', opening_balance: 9000, closing_balance: 12850, sales_received: 8000, expenses: 2000, payroll_paid: 1000, supplier_paid: 1500, payroll: { total_due: 0 }, receivables: { total_outstanding: 3200 }, payables: { total_outstanding: 0 } };
    const original = window.fetch;
    window.fetch = async (input, init) => {
      const u = new URL(typeof input === 'string' ? input : input.url, location.href);
      if (!u.pathname.startsWith('/api/')) return original(input, init);
      let data = [];
      if (u.pathname === '/api/dashboard') data = dashboard;
      else if (u.pathname === '/api/products') data = products;
      else if (u.pathname === '/api/admin/finance/monthly') data = finance;
      else if (u.pathname.includes('/mobile-actions/stats')) data = { pending: 2 };
      else if (u.pathname.includes('/settings')) data = { currency: 'MAD' };
      return new Response(JSON.stringify({ success: true, data }), { headers: { 'content-type': 'application/json' } });
    };
  }, base);
  for (const shot of [
    { path: '/m', name: 'phone-home-demo', width: 390, height: 844, mobile: true },
    { path: '/m/products', name: 'phone-products-demo', width: 390, height: 844, mobile: true },
    { path: '/dashboard', name: 'desktop-demo', width: 1280, height: 800, mobile: false },
  ]) {
    await page.setViewport({ width: shot.width, height: shot.height, deviceScaleFactor: 1, isMobile: shot.mobile, hasTouch: shot.mobile });
    await page.setUserAgent(shot.mobile ? 'Mozilla/5.0 (Linux; Android 13; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36' : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36');
    await page.goto(base + shot.path, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector(shot.mobile ? '.phone-root' : '.atlas-page', { timeout: 30000 });
    const image = await page.screenshot({ type: 'png' });
    await sharp(image).webp({ quality: 86 }).toFile(`public/shots/${shot.name}.webp`);
    console.log(`${shot.name}: ${new URL(page.url()).pathname}`);
  }
} finally { await browser.close(); }
