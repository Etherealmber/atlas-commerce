/**
 * Unwired building block for a future native factor enrollment, NOT a route.
 * The application deliberately registers no adapters or endpoints for it.
 * A caller must supply independently reviewed, existing-account session AND
 * fresh reauthentication checks, an approved policy and an actual mail adapter.
 * A result from this module must never itself be treated as a login session.
 */
import { reserveCredentialAttempt } from './credential-attempt-limits';

type CommitGuard = { sql: string; params: unknown[] };
type Actor = { userId: number; commitGuard?: () => CommitGuard };
type Message = { to: string; code: string; purpose: 'new_mailbox' | 'old_mailbox_change' };
export type MailboxEnrollmentAdapters = {
  // Must verify an existing account session AND recent, explicit reauthentication
  // plus the approved first-enrollment/recovery policy for each call. Never
  // trust caller-supplied IDs or roles. `commitGuard` closes the TOCTOU race
  // between authorization/mail-delivery and session revocation at commit time.
  authorize: (context: unknown, operation: 'start' | 'confirm') => Promise<Actor | null>;
  // Must send only to the supplied address; no fallback or secret logging.
  send: (message: Message, signal: AbortSignal) => Promise<boolean>;
};
export type MailboxService = {
  start(context: unknown, candidate: string, ip: string): Promise<{ request_id: string; expires_in: number } | null>;
  confirm(context: unknown, requestId: string, newCode: string, oldCode: string | undefined, ip: string): Promise<boolean>;
};
const TTL = 600_000;
const ID = /^[a-f0-9]{64}$/;
const CODE = /^[0-9]{6}$/;
const initialized = new WeakSet<object>();

