/**
 * v254 — Finance, payroll & reminders test suite.
 *
 * Pure helpers (period math, TZ boundaries, doc classification, gates) plus
 * REAL integration coverage: the library runs against an in-process SQLite
 * (node:sqlite) wrapped in a D1-compatible shim, so schema creation, outbox
 * idempotency, monthly summary math, payroll accrual and the reminder cron
 * (enroll → dedupe → role re-check → retry) are all exercised for real.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
// node:sqlite (Node ≥ 22.5) — imported dynamically because the repo has no
// @types/node; the shim below is deliberately any-typed (test harness only).
const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };
type DatabaseSync = any;
import {
  round2,
  isValidPeriod,
  monthBounds,
  prevPeriod,
  addDaysYmd,
  daysBetweenYmd,
  localTodayYmd,
  classifyDoc,
  outboxKey,
  reportReminderStage,
  financeGate,
  payrollObligation,
  payrollCycleDays,
  ensureFinanceSchema,
  getFinanceContext,
  enqueueOutbox,
  financeRecipients,
  computeMonthlySummary,
  computeOutstandingInvoices,
  computeOutstandingBills,
  computePayrollObligations,
  notifyPaymentRecorded,
  runFinanceReminders,
} from '../lib/finance';
import { buildFinanceReportPdf } from '../pdf';

// FCM is mocked: we assert WHO gets notified and HOW OFTEN, not Google's API.
const sendFcmToUser = vi.fn(async (_env: any, _username: string, _opts: any) => ({ sent: 1, purged: 0 }));
vi.mock('../lib/fcm', () => ({ sendFcmToUser: (...args: any[]) => sendFcmToUser(...(args as [any, string, any])) }));

/* ─────────────────────────── D1 shim over node:sqlite ─────────────────────────── */

function makeD1() {
  const sqlite = new DatabaseSync(':memory:');
  const db = {
    prepare(sql: string) {
      let params: any[] = [];
      const api: any = {
        bind(...p: any[]) { params = p; return api; },
        async run() {
          const s = sqlite.prepare(sql);
          const r = s.run(...(params as any));
          return { success: true, meta: { changes: Number(r.changes || 0), last_row_id: Number(r.lastInsertRowid || 0) } };
        },
        async first() {
          const s = sqlite.prepare(sql);
          const r = s.get(...(params as any));
          return r === undefined ? null : { ...(r as any) };
        },
        async all() {
          const s = sqlite.prepare(sql);
          const rows = s.all(...(params as any)).map((r: any) => ({ ...r }));
          return { success: true, results: rows, meta: {} };
        },
      };
      return api;
    },
  } as unknown as D1Database;
  return { db, sqlite };
}

/** Minimal business schema — the columns the finance queries actually read. */
async function seedBusinessTables(sqlite: DatabaseSync) {
  sqlite.exec(`
    CREATE TABLE company_settings (
      id INTEGER PRIMARY KEY, company_name TEXT DEFAULT '',
      finance_timezone TEXT DEFAULT 'Africa/Casablanca',
      finance_currency TEXT DEFAULT 'MAD',
      finance_push_amounts INTEGER DEFAULT 1
    );
    INSERT INTO company_settings (id, company_name) VALUES (1, 'Atlas Test SARL');
    CREATE TABLE app_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, role TEXT DEFAULT 'user', active INTEGER DEFAULT 1);
    CREATE TABLE invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT DEFAULT '', client_name TEXT DEFAULT '',
      total REAL DEFAULT 0, amount_paid REAL DEFAULT 0, due_date TEXT DEFAULT '',
      status TEXT DEFAULT 'sent', doc_kind TEXT DEFAULT 'invoice'
    );
    CREATE TABLE invoice_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER, amount REAL, paid_at TEXT);
    CREATE TABLE bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT DEFAULT '', vendor_name TEXT DEFAULT '',
      total REAL DEFAULT 0, due_date TEXT DEFAULT '', status TEXT DEFAULT 'received'
    );
    CREATE TABLE bill_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, bill_id INTEGER, amount REAL, paid_at TEXT);
    CREATE TABLE expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT, category TEXT DEFAULT '', amount REAL DEFAULT 0,
      expense_date TEXT DEFAULT '', entry_type TEXT DEFAULT 'expense'
    );
    CREATE TABLE employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT, emp_number TEXT DEFAULT '', name TEXT DEFAULT '',
      first_name TEXT DEFAULT '', last_name TEXT DEFAULT '', pay_amount REAL DEFAULT 0,
      pay_cycle_type TEXT DEFAULT 'monthly', pay_cycle_days INTEGER DEFAULT 30,
      last_paid_at TEXT, joined_date TEXT, active INTEGER DEFAULT 1
    );
    CREATE TABLE employee_payments (id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER, amount REAL, paid_at TEXT, period_label TEXT DEFAULT '', note TEXT DEFAULT '');
  `);
}

