/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { registerEmployeeRoutes } from '../routes/employees';
import { clampCnssDays, proposeCnssDays, registerPayrollRoutes } from '../routes/payroll';

function makeSqliteD1(sqlite: DatabaseSync) {
  function prepare(sql: string) {
    let params: any[] = [];
    const api: any = {
      bind(...args: any[]) {
        params = args;
        return api;
      },
      async first() {
        const row = sqlite.prepare(sql).get(...params);
        return row === undefined ? null : { ...(row as any) };
      },
      async all() {
        return { success: true, results: sqlite.prepare(sql).all(...params).map((r: any) => ({ ...r })), meta: {} };
      },
      async run() {
        const info = sqlite.prepare(sql).run(...params);
        return { success: true, meta: { changes: Number(info.changes || 0), last_row_id: Number(info.lastInsertRowid || 0) } };
      },
    };
    return api;
  }
  return { prepare } as unknown as D1Database;
}

describe('CNSS declared days — helpers', () => {
  it('caps at 26, rounds to half days and scales down with absences', () => {
    expect(clampCnssDays(30)).toBe(26);
    expect(clampCnssDays(-3)).toBe(0);
    expect(clampCnssDays(13.3)).toBe(13.5);
    expect(clampCnssDays('abc', 7)).toBe(7);
    expect(proposeCnssDays(26, true, 30)).toBe(26);
    expect(proposeCnssDays(22, true, 30)).toBe(22);
    expect(proposeCnssDays(26, true, 15)).toBe(13);
    expect(proposeCnssDays(26, false, 30)).toBe(0);
  });
});

