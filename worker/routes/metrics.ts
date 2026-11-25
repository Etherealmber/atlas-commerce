import type { Hono } from 'hono';
import { doCacheGet, doCachePut } from '../lib/cache';
import { schemaOnceForDb } from '../lib/schema';
import { normalizeInventoryRole, roleCanSeeFinancial } from '../lib/inventory-policy';

/**
 * KPI sparklines (« cartes façon Cloudflare »).
 *
 * GET /api/metrics/daily?days=7  →  2 × days daily points ending today (UTC):
 * the last `days` points are the current period, the first `days` points the
 * previous period used for the trend percentage.
 *
 * - `flow` metrics are daily totals rebuilt from the transaction tables
 *   (ventes, encaissements, dépenses, nouveaux clients, mouvements de stock…).
 * - `level` metrics are point-in-time values (stock bas, créances, solde…).
 *   Today's value is computed live and stored in `metric_snapshots`; earlier
 *   days come from those snapshots, so a level metric shows « Aucune donnée »
 *   until at least two days have been recorded. A missing day is `null`,
 *   never an invented 0. Product / client / supplier totals are rebuilt from
 *   their creation dates when no snapshot exists yet.
 *
 * Roles without financial access only receive the operational keys.
 */

interface MetricsRouteDeps {
  sessionUserFromHeader: (header: string | undefined) => any;
  refreshLimitGate: (c: any, endpoint: string, maxPerMinute?: number) => Response | null;
}

export type MetricKind = 'flow' | 'level';

export const METRIC_KINDS: Record<string, MetricKind> = {
  // flows
  sales: 'flow',
  sales_fa: 'flow',
  sales_vr: 'flow',
  invoices_count: 'flow',
  tickets_count: 'flow',
  quotes_count: 'flow',
  quotes_amount: 'flow',
  receipts: 'flow',
  expenses: 'flow',
  income: 'flow',
  owner_contrib: 'flow',
  owner_draw: 'flow',
  purchases: 'flow',
  bills_paid: 'flow',
  money_in: 'flow',
  money_out: 'flow',
  net_flow: 'flow',
  cash_net: 'flow',
  bank_net: 'flow',
  clients_new: 'flow',
  vendors_new: 'flow',
  products_new: 'flow',
  stock_moves: 'flow',
  actions_new: 'flow',
  actions_done: 'flow',
  audit_events: 'flow',
  att_present: 'flow',
  att_absent: 'flow',
  cash_variance: 'flow',
  // levels
  products: 'level',
  low_stock: 'level',
  out_of_stock: 'level',
  in_stock: 'level',
  stock_value: 'level',
  receivables: 'level',
  payables: 'level',
  balance: 'level',
  open_invoices: 'level',
  open_tickets: 'level',
  open_quotes: 'level',
  expired_quotes: 'level',
  pending_actions: 'level',
  employees_active: 'level',
  clients_total: 'level',
  vendors_total: 'level',
};

/** Keys every signed-in role may read: counts only, never money. */
export const OPERATIONAL_METRICS = new Set([
  'products', 'low_stock', 'out_of_stock', 'in_stock', 'products_new',
  'stock_moves', 'actions_new', 'actions_done', 'pending_actions',
]);

const day = (col: string) => `substr(replace(COALESCE(${col}, ''), 'T', ' '), 1, 10)`;
/**
 * `day(col) >= start`, plus the equivalent raw comparison `col >= start` so
 * SQLite can range-scan a date index instead of reading the whole table.
 * For ISO-like text the two are equivalent (a 10-char prefix ≥ start ⇔ the
 * value ≥ start); NULLs and numeric values fail both. Uses `?1`, so callers
 * still bind `start` once.
 */
const since = (col: string) => `${col} >= ?1 AND ${day(col)} >= ?1`;
const IS_CASH = (col: string) => `LOWER(COALESCE(${col}, 'cash')) IN ('cash', 'especes', 'espèces')`;
const FA = `status NOT IN ('cancelled', 'quote', 'devis', 'remboursement')
  AND COALESCE(doc_kind, '') NOT IN ('quick_sale', 'ticket', 'remboursement')
  AND IFNULL(number, '') NOT LIKE 'VR-%' AND IFNULL(number, '') NOT LIKE 'VR/%'`;
