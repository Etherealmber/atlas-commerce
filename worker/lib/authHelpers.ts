import type { Env } from '../env';
import { schemaOnce, addColumnIfMissing } from './schema';
import { normalizeIp } from './security';
import { normalizeRole } from './rbac';
import { reserveCredentialAttempt, type CredentialAttemptPurpose } from './credential-attempt-limits';
import { parseNativePilotToken, validateNativePilotToken } from './desktop-native-session';
import { sha256Hex } from './ledgerHelpers';

export function cfGeo(c: any): { city: string; country: string } {
  const cf = (c?.req?.raw as any)?.cf || {};
  return { city: String(cf.city || ''), country: String(cf.country || '') };
}

export const _touchDeviceCache = new WeakMap<object, Map<string, number>>();
export const TOUCH_DEVICE_THROTTLE_MS = 180_000;

export async function touchTrustedDevice(
  db: D1Database,
  username: string,
  fingerprint: string,
  ip: string,
  userAgent: string,
  geo?: { city?: string; country?: string } | null,
): Promise<void> {
  const fp = String(fingerprint || '').trim();
  const uname = String(username || '').trim().toLowerCase();
  if (!fp || fp === 'none' || !uname) return;
  const cacheKey = `${fp}|${uname}|${String(ip || '')}`;
  let perDb = _touchDeviceCache.get(db as unknown as object);
  const now = Date.now();
  const last = perDb?.get(cacheKey);
  if (last && now - last < TOUCH_DEVICE_THROTTLE_MS) return;
  await ensureSecurityTables(db);
  await db
    .prepare(
      `INSERT INTO trusted_devices (fingerprint, username, user_agent, last_ip, last_seen, city, country)
       VALUES (?, ?, ?, ?, datetime('now'), ?, ?)
       ON CONFLICT(fingerprint) DO UPDATE SET
         username = excluded.username,
         user_agent = excluded.user_agent,
         last_ip = excluded.last_ip,
         last_seen = datetime('now'),
         city = COALESCE(NULLIF(excluded.city, ''), city),
         country = COALESCE(NULLIF(excluded.country, ''), country)`,
    )
    .bind(
      fp.slice(0, 128),
      uname,
      String(userAgent || '').slice(0, 200),
      String(ip || '').slice(0, 64),
      String(geo?.city || '').slice(0, 80),
      String(geo?.country || '').slice(0, 80),
    )
    .run();
  if (!perDb) {
    perDb = new Map<string, number>();
    _touchDeviceCache.set(db as unknown as object, perDb);
  }
  perDb.set(cacheKey, now);
  if (perDb.size > 300) {
    const first = perDb.keys().next().value;
    if (first) perDb.delete(first);
  }
}

/* ─── Auth ─── */

export function getPassword(env: Env): string | null {
  // Support common secret names (Cloudflare dashboard typos / legacy)
  const candidates = [
    env.ADMIN_PASSWORD,
    (env as any).PASSWORD,
    (env as any).ADMIN_PASS,
    (env as any).ADMIN_PASSWORD_SECRET,
  ];
  for (const c of candidates) {
    if (c == null) continue;
    // Strip wrapping quotes that sometimes get stored with secrets
    let raw = String(c).trim();
    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      raw = raw.slice(1, -1).trim();
    }
    // Strip BOM / zero-width chars from secret managers
    raw = raw.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D]/g, '');
    if (raw.length > 0) return raw;
  }
  return null;
}

