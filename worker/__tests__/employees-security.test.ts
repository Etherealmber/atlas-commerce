import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { registerEmployeeRoutes } from '../routes/employees';
import { verifyArchiveIdentity } from '../lib/finance-report-archive-validation';

const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = await import(SQLITE_MODULE) as { DatabaseSync: new (path: string) => any };
function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  const db = { prepare(sql: string) {
    let params: any[] = [];
    const api: any = {
      bind(...args: any[]) { params = args; return api; },
      async run() { const r = sqlite.prepare(sql).run(...params); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      async first() { return sqlite.prepare(sql).get(...params) || null; },
      async all() { return { results: sqlite.prepare(sql).all(...params) }; },
    }; return api;
  } };
  sqlite.exec(`CREATE TABLE app_users (id INTEGER PRIMARY KEY, username TEXT, role TEXT, active INTEGER);
    INSERT INTO app_users VALUES (1, 'admin', 'admin', 1), (2, 'stock', 'stock', 1);`);
  return { sqlite, db };
}
function setup() {
  const { sqlite, db } = makeDb();
  const app: any = new Hono();
  registerEmployeeRoutes(app, { requireEmployeeAdmin: async (c: any) => {
    const result = await verifyArchiveIdentity(c.env, c.req.header('Authorization'), '', '', {
      authFailReason: async (h) => h ? 'ok' : 'missing',
      sessionUserFromHeader: (h) => {
        const [username = '', role = ''] = String(h || '').replace('Bearer ', '').split(':');
        return { username, role };
      },
      ownerUsername: () => 'owner',
    });
    return result.ok ? null : c.json({ code: result.code }, result.status);
  } });
  const request = (path: string, method = 'GET', token?: string, body: any = {}) => app.request(path, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
  }, { DB: db });
  return { sqlite, request };
}

const routes = [
  ['GET', '/api/employees'], ['POST', '/api/employees'], ['GET', '/api/employees/999'],
  ['PUT', '/api/employees/999'], ['DELETE', '/api/employees/999'], ['POST', '/api/employees/999/resign'],
  ['POST', '/api/employees/999/reactivate'], ['POST', '/api/employees/parse-id'],
  ['GET', '/api/employees/999/id-document'], ['POST', '/api/employees/999/id-document'],
  ['POST', '/api/employees/999/advance'], ['POST', '/api/employees/999/pay'],
];
describe('employee route security (single D1)', () => {
  it.each(routes)('%s %s authenticates and revalidates role before any data access', async (method, path) => {
    const { request } = setup();
    expect((await request(path, method)).status).toBe(401);
    expect((await request(path, method, 'stock:stock')).status).toBe(403);
    expect((await request(path, method, 'stock:admin')).status).toBe(401);
  });
  it('uses the current database, not tenant input; unknown IDs return 404 in both isolated databases', async () => {
    const a = setup(), b = setup();
    for (const [instance, token] of [[a, 'admin:admin'], [b, 'owner:owner']] as const) {
      expect((await instance.request('/api/employees', 'POST', token, { name: 'Alice', emp_number: 'E1', tenant_id: 'other' })).status).toBe(201);
      for (const [method, path] of routes.filter(([_, path]) => path.includes('/999'))) {
        expect((await instance.request(path, method, token)).status).toBe(404);
      }
    }
    expect((await a.request('/api/employees', 'POST', 'admin:admin', { name: 'Only A', emp_number: 'E2' })).status).toBe(201);
    for (const [method, path] of routes.filter(([_, path]) => path.includes('/999'))) {
      expect((await b.request(path.replace('/999', '/2'), method, 'admin:admin', { tenant_id: 'a', role: 'owner' })).status).toBe(404);
    }
    expect(a.sqlite.prepare('SELECT name FROM employees WHERE id=2').get().name).toBe('Only A');
    // Separate databases can have overlapping IDs; they are NOT shared-DB tenants.
    expect(a.sqlite.prepare('SELECT COUNT(*) n FROM employees').get().n).toBe(2);
    expect(b.sqlite.prepare('SELECT COUNT(*) n FROM employees').get().n).toBe(1);
  });
  it('never settles on resignation and protects history against cascading deletion', async () => {
    const { request, sqlite } = setup();
    expect((await request('/api/employees', 'POST', 'admin:admin', { name: 'Alice', emp_number: 'E1', pay_amount: 100 })).status).toBe(201);
    sqlite.exec("INSERT INTO employee_payments (employee_id, amount, paid_at) VALUES (1, 10, '2026-01-01')");
    expect((await request('/api/employees/1', 'DELETE', 'admin:admin')).status).toBe(400);
    const r = await request('/api/employees/1/resign', 'POST', 'owner:owner', { settle_pay: true, amount: 500, pay_amount: 800 });
    expect(r.status).toBe(200);
    expect(sqlite.prepare('SELECT active, pay_amount, last_paid_at FROM employees WHERE id=1').get()).toMatchObject({ active: 0, pay_amount: 100, last_paid_at: null });
    expect(sqlite.prepare('SELECT COUNT(*) n FROM employee_payments').get().n).toBe(1);
    expect((await request('/api/employees/1', 'DELETE', 'admin:admin')).status).toBe(409);
    expect(sqlite.prepare('SELECT COUNT(*) n FROM employee_payments').get().n).toBe(1);
    expect((await request('/api/employees/1/reactivate', 'POST', 'admin:admin')).status).toBe(200);
    expect((await request('/api/employees/1', 'DELETE', 'admin:admin')).status).toBe(400);
    expect((await request('/api/employees', 'POST', 'admin:admin', { name: 'Bob', emp_number: 'E2' })).status).toBe(201);
    expect((await request('/api/employees/2/resign', 'POST', 'admin:admin')).status).toBe(200);
    expect((await request('/api/employees/2', 'DELETE', 'admin:admin')).status).toBe(200);
  });
});
