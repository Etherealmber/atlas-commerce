import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashUserPassword } from '../lib/authHelpers';
import { verifyDesktopDeviceProof } from '../lib/desktop-device-proof';

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
          return {
            success: true,
            results: [],
            meta: { changes: Number(r.changes || 0), last_row_id: Number(r.lastInsertRowid || 0) },
          };
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
const ADMIN_PASS = 'AdminV3StrongPass!2026';
const STOCK_PASS = 'StockV3StrongPass!2026';
const OWNER_PASS = 'OwnerPass123!';
const VERIFIER = 'v'.repeat(64);
const STATE = 's'.repeat(64);

let sqlite: any;
let db: any;
let app: any;
let env: any;
let ipSeq = 40;
let IP = '203.0.113.40';
let sentEmails: Array<{ to: string[]; subject: string; text: string }> = [];
let turnstileMode: 'ok' | 'fail' = 'ok';
let adminWebToken = '';
let ownerWebToken = '';
let stockWebToken = '';

async function tokenFor(user: string, role: string, material: string, fp: string, ip: string) {
  return btoa(
    `stock-auth-v2|${user}|${role}|${ip}|${fp}|${await sha256Hex(`proof|${user}|${role}|${material}|${ip}|${fp}`)}`,
  );
}

async function call(
  path: string,
  body?: any,
  opts: { method?: string; headers?: Record<string, string>; ip?: string; origin?: string } = {},
) {
  const headers: Record<string, string> = {
    'CF-Connecting-IP': opts.ip || IP,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    ...opts.headers,
  };
  const res = await app.fetch(
    new Request(`${opts.origin || ORIGIN}${path}`, {
      method: opts.method || (body === undefined ? 'GET' : 'POST'),
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
  return { status: res.status, headers: res.headers, body: json, text };
}

function extractOtp(text: string): string {
  const m = text.match(/\b(\d{6})\b/);
  if (!m) throw new Error(`OTP not found in email: ${text}`);
  return m[1];
}

async function getNonce(ip = IP): Promise<string> {
  const res = await call('/api/auth/desktop/v3/nonce', {}, { method: 'POST', ip });
  expect(res.status).toBe(200);
  return res.body.data.nonce;
}

async function enrollMailbox(webToken: string, fp: string, password: string, email: string) {
  const start = await call(
    '/api/auth/desktop/v3/mailbox/enroll/start',
    { password, email },
    { headers: { Authorization: `Bearer ${webToken}`, 'X-Device-Fingerprint': fp } },
  );
  expect(start.status).toBe(201);
  const newOtp = extractOtp(sentEmails[sentEmails.length - 1].text);
  const confirm = await call(
    '/api/auth/desktop/v3/mailbox/enroll/confirm',
    { password, request_id: start.body.data.request_id, new_code: newOtp },
    { headers: { Authorization: `Bearer ${webToken}`, 'X-Device-Fingerprint': fp } },
  );
  expect(confirm.status).toBe(200);
}

async function loginDesktopUser(
  username: string,
  password: string,
  device: Awaited<ReturnType<typeof createP256Device>>,
) {
  const challenge = await sha256B64u(VERIFIER);
  const reqNonce = await getNonce();
  const reqDpop = await device.signDpop({
    method: 'POST',
    target: `${ORIGIN}/api/auth/desktop/v3/requests`,
    nonce: reqNonce,
  });
  const start = await call(
    '/api/auth/desktop/v3/requests',
    {
      origin: ORIGIN,
      state: STATE,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      device_label: 'Compat Test Device',
      presentation: 'turnstile_webview',
    },
    { headers: { DPoP: reqDpop } },
  );
  expect(start.status).toBe(201);
  const { request_id } = start.body.data;

  const prep = await call(
    '/api/auth/desktop/v3/challenge/prepare',
    { origin: ORIGIN, request_id },
    { headers: { Origin: ORIGIN } },
  );
  expect(prep.status).toBe(200);
  (env as any).__lastCdata = prep.body.data.cdata;

  const ver = await call(
    '/api/auth/desktop/v3/challenge/verify',
    { origin: ORIGIN, request_id, decision: 'approve', turnstile_token: 'tok-ok' },
    { headers: { Origin: ORIGIN } },
  );
  expect(ver.status).toBe(200);

  const pwNonce = await getNonce();
  const pwDpop = await device.signDpop({
    method: 'POST',
    target: `${ORIGIN}/api/auth/desktop/v3/login/password`,
    nonce: pwNonce,
    atlasTxn: request_id,
  });
  const pass = await call(
    '/api/auth/desktop/v3/login/password',
    {
      origin: ORIGIN,
      request_id,
      state: STATE,
      code_verifier: VERIFIER,
      username,
      password,
    },
    { headers: { DPoP: pwDpop } },
  );
  expect(pass.status).toBe(200);
  const otpCode = extractOtp(sentEmails[sentEmails.length - 1].text);

  const otpNonce = await getNonce();
  const otpDpop = await device.signDpop({
    method: 'POST',
    target: `${ORIGIN}/api/auth/desktop/v3/login/otp`,
    nonce: otpNonce,
    atlasTxn: request_id,
  });
  const otpRes = await call(
    '/api/auth/desktop/v3/login/otp',
    {
      origin: ORIGIN,
      request_id,
      state: STATE,
      code_verifier: VERIFIER,
      otp: otpCode,
    },
    { headers: { DPoP: otpDpop } },
  );
  expect(otpRes.status).toBe(200);
  return {
    access_token: otpRes.body.data.access_token as string,
    refresh_token: otpRes.body.data.refresh_token as string,
    session_id: otpRes.body.data.session_id as string,
  };
}

beforeEach(async () => {
  const made = makeD1();
  db = made.db;
  sqlite = made.sqlite;
  sqlite.exec(`
    CREATE TABLE company_settings (id INTEGER PRIMARY KEY, company_name TEXT DEFAULT '', email TEXT DEFAULT '', currency TEXT DEFAULT 'MAD', finance_timezone TEXT DEFAULT 'UTC', report_footer TEXT DEFAULT '', notes TEXT DEFAULT '', tax_rate REAL DEFAULT 20, multi_warehouse INTEGER DEFAULT 1, sales_location_id INTEGER, purchase_location_id INTEGER);
    INSERT INTO company_settings (id, company_name, email) VALUES (1, 'AtlasMarbre', 'company@afmarbre.test');
    CREATE TABLE app_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT DEFAULT '',
      password_salt TEXT DEFAULT '', role TEXT DEFAULT 'user', display_name TEXT DEFAULT '',
      active INTEGER DEFAULT 1, email TEXT DEFAULT '', phone TEXT DEFAULT '', avatar_url TEXT DEFAULT '', notes TEXT DEFAULT '', created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')), last_login TEXT
    );
    CREATE TABLE login_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL, fingerprint TEXT DEFAULT '', success INTEGER DEFAULT 0, reputation_delta INTEGER DEFAULT 0, user_agent TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE ip_reputation (ip TEXT PRIMARY KEY, score INTEGER NOT NULL DEFAULT 50, failed_count INTEGER DEFAULT 0, success_count INTEGER DEFAULT 0, blocked_until TEXT, updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE otp_codes (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), UNIQUE(resource_type, resource_id));
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, role TEXT, action TEXT, entity TEXT, entity_id TEXT, detail TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE trusted_devices (fingerprint TEXT PRIMARY KEY, label TEXT DEFAULT '', last_ip TEXT DEFAULT '', last_seen TEXT DEFAULT (datetime('now')), created_at TEXT DEFAULT (datetime('now')), biometric_credential_id TEXT DEFAULT '', username TEXT DEFAULT '', user_agent TEXT DEFAULT '', city TEXT DEFAULT '', country TEXT DEFAULT '', resume_until TEXT DEFAULT '');
    CREATE TABLE qr_login_sessions (token TEXT PRIMARY KEY, username TEXT, role TEXT, created_by TEXT, status TEXT DEFAULT 'pending', claim_fingerprint TEXT DEFAULT '', claim_ua TEXT DEFAULT '', claim_ip TEXT DEFAULT '', expires_at TEXT, consumed_at TEXT, created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE stock_locations (id INTEGER PRIMARY KEY, code TEXT, name TEXT, is_default INTEGER, is_active INTEGER);
    INSERT INTO stock_locations VALUES (1,'A','Main store',1,1);
    CREATE TABLE stock_location_qty (location_id INTEGER, product_id INTEGER, quantity REAL, PRIMARY KEY(location_id,product_id));
    CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT UNIQUE, name TEXT, description TEXT DEFAULT '', category TEXT DEFAULT '', cost REAL DEFAULT 0, price REAL DEFAULT 0, stock_quantity REAL DEFAULT 0, track_inventory INTEGER DEFAULT 1, low_stock_threshold REAL DEFAULT 1, barcode TEXT DEFAULT '', unit TEXT DEFAULT 'pcs', image_url TEXT DEFAULT '', is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')));
    INSERT INTO products (id, sku, name, category, cost, price, stock_quantity) VALUES (1, 'SKU01', 'Marble Slab', 'Stone', 10.25, 20.5, 5);
    CREATE TABLE expenses (id INTEGER PRIMARY KEY, expense_date TEXT, entry_type TEXT, description TEXT, category TEXT, payment_method TEXT, amount REAL);
    INSERT INTO expenses VALUES (1,'2026-04-10','income','Sale','Sales','cash',100.25);
    CREATE TABLE invoices (id INTEGER PRIMARY KEY, number TEXT, client_id INTEGER, client_name TEXT, client_email TEXT, client_ice TEXT, client_if TEXT, client_address TEXT, issue_date TEXT, due_date TEXT, subtotal REAL, tax_total REAL, total REAL, amount_paid REAL, status TEXT, doc_kind TEXT, notes TEXT, created_at TEXT);
    INSERT INTO invoices VALUES (1,'INV-01',1,'Client Atlas','client@example.test','','','','2026-04-12','2026-05-01',100.42,20.08,120.5,10,'sent','invoice','','2026-04-12T10:00:00Z');
    CREATE TABLE invoice_items (id INTEGER PRIMARY KEY, invoice_id INTEGER, product_id INTEGER, description TEXT, tax_rate REAL, line_total REAL, quantity REAL, unit_price REAL);
    INSERT INTO invoice_items VALUES (1,1,1,'Marble Slab',20,120.5,1,100.42);
    CREATE TABLE bills (id INTEGER PRIMARY KEY, number TEXT, vendor_name TEXT, issue_date TEXT, due_date TEXT, total REAL, amount_paid REAL, status TEXT);
    INSERT INTO bills VALUES (1,'BILL-01','Vendor','2026-04-12','2026-05-01',50.25,0,'sent');
    CREATE TABLE employees (id INTEGER PRIMARY KEY, emp_number TEXT, first_name TEXT, last_name TEXT, role_title TEXT, pay_amount REAL, pay_cycle_type TEXT, pay_cycle_days INTEGER, last_paid_at TEXT, active INTEGER, joined_date TEXT);
    INSERT INTO employees VALUES (1,'EMP01','Fatima','Atlas','Manager',4500.5,'month',30,'2026-04-01',1,'2023-01-01');
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
    }),
  );

  const adminSalt = 'admin-v3-salt-001';
  const adminHash = await hashUserPassword(ADMIN_PASS, adminSalt);
  sqlite
    .prepare('INSERT INTO app_users (username, role, password_salt, password_hash, email) VALUES (?, ?, ?, ?, ?)')
    .run('karim', 'admin', adminSalt, adminHash, 'karim-dir@afmarbre.test');

  const stockSalt = 'stock-v3-salt-001';
  const stockHash = await hashUserPassword(STOCK_PASS, stockSalt);
  sqlite
    .prepare('INSERT INTO app_users (username, role, password_salt, password_hash, email) VALUES (?, ?, ?, ?, ?)')
    .run('nadia', 'stock', stockSalt, stockHash, 'nadia-dir@afmarbre.test');

  sqlite.prepare('INSERT INTO trusted_devices (fingerprint, username) VALUES (?, ?)').run('karim-web-fp', 'karim');
  sqlite.prepare('INSERT INTO trusted_devices (fingerprint, username) VALUES (?, ?)').run('nadia-web-fp', 'nadia');
  sqlite.prepare('INSERT INTO trusted_devices (fingerprint, username) VALUES (?, ?)').run('owner-web-fp', 'admin');

  adminWebToken = await tokenFor('karim', 'admin', adminHash, 'karim-web-fp', IP);
  stockWebToken = await tokenFor('nadia', 'stock', stockHash, 'nadia-web-fp', IP);
  const ownerMaterial = await sha256Hex(`owner-key|admin|${OWNER_PASS}`);
  ownerWebToken = await tokenFor('admin', 'owner', ownerMaterial, 'owner-web-fp', IP);

  env = {
    DB: db,
    CACHE: {},
    EMAIL: { send: vi.fn(async () => ({})) },
    ADMIN_PASSWORD: OWNER_PASS,
    JWT_SECRET: 'compat-test-jwt-secret-123456',
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

describe('Desktop v3 Worker compatibility, DPoP enforcement, and edge cases', () => {
  it('supports DPoP nv3.* across /api/auth/me, /api/products, /api/reports/*, and isPrintLike while rejecting Bearer/query nv3.* and enforcing roles', async () => {
    await enrollMailbox(adminWebToken, 'karim-web-fp', ADMIN_PASS, 'karim.personal@example.test');
    await enrollMailbox(stockWebToken, 'nadia-web-fp', STOCK_PASS, 'nadia.personal@example.test');

    const adminDev = await createP256Device();
    const stockDev = await createP256Device();
    const adminSession = await loginDesktopUser('karim', ADMIN_PASS, adminDev);
    const stockSession = await loginDesktopUser('nadia', STOCK_PASS, stockDev);

    // 1. GET /api/auth/me with DPoP succeeds and never mints v2 token
    const meNonce = await getNonce();
    const meDpop = await adminDev.signDpop({
      method: 'GET',
      target: `${ORIGIN}/api/auth/me`,
      nonce: meNonce,
      accessToken: adminSession.access_token,
    });
    const meRes = await call('/api/auth/me', undefined, {
      headers: { Authorization: `DPoP ${adminSession.access_token}`, DPoP: meDpop },
    });
    expect(meRes.status).toBe(200);
    expect(meRes.body.data.username).toBe('karim');
    expect(meRes.body.data.token).toBeUndefined();

    // Replay of exact DPoP proof fails 401 INVALID_DPOP
    const meReplay = await call('/api/auth/me', undefined, {
      headers: { Authorization: `DPoP ${adminSession.access_token}`, DPoP: meDpop },
    });
    expect(meReplay.status).toBe(401);
    expect(meReplay.body.code).toBe('INVALID_DPOP');

    // 2. Standard API route (/api/products) works for stock with DPoP
    const prodNonce = await getNonce();
    const prodDpop = await stockDev.signDpop({
      method: 'GET',
      target: `${ORIGIN}/api/products`,
      nonce: prodNonce,
      accessToken: stockSession.access_token,
    });
    const prodRes = await call('/api/products', undefined, {
      headers: { Authorization: `DPoP ${stockSession.access_token}`, DPoP: prodDpop },
    });
    expect(prodRes.status).toBe(200);

    // 3. Report routes (/api/reports/link-ticket, /balance, /aging, /tva) accept admin DPoP
    for (const reportPath of ['/api/reports/link-ticket', '/api/reports/balance', '/api/reports/aging', '/api/reports/tva']) {
      const n = await getNonce();
      const dpop = await adminDev.signDpop({
        method: 'GET',
        target: `${ORIGIN}${reportPath}`,
        nonce: n,
        accessToken: adminSession.access_token,
      });
      const r = await call(reportPath, undefined, {
        headers: { Authorization: `DPoP ${adminSession.access_token}`, DPoP: dpop },
      });
      expect(r.status).toBe(200);
    }

    // Stock user gets 403 FIN_FORBIDDEN on reports even with valid DPoP
    const stockRepNonce = await getNonce();
    const stockRepDpop = await stockDev.signDpop({
      method: 'GET',
      target: `${ORIGIN}/api/reports/balance`,
      nonce: stockRepNonce,
      accessToken: stockSession.access_token,
    });
    const stockRep = await call('/api/reports/balance', undefined, {
      headers: { Authorization: `DPoP ${stockSession.access_token}`, DPoP: stockRepDpop },
    });
    expect(stockRep.status).toBe(403);
    expect(stockRep.body.code).toBe('FIN_FORBIDDEN');

    // Bearer nv3.* and ?token=nv3.* are rejected globally with 401 UNAUTHORIZED
    const bearerRep = await call('/api/reports/balance', undefined, {
      headers: { Authorization: `Bearer ${adminSession.access_token}` },
    });
    expect(bearerRep.status).toBe(401);
    expect(bearerRep.body.code).toBe('UNAUTHORIZED');

    const queryRep = await call(`/api/reports/balance?token=${encodeURIComponent(adminSession.access_token)}`);
    expect(queryRep.status).toBe(401);
    expect(queryRep.body.code).toBe('UNAUTHORIZED');

    // Wrong htu / wrong method DPoP on reports returns 401 INVALID_DPOP
    const badHtuNonce = await getNonce();
    const badHtuDpop = await adminDev.signDpop({
      method: 'GET',
      target: `${ORIGIN}/api/reports/aging`,
      nonce: badHtuNonce,
      accessToken: adminSession.access_token,
    });
    const badHtuRep = await call('/api/reports/balance', undefined, {
      headers: { Authorization: `DPoP ${adminSession.access_token}`, DPoP: badHtuDpop },
    });
    expect(badHtuRep.status).toBe(401);
    expect(badHtuRep.body.code).toBe('INVALID_DPOP');

    // 4. Print-like document/export routes accept admin DPoP and reject Bearer nv3.* / ?token=nv3.* / bad DPoP
    for (const printPath of ['/api/invoices/1/print', '/api/invoices/1/pdf', '/api/accounting/fec/export']) {
      const n = await getNonce();
      const dpop = await adminDev.signDpop({
        method: 'GET',
        target: `${ORIGIN}${printPath}`,
        nonce: n,
        accessToken: adminSession.access_token,
      });
      const r = await call(printPath, undefined, {
        headers: { Authorization: `DPoP ${adminSession.access_token}`, DPoP: dpop },
      });
      expect(r.status).toBe(200);
    }

    const printBearer = await call('/api/invoices/1/print', undefined, {
      headers: { Authorization: `Bearer ${adminSession.access_token}` },
    });
    expect(printBearer.status).toBe(401);
    expect(printBearer.body.success).toBe(false);

    const printBadDpop = await call('/api/invoices/1/print', undefined, {
      headers: { Authorization: `DPoP ${adminSession.access_token}`, DPoP: badHtuDpop },
    });
    expect(printBadDpop.status).toBe(401);
    expect(printBadDpop.body.code).toBe('INVALID_DPOP');

    // 5. Legacy /api/print/link-ticket remains v2-only (returns 503 PRINT_TICKET_UNAVAILABLE for nv3.)
    const pltNonce = await getNonce();
    const pltDpop = await adminDev.signDpop({
      method: 'GET',
      target: `${ORIGIN}/api/print/link-ticket`,
      nonce: pltNonce,
      accessToken: adminSession.access_token,
    });
    const pltRes = await call('/api/print/link-ticket', undefined, {
      headers: { Authorization: `DPoP ${adminSession.access_token}`, DPoP: pltDpop },
    });
    expect(pltRes.status).toBe(503);
    expect(pltRes.body.code).toBe('PRINT_TICKET_UNAVAILABLE');

    // 6. Role demotion on app_users revokes active v3 session immediately via trigger
    sqlite.exec(`UPDATE app_users SET role = 'stock' WHERE username = 'karim'`);
    const postDemoteNonce = await getNonce();
    const postDemoteDpop = await adminDev.signDpop({
      method: 'GET',
      target: `${ORIGIN}/api/reports/balance`,
      nonce: postDemoteNonce,
      accessToken: adminSession.access_token,
    });
    const postDemote = await call('/api/reports/balance', undefined, {
      headers: { Authorization: `DPoP ${adminSession.access_token}`, DPoP: postDemoteDpop },
    });
    expect(postDemote.status).toBe(401);
  });

  it('rejects userinfo/backslash origins, enforces system_browser compare_confirmed, IP continuity, and refresh/logout family revocation', async () => {
    await enrollMailbox(adminWebToken, 'karim-web-fp', ADMIN_PASS, 'karim.personal@example.test');
    const dev = await createP256Device();
    const otherDev = await createP256Device();

    // Userinfo in DPoP htu is strictly rejected
    const userinfoNonce = await getNonce();
    const userinfoProof = await dev.signDpop({
      method: 'POST',
      target: `https://user:pass@stock.afmarbre.test/api/auth/desktop/v3/requests`,
      nonce: userinfoNonce,
    });
    const userinfoVerify = await verifyDesktopDeviceProof(userinfoProof, {
      method: 'POST',
      target: `${ORIGIN}/api/auth/desktop/v3/requests`,
      nonce: userinfoNonce,
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    expect(userinfoVerify).toBeNull();

    // Backslash in URL rejected
    const backslashReq = await call('/api/auth/desktop/v3/nonce\\evil', {}, { method: 'POST' });
    expect([401, 403, 404]).toContain(backslashReq.status);

    // system_browser without compare_confirmed rejected
    const challenge = await sha256B64u(VERIFIER);
    const reqNonce = await getNonce();
    const reqDpop = await dev.signDpop({
      method: 'POST',
      target: `${ORIGIN}/api/auth/desktop/v3/requests`,
      nonce: reqNonce,
    });
    const start = await call(
      '/api/auth/desktop/v3/requests',
      {
        origin: ORIGIN,
        state: STATE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        device_label: 'System Browser Test',
        presentation: 'system_browser',
      },
      { headers: { DPoP: reqDpop } },
    );
    expect(start.status).toBe(201);
    const { request_id } = start.body.data;

    // IP mismatch on challenge/verify fails 403 CHALLENGE_FAILED on a fresh request
    const ipReqNonce = await getNonce();
    const ipReqDpop = await dev.signDpop({
      method: 'POST',
      target: `${ORIGIN}/api/auth/desktop/v3/requests`,
      nonce: ipReqNonce,
    });
    const ipStart = await call(
      '/api/auth/desktop/v3/requests',
      {
        origin: ORIGIN,
        state: STATE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        device_label: 'IP Check',
        presentation: 'turnstile_webview',
      },
      { headers: { DPoP: ipReqDpop } },
    );
    expect(ipStart.status).toBe(201);
    const wrongIpVerify = await call(
      '/api/auth/desktop/v3/challenge/verify',
      { origin: ORIGIN, request_id: ipStart.body.data.request_id, decision: 'approve', turnstile_token: 'tok-ok' },
      { ip: '203.0.113.250', headers: { Origin: ORIGIN } },
    );
    expect(wrongIpVerify.status).toBe(403);
    expect(wrongIpVerify.body.code).toBe('CHALLENGE_FAILED');

    const prep = await call(
      '/api/auth/desktop/v3/challenge/prepare',
      { origin: ORIGIN, request_id },
      { headers: { Origin: ORIGIN } },
    );
    expect(prep.status).toBe(200);
    (env as any).__lastCdata = prep.body.data.cdata;

    const noCompare = await call(
      '/api/auth/desktop/v3/challenge/verify',
      { origin: ORIGIN, request_id, decision: 'approve', turnstile_token: 'tok-ok', compare_confirmed: false },
      { headers: { Origin: ORIGIN } },
    );
    expect(noCompare.status).toBe(400);

    // Normal login then test /session/refresh lost-response family revocation + /session/logout
    const session = await loginDesktopUser('karim', ADMIN_PASS, dev);

    // Rotate once (simulate client losing HTTP 200)
    const r1Nonce = await getNonce();
    const r1Proof = await dev.signDpop({
      method: 'POST',
      target: `${ORIGIN}/api/auth/desktop/v3/session/refresh`,
      nonce: r1Nonce,
    });
    const r1 = await call(
      '/api/auth/desktop/v3/session/refresh',
      { origin: ORIGIN, refresh_token: session.refresh_token },
      { headers: { DPoP: r1Proof } },
    );
    expect(r1.status).toBe(200);

    // Retry with retired refresh_token -> revokes entire family and returns 401
    const r2Nonce = await getNonce();
    const r2Proof = await dev.signDpop({
      method: 'POST',
      target: `${ORIGIN}/api/auth/desktop/v3/session/refresh`,
      nonce: r2Nonce,
    });
    const r2 = await call(
      '/api/auth/desktop/v3/session/refresh',
      { origin: ORIGIN, refresh_token: session.refresh_token },
      { headers: { DPoP: r2Proof } },
    );
    expect(r2.status).toBe(401);
    expect(r2.body.code).toBe('AUTH_FAILED');

    // Subsequent refresh even with the newer token fails because family was revoked
    const r3Nonce = await getNonce();
    const r3Proof = await dev.signDpop({
      method: 'POST',
      target: `${ORIGIN}/api/auth/desktop/v3/session/refresh`,
      nonce: r3Nonce,
    });
    const r3 = await call(
      '/api/auth/desktop/v3/session/refresh',
      { origin: ORIGIN, refresh_token: r1.body.data.refresh_token },
      { headers: { DPoP: r3Proof } },
    );
    expect(r3.status).toBe(401);

    // Logout with wrong device key fails 401; valid logout succeeds without access token, replay fails 401
    const session2 = await loginDesktopUser('karim', ADMIN_PASS, dev);
    const badOutNonce = await getNonce();
    const badOutProof = await otherDev.signDpop({
      method: 'POST',
      target: `${ORIGIN}/api/auth/desktop/v3/session/logout`,
      nonce: badOutNonce,
    });
    const badOut = await call(
      '/api/auth/desktop/v3/session/logout',
      { origin: ORIGIN, refresh_token: session2.refresh_token },
      { headers: { DPoP: badOutProof } },
    );
    expect(badOut.status).toBe(401);
    expect(badOut.body.code).toBe('INVALID_PROOF');

    const outNonce = await getNonce();
    const outProof = await dev.signDpop({
      method: 'POST',
      target: `${ORIGIN}/api/auth/desktop/v3/session/logout`,
      nonce: outNonce,
    });
    const outRes = await call(
      '/api/auth/desktop/v3/session/logout',
      { origin: ORIGIN, refresh_token: session2.refresh_token },
      { headers: { DPoP: outProof } },
    );
    expect(outRes.status).toBe(200);
    expect(outRes.body.data.status).toBe('revoked');

    const outReplayNonce = await getNonce();
    const outReplayProof = await dev.signDpop({
      method: 'POST',
      target: `${ORIGIN}/api/auth/desktop/v3/session/logout`,
      nonce: outReplayNonce,
    });
    const outReplay = await call(
      '/api/auth/desktop/v3/session/logout',
      { origin: ORIGIN, refresh_token: session2.refresh_token },
      { headers: { DPoP: outReplayProof } },
    );
    expect(outReplay.status).toBe(401);
    expect(outReplay.body.code).toBe('AUTH_FAILED');
  });

  it('enforces owner-only approval for admin recovery and suspends mailbox on email change', async () => {
    // Owner cannot enroll mailbox
    const ownerEnroll = await call(
      '/api/auth/desktop/v3/mailbox/enroll/start',
      { password: OWNER_PASS, email: 'owner.box@example.test' },
      { headers: { Authorization: `Bearer ${ownerWebToken}`, 'X-Device-Fingerprint': 'owner-web-fp' } },
    );
    expect(ownerEnroll.status).toBe(403);

    await enrollMailbox(adminWebToken, 'karim-web-fp', ADMIN_PASS, 'karim.personal@example.test');
    const recovery = await call(
      '/api/auth/desktop/v3/mailbox/recovery/request',
      { password: ADMIN_PASS, reason: 'Lost access to personal inbox' },
      { headers: { Authorization: `Bearer ${adminWebToken}`, 'X-Device-Fingerprint': 'karim-web-fp' } },
    );
    expect(recovery.status).toBe(201);
    const recoveryId = recovery.body.data.recovery_id;

    // Self-approval rejected
    const selfApprove = await call(
      '/api/auth/desktop/v3/mailbox/recovery/approve',
      { password: ADMIN_PASS, recovery_id: recoveryId },
      { headers: { Authorization: `Bearer ${adminWebToken}`, 'X-Device-Fingerprint': 'karim-web-fp' } },
    );
    expect(selfApprove.status).toBe(403);

    // Owner approves admin recovery (deletes old verified mailbox so user can re-enroll)
    const ownerApprove = await call(
      '/api/auth/desktop/v3/mailbox/recovery/approve',
      { password: OWNER_PASS, recovery_id: recoveryId },
      { headers: { Authorization: `Bearer ${ownerWebToken}`, 'X-Device-Fingerprint': 'owner-web-fp' } },
    );
    expect(ownerApprove.status).toBe(200);

    // Email update on app_users suspends an active verified mailbox immediately via trigger
    await enrollMailbox(stockWebToken, 'nadia-web-fp', STOCK_PASS, 'nadia.personal@example.test');
    sqlite.exec(`UPDATE app_users SET email = 'changed@afmarbre.test' WHERE username = 'nadia'`);
    const nadiaUser = sqlite.prepare(`SELECT id FROM app_users WHERE username = 'nadia'`).get();
    const mailboxRow = sqlite.prepare(`SELECT active FROM desktop_mailbox_verified_v1 WHERE user_id = ?`).get(nadiaUser.id);
    expect(mailboxRow.active).toBe(0);
  });
});