/** Normalize password for comparison (trim + Unicode NFC + strip invisible chars). */
export function normalizePassword(p: string): string {
  try {
    return String(p || '')
      .replace(/^\uFEFF/, '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim()
      .normalize('NFC');
  } catch {
    return String(p || '').trim();
  }
}

export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function passwordsMatch(input: string, expected: string): boolean {
  const a = normalizePassword(input);
  const b = normalizePassword(expected);
  if (a.length === 0 || b.length === 0) return false;
  if (a === b) return true;
  // Also try NFD (some mobile keyboards)
  try {
    if (a.normalize('NFD') === b.normalize('NFD')) return true;
  } catch { /* ignore */ }
  return false;
}

/** Random base64url challenge for WebAuthn */
export function randomChallenge(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function getOwnerUsername(env: Env): string {
  const u = (env.ADMIN_USERNAME ?? 'admin').toString().trim().toLowerCase();
  return u.length > 0 ? u : 'admin';
}


/** PBKDF2-SHA-256 cost for interactive logins on Workers.
 * Cloudflare Web Crypto rejects iteration counts above 100_000.
 * Format: pbkdf2$<iterations>$<hex> — verify uses the stored iteration count.
 */
export const PBKDF2_ITERATIONS = 100_000;
export const PBKDF2_ITERATIONS_MAX = 100_000;

export async function derivePbkdf2Bits(password: string, salt: string, iterations: number): Promise<string> {
  const iters = Math.min(Math.max(1, iterations | 0), PBKDF2_ITERATIONS_MAX);
  const normalized = normalizePassword(password);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(normalized),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(`pc-salt:${salt}`),
      iterations: iters,
    },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Strong password hash: PBKDF2-SHA-256 with per-user salt.
 * Stored as `pbkdf2$100000$<hex>` so we can evolve iterations later.
 * Legacy single-pass SHA-256 (`pc:salt:pw`) still verifies for existing rows.
 */
export async function hashUserPassword(password: string, salt: string): Promise<string> {
  const hex = await derivePbkdf2Bits(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${hex}`;
}

/** Legacy one-shot SHA-256 used before PBKDF2 migration. */
export async function hashUserPasswordLegacy(password: string, salt: string): Promise<string> {
  return sha256Hex(`pc:${salt}:${normalizePassword(password)}`);
}

export function isModernPasswordHash(stored: string): boolean {
  return String(stored || '').startsWith('pbkdf2$');
}

export function isLegacyPasswordHash(stored: string): boolean {
  return /^[a-f0-9]{64}$/i.test(String(stored || ''));
}

/**
 * Verify password against stored material.
 * Supports: PBKDF2 (current), legacy single-pass SHA-256, and accidental plaintext
 * (plaintext is accepted once so we can re-hash on next successful login — never leave it).
 */
export async function verifyUserPassword(password: string, salt: string, storedHash: string): Promise<boolean> {
  const stored = String(storedHash || '');
  if (!stored) return false;
  if (isModernPasswordHash(stored)) {
    // pbkdf2$<iterations>$<hex> — use stored iterations (capped at platform max)
    const parts = stored.split('$');
    const storedIters = parseInt(parts[1] || '', 10);
    const storedHex = (parts[2] || '').toLowerCase();
    if (!storedHex || !Number.isFinite(storedIters) || storedIters < 1) return false;
    // Platform max 100k: hashes created with 120k cannot be re-derived here.
    // Try capped derive; if stored was exactly <= 100k, compare hex.
    if (storedIters <= PBKDF2_ITERATIONS_MAX) {
      const hex = await derivePbkdf2Bits(password, salt, storedIters);
      return hex.toLowerCase() === storedHex;
    }
    // Pre-1.3.2 hashes used 120000 — re-derive at 100k cannot match.
    // Fall through: allow one successful login via legacy paths only if any;
    // otherwise force password reset path is safer. Attempt 100k as last resort
    // only when admin reset the hash. Return false so login fails cleanly
    // rather than throwing "iteration counts above 100000".
    return false;
  }
  if (isLegacyPasswordHash(stored)) {
    const legacy = await hashUserPasswordLegacy(password, salt);
    return legacy === stored;
  }
  // Accidental plaintext in password_hash — match then caller must upgrade
  return passwordsMatch(password, stored);
}

/** Re-hash to PBKDF2 after a successful login (upgrades legacy / plaintext rows). */
export async function upgradeUserPasswordHash(db: D1Database, userId: number, password: string): Promise<string> {
  const salt = randomChallenge().slice(0, 16);
  const password_hash = await hashUserPassword(password, salt);
  await db.prepare(
    `UPDATE app_users SET password_hash = ?, password_salt = ? WHERE id = ?`
  ).bind(password_hash, salt, userId).run();
  return password_hash;
}


/** secretaire = bureau: devis, clients, factures, rapports — pas admin serveur ni suppression masse */
export function roleAtLeast(role: string, min: 'user' | 'secretaire' | 'admin' | 'owner'): boolean {
  const order = { user: 1, secretaire: 2, admin: 3, owner: 4 };
  return (order[normalizeRole(role) as keyof typeof order] || 0) >= order[min];
}

export async function writeAudit(
  db: D1Database,
  opts: { username?: string; role?: string; action: string; entity?: string; entity_id?: string | number; detail?: string; ip?: string }
) {
  try {
    await ensureSecurityTables(db);
    await db.prepare(
      `INSERT INTO audit_log (username, role, action, entity, entity_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      opts.username || null,
      opts.role || null,
      opts.action,
      opts.entity || null,
      opts.entity_id != null ? String(opts.entity_id) : null,
      opts.detail || null,
      opts.ip || null
    ).run();
  } catch { /* never break business flow */ }
}

export async function makeSessionProof(username: string, role: string, secretMaterial: string, ip: string, fp: string): Promise<string> {
  return sha256Hex(`proof|${username}|${role}|${secretMaterial}|${ip}|${fp}`);
}

export async function getConfig(db: D1Database, key: string, fallback = ''): Promise<string> {
  const row = await db.prepare(`SELECT value FROM app_config WHERE key = ?`).bind(key).first() as any;
  return row?.value != null ? String(row.value) : fallback;
}

export async function setConfig(db: D1Database, key: string, value: string) {
  await db.prepare(
    `INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')`
  ).bind(key, value, value).run();
}


export function clientIp(c: any): string {
  const raw = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || c.req.header('X-Real-IP') || 'unknown';
  return normalizeIp(raw);
}

/** Session token v2: username + role + proof (no raw password). Legacy v1 still parsed. */
export async function makeTokenV2(
  username: string,
  role: string,
  secretMaterial: string,
  ip: string,
  fingerprint: string,
): Promise<string> {
  const fp = (fingerprint || 'none').slice(0, 128);
  const user = username.toLowerCase();
  const proof = await makeSessionProof(user, role, secretMaterial, ip, fp);
  return btoa(unescape(encodeURIComponent(`stock-auth-v2|${user}|${role}|${ip}|${fp}|${proof}`)));
}

/** @deprecated legacy single-admin token — still accepted for old sessions briefly */
export function makeToken(password: string, ip: string, fingerprint: string): string {
  const fp = (fingerprint || 'none').slice(0, 128);
  return btoa(unescape(encodeURIComponent(`stock-auth|${password}|${ip}|${fp}`)));
}

export function parseToken(token: string): {
  version: 1 | 2;
  password?: string;
  username?: string;
  role?: string;
  ip: string;
  fingerprint: string;
  proof?: string;
} | null {
  const candidates = [
    token,
    token.replace(/ /g, '+'),
    (() => { try { return decodeURIComponent(token); } catch { return token; } })(),
  ];
  for (const tok of candidates) {
    try {
      const raw = decodeURIComponent(escape(atob(tok)));
      const parts = raw.split('|');
      if (parts[0] === 'stock-auth-v2' && parts.length >= 6) {
        return {
          version: 2,
          username: parts[1],
          role: parts[2],
          ip: parts[3],
          fingerprint: parts[4] || 'none',
          proof: parts[5],
        };
      }
      if (parts[0] === 'stock-auth' && parts.length >= 3) {
        return { version: 1, password: parts[1], ip: parts[2], fingerprint: parts[3] || 'none' };
      }
    } catch {
      continue;
    }
  }
  return null;
}

export async function ensureSecurityTables(db: D1Database) {
  await schemaOnce('security_tables', async () => {

  await db.prepare(`CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    username TEXT,
    role TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    detail TEXT,
    ip TEXT
  )`).run();
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_audit_log_id_desc ON audit_log(id DESC)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_audit_log_username ON audit_log(username)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)`).run();
  } catch { /* index already exists or D1 limitation */ }

  await db.prepare(`CREATE TABLE IF NOT EXISTS login_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL, fingerprint TEXT DEFAULT '', success INTEGER DEFAULT 0, reputation_delta INTEGER DEFAULT 0, user_agent TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS ip_reputation (ip TEXT PRIMARY KEY, score INTEGER NOT NULL DEFAULT 50, failed_count INTEGER DEFAULT 0, success_count INTEGER DEFAULT 0, blocked_until TEXT, updated_at TEXT DEFAULT (datetime('now')))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS otp_codes (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), UNIQUE(resource_type, resource_id))`).run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS qr_login_sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    role TEXT NOT NULL,
    created_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    claim_fingerprint TEXT DEFAULT '',
    claim_ua TEXT DEFAULT '',
    claim_ip TEXT DEFAULT '',
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_qr_login_status ON qr_login_sessions(status, expires_at)`).run();
  // Devices that completed password+OTP once — subsequent logins only need password (or WebAuthn)
  await db.prepare(`CREATE TABLE IF NOT EXISTS trusted_devices (
    fingerprint TEXT PRIMARY KEY,
    label TEXT DEFAULT '',
    last_ip TEXT DEFAULT '',
    last_seen TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    biometric_credential_id TEXT DEFAULT ''
  )`).run();
  await addColumnIfMissing(db, 'trusted_devices', 'biometric_credential_id', "TEXT DEFAULT ''");

  // Multiple WebAuthn credentials per device (platform biometric + hardware security keys)
  await db.prepare(`CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    device_type TEXT DEFAULT 'platform',
    transports TEXT DEFAULT '',
    label TEXT DEFAULT '',
    username TEXT DEFAULT '',
    role TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    last_used TEXT
  )`).run();
  await addColumnIfMissing(db, 'webauthn_credentials', 'username', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'webauthn_credentials', 'role', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'webauthn_credentials', 'device_info', "TEXT DEFAULT ''");
  // v259 — verified credential material (the pre-v259 schema stored NO key)
  await addColumnIfMissing(db, 'webauthn_credentials', 'public_key_jwk', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'webauthn_credentials', 'counter', 'INTEGER DEFAULT 0');
  await addColumnIfMissing(db, 'webauthn_credentials', 'backup_eligible', 'INTEGER DEFAULT 0');
  await addColumnIfMissing(db, 'webauthn_credentials', 'backup_state', 'INTEGER DEFAULT 0');
  await addColumnIfMissing(db, 'webauthn_credentials', 'rp_id', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'webauthn_credentials', 'origin', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'webauthn_credentials', 'cred_user_handle', "TEXT DEFAULT ''");

  // Short-lived challenges for WebAuthn register/login
  await db.prepare(`CREATE TABLE IF NOT EXISTS webauthn_challenges (
    id TEXT PRIMARY KEY,
    challenge TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    purpose TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  // v259 — purpose/account/RP/origin binding + atomic single-use consumption
  await addColumnIfMissing(db, 'webauthn_challenges', 'username', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'webauthn_challenges', 'rp_id', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'webauthn_challenges', 'origin', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'webauthn_challenges', 'consumed', 'INTEGER DEFAULT 0');
  await addColumnIfMissing(db, 'webauthn_challenges', 'consumed_at', 'TEXT DEFAULT NULL');

  // Multi-user accounts (owner is always env ADMIN_USERNAME + ADMIN_PASSWORD)
  await db.prepare(`CREATE TABLE IF NOT EXISTS app_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    display_name TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    avatar_url TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT DEFAULT 'admin',
    created_at TEXT DEFAULT (datetime('now')),
    last_login TEXT
  )`).run();

  // Existing DBs: add missing columns only (never fail on duplicate)
  await addColumnIfMissing(db, 'app_users', 'email', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'app_users', 'phone', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'app_users', 'avatar_url', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'app_users', 'notes', "TEXT DEFAULT ''");

  // Server / admin configuration (owner-only)
  await db.prepare(`CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now'))
  )`).run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS mail_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    direction TEXT NOT NULL CHECK(direction IN ('in','out')),
    mailbox TEXT NOT NULL DEFAULT 'admin@afmarbre.com',
    from_addr TEXT NOT NULL DEFAULT '',
    to_addr TEXT NOT NULL DEFAULT '',
    cc_addr TEXT DEFAULT '',
    subject TEXT DEFAULT '',
    body_text TEXT DEFAULT '',
    body_html TEXT DEFAULT '',
    resend_id TEXT DEFAULT '',
    r2_key TEXT DEFAULT '',
    thread_key TEXT DEFAULT '',
    status TEXT DEFAULT 'received',
    meta_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  try { await db.prepare(`CREATE INDEX IF NOT EXISTS idx_mail_created ON mail_messages(created_at DESC)`).run(); } catch { /* */ }
  try { await db.prepare(`CREATE INDEX IF NOT EXISTS idx_mail_mailbox ON mail_messages(mailbox, direction)`).run(); } catch { /* */ }
  try { await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_resend ON mail_messages(resend_id) WHERE resend_id IS NOT NULL AND resend_id != ''`).run(); } catch { /* */ }
  });
}


