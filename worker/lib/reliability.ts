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
async function checkProductSearchIndex(db: D1Database): Promise<boolean> {
  try {
    await db.prepare(`INSERT INTO products_fts(products_fts, rank) VALUES('integrity-check', 1)`).run();
    return true;
  } catch {
    return false;
  }
}

let repairInFlight: Promise<'rebuilt' | 'recreated' | 'failed'> | null = null;
let lastRepairAt = 0;
let lastFtsProbeAt = 0;

/**
 * Throttled background integrity probe (≤1/5 min per isolate): catches FTS
 * corruption even when no write has hit it yet, and repairs automatically —
 * the app heals itself with zero CLI / zero dashboard action.
 */
export async function proactiveFtsHealth(db: D1Database): Promise<void> {
  const now = Date.now();
  if (now - lastFtsProbeAt < 5 * 60_000) return;
  lastFtsProbeAt = now;
  try {
    const ok = await checkProductSearchIndex(db);
    if (!ok) {
      console.warn('[search-index] integrity-check failed → automatic repair');
      await repairProductSearchIndex(db, { force: true });
    }
  } catch { /* best-effort */ }
}

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
