/** The QR carries only a request reference; no state, verifier or session token. */
export type PhoneApprovalContext = { origin: string; request_id: string };
export type PhoneConsent = {
  request_id: string; origin: string; username: string; device_label: string;
  pairing_code: string; consent_nonce: string; expires_at: string; consent_expires_at: string;
};
const ID = /^[a-f0-9]{64}$/;
const FP = /^[A-Za-z0-9._:-]{16,128}$/;

export function parsePhoneApproval(fragment: string, origin: string, search: string): PhoneApprovalContext | null {
  try {
    const u = new URL(origin);
    if (u.protocol !== 'https:' || u.origin !== origin || search) return null;
    const p = new URLSearchParams(fragment.replace(/^#/, ''));
    if ([...p.keys()].length !== 1 || p.getAll('request_id').length !== 1) return null;
    const request_id = p.get('request_id') || '';
    return ID.test(request_id) ? { origin, request_id } : null;
  } catch { return null; }
}

class PhoneApprovalError extends Error {
  constructor(public code: string) { super('Connexion indisponible ou refusée. Recommencez depuis le desktop.'); }
}
/** Never forward a bearer across origins, follow redirects, or surface response bodies as errors. */
export async function phoneApprovalPost<T>(action: 'prepare' | 'decision', context: PhoneApprovalContext, token: string, fingerprint: string,
  decision?: { consent_nonce: string; decision: 'approve' | 'deny'; compare_confirmed: boolean }): Promise<T> {
  if (!token || !FP.test(fingerprint) || context.origin !== window.location.origin || window.location.protocol !== 'https:') throw new PhoneApprovalError('UNAUTHORIZED');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`/api/auth/desktop/v2/phone/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'X-Device-Fingerprint': fingerprint },
      body: JSON.stringify({ ...context, ...decision }), signal: controller.signal,
      redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', credentials: 'omit',
    });
    const payload: any = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      const code = typeof payload?.code === 'string' && /^[A-Z_]{1,40}$/.test(payload.code) ? payload.code : 'UNAVAILABLE';
      throw new PhoneApprovalError(code);
    }
    return payload.data as T;
  } finally { clearTimeout(timer); }
}

export function validPhoneConsent(value: any, context: PhoneApprovalContext): value is PhoneConsent {
  const until = Date.parse(value?.consent_expires_at);
  const expiry = Date.parse(value?.expires_at);
  return value?.request_id === context.request_id && value?.origin === context.origin &&
    typeof value?.username === 'string' && value.username.length > 0 && value.username.length <= 80 &&
    typeof value?.device_label === 'string' && value.device_label.length > 0 && value.device_label.length <= 60 &&
    typeof value?.pairing_code === 'string' && /^[A-Z0-9_-]{5}-[A-Z0-9_-]{5}$/.test(value.pairing_code) &&
    typeof value?.consent_nonce === 'string' && ID.test(value.consent_nonce) &&
    Number.isFinite(until) && Number.isFinite(expiry) && until > Date.now() && until <= expiry && expiry <= Date.now() + 300_000;
}
