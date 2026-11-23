import type { Hono } from 'hono';
import { addColumnIfMissing } from '../lib/schema';
import { generateInvoiceHTML, notifyClientDocument } from '../lib/printTemplates';
import { invalidateDashboardCache } from '../lib/cache';
import { nextDocumentNumber } from '../lib/numbering';
import { apiFail } from '../lib/api-response';
import { toClientError } from '../lib/errors';
import { ensureClientTaxExempt, ensureClientCreditLimit, checkClientCreditLimit } from '../lib/clients-schema';
import { validateInvoiceWrite } from '../lib/validate';
import { afterBusinessMutation } from '../lib/delete-coord';
import { ensureStockLocations, getDefaultLocationId } from './inventoryOps';
import { notifyPaymentRecorded } from '../lib/finance';
import {
  computeInvoiceLinesAndTotals,
  computePaymentApplication,
  computeRefundSplit,
  getCurrencySpec,
  roundCurrency,
  roundDh,
  sanitizeNonNegativeAmount,
  sumMoneyAmounts,
} from '../lib/financeCore';

export interface InvoicesWriteRouteDeps {
  requireBizMutator: (c: any) => any;
  sessionUserFromHeader: (header: string | undefined) => any;
  checkConfirmPassword: (env: any, db: D1Database, authHeader: string | undefined, body: any) => Promise<any>;
  writeAudit: (db: D1Database, entry: any) => Promise<void>;
  ensureDocumentActors: (db: D1Database, table: 'invoices' | 'bills' | 'receipts') => Promise<void>;
  ensureInvoiceItemPromoColumns: (db: D1Database) => Promise<void>;
  ensureInvoiceTaxExempt: (db: D1Database) => Promise<void>;
  ensureProductBulkDiscounts: (db: D1Database) => Promise<void>;
  ensureInvoiceRefundColumns: (db: D1Database) => Promise<void>;
  ensureInvoicePublicToken: (db: D1Database) => Promise<void>;
  ensureVoidColumns: (db: D1Database) => Promise<void>;
  ensurePaymentHistoryTable: (db: D1Database) => Promise<void>;
  ensureExpenseTypeColumn: (db: D1Database) => Promise<void>;
  ensureReceiptsTable: (db: D1Database) => Promise<void>;
  ensureStockMovementsTable: (db: D1Database) => Promise<void>;
  ensureHrSettings: (db: D1Database) => Promise<void>;
  extractIdempotencyKey: (c: any, body: any) => string | null;
  idempotencyGet: (db: D1Database, key: string) => Promise<any>;
  idempotencyPut: (db: D1Database, key: string, route: string, status: number, body: any) => Promise<void>;
  applyBulkDiscount: (listPrice: number, qty: number, bulkRaw: any) => { unit_price: number; bulk_percent: number };
  applyStockDelta: (...args: any[]) => Promise<any>;
  runAutoTransfers: (...args: any[]) => Promise<any>;
  archiveInvoiceSnapshot: (env: any, inv: any, items: any[]) => Promise<void>;
  assertPeriodOpen: (db: D1Database, dateStr?: string | null) => Promise<{ ok: boolean; error?: string }>;
  roundDh: (n: any) => number;
  moroccoTodayStr: () => string;
  makePublicToken: () => string;
  makeSecureQrPayload: (...args: any[]) => Promise<string>;
  validateRefundReason: (...args: any[]) => any;
  validateCreditPrefix: (...args: any[]) => any;
  generateOTP: () => string;
  otpEmailHTML: (...args: any[]) => string;
  getInvoiceLinks: (db: D1Database, id: string | number) => Promise<any>;
  cascadeDeleteInvoice: (db: D1Database, id: string | number, opts?: { createdBy?: string }) => Promise<any>;
}

