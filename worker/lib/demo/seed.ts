/**
 * Fake data for the demo sandbox — a small marble & stone trading company in
 * Casablanca. Deterministic (fixed pseudo-random seed) and relative to `now`,
 * so charts, KPIs and "last 7 / 14 days" views are always populated.
 *
 * Inserted through the regular D1 API (the sandbox proxy), in a few batches.
 */
import { ensureEmployeeTables } from '../../routes/employees';
import { ensureMetricSnapshots } from '../../routes/metrics';

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

/** All statements, in dependency order. Exported for the unit tests. */
export function buildDemoSeed(now: number): Stmt[] {
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

  PRODUCTS.forEach(([name, cat, unit, price, cost, stock, threshold], i) => {
    const prefix = cat.slice(0, 3).toUpperCase().normalize('NFD').replace(/[^A-Z]/g, '');
    const created = at(40 - i, 9);
    push(
      `INSERT INTO products (id, sku, name, description, category_id, category, unit, price, cost, stock_quantity, low_stock_threshold, track_inventory, is_active, barcode, tax_rate, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, 20, ?, ?)`,
      i + 1, `${prefix}-${String(i + 1).padStart(3, '0')}`, name, `${name} — article de démonstration.`, catId(cat), cat, unit,
      price, cost, stock, threshold, ean13(i + 1), iso(created), iso(created),
    );
  });

  CLIENTS.forEach(([name, city, phone], i) => {
    const created = i < 3 ? at(i * 3 + 1, 11) : at(60 + i * 4, 11);
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

  // Invoices (FA), quick sales (VR) and quotes (DEV) over the last 30 days.
  let invId = 0;
  let receiptNo = 0;
  const counters = { FA: 0, VR: 0, DEV: 0 };
  for (let d = 29; d >= 0; d--) {
    const perDay = d % 7 === 5 ? 0 : 1 + Math.floor(rand() * 2.2);
    for (let k = 0; k < perDay; k++) {
      const roll = rand();
      const kind = roll < 0.45 ? 'VR' : roll < 0.85 ? 'FA' : 'DEV';
      invId++;
      counters[kind]++;
      const client = kind === 'VR' && rand() < 0.5 ? null : 1 + Math.floor(rand() * CLIENTS.length);
      const clientName = client ? CLIENTS[client - 1][0] : 'Client comptoir';
      const lines = 1 + Math.floor(rand() * 3);
      let subtotal = 0;
      const items: Stmt[] = [];
      for (let l = 0; l < lines; l++) {
        const pIdx = Math.floor(rand() * PRODUCTS.length);
        const p = PRODUCTS[pIdx];
        const qty = p[2] === 'm²' || p[2] === 'ml' ? Math.round((2 + rand() * 18) * 10) / 10 : 1 + Math.floor(rand() * 4);
        const total = r2(qty * p[3]);
        subtotal += total;
        items.push({
          sql: `INSERT INTO invoice_items (invoice_id, product_id, product_name, sku, quantity, unit_price, tax_rate, line_total) VALUES (?, ?, ?, ?, ?, ?, 20, ?)`,
          params: [invId, pIdx + 1, p[0], '', qty, p[3], total],
        });
      }
      subtotal = r2(subtotal);
      const tax = r2(subtotal * 0.2);
      const total = r2(subtotal + tax);
      const issued = at(d, 9 + Math.floor(rand() * 8));
      const number = kind === 'DEV'
        ? `DEV-${year}-${String(counters.DEV).padStart(4, '0')}`
        : `${kind}-${year}-${String(kind === 'FA' ? 80 + counters.FA : 140 + counters.VR).padStart(4, '0')}`;
      let status = 'sent';
      let paid = 0;
      if (kind === 'DEV') status = 'quote';
      else if (kind === 'VR') {
        const r = rand();
        status = r < 0.7 ? 'paid' : r < 0.88 ? 'partial' : 'sent';
      } else {
        const r = rand();
        status = d > 20 ? (r < 0.6 ? 'paid' : 'partial') : r < 0.35 ? 'paid' : r < 0.6 ? 'partial' : 'sent';
      }
      if (status === 'paid') paid = total;
      if (status === 'partial') paid = r2(total * (0.3 + rand() * 0.4));
      const due = dateOnly(issued + (kind === 'DEV' ? 30 : 30) * DAY);
      push(
        `INSERT INTO invoices (id, number, client_id, client_name, client_city, issue_date, due_date, status, doc_kind, subtotal, tax_amount, total, amount_paid, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`,
        invId, number, client, clientName, client ? CLIENTS[client - 1][1] : '', dateOnly(issued), due, status,
        kind === 'VR' ? 'quick_sale' : kind === 'DEV' ? 'quote' : 'invoice', subtotal, tax, total, paid, iso(issued), iso(issued),
      );
      out.push(...items);
      if (paid > 0) {
        const paidAt = Math.min(now - 60_000, issued + (status === 'paid' ? 0 : Math.floor(rand() * 3)) * DAY);
        const method = rand() < 0.55 ? 'cash' : rand() < 0.5 ? 'transfer' : 'card';
        push(
          `INSERT INTO invoice_payments (invoice_id, amount, payment_method, note, paid_at, created_at) VALUES (?, ?, ?, '', ?, ?)`,
          invId, paid, method, iso(paidAt), iso(paidAt),
        );
        if (kind === 'FA') {
          receiptNo++;
          push(
            `INSERT INTO receipts (number, invoice_id, client_name, amount, payment_method, issue_date, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, '', ?)`,
            `RE-${year}-${String(40 + receiptNo).padStart(4, '0')}`, invId, clientName, paid, method, dateOnly(paidAt), iso(paidAt),
          );
        }
      }
    }
  }

  // Purchases (bills) from vendors.
  let billId = 0;
  for (const d of [26, 19, 14, 9, 4, 1]) {
    billId++;
    const vendor = 1 + (billId % VENDORS.length);
    const pIdx = (billId * 5) % PRODUCTS.length;
    const p = PRODUCTS[pIdx];
    const qty = p[2] === 'm²' ? 20 + billId * 5 : 10 + billId * 2;
    const subtotal = r2(qty * p[4]);
    const tax = r2(subtotal * 0.2);
    const total = r2(subtotal + tax);
    const issued = at(d, 8);
    const status = d > 10 ? 'paid' : d > 3 ? 'partial' : 'sent';
    const paid = status === 'paid' ? total : status === 'partial' ? r2(total / 2) : 0;
    push(
      `INSERT INTO bills (id, number, vendor_id, vendor_name, issue_date, due_date, status, subtotal, tax_amount, total, amount_paid, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      billId, `BA-${year}-${String(20 + billId).padStart(4, '0')}`, vendor, VENDORS[vendor - 1][0], dateOnly(issued),
      dateOnly(issued + 45 * DAY), status, subtotal, tax, total, paid, iso(issued), iso(issued),
    );
    push(
      `INSERT INTO bill_items (bill_id, product_id, product_name, sku, quantity, unit_cost, tax_rate, line_total) VALUES (?, ?, ?, '', ?, ?, 20, ?)`,
      billId, pIdx + 1, p[0], qty, p[4], subtotal,
    );
    if (paid > 0) {
      push(
        `INSERT INTO bill_payments (bill_id, amount, payment_method, note, paid_at, created_at) VALUES (?, ?, 'transfer', '', ?, ?)`,
        billId, paid, iso(issued + DAY), iso(issued + DAY),
      );
    }
  }

  // Stock movements: entries, sales and adjustments over two weeks.
  for (let d = 13; d >= 0; d--) {
    const n = 2 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      const pIdx = Math.floor(rand() * PRODUCTS.length);
      const p = PRODUCTS[pIdx];
      const type = rand() < 0.6 ? 'out' : rand() < 0.8 ? 'in' : 'adjustment';
      const qty = p[2] === 'm²' || p[2] === 'ml' ? Math.round((1 + rand() * 10) * 10) / 10 : 1 + Math.floor(rand() * 5);
      const signed = type === 'out' ? -qty : qty;
      const prev = Math.max(0, p[5] - signed);
      push(
        `INSERT INTO stock_movements (product_id, warehouse_id, type, quantity, previous_quantity, new_quantity, reason, reference, created_at)
         VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)`,
        pIdx + 1, type, qty, prev, p[5], type === 'out' ? 'Vente' : type === 'in' ? 'Réception fournisseur' : 'Inventaire',
        type === 'out' ? `VR-${year}-${String(100 + d * 3 + k).padStart(4, '0')}` : '', iso(at(d, 8 + k)),
      );
    }
  }

  // Expenses.
  const EXP: [string, string, number, number][] = [
    ['Loyer', 'Loyer dépôt Aïn Sebaâ', 12000, 25],
    ['Énergie', 'Électricité atelier', 2380, 18],
    ['Transport', 'Carburant camion de livraison', 1450, 12],
    ['Entretien', 'Révision scie à pont', 3200, 9],
    ['Télécom', 'Internet & téléphone', 690, 6],
    ['Fournitures', 'Fournitures de bureau', 420, 3],
    ['Transport', 'Péage et parking chantiers', 380, 1],
  ];
  EXP.forEach(([cat, desc, amount, d]) => {
    push(
      `INSERT INTO expenses (category, description, amount, payment_method, expense_date, vendor_name, entry_type, created_at) VALUES (?, ?, ?, ?, ?, '', 'expense', ?)`,
      cat, desc, amount, amount > 2000 ? 'transfer' : 'cash', dateOnly(at(d)), iso(at(d)),
    );
  });

  // Phone actions (scans sent to the PC).
  const ACTIONS: [string, string, string, number, string][] = [
    ['scan', 'Scan · Marbre Carrara blanc', 'Contrôle quantité rayon A', 1, 'pending'],
    ['new_product', 'Produit inconnu · Galet décoratif blanc', 'GAL-001 · stock 40', 0, 'pending'],
    ['stock_check', 'Contrôle · Travertin noce vieilli', 'Stock faible signalé', 13, 'pending'],
    ['scan', 'Scan · Granit noir Zimbabwe', 'Réservé pour chantier Anfa', 6, 'done'],
    ['invoice', 'Bon de livraison signé', 'Hôtel Casa Port', 0, 'done'],
  ];
  ACTIONS.forEach(([type, title, detail, pid, status], i) => {
    const created = at(i, 10 + i);
    push(
      `INSERT INTO mobile_actions (type, title, detail, barcode, product_id, status, source, created_by, completed_by, completed_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'mobile', 'test', ?, ?, ?)`,
      type, title, detail, pid ? ean13(pid) : '', pid || null, status, status === 'done' ? 'test' : '',
      status === 'done' ? iso(created + 3_600_000) : null, iso(created),
    );
  });

  // Audit trail.
  const AUD: [string, string, string][] = [
    ['invoice.create', 'invoices', 'Facture créée'],
    ['product.update', 'products', 'Prix mis à jour'],
    ['stock.adjust', 'products', 'Ajustement inventaire'],
    ['client.create', 'clients', 'Nouveau client'],
    ['receipt.create', 'receipts', 'Encaissement enregistré'],
  ];
  for (let d = 13; d >= 0; d--) {
    const n = 1 + Math.floor(rand() * 4);
    for (let k = 0; k < n; k++) {
      const [action, entity, detail] = AUD[Math.floor(rand() * AUD.length)];
      push(
        `INSERT INTO audit_log (created_at, username, role, action, entity, entity_id, detail, ip) VALUES (?, 'test', 'owner', ?, ?, ?, ?, '127.0.0.1')`,
        iso(at(d, 9 + k)), action, entity, String(1 + Math.floor(rand() * 20)), detail,
      );
    }
  }

  push(`INSERT OR REPLACE INTO app_config (key, value) VALUES ('demo_sandbox', '1')`);
  push(`INSERT OR REPLACE INTO app_config (key, value) VALUES ('twofa_enabled', '0')`);
  return out;
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
  const rand = rng(4242);
  const out: Stmt[] = [];
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const base: Record<string, number> = {
    products: PRODUCTS.length,
    low_stock: 5,
    out_of_stock: 0,
    pending_actions: 3,
    employees_active: EMPLOYEES.length,
    clients_total: CLIENTS.length,
    vendors_total: VENDORS.length,
    receivables: 38000,
    payables: 9000,
    stock_value: 210000,
    open_invoices: 7,
    open_tickets: 4,
    open_quotes: 3,
  };
  for (let d = 27; d >= 1; d--) {
    const day = dateOnly(today - d * DAY);
    for (const [key, v] of Object.entries(base)) {
      const drift = key === 'products' || key === 'employees_active' || key === 'clients_total' || key === 'vendors_total'
        ? -Math.floor(d / 9)
        : (rand() - 0.5) * (v > 100 ? v * 0.18 : Math.max(2, v * 0.5));
      out.push({
        sql: `INSERT OR REPLACE INTO metric_snapshots (day, key, value, updated_at) VALUES (?, ?, ?, ?)`,
        params: [day, key, Math.max(0, Math.round((v + drift) * 100) / 100), `${day} 23:00:00`],
      });
    }
  }
  return out;
}

async function runBatches(db: D1Database, stmts: Stmt[], size = 120): Promise<void> {
  for (let i = 0; i < stmts.length; i += size) {
    const chunk = stmts.slice(i, i + size).map((s) => db.prepare(s.sql).bind(...s.params));
    await db.batch(chunk);
  }
}

export async function seedDemoData(db: D1Database, now = Date.now()): Promise<void> {
  await runBatches(db, buildDemoSeed(now));
  await ensureEmployeeTables(db);
  await runBatches(db, buildEmployeeSeed(now));
  await ensureMetricSnapshots(db);
  await runBatches(db, buildSnapshotSeed(now));
}
