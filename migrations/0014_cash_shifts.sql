-- Part 2: cash shifts + X/Z-report.
-- Safe to run repeatedly (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS cash_shifts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  till_id         TEXT NOT NULL DEFAULT 'CAISSE-1',
  operator        TEXT NOT NULL,
  opened_at       TEXT NOT NULL,
  closed_at       TEXT,
  opening_float   REAL NOT NULL DEFAULT 0,
  counted_amount  REAL,
  expected_amount REAL,
  variance        REAL,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  denominations   TEXT NOT NULL DEFAULT '{}',
  by_method_json  TEXT NOT NULL DEFAULT '{}',
  notes           TEXT NOT NULL DEFAULT '',
  closed_by       TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_shifts_one_open_per_till
  ON cash_shifts(till_id) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_cash_shifts_opened
  ON cash_shifts(opened_at DESC);

CREATE TABLE IF NOT EXISTS cash_shift_movements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id        INTEGER NOT NULL REFERENCES cash_shifts(id) ON DELETE CASCADE,
  source_table    TEXT NOT NULL DEFAULT 'manual',
  source_id       INTEGER,
  direction       TEXT NOT NULL DEFAULT 'in' CHECK (direction IN ('in', 'out')),
  payment_method  TEXT NOT NULL DEFAULT 'cash',
  amount          REAL NOT NULL DEFAULT 0,
  reference       TEXT NOT NULL DEFAULT '',
  label           TEXT NOT NULL DEFAULT '',
  created_by      TEXT NOT NULL DEFAULT '',
  occurred_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cash_shift_movements_shift
  ON cash_shift_movements(shift_id, occurred_at);
