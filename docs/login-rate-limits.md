# Password and email-OTP admission on shared egress (0.8.1 follow-up)

## Diagnosis and scope

A successful `/api/health` only establishes service/D1 reachability. It does not
validate credentials or execute the login throttle. A sign-in failure must be
classified by its actual response: `429 RATE_LIMITED`, password rejection, OTP
requirement, Turnstile failure, service error or transport failure. No production
incident or specific VPN has been reproduced here.

The previous password/OTP paths combined an isolate-local **8 auth writes/minute
per IP** gate with **5 failed logins/10 minutes across all accounts on that IP**.
Failures also subtracted 8 reputation points; score <=10 could keep blocking
beyond the timed ban. Consequently five unrelated failures on a VPN/office/carrier
IP could deny another user. Rejected/throttled requests were themselves recorded
as failures, amplifying the condition.

This patch changes only admission/account attribution on:

- `POST /api/auth/login`
- `POST /api/auth/verify-otp`
- `POST /api/auth/verify-link`

No new endpoint, secret or version bump. Existing browser/native classification,
Turnstile, password validation, OTP requirement, resume exception, email-absent
exception, sessions, device proof review gate and revocation policy remain in
place. The review-only Android proof is still not enabled. Pending What's New
changes from the prior task are preserved, not extended with new claims here.

## Persistent multi-dimensional budgets

`worker/lib/credential-attempt-limits.ts` reserves D1 slots before password
verification or OTP verification. Every admitted request consumes capacity,
including successful requests, invalid requests and unknown accounts. Counting
admissions instead of failures bounds concurrent guesses and avoids an account
existence oracle in the limiter. No device fingerprint, native marker, client
proof claim, selected VPN or user agent increases the budget.

| Scope | Maximum | Fixed window |
| --- | ---: | --- |
| Shared source IP, all three endpoints | 60 attempts | 60 seconds |
| Shared source IP, all three endpoints | 300 attempts | 600 seconds |
| Normalized account, all source IPs and all three endpoints | 20 attempts | 600 seconds |
| Normalized account + source IP + purpose | 5 attempts | 600 seconds |

Purposes: `password` or `otp`. Code and email-link verification share `otp`
capacity, so switching between them does not buy extra guesses. The original
8/minute middleware is skipped **only** for these exact paths, because these
handlers apply the persistent budgets instead. Other auth paths retain their
original middleware limits and legacy reputation rules.

The shared ceiling is deliberately higher, not unlimited. These initial constants
are a security/usability trade-off, not a capacity claim. Legitimate crowds can
still hit 60/minute; repeated legitimate logins also consume the same-account
budget. A targeted attacker can temporarily exhaust one account's 20-attempt
budget across IPs: this is a bounded denial-of-service trade-off, not eliminated
by this design. Account compromise risk, email delivery cost and D1 cost must be
monitored before raising any threshold. Fixed windows can permit a boundary
burst; this is not a rolling-window guarantee.

D1/database identity is the existing deployment boundary. There is no new
client-supplied tenant or trusted origin. Deployments sharing one D1 also share
these counters conservatively. Username normalization matches the login handler
(trim/lowercase; full value, not a truncation attackers could rotate). Pending OTP
code attempts are charged to the server's login-context principal when present;
account substitution is rejected before token/device registration. Signed email
links likewise reject a claimed account that differs from their stored context.
Fingerprint remains a lookup aid in the existing OTP contract, not trust proof.

## Storage and atomicity

An idempotently created `credential_attempt_limits_v1` table stores a hashed
scope key, admission count and absolute expiry. No password, OTP, token, native
proof, raw username or raw IP is stored in this table. Scope hashes are
pseudonymous, **not secret or anonymous**; common usernames can be guessed.
Existing login audit/telemetry retains its existing data and retention policy.

Each bucket reservation is one conditional `INSERT ... ON CONFLICT ... UPDATE
... WHERE attempts < limit RETURNING` statement. Counters persist across Worker
isolates/restarts. The WeakSet is only a DDL optimization. A denied/saturated
bucket is not incremented and its expiry does not slide. Up to 100 expired rows
are cleaned per admitted evaluation; logical expiry is independent of cleanup.

Dimensions are checked from broad IP to narrow account/purpose; earlier slots
are not refunded if a later dimension denies. This intentionally errs toward
throttling, never grants extra capacity under concurrency, and bounds creation
of attacker-chosen account buckets behind IP limits. There is no all-dimension
rollback transaction. D1 failures produce a fixed-code, fail-closed 503 response;
no raw exception/credentials are logged by this limiter. Missing/unknown source
IP is rejected rather than admitting an unaccounted login.

Cloudflare supplies the trusted connecting IP. A deployment behind another
proxy must establish trusted forwarded-header handling; untrusted caller IP
headers must not be treated as a way to rotate limiter scope. This patch does
not change the existing `clientIp`/Cloudflare header policy.

## Reputation and legacy compatibility

- Existing `blocked_until` bans and scores <=10 still deny the three endpoints.
  They are **not** silently cleared on VPN changes or migration.
- Scoped password/OTP failures remain recorded as failures, but use
  `reputation_delta = 0`: they increment telemetry without lowering the whole
  egress IP's reputation for a few unrelated users. The new admission budgets
  provide their abuse boundary instead.
- Successful scoped authentication does not reset these admission counters or
  clear an explicit IP ban. Unknown accounts consume identical budgets.
