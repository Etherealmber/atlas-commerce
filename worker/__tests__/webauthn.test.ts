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

function clientDataB64(type: string, challenge: string, origin: string, crossOrigin = false): string {
  const json = JSON.stringify({ type, challenge, origin, crossOrigin });
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

  async function register(over: { origin?: string; challenge?: string; rpId?: string; up?: boolean; uv?: boolean; fmt?: string; clientData?: string } = {}) {
    const authData = await buildAuthData({ rpId: over.rpId, up: over.up, uv: over.uv, credId, cose: coseKey(key.jwk) });
    return verifyRegistration({
      clientDataJSON: over.clientData ?? clientDataB64('webauthn.create', over.challenge ?? challenge, over.origin ?? ORIGIN),
      attestationObject: attestationObjectB64(authData, over.fmt),
      expectedChallenge: challenge,
      expectedOrigin: ORIGIN,
      rpId: RP_ID,
      requireUV: true,
      attestationPolicy: 'none',
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
  } = {}) {
    const authData = await buildAuthData({ rpId: over.rpId, up: over.up, uv: over.uv, be: over.backupEligible, counter: over.counter ?? 1 });
    const cd = clientDataB64('webauthn.get', over.challenge ?? challenge, over.origin ?? ORIGIN);
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
      expectedOrigin: ORIGIN,
      rpId: RP_ID,
      requireUV: true,
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
