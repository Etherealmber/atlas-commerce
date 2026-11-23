/**
 * Smoke test: Part 5 FEC chart of accounts migration check.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../migrations/0017_fec_chart_of_accounts.sql', import.meta.url), 'utf8'));

const rows = db.prepare(`SELECT * FROM accounting_accounts`).all();
assert.ok(rows.length >= 15);
const sales = rows.find((r) => r.account_key === 'sales_revenue');
assert.equal(sales.code, '7111');
console.log('smoke-fec: OK');
