-- Delivery notes linked to removed invoices are removed, including their items.
-- Standalone notes (invoice_id IS NULL) are retained.
CREATE TABLE IF NOT EXISTS delivery_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT NOT NULL UNIQUE, invoice_id INTEGER,
  client_name TEXT DEFAULT '', issue_date TEXT, notes TEXT DEFAULT '', status TEXT DEFAULT 'draft',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS delivery_note_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, delivery_note_id INTEGER NOT NULL, product_id INTEGER,
  product_name TEXT, quantity REAL NOT NULL, unit TEXT DEFAULT 'u'
);
CREATE INDEX IF NOT EXISTS idx_delivery_notes_invoice ON delivery_notes(invoice_id);
DELETE FROM delivery_note_items WHERE delivery_note_id IN (
  SELECT id FROM delivery_notes WHERE invoice_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM invoices WHERE invoices.id = delivery_notes.invoice_id)
);
DELETE FROM delivery_notes WHERE invoice_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM invoices WHERE invoices.id = delivery_notes.invoice_id);
CREATE TRIGGER IF NOT EXISTS delivery_notes_invoice_delete AFTER DELETE ON invoices BEGIN
  DELETE FROM delivery_note_items WHERE delivery_note_id IN (SELECT id FROM delivery_notes WHERE invoice_id = OLD.id);
  DELETE FROM delivery_notes WHERE invoice_id = OLD.id;
END;
