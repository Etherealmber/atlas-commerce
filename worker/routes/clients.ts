/**
 * Clients domain routes — peeled from worker/index.ts
 */
import type { Hono } from 'hono';
import { apiFail } from '../lib/api-response';
import { validateClientWrite } from '../lib/validate';
import {
  ensureClientTaxExempt,
  ensureClientCreditLimit,
  checkClientCreditLimit,
} from '../lib/clients-schema';
import { afterBusinessMutation } from '../lib/delete-coord';

export { ensureClientTaxExempt, ensureClientCreditLimit, checkClientCreditLimit };

export type ClientRouteDeps = {
  issueDeleteOtp: (
    env: any,
    kind: string,
    id: string,
    label: string,
    subject: string,
  ) => Promise<{ message: string; emailed: boolean; otp?: string }>;
  requireBizMutator: (
    c: any,
  ) => { ok: true; username: string; role: string } | { ok: false; response: Response };
  checkConfirmPassword: (
    env: any,
    db: D1Database,
    auth: string | undefined,
    body: any,
  ) => Promise<{ ok: true } | { ok: false; error: string; code?: string; status: number }>;
  clientDeleteBlockers: (db: D1Database, clientId: number | string) => Promise<string | null>;
  writeAudit: (db: D1Database, opts: any) => Promise<void>;
};

