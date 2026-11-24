/**
 * Desktop v3 opt-in remembered sessions (≤ 30 days) for password/OTP, QR and passkey.
 * Harness mirrors desktop-native-v3-native-login.test.ts (real worker app + node:sqlite D1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashUserPassword } from '../lib/authHelpers';

const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = await import(SQLITE_MODULE);

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sha256Hex(s: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}

async function sha256B64u(s: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
}

function makeD1() {
  const sqlite = new DatabaseSync(':memory:');
  const db: any = {
    withSession(_mode?: string) {
      return db;
    },
    prepare(sql: string) {
      let params: any[] = [];
      const api: any = {
        bind(...p: any[]) {
          params = p;
          return api;
        },
        async run() {
          const stmt = sqlite.prepare(sql);
          if (/\bRETURNING\b/i.test(sql)) {
            const rows = stmt.all(...(params as any)).map((r: any) => ({ ...r }));
            const ch = sqlite.prepare('SELECT changes() AS c').get() as { c: number };
            return { success: true, results: rows, meta: { changes: Number(ch?.c ?? rows.length), last_row_id: 0 } };
          }
          const r = stmt.run(...(params as any));
          return { success: true, results: [], meta: { changes: Number(r.changes || 0), last_row_id: Number(r.lastInsertRowid || 0) } };
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
      sqlite.exec('BEGIN');
      try {
        for (const st of stmts) out.push(await st.run());
        sqlite.exec('COMMIT');
        return out;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return { db, sqlite };
}

async function createP256Device() {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const pubJwk = { kty: jwk.kty!, crv: jwk.crv!, x: jwk.x!, y: jwk.y! };
  const canonical = JSON.stringify({ crv: pubJwk.crv, kty: pubJwk.kty, x: pubJwk.x, y: pubJwk.y });
  const thumbprint = await sha256B64u(canonical);

  async function signDpop(opts: {
    method: string;
    target: string;
    nonce: string;
    iat?: number;
    accessToken?: string;
    atlasTxn?: string;
    jti?: string;
  }) {
    const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: pubJwk };
    const claims: Record<string, unknown> = {
      jti: opts.jti || b64url(crypto.getRandomValues(new Uint8Array(24))),
      htm: opts.method,
      htu: opts.target,
      iat: opts.iat ?? Math.floor(Date.now() / 1000),
      nonce: opts.nonce,
    };
    if (opts.accessToken) claims.ath = await sha256B64u(opts.accessToken);
    if (opts.atlasTxn) claims.atlas_txn = opts.atlasTxn;
    const h = b64url(new TextEncoder().encode(JSON.stringify(header)));
    const p = b64url(new TextEncoder().encode(JSON.stringify(claims)));
    const sig = new Uint8Array(
      await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        kp.privateKey,
        new TextEncoder().encode(`${h}.${p}`),
      ),
    );
    return `${h}.${p}.${b64url(sig)}`;
  }

  return { thumbprint, signDpop };
}

const ORIGIN = 'https://stock.afmarbre.test';
const ALICE_PASSWORD = 'StrongAlicePassword!2026';
const OWNER_PASSWORD = 'OwnerPass123!';
const VERIFIER = 'v'.repeat(64);
const STATE = 's'.repeat(64);

let sqlite: any;
let db: any;
let app: any;
let env: any;
let ipSeq = 10;
let IP = '203.0.113.10';
let sentEmails: Array<{ to: string[]; subject: string; text: string }> = [];
let turnstileMode: 'ok' | 'fail' = 'ok';
let aliceToken = '';
let ownerToken = '';

async function tokenFor(user: string, role: string, material: string, fp: string, ip: string) {
  return btoa(
    `stock-auth-v2|${user}|${role}|${ip}|${fp}|${await sha256Hex(`proof|${user}|${role}|${material}|${ip}|${fp}`)}`,
  );
}

async function call(
  path: string,
  body?: any,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    ip?: string;
    origin?: string;
  } = {},
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'CF-Connecting-IP': opts.ip || IP,
    ...opts.headers,
  };
  const res = await app.fetch(
    new Request(`${opts.origin || ORIGIN}${path}`, {
      method: opts.method || 'POST',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env,
    { waitUntil() {} },
  );
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, headers: res.headers, body: json };
}

function extractOtp(text: string): string {
  const m = text.match(/\b(\d{6})\b/);
  if (!m) throw new Error(`OTP not found in email: ${text}`);
  return m[1];
}

beforeEach(async () => {
  const made = makeD1();
  db = made.db;
  sqlite = made.sqlite;
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS company_settings (id INTEGER PRIMARY KEY, company_name TEXT DEFAULT '', email TEXT DEFAULT '');
    INSERT INTO company_settings (id, company_name, email) VALUES (1, 'AtlasMarbre', 'company@afmarbre.test');
    CREATE TABLE IF NOT EXISTS app_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT DEFAULT '',
      password_salt TEXT DEFAULT '', role TEXT DEFAULT 'user', display_name TEXT DEFAULT '',
      active INTEGER DEFAULT 1, email TEXT DEFAULT '', phone TEXT DEFAULT '', avatar_url TEXT DEFAULT '', notes TEXT DEFAULT '', created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')), last_login TEXT
    );
    CREATE TABLE IF NOT EXISTS login_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL, fingerprint TEXT DEFAULT '', success INTEGER DEFAULT 0, reputation_delta INTEGER DEFAULT 0, user_agent TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS ip_reputation (ip TEXT PRIMARY KEY, score INTEGER NOT NULL DEFAULT 50, failed_count INTEGER DEFAULT 0, success_count INTEGER DEFAULT 0, blocked_until TEXT, updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS otp_codes (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), UNIQUE(resource_type, resource_id));
    CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, role TEXT, action TEXT, entity TEXT, entity_id TEXT, detail TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS trusted_devices (fingerprint TEXT PRIMARY KEY, label TEXT DEFAULT '', last_ip TEXT DEFAULT '', last_seen TEXT DEFAULT (datetime('now')), created_at TEXT DEFAULT (datetime('now')), biometric_credential_id TEXT DEFAULT '', username TEXT DEFAULT '', user_agent TEXT DEFAULT '', city TEXT DEFAULT '', country TEXT DEFAULT '', resume_until TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS qr_login_sessions (token TEXT PRIMARY KEY, username TEXT, role TEXT, created_by TEXT, status TEXT DEFAULT 'pending', claim_fingerprint TEXT DEFAULT '', claim_ua TEXT DEFAULT '', claim_ip TEXT DEFAULT '', expires_at TEXT, consumed_at TEXT, created_at TEXT DEFAULT (datetime('now')));
  `);

  ipSeq += 1;
  IP = `203.0.113.${ipSeq}`;
  sentEmails = [];
  turnstileMode = 'ok';

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: any, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url === 'https://api.resend.com/emails') {
        const payload = JSON.parse(String(init?.body || '{}'));
        sentEmails.push({ to: payload.to, subject: payload.subject, text: payload.text });
        return new Response(JSON.stringify({ id: 'email_123' }), { status: 200 });
      }
      if (url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
        if (turnstileMode === 'ok') {
          return new Response(
            JSON.stringify({
              success: true,
              hostname: 'stock.afmarbre.test',
              action: 'atlas_desktop_v3',
              cdata: JSON.parse(String(init?.body || '{}'))?.cdata || '',
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ success: false }), { status: 200 });
      }
      throw new Error(`Unexpected outbound fetch: ${url}`);
    }),
  );

  // Also captureTurnstile form-urlencoded cdata cleanly
  (globalThis.fetch as any).mockImplementation(async (input: any, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === 'https://api.resend.com/emails') {
      const payload = JSON.parse(String(init?.body || '{}'));
      sentEmails.push({ to: payload.to, subject: payload.subject, text: payload.text });
      return new Response(JSON.stringify({ id: 'email_123' }), { status: 200 });
    }
    if (url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
      const bodyParams = new URLSearchParams(String(init?.body || ''));
      const expectedCdata = String((env as any).__lastCdata || '');
      if (turnstileMode === 'ok') {
        return new Response(
          JSON.stringify({
            success: true,
            hostname: 'stock.afmarbre.test',
            action: 'atlas_desktop_v3',
            cdata: expectedCdata || bodyParams.get('cdata') || '',
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ success: false }), { status: 200 });
    }
    throw new Error(`Unexpected outbound fetch: ${url}`);
  });

  const salt = 'alice-v3-salt-001';
  const aliceHash = await hashUserPassword(ALICE_PASSWORD, salt);
  const inserted = sqlite
    .prepare('INSERT INTO app_users (username, role, password_salt, password_hash, email) VALUES (?, ?, ?, ?, ?)')
    .run('alice', 'secretaire', salt, aliceHash, 'unverified-directory@afmarbre.test');
  void inserted;

  sqlite.prepare('INSERT INTO trusted_devices (fingerprint, username) VALUES (?, ?)').run('alice-web-fp', 'alice');
  sqlite.prepare('INSERT INTO trusted_devices (fingerprint, username) VALUES (?, ?)').run('owner-web-fp', 'admin');

  aliceToken = await tokenFor('alice', 'secretaire', aliceHash, 'alice-web-fp', IP);
  const ownerMaterial = await sha256Hex(`owner-key|admin|${OWNER_PASSWORD}`);
  ownerToken = await tokenFor('admin', 'owner', ownerMaterial, 'owner-web-fp', IP);

  env = {
    DB: db,
    CACHE: {},
    EMAIL: { send: vi.fn(async () => ({})) },
    ADMIN_PASSWORD: OWNER_PASSWORD,
    ENVIRONMENT: 'staging',
    TURNSTILE_SITE_KEY: '0x4AAAAAA_TEST_SITE_KEY',
    TURNSTILE_SECRET_KEY: '0x4AAAAAA_TEST_SECRET_KEY',
    DESKTOP_NATIVE_V3_ENABLED: 'true',
    DESKTOP_NATIVE_V3_OTP_KEY: 'v3-otp-hmac-secret-at-least-32-characters',
    DESKTOP_NATIVE_MAILBOX_MAC_KEY: 'v3-mailbox-mac-secret-at-least-32-chars',
    DESKTOP_NATIVE_MAIL_TRANSPORT: 'resend-v1',
    DESKTOP_NATIVE_RESEND_API_KEY: 're_test_key_123456',
    DESKTOP_NATIVE_MAIL_FROM: 'security@afmarbre.test',
  };

  const mod: any = await import('../index');
  app = mod.default?.fetch ? mod.default : mod.app;
});

afterEach(() => {
  sqlite.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function getNonce(ip = IP): Promise<string> {
  const res = await call('/api/auth/desktop/v3/nonce', undefined, { ip });
  expect(res.status).toBe(200);
  return res.body.data.nonce;
}

async function enrollAliceMailbox(email = 'alice.personal@example.test') {
  const start = await call(
    '/api/auth/desktop/v3/mailbox/enroll/start',
    { password: ALICE_PASSWORD, email },
    { headers: { Authorization: `Bearer ${aliceToken}`, 'X-Device-Fingerprint': 'alice-web-fp' } },
  );
  expect(start.status).toBe(201);
  expect(sentEmails.length).toBeGreaterThanOrEqual(1);
  const newOtp = extractOtp(sentEmails[sentEmails.length - 1].text);

  const confirm = await call(
    '/api/auth/desktop/v3/mailbox/enroll/confirm',
    { password: ALICE_PASSWORD, request_id: start.body.data.request_id, new_code: newOtp },
    { headers: { Authorization: `Bearer ${aliceToken}`, 'X-Device-Fingerprint': 'alice-web-fp' } },
  );
  expect(confirm.status).toBe(200);
  expect(confirm.body.data.enrolled).toBe(true);
}


const V3 = '/api/auth/desktop/v3';


/** Raw r||s (WebCrypto) -> DER, like real authenticators return. */
function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (x: Uint8Array) => {
    let i = 0;
    while (i < x.length - 1 && x[i] === 0) i++;
    let v = x.subarray(i);
    if (v[0] & 0x80) v = Uint8Array.from([0, ...v]);
    return Uint8Array.from([0x02, v.length, ...v]);
  };
  const r = int(raw.subarray(0, 32));
  const s = int(raw.subarray(32));
  return Uint8Array.from([0x30, r.length + s.length, ...r, ...s]);
}

