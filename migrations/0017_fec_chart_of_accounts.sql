-- Part 5: Configurable PCGE-style chart of accounts for FEC accounting export

CREATE TABLE IF NOT EXISTS accounting_accounts (
  account_key TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT DEFAULT ''
);

INSERT OR IGNORE INTO accounting_accounts (account_key, code, label) VALUES
  ('clients_receivable', '3421', 'Clients'),
  ('sales_revenue', '7111', 'Ventes de marchandises'),
  ('sales_vat', '4455', 'État, TVA facturée'),
  ('suppliers_payable', '4411', 'Fournisseurs'),
  ('purchases_expense', '6111', 'Achats revendus de marchandises'),
  ('purchases_vat', '3455', 'État, TVA récupérable'),
  ('cash_account', '5161', 'Caisses'),
  ('bank_account', '5141', 'Banques'),
  ('payroll_gross', '6171', 'Rémunérations du personnel'),
  ('payroll_cnss_amo', '4441', 'Organismes sociaux (CNSS / AMO)'),
  ('payroll_igr', '4452', 'État, impôts et taxes (IGR)'),
  ('payroll_net_payable', '4432', 'Rémunérations dues au personnel'),
  ('misc_expense', '6580', 'Autres charges et frais divers'),
  ('misc_income', '7580', 'Autres produits divers'),
  ('cash_variance', '6585', 'Écarts de caisse');
