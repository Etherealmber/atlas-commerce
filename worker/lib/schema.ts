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
const _schemaOnceInflight = new Map<string, Promise<void>>();

const _sessionToRootDb = new WeakMap<object, object>();
const _dbSchemaDone = new WeakMap<object, Set<string>>();
const _dbSchemaInflight = new WeakMap<object, Map<string, Promise<void>>>();

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

export async function schemaOnce(key: string, fn: () => Promise<void>): Promise<void> {
  if (_schemaOnce.has(key)) return;
  const existing = _schemaOnceInflight.get(key);
  if (existing) {
    await existing;
    return;
  }
  const p = (async () => {
    try {
      await fn();
    } finally {
      _schemaOnce.add(key);
      _schemaOnceInflight.delete(key);
    }
  })();
  _schemaOnceInflight.set(key, p);
  await p;
}

/**
 * Run `fn` once per underlying D1 binding (coalescing concurrent cold-start calls),
 * while allowing separate in-memory DBs in tests to each initialize cleanly.
 */
export async function schemaOnceForDb(db: D1Database, key: string, fn: () => Promise<void>): Promise<void> {
  const root = resolveRootDb(db);
  if (!root || typeof (db as any).prepare !== 'function') return;

  let done = _dbSchemaDone.get(root);
  if (done?.has(key)) return;

  let inflightMap = _dbSchemaInflight.get(root);
  const inflight = inflightMap?.get(key);
  if (inflight) {
    await inflight;
    return;
  }

  if (!done) {
    done = new Set<string>();
    _dbSchemaDone.set(root, done);
  }
  if (!inflightMap) {
    inflightMap = new Map<string, Promise<void>>();
    _dbSchemaInflight.set(root, inflightMap);
  }

  const p = (async () => {
    try {
      await fn();
    } finally {
      done!.add(key);
      inflightMap!.delete(key);
    }
  })();
  inflightMap.set(key, p);
  await p;
}

export async function addColumnIfMissing(
  db: D1Database,
  table: string,
  column: string,
  typeSql: string,
): Promise<void> {
  if (!db || typeof (db as any).prepare !== 'function') return;
  try {
    const stmt = db.prepare(`PRAGMA table_info(${table})`);
    if (!stmt) return;
    const info = await stmt.all();
    const rows = (info?.results || []) as { name?: string }[];
    if (rows.some((r) => String(r.name || '').toLowerCase() === column.toLowerCase())) {
      return;
    }
    if (rows.length === 0) {
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
  try {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeSql}`)?.run();
  } catch (e: any) {
    const msg = String(e?.message || e || '');
    if (/duplicate column name/i.test(msg) || /already exists/i.test(msg)) return;
    /* schema drift is non-fatal — swallow */
  }
}
