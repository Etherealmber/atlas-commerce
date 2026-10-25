import { afterBusinessMutation } from '../lib/delete-coord';
import { addColumnIfMissing } from '../lib/schema';
import type { AtlasApp } from './types';

const _empSchemaOnce = new Set<string>();

async function ensureEmployeeTables(db: D1Database): Promise<void> {
  if (_empSchemaOnce.has('employees')) return;
  _empSchemaOnce.add('employees');
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      emp_number TEXT DEFAULT '',
      name TEXT NOT NULL,
      first_name TEXT DEFAULT '',
      last_name TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      email TEXT DEFAULT '',
      role_title TEXT DEFAULT '',
      department TEXT DEFAULT '',
      category TEXT DEFAULT '',
      employment_status TEXT DEFAULT '',
      joined_date TEXT DEFAULT '',
      date_of_birth TEXT DEFAULT '',
      gender TEXT DEFAULT '',
      nationality TEXT DEFAULT '',
      marital_status TEXT DEFAULT '',
      national_id TEXT DEFAULT '',
      tax_id TEXT DEFAULT '',
      social_insurance TEXT DEFAULT '',
      health_insurance TEXT DEFAULT '',
      driving_license TEXT DEFAULT '',
      address TEXT DEFAULT '',
      city TEXT DEFAULT '',
      country TEXT DEFAULT '',
      postal_code TEXT DEFAULT '',
      home_phone TEXT DEFAULT '',
      work_phone TEXT DEFAULT '',
      id_doc_key TEXT DEFAULT '',
      id_doc_name TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      resigned_at TEXT DEFAULT NULL,
      pay_amount REAL DEFAULT 0,
      pay_cycle_type TEXT DEFAULT 'monthly',
      pay_cycle_days INTEGER DEFAULT 30,
      last_paid_at TEXT DEFAULT NULL,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    )
    .run();
  const cols = [
    ['emp_number', "TEXT DEFAULT ''"],
    ['first_name', "TEXT DEFAULT ''"],
    ['last_name', "TEXT DEFAULT ''"],
    ['department', "TEXT DEFAULT ''"],
    ['category', "TEXT DEFAULT ''"],
    ['employment_status', "TEXT DEFAULT ''"],
    ['joined_date', "TEXT DEFAULT ''"],
    ['date_of_birth', "TEXT DEFAULT ''"],
    ['gender', "TEXT DEFAULT ''"],
    ['nationality', "TEXT DEFAULT ''"],
    ['marital_status', "TEXT DEFAULT ''"],
    ['national_id', "TEXT DEFAULT ''"],
    ['tax_id', "TEXT DEFAULT ''"],
    ['social_insurance', "TEXT DEFAULT ''"],
    ['health_insurance', "TEXT DEFAULT ''"],
    ['driving_license', "TEXT DEFAULT ''"],
    ['address', "TEXT DEFAULT ''"],
    ['city', "TEXT DEFAULT ''"],
    ['country', "TEXT DEFAULT ''"],
    ['postal_code', "TEXT DEFAULT ''"],
    ['home_phone', "TEXT DEFAULT ''"],
    ['work_phone', "TEXT DEFAULT ''"],
    ['id_doc_key', "TEXT DEFAULT ''"],
    ['id_doc_name', "TEXT DEFAULT ''"],
    ['resigned_at', 'TEXT DEFAULT NULL'],
    ['immigration_status', "TEXT DEFAULT ''"],
    ['cnss_number', "TEXT DEFAULT ''"],
    ['rib', "TEXT DEFAULT ''"],
    ['job_description', "TEXT DEFAULT ''"],
    ['weekly_hours', "REAL DEFAULT 44"],
    ['trial_days', "INTEGER DEFAULT 90"],
    ['contract_type', "TEXT DEFAULT 'CDI'"],
    // v256 — link an employee file to a login account so GET /api/me/payroll
    // can expose ONLY that employee's own pay date to their own session.
    ['user_username', "TEXT DEFAULT ''"],
  ];
  for (const [col, typ] of cols) {
    await addColumnIfMissing(db, 'employees', col, typ);
  }
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS employee_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      paid_at TEXT NOT NULL,
      period_label TEXT DEFAULT '',
      note TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    )
    .run();
  await addColumnIfMissing(db, 'employees', 'returned_at', 'TEXT');
  _empSchemaOnce.add('employees');
}

async function backfillEmpNumbers(db: D1Database): Promise<void> {
  const { results } = await db
    .prepare(`SELECT id FROM employees WHERE emp_number IS NULL OR trim(emp_number) = '' ORDER BY id`)
    .all();
  for (const row of results || []) {
    const num = await nextEmpNumber(db);
    await db.prepare(`UPDATE employees SET emp_number = ? WHERE id = ?`).bind(num, (row as any).id).run();
  }
}

async function nextEmpNumber(db: D1Database, env?: any): Promise<string> {
  // Prefer Durable Object NumberHub for atomic EMP sequences
  try {
    if (env?.NUMBER_HUB) {
      const id = env.NUMBER_HUB.idFromName('doc-numbers');
      const stub = env.NUMBER_HUB.get(id);
      // seed from DB max once
      const { results: empRows } = await db
        .prepare(`SELECT emp_number FROM employees WHERE emp_number IS NOT NULL AND trim(emp_number) != ''`)
        .all();
      let floor = 1;
      for (const r of empRows || []) {
        const m = String((r as any).emp_number || '').match(/(\d+)\s*$/);
        if (m) floor = Math.max(floor, parseInt(m[1], 10) + 1);
      }
      const res = await stub.fetch('https://number-hub/next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ series: 'employee', floor }),
      });
      if (res.ok) {
        const j = (await res.json()) as any;
        const n = Number(j?.data?.next || 0);
        if (n > 0) {
          const st = await empNumberStyle(db);
          return `${st.prefix}${String(Math.max(n, st.floor)).padStart(st.pad, '0')}`;
        }
      }
    }
  } catch {
    /* fallback D1 */
  }
  return nextEmpNumberDb(db);
}

async function empNumberStyle(db: D1Database): Promise<{ prefix: string; pad: number; floor: number }> {
  let prefix = 'EMP-';
  let pad = 4;
  let floor = 1;
  try {
    const s = (await db
      .prepare(`SELECT employee_prefix, next_employee_number, numbering_pad FROM company_settings WHERE id = 1`)
      .first()) as any;
    if (s?.employee_prefix) prefix = String(s.employee_prefix).trim() || 'EMP-';
    pad = Math.min(8, Math.max(3, Number(s?.numbering_pad || 4)));
    floor = Math.max(1, Number(s?.next_employee_number || 1));
  } catch { /* columns may not exist yet */ }
  return { prefix, pad, floor };
}

