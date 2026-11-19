import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mintScopedReportTicket, reportTicketTtl, verifyScopedReportTicket } from '../lib/report-ticket';
const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };
const { default: app } = await import('../index');

let sqlite: any, env: any;
const ip = '203.0.113.77';
function dbFor(database: any) {
  return { prepare(sql: string) {
    let args: any[] = [];
    const stmt: any = {
      bind(...values: any[]) { args = values; return stmt; },
      async first() { return database.prepare(sql).get(...args) || null; },
      async all() { return { results: database.prepare(sql).all(...args) }; },
      async run() { const r = database.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    }; return stmt;
  }, async batch(stmts: any[]) { return Promise.all(stmts.map(s => s.run())); } };
}
async function token(user = 'alice', role = 'admin', proofRole = role) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`proof|${user}|${proofRole}|secret-${user}|${ip}|none`));
  const proof = [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
  return btoa(`stock-auth-v2|${user}|${role}|${ip}|none|${proof}`);
}
async function ownerToken() {
  const hex = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const material = await hex('owner-key|admin|OwnerPass123!');
  const proof = await hex(`proof|admin|owner|${material}|${ip}|none`);
  return btoa(`stock-auth-v2|admin|owner|${ip}|none|${proof}`);
}
async function request(path: string, authorization?: string) {
  return app.fetch(new Request(`http://test.local${path}`, { headers: { 'CF-Connecting-IP': ip, ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}) } }), env, {} as any);
}
async function ticket() {
  const response = await request('/api/reports/link-ticket', await token());
  expect(response.status).toBe(200);
  const json: any = await response.json();
  expect(json.data.expires_in).toBe(1800);
  return json.data.rt as string;
}
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE app_users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT, password_salt TEXT DEFAULT '', role TEXT, active INTEGER DEFAULT 1, created_at TEXT);
    INSERT INTO app_users VALUES (1,'alice','secret-alice','','admin',1,'2026-01-01'), (2,'bob','secret-bob','','stock',1,'2026-01-01');
    CREATE TABLE company_settings (id INTEGER PRIMARY KEY, company_name TEXT, currency TEXT, finance_timezone TEXT, report_footer TEXT, notes TEXT, tax_rate REAL, multi_warehouse INTEGER, sales_location_id INTEGER, purchase_location_id INTEGER);
    INSERT INTO company_settings VALUES (1,'Company','MAD','UTC','','',20,1,NULL,NULL);
    CREATE TABLE expenses (id INTEGER PRIMARY KEY, expense_date TEXT, entry_type TEXT, description TEXT, category TEXT, payment_method TEXT, amount REAL);
    INSERT INTO expenses VALUES (1,'2024-02-10','income','Sale & sample','Sales','cash',100.25);
    CREATE TABLE stock_locations (id INTEGER PRIMARY KEY, code TEXT, name TEXT, is_default INTEGER, is_active INTEGER);
    INSERT INTO stock_locations VALUES (1,'A','Main store',1,1);
    CREATE TABLE stock_location_qty (location_id INTEGER, product_id INTEGER, quantity REAL, PRIMARY KEY(location_id,product_id));
    CREATE TABLE products (id INTEGER PRIMARY KEY, sku TEXT, name TEXT, category TEXT, cost REAL, price REAL, stock_quantity REAL, track_inventory INTEGER, low_stock_threshold REAL, is_active INTEGER);
    INSERT INTO products VALUES (1,'SKU01','Marble slab','Stone',10.25,20.50,3.5,1,1,1);
    CREATE TABLE invoices (id INTEGER PRIMARY KEY, number TEXT, client_name TEXT, issue_date TEXT, due_date TEXT, total REAL, amount_paid REAL, status TEXT, doc_kind TEXT);
    INSERT INTO invoices VALUES (1,'INV01','Client Alice','2024-02-12','2024-03-01',120.5,10,'sent','invoice');
    CREATE TABLE invoice_items (invoice_id INTEGER, tax_rate REAL, line_total REAL, quantity REAL, unit_price REAL);
    INSERT INTO invoice_items VALUES (1,20,120.5,1,100.4167);
    CREATE TABLE bills (id INTEGER PRIMARY KEY, number TEXT, vendor_name TEXT, issue_date TEXT, due_date TEXT, total REAL, amount_paid REAL, status TEXT);
    INSERT INTO bills VALUES (1,'BILL01','Supplier','2024-02-12','2024-03-01',50.25,0,'sent');
    CREATE TABLE employees (id INTEGER PRIMARY KEY, emp_number TEXT, first_name TEXT, last_name TEXT, role_title TEXT, pay_amount REAL, pay_cycle_type TEXT, pay_cycle_days INTEGER, last_paid_at TEXT, active INTEGER, joined_date TEXT);
    INSERT INTO employees VALUES (1,'EMP01','Fatima','Example','Manager',4500.5,'month',30,'2024-02-01',1,'2023-01-01');
  `);
  env = { DB: dbFor(sqlite), ADMIN_PASSWORD: 'OwnerPass123!', JWT_SECRET: 'unique-test-secret' };
});
afterEach(() => { vi.useRealTimers(); sqlite.close(); });

describe('finance report viewing', () => {
  it('requires an authoritative owner/admin session to issue a narrowly scoped ticket', async () => {
    expect((await request('/api/reports/link-ticket')).status).toBe(401);
    expect((await request('/api/reports/link-ticket', await token('bob', 'stock'))).status).toBe(403);
    expect((await request('/api/print/link-ticket', await token('bob', 'stock'))).status).toBe(403);
    const printRes = await request('/api/print/link-ticket', await token());
    expect(printRes.status).toBe(200);
    expect(printRes.headers.get('cache-control')).toContain('no-store');
    const printRt = (await printRes.json() as any).data.rt;
    expect((await request(`/api/reports/balance?rt=${printRt}`)).status).toBe(401);
    expect((await request('/api/reports/link-ticket', await token('bob', 'admin', 'stock'))).status).toBe(401);
    const ownerRes = await request('/api/reports/link-ticket', await ownerToken());
    expect(ownerRes.status).toBe(200);
    const ownerRt = (await ownerRes.json() as any).data.rt;
    expect((await request(`/api/reports/balance?rt=${ownerRt}`)).status).toBe(200);
    const rt = await ticket();
    expect((await request(`/api/reports/link-ticket?rt=${rt}`)).status).toBe(401);
    expect((await request(`/api/invoices/1/print?rt=${rt}`)).status).toBe(401);
    expect((await request(`/api/reports/unknown?rt=${rt}`)).status).toBe(404);
    const mutation = await app.fetch(new Request(`http://test.local/api/reports/balance?rt=${rt}`, { method: 'POST', headers: { 'CF-Connecting-IP': ip } }), env, {} as any);
    expect(mutation.status).toBe(403);
    expect((await request('/api/reports/balance?rt=forged')).status).toBe(401);
    sqlite.exec("UPDATE app_users SET role='stock' WHERE username='alice'");
    expect((await request(`/api/reports/balance?rt=${rt}`)).status).toBe(401);
  });
  it('bounds configurable expiry, checks signature before expiry and isolates account/tenant', async () => {
    const ident = { username: 'alice', role: 'admin' as const, userId: 1, tenant: 'main' };
    env.REPORT_TICKET_TTL_SECONDS = '60';
    const issued = await mintScopedReportTicket(env, ident, 'owner', 1000000);
    expect(issued.expires_in).toBe(60);
    expect(await verifyScopedReportTicket(env, issued.rt, 'owner', 1059000)).toBe('ok');
    expect(await verifyScopedReportTicket(env, issued.rt, 'owner', 1060000)).toBe('expired');
    expect(await verifyScopedReportTicket({ ...env, JWT_SECRET: 'different' }, issued.rt, 'owner', 1059000)).toBe('invalid');
    sqlite.exec("UPDATE app_users SET password_hash='new' WHERE username='alice'");
    expect(await verifyScopedReportTicket(env, issued.rt, 'owner', 1059000)).toBe('invalid');
    await expect(mintScopedReportTicket(env, { ...ident, tenant: 'other' }, 'owner')).rejects.toThrow();
    sqlite.exec("UPDATE app_users SET password_hash='secret-alice' WHERE username='alice'");
    env.REPORT_TICKET_TTL_SECONDS = '1801';
    expect(() => reportTicketTtl(env)).toThrow();
    expect((await request('/api/reports/link-ticket', await token())).status).toBe(503);
    env.REPORT_TICKET_TTL_SECONDS = '30'; env.JWT_SECRET = ''; env.ADMIN_PASSWORD = '';
    expect((await request('/api/reports/link-ticket', await token())).status).toBe(503);
  });
  it('returns expiry errors and does not accept a ticket for a different company database', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T12:00:00Z'));
    env.REPORT_TICKET_TTL_SECONDS = '1';
    const issued: any = await (await request('/api/reports/link-ticket', await token())).json();
    const rt = issued.data.rt;
    const other = new DatabaseSync(':memory:');
    other.exec(`CREATE TABLE app_users (id INTEGER PRIMARY KEY, username TEXT, role TEXT, password_hash TEXT, active INTEGER);
      INSERT INTO app_users VALUES (1,'alice','admin','different-password-hash',1);`);
    const original = env.DB;
    env.DB = dbFor(other);
    expect((await request(`/api/reports/balance?rt=${rt}`)).status).toBe(401);
    env.DB = original;
    other.close();
    vi.advanceTimersByTime(1000);
    const expired = await request(`/api/reports/balance?rt=${rt}`);
    expect(expired.status).toBe(401);
    expect(await expired.json()).toMatchObject({ code: 'TICKET_EXPIRED' });
  });
  it('renders all employees and retains only selected sections', async () => {
    for (let i = 2; i <= 65; i++) sqlite.prepare('INSERT INTO employees VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(i, `E${i}`, `Person${i}`, 'Example', 'Staff', 10, 'month', 30, null, 1, '2024-01-01');
    const rt = await ticket();
    const res = await request(`/api/reports/combined?rt=${rt}&sections=employees,balance&period=2024-02`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Person65 Example');
    expect(html).toContain('Sale &amp; sample');
    expect(html).not.toContain('Marble slab');
    expect(html).not.toContain('Récapitulatif TVA');
  });
  it('renders every section and a full combined page without JavaScript', async () => {
    const rt = await ticket();
    const sections: Record<string,string> = { balance: 'Sale &amp; sample', stock: 'Marble slab', receivables: 'Client Alice', payables: 'Supplier', employees: 'Fatima Example', 'aging.html': 'INV01', 'tva.html': 'Ventes par taux' };
    for (const [path, content] of Object.entries(sections)) {
      const response = await request(`/api/reports/${path}?rt=${rt}&period=2024-02`);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(response.headers.get('referrer-policy')).toBe('no-referrer');
      expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
      expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
      const html = await response.text();
      expect(html, path).toContain(content);
      expect(html).toContain('name="viewport"');
      expect(html).toContain('@media print');
      expect(html).not.toMatch(/<script\b|onclick=/i);
    }
    const combined = await request(`/api/reports/combined?rt=${rt}&period=2024-02`);
    expect(combined.status).toBe(200);
    const html = await combined.text();
    for (const text of Object.values(sections)) expect(html).toContain(text);
    expect(html).toContain('100,25');
    expect(html).not.toMatch(/<script\b|onclick=/i);
    expect((await request(`/api/reports/combined?rt=${rt}&sections=secret`)).status).toBe(400);
  });
  it('returns a generation failure instead of an apparently empty report', async () => {
    const rt = await ticket();
    sqlite.exec('DROP TABLE employees');
    const response = await request(`/api/reports/combined?rt=${rt}`);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ success: false, code: 'REPORT_GENERATION_FAILED' });
  });
});
