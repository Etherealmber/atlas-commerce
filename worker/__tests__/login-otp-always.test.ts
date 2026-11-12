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

async function login(body: any, ip = testIp, extraHeaders: Record<string, string> = {}) {
  const res = await app.fetch(
    new Request('http://test.local/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...extraHeaders },
      body: JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, body: await res.json() as any, headers: res.headers };
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


/* eslint-disable no-await-in-loop -- These regressions intentionally submit ordered attempts and inspect each response. */
describe('shared VPN egress: real password/OTP handlers', () => {
  it('unrelated failures on a shared IP do not lock out Alice, including OTP completion', async () => {
    await seedReturningUser();
    for (let i = 0; i < 10; i++) {
      expect((await login({ username: `nonexistent-${i}`, password: 'wrong', fingerprint: `fp-${i}` })).status).toBe(401);
    }
    // A legacy caller of the reputation gate must not re-ban those same failures.
    const intake = await app.fetch(new Request('http://test.local/api/crash-reports', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': testIp }, body: '{}',
    }), env);
    expect(intake.status).not.toBe(429);
    // Exceeds the previous eight-writes/min IP gate and five-failures gate.
    const r = await login({ username: 'alice', password: 'Test1234!', fingerprint: 'same-phone' });
    expect(r.status).toBe(200);
    expect(r.body.needs_otp).toBe(true);
    expect(r.body.token).toBeUndefined();
    expect(sqlite.prepare(`SELECT score FROM ip_reputation WHERE ip = ?`).get(testIp).score).toBe(50);
    const otp = sqlite.prepare(`SELECT code FROM otp_codes WHERE resource_type = 'login' AND resource_id = 'fp:same-phone'`).get().code;
    expect((await verifyFallbackOtp(otp)).status).toBe(200);
  });

  it('five same-account/IP attempts stay bounded despite changing fingerprints/native hints', async () => {
    await seedReturningUser();
    for (let i = 0; i < 5; i++) {
      expect((await login({ username: 'alice', password: 'wrong', fingerprint: `rotated-${i}` })).status).toBe(401);
    }
    const r = await login({ username: ' ALICE ', password: 'Test1234!', fingerprint: 'brand-new', client: 'android', device_proof: { verified: true } }, testIp, { 'X-Atlas-Client': 'android' });
    expect(r.status).toBe(429);
    expect(r.body.code).toBe('RATE_LIMITED');
    expect(r.body.retry_after).toBeGreaterThan(0);
    expect(Number(r.headers.get('Retry-After'))).toBe(r.body.retry_after);
    expect(r.body.token).toBeUndefined();
    expect(sendSpy).not.toHaveBeenCalled();
    const rejectedAgain = await login({ username: 'alice', password: 'wrong' });
    expect(rejectedAgain.status).toBe(429);
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM login_attempts WHERE success = 0`).get().n).toBe(5);
    expect(sqlite.prepare(`SELECT blocked_until FROM ip_reputation WHERE ip = ?`).get(testIp).blocked_until).toBeNull();
  });

  it('an exhausted account/IP budget cannot authenticate that account, but not every other account is denied', async () => {
    await seedReturningUser();
    for (let i = 0; i < 5; i++) await login({ username: 'victim', password: 'wrong' });
    expect((await login({ username: 'victim', password: 'wrong' })).status).toBe(429);
    const alice = await login({ username: 'alice', password: 'Test1234!', fingerprint: 'same-phone' });
    expect(alice.body.needs_otp).toBe(true);
  });

  it('rotating VPN IPs still meets an account-wide bound', async () => {
    await seedReturningUser();
    for (let i = 0; i < 20; i++) {
      const r = await login({ username: 'alice', password: 'wrong' }, `198.51.100.${i + 1}`);
      expect(r.status).toBe(401);
    }
    const blocked = await login({ username: 'alice', password: 'Test1234!' }, '198.51.100.99');
    expect(blocked.status).toBe(429);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('a shared-IP spray still hits a global ceiling while health can remain healthy', async () => {
    for (let i = 0; i < 60; i++) {
      expect((await login({ username: `spray-${i}`, password: 'wrong' })).status).toBe(401);
    }
    const blocked = await login({ username: 'next-account', password: 'wrong' });
    expect(blocked.status).toBe(429);
    const health = await app.fetch(new Request('http://test.local/api/health', { headers: { 'CF-Connecting-IP': testIp } }), env);
    expect(health.status).toBe(200);
    expect((await health.json() as any).data.d1).toBe(true);
  });

  it('does not erase or ignore an explicit unexpired IP ban', async () => {
    await seedReturningUser();
    const until = new Date(Date.now() + 120_000).toISOString();
    sqlite.prepare(`INSERT INTO ip_reputation (ip, score, blocked_until) VALUES (?, 50, ?)`).run(testIp, until);
    const r = await login({ username: 'alice', password: 'Test1234!', fingerprint: 'same-phone' });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(sqlite.prepare(`SELECT blocked_until FROM ip_reputation WHERE ip = ?`).get(testIp).blocked_until).toBe(until);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM login_attempts').get().n).toBe(0);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('rejects OTP account substitution and charges guesses to the pending principal', async () => {
    await seedReturningUser();
    await login({ username: 'alice', password: 'Test1234!', fingerprint: 'same-phone' });
    const otp = sqlite.prepare(`SELECT code FROM otp_codes WHERE resource_type = 'login' AND resource_id = 'fp:same-phone'`).get().code;
    for (let i = 0; i < 5; i++) {
      const res = await app.fetch(new Request('http://test.local/api/auth/verify-otp', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': testIp },
        body: JSON.stringify({ username: `changed-${i}`, password: 'wrong', fingerprint: 'same-phone', otp }),
      }), env);
      expect(res.status).toBe(401);
      expect((await res.json() as any).token).toBeUndefined();
    }
    // Changing the submitted username did not buy five fresh guesses each time.
    expect((await verifyFallbackOtp(otp)).status).toBe(429);
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM otp_codes WHERE resource_type = 'login'`).get().n).toBe(1);
  });

  it('fails closed with a fixed diagnostic if the persistent limiter is unavailable', async () => {
    await seedReturningUser();
    const originalPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      if (sql.includes('credential_attempt_limits_v1')) throw new Error('secret storage details');
      return originalPrepare(sql);
    };
    const r = await login({ username: 'alice', password: 'Test1234!' });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('AUTH_LIMIT_UNAVAILABLE');
    expect(JSON.stringify(r.body)).not.toContain('secret storage details');
    expect(r.body.token).toBeUndefined();
    expect(sendSpy).not.toHaveBeenCalled();
  });
});


