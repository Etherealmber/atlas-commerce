-- Client / vendor lookups (fiche client, fiche fournisseur, relances, balance
-- âgée) and « latest documents » lists filtered on invoices.client_id,
-- bills.vendor_id or ordered by invoices.created_at were full table scans.
-- Pure, idempotent DDL: safe on an empty database and on existing ones.

CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_created ON invoices(created_at);
CREATE INDEX IF NOT EXISTS idx_bills_vendor ON bills(vendor_id);
CREATE INDEX IF NOT EXISTS idx_receipts_invoice ON receipts(invoice_id);
