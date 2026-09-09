/**
 * Atlas Commerce — Demo Sandbox Engine
 * Fully isolated from live D1 / account data.
 *
 * Flag:  localStorage.atlas_demo_active = 'true'
 * Data:  localStorage.atlas_demo_db_v1  (JSON sandbox, persists until explicit exit)
 */

const FLAG_KEY = 'atlas_demo_active';
const LEGACY_FLAG = 'atlas_demo_mode';
const DB_KEY = 'atlas_demo_db_v1';
const LEGACY_SESSION = 'atlas_demo_sandbox_v1';

export type DemoClient = {
  id: number;
  name: string;
  ice?: string;
  if_number?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  credit_limit?: number;
};

export type DemoProduct = {
  id: number;
  name: string;
  sku?: string;
  barcode?: string;
  price: number;
  cost?: number;
  stock_quantity: number;
  unit: string;
  category: string;
  track_inventory: number;
  low_stock_threshold: number;
  is_active: number;
  description?: string;
};

export type DemoInvoice = {
  id: number;
  number: string;
  client_id?: number;
  client_name: string;
  client_ice?: string;
  client_address?: string;
  client_city?: string;
  client_phone?: string;
  status: string;
  total: number;
  subtotal: number;
  tax_amount: number;
  amount_paid: number;
  issue_date: string;
  due_date?: string;
  notes?: string;
  items?: DemoLine[];
};

export type DemoLine = {
  product_id?: number;
  product_name: string;
  quantity: number;
  unit_price: number;
  list_price?: number;
  tax_rate?: number;
  line_total?: number;
};

export type DemoSeller = {
  id: number;
  name: string;
  role: string;
  email?: string;
  phone?: string;
  active: number;
};

export type DemoExpense = {
  id: number;
  description: string;
  amount: number;
  category: string;
  expense_date: string;
  entry_type?: string;
};