describe('legacy IP reputation protections remain effective', () => {
  it('legacy negative-reputation failures can still impose an IP block', async () => {
    await seedReturningUser();
    for (let i = 0; i < 5; i++) {
      sqlite.prepare(`INSERT INTO login_attempts (ip, success, reputation_delta) VALUES (?, 0, -8)`).run(testIp);
    }
    const intake = await app.fetch(new Request('http://test.local/api/crash-reports', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': testIp }, body: '{}',
    }), env);
    expect(intake.status).toBe(429);
    expect((await login({ username: 'alice', password: 'Test1234!' })).status).toBe(429);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('successful OTP does not reset the password-attempt bucket', async () => {
    await seedReturningUser();
    await login({ username: 'alice', password: 'Test1234!', fingerprint: 'same-phone' });
    const otp = sqlite.prepare(`SELECT code FROM otp_codes WHERE resource_type = 'login' AND resource_id = 'fp:same-phone'`).get().code;
    expect((await verifyFallbackOtp(otp)).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await login({ username: 'alice', password: 'wrong' })).status).toBe(401);
    expect((await login({ username: 'alice', password: 'Test1234!' })).status).toBe(429);
  });
});


describe('email link uses bounded OTP verification without changing its signature contract', () => {
  it('still accepts a valid cross-device signed link, but rejects account substitution', async () => {
    await seedReturningUser();
    await login({ username: 'alice', password: 'Test1234!', fingerprint: 'same-phone' });
    const row = sqlite.prepare(`SELECT code, expires_at FROM otp_codes WHERE resource_type = 'login' AND resource_id = 'fp:same-phone'`).get();
    const ctx = JSON.parse(sqlite.prepare(`SELECT code FROM otp_codes WHERE resource_type = 'login_ctx' AND resource_id = 'fp:same-phone'`).get().code);
    const exp = new Date(row.expires_at).getTime();
    const sig = sha256(`otplink|alice|${row.code}|${exp}|${ctx.secretMaterial}`);
    const call = async (username: string) => app.fetch(new Request('http://test.local/api/auth/verify-link', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': testIp },
      body: JSON.stringify({ username, otp: row.code, sig, exp, fingerprint: 'mail-phone' }),
    }), env);
    expect((await call('bob')).status).toBe(401);
    const result = await call('alice');
    expect(result.status).toBe(200);
    const body = await result.json() as any;
    expect(body.username).toBe('alice');
    expect(atob(body.token).split('|').slice(0, 3)).toEqual(['stock-auth-v2', 'alice', 'user']);
    expect((await call('alice')).status).toBe(401);
  });

  it('cannot buy extra OTP attempts by alternating verify-otp and verify-link', async () => {
    await seedReturningUser();
    await login({ username: 'alice', password: 'Test1234!', fingerprint: 'same-phone' });
    for (let i = 0; i < 5; i++) expect((await verifyFallbackOtp('wrong-code')).status).toBe(401);
    const res = await app.fetch(new Request('http://test.local/api/auth/verify-link', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': testIp },
      body: JSON.stringify({ username: 'alice', otp: '000000', sig: 'invalid', exp: Date.now() + 10_000 }),
    }), env);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).not.toBeNull();
  });
});

/** Two actual DB accounts; EMAIL is a test double, never a production inbox. */
async function seedControlledAccounts() {
  await seedReturningUser();
  sqlite.exec(`INSERT INTO app_users (username, password_salt, password_hash, role, email)
    VALUES ('bob', 'sB', '${legacyHash('sB', 'Test1234!')}', 'stock', 'bob@corp.ma')`);
}

