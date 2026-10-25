# WebAuthn / Passkeys — Security Model, Configuration & Android Enablement (v259)

**State: passkeys are DISABLED in production (`WEBAUTHN_ENABLED="false"`).** They must stay disabled
until the hardened verifier below is deployed **and** the checklist in §5 is completed.

## 1. What changed (audit → enforcement)

Before v259 the four WebAuthn routes trusted **client-submitted fields** as proof of identity:

| Old behaviour (audit finding) | Consequence |
|---|---|
| `register/verify` stored `credentialId`, `aaguid`, `transports` **without parsing or verifying the attestation object** | Anyone could enroll an arbitrary "passkey" for any account |
| Public key was **never stored** (`public_key_jwk` column did not exist) | Signature verification was impossible — login could not verify anything |
| `login/verify` issued a session token after only challenge consumption + a `webauthn_credentials` lookup (with fallbacks via `trusted_devices.biometric_credential_id` and `cred?.username \|\| body.username \|\| ownerUser`) | **Account takeover**: a valid challenge + any stored credential id = token for that username |
| Challenges were bound to a **client-supplied `fingerprint`** (`sha256(username+ua+ip+nonce)`) and consumed SELECT-then-DELETE | Replayable across devices/users; non-atomic race window |
| `excludeCredentials` was computed but returned `[]` | Duplicate credential spam |

v259 introduces `worker/lib/webauthn.ts` — a self-contained verifier (no new dependency) — and rewires
the routes to require **full cryptographic verification** on every success path.

## 2. Security properties now enforced

**Challenges** (`webauthn_challenges`): 32 random bytes, base64url; bound to `purpose`
(`webauthn.create`/`webauthn.get`), `username`, `rp_id`, `origin`; TTL 5 min (env
`WEBAUTHN_CHALLENGE_TTL_SECONDS`); consumed **atomically** (`UPDATE … SET consumed=1 WHERE … AND
consumed=0` — the row is only handed out once); expired/replayed/purpose- or account-mismatched
challenges are rejected.

**Registration** (`POST /api/auth/webauthn/register/verify`):
- clientDataJSON: `type === "webauthn.create"`, challenge equality, **exact origin acceptance** (§4a):
  allowlisted web origin (crossOrigin rejected, except the configured-Android-package case) or the
  derived `android:apk-key-hash-sha256:` origin
- authenticatorData: RP ID hash == `sha256(WEBAUTHN_RP_ID)`, user-present flag, user-verified flag
  (required unless `WEBAUTHN_REQUIRE_UV=discouraged`), attestation extension offset consistency
- attestation policy: `none` format only (default) — platform attestation (packed etc.) rejected
- COSE public key: **ES256 (EC P-256) only** → normalized to JWK and persisted (`public_key_jwk`)
- user handle: opaque `sha256(username)` — stable per account, leaks nothing; credential rows without
  a stored public key can never authenticate (legacy keyless rows are inert)
- stored metadata: counter, backupEligible/backupState, transports, rp_id/origin, credential user handle
- duplicates rejected (409 `DUPLICATE_CREDENTIAL`); challenges bound to the **session** account

**Authentication** (`POST /api/auth/webauthn/login/verify`):
- credential must exist **with a stored JWK** and (when the challenge was account-bound) match that username
- clientDataJSON `type === "webauthn.get"` + origin + challenge + rpIdHash + UP/UV flags
- **signature verified over `authData || sha256(clientDataJSON)`** with the stored ES256 public key
- `userHandle` (when present) must equal the stored per-account handle → `WEBAUTHN_WRONG_ACCOUNT`
- counters: must advance (`WEBAUTHN_COUNTER`), except the synced-passkey rule (backupEligible and both
  counters 0); backupState updates persisted
- **Every failure class returns the same generic `401 WEBAUTHN_VERIFY_FAILED`** and records a failed
  login — no oracle distinguishing unknown credential / bad signature / wrong account / expired challenge
  (prevents account enumeration). Existing rate limiting (`isRateLimited` + OTP lockout paths) still applies.
