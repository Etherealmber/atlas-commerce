/**
 * v259 — WebAuthn verifier test suite.
 *
 * Exercises the REAL cryptographic paths in worker/lib/webauthn.ts with live
 * ES256 key material (node WebCrypto): valid registration/authentication and
 * rejection of every tamper class the task lists (signature, origin, RP id,
 * credential/account binding, challenge expiry & replay, flags, malformed
 * client data), plus challenge atomicity and policy defaults.
 */
import { describe, it, expect, beforeEach } from 'vitest';

const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };

import {
  WebAuthnError,
  androidLegacyOrigin,
  androidLegacyOriginFromSha1,
  androidOrigin,
  androidOriginFromCertHash,
  androidOrigins,
  credentialDescriptors,
  matchesAndroidOrigin,
  b64uToBytes,
  bytesToB64u,
  consumeChallenge,
  createChallenge,
  expectedOrigin,
  parseAuthenticatorData,
  policyFromEnv,
  sha256,
  userHandleFor,
  verifyAuthentication,
  verifyRegistration,
  type WebAuthnPolicy,
} from '../lib/webauthn';

/* ─────────────────────────── tiny CBOR encoder (test-only) ─────────────────────────── */

function head(major: number, n: number): number[] {
  if (n < 24) return [(major << 5) | n];
  if (n < 256) return [(major << 5) | 24, n];
  if (n < 65536) return [(major << 5) | 25, (n >> 8) & 255, n & 255];
  return [(major << 5) | 26, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}
const cborBytes = (b: Uint8Array) => Uint8Array.from([...head(2, b.length), ...b]);
const cborText = (s: string) => { const u = new TextEncoder().encode(s); return Uint8Array.from([...head(3, u.length), ...u]); };
const cborUInt = (n: number) => Uint8Array.from(head(0, n));
const cborNInt = (n: number) => Uint8Array.from(head(1, -1 - n));
function cborMap(pairs: [Uint8Array, Uint8Array][]): Uint8Array {
  const out: number[] = head(5, pairs.length);
  for (const [k, v] of pairs) out.push(...k, ...v);
  return Uint8Array.from(out);
}
const concat = (...parts: Uint8Array[]) => {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

/* ─────────────────────────── fixtures ─────────────────────────── */

const RP_ID = 'stock.afmarbre.com';
const ORIGIN = 'https://stock.afmarbre.com';
const ANDROID_PACKAGE = 'ma.etherealmber.atlascommerce';
/** Deterministic stand-in for the Play app-signing SHA-256 fingerprint. */
const CERT_HEX = '9F:86:D0:81:88:4C:7D:65:9A:2F:EA:A0:C5:5A:D0:15:A3:BF:4F:1B:2B:0B:82:2C:D1:5D:6C:15:B0:F0:0A:08';
const POLICY: WebAuthnPolicy = policyFromEnv({ WEBAUTHN_ENABLED: 'true' });
const POLICY_ANDROID: WebAuthnPolicy = policyFromEnv({
  WEBAUTHN_ENABLED: 'true',
  WEBAUTHN_ANDROID_PACKAGE: ANDROID_PACKAGE,
  WEBAUTHN_ANDROID_CERT_HASH: CERT_HEX,
});
/** Deterministic stand-in for the SHA-1 fingerprint of the same signing cert. */
const CERT_SHA1_HEX = '2A:E2:D3:0F:8B:1C:47:9D:6E:5A:03:F8:14:7C:B9:22:90:1D:EE:F3';
const POLICY_ANDROID_BOTH: WebAuthnPolicy = policyFromEnv({
  WEBAUTHN_ENABLED: 'true',
  WEBAUTHN_ANDROID_PACKAGE: ANDROID_PACKAGE,
  WEBAUTHN_ANDROID_CERT_HASH: CERT_HEX,
  WEBAUTHN_ANDROID_CERT_SHA1: CERT_SHA1_HEX,
});

type KeyMaterial = { priv: CryptoKey; pub: CryptoKey; jwk: JsonWebKey };

async function makeKey(): Promise<KeyMaterial> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  return { priv: kp.privateKey, pub: kp.publicKey, jwk };
}

function coseKey(jwk: JsonWebKey): Uint8Array {
  return cborMap([
    [cborUInt(1), cborUInt(2)],          // kty: EC2
    [cborUInt(3), cborNInt(-7)],         // alg: ES256
    [cborNInt(-1), cborUInt(1)],         // crv: P-256
    [cborNInt(-2), cborBytes(b64uToBytes(String(jwk.x)))],
    [cborNInt(-3), cborBytes(b64uToBytes(String(jwk.y)))],
  ]);
}

async function buildAuthData(opts: {
  rpId?: string;
  up?: boolean;
  uv?: boolean;
  be?: boolean;
  counter?: number;
  credId?: Uint8Array;
  cose?: Uint8Array;
}): Promise<Uint8Array> {
  const rpIdHash = await sha256(opts.rpId ?? RP_ID);
  let flags = 0;
  if (opts.up !== false) flags |= 0x01;
  if (opts.uv !== false) flags |= 0x04;
  if (opts.be) flags |= 0x08;
  if (opts.cose) flags |= 0x40;
  const counter = opts.counter ?? 0;
  const base = concat(rpIdHash, Uint8Array.from([flags, (counter >>> 24) & 255, (counter >>> 16) & 255, (counter >>> 8) & 255, counter & 255]));
  if (!opts.cose) return base;
  const credId = opts.credId ?? crypto.getRandomValues(new Uint8Array(32));
  const aaguid = new Uint8Array(16);
  return concat(base, aaguid, Uint8Array.from([(credId.length >> 8) & 255, credId.length & 255]), credId, opts.cose);
}

function clientDataB64(type: string, challenge: string, origin: string, crossOrigin = false, androidPackageName?: string): string {
  const json = JSON.stringify(androidPackageName
    ? { type, challenge, origin, crossOrigin, androidPackageName }
    : { type, challenge, origin, crossOrigin });
  return bytesToB64u(new TextEncoder().encode(json));
}

function attestationObjectB64(authData: Uint8Array, fmt = 'none'): string {
  const obj = cborMap([
    [cborText('fmt'), cborText(fmt)],
    [cborText('attStmt'), cborMap([])],
    [cborText('authData'), cborBytes(authData)],
  ]);
  return bytesToB64u(obj);
}

async function signEs256(priv: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, data as unknown as BufferSource);
  return new Uint8Array(sig);
}

