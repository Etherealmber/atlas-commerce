/**
 * Desktop native authentication protocol v3 (`/api/auth/desktop/v3/*`).
 *
 * Security invariants:
 *  - Fails closed (`503 METHOD_DISABLED`) unless `desktopV3Enabled(env)` is true
 *    (requires `DESKTOP_NATIVE_V3_ENABLED === 'true'`, production explicit
 *    approval `DESKTOP_NATIVE_V3_PROD_APPROVED === 'true'`, D1 batch, Turnstile,
 *    dedicated Resend transport, and 32+ char OTP/mailbox MAC keys).
 *  - Every desktop-initiated operation (`requests`, `challenge/poll`,
 *    `challenge/cancel`, `login/password`, `login/otp`, `login/cancel`,
 *    `session/refresh`, `session/logout`) requires a fresh server `dpop_nonce`
 *    and ES256 `DPoP` proof JWT bound to the same P-256 key thumbprint, with
 *    atomic D1 `(thumbprint, jti)` + single-use nonce consumption.
 *  - Turnstile challenge (`turnstile_webview` or explicit `system_browser`)
 *    verifies directly between the hosted page and the server; no silent
 *    fallback between modes.
 *  - Login OTPs are delivered ONLY to the account's active verified mailbox in
 *    `desktop_mailbox_verified_v1` — never to `app_users.email` or shared inbox.
 *  - `nv3.` access tokens are device-bound and sender-constrained (`DPoP`).
 */
import { Hono, type Context } from 'hono';
import { desktopHash } from './desktopAuth';
import { verifyDesktopTurnstile } from '../lib/desktop-native-turnstile';
import { reserveCredentialAttempt, type CredentialAttemptPurpose } from '../lib/credential-attempt-limits';
import { reserveDesktopCreate } from '../lib/desktop-create-budget';
import { issueDpopNonce, prepareDpopVerification, ensureDpopTables } from '../lib/desktop-device-proof-store';
import { desktopV3Enabled, makeDesktopV3Token } from '../lib/desktop-v3-session';
import { createConfiguredNativeMailbox, createNativeOtpSender } from '../lib/desktop-mail-transport';
import { addColumnIfMissing } from '../lib/schema';
import { ensureSecurityTables } from '../lib/authHelpers';
import { parseClientData, policyFromEnv, expectedOrigin, verifyAuthentication, credentialDescriptors } from '../lib/webauthn';
import { qrToSvg } from '../qrSvg';
import {
  ensureRevokedWebTokensTable,
  getRequestAuthContext,
  parseAuthorizationHeader,
  parseToken,
  webTokenHash,
} from '../lib/authHelpers';

export const NATIVE_V3 = '/api/auth/desktop/v3';

export const V3_PUBLIC_POSTS = new Set(
  [
    'nonce',
    'requests',
    'challenge/prepare',
    'challenge/verify',
    'challenge/poll',
    'challenge/cancel',
    'login/password',
    'login/otp',
    'login/cancel',
    'session/refresh',
    'session/logout',
    'qr/start',
    'qr/exchange',
    'webauthn/options',
    'webauthn/verify',
  ].map((p) => `${NATIVE_V3}/${p}`),
);

export const isNativeV3PublicPost = (path: string) => V3_PUBLIC_POSTS.has(path);

const ID = /^[a-f0-9]{64}$/;
const STATE = /^[A-Za-z0-9_-]{43,128}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const CODE = /^[0-9]{6}$/;
const CHALLENGE_TTL_MS = 300_000;
const LOGIN_TTL_MS = 300_000;
const RECOVERY_TTL_MS = 900_000;
const ACCESS_TTL_MS = 900_000;
const SESSION_ABSOLUTE_TTL_MS = 43_200_000;
const POLL_INTERVAL_MS = 5_000;
const ACTION = 'atlas_desktop_v3';
const QR_TTL_MS = 120_000;
const QR_POLL_INTERVAL_MS = 2_000;
const PASSKEY_TTL_MS = 120_000;

/** Browser-free presentation: explicit opt-in, never an automatic fallback. */
export const nativePresentationEnabled = (env: any) => env?.DESKTOP_NATIVE_V3_NATIVE_LOGIN === 'true';

type Identity = { username: string; role: string; material: string; userId: number | null };

export type DesktopV3Deps = {
  currentIdentity: (env: any, username: string, role: string) => Promise<Identity | null>;
  verifyAppUserPassword: (
    env: any,
    username: string,
    password: string,
  ) => Promise<Identity | null>;
  verifySessionPassword: (
    c: Context<any>,
    password: string,
  ) => Promise<{ username: string; role: string; userId: number | null } | null>;
  authenticatedSession: (c: Context<any>) => Promise<{ username: string; role: string } | null>;
  audit: (
    c: Context<any>,
    entry: { username: string; role: string; action: string; entity: string; detail: string; ip: string },
  ) => Promise<void>;
  mailFetcher?: typeof fetch;
  turnstileFetcher?: typeof fetch;
};

class Failure extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
const fail = (code: string, status = 400): never => {
  throw new Failure(code, status);
};

function randHex(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
}

function same(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

const pattern = (value: unknown, re: RegExp): value is string => typeof value === 'string' && re.test(value);

function validLabel(x: unknown): x is string {
  return (
    typeof x === 'string' &&
    x.length >= 1 &&
    x.length <= 60 &&
    [...x].every((ch) => {
      const n = ch.charCodeAt(0);
      return (
        n >= 32 &&
        !(n >= 0x7f && n <= 0x9f) &&
        ch !== '<' &&
        ch !== '>' &&
        n !== 0x061c &&
        !(n >= 0x200e && n <= 0x200f) &&
        !(n >= 0x202a && n <= 0x202e) &&
        !(n >= 0x2066 && n <= 0x206f)
      );
    })
  );
}

function randomOtp(): string {
  const a = new Uint32Array(1);
  let n: number;
  do {
    crypto.getRandomValues(a);
    n = a[0];
  } while (n >= 4294000000);
  return String(n % 1000000).padStart(6, '0');
}

async function otpMac(key: string, id: string, otp: string): Promise<string> {
  const secret = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const res = await crypto.subtle.sign('HMAC', secret, new TextEncoder().encode(`atlas-native-v3-otp|${id}|${otp}`));
  return Array.from(new Uint8Array(res), (b) => b.toString(16).padStart(2, '0')).join('');
}

function maskEmail(email: string): string {
  const [local, domain] = String(email || '').split('@');
  if (!local || !domain) return '***';
  const head = local.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(2, local.length - 2))}@${domain}`;
}

const schemaReady = new WeakSet<object>();
const REQUESTS_DDL = `
        id TEXT PRIMARY KEY,
        origin TEXT NOT NULL,
        state_hash TEXT NOT NULL,
        challenge TEXT NOT NULL,
        ip_hash TEXT NOT NULL,
        device_thumbprint TEXT NOT NULL,
        label TEXT NOT NULL,
        presentation TEXT NOT NULL CHECK(presentation IN ('turnstile_webview','system_browser','native')),
        cdata TEXT NOT NULL,
        browser_ip_hash TEXT,
        expires_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        polls INTEGER NOT NULL DEFAULT 0,
        last_poll INTEGER NOT NULL DEFAULT 0
      `;

const SESSIONS_DDL = `
        id TEXT PRIMARY KEY,
        origin TEXT NOT NULL,
        username TEXT NOT NULL,
        role TEXT NOT NULL,
        user_id INTEGER,
        credential_tag TEXT NOT NULL,
        device_thumbprint TEXT NOT NULL,
        device_label TEXT NOT NULL,
        access_hash TEXT NOT NULL UNIQUE,
        refresh_hash TEXT NOT NULL UNIQUE,
        previous_refresh_hash TEXT,
        access_expires_at INTEGER NOT NULL,
        absolute_expires_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0
      `;

/**
 * SQLite cannot ALTER a CHECK / NOT NULL constraint. Rebuild the table atomically
 * (one D1 batch = one transaction) when the stored DDL is outdated. The account
 * triggers reference these tables, so they are dropped first and recreated by
 * ensureV3Schema right after (CREATE TRIGGER IF NOT EXISTS).
 */
async function rebuildTableIfNeeded(
  db: D1Database,
  table: string,
  outdated: (sql: string) => boolean,
  ddl: string,
  columns: string,
): Promise<void> {
  const row: any = await db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").bind(table).first();
  if (!row?.sql || !outdated(String(row.sql))) return;
  const tmp = `${table}__v3mig`;
  try {
    await db.batch([
      db.prepare('DROP TRIGGER IF EXISTS desktop_v3_account_update'),
      db.prepare('DROP TRIGGER IF EXISTS desktop_v3_account_delete'),
      db.prepare(`DROP TABLE IF EXISTS ${tmp}`),
      db.prepare(`CREATE TABLE ${tmp} (${ddl})`),
      db.prepare(`INSERT INTO ${tmp} (${columns}) SELECT ${columns} FROM ${table}`),
      db.prepare(`DROP TABLE ${table}`),
      db.prepare(`ALTER TABLE ${tmp} RENAME TO ${table}`),
    ]);
  } catch {
    // A concurrent isolate may have migrated first — only fail if still outdated.
    const again: any = await db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").bind(table).first();
    if (!again?.sql || outdated(String(again.sql))) throw new Failure('UNAVAILABLE', 503);
  }
}

async function ensureV3Schema(db: D1Database): Promise<void> {
  if (schemaReady.has(db)) return;
  await ensureDpopTables(db);
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS desktop_v3_limits (
        bucket TEXT PRIMARY KEY,
        attempts INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )`,
    )
    .run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_v3_limits_exp ON desktop_v3_limits(expires_at)').run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS desktop_v3_requests (${REQUESTS_DDL})`,
    )
    .run();
  await rebuildTableIfNeeded(db, 'desktop_v3_requests', (sql) => !sql.includes("'native'"), REQUESTS_DDL,
    'id, origin, state_hash, challenge, ip_hash, device_thumbprint, label, presentation, cdata, browser_ip_hash, expires_at, status, polls, last_poll');
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_v3_requests_exp ON desktop_v3_requests(expires_at)').run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS desktop_v3_logins (
        id TEXT PRIMARY KEY,
        origin TEXT NOT NULL,
        username TEXT NOT NULL,
        role TEXT,
        user_id INTEGER,
        credential_tag TEXT,
        mailbox_version TEXT,
        device_thumbprint TEXT NOT NULL,
        label TEXT NOT NULL,
        otp_digest TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        delivered INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'checking',
        nonce TEXT
      )`,
    )
    .run();
  await addColumnIfMissing(db, 'desktop_v3_logins', 'mailbox_version', 'TEXT');
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_v3_logins_exp ON desktop_v3_logins(expires_at)').run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS desktop_v3_sessions (${SESSIONS_DDL})`,
    )
    .run();
  await rebuildTableIfNeeded(db, 'desktop_v3_sessions', (sql) => /user_id\s+INTEGER\s+NOT\s+NULL/i.test(sql), SESSIONS_DDL,
    'id, origin, username, role, user_id, credential_tag, device_thumbprint, device_label, access_hash, refresh_hash, previous_refresh_hash, access_expires_at, absolute_expires_at, last_used_at, revoked');
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_v3_sessions_prev ON desktop_v3_sessions(previous_refresh_hash)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_v3_sessions_exp ON desktop_v3_sessions(absolute_expires_at)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_v3_sessions_user ON desktop_v3_sessions(username, revoked)').run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS desktop_v3_refresh_history (
        refresh_hash TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        origin TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )`,
    )
    .run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_v3_refresh_hist_exp ON desktop_v3_refresh_history(expires_at)').run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS desktop_mailbox_verified_v1 (
        user_id INTEGER PRIMARY KEY,
        address TEXT NOT NULL,
        version TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        verified_at INTEGER NOT NULL
      )`,
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS desktop_mailbox_pending_v1 (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL UNIQUE,
        candidate TEXT NOT NULL,
        previous_version TEXT,
        new_digest TEXT NOT NULL,
        old_digest TEXT,
        expires_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        completion_nonce TEXT
      )`,
    )
    .run();

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS desktop_mailbox_recovery_v1 (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending_admin_approval','approved','rejected','expired')),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        reviewed_by TEXT,
        reviewed_at INTEGER
      )`,
    )
    .run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_v3_recovery_user ON desktop_mailbox_recovery_v1(user_id, status)').run();

  await db
    .prepare(
      `CREATE TRIGGER IF NOT EXISTS desktop_v3_account_update AFTER UPDATE OF username, role, password_hash, password_salt, active ON app_users
      WHEN OLD.username IS NOT NEW.username OR OLD.role IS NOT NEW.role OR OLD.password_hash IS NOT NEW.password_hash OR OLD.password_salt IS NOT NEW.password_salt OR OLD.active IS NOT NEW.active BEGIN
        UPDATE desktop_v3_logins SET status='cancelled', otp_digest='' WHERE (user_id=OLD.id OR username=OLD.username) AND status IN ('checking','pending');
        UPDATE desktop_v3_sessions SET revoked=1 WHERE user_id=OLD.id;
      END`,
    )
    .run();
  await db
    .prepare(
      `CREATE TRIGGER IF NOT EXISTS desktop_v3_account_delete AFTER DELETE ON app_users BEGIN
        UPDATE desktop_v3_logins SET status='cancelled', otp_digest='' WHERE (user_id=OLD.id OR username=OLD.username) AND status IN ('checking','pending');
        UPDATE desktop_v3_sessions SET revoked=1 WHERE user_id=OLD.id;
      END`,
    )
    .run();

  // QR approval bound to a native v3 request (DPoP key + PKCE/state)
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS desktop_v3_qr (
        request_id TEXT PRIMARY KEY,
        qr_token TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
      )`,
    )
    .run();
  // Passkey challenge bound to a native v3 request
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS desktop_v3_passkey (
        request_id TEXT PRIMARY KEY,
        challenge TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL DEFAULT '',
        expires_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
      )`,
    )
    .run();

  schemaReady.add(db);
}

