-- Phase 8 hardening: durable idempotency table + query performance indexes.
-- Safe to run repeatedly (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  route TEXT NOT NULL DEFAULT '',
  response_json TEXT NOT NULL DEFAULT '',
  status_code INTEGER DEFAULT 200,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created ON idempotency_keys(created_at);
CREATE INDEX IF NOT EXISTS idx_bill_payments_bill ON bill_payments(bill_id);
CREATE INDEX IF NOT EXISTS idx_expenses_reference ON expenses(reference);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity, entity_id);
