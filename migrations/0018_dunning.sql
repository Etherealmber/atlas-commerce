-- Part 6: Unpaid invoice dunning (configurable schedule, templates, per-invoice pause, dedup events)

CREATE TABLE IF NOT EXISTS dunning_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  stages_json TEXT NOT NULL DEFAULT '["D-3","D+1","D+7","D+15"]',
  email_subject_template TEXT NOT NULL DEFAULT 'Rappel facture {{invoice_number}} — {{company}}',
  email_body_template TEXT NOT NULL DEFAULT 'Bonjour {{client}},\n\nSauf erreur de notre part, la facture {{invoice_number}} d''un montant restant de {{amount}} (échéance {{due_date}}) reste à régler.\n\nClient ICE : {{ice}}\nMerci de procéder au règlement.\n\nCordialement,\n{{company}}',
  whatsapp_template TEXT NOT NULL DEFAULT 'Bonjour {{client}}, rappel concernant la facture {{invoice_number}} (reste dû : {{amount}}, échéance : {{due_date}}, ICE : {{ice}}). Merci — {{company}}.',
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT DEFAULT ''
);

INSERT OR IGNORE INTO dunning_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS dunning_invoice_overrides (
  invoice_id INTEGER PRIMARY KEY,
  paused INTEGER NOT NULL DEFAULT 0,
  reason TEXT DEFAULT '',
  paused_by TEXT DEFAULT '',
  paused_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dunning_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  stage TEXT NOT NULL,
  channel TEXT NOT NULL,
  recipient TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'sent',
  message_preview TEXT DEFAULT '',
  error_text TEXT DEFAULT '',
  sent_at TEXT DEFAULT (datetime('now')),
  UNIQUE(invoice_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_dunning_events_inv ON dunning_events(invoice_id, sent_at DESC);
