import { Hono, type Context } from 'hono';
import { desktopHash } from './desktopAuth';

export const NATIVE_V2 = '/api/auth/desktop/v2';
export const V2_PUBLIC_POSTS = new Set(['requests', 'poll', 'cancel', 'exchange'].map(x => `${NATIVE_V2}/${x}`));
export const V2_PHONE_POSTS = new Set(['phone/prepare', 'phone/decision'].map(x => `${NATIVE_V2}/${x}`));
export const isNativeV2Operation = (p: string) => V2_PUBLIC_POSTS.has(p) || V2_PHONE_POSTS.has(p);
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
    if (code === 'RATE_LIMITED' || code === 'SLOW_DOWN') c.header('Retry-After', code === 'SLOW_DOWN' ? '5' : '300');
    // No URL, body, credentials, identity or exception logging.
    return c.json({ success: false, code, error: 'Opération de connexion indisponible ou refusée.' }, (known ? error.status : 503) as any);
  });
  app.use(`${NATIVE_V2}/*`, async (c, next) => {
    c.header('Cache-Control', 'no-store'); c.header('CDN-Cache-Control', 'no-store'); c.header('Referrer-Policy', 'no-referrer');
    if (c.env.DESKTOP_NATIVE_V2_DISCOVERY !== 'true' || c.env.DESKTOP_NATIVE_V2_PHONE_APPROVAL !== 'true') fail('METHOD_DISABLED', 503);
    origin(c);
    const ip = c.req.header('CF-Connecting-IP') || '';
    if (!ip || ip.length > 64 || /[^0-9a-fA-F:.]/.test(ip)) fail('UNAVAILABLE', 503);
    await schema(c.env.DB);
    const create = c.req.path === `${NATIVE_V2}/requests`;
    await budget(c.env.DB, create ? 'create-ip' : 'operation-ip', ip, create ? 300_000 : 60_000, create ? 5 : 90);
    await next();
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
    const trust = c.env.DB.prepare(`INSERT INTO trusted_devices (fingerprint,last_ip,last_seen,username,user_agent)
      SELECT ?,?,datetime('now'),?,? FROM desktop_auth_v2 WHERE id=? AND status='consumed' AND consumed_nonce=?
      ON CONFLICT(fingerprint) DO UPDATE SET last_ip=excluded.last_ip,last_seen=excluded.last_seen,user_agent=excluded.user_agent
      WHERE lower(trusted_devices.username)=lower(excluded.username)`)
      .bind(row.desktop_fp, ip, id.username, 'Atlas Desktop v2', row.id, nonce);
    const result = await c.env.DB.batch([claim, trust]);
    if (Number(result[0]?.meta?.changes) !== 1 || Number(result[1]?.meta?.changes) !== 1) fail('ACCOUNT_CHANGED', 409);
    return c.json({ success: true, data: { token, token_type: 'Bearer', username: id.username, role: id.role, request_id: row.id, origin: row.origin } });
  });
  root.route('/', app);
}
