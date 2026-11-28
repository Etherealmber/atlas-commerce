import { scopedKey } from './dataScope';
import { AppError } from './errors';

export class SchemaBusyError extends AppError {
  constructor(readonly migration: string = 'unknown', readonly phase: string = 'unknown', readonly age: string = 'unknown') {
    super('SERVICE_UNAVAILABLE', 'Initialisation en cours. Réessayez dans quelques instants.');
  }
}
/**
 * Shared idempotent schema helpers.
 *
 * Why PRAGMA-first: Cloudflare observability records every failing D1
 * statement as an error span at the binding layer — a JS try/catch around
 * `ALTER TABLE … ADD COLUMN` silences the exception but still produces
 * `duplicate column name: SQLITE_ERROR` error events on each fresh isolate.
 * Checking PRAGMA table_info first means the failing ALTER is never issued.
 */
const _schemaOnce = new Set<string>();

const _sessionToRootDb = new WeakMap<object, object>();
const _dbSchemaDone = new WeakMap<object, Set<string>>();
// These legacy migrations can rebuild tables and must never run concurrently
// within an isolate. Only a marker is shared, never an I/O promise.
const _exclusiveDbSchema = new WeakMap<object, Map<string, { started: number; phase: string }>>();
const EXCLUSIVE_SCHEMA_KEYS = new Set(['auto_sql_migrations_0013_0020', 'offline_ops_schema_v20']);

/** Associate a D1 session object (from `db.withSession(...)`) with its root D1 binding. */
export function registerDbRoot(sessionDb: unknown, rootDb: unknown): void {
  if (sessionDb && typeof sessionDb === 'object' && rootDb && typeof rootDb === 'object' && sessionDb !== rootDb) {
    _sessionToRootDb.set(sessionDb, rootDb);
  }
}

export function resolveRootDb(db: unknown): object | null {
  if (!db || typeof db !== 'object') return null;
  return _sessionToRootDb.get(db) || db;
}

/** Cache completed initialization only. Never retain request-bound I/O promises
 * across Worker requests: an abandoned request can leave those promises unable
 * to settle. Initializers must tolerate concurrent execution. */
export async function schemaOnce(rawKey: string, fn: () => Promise<void>): Promise<void> {
  const key = scopedKey(rawKey);
  if (_schemaOnce.has(key)) return;
  await fn();
  _schemaOnce.add(key);
}

/** Record only a fixed migration stage, never SQL, user input, or data. */
export function setAutoMigrationPhase(db: D1Database, phase: 'offline' | 'cash' | 'attendance' | 'payroll' | 'accounting' | 'dunning' | 'dgi'): void {
  const root = resolveRootDb(db);
  const owner = root && _exclusiveDbSchema.get(root)?.get('auto_sql_migrations_0013_0020');
  if (owner) owner.phase = phase;
}

/** Cache completed initialization per binding, not pending request promises. */
export async function schemaOnceForDb(db: D1Database, key: string, fn: () => Promise<void>): Promise<void> {
  const root = resolveRootDb(db);
  if (!root || typeof (db as any).prepare !== 'function') return;
  if (_dbSchemaDone.get(root)?.has(key)) return;
  let active: Map<string, { started: number; phase: string }> | undefined;
  if (EXCLUSIVE_SCHEMA_KEYS.has(key)) {
    active = _exclusiveDbSchema.get(root);
    if (!active) { active = new Map(); _exclusiveDbSchema.set(root, active); }
    // Wait using timers owned by this request, never the other request's I/O.
    // A bounded wait avoids hanging forever if the initializing request died;
    // fail closed rather than overlap a potentially destructive rebuild.
    for (let i = 0; active.has(key) && i < 150; i++) {
      await new Promise<void>(resolve => setTimeout(resolve, 20));
    }
    if (_dbSchemaDone.get(root)?.has(key)) return;
    const owner = active.get(key);
    if (owner) {
      const ageMs = Math.max(0, Date.now() - owner.started);
      const age = ageMs < 10_000 ? 'under_10s' : ageMs < 60_000 ? '10s_to_1m' : ageMs < 300_000 ? '1m_to_5m' : 'over_5m';
      throw new SchemaBusyError(key, owner.phase, age);
    }
    active.set(key, { started: Date.now(), phase: 'starting' });
  }
  try {
    await fn();
    let done = _dbSchemaDone.get(root);
    if (!done) { done = new Set<string>(); _dbSchemaDone.set(root, done); }
    done.add(key);
  } finally {
    active?.delete(key);
  }
}

