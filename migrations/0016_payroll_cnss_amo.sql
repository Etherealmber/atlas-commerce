-- Part 4: Moroccan payroll (CNSS / AMO / IGR), settings rates table, runs & immutable closed lines

CREATE TABLE IF NOT EXISTS payroll_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cnss_emp_rate REAL NOT NULL DEFAULT 0.0448,
  cnss_ceiling REAL NOT NULL DEFAULT 6000,
  cnss_employer_social_rate REAL NOT NULL DEFAULT 0.0898,
  cnss_employer_af_rate REAL NOT NULL DEFAULT 0.0640,
  cnss_employer_tfp_rate REAL NOT NULL DEFAULT 0.0160,
  amo_emp_rate REAL NOT NULL DEFAULT 0.0226,
  amo_employer_rate REAL NOT NULL DEFAULT 0.0411,
  prof_expenses_rate REAL NOT NULL DEFAULT 0.25,
  prof_expenses_monthly_cap REAL NOT NULL DEFAULT 2916.67,
  igr_brackets_json TEXT NOT NULL DEFAULT '[{"upTo":3333.33,"rate":0,"deduction":0},{"upTo":5000,"rate":0.10,"deduction":333.33},{"upTo":6666.67,"rate":0.20,"deduction":833.33},{"upTo":8333.33,"rate":0.30,"deduction":1500},{"upTo":15000,"rate":0.34,"deduction":1833.33},{"upTo":null,"rate":0.37,"deduction":2283.33}]',
  updated_at TEXT DEFAULT (datetime('now')),
  updated_by TEXT DEFAULT ''
);

INSERT OR IGNORE INTO payroll_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period_month TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','closed')),
  run_kind TEXT NOT NULL DEFAULT 'regular' CHECK (run_kind IN ('regular','corrective')),
  corrects_run_id INTEGER REFERENCES payroll_runs(id),
  rates_snapshot_json TEXT NOT NULL DEFAULT '{}',
  total_gross REAL NOT NULL DEFAULT 0,
  total_cnss_emp REAL NOT NULL DEFAULT 0,
  total_amo_emp REAL NOT NULL DEFAULT 0,
  total_igr REAL NOT NULL DEFAULT 0,
  total_net REAL NOT NULL DEFAULT 0,
  total_employer_cost REAL NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  closed_by TEXT DEFAULT '',
  closed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_regular_month
  ON payroll_runs(period_month)
  WHERE run_kind = 'regular';

CREATE INDEX IF NOT EXISTS idx_payroll_runs_month ON payroll_runs(period_month, created_at DESC);

CREATE TABLE IF NOT EXISTS payroll_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL,
  emp_number TEXT DEFAULT '',
  employee_name TEXT NOT NULL,
  cnss_number TEXT DEFAULT '',
  cin TEXT DEFAULT '',
  role_title TEXT DEFAULT '',
  base_salary REAL NOT NULL DEFAULT 0,
  days_worked REAL NOT NULL DEFAULT 30,
  overtime_hours REAL NOT NULL DEFAULT 0,
  overtime_amount REAL NOT NULL DEFAULT 0,
  late_minutes INTEGER NOT NULL DEFAULT 0,
  attendance_adjustment REAL NOT NULL DEFAULT 0,
  bonuses REAL NOT NULL DEFAULT 0,
  gross_salary REAL NOT NULL DEFAULT 0,
  cnss_base REAL NOT NULL DEFAULT 0,
  cnss_emp REAL NOT NULL DEFAULT 0,
  amo_emp REAL NOT NULL DEFAULT 0,
  prof_expenses REAL NOT NULL DEFAULT 0,
  taxable_net REAL NOT NULL DEFAULT 0,
  igr REAL NOT NULL DEFAULT 0,
  advances_deducted REAL NOT NULL DEFAULT 0,
  net_salary REAL NOT NULL DEFAULT 0,
  cnss_employer REAL NOT NULL DEFAULT 0,
  amo_employer REAL NOT NULL DEFAULT 0,
  employer_cost REAL NOT NULL DEFAULT 0,
  notes TEXT DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_payroll_lines_run ON payroll_lines(run_id);