async function budget(db: D1Database, category: string, subject: string, windowMs: number, max: number) {
  const now = Date.now();
  const end = (Math.floor(now / windowMs) + 1) * windowMs;
  const key = await desktopHash(JSON.stringify([category, subject, Math.floor(now / windowMs)]));
  const reserved = await db
    .prepare(
      `INSERT INTO desktop_v3_limits (bucket, attempts, expires_at) VALUES (?, 1, ?)
       ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1 WHERE attempts < ? RETURNING attempts`,
    )
    .bind(key, end, max)
    .first();
  if (!reserved) fail('RATE_LIMITED', 429);
}

async function readJsonBody(c: Context<any>, allowedKeys: string[]): Promise<Record<string, any>> {
  if (new URL(c.req.url).search || !/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') || '')) {
    fail('INVALID_REQUEST');
  }
  const reader = c.req.raw.body?.getReader();
  if (!reader) return fail('INVALID_REQUEST');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const deadline = Date.now() + 10_000;
  try {
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Failure('REQUEST_TIMEOUT', 408);
      let timer: ReturnType<typeof setTimeout> | undefined;
      // eslint-disable-next-line no-await-in-loop
      const part = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Failure('REQUEST_TIMEOUT', 408)), remaining);
        }),
      ]).finally(() => {
        if (timer !== undefined) clearTimeout(timer);
      });
      if (part.done) break;
      size += part.value.length;
      if (size > 8192) throw new Failure('INVALID_REQUEST', 413);
      chunks.push(part.value);
    }
    const all = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      all.set(chunk, offset);
      offset += chunk.length;
    }
    const parsed = JSON.parse(new TextDecoder().decode(all));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.keys(parsed).some((k) => !allowedKeys.includes(k))) {
      return fail('INVALID_REQUEST');
    }
    return parsed as Record<string, any>;
  } catch (err) {
    await reader.cancel().catch(() => {});
    if (err instanceof Failure) throw err;
    return fail('INVALID_REQUEST');
  } finally {
    reader.releaseLock();
  }
}

function strictOrigin(c: Context<any>, supplied?: unknown): string {
  if (c.req.url.includes('\\')) fail('ORIGIN_MISMATCH', 403);
  const url = new URL(c.req.url);
  if (url.protocol !== 'https:') fail('HTTPS_REQUIRED');
  if (url.username || url.password) fail('ORIGIN_MISMATCH', 403);
  if (url.search || (supplied !== undefined && supplied !== url.origin)) fail('ORIGIN_MISMATCH', 403);
  const hdr = c.req.header('Origin');
  if (hdr !== undefined && hdr !== url.origin) fail('ORIGIN_MISMATCH', 403);
  const site = c.req.header('Sec-Fetch-Site');
  if (site && site !== 'same-origin' && site !== 'none') fail('ORIGIN_MISMATCH', 403);
  return url.origin;
}

export async function pairingCode(row: { origin: string; id: string; challenge: string }): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(JSON.stringify(['desktop-v3-pairing', row.origin, row.id, row.challenge])),
    ),
  );
  const hex = Array.from(bytes.slice(0, 5), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `${hex.slice(0, 5)}-${hex.slice(5, 10)}`;
}