async function nativeRequest(dev: Awaited<ReturnType<typeof createP256Device>>, ip = IP) {
  const nonce = await getNonce(ip);
  const proof = await dev.signDpop({ method: 'POST', target: `${ORIGIN}${V3}/requests`, nonce });
  return call(
    `${V3}/requests`,
    {
      origin: ORIGIN,
      state: STATE,
      code_challenge: await sha256B64u(VERIFIER),
      code_challenge_method: 'S256',
      device_label: 'Poste Windows 11',
      presentation: 'native',
    },
    { headers: { DPoP: proof }, ip },
  );
}

async function proofCall(
  dev: Awaited<ReturnType<typeof createP256Device>>,
  path: string,
  requestId: string,
  extra: Record<string, unknown> = {},
  ip = IP,
) {
  const nonce = await getNonce(ip);
  const proof = await dev.signDpop({ method: 'POST', target: `${ORIGIN}${V3}/${path}`, nonce, atlasTxn: requestId });
  return call(
    `${V3}/${path}`,
    { origin: ORIGIN, request_id: requestId, state: STATE, code_verifier: VERIFIER, ...extra },
    { headers: { DPoP: proof }, ip },
  );
}


const HOUR = 3_600_000;
const DAY = 86_400_000;
type Device = Awaited<ReturnType<typeof createP256Device>>;

