# Desktop v3: remembered session ("Rester connecté 30 jours")

This is the exact contract for the native desktop client (Rust). It extends the v3 native login described in
[`desktop-v3-auth-architecture.md`](desktop-v3-auth-architecture.md). Everything not listed here is unchanged.
That includes DPoP ES256 device-key binding, origin binding, PKCE/state, rotating refresh tokens with family reuse detection,
logout and revocation, and every rate limit.

There is no browser flow. A remembered session is an explicit per-login opt-in, and the server enforces its lifetime.

## 1. Lifetimes

| Session kind | Opt-in | Absolute expiry (server) | Access token |
|---|---|---|---|
| `standard` | `remember_me` absent or `false` | **12 h** after login (`43 200 s`) | 15 min, rotated by refresh |
| `remembered` | `remember_me: true` | **≤ 30 days** after login (`2 592 000 s`, or lower by policy) | 15 min, rotated by refresh |

- **Absolute expiry:** this is fixed at login. `session/refresh` **never** extends it. The access token expiry is `min(now + 15 min, session_expires_at)`.
- **Server-side cap:**
  - The server stores `remembered` (0/1) and `issued_at` (ms) on `desktop_v3_sessions`.
  - Every access-token check and every refresh rejects a row whose remaining lifetime, or whose `absolute − issued_at`, exceeds the policy cap.
  - The cap is 12 h for standard rows and the remember cap for remembered rows. A tampered or legacy row therefore cannot outlive policy.
- **Policy knob:** `DESKTOP_NATIVE_V3_REMEMBER_MAX_DAYS` (optional).
  - Unset means 30 days.
  - An integer `1–30` lowers the cap. Values above 30 are clamped to 30.
  - `0` (or anything invalid) disables remember-me.
  - Lowering the value takes effect immediately. A remembered session whose remaining lifetime is above the new cap is refused (`401 AUTH_FAILED` / `401 UNAUTHORIZED`), and the user signs in again.
- **Disabled policy:** if the policy is disabled and the client sends `remember_me: true`, the login still succeeds as a **standard** session. The response says `remember_me: false`. The client must trust the response, not its own checkbox.

## 2. Capabilities

`GET /api/auth/desktop/v3/capabilities`: when `enabled: true`, `data.session` is present:

```json
{
  "access_ttl_seconds": 900,
  "default_ttl_seconds": 43200,
  "absolute_expiry": true,
  "remember_me": {
    "available": true,
    "version": 1,
    "request_field": "remember_me",
    "default": false,
    "max_ttl_seconds": 2592000,
    "methods": ["password_otp", "qr", "passkey"],
    "endpoints": {
      "password_otp": "/api/auth/desktop/v3/login/otp",
      "qr": "/api/auth/desktop/v3/qr/exchange",
      "passkey": "/api/auth/desktop/v3/webauthn/verify"
    },
    "response_fields": ["remember_me", "session_kind", "session_expires_at", "refresh_expires_at", "session_ttl_seconds"]
  },
  "refresh": {
    "path": "/api/auth/desktop/v3/session/refresh",
    "rotating": true,
    "reuse_detection": "family_revocation",
    "dpop_bound": true,
    "origin_bound": true,
    "extends_absolute_expiry": false
  },
  "logout_path": "/api/auth/desktop/v3/session/logout"
}
```

- **Methods and endpoints:** `methods` and `endpoints` only list what is enabled. `qr` needs `DESKTOP_NATIVE_V3_NATIVE_LOGIN=true`. `passkey` also needs WebAuthn to be enabled.
- **Policy disabled:** `remember_me` is `{ "available": false, "reason": "POLICY_DISABLED" }`. **Hide the checkbox.**
- **v3 not enabled:** when `enabled: false`, `data.session` is absent.
- **Checkbox label:** show "Rester connecté N jours", where N = `max_ttl_seconds / 86400`. Do not hard-code 30.

## 3. Requests: where `remember_me` goes

`remember_me` is an optional JSON **boolean**. It is sent **only on the call that issues the session**:

| Method | Endpoint | Body (existing fields + `remember_me`) |
|---|---|---|
| Password + e-mail OTP | `POST /api/auth/desktop/v3/login/otp` | `{ origin, request_id, state, code_verifier, otp, remember_me }` |
| QR (phone approval) | `POST /api/auth/desktop/v3/qr/exchange` | `{ origin, request_id, state, code_verifier, remember_me }` (send the same value on every poll; the approved poll decides) |
| Windows Hello passkey | `POST /api/auth/desktop/v3/webauthn/verify` | `{ origin, request_id, state, code_verifier, credential, remember_me }` |