export function registerInvoicesWriteRoutes(app: Hono<any>, deps: InvoicesWriteRouteDeps): void {
  const {
    requireBizMutator,
    sessionUserFromHeader,
    checkConfirmPassword,
    writeAudit,
    ensureDocumentActors,
    ensureInvoiceItemPromoColumns,
    ensureInvoiceTaxExempt,
    ensureProductBulkDiscounts,
    ensureInvoiceRefundColumns,
    ensureInvoicePublicToken,
    ensureVoidColumns,
    ensurePaymentHistoryTable,
    ensureExpenseTypeColumn,
    ensureReceiptsTable,
    ensureStockMovementsTable,
    ensureHrSettings,
    extractIdempotencyKey,
    idempotencyGet,
    idempotencyPut,
    applyBulkDiscount,
    applyStockDelta,
    runAutoTransfers,
    archiveInvoiceSnapshot,
    assertPeriodOpen,
    roundDh,
    moroccoTodayStr,
    makePublicToken,
    makeSecureQrPayload,
    validateRefundReason,
    validateCreditPrefix,
    generateOTP,
    otpEmailHTML,
    getInvoiceLinks,
    cascadeDeleteInvoice,
  } = deps;

  /* ─── Invoices ─── */

  /* GET /api/invoices + /:id → worker/routes/invoices.ts */

  app.post('/api/invoices', async (c) => {
    try {
    // Magasinier / user: no invoice / quick-sale creation (queue via mobile-actions only)
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;

    await ensureDocumentActors(c.env.DB, 'invoices');
    const documentCreator = sessionUserFromHeader(c.req.header('Authorization')).username || null;
    await ensureInvoiceItemPromoColumns(c.env.DB);
    await ensureInvoiceTaxExempt(c.env.DB);
    await ensureClientTaxExempt(c.env.DB);
    await ensureProductBulkDiscounts(c.env.DB);
    await addColumnIfMissing(c.env.DB, 'products', 'invoice_price_mode', `TEXT DEFAULT NULL`);

    const body = await c.req.json().catch(() => ({}));
    const idemKey = extractIdempotencyKey(c, body);
    if (idemKey) {
      const cached = await idempotencyGet(c.env.DB, `inv:${idemKey}`);
      if (cached) return c.json(cached.body, cached.status as any);
    }
    // Period lock (Phase 1)
    const lockCheck = await assertPeriodOpen(c.env.DB, body.issue_date);
    if (!lockCheck.ok) return c.json({ success: false, error: lockCheck.error, code: 'PERIOD_LOCKED' }, 403);

    const {
      client_id, client_name, client_ice = '', client_address = '', client_city = '', client_email = '', client_phone = '',
      issue_date, due_date = null, notes = '', items = [], status = 'sent',
    } = body;
    const verrInv = validateInvoiceWrite(body);
    if (verrInv) return apiFail(c, verrInv.client_name || verrInv.items || Object.values(verrInv)[0] || 'Validation', 'VALIDATION', verrInv);
    if (!client_name || !items.length) return apiFail(c, 'Le nom du client et au moins une ligne sont obligatoires', 'VALIDATION');
    const isQuote = status === 'quote' || status === 'devis';
    const finalStatus = isQuote ? 'quote' : status;
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const currency = String(settings?.currency || settings?.finance_currency || 'MAD');
    const isQuickSale = !isQuote && (body.quick_sale === true || body.doc_kind === 'quick_sale' || body.doc_kind === 'ticket');
    const number = await nextDocumentNumber(
      c.env.DB,
      isQuote ? 'quote' : (isQuickSale ? 'quick_sale' : 'invoice'),
      settings,
      c.env,
    );
    const docKind = isQuote ? 'quote' : (isQuickSale ? 'quick_sale' : 'invoice');

    // Tax exempt: body flag OR client.tax_exempt OR vente rapide (jamais de TVA)
    let taxExempt = !!body.tax_exempt || isQuickSale;
    if (!taxExempt && client_id) {
      const cl = await c.env.DB.prepare(`SELECT tax_exempt FROM clients WHERE id = ?`).bind(client_id).first() as any;
      if (cl?.tax_exempt) taxExempt = true;
    }

    // Factures FA : TVA 20 % par défaut. Vente rapide VR : 0 % (prix tels quels, pas de T.V.A.)
    let defaultTax = isQuickSale ? 0 : Number(settings?.tax_rate ?? 20);
    if (!isQuickSale) {
      if (!Number.isFinite(defaultTax) || defaultTax < 0) defaultTax = 20;
      if (!taxExempt && defaultTax === 0) defaultTax = 20;
    }
    const preparedLines: Array<{
      item: any;
      product_name: string;
      sku: string;
      unit: string;
      quantity: number;
      unitPrice: number;
      listPrice: number;
      taxRate: unknown;
      pricesTtc: boolean;
      explicitInclusive: boolean;
    }> = [];

    // The inclusive/exclusive price interpretation belongs to invoices only.
    const pricesTtc = !isQuickSale && !isQuote && !!(body.prices_ttc || body.price_mode === 'ttc');

    for (const item of items) {
      const qty = Number(item.quantity || 0);
      if (qty <= 0) continue;
      let listP = Number(item.list_price ?? item.catalog_price ?? 0);
      let unitP = Number(item.unit_price ?? listP);
      let lineName = String(item.product_name || item.name || '').trim();
      let lineSku = String(item.sku || '').trim();
      let lineUnit = String(item.unit || '').trim();
      let linePricesTtc = pricesTtc;
      let explicitInclusive = false;
      if (item.client_price !== undefined && item.client_price !== null && item.client_price !== '') {
        unitP = Number(item.client_price);
      }

      // Catalogue price + name from product when linked
      if (item.product_id) {
        const prod = await c.env.DB.prepare(
          `SELECT name, sku, price, bulk_discounts, unit, tax_rate, invoice_price_mode FROM products WHERE id = ?`
        ).bind(item.product_id).first() as any;
        if (prod) {
          if (!isQuickSale && !isQuote && prod.invoice_price_mode === 'inclusive') { linePricesTtc = true; explicitInclusive = true; }
          if (!isQuickSale && !isQuote && prod.invoice_price_mode === 'exclusive') linePricesTtc = false;
          if (!lineName) lineName = String(prod.name || '').trim();
          if (!lineSku) lineSku = String(prod.sku || '').trim();
          if (!lineUnit) lineUnit = String(prod.unit || '').trim();
          const catalog = Number(prod.price || 0);
          if (!listP || listP < 0.001) listP = catalog || unitP;
          if (catalog > unitP && listP < catalog) listP = catalog;
          if (!unitP || unitP < 0.001) unitP = catalog || listP;
          if (listP > 0 && Math.abs(unitP - listP) < 0.001) {
            const bulk = applyBulkDiscount(listP, qty, prod.bulk_discounts);
            if (bulk.bulk_percent > 0) unitP = bulk.unit_price;
          }
          if (!isQuickSale && (item.tax_rate === undefined || item.tax_rate === null || item.tax_rate === '')) {
            if (prod.tax_rate != null && Number(prod.tax_rate) > 0) item.tax_rate = prod.tax_rate;
          }
        }
      }
      if (!lineName) lineName = 'Article';
      if (!listP) listP = unitP;

      preparedLines.push({
        item,
        product_name: lineName,
        sku: lineSku || item.sku || '',
        unit: lineUnit || item.unit || '',
        quantity: qty,
        unitPrice: unitP,
        listPrice: listP,
        taxRate: item.tax_rate,
        pricesTtc: linePricesTtc,
        explicitInclusive,
      });
    }

    if (!preparedLines.length) return c.json({ success: false, error: 'Aucune ligne valide.' }, 400);

    const computed = computeInvoiceLinesAndTotals(
      preparedLines.map((p) => ({
        quantity: p.quantity,
        unitPrice: p.unitPrice,
        listPrice: p.listPrice,
        taxRate: p.taxRate !== undefined && p.taxRate !== null && p.taxRate !== '' ? Number(p.taxRate) : undefined,
        defaultTax,
        pricesTtc: p.pricesTtc,
        isQuickSale,
        taxExempt,
        explicitInclusive: p.explicitInclusive,
      })),
      { defaultTax, isQuickSale, taxExempt, currency },
    );
    const lineItems = preparedLines.map((p, idx) => {
      const calc = computed.lines[idx];
      return {
        ...p.item,
        product_name: p.product_name,
        sku: p.sku,
        unit: p.unit,
        quantity: p.quantity,
        list_price: calc.stored_list_price,
        unit_price: calc.stored_unit_price,
        tax_rate: calc.tax_rate,
        discount_amount: calc.discount_amount,
        discount_percent: calc.discount_percent,
        line_total: calc.line_total,
      };
    });
    const subtotal = computed.totals.subtotal;
    const tax_amount = computed.totals.tax_amount;
    const total = computed.totals.total;

    // Credit limit: only for real invoices (not devis)
    if (!isQuote) {
      await ensureClientCreditLimit(c.env.DB);
      const credit = await checkClientCreditLimit(c.env.DB, {
        clientId: client_id ? Number(client_id) : null,
        clientName: client_name,
        clientIce: client_ice,
        addAmount: total,
      });
      if (!credit.ok) {
        return c.json({
          success: false,
          error: credit.message || 'Limite de crédit dépassée',
          code: 'CREDIT_LIMIT',
          data: { outstanding: credit.outstanding, limit: credit.limit, invoice_total: total },
        }, 400);
      }
    }

    // Pre-validate aggregate stock per product across all lines before inserting invoice
    if (!isQuote) {
      const qtyByProduct = new Map<number, number>();
      for (const item of lineItems) {
        if (item.product_id) {
          const pid = Number(item.product_id);
          qtyByProduct.set(pid, (qtyByProduct.get(pid) || 0) + Number(item.quantity));
        }
      }
      for (const [pid, reqQty] of qtyByProduct) {
        const prod = await c.env.DB.prepare(
          `SELECT id, name, stock_quantity, track_inventory FROM products WHERE id = ?`
        ).bind(pid).first() as any;
        if (prod && Number(prod.track_inventory) === 1) {
          const avail = Number(prod.stock_quantity || 0);
          if (avail < reqQty) {
            return c.json({
              success: false,
              error: `Stock insuffisant pour « ${prod.name || pid} » (disponible: ${avail}, demandé: ${reqQty})`,
              code: 'INSUFFICIENT_STOCK',
              product_id: pid,
              available: avail,
              requested: reqQty,
            }, 400);
          }
        }
      }
    }

    let invResult: any;
    try {
      invResult = await c.env.DB.prepare(
        `INSERT INTO invoices (number, client_id, client_name, client_ice, client_address, client_city, client_email, client_phone, issue_date, due_date, status, subtotal, tax_amount, total, notes, amount_paid, tax_exempt, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(number, client_id || null, client_name, client_ice, client_address, client_city, client_email, client_phone, issue_date || new Date().toISOString().slice(0, 10), due_date, finalStatus, subtotal, tax_amount, total, notes, 0, taxExempt ? 1 : 0, documentCreator).run();
    } catch {
      invResult = await c.env.DB.prepare(
        `INSERT INTO invoices (number, client_id, client_name, client_ice, client_address, client_city, client_email, client_phone, issue_date, due_date, status, subtotal, tax_amount, total, notes, amount_paid, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(number, client_id || null, client_name, client_ice, client_address, client_city, client_email, client_phone, issue_date || new Date().toISOString().slice(0, 10), due_date, finalStatus, subtotal, tax_amount, total, notes, 0, documentCreator).run();
    }
    const invoiceId = invResult.meta.last_row_id;
    await ensureInvoicePublicToken(c.env.DB);
    const pubTok = makePublicToken();
    try {
      await c.env.DB.prepare(`UPDATE invoices SET public_token = ? WHERE id = ?`).bind(pubTok, invoiceId).run();
    } catch { /* column missing on very old schema */ }

    const deductedItems: Array<{ productId: number; qty: number }> = [];
    const rollbackInvoiceAndStock = async () => {
      for (let i = deductedItems.length - 1; i >= 0; i--) {
        const d = deductedItems[i];
        try {
          await applyStockDelta(
            c.env.DB,
            d.productId,
            d.qty,
            `Annulation facture ${number} (rollback stock)`,
            number,
            { type: 'adjustment', env: c.env, createdBy: documentCreator || undefined },
          );
        } catch (rbErr) {
          console.error('rollback stock delta invoice', rbErr);
        }
      }
      try {
        await c.env.DB.prepare(`DELETE FROM invoice_items WHERE invoice_id = ?`).bind(invoiceId).run();
        await c.env.DB.prepare(`DELETE FROM invoices WHERE id = ?`).bind(invoiceId).run();
      } catch { /* */ }
    };

    for (const item of lineItems) {
      try {
        await c.env.DB.prepare(
          `INSERT INTO invoice_items (invoice_id, product_id, product_name, sku, quantity, unit_price, tax_rate, line_total, list_price, discount_amount, discount_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(invoiceId, item.product_id || null, item.product_name, item.sku || '', item.quantity, item.unit_price, item.tax_rate, item.line_total, item.list_price, item.discount_amount, item.discount_percent).run();
      } catch (insErr) {
        // Schema without promo columns — basic insert
        await c.env.DB.prepare(
          `INSERT INTO invoice_items (invoice_id, product_id, product_name, sku, quantity, unit_price, tax_rate, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(invoiceId, item.product_id || null, item.product_name, item.sku || '', item.quantity, item.unit_price, item.tax_rate, item.line_total).run();
      }
      // Stock is NEVER reduced for quotes — only real invoices (atomic; fail if oversell)
      if (!isQuote && item.product_id) {
        try {
          await applyStockDelta(c.env.DB, item.product_id, -Number(item.quantity), number.startsWith('VR') ? 'Vente rapide' : 'Facture', number, { type: 'sale', env: c.env, createdBy: sessionUserFromHeader(c.req.header('Authorization')).username || undefined });
          deductedItems.push({ productId: Number(item.product_id), qty: Number(item.quantity) });
        } catch (stErr: any) {
          await rollbackInvoiceAndStock();
          if (stErr?.code === 'INSUFFICIENT_STOCK') {
            return c.json({
              success: false,
              error: stErr.message || 'Stock insuffisant',
              code: 'INSUFFICIENT_STOCK',
              product_id: stErr.product_id,
              available: stErr.available,
              requested: stErr.requested,
            }, 400);
          }
          // v243.3: any other failure (D1 corruption, lock…) must NOT leave an
          // invoice whose stock was never deducted — roll back and surface it.
          console.error('stock delta invoice', stErr);
          const safe = toClientError(stErr);
          return c.json({
            success: false,
            error: `Stock non déduit — facture annulée. ${safe.error}`,
            code: safe.code,
          }, safe.status as any);
        }
      }
    }

    // Transferts auto si stock magasin bas
    try {
      const pids = (lineItems || []).map((it: any) => it.product_id).filter(Boolean);
      if (pids.length && !isQuote) {
        const auto = await runAutoTransfers(c.env.DB, pids);
        if (auto.transferred) console.log('auto-transfer', auto.details);
      }
    } catch (e) { console.error('auto-transfer after invoice', e); }

    if (isQuickSale) {
      try {
        await c.env.DB.prepare(`UPDATE invoices SET doc_kind = 'quick_sale' WHERE id = ?`).bind(invoiceId).run();
      } catch { /* */ }
    }

    const invoice = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(invoiceId).first() as any;
    const { results: invItems } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).bind(invoiceId).all();

    let notify: any = null;
    try {
      const origin = new URL(c.req.url).origin;
      notify = await notifyClientDocument(c.env, {
        origin,
        token: pubTok,
        number,
        docLabel: isQuote ? 'Devis' : 'Facture',
        clientName: client_name,
        clientEmail: client_email,
        clientPhone: client_phone,
        companyName: settings?.company_name || 'Société',
        total,
        currency: settings?.currency || 'MAD',
      });
    } catch (e) {
      console.error('notifyClientDocument', e);
    }

    const msgBase = isQuote
      ? 'Devis enregistré (non comptabilisé, stock intact).'
      : isQuickSale
        ? 'Vente rapide enregistrée et stock déduit.'
        : 'Facture enregistrée dans la base de données.';
    const notifyBits: string[] = [];
    if (notify?.emailed) notifyBits.push('e-mail envoyé au client');
    if (notify?.whatsapp_url) notifyBits.push('lien WhatsApp prêt');
    if (notify?.error && !notify?.emailed) notifyBits.push(`e-mail non envoyé (${notify.error})`);
    if (taxExempt) notifyBits.push('exonéré de TVA');
    const msg = msgBase + (notifyBits.length ? ' ' + notifyBits.join(' · ') + '.' : '');

    const payload = {
      success: true,
      data: {
        ...invoice,
        items: invItems,
        public_url: pubTok ? `${new URL(c.req.url).origin}/api/public/invoices/${pubTok}` : null,
        whatsapp_url: notify?.whatsapp_url || null,
        emailed: !!notify?.emailed,
      },
      message: msg,
    };
    try {
      await archiveInvoiceSnapshot(c.env, invoice, invItems || []);
    } catch { /* */ }
    await afterBusinessMutation(c.env.CACHE, c.env.MOBILE_HUB);
    if (idemKey) await idempotencyPut(c.env.DB, `inv:${idemKey}`, 'POST /invoices', 201, payload);
    return c.json(payload, 201);
    } catch (e: any) {
      console.error('POST /api/invoices', e);
      return c.json({
        success: false,
        error: 'Erreur lors de la création de la facture',
        code: 'INVOICE_CREATE_FAILED',
      }, 500);
    }
  });

  /**
   * Remboursement (avoir WR-) lié à une facture existante.
   * - Motif obligatoire (code + détail)
   * - Retour stock des quantités remboursées
   * - Ajustement solde / amount_paid sur la facture d’origine
   * - Écriture de solde si encaissement à rembourser
   */
  app.post('/api/invoices/remboursement', async (c) => {
    try {
      const gate = requireBizMutator(c);
      if (!gate.ok) return gate.response;

      await ensureDocumentActors(c.env.DB, 'invoices');
      const documentCreator = sessionUserFromHeader(c.req.header('Authorization')).username || null;
      await ensureInvoiceItemPromoColumns(c.env.DB);
      await ensureInvoiceTaxExempt(c.env.DB);
      await ensureInvoiceRefundColumns(c.env.DB);
      await ensureInvoicePublicToken(c.env.DB);
      await ensureExpenseTypeColumn(c.env.DB);
      await ensurePaymentHistoryTable(c.env.DB);

      const body = await c.req.json().catch(() => ({}));
      const idemKey = extractIdempotencyKey(c, body);
      if (idemKey) {
        const cached = await idempotencyGet(c.env.DB, `wr:${idemKey}`);
        if (cached) return c.json(cached.body, cached.status as any);
      }
      const lockCheck = await assertPeriodOpen(c.env.DB, body.issue_date);
      if (!lockCheck.ok) return c.json({ success: false, error: lockCheck.error, code: 'PERIOD_LOCKED' }, 403);
      const sourceId = Number(body.refund_of_invoice_id || body.invoice_id || 0);
      const reasonCode = String(body.refund_reason_code || body.reason_code || '').trim();
      const reasonDetail = String(body.refund_reason || body.reason_detail || body.notes || '').trim();
      const issue_date = String(body.issue_date || new Date().toISOString().slice(0, 10));
      const itemsIn = Array.isArray(body.items) ? body.items : [];

      if (!sourceId) {
        return c.json({ success: false, error: 'Sélectionnez une facture d’origine à rembourser.', code: 'SOURCE_REQUIRED' }, 400);
      }
      const reasonCheck = validateRefundReason(reasonCode, reasonDetail);
      if (!reasonCheck.ok) {
        return c.json({ success: false, error: reasonCheck.error, code: 'REASON_REQUIRED' }, 400);
      }

      const source = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(sourceId).first() as any;
      if (!source) return c.json({ success: false, error: 'Facture d’origine introuvable' }, 404);
      if (source.status === 'quote' || source.status === 'devis') {
        return c.json({ success: false, error: 'Impossible de rembourser un devis. Convertissez-le d’abord en facture.' }, 400);
      }
      if (source.status === 'cancelled') {
        return c.json({ success: false, error: 'Cette facture est annulée — pas de remboursement.' }, 400);
      }
      if (source.status === 'remboursement' || source.doc_kind === 'remboursement') {
        return c.json({ success: false, error: 'Impossible de rembourser un avoir / remboursement.' }, 400);
      }

      const { results: srcItems } = await c.env.DB.prepare(
        `SELECT * FROM invoice_items WHERE invoice_id = ?`
      ).bind(sourceId).all();
      const byId = new Map<number, Record<string, any>>((srcItems || []).map((it: any) => [Number(it.id), it as Record<string, any>]));

      // Already refunded qty per source line (sum of prior credit notes)
      const { results: priorCredits } = await c.env.DB.prepare(
        `SELECT id, total FROM invoices WHERE refund_of_invoice_id = ? AND status != 'cancelled' AND (status = 'remboursement' OR COALESCE(doc_kind,'') = 'remboursement' OR IFNULL(number,'') LIKE 'WR-%')`
      ).bind(sourceId).all();
      const refundedBySrcItemId = new Map<number, number>();
      const legacyRefundedByProduct = new Map<string, number>();
      let priorRefundedTotal = 0;
      for (const cr of (priorCredits || []) as any[]) {
        priorRefundedTotal += Number(cr.total || 0);
        const { results: crItems } = await c.env.DB.prepare(
          `SELECT product_id, product_name, sku, quantity FROM invoice_items WHERE invoice_id = ?`
        ).bind(cr.id).all();
        for (const ci of (crItems || []) as any[]) {
          const skuMeta = String(ci.sku || '');
          const m = skuMeta.match(/src_item:(\d+)/);
          const q = Number(ci.quantity || 0);
          if (m) {
            const matchedId = Number(m[1]);
            refundedBySrcItemId.set(matchedId, (refundedBySrcItemId.get(matchedId) || 0) + q);
          } else {
            const fallbackKey = `${Number(ci.product_id || 0)}::${String(ci.product_name || '').trim().toLowerCase()}`;
            legacyRefundedByProduct.set(fallbackKey, (legacyRefundedByProduct.get(fallbackKey) || 0) + q);
          }
        }
      }

      if (!itemsIn.length) {
        return c.json({ success: false, error: 'Sélectionnez au moins une ligne à rembourser.', code: 'ITEMS_REQUIRED' }, 400);
      }

      const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
      const currency = String(settings?.currency || settings?.finance_currency || 'MAD');
      const DISPOSITION_OK = new Set(['broken_unusable', 'lost_not_received', 'customer_keeps', 'destroyed', 'other']);

      const sourceIsVr =
        source.doc_kind === 'quick_sale' ||
        source.doc_kind === 'ticket' ||
        String(source.number || '').toUpperCase().startsWith('VR');
      const sourceExempt =
        !!Number(source.tax_exempt) ||
        sourceIsVr ||
        (Number(source.tax_amount || 0) <= 0.001 &&
          Math.abs(Number(source.subtotal || 0) - Number(source.total || 0)) < 0.02);

      const preparedRefundLines: Array<{
        product_id: number | null;
        product_name: string;
        sku: string;
        quantity: number;
        restock: boolean;
        disposition: string;
        src_item_id: number;
        unit_price: number;
        list_price: number;
        tax_rate: number;
      }> = [];

      const legacyBySrcItem = new Map<number, number>();
      const qtyRequestedBySrcItem = new Map<number, number>();

      for (const raw of itemsIn) {
        const srcItemId = Number(raw.invoice_item_id || raw.id || 0);
        const src = byId.get(srcItemId);
        if (!src) {
          return c.json({ success: false, error: `Ligne source #${srcItemId} introuvable sur la facture ${source.number}` }, 400);
        }
        const maxQty = Number(src.quantity || 0);
        const fallbackKey = `${Number(src.product_id || 0)}::${String(src.product_name || '').trim().toLowerCase()}`;
        const legacyAlready = legacyRefundedByProduct.get(fallbackKey) || 0;
        if (legacyAlready > 0 && !legacyBySrcItem.has(srcItemId)) {
          legacyBySrcItem.set(srcItemId, legacyAlready);
        }
        const already = (refundedBySrcItemId.get(srcItemId) || 0) + legacyAlready;
        const remaining = Math.max(0, maxQty - already);
        const qty = Number(raw.quantity || 0);
        if (qty <= 0) continue;
        if (qty > remaining + 1e-9) {
          return c.json({
            success: false,
            error: `Quantité trop élevée pour « ${src.product_name} » (reste remboursable : ${remaining}).`,
            code: 'QTY_EXCEEDED',
          }, 400);
        }
        if (legacyAlready > 0) {
          legacyRefundedByProduct.set(fallbackKey, Math.max(0, legacyAlready - Math.min(legacyAlready, maxQty)));
        }
        refundedBySrcItemId.set(srcItemId, (refundedBySrcItemId.get(srcItemId) || 0) + qty);
        qtyRequestedBySrcItem.set(srcItemId, (qtyRequestedBySrcItem.get(srcItemId) || 0) + qty);

        // restock default true; if false, disposition required
        const restock =
          raw.restock === false || raw.restock === 0 || raw.restock === '0' || raw.restock === 'false'
            ? false
            : true;
        const disposition = String(raw.disposition || raw.disposition_code || '').trim();
        if (!restock) {
          if (!disposition || !DISPOSITION_OK.has(disposition)) {
            return c.json({
              success: false,
              error: `Pour « ${src.product_name} » : sans remise en stock, choisissez une disposition (cassé, perdu, client conserve…).`,
              code: 'DISPOSITION_REQUIRED',
            }, 400);
          }
        }
        const unitP = Number(src.unit_price || 0); // always HT in DB
        let taxRate = sourceExempt ? 0 : Number(src.tax_rate || 0);
        if (!sourceExempt && (!Number.isFinite(taxRate) || taxRate < 0)) taxRate = 0;
        if (!sourceExempt && taxRate <= 0 && Number(source.tax_amount || 0) > 0.001 && Number(source.subtotal || 0) > 0.001) {
          taxRate = (Number(source.tax_amount) / Number(source.subtotal)) * 100;
        }
        if (sourceExempt) taxRate = 0;
        preparedRefundLines.push({
          product_id: src.product_id || null,
          product_name: src.product_name,
          sku: src.sku || '',
          quantity: qty,
          restock,
          disposition: restock ? '' : disposition,
          src_item_id: srcItemId,
          unit_price: unitP,
          list_price: Number(src.list_price || unitP),
          tax_rate: taxRate,
        });
      }

      if (!preparedRefundLines.length) {
        return c.json({ success: false, error: 'Aucune quantité valide à rembourser.' }, 400);
      }

      const refundCalc = computeInvoiceLinesAndTotals(
        preparedRefundLines.map((p) => ({
          quantity: p.quantity,
          unitPrice: p.unit_price,
          listPrice: p.list_price,
          taxRate: p.tax_rate,
          defaultTax: 0,
          pricesTtc: false,
          isQuickSale: sourceIsVr || sourceExempt,
          taxExempt: sourceExempt,
          explicitInclusive: false,
        })),
        {
          defaultTax: 0,
          isQuickSale: sourceIsVr || sourceExempt,
          taxExempt: sourceExempt,
          currency,
        },
      );
      const lineItems = preparedRefundLines.map((p, idx) => ({
        ...p,
        line_total: refundCalc.lines[idx].line_total,
      }));
      const subtotal = refundCalc.totals.subtotal;
      const tax_amount = sourceExempt || sourceIsVr ? 0 : refundCalc.totals.tax_amount;
      const total = sourceExempt || sourceIsVr ? subtotal : refundCalc.totals.total;
      if (priorRefundedTotal + total > Number(source.total || 0) + 0.01) {
        return c.json({
          success: false,
          error: `Le cumul des remboursements dépasse le total de la facture ${source.number}.`,
          code: 'REFUND_TOTAL_EXCEEDED',
        }, 400);
      }
      // Ensure WR prefix is valid before allocating number
      const prefixCheck = validateCreditPrefix(settings?.credit_prefix || 'WR-');
      if (!prefixCheck.ok) {
        return c.json({ success: false, error: prefixCheck.error, code: prefixCheck.code }, 400);
      }
      if (settings) settings.credit_prefix = prefixCheck.value;

      let number = await nextDocumentNumber(c.env.DB, 'credit_note', settings, c.env);
      // Uniqueness guard (race / import)
      const clash = await c.env.DB.prepare(`SELECT id FROM invoices WHERE number = ?`).bind(number).first();
      if (clash) {
        return c.json({
          success: false,
          error: `Le numéro ${number} existe déjà. Augmentez « Prochain n° remboursement (WR) » dans Paramètres → Facturation.`,
          code: 'WR_NUMBER_TAKEN',
        }, 409);
      }
      if (!number || number.length > 40) {
        return c.json({ success: false, error: 'Numéro WR généré invalide.', code: 'WR_NUMBER_INVALID' }, 500);
      }

      const disclaimer =
        'IMPORTANT — Politique de remboursement : un remboursement sans motif valable n’est PAS accepté. ' +
        'Motifs acceptés uniquement : erreur de notre part, article cassé/défectueux envoyé (non causé par le client), ' +
        'mauvais article / non conforme, quantité manquante, dommage transport. ' +
        `Motif retenu : ${reasonCheck.full}`;

      const notes = [
        `Avoir / remboursement WR sur facture ${source.number}`,
        disclaimer,
        body.notes ? String(body.notes).trim() : '',
      ].filter(Boolean).join('\n\n');

      const paid = Number(source.amount_paid || 0);
      const srcTotal = Number(source.total || 0);
      const split = computeRefundSplit(total, srcTotal, paid, String(source.status || ''), currency);
      const creditVsDebt = split.credit_vs_debt;
      const cashRefund = split.cash_refund;
      const refundMethodRaw = String(body.refund_payment_method || body.payment_method || 'cash').toLowerCase();
      const refundMethod = ['cash', 'card', 'transfer', 'cheque', 'other'].includes(refundMethodRaw)
        ? refundMethodRaw
        : 'cash';

      const nextPaid = split.next_paid;
      const newStatus = split.new_status;
      const pubTok = makePublicToken();

      // Atomic D1 transaction: verify source invoice invariants, cumulative WR cap,
      // and per-line refundable quantities BEFORE committing WR + source update + ledger.
      await c.env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS wr_refund_assertions (marker TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok = 1))`
      ).run();
      if (cashRefund > 0.001) {
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
      }
      const wrMarker = crypto.randomUUID();
      const wrStmts: D1PreparedStatement[] = [];

      // 1) Assert source state + cumulative WR total cap inside SQLite transaction
      wrStmts.push(
        c.env.DB.prepare(
          `INSERT INTO wr_refund_assertions(marker, ok)
           SELECT ?, CASE WHEN EXISTS (
             SELECT 1 FROM invoices
             WHERE id = ?
               AND status NOT IN ('quote', 'devis', 'cancelled', 'remboursement')
               AND COALESCE(doc_kind, '') != 'remboursement'
               AND COALESCE(amount_paid, 0) IS ?
               AND COALESCE(total, 0) IS ?
               AND (
                 SELECT COALESCE(SUM(wr.total), 0) FROM invoices wr
                 WHERE wr.refund_of_invoice_id = ?
                   AND wr.status != 'cancelled'
                   AND (wr.status = 'remboursement' OR COALESCE(wr.doc_kind,'') = 'remboursement' OR IFNULL(wr.number,'') LIKE 'WR-%')
               ) + ? <= COALESCE(total, 0) + 0.01
           ) THEN 1 ELSE 0 END`
        ).bind(wrMarker, sourceId, source.amount_paid ?? 0, source.total ?? 0, sourceId, total),
      );

      // 2) Assert per-line refundable quantity inside SQLite transaction
      for (const [srcItemId, reqQty] of qtyRequestedBySrcItem) {
        const legQty = legacyBySrcItem.get(srcItemId) || 0;
        wrStmts.push(
          c.env.DB.prepare(
            `INSERT INTO wr_refund_assertions(marker, ok)
             SELECT ?, CASE WHEN (
               ? + (
                 SELECT COALESCE(SUM(ci.quantity), 0)
                 FROM invoice_items ci
                 INNER JOIN invoices wr ON wr.id = ci.invoice_id
                 WHERE wr.refund_of_invoice_id = ?
                   AND wr.status != 'cancelled'
                   AND (wr.status = 'remboursement' OR COALESCE(wr.doc_kind,'') = 'remboursement' OR IFNULL(wr.number,'') LIKE 'WR-%')
                   AND ('|' || COALESCE(ci.sku,'') || '|' LIKE '%|src_item:' || ? || '|%')
               ) + ?
             ) <= COALESCE((SELECT quantity FROM invoice_items WHERE id = ? AND invoice_id = ?), 0) + 1e-9
             THEN 1 ELSE 0 END`
          ).bind(`${wrMarker}:line:${srcItemId}`, legQty, sourceId, String(srcItemId), reqQty, srcItemId, sourceId),
        );
      }

      // 3) Insert WR invoice atomically
      wrStmts.push(
        c.env.DB.prepare(
          `INSERT INTO invoices (
            number, client_id, client_name, client_ice, client_address, client_city, client_email, client_phone,
            issue_date, due_date, status, subtotal, tax_amount, total, notes, amount_paid, tax_exempt,
            doc_kind, refund_of_invoice_id, refund_reason, refund_reason_code, created_by, public_token
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'remboursement', ?, ?, ?, ?, ?, ?, 'remboursement', ?, ?, ?, ?, ?)`
        ).bind(
          number,
          source.client_id || null,
          source.client_name,
          source.client_ice || '',
          source.client_address || '',
          source.client_city || '',
          source.client_email || '',
          source.client_phone || '',
          issue_date,
          null,
          subtotal,
          tax_amount,
          total,
          notes,
          0,
          source.tax_exempt ? 1 : 0,
          sourceId,
          reasonCheck.full,
          reasonCode,
          documentCreator,
          pubTok,
        ),
      );

      // 4) Insert WR items referencing the new WR invoice by unique number
      for (const item of lineItems) {
        const tag = [
          item.sku || '',
          `src_item:${item.src_item_id}`,
          item.restock ? 'restock:1' : 'restock:0',
          item.disposition ? `disp:${item.disposition}` : '',
        ].filter(Boolean).join('|');
        wrStmts.push(
          c.env.DB.prepare(
            `INSERT INTO invoice_items (invoice_id, product_id, product_name, sku, quantity, unit_price, tax_rate, line_total, list_price, discount_amount, discount_percent)
             VALUES ((SELECT id FROM invoices WHERE number = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            number,
            item.product_id,
            item.product_name,
            tag,
            item.quantity,
            item.unit_price,
            item.tax_rate,
            item.line_total,
            item.list_price,
            0,
            0,
          ),
        );
      }

      // 5) Update source invoice paid/status atomically
      wrStmts.push(
        c.env.DB.prepare(
          `UPDATE invoices SET amount_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
        ).bind(nextPaid, newStatus, sourceId),
      );

      // 6) Audit trail on source (note starts with « Avoir » → excluded from sales entrées)
      wrStmts.push(
        c.env.DB.prepare(
          `INSERT INTO invoice_payments (invoice_id, amount, payment_method, payee, note, paid_at)
           VALUES (?, ?, ?, 'company', ?, ?)`
        ).bind(
          sourceId,
          total,
          cashRefund > 0.001 ? refundMethod : 'other',
          `Avoir ${number} — ${reasonCheck.label}` +
            (cashRefund > 0.001 ? ` · sortie caisse ${cashRefund}` : ' · crédit sur impayé') +
            (creditVsDebt > 0.001 && cashRefund > 0.001 ? ` · dette ${creditVsDebt}` : ''),
          issue_date,
        ),
      );

      // 7) Cash/card already collected → ledger outflow (Balance)
      if (cashRefund > 0.001) {
        wrStmts.push(
          c.env.DB.prepare(
            `INSERT INTO expenses (category, description, amount, payment_method, expense_date, vendor_name, reference, notes, entry_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'expense')`
          ).bind(
            'Remboursement client',
            `Remboursement ${number} sur ${source.number} — ${reasonCheck.label}`,
            cashRefund,
            refundMethod,
            issue_date,
            source.client_name || '',
            number,
            `source:${sourceId}|code:${reasonCode}|paid_was:${paid}|wr:${number}`,
          ),
        );
      }

      // 8) Cleanup assertions inside the same transaction
      wrStmts.push(
        c.env.DB.prepare(`DELETE FROM wr_refund_assertions WHERE marker = ? OR marker LIKE ?`)
          .bind(wrMarker, `${wrMarker}:%`),
      );

      try {
        await c.env.DB.batch(wrStmts);
      } catch (batchErr: any) {
        console.error('wr_refund_atomic_failed', String(batchErr?.message || batchErr));
        return c.json({
          success: false,
          error: 'Remboursement refusé : la facture source ou les quantités disponibles ont été modifiées simultanément.',
          code: 'REFUND_CONFLICT',
        }, 409);
      }

      const credit = await c.env.DB.prepare(`SELECT * FROM invoices WHERE number = ?`).bind(number).first() as any;
      const creditId = Number(credit?.id || 0);

      // Apply stock restock / no-restock audit ONLY AFTER atomic WR commit
      for (const item of lineItems) {
        if (!item.product_id) continue;
        if (item.restock) {
          try {
            await applyStockDelta(
              c.env.DB,
              item.product_id,
              Number(item.quantity),
              `WR ${number} — retour stock`,
              number,
              { type: 'refund_restock', createdBy: sessionUserFromHeader(c.req.header('Authorization')).username || undefined },
            );
          } catch (e) {
            console.error('restock refund', e);
          }
        } else {
          try {
            const dispLabel =
              item.disposition === 'broken_unusable' ? 'cassé/inutilisable'
              : item.disposition === 'lost_not_received' ? 'perdu/non reçu'
              : item.disposition === 'customer_keeps' ? 'client conserve'
              : item.disposition === 'destroyed' ? 'détruit/rebut'
              : item.disposition || 'hors stock';
            await applyStockDelta(
              c.env.DB,
              item.product_id,
              0,
              `WR ${number} — hors stock (${dispLabel}) · qté facturée ${item.quantity}`,
              number,
              { type: 'refund_no_restock', createdBy: sessionUserFromHeader(c.req.header('Authorization')).username || undefined },
            );
          } catch (e) {
            console.error('no-restock audit', e);
          }
        }
      }

      try {
        await writeAudit(c.env.DB, {
          username: sessionUserFromHeader(c.req.header('Authorization')).username,
          role: sessionUserFromHeader(c.req.header('Authorization')).role,
          action: 'invoice.remboursement',
          entity: 'invoices',
          entity_id: String(creditId),
          detail: `WR ${number} on ${source.number} total=${total} restock lines=${lineItems.length}`,
        });
      } catch { /* */ }

      await invalidateDashboardCache(c.env.CACHE, c.env.MOBILE_HUB).catch(() => {});

      const { results: invItems } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).bind(creditId).all();

      const payload = {
        success: true,
        message: cashRefund > 0.001 && creditVsDebt > 0.001
          ? `Avoir ${number} créé sur ${source.number} (payé ou non). Crédit dette ${creditVsDebt} + sortie solde ${cashRefund}.`
          : cashRefund > 0.001
            ? `Avoir ${number} créé sur ${source.number} (document payé). Remboursement client enregistré en solde (${cashRefund}).`
            : `Avoir ${number} créé sur ${source.number}. Crédit appliqué au solde client (${creditVsDebt}).`,
        data: {
          ...credit,
          items: invItems,
          source_invoice_id: sourceId,
          source_number: source.number,
          cash_refund: cashRefund,
          credit_applied_to_debt: creditVsDebt,
          public_url: pubTok ? `${new URL(c.req.url).origin}/api/public/invoices/${pubTok}` : null,
        },
      };
      await afterBusinessMutation(c.env.CACHE, c.env.MOBILE_HUB);
      if (idemKey) await idempotencyPut(c.env.DB, `wr:${idemKey}`, 'POST /remboursement', 201, payload);
      return c.json(payload, 201);
    } catch (e: any) {
      console.error('POST /api/invoices/remboursement', e);
      return c.json({
        success: false,
        error: 'Impossible de créer le remboursement pour le moment. Vérifiez la facture d’origine et réessayez.',
        code: 'REFUND_FAILED',
      }, 500);
    }
  });

  app.patch('/api/invoices/:id/status', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const id = c.req.param('id');
    const body = await c.req.json();
    const { status, amount_paid } = body;
    const allowed = ['draft', 'sent', 'paid', 'partial', 'cancelled', 'overdue', 'quote', 'remboursement'];
    if (!allowed.includes(status)) return c.json({ success: false, error: 'Statut invalide' }, 400);

    const inv = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first() as any;
    if (!inv) return c.json({ success: false, error: 'Facture introuvable' }, 404);

    // Formal void (Phase 0): cancel keeps sequential number; reason stored for CGI audit
    if (status === 'cancelled' && inv.status !== 'cancelled') {
      await ensureVoidColumns(c.env.DB);
      const voidReason = String(body.void_reason || body.reason || '').trim();
      if (voidReason.length < 5) {
        return c.json({
          success: false,
          error: 'Motif d’annulation obligatoire (min. 5 caractères). Le numéro de document est conservé (pas de trou de série).',
          code: 'VOID_REASON_REQUIRED',
        }, 400);
      }
      const sess = sessionUserFromHeader(c.req.header('Authorization'));
      try {
        await c.env.DB.prepare(
          `UPDATE invoices SET void_reason = ?, voided_at = datetime('now'), voided_by = ? WHERE id = ?`
        ).bind(voidReason.slice(0, 500), sess.username || '', id).run();
      } catch { /* columns may miss on very old DB until ensure */ }
    }

    // Cancelling a real invoice restores stock; quotes never touched stock
    const wasQuote = inv.status === 'quote' || inv.status === 'devis';
    if (status === 'cancelled' && !wasQuote && inv.status !== 'cancelled') {
      const { results: items } = await c.env.DB.prepare(
        `SELECT product_id, quantity FROM invoice_items WHERE invoice_id = ?`
      ).bind(id).all();
      for (const it of (items || []) as any[]) {
        if (it.product_id) {
          await applyStockDelta(c.env.DB, it.product_id, Number(it.quantity || 0), 'Facture annulée (retour stock)', inv.number, { createdBy: sessionUserFromHeader(c.req.header('Authorization')).username || undefined });
        }
      }
    }

    const updates = [`status = ?`, `updated_at = datetime('now')`];
    const values: any[] = [status];
    if (amount_paid !== undefined) {
      const safePaid = sanitizeNonNegativeAmount(amount_paid, { max: 1e12, decimals: 2 });
      if (safePaid == null) return c.json({ success: false, error: 'Montant payé invalide' }, 400);
      updates.push(`amount_paid = ?`);
      values.push(safePaid);
    }
    values.push(id);
    await c.env.DB.prepare(`UPDATE invoices SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
    const invoice = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first();
    return c.json({
      success: true,
      data: invoice,
      message: status === 'cancelled' && !wasQuote
        ? ((inv.doc_kind === 'quick_sale' || inv.doc_kind === 'ticket' || String(inv.number || '').startsWith('VR'))
          ? 'Ticket VR annulé — stock rétabli, numéro conservé.'
          : 'Facture annulée — stock rétabli.')
        : 'Statut mis à jour dans la base de données.',
    });
  });


  /** Record a payment (partial or full). Auto-sets status paid/partial and can create receipt. */

  /** Edit invoice / quote — client fields always; full lines for devis or unpaid invoices */
  app.put('/api/invoices/:id', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const id = c.req.param('id');
    await ensureInvoiceItemPromoColumns(c.env.DB);
    await ensureInvoiceTaxExempt(c.env.DB);
    await ensureProductBulkDiscounts(c.env.DB);
    await ensureClientTaxExempt(c.env.DB);

    const body = await c.req.json().catch(() => ({}));
    const inv = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first() as any;
    if (!inv) return c.json({ success: false, error: 'Facture introuvable' }, 404);

    const isQuote = inv.status === 'quote' || inv.status === 'devis';
    const isQuickSale = inv.doc_kind === 'quick_sale' || inv.doc_kind === 'ticket' || String(inv.number || '').startsWith('VR');
    const paid = Number(inv.amount_paid || 0);
    const isUnpaid = !isQuote && paid <= 0.0001 && inv.status !== 'paid' && inv.status !== 'cancelled';
    const canEditLines = isQuote || isUnpaid;

    const fields: string[] = [];
    const values: any[] = [];
    const allowed = [
      'client_name', 'client_ice', 'client_address', 'client_city', 'client_email', 'client_phone',
      'notes', 'issue_date', 'due_date', 'client_id',
    ];
    for (const k of allowed) {
      if (body[k] !== undefined) {
        fields.push(`${k} = ?`);
        values.push(body[k]);
      }
    }

    // Tax exempt toggle
    let taxExempt = inv.tax_exempt ? true : false;
    if (isQuickSale && body.tax_exempt === false) {
      return c.json({ success: false, error: 'Une vente rapide ne peut pas utiliser la TVA.', code: 'QUICK_SALE_NO_TAX' }, 400);
    }
    if (body.tax_exempt !== undefined && !isQuickSale) {
      taxExempt = !!body.tax_exempt;
      fields.push(`tax_exempt = ?`);
      values.push(taxExempt ? 1 : 0);
    } else if (!isQuickSale && body.client_id) {
      const cl = await c.env.DB.prepare(`SELECT tax_exempt FROM clients WHERE id = ?`).bind(body.client_id).first() as any;
      if (cl?.tax_exempt) {
        taxExempt = true;
        fields.push(`tax_exempt = ?`);
        values.push(1);
      }
    }

    let message = 'Document mis à jour.';

    if (Array.isArray(body.items)) {
      if (isQuickSale && Math.abs(Number(inv.tax_amount || 0)) > 0.001) {
        return c.json({ success: false, error: 'Ce ticket historique contient de la TVA enregistrée. Ses montants doivent être régularisés avant de modifier ses lignes.', code: 'QUICK_SALE_HISTORICAL_TAX' }, 400);
      }
      if (!canEditLines) {
        return c.json({
          success: false,
          error: 'Les lignes ne peuvent plus être modifiées : des paiements existent déjà ou la facture est soldée/annulée. Créez un avoir ou une nouvelle facture.',
          code: 'LINES_LOCKED',
        }, 400);
      }
      if (!body.items.length) {
        return c.json({ success: false, error: 'Au moins une ligne est obligatoire.' }, 400);
      }

      if (isQuickSale) { taxExempt = true; fields.push('tax_exempt = ?'); values.push(1); }
      try { await ensureHrSettings(c.env.DB); } catch { /* */ }
      let settings: any = null;
      try {
        settings = await c.env.DB.prepare(`SELECT tax_rate, currency, finance_currency FROM company_settings WHERE id = 1`).first() as any;
      } catch {
        settings = await c.env.DB.prepare(`SELECT tax_rate FROM company_settings WHERE id = 1`).first() as any;
      }
      const currency = String(settings?.currency || settings?.finance_currency || 'MAD');
      const defaultTax = Number(settings?.tax_rate ?? 20);
      const preparedEditLines: Array<{
        product_id: any;
        product_name: string;
        sku: string;
        quantity: number;
        listPrice: number;
        unitPrice: number;
        taxRate: unknown;
      }> = [];

      for (const raw of body.items) {
        const name = String(raw.product_name || '').trim();
        if (!name) continue;
        const qty = Number(raw.quantity || 0);
        if (!Number.isFinite(qty) || qty <= 0) continue;
        let listPrice = Number(raw.list_price ?? raw.catalog_price ?? 0);
        let unitPrice = Number(raw.unit_price ?? listPrice);
        if (raw.client_price !== undefined && raw.client_price !== null && raw.client_price !== '') {
          unitPrice = Number(raw.client_price);
        }
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          return c.json({ success: false, error: 'Prix unitaire invalide.' }, 400);
        }
        if (!Number.isFinite(listPrice) || listPrice < 0) listPrice = unitPrice;

        if (raw.product_id) {
          const prod = await c.env.DB.prepare(`SELECT price, bulk_discounts FROM products WHERE id = ?`).bind(raw.product_id).first() as any;
          if (prod) {
            const catalog = Number(prod.price || 0);
            if (!listPrice || listPrice < 0.001) listPrice = catalog || unitPrice;
            if (catalog > unitPrice && listPrice < catalog) listPrice = catalog;
            if (listPrice > 0 && Math.abs(unitPrice - listPrice) < 0.001) {
              const bulk = applyBulkDiscount(listPrice, qty, prod.bulk_discounts);
              if (bulk.bulk_percent > 0) unitPrice = bulk.unit_price;
            }
          }
        }
        if (!listPrice) listPrice = unitPrice;
        preparedEditLines.push({
          product_id: raw.product_id || null,
          product_name: name,
          sku: raw.sku || '',
          quantity: qty,
          listPrice,
          unitPrice,
          taxRate: raw.tax_rate,
        });
      }
      if (!preparedEditLines.length) {
        return c.json({ success: false, error: 'Aucune ligne valide.' }, 400);
      }

      const editCalc = computeInvoiceLinesAndTotals(
        preparedEditLines.map((p) => ({
          quantity: p.quantity,
          unitPrice: p.unitPrice,
          listPrice: p.listPrice,
          taxRate: p.taxRate !== undefined && p.taxRate !== null && p.taxRate !== '' ? Number(p.taxRate) : undefined,
          defaultTax,
          pricesTtc: false,
          isQuickSale,
          taxExempt,
          explicitInclusive: false,
        })),
        { defaultTax, isQuickSale, taxExempt, currency },
      );
      const normalized = preparedEditLines.map((p, idx) => {
        const calc = editCalc.lines[idx];
        return {
          product_id: p.product_id,
          product_name: p.product_name,
          sku: p.sku,
          quantity: p.quantity,
          list_price: calc.stored_list_price,
          unit_price: calc.stored_unit_price,
          discount_amount: calc.discount_amount,
          discount_percent: calc.discount_percent,
          tax_rate: calc.tax_rate,
          line_total: calc.line_total,
        };
      });
      const subtotal = editCalc.totals.subtotal;
      const taxAmount = editCalc.totals.tax_amount;
      const total = editCalc.totals.total;

      // --- Stock sync for REAL invoices only (quotes never touch stock) ---
      // Only apply NET quantity deltas per product. If qty unchanged → leave stock alone
      // (no restock + re-sale noise in the audit log).
      let stockTouched = false;
      if (!isQuote) {
        const { results: oldItems } = await c.env.DB.prepare(
          `SELECT product_id, quantity FROM invoice_items WHERE invoice_id = ?`
        ).bind(id).all();

        const oldByProduct = new Map<number, number>();
        for (const old of (oldItems || []) as any[]) {
          const pid = Number(old.product_id || 0);
          if (!pid) continue;
          oldByProduct.set(pid, (oldByProduct.get(pid) || 0) + Number(old.quantity || 0));
        }

        const newByProduct = new Map<number, number>();
        for (const it of normalized) {
          const pid = Number(it.product_id || 0);
          if (!pid) continue;
          newByProduct.set(pid, (newByProduct.get(pid) || 0) + Number(it.quantity || 0));
        }

        const allPids = new Set<number>([...oldByProduct.keys(), ...newByProduct.keys()]);
        for (const pid of allPids) {
          const oldQty = oldByProduct.get(pid) || 0;
          const newQty = newByProduct.get(pid) || 0;
          // stockDelta > 0 → restock (qty reduced or line removed)
          // stockDelta < 0 → sale (qty increased or line added)
          const stockDelta = oldQty - newQty;
          if (Math.abs(stockDelta) < 1e-9) continue; // quantity unchanged — do not touch stock
          stockTouched = true;
          if (stockDelta > 0) {
            await applyStockDelta(c.env.DB, pid, stockDelta, 'Modification facture (qté ↓ / ligne retirée)', inv.number, { createdBy: sessionUserFromHeader(c.req.header('Authorization')).username || undefined });
          } else {
            await applyStockDelta(c.env.DB, pid, stockDelta, 'Modification facture (qté ↑ / ligne ajoutée)', inv.number, { createdBy: sessionUserFromHeader(c.req.header('Authorization')).username || undefined });
          }
        }
      }

      await c.env.DB.prepare(`DELETE FROM invoice_items WHERE invoice_id = ?`).bind(id).run();
      for (const it of normalized) {
        await c.env.DB.prepare(
          `INSERT INTO invoice_items (invoice_id, product_id, product_name, sku, quantity, unit_price, tax_rate, line_total, list_price, discount_amount, discount_percent)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(id, it.product_id, it.product_name, it.sku, it.quantity, it.unit_price, it.tax_rate, it.line_total, it.list_price, it.discount_amount, it.discount_percent).run();
      }
      fields.push(`subtotal = ?`, `tax_amount = ?`, `total = ?`);
      values.push(subtotal, taxAmount, total);
      if (isQuote) {
        message = 'Devis mis à jour (lignes, prix et promo) — stock non modifié.';
      } else if (stockTouched) {
        message = 'Facture impayée mise à jour — quantités modifiées, stock synchronisé.';
      } else {
        message = 'Facture impayée mise à jour (prix / promo / infos) — stock inchangé (quantités identiques).';
      }
    }

    if (!fields.length) return c.json({ success: false, error: 'Aucun champ à modifier' }, 400);
    fields.push(`updated_at = datetime('now')`);
    values.push(id);
    await c.env.DB.prepare(`UPDATE invoices SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
    const updated = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first();
    const { results: items } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).bind(id).all();
    return c.json({ success: true, data: { ...updated, items }, message });
  });

  app.post('/api/invoices/:id/payments', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const id = c.req.param('id');
    await ensurePaymentHistoryTable(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const idemKey = extractIdempotencyKey(c, body);
    if (idemKey) {
      const cached = await idempotencyGet(c.env.DB, `pay:${id}:${idemKey}`);
      if (cached) return c.json(cached.body, cached.status as any);
    }
    const amount = Number(body.amount || 0);
    const payment_method = String(body.payment_method || 'cash');
    const payee = String(body.payee || 'company'); // company | owner
    const note = String(body.note || '');
    // v258 — tenant-local day (Africa/Casablanca), never the UTC date: a payment
    // made just after local midnight used to land in the previous month's finance
    // period because substr(paid_at,1,10) read a UTC day.
    const paid_at = String(body.paid_at || moroccoTodayStr()).slice(0, 10);
    if (!amount || amount <= 0) return c.json({ success: false, error: 'Montant de paiement invalide' }, 400);
    const allowedMethods = [
      'cash', 'bank_company', 'bank_owner', 'check_company', 'check_owner', 'card', 'other',
      'bank', 'check', // legacy
    ];
    const method = allowedMethods.includes(payment_method) ? payment_method : 'cash';
    const who = payee === 'owner' ? 'owner' : 'company';

    const inv = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first() as any;
    if (!inv) return c.json({ success: false, error: 'Facture introuvable' }, 404);
    if (inv.status === 'quote' || inv.status === 'devis') {
      return c.json({ success: false, error: "Convertissez d'abord le devis en facture" }, 400);
    }
    if (inv.status === 'cancelled') return c.json({ success: false, error: 'Facture annulée' }, 400);
    if (inv.status === 'remboursement' || inv.doc_kind === 'remboursement') {
      return c.json({ success: false, error: 'Impossible d’enregistrer un paiement sur un avoir WR.', code: 'WR_NO_PAYMENT' }, 400);
    }

    const prev = Number(inv.amount_paid || 0);
    const total = Number(inv.total || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      return c.json({ success: false, error: 'Montant de paiement invalide' }, 400);
    }
    let payCurrency = 'MAD';
    try {
      const st = await c.env.DB.prepare(`SELECT currency, finance_currency FROM company_settings WHERE id = 1`).first() as any;
      payCurrency = String(st?.currency || st?.finance_currency || 'MAD');
    } catch { /* */ }
    const payApp = computePaymentApplication(amount, total, prev, payCurrency);
    if (!payApp) {
      return c.json({ success: false, error: 'Cette facture est déjà soldée (reste = 0).', code: 'ALREADY_PAID' }, 400);
    }
    const { applied, next_paid: next, remaining, status } = payApp;

    await ensureExpenseTypeColumn(c.env.DB);
    await c.env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS payment_assertions (marker TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok = 1))`
    ).run();
    if (applied > 0) {
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
    }
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
    const ledgerDesc = `Encaissement facture ${inv.number} (${methodLabel} → ${whoLabel})${note ? ' — ' + note : ''}`;

    const payMarker = crypto.randomUUID();
    const payStmts: D1PreparedStatement[] = [
      c.env.DB.prepare(
        `INSERT INTO payment_assertions(marker, ok)
         SELECT ?, CASE WHEN EXISTS (
           SELECT 1 FROM invoices
           WHERE id = ?
             AND status NOT IN ('quote', 'devis', 'cancelled', 'remboursement')
             AND COALESCE(doc_kind, '') != 'remboursement'
             AND COALESCE(amount_paid, 0) IS ?
             AND COALESCE(total, 0) IS ?
         ) THEN 1 ELSE 0 END`
      ).bind(payMarker, id, inv.amount_paid ?? 0, inv.total ?? 0),
      c.env.DB.prepare(
        `INSERT INTO invoice_payments (invoice_id, amount, payment_method, payee, note, paid_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(id, applied, method, who, note, paid_at),
    ];
    if (applied > 0) {
      payStmts.push(
        c.env.DB.prepare(
          `INSERT INTO expenses (category, description, amount, payment_method, expense_date, vendor_name, reference, notes, entry_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'income')`
        ).bind(
          'Encaissement client',
          ledgerDesc,
          applied,
          ledgerMethod,
          paid_at,
          inv.client_name || '',
          inv.number || '',
          `invoice_id:${id}|payee:${who}|method:${method}`,
        ),
      );
    }
    payStmts.push(
      c.env.DB.prepare(
        `UPDATE invoices SET amount_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(next, status, id),
      c.env.DB.prepare(`DELETE FROM payment_assertions WHERE marker = ?`).bind(payMarker),
    );
    try {
      await c.env.DB.batch(payStmts);
    } catch (payErr: any) {
      console.error('invoice_payment_atomic_failed', String(payErr?.message || payErr));
      return c.json({
        success: false,
        error: 'Paiement refusé : le solde ou le statut de la facture a changé simultanément. Actualisez et réessayez.',
        code: 'PAYMENT_CONFLICT',
      }, 409);
    }
    await invalidateDashboardCache(c.env.CACHE, c.env.MOBILE_HUB);

    // v254 — notify authorized finance recipients that a client payment was
    // recorded (deduped by the durable outbox; re-checks role at delivery).
    // Best-effort: a push failure must NEVER fail or roll back the payment.
    try {
      await notifyPaymentRecorded(c.env, {
        invoiceId: Number(id),
        number: String(inv.number || ''),
        clientName: String(inv.client_name || ''),
        amount: applied,
        remaining,
        status,
      });
    } catch (e) {
      console.error('finance_payment_notify_err', String((e as any)?.message || e));
    }

    // Receipt rules (Part 5):
    // - Created ONLY when remaining balance reaches 0 (status === 'paid')
    // - At most ONE receipt per invoice (never on partial payments)
    // - Invoice stays in the invoices list forever (never deleted/hidden)
    // - Manual receipts remain available under /receipts for independent use
    let receipt = null;
    if (status === 'paid') {
      await ensureReceiptsTable(c.env.DB);
      await ensureDocumentActors(c.env.DB, 'receipts');
      const receiptCreator = sessionUserFromHeader(c.req.header('Authorization')).username || null;
      receipt = await c.env.DB.prepare(
        `SELECT * FROM receipts WHERE invoice_id = ? ORDER BY id DESC LIMIT 1`
      ).bind(id).first();
      if (!receipt) {
        try {
          const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
          const number = await nextDocumentNumber(c.env.DB, 'receipt', settings, c.env);
          await c.env.DB.prepare(
            `INSERT INTO receipts (number, invoice_id, client_name, amount, payment_method, issue_date, notes, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(number, id, inv.client_name, total, method, paid_at, note || `Règlement complet facture ${inv.number}`, receiptCreator).run();
          receipt = await c.env.DB.prepare(
            `SELECT * FROM receipts WHERE number = ? LIMIT 1`
          ).bind(number).first();
        } catch (e) {
          console.error('receipt create failed', e);
          // Fallback: try simple number
          try {
            const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
            const prefix = settings?.receipt_prefix || 'RCP-';
            const nextNum = Number(settings?.next_receipt_number || 1);
            const number = `${prefix}${String(nextNum).padStart(5, '0')}`;
            await c.env.DB.prepare(
              `INSERT OR IGNORE INTO receipts (number, invoice_id, client_name, amount, payment_method, issue_date, notes, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(number, id, inv.client_name, total, method, paid_at, note || `Règlement complet facture ${inv.number}`, receiptCreator).run();
            await c.env.DB.prepare(
              `UPDATE company_settings SET next_receipt_number = COALESCE(next_receipt_number, 1) + 1 WHERE id = 1`
            ).run();
            receipt = await c.env.DB.prepare(`SELECT * FROM receipts WHERE number = ? LIMIT 1`).bind(number).first();
          } catch (e2) {
            console.error('receipt create fallback failed', e2);
          }
        }
      }
    }

    const { results: history } = await c.env.DB.prepare(
      `SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY paid_at DESC, id DESC`
    ).bind(id).all();
    const updated = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first();
    const payload = {
      success: true,
      data: updated,
      remaining,
      history: history || [],
      receipt,
      message: status === 'paid'
        ? `Facture soldée. Total payé ${next}. Reçu généré.`
        : `Paiement enregistré (${applied}). Cumul ${next} · Reste ${remaining}.`,
    };
    await afterBusinessMutation(c.env.CACHE, c.env.MOBILE_HUB);
    if (idemKey) await idempotencyPut(c.env.DB, `pay:${id}:${idemKey}`, 'POST /payments', 200, payload);
    return c.json(payload);
  });

  app.get('/api/invoices/:id/payments', async (c) => {
    const id = c.req.param('id');
    await ensurePaymentHistoryTable(c.env.DB);
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY paid_at DESC, id DESC`
    ).bind(id).all();
    return c.json({ success: true, data: results || [] });
  });

  /** Convert a devis (quote) into a real invoice: deduct stock, set status sent, new invoice number optional keep same */
  app.post('/api/invoices/:id/convert-quote', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    await ensureInvoiceTaxExempt(c.env.DB);
    await ensureInvoiceRefundColumns(c.env.DB);
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({} as any));
    const target = String(body?.target || body?.to || 'invoice').toLowerCase();
    const asQuickSale = target === 'quick_sale' || target === 'vr' || target === 'vente_rapide';

    const inv = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first() as any;
    if (!inv) return c.json({ success: false, error: 'Document introuvable' }, 404);
    if (inv.doc_kind === 'quick_sale' || inv.doc_kind === 'ticket' || String(inv.number || '').startsWith('VR')) {
      return c.json({ success: false, error: 'Un ticket de vente rapide ne peut pas être converti.' }, 400);
    }
    if (inv.status !== 'quote' && inv.status !== 'devis') {
      return c.json({ success: false, error: 'Seuls les devis peuvent être convertis' }, 400);
    }

    const { results: quoteItems } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).bind(id).all();
    if (asQuickSale && Number(inv.amount_paid || 0) > 0.001) {
      return c.json({ success: false, error: 'Ce devis comporte des paiements. Régularisez-les avant la conversion.', code: 'QUOTE_HAS_PAYMENTS' }, 400);
    }
    if (!quoteItems?.length || quoteItems.some((item: any) => !Number.isFinite(Number(item.quantity)) || !Number.isFinite(Number(item.unit_price)) || Number(item.quantity) <= 0 || Number(item.unit_price) < 0)) {
      return c.json({ success: false, error: 'Lignes du devis invalides.', code: 'INVALID_QUOTE_LINES' }, 400);
    }
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const currency = String(settings?.currency || settings?.finance_currency || 'MAD');
    const invDecimals = getCurrencySpec(currency).invoiceDecimals;
    const quickTotal = sumMoneyAmounts(
      (quoteItems || []).map((item: any) => roundCurrency(Number(item.quantity) * Number(item.unit_price), currency, 'invoice')),
      invDecimals,
    );

    // Credit limit (invoice path only — VR is cash-oriented)
    if (!asQuickSale) {
      await ensureClientCreditLimit(c.env.DB);
      const credit = await checkClientCreditLimit(c.env.DB, {
        clientId: inv.client_id ? Number(inv.client_id) : null,
        clientName: inv.client_name,
        clientIce: inv.client_ice,
        addAmount: Number(inv.total || 0),
      });
      if (!credit.ok) {
        return c.json({
          success: false,
          error: credit.message || 'Limite de crédit dépassée',
          code: 'CREDIT_LIMIT',
          data: { outstanding: credit.outstanding, limit: credit.limit },
        }, 400);
      }
    }

    const kind = asQuickSale ? 'quick_sale' : 'invoice';
    const newNumber = await nextDocumentNumber(c.env.DB, kind as any, settings, c.env);
    // D1 batch is atomic. All preconditions, stock updates, warehouse mirrors,
    // movements and the document update commit together, or all roll back.
    await ensureStockMovementsTable(c.env.DB);
    await ensureStockLocations(c.env.DB);
    const locationId = await getDefaultLocationId(c.env.DB);
    await c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS quote_conversion_assertions (marker TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok = 1))`).run();
    const marker = crypto.randomUUID();
    const stmts: D1PreparedStatement[] = [];
    const conditions = (quoteItems as any[]).map(() => `EXISTS (SELECT 1 FROM invoice_items WHERE invoice_id = ? AND id = ? AND product_id IS ? AND quantity IS ? AND unit_price IS ? AND tax_rate IS ? AND line_total IS ?)`);
    const conditionBinds = (quoteItems as any[]).flatMap((item: any) => [id, item.id, item.product_id ?? null, item.quantity ?? null, item.unit_price ?? null, item.tax_rate ?? null, item.line_total ?? null]);
    stmts.push(c.env.DB.prepare(`INSERT INTO quote_conversion_assertions(marker, ok)
      SELECT ?, CASE WHEN EXISTS (SELECT 1 FROM invoices WHERE id = ? AND status IN ('quote','devis') AND number IS ? AND amount_paid IS ? AND total IS ?)
      AND (SELECT COUNT(*) FROM invoice_items WHERE invoice_id = ?) = ? AND ${conditions.join(' AND ')} THEN 1 ELSE 0 END`)
      .bind(marker, id, inv.number ?? null, inv.amount_paid ?? null, inv.total ?? null, id, quoteItems.length, ...conditionBinds));
    const quantities = new Map<number, number>();
    for (const item of quoteItems as any[]) {
      if (item.product_id) quantities.set(Number(item.product_id), (quantities.get(Number(item.product_id)) || 0) + Number(item.quantity));
    }
    const actor = sessionUserFromHeader(c.req.header('Authorization')).username || '';
    for (const [productId, quantity] of quantities) {
      // The assertion is inside the transaction, so another conversion cannot
      // consume stock between validation and deduction. Untracked/missing
      // products retain the legacy behavior of not changing stock.
      stmts.push(c.env.DB.prepare(`INSERT INTO quote_conversion_assertions(marker, ok)
        SELECT ?, CASE WHEN EXISTS (SELECT 1 FROM products WHERE id = ? AND track_inventory = 1 AND COALESCE(stock_quantity,0) < ?) THEN 0 ELSE 1 END`)
        .bind(`${marker}:${productId}`, productId, quantity));
      stmts.push(c.env.DB.prepare(`INSERT INTO stock_movements (product_id, type, quantity, previous_quantity, new_quantity, reason, reference, created_by)
        SELECT id, 'sale', ?, COALESCE(stock_quantity,0), COALESCE(stock_quantity,0) - ?, ?, ?, ? FROM products WHERE id = ? AND track_inventory = 1`)
        .bind(quantity, quantity, asQuickSale ? 'Devis→VR' : 'Devis→Facture', newNumber, actor, productId));
      if (locationId) {
        stmts.push(c.env.DB.prepare(`INSERT INTO stock_location_qty (location_id, product_id, quantity)
          SELECT ?, id, MAX(0, CASE WHEN NOT EXISTS (SELECT 1 FROM stock_location_qty WHERE product_id = products.id) THEN COALESCE(stock_quantity,0) ELSE 0 END - ?)
          FROM products WHERE id = ? AND track_inventory = 1
          ON CONFLICT(location_id, product_id) DO UPDATE SET quantity = MAX(0, stock_location_qty.quantity - ?)`)
          .bind(locationId, quantity, productId, quantity));
      }
      stmts.push(c.env.DB.prepare(`UPDATE products SET stock_quantity = COALESCE(stock_quantity,0) - ?, updated_at = datetime('now') WHERE id = ? AND track_inventory = 1`).bind(quantity, productId));
    }
    if (asQuickSale) {
      stmts.push(c.env.DB.prepare(`UPDATE invoice_items SET tax_rate = 0, line_total = ROUND(quantity * unit_price, ?) WHERE invoice_id = ?`).bind(invDecimals, id));
      stmts.push(c.env.DB.prepare(`UPDATE invoices SET status = 'sent', number = ?, doc_kind = 'quick_sale', tax_exempt = 1, subtotal = ?, tax_amount = 0, total = ?, updated_at = datetime('now') WHERE id = ?`).bind(newNumber, quickTotal, quickTotal, id));
    } else {
      stmts.push(c.env.DB.prepare(`UPDATE invoices SET status = 'sent', number = ?, doc_kind = 'invoice', updated_at = datetime('now') WHERE id = ?`).bind(newNumber, id));
    }
    stmts.push(c.env.DB.prepare(`DELETE FROM quote_conversion_assertions WHERE marker = ? OR marker LIKE ?`).bind(marker, `${marker}:%`));
    try {
      await c.env.DB.batch(stmts);
    } catch (error) {
      console.error('quote_conversion_atomic_failed', String((error as any)?.message || error));
      return c.json({ success: false, error: 'Conversion impossible : le devis ou le stock a changé, ou le stock est insuffisant. Actualisez et réessayez.', code: 'QUOTE_CONVERSION_CONFLICT' }, 409);
    }

    await afterBusinessMutation(c.env.CACHE, c.env.MOBILE_HUB);
    const updated = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first();
    const msg = asQuickSale
      ? `Devis converti en vente rapide ${newNumber}. Stock mis à jour.`
      : `Devis converti en facture ${newNumber}. Stock mis à jour.`;
    return c.json({ success: true, data: updated, message: msg });
  });

  app.get('/api/invoices/:id/print', async (c) => {
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
    // Secure HMAC QR payload (no expiry for printed archive documents)
    const secure = await makeSecureQrPayload(c.env, 'invoice', invoice.public_token, 0, c.env.DB);
    invoice.public_url = `${origin}/api/public/verify?p=${encodeURIComponent(secure)}`;
    invoice.public_token_raw = invoice.public_token;
    const st = invoice.status;
    let docTitle = 'FACTURE';
    if (st === 'quote' || st === 'devis') docTitle = 'DEVIS';
    else if (st === 'remboursement' || invoice.doc_kind === 'remboursement') docTitle = 'REMBOURSEMENT (WR)';
    else if (st === 'paid') docTitle = 'FACTURE';
    if (docTitle.includes('WR') && invoice.refund_of_invoice_id) {
      try {
        const src = await c.env.DB.prepare(`SELECT number FROM invoices WHERE id = ?`).bind(invoice.refund_of_invoice_id).first() as any;
        if (src?.number) invoice._source_number = src.number;
      } catch { /* */ }
    }
    return c.html(generateInvoiceHTML(settings, invoice, items as any[], docTitle));
  });


  app.post('/api/invoices/:id/request-delete-otp', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const id = c.req.param('id');
    const invoice = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first() as any;
    if (!invoice) return c.json({ success: false, error: 'Facture introuvable' }, 404);

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await c.env.DB.prepare(
      `INSERT INTO otp_codes (code, resource_type, resource_id, expires_at) VALUES (?, 'invoice', ?, ?)
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
        subject: `Code de suppression — Facture ${invoice.number}`,
        html: otpEmailHTML(otp, `Facture ${invoice.number}`, companyName),
        text: `Code de confirmation pour supprimer la facture ${invoice.number} : ${otp}. Ce code est valable 10 minutes.`,
      });
    } catch (e: any) {
      console.error('invoice request-delete-otp mail failed', String(e?.message || e));
      return c.json({ success: false, error: 'Impossible d\'envoyer le code par e-mail. Vérifiez la configuration Email Routing.' }, 500);
    }

    return c.json({ success: true, message: `Code envoyé à ${toAddr}. Vérifiez votre boîte de réception.` });
  });

  app.get('/api/invoices/:id/links', async (c) => {
    const id = c.req.param('id');
    const links = await getInvoiceLinks(c.env.DB, id);
    if (!links) return c.json({ success: false, error: 'Facture introuvable' }, 404);
    return c.json({
      success: true,
      data: {
        invoice: { id: links.invoice.id, number: links.invoice.number, status: links.invoice.status },
        payments_count: links.payments.length,
        receipts: links.receipts.map((r: any) => ({ id: r.id, number: r.number, amount: r.amount })),
        expenses: links.expenses.map((e: any) => ({ id: e.id, description: e.description, amount: e.amount })),
        disclaimer: links.receipts.length || links.expenses.length || links.payments.length
          ? 'La suppression de cette facture effacera aussi les reçus, paiements et écritures de solde liés.'
          : null,
      },
    });
  });

  app.delete('/api/invoices/:id', async (c) => {
    try {
      const gate = requireBizMutator(c);
      if (!gate.ok) return gate.response;
      const id = c.req.param('id');
      const body = await c.req.json().catch(() => ({}));
      const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
      if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);

      const links = await getInvoiceLinks(c.env.DB, id);
      if (!links) return c.json({ success: false, error: 'Facture introuvable' }, 404);

      await cascadeDeleteInvoice(c.env.DB, id, { createdBy: gate.username || undefined });
      await afterBusinessMutation(c.env.CACHE, c.env.MOBILE_HUB);

      await writeAudit(c.env.DB, {
        username: gate.username,
        role: gate.role,
        action: 'invoice.delete',
        entity: 'invoices',
        entity_id: id,
        detail: links.invoice.number || '',
        ip: c.req.header('cf-connecting-ip') || '',
      });

      const parts: string[] = [`Facture ${links.invoice.number}`];
      if (links.receipts.length) parts.push(`${links.receipts.length} reçu(s)`);
      if (links.expenses.length) parts.push(`${links.expenses.length} écriture(s) solde`);
      if (links.payments.length) parts.push(`${links.payments.length} paiement(s)`);

      const isWr =
        links.invoice.status === 'remboursement' || links.invoice.doc_kind === 'remboursement';
      const isVr =
        links.invoice.doc_kind === 'quick_sale' ||
        links.invoice.doc_kind === 'ticket' ||
        String(links.invoice.number || '').startsWith('VR');
      return c.json({
        success: true,
        message: isWr
          ? `Avoir ${links.invoice.number} supprimé — stock re-déduit, solde d’origine rétabli.`
          : isVr
            ? `Ticket ${links.invoice.number} supprimé — stock rétabli, paiements et reçus liés effacés.`
            : `Supprimé : ${parts.join(', ')}.`,
        deleted: {
          invoice: links.invoice.number,
          receipts: links.receipts.length,
          expenses: links.expenses.length,
          payments: links.payments.length,
          was_remboursement: isWr,
        },
      });
    } catch (e: any) {
      console.error('invoice delete', e);
      return c.json({ success: false, error: e?.message || 'Échec de la suppression', code: 'DELETE_FAILED' }, 400);
    }
  });

}
