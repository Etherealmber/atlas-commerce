# Atlas Commerce Desktop Authentication v3 — Architecture & Client Contract

## 1. Architecture Evaluation: Separate `rust/atlas-auth-core` vs `rust/atlas-finance-core`

- **`rust/atlas-finance-core` stays completely separate and untouched.** It compiles to `worker/wasm/atlas_finance_core.wasm` (`wasm32-unknown-unknown`) for deterministic server/client financial, invoice, payroll, and validation math (`vite.config.ts`, `scripts/build-finance-wasm.mjs`). Authentication logic must never be mixed into the finance engine.
- **The Cloudflare Worker (`worker/`) remains the single authoritative security boundary** for accounts (`app_users`), authorization/RBAC, Turnstile Siteverify, per-account OTP generation & Resend delivery, DPoP nonce/JTI replay prevention, session issuance/rotation/revocation, and abuse controls.
- **`rust/atlas-auth-core` (dedicated desktop Rust crate)** provides the shared, deterministic client-side protocol engine across Windows, macOS, and Linux (`atlas-commerce-desktop`):
  - Strict bare HTTPS `ServerOrigin` validation (`src/origin.rs`).
  - CSPRNG PKCE `S256` + `state` + `pairing_code` validation (`src/pkce.rs`) with `ZeroizeOnDrop`.
  - RFC 9449 `dpop+jwt` ES256 proof generation (`build_dpop_proof`), RFC 7638 JWK thumbprint calculation (`jwk_thumbprint`), and protected-request header construction (`authorization_header_for_token`, `build_protected_request_headers` emitting `Authorization: DPoP nv3.<...>` + `DPoP: <jwt>`) behind `DeviceKeyAdapter` (`src/dpop.rs`).
  - Explicit state machine (`src/state.rs`: `Idle -> AwaitingChallenge -> ChallengeVerified -> AwaitingOtp -> Authenticated -> LoggedOut | Cancelled | Failed`) enforcing `TurnstileWebview` vs `SystemBrowser` with **no silent fallback**, and matching Serde DTOs (`src/schemas.rs`).
  - Secret-redacting error & `Debug` types (`src/error.rs`, `src/schemas.rs`) that never print passwords, OTPs, PKCE verifiers, tokens, or private keys.
- **OS-specific adapters stay in `atlas-commerce-desktop`:** WebView hosting (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux) and OS credential storage (`keyring` / Keychain / Credential Manager / Secret Service) live behind platform traits. Software and OS-keychain-backed keys report `SoftwareUnattested` / `OsKeychainUnattested` and **never claim hardware attestation**.

---

## 2. Authorization Scheme & Transport Contract (RFC 9449 `DPoP`)

Desktop v3 standardizes strictly on **RFC 9449 `DPoP` sender-constrained tokens**:

- Token responses (`/login/otp`, `/session/refresh`) issue `token_type: "DPoP"` and `access_token: "nv3.<username>.<role>.<hex64>"`.
- **Every protected API request** using an `nv3.` access token **MUST** send **both**:
  - `Authorization: DPoP nv3.<...>`
  - `DPoP: <dpop+jwt>` (signed with the same P-256 key, including `jti`, `htm`, bare `htu`, `iat` within ±120s, fresh server `nonce`, and `ath = base64url(sha256(access_token))`)
- **`Authorization: Bearer nv3.<...>` is unconditionally rejected (`401 UNAUTHORIZED`)** across all routes, `/api/reports/*`, `/api/auth/*`, and `/api/auth/me`.
- Legacy website (`stock-auth-v2`), Capacitor Android (`stock-auth-v2`), QR login, and staging pilot (`np1.`) continue using `Authorization: Bearer <...>` without any change; `Authorization: DPoP <non-nv3>` is rejected (`401`).
- Worker CORS explicitly allows `DPoP` in `Access-Control-Allow-Headers`.
- Worker D1 session routing (`withSession('first-primary')`) and `DB_TARGET` cutover routing detect `DPoP nv3.` (and fail closed with `503 UNAVAILABLE` / `SERVICE_UNAVAILABLE` if a primary session cannot be acquired; never falls back to a read replica).
- `GET /api/auth/me` with `DPoP nv3.` omits the legacy `token` field and does not touch `trusted_devices`.