async function nextEmpNumberDb(db: D1Database): Promise<string> {
  const { prefix, pad, floor } = await empNumberStyle(db);
  const like = prefix.replace(/%/g, '') + '%';
  const row = (await db
    .prepare(
      `SELECT emp_number FROM employees WHERE emp_number LIKE ? ORDER BY length(emp_number) DESC, emp_number DESC LIMIT 1`,
    )
    .bind(like)
    .first()) as any;
  let n = floor;
  if (row?.emp_number) {
    const tail = String(row.emp_number).slice(prefix.length);
    const m = tail.match(/^(\d+)/);
    if (m) n = Math.max(floor, Number(m[1]) + 1);
  }
  return `${prefix}${String(n).padStart(pad, '0')}`;
}

/** Calendar date YYYY-MM-DD in Africa/Casablanca (Morocco). */
function moroccoToday(): string {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Casablanca' });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function cycleDays(row: any): number {
  const t = String(row.pay_cycle_type || 'monthly');
  if (t === 'monthly') return 30;
  const d = Number(row.pay_cycle_days || 7);
  return Math.max(1, Math.min(365, d || 7));
}

/** Add calendar days to YYYY-MM-DD without UTC drift. */
function addDaysYmd(ymd: string, days: number): string {
  const m = String(ymd).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * First due = joined_date (start of work) + cycle.
 * After a payment = last_paid_at + cycle.
 * No joined_date and never paid → no due (not overdue).
 */
function nextDue(row: any): string | null {
  if (Number(row.active) === 0) return null;
  if (!(Number(row.pay_amount || 0) > 0)) return null;
  const days = cycleDays(row);
  const last = row.last_paid_at ? String(row.last_paid_at).slice(0, 10) : '';
  const joined = row.joined_date ? String(row.joined_date).slice(0, 10) : '';
  const anchor = last || joined;
  if (!anchor || !/^\d{4}-\d{2}-\d{2}$/.test(anchor)) return null;
  return addDaysYmd(anchor, days);
}


/** Shared with /api/nav-badges — same rules as enrich().pay_overdue */
export async function countEmployeesPayDue(db: D1Database): Promise<number> {
  try {
    const { results } = await db
      .prepare(
        `SELECT pay_amount, pay_cycle_type, pay_cycle_days, last_paid_at, joined_date, active
         FROM employees WHERE COALESCE(active,1)=1 AND COALESCE(pay_amount,0)>0.001`,
      )
      .all();
    const today = moroccoToday();
    let n = 0;
    for (const row of results || []) {
      const due = nextDue(row);
      if (due && due <= today) n++;
    }
    return n;
  } catch {
    return 0;
  }
}

function displayName(row: any): string {
  const fn = String(row.first_name || '').trim();
  const ln = String(row.last_name || '').trim();
  if (fn || ln) return `${fn} ${ln}`.trim();
  return String(row.name || '').trim() || '—';
}

async function persistHrExtras(db: D1Database, id: number, body: any) {
  try {
    await db.prepare(
      `UPDATE employees SET contract_type=?, trial_days=?, weekly_hours=?, job_description=?, rib=?, cnss_number=?, social_insurance=COALESCE(NULLIF(?,''), social_insurance) WHERE id=?`
    ).bind(
      String(body.contract_type || 'CDI'),
      Number(body.trial_days ?? 90),
      Number(body.weekly_hours ?? 44),
      String(body.job_description || ''),
      String(body.rib || ''),
      String(body.cnss_number || body.social_insurance || ''),
      String(body.cnss_number || body.social_insurance || ''),
      id,
    ).run();
  } catch { /* columns may lag */ }
}

/** Days between two YMD dates (inclusive of end, exclusive of start if start is a pay day). */
function daysBetweenYmd(from: string, to: string): number {
  const a = String(from).slice(0, 10);
  const b = String(to).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return 0;
  const d0 = Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)));
  const d1 = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10)));
  const diff = Math.floor((d1 - d0) / 86400000);
  return Math.max(0, diff);
}

/**
 * Accrued pay since last payment (or join) until today.
 * Resets when last_paid_at is updated after a payment.
 * Pro-rata: (days_elapsed / cycle_days) * pay_amount
 */
function periodAnchor(row: any): { from: string | null; elapsed: number; source: string } {
  const today = moroccoToday();
  const last = row.last_paid_at ? String(row.last_paid_at).slice(0, 10) : '';
  const returned = row.returned_at ? String(row.returned_at).slice(0, 10) : '';
  const joined = row.joined_date ? String(row.joined_date).slice(0, 10) : '';
  // Priority: last payment → return after dismiss → entry (joined)
  if (last && /^\d{4}-\d{2}-\d{2}$/.test(last)) {
    // If returned after last pay, period starts at return
    if (returned && /^\d{4}-\d{2}-\d{2}$/.test(returned) && returned > last) {
      return {
        from: returned,
        elapsed: daysBetweenYmd(returned, today) + 1,
        source: 'returned',
      };
    }
    return {
      from: addDaysYmd(last, 1),
      elapsed: daysBetweenYmd(last, today),
      source: 'last_paid',
    };
  }
  if (returned && /^\d{4}-\d{2}-\d{2}$/.test(returned)) {
    return {
      from: returned,
      elapsed: daysBetweenYmd(returned, today) + 1,
      source: 'returned',
    };
  }
  if (joined && /^\d{4}-\d{2}-\d{2}$/.test(joined)) {
    return {
      from: joined,
      elapsed: daysBetweenYmd(joined, today) + 1,
      source: 'joined',
    };
  }
  return { from: null, elapsed: 0, source: 'none' };
}

/**
 * Accrued pay since last payment, or return-after-dismiss, or entry date.
 * Resets on full payment (last_paid_at). Advances (acomptes) reduce suggested net.
 */
