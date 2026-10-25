/**
 * v254 — Role-safe finance, payroll & reminders (server-authoritative).
 *
 * Everything money-related here is computed ONLY from persisted ledger rows
 * (invoice_payments, bill_payments, employee_payments, expenses) — never from
 * client-supplied totals. All endpoints built on this module are gated by
 * financeGate() (owner/admin only) and all data is tenant-scoped: this
 * deployment is single-company, so `tenant` is the constant 'main' and the
 * company identity comes from company_settings — a client can never name a
 * tenant, role, employee or recipient.
 *
 * Money: D1 stores REAL; every aggregation goes through round2() (half-up,
 * 2 decimals) so sums never drift by floating-point dust.
 *
 * Timezone semantics: business dates (due_date, expense_date, paid_at) are
 * plain YYYY-MM-DD strings entered in the company's local timezone (default
 * Africa/Casablanca, configurable via company_settings.finance_timezone).
 * Period bounds (YYYY-MM) are therefore inclusive local date ranges — no UTC
 * conversion ambiguity. created_at columns are UTC (datetime('now')) and are
 * never used for period math.
 */

import { normalizeRole } from './rbac';
import { sendFcmToUser } from './fcm';

/* ─────────────────────────── pure helpers ─────────────────────────── */

export const FINANCE_TENANT = 'main';
const ROLE_ORDER: Record<string, number> = { user: 1, stock: 1, secretaire: 2, admin: 3, owner: 4 };

/** Half-up rounding to 2 decimals — the only money normalizer. */
export function round2(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Strict YYYY-MM validation (rejects 2026-13, 26-01, garbage). */
export function isValidPeriod(p: string): boolean {
  const m = String(p || '').match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  return !!m;
}

/** Inclusive local-date bounds of a YYYY-MM period + the exclusive next day. */
export function monthBounds(period: string): { start: string; end: string; nextStart: string } {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  const start = `${period}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month
  const end = `${period}-${String(lastDay).padStart(2, '0')}`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const nextStart = `${ny}-${String(nm).padStart(2, '0')}-01`;
  return { start, end, nextStart };
}

/** Previous period (YYYY-MM) — wraps across years. */
export function prevPeriod(period: string): string {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** Calendar date (YYYY-MM-DD) in a given IANA timezone, DST/month-length safe. */
export function localTodayYmd(timeZone: string, now: Date = new Date()): string {
  try {
    return now.toLocaleDateString('en-CA', { timeZone });
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function addDaysYmd(ymd: string, days: number): string {
  const m = String(ymd).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function daysBetweenYmd(from: string, to: string): number {
  const a = String(from).slice(0, 10);
  const b = String(to).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return 0;
  const d0 = Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)));
  const d1 = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10)));
  return Math.floor((d1 - d0) / 86400000);
}

/**
 * Document money state — one unambiguous classifier for invoices AND bills.
 * `remaining` is derived from persisted payment rows, never a client value.
 */
export type DocMoneyState = 'paid' | 'partial' | 'unpaid' | 'overdue';
export function classifyDoc(total: number, paid: number, dueDate: string | null, todayYmd: string): {
  state: DocMoneyState;
  remaining: number;
  overdue: boolean;
} {
  const t = round2(total);
  const p = round2(paid);
  const remaining = Math.max(0, round2(t - p));
  const due = String(dueDate || '').slice(0, 10);
  const overdue = !!due && /^\d{4}-\d{2}-\d{2}$/.test(due) && due < todayYmd && remaining > 0.005;
  if (remaining <= 0.005) return { state: 'paid', remaining: 0, overdue: false };
  if (overdue) return { state: 'overdue', remaining, overdue: true };
  if (p > 0.005) return { state: 'partial', remaining, overdue: false };
  return { state: 'unpaid', remaining, overdue: false };
}

/** Durable outbox idempotency key: (tenant, event, period, recipient). */
export function outboxKey(tenant: string, event: string, period: string, recipient: string): string {
  return [tenant, event, period, recipient].map((s) => String(s || '').slice(0, 120)).join('|');
}

/** Report reminder sequence: day 1 = ready, 2/3 = changes only, else nothing. */
export function reportReminderStage(dayOfMonth: number): 1 | 2 | 3 | null {
  if (dayOfMonth === 1 || dayOfMonth === 2 || dayOfMonth === 3) return dayOfMonth as 1 | 2 | 3;
  return null;
}

/**
 * Finance gate — server-side authorization for every finance surface.
 * owner/admin: full. secretaire: retained financial access lives in the
 * existing invoice/client routes (canMutateBusiness) but NOT here: payroll,
 * company-wide treasury and admin reports are owner/admin only. stock/user:
 * nothing. UI role checks are irrelevant — this runs inside every endpoint.
 */
export function financeGate(role: string | undefined | null, username: string | undefined | null): { ok: true } | {
  ok: false; status: 401 | 403; code: string; error: string;
} {
  if (!String(username || '')) return { ok: false, status: 401, code: 'UNAUTHORIZED', error: 'Session invalide' };
  const r = normalizeRole(role);
  const lvl = ROLE_ORDER[r] || 0;
  if (lvl < ROLE_ORDER.admin) {
    return { ok: false, status: 403, code: 'FIN_FORBIDDEN', error: 'Réservé aux administrateurs (owner/admin).' };
  }
  return { ok: true };
}

/* ─────────────────── payroll math (pure, mirrors employees.ts) ─────────────────── */

export type PayrollEmployeeRow = {
  id: number;
  emp_number?: string | null;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  pay_amount?: number | null;
  pay_cycle_type?: string | null;
  pay_cycle_days?: number | null;
  last_paid_at?: string | null;
  joined_date?: string | null;
  active?: number | null;
};

export function payrollCycleDays(row: PayrollEmployeeRow): number {
  const t = String(row.pay_cycle_type || 'monthly');
  if (t === 'monthly') return 30;
  const d = Number(row.pay_cycle_days || 7);
  return Math.max(1, Math.min(365, d || 7));
}

/**
 * Accrued obligation for ONE employee as of `asOfYmd` — same rules as the
 * employees module (anchor = last_paid_at || joined_date, pro-rata
 * (elapsed/cycle) × pay_amount capped at one cycle, advances deducted).
 * Never inferred from sales or user balances.
 */
export function payrollObligation(
  row: PayrollEmployeeRow,
  asOfYmd: string,
  advancesInPeriod: number,
): {
  employee_id: number;
  display_name: string;
  amount_due: number;
  pay_period: { from: string; to: string };
  due_date: string | null;
  daily_rate: number;
} | null {
  if (Number(row.active ?? 1) === 0) return null;
  const amount = Number(row.pay_amount || 0);
  if (!(amount > 0)) return null;
  const cycle = payrollCycleDays(row);
  const last = row.last_paid_at ? String(row.last_paid_at).slice(0, 10) : '';
  const joined = row.joined_date ? String(row.joined_date).slice(0, 10) : '';
  const anchor = last || joined;
  if (!anchor || !/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return null;
  const dueDate = addDaysYmd(anchor, cycle);
  const elapsed = Math.max(0, Math.min(cycle, daysBetweenYmd(anchor, asOfYmd)));
  const dailyRate = round2(amount / cycle);
  const gross = round2((elapsed / cycle) * amount);
  const net = Math.max(0, round2(gross - Math.max(0, round2(advancesInPeriod))));
  const fn = String(row.first_name || '').trim();
  const ln = String(row.last_name || '').trim();
  const display = (fn || ln ? `${fn} ${ln}`.trim() : String(row.name || '').trim()) || '—';
  return {
    employee_id: Number(row.id),
    display_name: display,
    amount_due: net,
    pay_period: { from: anchor, to: addDaysYmd(anchor, cycle) },
    due_date: dueDate,
    daily_rate: dailyRate,
  };
}

/* ─────────────────────────── schema & context ─────────────────────────── */

export async function ensureFinanceSchema(db: D1Database): Promise<void> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS finance_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant TEXT NOT NULL DEFAULT 'main',
      event TEXT NOT NULL,
      period TEXT NOT NULL DEFAULT '',
      recipient TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'push',
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      href TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      idem_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT NOT NULL DEFAULT '',
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      sent_at TEXT
    )`,
  ).run();
  for (const sql of [
    `ALTER TABLE company_settings ADD COLUMN finance_timezone TEXT DEFAULT 'Africa/Casablanca'`,
    `ALTER TABLE company_settings ADD COLUMN finance_currency TEXT DEFAULT 'MAD'`,
    `ALTER TABLE company_settings ADD COLUMN finance_push_amounts INTEGER DEFAULT 1`,
  ]) {
    try { await db.prepare(sql).run(); } catch { /* column already present */ }
  }
}

