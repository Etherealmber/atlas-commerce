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


## Follow-up validation on the merged backend

See [shared-egress staging validation](shared-egress-staging-validation.md) for
new two-account local regressions, exact failure classification and the gated
operator procedure. Live staging remains unexecuted: the checked-in Worker
preview shares production resource bindings and must not be used for intentional
failed sign-ins without isolation. Historical bans/scores are not blanket-reset;
Android countdown/retry behavior is not altered. The product stays at 0.8.1.