/* ─────────────────────────── D1 shim for challenge tests ─────────────────────────── */

function makeD1() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE webauthn_challenges (
      id TEXT PRIMARY KEY, challenge TEXT NOT NULL, fingerprint TEXT DEFAULT '',
      purpose TEXT NOT NULL, username TEXT DEFAULT '', rp_id TEXT DEFAULT '',
      origin TEXT DEFAULT '', expires_at TEXT NOT NULL,
      consumed INTEGER DEFAULT 0, consumed_at TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  const db = {
    prepare(sql: string) {
      let params: any[] = [];
      const api: any = {
        bind(...p: any[]) { params = p; return api; },
        async run() {
          const r = sqlite.prepare(sql).run(...(params as any));
          return { success: true, meta: { changes: Number(r.changes || 0), last_row_id: Number(r.lastInsertRowid || 0) } };
        },
        async first() { return sqlite.prepare(sql).get(...(params as any)) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...(params as any)) }; },
      };
      return api;
    },
  };
  return db as unknown as D1Database;
}

/* ─────────────────────────── registration ─────────────────────────── */

describe('webauthn registration verification', () => {
  let key: KeyMaterial;
  let challenge: string;
  let credId: Uint8Array;

  beforeEach(async () => {
    key = await makeKey();
    challenge = bytesToB64u(crypto.getRandomValues(new Uint8Array(32)));
    credId = crypto.getRandomValues(new Uint8Array(32));
  });

  async function register(over: { origin?: string; challenge?: string; rpId?: string; up?: boolean; uv?: boolean; fmt?: string; clientData?: string; crossOrigin?: boolean; pkg?: string; policy?: WebAuthnPolicy } = {}) {
    const authData = await buildAuthData({ rpId: over.rpId, up: over.up, uv: over.uv, credId, cose: coseKey(key.jwk) });
    return verifyRegistration({
      clientDataJSON: over.clientData ?? clientDataB64('webauthn.create', over.challenge ?? challenge, over.origin ?? ORIGIN, over.crossOrigin ?? false, over.pkg),
      attestationObject: attestationObjectB64(authData, over.fmt),
      expectedChallenge: challenge,
      policy: over.policy ?? POLICY,
    });
  }

  it('accepts a valid ES256 registration and extracts the credential', async () => {
    const v = await register();
    expect(v.credentialId).toBe(bytesToB64u(credId));
    expect(v.publicKeyJwk.alg).toBe('ES256');
    expect(v.publicKeyJwk.x).toBe(key.jwk.x);
    expect(v.fmt).toBe('none');
    expect(v.backupEligible).toBe(false);
  });

  it('rejects a wrong origin', async () => {
    await expect(register({ origin: 'https://evil.example' })).rejects.toMatchObject({ code: 'WEBAUTHN_BAD_ORIGIN' });
  });

  it('rejects a mismatched challenge in clientData', async () => {
    await expect(register({ challenge: bytesToB64u(new Uint8Array(32)) })).rejects.toMatchObject({ code: 'WEBAUTHN_BAD_CHALLENGE' });
  });

  it('rejects a wrong RP id hash', async () => {
    await expect(register({ rpId: 'evil.afmarbre.com' })).rejects.toMatchObject({ code: 'WEBAUTHN_BAD_RPID' });
  });

  it('rejects missing UP flag', async () => {
    await expect(register({ up: false })).rejects.toMatchObject({ code: 'WEBAUTHN_MISSING_FLAGS' });
  });

  it('rejects missing UV flag when policy requires it', async () => {
    await expect(register({ uv: false })).rejects.toMatchObject({ code: 'WEBAUTHN_MISSING_FLAGS' });
  });

  it('rejects attestation formats outside the explicit policy', async () => {
    await expect(register({ fmt: 'packed' })).rejects.toMatchObject({ code: 'WEBAUTHN_BAD_ATTESTATION' });
  });

  it('rejects malformed clientDataJSON', async () => {
    await expect(register({ clientData: bytesToB64u(new TextEncoder().encode('{not json')) })).rejects.toMatchObject({ code: 'WEBAUTHN_MALFORMED_CLIENTDATA' });
  });

  it('rejects cross-origin clientData', async () => {
    const cd = clientDataB64('webauthn.create', challenge, ORIGIN, true);
    await expect(register({ clientData: cd })).rejects.toMatchObject({ code: 'WEBAUTHN_CROSS_ORIGIN' });
  });
});

