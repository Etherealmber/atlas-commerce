# Atlas Commerce Desktop Authentication v3 — Architecture & Contract

## 1. Architecture Evaluation: Separate `rust/atlas-auth-core` vs `rust/atlas-finance-core`

- **`rust/atlas-finance-core` stays completely separate and untouched.** It compiles to `worker/wasm/atlas_finance_core.wasm` (`wasm32-unknown-unknown`) for deterministic server/client financial, invoice, payroll, and validation math (`vite.config.ts`, `scripts/build-finance-wasm.mjs`). Authentication logic must never be mixed into the finance engine.
- **The Cloudflare Worker (`worker/`) remains the single authoritative security boundary** for accounts (`app_users`), authorization/RBAC, Turnstile Siteverify, per-account OTP generation & Resend delivery, DPoP nonce/JTI replay prevention, session issuance/rotation/revocation, and abuse controls.
- **`rust/atlas-auth-core` (dedicated desktop Rust crate)** provides the shared, deterministic client-side protocol engine across Windows, macOS, and Linux (`atlas-commerce-desktop`):
  - Strict bare HTTPS `ServerOrigin` validation (`src/origin.rs`).
  - CSPRNG PKCE `S256` + `state` + `pairing_code` validation (`src/pkce.rs`) with `ZeroizeOnDrop`.
  - RFC 9449 `dpop+jwt` ES256 proof generation and RFC 7638 JWK thumbprint calculation (`src/dpop.rs`) behind a `DeviceKeyAdapter` trait.
  - Explicit state machine (`src/state.rs`) enforcing `TurnstileWebview` vs `SystemBrowser` with **no silent fallback**, and matching Serde DTOs (`src/schemas.rs`).
  - Secret-redacting error types (`src/error.rs`) that never print passwords, OTPs, PKCE verifiers, tokens, or private keys.
- **OS-specific adapters stay in `atlas-commerce-desktop`:** WebView hosting (WebView2 on Windows, WKWebView on macOS, WebKitGTK on Linux) and OS credential storage (`keyring` / Keychain / Credential Manager / Secret Service) live behind platform traits. Software and OS-keychain-backed keys report `SoftwareUnattested` / `OsKeychainUnattested` and **never claim hardware attestation**.

---

## 2. Trust Boundaries & Target Desktop Flow

1. **Discovery (`GET /api/auth/desktop/v3/capabilities`)**:
   - Returns `enabled: false, reason: "NOT_READY"` unless **all** gates are configured (`DESKTOP_NATIVE_V3_ENABLED === 'true'`, `DB.prepare` + `DB.batch`, Turnstile keys, `DESKTOP_NATIVE_V3_OTP_KEY` >= 32 chars, `DESKTOP_NATIVE_MAILBOX_MAC_KEY` >= 32 chars, dedicated `resend-v1` mail transport, and in `production` explicit `DESKTOP_NATIVE_V3_PROD_APPROVED === 'true'`).
   - Desktop v1, Desktop v2, Android, QR pairing, and website `v2|` sessions remain 100% intact.

2. **Device-Key Registration & Anti-Bot Challenge (`TurnstileWebview` or explicit `SystemBrowser`)**:
   - Desktop fetches a fresh server `dpop_nonce` (`POST /api/auth/desktop/v3/nonce`) and calls `POST /api/auth/desktop/v3/requests` signed with `DPoP` (`ES256`), PKCE `S256`, `state`, `device_label`, and explicit `presentation: "turnstile_webview" | "system_browser"`.
   - **`turnstile_webview`**: Desktop opens a small temporary OS WebView pointing **only** at `https://<origin>/login/desktop-v3-challenge#request_id=<id>`. The page enforces strict CSP (`default-src 'none'`, `frame-ancestors 'none'`, `challenges.cloudflare.com`), `Referrer-Policy: no-referrer`, `Cache-Control: no-store`, and contains zero password/OTP forms, cookies, storage, or desktop bridge. The page posts the Turnstile token directly to `POST /api/auth/desktop/v3/challenge/verify`; the Rust client never reads WebView cookies, storage, network bodies, or the Turnstile token.
   - **`system_browser`**: User explicitly chooses the system browser (`https://<origin>/login/desktop-v3-browser#request_id=<id>`), compares the `XXXXX-XXXXX` pairing code shown in Atlas Desktop, checks confirmation, and completes Turnstile. Automatic silent fallback between modes is forbidden.
   - Server verifies Turnstile Siteverify (`action: "atlas_desktop_v3"`, `cdata`, hostname) and requires same client IP (`browser_ip_hash == ip_hash`).

