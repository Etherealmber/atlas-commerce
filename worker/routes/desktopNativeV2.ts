import { Hono, type Context } from 'hono';
import { desktopHash } from './desktopAuth';
import { verifyDesktopTurnstile } from '../lib/desktop-native-turnstile';
import { makeNativePilotToken, pilotLoginConfigured } from '../lib/desktop-native-session';
import { reserveCredentialAttempt, type CredentialAttemptPurpose } from '../lib/credential-attempt-limits';
import { reserveDesktopCreate } from '../lib/desktop-create-budget';

export const NATIVE_V2 = '/api/auth/desktop/v2';
const V2_PUBLIC_POSTS = new Set(['requests', 'poll', 'cancel', 'exchange'].map(x => `${NATIVE_V2}/${x}`));
const V2_DISABLED_POSTS = new Set(['password', 'otp', 'passkey'].map(x => `${NATIVE_V2}/${x}`));
const V2_PILOT_POSTS = new Set(['pilot/requests', 'pilot/browser/prepare', 'pilot/browser/decision', 'pilot/poll', 'pilot/consume', 'pilot/cancel', 'pilot/login/password', 'pilot/login/otp', 'pilot/login/cancel', 'pilot/session/refresh', 'pilot/session/logout'].map(x => `${NATIVE_V2}/${x}`));
const V2_PHONE_POSTS = new Set(['phone/prepare', 'phone/decision'].map(x => `${NATIVE_V2}/${x}`));
export const isNativeV2Operation = (p: string) => V2_PUBLIC_POSTS.has(p) || V2_PHONE_POSTS.has(p) || V2_DISABLED_POSTS.has(p) || V2_PILOT_POSTS.has(p);
function unavailableCode(path: string) { return path === `${NATIVE_V2}/passkey` ? 'NATIVE_ASSOCIATION_UNVERIFIED' : 'NATIVE_ABUSE_VERIFIER_UNAVAILABLE'; }
const FP = /^[A-Za-z0-9._:-]{16,128}$/;
const ID = /^[a-f0-9]{64}$/;
const STATE = /^[A-Za-z0-9_-]{43,128}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const TTL = 300_000;
const INTERVAL = 5_000;
const ready = new WeakSet<object>();
type Identity = { username: string; role: string; material: string; userId: number | null };
type Dependencies = {
  phoneIdentity(c: Context<any>, ip: string, fingerprint: string): Promise<Identity | null>;
  currentIdentity(env: any, username: string, role: string): Promise<Identity | null>;
  pilotPassword(env: any, username: string, password: string): Promise<Identity | null>;
  pilotSendOtp(env: any, otp: string): Promise<boolean>;
  mint(username: string, role: string, material: string, ip: string, fingerprint: string): Promise<string>;
};
class Failure extends Error { constructor(public code: string, public status = 400) { super(code); } }
const fail = (code: string, status = 400): never => { throw new Failure(code, status); };
function rand() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, '0')).join(''); }
function same(a: string, b: string) { let n = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) n |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return n === 0; }
const pattern = (value: unknown, re: RegExp): value is string => typeof value === 'string' && re.test(value);
function validLabel(x: unknown): x is string {
  return typeof x === 'string' && x.length >= 1 && x.length <= 60 && [...x].every(ch => {
    const n = ch.charCodeAt(0); return n >= 32 && !(n >= 0x7f && n <= 0x9f) && ch !== '<' && ch !== '>' && n !== 0x061c && !(n >= 0x200e && n <= 0x200f) && !(n >= 0x202a && n <= 0x202e) && !(n >= 0x2066 && n <= 0x206f);
  });
}
async function schema(db: D1Database) {
  if (ready.has(db)) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS desktop_auth_v2 (
    id TEXT PRIMARY KEY, origin TEXT NOT NULL, state_hash TEXT NOT NULL, challenge TEXT NOT NULL,
    desktop_fp TEXT NOT NULL, ip_hash TEXT NOT NULL, label TEXT NOT NULL, expires_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', username TEXT, role TEXT, user_id INTEGER, credential_tag TEXT,
    phone_fp TEXT, actor_hash TEXT, consent_hash TEXT, consent_until INTEGER, consumed_nonce TEXT,
    polls INTEGER NOT NULL DEFAULT 0, last_poll INTEGER NOT NULL DEFAULT 0
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS desktop_auth_limits_v2 (bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL)`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS desktop_auth_v2_expiry ON desktop_auth_v2(expires_at)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS desktop_auth_limits_v2_expiry ON desktop_auth_limits_v2(expires_at)').run();
  // Revocation remains terminal even if the same fingerprint/account is later re-enrolled.
  // These triggers affect only v2 requests; existing device/account workflows are unchanged.
  await db.prepare(`CREATE TRIGGER IF NOT EXISTS desktop_v2_phone_deleted AFTER DELETE ON trusted_devices BEGIN
    UPDATE desktop_auth_v2 SET status='cancelled', credential_tag=NULL, consent_hash=NULL, actor_hash=NULL
    WHERE phone_fp=OLD.fingerprint AND status IN ('pending','approved'); END`).run();
  await db.prepare(`CREATE TRIGGER IF NOT EXISTS desktop_v2_phone_reassigned AFTER UPDATE OF username ON trusted_devices
    WHEN lower(COALESCE(OLD.username,'')) <> lower(COALESCE(NEW.username,'')) BEGIN
    UPDATE desktop_auth_v2 SET status='cancelled', credential_tag=NULL, consent_hash=NULL, actor_hash=NULL
    WHERE phone_fp=OLD.fingerprint AND status IN ('pending','approved'); END`).run();
  await db.prepare(`CREATE TRIGGER IF NOT EXISTS desktop_v2_account_changed AFTER UPDATE OF username, role, password_hash, active ON app_users
    WHEN OLD.username IS NOT NEW.username OR OLD.role IS NOT NEW.role OR OLD.password_hash IS NOT NEW.password_hash OR OLD.active IS NOT NEW.active BEGIN
    UPDATE desktop_auth_v2 SET status='cancelled', credential_tag=NULL, consent_hash=NULL, actor_hash=NULL
    WHERE user_id=OLD.id AND status IN ('pending','approved'); END`).run();
  await db.prepare(`CREATE TRIGGER IF NOT EXISTS desktop_v2_account_deleted AFTER DELETE ON app_users BEGIN
    UPDATE desktop_auth_v2 SET status='cancelled', credential_tag=NULL, consent_hash=NULL, actor_hash=NULL
    WHERE user_id=OLD.id AND status IN ('pending','approved'); END`).run();
  ready.add(db);
}
const pilotReady = new WeakSet<object>();
async function pilotSchema(db: D1Database) {
  if (pilotReady.has(db)) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS desktop_challenge_pilot_v2 (
    id TEXT PRIMARY KEY, origin TEXT NOT NULL, state_hash TEXT NOT NULL, challenge TEXT NOT NULL,
    ip_hash TEXT NOT NULL, label TEXT NOT NULL, cdata TEXT NOT NULL, expires_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', polls INTEGER NOT NULL DEFAULT 0, last_poll INTEGER NOT NULL DEFAULT 0
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS desktop_challenge_pilot_expiry ON desktop_challenge_pilot_v2(expires_at)').run();
  // Separate additive table preserves existing requests and their browser-comparison requirement.
  await db.prepare("CREATE TABLE IF NOT EXISTS desktop_challenge_presentation_v1 (id TEXT PRIMARY KEY, presentation TEXT NOT NULL CHECK(presentation IN ('embedded_webview','system_browser')))").run();
  await db.prepare('CREATE TABLE IF NOT EXISTS desktop_auth_limits_v2 (bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS desktop_auth_limits_v2_expiry ON desktop_auth_limits_v2(expires_at)').run();
  pilotReady.add(db);
}
const loginReady = new WeakSet<object>();
async function pilotLoginSchema(db: D1Database) {
  if (loginReady.has(db)) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS desktop_native_challenge_binding_v1 (id TEXT PRIMARY KEY, browser_ip_hash TEXT NOT NULL)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS desktop_native_login_pilot_v1 (
    id TEXT PRIMARY KEY, username TEXT NOT NULL, role TEXT, user_id INTEGER, credential_tag TEXT,
    otp_digest TEXT NOT NULL, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    delivered INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', nonce TEXT
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS desktop_native_sessions_pilot_v1 (
    id TEXT PRIMARY KEY, origin TEXT NOT NULL, username TEXT NOT NULL, role TEXT NOT NULL, user_id INTEGER NOT NULL,
    credential_tag TEXT NOT NULL, access_hash TEXT NOT NULL UNIQUE, refresh_hash TEXT NOT NULL UNIQUE, previous_refresh_hash TEXT,
    access_expires_at INTEGER NOT NULL, absolute_expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS native_pilot_previous_refresh_idx ON desktop_native_sessions_pilot_v1(previous_refresh_hash)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS native_pilot_session_expiry_idx ON desktop_native_sessions_pilot_v1(absolute_expires_at)').run();
  // Additive history for refresh generations consumed after this upgrade. The
  // existing previous_refresh_hash is preserved on the first new rotation.
  await db.prepare(`CREATE TABLE IF NOT EXISTS desktop_native_refresh_history_v1 (
    refresh_hash TEXT PRIMARY KEY, session_id TEXT NOT NULL, origin TEXT NOT NULL, expires_at INTEGER NOT NULL
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS native_pilot_refresh_history_expiry_idx ON desktop_native_refresh_history_v1(expires_at)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS native_pilot_login_expiry_idx ON desktop_native_login_pilot_v1(expires_at)').run();
  await db.prepare(`CREATE TRIGGER IF NOT EXISTS native_pilot_account_update AFTER UPDATE OF username, role, password_hash, password_salt, active ON app_users
    WHEN OLD.username IS NOT NEW.username OR OLD.role IS NOT NEW.role OR OLD.password_hash IS NOT NEW.password_hash OR OLD.password_salt IS NOT NEW.password_salt OR OLD.active IS NOT NEW.active BEGIN
    UPDATE desktop_native_login_pilot_v1 SET status='cancelled' WHERE (user_id=OLD.id OR username=OLD.username) AND status IN ('checking','pending');
    UPDATE desktop_native_sessions_pilot_v1 SET revoked=1 WHERE user_id=OLD.id; END`).run();
  await db.prepare(`CREATE TRIGGER IF NOT EXISTS native_pilot_account_delete AFTER DELETE ON app_users BEGIN
    UPDATE desktop_native_login_pilot_v1 SET status='cancelled' WHERE (user_id=OLD.id OR username=OLD.username) AND status IN ('checking','pending');
    UPDATE desktop_native_sessions_pilot_v1 SET revoked=1 WHERE user_id=OLD.id; END`).run();
  loginReady.add(db);
}
async function otpMac(key: string, id: string, otp: string) {
  const secret = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const result = await crypto.subtle.sign('HMAC', secret, new TextEncoder().encode(`atlas-native-pilot-otp|${id}|${otp}`));
  return Array.from(new Uint8Array(result), x => x.toString(16).padStart(2, '0')).join('');
}
function randomOtp() {
  // Rejection sampling over u32 eliminates modulo bias.
  const a = new Uint32Array(1); let n: number;
  do { crypto.getRandomValues(a); n = a[0]; } while (n >= 4294000000);
  return String(n % 1000000).padStart(6, '0');
}
async function budget(db: D1Database, category: string, subject: string, window: number, max: number) {
  const now = Date.now(); const end = (Math.floor(now / window) + 1) * window;
  const key = await desktopHash(JSON.stringify([category, subject, Math.floor(now / window)]));
  const reserved = await db.prepare(`INSERT INTO desktop_auth_limits_v2 (bucket, attempts, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1 WHERE attempts < ? RETURNING attempts`).bind(key, end, max).first();
  if (!reserved) throw new Failure('RATE_LIMITED', 429);
}
async function body(c: Context<any>, keys: string[]) {
  if (new URL(c.req.url).search || !/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') || '')) fail('INVALID_REQUEST');
  const reader = c.req.raw.body?.getReader(); if (!reader) return fail('INVALID_REQUEST');
  const chunks: Uint8Array[] = []; let size = 0;
  const deadline = Date.now() + 10_000;
  try {
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Failure('REQUEST_TIMEOUT', 408);
      let timer: ReturnType<typeof setTimeout> | undefined;
      // A stream must be read sequentially; bound the entire body read, not each chunk.
      // eslint-disable-next-line no-await-in-loop
      const part = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Failure('REQUEST_TIMEOUT', 408)), remaining); }),
      ]).finally(() => { if (timer !== undefined) clearTimeout(timer); });
      if (part.done) break;
      size += part.value.length;
      if (size > 8192) throw new Failure('INVALID_REQUEST', 413);
      chunks.push(part.value);
    }
    const all = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.length; }
    const parsed = JSON.parse(new TextDecoder().decode(all));
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' || Object.keys(parsed).some(k => !keys.includes(k))) return fail('INVALID_REQUEST');
    return parsed as Record<string, any>;
  } catch (e) {
    await reader.cancel().catch(() => {});
    if (e instanceof Failure) throw e;
    return fail('INVALID_REQUEST');
  } finally { reader.releaseLock(); }
}
function origin(c: Context<any>, supplied?: unknown) {
  const url = new URL(c.req.url); if (url.protocol !== 'https:') fail('HTTPS_REQUIRED');
  if (url.search || (supplied !== undefined && supplied !== url.origin)) fail('ORIGIN_MISMATCH', 403);
  const hdr = c.req.header('Origin'); if (hdr !== undefined && hdr !== url.origin) fail('ORIGIN_MISMATCH', 403);
  const site = c.req.header('Sec-Fetch-Site'); if (site && site !== 'same-origin' && site !== 'none') fail('ORIGIN_MISMATCH', 403);
  return url.origin;
}
const device = (c: Context<any>) => c.req.header('X-Device-Fingerprint') || '';
async function pairing(row: any) { const h = await desktopHash(JSON.stringify(['desktop-v2-pairing', row.origin, row.id, row.challenge])); return `${h.slice(0, 5).toUpperCase()}-${h.slice(5, 10).toUpperCase()}`; }