/* ─────────────────────────── authentication ─────────────────────────── */

describe('webauthn authentication verification', () => {
  let key: KeyMaterial;
  let challenge: string;
  let storedJwk: any;
  let userHandle: string;

  beforeEach(async () => {
    key = await makeKey();
    storedJwk = { kty: 'EC', crv: 'P-256', x: key.jwk.x, y: key.jwk.y, alg: 'ES256' };
    userHandle = await userHandleFor('yasmine');
    challenge = bytesToB64u(crypto.getRandomValues(new Uint8Array(32)));
  });

  async function authenticate(over: {
    origin?: string; challenge?: string; rpId?: string; up?: boolean; uv?: boolean;
    counter?: number; storedCounter?: number; backupEligible?: boolean;
    userHandle?: string; tamperSig?: boolean; wrongKey?: boolean;
    crossOrigin?: boolean; pkg?: string; policy?: WebAuthnPolicy;
  } = {}) {
    const authData = await buildAuthData({ rpId: over.rpId, up: over.up, uv: over.uv, be: over.backupEligible, counter: over.counter ?? 1 });
    const cd = clientDataB64('webauthn.get', over.challenge ?? challenge, over.origin ?? ORIGIN, over.crossOrigin ?? false, over.pkg);
    const cdRaw = b64uToBytes(cd);
    const clientHash = await sha256(cdRaw);
    let sig = await signEs256(key.priv, concat(authData, clientHash));
    if (over.tamperSig) sig[10] ^= 0xff;
    const signer = over.wrongKey ? await makeKey() : null;
    if (signer) sig = await signEs256(signer.priv, concat(authData, clientHash));
    return verifyAuthentication({
      clientDataJSON: cd,
      authenticatorData: bytesToB64u(authData),
      signature: bytesToB64u(sig),
      userHandle: over.userHandle,
      expectedChallenge: challenge,
      policy: over.policy ?? POLICY,
      stored: {
        publicKeyJwk: storedJwk,
        counter: over.storedCounter ?? 0,
        backupEligible: over.backupEligible ?? false,
        userHandle,
      },
    });
  }

  it('accepts a valid assertion and advances the counter', async () => {
    const v = await authenticate({ counter: 4, storedCounter: 3 });
    expect(v.counter).toBe(4);
    expect(v.uv).toBe(true);
  });

  it('accepts stable-zero counters only for backup-eligible (synced) passkeys', async () => {
    await expect(authenticate({ counter: 0, storedCounter: 0, backupEligible: true })).resolves.toMatchObject({ counter: 0 });
    await expect(authenticate({ counter: 0, storedCounter: 0, backupEligible: false })).rejects.toMatchObject({ code: 'WEBAUTHN_COUNTER' });
  });

  it('rejects a tampered signature', async () => {
    await expect(authenticate({ tamperSig: true, counter: 2 })).rejects.toMatchObject({ code: 'WEBAUTHN_BAD_SIGNATURE' });
  });

  it('rejects a signature from another key (wrong credential material)', async () => {
    await expect(authenticate({ wrongKey: true, counter: 2 })).rejects.toMatchObject({ code: 'WEBAUTHN_BAD_SIGNATURE' });
  });

  it('rejects wrong origin and wrong RP id', async () => {
    await expect(authenticate({ origin: 'https://phish.example', counter: 2 })).rejects.toMatchObject({ code: 'WEBAUTHN_BAD_ORIGIN' });
    await expect(authenticate({ rpId: 'other.example.com', counter: 2 })).rejects.toMatchObject({ code: 'WEBAUTHN_BAD_RPID' });
  });

  it('rejects a stale / non-advancing counter (clone detection)', async () => {
    await expect(authenticate({ counter: 3, storedCounter: 3 })).rejects.toMatchObject({ code: 'WEBAUTHN_COUNTER' });
  });

  it('rejects a userHandle from another account', async () => {
    const other = await userHandleFor('someone-else');
    await expect(authenticate({ userHandle: other, counter: 2 })).rejects.toMatchObject({ code: 'WEBAUTHN_WRONG_ACCOUNT' });
  });

  it('rejects missing flags and replayed/mismatched challenge', async () => {
    await expect(authenticate({ up: false, counter: 2 })).rejects.toMatchObject({ code: 'WEBAUTHN_MISSING_FLAGS' });
    await expect(authenticate({ uv: false, counter: 2 })).rejects.toMatchObject({ code: 'WEBAUTHN_MISSING_FLAGS' });
    await expect(authenticate({ challenge: bytesToB64u(new Uint8Array(32)), counter: 2 })).rejects.toMatchObject({ code: 'WEBAUTHN_BAD_CHALLENGE' });
  });

  it('parses authenticator data flags correctly', async () => {
    const ad = await buildAuthData({ up: true, uv: false, counter: 7 });
    const p = parseAuthenticatorData(ad);
    expect(p.up).toBe(true);
    expect(p.uv).toBe(false);
    expect(p.counter).toBe(7);
  });
});