---

## 3. Required Headers, Exact Client Schemas, and Error Codes

### 3.1 Required HTTP Headers by Endpoint Group

| Endpoint Group | Required Request Headers |
|---|---|
| `GET /api/auth/desktop/v3/capabilities` | HTTPS origin (`https://...`), `Accept: application/json` |
| `POST /api/auth/desktop/v3/nonce` | HTTPS origin, `Content-Type: application/json` (`{}`) |
| Desktop proof POSTs (`/requests`, `/challenge/poll`, `/challenge/cancel`, `/login/password`, `/login/otp`, `/login/cancel`, `/session/refresh`, `/session/logout`) | `Content-Type: application/json`, `DPoP: <dpop+jwt>` (with single-use `nonce`; `/login/*` & `/challenge/poll\|cancel` also require `atlas_txn: <request_id>` in `DPoP`) |
| Hosted challenge page POSTs (`/challenge/prepare`, `/challenge/verify`) | `Content-Type: application/json`, same-site `Origin: https://<host>` + `Sec-Fetch-Site: same-origin` |
| Protected API requests (`GET /api/auth/me`, `/api/products`, `/api/auth/desktop/v3/sessions*`, `/api/auth/desktop/v3/mailbox/*`) | `Authorization: DPoP nv3.<access_token>`, `DPoP: <dpop+jwt>` (with `ath` claim & fresh `nonce`), `Content-Type: application/json` (for JSON bodies) |
| Legacy Web/Phone mailbox & admin calls | `Authorization: Bearer <stock-auth-v2>`, `X-Device-Fingerprint: <fp>`, `Content-Type: application/json` |

### 3.2 Exact Request & Response Schemas

All JSON responses follow the Worker envelope:
- Success: `{ "success": true, "data": <T> }`
- Error: `{ "success": false, "code": "<ERROR_CODE>", "error": "<localized message>" }`

1. **`GET /api/auth/desktop/v3/capabilities`** (`CapabilitiesV3Response`):
   ```json
   {
     "success": true,
     "data": {
       "version": 3,
       "enabled": true,
       "methods": {
         "password_otp": {
           "available": true,
           "challenge_modes": ["turnstile_webview", "system_browser"],
           "automatic_fallback": false,
           "otp_required": true,
           "dpop_required": true,
           "verified_mailbox_required": true
         },
         "mailbox_enrollment": { "available": true },
         "recovery": { "available": true },
         "device_proof": { "available": true, "hardware_attestation_claimed": false }
       }
     }
   }
   ```
   When disabled: `{ "success": true, "data": { "version": 3, "enabled": false, "reason": "NOT_READY", "methods": { ... } } }`.

2. **`POST /api/auth/desktop/v3/nonce`** (`NonceResponse`):
   - Request: `{}`
   - Response (`200`): `{ "success": true, "data": { "nonce": "<43-char base64url>", "expires_in": 120 } }`

3. **`POST /api/auth/desktop/v3/requests`** (`CreateRequestV3Body` -> `CreateRequestV3Response`):
   - Request (`DPoP` single-use nonce):
     ```json
     {
       "origin": "https://stock.afmarbre.com",
       "state": "<43-char base64url>",
       "code_challenge": "<43-char base64url S256>",
       "code_challenge_method": "S256",
       "device_label": "Poste Bureau",
       "presentation": "turnstile_webview"
     }
     ```
     (`presentation` is `"turnstile_webview"` or `"system_browser"`.)
   - Response (`201`):
     ```json
     {
       "success": true,
       "data": {
         "version": 3,
         "request_id": "<64-hex>",
         "origin": "https://stock.afmarbre.com",
         "presentation": "turnstile_webview",
         "challenge_url": "https://stock.afmarbre.com/login/desktop-v3-challenge#request_id=<64-hex>",
         "pairing_code": "XXXXX-XXXXX",
         "device_thumbprint": "<43-char JWK SHA-256>",
         "expires_in": 300,
         "interval": 5
       }
     }
     ```

