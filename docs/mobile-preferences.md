# Android app-preference sync (schema 1, 0.8.9)

`GET` and `PUT /api/mobile/preferences` use the existing authenticated Worker session (`Authorization: Bearer <session>` and the usual IP/device fingerprint checks). Supply `X-Device-Fingerprint` where the existing session requires it. The server selects the account from the verified session, rechecks the active `app_users` ID and role, and uses a separate username-scoped slot for the environment owner. No user ID, role or server identifier is accepted in the request. This follows the existing single-tenant-per-D1 model; a D1 database must not be shared between unrelated tenants. Deleting an app account cascades its preferences; recreating its username does not restore them. Changing the configured owner username selects a different slot; the previous slot is retained until separately removed. Responses, including auth failures, are `Cache-Control: no-store` and `CDN-Cache-Control: no-store`.

## Contract

GET takes no query parameters and does not record a sync. A first GET returns defaults, revision `0` and null timestamps. PUT takes JSON, maximum **4096 bytes** including requests without Content-Length:

```json
{
  "schema_version": 1,
  "revision": 0,
  "sync_type": "manual",
  "sync_frequency": "weekly",
  "settings": { "theme": "dark", "onboarding_completed": true }
}
```

`schema_version`, `revision` (nonnegative safe integer), `sync_type` (`manual` or `scheduled`), and `settings` (object, possibly empty) are required. `sync_frequency` is optional and is one of `daily`, `weekly`, `monthly`, `yearly` (default `daily`). Unknown top-level fields or settings, unsupported versions and incorrect types/values are rejected. PUT **merges only the submitted allowlisted settings** into the current values and retains omitted settings and frequency. The following is the complete schema, with defaults first:

| Key | Values |
| --- | --- |
| `theme` | `system`, `light`, `dark` |
| `language` | `system`, `en`, `fr`, `ar` |
| `density` | `comfortable`, `compact` |
| `animations` | `true`, `false` |
| `navigation_default` | `dashboard`, `products`, `scan`, `sales` |
| `scan_behavior` | `preview`, `auto` |
| `sale_confirmation` | `true`, `false` |
| `product_view` | `list`, `grid` |
| `update_notifications` | `true`, `false` |
| `update_channel` | `stable`, `beta` |
| `onboarding_completed` | `false`, `true` |

This schema does not accept passwords, tokens, biometrics, accounts, servers, device identifiers, caches, logs, permissions, diagnostic consent, or security/privacy consent. Preferences are not logged. Never use this resource for those values; Android must keep its existing sensitive/device-specific storage and consent behavior separate. The API is a server contract only: Android integration is not included here.

GET and successful PUT return the same unwrapped shape:

```json
{
  "schema_version": 1,
  "settings": { "theme": "dark", "language": "system", "density": "comfortable", "animations": true, "navigation_default": "dashboard", "scan_behavior": "preview", "sale_confirmation": true, "product_view": "list", "update_notifications": true, "update_channel": "stable", "onboarding_completed": true },
  "revision": 1,
  "updated_at": "2026-01-31T12:00:00.000Z",
  "server_time": "2026-01-31T12:00:00.000Z",
  "sync_frequency": "weekly",
  "last_synced_at": "2026-01-31T12:00:00.000Z",
  "next_sync_at": "2026-02-07T12:00:00.000Z"
}
```

A successful PUT increments the revision and sets both timestamps using the primary D1 server's UTC clock inside the atomic write; clients cannot supply timestamps. Use the last observed revision: an atomic conditional write makes competing or stale writes return HTTP 409 `CONFLICT` with the current revision and `server_time`. GET the current state, reconcile changes on the client, then submit again subject to cooldown. A timed-out PUT has an unknown outcome; GET before retrying. Do not use a client clock to bypass scheduling.

## Scheduling and protection

The app initiates sync; the server does not run a background job. After every accepted PUT, the next due time is calculated from `last_synced_at` in UTC using the **current stored frequency**: daily and weekly add 1 or 7 UTC days; monthly and yearly add 1 or 12 calendar months and clamp the day to the last day of the destination month (January 31 → February 28/29; February 29 → February 28 in a non-leap year). The UTC time of day and milliseconds are retained. Each next due date is based on the actual last successful sync, not a fixed original anchor. `next_sync_at` is null before the first PUT, which may be manual or scheduled.

All successful PUTs, regardless of `sync_type`, share a durable per-account **five-minute minimum interval** enforced atomically in D1 using server time, across devices and Worker isolates. A scheduled PUT must additionally be due according to the previously stored frequency; changing frequency in that PUT cannot make an early scheduled sync due. A manual sync may happen before the scheduled due date, but not within five minutes of any successful PUT. A successful manual or scheduled PUT resets both the cooldown and the schedule. Early cooldown requests return 429 `RATE_LIMITED`, `server_time`, `retry_after_seconds` (rounded up) and the `Retry-After` header; a scheduled request past cooldown but before its due time returns 409 `NOT_DUE` with `next_sync_at` and `server_time`. Stale revisions take precedence over cooldown. Invalid/failed writes do not update the sync time. In addition, the existing per-isolate best-effort 120 requests/account/minute limiter protects GET and PUT; it also returns 429 with `server_time`, `retry_after_seconds` and `Retry-After` using the Worker clock. It is not a distributed read quota. D1 failures return generic 503; invalid JSON/schema returns 422 and oversized bodies return 413.

## Automatic schema and backup

The first valid authenticated request initializes `mobile_preferences_v1` automatically with `CREATE TABLE IF NOT EXISTS`; it uses the existing security-schema initializer if the owner's `app_users` table is absent. Initialization failure returns 503. `migrations/0011_mobile_preferences.sql` is idempotent and compatible with automatic initialization, but runtime initialization does not update Wrangler's migration ledger. Reads and writes use a primary D1 session, including when the configured target database is active. If a target is configured but cutover state cannot be read or its primary session cannot be opened, the endpoint fails closed with 503 rather than writing to the wrong database. No data is backfilled or migrated remotely by this change. The project's application-level backup and database copy tools do not include this private table: use a database-level backup and explicitly preserve this table and matching account IDs during any cutover, or preferences, revisions and cooldown state will be lost. Quiesce sync writes while coordinating a cutover; two independent databases do not share a cooldown. Dropping this table destroys all preferences; restore from a suitable backup if needed.
