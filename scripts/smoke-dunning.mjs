/**
 * Smoke test: Part 6 unpaid invoice dunning schema & dedup unique key check.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../migrations/0018_dunning.sql', import.meta.url), 'utf8'));

const ins1 = db.prepare(`INSERT OR IGNORE INTO dunning_events (invoice_id, stage, channel, recipient, status) VALUES (1, 'D+1', 'email', 'a@b.ma', 'sent')`).run();
assert.equal(ins1.changes, 1);
const ins2 = db.prepare(`INSERT OR IGNORE INTO dunning_events (invoice_id, stage, channel, recipient, status) VALUES (1, 'D+1', 'email', 'a@b.ma', 'sent')`).run();
assert.equal(ins2.changes, 0, 'dedup unique(invoice_id, stage) prevents double-send');

console.log('smoke-dunning: OK');
