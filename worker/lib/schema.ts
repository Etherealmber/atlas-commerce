/**
 * Shared idempotent schema helpers.
 *
 * Why PRAGMA-first: Cloudflare observability records every failing D1
 * statement as an error span at the binding layer — a JS try/catch around
 * `ALTER TABLE … ADD COLUMN` silences the exception but still produces
 * `duplicate column name: SQLITE_ERROR` error events on each fresh isolate.
 * Checking PRAGMA table_info first means the failing ALTER is never issued.
 */
export async function addColumnIfMissing(
  db: D1Database,
  table: string,
  column: string,
  typeSql: string,
): Promise<void> {
  try {
    const info = await db.prepare(`PRAGMA table_info(${table})`).all();
    const rows = (info?.results || []) as { name?: string }[];
    if (rows.some((r) => String(r.name || '').toLowerCase() === column.toLowerCase())) {
      return;
    }
  } catch {
    /* pragma may fail on some bindings — fall through to guarded ALTER */
  }
  try {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeSql}`).run();
  } catch (e: any) {
    const msg = String(e?.message || e || '');
    if (/duplicate column name/i.test(msg) || /already exists/i.test(msg)) return;
    /* schema drift is non-fatal — swallow */
  }
}