4. **`POST /api/auth/desktop/v3/challenge/poll`** (`ChallengePollResponse`):
   - Request (`DPoP` single-use nonce + `atlas_txn = request_id`): `{ "origin": "https://stock.afmarbre.com", "request_id": "<64-hex>", "state": "<43-char base64url>", "code_verifier": "<43-char base64url>" }`
   - Response (`200`):
     ```json
     {
       "success": true,
       "data": {
         "status": "pending|verifying|verified|denied|failed|cancelled|consumed",
         "request_id": "<64-hex>",
         "origin": "https://stock.afmarbre.com",
         "interval": 5
       }
     }
     ```

5. **`POST /api/auth/desktop/v3/login/password`** (`PasswordLoginRequestV3` -> `PasswordLoginResponseV3`):
   - Request (`DPoP` single-use nonce + `atlas_txn = request_id`):
     ```json
     {
       "origin": "https://stock.afmarbre.com",
       "request_id": "<64-hex>",
       "state": "<43-char base64url>",
       "code_verifier": "<43-char base64url>",
       "username": "alice",
       "password": "<secret>"
     }
     ```
   - Response (`200`, anti-enumeration): `{ "success": true, "data": { "status": "otp_pending" } }`

6. **`POST /api/auth/desktop/v3/login/otp`** (`OtpLoginRequestV3` -> `SessionTokensV3`):
   - Request (`DPoP` single-use nonce + `atlas_txn = request_id`):
     ```json
     {
       "origin": "https://stock.afmarbre.com",
       "request_id": "<64-hex>",
       "state": "<43-char base64url>",
       "code_verifier": "<43-char base64url>",
       "otp": "123456"
     }
     ```
   - Response (`200`):
     ```json
     {
       "success": true,
       "data": {
         "token_type": "DPoP",
         "access_token": "nv3.alice.secretaire.<64-hex>",
         "refresh_token": "<64-hex>",
         "access_expires_at": "2026-10-20T00:15:00.000Z",
         "session_expires_at": "2026-10-20T12:00:00.000Z",
         "origin": "https://stock.afmarbre.com",
         "username": "alice",
         "role": "secretaire",
         "session_id": "<64-hex>",
         "device_thumbprint": "<43-char JWK SHA-256>",
         "attestation": "client_key_unattested"
       }
     }
     ```

7. **`POST /api/auth/desktop/v3/session/refresh`** (`RefreshRequestV3` -> `SessionTokensV3`):
   - Request (`DPoP` single-use nonce + matching `device_thumbprint`):
     `{ "origin": "https://stock.afmarbre.com", "refresh_token": "<64-hex>" }`
   - Response (`200`): `SessionTokensV3` with rotated `access_token` & `refresh_token` (`token_type: "DPoP"`).

8. **`POST /api/auth/desktop/v3/session/logout`** (`LogoutRequestV3` -> `LogoutResponseV3`):
   - Request (`DPoP` single-use nonce + matching `device_thumbprint`):
     `{ "origin": "https://stock.afmarbre.com", "refresh_token": "<64-hex>" }`
   - Response (`200`): `{ "success": true, "data": { "status": "revoked" } }`

