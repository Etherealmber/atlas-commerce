/**
 * Offline product catalog + action outbox (IndexedDB).
 * Optimized: bulk put without blocking UI, no full clear when possible.
 */

const DB_NAME = 'atlas-commerce-offline';
const DB_VER = 4;
const STORE = 'products';
const OUTBOX = 'outbox';
const META = 'meta';
const LOCATIONS = 'locations';
const OFFLINE_INV_OPS = 'offline_inv_ops';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('barcode', 'barcode', { unique: false });
        store.createIndex('sku', 'sku', { unique: false });
      }
      if (!db.objectStoreNames.contains(OUTBOX)) {
        db.createObjectStore(OUTBOX, { keyPath: 'local_id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(LOCATIONS)) {
        db.createObjectStore(LOCATIONS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(OFFLINE_INV_OPS)) {
        const s = db.createObjectStore(OFFLINE_INV_OPS, { keyPath: 'seq', autoIncrement: true });
        s.createIndex('operation_id', 'operation_id', { unique: true });
      }
    };
  });
  return dbPromise;
}

function mapProduct(p: any) {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku || '',
    barcode: p.barcode || '',
    price: Number(p.price ?? p.unit_price ?? 0),
    stock_quantity: Number(p.stock_quantity ?? p.stock ?? 0),
    track_inventory: p.track_inventory,
    low_stock_threshold: p.low_stock_threshold ?? p.min_stock,
    category: p.category,
    unit: p.unit,
    parent_id: p.parent_id || null,
    variant_label: p.variant_label || '',
    tax_rate: p.tax_rate,
    cached_at: Date.now(),
  };
}

/** Bulk upsert products (single transaction). Clears only once per full sync. */
export async function cacheProducts(products: any[]): Promise<number> {
  if (!products?.length) return 0;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    store.clear();
    let n = 0;
    for (const p of products) {
      if (!p?.id) continue;
      store.put(mapProduct(p));
      n++;
    }
    tx.oncomplete = () => resolve(n);
    tx.onerror = () => reject(tx.error);
  });
}