function randomHex(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('');
}
function code(): string {
  const value = new Uint32Array(1);
  do { crypto.getRandomValues(value); } while (value[0] >= 4294000000);
  return String(value[0] % 1000000).padStart(6, '0');
}
function same(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
function address(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 254 || value !== value.trim() || /[^\x21-\x7e]/.test(value)) return null;
  const parts = value.split('@');
  if (parts.length !== 2 || !/^[A-Za-z0-9.!#$%&'*+\-/=?^_`{|}~]+$/.test(parts[0]) ||
      parts[0].length > 64 || parts[0].startsWith('.') || parts[0].endsWith('.') || parts[0].includes('..') ||
      !/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(parts[1])) return null;
  return `${parts[0]}@${parts[1].toLowerCase()}`;
}
async function mac(key: string, id: string, purpose: string, otp: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const result = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(JSON.stringify(['atlas-desktop-mailbox-v1', id, purpose, otp])));
  return Array.from(new Uint8Array(result), n => n.toString(16).padStart(2, '0')).join('');
}
async function schema(db: D1Database): Promise<void> {
  if (initialized.has(db)) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS desktop_mailbox_verified_v1 (
    user_id INTEGER PRIMARY KEY, address TEXT NOT NULL, version TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, verified_at INTEGER NOT NULL
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS desktop_mailbox_pending_v1 (
    id TEXT PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE, candidate TEXT NOT NULL, previous_version TEXT,
    new_digest TEXT NOT NULL, old_digest TEXT, expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL, completion_nonce TEXT
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS desktop_mailbox_pending_expiry_v1 ON desktop_mailbox_pending_v1(expires_at)').run();
  // Never use existing editable app_users.email as proof. Changes suspend the
  // factor permanently until a separately approved recovery policy acts.
  await db.prepare(`CREATE TRIGGER IF NOT EXISTS desktop_mailbox_account_update_v1
    AFTER UPDATE OF username,role,password_hash,password_salt,active,email ON app_users
    WHEN OLD.username IS NOT NEW.username OR OLD.role IS NOT NEW.role OR OLD.password_hash IS NOT NEW.password_hash OR
      OLD.password_salt IS NOT NEW.password_salt OR OLD.active IS NOT NEW.active OR OLD.email IS NOT NEW.email BEGIN
    UPDATE desktop_mailbox_pending_v1 SET status='cancelled',new_digest='',old_digest=NULL WHERE user_id=OLD.id AND status IN ('sending','pending');
    UPDATE desktop_mailbox_verified_v1 SET active=0 WHERE user_id=OLD.id; END`).run();
  await db.prepare(`CREATE TRIGGER IF NOT EXISTS desktop_mailbox_account_delete_v1 AFTER DELETE ON app_users BEGIN
    UPDATE desktop_mailbox_pending_v1 SET status='cancelled',new_digest='',old_digest=NULL WHERE user_id=OLD.id AND status IN ('sending','pending');
    UPDATE desktop_mailbox_verified_v1 SET active=0 WHERE user_id=OLD.id; END`).run();
  initialized.add(db);
}

/** Fail closed: unavailable unless both policies are explicitly supplied and a
 * dedicated high-entropy MAC secret is configured. Never register this object
 * as a public route without reviewed authorization, transport and recovery. */
export function createMailboxEnrollment(db: D1Database, key: string, adapters?: MailboxEnrollmentAdapters): MailboxService | null {
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function' || typeof key !== 'string' || key.length < 32 ||
      typeof adapters?.authorize !== 'function' || typeof adapters?.send !== 'function') return null;
  const ready = adapters;
  async function actor(context: unknown, operation: 'start' | 'confirm') {
    const identity = await ready.authorize(context, operation);
    if (!identity || !Number.isSafeInteger(identity.userId) || identity.userId <= 0) return null;
    const row: any = await db.prepare('SELECT id,username,role,password_hash,password_salt FROM app_users WHERE id=? AND active=1').bind(identity.userId).first();
    if (!row || !row.username || !row.password_hash || !row.role) return null;
    return { user: row, commitGuard: identity.commitGuard };
  }
  async function budget(ip: string, username: string, purpose: 'password' | 'otp') {
    if (!ip || ip === 'unknown') return false;
    return (await reserveCredentialAttempt(db, ip, username, purpose)).allowed;
  }
  async function deliver(message: Message): Promise<boolean> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        ready.send(message, controller.signal),
        new Promise<boolean>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(false); }, 5000); }),
      ]);
    } catch { return false; }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }
  return {
    async start(context, candidate, ip) {
      const dest = address(candidate);
      if (!dest) return null;
      await schema(db);
      const auth = await actor(context, 'start');
      if (!auth || !(await budget(ip, auth.user.username, 'password'))) return null;
      const { user, commitGuard } = auth;
      await db.prepare(`DELETE FROM desktop_mailbox_pending_v1 WHERE id IN
        (SELECT id FROM desktop_mailbox_pending_v1 WHERE expires_at<? LIMIT 100)`).bind(Date.now() - 86_400_000).run();
      const prior: any = await db.prepare('SELECT * FROM desktop_mailbox_verified_v1 WHERE user_id=?').bind(user.id).first();
      if (prior && (prior.active !== 1 || prior.address === dest)) return null; // recovery or no change
      const id = randomHex(); const next = code(); const previous = prior ? code() : null; const expires = Date.now() + TTL;
      const preGuard = commitGuard?.();
      const preGuardClause = preGuard ? ` AND ${preGuard.sql}` : '';
      const inserted: any = await db.prepare(`INSERT INTO desktop_mailbox_pending_v1 (id,user_id,candidate,previous_version,new_digest,old_digest,expires_at,status)
        SELECT ?,id,?,?,?,?,?,'sending' FROM app_users WHERE id=? AND username=? AND role=? AND password_hash=? AND password_salt=? AND active=1${preGuardClause}
        ON CONFLICT(user_id) DO UPDATE SET id=excluded.id,candidate=excluded.candidate,previous_version=excluded.previous_version,
          new_digest=excluded.new_digest,old_digest=excluded.old_digest,expires_at=excluded.expires_at,attempts=0,status='sending',completion_nonce=NULL
        WHERE (desktop_mailbox_pending_v1.status IN ('failed','completed','cancelled') OR desktop_mailbox_pending_v1.expires_at<=?)${preGuardClause} RETURNING id`)
        .bind(id, dest, prior?.version || null, await mac(key, id, 'new', next), previous ? await mac(key, id, 'old', previous) : null, expires,
          user.id, user.username, user.role, user.password_hash, user.password_salt,
          ...(preGuard?.params || []),
          Date.now(),
          ...(preGuard?.params || [])).first();
      if (!inserted) return null;
      let sent = false;
      try {
        // A change notifies the previously verified address and requires its
        // code as well as a code delivered to the new candidate.
        const oldSent = !prior || await deliver({to:prior.address, code:previous!, purpose:'old_mailbox_change'});
        const newSent = oldSent && await deliver({to:dest, code:next, purpose:'new_mailbox'});
        sent = !!newSent;
      } catch { /* fail closed; never log adapter exceptions */ }
      const postGuard = commitGuard?.();
      const postGuardClause = postGuard ? ` AND ${postGuard.sql}` : '';
      const transitioned = await db.prepare(`UPDATE desktop_mailbox_pending_v1 SET status=?,
        new_digest=CASE WHEN ?=1 THEN new_digest ELSE '' END,old_digest=CASE WHEN ?=1 THEN old_digest ELSE NULL END
        WHERE id=? AND user_id=? AND status='sending' AND expires_at>?${postGuardClause} RETURNING id`)
        .bind(sent ? 'pending' : 'failed', sent ? 1 : 0, sent ? 1 : 0, id, user.id, Date.now(), ...(postGuard?.params || [])).first();
      if (!transitioned) {
        await db.prepare(`UPDATE desktop_mailbox_pending_v1 SET status='cancelled', new_digest='', old_digest=NULL
          WHERE id=? AND user_id=? AND status='sending'`).bind(id, user.id).run().catch(() => undefined);
      }
      return sent && transitioned ? {request_id:id, expires_in:TTL / 1000} : null;
    },
    async confirm(context, requestId, newCode, oldCode, ip) {
      if (!ID.test(requestId) || !CODE.test(newCode) || (oldCode !== undefined && !CODE.test(oldCode))) return false;
      await schema(db);
      const auth = await actor(context, 'confirm');
      if (!auth || !(await budget(ip, auth.user.username, 'otp'))) return false;
      const { user, commitGuard } = auth;
      const attemptGuard = commitGuard?.();
      const attemptGuardClause = attemptGuard ? ` AND ${attemptGuard.sql}` : '';
      const row: any = await db.prepare(`UPDATE desktop_mailbox_pending_v1 SET attempts=attempts+1
        WHERE id=? AND user_id=? AND status='pending' AND expires_at>? AND attempts<5${attemptGuardClause} RETURNING *`)
        .bind(requestId, user.id, Date.now(), ...(attemptGuard?.params || [])).first();
      if (!row || !same(row.new_digest, await mac(key, requestId, 'new', newCode)) ||
          (row.old_digest !== null && (!oldCode || !same(row.old_digest, await mac(key, requestId, 'old', oldCode))))) return false;
      const nonce = randomHex(); const now = Date.now();
      const batchGuard = commitGuard?.();
      const batchGuardClause = batchGuard ? ` AND ${batchGuard.sql}` : '';
      const results: any[] = await db.batch([
        db.prepare(`UPDATE desktop_mailbox_pending_v1 SET status='completed',completion_nonce=?,new_digest='',old_digest=NULL
          WHERE id=? AND user_id=? AND status='pending' AND expires_at>? AND attempts<=5
          AND EXISTS (SELECT 1 FROM app_users WHERE id=? AND username=? AND role=? AND password_hash=? AND password_salt=? AND active=1)${batchGuardClause}`)
          .bind(nonce, requestId, user.id, now, user.id, user.username, user.role, user.password_hash, user.password_salt, ...(batchGuard?.params || [])),
        db.prepare(`INSERT INTO desktop_mailbox_verified_v1 (user_id,address,version,active,verified_at)
          SELECT p.user_id,p.candidate,?,1,? FROM desktop_mailbox_pending_v1 p WHERE p.id=? AND p.user_id=? AND p.status='completed' AND p.completion_nonce=?
          AND ((p.previous_version IS NULL AND NOT EXISTS (SELECT 1 FROM desktop_mailbox_verified_v1 v WHERE v.user_id=p.user_id))
            OR EXISTS (SELECT 1 FROM desktop_mailbox_verified_v1 v WHERE v.user_id=p.user_id AND v.version=p.previous_version AND v.active=1))${batchGuardClause}
          ON CONFLICT(user_id) DO UPDATE SET address=excluded.address,version=excluded.version,active=1,verified_at=excluded.verified_at`)
          .bind(nonce, now, requestId, user.id, nonce, ...(batchGuard?.params || [])),
      ]);
      return Number(results[0]?.meta?.changes || 0) === 1 && Number(results[1]?.meta?.changes || 0) === 1;
    },
  };
}