/* ─────────────────────────── pure helpers ─────────────────────────── */

describe('finance pure helpers', () => {
  it('round2 is half-up and dust-free', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(-2.675)).toBe(-2.67);
    expect(round2(Number.NaN)).toBe(0);
    expect(round2(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('isValidPeriod accepts YYYY-MM only', () => {
    for (const ok of ['2026-01', '2026-12', '1999-06']) expect(isValidPeriod(ok)).toBe(true);
    for (const bad of ['2026-13', '2026-00', '26-01', '2026-1', '', 'abcd-ef', '2026-01-05']) {
      expect(isValidPeriod(bad)).toBe(false);
    }
  });

  it('monthBounds is leap- and year-safe', () => {
    expect(monthBounds('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28', nextStart: '2026-03-01' });
    expect(monthBounds('2024-02')).toEqual({ start: '2024-02-01', end: '2024-02-29', nextStart: '2024-03-01' });
    expect(monthBounds('2026-12')).toEqual({ start: '2026-12-01', end: '2026-12-31', nextStart: '2027-01-01' });
    expect(monthBounds('2026-04').end).toBe('2026-04-30');
    expect(prevPeriod('2026-01')).toBe('2025-12');
    expect(prevPeriod('2026-10')).toBe('2026-09');
  });

  it('addDaysYmd / daysBetweenYmd handle month lengths', () => {
    expect(addDaysYmd('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDaysYmd('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDaysYmd('2024-02-28', 1)).toBe('2024-02-29');
    expect(daysBetweenYmd('2026-01-01', '2026-01-31')).toBe(30);
    expect(daysBetweenYmd('2026-01-31', '2026-01-01')).toBe(-30);
    expect(daysBetweenYmd('garbage', '2026-01-01')).toBe(0);
  });

  it('localTodayYmd crosses month boundaries in the tenant timezone', () => {
    // 23:30 UTC on Jan 31 is already Feb 1 in Casablanca (UTC+1).
    const utcLateJan31 = new Date('2026-01-31T23:30:00Z');
    expect(localTodayYmd('Africa/Casablanca', utcLateJan31)).toBe('2026-02-01');
    expect(localTodayYmd('UTC', utcLateJan31)).toBe('2026-01-31');
    expect(localTodayYmd('Not/AZone', utcLateJan31)).toBe('2026-01-31'); // safe fallback
  });

  it('classifyDoc yields exactly one unambiguous state', () => {
    expect(classifyDoc(1000, 1000, '2026-01-10', '2026-01-20')).toEqual({ state: 'paid', remaining: 0, overdue: false });
    expect(classifyDoc(1000, 400, '2026-01-30', '2026-01-20')).toEqual({ state: 'partial', remaining: 600, overdue: false });
    expect(classifyDoc(1000, 0, '2026-01-30', '2026-01-20')).toEqual({ state: 'unpaid', remaining: 1000, overdue: false });
    expect(classifyDoc(1000, 0, '2026-01-10', '2026-01-20')).toEqual({ state: 'overdue', remaining: 1000, overdue: true });
    // Fully paid before its due date is paid even though the due date passed.
    expect(classifyDoc(1000, 1000, '2026-01-10', '2026-01-20').state).toBe('paid');
    // No due date can never be overdue.
    expect(classifyDoc(1000, 0, '', '2026-01-20').overdue).toBe(false);
    // Overpaid invoices clamp at zero remaining.
    expect(classifyDoc(1000, 1200, '2026-01-10', '2026-01-20').remaining).toBe(0);
  });

  it('outboxKey is deterministic per (tenant,event,period,recipient)', () => {
    expect(outboxKey('main', 'invoice_due:5:2026-10-20', '2026-10', 'boss'))
      .toBe(outboxKey('main', 'invoice_due:5:2026-10-20', '2026-10', 'boss'));
    expect(outboxKey('main', 'a', 'p', 'x')).not.toBe(outboxKey('main', 'a', 'p', 'y'));
    expect(outboxKey('main', 'a', 'p', 'x')).toBe('main|a|p|x');
  });

  it('reportReminderStage fires only on days 1-3', () => {
    expect(reportReminderStage(1)).toBe(1);
    expect(reportReminderStage(2)).toBe(2);
    expect(reportReminderStage(3)).toBe(3);
    for (const d of [0, 4, 15, 28, 31, -1]) expect(reportReminderStage(d)).toBeNull();
  });

  it('financeGate: owner/admin in, secretaire/stock/user out, anonymous 401', () => {
    expect(financeGate('owner', 'boss').ok).toBe(true);
    expect(financeGate('admin', 'adm').ok).toBe(true);
    for (const role of ['secretaire', 'stock', 'user']) {
      const g = financeGate(role, 'someone');
      expect(g.ok).toBe(false);
      if (!g.ok) { expect(g.status).toBe(403); expect(g.code).toBe('FIN_FORBIDDEN'); }
    }
    const anon = financeGate('', '');
    expect(anon.ok).toBe(false);
    if (!anon.ok) { expect(anon.status).toBe(401); expect(anon.code).toBe('UNAUTHORIZED'); }
    // Weird/unknown roles are denied too.
    expect(financeGate('superadmin', 'x').ok).toBe(false);
  });

  it('payrollObligation: 30-day monthly cycle, pro-rata, cap, advances', () => {
    const emp = { id: 7, name: 'Karim Ben', pay_amount: 3000, pay_cycle_type: 'monthly', last_paid_at: '2026-09-01', joined_date: '2025-01-01', active: 1 };
    expect(payrollCycleDays(emp)).toBe(30);
    const mid = payrollObligation(emp, '2026-09-16', 0)!;
    expect(mid.amount_due).toBe(1500); // 15/30 × 3000
    expect(mid.pay_period).toEqual({ from: '2026-09-01', to: '2026-10-01' });
    expect(mid.due_date).toBe('2026-10-01');
    expect(mid.display_name).toBe('Karim Ben');
    const withAdvance = payrollObligation(emp, '2026-09-16', 500)!;
    expect(withAdvance.amount_due).toBe(1000);
    const capped = payrollObligation(emp, '2027-05-01', 0)!;
    expect(capped.amount_due).toBe(3000); // never exceeds one cycle
    // Inactive / unpaid / anchorless employees yield nothing.
    expect(payrollObligation({ ...emp, active: 0 }, '2026-09-16', 0)).toBeNull();
    expect(payrollObligation({ ...emp, pay_amount: 0 }, '2026-09-16', 0)).toBeNull();
    expect(payrollObligation({ ...emp, last_paid_at: null, joined_date: null }, '2026-09-16', 0)).toBeNull();
  });
});

describe('finance report PDF', () => {
  it('produces a valid single-page PDF 1.4 with the period and totals', () => {
    const bytes = buildFinanceReportPdf({
      companyName: 'Atlas Test SARL', currency: 'MAD', period: '2026-09',
      generatedAt: '2026-10-01T07:35:00.000Z',
      openingBalance: 10000, closingBalance: 12500, salesReceived: 8000,
      expenses: 3000, refunds: 500, payrollPaid: 2000, supplierPaid: 500,
      receivablesTotal: 4200, receivablesOverdue: 1200,
      payablesTotal: 900, payablesOverdue: 0,
      payrollDue: 3000, payrollCount: 2,
      receivableDocs: [{ number: 'F-2026-001', party: 'Client Alpha', due_date: '2026-09-15', remaining: 1200, state: 'overdue' }],
      receivableDocsTotal: 1,
      payableDocs: [], payableDocsTotal: 0,
    });
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('Periode: 2026-09');
    expect(text).toContain('RAPPORT MENSUEL');
    expect(text).toContain('F-2026-001');
    expect(text).toContain('confidentiel');
    // xref integrity: offsets are numeric and trailer size matches objects.
    expect(text).toContain('xref\n0 7\n');
    expect(text).toContain('/Size 7');
  });
});

/* ─────────────────────────── integration (real SQLite) ─────────────────────────── */

describe('finance outbox + reminders (integration)', () => {
  let d1: D1Database;
  let sqlite: DatabaseSync;

  beforeEach(async () => {
    vi.clearAllMocks();
    sendFcmToUser.mockImplementation(async () => ({ sent: 1, purged: 0 }));
    const made = makeD1();
    d1 = made.db;
    sqlite = made.sqlite;
    await seedBusinessTables(sqlite);
    await ensureFinanceSchema(d1);
  });

  it('creates the outbox table and dedupes on the UNIQUE idem key', async () => {
    const m = { event: 'invoice_due:1:2026-10-20', period: '2026-10', recipient: 'boss', title: 't', body: 'b' };
    expect(await enqueueOutbox(d1, m)).toBe(true);
    expect(await enqueueOutbox(d1, m)).toBe(false); // exact duplicate
    expect(await enqueueOutbox(d1, { ...m, recipient: 'admin1' })).toBe(true); // other recipient
    const { results } = await d1.prepare(`SELECT COUNT(*) n FROM finance_outbox`).all() as any;
    expect(Number(results[0].n)).toBe(2);
  });

  it('financeRecipients derives from app_users at call time, per kind', async () => {
    sqlite.exec(`
      INSERT INTO app_users (username, role, active) VALUES
        ('boss','owner',1), ('adm','admin',1), ('sec','secretaire',1),
        ('mag','stock',1), ('usr','user',1), ('dead','admin',0);
    `);
    expect((await financeRecipients(d1, 'admin')).sort()).toEqual(['adm', 'boss']);
    expect((await financeRecipients(d1, 'finance')).sort()).toEqual(['adm', 'boss', 'sec']);
  });

  it('tenant context comes from company_settings with safe defaults', async () => {
    const ctx = await getFinanceContext(d1);
    expect(ctx.tenant).toBe('main');
    expect(ctx.timezone).toBe('Africa/Casablanca');
    expect(ctx.currency).toBe('MAD');
    expect(ctx.pushAmounts).toBe(true);
    expect(ctx.companyName).toBe('Atlas Test SARL');
  });

  it('computes the monthly summary from persisted ledger rows only', async () => {
    sqlite.exec(`
      INSERT INTO invoice_payments (invoice_id, amount, paid_at) VALUES
        (1, 1000.5, '2026-09-10'), (1, 500, '2026-09-28'), (2, 300, '2026-08-15'), (3, 700, '2026-10-02');
      INSERT INTO expenses (category, amount, expense_date, entry_type) VALUES
        ('Achat', 200, '2026-09-05', 'expense'),
        ('Remboursement client', 150.25, '2026-09-06', 'expense'),
        ('Encaissement client', 1000.5, '2026-09-10', 'income'),
        ('Hors periode', 999, '2026-08-01', 'expense');
      INSERT INTO employee_payments (employee_id, amount, paid_at) VALUES (1, 3000, '2026-09-30');
      INSERT INTO bill_payments (bill_id, amount, paid_at) VALUES (1, 400, '2026-09-15'), (1, 100, '2026-07-01');
    `);
    const ctx = await getFinanceContext(d1);
    const s = await computeMonthlySummary(d1, '2026-09', ctx);
    expect(s.sales_received).toBe(1500.5); // only Sept invoice_payments
    expect(s.expenses).toBe(350.25);       // 200 + 150.25 (income rows excluded)
    expect(s.refunds).toBe(150.25);
    expect(s.payroll_paid).toBe(3000);
    expect(s.supplier_paid).toBe(400);
    // closing = ALL history ≤ Sept: sales 1800.5 − expenses 1349.25 − payroll 3000 − bills 500 = −3048.75
    expect(s.closing_balance).toBe(round2(1000.5 + 500 + 300 - (200 + 150.25 + 999) - 3000 - (400 + 100)));
    // opening = closing − period net; period net = 1500.5 − 350.25 − 3000 − 400
    expect(s.opening_balance).toBe(round2(s.closing_balance - (1500.5 - 350.25 - 3000 - 400)));
    expect(s.reconciliation.source).toBe('d1-live');
    expect(s.reconciliation.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(s.timezone).toBe('Africa/Casablanca');
    expect(s.currency).toBe('MAD');
  });

  it('receivables exclude VR-/WR-/quick_sale/paid and classify remaining from payments', async () => {
    sqlite.exec(`
      INSERT INTO invoices (id, number, client_name, total, amount_paid, due_date, status, doc_kind) VALUES
        (1, 'F-001', 'Alpha', 1000, 0, '2020-01-15', 'sent', 'invoice'),
        (2, 'F-002', 'Beta', 800, 300, '2099-01-01', 'partial', 'invoice'),
        (3, 'F-003', 'Gamma', 500, 500, '2026-09-01', 'paid', 'invoice'),
        (4, 'VR-001', 'Delta', 200, 0, '2026-09-01', 'sent', 'invoice'),
        (5, 'WR-001', 'Eps', 100, 0, '2026-09-01', 'sent', 'invoice'),
        (6, 'T-001', 'Zeta', 90, 0, '2026-09-01', 'sent', 'quick_sale'),
        (7, 'F-004', 'Eta', 600, 0, '', 'sent', 'invoice');
      INSERT INTO invoice_payments (invoice_id, amount, paid_at) VALUES (2, 300, '2026-09-10'), (3, 500, '2026-09-02');
    `);
    const docs = await computeOutstandingInvoices(d1, '2026-10-20');
    const byNum = Object.fromEntries(docs.map((d) => [d.number, d]));
    expect(Object.keys(byNum).sort()).toEqual(['F-001', 'F-002', 'F-004']);
    expect(byNum['F-001'].state).toBe('overdue');
    expect(byNum['F-001'].remaining).toBe(1000);
    expect(byNum['F-002'].state).toBe('partial');
    expect(byNum['F-002'].remaining).toBe(500); // total − Σ persisted payments
    expect(byNum['F-004'].state).toBe('unpaid');
  });

  it('payables classify supplier bills the same way', async () => {
    sqlite.exec(`
      INSERT INTO bills (id, number, vendor_name, total, due_date, status) VALUES
        (1, 'B-01', 'Fournisseur X', 1000, '2020-05-01', 'received'),
        (2, 'B-02', 'Fournisseur Y', 500, '2099-01-01', 'received'),
        (3, 'B-03', 'Fournisseur Z', 300, '2026-01-01', 'paid');
      INSERT INTO bill_payments (bill_id, amount, paid_at) VALUES (2, 200, '2026-09-01'), (3, 300, '2026-09-01');
    `);
    const docs = await computeOutstandingBills(d1, '2026-10-20');
    expect(docs.map((d) => [d.number, d.state, d.remaining])).toEqual([
      ['B-01', 'overdue', 1000],
      ['B-02', 'partial', 300],
    ]);
  });

  it('payroll obligations accrue per employee with advances deducted', async () => {
    sqlite.exec(`
      INSERT INTO employees (id, name, first_name, last_name, pay_amount, pay_cycle_type, last_paid_at, joined_date, active) VALUES
        (1, '', 'Karim', 'Ben', 3000, 'monthly', '2026-09-01', '2025-01-01', 1),
        (2, 'Sara Alami', '', '', 1500, 'monthly', '2026-08-01', '2025-01-01', 1),
        (3, 'Out', '', '', 5000, 'monthly', '2026-09-01', '2025-01-01', 0),
        (4, 'NoPay', '', '', 0, 'monthly', NULL, '2025-01-01', 1);
      INSERT INTO employee_payments (employee_id, amount, paid_at, period_label, note) VALUES
        (1, 500, '2026-09-10', 'Acompte septembre', '');
    `);
    const obs = await computePayrollObligations(d1, '2026-09-16');
    expect(obs.length).toBe(2);
    const karim = obs.find((o) => o!.display_name === 'Karim Ben')!;
    expect(karim.amount_due).toBe(1000); // 1500 accrued − 500 advance
    expect(karim.due_date).toBe('2026-10-01');
    const sara = obs.find((o) => o!.display_name === 'Sara Alami')!;
    expect(sara.amount_due).toBe(1500); // anchor 2026-08-01: full 30-day cycle accrued (capped), due 2026-08-31
    expect(sara.due_date).toBe('2026-08-31');
  });

  it('reminders: overdue invoices notify owner+admin+secretaire once, stock never', async () => {
    sqlite.exec(`
      INSERT INTO app_users (username, role, active) VALUES
        ('boss','owner',1), ('sec','secretaire',1), ('mag','stock',1);
      INSERT INTO invoices (id, number, client_name, total, due_date, status) VALUES
        (1, 'F-900', 'Client Retard', 2500, '2020-01-15', 'sent');
    `);
    const env = { DB: d1 };
    const r1 = await runFinanceReminders(env, { today: '2026-10-20' });
    expect(r1.enqueued).toBe(2); // one event × owner + secretaire (stock excluded)
    expect(r1.delivered).toBe(2);
    expect(sendFcmToUser).toHaveBeenCalledTimes(2);
    const targets = sendFcmToUser.mock.calls.map((c: any[]) => String(c[1])).sort();
    expect(targets).toEqual(['boss', 'sec']);
    // stock user never appears
    expect(targets).not.toContain('mag');

    // Second run the same day: outbox dedupes — zero new pushes.
    const r2 = await runFinanceReminders(env, { today: '2026-10-20' });
    expect(r2.enqueued).toBe(0);
    expect(sendFcmToUser).toHaveBeenCalledTimes(2);

    // A month later the SAME invoice does not re-nag: the overdue event key
    // carries the due-month, so an unpaid doc reminds once per due period
    // (non-spammy by construction).
    const r3 = await runFinanceReminders(env, { today: '2026-11-20' });
    expect(r3.enqueued).toBe(0);
  });

  it('payroll reminders go to owner/admin only — secretaire never receives them', async () => {
    sqlite.exec(`
      INSERT INTO app_users (username, role, active) VALUES
        ('boss','owner',1), ('adm','admin',1), ('sec','secretaire',1);
      INSERT INTO employees (id, name, pay_amount, pay_cycle_type, last_paid_at, joined_date, active) VALUES
        (1, 'Karim', 3000, 'monthly', '2026-08-01', '2025-01-01', 1);
    `);
    const env = { DB: d1 };
    await runFinanceReminders(env, { today: '2026-10-20' }); // due 2026-09-01 ≤ today
    const payrollCalls = sendFcmToUser.mock.calls.filter((c: any[]) => String((c[2] as any)?.data?.kind || '').startsWith('payroll_due'));
    expect(payrollCalls.length).toBe(2);
    expect(payrollCalls.map((c: any[]) => String(c[1])).sort()).toEqual(['adm', 'boss']);
  });

  it('delivery re-checks the recipient: demoted or deactivated users are skipped', async () => {
    sqlite.exec(`
      INSERT INTO app_users (username, role, active) VALUES ('boss','owner',1), ('sec','secretaire',1);
      INSERT INTO invoices (id, number, client_name, total, due_date, status) VALUES
        (1, 'F-900', 'Client', 2500, '2020-01-15', 'sent');
    `);
    // Enqueue while both are authorized…
    await enqueueOutbox(d1, { event: 'invoice_overdue:1:2020-01', period: '2026-10', recipient: 'boss', title: 't', body: 'b' });
    await enqueueOutbox(d1, { event: 'invoice_overdue:1:2020-01', period: '2026-10', recipient: 'sec', title: 't', body: 'b' });
    // …then demote one and deactivate the other BEFORE delivery.
    sqlite.exec(`UPDATE app_users SET role='user' WHERE username='boss'; UPDATE app_users SET active=0 WHERE username='sec';`);
    await runFinanceReminders({ DB: d1 }, { today: '2026-10-20' });
    const financePushes = sendFcmToUser.mock.calls.filter((c: any[]) => String((c[2] as any)?.data?.kind || '').startsWith('invoice_overdue:1:2020-01'));
    expect(financePushes.length).toBe(0);
    const skipped = await d1.prepare(`SELECT COUNT(*) n FROM finance_outbox WHERE status='skipped'`).first() as any;
    expect(Number(skipped.n)).toBe(2);
  });

  it('report sequence: day 1 ready-notice to admins, days 2-3 changes only, day 4 silent', async () => {
    sqlite.exec(`
      INSERT INTO app_users (username, role, active) VALUES ('boss','owner',1), ('sec','secretaire',1);
      INSERT INTO invoices (id, number, client_name, total, due_date, status) VALUES
        (1, 'F-700', 'Alpha', 1000, '2026-09-30', 'sent');
      INSERT INTO invoice_payments (invoice_id, amount, paid_at) VALUES (1, 400, '2026-09-15');
    `);
    const env = { DB: d1 };
    const day1 = await runFinanceReminders(env, { today: '2026-10-01' });
    expect(day1.stage).toBe(1);
    const d1rows = await d1.prepare(`SELECT recipient, title FROM finance_outbox WHERE event LIKE 'report_reminder:1:%'`).all() as any;
    expect(d1rows.results.length).toBe(1); // owner only — secretaire excluded
    expect(d1rows.results[0].recipient).toBe('boss');
    expect(String(d1rows.results[0].title)).toContain('2026-09');

    // Day 2: a NEW obligation appeared overnight (second unpaid September invoice).
    sqlite.exec(`INSERT INTO invoices (id, number, client_name, total, due_date, status) VALUES (2, 'F-701', 'Beta', 900, '2026-09-20', 'sent');`);
    const day2 = await runFinanceReminders(env, { today: '2026-10-02' });
    expect(day2.stage).toBe(2);
    const d2 = await d1.prepare(`SELECT body FROM finance_outbox WHERE event LIKE 'report_reminder:2:%'`).first() as any;
    expect(String(d2.body)).not.toContain('Aucun changement');
    expect(String(d2.body)).toContain('900'); // newly overdue delta, amounts allowed (push_amounts=1)

    // Day 4: no report reminder at all.
    const before = await d1.prepare(`SELECT COUNT(*) n FROM finance_outbox WHERE event LIKE 'report_reminder%'`).first() as any;
    const day4 = await runFinanceReminders(env, { today: '2026-10-04' });
    expect(day4.stage).toBeNull();
    const after = await d1.prepare(`SELECT COUNT(*) n FROM finance_outbox WHERE event LIKE 'report_reminder%'`).first() as any;
    expect(Number(after.n)).toBe(Number(before.n));
  });

  it('payment-recorded notification is deduped and best-effort', async () => {
    sqlite.exec(`INSERT INTO app_users (username, role, active) VALUES ('boss','owner',1), ('sec','secretaire',1);`);
    const env = { DB: d1 };
    const info = { invoiceId: 42, number: 'F-042', clientName: 'Client X', amount: 600, remaining: 400, status: 'partial' };
    await notifyPaymentRecorded(env, info);
    expect(sendFcmToUser).toHaveBeenCalledTimes(2);
    await notifyPaymentRecorded(env, info); // same day → same idem keys → no new push
    expect(sendFcmToUser).toHaveBeenCalledTimes(2);
  });

  it('retries with backoff on delivery failure and gives up after 5 attempts', async () => {
    sqlite.exec(`INSERT INTO app_users (username, role, active) VALUES ('boss','owner',1);`);
    await enqueueOutbox(d1, { event: 'invoice_due:9:2026-10-20', period: '2026-10', recipient: 'boss', title: 't', body: 'b' });
    sendFcmToUser.mockRejectedValue(new Error('FCM down'));
    const env = { DB: d1 };
    // Drain via a no-op reminder run (no docs seeded → nothing new enqueued).
    await runFinanceReminders(env, { today: '2026-10-20' });
    let row = await d1.prepare(`SELECT status, attempts, last_error, next_attempt_at FROM finance_outbox WHERE event='invoice_due:9:2026-10-20'`).first() as any;
    expect(row.status).toBe('pending');
    expect(Number(row.attempts)).toBe(1);
    expect(String(row.last_error)).toContain('FCM down');
    expect(String(row.next_attempt_at)).not.toBe(''); // backoff scheduled

    // While next_attempt_at is in the future, further runs do NOT redeliver.
    await runFinanceReminders(env, { today: '2026-10-20' });
    expect(Number((await d1.prepare(`SELECT attempts FROM finance_outbox WHERE event='invoice_due:9:2026-10-20'`).first() as any).attempts)).toBe(1);

    // Force the backoff into the past and fail until the attempt cap.
    for (let i = 0; i < 4; i++) {
      sqlite.exec(`UPDATE finance_outbox SET next_attempt_at='' WHERE event='invoice_due:9:2026-10-20'`);
      await runFinanceReminders(env, { today: '2026-10-20' });
    }
    row = await d1.prepare(`SELECT status, attempts FROM finance_outbox WHERE event='invoice_due:9:2026-10-20'`).first() as any;
    expect(row.status).toBe('failed');
    expect(Number(row.attempts)).toBe(5);
  });

  it('lock-screen privacy: amounts are masked when finance_push_amounts = 0', async () => {
    sqlite.exec(`
      UPDATE company_settings SET finance_push_amounts = 0 WHERE id = 1;
      INSERT INTO app_users (username, role, active) VALUES ('boss','owner',1);
      INSERT INTO invoices (id, number, client_name, total, due_date, status) VALUES
        (1, 'F-900', 'Client', 2500, '2020-01-15', 'sent');
    `);
    await runFinanceReminders({ DB: d1 }, { today: '2026-10-20' });
    expect(sendFcmToUser).toHaveBeenCalledTimes(1);
    const body = String((sendFcmToUser.mock.calls[0][2] as any).body);
    expect(body).not.toMatch(/\d{3,}/); // no 2500, no dates' digits run
    expect(body).toContain('—');
  });
});