9. **Mailbox & Session Management (`/api/auth/desktop/v3/mailbox/*`, `/sessions*`)**:
   - `GET /mailbox/status` -> `{ enrolled, active, masked_address, verified_at?, recovery_pending, recovery_request_id?, owner_supported? }`
   - `POST /mailbox/enroll/start` (`{ password, email }`) -> `201 { request_id, expires_in }`
   - `POST /mailbox/enroll/confirm` (`{ password, request_id, new_code, old_code? }`) -> `200 { enrolled: true }`
   - `POST /mailbox/recovery/request` (`{ password, reason }`) -> `201 { recovery_id, status: "pending_admin_approval", expires_in }`
   - `POST /mailbox/recovery/approve` (`{ password, recovery_id }`) -> `200 { status: "approved", username }`
   - `GET /sessions` -> `200 [{ id, origin, username, role, device_thumbprint, device_label, last_used_at, expires_at }]`
   - `DELETE /sessions/:id` -> `200 { status: "revoked", id }`

### 3.3 Exact Error Codes

| HTTP Status | `code` | Meaning |
|---|---|---|
| `400` | `HTTPS_REQUIRED` | Request did not arrive over `https:` |
| `400` | `INVALID_REQUEST` | Malformed JSON, unknown field, invalid label/PKCE/UUID/OTP format |
| `400` | `ORIGIN_MISMATCH` | Body/DPoP origin does not match request/allowed origin |
| `400` | `ENROLLMENT_REJECTED` | Mailbox enrollment/confirm failed validation, delivery, or session commit guard |
| `400` | `USE_NATIVE_LOGOUT` | `np1.`/`nv3.` token presented to legacy `POST /api/auth/logout` |
| `401` | `UNAUTHORIZED` | Missing/invalid/revoked/expired access token or `Bearer nv3.` scheme misuse |
| `401` | `INVALID_DPOP` | Missing/invalid `DPoP` proof, expired/consumed `nonce`, JTI replay, `htu`/`htm`/`ath`/`atlas_txn` mismatch |
| `401` | `AUTH_FAILED` | Generic failure on `login/password`, `login/otp`, `session/refresh`, `session/logout` |
| `403` | `FORBIDDEN` | Insufficient role, self-approval attempt, peer-admin approval of `admin`, or `owner` native enrollment/recovery |
| `403` | `NOT_APPROVED` | Challenge has not reached `verified` state |
| `404` | `NOT_FOUND` | Unknown request, session, or pending recovery |
| `409` | `USED` | Request/challenge already consumed or cancelled |
| `409` | `ROLE_CHANGED` | Legacy `stock-auth-v2` token has stale role (must use `/api/auth/role-refresh`) |
| `429` | `SLOW_DOWN` | Challenge poll interval `< 5s` |
| `429` | `RATE_LIMITED` | IP / account credential / create budget exceeded |
| `503` | `METHOD_DISABLED` | Desktop v3 feature gate/keys/transport not configured |
| `503` | `UNAVAILABLE` / `SERVICE_UNAVAILABLE` | Primary D1 session unavailable (`withSession('first-primary')`) or OTP dispatch failed |

---

## 4. Secure Session Lifecycle & Revocation Guarantees

1. **Desktop v3 (`nv3.`) lifecycle**:
   - `access_token` (`15 min`) and `refresh_token` (`12 h` absolute max) are stored server-side only as SHA-256 digests (`access_hash`, `refresh_hash`) in `desktop_v3_sessions`.
   - `POST /session/refresh` atomically rotates both tokens and moves the retired `refresh_hash` into `desktop_v3_refresh_history`; any replay by the device key revokes the entire session family (`revoked = 1`).
   - `POST /session/logout` and `DELETE /sessions/:id` revoke sessions server-side (`revoked = 1`); subsequent `GET /api/auth/me` or business calls fail immediately (`401`).
   - SQLite triggers (`desktop_v3_account_update`, `desktop_v3_account_delete`, `desktop_mailbox_account_update_v1`, `desktop_mailbox_account_delete_v1`) automatically revoke active v3 sessions and suspend verified mailboxes when `app_users` password, role, active flag, or directory email changes.