export async function isTrustedDevice(db: D1Database, fingerprint: string): Promise<boolean> {
  if (!fingerprint || fingerprint === 'none') return false;
  const row = await db.prepare(`SELECT fingerprint FROM trusted_devices WHERE fingerprint = ?`).bind(fingerprint).first();
  return !!row;
}

export async function trustDevice(db: D1Database, fingerprint: string, ip: string, username?: string, userAgent?: string) {
  if (!fingerprint || fingerprint === 'none') return;
  await addColumnIfMissing(db, 'trusted_devices', 'username', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'trusted_devices', 'user_agent', "TEXT DEFAULT ''");
  // v0.7.1 — city/country captured from Cloudflare cf at login/touch (IP-based).
  await addColumnIfMissing(db, 'trusted_devices', 'city', "TEXT DEFAULT ''");
  // v0.7.5 — reprise après auto-déconnexion (30 j, même compte + même appareil)
  await addColumnIfMissing(db, 'trusted_devices', 'resume_until', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'trusted_devices', 'country', "TEXT DEFAULT ''");
  // v0.7.1 — main company email = OTP fallback destination until a user has one.
  await addColumnIfMissing(db, 'company_settings', 'email', "TEXT DEFAULT ''");
  const u = String(username || '').slice(0, 80);
  const ua = String(userAgent || '').slice(0, 160);
  await db.prepare(
    `INSERT INTO trusted_devices (fingerprint, last_ip, last_seen, username, user_agent) VALUES (?, ?, datetime('now'), ?, ?)
     ON CONFLICT(fingerprint) DO UPDATE SET last_ip = ?, last_seen = datetime('now'),
       username = CASE WHEN excluded.username != '' THEN excluded.username ELSE trusted_devices.username END,
       user_agent = CASE WHEN excluded.user_agent != '' THEN excluded.user_agent ELSE trusted_devices.user_agent END`
  ).bind(fingerprint, ip, u, ua, ip).run();
}

