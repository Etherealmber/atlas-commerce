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

function turnstileCalls(): number {
  return (globalThis.fetch as any).mock.calls.filter((c: any[]) => String(c[0]?.url || c[0]).includes('turnstile')).length;
}

describe('Desktop v3 browser-free native login (password+OTP, QR, passkey)', () => {
  it('advertises native methods only behind DESKTOP_NATIVE_V3_NATIVE_LOGIN and refuses native requests otherwise', async () => {
    const off = await call(`${V3}/capabilities`, undefined, { method: 'GET' });
    expect(off.body.data.methods.password_otp.challenge_modes).toEqual(['turnstile_webview', 'system_browser']);
    expect(off.body.data.methods.qr.available).toBe(false);
    expect(off.body.data.methods.passkey.available).toBe(false);

    const dev = await createP256Device();
    const refused = await nativeRequest(dev);
    expect(refused.status).toBe(503);
    expect(refused.body.code).toBe('METHOD_DISABLED');

    env.DESKTOP_NATIVE_V3_NATIVE_LOGIN = 'true';
    env.WEBAUTHN_ENABLED = 'true';
    env.WEBAUTHN_RP_ID = 'stock.afmarbre.test';
    env.WEBAUTHN_ALLOWED_ORIGINS = ORIGIN;
    const on = await call(`${V3}/capabilities`, undefined, { method: 'GET' });
    expect(on.body.data.methods.password_otp.challenge_modes[0]).toBe('native');
    expect(on.body.data.methods.qr).toMatchObject({ available: true, start_path: `${V3}/qr/start`, exchange_path: `${V3}/qr/exchange` });
    expect(on.body.data.methods.passkey).toMatchObject({ available: true, rp_id: 'stock.afmarbre.test', origin: ORIGIN });
  });

  it('password -> verified-mailbox OTP -> DPoP session -> refresh, with no Turnstile or browser step', async () => {
    env.DESKTOP_NATIVE_V3_NATIVE_LOGIN = 'true';
    await enrollAliceMailbox();
    const dev = await createP256Device();
    const created = await nativeRequest(dev);
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe('verified');
    expect(created.body.data.challenge_url).toBeUndefined();
    const id = created.body.data.request_id;

    const before = sentEmails.length;
    const pw = await proofCall(dev, 'login/password', id, { username: 'alice', password: ALICE_PASSWORD });
    expect(pw.status).toBe(200);
    expect(pw.body.data.status).toBe('otp_pending');
    await new Promise((r) => setTimeout(r, 20));
    expect(sentEmails.length).toBe(before + 1);
    expect(sentEmails[sentEmails.length - 1].to).toEqual(['alice.personal@example.test']);

    const otp = await proofCall(dev, 'login/otp', id, { otp: extractOtp(sentEmails[sentEmails.length - 1].text) });
    expect(otp.status).toBe(200);
    expect(otp.body.data).toMatchObject({ token_type: 'DPoP', username: 'alice', role: 'secretaire', device_thumbprint: dev.thumbprint });
    expect(turnstileCalls()).toBe(0);

    // The native request is single-use.
    const again = await proofCall(dev, 'login/password', id, { username: 'alice', password: ALICE_PASSWORD });
    expect(again.status).toBe(409);

    const n = await getNonce();
    const refreshProof = await dev.signDpop({ method: 'POST', target: `${ORIGIN}${V3}/session/refresh`, nonce: n });
    const refreshed = await call(`${V3}/session/refresh`, { origin: ORIGIN, refresh_token: otp.body.data.refresh_token }, { headers: { DPoP: refreshProof } });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.access_token).not.toBe(otp.body.data.access_token);
  });

  it('wrong password stays anti-enumerating (otp_pending, no mail) and a different key cannot use the request', async () => {
    env.DESKTOP_NATIVE_V3_NATIVE_LOGIN = 'true';
    await enrollAliceMailbox();
    const dev = await createP256Device();
    const other = await createP256Device();
    const id = (await nativeRequest(dev)).body.data.request_id;

    const stolen = await proofCall(other, 'login/password', id, { username: 'alice', password: ALICE_PASSWORD });
    expect(stolen.status).toBe(401);
    expect(stolen.body.code).toBe('INVALID_PROOF');

    const before = sentEmails.length;
    const bad = await proofCall(dev, 'login/password', id, { username: 'alice', password: 'wrong-password' });
    expect(bad.status).toBe(200);
    expect(bad.body.data.status).toBe('otp_pending');
    await new Promise((r) => setTimeout(r, 20));
    expect(sentEmails.length).toBe(before);
  });

  it('QR: pending -> scanned -> phone approval -> single exchange bound to the desktop key; legacy /complete refused', async () => {
    env.DESKTOP_NATIVE_V3_NATIVE_LOGIN = 'true';
    const dev = await createP256Device();
    const other = await createP256Device();
    const id = (await nativeRequest(dev)).body.data.request_id;

    const start = await proofCall(dev, 'qr/start', id);
    expect(start.status).toBe(201);
    expect(start.body.data.qr_url).toMatch(new RegExp(`^${ORIGIN}/login/qr\\?t=[a-f0-9]{64}&mode=pc$`));
    expect(start.body.data.qr_svg).toContain('<svg');
    const token = new URL(start.body.data.qr_url).searchParams.get('t')!;

    const pending = await proofCall(dev, 'qr/exchange', id);
    expect(pending.status).toBe(202);
    expect(pending.body.data.status).toBe('pending');

    const auth = { Authorization: `Bearer ${aliceToken}`, 'X-Device-Fingerprint': 'alice-web-fp' };
    const scanned = await call(`/api/auth/qr/session/${token}/phone-bind`, { fingerprint: 'alice-web-fp' }, { headers: auth });
    expect(scanned.status).toBe(200);
    expect((await proofCall(dev, 'qr/exchange', id)).body.data.status).toBe('scanned');

    const approved = await call(`/api/auth/qr/session/${token}/phone-bind`, { fingerprint: 'alice-web-fp', confirm: true }, { headers: auth });
    expect(approved.status).toBe(200);

    const legacy = await call(`/api/auth/qr/session/${token}/complete`, { fingerprint: 'alice-web-fp' });
    expect(legacy.status).toBe(409);
    expect(legacy.body.code).toBe('DESKTOP_EXCHANGE_REQUIRED');

    const wrongKey = await proofCall(other, 'qr/exchange', id);
    expect(wrongKey.status).toBe(401);

    const done = await proofCall(dev, 'qr/exchange', id);
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({ token_type: 'DPoP', username: 'alice', role: 'secretaire', method: 'qr', device_thumbprint: dev.thumbprint });

    const replay = await proofCall(dev, 'qr/exchange', id);
    expect(replay.status).toBe(409);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM desktop_v3_sessions').get().n).toBe(1);
  });

  it('QR: phone refusal is final; the owner account (no app_users row) can sign in and refresh', async () => {
    env.DESKTOP_NATIVE_V3_NATIVE_LOGIN = 'true';
    const dev = await createP256Device();
    const id1 = (await nativeRequest(dev)).body.data.request_id;
    const t1 = new URL((await proofCall(dev, 'qr/start', id1)).body.data.qr_url).searchParams.get('t')!;
    const ownerAuth = { Authorization: `Bearer ${ownerToken}`, 'X-Device-Fingerprint': 'owner-web-fp' };
    await call(`/api/auth/qr/session/${t1}/phone-bind`, { fingerprint: 'owner-web-fp' }, { headers: ownerAuth });
    expect((await call(`/api/auth/qr/session/${t1}/deny`, {}, { headers: ownerAuth })).status).toBe(200);
    const denied = await proofCall(dev, 'qr/exchange', id1);
    expect(denied.status).toBe(410);
    expect(denied.body.code).toBe('DENIED');

    const id2 = (await nativeRequest(dev)).body.data.request_id;
    const t2 = new URL((await proofCall(dev, 'qr/start', id2)).body.data.qr_url).searchParams.get('t')!;
    await call(`/api/auth/qr/session/${t2}/phone-bind`, { fingerprint: 'owner-web-fp', confirm: true }, { headers: ownerAuth });
    const owner = await proofCall(dev, 'qr/exchange', id2);
    expect(owner.status).toBe(200);
    expect(owner.body.data).toMatchObject({ username: 'admin', role: 'owner', method: 'qr' });
    expect(sqlite.prepare('SELECT user_id FROM desktop_v3_sessions WHERE id=?').get(owner.body.data.session_id).user_id).toBeNull();

    const n = await getNonce();
    const proof = await dev.signDpop({ method: 'POST', target: `${ORIGIN}${V3}/session/refresh`, nonce: n });
    const refreshed = await call(`${V3}/session/refresh`, { origin: ORIGIN, refresh_token: owner.body.data.refresh_token }, { headers: { DPoP: proof } });
    expect(refreshed.status).toBe(200);
  });

  it('passkey: request-bound challenge, DER signature accepted, wrong origin burns the challenge, single use', async () => {
    env.DESKTOP_NATIVE_V3_NATIVE_LOGIN = 'true';
    env.WEBAUTHN_ENABLED = 'true';
    env.WEBAUTHN_RP_ID = 'stock.afmarbre.test';
    env.WEBAUTHN_ALLOWED_ORIGINS = ORIGIN;
    const dev = await createP256Device();

    // Authenticator key + stored credential for alice
    const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
    const signAssertion = async (challenge: string, origin: string, counter: number) => {
      const clientData = new TextEncoder().encode(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }));
      const rpIdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('stock.afmarbre.test')));
      const authData = Uint8Array.from([...rpIdHash, 0x05, 0, 0, 0, counter]);
      const cdHash = new Uint8Array(await crypto.subtle.digest('SHA-256', clientData));
      const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, Uint8Array.from([...authData, ...cdHash])));
      return { id: 'cred-alice-1', response: { clientDataJSON: b64url(clientData), authenticatorData: b64url(authData), signature: b64url(rawToDer(raw)) } };
    };

    sqlite.exec(`CREATE TABLE IF NOT EXISTS webauthn_credentials (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, device_type TEXT DEFAULT 'platform', transports TEXT DEFAULT '',
      label TEXT DEFAULT '', username TEXT DEFAULT '', role TEXT DEFAULT '', created_at TEXT, last_used TEXT, device_info TEXT DEFAULT '', public_key_jwk TEXT DEFAULT '',
      counter INTEGER DEFAULT 0, backup_eligible INTEGER DEFAULT 0, backup_state INTEGER DEFAULT 0, rp_id TEXT DEFAULT '', origin TEXT DEFAULT '', cred_user_handle TEXT DEFAULT '')`);
    const id1 = (await nativeRequest(dev)).body.data.request_id;
    const opts1 = await proofCall(dev, 'webauthn/options', id1, { username: 'alice' });
    expect(opts1.status).toBe(200);
    expect(opts1.body.data).toMatchObject({ rpId: 'stock.afmarbre.test', origin: ORIGIN, userVerification: 'required' });
    sqlite
      .prepare("INSERT INTO webauthn_credentials (id, fingerprint, username, role, public_key_jwk, counter) VALUES (?, 'x', 'alice', 'secretaire', ?, 0)")
      .run('cred-alice-1', JSON.stringify({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, alg: 'ES256' }));

    const badOrigin = await proofCall(dev, 'webauthn/verify', id1, { credential: await signAssertion(opts1.body.data.challenge, 'https://evil.test', 1) });
    expect(badOrigin.status).toBe(401);
    expect(badOrigin.body.code).toBe('AUTH_FAILED');
    const burned = await proofCall(dev, 'webauthn/verify', id1, { credential: await signAssertion(opts1.body.data.challenge, ORIGIN, 1) });
    expect(burned.status).toBe(401);

    const id2 = (await nativeRequest(dev)).body.data.request_id;
    const opts2 = await proofCall(dev, 'webauthn/options', id2, { username: 'alice' });
    expect(opts2.body.data.allowCredentials).toEqual([{ type: 'public-key', id: 'cred-alice-1', transports: [] }]);
    const ok = await proofCall(dev, 'webauthn/verify', id2, { credential: await signAssertion(opts2.body.data.challenge, ORIGIN, 2) });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ username: 'alice', role: 'secretaire', method: 'passkey', device_thumbprint: dev.thumbprint });
    expect(sqlite.prepare('SELECT counter FROM webauthn_credentials WHERE id=?').get('cred-alice-1').counter).toBe(2);

    const replay = await proofCall(dev, 'webauthn/verify', id2, { credential: await signAssertion(opts2.body.data.challenge, ORIGIN, 3) });
    expect(replay.status).toBe(401);
  });

  it('migrates legacy v3 tables (presentation CHECK, NOT NULL user_id) without losing rows', async () => {
    sqlite.exec(`
      CREATE TABLE desktop_v3_requests (id TEXT PRIMARY KEY, origin TEXT NOT NULL, state_hash TEXT NOT NULL, challenge TEXT NOT NULL, ip_hash TEXT NOT NULL,
        device_thumbprint TEXT NOT NULL, label TEXT NOT NULL, presentation TEXT NOT NULL CHECK(presentation IN ('turnstile_webview','system_browser')),
        cdata TEXT NOT NULL, browser_ip_hash TEXT, expires_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', polls INTEGER NOT NULL DEFAULT 0, last_poll INTEGER NOT NULL DEFAULT 0);
      INSERT INTO desktop_v3_requests (id, origin, state_hash, challenge, ip_hash, device_thumbprint, label, presentation, cdata, expires_at)
        VALUES ('legacy-row', 'o', 's', 'c', 'i', 't', 'l', 'system_browser', 'd', 9999999999999);
      CREATE TABLE desktop_v3_sessions (id TEXT PRIMARY KEY, origin TEXT NOT NULL, username TEXT NOT NULL, role TEXT NOT NULL, user_id INTEGER NOT NULL,
        credential_tag TEXT NOT NULL, device_thumbprint TEXT NOT NULL, device_label TEXT NOT NULL, access_hash TEXT NOT NULL UNIQUE, refresh_hash TEXT NOT NULL UNIQUE,
        previous_refresh_hash TEXT, access_expires_at INTEGER NOT NULL, absolute_expires_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
      INSERT INTO desktop_v3_sessions VALUES ('legacy-sess', 'o', 'alice', 'secretaire', 1, 't', 'd', 'l', 'a', 'r', NULL, 9999999999999, 9999999999999, 1, 0);
    `);
    env.DESKTOP_NATIVE_V3_NATIVE_LOGIN = 'true';
    const created = await nativeRequest(await createP256Device());
    expect(created.status).toBe(201);
    const ddl = (t: string) => String(sqlite.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(t).sql);
    expect(ddl('desktop_v3_requests')).toContain("'native'");
    expect(ddl('desktop_v3_sessions')).not.toMatch(/user_id\s+INTEGER\s+NOT\s+NULL/i);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM desktop_v3_requests WHERE id='legacy-row'").get().n).toBe(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM desktop_v3_sessions WHERE id='legacy-sess'").get().n).toBe(1);
    const triggers = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'desktop_v3_account_%'").all().map((r: any) => r.name).toSorted();
    expect(triggers).toEqual(['desktop_v3_account_delete', 'desktop_v3_account_update']);
  });

  it('serves apple-app-site-association only for configured TEAMID.bundle ids', async () => {
    const none = await call('/.well-known/apple-app-site-association', undefined, { method: 'GET' });
    expect(none.status).toBe(404);
    env.APPLE_WEBCREDENTIALS_APP_IDS = 'ABCDE12345.com.atlas.commerce.desktop, not-valid';
    const ok = await call('/.well-known/apple-app-site-association', undefined, { method: 'GET' });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ webcredentials: { apps: ['ABCDE12345.com.atlas.commerce.desktop'] } });
  });
});

describe('WebAuthn ES256 signature encoding', () => {
  it('converts strict DER to raw r||s and rejects malformed input', async () => {
    const { ecdsaDerToRaw } = await import('../lib/webauthn');
    const raw = Uint8Array.from({ length: 64 }, (_, i) => (i === 0 || i === 32 ? 0x80 : i));
    expect(Array.from(ecdsaDerToRaw(rawToDer(raw))!)).toEqual(Array.from(raw));
    expect(ecdsaDerToRaw(raw)).toBeNull();
    expect(ecdsaDerToRaw(Uint8Array.from([0x30, 0x03, 0x02, 0x01, 0x01]))).toBeNull();
  });
});