async function refreshWith(dev: Device, refreshToken: string) {
  const nonce = await getNonce();
  const proof = await dev.signDpop({ method: 'POST', target: `${ORIGIN}${V3}/session/refresh`, nonce });
  return call(`${V3}/session/refresh`, { origin: ORIGIN, refresh_token: refreshToken }, { headers: { DPoP: proof } });
}

async function logoutWith(dev: Device, refreshToken: string) {
  const nonce = await getNonce();
  const proof = await dev.signDpop({ method: 'POST', target: `${ORIGIN}${V3}/session/logout`, nonce });
  return call(`${V3}/session/logout`, { origin: ORIGIN, refresh_token: refreshToken }, { headers: { DPoP: proof } });
}

async function me(dev: Device, accessToken: string) {
  return call('/api/auth/me', undefined, {
    method: 'GET',
    headers: {
      Authorization: `DPoP ${accessToken}`,
      DPoP: await dev.signDpop({ method: 'GET', target: `${ORIGIN}/api/auth/me`, nonce: await getNonce(), accessToken }),
    },
  });
}

/** Full native password → verified-mailbox OTP login. `extra` is merged into the OTP call body. */
async function passwordLogin(dev: Device, extra: Record<string, unknown> = {}) {
  const id = (await nativeRequest(dev)).body.data.request_id;
  const pw = await proofCall(dev, 'login/password', id, { username: 'alice', password: ALICE_PASSWORD });
  expect(pw.status).toBe(200);
  await new Promise((r) => setTimeout(r, 20));
  const otp = extractOtp(sentEmails[sentEmails.length - 1].text);
  return { id, otp, res: await proofCall(dev, 'login/otp', id, { otp, ...extra }) };
}

