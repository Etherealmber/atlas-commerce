import type { Hono } from 'hono';
import { afterBusinessMutation } from '../lib/delete-coord';
import { enqueue } from '../lib/job-queue';
import { purgeOldLogs } from '../lib/apiLog';

interface BackupRouteDeps {
  requireOwner: (c: any) => { ok: true; username: string } | { ok: false; response: Response };
  hmacSha256Hex: (secret: string, message: string) => Promise<string>;
  writeAudit: (db: D1Database, entry: any) => Promise<void>;
  purgeAgentConversationsOlderThan: (env: any, days?: number) => Promise<{ deleted: number }>;
}

/** D1 snapshot → R2 every 12 hours (external cron → POST /api/cron/backup-execute), 7-day retention. */
const BACKUP_RETENTION_DAYS = 7;
const BACKUP_CRON_COOLDOWN_SEC = 11.5 * 3600; // 41400s for 12-hour cron cadence
const MIN_KEEP_SNAPSHOTS = 2;
const RESTORE_WORK_MAX_AGE_MS = 24 * 3600_000;

/** Derive AES-256 key from backup secret (ADMIN_BACKUP_TOKEN or BACKUP_ENCRYPTION_KEY). */
async function backupCryptoKey(env: any): Promise<CryptoKey | null> {
  const secret = String(
    (env as any).BACKUP_ENCRYPTION_KEY || (env as any).ADMIN_BACKUP_TOKEN || '',
  ).trim();
  if (!secret) return null;
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('atlas-bkp-v1:' + secret));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

async function gzipBytes(input: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof CompressionStream === 'undefined') return new Uint8Array(input);
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  await writer.write(new Uint8Array(input));
  await writer.close();
  const buf = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(buf);
}

async function gunzipBytes(input: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream unavailable');
  }
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  await writer.write(new Uint8Array(input));
  await writer.close();
  const buf = await new Response(ds.readable).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Compress (gzip) + encrypt plain JSON → binary .abk (ABK2 + IV + AES-GCM ciphertext).
 * Opaque on CDN: no readable JSON if the object is public, 5-10x smaller than raw JSON.
 */
async function encryptBackupBody(
  env: any,
  plainJson: string,
): Promise<{
  ok: true;
  bytes: Uint8Array;
  envelopeJson: string;
  fmt: 'ABK2' | 'ABK1';
  rawBytes: number;
  sha256: string;
} | { ok: false; error: string }> {
  const key = await backupCryptoKey(env);
  if (!key) {
    return { ok: false, error: 'ADMIN_BACKUP_TOKEN (ou BACKUP_ENCRYPTION_KEY) requis pour chiffrer les sauvegardes' };
  }
  const rawU8 = new TextEncoder().encode(plainJson);
  const shaDigest = await crypto.subtle.digest('SHA-256', new Uint8Array(rawU8));
  const sha256 = [...new Uint8Array(shaDigest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const useGzip = typeof CompressionStream !== 'undefined';
  const payloadU8: Uint8Array<ArrayBuffer> = useGzip ? await gzipBytes(rawU8) : new Uint8Array(rawU8);
  const fmt: 'ABK2' | 'ABK1' = useGzip ? 'ABK2' : 'ABK1';
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      payloadU8,
    ),
  );
  // Binary: magic "ABK2" (or "ABK1") (4) + iv (12) + ciphertext
  const magic = new TextEncoder().encode(fmt);
  const bytes = new Uint8Array(4 + 12 + ct.length);
  bytes.set(magic, 0);
  bytes.set(iv, 4);
  bytes.set(ct, 16);
  // Optional download-friendly envelope (never written to public CDN as sole format)
  const envelopeJson = JSON.stringify({
    fmt: 'atlas-backup-enc-v1',
    alg: 'AES-256-GCM',
    iv: b64encode(iv),
    ct: b64encode(ct),
    app: 'atlas-commerce',
    exported_at: new Date().toISOString(),
  });
  return { ok: true, bytes, envelopeJson, fmt, rawBytes: rawU8.length, sha256 };
}

export async function decryptBackupBytes(env: any, data: ArrayBuffer | Uint8Array | string): Promise<any | null> {
  const key = await backupCryptoKey(env);
  // Binary ABK2 (gzip + AES-GCM) or ABK1 (raw UTF-8 + AES-GCM)
  if (typeof data !== 'string') {
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    const isAbk = u8.length > 16 && u8[0] === 0x41 && u8[1] === 0x42 && u8[2] === 0x4b && (u8[3] === 0x31 || u8[3] === 0x32);
    if (isAbk) {
      if (!key) return null;
      try {
        const iv = u8.slice(4, 16);
        const ct = u8.slice(16);
        const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct));
        const raw = u8[3] === 0x32 ? await gunzipBytes(plain) : plain;
        return JSON.parse(new TextDecoder().decode(raw));
      } catch {
        return null;
      }
    }
    // try as text
    data = new TextDecoder().decode(u8);
  }
  const trimmed = String(data || '').trim();
  if (!trimmed) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  // Legacy plaintext
  if (parsed?.tables && typeof parsed.tables === 'object' && !parsed.fmt) {
    return parsed;
  }
  if (parsed?.fmt !== 'atlas-backup-enc-v1' || !parsed.iv || !parsed.ct) {
    return null;
  }
  if (!key) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(b64decode(String(parsed.iv))) },
      key,
      new Uint8Array(b64decode(String(parsed.ct))),
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}

/** @deprecated name kept for callers */
async function decryptBackupBody(env: any, raw: string): Promise<any | null> {
  return decryptBackupBytes(env, raw);
}

const DELETED_ACCOUNTS_CONFIG_KEY = 'deleted_accounts_tombstones';
const V5_INDEX_KEY = 'backups/v5/index.abk';

/** Upload time (ms) of the v5 index — written by every backup run — or 0 when unknown. */
export async function lastBackupRunAt(env: any): Promise<number> {
  try {
    const head = await env?.IMAGES?.head?.(V5_INDEX_KEY);
    const at = head?.uploaded instanceof Date ? head.uploaded.getTime() : Date.parse(String(head?.uploaded || ''));
    return Number.isFinite(at) && at > 0 ? at : 0;
  } catch {
    return 0;
  }
}
const V5_TABLE_PREFIX = 'backups/v5/tables/';
const APPEND_ONLY_BACKUP_TABLES = new Set([
  'stock_movements',
  'audit_log',
  'assist_audit',
  'invoice_payments',
  'bill_payments',
  'idempotency_keys',
  'login_attempts',
]);
const LOG_CAPPED_BACKUP_TABLES = new Set([
  'login_attempts',
  'ip_reputation',
  'idempotency_keys',
  'audit_log',
  'assist_audit',
]);
const ACCOUNT_SCRUB_TABLES = new Set([
  'app_users',
  'trusted_devices',
  'webauthn_credentials',
  'push_tokens',
  'device_push_tokens',
  'mobile_preferences',
  'snake_scores',
  'assist_audit',
  'assist_approval',
  'assist_prop',
  'audit_log',
]);

async function sha256TextHex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function loadDeletedAccountTombstones(db: D1Database | undefined): Promise<string[]> {
  if (!db) return [];
  try {
    const row = (await db
      .prepare(`SELECT value FROM app_config WHERE key = ?`)
      .bind(DELETED_ACCOUNTS_CONFIG_KEY)
      .first()) as { value?: string } | null;
    if (!row?.value) return [];
    const parsed = JSON.parse(String(row.value));
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((u) => String(u || '').trim().toLowerCase()).filter(Boolean))];
  } catch {
    return [];
  }
}

