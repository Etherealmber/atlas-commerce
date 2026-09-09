-- Hot-path indexes for product list + barcode scan (no DDL on every request)
CREATE INDEX IF NOT EXISTS idx_products_active_name ON products(is_active, name);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_active_barcode ON products(is_active, barcode);
CREATE INDEX IF NOT EXISTS idx_mobile_actions_pending_barcode ON mobile_actions(status, barcode);
