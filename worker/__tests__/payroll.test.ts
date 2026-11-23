/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { registerPayrollRoutes } from '../routes/payroll';

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

function setupPayrollApp() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now')), username TEXT, role TEXT, action TEXT, entity TEXT, entity_id TEXT, detail TEXT, ip TEXT);
    CREATE TABLE company_settings (id INTEGER PRIMARY KEY, company_name TEXT, address TEXT, city TEXT, ice TEXT, if_number TEXT, rc TEXT, cnss TEXT);
    INSERT INTO company_settings (id, company_name, ice, cnss) VALUES (1, 'Atlas Marbre SARL', '001234567000089', '9988776');
    CREATE TABLE employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      emp_number TEXT,
      first_name TEXT,
      last_name TEXT,
      name TEXT,
      role_title TEXT,
      cnss_number TEXT,
      social_insurance TEXT,
      national_id TEXT,
      active INTEGER DEFAULT 1,
      pay_amount REAL DEFAULT 0,
      pay_cycle_type TEXT DEFAULT 'monthly',
      pay_cycle_days INTEGER DEFAULT 30
    );
    INSERT INTO employees (emp_number, first_name, last_name, role_title, cnss_number, national_id, pay_amount)
    VALUES ('EMP-001', 'Sara', 'Bennani', 'Comptable', '123456789', 'BE123456', 8000);
    CREATE TABLE employee_attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      work_date TEXT NOT NULL,
      check_in TEXT,
      check_out TEXT,
      status TEXT
    );
    INSERT INTO employee_attendance (employee_id, work_date, check_in, check_out, status)
    VALUES (1, '2026-11-10', '08:30', '18:30', 'present');
  `);

  const db = makeSqliteD1(sqlite);
  const app = new Hono<any>();
  registerPayrollRoutes(app as any, {
    requireEmployeeAdmin: async () => null,
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
    writeAudit: async (database, entry) => {
      await database
        .prepare(`INSERT INTO audit_log (username, role, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(entry.username || '', entry.role || '', entry.action, entry.entity || '', entry.entity_id || '', entry.detail || '')
        .run();
    },
    sessionUserFromHeader: () => ({ username: 'owner', role: 'owner' }),
    clientIp: () => '127.0.0.1',
  });
  return { app, env: { DB: db }, sqlite };
}

describe('Part 4 — Moroccan payroll (CNSS / AMO / IGR, PDF bulletin, declaration export, immutable close)', () => {
  it('computes CNSS/AMO/IGR from settings + attendance overtime, generates PDF & Excel declaration, locks closed run, and allows corrective run', async () => {
    const { app, env, sqlite } = setupPayrollApp();

    // 1. Settings read with disclaimer
    const setRes = await app.fetch(new Request('http://test.local/api/payroll/settings'), env as any);
    expect(setRes.status).toBe(200);
    const setJson = (await setRes.json()) as any;
    expect(setJson.data.cnss_ceiling).toBe(6000);
    expect(setJson.data.disclaimer).toContain('comptable');

    // 2. Create 2026-11 regular payroll run (reads 2h overtime from attendance!)
    const createRes = await app.fetch(
      new Request('http://test.local/api/payroll/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period_month: '2026-11' }),
      }),
      env as any,
    );
    expect(createRes.status).toBe(201);
    const run = ((await createRes.json()) as any).data;
    expect(run.lines.length).toBe(1);
    const line = run.lines[0];
    expect(line.overtime_hours).toBe(2);
    expect(line.gross_salary).toBeGreaterThan(8000);
    expect(line.cnss_base).toBe(6000); // capped at 6000 MAD
    expect(line.cnss_emp).toBe(268.8); // 6000 * 0.0448
    expect(line.amo_emp).toBeGreaterThan(0);
    expect(line.igr).toBeGreaterThan(0);
    expect(line.employer_cost).toBeGreaterThan(line.gross_salary);

    // 3. Edit draft bonus
    const patchDraft = await app.fetch(
      new Request(`http://test.local/api/payroll/runs/${run.id}/lines/${line.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bonuses: 500 }),
      }),
      env as any,
    );
    expect(patchDraft.status).toBe(200);

    // 4. Close run -> immutable + audited
    const closeRes = await app.fetch(
      new Request(`http://test.local/api/payroll/runs/${run.id}/close`, { method: 'POST', body: '{}' }),
      env as any,
    );
    expect(closeRes.status).toBe(200);
    expect(((await closeRes.json()) as any).data.status).toBe('closed');

    // Mutation on closed run MUST return 409 PAYROLL_RUN_IMMUTABLE
    const patchClosed = await app.fetch(
      new Request(`http://test.local/api/payroll/runs/${run.id}/lines/${line.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bonuses: 999 }),
      }),
      env as any,
    );
    expect(patchClosed.status).toBe(409);

    // 5. Corrective run for same month allowed
    const corrRes = await app.fetch(
      new Request('http://test.local/api/payroll/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period_month: '2026-11', run_kind: 'corrective', corrects_run_id: run.id }),
      }),
      env as any,
    );
    expect(corrRes.status).toBe(201);

    // 6. Bulletin de paie PDF
    const pdfRes = await app.fetch(
      new Request(`http://test.local/api/payroll/runs/${run.id}/lines/${line.id}/bulletin`),
      env as any,
    );
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.headers.get('Content-Type')).toBe('application/pdf');
    const pdfText = new TextDecoder().decode(await pdfRes.arrayBuffer());
    expect(pdfText.startsWith('%PDF-1.4')).toBe(true);
    expect(pdfText).toContain('BULLETIN DE PAIE');
    expect(pdfText).toContain('001234567000089');
    expect(pdfText).toContain('9988776');

    // 7. Excel (.xls) declaration with Totals sheet
    const xlsRes = await app.fetch(
      new Request(`http://test.local/api/payroll/runs/${run.id}/declaration?format=xls`),
      env as any,
    );
    expect(xlsRes.status).toBe(200);
    const xlsBody = await xlsRes.text();
    expect(xlsBody).toContain('Declaration_CNSS_AMO');
    expect(xlsBody).toContain('Totaux');

    const audits = sqlite.prepare(`SELECT action FROM audit_log WHERE entity = 'payroll_runs'`).all() as any[];
    expect(audits.map((a) => a.action)).toContain('payroll.run_close');
  });
});
