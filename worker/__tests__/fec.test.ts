/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { registerFecRoutes } from '../routes/fec';

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

function setupFecApp() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now')), username TEXT, role TEXT, action TEXT, entity TEXT, entity_id TEXT, detail TEXT, ip TEXT);
    CREATE TABLE company_settings (id INTEGER PRIMARY KEY, company_name TEXT, ice TEXT, if_number TEXT, rc TEXT, currency TEXT);
    INSERT INTO company_settings (id, company_name, ice, if_number, currency) VALUES (1, 'Atlas Marbre', '001234567000089', '40123456', 'MAD');
    CREATE TABLE clients (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO clients (id, name) VALUES (1, 'Client Alpha');
    CREATE TABLE vendors (id INTEGER PRIMARY KEY, name TEXT);
    INSERT INTO vendors (id, name) VALUES (1, 'Fournisseur Beta');
    CREATE TABLE invoices (id INTEGER PRIMARY KEY, invoice_number TEXT, issue_date TEXT, subtotal REAL, tax_amount REAL, total REAL, status TEXT, doc_kind TEXT, client_id INTEGER, created_at TEXT);
    INSERT INTO invoices (id, invoice_number, issue_date, subtotal, tax_amount, total, status, doc_kind, client_id) VALUES (1, 'FAC-2026-001', '2026-11-10', 1000, 200, 1200, 'paid', 'invoice', 1);
    CREATE TABLE bills (id INTEGER PRIMARY KEY, bill_number TEXT, issue_date TEXT, subtotal REAL, tax_amount REAL, total REAL, status TEXT, vendor_id INTEGER, vendor_name TEXT, created_at TEXT);
    INSERT INTO bills (id, bill_number, issue_date, subtotal, tax_amount, total, status, vendor_id) VALUES (1, 'ACH-2026-001', '2026-11-11', 500, 100, 600, 'paid', 1);
    CREATE TABLE invoice_payments (id INTEGER PRIMARY KEY, invoice_id INTEGER, amount REAL, payment_method TEXT, paid_at TEXT, reference TEXT, created_at TEXT);
    INSERT INTO invoice_payments (id, invoice_id, amount, payment_method, paid_at, reference) VALUES (1, 1, 1200, 'bank', '2026-11-12', 'VIR-101');
    CREATE TABLE expenses (id INTEGER PRIMARY KEY, entry_type TEXT, amount REAL, payment_method TEXT, reference TEXT, description TEXT, expense_date TEXT, created_at TEXT);
    INSERT INTO expenses (id, entry_type, amount, payment_method, reference, description, expense_date) VALUES (1, 'expense', 150, 'cash', 'EXP-1', 'Fournitures', '2026-11-13');
    CREATE TABLE payroll_runs (id INTEGER PRIMARY KEY, period_month TEXT);
    INSERT INTO payroll_runs (id, period_month) VALUES (1, '2026-11');
    CREATE TABLE payroll_lines (id INTEGER PRIMARY KEY, run_id INTEGER, gross_salary REAL, cnss_emp REAL, amo_emp REAL, cnss_employer REAL, amo_employer REAL, igr REAL, net_salary REAL, advances_deducted REAL);
    INSERT INTO payroll_lines (id, run_id, gross_salary, cnss_emp, amo_emp, cnss_employer, amo_employer, igr, net_salary, advances_deducted) VALUES (1, 1, 5000, 224, 113, 849, 205.5, 100, 4563, 0);
  `);

  const db = makeSqliteD1(sqlite);
  const app = new Hono<any>();
  registerFecRoutes(app as any, {
    requireOwner: (c) => {
      const role = c.req.header('Authorization')?.replace('Bearer ', '') || '';
      if (role !== 'owner') {
        return { ok: false, response: c.json({ success: false, error: 'Owner only' }, 403) };
      }
      return { ok: true, username: 'owner-user', role: 'owner' };
    },
    writeAudit: async (database, entry) => {
      await database
        .prepare(`INSERT INTO audit_log (username, role, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(entry.username || '', entry.role || '', entry.action, entry.entity || '', entry.entity_id || '', entry.detail || '')
        .run();
    },
    clientIp: () => '127.0.0.1',
  });
  return { app, env: { DB: db }, sqlite };
}

describe('Part 5 — FEC-style accounting export', () => {
  it('blocks non-owners, edits PCGE chart of accounts, previews balanced journals, exports ZIP with FEC + balance + manifest, and audits export', async () => {
    const { app, env, sqlite } = setupFecApp();

    // Non-owner blocked
    const denied = await app.fetch(
      new Request('http://test.local/api/accounting/fec/preview?from=2026-11-01&to=2026-11-30', {
        headers: { Authorization: 'Bearer admin' },
      }),
      env as any,
    );
    expect(denied.status).toBe(403);

    // Update chart of accounts
    const accPut = await app.fetch(
      new Request('http://test.local/api/accounting/accounts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
        body: JSON.stringify({ accounts: [{ account_key: 'sales_revenue', code: '711100', label: 'Ventes marbre Maroc' }] }),
      }),
      env as any,
    );
    expect(accPut.status).toBe(200);

    // Preview balanced across VE, AC, BQ, CA, PA
    const prevRes = await app.fetch(
      new Request('http://test.local/api/accounting/fec/preview?from=2026-11-01&to=2026-11-30', {
        headers: { Authorization: 'Bearer owner' },
      }),
      env as any,
    );
    expect(prevRes.status).toBe(200);
    const prev = ((await prevRes.json()) as any).data;
    expect(prev.balanced).toBe(true);
    expect(prev.total_debit).toBe(prev.total_credit);
    expect(prev.journals.map((j: any) => j.code)).toEqual(expect.arrayContaining(['VE', 'AC', 'BQ', 'CA', 'PA']));

    // Export ZIP (PK\x03\x04) containing FEC CSV, balance control CSV, and manifest.json
    const zipRes = await app.fetch(
      new Request('http://test.local/api/accounting/fec/export?from=2026-11-01&to=2026-11-30', {
        headers: { Authorization: 'Bearer owner' },
      }),
      env as any,
    );
    expect(zipRes.status).toBe(200);
    expect(zipRes.headers.get('Content-Type')).toBe('application/zip');
    const bytes = new Uint8Array(await zipRes.arrayBuffer());
    expect(bytes[0]).toBe(0x50); // P
    expect(bytes[1]).toBe(0x4b); // K
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('JournalCode|JournalLib|EcritureNum');
    expect(text).toContain('711100|Ventes marbre Maroc');
    expect(text).toContain('balance_controle_2026-11-01_2026-11-30.csv');
    expect(text).toContain('manifest.json');

    const audits = sqlite.prepare(`SELECT action FROM audit_log WHERE entity = 'accounting'`).all() as any[];
    expect(audits.map((a) => a.action)).toContain('accounting.fec_export');
  });
});
