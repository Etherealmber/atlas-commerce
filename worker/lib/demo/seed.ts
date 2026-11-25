/**
 * Fake data for the demo sandbox — a small marble & stone trading company in
 * Casablanca. Deterministic (fixed pseudo-random seed) and relative to `now`,
 * so charts, KPIs and "last 7 / 14 days" views are always populated.
 *
 * Inserted through the regular D1 API (the sandbox proxy), in a few batches.
 */
import { ensureEmployeeTables } from '../../routes/employees';
import { ensureMetricSnapshots } from '../../routes/metrics';
import { ensureInvoiceRefundColumns } from '../ledgerHelpers';

type Stmt = { sql: string; params: unknown[] };

const DAY = 86_400_000;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const dateOnly = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;

function ean13(base: number): string {
  const digits = String(611000000000 + base).padStart(12, '0').slice(0, 12);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (i % 2 ? 3 : 1);
  return digits + String((10 - (sum % 10)) % 10);
}

export const DEMO_COMPANY = {
  company_name: 'Atlas Démo SARL',
  legal_form: 'SARL',
  address: '128, boulevard d’Anfa',
  city: 'Casablanca',
  postal_code: '20050',
  country: 'Maroc',
  phone: '+212 522 00 00 00',
  email: 'contact@atlas-demo.ma',
  website: 'atlas-demo.ma',
  ice: '001234567000089',
  if_number: '12345678',
  rc: 'RC 456789',
  patente: '34567812',
  cnss: '9876543',
};

const CATEGORIES: [string, string][] = [
  ['Marbre', '#94a3b8'],
  ['Granit', '#1f2937'],
  ['Onyx', '#d97706'],
  ['Travertin', '#a16207'],
  ['Quartz', '#64748b'],
  ['Accessoires', '#2563eb'],
  ['Entretien', '#16a34a'],
];

// name, category, unit, price, cost, stock, threshold
const PRODUCTS: [string, string, string, number, number, number, number][] = [
  ['Marbre Carrara blanc', 'Marbre', 'm²', 420, 285, 42, 10],
  ['Marbre Calacatta or', 'Marbre', 'm²', 980, 690, 18, 6],
  ['Marbre Emperador brun', 'Marbre', 'm²', 540, 360, 27, 8],
  ['Marbre Nero Marquina', 'Marbre', 'm²', 610, 410, 4, 6],
  ['Marbre Thassos', 'Marbre', 'm²', 760, 520, 15, 5],
  ['Granit noir Zimbabwe', 'Granit', 'm²', 560, 380, 6, 8],
  ['Granit gris Tarn', 'Granit', 'm²', 390, 250, 51, 10],
  ['Granit rose Porriño', 'Granit', 'm²', 430, 290, 33, 10],
  ['Granit Kashmir white', 'Granit', 'm²', 650, 445, 12, 6],
  ['Onyx miel — plan vasque', 'Onyx', 'pièce', 1850, 1200, 7, 3],
  ['Onyx vert Pakistan', 'Onyx', 'm²', 1240, 860, 9, 4],
  ['Travertin classique', 'Travertin', 'm²', 310, 190, 64, 12],
  ['Travertin noce vieilli', 'Travertin', 'm²', 345, 215, 2, 10],
  ['Quartz blanc pur', 'Quartz', 'm²', 720, 480, 22, 8],
  ['Quartz gris béton', 'Quartz', 'm²', 690, 455, 19, 8],
  ['Plan de travail cuisine 3 m', 'Quartz', 'pièce', 4200, 2900, 5, 2],
  ['Seuil de porte marbre 90 cm', 'Accessoires', 'pièce', 180, 95, 48, 15],
  ['Nez de marche granit', 'Accessoires', 'ml', 260, 150, 36, 12],
  ['Plinthe travertin 7 cm', 'Accessoires', 'ml', 45, 22, 210, 40],
  ['Colle flexible C2 (25 kg)', 'Accessoires', 'sac', 135, 82, 3, 10],
  ['Joint époxy gris (5 kg)', 'Accessoires', 'seau', 310, 190, 14, 5],
  ['Hydrofuge pierre naturelle 5 L', 'Entretien', 'bidon', 390, 230, 11, 4],
  ['Cire de polissage 1 L', 'Entretien', 'flacon', 120, 64, 26, 8],
  ['Disque diamant Ø230', 'Entretien', 'pièce', 340, 205, 9, 4],
];

