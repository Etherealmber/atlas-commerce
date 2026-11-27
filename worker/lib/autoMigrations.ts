import { schemaOnceForDb } from './schema';
import { ensureOfflineOpsSchema } from './idempotency';
import { ensureCashShiftSchema } from '../routes/cashShifts';
import { ensureAttendanceTableSchema } from '../routes/attendance';
import { ensurePayrollSchema } from '../routes/payroll';
import { ensureAccountingAccountsSchema } from '../routes/fec';
import { ensureDunningSchema } from '../routes/dunning';
import { ensureDgiSchema } from '../routes/dgi';

/**
 * Automatically applies and upgrades all runtime SQL schemas/migrations added
 * for migrations 0013–0020 (idempotency, placement revisions, cash shifts,
 * attendance, payroll, PCGE chart of accounts, dunning, and DGI clearance).
 *
 * Runs at most once per underlying D1 binding per Worker isolate via
 * `schemaOnceForDb`, so cold-start auto-provisioning requires zero manual
 * `wrangler d1 migrations apply` steps and incurs zero overhead afterward.
 */
export async function ensureAutoSqlMigrations(db: D1Database | null | undefined): Promise<void> {
  if (!db || typeof (db as any).prepare !== 'function') return;
  await schemaOnceForDb(db, 'auto_sql_migrations_0013_0020', async () => {
    await ensureOfflineOpsSchema(db);
    await ensureCashShiftSchema(db);
    await ensureAttendanceTableSchema(db);
    await ensurePayrollSchema(db);
    await ensureAccountingAccountsSchema(db);
    await ensureDunningSchema(db);
    await ensureDgiSchema(db);
  });
}

/** Only reviewed endpoints that never access the tables rebuilt by these
 * migrations can bypass the global barrier. Agent chat exposes read tools and
 * proposals only; approval and all business mutation routes remain guarded. */
export function requiresAutoSqlMigrations(method: string, path: string): boolean {
  const verb = method.toUpperCase();
  if (verb === 'POST' && (path === '/api/assist/chat' || path === '/api/assist/chat/stream')) return false;
  if (verb === 'GET' && path === '/api/admin/agent/threads') return false;
  if ((verb === 'GET' || verb === 'PUT') && /^\/api\/admin\/agent\/threads\/[^/]+$/.test(path)) return false;
  if (verb !== 'GET') return true;
  return !['/api/dashboard', '/api/admin/journal-mode', '/api/admin/journal-archive', '/api/admin/journal-archive/item'].includes(path);
}
