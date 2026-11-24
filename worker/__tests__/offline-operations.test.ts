/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { registerStockReadRoutes } from '../routes/stock';
import { registerInventoryOpsRoutes, adjustLocationStock } from '../routes/inventoryOps';
import { registerAtlasV209Routes } from '../routes/atlas-v209';
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
    CREATE TABLE company_settings (id INTEGER PRIMARY KEY, multi_warehouse INTEGER DEFAULT 1, sales_location_id INTEGER, purchase_location_id INTEGER, allow_negative_stock INTEGER DEFAULT 0);
    INSERT INTO company_settings (id, allow_negative_stock) VALUES (1, 0);
    CREATE TABLE stock_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      account_id TEXT DEFAULT 'default',
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
  sqlite.exec(readFileSync('migrations/0020_offline_inventory_contract.sql', 'utf8'));

  const db = makeSqliteD1(sqlite);
  const app = new Hono<any>();
  const webhooks: Array<{ event: string; payload: any }> = [];

  const sessionUserFromHeader = (authHeader?: string) => {
    const token = String(authHeader || '').replace(/^Bearer\s+/i, '').trim();
    const accountId = token.startsWith('acc:') ? token.slice(4) : 'default';
    return { username: `user-${accountId}`, role, account_id: accountId };
  };

  const requireFloorStock = (c: any) => {
    const s = sessionUserFromHeader(c.req.header('Authorization'));
    if (role === 'user') {
      return { ok: false as const, response: c.json({ success: false, code: 'FORBIDDEN_ROLE' }, 403) };
    }
    return { ok: true as const, username: s.username, role };
  };

  registerStockReadRoutes(app as any, {
    requireFloorStock,
    sessionUserFromHeader,
    dispatchWebhook: async (_env, _ctx, event, payload) => {
      webhooks.push({ event, payload });
    },
  });

  registerInventoryOpsRoutes(app as any, {
    requireOwner: (_c: any) => ({ ok: true, username: 'owner', role: 'owner' }),
    requireBizMutator: (_c: any) => ({ ok: true, username: 'owner', role: 'owner' }),
    requireFloorStock,
    sessionUserFromHeader,
    applyStockDelta: async () => null,
    ensureValuationTables: async () => {},
    getValuationMethod: async () => 'average',
    runAutoTransfers: async () => null,
    ensureBillPaymentsTable: async () => {},
    ensurePaymentHistoryTable: async () => {},
  });

  registerAtlasV209Routes(app as any, {
    sessionUserFromHeader,
  });

  app.post('/api/test/idem-endpoint', async (c) => {
    return withIdempotency(c, {
      kind: 'test-write',
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
  return { app, env, sqlite, db, webhooks };
}

describe('Android & Web offline inventory contract + server idempotency', () => {
  it('canonicalizes JSON keys and normalized numbers deterministically', () => {
    expect(canonicalJson({ b: 12.0, a: -0, nested: { z: 1, a: 2 } })).toBe(
      canonicalJson({ nested: { a: 2, z: 1 }, a: 0, b: 12 }),
    );
  });

  it('same key + same body -> one movement, replay returns replayed:true, identical movement_id, quantity unchanged; same key + diff body -> 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const { app, env, sqlite, webhooks } = setupTestApp('stock');
    const opId = '11111111-1111-4111-8111-111111111111';
    const body = {
      operation_id: opId,
      kind: 'receive',
      product_id: 10,
      location_id: 1,
      quantity_delta: 5,
      note: 'Livraison matin',
      client_occurred_at: '2026-10-21T09:30:00Z',
    };

    const res1 = await app.fetch(
      new Request('http://test.local/api/inventory/offline-operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': opId, 'X-Device-Id': 'pixel-8' },
        body: JSON.stringify(body),
      }),
      env as any,
    );
    expect(res1.status).toBe(200);
    expect(res1.headers.get('Idempotent-Replay')).toBeNull();
    const json1 = (await res1.json()) as any;
    expect(json1.data.replayed).toBe(false);
    expect(json1.data.previous_quantity).toBe(20);
    expect(json1.data.new_quantity).toBe(25);
    expect(json1.data.product_total).toBe(30);
    expect(json1.data.revision).toBe(1);
    expect(webhooks).toHaveLength(1);
    expect(webhooks[0].event).toBe('stock.receive');

    // Replay with identical body (numeric 5.0 canonicalizes equal to 5)
    const res2 = await app.fetch(
      new Request('http://test.local/api/inventory/offline-operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': opId },
        body: JSON.stringify({ ...body, quantity_delta: 5.0 }),
      }),
      env as any,
    );
    expect(res2.status).toBe(200);
    expect(res2.headers.get('Idempotent-Replay')).toBe('true');
    const json2 = (await res2.json()) as any;
    expect(json2.data.replayed).toBe(true);
    expect(json2.data.movement_id).toBe(json1.data.movement_id);
    expect(json2.data.new_quantity).toBe(25);
    expect(webhooks).toHaveLength(1); // webhook not re-fired on replay

    const movements = sqlite.prepare(`SELECT * FROM stock_movements`).all() as any[];
    expect(movements).toHaveLength(1);
    expect(movements[0].device_id).toBe('pixel-8');
    expect(movements[0].client_occurred_at).toBe('2026-10-21T09:30:00Z');

    // Same key + different body -> 409 IDEMPOTENCY_KEY_REUSED, no new movement
    const resMismatch = await app.fetch(
      new Request('http://test.local/api/inventory/offline-operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': opId },
        body: JSON.stringify({ ...body, quantity_delta: 99 }),
      }),
      env as any,
    );
    expect(resMismatch.status).toBe(409);
    expect(((await resMismatch.json()) as any).code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((sqlite.prepare(`SELECT COUNT(*) AS c FROM stock_movements`).get() as any).c).toBe(1);
  });

  it('same key across two different accounts -> both apply (key is account-scoped)', async () => {
    const { app, env, sqlite } = setupTestApp('stock');
    const sharedKey = '22222222-2222-4222-8222-222222222222';
    const body = { operation_id: sharedKey, kind: 'receive', product_id: 10, location_id: 1, quantity_delta: 3 };

    const accA = await app.fetch(
      new Request('http://test.local/api/inventory/offline-operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': sharedKey, Authorization: 'Bearer acc:alpha' },
        body: JSON.stringify(body),
      }),
      env as any,
    );
    expect(accA.status).toBe(200);
    expect(((await accA.json()) as any).data.replayed).toBe(false);

    const accB = await app.fetch(
      new Request('http://test.local/api/inventory/offline-operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': sharedKey, Authorization: 'Bearer acc:beta' },
        body: JSON.stringify(body),
      }),
      env as any,
    );
    expect(accB.status).toBe(200);
    expect(((await accB.json()) as any).data.replayed).toBe(false);
    expect((sqlite.prepare(`SELECT stock_quantity FROM products WHERE id = 10`).get() as any).stock_quantity).toBe(31);
  });

  it('enforces count conflict/success, issue below zero policy, missing/code location rejection, placements revision, and keeps product total == placement sum', async () => {
    const { app, env, sqlite, db } = setupTestApp('stock');

    // Initial placements: revision 0 before any write
    const pl1 = await app.fetch(new Request('http://test.local/api/inventory/products/10/placements'), env as any);
    expect(pl1.status).toBe(200);
    const pl1Json = (await pl1.json()) as any;
    expect(pl1Json.data.placements.find((p: any) => p.location_id === 1).revision).toBe(0);

    // Count with current revision 0 -> applied, revision becomes 1
    const cOkKey = '33333333-3333-4333-8333-333333333333';
    const cOk = await app.fetch(
      new Request('http://test.local/api/inventory/offline-operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': cOkKey },
        body: JSON.stringify({
          operation_id: cOkKey,
          kind: 'count',
          product_id: 10,
          location_id: 1,
          counted_quantity: 17,
          observed_revision: 0,
        }),
      }),
      env as any,
    );
    expect(cOk.status).toBe(200);
    const cOkJson = (await cOk.json()) as any;
    expect(cOkJson.data.revision).toBe(1);
    expect(cOkJson.data.new_quantity).toBe(17);
    expect(cOkJson.data.product_total).toBe(22); // 17 + 5

    // Stale count with observed_revision 0 -> 409 COUNT_CONFLICT, quantity unchanged, returns current_revision=1
    const cStaleKey = '44444444-4444-4444-8444-444444444444';
    const cStale = await app.fetch(
      new Request('http://test.local/api/inventory/offline-operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': cStaleKey },
        body: JSON.stringify({
          operation_id: cStaleKey,
          kind: 'count',
          product_id: 10,
          location_id: 1,
          counted_quantity: 99,
          observed_revision: 0,
        }),
      }),
      env as any,
    );
    expect(cStale.status).toBe(409);
    const cStaleJson = (await cStale.json()) as any;
    expect(cStaleJson.code).toBe('COUNT_CONFLICT');
    expect(cStaleJson.current_revision).toBe(1);
    expect(cStaleJson.current_quantity).toBe(17);
    expect(cStaleJson.product_total).toBe(22);

    // Issue below zero -> rejected (400 QTY_INVALID)
    const issBadKey = '55555555-5555-4555-8555-555555555555';
    const issBad = await app.fetch(
      new Request('http://test.local/api/inventory/offline-operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': issBadKey },
        body: JSON.stringify({
          operation_id: issBadKey,
          kind: 'issue',
          product_id: 10,
          location_id: 1,
          quantity_delta: 99,
        }),
      }),
      env as any,
    );
    expect(issBad.status).toBe(400);
    expect(((await issBad.json()) as any).code).toBe('QTY_INVALID');

    // Receive without location_id or with code string instead of integer -> 404 LOCATION_NOT_FOUND
    const noLocKey = '66666666-6666-4666-8666-666666666666';
    const noLoc = await app.fetch(
      new Request('http://test.local/api/inventory/offline-operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': noLocKey },
        body: JSON.stringify({ operation_id: noLocKey, kind: 'receive', product_id: 10, quantity_delta: 4 }),
      }),
      env as any,
    );
    expect(noLoc.status).toBe(404);
    expect(((await noLoc.json()) as any).code).toBe('LOCATION_NOT_FOUND');

    const codeLocKey = '77777777-7777-4777-8777-777777777777';
    const codeLoc = await app.fetch(
      new Request('http://test.local/api/inventory/offline-operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': codeLocKey },
        body: JSON.stringify({ operation_id: codeLocKey, kind: 'receive', product_id: 10, location_id: 'MAG', quantity_delta: 4 }),
      }),
      env as any,
    );
    expect(codeLoc.status).toBe(404);

    // Other writer (adjustLocationStock) bumps revision from 1 -> 2 and preserves placement sum == stock_quantity
    await adjustLocationStock(db, 10, 1, 3);
    const pl2 = await app.fetch(new Request('http://test.local/api/inventory/products/10/placements'), env as any);
    const pl2Json = (await pl2.json()) as any;
    expect(pl2Json.data.placements.find((p: any) => p.location_id === 1).revision).toBe(2);

    const prodTotal = (sqlite.prepare(`SELECT stock_quantity FROM products WHERE id = 10`).get() as any).stock_quantity;
    const placementSum = (sqlite.prepare(`SELECT SUM(quantity) AS s FROM stock_location_qty WHERE product_id = 10`).get() as any).s;
    expect(prodTotal).toBe(placementSum);

    // Purge > 7 days
    sqlite
      .prepare(`INSERT INTO offline_idempotency (key, account_id, device_id, kind, op, request_hash, status, response, created_at) VALUES ('old-key', 'default', 'd', 'receive', 'receive', 'h', 200, '{}', datetime('now', '-8 days'))`)
      .run();
    const deleted = await purgeExpiredOfflineIdempotency(db);
    expect(deleted).toBe(1);
  });

  it('rejects missing header (400), operation_id mismatch (400), and unauthorized role (403)', async () => {
    const { app: userApp, env: userEnv } = setupTestApp('user');
    const roleRes = await userApp.fetch(
      new Request('http://test.local/api/inventory/offline-operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'k1' },
        body: JSON.stringify({ operation_id: 'k1', kind: 'receive', product_id: 10, location_id: 1, quantity_delta: 1 }),
      }),
      userEnv as any,
    );
    expect(roleRes.status).toBe(403);

    const { app, env } = setupTestApp('stock');
    const noHdr = await app.fetch(
      new Request('http://test.local/api/inventory/offline-operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation_id: 'k1', kind: 'receive', product_id: 10, location_id: 1, quantity_delta: 1 }),
      }),
      env as any,
    );
    expect(noHdr.status).toBe(400);
    expect(((await noHdr.json()) as any).code).toBe('MISSING_IDEMPOTENCY_KEY');

    const mismatch = await app.fetch(
      new Request('http://test.local/api/inventory/offline-operations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'k1' },
        body: JSON.stringify({ operation_id: 'k2', kind: 'receive', product_id: 10, location_id: 1, quantity_delta: 1 }),
      }),
      env as any,
    );
    expect(mismatch.status).toBe(400);
    expect(((await mismatch.json()) as any).code).toBe('OPERATION_ID_MISMATCH');
  });
});
