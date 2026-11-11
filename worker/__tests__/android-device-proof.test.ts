import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ANDROID_DEVICE_PROOF_POLICY, DEVICE_CHALLENGE_TTL_MS, DEVICE_CREDENTIAL_TTL_MS,
  deviceChallengeBytes, evaluateAndroidDeviceProof,
  type DeviceChallenge, type DeviceCredential, type DeviceProofContext, type CommitDeviceProof,
} from '../lib/android-device-proof';

// Review-only primitive tests, NOT evidence of Android/Keystore or D1 integration.
const b64url = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url');
const NOW = 1_800_000_000_000;
let context: DeviceProofContext;
let credential: DeviceCredential;
let challenge: DeviceChallenge;
let privateKey: CryptoKey;
let signature: string;
let commit: ReturnType<typeof vi.fn<CommitDeviceProof>>;

beforeEach(async () => {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  privateKey = keys.privateKey;
  context = {
    tenantId: 'tenant-immutable-1', origin: 'https://chosen.example:8443', subjectId: 'user-immutable-A', accountEpoch: 'epoch-1',
    now: NOW, passwordVerified: true, accountActive: true, abuseAllowed: true, requireOtpForRisk: false, ipChanged: false,
  };
  const scope = { tenantId: context.tenantId, origin: context.origin, subjectId: context.subjectId, accountEpoch: context.accountEpoch };
  credential = {
    ...scope, id: 'credential-1', publicKey: await crypto.subtle.exportKey('jwk', keys.publicKey), enrolledVia: 'email-otp',
    enrolledAt: NOW - 1000, expiresAt: NOW + DEVICE_CREDENTIAL_TTL_MS - 1000, revokedAt: null,
  };
  challenge = {
    ...scope, id: 'challenge-1', credentialId: credential.id, purpose: 'return-login',
    nonce: b64url(crypto.getRandomValues(new Uint8Array(32))), issuedAt: NOW, expiresAt: NOW + DEVICE_CHALLENGE_TTL_MS, consumedAt: null,
  };
  signature = await sign(challenge);
  commit = vi.fn(async () => true);
});
async function sign(value: DeviceChallenge) {
  return b64url(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, deviceChallengeBytes(value)));
}
const evaluate = () => evaluateAndroidDeviceProof(context, credential, challenge, signature, commit);
async function expectRejected() {
  expect(await evaluate()).toMatchObject({ otpRequired: true, candidateProofVerified: false });
  expect(commit).not.toHaveBeenCalled();
}

