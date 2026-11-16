import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };
const { default: app } = await import('../index');
const { nextPreferenceSync } = await import('../routes/mobilePreferences');
const migration = readFileSync(new URL('../../migrations/0011_mobile_preferences.sql', import.meta.url), 'utf8');
const ip = '203.0.113.115';
let sqlite: any, env: any;
function dbFor(database: any, realClock = false) {
  database.function('test_now', () => new Date().toISOString());
  database.function('test_cutoff', () => new Date(Date.now() - 300_000).toISOString());
  return { prepare(sql: string) {
    // Control D1's UTC clock in boundary tests, including UPDATE's atomic guard.
    if (!realClock) sql = sql.replaceAll("strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes')", 'test_cutoff()')
      .replaceAll("strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", 'test_now()');
    let args: any[] = [];
    const stmt: any = { bind(...a: any[]) { args = a; return stmt; },
      async first() { return database.prepare(sql).get(...args) || null; },
      async all() { return { results: database.prepare(sql).all(...args) }; },
      async run() { const r = database.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    }; return stmt;
  }, async batch(stmts: any[]) { return Promise.all(stmts.map(s => s.run())); } };
}
async function hash(text: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(b => b.toString(16).padStart(2, '0')).join(''); }
async function token(username = 'alice', role = 'stock', proofRole = role) {
  const secret = proofRole === 'owner' ? await hash(`owner-key|${username}|OwnerPass123!`) : `secret-${username}`;
  return btoa(`stock-auth-v2|${username}|${role}|${ip}|none|${await hash(`proof|${username}|${proofRole}|${secret}|${ip}|none`)}`);
}
async function request(method: 'GET' | 'PUT', t?: string, body?: string, query = '', headers: Record<string, string> = {}) {
  return app.fetch(new Request(`http://test.local/api/mobile/preferences${query}`, { method, headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}), 'CF-Connecting-IP': ip, 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body }) }), env, {} as any);
}
const payload = (revision: number, settings: Record<string, unknown> = {}, sync_type = 'manual', extra: Record<string, unknown> = {}) => JSON.stringify({ schema_version: 1, revision, sync_type, settings, ...extra });
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE app_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT, password_salt TEXT DEFAULT '', role TEXT, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
    INSERT INTO app_users (username,password_hash,role) VALUES ('alice','secret-alice','stock'), ('bob','secret-bob','user');`);
  env = { DB: dbFor(sqlite), ADMIN_PASSWORD: 'OwnerPass123!', EMAIL: { send: async () => ({}) } };
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-31T23:59:59.500Z'));
});
afterEach(() => { vi.useRealTimers(); sqlite.close(); });

describe('authenticated mobile preferences', () => {
  it('auto-initializes, migration is idempotent, and ownership constraints apply', async () => {
    const a = await token();
    const res = await request('GET', a);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ schema_version: 1, revision: 0, settings: { theme: 'system', onboarding_completed: false }, last_synced_at: null, next_sync_at: null, updated_at: null, sync_frequency: 'daily', server_time: '2026-01-31T23:59:59.500Z' });
    expect(res.headers.get('cache-control')).toBe('no-store');
    sqlite.exec(migration); sqlite.exec(migration);
    expect(() => sqlite.exec('INSERT INTO mobile_preferences_v1 DEFAULT VALUES')).toThrow();
    expect(() => sqlite.exec("INSERT INTO mobile_preferences_v1(user_id,owner_username) VALUES (2,'owner')")).toThrow();
    expect(() => sqlite.exec('INSERT INTO mobile_preferences_v1(user_id) VALUES (999)')).toThrow();
  });
  it('requires valid session and checks database role instead of trusting claimed role', async () => {
    for (const method of ['GET', 'PUT'] as const) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(method, undefined, method === 'PUT' ? payload(0) : undefined);
      expect(res.status).toBe(401); expect(res.headers.get('cache-control')).toBe('no-store');
    }
    expect((await request('GET', await token('alice', 'admin', 'stock'))).status).toBe(401);
    expect((await request('GET', 'bad')).status).toBe(401);
  });
  it('isolates users and owner, merges settings, and never accepts a client-selected identity', async () => {
    const a = await token(), b = await token('bob', 'user'), owner = await token('admin', 'owner');
    expect((await request('PUT', a, payload(0, { theme: 'dark', onboarding_completed: true }, 'manual', { sync_frequency: 'monthly' }))).status).toBe(200);
    expect((await request('PUT', b, payload(0, { theme: 'light' }))).status).toBe(200);
    expect((await request('PUT', owner, payload(0, { language: 'fr' }))).status).toBe(200);
    expect(await (await request('GET', a)).json()).toMatchObject({ settings: { theme: 'dark', onboarding_completed: true }, revision: 1, sync_frequency: 'monthly', next_sync_at: '2026-02-28T23:59:59.500Z' });
    expect(await (await request('GET', b)).json()).toMatchObject({ settings: { theme: 'light', onboarding_completed: false } });
    expect(await (await request('GET', owner)).json()).toMatchObject({ settings: { theme: 'system', language: 'fr' } });
    expect((await request('PUT', b, payload(1, {}, 'manual', { user_id: 1 }))).status).toBe(422);
    expect((await request('GET', a, undefined, '?user_id=2')).status).toBe(422);
    vi.setSystemTime(new Date('2026-02-01T00:04:59.500Z'));
    expect((await request('PUT', a, payload(1, { density: 'compact' }))).status).toBe(200);
    expect(await (await request('GET', a)).json()).toMatchObject({ revision: 2, settings: { theme: 'dark', density: 'compact' } });
  });
  it('keeps different configured owner usernames in separate slots', async () => {
    const oldOwner = await token('admin', 'owner');
    expect((await request('PUT', oldOwner, payload(0, { theme: 'dark' }))).status).toBe(200);
    env.ADMIN_USERNAME = 'newowner';
    const newOwner = await token('newowner', 'owner');
    expect(await (await request('GET', newOwner)).json()).toMatchObject({ revision: 0, settings: { theme: 'system' } });
    env.ADMIN_USERNAME = 'admin';
    expect(await (await request('GET', oldOwner)).json()).toMatchObject({ revision: 1, settings: { theme: 'dark' } });
  });
  it('accepts every allowlisted setting and rejects unrelated consent and secrets', async () => {
    const t = await token();
    const settings = { theme: 'light', language: 'ar', density: 'compact', animations: false,
      navigation_default: 'scan', scan_behavior: 'auto', sale_confirmation: false,
      product_view: 'grid', update_notifications: false, update_channel: 'beta', onboarding_completed: true };
    const r = await request('PUT', t, payload(0, settings, 'manual', { sync_frequency: 'yearly' }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ settings, sync_frequency: 'yearly', next_sync_at: '2027-01-31T23:59:59.500Z' });
    for (const key of ['access_token', 'refresh_token', 'biometrics', 'saved_accounts', 'saved_servers', 'device_id', 'cache', 'logs', 'permissions', 'diagnostic_consent', 'privacy_consent', 'security_consent']) {
      // eslint-disable-next-line no-await-in-loop
      expect((await request('PUT', t, payload(1, { [key]: true }))).status).toBe(422);
    }
  });
  it('prevents inheritance after account deletion and recreation', async () => {
    await request('PUT', await token(), payload(0, { theme: 'dark' }));
    sqlite.exec("DELETE FROM app_users WHERE username='alice'; INSERT INTO app_users (username,password_hash,role) VALUES ('alice','secret-alice','stock')");
    expect(await (await request('GET', await token())).json()).toMatchObject({ revision: 0, settings: { theme: 'system' } });
  });
  it('rejects unknown, forbidden, malformed and invalid fields and oversized streams', async () => {
    const t = await token();
    const invalid = ['{', '[]', 'null', '{}', payload(0, { password: 'x' }), payload(0, { token: 'x' }), payload(0, { theme: 'blue' }), payload(0, { animations: 'true' }), payload(0, { theme: null }), payload(0, { language: 'xx' }), payload(-1), payload(0.5), payload(0, {}, 'manual', { sync_frequency: 'hourly' }), payload(0, {}, 'automatic'), JSON.stringify({ schema_version: 2, revision: 0, sync_type: 'manual', settings: {} }), payload(0, {}, 'manual', { last_synced_at: '2020-01-01' })];
    for (const value of invalid) {
      // eslint-disable-next-line no-await-in-loop
      expect((await request('PUT', t, value)).status).toBe(422);
    }
    expect((await request('PUT', t, ' '.repeat(4097))).status).toBe(413);
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4097)); controller.close(); } });
    const response = await app.fetch(new Request('http://test.local/api/mobile/preferences', { method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'CF-Connecting-IP': ip }, body: stream, duplex: 'half' } as RequestInit), env, {} as any);
    expect(response.status).toBe(413);
    expect(await (await request('GET', t)).json()).toMatchObject({ revision: 0 });
  });
  it('enforces revision conflicts and server-time cooldown across manual and scheduled writes', async () => {
    const a = await token();
    const first = await request('PUT', a, payload(0, { theme: 'dark' }, 'manual', { sync_frequency: 'daily' }));
    expect(await first.json()).toMatchObject({ revision: 1, server_time: '2026-01-31T23:59:59.500Z', last_synced_at: '2026-01-31T23:59:59.500Z' });
    const stale = await request('PUT', a, payload(0, { theme: 'light' }));
    expect(stale.status).toBe(409); expect(await stale.json()).toMatchObject({ code: 'CONFLICT', revision: 1 });
    vi.setSystemTime(new Date('2026-02-01T00:04:59.000Z'));
    for (const type of ['manual', 'scheduled']) {
      // eslint-disable-next-line no-await-in-loop
      const r = await request('PUT', a, payload(1, {}, type));
      expect(r.status).toBe(429); expect(r.headers.get('retry-after')).toBe('1');
      // eslint-disable-next-line no-await-in-loop
      expect(await r.json()).toMatchObject({ retry_after_seconds: 1, server_time: '2026-02-01T00:04:59.000Z' });
    }
    vi.setSystemTime(new Date('2026-02-01T00:04:59.500Z'));
    const notDue = await request('PUT', a, payload(1, {}, 'scheduled', { sync_frequency: 'weekly' }));
    expect(notDue.status).toBe(409); expect(await notDue.json()).toMatchObject({ code: 'NOT_DUE', next_sync_at: '2026-02-01T23:59:59.500Z' });
    expect((await request('PUT', a, payload(1, { density: 'compact' }))).status).toBe(200);
    vi.setSystemTime(new Date('2026-02-02T00:04:59.500Z'));
    expect((await request('PUT', a, payload(2, {}, 'scheduled'))).status).toBe(200);
    expect((await request('PUT', a, payload(3, {}))).status).toBe(429);
  });
  it('allows a monthly scheduled sync exactly at the UTC month-end boundary', async () => {
    const t = await token();
    expect((await request('PUT', t, payload(0, {}, 'manual', { sync_frequency: 'monthly' }))).status).toBe(200);
    vi.setSystemTime(new Date('2026-02-28T23:59:59.499Z'));
    const early = await request('PUT', t, payload(1, {}, 'scheduled', { sync_frequency: 'daily' }));
    expect(early.status).toBe(409);
    expect(await early.json()).toMatchObject({ code: 'NOT_DUE', next_sync_at: '2026-02-28T23:59:59.500Z' });
    vi.setSystemTime(new Date('2026-02-28T23:59:59.500Z'));
    const due = await request('PUT', t, payload(1, {}, 'scheduled'));
    expect(due.status).toBe(200);
    expect(await due.json()).toMatchObject({ revision: 2, next_sync_at: '2026-03-28T23:59:59.500Z' });
  });
  it('timestamps after a slow request body is read, preventing cooldown bypass', async () => {
    const t = await token();
    const stream = new ReadableStream({ pull(controller) {
      vi.setSystemTime(new Date('2026-02-01T00:10:00.000Z'));
      controller.enqueue(new TextEncoder().encode(payload(0, { theme: 'dark' })));
      controller.close();
    } });
    const r = await app.fetch(new Request('http://test.local/api/mobile/preferences', {
      method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'CF-Connecting-IP': ip }, body: stream, duplex: 'half',
    } as RequestInit), env, {} as any);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ last_synced_at: '2026-02-01T00:10:00.000Z' });
    expect((await request('PUT', t, payload(1))).status).toBe(429);
  });
  it('enforces the cooldown using actual SQLite UTC time expressions', async () => {
    env.DB = dbFor(sqlite, true);
    const t = await token();
    const first = await request('PUT', t, payload(0));
    expect(first.status).toBe(200);
    const body: any = await first.json();
    expect(body.last_synced_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(body.server_time).toBe(body.last_synced_at);
    expect((await request('PUT', t, payload(1))).status).toBe(429);
  });
  it('uses database commit time even if a write is delayed after the read', async () => {
    const t = await token(), db = env.DB;
    env.DB = { ...db, prepare(sql: string) {
      const stmt = db.prepare(sql);
      if (sql.startsWith('UPDATE mobile_preferences_v1 SET')) {
        const bind = stmt.bind;
        stmt.bind = (...args: any[]) => {
          const bound = bind(...args), first = bound.first;
          bound.first = () => { vi.setSystemTime(new Date('2026-02-01T00:10:00.000Z')); return first(); };
          return bound;
        };
      }
      return stmt;
    } };
    const r = await request('PUT', t, payload(0));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ last_synced_at: '2026-02-01T00:10:00.000Z', server_time: '2026-02-01T00:10:00.000Z' });
    env.DB = db;
    expect((await request('PUT', t, payload(1))).status).toBe(429);
  });
  it('accepts at most one of two simultaneous writes with the same revision', async () => {
    const a = await token();
    const responses = await Promise.all([request('PUT', a, payload(0, { theme: 'dark' })), request('PUT', a, payload(0, { theme: 'light' }))]);
    expect(responses.filter(r => r.status === 200)).toHaveLength(1);
    expect(responses.filter(r => r.status === 409)).toHaveLength(1);
    expect(await (await request('GET', a)).json()).toMatchObject({ revision: 1 });
  });
  it('enforces the existing best-effort request rate limit with server time', async () => {
    sqlite.exec("INSERT INTO app_users(username,password_hash,role) VALUES ('carol','secret-carol','user')");
    const t = await token('carol', 'user');
    let r: Response | undefined;
    for (let i = 0; i < 121; i++) {
      // eslint-disable-next-line no-await-in-loop
      r = await request('GET', t);
    }
    expect(r!.status).toBe(429);
    expect(await r!.json()).toMatchObject({ code: 'RATE_LIMITED', server_time: '2026-01-31T23:59:59.500Z', retry_after_seconds: expect.any(Number) });
  });
  it('uses primary regardless of a stale bookmark', async () => {
    const calls: string[] = []; const db = env.DB;
    env.DB = { ...db, withSession(mode: string) { calls.push(mode); return db; } };
    expect((await request('GET', await token(), undefined, '', { 'x-d1-bookmark': 'stale' })).status).toBe(200);
    expect(calls).toEqual(['first-primary']);
  });
  it('uses the configured target primary and fails closed if its primary session cannot start', async () => {
    sqlite.exec("CREATE TABLE app_config (key TEXT PRIMARY KEY, value TEXT); INSERT INTO app_config VALUES ('db_primary','target')");
    const targetDb = new DatabaseSync(':memory:');
    targetDb.exec("PRAGMA foreign_keys=ON; CREATE TABLE app_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT, password_salt TEXT DEFAULT '', role TEXT, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now'))); INSERT INTO app_users(username,password_hash,role) VALUES ('alice','secret-alice','stock')");
    try {
      const source = env.DB, target = dbFor(targetDb), calls: string[] = [];
      env.DB_TARGET = { ...target, withSession(mode: string) { calls.push(mode); return target; } };
      const t = await token();
      expect((await request('PUT', t, payload(0, { theme: 'dark' }))).status).toBe(200);
      expect(calls).toEqual(['first-primary']);
      expect(targetDb.prepare('SELECT count(*) AS n FROM mobile_preferences_v1').get().n).toBe(1);
      expect(sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='mobile_preferences_v1'").get().n).toBe(0);
      env.DB = source;
      env.DB_TARGET.withSession = () => { throw new Error('target unavailable'); };
      expect((await request('GET', t)).status).toBe(503);
      env.DB = { ...source, prepare(sql: string) {
        if (sql.includes("SELECT value FROM app_config WHERE key = 'db_primary'")) throw new Error('source unavailable');
        return source.prepare(sql);
      } };
      expect((await request('GET', t)).status).toBe(503);
    } finally { targetDb.close(); }
  });
  it('does not log submitted values even on storage errors', async () => {
    const t = await token();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const db = env.DB;
      env.DB = { ...db, prepare(sql: string) {
        if (sql.startsWith('UPDATE mobile_preferences_v1 SET')) throw new Error('dark');
        return db.prepare(sql);
      } };
      const res = await request('PUT', t, payload(0, { theme: 'dark' }));
      expect(res.status).toBe(503);
      const output = JSON.stringify([error.mock.calls, log.mock.calls, warn.mock.calls]);
      expect(output).not.toContain('dark');
      expect(JSON.stringify(await res.json())).not.toContain('dark');
    } finally { error.mockRestore(); log.mockRestore(); warn.mockRestore(); }
  });
  it('fails closed when table creation fails', async () => {
    const db = env.DB;
    env.DB = { ...db, prepare(sql: string) { if (sql.startsWith('CREATE TABLE IF NOT EXISTS mobile_preferences_v1')) throw Error('secret'); return db.prepare(sql); } };
    const res = await request('GET', await token());
    expect(res.status).toBe(503); expect(JSON.stringify(await res.json())).not.toContain('secret');
  });
});

describe('UTC scheduling', () => {
  it.each([
    ['2026-12-31T23:01:02.003Z', 'daily', '2027-01-01T23:01:02.003Z'],
    ['2026-12-28T23:01:02.003Z', 'weekly', '2027-01-04T23:01:02.003Z'],
    ['2024-01-31T09:30:00.000Z', 'monthly', '2024-02-29T09:30:00.000Z'],
    ['2026-01-31T09:30:00.000Z', 'monthly', '2026-02-28T09:30:00.000Z'],
    ['2024-02-29T09:30:00.000Z', 'yearly', '2025-02-28T09:30:00.000Z'],
  ])('%s + %s = %s', (start, frequency, expected) => {
    expect(nextPreferenceSync(start, frequency as any)).toBe(expected);
  });
});