2. **Legacy Web/Phone (`stock-auth-v2`) logout & mailbox race closure**:
   - `makeTokenV2` appends a per-session random 128-bit `sid` (`stock-auth-v2|<user>|<role>|<ip>|<fp>|<proof>|<sid>`), while `parseToken` + `makeSessionProof` remain backward-compatible with legacy 6-part tokens.
   - `POST /api/auth/logout` atomically persists `sha256(token)` into `revoked_web_tokens` (failing closed `503` on DB error) AND preserves the 30-day `trusted_devices.resume_until` marker for password-only same-device re-login (which mints a fresh `sid` so the logged-out token remains permanently revoked).
   - `authFailReason` rejects any token present in `revoked_web_tokens` across all routes (including `/api/auth/me`, `/api/reports/*`, print routes, `/api/auth/role-refresh`, and `/api/auth/desktop/v3/mailbox/*`).
   - `desktop-mailbox-enrollment.ts` (`start()` during 5s mail delivery and `confirm()` atomic `db.batch`) and `desktopNativeV3.ts` (`/mailbox/recovery/request` and `/approve`) enforce live SQL `commitGuard` predicates (`NOT EXISTS (SELECT 1 FROM revoked_web_tokens ...)` for web Bearer sessions, `EXISTS (SELECT 1 FROM desktop_v3_sessions ...)` for `DPoP nv3.` sessions), closing concurrent logout-vs-enrollment races.

---

## 5. Independent-Approval Recovery Policy

1. **Self-approval is unconditionally forbidden (`403 FORBIDDEN`)** — enforced in both handler logic and the atomic SQL `UPDATE desktop_mailbox_recovery_v1 ... WHERE lower(username) != ?`.
2. **Privileged-account (`admin`) recovery requires independent `owner` approval (`403 FORBIDDEN` for peer `admin`)** — enforced against live `app_users.role` inside both handler checks and the atomic SQL `WHERE` clause (`? = 'owner' OR u.role IN ('user','stock','secretaire')`).
3. **Non-privileged (`user`, `stock`, `secretaire`) recovery** requires an independent `owner` or `admin` with fresh password re-verification.
4. **Lost-owner recovery fails closed (`403 FORBIDDEN`)**: the environment-configured sole `owner` has `userId: null`, no `app_users` record, and `owner_supported: false` on `/mailbox/status`. Owner native enrollment and recovery remain blocked until pre-enrolled single-use offline recovery codes and a separate break-glass controller are designed, reviewed, and provisioned.

---

## 6. Test Coverage: Simulated Harness vs Real Infrastructure

### Simulated / In-Process Test Harness (`vitest` + `cargo test`)
- **Database**: In-memory `node:sqlite` shim implementing D1 `prepare`/`bind`/`batch` and pass-through `withSession()` (does not exercise Cloudflare's distributed D1 primary/read-replica network propagation).
- **Turnstile**: Mocked `globalThis.fetch` intercepting `https://challenges.cloudflare.com/turnstile/v0/siteverify`.
- **Email transport**: Mocked `globalThis.fetch` intercepting `https://api.resend.com/emails` (captures OTP text in memory).
- **Device key**: `SoftwareP256Key` (`rust/atlas-auth-core`) or WebCrypto ephemeral P-256 key (`SoftwareUnattested`), driven against the real Hono Worker (`app.fetch()`) via `rust/atlas-auth-core/examples/contract_driver.rs` in `worker/__tests__/desktop-v3-rust-contract.test.ts` (enforced in CI via `ATLAS_REQUIRE_AUTH_CORE_CONTRACT=1`).

### Real Production / Desktop Infrastructure (Not Covered by In-Process Mocks)
- Live **Cloudflare D1** global read-replication latency and `first-primary` session bookmarks (`x-d1-bookmark`).
- Live **Cloudflare Turnstile** widget rendering and Siteverify checks inside real WebView2 / WKWebView / WebKitGTK and system browsers.
- Live **Resend** verified-domain DKIM/SPF delivery and inbox receipt.
- Native OS keychain / TPM / Secure Enclave key adapters and desktop UI in **`atlas-commerce-desktop`**.