const CLIENTS: [string, string, string][] = [
  ['Hôtel Casa Port', 'Casablanca', '+212 522 41 12 30'],
  ['Atelier Ben Saïd Design', 'Rabat', '+212 537 72 18 44'],
  ['Résidence Les Palmiers', 'Marrakech', '+212 524 43 90 12'],
  ['Cabinet Archi Lamrani', 'Casablanca', '+212 522 98 60 71'],
  ['Riad Dar Zitoun', 'Fès', '+212 535 63 11 08'],
  ['Promotion Immobilière Anfa', 'Casablanca', '+212 522 36 25 50'],
  ['Villa Souissi — M. Alaoui', 'Rabat', '+212 661 22 33 44'],
  ['Restaurant La Sqala', 'Casablanca', '+212 522 26 09 60'],
  ['Clinique Ibn Rochd', 'Tanger', '+212 539 32 44 70'],
  ['Mme Fatima Zahra Idrissi', 'Kénitra', '+212 662 55 70 18'],
  ['Groupe Scolaire Al Amal', 'Mohammedia', '+212 523 31 44 90'],
  ['Spa Hammam Andalous', 'Agadir', '+212 528 84 21 05'],
];

const VENDORS: [string, string][] = [
  ['Carrières de l’Atlas', 'Khénifra'],
  ['Marmi Italia Import', 'Casablanca'],
  ['Granits du Sud', 'Agadir'],
  ['Quartz Solutions Maroc', 'Tanger'],
  ['Chimie Bâtiment SA', 'Casablanca'],
];

const EMPLOYEES: [string, string, string, string, number][] = [
  ['Youssef', 'El Amrani', 'Chef d’atelier', 'Atelier', 9500],
  ['Khadija', 'Bennani', 'Comptable', 'Administration', 8200],
  ['Omar', 'Tazi', 'Commercial', 'Ventes', 7400],
  ['Salma', 'Chraibi', 'Assistante commerciale', 'Ventes', 6100],
  ['Hamza', 'Ouazzani', 'Poseur', 'Chantiers', 5600],
  ['Rachid', 'Mansouri', 'Tailleur de pierre', 'Atelier', 6300],
  ['Imane', 'Fassi', 'Magasinière', 'Stock', 5400],
  ['Anas', 'Berrada', 'Chauffeur-livreur', 'Logistique', 4900],
];

/**
 * One consistent little business. Everything is derived from the same
 * documents, so the maths always add up:
 *   - stock: every movement chains `previous → new`, walked backwards from
 *     today's stock, so the history never goes negative and ends exactly on
 *     the current quantity; sales come from invoice lines, entries from
 *     purchase bills (right vendor for the right material), returns from WR;
 *   - money: invoice/bill totals = Σ lines + 20 % VAT, amount_paid = Σ payments;
 *   - KPI history (metric_snapshots) is computed from those same records.
 */
export interface DemoModel {
  stmts: Stmt[];
  daily: { day: string; values: Record<string, number> }[];
}

/** All statements, in dependency order. Exported for the unit tests. */
export function buildDemoSeed(now: number): Stmt[] {
  return buildDemoModel(now).stmts;
}

