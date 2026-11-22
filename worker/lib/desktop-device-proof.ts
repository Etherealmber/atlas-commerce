/** v0.1 candidate DPoP verifier. NOT an authorization or replay store.
 * Do not mount until nonce/JTI consumption and the requested action are atomic. */
type Expected = { method: string; target: string; nonce: string; nowSeconds: number; thumbprint?: string; accessToken?: string; transactionId?: string };
export type VerifiedDeviceProof = { thumbprint: string; jti: string; nonce: string; issuedAt: number };
function b64(bytes: Uint8Array): string { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64(s: unknown, size?: number): Uint8Array<ArrayBuffer> {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]+$/.test(s) || s.length % 4 === 1) throw new Error('invalid');
  const raw = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4));
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  if ((size !== undefined && bytes.length !== size) || b64(bytes) !== s) throw new Error('invalid');
  return bytes;
}
async function sha(value: string): Promise<string> {
  return b64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
// Bounded parser detects duplicate names, including escaped aliases, at all depths.
function strictJson(input: string): unknown {
  let i = 0, count = 0;
  const ws = () => { while (/[\x20\t\r\n]/.test(input[i] || '\0')) i++; };
  function string(): string {
    const start = i;
    if (input[i++] !== '"') throw new Error('invalid');
    while (i < input.length) {
      const c = input[i++];
      if (c === '"') return JSON.parse(input.slice(start, i));
      if (c === '\\') { if (i >= input.length) throw new Error('invalid'); i++; }
      else if (c.charCodeAt(0) < 32) throw new Error('invalid');
    }
    throw new Error('invalid');
  }
  function value(depth: number): any {
    if (depth > 8 || ++count > 100) throw new Error('invalid');
    ws(); const c = input[i];
    if (c === '"') return string();
    if (c === '{') {
      i++; ws(); const out: Record<string, unknown> = Object.create(null); const keys = new Set<string>();
      if (input[i] === '}') { i++; return out; }
      for (;;) {
        ws(); const key = string(); if (keys.has(key)) throw new Error('duplicate'); keys.add(key);
        ws(); if (input[i++] !== ':') throw new Error('invalid'); out[key] = value(depth + 1); ws();
        if (input[i] === '}') { i++; return out; } if (input[i++] !== ',') throw new Error('invalid');
      }
    }
    if (c === '[') {
      i++; ws(); const out: unknown[] = []; if (input[i] === ']') { i++; return out; }
      for (;;) { out.push(value(depth + 1)); ws(); if (input[i] === ']') { i++; return out; } if (input[i++] !== ',') throw new Error('invalid'); }
    }
    const match = input.slice(i).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/);
    if (!match) throw new Error('invalid'); i += match[0].length; return JSON.parse(match[0]);
  }
  const result = value(0); ws(); if (i !== input.length) throw new Error('invalid'); return result;
}
function object(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
  return value as Record<string, any>;
}
function exactKeys(value: Record<string, any>, required: string[], optional: string[] = []) {
  const names = Object.keys(value);
  if (required.some(k => !Object.hasOwn(value, k)) || names.some(k => !required.includes(k) && !optional.includes(k))) throw new Error('invalid');
}
/** Caller must obtain target, nonce and key binding from authoritative server state,
 * never from the proof itself. Returns null for all invalid input. It verifies only
 * cryptography/claims, not nonce freshness, one-time use, authorization or storage. */
export async function verifyDesktopDeviceProof(proof: unknown, expected: Expected): Promise<VerifiedDeviceProof | null> {
  try {
    if (typeof proof !== 'string' || proof.length > 8192) return null;
    const parts = proof.split('.'); if (parts.length !== 3) return null;
    const decode = (s: string) => new TextDecoder('utf-8', { fatal:true }).decode(unb64(s));
    const header = object(strictJson(decode(parts[0]))), claims = object(strictJson(decode(parts[1])));
    exactKeys(header, ['typ','alg','jwk']); exactKeys(claims, ['jti','htm','htu','iat','nonce'], ['ath','atlas_txn']);
    if (header.typ !== 'dpop+jwt' || header.alg !== 'ES256') return null;
    const jwk = object(header.jwk); exactKeys(jwk, ['kty','crv','x','y']);
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') return null;
    unb64(jwk.x, 32); unb64(jwk.y, 32);
    const jti = unb64(claims.jti); if (jti.length < 16 || jti.length > 64) return null;
    unb64(claims.nonce, 32); unb64(expected.nonce, 32);
    if (!Number.isSafeInteger(expected.nowSeconds) || !Number.isSafeInteger(claims.iat) || Math.abs(expected.nowSeconds - claims.iat) > 60 || claims.nonce !== expected.nonce) return null;
    const url = new URL(expected.target);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || url.href !== expected.target || claims.htu !== expected.target ||
        !/^[A-Z]+$/.test(expected.method) || claims.htm !== expected.method) return null;
    if (expected.transactionId !== undefined ? claims.atlas_txn !== expected.transactionId : Object.hasOwn(claims,'atlas_txn')) return null;
    if (expected.accessToken !== undefined && (typeof expected.accessToken !== 'string' || !/^[\x21-\x7e]{1,4096}$/.test(expected.accessToken))) return null;
    if (expected.accessToken !== undefined ? claims.ath !== await sha(expected.accessToken) : Object.hasOwn(claims,'ath')) return null;
    const thumbprint = await sha(JSON.stringify({crv:'P-256',kty:'EC',x:jwk.x,y:jwk.y}));
    if (expected.thumbprint !== undefined && thumbprint !== expected.thumbprint) return null;
    const key = await crypto.subtle.importKey('jwk', {kty:'EC',crv:'P-256',x:jwk.x,y:jwk.y}, {name:'ECDSA',namedCurve:'P-256'}, false, ['verify']);
    if (!(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'}, key, unb64(parts[2], 64), new TextEncoder().encode(`${parts[0]}.${parts[1]}`)))) return null;
    return { thumbprint, jti:claims.jti, nonce:claims.nonce, issuedAt:claims.iat };
  } catch { return null; }
}