/** Part 2: re-confirm admin password for create / edit / delete (OTP is login-only). */
/**
 * Confirm destructive action with the **current user's own password**.
 * Owner → ADMIN_PASSWORD secret. Secondary user → their app_users password.
 */
export async function checkConfirmPassword(
  env: Env,
  db: D1Database,
  authHeader: string | undefined,
  body: any,
): Promise<{ ok: true } | { ok: false; error: string; status: number; code: string }> {
  const provided = String(
    body?.confirm_password ?? body?.password_confirm ?? body?.password ?? '',
  );
  // Timed UI undo (10s) — session + role already checked by route gate
  if (!provided.trim() && (body?.confirm_mode === 'timed_undo' || body?.session_confirm === true)) {
    return { ok: true };
  }
  // No password typed → the session itself is the confirmation.
  // Delete/confirm dialogs never ask for a password anymore (product decision):
  // login + OTP + per-route role gates are the security boundary. If a legacy
  // client DOES send one, it is still verified below.
  if (!provided.trim()) {
    return { ok: true };
  }

  const session = sessionUserFromHeader(authHeader);
  const username = (session.username || '').toLowerCase();
  const role = session.role || 'user';
  const ownerUser = getOwnerUsername(env);

  // Owner (or legacy session): Cloudflare secret
  if (role === 'owner' || username === ownerUser) {
    const expected = getPassword(env);
    if (!expected) {
      return {
        ok: false,
        error: 'Le mot de passe administrateur n\'est pas configuré (secret ADMIN_PASSWORD).',
        status: 503,
        code: 'NO_PASSWORD_CONFIGURED',
      };
    }
    if (!passwordsMatch(provided, expected)) {
      // 403: wrong confirm password must NOT invalidate the active session
      return { ok: false, error: 'Mot de passe incorrect', status: 403, code: 'BAD_PASSWORD' };
    }
    return { ok: true };
  }

  // Secondary user: their own password
  await ensureSecurityTables(db);
  const row = await db.prepare(
    `SELECT * FROM app_users WHERE username = ? AND active = 1`
  ).bind(username).first() as any;
  if (!row) {
    return { ok: false, error: 'Session utilisateur invalide', status: 403, code: 'BAD_PASSWORD' };
  }
  if (!(await verifyUserPassword(provided, row.password_salt, row.password_hash))) {
    return { ok: false, error: 'Mot de passe incorrect', status: 403, code: 'BAD_PASSWORD' };
  }
  return { ok: true };
}

