import { addColumnIfMissing, forgetTableSchema, schemaOnceForDb } from './schema';
import { enqueue } from './job-queue';

const IDEMPOTENCY_TTL_DAYS = 7;

function getExecCtx(c: any): { waitUntil: (p: Promise<unknown>) => void } | undefined {
  try {
    return c?.executionCtx;
  } catch {
    return undefined;
  }
}

export async function ensureOfflineOpsSchema(db: D1Database): Promise<void> {
  await schemaOnceForDb(db, 'offline_ops_schema_v20', async () => {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS offline_idempotency (
          key          TEXT NOT NULL,
          account_id   TEXT NOT NULL DEFAULT 'default',
          device_id    TEXT NOT NULL DEFAULT '',
          kind         TEXT NOT NULL DEFAULT '',
          op           TEXT NOT NULL DEFAULT '',
          request_hash TEXT NOT NULL,
          status       INTEGER NOT NULL,
          response     TEXT NOT NULL,
          created_at   TEXT NOT NULL,
          PRIMARY KEY (account_id, key)
        )`,
      )
      .run();

    // Auto-upgrade older 0013 table shape (missing account_id or single-column PK on key)
    try {
      const info = await db.prepare(`PRAGMA table_info(offline_idempotency)`).all();
      const rows = (info.results || []) as Array<{ name?: string; pk?: number }>;
      if (rows.length > 0) {
        const cols = new Set(rows.map((r) => String(r.name)));
        const accountPk = Number(rows.find((r) => String(r.name) === 'account_id')?.pk || 0);
        const keyPk = Number(rows.find((r) => String(r.name) === 'key')?.pk || 0);
        if (!cols.has('account_id') || accountPk === 0 || keyPk === 0) {
          const accountExpr = cols.has('account_id') ? `COALESCE(NULLIF(account_id, ''), 'default')` : `'default'`;
          const kindExpr = cols.has('kind') ? `COALESCE(NULLIF(kind, ''), op, '')` : `COALESCE(op, '')`;
          await db
            .prepare(
              `CREATE TABLE IF NOT EXISTS offline_idempotency_v2 (
                key          TEXT NOT NULL,
                account_id   TEXT NOT NULL DEFAULT 'default',
                device_id    TEXT NOT NULL DEFAULT '',
                kind         TEXT NOT NULL DEFAULT '',
                op           TEXT NOT NULL DEFAULT '',
                request_hash TEXT NOT NULL,
                status       INTEGER NOT NULL,
                response     TEXT NOT NULL,
                created_at   TEXT NOT NULL,
                PRIMARY KEY (account_id, key)
              )`,
            )
            .run();
          await db
            .prepare(
              `INSERT OR IGNORE INTO offline_idempotency_v2 (key, account_id, device_id, kind, op, request_hash, status, response, created_at)
               SELECT key, ${accountExpr}, COALESCE(device_id, ''), ${kindExpr}, COALESCE(op, ''), request_hash, status, response, created_at FROM offline_idempotency`,
            )
            .run();
          await db.prepare(`DROP TABLE offline_idempotency`).run();
          await db.prepare(`ALTER TABLE offline_idempotency_v2 RENAME TO offline_idempotency`).run();
          forgetTableSchema(db, 'offline_idempotency');
        } else if (!cols.has('kind')) {
          await addColumnIfMissing(db, 'offline_idempotency', 'kind', `TEXT NOT NULL DEFAULT ''`);
        }
      }
    } catch {
      /* */
    }

    await db
      .prepare(`CREATE INDEX IF NOT EXISTS idx_offline_idem_created ON offline_idempotency(created_at)`)
      .run();

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS stock_location_revisions (
          product_id  INTEGER NOT NULL,
          location_id INTEGER NOT NULL,
          revision    INTEGER NOT NULL DEFAULT 1,
          updated_at  TEXT NOT NULL,
          PRIMARY KEY (product_id, location_id)
        )`,
      )
      .run();

    // Auto-upgrade older 0013 TEXT keys on stock_location_revisions -> INTEGER keys
    try {
      const revInfo = await db.prepare(`PRAGMA table_info(stock_location_revisions)`).all();
      const revCols = (revInfo.results || []) as Array<{ name?: string; type?: string }>;
      if (revCols.length > 0) {
        const pidType = String(revCols.find((r) => String(r.name) === 'product_id')?.type || '').toUpperCase();
        const lidType = String(revCols.find((r) => String(r.name) === 'location_id')?.type || '').toUpperCase();
        if (pidType !== 'INTEGER' || lidType !== 'INTEGER') {
          await db
            .prepare(
              `CREATE TABLE IF NOT EXISTS stock_location_revisions_v2 (
                product_id  INTEGER NOT NULL,
                location_id INTEGER NOT NULL,
                revision    INTEGER NOT NULL DEFAULT 1,
                updated_at  TEXT NOT NULL,
                PRIMARY KEY (product_id, location_id)
              )`,
            )
            .run();
          await db
            .prepare(
              `INSERT OR IGNORE INTO stock_location_revisions_v2 (product_id, location_id, revision, updated_at)
               SELECT CAST(product_id AS INTEGER), CAST(location_id AS INTEGER), revision, updated_at
               FROM stock_location_revisions
               WHERE CAST(product_id AS INTEGER) > 0 AND CAST(location_id AS INTEGER) > 0`,
            )
            .run();
          await db.prepare(`DROP TABLE stock_location_revisions`).run();
          await db.prepare(`ALTER TABLE stock_location_revisions_v2 RENAME TO stock_location_revisions`).run();
          forgetTableSchema(db, 'stock_location_revisions');
        }
      }
    } catch {
      /* */
    }

    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS stock_movements (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          product_id INTEGER NOT NULL,
          type TEXT DEFAULT '',
          quantity REAL DEFAULT 0,
          previous_quantity REAL DEFAULT 0,
          new_quantity REAL DEFAULT 0,
          reason TEXT DEFAULT '',
          reference TEXT DEFAULT '',
          created_by TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now'))
        )`,
      )
      .run();
    await addColumnIfMissing(db, 'stock_movements', 'location_id', 'TEXT');
    await addColumnIfMissing(db, 'stock_movements', 'device_id', 'TEXT');
    await addColumnIfMissing(db, 'stock_movements', 'client_ts', 'TEXT');
    await addColumnIfMissing(db, 'stock_movements', 'client_occurred_at', 'TEXT');
  });
}

/**
 * Single helper to bump stock_location_revisions for (product_id, location_id).
 * Pushes the upsert statement onto `batch` when provided, otherwise executes immediately.
 */
export async function bumpPlacementRevision(
  db: D1Database,
  batch: D1PreparedStatement[] | null | undefined,
  pid: number | string,
  loc: number | string,
): Promise<void> {
  const productId = Number(pid);
  const locationId = Number(loc);
  if (!Number.isInteger(productId) || productId <= 0 || !Number.isInteger(locationId) || locationId <= 0) return;
  await ensureOfflineOpsSchema(db);
  const stmt = db
    .prepare(
      `INSERT INTO stock_location_revisions (product_id, location_id, revision, updated_at)
       VALUES (?, ?, 1, datetime('now'))
       ON CONFLICT(product_id, location_id) DO UPDATE SET
         revision = stock_location_revisions.revision + 1,
         updated_at = datetime('now')`,
    )
    .bind(productId, locationId);
  if (batch) {
    batch.push(stmt);
  } else {
    await stmt.run();
  }
}

function normalizeValue(val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return null;
    return Object.is(val, -0) ? 0 : Number(val);
  }
  if (typeof val === 'boolean' || typeof val === 'string') return val;
  if (Array.isArray(val)) return val.map(normalizeValue);
  if (typeof val === 'object') {
    const src = val as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) {
      if (src[k] === undefined) continue;
      out[k] = normalizeValue(src[k]);
    }
    return out;
  }
  return String(val);
}

/** Deterministic JSON representation with sorted keys and normalized numbers. */
export function canonicalJson(val: unknown): string {
  return JSON.stringify(normalizeValue(val));
}

export async function hashCanonicalPayload(val: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(val));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Purge offline_idempotency rows older than 7 days (safe background cleanup). */
export async function purgeExpiredOfflineIdempotency(db: D1Database): Promise<number> {
  await ensureOfflineOpsSchema(db);
  const res = await db
    .prepare(`DELETE FROM offline_idempotency WHERE datetime(created_at) < datetime('now', ?)`)
    .bind(`-${IDEMPOTENCY_TTL_DAYS} days`)
    .run();
  return Number(res.meta?.changes || 0);
}

export function scheduleOfflineIdempotencyPurge(
  ctx: { waitUntil: (p: Promise<unknown>) => void } | undefined,
  db: D1Database,
): void {
  enqueue(ctx, () => purgeExpiredOfflineIdempotency(db));
}

export interface IdempotentHandlerResult {
  status: number;
  body: unknown;
  /** Optional D1 statements to commit atomically with the offline_idempotency INSERT. */
  statements?: D1PreparedStatement[];
  /** Set false if the response is a non-applied conflict/validation error that should not reserve the key. */
  persist?: boolean;
}

interface WithIdempotencyOptions {
  kind?: string;
  op?: string;
  accountId?: string;
  deviceId?: string;
  payload?: unknown;
  handler: (ctx: {
    key: string;
    accountId: string;
    requestHash: string;
    kind: string;
    payload: unknown;
  }) => Promise<IdempotentHandlerResult>;
}

export function resolveAccountIdFromContext(c: any, explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.trim().slice(0, 128);
  const fromCtx = c?.get?.('accountId') ?? c?.get?.('user')?.account_id;
  if (fromCtx && String(fromCtx).trim()) return String(fromCtx).trim().slice(0, 128);
  return 'default';
}

function withReplayedFlag(storedJson: string): string {
  try {
    const parsed = JSON.parse(storedJson);
    if (parsed && typeof parsed === 'object') {
      if (parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)) {
        parsed.data.replayed = true;
      } else {
        parsed.replayed = true;
      }
      return JSON.stringify(parsed);
    }
  } catch {
    /* */
  }
  return storedJson;
}

/**
 * Request-level idempotency wrapper:
 * - Requires Idempotency-Key header (missing -> 400 MISSING_IDEMPOTENCY_KEY)
 * - Scoped by (account_id, key) from the authenticated session (never client body)
 * - Same (account_id, key) + same canonical payload SHA-256 -> replay stored status/body with replayed:true + Idempotent-Replay: true
 * - Same (account_id, key) + different payload -> 409 IDEMPOTENCY_KEY_REUSED
 * - Persists offline_idempotency row in the SAME D1 batch() as handler statements
 */
export async function withIdempotency(c: any, opts: WithIdempotencyOptions): Promise<Response> {
  const key = String(c.req.header('Idempotency-Key') || '').trim();
  if (!key) {
    return c.json(
      {
        success: false,
        code: 'MISSING_IDEMPOTENCY_KEY',
        error: 'En-tête Idempotency-Key requis.',
      },
      400,
    );
  }
  const db: D1Database = c.env.DB;
  await ensureOfflineOpsSchema(db);

  const accountId = resolveAccountIdFromContext(c, opts.accountId);
  const kind = String(opts.kind || opts.op || 'offline-operation');

  let payload = opts.payload;
  if (payload === undefined) {
    payload = await c.req.json().catch(() => ({}));
  }
  const requestHash = await hashCanonicalPayload(payload);

  const existing = (await db
    .prepare(`SELECT request_hash, status, response FROM offline_idempotency WHERE account_id = ? AND key = ?`)
    .bind(accountId, key)
    .first()) as { request_hash: string; status: number; response: string } | null;

  if (existing) {
    if (existing.request_hash !== requestHash) {
      return c.json(
        {
          success: false,
          code: 'IDEMPOTENCY_KEY_REUSED',
          error: 'Clé d’idempotence déjà utilisée avec une charge différente.',
        },
        409,
      );
    }
    return new Response(withReplayedFlag(existing.response), {
      status: Number(existing.status || 200),
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Idempotent-Replay': 'true',
      },
    });
  }

  const result = await opts.handler({ key, accountId, requestHash, kind, payload });
  const responseJson = JSON.stringify(result.body);
  const shouldPersist = result.persist !== false && result.status >= 200 && result.status < 500;
  const stmts = Array.isArray(result.statements) ? [...result.statements] : [];

  if (shouldPersist) {
    const deviceId = String(opts.deviceId || (payload as any)?.device_id || 'unknown').slice(0, 128);
    const nowIso = new Date().toISOString();
    stmts.push(
      db
        .prepare(
          `INSERT INTO offline_idempotency (key, account_id, device_id, kind, op, request_hash, status, response, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(key, accountId, deviceId, kind, kind, requestHash, result.status, responseJson, nowIso),
    );
  }

  if (stmts.length > 0) {
    await db.batch(stmts);
  }

  scheduleOfflineIdempotencyPurge(getExecCtx(c), db);
  return new Response(responseJson, {
    status: result.status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function buildIdempotencyInsertStmt(
  db: D1Database,
  params: {
    key: string;
    accountId?: string;
    deviceId: string;
    kind?: string;
    op: string;
    requestHash: string;
    status: number;
    responseJson: string;
    createdAt?: string;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO offline_idempotency (key, account_id, device_id, kind, op, request_hash, status, response, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.key,
      params.accountId || 'default',
      params.deviceId,
      params.kind || params.op,
      params.op,
      params.requestHash,
      params.status,
      params.responseJson,
      params.createdAt || new Date().toISOString(),
    );
}
