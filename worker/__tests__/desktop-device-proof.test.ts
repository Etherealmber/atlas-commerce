import { beforeAll, describe, expect, it } from 'vitest';
import { verifyDesktopDeviceProof } from '../lib/desktop-device-proof';
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const encode = (s: string) => b64(new TextEncoder().encode(s));
const nonce = b64(new Uint8Array(32).fill(7));
const jti = b64(new Uint8Array(16).fill(3));
const expected = {method:'POST',target:'https://example.test:8443/api/auth/desktop/v3/login/otp',nonce,nowSeconds:1700000000,transactionId:'transaction'};
let pair: CryptoKeyPair, jwk: JsonWebKey;
beforeAll(async () => { pair = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'}, true, ['sign','verify']); jwk = await crypto.subtle.exportKey('jwk',pair.publicKey); });
async function signed(header: unknown, claims: unknown) { return signedRaw(JSON.stringify(header),JSON.stringify(claims)); }
async function signedRaw(header: string, claims: string) {
  const msg = `${encode(header)}.${encode(claims)}`;
  return `${msg}.${b64(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},pair.privateKey,new TextEncoder().encode(msg))))}`;
}
function inputs() { return {header:{typ:'dpop+jwt',alg:'ES256',jwk:{kty:'EC',crv:'P-256',x:jwk.x,y:jwk.y}},claims:{jti,htm:'POST',htu:expected.target,iat:expected.nowSeconds,nonce,atlas_txn:'transaction'}}; }
describe('candidate device proof verifier (no replay store)', () => {
  it('verifies a real ES256 signature and calculates the RFC 7638 thumbprint', async () => {
    const {header,claims}=inputs(); const token=await signed(header,claims);
    const result=await verifyDesktopDeviceProof(token,expected); expect(result).not.toBeNull();
    const canonical=JSON.stringify({crv:'P-256',kty:'EC',x:jwk.x,y:jwk.y});
    expect(result!.thumbprint).toBe(b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical)))));
    expect(await verifyDesktopDeviceProof(token,{...expected,thumbprint:result!.thumbprint})).toEqual(result);
    expect(await verifyDesktopDeviceProof(token,{...expected,thumbprint:'wrong'})).toBeNull();
  });
  it('rejects altered signature, wrong nonce, method, port, transaction and time', async () => {
    const {header,claims}=inputs(); const token=await signed(header,claims);
    const pieces=token.split('.'); const sig=Uint8Array.from(atob(pieces[2].replace(/-/g,'+').replace(/_/g,'/')+'=='), c=>c.charCodeAt(0)); sig[0]^=1;
    expect(await verifyDesktopDeviceProof(`${pieces[0]}.${pieces[1]}.${b64(sig)}`,expected)).toBeNull();
    expect(await verifyDesktopDeviceProof(`${token.slice(0,-1)}!`,expected)).toBeNull();
    expect(await verifyDesktopDeviceProof(token,{...expected,nonce:b64(new Uint8Array(32))})).toBeNull();
    expect(await verifyDesktopDeviceProof(token,{...expected,method:'GET'})).toBeNull();
    expect(await verifyDesktopDeviceProof(token,{...expected,target:'https://example.test/api/auth/desktop/v3/login/otp'})).toBeNull();
    expect(await verifyDesktopDeviceProof(token,{...expected,target:expected.target+'?x=1'})).toBeNull();
    expect(await verifyDesktopDeviceProof(token,{...expected,transactionId:'other'})).toBeNull();
    expect(await verifyDesktopDeviceProof(token,{...expected,nowSeconds:expected.nowSeconds+61})).toBeNull();
    expect(await verifyDesktopDeviceProof(token,{...expected,nowSeconds:expected.nowSeconds+60})).not.toBeNull();
  });
  it('does not pretend the stateless verifier provides replay prevention', async () => {
    const {header,claims}=inputs(); const token=await signed(header,claims);
    expect(await verifyDesktopDeviceProof(token,expected)).not.toBeNull();
    expect(await verifyDesktopDeviceProof(token,expected)).not.toBeNull();
  });
  it('requires an access-token hash only where expected', async () => {
    const {header,claims}=inputs(); const ath=b64(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('token'))));
    const token=await signed(header,{...claims,ath});
    expect(await verifyDesktopDeviceProof(token,expected)).toBeNull();
    expect(await verifyDesktopDeviceProof(token,{...expected,accessToken:'token'})).not.toBeNull();
    expect(await verifyDesktopDeviceProof(token,{...expected,accessToken:'other'})).toBeNull();
    expect(await verifyDesktopDeviceProof(token,{...expected,accessToken:'non-ascii-☃'})).toBeNull();
  });
  it('rejects duplicate escaped keys even in nested JSON', async () => {
    const {header,claims}=inputs();
    const duplicate=JSON.stringify(header).replace('"alg":"ES256"','"alg":"ES256","\\u0061lg":"ES256"');
    expect(await verifyDesktopDeviceProof(await signedRaw(duplicate,JSON.stringify(claims)),expected)).toBeNull();
    const nested=JSON.stringify(header).replace('"crv":"P-256"','"crv":"P-256","crv":"P-256"');
    expect(await verifyDesktopDeviceProof(await signedRaw(nested,JSON.stringify(claims)),expected)).toBeNull();
  });
  it('rejects algorithm confusion, private JWK fields, unrecognized extensions and short IDs', async () => {
    const {header,claims}=inputs();
    const headers = [{...header,alg:'none'}, {...header,jwk:{...header.jwk,d:'private'}}, {...header,crit:['x']}];
    const badClaims = [{...claims,jti:'YQ'}, {...claims,nonce:'YQ'}, {...claims,extra:'x'}, {...claims,iat:NaN}];
    const rejected = await Promise.all([...headers.map(async bad => verifyDesktopDeviceProof(await signed(bad,claims),expected)),
      ...badClaims.map(async bad => verifyDesktopDeviceProof(await signed(header,bad),expected))]);
    expect(rejected).toEqual(Array(rejected.length).fill(null));
    expect(await verifyDesktopDeviceProof('x'.repeat(8193),expected)).toBeNull();
  });
});
