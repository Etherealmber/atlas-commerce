import { afterEach, beforeEach, describe, expect, it } from 'vitest';
const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };
const { default: app } = await import('../index');

let sqlite: any, env: any;
const ip = '203.0.113.74';
function dbFor(database: any) {
  return {
    prepare(sql: string) {
      let args: any[] = [];
      const stmt: any = {
        bind(...values: any[]) { args = values; return stmt; },
        async first() { return database.prepare(sql).get(...args) || null; },
        async all() { return { results: database.prepare(sql).all(...args) }; },
        async run() { const r = database.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      };
      return stmt;
    },
    async batch(statements: any[]) { return Promise.all(statements.map(s => s.run())); },
  };
}
async function token() {
  const proof = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`proof|alice|admin|secret-alice|${ip}|none`)))).map(b => b.toString(16).padStart(2, '0')).join('');
  return btoa(`stock-auth-v2|alice|admin|${ip}|none|${proof}`);
}
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`CREATE TABLE app_users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT, password_salt TEXT DEFAULT '', role TEXT, active INTEGER DEFAULT 1, created_at TEXT);
    INSERT INTO app_users VALUES (1, 'alice', 'secret-alice', '', 'admin', 1, '2026-01-01 00:00:00');
    CREATE TABLE company_settings (id INTEGER PRIMARY KEY, company_name TEXT, currency TEXT, finance_timezone TEXT, report_footer TEXT, notes TEXT);
    INSERT INTO company_settings VALUES (1, 'Test Company', 'MAD', 'UTC', '', '');
    CREATE TABLE expenses (id INTEGER PRIMARY KEY, expense_date TEXT, entry_type TEXT, description TEXT, category TEXT, payment_method TEXT, amount REAL);
    INSERT INTO expenses VALUES (1,'2024-02-01','income','Sale','General','cash',100), (2,'2024-02-29','expense','Supplies','General','transfer',30), (3,'2024-03-01','expense','Outside period','General','cash',99);`);
  env = { DB: dbFor(sqlite), ADMIN_PASSWORD: 'OwnerPass123!' };
});
afterEach(() => sqlite.close());

describe('printable balance report compatibility', () => {
  it('renders the existing section totals and all inclusive period rows', async () => {
    const res = await app.fetch(new Request('http://test.local/api/reports/balance?period=2024-02', { headers: { Authorization: `Bearer ${await token()}`, 'CF-Connecting-IP': ip } }), env, {} as any);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Espèces entrées</div><div class="v in">+100');
    expect(html).toContain('Banque sorties</div><div class="v out">−30');
    expect(html).toContain('Sale');
    expect(html).toContain('Supplies');
    expect(html).not.toContain('Outside period');
  });
});
