import type { Hono } from 'hono';
import { schemaOnce, addColumnIfMissing } from '../lib/schema';
import {
  ensureDocAssetColumns,
  generateReceiptHTMLMinimal,
  generateReceiptHTML,
  REFUND_POLICY_TEXT,
  generateInvoiceHTML,
} from '../lib/printTemplates';
import { buildInvoicePdf } from '../pdf';
import { buildInvoicePdfLib } from '../pdf-lib-invoice';
import { buildUblInvoiceXml, invoiceToUblInput, validateUblInvoice } from '../ubl';
import { nextDocumentNumber } from '../lib/numbering';
import { normalizeRole, canMutateBusiness } from '../lib/rbac';
import { apiFail } from '../lib/api-response';
import { validateReceiptWrite, validateBillWrite } from '../lib/validate';
import { afterBusinessMutation } from '../lib/delete-coord';
import { doCacheGet, doCachePut, hasLiveCache } from '../lib/cache';
import { ensureBillReceive } from './inventoryOps';
import { ensureReceiptPublicToken } from './publicSigned';
import {
  aggregateDocumentTotals,
  computeBillLine,
  computePaymentApplication,
  roundMoneyForCurrency,
  sanitizeNonNegativeAmount,
  sanitizePositiveAmount,
  subMoneyAmounts,
} from '../lib/financeCore';

export interface BillsReceiptsRouteDeps {
  requireBizMutator: (c: any) => any;
  sessionUserFromHeader: (header: string | undefined) => any;
  checkConfirmPassword: (env: any, db: D1Database, authHeader: string | undefined, body: any) => Promise<any>;
  writeAudit: (db: D1Database, entry: any) => Promise<void>;
  issueDeleteOtp: (...args: any[]) => Promise<any>;
  ensureDocumentActors: (db: D1Database, table: 'invoices' | 'bills' | 'receipts') => Promise<void>;
  ensurePaymentHistoryTable: (db: D1Database) => Promise<void>;
  ensureExpenseTypeColumn: (db: D1Database) => Promise<void>;
  ensureReceiptsTable: (db: D1Database) => Promise<void>;
  ensureReceiptSituationColumn: (db: D1Database) => Promise<void>;
  ensureInvoicePublicToken: (db: D1Database) => Promise<void>;
  ensureQrPrivacySettings: (db: D1Database) => Promise<void>;
  extractIdempotencyKey: (c: any, body: any) => string | null;
  idempotencyGet: (db: D1Database, key: string) => Promise<any>;
  idempotencyPut: (db: D1Database, key: string, route: string, status: number, body: any) => Promise<void>;
  applyStockDelta: (...args: any[]) => Promise<any>;
  applyMovingAverageCost: (...args: any[]) => Promise<any>;
  assertPeriodOpen: (db: D1Database, dateStr?: string | null) => Promise<{ ok: boolean; error?: string }>;
  roundDh: (n: any) => number;
  moroccoTodayStr: () => string;
  makePublicToken: () => string;
  makeSecureQrPayload: (...args: any[]) => Promise<string>;
  createAtlasTimestampToken: (...args: any[]) => Promise<any>;
  documentIntegrityHash: (payload: any) => Promise<string>;
  invoiceDocHashPayload: (...args: any[]) => any;
  sha256Hex: (input: string) => Promise<string>;
  validateStoredSignature: (...args: any[]) => any;
  generateOTP: () => string;
  otpEmailHTML: (...args: any[]) => string;
  expensesLinkedToReceipt: (db: D1Database, receipt: any) => Promise<any[]>;
  cascadeDeleteInvoice: (db: D1Database, id: string | number, opts?: { createdBy?: string }) => Promise<any>;
}

