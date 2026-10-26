/**
 * v259 — WebAuthn verifier (registration + authentication), written to the
 * W3C WebAuthn Level 2 verification procedures. Replaces the pre-v259 routes
 * that accepted client-submitted fields without cryptographic proof (no
 * attestation parsing, no signature check, no stored public key).
 *
 * Security properties enforced here (see docs/webauthn.md):
 *  - challenges: 32 crypto-random bytes, purpose-bound (register|login),
 *    bound to username (register / filtered login), RP id and expected
 *    origin; 5-minute expiry; ATOMIC single use (conditional UPDATE,
 *    consumed flag) — expired, replayed or mismatched challenges fail;
 *  - registration: clientData type `webauthn.create`, challenge echo,
 *    exact origin match, crossOrigin false, rpIdHash = SHA-256(rpId),
 *    UP flag required, UV per policy, AT flag required, attestation policy
 *    explicit (`none` only — any other fmt rejected), COSE key restricted to
 *    EC2 / P-256 / ES256; credential id uniqueness enforced by the caller's
 *    INSERT (PK);
 *  - authentication: clientData type `webauthn.get`, challenge echo, exact
 *    origin, crossOrigin false, rpIdHash, UP (+UV per policy), ES256
 *    signature over authenticatorData ‖ SHA-256(clientDataJSON) verified with
 *    the STORED public key, clone-safe counter rule that accepts stable-zero
 *    counters only for backup-eligible (synced) passkeys, userHandle bound to
 *    the stored account;
 *  - nothing session-like is ever issued from this module; routes issue
 *    tokens only after verifyAuthentication/verifyRegistration return ok.
 */

export class WebAuthnError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message || code);
    this.code = code;
  }
}

/* ────────────────────────────── encoding ────────────────────────────── */

