import { Hono, type Context } from 'hono';

export const DESKTOP_AUTH = '/api/auth/desktop/v1';
export const DESKTOP_TTL = 300;
export const DESKTOP_POLL_SECONDS = 5;
const PUBLIC_PATHS = new Set(['capabilities', 'requests', 'poll', 'exchange', 'cancel'].map(p => `${DESKTOP_AUTH}/${p}`));
const ALL_PATHS = new Set([...PUBLIC_PATHS, `${DESKTOP_AUTH}/prepare`, `${DESKTOP_AUTH}/authorize`]);
/** Only the named desktop routes have their own persistent attempt budgets. */
export const isDesktopAuthPath = (path: string) => ALL_PATHS.has(path);
/** Browser consent endpoints deliberately remain behind the normal auth gate. */
export const isPublicDesktopAuthPath = (path: string) => PUBLIC_PATHS.has(path);

export async function desktopHash(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function random(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
}
/** Compare fixed-length digests without an early exit on differing characters. */
function equal(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
function matches(value: unknown, pattern: RegExp): value is string {
  return typeof value === 'string' && pattern.test(value);
}
const FP = /^[A-Za-z0-9._:-]{16,128}$/;
const STATE = /^[A-Za-z0-9_-]{43,128}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const ID = /^[a-f0-9]{64}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
/** Unverified device names are display text, without control/bidi markup. */
function validLabel(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 60 && [...value].every(char => {
    const n = char.charCodeAt(0);
    return n >= 32 && !(n >= 0x7f && n <= 0x9f) && char !== '<' && char !== '>' && n !== 0x061c && !(n >= 0x200e && n <= 0x200f) && !(n >= 0x202a && n <= 0x202e) && !(n >= 0x2066 && n <= 0x206f);
  });
}
const ready = new WeakSet<object>();

/** D1 compare-and-set transitions, never isolate memory, are the authority. */
async function schema(db: D1Database): Promise<void> {
  if (ready.has(db)) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS desktop_auth_v1 (
    id TEXT PRIMARY KEY, origin TEXT NOT NULL, state_hash TEXT NOT NULL, challenge TEXT NOT NULL,
    fingerprint TEXT NOT NULL, ip_hash TEXT NOT NULL, device_label TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', expires_at INTEGER NOT NULL,
    username TEXT, role TEXT, credential_tag TEXT, consent_hash TEXT, actor_hash TEXT,
    approver_fingerprint TEXT, consent_until INTEGER, polls INTEGER NOT NULL DEFAULT 0, last_poll INTEGER NOT NULL DEFAULT 0
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS desktop_auth_limits_v1 (
    bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_desktop_auth_v1_expires ON desktop_auth_v1(expires_at)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_desktop_auth_limits_v1_expires ON desktop_auth_limits_v1(expires_at)').run();
  ready.add(db);
}

type Identity = { username: string; role: string };
type Dependencies = {
  ip: (c: Context<any>) => string;
  authenticate: (c: Context<any>) => Promise<Identity | null>;
  /** Current active account + exact role only; null for disabled/changed accounts. */
  material: (env: any, username: string, role: string) => Promise<string | null>;
  mint: (username: string, role: string, material: string, ip: string, fingerprint: string) => Promise<string>;
  trust: (env: any, fingerprint: string, ip: string, username: string, ua: string) => Promise<void>;
  audit: (c: Context<any>, identity: Identity, event: 'approve' | 'deny' | 'exchange') => Promise<void>;
};
class Rejection extends Error {
  constructor(public code: string, public status: number) { super(code); }
}
function reject(code: string, status = 400): never { throw new Rejection(code, status); }
const ERRORS: Record<string, string> = {
  INVALID_REQUEST: 'Demande invalide.', ORIGIN_MISMATCH: 'Le serveur sélectionné ne correspond pas.',
  HTTPS_REQUIRED: 'Une origine HTTPS est obligatoire.', UNAUTHORIZED: 'Connectez-vous dans le navigateur.',
  INVALID_PROOF: 'Preuve, état ou appareil incorrect.', NOT_FOUND: 'Demande introuvable.',
  EXPIRED: 'Demande expirée : recommencez sur le desktop.', USED: 'Demande déjà utilisée.',
  DENIED: 'Autorisation refusée.', CANCELLED: 'Demande annulée.', NOT_APPROVED: 'Autorisation en attente.',
  CSRF_INVALID: 'Confirmation invalide : rechargez cet écran.', ACCOUNT_CHANGED: 'Compte modifié : recommencez la connexion.',
  RATE_LIMITED: 'Trop de tentatives.', SLOW_DOWN: 'Attendez avant de vérifier à nouveau.',
  UNAVAILABLE: 'Connexion desktop temporairement indisponible.',
};

/** Bounded JSON body; no query bearer, callback URL or unknown field accepted. */
async function json(c: Context<any>, allowed: string[]): Promise<Record<string, any>> {
  if (new URL(c.req.url).search || !/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') || '')) reject('INVALID_REQUEST');
  const reader = c.req.raw.body?.getReader();
  if (!reader) reject('INVALID_REQUEST');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); reject('INVALID_REQUEST', 413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).some(k => !allowed.includes(k))) reject('INVALID_REQUEST');
    return body;
  } catch (e) {
    if (e instanceof Rejection) throw e;
    return reject('INVALID_REQUEST');
  } finally { reader.releaseLock(); }
}

/** Validate the selected origin against the actual request URL, never Host overrides. */
function originOf(c: Context<any>, supplied?: unknown, browser = false): string {
  const origin = new URL(c.req.url).origin;
  if (new URL(origin).protocol !== 'https:') reject('HTTPS_REQUIRED');
  if (supplied !== undefined && supplied !== origin) reject('ORIGIN_MISMATCH');
  const header = c.req.header('Origin');
  if ((browser && header !== origin) || (header !== undefined && header !== origin)) reject('ORIGIN_MISMATCH', 403);
  const site = c.req.header('Sec-Fetch-Site');
  if (site && site !== 'same-origin' && site !== 'none') reject('ORIGIN_MISMATCH', 403);
  return origin;
}

export function registerDesktopAuthRoutes(root: Hono<any>, deps: Dependencies): void {
  const app = new Hono<any>();
  // A sub-router error handler is essential: Hono catches route errors inside
  // next(), before an outer middleware catch can see them.
  app.onError((e, c) => {
    const known = e instanceof Rejection;
    const code = known ? e.code : 'UNAVAILABLE';
    console.warn('[desktop-auth]', { code });
    return c.json({ success: false, code, error: ERRORS[code] }, (known ? e.status : 503) as any);
  });
  app.use(`${DESKTOP_AUTH}/*`, async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('CDN-Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    try {
      originOf(c);
      if (!deps.ip(c) || deps.ip(c) === 'unknown') reject('INVALID_REQUEST');
      await schema(c.env.DB);
      // A persistent, atomic budget also bounds malformed/proof/CSRF attempts.
      const now = Date.now();
      const create = c.req.path === `${DESKTOP_AUTH}/requests`;
      const window = create ? 300_000 : 60_000;
      const bucket = await desktopHash(`${create ? 'create' : 'operation'}|${deps.ip(c)}|${Math.floor(now / window)}`);
      const rate: any = await c.env.DB.prepare(`INSERT INTO desktop_auth_limits_v1 (bucket, attempts, expires_at) VALUES (?, 1, ?)
        ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1 RETURNING attempts`).bind(bucket, now + window).first();
      if (Number(rate?.attempts) > (create ? 5 : 90)) {
        c.header('Retry-After', String(Math.ceil(window / 1000)));
        reject('RATE_LIMITED', 429);
      }
      await next();
    } catch (e) {
      const known = e instanceof Rejection;
      const code = known ? e.code : 'UNAVAILABLE';
      // Never log URL, headers, request body, response body, identity or exception.
      console.warn('[desktop-auth]', { code });
      return c.json({ success: false, code, error: ERRORS[code] }, (known ? e.status : 503) as any);
    }
  });

  app.get(`${DESKTOP_AUTH}/capabilities`, c => c.json({ success: true, data: {
    version: 1, flow: 'system_browser_pkce_polling', code_challenge_method: 'S256',
    expires_in: DESKTOP_TTL, interval: DESKTOP_POLL_SECONDS, max_polls: 60, callbacks: false,
  } }));

  app.post(`${DESKTOP_AUTH}/requests`, async c => {
    const body = await json(c, ['origin', 'state', 'code_challenge', 'code_challenge_method', 'device_label']);
    const origin = originOf(c, body.origin);
    const fingerprint = c.req.header('X-Device-Fingerprint') || '';
    if (typeof body.origin !== 'string' || !FP.test(fingerprint) || !matches(body.state, STATE) ||
      !matches(body.code_challenge, CHALLENGE) || body.code_challenge_method !== 'S256' ||
      (body.device_label !== undefined && !validLabel(body.device_label))) reject('INVALID_REQUEST');
    const id = random();
    const stateHash = await desktopHash(body.state);
    const expires = Date.now() + DESKTOP_TTL * 1000;
    const label = body.device_label || 'Atlas Desktop';
    await c.env.DB.prepare(`INSERT INTO desktop_auth_v1 (id, origin, state_hash, challenge, fingerprint, ip_hash, device_label, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, origin, stateHash, body.code_challenge, fingerprint, await desktopHash(deps.ip(c)), label, expires).run();
    await c.env.DB.prepare('DELETE FROM desktop_auth_v1 WHERE expires_at < ?').bind(Date.now() - 3_600_000).run();
    await c.env.DB.prepare('DELETE FROM desktop_auth_limits_v1 WHERE expires_at < ?').bind(Date.now()).run();
    const pairing = (await desktopHash(`${id}|${stateHash}`)).slice(0, 8).toUpperCase();
    return c.json({ success: true, data: {
      version: 1, request_id: id, origin, state: body.state,
      authorization_url: `${origin}/login/desktop#request_id=${id}&state=${body.state}`,
      pairing_code: `${pairing.slice(0, 4)}-${pairing.slice(4)}`,
      expires_at: new Date(expires).toISOString(), expires_in: DESKTOP_TTL, interval: DESKTOP_POLL_SECONDS,
    } }, 201);
  });

  /** Every operation identifies one immutable request + origin + random state. */
  async function request(c: Context<any>, body: Record<string, any>): Promise<any> {
    const origin = originOf(c, body.origin);
    if (typeof body.origin !== 'string' || !matches(body.request_id, ID) || !matches(body.state, STATE)) reject('INVALID_REQUEST');
    const row: any = await c.env.DB.prepare('SELECT * FROM desktop_auth_v1 WHERE id = ?').bind(body.request_id).first();
    if (!row) reject('NOT_FOUND', 404);
    if (row.origin !== origin || !equal(row.state_hash, await desktopHash(body.state))) reject('INVALID_PROOF', 401);
    if (row.expires_at <= Date.now()) reject('EXPIRED', 410);
    return row;
  }
  /** Proof, creation IP and desktop fingerprint are all required, even for polling. */
  async function desktop(c: Context<any>, body: Record<string, any>): Promise<any> {
    const row = await request(c, body);
    if (!matches(body.code_verifier, VERIFIER) || !equal(row.challenge, await desktopHash(body.code_verifier)) ||
      row.fingerprint !== c.req.header('X-Device-Fingerprint') || !equal(row.ip_hash, await desktopHash(deps.ip(c)))) reject('INVALID_PROOF', 401);
    return row;
  }
  function terminal(row: any): void {
    if (row.status === 'consumed') reject('USED', 409);
    if (row.status === 'denied') reject('DENIED', 403);
    if (row.status === 'cancelled') reject('CANCELLED', 409);
  }
  /** Revalidate the browser session normally; no native-header/FP-only bypass. */
  async function browser(c: Context<any>, body: Record<string, any>): Promise<{ row: any; identity: Identity; actor: string }> {
    originOf(c, body.origin, true);
    if (!FP.test(c.req.header('X-Device-Fingerprint') || '')) reject('INVALID_REQUEST');
    const identity = await deps.authenticate(c);
    if (!identity?.username) reject('UNAUTHORIZED', 401);
    const row = await request(c, body);
    terminal(row);
    if (row.status !== 'pending') reject('USED', 409);
    const actor = await desktopHash(`${c.req.header('Authorization')}|${c.req.header('X-Device-Fingerprint')}|${identity.username}|${identity.role}`);
    return { row, identity, actor };
  }
  const common = ['request_id', 'origin', 'state'];
  const desktopFields = [...common, 'code_verifier'];

  app.post(`${DESKTOP_AUTH}/prepare`, async c => {
    const body = await json(c, common);
    const { row, identity, actor } = await browser(c, body);
    const material = await deps.material(c.env, identity.username, identity.role);
    if (!material) reject('ACCOUNT_CHANGED', 409);
    const nonce = random();
    const until = Math.min(row.expires_at, Date.now() + 120_000);
    const changed: any = await c.env.DB.prepare(`UPDATE desktop_auth_v1 SET username = ?, role = ?, credential_tag = ?, consent_hash = ?, actor_hash = ?, consent_until = ?, approver_fingerprint = ?
      WHERE id = ? AND status = 'pending' AND expires_at > ? RETURNING id`)
      .bind(identity.username, identity.role, await desktopHash(material), await desktopHash(nonce), actor, until, c.req.header('X-Device-Fingerprint'), row.id, Date.now()).first();
    if (!changed) reject('USED', 409);
    const pairing = (await desktopHash(`${row.id}|${row.state_hash}`)).slice(0, 8).toUpperCase();
    return c.json({ success: true, data: {
      request_id: row.id, origin: row.origin, username: identity.username, device_label: row.device_label,
      pairing_code: `${pairing.slice(0, 4)}-${pairing.slice(4)}`, csrf_token: nonce,
      expires_at: new Date(row.expires_at).toISOString(), consent_expires_at: new Date(until).toISOString(),
    } });
  });

  app.post(`${DESKTOP_AUTH}/authorize`, async c => {
    const body = await json(c, [...common, 'csrf_token', 'decision']);
    const { row, identity, actor } = await browser(c, body);
    if (!matches(body.csrf_token, ID) || !equal(row.consent_hash || '', await desktopHash(body.csrf_token)) ||
      !equal(row.actor_hash || '', actor) || row.username !== identity.username || row.role !== identity.role || row.consent_until <= Date.now()) reject('CSRF_INVALID', 403);
    if (body.decision !== 'approve' && body.decision !== 'deny') reject('INVALID_REQUEST');
    const material = await deps.material(c.env, identity.username, identity.role);
    if (!material || !equal(row.credential_tag, await desktopHash(material))) reject('ACCOUNT_CHANGED', 409);
    const status = body.decision === 'approve' ? 'approved' : 'denied';
    const changed: any = await c.env.DB.prepare(`UPDATE desktop_auth_v1 SET status = ?, consent_hash = NULL, actor_hash = NULL, credential_tag = ?
      WHERE id = ? AND status = 'pending' AND consent_hash = ? AND actor_hash = ? AND consent_until > ? AND expires_at > ? RETURNING id`)
      .bind(status, status === 'approved' ? row.credential_tag : null, row.id, row.consent_hash, actor, Date.now(), Date.now()).first();
    if (!changed) reject('USED', 409);
    await deps.audit(c, identity, body.decision);
    return c.json({ success: true, data: { status } });
  });

  app.post(`${DESKTOP_AUTH}/poll`, async c => {
    const body = await json(c, desktopFields);
    const row = await desktop(c, body);
    if (row.status === 'consumed') reject('USED', 409);
    if (row.polls >= 60) reject('RATE_LIMITED', 429);
    const now = Date.now();
    const changed: any = await c.env.DB.prepare(`UPDATE desktop_auth_v1 SET polls = polls + 1, last_poll = ?
      WHERE id = ? AND polls < 60 AND last_poll <= ? AND expires_at > ? AND status != 'consumed' RETURNING status`)
      .bind(now, row.id, now - DESKTOP_POLL_SECONDS * 1000, now).first();
    if (!changed) { c.header('Retry-After', String(DESKTOP_POLL_SECONDS)); reject('SLOW_DOWN', 429); }
    return c.json({ success: true, data: { status: changed.status, request_id: row.id, origin: row.origin, state: body.state, interval: DESKTOP_POLL_SECONDS } });
  });

  app.post(`${DESKTOP_AUTH}/cancel`, async c => {
    const body = await json(c, desktopFields);
    const row = await desktop(c, body);
    if (row.status === 'consumed') reject('USED', 409);
    const changed: any = await c.env.DB.prepare(`UPDATE desktop_auth_v1 SET status = 'cancelled', consent_hash = NULL, actor_hash = NULL, credential_tag = NULL
      WHERE id = ? AND status IN ('pending', 'approved', 'cancelled') AND expires_at > ? RETURNING id`).bind(row.id, Date.now()).first();
    if (!changed) reject('DENIED', 403);
    return c.json({ success: true, data: { status: 'cancelled' } });
  });

  app.post(`${DESKTOP_AUTH}/exchange`, async c => {
    const body = await json(c, desktopFields);
    const row = await desktop(c, body);
    terminal(row);
    if (row.status !== 'approved') reject('NOT_APPROVED', 409);
    const material = await deps.material(c.env, row.username, row.role);
    if (!material || !equal(row.credential_tag, await desktopHash(material))) reject('ACCOUNT_CHANGED', 409);
    const approver: any = await c.env.DB.prepare('SELECT username FROM trusted_devices WHERE fingerprint = ?').bind(row.approver_fingerprint).first();
    if (!approver || String(approver.username).toLowerCase() !== row.username.toLowerCase()) reject('ACCOUNT_CHANGED', 409);
    // Mint privately, then claim exactly once. No session leaves before CAS + trust.
    const token = await deps.mint(row.username, row.role, material, deps.ip(c), row.fingerprint);
    const consumed: any = await c.env.DB.prepare(`UPDATE desktop_auth_v1 SET status = 'consumed', consent_hash = NULL, actor_hash = NULL, credential_tag = NULL
      WHERE id = ? AND status = 'approved' AND expires_at > ?
        AND EXISTS (SELECT 1 FROM trusted_devices WHERE fingerprint = ? AND lower(username) = lower(?)) RETURNING id`)
      .bind(row.id, Date.now(), row.approver_fingerprint, row.username).first();
    if (!consumed) reject('USED', 409);
    await deps.trust(c.env, row.fingerprint, deps.ip(c), row.username, String(c.req.header('User-Agent') || '').slice(0, 240));
    await deps.audit(c, { username: row.username, role: row.role }, 'exchange');
    return c.json({ success: true, data: { token, token_type: 'Bearer', username: row.username, role: row.role, request_id: row.id, origin: row.origin, state: body.state } });
  });
  root.route('/', app);
}
