/**
 * Desktop v3 device-bound session helpers (`nv3.`) and strict readiness gate.
 * Production stays disabled unless ALL runtime gates, mail transport, Turnstile
 * verifier, MAC keys, and explicit production approval are configured.
 */
import { desktopHash } from '../routes/desktopAuth';
import { createNativeMailTransport } from './desktop-mail-transport';
import { prepareDpopVerification } from './desktop-device-proof-store';

export function desktopV3Readiness(env: any): { ready: boolean; reason: string } {
  if (env?.DESKTOP_NATIVE_V3_ENABLED !== 'true') {
    return { ready: false, reason: 'NOT_READY' };
  }
  if (env?.ENVIRONMENT === 'production' && env?.DESKTOP_NATIVE_V3_PROD_APPROVED !== 'true') {
    return { ready: false, reason: 'NOT_READY' };
  }
  if (typeof env?.DB?.prepare !== 'function' || typeof env?.DB?.batch !== 'function') {
    return { ready: false, reason: 'NOT_READY' };
  }
  if (!String(env?.TURNSTILE_SITE_KEY || '').trim() || !String(env?.TURNSTILE_SECRET_KEY || '').trim()) {
    return { ready: false, reason: 'NOT_READY' };
  }
  if (typeof env?.DESKTOP_NATIVE_V3_OTP_KEY !== 'string' || env.DESKTOP_NATIVE_V3_OTP_KEY.length < 32) {
    return { ready: false, reason: 'NOT_READY' };
  }
  if (typeof env?.DESKTOP_NATIVE_MAILBOX_MAC_KEY !== 'string' || env.DESKTOP_NATIVE_MAILBOX_MAC_KEY.length < 32) {
    return { ready: false, reason: 'NOT_READY' };
  }
  if (!createNativeMailTransport(env)) {
    return { ready: false, reason: 'NOT_READY' };
  }
  return { ready: true, reason: 'OK' };
}

export function desktopV3Enabled(env: any): boolean {
  return desktopV3Readiness(env).ready;
}

export function parseDesktopV3Token(token: string): { username: string; role: string } | null {
  try {
    if (!/^nv3\.[A-Za-z0-9_-]{20,512}$/.test(token)) return null;
    const encoded = token.slice(4).replace(/-/g, '+').replace(/_/g, '/');
    const fields = atob(encoded + '='.repeat((4 - (encoded.length % 4)) % 4)).split('|');
    if (
      fields.length !== 4 ||
      fields[0] !== 'nv3' ||
      !/^[a-z0-9._-]{1,64}$/.test(fields[1]) ||
      !['owner', 'admin', 'secretaire', 'stock', 'user'].includes(fields[2]) ||
      !/^[a-f0-9]{64}$/.test(fields[3])
    ) {
      return null;
    }
    return { username: fields[1], role: fields[2] };
  } catch {
    return null;
  }
}

export function makeDesktopV3Token(username: string, role: string, randomHex: string): string {
  return `nv3.${btoa(`nv3|${username}|${role}|${randomHex}`)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')}`;
}

export async function validateDesktopV3AccessToken(
  env: any,
  token: string,
  opts: {
    origin: string;
    method: string;
    target: string;
    dpopHeader?: string;
    skipDpopReplayInsert?: boolean;
    currentIdentity: (env: any, username: string, role: string) => Promise<{
      username: string;
      role: string;
      material: string;
      userId: number | null;
    } | null>;
  },
): Promise<{ ok: true; sessionId: string; username: string; role: string; thumbprint: string } | { ok: false; reason: string }> {
  if (!desktopV3Enabled(env)) return { ok: false, reason: 'bad_token' };
  const hint = parseDesktopV3Token(token);
  if (!hint) return { ok: false, reason: 'bad_token' };

  try {
    const accessHash = await desktopHash(token);
    const row: any = await env.DB.prepare('SELECT * FROM desktop_v3_sessions WHERE access_hash = ?')
      .bind(accessHash)
      .first();
    const now = Date.now();
    if (
      !row ||
      row.revoked !== 0 ||
      row.access_expires_at <= now ||
      row.absolute_expires_at <= now ||
      row.origin !== opts.origin ||
      row.username !== hint.username ||
      row.role !== hint.role
    ) {
      return { ok: false, reason: 'bad_token' };
    }

    const identity = await opts.currentIdentity(env, hint.username, hint.role);
    if (
      !identity ||
      (row.user_id === null ? identity.userId !== null : identity.userId !== row.user_id) ||
      (await desktopHash(identity.material)) !== row.credential_tag
    ) {
      return { ok: false, reason: 'bad_token' };
    }

    const verified = await prepareDpopVerification(env.DB, opts.dpopHeader, {
      origin: opts.origin,
      method: opts.method,
      target: opts.target,
      thumbprint: row.device_thumbprint,
      accessToken: token,
      singleUseNonce: false,
      skipReplayCheckAndInsert: opts.skipDpopReplayInsert,
    });
    if (!verified) {
      return { ok: false, reason: 'invalid_dpop' };
    }

    try {
      const results = await env.DB.batch([
        ...verified.consumeStatements,
        env.DB
          .prepare(
            'UPDATE desktop_v3_sessions SET last_used_at = ? WHERE id = ? AND revoked = 0 AND access_expires_at > ? AND absolute_expires_at > ?',
          )
          .bind(now, row.id, now, now),
      ]);
      const updateRes = Array.isArray(results) ? results[results.length - 1] : null;
      if (Number(updateRes?.meta?.changes || 0) <= 0) {
        return { ok: false, reason: 'bad_token' };
      }
    } catch {
      return { ok: false, reason: 'invalid_dpop' };
    }

    return {
      ok: true,
      sessionId: row.id,
      username: row.username,
      role: row.role,
      thumbprint: row.device_thumbprint,
    };
  } catch {
    return { ok: false, reason: 'bad_token' };
  }
}