async function recordDeletedAccountTombstone(db: D1Database | undefined, username: string): Promise<void> {
  const clean = String(username || '').trim().toLowerCase();
  if (!db || !clean) return;
  try {
    const existing = await loadDeletedAccountTombstones(db);
    if (existing.includes(clean)) return;
    const next = [...existing, clean].slice(-500);
    await db
      .prepare(
        `INSERT INTO app_config (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .bind(DELETED_ACCOUNTS_CONFIG_KEY, JSON.stringify(next))
      .run();
  } catch {
    /* best effort if app_config absent in minimal test schemas */
  }
}

function scrubAccountFromBackupPayload(
  payload: any,
  usernames: string | string[],
): { payload: any; changed: boolean } {
  const targets = new Set(
    (Array.isArray(usernames) ? usernames : [usernames])
      .map((u) => String(u || '').trim().toLowerCase())
      .filter(Boolean),
  );
  if (!payload || typeof payload !== 'object' || !targets.size) {
    return { payload, changed: false };
  }
  let changed = false;
  if (payload.tables && typeof payload.tables === 'object') {
    for (const tableName of ACCOUNT_SCRUB_TABLES) {
      const rows = payload.tables[tableName];
      if (!Array.isArray(rows) || !rows.length) continue;
      const filtered = rows.filter((row: any) => {
        if (!row || typeof row !== 'object') return true;
        const uname = String(row.username || row.requested_by || '').trim().toLowerCase();
        if (uname && targets.has(uname)) return false;
        if (tableName === 'audit_log') {
          const ent = String(row.entity || '').trim().toLowerCase();
          if (ent && targets.has(ent)) return false;
        }
        return true;
      });
      if (filtered.length !== rows.length) {
        payload.tables[tableName] = filtered;
        changed = true;
      }
    }
  }
  if (Array.isArray(payload.r2_object_keys)) {
    const filteredKeys = payload.r2_object_keys.filter((k: unknown) => {
      const key = String(k || '').toLowerCase();
      for (const u of targets) {
        if (key.startsWith(`agent-chats/v2/${u}/`) || key.startsWith(`agent-chats/${u}/`)) {
          return false;
        }
      }
      return true;
    });
    if (filteredKeys.length !== payload.r2_object_keys.length) {
      payload.r2_object_keys = filteredKeys;
      changed = true;
    }
  }
  return { payload, changed };
}

/**
 * Remove a deleted account from R2 chat transcripts and encrypted backups (latest, v5 incremental chunks,
 * and recent snapshots) and record a tombstone so future backups/restores never re-introduce it.
 */
export async function purgeDeletedAccountFromBackups(
  env: any,
  username: string,
): Promise<{ scrubbed: number; deletedObjects: number }> {
  const clean = String(username || '').trim().toLowerCase();
  if (!clean) return { scrubbed: 0, deletedObjects: 0 };
  await recordDeletedAccountTombstone(env?.DB, clean);
  let scrubbed = 0;
  let deletedObjects = 0;
  if (!env?.IMAGES) return { scrubbed, deletedObjects };

  // 1. Delete encrypted Agent chat transcripts belonging to this user
  const safeUser = clean.replace(/[^a-zA-Z0-9._@-]/g, '_').slice(0, 64);
  for (const prefix of [`agent-chats/v2/${safeUser}/`, `agent-chats/${safeUser}/`, `agent-chats/v2/${clean}/`, `agent-chats/${clean}/`]) {
    try {
      let cursor: string | undefined;
      do {
        const page: any = await env.IMAGES.list({ prefix, cursor, limit: 200 });
        for (const obj of page?.objects || []) {
          try {
            await env.IMAGES.delete(obj.key);
            deletedObjects++;
          } catch { /* */ }
        }
        cursor = page?.truncated ? page.cursor : undefined;
      } while (cursor);
    } catch { /* */ }
  }

  const scrubAbkObject = async (key: string, customType = 'backup_scrubbed'): Promise<boolean> => {
    try {
      const obj = await env.IMAGES.get(key);
      if (!obj) return false;
      const buf = await obj.arrayBuffer();
      const dec = await decryptBackupBytes(env, buf);
      if (!dec) return false;
      const { payload, changed } = scrubAccountFromBackupPayload(dec, clean);
      if (!changed) return false;
      const enc = await encryptBackupBody(env, JSON.stringify(payload));
      if (!enc.ok) return false;
      await env.IMAGES.put(key, enc.bytes, {
        httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store' },
        customMetadata: { type: customType, fmt: 'ABK1' },
      });
      scrubbed++;
      return true;
    } catch {
      return false;
    }
  };

  // 2. Scrub latest pointer + v5 per-table chunks so incremental state never retains the user
  await scrubAbkObject('backups/latest.abk', 'backup_latest_enc');
  for (const tbl of ACCOUNT_SCRUB_TABLES) {
    try {
      const chunkKey = `${V5_TABLE_PREFIX}${tbl}.abk`;
      const obj = await env.IMAGES.get(chunkKey);
      if (!obj) continue;
      const dec = await decryptBackupBytes(env, await obj.arrayBuffer());
      if (!dec || !Array.isArray(dec.rows)) continue;
      const fakePayload = { tables: { [tbl]: dec.rows } };
      const { payload, changed } = scrubAccountFromBackupPayload(fakePayload, clean);
      if (!changed) continue;
      const nextRows = payload.tables[tbl];
      const nextHash = await sha256TextHex(JSON.stringify(nextRows));
      const enc = await encryptBackupBody(env, JSON.stringify({ ...dec, rows: nextRows, hash: nextHash }));
      if (enc.ok) {
        await env.IMAGES.put(chunkKey, enc.bytes, {
          httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store' },
          customMetadata: { type: 'backup_v5_table', fmt: 'ABK1' },
        });
        scrubbed++;
      }
    } catch { /* */ }
  }

  // 3. Scrub recent 30m/pre-revert snapshots and delete older pre-erasure snapshots so no un-scrubbed copies remain
  for (const prefix of ['backups/30m/', 'backups/pre-revert/']) {
    try {
      const allObjs: Array<{ key: string; uploadedMs: number }> = [];
      let cursor: string | undefined;
      do {
        const page: any = await env.IMAGES.list({ prefix, cursor, limit: 500 });
        for (const o of page?.objects || []) {
          if (!String(o?.key || '').endsWith('.abk')) continue;
          allObjs.push({
            key: String(o.key),
            uploadedMs: o.uploaded ? new Date(o.uploaded).getTime() : 0,
          });
        }
        cursor = page?.truncated ? page.cursor : undefined;
      } while (cursor);
      allObjs.sort((a, b) => b.uploadedMs - a.uploadedMs);
      const keepRecent = allObjs.slice(0, 6);
      const purgeOlder = allObjs.slice(6);
      for (const item of keepRecent) {
        await scrubAbkObject(item.key, prefix.includes('pre-revert') ? 'pre_revert_enc' : 'backup_30m_enc');
      }
      for (const item of purgeOlder) {
        try {
          await env.IMAGES.delete(item.key);
          deletedObjects++;
        } catch { /* */ }
      }
    } catch { /* */ }
  }

  // Force next cron backup to re-evaluate cleanly
  try {
    if (env.CACHE) await env.CACHE.delete('g1:backup:last-run');
  } catch { /* */ }
  await afterBusinessMutation(env.CACHE, env.MOBILE_HUB);
  return { scrubbed, deletedObjects };
}

interface V5TableMeta {
  maxId: number;
  hash: string;
  rowCount: number;
}
interface V5BackupIndex {
  version: 5;
  lastFullAt: number;
  r2KeysHash: string;
  tables: Record<string, V5TableMeta>;
}

export async function runDailyBackup(
  env: any,
  opts?: { forceFull?: boolean },
): Promise<{
  ok: boolean;
  key?: string;
  error?: string;
  bytes?: number;
  r2_keys?: number;
  skipped?: boolean;
  changed_tables?: number;
}> {
  try {
    if (!env.IMAGES) return { ok: false, error: 'R2 IMAGES binding missing' };
    // Full snapshot — every business + Atlas table we know about (missing tables are skipped)
    const tables = [
      'products', 'product_images', 'product_categories', 'product_units', 'product_catalog',
      'categories', 'units', 'catalog_settings',
      'clients', 'vendors',
      'invoices', 'invoice_items', 'invoice_payments', 'invoice_ubl_clearance',
      'quotes', 'bills', 'bill_items', 'bill_payments', 'purchase_orders',
      'receipts', 'expenses', 'delivery_notes', 'delivery_note_items',
      'company_settings', 'app_config', 'app_users', 'document_counters', 'audit_log',
      'stock_locations', 'stock_levels', 'stock_movements', 'stock_location_qty',
      'stock_cost_layers', 'warehouse_stock', 'warehouses',
      'mobile_actions', 'reorder_suggestions', 'auto_transfer_rules',
      'assist_audit', 'assist_approval', 'assist_prop',
      'push_tokens', 'webhooks', 'api_keys', 'idempotency_keys',
      'trusted_devices', 'webauthn_credentials',
      // security noise optional but kept for full restore
      'login_attempts', 'ip_reputation',
    ];
    const tombstones = await loadDeletedAccountTombstones(env.DB);
    let prevIndex: V5BackupIndex | null = null;
    if (!opts?.forceFull) {
      try {
        const idxObj = await env.IMAGES.get(V5_INDEX_KEY);
        if (idxObj) {
          const dec = await decryptBackupBytes(env, await idxObj.arrayBuffer());
          if (dec?.version === 5 && dec.tables && typeof dec.tables === 'object') {
            prevIndex = dec as V5BackupIndex;
          }
        }
      } catch {
        prevIndex = null;
      }
    }

    const payload: Record<string, any> = {
      exported_at: new Date().toISOString(),
      version: 2,
      app: 'atlas-commerce',
      tables: {},
      r2_object_keys: [] as string[],
    };
    // Query existing tables dynamically so absent legacy tables don't spam D1 error logs
    const existingTables = new Set<string>();
    try {
      const { results: tblResults } = await env.DB.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table'`,
      ).all();
      for (const r of (tblResults || []) as any[]) {
        if (r?.name) existingTables.add(String(r.name));
      }
    } catch { /* fallback to checking each table */ }

    const nextIndex: V5BackupIndex = {
      version: 5,
      lastFullAt: prevIndex && !opts?.forceFull ? prevIndex.lastFullAt : Date.now(),
      r2KeysHash: '',
      tables: {},
    };
    let changedTables = 0;

    for (const t of tables) {
      if (existingTables.size > 0 && !existingTables.has(t)) {
        payload.tables[t] = { error: 'table_missing_or_skip' };
        continue;
      }
      try {
        const prevMeta = prevIndex?.tables?.[t];
        const logCapped = LOG_CAPPED_BACKUP_TABLES.has(t);
        const isAppendOnly = APPEND_ONLY_BACKUP_TABLES.has(t);
        let rows: any[] | null = null;
        let maxId = 0;

        if (!opts?.forceFull && isAppendOnly && prevMeta) {
          // 1-row O(1) B-tree check: skip full table read when no new rows were appended
          try {
            const probe = (await env.DB.prepare(`SELECT COALESCE(MAX(id), 0) AS max_id FROM ${t}`).first()) as {
              max_id?: number;
            } | null;
            maxId = Number(probe?.max_id || 0);
            const chunkObj = await env.IMAGES.get(`${V5_TABLE_PREFIX}${t}.abk`);
            const chunkDec = chunkObj ? await decryptBackupBytes(env, await chunkObj.arrayBuffer()) : null;
            if (Array.isArray(chunkDec?.rows)) {
              if (maxId === prevMeta.maxId) {
                rows = chunkDec.rows;
              } else if (maxId > prevMeta.maxId) {
                const { results: delta } = await env.DB.prepare(
                  `SELECT * FROM ${t} WHERE id > ? ORDER BY id ASC LIMIT 50000`,
                )
                  .bind(prevMeta.maxId)
                  .all();
                rows = [...chunkDec.rows, ...(delta || [])];
                if (logCapped && rows.length > 5000) rows = rows.slice(-5000);
              }
            }
          } catch {
            rows = null;
          }
        }

        if (rows === null) {
          const sql = logCapped
            ? `SELECT * FROM (SELECT * FROM ${t} ORDER BY id DESC LIMIT 5000) ORDER BY id ASC`
            : `SELECT * FROM ${t} LIMIT 200000`;
          const { results } = await env.DB.prepare(sql).all();
          const fetched: any[] = results || [];
          // Capped logs: newest 5000, returned oldest-first by the outer ORDER BY.
          rows = fetched;
          for (const r of rows) {
            const idNum = Number(r?.id || 0);
            if (idNum > maxId) maxId = idNum;
          }
        }

        let finalRows: any[] = rows ?? [];
        // Apply deleted-account tombstones before hashing or storing
        if (tombstones.length && ACCOUNT_SCRUB_TABLES.has(t) && finalRows.length) {
          const scrubbed = scrubAccountFromBackupPayload({ tables: { [t]: finalRows } }, tombstones);
          finalRows = scrubbed.payload.tables[t];
        }

        payload.tables[t] = finalRows;
        const hash = await sha256TextHex(JSON.stringify(finalRows));
        nextIndex.tables[t] = { maxId, hash, rowCount: finalRows.length };
        if (!prevMeta || prevMeta.hash !== hash) {
          changedTables++;
          const chunkEnc = await encryptBackupBody(env, JSON.stringify({ table: t, maxId, hash, rows: finalRows }));
          if (chunkEnc.ok) {
            await env.IMAGES.put(`${V5_TABLE_PREFIX}${t}.abk`, chunkEnc.bytes, {
              httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store' },
              customMetadata: { type: 'backup_v5_table', table: t, fmt: 'ABK1' },
            });
          }
        }
      } catch {
        payload.tables[t] = { error: 'table_missing_or_skip' };
      }
    }

    // Index of R2 objects (images + prior backups) — not full binary re-copy
    try {
      let cursor: string | undefined;
      let listed = 0;
      do {
        const page: any = await env.IMAGES.list({ cursor, limit: 500, prefix: '' });
        for (const obj of page.objects || []) {
          const objKey = String(obj.key || '');
          if (objKey.startsWith('backups/')) continue; // skip nested backup noise
          if (tombstones.some((u) => objKey.toLowerCase().startsWith(`agent-chats/v2/${u}/`) || objKey.toLowerCase().startsWith(`agent-chats/${u}/`))) {
            continue;
          }
          payload.r2_object_keys.push(objKey);
          listed++;
          if (listed >= 5000) break;
        }
        cursor = page.truncated ? page.cursor : undefined;
        if (listed >= 5000) break;
      } while (cursor);
    } catch { /* */ }

    nextIndex.r2KeysHash = await sha256TextHex(JSON.stringify(payload.r2_object_keys));
    const r2Changed = !prevIndex || prevIndex.r2KeysHash !== nextIndex.r2KeysHash;

    // Persist updated v5 index
    const idxEnc = await encryptBackupBody(env, JSON.stringify(nextIndex));
    if (idxEnc.ok) {
      await env.IMAGES.put(V5_INDEX_KEY, idxEnc.bytes, {
        httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store' },
        customMetadata: { type: 'backup_v5_index', fmt: 'ABK1' },
      });
    }

    // Avoid writing duplicate full .abk snapshots to R2 when nothing changed since last snapshot
    if (!opts?.forceFull && prevIndex && changedTables === 0 && !r2Changed) {
      const latestHead = await env.IMAGES.head('backups/latest.abk').catch(() => null);
      if (latestHead) {
        return {
          ok: true,
          skipped: true,
          changed_tables: 0,
          key: 'backups/latest.abk',
          r2_keys: payload.r2_object_keys.length,
        };
      }
    }

    const plain = JSON.stringify(payload);
    const enc = await encryptBackupBody(env, plain);
    if (!enc.ok) return { ok: false, error: enc.error };
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    const totalRows = Object.values(nextIndex.tables).reduce((acc, m) => acc + (m?.rowCount || 0), 0);
    const tablesCount = Object.keys(nextIndex.tables).length;
    const key = `backups/30m/atlas-${stamp}.abk`;
    await env.IMAGES.put(key, enc.bytes, {
      httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store' },
      customMetadata: {
        type: 'backup_12h_enc',
        version: '5',
        fmt: enc.fmt,
        sha256: enc.sha256,
        raw_bytes: String(enc.rawBytes),
        tables_count: String(tablesCount),
        total_rows: String(totalRows),
      },
    });
    // Latest pointer (encrypted binary) — does not touch unrelated R2 objects
    await env.IMAGES.put('backups/latest.abk', enc.bytes, {
      httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store' },
      customMetadata: {
        type: 'backup_latest_enc',
        version: '5',
        fmt: enc.fmt,
        sha256: enc.sha256,
        raw_bytes: String(enc.rawBytes),
        tables_count: String(tablesCount),
        total_rows: String(totalRows),
        source: key,
      },
    });
    return {
      ok: true,
      skipped: false,
      changed_tables: changedTables,
      key,
      bytes: enc.bytes.length,
      r2_keys: payload.r2_object_keys.length,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'backup failed' };
  }
}


