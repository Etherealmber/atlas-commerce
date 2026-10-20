/**
 * v209 — InvenTree-inspired roadmap (S/M/L):
 *  M3 scan-first ops (receive / transfer / count) · M2 lots + expiry · S4 supplier parts + price breaks
 *  M5 quote status pipeline + journal · L8 kits/BOM assembly · L10 webhooks · S6 label printing (SVG)
 *  M1 locations: products.location (bin reference) on top of existing warehouses.
 */
import type { AtlasApp } from './types';
import { qrToSvg } from '../qrSvg';

const once = new Set<string>();
async function ensure(db: D1Database, key: string, ddl: string): Promise<void> {
  if (once.has(key)) return;
  once.add(key);
  await db.prepare(ddl).run();
}

export async function ensureV209Schema(db: D1Database): Promise<void> {
  await ensure(db, 'lots', `CREATE TABLE IF NOT EXISTS stock_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    lot TEXT NOT NULL DEFAULT '',
    expiry TEXT DEFAULT '',
    quantity REAL NOT NULL DEFAULT 0,
    warehouse_id INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  await ensure(db, 'sparts', `CREATE TABLE IF NOT EXISTS supplier_parts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    supplier_sku TEXT DEFAULT '',
    price_breaks TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  await ensure(db, 'kits', `CREATE TABLE IF NOT EXISTS kits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  await ensure(db, 'kit_items', `CREATE TABLE IF NOT EXISTS kit_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kit_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity REAL NOT NULL DEFAULT 1
  )`);
  await ensure(db, 'webhooks', `CREATE TABLE IF NOT EXISTS webhooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    events TEXT DEFAULT '[]',
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  await ensure(db, 'atlas_alerts', `CREATE TABLE IF NOT EXISTS atlas_alerts (key TEXT PRIMARY KEY, label TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, threshold REAL NOT NULL DEFAULT 0)`);
  await ensure(db, 'status_events', `CREATE TABLE IF NOT EXISTS status_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    from_status TEXT DEFAULT '',
    to_status TEXT NOT NULL,
    by_user TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  // products.location (bin / emplacement reference) — M1
  try {
    const cols = await db.prepare(`PRAGMA table_info(products)`).all() as any;
    if (!(cols.results || []).some((c: any) => c.name === 'location')) {
      await db.prepare(`ALTER TABLE products ADD COLUMN location TEXT DEFAULT ''`).run();
    }
    const icols = await db.prepare(`PRAGMA table_info(invoices)`).all() as any;
    if (!(icols.results || []).some((c: any) => c.name === 'pipeline_status')) {
      await db.prepare(`ALTER TABLE invoices ADD COLUMN pipeline_status TEXT DEFAULT ''`).run();
    }
  } catch { /* fresh db */ }
}

export async function dispatchWebhook(env: any, event: string, payload: any): Promise<void> {
  try {
    const db = env.DB as D1Database;
    await ensureV209Schema(db);
    const rows = await db.prepare(`SELECT url, events FROM webhooks WHERE active = 1`).all() as any;
    for (const w of rows.results || []) {
      let evts: string[] = [];
      try { evts = JSON.parse(w.events || '[]'); } catch { evts = []; }
      if (evts.length && !evts.includes(event) && !evts.includes('*')) continue;
      // fire-and-forget, never block the API
      env.ctx?.waitUntil?.(
        fetch(w.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ event, payload, at: new Date().toISOString() }),
        }).catch(() => undefined),
      );
    }
  } catch { /* webhooks must never break business flows */ }
}

/* CODE128-B barcode → SVG paths (compact implementation) */
const C128_PATTERNS = ['11011001100','11001101100','11001100110','10010011000','10010001100','10001001100','10011001000','10011000100','10001100100','11001001000','11001000100','11000100100','10110011100','10011011100','10011001110','10111001100','10011101100','10011100110','11001110010','11001011100','11001001110','11011100100','11001110100','11101101110','11101001100','11100101100','11100100110','11101100100','11100110100','11100110010','11011011000','11011000110','11000110110','10100011000','10001011000','10001000110','10110001000','10001101000','10001100010','11010001000','11000101000','11000100010','10110111000','10110001110','10001101110','10111011000','10111000110','10001110110','11101110110','11010001110','11000101110','11011101000','11011100010','11011101110','11101011000','11101000110','11100010110','11101101000','11101100010','11100011010','11101011110','11101110100','11101110010','11011011110','11110101110','11110111010','11101011110','11110101110','11110111010','11010011110','11011110100','11011110010','11110110100','11110110010','11011110110','11110101100','11110100110','11110010110','11110011010','11011011110','11011110110','11110110110','10101111000','10100011110','10001011110','10111101000','10111100010','11110101000','11110100010','10111011110','10111101110','11101011110','11110101110'];
function code128Svg(text: string, height = 46): string {
  const vals: number[] = [104];
  for (const ch of text) vals.push(Math.max(0, Math.min(94, ch.charCodeAt(0) - 32)));
  let sum = 104;
  vals.slice(1).forEach((v, i) => { sum += v * (i + 1); });
  vals.push(sum % 103, 106);
  let bits = '';
  for (const v of vals) bits += C128_PATTERNS[v] || C128_PATTERNS[0];
  let x = 0;
  let rects = '';
  bits.split('').forEach((b, i) => {
    if (b === '1') rects += `<rect x="${i * 2}" y="0" width="2" height="${height}"/>`;
    x = i;
  });
  void x;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${bits.length * 2} ${height}" width="${bits.length * 2}" height="${height}" fill="#0a0a0a">${rects}</svg>`;
}

const PIPELINE = ['pending', 'approved', 'shipped', 'delivered'];

export interface V209Deps {
  sessionUserFromHeader: (h?: string) => { username: string; role?: string };
  applyStockDelta?: (db: D1Database, productId: number, delta: number, reason: string, type: string, opts?: any) => Promise<any>;
  adjustLocationStock?: (db: D1Database, productId: number, locationId: number, delta: number, opts?: any) => Promise<any>;
  getDefaultLocationId?: (db: D1Database) => Promise<number | null>;
}

export function registerAtlasV209Routes(app: AtlasApp, deps: V209Deps): void {
  const gate = (c: any) => {
    const s = deps.sessionUserFromHeader(c.req.header('Authorization'));
    if (!s.username) return { ok: false as const, status: 401, error: 'Non authentifié' };
    const role = (s.role || 'user').toLowerCase();
    if (!['owner', 'admin', 'stock'].includes(role)) return { ok: false as const, status: 403, error: 'Rôle insuffisant' };
    return { ok: true as const, username: s.username };
  };

  async function applyDelta(db: D1Database, productId: number, warehouseId: number | null, delta: number, type: string, reason: string, user: string, prevTotal: number, newTotal: number) {
    if (warehouseId) {
      const row = await db.prepare(`SELECT quantity FROM warehouse_stock WHERE product_id = ? AND warehouse_id = ?`).bind(productId, warehouseId).first() as any;
      const q = (row?.quantity || 0) + delta;
      await db.prepare(`INSERT INTO warehouse_stock (product_id, warehouse_id, quantity) VALUES (?, ?, ?) ON CONFLICT(product_id, warehouse_id) DO UPDATE SET quantity = excluded.quantity`).bind(productId, warehouseId, q).run();
    }
    await db.prepare(`UPDATE products SET stock_quantity = ?, updated_at = datetime('now') WHERE id = ?`).bind(newTotal, productId).run();
    await db.prepare(`INSERT INTO stock_movements (product_id, type, quantity, previous_quantity, new_quantity, reason, reference, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(productId, type, delta, prevTotal, newTotal, reason, '', user).run();
  }

  /* ---- M3: scan-first stock operations ---- */
  app.post('/api/stock/receive', async (c) => {
    const g = gate(c); if (!g.ok) return c.json({ success: false, error: g.error }, g.status as any);
    const b = await c.req.json<any>();
    const qty = Number(b.quantity); const pid = Number(b.product_id);
    if (!pid || !isFinite(qty) || qty <= 0) return c.json({ success: false, error: 'QTY_INVALID' }, 400);
    const db = c.env.DB; await ensureV209Schema(db);
    const p = await db.prepare(`SELECT id, stock_quantity, name FROM products WHERE id = ?`).bind(pid).first() as any;
    if (!p) return c.json({ success: false, error: 'PRODUCT_NOT_FOUND' }, 404);
    const loc = b.location_id ? Number(b.location_id) : (deps.getDefaultLocationId ? await deps.getDefaultLocationId(db) : null);
    if (deps.applyStockDelta) {
      await deps.applyStockDelta(db, pid, qty, String(b.note || 'Réception'), 'receive', {});
      if (loc && deps.adjustLocationStock) { try { await deps.adjustLocationStock(db, pid, loc, qty, {}); } catch { /* location optional */ } }
    } else {
      await applyDelta(db, pid, loc, qty, 'receive', String(b.note || 'Réception'), g.username, Number(p.stock_quantity), Number(p.stock_quantity) + qty);
    }
    const after = await db.prepare(`SELECT stock_quantity FROM products WHERE id = ?`).bind(pid).first() as any;
    const newTotal = Number(after?.stock_quantity ?? Number(p.stock_quantity) + qty);
    if (b.lot || b.expiry) {
      await db.prepare(`INSERT INTO stock_lots (product_id, lot, expiry, quantity, warehouse_id) VALUES (?, ?, ?, ?, ?)`).bind(pid, String(b.lot || ''), String(b.expiry || ''), qty, loc).run();
    }
    await dispatchWebhook(c.env, 'stock.receive', { product_id: pid, quantity: qty, by: g.username });
    return c.json({ success: true, data: { stock_quantity: newTotal } });
  });

  app.post('/api/stock/count', async (c) => {
    const g = gate(c); if (!g.ok) return c.json({ success: false, error: g.error }, g.status as any);
    const b = await c.req.json<any>();
    const qty = Number(b.quantity); const pid = Number(b.product_id);
    if (!pid || !isFinite(qty) || qty < 0) return c.json({ success: false, error: 'QTY_INVALID' }, 400);
    const db = c.env.DB; await ensureV209Schema(db);
    const p = await db.prepare(`SELECT stock_quantity FROM products WHERE id = ?`).bind(pid).first() as any;
    if (!p) return c.json({ success: false, error: 'PRODUCT_NOT_FOUND' }, 404);
    const delta = qty - Number(p.stock_quantity);
    if (deps.applyStockDelta) {
      await deps.applyStockDelta(db, pid, delta, 'Inventaire tournant (scan)', 'adjustment', {});
    } else {
      await applyDelta(db, pid, null, delta, 'count', 'Inventaire tournant', g.username, Number(p.stock_quantity), qty);
    }
    await dispatchWebhook(c.env, 'stock.count', { product_id: pid, quantity: qty });
    return c.json({ success: true, data: { stock_quantity: qty } });
  });

  /* ---- M2: lots ---- */
  app.get('/api/stock/lots', async (c) => {
    const g = gate(c); if (!g.ok) return c.json({ success: false, error: g.error }, g.status as any);
    const db = c.env.DB; await ensureV209Schema(db);
    const pid = c.req.query('product_id');
    const q = pid ? db.prepare(`SELECT * FROM stock_lots WHERE product_id = ? ORDER BY expiry ASC`).bind(Number(pid)) : db.prepare(`SELECT * FROM stock_lots ORDER BY expiry ASC LIMIT 200`);
    const r = await q.all();
    return c.json({ success: true, data: r.results || [] });
  });

  /* ---- M1: bin location on product ---- */
  app.post('/api/products/:id/location', async (c) => {
    const g = gate(c); if (!g.ok) return c.json({ success: false, error: g.error }, g.status as any);
    const b = await c.req.json<any>();
    await ensureV209Schema(c.env.DB);
    await c.env.DB.prepare(`UPDATE products SET location = ?, updated_at = datetime('now') WHERE id = ?`).bind(String(b.location || ''), Number(c.req.param('id'))).run();
    return c.json({ success: true });
  });

  /* ---- S4: supplier parts + price breaks ---- */
  app.get('/api/vendors/parts', async (c) => {
    const g = gate(c); if (!g.ok) return c.json({ success: false, error: g.error }, g.status as any);
    await ensureV209Schema(c.env.DB);
    const vid = c.req.query('vendor_id');
    const q = vid ? c.env.DB.prepare(`SELECT * FROM supplier_parts WHERE vendor_id = ?`).bind(Number(vid)) : c.env.DB.prepare(`SELECT * FROM supplier_parts LIMIT 300`);
    const r = await q.all();
    return c.json({ success: true, data: r.results || [] });
  });
  app.post('/api/vendors/parts', async (c) => {
    const g = gate(c); if (!g.ok) return c.json({ success: false, error: g.error }, g.status as any);
    const b = await c.req.json<any>();
    if (!b.vendor_id || !b.product_id) return c.json({ success: false, error: 'PARAMS_REQUIRED' }, 400);
    await ensureV209Schema(c.env.DB);
    const r = await c.env.DB.prepare(`INSERT INTO supplier_parts (vendor_id, product_id, supplier_sku, price_breaks) VALUES (?, ?, ?, ?)`).bind(Number(b.vendor_id), Number(b.product_id), String(b.supplier_sku || ''), JSON.stringify(b.price_breaks || [])).run();
    return c.json({ success: true, data: { id: r.meta.last_row_id } });
  });

  /* ---- M5: quote / document status pipeline ---- */
  app.post('/api/invoices/:id/pipeline', async (c) => {
    const g = gate(c); if (!g.ok) return c.json({ success: false, error: g.error }, g.status as any);
    const b = await c.req.json<any>();
    const target = String(b.status || '');
    if (!PIPELINE.includes(target)) return c.json({ success: false, error: 'STATUS_INVALID' }, 400);
    const db = c.env.DB; await ensureV209Schema(db);
    const id = Number(c.req.param('id'));
    const inv = await db.prepare(`SELECT id, pipeline_status, number FROM invoices WHERE id = ?`).bind(id).first() as any;
    if (!inv) return c.json({ success: false, error: 'NOT_FOUND' }, 404);
    const cur = inv.pipeline_status || 'pending';
    if (PIPELINE.indexOf(target) !== PIPELINE.indexOf(cur) + 1) return c.json({ success: false, error: 'PIPELINE_ORDER' }, 400);
    await db.prepare(`UPDATE invoices SET pipeline_status = ?, updated_at = datetime('now') WHERE id = ?`).bind(target, id).run();
    await db.prepare(`INSERT INTO status_events (invoice_id, from_status, to_status, by_user) VALUES (?, ?, ?, ?)`).bind(id, cur, target, g.username).run();
    await dispatchWebhook(c.env, `doc.${target}`, { invoice_id: id, number: inv.number });
    return c.json({ success: true, data: { pipeline_status: target } });
  });
  app.get('/api/invoices/:id/pipeline', async (c) => {
    const g = gate(c); if (!g.ok) return c.json({ success: false, error: g.error }, g.status as any);
    await ensureV209Schema(c.env.DB);
    const r = await c.env.DB.prepare(`SELECT * FROM status_events WHERE invoice_id = ? ORDER BY id ASC`).bind(Number(c.req.param('id'))).all();
    return c.json({ success: true, data: r.results || [] });
  });

  /* ---- L8: kits / BOM ---- */
  app.get('/api/kits', async (c) => {
    const g = gate(c); if (!g.ok) return c.json({ success: false, error: g.error }, g.status as any);
    await ensureV209Schema(c.env.DB);
    const kits = await c.env.DB.prepare(`SELECT * FROM kits ORDER BY id DESC`).all();
    const items = await c.env.DB.prepare(`SELECT * FROM kit_items`).all();
    const byKit: Record<number, any[]> = {};
    for (const it of (items as any).results || []) { (byKit[it.kit_id] ||= []).push(it); }
    return c.json({ success: true, data: ((kits as any).results || []).map((k: any) => ({ ...k, items: byKit[k.id] || [] })) });
  });
  app.post('/api/kits', async (c) => {
    const g = gate(c); if (!g.ok) return c.json({ success: false, error: g.error }, g.status as any);
    const b = await c.req.json<any>();
    if (!b.name || !b.product_id) return c.json({ success: false, error: 'NAME_PRODUCT_REQUIRED' }, 400);
    const db = c.env.DB; await ensureV209Schema(db);
    const r = await db.prepare(`INSERT INTO kits (name, product_id) VALUES (?, ?)`).bind(String(b.name), Number(b.product_id)).run();
    const kitId = r.meta.last_row_id;
    for (const it of b.items || []) {
      await db.prepare(`INSERT INTO kit_items (kit_id, product_id, quantity) VALUES (?, ?, ?)`).bind(kitId, Number(it.product_id), Number(it.quantity || 1)).run();
    }
    return c.json({ success: true, data: { id: kitId } });
  });
  app.post('/api/kits/:id/assemble', async (c) => {
    const g = gate(c); if (!g.ok) return c.json({ success: false, error: g.error }, g.status as any);
    const qty = Number((await c.req.json<any>()).quantity || 1);
    if (!isFinite(qty) || qty <= 0) return c.json({ success: false, error: 'QTY_INVALID' }, 400);
    const db = c.env.DB; await ensureV209Schema(db);
    const kit = await db.prepare(`SELECT * FROM kits WHERE id = ?`).bind(Number(c.req.param('id'))).first() as any;
    if (!kit) return c.json({ success: false, error: 'KIT_NOT_FOUND' }, 404);
    const items = await db.prepare(`SELECT * FROM kit_items WHERE kit_id = ?`).bind(kit.id).all() as any;
    for (const it of items.results || []) {
      const p = await db.prepare(`SELECT stock_quantity, name FROM products WHERE id = ?`).bind(it.product_id).first() as any;
      if ((p?.stock_quantity || 0) < Number(it.quantity) * qty) return c.json({ success: false, error: `INSUFFICIENT:${p?.name || it.product_id}` }, 400);
    }
    for (const it of items.results || []) {
      const need = Number(it.quantity) * qty;
      const p = await db.prepare(`SELECT stock_quantity FROM products WHERE id = ?`).bind(it.product_id).first() as any;
      await applyDelta(db, it.product_id, null, -need, 'kit_out', `Assemblage kit ${kit.name}`, g.username, Number(p.stock_quantity), Number(p.stock_quantity) - need);
    }
    const out = await db.prepare(`SELECT stock_quantity FROM products WHERE id = ?`).bind(kit.product_id).first() as any;
    await applyDelta(db, kit.product_id, null, qty, 'kit_in', `Assemblage kit ${kit.name}`, g.username, Number(out.stock_quantity), Number(out.stock_quantity) + qty);
    await dispatchWebhook(c.env, 'kit.assembled', { kit_id: kit.id, quantity: qty });
    return c.json({ success: true });
  });

  /* ---- L10: webhooks CRUD ---- */
  app.get('/api/webhooks', async (c) => {
    const g = gate(c); if (!g.ok) return c.json({ success: false, error: g.error }, g.status as any);
    await ensureV209Schema(c.env.DB);
    const r = await c.env.DB.prepare(`SELECT * FROM webhooks ORDER BY id DESC`).all();
    return c.json({ success: true, data: r.results || [] });
  });
  app.post('/api/webhooks', async (c) => {
    const g = gate(c); if (!g.ok) return c.json({ success: false, error: g.error }, g.status as any);
    const b = await c.req.json<any>();
    if (!/^https?:\/\//.test(String(b.url || ''))) return c.json({ success: false, error: 'URL_INVALID' }, 400);
    await ensureV209Schema(c.env.DB);
    const r = await c.env.DB.prepare(`INSERT INTO webhooks (url, events) VALUES (?, ?)`).bind(String(b.url), JSON.stringify(b.events || ['*'])).run();
    return c.json({ success: true, data: { id: r.meta.last_row_id } });
  });
  app.delete('/api/webhooks/:id', async (c) => {
    const g = gate(c); if (!g.ok) return c.json({ success: false, error: g.error }, g.status as any);
    await ensureV209Schema(c.env.DB);
    await c.env.DB.prepare(`DELETE FROM webhooks WHERE id = ?`).bind(Number(c.req.param('id'))).run();
    return c.json({ success: true });
  });

  /* ---- S6: printable label (QR + CODE128) ---- */
  app.get('/api/atlas/alerts', async (c) => {
    await ensureV209Schema(c.env.DB);
    const rows = await c.env.DB.prepare(`SELECT key, label, enabled, threshold FROM atlas_alerts ORDER BY key`).all() as any;
    return c.json({ success: true, data: rows.results || [] });
  });

  app.post('/api/atlas/alerts', async (c) => {
    await ensureV209Schema(c.env.DB);
    const b = await c.req.json().catch(() => ({})) as any;
    const key = String(b.key || '').trim();
    if (!key) return c.json({ success: false, error: 'Clé requise' }, 400);
    const label = String(b.label || key);
    const enabled = b.enabled ? 1 : 0;
    const threshold = Number(b.threshold || 0);
    if (b.test) {
      await dispatchWebhook(c.env, 'atlas.alert', { key, label, threshold, message: String(b.message || 'Test alerte — ' + label), test: true });
      return c.json({ success: true, test: true });
    }
    await c.env.DB.prepare(`INSERT INTO atlas_alerts (key, label, enabled, threshold) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET label = excluded.label, enabled = excluded.enabled, threshold = excluded.threshold`).bind(key, label, enabled, threshold).run();
    return c.json({ success: true });
  });

  app.get('/api/products/:id/label.svg', async (c) => {
    const s = deps.sessionUserFromHeader(c.req.header('Authorization'));
    if (!s.username) return c.json({ success: false, error: 'Non authentifié' }, 401);
    const db = c.env.DB;
    const p = await db.prepare(`SELECT id, name, sku, barcode, price, unit, location FROM products WHERE id = ?`).bind(Number(c.req.param('id'))).first() as any;
    if (!p) return c.text('Not found', 404);
    const code = String(p.barcode || p.sku || `P${p.id}`);
    const origin = new URL(c.req.url).origin;
    const qr = qrToSvg(`${origin}/scan?code=${encodeURIComponent(code)}`, 88, 2);
    const barcode = code128Svg(code, 40);
    const price = new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(Number(p.price || 0));
    const esc = (v: string) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
<rect width="320" height="180" fill="#ffffff" stroke="#d4d4d8"/>
<text x="12" y="26" font-family="sans-serif" font-size="15" font-weight="700" fill="#0a0a0a">${esc(p.name).slice(0, 34)}</text>
<text x="12" y="44" font-family="sans-serif" font-size="11" fill="#52525b">${esc(code)} · ${esc(p.unit || '')}${p.location ? ` · ${esc(p.location)}` : ''}</text>
<text x="12" y="76" font-family="sans-serif" font-size="22" font-weight="800" fill="#0a0a0a">${price} MAD</text>
<g transform="translate(220,52)">${qr.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</g>
<g transform="translate(12,120)">${barcode}</g>
<text x="12" y="172" font-family="monospace" font-size="10" fill="#0a0a0a">${esc(code)}</text>
</svg>`;
    return c.text(svg, 200, { 'content-type': 'image/svg+xml' });
  });
}
