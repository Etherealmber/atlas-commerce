import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
vi.mock('../lib/reliability', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/reliability')>(),
  proactiveFtsHealth: async () => {}, ensureProductSearchIndex: async () => false,
}));
import { readFileSync } from 'node:fs';
const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };
const { default: app } = await import('../index');

let sqlite: any, env: any;
const ip = '203.0.113.141';
const pragmaCalls: string[] = [];
function dbFor(database: any) {
  return {
    prepare(sql: string) {
      if (/PRAGMA table_info\(products\)/.test(sql)) pragmaCalls.push(sql);
      let args: any[] = [];
      const stmt: any = {
        bind(...a: any[]) { args = a; return stmt; },
        async first() { return database.prepare(sql).get(...args) || null; },
        async all() { return { results: database.prepare(sql).all(...args) }; },
        async run() { const r = database.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      };
      return stmt;
    },
    async batch(stmts: any[]) { return Promise.all(stmts.map(s => s.run())); },
  };
}
async function sha256(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function token(username: string, role: string) {
  const material = username === 'admin' ? await sha256('owner-key|admin|OwnerPass123!') : `secret-${username}`;
  const proof = await sha256(`proof|${username}|${role}|${material}|${ip}|none`);
  return btoa(`stock-auth-v2|${username}|${role}|${ip}|none|${proof}`);
}
async function call(path: string, t?: string, method = 'GET', body?: unknown) {
  return app.fetch(new Request(`http://test.local${path}`, { method, headers: { 'CF-Connecting-IP': ip, ...(t ? { Authorization: `Bearer ${t}` } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, {} as any);
}
beforeAll(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'));
  sqlite.exec(`CREATE TABLE app_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT, password_salt TEXT DEFAULT '', role TEXT, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
    INSERT INTO app_users (username,password_hash,role) VALUES ('alice','secret-alice','stock'), ('bob','secret-bob','stock');`);
  env = { DB: dbFor(sqlite), ADMIN_PASSWORD: 'OwnerPass123!', EMAIL: { send: async () => ({}) } };
});
afterAll(() => sqlite.close());

describe('light product list on a brand-new database (demo sandbox, fresh install)', () => {
  it('serves the light list and the barcode scan FIRST, before any full route added the variant columns', async () => {
    const cols = () => (sqlite.prepare('PRAGMA table_info(products)').all() as { name: string }[]).map((c) => c.name);
    expect(cols()).not.toContain('parent_id');
    sqlite.exec("INSERT INTO products (name,sku,barcode,stock_quantity,low_stock_threshold) VALUES ('Fresh item','FRESH-1','555000111',2,5)");
    const t = await token('alice', 'stock');
    const list = await call('/api/products?include_variants=1&fields=light', t);
    expect(list.status).toBe(200);
    const body: any = await list.json();
    expect(body.data.find((p: any) => p.sku === 'FRESH-1')).toMatchObject({ stock_quantity: 2, low_stock_threshold: 5 });
    expect(cols()).toEqual(expect.arrayContaining(['parent_id', 'variant_label', 'tax_rate']));
    const scan = await call('/api/scan/barcode/555000111', t);
    expect(scan.status).toBe(200);
    expect(((await scan.json()) as any).data).toMatchObject({ sku: 'FRESH-1' });
  });

  it('then answers repeat light calls without a PRAGMA per request', async () => {
    const t = await token('alice', 'stock');
    const before = pragmaCalls.length;
    for (const q of ['?fields=light&q=fresh', '?fields=light&q=item', '?fields=mobile&category=x']) {
      expect((await call(`/api/products${q}`, t)).status).toBe(200);
    }
    expect(pragmaCalls.length).toBe(before);
  });
});
