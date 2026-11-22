import type { Hono } from 'hono';
import { bumpCacheGen } from '../lib/cache';
import { afterBusinessMutation } from '../lib/delete-coord';
import { validateVendorWrite } from '../lib/validate';
import { apiFail } from '../lib/api-response';

export interface VendorRouteDeps {
  requireBizMutator: (c: any) => { ok: true; username: string; role: string } | { ok: false; response: Response };
  checkConfirmPassword: (env: any, db: D1Database, authHeader: string | undefined, body: any) => Promise<any>;
  writeAudit: (db: D1Database, entry: any) => Promise<void>;
}

export function registerVendorRoutes(app: Hono<any>, deps: VendorRouteDeps): void {
  const { requireBizMutator, checkConfirmPassword, writeAudit } = deps;

  app.get('/api/vendors', async (c) => {
    let results: any[] = [];
    try {
      const r = await c.env.DB.prepare(`
        SELECT v.*,
          COALESCE((
            SELECT SUM(b.total - COALESCE(b.amount_paid, 0))
            FROM bills b
            WHERE b.vendor_id = v.id
              AND b.status NOT IN ('cancelled','paid','draft')
              AND (b.total - COALESCE(b.amount_paid, 0)) > 0.001
          ), 0) as balance_due
        FROM vendors v
        ORDER BY v.name
      `).all();
      results = r.results || [];
    } catch {
      const r = await c.env.DB.prepare(`SELECT * FROM vendors ORDER BY name`).all();
      results = r.results || [];
    }
    return c.json({ success: true, data: results });
  });

  app.post('/api/vendors', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const verr = validateVendorWrite(body);
    if (verr) return apiFail(c, Object.values(verr)[0] || 'Validation', 'VALIDATION', verr);
    const { name, ice = '', if_number = '', address = '', city = '', phone = '', email = '' } = body;
    if (!name) return c.json({ success: false, error: 'Le nom du fournisseur est obligatoire' }, 400);
    const result = await c.env.DB.prepare(
      `INSERT INTO vendors (name, ice, if_number, address, city, phone, email) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(name, ice, if_number, address, city, phone, email).run();
    const vendor = await c.env.DB.prepare(`SELECT * FROM vendors WHERE id = ?`).bind(result.meta.last_row_id).first();
    return c.json({ success: true, data: vendor, message: 'Fournisseur enregistré dans la base de données.' }, 201);
  });

  app.put('/api/vendors/:id', async (c) => {
    const id = Number(c.req.param('id'));
    if (!id) return c.json({ success: false, error: 'ID invalide' }, 400);
    const body = await c.req.json().catch(() => ({}));
    const name = String(body.name || '').trim();
    if (!name) return c.json({ success: false, error: 'Le nom du fournisseur est obligatoire' }, 400);
    const ice = String(body.ice || '');
    const if_number = String(body.if_number || '');
    const address = String(body.address || '');
    const city = String(body.city || '');
    const phone = String(body.phone || '');
    const email = String(body.email || '');
    await c.env.DB.prepare(
      `UPDATE vendors SET name=?, ice=?, if_number=?, address=?, city=?, phone=?, email=? WHERE id=?`,
    ).bind(name, ice, if_number, address, city, phone, email, id).run();
    try { await bumpCacheGen(c.env.CACHE, c.env.MOBILE_HUB); } catch { /* */ }
    return c.json({ success: true, data: { id } });
  });

  app.delete('/api/vendors/:id', async (c) => {
    try {
      const gate = requireBizMutator(c);
      if (!gate.ok) return gate.response;
      const body = await c.req.json().catch(() => ({}));
      const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
      if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);
      const id = c.req.param('id');
      await c.env.DB.prepare(`DELETE FROM vendors WHERE id = ?`).bind(id).run();
      await afterBusinessMutation(c.env.CACHE);
      await writeAudit(c.env.DB, {
        username: gate.username, role: gate.role, action: 'vendor.delete',
        entity: 'vendors', entity_id: id, ip: c.req.header('cf-connecting-ip') || '',
      });
      return c.json({ success: true, message: 'Fournisseur supprimé de la base de données.' });
    } catch (e: any) {
      return c.json({ success: false, error: e?.message || 'Échec de la suppression', code: 'DELETE_FAILED' }, 400);
    }
  });
}
