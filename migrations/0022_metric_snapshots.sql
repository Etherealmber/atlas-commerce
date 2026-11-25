-- Daily values of point-in-time metrics (stock bas, créances, solde…) so the
-- KPI cards can draw a sparkline and a trend for numbers that have no
-- transaction history of their own. One row per day and metric; the day's
-- row is overwritten until midnight (UTC). Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS metric_snapshots (
  day        TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (day, key)
);

CREATE INDEX IF NOT EXISTS idx_metric_snapshots_key_day ON metric_snapshots(key, day);
