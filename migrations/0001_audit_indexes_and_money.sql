-- Phase 1: audit indexes + money documentation.
-- Apply:
--   npx wrangler d1 migrations apply company-stock-db --local
--   npx wrangler d1 migrations apply company-stock-db --remote
--
-- Money convention: all amounts are stored in major units (dirhams), not centimes.
-- Display symbol for MAD is DH (see src/lib/money.ts).

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  username TEXT,
  role TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  detail TEXT,
  ip TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_id ON audit_log(id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_username ON audit_log(username);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);

-- Product images: URL only (CDN), never store base64 in D1
CREATE TABLE IF NOT EXISTS product_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  alt_text TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  is_primary INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);