function parseBillText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const t = text.replace(/\r/g, '');
  const ice = t.match(/\b(\d{15})\b/);
  if (ice) out.ice = ice[1];
  const num = t.match(/(?:facture|invoice|n[°o]|number)[:\s#]*([A-Za-z0-9\-/]{3,20})/i);
  if (num) out.bill_number = num[1];
  const date = t.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (date) {
    let y = date[3];
    if (y.length === 2) y = '20' + y;
    out.issue_date = `${y}-${date[2].padStart(2, '0')}-${date[1].padStart(2, '0')}`;
  }
  const total = t.match(/(?:total\s*(?:ttc|à payer|a payer|due|net)?|montant(?:\s*ttc)?)[:\s]*([\d\s.,]+)\s*(?:dh|mad|dhs)?/i);
  if (total) {
    const v = total[1].replace(/[^\d.,]/g, '').replace(/\s/g, '').replace(',', '.');
    const n = Number(v);
    if (n > 0) out.total = String(n);
  }
  const vendor = t.match(/^\s*([A-ZÀ-Ý][\wÀ-ÿ&.'\- ]{2,60})\s*$/m);
  if (vendor && !/facture|total|date|ice|tva|t[ée]l|phone|adresse|address|devise|page/i.test(vendor[1])) {
    out.vendor_name = vendor[1].trim();
  }
  return out;
}


export async function ensureBillPaymentsTable(db: D1Database) {
  await schemaOnce('ensureBillPaymentsTable', async () => {
  await db.prepare(`CREATE TABLE IF NOT EXISTS bill_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT DEFAULT 'cash',
    payee TEXT DEFAULT 'company',
    note TEXT DEFAULT '',
    paid_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_bill_payments_bill ON bill_payments(bill_id)`).run();
  } catch { /* */ }

  });
}


export function registerBillsReceiptsRoutes(app: Hono<any>, deps: BillsReceiptsRouteDeps): void {
  const {
    requireBizMutator,
    sessionUserFromHeader,
    checkConfirmPassword,
    writeAudit,
    issueDeleteOtp,
    ensureDocumentActors,
    ensurePaymentHistoryTable,
    ensureExpenseTypeColumn,
    ensureReceiptsTable,
    ensureReceiptSituationColumn,
    ensureInvoicePublicToken,
    ensureQrPrivacySettings,
    extractIdempotencyKey,
    idempotencyGet,
    idempotencyPut,
    applyStockDelta,
    applyMovingAverageCost,
    assertPeriodOpen,
    moroccoTodayStr,
    makePublicToken,
    makeSecureQrPayload,
    createAtlasTimestampToken,
    documentIntegrityHash,
    invoiceDocHashPayload,
    sha256Hex,
    validateStoredSignature,
    generateOTP,
    otpEmailHTML,
    expensesLinkedToReceipt,
    cascadeDeleteInvoice,
  } = deps;

  /* ─── Bills ─── */
  
  
  
  /** Server-side PDF (binary) — zero external runtime deps */
  async function invoiceToPdfInput(settings: any, inv: any, items: any[], title: string) {
    const integrityHash = await documentIntegrityHash({
      title,
      number: inv.number,
      issue_date: inv.issue_date,
      client: inv.client_name || inv.vendor_name,
      total: Number(inv.total || 0),
      paid: Number(inv.amount_paid || 0),
      status: inv.status,
      lines: (items || []).length,
    });
    let signatureValid: boolean | undefined;
    if (inv.client_signature) {
      const check = await validateStoredSignature(inv);
      signatureValid = check.present && check.imageOk && check.digestOk && check.docUnchanged;
    }
    return {
      title,
      number: String(inv.number || ''),
      issueDate: String(inv.issue_date || ''),
      dueDate: inv.due_date ? String(inv.due_date) : undefined,
      company: {
        name: settings?.company_name || '',
        address: settings?.address,
        city: [settings?.city, settings?.postal_code].filter(Boolean).join(' '),
        phone: settings?.phone,
        email: settings?.email,
        ice: settings?.ice,
        if_number: settings?.if_number,
        rc: settings?.rc,
        patente: settings?.patente,
        cnss: settings?.cnss,
        legal_form: settings?.legal_form,
        bank_name: settings?.bank_name,
        bank_iban: settings?.bank_iban,
      },
      party: {
        label: title.includes('ACHAT') ? 'Fournisseur' : 'Client',
        name: inv.client_name || inv.vendor_name || '',
        ice: inv.client_ice || inv.vendor_ice || '',
        address: inv.client_address || inv.vendor_address || '',
        city: inv.client_city || '',
        email: inv.client_email || '',
        phone: inv.client_phone || '',
      },
      items: (items || []).map((it: any) => {
        const qty = Number(it.quantity || 0);
        const unitSold = Number(it.unit_price ?? it.unit_cost ?? 0);
        const list = Number(it.list_price || 0);
        const pu = list > unitSold ? list : (list > 0 ? list : unitSold);
        return {
          name: it.product_name || '',
          qty,
          unit: pu,
          taxRate: Number(it.tax_rate ?? settings?.tax_rate ?? 0),
          total: qty * pu,
          listPrice: list,
          unitSold,
          discount: Number(it.discount_amount || 0),
        };
      }),
      subtotal: Number(inv.subtotal || 0),
      discountTotal: (items || []).reduce((s: number, it: any) => {
        const qty = Number(it.quantity || 0);
        const list = Number(it.list_price || 0);
        const unit = Number(it.unit_price ?? it.unit_cost ?? 0);
        const discAmt = Number(it.discount_amount || 0);
        const fromList = list > unit ? (list - unit) * qty : 0;
        return s + (discAmt > 0 ? discAmt : fromList);
      }, 0),
      taxAmount: Number(inv.tax_amount || 0),
      total: Number(inv.total || 0),
      amountPaid: Number(inv.amount_paid || 0),
      currency: settings?.currency || 'MAD',
      notes: inv.notes || '',
      refundReason: inv.refund_reason || undefined,
      sourceInvoiceNumber: inv._source_number || undefined,
      // Always attach refund policy on sales invoices + WR (old + new documents)
      refundPolicy:
        title === 'DEVIS' || title.includes('ACHAT')
          ? undefined
          : REFUND_POLICY_TEXT,
      status: inv.status,
      publicUrl: inv.public_url || undefined,
      watermark: title,
      integrityHash,
      clientSignaturePresent: !!(inv.client_signature),
      signedAt: inv.signed_at || undefined,
      signatureValid,
      timestampAt: inv.timestamp_at || undefined,
    };
  }
  
  function pdfResponse(bytes: Uint8Array, filename: string) {
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  }
  
  app.get('/api/invoices/:id/pdf', async (c) => {
    // Same visual source as /print — one HTML template for screen, print, and "Save as PDF".
    // Avoids pdf-lib layout/encoding drift (accents, spaces, QR, promo lines).
    // Magasinier: no money/PDF documents
    {
      const session = sessionUserFromHeader(c.req.header('Authorization'));
      if (normalizeRole(session.role) === 'stock') {
        return c.json({ success: false, error: 'Rôle magasinier : PDF facture non autorisé.', code: 'FORBIDDEN_ROLE' }, 403);
      }
    }
    const id = c.req.param('id');
    await ensureInvoicePublicToken(c.env.DB);
    let invoice = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first() as any;
    if (!invoice) return c.json({ success: false, error: 'Facture introuvable' }, 404);
    if (!invoice.public_token) {
      const tok = makePublicToken();
      await c.env.DB.prepare(`UPDATE invoices SET public_token = ? WHERE id = ?`).bind(tok, id).run();
      invoice = { ...invoice, public_token: tok };
    }
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const { results: items } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).bind(id).all();
    const origin = new URL(c.req.url).origin;
    const secure = await makeSecureQrPayload(c.env, 'invoice', invoice.public_token, 0, c.env.DB);
    invoice.public_url = `${origin}/api/public/verify?p=${encodeURIComponent(secure)}`;
    invoice.public_token_raw = invoice.public_token;
    const st = invoice.status;
    let docTitle = 'FACTURE';
    if (st === 'quote' || st === 'devis') docTitle = 'DEVIS';
    else if (st === 'remboursement' || invoice.doc_kind === 'remboursement') docTitle = 'REMBOURSEMENT (WR)';
    if (docTitle.includes('WR') && invoice.refund_of_invoice_id) {
      try {
        const src = await c.env.DB.prepare(`SELECT number FROM invoices WHERE id = ?`).bind(invoice.refund_of_invoice_id).first() as any;
        if (src?.number) invoice._source_number = src.number;
      } catch { /* */ }
    }
    // Seal timestamp when generating archive view (same as previous PDF path intent)
    if (!invoice.timestamp_token) {
      try {
        const docHash = await sha256Hex(invoiceDocHashPayload(invoice));
        const ts = await createAtlasTimestampToken(c.env, docHash, c.env.DB);
        await c.env.DB.prepare(
          `UPDATE invoices SET signed_doc_hash = COALESCE(signed_doc_hash, ?), timestamp_token = ?, timestamp_at = ? WHERE id = ?`,
        ).bind(docHash, ts.compact, ts.issuedAt, id).run();
      } catch { /* optional */ }
    }
    const html = generateInvoiceHTML(settings, invoice, items as any[], docTitle, true);
    const fname = String(invoice.number || id).replace(/[^\w.-]+/g, '_') + '.html';
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="${fname}"`,
        'Cache-Control': 'no-store',
      },
    });
  });
  
  /**
   * Thermal receipt ESC/POS (58mm width=32, 80mm width=48).
   * GET /api/print/thermal/:id?width=32
   * APK: write body bytes to Bluetooth/USB thermal printer.
   */
  app.get('/api/print/thermal/:id', async (c) => {
    const id = c.req.param('id');
    const width = Number(c.req.query('width') || 32) === 48 ? 48 : 32;
    const invoice = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first() as any;
    if (!invoice) return c.json({ success: false, error: 'Document introuvable' }, 404);
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const { results: items } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).bind(id).all();
    const company = String(settings?.company_name || 'Société');
    const currency = String(settings?.currency || 'MAD');
    const ESC = '\x1b';
    const GS = '\x1d';
    const line = (t: string) => String(t || '').slice(0, width) + '\n';
    const hr = (ch = '-') => ch.repeat(width) + '\n';
    const pair = (l: string, r: string) => {
      const gap = Math.max(1, width - l.length - r.length);
      return l + ' '.repeat(gap) + r + '\n';
    };
    let out = ESC + '@';
    out += ESC + 'a\x01';
    out += ESC + 'E\x01';
    out += GS + '!\x01';
    out += line(company);
    out += GS + '!\x00';
    out += ESC + 'E\x00';
    out += line(String(invoice.number || ''));
    out += line(String(invoice.issue_date || ''));
    out += hr();
    out += ESC + 'a\x00';
    out += line(`Client: ${invoice.client_name || ''}`);
    out += hr();
    for (const it of (items || []) as any[]) {
      out += line(String(it.product_name || ''));
      const tot = Number(it.line_total ?? (Number(it.quantity || 0) * Number(it.unit_price || 0)));
      out += pair(`  x${it.quantity}`, String(tot));
    }
    out += hr('=');
    out += ESC + 'E\x01';
    out += pair('TOTAL', `${Number(invoice.total || 0)} ${currency}`);
    out += ESC + 'E\x00';
    out += ESC + 'a\x01';
    out += line('');
    out += line('Merci de votre visite');
    out += line('');
    out += GS + 'V\x00';
    return new Response(out, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="ticket-${String(invoice.number || id).replace(/[^\w.-]+/g, '_')}.bin"`,
        'X-Thermal-Width': String(width),
        'Cache-Control': 'no-store',
      },
    });
  });
  
  
  /** M1 — UBL clearance-ready (local snapshot + status; no live DGI submit yet) */
  async function ensureUblClearance(db: D1Database) {
    await schemaOnce('ensureUblClearance', async () => {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS invoice_ubl_clearance (
        invoice_id INTEGER PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'draft',
        validation_ok INTEGER DEFAULT 0,
        errors_json TEXT DEFAULT '[]',
        warnings_json TEXT DEFAULT '[]',
        xml_snapshot TEXT,
        xml_sha256 TEXT,
        prepared_at TEXT,
        submitted_at TEXT,
        decided_at TEXT,
        external_ref TEXT,
        note TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `).run();
    await addColumnIfMissing(db, 'invoices', 'dgi_status', `TEXT DEFAULT ''`);
  
    });
  }
  
  
  app.get('/api/invoices/:id/ubl', async (c) => {
    const id = c.req.param('id');
    const invoice = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first() as any;
    if (!invoice) return c.json({ success: false, error: 'Facture introuvable' }, 404);
    if (invoice.status === 'quote' || invoice.status === 'devis') {
      return c.json({ success: false, error: 'Les devis ne sont pas exportés en UBL (réservé aux factures).' }, 400);
    }
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const { results: items } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).bind(id).all();
    const input = invoiceToUblInput(settings, invoice, items as any[]);
    const validation = validateUblInvoice(input);
    if (c.req.query('validate_only') === '1') {
      return c.json({ success: true, data: validation });
    }
    // Optional strict mode: block download if structural errors
    if (c.req.query('strict') === '1' && !validation.ok) {
      return c.json({
        success: false,
        error: 'Export UBL refusé : champs obligatoires manquants.',
        code: 'UBL_VALIDATION_FAILED',
        data: validation,
      }, 400);
    }
    const xml = buildUblInvoiceXml(input);
    const safe = String(invoice.number || id).replace(/[^\w.-]+/g, '_');
    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safe}.ubl.xml"`,
        'Cache-Control': 'no-store',
        'X-UBL-Status': validation.ok ? 'preview-dgi-ready' : 'preview-with-warnings',
        'X-UBL-Errors': String(validation.errors.length),
        'X-UBL-Warnings': String(validation.warnings.length),
      },
    });
  });
  
  app.get('/api/invoices/:id/ubl/validate', async (c) => {
    const id = c.req.param('id');
    const invoice = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first() as any;
    if (!invoice) return c.json({ success: false, error: 'Facture introuvable' }, 404);
    if (invoice.status === 'quote' || invoice.status === 'devis') {
      return c.json({ success: false, error: 'Les devis ne sont pas validés en UBL.', code: 'UBL_QUOTE' }, 400);
    }
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const { results: items } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).bind(id).all();
    const validation = validateUblInvoice(invoiceToUblInput(settings, invoice, items as any[]));
    // Phase 6: persist readiness flag (not live DGI submit — decree-dependent)
    const dgiStatus = validation.ok
      ? (validation.warnings.length ? 'ubl_ok_warnings' : 'ubl_ready')
      : 'ubl_errors';
    await addColumnIfMissing(c.env.DB, 'invoices', 'dgi_status', `TEXT DEFAULT ''`);
    try {
      await c.env.DB.prepare(
        `UPDATE invoices SET dgi_status = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(dgiStatus, id).run();
    } catch { /* */ }
    return c.json({
      success: true,
      data: {
        ...validation,
        dgi_status: dgiStatus,
        clearance: 'not_submitted',
        note: 'Validation structurelle locale. Soumission DGI / PDP lorsque le décret et les credentials sont stables.',
      },
      message: validation.ok
        ? (validation.warnings.length ? `UBL structure OK · ${validation.warnings.length} avertissement(s)` : 'UBL structure OK — prêt pour clearance')
        : `UBL invalide · ${validation.errors.length} erreur(s)`,
    });
  });
  
  /** M1: prepare UBL snapshot + status draft|ready (no live DGI) */
  app.post('/api/invoices/:id/ubl/prepare', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const id = Number(c.req.param('id'));
    if (!id) return c.json({ success: false, error: 'id invalide' }, 400);
    await ensureUblClearance(c.env.DB);
    const invoice = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first() as any;
    if (!invoice) return c.json({ success: false, error: 'Facture introuvable' }, 404);
    if (invoice.status === 'quote' || invoice.status === 'devis') {
      return c.json({ success: false, error: 'Les devis ne sont pas en clearance UBL.', code: 'UBL_QUOTE' }, 400);
    }
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const { results: items } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).bind(id).all();
    const input = invoiceToUblInput(settings, invoice, items as any[]);
    const validation = validateUblInvoice(input);
    const xml = buildUblInvoiceXml(input);
    const hash = await sha256Hex(xml);
    const status = validation.ok ? 'ready' : 'draft';
    const dgiStatus = validation.ok
      ? (validation.warnings.length ? 'ubl_ok_warnings' : 'ubl_ready')
      : 'ubl_errors';
    await c.env.DB.prepare(
      `INSERT INTO invoice_ubl_clearance (
        invoice_id, status, validation_ok, errors_json, warnings_json, xml_snapshot, xml_sha256, prepared_at, note, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, datetime('now'))
      ON CONFLICT(invoice_id) DO UPDATE SET
        status = excluded.status,
        validation_ok = excluded.validation_ok,
        errors_json = excluded.errors_json,
        warnings_json = excluded.warnings_json,
        xml_snapshot = excluded.xml_snapshot,
        xml_sha256 = excluded.xml_sha256,
        prepared_at = excluded.prepared_at,
        note = excluded.note,
        updated_at = datetime('now')`
    ).bind(
      id,
      status,
      validation.ok ? 1 : 0,
      JSON.stringify(validation.errors || []),
      JSON.stringify(validation.warnings || []),
      xml,
      hash,
      validation.ok
        ? 'Snapshot UBL local — prêt (pas encore soumis à DGI/PDP)'
        : 'Snapshot UBL local — corriger les erreurs avant ready',
    ).run();
    try {
      await c.env.DB.prepare(`UPDATE invoices SET dgi_status = ?, updated_at = datetime('now') WHERE id = ?`).bind(dgiStatus, id).run();
    } catch { /* */ }
    return c.json({
      success: true,
      data: {
        invoice_id: id,
        status,
        validation_ok: validation.ok,
        errors: validation.errors || [],
        warnings: validation.warnings || [],
        xml_sha256: hash,
        dgi_status: dgiStatus,
        clearance_live: false,
      },
      message: validation.ok
        ? 'UBL préparé (status: ready). Soumission live DGI non activée.'
        : `UBL en draft — ${validation.errors?.length || 0} erreur(s)`,
    });
  });
  
  /** M1: read clearance record */
  app.get('/api/invoices/:id/ubl/clearance', async (c) => {
    const id = Number(c.req.param('id'));
    if (!id) return c.json({ success: false, error: 'id invalide' }, 400);
    await ensureUblClearance(c.env.DB);
    const row = await c.env.DB.prepare(`SELECT * FROM invoice_ubl_clearance WHERE invoice_id = ?`).bind(id).first() as any;
    if (!row) {
      return c.json({
        success: true,
        data: {
          invoice_id: id,
          status: 'draft',
          validation_ok: false,
          note: 'Aucun snapshot — lancer « Préparer UBL ».',
          clearance_live: false,
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
        validation_ok: !!row.validation_ok,
        errors,
        warnings,
        xml_sha256: row.xml_sha256,
        prepared_at: row.prepared_at,
        submitted_at: row.submitted_at,
        decided_at: row.decided_at,
        external_ref: row.external_ref,
        note: row.note,
        has_snapshot: !!(row.xml_snapshot && String(row.xml_snapshot).length > 20),
        clearance_live: false,
      },
    });
  });
  
  /**
   * M1: set clearance status manually / for future PDP webhook.
   * Allowed: submitted | accepted | rejected (and ready if re-open after fix).
   * Does NOT call DGI — placeholder until credentials exist.
   */
  app.post('/api/invoices/:id/ubl/status', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const id = Number(c.req.param('id'));
    if (!id) return c.json({ success: false, error: 'id invalide' }, 400);
    await ensureUblClearance(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const next = String(body.status || '').toLowerCase().trim();
    const allowed = ['draft', 'ready', 'submitted', 'accepted', 'rejected'];
    if (!allowed.includes(next)) {
      return c.json({ success: false, error: `status invalide (${allowed.join(', ')})` }, 400);
    }
    const existing = await c.env.DB.prepare(`SELECT * FROM invoice_ubl_clearance WHERE invoice_id = ?`).bind(id).first() as any;
    if (!existing || !existing.xml_snapshot) {
      return c.json({ success: false, error: 'Préparez d’abord le snapshot UBL (POST …/ubl/prepare).' }, 400);
    }
    if ((next === 'submitted' || next === 'accepted') && !existing.validation_ok) {
      return c.json({ success: false, error: 'UBL invalide — impossible de marquer soumis/accepté.' }, 400);
    }
    const external_ref = body.external_ref != null ? String(body.external_ref).slice(0, 120) : existing.external_ref;
    const note = body.note != null ? String(body.note).slice(0, 400) : existing.note;
    const submitted_at = next === 'submitted' || next === 'accepted' || next === 'rejected'
      ? (existing.submitted_at || new Date().toISOString())
      : existing.submitted_at;
    const decided_at = next === 'accepted' || next === 'rejected' ? new Date().toISOString() : existing.decided_at;
    await c.env.DB.prepare(
      `UPDATE invoice_ubl_clearance SET
        status = ?, external_ref = ?, note = ?,
        submitted_at = ?, decided_at = ?, updated_at = datetime('now')
       WHERE invoice_id = ?`
    ).bind(next, external_ref || null, note || null, submitted_at || null, decided_at || null, id).run();
    const dgiMap: Record<string, string> = {
      draft: 'ubl_errors',
      ready: 'ubl_ready',
      submitted: 'ubl_submitted',
      accepted: 'ubl_accepted',
      rejected: 'ubl_rejected',
    };
    try {
      await c.env.DB.prepare(`UPDATE invoices SET dgi_status = ?, updated_at = datetime('now') WHERE id = ?`)
        .bind(dgiMap[next] || next, id).run();
    } catch { /* */ }
    return c.json({
      success: true,
      data: {
        invoice_id: id,
        status: next,
        external_ref,
        clearance_live: false,
        note: note || 'Statut local uniquement — pas d’appel DGI/PDP.',
      },
      message: `Statut clearance → ${next}`,
    });
  });
  
  /** Download last prepared snapshot (archive) */
  app.get('/api/invoices/:id/ubl/snapshot', async (c) => {
    const id = Number(c.req.param('id'));
    if (!id) return c.json({ success: false, error: 'id invalide' }, 400);
    await ensureUblClearance(c.env.DB);
    const row = await c.env.DB.prepare(`SELECT xml_snapshot, xml_sha256, status FROM invoice_ubl_clearance WHERE invoice_id = ?`).bind(id).first() as any;
    if (!row?.xml_snapshot) {
      return c.json({ success: false, error: 'Aucun snapshot — POST /ubl/prepare d’abord.' }, 404);
    }
    const inv = await c.env.DB.prepare(`SELECT number FROM invoices WHERE id = ?`).bind(id).first() as any;
    const safe = String(inv?.number || id).replace(/[^\w.-]+/g, '_');
    return new Response(row.xml_snapshot, {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Content-Disposition': `attachment; filename="${safe}.ubl.snapshot.xml"`,
        'Cache-Control': 'no-store',
        'X-UBL-Clearance-Status': String(row.status || ''),
        'X-UBL-SHA256': String(row.xml_sha256 || ''),
      },
    });
  });
  
  app.get('/api/receipts/:id/pdf', async (c) => {
    const id = c.req.param('id');
    await ensureReceiptsTable(c.env.DB);
    const receipt = await c.env.DB.prepare(`SELECT * FROM receipts WHERE id = ?`).bind(id).first() as any;
    if (!receipt) return c.json({ success: false, error: 'Reçu introuvable' }, 404);
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    // Represent receipt as a simple single-line document
    const invLike = {
      number: receipt.number,
      issue_date: receipt.issue_date,
      client_name: receipt.client_name,
      client_ice: '',
      client_address: '',
      client_city: '',
      client_email: '',
      client_phone: '',
      subtotal: Number(receipt.amount || 0),
      tax_amount: 0,
      total: Number(receipt.amount || 0),
      amount_paid: Number(receipt.amount || 0),
      notes: receipt.notes || `Reglement — mode ${receipt.payment_method || ''}`,
      status: 'paid',
    };
    const items = [{ product_name: 'Encaissement client', quantity: 1, unit_price: Number(receipt.amount || 0), tax_rate: 0, line_total: Number(receipt.amount || 0) }];
    const input = await invoiceToPdfInput(settings, invLike, items, 'RECU');
    let bytes: Uint8Array;
    try {
      bytes = await buildInvoicePdfLib(input);
    } catch (e) {
      console.error(JSON.stringify({ event: 'pdf_lib_failed', err: String((e as any)?.message || e), number: (input as any)?.number, title: (input as any)?.title }));
      bytes = buildInvoicePdf(input);
    }
    const safe = String(receipt.number || id).replace(/[^\w.-]+/g, '_');
    return pdfResponse(bytes, `${safe}.pdf`);
  });
  
  app.get('/api/bills', async (c) => {
    const role = normalizeRole(sessionUserFromHeader(c.req.header('Authorization')).role);
    if (!canMutateBusiness(role)) {
      return c.json({ success: false, error: 'Accès non autorisé pour ce rôle.', code: 'FORBIDDEN_ROLE' }, 403);
    }
    const status = c.req.query('status') || '';
    const limit = Math.max(1, Math.min(2000, Number(c.req.query('limit') || 500)));
    const cacheKey = `bills:list:s=${status}:l=${limit}`;
    if (hasLiveCache(c.env)) {
      const hit = await doCacheGet<any[]>(c.env.MOBILE_HUB, c.env.CACHE, cacheKey, 300);
      if (hit) return c.json({ success: true, data: hit, cached: true });
    }
    let sql = `SELECT * FROM bills`;
    const binds: any[] = [];
    if (status) {
      sql += ` WHERE status = ?`;
      binds.push(status);
    }
    sql += ` ORDER BY id DESC LIMIT ?`;
    binds.push(limit);
    const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
    if (hasLiveCache(c.env)) {
      await doCachePut(c.env.MOBILE_HUB, c.env.CACHE, cacheKey, results || [], 300);
    }
    return c.json({ success: true, data: results });
  });
  
  app.get('/api/bills/:id', async (c) => {
    const role = normalizeRole(sessionUserFromHeader(c.req.header('Authorization')).role);
    if (!canMutateBusiness(role)) {
      return c.json({ success: false, error: 'Accès non autorisé pour ce rôle.', code: 'FORBIDDEN_ROLE' }, 403);
    }
    const id = c.req.param('id');
    const bill = await c.env.DB.prepare(`SELECT * FROM bills WHERE id = ?`).bind(id).first();
    if (!bill) return c.json({ success: false, error: 'Facture d\'achat introuvable' }, 404);
    const { results: items } = await c.env.DB.prepare(`SELECT * FROM bill_items WHERE bill_id = ?`).bind(id).all();
    return c.json({ success: true, data: { ...bill, items } });
  });
  
  /* ─── Bills: OCR / document parse (Workers AI Qwen vision — Groq stays dedicated to Atlas Agent chat) ─── */

  app.post('/api/bills/parse-document', async (c) => {
    type OcrStep = { id: string; label: string; status: 'ok' | 'error' | 'skipped'; detail?: string };
    const body = await c.req.json().catch(() => ({}));
    const dataUrl = String(body.data_url || body.dataUrl || '');
    const textHint = String(body.text || '');
    const steps: OcrStep[] = [];
    let fields: Record<string, string> = {};
    let items: any[] = [];
    let source = 'none';
    let usedModel = '';

    // Step 1: Validate input document
    if (!textHint.trim() && !dataUrl) {
      steps.push({ id: 'validation_fichier', label: 'Validation du fichier', status: 'error', detail: 'Aucun fichier ou texte transmis.' });
      return c.json({
        success: false,
        error: 'Aucun fichier transmis pour l’analyse OCR.',
        failing_step: 'validation_fichier',
        steps,
      }, 400);
    }

    if (!textHint.trim() && dataUrl.startsWith('data:application/pdf')) {
      steps.push({
        id: 'validation_fichier',
        label: 'Validation du fichier',
        status: 'error',
        detail: 'Les PDF scannés ne peuvent pas être lus en image directe — importez une photo ou capture (JPG / PNG / WebP).',
      });
      return c.json({
        success: false,
        error: 'PDF scanné non pris en charge par le lecteur optique image — convertissez en photo ou capture (PNG/JPG).',
        failing_step: 'validation_fichier',
        steps,
      }, 422);
    }

    if (!textHint.trim() && !dataUrl.startsWith('data:image/')) {
      steps.push({
        id: 'validation_fichier',
        label: 'Validation du fichier',
        status: 'error',
        detail: 'Format non reconnu comme image (PNG, JPG, WebP).',
      });
      return c.json({
        success: false,
        error: 'Format de document non pris en charge — image PNG/JPG/WebP requise.',
        failing_step: 'validation_fichier',
        steps,
      }, 422);
    }

    steps.push({ id: 'validation_fichier', label: 'Validation du fichier', status: 'ok' });

    if (textHint.trim()) {
      fields = parseBillText(textHint);
      source = 'text';
      steps.push({ id: 'moteur_ocr', label: 'Moteur OCR (Qwen)', status: 'skipped', detail: 'Texte fourni directement.' });
      steps.push({ id: 'analyse_vision', label: 'Analyse visuelle Qwen', status: 'skipped' });
    } else {
      // Step 2: Check Workers AI binding (never uses Groq — Groq stays for Atlas Agent in chat)
      const ai = (c.env as any).AI;
      if (!ai || typeof ai.run !== 'function') {
        steps.push({
          id: 'moteur_ocr',
          label: 'Moteur OCR (Qwen)',
          status: 'error',
          detail: 'Binding Workers AI absent sur cet environnement.',
        });
        return c.json({
          success: false,
          error: 'Moteur OCR Qwen (Workers AI) indisponible sur ce serveur — saisissez les champs manuellement.',
          failing_step: 'moteur_ocr',
          steps,
        }, 422);
      }
      steps.push({ id: 'moteur_ocr', label: 'Moteur OCR (Qwen)', status: 'ok' });

      // Step 3: Run Qwen Vision OCR first, with Workers AI vision fallbacks
      const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!m) {
        steps.push({
          id: 'analyse_vision',
          label: 'Analyse visuelle Qwen',
          status: 'error',
          detail: 'Encodage base64 de l’image invalide.',
        });
        return c.json({
          success: false,
          error: 'Image illisible (encodage base64 invalide).',
          failing_step: 'analyse_vision',
          steps,
        }, 422);
      }

      const ocrPrompt =
        'You are an invoice OCR reader. Read all text accurately from this supplier bill/invoice image and return JSON only: {"vendor_name": string, "issue_date": "YYYY-MM-DD", "bill_number": string, "ice": string, "total": number, "items": [{"product_name": string, "quantity": number, "unit_cost": number}]}. Use "" or 0 for missing fields.';
      const ocrModels = [
        '@cf/qwen/qwen2.5-vl-32b-instruct',
        '@cf/meta/llama-3.2-11b-vision-instruct',
        '@cf/llava-hf/llava-1.5-7b-hf',
      ];
      let rawText = '';
      let lastErr = '';
      const imgBytes = [...Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0))];

      for (const modelId of ocrModels) {
        try {
          const isQwen = modelId.includes('qwen');
          const result = isQwen
            ? await ai.run(modelId, {
                messages: [
                  {
                    role: 'user',
                    content: [
                      { type: 'text', text: ocrPrompt },
                      { type: 'image_url', image_url: { url: dataUrl } },
                    ],
                  },
                ],
                max_tokens: 900,
              })
            : await ai.run(modelId, {
                image: imgBytes,
                prompt: ocrPrompt,
                max_tokens: 700,
              });
          const candidate = String(
            result?.response || result?.description || result?.choices?.[0]?.message?.content || '',
          ).trim();
          if (candidate) {
            rawText = candidate;
            usedModel = modelId;
            break;
          }
          lastErr = `Réponse vide de ${modelId}`;
        } catch (err: any) {
          lastErr = err?.message ? `${modelId}: ${err.message}` : `Échec modèle ${modelId}`;
        }
      }

      if (!rawText) {
        steps.push({
          id: 'analyse_vision',
          label: 'Analyse visuelle Qwen',
          status: 'error',
          detail: lastErr || 'Aucune réponse du moteur OCR.',
        });
        return c.json({
          success: false,
          error: `Échec de la lecture OCR (${lastErr || 'modèle indisponible'}).`,
          failing_step: 'analyse_vision',
          steps,
        }, 422);
      }
      steps.push({
        id: 'analyse_vision',
        label: 'Analyse visuelle Qwen',
        status: 'ok',
        detail: usedModel,
      });

      const jm = rawText.match(/\{[\s\S]*\}/);
      if (jm) {
        try {
          const j = JSON.parse(jm[0]);
          fields = {
            vendor_name: String(j.vendor_name || fields.vendor_name || ''),
            issue_date: /^\d{4}-\d{2}-\d{2}$/.test(String(j.issue_date || ''))
              ? String(j.issue_date)
              : fields.issue_date || '',
            bill_number: String(j.bill_number || fields.bill_number || ''),
            ice: String(j.ice || fields.ice || ''),
            total: String(j.total || fields.total || ''),
          };
          if (Array.isArray(j.items)) {
            items = j.items
              .slice(0, 30)
              .map((it: any) => ({
                product_name: String(it?.product_name || it?.name || ''),
                quantity: Math.max(1, Number(it?.quantity || 1)),
                unit_cost: Math.max(0, Number(it?.unit_cost || it?.cost || it?.unit_price || 0)),
              }))
              .filter((it: any) => it.product_name);
          }
          source = 'ai';
        } catch {
          fields = { ...fields, ...parseBillText(rawText) };
          source = 'ai-text';
        }
      } else {
        fields = { ...fields, ...parseBillText(rawText) };
        source = 'ai-text';
      }
    }

    // Step 4: Verify at least one usable field or line was extracted
    const hasFields = Object.values(fields).some((v) => String(v || '').trim() !== '' && String(v || '').trim() !== '0');
    if (!hasFields && items.length === 0) {
      steps.push({
        id: 'extraction_champs',
        label: 'Extraction des champs',
        status: 'error',
        detail: 'Aucun fournisseur, numéro, date ou article reconnu.',
      });
      return c.json({
        success: false,
        error: 'Extraction impossible — aucun champ exploitable détecté sur ce document.',
        failing_step: 'extraction_champs',
        steps,
      }, 422);
    }

    steps.push({
      id: 'extraction_champs',
      label: 'Extraction des champs',
      status: 'ok',
    });

    return c.json({
      success: true,
      data: {
        fields,
        items,
        source,
        model: usedModel || undefined,
        steps,
        review_message:
          'Champs extraits automatiquement — vérifiez fournisseur, date, lignes et total avant d’enregistrer.',
      },
    });
  });
  
  app.post('/api/bills', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    await ensureDocumentActors(c.env.DB, 'bills');
    const documentCreator = sessionUserFromHeader(c.req.header('Authorization')).username || null;
    const body = await c.req.json().catch(() => ({}));
    const idemKey = extractIdempotencyKey(c, body);
    if (idemKey) {
      const cached = await idempotencyGet(c.env.DB, `bill:${idemKey}`);
      if (cached) return c.json({ ...cached.body, replayed: true }, cached.status);
    }
    const verr = validateBillWrite(body);
    if (verr) return apiFail(c, Object.values(verr)[0] || 'Validation', 'VALIDATION', verr);
    const lockCheck = await assertPeriodOpen(c.env.DB, body.issue_date);
    if (!lockCheck.ok) return c.json({ success: false, error: lockCheck.error, code: 'PERIOD_LOCKED' }, 403);
    const { vendor_id, vendor_name, vendor_ice = '', vendor_address = '', issue_date, due_date = null, notes = '', items = [], status = 'sent' } = body;
    if (!vendor_name || !items.length) return c.json({ success: false, error: 'Le nom du fournisseur et au moins une ligne sont obligatoires' }, 400);
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const currency = String(settings?.currency || settings?.finance_currency || 'MAD');
    const number = await nextDocumentNumber(c.env.DB, 'bill', settings, c.env);
    let subtotal = 0, tax_amount = 0;
    const lineItems: any[] = [];
    const defaultTax = Number(settings?.tax_rate ?? 0);
    for (const item of items) {
      // Purchase price can be lower or higher than catalog cost — always take the line unit_cost.
      const unitCost = Number(item.unit_cost ?? item.cost ?? item.unit_price ?? 0);
      const qty = Number(item.quantity || 0);
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unitCost) || unitCost < 0) {
        return c.json({ success: false, error: 'Quantité ou coût unitaire invalide' }, 400);
      }
      const calc = computeBillLine({
        quantity: qty,
        unitCost,
        taxRate: item.tax_rate != null ? Number(item.tax_rate) : undefined,
        defaultTax,
        currency,
      });
      subtotal += calc.line_ht;
      tax_amount += calc.line_tax;
      lineItems.push({
        ...item,
        unit_cost: calc.unit_cost,
        quantity: calc.quantity,
        tax_rate: calc.tax_rate,
        line_total: calc.line_total,
        update_product_cost: !!item.update_product_cost,
      });
    }
    const billTotals = aggregateDocumentTotals([{ line_ht: subtotal, line_tax_real: tax_amount }], currency);
    subtotal = billTotals.subtotal; tax_amount = billTotals.tax_amount; const total = billTotals.total;
    const billResult = await c.env.DB.prepare(`INSERT INTO bills (number, vendor_id, vendor_name, vendor_ice, vendor_address, issue_date, due_date, status, subtotal, tax_amount, total, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(number, vendor_id || null, vendor_name, vendor_ice, vendor_address, issue_date || new Date().toISOString().slice(0, 10), due_date, status, subtotal, tax_amount, total, notes, documentCreator).run();
    const billId = billResult.meta.last_row_id;
    for (const item of lineItems) {
      await c.env.DB.prepare(`INSERT INTO bill_items (bill_id, product_id, product_name, sku, quantity, unit_cost, tax_rate, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(billId, item.product_id || null, item.product_name, item.sku || '', item.quantity, item.unit_cost, item.tax_rate, item.line_total).run();
      if (item.product_id) {
        // Cost only on bill create — stock is added once on réception (3-way match).
        await applyMovingAverageCost(c.env.DB, item.product_id, Number(item.quantity || 0), Number(item.unit_cost || 0), number);
      }
    }
    const bill = await c.env.DB.prepare(`SELECT * FROM bills WHERE id = ?`).bind(billId).first();
    const { results: billItems } = await c.env.DB.prepare(`SELECT * FROM bill_items WHERE bill_id = ?`).bind(billId).all();
    const payload = {
      success: true,
      data: { ...bill, items: billItems },
      message: 'Facture d\'achat enregistrée. Le stock sera mis à jour à la réception.',
    };
    if (idemKey) await idempotencyPut(c.env.DB, `bill:${idemKey}`, 'POST /bills', 201, payload);
    return c.json(payload, 201);
  });
  
  app.patch('/api/bills/:id/status', async (c) => {
    try {
      const gate = requireBizMutator(c);
      if (!gate.ok) return gate.response;
      const id = c.req.param('id');
      const body = await c.req.json().catch(() => ({}));
      const { status, amount_paid } = body;
      const allowed = ['draft', 'sent', 'paid', 'partial', 'cancelled'];
      if (!allowed.includes(status)) return c.json({ success: false, error: 'Statut invalide' }, 400);
      const prev = await c.env.DB.prepare(`SELECT * FROM bills WHERE id = ?`).bind(id).first() as any;
      if (!prev) return c.json({ success: false, error: 'Facture d\'achat introuvable' }, 404);
  
      // Cancelling reverses only what was actually received (not ordered qty)
      if (status === 'cancelled' && prev.status !== 'cancelled') {
        await ensureBillReceive(c.env.DB);
        const { results: items } = await c.env.DB.prepare(
          `SELECT product_id, COALESCE(qty_received, 0) as qty_received FROM bill_items WHERE bill_id = ?`
        ).bind(id).all();
        for (const it of (items || []) as any[]) {
          const recv = Number(it.qty_received || 0);
          if (it.product_id && recv > 0) {
            await applyStockDelta(
              c.env.DB,
              it.product_id,
              -recv,
              'Achat annulé (retrait stock reçu)',
              prev.number,
              { type: 'purchase_cancel', createdBy: sessionUserFromHeader(c.req.header('Authorization')).username || undefined }
            );
          }
        }
        try {
          await c.env.DB.prepare(`UPDATE bill_items SET qty_received = 0 WHERE bill_id = ?`).bind(id).run();
          await c.env.DB.prepare(`UPDATE bills SET receive_status = 'pending' WHERE id = ?`).bind(id).run();
        } catch { /* */ }
      }
      // Re-activating a cancelled bill does NOT re-add stock — réception again if needed
  
      const updates = [`status = ?`, `updated_at = datetime('now')`];
      const values: any[] = [status];
      if (amount_paid !== undefined) {
        const safePaid = sanitizeNonNegativeAmount(amount_paid, { max: 1e12, decimals: 2 });
        if (safePaid == null) return c.json({ success: false, error: 'Montant payé invalide' }, 400);
        updates.push(`amount_paid = ?`);
        values.push(safePaid);
      }
      values.push(id);
      await c.env.DB.prepare(`UPDATE bills SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
      await afterBusinessMutation(c.env.CACHE, c.env.MOBILE_HUB);
      const bill = await c.env.DB.prepare(`SELECT * FROM bills WHERE id = ?`).bind(id).first();
      return c.json({
        success: true,
        data: bill,
        message:
          status === 'cancelled'
            ? 'Facture d\'achat annulée — stock réajusté.'
            : 'Statut de la facture d\'achat mis à jour dans la base de données.',
      });
    } catch (e: any) {
      console.error('bill status', e);
      return c.json({ success: false, error: e?.message || 'Échec mise à jour', code: 'UPDATE_FAILED' }, 400);
    }
  });
  
  /** Bill payment history (split payments like invoices) */
  
  app.post('/api/bills/:id/payments', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const id = c.req.param('id');
    await ensureBillPaymentsTable(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const idemKey = extractIdempotencyKey(c, body);
    if (idemKey) {
      const cached = await idempotencyGet(c.env.DB, `billpay:${id}:${idemKey}`);
      if (cached) return c.json(cached.body, cached.status as any);
    }
    const amount = Number(body.amount || 0);
    const payment_method = String(body.payment_method || 'cash');
    const payee = String(body.payee || 'company');
    const note = String(body.note || '');
    // v258 — tenant-local day (Africa/Casablanca), never the UTC date: a payment
    // made just after local midnight used to land in the previous month's finance
    // period because substr(paid_at,1,10) read a UTC day.
    const paid_at = String(body.paid_at || moroccoTodayStr()).slice(0, 10);
    if (!amount || amount <= 0) return c.json({ success: false, error: 'Montant de paiement invalide' }, 400);
    const allowedMethods = [
      'cash', 'bank_company', 'bank_owner', 'check_company', 'check_owner', 'card', 'other',
      'bank', 'check',
    ];
    const method = allowedMethods.includes(payment_method) ? payment_method : 'cash';
    const who = payee === 'owner' ? 'owner' : 'company';
  
    const bill = await c.env.DB.prepare(`SELECT * FROM bills WHERE id = ?`).bind(id).first() as any;
    if (!bill) return c.json({ success: false, error: 'Facture d\'achat introuvable' }, 404);
    if (bill.status === 'cancelled') return c.json({ success: false, error: 'Facture d\'achat annulée' }, 400);
  
    const prev = Number(bill.amount_paid || 0);
    const total = Number(bill.total || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return c.json({ success: false, error: 'Montant de paiement invalide' }, 400);
    }
    let billCurrency = 'MAD';
    try {
      const st = await c.env.DB.prepare(`SELECT currency, finance_currency FROM company_settings WHERE id = 1`).first() as any;
      billCurrency = String(st?.currency || st?.finance_currency || 'MAD');
    } catch { /* */ }
    const payApp = computePaymentApplication(amount, total, prev, billCurrency);
    if (!payApp) {
      return c.json({ success: false, error: 'Cette facture d\'achat est déjà soldée (reste = 0).', code: 'ALREADY_PAID' }, 400);
    }
    const { applied, next_paid: next, remaining, status } = payApp;

    await ensureExpenseTypeColumn(c.env.DB);
    await c.env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS payment_assertions (marker TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok = 1))`
    ).run();
    await c.env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT DEFAULT 'General',
        description TEXT NOT NULL,
        amount REAL NOT NULL,
        payment_method TEXT DEFAULT 'cash',
        expense_date TEXT,
        vendor_name TEXT DEFAULT '',
        reference TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        entry_type TEXT DEFAULT 'expense',
        created_at TEXT DEFAULT (datetime('now'))
      )`
    ).run();
    const ledgerMethod =
      method === 'cash' || method === 'card' ? 'cash' :
      method.startsWith('bank') ? 'bank' :
      method.startsWith('check') ? 'check' : 'other';
    const whoLabel = who === 'owner' ? 'propriétaire' : 'société';
    const methodLabel =
      method === 'cash' ? 'espèces' :
      method === 'card' ? 'carte' :
      method === 'bank_company' ? 'virement société' :
      method === 'bank_owner' ? 'virement propriétaire' :
      method === 'check_company' ? 'chèque société' :
      method === 'check_owner' ? 'chèque propriétaire' :
      method === 'bank' ? 'virement' :
      method === 'check' ? 'chèque' : method;
    const ledgerDesc = `Règlement achat ${bill.number} (${methodLabel} → ${whoLabel})${note ? ' — ' + note : ''}`;

    const billMarker = crypto.randomUUID();
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO payment_assertions(marker, ok)
           SELECT ?, CASE WHEN EXISTS (
             SELECT 1 FROM bills
             WHERE id = ?
               AND status != 'cancelled'
               AND COALESCE(amount_paid, 0) IS ?
               AND COALESCE(total, 0) IS ?
           ) THEN 1 ELSE 0 END`
        ).bind(billMarker, id, bill.amount_paid ?? 0, bill.total ?? 0),
        c.env.DB.prepare(
          `INSERT INTO bill_payments (bill_id, amount, payment_method, payee, note, paid_at) VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(id, applied, method, who, note, paid_at),
        c.env.DB.prepare(
          `INSERT INTO expenses (category, description, amount, payment_method, expense_date, vendor_name, reference, notes, entry_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'expense')`
        ).bind(
          'Règlement fournisseur',
          ledgerDesc,
          applied,
          ledgerMethod,
          paid_at,
          bill.vendor_name || '',
          bill.number || '',
          `bill_id:${id}|payee:${who}|method:${method}`,
        ),
        c.env.DB.prepare(
          `UPDATE bills SET amount_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
        ).bind(next, status, id),
        c.env.DB.prepare(`DELETE FROM payment_assertions WHERE marker = ?`).bind(billMarker),
      ]);
    } catch (billErr: any) {
      console.error('bill_payment_atomic_failed', String(billErr?.message || billErr));
      return c.json({
        success: false,
        error: 'Paiement refusé : la facture fournisseur a été modifiée simultanément. Actualisez et réessayez.',
        code: 'PAYMENT_CONFLICT',
      }, 409);
    }
    await afterBusinessMutation(c.env.CACHE, c.env.MOBILE_HUB);

    const payload = {
      success: true,
      data: await c.env.DB.prepare(`SELECT * FROM bills WHERE id = ?`).bind(id).first(),
      applied,
      remaining,
      message:
        status === 'paid'
          ? `Paiement de ${applied} ${billCurrency} enregistré — facture d'achat soldée.`
          : `Paiement partiel de ${applied} ${billCurrency} enregistré — reste ${remaining} ${billCurrency}.`,
    };
    if (idemKey) {
      try {
        await idempotencyPut(c.env.DB, `billpay:${id}:${idemKey}`, 'POST /bills/payments', 200, payload);
      } catch { /* */ }
    }
    return c.json(payload);
  });
  
  app.get('/api/bills/:id/payments', async (c) => {
    await ensureBillPaymentsTable(c.env.DB);
    const id = c.req.param('id');
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM bill_payments WHERE bill_id = ? ORDER BY paid_at DESC, id DESC`
    ).bind(id).all();
    return c.json({ success: true, data: results || [] });
  });
  
  app.get('/api/bills/:id/print', async (c) => {
    const id = c.req.param('id');
    const bill = await c.env.DB.prepare(`SELECT * FROM bills WHERE id = ?`).bind(id).first();
    if (!bill) return c.json({ success: false, error: 'Facture d\'achat introuvable' }, 404);
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const { results: items } = await c.env.DB.prepare(`SELECT * FROM bill_items WHERE bill_id = ?`).bind(id).all();
    await ensureDocAssetColumns(c.env.DB);
    return c.html(generateInvoiceHTML(settings, bill as any, items as any[], 'FACTURE D\'ACHAT'));
  });
  
  app.post('/api/bills/:id/request-delete-otp', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const id = c.req.param('id');
    const bill = await c.env.DB.prepare(`SELECT * FROM bills WHERE id = ?`).bind(id).first() as any;
    if (!bill) return c.json({ success: false, error: 'Facture d\'achat introuvable' }, 404);
    const label = `Facture d'achat ${bill.number}`;
    const result = await issueDeleteOtp(c.env, 'bill', String(id), label, `Code de suppression — ${label}`);
    return c.json({ success: true, message: result.message, emailed: result.emailed, otp: result.emailed ? undefined : result.otp });
  });
  
  app.delete('/api/bills/:id', async (c) => {
    try {
      const gate = requireBizMutator(c);
      if (!gate.ok) return gate.response;
      const id = c.req.param('id');
      const body = await c.req.json().catch(() => ({}));
      const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
      if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);
      const bill = await c.env.DB.prepare(`SELECT * FROM bills WHERE id = ?`).bind(id).first() as any;
      if (!bill) return c.json({ success: false, error: 'Facture fournisseur introuvable' }, 404);
      // Reverse only received qty (stock is applied on réception, not on create)
      if (bill.status !== 'cancelled') {
        await ensureBillReceive(c.env.DB);
        const { results: items } = await c.env.DB.prepare(
          `SELECT product_id, COALESCE(qty_received, 0) as qty_received FROM bill_items WHERE bill_id = ?`
        ).bind(id).all();
        for (const it of (items || []) as any[]) {
          const recv = Number(it.qty_received || 0);
          if (it.product_id && recv > 0) {
            await applyStockDelta(
              c.env.DB,
              it.product_id,
              -recv,
              'Achat supprimé (retrait stock reçu)',
              bill.number,
              { type: 'purchase_delete', createdBy: sessionUserFromHeader(c.req.header('Authorization')).username || undefined }
            );
          }
        }
      }
      await c.env.DB.prepare(`DELETE FROM bill_items WHERE bill_id = ?`).bind(id).run();
      await c.env.DB.prepare(`DELETE FROM bills WHERE id = ?`).bind(id).run();
      await afterBusinessMutation(c.env.CACHE, c.env.MOBILE_HUB);
      await writeAudit(c.env.DB, {
        username: gate.username, role: gate.role, action: 'bill.delete',
        entity: 'bills', entity_id: id, detail: bill.number || '',
        ip: c.req.header('cf-connecting-ip') || '',
      });
      return c.json({ success: true, message: `Facture fournisseur ${bill.number} supprimée.` });
    } catch (e: any) {
      console.error('bill delete', e);
      return c.json({ success: false, error: e?.message || 'Échec de la suppression', code: 'DELETE_FAILED' }, 400);
    }
  });
  
  app.post('/api/bills/request-bulk-delete-otp', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const body = await c.req.json().catch(() => ({}));
    const ids: number[] = Array.isArray(body.ids) ? body.ids.map((x: any) => Number(x)).filter((n: number) => n > 0) : [];
    if (!ids.length) return c.json({ success: false, error: 'Aucune facture d\'achat sélectionnée' }, 400);
    const placeholders = ids.map(() => '?').join(',');
    const { results: bills } = await c.env.DB.prepare(`SELECT id, number FROM bills WHERE id IN (${placeholders})`).bind(...ids).all();
    if (!bills?.length) return c.json({ success: false, error: 'Aucune facture d\'achat trouvée' }, 404);
    const resourceId = ids.slice().sort((a, b) => a - b).join(',');
    const label = `${bills.length} facture(s) d'achat : ${(bills as any[]).map((x) => x.number).join(', ')}`;
    const result = await issueDeleteOtp(c.env, 'bills_bulk', resourceId, label, `Code de suppression — ${bills.length} facture(s) d'achat`);
    return c.json({ success: true, message: result.message, emailed: result.emailed, otp: result.emailed ? undefined : result.otp, count: bills.length });
  });
  
  app.post('/api/bills/bulk-delete', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const body = await c.req.json().catch(() => ({}));
    const ids: number[] = Array.isArray(body.ids) ? body.ids.map((x: any) => Number(x)).filter((n: number) => n > 0) : [];
      if (!ids.length) return c.json({ success: false, error: 'Aucune facture d\'achat sélectionnée' }, 400);
    const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
    if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);
    const placeholders = ids.map(() => '?').join(',');
    await c.env.DB.prepare(`DELETE FROM bill_items WHERE bill_id IN (${placeholders})`).bind(...ids).run();
    await c.env.DB.prepare(`DELETE FROM bills WHERE id IN (${placeholders})`).bind(...ids).run();
    return c.json({ success: true, message: `${ids.length} facture(s) d'achat supprimée(s) de la base de données.` });
  });
  
  app.get('/api/receipts', async (c) => {
    const role = normalizeRole(sessionUserFromHeader(c.req.header('Authorization')).role);
    if (!canMutateBusiness(role)) {
      return c.json({ success: false, error: 'Accès non autorisé pour ce rôle.', code: 'FORBIDDEN_ROLE' }, 403);
    }
    const limit = Math.max(1, Math.min(2000, Number(c.req.query('limit') || 500)));
    const cacheKey = `receipts:list:l=${limit}`;
    if (hasLiveCache(c.env)) {
      const hit = await doCacheGet<any[]>(c.env.MOBILE_HUB, c.env.CACHE, cacheKey, 300);
      if (hit) return c.json({ success: true, data: hit, count: hit.length, cached: true });
    }
    await ensureReceiptSituationColumn(c.env.DB);
    await ensureReceiptsTable(c.env.DB);
    let results: any[] = [];
    try {
      const q = await c.env.DB.prepare(
        `SELECT r.*, i.number AS invoice_number, i.status AS invoice_status
         FROM receipts r
         LEFT JOIN invoices i ON i.id = r.invoice_id
         ORDER BY r.id DESC
         LIMIT ?`
      ).bind(limit).all();
      results = q.results || [];
    } catch {
      const q = await c.env.DB.prepare(`SELECT * FROM receipts ORDER BY id DESC LIMIT ?`).bind(limit).all();
      results = q.results || [];
    }
    if (hasLiveCache(c.env)) {
      await doCachePut(c.env.MOBILE_HUB, c.env.CACHE, cacheKey, results, 300);
    }
    return c.json({ success: true, data: results, count: results.length });
  });
  
  app.post('/api/receipts', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    await ensureReceiptsTable(c.env.DB);
    await ensureDocumentActors(c.env.DB, 'receipts');
    const documentCreator = sessionUserFromHeader(c.req.header('Authorization')).username || null;
    await ensureExpenseTypeColumn(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const idemKey = extractIdempotencyKey(c, body);
    if (idemKey) {
      const cached = await idempotencyGet(c.env.DB, `rec:${idemKey}`);
      if (cached) return c.json({ ...cached.body, replayed: true }, cached.status);
    }
    const verr = validateReceiptWrite(body);
    if (verr) return apiFail(c, Object.values(verr)[0] || 'Validation', 'VALIDATION', verr);
    const { invoice_id, client_name, amount, payment_method = 'cash', issue_date, notes = '' } = body;
    if (!client_name || amount == null || Number(amount) <= 0) {
      return c.json({ success: false, error: 'Le nom du client et le montant sont obligatoires' }, 400);
    }
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const payCurrency = String(settings?.currency || settings?.finance_currency || 'MAD');
    const paidAt = issue_date || new Date().toISOString().slice(0, 10);
    const method = String(payment_method || 'cash');

    let linkedInv: any = null;
    let payApp: ReturnType<typeof computePaymentApplication> = null;
    if (invoice_id) {
      await ensurePaymentHistoryTable(c.env.DB);
      linkedInv = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(invoice_id).first() as any;
      if (!linkedInv) return c.json({ success: false, error: 'Facture liée introuvable' }, 404);
      if (linkedInv.status === 'cancelled' || linkedInv.status === 'quote' || linkedInv.status === 'devis' || linkedInv.status === 'remboursement' || linkedInv.doc_kind === 'remboursement') {
        return c.json({ success: false, error: 'Impossible de lier un reçu à un devis, avoir ou document annulé.', code: 'INVALID_LINKED_INVOICE' }, 400);
      }
      if (linkedInv.status !== 'paid') {
        payApp = computePaymentApplication(Number(amount), Number(linkedInv.total || 0), Number(linkedInv.amount_paid || 0), payCurrency);
      }
    }

    let number = await nextDocumentNumber(c.env.DB, 'receipt', settings, c.env);
    if (linkedInv && payApp) {
      await c.env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS payment_assertions (marker TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok = 1))`
      ).run();
      await c.env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS expenses (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT DEFAULT 'General',
          description TEXT NOT NULL,
          amount REAL NOT NULL,
          payment_method TEXT DEFAULT 'cash',
          expense_date TEXT,
          vendor_name TEXT DEFAULT '',
          reference TEXT DEFAULT '',
          notes TEXT DEFAULT '',
          entry_type TEXT DEFAULT 'expense',
          created_at TEXT DEFAULT (datetime('now'))
        )`
      ).run();
      const ledgerMethod =
        method === 'cash' || method === 'card' ? 'cash' :
        String(method).startsWith('bank') || method === 'bank' ? 'bank' :
        String(method).startsWith('check') || method === 'check' ? 'check' : 'other';
      const marker = crypto.randomUUID();
      try {
        await c.env.DB.batch([
          c.env.DB.prepare(
            `INSERT INTO payment_assertions(marker, ok)
             SELECT ?, CASE WHEN EXISTS (
               SELECT 1 FROM invoices
               WHERE id = ?
                 AND status NOT IN ('cancelled', 'quote', 'devis', 'remboursement')
                 AND COALESCE(doc_kind, '') != 'remboursement'
                 AND COALESCE(amount_paid, 0) IS ?
                 AND COALESCE(total, 0) IS ?
             ) THEN 1 ELSE 0 END`
          ).bind(marker, invoice_id, linkedInv.amount_paid ?? 0, linkedInv.total ?? 0),
          c.env.DB.prepare(
            `INSERT INTO receipts (number, invoice_id, client_name, amount, payment_method, issue_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(number, invoice_id, client_name, Number(amount), method, paidAt, notes, documentCreator),
          c.env.DB.prepare(
            `INSERT INTO invoice_payments (invoice_id, amount, payment_method, payee, note, paid_at) VALUES (?, ?, ?, ?, ?, ?)`
          ).bind(invoice_id, payApp.applied, method, 'company', notes || `Reçu ${number}`, paidAt),
          c.env.DB.prepare(
            `UPDATE invoices SET amount_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
          ).bind(payApp.next_paid, payApp.status, invoice_id),
          c.env.DB.prepare(
            `INSERT INTO expenses (category, description, amount, payment_method, expense_date, vendor_name, reference, notes, entry_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'income')`
          ).bind(
            'Encaissement client',
            `Reçu ${number} — ${client_name}`,
            Number(amount),
            ledgerMethod,
            paidAt,
            client_name,
            number,
            `invoice_id:${invoice_id}|receipt:${number}`,
          ),
          c.env.DB.prepare(`DELETE FROM payment_assertions WHERE marker = ?`).bind(marker),
        ]);
      } catch (recErr: any) {
        console.error('receipt_linked_atomic_failed', String(recErr?.message || recErr));
        return c.json({
          success: false,
          error: 'Conflit lors de l’enregistrement du reçu : la facture liée a été modifiée simultanément.',
          code: 'PAYMENT_CONFLICT',
        }, 409);
      }
      const receipt = await c.env.DB.prepare(`SELECT * FROM receipts WHERE number = ?`).bind(number).first();
      const recPayload = { success: true, data: receipt, message: `Reçu ${number} enregistré et visible dans la liste.` };
      if (idemKey) await idempotencyPut(c.env.DB, `rec:${idemKey}`, 'POST /receipts', 201, recPayload);
      return c.json(recPayload, 201);
    }

    let result: any;
    try {
      result = await c.env.DB.prepare(
        `INSERT INTO receipts (number, invoice_id, client_name, amount, payment_method, issue_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(number, invoice_id || null, client_name, Number(amount), method, paidAt, notes, documentCreator).run();
    } catch {
      // Retry once with timestamp suffix if unique collision
      number = `${number}-${Date.now().toString(36).slice(-4)}`;
      result = await c.env.DB.prepare(
        `INSERT INTO receipts (number, invoice_id, client_name, amount, payment_method, issue_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(number, invoice_id || null, client_name, Number(amount), method, paidAt, notes, documentCreator).run();
    }

    // Ledger entry for solde (caisse/banque) — always for manual receipts
    const ledgerMethod =
      method === 'cash' || method === 'card' ? 'cash' :
      String(method).startsWith('bank') || method === 'bank' ? 'bank' :
      String(method).startsWith('check') || method === 'check' ? 'check' : 'other';
    await c.env.DB.prepare(
      `INSERT INTO expenses (category, description, amount, payment_method, expense_date, vendor_name, reference, notes, entry_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'income')`
    ).bind(
      'Encaissement client',
      `Reçu ${number}${invoice_id ? '' : ' (manuel)'} — ${client_name}`,
      Number(amount),
      ledgerMethod,
      paidAt,
      client_name,
      number,
      invoice_id ? `invoice_id:${invoice_id}|receipt:${result.meta.last_row_id}` : `receipt:${result.meta.last_row_id}`,
    ).run();

    const receipt = await c.env.DB.prepare(`SELECT * FROM receipts WHERE id = ?`).bind(result.meta.last_row_id).first();
    const recPayload = { success: true, data: receipt, message: `Reçu ${number} enregistré et visible dans la liste.` };
    if (idemKey) await idempotencyPut(c.env.DB, `rec:${idemKey}`, 'POST /receipts', 201, recPayload);
    return c.json(recPayload, 201);
  });


  app.put('/api/receipts/:id', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const id = c.req.param('id');
    await ensureReceiptsTable(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const r = await c.env.DB.prepare(`SELECT * FROM receipts WHERE id = ?`).bind(id).first();
    if (!r) return c.json({ success: false, error: 'Reçu introuvable' }, 404);
    const fields: string[] = [];
    const values: any[] = [];
    for (const k of ['client_name', 'amount', 'payment_method', 'issue_date', 'notes']) {
      if (body[k] !== undefined) {
        if (k === 'amount') {
          const safeAmt = sanitizePositiveAmount(body[k], { max: 1e12, decimals: 2 });
          if (safeAmt == null) return c.json({ success: false, error: 'Montant invalide' }, 400);
          fields.push(`${k} = ?`);
          values.push(safeAmt);
        } else {
          fields.push(`${k} = ?`);
          values.push(body[k]);
        }
      }
    }
    if (!fields.length) return c.json({ success: false, error: 'Aucun champ à modifier' }, 400);
    values.push(id);
    await c.env.DB.prepare(`UPDATE receipts SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
    const updated = await c.env.DB.prepare(`SELECT * FROM receipts WHERE id = ?`).bind(id).first();
    return c.json({ success: true, data: updated, message: 'Reçu mis à jour.' });
  });
  
  app.get('/api/receipts/:id/print', async (c) => {
    const id = c.req.param('id');
    await ensureReceiptsTable(c.env.DB);
    await ensureDocAssetColumns(c.env.DB);
    await ensureReceiptPublicToken(c.env.DB);
    let receipt = await c.env.DB.prepare(
      `SELECT r.*, i.number AS invoice_number, i.client_ice, i.client_address, i.client_city, i.client_id
       FROM receipts r
       LEFT JOIN invoices i ON i.id = r.invoice_id
       WHERE r.id = ?`
    ).bind(id).first() as any;
    if (!receipt) return c.json({ success: false, error: 'Reçu introuvable' }, 404);
    if (!receipt.public_token) {
      const tok = makePublicToken();
      await c.env.DB.prepare(`UPDATE receipts SET public_token = ? WHERE id = ?`).bind(tok, id).run();
      receipt = { ...receipt, public_token: tok };
    }
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const origin = new URL(c.req.url).origin;
    // QR 1: secure verify this receipt (HMAC)
    const secureReceipt = await makeSecureQrPayload(c.env, 'receipt', receipt.public_token, 0, c.env.DB);
    const verifyUrl = `${origin}/api/public/verify?p=${encodeURIComponent(secureReceipt)}`;
    // QR 2: client account status (paid + unpaid)
    let clientIce = receipt.client_ice || '';
    if (!clientIce && receipt.invoice_id) {
      try {
        const linkedInv = await c.env.DB.prepare(`SELECT client_ice FROM invoices WHERE id = ?`).bind(receipt.invoice_id).first() as any;
        clientIce = linkedInv?.client_ice || '';
      } catch { /* ignore */ }
    }
    // Situation QR must resolve via invoices.public_token (client-status lookup).
    // Prefer linked invoice token; mint if missing. Fallback: receipt token + client-status receipt path.
    let statusPublicToken = '';
    let statusSignType: 'invoice' | 'receipt' = 'invoice';
    await ensureInvoicePublicToken(c.env.DB);
    if (receipt.invoice_id) {
      try {
        let invTok = await c.env.DB.prepare(`SELECT public_token FROM invoices WHERE id = ?`).bind(receipt.invoice_id).first() as any;
        statusPublicToken = String(invTok?.public_token || '').trim();
        if (!statusPublicToken) {
          statusPublicToken = makePublicToken();
          await c.env.DB.prepare(`UPDATE invoices SET public_token = ? WHERE id = ?`).bind(statusPublicToken, receipt.invoice_id).run();
        }
        statusSignType = 'invoice';
      } catch { /* */ }
    }
    if (!statusPublicToken) {
      statusPublicToken = String((receipt as any).public_token || '').trim();
      statusSignType = 'receipt';
    }
    let statusUrl = '';
    await ensureQrPrivacySettings(c.env.DB);
    await ensureReceiptSituationColumn(c.env.DB);
    const qrSitGlobal = Number((settings as any)?.qr_client_situation ?? 0) === 1;
    const qrSitReceipt = Number((receipt as any)?.include_client_situation ?? 0) === 1;
    const qrSitOn = qrSitGlobal || qrSitReceipt;
    if (qrSitOn && statusPublicToken) {
      try {
        const ttlDays = Math.max(7, Math.min(365, Number((settings as any)?.qr_situation_ttl_days ?? 90) || 90));
        const ttlSec = ttlDays * 86400;
        const signedStatus = await makeSecureQrPayload(c.env, statusSignType, statusPublicToken, ttlSec, c.env.DB);
        statusUrl = `${origin}/api/public/verify?doc=client&t=${encodeURIComponent(signedStatus)}`;
      } catch {
        statusUrl = '';
      }
    }
    // Optional product lines from linked invoice (full layout)
    let lineItems: any[] = [];
    if (receipt.invoice_id) {
      try {
        const { results } = await c.env.DB.prepare(
          `SELECT product_name, sku, quantity, unit_price, tax_rate, line_total
           FROM invoice_items WHERE invoice_id = ? ORDER BY id`
        ).bind(receipt.invoice_id).all();
        lineItems = results || [];
      } catch { lineItems = []; }
    }
    const layout = String(c.req.query('layout') || c.req.query('mode') || 'full').toLowerCase();
    const html = layout === 'minimal' || layout === 'simple' || layout === 'ticket'
      ? generateReceiptHTMLMinimal(settings, receipt, statusUrl, verifyUrl)
      : generateReceiptHTML(settings, { ...receipt, _line_items: lineItems }, statusUrl, verifyUrl);
    return c.html(html);
  });
  
  app.post('/api/receipts/:id/request-delete-otp', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const id = c.req.param('id');
    const receipt = await c.env.DB.prepare(`SELECT * FROM receipts WHERE id = ?`).bind(id).first() as any;
    if (!receipt) return c.json({ success: false, error: 'Reçu introuvable' }, 404);

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await c.env.DB.prepare(
      `INSERT INTO otp_codes (code, resource_type, resource_id, expires_at) VALUES (?, 'receipt', ?, ?)
       ON CONFLICT(resource_type, resource_id) DO UPDATE SET code = ?, expires_at = ?, created_at = datetime('now')`
    ).bind(otp, id, expiresAt, otp, expiresAt).run();

    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const companyName = settings?.company_name || 'Atlas Commerce';
    const fromAddr = c.env.OTP_FROM || 'noreply@afmarbre.com';
    const toAddr = c.env.OTP_TO || 'security@afmarbre.com';

    try {
      await c.env.EMAIL.send({
        to: toAddr,
        from: fromAddr,
        subject: `Code de suppression — Reçu ${receipt.number}`,
        html: otpEmailHTML(otp, `Reçu ${receipt.number}`, companyName),
        text: `Code de confirmation pour supprimer le reçu ${receipt.number} : ${otp}. Ce code est valable 10 minutes.`,
      });
    } catch (e: any) {
      console.error('receipt request-delete-otp mail failed', String(e?.message || e));
      return c.json({ success: false, error: 'Impossible d\'envoyer le code par e-mail. Vérifiez la configuration Email Routing.' }, 500);
    }
  
    return c.json({ success: true, message: `Code envoyé à ${toAddr}. Vérifiez votre boîte de réception.` });
  });
  
  app.get('/api/receipts/:id/links', async (c) => {
    await ensureReceiptsTable(c.env.DB);
    const id = c.req.param('id');
    const receipt = await c.env.DB.prepare(`SELECT * FROM receipts WHERE id = ?`).bind(id).first() as any;
    if (!receipt) return c.json({ success: false, error: 'Reçu introuvable' }, 404);
    const expenses = await expensesLinkedToReceipt(c.env.DB, receipt);
    let invoice = null;
    if (receipt.invoice_id) {
      invoice = await c.env.DB.prepare(`SELECT id, number, status FROM invoices WHERE id = ?`).bind(receipt.invoice_id).first();
    }
    return c.json({
      success: true,
      data: {
        receipt: { id: receipt.id, number: receipt.number },
        invoice,
        expenses: expenses.map((e: any) => ({ id: e.id, description: e.description, amount: e.amount })),
        disclaimer: (invoice || expenses.length)
          ? 'La suppression de ce reçu efface les écritures de solde liées.' + (invoice ? ' Option cascade : supprimer aussi la facture liée.' : '')
          : null,
      },
    });
  });
  
  
  /** Recalculate invoice/VR amount_paid + status from remaining payment rows. */
  async function recalcInvoicePaidFromPayments(db: D1Database, invoiceId: number | string) {
    const inv = await db.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(invoiceId).first() as any;
    if (!inv) return null;
    const sumRow = await db.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS s FROM invoice_payments WHERE invoice_id = ? AND COALESCE(note, '') NOT LIKE 'Avoir %'`,
    ).bind(invoiceId).first() as any;
    let payCurrency = 'MAD';
    try {
      const st = await db.prepare(`SELECT currency, finance_currency FROM company_settings WHERE id = 1`).first() as any;
      payCurrency = String(st?.currency || st?.finance_currency || 'MAD');
    } catch { /* */ }
    const paid = roundMoneyForCurrency(Math.max(0, Number(sumRow?.s || 0)), payCurrency, 'ledger');
    const total = Number(inv.total || 0);
    let status = String(inv.status || 'sent');
    const locked = ['cancelled', 'quote', 'devis', 'remboursement'].includes(status)
      || inv.doc_kind === 'remboursement';
    if (!locked) {
      if (paid <= 0.001) status = 'sent';
      else if (paid + 0.001 >= total) status = 'paid';
      else status = 'partial';
    }
    await db.prepare(
      `UPDATE invoices SET amount_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(paid, status, invoiceId).run();
    return { paid, status, total };
  }
  
  /**
   * Void payments totaling `amount` (newest first) and reopen AR on FA/VR.
   * Also removes matching income ledger rows for the invoice.
   */
  async function reversePaymentsOnInvoice(
    db: D1Database,
    invoiceId: number | string,
    amountToReverse: number,
  ) {
    const target = Math.max(0, Number(amountToReverse || 0));
    if (target <= 0.001) {
      return recalcInvoicePaidFromPayments(db, invoiceId);
    }
    let payCurrency = 'MAD';
    try {
      const st = await db.prepare(`SELECT currency, finance_currency FROM company_settings WHERE id = 1`).first() as any;
      payCurrency = String(st?.currency || st?.finance_currency || 'MAD');
    } catch { /* */ }
    const { results: pays } = await db.prepare(
      `SELECT id, amount FROM invoice_payments WHERE invoice_id = ? AND COALESCE(note, '') NOT LIKE 'Avoir %' ORDER BY paid_at DESC, id DESC`,
    ).bind(invoiceId).all();
    let left = target;
    for (const p of (pays || []) as any[]) {
      if (left <= 0.001) break;
      const amt = Number(p.amount || 0);
      if (amt <= left + 0.001) {
        await db.prepare(`DELETE FROM invoice_payments WHERE id = ?`).bind(p.id).run();
        left = Math.max(0, subMoneyAmounts(left, amt, payCurrency));
      } else {
        // Split: reduce payment row
        const next = Math.max(0, subMoneyAmounts(amt, left, payCurrency));
        await db.prepare(`UPDATE invoice_payments SET amount = ? WHERE id = ?`).bind(next, p.id).run();
        left = 0;
      }
    }
    // Remove income ledger entries for this invoice (encaissement)
    try {
      const { results: inc } = await db.prepare(
        `SELECT id FROM expenses WHERE entry_type = 'income' AND (notes LIKE ? OR reference IN (SELECT number FROM invoices WHERE id = ?))`,
      ).bind(`%invoice_id:${invoiceId}%`, invoiceId).all();
      for (const e of (inc || []) as any[]) {
        await db.prepare(`DELETE FROM expenses WHERE id = ?`).bind(e.id).run();
      }
    } catch { /* */ }
    return recalcInvoicePaidFromPayments(db, invoiceId);
  }
  
  
  /** Void a single payment row → reopen AR on FA/VR */
  app.delete('/api/invoices/:id/payments/:paymentId', async (c) => {
    try {
      const gate = requireBizMutator(c);
      if (!gate.ok) return gate.response;
      const invId = c.req.param('id');
      const paymentId = c.req.param('paymentId');
      const body = await c.req.json().catch(() => ({}));
      const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
      if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);
  
      const pay = await c.env.DB.prepare(
        `SELECT * FROM invoice_payments WHERE id = ? AND invoice_id = ?`,
      ).bind(paymentId, invId).first() as any;
      if (!pay) return c.json({ success: false, error: 'Paiement introuvable' }, 404);
  
      const amt = Number(pay.amount || 0);
      await c.env.DB.prepare(`DELETE FROM invoice_payments WHERE id = ?`).bind(paymentId).run();
      // Remove proportional income ledger if exact match
      try {
        const { results: inc } = await c.env.DB.prepare(
          `SELECT id, amount FROM expenses WHERE entry_type = 'income' AND notes LIKE ? ORDER BY id DESC`,
        ).bind(`%invoice_id:${invId}%`).all();
        let left = amt;
        for (const e of (inc || []) as any[]) {
          if (left <= 0.001) break;
          if (Math.abs(Number(e.amount || 0) - left) < 0.02 || Number(e.amount || 0) <= left + 0.001) {
            left -= Number(e.amount || 0);
            await c.env.DB.prepare(`DELETE FROM expenses WHERE id = ?`).bind(e.id).run();
          }
        }
      } catch { /* */ }
  
      const ar = await recalcInvoicePaidFromPayments(c.env.DB, invId);
      await afterBusinessMutation(c.env.CACHE, c.env.MOBILE_HUB);
      return c.json({
        success: true,
        message: `Paiement annulé (${amt}). Dette rétablie — payé ${ar?.paid ?? 0} / ${ar?.total ?? 0}.`,
        data: ar,
      });
    } catch (e: any) {
      console.error('payment void', e);
      return c.json({ success: false, error: e?.message || 'Échec annulation paiement' }, 400);
    }
  });
  
  app.delete('/api/receipts/:id', async (c) => {
    try {
      const gate = requireBizMutator(c);
      if (!gate.ok) return gate.response;
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
    if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);
  
    await ensureReceiptsTable(c.env.DB);
    const receipt = await c.env.DB.prepare(`SELECT * FROM receipts WHERE id = ?`).bind(id).first() as any;
    if (!receipt) return c.json({ success: false, error: 'Reçu introuvable' }, 404);
  
    const expenses = await expensesLinkedToReceipt(c.env.DB, receipt);
    for (const e of expenses) {
      await c.env.DB.prepare(`DELETE FROM expenses WHERE id = ?`).bind(e.id).run();
    }
  
    let invMsg = '';
    let ar: any = null;
    if (body.cascade_invoice && receipt.invoice_id) {
      await cascadeDeleteInvoice(c.env.DB, receipt.invoice_id, { createdBy: gate.username || undefined });
      invMsg = ' Facture/ticket lié et paiements également supprimés.';
    } else if (receipt.invoice_id) {
      // Master rule: void receipt → reopen exact unpaid AR on FA or VR
      const reverseAmt = Number(receipt.amount || 0);
      ar = await reversePaymentsOnInvoice(c.env.DB, receipt.invoice_id, reverseAmt);
      invMsg = ar
        ? ` Solde document rétabli (payé ${ar.paid} / ${ar.total}, statut ${ar.status}).`
        : ' Dette client rétablie sur le document lié.';
    }
  
    await c.env.DB.prepare(`DELETE FROM receipts WHERE id = ?`).bind(id).run();
  
    await afterBusinessMutation(c.env.CACHE, c.env.MOBILE_HUB);
    return c.json({
      success: true,
      message: `Reçu ${receipt.number} supprimé` + (expenses.length ? ` et ${expenses.length} écriture(s) solde.` : '.') + invMsg,
      deleted: {
        receipt: receipt.number,
        expenses: expenses.length,
        invoice_cascaded: !!(body.cascade_invoice && receipt.invoice_id),
        ar_reopened: ar,
      },
    });
    } catch (e: any) {
      console.error('receipt delete', e);
      return c.json({ success: false, error: e?.message || 'Échec de la suppression', code: 'DELETE_FAILED' }, 400);
    }
  });
  
}
