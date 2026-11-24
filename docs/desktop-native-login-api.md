# Desktop native login API (v3, browser-free)

Server: `worker/routes/desktopNativeV3.ts` · tests: `worker/__tests__/desktop-native-v3-native-login.test.ts`.

The desktop app signs in **inside its own window**. There's no Turnstile page, no system browser and no WebView. Three methods share one transaction model:

| Method | Proof | Account |
|---|---|---|
| Password + email OTP | password + 6-digit code mailed to the account's **verified desktop mailbox** | `app_users` accounts (not the env owner) |
| QR | an already signed-in phone scans and approves | any account, **including the owner** |
| Passkey | WebAuthn assertion (Windows Hello / macOS / security key) | any account with a registered passkey, incl. owner |

All three return the same refreshable, DPoP-bound `nv3.` session.

## Activation (server config, no secrets in git)

| Variable | Value | Effect |
|---|---|---|
| `DESKTOP_NATIVE_V3_ENABLED` | `true` | v3 on (existing gate) |
| `DESKTOP_NATIVE_V3_PROD_APPROVED` | `true` | required in production (existing gate) |
| `DESKTOP_NATIVE_V3_NATIVE_LOGIN` | `true` | **new**: allows `presentation: "native"`, QR and passkey on v3 |
| `WEBAUTHN_ENABLED` | `true` | passkeys (web + desktop) |
| `APPLE_WEBCREDENTIALS_APP_IDS` | `TEAMID.bundle.id[,…]` | serves `/.well-known/apple-app-site-association` for macOS passkeys; 404 until set |

The existing v3 requirements still apply: the OTP and mailbox MAC keys (32+ chars each), the Resend transport, and the Turnstile keys used by the hosted modes.

`GET /api/auth/desktop/v3/capabilities` is the discovery endpoint. When the flag is on:
- `methods.password_otp.challenge_modes[0] === "native"`
- `methods.qr.available === true`
- `methods.passkey.available === true`; this one also requires `WEBAUTHN_ENABLED`.

Clients **must** read capabilities and show a disabled state with the reason when a method is unavailable. Never fall back to a browser.

## Common envelope

Every POST requires:
- `DPoP` header: an ES256 `dpop+jwt` signed by the device's P-256 key (keep it in the OS keychain), with:
  - `htm`, `htu` = exact URL without query
  - `iat`
  - a unique `jti`
  - `nonce` from `POST /nonce` (single use)
  - `atlas_txn` = `request_id` for transaction calls
- JSON body with only the listed keys (unknown keys → `400 INVALID_REQUEST`).

Proof fields (`P`) = `{ origin, request_id, state, code_verifier }`:
- `origin` = server origin
- `state` = 43–128 url-safe chars
- `code_verifier` = 43–128 chars, PKCE S256

Errors are `{ success:false, code, error }`. Codes:

| Code | Meaning |
|---|---|
| `INVALID_REQUEST` | bad body (400) |
| `INVALID_PROOF` | wrong DPoP key, nonce or PKCE (401) |
| `AUTH_FAILED` | generic credential failure (401) |
| `NOT_APPROVED` | request not usable (409) |
| `USED` | already consumed (409) |
| `EXPIRED` | expired (410) |
| `DENIED` | phone refused (410) |
| `RATE_LIMITED` | too many attempts (429, honour `Retry-After`) |
| `METHOD_DISABLED` | method switched off (503) |

## 1. Create a native request

```
POST /api/auth/desktop/v3/nonce                      → { data: { nonce } }
POST /api/auth/desktop/v3/requests   (DPoP)
{ origin, state, code_challenge, code_challenge_method:"S256", device_label, presentation:"native" }
→ 201 { data: { version:3, request_id, origin, presentation:"native", status:"verified",
               pairing_code, device_thumbprint, expires_in:300, interval:5 } }
```
- There is no `challenge_url`, so nothing opens.
- One request = one sign-in attempt; it's consumed by the first success or password try.
- It's bound to the device key **and** the same public IP.

## 2a. Password + OTP

