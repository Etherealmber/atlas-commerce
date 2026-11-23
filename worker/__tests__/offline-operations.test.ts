/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { registerStockReadRoutes } from '../routes/stock';
import { registerInventoryOpsRoutes } from '../routes/inventoryOps';
import { canonicalJson, purgeExpiredOfflineIdempotency, withIdempotency } from '../lib/idempotency';

function makeSqliteD1(sqlite: DatabaseSync) {
  function prepare(sql: string) {
    return {
      _params: [] as any[],
      bind(...params: any[]) {
        this._params = params;
        return this;
      },
      async first() {
        const row = sqlite.prepare(sql).get(...this._params);
        return row === undefined ? null : { ...(row as any) };
      },
      async all() {
        const rows = sqlite.prepare(sql).all(...this._params).map((r: any) => ({ ...r }));
        return { success: true, results: rows, meta: {} };
      },
      async run() {
        const info = sqlite.prepare(sql).run(...this._params);
        return {
          success: true,
          meta: {
            changes: Number(info.changes || 0),
            last_row_id: Number(info.lastInsertRowid || 0),
          },
        };
      },
    };
  }
  return {
    prepare,
    async batch(stmts: any[]) {
      sqlite.exec('BEGIN');
      try {
        const out: any[] = [];
        for (const s of stmts) out.push(await s.run());
        sqlite.exec('COMMIT');
        return out;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as D1Database;
}

function setupTestApp(role: 'owner' | 'stock' | 'user' = 'stock') {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT DEFAULT '',
      name TEXT NOT NULL,
      stock_quantity REAL DEFAULT 0,
      low_stock_threshold REAL DEFAULT 0,
      cost REAL DEFAULT 0,
      price REAL DEFAULT 0,
      category TEXT DEFAULT '',
      track_inventory INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      updated_at TEXT
    );
    CREATE TABLE company_settings (id INTEGER PRIMARY KEY, multi_warehouse INTEGER DEFAULT 1, sales_location_id INTEGER, purchase_location_id INTEGER);
    INSERT INTO company_settings (id) VALUES (1);
    CREATE TABLE stock_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE stock_location_qty (
      location_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (location_id, product_id)
    );
    INSERT INTO stock_locations (id, code, name, is_default, is_active) VALUES
      (1, 'MAG', 'Magasin principal', 1, 1),
      (2, 'RES', 'Réserve', 0, 1),
      (3, 'OLD', 'Ancien dépôt', 0, 0);
    INSERT INTO products (id, name, stock_quantity) VALUES (10, 'Marbre Beige', 25);
    INSERT INTO stock_location_qty (location_id, product_id, quantity) VALUES (1, 10, 20), (2, 10, 5);
  `);
  sqlite.exec(readFileSync('migrations/0013_offline_operations.sql', 'utf8'));

  const db = makeSqliteD1(sqlite);
  const app = new Hono<any>();
  const requireFloorStock = (c: any) => {
    if (role === 'user') {
      return { ok: false as const, response: c.json({ success: false, code: 'FORBIDDEN_ROLE' }, 403) };
    }
    return { ok: true as const, username: 'magasinier-test', role };
  };
  registerStockReadRoutes(app as any, {
    requireFloorStock,
    sessionUserFromHeader: () => ({ username: 'magasinier-test', role }),
  });
  registerInventoryOpsRoutes(app as any, {
    requireOwner: (c: any) => ({ ok: true, username: 'owner', role: 'owner' }),
    requireBizMutator: (c: any) => ({ ok: true, username: 'owner', role: 'owner' }),
    requireFloorStock,
    sessionUserFromHeader: () => ({ username: 'magasinier-test', role }),
    applyStockDelta: async () => null,
    ensureValuationTables: async () => {},
    getValuationMethod: async () => 'average',
    runAutoTransfers: async () => null,
    ensureBillPaymentsTable: async () => {},
    ensurePaymentHistoryTable: async () => {},
  });

  // Mount a standalone test route exercising withIdempotency directly
  app.post('/api/test/idem-endpoint', async (c) => {
    return withIdempotency(c, {
      op: 'test-write',
      deviceId: 'dev-1',
      handler: async ({ payload }: any) => ({
        status: 200,
        body: { success: true, echoed: payload.qty },
        statements: [
          c.env.DB.prepare(`UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = 10`).bind(Number(payload.qty)),
        ],
      }),
    });
  });

  const env = { DB: db };
  return { app, env, sqlite, db };
}

describe('Part 1 — offline operations contract + server idempotency', () => {
  it('canonicalizes JSON keys and normalized numbers deterministically', () => {
    expect(canonicalJson({ b: 12.0, a: -0, nested: { z: 1, a: 2 } })).toBe(
      canonicalJson({ nested: { a: 2, z: 1 }, a: 0, b: 12 }),
    );
  });

  it('withIdempotency enforces missing key (400), replay with Idempotent-Replay header, and 409 mismatch', async () => {
    const { app, env, sqlite } = setupTestApp('stock');
    const noKey = await app.fetch(
      new Request('http://test.local/api/test/idem-endpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qty: 5 }),
      }),
      env as any,
    );
    expect(noKey.status).toBe(400);
    expect(((await noKey.json()) as any).code).toBe('MISSING_IDEMPOTENCY_KEY');

    const first = await app.fetch(
      new Request('http://test.local/api/test/idem-endpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'hdr-key-1' },
        body: JSON.stringify({ qty: 5 }),
      }),
      env as any,
    );
    expect(first.status).toBe(200);
    expect(first.headers.get('Idempotent-Replay')).toBeNull();

    const replay = await app.fetch(
      new Request('http://test.local/api/test/idem-endpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'hdr-key-1' },
        body: JSON.stringify({ qty: 5.0 }),
      }),
      env as any,
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get('Idempotent-Replay')).toBe('true');
    expect((sqlite.prepare(`SELECT stock_quantity FROM products WHERE id = 10`).get() as any).stock_quantity).toBe(30);

    const mismatch = await app.fetch(
      new Request('http://test.local/api/test/idem-endpoint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'hdr-key-1' },
        body: JSON.stringify({ qty: 9 }),
      }),
      env as any,
    );
    expect(mismatch.status).toBe(409);
    expect(((await mismatch.json()) as any).code).toBe('IDEMPOTENCY_MISMATCH');
    expect((sqlite.prepare(`SELECT stock_quantity FROM products WHERE id = 10`).get() as any).stock_quantity).toBe(30);
  });

  it('rejects unauthorized roles on POST /api/inventory/offline-operations', async () => {
    const { app, env } = setupTestApp('user');
    const res = await app.fetch(
      new Request('http://test.local/api/inventory/offline-operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: 'd1', operations: [] }),
      }),
      env as any,
    );
    expect(res.status).toBe(403);
  });

  it('handles receive, issue, count conflict/success, replay, 409 mismatch, missing/inactive location, and GET locations', async () => {
    const { app, env, sqlite, db } = setupTestApp('stock');

    // GET /api/inventory/locations?product_id=10
    const locRes1 = await app.fetch(new Request('http://test.local/api/inventory/locations?product_id=10'), env as any);
    expect(locRes1.status).toBe(200);
    const locBody1 = (await locRes1.json()) as any;
    expect(locBody1.data).toHaveLength(2); // inactive location excluded
    expect(locBody1.data[0]).toMatchObject({ location_id: '1', name: 'Magasin principal', quantity: 20, revision: 1 });
    expect(locBody1.data[1]).toMatchObject({ location_id: '2', name: 'Réserve', quantity: 5, revision: 1 });

    // Partial success batch: valid receive + valid issue + missing location + inactive location
    const batch1 = await app.fetch(
      new Request('http://test.local/api/inventory/offline-operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: 'android-01',
          client_ts: '2026-11-24T10:00:00Z',
          operations: [
            { op: 'receive', product_id: '10', location_id: '1', quantity: 12, idempotency_key: 'op-1', client_ts: '2026-11-24T09:58:00Z' },
            { op: 'issue', product_id: '10', location_id: '1', quantity: 3, idempotency_key: 'op-2', client_ts: '2026-11-24T09:59:00Z' },
            { op: 'receive', product_id: '10', quantity: 4, idempotency_key: 'op-no-loc' },
            { op: 'receive', product_id: '10', location_id: '3', quantity: 2, idempotency_key: 'op-inactive' },
          ],
        }),
      }),
      env as any,
    );
    expect(batch1.status).toBe(200);
    const b1 = (await batch1.json()) as any;
    expect(b1.data.map((r: any) => r.status)).toEqual(['applied', 'applied', 'rejected', 'rejected']);
    expect(b1.data[0].revision).toBe(2);
    expect(b1.data[0].quantity).toBe(32);
    expect(b1.data[1].revision).toBe(3);
    expect(b1.data[1].quantity).toBe(29);
    expect(b1.data[2].code).toBe('LOCATION_REQUIRED');
    expect(b1.data[3].code).toBe('INVALID_LOCATION');

    // Audited stock movements contain device_id, client_ts, location_id
    const mv = sqlite.prepare(`SELECT * FROM stock_movements ORDER BY id`).all() as any[];
    expect(mv).toHaveLength(2);
    expect(mv[0].device_id).toBe('android-01');
    expect(mv[0].client_ts).toBe('2026-11-24T09:58:00Z');
    expect(mv[0].location_id).toBe('1');

    // Replay op-1 + mismatch op-1 + stale count + current count (rev 3)
    const batch2 = await app.fetch(
      new Request('http://test.local/api/inventory/offline-operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: 'android-01',
          operations: [
            { op: 'receive', product_id: '10', location_id: '1', quantity: 12.0, idempotency_key: 'op-1' },
            { op: 'receive', product_id: '10', location_id: '1', quantity: 99, idempotency_key: 'op-1' },
            { op: 'count', product_id: '10', location_id: '1', counted_on_hand: 100, expected_revision: 1, idempotency_key: 'op-count-stale' },
            { op: 'count', product_id: '10', location_id: '1', counted_on_hand: 40, expected_revision: 3, idempotency_key: 'op-count-ok' },
          ],
        }),
      }),
      env as any,
    );
    expect(batch2.status).toBe(200);
    const b2 = (await batch2.json()) as any;
    expect(b2.data[0].status).toBe('replayed');
    expect(b2.data[1].http).toBe(409);
    expect(b2.data[1].code).toBe('IDEMPOTENCY_MISMATCH');
    expect(b2.data[2].status).toBe('conflict');
    expect(b2.data[2].revision).toBe(3);
    expect(b2.data[2].quantity).toBe(29);
    expect(b2.data[3].status).toBe('applied');
    expect(b2.data[3].revision).toBe(4);
    expect(b2.data[3].quantity).toBe(40);

    // Purge rows older than 7 days
    sqlite
      .prepare(`INSERT INTO offline_idempotency (key, device_id, op, request_hash, status, response, created_at) VALUES ('old-key', 'd', 'receive', 'h', 200, '{}', datetime('now', '-8 days'))`)
      .run();
    const deleted = await purgeExpiredOfflineIdempotency(db);
    expect(deleted).toBe(1);
    expect(sqlite.prepare(`SELECT key FROM offline_idempotency WHERE key = 'old-key'`).get()).toBeUndefined();
    expect(sqlite.prepare(`SELECT key FROM offline_idempotency WHERE key = 'op-1'`).get()).toBeDefined();
  });
});
