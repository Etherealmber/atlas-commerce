# Android trusted-device possession — 0.8.1 review candidate

**Status: NOT ENABLED. Not a security approval or an Android release.**

Scope note: the subsequent [shared-egress limiter follow-up](login-rate-limits.md)
changes password/OTP admission and rejects OTP principal substitution; it does
not integrate or enable this candidate. The statements below about unchanged
handlers describe the original review-only foundation, not that later limiter
patch.

In the original review-only foundation, production login/OTP/session/revocation handlers are unchanged. There is no
new route, D1 table, binding, secret, configuration switch or OTP bypass. The
isolated verifier in [`worker/lib/android-device-proof.ts`](../worker/lib/android-device-proof.ts)
returns `otpRequired: true` even for a cryptographically valid proof. It is not
imported by production code. Tests cannot authorize rollout: independent security
review, integration work, device testing and explicit owner approval are required.

## 1. Observed implementation (not recommendations)

Worker baseline: `cf951397553dc8749f15c96b33abf02d4a360e35`.

| Path/source | Observed behavior | Consequence |
| --- | --- | --- |
| [`/api/auth/login`](../worker/index.ts), `isNativeAuthRequest`, `verifyTurnstile`, `isRateLimited` | Existing challenge/native classification and reputation checks run before password validation; active user/password are checked before ordinary OTP issuance. | Proof must never override password, account status or abuse gates. This work does not broaden native classification. |
| Same login handler, `resume_until` | An **existing exception** consumes a same-username/fingerprint, unexpired self-logout marker when `twofa_enabled` is off. It can skip OTP for 30 days following authenticated logout. | The phrase “OTP always” is not globally literal. This exception is not cryptographic device possession. Preserved here, not endorsed as the future trust mechanism. |
| Same login handler, email availability | Without `EMAIL.send`, the existing fallback issues a session without OTP regardless of environment (intended for local/development use, but not environment-gated). | Not an enrollment source. Production readiness must separately verify fail-closed email configuration; unchanged in this patch. |
| [`login-otp-always.test.ts`](../worker/__tests__/login-otp-always.test.ts) | Without those exceptions, known fingerprints, first logins and account switches require email OTP. Wrong password returns 401 without email. | Preserve the account-switch regression and safe legacy API behavior. |
| `/api/auth/verify-otp`, `/api/auth/verify-link` | OTP/context rows and normal session issuance, followed by `trustDevice`. The code reconstructs the principal from server OTP context, while some device-write arguments originate from the request. | Any future enrollment must use only one verified principal and a fresh, single-use server OTP ceremony receipt. Do not infer OTP assurance from `trusted_device: true` or a bearer alone. |
| `ensureSecurityTables`, `trustDevice`, `touchTrustedDevice` | `trusted_devices` has **fingerprint as its global primary key**; upserts may replace `username`. It stores metadata/resume/legacy biometric references, not an Android signing public key. | Cannot model simultaneous account A/B key enrollment safely; use a separate credential store. No automatic conversion of existing rows into cryptographic trust. |
| `makeTokenV2`, `parseToken`, `authFailReason` | Existing v2 session proof is derived from account material and the token's IP/fingerprint. No issued-at, expiry or session ID is encoded. Missing/mismatched device-account rows invalidate fingerprint-bearing sessions. | Device-credential expiry does not magically expire existing bearer sessions. Do not promise per-session logout revocation that does not exist. |
| `authFailReason` | For tokens with a fingerprint: a different supplied fingerprint is rejected, but unchanged fingerprint/bearer survives a changed IP; a missing request fingerprint is not possession proof. Legacy sessions without a fingerprint remain IP-bound. Some report paths intentionally relax session binding. | “IP-bound sessions everywhere” is inaccurate. No change to these rules in this patch. A bearer remains a bearer, not a key-bound request. |
| [`worker/routes/devices.ts`](../worker/routes/devices.ts) | Android uses `GET /api/auth/devices`, `POST /api/auth/devices/revoke`. Revocation deletes only the authenticated user's fingerprint row and emits `device.revoke`. | Wire this path into future scoped credential revocation, not just the web device manager. |
| `DELETE /api/auth/trusted-devices/:fingerprint` | Web manager has a separate self/admin revocation handler. | Both paths must revoke keys/challenges when integrated. Current web delete has no equivalent explicit audit write in that handler. |
| `/api/auth/logout` | Authenticated logout prepares `resume_until` and audits it; it does **not** retire an individual bearer token server-side. | Define logout vs “forget device” honestly; a future credential is not a replacement for a session-revocation design. |
| `/api/admin/users/:id`, `/api/settings/account/delete` | Password/role changes alter session verification material; inactive/deleted users fail verification. Account deletion has differing cleanup paths. | Future immutable subject/security epochs must cover owner and user password/role/email changes, disable/delete and account recreation, across all paths. |

