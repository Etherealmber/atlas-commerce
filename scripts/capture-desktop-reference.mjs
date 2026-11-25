/* Desktop parity reference for EVERY page, every Settings section and Atlas Agent.
 *
 * Same method as docs/desktop-login-reference and docs/desktop-shell-reference:
 * the production web bundle (src/, the same CSS that ships) rendered in headless
 * Chromium at 1280×800, device-scale 1, DM Sans, reduced motion, light AND dark.
 * Every box comes from getBoundingClientRect() and every colour from
 * getComputedStyle(). Data is fictitious and local: API calls are answered by
 * the fixtures below, nothing touches a backend or the network.
 *
 *   npx vite --config scripts/vite-capture.config.mjs        # terminal 1
 *   DM_SANS_DIR=<@fontsource/dm-sans/files> node scripts/capture-desktop-reference.mjs [filter]
 *
 * Output: docs/desktop-pages-reference/{<screen>-<theme>.png, measurements.json, INVENTORY.md}
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import chromium from '@sparticuz/chromium';

const BASE = 'http://127.0.0.1:5173';
const OUT = 'docs/desktop-pages-reference';
mkdirSync(OUT, { recursive: true });
const filter = process.argv[2] || '';
const fontDir = process.env.DM_SANS_DIR || '';
const fontCss = fontDir && existsSync(fontDir)
  ? [400, 500, 600, 700, 800].map((w) => `@font-face{font-family:'DM Sans';font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${readFileSync(`${fontDir}/dm-sans-latin-${w}-normal.woff2`).toString('base64')}) format('woff2');}`).join('')
  : '';
if (!fontCss) console.warn('DM_SANS_DIR not set: captures fall back to a system font and must not be used as a pixel reference.');

/* ---------- screens ---------- */
const PAGES = [
  ['dashboard', '/dashboard'], ['products', '/products'], ['clients', '/clients'], ['employees', '/employees'],
  ['attendance', '/attendance'], ['quotes', '/quotes'], ['quick-sale', '/quick-sale'], ['invoices', '/invoices'],
  ['reimbursements', '/reimbursements'], ['receipts', '/receipts'], ['vendors', '/vendors'], ['bills', '/bills'],
  ['balance', '/balance'], ['cash-shifts', '/cash-shifts'], ['payroll', '/payroll'], ['reports', '/reports'],
  ['inventory-ops', '/inventory-ops'], ['actions', '/actions'],
];
// Every Settings section reachable from the web Settings sidebar, plus the
// tabs that are opened from inside a section (payroll, fec, dunning).
const SETTINGS = ['profile', 'company', 'attendance', 'invoicing', 'legal', 'documents', 'warehouse', 'categories',
  'agent', 'integrations', 'app', 'admin', 'audit', 'payroll', 'fec', 'dunning'];
const AGENT = [
  ['agent-open-empty', {}],
  ['agent-open-conversation', { conversation: true }],
];

// v0.9.4 — shell states the desktop must reproduce: account menu, logout
// confirmation, « Langue bientôt » popup, guided tour, compact density.
// Steps are data, not code: { selector } clicks a CSS match, { text } clicks the
// first button whose label starts with that text.
const openMenu = { selector: '.ac-topbar-user-btn' };
const clickText = (text) => ({ text });
const UI = [
  { name: 'ui-user-menu', path: '/dashboard', pre: [openMenu] },
  { name: 'ui-logout-confirm', path: '/dashboard', pre: [openMenu, clickText('Déconnexion')] },
  { name: 'ui-language-soon', path: '/dashboard', pre: [openMenu, clickText('Langue')] },
  { name: 'ui-onboarding-dashboard', path: '/dashboard', seed: { atlas_onboarding: JSON.stringify({ status: 'pending', step: 0 }) } },
  { name: 'ui-onboarding-sidebar', path: '/dashboard', seed: { atlas_onboarding: JSON.stringify({ status: 'pending', step: 1 }) } },
  { name: 'ui-onboarding-products', path: '/products', seed: { atlas_onboarding: JSON.stringify({ status: 'pending', step: 2 }) } },
  { name: 'ui-compact-products', path: '/products', seed: { atlas_ui_density: 'compact' } },
  { name: 'ui-compact-invoices', path: '/invoices', seed: { atlas_ui_density: 'compact' } },
].map((u) => ({ ...u, overlay: !u.name.startsWith('ui-compact') }));

