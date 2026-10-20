import { afterBusinessMutation } from '../lib/delete-coord';
const _localSchemaOnce = new Set<string>();

import type { AtlasApp } from './types';

async function ensureClientPricesTable(db: D1Database): Promise<void> {
  if (_localSchemaOnce.has("ensureClientPricesTable")) return;
  _localSchemaOnce.add("ensureClientPricesTable");
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS client_product_prices (
      client_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (client_id, product_id)
    )`,
    )
    .run();

  _localSchemaOnce.add("ensureClientPricesTable");
}

/** Client-specific prices + reorder suggestions (wholesale). */
export function registerWholesaleRoutes(app: AtlasApp): void {
  app.get('/api/clients/:id/prices', async (c) => {
    await ensureClientPricesTable(c.env.DB);
    const id = c.req.param('id');
    const { results } = await c.env.DB.prepare(
      `SELECT cpp.*, p.name as product_name, p.sku, p.price as list_price
       FROM client_product_prices cpp
       LEFT JOIN products p ON p.id = cpp.product_id
       WHERE cpp.client_id = ?
       ORDER BY p.name COLLATE NOCASE`,
    )
      .bind(id)
      .all();
    return c.json({ success: true, data: results || [] });
  });

  app.put('/api/clients/:id/prices/:productId', async (c) => {
    await ensureClientPricesTable(c.env.DB);
    const clientId = Number(c.req.param('id'));
    const productId = Number(c.req.param('productId'));
    const body = await c.req.json().catch(() => ({}));
    const unit_price = Number(body.unit_price);
    if (!clientId || !productId || !Number.isFinite(unit_price) || unit_price < 0) {
      return c.json({ success: false, error: 'client_id, product_id et unit_price requis' }, 400);
    }
    await c.env.DB.prepare(
      `INSERT INTO client_product_prices (client_id, product_id, unit_price, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(client_id, product_id) DO UPDATE SET
         unit_price = excluded.unit_price,
         updated_at = datetime('now')`,
    )
      .bind(clientId, productId, unit_price)
      .run();
    await afterBusinessMutation(c.env.CACHE);
    return c.json({ success: true, message: 'Prix client enregistré' });
  });

  app.get('/api/clients/:id/price-for/:productId', async (c) => {
    await ensureClientPricesTable(c.env.DB);
    const row = (await c.env.DB.prepare(
      `SELECT unit_price FROM client_product_prices WHERE client_id = ? AND product_id = ?`,
    )
      .bind(c.req.param('id'), c.req.param('productId'))
      .first()) as any;
    return c.json({ success: true, data: { unit_price: row ? Number(row.unit_price) : null } });
  });

  app.get('/api/inventory/reorder-suggestions', async (c) => {
    const limit = Math.min(100, Math.max(5, Number(c.req.query('limit') || 30)));
    const { results: products } = await c.env.DB.prepare(
      `SELECT id, name, sku, stock_quantity, low_stock_threshold, price, cost, cost_price, track_inventory
       FROM products WHERE is_active = 1 AND track_inventory = 1`,
    ).all();
    const { results: sales } = await c.env.DB.prepare(
      `SELECT ii.product_id, SUM(ii.quantity) as qty
       FROM invoice_items ii
       JOIN invoices i ON i.id = ii.invoice_id
       WHERE i.status NOT IN ('quote','devis','cancelled')
         AND COALESCE(i.doc_kind,'') != 'remboursement'
         AND datetime(i.issue_date) >= datetime('now', '-30 days')
       GROUP BY ii.product_id`,
    ).all();
    const sold = new Map<number, number>();
    for (const s of (sales || []) as any[]) sold.set(Number(s.product_id), Number(s.qty || 0));
    const out: any[] = [];
    for (const p of (products || []) as any[]) {
      const stock = Number(p.stock_quantity || 0);
      const vel = sold.get(Number(p.id)) || 0;
      const daily = vel / 30;
      const daysCover = daily > 0 ? stock / daily : stock > 0 ? 999 : 0;
      const reorder = Number(p.low_stock_threshold || 0);
      const need = stock <= reorder || (daily > 0 && daysCover < 14);
      if (!need) continue;
      const suggestQty = Math.max(
        reorder > stock ? reorder - stock : 0,
        Math.ceil(daily * 21 - stock),
        1,
      );
      out.push({
        product_id: p.id,
        name: p.name,
        sku: p.sku,
        stock,
        sold_30d: vel,
        days_cover: Math.round(daysCover * 10) / 10,
        suggest_qty: suggestQty,
        unit_cost: Number(p.cost || p.cost_price || 0),
      });
    }
    out.sort((a, b) => a.days_cover - b.days_cover);
    return c.json({ success: true, data: out.slice(0, limit) });
  });
}
