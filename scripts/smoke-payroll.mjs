/**
 * Smoke test: Part 4 Moroccan payroll (CNSS / AMO / IGR) schema & unique regular run check.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../migrations/0016_payroll_cnss_amo.sql', import.meta.url), 'utf8'));

const settings = db.prepare(`SELECT * FROM payroll_settings WHERE id = 1`).get();
assert.equal(settings.cnss_ceiling, 6000);
assert.equal(settings.cnss_emp_rate, 0.0448);
assert.equal(settings.amo_emp_rate, 0.0226);

// Regular run allowed once per period_month; corrective run allowed for same period
db.prepare(`INSERT INTO payroll_runs (period_month, status, run_kind) VALUES ('2026-11', 'closed', 'regular')`).run();
let dupBlocked = false;
try {
  db.prepare(`INSERT INTO payroll_runs (period_month, status, run_kind) VALUES ('2026-11', 'draft', 'regular')`).run();
} catch {
  dupBlocked = true;
}
assert.equal(dupBlocked, true);
db.prepare(`INSERT INTO payroll_runs (period_month, status, run_kind, corrects_run_id) VALUES ('2026-11', 'draft', 'corrective', 1)`).run();

console.log('smoke-payroll: OK');
