const _localSchemaOnce = new Set<string>();

import type { AtlasApp } from './types';

async function ensureStockMovementsTable(db: D1Database): Promise<void> {
  if (_localSchemaOnce.has("ensureStockMovementsTable")) return;
  _localSchemaOnce.add("ensureStockMovementsTable");
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

  _localSchemaOnce.add("ensureStockMovementsTable");
}

/** Stock read APIs (movements). Mutations stay in index until applyStockDelta is extracted. */
export function registerStockReadRoutes(app: AtlasApp): void {
  app.get('/api/products/:id/movements', async (c) => {
    await ensureStockMovementsTable(c.env.DB);
    const id = c.req.param('id');
    const full = c.req.query('full') === '1' || c.req.query('all') === '1';
    const limit = Math.min(full ? 2000 : 200, Math.max(1, Number(c.req.query('limit') || (full ? 500 : 50))));
    const offset = Math.max(0, Number(c.req.query('offset') || 0));
    const windowSql = full ? '' : `AND datetime(created_at) >= datetime('now', '-90 days')`;
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM stock_movements
       WHERE product_id = ?
         ${windowSql}
       ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
      .bind(id, limit, offset)
      .all();
    return c.json({
      success: true,
      data: results,
      meta: {
        product_id: Number(id),
        limit,
        offset,
        count: results?.length || 0,
        window: full ? 'all' : '90d',
      },
    });
  });

  app.get('/api/stock/movements', async (c) => {
    await ensureStockMovementsTable(c.env.DB);
    const productId = c.req.query('product_id');
    const type = c.req.query('type');
    const q = String(c.req.query('q') || '').trim();
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') || 50)));
    const offset = Math.max(0, Number(c.req.query('offset') || 0));
    const clauses: string[] = [];
    const binds: any[] = [];
    if (productId) {
      clauses.push('product_id = ?');
      binds.push(productId);
    }
    if (type) {
      clauses.push('type = ?');
      binds.push(type);
    }
    if (q) {
      clauses.push('(reason LIKE ? OR reference LIKE ?)');
      binds.push(`%${q}%`, `%${q}%`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM stock_movements ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
      .bind(...binds, limit, offset)
      .all();
    return c.json({ success: true, data: results || [], meta: { limit, offset, count: results?.length || 0 } });
  });
}