export function buildDemoModel(now: number): DemoModel {
  const rand = rng(20261020);
  const out: Stmt[] = [];
  const push = (sql: string, ...params: unknown[]) => out.push({ sql, params });
  const year = new Date(now).getUTCFullYear();
  const at = (daysAgo: number, hour = 10) => {
    const base = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
    return Math.min(now - 60_000, base - daysAgo * DAY + hour * 3_600_000 + Math.floor(rand() * 50) * 60_000);
  };

  const c = DEMO_COMPANY;
  push(
    `UPDATE company_settings SET company_name = ?, legal_form = ?, address = ?, city = ?, postal_code = ?, country = ?, phone = ?, email = ?, website = ?, ice = ?, if_number = ?, rc = ?, patente = ?, cnss = ?, currency = 'MAD', tax_rate = 20, invoice_prefix = 'FA-', receipt_prefix = 'RE-', bill_prefix = 'BA-', bank_name = 'Banque Démo', bank_iban = 'MA64 0000 0000 0000 0000 0000 000', notes = 'Base de démonstration — données fictives.' WHERE id = 1`,
    c.company_name, c.legal_form, c.address, c.city, c.postal_code, c.country, c.phone, c.email, c.website, c.ice, c.if_number, c.rc, c.patente, c.cnss,
  );
  push(`UPDATE warehouses SET name = 'Dépôt principal — Aïn Sebaâ', city = 'Casablanca' WHERE id = 1`);
  push(`DELETE FROM categories`);
  CATEGORIES.forEach(([name, color], i) => push(`INSERT INTO categories (id, name, color) VALUES (?, ?, ?)`, i + 1, name, color));
  const catId = (name: string) => CATEGORIES.findIndex(([n]) => n === name) + 1;

  const productCreated: number[] = [];
  PRODUCTS.forEach(([name, cat, unit, price, cost, stock, threshold], i) => {
    const prefix = cat.slice(0, 3).toUpperCase().normalize('NFD').replace(/[^A-Z]/g, '');
    const created = at(70 - i, 9);
    productCreated.push(created);
    push(
      `INSERT INTO products (id, sku, name, description, category_id, category, unit, price, cost, stock_quantity, low_stock_threshold, track_inventory, is_active, barcode, tax_rate, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, 20, ?, ?)`,
      i + 1, `${prefix}-${String(i + 1).padStart(3, '0')}`, name, `${name} — article de démonstration.`, catId(cat), cat, unit,
      price, cost, stock, threshold, ean13(i + 1), iso(created), iso(created),
    );
  });

  const clientCreated: number[] = [];
  CLIENTS.forEach(([name, city, phone], i) => {
    const created = i >= 10 ? at(8 - (i - 10) * 5, 11) : at(150 - i * 8, 11);
    clientCreated.push(created);
    const email = `${name.toLowerCase().normalize('NFD').replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 24)}@exemple.ma`;
    push(
      `INSERT INTO clients (id, name, ice, address, city, phone, email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      i + 1, name, String(1500000000 + i * 7919).padStart(15, '0'), `${10 + i * 3}, rue de la Démo`, city, phone, email, iso(created),
    );
  });

  VENDORS.forEach(([name, city], i) => {
    push(
      `INSERT INTO vendors (id, name, ice, city, phone, email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      i + 1, name, String(2600000000 + i * 4243).padStart(15, '0'), city, `+212 5${20 + i} 00 ${10 + i} ${20 + i}`,
      `achats${i + 1}@fournisseur-demo.ma`, iso(at(120 + i * 10, 9)),
    );
  });

  // ── Sales documents: invoices (FA), counter sales (VR), quotes (DEV) ──────
  type Line = { id: number; pIdx: number; qty: number; price: number; total: number };
  type Pay = { amount: number; at: number; method: string };
  type Inv = {
    id: number; number: string; kind: 'FA' | 'VR' | 'DEV'; client: number | null; clientName: string;
    issued: number; due: number; lines: Line[]; subtotal: number; tax: number; total: number; status: string; pays: Pay[];
  };
  type Ev = { pIdx: number; at: number; signed: number; type: string; reason: string; reference: string; cap?: (q: number) => void };
  const invoices: Inv[] = [];
  const events: Ev[] = [];
  let invId = 0;
  let itemId = 0;
  const counters = { FA: 0, VR: 0, DEV: 0 };
  const qtyFor = (unit: string, big = false) =>
    unit === 'm²' || unit === 'ml'
      ? Math.round((big ? 4 + rand() * 14 : 1.5 + rand() * 8) * 10) / 10
      : 1 + Math.floor(rand() * (big ? 6 : 3));
  for (let d = 44; d >= 0; d--) {
    const dow = new Date(now - d * DAY).getUTCDay();
    const perDay = dow === 0 ? 0 : 1 + Math.floor(rand() * 2.2);
    for (let k = 0; k < perDay; k++) {
      const roll = rand();
      const kind: Inv['kind'] = roll < 0.45 ? 'VR' : roll < 0.86 ? 'FA' : 'DEV';
      invId++;
      counters[kind]++;
      let client = kind === 'VR' && rand() < 0.5 ? null : 1 + Math.floor(rand() * CLIENTS.length);
      // Never bill a client before the day their file was created.
      if (client && clientCreated[client - 1] > now - d * DAY) client = 1 + (client % 8);
      const clientName = client ? CLIENTS[client - 1][0] : 'Client comptoir';
      const lines: Line[] = [];
      const nLines = 1 + Math.floor(rand() * 3);
      for (let l = 0; l < nLines; l++) {
        const pIdx = Math.floor(rand() * PRODUCTS.length);
        if (lines.some((x) => x.pIdx === pIdx)) continue;
        const p = PRODUCTS[pIdx];
        const qty = qtyFor(p[2], kind === 'FA');
        itemId++;
        lines.push({ id: itemId, pIdx, qty, price: p[3], total: r2(qty * p[3]) });
      }
      const subtotal = r2(lines.reduce((a, x) => a + x.total, 0));
      const tax = r2(subtotal * 0.2);
      const total = r2(subtotal + tax);
      const issued = at(d, 9 + Math.floor(rand() * 8));
      const number = kind === 'DEV'
        ? `DEV-${year}-${String(counters.DEV).padStart(4, '0')}`
        : `${kind}-${year}-${String(kind === 'FA' ? 60 + counters.FA : 120 + counters.VR).padStart(4, '0')}`;
      const pays: Pay[] = [];
      let status = 'sent';
      const method = () => (rand() < 0.5 ? 'cash' : rand() < 0.6 ? 'transfer' : 'card');
      if (kind === 'DEV') status = 'quote';
      else if (kind === 'VR') {
        // Counter sales are paid on the spot, a few with a deposit only.
        const r = rand();
        if (r < 0.82) { status = 'paid'; pays.push({ amount: total, at: issued, method: method() }); }
        else { status = 'partial'; pays.push({ amount: r2(Math.round(total * 0.5 / 10) * 10), at: issued, method: 'cash' }); }
      } else {
        // Invoices: 30-day terms. Older ones are mostly settled (often in two
        // instalments), recent ones are still open — some already overdue.
        const r = rand();
        if (d > 30 ? r < 0.8 : d > 12 ? r < 0.45 : r < 0.15) {
          status = 'paid';
          const first = r2(Math.round(total * 0.4 / 10) * 10);
          const t1 = Math.min(now - 60_000, issued + (1 + Math.floor(rand() * 4)) * DAY);
          const t2 = Math.min(now - 60_000, issued + (12 + Math.floor(rand() * 15)) * DAY);
          if (rand() < 0.5) pays.push({ amount: total, at: t1, method: 'transfer' });
          else pays.push({ amount: first, at: t1, method: method() }, { amount: r2(total - first), at: t2, method: 'transfer' });
        } else if (r < 0.75) {
          status = 'partial';
          pays.push({ amount: r2(Math.round(total * (0.3 + rand() * 0.3) / 10) * 10), at: Math.min(now - 60_000, issued + 2 * DAY), method: method() });
        }
      }
      invoices.push({ id: invId, number, kind, client, clientName, issued, due: issued + 30 * DAY, lines, subtotal, tax, total, status, pays });
      if (kind !== 'DEV') {
        for (const x of lines) events.push({ pIdx: x.pIdx, at: issued, signed: -x.qty, type: 'out', reason: 'Vente', reference: number });
      }
    }
  }

  // ── Credit notes (WR): partial returns on settled sales ──────────────────
  type Wr = { id: number; number: string; src: Inv; line: Line; qty: number; restock: boolean; reason: string; code: string; issued: number; itemId: number };
  const refunds: Wr[] = [];
  const REASONS: [string, string, boolean][] = [
    ['Surplus de chantier retourné par le client', 'surplus', true],
    ['Casse constatée à la livraison', 'damaged', false],
    ['Erreur de teinte — échange demandé', 'wrong_item', true],
  ];
  const settled = invoices.filter((x) => x.kind !== 'DEV' && x.status === 'paid' && x.issued < now - 6 * DAY && x.issued > now - 30 * DAY);
  REASONS.forEach(([reason, code, restock], i) => {
    const src = settled[Math.floor((i + 1) * settled.length / 4)];
    if (!src) return;
    const line = src.lines[0];
    const unit = PRODUCTS[line.pIdx][2];
    const qty = unit === 'm²' || unit === 'ml' ? Math.max(0.5, Math.round(line.qty * 0.25 * 10) / 10) : 1;
    if (qty > line.qty) return;
    invId++;
    itemId++;
    const issued = Math.min(now - 3_600_000, src.issued + (2 + i * 2) * DAY);
    const w: Wr = { id: invId, number: `WR-${year}-${String(i + 1).padStart(4, '0')}`, src, line, qty, restock, reason, code, issued, itemId };
    refunds.push(w);
    if (restock) {
      events.push({
        pIdx: line.pIdx, at: issued, signed: qty, type: 'in', reason: `Retour client (${w.number})`, reference: w.number,
        cap: (q) => { w.qty = q; },
      });
    }
  });

  // ── Purchases: each vendor sells its own materials ───────────────────────
  const VENDOR_CATS: string[][] = [['Marbre', 'Travertin'], ['Marbre', 'Onyx'], ['Granit'], ['Quartz'], ['Accessoires', 'Entretien']];
  type BillLine = { pIdx: number; qty: number; cost: number };
  type Bill = { id: number; number: string; vendor: number; issued: number; lines: BillLine[] };
  const bills: Bill[] = [];
  [58, 51, 44, 38, 31, 26, 21, 15, 10, 6, 3, 1].forEach((d, i) => {
    const vendor = 1 + (i % VENDORS.length);
    const pool = PRODUCTS.map((p, idx) => ({ p, idx })).filter(({ p }) => VENDOR_CATS[vendor - 1].includes(p[1]));
    const n = Math.min(pool.length, 1 + Math.floor(rand() * 3));
    const start = Math.floor(rand() * pool.length);
    const bill: Bill = { id: i + 1, number: `BA-${year}-${String(i + 1).padStart(4, '0')}`, vendor, issued: at(d, 8), lines: [] };
    for (let k = 0; k < n; k++) {
      const { p, idx } = pool[(start + k) % pool.length];
      // Restock sizes a buyer would actually order: slabs by the crate,
      // expensive pieces one or two at a time, consumables by the dozen.
      const qty = p[2] === 'm²' || p[2] === 'ml'
        ? 10 + Math.round(rand() * 6) * 5
        : p[4] >= 1000 ? 1 + Math.floor(rand() * 2) : 6 + Math.round(rand() * 3) * 6;
      const line: BillLine = { pIdx: idx, qty, cost: p[4] };
      bill.lines.push(line);
      events.push({
        pIdx: idx, at: bill.issued + 2 * 3_600_000, signed: line.qty, type: 'in', reason: `Réception fournisseur (${bill.number})`, reference: bill.number,
        cap: (q) => { line.qty = q; },
      });
    }
    bills.push(bill);
  });

  // A few inventory corrections.
  [[12, 18, -0.6, 'Inventaire — casse atelier'], [19, 9, 1, 'Inventaire — écart de comptage'], [22, 4, -2, 'Inventaire — écart de comptage'], [0, 26, -1, 'Échantillon client']]
    .forEach(([pIdx, d, q, reason]) => {
      events.push({ pIdx: pIdx as number, at: at(d as number, 18), signed: q as number, type: 'adjustment', reason: reason as string, reference: '' });
    });

  // ── Stock: walk back from today's quantity so every movement chains ──────
  const stockNow = PRODUCTS.map((p) => p[5]);
  const running = [...stockNow];
  const sorted = [...events].sort((x, y) => y.at - x.at);
  const moveRows: { ev: Ev; prev: number; next: number }[] = [];
  for (const ev of sorted) {
    let q = ev.signed;
    if (q > 0 && q > running[ev.pIdx]) {
      // Can't have received more than what is on hand afterwards.
      q = Math.floor(running[ev.pIdx] * 10) / 10;
      ev.signed = q;
      ev.cap?.(q);
    }
    if (q === 0) continue;
    const next = running[ev.pIdx];
    const prev = Math.round((next - q) * 10) / 10;
    moveRows.push({ ev, prev, next });
    running[ev.pIdx] = prev;
  }
  for (const b of bills) b.lines = b.lines.filter((l) => l.qty > 0);
  if (bills.some((b) => b.lines.length === 0)) {
    // Keep every bill meaningful: fall back to the vendor's best-stocked item.
    for (const b of bills.filter((x) => x.lines.length === 0)) {
      const pool = PRODUCTS.map((p, idx) => ({ p, idx })).filter(({ p }) => VENDOR_CATS[b.vendor - 1].includes(p[1]));
      const best = pool.sort((x, y) => y.p[5] - x.p[5])[0];
      const qty = Math.max(1, Math.floor(running[best.idx] > 0 ? Math.min(best.p[5], 10) : 1));
      b.lines.push({ pIdx: best.idx, qty, cost: best.p[4] });
    }
  }

  // ── Emit, in dependency order ────────────────────────────────────────────
  for (const inv of invoices) {
    const paid = r2(inv.pays.reduce((a, x) => a + x.amount, 0));
    push(
      `INSERT INTO invoices (id, number, client_id, client_name, client_city, issue_date, due_date, status, doc_kind, subtotal, tax_amount, total, amount_paid, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
      inv.id, inv.number, inv.client, inv.clientName, inv.client ? CLIENTS[inv.client - 1][1] : '', dateOnly(inv.issued), dateOnly(inv.due), inv.status,
      inv.kind === 'VR' ? 'quick_sale' : inv.kind === 'DEV' ? 'quote' : 'invoice', inv.subtotal, inv.tax, inv.total, paid, iso(inv.issued), iso(inv.pays.at(-1)?.at ?? inv.issued),
    );
    for (const x of inv.lines) {
      push(
        `INSERT INTO invoice_items (id, invoice_id, product_id, product_name, sku, quantity, unit_price, tax_rate, line_total) VALUES (?, ?, ?, ?, '', ?, ?, 20, ?)`,
        x.id, inv.id, x.pIdx + 1, PRODUCTS[x.pIdx][0], x.qty, x.price, x.total,
      );
    }
  }
  let receiptNo = 0;
  for (const inv of invoices) {
    for (const pay of inv.pays) {
      push(
        `INSERT INTO invoice_payments (invoice_id, amount, payment_method, note, paid_at, created_at) VALUES (?, ?, ?, '', ?, ?)`,
        inv.id, pay.amount, pay.method, iso(pay.at), iso(pay.at),
      );
      if (inv.kind === 'FA') {
        receiptNo++;
        push(
          `INSERT INTO receipts (number, invoice_id, client_name, amount, payment_method, issue_date, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, '', ?)`,
          `RE-${year}-${String(receiptNo).padStart(4, '0')}`, inv.id, inv.clientName, pay.amount, pay.method, dateOnly(pay.at), iso(pay.at),
        );
      }
    }
  }
  for (const w of refunds) {
    const sub = r2(w.qty * w.line.price);
    const tax = r2(sub * 0.2);
    const src = w.src;
    push(
      `INSERT INTO invoices (id, number, client_id, client_name, client_city, issue_date, due_date, status, doc_kind, subtotal, tax_amount, total, amount_paid, notes, refund_of_invoice_id, refund_reason, refund_reason_code, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, 'remboursement', 'remboursement', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
      w.id, w.number, src.client, src.clientName, src.client ? CLIENTS[src.client - 1][1] : '', dateOnly(w.issued), sub, tax, r2(sub + tax),
      `Avoir sur ${src.number}`, src.id, w.reason, w.code, iso(w.issued), iso(w.issued),
    );
    push(
      `INSERT INTO invoice_items (id, invoice_id, product_id, product_name, sku, quantity, unit_price, tax_rate, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, 20, ?)`,
      w.itemId, w.id, w.line.pIdx + 1, PRODUCTS[w.line.pIdx][0], `src_item:${w.line.id}|restock:${w.restock ? 1 : 0}${w.restock ? '' : '|disp:damaged'}`, w.qty, w.line.price, sub,
    );
  }
  const billPays: { bill: Bill; amount: number; at: number }[] = [];
  for (const b of bills) {
    const subtotal = r2(b.lines.reduce((a, l) => a + l.qty * l.cost, 0));
    const tax = r2(subtotal * 0.2);
    const total = r2(subtotal + tax);
    const age = (now - b.issued) / DAY;
    // 45-day vendor terms: older bills paid, mid ones half paid, recent ones open.
    const pays = age > 25 ? [total] : age > 8 ? [r2(Math.round(total / 2 / 10) * 10)] : [];
    pays.forEach((amount, k) => billPays.push({ bill: b, amount, at: Math.min(now - 60_000, b.issued + (5 + k * 10) * DAY) }));
    const paid = r2(pays.reduce((a, x) => a + x, 0));
    push(
      `INSERT INTO bills (id, number, vendor_id, vendor_name, issue_date, due_date, status, subtotal, tax_amount, total, amount_paid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      b.id, b.number, b.vendor, VENDORS[b.vendor - 1][0], dateOnly(b.issued), dateOnly(b.issued + 45 * DAY),
      paid >= total ? 'paid' : paid > 0 ? 'partial' : 'sent', subtotal, tax, total, paid, iso(b.issued), iso(b.issued),
    );
    for (const l of b.lines) {
      push(
        `INSERT INTO bill_items (bill_id, product_id, product_name, sku, quantity, unit_cost, tax_rate, line_total) VALUES (?, ?, ?, '', ?, ?, 20, ?)`,
        b.id, l.pIdx + 1, PRODUCTS[l.pIdx][0], l.qty, l.cost, r2(l.qty * l.cost),
      );
    }
  }
  for (const bp of billPays) {
    push(
      `INSERT INTO bill_payments (bill_id, amount, payment_method, note, paid_at, created_at) VALUES (?, ?, 'transfer', '', ?, ?)`,
      bp.bill.id, bp.amount, iso(bp.at), iso(bp.at),
    );
  }
  for (let mi = moveRows.length - 1; mi >= 0; mi--) {
    const { ev, prev, next } = moveRows[mi];
    push(
      `INSERT INTO stock_movements (product_id, warehouse_id, type, quantity, previous_quantity, new_quantity, reason, reference, created_at)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      ev.pIdx + 1, ev.type, Math.abs(ev.signed), prev, next, ev.reason, ev.reference, iso(ev.at),
    );
  }

  // ── Treasury: 90 days of real-looking running costs ──────────────────────
  const payroll = EMPLOYEES.reduce((a, e) => a + e[4], 0);
  const cash: { cat: string; desc: string; amount: number; at: number; method: string; type: string; vendor: string }[] = [];
  for (let d = 89; d >= 0; d--) {
    const t = at(d, 11);
    const dt = new Date(now - d * DAY);
    const dom = dt.getUTCDate();
    const month = dt.toLocaleDateString('fr-FR', { month: 'long', timeZone: 'UTC' });
    const add = (cat: string, desc: string, amount: number, method: string, vendor = '', type = 'expense') =>
      cash.push({ cat, desc, amount: r2(amount), at: t, method, type, vendor });
    if (dom === 1) add('Loyer', `Loyer dépôt Aïn Sebaâ — ${month}`, 12000, 'transfer', 'SCI Aïn Sebaâ');
    if (dom === 3) add('Salaires', `Salaires ${month} (${EMPLOYEES.length} employés)`, payroll, 'transfer');
    if (dom === 5) add('Charges sociales', `CNSS / AMO part patronale — ${month}`, payroll * 0.2109, 'transfer', 'CNSS');
    if (dom === 8) add('Énergie', `Électricité atelier — ${month}`, 2100 + Math.round(rand() * 6) * 100, 'transfer', 'Lydec');
    if (dom === 9) add('Énergie', `Eau — ${month}`, 280 + Math.round(rand() * 17) * 10, 'transfer', 'Lydec');
    if (dom === 10) add('Télécom', `Internet & téléphone — ${month}`, 690, 'transfer', 'Maroc Telecom');
    if (dom === 15 && dt.getUTCMonth() % 3 === 0) add('Assurance', 'Assurance multirisque atelier (trimestre)', 4800, 'transfer', 'Wafa Assurance');
    if (dom === 20) add('Frais bancaires', `Frais de tenue de compte — ${month}`, 95, 'transfer', 'Banque Démo');
    if (dt.getUTCDay() === 1) add('Transport', 'Carburant camion de livraison', 380 + Math.round(rand() * 24) * 10, 'card', 'Afriquia');
    if (dt.getUTCDay() === 4 && rand() < 0.5) add('Transport', 'Péage et parking chantiers', 60 + Math.round(rand() * 12) * 10, 'cash');
    if (d % 11 === 4) add('Fournitures', 'Fournitures de bureau', 180 + Math.round(rand() * 30) * 10, 'cash', 'Librairie Al Andalous');
    if (d % 17 === 6) add('Entretien', d % 34 === 6 ? 'Révision scie à pont' : 'Lames et consommables atelier', d % 34 === 6 ? 3200 : 850, 'transfer', 'Outillage Pro Maroc');
    if (d === 37 || d === 9) add('Ventes annexes', d === 37 ? 'Vente de chutes de marbre' : 'Prestation de découpe sur mesure', d === 37 ? 1800 : 2400, 'cash', '', 'income');
    if (d === 80) add('Capital', 'Apport en compte courant d’associé', 50000, 'transfer', '', 'owner_contrib');
    if (d === 33) add('Associés', 'Dividendes versés aux associés', 20000, 'transfer', '', 'owner_draw');
  }
  for (const x of cash) {
    push(
      `INSERT INTO expenses (category, description, amount, payment_method, expense_date, vendor_name, entry_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      x.cat, x.desc, x.amount, x.method, dateOnly(x.at), x.vendor, x.type, iso(x.at),
    );
  }

  // Phone actions (scans sent to the PC).
  const ACTIONS: [string, string, string, number, string][] = [
    ['scan', 'Scan · Marbre Carrara blanc', 'Contrôle quantité rayon A', 1, 'pending'],
    ['new_product', 'Produit inconnu · Galet décoratif blanc', 'GAL-001 · stock 40', 0, 'pending'],
    ['stock_check', 'Contrôle · Travertin noce vieilli', 'Stock faible signalé', 13, 'pending'],
    ['scan', 'Scan · Granit noir Zimbabwe', 'Réservé pour chantier Anfa', 6, 'done'],
    ['invoice', 'Bon de livraison signé', 'Hôtel Casa Port', 0, 'done'],
  ];
  const actionCreated: [number, string][] = [];
  ACTIONS.forEach(([type, title, detail, pid, status], i) => {
    const created = at(i, 10 + i);
    actionCreated.push([created, status]);
    push(
      `INSERT INTO mobile_actions (type, title, detail, barcode, product_id, status, source, created_by, completed_by, completed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'mobile', 'test', ?, ?, ?)`,
      type, title, detail, pid ? ean13(pid) : '', pid || null, status, status === 'done' ? 'test' : '',
      status === 'done' ? iso(created + 3_600_000) : null, iso(created),
    );
  });

  // Audit trail mirrors the documents above.
  const audit: [number, string, string, string, string][] = [];
  for (const inv of invoices) audit.push([inv.issued, inv.kind === 'DEV' ? 'quote.create' : 'invoice.create', 'invoices', String(inv.id), `${inv.number} — ${inv.clientName}`]);
  for (const inv of invoices) for (const pay of inv.pays) audit.push([pay.at, 'payment.create', 'invoices', String(inv.id), `${pay.amount} MAD sur ${inv.number}`]);
  for (const b of bills) audit.push([b.issued, 'bill.create', 'bills', String(b.id), `${b.number} — ${VENDORS[b.vendor - 1][0]}`]);
  for (const w of refunds) audit.push([w.issued, 'refund.create', 'invoices', String(w.id), `${w.number} (avoir sur ${w.src.number})`]);
  for (const { ev } of moveRows) if (ev.type === 'adjustment') audit.push([ev.at, 'stock.adjust', 'products', String(ev.pIdx + 1), ev.reason]);
  for (const [t, action, entity, id, detail] of audit.filter(([when]) => when > now - 60 * DAY).sort((x, y) => x[0] - y[0])) {
    push(
      `INSERT INTO audit_log (created_at, username, role, action, entity, entity_id, detail, ip) VALUES (?, 'test', 'owner', ?, ?, ?, ?, '127.0.0.1')`,
      iso(t), action, entity, id, detail,
    );
  }

  push(`INSERT OR REPLACE INTO app_config (key, value) VALUES ('demo_sandbox', '1')`);
  push(`INSERT OR REPLACE INTO app_config (key, value) VALUES ('twofa_enabled', '0')`);

  // ── KPI history, computed from the very same records ─────────────────────
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const daily: DemoModel['daily'] = [];
  for (let d = 27; d >= 1; d--) {
    const end = today - d * DAY + DAY - 1;
    const stock = [...stockNow];
    for (const { ev } of moveRows) if (ev.at > end) stock[ev.pIdx] -= ev.signed;
    const sales = invoices.filter((x) => x.kind !== 'DEV' && x.issued <= end);
    const openSales = sales.map((x) => ({ x, left: x.total - x.pays.filter((p) => p.at <= end).reduce((a, p) => a + p.amount, 0) }))
      .filter((o) => o.left > 0.01);
    const billLeft = bills.filter((b) => b.issued <= end).map((b) => {
      const total = b.lines.reduce((a, l) => a + l.qty * l.cost, 0) * 1.2;
      return total - billPays.filter((p) => p.bill === b && p.at <= end).reduce((a, p) => a + p.amount, 0);
    });
    daily.push({
      day: dateOnly(today - d * DAY),
      values: {
        products: productCreated.filter((t) => t <= end).length,
        low_stock: stock.filter((q, i) => q > 0 && q <= PRODUCTS[i][6]).length,
        out_of_stock: stock.filter((q) => q <= 0).length,
        pending_actions: actionCreated.filter(([t, st]) => t <= end && st === 'pending').length,
        employees_active: EMPLOYEES.length,
        clients_total: clientCreated.filter((t) => t <= end).length,
        vendors_total: VENDORS.length,
        receivables: openSales.reduce((a, o) => a + o.left, 0),
        payables: billLeft.reduce((a, x) => a + Math.max(0, x), 0),
        stock_value: stock.reduce((a, q, i) => a + Math.max(0, q) * PRODUCTS[i][4], 0),
        open_invoices: openSales.filter((o) => o.x.kind === 'FA').length,
        open_quotes: invoices.filter((x) => x.kind === 'DEV' && x.issued <= end && x.issued > end - 30 * DAY).length,
      },
    });
  }
  return { stmts: out, daily };
}

/** Employees + attendance (tables created by the app's own schema helper). */
export function buildEmployeeSeed(now: number): Stmt[] {
  const rand = rng(77);
  const out: Stmt[] = [];
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  EMPLOYEES.forEach(([first, last, role, dept, pay], i) => {
    out.push({
      sql: `INSERT INTO employees (id, emp_number, name, first_name, last_name, phone, email, role_title, department, employment_status, joined_date, city, country, active, pay_amount, pay_cycle_type, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CDI', ?, 'Casablanca', 'Maroc', 1, ?, 'monthly', ?, ?)`,
      params: [
        i + 1, `EMP-${String(i + 1).padStart(3, '0')}`, `${first} ${last}`, first, last, `+212 6${60 + i} ${10 + i} ${20 + i} ${30 + i}`,
        `${first.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, '')}@atlas-demo.ma`, role, dept,
        dateOnly(today - (200 + i * 90) * DAY), pay, new Date(today - 300 * DAY).toISOString(), new Date(today - 300 * DAY).toISOString(),
      ],
    });
  });
  for (let d = 13; d >= 0; d--) {
    const dayMs = today - d * DAY;
    const dow = new Date(dayMs).getUTCDay();
    if (dow === 0) continue;
    EMPLOYEES.forEach((_, i) => {
      const r = rand();
      const absent = r < 0.08;
      const late = !absent && r < 0.2;
      if (d === 0 && i > 5) return;
      const inH = late ? 9 + Math.floor(rand() * 2) : 8;
      const inM = Math.floor(rand() * 30);
      const checkIn = absent ? null : `${String(inH).padStart(2, '0')}:${String(inM).padStart(2, '0')}`;
      const checkOut = absent || d === 0 ? null : `${17 + Math.floor(rand() * 2)}:${String(Math.floor(rand() * 60)).padStart(2, '0')}`;
      out.push({
        sql: `INSERT INTO employee_attendance (employee_id, work_date, check_in, check_out, status, source, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'manual', '', ?, ?)`,
        params: [i + 1, dateOnly(dayMs), checkIn, checkOut, absent ? 'absent' : late ? 'late' : 'present', new Date(dayMs).toISOString(), new Date(dayMs).toISOString()],
      });
    });
  }
  return out;
}

/** History for the "level" KPIs (stock, receivables…) so sparklines have a shape. */
export function buildSnapshotSeed(now: number): Stmt[] {
  return snapshotStmts(buildDemoModel(now).daily);
}

function snapshotStmts(daily: DemoModel['daily']): Stmt[] {
  const rand = rng(4242);
  return daily.flatMap(({ day, values }) =>
    Object.entries({ ...values, open_tickets: 2 + Math.floor(rand() * 3) }).map(([key, value]) => ({
      sql: `INSERT OR REPLACE INTO metric_snapshots (day, key, value, updated_at) VALUES (?, ?, ?, ?)`,
      params: [day, key, Math.max(0, Math.round(value * 100) / 100), `${day} 23:00:00`],
    })),
  );
}

async function runBatches(db: D1Database, stmts: Stmt[], size = 120): Promise<void> {
  for (let i = 0; i < stmts.length; i += size) {
    const chunk = stmts.slice(i, i + size).map((s) => db.prepare(s.sql).bind(...s.params));
    await db.batch(chunk);
  }
}

export async function seedDemoData(db: D1Database, now = Date.now()): Promise<void> {
  // Credit notes (WR) need the refund columns the app adds lazily.
  await ensureInvoiceRefundColumns(db);
  const model = buildDemoModel(now);
  await runBatches(db, model.stmts);
  await ensureEmployeeTables(db);
  await runBatches(db, buildEmployeeSeed(now));
  await ensureMetricSnapshots(db);
  await runBatches(db, snapshotStmts(model.daily));
}