export type FinanceContext = {
  tenant: string;
  timezone: string;
  currency: string;
  pushAmounts: boolean;
  companyName: string;
  today: string;
};

export async function getFinanceContext(db: D1Database): Promise<FinanceContext> {
  await ensureFinanceSchema(db);
  let timezone = 'Africa/Casablanca';
  let currency = 'MAD';
  let pushAmounts = true;
  let companyName = 'Atlas Commerce';
  try {
    const s = await db.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    if (s) {
      timezone = String(s.finance_timezone || timezone);
      currency = String(s.finance_currency || currency);
      pushAmounts = Number(s.finance_push_amounts ?? 1) === 1;
      companyName = String(s.company_name || s.name || companyName);
    }
  } catch { /* settings table may lag — defaults apply */ }
  return { tenant: FINANCE_TENANT, timezone, currency, pushAmounts, companyName, today: localTodayYmd(timezone) };
}

/* ─────────────────────────── monthly summary ─────────────────────────── */

async function sumUntil(db: D1Database, sql: string, untilInclusive: string): Promise<number> {
  try {
    const r = await db.prepare(sql).bind(untilInclusive).first() as any;
    return round2(Number(r?.s || 0));
  } catch { return 0; }
}

/* v258 — canonical cash filters (single source of truth for summary, statement
 * and PDF):
 *  - sales exclude « Avoir … » audit rows: a credit note inserts an
 *    invoice_payments trail row (positive amount) whose cash effect is NOT an
 *    inflow — the real cash outflow lives in the paired 'Remboursement client'
 *    expense row (cash slice only). Counting the trail row inflated
 *    sales_received AND closing_balance by the credit-vs-debt slice.
 *  - expenses exclude mirror ledger rows written by other payment tables
 *    (bill payments → 'Règlement fournisseur' + notes 'bill_id:…'; payroll →
 *    'Salaire' + notes 'employee_id:…'). Those rows exist for the Solde cash
 *    journal UI only; counting them here double-subtracted every supplier and
 *    payroll payment (once via expenses, once via supplier_paid/payroll_paid) —
 *    the root cause of unexplained amounts like a 6,000 MAD supplier payment
 *    appearing both as an expense and as a 6,000 MAD hole in closing_balance. */
const SQL_SALES = `SELECT COALESCE(SUM(amount),0) s FROM invoice_payments WHERE COALESCE(note,'') NOT LIKE 'Avoir%' AND substr(paid_at,1,10) <= ?`;
const SQL_EXPENSES = `SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE entry_type='expense'
  AND NOT (category='Règlement fournisseur' AND COALESCE(notes,'') LIKE 'bill_id:%')
  AND NOT (category='Salaire' AND COALESCE(notes,'') LIKE 'employee_id:%')
  AND substr(expense_date,1,10) <= ?`;
