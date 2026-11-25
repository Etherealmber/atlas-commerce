/// <reference types="node" />
/**
 * Demo sandbox (« test / test ») — the Durable Object, its SQL engine, the D1
 * proxy, the 1 h / 24 h policy, token wrapping and cache isolation.
 *
 * DemoHub runs here on top of `node:sqlite` through a tiny fake of the
 * Durable Object storage API, so the very same code path as production
 * (migrations → seed → queries → alarm wipe) is exercised.
 */
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyDemoMigrations, DemoHub, durableSqlBackend } from '../durable/DemoHub';
import { DemoD1, DemoExpiredError, type DemoTransport } from '../lib/demo/demoD1';
import { DEMO_MIGRATIONS } from '../lib/demo/migrations';
import {
  decideDemoSession,
  DEMO_SESSION_MS,
  DEMO_WINDOW_MS,
  formatWait,
  type DemoMeta,
} from '../lib/demo/policy';
import { buildDemoModel, buildDemoSeed, buildEmployeeSeed, buildSnapshotSeed, DEMO_COMPANY, seedDemoData } from '../lib/demo/seed';
import { execScript, runBatch, runStatement, splitSqlStatements, type SqlBackend } from '../lib/demo/sqlEngine';
import { DEMO_TOKEN_PREFIX, demoOffLimitsResponse, isDevMachineHost, relinkTicket, rewrapTokens, unwrapDemoToken, wrapDemoToken } from '../lib/demo/gateway';
import { currentDataScope, inDemoScope, runInDataScope, scopedKey } from '../lib/dataScope';
import { checkRefreshLimit } from '../lib/cache';
import { schemaOnce } from '../lib/schema';

// ── node:sqlite fakes ────────────────────────────────────────────────────────

function toSqlite(v: unknown): unknown {
  return v instanceof ArrayBuffer ? new Uint8Array(v) : v;
}
function fromSqlite(v: unknown): unknown {
  if (v instanceof Uint8Array) return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength);
  if (typeof v === 'bigint') return Number(v);
  return v;
}

function execOn(db: DatabaseSync, sql: string, params: unknown[]) {
  const stmt = db.prepare(sql);
  const columns = (stmt.columns?.() || []).map((c: { name: string }) => c.name);
  (stmt as unknown as { setReturnArrays?: (on: boolean) => void }).setReturnArrays?.(true);
  const rows = (stmt.all(...(params.map(toSqlite) as never[])) as unknown as unknown[][]).map((r) =>
    (Array.isArray(r) ? r : Object.values(r as object)).map(fromSqlite),
  );
  return { columns, rows };
}

function sqliteBackend(db = new DatabaseSync(':memory:')): SqlBackend & { db: DatabaseSync } {
  return {
    db,
    run: (sql, params) => execOn(db, sql, params) as never,
    transaction(fn) {
      db.exec('SAVEPOINT t');
      try {
        const out = fn();
        db.exec('RELEASE t');
        return out;
      } catch (e) {
        db.exec('ROLLBACK TO t');
        db.exec('RELEASE t');
        throw e;
      }
    },
  };
}

