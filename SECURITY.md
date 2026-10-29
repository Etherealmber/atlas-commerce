# Security Policy — Atlas Commerce

© 2026 loxdpsy — MIT — current beta: see README « Version actuelle » (stable target: 1.0.0)

## Supported Versions

<!-- SUPPORT-SYNC:supported:start -->
| Version        | Supported          |
| -------------- | ------------------ |
| 0.7.x (beta)   | :white_check_mark: |
| 0.6.x and older| :x:                |
| 1.0.0 (future) | :white_check_mark: at release |

**Policy:** only the current minor (**0.7**) is supported. When the next minor
ships (e.g. 0.8.0), the previous minor reaches end of support immediately —
0.6.x ended with the 0.7.0 release. Only the latest beta on `main` receives
security updates. Production runs the Cloudflare Worker build of `main`;
previews run per-branch sandboxes.
<!-- SUPPORT-SYNC:supported:end -->

## Reporting a Vulnerability

- Email **security@afmarbre.com** (or contact the maintainer, loxdpsy, on GitHub).
- Expect an acknowledgement within **48 h** and a status update every 7 days.
- Accepted reports are fixed on a private branch, shipped with a version bump
  and a changelog entry under `fixes`; declined reports get a written rationale.
- Please include: endpoint or component, minimal reproduction, and whether
  production or preview is affected. Do **not** open public issues for exploits.

## Authentication & Sessions

- Passwords: PBKDF2-SHA256 (`pbkdf2$<iterations>$<hex>`), per-user salt,
  automatic re-hash on login when parameters evolve.
- Sessions: HMAC-signed tokens bound to IP + device fingerprint; rotation of
  signing secrets (automated, DB-backed, previous secret accepted briefly).
- New-device logins require a **6-digit OTP** (10 min, single use). In
  `ENVIRONMENT=production` OTP codes are **never** returned by any API
  response — they travel only by e-mail (Resend, fallback Cloudflare
  send_email). Local/dev builds may surface the code so flows are testable.
- Owner actions: 2FA (TOTP) and OTP-gated destructive operations (account,
  agent data, products), plus WebAuthn passkeys and a connected-devices
  manager with per-device revocation.
- Login reputation gate: per-IP score, progressive blocks, rate limits on
  auth endpoints; audit log for every auth event.

## Application Firewall & Abuse Controls

- In-worker WAF on `/api/*`: request-line signatures for SQLi
  (`union select`, `information_schema`, `sleep(`…), path traversal
  (`../etc/passwd`, `/proc/self/…`), reflected-XSS probes (`<script`,
  `javascript:`, `onerror=`) and log4j/jndi → `403 WAF_BLOCKED`.
- Counters exposed on `GET /api/canary` (blocked count, last signature).
- Per-bucket rate limits (auth, agent threads 180/min, general API).
- Cloudflare edge (WAF managed ruleset, TLS, bot fight) sits in front of the
  Worker; enable the free managed ruleset in the dashboard for defence in depth.

## Atlas Agent Governance

- Prompt-injection tripwire: client-side detection flags the session; the
  agent is locked until an admin restores it; incidents journaled.
- Token quotas (daily/weekly) enforced server-side in a Durable Object and
  journaled in D1 (`agent_usage_log`) — real prompt+completion tokens, owner
  audit endpoint, admins exempt.
- Permissions modes (full / read-only / custom) owner-managed from Settings.
- Conversations persisted per user in R2 **AES-GCM encrypted at rest**
  (`agent/{userKey}/{thread}.agent`), capped (80 messages, 1.5 MB blob guard),
  purged by OTP-gated delete; thread ids and user keys sanitized.
- Attached images: data-URL only, ≤4 per request, ≤3.5 MB each (Groq limits),
  sent exclusively to the configured LLM provider over TLS.

## Data & Backups

- D1 holds business data; backups to R2 with signature + timestamp headers
  (`X-Backup-Signature`, `X-Backup-Timestamp`), owner-only restore.
- D1→D1 migration tool (Settings, owner-only): chunked resumable copy then
  reversible cutover flag (`app_config.db_primary`); source is never mutated
  or deleted by the tool.
- PII retention windows configurable (company settings); deletes cascade.

## Dependencies & Supply Chain

- `npm ci`-friendly lockfile; no postinstall scripts executed in CI builds.
- Worker egress is allow-listed per feature (LLM providers, Resend) via
  `assertSafeOutboundUrl`; secrets live in Workers Secrets / `.dev.vars`
  (never committed).

## Known Non-Goals (beta)

- No client-side encryption of D1 business rows (server-side access control only).
- Capacitor/mobile shell inherits the web session model; device storage is
  sandboxed by the OS.