export function b64uToBytes(s: string): Uint8Array {
  const b64 = String(s || '').replace(/-/g, '+').replace(/_/g, '/').trim();
  if (!b64) throw new WebAuthnError('WEBAUTHN_MALFORMED', 'empty base64url');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64u(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}

export async function sha256(bytes: Uint8Array | string): Promise<Uint8Array> {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const buf = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  return new Uint8Array(buf);
}

export function timingSafeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/* ────────────────────────────── minimal CBOR ──────────────────────────────
 * Enough for attestation objects and COSE_Key maps (RFC 8949): unsigned/
 * negative ints, byte/text strings, arrays, maps, tags, simple values.
 * Not a general-purpose decoder: depth- and size-bounded. */

type CborValue = number | string | Uint8Array | CborValue[] | Map<CborValue, CborValue> | boolean | null;

function cborDecode(input: Uint8Array): { value: CborValue; offset: number } {
  let o = 0;
  const readArg = (add: number): bigint | number => {
    const ai = add;
    if (ai < 24) return ai;
    if (ai === 24) return input[o++];
    if (ai === 25) { const v = (input[o] << 8) | input[o + 1]; o += 2; return v; }
    if (ai === 26) { const v = ((input[o] * 0x1000000) + ((input[o + 1] << 16) | (input[o + 2] << 8) | input[o + 3])); o += 4; return v; }
    if (ai === 27) { let v = 0n; for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(input[o + i]); o += 8; return v; }
    throw new WebAuthnError('WEBAUTHN_MALFORMED', 'cbor bad additional info');
  };
  const decodeOne = (depth: number): CborValue => {
    if (depth > 8 || o >= input.length) throw new WebAuthnError('WEBAUTHN_MALFORMED', 'cbor depth/length');
    const ib = input[o++];
    const mt = ib >> 5;
    const ai = ib & 31;
    if (mt === 0) return Number(readArg(ai));
    if (mt === 1) { const v = readArg(ai); return -1 - Number(v); }
    if (mt === 2) { const n = Number(readArg(ai)); const v = input.slice(o, o + n); o += n; return v; }
    if (mt === 3) { const n = Number(readArg(ai)); const v = new TextDecoder().decode(input.slice(o, o + n)); o += n; return v; }
    if (mt === 4) { const n = Number(readArg(ai)); const arr: CborValue[] = []; for (let i = 0; i < n; i++) arr.push(decodeOne(depth + 1)); return arr; }
    if (mt === 5) { const n = Number(readArg(ai)); const m = new Map<CborValue, CborValue>(); for (let i = 0; i < n; i++) { const k = decodeOne(depth + 1); const v = decodeOne(depth + 1); m.set(k, v); } return m; }
    if (mt === 6) { readArg(ai); return decodeOne(depth + 1); }
    if (mt === 7) {
      if (ai === 20) return false;
      if (ai === 21) return true;
      if (ai === 22 || ai === 23) return null;
      throw new WebAuthnError('WEBAUTHN_MALFORMED', 'cbor simple/float unsupported');
    }
    throw new WebAuthnError('WEBAUTHN_MALFORMED', 'cbor major type');
  };
  const value = decodeOne(0);
  return { value, offset: o };
}

function mapGet(m: Map<CborValue, CborValue>, key: number | string): CborValue | undefined {
  for (const [k, v] of m) if ((typeof k === 'number' || typeof k === 'string') && k === key) return v;
  return undefined;
}

/* ───────────────────────── authenticator data ───────────────────────── */

export type ParsedAuthData = {
  raw: Uint8Array;
  rpIdHash: Uint8Array;
  flags: number;
  counter: number;
  up: boolean;
  uv: boolean;
  at: boolean;
  be: boolean;
  bs: boolean;
  aaguid?: string;
  credentialId?: string;
  credentialPublicKeyJwk?: { kty: string; crv: string; x: string; y: string; alg: string };
};

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;

export function parseAuthenticatorData(raw: Uint8Array): ParsedAuthData {
  if (raw.length < 37) throw new WebAuthnError('WEBAUTHN_MALFORMED', 'authData too short');
  const rpIdHash = raw.slice(0, 32);
  const flags = raw[32];
  const counter = ((raw[33] << 24) | (raw[34] << 16) | (raw[35] << 8) | raw[36]) >>> 0;
  const out: ParsedAuthData = {
    raw,
    rpIdHash,
    flags,
    counter,
    up: (flags & FLAG_UP) === FLAG_UP,
    uv: (flags & FLAG_UV) === FLAG_UV,
    at: (flags & FLAG_AT) === FLAG_AT,
    be: (flags & FLAG_BE) === FLAG_BE,
    bs: (flags & FLAG_BS) === FLAG_BS,
  };
  if (out.at) {
    if (raw.length < 55) throw new WebAuthnError('WEBAUTHN_MALFORMED', 'authData attested too short');
    out.aaguid = bytesToHex(raw.slice(37, 53));
    const credLen = (raw[53] << 8) | raw[54];
    if (raw.length < 55 + credLen) throw new WebAuthnError('WEBAUTHN_MALFORMED', 'credId truncated');
    const credId = raw.slice(55, 55 + credLen);
    out.credentialId = bytesToB64u(credId);
    const rest = raw.slice(55 + credLen);
    const { value } = cborDecode(rest);
    if (!(value instanceof Map)) throw new WebAuthnError('WEBAUTHN_MALFORMED', 'COSE_Key not a map');
    const kty = mapGet(value, 1);
    const alg = mapGet(value, 3);
    const crv = mapGet(value, -1);
    const x = mapGet(value, -2);
    const y = mapGet(value, -3);
    // Explicit algorithm policy: EC2 + P-256 + ES256 only.
    if (kty !== 2 || alg !== -7 || crv !== 1) {
      throw new WebAuthnError('WEBAUTHN_UNSUPPORTED_ALG', 'only EC2 P-256 ES256 credentials are accepted');
    }
    if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) {
      throw new WebAuthnError('WEBAUTHN_MALFORMED', 'COSE_Key coordinates');
    }
    out.credentialPublicKeyJwk = { kty: 'EC', crv: 'P-256', x: bytesToB64u(x), y: bytesToB64u(y), alg: 'ES256' };
  }
  return out;
}

