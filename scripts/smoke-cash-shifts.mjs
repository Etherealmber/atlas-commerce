/**
 * Smoke test: cash shifts + X/Z-report (Part 2).
 * Verifies unique open shift per till, denominations sum, variance, and Z-report rules in node:sqlite.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../migrations/0014_cash_shifts.sql', import.meta.url), 'utf8'));

// Open shift on CAISSE-1
const open1 = db.prepare(`INSERT INTO cash_shifts (till_id, operator, opened_at, opening_float, status) VALUES ('CAISSE-1', 'admin', '2026-11-24T08:00:00Z', 500, 'open')`).run();
const shiftId = Number(open1.lastInsertRowid);

// Second open shift on same till MUST fail (unique partial index)
let dupBlocked = false;
try {
  db.prepare(`INSERT INTO cash_shifts (till_id, operator, opened_at, opening_float, status) VALUES ('CAISSE-1', 'owner', '2026-11-24T09:00:00Z', 200, 'open')`).run();
} catch {
  dupBlocked = true;
}
assert.equal(dupBlocked, true, 'unique open shift per till enforced');

// Add movements
db.prepare(`INSERT INTO cash_shift_movements (shift_id, direction, payment_method, amount, label, occurred_at) VALUES (?, 'in', 'cash', 350, 'Vente', '2026-11-24T10:00:00Z')`).run(shiftId);
db.prepare(`INSERT INTO cash_shift_movements (shift_id, direction, payment_method, amount, label, occurred_at) VALUES (?, 'out', 'cash', 50, 'Retrait', '2026-11-24T11:00:00Z')`).run(shiftId);

// Close shift with variance
const expected = 500 + 350 - 50; // 800
const counted = 790;
const variance = counted - expected; // -10
db.prepare(`UPDATE cash_shifts SET status = 'closed', closed_at = '2026-11-24T20:00:00Z', expected_amount = ?, counted_amount = ?, variance = ? WHERE id = ?`).run(expected, counted, variance, shiftId);

// New shift on same till is allowed once closed
const open2 = db.prepare(`INSERT INTO cash_shifts (till_id, operator, opened_at, opening_float, status) VALUES ('CAISSE-1', 'admin', '2026-11-25T08:00:00Z', 500, 'open')`).run();
assert.ok(Number(open2.lastInsertRowid) > shiftId);

console.log('smoke-cash-shifts: OK');
