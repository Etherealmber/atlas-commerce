import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordReportOwner } from '../lib/report-ownership';
const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };
const { default: app } = await import('../index');

let sqlite: any, env: any;
const ip = '203.0.113.74';
function dbFor(database: any) {
  return {
    prepare(sql: string) {
      let args: any[] = [];
      const s: any = {
        bind(...a: any[]) { args = a; return s; },
        async first() { return database.prepare(sql).get(...args) || null; },
        async all() { return { results: database.prepare(sql).all(...args) }; },
        async run() { const r = database.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      }; return s;
    },
    async batch(stmts: any[]) { return Promise.all(stmts.map(s => s.run())); },
  };
}
async function sha256(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function token(user = 'alice', role = 'stock', proofRole = role) {
  const proof = await sha256(`proof|${user}|${proofRole}|secret-${user}|${ip}|none`);
  return btoa(`stock-auth-v2|${user}|${role}|${ip}|none|${proof}`);
}
async function request(t?: string, query = '') {
  return app.fetch(new Request(`http://test.local/api/mobile/work-status${query}`, { headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}), 'CF-Connecting-IP': ip } }), env, {} as any);
}
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE app_users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT, password_salt TEXT DEFAULT '', role TEXT, active INTEGER DEFAULT 1, created_at TEXT);
    INSERT INTO app_users VALUES (1, 'alice', 'secret-alice', '', 'stock', 1, '2026-01-01 00:00:00'), (2, 'bob', 'secret-bob', '', 'admin', 1, '2026-01-01 00:00:00');
    CREATE TABLE stock_adjustment_requests (id INTEGER PRIMARY KEY, product_name TEXT, status TEXT, requested_by TEXT, requested_at TEXT);
    INSERT INTO stock_adjustment_requests VALUES (1,'Old', 'pending', 'alice','2025-01-01 00:00:00'), (2,'Bob product','approved','bob','2026-02-01 00:00:00'), (3,'Granite','pending','alice','2026-02-01 00:00:00'), (4,'Marble','rejected','alice','2026-02-02 00:00:00');
    CREATE TABLE user_reports (id INTEGER PRIMARY KEY, username TEXT, status TEXT, issue_number INTEGER, issue_url TEXT, created_at TEXT);
    CREATE TABLE app_config (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT);
  `);
  env = { DB: dbFor(sqlite), ADMIN_PASSWORD: 'OwnerPass123!', EMAIL: { send: async () => ({}) } };
});
afterEach(() => { vi.unstubAllGlobals(); sqlite.close(); });

describe('authenticated work status', () => {
  it('enforces authentication and authoritative roles including tampered role claims', async () => {
    expect((await request()).status).toBe(401);
    expect((await request(await token('alice', 'admin', 'stock'))).status).toBe(401);
    sqlite.exec("UPDATE app_users SET active=0 WHERE username='alice'");
    expect((await request(await token())).status).toBe(401);
  });
  it('isolates records by account lifetime and user for every role; pages stably', async () => {
    const t = await token();
    const response = await request(t, '?limit=1');
    expect(response.headers.get('cache-control')).toContain('no-store');
    const data: any = await response.json();
    expect(data.in_app.items).toEqual([{ source: 'stock_adjustment_request', id: '4', title: 'Marble', status: 'rejected', updated_at: null }]);
    expect(data.in_app.next_cursor).toBe('4');
    expect(data.trackers.github.error).toBe('NOT_CONFIGURED');
    expect(data.trackers.linear.error).toBe('NOT_CONFIGURED');
    const next: any = await (await request(t, '?limit=1&in_app_cursor=4')).json();
    expect(next.in_app.items.map((x: any) => x.id)).toEqual(['3']);
    expect(next.in_app.next_cursor).toBeNull();
    const admin: any = await (await request(await token('bob', 'admin'))).json();
    expect(admin.in_app.items.map((x: any) => x.id)).toEqual(['2']);
  });
  it('rejects invalid bounds, duplicate and unknown parameters', async () => {
    const t = await token();
    const invalid = ['?limit=6', '?limit=0', '?in_app_cursor=-1', '?limit=1&limit=2', '?tenant=other', '?github_cursor=999999999999999999'];
    expect((await Promise.all(invalid.map(q => request(t, q)))).every(r => r.status === 400)).toBe(true);
  });
  it('fails closed if account lifetime is unknown, or source tables are absent', async () => {
    sqlite.exec("UPDATE app_users SET created_at=NULL WHERE username='alice'");
    const t = await token();
    expect((await (await request(t)).json() as any).in_app.error).toBe('OWNERSHIP_UNVERIFIABLE');
    sqlite.exec("UPDATE app_users SET created_at='2026-01-01 00:00:00'; DROP TABLE stock_adjustment_requests;");
    expect((await (await request(t)).json() as any).in_app.error).toBe('SOURCE_UNAVAILABLE');
  });
  it('maps only own verified linked issues exactly, and treats upstream failures independently', async () => {
    env.WORK_STATUS_GITHUB_ENABLED = 'true'; env.GITHUB_ISSUE_TOKEN = 'server-secret'; env.GITHUB_ISSUE_REPO = 'Org/repo';
    sqlite.exec(`INSERT INTO user_reports VALUES (5,'alice','linked',42,'https://github.com/Org/repo/issues/42','2026-02-01 00:00:00'), (6,'bob','linked',99,'https://github.com/Org/repo/issues/99','2026-02-01 00:00:00');`);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ number: 42, title: 'Fix scan', state: 'closed', updated_at: '2026-02-03T00:00:00Z', html_url: 'https://github.com/Org/repo/issues/42', body: 'secret' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const t = await token();
    let data: any = await (await request(t)).json();
    expect(data.trackers.github.items).toEqual([{ source: 'github', id: '42', title: 'Fix scan', status: 'closed', updated_at: '2026-02-03T00:00:00Z', url: 'https://github.com/Org/repo/issues/42' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(data)).not.toContain('server-secret');
    fetchMock.mockImplementation(async () => new Response('oops', { status: 503 }));
    data = await (await request(t)).json();
    expect(data.in_app.items).toHaveLength(2);
    expect(data.trackers.github).toMatchObject({ availability: 'unavailable', error: 'SOURCE_UNAVAILABLE', items: [] });
    sqlite.exec("UPDATE user_reports SET issue_url='https://evil.test/Org/repo/issues/42' WHERE id=5");
    fetchMock.mockClear();
    data = await (await request(t)).json();
    expect(data.trackers.github.error).toBe('SOURCE_UNAVAILABLE');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('paginates linked reports independently and rejects mismatched GitHub data', async () => {
    env.WORK_STATUS_GITHUB_ENABLED = 'true'; env.GITHUB_ISSUE_TOKEN = 'key'; env.GITHUB_ISSUE_REPO = 'Org/repo';
    sqlite.exec(`INSERT INTO user_reports VALUES (7,'alice','linked',10,'https://github.com/Org/repo/issues/10','2026-02-01 00:00:00'), (8,'alice','linked',11,'https://github.com/Org/repo/issues/11','2026-02-01 00:00:00');`);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const n = Number(url.split('/').pop());
      return new Response(JSON.stringify({ number: n, title: `Issue ${n}`, state: 'open', updated_at: '2026-02-03T00:00:00Z', html_url: `https://github.com/Org/repo/issues/${n}` }));
    }));
    const t = await token();
    let data: any = await (await request(t, '?limit=1')).json();
    expect(data.trackers.github.items[0].id).toBe('11');
    expect(data.trackers.github.next_cursor).toBe('8');
    data = await (await request(t, '?limit=1&github_cursor=8')).json();
    expect(data.trackers.github.items[0].id).toBe('10');
    expect(data.trackers.github.next_cursor).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ number: 11, title: 'wrong link', state: 'open', updated_at: '2026-02-03T00:00:00Z', html_url: 'https://evil.test/Org/repo/issues/11' }))));
    data = await (await request(t)).json();
    expect(data.trackers.github.error).toBe('SOURCE_UNAVAILABLE');
    expect(data.in_app.items).toHaveLength(2);
  });
  it('does not claim GitHub health with missing config or no linked reports', async () => {
    env.WORK_STATUS_GITHUB_ENABLED = 'true';
    const t = await token();
    let data: any = await (await request(t)).json();
    expect(data.trackers.github.error).toBe('NOT_CONFIGURED');
    env.GITHUB_ISSUE_TOKEN = 'key'; env.GITHUB_ISSUE_REPO = 'Org/repo';
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    data = await (await request(t)).json();
    expect(data.trackers.github.error).toBe('NO_LINKED_REPORTS');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('automatically fetches public issues anonymously and refuses private or unavailable repositories', async () => {
    env.GITHUB_ISSUE_TOKEN = 'server-secret'; env.GITHUB_ISSUE_REPO = 'Org/repo';
    sqlite.exec(`INSERT INTO user_reports VALUES (5,'alice','linked',42,'https://github.com/Org/repo/issues/42','2026-02-01 00:00:00')`);
    const remote = vi.fn(async (url: string, init: any) => {
      expect(init.headers.Authorization).toBeUndefined();
      return Response.json(url.endsWith('/issues/42') ? { number: 42, title: 'Public issue', state: 'open', updated_at: '2026-02-03T00:00:00Z', html_url: 'https://github.com/Org/repo/issues/42' } : { private: false, full_name: 'Org/repo', visibility: 'public' });
    });
    vi.stubGlobal('fetch', remote);
    const t = await token();
    let data: any = await (await request(t)).json();
    expect(data.trackers.github.items[0]).toMatchObject({ id: '42', status: 'open', url: 'https://github.com/Org/repo/issues/42' });
    remote.mockClear(); remote.mockImplementation(async () => new Response('private', { status: 404 }));
    data = await (await request(t)).json();
    expect(data.trackers.github.error).toBe('SOURCE_UNAVAILABLE');
    expect(data.in_app.items).toHaveLength(2);
    expect(remote).toHaveBeenCalledTimes(1);
    env.WORK_STATUS_GITHUB_ENABLED = 'false'; remote.mockClear();
    data = await (await request(t)).json();
    expect(data.trackers.github.error).toBe('NOT_CONFIGURED');
    expect(remote).not.toHaveBeenCalled();
  });
  it('does not let a reused username inherit reports bound to a previous account id', async () => {
    env.GITHUB_ISSUE_TOKEN = 'key'; env.GITHUB_ISSUE_REPO = 'Org/repo'; env.WORK_STATUS_GITHUB_ENABLED = 'true';
    sqlite.exec(`INSERT INTO user_reports VALUES (5,'alice','linked',42,'https://github.com/Org/repo/issues/42','2030-02-01 00:00:00')`);
    await recordReportOwner(env.DB, 5, false, 1);
    sqlite.exec("DELETE FROM app_users WHERE id=1; INSERT INTO app_users VALUES (9,'alice','secret-alice','','stock',1,'2026-01-01 00:00:00')");
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const data: any = await (await request(await token())).json();
    expect(data.trackers.github.items).toEqual([]);
    expect(data.trackers.github.error).toBe('NO_LINKED_REPORTS');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('uses separate D1 tenants and forces a primary session despite a supplied bookmark', async () => {
    const t = await token();
    const calls: any[] = [];
    const original = env.DB;
    env.DB = { ...original, withSession: (mode: string) => { calls.push(mode); return original; } };
    const r = await app.fetch(new Request('http://test.local/api/mobile/work-status', { headers: { Authorization: `Bearer ${t}`, 'CF-Connecting-IP': ip, 'x-d1-bookmark': 'old-bookmark' } }), env, {} as any);
    expect(r.status).toBe(200);
    expect(calls).toEqual(['first-primary']);
    const other = new DatabaseSync(':memory:');
    try {
      other.exec(`CREATE TABLE app_users (id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT, role TEXT, active INTEGER, created_at TEXT);
        INSERT INTO app_users VALUES (1,'alice','secret-alice','stock',1,'2026-01-01 00:00:00');
        CREATE TABLE stock_adjustment_requests (id INTEGER, product_name TEXT, status TEXT, requested_by TEXT, requested_at TEXT);
        INSERT INTO stock_adjustment_requests VALUES (77,'Other tenant','approved','alice','2026-02-01 00:00:00');`);
      env.DB = dbFor(other);
      const data: any = await (await request(t)).json();
      expect(data.in_app.items.map((item: any) => item.id)).toEqual(['77']);
    } finally { other.close(); }
  });
  it('bounds repeated requests with a best-effort rate limit', async () => {
    const t = await token('bob', 'admin');
    let response: Response | undefined;
    for (let i = 0; i < 35; i++) {
      // eslint-disable-next-line no-await-in-loop
      response = await request(t);
    }
    expect(response!.status).toBe(429);
    expect(response!.headers.get('retry-after')).toBeTruthy();
  });

});
