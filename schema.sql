-- Company settings (single row)
CREATE TABLE IF NOT EXISTS company_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  company_name TEXT NOT NULL DEFAULT 'My Company',
  legal_form TEXT DEFAULT '',
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  postal_code TEXT DEFAULT '',
  country TEXT DEFAULT 'Morocco',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  website TEXT DEFAULT '',
  ice TEXT DEFAULT '',
  if_number TEXT DEFAULT '',
  rc TEXT DEFAULT '',
  patente TEXT DEFAULT '',
  cnss TEXT DEFAULT '',
  logo_url TEXT DEFAULT '',
  currency TEXT DEFAULT 'MAD',
  date_format TEXT DEFAULT 'DD/MM/YYYY',
  tax_rate REAL DEFAULT 20.0,
  invoice_prefix TEXT DEFAULT 'INV-',
  receipt_prefix TEXT DEFAULT 'REC-',
  bill_prefix TEXT DEFAULT 'BILL-',
  next_invoice_number INTEGER DEFAULT 1,
  next_receipt_number INTEGER DEFAULT 1,
  next_bill_number INTEGER DEFAULT 1,
  starting_balance REAL DEFAULT 0,
  bank_name TEXT DEFAULT '',
  bank_iban TEXT DEFAULT '',
  bank_swift TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO company_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#3b82f6',
  description TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO categories (id, name, color) VALUES
  (1, 'General', '#3b82f6'),
  (2, 'Electronics', '#8b5cf6'),
  (3, 'Office', '#22c55e');

CREATE TABLE IF NOT EXISTS warehouses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  is_default INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO warehouses (id, name, code, is_default) VALUES (1, 'Main Warehouse', 'MAIN', 1);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT UNIQUE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  category_id INTEGER,
  category TEXT DEFAULT 'General',
  unit TEXT DEFAULT 'unit',
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
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE IF NOT EXISTS warehouse_stock (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  warehouse_id INTEGER NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  UNIQUE(product_id, warehouse_id),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  warehouse_id INTEGER,
  type TEXT NOT NULL,
  quantity REAL NOT NULL,
  previous_quantity REAL,
  new_quantity REAL,
  reason TEXT DEFAULT '',
  reference TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (warehouse_id) REFERENCES warehouses(id)
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  ice TEXT DEFAULT '',
  if_number TEXT DEFAULT '',
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  ice TEXT DEFAULT '',
  if_number TEXT DEFAULT '',
  address TEXT DEFAULT '',
  city TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

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
  subtotal REAL NOT NULL DEFAULT 0,
  tax_amount REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL DEFAULT 0,
  amount_paid REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  product_id INTEGER,
  product_name TEXT NOT NULL,
  sku TEXT DEFAULT '',
  quantity REAL NOT NULL,
  unit_price REAL NOT NULL,
  tax_rate REAL DEFAULT 20,
  line_total REAL NOT NULL,
  FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
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
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (vendor_id) REFERENCES vendors(id)
);

CREATE TABLE IF NOT EXISTS bill_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_id INTEGER NOT NULL,
  product_id INTEGER,
  product_name TEXT NOT NULL,
  sku TEXT DEFAULT '',
  quantity REAL NOT NULL,
  unit_cost REAL NOT NULL,
  tax_rate REAL DEFAULT 20,
  line_total REAL NOT NULL,
  FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT UNIQUE NOT NULL,
  invoice_id INTEGER,
  client_name TEXT NOT NULL,
  amount REAL NOT NULL,
  payment_method TEXT DEFAULT 'cash',
  issue_date TEXT NOT NULL,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
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
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_stock_product ON stock_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(status);
CREATE INDEX IF NOT EXISTS idx_warehouse_stock ON warehouse_stock(product_id, warehouse_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  fingerprint TEXT DEFAULT '',
  success INTEGER DEFAULT 0,
  reputation_delta INTEGER DEFAULT 0,
  user_agent TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ip_reputation (
  ip TEXT PRIMARY KEY,
  score INTEGER NOT NULL DEFAULT 50,
  failed_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  blocked_until TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, created_at);
