import { desktopHash } from '../routes/desktopAuth';

/** Staging pilot tokens: identity is only a routing hint until the full token
 * hash, stored identity and current account material have been verified in D1. */
export function parseNativePilotToken(token: string): { username: string; role: string } | null {
  try {
    if (!/^np1\.[A-Za-z0-9_-]{20,512}$/.test(token)) return null;
    const encoded = token.slice(4).replace(/-/g, '+').replace(/_/g, '/');
    const fields = atob(encoded + '='.repeat((4 - encoded.length % 4) % 4)).split('|');
    if (fields.length !== 4 || fields[0] !== 'np1' || !/^[a-z0-9._-]{1,64}$/.test(fields[1]) ||
      !['user', 'stock', 'secretaire', 'admin'].includes(fields[2]) || !/^[a-f0-9]{64}$/.test(fields[3])) return null;
    return { username: fields[1], role: fields[2] };
  } catch { return null; }
}
export function makeNativePilotToken(username: string, role: string, randomHex: string): string {
  return `np1.${btoa(`np1|${username}|${role}|${randomHex}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}
export function nativePilotEnabled(env: any): boolean {
  return env?.ENVIRONMENT === 'staging' && env?.DESKTOP_NATIVE_V2_PILOT_CHALLENGE === 'true' && env?.DESKTOP_NATIVE_V2_PILOT_LOGIN === 'true';
}
export function pilotLoginConfigured(env: any): boolean {
  try {
    const u = new URL(String(env.DESKTOP_NATIVE_V2_PILOT_ORIGIN || ''));
    return nativePilotEnabled(env) && u.protocol === 'https:' && u.origin === env.DESKTOP_NATIVE_V2_PILOT_ORIGIN &&
      /^[a-z0-9._-]{1,64}$/.test(String(env.DESKTOP_NATIVE_V2_PILOT_USERNAME || '')) &&
      env.DESKTOP_NATIVE_V2_PILOT_USERNAME !== String(env.ADMIN_USERNAME || 'admin').trim().toLowerCase() &&
      typeof env.DESKTOP_NATIVE_V2_PILOT_OTP_KEY === 'string' && env.DESKTOP_NATIVE_V2_PILOT_OTP_KEY.length >= 32 &&
      typeof env.DESKTOP_NATIVE_V2_PILOT_OTP_FROM === 'string' && env.DESKTOP_NATIVE_V2_PILOT_OTP_FROM.length > 3 &&
      typeof env.DESKTOP_NATIVE_V2_PILOT_OTP_TO === 'string' && env.DESKTOP_NATIVE_V2_PILOT_OTP_TO.length > 3 &&
      typeof env.EMAIL?.send === 'function' && typeof env.DB?.prepare === 'function' && typeof env.DB?.batch === 'function' &&
      !!String(env.TURNSTILE_SITE_KEY || '').trim() && !!String(env.TURNSTILE_SECRET_KEY || '').trim();
  } catch { return false; }
}
export async function validateNativePilotToken(env: any, token: string, currentIdentity: (env: any, username: string, role: string) => Promise<any>): Promise<boolean> {
  if (!pilotLoginConfigured(env)) return false;
  const identity = parseNativePilotToken(token);
  if (!identity || identity.username !== env.DESKTOP_NATIVE_V2_PILOT_USERNAME) return false;
  try {
    const row: any = await env.DB.prepare('SELECT * FROM desktop_native_sessions_pilot_v1 WHERE access_hash=?').bind(await desktopHash(token)).first();
    if (!row || row.revoked !== 0 || row.access_expires_at <= Date.now() || row.absolute_expires_at <= Date.now() ||
      row.origin !== env.DESKTOP_NATIVE_V2_PILOT_ORIGIN || row.username !== identity.username || row.role !== identity.role) return false;
    const user = await currentIdentity(env, identity.username, identity.role);
    return !!user && user.userId === row.user_id && await desktopHash(user.material) === row.credential_tag;
  } catch { return false; }
}