export function registerClientRoutes(app: Hono<any>, deps?: ClientRouteDeps): void {
  const issueDeleteOtp = deps?.issueDeleteOtp;
  const requireBizMutator = deps?.requireBizMutator;
  const checkConfirmPassword = deps?.checkConfirmPassword;
  const clientDeleteBlockers = deps?.clientDeleteBlockers;
  const writeAudit = deps?.writeAudit;

  app.get('/api/clients', async (c) => {
    await ensureClientTaxExempt(c.env.DB);
    await ensureClientCreditLimit(c.env.DB);
    let results: any[] = [];
    try {
      const r = await c.env.DB.prepare(`
        SELECT c.*,
          COALESCE((
            SELECT SUM(i.total - COALESCE(i.amount_paid, 0))
            FROM invoices i
            WHERE i.client_id = c.id
              AND i.status NOT IN ('quote','devis','cancelled','paid','remboursement')
              AND COALESCE(i.doc_kind,'') != 'remboursement'
              AND (i.total - COALESCE(i.amount_paid, 0)) > 0.001
          ), 0) as balance_due
        FROM clients c
        ORDER BY c.name
      `).all();
      results = r.results || [];
    } catch {
      const r = await c.env.DB.prepare(`SELECT * FROM clients ORDER BY name`).all();
      results = r.results || [];
    }
    return c.json({ success: true, data: results });
  });

  app.post('/api/clients', async (c) => {
    await ensureClientTaxExempt(c.env.DB);
    await ensureClientCreditLimit(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const verr = validateClientWrite(body);
    if (verr) return apiFail(c, verr.name || Object.values(verr)[0] || 'Validation', 'VALIDATION', verr);
    const { name, ice = '', if_number = '', address = '', city = '', phone = '', email = '' } = body;
    if (!name) return apiFail(c, 'Le nom du client est obligatoire', 'VALIDATION');
    const tax_exempt = body.tax_exempt ? 1 : 0;
    const credit_limit = Math.max(0, Number(body.credit_limit || 0));
    let result;
    try {
      result = await c.env.DB.prepare(
        `INSERT INTO clients (name, ice, if_number, address, city, phone, email, tax_exempt, credit_limit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(name, ice, if_number, address, city, phone, email, tax_exempt, credit_limit).run();
    } catch {
      result = await c.env.DB.prepare(
        `INSERT INTO clients (name, ice, if_number, address, city, phone, email, tax_exempt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(name, ice, if_number, address, city, phone, email, tax_exempt).run();
    }
    const client = await c.env.DB.prepare(`SELECT * FROM clients WHERE id = ?`).bind(result.meta.last_row_id).first();
    return c.json({ success: true, data: client, message: 'Client enregistré dans la base de données.' }, 201);
  });

  app.put('/api/clients/:id', async (c) => {
    await ensureClientTaxExempt(c.env.DB);
    await ensureClientCreditLimit(c.env.DB);
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const existing = await c.env.DB.prepare(`SELECT * FROM clients WHERE id = ?`).bind(id).first() as any;
    if (!existing) return apiFail(c, 'Client introuvable', 'NOT_FOUND');
    const fields = ['name', 'ice', 'if_number', 'address', 'city', 'phone', 'email', 'credit_limit'];
    const updates: string[] = [];
    const values: any[] = [];
    for (const f of fields) {
      if (body[f] !== undefined) {
        updates.push(`${f} = ?`);
        values.push(body[f]);
      }
    }
    if (body.tax_exempt !== undefined) {
      updates.push(`tax_exempt = ?`);
      values.push(body.tax_exempt ? 1 : 0);
    }
    if (!updates.length) return c.json({ success: false, error: 'Aucun champ à modifier' }, 400);
    values.push(id);
    await c.env.DB.prepare(`UPDATE clients SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
    const client = await c.env.DB.prepare(`SELECT * FROM clients WHERE id = ?`).bind(id).first();
    return c.json({ success: true, data: client, message: 'Client mis à jour.' });
  });

  app.post('/api/clients/:id/request-delete-otp', async (c) => {
    const id = c.req.param('id');
    const client = await c.env.DB.prepare(`SELECT * FROM clients WHERE id = ?`).bind(id).first() as any;
    if (!client) return c.json({ success: false, error: 'Client introuvable' }, 404);
    const label = `Client ${client.name}`;
    const result = await issueDeleteOtp(c.env, 'client', String(id), label, `Code de suppression — ${label}`);
    return c.json({ success: true, message: result.message, emailed: result.emailed, otp: result.emailed ? undefined : result.otp });
  });

  app.delete('/api/clients/:id', async (c) => {
    try {
      const gate = requireBizMutator(c);
      if (!gate.ok) return gate.response;
      const id = c.req.param('id');
      const body = await c.req.json().catch(() => ({}));
      const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
      if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);
      const client = await c.env.DB.prepare(`SELECT * FROM clients WHERE id = ?`).bind(id).first() as any;
      if (!client) return c.json({ success: false, error: 'Client introuvable' }, 404);
      const block = await clientDeleteBlockers(c.env.DB, id);
      if (block) {
        return c.json({ success: false, error: block, code: 'CLIENT_HAS_HISTORY' }, 400);
      }
      await c.env.DB.prepare(`DELETE FROM clients WHERE id = ?`).bind(id).run();
      await afterBusinessMutation(c.env.CACHE);
      await writeAudit(c.env.DB, {
        username: gate.username, role: gate.role, action: 'client.delete',
        entity: 'clients', entity_id: id, detail: client.name || '',
        ip: c.req.header('cf-connecting-ip') || '',
      });
      return c.json({ success: true, message: `Client ${client.name} supprimé de la base de données.` });
    } catch (e: any) {
      console.error('client delete', e);
      return c.json({ success: false, error: e?.message || 'Échec de la suppression', code: 'DELETE_FAILED' }, 400);
    }
  });

  app.post('/api/clients/request-bulk-delete-otp', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const ids: number[] = Array.isArray(body.ids) ? body.ids.map((x: any) => Number(x)).filter((n: number) => n > 0) : [];
    if (!ids.length) return c.json({ success: false, error: 'Aucun client sélectionné' }, 400);
    const placeholders = ids.map(() => '?').join(',');
    const { results: clients } = await c.env.DB.prepare(`SELECT id, name FROM clients WHERE id IN (${placeholders})`).bind(...ids).all();
    if (!clients?.length) return c.json({ success: false, error: 'Aucun client trouvé' }, 404);
    const resourceId = ids.slice().sort((a, b) => a - b).join(',');
    const label = `${clients.length} client(s) : ${(clients as any[]).map((x) => x.name).join(', ')}`;
    const result = await issueDeleteOtp(c.env, 'clients_bulk', resourceId, label, `Code de suppression — ${clients.length} client(s)`);
    return c.json({ success: true, message: result.message, emailed: result.emailed, otp: result.emailed ? undefined : result.otp, count: clients.length });
  });

  app.post('/api/clients/bulk-delete', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const ids: number[] = Array.isArray(body.ids) ? body.ids.map((x: any) => Number(x)).filter((n: number) => n > 0) : [];
      if (!ids.length) return c.json({ success: false, error: 'Aucun client sélectionné' }, 400);
    const resourceId = ids.slice().sort((a, b) => a - b).join(',');
    const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
    if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);
    const placeholders = ids.map(() => '?').join(',');
    await c.env.DB.prepare(`DELETE FROM clients WHERE id IN (${placeholders})`).bind(...ids).run();
    return c.json({ success: true, message: `${ids.length} client(s) supprimé(s) de la base de données.` });
  });


  /* ─── Client import (Part 9) ─── */

  app.post('/api/clients/import/preview', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const rows: any[] = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) return c.json({ success: false, error: 'Aucune ligne à analyser' }, 400);

    const { results: existing } = await c.env.DB.prepare(
      `SELECT id, name, ice, email, phone FROM clients`
    ).all();
    const byIce = new Map<string, any>();
    const byEmail = new Map<string, any>();
    const byName = new Map<string, any>();
    for (const e of (existing || []) as any[]) {
      if (e.ice) byIce.set(String(e.ice).replace(/\s/g, '').toLowerCase(), e);
      if (e.email) byEmail.set(String(e.email).trim().toLowerCase(), e);
      if (e.name) byName.set(String(e.name).trim().toLowerCase(), e);
    }

    const preview = rows.map((r: any, idx: number) => {
      const name = String(r.name || r.nom || '').trim();
      const ice = String(r.ice || '').replace(/\s/g, '').trim();
      const email = String(r.email || r.mail || '').trim();
      const phone = String(r.phone || r.tel || r.telephone || '').trim();
      const if_number = String(r.if_number || r.if || '').trim();
      const address = String(r.address || r.adresse || '').trim();
      const city = String(r.city || r.ville || '').trim();

      const errors: string[] = [];
      if (!name) errors.push('Nom manquant');
      if (ice && !/^\d{15}$/.test(ice.replace(/\D/g, '')) && ice.replace(/\D/g, '').length > 0) {
        // soft warning: ICE should be 15 digits
        if (ice.replace(/\D/g, '').length !== 15) errors.push('ICE non standard (15 chiffres attendus)');
      }
      if (email && !email.includes('@')) errors.push('E-mail invalide');

      let duplicate: any = null;
      let match_on = '';
      if (ice && byIce.has(ice.toLowerCase())) {
        duplicate = byIce.get(ice.toLowerCase());
        match_on = 'ice';
      } else if (email && byEmail.has(email.toLowerCase())) {
        duplicate = byEmail.get(email.toLowerCase());
        match_on = 'email';
      } else if (name && byName.has(name.toLowerCase())) {
        duplicate = byName.get(name.toLowerCase());
        match_on = 'name';
      }

      return {
        row: idx + 1,
        name,
        ice: ice.replace(/\D/g, '') || ice,
        if_number,
        address,
        city,
        phone,
        email,
        errors,
        valid: errors.filter((e) => e !== 'ICE non standard (15 chiffres attendus)').length === 0 && !!name,
        warning: errors.includes('ICE non standard (15 chiffres attendus)'),
        duplicate: duplicate
          ? { id: duplicate.id, name: duplicate.name, ice: duplicate.ice, email: duplicate.email, match_on }
          : null,
        action: duplicate ? 'skip' : 'create', // default: skip duplicates
      };
    });

    const stats = {
      total: preview.length,
      valid: preview.filter((p) => p.valid).length,
      invalid: preview.filter((p) => !p.valid).length,
      duplicates: preview.filter((p) => p.duplicate).length,
    };
    return c.json({ success: true, data: { rows: preview, stats } });
  });

  app.post('/api/clients/import', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const rows: any[] = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) return c.json({ success: false, error: 'Aucune ligne à importer' }, 400);

    let created = 0, updated = 0, skipped = 0, failed = 0;
    const details: any[] = [];

    for (const r of rows) {
      const action = String(r.action || 'create');
      const name = String(r.name || '').trim();
      if (!name) {
        failed++;
        details.push({ name: r.name, status: 'failed', reason: 'Nom manquant' });
        continue;
      }
      const ice = String(r.ice || '').trim();
      const if_number = String(r.if_number || '').trim();
      const address = String(r.address || '').trim();
      const city = String(r.city || '').trim();
      const phone = String(r.phone || '').trim();
      const email = String(r.email || '').trim();

      try {
        if (action === 'skip') {
          skipped++;
          details.push({ name, status: 'skipped' });
          continue;
        }
        if (action === 'update' && r.duplicate_id) {
          await c.env.DB.prepare(
            `UPDATE clients SET name = ?, ice = ?, if_number = ?, address = ?, city = ?, phone = ?, email = ? WHERE id = ?`
          ).bind(name, ice, if_number, address, city, phone, email, r.duplicate_id).run();
          updated++;
          details.push({ name, status: 'updated', id: r.duplicate_id });
          continue;
        }
        // create
        const result = await c.env.DB.prepare(
          `INSERT INTO clients (name, ice, if_number, address, city, phone, email) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(name, ice, if_number, address, city, phone, email).run();
        created++;
        details.push({ name, status: 'created', id: result.meta.last_row_id });
      } catch (e: any) {
        failed++;
        details.push({ name, status: 'failed', reason: String(e?.message || e) });
      }
    }

    return c.json({
      success: true,
      data: { created, updated, skipped, failed, details },
      message: `Import clients : ${created} créé(s), ${updated} mis à jour, ${skipped} ignoré(s), ${failed} échec(s).`,
    });
  });
}
