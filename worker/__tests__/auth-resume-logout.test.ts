/**
 * v0.7.5 — « reprise après auto-déconnexion » regression tests on the REAL
 * routes (worker/index.ts) through an in-process SQLite (node:sqlite) D1 shim,
 * same harness style as login-otp-always.test.ts.
 *
 * Locks the resume policy shipped in PR #151 / #154:
 *  1. voluntary logout (valid session) sets `resume_until` ONLY on the
 *     matching fingerprint+username trusted-device row;
 *  2. same account + same device + unexpired marker + 2FA off → password
 *     login succeeds WITHOUT OTP and CONSUMES the marker;
 *  3. different account on the same device, expired marker, 2FA enabled or
 *     revoked (deleted) device row → OTP is still required (no bypass);
 *  4. missing/invalid Authorization on POST /api/auth/logout can never set a
 *     resume marker (the route stays behind the global auth middleware).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };
// webcrypto global (same primitive as the worker's sha256Hex) — no node:crypto
// import: the worker tsconfig has no node types.
async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
// legacy verification path: sha256(`pc:${salt}:${password}`) — accepted once by
// verifyUserPassword, perfect for tests without re-implementing PBKDF2.
const legacyHash = (salt: string, pw: string) => sha256(`pc:${salt}:${pw}`);
// Each test uses its OWN client IP: the worker rate-limits /api/auth/* writes
// to 8/min/IP via an in-process bucket when env.CACHE is a plain object.
let IP = '203.0.113.9';
let ipSeq = 0;

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
    CREATE TABLE IF NOT EXISTS trusted_devices (fingerprint TEXT PRIMARY KEY, label TEXT DEFAULT '', last_ip TEXT DEFAULT '', last_seen TEXT DEFAULT (datetime('now')), created_at TEXT DEFAULT (datetime('now')), biometric_credential_id TEXT DEFAULT '', username TEXT DEFAULT '', user_agent TEXT DEFAULT '', city TEXT DEFAULT '', country TEXT DEFAULT '', resume_until TEXT DEFAULT '');
  `);
  ipSeq += 1;
  IP = `203.0.113.${100 + ipSeq}`;
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

async function seedUser(username: string, pw: string, role = 'user') {
  const salt = `s-${username}`;
  const hash = await legacyHash(salt, pw);
  sqlite.exec(
    `INSERT INTO app_users (username, password_salt, password_hash, role, email)
     VALUES ('${username}', '${salt}', '${hash}', '${role}', '${username}@corp.ma')`,
  );
  return hash;
}

function seedDevice(fp: string, username: string, resumeUntil = '') {
  sqlite.exec(
    `INSERT INTO trusted_devices (fingerprint, username, user_agent, last_ip, last_seen, resume_until)
     VALUES ('${fp}', '${username}', 'ua', '${IP}', datetime('now'), '${resumeUntil}')`,
  );
}

/** Mirrors makeTokenV2: stock-auth-v2|user|role|ip|fp|sha256(proof|…) */
async function tokenFor(username: string, role: string, secretMaterial: string, fp: string) {
  const user = username.toLowerCase();
  const proof = await sha256(`proof|${user}|${role}|${secretMaterial}|${IP}|${fp}`);
  return btoa(unescape(encodeURIComponent(`stock-auth-v2|${user}|${role}|${IP}|${fp}|${proof}`)));
}