- Throttled requests return without adding a login failure, degrading score,
  minting a session, sending email or changing the ban deadline.
- Legacy `isRateLimited` callers still enforce their historical five-failure
  rule, using negative-reputation failures. They exclude the newly budgeted
  delta-zero failures so a call to a legacy method cannot reintroduce the same
  cross-account IP poisoning. Existing negative historical failures, legacy
  method failures and prior low-score bans remain effective.
- Existing poisoned scores cannot be safely distinguished from intentional
  risk/admin decisions. Recovery requires operator review of the established
  IP-reputation management paths, not blanket deletion of reputation data.
  A timed ban may expire while a low score continues to deny access.

## Android/web response contract

Successful login/OTP envelopes and `needs_otp` are unchanged. Denied admission:

```json
{"success":false,"code":"RATE_LIMITED","error":"Trop de tentatives. Réessayez plus tard.","retry_after":60}
```

HTTP status: **429**, with the same positive integer `Retry-After` header. The
actual delay is to the binding bucket boundary, not always 60. For an existing
score-based block with no timed expiry, a 900-second retry hint does not promise
automatic recovery. Responses do not expose which account/bucket exists.

Limiter storage unavailable: HTTP **503**, `code: AUTH_LIMIT_UNAVAILABLE`, generic
French message. It is not a password error and must not cause rapid automatic
retries. Android can continue to handle existing 429 responses without changing
its request contract. Display/retry behavior for 503 is follow-up client work if
its generic server-error handling is insufficient. No APK was modified or built.

## Checks and operational rollout

Tests use the actual Worker routes and in-process SQLite/D1 shims, plus direct
conditional-SQL limiter tests. Coverage includes unrelated shared-IP failures
followed by valid password/OTP, limits beyond the old eight-write ceiling,
fingerprint/native-marker rotation, account/IP and account-wide exhaustion,
shared-IP spraying, both short/sustained IP ceilings, concurrent admission,
expiry, persistent connection wrappers, no sliding ban, no successful reset,
explicit/legacy bans, low reputation, fixed-code D1 failure, OTP account binding,
code/link budget sharing, signed-link success/replay and healthy health responses
despite login throttling. Real Cloudflare D1/load/VPN/device validation remains
necessary; local SQL simulation is not deployment proof.

Before production: run the existing deployment procedure with no secret changes;
confirm schema creation permissions; verify bounded retry UI; exercise accounts
A/B behind one controlled egress, abusive one-account attempts, distributed IPs,
explicit bans and legacy method limits. Inspect status/code/Retry-After and
aggregate counters, not credentials, bodies, tokens, OTPs or full verification
URLs. No change to production data, reputation values, deployment, release or
Android binary was performed by this patch.

### Local validation for this patch

- `npm test`: **465 tests / 29 files passed**, including 25 new backend tests
  for this limiter change (and the pending release-note tests from the prior task).
- `npm run build`: passed.
- `npm run lint`: **0 errors**, 848 pre-existing warnings. Sequential awaits in
  the limiter and ordered regression scenarios are intentional and annotated.
- `npx tsc --noEmit --pretty false`: 145 existing errors; diagnostics match the
  branch base after path/line normalization, with no new diagnostics.
- `git diff --check`: passed.
- Real VPN, Android binary, Cloudflare D1 load/concurrency, deployment: not run.


## Shared-egress staging validation and handoff (0.8.1)

### Status and safety boundary

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

### New local two-account evidence

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

### Isolated staging procedure — operator required

#### Preflight (stop if any prerequisite fails)

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

#### Controlled sequence

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

#### Safe failure classification

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

#### Result record

- Backend commit/build: operator to fill.
- Isolated bindings reviewed: NOT YET CONFIRMED.
- Controlled same server-observed egress: NOT YET CONFIRMED.
- A/B sequence, OTP mail delivery, protected request: NOT RUN IN STAGING.
- Existing score/ban reviewed: NOT RUN IN STAGING.
- Android retry/countdown behavior: NOT VERIFIED HERE; no client change.
- Operator approval and final staging decision: PENDING.

Until this record is completed, local checks do not justify claiming staging
passed or that a particular user's VPN sign-in failure has been resolved.

### Checks independently rerun in this backend checkout

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

## OTP email delivery diagnosis

`OTP_DELIVERY_FAILED` means no configured transport accepted the login message; it does not prove which provider failed or whether a previously accepted message reached an inbox. Login tries Resend when its key is present, then the Cloudflare EMAIL binding. Current configuration restricts that binding to its configured destination, while account/company email may choose another recipient: if Resend fails and the recipient differs, the fallback can be rejected. Do not redirect a user's code to a different inbox or disable OTP to work around this.

Check private Worker logs for `otp_resend_failed` (HTTP status only), `otp_resend_error`, `otp_binding_failed`, `otp_transport_unconfigured`, and `otp_email_failed_all_transports`; check provider sending/domain verification, the configured sender, binding destination and recipient, and suppression/bounce events. Do not put addresses, codes, tokens, API keys or message content in tickets/logs. An accepted send does not prove final delivery. Validate with an authorized test account and mailbox after deploying, including a non-default recipient. Demo `test/test` goes through the isolated sandbox and does not need email OTP; it still has its gateway/Turnstile checks. Neither the email configuration nor deployment is changed by these notes.