const SQL_PAYROLL_PAID = `SELECT COALESCE(SUM(amount),0) s FROM employee_payments WHERE substr(paid_at,1,10) <= ?`;
const SQL_BILLS_PAID = `SELECT COALESCE(SUM(amount),0) s FROM bill_payments WHERE substr(paid_at,1,10) <= ?`;

export type OutstandingDoc = {
  id: number;
  number: string;
  party: string;
  total: number;
  paid: number;
  remaining: number;
  due_date: string;
  state: DocMoneyState;
};

export type MirrorAudit = {
  mirror_rows_excluded: { supplier: { count: number; total: number }; payroll: { count: number; total: number } };
  payment_tables: { supplier: { count: number; total: number }; payroll: { count: number; total: number } };
  consistent: boolean;
};

export type MonthlySummary = {
  period: string;
  timezone: string;
  currency: string;
  opening_balance: number;
  closing_balance: number;
  sales_received: number;
  refunds: number;
  expenses: number;
  payroll_paid: number;
  supplier_paid: number;
  receivables: { total_outstanding: number; total_overdue: number; documents: OutstandingDoc[] };
  payables: { total_outstanding: number; total_overdue: number; documents: OutstandingDoc[] };
  payroll: { total_due: number; employees: number };
  reconciliation: { source: string; generated_at: string; rules: string };
  /** v259 — automatic double-count audit (docs/finance-6000-investigation.md). */
  mirror_audit: MirrorAudit;
};

/** Rows excluded from receivables: quotes, cancellations, paid, and the
 *  non-receivable document kinds (same filter the /api/alerts feed uses). */
const RECEIVABLE_WHERE = `
  COALESCE(i.doc_kind,'invoice') NOT IN ('quick_sale','ticket','remboursement')
  AND IFNULL(i.number,'') NOT LIKE 'VR-%'
  AND IFNULL(i.number,'') NOT LIKE 'WR-%'
  AND i.status NOT IN ('paid','cancelled','quote','devis')`;

export async function computeOutstandingInvoices(db: D1Database, today: string): Promise<OutstandingDoc[]> {
  const { results } = await db.prepare(
    `SELECT i.id, i.number, i.client_name, i.total, i.due_date, i.status,
            COALESCE((SELECT SUM(amount) FROM invoice_payments p WHERE p.invoice_id = i.id), 0) paid
     FROM invoices i WHERE ${RECEIVABLE_WHERE} ORDER BY i.due_date ASC, i.id ASC`,
  ).all() as any;
  const out: OutstandingDoc[] = [];
  for (const r of results || []) {
    const c = classifyDoc(Number(r.total || 0), Number(r.paid || 0), r.due_date, today);
    if (c.state === 'paid') continue;
    out.push({
      id: Number(r.id), number: String(r.number || ''), party: String(r.client_name || ''),
      total: round2(Number(r.total || 0)), paid: round2(Number(r.paid || 0)),
      remaining: c.remaining, due_date: String(r.due_date || ''), state: c.state,
    });
  }
  return out;
}

export async function computeOutstandingBills(db: D1Database, today: string): Promise<OutstandingDoc[]> {
  const { results } = await db.prepare(
    `SELECT b.id, b.number, b.vendor_name, b.total, b.due_date, b.status,
            COALESCE((SELECT SUM(amount) FROM bill_payments bp WHERE bp.bill_id = b.id), 0) paid
     FROM bills b WHERE b.status NOT IN ('paid','cancelled') ORDER BY b.due_date ASC, b.id ASC`,
  ).all() as any;
  const out: OutstandingDoc[] = [];
  for (const r of results || []) {
    const c = classifyDoc(Number(r.total || 0), Number(r.paid || 0), r.due_date, today);
    if (c.state === 'paid') continue;
    out.push({
      id: Number(r.id), number: String(r.number || ''), party: String(r.vendor_name || ''),
      total: round2(Number(r.total || 0)), paid: round2(Number(r.paid || 0)),
      remaining: c.remaining, due_date: String(r.due_date || ''), state: c.state,
    });
  }
  return out;
}

export async function computePayrollObligations(db: D1Database, asOfYmd: string): Promise<
  ReturnType<typeof payrollObligation>[]
> {
  try {
    const { results } = await db.prepare(
      `SELECT id, emp_number, name, first_name, last_name, pay_amount, pay_cycle_type,
              pay_cycle_days, last_paid_at, joined_date, active
       FROM employees WHERE COALESCE(active,1) = 1 AND COALESCE(pay_amount,0) > 0.001`,
    ).all() as any;
    const out: ReturnType<typeof payrollObligation>[] = [];
    for (const row of results || []) {
      let advances = 0;
      try {
        const anchor = String(row.last_paid_at || row.joined_date || '').slice(0, 10) || '2000-01-01';
        const r = await db.prepare(
          `SELECT COALESCE(SUM(amount),0) s FROM employee_payments
           WHERE employee_id = ? AND substr(paid_at,1,10) >= ? AND substr(paid_at,1,10) <= ?
             AND (period_label LIKE 'Acompte%' OR note LIKE '%[acompte]%')`,
        ).bind(Number(row.id), anchor, asOfYmd).first() as any;
        advances = Number(r?.s || 0);
      } catch { /* advances table may lag */ }
      const ob = payrollObligation(row, asOfYmd, advances);
      if (ob) out.push(ob);
    }
    return out;
  } catch { return []; }
}