const screens = [
  ...PAGES.map(([name, path]) => ({ name: `page-${name}`, path, fullPage: true })),
  ...SETTINGS.map((tab) => ({ name: `settings-${tab}`, path: `/settings?tab=${tab}`, fullPage: true })),
  ...AGENT.map(([name, o]) => ({ name, path: '/dashboard', agent: true, ...o })),
  ...UI,
].filter((s) => !filter || s.name.includes(filter));

/* ---------- measurement ---------- */
const MEASURE = () => {
  const SEL = 'h1,h2,h3,h4,p,label,button,a,input,select,textarea,th,td,[role="switch"],[role="tab"],[role="dialog"],.ac-panel,.card,.settings-card,.modal,.ac-status-pill,[class*="chip"],[class*="badge"],[class*="pill"],[class*="kpi"],[class*="toggle"],[class*="seg"],aside,nav,header';
  const keep = ['color', 'backgroundColor', 'borderTopWidth', 'borderTopColor', 'borderRadius', 'fontSize', 'fontWeight', 'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'boxShadow', 'gap', 'textTransform', 'letterSpacing'];
  const out = [];
  for (const el of document.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    const st = {};
    for (const k of keep) {
      const v = cs[k];
      if (v && v !== 'none' && v !== 'normal' && v !== '0px' && v !== 'rgba(0, 0, 0, 0)') st[k] = v.length > 90 ? `${v.slice(0, 90)}…` : v;
    }
    const text = (el.matches('input,textarea') ? (el.getAttribute('placeholder') || el.value || '') : (el.innerText || el.getAttribute('aria-label') || '')).replace(/\s+/g, ' ').trim();
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 90),
      role: el.getAttribute('role') || undefined,
      type: el.getAttribute('type') || undefined,
      text: text.slice(0, 80),
      x: Math.round(r.left * 10) / 10, y: Math.round((r.top + window.scrollY) * 10) / 10,
      w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
      st,
    });
    if (out.length >= 900) break;
  }
  return { doc: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }, nodes: out };
};