async function qrLogin(dev: Device, extra: Record<string, unknown> = {}) {
  const id = (await nativeRequest(dev)).body.data.request_id;
  const token = new URL((await proofCall(dev, 'qr/start', id)).body.data.qr_url).searchParams.get('t')!;
  const auth = { Authorization: `Bearer ${aliceToken}`, 'X-Device-Fingerprint': 'alice-web-fp' };
  expect((await call(`/api/auth/qr/session/${token}/phone-bind`, { fingerprint: 'alice-web-fp', confirm: true }, { headers: auth })).status).toBe(200);
  return proofCall(dev, 'qr/exchange', id, extra);
}

function enablePasskeys() {
  env.WEBAUTHN_ENABLED = 'true';
  env.WEBAUTHN_RP_ID = 'stock.afmarbre.test';
  env.WEBAUTHN_ALLOWED_ORIGINS = ORIGIN;
}

async function makeAuthenticator() {
  const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  sqlite.exec(`CREATE TABLE IF NOT EXISTS webauthn_credentials (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, device_type TEXT DEFAULT 'platform', transports TEXT DEFAULT '',
    label TEXT DEFAULT '', username TEXT DEFAULT '', role TEXT DEFAULT '', created_at TEXT, last_used TEXT, device_info TEXT DEFAULT '', public_key_jwk TEXT DEFAULT '',
    counter INTEGER DEFAULT 0, backup_eligible INTEGER DEFAULT 0, backup_state INTEGER DEFAULT 0, rp_id TEXT DEFAULT '', origin TEXT DEFAULT '', cred_user_handle TEXT DEFAULT '')`);
  sqlite
    .prepare("INSERT INTO webauthn_credentials (id, fingerprint, username, role, public_key_jwk, counter) VALUES (?, 'x', 'alice', 'secretaire', ?, 0)")
    .run('cred-alice-1', JSON.stringify({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, alg: 'ES256' }));
  let counter = 0;
  return async (challenge: string) => {
    counter += 1;
    const clientData = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', challenge, origin: ORIGIN, crossOrigin: false }));
    const rpIdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('stock.afmarbre.test')));
    const authData = Uint8Array.from([...rpIdHash, 0x05, 0, 0, 0, counter]);
    const cdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientData));
    const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, Uint8Array.from([...authData, ...cdHash])));
    return { id: 'cred-alice-1', response: { clientDataJSON: b64url(clientData), authenticatorData: b64url(authData), signature: b64url(rawToDer(raw)) } };
  };
}