/* ────────────────────────────── client data ────────────────────────────── */

export type ParsedClientData = { type: string; challenge: string; origin: string; crossOrigin: boolean; androidPackageName: string | null };

export function parseClientData(b64u: string): { json: ParsedClientData; raw: Uint8Array } {
  let raw: Uint8Array;
  let parsed: any;
  try {
    raw = b64uToBytes(b64u);
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new WebAuthnError('WEBAUTHN_MALFORMED_CLIENTDATA', 'clientDataJSON unreadable');
  }
  if (typeof parsed?.type !== 'string' || typeof parsed?.challenge !== 'string' || typeof parsed?.origin !== 'string') {
    throw new WebAuthnError('WEBAUTHN_MALFORMED_CLIENTDATA', 'clientDataJSON missing fields');
  }
  return {
    raw,
    json: {
      type: parsed.type,
      challenge: parsed.challenge,
      origin: parsed.origin,
      crossOrigin: parsed.crossOrigin === true,
      // Native Credential Manager assertions may carry the requesting package.
      androidPackageName: typeof parsed.androidPackageName === 'string' ? parsed.androidPackageName : null,
    },
  };
}

/**
 * Origin acceptance (exact match, allowlist-driven):
 *  - the native Android Credential Manager origin
 *    `android:apk-key-hash-sha256:<base64url(SHA-256(signing-cert DER))>` derived
 *    from WEBAUTHN_ANDROID_CERT_HASH — accepted only when the Android package is
 *    configured (the cert hash IS the Play signing key fingerprint, so this ties
 *    the assertion to the allowlisted APK signature);
 *  - any allowlisted web origin with crossOrigin=false (browser flows);
 *  - an allowlisted web origin with crossOrigin=true ONLY when the Android
 *    integration is configured and clientDataJSON.androidPackageName equals that
 *    package (androidx.credentials lets the app pass the web origin explicitly;
 *    the provider then marks the assertion cross-origin and names the package).
 */
function checkClientData(cd: ParsedClientData, expectedType: string, expectedChallenge: string, policy: WebAuthnPolicy): void {
  if (cd.type !== expectedType) throw new WebAuthnError('WEBAUTHN_BAD_TYPE', `clientData type ${cd.type}`);
  if (!timingSafeEqual(cd.challenge, expectedChallenge)) throw new WebAuthnError('WEBAUTHN_BAD_CHALLENGE', 'clientData challenge mismatch');
  if (matchesAndroidOrigin(cd.origin, policy)) return;
  if (policy.origins.includes(cd.origin)) {
    if (cd.crossOrigin && !(policy.androidPackage && cd.androidPackageName === policy.androidPackage)) {
      throw new WebAuthnError('WEBAUTHN_CROSS_ORIGIN', 'cross-origin assertion');
    }
    return;
  }
  throw new WebAuthnError('WEBAUTHN_BAD_ORIGIN', `origin ${cd.origin}`);
}

/* ────────────────────────────── registration ────────────────────────────── */

export type RegistrationInput = {
  clientDataJSON: string;
  attestationObject: string;
  expectedChallenge: string;
  /** Origin/RP/UV/attestation acceptance comes from the server-side policy. */
  policy: WebAuthnPolicy;
};

export type VerifiedRegistration = {
  credentialId: string;
  publicKeyJwk: { kty: string; crv: string; x: string; y: string; alg: string };
  counter: number;
  backupEligible: boolean;
  backupState: boolean;
  aaguid: string;
  fmt: string;
};