describe('review-only Android possession proof (never authorizes OTP bypass)', () => {
  it('verifies same-account possession but STILL requires OTP pending review', async () => {
    expect(ANDROID_DEVICE_PROOF_POLICY).toBe('review-only-otp-required');
    expect(await evaluate()).toEqual({ otpRequired: true, candidateProofVerified: true, reason: 'REVIEW_REQUIRED' });
    expect(commit).toHaveBeenCalledOnce();
  });

  it.each(['subjectId', 'tenantId', 'origin', 'accountEpoch'] as const)('rejects a credential transplanted across %s', async (field) => {
    credential[field] = field === 'origin' ? 'https://other.example' : 'different';
    await expectRejected();
  });
  it.each(['subjectId', 'tenantId', 'origin', 'accountEpoch', 'credentialId', 'id', 'nonce'] as const)('rejects signed challenge tampering: %s', async (field) => {
    challenge[field] = field === 'origin' ? 'https://other.example' : 'different';
    await expectRejected();
  });
  it('does not accept A proof for B even with a valid B password and the same phone', async () => {
    context.subjectId = 'user-immutable-B';
    await expectRejected();
  });
  it.each(['credential', 'challenge', 'signature'])('requires OTP for missing %s', async (missing) => {
    expect(await evaluateAndroidDeviceProof(context, missing === 'credential' ? null : credential,
      missing === 'challenge' ? null : challenge, missing === 'signature' ? null : signature, commit))
      .toMatchObject({ otpRequired: true, candidateProofVerified: false, reason: 'OTP_REQUIRED' });
    expect(commit).not.toHaveBeenCalled();
  });
  it('rejects another key signature', async () => {
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    signature = b64url(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, deviceChallengeBytes(challenge)));
    await expectRejected();
  });
  it.each(['garbage', 'AAAA=', '', 'A'.repeat(86)])('rejects malformed/noncanonical signatures (%s)', async (value) => {
    signature = value;
    await expectRejected();
  });
  it('rejects credential expiry at the boundary', async () => {
    credential.expiresAt = NOW;
    await expectRejected();
  });
  it('rejects challenge expiry at the boundary', async () => {
    context.now = challenge.expiresAt;
    await expectRejected();
  });
  it('rejects revoked credentials', async () => {
    credential.revokedAt = NOW - 1;
    await expectRejected();
  });
  it('rejects consumed challenges', async () => {
    challenge.consumedAt = NOW - 1;
    await expectRejected();
  });
  it('rejects a challenge exceeding its maximum TTL even with a valid signature', async () => {
    challenge.expiresAt++;
    signature = await sign(challenge);
    await expectRejected();
  });
  it('rejects an overlong credential lifetime', async () => {
    credential.expiresAt++;
    await expectRejected();
  });
  it('rejects a future challenge and invalid timestamps', async () => {
    challenge.issuedAt = NOW + 1;
    await expectRejected();
    challenge.issuedAt = Number.NaN;
    await expectRejected();
  });
  it('rejects unsupported/non-OTP enrollment and algorithms', async () => {
    credential.enrolledVia = 'fingerprint' as any;
    await expectRejected();
    credential.enrolledVia = 'email-otp';
    credential.publicKey.crv = 'P-384';
    await expectRejected();
  });
  it('rejects private key material and malformed public coordinates', async () => {
    credential.publicKey.d = 'never-import-private-material';
    await expectRejected();
    delete credential.publicKey.d;
    credential.publicKey.x = 'invalid';
    await expectRejected();
  });
  it('rejects an insecure origin', async () => {
    context.origin = credential.origin = challenge.origin = 'http://chosen.example';
    signature = await sign(challenge);
    await expectRejected();
  });
  it('does not treat a VPN egress change as lost possession', async () => {
    context.ipChanged = true;
    expect(await evaluate()).toMatchObject({ candidateProofVerified: true, otpRequired: true });
  });
  it('VPN egress does not override risk or abuse controls', async () => {
    context.ipChanged = true;
    context.requireOtpForRisk = true;
    await expectRejected();
    context.requireOtpForRisk = false;
    context.abuseAllowed = false;
    await expectRejected();
  });
  it('rejects inactive accounts and wrong passwords before consuming proof', async () => {
    context.passwordVerified = false;
    expect(await evaluate()).toMatchObject({ reason: 'BAD_PASSWORD', otpRequired: true, candidateProofVerified: false });
    context.passwordVerified = true;
    context.accountActive = false;
    await expectRejected();
  });
  it('storage failure falls back without logging exception contents', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      commit.mockRejectedValue(new Error('sensitive-storage-error'));
      expect(await evaluate()).toEqual({ otpRequired: true, candidateProofVerified: false, reason: 'UNAVAILABLE' });
      expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
  it('fails closed if the atomic adapter detects revocation/account change', async () => {
    commit.mockResolvedValue(false);
    expect(await evaluate()).toMatchObject({ otpRequired: true, candidateProofVerified: false, reason: 'INVALID_PROOF' });
  });
  it('permits only one concurrent candidate in a simulated atomic consume adapter', async () => {
    // This models the required contract; a real transactional D1 adapter is NOT shipped.
    let used = false;
    commit.mockImplementation(async () => {
      if (used) return false;
      used = true;
      return true;
    });
    const results = await Promise.all([evaluate(), evaluate()]);
    expect(results.filter((r) => r.candidateProofVerified)).toHaveLength(1);
    expect(results.every((r) => r.otpRequired)).toBe(true);
  });
});