/* ---------- fixtures (fictitious marble shop) ---------- */
function installFixtures(theme) {
  const ls = { stock_auth_token: 'demo-token', stock_role: 'owner', stock_auth_user: 'amine', stock_display_name: 'Amine', 'atlas-theme': theme, 'atlas-sidebar-collapsed': '1', atlas_welcome_completed: 'true', 'atlas-whats-new-modal-seen': '9.9.9', 'atlas-whats-new-seen': '9.9.9', 'atlas-dl-teaser': 'off', 'atlas-tour-done': '1' };
  for (const [k, v] of Object.entries(ls)) localStorage.setItem(k, v);
  localStorage.setItem('atlas_cookie_consent_v1', JSON.stringify({ version: 1, necessary: true, preferences: false, analytics: false, method: 'necessary_only', decidedAt: '2026-01-01T00:00:00Z' }));
  const day = (d) => `2026-${d}`;
  const clients = [
    { id: 1, name: 'Promo Immo Agadir', ice: '001234567000089', city: 'Agadir', phone: '0661 23 45 67', email: 'achats@promoimmo.ma', balance: 42800, credit_limit: 60000, created_at: day('03-12') },
    { id: 2, name: 'Riad Al Bahja', ice: '002345678000012', city: 'Marrakech', phone: '0662 11 22 33', email: 'contact@riadbahja.ma', balance: 6400, credit_limit: 20000, created_at: day('05-02') },
    { id: 3, name: 'Atelier Zellige Fès', ice: '003456789000045', city: 'Fès', phone: '0670 98 76 54', email: 'atelier@zellige.ma', balance: 0, credit_limit: 15000, created_at: day('07-19') },
    { id: 4, name: 'Hôtel Oasis Casablanca', ice: '004567890000078', city: 'Casablanca', phone: '0522 44 55 66', email: 'travaux@oasis.ma', balance: 18250, credit_limit: 80000, created_at: day('08-28') },
  ];
  const vendors = [
    { id: 1, name: 'Carrières du Moyen Atlas', ice: '005678901000023', city: 'Khénifra', phone: '0535 12 34 56', email: 'ventes@cma.ma', balance: 23900 },
    { id: 2, name: 'Import Marbre Carrara SARL', ice: '006789012000056', city: 'Tanger', phone: '0539 77 88 99', email: 'order@carrara.ma', balance: 0 },
    { id: 3, name: 'Colles & Joints Maroc', ice: '007890123000089', city: 'Casablanca', phone: '0522 10 20 30', email: 'pro@cjm.ma', balance: 4100 },
  ];
  const products = [
    ['Marbre Carrara blanc 2cm', 'MAR-CAR-2', 'Marbre', 42, 5, 450, 290],
    ['Granit noir Zimbabwe', 'GRA-ZIM-3', 'Granit', 6, 10, 620, 410],
    ['Onyx miel', 'ONY-MIE-2', 'Onyx', 5, 8, 980, 640],
    ['Travertin classique', 'TRA-CLA-2', 'Travertin', 64, 10, 320, 190],
    ['Colle carrelage C2 25kg', 'COL-C2-25', 'Accessoires', 4, 12, 95, 58],
    ['Mosaïque zellige vert', 'MOS-ZEL-V', 'Zellige', 2, 6, 540, 330],
    ['Quartz blanc étoilé', 'QTZ-BLA-2', 'Quartz', 18, 5, 760, 500],
    ['Plinthe Thala', 'PLI-THA-10', 'Accessoires', 120, 20, 45, 22],
  ].map(([name, sku, category, stock, min, price, cost], i) => ({ id: i + 1, name, sku, barcode: `61100000000${i + 1}`, category, stock_quantity: stock, low_stock_threshold: min, unit_price: price, price, cost, unit: i < 4 || i === 6 ? 'm²' : 'u', track_inventory: 1, status: 'active' }));
  const inv = (id, number, client, total, paid, status, issue, due, kind = 'invoice') => ({ id, number, client_id: client.id, client_name: client.name, client_ice: client.ice, client_city: client.city, issue_date: day(issue), due_date: day(due), status, subtotal: Math.round(total / 1.2), tax_amount: total - Math.round(total / 1.2), total, amount_paid: paid, kind, created_at: day(issue) });
  const invoices = [
    inv(1, 'FA-2026-0147', clients[0], 42800, 0, 'overdue', '09-02', '10-02'),
    inv(2, 'FA-2026-0151', clients[3], 18250, 0, 'sent', '10-08', '11-08'),
    inv(3, 'FA-2026-0152', clients[1], 9600, 3200, 'partial', '10-12', '11-12'),
    inv(4, 'FA-2026-0155', clients[2], 5400, 5400, 'paid', '10-15', '11-15'),
    inv(5, 'VR-2026-0311', clients[1], 1687.2, 1687.2, 'paid', '10-20', '10-20', 'quick_sale'),
  ];
  const quotes = [inv(11, 'DV-2026-0088', clients[3], 64200, 0, 'quote', '10-14', '11-14', 'quote'), inv(12, 'DV-2026-0091', clients[0], 21800, 0, 'quote', '10-18', '11-18', 'quote')];
  const bills = [
    { id: 1, number: 'FAC-CMA-2291', vendor_id: 1, vendor_name: vendors[0].name, issue_date: day('09-28'), due_date: day('10-28'), status: 'overdue', subtotal: 19917, tax_amount: 3983, total: 23900, amount_paid: 0 },
    { id: 2, number: 'FAC-CJM-0412', vendor_id: 3, vendor_name: vendors[2].name, issue_date: day('10-10'), due_date: day('11-10'), status: 'unpaid', subtotal: 3417, tax_amount: 683, total: 4100, amount_paid: 0 },
    { id: 3, number: 'FAC-IMC-7781', vendor_id: 2, vendor_name: vendors[1].name, issue_date: day('10-01'), due_date: day('10-31'), status: 'paid', subtotal: 38333, tax_amount: 7667, total: 46000, amount_paid: 46000 },
  ];
  const receipts = [
    { id: 1, number: 'RC-2026-0201', invoice_id: 4, invoice_number: 'FA-2026-0155', client_name: clients[2].name, amount: 5400, payment_method: 'virement', issue_date: day('10-16') },
    { id: 2, number: 'RC-2026-0202', invoice_id: 3, invoice_number: 'FA-2026-0152', client_name: clients[1].name, amount: 3200, payment_method: 'especes', issue_date: day('10-18') },
  ];
  const employees = [
    ['EMP-001', 'Youssef', 'Benali', 'Chef d’atelier', 'Production', 9800],
    ['EMP-002', 'Khadija', 'Amrani', 'Comptable', 'Administration', 8500],
    ['EMP-003', 'Hamza', 'El Idrissi', 'Poseur', 'Chantier', 5200],
    ['EMP-004', 'Salma', 'Tazi', 'Vendeuse', 'Magasin', 4800],
  ].map(([emp_number, first_name, last_name, role_title, department, salary], i) => ({ id: i + 1, emp_number, first_name, last_name, name: `${first_name} ${last_name}`, role_title, department, category: 'cdi', employment_status: 'active', status: 'active', joined_date: day(`0${i + 1}-15`), base_salary: salary, phone: `0661 0${i} 00 0${i}` }));
  const expenses = [
    { id: 1, category: 'Loyer', description: 'Loyer dépôt octobre', amount: 6150, payment_method: 'virement', expense_date: day('10-05'), type: 'depense' },
    { id: 2, category: 'Transport', description: 'Livraison chantier Agadir', amount: 1800, payment_method: 'especes', expense_date: day('10-11'), type: 'depense' },
    { id: 3, category: 'Vente', description: 'Encaissement FA-2026-0155', amount: 5400, payment_method: 'virement', expense_date: day('10-16'), type: 'recette' },
  ];
  const cashShifts = [{ id: 1, till_id: 'Caisse 1', operator: 'salma', opened_at: `${day('10-20')}T08:30:00Z`, closed_at: null, opening_float: 500, expected_amount: 2187, status: 'open' }];
  const now = new Date('2026-10-20T10:30:00Z');
  const fr = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
  const monthlySeries = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    const sales = [84200, 91400, 78600, 102300, 96800, 118300][i];
    const expensesM = [61200, 64800, 59100, 70400, 68900, 74050][i];
    return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: `${fr[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, sales, expenses: expensesM, profit: sales - expensesM, invoices_fa: Math.round(sales * 0.7), sales_vr: Math.round(sales * 0.3), bills: Math.round(expensesM * 0.55), salaries: Math.round(expensesM * 0.45), receipts: Math.round(sales * 0.9), clients_new: [3, 5, 4, 7, 6, 8][i] };
  });
  const dashboard = { productCount: products.length, lowStockCount: 4, currentBalance: 48250, stockValue: 147000, todayRevenue: 12480, unpaidSales: { total: 67450, open: 24650, overdue: 42800, count: 3 }, unpaidPurchases: { total: 28000, open: 4100, overdue: 23900, count: 2 }, monthlySeries, recentInvoices: invoices.slice(0, 4), lowStock: products.filter((p) => p.stock_quantity <= p.low_stock_threshold) };
  const settings = { currency: 'MAD', company_name: 'Atlas Marbre SARL', company_city: 'Casablanca', tva_rate: 20, invoice_prefix: 'FA', quote_prefix: 'DV' };
  const policy = { blocked: false, isAdmin: true, dailyUsed: 1200, weeklyUsed: 5400, dailyLimit: 50000, weeklyLimit: 250000 };
  const me = { username: 'amine', role: 'owner', display_name: 'Amine', email: 'amine@atlas-marbre.ma' };
  const route = (p, q) => {
    if (p === '/api/auth/me') return me;
    if (p === '/api/dashboard') return dashboard;
    if (p === '/api/products') return products;
    if (p === '/api/clients') return clients;
    if (p === '/api/vendors') return vendors;
    if (p === '/api/invoices') return q.get('status') === 'quote' ? quotes : q.get('kind') === 'quick_sale' ? invoices.filter((x) => x.kind === 'quick_sale') : invoices;
    if (p === '/api/bills') return bills;
    if (p === '/api/receipts') return receipts;
    if (p === '/api/employees') return employees;
    if (p === '/api/expenses') return expenses;
    if (p === '/api/cash-shifts') return cashShifts;
    if (/^\/api\/cash-shifts\/\d+$/.test(p)) return { ...cashShifts[0], movements: [{ method: 'cash', direction: 'in', amount: 1687, label: 'VR-2026-0311' }], summary: { expectedCash: 2187, methods: { cash: { method: 'cash', label: 'Espèces', in_total: 1687, out_total: 0, expected: 2187, counted: null, variance: null } } } };
    if (p === '/api/settings') return settings;
    if (p === '/api/admin/app-update') return { minimumVersionEnabled: false, minimumSupportedVersionCode: 0, source: 'r2', manifest: { versionCode: 94, versionName: '0.9.4', apkUrl: 'https://cdn.example.ma/app-updates/android/latest.apk', mandatory: false, notes: 'Corrections et captures réelles.' }, json: { key: 'app-updates/android/latest.json', url: 'https://cdn.example.ma/app-updates/android/latest.json', size: 412, uploaded: `${day('11-24')}T18:00:00Z` }, apk: { key: 'app-updates/android/latest.apk', url: 'https://cdn.example.ma/app-updates/android/latest.apk', size: 18874368, uploaded: `${day('11-24')}T18:00:00Z` }, apkUrlExists: true, maxApkBytes: 104857600 };
    if (p === '/api/agent/policy') return policy;
    if (p === '/api/ledger/reconcile') return { summary: { ok: true }, counts: { invoice_payments: 12, balance_receipts: 12, receipts: 12 } };
    if (p === '/api/nav-badges') return {};
    if (p === '/api/alerts') return [];
    if (p === '/api/auth/devices') return [{ fingerprint: 'a1b2c3d4e5f6…', full: 'cur', last_ip: '105.66.1.2', last_seen: '2026-10-20 10:12', user_agent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/131', device_label: 'Linux · Chrome', city: 'Casablanca', country: 'MA', current: true }];
    if (p.startsWith('/api/assist/next-actions')) return { items: [{ priority: 1, title: '3 factures en retard', detail: '42 800 MAD à relancer — Promo Immo Agadir en tête', href: '/invoices' }, { priority: 2, title: '5 articles sous le seuil', detail: 'Granit noir Zimbabwe, Onyx miel, Colle C2…', href: '/products' }] };
    return [];
  };
  const orig = window.fetch;
  window.fetch = async (input, init) => {
    const u = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!u.pathname.startsWith('/api/')) return orig(input, init);
    return new Response(JSON.stringify({ success: true, data: route(u.pathname, u.searchParams) }), { headers: { 'content-type': 'application/json' } });
  };
}

const CONVERSATION = [
  { role: 'user', text: 'Combien de ventes cette semaine ?' },
  { role: 'assistant', text: 'Cette semaine : **23 ventes** pour **41 860 MAD**, dont 8 aujourd’hui.\n\n- Meilleur produit : Marbre Carrara blanc 2 cm (12 m²)\n- 3 factures restent à encaisser (6 400 MAD)\n\nVoulez-vous que je prépare les relances ?' },
  { role: 'user', text: 'Oui, prépare les relances.' },
  { role: 'assistant', text: 'J’ai préparé 3 brouillons de relance. Rien n’est envoyé sans votre validation.' },
];

/* ---------- run ---------- */
const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--no-sandbox'], headless: true });
const measurements = existsSync(`${OUT}/measurements.json`) ? JSON.parse(readFileSync(`${OUT}/measurements.json`, 'utf8')) : {};
measurements._meta = { viewport: '1280x800', dpr: 1, font: fontCss ? 'DM Sans (local woff2)' : 'fallback', motion: 'reduced', data: 'fictitious marble shop, user amine (owner), MAD', source: 'scripts/capture-desktop-reference.mjs' };
try {
  for (const theme of ['light', 'dark']) {
    for (const screen of screens) {
      const page = await browser.newPage();
      await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: theme }]);
      await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const u = req.url();
        if (fontCss && u.startsWith('https://fonts.googleapis.com/')) return void req.respond({ status: 200, contentType: 'text/css', body: fontCss });
        if (!u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:')) return void req.abort();
        return void req.continue();
      });
      await page.evaluateOnNewDocument(installFixtures, theme);
      if (screen.conversation) {
        await page.evaluateOnNewDocument((msgs) => {
          localStorage.setItem('atlas_agent_active_thread', 't1');
          localStorage.setItem('atlas_agent_active_thread:amine', 't1');
          localStorage.setItem('atlas_agent_msgs_v1:amine:t1', JSON.stringify(msgs));
          localStorage.setItem('atlas_agent_threads_v1:amine', JSON.stringify([{ id: 't1', title: 'Ventes de la semaine', updatedAt: '2026-10-20T10:00:00Z' }]));
        }, CONVERSATION);
      }
      // localStorage is shared by every page of this browser: reset per-screen state first.
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem('atlas_onboarding', JSON.stringify({ status: 'done', step: 0 }));
        localStorage.setItem('atlas_ui_density', 'comfortable');
      });
      if (screen.seed) {
        await page.evaluateOnNewDocument((seed) => { for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v); }, screen.seed);
      }
      await page.goto(BASE + screen.path, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1200));
      for (const step of screen.pre || []) {
        await page.evaluate(({ selector, text }) => {
          const el = selector
            ? document.querySelector(selector)
            : [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim().startsWith(text));
          el?.click();
        }, step);
        await new Promise((r) => setTimeout(r, 700));
      }
      if (screen.agent) {
        await page.evaluate(() => document.querySelector('.atlas-agent-fab')?.click());
        await new Promise((r) => setTimeout(r, 900));
      }
      const crash = await page.evaluate(() => document.querySelector('.error-boundary-root')?.innerText || '');
      if (crash) console.warn(`CRASH ${screen.name}-${theme}: ${crash.slice(0, 120)}`);
      const key = `${screen.name}-${theme}`;
      measurements[key] = await page.evaluate(MEASURE);
      // Viewport slices, never a full-page resize (resizing re-renders the page
      // and shows loading skeletons). Slice n is scrolled to y = n × 720.
      await page.screenshot({ path: `${OUT}/${key}.png` });
      // A theme switch can leave a transient grey layer for a frame or two. The page
      // background at (80, 90) must be the theme background; otherwise wait and retake.
      // Overlay states dim the page on purpose: no background check there.
      for (let tries = 0; tries < (screen.overlay ? 0 : 3); tries++) {
        const { data } = await sharp(`${OUT}/${key}.png`).extract({ left: 80, top: 90, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
        const ok = theme === 'dark' ? data[0] < 30 : data[0] > 236;
        if (ok) break;
        console.warn(`  retake ${key}: background rgb(${data[0]},${data[1]},${data[2]})`);
        await new Promise((r) => setTimeout(r, 1500));
        await page.screenshot({ path: `${OUT}/${key}.png` });
      }
      const slices = [];
      const stalePrefix = `${screen.name}-y`;
      const staleSuffix = `-${theme}.png`;
      const isStale = (f) => f.startsWith(stalePrefix) && f.endsWith(staleSuffix)
        && /^[0-9]+$/.test(f.slice(stalePrefix.length, f.length - staleSuffix.length));
      for (const f of readdirSync(OUT)) if (isStale(f)) rmSync(`${OUT}/${f}`);
      if (screen.fullPage) {
        for (let y = 720; y < Math.min(measurements[key].doc.h - 80, 720 * 8); y += 720) {
          await page.evaluate((top) => window.scrollTo(0, top), y);
          await new Promise((r) => setTimeout(r, 350));
          const name = `${screen.name}-y${y}-${theme}`;
          await page.screenshot({ path: `${OUT}/${name}.png` });
          slices.push(`${name}.png`);
        }
      }
      measurements[key].slices = slices;
      console.log(`${key}  doc ${measurements[key].doc.w}×${measurements[key].doc.h}  nodes ${measurements[key].nodes.length}  slices ${slices.length}`);
      await page.close();
    }
  }
} finally { await browser.close(); }
writeFileSync(`${OUT}/measurements.json`, JSON.stringify(measurements));

/* ---------- human-readable inventory ---------- */
const kind = (n) => n.tag === 'button' || n.role === 'switch' || n.role === 'tab' ? (n.role || 'button')
  : /^h[1-4]$/.test(n.tag) ? n.tag : ['input', 'select', 'textarea'].includes(n.tag) ? n.tag : n.tag === 'th' ? 'col' : n.tag === 'label' ? 'label' : null;
const lines = ['# Desktop pages reference: element inventory', '', 'Generated by `scripts/capture-desktop-reference.mjs` from `measurements.json` (light theme order; dark values in the JSON).',
  'Every heading, label, control and table column on each screen, in reading order, with its box (x, y, w, h in px at 1280×800) and computed style.',
  'Colours: `bg` background, `fg` text. `r` radius. `b` top border. Use the PNG next to it as the visual truth.', ''];
for (const key of Object.keys(measurements).filter((k) => k.endsWith('-light')).sort()) {
  const m = measurements[key];
  const dark = measurements[key.replace(/-light$/, '-dark')];
  lines.push(`## ${key.replace(/-light$/, '')}`, '', `PNG: \`${key}.png\` / \`${key.replace(/-light$/, '-dark')}.png\`${m.slices?.length ? ` + scroll slices ${m.slices.map((x) => `\`${x}\``).join(', ')} (and \`-dark\`)` : ''} · document ${m.doc.w}×${m.doc.h}`, '',
    '| kind | text | x | y | w | h | light bg / fg | dark bg / fg | r | b | font |', '|---|---|---|---|---|---|---|---|---|---|---|');
  const seen = new Set();
  const nodes = m.nodes.map((n, i) => ({ n, d: dark?.nodes?.[i] })).filter(({ n }) => kind(n) && (n.text || n.tag === 'input' || n.tag === 'select')).sort((a, b) => a.n.y - b.n.y || a.n.x - b.n.x);
  for (const { n, d } of nodes) {
    const id = `${kind(n)}|${n.text}|${Math.round(n.x)}|${Math.round(n.y)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const s = n.st || {};
    const ds = d && d.tag === n.tag && d.text === n.text ? d.st || {} : {};
    const cell = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
    lines.push(`| ${kind(n)} | ${cell(n.text.slice(0, 48))} | ${n.x} | ${n.y} | ${n.w} | ${n.h} | ${cell(s.backgroundColor || '—')} / ${cell(s.color || '')} | ${cell(ds.backgroundColor || '—')} / ${cell(ds.color || '')} | ${cell(s.borderRadius || '0')} | ${cell(s.borderTopWidth ? `${s.borderTopWidth} ${s.borderTopColor}` : '—')} | ${cell(`${s.fontSize || ''} ${s.fontWeight || ''}`)} |`);
  }
  lines.push('');
}
writeFileSync(`${OUT}/INVENTORY.md`, `${lines.join('\n')}\n`);
console.log(`wrote ${OUT}/INVENTORY.md`);
