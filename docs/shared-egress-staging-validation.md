# Shared-egress authentication: validation and staging handoff (0.8.1)

## Status and safety boundary

Reviewed backend base: `47c6eeaef772191fef5f0bb2b24f71fe9d8b6dd7`
(merged PR #167). This is the **backend checkout**, not the Android checkout.
This follow-up changes tests, release notes and documentation only; it does not
change authentication handlers, limiter thresholds, bindings, secrets or version.

**Live staging scenario: NOT EXECUTED.** No approved isolated staging URL, two
staging accounts or operator-controlled egress/inboxes were supplied. Remote
staging access is also outside this sandbox's permitted outbound hosts. The
local tests below are not evidence of staging deployment or actual VPN behavior.

**Do not use a Workers preview as staging without checking its bindings.**
`wrangler.jsonc` explicitly maps `previews.d1_databases`, `kv_namespaces`,
`r2_buckets` and `send_email` to the same resources as the production config.
Changing only `ENVIRONMENT` does not isolate data or email. A preview check passing
on GitHub is not authorization to create test accounts, send OTP mail or consume
production login budgets. No remote smoke/login/deployment was attempted here.

## Reviewed implementation

- `credentialAttemptGate` retains existing `blocked_until` and reputation-score
  <=10 denials. It does not distinguish an old automatically lowered score from
  an intentional operator/risk decision. It cannot safely auto-clear either.
- `reserveCredentialAttempt` uses persistent conditional SQL reservations, not
  client fingerprint trust or isolate-only counters. IP ceilings are 60/minute
  and 300/10 minutes; account-wide ceiling is 20/10 minutes; account/IP/purpose
  ceiling is 5/10 minutes. These count admissions, including successful requests.
- Password and OTP purposes have separate pair budgets; email code/link share
  the OTP purpose. Explicit endpoint matching replaces the old 8/minute shared
  gate only for login, verify-otp and verify-link.
- Scoped failures do not lower the entire shared IP's reputation. Legacy
  negative-reputation failures and explicit/low-score denials remain effective.
  Throttled traffic does not append another authentication failure.
- Password verification, OTP decisions, account binding, session checks and
  device revocation remain authoritative. The review-only Android device proof
  cannot suppress OTP. Historical resume/email-unavailable exceptions have not
  been widened or removed by this follow-up.
- No client countdown/retry change was implemented. The Android observations
  supplied by the operator (429 server message, no Retry-After countdown,
  generic non-retried 503) are not independently verified by these backend tests.

## New local two-account evidence

Three additional tests in `worker/__tests__/login-otp-always.test.ts` use actual
`app_users` rows for A and B, the actual Worker handlers and SQLite/D1 shim, one
simulated connecting IP, and a fake email sender:

1. Five incorrect A passwords return 401; the next A attempt returns
   `429 RATE_LIMITED`. B on that same IP still gets `needs_otp: true` with no
   token. Incorrect B OTP is rejected; correct B OTP issues B's role/fingerprint-
   scoped v2 token, accepted by a protected route. Replaying the OTP fails.
   B's success does not clear A's exhausted password budget.
2. A pre-existing low reputation score blocks **both** accounts with 429, sends
   no OTP and leaves score/failure count unchanged. No blanket reputation reset.
3. Expired B OTP cannot create a session, and A still requires OTP for its own
   password sign-in. The fixture does not establish device possession or bypass
   authentication because the fingerprint is known.

The existing suite also tests `503 AUTH_LIMIT_UNAVAILABLE` through local storage
fault injection and checks that it returns no token/email or raw DB error.
No real inbox, Android binary, Cloudflare D1, external proxy or VPN is used.

## Isolated staging procedure — operator required

### Preflight (stop if any prerequisite fails)

1. Approve a specific HTTPS staging origin and exact backend commit/build. Use
   an environment with **separate** D1, KV, R2, email destinations and any other
   writable services; inspect bindings, not the hostname or environment label.
   Do not deploy this repo's shared production preview config as a test stage.
2. Provision two non-privileged test accounts A/B with distinct staging inboxes
   through the authorized account-management process. No business/customer data.
   Keep credentials/OTP in the normal client or secure operator tooling, not
   chat, command arguments, shell history, screenshots, HAR or CI artifacts.
3. Use two controlled fresh client installations/profiles on the same router or
   VPN egress. Confirm the **server-observed** source IP is the same through an
   authorized private operator check; do not spoof CF-Connecting-IP/forwarded
   headers or accept a client IP assertion as proof. Test the actual Android
   client; if testing the web too, complete normal Turnstile. No native-marker
   impersonation to avoid browser protections.
4. Ensure neither profile has a resume marker, restored/saved session or prior
   OTP grant affecting the scenario. Use fresh test identities/installations
   rather than deleting production trust/session rows or altering 2FA policy.
   OTP delivery must be configured; the no-EMAIL fallback is not a valid test.
5. Privately review this egress's existing ban/score. If already denied, stop and
   have an operator review **that specific IP** using established controls.
   Do not clear all reputation data, lower thresholds or keep retrying. Wait for
   prior budget windows to expire naturally; make no bulk limiter-table reset.
6. Check `/api/health` and expected build identity. Health can pass while login
   is blocked: record it separately, not as authentication success.

### Controlled sequence

Use a quiet fixed-window period with no other test clients on that egress.
Record case labels and sanitized results, not raw HTTP bodies or identities.

| Case | Action | Required observation |
| --- | --- | --- |
| A1–A5 | Five deliberately wrong passwords for A | 401 BAD_PASSWORD; no token or OTP email |
| A6 | One more A attempt | 429 RATE_LIMITED; positive Retry-After; stop A retries |
| B1 | Correct B password, same real egress | 200 needs_otp=true; no token; mail to B's staging inbox |
| B2 | One incorrect B OTP | Rejection (normally 401 BAD_OTP); no token |
| B3 | Correct, fresh B OTP | B session issued; authenticated request succeeds with B identity/role |
| B4 | Replay the consumed B OTP without requesting a new one | Rejected; no second session issued |
| A7 | One A attempt after B succeeds | Still 429 before expiry; B success did not refund A's budget |
| Wait | Honor Retry-After and binding window, without automatic POST retry | No retry storm, no advancing/sliding ban from denied requests |
| A8 | Fresh explicit A sign-in after relevant limits expire | Normal password + OTP, never password-only because of fingerprint |

Stop on unexpected status, absent OTP, unexpected token before OTP, wrong actor,
wrong destination, or changes affecting non-test users. Observe token identity
inside trusted tooling only; do not dump bearer data into the result record.
Capture expiry/account-switch/revocation scenarios separately with fresh budgets.
Do not intentionally break remote D1 merely to obtain a 503; the local injected
storage-failure test covers that path. No authentication POST is automatically
retried after timeout, 429 or 503, including uncertain OTP redemption.

### Safe failure classification

| Response | Meaning / next step |
| --- | --- |
| 429 + RATE_LIMITED | Limiter admission, existing ban or low score; honor numeric Retry-After. Operator privately checks the binding bucket and the specific IP's score/ban. The generic response alone cannot identify which gate denied access. |
| 503 + AUTH_LIMIT_UNAVAILABLE | The credential admission check could not complete; inspect staging D1/schema/permissions/availability through authorized operations. No password/OTP bypass or tight retry. Missing trusted IP is another possible cause in this implementation. |
| 401 + BAD_PASSWORD | Verify account credentials/status through normal processes; no email/session expected. |
| 401 + BAD_OTP / 400 + OTP_EXPIRED / OTP_NOT_REQUESTED | Normal OTP rejection; restart explicitly if expired/missing. No token extraction or proof bypass. |
| 403 + TURNSTILE_FAILED | Browser challenge path/configuration; not evidence of IP throttling. Do not impersonate a native client. |
| 200 + needs_otp=true | Intermediate step, not authenticated success. |
| 200 + valid token, then protected-route 401 | Investigate session/account/device/revocation checks separately; do not relabel as limiter failure. |
| HTML, unexpected JSON, another code, TLS error or timeout | Record a fixed OTHER/transport category and status/type; investigate proxy/routing/TLS/response contract rather than automatically retrying login. |

Allowed evidence: scenario label, approved build reference, HTTP status,
allowlisted fixed code, stage, positive numeric Retry-After and pass/fail. Unknown
codes are categorized OTHER, not copied verbatim. Never retain passwords, OTPs,
tokens, private keys, complete login/verification URLs, headers/bodies, email
addresses or raw exception messages. Raw IP review stays with the operator.

### Result record

- Backend commit/build: operator to fill.
- Isolated bindings reviewed: NOT YET CONFIRMED.
- Controlled same server-observed egress: NOT YET CONFIRMED.
- A/B sequence, OTP mail delivery, protected request: NOT RUN IN STAGING.
- Existing score/ban reviewed: NOT RUN IN STAGING.
- Android retry/countdown behavior: NOT VERIFIED HERE; no client change.
- Operator approval and final staging decision: PENDING.

Until this record is completed, local checks do not justify claiming staging
passed or that a particular user's VPN sign-in failure has been resolved.

## Checks independently rerun in this backend checkout

- `npm ci --no-audit --no-fund`: completed using the committed lockfile.
- `npm test`: **468 tests / 29 files passed** (3 added backend regressions).
- `npm run lint`: **0 errors**, 848 existing warnings.
- `npm run build`: passed; client index and hashed JS bundle sanity passed.
- `npx tsc --noEmit --pretty false`: **71 Worker / 74 client errors**, within
  the recorded gates of 72 / 74. The repository-wide typecheck is not clean;
  passing the baseline gate is not a claim of zero TypeScript errors.
- `WRANGLER_SEND_METRICS=false npx wrangler deploy --dry-run --config wrangler.jsonc`:
  passed (bundle output directed outside Git). **Nothing deployed**.
- `git diff --check`: passed.

Authentication handlers, limiter implementation/thresholds, review-only proof,
Wrangler bindings, package/lockfile and product version files are unchanged.
The existing **0.8.1** release notes now describe the local scenario and staging
limitations; there is no new version or remote validation claim. No push or
remote deployment was performed in this follow-up.
