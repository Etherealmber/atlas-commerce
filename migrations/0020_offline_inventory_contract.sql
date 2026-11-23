-- Upgrade offline_idempotency to account-scoped composite PK (account_id, key)
-- and stock_location_revisions to integer product_id / location_id keys.
-- Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS offline_idempotency (
  key          TEXT NOT NULL DEFAULT '',
  account_id   TEXT NOT NULL DEFAULT 'default',
  device_id    TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL DEFAULT '',
  op           TEXT NOT NULL DEFAULT '',
  request_hash TEXT NOT NULL DEFAULT '',
  status       INTEGER NOT NULL DEFAULT 200,
  response     TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, key)
);

CREATE TABLE IF NOT EXISTS offline_idempotency_v2 (
  key          TEXT NOT NULL,
  account_id   TEXT NOT NULL DEFAULT 'default',
  device_id    TEXT NOT NULL DEFAULT '',
  kind         TEXT NOT NULL DEFAULT '',
  op           TEXT NOT NULL DEFAULT '',
  request_hash TEXT NOT NULL,
  status       INTEGER NOT NULL,
  response     TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  PRIMARY KEY (account_id, key)
);

INSERT OR IGNORE INTO offline_idempotency_v2 (key, account_id, device_id, kind, op, request_hash, status, response, created_at)
SELECT key, 'default', COALESCE(device_id, ''), COALESCE(op, ''), COALESCE(op, ''), request_hash, status, response, created_at
FROM offline_idempotency;

DROP TABLE IF EXISTS offline_idempotency;
ALTER TABLE offline_idempotency_v2 RENAME TO offline_idempotency;

CREATE INDEX IF NOT EXISTS idx_offline_idem_created
  ON offline_idempotency(created_at);

CREATE TABLE IF NOT EXISTS stock_location_revisions (
  product_id  INTEGER NOT NULL,
  location_id INTEGER NOT NULL,
  revision    INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (product_id, location_id)
);

CREATE TABLE IF NOT EXISTS stock_location_revisions_v2 (
  product_id  INTEGER NOT NULL,
  location_id INTEGER NOT NULL,
  revision    INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (product_id, location_id)
);

INSERT OR IGNORE INTO stock_location_revisions_v2 (product_id, location_id, revision, updated_at)
SELECT CAST(product_id AS INTEGER), CAST(location_id AS INTEGER), revision, updated_at
FROM stock_location_revisions
WHERE CAST(product_id AS INTEGER) > 0 AND CAST(location_id AS INTEGER) > 0;

DROP TABLE IF EXISTS stock_location_revisions;
ALTER TABLE stock_location_revisions_v2 RENAME TO stock_location_revisions;