- On success the token is minted with the same secret material as password login (owner key or
  `app_users.password_hash`) and the account is taken **only from the verified credential row**.

**Disabled by default**: while `WEBAUTHN_ENABLED` is not `"true"`, all four routes answer
`503 {code:"WEBAUTHN_DISABLED"}` — nothing is verified, nothing is issued.

## 3. Capability endpoint (client gate)

`GET /api/auth/webauthn/status` (public, 60 s cache):

```json
{ "ok": true, "data": {
    "enabled": false,
    "rp": { "id": "stock.afmarbre.com", "name": "Atlas Commerce" },
    "origins": ["https://stock.afmarbre.com"],
    "user_verification": "required",
    "algorithms": ["ES256"],
    "android": { "enabled": false, "package": "ma.etherealmber.atlascommerce",
                 "origin": null, "origin_legacy": null,
                 "assetlinks": "/.well-known/assetlinks.json" } } }
```

**Clients must only offer passkey UI when `data.enabled === true`** (and for Android Credential
Manager additionally `data.android.enabled === true`). `data.android.origin` is the exact
`android:apk-key-hash-sha256:…` value the backend accepts — device teams compare it against what
their build produces instead of guessing. This is the single source of truth for the capability —
the app never guesses from build flags.

## 4. Android Credential Manager (production)

### 4a. Which `clientDataJSON.origin` the verifier accepts

The backend's exact-origin verifier accepts **only** these (v259.1):

| Origin in clientDataJSON | crossOrigin | Condition |
|---|---|---|
| `https://stock.afmarbre.com` (allowlist) | `false` | always (browser/PWA flows) |
| `https://stock.afmarbre.com` (allowlist) | `true` | only if `clientDataJSON.androidPackageName == WEBAUTHN_ANDROID_PACKAGE` **and** the Android integration is configured — this is what `androidx.credentials` produces when the app passes the web origin explicitly via the `origin` parameter of `CreatePublicKeyCredentialRequest` / `GetPublicKeyCredentialRequest` |
| `android:apk-key-hash-sha256:<base64(SHA-256(signing-cert DER))>` | any | accepted **byte-for-byte** against `WEBAUTHN_ANDROID_CERT_HASH` (the format Credential Manager emits) |
| `android:apk-key-hash:<base64(SHA-1(signing-cert DER))>` | any | accepted **byte-for-byte** against the optional `WEBAUTHN_ANDROID_CERT_SHA1` — the legacy prefix documented by Android's FIDO2 stack |

Native-origin matching is **byte-level, not string equality**: the suffix is decoded tolerantly
(base64url or standard alphabet, padded or not) and the raw bytes are compared to the configured
fingerprint, so any encoding Android emits for the correct certificate matches — and only the
correct certificate matches. `data.android.origin` / `data.android.origin_legacy` in the status
response expose the canonical derived values for comparison.

Everything else → `WEBAUTHN_BAD_ORIGIN` / `WEBAUTHN_CROSS_ORIGIN`. The derived origin is exposed at
`GET /api/auth/webauthn/status` (`data.android.origin`) for verification. **Recommended app
integration**: pass `origin = "https://stock.afmarbre.com"` explicitly so web and Android share one
origin; both modes are supported.

> CI note: the unit suite verifies the derivation, acceptance and rejection matrix above with real
> ES256 assertions; a physical-device round-trip cannot run in CI — it is step 4 of the §5 checklist.

1. **RP ID stays the web domain** (`stock.afmarbre.com`). Never use an app-specific domain.
2. **Digital Asset Links** — the worker now serves `GET /.well-known/assetlinks.json`
   (404 until both vars are set). Required entries (served automatically once configured):
   - `delegate_permission/common.handle_all_urls` for `namespace: "android_app"`,
     `package_name: ma.etherealmber.atlascommerce`, SHA-256 fingerprint of the **Play App Signing key**
   - `delegate_permission/common.get_login_creds` for the same package + host (`stock.afmarbre.com`)
