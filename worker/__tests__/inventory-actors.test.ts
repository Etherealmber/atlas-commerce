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
const ip = '203.0.113.105';
function dbFor(database: any) {
  return {
    prepare(sql: string) {
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

describe('inventory actor responses', () => {
  it('requires normal authentication', async () => {
    expect((await call('/api/products')).status).toBe(401);
    expect((await call('/api/stock/movements')).status).toBe(401);
  });
  it('returns explicit unknown actors before the optional columns have been added', async () => {
    sqlite.exec("INSERT INTO products (name,sku,barcode) VALUES ('Legacy pre-migration','LEGACY-PRE','987650000')");
    const id = sqlite.prepare("SELECT id FROM products WHERE sku='LEGACY-PRE'").get().id;
    const t = await token('alice', 'stock');
    expect((await (await call(`/api/products/${id}`, t)).json() as any).data).toMatchObject({ created_by: null, approved_by: null });
    expect((await (await call('/api/scan/barcode/987650000', t)).json() as any).data).toMatchObject({ created_by: null, approved_by: null });
    const list: any = await (await call('/api/products?fields=mobile', t)).json();
    expect(list.data.find((p: any) => p.id === id)).toMatchObject({ created_by: null, approved_by: null });
  });
  it('records authenticated product creator, ignores spoofed fields, and returns it in mobile/detail/scan', async () => {
    const t = await token('alice', 'stock');
    const r = await call('/api/products', t, 'POST', { name: 'Actor test', sku: 'ACTOR-1', barcode: '987650001', created_by: 'forged', approved_by: 'forged', stock_quantity: 0 });
    expect(r.status).toBe(201);
    const created: any = (await r.json() as any).data;
    expect(created).toMatchObject({ created_by: 'alice', approved_by: null });
    const detail: any = await (await call(`/api/products/${created.id}`, t)).json();
    expect(detail.data).toMatchObject({ created_by: 'alice', approved_by: null });
    const list: any = await (await call('/api/products?fields=mobile', t)).json();
    expect(list.data.find((x: any) => x.id === created.id)).toMatchObject({ created_by: 'alice', approved_by: null });
    const scan: any = await (await call('/api/scan/barcode/987650001', t)).json();
    expect(scan.data).toMatchObject({ created_by: 'alice', approved_by: null });
    expect((await call(`/api/products/${created.id}`, t, 'PUT', { name: 'Actor updated', created_by: 'bob', approved_by: 'bob' })).status).toBe(200);
    const updated: any = await (await call(`/api/products/${created.id}`, t)).json();
    expect(updated.data).toMatchObject({ created_by: 'alice', approved_by: null });
  });
  it('includes product artwork in the light mobile projection without weakening role redaction', async () => {
    sqlite.exec("INSERT INTO products (name, sku, image_url, price) VALUES ('Picture item', 'PIC-1', '/cdn/products/picture.webp', 42)");
    const stock = await token('alice', 'stock');
    const list: any = await (await call('/api/products?fields=mobile&q=PIC-1', stock)).json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0].image_url).toBe('/cdn/products/picture.webp');
    expect(list.data[0]).not.toHaveProperty('price');
    const inlineImage = `data:image/png;base64,${'A'.repeat(262145)}`;
    sqlite.prepare('UPDATE products SET image_url = ? WHERE sku = ?').run(inlineImage, 'PIC-1');
    const large: any = await (await call('/api/products?fields=mobile&q=PIC-1', stock)).json();
    expect(large.data[0]).toMatchObject({ image_url: null, image_inline_large: 1 });
    const detail: any = await (await call(`/api/products/${large.data[0].id}`, stock)).json();
    expect(detail.data.image_url).toBe(inlineImage);
    expect(detail.data).not.toHaveProperty('price');
  });
  it('preserves role-based price redaction on a cached mobile product list', async () => {
    const owner = await token('admin', 'owner'), stock = await token('alice', 'stock');
    const first: any = await (await call('/api/products?fields=mobile', owner)).json();
    expect(first.data[0]).toHaveProperty('price');
    const cached: any = await (await call('/api/products?fields=mobile', stock)).json();
    expect(cached.meta.cache).toBe('hit');
    expect(cached.data[0]).not.toHaveProperty('price');
    expect(cached.data[0]).toHaveProperty('created_by', 'alice');
  });
  it('attributes quick scan products and variants to the actual creating session', async () => {
    const t = await token('bob', 'stock');
    const q: any = await (await call('/api/scan/quick-product', t, 'POST', { barcode: '987650002', name: 'Scan creator', created_by: 'fake' })).json();
    expect(q.data).toMatchObject({ created_by: 'bob', approved_by: null });
    const v = await call(`/api/products/${q.data.id}/variants`, t, 'POST', { variant_label: 'Large', created_by: 'fake' });
    expect(v.status).toBe(201);
    expect((await v.json() as any).data).toMatchObject({ created_by: 'bob', approved_by: null });
  });
  it('returns unknown for legacy product and movement actors', async () => {
    sqlite.exec("INSERT INTO products (name, sku) VALUES ('Old item','OLD-1'); INSERT INTO stock_movements (product_id,type,quantity) VALUES (last_insert_rowid(),'adjustment',1);");
    const id = sqlite.prepare("SELECT id FROM products WHERE sku='OLD-1'").get().id;
    const t = await token('alice', 'stock');
    expect((await (await call(`/api/products/${id}`, t)).json() as any).data).toMatchObject({ created_by: null, approved_by: null });
    const movements: any = await (await call(`/api/products/${id}/movements?full=1`, t)).json();
    expect(movements.data[0]).toMatchObject({ created_by: null, approved_by: null });
  });
  it('preserves report receipt and returns linked GitHub status using only server credentials', async () => {
    sqlite.exec("UPDATE app_users SET created_at='2000-01-01 00:00:00' WHERE username='alice'");
    env.GITHUB_ISSUE_TOKEN = 'secret-github-token'; env.GITHUB_ISSUE_REPO = 'Org/repo'; env.WORK_STATUS_GITHUB_ENABLED = 'true';
    const remote = vi.fn(async (url: string, init: any) => {
      expect(init.headers.Authorization).toBe('Bearer secret-github-token');
      if (url.endsWith('/labels')) return new Response('{}', { status: 422 });
      if (url.endsWith('/issues') && init.method === 'POST') return Response.json({ number: 42, html_url: 'https://github.com/Org/repo/issues/42' }, { status: 201 });
      if (url.endsWith('/issues/42')) return Response.json({ number: 42, title: 'Bug fix', state: 'open', updated_at: '2026-11-15T00:00:00Z', html_url: 'https://github.com/Org/repo/issues/42' });
      throw new Error('unexpected request');
    });
    vi.stubGlobal('fetch', remote);
    try {
      const t = await token('alice', 'stock');
      const result = await call('/api/reports', t, 'POST', { kind: 'bug', message: 'A real reported problem' });
      expect(result.status).toBe(201);
      const receipt: any = await result.json();
      expect(receipt.data).toEqual({ reference: 'R-1', issue_url: 'https://github.com/Org/repo/issues/42', already_reported: false, issue_status: null });
      const status: any = await (await call('/api/mobile/work-status', t)).json();
      expect(status.trackers.github.items).toEqual([{ source: 'github', id: '42', title: 'Bug fix', status: 'open', updated_at: '2026-11-15T00:00:00Z', url: 'https://github.com/Org/repo/issues/42' }]);
      expect(JSON.stringify(status)).not.toContain('secret-github-token');
      const other: any = await (await call('/api/mobile/work-status', await token('bob', 'stock'))).json();
      expect(other.trackers.github.items).toEqual([]);
    } finally { vi.unstubAllGlobals(); delete env.GITHUB_ISSUE_TOKEN; delete env.GITHUB_ISSUE_REPO; delete env.WORK_STATUS_GITHUB_ENABLED; }
  });
  it('automatically finds new owner reports using anonymous public GitHub reads', async () => {
    env.GITHUB_ISSUE_TOKEN = 'server-only'; env.GITHUB_ISSUE_REPO = 'Org/repo';
    const remote = vi.fn(async (url: string, init: any) => {
      if (init.method === 'POST') {
        expect(init.headers.Authorization).toBe('Bearer server-only');
        return url.endsWith('/labels') ? new Response('{}', { status: 422 }) : Response.json({ number: 43, html_url: 'https://github.com/Org/repo/issues/43' }, { status: 201 });
      }
      expect(init.headers.Authorization).toBeUndefined();
      if (url === 'https://api.github.com/repos/Org/repo') return Response.json({ private: false, full_name: 'Org/repo', visibility: 'public' });
      if (url.endsWith('/issues/43')) return Response.json({ number: 43, title: 'Owner bug', state: 'closed', updated_at: '2026-11-15T00:00:00Z', html_url: 'https://github.com/Org/repo/issues/43' });
      throw new Error('unexpected');
    });
    vi.stubGlobal('fetch', remote);
    try {
      const owner = await token('admin', 'owner');
      const r = await call('/api/reports', owner, 'POST', { message: 'Owner reported problem' });
      expect(r.status).toBe(201);
      const status: any = await (await call('/api/mobile/work-status', owner)).json();
      expect(status.trackers.github.items).toEqual([{ source: 'github', id: '43', title: 'Owner bug', status: 'closed', updated_at: '2026-11-15T00:00:00Z', url: 'https://github.com/Org/repo/issues/43' }]);
      const bob: any = await (await call('/api/mobile/work-status', await token('bob', 'stock'))).json();
      expect(bob.trackers.github.items).toEqual([]);
    } finally { vi.unstubAllGlobals(); delete env.GITHUB_ISSUE_TOKEN; delete env.GITHUB_ISSUE_REPO; }
  });
  it('binds the original account before delivery even if its username is recreated during the GitHub call', async () => {
    sqlite.exec("INSERT INTO app_users (username,password_hash,role) VALUES ('dave','secret-dave','stock')");
    const oldId = sqlite.prepare("SELECT id FROM app_users WHERE username='dave'").get().id;
    env.GITHUB_ISSUE_TOKEN = 'key'; env.GITHUB_ISSUE_REPO = 'Org/repo'; env.WORK_STATUS_GITHUB_ENABLED = 'true';
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      if (init.method === 'POST' && url.endsWith('/labels')) return new Response('{}', { status: 422 });
      if (init.method === 'POST' && url.endsWith('/issues')) {
        sqlite.exec("DELETE FROM app_users WHERE username='dave'; INSERT INTO app_users (username,password_hash,role,created_at) VALUES ('dave','secret-dave','stock','2000-01-01 00:00:00')");
        return Response.json({ number: 44, html_url: 'https://github.com/Org/repo/issues/44' }, { status: 201 });
      }
      throw new Error('issue must not be fetched for the recreated user');
    }));
    try {
      const t = await token('dave', 'stock');
      const report: any = await (await call('/api/reports', t, 'POST', { message: 'Report during replacement' })).json();
      const id = Number(report.data.reference.slice(2));
      expect(sqlite.prepare('SELECT user_id FROM work_status_report_owners WHERE report_id=?').get(id).user_id).toBe(oldId);
      expect(sqlite.prepare("SELECT id FROM app_users WHERE username='dave'").get().id).not.toBe(oldId);
      const status: any = await (await call('/api/mobile/work-status', t)).json();
      expect(status.trackers.github.items).toEqual([]);
    } finally { vi.unstubAllGlobals(); delete env.GITHUB_ISSUE_TOKEN; delete env.GITHUB_ISSUE_REPO; delete env.WORK_STATUS_GITHUB_ENABLED; }
  });
  it('deduplicates a report before creating an issue and checks open, closed and unavailable status', async () => {
    env.GITHUB_ISSUE_TOKEN = 'key'; env.GITHUB_ISSUE_REPO = 'Org/repo';
    let state = 'open', creates = 0, fail = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      if (init.method === 'POST' && url.endsWith('/labels')) return new Response('{}', { status: 422 });
      if (init.method === 'POST' && url.endsWith('/issues')) { creates++; return Response.json({ number: 88, html_url: 'https://github.com/Org/repo/issues/88' }, { status: 201 }); }
      if (url.endsWith('/issues/88')) return fail ? new Response('', { status: 503 }) : Response.json({ number: 88, state, html_url: 'https://github.com/Org/repo/issues/88' });
      throw new Error('unexpected fetch');
    }));
    try {
      const alice = await token('alice', 'stock'), bob = await token('bob', 'stock');
      const body = { message: 'An exact repeatable report', kind: 'bug', username: 'bob' };
      const send = async (t: string) => (await (await call('/api/reports', t, 'POST', body)).json() as any).data;
      const first = await send(alice);
      expect(first).toMatchObject({ already_reported: false, issue_status: null, issue_url: 'https://github.com/Org/repo/issues/88' });
      // Reconstruct a missing claim from an existing ownership-bound linked report.
      sqlite.exec("DELETE FROM user_report_dedup WHERE scope LIKE 'user:%' AND report_id = (SELECT MAX(id) FROM user_reports)");
      const open = await send(alice);
      expect(open).toEqual({ reference: first.reference, already_reported: true, issue_status: 'open', issue_url: first.issue_url });
      state = 'closed';
      expect(await send(alice)).toEqual({ reference: first.reference, already_reported: true, issue_status: 'closed', issue_url: first.issue_url });
      fail = true;
      expect(await send(alice)).toEqual({ reference: first.reference, already_reported: true, issue_status: null, issue_url: null });
      expect(creates).toBe(1);
      // A client-provided username cannot access or deduplicate another account's report.
      expect((await send(bob)).already_reported).toBe(false);
      expect(creates).toBe(2);
    } finally { vi.unstubAllGlobals(); delete env.GITHUB_ISSUE_TOKEN; delete env.GITHUB_ISSUE_REPO; }
  });
  it('arbitrates concurrent identical reports before GitHub issue creation', async () => {
    env.GITHUB_ISSUE_TOKEN = 'key'; env.GITHUB_ISSUE_REPO = 'Org/repo';
    let release!: () => void; let entered!: () => void; let creates = 0;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      if (url.endsWith('/labels')) return new Response('{}', { status: 422 });
      if (init.method === 'POST' && url.endsWith('/issues')) { creates++; entered(); await waiting; return Response.json({ number: 89, html_url: 'https://github.com/Org/repo/issues/89' }, { status: 201 }); }
      throw new Error('unexpected');
    }));
    try {
      const t = await token('bob', 'stock'); const body = { message: 'Concurrent identical report' };
      const first = call('/api/reports', t, 'POST', body);
      await started;
      const second: any = await (await call('/api/reports', t, 'POST', body)).json();
      expect(second.data).toMatchObject({ already_reported: true, issue_status: null, issue_url: null });
      release();
      const firstData: any = await (await first).json();
      expect(firstData.data.reference).toBe(second.data.reference);
      expect(creates).toBe(1);
    } finally { release(); vi.unstubAllGlobals(); delete env.GITHUB_ISSUE_TOKEN; delete env.GITHUB_ISSUE_REPO; }
  });
  it('deduplicates queued reports without a token and leaves distinct redacted reports separate', async () => {
    const t = await token('bob', 'stock');
    const send = async (message: string) => (await (await call('/api/reports', t, 'POST', { message })).json() as any).data;
    const first = await send('Offline duplicate report');
    const second = await send('Offline duplicate report');
    expect(second).toEqual({ reference: first.reference, already_reported: true, issue_status: null, issue_url: null });
    expect((await send('Bearer secretOne leaked')).already_reported).toBe(false);
    expect((await send('Bearer secretTwo leaked')).already_reported).toBe(false);
  });
  it('uses the session rather than a client supplied handoff completer for new movements', async () => {
    const id = sqlite.prepare("SELECT id FROM products WHERE sku='ACTOR-1'").get().id;
    const alice = await token('alice', 'stock'), owner = await token('admin', 'owner');
    const created: any = await (await call('/api/mobile-actions', alice, 'POST', { type: 'stock_check', title: 'Count', product_id: id, created_by: 'forged' })).json();
    expect(created.data.created_by).toBe('alice');
    const r = await call(`/api/mobile-actions/${created.data.id}/complete`, owner, 'POST', { apply_stock: true, product_id: id, proposed_stock: 3, completed_by: 'forged' });
    expect(r.status).toBe(200);
    expect((await r.json() as any).data.completed_by).toBe('admin');
    const rows: any = await (await call(`/api/products/${id}/movements?full=1`, alice)).json();
    expect(rows.data.find((x: any) => x.reference === `mobile_action:${created.data.id}`)).toMatchObject({ created_by: 'admin', approved_by: 'admin' });
  });
  it('automatically attributes direct cycle counts without inventing an approver', async () => {
    const productId = sqlite.prepare("SELECT id FROM products WHERE sku='ACTOR-1'").get().id;
    const t = await token('bob', 'stock');
    const r = await call('/api/inventory/cycle-count', t, 'POST', { product_id: productId, counted_qty: 4, created_by: 'forged', approved_by: 'forged' });
    expect(r.status).toBe(200);
    const rows: any = await (await call(`/api/products/${productId}/movements?full=1`, t)).json();
    expect(rows.data.find((x: any) => x.reference === 'cycle-count')).toMatchObject({ created_by: 'bob', approved_by: null });
  });
  it('records the authenticated decision-maker as movement creator and approver for real approval', async () => {
    const productId = sqlite.prepare("SELECT id FROM products WHERE sku='ACTOR-1'").get().id;
    const requester = await token('bob', 'stock'), approver = await token('admin', 'owner');
    const submitted: any = await (await call('/api/stock-adjustment-requests', requester, 'POST', { product_id: productId, direction: 'in', quantity: 2 })).json();
    expect(submitted.data).toBeTruthy();
    const approved = await call(`/api/stock-adjustment-requests/${submitted.data.id}/approve`, approver, 'POST', { approved_by: 'forged' });
    expect(approved.status).toBe(200);
    const rows: any = await (await call(`/api/products/${productId}/movements?full=1`, requester)).json();
    const m = rows.data.find((x: any) => x.reference === `stock-adjustment-request:${submitted.data.id}`);
    expect(m).toMatchObject({ created_by: 'admin', approved_by: 'admin' });
    const all: any = await (await call(`/api/stock/movements?product_id=${productId}`, requester)).json();
    expect(all.data.find((x: any) => x.id === m.id)).toMatchObject({ created_by: 'admin', approved_by: 'admin' });
  });
});
