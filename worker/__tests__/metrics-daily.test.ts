/**
 * KPI sparklines — GET /api/metrics/daily (worker/routes/metrics.ts).
 * Flow series come from the transaction tables, level series from
 * metric_snapshots (migration 0022) + today's live value; a day without data
 * is null, never an invented value. Non-financial roles get counts only.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };
import app from '../index';
import { dayKeys, dailyFlows, currentLevels, levelSeries, recordMetricSnapshots, METRIC_KINDS, OPERATIONAL_METRICS } from '../routes/metrics';

function dbFor(database: any) {
  return {
    prepare(sql: string) {
      let args: any[] = [];
      const stmt: any = {
        bind(...a: any[]) { args = a; return stmt; },
        async first() { return database.prepare(sql).get(...args) || null; },
        async all() { return { results: database.prepare(sql).all(...args).map((r: any) => ({ ...r })) }; },
        async run() {
          const r = database.prepare(sql).run(...args);
          return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
        },
      };
      return stmt;
    },
    async batch(stmts: any[]) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
  };
}

const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

describe('metric series from a migration-built database', () => {
  let sqlite: any;
  let db: any;
  beforeAll(() => {
    sqlite = new DatabaseSync(':memory:');
    const dir = new URL('../../migrations/', import.meta.url);
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(f, dir), 'utf8'));
    db = dbFor(sqlite);
    sqlite.exec(`INSERT INTO invoices (number, client_name, issue_date, status, total, amount_paid, doc_kind) VALUES
      ('FA-1', 'A', '${iso(0)}', 'sent', 1200, 0, ''),
      ('FA-2', 'B', '${iso(-1)}', 'paid', 300, 300, ''),
      ('VR-1', 'C', '${iso(0)}', 'paid', 50, 50, 'quick_sale'),
      ('DV-1', 'D', '${iso(0)}', 'quote', 999, 0, ''),
      ('FA-3', 'E', '${iso(-30)}', 'paid', 7777, 7777, '')`);
    sqlite.exec(`INSERT INTO expenses (category, description, amount, payment_method, expense_date, entry_type) VALUES
      ('Loyer', 'Loyer', 400, 'bank', '${iso(-2)}', 'expense'),
      ('Divers', 'Caisse', 80, 'cash', '${iso(0)}', 'expense')`);
    sqlite.exec(`INSERT INTO products (sku, name, price, stock_quantity, low_stock_threshold, track_inventory, is_active) VALUES
      ('A', 'Marbre', 10, 2, 5, 1, 1), ('B', 'Granit', 10, 0, 5, 1, 1), ('C', 'Onyx', 10, 50, 5, 1, 1), ('D', 'Service', 10, 0, 5, 0, 1)`);
  });
  afterAll(() => sqlite.close());

  it('builds 2 × days dates ending today, oldest first', () => {
    const dates = dayKeys(7, new Date('2026-11-25T23:30:00Z'));
    expect(dates).toHaveLength(14);
    expect(dates[0]).toBe('2026-11-12');
    expect(dates[13]).toBe('2026-11-25');
  });

  it('sums flows per day and keeps quotes / tickets / old rows apart', async () => {
    const dates = dayKeys(7);
    const s = await dailyFlows(db, dates);
    const last = dates.length - 1;
    expect(s.sales_fa[last]).toBe(1200);
    expect(s.sales_vr[last]).toBe(50);
    expect(s.sales[last]).toBe(1250);
    expect(s.sales_fa[last - 1]).toBe(300);
    expect(s.quotes_amount[last]).toBe(999);
    expect(s.sales.reduce((a, b) => a + b, 0)).toBe(1550); // FA-3 is outside the window
    expect(s.expenses[last - 2]).toBe(400);
    expect(s.money_out[last]).toBe(80);
    expect(s.cash_net[last]).toBe(-80);
    expect(s.bank_net[last - 2]).toBe(-400);
    // every flow key is present with one value per day
    for (const [k, kind] of Object.entries(METRIC_KINDS)) if (kind === 'flow') expect(s[k], k).toHaveLength(14);
  });

  it('level metrics: live value today, stored snapshots before, null when unknown', async () => {
    const dates = dayKeys(7);
    const now = await currentLevels(db);
    expect(now.products).toBe(4);
    expect(now.low_stock).toBe(2); // stock ≤ seuil, rupture comprise, produits non suivis exclus
    expect(now.out_of_stock).toBe(1);
    expect(now.in_stock).toBe(1);
    expect(now.receivables).toBe(1200);
    expect(now.open_quotes).toBe(1);
    await recordMetricSnapshots(db, dates[10], { low_stock: 5, sales: 123 } as any);
    const lv = await levelSeries(db, dates, now, await dailyFlows(db, dates));
    expect(lv.low_stock[13]).toBe(2);
    expect(lv.low_stock[10]).toBe(5);
    expect(lv.low_stock[9]).toBeNull();
    expect(lv.receivables[0]).toBeNull();
    // flow keys are never written as snapshots
    const stored = sqlite.prepare(`SELECT key FROM metric_snapshots`).all().map((r: any) => r.key);
    expect(stored).not.toContain('sales');
  });
});

describe('GET /api/metrics/daily', () => {
  let sqlite: any;
  let env: any;
  const ip = '203.0.113.232';
  async function sha256(text: string) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  async function ownerToken() {
    const material = await sha256('owner-key|admin|OwnerPass123!');
    const proof = await sha256(`proof|admin|owner|${material}|${ip}|none`);
    return btoa(`stock-auth-v2|admin|owner|${ip}|none|${proof}`);
  }
  async function call(path: string, tok?: string) {
    const res = await app.fetch(
      new Request(`http://test.local${path}`, { headers: { 'CF-Connecting-IP': ip, ...(tok ? { Authorization: `Bearer ${tok}` } : {}) } }),
      env,
      { waitUntil() {}, passThroughOnException() {} } as any,
    );
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  }
  beforeAll(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'));
    sqlite.exec(`ALTER TABLE invoices ADD COLUMN doc_kind TEXT DEFAULT '';`);
    sqlite.exec(readFileSync(new URL('../../migrations/0022_metric_snapshots.sql', import.meta.url), 'utf8'));
    sqlite.exec(`INSERT INTO products (sku, name, price, stock_quantity, low_stock_threshold) VALUES ('X', 'Dalle', 5, 1, 5)`);
    env = { DB: dbFor(sqlite), ADMIN_PASSWORD: 'OwnerPass123!', EMAIL: { send: async () => ({}) } };
  });
  afterAll(() => sqlite.close());

  it('requires a session', async () => {
    expect((await call('/api/metrics/daily')).status).toBe(401);
  });

  it('returns aligned dates and series for the owner and stores today’s snapshot', async () => {
    const r = await call('/api/metrics/daily?days=7', await ownerToken());
    expect(r.status).toBe(200);
    expect(r.body.data.days).toBe(7);
    expect(r.body.data.dates).toHaveLength(14);
    expect(r.body.meta.scope).toBe('full');
    expect(r.body.data.series.low_stock[13]).toBe(1);
    expect(r.body.data.kinds.low_stock).toBe('level');
    expect(r.body.data.kinds.sales).toBe('flow');
    for (const v of Object.values(r.body.data.series) as any[]) expect(v).toHaveLength(14);
    const snap = sqlite.prepare(`SELECT value FROM metric_snapshots WHERE key = 'low_stock'`).get();
    expect(snap.value).toBe(1);
  });

  it('clamps the window to 7–30 days', async () => {
    const tok = await ownerToken();
    expect((await call('/api/metrics/daily?days=999', tok)).body.data.days).toBe(30);
    expect((await call('/api/metrics/daily?days=1', tok)).body.data.days).toBe(7);
  });

  it('operational keys never include money', () => {
    for (const k of OPERATIONAL_METRICS) expect(['sales', 'receivables', 'payables', 'balance', 'money_in', 'net_flow']).not.toContain(k);
  });
});
