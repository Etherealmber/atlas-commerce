import type { Hono } from 'hono';
import { schemaOnce, addColumnIfMissing } from '../lib/schema';
import { generateInvoiceHTML } from '../lib/printTemplates';
import { escapeHtml } from '../lib/security';
import { icebergCatalogInfo } from '../lib/iceberg';
import { tr } from '../lib/error-i18n';
import { purgeAgentConversationsOlderThan } from './assist';
import { qrToSvg } from '../qrSvg';
import { getCurrencySpec, roundCurrency } from '../lib/financeCore';

export interface PublicSignedRouteDeps {
  requireOwner: (c: any) => any;
  requireBizMutator?: (c: any) => any;
  writeAudit: (db: D1Database, entry: any) => Promise<void>;
  ensurePaymentHistoryTable: (db: D1Database) => Promise<void>;
  ensureReceiptsTable: (db: D1Database) => Promise<void>;
  ensureReceiptSituationColumn: (db: D1Database) => Promise<void>;
  ensureHmacKeyColumns: (db: D1Database) => Promise<void>;
  ensureQrPrivacySettings: (db: D1Database) => Promise<void>;
  ensureInvoicePublicToken: (db: D1Database) => Promise<void>;
  publicTokenSecretsAsync: (env: any, db: D1Database, opts?: any) => Promise<any>;
  publicRateLimit: (env: any, key: string, limit: number, windowSec: number) => Promise<boolean>;
  purgeEphemeralSecurityData: (db: D1Database) => Promise<any>;
  createAtlasTimestampToken: (...args: any[]) => Promise<any>;
  verifyAtlasTimestampToken: (...args: any[]) => Promise<any>;
  invoiceDocHashPayload: (...args: any[]) => any;
  sha256Hex: (input: string) => Promise<string>;
  parseSecureQrPayload: (...args: any[]) => Promise<any>;
  validateStoredSignature: (...args: any[]) => any;
  digestSignatureImage: (...args: any[]) => any;
}

export async function ensureReceiptPublicToken(db: D1Database) {
  await schemaOnce('ensureReceiptPublicToken', async () => {
  await addColumnIfMissing(db, 'receipts', 'public_token', `TEXT`);

  });
}

