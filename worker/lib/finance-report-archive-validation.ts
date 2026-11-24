/**
 * Validation primitives for the planned finance-report archive.
 * No route or storage is registered by this module.
 */
import { computePeriodBounds, parsePeriodMonth } from './report-period';
import { FINANCE_TENANT, financeGate, isValidPeriod, monthBounds } from './finance';

type ArchiveLocale = 'fr' | 'en' | 'ar-MA';
type ArchiveInput = {
  schema_version: 1;
  kind: 'monthly' | 'combined';
  period: string;
  from: string;
  to: string;
  sections: string[];
  locale: ArchiveLocale;
};

const RELATIVE_PERIODS = new Set(['month', '3m', '6m', '9m', '12m', '24m', '36m', '48m', 'year', 'ytd', 'custom']);
const LOCALES = new Set<ArchiveLocale>(['fr', 'en', 'ar-MA']);
const REQUEST_KEYS = new Set(['schema_version', 'kind', 'period', 'from', 'to', 'sections', 'locale']);
const plainObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** Strict calendar date: rejects dates that JavaScript otherwise rolls over. */
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const y = Number(value.slice(0, 4));
  if (y < 1970 || y > 2100) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * Reuses the existing report-period calculation after rejecting its permissive
 * fallback cases. `today` must be derived from the server's finance timezone,
 * not accepted from the request. The caller supplies the existing supported
 * section keys for the requested kind; this helper does not invent them.
 */
export function validateArchiveInput(value: unknown, today: string, allowedSections: readonly string[]): ArchiveInput | null {
  if (!plainObject(value) || Object.keys(value).some(k => !REQUEST_KEYS.has(k)) || value.schema_version !== 1 ||
      (value.kind !== 'monthly' && value.kind !== 'combined') || !validDate(today) ||
      !Array.isArray(value.sections) || value.sections.length < 1 || value.sections.length > allowedSections.length ||
      value.sections.some((x: unknown) => typeof x !== 'string' || !allowedSections.includes(x)) ||
      new Set(value.sections).size !== value.sections.length) return null;
  const locale = value.locale === undefined ? 'fr' : value.locale;
  if (typeof locale !== 'string' || !LOCALES.has(locale as ArchiveLocale)) return null;
  if (typeof value.period !== 'string') return null;
  const period = value.period;
  if (value.kind === 'monthly') {
    if (!isValidPeriod(period) || !parsePeriodMonth(period) || value.from !== undefined || value.to !== undefined) return null;
    const b = monthBounds(period);
    return { schema_version: 1, kind: 'monthly', period, from: b.start, to: b.end, sections: [...value.sections], locale: locale as ArchiveLocale };
  }
  if (!RELATIVE_PERIODS.has(period) && !(isValidPeriod(period) && parsePeriodMonth(period))) return null;
  if (period === 'custom') {
    if (!validDate(value.from) || !validDate(value.to) || value.from > value.to) return null;
  } else if (value.from !== undefined || value.to !== undefined) return null;
  const bounds = computePeriodBounds({ period, from: value.from as string | undefined, to: value.to as string | undefined }, { todayYmd: today });
  // A future window produces no range; avoid silently archiving an empty report.
  if (!validDate(bounds.from) || !validDate(bounds.to) || bounds.from > bounds.to) return null;
  return { schema_version: 1, kind: 'combined', period: bounds.periodKey, from: bounds.from, to: bounds.to, sections: [...value.sections], locale: locale as ArchiveLocale };
}

type ArchiveIdentity = { username: string; role: string; userId: number | null; tenant: string };
type AuthDeps = {
  authFailReason(header: string | undefined, env: unknown, db: D1Database, ip: string, fingerprint: string | undefined): Promise<string>;
  sessionUserFromHeader(header: string | undefined): { username: string; role: string };
  ownerUsername(env: unknown): string;
  allowSecretaire?: boolean;
};

/**
 * The existing verifier validates the proof using the database role, while the
 * parsed role claim can be altered. This additionally compares the current role
 * and active account before applying the existing finance gate. Recheck on every
 * operation; this helper never takes a user or tenant ID from the caller.
 */
export async function verifyArchiveIdentity(
  env: { DB: D1Database }, header: string | undefined, ip: string, fingerprint: string | undefined, deps: AuthDeps,
): Promise<{ ok: true; identity: ArchiveIdentity } | { ok: false; status: 401 | 403 | 503; code: string }> {
  try {
    if (await deps.authFailReason(header, env, env.DB, ip, fingerprint) !== 'ok') return { ok: false, status: 401, code: 'UNAUTHORIZED' };
    const session = deps.sessionUserFromHeader(header);
    const username = String(session.username || '').toLowerCase();
    if (!username) return { ok: false, status: 401, code: 'UNAUTHORIZED' };
    const owner = username === deps.ownerUsername(env) && session.role === 'owner';
    let role = 'owner';
    let userId: number | null = null;
    if (!owner) {
      const user = await env.DB.prepare('SELECT id, role FROM app_users WHERE username = ? AND active = 1').bind(username).first() as { id: number; role: string } | null;
      if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || user.role !== session.role) return { ok: false, status: 401, code: 'UNAUTHORIZED' };
      userId = user.id;
      role = user.role;
    }
    if (!financeGate(role, username).ok && !(deps.allowSecretaire && role === 'secretaire')) {
      return { ok: false, status: 403, code: 'FIN_FORBIDDEN' };
    }
    return { ok: true, identity: { username, role, userId, tenant: FINANCE_TENANT } };
  } catch {
    // Never log credentials, report content, or raw database errors.
    return { ok: false, status: 503, code: 'SERVICE_UNAVAILABLE' };
  }
}