export async function verifyRegistration(input: RegistrationInput): Promise<VerifiedRegistration> {
  const cd = parseClientData(input.clientDataJSON);
  checkClientData(cd.json, 'webauthn.create', input.expectedChallenge, input.policy);

  let att: any;
  try {
    att = cborDecode(b64uToBytes(input.attestationObject)).value;
  } catch (e) {
    if (e instanceof WebAuthnError && e.code === 'WEBAUTHN_MALFORMED') throw e;
    throw new WebAuthnError('WEBAUTHN_MALFORMED', 'attestationObject unreadable');
  }
  if (!(att instanceof Map)) throw new WebAuthnError('WEBAUTHN_MALFORMED', 'attestationObject not a map');
  const fmt = mapGet(att, 'fmt');
  const authDataRaw = mapGet(att, 'authData');
  // Explicit attestation policy: `none` only. Anything else (packed/fido-u2f/…)
  // is rejected rather than half-verified.
  if (input.policy.attestation === 'none' && fmt !== 'none') {
    throw new WebAuthnError('WEBAUTHN_BAD_ATTESTATION', `fmt ${String(fmt)} not allowed by policy`);
  }
  if (!(authDataRaw instanceof Uint8Array)) throw new WebAuthnError('WEBAUTHN_MALFORMED', 'authData missing');

  const ad = parseAuthenticatorData(authDataRaw);
  const rpIdHash = await sha256(input.policy.rpId);
  if (bytesToHex(ad.rpIdHash) !== bytesToHex(rpIdHash)) throw new WebAuthnError('WEBAUTHN_BAD_RPID', 'rpIdHash mismatch');
  if (!ad.up) throw new WebAuthnError('WEBAUTHN_MISSING_FLAGS', 'UP flag required');
  if (input.policy.requireUV && !ad.uv) throw new WebAuthnError('WEBAUTHN_MISSING_FLAGS', 'UV flag required by policy');
  if (!ad.at || !ad.credentialId || !ad.credentialPublicKeyJwk) {
    throw new WebAuthnError('WEBAUTHN_MALFORMED', 'attested credential data missing');
  }
  return {
    credentialId: ad.credentialId,
    publicKeyJwk: ad.credentialPublicKeyJwk,
    counter: ad.counter,
    backupEligible: ad.be,
    backupState: ad.bs,
    aaguid: ad.aaguid || '',
    fmt: String(fmt),
  };
}

/* ────────────────────────────── authentication ────────────────────────────── */

export type AuthenticationInput = {
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  userHandle?: string;
  expectedChallenge: string;
  /** Origin/RP/UV acceptance comes from the server-side policy. */
  policy: WebAuthnPolicy;
  stored: {
    publicKeyJwk: { kty: string; crv: string; x: string; y: string; alg: string };
    counter: number;
    backupEligible: boolean;
    userHandle: string;
  };
};

export type VerifiedAuthentication = { counter: number; backupState: boolean; uv: boolean };

