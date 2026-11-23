/**
 * Smoke test: offline stock operations contract & idempotency.
 *
 * Live mode (when ATLAS_SMOKE_BASE, ATLAS_SMOKE_TOKEN, ATLAS_SMOKE_PRODUCT_ID, ATLAS_SMOKE_LOCATION_ID are set):
 *   exercises POST /api/inventory/offline-operations + GET /api/inventory/locations?product_id=...
 *
 * Local contract mode (default, plain node):
 *   verifies the exact 0013_offline_operations SQL schema, canonical SHA-256 idempotency,
 *   revision conflicts, and location requirements in node:sqlite.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const base = (process.env.ATLAS_SMOKE_BASE || '').replace(/\/$/, '');
const token = process.env.ATLAS_SMOKE_TOKEN || '';
const envProductId = process.env.ATLAS_SMOKE_PRODUCT_ID || '';
const envLocationId = process.env.ATLAS_SMOKE_LOCATION_ID || '';

if (base && token && envProductId && envLocationId) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
  };
  const postBatch = async (operations, extraHeaders = {}) => {
    const res = await fetch(`${base}/api/inventory/offline-operations`, {
      method: 'POST',
      headers: { ...headers, ...extraHeaders },
      body: JSON.stringify({
        device_id: 'smoke-device',
        client_ts: new Date().toISOString(),
        operations,
      }),
    });
    const json = await res.json();
    return { status: res.status, json };
  };

  // 1. Same key twice, same body -> applied then replayed
  const k1 = `smoke-${randomUUID()}`;
  const recv = {
    op: 'receive',
    product_id: envProductId,
    location_id: envLocationId,
    quantity: 1,
    idempotency_key: k1,
    client_ts: new Date().toISOString(),
  };
  const r1 = await postBatch([recv]);
  assert.equal(r1.status, 200);
  assert.equal(r1.json.data[0].status, 'applied');
  const r2 = await postBatch([recv]);
  assert.equal(r2.status, 200);
  assert.equal(r2.json.data[0].status, 'replayed');

  // 2. Same key, different body -> 409
  const r3 = await postBatch([{ ...recv, quantity: 99 }]);
  assert.equal(r3.json.data[0].http, 409);

  // 3. Stale count -> conflict; current count -> applied
  const locRes = await fetch(`${base}/api/inventory/locations?product_id=${encodeURIComponent(envProductId)}`, { headers });
  const locJson = await locRes.json();
  const loc = locJson.data.find((l) => String(l.location_id) === String(envLocationId));
  assert.ok(loc, 'location found');

  const stale = await postBatch([{
    op: 'count',
    product_id: envProductId,
    location_id: envLocationId,
    counted_on_hand: loc.quantity + 5,
    expected_revision: Math.max(1, loc.revision - 1),
    idempotency_key: `smoke-${randomUUID()}`,
    client_ts: new Date().toISOString(),
  }]);
  assert.equal(stale.json.data[0].status, 'conflict');

  const fresh = await postBatch([{
    op: 'count',
    product_id: envProductId,
    location_id: envLocationId,
    counted_on_hand: loc.quantity,
    expected_revision: loc.revision,
    idempotency_key: `smoke-${randomUUID()}`,
    client_ts: new Date().toISOString(),
  }]);
  assert.equal(fresh.json.data[0].status, 'applied');

  // 4. Receive without location_id -> rejected
  const noLoc = await postBatch([{
    op: 'receive',
    product_id: envProductId,
    quantity: 2,
    idempotency_key: `smoke-${randomUUID()}`,
    client_ts: new Date().toISOString(),
  }]);
  assert.equal(noLoc.json.data[0].status, 'rejected');

  console.log('smoke-offline-operations (live): OK');
  process.exit(0);
}

// Local contract mode via node:sqlite
function canonical(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Object.is(v, -0) ? 0 : Number(v);
  if (typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(canonical);
  const out = {};
  for (const k of Object.keys(v).sort()) {
    if (v[k] !== undefined) out[k] = canonical(v[k]);
  }
  return out;
}
function hashBody(v) {
  return createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
}

const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, stock_quantity REAL DEFAULT 0, track_inventory INTEGER DEFAULT 1);
  CREATE TABLE stock_locations (id INTEGER PRIMARY KEY, code TEXT UNIQUE, name TEXT, is_default INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1);
  CREATE TABLE stock_location_qty (location_id INTEGER NOT NULL, product_id INTEGER NOT NULL, quantity REAL NOT NULL DEFAULT 0, PRIMARY KEY (location_id, product_id));
  CREATE TABLE stock_movements (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, type TEXT, quantity REAL, previous_quantity REAL, new_quantity REAL, reason TEXT, reference TEXT, created_by TEXT, location_id TEXT, device_id TEXT, client_ts TEXT, created_at TEXT DEFAULT (datetime('now')));
`);
db.exec(readFileSync(new URL('../migrations/0013_offline_operations.sql', import.meta.url), 'utf8'));
db.prepare(`INSERT INTO products (id, name, stock_quantity) VALUES (1, 'Marbre Carrara', 10)`).run();
db.prepare(`INSERT INTO stock_locations (id, code, name, is_default, is_active) VALUES (1, 'MAG', 'Magasin', 1, 1)`).run();
db.prepare(`INSERT INTO stock_location_qty (location_id, product_id, quantity) VALUES (1, 1, 10)`).run();

function runOp(op) {
  const hash = hashBody({
    op: op.op,
    product_id: String(op.product_id || ''),
    location_id: String(op.location_id || ''),
    quantity: op.quantity ?? null,
    counted_on_hand: op.counted_on_hand ?? null,
    expected_revision: op.expected_revision ?? null,
  });
  const idem = db.prepare(`SELECT request_hash, response FROM offline_idempotency WHERE key = ?`).get(op.idempotency_key);
  if (idem) {
    if (idem.request_hash !== hash) return { status: 'rejected', http: 409, code: 'IDEMPOTENCY_MISMATCH' };
    return { ...JSON.parse(idem.response), status: 'replayed', http: 200 };
  }
  if (!op.location_id) return { status: 'rejected', http: 400, code: 'LOCATION_REQUIRED' };
  const qtyRow = db.prepare(`SELECT quantity FROM stock_location_qty WHERE location_id = ? AND product_id = ?`).get(Number(op.location_id), Number(op.product_id));
  const revRow = db.prepare(`SELECT revision FROM stock_location_revisions WHERE product_id = ? AND location_id = ?`).get(String(op.product_id), String(op.location_id));
  const curQty = Number(qtyRow?.quantity || 0);
  const curRev = Number(revRow?.revision || 1);

  let nextQty = curQty;
  if (op.op === 'receive') nextQty = curQty + op.quantity;
  else if (op.op === 'count') {
    if (op.expected_revision !== curRev) {
      return { status: 'conflict', http: 409, revision: curRev, quantity: curQty };
    }
    nextQty = op.counted_on_hand;
  }
  const nextRev = curRev + 1;
  const out = { status: 'applied', http: 200, revision: nextRev, quantity: nextQty };
  db.exec('BEGIN');
  db.prepare(`INSERT INTO stock_location_qty (location_id, product_id, quantity) VALUES (?, ?, ?) ON CONFLICT(location_id, product_id) DO UPDATE SET quantity = excluded.quantity`).run(Number(op.location_id), Number(op.product_id), nextQty);
  db.prepare(`INSERT INTO stock_location_revisions (product_id, location_id, revision, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(product_id, location_id) DO UPDATE SET revision = excluded.revision`).run(String(op.product_id), String(op.location_id), nextRev, new Date().toISOString());
  db.prepare(`INSERT INTO stock_movements (product_id, type, quantity, previous_quantity, new_quantity, device_id, client_ts, location_id) VALUES (?, ?, ?, ?, ?, 'smoke', ?, ?)`).run(Number(op.product_id), op.op, nextQty - curQty, curQty, nextQty, op.client_ts || '', String(op.location_id));
  db.prepare(`INSERT INTO offline_idempotency (key, device_id, op, request_hash, status, response, created_at) VALUES (?, 'smoke', ?, ?, 200, ?, ?)`).run(op.idempotency_key, op.op, hash, JSON.stringify(out), new Date().toISOString());
  db.exec('COMMIT');
  return out;
}

// 1. Same key twice, same body -> one movement, second status "replayed"
const k1 = 'k-receive-1';
const r1 = runOp({ op: 'receive', product_id: 1, location_id: 1, quantity: 5, idempotency_key: k1 });
const r2 = runOp({ op: 'receive', product_id: 1, location_id: 1, quantity: 5.0, idempotency_key: k1 });
assert.equal(r1.status, 'applied');
assert.equal(r2.status, 'replayed');
assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM stock_movements`).get().c, 1);

// 2. Same key, different body -> 409
const r3 = runOp({ op: 'receive', product_id: 1, location_id: 1, quantity: 9, idempotency_key: k1 });
assert.equal(r3.http, 409);

// 3. Count with stale revision -> conflict, quantity unchanged
const stale = runOp({ op: 'count', product_id: 1, location_id: 1, counted_on_hand: 99, expected_revision: 1, idempotency_key: 'k-count-stale' });
assert.equal(stale.status, 'conflict');
assert.equal(db.prepare(`SELECT quantity FROM stock_location_qty WHERE location_id = 1 AND product_id = 1`).get().quantity, 15);

// 4. Count with current revision (2) -> applied
const fresh = runOp({ op: 'count', product_id: 1, location_id: 1, counted_on_hand: 40, expected_revision: 2, idempotency_key: 'k-count-fresh' });
assert.equal(fresh.status, 'applied');
assert.equal(fresh.revision, 3);
assert.equal(db.prepare(`SELECT quantity FROM stock_location_qty WHERE location_id = 1 AND product_id = 1`).get().quantity, 40);

// 5. Receive without location_id -> rejected
const noLoc = runOp({ op: 'receive', product_id: 1, quantity: 2, idempotency_key: 'k-no-loc' });
assert.equal(noLoc.status, 'rejected');

console.log('smoke-offline-operations: OK');
