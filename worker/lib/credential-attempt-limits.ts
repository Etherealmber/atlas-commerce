/** Persistent admission budgets for the exact password/email-OTP endpoints.
 * D1 is deployment-scoped. No fingerprint, UA or native marker establishes trust.
 * Attempts (including successful requests), not just failures, consume capacity.
 */
export type CredentialAttemptPurpose = 'password' | 'otp';
export interface CredentialAttemptDecision { allowed: boolean; retryAfter: number }
export const CREDENTIAL_ATTEMPT_LIMITS = {
  ipMinute: 60,
  ipTenMinutes: 300,
  accountTenMinutes: 20,
  accountIpPurposeTenMinutes: 5,
} as const;
const ready = new WeakSet<object>();

/** Exact routing only: other auth methods retain their existing protection. */
export function hasCredentialAttemptBudget(path: string): boolean {
  return path === '/api/auth/login' || path === '/api/auth/verify-otp' || path === '/api/auth/verify-link';
}

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** WeakSet is schema optimization only; counters never live in isolate memory. */
async function schema(db: D1Database): Promise<void> {
  if (ready.has(db)) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS credential_attempt_limits_v1 (
    bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_credential_attempt_limits_v1_expiry
    ON credential_attempt_limits_v1(expires_at)`).run();
  ready.add(db);
}

/** A single SQL statement reserves each slot atomically; denied traffic cannot
 * extend expiry or increment a saturated bucket. Prior reservations aren't
 * refunded if a later bucket denies (deliberately conservative under contention).
 * Storage errors propagate to the handler's fail-closed, fixed-code 503 response.
 */
export async function reserveCredentialAttempt(
  db: D1Database, ip: string, normalizedUsername: string,
  purpose: CredentialAttemptPurpose, nowMs = Date.now(),
): Promise<CredentialAttemptDecision> {
  if (!ip || ip === 'unknown' || !Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error('AUTH_LIMIT_UNAVAILABLE');
  await schema(db);
  const now = Math.floor(nowMs / 1000);
  const [ipHash, accountHash] = await Promise.all([digest(JSON.stringify(['ip', ip])), digest(JSON.stringify(['account', normalizedUsername.trim().toLowerCase()]))]);
  const specs: [string, number, number][] = [
    [`ip-minute:${ipHash}`, 60, CREDENTIAL_ATTEMPT_LIMITS.ipMinute],
    [`ip-ten:${ipHash}`, 600, CREDENTIAL_ATTEMPT_LIMITS.ipTenMinutes],
    [`account:${accountHash}`, 600, CREDENTIAL_ATTEMPT_LIMITS.accountTenMinutes],
    [`pair:${accountHash}:${ipHash}:${purpose}`, 600, CREDENTIAL_ATTEMPT_LIMITS.accountIpPurposeTenMinutes],
  ];
  // Bounded cleanup. TTL is checked logically, independent of physical deletion.
  await db.prepare(`DELETE FROM credential_attempt_limits_v1 WHERE bucket IN (
    SELECT bucket FROM credential_attempt_limits_v1 WHERE expires_at <= ? LIMIT 100
  )`).bind(now).run();
  for (const [key, seconds, max] of specs) {
    const expires = (Math.floor(now / seconds) + 1) * seconds;
    const bucket = `${key}:${Math.floor(now / seconds)}`;
    // eslint-disable-next-line no-await-in-loop -- Broad limits must deny before allocating narrower scopes.
    const reserved = await db.prepare(`INSERT INTO credential_attempt_limits_v1 (bucket, attempts, expires_at)
      VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1
      WHERE credential_attempt_limits_v1.attempts < ? RETURNING attempts`)
      .bind(bucket, expires, max).first<{ attempts: number }>();
    if (!reserved) return { allowed: false, retryAfter: Math.max(1, expires - now) };
  }
  return { allowed: true, retryAfter: 0 };
}