3. `WEBAUTHN_ANDROID_PACKAGE=ma.etherealmber.atlascommerce` is **already configured** in
   `wrangler.jsonc`. Add `WEBAUTHN_ANDROID_CERT_HASH=<AA:BB:…>` — the SHA-256 of the **Play app-signing
   key** (Play Console → **Setup → App integrity → App signing key certificate**; the repo keystore is
   local-only via `signing.properties`, so the hash cannot be derived from source). Until the cert hash
   is set, `assetlinks` stays 404, `android.enabled` stays false and native `apk-key-hash` origins are
   rejected — web-origin passkeys keep working untouched. If you test internal builds signed with the
   upload key, add its hash as a second accepted value (comma-separated).
4. Allowed origins: Android browsers use the web origin (`https://stock.afmarbre.com`) — already in
   `WEBAUTHN_ALLOWED_ORIGINS`. For native Credential Manager calls the RP-ID association via assetlinks
   is what matters (the origin check applies to web flows).
5. Kotlin: `androidx.credentials` (Credential Manager) — `CreatePublicKeyCredentialRequest` with the
   JSON from `register/options`, `GetPublicKeyCredentialRequest` with `login/options`; pass
   `origin = "https://stock.afmarbre.com"` (§4a); gate both behind `GET /api/auth/webauthn/status`.

## 5. Production configuration & enablement checklist

`wrangler.jsonc` vars (non-secret defaults committed; override per environment as needed):

| Var | Default | Meaning |
|---|---|---|
| `WEBAUTHN_ENABLED` | `"false"` | Master switch. Routes 503 until `"true"` |
| `WEBAUTHN_RP_ID` | `stock.afmarbre.com` | RP ID (domain, no scheme) |
| `WEBAUTHN_RP_NAME` | `Atlas Commerce` | Human-readable RP name |
| `WEBAUTHN_ALLOWED_ORIGINS` | `https://stock.afmarbre.com` | Comma-separated exact-match origins |
| `WEBAUTHN_REQUIRE_UV` | `required` | `required` / `preferred` / `discouraged` |
| `WEBAUTHN_ANDROID_PACKAGE` / `_CERT_HASH` | package set / hash empty | Enable assetlinks + the `apk-key-hash-sha256` native origin |
| `WEBAUTHN_ANDROID_CERT_SHA1` | empty | Optional SHA-1 of the **same** cert — enables the legacy `apk-key-hash` native origin |

**Enable only after ALL of these are true:**
1. This branch is merged **and deployed** to production (`wrangler deploy` via Workers Builds).
2. `GET /api/auth/webauthn/status` returns `enabled: false` (verifier live but gated).
3. Real-device smoke test on a **preview/staging** environment with `WEBAUTHN_ENABLED=true` there:
   register → login → replay old challenge (must fail) → second account with same authenticator (must fail).
4. Android: assetlinks published (`/.well-known/assetlinks.json` returns the statement),
   `status.data.android.origin` (and `origin_legacy` if a SHA-1 is configured) matches the origin
   produced by the signed build — compare on-device via the status endpoint, and
   Credential Manager registration + login succeed on that build.
5. Flip `WEBAUTHN_ENABLED` to `"true"` in production vars and re-deploy. Existing keyless legacy rows
   remain inert; users re-enroll through the verified flow.

## 6. Tests

`worker/__tests__/webauthn.test.ts` (37 tests, real ES256 signatures via WebCrypto + CBOR fixtures):
valid registration/login round-trips; tampered signature; wrong origin / RP ID / challenge; missing UP/UV
flags; wrong `userHandle` (`WEBAUTHN_WRONG_ACCOUNT`); stale counter (+ synced-passkey exception);
replayed & expired & purpose-mismatched & account-bound challenges (atomic single use); packed-attestation
rejection; malformed clientData; policy parsing; opaque user-handle stability; **Android Credential
Manager origin matrix** (apk-key-hash derivation for BOTH the `-sha256` and legacy SHA-1 formats,
byte-level acceptance across base64 alphabets/padding, native registration/login acceptance,
web-origin + package cross-origin acceptance, wrong package / unconfigured rejection). Plus route-level guarantees:
generic failure codes (no enumeration), 503 while disabled, session-bound registration.
