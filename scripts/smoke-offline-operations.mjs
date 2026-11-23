/**
 * Smoke test: offline operations idempotency & stock_location_revisions schema (migrations 0013 + 0020).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../migrations/0013_offline_operations.sql', import.meta.url), 'utf8'));
db.exec(readFileSync(new URL('../migrations/0020_offline_inventory_contract.sql', import.meta.url), 'utf8'));

const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_offline_idem_created'`).get();
assert.ok(idx, 'idx_offline_idem_created exists');

// Same key allowed across distinct accounts (account-scoped PK)
db.prepare(
  `INSERT INTO offline_idempotency (key, account_id, device_id, kind, op, request_hash, status, response, created_at)
   VALUES ('op-1', 'acc-a', 'android-1', 'receive', 'receive', 'abc', 200, '{}', datetime('now'))`,
).run();
db.prepare(
  `INSERT INTO offline_idempotency (key, account_id, device_id, kind, op, request_hash, status, response, created_at)
   VALUES ('op-1', 'acc-b', 'android-2', 'receive', 'receive', 'abc', 200, '{}', datetime('now'))`,
).run();

db.prepare(
  `INSERT INTO stock_location_revisions (product_id, location_id, revision, updated_at)
   VALUES (1, 1, 1, datetime('now'))
   ON CONFLICT(product_id, location_id) DO UPDATE SET revision = stock_location_revisions.revision + 1`,
).run();

const rev = db.prepare(`SELECT revision FROM stock_location_revisions WHERE product_id = 1 AND location_id = 1`).get();
assert.equal(rev.revision, 1);

console.log('smoke-offline-operations: OK');
