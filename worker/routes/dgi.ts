import type { Hono } from 'hono';
import { buildInvoicePdf } from '../pdf';
import { buildUblInvoiceXml, invoiceToUblInput, validateUblInvoice } from '../ubl';
import { isDgiLiveConfigured, selectDgiAdapter, type DgiClearanceStatus } from '../lib/dgiAdapter';

export interface DgiRouteDeps {
  requireBizMutator: (c: any) => { ok: true; username: string; role?: string } | { ok: false; response: Response };
  requireOwner: (c: any) => { ok: true; username: string; role?: string } | { ok: false; response: Response };
  writeAudit: (
    db: D1Database,
    entry: { username?: string; role?: string; action: string; entity?: string; entity_id?: string; detail?: string; ip?: string },
  ) => Promise<void>;
  clientIp: (c: any) => string;
}

const _dgiDbs = new WeakSet<object>();

export async function ensureDgiSchema(db: D1Database): Promise<void> {
  if (_dgiDbs.has(db as unknown as object)) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS dgi_clearance (
        invoice_id INTEGER PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ubl_ready','queued','submitted','cleared','rejected','retrying')),
        is_stub INTEGER NOT NULL DEFAULT 1,
        ubl_sha256 TEXT DEFAULT '',
        ubl_xml TEXT DEFAULT '',
        clearance_ref TEXT DEFAULT '',
        qr_payload TEXT DEFAULT '',
        stamp_payload TEXT DEFAULT '',
        r2_xml_key TEXT DEFAULT '',
        r2_pdf_key TEXT DEFAULT '',
        retention_until TEXT DEFAULT '',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT DEFAULT '',
        errors_json TEXT DEFAULT '[]',
        warnings_json TEXT DEFAULT '[]',
        submitted_at TEXT,
        cleared_at TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS dgi_status_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL,
        from_status TEXT DEFAULT '',
        to_status TEXT NOT NULL,
        actor TEXT DEFAULT '',
        note TEXT DEFAULT '',
        is_stub INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    )
    .run();
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_dgi_events_inv ON dgi_status_events(invoice_id, id DESC)`).run();
  } catch {
    /* */
  }
  _dgiDbs.add(db as unknown as object);
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function tenYearRetentionDate(issueDate?: string): string {
  const base = String(issueDate || new Date().toISOString()).slice(0, 10);
  const year = /^\d{4}/.test(base) ? Number(base.slice(0, 4)) + 10 : new Date().getUTCFullYear() + 10;
  return `${year}${base.length === 10 ? base.slice(4) : '-12-31'}`;
}

async function recordDgiEvent(
  db: D1Database,
  invoiceId: number,
  fromStatus: string,
  toStatus: DgiClearanceStatus,
  actor: string,
  note: string,
  isStub: boolean,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO dgi_status_events (invoice_id, from_status, to_status, actor, note, is_stub)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(invoiceId, fromStatus, toStatus, actor, note, isStub ? 1 : 0)
    .run();
  try {
    await db
      .prepare(`INSERT INTO status_events (invoice_id, from_status, to_status, by_user) VALUES (?, ?, ?, ?)`)
      .bind(invoiceId, `dgi:${fromStatus}`, `dgi:${toStatus}`, actor)
      .run();
  } catch {
    /* status_events table is optional in isolated unit DBs */
  }
}

export function registerDgiRoutes(app: Hono<any>, deps: DgiRouteDeps): void {
  const { requireBizMutator, requireOwner, writeAudit, clientIp } = deps;

  app.get('/api/invoices/:id/dgi', async (c) => {
    await ensureDgiSchema(c.env.DB);
    const id = Number(c.req.param('id') || 0);
    if (!id) return c.json({ success: false, error: 'id invalide' }, 400);

    const row = (await c.env.DB.prepare(`SELECT * FROM dgi_clearance WHERE invoice_id = ?`).bind(id).first()) as any;
    const eventsRes = await c.env.DB
      .prepare(`SELECT * FROM dgi_status_events WHERE invoice_id = ? ORDER BY id DESC LIMIT 50`)
      .bind(id)
      .all();

    const liveConfigured = isDgiLiveConfigured(c.env);
    if (!row) {
      return c.json({
        success: true,
        data: {
          invoice_id: id,
          status: 'draft',
          is_stub: !liveConfigured,
          live_configured: liveConfigured,
          errors: [],
          warnings: [],
          events: eventsRes.results || [],
        },
      });
    }

    let errors: any[] = [];
    let warnings: any[] = [];
    try { errors = JSON.parse(row.errors_json || '[]'); } catch { /* */ }
    try { warnings = JSON.parse(row.warnings_json || '[]'); } catch { /* */ }

    return c.json({
      success: true,
      data: {
        invoice_id: id,
        status: row.status,
        is_stub: Number(row.is_stub) === 1,
        live_configured: liveConfigured,
        ubl_sha256: row.ubl_sha256 || '',
        clearance_ref: row.clearance_ref || '',
        qr_payload: row.qr_payload || '',
        stamp_payload: row.stamp_payload || '',
        r2_xml_key: row.r2_xml_key || '',
        r2_pdf_key: row.r2_pdf_key || '',
        retention_until: row.retention_until || '',
        attempts: Number(row.attempts || 0),
        last_error: row.last_error || '',
        errors,
        warnings,
        submitted_at: row.submitted_at || null,
        cleared_at: row.cleared_at || null,
        has_xml: Boolean(row.ubl_xml && String(row.ubl_xml).length > 10),
        events: eventsRes.results || [],
      },
    });
  });

  app.post('/api/invoices/:id/dgi/prepare', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    await ensureDgiSchema(c.env.DB);
    const id = Number(c.req.param('id') || 0);
    if (!id) return c.json({ success: false, error: 'id invalide' }, 400);

    const invoice = (await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first()) as any;
    if (!invoice) return c.json({ success: false, error: 'Facture introuvable' }, 404);
    if (invoice.status === 'quote' || invoice.status === 'devis') {
      return c.json({ success: false, error: 'Les devis ne sont pas soumis à la DGI' }, 400);
    }
    const settings = (await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first()) as any;
    const { results: items } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).bind(id).all();
    const ublInput = invoiceToUblInput(settings, invoice, items as any[]);
    const validation = validateUblInvoice(ublInput);
    const xml = buildUblInvoiceXml(ublInput);
    const hash = await sha256Hex(xml);

    const existing = (await c.env.DB.prepare(`SELECT status FROM dgi_clearance WHERE invoice_id = ?`).bind(id).first()) as any;
    const fromStatus = String(existing?.status || 'draft');
    const nextStatus: DgiClearanceStatus = validation.ok ? 'ubl_ready' : 'draft';
    const isStub = !isDgiLiveConfigured(c.env);

    await c.env.DB
      .prepare(
        `INSERT INTO dgi_clearance (
          invoice_id, status, is_stub, ubl_sha256, ubl_xml, errors_json, warnings_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(invoice_id) DO UPDATE SET
          status = excluded.status,
          is_stub = excluded.is_stub,
          ubl_sha256 = excluded.ubl_sha256,
          ubl_xml = excluded.ubl_xml,
          errors_json = excluded.errors_json,
          warnings_json = excluded.warnings_json,
          updated_at = datetime('now')`,
      )
      .bind(
        id,
        nextStatus,
        isStub ? 1 : 0,
        hash,
        xml,
        JSON.stringify(validation.errors || []),
        JSON.stringify(validation.warnings || []),
      )
      .run();

    await recordDgiEvent(
      c.env.DB,
      id,
      fromStatus,
      nextStatus,
      gate.username,
      validation.ok ? 'UBL 2.1 validé et prêt pour soumission DGI' : `${validation.errors.length} erreur(s) UBL`,
      isStub,
    );

    return c.json({
      success: true,
      data: {
        invoice_id: id,
        status: nextStatus,
        is_stub: isStub,
        ubl_sha256: hash,
        validation_ok: validation.ok,
        errors: validation.errors,
        warnings: validation.warnings,
      },
    });
  });

  async function executeDgiSubmit(c: any, id: number, actor: string) {
    await ensureDgiSchema(c.env.DB);
    const invoice = (await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first()) as any;
    if (!invoice) return c.json({ success: false, error: 'Facture introuvable' }, 404);

    const settings = (await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first()) as any;
    const { results: items } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).bind(id).all();
    const ublInput = invoiceToUblInput(settings, invoice, items as any[]);
    const validation = validateUblInvoice(ublInput);
    const xml = buildUblInvoiceXml(ublInput);
    const sha256 = await sha256Hex(xml);

    const cur = (await c.env.DB.prepare(`SELECT * FROM dgi_clearance WHERE invoice_id = ?`).bind(id).first()) as any;
    const startStatus = String(cur?.status || 'draft');
    if (startStatus === 'cleared') {
      return c.json({ success: false, error: 'Facture déjà validée (cleared) par la DGI', code: 'DGI_ALREADY_CLEARED' }, 409);
    }

    // Track state machine: queued -> submitted -> cleared | rejected | retrying
    await c.env.DB
      .prepare(
        `INSERT INTO dgi_clearance (invoice_id, status, ubl_sha256, ubl_xml, errors_json, warnings_json, updated_at)
         VALUES (?, 'queued', ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(invoice_id) DO UPDATE SET
           status = 'queued', ubl_sha256 = excluded.ubl_sha256, ubl_xml = excluded.ubl_xml, updated_at = datetime('now')`,
      )
      .bind(id, sha256, xml, JSON.stringify(validation.errors || []), JSON.stringify(validation.warnings || []))
      .run();
    await recordDgiEvent(c.env.DB, id, startStatus, 'queued', actor, 'Mise en file pour soumission DGI', !isDgiLiveConfigured(c.env));

    await c.env.DB
      .prepare(`UPDATE dgi_clearance SET status = 'submitted', submitted_at = datetime('now'), attempts = attempts + 1, updated_at = datetime('now') WHERE invoice_id = ?`)
      .bind(id)
      .run();
    await recordDgiEvent(c.env.DB, id, 'queued', 'submitted', actor, 'Transmission vers adaptateur DGI', !isDgiLiveConfigured(c.env));

    const adapter = selectDgiAdapter(c.env);
    const result = await adapter.submitInvoice({
      invoiceId: id,
      invoiceNumber: String(invoice.invoice_number || invoice.number || `FAC-${id}`),
      companyIce: String(settings?.ice || ''),
      xml,
      sha256,
      ublInput,
    });

    const finalXml = result.signed_xml || xml;
    const retentionUntil = tenYearRetentionDate(invoice.issue_date);
    let r2XmlKey = String(cur?.r2_xml_key || '');
    let r2PdfKey = String(cur?.r2_pdf_key || '');

    if (result.status === 'cleared' && c.env.IMAGES) {
      const year = String(invoice.issue_date || new Date().toISOString()).slice(0, 4) || String(new Date().getUTCFullYear());
      const shortSha = sha256.slice(0, 10);
      r2XmlKey = `dgi-archive/${year}/invoice-${id}-${shortSha}.xml`;
      r2PdfKey = `dgi-archive/${year}/invoice-${id}-${shortSha}.pdf`;
      const meta = {
        retention_years: '10',
        retention_until: retentionUntil,
        invoice_id: String(id),
        clearance_ref: String(result.clearance_ref || ''),
        is_stub: result.is_stub ? 'true' : 'false',
      };
      try {
        await c.env.IMAGES.put(r2XmlKey, finalXml, {
          httpMetadata: { contentType: 'application/xml; charset=utf-8' },
          customMetadata: meta,
        });
        const pdfBytes = buildInvoicePdf({
          title: 'FACTURE',
          number: String(invoice.invoice_number || invoice.number || `FAC-${id}`),
          issueDate: String(invoice.issue_date || new Date().toISOString().slice(0, 10)),
          dueDate: invoice.due_date || undefined,
          company: {
            name: settings?.company_name || 'Atlas Commerce',
            address: settings?.address || '',
            city: settings?.city || '',
            ice: settings?.ice || '',
            if_number: settings?.if_number || '',
            rc: settings?.rc || '',
            cnss: settings?.cnss || '',
          },
          party: {
            label: 'Client',
            name: String(invoice.client_name || 'Client'),
            ice: invoice.client_ice || '',
            address: invoice.client_address || '',
            city: invoice.client_city || '',
          },
          items: (items as any[]).map((it) => ({
            name: String(it.product_name || it.name || 'Article'),
            qty: Number(it.quantity || 1),
            unit: Number(it.unit_price || 0),
            taxRate: Number(it.tax_rate || 20),
            total: Number(it.total || 0),
          })),
          subtotal: Number(invoice.subtotal || 0),
          taxAmount: Number(invoice.tax_amount || 0),
          total: Number(invoice.total || 0),
          amountPaid: Number(invoice.amount_paid || 0),
          notes: result.clearance_ref ? `Visa DGI: ${result.clearance_ref}${result.is_stub ? ' (Simulation)' : ''}` : undefined,
        });
        await c.env.IMAGES.put(r2PdfKey, pdfBytes, {
          httpMetadata: { contentType: 'application/pdf' },
          customMetadata: meta,
        });
      } catch {
        /* R2 archival failure must never break invoice workflows */
      }
    } else if (result.status === 'cleared') {
      // Metadata recorded even when R2 binding isn't attached in local unit tests
      const year = String(invoice.issue_date || new Date().toISOString()).slice(0, 4) || String(new Date().getUTCFullYear());
      r2XmlKey = `dgi-archive/${year}/invoice-${id}-${sha256.slice(0, 10)}.xml`;
      r2PdfKey = `dgi-archive/${year}/invoice-${id}-${sha256.slice(0, 10)}.pdf`;
    }

    await c.env.DB
      .prepare(
        `UPDATE dgi_clearance
         SET status = ?, is_stub = ?, ubl_xml = ?, clearance_ref = ?, qr_payload = ?, stamp_payload = ?,
             r2_xml_key = ?, r2_pdf_key = ?, retention_until = ?, last_error = ?,
             cleared_at = CASE WHEN ? = 'cleared' THEN datetime('now') ELSE cleared_at END,
             updated_at = datetime('now')
         WHERE invoice_id = ?`,
      )
      .bind(
        result.status,
        result.is_stub ? 1 : 0,
        finalXml,
        result.clearance_ref || '',
        result.qr_payload || '',
        result.stamp_payload || '',
        r2XmlKey,
        r2PdfKey,
        result.status === 'cleared' ? retentionUntil : '',
        result.error || '',
        result.status,
        id,
      )
      .run();

    await recordDgiEvent(
      c.env.DB,
      id,
      'submitted',
      result.status,
      actor,
      result.status === 'cleared'
        ? `Validé (${result.clearance_ref || 'OK'})${result.is_stub ? ' [Stub]' : ''}`
        : result.error || `Statut ${result.status}`,
      result.is_stub,
    );

    try {
      await c.env.DB.prepare(`UPDATE invoices SET dgi_status = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(result.status, id)
        .run();
    } catch {
      /* */
    }

    await writeAudit(c.env.DB, {
      username: actor,
      role: 'biz',
      action: `dgi.${result.status}`,
      entity: 'invoices',
      entity_id: String(id),
      detail: JSON.stringify({ status: result.status, is_stub: result.is_stub, clearance_ref: result.clearance_ref || '' }),
      ip: clientIp(c),
    });

    const latest = await c.env.DB.prepare(`SELECT * FROM dgi_clearance WHERE invoice_id = ?`).bind(id).first();
    const evs = await c.env.DB.prepare(`SELECT * FROM dgi_status_events WHERE invoice_id = ? ORDER BY id DESC`).bind(id).all();
    return c.json({
      success: true,
      data: {
        ...(latest as any),
        is_stub: Number((latest as any)?.is_stub) === 1,
        events: evs.results || [],
      },
    });
  }

  app.post('/api/invoices/:id/dgi/submit', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const id = Number(c.req.param('id') || 0);
    if (!id) return c.json({ success: false, error: 'id invalide' }, 400);
    return executeDgiSubmit(c, id, gate.username);
  });

  app.post('/api/invoices/:id/dgi/retry', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const id = Number(c.req.param('id') || 0);
    if (!id) return c.json({ success: false, error: 'id invalide' }, 400);
    return executeDgiSubmit(c, id, gate.username);
  });

  // Owner-only download of 10-year R2 archived XML / PDF
  app.get('/api/invoices/:id/dgi/archive', async (c) => {
    const gate = requireOwner(c);
    if (!gate.ok) return gate.response;
    await ensureDgiSchema(c.env.DB);
    const id = Number(c.req.param('id') || 0);
    const kind = String(c.req.query('kind') || 'xml').toLowerCase() === 'pdf' ? 'pdf' : 'xml';
    const row = (await c.env.DB.prepare(`SELECT * FROM dgi_clearance WHERE invoice_id = ?`).bind(id).first()) as any;
    if (!row) return c.json({ success: false, error: 'Archive DGI introuvable' }, 404);

    if (kind === 'pdf') {
      if (c.env.IMAGES && row.r2_pdf_key) {
        const obj = await c.env.IMAGES.get(row.r2_pdf_key);
        if (obj) {
          return new Response(await obj.arrayBuffer(), {
            headers: {
              'Content-Type': 'application/pdf',
              'Content-Disposition': `attachment; filename="dgi_invoice_${id}.pdf"`,
              'X-Retention-Until': String(row.retention_until || ''),
            },
          });
        }
      }
      return c.json({ success: false, error: 'Archive PDF non disponible dans R2' }, 404);
    }

    if (c.env.IMAGES && row.r2_xml_key) {
      const obj = await c.env.IMAGES.get(row.r2_xml_key);
      if (obj) {
        return new Response(await obj.text(), {
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Content-Disposition': `attachment; filename="dgi_invoice_${id}.xml"`,
            'X-Retention-Until': String(row.retention_until || ''),
          },
        });
      }
    }
    if (!row.ubl_xml) return c.json({ success: false, error: 'XML archivé introuvable' }, 404);
    return new Response(row.ubl_xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="dgi_invoice_${id}.xml"`,
        'X-Retention-Until': String(row.retention_until || ''),
      },
    });
  });
}
