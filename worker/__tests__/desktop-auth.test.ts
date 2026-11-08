import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { desktopHash, DESKTOP_AUTH } from '../routes/desktopAuth';
const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = await import(SQLITE_MODULE);
async function sha256(s: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), b => b.toString(16).padStart(2, '0')).join('');
}
let IP = '203.0.113.100';
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
    CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, role TEXT, action TEXT, entity TEXT, entity_id TEXT, detail TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')));
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


const ORIGIN = 'https://inventaire.self-hosted.example:8443';
const DESKTOP_FP = 'desktop-fingerprint-0123456789';
const BROWSER_FP = 'browser-fingerprint-0123456789';
const VERIFIER = 'v'.repeat(64);
const STATE = 's'.repeat(64);
let browserToken: string;
let requestData: any;
let logs: unknown[][];
let browserIP: string;

beforeEach(async () => {
  browserIP = `198.51.100.${ipSeq}`;
  logs = [];
  for (const method of ['warn', 'error', 'info', 'log'] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logs.push(args); });
  const hash = await sha256('pc:alice-salt:ExamplePassword123!');
  sqlite.prepare('INSERT INTO app_users (username, role, password_salt, password_hash, email) VALUES (?, ?, ?, ?, ?)').run('alice', 'user', 'alice-salt', hash, 'alice@example.test');
  sqlite.prepare('INSERT INTO trusted_devices (fingerprint, username) VALUES (?, ?)').run(BROWSER_FP, 'alice');
  browserToken = await tokenFor('alice', 'user', hash, BROWSER_FP, browserIP);
});
afterEach(() => { sqlite.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function tokenFor(user: string, role: string, material: string, fp: string, ip: string) {
  return btoa(`stock-auth-v2|${user}|${role}|${ip}|${fp}|${await sha256(`proof|${user}|${role}|${material}|${ip}|${fp}`)}`);
}
async function call(path: string, body?: any, options: { web?: boolean; headers?: Record<string, string>; origin?: string; method?: string } = {}) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json', 'CF-Connecting-IP': options.web ? browserIP : IP,
    'X-Device-Fingerprint': options.web ? BROWSER_FP : DESKTOP_FP,
    ...(options.web ? { Authorization: `Bearer ${browserToken}`, Origin: ORIGIN } : {}), ...options.headers,
  };
  const response = await app.fetch(new Request(`${options.origin || ORIGIN}${path}`, {
    method: options.method || 'POST', headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env, { waitUntil() {} });
  return { status: response.status, body: await response.json() as any, headers: response.headers };
}
async function create(extra = {}) {
  const result = await call(`${DESKTOP_AUTH}/requests`, { origin: ORIGIN, state: STATE, code_challenge: await desktopHash(VERIFIER), code_challenge_method: 'S256', device_label: 'Mon desktop', ...extra });
  expect(result.status).toBe(201);
  requestData = result.body.data;
  return requestData;
}
const browserBody = (extra = {}) => ({ request_id: requestData.request_id, origin: ORIGIN, state: STATE, ...extra });
const desktopBody = (extra = {}) => browserBody({ code_verifier: VERIFIER, ...extra });
async function consent(decision: 'approve' | 'deny' = 'approve') {
  const prepared = await call(`${DESKTOP_AUTH}/prepare`, browserBody(), { web: true });
  expect(prepared.status).toBe(200);
  const result = await call(`${DESKTOP_AUTH}/authorize`, browserBody({ csrf_token: prepared.body.data.csrf_token, decision }), { web: true });
  expect(result.status).toBe(200);
  return prepared.body.data;
}
const statusOf = () => sqlite.prepare('SELECT status FROM desktop_auth_v1 WHERE id = ?').get(requestData.request_id).status;

describe('desktop v1 — real Worker, web authentication and D1 transitions', () => {
  it('discovers a versioned flow on a custom HTTPS origin, without hardcoded production domains', async () => {
    const capabilities = await call(`${DESKTOP_AUTH}/capabilities`, undefined, { method: 'GET' });
    expect(capabilities.body.data).toMatchObject({ version: 1, callbacks: false, flow: 'system_browser_pkce_polling', interval: 5 });
    const request = await create();
    const url = new URL(request.authorization_url);
    expect(url.origin).toBe(ORIGIN);
    expect(url.pathname).toBe('/login/desktop');
    expect(url.search).toBe('');
    expect(url.hash).not.toContain(VERIFIER);
    expect(request.expires_in).toBe(300);
    expect(JSON.stringify(request)).not.toContain('stock-auth');
  });

  it('already signed-in browser: opening/preparing does not authorize; explicit consent is necessary', async () => {
    await create();
    expect((await call(`${DESKTOP_AUTH}/exchange`, desktopBody())).body.code).toBe('NOT_APPROVED');
    const prepared = await call(`${DESKTOP_AUTH}/prepare`, browserBody(), { web: true });
    expect(prepared.status).toBe(200);
    expect(prepared.body.data).toMatchObject({ origin: ORIGIN, username: 'alice', pairing_code: requestData.pairing_code });
    expect(statusOf()).toBe('pending');
    expect((await call(`${DESKTOP_AUTH}/exchange`, desktopBody())).body.code).toBe('NOT_APPROVED');
    expect((await call(`${DESKTOP_AUTH}/authorize`, browserBody({ csrf_token: prepared.body.data.csrf_token, decision: 'approve' }), { web: true })).status).toBe(200);
    const poll = await call(`${DESKTOP_AUTH}/poll`, desktopBody());
    expect(poll.body.data).toMatchObject({ status: 'approved', origin: ORIGIN, state: STATE });
    expect(JSON.stringify(poll.body)).not.toContain('token');
    const exchanged = await call(`${DESKTOP_AUTH}/exchange`, desktopBody());
    expect(exchanged.status).toBe(200);
    const token = exchanged.body.data.token;
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('auth.desktop_approve','auth.desktop_exchange')").get().n).toBe(2);
    const audit = JSON.stringify(sqlite.prepare('SELECT * FROM audit_log').all());
    expect(audit).not.toContain(VERIFIER);
    expect(audit).not.toContain(token);
    expect(audit).not.toContain(browserToken);
    const parts = atob(token).split('|');
    expect(parts.slice(0, 5)).toEqual(['stock-auth-v2', 'alice', 'user', IP, DESKTOP_FP]);
    expect(parts).not.toContain(BROWSER_FP);
    const device = sqlite.prepare('SELECT username, last_ip FROM trusted_devices WHERE fingerprint = ?').get(DESKTOP_FP);
    expect(device).toMatchObject({ username: 'alice', last_ip: IP });
    const authenticated = await call('/api/auth/me', undefined, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
    expect(authenticated.status).toBe(200);
    const impersonated = await call('/api/auth/me', undefined, { method: 'GET', headers: { Authorization: `Bearer ${token}`, 'X-Device-Fingerprint': BROWSER_FP } });
    expect(impersonated.status).toBe(401);
    expect(exchanged.headers.get('Cache-Control')).toContain('no-store');
    expect(exchanged.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect((await call(`${DESKTOP_AUTH}/exchange`, desktopBody())).body.code).toBe('USED');
  });

  it('logged-out browser must use real web login + OTP, then explicitly authorize the preserved request', async () => {
    await create();
    const anonymous = await call(`${DESKTOP_AUTH}/prepare`, browserBody(), { web: true, headers: { Authorization: '' } });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('Cache-Control')).toBe('no-store');
    const login = await call('/api/auth/login', { username: 'alice', password: 'ExamplePassword123!', fingerprint: BROWSER_FP, client: 'web' }, { web: true, headers: { Authorization: '' } });
    expect(login.status).toBe(200);
    expect(login.body.needs_otp).toBe(true);
    expect(login.body.token).toBeUndefined();
    expect(sendSpy).toHaveBeenCalled();
    expect(statusOf()).toBe('pending');
    const otp = sqlite.prepare("SELECT code FROM otp_codes WHERE resource_type = 'login' AND resource_id = ?").get(`fp:${BROWSER_FP}`).code;
    const wrong = await call('/api/auth/verify-otp', { username: 'alice', otp: 'wrong', fingerprint: BROWSER_FP }, { web: true, headers: { Authorization: '' } });
    expect(wrong.status).toBe(401);
    const verified = await call('/api/auth/verify-otp', { username: 'alice', otp, fingerprint: BROWSER_FP }, { web: true, headers: { Authorization: '' } });
    expect(verified.status).toBe(200);
    browserToken = verified.body.token;
    expect(statusOf()).toBe('pending');
    await consent();
    expect((await call(`${DESKTOP_AUTH}/exchange`, desktopBody())).status).toBe(200);
    expect(JSON.stringify(logs)).not.toContain(otp);
    expect(JSON.stringify(logs)).not.toContain(browserToken);
  });

  it('normal web Turnstile protections are not bypassed by a desktop request', async () => {
    await create();
    env.TURNSTILE_SECRET_KEY = 'test-turnstile-secret';
    env.TURNSTILE_SITE_KEY = 'test-turnstile-site';
    const result = await call('/api/auth/login', { username: 'alice', password: 'ExamplePassword123!', fingerprint: BROWSER_FP, client: 'web' }, { web: true, headers: { Authorization: '' } });
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('TURNSTILE_FAILED');
    expect(statusOf()).toBe('pending');
  });

  it('refusal prevents exchange and cannot later be approved', async () => {
    await create(); await consent('deny');
    expect((await call(`${DESKTOP_AUTH}/exchange`, desktopBody())).body.code).toBe('DENIED');
    expect((await call(`${DESKTOP_AUTH}/prepare`, browserBody(), { web: true })).body.code).toBe('DENIED');
  });

  it.each(['pending', 'approved'])('desktop cancellation blocks %s grants and remains idempotent', async state => {
    await create();
    if (state === 'approved') await consent();
    expect((await call(`${DESKTOP_AUTH}/cancel`, desktopBody())).body.data.status).toBe('cancelled');
    expect((await call(`${DESKTOP_AUTH}/cancel`, desktopBody())).status).toBe(200);
    expect((await call(`${DESKTOP_AUTH}/exchange`, desktopBody())).body.code).toBe('CANCELLED');
  });

  it.each(['pending', 'approved'])('expiry is checked at browser consent and at desktop exchange (%s)', async status => {
    await create();
    const p = await call(`${DESKTOP_AUTH}/prepare`, browserBody(), { web: true });
    if (status === 'approved') expect((await call(`${DESKTOP_AUTH}/authorize`, browserBody({ csrf_token: p.body.data.csrf_token, decision: 'approve' }), { web: true })).status).toBe(200);
    sqlite.prepare('UPDATE desktop_auth_v1 SET expires_at = ?').run(Date.now() - 1);
    expect((await call(`${DESKTOP_AUTH}/authorize`, browserBody({ csrf_token: p.body.data.csrf_token, decision: 'approve' }), { web: true })).body.code).toBe('EXPIRED');
    expect((await call(`${DESKTOP_AUTH}/exchange`, desktopBody())).body.code).toBe('EXPIRED');
  });

  it('consent nonce expires earlier than the full login request', async () => {
    await create();
    const p = await call(`${DESKTOP_AUTH}/prepare`, browserBody(), { web: true });
    sqlite.prepare('UPDATE desktop_auth_v1 SET consent_until = ?').run(Date.now() - 1);
    expect((await call(`${DESKTOP_AUTH}/authorize`, browserBody({ csrf_token: p.body.data.csrf_token, decision: 'approve' }), { web: true })).body.code).toBe('CSRF_INVALID');
    expect(statusOf()).toBe('pending');
  });

  it.each(['state', 'code_verifier', 'request_id', 'origin'])('rejects wrong %s without consuming the grant', async field => {
    await create(); await consent();
    const values: any = { state: 'x'.repeat(64), code_verifier: 'x'.repeat(64), request_id: '0'.repeat(64), origin: 'https://attacker.example' };
    const wrong = await call(`${DESKTOP_AUTH}/exchange`, desktopBody({ [field]: values[field] }));
    expect(wrong.status).toBeGreaterThanOrEqual(400);
    expect(statusOf()).toBe('approved');
    expect((await call(`${DESKTOP_AUTH}/exchange`, desktopBody())).status).toBe(200);
  });

  it('cannot move a grant to a different host even when both hosts share the same D1', async () => {
    await create(); await consent();
    const other = 'https://other-tenant.example';
    const result = await call(`${DESKTOP_AUTH}/exchange`, desktopBody({ origin: other }), { origin: other });
    expect(result.body.code).toBe('INVALID_PROOF');
    expect(statusOf()).toBe('approved');
  });

  it('a browser account switch invalidates the old consent nonce', async () => {
    await create();
    const prepared = await call(`${DESKTOP_AUTH}/prepare`, browserBody(), { web: true });
    const hash = await sha256('different-account-material');
    sqlite.prepare('INSERT INTO app_users (username, role, password_hash) VALUES (?, ?, ?)').run('bob', 'user', hash);
    sqlite.prepare('UPDATE trusted_devices SET username = ? WHERE fingerprint = ?').run('bob', BROWSER_FP);
    browserToken = await tokenFor('bob', 'user', hash, BROWSER_FP, browserIP);
    const result = await call(`${DESKTOP_AUTH}/authorize`, browserBody({ csrf_token: prepared.body.data.csrf_token, decision: 'approve' }), { web: true });
    expect(result.body.code).toBe('CSRF_INVALID');
    expect(statusOf()).toBe('pending');
  });

  it('requires the desktop fingerprint and creation IP at poll, cancel and exchange', async () => {
    await create(); await consent();
    for (const action of ['poll', 'cancel', 'exchange']) {
      for (const headers of ([{ 'X-Device-Fingerprint': BROWSER_FP }, { 'CF-Connecting-IP': browserIP }] as Record<string, string>[])) {
        expect((await call(`${DESKTOP_AUTH}/${action}`, desktopBody(), { headers })).body.code).toBe('INVALID_PROOF');
      }
    }
    expect(statusOf()).toBe('approved');
  });

  it('does not trust the browser fingerprint without its authenticated session proof', async () => {
    await create();
    const result = await call(`${DESKTOP_AUTH}/prepare`, browserBody(), { web: true, headers: { Authorization: 'Bearer forged' } });
    expect(result.status).toBe(401);
    expect(statusOf()).toBe('pending');
  });

  it('rejects missing CSRF, a foreign Origin, and cross-site fetch metadata', async () => {
    await create();
    const p = await call(`${DESKTOP_AUTH}/prepare`, browserBody(), { web: true });
    const body = browserBody({ csrf_token: p.body.data.csrf_token, decision: 'approve' });
    expect((await call(`${DESKTOP_AUTH}/authorize`, { ...body, csrf_token: undefined }, { web: true })).body.code).toBe('CSRF_INVALID');
    for (const headers of ([{ Origin: 'https://evil.example' }, { Origin: '' }, { 'Sec-Fetch-Site': 'cross-site' }] as Record<string, string>[])) {
      expect((await call(`${DESKTOP_AUTH}/authorize`, body, { web: true, headers })).status).toBe(403);
    }
    expect(statusOf()).toBe('pending');
  });

  it('a nonce cannot be transplanted to another request or browser session', async () => {
    await create();
    const first = requestData;
    const p = await call(`${DESKTOP_AUTH}/prepare`, browserBody(), { web: true });
    await create({ state: 'z'.repeat(64) });
    const substituted = await call(`${DESKTOP_AUTH}/authorize`, browserBody({ state: 'z'.repeat(64), csrf_token: p.body.data.csrf_token, decision: 'approve' }), { web: true });
    expect(substituted.body.code).toBe('CSRF_INVALID');
    requestData = first;
    const otherFP = 'other-browser-fingerprint-012345';
    sqlite.prepare('INSERT INTO trusted_devices (fingerprint, username) VALUES (?, ?)').run(otherFP, 'alice');
    const material = sqlite.prepare("SELECT password_hash FROM app_users WHERE username = 'alice'").get().password_hash;
    const other = await tokenFor('alice', 'user', material, otherFP, browserIP);
    const changed = await call(`${DESKTOP_AUTH}/authorize`, browserBody({ csrf_token: p.body.data.csrf_token, decision: 'approve' }), { web: true, headers: { Authorization: `Bearer ${other}`, 'X-Device-Fingerprint': otherFP } });
    expect(changed.body.code).toBe('CSRF_INVALID');
  });

  it('only one concurrent exchange wins, and authorization itself cannot be replayed', async () => {
    await create();
    const p = await consent();
    const replay = await call(`${DESKTOP_AUTH}/authorize`, browserBody({ csrf_token: p.csrf_token, decision: 'approve' }), { web: true });
    expect(replay.body.code).toBe('USED');
    const replies = await Promise.all([call(`${DESKTOP_AUTH}/exchange`, desktopBody()), call(`${DESKTOP_AUTH}/exchange`, desktopBody())]);
    expect(replies.map(r => r.status).sort()).toEqual([200, 409]);
    expect(replies.filter(r => r.body.data?.token)).toHaveLength(1);
  });

  it.each(['password', 'role', 'disabled', 'revoked'])('does not issue after the approving account/device is %s-changed', async change => {
    await create(); await consent();
    if (change === 'password') sqlite.exec("UPDATE app_users SET password_hash = 'changed-material' WHERE username = 'alice'");
    if (change === 'role') sqlite.exec("UPDATE app_users SET role = 'admin' WHERE username = 'alice'");
    if (change === 'disabled') sqlite.exec("UPDATE app_users SET active = 0 WHERE username = 'alice'");
    if (change === 'revoked') sqlite.prepare('DELETE FROM trusted_devices WHERE fingerprint = ?').run(BROWSER_FP);
    expect((await call(`${DESKTOP_AUTH}/exchange`, desktopBody())).body.code).toBe('ACCOUNT_CHANGED');
    expect(sqlite.prepare('SELECT * FROM trusted_devices WHERE fingerprint = ?').get(DESKTOP_FP)).toBeUndefined();
  });

  it('bounds polling interval/count and creation attempts, without consuming login/OTP buckets', async () => {
    await create();
    expect((await call(`${DESKTOP_AUTH}/poll`, desktopBody())).status).toBe(200);
    expect((await call(`${DESKTOP_AUTH}/poll`, desktopBody())).body.code).toBe('SLOW_DOWN');
    sqlite.exec('UPDATE desktop_auth_v1 SET polls = 60');
    expect((await call(`${DESKTOP_AUTH}/poll`, desktopBody())).body.code).toBe('RATE_LIMITED');
    for (let i = 0; i < 4; i++) await create();
    const limited = await call(`${DESKTOP_AUTH}/requests`, { origin: ORIGIN, state: STATE, code_challenge: await desktopHash(VERIFIER), code_challenge_method: 'S256' });
    expect(limited.body.code).toBe('RATE_LIMITED');
    expect(limited.status).toBe(429);
  });

  it('rejects callback URI registration, query secrets, plain PKCE and non-HTTPS origins', async () => {
    const data = { origin: ORIGIN, state: STATE, code_challenge: await desktopHash(VERIFIER), code_challenge_method: 'S256' };
    for (const extra of [{ redirect_uri: 'http://127.0.0.1:4321/callback' }, { callback: 'atlas://callback' }, { code_challenge_method: 'plain' }, { origin: `${ORIGIN}/` }, { state: ['x'] }]) {
      expect((await call(`${DESKTOP_AUTH}/requests`, { ...data, ...extra })).status).toBe(400);
    }
    const http = await call(`${DESKTOP_AUTH}/requests`, { ...data, origin: 'http://self-hosted.example' }, { origin: 'http://self-hosted.example', headers: { 'CF-Connecting-IP': '192.0.2.50' } });
    expect(http.body.code).toBe('HTTPS_REQUIRED');
    expect((await call(`${DESKTOP_AUTH}/requests?token=not-a-session`, data, { headers: { 'CF-Connecting-IP': '192.0.2.51' } })).status).toBe(400);
  });

  it('logs only fixed diagnostic codes, including raw DB exceptions in route handlers', async () => {
    await create(); await consent();
    const success = await call(`${DESKTOP_AUTH}/exchange`, desktopBody());
    const token = success.body.data.token;
    await call(`${DESKTOP_AUTH}/exchange`, desktopBody({ code_verifier: 'x'.repeat(64) }));
    const original = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation((...args: unknown[]) => {
      const sql = String(args[0]);
      if (sql.startsWith('SELECT * FROM desktop_auth_v1')) throw new Error(`DB details ${VERIFIER} ${browserToken} ${token}`);
      return original(sql);
    });
    const failure = await call(`${DESKTOP_AUTH}/exchange`, desktopBody());
    expect(failure.status).toBe(503);
    for (const text of [JSON.stringify(logs), JSON.stringify(failure.body)]) {
      expect(text).not.toContain(VERIFIER);
      expect(text).not.toContain(STATE);
      expect(text).not.toContain(browserToken);
      expect(text).not.toContain(token);
      expect(text).not.toContain('DB details');
    }
    expect(JSON.stringify(logs)).toContain('UNAVAILABLE');
  });

  it('issues the existing owner session format without taking a role from client input', async () => {
    await create();
    sqlite.prepare('UPDATE trusted_devices SET username = ? WHERE fingerprint = ?').run('admin', BROWSER_FP);
    const ownerMaterial = await sha256('owner-key|admin|OwnerPass123!');
    browserToken = await tokenFor('admin', 'owner', ownerMaterial, BROWSER_FP, browserIP);
    await consent();
    const result = await call(`${DESKTOP_AUTH}/exchange`, desktopBody());
    expect(result.status).toBe(200);
    expect(result.body.data.role).toBe('owner');
    expect((await call('/api/auth/me', undefined, { method: 'GET', headers: { Authorization: `Bearer ${result.body.data.token}` } })).status).toBe(200);
  });

  it('implements the RFC 7636 S256 test vector', async () => {
    expect(await desktopHash('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('fails closed if device registration fails after one-time consumption', async () => {
    await create(); await consent();
    const original = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation((...args: unknown[]) => {
      const sql = String(args[0]);
      if (sql.includes('INSERT INTO trusted_devices')) throw new Error(`never log ${VERIFIER}`);
      return original(sql);
    });
    const failed = await call(`${DESKTOP_AUTH}/exchange`, desktopBody());
    expect(failed.status).toBe(503);
    expect(failed.body.data?.token).toBeUndefined();
    expect((await call(`${DESKTOP_AUTH}/exchange`, desktopBody())).body.code).toBe('USED');
    expect(JSON.stringify(logs)).not.toContain(VERIFIER);
  });

  it('legacy PC QR remains available, with its original 60-second expiry', async () => {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS qr_login_sessions (token TEXT PRIMARY KEY, username TEXT, role TEXT, created_by TEXT, status TEXT DEFAULT 'pending', claim_fingerprint TEXT DEFAULT '', claim_ua TEXT DEFAULT '', claim_ip TEXT DEFAULT '', expires_at TEXT, consumed_at TEXT, created_at TEXT DEFAULT (datetime('now')))`);
    const legacy = await call('/api/auth/qr/pc-session', {});
    expect(legacy.status).toBe(200);
    expect(legacy.body.data.expires_in).toBe(60);
    expect(new URL(legacy.body.data.qr_url).origin).toBe(ORIGIN);
    const qr = legacy.body.data.token;
    expect((await call(`/api/auth/qr/session/${qr}/phone-bind`, { fingerprint: BROWSER_FP, confirm: true }, { web: true })).status).toBe(200);
    const complete = await call(`/api/auth/qr/session/${qr}/complete`, { fingerprint: DESKTOP_FP });
    expect(complete.status).toBe(200);
    expect(atob(complete.body.data.token).split('|')[4]).toBe(DESKTOP_FP);
    expect((await call(`/api/auth/qr/session/${qr}/complete`, { fingerprint: DESKTOP_FP })).body.code).toBe('USED');

  });
});