export type DemoSandbox = {
  version: 1;
  clients: DemoClient[];
  products: DemoProduct[];
  invoices: DemoInvoice[];
  quotes: DemoInvoice[];
  expenses: DemoExpense[];
  sellers: DemoSeller[];
  nextId: number;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export function buildFreshSandbox(): DemoSandbox {
  const day = today();
  return {
    version: 1,
    nextId: 200,
    clients: [
      {
        id: 1,
        name: 'SARL Casa Marbre',
        city: 'Casablanca',
        address: 'Bd Zerktouni 45',
        phone: '0522 00 11 22',
        email: 'contact@casamarbre.ma',
        ice: '001234567000012',
        if_number: '12345678',
        credit_limit: 50000,
      },
      {
        id: 2,
        name: 'Entreprise Rabat Pro',
        city: 'Rabat',
        address: 'Av. Hassan II 12',
        phone: '0537 33 44 55',
        email: 'achat@rabatpro.ma',
        ice: '001234567000034',
        credit_limit: 25000,
      },
      {
        id: 3,
        name: 'Showroom Atlas El Jadida',
        city: 'El Jadida',
        address: 'Zone industrielle',
        phone: '0523 55 66 77',
        ice: '001234567000099',
        credit_limit: 80000,
      },
      {
        id: 4,
        name: 'Particulier — Amine B.',
        city: 'Marrakech',
        phone: '0612 34 56 78',
        address: 'Guéliz',
      },
    ],
    products: [
      {
        id: 1,
        name: 'Carrelage porcelaine 60×60',
        sku: 'CARR-60-BL',
        barcode: '6111256000011',
        price: 189,
        cost: 120,
        stock_quantity: 420,
        unit: 'm²',
        category: 'Carrelage',
        track_inventory: 1,
        low_stock_threshold: 40,
        is_active: 1,
      },
      {
        id: 2,
        name: 'Marbre blanc veiné',
        sku: 'MARB-BL-V',
        price: 450,
        cost: 280,
        stock_quantity: 85,
        unit: 'm²',
        category: 'Marbre',
        track_inventory: 1,
        low_stock_threshold: 15,
        is_active: 1,
      },
      {
        id: 3,
        name: 'Colle carrelage C2 25kg',
        sku: 'COLLE-C2-25',
        price: 65,
        cost: 42,
        stock_quantity: 12,
        unit: 'sac',
        category: 'Consommables',
        track_inventory: 1,
        low_stock_threshold: 20,
        is_active: 1,
      },
      {
        id: 4,
        name: 'Joint époxy kit 5kg',
        sku: 'JOINT-EPX',
        price: 120,
        cost: 75,
        stock_quantity: 28,
        unit: 'kit',
        category: 'Consommables',
        track_inventory: 1,
        low_stock_threshold: 8,
        is_active: 1,
      },
      {
        id: 5,
        name: 'Granit noir absolu',
        sku: 'GRAN-NOIR',
        price: 620,
        cost: 400,
        stock_quantity: 3,
        unit: 'm²',
        category: 'Granit',
        track_inventory: 1,
        low_stock_threshold: 10,
        is_active: 1,
      },
      {
        id: 6,
        name: 'Plinthe céramique 8cm',
        sku: 'PLIN-8',
        price: 28,
        cost: 15,
        stock_quantity: 200,
        unit: 'ml',
        category: 'Carrelage',
        track_inventory: 1,
        low_stock_threshold: 30,
        is_active: 1,
      },
    ],
    invoices: [
      {
        id: 10,
        number: 'FA-DEMO-001',
        client_id: 1,
        client_name: 'SARL Casa Marbre',
        client_ice: '001234567000012',
        client_city: 'Casablanca',
        status: 'paid',
        subtotal: 1575,
        tax_amount: 315,
        total: 1890,
        amount_paid: 1890,
        issue_date: daysAgo(12),
        due_date: daysAgo(5),
        items: [
          { product_id: 1, product_name: 'Carrelage porcelaine 60×60', quantity: 10, unit_price: 157.5, tax_rate: 20, line_total: 1890 },
        ],
      },
      {
        id: 11,
        number: 'FA-DEMO-002',
        client_id: 2,
        client_name: 'Entreprise Rabat Pro',
        client_ice: '001234567000034',
        status: 'sent',
        subtotal: 1083.33,
        tax_amount: 216.67,
        total: 1300,
        amount_paid: 0,
        issue_date: daysAgo(3),
        due_date: (() => { const d = new Date(); d.setDate(d.getDate() + 10); return d.toISOString().slice(0, 10); })(),
        items: [
          { product_id: 2, product_name: 'Marbre blanc veiné', quantity: 2, unit_price: 450, tax_rate: 20, line_total: 1080 },
          { product_id: 3, product_name: 'Colle carrelage C2 25kg', quantity: 2, unit_price: 65, tax_rate: 20, line_total: 156 },
        ],
      },
      {
        id: 12,
        number: 'FA-DEMO-003',
        client_id: 4,
        client_name: 'Particulier — Amine B.',
        status: 'partial',
        subtotal: 500,
        tax_amount: 100,
        total: 600,
        amount_paid: 200,
        issue_date: daysAgo(20),
        due_date: daysAgo(5),
        items: [
          { product_id: 6, product_name: 'Plinthe céramique 8cm', quantity: 20, unit_price: 28, tax_rate: 20, line_total: 672 },
        ],
      },
      {
        id: 13,
        number: 'FA-DEMO-004',
        client_id: 3,
        client_name: 'Showroom Atlas El Jadida',
        status: 'overdue',
        subtotal: 2500,
        tax_amount: 500,
        total: 3000,
        amount_paid: 0,
        issue_date: daysAgo(45),
        due_date: daysAgo(30),
        items: [
          { product_id: 5, product_name: 'Granit noir absolu', quantity: 4, unit_price: 620, tax_rate: 20, line_total: 2976 },
        ],
      },
    ],
    quotes: [
      {
        id: 20,
        number: 'DV-DEMO-001',
        client_id: 3,
        client_name: 'Showroom Atlas El Jadida',
        status: 'quote',
        subtotal: 3000,
        tax_amount: 600,
        total: 3600,
        amount_paid: 0,
        issue_date: day,
        due_date: (() => { const d = new Date(); d.setDate(d.getDate() + 15); return d.toISOString().slice(0, 10); })(),
        items: [
          { product_id: 2, product_name: 'Marbre blanc veiné', quantity: 6, unit_price: 450, tax_rate: 20, line_total: 3240 },
          { product_id: 4, product_name: 'Joint époxy kit 5kg', quantity: 3, unit_price: 120, tax_rate: 20, line_total: 432 },
        ],
      },
      {
        id: 21,
        number: 'DV-DEMO-002',
        client_id: 1,
        client_name: 'SARL Casa Marbre',
        status: 'quote',
        subtotal: 800,
        tax_amount: 160,
        total: 960,
        amount_paid: 0,
        issue_date: daysAgo(2),
        items: [
          { product_id: 1, product_name: 'Carrelage porcelaine 60×60', quantity: 5, unit_price: 189, tax_rate: 20, line_total: 1134 },
        ],
      },
    ],
    sellers: [
      { id: 1, name: 'Sara Admin', role: 'admin', email: 'sara@demo.atlas.ma', phone: '0611000001', active: 1 },
      { id: 2, name: 'Youssef Vente', role: 'secretaire', email: 'youssef@demo.atlas.ma', phone: '0611000002', active: 1 },
      { id: 3, name: 'Karim Stock', role: 'stock', email: 'karim@demo.atlas.ma', phone: '0611000003', active: 1 },
    ],
    expenses: [
      { id: 30, description: 'Loyer magasin mars', amount: 4500, category: 'Loyer', expense_date: daysAgo(8), entry_type: 'expense' },
      { id: 31, description: 'Électricité & eau', amount: 820, category: 'Charges', expense_date: daysAgo(5), entry_type: 'expense' },
      { id: 32, description: 'Transport livraisons', amount: 450, category: 'Transport', expense_date: daysAgo(2), entry_type: 'expense' },
      { id: 33, description: 'Achat stock colle', amount: 1200, category: 'Achats', expense_date: daysAgo(1), entry_type: 'expense' },
    ],
  };
}

function migrateLegacyFlag() {
  try {
    if (localStorage.getItem(FLAG_KEY) === 'true') return;
    if (localStorage.getItem(LEGACY_FLAG) === '1') {
      localStorage.setItem(FLAG_KEY, 'true');
      localStorage.removeItem(LEGACY_FLAG);
    }
  } catch {
    /* */
  }
}

export function isDemoMode(): boolean {
  migrateLegacyFlag();
  try {
    return localStorage.getItem(FLAG_KEY) === 'true';
  } catch {
    return false;
  }
}

export function getSandbox(): DemoSandbox {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoSandbox;
      if (parsed?.version === 1 && Array.isArray(parsed.clients)) {
        if (!Array.isArray((parsed as any).sellers)) {
          (parsed as any).sellers = buildFreshSandbox().sellers;
          saveSandbox(parsed);
        }
        return parsed;
      }
    }
    // migrate session sandbox once
    const legacy = sessionStorage.getItem(LEGACY_SESSION);
    if (legacy) {
      const parsed = JSON.parse(legacy) as DemoSandbox;
      if (parsed && Array.isArray(parsed.clients)) {
        const upgraded: DemoSandbox = {
          version: 1,
          clients: parsed.clients || [],
          products: parsed.products || [],
          invoices: parsed.invoices || [],
          quotes: parsed.quotes || [],
          expenses: (parsed.expenses as any) || [],
          sellers: (parsed as any).sellers || buildFreshSandbox().sellers,
          nextId: parsed.nextId || 200,
        };
        saveSandbox(upgraded);
        sessionStorage.removeItem(LEGACY_SESSION);
        return upgraded;
      }
    }
  } catch {
    /* */
  }
  const fresh = buildFreshSandbox();
  saveSandbox(fresh);
  return fresh;
}