function accruedPay(row: any, asOf?: string, advances = 0): {
  suggested_pay: number;
  gross_accrued: number;
  advances: number;
  accrued_days: number;
  period_from: string | null;
  period_to: string;
  cycle_days: number;
  daily_rate: number;
  cycle_progress: number;
  can_advance: boolean;
  max_advance: number;
  period_source: string;
} {
  const today = asOf || moroccoToday();
  const cycle = cycleDays(row);
  const amount = Number(row.pay_amount || 0);
  const anchor = periodAnchor({ ...row });
  // recompute elapsed vs asOf
  let elapsed = anchor.elapsed;
  let periodFrom = anchor.from;
  if (periodFrom && asOf) {
    const last = row.last_paid_at ? String(row.last_paid_at).slice(0, 10) : '';
    if (anchor.source === 'last_paid' && last) {
      elapsed = daysBetweenYmd(last, today);
      periodFrom = addDaysYmd(last, 1);
    } else {
      elapsed = daysBetweenYmd(periodFrom, today) + (anchor.source === 'last_paid' ? 0 : 1);
      if (anchor.source === 'last_paid') elapsed = daysBetweenYmd(last, today);
    }
  }
  const daily = cycle > 0 ? amount / cycle : 0;
  const gross = Math.round(Math.min(elapsed, cycle * 24) * daily * 100) / 100;
  const adv = Math.max(0, Number(advances || 0));
  const net = Math.max(0, Math.round((gross - adv) * 100) / 100);
  const progress = cycle > 0 ? elapsed / cycle : 0;
  /**
   * Acompte caps from company settings (defaults: short≤14j → 5%; long → 5% @7j +5% @14j).
   */
  /**
   * Acompte (independent of presence module when presence off):
   * - cycle < 14j  → max shortMax% (default 5%) after ~1st week
   * - cycle = 14j  → 5% @7j + 5% @14j (max 10%), no week 3
   * - cycle > 14j (jours) → 5%@7 + 5%@14; week3 (@21) +5% only with note/proof (max 15%)
   * - mensuel (~30j) → 5/10/15% @7/14/21; week4 (@28) +5% with proof (max 20% with proof, 15% without)
   * Presence module ON + require flag: still only gates if you want (optional); default ignore for money rules.
   */
  const ar = (row as any).__acompte_rules || {};
  const w1 = Math.max(0, Number(ar.acompte_week1_pct ?? 5)) / 100;
  const w2 = Math.max(0, Number(ar.acompte_week2_pct ?? 5)) / 100;
  const w3 = Math.max(0, Number(ar.acompte_week3_pct ?? 5)) / 100;
  const w4 = Math.max(0, Number(ar.acompte_week4_pct ?? 5)) / 100;
  const shortMax = Math.max(0, Number(ar.acompte_short_max_pct ?? 5)) / 100;
  const monthlyMax = Math.max(0, Number(ar.acompte_monthly_max_pct ?? 15)) / 100;
  const isMonthly = String(row.pay_cycle_type || '') === 'monthly' || cycle >= 28;
  /**
   * Caps only (not presence). Week-1 % available from day 1 of the pay period.
   * Higher tiers unlock by calendar days in the cycle (14 / 21 / 28).
   */
  /**
   * Soft rule: 25% of cycle elapsed → meets requirement (UI disclaimer if not).
   * Hard cap: never more than 50% of cycle salary (acomptes cumulés inclus côté route).
   * Week tiers still shape the "recommended" cap under that 50% ceiling.
   */
  let maxPct = 0;
  let needs_proof = false;
  let tier = 'none';
  if (amount > 0) {
    if (cycle < 14) {
      maxPct = shortMax;
      tier = 'short';
    } else if (cycle === 14) {
      if (elapsed >= 14) { maxPct = w1 + w2; tier = 'w2'; }
      else if (elapsed >= 7) { maxPct = w1; tier = 'w1'; }
      else { maxPct = w1; tier = 'w1_early'; } // recommended still 5%, soft 25% gate in UI
    } else if (isMonthly) {
      if (elapsed >= 28) {
        maxPct = Math.min(1, monthlyMax + w4);
        needs_proof = true;
        tier = 'w4_proof';
      } else if (elapsed >= 21) {
        maxPct = Math.min(monthlyMax, w1 + w2 + w3);
        tier = 'w3';
      } else if (elapsed >= 14) {
        maxPct = Math.min(monthlyMax, w1 + w2);
        tier = 'w2';
      } else if (elapsed >= 7) {
        maxPct = Math.min(monthlyMax, w1);
        tier = 'w1';
      } else {
        maxPct = Math.min(monthlyMax, w1);
        tier = 'w1_early';
      }
    } else {
      if (elapsed >= 21) {
        maxPct = w1 + w2 + w3;
        needs_proof = true;
        tier = 'w3_proof';
      } else if (elapsed >= 14) {
        maxPct = w1 + w2;
        tier = 'w2';
      } else if (elapsed >= 7) {
        maxPct = w1;
        tier = 'w1';
      } else {
        maxPct = w1;
        tier = 'w1_early';
      }
    }
  }
  // Hard ceiling: half of cycle salary
  const halfCap = 0.5;
  maxPct = Math.min(maxPct, halfCap);
  const meets_cycle_gate = cycle > 0 ? progress >= 0.25 : false;
  // Always allow attempting acompte if salary > 0 (soft gate in UI)
  const can_advance = amount > 0 && maxPct > 0;
  const max_advance = Math.round(amount * maxPct * 100) / 100;
  return {
    suggested_pay: amount > 0 ? net : 0,
    gross_accrued: amount > 0 ? gross : 0,
    advances: adv,
    accrued_days: elapsed,
    period_from: periodFrom,
    period_to: today,
    cycle_days: cycle,
    daily_rate: Math.round(daily * 100) / 100,
    cycle_progress: Math.round(progress * 1000) / 1000,
    can_advance,
    max_advance,
    advance_pct_cap: maxPct,
    advance_needs_proof: needs_proof,
    advance_tier: tier,
    meets_cycle_gate,
    half_cycle_cap: Math.round(amount * halfCap * 100) / 100,
    period_source: anchor.source,
  };
}

function enrich(row: any, advances = 0) {
  const due = nextDue(row);
  const today = moroccoToday();
  const active = Number(row.active ?? 1) === 1;
  const overdue = !!(active && due && due <= today && Number(row.pay_amount || 0) > 0);
  const acc = accruedPay(row, today, advances);
  return {
    ...row,
    display_name: displayName(row),
    cycle_days: cycleDays(row),
    next_due: due,
    pay_overdue: overdue,
    has_id_doc: !!String(row.id_doc_key || '').trim(),
    is_resigned: !active,
    suggested_pay: acc.suggested_pay,
    gross_accrued: acc.gross_accrued,
    advances_in_period: acc.advances,
    accrued_days: acc.accrued_days,
    period_from: acc.period_from,
    period_to: acc.period_to,
    daily_rate: acc.daily_rate,
    cycle_progress: acc.cycle_progress,
    can_advance: acc.can_advance,
    max_advance: acc.max_advance,
    advance_pct_cap: acc.advance_pct_cap,
    advance_needs_proof: acc.advance_needs_proof,
    advance_tier: acc.advance_tier,
    meets_cycle_gate: acc.meets_cycle_gate,
    half_cycle_cap: acc.half_cycle_cap,
    period_source: acc.period_source,
  };
}

async function sumAdvancesInPeriod(db: D1Database, employeeId: number, from: string | null, to: string): Promise<number> {
  const fromD = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : '2000-01-01';
  const toD = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : moroccoToday();
  try {
    const r = await db.prepare(
      `SELECT COALESCE(SUM(amount), 0) as s FROM employee_payments
       WHERE employee_id = ? AND paid_at >= ? AND paid_at <= ?
         AND (period_label LIKE 'Acompte%' OR note LIKE '%[acompte]%')`,
    )
      .bind(employeeId, fromD, toD)
      .first() as any;
    return Number(r?.s || 0);
  } catch {
    return 0;
  }
}

/** Sum of non-acompte (full) payments in window — optional diagnostics */
async function sumFullPayInPeriod(db: D1Database, employeeId: number, from: string | null, to: string): Promise<number> {
  const fromD = from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : '2000-01-01';
  const toD = to && /^\d{4}-\d{2}-\d{2}$/.test(to) ? to : moroccoToday();
  try {
    const r = await db.prepare(
      `SELECT COALESCE(SUM(amount), 0) as s FROM employee_payments
       WHERE employee_id = ? AND paid_at >= ? AND paid_at <= ?
         AND period_label NOT LIKE 'Acompte%'
         AND (note IS NULL OR note NOT LIKE '%[acompte]%')`,
    )
      .bind(employeeId, fromD, toD)
      .first() as any;
    return Number(r?.s || 0);
  } catch {
    return 0;
  }
}