async function passkeyLogin(dev: Device, sign: (challenge: string) => Promise<any>, extra: Record<string, unknown> = {}) {
  const id = (await nativeRequest(dev)).body.data.request_id;
  const opts = await proofCall(dev, 'webauthn/options', id, { username: 'alice' });
  expect(opts.status).toBe(200);
  return proofCall(dev, 'webauthn/verify', id, { credential: await sign(opts.body.data.challenge), ...extra });
}

function row(sessionId: string) {
  return sqlite.prepare('SELECT remembered, issued_at, absolute_expires_at, revoked FROM desktop_v3_sessions WHERE id=?').get(sessionId);
}

function expectLifetime(data: any, remembered: boolean, before: number, after: number) {
  const ttl = remembered ? 30 * DAY : 12 * HOUR;
  expect(data.remember_me).toBe(remembered);
  expect(data.session_kind).toBe(remembered ? 'remembered' : 'standard');
  expect(data.session_ttl_seconds).toBe(ttl / 1000);
  expect(data.refresh_expires_at).toBe(data.session_expires_at);
  const abs = Date.parse(data.session_expires_at);
  expect(abs).toBeGreaterThanOrEqual(before + ttl - 1000);
  expect(abs).toBeLessThanOrEqual(after + ttl + 1000);
  const stored = row(data.session_id);
  expect(stored.remembered).toBe(remembered ? 1 : 0);
  expect(stored.absolute_expires_at - stored.issued_at).toBe(ttl);
}

/** Move the wall clock (server and DPoP iat move together). */
function advance(ms: number) {
  vi.setSystemTime(Date.now() + ms);
}

