# Android & Web Offline Inventory Contract (`POST /api/inventory/offline-operations`)

This document is the single source of truth for offline field inventory synchronization between the Cloudflare Worker backend (`Etherealmber/atlas-commerce`), the Android client (`Etherealmber/atlas-commerce-android` PR #127), and the `/m` mobile web shell.

> **Scope boundary**: Bill receipts and supplier purchase receptions **continue to use the bill flow** (`POST /api/bills/:id/receive`). `POST /api/inventory/offline-operations` is strictly for **field movements** (`receive`, `issue`, `count`).

---

## 1. Endpoints

### 1.1 Read active warehouses
`GET /api/inventory/locations`
- Filters by `COALESCE(is_active, 1) = 1`.
- Preserves existing shape (`id`, `code`, `name`, `is_default`, `is_active`).
- When `?product_id=<id>` is passed, returns `[{ location_id, id, code, name, is_default, quantity, revision }]` (starting `revision` at `0` when no revision row exists yet).

### 1.2 Read product placements (with `revision`)
`GET /api/inventory/products/:id/placements`
- Returns `{ success: true, data: { product_id, product_name, category, total, placements: [{ location_id, code, name, is_default, quantity, revision }] } }`.
- `revision` is `0` when no row exists yet in `stock_location_revisions`, and increments on **every** quantity-changing write (`bumpPlacementRevision`).
- Clients cache `revision` from this endpoint (or `/api/inventory/locations?product_id=...`) to send `observed_revision` on `count` operations.

### 1.3 Submit an offline field operation
`POST /api/inventory/offline-operations`

**Headers**:
- `Authorization: Bearer <session-token>`
- `Idempotency-Key: <uuid>` (required; missing returns `400 MISSING_IDEMPOTENCY_KEY`)
- `X-Device-Id: <device-id>` (optional)

**Body (one operation per request — Android preserves queue order itself)**:
```json
{
  "operation_id": "550e8400-e29b-41d4-a716-446655440000",
  "kind": "receive",
  "product_id": 42,
  "location_id": 3,
  "quantity_delta": 5,
  "counted_quantity": 17,
  "observed_quantity": 15,
  "observed_revision": 8,
  "note": "Réception chantier",
  "client_occurred_at": "2026-10-21T09:30:00Z"
}
```

#### Critical invariants
1. **Integer `location_id` only — NEVER `code`**: `location_id` must be a positive integer referencing an active `stock_locations.id` belonging to the authenticated account (`404 LOCATION_NOT_FOUND` otherwise). Location codes such as `"MAG"` are rejected.
2. **Account scoping from session**: `account_id` is derived exclusively from the authenticated session, never from client-supplied fields. Idempotency keys are scoped by `PRIMARY KEY (account_id, key)`.
3. **`products.stock_quantity` == sum of `stock_location_qty`**: Every applied mutation updates `stock_location_qty`, `products.stock_quantity`, `stock_location_revisions`, `stock_movements` (with `device_id` and `client_occurred_at`), and `offline_idempotency` inside a **single `db.batch()`** so a crash can never leave a movement without a key or vice-versa.
4. **Revision bumped by every writer**: `bumpPlacementRevision(db, batch, pid, loc)` is called by **every** quantity writer (`/api/inventory/offline-operations`, `/api/stock/receive`, `/api/stock/count`, `/api/inventory/cycle-count`, `/api/inventory/transfer`, `adjustLocationStock`, and `applyStockDelta`). Any concurrent web or desktop edit increments `revision`, guaranteeing stale mobile `count` operations are detected as `409 COUNT_CONFLICT` instead of silently overwriting stock.
5. **Webhooks**: Applied operations dispatch `stock.receive`, `stock.issue`, or `stock.count` via `dispatchWebhook` (not re-dispatched on replay).

---

## 2. Response & Error Contract

### 2.1 Success (`200 OK` — identical shape on first application and replay)
```json
{
  "success": true,
  "data": {
    "operation_id": "550e8400-e29b-41d4-a716-446655440000",
    "kind": "receive",
    "product_id": 42,
    "location_id": 3,
    "previous_quantity": 12,
    "new_quantity": 17,
    "product_total": 17,
    "movement_id": 99,
    "revision": 9,
    "applied_at": "2026-10-21T09:30:02.120Z",
    "replayed": false
  }
}
```
On replay of the same `(account_id, Idempotency-Key)` with an identical canonical JSON SHA-256 hash:
- HTTP `200`, header `Idempotent-Replay: true`
- Identical JSON payload with `"replayed": true` (no new movement written, stock unchanged)

### 2.2 Queue retry policy (`4xx` terminal vs `5xx` retryable)
- **`4xx` = TERMINAL** (do NOT auto-retry in background queue):
  - `400 MISSING_IDEMPOTENCY_KEY` — missing `Idempotency-Key` header
  - `400 OPERATION_ID_MISMATCH` — `body.operation_id !== Idempotency-Key`
  - `400 QTY_INVALID` — invalid `kind`, `quantity_delta <= 0`, `counted_quantity < 0`, missing `observed_revision`, or `issue` resulting in negative stock when negative stock is disallowed
  - `403 FORBIDDEN_ROLE` — role lacks stock-operation permission (`inventory-policy.ts`)
  - `404 PRODUCT_NOT_FOUND` — unknown `product_id`
  - `404 LOCATION_NOT_FOUND` — missing, non-integer, inactive, or out-of-account `location_id`
  - `409 IDEMPOTENCY_KEY_REUSED` — same `(account_id, Idempotency-Key)` reused with a different canonical payload
  - `409 COUNT_CONFLICT` — `observed_revision !== current_revision`; returns `{ current_quantity, current_revision, product_total }` so the user can review and reconcile before creating a new operation with a fresh `operation_id`
- **`5xx` / network timeout = RETRYABLE**: keep the operation in the queue with the **same** `operation_id` / `Idempotency-Key` and retry with exponential backoff.

Idempotency rows older than 7 days are purged automatically via `scheduleOfflineIdempotencyPurge` (`job-queue`).