3. **Native Password & Per-Account Verified Mailbox OTP**:
   - After `challenge/poll` returns `status: "verified"`, the user enters username & password in native Rust fields → `POST /api/auth/desktop/v3/login/password` (with `DPoP` `atlas_txn` + PKCE `code_verifier` + `state`).
   - Server atomically consumes the `verified` challenge + DPoP `nonce`/`jti`, verifies PBKDF2-SHA-256 (`100,000` iterations) against `app_users` (`active = 1`), and looks up **`desktop_mailbox_verified_v1` (`active = 1`) ONLY** — **never falling back to `app_users.email` or the shared company inbox**.
   - Delivers a 6-digit HMAC-bound OTP (5-minute TTL, max 5 attempts) exclusively to that verified mailbox via the dedicated `resend-v1` transport, returning an anti-enumeration `{ status: "otp_pending" }`.

4. **Device-Bound Sessions (`nv3.`), Refresh Rotation, & Revocation**:
   - `POST /api/auth/desktop/v3/login/otp` issues an opaque `nv3.` access token (`15 min` TTL) and `refresh_token` (`12 h` absolute TTL) bound to `device_thumbprint`, `origin`, `user_id`, and live `credential_tag`.
   - Every API call using `Authorization: Bearer nv3.<...>` MUST carry a matching `DPoP` JWT (`htm`, bare `htu`, `ath`, `nonce`, unique `jti`).
   - `POST /api/auth/desktop/v3/session/refresh` rotates both tokens and records old refresh hashes in `desktop_v3_refresh_history`; any reuse immediately revokes the entire session family.
   - `POST /api/auth/desktop/v3/session/logout` and `DELETE /api/auth/desktop/v3/sessions/:id` revoke sessions server-side immediately and record `auth.logout` / `auth.desktop_v3_session_revoke` audit entries.
   - SQLite triggers (`desktop_v3_account_update`, `desktop_v3_account_delete`, `desktop_mailbox_account_update_v1`, `desktop_mailbox_account_delete_v1`) revoke live v3 sessions and suspend verified mailboxes whenever account credentials, role, active state, or directory email change.

5. **Verified Mailbox Enrollment & Admin-Approved Recovery**:
   - Authenticated users enroll or change their mailbox via `GET /api/auth/desktop/v3/mailbox/status`, `POST /api/auth/desktop/v3/mailbox/enroll/start`, and `POST /api/auth/desktop/v3/mailbox/enroll/confirm` (requiring an active authenticated session AND fresh password verification; mailbox changes require codes sent to **both** the previous verified mailbox and the new mailbox).
   - Lost-mailbox recovery uses `POST /api/auth/desktop/v3/mailbox/recovery/request` (authenticated user + fresh password) followed by `POST /api/auth/desktop/v3/mailbox/recovery/approve` (owner/admin + fresh password), which clears the suspended/lost mailbox and revokes active v3 sessions so the user re-enrolls cleanly.

---

## 3. Exact API Surface (`/api/auth/desktop/v3/*`)

