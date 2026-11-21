import { describe, expect, it } from 'vitest';
import { verifyWindowsLabAssertion, es256DerToRaw } from '../../experiments/windows-webauthn/verify';
import { bytesToB64u, sha256 } from '../lib/webauthn';
const ORIGIN = 'https://example.test:8443'; const RP = 'example.test';
function der(raw: Uint8Array) {
  const enc = (v: Uint8Array) => { let i = 0; while (i < v.length - 1 && v[i] === 0) i++; const b = Array.from(v.slice(i)); if (b[0] & 128) b.unshift(0); return [2, b.length, ...b]; };
  const inner = [...enc(raw.slice(0, 32)), ...enc(raw.slice(32))]; return Uint8Array.from([0x30, inner.length, ...inner]);
}
async function fixture(opts: { origin?: string; rp?: string; uv?: boolean; counter?: number; challenge?: string } = {}) {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  const challenge = bytesToB64u(crypto.getRandomValues(new Uint8Array(32)));
  const cd = new TextEncoder().encode(JSON.stringify({ type:'webauthn.get', challenge: opts.challenge || challenge, origin: opts.origin || ORIGIN, crossOrigin: false }));
  const ad = new Uint8Array(37); ad.set(await sha256(opts.rp || RP)); ad[32] = opts.uv === false ? 1 : 5; ad[36] = opts.counter ?? 1;
  const bytes = new Uint8Array(69); bytes.set(ad); bytes.set(await sha256(cd), 37);
  const raw = new Uint8Array(await crypto.subtle.sign({ name:'ECDSA', hash:'SHA-256' }, kp.privateKey, bytes));
  return { expectedOrigin:ORIGIN, rpId:RP, expectedChallenge:challenge, clientDataJSON: bytesToB64u(cd), authenticatorData:bytesToB64u(ad), signatureDER:bytesToB64u(der(raw)), userHandle:'dXNlcg', stored: { publicKeyJwk: {kty:'EC', crv:'P-256', x:jwk.x!, y:jwk.y!, alg:'ES256'}, counter:0, backupEligible:false, userHandle:'dXNlcg' } };
}
describe('isolated Windows assertion verifier lab (not a route)', () => {
  it('verifies an ES256 WebAuthn DER assertion with exact RP, origin, challenge and UV', async () => {
    expect(await verifyWindowsLabAssertion(await fixture())).toMatchObject({ counter:1, uv:true });
  });
  it('rejects wrong origin, RP hash, challenge, UV, user handle, signature and counter', async () => {
    for (const opts of [{origin:'https://evil.test'}, {rp:'evil.test'}, {challenge:'z'.repeat(43)}, {uv:false}, {counter:0}])
      await expect(verifyWindowsLabAssertion(await fixture(opts))).rejects.toThrow('invalid assertion');
    const f = await fixture();
    await expect(verifyWindowsLabAssertion({...f, userHandle:'b3RoZXI'})).rejects.toThrow('invalid assertion');
    const bad = await fixture(); bad.signatureDER = bytesToB64u(der(new Uint8Array(64).fill(3)));
    await expect(verifyWindowsLabAssertion(bad)).rejects.toThrow('invalid assertion');
    await expect(verifyWindowsLabAssertion({...f, expectedOrigin:'https://example.test', rpId:'other.test'})).rejects.toThrow('invalid assertion');
  });
  it('rejects non-canonical, negative, trailing and oversized DER integers', () => {
    for (const x of [[0x30,6,2,1,0x80,2,1,1], [0x30,7,2,2,0,1,2,1,1], [0x30,7,2,1,1,2,1,1,0], [0x30,0x81,0x06,2,1,1,2,1,1]])
      expect(() => es256DerToRaw(Uint8Array.from(x))).toThrow();
  });
});
