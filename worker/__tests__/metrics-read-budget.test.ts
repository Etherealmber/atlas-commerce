/**
 * D1 read budget for the KPI charts (GET /api/metrics/daily).
 * - Date filters must range-scan an index instead of reading whole tables.
 * - The sargable prefilter must not change which rows count (mixed date formats).
 * - A burst of business writes must not trigger a full recompute each time.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };
import app from '../index';
import { bumpCacheGen } from '../lib/cache';
import { dayKeys, dailyFlows, ensureMetricSnapshots, METRIC_INDEXES, __resetRecentMetrics } from '../routes/metrics';

function dbFor(database: any, counter?: { n: number }) {
  return {
    prepare(sql: string) {
      let args: any[] = [];
      const stmt: any = {
        bind(...a: any[]) { args = a; return stmt; },
        async first() { if (counter) counter.n++; return database.prepare(sql).get(...args) || null; },
        async all() { if (counter) counter.n++; return { results: database.prepare(sql).all(...args).map((r: any) => ({ ...r })) }; },
        async run() {
          if (counter) counter.n++;
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
const day = (col: string) => `substr(replace(COALESCE(${col}, ''), 'T', ' '), 1, 10)`;

describe('metrics date filters use indexes', () => {
  let sqlite: any;
  let db: any;
  beforeAll(async () => {
    sqlite = new DatabaseSync(':memory:');
    const dir = new URL('../../migrations/', import.meta.url);
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(f, dir), 'utf8'));
    db = dbFor(sqlite);
    await ensureMetricSnapshots(db);
  });
  afterAll(() => sqlite.close());

  const plan = (sql: string) => sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('2026-01-01').map((r: any) => String(r.detail)).join(' | ');

  it('creates the date indexes', () => {
    const names = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all().map((r: any) => r.name);
    for (const sql of METRIC_INDEXES) {
      const name = /EXISTS (\w+)/.exec(sql)![1];
      const table = /ON (\w+)\(/.exec(sql)![1];
      const hasTable = sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table);
      if (hasTable) expect(names, name).toContain(name);
    }
  });

  it.each([
    ['stock_movements', 'created_at'],
    ['audit_log', 'created_at'],
    ['mobile_actions', 'created_at'],
    ['invoices', 'issue_date'],
  ])('%s.%s is range-scanned, not fully read', (table, col) => {
    const p = plan(`SELECT ${day(col)} AS d, COUNT(*) FROM ${table} WHERE ${col} >= ?1 AND ${day(col)} >= ?1 GROUP BY d`);
    expect(p).toMatch(/USING (COVERING )?INDEX/);
    expect(p).not.toMatch(new RegExp(`SCAN ${table}(?! USING)`));
  });

  it('expression index serves the COALESCE date of expenses', () => {
    const e = 'COALESCE(expense_date, created_at)';
    const p = plan(`SELECT ${day(e)} AS d, SUM(amount) FROM expenses WHERE ${e} >= ?1 AND ${day(e)} >= ?1 GROUP BY d`);
    expect(p).toMatch(/USING (COVERING )?INDEX idx_metrics_expenses_day/);
  });

  it('counts the same rows whatever the stored date format', async () => {
    const t = iso(0);
    sqlite.exec(`INSERT INTO products (id, sku, name, price) VALUES (1, 'M1', 'Marbre', 10)`);
    sqlite.exec(`INSERT INTO stock_movements (product_id, type, quantity, created_at) VALUES
      (1, 'in', 1, '${t}T08:00:00Z'), (1, 'in', 1, '${t} 09:00:00'), (1, 'in', 1, '${t}'),
      (1, 'in', 1, '${iso(-40)} 09:00:00'), (1, 'in', 1, NULL)`);
    const dates = dayKeys(7);
    const s = await dailyFlows(db, dates);
    expect(s.stock_moves[dates.length - 1]).toBe(3);
    expect(s.stock_moves.reduce((a, b) => a + b, 0)).toBe(3);
  });
});

describe('GET /api/metrics/daily recompute floor', () => {
  let sqlite: any;
  const counter = { n: 0 };
  let env: any;
  const ip = '203.0.113.233';
  async function sha256(text: string) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
      .map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  async function ownerToken() {
    const material = await sha256('owner-key|admin|OwnerPass123!');
    const proof = await sha256(`proof|admin|owner|${material}|${ip}|none`);
    return btoa(`stock-auth-v2|admin|owner|${ip}|none|${proof}`);
  }
  async function call(path: string, tok: string) {
    const res = await app.fetch(
      new Request(`http://test.local${path}`, { headers: { 'CF-Connecting-IP': ip, Authorization: `Bearer ${tok}` } }),
      env,
      { waitUntil() {}, passThroughOnException() {} } as any,
    );
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  }
  beforeAll(() => {
    __resetRecentMetrics();
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'));
    sqlite.exec(`ALTER TABLE invoices ADD COLUMN doc_kind TEXT DEFAULT '';`);
    sqlite.exec(readFileSync(new URL('../../migrations/0022_metric_snapshots.sql', import.meta.url), 'utf8'));
    env = { DB: dbFor(sqlite, counter), ADMIN_PASSWORD: 'OwnerPass123!', EMAIL: { send: async () => ({}) } };
  });
  afterAll(() => sqlite.close());

  it('serves the recent copy after a business write instead of re-reading every table', async () => {
    const tok = await ownerToken();
    const first = await call('/api/metrics/daily?days=14', tok);
    expect(first.status).toBe(200);
    expect(first.body.meta.cache).toBe('miss');
    await bumpCacheGen(undefined); // what every invoice / scan / stock write does
    const before = counter.n;
    const second = await call('/api/metrics/daily?days=14', tok);
    expect(second.status).toBe(200);
    expect(second.body.meta.cache).toBe('recent');
    expect(second.body.data.dates).toEqual(first.body.data.dates);
    // Only auth / middleware lookups — none of the ~20 aggregate queries.
    expect(counter.n - before).toBeLessThan(8);
  });
});