const VR = `status NOT IN ('cancelled', 'quote', 'devis', 'remboursement')
  AND COALESCE(doc_kind, '') != 'remboursement'
  AND (COALESCE(doc_kind, '') IN ('quick_sale', 'ticket') OR IFNULL(number, '') LIKE 'VR-%' OR IFNULL(number, '') LIKE 'VR/%')`;
const UNPAID = `status IN ('sent', 'partial', 'overdue', 'draft')
  AND COALESCE(doc_kind, '') != 'remboursement'`;

export function todayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** `2 × days` ISO dates ending today (UTC), oldest first. */
export function dayKeys(days: number, now = new Date()): string[] {
  const out: string[] = [];
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = days * 2 - 1; i >= 0; i--) out.push(new Date(base - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

/**
 * Date indexes behind the `since()` range filters — without them every chart
 * refresh read each table end to end (audit_log, stock_movements, payments…).
 * Expression indexes match the exact COALESCE used in `dailyFlows`.
 */
export const METRIC_INDEXES: readonly string[] = [
  'CREATE INDEX IF NOT EXISTS idx_metrics_stock_movements_created ON stock_movements(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_metrics_mobile_actions_created ON mobile_actions(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_metrics_mobile_actions_completed ON mobile_actions(completed_at)',
  'CREATE INDEX IF NOT EXISTS idx_metrics_invoice_payments_day ON invoice_payments(COALESCE(paid_at, created_at))',
  'CREATE INDEX IF NOT EXISTS idx_metrics_bill_payments_day ON bill_payments(COALESCE(paid_at, created_at))',
  'CREATE INDEX IF NOT EXISTS idx_metrics_expenses_day ON expenses(COALESCE(expense_date, created_at))',
  'CREATE INDEX IF NOT EXISTS idx_metrics_bills_issue ON bills(issue_date)',
  'CREATE INDEX IF NOT EXISTS idx_metrics_invoices_issue ON invoices(issue_date)',
  'CREATE INDEX IF NOT EXISTS idx_metrics_audit_created ON audit_log(created_at)',
  'CREATE INDEX IF NOT EXISTS idx_metrics_attendance_day ON employee_attendance(work_date)',
  'CREATE INDEX IF NOT EXISTS idx_metrics_cash_shifts_closed ON cash_shifts(closed_at)',
];

export async function ensureMetricSnapshots(db: D1Database): Promise<void> {
  await schemaOnceForDb(db, 'metric_snapshots_v2', async () => {
    // Defensive fallback only — migration 0022 owns the table.
    await db.prepare(
      `CREATE TABLE IF NOT EXISTS metric_snapshots (
         day TEXT NOT NULL, key TEXT NOT NULL, value REAL NOT NULL DEFAULT 0,
         updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (day, key))`,
    ).run();
    for (const sql of METRIC_INDEXES) {
      try { await db.prepare(sql).run(); } catch { /* optional module table or column missing */ }
    }
  });
}

/** Upsert today's value of point-in-time metrics. Non-finite values are skipped. */
export async function recordMetricSnapshots(db: D1Database, dayKey: string, values: Record<string, number>): Promise<void> {
  const stmts = Object.entries(values)
    .filter(([key, value]) => METRIC_KINDS[key] === 'level' && Number.isFinite(value))
    .map(([key, value]) => db.prepare(
      `INSERT INTO metric_snapshots (day, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(day, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).bind(dayKey, key, Math.round(value * 100) / 100));
  if (!stmts.length) return;
  if (typeof (db as any).batch === 'function') await db.batch(stmts);
  else for (const stmt of stmts) await stmt.run();
}

async function rows(db: D1Database, sql: string, ...binds: unknown[]): Promise<any[]> {
  try {
    const stmt = db.prepare(sql);
    const res = await (binds.length ? stmt.bind(...binds) : stmt).all();
    return (res?.results || []) as any[];
  } catch {
    return []; // optional module table missing on this tenant → no data, not an error
  }
}

async function one(db: D1Database, sql: string, ...binds: unknown[]): Promise<any> {
  return (await rows(db, sql, ...binds))[0] || null;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Current values of every level metric (cheap aggregates). */
export async function currentLevels(db: D1Database): Promise<Record<string, number>> {
  const [prod, inv, bills, actions, emp, cli, ven] = await Promise.all([
    one(db, `SELECT
        COALESCE(SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END), 0) AS products,
        COALESCE(SUM(CASE WHEN is_active = 1 AND track_inventory = 1 AND stock_quantity <= low_stock_threshold THEN 1 ELSE 0 END), 0) AS low_stock,
        COALESCE(SUM(CASE WHEN is_active = 1 AND track_inventory = 1 AND stock_quantity <= 0 THEN 1 ELSE 0 END), 0) AS out_of_stock,
        COALESCE(SUM(CASE WHEN is_active = 1 AND track_inventory = 1 AND stock_quantity > low_stock_threshold THEN 1 ELSE 0 END), 0) AS in_stock,
        COALESCE(SUM(CASE WHEN is_active = 1 THEN stock_quantity * COALESCE(cost, 0) ELSE 0 END), 0) AS stock_value
      FROM products`),
    one(db, `SELECT
        COALESCE(SUM(CASE WHEN ${UNPAID} AND status NOT IN ('quote', 'devis', 'cancelled', 'remboursement') THEN total - COALESCE(amount_paid, 0) ELSE 0 END), 0) AS receivables,
        COALESCE(SUM(CASE WHEN ${UNPAID} AND ${FA} THEN 1 ELSE 0 END), 0) AS open_invoices,
        COALESCE(SUM(CASE WHEN ${UNPAID} AND ${VR} THEN 1 ELSE 0 END), 0) AS open_tickets,
        COALESCE(SUM(CASE WHEN status IN ('quote', 'devis') AND (due_date IS NULL OR due_date = '' OR due_date >= date('now')) THEN 1 ELSE 0 END), 0) AS open_quotes,
        COALESCE(SUM(CASE WHEN status IN ('quote', 'devis') AND due_date IS NOT NULL AND due_date != '' AND due_date < date('now') THEN 1 ELSE 0 END), 0) AS expired_quotes
      FROM invoices`),
    one(db, `SELECT COALESCE(SUM(CASE WHEN status IN ('sent', 'partial', 'draft') THEN total - COALESCE(amount_paid, 0) ELSE 0 END), 0) AS payables FROM bills`),
    one(db, `SELECT COUNT(*) AS pending FROM mobile_actions WHERE status = 'pending'`),
    one(db, `SELECT COUNT(*) AS active FROM employees WHERE COALESCE(active, 1) != 0`),
    one(db, `SELECT COUNT(*) AS n FROM clients`),
    one(db, `SELECT COUNT(*) AS n FROM vendors`),
  ]);
  const out: Record<string, number> = {};
  if (prod) {
    for (const k of ['products', 'low_stock', 'out_of_stock', 'in_stock', 'stock_value']) out[k] = num(prod[k]);
  }
  if (inv) {
    for (const k of ['receivables', 'open_invoices', 'open_tickets', 'open_quotes', 'expired_quotes']) out[k] = num(inv[k]);
  }
  if (bills) out.payables = num(bills.payables);
  if (actions) out.pending_actions = num(actions.pending);
  if (emp) out.employees_active = num(emp.active);
  if (cli) out.clients_total = num(cli.n);
  if (ven) out.vendors_total = num(ven.n);
  return out;
}

/** Daily totals for every flow metric over `dates`. */
export async function dailyFlows(db: D1Database, dates: string[]): Promise<Record<string, number[]>> {
  const start = dates[0];
  const index = new Map(dates.map((d, i) => [d, i]));
  const series: Record<string, number[]> = {};
  const add = (key: string, d: unknown, value: unknown) => {
    const i = index.get(String(d || ''));
    if (i === undefined) return;
    (series[key] ||= dates.map(() => 0))[i] += num(value);
  };
  const ensure = (key: string) => (series[key] ||= dates.map(() => 0));

  const [inv, pay, exp, billPay, bills, cli, ven, prod, moves, actNew, actDone, audit, att, shifts] = await Promise.all([
    rows(db, `SELECT ${day('issue_date')} AS d,
        SUM(CASE WHEN ${FA} THEN total ELSE 0 END) AS fa_total,
        SUM(CASE WHEN ${FA} THEN 1 ELSE 0 END) AS fa_count,
        SUM(CASE WHEN ${VR} THEN total ELSE 0 END) AS vr_total,
        SUM(CASE WHEN ${VR} THEN 1 ELSE 0 END) AS vr_count,
        SUM(CASE WHEN status IN ('quote', 'devis') THEN 1 ELSE 0 END) AS q_count,
        SUM(CASE WHEN status IN ('quote', 'devis') THEN total ELSE 0 END) AS q_total
      FROM invoices WHERE ${since('issue_date')} GROUP BY d`, start),
    rows(db, `SELECT ${day('COALESCE(p.paid_at, p.created_at)')} AS d,
        SUM(p.amount) AS total, SUM(CASE WHEN ${IS_CASH('p.payment_method')} THEN p.amount ELSE 0 END) AS cash
      FROM invoice_payments p INNER JOIN invoices i ON i.id = p.invoice_id
      WHERE COALESCE(i.status, '') NOT IN ('quote', 'devis', 'cancelled', 'remboursement')
        AND COALESCE(i.doc_kind, '') != 'remboursement' AND COALESCE(p.note, '') NOT LIKE 'Avoir %'
        AND ${since('COALESCE(p.paid_at, p.created_at)')} GROUP BY d`, start),
    rows(db, `SELECT ${day('COALESCE(expense_date, created_at)')} AS d,
        SUM(CASE WHEN COALESCE(entry_type, 'expense') = 'expense' THEN amount ELSE 0 END) AS exp,
        SUM(CASE WHEN COALESCE(entry_type, 'expense') = 'expense' AND ${IS_CASH('payment_method')} THEN amount ELSE 0 END) AS exp_cash,
        SUM(CASE WHEN entry_type = 'income' AND COALESCE(category, '') != 'Encaissement client' THEN amount ELSE 0 END) AS inc,
        SUM(CASE WHEN entry_type = 'income' AND COALESCE(category, '') != 'Encaissement client' AND ${IS_CASH('payment_method')} THEN amount ELSE 0 END) AS inc_cash,
        SUM(CASE WHEN entry_type = 'owner_contrib' THEN amount ELSE 0 END) AS contrib,
        SUM(CASE WHEN entry_type = 'owner_contrib' AND ${IS_CASH('payment_method')} THEN amount ELSE 0 END) AS contrib_cash,
        SUM(CASE WHEN entry_type = 'owner_draw' THEN amount ELSE 0 END) AS draw,
        SUM(CASE WHEN entry_type = 'owner_draw' AND ${IS_CASH('payment_method')} THEN amount ELSE 0 END) AS draw_cash
      FROM expenses WHERE ${since('COALESCE(expense_date, created_at)')} GROUP BY d`, start),
    rows(db, `SELECT ${day('COALESCE(paid_at, created_at)')} AS d, SUM(amount) AS total,
        SUM(CASE WHEN ${IS_CASH('payment_method')} THEN amount ELSE 0 END) AS cash
      FROM bill_payments WHERE ${since('COALESCE(paid_at, created_at)')} GROUP BY d`, start),
    rows(db, `SELECT ${day('issue_date')} AS d, SUM(total) AS total FROM bills
      WHERE COALESCE(status, '') != 'cancelled' AND ${since('issue_date')} GROUP BY d`, start),
    rows(db, `SELECT ${day('created_at')} AS d, COUNT(*) AS n FROM clients WHERE ${since('created_at')} GROUP BY d`, start),
    rows(db, `SELECT ${day('created_at')} AS d, COUNT(*) AS n FROM vendors WHERE ${since('created_at')} GROUP BY d`, start),
    rows(db, `SELECT ${day('created_at')} AS d, COUNT(*) AS n FROM products WHERE ${since('created_at')} GROUP BY d`, start),
    rows(db, `SELECT ${day('created_at')} AS d, COUNT(*) AS n FROM stock_movements WHERE ${since('created_at')} GROUP BY d`, start),
    rows(db, `SELECT ${day('created_at')} AS d, COUNT(*) AS n FROM mobile_actions WHERE ${since('created_at')} GROUP BY d`, start),
    rows(db, `SELECT ${day('completed_at')} AS d, COUNT(*) AS n FROM mobile_actions WHERE status = 'done' AND ${since('completed_at')} GROUP BY d`, start),
    rows(db, `SELECT ${day('created_at')} AS d, COUNT(*) AS n FROM audit_log WHERE ${since('created_at')} GROUP BY d`, start),
    rows(db, `SELECT ${day('work_date')} AS d,
        SUM(CASE WHEN check_in IS NOT NULL AND check_in != '' AND COALESCE(status, '') NOT IN ('absent', 'excused') THEN 1 ELSE 0 END) AS present,
        SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) AS absent
      FROM employee_attendance WHERE ${since('work_date')} GROUP BY d`, start),
    rows(db, `SELECT ${day('closed_at')} AS d, SUM(COALESCE(variance, 0)) AS variance FROM cash_shifts
      WHERE status = 'closed' AND ${since('closed_at')} GROUP BY d`, start),
  ]);

  for (const k of Object.keys(METRIC_KINDS)) if (METRIC_KINDS[k] === 'flow') ensure(k);
  for (const r of inv) {
    add('sales_fa', r.d, r.fa_total); add('sales_vr', r.d, r.vr_total);
    add('sales', r.d, num(r.fa_total) + num(r.vr_total));
    add('invoices_count', r.d, r.fa_count); add('tickets_count', r.d, r.vr_count);
    add('quotes_count', r.d, r.q_count); add('quotes_amount', r.d, r.q_total);
  }
  const cashIn = dates.map(() => 0);
  const bankIn = dates.map(() => 0);
  const cashOut = dates.map(() => 0);
  const bankOut = dates.map(() => 0);
  const split = (d: unknown, total: unknown, cash: unknown, into: [number[], number[]]) => {
    const i = index.get(String(d || ''));
    if (i === undefined) return;
    into[0][i] += num(cash);
    into[1][i] += num(total) - num(cash);
  };
  for (const r of pay) { add('receipts', r.d, r.total); split(r.d, r.total, r.cash, [cashIn, bankIn]); }
  for (const r of exp) {
    add('expenses', r.d, r.exp); add('income', r.d, r.inc);
    add('owner_contrib', r.d, r.contrib); add('owner_draw', r.d, r.draw);
    split(r.d, r.inc, r.inc_cash, [cashIn, bankIn]);
    split(r.d, r.contrib, r.contrib_cash, [cashIn, bankIn]);
    split(r.d, r.exp, r.exp_cash, [cashOut, bankOut]);
    split(r.d, r.draw, r.draw_cash, [cashOut, bankOut]);
  }
  for (const r of billPay) { add('bills_paid', r.d, r.total); split(r.d, r.total, r.cash, [cashOut, bankOut]); }
  for (const r of bills) add('purchases', r.d, r.total);
  for (const r of cli) add('clients_new', r.d, r.n);
  for (const r of ven) add('vendors_new', r.d, r.n);
  for (const r of prod) add('products_new', r.d, r.n);
  for (const r of moves) add('stock_moves', r.d, r.n);
  for (const r of actNew) add('actions_new', r.d, r.n);
  for (const r of actDone) add('actions_done', r.d, r.n);
  for (const r of audit) add('audit_events', r.d, r.n);
  for (const r of att) { add('att_present', r.d, r.present); add('att_absent', r.d, r.absent); }
  for (const r of shifts) add('cash_variance', r.d, r.variance);

  dates.forEach((_, i) => {
    series.money_in[i] = cashIn[i] + bankIn[i];
    series.money_out[i] = cashOut[i] + bankOut[i];
    series.net_flow[i] = series.money_in[i] - series.money_out[i];
    series.cash_net[i] = cashIn[i] - cashOut[i];
    series.bank_net[i] = bankIn[i] - bankOut[i];
  });
  for (const k of Object.keys(series)) series[k] = series[k].map((v) => Math.round(v * 100) / 100);
  return series;
}

/** Level series: stored snapshots, today's live value, creation-date rebuilds. */
export async function levelSeries(
  db: D1Database,
  dates: string[],
  today: Record<string, number>,
  flows: Record<string, number[]>,
): Promise<Record<string, (number | null)[]>> {
  const index = new Map(dates.map((d, i) => [d, i]));
  const out: Record<string, (number | null)[]> = {};
  for (const k of Object.keys(METRIC_KINDS)) if (METRIC_KINDS[k] === 'level') out[k] = dates.map(() => null);
  for (const r of await rows(db, `SELECT day, key, value FROM metric_snapshots WHERE day >= ?`, dates[0])) {
    const i = index.get(String(r.day));
    if (i !== undefined && out[r.key]) out[r.key][i] = num(r.value);
  }
  const last = dates.length - 1;
  for (const [k, v] of Object.entries(today)) if (out[k]) out[k][last] = v;
  // Totals that only grow by creation: rebuild missing past days backwards from today.
  const rebuild: Array<[string, string]> = [['clients_total', 'clients_new'], ['vendors_total', 'vendors_new']];
  for (const [level, flow] of rebuild) {
    const s = out[level];
    if (s[last] === null || !flows[flow]) continue;
    for (let i = last - 1; i >= 0; i--) {
      if (s[i] === null) s[i] = Math.max(0, (s[i + 1] ?? 0) - flows[flow][i + 1]);
    }
  }
  return out;
}

/** Minimum gap between two full recomputes of the same window in one isolate. */
export const METRICS_RECOMPUTE_FLOOR_MS = 60_000;
type MetricsPayload = { dates: string[]; series: Record<string, (number | null)[]> };
const recentMetrics = new Map<string, { at: number; full: MetricsPayload }>();
function rememberMetrics(key: string, full: MetricsPayload): void {
  recentMetrics.set(key, { at: Date.now(), full });
  // Keys embed the day: keep only the handful of current windows.
  if (recentMetrics.size > 8) recentMetrics.delete(recentMetrics.keys().next().value as string);
}
/** Test hook. */
export function __resetRecentMetrics(): void {
  recentMetrics.clear();
}

export function registerMetricsRoutes(app: Hono<any>, deps: MetricsRouteDeps): void {
  const { sessionUserFromHeader, refreshLimitGate } = deps;

  app.get('/api/metrics/daily', async (c) => {
    const limited = refreshLimitGate(c, 'metrics-daily', 60);
    if (limited) return limited;
    const role = normalizeInventoryRole(sessionUserFromHeader(c.req.header('Authorization')).role);
    const financial = roleCanSeeFinancial(role);
    const days = Math.max(7, Math.min(30, Math.floor(Number(c.req.query('days')) || 7)));
    const dates = dayKeys(days);
    // Key contains « dash » so business writes (bumpCacheGen) invalidate it.
    const cacheKey = `dash-metrics:${days}:${dates[dates.length - 1]}`;
    let full = await doCacheGet<{ dates: string[]; series: Record<string, (number | null)[]> }>(c.env.MOBILE_HUB, c.env.CACHE, cacheKey, 300);
    let cache = 'hit';
    if (!full) {
      // Every business write drops the shared cache; a burst of writes (a
      // scanning session, a batch import) must not recompute ~20 aggregates
      // each time. Serve this isolate's copy while it is under a minute old.
      const recent = recentMetrics.get(cacheKey);
      if (recent && Date.now() - recent.at < METRICS_RECOMPUTE_FLOOR_MS) {
        full = recent.full;
        cache = 'recent';
      }
    }
    if (!full) {
      cache = 'miss';
      const db = c.env.DB as D1Database;
      try { await ensureMetricSnapshots(db); } catch { /* read-only tenant: snapshots skipped */ }
      const [levelsNow, flows] = await Promise.all([currentLevels(db), dailyFlows(db, dates)]);
      try { await recordMetricSnapshots(db, dates[dates.length - 1], levelsNow); } catch { /* best effort */ }
      const levels = await levelSeries(db, dates, levelsNow, flows);
      full = { dates, series: { ...flows, ...levels } };
      rememberMetrics(cacheKey, full);
      await doCachePut(c.env.MOBILE_HUB, c.env.CACHE, cacheKey, full, 300);
    }
    const series: Record<string, (number | null)[]> = {};
    const kinds: Record<string, MetricKind> = {};
    for (const [k, v] of Object.entries(full.series)) {
      if (!financial && !OPERATIONAL_METRICS.has(k)) continue;
      series[k] = v;
      kinds[k] = METRIC_KINDS[k] || 'flow';
    }
    return c.json({ success: true, data: { days, dates: full.dates, series, kinds }, meta: { cache, scope: financial ? 'full' : 'operational' } });
  });
}
