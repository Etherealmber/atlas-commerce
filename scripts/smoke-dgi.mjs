/**
 * Smoke test: Part 7 DGI e-invoicing clearance schema & status state machine.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../migrations/0019_dgi_clearance.sql', import.meta.url), 'utf8'));

db.prepare(`INSERT INTO dgi_clearance (invoice_id, status, is_stub, retention_until) VALUES (1, 'ubl_ready', 1, '2036-11-24')`).run();
db.prepare(`UPDATE dgi_clearance SET status = 'cleared', clearance_ref = 'DGI-STUB-1-ABC' WHERE invoice_id = 1`).run();
const row = db.prepare(`SELECT status, is_stub, retention_until FROM dgi_clearance WHERE invoice_id = 1`).get();
assert.equal(row.status, 'cleared');
assert.equal(row.is_stub, 1);
assert.equal(row.retention_until, '2036-11-24');

console.log('smoke-dgi: OK');