/* ─── Backup / restore HMAC gate + 7-day retention ─── */

function backupTokenFromRequest(c: any): string {
  return String(
    c.req.header('X-Admin-Backup-Token') ||
    c.req.header('x-admin-backup-token') ||
    '',
  ).trim();
}


/**
 * Purge encrypted snapshot + pre-revert backups older than 7 days while always retaining
 * at least MIN_KEEP_SNAPSHOTS newest snapshots in backups/30m/ so quiet weeks never leave 0 history.
 * Also prunes stale backups/restore-work/ scratch objects (>24h). Does not touch unrelated R2 objects.
 */
export const CRON_BACKUP_HUB_NAME = 'cron-backup';

export type CronBackupJob = {
  id: string;
  status: 'queued' | 'running' | 'ok' | 'failed';
  force?: boolean;
  skip_backup?: boolean;
  queued_at: string;
  started_at?: string;
  finished_at?: string;
  attempts?: number;
  result?: Record<string, unknown>;
  error?: string;
};

/**
 * The actual cron work (incremental backup + 7-day purges). Runs inside the
 * RestoreHub Durable Object alarm in production so it is not bound to the
 * 30-second HTTP timeout of the external cron service.
 */
export async function executeCronBackup(
  env: any,
  opts: { force?: boolean; skipBackup?: boolean } = {},
): Promise<{ success: boolean; error?: string; [k: string]: unknown }> {
  const force = Boolean(opts.force);
  let backup: { ok: boolean; key?: string; error?: string; bytes?: number; r2_keys?: number; skipped?: boolean; changed_tables?: number } = {
    ok: true,
    key: opts.skipBackup ? 'backups/latest.abk' : undefined,
    skipped: true,
  };
  if (!opts.skipBackup) {
    backup = await runDailyBackup(env, { forceFull: false });
    if (!backup.ok) {
      console.error('cron_backup_fail', backup.error);
      return { success: false, error: backup.error || 'Backup failed' };
    }
  }
  const backupSkipped = Boolean(opts.skipBackup) || Boolean(backup.skipped);
  let purge = { deleted: 0 };
  try {
    purge = await purgeExpiredBackups(env);
  } catch (e: any) {
    console.error('cron_purge_err', String(e));
  }
  let dbPurge = { purgedRows: 0 };
  if (!backupSkipped || force) {
    try {
      dbPurge = await purgeExpiredDbBackupsState(env.DB);
    } catch (e: any) {
      console.error('cron_db_purge_err', String(e));
    }
  }
  // 30-day retention for the audit and API journals. Idle runs skip it to keep
  // D1 reads flat: every journaled request also triggers an hourly purge.
  let logsPurge = { api: 0, audit: 0 };
  if (env.DB && (!backupSkipped || force)) {
    try { logsPurge = await purgeOldLogs(env.DB); } catch (e: any) { console.error('cron_logs_purge_err', String(e)); }
  }
  console.log('cron_backup_ok', JSON.stringify({ key: backup.key, skipped: backupSkipped, changed_tables: backup.changed_tables ?? 0, purge, dbPurge, logsPurge }));
  return {
    success: true,
    skipped: backupSkipped,
    message: backupSkipped
      ? 'Aucune mutation depuis la dernière sauvegarde — purge 7 j exécutée'
      : 'Backup incrémental compressé + purge backups 7 j + conversations agent >30j',
    timestamp: new Date().toISOString(),
    backup_id: backup.key || null,
    bytes: backup.bytes ?? null,
    changed_tables: backup.changed_tables ?? 0,
    purge_deleted: purge.deleted,
    db_purged_rows: dbPurge.purgedRows,
    logs_purged: logsPurge,
    data: backupSkipped ? null : backup,
  };
}