export function saveSandbox(data: DemoSandbox) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(data));
  } catch {
    /* quota */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('atlas-demo-data', { detail: data }));
  }
}

export function enterDemoMode() {
  try {
    localStorage.setItem(FLAG_KEY, 'true');
    localStorage.removeItem(LEGACY_FLAG);
  } catch {
    /* */
  }
  if (!localStorage.getItem(DB_KEY)) {
    saveSandbox(buildFreshSandbox());
  } else {
    getSandbox();
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('atlas-demo-mode', { detail: { on: true } }));
  }
}

/** Exit: purge ONLY demo namespace. Live account data untouched. */
export function exitDemoMode() {
  try {
    localStorage.removeItem(FLAG_KEY);
    localStorage.removeItem(LEGACY_FLAG);
    localStorage.removeItem(DB_KEY);
    sessionStorage.removeItem(LEGACY_SESSION);
  } catch {
    /* */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('atlas-demo-mode', { detail: { on: false } }));
  }
}

/** Reset demo data to factory seed without exiting demo mode. */
export function resetDemoData() {
  const fresh = buildFreshSandbox();
  saveSandbox(fresh);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('atlas-demo-mode', { detail: { on: true, reset: true } }));
  }
  return fresh;
}

/** @deprecated */
export function setDemoMode(on: boolean) {
  if (on) enterDemoMode();
  else exitDemoMode();
}

