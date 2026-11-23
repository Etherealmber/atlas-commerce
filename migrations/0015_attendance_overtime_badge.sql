-- Part 3: attendance (pointage) enhancements — check-in source (manual/mobile/badge) & indexes
CREATE TABLE IF NOT EXISTS employee_attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  work_date TEXT NOT NULL,
  check_in TEXT,
  check_out TEXT,
  status TEXT DEFAULT '',
  source TEXT DEFAULT 'manual',
  note TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(employee_id, work_date)
);

CREATE INDEX IF NOT EXISTS idx_att_date ON employee_attendance(work_date);
CREATE INDEX IF NOT EXISTS idx_att_emp ON employee_attendance(employee_id);