async function idCryptoKey(env: any): Promise<CryptoKey> {
  const secret = String(
    env.BACKUP_ENCRYPTION_KEY || env.ADMIN_BACKUP_TOKEN || env.JWT_SECRET || 'atlas-id-doc-key',
  );
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`emp-id-v1:${secret}`));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptIdBytes(env: any, plain: Uint8Array): Promise<Uint8Array> {
  const key = await idCryptoKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  const out = new Uint8Array(4 + 12 + ct.length);
  out[0] = 0x49;
  out[1] = 0x44;
  out[2] = 0x30;
  out[3] = 0x31;
  out.set(iv, 4);
  out.set(ct, 16);
  return out;
}

async function decryptIdBytes(env: any, blob: Uint8Array): Promise<Uint8Array | null> {
  if (blob.length < 20 || blob[0] !== 0x49 || blob[1] !== 0x44) return null;
  const iv = blob.slice(4, 16);
  const ct = blob.slice(16);
  const key = await idCryptoKey(env);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
  } catch {
    return null;
  }
}

function str(body: any, k: string, fallback = ''): string {
  if (body[k] === undefined || body[k] === null) return fallback;
  return String(body[k]).trim();
}

/** Heuristic parse of OCR / free text from CIN / passport. */
function parseIdText(text: string): Record<string, string> {
  const t = text.replace(/\r/g, '\n');
  const out: Record<string, string> = {};
  const cin = t.match(/\b([A-Z]{1,2}\d{5,8})\b/) || t.match(/\b(\d{8,10})\b/);
  if (cin) out.national_id = cin[1];
  // dates dd/mm/yyyy or yyyy-mm-dd
  const dates = [...t.matchAll(/\b(\d{2})[/\-.](\d{2})[/\-.](\d{4})\b/g)];
  if (dates.length) {
    const [, d, m, y] = dates[0];
    out.date_of_birth = `${y}-${m}-${d}`;
  }
  const iso = t.match(/\b(19|20)\d{2}-\d{2}-\d{2}\b/);
  if (iso && !out.date_of_birth) out.date_of_birth = iso[0];
  if (/féminin|female|femme|\bF\b/i.test(t) && !/masculin/i.test(t)) out.gender = 'Femme';
  else if (/masculin|male|homme|\bM\b/i.test(t)) out.gender = 'Homme';
  if (/maroc|morocco|marocaine/i.test(t)) out.nationality = 'Marocaine';
  // Name lines: rough
  const nameLine = t.match(/(?:Nom|Name|اسم)[:\s]+([A-Za-zÀ-ÿ\s\-']{2,40})/i);
  if (nameLine) {
    const parts = nameLine[1].trim().split(/\s+/);
    if (parts.length >= 2) {
      out.last_name = parts[0];
      out.first_name = parts.slice(1).join(' ');
    } else out.last_name = parts[0];
  }
  const prenom = t.match(/(?:Prénom|Given|السمك)[:\s]+([A-Za-zÀ-ÿ\s\-']{2,40})/i);
  if (prenom) out.first_name = prenom[1].trim();
  return out;
}

export type EmployeeRouteDeps = {
  checkConfirmPassword?: (
    env: any,
    db: D1Database,
    authHeader: string | undefined,
    body: any,
  ) => Promise<{ ok: true } | { ok: false; error: string; status: number; code: string }>;
};

export function registerEmployeeRoutes(app: AtlasApp, deps: EmployeeRouteDeps = {}): void {
  app.get('/api/employees', async (c) => {
    await ensureEmployeeTables(c.env.DB);
    try {
      await backfillEmpNumbers(c.env.DB);
    } catch {
      /* */
    }
    const status = String(c.req.query('status') || 'active'); // active | resigned | all
    const q = String(c.req.query('q') || '')
      .trim()
      .toLowerCase();
    const category = String(c.req.query('category') || '').trim();
    let sql = `SELECT * FROM employees WHERE 1=1`;
    if (status === 'active') sql += ` AND active = 1`;
    else if (status === 'resigned') sql += ` AND active = 0`;
    sql += ` ORDER BY active DESC, emp_number COLLATE NOCASE, name COLLATE NOCASE`;
    const { results } = await c.env.DB.prepare(sql).all();
    let acompteRules: any = {};
    try {
      const s = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
      acompteRules = {
        acompte_week1_pct: Number(s?.attendance_acompte_week1_pct ?? 5),
        acompte_week2_pct: Number(s?.attendance_acompte_week2_pct ?? 5),
        acompte_week3_pct: Number(s?.attendance_acompte_week3_pct ?? 5),
        acompte_week4_pct: Number(s?.attendance_acompte_week4_pct ?? 5),
        acompte_short_max_pct: Number(s?.attendance_acompte_short_max_pct ?? 5),
        acompte_monthly_max_pct: Number(s?.attendance_acompte_monthly_max_pct ?? 15),
        acompte_short_cycle_days: Number(s?.attendance_acompte_short_cycle_days ?? 14),
      };
    } catch { /* */ }
    let rows = [];
    for (const raw of (results || []) as any[]) {
      raw.__acompte_rules = acompteRules;
      raw.__require_presence_for_advance = false;
      const base = enrich(raw, 0);
      const adv = await sumAdvancesInPeriod(c.env.DB, Number(raw.id), base.period_from, base.period_to || moroccoToday());
      rows.push(enrich(raw, adv));
    }
    if (category) {
      rows = rows.filter((r: any) => String(r.category || '').toLowerCase() === category.toLowerCase());
    }
    if (q) {
      rows = rows.filter((r: any) => {
        const hay = [
          r.display_name,
          r.name,
          r.emp_number,
          r.phone,
          r.email,
          r.role_title,
          r.department,
          r.category,
          r.national_id,
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }
    const cats = [
      ...new Set(
        (results || [])
          .map((r: any) => String(r.category || '').trim())
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b, 'fr'));
    return c.json({ success: true, data: rows, categories: cats });
  });

  app.get('/api/employees/:id', async (c) => {
    await ensureEmployeeTables(c.env.DB);
    const row = await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(c.req.param('id')).first();
    if (!row) return c.json({ success: false, error: 'Employé introuvable' }, 404);
    const { results: payments } = await c.env.DB.prepare(
      `SELECT * FROM employee_payments WHERE employee_id = ? ORDER BY paid_at DESC, id DESC LIMIT 100`,
    )
      .bind(c.req.param('id'))
      .all();
    return c.json({ success: true, data: { ...enrich(row), payments: payments || [] } });
  });

  app.post('/api/employees', async (c) => {
    await ensureEmployeeTables(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const first = str(body, 'first_name');
    const last = str(body, 'last_name');
    const name = str(body, 'name') || `${first} ${last}`.trim();
    if (!name) return c.json({ success: false, error: 'Nom obligatoire' }, 400);
    const emp_number = str(body, 'emp_number') || (await nextEmpNumber(c.env.DB, c.env));
    const pay_amount = Math.max(0, Number(body.pay_amount || 0));
    const pay_cycle_type = body.pay_cycle_type === 'days' ? 'days' : 'monthly';
    const pay_cycle_days =
      pay_cycle_type === 'monthly' ? 30 : Math.max(1, Math.min(365, Number(body.pay_cycle_days || 7)));
    const r = await c.env.DB.prepare(
      `INSERT INTO employees (
        emp_number, name, first_name, last_name, phone, email, role_title, department, category,
        employment_status, joined_date, date_of_birth, gender, nationality, marital_status,
        national_id, tax_id, social_insurance, health_insurance, driving_license, immigration_status,
        address, city, country, postal_code, home_phone, work_phone,
        active, pay_amount, pay_cycle_type, pay_cycle_days, notes, user_username
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)`,
    )
      .bind(
        emp_number,
        name,
        first,
        last,
        str(body, 'phone') || str(body, 'mobile_phone'),
        str(body, 'email') || str(body, 'private_email'),
        str(body, 'role_title') || str(body, 'job_title'),
        str(body, 'department'),
        str(body, 'category'),
        str(body, 'employment_status'),
        str(body, 'joined_date'),
        str(body, 'date_of_birth'),
        str(body, 'gender'),
        str(body, 'nationality'),
        str(body, 'marital_status'),
        str(body, 'national_id'),
        str(body, 'tax_id'),
        str(body, 'social_insurance'),
        str(body, 'health_insurance'),
        str(body, 'driving_license'),
        str(body, 'immigration_status'),
        str(body, 'address'),
        str(body, 'city'),
        str(body, 'country'),
        str(body, 'postal_code'),
        str(body, 'home_phone'),
        str(body, 'work_phone'),
        pay_amount,
        pay_cycle_type,
        pay_cycle_days,
        str(body, 'notes'),
        str(body, 'user_username').trim().toLowerCase().slice(0, 64),
      )
      .run();
    await afterBusinessMutation(c.env.CACHE);
    const id = r.meta?.last_row_id;
    const row = id
      ? await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(id).first()
      : null;
    return c.json(
      {
        success: true,
        data: row ? enrich(row) : null,
        message: `Employé créé — n° ${emp_number}`,
      },
      201,
    );
  });

  app.put('/api/employees/:id', async (c) => {
    await ensureEmployeeTables(c.env.DB);
    const id = c.req.param('id');
    const existing = (await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(id).first()) as any;
    if (!existing) return c.json({ success: false, error: 'Employé introuvable' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const first = str(body, 'first_name', existing.first_name || '');
    const last = str(body, 'last_name', existing.last_name || '');
    const name = str(body, 'name', existing.name) || `${first} ${last}`.trim();
    if (!name) return c.json({ success: false, error: 'Nom obligatoire' }, 400);
    const pay_amount = Math.max(0, Number(body.pay_amount ?? existing.pay_amount ?? 0));
    const pay_cycle_type =
      body.pay_cycle_type === 'days' || body.pay_cycle_type === 'monthly'
        ? body.pay_cycle_type
        : String(existing.pay_cycle_type || 'monthly');
    const pay_cycle_days =
      pay_cycle_type === 'monthly'
        ? 30
        : Math.max(1, Math.min(365, Number(body.pay_cycle_days ?? existing.pay_cycle_days ?? 7)));
    // active controlled via resign / reactivate endpoints only unless explicit
    let active = Number(existing.active ?? 1);
    let resigned_at = existing.resigned_at;
    if (body.active !== undefined && body.active !== null) {
      active = body.active ? 1 : 0;
      resigned_at = active ? null : existing.resigned_at || new Date().toISOString().slice(0, 10);
    }
    await c.env.DB.prepare(
      `UPDATE employees SET
        emp_number=?, name=?, first_name=?, last_name=?, phone=?, email=?, role_title=?, department=?, category=?,
        employment_status=?, joined_date=?, date_of_birth=?, gender=?, nationality=?, marital_status=?,
        national_id=?, tax_id=?, social_insurance=?, health_insurance=?, driving_license=?, immigration_status=?,
        address=?, city=?, country=?, postal_code=?, home_phone=?, work_phone=?,
        active=?, resigned_at=?, pay_amount=?, pay_cycle_type=?, pay_cycle_days=?, notes=?, user_username=?,
        updated_at=datetime('now')
       WHERE id=?`,
    )
      .bind(
        str(body, 'emp_number', existing.emp_number || '') || existing.emp_number,
        name,
        first,
        last,
        str(body, 'phone', existing.phone || ''),
        str(body, 'email', existing.email || ''),
        str(body, 'role_title', existing.role_title || ''),
        str(body, 'department', existing.department || ''),
        str(body, 'category', existing.category || ''),
        str(body, 'employment_status', existing.employment_status || ''),
        str(body, 'joined_date', existing.joined_date || ''),
        str(body, 'date_of_birth', existing.date_of_birth || ''),
        str(body, 'gender', existing.gender || ''),
        str(body, 'nationality', existing.nationality || ''),
        str(body, 'marital_status', existing.marital_status || ''),
        str(body, 'national_id', existing.national_id || ''),
        str(body, 'tax_id', existing.tax_id || ''),
        str(body, 'social_insurance', existing.social_insurance || ''),
        str(body, 'health_insurance', existing.health_insurance || ''),
        str(body, 'driving_license', existing.driving_license || ''),
        str(body, 'immigration_status', existing.immigration_status || ''),
        str(body, 'address', existing.address || ''),
        str(body, 'city', existing.city || ''),
        str(body, 'country', existing.country || ''),
        str(body, 'postal_code', existing.postal_code || ''),
        str(body, 'home_phone', existing.home_phone || ''),
        str(body, 'work_phone', existing.work_phone || ''),
        active,
        resigned_at,
        pay_amount,
        pay_cycle_type,
        pay_cycle_days,
        str(body, 'notes', existing.notes || ''),
        str(body, 'user_username', existing.user_username || '').trim().toLowerCase().slice(0, 64),
        id,
      )
      .run();
    await afterBusinessMutation(c.env.CACHE);
    const row = await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(id).first();
    try { await persistHrExtras(c.env.DB, id, body); } catch { /* */ }
    return c.json({ success: true, data: enrich(row), message: 'Employé mis à jour' });
  });

  /** Resign — keeps payments forever. Optional final settlement for accrued days. */
  app.post('/api/employees/:id/resign', async (c) => {
    await ensureEmployeeTables(c.env.DB);
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    // Session admin suffit — pas de mot de passe demandé côté UI
    const emp = (await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(id).first()) as any;
    if (!emp) return c.json({ success: false, error: 'Employé introuvable' }, 404);
    const day = moroccoToday();
    const reason = String(body.reason || body.employment_status || 'Démission').trim() || 'Démission';

    // Optional: update cycle before settlement snapshot
    if (body.pay_cycle_type === 'monthly' || body.pay_cycle_type === 'days') {
      const days = body.pay_cycle_type === 'monthly' ? 30 : Math.max(1, Number(body.pay_cycle_days || emp.pay_cycle_days || 7));
      await c.env.DB.prepare(
        `UPDATE employees SET pay_cycle_type = ?, pay_cycle_days = ?, updated_at = datetime('now') WHERE id = ?`,
      )
        .bind(body.pay_cycle_type, days, id)
        .run();
      emp.pay_cycle_type = body.pay_cycle_type;
      emp.pay_cycle_days = days;
    }
    if (body.pay_amount != null && Number(body.pay_amount) >= 0) {
      await c.env.DB.prepare(`UPDATE employees SET pay_amount = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(Number(body.pay_amount), id)
        .run();
      emp.pay_amount = Number(body.pay_amount);
    }

    let settled = 0;
    if (body.settle_pay) {
      const acc = accruedPay(emp, day);
      const amount = Math.max(0, Number(body.amount != null ? body.amount : acc.suggested_pay));
      if (amount > 0) {
        const periodLabel =
          acc.period_from
            ? `Solde départ ${acc.period_from} → ${day} (${acc.accrued_days} j)`
            : `Solde départ au ${day}`;
        const note = String(body.note || reason || '').trim();
        const payment_method = String(body.payment_method || 'cash').trim() || 'cash';
        const empLabel = displayName(emp);
        const payIns = await c.env.DB.prepare(
          `INSERT INTO employee_payments (employee_id, amount, paid_at, period_label, note) VALUES (?, ?, ?, ?, ?)`,
        )
          .bind(id, amount, day, periodLabel, note)
          .run();
        const payId = payIns.meta?.last_row_id;
        await c.env.DB.prepare(`UPDATE employees SET last_paid_at = ?, updated_at = datetime('now') WHERE id = ?`)
          .bind(day, id)
          .run();
        try {
          await c.env.DB.prepare(
            `INSERT INTO expenses (category, description, amount, payment_method, expense_date, vendor_name, reference, notes, entry_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'expense')`,
          )
            .bind(
              'Salaire',
              `Solde départ ${empLabel}`,
              amount,
              payment_method,
              day,
              empLabel,
              emp.emp_number || `EMP-${id}`,
              `employee_id:${id}|payment_id:${payId || ''}|resign|${note}`,
            )
            .run();
        } catch {
          /* expenses table */
        }
        settled = amount;
      }
    }

    await c.env.DB.prepare(
      `UPDATE employees SET active = 0, resigned_at = ?, employment_status = ?, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(day, reason, id)
      .run();
    await afterBusinessMutation(c.env.CACHE);
    const row = await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(id).first();
    return c.json({
      success: true,
      data: enrich(row),
      message: settled
        ? `Démission enregistrée. Solde payé : ${settled.toLocaleString('fr-FR')} MAD.`
        : 'Employé marqué comme démissionnaire. Historique des paiements conservé.',
    });
  });

  app.post('/api/employees/:id/reactivate', async (c) => {
    await ensureEmployeeTables(c.env.DB);
    const id = c.req.param('id');
    const emp = await c.env.DB.prepare(`SELECT id FROM employees WHERE id = ?`).bind(id).first();
    if (!emp) return c.json({ success: false, error: 'Employé introuvable' }, 404);
    const returned = moroccoToday();
    await c.env.DB.prepare(
      `UPDATE employees SET active = 1, resigned_at = NULL, returned_at = ?, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(returned, id)
      .run();
    await afterBusinessMutation(c.env.CACHE);
    const row = await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(id).first();
    return c.json({ success: true, data: enrich(row), message: 'Employé réactivé' });
  });

  /** Parse ID document text / optional AI vision — returns suggested fields for user review. */
  app.post('/api/employees/parse-id', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const dataUrl = String(body.data_url || body.dataUrl || '');
    const textHint = String(body.text || '');
    let extracted: Record<string, string> = {};
    let source = 'none';

    if (textHint.trim()) {
      extracted = parseIdText(textHint);
      source = 'text';
    }

    // Optional Workers AI vision if binding exists
    try {
      const ai = (c.env as any).AI;
      if (ai && dataUrl.startsWith('data:image')) {
        const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (m) {
          const result = await ai.run('@cf/llava-hf/llava-1.5-7b-hf', {
            image: [...Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0))],
            prompt:
              'Extract from this ID or passport: first name, last name, date of birth YYYY-MM-DD, gender, nationality, national ID number. Reply as JSON only.',
            max_tokens: 400,
          });
          const raw = String(result?.description || result?.response || result || '');
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              const j = JSON.parse(jsonMatch[0]);
              extracted = {
                first_name: j.first_name || j.firstName || extracted.first_name || '',
                last_name: j.last_name || j.lastName || extracted.last_name || '',
                date_of_birth: j.date_of_birth || j.dob || extracted.date_of_birth || '',
                gender: j.gender || extracted.gender || '',
                nationality: j.nationality || extracted.nationality || '',
                national_id: j.national_id || j.nationalId || j.cin || extracted.national_id || '',
              };
              source = 'ai';
            } catch {
              extracted = { ...extracted, ...parseIdText(raw) };
              source = 'ai-text';
            }
          } else {
            extracted = { ...extracted, ...parseIdText(raw) };
            source = 'ai-text';
          }
        }
      }
    } catch (e) {
      console.log('parse-id ai', e);
    }

    // PDF text-ish base64: skip heavy parse — client shows review anyway
    return c.json({
      success: true,
      data: {
        fields: extracted,
        source,
        review_message:
          'Veuillez vérifier chaque information extraite de la pièce d’identité avant d’enregistrer. Corrigez si nécessaire.',
      },
    });
  });

  app.post('/api/employees/:id/id-document', async (c) => {
    await ensureEmployeeTables(c.env.DB);
    const id = c.req.param('id');
    const emp = await c.env.DB.prepare(`SELECT id, id_doc_key FROM employees WHERE id = ?`).bind(id).first();
    if (!emp) return c.json({ success: false, error: 'Employé introuvable' }, 404);
    if (!c.env.IMAGES) return c.json({ success: false, error: 'Stockage R2 indisponible' }, 503);

    const body = await c.req.json().catch(() => ({}));
    const dataUrl = String(body.data_url || body.dataUrl || '');
    const fileName = String(body.file_name || body.fileName || 'document').slice(0, 120);
    let mime = String(body.mime || 'application/octet-stream');
    let bytes: Uint8Array | null = null;

    if (dataUrl.startsWith('data:')) {
      const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) return c.json({ success: false, error: 'Fichier invalide' }, 400);
      mime = m[1] || mime;
      const bin = atob(m[2]);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else if (body.base64) {
      const bin = atob(String(body.base64));
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    }
    if (!bytes || bytes.length < 10) return c.json({ success: false, error: 'Fichier vide' }, 400);
    if (bytes.length > 8 * 1024 * 1024) return c.json({ success: false, error: 'Fichier trop volumineux (max 8 Mo)' }, 400);

    const okMime =
      mime.startsWith('image/') || mime === 'application/pdf' || mime === 'application/octet-stream';
    if (!okMime) return c.json({ success: false, error: 'PDF ou image uniquement' }, 400);

    const enc = await encryptIdBytes(c.env, bytes);
    const rand =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().replace(/-/g, '')
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const key = `employees/.id/${id}/${rand}.id`;

    const prev = String((emp as any).id_doc_key || '');
    if (prev) {
      try {
        await c.env.IMAGES.delete(prev);
      } catch {
        /* */
      }
    }

    await c.env.IMAGES.put(key, enc, {
      httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store' },
      customMetadata: {
        kind: 'employee_id_doc',
        employee_id: String(id),
        mime: mime.slice(0, 80),
        original_name: fileName.slice(0, 120),
        encrypted: 'aes-gcm-id01',
      },
    });

    await c.env.DB.prepare(
      `UPDATE employees SET id_doc_key = ?, id_doc_name = ?, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(key, fileName, id)
      .run();
    await afterBusinessMutation(c.env.CACHE);

    // parse suggestions for client review
    let fields: Record<string, string> = {};
    try {
      if (mime.startsWith('image/') && dataUrl) {
        const pr = await fetch(new URL('/api/employees/parse-id', c.req.url), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: c.req.header('Authorization') || '',
          },
          body: JSON.stringify({ data_url: dataUrl }),
        }).catch(() => null);
        // skip self-fetch in worker - parse inline
      }
    } catch {
      /* */
    }

    return c.json({
      success: true,
      message: 'Pièce d’identité enregistrée (chiffrée)',
      data: {
        has_id_doc: true,
        id_doc_name: fileName,
        review_message:
          'Veuillez vérifier que les informations de la fiche (naissance, CIN, nom…) sont correctes.',
      },
    });
  });

  app.get('/api/employees/:id/id-document', async (c) => {
    await ensureEmployeeTables(c.env.DB);
    const id = c.req.param('id');
    const emp = (await c.env.DB.prepare(`SELECT id_doc_key, id_doc_name FROM employees WHERE id = ?`)
      .bind(id)
      .first()) as any;
    if (!emp?.id_doc_key) return c.json({ success: false, error: 'Aucun document' }, 404);
    if (!c.env.IMAGES) return c.json({ success: false, error: 'R2 indisponible' }, 503);
    const obj = await c.env.IMAGES.get(String(emp.id_doc_key));
    if (!obj) return c.json({ success: false, error: 'Fichier introuvable' }, 404);
    const buf = new Uint8Array(await obj.arrayBuffer());
    const plain = await decryptIdBytes(c.env, buf);
    if (!plain) return c.json({ success: false, error: 'Déchiffrement impossible' }, 500);
    const meta = obj.customMetadata || {};
    const mime = meta.mime || 'application/octet-stream';
    const name = emp.id_doc_name || meta.original_name || 'document.id';
    return new Response(plain, {
      headers: {
        'Content-Type': mime,
        'Content-Disposition': `attachment; filename="${String(name).replace(/"/g, '')}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  });

  
  /**
   * Acompte (advance): only if ≥25% of cycle completed; max 10% of cycle salary.
   * Does NOT reset last_paid_at — full cycle continues; acomptes reduce suggested net.
   */
  app.post('/api/employees/:id/advance', async (c) => {
    await ensureEmployeeTables(c.env.DB);
    const id = c.req.param('id');
    const emp = (await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(id).first()) as any;
    if (!emp) return c.json({ success: false, error: 'Employé introuvable' }, 404);
    if (Number(emp.active) === 0) return c.json({ success: false, error: 'Employé inactif' }, 400);
    const body = await c.req.json().catch(() => ({}));
    const day = String(body.paid_at || moroccoToday()).slice(0, 10);
    let acompteRules: any = {};
    try {
      const s = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
      acompteRules = {
        acompte_week1_pct: Number(s?.attendance_acompte_week1_pct ?? 5),
        acompte_week2_pct: Number(s?.attendance_acompte_week2_pct ?? 5),
        acompte_week3_pct: Number(s?.attendance_acompte_week3_pct ?? 5),
        acompte_week4_pct: Number(s?.attendance_acompte_week4_pct ?? 5),
        acompte_short_max_pct: Number(s?.attendance_acompte_short_max_pct ?? 5),
        acompte_monthly_max_pct: Number(s?.attendance_acompte_monthly_max_pct ?? 15),
      };
    } catch { /* */ }
    emp.__acompte_rules = acompteRules;
    emp.__require_presence_for_advance = false;
    const acc0 = accruedPay(emp, day, 0);
    const already = await sumAdvancesInPeriod(c.env.DB, Number(id), acc0.period_from, day);
    const acc = accruedPay(emp, day, already);
    if (!acc.can_advance || Number(emp.pay_amount || 0) <= 0) {
      return c.json({
        success: false,
        error: 'Acompte impossible (pas de salaire configuré).',
        code: 'ADVANCE_NO_SALARY',
        data: acc,
      }, 400);
    }
    const noteStr = String(body.note || '').trim();
    if (acc.advance_needs_proof && noteStr.length < 8) {
      return c.json({
        success: false,
        error: 'Cette tranche d’acompte exige une note / justificatif (min. 8 caractères).',
        code: 'ADVANCE_PROOF_REQUIRED',
        data: acc,
      }, 400);
    }

    // Hard only: total acomptes this period cannot exceed 50% of cycle salary
    const halfCap = Math.round(Number(emp.pay_amount || 0) * 0.5 * 100) / 100;
    const hardLeft = Math.max(0, Math.round((halfCap - already) * 100) / 100);
    const softLeft = Math.max(0, Math.round((acc.max_advance - already) * 100) / 100);
    if (hardLeft <= 0) {
      return c.json({
        success: false,
        error: 'Plafond atteint (max. 50% du salaire de cycle en acomptes).',
        code: 'ADVANCE_CAP',
        data: { max_advance: halfCap, already, half_cycle_cap: halfCap },
      }, 400);
    }
    // Default = 5% of cycle salary, hard max = 50% − already taken
    const fivePct = Math.round(Number(emp.pay_amount || 0) * 0.05 * 100) / 100;
    let amount = Math.max(0, Number(body.amount != null ? body.amount : Math.min(fivePct, hardLeft)));
    if (amount <= 0) return c.json({ success: false, error: 'Montant invalide' }, 400);
    if (amount > hardLeft) amount = hardLeft;
    const note = String(body.note || '').trim();
    const payment_method = String(body.payment_method || 'cash').trim() || 'cash';
    const empLabel = displayName(emp);
    const label = `Acompte ${day} (${Math.round(acc.cycle_progress * 100)}% cycle)`;
    const payIns = await c.env.DB.prepare(
      `INSERT INTO employee_payments (employee_id, amount, paid_at, period_label, note) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, amount, day, label, note ? `${note} [acompte]` : '[acompte]')
      .run();
    const payId = payIns.meta?.last_row_id;
    try {
      await c.env.DB.prepare(
        `INSERT INTO expenses (category, description, amount, payment_method, expense_date, vendor_name, reference, notes, entry_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'expense')`,
      )
        .bind(
          'Salaire',
          `Acompte ${empLabel}`,
          amount,
          payment_method,
          day,
          empLabel,
          emp.emp_number || `EMP-${id}`,
          `employee_id:${id}|payment_id:${payId || ''}|acompte`,
        )
        .run();
    } catch {
      /* */
    }
    await afterBusinessMutation(c.env.CACHE);
    try {
      // Notify list/badge listeners (same channel as other mutations)
      if (typeof (c.env as any).MOBILE_HUB !== 'undefined') {
        /* optional hub */
      }
    } catch { /* */ }
    const row = await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(id).first();
    const adv2 = await sumAdvancesInPeriod(c.env.DB, Number(id), acc.period_from, day);
    const enriched = enrich({ ...row, __acompte_rules: acompteRules }, adv2);
    const remainingPay = Math.max(0, Math.round((enriched.gross_accrued - adv2) * 100) / 100);
    return c.json({
      success: true,
      data: {
        ...enriched,
        remaining_to_pay: remainingPay,
        advances_in_period: adv2,
      },
      message: `Acompte ${amount.toLocaleString('fr-FR')} MAD enregistré. Reste à payer sur la période: ${remainingPay.toLocaleString('fr-FR')} MAD. Acompte restant possible: ${Math.max(0, hardLeft - amount).toLocaleString('fr-FR')} MAD.`,
    });
  });

app.post('/api/employees/:id/pay', async (c) => {
    await ensureEmployeeTables(c.env.DB);
    const id = c.req.param('id');
    const emp = (await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(id).first()) as any;
    if (!emp) return c.json({ success: false, error: 'Employé introuvable' }, 404);
    const body = await c.req.json().catch(() => ({}));
    const paid_at = String(body.paid_at || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const days = cycleDays(emp);
    const acc0 = accruedPay(emp, paid_at, 0);
    const advances = await sumAdvancesInPeriod(c.env.DB, Number(id), acc0.period_from, paid_at);
    const acc = accruedPay(emp, paid_at, advances);
    // Remaining to settle this cycle after acomptes (never negative)
    const remaining = Math.max(0, Math.round((acc.gross_accrued - advances) * 100) / 100);
    const defaultPay = remaining > 0 ? remaining : Math.max(0, Number(emp.pay_amount || 0) - advances);
    const amount = Math.max(0, Number(body.amount != null ? body.amount : defaultPay));
    if (amount <= 0) return c.json({ success: false, error: 'Montant invalide (rien à payer après acomptes)' }, 400);
    const label =
      acc.period_from
        ? `Période ${acc.period_from} → ${paid_at} (${acc.accrued_days} j / cycle ${days})` +
          (advances > 0 ? ` · acomptes −${advances}` : '')
        : emp.pay_cycle_type === 'monthly'
          ? 'Mensuel'
          : `Tous les ${days} jours`;
    const noteBase = String(body.note || '').trim();
    const note =
      advances > 0
        ? `${noteBase}${noteBase ? ' · ' : ''}Acomptes déduits: ${advances} MAD`.trim()
        : noteBase;
    const payment_method = String(body.payment_method || body.method || 'cash').trim() || 'cash';
    const empLabel = displayName(emp);

    const payIns = await c.env.DB.prepare(
      `INSERT INTO employee_payments (employee_id, amount, paid_at, period_label, note) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, amount, paid_at, label, note)
      .run();
    const payId = payIns.meta?.last_row_id;

    await c.env.DB.prepare(`UPDATE employees SET last_paid_at = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(paid_at, id)
      .run();

    // Ledger: salary outflow so Solde / Balance reflects the payment
    try {
      await c.env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS expenses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT DEFAULT 'General',
          description TEXT NOT NULL,
          amount REAL NOT NULL,
          payment_method TEXT DEFAULT 'cash',
          expense_date TEXT,
          vendor_name TEXT DEFAULT '',
          reference TEXT DEFAULT '',
          notes TEXT DEFAULT '',
          entry_type TEXT DEFAULT 'expense',
          created_at TEXT DEFAULT (datetime('now'))
        )`,
      ).run();
      await addColumnIfMissing(c.env.DB, 'expenses', 'entry_type', "TEXT DEFAULT 'expense'");
      await c.env.DB.prepare(
        `INSERT INTO expenses (category, description, amount, payment_method, expense_date, vendor_name, reference, notes, entry_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'expense')`,
      )
        .bind(
          'Salaire',
          `Salaire ${empLabel} — ${label}`,
          amount,
          payment_method,
          paid_at,
          empLabel,
          emp.emp_number || `EMP-${id}`,
          `employee_id:${id}|payment_id:${payId || ''}${note ? `|note:${note}` : ''}`,
        )
        .run();
    } catch (e) {
      console.error('employee pay → expenses', e);
    }

    await afterBusinessMutation(c.env.CACHE);
    try {
      if (c.env.CACHE) await c.env.CACHE.delete('dashboard:v1');
    } catch {
      /* */
    }
    const row = await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(id).first();
    return c.json({
      success: true,
      data: enrich(row),
      message: `Paiement enregistré — ${amount.toLocaleString('fr-FR')} MAD (débit solde)`,
    });
  });

  /** Permanent delete — never deletes payment history rows. */
  app.delete('/api/employees/:id', async (c) => {
    await ensureEmployeeTables(c.env.DB);
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    // Session admin suffit — suppression uniquement si déjà démissionnaire (active=0)
    const emp = (await c.env.DB.prepare(`SELECT id_doc_key, name, active FROM employees WHERE id = ?`)
      .bind(id)
      .first()) as any;
    if (!emp) return c.json({ success: false, error: 'Employé introuvable' }, 404);
    // active may be 0 | 1 | "0" | null — only block when clearly active
    const stillActive = Number(emp.active) === 1 || emp.active === true || emp.active === '1';
    if (stillActive) {
      return c.json(
        {
          success: false,
          error: 'Démissionnez d’abord l’employé avant une suppression définitive.',
          code: 'MUST_RESIGN_FIRST',
        },
        400,
      );
    }

    if (emp.id_doc_key && c.env.IMAGES) {
      try {
        await c.env.IMAGES.delete(String(emp.id_doc_key));
      } catch {
        /* */
      }
    }
    // Keep employee_payments rows (audit trail)
    await c.env.DB.prepare(`DELETE FROM employees WHERE id = ?`).bind(id).run();
    await afterBusinessMutation(c.env.CACHE);
    return c.json({
      success: true,
      message: `Employé ${emp.name || id} supprimé. L’historique des paiements est conservé.`,
    });
  });
}
