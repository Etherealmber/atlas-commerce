/**
 * « Modifier le profil » — fuseau horaire, horaires et fonction are saved in D1
 * (user_profile_prefs, migration 0021) and come back from GET /api/auth/me.
 * Harness copied from device-revocation.test.ts (in-process node:sqlite D1).
 *
 * (original harness notes:) v0.7.5 — device revocation MUST invalidate live sessions (security audit).
 *
 * Revoking a device (« Appareils connectés » → révoquer) deletes its
 * trusted_devices row; since every login path inserts that row before handing
 * out a token, a missing row now means « revoked » and authFailReason()
 * answers 'device_revoked' → 401 DEVICE_REVOKED on the next authenticated
 * request (Android signs out on any authenticated 401, web drops to /login).
 *
 * Harness: same in-process node:sqlite D1 shim as login-otp-always.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
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
let env: any;

beforeEach(async () => {
  // limiteurs / caches en mémoire du worker : module neuf à chaque test
  vi.resetModules();
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
  env = {
    DB: db,
    CACHE: {},
    EMAIL: { send: vi.fn(async () => ({})) },
    ADMIN_PASSWORD: 'OwnerPass123!',
    TURNSTILE_SECRET_KEY: '',
    TURNSTILE_SITE_KEY: '',
  };
  const mod: any = await import('../index');
  app = mod.default?.fetch ? mod.default : mod.app;
});

async function post(path: string, body: any, headers: Record<string, string> = {}) {
  const res = await app.fetch(
    new Request(`http://test.local${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.87', ...headers },
      body: JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

async function get(path: string, headers: Record<string, string> = {}) {
  const res = await app.fetch(new Request(`http://test.local${path}`, { headers }), env);
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}


/** Full login (password + OTP) → live v2 session token bound to `fp`. */
async function sessionFor(username: string, fp: string): Promise<string> {
  sqlite.exec(`INSERT OR IGNORE INTO app_users (username, password_salt, password_hash, role, email)
               VALUES ('${username}', 's1', '${legacyHash('s1', 'Test1234!')}', 'stock', '${username}@corp.ma')`);
  const l = await post('/api/auth/login', { username, password: 'Test1234!', fingerprint: fp });
  expect(l.status).toBe(200);
  expect(l.body.needs_otp).toBe(true);
  const row = sqlite.prepare(`SELECT code FROM otp_codes WHERE resource_type = 'login' AND resource_id = ?`).get(`fp:${fp}`) as any;
  expect(row?.code).toBeTruthy();
  const v = await post('/api/auth/verify-otp', { username, password: 'Test1234!', otp: String(row.code), fingerprint: fp });
  expect(v.status).toBe(200);
  expect(v.body.token).toBeTruthy();
  return String(v.body.token);
}

async function patch(path: string, body: any, headers: Record<string, string> = {}) {
  const res = await app.fetch(
    new Request(`http://test.local${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.87', ...headers },
      body: JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
}

describe('profile details are stored in the database', () => {
  it('migration 0021 creates user_profile_prefs on a blank database', () => {
    const made = makeD1();
    made.sqlite.exec(readFileSync('migrations/0021_user_profile_prefs.sql', 'utf8'));
    made.sqlite.exec(readFileSync('migrations/0021_user_profile_prefs.sql', 'utf8')); // idempotent
    const cols = made.sqlite.prepare(`PRAGMA table_info(user_profile_prefs)`).all().map((r: any) => r.name);
    expect(cols).toEqual(['username', 'timezone', 'working_hours', 'job_title', 'updated_at']);
  });

  it('PATCH /api/auth/me saves timezone, hours and job title; GET returns them with the update time', async () => {
    sqlite.exec(readFileSync('migrations/0021_user_profile_prefs.sql', 'utf8'));
    const token = await sessionFor('mag', 'fp-prof');
    const auth = { Authorization: `Bearer ${token}`, 'X-Device-Fingerprint': 'fp-prof' };

    const before = await get('/api/auth/me', auth);
    expect(before.status).toBe(200);
    expect(before.body.data.timezone).toBe('Africa/Casablanca');
    expect(before.body.data.profile_updated_at).toBe('');

    const saved = await patch('/api/auth/me', {
      display_name: 'MY Marbre', email: 'mag@corp.ma',
      timezone: 'Europe/Paris', working_hours: '08:30 – 17:30', job_title: 'Gérant',
    }, auth);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.data).toMatchObject({ timezone: 'Europe/Paris', working_hours: '08:30 – 17:30', job_title: 'Gérant' });
    expect(saved.body.data.profile_updated_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    const row = sqlite.prepare(`SELECT * FROM user_profile_prefs WHERE username = 'mag'`).get() as any;
    expect(row).toMatchObject({ timezone: 'Europe/Paris', working_hours: '08:30 – 17:30', job_title: 'Gérant' });

    const after = await get('/api/auth/me', auth);
    expect(after.body.data).toMatchObject({ timezone: 'Europe/Paris', working_hours: '08:30 – 17:30', job_title: 'Gérant' });
    expect(after.body.data.profile_updated_at).toBe(row.updated_at);

    // A partial update keeps the other saved fields.
    const partial = await patch('/api/auth/me', { job_title: 'Comptable' }, auth);
    expect(partial.status).toBe(200);
    expect(partial.body.data).toMatchObject({ timezone: 'Europe/Paris', working_hours: '08:30 – 17:30', job_title: 'Comptable' });
  });

  it('rejects an invalid time zone and keeps each login separate', async () => {
    sqlite.exec(readFileSync('migrations/0021_user_profile_prefs.sql', 'utf8'));
    const tokenA = await sessionFor('mag', 'fp-pa');
    const tokenB = await sessionFor('caisse', 'fp-pb');
    const authA = { Authorization: `Bearer ${tokenA}`, 'X-Device-Fingerprint': 'fp-pa' };
    const authB = { Authorization: `Bearer ${tokenB}`, 'X-Device-Fingerprint': 'fp-pb' };

    const bad = await patch('/api/auth/me', { timezone: 'Mars/Olympus' }, authA);
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_TIMEZONE');
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM user_profile_prefs`).get().n).toBe(0);

    expect((await patch('/api/auth/me', { timezone: 'UTC', job_title: 'Stock' }, authA)).status).toBe(200);
    const other = await get('/api/auth/me', authB);
    expect(other.body.data.timezone).toBe('Africa/Casablanca');
    expect(other.body.data.job_title).toBe('');
  });

  it('cannot change role or username through the new fields', async () => {
    sqlite.exec(readFileSync('migrations/0021_user_profile_prefs.sql', 'utf8'));
    const token = await sessionFor('mag', 'fp-role');
    const auth = { Authorization: `Bearer ${token}`, 'X-Device-Fingerprint': 'fp-role' };
    const r = await patch('/api/auth/me', { job_title: 'Admin', role: 'owner' }, auth);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('ROLE_LOCKED');
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM user_profile_prefs`).get().n).toBe(0);
  });
});
