# P0 + A/B/C hardening (2026-10-01)

## A) Security / validation
- `worker/lib/validate.ts` — client / product / invoice write validators
- POST `/api/products`, `/api/clients`, `/api/invoices` use `validate*` + `apiFail(..., VALIDATION)`
- `worker/lib/upstream.ts` — timeout + retry/backoff for upstream HTTP
- Groq agent calls use `upstreamFetch` (20s timeout, 2 retries)

## B) Worker modularization
- Existing modules: employees, public, invoices (read), stock (read), wholesale, admin (read)
- New stub: `worker/routes/clients.ts` (handlers still in index until full peel)
- Canonical responses: `worker/lib/api-response.ts`

## C) Partner API v1
- Design doc: `ARCHITECTURE_PARTNER_API_V1.md`
- Path plan `/api/v1/*`, API keys, cursor pagination, stable error codes

## Tests
- `scripts/smoke-p0-api-shape.mjs` — health / public
- `scripts/smoke-auth.mjs` — **skips unless** `ATLAS_SMOKE_*` env set (CI secrets only)
- `npm run smoke` runs the suite

## Risks still open
- `worker/index.ts` still large — continue peeling mailbox/reports/auth clusters
- Not all write routes validated yet (bulk import, payments, …)
- No formal circuit-breaker state machine (retry/timeout only)