export async function verifyAuthentication(input: AuthenticationInput): Promise<VerifiedAuthentication> {
  const cd = parseClientData(input.clientDataJSON);
  checkClientData(cd.json, 'webauthn.get', input.expectedChallenge, input.policy);

  const ad = parseAuthenticatorData(b64uToBytes(input.authenticatorData));
  const rpIdHash = await sha256(input.policy.rpId);
  if (bytesToHex(ad.rpIdHash) !== bytesToHex(rpIdHash)) throw new WebAuthnError('WEBAUTHN_BAD_RPID', 'rpIdHash mismatch');
  if (!ad.up) throw new WebAuthnError('WEBAUTHN_MISSING_FLAGS', 'UP flag required');
  if (input.policy.requireUV && !ad.uv) throw new WebAuthnError('WEBAUTHN_MISSING_FLAGS', 'UV flag required by policy');

  if (input.userHandle !== undefined && input.userHandle !== '') {
    if (!timingSafeEqual(String(input.userHandle), input.stored.userHandle)) {
      throw new WebAuthnError('WEBAUTHN_WRONG_ACCOUNT', 'userHandle does not match the credential account');
    }
  }

  // Signature over authenticatorData ‖ SHA-256(clientDataJSON), ES256.
  const clientHash = await sha256(cd.raw);
  const signed = new Uint8Array(ad.raw.length + clientHash.length);
  signed.set(ad.raw, 0);
  signed.set(clientHash, ad.raw.length);
  const jwk = input.stored.publicKeyJwk;
  if (!jwk || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || jwk.alg !== 'ES256') {
    throw new WebAuthnError('WEBAUTHN_UNSUPPORTED_ALG', 'stored key is not ES256 P-256');
  }
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true } as JsonWebKey,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
  } catch {
    throw new WebAuthnError('WEBAUTHN_BAD_KEY', 'stored public key unusable');
  }
  let sig: Uint8Array;
  try {
    sig = b64uToBytes(input.signature);
  } catch {
    throw new WebAuthnError('WEBAUTHN_BAD_SIGNATURE', 'signature not base64url');
  }
  const ok = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    sig as unknown as BufferSource,
    signed as unknown as BufferSource,
  );
  if (!ok) throw new WebAuthnError('WEBAUTHN_BAD_SIGNATURE', 'signature verification failed');

  // Clone detection: counters must advance, except synced passkeys
  // (backup-eligible) which legitimately keep a zero counter.
  const stored = Number(input.stored.counter || 0);
  const next = ad.counter;
  if (!(next > stored)) {
    const syncedZero = input.stored.backupEligible && next === 0 && stored === 0;
    if (!syncedZero) throw new WebAuthnError('WEBAUTHN_COUNTER', 'signature counter did not advance (possible clone)');
  }
  return { counter: next, backupState: ad.bs, uv: ad.uv };
}

/* ────────────────────────────── challenges ────────────────────────────── */

export type ChallengePurpose = 'register' | 'login';

export type ChallengeRow = {
  id: string;
  challenge: string;
  purpose: ChallengePurpose;
  username: string;
  rp_id: string;
  origin: string;
  expires_at: string;
};

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

/** Unpredictable, purpose-bound, account/RP/origin-bound, 5-minute challenge. */
export async function createChallenge(
  db: D1Database,
  opts: { purpose: ChallengePurpose; username: string; rpId: string; origin: string; ttlMs?: number },
): Promise<string> {
  const challenge = bytesToB64u(randomBytes(32));
  const id = bytesToB64u(randomBytes(16));
  const expiresAt = new Date(Date.now() + (opts.ttlMs ?? 5 * 60 * 1000)).toISOString();
  await db
    .prepare(
      `INSERT INTO webauthn_challenges (id, challenge, fingerprint, purpose, username, rp_id, origin, expires_at, consumed)
       VALUES (?, ?, '', ?, ?, ?, ?, ?, 0)`,
    )
    .bind(id, challenge, opts.purpose, String(opts.username || '').toLowerCase(), opts.rpId, opts.origin, expiresAt)
    .run();
  return challenge;
}

/**
 * Atomic single use: the conditional UPDATE is the lock — two concurrent
 * verifies can never both see changes=1. Returns the consumed row context or
 * null when expired / replayed / mismatched.
 */
export async function consumeChallenge(
  db: D1Database,
  opts: { challenge: string; purpose: ChallengePurpose; rpId: string; origin: string; username?: string },
): Promise<{ username: string } | null> {
  const now = new Date().toISOString();
  if (opts.username !== undefined) {
    const username = String(opts.username || '').toLowerCase();
    const res = await db
      .prepare(
        `UPDATE webauthn_challenges SET consumed = 1, consumed_at = ?6
         WHERE purpose = ?1 AND rp_id = ?2 AND origin = ?3 AND challenge = ?4
           AND lower(username) = ?5 AND consumed = 0 AND expires_at > ?6`,
      )
      .bind(opts.purpose, opts.rpId, opts.origin, opts.challenge, username, now)
      .run();
    if (Number((res as any)?.meta?.changes ?? 0) !== 1) return null;
    return { username };
  }
  const res = await db
    .prepare(
      `UPDATE webauthn_challenges SET consumed = 1, consumed_at = ?5
       WHERE purpose = ?1 AND rp_id = ?2 AND origin = ?3 AND challenge = ?4
         AND consumed = 0 AND expires_at > ?5`,
    )
    .bind(opts.purpose, opts.rpId, opts.origin, opts.challenge, now)
    .run();
  if (Number((res as any)?.meta?.changes ?? 0) !== 1) return null;
  // Discoverable login: read back the bound username (row already consumed).
  const row = await db
    .prepare(`SELECT username FROM webauthn_challenges WHERE challenge = ? AND purpose = ? LIMIT 1`)
    .bind(opts.challenge, opts.purpose)
    .first() as any;
  return { username: String(row?.username || '').toLowerCase() };
}