describe('CNSS declared days — employee file', () => {
  function setup() {
    const sqlite = new DatabaseSync(':memory:');
    const db = makeSqliteD1(sqlite);
    const app: any = new Hono();
    registerEmployeeRoutes(app, {
      requireEmployeeAdmin: async () => null,
      requireEmployeeDirectory: async () => null,
    });
    const request = (path: string, method = 'GET', body: any = {}) =>
      app.request(
        path,
        { method, headers: { 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) },
        { DB: db },
      );
    return { sqlite, request };
  }

  it('saves the declaration (and the other HR extras) on create, keeps it when a client omits it, clamps on update', async () => {
    const { sqlite, request } = setup();
    const created = await request('/api/employees', 'POST', {
      first_name: 'Haytam',
      last_name: 'Kharbouch',
      pay_amount: 4000,
      contract_type: 'CDD',
      rib: 'MA64 0000',
      cnss_number: '123456789',
      cnss_declared: 1,
      cnss_days: 22,
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as any;
    expect(body.data).toMatchObject({ cnss_declared: 1, cnss_days: 22, contract_type: 'CDD', rib: 'MA64 0000' });

    // Older / mobile clients that do not send the CNSS fields must not reset them.
    expect((await request('/api/employees/1', 'PUT', { first_name: 'Haytam', last_name: 'Kharbouch' })).status).toBe(200);
    expect(sqlite.prepare('SELECT cnss_declared, cnss_days FROM employees WHERE id = 1').get()).toMatchObject({ cnss_declared: 1, cnss_days: 22 });

    expect((await request('/api/employees/1', 'PUT', { first_name: 'Haytam', cnss_days: 31 })).status).toBe(200);
    expect(sqlite.prepare('SELECT cnss_days FROM employees WHERE id = 1').get()).toMatchObject({ cnss_days: 26 });

    expect((await request('/api/employees/1', 'PUT', { first_name: 'Haytam', cnss_declared: 0, cnss_days: 0 })).status).toBe(200);
    expect(sqlite.prepare('SELECT cnss_declared, cnss_days FROM employees WHERE id = 1').get()).toMatchObject({ cnss_declared: 0, cnss_days: 0 });
  });
});

describe('CNSS declared days — payroll run', () => {
  function setup() {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, role TEXT, action TEXT, entity TEXT, entity_id TEXT, detail TEXT, ip TEXT);
      CREATE TABLE company_settings (id INTEGER PRIMARY KEY, company_name TEXT, address TEXT, city TEXT, ice TEXT, if_number TEXT, rc TEXT, cnss TEXT);
      INSERT INTO company_settings (id, company_name, ice, cnss) VALUES (1, 'Atlas Marbre SARL', '001234567000089', '9988776');
      CREATE TABLE employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT, emp_number TEXT, first_name TEXT, last_name TEXT, name TEXT, role_title TEXT,
        cnss_number TEXT, social_insurance TEXT, national_id TEXT, active INTEGER DEFAULT 1, pay_amount REAL DEFAULT 0,
        pay_cycle_type TEXT DEFAULT 'monthly', pay_cycle_days INTEGER DEFAULT 30,
        cnss_declared INTEGER DEFAULT 1, cnss_days REAL DEFAULT 26
      );
      INSERT INTO employees (emp_number, first_name, last_name, cnss_number, pay_amount, cnss_declared, cnss_days)
      VALUES ('EMP-001', 'Amal', 'Alaoui', '111', 5000, 1, 22),
             ('EMP-002', 'Badr', 'Bennani', '', 4000, 0, 0);
    `);
    const db = makeSqliteD1(sqlite);
    const app = new Hono<any>();
    registerPayrollRoutes(app as any, {
      requireEmployeeAdmin: async () => null,
      loadAttendanceRules: async () => ({
        enabled: true, late_threshold: '09:15', early_threshold: '18:00', overtime_after_hours: 8, overtime_multiplier: 1.25,
        pay_mode: 'presence', minute_deduct: false, warn_late_count: 3, blame_late_count: 6, workday_hours: 8,
      }),
      writeAudit: async () => {},
      sessionUserFromHeader: () => ({ username: 'owner', role: 'owner' }),
      clientIp: () => '127.0.0.1',
    });
    const call = (path: string, method = 'GET', body?: any) =>
      app.fetch(
        new Request(`http://test.local${path}`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
        { DB: db } as any,
      );
    return { call };
  }

  it('proposes the employee days, skips contributions when not declared, lets you edit days, and exports them', async () => {
    const { call } = setup();
    const created = await call('/api/payroll/runs', 'POST', { period_month: '2026-11' });
    expect(created.status).toBe(201);
    const run = ((await created.json()) as any).data;
    const amal = run.lines.find((l: any) => l.emp_number === 'EMP-001');
    const badr = run.lines.find((l: any) => l.emp_number === 'EMP-002');
    expect(amal.cnss_days).toBe(22);
    expect(amal.cnss_emp).toBeGreaterThan(0);
    expect(badr.cnss_days).toBe(0);
    expect(badr).toMatchObject({ cnss_base: 0, cnss_emp: 0, amo_emp: 0, cnss_employer: 0, amo_employer: 0 });
    expect(badr.employer_cost).toBe(badr.gross_salary);

    // Declare Badr for 13 days and fix his worked days → contributions come back.
    const patched = await call(`/api/payroll/runs/${run.id}/lines/${badr.id}`, 'PATCH', { cnss_days: 13, days_worked: 15 });
    expect(patched.status).toBe(200);
    const badr2 = ((await patched.json()) as any).data;
    expect(badr2).toMatchObject({ cnss_days: 13, days_worked: 15 });
    expect(badr2.cnss_emp).toBeGreaterThan(0);
    expect(badr2.amo_emp).toBeGreaterThan(0);

    // > 26 is clamped.
    const clamped = ((await (await call(`/api/payroll/runs/${run.id}/lines/${amal.id}`, 'PATCH', { cnss_days: 40 })).json()) as any).data;
    expect(clamped.cnss_days).toBe(26);

    const csv = await (await call(`/api/payroll/runs/${run.id}/declaration?format=csv`)).text();
    const [header, ...rows] = csv.split('\n');
    const cols = header.split(',');
    const idx = cols.indexOf('jours_cnss');
    expect(idx).toBe(cols.indexOf('jours') + 1);
    expect(rows.map((r) => r.split(',')[idx].replace(/"/g, ''))).toEqual(['26', '13', '39']);

    const xls = await (await call(`/api/payroll/runs/${run.id}/declaration?format=xls`)).text();
    expect(xls).toContain('Jours déclarés CNSS');
    expect(xls).toContain('Total jours déclarés CNSS');
  });
});
