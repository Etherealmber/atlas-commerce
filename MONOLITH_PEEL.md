# Monolith peel status

## Done
- `worker/lib/clients-schema.ts` — tax_exempt, credit_limit, checkClientCreditLimit
- `worker/routes/clients.ts` — full `/api/clients*` surface (list, create, update, delete, import)
- `registerClientRoutes(app, deps)` with OTP/password/audit injection
- `worker/lib/job-queue.ts` + **backup-now** runs `purgeExpiredBackups` via `enqueue` (non-blocking)
- `worker/routes/mailbox.ts` stub registered (handlers still in index — next slice)

## Next peel slices
1. Move `ensureMailSchema` + `/api/admin/mailbox/*` into `routes/mailbox.ts`
2. Move invoice write cluster into `routes/invoices.ts` (reads already partial)
3. Auth cluster into `routes/auth.ts`
