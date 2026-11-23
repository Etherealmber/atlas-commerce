-- Part 1: offline operations contract + server idempotency.
-- Safe to run repeatedly (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS offline_idempotency (
  key          TEXT PRIMARY KEY,
  device_id    TEXT NOT NULL,
  op           TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status       INTEGER NOT NULL,
  response     TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_offline_idem_created
  ON offline_idempotency(created_at);

CREATE TABLE IF NOT EXISTS stock_location_revisions (
  product_id  TEXT NOT NULL,
  location_id TEXT NOT NULL,
  revision    INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (product_id, location_id)
);
