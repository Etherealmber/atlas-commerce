/**
 * v262 — Report period bounds, extracted from worker/index.ts so the logic is
 * pure and unit-testable (same pattern as lib/finance.ts / lib/webauthn.ts).
 *
 * Accepted `period` values:
 *  - relative: month (default), 3m/6m/9m/12m/24m/36m/48m, year/ytd,
 *    custom (+ from/to YYYY-MM-DD);
 *  - absolute: a STRICTLY validated `YYYY-MM` month (4-digit year 1970–2100,
 *    month 01–12 — nothing else; `2026-1`, `2026-13`, `2026-10-05` are
 *    rejected and fall back to the current month).
 *
 * Timezone semantics: the caller supplies `todayYmd` — the company's calendar
 * today in its configured finance timezone (company_settings.finance_timezone,
 * default Africa/Casablanca — computed with lib/finance.localTodayYmd, never
 * the worker's UTC clock). The current month stops at `todayYmd`; past months
 * use the full calendar month (leap-year safe); future months clamp `to` at
 * today (empty window, deterministic).
 *
 * `periodKey` is the normalized, validated period that gets propagated to
 * every report section link — raw user input is never echoed into links.
 */

export type PeriodParams = {
  period?: string | null;
  from?: string | null;
  to?: string | null;
};

export type PeriodBounds = {
  from: string;
  to: string;
  label: string;
  periodKey: string;
};

const MONTH_NAMES_FR = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

const RELATIVE_LABELS_FR: Record<string, string> = {
  '3m': '3 derniers mois',
  '6m': '6 derniers mois',
  '9m': '9 derniers mois',
  '12m': '12 derniers mois',
  '24m': '2 ans',
  '36m': '3 ans',
  '48m': '4 ans',
};

const MONTHS_BACK: Record<string, number> = {
  month: 0, '3m': 2, '6m': 5, '9m': 8, '12m': 11, '24m': 23, '36m': 35, '48m': 47,
};

/** Strict YYYY-MM parse → { year, month(1-12) } or null. No coercion. */
export function parsePeriodMonth(period: unknown): { year: number; month: number } | null {
  const m = String(period ?? '').trim().match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 1970 || year > 2100) return null;
  return { year, month: Number(m[2]) };
}

function isValidYmd(value: unknown): value is string {
  return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(value ?? ''));
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function ymd(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES_FR[month - 1]} ${year}`;
}

/**
 * Compute { from, to, label, periodKey } for a report request.
 * `opts.todayYmd` MUST be the company-timezone calendar day (YYYY-MM-DD).
 */
export function computePeriodBounds(params: PeriodParams, opts: { todayYmd: string }): PeriodBounds {
  const today = isValidYmd(opts.todayYmd)
    ? String(opts.todayYmd).slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const curYear = Number(today.slice(0, 4));
  const curMonth = Number(today.slice(5, 7));
  const period = String(params.period ?? '').trim() || 'month';

  // 1) Absolute month — strictly validated YYYY-MM.
  const ym = parsePeriodMonth(period);
  if (ym) {
    const from = ymd(ym.year, ym.month, 1);
    const monthEnd = ymd(ym.year, ym.month, lastDayOfMonth(ym.year, ym.month));
    // past → full month; current → stops at today; future → clamped (empty)
    const to = monthEnd < today ? monthEnd : today;
    return { from, to, label: monthLabel(ym.year, ym.month), periodKey: `${ym.year}-${String(ym.month).padStart(2, '0')}` };
  }

  // 2) Calendar year to date.
  if (period === 'year' || period === 'ytd') {
    const label = period === 'year' ? `Année ${curYear}` : `Année en cours ${curYear}`;
    return { from: ymd(curYear, 1, 1), to: today, label, periodKey: period };
  }

  // 3) Custom range — both bounds must be valid YYYY-MM-DD; `to` clamps at today.
  if (period === 'custom' && isValidYmd(params.from) && isValidYmd(params.to)) {
    const from = String(params.from).slice(0, 10);
    const to = String(params.to).slice(0, 10) > today ? today : String(params.to).slice(0, 10);
    return { from, to, label: `Du ${from} au ${to}`, periodKey: 'custom' };
  }

  // 4) Relative month windows (month = current month → today).
  if (period in MONTHS_BACK) {
    const idx = curYear * 12 + (curMonth - 1) - MONTHS_BACK[period];
    const fy = Math.floor(idx / 12);
    const fm = (idx % 12) + 1;
    const label = period === 'month' ? monthLabel(fy, fm) : RELATIVE_LABELS_FR[period];
    return { from: ymd(fy, fm, 1), to: today, label, periodKey: period };
  }

  // 5) Unknown / invalid (e.g. '2026-13', '2026-1', 'nope') → current month.
  return { from: ymd(curYear, curMonth, 1), to: today, label: monthLabel(curYear, curMonth), periodKey: 'month' };
}

/**
 * Query string for report deep-links: the short-lived HMAC `rt` ticket plus
 * the NORMALIZED period key (never the raw user input) and section extras.
 * A session JWT is never accepted here nor emitted into links — `token` is
 * dropped defensively even if a caller tries to smuggle it.
 */
export function buildReportLinkQuery(rt: string, periodKey: string, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  if (rt) p.set('rt', rt);
  if (periodKey) p.set('period', periodKey);
  for (const [k, v] of Object.entries(extra)) {
    if (v && k !== 'token' && k !== 'rt') p.set(k, v);
  }
  return `?${p.toString()}`;
}