/**
 * Known columns per table, per root D1 binding (lower-case names). Many routes
 * call `addColumnIfMissing` outside `schemaOnce`, so without this every
 * request paid a `PRAGMA table_info` (billed as rows read) per column checked.
 * Only positive knowledge is cached: a missing table is re-checked next time.
 */
const _knownColumns = new WeakMap<object, Map<string, Set<string>>>();

function knownColumnsFor(db: unknown): Map<string, Set<string>> | null {
  const root = resolveRootDb(db);
  if (!root) return null;
  let m = _knownColumns.get(root);
  if (!m) {
    m = new Map();
    _knownColumns.set(root, m);
  }
  return m;
}

/** Forget cached schema knowledge (after a restore / table rebuild). */
export function resetSchemaCaches(db?: unknown): void {
  const root = db ? resolveRootDb(db) : null;
  if (root) {
    _knownColumns.delete(root);
    _knownTables.delete(root);
  }
}

const _knownTables = new WeakMap<object, Set<string>>();

/**
 * Forget what is known about one table (after a `CREATE … _v2` + `RENAME`
 * rebuild): its column list changed, so the next `addColumnIfMissing` must
 * re-read `PRAGMA table_info` instead of trusting the old set.
 */
export function forgetTableSchema(db: unknown, table: string): void {
  const root = db ? resolveRootDb(db) : null;
  if (!root) return;
  _knownColumns.get(root)?.delete(table);
  _knownTables.get(root)?.delete(table);
}

/**
 * `true` when `table` exists. Positive answers are cached per root binding, so
 * the `sqlite_master` scan (one row read per schema object) happens once per
 * isolate instead of on every request.
 */
export async function tableExists(db: D1Database, table: string): Promise<boolean> {
  const root = resolveRootDb(db);
  const name = String(table || '');
  if (root && _knownTables.get(root)?.has(name)) return true;
  const row = await db.prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`).bind(name).first();
  if (row && root) {
    let set = _knownTables.get(root);
    if (!set) {
      set = new Set();
      _knownTables.set(root, set);
    }
    set.add(name);
  }
  return Boolean(row);
}

/**
 * Column names of `table` (lower-case), memoised per root D1 binding and
 * shared with `addColumnIfMissing` (which keeps the set current when it adds
 * a column). Hot read paths — the product list, barcode scan — only use this
 * to pick OPTIONAL columns, so after the first call they no longer pay a
 * `PRAGMA table_info` per request. `null` when the table is missing or the
 * PRAGMA failed (nothing cached: the next call re-checks).
 */
export async function knownTableColumns(db: D1Database, table: string): Promise<Set<string> | null> {
  if (!db || typeof (db as any).prepare !== 'function') return null;
  const known = knownColumnsFor(db);
  const hit = known?.get(table);
  if (hit) return hit;
  try {
    const info = await db.prepare(`PRAGMA table_info(${table})`).all();
    const rows = (info?.results || []) as { name?: string }[];
    if (!rows.length) return null;
    const set = new Set(rows.map((r) => String(r.name || '').toLowerCase()));
    known?.set(table, set);
    return set;
  } catch {
    return null;
  }
}

export async function addColumnIfMissing(
  db: D1Database,
  table: string,
  column: string,
  typeSql: string,
): Promise<void> {
  if (!db || typeof (db as any).prepare !== 'function') return;
  const col = column.toLowerCase();
  const known = knownColumnsFor(db);
  const cols = known?.get(table);
  if (cols?.has(col)) return;
  if (!cols) {
    try {
      const stmt = db.prepare(`PRAGMA table_info(${table})`);
      if (!stmt) return;
      const info = await stmt.all();
      const rows = (info?.results || []) as { name?: string }[];
      if (rows.length > 0) {
        const set = new Set(rows.map((r) => String(r.name || '').toLowerCase()));
        known?.set(table, set);
        if (set.has(col)) return;
      } else {
        // Avoid issuing ALTER TABLE on a table that does not exist yet (zero D1 error spans).
        const tbl = await db
          .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`)
          ?.bind(table)
          ?.first();
        if (!tbl) return;
      }
    } catch {
      /* pragma may fail on some bindings — fall through to guarded ALTER */
    }
  }
  try {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeSql}`)?.run();
    known?.get(table)?.add(col);
  } catch (e: any) {
    const msg = String(e?.message || e || '');
    if (/duplicate column name/i.test(msg) || /already exists/i.test(msg)) {
      known?.get(table)?.add(col);
      return;
    }
    /* schema drift is non-fatal — swallow */
  }
}
