import type { Hono } from 'hono';
import { normalizeProductImageReference } from '../lib/product-images';
import { ensureProductActors, withInventoryActors } from '../lib/inventory-actors';
import { schemaOnce, addColumnIfMissing } from '../lib/schema';
import { doCacheGet, doCachePut, invalidateDashboardCache, DEFAULT_CACHE_TTL } from '../lib/cache';
import { canHardDeleteStock } from '../lib/rbac';
import { apiFail } from '../lib/api-response';
import { proactiveFtsHealth, ensureProductSearchIndex } from '../lib/reliability';
import { validateProductWrite } from '../lib/validate';
import { deleteProductImagesFromR2, afterBusinessMutation } from '../lib/delete-coord';
import { ensureMarbleUnits, ensureStockLocations, placeProductStockOnDefault, getDefaultLocationId } from './inventoryOps';
import { normalizeInventoryRole, roleCanDirectAdjustStock, roleCanSeeSellPrices, scrubProductForRole } from '../lib/inventory-policy';

export interface ProductsScanRouteDeps {
  sessionUserFromHeader: (header: string | undefined) => any;
  requireBizMutator: (c: any) => any;
  checkConfirmPassword: (env: any, db: D1Database, authHeader: string | undefined, body: any) => Promise<any>;
  issueDeleteOtp: (...args: any[]) => Promise<any>;
  writeAudit: (db: D1Database, entry: any) => Promise<void>;
  refreshLimitGate: (c: any, endpoint: string, maxPerMinute?: number) => Response | null;
  readProductImageJson: (c: any) => Promise<any>;
  productImageFailure: (c: any, err: any) => Response;
  applyStockDelta: (...args: any[]) => Promise<any>;
  ensureCategoriesTable: (db: D1Database) => Promise<void>;
  ensureUnitsTable: (db: D1Database) => Promise<void>;
  ensureProductBulkDiscounts: (db: D1Database) => Promise<void>;
  tableColumns: (db: D1Database, table: string) => Promise<Set<string> | null>;
  hasColumn: (db: D1Database, table: string, column: string) => Promise<boolean>;
}

/* ─── Products & variants ─── */

/**
 * Variants = child product rows with parent_id set.
 * Each has its own sku, barcode, price, stock (same stock/audit system).
 * Columns: parent_id, variant_label, attributes (JSON e.g. {"size":"M","color":"Rouge"})
 *
 * Mobile / APK barcode flow (ready for future app):
 *   GET  /api/scan/barcode/:code     → lookup by barcode or SKU
 *   POST /api/scan/quick-product     → create product from scanned barcode
 *   POST /api/invoices               → same as web (client adds lines after scan)
 */

async function ensureProductDualUnits(db: D1Database) {
  await addColumnIfMissing(db, 'products', 'secondary_unit', 'TEXT DEFAULT NULL');
  await addColumnIfMissing(db, 'products', 'secondary_unit_factor', 'REAL DEFAULT NULL');
}

/** 1 primary stock unit = factor secondary units; stock itself is unchanged. */
function normalizeDualUnits(body: any, existing: any = {}): string | null {
  const unitValue = body.secondary_unit !== undefined ? body.secondary_unit : existing.secondary_unit;
  const factorValue = body.secondary_unit_factor !== undefined ? body.secondary_unit_factor : existing.secondary_unit_factor;
  const secondary = typeof unitValue === 'string' ? unitValue.trim() : unitValue == null ? '' : null;
  const emptyFactor = factorValue === '' || factorValue == null;
  if (secondary === null || secondary.length > 40) return 'Unité secondaire invalide.';
  if (!secondary && emptyFactor) { body.secondary_unit = null; body.secondary_unit_factor = null; return null; }
  if (!secondary || emptyFactor || typeof factorValue === 'boolean') return 'Indiquez une deuxième unité et un coefficient positif.';
  const factor = Number(factorValue);
  if (!Number.isFinite(factor) || factor <= 0 || factor > 1_000_000_000) return 'Le coefficient doit être un nombre positif valide.';
  const primary = String(body.unit ?? existing.unit ?? '').trim();
  if (!primary || primary.toLowerCase() === secondary.toLowerCase()) return 'Les deux unités doivent être différentes.';
  body.secondary_unit = secondary;
  body.secondary_unit_factor = factor;
  return null;
}

async function ensureProductVariantColumns(db: D1Database) {
  await schemaOnce('product_variants', async () => {
  await addColumnIfMissing(db, 'products', 'parent_id', `INTEGER DEFAULT NULL`);
  await addColumnIfMissing(db, 'products', 'variant_label', `TEXT DEFAULT ''`);
  await addColumnIfMissing(db, 'products', 'attributes', `TEXT DEFAULT '{}'`);
  await addColumnIfMissing(db, 'products', 'tax_rate', `REAL DEFAULT NULL`);
  await addColumnIfMissing(db, 'products', 'invoice_price_mode', `TEXT DEFAULT NULL`);
  await ensureProductDualUnits(db);
  await addColumnIfMissing(db, 'products', 'bulk_discounts', `TEXT DEFAULT '[]'`);
  await addColumnIfMissing(db, 'products', 'lot_number', `TEXT`);
  await addColumnIfMissing(db, 'products', 'expiry_date', `TEXT`);
  await addColumnIfMissing(db, 'products', 'barcode', `TEXT DEFAULT ''`);
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)`).run();
  } catch { /* */ }
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)`).run();
  } catch { /* */ }
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)`).run();
  } catch { /* */ }
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_products_parent ON products(parent_id)`).run();
  } catch { /* */ }
  });
}


function friendlyFkDeleteError(e: any): string {
  const msg = String(e?.message || e || '');
  if (/FOREIGN KEY|SQLITE_CONSTRAINT/i.test(msg)) {
    return 'Impossible de supprimer : ce produit est encore lié à des documents ou au stock. Les liens ont été nettoyés — réessayez. Si l’erreur persiste, contactez le support.';
  }
  return msg || 'Échec de la suppression';
}

