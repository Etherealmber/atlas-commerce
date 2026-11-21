/**
 * Unmounted lab verifier. No route, credential lookup, state store, sessions,
 * rate limits or account authentication. Caller MUST supply trusted policy,
 * stored key and a single-use server challenge, and implement atomic updates.
 * Not suitable for activation or production.
 */
import { b64uToBytes, bytesToB64u, policyFromEnv, verifyAuthentication, type AuthenticationInput } from '../../worker/lib/webauthn';

function integer(bytes: Uint8Array, pos: number): { value: Uint8Array; next: number } {
  if (bytes[pos] !== 0x02) throw new Error('invalid assertion');
  const n = bytes[pos + 1];
  if (!n || n > 33 || pos + 2 + n > bytes.length) throw new Error('invalid assertion');
  let value = bytes.subarray(pos + 2, pos + 2 + n);
  if ((value[0] & 0x80) || (value.length > 1 && value[0] === 0 && !(value[1] & 0x80))) throw new Error('invalid assertion');
  if (value.length === 33) { if (value[0] !== 0) throw new Error('invalid assertion'); value = value.subarray(1); }
  if (value.length > 32) throw new Error('invalid assertion');
  const padded = new Uint8Array(32); padded.set(value, 32 - value.length);
  return { value: padded, next: pos + 2 + n };
}

/** Strict DER-encoded ES256 signature -> fixed-width r||s for WebCrypto. */
export function es256DerToRaw(der: Uint8Array): Uint8Array {
  if (der.length < 8 || der.length > 72 || der[0] !== 0x30 || der[1] !== der.length - 2) throw new Error('invalid assertion');
  const r = integer(der, 2); const s = integer(der, r.next);
  if (s.next !== der.length) throw new Error('invalid assertion');
  const raw = new Uint8Array(64); raw.set(r.value); raw.set(s.value, 32); return raw;
}

const B64 = /^[A-Za-z0-9_-]+$/;
function encoded(s: unknown, max: number): s is string {
  if (typeof s !== 'string' || !s || s.length > max || !B64.test(s)) return false;
  try { return bytesToB64u(b64uToBytes(s)) === s; } catch { return false; }
}

export async function verifyWindowsLabAssertion(input: {
  /** Trusted server configuration, not values supplied in the assertion. */
  expectedOrigin: string; rpId: string; expectedChallenge: string;
  clientDataJSON: string; authenticatorData: string; signatureDER: string;
  userHandle?: string;
  /** Credential obtained from trusted storage, not from the client. */
  stored: AuthenticationInput['stored'];
}) {
  try {
    const url = new URL(input.expectedOrigin);
    if (url.protocol !== 'https:' || url.origin !== input.expectedOrigin || url.hostname !== input.rpId ||
      !/^[a-z0-9.-]+$/.test(input.rpId) || !encoded(input.expectedChallenge, 43) || input.expectedChallenge.length !== 43 ||
      !encoded(input.clientDataJSON, 8192) || !encoded(input.authenticatorData, 8192) || !encoded(input.signatureDER, 128) ||
      (input.userHandle !== undefined && input.userHandle !== '' && !encoded(input.userHandle, 1024))) throw new Error('invalid assertion');
    const json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b64uToBytes(input.clientDataJSON)));
    if (!json || Array.isArray(json) || typeof json !== 'object' || (json.crossOrigin !== undefined && json.crossOrigin !== false)) throw new Error('invalid assertion');
    const raw = es256DerToRaw(b64uToBytes(input.signatureDER));
    const policy = policyFromEnv({ WEBAUTHN_ENABLED: 'true', WEBAUTHN_RP_ID: input.rpId, WEBAUTHN_ALLOWED_ORIGINS: input.expectedOrigin, WEBAUTHN_REQUIRE_UV: 'required' });
    return await verifyAuthentication({ clientDataJSON: input.clientDataJSON, authenticatorData: input.authenticatorData,
      signature: bytesToB64u(raw), userHandle: input.userHandle, expectedChallenge: input.expectedChallenge, policy, stored: input.stored });
  } catch {
    // Generic error only. Never expose or log assertion, credential, key or origin.
    throw new Error('invalid assertion');
  }
}