```
POST /login/password (DPoP) { ...P, username, password }  → 200 { data:{ status:"otp_pending" } }
POST /login/otp      (DPoP) { ...P, otp:"123456" }         → 200 { data: SESSION }
POST /login/cancel   (DPoP) { ...P }                       → 200 { data:{ status:"cancelled" } }
```
- **Anti-enumeration:** a wrong password, unknown user or missing mailbox also returns `otp_pending`, and no mail is sent. The OTP step then fails with `AUTH_FAILED`.
- **OTP attempts:** 5 per login; codes are valid 5 min.
- **Budgets:**
  - per account: 20 / 10 min
  - per account+IP: 5 / 10 min
  - per IP, native only: 10 / 10 min and 40 / day
  - shared credential limiter
- **Mailbox:** the user must have enrolled a desktop mailbox once from an authenticated session (`/mailbox/enroll/*`). Without it the OTP never arrives. Show a hint like "Activez la connexion bureau depuis le site (Paramètres → Sécurité)".

## 2b. QR

```
POST /qr/start    (DPoP) { ...P } → 201 { data:{ status:"pending", qr_url, qr_svg, expires_in:≤120, interval:2 } }
POST /qr/exchange (DPoP) { ...P } → 202 { data:{ status:"pending"|"scanned", interval:2 } }
                                   → 200 { data: SESSION (method:"qr") }
                                   → 410 DENIED | EXPIRED · 409 USED
```
**Rendering the QR:** render `qr_url` natively (or use `qr_svg`).

**What happens on the phone:** the phone opens `/login/qr?t=…&mode=pc` (web or the Android app). The user must already be signed in there. They see "Autoriser l'ordinateur" and choose Accept or Refuse.

**Polling `/qr/exchange`:** call it every `interval` seconds with a fresh nonce and proof each time.

**When the QR expires:** create a **new request** plus `qr/start`, and auto-refresh the QR.

**Who can redeem:** only the device key that started the QR. The legacy `/api/auth/qr/session/:token/complete` returns `409 DESKTOP_EXCHANGE_REQUIRED` for these QR codes.

## 2c. Passkey

```
POST /webauthn/options (DPoP) { ...P, username? }
→ 200 { data:{ challenge, timeout, userVerification, allowCredentials:[{type,id,transports}], rpId, origin } }
POST /webauthn/verify  (DPoP) { ...P, credential:{ id, response:{ clientDataJSON, authenticatorData, signature, userHandle? } } }
→ 200 { data: SESSION (method:"passkey") }   · 401 AUTH_FAILED (challenge burned → call options again)
```

**Encoding:** all binary fields are base64url, unpadded. `userHandle` is base64url of the raw handle bytes.

**`clientDataJSON` content:** must be `{"type":"webauthn.get","challenge":<challenge>,"origin":<data.origin>,"crossOrigin":false}`.

The platform APIs set it as follows:
- **Windows** `webauthn.dll`: the app builds the JSON with `data.origin`.
- **macOS** `ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: rpId)`: sets `https://<rpId>` automatically. It needs the Associated Domains entitlement `webcredentials:<rpId>` and `APPLE_WEBCREDENTIALS_APP_IDS` on the server.
- **Linux** CTAP2 (USB/NFC keys): the app builds the JSON, hashes it, and sends `clientDataHash` to the key.

**Signature:** DER (what authenticators return) and raw `r‖s` are both accepted.

**Attempts:** one signature attempt per options call. Cancel or failure → call options again.

## SESSION

```json
{ "token_type":"DPoP", "access_token":"nv3.…", "refresh_token":"<64 hex>",
  "access_expires_at":"…", "session_expires_at":"…", "origin":"…", "username":"…", "role":"…",
  "session_id":"…", "device_thumbprint":"…", "attestation":"client_key_unattested", "method":"qr|passkey" }
```

**Using the access token:** send `Authorization: DPoP <access_token>` plus a DPoP proof with `ath`. Access tokens last 15 min; sessions last 12 h at most.

**Refresh:** `POST /session/refresh` (DPoP) with `{ origin, refresh_token }`. It rotates the refresh token. Reusing an old refresh token revokes the whole session family.

**Logout:** `POST /session/logout` (DPoP).

**Lost response:** if the client never receives SESSION (network drop), the attempt is spent. Start a new request. Don't retry the same request; it returns `USED`/`AUTH_FAILED` by design.

## Not provided (by design)

- **Owner password+OTP:** the env-configured owner has no `app_users` row or desktop mailbox. The owner signs in with QR (from their phone) or a passkey.
- **Hardware attestation:** none is claimed (`client_key_unattested`).