| Method & Path | Auth Gate | Purpose |
|---|---|---|
| `GET /api/auth/desktop/v3/capabilities` | Public (HTTPS) | Versioned feature/readiness discovery |
| `POST /api/auth/desktop/v3/nonce` | Public (HTTPS, IP-budgeted) | Issues `120s` `dpop_nonce` |
| `POST /api/auth/desktop/v3/requests` | DPoP (single-use nonce+JTI) + PKCE | Creates challenge request (`turnstile_webview` or `system_browser`) |
| `POST /api/auth/desktop/v3/challenge/prepare` | Origin-checked hosted page | Supplies Turnstile `site_key`, `action`, `cdata`, `pairing_code` |
| `POST /api/auth/desktop/v3/challenge/verify` | Origin-checked hosted page | Verifies Turnstile Siteverify + same-IP binding |
| `POST /api/auth/desktop/v3/challenge/poll` | DPoP + PKCE `state` + `code_verifier` | Polls challenge state (`5s` minimum interval) |
| `POST /api/auth/desktop/v3/challenge/cancel` | DPoP + PKCE `state` + `code_verifier` | Cancels pending/verified challenge |
| `POST /api/auth/desktop/v3/login/password` | DPoP (`atlas_txn`) + PKCE + verified req | Verifies PBKDF2 password + dispatches per-account OTP |
| `POST /api/auth/desktop/v3/login/otp` | DPoP (`atlas_txn`) + PKCE | Verifies OTP + issues `nv3.` DPoP-bound tokens |
| `POST /api/auth/desktop/v3/login/cancel` | DPoP + PKCE | Cancels pending OTP login |
| `POST /api/auth/desktop/v3/session/refresh` | DPoP (matching `device_thumbprint`) | Rotates tokens + revokes family on replay |
| `POST /api/auth/desktop/v3/session/logout` | DPoP (matching `device_thumbprint`) | Revokes session server-side + audits `auth.logout` |
| `GET /api/auth/desktop/v3/mailbox/status` | Authenticated `/api/*` session | Returns masked verified mailbox & recovery status |
| `POST /api/auth/desktop/v3/mailbox/enroll/start` | Authenticated + fresh password | Starts verified mailbox enrollment/change |
| `POST /api/auth/desktop/v3/mailbox/enroll/confirm` | Authenticated + fresh password | Confirms OTP(s) and activates verified mailbox |
| `POST /api/auth/desktop/v3/mailbox/recovery/request` | Authenticated + fresh password | Opens `15 min` admin-approval recovery request |
| `POST /api/auth/desktop/v3/mailbox/recovery/approve` | Owner/Admin + fresh password | Clears mailbox + revokes active v3 sessions |
| `GET /api/auth/desktop/v3/sessions` | Authenticated `/api/*` session | Lists active v3 sessions for user (or all for owner/admin) |
| `DELETE /api/auth/desktop/v3/sessions/:id` | Authenticated `/api/*` session | Revokes specific v3 session (self or owner/admin) |

---

## 4. Preview Isolation & Production Safety

- `wrangler.jsonc` sets `"preview_urls": false` and isolates `"previews"` to local/preview-only non-production D1, KV, and R2 identifiers (no production D1/KV/R2 IDs and no production `send_email` binding), with `"DESKTOP_NATIVE_V3_ENABLED": "false"`.
- Production rollout remains disabled (`enabled: false, reason: "NOT_READY"`) until:
  1. `DESKTOP_NATIVE_V3_ENABLED="true"`, `DESKTOP_NATIVE_V3_PROD_APPROVED="true"`, `DESKTOP_NATIVE_V3_OTP_KEY`, `DESKTOP_NATIVE_MAILBOX_MAC_KEY`, `DESKTOP_NATIVE_MAIL_TRANSPORT="resend-v1"`, `DESKTOP_NATIVE_RESEND_API_KEY`, and `DESKTOP_NATIVE_MAIL_FROM` are provisioned in Cloudflare Worker secrets/vars; and
  2. `atlas-commerce-desktop` integrates `rust/atlas-auth-core` + OS keychain/WebView adapters and passes real OS validation on Windows, macOS, and Linux.
