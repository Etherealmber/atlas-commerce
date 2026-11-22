import type { Hono } from 'hono';

export interface AttendanceRouteDeps {
  requireEmployeeAdmin: (c: any) => Promise<Response | null>;
  ensureHrSettings: (db: D1Database) => Promise<void>;
  ensureEmployeeTeamColumn: (db: D1Database) => Promise<void>;
  loadAttendanceRules: (db: D1Database) => Promise<{
    enabled: boolean;
    late_threshold: string;
    pay_mode: string;
    minute_deduct: boolean;
    warn_late_count: number;
    blame_late_count: number;
    workday_hours: number;
  }>;
  schemaOnce: (key: string, fn: () => Promise<void>) => Promise<void>;
  addColumnIfMissing: (db: D1Database, table: string, col: string, def: string) => Promise<void>;
  reportShell: (title: string, company: string, period: string, body: string, footer?: string, backUrl?: string) => string;
  moroccoTodayStr: () => string;
}

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

function deriveAttendanceStatus(checkIn: string | null, checkOut: string | null, forced?: string | null): string {
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
  if (inM > 9 * 60 + 15) return 'late';
  return 'present';
}

function parseHmToMinutes(hm: string): number {
  const m = String(hm || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

function lateMinutesAfterThreshold(checkIn: string | null | undefined, threshold: string): number {
  if (!checkIn) return 0;
  const inM = parseHmToMinutes(checkIn);
  const th = parseHmToMinutes(threshold || '09:15');
  return Math.max(0, inM - th);
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

export function registerAttendanceRoutes(app: Hono<any>, deps: AttendanceRouteDeps): void {
  const {
    requireEmployeeAdmin,
    ensureHrSettings,
    ensureEmployeeTeamColumn,
    loadAttendanceRules,
    schemaOnce,
    addColumnIfMissing,
    reportShell,
    moroccoTodayStr,
  } = deps;

  async function ensureAttendanceSchema(db: D1Database) {
    await schemaOnce('attendance', async () => {
      await db.prepare(`CREATE TABLE IF NOT EXISTS employee_attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        work_date TEXT NOT NULL,
        check_in TEXT,
        check_out TEXT,
        status TEXT DEFAULT '',
        note TEXT DEFAULT '',
        created_at TEXT,
        updated_at TEXT,
        UNIQUE(employee_id, work_date)
      )`).run();
      await addColumnIfMissing(db, 'employee_attendance', 'status', `TEXT DEFAULT ''`);
      await addColumnIfMissing(db, 'employee_attendance', 'updated_at', `TEXT`);
      await addColumnIfMissing(db, 'employee_attendance', 'created_at', `TEXT`);
      try { await db.prepare(`CREATE INDEX IF NOT EXISTS idx_att_date ON employee_attendance(work_date)`).run(); } catch { /* */ }
      try { await db.prepare(`CREATE INDEX IF NOT EXISTS idx_att_emp ON employee_attendance(employee_id)`).run(); } catch { /* */ }
    });
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
        `SELECT id, emp_number, first_name, last_name, name, role_title, team, COALESCE(active,1) as active,
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
      `SELECT employee_id, work_date, status, check_in, check_out FROM employee_attendance
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
      const status = deriveAttendanceStatus(a?.check_in || null, a?.check_out || null, ['absent', 'excused'].includes(String(a?.status || '').toLowerCase()) ? a?.status : null);
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
          suggested = Math.round(payAmt * (Math.min(elapsed, cycle * 12) / cycle) * 100) / 100;
        } else {
          suggested = Math.round(Math.min(worked, cycle * 12) * daily * 100) / 100;
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
          );
          if (st === 'late' || st === 'present') {
            lateMinutesTotal += lateMinutesAfterThreshold(r.check_in, attRules.late_threshold);
          }
        }
        const dayMins = Math.max(60, attRules.workday_hours * 60);
        minuteDeduction = Math.round((lateMinutesTotal / dayMins) * daily * 100) / 100;
        suggested = Math.max(0, Math.round((suggested - minuteDeduction) * 100) / 100);
      }
      const lateDays = rate?.late || 0;
      const logged = rate?.days || 0;
      const disc = disciplineHint(lateDays, attRules);
      const pen = { deduction: minuteDeduction, late_pct: logged > 0 ? lateDays / logged : 0, penalty_units: 0 };
      return {
        employee_id: e.id,
        emp_number: e.emp_number,
        name: [e.first_name, e.last_name].filter(Boolean).join(' ') || e.name || '—',
        role_title: e.role_title || '',
        team: e.team || '',
        pay_amount: payAmt,
        work_date: date,
        check_in: a?.check_in || null,
        check_out: a?.check_out || null,
        status,
        note: a?.note || '',
        attendance_id: a?.id || null,
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

    return c.json({ success: true, data: { date, rows, summary, period_note: 'cycle' } });
  });

  app.post('/api/attendance/check-in', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    await ensureAttendanceSchema(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const employee_id = Number(body.employee_id || 0);
    if (!employee_id) return c.json({ success: false, error: 'Employé requis' }, 400);
    const date = String(body.date || moroccoTodayStr()).slice(0, 10);
    const time = String(body.time || moroccoNowTime()).slice(0, 8);
    const status = deriveAttendanceStatus(time, null, null);
    await c.env.DB.prepare(
      `INSERT INTO employee_attendance (employee_id, work_date, check_in, status, note, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(employee_id, work_date) DO UPDATE SET
         check_in = excluded.check_in,
         status = excluded.status,
         note = COALESCE(excluded.note, employee_attendance.note),
         updated_at = datetime('now')`,
    ).bind(employee_id, date, time, status, String(body.note || '')).run();
    return c.json({ success: true, data: { check_in: time, work_date: date, status } });
  });

  app.post('/api/attendance/check-out', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    await ensureAttendanceSchema(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const employee_id = Number(body.employee_id || 0);
    if (!employee_id) return c.json({ success: false, error: 'Employé requis' }, 400);
    const date = String(body.date || moroccoTodayStr()).slice(0, 10);
    const time = String(body.time || moroccoNowTime()).slice(0, 8);
    const existing = await c.env.DB.prepare(
      `SELECT id, check_in, status FROM employee_attendance WHERE employee_id = ? AND work_date = ?`,
    ).bind(employee_id, date).first() as any;
    const checkIn = existing?.check_in || time;
    const status = deriveAttendanceStatus(checkIn, time, null);
    if (!existing) {
      await c.env.DB.prepare(
        `INSERT INTO employee_attendance (employee_id, work_date, check_in, check_out, status, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      ).bind(employee_id, date, checkIn, time, status).run();
    } else {
      await c.env.DB.prepare(
        `UPDATE employee_attendance SET check_out = ?, status = ?, updated_at = datetime('now')
         WHERE employee_id = ? AND work_date = ?`,
      ).bind(time, status, employee_id, date).run();
    }
    return c.json({ success: true, data: { check_out: time, work_date: date, status } });
  });

  app.put('/api/attendance', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    { const off = await requireAttendanceEnabled(c); if (off) return off; }

    await ensureAttendanceSchema(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const employee_id = Number(body.employee_id || 0);
    if (!employee_id) return c.json({ success: false, error: 'Employé requis' }, 400);
    const date = String(body.date || moroccoTodayStr()).slice(0, 10);
    const check_in = body.check_in != null ? String(body.check_in).slice(0, 8) : null;
    const check_out = body.check_out != null ? String(body.check_out).slice(0, 8) : null;
    const note = body.note != null ? String(body.note).slice(0, 500) : '';
    const forced =
      body.force_status || ['absent', 'excused'].includes(String(body.status || '').toLowerCase())
        ? body.status
        : null;
    const status = deriveAttendanceStatus(check_in, check_out, forced);
    await c.env.DB.prepare(
      `INSERT INTO employee_attendance (employee_id, work_date, check_in, check_out, status, note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(employee_id, work_date) DO UPDATE SET
         check_in = excluded.check_in,
         check_out = excluded.check_out,
         status = excluded.status,
         note = excluded.note,
         updated_at = datetime('now')`,
    ).bind(employee_id, date, check_in, check_out, status, note).run();
    return c.json({ success: true, data: { employee_id, work_date: date, check_in, check_out, status, note } });
  });

  app.post('/api/attendance/mark-absent-missing', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
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
          `INSERT INTO employee_attendance (employee_id, work_date, status, note, updated_at)
           VALUES (?, ?, 'absent', 'Marqué absent (auto)', datetime('now'))`,
        ).bind(e.id, date).run();
        n += 1;
      }
    }
    return c.json({ success: true, data: { marked: n, date } });
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
      `SELECT id, emp_number, first_name, last_name, name, role_title, team,
              pay_amount, pay_cycle_type, pay_cycle_days, last_paid_at, joined_date, returned_at
       FROM employees WHERE id = ?`,
    ).bind(employeeId).first() as any;
    if (!emp) return c.json({ success: false, error: 'Employé introuvable' }, 404);

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
      `SELECT work_date, check_in, check_out, status, note
       FROM employee_attendance
       WHERE employee_id = ? AND work_date >= ? AND work_date <= ?
       ORDER BY work_date DESC`,
    ).bind(employeeId, from, today).all();

    const days = ((results || []) as any[]).map((r) => {
      const st = deriveAttendanceStatus(
        r.check_in,
        r.check_out,
        ['absent', 'excused'].includes(String(r.status || '').toLowerCase()) ? r.status : null,
      );
      return {
        work_date: r.work_date,
        check_in: r.check_in,
        check_out: r.check_out,
        status: st,
        note: r.note || '',
      };
    });

    let present = 0, late = 0, absent = 0, half = 0, excused = 0;
    for (const d of days) {
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
    const rules = await loadAttendanceRules(c.env.DB);
    const disc = disciplineHint(late, rules);
    let lateMinutesTotal = 0;
    for (const d of days) {
      if (d.status === 'late' || d.status === 'present') {
        lateMinutesTotal += lateMinutesAfterThreshold(d.check_in, rules.late_threshold);
      }
    }
    const dayMins = Math.max(60, rules.workday_hours * 60);
    const minuteDeduction = rules.minute_deduct && daily > 0
      ? Math.round((lateMinutesTotal / dayMins) * daily * 100) / 100
      : 0;
    const presencePay = Math.round(Math.min(weight, cycle * 12) * daily * 100) / 100;
    const netSuggested = Math.max(0, Math.round((presencePay - minuteDeduction) * 100) / 100);
    const name = [emp.first_name, emp.last_name].filter(Boolean).join(' ') || emp.name || '—';

    return c.json({
      success: true,
      data: {
        employee: {
          id: emp.id, emp_number: emp.emp_number, name,
          role_title: emp.role_title, team: emp.team, pay_amount: payAmt, cycle_days: cycle,
        },
        scope, from, to: today,
        rules: {
          late_threshold: rules.late_threshold,
          pay_mode: rules.pay_mode,
          minute_deduct: rules.minute_deduct,
          warn_late_count: rules.warn_late_count,
          blame_late_count: rules.blame_late_count,
          workday_hours: rules.workday_hours,
        },
        summary: {
          logged, present, late, half, excused, absent, rate_pct,
          late_pct: logged > 0 ? Math.round((late / logged) * 1000) / 10 : 0,
          worked_days: weight, late_minutes: lateMinutesTotal, late_penalty: minuteDeduction,
          daily_rate: Math.round(daily * 100) / 100, net_suggested: netSuggested, discipline_hint: disc,
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
    const from = String(c.req.query('from') || moroccoTodayStr().slice(0, 8) + '01').slice(0, 10);
    const to = String(c.req.query('to') || moroccoTodayStr()).slice(0, 10);
    const format = String(c.req.query('format') || 'csv').toLowerCase();
    const { results } = await c.env.DB.prepare(
      `SELECT a.work_date, a.check_in, a.check_out, a.status, a.note,
              e.emp_number, e.first_name, e.last_name, e.name, e.role_title
       FROM employee_attendance a
       LEFT JOIN employees e ON e.id = a.employee_id
       WHERE a.work_date >= ? AND a.work_date <= ?
       ORDER BY a.work_date DESC, e.last_name, e.first_name`,
    ).bind(from, to).all();
    const rows = (results || []) as any[];
    if (format === 'csv') {
      const header = 'date,emp_number,name,status,check_in,check_out,note';
      const lines = rows.map((r) => {
        const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.name || '';
        const st = deriveAttendanceStatus(r.check_in, r.check_out, ['absent', 'excused'].includes(String(r.status || '').toLowerCase()) ? r.status : null);
        const esc = (s: any) => `"${String(s ?? '').replace(/"/g, '""')}"`;
        return [r.work_date, r.emp_number, name, st, r.check_in, r.check_out, r.note].map(esc).join(',');
      });
      const body = [header, ...lines].join('\n');
      return new Response(body, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="presence_${from}_${to}.csv"`,
        },
      });
    }
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const tr = rows.map((r) => {
      const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.name || '—';
      const st = deriveAttendanceStatus(r.check_in, r.check_out, ['absent', 'excused'].includes(String(r.status || '').toLowerCase()) ? r.status : null);
      return `<tr><td>${r.work_date}</td><td>${r.emp_number || ''}</td><td>${name}</td><td>${st}</td><td>${r.check_in || '—'}</td><td>${r.check_out || '—'}</td><td>${r.note || ''}</td></tr>`;
    }).join('');
    const body = `
    <p class="muted">Période ${from} → ${to} · ${rows.length} ligne(s)</p>
    <table>
      <thead><tr><th>Date</th><th>N°</th><th>Nom</th><th>Statut</th><th>Entrée</th><th>Sortie</th><th>Note</th></tr></thead>
      <tbody>${tr || '<tr><td colspan="7">Aucune donnée</td></tr>'}</tbody>
    </table>`;
    return c.html(reportShell('Rapport présence', settings?.company_name || 'Atlas Commerce', `${from} → ${to}`, body, settings?.report_footer));
  });

  app.post('/api/attendance/self-check', async (c) => {
    { const denied = await requireEmployeeAdmin(c); if (denied) return denied; }
    { const off = await requireAttendanceEnabled(c); if (off) return off; }

    await ensureAttendanceSchema(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const employee_id = Number(body.employee_id || 0);
    const action = String(body.action || 'in');
    if (!employee_id) return c.json({ success: false, error: 'Employé requis' }, 400);
    const date = moroccoTodayStr();
    const time = moroccoNowTime();
    if (action === 'out') {
      const existing = await c.env.DB.prepare(
        `SELECT check_in, status FROM employee_attendance WHERE employee_id = ? AND work_date = ?`,
      ).bind(employee_id, date).first() as any;
      const checkIn = existing?.check_in || time;
      const status = deriveAttendanceStatus(checkIn, time, existing?.status);
      await c.env.DB.prepare(
        `INSERT INTO employee_attendance (employee_id, work_date, check_in, check_out, status, updated_at)
         VALUES (?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(employee_id, work_date) DO UPDATE SET
           check_out = excluded.check_out, status = excluded.status, updated_at = datetime('now')`,
      ).bind(employee_id, date, checkIn, time, status).run();
      return c.json({ success: true, data: { action: 'out', check_out: time, date, status } });
    }
    const status = deriveAttendanceStatus(time, null, null);
    await c.env.DB.prepare(
      `INSERT INTO employee_attendance (employee_id, work_date, check_in, status, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(employee_id, work_date) DO UPDATE SET
         check_in = COALESCE(employee_attendance.check_in, excluded.check_in),
         status = excluded.status, updated_at = datetime('now')`,
    ).bind(employee_id, date, time, status).run();
    return c.json({ success: true, data: { action: 'in', check_in: time, date, status } });
  });
}
