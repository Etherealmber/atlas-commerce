import type { AtlasApp } from './types';
import { canMutateBusiness } from '../lib/rbac';
import { sessionUserFromHeader } from '../lib/authHelpers';
import { doCacheGet, doCachePut, hasLiveCache } from '../lib/cache';

interface InvoiceReadRouteDeps {
  requireBizMutator?: (
    c: any,
  ) => { ok: true; username: string; role: string } | { ok: false; response: Response };
}

/** Invoice read routes (list/detail). Create/pay/delete remain in worker/index.ts for now. */
export function registerInvoiceReadRoutes(app: AtlasApp, deps?: InvoiceReadRouteDeps): void {
  const gateBiz = (c: any) => {
    if (deps?.requireBizMutator) return deps.requireBizMutator(c);
    const s = sessionUserFromHeader(c.req.header('Authorization'));
    if (!canMutateBusiness(s.role)) {
      return {
        ok: false as const,
        response: c.json(
          { success: false, error: 'Accès factures réservé (owner / admin / secrétaire).', code: 'FORBIDDEN_ROLE' },
          403,
        ),
      };
    }
    return { ok: true as const, username: s.username, role: s.role };
  };

  app.get('/api/invoices', async (c) => {
    const gate = gateBiz(c);
    if (!gate.ok) return gate.response;
    const status = c.req.query('status') || '';
    const clientId = c.req.query('client') || '';
    const kind = String(c.req.query('kind') || '').trim();
    const limit = Math.max(1, Math.min(2000, Number(c.req.query('limit') || 500)));
    const cacheKey = `invoices:list:s=${status}:c=${clientId}:k=${kind}:l=${limit}`;
    if (hasLiveCache(c.env)) {
      const hit = await doCacheGet<any[]>(c.env.MOBILE_HUB, c.env.CACHE, cacheKey, 300);
      if (hit) return c.json({ success: true, data: hit, cached: true });
    }
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
    sql += ` ORDER BY id DESC LIMIT ?`;
    binds.push(limit);
    const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
    if (hasLiveCache(c.env)) {
      await doCachePut(c.env.MOBILE_HUB, c.env.CACHE, cacheKey, results || [], 300);
    }
    return c.json({ success: true, data: results });
  });

  app.get('/api/invoices/:id', async (c) => {
    const gate = gateBiz(c);
    if (!gate.ok) return gate.response;
    const id = c.req.param('id');
    const invoice = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first();
    if (!invoice) return c.json({ success: false, error: 'Facture introuvable' }, 404);
    const { results: items } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`)
      .bind(id)
      .all();
    return c.json({ success: true, data: { ...invoice, items } });
  });
}
