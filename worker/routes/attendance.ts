import type { Hono } from 'hono';
import { round2 } from '../lib/financeCore';

export interface AttendanceRulesInfo {
  enabled: boolean;
  late_threshold: string;
  early_threshold?: string;
  overtime_after_hours?: number;
  overtime_multiplier?: number;
  pay_mode: string;
  minute_deduct: boolean;
  warn_late_count: number;
  blame_late_count: number;
  workday_hours: number;
}

export interface AttendanceRouteDeps {
  requireEmployeeAdmin: (c: any) => Promise<Response | null>;
  ensureHrSettings: (db: D1Database) => Promise<void>;
  ensureEmployeeTeamColumn: (db: D1Database) => Promise<void>;
  loadAttendanceRules: (db: D1Database) => Promise<AttendanceRulesInfo>;
  schemaOnce: (key: string, fn: () => Promise<void>) => Promise<void>;
  addColumnIfMissing: (db: D1Database, table: string, col: string, def: string) => Promise<void>;
  reportShell: (title: string, company: string, period: string, body: string, footer?: string, backUrl?: string) => string;
  moroccoTodayStr: () => string;
}

const attDbs = new WeakSet<object>();

function moroccoNowTime(): string {
  try {
    return new Date().toLocaleTimeString('fr-FR', {
      timeZone: 'Africa/Casablanca',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return new Date().toISOString().slice(11, 16);
  }
}

function timeToMinutes(t: string | null | undefined): number | null {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function parseHmToMinutes(hm: string): number {
  const m = String(hm || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

function deriveAttendanceStatus(
  checkIn: string | null,
  checkOut: string | null,
  forced?: string | null,
  lateThreshold = '09:15',
): string {
  const f = String(forced || '').toLowerCase().trim();
  if (f === 'absent' || f === 'excused') return f;
  const inM = timeToMinutes(checkIn);
  if (inM == null) return 'absent';
  const outM = timeToMinutes(checkOut);
  if (outM != null && outM > inM) {
    const duration = outM - inM;
    const morningHalf = inM <= 10 * 60 + 30 && outM <= 14 * 60 && duration >= 3 * 60 && duration <= 5 * 60 + 30;
    const afternoonHalf = inM >= 12 * 60 && inM <= 15 * 60 && duration >= 3 * 60 && duration <= 5 * 60 + 30;
    const shortDay = duration >= 3 * 60 && duration < 5 * 60 + 30;
    if (morningHalf || afternoonHalf || shortDay) return 'half';
  }
  const lateMin = parseHmToMinutes(lateThreshold || '09:15');
  if (inM > lateMin) return 'late';
  return 'present';
}

function lateMinutesAfterThreshold(checkIn: string | null | undefined, threshold: string): number {
  if (!checkIn) return 0;
  const inM = parseHmToMinutes(checkIn);
  const th = parseHmToMinutes(threshold || '09:15');
  return Math.max(0, inM - th);
}

export function computeDayMetrics(
  checkIn: string | null | undefined,
  checkOut: string | null | undefined,
  status: string,
  rules: {
    late_threshold?: string;
    early_threshold?: string;
    overtime_after_hours?: number;
    workday_hours?: number;
  },
) {
  const inM = timeToMinutes(checkIn);
  const outM = timeToMinutes(checkOut);
  const workedMinutes = inM != null && outM != null && outM > inM ? outM - inM : 0;
  const worked_hours = round2(workedMinutes / 60);
  const otThreshold = Number(rules.overtime_after_hours ?? rules.workday_hours ?? 8);
  const overtime_hours = worked_hours > otThreshold ? round2(worked_hours - otThreshold) : 0;
  const lateTh = rules.late_threshold || '09:15';
  const earlyTh = rules.early_threshold || '18:00';
  const late_minutes =
    status === 'absent' || status === 'excused' ? 0 : lateMinutesAfterThreshold(checkIn, lateTh);
  const is_late = status === 'late' || late_minutes > 0;
  const earlyThMin = parseHmToMinutes(earlyTh);
  const early_minutes =
    outM != null && status !== 'absent' && status !== 'excused' && outM < earlyThMin
      ? Math.max(0, earlyThMin - outM)
      : 0;
  const is_early_leave = early_minutes > 0;

  return {
    worked_hours,
    overtime_hours,
    is_late,
    late_minutes,
    is_early_leave,
    early_minutes,
  };
}

function disciplineHint(lateCount: number, rules: { warn_late_count?: number; blame_late_count?: number }): string | null {
  const blame = Number(rules.blame_late_count ?? 6);
  const warn = Number(rules.warn_late_count ?? 3);
  if (lateCount >= blame) return 'blame';
  if (lateCount >= warn) return 'avertissement';
  return null;
}

function attendancePayWeight(status: string): number {
  switch (String(status || '').toLowerCase()) {
    case 'present':
    case 'late':
    case 'excused':
      return 1;
    case 'half':
      return 0.5;
    case 'absent':
    default:
      return 0;
  }
}

function normalizeSource(raw: unknown, fallback: 'manual' | 'mobile' | 'badge' = 'manual'): 'manual' | 'mobile' | 'badge' {
  const s = String(raw || '').toLowerCase().trim();
  if (s === 'mobile' || s === 'badge' || s === 'manual') return s;
  return fallback;
}

function monthRange(month: string): { from: string; to: string; month: string } {
  const m = /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
  const [y, mm] = m.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, mm, 0)).getUTCDate();
  return {
    month: m,
    from: `${m}-01`,
    to: `${m}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function registerAttendanceRoutes(app: Hono<any>, deps: AttendanceRouteDeps): void {
  const {
    requireEmployeeAdmin,
    ensureHrSettings,
    ensureEmployeeTeamColumn,
    loadAttendanceRules,
    addColumnIfMissing,
    reportShell,
    moroccoTodayStr,
  } = deps;

  async function ensureAttendanceSchema(db: D1Database) {
    if (attDbs.has(db as unknown as object)) return;
    await db.prepare(`CREATE TABLE IF NOT EXISTS employee_attendance (
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
    )`).run();
    await addColumnIfMissing(db, 'employee_attendance', 'status', `TEXT DEFAULT ''`);
    await addColumnIfMissing(db, 'employee_attendance', 'source', `TEXT DEFAULT 'manual'`);
    await addColumnIfMissing(db, 'employee_attendance', 'updated_at', `TEXT`);
    await addColumnIfMissing(db, 'employee_attendance', 'created_at', `TEXT`);
    try { await addColumnIfMissing(db, 'employees', 'badge_code', `TEXT DEFAULT ''`); } catch { /* */ }
    try { await db.prepare(`CREATE INDEX IF NOT EXISTS idx_att_date ON employee_attendance(work_date)`).run(); } catch { /* */ }
    try { await db.prepare(`CREATE INDEX IF NOT EXISTS idx_att_emp ON employee_attendance(employee_id)`).run(); } catch { /* */ }
    attDbs.add(db as unknown as object);
  }

  async function requireAttendanceEnabled(c: any): Promise<Response | null> {
    try {
      await ensureHrSettings(c.env.DB);
      const s = await c.env.DB.prepare(`SELECT attendance_enabled FROM company_settings WHERE id = 1`).first() as any;
      if (Number(s?.attendance_enabled) !== 1) {
        return c.json({
          success: false,
          error: 'Module présence désactivé',
          code: 'ATTENDANCE_DISABLED',
        }, 403);
      }
    } catch {
      return c.json({ success: false, error: 'Module présence indisponible', code: 'ATTENDANCE_DISABLED' }, 403);
    }
    return null;
  }

  app.get('/api/attendance', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    { const off = await requireAttendanceEnabled(c); if (off) return off; }

    await ensureAttendanceSchema(c.env.DB);
    try { await ensureEmployeeTeamColumn(c.env.DB); } catch { /* */ }
    const attRules = await loadAttendanceRules(c.env.DB);
    const date = String(c.req.query('date') || moroccoTodayStr()).slice(0, 10);
    let employees: { results?: any[] };
    try {
      employees = await c.env.DB.prepare(
        `SELECT id, emp_number, badge_code, first_name, last_name, name, role_title, team, COALESCE(active,1) as active,
                pay_amount, pay_cycle_type, pay_cycle_days, last_paid_at, joined_date, returned_at
         FROM employees WHERE COALESCE(active,1)=1 ORDER BY last_name, first_name, id`,
      ).all();
    } catch {
      employees = await c.env.DB.prepare(
        `SELECT id, emp_number, first_name, last_name, name, role_title, COALESCE(active,1) as active,
                pay_amount, pay_cycle_type, pay_cycle_days, last_paid_at, joined_date
         FROM employees WHERE COALESCE(active,1)=1 ORDER BY last_name, first_name, id`,
      ).all();
    }
    const att = await c.env.DB.prepare(
      `SELECT * FROM employee_attendance WHERE work_date = ?`,
    ).bind(date).all();
    const byEmp = new Map<number, any>();
    for (const r of (att.results || []) as any[]) byEmp.set(Number(r.employee_id), r);

    const cycleStartFor = (e: any): string => {
      const last = e.last_paid_at ? String(e.last_paid_at).slice(0, 10) : '';
      const ret = e.returned_at ? String(e.returned_at).slice(0, 10) : '';
      const joined = e.joined_date ? String(e.joined_date).slice(0, 10) : '';
      if (last && /^\d{4}-\d{2}-\d{2}$/.test(last) && (!ret || last >= ret)) {
        const d = new Date(last + 'T12:00:00Z');
        d.setUTCDate(d.getUTCDate() + 1);
        return d.toISOString().slice(0, 10);
      }
      if (ret && /^\d{4}-\d{2}-\d{2}$/.test(ret)) return ret;
      if (joined && /^\d{4}-\d{2}-\d{2}$/.test(joined)) return joined;
      return date.slice(0, 8) + '01';
    };
    let earliest = date;
    for (const e of (employees.results || []) as any[]) {
      const cs = cycleStartFor(e);
      if (cs < earliest) earliest = cs;
    }
    const ratesRaw = await c.env.DB.prepare(
      `SELECT employee_id, work_date, status, check_in, check_out, source FROM employee_attendance
       WHERE work_date >= ? AND work_date <= ?`,
    ).bind(earliest, date).all();
    const rateMap = new Map<number, { days: number; weight: number; present: number; absent: number; late: number; from: string }>();
    const byEmpAtt = new Map<number, any[]>();
    for (const r of (ratesRaw.results || []) as any[]) {
      const id = Number(r.employee_id);
      if (!byEmpAtt.has(id)) byEmpAtt.set(id, []);
      byEmpAtt.get(id)!.push(r);
    }
    for (const e of (employees.results || []) as any[]) {
      const id = Number(e.id);
      const from = cycleStartFor(e);
      const cur = { days: 0, weight: 0, present: 0, absent: 0, late: 0, from };
      for (const r of byEmpAtt.get(id) || []) {
        if (String(r.work_date).slice(0, 10) < from) continue;
        const st = deriveAttendanceStatus(
          r.check_in,
          r.check_out,
          ['absent', 'excused'].includes(String(r.status || '').toLowerCase()) ? r.status : null,
          attRules.late_threshold,
        );
        cur.days += 1;
        cur.weight += attendancePayWeight(st);
        if (st === 'absent') cur.absent += 1;
        else if (st === 'late') cur.late += 1;
        else if (st === 'present' || st === 'half' || st === 'excused') cur.present += 1;
      }
      rateMap.set(id, cur);
    }

    const rows = ((employees.results || []) as any[]).map((e) => {
      const a = byEmp.get(Number(e.id));
      const status = deriveAttendanceStatus(
        a?.check_in || null,
        a?.check_out || null,
        ['absent', 'excused'].includes(String(a?.status || '').toLowerCase()) ? a?.status : null,
        attRules.late_threshold,
      );
      const dayMetrics = computeDayMetrics(a?.check_in || null, a?.check_out || null, status, attRules);
      const rate = rateMap.get(Number(e.id));
      const ratePct = rate && rate.days > 0 ? Math.round((rate.weight / rate.days) * 1000) / 10 : null;
      const payAmt = Number(e.pay_amount || 0);
      const cycle = e.pay_cycle_type === 'days' ? Math.max(1, Number(e.pay_cycle_days || 7)) : 30;
      const today = date;
      const periodFrom = rate?.from || cycleStartFor(e);
      const daily = cycle > 0 ? payAmt / cycle : 0;
      const worked = rate?.weight || 0;
      let suggested = 0;
      if (payAmt > 0 && cycle > 0) {
        if (attRules.pay_mode === 'calendar') {
          const elapsed = Math.max(0, Math.round(
            (new Date(today + 'T12:00:00Z').getTime() - new Date(periodFrom + 'T12:00:00Z').getTime()) / 86400000,
          )) + 1;
          suggested = round2(payAmt * (Math.min(elapsed, cycle * 12) / cycle));
        } else {
          suggested = round2(Math.min(worked, cycle * 12) * daily);
        }
      }
      let minuteDeduction = 0;
      let lateMinutesTotal = 0;
      if (attRules.minute_deduct && attRules.enabled && daily > 0) {
        const dayRows = byEmpAtt.get(Number(e.id)) || [];
        for (const r of dayRows) {
          if (String(r.work_date).slice(0, 10) < periodFrom) continue;
          const st = deriveAttendanceStatus(
            r.check_in,
            r.check_out,
            ['absent', 'excused'].includes(String(r.status || '').toLowerCase()) ? r.status : null,
            attRules.late_threshold,
          );
          if (st === 'late' || st === 'present') {
            lateMinutesTotal += lateMinutesAfterThreshold(r.check_in, attRules.late_threshold);
          }
        }
        const dayMins = Math.max(60, attRules.workday_hours * 60);
        minuteDeduction = round2((lateMinutesTotal / dayMins) * daily);
        suggested = Math.max(0, round2(suggested - minuteDeduction));
      }
      const lateDays = rate?.late || 0;
      const logged = rate?.days || 0;
      const disc = disciplineHint(lateDays, attRules);
      const pen = { deduction: minuteDeduction, late_pct: logged > 0 ? lateDays / logged : 0, penalty_units: 0 };
      return {
        employee_id: e.id,
        emp_number: e.emp_number,
        badge_code: e.badge_code || e.emp_number || '',
        name: [e.first_name, e.last_name].filter(Boolean).join(' ') || e.name || '—',
        role_title: e.role_title || '',
        team: e.team || '',
        pay_amount: payAmt,
        work_date: date,
        check_in: a?.check_in || null,
        check_out: a?.check_out || null,
        status,
        source: a?.source || 'manual',
        note: a?.note || '',
        attendance_id: a?.id || null,
        ...dayMetrics,
        month_rate_pct: ratePct,
        month_days_logged: rate?.days || 0,
        month_present: rate?.present || 0,
        month_absent: rate?.absent || 0,
        month_late: rate?.late || 0,
        suggested_pay: suggested,
        period_from: periodFrom,
        accrued_days: worked,
        worked_days: worked,
        late_pct: pen.late_pct,
        late_penalty: minuteDeduction,
        late_minutes: lateMinutesTotal,
        late_penalty_units: 0,
        cycle_from: rate?.from || periodFrom,
        discipline_hint: disc,
        cycle_late: lateDays,
      };
    });

    const summary = {
      present: rows.filter((r) => r.status === 'present' || r.status === 'late' || r.status === 'half').length,
      absent: rows.filter((r) => r.status === 'absent').length,
      late: rows.filter((r) => r.status === 'late').length,
      excused: rows.filter((r) => r.status === 'excused').length,
      total: rows.length,
    };

    return c.json({
      success: true,
      data: {
        date,
        rows,
        summary,
        period_note: 'cycle',
        rules: {
          late_threshold: attRules.late_threshold,
          early_threshold: attRules.early_threshold || '18:00',
          overtime_after_hours: attRules.overtime_after_hours ?? attRules.workday_hours ?? 8,
          overtime_multiplier: attRules.overtime_multiplier ?? 1.25,
          workday_hours: attRules.workday_hours,
        },
      },
    });
  });

  app.post('/api/attendance/check-in', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    { const off = await requireAttendanceEnabled(c); if (off) return off; }
    await ensureAttendanceSchema(c.env.DB);
    const rules = await loadAttendanceRules(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const employee_id = Number(body.employee_id || 0);
    if (!employee_id) return c.json({ success: false, error: 'Employé requis' }, 400);
    const date = String(body.date || moroccoTodayStr()).slice(0, 10);
    const time = String(body.time || moroccoNowTime()).slice(0, 8);
    const source = normalizeSource(body.source, 'manual');
    const status = deriveAttendanceStatus(time, null, null, rules.late_threshold);
    await c.env.DB.prepare(
      `INSERT INTO employee_attendance (employee_id, work_date, check_in, status, source, note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(employee_id, work_date) DO UPDATE SET
         check_in = excluded.check_in,
         status = excluded.status,
         source = excluded.source,
         note = COALESCE(excluded.note, employee_attendance.note),
         updated_at = datetime('now')`,
    ).bind(employee_id, date, time, status, source, String(body.note || '')).run();
    const metrics = computeDayMetrics(time, null, status, rules);
    return c.json({ success: true, data: { check_in: time, work_date: date, status, source, ...metrics } });
  });

  app.post('/api/attendance/check-out', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    { const off = await requireAttendanceEnabled(c); if (off) return off; }
    await ensureAttendanceSchema(c.env.DB);
    const rules = await loadAttendanceRules(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const employee_id = Number(body.employee_id || 0);
    if (!employee_id) return c.json({ success: false, error: 'Employé requis' }, 400);
    const date = String(body.date || moroccoTodayStr()).slice(0, 10);
    const time = String(body.time || moroccoNowTime()).slice(0, 8);
    const source = normalizeSource(body.source, 'manual');
    const existing = await c.env.DB.prepare(
      `SELECT id, check_in, status FROM employee_attendance WHERE employee_id = ? AND work_date = ?`,
    ).bind(employee_id, date).first() as any;
    const checkIn = existing?.check_in || time;
    const status = deriveAttendanceStatus(checkIn, time, null, rules.late_threshold);
    if (!existing) {
      await c.env.DB.prepare(
        `INSERT INTO employee_attendance (employee_id, work_date, check_in, check_out, status, source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
      ).bind(employee_id, date, checkIn, time, status, source).run();
    } else {
      await c.env.DB.prepare(
        `UPDATE employee_attendance SET check_out = ?, status = ?, source = ?, updated_at = datetime('now')
         WHERE employee_id = ? AND work_date = ?`,
      ).bind(time, status, source, employee_id, date).run();
    }
    const metrics = computeDayMetrics(checkIn, time, status, rules);
    return c.json({ success: true, data: { check_in: checkIn, check_out: time, work_date: date, status, source, ...metrics } });
  });

  /**
   * Badge check-in / check-out (typed or scanned badge code — no hardware dependency).
   * Matches employees.badge_code or employees.emp_number (case-insensitive).
   */
  app.post('/api/attendance/badge-check', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    { const off = await requireAttendanceEnabled(c); if (off) return off; }
    await ensureAttendanceSchema(c.env.DB);
    const rules = await loadAttendanceRules(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const badgeRaw = String(body.badge_code || body.code || '').trim();
    if (!badgeRaw) {
      return c.json({ success: false, error: 'Code badge requis', code: 'BADGE_REQUIRED' }, 400);
    }
    const emp = await c.env.DB.prepare(
      `SELECT id, emp_number, badge_code, first_name, last_name, name
       FROM employees
       WHERE COALESCE(active,1)=1
         AND (UPPER(TRIM(COALESCE(badge_code,''))) = UPPER(?) OR UPPER(TRIM(COALESCE(emp_number,''))) = UPPER(?))
       LIMIT 1`,
    ).bind(badgeRaw, badgeRaw).first() as any;
    if (!emp) {
      return c.json({ success: false, error: `Badge inconnu : ${badgeRaw}`, code: 'BADGE_NOT_FOUND' }, 404);
    }

    const date = String(body.date || moroccoTodayStr()).slice(0, 10);
    const time = String(body.time || moroccoNowTime()).slice(0, 8);
    const requestedAction = String(body.action || 'auto').toLowerCase();
    const existing = await c.env.DB.prepare(
      `SELECT id, check_in, check_out, status FROM employee_attendance WHERE employee_id = ? AND work_date = ?`,
    ).bind(emp.id, date).first() as any;

    let action: 'in' | 'out';
    if (requestedAction === 'in' || requestedAction === 'out') {
      action = requestedAction;
    } else if (!existing?.check_in) {
      action = 'in';
    } else if (!existing?.check_out) {
      action = 'out';
    } else {
      const name = [emp.first_name, emp.last_name].filter(Boolean).join(' ') || emp.name || '—';
      const st = deriveAttendanceStatus(existing.check_in, existing.check_out, existing.status, rules.late_threshold);
      const metrics = computeDayMetrics(existing.check_in, existing.check_out, st, rules);
      return c.json({
        success: true,
        data: {
          employee_id: Number(emp.id),
          emp_number: emp.emp_number,
          badge_code: emp.badge_code || emp.emp_number || badgeRaw,
          name,
          action: 'already_complete',
          already_checked_out: true,
          work_date: date,
          check_in: existing.check_in,
          check_out: existing.check_out,
          status: st,
          source: 'badge',
          ...metrics,
        },
      });
    }

    let checkIn = existing?.check_in || null;
    let checkOut = existing?.check_out || null;
    if (action === 'in') {
      checkIn = time;
    } else {
      checkIn = checkIn || time;
      checkOut = time;
    }
    const status = deriveAttendanceStatus(checkIn, checkOut, null, rules.late_threshold);
    await c.env.DB.prepare(
      `INSERT INTO employee_attendance (employee_id, work_date, check_in, check_out, status, source, note, updated_at)
       VALUES (?, ?, ?, ?, ?, 'badge', ?, datetime('now'))
       ON CONFLICT(employee_id, work_date) DO UPDATE SET
         check_in = excluded.check_in,
         check_out = excluded.check_out,
         status = excluded.status,
         source = 'badge',
         updated_at = datetime('now')`,
    ).bind(emp.id, date, checkIn, checkOut, status, String(body.note || `Pointage badge (${badgeRaw})`)).run();

    const name = [emp.first_name, emp.last_name].filter(Boolean).join(' ') || emp.name || '—';
    const metrics = computeDayMetrics(checkIn, checkOut, status, rules);
    return c.json({
      success: true,
      data: {
        employee_id: Number(emp.id),
        emp_number: emp.emp_number,
        badge_code: emp.badge_code || emp.emp_number || badgeRaw,
        name,
        action,
        work_date: date,
        check_in: checkIn,
        check_out: checkOut,
        status,
        source: 'badge',
        ...metrics,
      },
    });
  });

  app.put('/api/attendance', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    { const off = await requireAttendanceEnabled(c); if (off) return off; }

    await ensureAttendanceSchema(c.env.DB);
    const rules = await loadAttendanceRules(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const employee_id = Number(body.employee_id || 0);
    if (!employee_id) return c.json({ success: false, error: 'Employé requis' }, 400);
    const date = String(body.date || moroccoTodayStr()).slice(0, 10);
    const check_in = body.check_in != null ? String(body.check_in).slice(0, 8) : null;
    const check_out = body.check_out != null ? String(body.check_out).slice(0, 8) : null;
    const note = body.note != null ? String(body.note).slice(0, 500) : '';
    const source = normalizeSource(body.source, 'manual');
    const forced =
      body.force_status || ['absent', 'excused'].includes(String(body.status || '').toLowerCase())
        ? body.status
        : null;
    const status = deriveAttendanceStatus(check_in, check_out, forced, rules.late_threshold);
    await c.env.DB.prepare(
      `INSERT INTO employee_attendance (employee_id, work_date, check_in, check_out, status, source, note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(employee_id, work_date) DO UPDATE SET
         check_in = excluded.check_in,
         check_out = excluded.check_out,
         status = excluded.status,
         source = excluded.source,
         note = excluded.note,
         updated_at = datetime('now')`,
    ).bind(employee_id, date, check_in, check_out, status, source, note).run();
    const metrics = computeDayMetrics(check_in, check_out, status, rules);
    return c.json({ success: true, data: { employee_id, work_date: date, check_in, check_out, status, source, note, ...metrics } });
  });

  app.post('/api/attendance/mark-absent-missing', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    { const off = await requireAttendanceEnabled(c); if (off) return off; }
    await ensureAttendanceSchema(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const date = String(body.date || moroccoTodayStr()).slice(0, 10);
    const employees = await c.env.DB.prepare(
      `SELECT id FROM employees WHERE COALESCE(active,1)=1`,
    ).all();
    let n = 0;
    for (const e of (employees.results || []) as any[]) {
      const exists = await c.env.DB.prepare(
        `SELECT id FROM employee_attendance WHERE employee_id = ? AND work_date = ?`,
      ).bind(e.id, date).first();
      if (!exists) {
        await c.env.DB.prepare(
          `INSERT INTO employee_attendance (employee_id, work_date, status, source, note, updated_at)
           VALUES (?, ?, 'absent', 'manual', 'Marqué absent (auto)', datetime('now'))`,
        ).bind(e.id, date).run();
        n += 1;
      }
    }
    return c.json({ success: true, data: { marked: n, date } });
  });

  /**
   * Monthly recap per employee + filtered day-by-day entries (feeds Part 4 payroll).
   */
  app.get('/api/attendance/monthly', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    { const off = await requireAttendanceEnabled(c); if (off) return off; }
    await ensureAttendanceSchema(c.env.DB);
    try { await ensureEmployeeTeamColumn(c.env.DB); } catch { /* */ }

    const rules = await loadAttendanceRules(c.env.DB);
    const rawMonth = String(c.req.query('month') || moroccoTodayStr().slice(0, 7));
    const { month, from, to } = monthRange(rawMonth);
    const employeeFilter = Number(c.req.query('employee_id') || 0) || 0;

    let empSql = `SELECT id, emp_number, badge_code, first_name, last_name, name, role_title, team, pay_amount, pay_cycle_type, pay_cycle_days
                  FROM employees WHERE COALESCE(active,1)=1`;
    const empParams: any[] = [];
    if (employeeFilter) {
      empSql += ` AND id = ?`;
      empParams.push(employeeFilter);
    }
    empSql += ` ORDER BY last_name, first_name, id`;
    const empRes = await c.env.DB.prepare(empSql).bind(...empParams).all();
    const employees = (empRes.results || []) as any[];

    let attSql = `SELECT a.*, e.emp_number, e.first_name, e.last_name, e.name as emp_name, e.role_title, e.team
                  FROM employee_attendance a
                  LEFT JOIN employees e ON e.id = a.employee_id
                  WHERE a.work_date >= ? AND a.work_date <= ?`;
    const attParams: any[] = [from, to];
    if (employeeFilter) {
      attSql += ` AND a.employee_id = ?`;
      attParams.push(employeeFilter);
    }
    attSql += ` ORDER BY a.work_date DESC, e.last_name, e.first_name`;
    const attRes = await c.env.DB.prepare(attSql).bind(...attParams).all();

    const byEmp = new Map<number, any[]>();
    const entries: any[] = [];
    for (const r of (attRes.results || []) as any[]) {
      const empId = Number(r.employee_id);
      const st = deriveAttendanceStatus(
        r.check_in,
        r.check_out,
        ['absent', 'excused'].includes(String(r.status || '').toLowerCase()) ? r.status : null,
        rules.late_threshold,
      );
      const metrics = computeDayMetrics(r.check_in, r.check_out, st, rules);
      const item = {
        id: r.id,
        employee_id: empId,
        emp_number: r.emp_number || '',
        name: [r.first_name, r.last_name].filter(Boolean).join(' ') || r.emp_name || '—',
        role_title: r.role_title || '',
        team: r.team || '',
        work_date: r.work_date,
        check_in: r.check_in || null,
        check_out: r.check_out || null,
        status: st,
        source: r.source || 'manual',
        note: r.note || '',
        ...metrics,
      };
      entries.push(item);
      if (!byEmp.has(empId)) byEmp.set(empId, []);
      byEmp.get(empId)!.push(item);
    }

    const recap = employees.map((e) => {
      const list = byEmp.get(Number(e.id)) || [];
      let present_days = 0;
      let late_days = 0;
      let early_leave_days = 0;
      let absent_days = 0;
      let excused_days = 0;
      let half_days = 0;
      let worked_days = 0;
      let worked_hours = 0;
      let overtime_hours = 0;
      let late_minutes = 0;
      let early_minutes = 0;

      for (const d of list) {
        worked_days += attendancePayWeight(d.status);
        worked_hours = round2(worked_hours + d.worked_hours);
        overtime_hours = round2(overtime_hours + d.overtime_hours);
        late_minutes += d.late_minutes;
        early_minutes += d.early_minutes;
        if (d.is_early_leave) early_leave_days += 1;
        if (d.status === 'late') late_days += 1;
        else if (d.status === 'absent') absent_days += 1;
        else if (d.status === 'excused') excused_days += 1;
        else if (d.status === 'half') half_days += 1;
        else if (d.status === 'present') present_days += 1;
      }

      const name = [e.first_name, e.last_name].filter(Boolean).join(' ') || e.name || '—';
      return {
        employee_id: Number(e.id),
        emp_number: e.emp_number || '',
        badge_code: e.badge_code || e.emp_number || '',
        name,
        role_title: e.role_title || '',
        team: e.team || '',
        days_logged: list.length,
        present_days,
        late_days,
        early_leave_days,
        absent_days,
        excused_days,
        half_days,
        worked_days,
        worked_hours,
        overtime_hours,
        late_minutes,
        early_minutes,
        overtime_multiplier: rules.overtime_multiplier ?? 1.25,
      };
    });

    return c.json({
      success: true,
      data: {
        month,
        from,
        to,
        rules: {
          late_threshold: rules.late_threshold,
          early_threshold: rules.early_threshold || '18:00',
          overtime_after_hours: rules.overtime_after_hours ?? rules.workday_hours ?? 8,
          overtime_multiplier: rules.overtime_multiplier ?? 1.25,
          workday_hours: rules.workday_hours,
        },
        recap,
        entries,
      },
    });
  });

  app.get('/api/attendance/record/:employeeId', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    { const off = await requireAttendanceEnabled(c); if (off) return off; }

    await ensureAttendanceSchema(c.env.DB);
    try { await ensureEmployeeTeamColumn(c.env.DB); } catch { /* */ }
    const employeeId = Number(c.req.param('employeeId') || 0);
    if (!employeeId) return c.json({ success: false, error: 'Employé requis' }, 400);
    const scope = String(c.req.query('scope') || 'cycle').toLowerCase() === 'career' ? 'career' : 'cycle';
    const emp = await c.env.DB.prepare(
      `SELECT id, emp_number, badge_code, first_name, last_name, name, role_title, team,
              pay_amount, pay_cycle_type, pay_cycle_days, last_paid_at, joined_date, returned_at
       FROM employees WHERE id = ?`,
    ).bind(employeeId).first() as any;
    if (!emp) return c.json({ success: false, error: 'Employé introuvable' }, 404);

    const rules = await loadAttendanceRules(c.env.DB);
    const today = moroccoTodayStr();
    const cycle = emp.pay_cycle_type === 'days' ? Math.max(1, Number(emp.pay_cycle_days || 7)) : 30;
    const last = emp.last_paid_at ? String(emp.last_paid_at).slice(0, 10) : '';
    const joined = emp.joined_date ? String(emp.joined_date).slice(0, 10) : '';
    const ret = emp.returned_at ? String(emp.returned_at).slice(0, 10) : '';

    let from: string;
    if (scope === 'career') {
      from = joined || '2000-01-01';
    } else if (last && /^\d{4}-\d{2}-\d{2}$/.test(last)) {
      const d = new Date(last + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + 1);
      from = d.toISOString().slice(0, 10);
    } else if (ret && /^\d{4}-\d{2}-\d{2}$/.test(ret)) {
      from = ret;
    } else {
      from = joined || today;
    }

    const { results } = await c.env.DB.prepare(
      `SELECT work_date, check_in, check_out, status, source, note
       FROM employee_attendance
       WHERE employee_id = ? AND work_date >= ? AND work_date <= ?
       ORDER BY work_date DESC`,
    ).bind(employeeId, from, today).all();

    const days = ((results || []) as any[]).map((r) => {
      const st = deriveAttendanceStatus(
        r.check_in,
        r.check_out,
        ['absent', 'excused'].includes(String(r.status || '').toLowerCase()) ? r.status : null,
        rules.late_threshold,
      );
      const metrics = computeDayMetrics(r.check_in, r.check_out, st, rules);
      return {
        work_date: r.work_date,
        check_in: r.check_in,
        check_out: r.check_out,
        status: st,
        source: r.source || 'manual',
        note: r.note || '',
        ...metrics,
      };
    });

    let present = 0, late = 0, absent = 0, half = 0, excused = 0, early_leave = 0;
    let worked_hours = 0, overtime_hours = 0;
    for (const d of days) {
      worked_hours = round2(worked_hours + d.worked_hours);
      overtime_hours = round2(overtime_hours + d.overtime_hours);
      if (d.is_early_leave) early_leave += 1;
      if (d.status === 'late') late += 1;
      else if (d.status === 'absent') absent += 1;
      else if (d.status === 'half') half += 1;
      else if (d.status === 'excused') excused += 1;
      else if (d.status === 'present') present += 1;
    }
    const logged = days.length;
    const weight = present + late + excused + half * 0.5;
    const rate_pct = logged > 0 ? Math.round((weight / logged) * 1000) / 10 : 0;
    const payAmt = Number(emp.pay_amount || 0);
    const daily = cycle > 0 ? payAmt / cycle : 0;
    const disc = disciplineHint(late, rules);
    let lateMinutesTotal = 0;
    for (const d of days) {
      if (d.status === 'late' || d.status === 'present') {
        lateMinutesTotal += lateMinutesAfterThreshold(d.check_in, rules.late_threshold);
      }
    }
    const dayMins = Math.max(60, rules.workday_hours * 60);
    const minuteDeduction = rules.minute_deduct && daily > 0
      ? round2((lateMinutesTotal / dayMins) * daily)
      : 0;
    const presencePay = round2(Math.min(weight, cycle * 12) * daily);
    const netSuggested = Math.max(0, round2(presencePay - minuteDeduction));
    const name = [emp.first_name, emp.last_name].filter(Boolean).join(' ') || emp.name || '—';

    return c.json({
      success: true,
      data: {
        employee: {
          id: emp.id, emp_number: emp.emp_number, badge_code: emp.badge_code || emp.emp_number || '', name,
          role_title: emp.role_title, team: emp.team, pay_amount: payAmt, cycle_days: cycle,
        },
        scope, from, to: today,
        rules: {
          late_threshold: rules.late_threshold,
          early_threshold: rules.early_threshold || '18:00',
          overtime_after_hours: rules.overtime_after_hours ?? rules.workday_hours ?? 8,
          overtime_multiplier: rules.overtime_multiplier ?? 1.25,
          pay_mode: rules.pay_mode,
          minute_deduct: rules.minute_deduct,
          warn_late_count: rules.warn_late_count,
          blame_late_count: rules.blame_late_count,
          workday_hours: rules.workday_hours,
        },
        summary: {
          logged, present, late, half, excused, absent, early_leave, rate_pct,
          worked_hours, overtime_hours,
          late_pct: logged > 0 ? Math.round((late / logged) * 1000) / 10 : 0,
          worked_days: weight, late_minutes: lateMinutesTotal, late_penalty: minuteDeduction,
          daily_rate: round2(daily), net_suggested: netSuggested, discipline_hint: disc,
        },
        days,
      },
    });
  });

  app.get('/api/attendance/weekly', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    { const off = await requireAttendanceEnabled(c); if (off) return off; }

    await ensureAttendanceSchema(c.env.DB);
    try { await ensureEmployeeTeamColumn(c.env.DB); } catch { /* */ }
    const rules = await loadAttendanceRules(c.env.DB);
    const end = String(c.req.query('end') || moroccoTodayStr()).slice(0, 10);
    const daysN = Math.min(31, Math.max(7, Number(c.req.query('days') || 7)));
    const employeeId = Number(c.req.query('employee_id') || 0) || 0;
    const endD = new Date(end + 'T12:00:00Z');
    const days: { date: string; present: number; late: number; absent: number; total: number }[] = [];
    for (let i = daysN - 1; i >= 0; i--) {
      const d = new Date(endD);
      d.setUTCDate(d.getUTCDate() - i);
      const ds = d.toISOString().slice(0, 10);
      const att = employeeId
        ? await c.env.DB.prepare(`SELECT status, check_in, check_out FROM employee_attendance WHERE work_date = ? AND employee_id = ?`).bind(ds, employeeId).all()
        : await c.env.DB.prepare(`SELECT status, check_in, check_out FROM employee_attendance WHERE work_date = ?`).bind(ds).all();
      let present = 0, late = 0, absent = 0;
      for (const r of (att.results || []) as any[]) {
        const st = deriveAttendanceStatus(
          r.check_in,
          r.check_out,
          ['absent', 'excused'].includes(String(r.status || '').toLowerCase()) ? r.status : null,
          rules.late_threshold,
        );
        if (st === 'late') late += 1;
        else if (st === 'absent') absent += 1;
        else if (st === 'present' || st === 'half' || st === 'excused') present += 1;
      }
      let total = 1;
      if (!employeeId) {
        const empCount = await c.env.DB.prepare(
          `SELECT COUNT(*) as n FROM employees WHERE COALESCE(active,1)=1`,
        ).first() as any;
        total = Number(empCount?.n || 0);
      }
      days.push({ date: ds, present, late, absent, total });
    }
    return c.json({ success: true, data: { days, employee_id: employeeId || null } });
  });

  app.get('/api/attendance/export', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    { const off = await requireAttendanceEnabled(c); if (off) return off; }

    await ensureAttendanceSchema(c.env.DB);
    const rules = await loadAttendanceRules(c.env.DB);
    const monthParam = String(c.req.query('month') || '').trim();
    const range = monthParam && /^\d{4}-\d{2}$/.test(monthParam)
      ? monthRange(monthParam)
      : {
          from: String(c.req.query('from') || moroccoTodayStr().slice(0, 8) + '01').slice(0, 10),
          to: String(c.req.query('to') || moroccoTodayStr()).slice(0, 10),
        };
    const employeeId = Number(c.req.query('employee_id') || 0) || 0;
    const format = String(c.req.query('format') || 'csv').toLowerCase();

    let sql = `SELECT a.work_date, a.check_in, a.check_out, a.status, a.source, a.note,
                      e.emp_number, e.first_name, e.last_name, e.name, e.role_title
               FROM employee_attendance a
               LEFT JOIN employees e ON e.id = a.employee_id
               WHERE a.work_date >= ? AND a.work_date <= ?`;
    const params: any[] = [range.from, range.to];
    if (employeeId) {
      sql += ` AND a.employee_id = ?`;
      params.push(employeeId);
    }
    sql += ` ORDER BY a.work_date DESC, e.last_name, e.first_name`;

    const { results } = await c.env.DB.prepare(sql).bind(...params).all();
    const rows = (results || []) as any[];
    if (format === 'csv') {
      const header = 'date,emp_number,name,status,check_in,check_out,worked_hours,overtime_hours,late,early_leave,source,note';
      const lines = rows.map((r) => {
        const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.name || '';
        const st = deriveAttendanceStatus(
          r.check_in,
          r.check_out,
          ['absent', 'excused'].includes(String(r.status || '').toLowerCase()) ? r.status : null,
          rules.late_threshold,
        );
        const m = computeDayMetrics(r.check_in, r.check_out, st, rules);
        const esc = (s: any) => `"${String(s ?? '').replace(/"/g, '""')}"`;
        return [
          r.work_date,
          r.emp_number,
          name,
          st,
          r.check_in || '',
          r.check_out || '',
          m.worked_hours,
          m.overtime_hours,
          m.is_late ? 'oui' : 'non',
          m.is_early_leave ? 'oui' : 'non',
          r.source || 'manual',
          r.note || '',
        ].map(esc).join(',');
      });
      const body = [header, ...lines].join('\n');
      return new Response(body, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="presence_${range.from}_${range.to}.csv"`,
        },
      });
    }
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const tr = rows.map((r) => {
      const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.name || '—';
      const st = deriveAttendanceStatus(
        r.check_in,
        r.check_out,
        ['absent', 'excused'].includes(String(r.status || '').toLowerCase()) ? r.status : null,
        rules.late_threshold,
      );
      const m = computeDayMetrics(r.check_in, r.check_out, st, rules);
      return `<tr><td>${r.work_date}</td><td>${r.emp_number || ''}</td><td>${name}</td><td>${st}</td><td>${r.check_in || '—'}</td><td>${r.check_out || '—'}</td><td>${m.worked_hours} h</td><td>${m.overtime_hours} h</td><td>${r.source || 'manual'}</td><td>${r.note || ''}</td></tr>`;
    }).join('');
    const body = `
    <p class="muted">Période ${range.from} → ${range.to} · ${rows.length} ligne(s)</p>
    <table>
      <thead><tr><th>Date</th><th>N°</th><th>Nom</th><th>Statut</th><th>Entrée</th><th>Sortie</th><th>Heures</th><th>H. sup.</th><th>Source</th><th>Note</th></tr></thead>
      <tbody>${tr || '<tr><td colspan="10">Aucune donnée</td></tr>'}</tbody>
    </table>`;
    return c.html(reportShell('Rapport présence', settings?.company_name || 'Atlas Commerce', `${range.from} → ${range.to}`, body, settings?.report_footer));
  });

  app.post('/api/attendance/self-check', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    { const off = await requireAttendanceEnabled(c); if (off) return off; }

    await ensureAttendanceSchema(c.env.DB);
    const rules = await loadAttendanceRules(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const employee_id = Number(body.employee_id || 0);
    const action = String(body.action || 'in');
    const source = normalizeSource(body.source, 'mobile');
    if (!employee_id) return c.json({ success: false, error: 'Employé requis' }, 400);
    const date = moroccoTodayStr();
    const time = moroccoNowTime();
    if (action === 'out') {
      const existing = await c.env.DB.prepare(
        `SELECT check_in, status FROM employee_attendance WHERE employee_id = ? AND work_date = ?`,
      ).bind(employee_id, date).first() as any;
      const checkIn = existing?.check_in || time;
      const status = deriveAttendanceStatus(checkIn, time, existing?.status, rules.late_threshold);
      await c.env.DB.prepare(
        `INSERT INTO employee_attendance (employee_id, work_date, check_in, check_out, status, source, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(employee_id, work_date) DO UPDATE SET
           check_out = excluded.check_out, status = excluded.status, source = excluded.source, updated_at = datetime('now')`,
      ).bind(employee_id, date, checkIn, time, status, source).run();
      const metrics = computeDayMetrics(checkIn, time, status, rules);
      return c.json({ success: true, data: { action: 'out', check_in: checkIn, check_out: time, date, status, source, ...metrics } });
    }
    const status = deriveAttendanceStatus(time, null, null, rules.late_threshold);
    await c.env.DB.prepare(
      `INSERT INTO employee_attendance (employee_id, work_date, check_in, status, source, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(employee_id, work_date) DO UPDATE SET
         check_in = COALESCE(employee_attendance.check_in, excluded.check_in),
         status = excluded.status, source = excluded.source, updated_at = datetime('now')`,
    ).bind(employee_id, date, time, status, source).run();
    const metrics = computeDayMetrics(time, null, status, rules);
    return c.json({ success: true, data: { action: 'in', check_in: time, date, status, source, ...metrics } });
  });
}
