-- Existing installations vary: stock_movements.created_by may already exist.
-- Like 0008, columns are added idempotently by PRAGMA-aware runtime schema
-- helpers instead of unconditional ALTER TABLE statements in D1 migrations.
-- Legacy product/approval identities are intentionally left NULL.
SELECT 1;
