-- Part 7: Moroccan DGI e-invoicing clearance layer & 10-year R2 archival tracking

CREATE TABLE IF NOT EXISTS dgi_clearance (
  invoice_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ubl_ready','queued','submitted','cleared','rejected','retrying')),
  is_stub INTEGER NOT NULL DEFAULT 1,
  ubl_sha256 TEXT DEFAULT '',
  ubl_xml TEXT DEFAULT '',
  clearance_ref TEXT DEFAULT '',
  qr_payload TEXT DEFAULT '',
  stamp_payload TEXT DEFAULT '',
  r2_xml_key TEXT DEFAULT '',
  r2_pdf_key TEXT DEFAULT '',
  retention_until TEXT DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT DEFAULT '',
  errors_json TEXT DEFAULT '[]',
  warnings_json TEXT DEFAULT '[]',
  submitted_at TEXT,
  cleared_at TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dgi_status_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  from_status TEXT DEFAULT '',
  to_status TEXT NOT NULL,
  actor TEXT DEFAULT '',
  note TEXT DEFAULT '',
  is_stub INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dgi_events_inv ON dgi_status_events(invoice_id, id DESC);
