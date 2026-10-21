/**
 * Reliability toolkit for Atlas Worker (Cloudflare edge).
 *
 * What Cloudflare already provides (no extra code):
 * - Global anycast load balancing across PoPs
 * - CDN for static assets (Workers Assets + R2 custom domain)
 * - D1 managed replication within a region (platform-level)
 *
 * What this module adds in-app:
 * - Circuit breaker (via circuit-breaker.ts)
 * - Timeouts + retries (via http-client.ts)
 * - Cache-aside reads (via cache.ts)
 * - In-isolate job queue + optional Cloudflare Queues binding
 * - Stronger product search (FTS5 when available, LIKE fallback)
 * - Backup helpers (R2 encrypted dumps — see admin backup routes)
 * - Shard key helper for future multi-DB tenancy
 */

import type { Env } from '../env';
import { circuitAllow, circuitFailure, circuitSuccess } from './circuit-breaker';
import { fetchWithTimeout, type HttpClientOptions } from './http-client';
import { AppError } from './errors';

/* ── External call with circuit + timeout + retries ───────────────── */

export async function reliableFetch(
  name: string,
  url: string,
  opts: HttpClientOptions = {},
): Promise<Response> {
  if (!circuitAllow(name)) {
    throw new AppError('SERVICE_UNAVAILABLE', `Service ${name} temporairement coupé`);
  }
  try {
    const res = await fetchWithTimeout(url, {
      timeoutMs: opts.timeoutMs ?? 12_000,
      retries: opts.retries ?? 1,
      label: name,
      ...opts,
    });
    if (res.status >= 500) {
      circuitFailure(name);
    } else {
      circuitSuccess(name);
    }
    return res;
  } catch (e) {
    circuitFailure(name);
    throw e;
  }
}

/* ── In-isolate message queue (best-effort, per isolate) ──────────── */

type Job = { id: string; type: string; payload: unknown; enqueuedAt: number };
const localQueue: Job[] = [];
const MAX_LOCAL = 200;

export function enqueueLocal(type: string, payload: unknown): string {
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  if (localQueue.length >= MAX_LOCAL) localQueue.shift();
  localQueue.push({ id, type, payload, enqueuedAt: Date.now() });
  return id;
}

export function drainLocal(max = 20): Job[] {
  return localQueue.splice(0, max);
}

/** Prefer Cloudflare Queues when bound; else local buffer. */
export async function enqueueMessage(
  env: Env & { QUEUE?: { send: (body: unknown) => Promise<void> } },
  type: string,
  payload: unknown,
): Promise<{ id: string; backend: 'cloudflare_queue' | 'local' }> {
  const body = { type, payload, ts: Date.now() };
  if (env.QUEUE && typeof env.QUEUE.send === 'function') {
    await env.QUEUE.send(body);
    return { id: `cq-${body.ts}`, backend: 'cloudflare_queue' };
  }
  const id = enqueueLocal(type, payload);
  return { id, backend: 'local' };
}

/* ── Shard key (future multi-tenant / multi-D1) ───────────────────── */

/**
 * Deterministic shard id for a tenant or entity key.
 * With a single D1 binding today, always returns 0.
 * When multiple D1s are bound (DB_0, DB_1, …), route by shardId.
 */
export function shardIdFor(key: string, shardCount = 1): number {
  if (shardCount <= 1) return 0;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % shardCount;
}

export function dbForShard(env: Env, shardId: number): D1Database {
  const multi = (env as any)[`DB_${shardId}`] as D1Database | undefined;
  return multi || env.DB;
}

/* ── Read path: prefer cache, then D1 ─────────────────────────────── */

export type ReadOptions = {
  cacheKey?: string;
  ttlSec?: number;
  /** If true, skip cache (force primary) */
  primary?: boolean;
};

/**
 * Note: D1 does not expose a separate read-replica binding in free tier.
 * Cache (memory + KV) acts as the read-acceleration layer.
 * Platform-level D1 replication is handled by Cloudflare.
 */