export async function getReputation(db: D1Database, ip: string) {
  let row = await db.prepare(`SELECT * FROM ip_reputation WHERE ip = ?`).bind(ip).first();
  if (!row) {
    await db.prepare(`INSERT OR IGNORE INTO ip_reputation (ip, score, failed_count, success_count) VALUES (?, 50, 0, 0)`).bind(ip).run();
    row = { ip, score: 50, failed_count: 0, success_count: 0, blocked_until: null };
  }
  return row;
}

/** Password/OTP admission is account-aware, but explicit IP denials still win.
 * Never record a throttled request as another authentication failure.
 */
export async function credentialAttemptGate(c: any, username: string, purpose: CredentialAttemptPurpose): Promise<Response | null> {
  try {
    const ip = clientIp(c);
    const rep = await getReputation(c.env.DB, ip) as any;
    const until = Date.parse(String(rep.blocked_until || ''));
    if (until > Date.now() || Number(rep.score ?? 50) <= 10) {
      const retryAfter = until > Date.now() ? Math.max(1, Math.ceil((until - Date.now()) / 1000)) : 900;
      c.header('Retry-After', String(retryAfter));
      return c.json({ success: false, code: 'RATE_LIMITED', error: 'Trop de tentatives. Réessayez plus tard.', retry_after: retryAfter }, 429);
    }
    const budget = await reserveCredentialAttempt(c.env.DB, ip, username, purpose);
    if (!budget.allowed) {
      c.header('Retry-After', String(budget.retryAfter));
      return c.json({ success: false, code: 'RATE_LIMITED', error: 'Trop de tentatives. Réessayez plus tard.', retry_after: budget.retryAfter }, 429);
    }
    return null;
  } catch {
    // No raw DB error, username, IP, password or OTP in logs/response.
    return c.json({ success: false, code: 'AUTH_LIMIT_UNAVAILABLE', error: 'Vérification de sécurité indisponible. Réessayez plus tard.' }, 503);
  }
}