/** Just enough of DurableObjectState for DemoHub. */
function fakeState() {
  let db = new DatabaseSync(':memory:');
  const kv = new Map<string, unknown>();
  let alarm: number | null = null;
  const state = {
    storage: {
      sql: {
        exec(sql: string, ...params: unknown[]) {
          const r = execOn(db, sql, params);
          return { columnNames: r.columns, raw: () => r.rows[Symbol.iterator]() };
        },
      },
      transactionSync<T>(fn: () => T): T {
        db.exec('SAVEPOINT tx');
        try {
          const out = fn();
          db.exec('RELEASE tx');
          return out;
        } catch (e) {
          db.exec('ROLLBACK TO tx');
          db.exec('RELEASE tx');
          throw e;
        }
      },
      async get<T>(k: string) { return kv.get(k) as T | undefined; },
      async put(k: string, v: unknown) { kv.set(k, structuredClone(v)); },
      async deleteAll() { kv.clear(); alarm = null; db.close(); db = new DatabaseSync(':memory:'); },
      async setAlarm(t: number) { alarm = t; },
    },
  };
  return {
    state: state as unknown as DurableObjectState,
    tables: () => (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((r) => r.name),
    alarm: () => alarm,
  };
}

function hubTransport(hub: DemoHub): DemoTransport {
  return async (op, payload) => {
    const res = await hub.fetch(new Request(`https://demo/${op}`, { method: 'POST', body: JSON.stringify(payload) }));
    return res.json();
  };
}

async function openSession(hub: DemoHub) {
  const res = await hub.fetch(new Request('https://demo/session', { method: 'POST' }));
  return (await res.json()) as Record<string, any>;
}

afterEach(() => { vi.useRealTimers(); });

// ── SQL engine ───────────────────────────────────────────────────────────────

describe('demo SQL engine', () => {
  it('splits scripts on top-level semicolons only', () => {
    const parts = splitSqlStatements(`
      -- comment; with a semicolon
      CREATE TABLE a (x TEXT DEFAULT 'a;b');
      /* block; comment */
      INSERT INTO a VALUES ("q;q");
      CREATE TRIGGER t AFTER INSERT ON a BEGIN
        UPDATE a SET x = 'y;' WHERE x = 'z';
        DELETE FROM a WHERE x = 'w';
      END;
      SELECT 1
    `);
    expect(parts).toHaveLength(4);
    expect(parts[2]).toMatch(/^CREATE TRIGGER[\s\S]*END$/);
    expect(parts[3]).toBe('SELECT 1');
  });

  it('reports D1-style changes / last_row_id and keeps reads cheap', () => {
    const b = sqliteBackend();
    runStatement(b, 'CREATE TABLE p (id INTEGER PRIMARY KEY, name TEXT, img BLOB)');
    const ins = runStatement(b, 'INSERT INTO p (name, img) VALUES (?, ?)', ['Marbre', new Uint8Array([1, 2, 3])]);
    expect(ins.meta.changes).toBe(1);
    expect(ins.meta.last_row_id).toBe(1);
    const sel = runStatement(b, 'SELECT id, name, img FROM p WHERE name = ?', ['Marbre']);
    expect(sel.columns).toEqual(['id', 'name', 'img']);
    expect(sel.meta.changes).toBe(0);
    expect(new Uint8Array(sel.rows[0][2] as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('runs a batch atomically', () => {
    const b = sqliteBackend();
    runStatement(b, 'CREATE TABLE u (k TEXT PRIMARY KEY)');
    expect(() => runBatch(b, [
      { sql: 'INSERT INTO u VALUES (?)', params: ['a'] },
      { sql: 'INSERT INTO u VALUES (?)', params: ['a'] },
    ])).toThrow();
    expect(runStatement(b, 'SELECT COUNT(*) FROM u').rows[0][0]).toBe(0);
  });

  it('applies every bundled migration on an empty database', () => {
    expect(DEMO_MIGRATIONS.length).toBeGreaterThan(10);
    expect(DEMO_MIGRATIONS[0].name).toMatch(/^0000/);
    const b = sqliteBackend();
    const errors = applyDemoMigrations(b);
    // Tolerant mode: a statement that does not apply (e.g. a column added
    // twice) never stops the rest of the schema.
    expect(errors).toEqual([]);
    const tables = execOn(b.db, "SELECT name FROM sqlite_master WHERE type='table'", []).rows.flat();
    for (const t of ['products', 'invoices', 'invoice_items', 'clients', 'company_settings', 'stock_movements']) {
      expect(tables).toContain(t);
    }
  });

  it('tolerant execScript keeps going after a failing statement', () => {
    const b = sqliteBackend();
    // « already exists » is expected when migrations overlap and is not even reported.
    const r = execScript(b, 'CREATE TABLE a (x); CREATE TABLE a (x); INSERT INTO nope VALUES (1); CREATE TABLE b (y);', { tolerant: true });
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatch(/nope/);
    expect(r.count).toBe(2);
    expect(() => execScript(b, 'INSERT INTO nope VALUES (1)')).toThrow();
    expect(execOn(b.db, "SELECT COUNT(*) FROM sqlite_master WHERE name = 'b'", []).rows[0][0]).toBe(1);
  });
});

// ── Policy ───────────────────────────────────────────────────────────────────

describe('demo policy (1 h per 24 h)', () => {
  const t0 = Date.UTC(2026, 9, 20, 9, 0, 0);
  const meta = (over: Partial<DemoMeta> = {}): DemoMeta => ({
    started_at: t0, expires_at: t0 + DEMO_SESSION_MS, gen: 1, seeded: true, ...over,
  });

  it('starts, resumes, denies, then allows again after 24 h', () => {
    expect(decideDemoSession(null, t0)).toEqual({ action: 'new' });
    expect(decideDemoSession(meta(), t0 + 5 * 60_000)).toEqual({ action: 'active' });
    expect(decideDemoSession(meta(), t0 + DEMO_SESSION_MS + 1)).toEqual({ action: 'denied', retry_at: t0 + DEMO_WINDOW_MS });
    expect(decideDemoSession(meta({ wiped: true }), t0 + 60_000)).toMatchObject({ action: 'denied' });
    expect(decideDemoSession(meta(), t0 + DEMO_WINDOW_MS)).toEqual({ action: 'new' });
  });

  it('formats the waiting time', () => {
    expect(formatWait(30_000)).toBe('1 min');
    expect(formatWait(25 * 60_000)).toBe('25 min');
    expect(formatWait(3 * 3_600_000 + 5 * 60_000)).toBe('3 h 05');
    expect(formatWait(2 * 3_600_000)).toBe('2 h');
  });
});

// ── Seed ─────────────────────────────────────────────────────────────────────

describe('demo seed', () => {
  it('is deterministic for a given clock', () => {
    const now = Date.UTC(2026, 9, 20, 12);
    expect(buildDemoSeed(now)).toEqual(buildDemoSeed(now));
    expect(buildEmployeeSeed(now).length).toBeGreaterThan(8);
    expect(buildSnapshotSeed(now).length).toBeGreaterThan(20);
  });

  it('keeps stock movements chained and never negative, with refunds, bills and expenses', () => {
    const m = buildDemoModel(Date.UTC(2026, 10, 25, 12));
    const moves = m.stmts.filter((st) => st.sql.includes('INSERT INTO stock_movements'));
    const last: Record<number, number> = {};
    let negative = 0;
    let broken = 0;
    for (const st of moves) {
      const [pid, , , prev, next] = st.params as number[];
      if (prev < 0 || next < 0) negative++;
      if (last[pid] !== undefined && Math.abs(last[pid] - prev) > 1e-6) broken++;
      last[pid] = next;
    }
    expect(moves.length).toBeGreaterThan(100);
    expect(negative).toBe(0);
    expect(broken).toBe(0);
    const invoices = m.stmts.filter((st) => st.sql.includes('INSERT INTO invoices'));
    expect(invoices.filter((st) => st.sql.includes('remboursement')).length).toBeGreaterThanOrEqual(3);
    expect(m.stmts.filter((st) => st.sql.includes('INSERT INTO bills')).length).toBeGreaterThanOrEqual(10);
    expect(m.stmts.filter((st) => st.sql.includes('INSERT INTO expenses')).length).toBeGreaterThan(30);
    const kpi = m.daily.at(-1)!.values;
    expect(kpi.low_stock).toBeGreaterThan(0);
    expect(kpi.payables).toBeGreaterThan(0);
  });
});

// ── Durable Object + D1 proxy, end to end ────────────────────────────────────

describe('DemoHub sandbox', () => {
  it('migrates, seeds and serves D1-shaped queries', async () => {
    const fake = fakeState();
    const hub = new DemoHub(fake.state, {});
    const s = await openSession(hub);
    expect(s).toMatchObject({ ok: true, state: 'new', gen: 1 });
    expect(fake.alarm()).toBe(s.expires_at);

    const db = new DemoD1(hubTransport(hub), 'demo:test:1') as unknown as D1Database;
    await seedDemoData(db, Date.now());

    const company = await db.prepare('SELECT company_name FROM company_settings WHERE id = 1').first<string>('company_name');
    expect(company).toBe(DEMO_COMPANY.company_name);
    const count = await db.prepare('SELECT COUNT(*) AS n FROM products').first<number>('n');
    expect(count).toBe(24);

    const ins = await db.prepare('INSERT INTO products (name, sku, stock_quantity, price) VALUES (?, ?, ?, ?)')
      .bind('Produit test démo', 'TST-900', 3, 99.5).run();
    expect(ins.meta.changes).toBe(1);
    expect(ins.meta.last_row_id).toBe(25);

    const [a, b] = await db.batch([
      db.prepare('SELECT name FROM products WHERE sku = ?').bind('TST-900'),
      db.prepare('UPDATE products SET stock_quantity = stock_quantity + 1 WHERE sku = ?').bind('TST-900'),
    ]);
    expect(a.results[0]).toEqual({ name: 'Produit test démo' });
    expect(b.meta.changes).toBe(1);

    const raw = await db.prepare('SELECT sku, stock_quantity FROM products WHERE sku = ?').bind('TST-900').raw({ columnNames: true });
    expect(raw).toEqual([['sku', 'stock_quantity'], ['TST-900', 4]]);

    await expect(db.prepare('SELECT * FROM no_such_table').all()).rejects.toThrow(/no_such_table/);
  });

  it('resumes the same data within the hour, then wipes and denies until 24 h', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = Date.UTC(2026, 9, 20, 9, 0, 0);
    vi.setSystemTime(t0);
    const fake = fakeState();
    const hub = new DemoHub(fake.state, {});
    await openSession(hub);
    const db = new DemoD1(hubTransport(hub), 'k') as unknown as D1Database;
    await db.exec('CREATE TABLE notes (t TEXT); INSERT INTO notes VALUES (\'hello\');');

    vi.setSystemTime(t0 + 10 * 60_000);
    expect(await openSession(hub)).toMatchObject({ state: 'active', gen: 1 });
    expect(await db.prepare('SELECT t FROM notes').first('t')).toBe('hello');

    vi.setSystemTime(t0 + DEMO_SESSION_MS + 1);
    await expect(db.prepare('SELECT t FROM notes').first()).rejects.toBeInstanceOf(DemoExpiredError);
    await hub.alarm();
    expect(fake.tables()).not.toContain('notes');
    expect(await openSession(hub)).toMatchObject({ ok: false, state: 'denied', retry_at: t0 + DEMO_WINDOW_MS });

    vi.setSystemTime(t0 + DEMO_WINDOW_MS + 1);
    const again = await openSession(hub);
    expect(again).toMatchObject({ ok: true, state: 'new', gen: 2 });
    expect(fake.tables()).toContain('products');
    expect(fake.tables()).not.toContain('notes');
  });

  it('caps new sandboxes per network per day', async () => {
    const hub = new DemoHub(fakeState().state, {});
    const hit = async () => (await (await hub.fetch(new Request('https://demo/ip-quota', { method: 'POST', body: JSON.stringify({ max: 2 }) }))).json()) as { ok: boolean };
    expect((await hit()).ok).toBe(true);
    expect((await hit()).ok).toBe(true);
    expect((await hit()).ok).toBe(false);
  });

  it('works through the plain durable backend helper too', () => {
    const fake = fakeState();
    const b = durableSqlBackend(fake.state);
    runStatement(b, 'CREATE TABLE z (v INTEGER)');
    runBatch(b, [{ sql: 'INSERT INTO z VALUES (?)', params: [true] }]);
    expect(runStatement(b, 'SELECT v FROM z').rows).toEqual([[1]]);
  });
});

// ── Gateway tokens ───────────────────────────────────────────────────────────

describe('demo tokens', () => {
  const env = { JWT_SECRET: 'unit-secret' } as never;
  const claims = { fp: 'a'.repeat(32), gen: 3, exp: 1_795_000_000_000 };

  it('round-trips and rejects tampering', async () => {
    const tok = await wrapDemoToken(env, claims, 'c3RvY2stYXV0aC12Mnx0ZXN0');
    expect(tok.startsWith(DEMO_TOKEN_PREFIX)).toBe(true);
    expect(await unwrapDemoToken(env, tok)).toEqual({ claims, inner: 'c3RvY2stYXV0aC12Mnx0ZXN0' });
    expect(await unwrapDemoToken(env, tok.replace('.3.', '.4.'))).toBeNull();
    expect(await unwrapDemoToken({ JWT_SECRET: 'other' } as never, tok)).toBeNull();
    expect(await unwrapDemoToken(env, 'c3RvY2stYXV0aC12Mnx0ZXN0')).toBeNull();
  });

  it('re-wraps refreshed session tokens returned by the app', async () => {
    const res = new Response(JSON.stringify({ success: true, data: { token: 'c3RvY2stYXV0aC12Mnxu', username: 'test' } }), {
      headers: { 'Content-Type': 'application/json' },
    });
    const out = (await (await rewrapTokens(env, claims, res)).json()) as { data: { token: string } };
    expect(out.data.token.startsWith(DEMO_TOKEN_PREFIX)).toBe(true);
    expect((await unwrapDemoToken(env, out.data.token))?.inner).toBe('c3RvY2stYXV0aC12Mnxu');
  });

  it('wraps report tickets (rt) so a new tab reaches the sandbox, and relinks them in HTML', async () => {
    const res = new Response(JSON.stringify({ success: true, data: { rt: 'inner-ticket-123' } }), {
      headers: { 'Content-Type': 'application/json' },
    });
    const out = (await (await rewrapTokens(env, claims, res)).json()) as { data: { rt: string } };
    expect(out.data.rt.startsWith(DEMO_TOKEN_PREFIX)).toBe(true);
    expect((await unwrapDemoToken(env, out.data.rt))?.inner).toBe('inner-ticket-123');

    const html = new Response('<a href="/api/reports/x?rt=inner-ticket-123">PDF</a>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    const relinked = await (await relinkTicket(html, 'inner-ticket-123', out.data.rt)).text();
    expect(relinked).toBe(`<a href="/api/reports/x?rt=${encodeURIComponent(out.data.rt)}">PDF</a>`);
    const json = new Response('{"rt":"inner-ticket-123"}', { headers: { 'Content-Type': 'application/json' } });
    expect(await (await relinkTicket(json, 'inner-ticket-123', out.data.rt)).text()).toContain('inner-ticket-123');
  });
});

// ── Cache isolation ──────────────────────────────────────────────────────────

describe('data scope isolation', () => {
  it('prefixes keys only inside a demo scope', () => {
    expect(currentDataScope()).toBe('');
    expect(scopedKey('dash')).toBe('dash');
    expect(inDemoScope()).toBe(false);
    runInDataScope('demo:fp:1', () => {
      expect(scopedKey('dash')).toBe('demo:fp:1|dash');
      expect(inDemoScope()).toBe(true);
    });
  });

  it('keeps schema memos and refresh limits apart per scope', async () => {
    const calls: string[] = [];
    const key = `demo-test-${Math.random()}`;
    await schemaOnce(key, async () => { calls.push('prod'); });
    await schemaOnce(key, async () => { calls.push('prod-again'); });
    await runInDataScope('demo:x:1', () => schemaOnce(key, async () => { calls.push('demo'); }));
    expect(calls).toEqual(['prod', 'demo']);

    const bucket = `refresh-${Math.random()}`;
    expect(checkRefreshLimit(bucket, 1).ok).toBe(true);
    expect(checkRefreshLimit(bucket, 1).ok).toBe(false);
    expect(runInDataScope('demo:x:1', () => checkRefreshLimit(bucket, 1)).ok).toBe(true);
  });
});

describe('per-network demo cap', () => {
  it('is skipped only on a developer machine (every device shares its IP there)', () => {
    for (const h of ['http://localhost:5173', 'http://127.0.0.1:8787', 'http://192.168.1.20:5173', 'http://10.0.2.2:8787', 'http://172.20.0.5', 'http://app.localhost']) {
      expect(isDevMachineHost(new URL(h))).toBe(true);
    }
    for (const h of ['https://atlas.example.com', 'https://5173-abc.e2b.app', 'https://172.32.0.1', 'https://my-app.workers.dev']) {
      expect(isDevMachineHost(new URL(h))).toBe(false);
    }
  });
});

describe('demo off-limits actions', () => {
  it('answers backup / restore with a clear demo message, lets everything else through', async () => {
    const r = demoOffLimitsResponse('/api/admin/backup-now', 'POST');
    expect(r?.status).toBe(403);
    expect(await r!.json()).toMatchObject({ code: 'DEMO_DISABLED' });
    expect(demoOffLimitsResponse('/api/admin/backups/restore', 'post')?.status).toBe(403);
    expect(demoOffLimitsResponse('/api/admin/backups', 'GET')).toBeNull();
    expect(demoOffLimitsResponse('/api/products', 'POST')).toBeNull();
  });
});