/* ─────────────────────────── challenges ─────────────────────────── */

describe('webauthn challenge lifecycle', () => {
  let db: D1Database;
  beforeEach(() => { db = makeD1(); });

  it('consumes a challenge exactly once (atomic single use)', async () => {
    const ch = await createChallenge(db, { purpose: 'register', username: 'Yasmine', rpId: RP_ID, origin: ORIGIN });
    const first = await consumeChallenge(db, { challenge: ch, purpose: 'register', rpId: RP_ID, origin: ORIGIN, username: 'yasmine' });
    expect(first?.username).toBe('yasmine');
    const replay = await consumeChallenge(db, { challenge: ch, purpose: 'register', rpId: RP_ID, origin: ORIGIN, username: 'yasmine' });
    expect(replay).toBeNull();
  });

  it('rejects expired challenges', async () => {
    const ch = await createChallenge(db, { purpose: 'login', username: '', rpId: RP_ID, origin: ORIGIN, ttlMs: -1000 });
    expect(await consumeChallenge(db, { challenge: ch, purpose: 'login', rpId: RP_ID, origin: ORIGIN })).toBeNull();
  });

  it('is purpose-bound: a login challenge cannot finish a registration', async () => {
    const ch = await createChallenge(db, { purpose: 'login', username: '', rpId: RP_ID, origin: ORIGIN });
    expect(await consumeChallenge(db, { challenge: ch, purpose: 'register', rpId: RP_ID, origin: ORIGIN, username: 'x' })).toBeNull();
  });

  it('is account-bound: another username cannot consume it', async () => {
    const ch = await createChallenge(db, { purpose: 'register', username: 'alice', rpId: RP_ID, origin: ORIGIN });
    expect(await consumeChallenge(db, { challenge: ch, purpose: 'register', rpId: RP_ID, origin: ORIGIN, username: 'mallory' })).toBeNull();
  });

  it('is RP/origin-bound', async () => {
    const ch = await createChallenge(db, { purpose: 'login', username: '', rpId: RP_ID, origin: ORIGIN });
    expect(await consumeChallenge(db, { challenge: ch, purpose: 'login', rpId: 'evil.example', origin: ORIGIN })).toBeNull();
    expect(await consumeChallenge(db, { challenge: ch, purpose: 'login', rpId: RP_ID, origin: 'https://evil.example' })).toBeNull();
  });

  it('generates unpredictable, unique challenges', async () => {
    const a = await createChallenge(db, { purpose: 'login', username: '', rpId: RP_ID, origin: ORIGIN });
    const b = await createChallenge(db, { purpose: 'login', username: '', rpId: RP_ID, origin: ORIGIN });
    expect(a).not.toBe(b);
    expect(b64uToBytes(a).length).toBe(32);
  });
});

