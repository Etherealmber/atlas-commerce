import type { Hono } from 'hono';
import { round2 } from '../lib/financeCore';
import { buildPayslipPdf } from '../pdf';
import { computeDayMetrics, type AttendanceRulesInfo } from './attendance';
import { addColumnIfMissing, schemaOnceForDb } from '../lib/schema';

interface PayrollRouteDeps {
  requireEmployeeAdmin: (c: any) => Promise<Response | null>;
  loadAttendanceRules: (db: D1Database) => Promise<AttendanceRulesInfo>;
  writeAudit: (
    db: D1Database,
    entry: { username?: string; role?: string; action: string; entity?: string; entity_id?: string; detail?: string; ip?: string },
  ) => Promise<void>;
  sessionUserFromHeader: (hdr?: string) => { username?: string; role?: string };
  clientIp: (c: any) => string;
}

type IgrBracket = {
  upTo: number | null;
  rate: number;
  deduction: number;
};

type PayrollRates = {
  cnss_emp_rate: number;
  cnss_ceiling: number;
  cnss_employer_social_rate: number;
  cnss_employer_af_rate: number;
  cnss_employer_tfp_rate: number;
  amo_emp_rate: number;
  amo_employer_rate: number;
  prof_expenses_rate: number;
  prof_expenses_monthly_cap: number;
  igr_brackets: IgrBracket[];
};

const DEFAULT_IGR_BRACKETS: IgrBracket[] = [
  { upTo: 3333.33, rate: 0, deduction: 0 },
  { upTo: 5000, rate: 0.1, deduction: 333.33 },
  { upTo: 6666.67, rate: 0.2, deduction: 833.33 },
  { upTo: 8333.33, rate: 0.3, deduction: 1500 },
  { upTo: 15000, rate: 0.34, deduction: 1833.33 },
  { upTo: null, rate: 0.37, deduction: 2283.33 },
];

export async function ensurePayrollSchema(db: D1Database): Promise<void> {
  await schemaOnceForDb(db, 'payroll_schema_v16', async () => {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS payroll_settings (
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
        )`,
      )
      .run();
    await db.prepare(`INSERT OR IGNORE INTO payroll_settings (id) VALUES (1)`).run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS payroll_runs (
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
        )`,
      )
      .run();

    try {
      await db
        .prepare(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_regular_month ON payroll_runs(period_month) WHERE run_kind = 'regular'`,
        )
        .run();
    } catch {
      /* */
    }
    try {
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_payroll_runs_month ON payroll_runs(period_month, created_at DESC)`).run();
    } catch {
      /* */
    }

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS payroll_lines (
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
        )`,
      )
      .run();
    try {
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_payroll_lines_run ON payroll_lines(run_id)`).run();
    } catch {
      /* */
    }
    // Jours déclarés à la CNSS (bordereau DAMANCOM, max 26 / mois). 0 = non déclaré ce mois-ci.
    await addColumnIfMissing(db, 'payroll_lines', 'cnss_days', 'REAL NOT NULL DEFAULT 26');
  });
}

/** CNSS caps the declared days at 26 per month. */
export const CNSS_MAX_DAYS = 26;

export function clampCnssDays(v: unknown, fallback = CNSS_MAX_DAYS): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(CNSS_MAX_DAYS, Math.round(n * 2) / 2));
}

/**
 * Days proposed on a new payroll line: the employee's usual declared days,
 * reduced pro-rata when attendance shows absences (30 calendar days → 26 CNSS days).
 */
export function proposeCnssDays(employeeDays: number, declared: boolean, daysWorked: number): number {
  if (!declared) return 0;
  const usual = clampCnssDays(employeeDays);
  const fromAttendance = clampCnssDays(Math.round((Math.max(0, Math.min(30, daysWorked)) * CNSS_MAX_DAYS) / 30));
  return Math.min(usual, fromAttendance);
}

function parseRatesRow(row: any): PayrollRates {
  let brackets = DEFAULT_IGR_BRACKETS;
  try {
    const parsed = JSON.parse(String(row?.igr_brackets_json || ''));
    if (Array.isArray(parsed) && parsed.length > 0) brackets = parsed;
  } catch {
    /* fallback to default */
  }
  return {
    cnss_emp_rate: Number(row?.cnss_emp_rate ?? 0.0448),
    cnss_ceiling: Number(row?.cnss_ceiling ?? 6000),
    cnss_employer_social_rate: Number(row?.cnss_employer_social_rate ?? 0.0898),
    cnss_employer_af_rate: Number(row?.cnss_employer_af_rate ?? 0.064),
    cnss_employer_tfp_rate: Number(row?.cnss_employer_tfp_rate ?? 0.016),
    amo_emp_rate: Number(row?.amo_emp_rate ?? 0.0226),
    amo_employer_rate: Number(row?.amo_employer_rate ?? 0.0411),
    prof_expenses_rate: Number(row?.prof_expenses_rate ?? 0.25),
    prof_expenses_monthly_cap: Number(row?.prof_expenses_monthly_cap ?? 2916.67),
    igr_brackets: brackets,
  };
}

