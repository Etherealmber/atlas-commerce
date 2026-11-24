-- Phase 2: additional indexes for common filters (D1 free-tier friendly).
-- Defensive CREATE TABLE IF NOT EXISTS guards before indexing.

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE NOT NULL,
  client_id INTEGER,
  client_name TEXT NOT NULL,
  client_ice TEXT DEFAULT '',
  client_address TEXT DEFAULT '',
  client_city TEXT DEFAULT '',
  client_email TEXT DEFAULT '',
  client_phone TEXT DEFAULT '',
  issue_date TEXT NOT NULL,
  due_date TEXT,
  status TEXT DEFAULT 'draft',
  doc_kind TEXT DEFAULT 'invoice',
  subtotal REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  amount_paid REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE NOT NULL,
  vendor_id INTEGER,
  vendor_name TEXT NOT NULL,
  vendor_ice TEXT DEFAULT '',
  vendor_address TEXT DEFAULT '',
  issue_date TEXT NOT NULL,
  due_date TEXT,
  status TEXT DEFAULT 'draft',
  subtotal REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  amount_paid REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL DEFAULT 'General',
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_method TEXT DEFAULT 'cash',
  expense_date TEXT NOT NULL,
  vendor_name TEXT DEFAULT '',
  reference TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  entry_type TEXT DEFAULT 'expense',
  created_at TEXT DEFAULT (datetime('now'))
);

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

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  fingerprint TEXT DEFAULT '',
  success INTEGER DEFAULT 0,
  reputation_delta INTEGER DEFAULT 0,
  user_agent TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices(issue_date);
CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(status);
CREATE INDEX IF NOT EXISTS idx_expenses_entry_type ON expenses(entry_type);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_created ON login_attempts(ip, created_at);