export function registerDesktopNativeV3(root: Hono<any>, deps: DesktopV3Deps): void {
  const app = new Hono<any>();

  app.onError((error, c) => {
    const known = error instanceof Failure;
    const code = known ? error.code : 'UNAVAILABLE';
    if (code === 'RATE_LIMITED' || code === 'SLOW_DOWN') {
      c.header('Retry-After', code === 'SLOW_DOWN' ? '5' : '600');
    }
    return c.json({ success: false, code, error: 'Opération de connexion indisponible ou refusée.' }, (known ? error.status : 503) as any);
  });

  app.use(`${NATIVE_V3}/*`, async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('CDN-Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    if (!desktopV3Enabled(c.env)) {
      fail('METHOD_DISABLED', 503);
    }
    strictOrigin(c);
    const ip = c.req.header('CF-Connecting-IP') || '';
    if (!ip || ip.length > 64 || /[^0-9a-fA-F:.]/.test(ip)) fail('UNAVAILABLE', 503);
    await ensureV3Schema(c.env.DB);
    const isCreate = c.req.path === `${NATIVE_V3}/requests`;
    await budget(c.env.DB, isCreate ? 'v3-create-ip' : 'v3-op-ip', ip, isCreate ? 300_000 : 60_000, isCreate ? 10 : 120);
    if (isCreate && !(await reserveDesktopCreate(c.env.DB, ip))) {
      fail('RATE_LIMITED', 429);
    }
    await next();
  });

  const targetUrl = (c: Context<any>) => {
    const u = new URL(c.req.url);
    return `${u.origin}${u.pathname}`;
  };

  async function requireDpop(
    c: Context<any>,
    opts: { origin: string; thumbprint?: string; transactionId?: string; accessToken?: string; singleUseNonce?: boolean },
  ) {
    const verified = await prepareDpopVerification(c.env.DB, c.req.header('DPoP'), {
      origin: opts.origin,
      method: c.req.method.toUpperCase(),
      target: targetUrl(c),
      thumbprint: opts.thumbprint,
      transactionId: opts.transactionId,
      accessToken: opts.accessToken,
      singleUseNonce: opts.singleUseNonce ?? true,
    });
    if (!verified) return fail('INVALID_PROOF', 401);
    return verified;
  }

  async function sharedBudget(c: Context<any>, username: string, purpose: CredentialAttemptPurpose) {
    const res = await reserveCredentialAttempt(c.env.DB, c.req.header('CF-Connecting-IP') || '', username, purpose);
    if (!res.allowed) fail('RATE_LIMITED', 429);
  }

  async function getChallengeRow(c: Context<any>, b: Record<string, any>, opts?: { ignoreExpiry?: boolean }) {
    const server = strictOrigin(c, b.origin);
    if (typeof b.origin !== 'string' || !pattern(b.request_id, ID)) fail('INVALID_REQUEST');
    const row: any = await c.env.DB.prepare('SELECT * FROM desktop_v3_requests WHERE id = ?').bind(b.request_id).first();
    if (!row || row.origin !== server) fail('INVALID_REQUEST');
    if (!opts?.ignoreExpiry && row.expires_at <= Date.now()) fail('EXPIRED', 410);
    return row;
  }

  async function verifyDesktopProof(c: Context<any>, b: Record<string, any>, opts?: { ignoreRequestExpiry?: boolean }) {
    const row = await getChallengeRow(c, b, { ignoreExpiry: opts?.ignoreRequestExpiry });
    if (
      !pattern(b.state, STATE) ||
      !pattern(b.code_verifier, VERIFIER) ||
      !same(row.state_hash, await desktopHash(b.state)) ||
      !same(row.challenge, await desktopHash(b.code_verifier)) ||
      !same(row.ip_hash, await desktopHash(c.req.header('CF-Connecting-IP') || ''))
    ) {
      fail('INVALID_PROOF', 401);
    }
    const dpop = await requireDpop(c, {
      origin: row.origin,
      thumbprint: row.device_thumbprint,
      transactionId: row.id,
      singleUseNonce: true,
    });
    return { row, dpop };
  }

  // 1. Fresh DPoP nonce issuance
  app.post(`${NATIVE_V3}/nonce`, async (c) => {
    const server = strictOrigin(c);
    const ipHash = await desktopHash(c.req.header('CF-Connecting-IP') || '');
    const issued = await issueDpopNonce(c.env.DB, server, ipHash);
    c.header('DPoP-Nonce', issued.nonce);
    return c.json({ success: true, data: issued });
  });

  // 2. Create auth request bound to PKCE S256 + DPoP key thumbprint + explicit presentation
  app.post(`${NATIVE_V3}/requests`, async (c) => {
    const b = await readJsonBody(c, ['origin', 'state', 'code_challenge', 'code_challenge_method', 'device_label', 'presentation']);
    const server = strictOrigin(c, b.origin);
    if (
      typeof b.origin !== 'string' ||
      !pattern(b.state, STATE) ||
      !pattern(b.code_challenge, CHALLENGE) ||
      b.code_challenge_method !== 'S256' ||
      !validLabel(b.device_label) ||
      (b.presentation !== 'turnstile_webview' && b.presentation !== 'system_browser' && b.presentation !== 'native')
    ) {
      fail('INVALID_REQUEST');
    }
    const native = b.presentation === 'native';
    if (native && !nativePresentationEnabled(c.env)) fail('METHOD_DISABLED', 503);
    const dpop = await requireDpop(c, { origin: server, singleUseNonce: true });
    const id = randHex();
    const cdata = randHex();
    const now = Date.now();
    const expires = now + CHALLENGE_TTL_MS;
    const ipHash = await desktopHash(c.req.header('CF-Connecting-IP') || '');
    const stateHash = await desktopHash(b.state);
    const results: any[] = await c.env.DB.batch([
      ...dpop.consumeStatements,
      c.env.DB
        .prepare(
          `INSERT INTO desktop_v3_requests (id, origin, state_hash, challenge, ip_hash, device_thumbprint, label, presentation, cdata, expires_at, status, browser_ip_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        // native: no hosted challenge — the request is usable at once by the SAME key + IP
        // (password still requires the verified-mailbox OTP; QR needs phone approval; passkey a signature).
        .bind(id, server, stateHash, b.code_challenge, ipHash, dpop.thumbprint, b.device_label, b.presentation, cdata, expires,
          native ? 'verified' : 'pending', native ? ipHash : null),
    ]);
    if (results.some((r) => Number(r?.meta?.changes || 0) < 1)) fail('INVALID_PROOF', 401);

    // Best-effort pruning (never fail a committed request creation)
    const cutoff = now - 3_600_000;
    try {
      await c.env.DB.prepare('DELETE FROM desktop_v3_requests WHERE id IN (SELECT id FROM desktop_v3_requests WHERE expires_at < ? LIMIT 100)').bind(cutoff).run();
      await c.env.DB.prepare('DELETE FROM desktop_v3_logins WHERE id IN (SELECT id FROM desktop_v3_logins WHERE expires_at < ? LIMIT 100)').bind(cutoff).run();
      await c.env.DB.prepare('DELETE FROM desktop_v3_sessions WHERE id IN (SELECT id FROM desktop_v3_sessions WHERE absolute_expires_at < ? LIMIT 100)').bind(cutoff).run();
      await c.env.DB.prepare('DELETE FROM desktop_v3_refresh_history WHERE refresh_hash IN (SELECT refresh_hash FROM desktop_v3_refresh_history WHERE expires_at < ? LIMIT 100)').bind(cutoff).run();
      await c.env.DB.prepare('DELETE FROM desktop_v3_limits WHERE bucket IN (SELECT bucket FROM desktop_v3_limits WHERE expires_at < ? LIMIT 100)').bind(now).run();
    } catch {
      /* best-effort expiry pruning */
    }

    const code = await pairingCode({ origin: server, id, challenge: b.code_challenge });
    const challengePath = b.presentation === 'turnstile_webview' ? '/login/desktop-v3-challenge' : '/login/desktop-v3-browser';
    return c.json(
      {
        success: true,
        data: {
          version: 3,
          request_id: id,
          origin: server,
          presentation: b.presentation,
          ...(native ? { status: 'verified' } : { challenge_url: `${server}${challengePath}#request_id=${id}` }),
          pairing_code: code,
          device_thumbprint: dpop.thumbprint,
          expires_in: Math.floor(CHALLENGE_TTL_MS / 1000),
          interval: Math.floor(POLL_INTERVAL_MS / 1000),
        },
      },
      201,
    );
  });

  // 3. Hosted challenge prepare & verify (called directly by WebView / system browser)
  app.post(`${NATIVE_V3}/challenge/prepare`, async (c) => {
    const server = strictOrigin(c);
    if (c.req.header('Origin') !== server) fail('ORIGIN_MISMATCH', 403);
    const b = await readJsonBody(c, ['origin', 'request_id']);
    const row = await getChallengeRow(c, b);
    if (row.status !== 'pending') fail('USED', 409);
    return c.json({
      success: true,
      data: {
        request_id: row.id,
        origin: row.origin,
        device_label: row.label,
        pairing_code: await pairingCode(row),
        presentation: row.presentation,
        site_key: String(c.env.TURNSTILE_SITE_KEY).trim(),
        action: ACTION,
        cdata: row.cdata,
        expires_at: new Date(row.expires_at).toISOString(),
      },
    });
  });

  app.post(`${NATIVE_V3}/challenge/verify`, async (c) => {
    const server = strictOrigin(c);
    if (c.req.header('Origin') !== server) fail('ORIGIN_MISMATCH', 403);
    const b = await readJsonBody(c, ['origin', 'request_id', 'decision', 'compare_confirmed', 'turnstile_token']);
    const row = await getChallengeRow(c, b);
    if (b.decision !== 'approve' && b.decision !== 'deny') fail('INVALID_REQUEST');
    if (
      b.decision === 'approve' &&
      ((row.presentation === 'system_browser' && b.compare_confirmed !== true) ||
        typeof b.turnstile_token !== 'string' ||
        !b.turnstile_token ||
        b.turnstile_token.length > 2048)
    ) {
      fail('INVALID_REQUEST');
    }
    if (b.decision === 'deny') {
      const denied = await c.env.DB
        .prepare("UPDATE desktop_v3_requests SET status='denied' WHERE id=? AND status='pending' AND expires_at>? RETURNING id")
        .bind(row.id, Date.now())
        .first();
      if (!denied) fail('USED', 409);
      return c.json({ success: true, data: { status: 'denied' } });
    }
    const claimed = await c.env.DB
      .prepare("UPDATE desktop_v3_requests SET status='verifying' WHERE id=? AND status='pending' AND expires_at>? RETURNING id")
      .bind(row.id, Date.now())
      .first();
    if (!claimed) fail('USED', 409);

    const browserIpHash = await desktopHash(c.req.header('CF-Connecting-IP') || '');
    if (!same(row.ip_hash, browserIpHash)) {
      await c.env.DB.prepare("UPDATE desktop_v3_requests SET status='failed' WHERE id=? AND status='verifying'").bind(row.id).run();
      fail('CHALLENGE_FAILED', 403);
    }

    const ok = await verifyDesktopTurnstile(
      {
        token: b.turnstile_token,
        secret: String(c.env.TURNSTILE_SECRET_KEY).trim(),
        hostname: new URL(row.origin).hostname,
        action: ACTION,
        cdata: row.cdata,
      },
      deps.turnstileFetcher,
    );

    const finished = await c.env.DB
      .prepare("UPDATE desktop_v3_requests SET status=?, browser_ip_hash=? WHERE id=? AND status='verifying' AND expires_at>? RETURNING id")
      .bind(ok ? 'verified' : 'failed', ok ? browserIpHash : null, row.id, Date.now())
      .first();
    if (!finished) fail('UNAVAILABLE', 503);
    if (!ok) fail('CHALLENGE_FAILED', 403);
    return c.json({ success: true, data: { status: 'verified' } });
  });

  const proofFields = ['origin', 'request_id', 'state', 'code_verifier'];

  app.post(`${NATIVE_V3}/challenge/poll`, async (c) => {
    const b = await readJsonBody(c, proofFields);
    const { row, dpop } = await verifyDesktopProof(c, b);
    const now = Date.now();
    const res: any[] = await c.env.DB.batch([
      ...dpop.consumeStatements,
      c.env.DB
        .prepare("UPDATE desktop_v3_requests SET polls=polls+1, last_poll=? WHERE id=? AND polls<60 AND last_poll<=? AND expires_at>? RETURNING status")
        .bind(now, row.id, now - POLL_INTERVAL_MS, now),
    ]);
    const updated = res[res.length - 1]?.results?.[0];
    if (!updated) fail('SLOW_DOWN', 429);
    return c.json({
      success: true,
      data: {
        status: updated.status,
        request_id: row.id,
        origin: row.origin,
        interval: Math.floor(POLL_INTERVAL_MS / 1000),
      },
    });
  });

  app.post(`${NATIVE_V3}/challenge/cancel`, async (c) => {
    const b = await readJsonBody(c, proofFields);
    const { row, dpop } = await verifyDesktopProof(c, b);
    const res: any[] = await c.env.DB.batch([
      ...dpop.consumeStatements,
      c.env.DB
        .prepare("UPDATE desktop_v3_requests SET status='cancelled' WHERE id=? AND status IN ('pending','verifying','verified') AND expires_at>? RETURNING id")
        .bind(row.id, Date.now()),
    ]);
    if (Number(res[res.length - 1]?.meta?.changes || 0) !== 1) fail('USED', 409);
    return c.json({ success: true, data: { status: 'cancelled' } });
  });

  // 4. Native password + per-account verified mailbox OTP delivery
  const genericAuthFailure = () => fail('AUTH_FAILED', 401);

  app.post(`${NATIVE_V3}/login/password`, async (c) => {
    const b = await readJsonBody(c, [...proofFields, 'username', 'password']);
    const { row: reqRow, dpop } = await verifyDesktopProof(c, b);
    const username = typeof b.username === 'string' ? b.username.trim().toLowerCase() : '';
    if (!/^[a-z0-9._-]{1,64}$/.test(username) || typeof b.password !== 'string' || b.password.length < 1 || b.password.length > 512) {
      fail('INVALID_REQUEST');
    }
    const ip = c.req.header('CF-Connecting-IP')!;
    await budget(c.env.DB, 'v3-pw-acct', username, 600_000, 20);
    await budget(c.env.DB, 'v3-pw-pair', JSON.stringify([username, ip]), 600_000, 5);
    if (reqRow.presentation === 'native') {
      // No interactive challenge in front of native attempts: cap per-IP password tries too.
      await budget(c.env.DB, 'v3-native-pw-ip', ip, 600_000, 10);
      await budget(c.env.DB, 'v3-native-pw-ip-day', ip, 86_400_000, 40);
    }

    if (reqRow.status !== 'verified' || !reqRow.browser_ip_hash || !same(reqRow.browser_ip_hash, reqRow.ip_hash)) {
      fail('NOT_APPROVED', 409);
    }
    await sharedBudget(c, username, 'password');

    const now = Date.now();
    const loginExpiry = now + LOGIN_TTL_MS;
    const reserved: any[] = await c.env.DB.batch([
      ...dpop.consumeStatements,
      c.env.DB
        .prepare(
          `INSERT INTO desktop_v3_logins (id, origin, username, device_thumbprint, label, otp_digest, expires_at, status)
           SELECT id, origin, ?, device_thumbprint, label, '', ?, 'checking'
           FROM desktop_v3_requests WHERE id=? AND status='verified' AND expires_at>?`,
        )
        .bind(username, loginExpiry, reqRow.id, now),
      c.env.DB
        .prepare("UPDATE desktop_v3_requests SET status='consumed' WHERE id=? AND status='verified' AND expires_at>?")
        .bind(reqRow.id, now),
    ]);
    if (
      Number(reserved[reserved.length - 2]?.meta?.changes || 0) !== 1 ||
      Number(reserved[reserved.length - 1]?.meta?.changes || 0) !== 1
    ) {
      fail('NOT_APPROVED', 409);
    }

    const identity = await deps.verifyAppUserPassword(c.env, username, b.password);
    const otp = randomOtp();
    const digest = await otpMac(c.env.DESKTOP_NATIVE_V3_OTP_KEY, reqRow.id, otp);

    let verifiedMailbox: { address: string; version: string } | null = null;
    if (identity && identity.userId !== null) {
      const mbox: any = await c.env.DB
        .prepare('SELECT address, version, active FROM desktop_mailbox_verified_v1 WHERE user_id = ? AND active = 1')
        .bind(identity.userId)
        .first();
      if (mbox?.address && mbox?.version) {
        verifiedMailbox = { address: String(mbox.address), version: String(mbox.version) };
      }
    }

    let updated: any;
    if (identity && identity.userId !== null && verifiedMailbox) {
      const tag = await desktopHash(identity.material);
      updated = await c.env.DB
        .prepare(
          `UPDATE desktop_v3_logins SET role=?, user_id=?, credential_tag=?, mailbox_version=?, otp_digest=?, status='pending'
           WHERE id=? AND status='checking' AND expires_at>?
             AND EXISTS (SELECT 1 FROM app_users WHERE id=? AND username=? AND role=? AND password_hash=? AND active=1)
             AND EXISTS (SELECT 1 FROM desktop_mailbox_verified_v1 WHERE user_id=? AND active=1 AND address=? AND version=?)
           RETURNING id`,
        )
        .bind(
          identity.role,
          identity.userId,
          tag,
          verifiedMailbox.version,
          digest,
          reqRow.id,
          Date.now(),
          identity.userId,
          username,
          identity.role,
          identity.material,
          identity.userId,
          verifiedMailbox.address,
          verifiedMailbox.version,
        )
        .first();
    } else {
      // Anti-enumeration: transition to pending with no deliverable mailbox.
      updated = await c.env.DB
        .prepare("UPDATE desktop_v3_logins SET otp_digest=?, status='pending' WHERE id=? AND status='checking' AND expires_at>? RETURNING id")
        .bind(digest, reqRow.id, Date.now())
        .first();
    }
    if (!updated) fail('UNAVAILABLE', 503);

    if (identity && identity.userId !== null && verifiedMailbox) {
      const sendOtp = createNativeOtpSender(c.env, deps.mailFetcher);
      if (sendOtp) {
        const boundUserId = identity.userId;
        const boundAddress = verifiedMailbox.address;
        const boundVersion = verifiedMailbox.version;
        const task = (async () => {
          try {
            const stillBound = await c.env.DB
              .prepare(
                `SELECT 1 AS ok FROM desktop_v3_logins l
                 JOIN desktop_mailbox_verified_v1 m ON m.user_id = l.user_id
                 WHERE l.id=? AND l.status='pending' AND l.mailbox_version=? AND l.expires_at>?
                   AND m.user_id=? AND m.active=1 AND m.address=? AND m.version=?`,
              )
              .bind(reqRow.id, boundVersion, Date.now(), boundUserId, boundAddress, boundVersion)
              .first();
            if (!stillBound) return;
            if (await sendOtp(boundAddress, otp)) {
              await c.env.DB
                .prepare(
                  `UPDATE desktop_v3_logins SET delivered=1
                   WHERE id=? AND status='pending' AND mailbox_version=? AND expires_at>?
                     AND EXISTS (SELECT 1 FROM desktop_mailbox_verified_v1 WHERE user_id=? AND active=1 AND address=? AND version=?)`,
                )
                .bind(reqRow.id, boundVersion, Date.now(), boundUserId, boundAddress, boundVersion)
                .run();
            }
          } catch {
            /* remain undelivered */
          }
        })();
        try {
          c.executionCtx.waitUntil(task);
        } catch {
          await task;
        }
      }
    }

    return c.json({ success: true, data: { status: 'otp_pending' } });
  });

  app.post(`${NATIVE_V3}/login/cancel`, async (c) => {
    const b = await readJsonBody(c, proofFields);
    const { row, dpop } = await verifyDesktopProof(c, b, { ignoreRequestExpiry: true });
    const res: any[] = await c.env.DB.batch([
      ...dpop.consumeStatements,
      c.env.DB
        .prepare("UPDATE desktop_v3_logins SET status='cancelled', otp_digest='' WHERE id=? AND status IN ('checking','pending') AND expires_at>? RETURNING id")
        .bind(row.id, Date.now()),
    ]);
    if (Number(res[res.length - 1]?.meta?.changes || 0) !== 1) fail('USED', 409);
    return c.json({ success: true, data: { status: 'cancelled' } });
  });

  app.post(`${NATIVE_V3}/login/otp`, async (c) => {
    const b = await readJsonBody(c, [...proofFields, 'otp']);
    const { row: reqRow, dpop } = await verifyDesktopProof(c, b, { ignoreRequestExpiry: true });
    if (!pattern(b.otp, CODE)) return genericAuthFailure();

    const loginRow: any = await c.env.DB.prepare('SELECT * FROM desktop_v3_logins WHERE id = ?').bind(reqRow.id).first();
    if (!loginRow || loginRow.expires_at <= Date.now()) return genericAuthFailure();

    const ip = c.req.header('CF-Connecting-IP')!;
    await sharedBudget(c, loginRow.username, 'otp');
    await budget(c.env.DB, 'v3-otp-acct', loginRow.username, 600_000, 20);
    await budget(c.env.DB, 'v3-otp-pair', JSON.stringify([loginRow.username, ip]), 600_000, 5);

    const attempted: any = await c.env.DB
      .prepare("UPDATE desktop_v3_logins SET attempts=attempts+1 WHERE id=? AND status='pending' AND attempts<5 AND expires_at>? RETURNING *")
      .bind(reqRow.id, Date.now())
      .first();
    if (!attempted) return genericAuthFailure();

    const digest = await otpMac(c.env.DESKTOP_NATIVE_V3_OTP_KEY, reqRow.id, b.otp);
    if (!same(digest, attempted.otp_digest) || attempted.delivered !== 1 || !attempted.role || !attempted.user_id || !attempted.mailbox_version) {
      return genericAuthFailure();
    }

    const identity = await deps.currentIdentity(c.env, attempted.username, attempted.role);
    if (!identity || identity.userId !== attempted.user_id || !same(await desktopHash(identity.material), attempted.credential_tag)) {
      return genericAuthFailure();
    }
    const activeMailbox = await c.env.DB
      .prepare('SELECT 1 AS ok FROM desktop_mailbox_verified_v1 WHERE user_id=? AND active=1 AND version=?')
      .bind(attempted.user_id, attempted.mailbox_version)
      .first();
    if (!activeMailbox) return genericAuthFailure();

    const now = Date.now();
    const sid = randHex();
    const nonce = randHex();
    const access = makeDesktopV3Token(identity.username, identity.role, randHex());
    const refresh = randHex();
    const accessExpiry = now + ACCESS_TTL_MS;
    const absoluteExpiry = now + SESSION_ABSOLUTE_TTL_MS;

    const committed: any[] = await c.env.DB.batch([
      ...dpop.consumeStatements,
      c.env.DB
        .prepare(
          `UPDATE desktop_v3_logins SET status='completed', nonce=?, otp_digest=''
           WHERE id=? AND status='pending' AND delivered=1 AND otp_digest=? AND mailbox_version=? AND attempts<=5 AND expires_at>?
             AND EXISTS (SELECT 1 FROM desktop_mailbox_verified_v1 WHERE user_id=? AND active=1 AND version=?)`,
        )
        .bind(nonce, reqRow.id, digest, attempted.mailbox_version, now, attempted.user_id, attempted.mailbox_version),
      c.env.DB
        .prepare(
          `INSERT INTO desktop_v3_sessions
             (id, origin, username, role, user_id, credential_tag, device_thumbprint, device_label, access_hash, refresh_hash, access_expires_at, absolute_expires_at, last_used_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           FROM desktop_v3_logins WHERE id=? AND status='completed' AND nonce=?`,
        )
        .bind(
          sid,
          reqRow.origin,
          identity.username,
          identity.role,
          identity.userId,
          attempted.credential_tag,
          dpop.thumbprint,
          reqRow.label,
          await desktopHash(access),
          await desktopHash(refresh),
          accessExpiry,
          absoluteExpiry,
          now,
          reqRow.id,
          nonce,
        ),
    ]);
    if (
      Number(committed[committed.length - 2]?.meta?.changes || 0) !== 1 ||
      Number(committed[committed.length - 1]?.meta?.changes || 0) !== 1
    ) {
      return genericAuthFailure();
    }

    await deps.audit(c, {
      username: identity.username,
      role: identity.role,
      action: 'auth.desktop_v3_login',
      entity: 'session',
      detail: `sid=${sid.slice(0, 12)} jkt=${dpop.thumbprint.slice(0, 12)}`,
      ip,
    });

    return c.json({
      success: true,
      data: {
        token_type: 'DPoP',
        access_token: access,
        refresh_token: refresh,
        access_expires_at: new Date(accessExpiry).toISOString(),
        session_expires_at: new Date(absoluteExpiry).toISOString(),
        origin: reqRow.origin,
        username: identity.username,
        role: identity.role,
        session_id: sid,
        device_thumbprint: dpop.thumbprint,
        attestation: 'client_key_unattested',
      },
    });
  });

  /**
   * Issue a device-bound v3 session pair for an already-verified native request.
   * Every statement runs in ONE batch: DPoP nonce/JTI consumption, the
   * method-specific single-use guard(s), request consumption and session insert.
   * Any guard with changes !== 1 aborts with a generic failure (no oracle).
   */
  async function commitSession(
    c: Context<any>,
    opts: {
      reqRow: any;
      dpop: { thumbprint: string; consumeStatements: any[] };
      identity: Identity;
      guards: any[];
      /** Extra SQL conditions (ANDed) proving the guards above really fired in this batch. */
      insertWhen: { sql: string; params: unknown[] }[];
      method: 'qr' | 'passkey';
    },
  ) {
    const { reqRow, dpop, identity } = opts;
    const now = Date.now();
    const sid = randHex();
    const access = makeDesktopV3Token(identity.username, identity.role, randHex());
    const refresh = randHex();
    const accessExpiry = now + ACCESS_TTL_MS;
    const absoluteExpiry = now + SESSION_ABSOLUTE_TTL_MS;
    const credentialTag = await desktopHash(identity.material);
    const committed: any[] = await c.env.DB.batch([
      ...dpop.consumeStatements,
      ...opts.guards,
      // Single-use: the request flips verified -> consumed exactly once, stamped with this session id.
      c.env.DB
        .prepare("UPDATE desktop_v3_requests SET status='consumed', cdata=? WHERE id=? AND status='verified' AND device_thumbprint=?")
        .bind(`session:${sid}`, reqRow.id, dpop.thumbprint),
      // Conditional insert: only when THIS batch consumed the request and every method guard fired.
      c.env.DB
        .prepare(
          `INSERT INTO desktop_v3_sessions
             (id, origin, username, role, user_id, credential_tag, device_thumbprint, device_label, access_hash, refresh_hash, access_expires_at, absolute_expires_at, last_used_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           FROM desktop_v3_requests WHERE id=? AND status='consumed' AND cdata=?${opts.insertWhen.map((w) => ` AND ${w.sql}`).join('')}`,
        )
        .bind(
          sid, reqRow.origin, identity.username, identity.role, identity.userId, credentialTag, dpop.thumbprint, reqRow.label,
          await desktopHash(access), await desktopHash(refresh), accessExpiry, absoluteExpiry, now,
          reqRow.id, `session:${sid}`, ...opts.insertWhen.flatMap((w) => w.params),
        ),
    ]);
    const tail = committed.slice(dpop.consumeStatements.length);
    if (tail.some((r) => Number(r?.meta?.changes || 0) !== 1)) return genericAuthFailure();
    await deps.audit(c, {
      username: identity.username,
      role: identity.role,
      action: `auth.desktop_v3_${opts.method}_login`,
      entity: 'session',
      detail: `sid=${sid.slice(0, 12)} jkt=${dpop.thumbprint.slice(0, 12)}`,
      ip: c.req.header('CF-Connecting-IP') || '',
    });
    return c.json({
      success: true,
      data: {
        token_type: 'DPoP',
        access_token: access,
        refresh_token: refresh,
        access_expires_at: new Date(accessExpiry).toISOString(),
        session_expires_at: new Date(absoluteExpiry).toISOString(),
        origin: reqRow.origin,
        username: identity.username,
        role: identity.role,
        session_id: sid,
        device_thumbprint: dpop.thumbprint,
        attestation: 'client_key_unattested',
        method: opts.method,
      },
    });
  }

  /** Consume a DPoP proof without other side effects (pending/negative answers stay replay-safe). */
  async function consumeOnly(c: Context<any>, dpop: { consumeStatements: any[] }) {
    if (!dpop.consumeStatements.length) return;
    const res: any[] = await c.env.DB.batch(dpop.consumeStatements);
    if (res.some((r) => Number(r?.meta?.changes || 0) < 1)) fail('INVALID_PROOF', 401);
  }

  function requireUsableNativeRequest(row: any) {
    if (row.status !== 'verified' || !row.browser_ip_hash || !same(row.browser_ip_hash, row.ip_hash)) fail('NOT_APPROVED', 409);
  }

  // 4b. QR login: the phone (already signed in) approves; the desktop exchanges with its key + PKCE.
  app.post(`${NATIVE_V3}/qr/start`, async (c) => {
    if (!nativePresentationEnabled(c.env)) fail('METHOD_DISABLED', 503);
    const b = await readJsonBody(c, proofFields);
    const { row, dpop } = await verifyDesktopProof(c, b);
    requireUsableNativeRequest(row);
    await budget(c.env.DB, 'v3-qr-start-ip', c.req.header('CF-Connecting-IP')!, 600_000, 20);
    await ensureSecurityTables(c.env.DB);
    const token = randHex();
    const now = Date.now();
    const expires = Math.min(now + QR_TTL_MS, Number(row.expires_at));
    const res: any[] = await c.env.DB.batch([
      ...dpop.consumeStatements,
      c.env.DB
        .prepare("INSERT INTO desktop_v3_qr (request_id, qr_token, expires_at, status) SELECT id, ?, ?, 'pending' FROM desktop_v3_requests WHERE id=? AND status='verified' AND expires_at>?")
        .bind(token, expires, row.id, now),
      c.env.DB
        .prepare(`INSERT INTO qr_login_sessions (token, username, role, created_by, status, expires_at) VALUES (?, '', '', 'desktop-v3', 'pending', ?)`)
        .bind(token, new Date(expires).toISOString()),
    ]).catch(() => fail('USED', 409));
    if (res.slice(dpop.consumeStatements.length).some((r) => Number(r?.meta?.changes || 0) !== 1)) fail('USED', 409);
    const qrUrl = `${row.origin}/login/qr?t=${token}&mode=pc`;
    let qrSvg = '';
    try { qrSvg = qrToSvg(qrUrl, 220, 2); } catch { /* client can render qr_url itself */ }
    return c.json({
      success: true,
      data: {
        status: 'pending',
        qr_url: qrUrl,
        qr_svg: qrSvg,
        expires_in: Math.max(1, Math.floor((expires - now) / 1000)),
        interval: Math.floor(QR_POLL_INTERVAL_MS / 1000),
      },
    }, 201);
  });

  app.post(`${NATIVE_V3}/qr/exchange`, async (c) => {
    if (!nativePresentationEnabled(c.env)) fail('METHOD_DISABLED', 503);
    const b = await readJsonBody(c, proofFields);
    const { row, dpop } = await verifyDesktopProof(c, b, { ignoreRequestExpiry: true });
    await budget(c.env.DB, 'v3-qr-poll', row.id, 300_000, 150);
    const link: any = await c.env.DB.prepare('SELECT * FROM desktop_v3_qr WHERE request_id=?').bind(row.id).first();
    if (!link) { await consumeOnly(c, dpop); fail('INVALID_REQUEST'); }
    const qr: any = await c.env.DB.prepare('SELECT * FROM qr_login_sessions WHERE token=?').bind(link.qr_token).first();
    const now = Date.now();
    if (!qr || link.status === 'consumed' || qr.status === 'consumed') { await consumeOnly(c, dpop); fail('USED', 409); }
    if (qr.status === 'denied') { await consumeOnly(c, dpop); fail('DENIED', 410); }
    if (link.expires_at <= now || qr.status === 'expired' || Date.parse(String(qr.expires_at || '')) <= now) {
      await consumeOnly(c, dpop);
      fail('EXPIRED', 410);
    }
    if (qr.status !== 'approved') {
      await consumeOnly(c, dpop);
      return c.json({ success: true, data: { status: qr.status === 'claimed' ? 'scanned' : 'pending', interval: Math.floor(QR_POLL_INTERVAL_MS / 1000) } }, 202);
    }
    const identity = await deps.currentIdentity(c.env, String(qr.username || ''), String(qr.role || ''));
    if (!identity) { await consumeOnly(c, dpop); return genericAuthFailure(); }
    return commitSession(c, {
      reqRow: row,
      dpop,
      identity,
      method: 'qr',
      guards: [
        c.env.DB
          .prepare("UPDATE qr_login_sessions SET status='consumed', consumed_at=datetime('now') WHERE token=? AND status='approved' AND created_by='desktop-v3' AND username=? AND role=?")
          .bind(link.qr_token, identity.username, identity.role),
        c.env.DB
          .prepare("UPDATE desktop_v3_qr SET status='consumed' WHERE request_id=? AND status='pending' AND expires_at>?")
          .bind(row.id, now),
      ],
      insertWhen: [
        { sql: "EXISTS (SELECT 1 FROM desktop_v3_qr WHERE request_id=? AND qr_token=? AND status='consumed')", params: [row.id, link.qr_token] },
        { sql: "EXISTS (SELECT 1 FROM qr_login_sessions WHERE token=? AND status='consumed' AND username=? AND role=?)", params: [link.qr_token, identity.username, identity.role] },
      ],
    });
  });

  // 4c. Passkey login: challenge bound to the request; origin/rpId = the web policy (no allowlist widening).
  app.post(`${NATIVE_V3}/webauthn/options`, async (c) => {
    if (!nativePresentationEnabled(c.env)) fail('METHOD_DISABLED', 503);
    const policy = policyFromEnv(c.env);
    if (!policy.enabled) fail('METHOD_DISABLED', 503);
    const b = await readJsonBody(c, [...proofFields, 'username']);
    const { row, dpop } = await verifyDesktopProof(c, b);
    requireUsableNativeRequest(row);
    const username = typeof b.username === 'string' ? b.username.trim().toLowerCase() : '';
    if (username && !/^[a-z0-9._-]{1,64}$/.test(username)) fail('INVALID_REQUEST');
    await budget(c.env.DB, 'v3-pk-ip', c.req.header('CF-Connecting-IP')!, 600_000, 30);
    await ensureSecurityTables(c.env.DB);
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const challenge = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const now = Date.now();
    const expires = Math.min(now + PASSKEY_TTL_MS, Number(row.expires_at));
    const res: any[] = await c.env.DB.batch([
      ...dpop.consumeStatements,
      c.env.DB
        .prepare(
          `INSERT INTO desktop_v3_passkey (request_id, challenge, username, expires_at, status) VALUES (?, ?, ?, ?, 'pending')
           ON CONFLICT(request_id) DO UPDATE SET challenge=excluded.challenge, username=excluded.username, expires_at=excluded.expires_at
           WHERE desktop_v3_passkey.status='pending'`,
        )
        .bind(row.id, challenge, username, expires),
    ]);
    if (Number(res[res.length - 1]?.meta?.changes || 0) !== 1) fail('USED', 409);
    const allow = username ? await credentialDescriptors(c.env.DB, username) : [];
    return c.json({
      success: true,
      data: {
        challenge,
        timeout: Math.max(1000, expires - now),
        userVerification: policy.requireUV ? 'required' : 'preferred',
        allowCredentials: allow,
        rpId: policy.rpId,
        origin: expectedOrigin(policy),
      },
    });
  });

  app.post(`${NATIVE_V3}/webauthn/verify`, async (c) => {
    if (!nativePresentationEnabled(c.env)) fail('METHOD_DISABLED', 503);
    const policy = policyFromEnv(c.env);
    if (!policy.enabled) fail('METHOD_DISABLED', 503);
    const b = await readJsonBody(c, [...proofFields, 'credential']);
    const { row, dpop } = await verifyDesktopProof(c, b, { ignoreRequestExpiry: true });
    const cred = b.credential && typeof b.credential === 'object' ? b.credential : {};
    const resp = cred.response && typeof cred.response === 'object' ? cred.response : {};
    const str = (v: unknown, max: number) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : '');
    const credentialId = str(cred.id, 1024);
    const clientDataJSON = str(resp.clientDataJSON, 8192);
    const authenticatorData = str(resp.authenticatorData, 8192);
    const signature = str(resp.signature, 1024);
    const userHandle = typeof resp.userHandle === 'string' ? resp.userHandle.slice(0, 256) : '';

    // Any failure burns the challenge: one signature attempt per options call.
    const burn = async () => {
      await c.env.DB.batch([
        ...dpop.consumeStatements,
        c.env.DB.prepare("UPDATE desktop_v3_passkey SET status='failed' WHERE request_id=? AND status='pending'").bind(row.id),
      ]).catch(() => {});
      return genericAuthFailure();
    };
    if (!credentialId || !clientDataJSON || !authenticatorData || !signature) return burn();
    const pk: any = await c.env.DB.prepare('SELECT * FROM desktop_v3_passkey WHERE request_id=?').bind(row.id).first();
    let challenge = '';
    try { challenge = parseClientData(clientDataJSON).json.challenge; } catch { return burn(); }
    const now = Date.now();
    if (!pk || pk.status !== 'pending' || pk.expires_at <= now || !same(pk.challenge, challenge)) return burn();
    requireUsableNativeRequest(row);

    const stored: any = await c.env.DB.prepare('SELECT * FROM webauthn_credentials WHERE id = ?').bind(credentialId).first();
    if (!stored || !String(stored.public_key_jwk || '')) return burn();
    const credUser = String(stored.username || '').toLowerCase();
    if (!credUser || (pk.username && credUser !== pk.username)) return burn();
    let jwk: any;
    try { jwk = JSON.parse(String(stored.public_key_jwk)); } catch { return burn(); }
    let verified;
    try {
      verified = await verifyAuthentication({
        clientDataJSON,
        authenticatorData,
        signature,
        userHandle: userHandle || undefined,
        expectedChallenge: challenge,
        policy,
        stored: {
          publicKeyJwk: jwk,
          counter: Number(stored.counter || 0),
          backupEligible: Number(stored.backup_eligible || 0) === 1,
          userHandle: String(stored.cred_user_handle || ''),
        },
      });
    } catch {
      return burn();
    }

    // Account comes ONLY from the verified credential row; role from the live account.
    const userRow: any = await c.env.DB.prepare('SELECT role FROM app_users WHERE username=? AND active=1').bind(credUser).first();
    const identity = await deps.currentIdentity(c.env, credUser, userRow ? String(userRow.role) : 'owner');
    if (!identity) return burn();

    return commitSession(c, {
      reqRow: row,
      dpop,
      identity,
      method: 'passkey',
      guards: [
        c.env.DB
          .prepare("UPDATE desktop_v3_passkey SET status='consumed' WHERE request_id=? AND challenge=? AND status='pending' AND expires_at>?")
          .bind(row.id, challenge, now),
        c.env.DB
          .prepare("UPDATE webauthn_credentials SET counter=?, backup_state=?, last_used=datetime('now') WHERE id=?")
          .bind(verified.counter, verified.backupState ? 1 : 0, credentialId),
      ],
      insertWhen: [
        { sql: "EXISTS (SELECT 1 FROM desktop_v3_passkey WHERE request_id=? AND challenge=? AND status='consumed')", params: [row.id, challenge] },
      ],
    });
  });

  // 5. Device-bound refresh rotation + family reuse revocation
  app.post(`${NATIVE_V3}/session/refresh`, async (c) => {
    const b = await readJsonBody(c, ['origin', 'refresh_token']);
    const server = strictOrigin(c, b.origin);
    if (!pattern(b.refresh_token, ID)) return genericAuthFailure();
    const oldHash = await desktopHash(b.refresh_token);
    const row: any = await c.env.DB.prepare('SELECT * FROM desktop_v3_sessions WHERE refresh_hash = ?').bind(oldHash).first();
    if (!row) {
      const retiredFamily: any = await c.env.DB
        .prepare(
          `SELECT id, device_thumbprint FROM desktop_v3_sessions
           WHERE origin=? AND (previous_refresh_hash=? OR id IN
             (SELECT session_id FROM desktop_v3_refresh_history WHERE refresh_hash=? AND origin=?))
           LIMIT 1`,
        )
        .bind(server, oldHash, oldHash, server)
        .first();
      if (retiredFamily) {
        const proof = await requireDpop(c, { origin: server, thumbprint: retiredFamily.device_thumbprint, singleUseNonce: true });
        await c.env.DB.batch([
          ...proof.consumeStatements,
          c.env.DB
            .prepare('UPDATE desktop_v3_sessions SET revoked=1 WHERE id=? AND origin=? AND revoked=0')
            .bind(retiredFamily.id, server),
        ]);
      }
      return genericAuthFailure();
    }
    const dpop = await requireDpop(c, { origin: server, thumbprint: row.device_thumbprint, singleUseNonce: true });
    if (row.revoked !== 0 || row.origin !== server || row.absolute_expires_at <= Date.now()) {
      return genericAuthFailure();
    }
    const id = await deps.currentIdentity(c.env, row.username, row.role);
    if (!id || id.userId !== row.user_id || !same(await desktopHash(id.material), row.credential_tag)) {
      return genericAuthFailure();
    }
    await budget(c.env.DB, 'v3-refresh-family', row.id, 600_000, 12);

    const access = makeDesktopV3Token(row.username, row.role, randHex());
    const refresh = randHex();
    const now = Date.now();
    const accessExpiry = Math.min(now + ACCESS_TTL_MS, row.absolute_expires_at);

    const result: any[] = await c.env.DB.batch([
      ...dpop.consumeStatements,
      c.env.DB
        .prepare(
          `INSERT INTO desktop_v3_refresh_history (refresh_hash, session_id, origin, expires_at)
           SELECT refresh_hash, id, origin, absolute_expires_at FROM desktop_v3_sessions
           WHERE id=? AND origin=? AND refresh_hash=? AND revoked=0 AND absolute_expires_at>?`,
        )
        .bind(row.id, server, oldHash, now),
      c.env.DB
        .prepare(
          `INSERT OR IGNORE INTO desktop_v3_refresh_history (refresh_hash, session_id, origin, expires_at)
           SELECT previous_refresh_hash, id, origin, absolute_expires_at FROM desktop_v3_sessions
           WHERE id=? AND origin=? AND refresh_hash=? AND previous_refresh_hash IS NOT NULL AND revoked=0 AND absolute_expires_at>?`,
        )
        .bind(row.id, server, oldHash, now),
      c.env.DB
        .prepare(
          `UPDATE desktop_v3_sessions
           SET access_hash=?, refresh_hash=?, previous_refresh_hash=?, access_expires_at=?, last_used_at=?
           WHERE id=? AND origin=? AND refresh_hash=? AND revoked=0 AND absolute_expires_at>?`,
        )
        .bind(await desktopHash(access), await desktopHash(refresh), oldHash, accessExpiry, now, row.id, server, oldHash, now),
    ]);

    if (
      Number(result[result.length - 3]?.meta?.changes || 0) !== 1 ||
      Number(result[result.length - 1]?.meta?.changes || 0) !== 1
    ) {
      await c.env.DB
        .prepare(
          `UPDATE desktop_v3_sessions SET revoked=1
           WHERE id=? AND origin=? AND revoked=0 AND (previous_refresh_hash=? OR id IN
             (SELECT session_id FROM desktop_v3_refresh_history WHERE refresh_hash=? AND origin=?))`,
        )
        .bind(row.id, server, oldHash, oldHash, server)
        .run();
      return genericAuthFailure();
    }

    return c.json({
      success: true,
      data: {
        token_type: 'DPoP',
        access_token: access,
        refresh_token: refresh,
        access_expires_at: new Date(accessExpiry).toISOString(),
        session_expires_at: new Date(row.absolute_expires_at).toISOString(),
        origin: row.origin,
        username: row.username,
        role: row.role,
        session_id: row.id,
        device_thumbprint: row.device_thumbprint,
      },
    });
  });

  // 6. Server-side logout revocation (DPoP-bound to the device key)
  app.post(`${NATIVE_V3}/session/logout`, async (c) => {
    const b = await readJsonBody(c, ['origin', 'refresh_token']);
    const server = strictOrigin(c, b.origin);
    if (!pattern(b.refresh_token, ID)) return genericAuthFailure();
    const presented = await desktopHash(b.refresh_token);
    const targetRow: any = await c.env.DB
      .prepare(
        `SELECT id, username, role, device_thumbprint FROM desktop_v3_sessions
         WHERE origin=? AND revoked=0 AND (refresh_hash=? OR previous_refresh_hash=? OR id IN
           (SELECT session_id FROM desktop_v3_refresh_history WHERE refresh_hash=? AND origin=?))`,
      )
      .bind(server, presented, presented, presented, server)
      .first();
    if (!targetRow) return genericAuthFailure();
    const dpop = await requireDpop(c, { origin: server, thumbprint: targetRow.device_thumbprint, singleUseNonce: true });

    const res: any[] = await c.env.DB.batch([
      ...dpop.consumeStatements,
      c.env.DB.prepare('UPDATE desktop_v3_sessions SET revoked=1 WHERE id=? AND origin=? AND revoked=0').bind(targetRow.id, server),
    ]);
    if (Number(res[res.length - 1]?.meta?.changes || 0) !== 1) return genericAuthFailure();

    await deps.audit(c, {
      username: targetRow.username,
      role: targetRow.role,
      action: 'auth.logout',
      entity: 'session',
      detail: `desktop_v3_logout sid=${String(targetRow.id).slice(0, 12)}`,
      ip: c.req.header('CF-Connecting-IP') || '',
    });
    return c.json({ success: true, data: { status: 'revoked' } });
  });

  // 7. Authenticated Mailbox Enrollment & Recovery + Session Revocation
  //    (All routes below pass through the global /api/* auth middleware first.)
  async function buildSessionCommitGuard(c: Context<any>) {
    const parsedAuth = parseAuthorizationHeader(c.req.header('Authorization'));
    if (!parsedAuth) return () => ({ sql: '1 = 0', params: [] as unknown[] });
    if (parsedAuth.scheme === 'DPoP' && parsedAuth.token.startsWith('nv3.')) {
      let sid = getRequestAuthContext()?.verifiedNv3?.sessionId || '';
      if (!sid) {
        const accessHash = await desktopHash(parsedAuth.token);
        const row: any = await c.env.DB
          .prepare('SELECT id FROM desktop_v3_sessions WHERE access_hash = ? AND revoked = 0 LIMIT 1')
          .bind(accessHash)
          .first();
        sid = row?.id ? String(row.id) : '';
      }
      if (!sid) return () => ({ sql: '1 = 0', params: [] as unknown[] });
      return () => {
        const now = Date.now();
        return {
          sql: 'EXISTS (SELECT 1 FROM desktop_v3_sessions s WHERE s.id = ? AND s.revoked = 0 AND s.access_expires_at > ? AND s.absolute_expires_at > ?)',
          params: [sid, now, now] as unknown[],
        };
      };
    }
    if (parsedAuth.scheme === 'Bearer' && !parsedAuth.token.startsWith('nv3.') && !parsedAuth.token.startsWith('np1.')) {
      await ensureRevokedWebTokensTable(c.env.DB);
      const tokenHash = await webTokenHash(parsedAuth.token);
      const parsedBearer = parseToken(parsedAuth.token);
      const boundFp =
        parsedBearer?.fingerprint && parsedBearer.fingerprint !== 'none' && parsedBearer.username
          ? parsedBearer.fingerprint
          : '';
      const boundUser = boundFp && parsedBearer?.username ? parsedBearer.username.toLowerCase() : '';
      return () => ({
        sql: boundFp
          ? 'NOT EXISTS (SELECT 1 FROM revoked_web_tokens r WHERE r.token_hash = ?) AND EXISTS (SELECT 1 FROM trusted_devices td WHERE td.fingerprint = ? AND lower(td.username) = ?)'
          : 'NOT EXISTS (SELECT 1 FROM revoked_web_tokens r WHERE r.token_hash = ?)',
        params: (boundFp ? [tokenHash, boundFp, boundUser] : [tokenHash]) as unknown[],
      });
    }
    return () => ({ sql: '1 = 0', params: [] as unknown[] });
  }

  function mailboxService(c: Context<any>, commitGuard: () => { sql: string; params: unknown[] }) {
    return createConfiguredNativeMailbox(
      c.env.DB,
      c.env,
      async (ctx: any) => {
        const verified = await deps.verifySessionPassword(c, String(ctx?.password || ''));
        if (!verified || !verified.userId) return null;
        return { userId: verified.userId, commitGuard };
      },
      deps.mailFetcher,
    );
  }

  app.get(`${NATIVE_V3}/mailbox/status`, async (c) => {
    const sess = await deps.authenticatedSession(c);
    if (!sess) return fail('UNAUTHORIZED', 401);
    const identity = await deps.currentIdentity(c.env, sess.username, sess.role);
    if (!identity || !identity.userId) {
      return c.json({
        success: true,
        data: {
          enrolled: false,
          active: false,
          masked_address: null,
          recovery_pending: false,
          owner_supported: false,
        },
      });
    }
    const row: any = await c.env.DB
      .prepare('SELECT address, active, verified_at FROM desktop_mailbox_verified_v1 WHERE user_id = ?')
      .bind(identity.userId)
      .first()
      .catch(() => null);
    const rec: any = await c.env.DB
      .prepare("SELECT id, expires_at FROM desktop_mailbox_recovery_v1 WHERE user_id = ? AND status='pending_admin_approval' AND expires_at > ?")
      .bind(identity.userId, Date.now())
      .first()
      .catch(() => null);
    return c.json({
      success: true,
      data: {
        enrolled: !!row,
        active: row?.active === 1,
        masked_address: row?.address ? maskEmail(String(row.address)) : null,
        verified_at: row?.verified_at ? new Date(row.verified_at).toISOString() : null,
        recovery_pending: !!rec,
        recovery_request_id: rec?.id || null,
      },
    });
  });

  app.post(`${NATIVE_V3}/mailbox/enroll/start`, async (c) => {
    const sess = await deps.authenticatedSession(c);
    if (!sess) return fail('UNAUTHORIZED', 401);
    if (sess.role === 'owner') return fail('FORBIDDEN', 403);
    const b = await readJsonBody(c, ['password', 'email']);
    if (typeof b.password !== 'string' || typeof b.email !== 'string') return fail('INVALID_REQUEST');
    const commitGuard = await buildSessionCommitGuard(c);
    const svc = mailboxService(c, commitGuard);
    if (!svc) return fail('METHOD_DISABLED', 503);
    const ip = c.req.header('CF-Connecting-IP') || '';
    const started = await svc.start({ password: b.password }, b.email, ip);
    if (!started) fail('ENROLLMENT_REJECTED', 400);
    await deps.audit(c, {
      username: sess.username,
      role: sess.role,
      action: 'auth.mailbox_enroll_start',
      entity: 'mailbox',
      detail: `to=${maskEmail(b.email)}`,
      ip,
    });
    return c.json({ success: true, data: started }, 201);
  });

  app.post(`${NATIVE_V3}/mailbox/enroll/confirm`, async (c) => {
    const sess = await deps.authenticatedSession(c);
    if (!sess) return fail('UNAUTHORIZED', 401);
    if (sess.role === 'owner') return fail('FORBIDDEN', 403);
    const b = await readJsonBody(c, ['password', 'request_id', 'new_code', 'old_code']);
    if (typeof b.password !== 'string' || !pattern(b.request_id, ID) || !pattern(b.new_code, CODE) || (b.old_code !== undefined && !pattern(b.old_code, CODE))) {
      return fail('INVALID_REQUEST');
    }
    const commitGuard = await buildSessionCommitGuard(c);
    const svc = mailboxService(c, commitGuard);
    if (!svc) return fail('METHOD_DISABLED', 503);
    const ip = c.req.header('CF-Connecting-IP') || '';
    const ok = await svc.confirm({ password: b.password }, b.request_id, b.new_code, b.old_code, ip);
    if (!ok) fail('ENROLLMENT_REJECTED', 400);
    await deps.audit(c, {
      username: sess.username,
      role: sess.role,
      action: 'auth.mailbox_enroll_confirm',
      entity: 'mailbox',
      detail: 'verified=true',
      ip,
    });
    return c.json({ success: true, data: { enrolled: true } });
  });

  app.post(`${NATIVE_V3}/mailbox/recovery/request`, async (c) => {
    const sess = await deps.authenticatedSession(c);
    if (!sess) return fail('UNAUTHORIZED', 401);
    // Lost-owner recovery is intentionally disabled here: the configured sole
    // owner has no app_users ID and requires pre-enrolled offline recovery
    // codes + a separate break-glass controller before ever exposing owner recovery.
    if (sess.role === 'owner') return fail('FORBIDDEN', 403);
    const b = await readJsonBody(c, ['password', 'reason']);
    if (typeof b.password !== 'string' || typeof b.reason !== 'string' || b.reason.trim().length < 4 || b.reason.length > 200) {
      return fail('INVALID_REQUEST');
    }
    const ip = c.req.header('CF-Connecting-IP') || '';
    await sharedBudget(c, sess.username, 'password');
    const actor = await deps.verifySessionPassword(c, b.password);
    if (!actor || !actor.userId) return fail('UNAUTHORIZED', 401);
    const commitGuard = await buildSessionCommitGuard(c);
    const guard = commitGuard();

    const id = randHex();
    const now = Date.now();
    const expiresAt = now + RECOVERY_TTL_MS;
    const reqBatch: any[] = await c.env.DB.batch([
      c.env.DB
        .prepare(`UPDATE desktop_mailbox_recovery_v1 SET status='expired' WHERE user_id=? AND status='pending_admin_approval' AND ${guard.sql}`)
        .bind(actor.userId, ...guard.params),
      c.env.DB
        .prepare(
          `INSERT INTO desktop_mailbox_recovery_v1 (id, user_id, username, reason, status, created_at, expires_at)
           SELECT ?, ?, ?, ?, 'pending_admin_approval', ?, ?
           WHERE EXISTS (SELECT 1 FROM app_users WHERE id=? AND active=1) AND ${guard.sql}`,
        )
        .bind(id, actor.userId, actor.username, b.reason.trim(), now, expiresAt, actor.userId, ...guard.params),
    ]);
    if (Number(reqBatch[1]?.meta?.changes || 0) !== 1) return fail('UNAUTHORIZED', 401);

    await deps.audit(c, {
      username: actor.username,
      role: actor.role,
      action: 'auth.mailbox_recovery_request',
      entity: 'mailbox',
      detail: `id=${id.slice(0, 12)}`,
      ip,
    });
    return c.json({ success: true, data: { recovery_id: id, status: 'pending_admin_approval', expires_in: Math.floor(RECOVERY_TTL_MS / 1000) } }, 201);
  });

  app.post(`${NATIVE_V3}/mailbox/recovery/approve`, async (c) => {
    const sess = await deps.authenticatedSession(c);
    if (!sess || (sess.role !== 'owner' && sess.role !== 'admin')) return fail('FORBIDDEN', 403);
    const b = await readJsonBody(c, ['password', 'recovery_id']);
    if (typeof b.password !== 'string' || !pattern(b.recovery_id, ID)) return fail('INVALID_REQUEST');
    const approver = await deps.verifySessionPassword(c, b.password);
    if (!approver || (approver.role !== 'owner' && approver.role !== 'admin')) return fail('FORBIDDEN', 403);

    const now = Date.now();
    const row: any = await c.env.DB
      .prepare("SELECT * FROM desktop_mailbox_recovery_v1 WHERE id=? AND status='pending_admin_approval' AND expires_at>?")
      .bind(b.recovery_id, now)
      .first();
    if (!row) fail('NOT_FOUND', 404);

    const targetUser: any = await c.env.DB
      .prepare('SELECT id, username, role, active FROM app_users WHERE id = ? AND active = 1')
      .bind(row.user_id)
      .first();
    if (!targetUser) fail('NOT_FOUND', 404);

    const approverName = approver.username.toLowerCase();
    const rowName = String(row.username || '').toLowerCase();
    const targetName = String(targetUser.username || '').toLowerCase();
    // Policy: self-approval is unconditionally forbidden for every role.
    if (approverName === rowName || approverName === targetName || (approver.userId !== null && approver.userId === Number(row.user_id))) {
      fail('FORBIDDEN', 403);
    }
    // Policy: privileged (`admin`) mailbox recovery requires independent `owner`
    // approval — peer `admin` approval is forbidden. Non-privileged accounts
    // (`user`, `stock`, `secretaire`) may be approved by an independent `owner` or `admin`.
    const targetRole = String(targetUser.role || '');
    if (!['user', 'stock', 'secretaire', 'admin'].includes(targetRole)) {
      fail('FORBIDDEN', 403);
    }
    if (targetRole === 'admin' && approver.role !== 'owner') {
      fail('FORBIDDEN', 403);
    }

    const commitGuard = await buildSessionCommitGuard(c);
    const guard = commitGuard();

    const approverAuthorityClause =
      approver.userId !== null
        ? `EXISTS (
             SELECT 1 FROM app_users au
             WHERE au.id = ?
               AND au.active = 1
               AND (
                 au.role = 'owner'
                 OR (au.role = 'admin' AND u.role IN ('user', 'stock', 'secretaire'))
               )
           )`
        : `? = 'owner'
           AND NOT EXISTS (
             SELECT 1 FROM app_users au
             WHERE lower(au.username) = ?
               AND (au.active = 0 OR au.role != 'owner')
           )`;
    const approverAuthorityParams =
      approver.userId !== null ? [approver.userId] : [approver.role, approverName];

    // Clear the suspended/lost mailbox + pending enrollment + active pending
    // OTP grants + sessions ONLY if this request approves the recovery row
    // atomically while enforcing non-self, live approver authority, privileged-role,
    // and live-session guards.
    const approvalGate = `EXISTS (SELECT 1 FROM desktop_mailbox_recovery_v1 WHERE id=? AND user_id=? AND status='approved' AND reviewed_by=? AND reviewed_at=?)`;
    const approvedBatch: any[] = await c.env.DB.batch([
      c.env.DB
        .prepare(
          `UPDATE desktop_mailbox_recovery_v1 SET status='approved', reviewed_by=?, reviewed_at=?
           WHERE id=? AND status='pending_admin_approval' AND expires_at>?
             AND lower(username) != ?
             AND EXISTS (
               SELECT 1 FROM app_users u
               WHERE u.id = desktop_mailbox_recovery_v1.user_id
                 AND u.active = 1
                 AND lower(u.username) != ?
                 AND ${approverAuthorityClause}
             )
             AND ${guard.sql}`,
        )
        .bind(approver.username, now, row.id, now, approverName, approverName, ...approverAuthorityParams, ...guard.params),
      c.env.DB
        .prepare(`DELETE FROM desktop_mailbox_verified_v1 WHERE user_id = ? AND ${approvalGate}`)
        .bind(row.user_id, row.id, row.user_id, approver.username, now),
      c.env.DB
        .prepare(`DELETE FROM desktop_mailbox_pending_v1 WHERE user_id = ? AND ${approvalGate}`)
        .bind(row.user_id, row.id, row.user_id, approver.username, now),
      c.env.DB
        .prepare(`UPDATE desktop_v3_sessions SET revoked=1 WHERE user_id = ? AND ${approvalGate}`)
        .bind(row.user_id, row.id, row.user_id, approver.username, now),
      c.env.DB
        .prepare(`UPDATE desktop_v3_logins SET status='cancelled', otp_digest='' WHERE user_id = ? AND status IN ('checking','pending') AND ${approvalGate}`)
        .bind(row.user_id, row.id, row.user_id, approver.username, now),
    ]);
    if (Number(approvedBatch[0]?.meta?.changes || 0) !== 1) fail('FORBIDDEN', 403);

    await deps.audit(c, {
      username: approver.username,
      role: approver.role,
      action: 'auth.mailbox_recovery_approve',
      entity: 'mailbox',
      detail: `target=${row.username} target_role=${targetRole}`,
      ip: c.req.header('CF-Connecting-IP') || '',
    });
    return c.json({ success: true, data: { status: 'approved', username: row.username } });
  });

  app.get(`${NATIVE_V3}/sessions`, async (c) => {
    const sess = await deps.authenticatedSession(c);
    if (!sess) return fail('UNAUTHORIZED', 401);
    const isAdmin = sess.role === 'owner' || sess.role === 'admin';
    const rows = isAdmin
      ? await c.env.DB
          .prepare(
            `SELECT id, origin, username, role, device_thumbprint, device_label, access_expires_at, absolute_expires_at, last_used_at, revoked
             FROM desktop_v3_sessions WHERE revoked = 0 AND absolute_expires_at > ? ORDER BY last_used_at DESC LIMIT 50`,
          )
          .bind(Date.now())
          .all()
      : await c.env.DB
          .prepare(
            `SELECT id, origin, username, role, device_thumbprint, device_label, access_expires_at, absolute_expires_at, last_used_at, revoked
             FROM desktop_v3_sessions WHERE username = ? AND revoked = 0 AND absolute_expires_at > ? ORDER BY last_used_at DESC LIMIT 30`,
          )
          .bind(sess.username.toLowerCase(), Date.now())
          .all();

    return c.json({
      success: true,
      data: (rows.results || []).map((r: any) => ({
        id: r.id,
        origin: r.origin,
        username: r.username,
        role: r.role,
        device_thumbprint: r.device_thumbprint,
        device_label: r.device_label,
        last_used_at: new Date(r.last_used_at).toISOString(),
        expires_at: new Date(r.absolute_expires_at).toISOString(),
      })),
    });
  });

  app.delete(`${NATIVE_V3}/sessions/:id`, async (c) => {
    const sess = await deps.authenticatedSession(c);
    if (!sess) return fail('UNAUTHORIZED', 401);
    const id = c.req.param('id') || '';
    if (!ID.test(id)) fail('INVALID_REQUEST');
    const row: any = await c.env.DB.prepare('SELECT id, username FROM desktop_v3_sessions WHERE id = ?').bind(id).first();
    if (!row) fail('NOT_FOUND', 404);
    const isAdmin = sess.role === 'owner' || sess.role === 'admin';
    if (!isAdmin && String(row.username || '').toLowerCase() !== sess.username.toLowerCase()) {
      fail('FORBIDDEN', 403);
    }
    await c.env.DB.prepare('UPDATE desktop_v3_sessions SET revoked=1 WHERE id = ?').bind(id).run();
    await deps.audit(c, {
      username: sess.username,
      role: sess.role,
      action: 'auth.desktop_v3_session_revoke',
      entity: 'session',
      detail: `sid=${id.slice(0, 12)}`,
      ip: c.req.header('CF-Connecting-IP') || '',
    });
    return c.json({ success: true, data: { status: 'revoked', id } });
  });

  root.route('/', app);
}
