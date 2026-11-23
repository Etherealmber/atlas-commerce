import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authFailReason, hashUserPassword, runWithRequestAuthContext } from '../lib/authHelpers';

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
let aliceId = 0;

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
  aliceId = Number(inserted.lastInsertRowid);

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

describe('Desktop v3 production safety, discovery, and protocol', () => {
  it('stays disabled in production unless DESKTOP_NATIVE_V3_PROD_APPROVED is explicitly true', async () => {
    env.ENVIRONMENT = 'production';
    const caps = await call('/api/auth/desktop/v3/capabilities', undefined, { method: 'GET' });
    expect(caps.status).toBe(200);
    expect(caps.body.data).toMatchObject({ version: 3, enabled: false, reason: 'NOT_READY' });

    const nonce = await call('/api/auth/desktop/v3/nonce');
    expect(nonce.status).toBe(503);
    expect(nonce.body.code).toBe('METHOD_DISABLED');

    env.DESKTOP_NATIVE_V3_PROD_APPROVED = 'true';
    const readyCaps = await call('/api/auth/desktop/v3/capabilities', undefined, { method: 'GET' });
    expect(readyCaps.status).toBe(200);
    expect(readyCaps.body.data.enabled).toBe(true);
    expect(readyCaps.body.data.methods.device_proof.hardware_attestation_claimed).toBe(false);
    expect(readyCaps.body.data.methods.password_otp.challenge_modes).toEqual(['turnstile_webview', 'system_browser']);
    expect(readyCaps.body.data.methods.password_otp.automatic_fallback).toBe(false);
  });

  it('serves CSP-locked Turnstile-only WebView and explicit system-browser pages without credential forms', async () => {
    const wv = await call('/login/desktop-v3-challenge', undefined, { method: 'GET' });
    expect(wv.status).toBe(200);
    expect(wv.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(wv.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(wv.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(wv.headers.get('Cache-Control')).toBe('no-store');
    expect(wv.body).not.toContain('type="password"');

    const br = await call('/login/desktop-v3-browser', undefined, { method: 'GET' });
    expect(br.status).toBe(200);
    expect(br.body).toContain('id="confirm"');
    expect(br.body).not.toContain('type="password"');
  });

  it('enforces DPoP ES256 key binding and atomic single-use nonce/JTI replay prevention', async () => {
    const devA = await createP256Device();
    const devB = await createP256Device();
    const codeChallenge = await sha256B64u(VERIFIER);
    const n1 = await getNonce();
    const proof1 = await devA.signDpop({
      method: 'POST',
      target: `${ORIGIN}/api/auth/desktop/v3/requests`,
      nonce: n1,
    });

    const created = await call(
      '/api/auth/desktop/v3/requests',
      {
        origin: ORIGIN,
        state: STATE,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        device_label: 'Poste Windows 11',
        presentation: 'turnstile_webview',
      },
      { headers: { DPoP: proof1 } },
    );
    expect(created.status).toBe(201);
    expect(created.body.data.device_thumbprint).toBe(devA.thumbprint);

    // Replaying exact same DPoP proof (same nonce + jti) MUST fail
    const replay = await call(
      '/api/auth/desktop/v3/requests',
      {
        origin: ORIGIN,
        state: STATE,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        device_label: 'Poste Windows 11',
        presentation: 'turnstile_webview',
      },
      { headers: { DPoP: proof1 } },
    );
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('INVALID_PROOF');

    // Different device key polling the request MUST fail even with a fresh nonce
    const n2 = await getNonce();
    const wrongKeyPoll = await devB.signDpop({
      method: 'POST',
      target: `${ORIGIN}/api/auth/desktop/v3/challenge/poll`,
      nonce: n2,
      atlasTxn: created.body.data.request_id,
    });
    const badPoll = await call(
      '/api/auth/desktop/v3/challenge/poll',
      { origin: ORIGIN, request_id: created.body.data.request_id, state: STATE, code_verifier: VERIFIER },
      { headers: { DPoP: wrongKeyPoll } },
    );
    expect(badPoll.status).toBe(401);
    expect(badPoll.body.code).toBe('INVALID_PROOF');
  });

  it('refuses OTP delivery unless the account has an active verified mailbox (never falls back to app_users.email)', async () => {
    const dev = await createP256Device();
    const codeChallenge = await sha256B64u(VERIFIER);
    const created = await call(
      '/api/auth/desktop/v3/requests',
      {
        origin: ORIGIN,
        state: STATE,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        device_label: 'Linux Workstation',
        presentation: 'turnstile_webview',
      },
      {
        headers: {
          DPoP: await dev.signDpop({
            method: 'POST',
            target: `${ORIGIN}/api/auth/desktop/v3/requests`,
            nonce: await getNonce(),
          }),
        },
      },
    );
    const reqId = created.body.data.request_id;
    const prep = await call(
      '/api/auth/desktop/v3/challenge/prepare',
      { origin: ORIGIN, request_id: reqId },
      { headers: { Origin: ORIGIN } },
    );
    expect(prep.status).toBe(200);
    env.__lastCdata = prep.body.data.cdata;

    const verify = await call(
      '/api/auth/desktop/v3/challenge/verify',
      { origin: ORIGIN, request_id: reqId, decision: 'approve', turnstile_token: 'ts_valid_token' },
      { headers: { Origin: ORIGIN } },
    );
    expect(verify.status).toBe(200);

    const pw = await call(
      '/api/auth/desktop/v3/login/password',
      {
        origin: ORIGIN,
        request_id: reqId,
        state: STATE,
        code_verifier: VERIFIER,
        username: 'alice',
        password: ALICE_PASSWORD,
      },
      {
        headers: {
          DPoP: await dev.signDpop({
            method: 'POST',
            target: `${ORIGIN}/api/auth/desktop/v3/login/password`,
            nonce: await getNonce(),
            atlasTxn: reqId,
          }),
        },
      },
    );
    // Anti-enumeration generic ack, but ZERO emails delivered to unverified directory email
    expect(pw.status).toBe(200);
    expect(pw.body.data.status).toBe('otp_pending');
    expect(sentEmails.length).toBe(0);
  });

  it('completes full Turnstile WebView -> verified mailbox OTP -> DPoP session -> refresh rotation -> reuse detection -> logout', async () => {
    await enrollAliceMailbox('alice.personal@example.test');
    const dev = await createP256Device();
    const otherDev = await createP256Device();
    const codeChallenge = await sha256B64u(VERIFIER);

    // 1. Create request
    const created = await call(
      '/api/auth/desktop/v3/requests',
      {
        origin: ORIGIN,
        state: STATE,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        device_label: 'MacBook Pro',
        presentation: 'turnstile_webview',
      },
      {
        headers: {
          DPoP: await dev.signDpop({
            method: 'POST',
            target: `${ORIGIN}/api/auth/desktop/v3/requests`,
            nonce: await getNonce(),
          }),
        },
      },
    );
    expect(created.status).toBe(201);
    const reqId = created.body.data.request_id;

    // 2. Hosted page prepares + verifies Turnstile
    const prep = await call(
      '/api/auth/desktop/v3/challenge/prepare',
      { origin: ORIGIN, request_id: reqId },
      { headers: { Origin: ORIGIN } },
    );
    expect(prep.status).toBe(200);
    env.__lastCdata = prep.body.data.cdata;

    const ver = await call(
      '/api/auth/desktop/v3/challenge/verify',
      { origin: ORIGIN, request_id: reqId, decision: 'approve', turnstile_token: 'ts_valid_token' },
      { headers: { Origin: ORIGIN } },
    );
    expect(ver.status).toBe(200);
    expect(ver.body.data.status).toBe('verified');

    // 3. Password login sends OTP strictly to alice.personal@example.test
    const emailsBefore = sentEmails.length;
    const pwRes = await call(
      '/api/auth/desktop/v3/login/password',
      {
        origin: ORIGIN,
        request_id: reqId,
        state: STATE,
        code_verifier: VERIFIER,
        username: 'alice',
        password: ALICE_PASSWORD,
      },
      {
        headers: {
          DPoP: await dev.signDpop({
            method: 'POST',
            target: `${ORIGIN}/api/auth/desktop/v3/login/password`,
            nonce: await getNonce(),
            atlasTxn: reqId,
          }),
        },
      },
    );
    expect(pwRes.status).toBe(200);
    expect(sentEmails.length).toBe(emailsBefore + 1);
    expect(sentEmails[sentEmails.length - 1].to).toEqual(['alice.personal@example.test']);
    const otp = extractOtp(sentEmails[sentEmails.length - 1].text);

    // 4. OTP exchange yields DPoP-bound nv3. session
    const otpRes = await call(
      '/api/auth/desktop/v3/login/otp',
      { origin: ORIGIN, request_id: reqId, state: STATE, code_verifier: VERIFIER, otp },
      {
        headers: {
          DPoP: await dev.signDpop({
            method: 'POST',
            target: `${ORIGIN}/api/auth/desktop/v3/login/otp`,
            nonce: await getNonce(),
            atlasTxn: reqId,
          }),
        },
      },
    );
    expect(otpRes.status).toBe(200);
    const session = otpRes.body.data;
    expect(session.token_type).toBe('DPoP');
    expect(session.access_token.startsWith('nv3.')).toBe(true);
    expect(session.attestation).toBe('client_key_unattested');

    // 5. Authenticated /api/auth/me requires matching DPoP proof (ath + thumbprint)
    const noDpop = await call('/api/auth/me', undefined, {
      method: 'GET',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    expect(noDpop.status).toBe(401);

    const wrongDpop = await call('/api/auth/me', undefined, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        DPoP: await otherDev.signDpop({
          method: 'GET',
          target: `${ORIGIN}/api/auth/me`,
          nonce: await getNonce(),
          accessToken: session.access_token,
        }),
      },
    });
    expect(wrongDpop.status).toBe(401);

    const meOk = await call('/api/auth/me', undefined, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        DPoP: await dev.signDpop({
          method: 'GET',
          target: `${ORIGIN}/api/auth/me`,
          nonce: await getNonce(),
          accessToken: session.access_token,
        }),
      },
    });
    expect(meOk.status).toBe(200);
    expect(meOk.body.data.username).toBe('alice');
    expect(meOk.body.data.role).toBe('secretaire');

    // Legacy /api/auth/logout rejects nv3. at the /api/* boundary (401)
    const legacyLogout = await call('/api/auth/logout', {}, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        DPoP: await dev.signDpop({
          method: 'POST',
          target: `${ORIGIN}/api/auth/logout`,
          nonce: await getNonce(),
          accessToken: session.access_token,
        }),
      },
    });
    expect(legacyLogout.status).toBe(401);

    // List and verify active v3 session appears in /api/auth/desktop/v3/sessions
    const listed = await call('/api/auth/desktop/v3/sessions', undefined, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        DPoP: await dev.signDpop({
          method: 'GET',
          target: `${ORIGIN}/api/auth/desktop/v3/sessions`,
          nonce: await getNonce(),
          accessToken: session.access_token,
        }),
      },
    });
    expect(listed.status).toBe(200);
    expect(listed.body.data.length).toBe(1);
    expect(listed.body.data[0].device_thumbprint).toBe(dev.thumbprint);

    // 6. Refresh rotation
    const rotated = await call(
      '/api/auth/desktop/v3/session/refresh',
      { origin: ORIGIN, refresh_token: session.refresh_token },
      {
        headers: {
          DPoP: await dev.signDpop({
            method: 'POST',
            target: `${ORIGIN}/api/auth/desktop/v3/session/refresh`,
            nonce: await getNonce(),
          }),
        },
      },
    );
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.access_token).not.toBe(session.access_token);
    expect(rotated.body.data.refresh_token).not.toBe(session.refresh_token);

    // 7. Replaying the old refresh token revokes the entire session family!
    const reuse = await call(
      '/api/auth/desktop/v3/session/refresh',
      { origin: ORIGIN, refresh_token: session.refresh_token },
      {
        headers: {
          DPoP: await dev.signDpop({
            method: 'POST',
            target: `${ORIGIN}/api/auth/desktop/v3/session/refresh`,
            nonce: await getNonce(),
          }),
        },
      },
    );
    expect(reuse.status).toBe(401);

    const afterReuse = await call('/api/auth/me', undefined, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${rotated.body.data.access_token}`,
        DPoP: await dev.signDpop({
          method: 'GET',
          target: `${ORIGIN}/api/auth/me`,
          nonce: await getNonce(),
          accessToken: rotated.body.data.access_token,
        }),
      },
    });
    expect(afterReuse.status).toBe(401);
  });

  it('supports explicit system-browser comparison flow, recovery approval, and server-side logout', async () => {
    await enrollAliceMailbox('alice.personal@example.test');
    const dev = await createP256Device();
    const codeChallenge = await sha256B64u(VERIFIER);

    const created = await call(
      '/api/auth/desktop/v3/requests',
      {
        origin: ORIGIN,
        state: STATE,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        device_label: 'Windows Desktop',
        presentation: 'system_browser',
      },
      {
        headers: {
          DPoP: await dev.signDpop({
            method: 'POST',
            target: `${ORIGIN}/api/auth/desktop/v3/requests`,
            nonce: await getNonce(),
          }),
        },
      },
    );
    expect(created.status).toBe(201);
    const reqId = created.body.data.request_id;
    expect(created.body.data.challenge_url).toContain('/login/desktop-v3-browser#request_id=');

    const prep = await call(
      '/api/auth/desktop/v3/challenge/prepare',
      { origin: ORIGIN, request_id: reqId },
      { headers: { Origin: ORIGIN } },
    );
    env.__lastCdata = prep.body.data.cdata;

    // Missing compare_confirmed on system_browser fails!
    const missingConfirm = await call(
      '/api/auth/desktop/v3/challenge/verify',
      { origin: ORIGIN, request_id: reqId, decision: 'approve', turnstile_token: 'ts_valid_token' },
      { headers: { Origin: ORIGIN } },
    );
    expect(missingConfirm.status).toBe(400);

    const verOk = await call(
      '/api/auth/desktop/v3/challenge/verify',
      {
        origin: ORIGIN,
        request_id: reqId,
        decision: 'approve',
        compare_confirmed: true,
        turnstile_token: 'ts_valid_token',
      },
      { headers: { Origin: ORIGIN } },
    );
    expect(verOk.status).toBe(200);

    await call(
      '/api/auth/desktop/v3/login/password',
      {
        origin: ORIGIN,
        request_id: reqId,
        state: STATE,
        code_verifier: VERIFIER,
        username: 'alice',
        password: ALICE_PASSWORD,
      },
      {
        headers: {
          DPoP: await dev.signDpop({
            method: 'POST',
            target: `${ORIGIN}/api/auth/desktop/v3/login/password`,
            nonce: await getNonce(),
            atlasTxn: reqId,
          }),
        },
      },
    );
    const otp = extractOtp(sentEmails[sentEmails.length - 1].text);
    const otpRes = await call(
      '/api/auth/desktop/v3/login/otp',
      { origin: ORIGIN, request_id: reqId, state: STATE, code_verifier: VERIFIER, otp },
      {
        headers: {
          DPoP: await dev.signDpop({
            method: 'POST',
            target: `${ORIGIN}/api/auth/desktop/v3/login/otp`,
            nonce: await getNonce(),
            atlasTxn: reqId,
          }),
        },
      },
    );
    expect(otpRes.status).toBe(200);
    const session = otpRes.body.data;

    // Server-side logout revokes session + audits auth.logout
    const logoutRes = await call(
      '/api/auth/desktop/v3/session/logout',
      { origin: ORIGIN, refresh_token: session.refresh_token },
      {
        headers: {
          DPoP: await dev.signDpop({
            method: 'POST',
            target: `${ORIGIN}/api/auth/desktop/v3/session/logout`,
            nonce: await getNonce(),
          }),
        },
      },
    );
    expect(logoutRes.status).toBe(200);

    // Token is immediately rejected
    const afterLogout = await call('/api/auth/me', undefined, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        DPoP: await dev.signDpop({
          method: 'GET',
          target: `${ORIGIN}/api/auth/me`,
          nonce: await getNonce(),
          accessToken: session.access_token,
        }),
      },
    });
    expect(afterLogout.status).toBe(401);

    // Mailbox recovery request + owner approval resets mailbox cleanly
    const recReq = await call(
      '/api/auth/desktop/v3/mailbox/recovery/request',
      { password: ALICE_PASSWORD, reason: 'Boite mail professionnelle perdue' },
      { headers: { Authorization: `Bearer ${aliceToken}`, 'X-Device-Fingerprint': 'alice-web-fp' } },
    );
    expect(recReq.status).toBe(201);

    // Non-admin cannot approve recovery
    const forbiddenApprove = await call(
      '/api/auth/desktop/v3/mailbox/recovery/approve',
      { password: ALICE_PASSWORD, recovery_id: recReq.body.data.recovery_id },
      { headers: { Authorization: `Bearer ${aliceToken}`, 'X-Device-Fingerprint': 'alice-web-fp' } },
    );
    expect(forbiddenApprove.status).toBe(403);

    // Owner approves recovery
    const ownerApprove = await call(
      '/api/auth/desktop/v3/mailbox/recovery/approve',
      { password: OWNER_PASSWORD, recovery_id: recReq.body.data.recovery_id },
      { headers: { Authorization: `Bearer ${ownerToken}`, 'X-Device-Fingerprint': 'owner-web-fp' } },
    );
    expect(ownerApprove.status).toBe(200);

    const statusAfter = await call('/api/auth/desktop/v3/mailbox/status', undefined, {
      method: 'GET',
      headers: { Authorization: `Bearer ${aliceToken}`, 'X-Device-Fingerprint': 'alice-web-fp' },
    });
    expect(statusAfter.status).toBe(200);
    expect(statusAfter.body.data.enrolled).toBe(false);
    expect(statusAfter.body.data.active).toBe(false);
  });

  it('preserves existing website/Android v2| tokens, /api/auth/logout, QR pc-session, and v1/v2 discovery', async () => {
    const meWeb = await call('/api/auth/me', undefined, {
      method: 'GET',
      headers: { Authorization: `Bearer ${aliceToken}`, 'X-Device-Fingerprint': 'alice-web-fp' },
    });
    expect(meWeb.status).toBe(200);
    expect(meWeb.body.data.username).toBe('alice');

    const qr = await call('/api/auth/qr/pc-session', {});
    expect(qr.status).toBe(200);
    expect(qr.body.success).toBe(true);

    const v1 = await call('/api/auth/desktop/v1/capabilities', undefined, { method: 'GET' });
    expect(v1.status).toBe(200);
    const v2 = await call('/api/auth/desktop/v2/capabilities', undefined, { method: 'GET' });
    expect(v2.status).toBe(200);

    const logoutWeb = await call(
      '/api/auth/logout',
      {},
      { headers: { Authorization: `Bearer ${aliceToken}`, 'X-Device-Fingerprint': 'alice-web-fp' } },
    );
    expect(logoutWeb.status).toBe(200);
    expect(logoutWeb.body.resume_prepared).toBe(true);
  });

  it('generates uppercase hex pairing codes, omits legacy v2 token on /api/auth/me for nv3., and protects retired refresh families from unauthenticated revocation', async () => {
    const dev = await createP256Device();
    const otherDev = await createP256Device();

    // 1. Enroll mailbox
    await enrollAliceMailbox('alice-v3-fix@example.test');

    // 2. Create request -> pairing_code matches Rust validate_pairing_code ([0-9A-F]{5}-[0-9A-F]{5})
    const codeChallenge = await sha256B64u(VERIFIER);
    const reqNonce = await getNonce();
    const reqRes = await call(
      '/api/auth/desktop/v3/requests',
      {
        origin: ORIGIN,
        state: STATE,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        device_label: 'Poste Fix Check',
        presentation: 'system_browser',
      },
      { headers: { DPoP: await dev.signDpop({ method: 'POST', target: `${ORIGIN}/api/auth/desktop/v3/requests`, nonce: reqNonce }) } },
    );
    expect(reqRes.status).toBe(201);
    const reqId = reqRes.body.data.request_id;
    expect(reqRes.body.data.pairing_code).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);

    // 3. Approve challenge + poll
    const prep = await call(
      '/api/auth/desktop/v3/challenge/prepare',
      { origin: ORIGIN, request_id: reqId },
      { headers: { Origin: ORIGIN } },
    );
    expect(prep.status).toBe(200);
    env.__lastCdata = prep.body.data.cdata;
    const ver = await call(
      '/api/auth/desktop/v3/challenge/verify',
      {
        origin: ORIGIN,
        request_id: reqId,
        decision: 'approve',
        turnstile_token: 'ts_valid_token',
        compare_confirmed: true,
      },
      { headers: { Origin: ORIGIN } },
    );
    expect(ver.status).toBe(200);
    const pollNonce = await getNonce();
    const pollRes = await call(
      '/api/auth/desktop/v3/challenge/poll',
      { origin: ORIGIN, request_id: reqId, state: STATE, code_verifier: VERIFIER },
      {
        headers: {
          DPoP: await dev.signDpop({ method: 'POST', target: `${ORIGIN}/api/auth/desktop/v3/challenge/poll`, nonce: pollNonce, atlasTxn: reqId }),
        },
      },
    );
    expect(pollRes.status).toBe(200);
    expect(pollRes.body.data.status).toBe('verified');

    // 4. Password + OTP -> nv3. session
    const pwNonce = await getNonce();
    const pwRes = await call(
      '/api/auth/desktop/v3/login/password',
      { origin: ORIGIN, request_id: reqId, state: STATE, code_verifier: VERIFIER, username: 'alice', password: ALICE_PASSWORD },
      { headers: { DPoP: await dev.signDpop({ method: 'POST', target: `${ORIGIN}/api/auth/desktop/v3/login/password`, nonce: pwNonce, atlasTxn: reqId }) } },
    );
    expect(pwRes.status).toBe(200);
    const otpCode = extractOtp(sentEmails.at(-1)!.text);
    const otpNonce = await getNonce();
    const otpRes = await call(
      '/api/auth/desktop/v3/login/otp',
      { origin: ORIGIN, request_id: reqId, state: STATE, code_verifier: VERIFIER, otp: otpCode },
      { headers: { DPoP: await dev.signDpop({ method: 'POST', target: `${ORIGIN}/api/auth/desktop/v3/login/otp`, nonce: otpNonce, atlasTxn: reqId }) } },
    );
    expect(otpRes.status).toBe(200);
    const { access_token: access1, refresh_token: refresh1 } = otpRes.body.data;

    // 5. /api/auth/me with nv3. must NOT mint a legacy v2 bearer token
    const meNonce = await getNonce();
    const meV3 = await call('/api/auth/me', undefined, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${access1}`,
        DPoP: await dev.signDpop({ method: 'GET', target: `${ORIGIN}/api/auth/me`, nonce: meNonce, accessToken: access1 }),
      },
    });
    expect(meV3.status).toBe(200);
    expect(meV3.body.data.username).toBe('alice');
    expect(meV3.body.data.token).toBeUndefined();

    // 6. Rotate once so refresh1 becomes retired; an attacker without dev's DPoP key CANNOT revoke the session
    const refNonce1 = await getNonce();
    const rot1 = await call(
      '/api/auth/desktop/v3/session/refresh',
      { origin: ORIGIN, refresh_token: refresh1 },
      { headers: { DPoP: await dev.signDpop({ method: 'POST', target: `${ORIGIN}/api/auth/desktop/v3/session/refresh`, nonce: refNonce1 }) } },
    );
    expect(rot1.status).toBe(200);
    const access2 = rot1.body.data.access_token;

    const badRefNonce = await getNonce();
    const attackerReplay = await call(
      '/api/auth/desktop/v3/session/refresh',
      { origin: ORIGIN, refresh_token: refresh1 },
      { headers: { DPoP: await otherDev.signDpop({ method: 'POST', target: `${ORIGIN}/api/auth/desktop/v3/session/refresh`, nonce: badRefNonce }) } },
    );
    expect(attackerReplay.status).toBe(401);

    // Session MUST still be active for the genuine device
    const meStillValidNonce = await getNonce();
    const meStillValid = await call('/api/auth/me', undefined, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${access2}`,
        DPoP: await dev.signDpop({ method: 'GET', target: `${ORIGIN}/api/auth/me`, nonce: meStillValidNonce, accessToken: access2 }),
      },
    });
    expect(meStillValid.status).toBe(200);

    // 7. Same-request authFailReason recheck reuses proof without JTI replay, yet catches credential changes live
    const recheckNonce = await getNonce();
    const recheckDpop = await dev.signDpop({
      method: 'GET',
      target: `${ORIGIN}/api/reports/export`,
      nonce: recheckNonce,
      accessToken: access2,
    });
    await runWithRequestAuthContext(
      { dpopHeader: recheckDpop, method: 'GET', requestUrl: `${ORIGIN}/api/reports/export` },
      async () => {
        expect(await authFailReason(`Bearer ${access2}`, env, env.DB, '203.0.113.10', undefined)).toBe('ok');
        expect(await authFailReason(`Bearer ${access2}`, env, env.DB, '203.0.113.10', undefined)).toBe('ok');
        await env.DB.prepare("UPDATE app_users SET password_hash = ? WHERE username = 'alice'").bind(await hashUserPassword('new-rotated-pass-1', 'rotated-salt-01')).run();
        expect(await authFailReason(`Bearer ${access2}`, env, env.DB, '203.0.113.10', undefined)).toBe('bad_token');
      },
    );
  });
});
