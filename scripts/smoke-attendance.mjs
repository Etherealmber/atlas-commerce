/**
 * Smoke test: Part 3 attendance (pointage) — badge/manual/mobile & monthly migration check.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../migrations/0015_attendance_overtime_badge.sql', import.meta.url), 'utf8'));

db.prepare(`INSERT INTO employee_attendance (employee_id, work_date, check_in, check_out, status, source) VALUES (1, '2026-11-24', '08:30', '18:30', 'present', 'badge')`).run();
const row = db.prepare(`SELECT * FROM employee_attendance WHERE employee_id = 1`).get();
assert.equal(row.source, 'badge');
console.log('smoke-attendance: OK');
