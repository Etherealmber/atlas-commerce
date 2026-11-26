import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { registerCategoriesUnitsRoutes } from '../routes/categoriesUnits';
vi.mock('../lib/authHelpers', () => ({ sessionUserFromHeader: () => ({ username: 'admin', role: 'admin' }) }));
const sqliteModule = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(sqliteModule)) as { DatabaseSync: new (name: string) => any };
function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE product_categories (id INTEGER PRIMARY KEY, name TEXT UNIQUE, description TEXT DEFAULT '', sort_order INTEGER DEFAULT 0, name_fr TEXT DEFAULT '', name_en TEXT DEFAULT '', name_ar TEXT DEFAULT '');
  CREATE TABLE product_units (id INTEGER PRIMARY KEY, name TEXT UNIQUE, symbol TEXT DEFAULT '', sort_order INTEGER DEFAULT 0, name_fr TEXT DEFAULT '', name_en TEXT DEFAULT '', name_ar TEXT DEFAULT '');
  CREATE TABLE products (id INTEGER PRIMARY KEY, category TEXT, unit TEXT);`);
  const db: any = { prepare(sql: string) { let args: any[] = []; const stmt: any = {
    bind(...values: any[]) { args = values; return stmt; },
    async run() { const r = sqlite.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; },
    async first() { return sqlite.prepare(sql).get(...args) || null; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  }; return stmt; } };
  const app = new Hono<any>(); registerCategoriesUnitsRoutes(app, { ensureCategoriesTable: async () => {}, ensureUnitsTable: async () => {}, checkConfirmPassword: async () => ({ ok: true }) });
  const call = (url: string, method = 'GET', body?: unknown) => app.request(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, { DB: db });
  return { sqlite, call };
}
describe('multilingual catalog names', () => {
  it.each(['categories', 'units'])('saves names without changing canonical product reference for %s', async kind => {
    const { call, sqlite } = fixture();
    let r = await call(`/api/${kind}`, 'POST', { name: 'Carreau', name_fr: 'Carreau', name_en: 'Tile', name_ar: 'بلاط' });
    expect(r.status).toBe(201); const created: any = await r.json();
    sqlite.prepare('INSERT INTO products (category, unit) VALUES (?, ?)').run('Carreau', 'Carreau');
    r = await call(`/api/${kind}/${created.data.id}`, 'PUT', { name_en: 'Ceramic tile', name_ar: 'بلاط خزفي' });
    expect(r.status).toBe(200); const updated: any = await r.json();
    expect(updated.data).toMatchObject({ name: 'Carreau', name_fr: 'Carreau', name_en: 'Ceramic tile', name_ar: 'بلاط خزفي' });
    expect(sqlite.prepare('SELECT category, unit FROM products').get()).toMatchObject({ category: 'Carreau', unit: 'Carreau' });
    r = await call(`/api/${kind}/${created.data.id}`, 'PUT', { name_en: 'x'.repeat(81) });
    expect(r.status).toBe(400);
    r = await call(`/api/${kind}`, 'POST', { name: 'Legacy' });
    expect(r.status).toBe(201);
  });
});
