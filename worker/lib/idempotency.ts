import { addColumnIfMissing } from './schema';
import { enqueue } from './job-queue';

const IDEMPOTENCY_TTL_DAYS = 7;
const _initializedDbs = new WeakSet<object>();

function getExecCtx(c: any): { waitUntil: (p: Promise<unknown>) => void } | undefined {
  try {
    return c?.executionCtx;
  } catch {
    return undefined;
  }
}

export async function ensureOfflineOpsSchema(db: D1Database): Promise<void> {
  if (_initializedDbs.has(db as unknown as object)) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS offline_idempotency (
        key          TEXT PRIMARY KEY,
        device_id    TEXT NOT NULL,
        op           TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        status       INTEGER NOT NULL,
        response     TEXT NOT NULL,
        created_at   TEXT NOT NULL
      )`,
    )
    .run();
  await db
    .prepare(`CREATE INDEX IF NOT EXISTS idx_offline_idem_created ON offline_idempotency(created_at)`)
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS stock_location_revisions (
        product_id  TEXT NOT NULL,
        location_id TEXT NOT NULL,
        revision    INTEGER NOT NULL DEFAULT 1,
        updated_at  TEXT NOT NULL,
        PRIMARY KEY (product_id, location_id)
      )`,
    )
    .run();
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
  _initializedDbs.add(db as unknown as object);
}

function normalizeValue(val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return null;
    // Canonicalize -0 and decimal precision (e.g. 12.0 -> 12)
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

export interface WithIdempotencyOptions {
  op: string;
  deviceId?: string;
  payload?: unknown;
  handler: (ctx: { key: string; requestHash: string; op: string; payload: unknown }) => Promise<IdempotentHandlerResult>;
}

/**
 * Request-level idempotency wrapper:
 * - Requires Idempotency-Key header (missing -> 400 MISSING_IDEMPOTENCY_KEY)
 * - Same key + same canonical payload SHA-256 -> replay stored status/body + Idempotent-Replay: true
 * - Same key + different payload -> 409 IDEMPOTENCY_MISMATCH
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

  let payload = opts.payload;
  if (payload === undefined) {
    payload = await c.req.json().catch(() => ({}));
  }
  const requestHash = await hashCanonicalPayload(payload);

  const existing = (await db
    .prepare(`SELECT request_hash, status, response FROM offline_idempotency WHERE key = ?`)
    .bind(key)
    .first()) as { request_hash: string; status: number; response: string } | null;

  if (existing) {
    if (existing.request_hash !== requestHash) {
      return c.json(
        {
          success: false,
          code: 'IDEMPOTENCY_MISMATCH',
          error: 'Clé d’idempotence déjà utilisée avec une charge différente.',
        },
        409,
      );
    }
    return new Response(existing.response, {
      status: Number(existing.status || 200),
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Idempotent-Replay': 'true',
      },
    });
  }

  const result = await opts.handler({ key, requestHash, op: opts.op, payload });
  const responseJson = JSON.stringify(result.body);
  const shouldPersist = result.persist !== false && result.status >= 200 && result.status < 500;
  const stmts = Array.isArray(result.statements) ? [...result.statements] : [];

  if (shouldPersist) {
    const deviceId = String(opts.deviceId || (payload as any)?.device_id || 'unknown').slice(0, 128);
    const nowIso = new Date().toISOString();
    stmts.push(
      db
        .prepare(
          `INSERT INTO offline_idempotency (key, device_id, op, request_hash, status, response, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(key, deviceId, opts.op, requestHash, result.status, responseJson, nowIso),
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
    deviceId: string;
    op: string;
    requestHash: string;
    status: number;
    responseJson: string;
    createdAt?: string;
  },
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO offline_idempotency (key, device_id, op, request_hash, status, response, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      params.key,
      params.deviceId,
      params.op,
      params.requestHash,
      params.status,
      params.responseJson,
      params.createdAt || new Date().toISOString(),
    );
}
