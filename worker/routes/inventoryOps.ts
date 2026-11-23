import type { Hono } from 'hono';
import { schemaOnce, addColumnIfMissing } from '../lib/schema';
import { bumpPlacementRevision, ensureOfflineOpsSchema } from '../lib/idempotency';
import { afterBusinessMutation } from '../lib/delete-coord';
import { doCacheGet, doCachePut, hasLiveCache } from '../lib/cache';
import { tr } from '../lib/error-i18n';
import { round2, roundCurrency } from '../lib/financeCore';
import { nextDocumentNumber } from '../lib/numbering';
import { assertSafeOutboundUrl, escapeHtml } from '../lib/security';
import { normalizeInventoryRole, roleCanSeeFinancial, scrubProductForRole } from '../lib/inventory-policy';

export interface InventoryOpsRouteDeps {
  requireOwner: (c: any) => any;
  requireBizMutator: (c: any) => any;
  requireFloorStock: (c: any) => any;
  sessionUserFromHeader: (header: string | undefined) => any;
  applyStockDelta: (...args: any[]) => Promise<any>;
  ensureValuationTables: (db: D1Database) => Promise<void>;
  getValuationMethod: (db: D1Database) => Promise<'average' | 'fifo' | 'standard'>;
  runAutoTransfers: (...args: any[]) => Promise<any>;
  ensureBillPaymentsTable: (db: D1Database) => Promise<void>;
  ensurePaymentHistoryTable: (db: D1Database) => Promise<void>;
}

async function ensureWarehouseSettings(db: D1Database) {
  await schemaOnce('ensureWarehouseSettings', async () => {
  await addColumnIfMissing(db, 'company_settings', 'multi_warehouse', `INTEGER DEFAULT 1`);
  await addColumnIfMissing(db, 'company_settings', 'sales_location_id', `INTEGER`);
  await addColumnIfMissing(db, 'company_settings', 'purchase_location_id', `INTEGER`);

  });
}


