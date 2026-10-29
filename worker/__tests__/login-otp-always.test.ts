/**
 * v0.7.1 — « OTP required always » regression tests on the REAL login route
 * (worker/index.ts) through an in-process SQLite (node:sqlite) D1 shim, same
 * harness style as expenses-auth.test.ts / stock-adjustments.test.ts.
 *
 * Locks the hardened policy:
 *  - a TRUSTED device no longer bypasses the e-mail OTP (the old hole: logged
 *    in as A on a trusted device, B could sign in with password only);
 *  - a brand-new account's first-ever login also requires the OTP;
 *  - OTP recipient = the user's own email when set, else the company MAIN
 *    email (company_settings.email), else the configured OTP inbox;
 *  - wrong password → 401 and no OTP email at all.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };
import { createHash } from 'node:crypto';

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
// legacy verification path: sha256(`pc:${salt}:${password}`) — accepted once by
// verifyUserPassword, perfect for tests without re-implementing PBKDF2.
const legacyHash = (salt: string, pw: string) => sha256(`pc:${salt}:${pw}`);

function makeD1() {
  const sqlite = new DatabaseSync(':memory:');
  const db: any = {
    prepare(sql: string) {
      let params: any[] = [];
      const api: any = {
        bind(...p: any[]) { params = p; return api; },
        async run() {
          const r = sqlite.prepare(sql).run(...(params as any));
          return { success: true, meta: { changes: Number(r.changes || 0), last_row_id: Number(r.lastInsertRowid || 0) } };
        },
        async first() {
          const r = sqlite.prepare(sql).get(...(params as any));
          return r === undefined ? null : { ...(r as any) };
        },
        async all() {
          const rows = sqlite.prepare(sql).all(...(params as any)).map((r: any) => ({ ...r }));
          return { success: true, results: rows, meta: {} };
        },
      };
      return api;
    },
    async batch(stmts: any[]) {
      const out: any[] = [];
      for (const st of stmts) out.push(await st.run());
      return out;
    },
  };
  return { db, sqlite };
}

let db: any;
let sqlite: any;
let app: any;
let sendSpy: any;
let env: any;

beforeEach(async () => {
  const made = makeD1();
  db = made.db;
  sqlite = made.sqlite;
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS company_settings (id INTEGER PRIMARY KEY, company_name TEXT DEFAULT '', email TEXT DEFAULT '');
    INSERT INTO company_settings (id, company_name, email) VALUES (1, 'TestCo', 'main@corp.ma');
    CREATE TABLE IF NOT EXISTS app_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT DEFAULT '',
      password_salt TEXT DEFAULT '', role TEXT DEFAULT 'user', display_name TEXT DEFAULT '',
      active INTEGER DEFAULT 1, email TEXT DEFAULT '', created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')), last_login TEXT
    );
    CREATE TABLE IF NOT EXISTS login_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL, fingerprint TEXT DEFAULT '', success INTEGER DEFAULT 0, reputation_delta INTEGER DEFAULT 0, user_agent TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS ip_reputation (ip TEXT PRIMARY KEY, score INTEGER NOT NULL DEFAULT 50, failed_count INTEGER DEFAULT 0, success_count INTEGER DEFAULT 0, blocked_until TEXT, updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS otp_codes (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), UNIQUE(resource_type, resource_id));
    CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS trusted_devices (fingerprint TEXT PRIMARY KEY, label TEXT DEFAULT '', last_ip TEXT DEFAULT '', last_seen TEXT DEFAULT (datetime('now')), created_at TEXT DEFAULT (datetime('now')), biometric_credential_id TEXT DEFAULT '', username TEXT DEFAULT '', user_agent TEXT DEFAULT '', city TEXT DEFAULT '', country TEXT DEFAULT '');
  `);
  sendSpy = vi.fn(async () => ({}));
  env = {
    DB: db,
    CACHE: {},
    EMAIL: { send: sendSpy },
    ADMIN_PASSWORD: 'OwnerPass123!',
    TURNSTILE_SECRET_KEY: '',
    TURNSTILE_SITE_KEY: '',
  };
  const mod: any = await import('../index');
  app = mod.default?.fetch ? mod.default : mod.app;
});

async function login(body: any) {
  const res = await app.fetch(
    new Request('http://test.local/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, body: await res.json() as any };
}
const sentTo = () => String(sendSpy.mock.calls[0]?.[0]?.to ?? sendSpy.mock.calls[0]?.[1]?.to ?? '');

describe('OTP required always', () => {
  it('trusted device NO LONGER bypasses the OTP (account-switch hole)', async () => {
    sqlite.exec(`INSERT INTO app_users (username, password_salt, password_hash, role, email)
                 VALUES ('mag', 's1', '${legacyHash('s1', 'Test1234!')}', 'stock', '')`);
    // device already trusted from a previous account session
    sqlite.exec(`INSERT INTO trusted_devices (fingerprint, username, user_agent, last_ip, last_seen)
                 VALUES ('fp1', 'other', 'ua', '203.0.113.7', datetime('now'))`);
    const r = await login({ username: 'mag', password: 'Test1234!', fingerprint: 'fp1' });
    expect(r.status).toBe(200);
    expect(r.body.needs_otp).toBe(true);
    expect(r.body.token).toBeUndefined();
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('brand-new account, unknown device → OTP as well', async () => {
    sqlite.exec(`INSERT INTO app_users (username, password_salt, password_hash, role, email)
                 VALUES ('newbie', 's2', '${legacyHash('s2', 'Test1234!')}', 'user', '')`);
    const r = await login({ username: 'newbie', password: 'Test1234!', fingerprint: 'fp-new' });
    expect(r.body.needs_otp).toBe(true);
    expect(r.body.token).toBeUndefined();
  });

  it('recipient = company MAIN email while the user has none', async () => {
    sqlite.exec(`INSERT INTO app_users (username, password_salt, password_hash, role, email)
                 VALUES ('mag', 's1', '${legacyHash('s1', 'Test1234!')}', 'stock', '')`);
    const r = await login({ username: 'mag', password: 'Test1234!', fingerprint: 'fp1' });
    expect(r.body.needs_otp).toBe(true);
    expect(sentTo()).toBe('main@corp.ma');
    expect(String(r.body.otp_sent_to || '')).toContain('ma•••@corp.ma');
  });

  it('recipient = the user own email once set', async () => {
    sqlite.exec(`INSERT INTO app_users (username, password_salt, password_hash, role, email)
                 VALUES ('mag', 's1', '${legacyHash('s1', 'Test1234!')}', 'stock', 'mag@corp.ma')`);
    const r = await login({ username: 'mag', password: 'Test1234!', fingerprint: 'fp1' });
    expect(r.body.needs_otp).toBe(true);
    expect(sentTo()).toBe('mag@corp.ma');
  });

  it('wrong password → 401 and no OTP email', async () => {
    sqlite.exec(`INSERT INTO app_users (username, password_salt, password_hash, role, email)
                 VALUES ('mag', 's1', '${legacyHash('s1', 'Test1234!')}', 'stock', 'mag@corp.ma')`);
    const r = await login({ username: 'mag', password: 'nope', fingerprint: 'fp1' });
    expect(r.status).toBe(401);
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