export async function isRateLimited(db: D1Database, ip: string): Promise<{ blocked: boolean; reason?: string }> {
  const rep = await getReputation(db, ip) as any;
  if (rep.blocked_until) {
    const until = new Date(rep.blocked_until).getTime();
    if (until > Date.now()) {
      return { blocked: true, reason: 'Trop de tentatives. Compte / IP temporairement bloqué. Réessayez plus tard.' };
    }
  }
  // Named password/OTP attempts already consume durable account-aware budgets
  // (delta 0). Do not let an unrelated legacy route re-ban their shared IP.
  const recent = await db.prepare(
    `SELECT COUNT(*) as c FROM login_attempts WHERE ip = ? AND success = 0 AND reputation_delta < 0 AND created_at > datetime('now', '-10 minutes')`
  ).bind(ip).first();
  const fails = Number(recent?.c || 0);
  if (fails >= 5) {
    const blockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await db.prepare(
      `UPDATE ip_reputation SET blocked_until = ?, score = MAX(0, score - 25), updated_at = datetime('now') WHERE ip = ?`
    ).bind(blockedUntil, ip).run();
    return { blocked: true, reason: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' };
  }
  if ((rep.score ?? 50) <= 10) {
    return { blocked: true, reason: 'Accès refusé (réputation IP). Contactez l’administrateur.' };
  }
  return { blocked: false };
}

export async function recordLogin(db: D1Database, ip: string, fingerprint: string, success: boolean, userAgent: string, accountBudgeted = false) {
  // Budgeted password/OTP failures are isolated by account. Preserve telemetry,
  // but don't turn five unrelated failures into an automatic shared-IP score ban.
  // Legacy methods retain their existing reputation behavior.
  const delta = success ? 5 : accountBudgeted ? 0 : -8;
  await db.prepare(`INSERT INTO login_attempts (ip, fingerprint, success, reputation_delta, user_agent) VALUES (?, ?, ?, ?, ?)`).bind(ip, fingerprint || '', success ? 1 : 0, delta, userAgent || '').run();
  await getReputation(db, ip);
  if (accountBudgeted) {
    await db.prepare(`UPDATE ip_reputation SET score = MIN(100, score + ?),
      success_count = success_count + ?, failed_count = failed_count + ?, updated_at = datetime('now') WHERE ip = ?`)
      .bind(success ? 5 : 0, success ? 1 : 0, success ? 0 : 1, ip).run();
  } else if (success) {
    await db.prepare(`UPDATE ip_reputation SET score = MIN(100, score + 5), success_count = success_count + 1, failed_count = failed_count, blocked_until = NULL, updated_at = datetime('now') WHERE ip = ?`).bind(ip).run();
  } else {
    await db.prepare(`UPDATE ip_reputation SET score = MAX(0, score - 8), failed_count = failed_count + 1, updated_at = datetime('now') WHERE ip = ?`).bind(ip).run();
  }
}

export async function authFailReason(
  authHeader: string | undefined,
  env: Env,
  db: D1Database,
  ip: string,
  fingerprint: string | undefined,
  opts?: { relaxSession?: boolean; allowRoleRefresh?: boolean },
): Promise<string> {
  if (!authHeader?.startsWith('Bearer ')) return 'missing';
  if (authHeader.slice(7).startsWith('np1.')) return await validateNativePilotToken(env, authHeader.slice(7), nativeCurrentIdentity) ? 'ok' : 'bad_token';
  const parsed = parseToken(authHeader.slice(7));
  if (!parsed) return 'bad_token';

  let roleChanged = false;
  if (parsed.version === 1) {
    const exp = getPassword(env);
    // Legacy v1 tokens embedded the raw password — reject them (force re-login → v2)
    return 'bad_password';
  } else {
    const user = (parsed.username || '').toLowerCase();
    const role = parsed.role || 'user';
    const proof = parsed.proof || '';
    const ownerUser = getOwnerUsername(env);
    if (user === ownerUser && role === 'owner') {
      const exp = getPassword(env);
      if (!exp) return 'bad_password';
      const ownerMaterial = await sha256Hex(`owner-key|${user}|${normalizePassword(exp)}`);
      const expectedProof = await makeSessionProof(user, 'owner', ownerMaterial, parsed.ip, parsed.fingerprint);
      if (proof !== expectedProof) return 'bad_password';
    } else {
      await ensureSecurityTables(db);
      const row = await db.prepare(
        `SELECT * FROM app_users WHERE username = ? AND active = 1`
      ).bind(user).first() as any;
      if (!row) return 'bad_password';
      // A stale role is proof of the same credential, not authority to use it.
      // It may only exchange for a current-role token at the dedicated endpoint.
      const expectedProof = await makeSessionProof(user, role, row.password_hash, parsed.ip, parsed.fingerprint);
      if (proof !== expectedProof) return 'bad_password';
      roleChanged = role !== row.role;
    }
  }

  // v0.7.5 — device revocation MUST kill live sessions (security audit finding):
  // a token whose fingerprint no longer has a trusted_devices row was revoked
  // remotely (« Appareils connectés » → révoquer). Every login path inserts the
  // row before handing out the token (trustDevice / touchTrustedDevice), and
  // /api/auth/me keeps re-touching it while the device is active — so a missing
  // row means « revoked », not « never seen ». Android signs out on any
  // authenticated 401; the web client drops to /login the same way.
  const revokedFp = parsed.fingerprint && parsed.fingerprint !== 'none' ? String(parsed.fingerprint).slice(0, 128) : '';
  if (revokedFp) {
    const dev = (await db
      .prepare(`SELECT username FROM trusted_devices WHERE fingerprint = ?`)
      .bind(revokedFp)
      .first()) as { username?: string } | null;
    if (!dev) return 'device_revoked';
    const devUser = String(dev.username || '').toLowerCase();
    const tokUser = String(parsed.username || '').toLowerCase();
    if (devUser && tokUser && devUser !== tokUser) return 'device_revoked';
  }

  if (opts?.relaxSession) return roleChanged && !opts?.allowRoleRefresh ? 'role_changed' : 'ok';
  // Device-bound sessions: fingerprint is the strong signal. Mobile / CGNAT / IPv6
  // often change IP mid-session — do not force re-login when the same device token is used.
  const tokenFp = parsed.fingerprint && parsed.fingerprint !== 'none' ? parsed.fingerprint : '';
  const reqFp = fingerprint && fingerprint !== 'none' ? fingerprint : '';
  if (tokenFp) {
    if (reqFp && reqFp !== tokenFp) return 'fp_changed';
    return roleChanged && !opts?.allowRoleRefresh ? 'role_changed' : 'ok';
  }
  // Legacy sessions without fingerprint: still bind to IP
  if (parsed.ip && ip && parsed.ip !== ip) {
    return 'ip_changed';
  }
  return roleChanged && !opts?.allowRoleRefresh ? 'role_changed' : 'ok';
}

/**
 * Extract the session identity from an Authorization header.
 *
 * SECURITY (2026-10-22, patrol finding): this function NEVER falls back to
 * 'owner'. It used to return the owner identity when the header was missing
 * or unparseable — every route gated only by requireOwner()/requireBizMutator()
 * (the 58 routes that were registered before the /api/* auth middleware, e.g.
 * /api/admin/r2/images, /api/admin/users, /api/admin/config, /api/admin/audit…)
 * was therefore world-open. Anonymous now means anonymous: gates reject, and
 * the auth middleware — registered FIRST, before every route — performs the
 * real verification (HMAC proof, IP/fingerprint binding) via authFailReason().
 * Callers must handle { username: '', role: '' } as "not authenticated".
 */
export async function requireOwnerOrAdmin(c: any): Promise<{ ok: true } | { ok: false; response: any }> {
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), c.req.header('X-Device-Fingerprint') || '');
  if (reason !== 'ok') return { ok: false, response: c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401) };
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  if (session.role !== 'owner' && session.role !== 'admin') {
    return { ok: false, response: c.json({ success: false, error: 'Réservé owner/admin.', code: 'FORBIDDEN' }, 403) };
  }
  return { ok: true };
}

