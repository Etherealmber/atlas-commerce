# Partner API v1 — status

## Implemented
- `GET /api/v1/openapi.json` (public)
- `GET /api/v1/health|products|products/:id|clients|invoices` (scope `read`)
- `POST /api/v1/invoices` + header `Idempotency-Key` (scope `write_invoices`)
- Auth: `X-Api-Key` / Bearer
  - Env `PARTNER_API_KEY` (comma-separated) → scopes read+write_invoices+write_stock
  - Or D1 `partner_api_keys` (key_hash SHA-256, scopes CSV, active)
- Tables: `partner_api_keys`, `partner_idempotency`

## Insert a scoped key (SQL example)
```sql
-- key_hash = sha256(plaintext_key) hex
INSERT INTO partner_api_keys (key_hash, label, scopes, active)
VALUES ('<sha256-hex>', 'Acme ERP', 'read,write_invoices', 1);
```