function computePayrollLine(
  input: {
    base_salary: number;
    overtime_amount: number;
    attendance_adjustment: number;
    bonuses: number;
    advances_deducted: number;
    /** Declared CNSS days; 0 = not declared this month → no CNSS / AMO contributions. */
    cnss_days?: number;
  },
  rates: PayrollRates,
) {
  const declared = input.cnss_days === undefined || Number(input.cnss_days) > 0;
  if (!declared) {
    rates = {
      ...rates,
      cnss_emp_rate: 0,
      cnss_employer_social_rate: 0,
      cnss_employer_af_rate: 0,
      cnss_employer_tfp_rate: 0,
      amo_emp_rate: 0,
      amo_employer_rate: 0,
    };
  }
  const gross_salary = Math.max(
    0,
    round2(input.base_salary + input.overtime_amount + input.attendance_adjustment + input.bonuses),
  );
  const cnss_base = declared ? round2(Math.min(gross_salary, Math.max(0, rates.cnss_ceiling))) : 0;
  const cnss_emp = round2(cnss_base * rates.cnss_emp_rate);
  const amo_emp = round2(gross_salary * rates.amo_emp_rate);
  const prof_expenses = round2(
    Math.min(gross_salary * rates.prof_expenses_rate, rates.prof_expenses_monthly_cap),
  );
  const taxable_net = Math.max(0, round2(gross_salary - cnss_emp - amo_emp - prof_expenses));

  let igr = 0;
  for (const b of rates.igr_brackets) {
    if (b.upTo == null || taxable_net <= b.upTo) {
      igr = Math.max(0, round2(taxable_net * Number(b.rate || 0) - Number(b.deduction || 0)));
      break;
    }
  }

  const net_salary = Math.max(0, round2(gross_salary - cnss_emp - amo_emp - igr - input.advances_deducted));
  const cnss_employer = round2(
    cnss_base * rates.cnss_employer_social_rate +
      gross_salary * (rates.cnss_employer_af_rate + rates.cnss_employer_tfp_rate),
  );
  const amo_employer = round2(gross_salary * rates.amo_employer_rate);
  const employer_cost = round2(gross_salary + cnss_employer + amo_employer);

  return {
    gross_salary,
    cnss_base,
    cnss_emp,
    amo_emp,
    prof_expenses,
    taxable_net,
    igr,
    net_salary,
    cnss_employer,
    amo_employer,
    employer_cost,
  };
}

function monthRange(month: string): { month: string; from: string; to: string } {
  const m = /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
  const [y, mm] = m.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, mm, 0)).getUTCDate();
  return { month: m, from: `${m}-01`, to: `${m}-${String(lastDay).padStart(2, '0')}` };
}

function escXml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function csvCell(s: unknown): string {
  return `"${String(s ?? '').replace(/"/g, '""')}"`;
}

async function recomputeRunTotals(db: D1Database, runId: number): Promise<void> {
  const agg = (await db
    .prepare(
      `SELECT COALESCE(SUM(gross_salary),0) AS gross,
              COALESCE(SUM(cnss_emp),0) AS cnss_emp,
              COALESCE(SUM(amo_emp),0) AS amo_emp,
              COALESCE(SUM(igr),0) AS igr,
              COALESCE(SUM(net_salary),0) AS net,
              COALESCE(SUM(employer_cost),0) AS emp_cost
       FROM payroll_lines WHERE run_id = ?`,
    )
    .bind(runId)
    .first()) as any;
  await db
    .prepare(
      `UPDATE payroll_runs
       SET total_gross = ?, total_cnss_emp = ?, total_amo_emp = ?, total_igr = ?, total_net = ?, total_employer_cost = ?
       WHERE id = ?`,
    )
    .bind(
      round2(agg?.gross || 0),
      round2(agg?.cnss_emp || 0),
      round2(agg?.amo_emp || 0),
      round2(agg?.igr || 0),
      round2(agg?.net || 0),
      round2(agg?.emp_cost || 0),
      runId,
    )
    .run();
}