export function sessionUserFromHeader(authHeader: string | undefined): { username: string; role: string } {
  const ANONYMOUS = { username: '', role: '' };
  if (!authHeader?.startsWith('Bearer ')) return ANONYMOUS;
  const native = parseNativePilotToken(authHeader.slice(7));
  if (native) return native; // only after the global authentication gate verifies its full hash
  const parsed = parseToken(authHeader.slice(7));
  if (!parsed) return ANONYMOUS;
  if (parsed.version === 2) {
    return { username: parsed.username || '', role: parsed.role || '' };
  }
  // Legacy v1 token (embeds the admin password): the auth middleware already
  // validated it against the stored credentials before we get here.
  return { username: getOwnerUsername({} as Env), role: 'admin' };
}


export async function secretMaterialForUsername(env: Env, db: D1Database, username: string, role: string): Promise<string | null> {
  const ownerUser = getOwnerUsername(env);
  const u = String(username || '').trim().toLowerCase();
  if (!u) return null;
  if (u === ownerUser || role === 'owner') {
    const expected = getPassword(env);
    if (!expected) return null;
    return sha256Hex(`owner-key|${ownerUser}|${normalizePassword(expected)}`);
  }
  const row = await db.prepare(`SELECT password_hash FROM app_users WHERE username = ? AND active = 1`).bind(u).first() as any;
  if (!row?.password_hash) return null;
  return String(row.password_hash);
}
export async function nativeCurrentIdentity(env: Env, username: string, role: string) {
  if (!username || username !== username.toLowerCase()) return null;
  if (username === getOwnerUsername(env)) {
    if (role !== 'owner') return null;
    const material = await secretMaterialForUsername(env, env.DB, username, role);
    return material ? { username, role, material, userId: null } : null;
  }
  if (!['admin', 'secretaire', 'stock', 'user'].includes(role)) return null;
  const row: any = await env.DB.prepare('SELECT id, role, password_hash FROM app_users WHERE username = ? AND active = 1').bind(username).first();
  if (!row || row.role !== role || !row.password_hash || !Number.isSafeInteger(row.id) || row.id <= 0) return null;
  return { username, role, material: String(row.password_hash), userId: Number(row.id) };
}