async function getRow(c: Context<any>, b: Record<string, any>) {
  const server = origin(c, b.origin); if (typeof b.origin !== 'string' || !pattern(b.request_id, ID)) fail('INVALID_REQUEST');
  const row: any = await c.env.DB.prepare('SELECT * FROM desktop_auth_v2 WHERE id = ?').bind(b.request_id).first();
  if (!row || row.origin !== server) return fail('INVALID_REQUEST', 400);
  if (row.expires_at <= Date.now()) return fail('EXPIRED', 410);
  return row;
}
async function desktop(c: Context<any>, b: Record<string, any>) {
  const row = await getRow(c, b);
  if (!pattern(b.state, STATE) || !pattern(b.code_verifier, VERIFIER) || !same(row.state_hash, await desktopHash(b.state)) ||
    !same(row.challenge, await desktopHash(b.code_verifier)) || !same(row.ip_hash, await desktopHash(c.req.header('CF-Connecting-IP') || '')) || row.desktop_fp !== device(c)) fail('INVALID_PROOF', 401);
  return row;
}
function terminal(row: any) { if (row.status === 'consumed') fail('USED', 409); if (row.status === 'denied') fail('DENIED', 403); if (row.status === 'cancelled') fail('CANCELLED', 409); }

export function registerDesktopNativeV2(root: Hono<any>, deps: Dependencies) {
  const app = new Hono<any>();
  app.onError((error, c) => {
    const known = error instanceof Failure; const code = known ? error.code : 'UNAVAILABLE';
    if (code === 'RATE_LIMITED' || code === 'SLOW_DOWN') c.header('Retry-After', code === 'SLOW_DOWN' ? '5' : '600');
    // No URL, body, credentials, identity or exception logging.
    return c.json({ success: false, code, error: 'Opération de connexion indisponible ou refusée.' }, (known ? error.status : 503) as any);
  });
  app.use(`${NATIVE_V2}/*`, async (c, next) => {
    c.header('Cache-Control', 'no-store'); c.header('CDN-Cache-Control', 'no-store'); c.header('Referrer-Policy', 'no-referrer');
    const pilot = V2_PILOT_POSTS.has(c.req.path);
    if (pilot) {
      if (c.env.ENVIRONMENT !== 'staging' || c.env.DESKTOP_NATIVE_V2_PILOT_CHALLENGE !== 'true') fail('METHOD_DISABLED', 503);
      if (!String(c.env.TURNSTILE_SITE_KEY || '').trim() || !String(c.env.TURNSTILE_SECRET_KEY || '').trim()) fail('UNAVAILABLE', 503);
    } else if (!V2_DISABLED_POSTS.has(c.req.path) && (c.env.DESKTOP_NATIVE_V2_DISCOVERY !== 'true' || c.env.DESKTOP_NATIVE_V2_PHONE_APPROVAL !== 'true')) fail('METHOD_DISABLED', 503);
    origin(c);
    // Do not initialize v2 tables merely because someone probes a disabled
    // method on a server that has not opted into the phone protocol.
    if (V2_DISABLED_POSTS.has(c.req.path) && (c.env.DESKTOP_NATIVE_V2_DISCOVERY !== 'true' || c.env.DESKTOP_NATIVE_V2_PHONE_APPROVAL !== 'true')) {
      return c.json({ success: false, code: unavailableCode(c.req.path), error: 'Méthode native indisponible.' }, 503);
    }
    const ip = c.req.header('CF-Connecting-IP') || '';
    if (!ip || ip.length > 64 || /[^0-9a-fA-F:.]/.test(ip)) fail('UNAVAILABLE', 503);
    if (pilot) await pilotSchema(c.env.DB); else await schema(c.env.DB);
    if (c.req.path.startsWith(`${NATIVE_V2}/pilot/login/`) || c.req.path.startsWith(`${NATIVE_V2}/pilot/session/`)) {
      if (!pilotLoginConfigured(c.env)) fail('METHOD_DISABLED', 503);
      if (origin(c) !== c.env.DESKTOP_NATIVE_V2_PILOT_ORIGIN) fail('ORIGIN_MISMATCH', 403);
      await pilotLoginSchema(c.env.DB);
    }
    const create = c.req.path === `${NATIVE_V2}/requests` || c.req.path === `${NATIVE_V2}/pilot/requests`;
    await budget(c.env.DB, pilot ? (create ? 'pilot-create-ip' : 'pilot-operation-ip') : (create ? 'create-ip' : 'operation-ip'), ip, create ? 300_000 : 60_000, create ? 5 : 90);
    if (create && c.env.ENVIRONMENT === 'staging' && c.env.DESKTOP_NATIVE_V2_PILOT_CHALLENGE === 'true' && !(await reserveDesktopCreate(c.env.DB, ip))) fail('RATE_LIMITED', 429);
    await next();
  });
  // Reserved, deliberately unavailable endpoints: never parse credentials, look
  // up an account, issue a challenge, or consult client claims for an exemption.
  // If phone approval is opted in, its persistent IP budget also applies.
  for (const route of ['password', 'otp', 'passkey'] as const) {
    app.post(`${NATIVE_V2}/${route}`, c => c.json({
      success: false, code: unavailableCode(c.req.path), error: 'Méthode native indisponible.',
    }, 503));
  }
  // Isolated staging challenge ceremony. A verified result never issues a
  // session by itself; the separately gated password+OTP pilot may consume it.
  const pilotBase = `${NATIVE_V2}/pilot`;
  const pilotAction = 'atlas_desktop_v2';
  async function pilotRow(c: Context<any>, b: Record<string, any>) {
    const server = origin(c, b.origin);
    if (typeof b.origin !== 'string' || !pattern(b.request_id, ID)) fail('INVALID_REQUEST');
    const row: any = await c.env.DB.prepare('SELECT * FROM desktop_challenge_pilot_v2 WHERE id=?').bind(b.request_id).first();
    if (!row || row.origin !== server) return fail('INVALID_REQUEST');
    if (row.expires_at <= Date.now()) return fail('EXPIRED', 410);
    return row;
  }
  async function pilotDesktop(c: Context<any>, b: Record<string, any>) {
    const row = await pilotRow(c, b);
    if (!pattern(b.state, STATE) || !pattern(b.code_verifier, VERIFIER) ||
      !same(row.state_hash, await desktopHash(b.state)) || !same(row.challenge, await desktopHash(b.code_verifier)) ||
      !same(row.ip_hash, await desktopHash(c.req.header('CF-Connecting-IP') || ''))) fail('INVALID_PROOF', 401);
    return row;
  }
  function browserOrigin(c: Context<any>) {
    const expected = origin(c);
    if (c.req.header('Origin') !== expected) fail('ORIGIN_MISMATCH', 403);
  }
  async function pilotPair(row: any) {
    const h = await desktopHash(JSON.stringify(['desktop-challenge-pilot', row.origin, row.id, row.challenge]));
    return `${h.slice(0, 5).toUpperCase()}-${h.slice(5, 10).toUpperCase()}`;
  }
  app.post(`${pilotBase}/requests`, async c => {
    const b = await body(c, ['origin', 'state', 'code_challenge', 'code_challenge_method', 'device_label', 'presentation']);
    const server = origin(c, b.origin);
    if (typeof b.origin !== 'string' || !pattern(b.state, STATE) || !pattern(b.code_challenge, CHALLENGE) || b.code_challenge_method !== 'S256' || !validLabel(b.device_label) || (b.presentation !== undefined && b.presentation !== 'embedded_webview' && b.presentation !== 'system_browser')) fail('INVALID_REQUEST');
    const presentation = b.presentation || 'system_browser';
    if (presentation === 'embedded_webview' && (!pilotLoginConfigured(c.env) || server !== c.env.DESKTOP_NATIVE_V2_PILOT_ORIGIN)) fail('METHOD_DISABLED', 503);
    const id = rand(); const cdata = rand(); const expires = Date.now() + TTL;
    const challengeInsert = c.env.DB.prepare(`INSERT INTO desktop_challenge_pilot_v2 (id, origin, state_hash, challenge, ip_hash, label, cdata, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, server, await desktopHash(b.state), b.code_challenge, await desktopHash(c.req.header('CF-Connecting-IP')!), b.device_label, cdata, expires);
    await c.env.DB.batch([challengeInsert, c.env.DB.prepare('INSERT INTO desktop_challenge_presentation_v1 (id,presentation) VALUES (?,?)').bind(id, presentation)]);
    if (pilotLoginConfigured(c.env) && server === c.env.DESKTOP_NATIVE_V2_PILOT_ORIGIN) {
      await pilotLoginSchema(c.env.DB);
      const cutoff = Date.now() - 3_600_000;
      await c.env.DB.prepare('DELETE FROM desktop_native_challenge_binding_v1 WHERE id IN (SELECT b.id FROM desktop_native_challenge_binding_v1 b LEFT JOIN desktop_challenge_pilot_v2 c ON c.id=b.id WHERE c.id IS NULL OR c.expires_at < ? LIMIT 100)').bind(cutoff).run();
      await c.env.DB.prepare('DELETE FROM desktop_native_login_pilot_v1 WHERE id IN (SELECT id FROM desktop_native_login_pilot_v1 WHERE expires_at < ? LIMIT 100)').bind(cutoff).run();
      await c.env.DB.prepare('DELETE FROM desktop_native_sessions_pilot_v1 WHERE id IN (SELECT id FROM desktop_native_sessions_pilot_v1 WHERE absolute_expires_at < ? LIMIT 100)').bind(cutoff).run();
      await c.env.DB.prepare('DELETE FROM desktop_native_refresh_history_v1 WHERE refresh_hash IN (SELECT refresh_hash FROM desktop_native_refresh_history_v1 WHERE expires_at < ? LIMIT 100)').bind(cutoff).run();
    }
    await c.env.DB.prepare('DELETE FROM desktop_challenge_pilot_v2 WHERE id IN (SELECT id FROM desktop_challenge_pilot_v2 WHERE expires_at < ? LIMIT 100)').bind(Date.now() - 3_600_000).run();
    await c.env.DB.prepare('DELETE FROM desktop_challenge_presentation_v1 WHERE id IN (SELECT p.id FROM desktop_challenge_presentation_v1 p LEFT JOIN desktop_challenge_pilot_v2 c ON c.id=p.id WHERE c.id IS NULL LIMIT 100)').run();
    await c.env.DB.prepare('DELETE FROM desktop_auth_limits_v2 WHERE bucket IN (SELECT bucket FROM desktop_auth_limits_v2 WHERE expires_at < ? LIMIT 100)').bind(Date.now()).run();
    return c.json({ success: true, data: { version: 2, request_id: id, origin: server, pairing_code: await pilotPair({ id, origin: server, challenge: b.code_challenge }), expires_in: 300, interval: 5 } }, 201);
  });
  async function pilotPresentation(c: Context<any>, id: string): Promise<'system_browser' | 'embedded_webview'> {
    const mode: any = await c.env.DB.prepare('SELECT presentation FROM desktop_challenge_presentation_v1 WHERE id=?').bind(id).first();
    // Requests created before this table existed retain the original comparison ceremony.
    return mode?.presentation === 'embedded_webview' ? 'embedded_webview' : 'system_browser';
  }
  app.post(`${pilotBase}/browser/prepare`, async c => {
    browserOrigin(c);
    const b = await body(c, ['origin', 'request_id']); const row = await pilotRow(c, b);
    if (row.status !== 'pending') fail('USED', 409);
    return c.json({ success: true, data: { request_id: row.id, origin: row.origin, device_label: row.label, pairing_code: await pilotPair(row), presentation: await pilotPresentation(c, row.id), site_key: String(c.env.TURNSTILE_SITE_KEY).trim(), action: pilotAction, cdata: row.cdata, expires_at: new Date(row.expires_at).toISOString() } });
  });
  app.post(`${pilotBase}/browser/decision`, async c => {
    browserOrigin(c);
    const b = await body(c, ['origin', 'request_id', 'decision', 'compare_confirmed', 'turnstile_token']); const row = await pilotRow(c, b);
    if (b.decision !== 'approve' && b.decision !== 'deny') fail('INVALID_REQUEST');
    const presentation = await pilotPresentation(c, row.id);
    if (presentation === 'embedded_webview' && (!pilotLoginConfigured(c.env) || row.origin !== c.env.DESKTOP_NATIVE_V2_PILOT_ORIGIN)) fail('METHOD_DISABLED', 503);
    if (b.decision === 'approve' && ((presentation === 'system_browser' && b.compare_confirmed !== true) || typeof b.turnstile_token !== 'string' || !b.turnstile_token || b.turnstile_token.length > 2048)) fail('INVALID_REQUEST');
    if (b.decision === 'deny') {
      const changed = await c.env.DB.prepare("UPDATE desktop_challenge_pilot_v2 SET status='denied' WHERE id=? AND status='pending' AND expires_at>? RETURNING id").bind(row.id, Date.now()).first();
      if (!changed) fail('USED', 409);
      return c.json({ success: true, data: { status: 'denied' } });
    }
    // Claim before outbound Siteverify: no parallel validation can race the same transaction.
    const claimed = await c.env.DB.prepare("UPDATE desktop_challenge_pilot_v2 SET status='verifying' WHERE id=? AND status='pending' AND expires_at>? RETURNING id").bind(row.id, Date.now()).first();
    if (!claimed) fail('USED', 409);
    if (pilotLoginConfigured(c.env) && row.origin === c.env.DESKTOP_NATIVE_V2_PILOT_ORIGIN && !same(row.ip_hash, await desktopHash(c.req.header('CF-Connecting-IP') || ''))) {
      await c.env.DB.prepare("UPDATE desktop_challenge_pilot_v2 SET status='failed' WHERE id=? AND status='verifying'").bind(row.id).run();
      fail('CHALLENGE_FAILED', 403);
    }
    const ok = await verifyDesktopTurnstile({ token: b.turnstile_token, secret: String(c.env.TURNSTILE_SECRET_KEY).trim(), hostname: new URL(row.origin).hostname, action: pilotAction, cdata: row.cdata });
    if (ok && pilotLoginConfigured(c.env) && row.origin === c.env.DESKTOP_NATIVE_V2_PILOT_ORIGIN) {
      await pilotLoginSchema(c.env.DB);
      await c.env.DB.prepare('INSERT OR IGNORE INTO desktop_native_challenge_binding_v1 (id,browser_ip_hash) VALUES (?,?)').bind(row.id, await desktopHash(c.req.header('CF-Connecting-IP') || '')).run();
    }
    const finished = await c.env.DB.prepare("UPDATE desktop_challenge_pilot_v2 SET status=? WHERE id=? AND status='verifying' AND expires_at>? RETURNING id")
      .bind(ok ? 'verified' : 'failed', row.id, Date.now()).first();
    if (!finished) fail('UNAVAILABLE', 503);
    if (!ok) fail('CHALLENGE_FAILED', 403);
    return c.json({ success: true, data: { status: 'verified' } });
  });
  const pilotProofFields = ['origin', 'request_id', 'state', 'code_verifier'];
  app.post(`${pilotBase}/poll`, async c => {
    const b = await body(c, pilotProofFields); const row = await pilotDesktop(c, b);
    const now = Date.now();
    const changed: any = await c.env.DB.prepare("UPDATE desktop_challenge_pilot_v2 SET polls=polls+1,last_poll=? WHERE id=? AND polls<60 AND last_poll<=? AND expires_at>? RETURNING status")
      .bind(now, row.id, now - INTERVAL, now).first();
    if (!changed) fail('SLOW_DOWN', 429);
    return c.json({ success: true, data: { status: changed.status, request_id: row.id, origin: row.origin, interval: 5 } });
  });
  app.post(`${pilotBase}/cancel`, async c => {
    const b = await body(c, pilotProofFields); const row = await pilotDesktop(c, b);
    const changed = await c.env.DB.prepare("UPDATE desktop_challenge_pilot_v2 SET status='cancelled' WHERE id=? AND status IN ('pending','verifying','verified') AND expires_at>? RETURNING id").bind(row.id, Date.now()).first();
    if (!changed) fail('USED', 409);
    return c.json({ success: true, data: { status: 'cancelled' } });
  });
  app.post(`${pilotBase}/consume`, async c => {
    const b = await body(c, pilotProofFields); const row = await pilotDesktop(c, b);
    const changed = await c.env.DB.prepare("UPDATE desktop_challenge_pilot_v2 SET status='consumed' WHERE id=? AND status='verified' AND expires_at>? RETURNING id").bind(row.id, Date.now()).first();
    if (!changed) fail('NOT_APPROVED', 409);
    // Deliberately produces NO login grant or session.
    return c.json({ success: true, data: { status: 'consumed' } });
  });
  // Experimental credential flow. Both the challenge and the separate login
  // flag are required; only a named test account and isolated mailbox are usable.
  const loginBase = `${pilotBase}/login`;
  const proofFields = ['origin', 'request_id', 'state', 'code_verifier'];
  const genericAuthFailure = () => fail('AUTH_FAILED', 401);
  async function sharedCredentialBudget(c: Context<any>, username: string, purpose: CredentialAttemptPurpose) {
    // The website already uses these durable counters. Sharing them prevents
    // attempts split across the two channels from evading account/IP budgets.
    // Do not include account existence, OTP values or client fingerprints.
    const result = await reserveCredentialAttempt(c.env.DB, c.req.header('CF-Connecting-IP') || '', username, purpose);
    if (!result.allowed) fail('RATE_LIMITED', 429);
  }
  async function loginRow(c: Context<any>, id: string) {
    const row: any = await c.env.DB.prepare('SELECT * FROM desktop_native_login_pilot_v1 WHERE id=?').bind(id).first();
    if (!row || row.expires_at <= Date.now()) return genericAuthFailure();
    return row;
  }
  app.post(`${loginBase}/password`, async c => {
    const b = await body(c, [...proofFields, 'username', 'password']);
    const request = await pilotDesktop(c, b);
    const username = typeof b.username === 'string' ? b.username.trim().toLowerCase() : '';
    if (!/^[a-z0-9._-]{1,64}$/.test(username) || typeof b.password !== 'string' || b.password.length < 1 || b.password.length > 512) fail('INVALID_REQUEST');
    const ip = c.req.header('CF-Connecting-IP')!;
    await budget(c.env.DB, 'pilot-password-account', username, 600_000, 20);
    await budget(c.env.DB, 'pilot-password-pair', JSON.stringify([username, ip]), 600_000, 5);
    const binding: any = await c.env.DB.prepare('SELECT browser_ip_hash FROM desktop_native_challenge_binding_v1 WHERE id=?').bind(request.id).first();
    if (!binding || !same(binding.browser_ip_hash, request.ip_hash) || request.status !== 'verified') fail('NOT_APPROVED', 409);
    // Do not let an unverified challenge consume the website's shared budget.
    await sharedCredentialBudget(c, username, 'password');
    // A D1 batch makes reservation and consumption a single transaction. The
    // unique row and status condition prevent concurrent reuse of the challenge.
    const reserved: any[] = await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO desktop_native_login_pilot_v1 (id,username,otp_digest,expires_at,status)
        SELECT id, ?, '', expires_at, 'checking' FROM desktop_challenge_pilot_v2
        WHERE id=? AND status='verified' AND expires_at>?`).bind(username, request.id, Date.now()),
      c.env.DB.prepare("UPDATE desktop_challenge_pilot_v2 SET status='consumed' WHERE id=? AND status='verified' AND expires_at>?").bind(request.id, Date.now()),
    ]);
    if (Number(reserved[0]?.meta?.changes || 0) !== 1 || Number(reserved[1]?.meta?.changes || 0) !== 1) fail('NOT_APPROVED', 409);
    const identity = await deps.pilotPassword(c.env, username, b.password);
    const otp = randomOtp(); const digest = await otpMac(c.env.DESKTOP_NATIVE_V2_PILOT_OTP_KEY, request.id, otp);
    let changed: any;
    if (identity && identity.userId !== null) {
      const tag = await desktopHash(identity.material);
      changed = await c.env.DB.prepare(`UPDATE desktop_native_login_pilot_v1 SET role=?,user_id=?,credential_tag=?,otp_digest=?,status='pending'
        WHERE id=? AND status='checking' AND expires_at>? AND EXISTS (SELECT 1 FROM app_users WHERE id=? AND username=? AND role=? AND password_hash=? AND active=1) RETURNING id`)
        .bind(identity.role, identity.userId, tag, digest, request.id, Date.now(), identity.userId, username, identity.role, identity.material).first();
    } else {
      changed = await c.env.DB.prepare("UPDATE desktop_native_login_pilot_v1 SET otp_digest=?,status='pending' WHERE id=? AND status='checking' AND expires_at>? RETURNING id")
        .bind(digest, request.id, Date.now()).first();
    }
    if (!changed) fail('UNAVAILABLE', 503);
    if (identity) {
      // No mail or OTP in logs. Delivery is never exposed in the HTTP envelope.
      const task = (async () => {
        try {
          if (await deps.pilotSendOtp(c.env, otp)) await c.env.DB.prepare("UPDATE desktop_native_login_pilot_v1 SET delivered=1 WHERE id=? AND status='pending' AND expires_at>?").bind(request.id, Date.now()).run();
        } catch { /* remain unusable */ }
      })();
      try { c.executionCtx.waitUntil(task); } catch { void task; }
    }
    return c.json({ success: true, data: { status: 'otp_pending' } });
  });
  app.post(`${loginBase}/cancel`, async c => {
    const b = await body(c, proofFields); const request = await pilotDesktop(c, b);
    const changed = await c.env.DB.prepare("UPDATE desktop_native_login_pilot_v1 SET status='cancelled',otp_digest='' WHERE id=? AND status IN ('checking','pending') AND expires_at>? RETURNING id").bind(request.id, Date.now()).first();
    if (!changed) fail('USED', 409);
    return c.json({ success: true, data: { status: 'cancelled' } });
  });
  app.post(`${loginBase}/otp`, async c => {
    const b = await body(c, [...proofFields, 'otp']); const request = await pilotDesktop(c, b);
    if (!pattern(b.otp, /^[0-9]{6}$/)) return genericAuthFailure();
    const login = await loginRow(c, request.id);
    const ip = c.req.header('CF-Connecting-IP')!;
    await sharedCredentialBudget(c, login.username, 'otp');
    await budget(c.env.DB, 'pilot-otp-account', login.username, 600_000, 20);
    await budget(c.env.DB, 'pilot-otp-pair', JSON.stringify([login.username, ip]), 600_000, 5);
    const attempted: any = await c.env.DB.prepare("UPDATE desktop_native_login_pilot_v1 SET attempts=attempts+1 WHERE id=? AND status='pending' AND attempts<5 AND expires_at>? RETURNING *").bind(request.id, Date.now()).first();
    if (!attempted) return genericAuthFailure();
    const digest = await otpMac(c.env.DESKTOP_NATIVE_V2_PILOT_OTP_KEY, request.id, b.otp);
    if (!same(digest, attempted.otp_digest) || attempted.delivered !== 1 || !attempted.role || !attempted.user_id) return genericAuthFailure();
    const identity = await deps.currentIdentity(c.env, attempted.username, attempted.role);
    if (!identity || identity.userId !== attempted.user_id || !same(await desktopHash(identity.material), attempted.credential_tag)) return genericAuthFailure();
    const now = Date.now(); const sid = rand(); const nonce = rand();
    const access = makeNativePilotToken(identity.username, identity.role, rand()); const refresh = rand();
    const accessExpiry = now + 900_000; const absolute = now + 43_200_000;
    const committed: any[] = await c.env.DB.batch([
      c.env.DB.prepare("UPDATE desktop_native_login_pilot_v1 SET status='completed',nonce=?,otp_digest='' WHERE id=? AND status='pending' AND delivered=1 AND otp_digest=? AND attempts<=5 AND expires_at>?").bind(nonce, request.id, digest, now),
      c.env.DB.prepare(`INSERT INTO desktop_native_sessions_pilot_v1 (id,origin,username,role,user_id,credential_tag,access_hash,refresh_hash,access_expires_at,absolute_expires_at)
        SELECT ?,?,?,?,?,?,?,?,?,? FROM desktop_native_login_pilot_v1 WHERE id=? AND status='completed' AND nonce=?`)
        .bind(sid, request.origin, identity.username, identity.role, identity.userId, attempted.credential_tag, await desktopHash(access), await desktopHash(refresh), accessExpiry, absolute, request.id, nonce),
    ]);
    if (Number(committed[0]?.meta?.changes || 0) !== 1 || Number(committed[1]?.meta?.changes || 0) !== 1) return genericAuthFailure();
    return c.json({ success: true, data: { token_type: 'Bearer', access_token: access, refresh_token: refresh, access_expires_at: new Date(accessExpiry).toISOString(), session_expires_at: new Date(absolute).toISOString(), origin: request.origin, username: identity.username, role: identity.role } });
  });
  app.post(`${pilotBase}/session/refresh`, async c => {
    const b = await body(c, ['origin', 'refresh_token']); origin(c, b.origin);
    if (b.origin !== c.env.DESKTOP_NATIVE_V2_PILOT_ORIGIN || !pattern(b.refresh_token, ID)) return genericAuthFailure();
    const old = await desktopHash(b.refresh_token);
    const row: any = await c.env.DB.prepare('SELECT * FROM desktop_native_sessions_pilot_v1 WHERE refresh_hash=?').bind(old).first();
    if (!row) {
      // Include legacy immediately-previous hashes as well as retained history.
      await c.env.DB.prepare(`UPDATE desktop_native_sessions_pilot_v1 SET revoked=1
        WHERE origin=? AND revoked=0 AND (previous_refresh_hash=? OR id IN
          (SELECT session_id FROM desktop_native_refresh_history_v1 WHERE refresh_hash=? AND origin=?))`)
        .bind(b.origin, old, old, b.origin).run();
      return genericAuthFailure();
    }
    if (row.revoked !== 0 || row.origin !== b.origin || row.username !== c.env.DESKTOP_NATIVE_V2_PILOT_USERNAME || row.absolute_expires_at <= Date.now()) return genericAuthFailure();
    const id = await deps.currentIdentity(c.env, row.username, row.role);
    if (!id || id.userId !== row.user_id || !same(await desktopHash(id.material), row.credential_tag)) return genericAuthFailure();
    // Bound history growth and churn independently of source-IP rotation. Slots
    // are never refunded; normal 15-minute access renewal is below this budget.
    await budget(c.env.DB, 'pilot-refresh-family', row.id, 600_000, 8);
    const access = makeNativePilotToken(row.username, row.role, rand()); const refresh = rand();
    const now = Date.now(); const expiry = Math.min(now + 900_000, row.absolute_expires_at);
    // History and rotation commit in one D1 transaction. A losing concurrent
    // refresh records nothing, then revokes the winning family below.
    const result: any[] = await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO desktop_native_refresh_history_v1 (refresh_hash,session_id,origin,expires_at)
        SELECT refresh_hash,id,origin,absolute_expires_at FROM desktop_native_sessions_pilot_v1
        WHERE id=? AND origin=? AND refresh_hash=? AND revoked=0 AND absolute_expires_at>?`)
        .bind(row.id, b.origin, old, now),
      c.env.DB.prepare(`INSERT OR IGNORE INTO desktop_native_refresh_history_v1 (refresh_hash,session_id,origin,expires_at)
        SELECT previous_refresh_hash,id,origin,absolute_expires_at FROM desktop_native_sessions_pilot_v1
        WHERE id=? AND origin=? AND refresh_hash=? AND previous_refresh_hash IS NOT NULL AND revoked=0 AND absolute_expires_at>?`)
        .bind(row.id, b.origin, old, now),
      c.env.DB.prepare(`UPDATE desktop_native_sessions_pilot_v1 SET access_hash=?, refresh_hash=?, previous_refresh_hash=?, access_expires_at=?
        WHERE id=? AND origin=? AND refresh_hash=? AND revoked=0 AND absolute_expires_at>?`)
        .bind(await desktopHash(access), await desktopHash(refresh), old, expiry, row.id, b.origin, old, now),
    ]);
    if (Number(result[0]?.meta?.changes || 0) !== 1 || Number(result[2]?.meta?.changes || 0) !== 1) {
      await c.env.DB.prepare(`UPDATE desktop_native_sessions_pilot_v1 SET revoked=1 WHERE id=? AND origin=? AND revoked=0 AND
        (previous_refresh_hash=? OR id IN (SELECT session_id FROM desktop_native_refresh_history_v1 WHERE refresh_hash=? AND origin=?))`)
        .bind(row.id, b.origin, old, old, b.origin).run();
      return genericAuthFailure();
    }
    return c.json({ success: true, data: { token_type: 'Bearer', access_token: access, refresh_token: refresh, access_expires_at: new Date(expiry).toISOString(), session_expires_at: new Date(row.absolute_expires_at).toISOString(), origin: row.origin, username: row.username, role: row.role } });
  });
  app.post(`${pilotBase}/session/logout`, async c => {
    const b = await body(c, ['origin', 'refresh_token']); origin(c, b.origin);
    if (b.origin !== c.env.DESKTOP_NATIVE_V2_PILOT_ORIGIN || !pattern(b.refresh_token, ID)) return genericAuthFailure();
    const presented = await desktopHash(b.refresh_token);
    // A client that lost a successful refresh response still knows the old
    // token. Permit it to revoke the family, never to obtain new tokens.
    const changed = await c.env.DB.prepare(`UPDATE desktop_native_sessions_pilot_v1 SET revoked=1
      WHERE origin=? AND revoked=0 AND (refresh_hash=? OR previous_refresh_hash=? OR id IN
        (SELECT session_id FROM desktop_native_refresh_history_v1 WHERE refresh_hash=? AND origin=?)) RETURNING id`)
      .bind(b.origin, presented, presented, presented, b.origin).first();
    if (!changed) return genericAuthFailure();
    return c.json({ success: true, data: { status: 'revoked' } });
  });
  app.post(`${NATIVE_V2}/requests`, async c => {
    const b = await body(c, ['origin', 'state', 'code_challenge', 'code_challenge_method', 'device_label']);
    const server = origin(c, b.origin); const fp = device(c); const ip = c.req.header('CF-Connecting-IP')!;
    if (typeof b.origin !== 'string' || !pattern(b.state, STATE) || !pattern(b.code_challenge, CHALLENGE) || b.code_challenge_method !== 'S256' || !FP.test(fp) || !validLabel(b.device_label)) fail('INVALID_REQUEST');
    const id = rand(); const exp = Date.now() + TTL;
    const row = { id, origin: server, challenge: b.code_challenge };
    await c.env.DB.prepare(`INSERT INTO desktop_auth_v2 (id, origin, state_hash, challenge, desktop_fp, ip_hash, label, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, server, await desktopHash(b.state), b.code_challenge, fp, await desktopHash(ip), b.device_label, exp).run();
    await c.env.DB.prepare('DELETE FROM desktop_auth_v2 WHERE id IN (SELECT id FROM desktop_auth_v2 WHERE expires_at < ? LIMIT 100)').bind(Date.now() - 3_600_000).run();
    await c.env.DB.prepare('DELETE FROM desktop_auth_limits_v2 WHERE bucket IN (SELECT bucket FROM desktop_auth_limits_v2 WHERE expires_at < ? LIMIT 100)').bind(Date.now()).run();
    return c.json({ success: true, data: { version: 2, request_id: id, origin: server, pairing_code: await pairing(row), expires_in: TTL / 1000, interval: INTERVAL / 1000 } }, 201);
  });
  async function phone(c: Context<any>, b: Record<string, any>) {
    const fp = device(c); if (!FP.test(fp)) return fail('UNAUTHORIZED', 401);
    const id = await deps.phoneIdentity(c, c.req.header('CF-Connecting-IP')!, fp); if (!id) return fail('UNAUTHORIZED', 401);
    await budget(c.env.DB, 'phone-account', id.username, 300_000, 30);
    const row = await getRow(c, b); terminal(row); if (row.status !== 'pending') fail('USED', 409);
    if (row.desktop_fp === fp) fail('INVALID_REQUEST');
    const actor = await desktopHash(JSON.stringify([c.req.header('Authorization'), fp, id.username, id.role, id.userId]));
    return { row, id, actor, fp };
  }
  app.post(`${NATIVE_V2}/phone/prepare`, async c => {
    const b = await body(c, ['origin', 'request_id']); const { row, id, actor, fp } = await phone(c, b);
    const nonce = rand(); const until = Math.min(row.expires_at, Date.now() + 120_000);
    const changed = await c.env.DB.prepare(`UPDATE desktop_auth_v2 SET username=?, role=?, user_id=?, credential_tag=?, phone_fp=?, actor_hash=?, consent_hash=?, consent_until=?
      WHERE id=? AND status='pending' AND expires_at>? RETURNING id`).bind(id.username, id.role, id.userId, await desktopHash(id.material), fp, actor, await desktopHash(nonce), until, row.id, Date.now()).first();
    if (!changed) fail('USED', 409);
    return c.json({ success: true, data: { request_id: row.id, origin: row.origin, username: id.username, device_label: row.label, pairing_code: await pairing(row), consent_nonce: nonce, expires_at: new Date(row.expires_at).toISOString(), consent_expires_at: new Date(until).toISOString() } });
  });
  app.post(`${NATIVE_V2}/phone/decision`, async c => {
    const b = await body(c, ['origin', 'request_id', 'consent_nonce', 'decision', 'compare_confirmed']); const { row, id, actor, fp } = await phone(c, b);
    if (!pattern(b.consent_nonce, ID) || (b.decision !== 'approve' && b.decision !== 'deny') || (b.decision === 'approve' && b.compare_confirmed !== true)) fail('INVALID_REQUEST');
    if (row.username !== id.username || row.role !== id.role || row.user_id !== id.userId || row.phone_fp !== fp || !same(row.credential_tag || '', await desktopHash(id.material)) || !same(row.actor_hash || '', actor) || !same(row.consent_hash || '', await desktopHash(b.consent_nonce)) || row.consent_until <= Date.now()) fail('INVALID_PROOF', 401);
    const status = b.decision === 'approve' ? 'approved' : 'denied';
    const changed = await c.env.DB.prepare(`UPDATE desktop_auth_v2 SET status=?, consent_hash=NULL, actor_hash=NULL WHERE id=? AND status='pending' AND consent_hash=? AND actor_hash=? AND consent_until>? AND expires_at>? RETURNING id`)
      .bind(status, row.id, row.consent_hash, actor, Date.now(), Date.now()).first();
    if (!changed) fail('USED', 409); return c.json({ success: true, data: { status } });
  });
  const fields = ['origin', 'request_id', 'state', 'code_verifier'];
  app.post(`${NATIVE_V2}/poll`, async c => {
    const b = await body(c, fields); const row = await desktop(c, b); terminal(row); const now = Date.now();
    const changed: any = await c.env.DB.prepare(`UPDATE desktop_auth_v2 SET polls=polls+1,last_poll=? WHERE id=? AND polls<60 AND last_poll<=? AND expires_at>? AND status IN ('pending','approved') RETURNING status`)
      .bind(now, row.id, now - INTERVAL, now).first();
    if (!changed) fail('SLOW_DOWN', 429);
    return c.json({ success: true, data: { status: changed.status, request_id: row.id, origin: row.origin, interval: 5 } });
  });
  app.post(`${NATIVE_V2}/cancel`, async c => {
    const b = await body(c, fields); const row = await desktop(c, b); terminal(row);
    const changed = await c.env.DB.prepare(`UPDATE desktop_auth_v2 SET status='cancelled', consent_hash=NULL, actor_hash=NULL, credential_tag=NULL WHERE id=? AND status IN ('pending','approved') AND expires_at>? RETURNING id`).bind(row.id, Date.now()).first();
    if (!changed) fail('USED', 409); return c.json({ success: true, data: { status: 'cancelled' } });
  });
  app.post(`${NATIVE_V2}/exchange`, async c => {
    const b = await body(c, fields); const row = await desktop(c, b); terminal(row); if (row.status !== 'approved') fail('NOT_APPROVED', 409);
    const id = await deps.currentIdentity(c.env, row.username, row.role);
    if (!id || id.userId !== row.user_id || !same(row.credential_tag || '', await desktopHash(id.material))) return fail('ACCOUNT_CHANGED', 409);
    const ip = c.req.header('CF-Connecting-IP')!; const nonce = rand();
    const token = await deps.mint(id.username, id.role, id.material, ip, row.desktop_fp);
    // D1 batch is atomic: claim, check account and non-revoked phone on the primary,
    // then insert only for this claim. Never return a token unless both succeeded.
    const claim = c.env.DB.prepare(`UPDATE desktop_auth_v2 SET status='consumed', consumed_nonce=?, consent_hash=NULL, actor_hash=NULL, credential_tag=NULL
      WHERE id=? AND status='approved' AND expires_at>? AND phone_fp=? AND username=? AND role=? AND credential_tag=?
      AND EXISTS (SELECT 1 FROM trusted_devices WHERE fingerprint=? AND lower(username)=lower(?))
      AND (?=1 OR EXISTS (SELECT 1 FROM app_users WHERE id=? AND username=? AND role=? AND active=1 AND password_hash=?))
      AND NOT EXISTS (SELECT 1 FROM trusted_devices WHERE fingerprint=? AND lower(COALESCE(username,''))<>lower(?))`)
      .bind(nonce, row.id, Date.now(), row.phone_fp, id.username, id.role, row.credential_tag, row.phone_fp, id.username, id.userId === null ? 1 : 0, id.userId, id.username, id.role, id.material, row.desktop_fp, id.username);
    const desktopUa = String(c.req.header('User-Agent') || 'Atlas Desktop v2').slice(0, 200);
    const trust = c.env.DB.prepare(`INSERT INTO trusted_devices (fingerprint,last_ip,last_seen,username,user_agent)
      SELECT ?,?,datetime('now'),?,? FROM desktop_auth_v2 WHERE id=? AND status='consumed' AND consumed_nonce=?
      ON CONFLICT(fingerprint) DO UPDATE SET last_ip=excluded.last_ip,last_seen=excluded.last_seen,user_agent=excluded.user_agent
      WHERE lower(trusted_devices.username)=lower(excluded.username)`)
      .bind(row.desktop_fp, ip, id.username, desktopUa, row.id, nonce);
    const result = await c.env.DB.batch([claim, trust]);
    if (Number(result[0]?.meta?.changes) !== 1 || Number(result[1]?.meta?.changes) !== 1) fail('ACCOUNT_CHANGED', 409);
    return c.json({ success: true, data: { token, token_type: 'Bearer', username: id.username, role: id.role, request_id: row.id, origin: row.origin } });
  });
  root.route('/', app);
}