export async function ensureMarbleUnits(db: D1Database) {
  await schemaOnce('ensureMarbleUnits', async () => {
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS units (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, symbol TEXT, created_at TEXT DEFAULT (datetime('now')))`).run();
  } catch { /* */ }
  for (const u of ['m²', 'ML', 'm2', 'unité', 'pièce', 'forfait']) {
    try {
      await db.prepare(`INSERT OR IGNORE INTO units (name) VALUES (?)`).bind(u).run();
    } catch {
      try { await db.prepare(`INSERT INTO units (name) VALUES (?)`).bind(u).run(); } catch { /* dup */ }
    }
  }

  });
}

export async function ensureStockLocations(db: D1Database) {
  await schemaOnce('stock_locations', async () => {
    await db.prepare(`CREATE TABLE IF NOT EXISTS stock_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      is_default INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')))`).run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS stock_location_qty (
      location_id INTEGER NOT NULL, product_id INTEGER NOT NULL, quantity REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (location_id, product_id))`).run();
    await addColumnIfMissing(db, 'stock_locations', 'is_active', 'INTEGER DEFAULT 1');
    await addColumnIfMissing(db, 'stock_locations', 'is_default', 'INTEGER DEFAULT 0');
    const n = await db.prepare(`SELECT COUNT(*) as c FROM stock_locations`).first() as any;
    if (!Number(n?.c)) {
      await db.prepare(`INSERT INTO stock_locations (code, name, is_default, is_active) VALUES ('MAG', 'Magasin principal', 1, 1)`).run();
      await db.prepare(`INSERT INTO stock_locations (code, name, is_default, is_active) VALUES ('RES', 'Réserve', 0, 1)`).run();
    }
    await ensureWarehouseSettings(db);
  });
}


/** Put full product qty on default warehouse (replaces prior placements). */
export async function placeProductStockOnDefault(db: D1Database, productId: number, qty: number) {
  await ensureStockLocations(db);
  let defId: number | null = null;
  try {
    const def = await db.prepare(`SELECT id FROM stock_locations WHERE is_default = 1 ORDER BY id LIMIT 1`).first() as any;
    defId = def?.id ? Number(def.id) : null;
    if (!defId) {
      const any = await db.prepare(`SELECT id FROM stock_locations ORDER BY id LIMIT 1`).first() as any;
      defId = any?.id ? Number(any.id) : null;
    }
  } catch { /* */ }
  if (!defId) return;
  await db.prepare(`DELETE FROM stock_location_qty WHERE product_id = ?`).bind(productId).run();
  if (qty > 0.0001) {
    await db.prepare(
      `INSERT INTO stock_location_qty (location_id, product_id, quantity) VALUES (?, ?, ?)`
    ).bind(defId, productId, qty).run();
  }
}

/** Align stock_location_qty with products.stock_quantity (source of truth for unallocated stock). */
async function reconcileStockLocations(db: D1Database) {
  // Drop rows pointing at deleted products
  try {
    await db.prepare(
      `DELETE FROM stock_location_qty WHERE product_id NOT IN (SELECT id FROM products)`
    ).run();
  } catch { /* */ }

  let defId: number | null = null;
  try {
    const settings = await db.prepare(`SELECT sales_location_id FROM company_settings WHERE id = 1`).first() as any;
    if (settings?.sales_location_id) {
      const ok = await db.prepare(`SELECT id FROM stock_locations WHERE id = ? AND COALESCE(is_active,1)=1`).bind(settings.sales_location_id).first();
      if (ok) defId = Number(settings.sales_location_id);
    }
    if (!defId) {
      const def = await db.prepare(`SELECT id FROM stock_locations WHERE is_default = 1 ORDER BY id LIMIT 1`).first() as any;
      if (def?.id) defId = Number(def.id);
    }
    if (!defId) {
      const any = await db.prepare(`SELECT id FROM stock_locations ORDER BY id LIMIT 1`).first() as any;
      if (any?.id) defId = Number(any.id);
    }
  } catch { /* */ }
  if (!defId) return;

  // All active tracked products
  let products: any[] = [];
  try {
    const r = await db.prepare(
      `SELECT id, COALESCE(stock_quantity, 0) as stock_quantity,
              COALESCE(track_inventory, 1) as track_inventory,
              COALESCE(is_active, 1) as is_active
       FROM products`
    ).all();
    products = (r.results || []) as any[];
  } catch {
    try {
      const r = await db.prepare(`SELECT id, COALESCE(stock_quantity, 0) as stock_quantity FROM products`).all();
      products = ((r.results || []) as any[]).map((p) => ({ ...p, track_inventory: 1, is_active: 1 }));
    } catch { return; }
  }

  for (const p of products) {
    const pid = Number(p.id);
    if (!pid) continue;
    const track = Number(p.track_inventory ?? 1) !== 0;
    const active = Number(p.is_active ?? 1) !== 0;
    const productQty = Number(p.stock_quantity || 0);

    let sumLoc = 0;
    try {
      const s = await db.prepare(
        `SELECT COALESCE(SUM(quantity), 0) as s FROM stock_location_qty WHERE product_id = ?`
      ).bind(pid).first() as any;
      sumLoc = Number(s?.s || 0);
    } catch { sumLoc = 0; }

    // Inactive or not tracked: zero out placements
    if (!active || !track) {
      if (sumLoc !== 0) {
        try {
          await db.prepare(`DELETE FROM stock_location_qty WHERE product_id = ?`).bind(pid).run();
        } catch { /* */ }
      }
      continue;
    }

    // No warehouse rows but product has stock → put everything in default depot
    if (sumLoc <= 0.0001 && productQty > 0.0001) {
      try {
        const existing = await db.prepare(
          `SELECT quantity FROM stock_location_qty WHERE location_id = ? AND product_id = ?`
        ).bind(defId, pid).first() as any;
        if (existing) {
          await db.prepare(
            `UPDATE stock_location_qty SET quantity = ? WHERE location_id = ? AND product_id = ?`
          ).bind(productQty, defId, pid).run();
        } else {
          await db.prepare(
            `INSERT INTO stock_location_qty (location_id, product_id, quantity) VALUES (?, ?, ?)`
          ).bind(defId, pid, productQty).run();
        }
      } catch (e) {
        console.error('reconcile insert default', pid, e);
      }
      continue;
    }

    // Product stock is 0 but locations still hold qty → clear placements (stale data)
    if (productQty <= 0.0001 && sumLoc > 0.0001) {
      try {
        await db.prepare(`DELETE FROM stock_location_qty WHERE product_id = ?`).bind(pid).run();
      } catch { /* */ }
      continue;
    }

    // Both non-zero but mismatch: trust product total, scale default location
    // Only auto-fix when a single location holds all stock (typical MAG-only setup)
    if (productQty > 0.0001 && Math.abs(sumLoc - productQty) > 0.01) {
      try {
        const rows = await db.prepare(
          `SELECT location_id, quantity FROM stock_location_qty WHERE product_id = ? AND quantity != 0`
        ).bind(pid).all();
        const list = (rows.results || []) as any[];
        if (list.length <= 1) {
          // Single (or zero) placement → set default to product qty
          await db.prepare(`DELETE FROM stock_location_qty WHERE product_id = ?`).bind(pid).run();
          await db.prepare(
            `INSERT INTO stock_location_qty (location_id, product_id, quantity) VALUES (?, ?, ?)`
          ).bind(defId, pid, productQty).run();
        }
        // Multi-location intentional split: leave as-is (ops manage transfers)
      } catch { /* */ }
    }
  }
}

export async function getDefaultLocationId(db: D1Database): Promise<number | null> {
  await ensureStockLocations(db);
  const settings = await db.prepare(`SELECT sales_location_id FROM company_settings WHERE id = 1`).first() as any;
  if (settings?.sales_location_id) {
    const ok = await db.prepare(`SELECT id FROM stock_locations WHERE id = ? AND COALESCE(is_active,1)=1`).bind(settings.sales_location_id).first();
    if (ok) return Number(settings.sales_location_id);
  }
  const def = await db.prepare(`SELECT id FROM stock_locations WHERE is_default = 1 ORDER BY id LIMIT 1`).first() as any;
  if (def?.id) return Number(def.id);
  const any = await db.prepare(`SELECT id FROM stock_locations ORDER BY id LIMIT 1`).first() as any;
  return any?.id ? Number(any.id) : null;
}

/** Sync products.stock_quantity = SUM(location qty) when multi-warehouse is on. */
async function syncProductTotalFromLocations(db: D1Database, productId: number | string) {
  const sum = await db.prepare(
    `SELECT COALESCE(SUM(quantity), 0) as s FROM stock_location_qty WHERE product_id = ?`
  ).bind(productId).first() as any;
  const total = Number(sum?.s || 0);
  await db.prepare(`UPDATE products SET stock_quantity = ?, updated_at = datetime('now') WHERE id = ?`).bind(total, productId).run();
  return total;
}

/**
 * Adjust qty at a location and keep product total in sync.
 * If product has global stock but no location rows, seeds default location first.
 */
export async function adjustLocationStock(
  db: D1Database,
  productId: number | string,
  locationId: number,
  delta: number,
  opts?: { allowNegative?: boolean },
): Promise<{ location_qty: number; product_total: number }> {
  await ensureStockLocations(db);
  // Seed: if no placement rows and product has stock, put all on default
  const existing = await db.prepare(
    `SELECT COUNT(*) as c FROM stock_location_qty WHERE product_id = ?`
  ).bind(productId).first() as any;
  if (!Number(existing?.c)) {
    const prod = await db.prepare(`SELECT stock_quantity, track_inventory FROM products WHERE id = ?`).bind(productId).first() as any;
    if (prod?.track_inventory && Number(prod.stock_quantity || 0) > 0) {
      const def = (await getDefaultLocationId(db)) || locationId;
      await db.prepare(
        `INSERT INTO stock_location_qty (location_id, product_id, quantity) VALUES (?, ?, ?)`
      ).bind(def, productId, Number(prod.stock_quantity || 0)).run();
    }
  }
  const row = await db.prepare(
    `SELECT quantity FROM stock_location_qty WHERE location_id = ? AND product_id = ?`
  ).bind(locationId, productId).first() as any;
  const prev = Number(row?.quantity || 0);
  let next = prev + delta;
  if (!opts?.allowNegative && next < -1e-9) {
    const err: any = new Error(`Stock insuffisant sur cet emplacement (dispo ${prev}, demandé ${Math.abs(delta)}).`);
    err.code = 'INSUFFICIENT_STOCK';
    err.available = prev;
    throw err;
  }
  if (next < 0 && !opts?.allowNegative) next = 0;
  if (row) {
    await db.prepare(
      `UPDATE stock_location_qty SET quantity = ? WHERE location_id = ? AND product_id = ?`
    ).bind(next, locationId, productId).run();
  } else {
    await db.prepare(
      `INSERT INTO stock_location_qty (location_id, product_id, quantity) VALUES (?, ?, ?)`
    ).bind(locationId, productId, next).run();
  }
  const total = await syncProductTotalFromLocations(db, productId);
  try {
    await bumpPlacementRevision(db, null, productId, locationId);
  } catch { /* */ }
  return { location_qty: next, product_total: total };
}

async function ensureApiIntegrations(db: D1Database) {
  await schemaOnce('ensureApiIntegrations', async () => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      scopes TEXT DEFAULT 'read',
      is_active INTEGER DEFAULT 1,
      last_used_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      events TEXT DEFAULT 'invoice.created,payment.created',
      secret TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();

  });
}

function hashApiKey(raw: string): string {
  // Simple stable hash for free-tier (not crypto.subtle sync) — SHA-256 via Web Crypto in handlers
  return raw;
}


async function ensureDeliveryNotes(db: D1Database) {
  await schemaOnce('ensureDeliveryNotes', async () => {
  await db.prepare(`CREATE TABLE IF NOT EXISTS delivery_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT NOT NULL UNIQUE, invoice_id INTEGER,
    client_name TEXT DEFAULT '', issue_date TEXT, notes TEXT DEFAULT '', status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT (datetime('now')))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS delivery_note_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, delivery_note_id INTEGER NOT NULL, product_id INTEGER,
    product_name TEXT, quantity REAL NOT NULL, unit TEXT DEFAULT 'u')`).run();

  });
}


export async function ensureBillReceive(db: D1Database) {
  await schemaOnce('ensureBillReceive', async () => {
  await addColumnIfMissing(db, 'bill_items', 'qty_received', `REAL DEFAULT 0`);
  await addColumnIfMissing(db, 'bills', 'receive_status', `TEXT DEFAULT 'pending'`);

  });
}


export function registerInventoryOpsRoutes(app: Hono<any>, deps: InventoryOpsRouteDeps): void {
  const {
    requireOwner,
    requireBizMutator,
    requireFloorStock,
    sessionUserFromHeader,
    applyStockDelta,
    ensureValuationTables,
    getValuationMethod,
    runAutoTransfers,
    ensureBillPaymentsTable,
    ensurePaymentHistoryTable,
  } = deps;

  app.get('/api/inventory/locations', async (c) => {
    try {
      const productIdParam = String(c.req.query('product_id') || '').trim();
      if (productIdParam) {
        await ensureStockLocations(c.env.DB);
        await ensureOfflineOpsSchema(c.env.DB);
        const prodIdNum = Number(productIdParam);
        const prodRow = Number.isInteger(prodIdNum) && prodIdNum > 0
          ? (await c.env.DB.prepare(`SELECT id, COALESCE(stock_quantity, 0) AS stock_quantity FROM products WHERE id = ?`).bind(prodIdNum).first() as any)
          : null;
        const locsRes = await c.env.DB.prepare(
          `SELECT id, code, name, is_default, COALESCE(is_active, 1) AS is_active
           FROM stock_locations
           WHERE COALESCE(is_active, 1) = 1
           ORDER BY COALESCE(is_default, 0) DESC, name`,
        ).all();
        const locs = (locsRes.results || []) as any[];
        const qtyRes = Number.isInteger(prodIdNum) && prodIdNum > 0
          ? await c.env.DB.prepare(`SELECT location_id, quantity FROM stock_location_qty WHERE product_id = ?`).bind(prodIdNum).all()
          : { results: [] };
        const qtyMap = new Map<number, number>();
        for (const r of (qtyRes.results || []) as any[]) {
          qtyMap.set(Number(r.location_id), Number(r.quantity || 0));
        }
        const hasAnyQtyRows = qtyMap.size > 0;
        const unallocatedQty = !hasAnyQtyRows && prodRow ? Number(prodRow.stock_quantity || 0) : 0;

        const revRes = await c.env.DB.prepare(
          `SELECT location_id, revision FROM stock_location_revisions WHERE product_id = ?`,
        ).bind(String(prodIdNum || productIdParam)).all();
        const revMap = new Map<string, number>();
        for (const r of (revRes.results || []) as any[]) {
          revMap.set(String(r.location_id), Number(r.revision || 1));
        }

        const data = locs.map((l: any) => {
          const lid = Number(l.id);
          const lidText = String(lid);
          const quantity = qtyMap.has(lid)
            ? Number(qtyMap.get(lid) || 0)
            : Number(l.is_default || 0) === 1
              ? unallocatedQty
              : 0;
          return {
            location_id: lidText,
            id: lid,
            code: l.code,
            name: l.name,
            is_default: l.is_default,
            quantity,
            revision: revMap.get(lidText) ?? 0,
          };
        });
        return c.json({ success: true, data });
      }

      if (hasLiveCache(c.env)) {
        const hit = await doCacheGet<any[]>(c.env.MOBILE_HUB, c.env.CACHE, 'inventory:locations', 300);
        if (hit) return c.json({ success: true, data: hit, cached: true });
      }
      await ensureStockLocations(c.env.DB);
      // reconcile only on stock mutations — not on every GET
      let results: any[] = [];
      try {
        const r = await c.env.DB.prepare(
          `SELECT l.id, l.code, l.name, l.is_default, COALESCE(l.is_active, 1) as is_active,
            (SELECT COALESCE(SUM(q.quantity),0) FROM stock_location_qty q WHERE q.location_id = l.id) as total_units,
            (SELECT COUNT(*) FROM stock_location_qty q WHERE q.location_id = l.id AND q.quantity > 0) as sku_count
           FROM stock_locations l
           ORDER BY COALESCE(l.is_default, 0) DESC, l.name`
        ).all();
        results = (r.results || []).filter((x: any) => Number(x.is_active ?? 1) === 1);
      } catch (e1: any) {
        // Fallback without is_active / subqueries
        console.error('locations query fallback', e1?.message);
        const r2 = await c.env.DB.prepare(`SELECT * FROM stock_locations ORDER BY name`).all();
        results = r2.results || [];
      }
      if (hasLiveCache(c.env)) {
        await doCachePut(c.env.MOBILE_HUB, c.env.CACHE, 'inventory:locations', results, 300);
      }
      return c.json({ success: true, data: results });
    } catch (e: any) {
      console.error('locations 500', e);
      return c.json({ success: false, error: e?.message || 'Erreur emplacements', code: 'LOCATIONS_FAILED' }, 500);
    }
  });
  

  app.get('/api/inventory/reorder', async (c) => {
    const callerRole = normalizeInventoryRole(sessionUserFromHeader(c.req.header('Authorization')).role);
    const { results } = await c.env.DB.prepare(
      `SELECT id, sku, name, stock_quantity, low_stock_threshold, cost, price, category
       FROM products
       WHERE is_active = 1 AND track_inventory = 1
         AND stock_quantity <= low_stock_threshold
       ORDER BY (stock_quantity - low_stock_threshold) ASC, name ASC
       LIMIT 200`
    ).all();
    return c.json({
      success: true,
      data: (results || []).map((p: any) => ({
        ...scrubProductForRole(p, callerRole),
        qty_to_order: Math.max(0, Number(p.low_stock_threshold || 0) * 2 - Number(p.stock_quantity || 0)),
      })),
    });
  });
  
  /** Phase 3 — create draft purchase bill from low-stock list */
  app.post('/api/inventory/reorder/draft-bill', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const body = await c.req.json().catch(() => ({}));
    const filterIds = Array.isArray(body.product_ids)
      ? body.product_ids.map((x: any) => Number(x)).filter((n: number) => n > 0)
      : [];
    let sql = `
      SELECT id, sku, name, stock_quantity, low_stock_threshold, cost, price, category
      FROM products
      WHERE is_active = 1 AND track_inventory = 1
        AND stock_quantity <= low_stock_threshold`;
    const binds: any[] = [];
    if (filterIds.length) {
      sql += ` AND id IN (${filterIds.map(() => '?').join(',')})`;
      binds.push(...filterIds);
    }
    sql += ` ORDER BY name ASC LIMIT 100`;
    const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
    const products = (results || []) as any[];
    if (!products.length) {
      return c.json({ success: false, error: 'Aucun produit à commander (seuil OK).' }, 400);
    }
    const vendor_name = String(body.vendor_name || 'Fournisseur (réappro)').slice(0, 120);
    const issue_date = new Date().toISOString().slice(0, 10);
    await ensureStockLocations(c.env.DB);
    const settings = await c.env.DB.prepare(
      `SELECT * FROM company_settings WHERE id = 1`
    ).first() as any;
    const currency = String(settings?.currency || settings?.finance_currency || 'MAD');
    const number = await nextDocumentNumber(c.env.DB, 'bill', settings, c.env);
    let subtotal = 0;
    const lineItems: any[] = [];
    for (const p of products) {
      const qty = Math.max(1, Math.ceil(Number(p.low_stock_threshold || 0) * 2 - Number(p.stock_quantity || 0)));
      const unit_cost = roundCurrency(Number(p.cost || 0), currency, 'invoice');
      const line_total = roundCurrency(qty * unit_cost, currency, 'invoice');
      subtotal = roundCurrency(subtotal + line_total, currency, 'invoice');
      lineItems.push({
        product_id: p.id,
        product_name: p.name,
        sku: p.sku || '',
        quantity: qty,
        unit_cost,
        tax_rate: 0,
        line_total,
      });
    }
    const billResult = await c.env.DB.prepare(
      `INSERT INTO bills (number, vendor_id, vendor_name, vendor_ice, vendor_address, issue_date, due_date, status, subtotal, tax_amount, total, notes)
       VALUES (?, NULL, ?, '', '', ?, ?, 'draft', ?, 0, ?, ?)`
    ).bind(
      number,
      vendor_name,
      issue_date,
      issue_date,
      subtotal,
      subtotal,
      'Brouillon auto — réapprovisionnement stock bas',
    ).run();
    const billId = billResult.meta.last_row_id;
    const itemStmts = lineItems.map((item) =>
      c.env.DB.prepare(
        `INSERT INTO bill_items (bill_id, product_id, product_name, sku, quantity, unit_cost, tax_rate, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(billId, item.product_id, item.product_name, item.sku, item.quantity, item.unit_cost, 0, item.line_total),
    );
    for (let i = 0; i < itemStmts.length; i += 100) {
      await c.env.DB.batch(itemStmts.slice(i, i + 100));
    }
    await afterBusinessMutation(c.env.CACHE, c.env.MOBILE_HUB);
    return c.json({
      success: true,
      data: { id: billId, number, lines: lineItems.length, total: subtotal },
      message: `Brouillon d'achat ${number} créé (${lineItems.length} lignes). Validez puis réceptionnez le stock.`,
    }, 201);
  });
  
  
  /* Phase1 extras loaded from phase1-extra.ts via inline routes below */
  
  
  app.post('/api/inventory/locations', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    await ensureStockLocations(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const code = String(body.code || '').trim().toUpperCase().slice(0, 16);
    const name = String(body.name || '').trim().slice(0, 80);
    if (!code || !name) return c.json({ success: false, error: 'Code et nom obligatoires' }, 400);
    try {
      await c.env.DB.prepare(`INSERT INTO stock_locations (code, name, is_default) VALUES (?, ?, 0)`).bind(code, name).run();
    } catch {
      return c.json({ success: false, error: 'Code déjà utilisé' }, 409);
    }
    const row = await c.env.DB.prepare(`SELECT * FROM stock_locations WHERE code = ?`).bind(code).first();
    return c.json({ success: true, data: row }, 201);
  });
  
  app.patch('/api/inventory/locations/:id', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    await ensureStockLocations(c.env.DB);
    const id = Number(c.req.param('id'));
    const body = await c.req.json().catch(() => ({}));
    if (body.is_default) {
      await c.env.DB.prepare(`UPDATE stock_locations SET is_default = 0`).run();
      await c.env.DB.prepare(`UPDATE stock_locations SET is_default = 1 WHERE id = ?`).bind(id).run();
    }
    if (body.name !== undefined) {
      await c.env.DB.prepare(`UPDATE stock_locations SET name = ? WHERE id = ?`).bind(String(body.name).slice(0, 80), id).run();
    }
    if (body.is_active !== undefined) {
      await c.env.DB.prepare(`UPDATE stock_locations SET is_active = ? WHERE id = ?`).bind(body.is_active ? 1 : 0, id).run();
    }
    const row = await c.env.DB.prepare(`SELECT * FROM stock_locations WHERE id = ?`).bind(id).first();
    return c.json({ success: true, data: row });
  });
  
  app.delete('/api/inventory/locations/:id', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    await ensureStockLocations(c.env.DB);
    const id = Number(c.req.param('id'));
    const loc = await c.env.DB.prepare(`SELECT * FROM stock_locations WHERE id = ?`).bind(id).first() as any;
    if (!loc) return c.json({ success: false, error: 'Emplacement introuvable' }, 404);
    const count = await c.env.DB.prepare(`SELECT COUNT(*) as c FROM stock_locations`).first() as any;
    if (Number(count?.c || 0) <= 1) {
      return c.json({ success: false, error: 'Impossible de supprimer le dernier emplacement.' }, 400);
    }
    const qty = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(quantity),0) as s FROM stock_location_qty WHERE location_id = ?`
    ).bind(id).first() as any;
    if (Number(qty?.s || 0) > 1e-9) {
      return c.json({
        success: false,
        error: `Stock encore présent (${Number(qty.s)} unités). Transférez vers un autre entrepôt avant suppression.`,
        code: 'LOCATION_NOT_EMPTY',
      }, 400);
    }
    // Move default if needed
    if (loc.is_default) {
      const other = await c.env.DB.prepare(
        `SELECT id FROM stock_locations WHERE id != ? ORDER BY id LIMIT 1`
      ).bind(id).first() as any;
      if (other?.id) {
        await c.env.DB.prepare(`UPDATE stock_locations SET is_default = 1 WHERE id = ?`).bind(other.id).run();
      }
    }
    await c.env.DB.prepare(`DELETE FROM stock_location_qty WHERE location_id = ?`).bind(id).run();
    await c.env.DB.prepare(`DELETE FROM stock_locations WHERE id = ?`).bind(id).run();
    // Clear settings pointing to this location
    try {
      await c.env.DB.prepare(
        `UPDATE company_settings SET sales_location_id = NULL WHERE sales_location_id = ?`
      ).bind(id).run();
      await c.env.DB.prepare(
        `UPDATE company_settings SET purchase_location_id = NULL WHERE purchase_location_id = ?`
      ).bind(id).run();
    } catch { /* */ }
    await afterBusinessMutation(c.env.CACHE, c.env.MOBILE_HUB);
    return c.json({ success: true, message: `Emplacement « ${loc.name} » supprimé.` });
  });
  
  /** Product placements (qty per warehouse) */
  app.get('/api/inventory/products/:id/placements', async (c) => {
    await ensureStockLocations(c.env.DB);
    await ensureOfflineOpsSchema(c.env.DB);
    const productId = c.req.param('id');
    // Seed from global if needed
    const prod = await c.env.DB.prepare(`SELECT id, name, stock_quantity, track_inventory, category, cost FROM products WHERE id = ?`).bind(productId).first() as any;
    if (!prod) return c.json({ success: false, error: 'Produit introuvable' }, 404);
    const cnt = await c.env.DB.prepare(`SELECT COUNT(*) as c FROM stock_location_qty WHERE product_id = ?`).bind(productId).first() as any;
    if (!Number(cnt?.c) && prod.track_inventory && Number(prod.stock_quantity || 0) > 0) {
      const def = await getDefaultLocationId(c.env.DB);
      if (def) {
        await c.env.DB.prepare(
          `INSERT OR REPLACE INTO stock_location_qty (location_id, product_id, quantity) VALUES (?, ?, ?)`
        ).bind(def, productId, Number(prod.stock_quantity || 0)).run();
      }
    }
    const { results } = await c.env.DB.prepare(
      `SELECT l.id as location_id, l.code, l.name, l.is_default, COALESCE(q.quantity, 0) as quantity
       FROM stock_locations l
       LEFT JOIN stock_location_qty q ON q.location_id = l.id AND q.product_id = ?
       WHERE COALESCE(l.is_active, 1) = 1
       ORDER BY COALESCE(l.is_default, 0) DESC, l.name`
    ).bind(productId).all();
    const revMap = new Map<number, number>();
    try {
      const revRows = await c.env.DB.prepare(
        `SELECT location_id, revision FROM stock_location_revisions WHERE CAST(product_id AS INTEGER) = ?`
      ).bind(Number(productId)).all();
      for (const rr of (revRows.results || []) as any[]) {
        revMap.set(Number(rr.location_id), Number(rr.revision || 0));
      }
    } catch { /* */ }
    const placements = (results || []).map((r: any) => ({
      location_id: r.location_id,
      code: r.code,
      name: r.name,
      is_default: !!r.is_default,
      quantity: Number(r.quantity || 0),
      revision: revMap.get(Number(r.location_id)) ?? 0,
    }));
    const total = placements.reduce((s: number, p: any) => s + p.quantity, 0);
    return c.json({
      success: true,
      data: {
        product_id: Number(productId),
        product_name: prod.name,
        category: prod.category || '',
        total,
        placements,
      },
    });
  });
  
  /**
   * Stock report by warehouse and/or category.
   * Query: location_id=all|number, group=category|product
   */
  app.get('/api/inventory/stock-report', async (c) => {
    try {
    const callerRole = normalizeInventoryRole(sessionUserFromHeader(c.req.header('Authorization')).role);
    const canSeeFin = roleCanSeeFinancial(callerRole);
    await ensureStockLocations(c.env.DB);
    const locParam = c.req.query('location_id') || 'all';
    const group = c.req.query('group') || 'product'; // product | category
  
    const { results: locs } = await c.env.DB.prepare(
      `SELECT id, code, name, is_default FROM stock_locations WHERE COALESCE(is_active,1)=1 ORDER BY is_default DESC, name`
    ).all();
    const locations = (locs || []) as any[];
  
    // Ensure products with only global stock are visible under default location
    const defId = await getDefaultLocationId(c.env.DB);
    if (defId) {
      const orphans = await c.env.DB.prepare(
        `SELECT p.id, p.stock_quantity FROM products p
         WHERE p.track_inventory = 1 AND p.is_active = 1 AND p.stock_quantity > 0
           AND NOT EXISTS (SELECT 1 FROM stock_location_qty q WHERE q.product_id = p.id)`
      ).all();
      for (const o of (orphans.results || []) as any[]) {
        await c.env.DB.prepare(
          `INSERT INTO stock_location_qty (location_id, product_id, quantity) VALUES (?, ?, ?)`
        ).bind(defId, o.id, Number(o.stock_quantity || 0)).run();
      }
    }
  
    let locationFilterSql = '';
    const binds: any[] = [];
    if (locParam !== 'all' && Number(locParam) > 0) {
      locationFilterSql = ' AND q.location_id = ? ';
      binds.push(Number(locParam));
    }
  
    const { results: rows } = await c.env.DB.prepare(
      `SELECT q.location_id, l.code as location_code, l.name as location_name,
              p.id as product_id, p.name as product_name, p.sku, p.category, p.cost,
              q.quantity, (q.quantity * COALESCE(p.cost, 0)) as value
       FROM stock_location_qty q
       INNER JOIN stock_locations l ON l.id = q.location_id
       INNER JOIN products p ON p.id = q.product_id
       WHERE p.is_active = 1 AND p.track_inventory = 1
         AND q.quantity != 0
         ${locationFilterSql}
       ORDER BY l.is_default DESC, l.name, p.category, p.name`
    ).bind(...binds).all();
  
    const lines: Array<{
      location_id: number;
      location_code: string;
      location_name: string;
      product_id: number;
      product_name: string;
      sku: string;
      category: string;
      quantity: number;
      unit_cost: number;
      value: number;
    }> = (rows || []).map((r: any) => ({
      location_id: r.location_id,
      location_code: r.location_code,
      location_name: r.location_name,
      product_id: r.product_id,
      product_name: r.product_name,
      sku: r.sku,
      category: r.category || 'Sans catégorie',
      quantity: Number(r.quantity || 0),
      unit_cost: Number(r.cost || 0),
      value: Number(r.value || 0),
    }));
  
    // Category totals (for selected scope)
    const byCategory: Record<string, { qty: number; value: number; products: number }> = {};
    for (const ln of lines) {
      const k = ln.category;
      if (!byCategory[k]) byCategory[k] = { qty: 0, value: 0, products: 0 };
      byCategory[k].qty += ln.quantity;
      byCategory[k].value += ln.value;
      byCategory[k].products += 1;
    }
  
    // Per warehouse summary
    const byWarehouse: Record<string, { location_id: number; name: string; code: string; qty: number; value: number; skus: number }> = {};
    for (const ln of lines) {
      const k = String(ln.location_id);
      if (!byWarehouse[k]) {
        byWarehouse[k] = {
          location_id: ln.location_id,
          name: ln.location_name,
          code: ln.location_code,
          qty: 0,
          value: 0,
          skus: 0,
        };
      }
      byWarehouse[k].qty += ln.quantity;
      byWarehouse[k].value += ln.value;
      byWarehouse[k].skus += 1;
    }
  
    // Category × warehouse matrix
    const categoryByWarehouse: { category: string; location_id: number; location_name: string; qty: number; value: number }[] = [];
    const matrixKey: Record<string, { category: string; location_id: number; location_name: string; qty: number; value: number }> = {};
    for (const ln of lines) {
      const k = `${ln.category}::${ln.location_id}`;
      if (!matrixKey[k]) {
        matrixKey[k] = {
          category: ln.category,
          location_id: ln.location_id,
          location_name: ln.location_name,
          qty: 0,
          value: 0,
        };
      }
      matrixKey[k].qty += ln.quantity;
      matrixKey[k].value += ln.value;
    }
    for (const v of Object.values(matrixKey)) categoryByWarehouse.push(v);
  
    const total_qty = lines.reduce((s, l) => s + l.quantity, 0);
    const total_value = lines.reduce((s, l) => s + l.value, 0);
  
    return c.json({
      success: true,
      data: {
        scope: locParam === 'all' ? 'all_warehouses' : `location_${locParam}`,
        location_id: locParam === 'all' ? null : Number(locParam),
        locations,
        lines: group === 'category' ? [] : lines.map((l) => canSeeFin ? l : {
          location_id: l.location_id,
          location_code: l.location_code,
          location_name: l.location_name,
          product_id: l.product_id,
          product_name: l.product_name,
          sku: l.sku,
          category: l.category,
          quantity: l.quantity,
        }),
        by_category: Object.entries(byCategory).map(([category, v]) => canSeeFin ? ({ category, ...v }) : ({ category, qty: v.qty, products: v.products })),
        by_warehouse: Object.values(byWarehouse).map((w) => canSeeFin ? w : ({ location_id: w.location_id, name: w.name, code: w.code, qty: w.qty, skus: w.skus })),
        category_by_warehouse: categoryByWarehouse.map((m) => canSeeFin ? m : ({ category: m.category, location_id: m.location_id, location_name: m.location_name, qty: m.qty })),
        totals: canSeeFin ? { qty: total_qty, value: total_value, lines: lines.length } : { qty: total_qty, lines: lines.length },
      },
    });
    } catch (e: any) {
      console.error('stock-report 500', e);
      return c.json({ success: false, error: e?.message || 'Erreur rapport stock', code: 'STOCK_REPORT_FAILED' }, 500);
    }
  });
  
  app.post('/api/inventory/transfer', async (c) => {
    const gate = requireFloorStock(c);
    if (!gate.ok) return gate.response;
    await ensureStockLocations(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const productId = Number(body.product_id);
    const qty = Number(body.quantity || 0);
    const fromId = Number(body.from_location_id || 0);
    const toId = Number(body.to_location_id || 0);
    const note = String(body.note || '').slice(0, 200);
    if (!productId || qty <= 0) return c.json({ success: false, error: 'Produit et quantité requis' }, 400);
    if (!toId) return c.json({ success: false, error: 'Destination requise' }, 400);
    if (fromId === toId) return c.json({ success: false, error: 'Source et destination identiques' }, 400);
    try {
      const fromLoc = fromId || (await getDefaultLocationId(c.env.DB));
      if (!fromLoc) return c.json({ success: false, error: 'Aucun emplacement source' }, 400);
      await adjustLocationStock(c.env.DB, productId, fromLoc, -qty);
      await adjustLocationStock(c.env.DB, productId, toId, qty, { allowNegative: false });
      await applyStockDelta(
        c.env.DB,
        productId,
        0,
        `Transfert emplacement ${fromLoc}→${toId} ×${qty}${note ? ' — ' + note : ''}`,
        'transfer',
        { type: 'adjustment', skipLocation: true, createdBy: gate.username },
      );
    } catch (e: any) {
      return c.json({ success: false, error: e?.message || 'Transfert impossible', code: e?.code }, 400);
    }
    await afterBusinessMutation(c.env.CACHE, c.env.MOBILE_HUB);
    return c.json({ success: true, message: `Transfert de ${qty} enregistré entre emplacements.` });
  });
  
  app.post('/api/inventory/cycle-count', async (c) => {
    const gate = requireFloorStock(c);
    if (!gate.ok) return gate.response;
    const body = await c.req.json().catch(() => ({}));
    const productId = Number(body.product_id);
    const counted = Number(body.counted_qty);
    const note = String(body.note || 'Inventaire').slice(0, 200);
    if (!productId || !Number.isFinite(counted) || counted < 0) {
      return c.json({ success: false, error: 'Produit et quantité comptée requis' }, 400);
    }
    const prod = await c.env.DB.prepare(`SELECT stock_quantity, track_inventory, name FROM products WHERE id = ?`).bind(productId).first() as any;
    if (!prod?.track_inventory) return c.json({ success: false, error: 'Produit non suivi' }, 400);
    const theoretical = Number(prod.stock_quantity || 0);
    const delta = counted - theoretical;
    if (Math.abs(delta) < 1e-9) {
      return c.json({ success: true, message: 'Aucun écart.', data: { delta: 0 } });
    }
    try {
      await applyStockDelta(c.env.DB, productId, delta, `Inventaire ${theoretical}→${counted} — ${note}`, 'cycle-count', {
        type: 'adjustment',
        allowNegative: true,
        locationId: body.location_id ? Number(body.location_id) : undefined,
        createdBy: gate.username,
      });
      if (body.location_id) {
        try { await bumpPlacementRevision(c.env.DB, null, productId, Number(body.location_id)); } catch { /* */ }
      }
    } catch (e: any) {
      return c.json({ success: false, error: e?.message || 'Ajustement impossible' }, 400);
    }
    await afterBusinessMutation(c.env.CACHE, c.env.MOBILE_HUB);
    return c.json({ success: true, message: `Écart ${delta > 0 ? '+' : ''}${delta} sur « ${prod.name} ».`, data: { delta, counted, theoretical } });
  });
  
  app.get('/api/inventory/valuation', async (c) => {
    try {
      const callerRole = normalizeInventoryRole(sessionUserFromHeader(c.req.header('Authorization')).role);
      if (!roleCanSeeFinancial(callerRole)) {
        return c.json({ success: false, error: 'Accès réservé owner/admin.', code: 'FORBIDDEN_ROLE' }, 403);
      }
      await ensureStockLocations(c.env.DB);
      const locParam = c.req.query('location_id') || 'all';
      let results: any[] = [];
      if (locParam !== 'all' && Number(locParam) > 0) {
        const r = await c.env.DB.prepare(
          `SELECT p.id as product_id, p.name, p.sku, p.category,
                  q.quantity as qty, p.cost as unit_cost,
                  (q.quantity * COALESCE(p.cost, 0)) as value
           FROM stock_location_qty q
           INNER JOIN products p ON p.id = q.product_id
           WHERE q.location_id = ? AND p.is_active = 1 AND p.track_inventory = 1 AND q.quantity > 0
           ORDER BY value DESC LIMIT 500`
        ).bind(Number(locParam)).all();
        results = r.results || [];
      } else {
        // Prefer product totals (always reliable); location sum when present
        const r = await c.env.DB.prepare(
          `SELECT p.id as product_id, p.name, p.sku, p.category,
                  p.stock_quantity as qty, p.cost as unit_cost,
                  (p.stock_quantity * COALESCE(p.cost, 0)) as value
           FROM products p
           WHERE p.is_active = 1 AND p.track_inventory = 1 AND p.stock_quantity > 0
           ORDER BY value DESC LIMIT 500`
        ).all();
        results = r.results || [];
      }
      const lines = (results || []).map((r: any) => ({
        product_id: r.product_id,
        name: r.name,
        sku: r.sku,
        category: r.category || 'Sans catégorie',
        qty: Number(r.qty || 0),
        unit_cost: Number(r.unit_cost || 0),
        value: Number(r.value || 0),
      }));
      const byCat: Record<string, number> = {};
      for (const l of lines) byCat[l.category] = (byCat[l.category] || 0) + l.value;
      let method: string = 'average';
      try { method = await getValuationMethod(c.env.DB); } catch { /* */ }
      return c.json({
        success: true,
        data: {
          lines,
          total_value: lines.reduce((s, l) => s + l.value, 0),
          by_category: Object.entries(byCat).map(([category, value]) => ({ category, value })),
          method,
          location_id: locParam === 'all' ? null : Number(locParam),
        },
      });
    } catch (e: any) {
      console.error('valuation 500', e);
      return c.json({ success: false, error: e?.message || 'Erreur valorisation', code: 'VALUATION_FAILED' }, 500);
    }
  });
  
  
  app.get('/api/inventory/auto-transfer-rules', async (c) => {
    await ensureValuationTables(c.env.DB);
    const { results } = await c.env.DB.prepare(`SELECT * FROM auto_transfer_rules ORDER BY id DESC`).all();
    return c.json({ success: true, data: results || [] });
  });
  
  app.post('/api/inventory/auto-transfer-rules', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    await ensureValuationTables(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const name = String(body.name || 'Réappro auto').slice(0, 80);
    const from_location_id = Number(body.from_location_id);
    const to_location_id = Number(body.to_location_id);
    if (!from_location_id || !to_location_id) {
      return c.json({ success: false, error: 'Emplacements source et destination obligatoires.' }, 400);
    }
    await c.env.DB.prepare(
      `INSERT INTO auto_transfer_rules (name, product_id, from_location_id, to_location_id, trigger_type, threshold, transfer_qty, is_active)
       VALUES (?, ?, ?, ?, 'low_stock', ?, ?, 1)`
    ).bind(
      name,
      body.product_id ? Number(body.product_id) : null,
      from_location_id,
      to_location_id,
      Number(body.threshold ?? 5),
      Number(body.transfer_qty ?? 10),
    ).run();
    const row = await c.env.DB.prepare(`SELECT * FROM auto_transfer_rules ORDER BY id DESC LIMIT 1`).first();
    return c.json({ success: true, data: row, message: 'Règle de transfert automatique créée.' }, 201);
  });
  
  app.delete('/api/inventory/auto-transfer-rules/:id', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    await c.env.DB.prepare(`DELETE FROM auto_transfer_rules WHERE id = ?`).bind(c.req.param('id')).run();
    return c.json({ success: true, message: 'Règle supprimée.' });
  });
  
  app.post('/api/inventory/auto-transfer-rules/run', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const body = await c.req.json().catch(() => ({}));
    let pids: any[] = Array.isArray(body.product_ids) ? body.product_ids : [];
    if (!pids.length) {
      const { results } = await c.env.DB.prepare(
        `SELECT id FROM products WHERE is_active = 1 AND track_inventory = 1 LIMIT 500`
      ).all();
      pids = (results || []).map((r: any) => r.id);
    }
    const result = await runAutoTransfers(c.env.DB, pids);
    await afterBusinessMutation(c.env.CACHE, c.env.MOBILE_HUB);
    return c.json({
      success: true,
      data: result,
      message: result.transferred
        ? `${result.transferred} transfert(s) automatique(s) effectué(s).`
        : 'Aucun transfert nécessaire (seuils OK ou stock source insuffisant).',
    });
  });
  
  
  
  app.get('/api/integrations/keys', async (c) => {
    const gate = requireOwner(c);
    if (!gate.ok) return gate.response;
    await ensureApiIntegrations(c.env.DB);
    const { results } = await c.env.DB.prepare(
      `SELECT id, name, key_prefix, scopes, is_active, last_used_at, created_at FROM api_keys ORDER BY id DESC`
    ).all();
    return c.json({ success: true, data: results || [] });
  });
  
  app.post('/api/integrations/keys', async (c) => {
    const gate = requireOwner(c);
    if (!gate.ok) return gate.response;
    await ensureApiIntegrations(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const name = String(body.name || 'Clé API').slice(0, 80);
    const scopes = String(body.scopes || 'read,write').slice(0, 120);
    const raw = `atlas_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const prefix = raw.slice(0, 12);
    const dig = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    const hash = [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, '0')).join('');
    await c.env.DB.prepare(
      `INSERT INTO api_keys (name, key_prefix, key_hash, scopes) VALUES (?, ?, ?, ?)`
    ).bind(name, prefix, hash, scopes).run();
    const row = await c.env.DB.prepare(`SELECT id, name, key_prefix, scopes, created_at FROM api_keys ORDER BY id DESC LIMIT 1`).first();
    return c.json({
      success: true,
      data: { ...row, key: raw },
      message: 'Clé créée — copiez-la maintenant, elle ne sera plus affichée.',
    }, 201);
  });
  
  app.delete('/api/integrations/keys/:id', async (c) => {
    const gate = requireOwner(c);
    if (!gate.ok) return gate.response;
    await c.env.DB.prepare(`DELETE FROM api_keys WHERE id = ?`).bind(c.req.param('id')).run();
    return c.json({ success: true, message: 'Clé révoquée.' });
  });
  
  app.get('/api/integrations/webhooks', async (c) => {
    const gate = requireOwner(c);
    if (!gate.ok) return gate.response;
    await ensureApiIntegrations(c.env.DB);
    const { results } = await c.env.DB.prepare(`SELECT * FROM webhooks ORDER BY id DESC`).all();
    return c.json({ success: true, data: results || [] });
  });
  
  app.post('/api/integrations/webhooks', async (c) => {
    const gate = requireOwner(c);
    if (!gate.ok) return gate.response;
    await ensureApiIntegrations(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    let safeUrl: URL;
    try {
      safeUrl = assertSafeOutboundUrl(String(body.url || '').trim());
    } catch {
      return c.json({ success: false, error: 'URL HTTPS publique obligatoire.' }, 400);
    }
    const events = String(body.events || 'invoice.created,payment.created,stock.adjusted').slice(0, 200);
    const secret = String(body.secret || crypto.randomUUID()).slice(0, 64);
    await c.env.DB.prepare(
      `INSERT INTO webhooks (url, events, secret) VALUES (?, ?, ?)`
    ).bind(safeUrl.toString(), events, secret).run();
    const row = await c.env.DB.prepare(`SELECT * FROM webhooks ORDER BY id DESC LIMIT 1`).first();
    return c.json({ success: true, data: row, message: 'Webhook enregistré.' }, 201);
  });
  
  app.delete('/api/integrations/webhooks/:id', async (c) => {
    const gate = requireOwner(c);
    if (!gate.ok) return gate.response;
    await c.env.DB.prepare(`DELETE FROM webhooks WHERE id = ?`).bind(c.req.param('id')).run();
    return c.json({ success: true, message: 'Webhook supprimé.' });
  });
  
  /** FIFO / valuation COGS snapshot for P&amp;L */
  
  app.get('/api/delivery-notes', async (c) => {
    await ensureDeliveryNotes(c.env.DB);
    const { results } = await c.env.DB.prepare(`SELECT * FROM delivery_notes ORDER BY id DESC LIMIT 100`).all();
    return c.json({ success: true, data: results || [] });
  });
  
  app.post('/api/delivery-notes', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    await ensureDeliveryNotes(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const invoiceId = Number(body.invoice_id || 0);
    const inv = invoiceId ? await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(invoiceId).first() as any : null;
    if (invoiceId && !inv) return c.json({ success: false, error: 'Facture introuvable' }, 404);
    const year = new Date().getFullYear();
    const { results: existing } = await c.env.DB.prepare(`SELECT number FROM delivery_notes WHERE number LIKE ?`).bind(`BL-${year}-%`).all();
    let max = 0;
    for (const r of (existing || []) as any[]) {
      const m = String(r.number).match(/(\d+)$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    const number = `BL-${year}-${String(max + 1).padStart(4, '0')}`;
    const issue_date = String(body.issue_date || new Date().toISOString().slice(0, 10));
    const client_name = inv?.client_name || String(body.client_name || '');
    const ins = await c.env.DB.prepare(
      `INSERT INTO delivery_notes (number, invoice_id, client_name, issue_date, notes, status) VALUES (?, ?, ?, ?, ?, 'confirmed')`
    ).bind(number, invoiceId || null, client_name, issue_date, String(body.notes || '')).run();
    const dnId = ins.meta.last_row_id;
    let items: any[] = Array.isArray(body.items) ? body.items : [];
    if (!items.length && invoiceId) {
      const { results: invItems } = await c.env.DB.prepare(
        `SELECT product_id, product_name, quantity FROM invoice_items WHERE invoice_id = ?`
      ).bind(invoiceId).all();
      items = invItems || [];
    }
    for (const it of items) {
      await c.env.DB.prepare(
        `INSERT INTO delivery_note_items (delivery_note_id, product_id, product_name, quantity) VALUES (?, ?, ?, ?)`
      ).bind(dnId, it.product_id || null, it.product_name || it.name || '', Number(it.quantity || 0)).run();
    }
    const row = await c.env.DB.prepare(`SELECT * FROM delivery_notes WHERE id = ?`).bind(dnId).first();
    return c.json({ success: true, data: row, message: `Bon de livraison ${number} créé.` }, 201);
  });
  
  app.get('/api/delivery-notes/:id/print', async (c) => {
    await ensureDeliveryNotes(c.env.DB);
    const id = c.req.param('id');
    const dn = await c.env.DB.prepare(`SELECT * FROM delivery_notes WHERE id = ?`).bind(id).first() as any;
    if (!dn) return c.json({ success: false, error: 'BL introuvable' }, 404);
    const { results: items } = await c.env.DB.prepare(`SELECT * FROM delivery_note_items WHERE delivery_note_id = ?`).bind(id).all();
    const settings = await c.env.DB.prepare(`SELECT company_name FROM company_settings WHERE id = 1`).first() as any;
    const rows = (items || []).map((it: any) =>
      `<tr><td>${escapeHtml(String(it.product_name || ''))}</td><td style="text-align:right">${Number(it.quantity || 0)}</td></tr>`
    ).join('');
    return c.html(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/><title>${escapeHtml(String(dn.number || ''))}</title>
    <style>body{font-family:system-ui;max-width:720px;margin:24px auto}table{width:100%;border-collapse:collapse}
    td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}</style></head><body>
    <h1>Bon de livraison ${escapeHtml(String(dn.number || ''))}</h1>
    <p>${escapeHtml(String(settings?.company_name || ''))}<br/>Client : <strong>${escapeHtml(String(dn.client_name || '—'))}</strong><br/>Date : ${escapeHtml(String(dn.issue_date || ''))}</p>
    <table><thead><tr><th>Article</th><th style="text-align:right">Qté</th></tr></thead><tbody>${rows}</tbody></table>
    <p style="margin-top:12px">Réception — signature : _______________</p>
    <script>window.onload=()=>window.print()</script></body></html>`);
  });
  
  
  app.post('/api/bills/:id/receive', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    await ensureBillReceive(c.env.DB);
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const bill = await c.env.DB.prepare(`SELECT * FROM bills WHERE id = ?`).bind(id).first() as any;
    if (!bill) return c.json({ success: false, error: 'Facture d’achat introuvable' }, 404);
    if (bill.status === 'cancelled') {
      return c.json({ success: false, error: 'Facture d’achat annulée — réception refusée.', code: 'BILL_CANCELLED' }, 400);
    }
    let locationId = body.location_id ? Number(body.location_id) : null;
    if (!locationId) {
      try { locationId = await getDefaultLocationId(c.env.DB); } catch { locationId = null; }
    }
    const { results: items } = await c.env.DB.prepare(`SELECT * FROM bill_items WHERE bill_id = ?`).bind(id).all();
    const byId = new Map<number, Record<string, any>>((items || []).map((it: any) => [Number(it.id), it as Record<string, any>]));
    for (const raw of (Array.isArray(body.items) ? body.items : [])) {
      const src = byId.get(Number(raw.bill_item_id || raw.id));
      if (!src) continue;
      const add = Number(raw.qty_received || raw.quantity || 0);
      if (add <= 0) continue;
      const prevRecv = Number(src.qty_received || 0);
      const nextRecv = Math.min(Number(src.quantity || 0), prevRecv + add);
      const delta = nextRecv - prevRecv;
      await c.env.DB.prepare(`UPDATE bill_items SET qty_received = ? WHERE id = ?`).bind(nextRecv, src.id).run();
      if (src.product_id && delta > 0) {
        await applyStockDelta(c.env.DB, src.product_id, delta, `Réception ${bill.number}`, bill.number, {
          type: 'purchase',
          createdBy: sessionUserFromHeader(c.req.header('Authorization')).username || undefined,
          locationId: locationId || undefined,
        });
      }
    }
    const { results: after } = await c.env.DB.prepare(`SELECT quantity, qty_received FROM bill_items WHERE bill_id = ?`).bind(id).all();
    let all = true, any = false;
    for (const it of (after || []) as any[]) {
      if (Number(it.qty_received || 0) > 0) any = true;
      if (Number(it.qty_received || 0) + 1e-9 < Number(it.quantity || 0)) all = false;
    }
    const receive_status = all ? 'matched' : any ? 'partial' : 'pending';
    try { await c.env.DB.prepare(`UPDATE bills SET receive_status = ? WHERE id = ?`).bind(receive_status, id).run(); } catch { /* */ }
    await afterBusinessMutation(c.env.CACHE, c.env.MOBILE_HUB);
    return c.json({
      success: true,
      data: await c.env.DB.prepare(`SELECT * FROM bills WHERE id = ?`).bind(id).first(),
      message: receive_status === 'matched' ? 'Réception complète — 3 voies OK.' : `Réception ${receive_status}.`,
    });
  });
  
  app.get('/api/bills/:id/match', async (c) => {
    await ensureBillReceive(c.env.DB);
    const id = c.req.param('id');
    const bill = await c.env.DB.prepare(`SELECT * FROM bills WHERE id = ?`).bind(id).first() as any;
    if (!bill) return c.json({ success: false, error: 'Introuvable' }, 404);
    const { results: items } = await c.env.DB.prepare(
      `SELECT bi.*, p.sku as product_sku, p.barcode as product_barcode, p.id as resolved_product_id
       FROM bill_items bi
       LEFT JOIN products p ON p.id = bi.product_id OR (bi.product_id IS NULL AND lower(p.name) = lower(bi.product_name))
       WHERE bi.bill_id = ?`
    ).bind(id).all();
    const lines = (items || []).map((it: any) => {
      const ordered = Number(it.quantity || 0);
      const received = Number(it.qty_received || 0);
      return {
        id: it.id,
        product_id: it.product_id || it.resolved_product_id || null,
        product_name: it.product_name,
        sku: it.product_sku || it.sku || null,
        barcode: it.product_barcode || it.barcode || null,
        ordered,
        received,
        billed: ordered,
        match: Math.abs(ordered - received) < 1e-6,
      };
    });
    return c.json({ success: true, data: { bill, lines, three_way_ok: lines.every((l: any) => l.match) } });
  });
  
  app.post('/api/bank/reconcile-csv', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const body = await c.req.json().catch(() => ({}));
    const csv = String(body.csv || body.text || '');
    const dateWindowDays = Math.min(60, Math.max(0, Number(body.date_window_days ?? 7)));
    if (!csv.trim()) return c.json({ success: false, error: 'Coller le CSV (date;libellé;montant)' }, 400);
  
    const parsed: { date: string; label: string; amount: number; line: number }[] = [];
    let lineNo = 0;
    for (const line of csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      lineNo++;
      if (/^date/i.test(line) || /libell/i.test(line) || /^amount/i.test(line)) continue;
      const parts = line.split(/[;,\t]/);
      if (parts.length < 2) continue;
      const amountRaw = parts[parts.length - 1].replace(/\s/g, '').replace(/MAD/gi, '').replace(',', '.');
      const amount = Number(amountRaw);
      if (!Number.isFinite(amount)) continue;
      let date = parts[0].trim().slice(0, 10);
      const dm = date.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
      if (dm) date = `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
      parsed.push({
        date,
        label: parts.slice(1, -1).join(' ').trim() || parts[1] || '',
        amount,
        line: lineNo,
      });
    }
  
    await ensurePaymentHistoryTable(c.env.DB);
    try { await ensureBillPaymentsTable(c.env.DB); } catch { /* */ }
  
    const { results: expenses } = await c.env.DB.prepare(
      `SELECT id, amount, description, expense_date, entry_type, reference, notes, payment_method
       FROM expenses ORDER BY id DESC LIMIT 2000`
    ).all();
    const { results: invPays } = await c.env.DB.prepare(
      `SELECT p.id, p.amount, p.paid_at, p.payment_method, p.note, i.number as invoice_number, i.client_name
       FROM invoice_payments p LEFT JOIN invoices i ON i.id = p.invoice_id
       ORDER BY p.id DESC LIMIT 1000`
    ).all();
    let billPays: any[] = [];
    try {
      const bp = await c.env.DB.prepare(
        `SELECT p.id, p.amount, p.paid_at, p.payment_method, p.note, b.number as bill_number, b.vendor_name
         FROM bill_payments p LEFT JOIN bills b ON b.id = p.bill_id
         ORDER BY p.id DESC LIMIT 1000`
      ).all();
      billPays = (bp.results || []) as any[];
    } catch { billPays = []; }
  
    type Cand = {
      kind: 'expense' | 'invoice_payment' | 'bill_payment';
      id: number;
      amount: number;
      date: string;
      label: string;
      ref: string;
      entry_type?: string;
    };
    const candidates: Cand[] = [];
    for (const e of (expenses || []) as any[]) {
      candidates.push({
        kind: 'expense',
        id: Number(e.id),
        amount: Number(e.amount || 0),
        date: String(e.expense_date || '').slice(0, 10),
        label: `${e.description || ''} ${e.reference || ''} ${e.notes || ''}`,
        ref: String(e.reference || ''),
        entry_type: String(e.entry_type || ''),
      });
    }
    for (const p of (invPays || []) as any[]) {
      candidates.push({
        kind: 'invoice_payment',
        id: Number(p.id),
        amount: Number(p.amount || 0),
        date: String(p.paid_at || '').slice(0, 10),
        label: `${p.invoice_number || ''} ${p.client_name || ''} ${p.note || ''}`,
        ref: String(p.invoice_number || ''),
      });
    }
    for (const p of billPays) {
      candidates.push({
        kind: 'bill_payment',
        id: Number(p.id),
        amount: Number(p.amount || 0),
        date: String(p.paid_at || '').slice(0, 10),
        label: `${p.bill_number || ''} ${p.vendor_name || ''} ${p.note || ''}`,
        ref: String(p.bill_number || ''),
      });
    }
  
    const dayMs = 86400000;
    const used = new Set<string>();
    const matches: any[] = [];
    const unmatched: any[] = [];
    const norm = (s: string) =>
      String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
  
    for (const row of parsed) {
      const amt = Math.abs(row.amount);
      const bankDate = Date.parse(row.date);
      const bankLabel = norm(row.label);
      const docHint = (row.label.match(/(?:FA|ACHAT|BL|DEV|FAC)[-\s]?\d{4}[-\s]?\d+/i) || [])[0] || '';
      const docNorm = norm(docHint);
  
      let best: { score: number; c: Cand; reasons: string[] } | null = null;
      for (const cand of candidates) {
        const key = `${cand.kind}:${cand.id}`;
        if (used.has(key)) continue;
        const amtDiff = Math.abs(Math.abs(cand.amount) - amt);
        if (amtDiff > 0.51) continue;
  
        let score = 40;
        const reasons = [`montant±${amtDiff.toFixed(2)}`];
  
        if (row.amount > 0 && (cand.kind === 'invoice_payment' || (cand.kind === 'expense' && String(cand.entry_type || '').includes('income')))) {
          score += 8;
          reasons.push('sens crédit');
        }
        if (row.amount < 0 && (cand.kind === 'bill_payment' || cand.kind === 'expense')) {
          score += 8;
          reasons.push('sens débit');
        }
  
        if (cand.date && Number.isFinite(bankDate)) {
          const d = Date.parse(cand.date);
          if (Number.isFinite(d)) {
            const days = Math.abs(bankDate - d) / dayMs;
            if (days <= dateWindowDays) {
              score += Math.max(0, 25 - days * 2);
              reasons.push(`date±${Math.round(days)}j`);
            } else {
              score -= 15;
            }
          }
        }
  
        const cLabel = norm(cand.label);
        if (docNorm && (cLabel.includes(docNorm) || norm(cand.ref).includes(docNorm))) {
          score += 35;
          reasons.push('n° document');
        } else if (bankLabel && cLabel) {
          const words = bankLabel.split(' ').filter((w) => w.length > 3);
          let hits = 0;
          for (const w of words.slice(0, 8)) {
            if (cLabel.includes(w)) hits++;
          }
          if (hits >= 2) {
            score += 12 + hits;
            reasons.push(`libellé×${hits}`);
          } else if (hits === 1) {
            score += 5;
            reasons.push('libellé partiel');
          }
        }
  
        if (!best || score > best.score) best = { score, c: cand, reasons };
      }
  
      if (best && best.score >= 45) {
        used.add(`${best.c.kind}:${best.c.id}`);
        matches.push({
          bank: row,
          match: {
            kind: best.c.kind,
            id: best.c.id,
            amount: best.c.amount,
            date: best.c.date,
            label: best.c.label.slice(0, 120),
            ref: best.c.ref,
          },
          score: Math.round(best.score),
          reasons: best.reasons,
          expense_id: best.c.kind === 'expense' ? best.c.id : null,
        });
      } else {
        unmatched.push(row);
      }
    }
  
    return c.json({
      success: true,
      data: {
        parsed: parsed.length,
        matched: matches.length,
        unmatched_count: unmatched.length,
        date_window_days: dateWindowDays,
        matches: matches.slice(0, 150),
        unmatched: unmatched.slice(0, 150),
        rules: [
          'Montant ±0,50 MAD',
          `Date ±${dateWindowDays} jours (bonus)`,
          'N° document dans le libellé (FA-/ACHAT-…)',
          'Mots du libellé (fuzzy)',
          'Sens crédit/débit',
          'Un mouvement Atlas n’est utilisé qu’une fois',
        ],
      },
      message: `${matches.length} rapprochée(s), ${unmatched.length} sans correspondance.`,
    });
  });
  
}
