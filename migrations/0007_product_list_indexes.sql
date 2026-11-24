-- Hot-path indexes for product list + barcode scan (no DDL on every request)
-- Defensive CREATE TABLE IF NOT EXISTS guards before indexing.

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  category_id INTEGER,
  category TEXT DEFAULT 'General',
  unit TEXT DEFAULT 'unit',
  secondary_unit TEXT DEFAULT NULL,
  secondary_unit_factor REAL DEFAULT NULL,
  price REAL NOT NULL DEFAULT 0,
  cost REAL DEFAULT 0,
  stock_quantity REAL NOT NULL DEFAULT 0,
  low_stock_threshold REAL DEFAULT 5,
  track_inventory INTEGER DEFAULT 1,
  is_active INTEGER DEFAULT 1,
  image_url TEXT DEFAULT '',
  image_key TEXT DEFAULT '',
  barcode TEXT DEFAULT '',
  tax_rate REAL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS mobile_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('scan','stock_check','new_product','invoice')),
  title TEXT NOT NULL,
  detail TEXT DEFAULT '',
  barcode TEXT DEFAULT '',
  product_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','cancelled')),
  source TEXT DEFAULT 'mobile',
  created_by TEXT DEFAULT '',
  completed_by TEXT DEFAULT '',
  completed_at TEXT,
  meta_json TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_active_name ON products(is_active, name);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_active_barcode ON products(is_active, barcode);
CREATE INDEX IF NOT EXISTS idx_mobile_actions_pending_barcode ON mobile_actions(status, barcode);