/** Upsert single product (after create/update) without full resync */
export async function upsertProduct(p: any): Promise<void> {
  if (!p?.id) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(mapProduct(p));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function lookupOffline(code: string): Promise<any | null> {
  const needle = code.trim();
  if (!needle) return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.index('barcode').getAll(needle);
    req.onsuccess = () => {
      const byBc = (req.result || []).filter((p: any) => p.barcode === needle);
      if (byBc.length) {
        resolve(byBc[0]);
        return;
      }
      const all = store.getAll();
      all.onsuccess = () => {
        const found = (all.result || []).find(
          (p: any) => String(p.sku || '').toLowerCase() === needle.toLowerCase()
        );
        resolve(found || null);
      };
      all.onerror = () => reject(all.error);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function cacheCount(): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueOutbox(payload: {
  type: string;
  title: string;
  detail?: string;
  barcode?: string;
  product_id?: number;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX, 'readwrite');
    tx.objectStore(OUTBOX).add({ ...payload, created_at: new Date().toISOString() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function countOutbox(): Promise<number> {
  const db = await openDb();
  return await new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX, 'readonly');
    const req = tx.objectStore(OUTBOX).count();
    req.onsuccess = () => resolve(Number(req.result || 0));
    req.onerror = () => reject(req.error);
  });
}

export async function listOutbox(): Promise<any[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(OUTBOX, 'readonly').objectStore(OUTBOX).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function removeOutboxItem(localId: number): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX, 'readwrite');
    tx.objectStore(OUTBOX).delete(localId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function flushOutbox(
  postFn: (item: any) => Promise<boolean>
): Promise<{ sent: number; failed: number }> {
  const items = await listOutbox();
  let sent = 0;
  let failed = 0;
  for (const item of items) {
    try {
      if (await postFn(item)) {
        await removeOutboxItem(item.local_id);
        sent++;
      } else failed++;
    } catch {
      failed++;
    }
  }
  return { sent, failed };
}

export function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

/** alias FR */
export const cacheProduits = cacheProducts;


/** Request Background Sync so offline scans flush when connectivity returns */
export async function requestBackgroundSync(tag = 'atlas-outbox-sync'): Promise<boolean> {
  try {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.ready;
    // Background Sync API (Chrome/Android). iOS Safari ignores — online event still works.
    if ('sync' in reg) {
      await (reg as any).sync.register(tag);
      return true;
    }
  } catch {
    /* unsupported or permission */
  }
  return false;
}

/** Enqueue + ask browser to sync when back online */
export async function enqueueOutboxAndSync(payload: {
  type: string;
  title: string;
  detail?: string;
  barcode?: string;
  product_id?: number;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await enqueueOutbox(payload);
  await requestBackgroundSync('atlas-outbox-sync');
}

/** Cache warehouse list for offline selection */
export async function cacheLocations(locations: any[]): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LOCATIONS, 'readwrite');
    const store = tx.objectStore(LOCATIONS);
    store.clear();
    let n = 0;
    for (const l of locations || []) {
      if (!l?.id) continue;
      store.put({
        id: l.id,
        code: l.code,
        name: l.name,
        is_default: !!l.is_default,
        total_units: Number(l.total_units || 0),
        cached_at: Date.now(),
      });
      n++;
    }
    tx.oncomplete = () => resolve(n);
    tx.onerror = () => reject(tx.error);
  });
}

export async function listCachedLocations(): Promise<any[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(LOCATIONS, 'readonly').objectStore(LOCATIONS).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Optimistic local stock change (offline). Syncs via outbox as stock_adjust.
 * Returns new local quantity or null if product missing offline.
 */
export async function applyLocalStockDelta(
  productId: number,
  delta: number,
  meta?: { location_id?: number; reason?: string },
): Promise<number | null> {
  const db = await openDb();
  const prod = await new Promise<any>((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(productId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  if (!prod) return null;
  const next = Math.max(0, Number(prod.stock_quantity || 0) + delta);
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ ...prod, stock_quantity: next, cached_at: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  await enqueueOutboxAndSync({
    type: 'stock_adjust',
    title: `Ajust. stock ${prod.name}`,
    detail: `${delta > 0 ? '+' : ''}${delta} → ${next}`,
    product_id: productId,
    meta: {
      delta,
      location_id: meta?.location_id,
      reason: meta?.reason || 'offline_adjust',
      previous: prod.stock_quantity,
    },
  });
  return next;
}

/** List products with low stock from offline cache */
export async function listLowStockOffline(): Promise<any[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => {
      const rows = (req.result || []).filter(
        (p: any) =>
          p.track_inventory &&
          Number(p.stock_quantity || 0) <= Number(p.low_stock_threshold ?? 5),
      );
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

export interface QueuedOfflineInventoryOp {
  seq?: number;
  operation_id: string;
  kind: 'receive' | 'issue' | 'count';
  product_id: number;
  location_id: number;
  quantity_delta?: number;
  counted_quantity?: number;
  observed_quantity?: number;
  observed_revision?: number;
  note?: string;
  client_occurred_at: string;
  product_name?: string;
  location_name?: string;
  status: 'pending' | 'conflict' | 'failed';
  conflict?: { current_quantity: number; current_revision: number; product_total?: number };
  error_message?: string;
}

export function newOperationUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function enqueueOfflineInventoryOp(
  op: Omit<QueuedOfflineInventoryOp, 'seq' | 'status'>,
): Promise<QueuedOfflineInventoryOp> {
  const item: QueuedOfflineInventoryOp = { ...op, status: 'pending' };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OFFLINE_INV_OPS, 'readwrite');
    tx.objectStore(OFFLINE_INV_OPS).add(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  await requestBackgroundSync('atlas-offline-inv-ops');
  return item;
}

export async function listOfflineInventoryOps(): Promise<QueuedOfflineInventoryOp[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(OFFLINE_INV_OPS, 'readonly').objectStore(OFFLINE_INV_OPS).getAll();
    req.onsuccess = () => {
      const rows = (req.result || []) as QueuedOfflineInventoryOp[];
      rows.sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0));
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function countOfflineInventoryOps(): Promise<{ pending: number; conflicts: number; total: number }> {
  const rows = await listOfflineInventoryOps();
  const pending = rows.filter((r) => r.status === 'pending').length;
  const conflicts = rows.filter((r) => r.status === 'conflict').length;
  return { pending, conflicts, total: rows.length };
}

export async function removeOfflineInventoryOpBySeq(seq: number): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_INV_OPS, 'readwrite');
    tx.objectStore(OFFLINE_INV_OPS).delete(seq);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function updateOfflineInventoryOp(item: QueuedOfflineInventoryOp): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_INV_OPS, 'readwrite');
    tx.objectStore(OFFLINE_INV_OPS).put(item);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export type OfflineOpSendOutcome =
  | { kind: 'applied'; data: any }
  | { kind: 'conflict'; current_quantity: number; current_revision: number; product_total?: number; message: string }
  | { kind: 'terminal_error'; status: number; code?: string; message: string }
  | { kind: 'retryable_error'; message: string };

/**
 * Flush pending offline inventory operations in strict FIFO order.
 * - 200 -> delete from queue
 * - 409 COUNT_CONFLICT -> mark status='conflict' (visible, never retried in a loop)
 * - Other 4xx -> mark status='failed' (terminal, never retried in a loop)
 * - 5xx / network error -> keep status='pending' with same operation_id to retry later
 */
export async function flushOfflineInventoryOps(
  sender: (op: QueuedOfflineInventoryOp) => Promise<OfflineOpSendOutcome>,
): Promise<{ applied: number; conflicts: number; failed: number; remaining: number }> {
  const rows = await listOfflineInventoryOps();
  let applied = 0;
  let conflicts = 0;
  let failed = 0;
  let remaining = 0;

  for (const item of rows) {
    if (item.status !== 'pending' || item.seq == null) {
      if (item.status === 'conflict') conflicts++;
      continue;
    }
    const outcome = await sender(item);
    if (outcome.kind === 'applied') {
      await removeOfflineInventoryOpBySeq(item.seq);
      applied++;
    } else if (outcome.kind === 'conflict') {
      await updateOfflineInventoryOp({
        ...item,
        status: 'conflict',
        conflict: {
          current_quantity: outcome.current_quantity,
          current_revision: outcome.current_revision,
          product_total: outcome.product_total,
        },
        error_message: outcome.message,
      });
      conflicts++;
    } else if (outcome.kind === 'terminal_error') {
      await updateOfflineInventoryOp({
        ...item,
        status: 'failed',
        error_message: outcome.message,
      });
      failed++;
    } else {
      remaining++;
      // Stop FIFO replay so later operations preserve causal order
      break;
    }
  }

  return { applied, conflicts, failed, remaining };
}