/** Opaque, stable per-account user handle (never the raw username on the wire). */
export async function userHandleFor(username: string): Promise<string> {
  const h = await sha256(`atlas-wa-v1|${String(username || '').toLowerCase()}`);
  return bytesToB64u(h.slice(0, 16));
}

/* ────────────────────────────── policy ────────────────────────────── */

export type WebAuthnPolicy = {
  enabled: boolean;
  rpId: string;
  rpName: string;
  origins: string[];
  requireUV: boolean;
  attestation: 'none';
  androidPackage: string;
  androidCertHash: string;
  /** v0.7 — ALL accepted SHA-256 signing fingerprints (comma-separated env). */
  androidCertHashes: string[];
  /** Optional SHA-1 fingerprint — legacy `android:apk-key-hash:` origin format. */
  androidCertSha1: string;
};

export function policyFromEnv(env: Record<string, string | undefined>): WebAuthnPolicy {
  const origins = String(env.WEBAUTHN_ALLOWED_ORIGINS || 'https://stock.afmarbre.com')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    enabled: String(env.WEBAUTHN_ENABLED || 'false').toLowerCase() === 'true',
    rpId: String(env.WEBAUTHN_RP_ID || 'stock.afmarbre.com').trim(),
    rpName: String(env.WEBAUTHN_RP_NAME || 'Atlas Commerce').trim(),
    origins,
    requireUV: String(env.WEBAUTHN_REQUIRE_UV || 'required').toLowerCase() !== 'preferred',
    attestation: 'none',
    androidPackage: String(env.WEBAUTHN_ANDROID_PACKAGE || '').trim(),
    androidCertHash: (
      String(env.WEBAUTHN_ANDROID_CERT_HASH || '')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)[0] || ''
    ),
    androidCertHashes: String(env.WEBAUTHN_ANDROID_CERT_HASH || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),
    androidCertSha1: String(env.WEBAUTHN_ANDROID_CERT_SHA1 || '').trim().toUpperCase(),
  };
}

/** The canonical web origin of this deployment (first allowlisted entry). */
export function expectedOrigin(policy: WebAuthnPolicy): string {
  return policy.origins[0] || 'https://stock.afmarbre.com';
}