/**
 * Authoritative monthly summary.
 * Calculation rules (explicit, ledger-derived):
 *  - sales_received  = Σ invoice_payments.amount with paid_at in period
 *  - refunds         = Σ expenses(entry_type='expense', category='Remboursement client') in period
 *  - expenses        = Σ expenses(entry_type='expense') in period (refunds included — shown separately)
 *  - payroll_paid    = Σ employee_payments.amount with paid_at in period (advances included: real cash out)
 *  - supplier_paid   = Σ bill_payments.amount with paid_at in period
 *  - closing_balance = cumulative (sales − expenses − payroll_paid − supplier_paid) over ALL history ≤ period end
 *  - opening_balance = closing_balance − period net
 *  - receivables/payables use persisted payment rows as source of truth (remaining = total − Σ payments)
 *  - payroll.total_due = accrued obligations of active employees due by period end (pro-rata, advances deducted)
 */
export async function computeMonthlySummary(db: D1Database, period: string, ctx: FinanceContext): Promise<MonthlySummary> {
  const b = monthBounds(period);
  const inPeriod = (sql: string) =>
    sumUntil(db, sql, b.end).then((until) =>
      sumUntil(db, sql, addDaysYmd(b.start, -1)).then((before) => round2(until - before)),
    );

  const [sales, expensesTotal, payrollPaid, supplierPaid] = await Promise.all([
    inPeriod(SQL_SALES), inPeriod(SQL_EXPENSES), inPeriod(SQL_PAYROLL_PAID), inPeriod(SQL_BILLS_PAID),
  ]);

  let refunds = 0;
  try {
    const r = await db.prepare(
      `SELECT COALESCE(SUM(amount),0) s FROM expenses
       WHERE entry_type='expense' AND category='Remboursement client'
         AND substr(expense_date,1,10) >= ? AND substr(expense_date,1,10) <= ?`,
    ).bind(b.start, b.end).first() as any;
    refunds = round2(Number(r?.s || 0));
  } catch { /* */ }

  const closing = round2(
    (await sumUntil(db, SQL_SALES, b.end)) -
    (await sumUntil(db, SQL_EXPENSES, b.end)) -
    (await sumUntil(db, SQL_PAYROLL_PAID, b.end)) -
    (await sumUntil(db, SQL_BILLS_PAID, b.end)),
  );
  const opening = round2(closing - (sales - expensesTotal - payrollPaid - supplierPaid));

  const asOf = ctx.today < b.end && ctx.today >= b.start ? ctx.today : (ctx.today < b.start ? addDaysYmd(b.start, -1) : b.end);
  const [invoices, bills, payroll] = await Promise.all([
    computeOutstandingInvoices(db, ctx.today),
    computeOutstandingBills(db, ctx.today),
    computePayrollObligations(db, b.end),
  ]);
  const payrollDue = payroll.filter((p) => p && p.due_date && p.due_date <= b.end && p.amount_due > 0.005);

  return {
    period,
    timezone: ctx.timezone,
    currency: ctx.currency,
    opening_balance: opening,
    closing_balance: closing,
    sales_received: sales,
    refunds,
    expenses: expensesTotal,
    payroll_paid: payrollPaid,
    supplier_paid: supplierPaid,
    receivables: {
      total_outstanding: round2(invoices.reduce((s, d) => s + d.remaining, 0)),
      total_overdue: round2(invoices.filter((d) => d.state === 'overdue').reduce((s, d) => s + d.remaining, 0)),
      documents: invoices,
    },
    payables: {
      total_outstanding: round2(bills.reduce((s, d) => s + d.remaining, 0)),
      total_overdue: round2(bills.filter((d) => d.state === 'overdue').reduce((s, d) => s + d.remaining, 0)),
      documents: bills,
    },
    payroll: {
      total_due: round2(payrollDue.reduce((s, p) => s + (p?.amount_due || 0), 0)),
      employees: payrollDue.length,
    },
    reconciliation: {
      source: 'd1-live',
      generated_at: new Date().toISOString(),
      rules: 'docs/api-finance.md#calculation-rules',
      as_of_date: asOf,
    } as any,
    // v259 — automatic double-count audit (see docs/finance-6000-investigation.md)
    mirror_audit: await computeMirrorAudit(db),
  };
}

/* ─────────────────────────── canonical statement (v258) ───────────────────────────
 * One ledger view over the five persisted cash sources. The monthly summary,
 * the PDF and GET /api/admin/finance/statement all derive from these same
 * filtered queries, so totals can never disagree again.
 *   credit = cash in  (invoice payments, excluding « Avoir » audit trails)
 *   debit  = cash out (real expenses, client refunds, payroll, supplier payments)
 * Mirror ledger rows (Solde journal copies of payroll/supplier payments) are
 * excluded — see SQL_EXPENSES comment. */

export type StatementRowType = 'sale' | 'refund' | 'expense' | 'payroll' | 'supplier';

export type StatementRow = {
  id: number;
  source: string;
  type: StatementRowType;
  label: string;
  ref: string;
  debit: number;
  credit: number;
  ts: string;
  running_balance: number;
};

export type Statement = {
  period: string;
  timezone: string;
  currency: string;
  as_of: string;
  status: 'open' | 'closed';
  opening_balance: number;
  closing_balance: number;
  totals: { credits: number; debits: number; net: number };
  reconciliation: {
    opening: number;
    credits: number;
    debits: number;
    closing: number;
    balanced: boolean;
    rule: string;
  };
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
  rows: StatementRow[];
  mirror_audit: MirrorAudit;
};

const MIRROR_EXPENSE = `NOT (category='Règlement fournisseur' AND COALESCE(notes,'') LIKE 'bill_id:%')
   AND NOT (category='Salaire' AND COALESCE(notes,'') LIKE 'employee_id:%')`;

