import type { AtlasApp } from './types';

/** Invoice read routes (list/detail). Create/pay/delete remain in worker/index.ts for now. */
export function registerInvoiceReadRoutes(app: AtlasApp): void {
  app.get('/api/invoices', async (c) => {
    const status = c.req.query('status');
    const clientId = c.req.query('client');
    const kind = String(c.req.query('kind') || '').trim();
    let sql = `SELECT * FROM invoices`;
    const conditions: string[] = [];
    const binds: any[] = [];
    if (status) {
      conditions.push('status = ?');
      binds.push(status);
    }
    if (clientId) {
      conditions.push('client_id = ?');
      binds.push(clientId);
    }
    if (kind === 'quick_sale') {
      conditions.push(
        `(COALESCE(doc_kind,'') IN ('quick_sale','ticket') OR IFNULL(number,'') LIKE 'VR-%' OR IFNULL(number,'') LIKE 'VR/%')`,
      );
    } else if (kind !== 'all') {
      conditions.push(
        `(COALESCE(doc_kind,'invoice') NOT IN ('quick_sale','ticket') AND IFNULL(number,'') NOT LIKE 'VR-%' AND IFNULL(number,'') NOT LIKE 'VR/%')`,
      );
    }
    if (conditions.length) sql += ` WHERE ` + conditions.join(' AND ');
    sql += ` ORDER BY created_at DESC`;
    const stmt = binds.length ? c.env.DB.prepare(sql).bind(...binds) : c.env.DB.prepare(sql);
    const { results } = await stmt.all();
    return c.json({ success: true, data: results });
  });

  app.get('/api/invoices/:id', async (c) => {
    const id = c.req.param('id');
    const invoice = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first();
    if (!invoice) return c.json({ success: false, error: 'Facture introuvable' }, 404);
    const { results: items } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`)
      .bind(id)
      .all();
    return c.json({ success: true, data: { ...invoice, items } });
  });
}