/* ─────────────────────────── policy & handles ─────────────────────────── */

describe('webauthn policy + handles', () => {
  it('is DISABLED by default (passkeys stay off until configured)', () => {
    const p = policyFromEnv({});
    expect(p.enabled).toBe(false);
    expect(p.attestation).toBe('none');
    expect(p.requireUV).toBe(true);
    expect(expectedOrigin(p)).toBe('https://stock.afmarbre.com');
  });

  it('parses explicit configuration', () => {
    const p = policyFromEnv({
      WEBAUTHN_ENABLED: 'true',
      WEBAUTHN_RP_ID: 'example.com',
      WEBAUTHN_ALLOWED_ORIGINS: 'https://example.com, https://www.example.com',
      WEBAUTHN_REQUIRE_UV: 'preferred',
      WEBAUTHN_ANDROID_PACKAGE: 'ma.etherealmber.atlascommerce',
      WEBAUTHN_ANDROID_CERT_HASH: 'aa:bb',
    });
    expect(p.enabled).toBe(true);
    expect(p.origins).toHaveLength(2);
    expect(p.requireUV).toBe(false);
    expect(p.androidPackage).toBe('ma.etherealmber.atlascommerce');
  });

  it('user handles are stable per account and opaque', async () => {
    const a1 = await userHandleFor('Yasmine');
    const a2 = await userHandleFor('yasmine');
    const b = await userHandleFor('ali');
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1).not.toContain('yasmine');
  });
});

/* ─────────── android credential manager origin integration (v259.1) ─────────── */

