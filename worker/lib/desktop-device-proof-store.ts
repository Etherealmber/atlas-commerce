/**
 * D1-backed DPoP nonce issuance and atomic replay prevention for desktop v3.
 * Wraps `verifyDesktopDeviceProof` so cryptographic checks and one-time
 * nonce/JTI consumption execute atomically inside the caller's `DB.batch`.
 */
import { verifyDesktopDeviceProof, type VerifiedDeviceProof } from './desktop-device-proof';

const NONCE_TTL_MS = 120_000;
const JTI_TTL_MS = 180_000;
const ready = new WeakSet<object>();

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function ensureDpopTables(db: D1Database): Promise<void> {
  if (ready.has(db)) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS desktop_v3_dpop_nonces (
        nonce TEXT PRIMARY KEY,
        origin TEXT NOT NULL,
        ip_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )`,
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS desktop_v3_dpop_jtis (
        thumbprint TEXT NOT NULL,
        jti TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (thumbprint, jti)
      )`,
    )
    .run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_v3_dpop_nonces_exp ON desktop_v3_dpop_nonces(expires_at)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_v3_dpop_jtis_exp ON desktop_v3_dpop_jtis(expires_at)').run();
  ready.add(db);
}

export async function issueDpopNonce(
  db: D1Database,
  origin: string,
  ipHash: string,
): Promise<{ nonce: string; expires_in: number }> {
  await ensureDpopTables(db);
  const now = Date.now();
  const nonce = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const expiresAt = now + NONCE_TTL_MS;
  await db
    .prepare('INSERT INTO desktop_v3_dpop_nonces (nonce, origin, ip_hash, expires_at) VALUES (?, ?, ?, ?)')
    .bind(nonce, origin, ipHash, expiresAt)
    .run();
  try {
    await db
      .prepare('DELETE FROM desktop_v3_dpop_nonces WHERE nonce IN (SELECT nonce FROM desktop_v3_dpop_nonces WHERE expires_at < ? LIMIT 100)')
      .bind(now)
      .run();
    await db
      .prepare('DELETE FROM desktop_v3_dpop_jtis WHERE rowid IN (SELECT rowid FROM desktop_v3_dpop_jtis WHERE expires_at < ? LIMIT 100)')
      .bind(now)
      .run();
  } catch {
    /* best-effort expiry pruning after nonce issuance */
  }
  return { nonce, expires_in: Math.floor(NONCE_TTL_MS / 1000) };
}

type VerifiedProofWithStatements = VerifiedDeviceProof & {
  consumeStatements: D1PreparedStatement[];
};

function decodeJwtNonce(proof: string): string | null {
  try {
    const parts = proof.split('.');
    if (parts.length !== 3) return null;
    const norm = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = '='.repeat((4 - (norm.length % 4)) % 4);
    const parsed = JSON.parse(atob(norm + pad));
    return typeof parsed?.nonce === 'string' && /^[A-Za-z0-9_-]{43}$/.test(parsed.nonce) ? parsed.nonce : null;
  } catch {
    return null;
  }
}

/**
 * Verifies a DPoP proof JWT against a server-issued nonce and returns atomic
 * D1 statements to consume the JTI (and optionally the single-use nonce).
 */
export async function prepareDpopVerification(
  db: D1Database,
  proof: string | undefined,
  opts: {
    origin: string;
    method: string;
    target: string;
    thumbprint?: string;
    accessToken?: string;
    transactionId?: string;
    singleUseNonce: boolean;
    skipReplayCheckAndInsert?: boolean;
  },
): Promise<VerifiedProofWithStatements | null> {
  if (!proof || typeof proof !== 'string') return null;
  const candidateNonce = decodeJwtNonce(proof);
  if (!candidateNonce) return null;

  await ensureDpopTables(db);
  const nowMs = Date.now();
  const nonceRow: any = await db
    .prepare('SELECT nonce, origin, expires_at FROM desktop_v3_dpop_nonces WHERE nonce = ? AND origin = ? AND expires_at > ?')
    .bind(candidateNonce, opts.origin, nowMs)
    .first();
  if (!nonceRow) return null;

  const verified = await verifyDesktopDeviceProof(proof, {
    method: opts.method,
    target: opts.target,
    nonce: candidateNonce,
    nowSeconds: Math.floor(nowMs / 1000),
    thumbprint: opts.thumbprint,
    accessToken: opts.accessToken,
    transactionId: opts.transactionId,
  });
  if (!verified) return null;

  if (opts.skipReplayCheckAndInsert && !opts.singleUseNonce) {
    return { ...verified, consumeStatements: [] };
  }

  const existingJti: any = await db
    .prepare('SELECT 1 AS used FROM desktop_v3_dpop_jtis WHERE thumbprint = ? AND jti = ?')
    .bind(verified.thumbprint, verified.jti)
    .first();
  if (existingJti) return null;

  const consumeStatements: D1PreparedStatement[] = [];
  if (opts.singleUseNonce) {
    // Enforce atomic single-use nonce claim inside the caller's batch:
    // if a concurrent request deleted or expired the nonce first,
    // `expires_at` evaluates to NULL and aborts the entire D1 batch.
    consumeStatements.push(
      db
        .prepare(
          `INSERT INTO desktop_v3_dpop_jtis (thumbprint, jti, expires_at)
           SELECT ?, ?, CASE
             WHEN EXISTS (
               SELECT 1 FROM desktop_v3_dpop_nonces
               WHERE nonce = ? AND origin = ? AND expires_at > ?
             ) THEN ? ELSE NULL END`,
        )
        .bind(verified.thumbprint, verified.jti, verified.nonce, opts.origin, nowMs, nowMs + JTI_TTL_MS),
      db
        .prepare('DELETE FROM desktop_v3_dpop_nonces WHERE nonce = ? AND origin = ? AND expires_at > ?')
        .bind(verified.nonce, opts.origin, nowMs),
    );
  } else {
    consumeStatements.push(
      db
        .prepare('INSERT INTO desktop_v3_dpop_jtis (thumbprint, jti, expires_at) VALUES (?, ?, ?)')
        .bind(verified.thumbprint, verified.jti, nowMs + JTI_TTL_MS),
    );
  }

  return { ...verified, consumeStatements };
}