async function ledgerRows(db: D1Database, fromYmd: string, toYmd: string): Promise<Omit<StatementRow, 'running_balance'>[]> {
  const out: Omit<StatementRow, 'running_balance'>[] = [];
  const push = (r: Omit<StatementRow, 'running_balance'>) => out.push(r);
  try {
    const sales = await db.prepare(
      `SELECT ip.id, ip.amount, ip.paid_at, i.number, i.client_name
       FROM invoice_payments ip LEFT JOIN invoices i ON i.id = ip.invoice_id
       WHERE COALESCE(ip.note,'') NOT LIKE 'Avoir%'
         AND substr(ip.paid_at,1,10) >= ? AND substr(ip.paid_at,1,10) <= ?`,
    ).bind(fromYmd, toYmd).all() as any;
    for (const r of sales?.results || []) {
      push({
        id: Number(r.id), source: 'invoice_payments', type: 'sale',
        label: `Encaissement ${String(r.number || 'facture')}`,
        ref: String(r.number || `PAY-${r.id}`),
        debit: 0, credit: round2(Number(r.amount || 0)), ts: String(r.paid_at || '').slice(0, 10),
      });
    }
  } catch { /* table may lag */ }
  try {
    const exp = await db.prepare(
      `SELECT id, amount, expense_date, category, description, reference
       FROM expenses
       WHERE entry_type='expense' AND ${MIRROR_EXPENSE}
         AND substr(expense_date,1,10) >= ? AND substr(expense_date,1,10) <= ?`,
    ).bind(fromYmd, toYmd).all() as any;
    for (const r of exp?.results || []) {
      const isRefund = String(r.category || '') === 'Remboursement client';
      push({
        id: Number(r.id), source: 'expenses', type: isRefund ? 'refund' : 'expense',
        label: String(r.description || r.category || 'Dépense'),
        ref: String(r.reference || `EXP-${r.id}`),
        debit: round2(Number(r.amount || 0)), credit: 0, ts: String(r.expense_date || '').slice(0, 10),
      });
    }
  } catch { /* table may lag */ }
  try {
    const pay = await db.prepare(
      `SELECT ep.id, ep.amount, ep.paid_at, ep.period_label, ep.note, ep.employee_id, e.emp_number
       FROM employee_payments ep LEFT JOIN employees e ON e.id = ep.employee_id
       WHERE substr(ep.paid_at,1,10) >= ? AND substr(ep.paid_at,1,10) <= ?`,
    ).bind(fromYmd, toYmd).all() as any;
    for (const r of pay?.results || []) {
      const empRef = String(r.emp_number || `EMP-${r.employee_id}`);
      const isAdvance = /\[acompte\]/i.test(String(r.note || '')) || /^acompte/i.test(String(r.period_label || ''));
      push({
        id: Number(r.id), source: 'employee_payments', type: 'payroll',
        label: `${isAdvance ? 'Acompte' : 'Salaire'} ${empRef}`,
        ref: `${empRef}/PAY-${r.id}`,
        debit: round2(Number(r.amount || 0)), credit: 0, ts: String(r.paid_at || '').slice(0, 10),
      });
    }
  } catch { /* table may lag */ }
  try {
    const sup = await db.prepare(
      `SELECT bp.id, bp.amount, bp.paid_at, bp.bill_id, b.number, b.vendor_name
       FROM bill_payments bp LEFT JOIN bills b ON b.id = bp.bill_id
       WHERE substr(bp.paid_at,1,10) >= ? AND substr(bp.paid_at,1,10) <= ?`,
    ).bind(fromYmd, toYmd).all() as any;
    for (const r of sup?.results || []) {
      push({
        id: Number(r.id), source: 'bill_payments', type: 'supplier',
        label: `Règlement achat ${String(r.number || `ACH-${r.bill_id}`)}`,
        ref: String(r.number || `BILL-${r.bill_id}`),
        debit: round2(Number(r.amount || 0)), credit: 0, ts: String(r.paid_at || '').slice(0, 10),
      });
    }
  } catch { /* table may lag */ }
  out.sort((a, b) => a.ts.localeCompare(b.ts) || a.source.localeCompare(b.source) || a.id - b.id);
  return out;
}

/**
 * v259 — automatic double-count audit (no CLI needed): aggregates the mirror
 * ledger rows excluded from the canonical math and cross-checks them against
 * the payment tables. Surfaced in the monthly summary and the statement so the
 * owner sees the reconciliation in the app itself. Sanitized: counts + totals
 * only, never names, references or dates.
 */