export async function purgeExpiredBackups(env: any): Promise<{ deleted: number }> {
  if (!env.IMAGES) return { deleted: 0 };
  const nowMs = Date.now();
  const cutoff = nowMs - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const workCutoff = nowMs - RESTORE_WORK_MAX_AGE_MS;
  let deleted = 0;

  // 1. Snapshot backups: keep everything <= 7 days old, and always keep the newest MIN_KEEP_SNAPSHOTS
  {
    const snaps: Array<{ key: string; uploadedMs: number }> = [];
    let cursor: string | undefined;
    do {
      const page: any = await env.IMAGES.list({ prefix: 'backups/30m/', cursor, limit: 500 });
      for (const obj of page.objects || []) {
        const key = String(obj.key || '');
        if (key.endsWith('manifest.json')) {
          try { await env.IMAGES.delete(key); deleted++; } catch { /* */ }
          continue;
        }
        const uploadedMs = obj.uploaded ? new Date(obj.uploaded).getTime() : 0;
        snaps.push({ key, uploadedMs });
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    snaps.sort((a, b) => b.uploadedMs - a.uploadedMs);
    for (let i = MIN_KEEP_SNAPSHOTS; i < snaps.length; i++) {
      const s = snaps[i];
      if (s.uploadedMs && s.uploadedMs < cutoff) {
        try { await env.IMAGES.delete(s.key); deleted++; } catch { /* */ }
      }
    }
  }

  // 2. Pre-revert safety copies older than 7 days
  {
    let cursor: string | undefined;
    do {
      const page: any = await env.IMAGES.list({ prefix: 'backups/pre-revert/', cursor, limit: 500 });
      for (const obj of page.objects || []) {
        const key = String(obj.key || '');
        const uploaded = obj.uploaded ? new Date(obj.uploaded).getTime() : 0;
        if (key.endsWith('manifest.json') || (uploaded && uploaded < cutoff)) {
          try { await env.IMAGES.delete(key); deleted++; } catch { /* */ }
        }
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }

  // 3. Stale restore-work scratch files (>24h)
  try {
    let cursor: string | undefined;
    do {
      const page: any = await env.IMAGES.list({ prefix: 'backups/restore-work/', cursor, limit: 500 });
      for (const obj of page.objects || []) {
        const key = String(obj.key || '');
        const uploaded = obj.uploaded ? new Date(obj.uploaded).getTime() : 0;
        if (uploaded && uploaded < workCutoff) {
          try { await env.IMAGES.delete(key); deleted++; } catch { /* */ }
        }
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  } catch { /* */ }

  // 4. Clean any leftover plain manifests under backups/
  try {
    let cursor: string | undefined;
    do {
      const page: any = await env.IMAGES.list({ prefix: 'backups/', cursor, limit: 500 });
      for (const obj of page.objects || []) {
        const key = String(obj.key || '');
        if (key.includes('manifest.json')) {
          try { await env.IMAGES.delete(key); deleted++; } catch { /* */ }
        }
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  } catch { /* */ }
  return { deleted };
}

/** Purge ephemeral DB operational/security rows older than 7 days (never business records). */
async function purgeExpiredDbBackupsState(db: D1Database | undefined): Promise<{ purgedRows: number }> {
  if (!db) return { purgedRows: 0 };
  let purgedRows = 0;
  for (const sql of [
    `DELETE FROM idempotency_keys WHERE created_at < datetime('now', '-7 days')`,
    `DELETE FROM login_attempts WHERE attempted_at < datetime('now', '-7 days')`,
  ]) {
    try {
      const res: any = await db.prepare(sql).run();
      purgedRows += Number(res?.meta?.changes ?? 0);
    } catch { /* table may not exist or use different column in minimal tests */ }
  }
  return { purgedRows };
}

async function loadBackupJson(env: any, key: string): Promise<any | null> {
  if (!env.IMAGES) return null;
  const obj = await env.IMAGES.get(key);
  if (!obj) return null;
  try {
    const buf = await obj.arrayBuffer();
    return await decryptBackupBytes(env, buf);
  } catch {
    return null;
  }
}

const SAFE_SQL_IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const ALLOWED_RESTORE_TABLES = new Set([
  'products', 'product_images', 'product_categories', 'product_units', 'product_catalog',
  'categories', 'units', 'catalog_settings',
  'clients', 'vendors',
  'invoices', 'invoice_items', 'invoice_payments', 'invoice_ubl_clearance',
  'quotes', 'bills', 'bill_items', 'bill_payments', 'purchase_orders',
  'receipts', 'expenses', 'delivery_notes', 'delivery_note_items',
  'company_settings', 'app_config', 'app_users', 'document_counters', 'audit_log',
  'stock_locations', 'stock_levels', 'stock_movements', 'stock_location_qty',
  'stock_cost_layers', 'warehouse_stock', 'warehouses',
  'mobile_actions', 'reorder_suggestions', 'auto_transfer_rules',
  'assist_audit', 'assist_approval', 'assist_prop',
  'push_tokens', 'webhooks', 'api_keys', 'idempotency_keys',
  'trusted_devices', 'webauthn_credentials',
  'login_attempts', 'ip_reputation',
]);

/** Restore tables from a snapshot payload (best-effort clear+insert per table).
 *  Uses D1 batch() in chunks so large tables do not blow Worker CPU / waitUntil limits
 *  (previous row-by-row await loop often died after product_units ~38%).
 */
export async function restoreFromBackupPayload(
  db: D1Database,
  payload: any,
  onProgress?: (info: { table: string; index: number; total: number; rows: number; message: string; progress: number }) => Promise<void> | void,
): Promise<{ tables: string[]; rows: number }> {
  const tombstones = await loadDeletedAccountTombstones(db);
  const effectivePayload = tombstones.length
    ? scrubAccountFromBackupPayload(structuredClone(payload), tombstones).payload
    : payload;
  const tables = effectivePayload?.tables && typeof effectivePayload.tables === 'object' ? effectivePayload.tables : {};
  // Prefer a stable order so progress is predictable; only allowlisted table names are permitted.
  const preferred = [
    'product_units', 'units', 'categories', 'product_categories', 'product_catalog', 'catalog_settings',
    'warehouses', 'stock_locations',
    'products', 'product_images',
    'clients', 'vendors',
    'invoices', 'invoice_items', 'invoice_payments', 'invoice_ubl_clearance',
    'quotes', 'bills', 'bill_items', 'bill_payments', 'purchase_orders',
    'receipts', 'expenses', 'delivery_notes', 'delivery_note_items',
    'stock_levels', 'stock_movements', 'stock_location_qty', 'stock_cost_layers', 'warehouse_stock',
    'company_settings', 'app_config', 'app_users', 'document_counters',
    'mobile_actions', 'reorder_suggestions', 'auto_transfer_rules',
    'assist_audit', 'assist_approval', 'assist_prop',
    'push_tokens', 'webhooks', 'api_keys', 'idempotency_keys',
    'trusted_devices', 'webauthn_credentials',
    'login_attempts', 'ip_reputation', 'audit_log',
  ];
  const allNames = Object.keys(tables).filter(
    (t) =>
      ALLOWED_RESTORE_TABLES.has(t) &&
      SAFE_SQL_IDENT_RE.test(t) &&
      Array.isArray(tables[t]) &&
      (tables[t] as any[]).length > 0,
  );
  const ordered: string[] = [];
  for (const t of preferred) if (allNames.includes(t)) ordered.push(t);
  for (const t of allNames) if (!ordered.includes(t)) ordered.push(t);

  const total = Math.max(1, ordered.length);
  const restored: string[] = [];
  let rows = 0;
  let index = 0;
  for (const table of ordered) {
    index += 1;
    const data = tables[table] as any[];
    if (!Array.isArray(data) || !data.length) continue;
    const sample = data[0];
    if (!sample || typeof sample !== 'object') continue;
    const rawCols = Object.keys(sample).filter(
      (c) => SAFE_SQL_IDENT_RE.test(c) && c !== '__proto__' && c !== 'constructor' && c !== 'prototype',
    );
    if (!rawCols.length) continue;
    // Skip columns that are pure SQLite rowid aliases if present oddly
    const label = tableLabelFr(table);
    const basePct = Math.min(92, Math.round(20 + (index / total) * 72));
    if (onProgress) {
      try {
        await onProgress({
          table, index, total, rows,
          message: `Restauration « ${label} » (${index}/${total})…`,
          progress: basePct,
        });
      } catch { /* progress must not abort restore */ }
    }

    // Merge mode: do not wipe table — INSERT OR IGNORE skips existing PKs (faster, safer re-run).
    // Verify table exists and intersect columns with real schema via PRAGMA table_info.
    let cols: string[] = [];
    try {
      const info = await db.prepare(`PRAGMA table_info(${table})`).all();
      const realCols = new Set(
        ((info?.results || []) as any[]).map((r) => String(r?.name || '')).filter(Boolean),
      );
      cols = rawCols.filter((c) => realCols.has(c));
      if (!realCols.size || !cols.length) {
        if (onProgress) {
          try {
            await onProgress({
              table, index, total, rows,
              message: `« ${label} » ignoré (table absente)`,
              progress: basePct,
            });
          } catch { /* */ }
        }
        continue;
      }
    } catch {
      if (onProgress) {
        try {
          await onProgress({
            table, index, total, rows,
            message: `« ${label} » ignoré (table absente)`,
            progress: basePct,
          });
        } catch { /* */ }
      }
      continue;
    }

    const colList = cols.join(', ');
    const nCols = cols.length;
    // D1 max ~100 bound params/query → pack as many rows as fit per statement
    const rowsPerStmt = Math.max(1, Math.min(20, Math.floor(100 / Math.max(1, nCols))));
    // Batch of multi-row statements (fewer round-trips)
    const STMT_BATCH = 40;
    let tableRows = 0;

    try {
      // Optional: defer FK checks for speed/safety during bulk merge
      try { await db.prepare('PRAGMA defer_foreign_keys = true').run(); } catch { /* */ }

      for (let i = 0; i < data.length; i += rowsPerStmt * STMT_BATCH) {
        const stmts: D1PreparedStatement[] = [];
        const outerEnd = Math.min(data.length, i + rowsPerStmt * STMT_BATCH);
        for (let j = i; j < outerEnd; j += rowsPerStmt) {
          const slice = data.slice(j, Math.min(j + rowsPerStmt, outerEnd));
          if (!slice.length) continue;
          const valueGroups: string[] = [];
          const vals: any[] = [];
          for (const row of slice) {
            valueGroups.push(`(${cols.map(() => '?').join(',')})`);
            for (const c of cols) {
              const v = row[c];
              vals.push(v === undefined ? null : v);
            }
          }
          try {
            const sql = `INSERT OR IGNORE INTO ${table} (${colList}) VALUES ${valueGroups.join(',')}`;
            stmts.push(db.prepare(sql).bind(...vals));
          } catch {
            /* skip malformed multi-row build */
          }
        }
        if (!stmts.length) continue;
        try {
          const results = await db.batch(stmts);
          for (const r of results) {
            // meta.changes is rows actually inserted (OR IGNORE skips = 0)
            const ch = Number((r as any)?.meta?.changes ?? 0);
            if (ch > 0) {
              tableRows += ch;
              rows += ch;
            } else {
              // still advance progress for ignored rows
              tableRows += 1;
              rows += 1;
            }
          }
        } catch {
          // Fallback: one-by-one for this range if multi-row batch fails
          for (let k = i; k < outerEnd; k++) {
            const row = data[k];
            try {
              const singleVals = cols.map((c) => (row[c] === undefined ? null : row[c]));
              const singleSql = `INSERT OR IGNORE INTO ${table} (${colList}) VALUES (${cols.map(() => '?').join(',')})`;
              await db.prepare(singleSql).bind(...singleVals).run();
              tableRows++;
              rows++;
            } catch { /* skip bad row */ }
          }
        }
        // Mid-table progress so UI does not freeze on large tables
        if (data.length > rowsPerStmt && onProgress && outerEnd < data.length) {
          const frac = Math.min(1, outerEnd / data.length);
          try {
            await onProgress({
              table, index, total, rows,
              message: `Restauration « ${label} »… ${outerEnd}/${data.length}`,
              progress: Math.min(94, basePct + Math.round(frac * 2)),
            });
          } catch { /* */ }
        }
      }
      try { await db.prepare('PRAGMA defer_foreign_keys = false').run(); } catch { /* */ }
      restored.push(table);
      if (onProgress) {
        try {
          await onProgress({
            table, index, total, rows,
            message: `« ${label} » restauré (${tableRows} lignes)`,
            progress: Math.min(96, basePct + 2),
          });
        } catch { /* */ }
      }
    } catch {
      // Whole table failed — continue with remaining tables
      if (onProgress) {
        try {
          await onProgress({
            table, index, total, rows,
            message: `« ${label} » partiel/erreur — suite…`,
            progress: basePct,
          });
        } catch { /* */ }
      }
    }
  }
  return { tables: restored, rows };
}

function tableLabelFr(table: string): string {
  const map: Record<string, string> = {
    products: 'Produits',
    clients: 'Clients',
    vendors: 'Fournisseurs',
    invoices: 'Factures',
    invoice_lines: 'Lignes de facture',
    quotes: 'Devis',
    quote_lines: 'Lignes de devis',
    payments: 'Paiements',
    bills: 'Achats',
    bill_lines: 'Lignes d’achat',
    stock_moves: 'Mouvements de stock',
    users: 'Utilisateurs',
    app_config: 'Configuration',
    settings: 'Paramètres',
    expenses: 'Dépenses',
    locations: 'Entrepôts',
    categories: 'Catégories',
    audit_log: 'Journal d’audit',
    assist_audit: 'Audit agent',
  };
  return map[table] || table;
}


export function makeVerifyBackupAccess(
  requireOwner: BackupRouteDeps['requireOwner'],
  hmacSha256Hex: BackupRouteDeps['hmacSha256Hex'],
) {
  return async function verifyBackupAccess(
    c: any,
    opts?: { requireBackupToken?: boolean },
  ): Promise<{ ok: true; username: string } | { ok: false; response: Response }> {
    const owner = requireOwner(c);
    if (!owner.ok) return owner;

    const requireToken = opts?.requireBackupToken !== false;
    if (!requireToken) {
      return { ok: true, username: owner.username };
    }

    const token = backupTokenFromRequest(c);
    const expected = String((c.env as any).ADMIN_BACKUP_TOKEN || '').trim();
    if (!expected) {
      return { ok: true, username: owner.username };
    }
    if (!token || token !== expected) {
      return {
        ok: false,
        response: c.json({
          success: false,
          error: 'Jeton X-Admin-Backup-Token invalide ou manquant. (wrangler secret put ADMIN_BACKUP_TOKEN)',
          code: 'BACKUP_TOKEN_INVALID',
        }, 403),
      };
    }

    const sig = String(c.req.header('X-Backup-Signature') || '').trim().toLowerCase();
    const ts = String(c.req.header('X-Backup-Timestamp') || '').trim();
    if (sig || ts) {
      if (!ts || !sig) {
        return {
          ok: false,
          response: c.json({ success: false, error: 'Signature HMAC incomplète.', code: 'BACKUP_HMAC_INCOMPLETE' }, 403),
        };
      }
      const age = Math.abs(Date.now() - Number(ts));
      if (!Number.isFinite(Number(ts)) || age > 5 * 60 * 1000) {
        return {
          ok: false,
          response: c.json({ success: false, error: 'Horodatage HMAC expiré (>5 min).', code: 'BACKUP_HMAC_EXPIRED' }, 403),
        };
      }
      const path = new URL(c.req.url).pathname;
      const msg = `${ts}.${c.req.method.toUpperCase()}.${path}`;
      const expectSig = await hmacSha256Hex(expected, msg);
      if (expectSig !== sig) {
        return {
          ok: false,
          response: c.json({ success: false, error: 'Signature HMAC invalide.', code: 'BACKUP_HMAC_INVALID' }, 403),
        };
      }
    }

    return { ok: true, username: owner.username };
  };
}

export function registerBackupRoutes(app: Hono<any>, deps: BackupRouteDeps): void {
  const { requireOwner, hmacSha256Hex, writeAudit, purgeAgentConversationsOlderThan } = deps;
  const verifyBackupAccess = makeVerifyBackupAccess(requireOwner, hmacSha256Hex);
  

  app.post('/api/admin/backup-now', async (c) => {
    const gate = await verifyBackupAccess(c, { requireBackupToken: false });
    if (!gate.ok) return gate.response;
    const result = await runDailyBackup(c.env, { forceFull: true });
    if (!result.ok) return c.json({ success: false, error: result.error }, 500);
    // Background: purge old backups without blocking the response
    try {
      enqueue(c.executionCtx as any, async () => {
        await purgeExpiredBackups(c.env);
      });
    } catch { /* */ }
    return c.json({ success: true, data: result, message: `Sauvegarde créée: ${result.key}` });
  });
  
  app.get('/api/admin/backup-status', async (c) => {
    const gate = await verifyBackupAccess(c, { requireBackupToken: false });
    if (!gate.ok) return gate.response;
    try {
      const obj = await c.env.IMAGES.head('backups/latest.abk');
      const meta = ((obj as any)?.customMetadata || {}) as Record<string, string>;
      return c.json({
        success: true,
        data: {
          has_latest: !!obj,
          uploaded: (obj as any)?.uploaded?.toString?.() || null,
          size: (obj as any)?.size || null,
          raw_size: meta.raw_bytes ? Number(meta.raw_bytes) : null,
          fmt: meta.fmt || null,
          sha256: meta.sha256 || null,
          tables_count: meta.tables_count ? Number(meta.tables_count) : null,
          total_rows: meta.total_rows ? Number(meta.total_rows) : null,
        },
      });
    } catch {
      return c.json({ success: true, data: { has_latest: false } });
    }
  });
  
  app.get('/api/admin/backups', async (c) => {
    const gate = await verifyBackupAccess(c, { requireBackupToken: false });
    if (!gate.ok) return gate.response;
    if (!c.env.IMAGES) return c.json({ success: false, error: 'R2 indisponible' }, 503);
    const items: any[] = [];
    let cursor: string | undefined;
    do {
      const page: any = await c.env.IMAGES.list({ prefix: 'backups/', cursor, limit: 200 });
      for (const obj of page.objects || []) {
        const key = String(obj.key || '');
        // UI list: only encrypted .abk under 30m + latest pointer.
        // pre-revert safety copies stay on R2 but are hidden from the restore dropdown.
        if (key.includes('manifest')) continue;
        if (!key.endsWith('.abk')) continue;
        if (key !== 'backups/latest.abk' && !key.startsWith('backups/30m/')) continue;
        items.push({
          key,
          size: obj.size,
          uploaded: obj.uploaded ? new Date(obj.uploaded).toISOString() : null,
        });
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
    // Always surface latest pointer if present
    try {
      const latest = await c.env.IMAGES.head('backups/latest.abk');
      if (latest && !items.some((x) => x.key === 'backups/latest.abk')) {
        items.unshift({
          key: 'backups/latest.abk',
          size: (latest as any).size,
          uploaded: (latest as any).uploaded ? new Date((latest as any).uploaded).toISOString() : null,
        });
      }
    } catch { /* */ }
    items.sort((a, b) => {
      if (a.key === 'backups/latest.abk') return -1;
      if (b.key === 'backups/latest.abk') return 1;
      return String(b.uploaded || '').localeCompare(String(a.uploaded || ''));
    });
    return c.json({ success: true, data: items.slice(0, 100) });
  });
  
  /** Download backup binary (.abk) or JSON via API only (never public R2 URL). */
  app.get('/api/admin/backups/download', async (c) => {
    const gate = await verifyBackupAccess(c);
    if (!gate.ok) return gate.response;
    const key = String(c.req.query('key') || 'backups/latest.abk').trim();
    if (!key.startsWith('backups/') || key.includes('..')) {
      return c.json({ success: false, error: 'Clé invalide', code: 'BAD_KEY' }, 400);
    }
    const obj = await c.env.IMAGES.get(key);
    if (!obj) return c.json({ success: false, error: 'Sauvegarde introuvable' }, 404);
    const isBinary = key.endsWith('.abk');
    const body = isBinary ? await obj.arrayBuffer() : await obj.text();
    const filename = (key.split('/').pop() || 'backup.abk').replace(/[^A-Za-z0-9._-]/g, '_');
    return new Response(body, {
      headers: {
        'Content-Type': isBinary ? 'application/octet-stream' : 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
  
  
  async function setRestoreJob(env: any, job: {
    id: string; status: string; message?: string; progress?: number;
    safety_key?: string | null; source_key?: string; error?: string;
    started_at?: string; finished_at?: string; tables?: string[]; rows?: number;
    table?: string; index?: number; total?: number;
    work_key?: string | null; table_index?: number; table_order?: string[]; cancel?: boolean;
  }) {
    try {
      if (env.CACHE) {
        await env.CACHE.put(`restore_job:${job.id}`, JSON.stringify(job), { expirationTtl: 3600 * 6 });
        await env.CACHE.put('restore_job:latest', job.id, { expirationTtl: 3600 * 6 });
      }
    } catch { /* */ }
    // Durable Object progress (survives isolate recycling during long restores)
    try {
      if (env.RESTORE_HUB) {
        const id = env.RESTORE_HUB.idFromName('restore:global');
        const stub = env.RESTORE_HUB.get(id);
        await stub.fetch('https://restore-hub/job', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(job),
        });
      }
    } catch { /* */ }
  }
  
  async function getRestoreJob(env: any, id?: string): Promise<any | null> {
    try {
      let jid = id || '';
      if (!jid && env.CACHE) {
        jid = (await env.CACHE.get('restore_job:latest')) || '';
      }
      if (env.CACHE && jid) {
        const raw = await env.CACHE.get(`restore_job:${jid}`);
        if (raw) {
          try { return JSON.parse(raw); } catch { /* */ }
        }
      }
      // Fallback Durable Object
      if (env.RESTORE_HUB) {
        try {
          const stub = env.RESTORE_HUB.get(env.RESTORE_HUB.idFromName('restore:global'));
          const res = await stub.fetch('https://restore-hub/status');
          if (res.ok) {
            const j = await res.json() as any;
            const job = j?.data;
            if (job && (!id || job.id === id)) return job;
          }
        } catch { /* */ }
      }
      return null;
    } catch {
      return null;
    }
  }
  
  
  app.get('/api/admin/backups/restore-status', async (c) => {
    const gate = await verifyBackupAccess(c, { requireBackupToken: false });
    if (!gate.ok) return gate.response;
    const id = String(c.req.query('id') || '').trim();
    let job = await getRestoreJob(c.env, id || undefined);
    // Auto-fail zombie jobs (Worker isolate recycled / R2 source deleted mid-run)
    if (job && (job.status === 'running' || job.status === 'pending')) {
      const started = job.started_at ? Date.parse(job.started_at) : 0;
      const ageMs = started ? Date.now() - started : 0;
      if (ageMs > 25 * 60 * 1000) { // > 25 minutes
        job = {
          ...job,
          status: 'failed',
          message: 'Restauration interrompue (délai dépassé ou source indisponible). Vous pouvez réessayer.',
          error: 'STALE_JOB',
          progress: 100,
          finished_at: new Date().toISOString(),
        };
        await setRestoreJob(c.env, job);
      }
    }
    return c.json({ success: true, data: job });
  });
  
  /** Force-end a stuck restore job (e.g. R2 file deleted, isolate recycled). */
  app.post('/api/admin/backups/restore-cancel', async (c) => {
    const gate = await verifyBackupAccess(c, { requireBackupToken: false });
    if (!gate.ok) return gate.response;
    const body = await c.req.json().catch(() => ({}));
    const id = String(body.id || c.req.query('id') || '').trim();
    const existing = await getRestoreJob(c.env, id || undefined);
    const jobId = id || existing?.id || 'unknown';
    const finished = new Date().toISOString();
    await setRestoreJob(c.env, {
      id: jobId,
      status: 'failed',
      message: body.message || 'Restauration annulée — source supprimée ou job interrompu. Vous pouvez réessayer.',
      error: 'CANCELLED',
      progress: 100,
      source_key: existing?.source_key,
      safety_key: existing?.safety_key,
      started_at: existing?.started_at,
      finished_at: finished,
    });
    // Also clear "latest" pointer so UI does not keep picking it up
    try {
      if (c.env.CACHE) {
        await c.env.CACHE.delete('restore_job:latest');
        if (jobId) await c.env.CACHE.delete(`restore_job:${jobId}`);
      }
    } catch { /* */ }
    try {
      if (c.env.RESTORE_HUB) {
        const stub = c.env.RESTORE_HUB.get(c.env.RESTORE_HUB.idFromName('restore:global'));
        await stub.fetch('https://restore-hub/cancel', { method: 'POST' });
      }
    } catch { /* */ }
    // Cleanup work payload if present
    try {
      if (c.env.IMAGES && existing?.work_key) {
        await c.env.IMAGES.delete(existing.work_key);
      }
    } catch { /* */ }
    return c.json({
      success: true,
      message: 'Job de restauration terminé / annulé',
      data: { id: jobId, status: 'failed' },
    });
  });
  
  app.post('/api/admin/backups/restore', async (c) => {
    // Owner session — returns job_id immediately; work continues via waitUntil so UI can poll progress.
    const gate = await verifyBackupAccess(c, { requireBackupToken: false });
    if (!gate.ok) return gate.response;
    const body = await c.req.json().catch(() => ({}));
    const key = String(body.key || c.req.query('key') || '').trim();
    const inline = body.payload && typeof body.payload === 'object' ? body.payload : null;
    const abkB64 = typeof body.abk_base64 === 'string' ? body.abk_base64.trim() : '';
    const jobId = `rj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const started = new Date().toISOString();
    const env = c.env;
    const username = gate.username;
    const ip = c.req.header('cf-connecting-ip') || '';
  
    if (!inline && !abkB64 && (!key.startsWith('backups/') || key.includes('..'))) {
      return c.json({ success: false, error: 'Clé R2 invalide ou payload manquant', code: 'BAD_KEY' }, 400);
    }
  
    await setRestoreJob(env, {
      id: jobId, status: 'running', message: 'Vérification des droits et du jeton…', progress: 5,
      source_key: key || 'upload', started_at: started,
    });
  
    const runRestore = async () => {
      try {
        await setRestoreJob(env, {
          id: jobId, status: 'running', message: 'Création du point de sécurité…', progress: 8,
          source_key: key || 'upload', started_at: started,
        });
  
        const safety = await runDailyBackup(env);
        const safetyKey = safety.ok
          ? `backups/pre-revert/atlas-prerevert-${new Date().toISOString().replace(/[:.]/g, '-')}.abk`
          : null;
        if (safety.ok && safetyKey && env.IMAGES && safety.key) {
          try {
            const snap = await env.IMAGES.get(safety.key) || await env.IMAGES.get('backups/latest.abk');
            if (snap) {
              await env.IMAGES.put(safetyKey, await snap.arrayBuffer(), {
                httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store' },
                customMetadata: { type: 'pre_revert_enc', by: username, fmt: 'ABK1' },
              });
            }
          } catch { /* */ }
        }
  
        await setRestoreJob(env, {
          id: jobId, status: 'running', message: 'Lecture et déchiffrement du snapshot…', progress: 15,
          source_key: key || 'upload', safety_key: safetyKey, started_at: started,
        });
  
        let payload: any = null;
        if (abkB64) {
          try {
            const bin = Uint8Array.from(atob(abkB64), (ch) => ch.charCodeAt(0));
            payload = await decryptBackupBytes(env, bin);
          } catch {
            payload = null;
          }
        } else if (inline) {
          if (inline.tables) payload = inline;
          else if (inline.fmt === 'atlas-backup-enc' || inline.ciphertext) {
            try {
              payload = await decryptBackupBody(env, JSON.stringify(inline));
            } catch { payload = null; }
          } else payload = inline;
        } else if (key) {
          payload = await loadBackupJson(env, key);
        }
  
        if (!payload || typeof payload !== 'object') {
          await setRestoreJob(env, {
            id: jobId, status: 'failed',
            message: 'Snapshot illisible ou vide',
            error: 'BACKUP_INVALID', progress: 100, started_at: started, finished_at: new Date().toISOString(),
            source_key: key || 'upload', safety_key: safetyKey,
          });
          return;
        }
  
        const isAtlas =
          payload.app === 'atlas-commerce' ||
          payload.version === 2 ||
          payload.version === 1 ||
          (payload.exported_at && typeof payload.tables === 'object');
        if (!isAtlas) {
          await setRestoreJob(env, {
            id: jobId, status: 'failed', message: 'Fichier non compatible (pas une sauvegarde Atlas)',
            error: 'BACKUP_INCOMPATIBLE', progress: 100, started_at: started, finished_at: new Date().toISOString(),
            source_key: key || 'upload', safety_key: safetyKey,
          });
          return;
        }
        const tombstones = await loadDeletedAccountTombstones(env.DB);
        if (tombstones.length) {
          scrubAccountFromBackupPayload(payload, tombstones);
        }
  
        const preferred = [
          'product_units', 'units', 'categories', 'product_categories', 'product_catalog', 'catalog_settings',
          'warehouses', 'stock_locations',
          'products', 'product_images',
          'clients', 'vendors',
          'invoices', 'invoice_items', 'invoice_payments', 'invoice_ubl_clearance',
          'quotes', 'bills', 'bill_items', 'bill_payments', 'purchase_orders',
          'receipts', 'expenses', 'delivery_notes', 'delivery_note_items',
          'stock_levels', 'stock_movements', 'stock_location_qty', 'stock_cost_layers', 'warehouse_stock',
          'company_settings', 'app_config', 'app_users', 'document_counters',
          'mobile_actions', 'reorder_suggestions', 'auto_transfer_rules',
          'assist_audit', 'assist_approval', 'assist_prop',
          'push_tokens', 'webhooks', 'api_keys', 'idempotency_keys',
          'trusted_devices', 'webauthn_credentials',
          'login_attempts', 'ip_reputation', 'audit_log',
        ];
        const allNames = Object.keys(payload.tables || {}).filter(
          (tn) =>
            ALLOWED_RESTORE_TABLES.has(tn) &&
            SAFE_SQL_IDENT_RE.test(tn) &&
            Array.isArray(payload.tables[tn]) &&
            (payload.tables[tn] as any[]).length > 0,
        );
        const tableOrder: string[] = [];
        for (const t of preferred) if (allNames.includes(t)) tableOrder.push(t);
        for (const t of allNames) if (!tableOrder.includes(t)) tableOrder.push(t);
  
        if (!tableOrder.length) {
          await setRestoreJob(env, {
            id: jobId, status: 'failed', message: 'Aucune table exploitable dans le snapshot',
            error: 'BACKUP_EMPTY', progress: 100, started_at: started, finished_at: new Date().toISOString(),
            source_key: key || 'upload', safety_key: safetyKey,
          });
          return;
        }
  
        // Persist decrypted work payload on R2 so the Durable Object can process table-by-table
        const workKey = `backups/restore-work/${jobId}.json`;
        if (!env.IMAGES) {
          await setRestoreJob(env, {
            id: jobId, status: 'failed', message: 'R2 indisponible pour le travail de restauration',
            error: 'NO_R2', progress: 100, started_at: started, finished_at: new Date().toISOString(),
          });
          return;
        }
        await env.IMAGES.put(workKey, JSON.stringify({ tables: payload.tables, exported_at: payload.exported_at }), {
          httpMetadata: { contentType: 'application/json', cacheControl: 'private, no-store' },
          customMetadata: { type: 'restore_work', job: jobId },
        });
  
        await setRestoreJob(env, {
          id: jobId, status: 'running',
          message: `Démarrage — ${tableOrder.length} tables (une par une)…`,
          progress: 20,
          source_key: key || 'upload', safety_key: safetyKey, started_at: started,
          work_key: workKey, table_index: 0, table_order: tableOrder, tables: [], rows: 0,
        });
  
        // Hand off to RestoreHub DO — each alarm processes ONE table then schedules the next
        if (env.RESTORE_HUB) {
          try {
            const stub = env.RESTORE_HUB.get(env.RESTORE_HUB.idFromName('restore:global'));
            await stub.fetch('https://restore-hub/start', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id: jobId,
                status: 'running',
                message: `Table 1/${tableOrder.length}…`,
                progress: 22,
                source_key: key || 'upload',
                safety_key: safetyKey,
                started_at: started,
                work_key: workKey,
                table_index: 0,
                table_order: tableOrder,
                tables: [],
                rows: 0,
                start: true,
              }),
            });
          } catch (e: any) {
            console.error('restore_do_start_failed', String(e?.message || e));
            // Fall through to single-shot batch restore below
            const result = await restoreFromBackupPayload(env.DB, payload, async (info) => {
              await setRestoreJob(env, {
                id: jobId, status: 'running', message: info.message, progress: info.progress,
                table: info.table, index: info.index, total: info.total, rows: info.rows,
                source_key: key || 'upload', safety_key: safetyKey, started_at: started,
              });
            });
            try { await afterBusinessMutation(env.CACHE); } catch { /* */ }
            await setRestoreJob(env, {
              id: jobId, status: 'ok',
              message: `Terminé — ${result.tables.length} tables, ${result.rows} lignes`,
              progress: 100, tables: result.tables, rows: result.rows,
              source_key: key || 'upload', safety_key: safetyKey,
              started_at: started, finished_at: new Date().toISOString(),
            });
            return;
          }
        } else {
          // Fallback: single-shot (may hit CPU limits on large DBs)
          const result = await restoreFromBackupPayload(env.DB, payload, async (info) => {
            await setRestoreJob(env, {
              id: jobId, status: 'running', message: info.message, progress: info.progress,
              table: info.table, index: info.index, total: info.total, rows: info.rows,
              source_key: key || 'upload', safety_key: safetyKey, started_at: started,
            });
          });
          try { await afterBusinessMutation(env.CACHE); } catch { /* */ }
          await setRestoreJob(env, {
            id: jobId, status: 'ok',
            message: `Terminé — ${result.tables.length} tables, ${result.rows} lignes`,
            progress: 100, tables: result.tables, rows: result.rows,
            source_key: key || 'upload', safety_key: safetyKey,
            started_at: started, finished_at: new Date().toISOString(),
          });
        }
  
        try {
          await writeAudit(env.DB, {
            username, role: 'owner', action: 'backup.restore', entity: 'backups',
            entity_id: (key || 'upload').split('/').pop() || 'upload',
            detail: `Restauration démarrée (${tableOrder.length} tables)`,
            ip,
          });
        } catch { /* */ }
      } catch (e: any) {
        const msg = e?.message || 'Erreur restauration';
        await setRestoreJob(env, {
          id: jobId, status: 'failed', message: msg, error: msg, progress: 100,
          source_key: key || 'upload', started_at: started, finished_at: new Date().toISOString(),
        });
      }
    };
  
    // Bootstrap only (decrypt + hand off to DO). DO alarms do the heavy lifting table by table.
    try {
      const ctx = (c as any).executionCtx;
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(runRestore());
      } else {
        await runRestore();
      }
    } catch {
      await runRestore();
    }
  
    return c.json({
      success: true,
      message: 'Restauration démarrée — tables traitées une par une',
      data: { job_id: jobId, status: 'running' },
    });
  });
  
  
  app.post('/api/admin/backups/purge-expired', async (c) => {
    const gate = await verifyBackupAccess(c);
    if (!gate.ok) return gate.response;
    const r = await purgeExpiredBackups(c.env);
    const dbPurge = await purgeExpiredDbBackupsState(c.env.DB);
    return c.json({
      success: true,
      data: { ...r, db_purged_rows: dbPurge.purgedRows },
      message: `${r.deleted} sauvegarde(s) >7 j purgée(s).`,
    });
  });

  const cronAuth = (c: any): Response | null => {
    const auth = String(c.req.header('Authorization') || '').trim();
    const secret = String((c.env as any).CRON_SECRET || '').trim();
    if (!secret) {
      return c.json({
        success: false,
        error: 'CRON_SECRET non configuré. Exécutez: npx wrangler secret put CRON_SECRET',
        code: 'CRON_SECRET_MISSING',
      }, 503);
    }
    const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    const headerToken = String(c.req.header('X-Cron-Secret') || '').trim();
    if (bearer !== secret && headerToken !== secret) {
      return c.json({ success: false, error: 'Unauthorized', code: 'CRON_UNAUTHORIZED' }, 401);
    }
    return null;
  };
  const cronHub = (env: any): DurableObjectStub | null => {
    const ns = env?.RESTORE_HUB as DurableObjectNamespace | undefined;
    if (!ns || typeof ns.idFromName !== 'function') return null;
    try { return ns.get(ns.idFromName(CRON_BACKUP_HUB_NAME)); } catch { return null; }
  };
  const purgeAgentSafe = async (env: any) => {
    try {
      return await purgeAgentConversationsOlderThan(env, 30);
    } catch (e: any) {
      console.error('cron_agent_purge_err', String(e));
      return { deleted: 0 };
    }
  };

  /**
   * External cron entry point (cron-job.org, every 12 h).
   *
   * cron-job.org aborts after 30 s, and a full incremental backup takes ~30 s,
   * so this endpoint now answers in well under a second: it authenticates,
   * checks the 12 h cooldown (one R2 HEAD), and hands the real work to a
   * Durable Object alarm (15 min wall clock, independent of the HTTP request).
   * `?wait=1` keeps the old synchronous behaviour for manual runs / tests.
   */
  app.post('/api/cron/backup-execute', async (c) => {
    const denied = cronAuth(c);
    if (denied) return denied;
    const started = new Date().toISOString();
    const force = c.req.query('force') === '1';
    const wait = c.req.query('wait') === '1';
    try {
      // D1 read budget: a backup run reads (almost) every row to hash each
      // table, so the 12-hour cadence must hold no matter how often the
      // external cron fires. The v5 index is rewritten by every run, so its R2
      // upload time is a durable « last run » marker.
      const lastRunAt = force ? 0 : await lastBackupRunAt(c.env);
      const unchanged = !force && lastRunAt > 0 && Date.now() - lastRunAt < BACKUP_CRON_COOLDOWN_SEC * 1000;
      let ctx: ExecutionContext | undefined;
      try { ctx = (c as any).executionCtx; } catch { ctx = undefined; }
      const hub = wait ? null : cronHub(c.env);

      if (hub) {
        const r = await hub.fetch('https://cron-backup/cron-backup/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force, skip_backup: unchanged }),
        });
        const j = (await r.json().catch(() => ({}))) as { data?: CronBackupJob; already_running?: boolean };
        enqueue(ctx, () => purgeAgentSafe(c.env));
        return c.json({
          success: true,
          queued: true,
          skipped: unchanged,
          already_running: Boolean(j.already_running),
          message: unchanged
            ? 'Sauvegarde déjà faite il y a moins de 12 h — purge 7 j lancée en arrière-plan'
            : j.already_running
              ? 'Une sauvegarde est déjà en cours'
              : 'Sauvegarde lancée en arrière-plan (suivi : GET /api/cron/backup-status)',
          job_id: j.data?.id || null,
          started,
          timestamp: new Date().toISOString(),
        }, 202);
      }

      const result = await executeCronBackup(c.env, { force, skipBackup: unchanged });
      const agentPurge = await purgeAgentSafe(c.env);
      if (!result.success) {
        return c.json({ success: false, error: result.error || 'Backup failed', code: 'BACKUP_FAILED', timestamp: started }, 500);
      }
      return c.json({ ...result, started, agent_chats_purged: agentPurge.deleted });
    } catch (e: any) {
      console.error('cron_backup_exception', e);
      return c.json({
        success: false,
        error: String(e?.message || 'Internal error').slice(0, 300),
        code: 'CRON_EXECUTE_FAILED',
        timestamp: started,
      }, 500);
    }
  });

  /** Status of the last background cron backup (same CRON_SECRET auth). */
  app.get('/api/cron/backup-status', async (c) => {
    const denied = cronAuth(c);
    if (denied) return denied;
    const hub = cronHub(c.env);
    if (!hub) return c.json({ success: true, data: null });
    const r = await hub.fetch('https://cron-backup/cron-backup/status');
    return c.json(await r.json());
  });
  
  
}