describe('android credential manager integration', () => {
  it('derives the apk-key-hash-sha256 origin from the signing-cert fingerprint', () => {
    const o = androidOriginFromCertHash(CERT_HEX)!;
    expect(o).toBe(androidOriginFromCertHash(CERT_HEX.replace(/:/g, '').toLowerCase())!);
    expect(o.startsWith('android:apk-key-hash-sha256:')).toBe(true);
    const bytes = Uint8Array.from((CERT_HEX.replace(/:/g, '').match(/../g) as string[]).map((h) => Number.parseInt(h, 16)));
    expect(o).toBe(`android:apk-key-hash-sha256:${bytesToB64u(bytes)}`);
    expect(androidOriginFromCertHash('not-a-hash')).toBeNull();
    expect(androidOriginFromCertHash('')).toBeNull();
  });

  it('androidOrigin is null unless package AND cert hash are configured', () => {
    expect(androidOrigin(POLICY)).toBeNull();
    expect(androidOrigin(POLICY_ANDROID)).toBe(androidOriginFromCertHash(CERT_HEX));
  });

  it('accepts a native registration from the configured apk-key-hash origin', async () => {
    const key = await makeKey();
    const challenge = bytesToB64u(crypto.getRandomValues(new Uint8Array(32)));
    const credId = crypto.getRandomValues(new Uint8Array(32));
    const authData = await buildAuthData({ rpId: RP_ID, credId, cose: coseKey(key.jwk) });
    const v = await verifyRegistration({
      clientDataJSON: clientDataB64('webauthn.create', challenge, androidOrigin(POLICY_ANDROID)!, true),
      attestationObject: attestationObjectB64(authData),
      expectedChallenge: challenge,
      policy: POLICY_ANDROID,
    });
    expect(v.credentialId).toBe(bytesToB64u(credId));
    expect(v.publicKeyJwk.alg).toBe('ES256');
  });

  it('accepts the web origin cross-origin ONLY when clientData names the configured package', async () => {
    const key = await makeKey();
    const challenge = bytesToB64u(crypto.getRandomValues(new Uint8Array(32)));
    const credId = crypto.getRandomValues(new Uint8Array(32));
    const authData = await buildAuthData({ rpId: RP_ID, credId, cose: coseKey(key.jwk) });
    const base = { attestationObject: attestationObjectB64(authData), expectedChallenge: challenge };
    await expect(verifyRegistration({
      ...base,
      clientDataJSON: clientDataB64('webauthn.create', challenge, ORIGIN, true, ANDROID_PACKAGE),
      policy: POLICY_ANDROID,
    })).resolves.toBeTruthy();
    // same clientData, android integration NOT configured → cross-origin rejected
    await expect(verifyRegistration({
      ...base,
      clientDataJSON: clientDataB64('webauthn.create', challenge, ORIGIN, true, ANDROID_PACKAGE),
      policy: POLICY,
    })).rejects.toMatchObject({ code: 'WEBAUTHN_CROSS_ORIGIN' });
    // a different package riding the allowlisted origin → rejected
    await expect(verifyRegistration({
      ...base,
      clientDataJSON: clientDataB64('webauthn.create', challenge, ORIGIN, true, 'com.evil.app'),
      policy: POLICY_ANDROID,
    })).rejects.toMatchObject({ code: 'WEBAUTHN_CROSS_ORIGIN' });
  });

  it('rejects the android origin when the signing cert is not configured', async () => {
    const key = await makeKey();
    const challenge = bytesToB64u(crypto.getRandomValues(new Uint8Array(32)));
    const credId = crypto.getRandomValues(new Uint8Array(32));
    const authData = await buildAuthData({ rpId: RP_ID, credId, cose: coseKey(key.jwk) });
    await expect(verifyRegistration({
      clientDataJSON: clientDataB64('webauthn.create', challenge, androidOrigin(POLICY_ANDROID)!, true),
      attestationObject: attestationObjectB64(authData),
      expectedChallenge: challenge,
      policy: POLICY,
    })).rejects.toMatchObject({ code: 'WEBAUTHN_BAD_ORIGIN' });
  });

  it('accepts a native assertion (login) from the configured apk-key-hash origin', async () => {
    const key = await makeKey();
    const storedJwk = { kty: 'EC', crv: 'P-256', x: String(key.jwk.x), y: String(key.jwk.y), alg: 'ES256' };
    const userHandle = await userHandleFor('yasmine');
    const challenge = bytesToB64u(crypto.getRandomValues(new Uint8Array(32)));
    const authData = await buildAuthData({ rpId: RP_ID, counter: 1 });
    const cd = clientDataB64('webauthn.get', challenge, androidOrigin(POLICY_ANDROID)!, true);
    const sig = await signEs256(key.priv, concat(authData, await sha256(b64uToBytes(cd))));
    const v = await verifyAuthentication({
      clientDataJSON: cd,
      authenticatorData: bytesToB64u(authData),
      signature: bytesToB64u(sig),
      userHandle,
      expectedChallenge: challenge,
      policy: POLICY_ANDROID,
      stored: { publicKeyJwk: storedJwk, counter: 0, backupEligible: false, userHandle },
    });
    expect(v.counter).toBe(1);
  });

  it('accepts the LEGACY android:apk-key-hash: origin (base64 of SHA-1) when configured', async () => {
    const legacy = androidLegacyOrigin(POLICY_ANDROID_BOTH)!;
    expect(legacy).toBe(androidLegacyOriginFromSha1(CERT_SHA1_HEX));
    expect(legacy.startsWith('android:apk-key-hash:')).toBe(true);
    const key = await makeKey();
    const challenge = bytesToB64u(crypto.getRandomValues(new Uint8Array(32)));
    const credId = crypto.getRandomValues(new Uint8Array(32));
    const authData = await buildAuthData({ rpId: RP_ID, credId, cose: coseKey(key.jwk) });
    const v = await verifyRegistration({
      clientDataJSON: clientDataB64('webauthn.create', challenge, legacy, true),
      attestationObject: attestationObjectB64(authData),
      expectedChallenge: challenge,
      policy: POLICY_ANDROID_BOTH,
    });
    expect(v.credentialId).toBe(bytesToB64u(credId));
  });

  it('matches byte-for-byte across base64 alphabets and padding (string equality is not enough)', () => {
    const legacy = androidLegacyOrigin(POLICY_ANDROID_BOTH)!;
    const suffix = legacy.slice('android:apk-key-hash:'.length);
    // standard alphabet + padding variant of the same bytes
    let std = suffix.replace(/-/g, '+').replace(/_/g, '/');
    while (std.length % 4) std += '=';
    expect(matchesAndroidOrigin(`android:apk-key-hash:${std}`, POLICY_ANDROID_BOTH)).toBe(true);
    expect(matchesAndroidOrigin(legacy, POLICY_ANDROID_BOTH)).toBe(true);
    // sha256 form still matches under the combined policy
    expect(matchesAndroidOrigin(androidOrigin(POLICY_ANDROID_BOTH)!, POLICY_ANDROID_BOTH)).toBe(true);
    // wrong bytes / wrong prefix / unconfigured → false
    expect(matchesAndroidOrigin(`android:apk-key-hash:${suffix.slice(1)}A`, POLICY_ANDROID_BOTH)).toBe(false);
    expect(matchesAndroidOrigin(legacy, POLICY_ANDROID)).toBe(false); // no SHA-1 configured
    expect(matchesAndroidOrigin(legacy, POLICY)).toBe(false);        // no android at all
    expect(matchesAndroidOrigin('android:apk-key-hash:', POLICY_ANDROID_BOTH)).toBe(false);
    expect(matchesAndroidOrigin('https://stock.afmarbre.com', POLICY_ANDROID_BOTH)).toBe(false);
  });

  it('v0.7 — comma-separated fingerprints: every key associates, unknown rejected', () => {
    const A = '53:D0:74:2C:A3:34:22:36:58:E1:D7:F8:8C:DC:67:C5:4D:B0:AC:4E:17:88:59:DA:13:2D:4A:9F:30:62:65:6E';
    const B = 'FC:CC:F6:C3:B2:3D:B8:BE:1D:74:AF:BE:D5:04:DA:EA:5F:5D:FF:AF:8C:6F:C4:5A:F8:F0:2B:6A:C8:87:6C:C1';
    const multi = policyFromEnv({
      WEBAUTHN_ENABLED: 'true',
      WEBAUTHN_ANDROID_PACKAGE: 'ma.etherealmber.atlascommerce',
      WEBAUTHN_ANDROID_CERT_HASH: `${A},${B}`,
    });
    expect(multi.androidCertHashes).toEqual([A, B]);
    expect(multi.androidCertHash).toBe(A); // primary = first, status compat
    const oA = androidOriginFromCertHash(A)!;
    const oB = androidOriginFromCertHash(B)!;
    expect(matchesAndroidOrigin(oA, multi)).toBe(true);
    expect(matchesAndroidOrigin(oB, multi)).toBe(true);
    expect(androidOrigins(multi)).toEqual([oA, oB]);
    const wrong = androidOriginFromCertHash(
      '11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF',
    )!;
    expect(matchesAndroidOrigin(wrong, multi)).toBe(false);
  });

  it('rejects the legacy origin end-to-end when the SHA-1 fingerprint is not configured', async () => {
    const legacy = androidLegacyOrigin(POLICY_ANDROID_BOTH)!;
    const key = await makeKey();
    const challenge = bytesToB64u(crypto.getRandomValues(new Uint8Array(32)));
    const credId = crypto.getRandomValues(new Uint8Array(32));
    const authData = await buildAuthData({ rpId: RP_ID, credId, cose: coseKey(key.jwk) });
    await expect(verifyRegistration({
      clientDataJSON: clientDataB64('webauthn.create', challenge, legacy, true),
      attestationObject: attestationObjectB64(authData),
      expectedChallenge: challenge,
      policy: POLICY_ANDROID, // SHA-256 only
    })).rejects.toMatchObject({ code: 'WEBAUTHN_BAD_ORIGIN' });
  });

  it('accepts a legacy-origin assertion (login) with the combined policy', async () => {
    const key = await makeKey();
    const storedJwk = { kty: 'EC', crv: 'P-256', x: String(key.jwk.x), y: String(key.jwk.y), alg: 'ES256' };
    const userHandle = await userHandleFor('haytam');
    const challenge = bytesToB64u(crypto.getRandomValues(new Uint8Array(32)));
    const authData = await buildAuthData({ rpId: RP_ID, counter: 1 });
    const cd = clientDataB64('webauthn.get', challenge, androidLegacyOrigin(POLICY_ANDROID_BOTH)!, true);
    const sig = await signEs256(key.priv, concat(authData, await sha256(b64uToBytes(cd))));
    const v = await verifyAuthentication({
      clientDataJSON: cd,
      authenticatorData: bytesToB64u(authData),
      signature: bytesToB64u(sig),
      userHandle,
      expectedChallenge: challenge,
      policy: POLICY_ANDROID_BOTH,
      stored: { publicKeyJwk: storedJwk, counter: 0, backupEligible: false, userHandle },
    });
    expect(v.counter).toBe(1);
  });
});