export function demoCreateClient(input: Partial<DemoClient> & { name: string }) {
  const sb = getSandbox();
  const id = sb.nextId++;
  const row: DemoClient = {
    id,
    name: input.name,
    ice: input.ice,
    if_number: input.if_number,
    phone: input.phone,
    email: input.email,
    address: input.address,
    city: input.city,
    credit_limit: input.credit_limit,
  };
  sb.clients = [row, ...sb.clients];
  saveSandbox(sb);
  return row;
}

export function demoCreateProduct(input: Partial<DemoProduct> & { name: string }) {
  const sb = getSandbox();
  const id = sb.nextId++;
  const row: DemoProduct = {
    id,
    name: input.name,
    sku: input.sku,
    barcode: input.barcode,
    price: Number(input.price ?? 0),
    cost: Number(input.cost ?? 0),
    stock_quantity: Number(input.stock_quantity ?? 0),
    unit: input.unit || 'unité',
    category: input.category || 'Général',
    track_inventory: input.track_inventory ?? 1,
    low_stock_threshold: input.low_stock_threshold ?? 5,
    is_active: 1,
    description: input.description,
  };
  sb.products = [row, ...sb.products];
  saveSandbox(sb);
  return row;
}

function dashboardFromSandbox(sb: DemoSandbox) {
  const inv = sb.invoices.filter((i) => !['quote', 'devis', 'cancelled'].includes(i.status));
  const sales = inv.reduce((s, i) => s + Number(i.total || 0), 0);
  const unpaid = inv
    .filter((i) => ['sent', 'partial', 'overdue'].includes(i.status))
    .reduce((s, i) => s + Math.max(0, Number(i.total) - Number(i.amount_paid || 0)), 0);
  const low = sb.products.filter(
    (p) => p.track_inventory && p.stock_quantity <= p.low_stock_threshold,
  ).length;
  const exp = sb.expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  return {
    products: sb.products.length,
    clients: sb.clients.length,
    sales_today: sales * 0.15,
    sales_month: sales,
    unpaid,
    open_quotes: sb.quotes.length,
    low_stock: low,
    expenses_month: exp,
    invoices_count: inv.length,
    demo: true,
  };
}

function findInvoice(sb: DemoSandbox, id: number) {
  return sb.invoices.find((i) => i.id === id) || sb.quotes.find((i) => i.id === id);
}