/** Fingerprint hex (colon-separated or plain) → raw bytes, or null. */
function certHashBytes(hex: string, hexLen: number): Uint8Array | null {
  const h = String(hex || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (h.length !== hexLen) return null;
  const bytes = new Uint8Array(hexLen / 2);
  for (let i = 0; i < hexLen / 2; i++) bytes[i] = Number.parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Decode base64 tolerantly: url-safe or standard alphabet, padded or not. */
function b64DecodeLoose(value: string): Uint8Array | null {
  try {
    return b64uToBytes(String(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
  } catch {
    return null;
  }
}

/**
 * Native Android Credential Manager origin for a signing-cert SHA-256
 * fingerprint: `android:apk-key-hash-sha256:<base64url(fingerprint bytes)>`
 * (the fingerprint IS sha256(cert DER), per the WebAuthn origin format).
 * Accepts colon-separated or plain hex; returns null when malformed.
 */
export function androidOriginFromCertHash(certHash: string): string | null {
  const bytes = certHashBytes(certHash, 64);
  return bytes ? `android:apk-key-hash-sha256:${bytesToB64u(bytes)}` : null;
}

/**
 * Legacy FIDO2/GMS origin format documented by Android:
 * `android:apk-key-hash:<base64(SHA-1(signing cert DER))>` — derived from the
 * optional WEBAUTHN_ANDROID_CERT_SHA1 fingerprint.
 */
export function androidLegacyOriginFromSha1(sha1Hex: string): string | null {
  const bytes = certHashBytes(sha1Hex, 40);
  return bytes ? `android:apk-key-hash:${bytesToB64u(bytes)}` : null;
}

/** The primary (sha256) android origin accepted, or null when not configured. */
export function androidOrigin(policy: WebAuthnPolicy): string | null {
  if (!policy.androidPackage || !policy.androidCertHash) return null;
  return androidOriginFromCertHash(policy.androidCertHash);
}

/**
 * v0.7 — credential descriptors for excludeCredentials (register) and
 * allowCredentials (login): ONLY rows that still carry stored verification
 * material (public_key_jwk). Legacy pre-v259 rows without a public key can
 * never pass verification, so they must not block re-registration — and no
 * row is ever deleted here. Single source of truth for both options routes.
 */
export async function credentialDescriptors(
  db: { prepare: (sql: string) => any },
  username: string,
): Promise<{ type: 'public-key'; id: string; transports: string[] }[]> {
  const q = await db
    .prepare(
      `SELECT id, transports FROM webauthn_credentials
       WHERE lower(username) = ?
         AND COALESCE(public_key_jwk, '') != ''`,
    )
    .bind(String(username || '').toLowerCase())
    .all();
  return ((q?.results || []) as any[]).map((r: any) => ({
    type: 'public-key' as const,
    id: String(r.id),
    transports: String(r.transports || '').split(',').filter(Boolean),
  }));
}

/** v0.7 — every accepted sha256 android origin (one per configured fingerprint). */
export function androidOrigins(policy: WebAuthnPolicy): string[] {
  if (!policy.androidPackage) return [];
  return policy.androidCertHashes
    .map((h) => androidOriginFromCertHash(h))
    .filter((o): o is string => !!o);
}

/** The legacy (sha1) android origin accepted, or null when not configured. */
export function androidLegacyOrigin(policy: WebAuthnPolicy): string | null {
  if (!policy.androidPackage || !policy.androidCertSha1) return null;
  return androidLegacyOriginFromSha1(policy.androidCertSha1);
}

/**
 * Byte-level acceptance of BOTH documented native origin formats — string
 * comparison alone is not enough: Android docs reference `android:apk-key-hash:`
 * (SHA-1) while Credential Manager emits `android:apk-key-hash-sha256:`, and
 * encodings differ (base64 vs base64url, padding). We decode the suffix and
 * compare RAW BYTES against the configured fingerprints, so any encoding of the
 * correct hash matches — and only the correct hash matches.
 */
export function matchesAndroidOrigin(origin: string, policy: WebAuthnPolicy): boolean {
  if (!policy.androidPackage || typeof origin !== 'string') return false;
  const P256 = 'android:apk-key-hash-sha256:';
  const P1 = 'android:apk-key-hash:';
  if (origin.startsWith(P256)) {
    const got = b64DecodeLoose(origin.slice(P256.length));
    if (!got || got.length !== 32) return false;
    // v0.7 — any configured signing fingerprint matches (Play + release keys).
    return policy.androidCertHashes.some((h) => {
      const expected = certHashBytes(h, 64);
      return !!expected && bytesToHex(got) === bytesToHex(expected);
    });
  }
  if (origin.startsWith(P1)) {
    const expected = certHashBytes(policy.androidCertSha1, 40);
    const got = b64DecodeLoose(origin.slice(P1.length));
    return !!expected && !!got && got.length === 20 && bytesToHex(got) === bytesToHex(expected);
  }
  return false;
}
