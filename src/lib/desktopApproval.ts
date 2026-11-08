/** Browser-only handoff state: never a session token, PKCE verifier or URL redirect. */
export type DesktopApproval = { request_id: string; state: string; origin: string; expiresAt: number };
export const DESKTOP_APPROVAL_KEY = 'atlas_desktop_approval_v1';
const ID = /^[a-f0-9]{64}$/;
const STATE = /^[A-Za-z0-9_-]{43,128}$/;

/** Parse only our exact fragment contract, not arbitrary callbacks or return URLs. */
export function parseDesktopApproval(fragment: string, origin: string, now = Date.now()): DesktopApproval | null {
  try {
    if (new URL(origin).protocol !== 'https:' || new URL(origin).origin !== origin) return null;
    const p = new URLSearchParams(fragment.replace(/^#/, ''));
    if ([...p.keys()].length !== 2 || p.getAll('request_id').length !== 1 || p.getAll('state').length !== 1) return null;
    const id = p.get('request_id') || '';
    const state = p.get('state') || '';
    if (!ID.test(id) || !STATE.test(state)) return null;
    return { request_id: id, state, origin, expiresAt: now + 300_000 };
  } catch { return null; }
}

export function clearDesktopApproval(): void {
  try { sessionStorage.removeItem(DESKTOP_APPROVAL_KEY); } catch { /* fail closed on read */ }
}
export function saveDesktopApproval(context: DesktopApproval): boolean {
  try { sessionStorage.setItem(DESKTOP_APPROVAL_KEY, JSON.stringify(context)); return true; }
  catch { return false; }
}
/** Only this fixed route may replace the usual post-login destination. */
export function desktopLoginReturn(): '/login/desktop' | null {
  return loadDesktopApproval() ? '/login/desktop' : null;
}
export function loadDesktopApproval(): DesktopApproval | null {
  try {
    const c = JSON.parse(sessionStorage.getItem(DESKTOP_APPROVAL_KEY) || 'null');
    if (c && Object.keys(c).sort().join(',') === 'expiresAt,origin,request_id,state' &&
      typeof c.request_id === 'string' && ID.test(c.request_id) && typeof c.state === 'string' && STATE.test(c.state) &&
      c.origin === window.location.origin && window.location.protocol === 'https:' &&
      Number.isFinite(c.expiresAt) && c.expiresAt > Date.now() && c.expiresAt <= Date.now() + 300_000) return c;
  } catch { /* absent, blocked or invalid storage is not a redirect */ }
  clearDesktopApproval();
  return null;
}

export type DesktopConsent = {
  request_id: string; origin: string; username: string; device_label: string;
  pairing_code: string; csrf_token: string; expires_at: string; consent_expires_at: string;
};
const MESSAGES: Record<string, string> = {
  DEVICE_REQUIRED: 'Empreinte du navigateur indisponible. Cette connexion desktop ne peut pas continuer.',
  EXPIRED: 'La demande a expiré. Recommencez depuis le desktop.',
  USED: 'Cette demande a déjà été utilisée.', CANCELLED: 'Demande annulée sur le desktop.',
  DENIED: 'Connexion refusée.', CSRF_INVALID: 'Confirmation expirée ou remplacée. Rechargez cette page.',
  INVALID_PROOF: 'La demande ou son état ne correspond pas.', ORIGIN_MISMATCH: 'Le serveur ne correspond pas à la demande.',
  ACCOUNT_CHANGED: 'Le compte a été modifié. Recommencez la connexion.', RATE_LIMITED: 'Trop de tentatives. Patientez.',
};
export class DesktopApprovalError extends Error {
  constructor(public code: string) { super(MESSAGES[code] || 'Impossible de poursuivre la connexion desktop.'); }
}
/** Same-origin fetch only; never follow a redirect carrying the browser bearer. */
export async function desktopBrowserPost<T>(action: 'prepare' | 'authorize', context: DesktopApproval, token: string, fingerprint: string, decision?: { csrf_token: string; decision: 'approve' | 'deny' }): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`/api/auth/desktop/v1/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Device-Fingerprint': fingerprint },
      body: JSON.stringify({ request_id: context.request_id, origin: context.origin, state: context.state, ...decision }),
      signal: controller.signal, redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', credentials: 'same-origin',
    });
    const reply: any = await res.json().catch(() => null);
    if (!res.ok || !reply?.success) {
      // No raw server text, body, URLs or credentials in an Error/console/crash report.
      const code = typeof reply?.code === 'string' && /^[A-Z_]{1,40}$/.test(reply.code) ? reply.code : 'UNAVAILABLE';
      throw new DesktopApprovalError(code);
    }
    return reply.data as T;
  } finally { clearTimeout(timer); }
}