export async function renderPublicReceiptVerify(db: D1Database, receipt: any, origin: string): Promise<string> {
  const settings = await db.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const cur = String(settings?.currency || settings?.finance_currency || 'MAD');
  const dec = getCurrencySpec(cur).invoiceDecimals;
  const fmt = (n: number) => roundCurrency(Number(n || 0), cur, 'invoice').toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  let invNum = '';
  if (receipt.invoice_id) {
    const inv = await db.prepare(`SELECT number FROM invoices WHERE id = ?`).bind(receipt.invoice_id).first() as any;
    invNum = inv?.number || '';
  }
  const method = receipt.payment_method || '—';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Vérification reçu ${escapeHtml(String(receipt.number || ''))}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:28px 20px;color:#000;line-height:1.45}
.badge{display:inline-block;background:#1a1d26;color:#fff;padding:6px 12px;border-radius:4px;font-size:12px;font-weight:700;letter-spacing:.04em}
.card{border:1px solid #e2e8f0;border-radius:8px;padding:18px;margin-top:16px;background:#fff}
.amt{font-size:28px;font-weight:800;margin:8px 0}
.muted{color:#4a6;font-size:13px}
.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e0ebe5;font-size:14px}
</style></head><body>
  <span class="badge">✓ REÇU VÉRIFIÉ</span>
  <h1 style="font-size:1.35rem;margin:14px 0 4px">${escapeHtml(settings?.company_name || 'Société')}</h1>
  <p class="muted">Page publique d'authentification · ${escapeHtml(new Date().toLocaleString('fr-FR'))}</p>
  <div class="card">
    <div class="muted">N° reçu</div>
    <div style="font-size:18px;font-weight:700">${escapeHtml(receipt.number || '—')}</div>
    <div class="amt">${fmt(Number(receipt.amount))} ${escapeHtml(cur)}</div>
    <div class="row"><span>Client</span><strong>${escapeHtml(receipt.client_name || '—')}</strong></div>
    <div class="row"><span>Date</span><strong>${escapeHtml(receipt.issue_date || '—')}</strong></div>
    <div class="row"><span>Mode</span><strong>${escapeHtml(method)}</strong></div>
    ${invNum ? `<div class="row"><span>Facture liée</span><strong>${escapeHtml(invNum)}</strong></div>` : ''}
  </div>
  <p class="muted" style="margin-top:20px">Ce document prouve un encaissement enregistré dans Atlas Commerce. Conservez-le avec vos pièces comptables.</p>
</body></html>`;
}


export function registerPublicSignedRoutes(app: Hono<any>, deps: PublicSignedRouteDeps): void {
  const {
    requireOwner,
    requireBizMutator,
    writeAudit,
    ensurePaymentHistoryTable,
    ensureReceiptsTable,
    ensureReceiptSituationColumn,
    ensureHmacKeyColumns,
    ensureQrPrivacySettings,
    ensureInvoicePublicToken,
    publicTokenSecretsAsync,
    publicRateLimit,
    purgeEphemeralSecurityData,
    createAtlasTimestampToken,
    verifyAtlasTimestampToken,
    invoiceDocHashPayload,
    sha256Hex,
    parseSecureQrPayload,
    validateStoredSignature,
    digestSignatureImage,
  } = deps;

  
  /**
   * Retention policy — ONLY cancelled documents are purged after a delay.
   * Active invoices / devis / bills / receipts are NEVER auto-deleted or auto-cancelled.
   *
   *  - Cancelled invoices (incl. cancelled quotes): purge after 7 days
   *  - Cancelled bills: purge after 7 days
   *  - Cancelled receipts: purge after 7 days
   */
  app.post('/api/admin/retention/run', async (c) => {
    const gate = requireOwner(c);
    if (!gate.ok) return gate.response;
  
    let invoicesPurged = 0;
    let billsPurged = 0;
    let receiptsPurged = 0;
  
    const settingsRow = await c.env.DB.prepare(`SELECT retention_cancelled_days FROM company_settings WHERE id = 1`).first() as any;
    const days = Math.max(1, Math.min(365, Number(settingsRow?.retention_cancelled_days ?? 14) || 14));
    const dayExpr = `-${days} days`;
  
    // --- Cancelled invoices only (stock already restocked at cancel time) ---
    const cancelledInv = await c.env.DB.prepare(
      `SELECT id, number FROM invoices
       WHERE status = 'cancelled'
         AND date(COALESCE(updated_at, issue_date, created_at)) < date('now', ?)`
    ).bind(dayExpr).all();
    for (const inv of (cancelledInv.results || []) as any[]) {
      try {
        // Already cancelled → no stock side-effects expected; remove dependents then row
        await c.env.DB.prepare(`DELETE FROM invoice_payments WHERE invoice_id = ?`).bind(inv.id).run();
        await c.env.DB.prepare(`DELETE FROM invoice_items WHERE invoice_id = ?`).bind(inv.id).run();
        try {
          await c.env.DB.prepare(`DELETE FROM receipts WHERE invoice_id = ?`).bind(inv.id).run();
        } catch { /* optional table */ }
        await c.env.DB.prepare(`DELETE FROM invoices WHERE id = ? AND status = 'cancelled'`).bind(inv.id).run();
        invoicesPurged++;
      } catch (e) {
        console.error('retention invoice', inv.id, e);
      }
    }
  
    // --- Cancelled bills only ---
    const cancelledBills = await c.env.DB.prepare(
      `SELECT id, number FROM bills
       WHERE status = 'cancelled'
         AND date(COALESCE(updated_at, issue_date, created_at)) < date('now', ?)`
    ).bind(dayExpr).all();
    for (const b of (cancelledBills.results || []) as any[]) {
      try {
        await c.env.DB.prepare(`DELETE FROM bill_items WHERE bill_id = ?`).bind(b.id).run();
        await c.env.DB.prepare(`DELETE FROM bills WHERE id = ? AND status = 'cancelled'`).bind(b.id).run();
        billsPurged++;
      } catch (e) {
        console.error('retention bill', b.id, e);
      }
    }
  
    // --- Cancelled receipts only (7 days) ---
    try {
      const rec = await c.env.DB.prepare(
        `SELECT id FROM receipts
         WHERE status = 'cancelled'
           AND date(COALESCE(updated_at, issue_date, created_at)) < date('now', ?)`
      ).bind(dayExpr).all();
      for (const r of (rec.results || []) as any[]) {
        await c.env.DB.prepare(`DELETE FROM receipts WHERE id = ?`).bind(r.id).run();
        receiptsPurged++;
      }
    } catch {
      /* receipts.status may not exist yet */
    }
  
    const ephemeral = await purgeEphemeralSecurityData(c.env.DB);
    let agentChatsPurged = 0;
    try {
      agentChatsPurged = (await purgeAgentConversationsOlderThan(c.env, 30)).deleted;
    } catch { /* */ }
  
    await writeAudit(c.env.DB, {
      username: gate.username,
      role: 'owner',
      action: 'retention.run',
      detail: `cancelled_invoices=${invoicesPurged};cancelled_bills=${billsPurged};cancelled_receipts=${receiptsPurged};otp=${ephemeral.otp};challenges=${ephemeral.webauthn_challenges};login_attempts=${ephemeral.login_attempts};idempotency=${ephemeral.idempotency};agent_chats=${agentChatsPurged}`,
      ip: c.req.header('cf-connecting-ip') || '',
    });
  
    return c.json({
      success: true,
      data: {
        cancelled_invoices_purged: invoicesPurged,
        cancelled_bills_purged: billsPurged,
        cancelled_receipts_purged: receiptsPurged,
        agent_chats_purged: agentChatsPurged,
        ephemeral,
      },
      message: `Purge: documents annulés (${days} j) + OTP/challenges expirés + tentatives login >14 j + idempotency >7 j.`,
    });
  });
  
  app.get('/api/admin/r2/catalog', async (c) => {
    const gate = requireOwner(c);
    if (!gate.ok) return gate.response;
    return c.json({ success: true, data: icebergCatalogInfo(c.env) });
  });
  
  
  
  app.get('/api/public/products', async (c) => {
    return c.json({ success: false, error: 'Catalogue public désactivé', code: 'PUBLIC_DISABLED' }, 403);
  });
  
  app.get('/api/public/products/:id', async (c) => {
    return c.json({ success: false, error: 'Catalogue public désactivé', code: 'PUBLIC_DISABLED' }, 403);
  });

  /** Public label-scan detail (logged & unauthenticated): ONLY selling price & stock. */
  app.get('/api/public/product/:ref', async (c) => {
    const ip = c.req.header('cf-connecting-ip') || 'unknown';
    if (await publicRateLimit(c.env, `pub-prod:${ip}`, 90, 60)) {
      return c.json({ success: false, error: 'Trop de requêtes', code: 'RATE_LIMITED' }, 429);
    }
    const rawRef = decodeURIComponent(String(c.req.param('ref') || '')).trim().slice(0, 128);
    if (!rawRef) {
      return c.json({ success: false, error: 'Référence produit manquante', code: 'MISSING_REF' }, 400);
    }
    let row: any = null;
    const pPrefixed = /^P(\d+)$/i.exec(rawRef);
    const numericId = /^\d+$/.test(rawRef) ? Number(rawRef) : pPrefixed ? Number(pPrefixed[1]) : 0;
    if (numericId > 0) {
      row = await c.env.DB.prepare(
        `SELECT * FROM products WHERE id = ? AND COALESCE(is_active, 1) = 1 LIMIT 1`,
      ).bind(numericId).first();
    }
    if (!row) {
      row = await c.env.DB.prepare(
        `SELECT * FROM products
         WHERE COALESCE(is_active, 1) = 1
           AND (LOWER(COALESCE(barcode, '')) = LOWER(?) OR LOWER(COALESCE(sku, '')) = LOWER(?))
         LIMIT 1`,
      ).bind(rawRef, rawRef).first();
    }
    if (!row) {
      return c.json({ success: false, error: 'Produit introuvable', code: 'NOT_FOUND' }, 404);
    }
    const settings = await c.env.DB.prepare(
      `SELECT * FROM company_settings WHERE id = 1`,
    ).first() as any;
    const currency = String(settings?.currency || settings?.finance_currency || 'MAD');
    const trackInventory = Number(row.track_inventory ?? 1) !== 0;
    const stockQuantity = trackInventory ? Number(row.stock_quantity ?? 0) : null;
    const lowThreshold = Number(row.low_stock_threshold ?? 0);
    const stockStatus = !trackInventory
      ? 'untracked'
      : (stockQuantity ?? 0) <= 0
        ? 'out_of_stock'
        : (stockQuantity ?? 0) <= lowThreshold
          ? 'low_stock'
          : 'in_stock';
    const price = roundCurrency(Number(row.price || 0), currency, 'invoice');
    return c.json(
      {
        success: true,
        data: {
          id: Number(row.id),
          name: String(row.name || ''),
          variant_label: String(row.variant_label || ''),
          sku: String(row.sku || ''),
          barcode: String(row.barcode || ''),
          unit: String(row.unit || ''),
          price,
          currency,
          track_inventory: trackInventory,
          stock_quantity: stockQuantity,
          stock_status: stockStatus,
          company_name: String(settings?.company_name || ''),
        },
      },
      200,
      { 'Cache-Control': 'no-store' },
    );
  });
  
  app.get('/api/public/categories', async (c) => {
    return c.json({ success: false, error: 'Catalogue public désactivé', code: 'PUBLIC_DISABLED' }, 403);
  });
  
  
  
  app.post('/api/public/invoices/:token/sign', async (c) => {
    await ensureInvoicePublicToken(c.env.DB);
    const token = c.req.param('token');
    const body = await c.req.json().catch(() => ({})) as any;
    const signature = String(body.signature || '');
    if (!signature.startsWith('data:image')) {
      return c.json({ success: false, error: 'Signature invalide (image requise)' }, 400);
    }
    if (signature.length > 1_800_000) {
      return c.json({
        success: false,
        error: 'Signature trop volumineuse. Effacez et resignez plus simplement, ou utilisez un stylet plus fin.',
        code: 'SIGNATURE_TOO_LARGE',
        size: signature.length,
      }, 400);
    }
    const inv = await c.env.DB.prepare(`SELECT * FROM invoices WHERE public_token = ?`).bind(token).first() as any;
    if (!inv) return c.json({ success: false, error: 'Document introuvable' }, 404);
    if (inv.status === 'quote' || inv.status === 'devis') {
      return c.json({ success: false, error: 'Un devis ne peut pas être signé ici — convertissez-le en facture.' }, 400);
    }
    if (inv.status === 'cancelled') {
      return c.json({ success: false, error: 'Document annulé — signature refusée.' }, 400);
    }
    const digest = await digestSignatureImage(signature);
    const docHash = await sha256Hex(invoiceDocHashPayload(inv));
    const ts = await createAtlasTimestampToken(c.env, docHash, c.env.DB);
    try {
      await c.env.DB.prepare(
        `UPDATE invoices SET client_signature = ?, signed_at = datetime('now'), updated_at = datetime('now'),
         signature_digest = ?, signed_doc_hash = ?, timestamp_token = ?, timestamp_at = ? WHERE id = ?`
      ).bind(signature, digest, docHash, ts.compact, ts.issuedAt, inv.id).run();
    } catch {
      await ensureInvoicePublicToken(c.env.DB);
      await c.env.DB.prepare(
        `UPDATE invoices SET client_signature = ?, signed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
      ).bind(signature, inv.id).run();
      try {
        await c.env.DB.prepare(
          `UPDATE invoices SET signature_digest = ?, signed_doc_hash = ?, timestamp_token = ?, timestamp_at = ? WHERE id = ?`
        ).bind(digest, docHash, ts.compact, ts.issuedAt, inv.id).run();
      } catch { /* ignore */ }
    }
    return c.json({
      success: true,
      message: 'Signature enregistrée, scellée et horodatée (aligné PAdES-B-T)',
      data: {
        digest: digest.slice(0, 12),
        doc_hash: docHash.slice(0, 16),
        timestamp_at: ts.issuedAt,
        timestamp_profile: 'PAdES-B-T-aligned',
      },
    });
  });
  
  /** JSON signature validation for a public invoice token. */
  app.get('/api/public/invoices/:token/signature', async (c) => {
    await ensureInvoicePublicToken(c.env.DB);
    const token = c.req.param('token');
    const inv = await c.env.DB.prepare(`SELECT * FROM invoices WHERE public_token = ?`).bind(token).first() as any;
    if (!inv) return c.json({ success: false, error: 'Document introuvable' }, 404);
    const check = await validateStoredSignature(inv);
    let timestamp: any = null;
    if (inv.timestamp_token) {
      const tv = await verifyAtlasTimestampToken(c.env, String(inv.timestamp_token), inv.signed_doc_hash || undefined, c.env.DB);
      timestamp = {
        present: true,
        valid: tv.ok,
        reason: tv.reason || null,
        at: inv.timestamp_at || tv.token?.t || null,
        profile: tv.token?.profile || 'PAdES-B-T-aligned',
        hash_prefix: (tv.token?.h || inv.signed_doc_hash || '').slice(0, 16),
      };
    } else {
      timestamp = { present: false, valid: false, reason: 'no_timestamp' };
    }
    return c.json({
      success: true,
      data: {
        number: inv.number,
        status: inv.status,
        total: inv.total,
        amount_paid: inv.amount_paid,
        signature: check,
        timestamp,
        valid: check.present && check.imageOk && check.digestOk && check.docUnchanged && (!timestamp.present || timestamp.valid),
        standards_note: 'Sceau Atlas + horodatage HMAC (intention PAdES-B-T). Un horodatage RFC 3161 TSA externe peut être branché ultérieurement.',
      },
    });
  });
  
  app.get('/api/public/invoices/:token/timestamp', async (c) => {
    await ensureInvoicePublicToken(c.env.DB);
    const token = c.req.param('token');
    const inv = await c.env.DB.prepare(`SELECT * FROM invoices WHERE public_token = ?`).bind(token).first() as any;
    if (!inv) return c.json({ success: false, error: 'Document introuvable' }, 404);
    if (!inv.timestamp_token) {
      return c.json({ success: true, data: { present: false, valid: false, message: 'Aucun horodatage cryptographique.' } });
    }
    const tv = await verifyAtlasTimestampToken(c.env, String(inv.timestamp_token), inv.signed_doc_hash || undefined, c.env.DB);
    return c.json({
      success: true,
      data: {
        present: true,
        valid: tv.ok,
        reason: tv.reason || null,
        at: inv.timestamp_at || tv.token?.t,
        profile: tv.token?.profile || 'PAdES-B-T-aligned',
        hash_prefix: (tv.token?.h || '').slice(0, 24),
        standards: {
          pades: 'Intention PAdES-B-T (ETSI EN 319 142) — horodatage lié au hash document',
          rfc3161: 'Token Atlas (HMAC). Branchement TSA RFC 3161 possible sans changer l’API publique.',
          adobe: 'Adobe Acrobat affiche les signatures CMS/PAdES natives ; ce sceau est vérifiable via l’API Atlas.',
        },
      },
    });
  });
  
  app.get('/api/public/invoices/:token', async (c) => {
    await ensureInvoicePublicToken(c.env.DB);
    const token = c.req.param('token');
    const origin = new URL(c.req.url).origin;
    let inv = await c.env.DB.prepare(`SELECT * FROM invoices WHERE public_token = ?`).bind(token).first() as any;
    if (!inv) {
      // fallback: numeric id only if token looks like id (legacy) — disabled for security
      return c.html(`<!DOCTYPE html><html lang="fr"><body style="font-family:system-ui;padding:40px;text-align:center"><h1>Document introuvable</h1><p>Lien invalide ou expiré.</p></body></html>`, 404);
    }
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const { results: items } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).bind(inv.id).all();
    await ensurePaymentHistoryTable(c.env.DB);
    const { results: payHist } = await c.env.DB.prepare(`SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY paid_at ASC, id ASC`).bind(inv.id).all();
    const paid = Number(inv.amount_paid || 0);
    const total = Number(inv.total || 0);
    const due = Math.max(0, total - paid);
    const isPaid = inv.status === 'paid' || due <= 0.001;
    const isQuote = inv.status === 'quote' || inv.status === 'devis';
    const isRefund = inv.status === 'remboursement' || inv.doc_kind === 'remboursement';
    const isQuickSale = inv.doc_kind === 'quick_sale' || inv.doc_kind === 'ticket' || String(inv.number || '').startsWith('VR');
    const title = isQuote ? 'DEVIS' : isRefund ? 'REMBOURSEMENT (WR)' : isQuickSale ? 'VENTE RAPIDE' : 'FACTURE';
    if (isRefund && inv.refund_of_invoice_id) {
      try {
        const src = await c.env.DB.prepare(`SELECT number FROM invoices WHERE id = ?`).bind(inv.refund_of_invoice_id).first() as any;
        if (src?.number) inv._source_number = src.number;
      } catch { /* */ }
    }
    // Reuse print HTML with live totals; pass as invoice
    const html = generateInvoiceHTML(settings, inv, items as any[], title, false);
    // Inject live banner
    const curStr = String(settings?.currency || settings?.finance_currency || 'MAD');
    const curDec = getCurrencySpec(curStr).invoiceDecimals;
    const fmtPublicMoney = (v: number) => roundCurrency(Number(v || 0), curStr, 'invoice').toLocaleString('fr-FR', { minimumFractionDigits: curDec, maximumFractionDigits: curDec });
    const histRows = ((payHist || []) as any[]).map((p) =>
      `<tr><td>${escapeHtml(String(p.paid_at || '').slice(0, 10))}</td><td>${fmtPublicMoney(Number(p.amount))} ${escapeHtml(curStr)}</td><td>${escapeHtml(String(p.payment_method || ''))}</td><td>${p.payee === 'owner' ? 'Propriétaire' : 'Société'}</td></tr>`
    ).join('') || '<tr><td colspan="4">Aucun paiement enregistré</td></tr>';
    const histTable = !isQuote ? `<h2 style="font-size:12px;margin:16px 0 6px">Historique des paiements</h2>
      <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:12px">
        <thead><tr><th style="border:1px solid #000;padding:4px">Date</th><th style="border:1px solid #000;padding:4px">Montant</th><th style="border:1px solid #000;padding:4px">Mode</th><th style="border:1px solid #000;padding:4px">Bénéficiaire</th></tr></thead>
        <tbody>${histRows}</tbody>
      </table>` : '';
    const refundReasonSafe = escapeHtml(String(inv.refund_reason || inv.notes || '').slice(0, 280));
    const banner = isQuote
      ? `<div style="border:2px solid #000;padding:12px;margin-bottom:16px;text-align:center;font-weight:700">DEVIS — Estimation non facturée</div>`
      : isRefund
        ? `<div style="border:2px solid #000;padding:12px;margin-bottom:16px;text-align:center;font-weight:700">REMBOURSEMENT / AVOIR (WR) — Stock rétabli<br/><span style="font-weight:500;font-size:11px">Un remboursement sans motif valable n’est pas accepté. Motif : ${refundReasonSafe}</span></div>`
      : isPaid
        ? `<div style="border:2px solid #000;padding:12px;margin-bottom:16px;text-align:center;font-weight:700">FACTURE SOLDÉE — Payée intégralement</div>${histTable}`
        : `<div style="border:2px solid #000;padding:12px;margin-bottom:16px;text-align:center"><strong>Crédit restant : ${fmtPublicMoney(due)} ${escapeHtml(curStr)}</strong><br/>Déjà payé : ${fmtPublicMoney(paid)} · Total : ${fmtPublicMoney(total)}</div>${histTable}`;
    const safeSigUrl = typeof inv.client_signature === 'string' && /^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(inv.client_signature)
      ? inv.client_signature
      : '';
    const signPad = safeSigUrl
      ? `<div style="margin:24px 0;page-break-inside:avoid"><p style="font-size:12px;font-weight:700">Signature client (numérique)</p><img src="${safeSigUrl}" alt="Signature" style="max-height:90px;border:1px solid #000;background:#fff"/></div>`
      : (isQuote ? '' : (
          `<div class="no-print" style="margin:20px 0">
          <button type="button" id="open-sig" style="width:100%;max-width:420px;padding:14px 18px;font-size:16px;font-weight:700;background:#1a1814;color:#fff;border:0;border-radius:10px;cursor:pointer">
            Signer numériquement
          </button>
          <p id="sig-msg" style="font-size:12px;margin-top:8px;color:#666"></p>
        </div>
        <div id="sig-modal" style="display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.55);align-items:stretch;justify-content:center">
          <div style="background:#fff;width:100%;max-width:100%;height:100%;display:flex;flex-direction:column;padding:12px;box-sizing:border-box">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <strong style="font-size:16px">Signature</strong>
              <button type="button" id="sig-close" style="padding:10px 14px;font-size:15px">Fermer</button>
            </div>
            <p style="font-size:13px;color:#555;margin-bottom:8px">Signez librement avec le doigt ou le stylet (téléphone / tablette / ordinateur).</p>
            <canvas id="sig" style="flex:1;width:100%;min-height:220px;border:2px solid #1a1814;border-radius:8px;touch-action:none;background:#fff"></canvas>
            <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">
              <button type="button" id="sig-clear" style="flex:1;padding:14px;font-size:16px">Effacer</button>
              <button type="button" id="sig-save" style="flex:2;padding:14px;font-size:16px;font-weight:700;background:#1a1814;color:#fff;border:0;border-radius:8px">Enregistrer</button>
            </div>
          </div>
        </div>
        <script>
        (function(){
          var modal=document.getElementById('sig-modal');
          var c=document.getElementById('sig');
          var ctx=c.getContext('2d');
          var drawing=false, last=null;
          function resize(){
            var ratio=Math.max(window.devicePixelRatio||1,1);
            var w=c.clientWidth||window.innerWidth-24;
            var h=c.clientHeight||Math.max(240, window.innerHeight*0.55);
            c.width=w*ratio; c.height=h*ratio;
            ctx.setTransform(ratio,0,0,ratio,0,0);
            ctx.strokeStyle='#111'; ctx.lineWidth=2.2; ctx.lineCap='round'; ctx.lineJoin='round';
          }
          function pos(e){
            var r=c.getBoundingClientRect();
            var x=(e.touches?e.touches[0].clientX:e.clientX)-r.left;
            var y=(e.touches?e.touches[0].clientY:e.clientY)-r.top;
            return {x:x,y:y};
          }
          function start(e){ e.preventDefault(); drawing=true; last=pos(e); }
          function move(e){ e.preventDefault(); if(!drawing) return; var p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; }
          function end(){ drawing=false; }
          document.getElementById('open-sig').onclick=function(){
            modal.style.display='flex';
            setTimeout(resize, 50);
          };
          document.getElementById('sig-close').onclick=function(){ modal.style.display='none'; };
          c.addEventListener('mousedown',start); c.addEventListener('mousemove',move); window.addEventListener('mouseup',end);
          c.addEventListener('touchstart',start,{passive:false}); c.addEventListener('touchmove',move,{passive:false}); c.addEventListener('touchend',end);
          document.getElementById('sig-clear').onclick=function(){ ctx.clearRect(0,0,c.width,c.height); resize(); };
          document.getElementById('sig-save').onclick=function(){
            // Downscale + JPEG to avoid "signature trop volumineuse"
            var maxW=600, scale=Math.min(1, maxW/Math.max(c.width,1));
            var off=document.createElement('canvas');
            off.width=Math.max(1, Math.floor(c.width*scale));
            off.height=Math.max(1, Math.floor(c.height*scale));
            var octx=off.getContext('2d');
            octx.fillStyle='#fff'; octx.fillRect(0,0,off.width,off.height);
            octx.drawImage(c,0,0,off.width,off.height);
            var data=off.toDataURL('image/jpeg',0.55);
            document.getElementById('sig-msg').textContent='Envoi…';
            fetch(location.pathname+'/sign',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({signature:data})})
              .then(function(r){return r.json()}).then(function(j){
                document.getElementById('sig-msg').textContent=j.message||j.error||'';
                if(j.success){ modal.style.display='none'; setTimeout(function(){ location.reload(); }, 600); }
              }).catch(function(){ document.getElementById('sig-msg').textContent='Erreur réseau'; });
          };
          window.addEventListener('resize', function(){ if(modal.style.display==='flex') resize(); });
        })();
        </scr` + `ipt>`
        ));
    // Quotes: never show QR/signing (signPad only for invoices & paid docs)
    const extra = isQuote ? '' : signPad;
    const sigCheck = await validateStoredSignature(inv);
    let sigBar = '';
    if (!isQuote && sigCheck.present) {
      const ok = sigCheck.imageOk && sigCheck.digestOk && sigCheck.docUnchanged;
      let tsLine = '';
      if (inv.timestamp_token) {
        const tv = await verifyAtlasTimestampToken(c.env, String(inv.timestamp_token), inv.signed_doc_hash || undefined, c.env.DB);
        tsLine = tv.ok
          ? `<div style="margin-top:4px"> Horodatage cryptographique valide · ${escapeHtml(String(inv.timestamp_at || tv.token?.t || ''))} · profil PAdES-B-T (aligné)</div>`
          : `<div style="margin-top:4px;color:#8b2e2e"> Horodatage à vérifier (${escapeHtml(String(tv.reason || 'erreur'))})</div>`;
      }
      sigBar = `<div style="border:1px solid ${ok ? '#6366f1' : '#8b2e2e'};background:${ok ? '#f3f8f3' : '#fdf2f2'};padding:10px 14px;margin:0 0 12px;border-radius:6px;font-size:12px;line-height:1.45">
        <strong>${ok ? '✓ Signature numérique valide' : '⚠ Signature à vérifier'}</strong>
        <div style="margin-top:4px">${escapeHtml(String(sigCheck.message || ''))}</div>
        ${sigCheck.signedAt ? `<div style="color:#555;margin-top:2px">Signé le ${escapeHtml(String(sigCheck.signedAt))}</div>` : ''}
        ${tsLine}
      </div>`;
    }
    const statusLabel = isQuote ? 'Devis' : isRefund ? 'Avoir / WR' : isQuickSale ? (isPaid ? 'Vente encaissée' : 'Vente rapide') : isPaid ? 'Soldée' : inv.status === 'partial' ? 'Partielle' : 'En cours';
    const statusColor = isPaid ? '#6366f1' : isQuote ? '#5c4a1f' : due > 0.001 ? '#8b2e2e' : '#0f1b2d';
    const lineCount = (items || []).length;
    const qtySum = ((items || []) as any[]).reduce((s, it) => s + Number(it.quantity || 0), 0);
    const clientBits = [
      inv.client_name ? `<strong>${escapeHtml(String(inv.client_name))}</strong>` : '',
      inv.client_ice ? `ICE ${escapeHtml(String(inv.client_ice))}` : '',
      inv.client_phone ? `Tél. ${escapeHtml(String(inv.client_phone))}` : '',
      inv.client_email ? escapeHtml(String(inv.client_email)) : '',
      escapeHtml([inv.client_address, inv.client_city].filter(Boolean).join(', ')),
    ].filter(Boolean).join(' · ');
    const docTypeHint = isQuickSale
      ? 'Vente rapide (caisse) — ticket sans TVA, série VR, distinct d’une facture FA.'
      : isQuote
        ? 'Devis estimatif — non comptabilisé tant qu’il n’est pas converti en facture.'
        : isRefund
          ? 'Avoir / remboursement (WR) lié à une facture d’origine.'
          : 'Facture de vente formalisée — pièce comptable.';
    const verifyBar = `<div style="background:${isQuickSale ? '#1a1d26' : '#0f1b2d'};color:#fff;padding:16px 18px;margin:0 0 14px;border-radius:12px;font-size:13px;line-height:1.5">
      <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;justify-content:space-between">
        <div style="max-width:34rem">
          <strong style="font-size:15px">${isQuickSale ? 'Ticket de vente authentifié' : 'Document authentifié'}</strong>
          <div style="opacity:0.95;margin-top:6px;font-size:12px">${escapeHtml(String(settings?.company_name || 'Émetteur'))} ${settings?.ice ? '· ICE ' + escapeHtml(String(settings.ice)) : ''} ${settings?.phone ? '· ' + escapeHtml(String(settings.phone)) : ''}</div>
          <div style="opacity:0.88;margin-top:4px;font-size:12px">Réf. <strong>${escapeHtml(String(inv.number || '—'))}</strong> · ${escapeHtml(String(inv.issue_date || ''))} · vérifié le ${new Date().toLocaleString('fr-FR')}</div>
          <div style="opacity:0.9;margin-top:8px;font-size:12px;padding:8px 10px;background:rgba(255,255,255,0.1);border-radius:8px">${docTypeHint}</div>
          ${clientBits ? `<div style="margin-top:8px;font-size:12px"><span style="opacity:.8">Client :</span> ${clientBits}</div>` : ''}
          <div style="margin-top:6px;font-size:12px;opacity:.9">
            Montant${isQuickSale ? '' : ' TTC'} : <strong>${fmtPublicMoney(total)} ${escapeHtml(curStr)}</strong>
            ${!isQuote ? ` · Payé : <strong>${fmtPublicMoney(paid)} ${escapeHtml(curStr)}</strong> · Reste : <strong>${fmtPublicMoney(due)} ${escapeHtml(curStr)}</strong>` : ''}
          </div>
          <div style="margin-top:4px;font-size:11px;opacity:.8">${lineCount} ligne(s) · qté totale ${qtySum}</div>
        </div>
        <span style="background:${statusColor};color:#fff;padding:8px 14px;border-radius:999px;font-weight:800;font-size:12px;white-space:nowrap">${statusLabel}</span>
      </div>
      <div style="margin-top:14px;display:flex;flex-wrap:wrap;gap:8px" class="no-print">
        <button type="button" onclick="window.print()" style="background:#fff;color:${isQuickSale ? '#1a1d26' : '#0f1b2d'};border:0;padding:8px 14px;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer">Imprimer / PDF</button>
        <button type="button" onclick="navigator.clipboard&&navigator.clipboard.writeText(location.href)" style="background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.35);padding:8px 12px;border-radius:8px;font-weight:600;font-size:12px;cursor:pointer">Copier le lien sécurisé</button>
      </div>
      <p style="margin:12px 0 0;font-size:11px;opacity:0.8">Lien issu du QR Atlas Commerce. Vérifie l’émetteur, le numéro, le client et le montant. Ne partagez pas ce lien publiquement si le document est confidentiel.</p>
    </div>`;
    const out = html
      .replace(/<body([^>]*)>/, `<body$1>${verifyBar}${sigBar}${banner}`)
      .replace('</body>', extra + '</body>');
    return c.html(out);
  });
  
  /**
   * Unified QR verification entry — scan-friendly + HMAC token support.
   * GET /api/public/verify?doc=invoice&t=TOKEN|v1.invoice.TOKEN.exp.mac
   * GET /api/public/verify?p=v1.invoice.TOKEN.exp.mac  (compact single param)
   * GET /api/public/verify?doc=receipt&t=...
   * GET /api/public/verify?doc=client&t=v2.invoice.TOKEN.exp.kid.mac
   */
  
  /** Self-hosted QR (SVG) — no third-party image API */
  
  app.post('/api/admin/revoke-public-token', async (c) => {
    const gate = requireOwner(c);
    if (!gate.ok) return gate.response;
    let body: any = {};
    try { body = await c.req.json(); } catch { /* */ }
    const id = Number(body.invoice_id || 0);
    if (!id) return c.json({ success: false, error: 'invoice_id requis' }, 400);
    const neu = Array.from(crypto.getRandomValues(new Uint8Array(12))).map((b) => b.toString(16).padStart(2, '0')).join('');
    await c.env.DB.prepare(`UPDATE invoices SET public_token = ? WHERE id = ?`).bind(neu, id).run();
    try {
      await c.env.DB.prepare(
        `INSERT INTO audit_log (action, entity, entity_id, detail, created_at) VALUES ('revoke_public_token','invoice',?, 'rotated', datetime('now'))`
      ).bind(id).run();
    } catch { /* */ }
    return c.json({ success: true, message: 'Ancien QR situation invalidé. Réimprimez le document pour un nouveau lien.' });
  });
  
  
  /** Per-receipt: enable/disable client situation QR (global setting stays independent) */
  app.patch('/api/receipts/:id/client-situation', async (c) => {
    if (requireBizMutator) {
      const gate = requireBizMutator(c);
      if (!gate.ok) return gate.response;
    } else {
      const gate = requireOwner(c);
      if (!gate.ok) return gate.response;
    }
    const id = c.req.param('id');
    await ensureReceiptSituationColumn(c.env.DB);
    let body: any = {};
    try { body = await c.req.json(); } catch { /* */ }
    const on = body.enabled === true || body.enabled === 1 || body.enabled === '1' ? 1 : 0;
    const row = await c.env.DB.prepare(`SELECT id FROM receipts WHERE id = ?`).bind(id).first();
    if (!row) return c.json({ success: false, error: 'Reçu introuvable' }, 404);
    await c.env.DB.prepare(`UPDATE receipts SET include_client_situation = ? WHERE id = ?`).bind(on, id).run();
    return c.json({
      success: true,
      data: { include_client_situation: on },
      message: on
        ? 'QR situation client activé pour ce reçu uniquement. Réimprimez pour le voir.'
        : 'QR situation désactivé pour ce reçu.',
    });
  });
  
  
  app.get('/api/public/qr.svg', async (c) => {
    const data = String(c.req.query('d') || c.req.query('data') || '').slice(0, 1200);
    const size = Math.min(240, Math.max(80, Number(c.req.query('s') || 120) || 120));
    if (!data) return c.text('missing data', 400);
    const ip = c.req.header('cf-connecting-ip') || 'unknown';
    if (await publicRateLimit(c.env, `qr:${ip}`, 60, 60)) return c.text('rate limit', 429);
    const svg = qrToSvg(data, size, 3);
    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
      },
    });
  });
  
  
  app.get('/api/public/verify', async (c) => {
    const origin = new URL(c.req.url).origin;
    const compact = String(c.req.query('p') || '').trim();
    let doc = String(c.req.query('doc') || '').toLowerCase();
    let t = String(c.req.query('t') || c.req.query('token') || '').trim();
  
    // Compact signed payload in ?p=
    if (compact) {
      const parsed = await parseSecureQrPayload(c.env, compact, c.env.DB);
      if (!parsed.ok) {
        return c.html(verifyErrorPage('QR invalide', `Jeton de sécurité refusé (${parsed.reason}).`), 401);
      }
      doc = parsed.type;
      t = parsed.token;
    } else if (t.startsWith('v1.')) {
      const parsed = await parseSecureQrPayload(c.env, t, c.env.DB);
      if (!parsed.ok) {
        return c.html(verifyErrorPage('QR invalide', `Jeton de sécurité refusé (${parsed.reason}).`), 401);
      }
      doc = parsed.type;
      t = parsed.token;
    }
  
    if (!doc) doc = 'invoice';
  
    if (doc === 'invoice' || doc === 'facture' || doc === 'devis') {
      if (!t) {
        return c.html(verifyErrorPage('Jeton manquant', 'Ce QR ne contient pas de référence de document.'), 400);
      }
      return c.redirect(`${origin}/api/public/invoices/${encodeURIComponent(t)}`, 302);
    }
  
    if (doc === 'receipt' || doc === 'recu' || doc === 'reçu') {
      if (!t) {
        return c.html(verifyErrorPage('Jeton manquant', 'Ce QR ne contient pas de référence de reçu.'), 400);
      }
      await ensureReceiptsTable(c.env.DB);
      await ensureReceiptPublicToken(c.env.DB);
      const receipt = await c.env.DB.prepare(`SELECT * FROM receipts WHERE public_token = ?`).bind(t).first() as any;
      if (!receipt) {
        return c.html(verifyErrorPage('Reçu introuvable', 'Lien invalide ou document supprimé.'), 404);
      }
      return c.html(await renderPublicReceiptVerify(c.env.DB, receipt, origin));
    }
  
    if (doc === 'client' || doc === 'status') {
      let tokenParam = String(t || c.req.query('p') || '').trim();
      if (!tokenParam) {
        return c.html(verifyErrorPage('Jeton manquant', 'La situation client n’est accessible que via un QR Atlas signé (reçu ou facture).'), 400);
      }
      // Signed payload v2… → extract public_token
      if (tokenParam.startsWith('v2.') || tokenParam.startsWith('v1.')) {
        const parsed = await parseSecureQrPayload(c.env, tokenParam, c.env.DB);
        if (!parsed.ok) {
          return c.html(verifyErrorPage('QR invalide', 'Jeton de sécurité refusé ou expiré.'), 401);
        }
        tokenParam = parsed.token;
      }
      return c.redirect(`${origin}/api/public/client-status?t=${encodeURIComponent(tokenParam)}`, 302);
    }
  
    return c.html(verifyErrorPage('Type inconnu', 'Ce QR ne correspond pas à un type de document supporté.'), 400);
  });
  
  function verifyErrorPage(title: string, message: string): string {
    const t = escapeHtml(title);
    const m = escapeHtml(message);
    return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${t}</title>
  <style>body{font-family:system-ui,sans-serif;max-width:440px;margin:0 auto;padding:40px 20px;color:#1a1814;line-height:1.5;background:#faf8f4}
  .card{background:#fff;border:1px solid #e0d9cc;border-radius:16px;padding:24px;text-align:center}
  h1{font-size:1.2rem;margin:0 0 10px}p{margin:0 0 12px;color:#9aa3b5;font-size:14px}
  .hint{font-size:12px;color:#8a9690;margin-top:16px}</style></head>
  <body><div class="card">
    <h1>${t}</h1>
    <p>${m}</p>
    <p class="hint">Scannez uniquement un QR Atlas Commerce imprimé sur une facture ou un reçu officiel. Vérifiez que l’adresse du site correspond à votre fournisseur.</p>
  </div></body></html>`;
  }
  
  
  app.get('/api/public/company', async (c) => {
    const settings = await c.env.DB.prepare(
      `SELECT company_name, city, country, logo_url, currency FROM company_settings WHERE id = 1`
    ).first();
    return c.json({ success: true, data: settings });
  });
  
  
  
  app.get('/api/public/client-status', async (c) => {
    const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
    if (await publicRateLimit(c.env, `status:${ip}`, 20, 60)) {
      return c.html(verifyErrorPage('Trop de requêtes', 'Réessayez dans une minute.'), 429);
    }
    const t = String(c.req.query('t') || c.req.query('token') || '').trim();
    const compact = String(c.req.query('p') || '').trim();
    let token = t;
    if (compact || (t && (t.startsWith('v2.') || t.startsWith('v1.')))) {
      const parsed = await parseSecureQrPayload(c.env, compact || t, c.env.DB);
      if (!parsed.ok) {
        return c.html(verifyErrorPage('QR invalide ou expiré', 'Ce lien de situation n’est plus valide. Demandez un nouveau reçu.'), 401);
      }
      token = parsed.token;
    }
    if (!token) {
      return c.html(verifyErrorPage('Accès refusé', 'Ouvrez ce lien uniquement depuis un QR Atlas signé.'), 401);
    }
    await ensureInvoicePublicToken(c.env.DB);
    await ensureQrPrivacySettings(c.env.DB);
    await ensureReceiptsTable(c.env.DB);
    let seed = await c.env.DB.prepare(
      `SELECT id, client_id, client_name, public_token FROM invoices WHERE public_token = ?`
    ).bind(token).first() as any;
    if (!seed) {
      // Receipt-scoped situation QR (no invoice or invoice token missing at print time)
      const rec = await c.env.DB.prepare(
        `SELECT r.id, r.client_name, r.invoice_id, i.client_id AS inv_client_id, i.client_name AS inv_client_name
         FROM receipts r
         LEFT JOIN invoices i ON i.id = r.invoice_id
         WHERE r.public_token = ?`
      ).bind(token).first() as any;
      if (rec) {
        seed = {
          id: rec.invoice_id || rec.id,
          client_id: rec.inv_client_id || null,
          client_name: rec.inv_client_name || rec.client_name || '',
          public_token: token,
        };
      }
    }
    if (!seed) {
      return c.html(verifyErrorPage('Lien invalide', 'Document introuvable ou jeton révoqué. Réimprimez le reçu après mise à jour.'), 404);
    }
  
    // Audit (no long-term IP storage — hash prefix only)
    try {
      const ipHash = (ip || '').slice(0, 8);
      await c.env.DB.prepare(
        `INSERT INTO audit_log (action, entity, entity_id, detail, created_at) VALUES (?, ?, ?, ?, datetime('now'))`
      ).bind('public_situation_open', 'invoice', seed.id, `token_ok ip8=${ipHash}`).run();
    } catch { /* audit table may vary */ }
  
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const cur = String(settings?.currency || settings?.finance_currency || 'MAD');
    const curDec = getCurrencySpec(cur).invoiceDecimals;
    const fmt = (n: number) => roundCurrency(Number(n || 0), cur, 'invoice').toLocaleString('fr-FR', { minimumFractionDigits: curDec, maximumFractionDigits: curDec });
    const company = String(settings?.company_name || 'Atlas Commerce');
    const origin = new URL(c.req.url).origin;
  
    // Aggregates only — no product lines, no phone/ICE/address
    let invoices: any[] = [];
    if (seed.client_id) {
      const { results } = await c.env.DB.prepare(
        `SELECT number, issue_date, status, total, amount_paid, doc_kind
         FROM invoices WHERE client_id = ? AND status NOT IN ('quote','devis','cancelled')
         ORDER BY issue_date DESC LIMIT 50`
      ).bind(seed.client_id).all();
      invoices = results || [];
    } else {
      const { results } = await c.env.DB.prepare(
        `SELECT number, issue_date, status, total, amount_paid, doc_kind
         FROM invoices WHERE lower(client_name) = lower(?) AND status NOT IN ('quote','devis','cancelled')
         ORDER BY issue_date DESC LIMIT 50`
      ).bind(seed.client_name || '').all();
      invoices = results || [];
    }
  
    let totalDue = 0, totalPaid = 0, totalTTC = 0, totalCredits = 0;
    const rows = invoices.map((inv: any) => {
      const paid = Number(inv.amount_paid || 0);
      const total = Number(inv.total || 0);
      const isWr = inv.doc_kind === 'remboursement' || String(inv.number || '').startsWith('WR');
      if (isWr) {
        totalCredits = roundCurrency(totalCredits + total, cur, 'invoice');
        return `<tr><td>${escapeHtml(String(inv.number || ''))}</td><td>${escapeHtml(String(inv.issue_date || ''))}</td><td style="text-align:right">−${fmt(total)}</td><td style="text-align:right">—</td><td style="text-align:right;color:#6366f1">0</td><td>Avoir</td></tr>`;
      }
      const due = Math.max(0, roundCurrency(total - paid, cur, 'invoice'));
      totalPaid = roundCurrency(totalPaid + paid, cur, 'invoice');
      totalTTC = roundCurrency(totalTTC + total, cur, 'invoice');
      totalDue = roundCurrency(totalDue + due, cur, 'invoice');
      const st = due <= 0.001 ? 'Soldée' : paid > 0 ? 'Partielle' : 'En cours';
      return `<tr>
        <td>${escapeHtml(String(inv.number || ''))}</td>
        <td>${escapeHtml(String(inv.issue_date || ''))}</td>
        <td style="text-align:right">${fmt(total)}</td>
        <td style="text-align:right">${fmt(paid)}</td>
        <td style="text-align:right;font-weight:700;color:${due > 0.001 ? '#8b2e2e' : '#6366f1'}">${fmt(due)}</td>
        <td>${st}</td>
      </tr>`;
    }).join('');
  
    const displayName = (seed.client_name || 'Client').split(' ')[0] + (String(seed.client_name || '').includes(' ') ? ' …' : '');
    const companySafe = escapeHtml(company);
    const curSafe = escapeHtml(cur);
    const displayNameSafe = escapeHtml(displayName);
  
    return c.html(`<!DOCTYPE html>
  <html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Situation — ${companySafe}</title>
  <style>
  body{font-family:system-ui,sans-serif;max-width:640px;margin:12px auto;padding:0 12px;color:#1a1814;position:relative}
  .wm{position:fixed;inset:0;pointer-events:none;display:flex;align-items:center;justify-content:center;z-index:0;opacity:0.06;font-size:48px;font-weight:800;transform:rotate(-24deg);color:#000;text-transform:uppercase}
  main{position:relative;z-index:1}
  .stat{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin:16px 0}
  .stat div{border:1px solid #ddd;border-radius:10px;padding:12px}
  .stat .l{font-size:11px;color:#666;text-transform:uppercase}
  .stat .v{font-size:20px;font-weight:700;margin-top:4px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th,td{padding:8px 6px;border-bottom:1px solid #eee;text-align:left}
  th{font-size:11px;color:#666}
  .foot{margin-top:24px;font-size:12px;color:#666;line-height:1.45}
  a{color:#000}
  </style></head>
  <body>
  <div class="wm" aria-hidden="true">Confidentiel</div>
  <main>
    <p style="font-size:12px;color:#666">${companySafe}</p>
    <h1 style="font-size:22px;margin:4px 0 0">Situation client — synthèse (montants)</h1>
    <p style="font-size:14px;color:#444">Client : <strong>${displayNameSafe}</strong> — montants uniquement, sans détail produits ni coordonnées.</p>
    <div class="stat">
      <div><div class="l">Facturé</div><div class="v">${fmt(totalTTC)} ${curSafe}</div></div>
      <div><div class="l">Payé</div><div class="v" style="color:#6366f1">${fmt(totalPaid)} ${curSafe}</div></div>
      <div><div class="l">Reste dû</div><div class="v" style="color:${totalDue > 0.001 ? '#8b2e2e' : '#6366f1'}">${fmt(totalDue)} ${curSafe}</div></div>
    </div>
    ${totalCredits > 0.001 ? `<p style="font-size:13px">Avoirs (WR) : ${fmt(totalCredits)} ${curSafe}</p>` : ''}
    <table>
      <thead><tr><th>N°</th><th>Date</th><th style="text-align:right">TTC</th><th style="text-align:right">Payé</th><th style="text-align:right">Reste</th><th>Statut</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6">Aucune pièce</td></tr>'}</tbody>
    </table>
    <div class="foot">
      <p>Document confidentiel — lien signé et à durée limitée. Ne pas diffuser publiquement.</p>
      <p><a href="${origin}/privacy">Politique de confidentialité</a> · Données traitées dans le cadre de la relation commerciale (loi 09-08 / CNDP).</p>
    </div>
  </main>
  </body></html>`);
  });
  
  
  
  app.post('/api/admin/rotate-hmac-keys', async (c) => {
    const gate = requireOwner(c);
    if (!gate.ok) return gate.response;
    const body = await c.req.json().catch(() => ({})) as any;
    if (body.hmac_rotate_days != null) {
      await ensureHmacKeyColumns(c.env.DB);
      const days = Math.max(7, Math.min(365, Number(body.hmac_rotate_days) || 90));
      await c.env.DB.prepare(`UPDATE company_settings SET hmac_rotate_days = ? WHERE id = 1`).bind(days).run();
    }
    const result = await publicTokenSecretsAsync(c.env, c.env.DB, { forceRotate: true });
    return c.json({
      success: true,
      message: result.rotated
        ? 'Clés HMAC renouvelées. Nouveaux QR = clé actuelle ; anciens QR = clé précédente.'
        : 'Rotation non effectuée.',
      data: { rotated: result.rotated, rotated_at: result.rotatedAt, previous_retained: !!result.previous },
    });
  });
  
  app.get('/api/admin/hmac-status', async (c) => {
    const gate = requireOwner(c);
    if (!gate.ok) return gate.response;
    await ensureHmacKeyColumns(c.env.DB);
    const row = await c.env.DB.prepare(
      `SELECT hmac_rotated_at, hmac_rotate_days, hmac_secret_current, hmac_secret_previous FROM company_settings WHERE id = 1`,
    ).first() as any;
    const days = Number(row?.hmac_rotate_days || 90);
    const rotatedAt = row?.hmac_rotated_at ? new Date(row.hmac_rotated_at).getTime() : 0;
    const nextDue = rotatedAt ? new Date(rotatedAt + days * 86400000).toISOString() : null;
    return c.json({
      success: true,
      data: {
        configured: !!(row?.hmac_secret_current),
        has_previous: !!(row?.hmac_secret_previous),
        rotated_at: row?.hmac_rotated_at || null,
        rotate_days: days,
        next_rotation_due: nextDue,
        auto_rotate: true,
      },
    });
  });
  
}
