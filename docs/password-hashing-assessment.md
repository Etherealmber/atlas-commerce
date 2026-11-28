# Password hashing: security assessment (no migration yet)

Atlas currently derives per-user salted password hashes with PBKDF2-HMAC-SHA-256 using Workers Web Crypto and stores the work factor with the hash (`worker/lib/authHelpers.ts`). The current 100,000-iteration cap is **below** OWASP's PBKDF2-HMAC-SHA-256 recommendation of 600,000. OWASP recommends Argon2id for new password storage, with a minimum profile of 19 MiB, two passes, and one lane, or one of its listed equivalent trade-offs. See [OWASP's password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

Cloudflare Workers' PBKDF2 iteration limit must be verified against the actual production runtime before changing the configured cost; raising it in code without that verification can break login. Cloudflare's [Web Crypto documentation](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/) describes the supported API. Rust/WASM alone is not a security improvement and does not remove Worker CPU or memory limits.

## Proposed investigation, not an authorization or a deployment

1. Benchmark a reviewed, maintained Argon2id implementation against OWASP profiles in the actual Workers plan/runtime, including concurrent logins, CPU, memory, tail latency and abuse/rate-limit behavior. Compare a separately reviewed identity service if resource budgets are insufficient. Do not collect real passwords in benchmark logs.
2. Inventory every web, Android, desktop, recovery, initial setup, administrator and role-refresh authentication path. Several paths currently expect the existing `pbkdf2$100000$...` format explicitly; changing only the central verifier can lock users out.
3. Design versioned hashes and a staged verifier-first release with an atomic conditional rehash after successful authentication, conflict handling, observability and rollback that can still verify every hash already created. Never rehash without the original password, silently downgrade, or use a legacy format as a fallback for a malformed new-format hash.
4. Preserve recovery, device security, constant-time comparisons, random salts and server-side rate limiting. Run known-answer, malformed-input, concurrent upgrade, legacy compatibility and production-like workerd tests; review memory/CPU denial-of-service risks and the dependency's provenance.
5. Get security review and production/staging approval before switching writes. Monitor successful verification and failures without logging passwords, salts, hashes, tokens, or personal data.

No password format, login behavior, hash parameters or production secrets are changed by this assessment.