async function verifyControlledAccount(username: string, fingerprint: string, otp: string) {
  const response = await app.fetch(new Request('http://test.local/api/auth/verify-otp', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': testIp },
    body: JSON.stringify({ username, password: 'Test1234!', fingerprint, otp }),
  }), env);
  return { status: response.status, body: await response.json() as any };
}

describe('controlled two-account shared-egress regression (local, not staging)', () => {
  it('A exhaustion does not prevent B completing real password/OTP and using its own session', async () => {
    await seedControlledAccounts();
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await login({ username: 'alice', password: 'wrong', fingerprint: 'fp-alice' });
      expect(result.status).toBe(401);
      expect(result.body.code).toBe('BAD_PASSWORD');
    }
    const denied = await login({ username: 'alice', password: 'Test1234!', fingerprint: 'fp-alice' });
    expect(denied.status).toBe(429);
    expect(denied.body.code).toBe('RATE_LIMITED');
    expect(sendSpy).not.toHaveBeenCalled();

    const pending = await login({ username: 'bob', password: 'Test1234!', fingerprint: 'fp-bob' });
    expect(pending.status).toBe(200);
    expect(pending.body.needs_otp).toBe(true);
    expect(pending.body.token).toBeUndefined();
    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sentTo()).toBe('bob@corp.ma');
    const incorrect = await verifyControlledAccount('bob', 'fp-bob', 'not-a-code');
    expect(incorrect.status).toBe(401);
    expect(incorrect.body.code).toBe('BAD_OTP');
    expect(incorrect.body.token).toBeUndefined();
    const otp = sqlite.prepare(`SELECT code FROM otp_codes WHERE resource_type = 'login' AND resource_id = 'fp:fp-bob'`).get().code;
    const accepted = await verifyControlledAccount('bob', 'fp-bob', otp);
    expect(accepted.status).toBe(200);
    const identity = atob(accepted.body.token).split('|');
    expect(identity.slice(0, 5)).toEqual(['stock-auth-v2', 'bob', 'stock', testIp, 'fp-bob']);
    const protectedResponse = await app.fetch(new Request('http://test.local/api/settings/2fa', {
      headers: { Authorization: `Bearer ${accepted.body.token}`, 'CF-Connecting-IP': testIp, 'X-Device-Fingerprint': 'fp-bob' },
    }), env);
    expect(protectedResponse.status).toBe(200);
    const replay = await verifyControlledAccount('bob', 'fp-bob', otp);
    expect(replay.body.token).toBeUndefined();
    expect(replay.body.code).toBe('OTP_NOT_REQUESTED');
    // Alice's account limit is not cleared by Bob's successful login.
    expect((await login({ username: 'alice', password: 'Test1234!', fingerprint: 'fp-alice' })).status).toBe(429);
  });

  it('a historical low-score egress still blocks both accounts without a blanket reset', async () => {
    await seedControlledAccounts();
    sqlite.prepare(`INSERT INTO ip_reputation (ip, score, failed_count) VALUES (?, 5, 19)`).run(testIp);
    for (const username of ['alice', 'bob']) {
      const response = await login({ username, password: 'Test1234!', fingerprint: `fp-${username}` });
      expect(response.status).toBe(429);
      expect(response.body.code).toBe('RATE_LIMITED');
      expect(response.body.token).toBeUndefined();
      expect(response.headers.get('Retry-After')).not.toBeNull();
    }
    const reputation = sqlite.prepare(`SELECT score, failed_count, blocked_until FROM ip_reputation WHERE ip = ?`).get(testIp);
    expect(reputation.score).toBe(5);
    expect(reputation.failed_count).toBe(19);
    expect(reputation.blocked_until).toBeNull();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('expired B OTP cannot create a session or remove the OTP requirement for A', async () => {
    await seedControlledAccounts();
    expect((await login({ username: 'bob', password: 'Test1234!', fingerprint: 'fp-bob' })).body.needs_otp).toBe(true);
    const otp = sqlite.prepare(`SELECT code FROM otp_codes WHERE resource_type = 'login' AND resource_id = 'fp:fp-bob'`).get().code;
    sqlite.exec(`UPDATE otp_codes SET expires_at = '2000-01-01T00:00:00.000Z' WHERE resource_type = 'login' AND resource_id = 'fp:fp-bob'`);
    const expired = await verifyControlledAccount('bob', 'fp-bob', otp);
    expect(expired.status).toBe(400);
    expect(expired.body.code).toBe('OTP_EXPIRED');
    expect(expired.body.token).toBeUndefined();
    const accountA = await login({ username: 'alice', password: 'Test1234!', fingerprint: 'fp-alice' });
    expect(accountA.status).toBe(200);
    expect(accountA.body.needs_otp).toBe(true);
    expect(accountA.body.token).toBeUndefined();
  });
});

/* eslint-enable no-await-in-loop */