export function registerPayrollRoutes(app: Hono<any>, deps: PayrollRouteDeps): void {
  const { requireEmployeeAdmin, loadAttendanceRules, writeAudit, sessionUserFromHeader, clientIp } = deps;

  app.get('/api/payroll/settings', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    await ensurePayrollSchema(c.env.DB);
    const row = await c.env.DB.prepare(`SELECT * FROM payroll_settings WHERE id = 1`).first();
    return c.json({
      success: true,
      data: {
        ...parseRatesRow(row),
        updated_at: (row as any)?.updated_at || null,
        updated_by: (row as any)?.updated_by || '',
        disclaimer: 'Barème indicatif Maroc — à vérifier avec votre comptable.',
      },
    });
  });

  app.put('/api/payroll/settings', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    await ensurePayrollSchema(c.env.DB);
    const actor = sessionUserFromHeader(c.req.header('Authorization'));
    const body = await c.req.json().catch(() => ({}));
    const current = parseRatesRow(await c.env.DB.prepare(`SELECT * FROM payroll_settings WHERE id = 1`).first());

    const num = (v: unknown, def: number, min = 0, max = 1) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= min && n <= max ? n : def;
    };

    const next: PayrollRates = {
      cnss_emp_rate: num(body.cnss_emp_rate, current.cnss_emp_rate, 0, 0.5),
      cnss_ceiling: num(body.cnss_ceiling, current.cnss_ceiling, 0, 1000000),
      cnss_employer_social_rate: num(body.cnss_employer_social_rate, current.cnss_employer_social_rate, 0, 0.5),
      cnss_employer_af_rate: num(body.cnss_employer_af_rate, current.cnss_employer_af_rate, 0, 0.5),
      cnss_employer_tfp_rate: num(body.cnss_employer_tfp_rate, current.cnss_employer_tfp_rate, 0, 0.5),
      amo_emp_rate: num(body.amo_emp_rate, current.amo_emp_rate, 0, 0.5),
      amo_employer_rate: num(body.amo_employer_rate, current.amo_employer_rate, 0, 0.5),
      prof_expenses_rate: num(body.prof_expenses_rate, current.prof_expenses_rate, 0, 1),
      prof_expenses_monthly_cap: num(body.prof_expenses_monthly_cap, current.prof_expenses_monthly_cap, 0, 1000000),
      igr_brackets: Array.isArray(body.igr_brackets) && body.igr_brackets.length > 0 ? body.igr_brackets : current.igr_brackets,
    };

    await c.env.DB.prepare(
      `UPDATE payroll_settings
       SET cnss_emp_rate=?, cnss_ceiling=?, cnss_employer_social_rate=?, cnss_employer_af_rate=?, cnss_employer_tfp_rate=?,
           amo_emp_rate=?, amo_employer_rate=?, prof_expenses_rate=?, prof_expenses_monthly_cap=?, igr_brackets_json=?,
           updated_at = datetime('now'), updated_by = ?
       WHERE id = 1`,
    )
      .bind(
        next.cnss_emp_rate,
        next.cnss_ceiling,
        next.cnss_employer_social_rate,
        next.cnss_employer_af_rate,
        next.cnss_employer_tfp_rate,
        next.amo_emp_rate,
        next.amo_employer_rate,
        next.prof_expenses_rate,
        next.prof_expenses_monthly_cap,
        JSON.stringify(next.igr_brackets),
        actor.username || '',
      )
      .run();

    await writeAudit(c.env.DB, {
      username: actor.username,
      role: actor.role,
      action: 'payroll.settings_update',
      entity: 'payroll_settings',
      entity_id: '1',
      detail: JSON.stringify({ cnss_emp_rate: next.cnss_emp_rate, amo_emp_rate: next.amo_emp_rate, cnss_ceiling: next.cnss_ceiling }),
      ip: clientIp(c),
    });

    return c.json({ success: true, data: next });
  });

  app.get('/api/payroll/runs', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    await ensurePayrollSchema(c.env.DB);
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM payroll_runs ORDER BY period_month DESC, id DESC LIMIT 100`,
    ).all();
    return c.json({ success: true, data: results || [] });
  });

  app.post('/api/payroll/runs', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    await ensurePayrollSchema(c.env.DB);
    const actor = sessionUserFromHeader(c.req.header('Authorization'));
    const body = await c.req.json().catch(() => ({}));
    const rawMonth = String(body.period_month || new Date().toISOString().slice(0, 7)).trim();
    if (!/^\d{4}-\d{2}$/.test(rawMonth)) {
      return c.json({ success: false, error: 'Format de période attendu : AAAA-MM' }, 400);
    }
    const runKind = body.run_kind === 'corrective' ? 'corrective' : 'regular';
    const correctsRunId = body.corrects_run_id ? Number(body.corrects_run_id) : null;

    if (runKind === 'regular') {
      const exists = await c.env.DB.prepare(
        `SELECT id, status FROM payroll_runs WHERE period_month = ? AND run_kind = 'regular'`,
      )
        .bind(rawMonth)
        .first();
      if (exists) {
        return c.json(
          {
            success: false,
            error: `Un lot de paie mensuel existe déjà pour ${rawMonth} (#${(exists as any).id}). Créez un lot correctif si besoin.`,
            code: 'PAYROLL_RUN_EXISTS',
          },
          409,
        );
      }
    }

    const rates = parseRatesRow(await c.env.DB.prepare(`SELECT * FROM payroll_settings WHERE id = 1`).first());
    const attRules = await loadAttendanceRules(c.env.DB);
    const { from, to } = monthRange(rawMonth);

    const empRes = await c.env.DB.prepare(
      `SELECT * FROM employees WHERE COALESCE(active, 1) = 1 ORDER BY last_name, first_name, id`,
    ).all();
    const employees = (empRes.results || []) as any[];

    // Read Part 3 monthly attendance if table exists
    const attByEmp = new Map<number, any[]>();
    try {
      const attRes = await c.env.DB.prepare(
        `SELECT employee_id, work_date, check_in, check_out, status FROM employee_attendance WHERE work_date >= ? AND work_date <= ?`,
      )
        .bind(from, to)
        .all();
      for (const r of (attRes.results || []) as any[]) {
        const eid = Number(r.employee_id);
        if (!attByEmp.has(eid)) attByEmp.set(eid, []);
        attByEmp.get(eid)!.push(r);
      }
    } catch {
      /* attendance table may not exist yet */
    }

    // Check advances / employee_payments during the month if table exists
    const advByEmp = new Map<number, number>();
    try {
      const advRes = await c.env.DB.prepare(
        `SELECT employee_id, COALESCE(SUM(amount), 0) AS amt
         FROM employee_payments
         WHERE paid_at >= ? AND paid_at <= ? AND LOWER(COALESCE(note,'')) LIKE '%acompte%'
         GROUP BY employee_id`,
      )
        .bind(from, to)
        .all();
      for (const r of (advRes.results || []) as any[]) {
        advByEmp.set(Number(r.employee_id), round2(Number(r.amt || 0)));
      }
    } catch {
      /* */
    }

    const insRun = await c.env.DB.prepare(
      `INSERT INTO payroll_runs (period_month, status, run_kind, corrects_run_id, rates_snapshot_json, notes, created_by)
       VALUES (?, 'draft', ?, ?, ?, ?, ?)`,
    )
      .bind(
        rawMonth,
        runKind,
        correctsRunId,
        JSON.stringify(rates),
        String(body.notes || ''),
        actor.username || '',
      )
      .run();
    const runId = Number(insRun.meta?.last_row_id || 0);

    const otMultiplier = Number(attRules.overtime_multiplier ?? 1.25);
    const workdayHours = Math.max(1, Number(attRules.workday_hours ?? 8));

    for (const e of employees) {
      const empId = Number(e.id);
      const baseMonthly = round2(Number(e.pay_amount || 0));
      const attRows = attByEmp.get(empId) || [];
      let daysWorked = 30;
      let overtimeHours = 0;
      let lateMinutes = 0;
      let attendanceAdjustment = 0;

      if (attRows.length > 0) {
        let weight = 0;
        let absentCount = 0;
        for (const r of attRows) {
          const st = String(r.status || (r.check_in ? 'present' : 'absent')).toLowerCase();
          if (st === 'half') weight += 0.5;
          else if (st === 'absent') absentCount += 1;
          else weight += 1;
          const m = computeDayMetrics(r.check_in, r.check_out, st, attRules);
          overtimeHours = round2(overtimeHours + m.overtime_hours);
          lateMinutes += m.late_minutes;
        }
        daysWorked = Math.max(0, Math.min(30, round2(30 - absentCount - (attRows.filter((r) => String(r.status || '').toLowerCase() === 'half').length * 0.5))));
        if (attRules.enabled && baseMonthly > 0) {
          const dailyRate = baseMonthly / 30;
          if (absentCount > 0 || weight < attRows.length) {
            const lostDays = Math.max(0, attRows.length - weight);
            attendanceAdjustment = round2(attendanceAdjustment - lostDays * dailyRate);
          }
          if (attRules.minute_deduct && lateMinutes > 0) {
            attendanceAdjustment = round2(attendanceAdjustment - (lateMinutes / (workdayHours * 60)) * dailyRate);
          }
        }
      }

      const hourlyRate = baseMonthly > 0 ? baseMonthly / (26 * workdayHours) : 0;
      const overtimeAmount = round2(overtimeHours * hourlyRate * otMultiplier);
      const advancesDeducted = advByEmp.get(empId) || 0;
      const cnssDeclared = e.cnss_declared === undefined || e.cnss_declared === null ? true : Number(e.cnss_declared) !== 0;
      const cnssDays = proposeCnssDays(
        e.cnss_days === undefined || e.cnss_days === null ? CNSS_MAX_DAYS : Number(e.cnss_days),
        cnssDeclared,
        daysWorked,
      );
      const calc = computePayrollLine(
        {
          base_salary: baseMonthly,
          overtime_amount: overtimeAmount,
          attendance_adjustment: attendanceAdjustment,
          bonuses: 0,
          advances_deducted: advancesDeducted,
          cnss_days: cnssDays,
        },
        rates,
      );

      const empName = [e.first_name, e.last_name].filter(Boolean).join(' ') || e.name || `Employé #${empId}`;
      await c.env.DB.prepare(
        `INSERT INTO payroll_lines (
          run_id, employee_id, emp_number, employee_name, cnss_number, cin, role_title,
          base_salary, days_worked, overtime_hours, overtime_amount, late_minutes, attendance_adjustment,
          bonuses, gross_salary, cnss_base, cnss_emp, amo_emp, prof_expenses, taxable_net, igr,
          advances_deducted, net_salary, cnss_employer, amo_employer, employer_cost, notes, cnss_days
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)`,
      )
        .bind(
          runId,
          empId,
          String(e.emp_number || ''),
          empName,
          String(e.cnss_number || e.social_insurance || ''),
          String(e.national_id || ''),
          String(e.role_title || ''),
          baseMonthly,
          daysWorked,
          overtimeHours,
          overtimeAmount,
          lateMinutes,
          attendanceAdjustment,
          calc.gross_salary,
          calc.cnss_base,
          calc.cnss_emp,
          calc.amo_emp,
          calc.prof_expenses,
          calc.taxable_net,
          calc.igr,
          advancesDeducted,
          calc.net_salary,
          calc.cnss_employer,
          calc.amo_employer,
          calc.employer_cost,
          cnssDays,
        )
        .run();
    }

    await recomputeRunTotals(c.env.DB, runId);

    await writeAudit(c.env.DB, {
      username: actor.username,
      role: actor.role,
      action: 'payroll.run_create',
      entity: 'payroll_runs',
      entity_id: String(runId),
      detail: JSON.stringify({ period_month: rawMonth, run_kind: runKind, employees: employees.length }),
      ip: clientIp(c),
    });

    const run = await c.env.DB.prepare(`SELECT * FROM payroll_runs WHERE id = ?`).bind(runId).first();
    const lines = await c.env.DB.prepare(`SELECT * FROM payroll_lines WHERE run_id = ? ORDER BY employee_name, id`).bind(runId).all();
    return c.json({ success: true, data: { ...(run as any), lines: lines.results || [] } }, 201);
  });

  app.get('/api/payroll/runs/:id', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    await ensurePayrollSchema(c.env.DB);
    const id = Number(c.req.param('id') || 0);
    const run = await c.env.DB.prepare(`SELECT * FROM payroll_runs WHERE id = ?`).bind(id).first();
    if (!run) return c.json({ success: false, error: 'Lot de paie introuvable' }, 404);
    const lines = await c.env.DB.prepare(`SELECT * FROM payroll_lines WHERE run_id = ? ORDER BY employee_name, id`).bind(id).all();
    return c.json({ success: true, data: { ...(run as any), lines: lines.results || [] } });
  });

  app.patch('/api/payroll/runs/:id/lines/:lineId', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    await ensurePayrollSchema(c.env.DB);
    const runId = Number(c.req.param('id') || 0);
    const lineId = Number(c.req.param('lineId') || 0);
    const run = (await c.env.DB.prepare(`SELECT * FROM payroll_runs WHERE id = ?`).bind(runId).first()) as any;
    if (!run) return c.json({ success: false, error: 'Lot de paie introuvable' }, 404);
    if (run.status === 'closed') {
      return c.json(
        {
          success: false,
          error: 'Lot clôturé : modification impossible. Créez un lot correctif.',
          code: 'PAYROLL_RUN_IMMUTABLE',
        },
        409,
      );
    }
    const line = (await c.env.DB.prepare(`SELECT * FROM payroll_lines WHERE id = ? AND run_id = ?`).bind(lineId, runId).first()) as any;
    if (!line) return c.json({ success: false, error: 'Ligne de paie introuvable' }, 404);

    const body = await c.req.json().catch(() => ({}));
    const rates: PayrollRates = (() => {
      try {
        return JSON.parse(String(run.rates_snapshot_json || '{}'));
      } catch {
        return parseRatesRow(null);
      }
    })();

    const base_salary = body.base_salary !== undefined ? round2(Number(body.base_salary) || 0) : Number(line.base_salary);
    const overtime_hours = body.overtime_hours !== undefined ? round2(Number(body.overtime_hours) || 0) : Number(line.overtime_hours);
    const overtime_amount = body.overtime_amount !== undefined ? round2(Number(body.overtime_amount) || 0) : Number(line.overtime_amount);
    const attendance_adjustment =
      body.attendance_adjustment !== undefined ? round2(Number(body.attendance_adjustment) || 0) : Number(line.attendance_adjustment);
    const bonuses = body.bonuses !== undefined ? round2(Number(body.bonuses) || 0) : Number(line.bonuses);
    const advances_deducted =
      body.advances_deducted !== undefined ? round2(Number(body.advances_deducted) || 0) : Number(line.advances_deducted);
    const notes = body.notes !== undefined ? String(body.notes) : String(line.notes || '');
    const days_worked =
      body.days_worked !== undefined
        ? Math.max(0, Math.min(31, round2(Number(body.days_worked) || 0)))
        : Number(line.days_worked ?? 30);
    const cnss_days =
      body.cnss_days !== undefined
        ? clampCnssDays(body.cnss_days, 0)
        : clampCnssDays(line.cnss_days ?? CNSS_MAX_DAYS);

    const calc = computePayrollLine(
      { base_salary, overtime_amount, attendance_adjustment, bonuses, advances_deducted, cnss_days },
      rates,
    );

    await c.env.DB.prepare(
      `UPDATE payroll_lines
       SET base_salary=?, overtime_hours=?, overtime_amount=?, attendance_adjustment=?, bonuses=?, advances_deducted=?,
           gross_salary=?, cnss_base=?, cnss_emp=?, amo_emp=?, prof_expenses=?, taxable_net=?, igr=?, net_salary=?,
           cnss_employer=?, amo_employer=?, employer_cost=?, notes=?, days_worked=?, cnss_days=?
       WHERE id = ? AND run_id = ?`,
    )
      .bind(
        base_salary,
        overtime_hours,
        overtime_amount,
        attendance_adjustment,
        bonuses,
        advances_deducted,
        calc.gross_salary,
        calc.cnss_base,
        calc.cnss_emp,
        calc.amo_emp,
        calc.prof_expenses,
        calc.taxable_net,
        calc.igr,
        calc.net_salary,
        calc.cnss_employer,
        calc.amo_employer,
        calc.employer_cost,
        notes,
        days_worked,
        cnss_days,
        lineId,
        runId,
      )
      .run();

    await recomputeRunTotals(c.env.DB, runId);
    const updatedLine = await c.env.DB.prepare(`SELECT * FROM payroll_lines WHERE id = ?`).bind(lineId).first();
    return c.json({ success: true, data: updatedLine });
  });

  app.post('/api/payroll/runs/:id/close', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    await ensurePayrollSchema(c.env.DB);
    const actor = sessionUserFromHeader(c.req.header('Authorization'));
    const runId = Number(c.req.param('id') || 0);
    const run = (await c.env.DB.prepare(`SELECT * FROM payroll_runs WHERE id = ?`).bind(runId).first()) as any;
    if (!run) return c.json({ success: false, error: 'Lot de paie introuvable' }, 404);
    if (run.status === 'closed') {
      return c.json({ success: false, error: 'Lot déjà clôturé et immuable', code: 'PAYROLL_RUN_IMMUTABLE' }, 409);
    }

    await recomputeRunTotals(c.env.DB, runId);
    await c.env.DB.prepare(
      `UPDATE payroll_runs SET status = 'closed', closed_by = ?, closed_at = datetime('now') WHERE id = ?`,
    )
      .bind(actor.username || '', runId)
      .run();

    await writeAudit(c.env.DB, {
      username: actor.username,
      role: actor.role,
      action: 'payroll.run_close',
      entity: 'payroll_runs',
      entity_id: String(runId),
      detail: JSON.stringify({ period_month: run.period_month, run_kind: run.run_kind, total_net: run.total_net }),
      ip: clientIp(c),
    });

    const closed = await c.env.DB.prepare(`SELECT * FROM payroll_runs WHERE id = ?`).bind(runId).first();
    const lines = await c.env.DB.prepare(`SELECT * FROM payroll_lines WHERE run_id = ? ORDER BY employee_name, id`).bind(runId).all();
    return c.json({ success: true, data: { ...(closed as any), lines: lines.results || [] } });
  });

  app.get('/api/payroll/runs/:id/lines/:lineId/bulletin', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    await ensurePayrollSchema(c.env.DB);
    const runId = Number(c.req.param('id') || 0);
    const lineId = Number(c.req.param('lineId') || 0);
    const run = (await c.env.DB.prepare(`SELECT * FROM payroll_runs WHERE id = ?`).bind(runId).first()) as any;
    if (!run) return c.json({ success: false, error: 'Lot de paie introuvable' }, 404);
    const line = (await c.env.DB.prepare(`SELECT * FROM payroll_lines WHERE id = ? AND run_id = ?`).bind(lineId, runId).first()) as any;
    if (!line) return c.json({ success: false, error: 'Ligne de paie introuvable' }, 404);
    const settings = (await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first().catch(() => null)) as any;

    const pdf = buildPayslipPdf({
      periodMonth: run.period_month,
      runId: run.id,
      runKind: run.run_kind,
      status: run.status,
      company: {
        name: settings?.company_name || 'Atlas Commerce',
        address: settings?.address || '',
        city: settings?.city || '',
        ice: settings?.ice || '',
        if_number: settings?.if_number || '',
        rc: settings?.rc || '',
        cnss: settings?.cnss || '',
      },
      employee: {
        emp_number: line.emp_number,
        name: line.employee_name,
        cin: line.cin,
        cnss_number: line.cnss_number,
        role_title: line.role_title,
      },
      line: {
        base_salary: Number(line.base_salary || 0),
        days_worked: Number(line.days_worked || 30),
        overtime_hours: Number(line.overtime_hours || 0),
        overtime_amount: Number(line.overtime_amount || 0),
        late_minutes: Number(line.late_minutes || 0),
        attendance_adjustment: Number(line.attendance_adjustment || 0),
        bonuses: Number(line.bonuses || 0),
        gross_salary: Number(line.gross_salary || 0),
        cnss_base: Number(line.cnss_base || 0),
        cnss_emp: Number(line.cnss_emp || 0),
        amo_emp: Number(line.amo_emp || 0),
        prof_expenses: Number(line.prof_expenses || 0),
        taxable_net: Number(line.taxable_net || 0),
        igr: Number(line.igr || 0),
        advances_deducted: Number(line.advances_deducted || 0),
        net_salary: Number(line.net_salary || 0),
        cnss_employer: Number(line.cnss_employer || 0),
        amo_employer: Number(line.amo_employer || 0),
        employer_cost: Number(line.employer_cost || 0),
      },
      generatedAt: new Date().toISOString(),
    });

    const safeName = String(line.emp_number || line.employee_name || lineId).replace(/[^a-zA-Z0-9_-]+/g, '_');
    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="bulletin_${run.period_month}_${safeName}.pdf"`,
      },
    });
  });

  app.get('/api/payroll/runs/:id/declaration', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    await ensurePayrollSchema(c.env.DB);
    const runId = Number(c.req.param('id') || 0);
    const format = String(c.req.query('format') || 'csv').toLowerCase();
    const run = (await c.env.DB.prepare(`SELECT * FROM payroll_runs WHERE id = ?`).bind(runId).first()) as any;
    if (!run) return c.json({ success: false, error: 'Lot de paie introuvable' }, 404);
    const { results } = await c.env.DB.prepare(`SELECT * FROM payroll_lines WHERE run_id = ? ORDER BY employee_name, id`).bind(runId).all();
    const lines = (results || []) as any[];
    const settings = (await c.env.DB.prepare(`SELECT company_name, ice, cnss FROM company_settings WHERE id = 1`).first().catch(() => null)) as any;

    const totalCnssPat = round2(lines.reduce((s, r) => s + Number(r.cnss_employer || 0), 0));
    const totalAmoPat = round2(lines.reduce((s, r) => s + Number(r.amo_employer || 0), 0));
    const totalCnssAll = round2(Number(run.total_cnss_emp || 0) + totalCnssPat);
    const totalAmoAll = round2(Number(run.total_amo_emp || 0) + totalAmoPat);

    if (format === 'xls' || format === 'excel') {
      const empRowsXml = lines
        .map(
          (l) => `<Row>
            <Cell><Data ss:Type="String">${escXml(l.emp_number)}</Data></Cell>
            <Cell><Data ss:Type="String">${escXml(l.employee_name)}</Data></Cell>
            <Cell><Data ss:Type="String">${escXml(l.cnss_number)}</Data></Cell>
            <Cell><Data ss:Type="String">${escXml(l.cin)}</Data></Cell>
            <Cell><Data ss:Type="Number">${Number(l.days_worked || 0)}</Data></Cell>
            <Cell><Data ss:Type="Number">${Number(l.cnss_days ?? CNSS_MAX_DAYS)}</Data></Cell>
            <Cell><Data ss:Type="Number">${Number(l.gross_salary || 0)}</Data></Cell>
            <Cell><Data ss:Type="Number">${Number(l.cnss_base || 0)}</Data></Cell>
            <Cell><Data ss:Type="Number">${Number(l.cnss_emp || 0)}</Data></Cell>
            <Cell><Data ss:Type="Number">${Number(l.cnss_employer || 0)}</Data></Cell>
            <Cell><Data ss:Type="Number">${Number(l.amo_emp || 0)}</Data></Cell>
            <Cell><Data ss:Type="Number">${Number(l.amo_employer || 0)}</Data></Cell>
            <Cell><Data ss:Type="Number">${Number(l.igr || 0)}</Data></Cell>
            <Cell><Data ss:Type="Number">${Number(l.net_salary || 0)}</Data></Cell>
          </Row>`,
        )
        .join('\n');

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Worksheet ss:Name="Declaration_CNSS_AMO">
  <Table>
   <Row>
    <Cell><Data ss:Type="String">Matricule</Data></Cell>
    <Cell><Data ss:Type="String">Salarié</Data></Cell>
    <Cell><Data ss:Type="String">N° CNSS</Data></Cell>
    <Cell><Data ss:Type="String">CIN</Data></Cell>
    <Cell><Data ss:Type="String">Jours travaillés</Data></Cell>
    <Cell><Data ss:Type="String">Jours déclarés CNSS</Data></Cell>
    <Cell><Data ss:Type="String">Brut (MAD)</Data></Cell>
    <Cell><Data ss:Type="String">Assiette CNSS</Data></Cell>
    <Cell><Data ss:Type="String">CNSS Salarié</Data></Cell>
    <Cell><Data ss:Type="String">CNSS Patronale</Data></Cell>
    <Cell><Data ss:Type="String">AMO Salarié</Data></Cell>
    <Cell><Data ss:Type="String">AMO Patronale</Data></Cell>
    <Cell><Data ss:Type="String">IGR</Data></Cell>
    <Cell><Data ss:Type="String">Net à payer</Data></Cell>
   </Row>
   ${empRowsXml}
  </Table>
 </Worksheet>
 <Worksheet ss:Name="Totaux">
  <Table>
   <Row><Cell><Data ss:Type="String">Employeur</Data></Cell><Cell><Data ss:Type="String">${escXml(settings?.company_name || 'Atlas Commerce')}</Data></Cell></Row>
   <Row><Cell><Data ss:Type="String">ICE</Data></Cell><Cell><Data ss:Type="String">${escXml(settings?.ice || '')}</Data></Cell></Row>
   <Row><Cell><Data ss:Type="String">Affiliation CNSS</Data></Cell><Cell><Data ss:Type="String">${escXml(settings?.cnss || '')}</Data></Cell></Row>
   <Row><Cell><Data ss:Type="String">Période</Data></Cell><Cell><Data ss:Type="String">${escXml(run.period_month)}</Data></Cell></Row>
   <Row><Cell><Data ss:Type="String">Effectif déclaré</Data></Cell><Cell><Data ss:Type="Number">${lines.filter((l) => Number(l.cnss_days ?? CNSS_MAX_DAYS) > 0).length}</Data></Cell></Row>
   <Row><Cell><Data ss:Type="String">Total jours déclarés CNSS</Data></Cell><Cell><Data ss:Type="Number">${round2(lines.reduce((sum, l) => sum + Number(l.cnss_days ?? CNSS_MAX_DAYS), 0))}</Data></Cell></Row>
   <Row><Cell><Data ss:Type="String">Masse salariale brute</Data></Cell><Cell><Data ss:Type="Number">${Number(run.total_gross || 0)}</Data></Cell></Row>
   <Row><Cell><Data ss:Type="String">Total CNSS (Salariale + Patronale)</Data></Cell><Cell><Data ss:Type="Number">${totalCnssAll}</Data></Cell></Row>
   <Row><Cell><Data ss:Type="String">Total AMO (Salariale + Patronale)</Data></Cell><Cell><Data ss:Type="Number">${totalAmoAll}</Data></Cell></Row>
   <Row><Cell><Data ss:Type="String">Total IGR</Data></Cell><Cell><Data ss:Type="Number">${Number(run.total_igr || 0)}</Data></Cell></Row>
   <Row><Cell><Data ss:Type="String">Total Net à payer</Data></Cell><Cell><Data ss:Type="Number">${Number(run.total_net || 0)}</Data></Cell></Row>
   <Row><Cell><Data ss:Type="String">Coût total employeur</Data></Cell><Cell><Data ss:Type="Number">${Number(run.total_employer_cost || 0)}</Data></Cell></Row>
  </Table>
 </Worksheet>
</Workbook>`;

      return new Response(xml, {
        headers: {
          'Content-Type': 'application/vnd.ms-excel; charset=utf-8',
          'Content-Disposition': `attachment; filename="declaration_cnss_amo_${run.period_month}.xls"`,
        },
      });
    }

    const header =
      'periode,employeur_ice,employeur_cnss,matricule,salarie,num_cnss,cin,jours,jours_cnss,brut,assiette_cnss,cnss_salarie,cnss_patronale,amo_salarie,amo_patronale,igr,net_a_payer,cout_employeur';
    const csvLines = lines.map((l) =>
      [
        run.period_month,
        settings?.ice || '',
        settings?.cnss || '',
        l.emp_number,
        l.employee_name,
        l.cnss_number,
        l.cin,
        l.days_worked,
        l.cnss_days ?? CNSS_MAX_DAYS,
        l.gross_salary,
        l.cnss_base,
        l.cnss_emp,
        l.cnss_employer,
        l.amo_emp,
        l.amo_employer,
        l.igr,
        l.net_salary,
        l.employer_cost,
      ]
        .map(csvCell)
        .join(','),
    );
    csvLines.push(
      [
        run.period_month,
        settings?.ice || '',
        settings?.cnss || '',
        'TOTAUX',
        `${lines.length} salarie(s)`,
        '',
        '',
        '',
        round2(lines.reduce((sum, l) => sum + Number(l.cnss_days ?? CNSS_MAX_DAYS), 0)),
        run.total_gross,
        '',
        run.total_cnss_emp,
        totalCnssPat,
        run.total_amo_emp,
        totalAmoPat,
        run.total_igr,
        run.total_net,
        run.total_employer_cost,
      ]
        .map(csvCell)
        .join(','),
    );
    return new Response([header, ...csvLines].join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="declaration_cnss_amo_${run.period_month}.csv"`,
      },
    });
  });
}