export async function computeMirrorAudit(db: D1Database): Promise<MirrorAudit> {
  const q = async (sql: string): Promise<{ count: number; total: number }> => {
    try {
      const r = await db.prepare(sql).first() as any;
      return { count: Number(r?.n || 0), total: round2(Number(r?.s || 0)) };
    } catch { return { count: 0, total: 0 }; }
  };
  const [mSup, mPay] = await Promise.all([
    q(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM expenses
       WHERE entry_type='expense' AND category='Règlement fournisseur' AND COALESCE(notes,'') LIKE 'bill_id:%'`),
    q(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM expenses
       WHERE entry_type='expense' AND category='Salaire' AND COALESCE(notes,'') LIKE 'employee_id:%'`),
  ]);
  const [pSup, pPay] = await Promise.all([
    q(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM bill_payments`),
    q(`SELECT COUNT(*) n, COALESCE(SUM(amount),0) s FROM employee_payments`),
  ]);
  return {
    mirror_rows_excluded: { supplier: mSup, payroll: mPay },
    payment_tables: { supplier: pSup, payroll: pPay },
    consistent: mSup.count === pSup.count && Math.abs(mSup.total - pSup.total) < 0.005
      && mPay.count === pPay.count && Math.abs(mPay.total - pPay.total) < 0.005,
  };
}

async function cashUntil(db: D1Database, untilInclusive: string): Promise<number> {
  const [a, b, c, d] = await Promise.all([
    sumUntil(db, SQL_SALES, untilInclusive),
    sumUntil(db, SQL_EXPENSES, untilInclusive),
    sumUntil(db, SQL_PAYROLL_PAID, untilInclusive),
    sumUntil(db, SQL_BILLS_PAID, untilInclusive),
  ]);
  return round2(a - b - c - d);
}

/**
 * v258 — server-backed monthly statement: opening balance, chronological cash
 * rows with running balance, totals and the reconciliation invariant
 * (opening + credits − debits = closing). Admin-gated by the caller.
 */
export async function computeStatement(
  db: D1Database,
  period: string,
  ctx: FinanceContext,
  page = 1,
  pageSize = 50,
): Promise<Statement> {
  const b = monthBounds(period);
  const currentMonth = ctx.today.slice(0, 7);
  const status: 'open' | 'closed' = period === currentMonth ? 'open' : 'closed';
  const asOf = status === 'open' ? ctx.today : b.end;
  const toYmd = status === 'open' ? (ctx.today < b.end ? ctx.today : b.end) : b.end;
  const opening = await cashUntil(db, addDaysYmd(b.start, -1));
  const raw = await ledgerRows(db, b.start, toYmd);
  let running = opening;
  const withRunning: StatementRow[] = raw.map((r) => {
    running = round2(running + r.credit - r.debit);
    return { ...r, running_balance: running };
  });
  const credits = round2(raw.reduce((s, r) => s + r.credit, 0));
  const debits = round2(raw.reduce((s, r) => s + r.debit, 0));
  const closing = round2(opening + credits - debits);
  const total = withRunning.length;
  const p = Math.max(1, Number(page) || 1);
  const size = Math.min(200, Math.max(1, Number(pageSize) || 50));
  const startIdx = (p - 1) * size;
  return {
    period,
    timezone: ctx.timezone,
    currency: ctx.currency,
    as_of: asOf,
    status,
    opening_balance: opening,
    closing_balance: closing,
    totals: { credits, debits, net: round2(credits - debits) },
    reconciliation: {
      opening,
      credits,
      debits,
      closing,
      balanced: Math.abs(opening + credits - debits - closing) < 0.005,
      rule: 'opening + credits - debits = closing',
    },
    page: p,
    page_size: size,
    total,
    has_more: startIdx + size < total,
    rows: withRunning.slice(startIdx, startIdx + size),
    mirror_audit: await computeMirrorAudit(db),
  } as Statement;
}

/* ─────────────────────────── durable outbox + delivery ─────────────────────────── */

export type OutboxMessage = {
  event: string;
  period: string;
  recipient: string;
  title: string;
  body: string;
  href?: string;
  payload?: Record<string, unknown>;
  channel?: string;
};

/** INSERT OR IGNORE on the UNIQUE idem key — duplicates across retries,
 *  worker restarts and multiple cron invocations are structurally impossible. */
export async function enqueueOutbox(db: D1Database, m: OutboxMessage): Promise<boolean> {
  const key = outboxKey(FINANCE_TENANT, m.event, m.period, m.recipient);
  const res = await db.prepare(
    `INSERT OR IGNORE INTO finance_outbox
       (tenant, event, period, recipient, channel, title, body, href, payload, idem_key, status, next_attempt_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', '')`,
  ).bind(
    FINANCE_TENANT, m.event, m.period, m.recipient, m.channel || 'push',
    m.title.slice(0, 140), m.body.slice(0, 400), String(m.href || '').slice(0, 200),
    JSON.stringify(m.payload || {}).slice(0, 4000), key,
  ).run();
  return Number(res?.meta?.changes || 0) > 0;
}

/** Recipients are re-derived from app_users AT DELIVERY TIME — never from a
 *  client list. Finance events: owner/admin/secretaire (established finance
 *  access). Report/payroll events: owner/admin only. */
export async function financeRecipients(db: D1Database, kind: 'finance' | 'admin'): Promise<string[]> {
  const roles = kind === 'admin' ? ['owner', 'admin'] : ['owner', 'admin', 'secretaire'];
  const { results } = await db.prepare(
    `SELECT username, role FROM app_users WHERE COALESCE(active,1) = 1`,
  ).all() as any;
  return (results || [])
    .filter((u: any) => roles.includes(normalizeRole(u.role)))
    .map((u: any) => String(u.username || '').toLowerCase())
    .filter(Boolean);
}

async function deliverRow(env: any, db: D1Database, row: any, pushAmounts: boolean): Promise<void> {
  // Re-check membership + role at delivery time (a revoked/demoted user must
  // never receive finance pushes enqueued earlier).
  const user = await db.prepare(
    `SELECT username, role, active FROM app_users WHERE username = ?`,
  ).bind(String(row.recipient)).first() as any;
  if (!user || Number(user.active ?? 1) !== 1) {
    await db.prepare(`UPDATE finance_outbox SET status='skipped', last_error='recipient inactive/unknown', sent_at=datetime('now') WHERE id=?`)
      .bind(row.id).run();
    return;
  }
  const minRole = String(row.event).startsWith('report_reminder') || String(row.event).startsWith('payroll') ? 'admin' : 'secretaire';
  const lvl = ROLE_ORDER[normalizeRole(user.role)] || 0;
  if (lvl < ROLE_ORDER[minRole]) {
    await db.prepare(`UPDATE finance_outbox SET status='skipped', last_error='role no longer authorized', sent_at=datetime('now') WHERE id=?`)
      .bind(row.id).run();
    return;
  }
  // Lock-screen privacy: amounts only when the company setting allows it.
  const body = pushAmounts ? String(row.body || '') : String(row.body || '').replace(/\d[\d\s.,]*\s?(MAD|DH)?/gi, '—');
  try {
    await sendFcmToUser(env, String(row.recipient), {
      title: String(row.title || 'Atlas Finance'),
      body: body.slice(0, 240),
      data: { href: String(row.href || ''), kind: String(row.event || ''), period: String(row.period || '') },
    });
    await db.prepare(`UPDATE finance_outbox SET status='sent', sent_at=datetime('now') WHERE id=?`).bind(row.id).run();
  } catch (e: any) {
    const attempts = Number(row.attempts || 0) + 1;
    if (attempts >= 5) {
      await db.prepare(`UPDATE finance_outbox SET status='failed', attempts=?, last_error=? WHERE id=?`)
        .bind(attempts, String(e?.message || e).slice(0, 200), row.id).run();
    } else {
      // Exponential backoff: 1h, 2h, 4h, 8h (worker-restart safe: state is in D1)
      await db.prepare(
        `UPDATE finance_outbox SET attempts=?, last_error=?, next_attempt_at=datetime('now', ?) WHERE id=?`,
      ).bind(attempts, String(e?.message || e).slice(0, 200), `+${2 ** (attempts - 1)} hours`, row.id).run();
    }
  }
}

async function drainOutbox(env: any, db: D1Database, pushAmounts: boolean, limit = 50): Promise<number> {
  const { results } = await db.prepare(
    `SELECT * FROM finance_outbox
     WHERE status='pending' AND attempts < 5 AND (next_attempt_at = '' OR next_attempt_at <= datetime('now'))
     ORDER BY id ASC LIMIT ?`,
  ).bind(limit).all() as any;
  let n = 0;
  for (const row of results || []) {
    await deliverRow(env, db, row, pushAmounts);
    n++;
  }
  return n;
}

/** Client payment recorded → notify finance recipients (deduped by outbox). */
export async function notifyPaymentRecorded(env: any, info: {
  invoiceId: number; number: string; clientName: string; amount: number; remaining: number; status: string;
}): Promise<void> {
  const db = env.DB as D1Database;
  await ensureFinanceSchema(db);
  const ctx = await getFinanceContext(db);
  const paidWord = info.remaining <= 0.005 ? 'soldée' : 'partiellement payée';
  const amountTxt = `${round2(info.amount)} ${ctx.currency}`;
  for (const recipient of await financeRecipients(db, 'finance')) {
    const inserted = await enqueueOutbox(db, {
      event: `payment_recorded:${info.invoiceId}:${ctx.today}`,
      period: ctx.today.slice(0, 7),
      recipient,
      title: `Paiement client — ${info.number || `#${info.invoiceId}`}`,
      body: `${info.clientName || 'Client'} : ${amountTxt} encaissé${ctx.pushAmounts ? '' : ''} — facture ${paidWord} (reste ${round2(info.remaining)} ${ctx.currency}).`,
      href: `/invoices/${info.invoiceId}`,
      payload: { invoice_id: info.invoiceId, amount: round2(info.amount), remaining: round2(info.remaining) },
    });
    if (inserted) {
      try { await drainOutbox(env, db, ctx.pushAmounts, 5); } catch { /* next cron run retries */ }
    }
  }
}

/* ─────────────────────────── the scheduled reminder run ─────────────────────────── */

export type ReminderRunReport = {
  today: string;
  period: string;
  enqueued: number;
  delivered: number;
  stage: 1 | 2 | 3 | null;
};

/**
 * Daily cron entry (wrangler trigger 35 7 * * * UTC ≈ 08:35 Africa/Casablanca)
 * and POST /api/cron/finance-reminders (CRON_SECRET) both call this.
 * Idempotent: re-running the same day enqueues nothing new (UNIQUE idem keys)
 * and only drains what is pending.
 */
export async function runFinanceReminders(env: any, opts?: { today?: string }): Promise<ReminderRunReport> {
  const db = env.DB as D1Database;
  const ctx = await getFinanceContext(db);
  // opts.today is for tests/repair runs only — production always uses the
  // tenant-local clock so month lengths and DST are handled by the TZ itself.
  const today = opts?.today && /^\d{4}-\d{2}-\d{2}$/.test(opts.today) ? opts.today : ctx.today;
  const period = today.slice(0, 7);
  const day = Number(today.slice(8, 10));
  let enqueued = 0;

  const enqueueFor = async (recipients: string[], m: Omit<OutboxMessage, 'recipient'>) => {
    for (const recipient of recipients) {
      if (await enqueueOutbox(db, { ...m, recipient })) enqueued++;
    }
  };

  // 1) Monthly report reminder sequence — days 1/2/3, owner/admin only.
  const stage = reportReminderStage(day);
  if (stage) {
    const targetPeriod = prevPeriod(period);
    const admins = await financeRecipients(db, 'admin');
    let headline = '';
    let snapshot: Record<string, unknown> = {};
    let reportError = '';
    try {
      const s = await computeMonthlySummary(db, targetPeriod, ctx);
      snapshot = {
        receivables: s.receivables.total_outstanding,
        overdue: s.receivables.total_overdue,
        payables: s.payables.total_outstanding,
        payroll: s.payroll.total_due,
        closing: s.closing_balance,
      };
      headline = ctx.pushAmounts
        ? `Clôture ${s.closing_balance} ${ctx.currency} · impayés clients ${s.receivables.total_outstanding} · à payer fournisseurs ${s.payables.total_outstanding} · paie ${s.payroll.total_due}.`
        : 'Clôture et obligations disponibles dans le rapport.';
    } catch (e: any) {
      reportError = String(e?.message || e).slice(0, 160);
    }
    if (stage === 1) {
      await enqueueFor(admins, {
        event: `report_reminder:1:${targetPeriod}`,
        period: targetPeriod,
        title: `Rapport mensuel ${targetPeriod} prêt`,
        body: reportError
          ? `Le rapport ${targetPeriod} n'a pas pu être généré automatiquement (${reportError}). Ouvrez Balance pour le détail.`
          : `Le rapport ${targetPeriod} est prêt. ${headline}`,
        href: '/balance',
        payload: { snapshot, error: reportError },
      });
    } else {
      // Days 2/3: summarize ONLY what changed since day 1 (stored snapshot).
      let deltaNote = 'Aucun changement depuis le premier rappel.';
      try {
        const first = await db.prepare(
          `SELECT payload FROM finance_outbox WHERE event = ? AND status IN ('sent','pending') ORDER BY id ASC LIMIT 1`,
        ).bind(`report_reminder:1:${targetPeriod}`).first() as any;
        const prev = JSON.parse(String(first?.payload || '{}'))?.snapshot || {};
        const dRec = round2(Number(snapshot.receivables || 0) - Number(prev.receivables || 0));
        const dOvd = round2(Number(snapshot.overdue || 0) - Number(prev.overdue || 0));
        const dPay = round2(Number(snapshot.payables || 0) - Number(prev.payables || 0));
        const dSal = round2(Number(snapshot.payroll || 0) - Number(prev.payroll || 0));
        const parts: string[] = [];
        if (Math.abs(dOvd) > 0.005) parts.push(`nouveaux impayés échus ${dOvd} ${ctx.currency}`);
        if (Math.abs(dRec) > 0.005) parts.push(`reste clients ${dRec > 0 ? '+' : ''}${dRec}`);
        if (Math.abs(dPay) > 0.005) parts.push(`fournisseurs ${dPay > 0 ? '+' : ''}${dPay}`);
        if (Math.abs(dSal) > 0.005) parts.push(`paie ${dSal > 0 ? '+' : ''}${dSal}`);
        if (parts.length) deltaNote = ctx.pushAmounts ? parts.join(' · ') + ` ${ctx.currency}.` : 'Des obligations ont changé depuis le premier rappel.';
      } catch { /* keep default note */ }
      await enqueueFor(admins, {
        event: `report_reminder:${stage}:${targetPeriod}`,
        period: targetPeriod,
        title: `Rappel rapport ${targetPeriod} (J${stage})`,
        body: `${deltaNote} Rapport autorisé : Balance → PDF mensuel.`,
        href: '/balance',
        payload: { snapshot },
      });
    }
  }

  // 2) Client invoices due today / newly overdue (per invoice per month).
  const invoices = await computeOutstandingInvoices(db, today);
  const financeRcp = await financeRecipients(db, 'finance');
  for (const inv of invoices) {
    if (inv.due_date === today) {
      await enqueueFor(financeRcp, {
        event: `invoice_due:${inv.id}:${today}`,
        period,
        title: `Facture échue aujourd'hui — ${inv.number}`,
        body: `${inv.party || 'Client'} doit régler ${inv.remaining} ${ctx.currency} aujourd'hui (${inv.number}).`,
        href: `/invoices/${inv.id}`,
      });
    } else if (inv.state === 'overdue') {
      await enqueueFor(financeRcp, {
        event: `invoice_overdue:${inv.id}:${inv.due_date.slice(0, 7)}`,
        // period = the DUE month, not the run month: one overdue notice per
        // document per due-month, however many days/months it stays unpaid.
        period: inv.due_date.slice(0, 7),
        title: `Facture en retard — ${inv.number}`,
        body: `${inv.party || 'Client'} : ${inv.remaining} ${ctx.currency} en retard depuis le ${inv.due_date}.`,
        href: `/invoices/${inv.id}`,
      });
    }
  }

  // 3) Supplier bills due / overdue (what WE still need to pay).
  const bills = await computeOutstandingBills(db, today);
  for (const b of bills) {
    if (b.due_date === today) {
      await enqueueFor(financeRcp, {
        event: `bill_due:${b.id}:${today}`,
        period,
        title: `Facture fournisseur à payer — ${b.number}`,
        body: `${b.party || 'Fournisseur'} : ${b.remaining} ${ctx.currency} à régler aujourd'hui.`,
        href: '/bills',
      });
    } else if (b.state === 'overdue') {
      await enqueueFor(financeRcp, {
        event: `bill_overdue:${b.id}:${b.due_date.slice(0, 7)}`,
        period: b.due_date.slice(0, 7), // one notice per bill per due-month
        title: `Facture fournisseur en retard — ${b.number}`,
        body: `${b.party || 'Fournisseur'} : ${b.remaining} ${ctx.currency} en retard depuis le ${b.due_date}.`,
        href: '/bills',
      });
    }
  }

  // 4) Payroll obligations due (owner/admin only — secretaire never gets payroll).
  const payroll = await computePayrollObligations(db, today);
  const admins = await financeRecipients(db, 'admin');
  for (const p of payroll) {
    if (p && p.due_date && p.due_date <= today && p.amount_due > 0.005) {
      await enqueueFor(admins, {
        event: `payroll_due:${p.employee_id}:${p.due_date.slice(0, 7)}`,
        period: p.due_date.slice(0, 7), // one notice per employee per due-month
        title: `Paie à régler — ${p.display_name}`,
        body: `${p.display_name} : ${p.amount_due} ${ctx.currency} dus (échéance ${p.due_date}).`,
        href: '/employees',
      });
    }
  }

  // 5) Drain (delivers everything enqueued now + retries from earlier runs).
  const delivered = await drainOutbox(env, db, ctx.pushAmounts);
  return { today, period, enqueued, delivered, stage };
}