/* ─────────────── v0.7 — excludeCredentials filtering ─────────────── */

describe('register/options excludeCredentials filtering', () => {
  it('omits legacy rows without public_key_jwk, keeps verifiable ones', async () => {
    const db = makeD1() as any;
    await db.prepare(`CREATE TABLE IF NOT EXISTS webauthn_credentials (
      id TEXT PRIMARY KEY, username TEXT DEFAULT '', transports TEXT DEFAULT '',
      public_key_jwk TEXT
    )`).run();
    await db.prepare(
      `INSERT INTO webauthn_credentials (id, username, transports, public_key_jwk) VALUES (?, ?, ?, ?)`,
    ).bind('legacy-1', 'alice', '', null).run();
    await db.prepare(
      `INSERT INTO webauthn_credentials (id, username, transports, public_key_jwk) VALUES (?, ?, ?, ?)`,
    ).bind('legacy-empty', 'alice', 'internal', '').run();
    await db.prepare(
      `INSERT INTO webauthn_credentials (id, username, transports, public_key_jwk) VALUES (?, ?, ?, ?)`,
    ).bind('valid-1', 'alice', 'internal,hybrid', '{"kty":"OKP","crv":"P-256"}').run();
    await db.prepare(
      `INSERT INTO webauthn_credentials (id, username, transports, public_key_jwk) VALUES (?, ?, ?, ?)`,
    ).bind('other-user', 'bob', '', '{"kty":"OKP"}').run();

    const desc = await credentialDescriptors(db, 'alice');
    expect(desc.map((d) => d.id)).toEqual(['valid-1']);
    expect(desc[0].transports).toEqual(['internal', 'hybrid']);
    // case-insensitive username match, same as the routes
    const upper = await credentialDescriptors(db, 'ALICE');
    expect(upper.map((d) => d.id)).toEqual(['valid-1']);
    // unknown account → empty exclude list (fresh registration allowed)
    expect(await credentialDescriptors(db, 'carol')).toEqual([]);
  });
});
