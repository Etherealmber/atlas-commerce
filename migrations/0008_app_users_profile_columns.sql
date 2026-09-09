-- Idempotent profile columns on app_users (D1 / SQLite)
-- Note: SQLite/D1 may not support ADD COLUMN IF NOT EXISTS on all versions;
-- runtime ensureSchema uses PRAGMA table_info instead.

-- No-op safe markers for deploy pipelines that require a file:
SELECT 1;