### Android read-only inspection

Inspected Android `main` pinned at **43d8ca33d3d7efda53baa202b420c4343a234b2f**;
no Android files were changed, compiled or run:

- [DeviceIdentity.kt](https://github.com/Etherealmber/atlas-commerce-android/blob/43d8ca33d3d7efda53baa202b420c4343a234b2f/app/src/main/java/ma/etherealmber/atlascommerce/core/security/DeviceIdentity.kt): fingerprint is SHA-256 of install UUID, Android ID and package. Stable identifier, not a secret or signature.
- [CryptoStore.kt](https://github.com/Etherealmber/atlas-commerce-android/blob/43d8ca33d3d7efda53baa202b420c4343a234b2f/app/src/main/java/ma/etherealmber/atlascommerce/core/security/CryptoStore.kt): Android Keystore **AES-GCM** protects local storage; it does not provide a server-verifiable asymmetric login credential.
- [AuthRepository.kt](https://github.com/Etherealmber/atlas-commerce-android/blob/43d8ca33d3d7efda53baa202b420c4343a234b2f/app/src/main/java/ma/etherealmber/atlascommerce/data/repo/AuthRepository.kt) and [AtlasApi.kt](https://github.com/Etherealmber/atlas-commerce-android/blob/43d8ca33d3d7efda53baa202b420c4343a234b2f/app/src/main/java/ma/etherealmber/atlascommerce/core/net/AtlasApi.kt): password/fingerprint login, separate OTP call, Android revoke endpoint above; no signing proof on these calls.
- [SessionManager.kt](https://github.com/Etherealmber/atlas-commerce-android/blob/43d8ca33d3d7efda53baa202b420c4343a234b2f/app/src/main/java/ma/etherealmber/atlascommerce/core/session/SessionManager.kt): `loginOtpRequirement` honors `needsOtp` before checking for a token. Saved-account/device unlock and startup session verification are separate from password sign-in. Sign-out clears local state and may notify logout. Do not silently change restart, saved-account, QR or biometric policies as part of this candidate.

## 2. Proposed trust model — requires review before integration

**Password + fresh server challenge signed by a user/tenant-specific enrolled key**
can demonstrate returning possession. A fingerprint can help locate metadata; it
cannot authorize challenge issuance, enrollment, proof acceptance or OTP bypass.

### Identity and storage

- Introduce a deployment-controlled immutable tenant UUID. No trusted tenant ID
  from request JSON, hostname alone, company name or arbitrary Host header.
  Resolve a canonical allowed HTTPS origin through trusted server configuration.
- Use immutable subjects, e.g. tenant-local account UUID; reserve a distinct owner
  principal. Do not reuse a username as a key scope when an account is recreated.
- Credential key: `(tenant_id, subject_id, credential_id)`. Store public EC P-256
  key, security epoch, OTP enrollment timestamp, bounded expiry (candidate: 30
  days), revocation tombstone, label and optional fingerprint metadata.
- Each Android account/server gets a distinct Keystore EC signing alias; local
  alias mapping is not authorization. Never copy A's credential selection to B.
  Do not repurpose the AES storage key or legacy biometric credential ID.
- A random server-maintained account security epoch invalidates old enrollments
  and challenges on resets/security changes. Do not expose password hashes or
  derive a public epoch by revealing session secret material.

### Enrollment — OTP-only, explicit and bound to the key

1. User completes the existing password + **successful email OTP** ceremony and
   explicitly opts in to trusting this account on this installation. No enrollment
   after password-only resume, absent email binding, saved bearer restore, QR or
   a client assertion that OTP was checked.
2. Android generates a non-exportable EC P-256 key using AndroidKeyStore and
   SHA256withECDSA. Keep private key on device; no software-key fallback if
   Keystore signing is unsupported. StrongBox may be attempted but absence alone
   is not proof of compromise. Define required user-authentication/key-invalidation
   options before rollout; local unlock may replace email friction, not server checks.
3. Server issues a short-lived, single-use enrollment authorization bound to the
   verified immutable principal, tenant, origin, OTP ceremony, public-key digest
   and session/security epoch. It must not be a reusable “recently authenticated”
   boolean or an unsigned client field. Support an additive, negotiated OTP
   completion extension or an OTP-bound enrollment intent; decide exact HTTP
   contract in review. No proposed endpoint in this document exists today.
4. Prove possession of the new key using an enrollment-specific challenge/domain
   (never a return-login challenge), atomically consume the OTP enrollment grant,
   and persist the credential. Return only its opaque ID and expiry.
5. Receipt expiry, malformed key, unavailable Keystore, service error or user
   cancellation leaves normal OTP sign-in functional and does not create trust.

Non-exportability is an Android implementation property, **not established by
receiving a JWK**. A signature establishes possession, not hardware attestation.
If hardware/app attestation is a policy requirement, validate its full server-side
chain, fresh nonce, app identity and revocation policy; never accept a client
`hardwareBacked` flag. Rooted/device compromise and an attacker controlling a
valid session during enrollment remain threats. Re-enrollment/rotation requires
fresh OTP and invalidates replaced keys; do not extend expiry on use indefinitely.

### Returning sign-in (future negotiated API, not active)

1. Run existing TLS/origin, challenge, abuse/reputation, active-account and password
   checks. Enforced 2FA/risk can always demand OTP. Wrong password never produces
   a token or trusted-login grant and should not send an OTP.
2. Only a supported, explicitly negotiating Android client may enter the candidate
   exchange. Server resolves its credential within the verified tenant/subject,
   without leaking whether another account has a credential. Legacy clients see
   today's `needs_otp` response and use today's OTP endpoint.
3. Generate at least 32 random bytes, a random challenge ID, and absolute expiry
   at most 120 seconds (not beyond credential expiry). Persist pending context
   server-side. Bound attempts/creations per IP **and** account/credential; one
   outstanding attempt per intent; no challenges for unverified passwords.
4. Sign the exact UTF-8 bytes from `deviceChallengeBytes`: JSON array with domain,
   version 1, ES256, purpose, tenant, origin, subject, epoch, credential ID,
   challenge ID, nonce, issue and expiry times. Send server-generated signing
   bytes to Android; do not rebuild from client-chosen fields. All timestamps
   are integer milliseconds. No password, OTP, bearer or fingerprint in bytes.
5. Android `SHA256withECDSA` normally emits ASN.1 DER; the candidate Web Crypto
   verifier requires canonical unpadded base64url of 64-byte P1363 `r || s`.
   Implement/test a strict Android DER conversion, including padding, leading
   zeros, scalar bounds, malformed/trailing data. Do not weaken verification
   until Android output happens to pass. No native DER adapter ships here.
6. Verify signature using only the stored public key and stored challenge, then
   atomically consume the challenge conditioned on **current** active account,
   security epoch, key, tenant/origin/subject, credential expiry/revocation and
   pending challenge status. Recheck policy/risk at redemption. No KV read then
   write, replay window, or non-atomic SELECT followed by UPDATE.
7. Only after the entire reviewed path succeeds could it use existing session
   issuance/registration. Database/crypto/unknown-key/expired/revoked/unsupported
   errors fall back to OTP, never to password-only. A blocked abuse gate must
   remain blocked, not be treated as an OTP-success fallback. Proof requests are
   bounded, do not extend TTL, and do not trigger unbounded automatic email sends.

The candidate `CommitDeviceProof` interface specifies this transactional boundary;
**no real D1 adapter or session minting integration is supplied**. Its concurrency
unit test simulates atomic consumption, not a D1 race guarantee. Server context,
records, password/risk booleans and commit callbacks must never come from HTTP
request spreading. The candidate result is review evidence, never authorization.

### VPN/IP policy — separate decisions

A changed egress IP is neither evidence of losing the key nor proof that an IP
reputation block should be ignored. The candidate signed challenge is not
IP-bound; scope/key validation still applies. A risk engine may require fresh OTP
on unusual egress, abuse indicators, account/security changes or mandatory 2FA.
Do not treat `ipChanged: false` from a client as a server risk decision.

Leave current authenticated-session behavior unchanged: fingerprint-bearing bearer
sessions survive egress change; fingerprint-less legacy sessions remain IP-bound;
wrong fingerprint, revoked device, invalid proof/account still fail. This does not
make existing sessions key-bound. Session TTL, per-session revocation and request
proof are separate design decisions, not silently introduced by trusted login.

## 3. Revocation, logout, expiry and audit plan

| Event | Required future action |
| --- | --- |
| Ordinary sign-out | Clear active local session. Explain explicitly whether the user keeps enrollment. Do not call it server bearer revocation unless a session registry/version actually implements it. No new fingerprint-only resume grant. |
| “Forget/trust off” or explicit device revoke | Revoke matching scoped credentials and pending challenges; remove/disable local aliases; invalidate associated sessions through an actual session generation/registry. Retain credential tombstones for replay/audit. Wire both existing Android POST and web DELETE paths. |
| Revoke all sessions/security reset | Increment account/session security epoch; invalidate sessions, all trust grants and challenges as policy specifies. Old aliases must require OTP re-enrollment. |
| Password/role/email/security change, disable/delete/recreate account | Invalidate credential epochs/challenges; require fresh OTP. A new account with the same username never inherits old enrollment. Include owner credential changes. |
| Credential expiry | No returning-proof acceptance; fresh OTP and explicit enrollment. No silent sliding renewal. |
| Lost key, reinstall, restored backup, key invalidation | Missing signing capability means OTP; restoring fingerprint/preferences is not restoring trust. Exclude alias secrets from backups and never transfer keys. |

Use existing security audit infrastructure for proposed events:
`auth.device_enroll`, `auth.device_proof_accept`, `auth.device_proof_reject`,
`auth.device_expire`, `auth.device_revoke`. Fixed reason codes and opaque event
IDs; tenant/subject actor and bounded record identifiers under access-controlled
retention. Aggregate failures/rate limits to avoid log amplification. Audit
failures need a defined durable behavior before security mutations can ship.
Do not log passwords, OTPs, bearer/enrollment tokens, raw challenge/signature,
private keys, complete request bodies, public-key blobs or raw crypto/DB errors.
A public key is not a secret, but is unnecessary authentication telemetry.

## 4. Review blockers and compatibility

- Migrate/provide immutable tenant/subject/security epochs and transactional
  persistence. No trust inferred from legacy fingerprint metadata.
- Resolve how the existing self-logout `resume_until` exception is retired or
  replaced without surprise breakage. It does not meet possession requirements;
  keeping it unchanged here is not a declaration that all paths require proof.
- Establish one authoritative OTP principal and atomically consumed OTP/enrollment
  grant across code and email-link completion; audit concurrent/replay/account
  switching cases on real D1. Do not enroll from a generic existing token.
- Specify actual session revocation/generation semantics. Existing v2 tokens have
  no independent expiry/session ID; logout does not revoke the bearer.
- Review both revocation APIs, account lifecycle, owner lifecycle, report/session
  exemptions, audit durability and all device-upsert paths before integration.
- Existing Android payloads/response envelopes remain unchanged in 0.8.1.
  Future capability negotiation must be additive, versioned and opt-in, not a
  global “trust fingerprint” setting. Unsupported servers/clients, enrollment
  failure and invalid proof use normal OTP. Do not alter web/passkey/QR behavior.
- No Android dependency change, auto-session restore change, APK version change,
  release, deploy or later product version bump is authorized by this document.

## 5. Verification and limits

Automated coverage added:
- Candidate real P-256 signatures: same-account success **still requires OTP**,
  cross-account/tenant/origin/epoch denial, signature/key tampering, malformed
  inputs, missing proof, invalid/non-OTP enrollment metadata, TTL boundaries,
  revoked/consumed challenge, wrong password, inactive account, abuse/risk,
  VPN change, simulated concurrent consume, storage failure without raw logs.
- Real Worker + in-process SQLite/D1 shim: same-account fingerprint cannot skip
  OTP, cross-account proof claims, ignored unsupported proof fields, revoked
  device fallback, changed VPN IP, blocked reputation, wrong-password/no-email,
  successful OTP fallback, incorrect OTP and replay refusal.
- Real session gates: fingerprint-bearing VPN continuity, wrong fingerprint
  rejection, fingerprint-less legacy IP rejection, web/Android device revocation
  killing sessions, Android revocation scoping and its audit event. Existing
  resume-marker tests remain unchanged and continue to document the exception.

These tests do NOT test an Android binary, secure hardware, DER adapter, real
Cloudflare D1 atomic enrollment, mail delivery or a deployed proof endpoint.
Before rollout, run instrumented Keystore tests on supported Android versions
(and unsupported/key-invalidated cases), separate A/B accounts on one phone,
separate tenants including a custom HTTPS origin/port, reinstall/backup restore,
expiry, concurrent proof/OTP/revoke races, VPN toggles with clean/blocked egress,
server downgrade and canceled enrollment. Verify no secret telemetry, complete
session invalidation, existing web/QR/saved-account compatibility and independent
security approval. Until then repeated OTP is the intended safe fallback.


### Local checks for this patch

- `npm test`: **428 tests / 27 files passed** (54 additional backend tests).
- `npm run build`: passed (Worker + Vite client).
- `npm run lint`: **0 errors**, 848 existing warnings; no added warnings.
- `npx tsc --noEmit --pretty false`: not green repository-wide; **145 errors**,
  matching the HEAD baseline diagnostics after normalizing source path/line
  offsets. No new diagnostics in the candidate or changed tests.
- `git diff --check`: passed.
- Android/real-device/security-review/production rollout: **not executed**.
