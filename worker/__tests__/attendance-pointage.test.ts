/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { registerAttendanceRoutes } from '../routes/attendance';
import { reportShell } from '../routes/reports';

function makeSqliteD1(sqlite: DatabaseSync) {
  function prepare(sql: string) {
    return {
      params: [] as any[],
      bind(...params: any[]) {
        this.params = params;
        return this;
      },
      async first() {
        const row = sqlite.prepare(sql).get(...this.params);
        return row === undefined ? null : { ...(row as any) };
      },
      async all() {
        const rows = sqlite.prepare(sql).all(...this.params).map((r: any) => ({ ...r }));
        return { success: true, results: rows, meta: {} };
      },
      async run() {
        const info = sqlite.prepare(sql).run(...this.params);
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
  return { prepare } as unknown as D1Database;
}

function setupAttendanceApp() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE company_settings (
      id INTEGER PRIMARY KEY,
      company_name TEXT DEFAULT 'Atlas',
      report_footer TEXT DEFAULT '',
      attendance_enabled INTEGER DEFAULT 1
    );
    INSERT INTO company_settings (id, attendance_enabled) VALUES (1, 1);
    CREATE TABLE employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      emp_number TEXT,
      badge_code TEXT DEFAULT '',
      first_name TEXT,
      last_name TEXT,
      name TEXT,
      role_title TEXT,
      team TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      pay_amount REAL DEFAULT 4000,
      pay_cycle_type TEXT DEFAULT 'monthly',
      pay_cycle_days INTEGER DEFAULT 30,
      last_paid_at TEXT,
      joined_date TEXT,
      returned_at TEXT
    );
    INSERT INTO employees (emp_number, badge_code, first_name, last_name, role_title)
    VALUES ('EMP-001', 'BADGE-A1', 'Sara', 'Bennani', 'Vendeuse');
    INSERT INTO employees (emp_number, badge_code, first_name, last_name, role_title)
    VALUES ('EMP-002', '', 'Youssef', 'Alami', 'Magasinier');
  `);
  sqlite.exec(readFileSync('migrations/0015_attendance_overtime_badge.sql', 'utf8'));
  const db = makeSqliteD1(sqlite);
  const app = new Hono<any>();
  registerAttendanceRoutes(app as any, {
    requireEmployeeAdmin: async () => null,
    ensureHrSettings: async () => {},
    ensureEmployeeTeamColumn: async () => {},
    loadAttendanceRules: async () => ({
      enabled: true,
      late_threshold: '09:15',
      early_threshold: '18:00',
      overtime_after_hours: 8,
      overtime_multiplier: 1.25,
      pay_mode: 'presence',
      minute_deduct: false,
      warn_late_count: 3,
      blame_late_count: 6,
      workday_hours: 8,
    }),
    schemaOnce: async (_k, fn) => fn(),
    addColumnIfMissing: async (database, table, col, def) => {
      const cols = await database.prepare(`PRAGMA table_info(${table})`).all();
      const has = (cols.results || []).some((r: any) => r.name === col);
      if (!has) await database.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`).run();
    },
    reportShell,
    moroccoTodayStr: () => '2026-11-24',
  });
  return { app, env: { DB: db } };
}

describe('Part 3 — attendance pointage (mobile/manual/badge, hours/overtime/early-leave, monthly recap, CSV)', () => {
  it('supports badge check-in/out, manual & mobile sources, late/early/overtime metrics, monthly recap, and CSV export', async () => {
    const { app, env } = setupAttendanceApp();

    // 1. Badge check-in (EMP-001 via BADGE-A1) at 08:30 -> check-out at 18:30 = 10h (2h overtime!)
    const bIn = await app.fetch(
      new Request('http://test.local/api/attendance/badge-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ badge_code: 'BADGE-A1', date: '2026-11-24', time: '08:30' }),
      }),
      env as any,
    );
    expect(bIn.status).toBe(200);
    const bInJson = (await bIn.json()) as any;
    expect(bInJson.data.action).toBe('in');
    expect(bInJson.data.source).toBe('badge');

    const bOut = await app.fetch(
      new Request('http://test.local/api/attendance/badge-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ badge_code: 'BADGE-A1', date: '2026-11-24', time: '18:30' }),
      }),
      env as any,
    );
    expect(bOut.status).toBe(200);
    const bOutJson = (await bOut.json()) as any;
    expect(bOutJson.data.action).toBe('out');
    expect(bOutJson.data.worked_hours).toBe(10);
    expect(bOutJson.data.overtime_hours).toBe(2);
    expect(bOutJson.data.is_late).toBe(false);
    expect(bOutJson.data.is_early_leave).toBe(false);

    // 2. Manual owner entry for EMP-002: late arrival (09:45) + early leave (17:00)
    const manualPut = await app.fetch(
      new Request('http://test.local/api/attendance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: 2,
          date: '2026-11-24',
          check_in: '09:45',
          check_out: '17:00',
          source: 'manual',
        }),
      }),
      env as any,
    );
    expect(manualPut.status).toBe(200);
    const manJson = (await manualPut.json()) as any;
    expect(manJson.data.status).toBe('late');
    expect(manJson.data.is_late).toBe(true);
    expect(manJson.data.is_early_leave).toBe(true);
    expect(manJson.data.early_minutes).toBe(60);

    // 3. Mobile self-check on previous day for EMP-002
    const mob = await app.fetch(
      new Request('http://test.local/api/attendance/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: 2, date: '2026-11-23', time: '09:00', source: 'mobile' }),
      }),
      env as any,
    );
    expect(mob.status).toBe(200);
    expect(((await mob.json()) as any).data.source).toBe('mobile');

    // 4. Monthly recap filtered by month + employee
    const monthlyRes = await app.fetch(
      new Request('http://test.local/api/attendance/monthly?month=2026-11&employee_id=1'),
      env as any,
    );
    expect(monthlyRes.status).toBe(200);
    const monthlyJson = (await monthlyRes.json()) as any;
    expect(monthlyJson.data.recap.length).toBe(1);
    expect(monthlyJson.data.recap[0].worked_hours).toBe(10);
    expect(monthlyJson.data.recap[0].overtime_hours).toBe(2);

    // 5. CSV export includes overtime & source
    const csvRes = await app.fetch(
      new Request('http://test.local/api/attendance/export?month=2026-11&format=csv'),
      env as any,
    );
    expect(csvRes.status).toBe(200);
    const csvText = await csvRes.text();
    expect(csvText).toContain('worked_hours,overtime_hours,late,early_leave,source');
    expect(csvText).toContain('badge');
    expect(csvText).toContain('manual');
    expect(csvText).toContain('mobile');
  });
});