async function logout(authHeader?: string, fp = 'fpA') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Device-Fingerprint': fp, 'CF-Connecting-IP': IP };
  if (authHeader) headers.Authorization = authHeader;
  const res = await app.fetch(new Request('http://test.local/api/auth/logout', { method: 'POST', headers }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function login(username: string, pw: string, fp: string) {
  const res = await app.fetch(
    new Request('http://test.local/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Device-Fingerprint': fp, 'CF-Connecting-IP': IP },
      body: JSON.stringify({ username, password: pw, fingerprint: fp }),
    }),
    env,
  );
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const resumeOf = (fp: string) =>
  String((sqlite.prepare(`SELECT resume_until FROM trusted_devices WHERE fingerprint = ?`).get(fp) as any)?.resume_until ?? '');

describe('v0.7.5 — reprise après auto-déconnexion (resume_until)', () => {
  it('1. voluntary logout marks ONLY the matching device+account resumable', async () => {
    const secretA = await seedUser('alice', 'Test1234!');
    await seedUser('bob', 'Test1234!');
    seedDevice('fpA', 'alice');
    seedDevice('fpB', 'alice');
    seedDevice('fpA2', 'bob');

    const r = await logout(`Bearer ${await tokenFor('alice', 'user', secretA, 'fpA')}`, 'fpA');
    expect(r.status).toBe(200);
    expect((r.body as any).success).toBe(true);

    expect(resumeOf('fpA')).not.toBe('');
    expect(resumeOf('fpA')).toContain('20'); // a datetime, not ''
    expect(resumeOf('fpB')).toBe(''); // same account, other device: untouched
    expect(resumeOf('fpA2')).toBe(''); // other account, untouched
  });

  it('2. same account + device + unexpired marker + 2FA off → password-only, marker consumed', async () => {
    const secretA = await seedUser('alice', 'Test1234!');
    seedDevice('fpA', 'alice');
    const lo = await logout(`Bearer ${await tokenFor('alice', 'user', secretA, 'fpA')}`, 'fpA');
    expect(lo.status).toBe(200);
    expect(resumeOf('fpA')).not.toBe('');

    const r = await login('alice', 'Test1234!', 'fpA');
    expect(r.status).toBe(200);
    expect(r.body.needs_otp).toBe(false);
    expect(typeof r.body.token).toBe('string');
    expect(sendSpy).not.toHaveBeenCalled(); // no OTP email on resume
    expect(resumeOf('fpA')).toBe(''); // marker consumed (single use)

    // second login right after: marker gone → OTP again (no permanent bypass)
    const again = await login('alice', 'Test1234!', 'fpA');
    expect(again.body.needs_otp).toBe(true);
  });

  it('3a. different account on the same device keeps the OTP', async () => {
    const secretA = await seedUser('alice', 'Test1234!');
    await seedUser('bob', 'Test1234!');
    seedDevice('fpA', 'alice');
    await logout(`Bearer ${await tokenFor('alice', 'user', secretA, 'fpA')}`, 'fpA');
    const r = await login('bob', 'Test1234!', 'fpA');
    expect(r.body.needs_otp).toBe(true);
    expect(r.body.token).toBeUndefined();
  });

  it('3b. expired marker keeps the OTP', async () => {
    await seedUser('alice', 'Test1234!');
    seedDevice('fpA', 'alice');
    sqlite.exec(`UPDATE trusted_devices SET resume_until = datetime('now', '-1 day') WHERE fingerprint = 'fpA'`);
    const r = await login('alice', 'Test1234!', 'fpA');
    expect(r.body.needs_otp).toBe(true);
  });

  it('3c. 2FA enabled keeps the OTP even with a valid marker', async () => {
    const secretA = await seedUser('alice', 'Test1234!');
    seedDevice('fpA', 'alice');
    sqlite.exec(`INSERT INTO app_config (key, value) VALUES ('twofa_enabled', '1')`);
    await logout(`Bearer ${await tokenFor('alice', 'user', secretA, 'fpA')}`, 'fpA');
    expect(resumeOf('fpA')).not.toBe('');
    const r = await login('alice', 'Test1234!', 'fpA');
    expect(r.body.needs_otp).toBe(true);
    expect(resumeOf('fpA')).not.toBe(''); // marker NOT consumed when 2FA is on
  });

  it('3d. revoked device (trusted row removed) keeps the OTP', async () => {
    const secretA = await seedUser('alice', 'Test1234!');
    seedDevice('fpA', 'alice');
    await logout(`Bearer ${await tokenFor('alice', 'user', secretA, 'fpA')}`, 'fpA');
    sqlite.exec(`DELETE FROM trusted_devices WHERE fingerprint = 'fpA'`); // révocation
    const r = await login('alice', 'Test1234!', 'fpA');
    expect(r.body.needs_otp).toBe(true);
  });

  it('4. logout without (or with a garbage) Authorization sets no marker', async () => {
    await seedUser('alice', 'Test1234!');
    seedDevice('fpA', 'alice');

    const noAuth = await logout(undefined, 'fpA');
    expect(noAuth.status).toBe(401); // route stays behind the global auth middleware
    expect(resumeOf('fpA')).toBe('');

    const badAuth = await logout('Bearer not-a-real-token', 'fpA');
    expect(badAuth.status).toBe(401);
    expect(resumeOf('fpA')).toBe('');
  });
});
