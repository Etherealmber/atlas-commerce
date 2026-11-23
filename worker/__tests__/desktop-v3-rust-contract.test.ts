/**
 * Live Worker <-> Rust `atlas-auth-core` contract & DPoP replay tests.
 *
 * - Simulated/local test infrastructure explicitly noted:
 *   uses in-memory `node:sqlite` D1 shim, mocked Turnstile Siteverify, and
 *   mocked Resend fetch (never touches production D1, Turnstile, or Resend).
 * - When `cargo` is available (or `ATLAS_REQUIRE_AUTH_CORE_CONTRACT=1` in CI),
 *   spawns the real compiled `rust/atlas-auth-core` `contract_driver` binary
 *   and drives real `app.fetch()` responses through the Rust crate end-to-end.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { hashUserPassword } from '../lib/authHelpers';

const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const CHILD_PROC_MODULE = ['node:', 'child_process'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };
const { spawnSync, spawn } = (await import(CHILD_PROC_MODULE)) as any;

const REQUIRE_RUST_CONTRACT = process.env.ATLAS_REQUIRE_AUTH_CORE_CONTRACT === '1';

function checkCargoAvailable(): boolean {
  try {
    const res = spawnSync('cargo', ['--version'], { stdio: 'ignore' });
    return res.status === 0;
  } catch {
    return false;
  }
}

const HAS_CARGO = checkCargoAvailable();

const sha256Hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

function makeSqliteD1() {
  const sqlite = new DatabaseSync(':memory:');
  const db: any = {
    _sqlite: sqlite,
    prepare(sql: string) {
      let params: any[] = [];
      const stmtApi: any = {
        bind(...p: any[]) {
          params = p;
          return stmtApi;
        },
        async run() {
          const r = sqlite.prepare(sql).run(...params);
          return {
            success: true,
            meta: { changes: Number(r.changes || 0), last_row_id: Number(r.lastInsertRowid || 0) },
          };
        },
        async first() {
          const r = sqlite.prepare(sql).get(...params);
          return r === undefined ? null : { ...(r as any) };
        },
        async all() {
          const rows = sqlite.prepare(sql).all(...params).map((r: any) => ({ ...r }));
          return { success: true, results: rows, meta: {} };
        },
      };
      return stmtApi;
    },
    async batch(stmts: any[]) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const out: any[] = [];
        for (const st of stmts) out.push(await st.run());
        sqlite.exec('COMMIT');
        return out;
      } catch (e) {
        try { sqlite.exec('ROLLBACK'); } catch { /* */ }
        throw e;
      }
    },
    withSession() {
      return db;
    },
  };
  return { db, sqlite };
}

const ORIGIN = 'https://stock.afmarbre.com';
const ALICE_PASSWORD = 'Rust-Contract-Password-123!';
const OWNER_PASSWORD = 'Owner-Contract-Password-456!';

function extractOtp(text: string): string {
  const m = /\b([0-9]{6})\b/.exec(text);
  if (!m) throw new Error('No OTP in email text');
  return m[1];
}

