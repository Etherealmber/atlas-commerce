/**
 * v0.7.1 — Stock-adjustment approval workflow tests
 * (worker/routes/stockAdjustments.ts) against an in-process SQLite
 * (node:sqlite) wrapped in a D1-compatible shim — same harness style as
 * expenses-auth.test.ts — through a REAL Hono app.
 *
 * Locks the contract:
 *  - submit (any role) NEVER mutates stock; invalid qty/direction → 422,
 *    unknown product → 404 (== cross-tenant in this single-tenant deploy),
 *    inactive → 422, non-tracked → 409;
 *  - idempotency-key replay returns the same request (200 + replayed);
 *  - approve/reject = owner/admin/secretaire ONLY (fresh users-table role at
 *    decision time wins over the session role);
 *  - approval applies the movement EXACTLY once (duplicate/replay/concurrent
 *    → 409 ALREADY_DECIDED), writes stock_movements + before/after;
 *  - rejection leaves stock unchanged; insufficient stock at approval time
 *    → 409 and the request stays pending with stock untouched;
 *  - listing visibility: approvers see all, stock/user see only their own.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };
type DatabaseSync = any;
import { Hono } from 'hono';
import { registerStockAdjustmentRoutes, ensureStockAdjustmentTables } from '../routes/stockAdjustments';

function makeD1() {
  const sqlite = new DatabaseSync(':memory:');
  const db: any = {
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
    async batch(stmts: any[]) {
      const out: any[] = [];
      for (const st of stmts) out.push(await st.run());
      return out;
    },
  };
  return { db, sqlite };
}

const SESSIONS: Record<string, { username: string; role: string }> = {
  'owner-tok': { username: 'boss', role: 'owner' },
  'sec-tok': { username: 'sec', role: 'secretaire' },
  'stock-tok': { username: 'mag', role: 'stock' },
  'stock2-tok': { username: 'mag2', role: 'stock' },
  'user-tok': { username: 'usr', role: 'user' },
};

let db: any;
let sqlite: DatabaseSync;
let app: Hono<any>;
let auditSpy: any;

beforeEach(async () => {
  const made = makeD1();
  db = made.db;
  sqlite = made.sqlite;
  sqlite.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT DEFAULT '', sku TEXT DEFAULT '', is_active INTEGER DEFAULT 1,
      track_inventory INTEGER DEFAULT 1, stock_quantity REAL DEFAULT 0,
      price REAL DEFAULT 0, cost REAL DEFAULT 0, updated_at TEXT
    );
    CREATE TABLE stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER, type TEXT DEFAULT 'adjustment', quantity REAL DEFAULT 0,
      previous_quantity REAL DEFAULT 0, new_quantity REAL DEFAULT 0,
      reason TEXT DEFAULT '', reference TEXT DEFAULT '', created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE users (username TEXT PRIMARY KEY, role TEXT DEFAULT 'user');
    INSERT INTO users (username, role) VALUES ('boss','owner'), ('sec','secretaire'), ('mag','stock'), ('mag2','stock'), ('usr','user');
    INSERT INTO products (id, name, sku, stock_quantity, price, cost) VALUES (1, 'Carrelage démo', 'CR-1', 10, 89, 61);
    INSERT INTO products (id, name, sku, stock_quantity, is_active) VALUES (2, 'Produit inactif', 'IN-1', 5, 0);
    INSERT INTO products (id, name, sku, stock_quantity, track_inventory) VALUES (3, 'Service non suivi', 'SV-1', 0, 0);
  `);
  await ensureStockAdjustmentTables(db);
  auditSpy = vi.fn(async () => {});
  app = new Hono();
  registerStockAdjustmentRoutes(app as any, {
    session: (c: any) => {
      const tok = String(c.req.header('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
      return SESSIONS[tok] ? { ...SESSIONS[tok] } : null;
    },
    freshRole: async (d: any, username: string) => {
      const row = await d.prepare(`SELECT role FROM users WHERE lower(username) = lower(?)`).bind(username).first();
      return row?.role || null;
    },
    audit: auditSpy,
  });
});

function call(method: string, path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return app.fetch(
    new Request(`http://test.local${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    { DB: db },
  );
}
const submit = (body: any, tok = 'stock-tok') => call('POST', '/api/stock-adjustment-requests', body, tok);
const approve = (id: number, tok = 'owner-tok', body: any = {}) => call('POST', `/api/stock-adjustment-requests/${id}/approve`, body, tok);
const reject = (id: number, tok = 'owner-tok', body: any = {}) => call('POST', `/api/stock-adjustment-requests/${id}/reject`, body, tok);
async function stockOf(id: number): Promise<number> {
  const r = await db.prepare(`SELECT stock_quantity FROM products WHERE id = ?`).bind(id).first();
  return Number(r.stock_quantity);
}
async function movementsOf(id: number): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) c FROM stock_movements WHERE product_id = ?`).bind(id).first();
  return Number(r.c);
}

describe('submission never mutates stock', () => {
  it('stock role submits → 201 pending, stock unchanged', async () => {
    const res = await submit({ product_id: 1, direction: 'out', quantity: 4, reason: 'casse' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe('pending');
    expect(body.data.stock_after).toBeNull();
    expect(await stockOf(1)).toBe(10);
    expect(await movementsOf(1)).toBe(0);
  });

  it('invalid quantities and directions → 422', async () => {
    for (const quantity of [0, -3, NaN, 'x']) {
      const res = await submit({ product_id: 1, direction: 'in', quantity });
      expect(res.status).toBe(422);
    }
    const badDir = await submit({ product_id: 1, direction: 'sideways', quantity: 2 });
    expect(badDir.status).toBe(422);
  });

  it('unknown product → 404 (cross-tenant equivalent), inactive → 422, non-tracked → 409', async () => {
    expect((await submit({ product_id: 999, direction: 'in', quantity: 1 })).status).toBe(404);
    expect((await submit({ product_id: 2, direction: 'in', quantity: 1 })).status).toBe(422);
    expect((await submit({ product_id: 3, direction: 'in', quantity: 1 })).status).toBe(409);
    expect(await stockOf(1)).toBe(10);
  });

  it('no session → 401', async () => {
    expect((await submit({ product_id: 1, direction: 'in', quantity: 1 }, '')).status).toBe(401);
  });

  it('idempotency-key replay returns the same request', async () => {
    const a = await submit({ product_id: 1, direction: 'in', quantity: 2, idempotency_key: 'k-1' });
    const b = await submit({ product_id: 1, direction: 'in', quantity: 2, idempotency_key: 'k-1' });
    const ja = await a.json(); const jb = await b.json();
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(jb.replayed).toBe(true);
    expect(jb.data.id).toBe(ja.data.id);
    const count = await db.prepare(`SELECT COUNT(*) c FROM stock_adjustment_requests`).first();
    expect(Number(count.c)).toBe(1);
  });
});

describe('approval policy', () => {
  it('stock/user cannot approve or reject (403), even their own request', async () => {
    const created = await (await submit({ product_id: 1, direction: 'in', quantity: 1 })).json();
    expect((await approve(created.data.id, 'stock-tok')).status).toBe(403);
    expect((await approve(created.data.id, 'user-tok')).status).toBe(403);
    expect((await reject(created.data.id, 'stock2-tok')).status).toBe(403);
    expect(await stockOf(1)).toBe(10);
  });

  it('decision-time role comes from the users table, not the session token', async () => {
    // Token says owner but the DB row was downgraded to stock → 403.
    sqlite.exec(`UPDATE users SET role='stock' WHERE username='boss'`);
    const created = await (await submit({ product_id: 1, direction: 'in', quantity: 1 })).json();
    expect((await approve(created.data.id, 'owner-tok')).status).toBe(403);
  });

  it('secretaire and owner may approve; owner/admin/secretaire may reject', async () => {
    const a = await (await submit({ product_id: 1, direction: 'in', quantity: 3 }, 'user-tok')).json();
    expect((await approve(a.data.id, 'sec-tok')).status).toBe(200);
    expect(await stockOf(1)).toBe(13);
    const b = await (await submit({ product_id: 1, direction: 'out', quantity: 3 }, 'user-tok')).json();
    expect((await reject(b.data.id, 'sec-tok')).status).toBe(200);
    expect(await stockOf(1)).toBe(13);
  });
});

describe('approval applies the movement exactly once', () => {
  it('approve in → stock +q, movement row, before/after recorded', async () => {
    const created = await (await submit({ product_id: 1, direction: 'in', quantity: 5, reason: 'livraison' })).json();
    const res = await approve(created.data.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe('approved');
    expect(body.data.stock_before).toBe(10);
    expect(body.data.stock_after).toBe(15);
    expect(await stockOf(1)).toBe(15);
    expect(await movementsOf(1)).toBe(1);
    const mv = await db.prepare(`SELECT * FROM stock_movements WHERE product_id = 1`).first();
    expect(mv.previous_quantity).toBe(10);
    expect(mv.new_quantity).toBe(15);
    expect(String(mv.reason)).toContain('mag'); // requester traced in the audit reason
    expect(String(mv.reference)).toBe(`stock-adjustment-request:${created.data.id}`);
    expect(auditSpy).toHaveBeenCalled();
  });

  it('duplicate approval (replay) → 409 and stock moves once', async () => {
    const created = await (await submit({ product_id: 1, direction: 'in', quantity: 5 })).json();
    expect((await approve(created.data.id)).status).toBe(200);
    const dup = await approve(created.data.id);
    expect(dup.status).toBe(409);
    expect((await dup.json()).code).toBe('ALREADY_DECIDED');
    expect(await stockOf(1)).toBe(15);
    expect(await movementsOf(1)).toBe(1);
  });

  it('concurrent approvals → exactly one wins', async () => {
    const created = await (await submit({ product_id: 1, direction: 'out', quantity: 2 })).json();
    const [r1, r2] = await Promise.all([approve(created.data.id), approve(created.data.id, 'sec-tok')]);
    const codes = [r1.status, r2.status].sort();
    expect(codes).toEqual([200, 409]);
    expect(await stockOf(1)).toBe(8);
    expect(await movementsOf(1)).toBe(1);
  });

  it('rejection leaves stock unchanged and blocks later approval', async () => {
    const created = await (await submit({ product_id: 1, direction: 'out', quantity: 4 })).json();
    expect((await reject(created.data.id, 'sec-tok', { note: 'pas justifié' })).status).toBe(200);
    expect(await stockOf(1)).toBe(10);
    expect(await movementsOf(1)).toBe(0);
    expect((await approve(created.data.id)).status).toBe(409);
    expect(await stockOf(1)).toBe(10);
  });

  it('insufficient stock at approval → 409, request stays pending, stock untouched', async () => {
    const created = await (await submit({ product_id: 1, direction: 'out', quantity: 50 })).json();
    const res = await approve(created.data.id);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('INSUFFICIENT_STOCK');
    const row = await db.prepare(`SELECT status FROM stock_adjustment_requests WHERE id = ?`).bind(created.data.id).first();
    expect(row.status).toBe('pending');
    expect(await stockOf(1)).toBe(10);
    expect(await movementsOf(1)).toBe(0);
  });

  it('unknown request → 404; approve after product deactivated → 422', async () => {
    expect((await approve(4242)).status).toBe(404);
    const created = await (await submit({ product_id: 1, direction: 'in', quantity: 1 })).json();
    sqlite.exec(`UPDATE products SET is_active = 0 WHERE id = 1`);
    expect((await approve(created.data.id)).status).toBe(422);
    expect(await stockOf(1)).toBe(10);
  });
});

describe('listing visibility', () => {
  it('approvers see every request; stock/user see only their own', async () => {
    await submit({ product_id: 1, direction: 'in', quantity: 1 }, 'stock-tok');
    await submit({ product_id: 1, direction: 'in', quantity: 1 }, 'user-tok');
    const asOwner = await (await call('GET', '/api/stock-adjustment-requests', undefined, 'owner-tok')).json();
    const asStock = await (await call('GET', '/api/stock-adjustment-requests', undefined, 'stock-tok')).json();
    expect(asOwner.data.length).toBe(2);
    expect(asStock.data.length).toBe(1);
    expect(asStock.data[0].requested_by).toBe('mag');
  });

  it('detail: requester or approver only', async () => {
    const created = await (await submit({ product_id: 1, direction: 'in', quantity: 1 })).json();
    expect((await call('GET', `/api/stock-adjustment-requests/${created.data.id}`, undefined, 'stock-tok')).status).toBe(200);
    expect((await call('GET', `/api/stock-adjustment-requests/${created.data.id}`, undefined, 'stock2-tok')).status).toBe(403);
    expect((await call('GET', `/api/stock-adjustment-requests/${created.data.id}`, undefined, 'sec-tok')).status).toBe(200);
  });
});
