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
let scenario = 0;
let testIp: string;

beforeEach(async () => {
  // Keep the real process-wide auth limiter; isolate independent scenarios.
  testIp = `203.0.113.${++scenario}`;
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

async function login(body: any, ip = testIp) {
  const res = await app.fetch(
    new Request('http://test.local/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
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

async function seedReturningUser() {
  sqlite.exec(`INSERT INTO app_users (username, password_salt, password_hash, role, email)
    VALUES ('alice', 'sA', '${legacyHash('sA', 'Test1234!')}', 'user', 'alice@corp.ma')`);
  sqlite.exec(`INSERT INTO trusted_devices (fingerprint, username, last_ip)
    VALUES ('same-phone', 'alice', '203.0.113.7')`);
}

async function verifyFallbackOtp(code: string) {
  const res = await app.fetch(new Request('http://test.local/api/auth/verify-otp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': testIp },
    body: JSON.stringify({ username: 'alice', password: 'Test1234!', fingerprint: 'same-phone', otp: code }),
  }), env);
  return { status: res.status, body: await res.json() as any };
}

describe('Android possession rollout remains disabled on the real login route', () => {
  it.each([
    ['missing', undefined],
    ['invalid', { signature: 'invalid' }],
    ['expired', { credential_id: 'old', expires_at: '2000-01-01', signature: 'invalid' }],
    ['revoked', { credential_id: 'revoked', signature: 'invalid' }],
    ['unsupported', { algorithm: 'none', signature: 'invalid' }],
    ['client-asserted valid', { verified: true, trusted: true, username: 'alice', signature: 'invalid' }],
  ])('same-account return with %s proof still requires OTP', async (_name, device_proof) => {
    await seedReturningUser();
    const r = await login({ username: 'alice', password: 'Test1234!', fingerprint: 'same-phone', device_proof });
    expect(r.status).toBe(200);
    expect(r.body.needs_otp).toBe(true);
    expect(r.body.token).toBeUndefined();
    expect(sendSpy).toHaveBeenCalledOnce();
  });

  it('cross-account proof claims cannot trust B on the phone enrolled for A', async () => {
    await seedReturningUser();
    sqlite.exec(`INSERT INTO app_users (username, password_salt, password_hash, role, email)
      VALUES ('bob', 'sB', '${legacyHash('sB', 'Test1234!')}', 'user', 'bob@corp.ma')`);
    const r = await login({ username: 'bob', password: 'Test1234!', fingerprint: 'same-phone',
      device_proof: { username: 'alice', credential_id: 'alice-key', verified: true } });
    expect(r.body.needs_otp).toBe(true);
    expect(r.body.token).toBeUndefined();
    expect(sentTo()).toBe('bob@corp.ma');
  });

  it('VPN egress change does not bypass OTP or count password login as successful', async () => {
    await seedReturningUser();
    const r = await login({ username: 'alice', password: 'Test1234!', fingerprint: 'same-phone' }, '198.51.100.9');
    expect(r.body.needs_otp).toBe(true);
    expect(r.body.token).toBeUndefined();
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM login_attempts WHERE success = 1`).get().n).toBe(0);
  });

  it('revoked record does not become trusted on a password-only return', async () => {
    await seedReturningUser();
    sqlite.exec(`DELETE FROM trusted_devices WHERE fingerprint = 'same-phone'`);
    const r = await login({ username: 'alice', password: 'Test1234!', fingerprint: 'same-phone' });
    expect(r.body.needs_otp).toBe(true);
    expect(r.body.token).toBeUndefined();
  });

  it('wrong password plus purported possession proof cannot send OTP or issue a token', async () => {
    await seedReturningUser();
    const r = await login({ username: 'alice', password: 'wrong', fingerprint: 'same-phone', device_proof: { verified: true } });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe('BAD_PASSWORD');
    expect(r.body.token).toBeUndefined();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('a VPN IP blocked by reputation cannot use proof claims to bypass abuse controls', async () => {
    await seedReturningUser();
    sqlite.prepare(`INSERT INTO ip_reputation (ip, score) VALUES (?, 5)`).run(testIp);
    const r = await login({ username: 'alice', password: 'Test1234!', fingerprint: 'same-phone', device_proof: { verified: true } });
    expect(r.status).toBe(429);
    expect(r.body.token).toBeUndefined();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('proof failure can complete the existing email OTP fallback unchanged', async () => {
    await seedReturningUser();
    const first = await login({ username: 'alice', password: 'Test1234!', fingerprint: 'same-phone', device_proof: { signature: 'invalid' } });
    expect(first.body.needs_otp).toBe(true);
    const otp = sqlite.prepare(`SELECT code FROM otp_codes WHERE resource_type = 'login' AND resource_id = 'fp:same-phone'`).get().code;

    const bad = await verifyFallbackOtp('definitely-wrong');
    expect(bad.status).toBe(401);
    expect(bad.body.token).toBeUndefined();
    const good = await verifyFallbackOtp(otp);
    expect(good.status).toBe(200);
    expect(good.body.username).toBe('alice');
    expect(good.body.token).toEqual(expect.any(String));
    expect((await verifyFallbackOtp(otp)).body.token).toBeUndefined();
  });
});