describe('Desktop v3 Worker <-> Rust atlas-auth-core Contract & DPoP Replay', () => {
  let db: any;
  let sqlite: any;
  let app: any;
  let env: any;
  let sentEmails: Array<{ to: string[]; subject: string; text: string }> = [];
  let origFetch: typeof globalThis.fetch;

  beforeEach(async () => {
    vi.resetModules();
    origFetch = globalThis.fetch;
    sentEmails = [];
    const made = makeSqliteD1();
    db = made.db;
    sqlite = made.sqlite;

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS company_settings (id INTEGER PRIMARY KEY, company_name TEXT DEFAULT '', email TEXT DEFAULT '');
      INSERT INTO company_settings (id, company_name, email) VALUES (1, 'Afmarbre', 'main@afmarbre.com');
      CREATE TABLE IF NOT EXISTS app_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT DEFAULT '',
        password_salt TEXT DEFAULT '', role TEXT DEFAULT 'user', display_name TEXT DEFAULT '',
        active INTEGER DEFAULT 1, email TEXT DEFAULT '', created_by TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')), last_login TEXT
      );
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sku TEXT,
        name TEXT NOT NULL DEFAULT '',
        category TEXT DEFAULT '',
        unit TEXT DEFAULT 'm2',
        price REAL DEFAULT 0,
        cost REAL DEFAULT 0,
        stock_quantity REAL DEFAULT 0,
        low_stock_threshold REAL DEFAULT 5,
        track_inventory INTEGER DEFAULT 1,
        barcode TEXT DEFAULT '',
        active INTEGER DEFAULT 1
      );
      INSERT INTO products (sku, name, price, stock_quantity) VALUES ('MAR-01', 'Crema Marfil', 450, 20);
      CREATE TABLE IF NOT EXISTS login_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL, fingerprint TEXT DEFAULT '', success INTEGER DEFAULT 0, reputation_delta INTEGER DEFAULT 0, user_agent TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS ip_reputation (ip TEXT PRIMARY KEY, score INTEGER NOT NULL DEFAULT 50, failed_count INTEGER DEFAULT 0, success_count INTEGER DEFAULT 0, blocked_until TEXT, updated_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS otp_codes (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), UNIQUE(resource_type, resource_id));
      CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, role TEXT, action TEXT, entity TEXT, entity_id TEXT, detail TEXT, ip TEXT, created_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS trusted_devices (fingerprint TEXT PRIMARY KEY, label TEXT DEFAULT '', last_ip TEXT DEFAULT '', last_seen TEXT DEFAULT (datetime('now')), created_at TEXT DEFAULT (datetime('now')), biometric_credential_id TEXT DEFAULT '', username TEXT DEFAULT '', user_agent TEXT DEFAULT '', city TEXT DEFAULT '', country TEXT DEFAULT '', resume_until TEXT DEFAULT '');
      CREATE TABLE IF NOT EXISTS qr_login_sessions (token TEXT PRIMARY KEY, username TEXT, role TEXT, created_by TEXT, status TEXT DEFAULT 'pending', claim_fingerprint TEXT DEFAULT '', claim_ua TEXT DEFAULT '', claim_ip TEXT DEFAULT '', expires_at TEXT, consumed_at TEXT, created_at TEXT DEFAULT (datetime('now')));
      CREATE TABLE IF NOT EXISTS desktop_mailbox_verified_v1 (user_id INTEGER PRIMARY KEY, address TEXT NOT NULL, version TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, verified_at INTEGER NOT NULL);
    `);

    const salt = 'rust-contract-salt-1';
    const hash = await hashUserPassword(ALICE_PASSWORD, salt);
    const ins = sqlite
      .prepare('INSERT INTO app_users (username, role, password_salt, password_hash) VALUES (?, ?, ?, ?)')
      .run('alice', 'secretaire', salt, hash);
    const aliceId = Number(ins.lastInsertRowid);
    sqlite
      .prepare('INSERT INTO desktop_mailbox_verified_v1 (user_id, address, version, active, verified_at) VALUES (?, ?, ?, 1, ?)')
      .run(aliceId, 'alice.verified@afmarbre.com', 'ver-rust-1', Date.now());

    env = {
      DB: db,
      CACHE: {},
      EMAIL: { send: vi.fn(async () => ({})) },
      ADMIN_PASSWORD: OWNER_PASSWORD,
      ENVIRONMENT: 'staging',
      TURNSTILE_SITE_KEY: '0x4AAAAAA_TEST_SITE_KEY',
      TURNSTILE_SECRET_KEY: '0x4AAAAAA_TEST_SECRET',
      DESKTOP_NATIVE_V3_ENABLED: 'true',
      DESKTOP_NATIVE_V3_OTP_KEY: 'v3-otp-hmac-secret-at-least-32-characters',
      DESKTOP_NATIVE_MAILBOX_MAC_KEY: 'v3-mailbox-mac-secret-at-least-32-chars',
      DESKTOP_NATIVE_MAIL_TRANSPORT: 'resend-v1',
      DESKTOP_NATIVE_RESEND_API_KEY: 're_test_key_123456',
      DESKTOP_NATIVE_MAIL_FROM: 'security@afmarbre.com',
    };

    globalThis.fetch = vi.fn(async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
        const params =
          init?.body instanceof URLSearchParams
            ? init.body
            : new URLSearchParams(String(init?.body || ''));
        const ok = params.get('response') === 'turnstile-ok';
        return new Response(
          JSON.stringify({
            success: ok,
            hostname: 'stock.afmarbre.com',
            action: 'atlas_desktop_v3',
            cdata: env.__lastCdata || '',
          }),
          { status: 200 },
        );
      }
      if (url === 'https://api.resend.com/emails') {
        const payload = JSON.parse(String(init?.body || '{}'));
        sentEmails.push({ to: payload.to, subject: payload.subject, text: payload.text });
        return new Response(JSON.stringify({ id: `msg_${sentEmails.length}` }), { status: 200 });
      }
      return origFetch(input, init);
    }) as any;

    const mod: any = await import('../index');
    app = mod.default?.fetch ? mod.default : mod.app;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  async function callText(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    const method = init.method || (init.body !== undefined ? 'POST' : 'GET');
    const headers: Record<string, string> = {
      'CF-Connecting-IP': '203.0.113.55',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    };
    const res = await app.fetch(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      }),
      env,
      { waitUntil: () => {} },
    );
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* html/text */ }
    return { status: res.status, text, json };
  }

  it('enforces real Worker DPoP nonce consumption and JTI replay rejection', async () => {
    // Generate a real P-256 device key via WebCrypto to test Worker DPoP directly
    const kp = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const jwk: any = await crypto.subtle.exportKey('jwk', kp.publicKey);
    const pubJwk = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
    const b64u = (buf: ArrayBuffer | Uint8Array | string) => {
      const bytes = typeof buf === 'string' ? new TextEncoder().encode(buf) : buf instanceof Uint8Array ? buf : new Uint8Array(buf);
      let bin = '';
      for (const b of bytes) bin += String.fromCharCode(b);
      return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    };
    const signDpop = async (method: string, target: string, nonce: string, accessToken?: string, atlasTxn?: string) => {
      const jti = b64u(crypto.getRandomValues(new Uint8Array(24)));
      const hdr = b64u(JSON.stringify({ typ: 'dpop+jwt', alg: 'ES256', jwk: pubJwk }));
      const ath = accessToken ? b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accessToken)))) : undefined;
      const claims: any = { jti, htm: method, htu: target, iat: Math.floor(Date.now() / 1000), nonce };
      if (ath) claims.ath = ath;
      if (atlasTxn) claims.atlas_txn = atlasTxn;
      const payload = b64u(JSON.stringify(claims));
      const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, new TextEncoder().encode(`${hdr}.${payload}`));
      return `${hdr}.${payload}.${b64u(sig)}`;
    };

    const getNonce = async () => (await callText('/api/auth/desktop/v3/nonce', { method: 'POST', body: {} })).json.data.nonce;

    // Consume nonce #1 on /requests
    const n1 = await getNonce();
    const state = sha256Hex('contract-state-1');
    const verifier = `${sha256Hex('contract-verifier-1')}${sha256Hex('contract-verifier-2')}`;
    const challenge = b64u(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const proof1 = await signDpop('POST', `${ORIGIN}/api/auth/desktop/v3/requests`, n1);
    const req1 = await callText('/api/auth/desktop/v3/requests', {
      body: {
        origin: ORIGIN,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        device_label: 'Contract Key',
        presentation: 'turnstile_webview',
      },
      headers: { DPoP: proof1 },
    });
    expect(req1.status).toBe(201);

    // Replaying the consumed single-use nonce with a fresh JTI MUST fail
    const proofReplayNonce = await signDpop('POST', `${ORIGIN}/api/auth/desktop/v3/requests`, n1);
    const reqReplayNonce = await callText('/api/auth/desktop/v3/requests', {
      body: {
        origin: ORIGIN,
        state: sha256Hex('contract-state-2'),
        code_challenge: challenge,
        code_challenge_method: 'S256',
        device_label: 'Contract Key',
        presentation: 'turnstile_webview',
      },
      headers: { DPoP: proofReplayNonce },
    });
    expect(reqReplayNonce.status).toBe(401);

    // Complete login to test JTI replay on protected GET /api/auth/me
    const reqId = req1.json.data.request_id;
    const prep = await callText('/api/auth/desktop/v3/challenge/prepare', {
      body: { origin: ORIGIN, request_id: reqId },
      headers: { Origin: ORIGIN },
    });
    expect(prep.status).toBe(200);
    env.__lastCdata = prep.json.data.cdata;
    const ver = await callText('/api/auth/desktop/v3/challenge/verify', {
      body: { origin: ORIGIN, request_id: reqId, turnstile_token: 'turnstile-ok', decision: 'approve' },
      headers: { Origin: ORIGIN },
    });
    expect(ver.status).toBe(200);
    const pw = await callText('/api/auth/desktop/v3/login/password', {
      body: { origin: ORIGIN, request_id: reqId, state, code_verifier: verifier, username: 'alice', password: ALICE_PASSWORD },
      headers: { DPoP: await signDpop('POST', `${ORIGIN}/api/auth/desktop/v3/login/password`, await getNonce(), undefined, reqId) },
    });
    expect(pw.status).toBe(200);
    const otpRes = await callText('/api/auth/desktop/v3/login/otp', {
      body: { origin: ORIGIN, request_id: reqId, state, code_verifier: verifier, otp: extractOtp(sentEmails.at(-1)!.text) },
      headers: { DPoP: await signDpop('POST', `${ORIGIN}/api/auth/desktop/v3/login/otp`, await getNonce(), undefined, reqId) },
    });
    expect(otpRes.status).toBe(200);
    const accessToken = otpRes.json.data.access_token;

    // Protected GET /api/auth/me succeeds once, then replaying the exact same DPoP JTI fails (401)
    const meProof = await signDpop('GET', `${ORIGIN}/api/auth/me`, await getNonce(), accessToken);
    const meFirst = await callText('/api/auth/me', {
      method: 'GET',
      headers: { Authorization: `DPoP ${accessToken}`, DPoP: meProof },
    });
    expect(meFirst.status).toBe(200);

    const meJtiReplay = await callText('/api/auth/me', {
      method: 'GET',
      headers: { Authorization: `DPoP ${accessToken}`, DPoP: meProof },
    });
    expect(meJtiReplay.status).toBe(401);
  });

  const rustIt = REQUIRE_RUST_CONTRACT || HAS_CARGO ? it : it.skip;
  rustIt(
    'executes full login -> protected request -> refresh -> logout using compiled rust/atlas-auth-core against real Worker',
    async () => {
      expect(HAS_CARGO).toBe(true);

      const child = spawn(
        'cargo',
        ['run', '--quiet', '--manifest-path', 'rust/atlas-auth-core/Cargo.toml', '--example', 'contract_driver'],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );

      const lines: string[] = [];
      let pendingResolve: ((line: string) => void) | null = null;
      let buf = '';
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
      child.stdout.on('data', (chunk: Buffer) => {
        buf += chunk.toString('utf8');
        let idx = buf.indexOf('\n');
        while (idx >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (line) {
            if (pendingResolve) {
              const r = pendingResolve;
              pendingResolve = null;
              r(line);
            } else {
              lines.push(line);
            }
          }
          idx = buf.indexOf('\n');
        }
      });

      const sendCmd = async (cmd: Record<string, unknown>) => {
        child.stdin.write(`${JSON.stringify(cmd)}\n`);
        const raw = await new Promise<string>((resolve, reject) => {
          if (lines.length > 0) return resolve(lines.shift()!);
          const timer = setTimeout(() => reject(new Error(`Rust driver timeout (stderr=${stderr})`)), 120_000);
          pendingResolve = (l) => {
            clearTimeout(timer);
            resolve(l);
          };
        });
        return JSON.parse(raw);
      };

      try {
        const nowSecs = () => Math.floor(Date.now() / 1000);
        const fetchNonceText = async () => (await callText('/api/auth/desktop/v3/nonce', { method: 'POST', body: {} })).text;

        // 1. Capabilities + Rust session init
        const caps = await callText('/api/auth/desktop/v3/capabilities', { method: 'GET' });
        expect(caps.status).toBe(200);
        const initRes = await sendCmd({
          op: 'init',
          origin: ORIGIN,
          presentation: 'turnstile_webview',
          device_label: 'Rust CI Client',
          capabilities_json: caps.text,
        });
        expect(initRes.ok).toBe(true);
        expect(initRes.phase).toBe('idle');

        // 2. Nonce + /requests
        const nonce1Text = await fetchNonceText();
        const createCmd = await sendCmd({
          op: 'build_create_request',
          nonce_json: nonce1Text,
          endpoint_url: `${ORIGIN}/api/auth/desktop/v3/requests`,
          iat_secs: nowSecs(),
        });
        expect(createCmd.ok).toBe(true);

        const created = await callText('/api/auth/desktop/v3/requests', {
          body: createCmd.body,
          headers: { DPoP: createCmd.dpop },
        });
        expect(created.status).toBe(201);

        // Replaying the Rust-built DPoP proof / single-use nonce must fail on the Worker
        const replayCreate = await callText('/api/auth/desktop/v3/requests', {
          body: createCmd.body,
          headers: { DPoP: createCmd.dpop },
        });
        expect(replayCreate.status).toBe(401);

        const appliedCreated = await sendCmd({ op: 'apply_created', created_json: created.text });
        expect(appliedCreated.ok).toBe(true);
        expect(appliedCreated.phase).toBe('awaiting_challenge');

        // 3. Challenge prepare + verify + poll
        const prep = await callText('/api/auth/desktop/v3/challenge/prepare', {
          body: { origin: ORIGIN, request_id: appliedCreated.request_id },
          headers: { Origin: ORIGIN },
        });
        expect(prep.status).toBe(200);
        env.__lastCdata = prep.json.data.cdata;
        const verify = await callText('/api/auth/desktop/v3/challenge/verify', {
          body: {
            origin: ORIGIN,
            request_id: appliedCreated.request_id,
            turnstile_token: 'turnstile-ok',
            decision: 'approve',
          },
          headers: { Origin: ORIGIN },
        });
        expect(verify.status).toBe(200);

        const pollCmd = await sendCmd({
          op: 'build_poll_proof',
          nonce_json: await fetchNonceText(),
          endpoint_url: `${ORIGIN}/api/auth/desktop/v3/challenge/poll`,
          iat_secs: nowSecs(),
        });
        const poll = await callText('/api/auth/desktop/v3/challenge/poll', {
          body: pollCmd.body,
          headers: { DPoP: pollCmd.dpop },
        });
        expect(poll.status).toBe(200);
        const appliedPoll = await sendCmd({ op: 'apply_poll', poll_json: poll.text });
        expect(appliedPoll.ok).toBe(true);
        expect(appliedPoll.phase).toBe('challenge_verified');

        // 4. Password login + OTP login
        const pwCmd = await sendCmd({
          op: 'build_password_login',
          nonce_json: await fetchNonceText(),
          endpoint_url: `${ORIGIN}/api/auth/desktop/v3/login/password`,
          iat_secs: nowSecs(),
          username: 'alice',
          password: ALICE_PASSWORD,
        });
        const pwRes = await callText('/api/auth/desktop/v3/login/password', {
          body: pwCmd.body,
          headers: { DPoP: pwCmd.dpop },
        });
        expect(pwRes.status).toBe(200);
        const appliedPw = await sendCmd({ op: 'apply_password_login', password_json: pwRes.text });
        expect(appliedPw.ok).toBe(true);
        expect(appliedPw.phase).toBe('awaiting_otp');

        const otpCode = extractOtp(sentEmails.at(-1)!.text);
        const otpCmd = await sendCmd({
          op: 'build_otp_login',
          nonce_json: await fetchNonceText(),
          endpoint_url: `${ORIGIN}/api/auth/desktop/v3/login/otp`,
          iat_secs: nowSecs(),
          otp: otpCode,
        });
        const otpRes = await callText('/api/auth/desktop/v3/login/otp', {
          body: otpCmd.body,
          headers: { DPoP: otpCmd.dpop },
        });
        expect(otpRes.status).toBe(200);
        const authed = await sendCmd({ op: 'apply_authenticated', tokens_json: otpRes.text });
        expect(authed.ok).toBe(true);
        expect(authed.phase).toBe('authenticated');

        // 5. Protected requests with `Authorization: DPoP nv3.<...>` + `DPoP: <proof>`
        const meHdrs = await sendCmd({
          op: 'build_protected_headers',
          method: 'GET',
          target_url: `${ORIGIN}/api/auth/me`,
          nonce_json: await fetchNonceText(),
          iat_secs: nowSecs(),
        });
        expect(meHdrs.ok).toBe(true);
        expect(meHdrs.authorization.startsWith('DPoP nv3.')).toBe(true);
        const meRes = await callText('/api/auth/me', {
          method: 'GET',
          headers: { Authorization: meHdrs.authorization, DPoP: meHdrs.dpop },
        });
        expect(meRes.status).toBe(200);
        expect(meRes.json.data.username).toBe('alice');

        // Also test a business protected endpoint (`GET /api/products`)
        const prodHdrs = await sendCmd({
          op: 'build_protected_headers',
          method: 'GET',
          target_url: `${ORIGIN}/api/products`,
          nonce_json: await fetchNonceText(),
          iat_secs: nowSecs(),
        });
        const prodRes = await callText('/api/products', {
          method: 'GET',
          headers: { Authorization: prodHdrs.authorization, DPoP: prodHdrs.dpop },
        });
        expect(prodRes.status).toBe(200);

        // Sending `Bearer nv3.` instead of `DPoP nv3.` is rejected
        const wrongSchemeHdrs = await sendCmd({
          op: 'build_protected_headers',
          method: 'GET',
          target_url: `${ORIGIN}/api/auth/me`,
          nonce_json: await fetchNonceText(),
          iat_secs: nowSecs(),
        });
        const bearerRejected = await callText('/api/auth/me', {
          method: 'GET',
          headers: {
            Authorization: wrongSchemeHdrs.authorization.replace(/^DPoP /, 'Bearer '),
            DPoP: wrongSchemeHdrs.dpop,
          },
        });
        expect(bearerRejected.status).toBe(401);

        // 6. Refresh token rotation via Rust crate
        const refCmd = await sendCmd({
          op: 'build_refresh',
          nonce_json: await fetchNonceText(),
          endpoint_url: `${ORIGIN}/api/auth/desktop/v3/session/refresh`,
          iat_secs: nowSecs(),
        });
        const refRes = await callText('/api/auth/desktop/v3/session/refresh', {
          body: refCmd.body,
          headers: { DPoP: refCmd.dpop },
        });
        expect(refRes.status).toBe(200);
        const appliedRef = await sendCmd({ op: 'apply_refreshed', tokens_json: refRes.text });
        expect(appliedRef.ok).toBe(true);

        const meAfterRefHdrs = await sendCmd({
          op: 'build_protected_headers',
          method: 'GET',
          target_url: `${ORIGIN}/api/auth/me`,
          nonce_json: await fetchNonceText(),
          iat_secs: nowSecs(),
        });
        const meAfterRef = await callText('/api/auth/me', {
          method: 'GET',
          headers: { Authorization: meAfterRefHdrs.authorization, DPoP: meAfterRefHdrs.dpop },
        });
        expect(meAfterRef.status).toBe(200);

        // Pre-build a fresh valid DPoP header for the still-held token BEFORE clearing tokens in Rust state
        const postLogoutHdrs = await sendCmd({
          op: 'build_protected_headers',
          method: 'GET',
          target_url: `${ORIGIN}/api/auth/me`,
          nonce_json: await fetchNonceText(),
          iat_secs: nowSecs(),
        });

        // 7. Logout via Rust crate, then verify refreshed access token is dead even with a fresh unconsumed DPoP proof
        const outCmd = await sendCmd({
          op: 'build_logout',
          nonce_json: await fetchNonceText(),
          endpoint_url: `${ORIGIN}/api/auth/desktop/v3/session/logout`,
          iat_secs: nowSecs(),
        });
        const outRes = await callText('/api/auth/desktop/v3/session/logout', {
          body: outCmd.body,
          headers: { DPoP: outCmd.dpop },
        });
        expect(outRes.status).toBe(200);
        const appliedOut = await sendCmd({ op: 'apply_logged_out', logout_json: outRes.text });
        expect(appliedOut.ok).toBe(true);
        expect(appliedOut.phase).toBe('logged_out');

        const meAfterOut = await callText('/api/auth/me', {
          method: 'GET',
          headers: { Authorization: postLogoutHdrs.authorization, DPoP: postLogoutHdrs.dpop },
        });
        expect(meAfterOut.status).toBe(401);
      } finally {
        try { child.stdin.end(); } catch { /* */ }
        try { child.kill(); } catch { /* */ }
      }
    },
    150_000,
  );
});