export function registerProductsScanRoutes(app: Hono<any>, deps: ProductsScanRouteDeps): void {
  const {
    sessionUserFromHeader,
    requireBizMutator,
    checkConfirmPassword,
    issueDeleteOtp,
    writeAudit,
    refreshLimitGate,
    readProductImageJson,
    productImageFailure,
    applyStockDelta,
    ensureCategoriesTable,
    ensureUnitsTable,
    ensureProductBulkDiscounts,
    tableColumns,
    hasColumn,
  } = deps;

  app.get('/api/products', async (c) => {
    const limited = refreshLimitGate(c, 'products', 60);
    if (limited) return limited;
    void proactiveFtsHealth(c.env.DB);
    // Parse filters first so mobile/light can skip schema DDL (big latency win)
    const q = String(c.req.query('q') || c.req.query('search') || '').trim().toLowerCase();
    const category = String(c.req.query('category') || '').trim();
    const parentId = c.req.query('parent_id');
    const includeVariants = c.req.query('include_variants') === '1';
    const variantsOnly = c.req.query('variants_only') === '1';
    const fields = String(c.req.query('fields') || '').trim().toLowerCase();
    const light = fields === 'mobile' || fields === 'light' || fields === 'id,name,sku,barcode,stock,price';
    if (!light) { try { await ensureProductVariantColumns(c.env.DB); } catch { /* */ } }
    const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') || (light ? 300 : 200))));
  
    // Full desk path only: schema ensures (mobile never needs them on every list call)
    if (!light) {
      try { await ensureStockLocations(c.env.DB); } catch { /* */ }
      try { await ensureMarbleUnits(c.env.DB); } catch { /* */ }
      await ensureProductVariantColumns(c.env.DB);
    }
  
    // Cache only stable list queries (no free-text search) via DO + memory (avoids KV write cap)
    const cacheable = !q && !parentId && !category;
    const prodCacheSlug = `products:${[includeVariants ? 'v' : 'p', variantsOnly ? 'vo' : '', light ? 'm6-actors-images-price-dual-unit' : 'f-actors', String(limit)].filter(Boolean).join(':')}`;
    const prodTtl = Math.max(120, Number(c.env.CACHE_TTL_SECONDS || DEFAULT_CACHE_TTL));
    if (cacheable) {
      const hit = await doCacheGet<any>(c.env.MOBILE_HUB, c.env.CACHE, prodCacheSlug, prodTtl);
      if (hit) {
        return c.json(
          { success: true, data: (hit as any[]).map(r => scrubProductForRole(withInventoryActors(r), normalizeInventoryRole(sessionUserFromHeader(c.req.header('Authorization')).role))), meta: { cache: 'hit', fields: light ? 'mobile' : 'full' } },
          200,
          { 'Cache-Control': light ? 'private, max-age=60' : 'private, max-age=20' },
        );
      }
    }
  
    // Keep the mobile projection small while including product artwork where available.
    const productColumns = light ? await tableColumns(c.env.DB, 'products') : null;
    const actorCols = ['created_by', 'approved_by'].filter(col => productColumns?.has(col)).map(col => `, ${col}`).join('');
    // Legacy inline photos can be megabytes each. Defer large images to the
    // per-product endpoint instead of putting hundreds in the mobile cache.
    const priceModeCols = ['tax_rate', 'invoice_price_mode', 'secondary_unit', 'secondary_unit_factor'].filter(col => productColumns?.has(col)).map(col => `, ${col}`).join('');
    const imageCols = productColumns?.has('image_url') ? `, CASE WHEN length(image_url) > 262144 THEN NULL ELSE image_url END AS image_url, CASE WHEN length(image_url) > 262144 THEN 1 ELSE 0 END AS image_inline_large` : '';
    const cols = light
      ? `id, sku, name, barcode, category, unit, price, stock_quantity, low_stock_threshold, parent_id, variant_label, is_active, track_inventory${actorCols}${priceModeCols}${imageCols}`
      : `*`;
    let sql = `SELECT ${cols} FROM products WHERE is_active = 1`;
    const binds: any[] = [];
    if (parentId) {
      sql += ` AND parent_id = ?`;
      binds.push(Number(parentId));
    } else if (variantsOnly) {
      sql += ` AND parent_id IS NOT NULL AND parent_id != 0`;
    } else if (!includeVariants) {
      sql += ` AND (parent_id IS NULL OR parent_id = 0)`;
    }
    if (q) {
      // Prefer FTS5 index when available (stronger ranking); fall back to multi-column LIKE
      let usedFts = false;
      try {
        const ok = await ensureProductSearchIndex(c.env.DB);
        if (ok) {
          const ftsQuery = q
            .split(/\s+/)
            .filter(Boolean)
            .map((tok) => `"${tok.replace(/"/g, '')}"*`)
            .join(' ');
          sql += ` AND id IN (SELECT rowid FROM products_fts WHERE products_fts MATCH ?)`;
          binds.push(ftsQuery);
          usedFts = true;
        }
      } catch { /* fall through */ }
      if (!usedFts) {
        sql += ` AND (LOWER(name) LIKE ? OR LOWER(COALESCE(sku,'')) LIKE ? OR LOWER(COALESCE(barcode,'')) LIKE ? OR LOWER(COALESCE(category,'')) LIKE ? OR LOWER(COALESCE(variant_label,'')) LIKE ?)`;
        const like = `%${q}%`;
        binds.push(like, like, like, like, like);
      }
    }
    if (category) {
      sql += ` AND category = ?`;
      binds.push(category);
    }
    sql += ` ORDER BY name LIMIT ?`;
    binds.push(limit);
    let results: any[] = [];
    try {
      const r = await c.env.DB.prepare(sql).bind(...binds).all();
      results = r.results || [];
    } catch (e) {
      console.warn('[products-list] query failed, simple fallback', e);
      // Safe fallback: no FTS, basic active products
      try {
        const r2 = await c.env.DB.prepare(
          `SELECT id, sku, name, barcode, category, unit, price, stock_quantity, low_stock_threshold, parent_id, variant_label, is_active, track_inventory
           FROM products WHERE is_active = 1 ORDER BY name LIMIT ?`,
        ).bind(limit).all();
        results = r2.results || [];
      } catch (e2) {
        console.error('[products-list] fallback failed', e2);
        return apiFail(c, 'Impossible de charger les produits', 'INTERNAL');
      }
    }
    if (cacheable) {
      await doCachePut(c.env.MOBILE_HUB, c.env.CACHE, prodCacheSlug, results, light ? Math.max(prodTtl, 180) : prodTtl);
    }
    // v0.7.1 — inventory privacy: omit price/cost fields server-side per role.
    const listRole = normalizeInventoryRole(sessionUserFromHeader(c.req.header('Authorization')).role);
    results = (results || []).map((r: any) => scrubProductForRole(withInventoryActors(r), listRole));
    return c.json(
      { success: true, data: results, meta: { cache: cacheable ? 'miss' : 'bypass', fields: light ? 'mobile' : 'full' } },
      200,
      { 'Cache-Control': light ? 'private, max-age=60' : 'private, max-age=15' },
    );
  });
  
  app.get('/api/products/:id', async (c) => {
    await ensureProductVariantColumns(c.env.DB);
    const id = c.req.param('id');
    const product = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(id).first() as any;
    if (!product) return c.json({ success: false, error: 'Produit introuvable' }, 404);
    let variants: any[] = [];
    if (!product.parent_id) {
      const { results } = await c.env.DB.prepare(
        `SELECT * FROM products WHERE parent_id = ? AND is_active = 1 ORDER BY variant_label, name`
      ).bind(id).all();
      variants = results || [];
    }
    const oneRole = normalizeInventoryRole(sessionUserFromHeader(c.req.header('Authorization')).role);
    const scrubbed = scrubProductForRole(withInventoryActors(product), oneRole);
    return c.json({
      success: true,
      data: { ...scrubbed, variants: (variants || []).map((v: any) => scrubProductForRole(withInventoryActors(v), oneRole)) },
    });
  });
  
  app.post('/api/products', async (c) => {
    try { await ensureProductVariantColumns(c.env.DB); } catch { /* */ }
    // cache invalidated after successful write below
    await ensureProductBulkDiscounts(c.env.DB);
    let body: any;
    try { body = await readProductImageJson(c); } catch (e) { return productImageFailure(c, e); }
    const verr = validateProductWrite(body);
    if (verr) return apiFail(c, verr.name || Object.values(verr)[0] || 'Validation', 'VALIDATION', verr);
    const { name, sku, description = '', category = 'General', unit = 'unit', price = 0, cost = 0, stock_quantity = 0, low_stock_threshold = 5, track_inventory = 1, barcode = '', tax_rate = null } = body;
    let image_url = String(body.image_url || '').trim();
    if (!name) return apiFail(c, 'Le nom du produit est obligatoire', 'VALIDATION');
    if (body.secondary_unit !== undefined || body.secondary_unit_factor !== undefined) {
      const error = normalizeDualUnits(body, { unit });
      if (error) return apiFail(c, error, 'VALIDATION');
      await ensureProductDualUnits(c.env.DB);
    }
    if (body.invoice_price_mode != null && !['inclusive', 'exclusive'].includes(body.invoice_price_mode)) return apiFail(c, 'Mode de prix facture invalide', 'VALIDATION');
  
    // Duplicate handling API:
    // Checks: SKU (case-insensitive), barcode (exact), name (case-insensitive).
    // On conflict → HTTP 409, code: DUPLICATE_PRODUCT, fields: error, duplicate, matches[].
    // Override: body.force_duplicate = true
    const force = !!body.force_duplicate;
    const dupChecks: { label: string; row: any }[] = [];
    if (sku) {
      const bySku = await c.env.DB.prepare(`SELECT id, name, sku, barcode FROM products WHERE LOWER(sku) = LOWER(?)`).bind(sku).first();
      if (bySku) dupChecks.push({ label: 'SKU', row: bySku });
    }
    if (barcode) {
      const byBc = await c.env.DB.prepare(`SELECT id, name, sku, barcode FROM products WHERE barcode = ?`).bind(barcode).first();
      if (byBc) dupChecks.push({ label: 'code-barres', row: byBc });
    }
    const byName = await c.env.DB.prepare(`SELECT id, name, sku, barcode FROM products WHERE LOWER(name) = LOWER(?)`).bind(name).first();
    if (byName) dupChecks.push({ label: 'nom', row: byName });
    if (dupChecks.length && !force) {
      const first = dupChecks[0];
      return c.json({
        success: false,
        code: 'DUPLICATE_PRODUCT',
        force_required: true,
        error: `Produit en doublon (${first.label}) : « ${first.row.name} » (id ${first.row.id}). Passez force_duplicate=true pour créer quand même.`,
        hint: 'Envoyez force_duplicate=true pour forcer la création, ou mettez à jour le produit existant via PUT /api/products/:id.',
        duplicate: { id: first.row.id, name: first.row.name, sku: first.row.sku, barcode: first.row.barcode },
        matches: dupChecks.map((d) => ({ on: d.label, id: d.row.id, name: d.row.name, sku: d.row.sku, barcode: d.row.barcode })),
      }, 409);
    }
  
    if (image_url) {
      try { image_url = (await normalizeProductImageReference(c.env, 0, image_url)).url; }
      catch (e) { return productImageFailure(c, e); }
    }
  
    let bulkJson = '[]';
    if (body.bulk_discounts !== undefined) {
      const parsed = parseBulkDiscounts(body.bulk_discounts);
      bulkJson = JSON.stringify(parsed);
    }
  
    await ensureProductActors(c.env.DB);
    if (body.invoice_price_mode != null) await addColumnIfMissing(c.env.DB, 'products', 'invoice_price_mode', `TEXT DEFAULT NULL`);
    const postCols = await tableColumns(c.env.DB, 'products');
    if ((body.secondary_unit || body.secondary_unit_factor) && postCols && (!postCols.has('secondary_unit') || !postCols.has('secondary_unit_factor'))) return c.json({ success: false, code: 'SCHEMA_UNAVAILABLE', error: 'Unités secondaires indisponibles.' }, 503);
    const insertCols = ['sku', 'name', 'description', 'category', 'unit', 'price', 'cost', 'stock_quantity', 'low_stock_threshold', 'track_inventory', 'image_url', 'barcode', 'tax_rate', 'bulk_discounts', 'created_by', 'invoice_price_mode', 'secondary_unit', 'secondary_unit_factor'];
    const insertVals: any[] = [sku || null, name, description, category, unit, price, cost, stock_quantity, low_stock_threshold, track_inventory, image_url, barcode, tax_rate, bulkJson, sessionUserFromHeader(c.req.header('Authorization')).username || null, body.invoice_price_mode || null, body.secondary_unit ?? null, body.secondary_unit_factor ?? null];
    const useCols: string[] = [];
    const useVals: any[] = [];
    insertCols.forEach((colName, i) => {
      if (colName === 'created_by' && !postCols?.has(colName)) return;
      if (postCols && !postCols.has(colName)) return;
      useCols.push(colName);
      useVals.push(insertVals[i]);
    });
    const result = await c.env.DB.prepare(
      `INSERT INTO products (${useCols.join(', ')}) VALUES (${useCols.map(() => '?').join(', ')})`
    ).bind(...useVals).run();
  
    try { await addColumnIfMissing(c.env.DB, 'products', 'lot_number', `TEXT`); } catch { /* non-fatal */ }
    try { await addColumnIfMissing(c.env.DB, 'products', 'expiry_date', `TEXT`); } catch { /* non-fatal */ }
    {
      const lot_number = body.lot_number != null ? String(body.lot_number).slice(0, 64) : '';
      const expiry_date = body.expiry_date != null ? String(body.expiry_date).slice(0, 32) : '';
      if (lot_number || expiry_date) {
        try {
          await c.env.DB.prepare(`UPDATE products SET lot_number = ?, expiry_date = ? WHERE id = ?`)
            .bind(lot_number || null, expiry_date || null, result.meta.last_row_id).run();
        } catch { /* */ }
      }
    }
    if (stock_quantity > 0 && track_inventory) {
      const session = sessionUserFromHeader(c.req.header('Authorization'));
      // Write initial quantity as 0 first so applyStockDelta records previous=0 correctly
      await c.env.DB.prepare(`UPDATE products SET stock_quantity = 0 WHERE id = ?`).bind(result.meta.last_row_id).run();
      let locId = body.location_id ? Number(body.location_id) : null;
      if (!locId) {
        try { locId = await getDefaultLocationId(c.env.DB); } catch { locId = null; }
      }
      await applyStockDelta(
        c.env.DB,
        result.meta.last_row_id,
        Number(stock_quantity),
        'Stock initial',
        `product:${result.meta.last_row_id}`,
        { createdBy: session.username, type: 'initial', locationId: locId || undefined },
      );
    }
    const product = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(result.meta.last_row_id).first();
    try {
      const pq = Number((product as any)?.stock_quantity || 0);
      if (product && (product as any).id) await placeProductStockOnDefault(c.env.DB, Number((product as any).id), pq);
    } catch { /* */ }
    try { const su = sessionUserFromHeader(c.req.header('Authorization')); await writeAudit(c.env.DB, { username: su.username, role: su.role, action: 'product.create', entity: 'products', entity_id: String(result?.meta?.last_row_id || ''), detail: body?.name || '', ip: c.req.header('cf-connecting-ip') || '' }); } catch {}
    await invalidateDashboardCache(c.env.CACHE, c.env.MOBILE_HUB);
    return c.json({ success: true, data: product ? withInventoryActors(product as any) : product, message: 'Produit enregistré dans la base de données.' }, 201);
  });
  
  app.put('/api/products/:id', async (c) => {
    // will invalidate CACHE on success
  
    const id = c.req.param('id');
    await ensureProductBulkDiscounts(c.env.DB);
    let body: any;
    try { body = await readProductImageJson(c); } catch (e) { return productImageFailure(c, e); }
    if (body.name != null || body.price != null) {
      const verr = validateProductWrite({ name: body.name ?? 'x', ...body });
      if (verr && verr.price) return apiFail(c, verr.price, 'VALIDATION', verr);
    }
    const existing = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(id).first() as any;
    if (!existing) return c.json({ success: false, error: 'Produit introuvable' }, 404);
  
    if (body.secondary_unit !== undefined || body.secondary_unit_factor !== undefined || (body.unit !== undefined && existing.secondary_unit)) {
      const error = normalizeDualUnits(body, existing);
      if (error) return apiFail(c, error, 'VALIDATION');
      await ensureProductDualUnits(c.env.DB);
    }
  
    // Duplicate check on update (exclude self) — never 500 the save if the
    // schema drifts: a failing dup probe just skips the duplicate guard.
    const force = !!body.force_duplicate;
    const checkName = body.name !== undefined ? String(body.name) : existing.name;
    const checkSku = body.sku !== undefined ? body.sku : existing.sku;
    const checkBarcode = body.barcode !== undefined ? body.barcode : existing.barcode;
    const dupChecks: { label: string; row: any }[] = [];
    try {
    if (checkSku) {
      const bySku = await c.env.DB.prepare(`SELECT id, name, sku, barcode FROM products WHERE LOWER(sku) = LOWER(?) AND id != ?`).bind(checkSku, id).first();
      if (bySku) dupChecks.push({ label: 'SKU', row: bySku });
    }
    if (checkBarcode) {
      const byBc = await c.env.DB.prepare(`SELECT id, name, sku, barcode FROM products WHERE barcode = ? AND id != ?`).bind(checkBarcode, id).first();
      if (byBc) dupChecks.push({ label: 'code-barres', row: byBc });
    }
    if (checkName) {
      const byName = await c.env.DB.prepare(`SELECT id, name, sku, barcode FROM products WHERE LOWER(name) = LOWER(?) AND id != ?`).bind(checkName, id).first();
      if (byName) dupChecks.push({ label: 'nom', row: byName });
    }
    if (dupChecks.length && !force) {
      const first = dupChecks[0];
      return c.json({
        success: false,
        code: 'DUPLICATE_PRODUCT',
        force_required: true,
        error: `Conflit de doublon (${first.label}) avec « ${first.row.name} » (id ${first.row.id}). Passez force_duplicate=true pour forcer.`,
        hint: 'Envoyez force_duplicate=true pour ignorer le conflit, ou changez le SKU / nom / code-barres.',
        duplicate: { id: first.row.id, name: first.row.name, sku: first.row.sku, barcode: first.row.barcode },
        matches: dupChecks.map((d) => ({ on: d.label, id: d.row.id, name: d.row.name, sku: d.row.sku, barcode: d.row.barcode })),
      }, 409);
    }
  
    // Always persist price/cost as real numbers (avoids string/null no-ops in D1)
    if (body.price !== undefined && body.price !== null && body.price !== '') {
      body.price = Number(body.price);
      if (!Number.isFinite(body.price)) body.price = 0;
    }
    if (body.cost !== undefined && body.cost !== null && body.cost !== '') {
      body.cost = Number(body.cost);
      if (!Number.isFinite(body.cost)) body.cost = 0;
    }
    // unit_price alias used by some clients → maps to price
    if (body.unit_price !== undefined && body.price === undefined) {
      body.price = Number(body.unit_price);
      if (!Number.isFinite(body.price)) body.price = 0;
    }
    } catch (e) {
      console.error('dup-check skip', String((e as any)?.message || e).slice(0, 300));
    }
  
    if (body.image_url && body.image_url !== existing.image_url) {
      try { body.image_url = (await normalizeProductImageReference(c.env, id, String(body.image_url))).url; }
      catch (e) { return productImageFailure(c, e); }
    }
  
    await addColumnIfMissing(c.env.DB, 'products', 'invoice_price_mode', `TEXT DEFAULT NULL`);
    if (body.invoice_price_mode != null && !['inclusive', 'exclusive'].includes(body.invoice_price_mode)) return apiFail(c, 'Mode de prix facture invalide', 'VALIDATION');
    const fields = ['sku', 'name', 'description', 'category', 'unit', 'price', 'cost', 'low_stock_threshold', 'track_inventory', 'is_active', 'image_url', 'barcode', 'tax_rate', 'invoice_price_mode', 'secondary_unit', 'secondary_unit_factor'];
    // Schema-drift guard: never let a missing optional column 500 the save.
    const cols = await tableColumns(c.env.DB, 'products');
    if ((body.secondary_unit !== undefined || body.secondary_unit_factor !== undefined) && cols && (!cols.has('secondary_unit') || !cols.has('secondary_unit_factor'))) return c.json({ success: false, code: 'SCHEMA_UNAVAILABLE', error: 'Unités secondaires indisponibles.' }, 503);
    const updates: string[] = [];
    const values: any[] = [];
    for (const f of fields) {
      if (body[f] !== undefined) {
        if (cols && !cols.has(f)) continue;
        updates.push(`${f} = ?`);
        let v = body[f];
        if (f === 'price' || f === 'cost' || f === 'low_stock_threshold' || f === 'tax_rate') {
          if (v === '' || v === null) v = f === 'tax_rate' ? null : 0;
          else if (typeof v === 'string') v = Number(v);
        }
        if (f === 'track_inventory' || f === 'is_active') {
          v = v ? 1 : 0;
        }
        values.push(v);
      }
    }
    try { await addColumnIfMissing(c.env.DB, 'products', 'lot_number', `TEXT`); } catch (e) { console.error('addColumn lot_number', String((e as any)?.message || e).slice(0, 200)); }
    try { await addColumnIfMissing(c.env.DB, 'products', 'expiry_date', `TEXT`); } catch (e) { console.error('addColumn expiry_date', String((e as any)?.message || e).slice(0, 200)); }
    if (body.lot_number !== undefined && (await hasColumn(c.env.DB, 'products', 'lot_number'))) { updates.push('lot_number = ?'); values.push(String(body.lot_number || '').slice(0, 64) || null); }
    if (body.expiry_date !== undefined && (await hasColumn(c.env.DB, 'products', 'expiry_date'))) { updates.push('expiry_date = ?'); values.push(String(body.expiry_date || '').slice(0, 32) || null); }
    if (body.bulk_discounts !== undefined && (await hasColumn(c.env.DB, 'products', 'bulk_discounts'))) {
      updates.push(`bulk_discounts = ?`);
      values.push(JSON.stringify(parseBulkDiscounts(body.bulk_discounts)));
    }
    if (updates.length === 0) return c.json({ success: false, error: 'Aucun champ à modifier' }, 400);
    if (!cols || cols.has('updated_at')) updates.push(`updated_at = datetime('now')`);
    values.push(id);
    try {
      await c.env.DB.prepare(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
    } catch (e) {
      console.error('[PUT products update failed]', String((e as any)?.message || e).slice(0, 400), JSON.stringify({ updates }));
      throw e;
    }
    const product = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(id).first();
      if (body.location_id !== undefined && body.place_stock !== false) {
      try {
        const locId = Number(body.location_id);
        if (locId > 0) {
          const prod = await c.env.DB.prepare(`SELECT stock_quantity, track_inventory FROM products WHERE id = ?`).bind(id).first() as any;
          if (prod?.track_inventory && Number(prod.stock_quantity || 0) > 0) {
            await ensureStockLocations(c.env.DB);
            // Clear other placements and put all on chosen location
            await c.env.DB.prepare(`DELETE FROM stock_location_qty WHERE product_id = ?`).bind(id).run();
            await c.env.DB.prepare(
              `INSERT INTO stock_location_qty (location_id, product_id, quantity) VALUES (?, ?, ?)`
            ).bind(locId, id, Number(prod.stock_quantity || 0)).run();
          }
        }
      } catch (e) {
        console.error('place product stock', e);
      }
    }
  await invalidateDashboardCache(c.env.CACHE, c.env.MOBILE_HUB);
    return c.json({ success: true, data: product ? withInventoryActors(product as any) : product, message: 'Produit modifié dans la base de données.' });
  });
  
  app.post('/api/products/:id/adjust-stock', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json();
    const { quantity, type = 'adjustment', reason = '', reference = '' } = body;
    const locationId = body.location_id != null ? Number(body.location_id) : null;
    if (typeof quantity !== 'number' || Number.isNaN(quantity)) {
      return c.json({ success: false, error: 'La quantité est obligatoire' }, 400);
    }
    const product = await c.env.DB.prepare(`SELECT stock_quantity, track_inventory FROM products WHERE id = ?`).bind(id).first() as any;
    if (!product) return c.json({ success: false, error: 'Produit introuvable' }, 404);
    if (!product.track_inventory) {
      return c.json({ success: false, error: 'Ce produit ne suit pas le stock' }, 400);
    }
    const absQty = Math.abs(Number(quantity));
    if (absQty <= 0) return c.json({ success: false, error: 'Quantité invalide' }, 400);
    const outTypes = ['out', 'sale'];
    const delta = outTypes.includes(String(type).toLowerCase()) ? -absQty : absQty;
    const prev = Number(product.stock_quantity || 0);
    if (prev + delta < 0) return c.json({ success: false, error: 'Stock insuffisant' }, 400);
    // v0.7.1 — stock/user (magasinier/opérateur) cannot mutate stock directly:
    // they must submit POST /api/stock-adjustment-requests (approval workflow).
    const adjRole = normalizeInventoryRole(sessionUserFromHeader(c.req.header('Authorization')).role);
    if (!roleCanDirectAdjustStock(adjRole)) {
      return c.json(
        {
          success: false,
          code: 'APPROVAL_REQUIRED',
          error: `Rôle ${adjRole} : ajustement direct interdit — soumettez POST /api/stock-adjustment-requests (approbation owner/admin/secretaire).`,
        },
        403,
      );
    }
  
    const session = sessionUserFromHeader(c.req.header('Authorization'));
    const movement = await applyStockDelta(
      c.env.DB,
      id,
      delta,
      reason || `Ajustement manuel (${type})`,
      reference || `adjust:${id}`,
      {
        createdBy: session.username,
        type: String(type || 'adjustment'),
        allowNegative: false,
        locationId: locationId || undefined,
      },
    );
    const updated = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(id).first();
    // Free-tier friendly: D1 + KV invalidation (no Durable Objects required)
    await invalidateDashboardCache(c.env.CACHE, c.env.MOBILE_HUB);
    return c.json({
      success: true,
      data: updated,
      movement,
      message: 'Stock ajusté et enregistré dans le journal d\'audit.',
    });
  });
  
  /* ─── Product variants ─── */
  
  app.get('/api/products/:id/variants', async (c) => {
    await ensureProductVariantColumns(c.env.DB);
    const id = c.req.param('id');
    const parent = await c.env.DB.prepare(`SELECT id, name FROM products WHERE id = ?`).bind(id).first();
    if (!parent) return c.json({ success: false, error: 'Produit introuvable' }, 404);
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM products WHERE parent_id = ? ORDER BY variant_label, name`
    ).bind(id).all();
    return c.json({ success: true, data: (results || []).map((r: any) => withInventoryActors(r)), parent });
  });
  
  app.post('/api/products/:id/variants', async (c) => {
    await ensureProductVariantColumns(c.env.DB);
    await ensureProductDualUnits(c.env.DB);
    await ensureProductBulkDiscounts(c.env.DB);
    const parentId = c.req.param('id');
    const parent = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(parentId).first() as any;
    if (!parent) return c.json({ success: false, error: 'Produit parent introuvable' }, 404);
    if (parent.parent_id) {
      return c.json({ success: false, error: 'Impossible d\'ajouter une variante à une variante.' }, 400);
    }
  
    const body = await c.req.json().catch(() => ({}));
    const variant_label = String(body.variant_label || body.label || '').trim();
    if (!variant_label) {
      return c.json({ success: false, error: 'Libellé de variante obligatoire (ex. « M / Rouge »).' }, 400);
    }
    const name = String(body.name || `${parent.name} — ${variant_label}`).trim();
    const sku = body.sku != null ? String(body.sku).trim() : '';
    const barcode = body.barcode != null ? String(body.barcode).trim() : '';
    const price = body.price !== undefined ? Number(body.price) : Number(parent.price || 0);
    const cost = body.cost !== undefined ? Number(body.cost) : Number(parent.cost || 0);
    const stock_quantity = Number(body.stock_quantity || 0);
    const attributes = body.attributes
      ? (typeof body.attributes === 'string' ? body.attributes : JSON.stringify(body.attributes))
      : '{}';
  
    // Duplicate barcode / SKU across all products
    if (barcode) {
      const byBc = await c.env.DB.prepare(`SELECT id, name FROM products WHERE barcode = ?`).bind(barcode).first();
      if (byBc && !body.force_duplicate) {
        return c.json({
          success: false,
          code: 'DUPLICATE_PRODUCT',
          force_required: true,
          error: `Code-barres déjà utilisé par « ${(byBc as any).name} » (id ${(byBc as any).id}).`,
          duplicate: byBc,
        }, 409);
      }
    }
    if (sku) {
      const bySku = await c.env.DB.prepare(`SELECT id, name FROM products WHERE LOWER(sku) = LOWER(?)`).bind(sku).first();
      if (bySku && !body.force_duplicate) {
        return c.json({
          success: false,
          code: 'DUPLICATE_PRODUCT',
          force_required: true,
          error: `SKU déjà utilisé par « ${(bySku as any).name} » (id ${(bySku as any).id}).`,
          duplicate: bySku,
        }, 409);
      }
    }
  
    await ensureProductActors(c.env.DB);
    const actorPresent = (await tableColumns(c.env.DB, 'products'))?.has('created_by') === true;
    const actorName = sessionUserFromHeader(c.req.header('Authorization')).username || null;
    const result = await c.env.DB.prepare(
      `INSERT INTO products (sku, name, description, category, unit, price, cost, stock_quantity, low_stock_threshold, track_inventory, image_url, barcode, tax_rate, bulk_discounts, parent_id, variant_label, attributes, invoice_price_mode, secondary_unit, secondary_unit_factor${actorPresent ? ', created_by' : ''})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${actorPresent ? ', ?' : ''})`
    ).bind(
      sku || null,
      name,
      parent.description || '',
      parent.category || 'Général',
      parent.unit || 'unité',
      price,
      cost,
      stock_quantity,
      parent.low_stock_threshold ?? 5,
      parent.track_inventory ?? 1,
      parent.image_url || '',
      barcode || '',
      parent.tax_rate,
      parent.bulk_discounts || '[]',
      Number(parentId),
      variant_label,
      attributes,
      parent.invoice_price_mode || null,
      parent.secondary_unit || null,
      parent.secondary_unit_factor ?? null,
      ...(actorPresent ? [actorName] : []),
    ).run();
  
    const variantId = result.meta.last_row_id;
    if (stock_quantity > 0) {
      await applyStockDelta(c.env.DB, variantId, stock_quantity, 'Stock initial (variante)', `variant:${variantId}`, { type: 'initial', createdBy: actorName || undefined });
    }
    await invalidateDashboardCache(c.env.CACHE, c.env.MOBILE_HUB);
    const variant = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(variantId).first();
    return c.json({ success: true, data: variant ? withInventoryActors(variant as any) : variant, message: 'Variante créée.' }, 201);
  });
  
  app.put('/api/products/variants/:vid', async (c) => {
    await ensureProductVariantColumns(c.env.DB);
    const vid = c.req.param('vid');
    const existing = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(vid).first() as any;
    if (!existing) return c.json({ success: false, error: 'Variante introuvable' }, 404);
    if (!existing.parent_id) {
      return c.json({ success: false, error: 'Ce produit n\'est pas une variante. Utilisez PUT /api/products/:id.' }, 400);
    }
    const body = await c.req.json().catch(() => ({}));
    if (body.price !== undefined && body.price !== null && body.price !== '') {
      body.price = Number(body.price);
      if (!Number.isFinite(body.price)) body.price = 0;
    }
    if (body.cost !== undefined && body.cost !== null && body.cost !== '') {
      body.cost = Number(body.cost);
      if (!Number.isFinite(body.cost)) body.cost = 0;
    }
    const fields = ['sku', 'name', 'price', 'cost', 'barcode', 'variant_label', 'is_active', 'low_stock_threshold', 'track_inventory', 'tax_rate'];
    const updates: string[] = [];
    const values: any[] = [];
    for (const f of fields) {
      if (body[f] !== undefined) {
        updates.push(`${f} = ?`);
        let v = body[f];
        if (f === 'price' || f === 'cost' || f === 'low_stock_threshold' || f === 'tax_rate') {
          if (v === '' || v === null) v = f === 'tax_rate' ? null : 0;
          else if (typeof v === 'string') v = Number(v);
        }
        if (f === 'track_inventory' || f === 'is_active') v = v ? 1 : 0;
        values.push(v);
      }
    }
    if (body.label !== undefined && body.variant_label === undefined) {
      updates.push(`variant_label = ?`);
      values.push(String(body.label));
    }
    if (body.attributes !== undefined) {
      updates.push(`attributes = ?`);
      values.push(typeof body.attributes === 'string' ? body.attributes : JSON.stringify(body.attributes));
    }
    if (!updates.length) return c.json({ success: false, error: 'Aucun champ à modifier' }, 400);
    updates.push(`updated_at = datetime('now')`);
    values.push(vid);
    await c.env.DB.prepare(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
    const row = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(vid).first();
    await invalidateDashboardCache(c.env.CACHE, c.env.MOBILE_HUB);
    return c.json({ success: true, data: row, message: 'Variante mise à jour.' });
  });
  
  app.delete('/api/products/variants/:vid', async (c) => {
    await ensureProductVariantColumns(c.env.DB);
    const vid = c.req.param('vid');
    const body = await c.req.json().catch(() => ({}));
    const existing = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(vid).first() as any;
    if (!existing) return c.json({ success: false, error: 'Variante introuvable' }, 404);
    if (!existing.parent_id) {
      return c.json({ success: false, error: 'Ce produit n\'est pas une variante.' }, 400);
    }
    if (body.confirm_password) {
      const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
      if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);
    }
    // Soft-delete preferred for audit; hard delete if force
    if (body.hard) {
      await c.env.DB.prepare(`DELETE FROM products WHERE id = ?`).bind(vid).run();
    } else {
      await c.env.DB.prepare(`UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ?`).bind(vid).run();
    }
    return c.json({ success: true, message: `Variante « ${existing.variant_label || existing.name} » ${body.hard ? 'supprimée' : 'désactivée'}.` });
  });
  
  /* ─── Barcode scan (mobile APK ready) ─── */
  
  /**
   * Lookup by barcode or SKU — primary endpoint for camera scan.
   * GET /api/scan/barcode/:code
   * Returns product (or variant) + parent summary + stock status.
   */
  app.get('/api/scan/barcode/:code', async (c) => {
    // Hot path: no schema DDL. Light columns — no image/description (phone never shows photos).
    const code = decodeURIComponent(c.req.param('code') || '').trim();
    if (!code) return c.json({ success: false, error: 'Code-barres vide' }, 400);
  
    const scanColumns = await tableColumns(c.env.DB, 'products');
    const scanActors = ['created_by', 'approved_by'].filter(col => scanColumns?.has(col)).map(col => `, ${col}`).join('');
    const SCAN_COLS = `id, sku, name, barcode, category, unit, price, stock_quantity, low_stock_threshold, track_inventory, is_active, parent_id, variant_label, tax_rate${scanActors}`;
    let product = await c.env.DB.prepare(
      `SELECT ${SCAN_COLS} FROM products WHERE barcode = ? AND is_active = 1 LIMIT 1`
    ).bind(code).first() as any;
    if (!product) {
      product = await c.env.DB.prepare(
        `SELECT ${SCAN_COLS} FROM products WHERE LOWER(sku) = LOWER(?) AND is_active = 1 LIMIT 1`
      ).bind(code).first() as any;
    }
    if (!product) {
      // Part D: already proposed from phone, waiting for PC accept
      let pendingAction: any = null;
      try {
        pendingAction = await c.env.DB.prepare(
          `SELECT id, type, title, detail, status, created_at, created_by, barcode
           FROM mobile_actions
           WHERE status = 'pending'
             AND (
               barcode = ?
               OR detail LIKE ?
               OR detail LIKE ?
             )
           ORDER BY id DESC LIMIT 1`
        ).bind(code, `%barcode/sku=${code}%`, `%barcode=${code}%`).first();
      } catch { /* older schema */ }
  
      if (pendingAction) {
        return c.json({
          success: false,
          code: 'PENDING_APPROVAL',
          error: `Produit « ${code} » déjà proposé — en attente d’acceptation sur le PC.`,
          barcode: code,
          can_create: false,
          pending_action: {
            id: pendingAction.id,
            type: pendingAction.type,
            title: pendingAction.title,
            detail: pendingAction.detail,
            status: pendingAction.status,
            created_at: pendingAction.created_at,
            created_by: pendingAction.created_by,
          },
        }, 404);
      }
  
      return c.json({
        success: false,
        code: 'NOT_FOUND',
        error: `Aucun produit pour le code « ${code} ».`,
        barcode: code,
        can_create: true,
      }, 404);
    }
  
    let parent: any = null;
    if (product.parent_id) {
      parent = await c.env.DB.prepare(
        `SELECT id, name, category, unit, price FROM products WHERE id = ?`
      ).bind(product.parent_id).first();
    }
  
    // v0.7.1 — inventory privacy on the barcode/scan path too.
    const scanRole = normalizeInventoryRole(sessionUserFromHeader(c.req.header('Authorization')).role);
    product = scrubProductForRole(withInventoryActors(product), scanRole) as any;
    if (parent) parent = scrubProductForRole(parent, scanRole) as any;
    const scanSeesPrice = roleCanSeeSellPrices(scanRole);
    const stockQty = Number(product.stock_quantity || 0);
    const threshold = Number(product.low_stock_threshold || 0);
    const stock_status = !product.track_inventory
      ? 'not_tracked'
      : stockQty <= 0
        ? 'out'
        : stockQty <= threshold
          ? 'low'
          : 'ok';
  
    return c.json({
      success: true,
      data: {
        ...product,
        parent,
        stock_status,
        display_name: product.variant_label
          ? `${parent?.name || product.name} — ${product.variant_label}`
          : product.name,
        // Ready-to-use invoice line payload for mobile (price-visible roles only)
        invoice_line: scanSeesPrice ? {
          product_id: product.id,
          product_name: product.variant_label
            ? `${parent?.name || product.name} — ${product.variant_label}`
            : product.name,
          sku: product.sku || '',
          barcode: product.barcode || '',
          quantity: 1,
          list_price: Number(product.price || 0),
          unit_price: Number(product.price || 0),
          tax_rate: product.tax_rate,
        } : undefined,
      },
    });
  });
  
  /**
   * Create a product quickly from a scanned barcode (APK "add product by scan").
   * POST /api/scan/quick-product
   * body: { barcode, name?, price?, cost?, category?, unit?, stock_quantity?, parent_id?, variant_label? }
   */
  app.post('/api/scan/quick-product', async (c) => {
    await ensureProductVariantColumns(c.env.DB);
    await ensureProductBulkDiscounts(c.env.DB);
    await ensureCategoriesTable(c.env.DB);
    await ensureUnitsTable(c.env.DB);
  
    const body = await c.req.json().catch(() => ({}));
    const barcode = String(body.barcode || '').trim();
    if (!barcode) return c.json({ success: false, error: 'Code-barres obligatoire' }, 400);
  
    const existing = await c.env.DB.prepare(
      `SELECT id, name, sku, barcode FROM products WHERE barcode = ?`
    ).bind(barcode).first() as any;
    if (existing && !body.force_duplicate) {
      return c.json({
        success: false,
        code: 'DUPLICATE_PRODUCT',
        force_required: true,
        error: `Code-barres déjà associé à « ${existing.name} » (id ${existing.id}).`,
        duplicate: existing,
      }, 409);
    }
  
    const name = String(body.name || `Produit ${barcode}`).trim();
    const price = Number(body.price || 0);
    const cost = Number(body.cost || 0);
    const category = String(body.category || 'Général');
    const unit = String(body.unit || 'unité');
    const stock_quantity = Number(body.stock_quantity || 0);
    const parent_id = body.parent_id ? Number(body.parent_id) : null;
    const variant_label = String(body.variant_label || '').trim();
    const sku = body.sku != null ? String(body.sku).trim() : barcode;
  
    await ensureProductActors(c.env.DB);
    const actorPresent = (await tableColumns(c.env.DB, 'products'))?.has('created_by') === true;
    const actorName = sessionUserFromHeader(c.req.header('Authorization')).username || null;
    const result = await c.env.DB.prepare(
      `INSERT INTO products (sku, name, description, category, unit, price, cost, stock_quantity, low_stock_threshold, track_inventory, image_url, barcode, tax_rate, bulk_discounts, parent_id, variant_label, attributes${actorPresent ? ', created_by' : ''})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, '', ?, NULL, '[]', ?, ?, '{}'${actorPresent ? ', ?' : ''})`
    ).bind(
      sku || null,
      name,
      String(body.description || ''),
      category,
      unit,
      price,
      cost,
      stock_quantity,
      Number(body.low_stock_threshold ?? 5),
      barcode,
      parent_id,
      variant_label,
      ...(actorPresent ? [actorName] : []),
    ).run();
  
    const id = result.meta.last_row_id;
    if (stock_quantity > 0) {
      await applyStockDelta(c.env.DB, id, stock_quantity, 'Stock initial (scan)', barcode, { type: 'initial', createdBy: actorName || undefined });
    }
    await invalidateDashboardCache(c.env.CACHE, c.env.MOBILE_HUB);
    const product = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(id).first();
    return c.json({
      success: true,
      data: product ? withInventoryActors(product as any) : product,
      message: 'Produit créé depuis le code-barres.',
    }, 201);
  });
  
  /**
   * Detach / purge rows that reference products(id) so DELETE is not blocked by FK.
   * Document lines keep product_name but lose the live product link.
   */
  async function purgeProductDependencies(db: D1Database, productIds: (string | number)[]) {
    const ids = productIds.map((x) => Number(x)).filter((n) => n > 0);
    if (!ids.length) return;
    const ph = ids.map(() => '?').join(',');
  
    // Child variants first
    try {
      await db.prepare(`DELETE FROM products WHERE parent_id IN (${ph})`).bind(...ids).run();
    } catch { /* no parent_id column */ }
  
    const softNullTables = [
      `UPDATE invoice_items SET product_id = NULL WHERE product_id IN (${ph})`,
      `UPDATE bill_items SET product_id = NULL WHERE product_id IN (${ph})`,
      `UPDATE delivery_note_items SET product_id = NULL WHERE product_id IN (${ph})`,
    ];
    for (const sql of softNullTables) {
      try { await db.prepare(sql).bind(...ids).run(); } catch { /* table/column may not exist */ }
    }
  
    // Hard-delete pure stock / catalog children
    const hardDelete = [
      `DELETE FROM stock_location_qty WHERE product_id IN (${ph})`,
      `DELETE FROM product_images WHERE product_id IN (${ph})`,
      `DELETE FROM product_catalog WHERE product_id IN (${ph})`,
      `DELETE FROM stock_movements WHERE product_id IN (${ph})`,
      `DELETE FROM reorder_suggestions WHERE product_id IN (${ph})`,
    ];
    for (const sql of hardDelete) {
      try { await db.prepare(sql).bind(...ids).run(); } catch { /* optional tables */ }
    }
  }
  
  
  /** True if product appears on any historical document line (invoice/bill). */
  async function productHasTransactionHistory(db: D1Database, productId: number | string): Promise<boolean> {
    const id = Number(productId);
    if (!id) return false;
    try {
      const inv = await db.prepare(
        `SELECT 1 AS ok FROM invoice_items WHERE product_id = ? LIMIT 1`,
      ).bind(id).first() as any;
      if (inv?.ok) return true;
    } catch { /* */ }
    try {
      const bill = await db.prepare(
        `SELECT 1 AS ok FROM bill_items WHERE product_id = ? LIMIT 1`,
      ).bind(id).first() as any;
      if (bill?.ok) return true;
    } catch { /* */ }
    return false;
  }
  
  
  
  app.post('/api/products/:id/request-delete-otp', async (c) => {
    const id = c.req.param('id');
    const product = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(id).first() as any;
    if (!product) return c.json({ success: false, error: 'Produit introuvable' }, 404);
    const label = `Produit ${product.name}${product.sku ? ` (${product.sku})` : ''}`;
    const result = await issueDeleteOtp(c.env, 'product', String(id), label, `Code de suppression — ${label}`);
    return c.json({ success: true, message: result.message, emailed: result.emailed, otp: result.emailed ? undefined : result.otp });
  });
  
  app.delete('/api/products/:id', async (c) => {
    try {
      const gate = requireBizMutator(c);
      if (!gate.ok) return gate.response;
      if (!canHardDeleteStock(gate.role)) {
        return c.json({ success: false, error: 'Rôle insuffisant pour supprimer un produit.', code: 'FORBIDDEN_ROLE' }, 403);
      }
      const id = c.req.param('id');
      const body = await c.req.json().catch(() => ({}));
      const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
      if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);
  
      const product = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(id).first() as any;
      if (!product) return c.json({ success: false, error: 'Produit introuvable' }, 404);
  
      // Hard-delete guardrail: historical lines → archive only (is_active = 0)
      if (await productHasTransactionHistory(c.env.DB, id)) {
        await c.env.DB.prepare(
          `UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ?`,
        ).bind(id).run();
        await afterBusinessMutation(c.env.CACHE);
        await writeAudit(c.env.DB, {
          username: gate.username,
          role: gate.role,
          action: 'product.archive',
          entity: 'products',
          entity_id: id,
          detail: `${product.name}; reason=linked_transactions`,
          ip: c.req.header('cf-connecting-ip') || '',
        });
        return c.json({
          success: true,
          archived: true,
          message: `Produit « ${product.name} » archivé (lié à l’historique). Suppression définitive interdite.`,
        });
      }
  
      const r2n = await deleteProductImagesFromR2(c.env.DB, c.env.IMAGES, c.env, id);
      await purgeProductDependencies(c.env.DB, [id]);
      await c.env.DB.prepare(`DELETE FROM products WHERE id = ?`).bind(id).run();
      await afterBusinessMutation(c.env.CACHE);
  
      await writeAudit(c.env.DB, {
        username: gate.username,
        role: gate.role,
        action: 'product.delete',
        entity: 'products',
        entity_id: id,
        detail: `${product.name}; r2_objects=${r2n}`,
        ip: c.req.header('cf-connecting-ip') || '',
      });
  
      return c.json({
        success: true,
        message: `Produit ${product.name} supprimé.`,
        meta: { r2_deleted: r2n },
      });
    } catch (e: any) {
      console.error('product delete', e);
      return c.json({ success: false, error: friendlyFkDeleteError(e), code: 'DELETE_FAILED' }, 400);
    }
  });
  
  app.post('/api/products/request-bulk-delete-otp', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const ids: number[] = Array.isArray(body.ids) ? body.ids.map((x: any) => Number(x)).filter((n: number) => n > 0) : [];
    if (!ids.length) return c.json({ success: false, error: 'Aucun produit sélectionné' }, 400);
    const placeholders = ids.map(() => '?').join(',');
    const { results: products } = await c.env.DB.prepare(`SELECT id, name, sku FROM products WHERE id IN (${placeholders})`).bind(...ids).all();
    if (!products?.length) return c.json({ success: false, error: 'Aucun produit trouvé' }, 404);
    const resourceId = ids.slice().sort((a, b) => a - b).join(',');
    const label = `${products.length} produit(s) : ${(products as any[]).map((x) => x.name).join(', ')}`;
    const result = await issueDeleteOtp(c.env, 'products_bulk', resourceId, label, `Code de suppression — ${products.length} produit(s)`);
    return c.json({ success: true, message: result.message, emailed: result.emailed, otp: result.emailed ? undefined : result.otp, count: products.length });
  });
  
  app.post('/api/products/bulk-delete', async (c) => {
    try {
      const gate = requireBizMutator(c);
      if (!gate.ok) return gate.response;
      if (!canHardDeleteStock(gate.role)) {
        return c.json({ success: false, error: 'Rôle insuffisant pour supprimer des produits.', code: 'FORBIDDEN_ROLE' }, 403);
      }
      const body = await c.req.json().catch(() => ({}));
      const ids: number[] = Array.isArray(body.ids) ? body.ids.map((x: any) => Number(x)).filter((n: number) => n > 0) : [];
      if (!ids.length) return c.json({ success: false, error: 'Aucun produit sélectionné' }, 400);
      const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
      if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);
  
      const placeholders = ids.map(() => '?').join(',');
      for (const id of ids) {
        try { await deleteProductImagesFromR2(c.env.DB, c.env.IMAGES, c.env, id); } catch { /* */ }
      }
      await purgeProductDependencies(c.env.DB, ids);
      await c.env.DB.prepare(`DELETE FROM products WHERE id IN (${placeholders})`).bind(...ids).run();
      await afterBusinessMutation(c.env.CACHE);
  
      await writeAudit(c.env.DB, {
        username: gate.username,
        role: gate.role,
        action: 'product.bulk_delete',
        entity: 'products',
        entity_id: ids.join(','),
        detail: `${ids.length} produit(s)`,
        ip: c.req.header('cf-connecting-ip') || '',
      });
  
      return c.json({
        success: true,
        message: `${ids.length} produit(s) supprimé(s).`,
      });
    } catch (e: any) {
      console.error('product bulk-delete', e);
      return c.json({ success: false, error: friendlyFkDeleteError(e), code: 'DELETE_FAILED' }, 400);
    }
  });
  
  /* GET /api/products/:id/movements → worker/routes/stock.ts */
  
  
  /**
   * Global inventory audit log.
   * Query: product_id, type, q (reason/reference search), limit (default 50, max 200), offset
   */
  /* GET /api/stock/movements → worker/routes/stock.ts */
  
  
}