/* ── Search index bootstrap (FTS5) ────────────────────────────────── */

let ftsReady: boolean | null = null;

/** Ensure products_fts exists (FTS5). Safe to call often. */
export async function ensureProductSearchIndex(db: D1Database): Promise<boolean> {
  if (ftsReady === true) return true;
  try {
    await db
      .prepare(
        `CREATE VIRTUAL TABLE IF NOT EXISTS products_fts USING fts5(
          name, sku, barcode, category, variant_label,
          content='products', content_rowid='id'
        )`,
      )
      .run();
    // Triggers to keep FTS in sync
    await db
      .prepare(
        `CREATE TRIGGER IF NOT EXISTS products_fts_ai AFTER INSERT ON products BEGIN
          INSERT INTO products_fts(rowid, name, sku, barcode, category, variant_label)
          VALUES (new.id, new.name, new.sku, new.barcode, new.category, new.variant_label);
        END`,
      )
      .run();
    await db
      .prepare(
        `CREATE TRIGGER IF NOT EXISTS products_fts_ad AFTER DELETE ON products BEGIN
          INSERT INTO products_fts(products_fts, rowid, name, sku, barcode, category, variant_label)
          VALUES ('delete', old.id, old.name, old.sku, old.barcode, old.category, old.variant_label);
        END`,
      )
      .run();
    await db
      .prepare(
        `CREATE TRIGGER IF NOT EXISTS products_fts_au AFTER UPDATE ON products BEGIN
          INSERT INTO products_fts(products_fts, rowid, name, sku, barcode, category, variant_label)
          VALUES ('delete', old.id, old.name, old.sku, old.barcode, old.category, old.variant_label);
          INSERT INTO products_fts(rowid, name, sku, barcode, category, variant_label)
          VALUES (new.id, new.name, new.sku, new.barcode, new.category, new.variant_label);
        END`,
      )
      .run();
    // Seed if empty
    const cnt = await db.prepare(`SELECT count(*) AS n FROM products_fts`).first<{ n: number }>();
    if (!cnt || Number(cnt.n) === 0) {
      await db
        .prepare(
          `INSERT INTO products_fts(rowid, name, sku, barcode, category, variant_label)
           SELECT id, name, sku, barcode, category, variant_label FROM products`,
        )
        .run();
    }
    ftsReady = true;
    return true;
  } catch (e) {
    console.warn('[search-index] FTS unavailable, LIKE fallback', e);
    ftsReady = false;
    if (/SQLITE_CORRUPT|database disk image is malformed/i.test(String((e as any)?.message || e))) {
      void repairProductSearchIndex(db);
    }
    return false;
  }
}

/** FTS5 integrity probe — true when the virtual-table shadow pages are sound. */
export async function checkProductSearchIndex(db: D1Database): Promise<boolean> {
  try {
    await db.prepare(`INSERT INTO products_fts(products_fts, rank) VALUES('integrity-check', 1)`).run();
    return true;
  } catch {
    return false;
  }
}

let repairInFlight: Promise<'rebuilt' | 'recreated' | 'failed'> | null = null;
let lastRepairAt = 0;

/**
 * Self-heal a corrupted products_fts (SQLITE_CORRUPT_VTAB).
 *
 * The FTS index is DERIVED data (content='products'): rebuilding it — or, when
 * the shadow pages are too damaged, dropping triggers + table and letting
 * ensureProductSearchIndex recreate and reseed it — loses no business data.
 * Cooldown + in-flight guard keep a corruption burst from looping repairs.
 */