describe('Desktop v3 remembered sessions (explicit opt-in, ≤ 30 days absolute)', () => {
  beforeEach(() => {
    env.DESKTOP_NATIVE_V3_NATIVE_LOGIN = 'true';
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-20T08:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('advertises the remember-me contract in capabilities, follows the policy, and keeps it off when v3 is not ready', async () => {
    enablePasskeys();
    const caps = await call(`${V3}/capabilities`, undefined, { method: 'GET' });
    expect(caps.status).toBe(200);
    expect(caps.body.data.session).toEqual({
      access_ttl_seconds: 900,
      default_ttl_seconds: 43_200,
      absolute_expiry: true,
      remember_me: {
        available: true,
        version: 1,
        request_field: 'remember_me',
        default: false,
        max_ttl_seconds: 2_592_000,
        methods: ['password_otp', 'qr', 'passkey'],
        endpoints: { password_otp: `${V3}/login/otp`, qr: `${V3}/qr/exchange`, passkey: `${V3}/webauthn/verify` },
        response_fields: ['remember_me', 'session_kind', 'session_expires_at', 'refresh_expires_at', 'session_ttl_seconds'],
      },
      refresh: {
        path: `${V3}/session/refresh`,
        rotating: true,
        reuse_detection: 'family_revocation',
        dpop_bound: true,
        origin_bound: true,
        extends_absolute_expiry: false,
      },
      logout_path: `${V3}/session/logout`,
    });

    env.DESKTOP_NATIVE_V3_REMEMBER_MAX_DAYS = '7';
    expect((await call(`${V3}/capabilities`, undefined, { method: 'GET' })).body.data.session.remember_me.max_ttl_seconds).toBe(604_800);
    env.DESKTOP_NATIVE_V3_REMEMBER_MAX_DAYS = '90'; // config can never exceed the 30-day ceiling
    expect((await call(`${V3}/capabilities`, undefined, { method: 'GET' })).body.data.session.remember_me.max_ttl_seconds).toBe(2_592_000);
    env.DESKTOP_NATIVE_V3_REMEMBER_MAX_DAYS = '0';
    expect((await call(`${V3}/capabilities`, undefined, { method: 'GET' })).body.data.session.remember_me).toEqual({ available: false, reason: 'POLICY_DISABLED' });

    env.DESKTOP_NATIVE_V3_ENABLED = 'false';
    const off = await call(`${V3}/capabilities`, undefined, { method: 'GET' });
    expect(off.body.data.enabled).toBe(false);
    expect(off.body.data.session).toBeUndefined();
  });

  it('password/OTP: default is the 12 h session; refresh cannot pass the absolute expiry', async () => {
    await enrollAliceMailbox();
    const dev = await createP256Device();
    const t0 = Date.now();
    const { res } = await passwordLogin(dev);
    expect(res.status).toBe(200);
    expect(res.body.data.method).toBe('password_otp');
    expectLifetime(res.body.data, false, t0, Date.now());

    advance(11 * HOUR);
    const ok = await refreshWith(dev, res.body.data.refresh_token);
    expect(ok.status).toBe(200);
    expect(ok.body.data.session_expires_at).toBe(res.body.data.session_expires_at);
    expect(ok.body.data.remember_me).toBe(false);
    expect(Date.parse(ok.body.data.access_expires_at)).toBeLessThanOrEqual(Date.parse(res.body.data.session_expires_at));

    advance(1 * HOUR + 1000);
    const late = await refreshWith(dev, ok.body.data.refresh_token);
    expect(late.status).toBe(401);
    expect(late.body.code).toBe('AUTH_FAILED');
    expect((await me(dev, ok.body.data.access_token)).status).toBe(401);
  });

  it('password/OTP: remember_me=true issues 30 days and survives a client + server restart after the access token expired', async () => {
    await enrollAliceMailbox();
    const dev = await createP256Device();
    const t0 = Date.now();
    const { res } = await passwordLogin(dev, { remember_me: true });
    expect(res.status).toBe(200);
    expectLifetime(res.body.data, true, t0, Date.now());
    expect((await me(dev, res.body.data.access_token)).status).toBe(200);

    // Desktop closed for 10 days: the access token is long dead.
    advance(10 * DAY);
    expect((await me(dev, res.body.data.access_token)).status).toBe(401);

    // Fresh worker isolate (server restart) + the client reloads its stored refresh token and device key.
    vi.resetModules();
    const mod: any = await import('../index');
    app = mod.default?.fetch ? mod.default : mod.app;

    const refreshed = await refreshWith(dev, res.body.data.refresh_token);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data).toMatchObject({
      remember_me: true,
      session_kind: 'remembered',
      session_ttl_seconds: 2_592_000,
      session_id: res.body.data.session_id,
      session_expires_at: res.body.data.session_expires_at, // never extended
      refresh_expires_at: res.body.data.session_expires_at,
      device_thumbprint: dev.thumbprint,
    });
    expect(refreshed.body.data.refresh_token).not.toBe(res.body.data.refresh_token);
    const who = await me(dev, refreshed.body.data.access_token);
    expect(who.status).toBe(200);
    expect(who.body.data.username).toBe('alice');

    // A different device key cannot use the remembered refresh token.
    const thief = await createP256Device();
    expect((await refreshWith(thief, refreshed.body.data.refresh_token)).status).toBe(401);
  });

  it('remembered session hard-expires at 30 days even with continuous refreshes', async () => {
    await enrollAliceMailbox();
    const dev = await createP256Device();
    const { res } = await passwordLogin(dev, { remember_me: true });
    let refresh = res.body.data.refresh_token;
    for (const step of [7, 7, 7, 7]) {
      advance(step * DAY);
      const r = await refreshWith(dev, refresh);
      expect(r.status).toBe(200);
      expect(r.body.data.session_expires_at).toBe(res.body.data.session_expires_at);
      refresh = r.body.data.refresh_token;
    }
    advance(2 * DAY - 60_000); // 29d 23h59m
    const last = await refreshWith(dev, refresh);
    expect(last.status).toBe(200);
    expect(Date.parse(last.body.data.access_expires_at)).toBeLessThanOrEqual(Date.parse(res.body.data.session_expires_at));
    advance(61_000);
    expect((await refreshWith(dev, last.body.data.refresh_token)).status).toBe(401);
    expect((await me(dev, last.body.data.access_token)).status).toBe(401);
  });

  it('rotation + reuse detection: replaying a retired refresh token revokes the whole remembered family', async () => {
    await enrollAliceMailbox();
    const dev = await createP256Device();
    const { res } = await passwordLogin(dev, { remember_me: true });
    advance(3 * DAY);
    const r1 = await refreshWith(dev, res.body.data.refresh_token);
    expect(r1.status).toBe(200);
    const r2 = await refreshWith(dev, r1.body.data.refresh_token);
    expect(r2.status).toBe(200);

    const replay = await refreshWith(dev, res.body.data.refresh_token);
    expect(replay.status).toBe(401);
    expect(row(res.body.data.session_id).revoked).toBe(1);
    expect((await refreshWith(dev, r2.body.data.refresh_token)).status).toBe(401);
    expect((await me(dev, r2.body.data.access_token)).status).toBe(401);
  });

  it('revocation: device logout and admin/self revocation end a remembered session immediately', async () => {
    await enrollAliceMailbox();
    const dev = await createP256Device();
    const first = (await passwordLogin(dev, { remember_me: true })).res.body.data;
    advance(5 * DAY);
    const out = await logoutWith(dev, first.refresh_token);
    expect(out.status).toBe(200);
    expect(out.body.data.status).toBe('revoked');
    expect((await refreshWith(dev, first.refresh_token)).status).toBe(401);
    expect((await me(dev, first.access_token)).status).toBe(401);

    const second = (await passwordLogin(dev, { remember_me: true })).res.body.data;
    const listed = await call(`${V3}/sessions`, undefined, {
      method: 'GET',
      headers: { Authorization: `Bearer ${ownerToken}`, 'X-Device-Fingerprint': 'owner-web-fp' },
    });
    expect(listed.status).toBe(200);
    const entry = listed.body.data.find((s: any) => s.id === second.session_id);
    expect(entry).toMatchObject({ remember_me: true, expires_at: second.session_expires_at });
    expect(Date.parse(entry.issued_at)).toBe(Date.parse(second.session_expires_at) - 30 * DAY);

    const del = await call(`${V3}/sessions/${second.session_id}`, undefined, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${ownerToken}`, 'X-Device-Fingerprint': 'owner-web-fp' },
    });
    expect(del.status).toBe(200);
    expect((await refreshWith(dev, second.refresh_token)).status).toBe(401);

    // Password change revokes remembered sessions too (account trigger).
    const third = (await passwordLogin(dev, { remember_me: true })).res.body.data;
    sqlite.prepare("UPDATE app_users SET password_hash = 'rotated' WHERE username = 'alice'").run();
    expect(row(third.session_id).revoked).toBe(1);
    expect((await refreshWith(dev, third.refresh_token)).status).toBe(401);
  });

  it('QR: remember_me on the final exchange gives 30 days; omitted gives 12 h', async () => {
    const dev = await createP256Device();
    const t0 = Date.now();
    const remembered = await qrLogin(dev, { remember_me: true });
    expect(remembered.status).toBe(200);
    expect(remembered.body.data.method).toBe('qr');
    expectLifetime(remembered.body.data, true, t0, Date.now());

    const standard = await qrLogin(dev);
    expect(standard.status).toBe(200);
    expectLifetime(standard.body.data, false, t0, Date.now());

    advance(20 * DAY);
    expect((await refreshWith(dev, remembered.body.data.refresh_token)).status).toBe(200);
    expect((await refreshWith(dev, standard.body.data.refresh_token)).status).toBe(401);
  });

  it('Windows Hello passkey: remember_me=true gives 30 days; default stays 12 h', async () => {
    enablePasskeys();
    const sign = await makeAuthenticator();
    const dev = await createP256Device();
    const t0 = Date.now();
    const remembered = await passkeyLogin(dev, sign, { remember_me: true });
    expect(remembered.status).toBe(200);
    expect(remembered.body.data.method).toBe('passkey');
    expectLifetime(remembered.body.data, true, t0, Date.now());

    const standard = await passkeyLogin(dev, sign);
    expect(standard.status).toBe(200);
    expectLifetime(standard.body.data, false, t0, Date.now());

    advance(13 * HOUR);
    expect((await refreshWith(dev, remembered.body.data.refresh_token)).status).toBe(200);
    expect((await refreshWith(dev, standard.body.data.refresh_token)).status).toBe(401);
  });

  it('rejects non-boolean remember_me before consuming anything; the request stays usable', async () => {
    await enrollAliceMailbox();
    const dev = await createP256Device();
    const id = (await nativeRequest(dev)).body.data.request_id;
    expect((await proofCall(dev, 'login/password', id, { username: 'alice', password: ALICE_PASSWORD })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    const otp = extractOtp(sentEmails[sentEmails.length - 1].text);
    for (const bad of ['true', 1, null, { on: true }]) {
      const res = await proofCall(dev, 'login/otp', id, { otp, remember_me: bad });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_REQUEST');
    }
    // remember_me is not a field of the password step
    expect((await proofCall(dev, 'login/password', id, { username: 'alice', password: ALICE_PASSWORD, remember_me: true })).status).toBe(400);
    const ok = await proofCall(dev, 'login/otp', id, { otp, remember_me: false });
    expect(ok.status).toBe(200);
    expect(ok.body.data.remember_me).toBe(false);

    const qrDev = await createP256Device();
    const qrId = (await nativeRequest(qrDev)).body.data.request_id;
    expect((await proofCall(qrDev, 'qr/start', qrId)).status).toBe(201);
    expect((await proofCall(qrDev, 'qr/exchange', qrId, { remember_me: 'yes' })).status).toBe(400);
  });

  it('server policy: lower max days caps new and existing remembered sessions; disabled policy issues standard sessions', async () => {
    await enrollAliceMailbox();
    const dev = await createP256Device();
    const thirty = (await passwordLogin(dev, { remember_me: true })).res.body.data;

    env.DESKTOP_NATIVE_V3_REMEMBER_MAX_DAYS = '7';
    const seven = (await passwordLogin(dev, { remember_me: true })).res.body.data;
    expect(seven.remember_me).toBe(true);
    expect(seven.session_ttl_seconds).toBe(604_800);
    // The 30-day session no longer fits the tightened policy.
    expect((await refreshWith(dev, thirty.refresh_token)).status).toBe(401);
    expect((await me(dev, thirty.access_token)).status).toBe(401);
    advance(6 * DAY);
    expect((await refreshWith(dev, seven.refresh_token)).status).toBe(200);

    env.DESKTOP_NATIVE_V3_REMEMBER_MAX_DAYS = '0';
    const off = (await passwordLogin(dev, { remember_me: true })).res.body.data;
    expect(off.remember_me).toBe(false);
    expect(off.session_kind).toBe('standard');
    expect(off.session_ttl_seconds).toBe(43_200);
  });

  it('a stored row can never outlive the 30-day cap (tampered absolute expiry is refused)', async () => {
    await enrollAliceMailbox();
    const dev = await createP256Device();
    const s = (await passwordLogin(dev, { remember_me: true })).res.body.data;
    sqlite.prepare('UPDATE desktop_v3_sessions SET absolute_expires_at = absolute_expires_at + ? WHERE id = ?').run(DAY, s.session_id);
    expect((await refreshWith(dev, s.refresh_token)).status).toBe(401);
    expect((await me(dev, s.access_token)).status).toBe(401);

    const std = (await passwordLogin(dev)).res.body.data;
    sqlite.prepare('UPDATE desktop_v3_sessions SET absolute_expires_at = ?, issued_at = NULL WHERE id = ?').run(Date.now() + 2 * DAY, std.session_id);
    expect((await refreshWith(dev, std.refresh_token)).status).toBe(401);
  });

  it('existing rate limits still apply to remembered families (12 refreshes / 10 min)', async () => {
    await enrollAliceMailbox();
    const dev = await createP256Device();
    let refresh = (await passwordLogin(dev, { remember_me: true })).res.body.data.refresh_token;
    for (let i = 0; i < 12; i++) {
      const r = await refreshWith(dev, refresh);
      expect(r.status).toBe(200);
      refresh = r.body.data.refresh_token;
    }
    const limited = await refreshWith(dev, refresh);
    expect(limited.status).toBe(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
  });

  it('adds the remembered/issued_at columns to an existing sessions table; legacy rows stay standard', async () => {
    sqlite.exec(`
      CREATE TABLE desktop_v3_sessions (id TEXT PRIMARY KEY, origin TEXT NOT NULL, username TEXT NOT NULL, role TEXT NOT NULL, user_id INTEGER,
        credential_tag TEXT NOT NULL, device_thumbprint TEXT NOT NULL, device_label TEXT NOT NULL, access_hash TEXT NOT NULL UNIQUE, refresh_hash TEXT NOT NULL UNIQUE,
        previous_refresh_hash TEXT, access_expires_at INTEGER NOT NULL, absolute_expires_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      INSERT INTO desktop_v3_sessions VALUES ('legacy-sess', 'o', 'alice', 'secretaire', 1, 't', 'd', 'l', 'a', 'r', NULL, 9999999999999, 9999999999999, 1, 0);
    `);
    expect((await nativeRequest(await createP256Device())).status).toBe(201);
    const cols = sqlite.prepare('PRAGMA table_info(desktop_v3_sessions)').all().map((c: any) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['remembered', 'issued_at']));
    expect(sqlite.prepare("SELECT remembered, issued_at FROM desktop_v3_sessions WHERE id='legacy-sess'").get()).toEqual({ remembered: 0, issued_at: null });
  });
});
