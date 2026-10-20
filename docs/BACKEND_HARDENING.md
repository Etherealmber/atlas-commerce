# Atlas Commerce — backend hardening (Workers / D1)

## Already in place
- **Auth**: Bearer session JWT-like tokens, role gates (`requireBizMutator`, owner-only)
- **Rate limits**: KV `rateLimit` on admin / auth / public routes
- **Idempotency**: `idempotency_keys` table + partner `Idempotency-Key`
- **Caching**: KV for settings & product lists (TTL)
- **Ephemeral purge**: OTP, WebAuthn challenges, login attempts, old idempotency
- **CORS / security headers** on Worker

## This pass
- **Schema**: `products.tax_rate`, `bulk_discounts`, indexes (sku/barcode/category/parent)
- **Schema**: `company_settings.tax_rate` via `ensureHrSettings`
- **Ensure** before product write & tax_rate SELECT
- **API**: friendlier D1/tax_rate client messages

## Cloudflare model (realistic scope)
| Pattern | On Workers/D1 |
|---------|----------------|
| Horizontal scaling | Automatic (Workers isolates) |
| Load balancing | Cloudflare edge |
| DB replication | D1 read replicas (platform) — not app-level sharding |
| Message queues | Optional Queues binding — not required for current ERP path |
| CAP | Prefer **availability + partition** at edge; strong consistency per D1 primary |

Not implementing custom consistent hashing / multi-region sharding in-app: platform owns that layer.