/** Build a printable HTML document for a demo invoice/quote (client-side PDF/print). */
export function demoInvoiceHtml(inv: DemoInvoice, title = 'FACTURE'): string {
  const lines = (inv.items || [])
    .map(
      (it) =>
        `<tr><td>${escapeHtml(it.product_name)}</td><td style="text-align:center">${it.quantity}</td><td style="text-align:right">${fmt(it.unit_price)}</td><td style="text-align:right">${fmt(it.line_total ?? it.quantity * it.unit_price)}</td></tr>`,
    )
    .join('');
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/><title>${title} ${escapeHtml(inv.number)}</title>
<style>
html,body{height:100%}
body{font-family:Arial,Helvetica,sans-serif;color:#000;padding:0;max-width:210mm;margin:0 auto}
.sheet{min-height:calc(297mm - 24mm);display:flex;flex-direction:column;padding:12mm;box-sizing:border-box}
.main{flex:1 1 auto}.foot{margin-top:auto;page-break-inside:avoid}
h1{font-size:20px;margin:0 0 8px}table{width:100%;border-collapse:collapse;margin-top:16px}
th,td{border:1px solid #000;padding:6px 8px;font-size:12px}th{background:#f3f3f3}
.muted{color:#444;font-size:12px}.tot{margin-top:12px;text-align:right;font-size:13px}
.banner{background:#fef3c7;border:1px solid #fcd34d;padding:8px;margin-bottom:16px;font-size:12px}
@page{size:A4;margin:12mm}
</style></head><body>
<div class="banner">Document généré en Mode Démonstration — données d’exemple uniquement.</div>
<h1>${title} ${escapeHtml(inv.number)}</h1>
<p class="muted">Date : ${escapeHtml(inv.issue_date || '')} · Statut : ${escapeHtml(inv.status)}</p>
<p><strong>Client :</strong> ${escapeHtml(inv.client_name)}${inv.client_ice ? ' · ICE ' + escapeHtml(inv.client_ice) : ''}<br/>
${inv.client_address ? escapeHtml(inv.client_address) + '<br/>' : ''}${inv.client_city ? escapeHtml(inv.client_city) : ''}</p>
<table><thead><tr><th>Désignation</th><th>Qté</th><th>P.U.</th><th>Total</th></tr></thead>
<tbody>${lines || '<tr><td colspan="4">Aucune ligne</td></tr>'}</tbody></table>
<div class="tot">
<div>Sous-total HT : ${fmt(inv.subtotal)} MAD</div>
<div>TVA : ${fmt(inv.tax_amount)} MAD</div>
<div><strong>Total TTC : ${fmt(inv.total)} MAD</strong></div>
${inv.amount_paid ? `<div>Payé : ${fmt(inv.amount_paid)} MAD</div>` : ''}
</div>
<script>window.onload=function(){try{window.print()}catch(e){}}<\/script>
</body></html>`;
}

function escapeHtml(s: string) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

export function openDemoInvoicePrint(id: number) {
  const sb = getSandbox();
  const inv = findInvoice(sb, id);
  if (!inv) return false;
  const isQuote = inv.status === 'quote' || inv.status === 'devis' || String(inv.number || '').startsWith('DV');
  const html = demoInvoiceHtml(inv, isQuote ? 'DEVIS' : 'FACTURE');
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

/**
 * Intercept API while demo mode is on.
 * Returns response-shaped object or null to fall through (rarely needed).
 */

/** Company header used in demo PDFs / reports */
export function demoCompany() {
  return {
    company_name: 'Atlas Commerce (Démo)',
    legal_form: 'SARL',
    address: 'Zone industrielle, lot 12',
    city: 'El Jadida',
    phone: '0523 00 00 00',
    email: 'demo@atlas-commerce.ma',
    ice: '001234567000001',
    if_number: '11223344',
    rc: 'RC El Jadida 12345',
    patente: 'TP-DEMO-01',
    currency: 'MAD',
    tax_rate: 20,
  };
}

export function openDemoHtml(title: string, bodyHtml: string) {
  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/><title>${title}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;color:#000;padding:24px;max-width:900px;margin:0 auto;font-size:12px}
h1{font-size:18px;margin:0 0 8px}table{width:100%;border-collapse:collapse;margin-top:12px}
th,td{border:1px solid #000;padding:6px 8px;text-align:left}th{background:#f3f3f3}
.banner{background:#fef3c7;border:1px solid #fcd34d;padding:8px;margin-bottom:14px;font-size:11px}
.muted{color:#444;font-size:11px}.tot{margin-top:12px;text-align:right}
</style></head><body>
<div class="banner">Document Mode Démonstration — aucune donnée réelle n’est utilisée.</div>
${bodyHtml}
<script>window.onload=function(){try{window.print()}catch(e){}}<\/script>
</body></html>`;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(url), 90_000);
}

export function openDemoReport(path: string) {
  const sb = getSandbox();
  const co = demoCompany();
  const base = path.split('?')[0];
  if (base.includes('receivables') || base.includes('aging')) {
    const rows = sb.invoices
      .filter((i) => ['sent', 'partial', 'overdue'].includes(i.status))
      .map(
        (i) =>
          `<tr><td>${escapeHtml(i.number)}</td><td>${escapeHtml(i.client_name)}</td><td>${escapeHtml(i.status)}</td><td style="text-align:right">${fmt(i.total - (i.amount_paid || 0))}</td></tr>`,
      )
      .join('');
    openDemoHtml(
      'Créances clients (démo)',
      `<h1>Créances clients</h1><p class="muted">${escapeHtml(co.company_name)} · ${escapeHtml(co.city)}</p>
      <table><thead><tr><th>N°</th><th>Client</th><th>Statut</th><th>Reste MAD</th></tr></thead><tbody>${rows || '<tr><td colspan="4">Aucune créance</td></tr>'}</tbody></table>`,
    );
    return true;
  }
  if (base.includes('closing') || base.includes('day-close') || base.includes('pack')) {
    const sales = sb.invoices.reduce((s, i) => s + Number(i.total || 0), 0);
    const unpaid = sb.invoices
      .filter((i) => ['sent', 'partial', 'overdue'].includes(i.status))
      .reduce((s, i) => s + Math.max(0, Number(i.total) - Number(i.amount_paid || 0)), 0);
    const exp = sb.expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
    const low = sb.products.filter((p) => p.stock_quantity <= p.low_stock_threshold).length;
    openDemoHtml(
      'Pack clôture (démo)',
      `<h1>Pack de clôture</h1><p class="muted">${escapeHtml(co.company_name)}</p>
      <table><tbody>
      <tr><td>Ventes (échantillon)</td><td style="text-align:right">${fmt(sales)} MAD</td></tr>
      <tr><td>Créances ouvertes</td><td style="text-align:right">${fmt(unpaid)} MAD</td></tr>
      <tr><td>Dépenses</td><td style="text-align:right">${fmt(exp)} MAD</td></tr>
      <tr><td>Produits stock bas</td><td style="text-align:right">${low}</td></tr>
      <tr><td>Devis ouverts</td><td style="text-align:right">${sb.quotes.length}</td></tr>
      </tbody></table>`,
    );
    return true;
  }
  // Generic stock / balance style report
  const prodRows = sb.products
    .map(
      (p) =>
        `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.sku || '')}</td><td style="text-align:right">${p.stock_quantity}</td><td style="text-align:right">${fmt(p.price)}</td></tr>`,
    )
    .join('');
  openDemoHtml(
    'Rapport démo',
    `<h1>Rapport</h1><p class="muted">${escapeHtml(path)}</p>
    <h2 style="font-size:14px;margin-top:16px">Stock</h2>
    <table><thead><tr><th>Produit</th><th>SKU</th><th>Stock</th><th>Prix</th></tr></thead>
    <tbody>${prodRows}</tbody></table>`,
  );
  return true;
}

export function demoApiIntercept(
  method: string,
  path: string,
  body?: unknown,
): { success: true; data: unknown; message?: string; meta?: { demo: true } } | { success: false; error: string } | null {
  if (!isDemoMode()) return null;
  const m = method.toUpperCase();
  const [basePath, qs] = path.split('?');
  const base = basePath;
  const sb = getSandbox();
  const ok = (data: unknown, message?: string) => ({
    success: true as const,
    data,
    message,
    meta: { demo: true as const },
  });

  // Dashboard
  if (m === 'GET' && base === '/api/dashboard') {
    return ok(dashboardFromSandbox(sb));
  }

  // Clients
  if (m === 'GET' && (base === '/api/clients' || base.startsWith('/api/clients/'))) {
    if (base === '/api/clients') return ok(sb.clients);
    const id = Number(base.split('/').pop());
    const row = sb.clients.find((c) => c.id === id);
    return row ? ok(row) : { success: false, error: 'Client démo introuvable' };
  }
  if (m === 'POST' && base === '/api/clients') {
    const b = (body || {}) as Partial<DemoClient>;
    const row = demoCreateClient({ name: String(b.name || 'Client démo'), ...b });
    return ok(row, `Client « ${row.name} » créé (démo)`);
  }
  if ((m === 'PUT' || m === 'PATCH') && base.startsWith('/api/clients/')) {
    const id = Number(base.split('/').pop());
    const b = (body || {}) as Partial<DemoClient>;
    const idx = sb.clients.findIndex((c) => c.id === id);
    if (idx < 0) return { success: false, error: 'Client démo introuvable' };
    sb.clients[idx] = { ...sb.clients[idx], ...b, id };
    saveSandbox(sb);
    return ok(sb.clients[idx], 'Client mis à jour (démo)');
  }
  if (m === 'DELETE' && base.startsWith('/api/clients/')) {
    const id = Number(base.split('/').pop());
    sb.clients = sb.clients.filter((c) => c.id !== id);
    saveSandbox(sb);
    return ok({ id }, 'Client supprimé (démo)');
  }

  // Products
  if (m === 'GET' && (base === '/api/products' || base.startsWith('/api/products/'))) {
    if (base === '/api/products') return ok(sb.products);
    const id = Number(base.split('/').pop());
    const row = sb.products.find((p) => p.id === id);
    return row ? ok(row) : { success: false, error: 'Produit démo introuvable' };
  }
  if (m === 'POST' && base === '/api/products') {
    const b = (body || {}) as Partial<DemoProduct>;
    const row = demoCreateProduct({ name: String(b.name || 'Produit démo'), ...b });
    return ok(row, `Produit « ${row.name} » créé (démo)`);
  }
  if ((m === 'PUT' || m === 'PATCH') && base.startsWith('/api/products/')) {
    const id = Number(base.split('/').pop());
    const b = (body || {}) as Partial<DemoProduct>;
    const idx = sb.products.findIndex((p) => p.id === id);
    if (idx < 0) return { success: false, error: 'Produit démo introuvable' };
    sb.products[idx] = { ...sb.products[idx], ...b, id } as DemoProduct;
    saveSandbox(sb);
    return ok(sb.products[idx], 'Produit mis à jour (démo)');
  }
  if (m === 'DELETE' && base.startsWith('/api/products/')) {
    const id = Number(base.split('/').pop());
    sb.products = sb.products.filter((p) => p.id !== id);
    saveSandbox(sb);
    return ok({ id }, 'Produit supprimé (démo)');
  }

  // Invoices + quotes list
  if (m === 'GET' && base === '/api/invoices') {
    const params = new URLSearchParams(qs || '');
    const status = params.get('status') || '';
    const kind = params.get('kind') || '';
    let list = [...sb.invoices, ...sb.quotes];
    if (kind === 'quote' || status === 'quote' || status === 'devis') list = [...sb.quotes];
    else if (status) list = list.filter((i) => i.status === status);
    return ok(list);
  }
  if (m === 'GET' && /^\/api\/invoices\/\d+$/.test(base)) {
    const id = Number(base.split('/').pop());
    const row = findInvoice(sb, id);
    if (!row) return { success: false, error: 'Document démo introuvable' };
    return ok({ ...row, items: row.items || [] });
  }
  if (m === 'POST' && base === '/api/invoices') {
    const b = (body || {}) as any;
    const id = sb.nextId++;
    const isQuote = b.status === 'quote' || b.status === 'devis' || b.doc_kind === 'quote';
    const items: DemoLine[] = (b.items || []).map((it: any) => ({
      product_id: it.product_id,
      product_name: it.product_name || 'Article',
      quantity: Number(it.quantity || 1),
      unit_price: Number(it.unit_price || 0),
      list_price: Number(it.list_price || it.unit_price || 0),
      tax_rate: Number(it.tax_rate ?? 20),
      line_total: Number(it.quantity || 1) * Number(it.unit_price || 0) * (1 + Number(it.tax_rate ?? 20) / 100),
    }));
    const subtotal = items.reduce((s, it) => s + it.quantity * it.unit_price, 0);
    const tax = items.reduce((s, it) => s + it.quantity * it.unit_price * ((it.tax_rate || 20) / 100), 0);
    const row: DemoInvoice = {
      id,
      number: isQuote ? `DV-DEMO-${id}` : `FA-DEMO-${id}`,
      client_id: b.client_id,
      client_name: b.client_name || 'Client',
      client_ice: b.client_ice,
      status: isQuote ? 'quote' : b.status || 'draft',
      subtotal,
      tax_amount: tax,
      total: subtotal + tax,
      amount_paid: 0,
      issue_date: today(),
      notes: b.notes,
      items,
    };
    if (isQuote) sb.quotes = [row, ...sb.quotes];
    else sb.invoices = [row, ...sb.invoices];
    saveSandbox(sb);
    return ok(row, isQuote ? 'Devis créé (démo)' : 'Facture créée (démo)');
  }
  if ((m === 'PUT' || m === 'PATCH') && /^\/api\/invoices\/\d+/.test(base)) {
    const id = Number(base.split('/')[3]);
    const b = (body || {}) as Partial<DemoInvoice>;
    let list = sb.invoices;
    let idx = list.findIndex((i) => i.id === id);
    if (idx < 0) {
      list = sb.quotes;
      idx = list.findIndex((i) => i.id === id);
    }
    if (idx < 0) return { success: false, error: 'Document démo introuvable' };
    list[idx] = { ...list[idx], ...b, id };
    saveSandbox(sb);
    return ok(list[idx], 'Document mis à jour (démo)');
  }
  if (m === 'POST' && /^\/api\/invoices\/\d+\/mark-paid/.test(base)) {
    const id = Number(base.split('/')[3]);
    const inv = sb.invoices.find((i) => i.id === id);
    if (!inv) return { success: false, error: 'Facture démo introuvable' };
    inv.status = 'paid';
    inv.amount_paid = inv.total;
    saveSandbox(sb);
    return ok(inv, 'Facture marquée payée (démo)');
  }
  if (m === 'DELETE' && /^\/api\/invoices\/\d+$/.test(base)) {
    const id = Number(base.split('/').pop());
    sb.invoices = sb.invoices.filter((i) => i.id !== id);
    sb.quotes = sb.quotes.filter((i) => i.id !== id);
    saveSandbox(sb);
    return ok({ id }, 'Document supprimé (démo)');
  }

  // Expenses / balance
  if (m === 'GET' && (base === '/api/expenses' || base === '/api/balance')) {
    return ok(sb.expenses);
  }
  if (m === 'POST' && (base === '/api/expenses' || base === '/api/balance')) {
    const b = (body || {}) as any;
    const id = sb.nextId++;
    const row: DemoExpense = {
      id,
      description: b.description || b.label || 'Dépense démo',
      amount: Number(b.amount || 0),
      category: b.category || 'Divers',
      expense_date: b.expense_date || today(),
      entry_type: b.entry_type || 'expense',
    };
    sb.expenses = [row, ...sb.expenses];
    saveSandbox(sb);
    return ok(row, 'Dépense enregistrée (démo)');
  }

  // Categories / units light stubs
  if (m === 'GET' && base === '/api/categories') {
    const cats = [...new Set(sb.products.map((p) => p.category))].map((name, i) => ({ id: i + 1, name }));
    return ok(cats);
  }
  if (m === 'GET' && base === '/api/units') {
    const units = [...new Set(sb.products.map((p) => p.unit))].map((name, i) => ({ id: i + 1, name }));
    return ok(units);
  }

  // Settings: demo company profile (never hit production settings DB)
  if (m === 'GET' && (base === '/api/settings' || base === '/api/company')) {
    return ok(demoCompany());
  }

  // Sellers / staff
  if (m === 'GET' && (base === '/api/sellers' || base === '/api/users' || base === '/api/staff')) {
    return ok(sb.sellers || []);
  }

  // Reports JSON endpoints
  if (m === 'GET' && base.startsWith('/api/reports/')) {
    if (base.includes('aging') || base.includes('receivables')) {
      const rows = sb.invoices
        .filter((i) => ['sent', 'partial', 'overdue'].includes(i.status))
        .map((i) => ({
          number: i.number,
          client_name: i.client_name,
          status: i.status,
          total: i.total,
          amount_paid: i.amount_paid,
          due: Math.max(0, Number(i.total) - Number(i.amount_paid || 0)),
          issue_date: i.issue_date,
          due_date: i.due_date,
        }));
      return ok({ rows, total_due: rows.reduce((s, r) => s + r.due, 0) });
    }
    if (base.includes('tva') || base.includes('vat')) {
      const ht = sb.invoices.reduce((s, i) => s + Number(i.subtotal || 0), 0);
      const tva = sb.invoices.reduce((s, i) => s + Number(i.tax_amount || 0), 0);
      return ok({ taxable: ht, vat: tva, rate: 20 });
    }
    if (base.includes('cogs')) {
      return ok({ cogs: sb.products.reduce((s, p) => s + Number(p.cost || 0) * 2, 0) });
    }
    return ok(dashboardFromSandbox(sb));
  }

  // Payments list stub linked to paid invoices
  if (m === 'GET' && (base === '/api/payments' || base.startsWith('/api/payments'))) {
    const pays = sb.invoices
      .filter((i) => Number(i.amount_paid) > 0)
      .map((i, idx) => ({
        id: 50 + idx,
        invoice_id: i.id,
        invoice_number: i.number,
        amount: i.amount_paid,
        method: 'cash',
        paid_at: i.issue_date,
      }));
    return ok(pays);
  }

  // Auth/me still live so user identity stays real
  if (base.startsWith('/api/auth')) {
    return null;
  }

  // Never write to production while in demo mode
  if (m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE') {
    return {
      success: false,
      error: 'Cette action n’est pas simulée en mode démo. Utilisez Clients, Produits, Factures ou Dépenses.',
    };
  }

  // Default GET: empty list (UI stays usable)
  if (m === 'GET') {
    return ok([]);
  }

  return null;
}

export function getDemoSeed() {
  return buildFreshSandbox();
}