export function repairProductSearchIndex(
  db: D1Database,
  opts?: { force?: boolean },
): Promise<'rebuilt' | 'recreated' | 'failed'> {
  if (repairInFlight) return repairInFlight;
  if (!opts?.force && Date.now() - lastRepairAt < 60_000) return Promise.resolve('failed');
  repairInFlight = (async () => {
    lastRepairAt = Date.now();
    try {
      try {
        await db.prepare(`INSERT INTO products_fts(products_fts) VALUES('rebuild')`).run();
        console.log('[search-index] products_fts rebuilt from products');
        return 'rebuilt' as const;
      } catch (e) {
        console.error('[search-index] rebuild failed, recreating table', String((e as any)?.message || e).slice(0, 300));
      }
      for (const t of ['products_fts_ai', 'products_fts_ad', 'products_fts_au']) {
        try { await db.prepare(`DROP TRIGGER IF EXISTS ${t}`).run(); } catch { /* */ }
      }
      try { await db.prepare(`DROP TABLE IF EXISTS products_fts`).run(); } catch { /* */ }
      ftsReady = null;
      const ok = await ensureProductSearchIndex(db);
      console.log('[search-index] products_fts recreated:', ok);
      return ok ? ('recreated' as const) : ('failed' as const);
    } catch (e) {
      console.error('[search-index] repair failed', String((e as any)?.message || e).slice(0, 300));
      return 'failed' as const;
    } finally {
      repairInFlight = null;
    }
  })();
  return repairInFlight;
}

/** Stronger product search: FTS5 MATCH when available, else multi-column LIKE. */
export async function searchProducts(
  db: D1Database,
  q: string,
  limit = 50,
): Promise<Record<string, unknown>[]> {
  const query = (q || '').trim().slice(0, 120);
  const lim = Math.min(Math.max(1, limit), 200);
  if (!query) {
    const { results } = await db
      .prepare(
        `SELECT id, name, sku, barcode, quantity, price, category, image_url
         FROM products ORDER BY name ASC LIMIT ?`,
      )
      .bind(lim)
      .all();
    return (results || []) as Record<string, unknown>[];
  }

  const useFts = await ensureProductSearchIndex(db);
  if (useFts) {
    try {
      // Prefix search: token*
      const ftsQuery = query
        .split(/\s+/)
        .filter(Boolean)
        .map((t) => `"${t.replace(/"/g, '')}"*`)
        .join(' ');
      const { results } = await db
        .prepare(
          `SELECT p.id, p.name, p.sku, p.barcode, p.quantity, p.price, p.category, p.image_url
           FROM products_fts f
           JOIN products p ON p.id = f.rowid
           WHERE products_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .bind(ftsQuery, lim)
        .all();
      return (results || []) as Record<string, unknown>[];
    } catch (e) {
      console.warn('[search-index] FTS query failed, LIKE fallback', e);
    }
  }

  const like = `%${query.replace(/[%_]/g, '')}%`;
  const { results } = await db
    .prepare(
      `SELECT id, name, sku, barcode, quantity, price, category, image_url
       FROM products
       WHERE name LIKE ? OR IFNULL(sku,'') LIKE ? OR IFNULL(barcode,'') LIKE ?
          OR IFNULL(category,'') LIKE ? OR IFNULL(variant_label,'') LIKE ?
       ORDER BY name ASC
       LIMIT ?`,
    )
    .bind(like, like, like, like, like, lim)
    .all();
  return (results || []) as Record<string, unknown>[];
}

/* ── Backup / replication status (informational) ──────────────────── */

export function reliabilityStatus(env: Env) {
  return {
    load_balancer: 'cloudflare_anycast',
    cdn: env.CDN_BASE || 'workers_assets_r2',
    circuit_breaker: true,
    cache: { memory: true, kv: !!env.CACHE },
    queues: { local: true, cloudflare: !!(env as any).QUEUE },
    search_index: ftsReady === null ? 'unknown' : ftsReady ? 'fts5' : 'like_fallback',
    read_acceleration: 'kv_memory_cache',
    d1_replication: 'platform_managed',
    sharding: 'single_db_ready_for_multi',
    backups: 'r2_encrypted_30m',
    timeouts_retries: true,
  };
}