Rules:
- **Absent** means `false`. There is never an implicit remember.
- **Invalid type:** a non-boolean value (`"true"`, `1`, `null`, an object) gives `400 INVALID_REQUEST`. This check runs **before** the DPoP nonce, OTP attempt or request is consumed, so the client can fix the value and retry with the same request.
- **Rejected elsewhere:** `remember_me` on any other endpoint (for example `login/password`, `requests`, `qr/start`, `webauthn/options`) gives `400 INVALID_REQUEST`, because unknown fields are refused.
- **Headers unchanged:** DPoP proof with a fresh single-use nonce, `atlas_txn = request_id`, and the same device key that created the request.

## 4. Responses (`SessionTokensV3`)

All three login responses and the refresh response now include these extra fields:

```json
{
  "success": true,
  "data": {
    "token_type": "DPoP",
    "access_token": "nv3.<...>",
    "refresh_token": "<64-hex>",
    "access_expires_at": "2026-10-20T08:15:00.000Z",
    "session_expires_at": "2026-11-19T08:00:00.000Z",
    "origin": "https://stock.afmarbre.com",
    "username": "alice",
    "role": "secretaire",
    "session_id": "<64-hex>",
    "device_thumbprint": "<43-char JWK thumbprint>",
    "attestation": "client_key_unattested",
    "method": "password_otp",
    "remember_me": true,
    "session_kind": "remembered",
    "refresh_expires_at": "2026-11-19T08:00:00.000Z",
    "session_ttl_seconds": 2592000
  }
}
```

| Field | Type | Meaning |
|---|---|---|
| `method` | `"password_otp" \| "qr" \| "passkey"` | Login responses only. `password_otp` is new; `qr` and `passkey` already existed. |
| `remember_me` | boolean | What the server **granted**, which is not always what was asked. |
| `session_kind` | `"standard" \| "remembered"` | Same information as a string. |
| `session_expires_at` | ISO-8601 | Absolute expiry. Unchanged by refresh. |
| `refresh_expires_at` | ISO-8601 | Always equal to `session_expires_at`. The refresh token is unusable after it. |
| `session_ttl_seconds` | integer or `null` | Total lifetime (`absolute − issued`). `null` only for rows created before this change. |

`GET /api/auth/desktop/v3/sessions` items now also carry `remember_me` (boolean) and `issued_at` (ISO-8601 or `null`).

## 5. Client obligations (desktop)

1. **Storage:** only persist the refresh token when `remember_me` in the response is `true`.
   - Store it in the OS secret store: Windows Credential Manager / DPAPI, macOS Keychain, or Linux Secret Service.
   - Key the entry by `origin + username`.
   - Store `session_expires_at` next to it.
   - The DPoP private key must stay in the same secure store (or a non-exportable CNG/Keychain key). Without the same key the refresh token is useless (`401`).
2. **Standard sessions:** keep the tokens in memory only. Do not write them to disk.
3. **Startup:**
   - If there is a stored remembered entry and `now < session_expires_at`, call `session/refresh` with a fresh nonce and DPoP from the stored key.
   - On `200`, replace the stored refresh token **before** using the new access token, because rotation is single-use.
   - On `401`, delete the stored entry and show the login screen. Do not retry with the old token: replaying a retired token revokes the whole family.
   - On `429`, keep the entry and back off.
4. **Never refresh in parallel:** serialize refreshes with one in-flight refresh per session. Two concurrent refreshes with the same token look like reuse and revoke the session.
5. **Logout:** call `session/logout` with the current refresh token, then delete the stored entry and the device key binding for that account. The server revokes immediately.
6. **Expiry UI:** when `session_expires_at` is under 24 h away, the client may say "Session expire bientôt". There is no silent extension, so a new interactive login is required.
7. **Rate limits:** these are unchanged. Refresh is limited to 12 per session family per 10 min. Password, OTP and QR-poll budgets are unchanged. Do not refresh on a timer shorter than the access TTL; refresh when an API call returns `401` or just before `access_expires_at`.

## 6. Errors (unchanged codes)

| Status | Code | When |
|---|---|---|
| 400 | `INVALID_REQUEST` | `remember_me` not boolean, or sent to an endpoint that does not accept it |
| 401 | `AUTH_FAILED` | Refresh or logout with an expired, revoked, reused or over-policy session, or a wrong device key |
| 401 | `UNAUTHORIZED` | Access token expired, revoked or over policy |
| 429 | `RATE_LIMITED` | Existing budgets (for example 13th refresh in 10 min) |

## 7. Server tests

`worker/__tests__/desktop-v3-remember-me.test.ts` covers:
- the capabilities contract and policy (7 days, clamp at 30, disabled, v3 off)
- the 12 h default and expiry
- 30-day opt-in with refresh after a client and server restart (fresh isolate, same DB, same key), plus a stolen-key refusal
- the hard expiry at 30 days despite refreshes
- rotation and reuse detection revoking the family
- logout, admin `DELETE /sessions/:id` and password-change revocation
- QR, passkey and password/OTP opt-in vs default
- `remember_me` type validation without consuming state
- policy lowering capping existing sessions
- refusal of a tampered absolute expiry
- the 12-per-10-min refresh limit
- the additive column migration
