# D1 Migrations Rules

## Why this exists (`P0-3`)
Previously, early migrations (`0002`–`0012`) assumed that `schema.sql` had already been applied manually and that runtime helpers (`ensure*` / `addColumnIfMissing`) would lazily create missing tables or columns. On a blank D1 database, running `npx wrangler d1 migrations apply DB --local` failed immediately at `0002_phase2_indexes.sql` with `no such table: main.invoices`.

## Mandatory Rules

1. **Every migration must apply to an empty database.**
   Running the full ordered chain (`0000` → latest) from scratch must exit `0` with zero manual pre-seeding of `schema.sql`.
2. **Create tables and columns in migrations — never lazily at runtime.**
   Every table, column, and index referenced by a route or a later migration must be provisioned by an explicit SQL migration in `migrations/`. Runtime `CREATE TABLE IF NOT EXISTS` / `addColumnIfMissing` helpers are defensive fallbacks only and must never be relied upon as the primary schema mechanism, nor should routes query columns (such as `variant_label` or `finance_currency`) that do not exist in the migrated schema unless `SELECT *` or an explicit migration is used.
3. **Never alter or mutate data in retroactive baseline files.**
   Baseline files (`0000_*`) must remain pure, idempotent DDL (`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`). Avoid `ALTER TABLE` or `INSERT` statements in retroactive baselines so existing databases do not receive duplicate errors or re-seeded rows.
4. **Test routes against a migration-built SQLite DB.**
   Regression tests for Worker routes should build an in-memory `node:sqlite` database by executing `migrations/*.sql` in sorted order rather than mocking tables with ad-hoc columns.

## Verification & CI Guard

- **CI Guard:** [`.github/workflows/d1-migrations-guard.yml`](../.github/workflows/d1-migrations-guard.yml) (job `fresh-d1-migrations-and-health` / **D1 fresh migrations guard**) runs on every PR and push to `main`. It wipes `.wrangler`, applies all D1 migrations locally, boots `wrangler dev --local`, and asserts `GET /api/health` returns `ok: true` and `d1: true`.
- **Local check:**
  ```bash
  rm -rf .wrangler && npx wrangler d1 migrations apply DB --local
  ```
