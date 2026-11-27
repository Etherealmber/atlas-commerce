import type { Hono } from 'hono';
import { generateInvoiceEmailHTML } from '../lib/printTemplates';
import { doCacheGet, doCachePut, DEFAULT_CACHE_TTL } from '../lib/cache';
import { nextDocumentNumber } from '../lib/numbering';
import { assertSafeOutboundUrl } from '../lib/security';
import { ensureMailSchema } from './mailbox';
import { afterBusinessMutation } from '../lib/delete-coord';
import { countEmployeesPayDue } from './employees';
import { normalizeInventoryRole, roleCanSeeFinancial } from '../lib/inventory-policy';
import { recordMetricSnapshots, todayUtc } from './metrics';

interface DashboardIntegrityRouteDeps {
  requireOwner: (c: any) => any;
  requireBizMutator: (c: any) => any;
  requireEmployeeAdmin: (c: any) => any;
  requireFloorStock: (c: any) => any;
  sessionUserFromHeader: (header: string | undefined) => any;
  refreshLimitGate: (c: any, endpoint: string, maxPerMinute?: number) => Response | null;
  ensureCoreIndexes: (db: D1Database) => Promise<void>;
  ensurePaymentHistoryTable: (db: D1Database) => Promise<void>;
  ensureExpenseTypeColumn: (db: D1Database) => Promise<void>;
  ensureBillPaymentsTable: (db: D1Database) => Promise<void>;
  ensureIdempotencyTable: (db: D1Database) => Promise<void>;
  ensurePeriodLockColumn: (db: D1Database) => Promise<void>;
  ensureInvoiceRefundColumns: (db: D1Database) => Promise<void>;
  ensureValuationTables: (db: D1Database) => Promise<void>;
  getValuationMethod: (db: D1Database) => Promise<'average' | 'fifo' | 'standard'>;
  runAutoTransfers: (...args: any[]) => Promise<any>;
  applyStockDelta: (...args: any[]) => Promise<any>;
}

export function registerDashboardIntegrityRoutes(app: Hono<any>, deps: DashboardIntegrityRouteDeps): void {
  const {
    requireOwner,
    requireBizMutator,
    requireEmployeeAdmin,
    sessionUserFromHeader,
    refreshLimitGate,
    ensureCoreIndexes,
    ensurePaymentHistoryTable,
    ensureExpenseTypeColumn,
    ensureBillPaymentsTable,
    ensureIdempotencyTable,
    ensurePeriodLockColumn,
    ensureInvoiceRefundColumns,
    applyStockDelta,
  } = deps;

  /* ─── Dashboard ─── */
  
  /** Phase 0 — integrity snapshot (owner diagnostic, not cached). */
  app.get('/api/integrity/status', async (c) => {
    const role = normalizeInventoryRole(sessionUserFromHeader(c.req.header('Authorization')).role);
    if (!roleCanSeeFinancial(role)) {
      return c.json({ success: false, error: 'Accès réservé owner/admin.', code: 'FORBIDDEN_ROLE' }, 403);
    }
    try {
      await ensureInvoiceRefundColumns(c.env.DB);
      await ensurePaymentHistoryTable(c.env.DB);
      await ensureBillPaymentsTable(c.env.DB);
      await ensureIdempotencyTable(c.env.DB);
      await ensurePeriodLockColumn(c.env.DB);
      const negStock = await c.env.DB.prepare(
        `SELECT COUNT(*) as c FROM products WHERE is_active = 1 AND track_inventory = 1 AND stock_quantity < 0`
      ).first() as any;
      const wrCount = await c.env.DB.prepare(
        `SELECT COUNT(*) as c FROM invoices WHERE status = 'remboursement' OR doc_kind = 'remboursement'`
      ).first() as any;
      const dupNumbers = await c.env.DB.prepare(
        `SELECT number, COUNT(*) as c FROM invoices GROUP BY number HAVING c > 1 LIMIT 5`
      ).all();
      const payOnWr = await c.env.DB.prepare(
        `SELECT COUNT(*) as c FROM invoice_payments p
         INNER JOIN invoices i ON i.id = p.invoice_id
         WHERE i.status = 'remboursement' OR i.doc_kind = 'remboursement'`
      ).first() as any;
      const overpaidInv = await c.env.DB.prepare(
        `SELECT COUNT(*) as c FROM invoices
         WHERE status NOT IN ('cancelled', 'remboursement')
           AND COALESCE(doc_kind, '') != 'remboursement'
           AND (COALESCE(amount_paid, 0) > COALESCE(total, 0) + 0.01 OR COALESCE(amount_paid, 0) < -0.01)`
      ).first() as any;
      const overrefundedInv = await c.env.DB.prepare(
        `SELECT COUNT(*) as c FROM invoices src
         WHERE (
           SELECT COALESCE(SUM(wr.total), 0) FROM invoices wr
           WHERE wr.refund_of_invoice_id = src.id
             AND wr.status != 'cancelled'
             AND (wr.status = 'remboursement' OR COALESCE(wr.doc_kind,'') = 'remboursement' OR IFNULL(wr.number,'') LIKE 'WR-%')
         ) > COALESCE(src.total, 0) + 0.01`
      ).first() as any;
      const billMismatches = await c.env.DB.prepare(
        `SELECT COUNT(*) as c FROM bills b
         WHERE b.status != 'cancelled'
           AND EXISTS (SELECT 1 FROM bill_payments bp WHERE bp.bill_id = b.id)
           AND ABS(COALESCE(b.amount_paid, 0) - COALESCE((SELECT SUM(bp.amount) FROM bill_payments bp WHERE bp.bill_id = b.id), 0)) > 0.01`
      ).first() as any;
      const invPayMismatches = await c.env.DB.prepare(
        `SELECT COUNT(*) as c FROM invoices i
         WHERE i.status NOT IN ('cancelled', 'remboursement')
           AND COALESCE(i.doc_kind, '') != 'remboursement'
           AND NOT EXISTS (
             SELECT 1 FROM invoices wr
             WHERE wr.refund_of_invoice_id = i.id AND wr.status != 'cancelled'
           )
           AND EXISTS (SELECT 1 FROM invoice_payments p WHERE p.invoice_id = i.id AND IFNULL(p.note, '') NOT LIKE 'Avoir %')
           AND ABS(COALESCE(i.amount_paid, 0) - COALESCE((SELECT SUM(p.amount) FROM invoice_payments p WHERE p.invoice_id = i.id AND IFNULL(p.note, '') NOT LIKE 'Avoir %'), 0)) > 0.01`
      ).first() as any;
      const lock = await c.env.DB.prepare(`SELECT fiscal_locked_through FROM company_settings WHERE id = 1`).first() as any;
      return c.json({
        success: true,
        data: {
          negative_stock_products: Number(negStock?.c || 0),
          wr_documents: Number(wrCount?.c || 0),
          duplicate_invoice_numbers: (dupNumbers.results || []).length,
          payments_on_wr: Number(payOnWr?.c || 0),
          overpaid_invoices: Number(overpaidInv?.c || 0),
          overrefunded_invoices: Number(overrefundedInv?.c || 0),
          bill_payment_mismatches: Number(billMismatches?.c || 0),
          invoice_payment_mismatches: Number(invPayMismatches?.c || 0),
          fiscal_locked_through: lock?.fiscal_locked_through || null,
          atomic_stock: true,
          idempotency_table: true,
          phase: '0+1',
          ok:
            Number(negStock?.c || 0) === 0 &&
            (dupNumbers.results || []).length === 0 &&
            Number(payOnWr?.c || 0) === 0 &&
            Number(overpaidInv?.c || 0) === 0 &&
            Number(overrefundedInv?.c || 0) === 0 &&
            Number(billMismatches?.c || 0) === 0 &&
            Number(invPayMismatches?.c || 0) === 0,
        },
      });
    } catch (e: any) {
      console.error('integrity/status failed', e);
      return c.json({ success: false, error: 'Vérification d’intégrité indisponible' }, 500);
    }
  });
  
  /**
   * Phase 0 regression — owner only.
   * Creates ephemeral product + invoice + payment + WR (restock + no-restock) then cleans up.
   * Does not leave durable commercial data when successful.
   */
  app.post('/api/integrity/regression', async (c) => {
    const gate = requireOwner(c);
    if (!gate.ok) return gate.response;
    const steps: { name: string; ok: boolean; detail?: string }[] = [];
    const tag = `REG-${Date.now()}`;
    let productId = 0;
    let invoiceId = 0;
    let wrId = 0;
    try {
      await ensureIdempotencyTable(c.env.DB);
      await ensureInvoiceRefundColumns(c.env.DB);
      await ensurePaymentHistoryTable(c.env.DB);
  
      // 1) Product with stock 10
      const pr = await c.env.DB.prepare(
        `INSERT INTO products (sku, name, price, cost, stock_quantity, track_inventory, is_active, unit, category)
         VALUES (?, ?, 100, 40, 0, 1, 1, 'u', 'test')`
      ).bind(`SKU-${tag}`, `Produit ${tag}`).run();
      productId = Number(pr.meta.last_row_id);
      await applyStockDelta(c.env.DB, productId, 10, 'Regression seed', tag, { type: 'initial' });
      const st0 = await c.env.DB.prepare(`SELECT stock_quantity FROM products WHERE id = ?`).bind(productId).first() as any;
      steps.push({ name: 'seed_stock', ok: Number(st0?.stock_quantity) === 10, detail: String(st0?.stock_quantity) });
  
      // 2) Sale qty 5
      const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
      const number = await nextDocumentNumber(c.env.DB, 'invoice', settings, c.env);
      const invIns = await c.env.DB.prepare(
        `INSERT INTO invoices (number, client_name, issue_date, status, subtotal, tax_amount, total, amount_paid)
         VALUES (?, 'Client REG', date('now'), 'sent', 500, 0, 500, 0)`
      ).bind(number).run();
      invoiceId = Number(invIns.meta.last_row_id);
      await c.env.DB.prepare(
        `INSERT INTO invoice_items (invoice_id, product_id, product_name, sku, quantity, unit_price, tax_rate, line_total)
         VALUES (?, ?, ?, ?, 5, 100, 0, 500)`
      ).bind(invoiceId, productId, `Produit ${tag}`, `SKU-${tag}`).run();
      await applyStockDelta(c.env.DB, productId, -5, 'Facture', number, { type: 'sale' });
      const st1 = await c.env.DB.prepare(`SELECT stock_quantity FROM products WHERE id = ?`).bind(productId).first() as any;
      steps.push({ name: 'sale_stock_5', ok: Number(st1?.stock_quantity) === 5, detail: String(st1?.stock_quantity) });
  
      // 3) Oversell reject
      let oversellBlocked = false;
      try {
        await applyStockDelta(c.env.DB, productId, -99, 'Oversell test', tag, { type: 'sale' });
      } catch (e: any) {
        oversellBlocked = e?.code === 'INSUFFICIENT_STOCK';
      }
      steps.push({ name: 'oversell_blocked', ok: oversellBlocked });
  
      // 4) Payment
      await c.env.DB.prepare(
        `INSERT INTO invoice_payments (invoice_id, amount, payment_method, payee, note, paid_at)
         VALUES (?, 500, 'cash', 'company', 'REG pay', date('now'))`
      ).bind(invoiceId).run();
      await c.env.DB.prepare(`UPDATE invoices SET amount_paid = 500, status = 'paid' WHERE id = ?`).bind(invoiceId).run();
      steps.push({ name: 'payment', ok: true });
  
      // 5) WR restock 2
      const wrNum = await nextDocumentNumber(c.env.DB, 'credit_note', settings, c.env);
      const wrIns = await c.env.DB.prepare(
        `INSERT INTO invoices (number, client_name, issue_date, status, subtotal, tax_amount, total, amount_paid, doc_kind, refund_of_invoice_id)
         VALUES (?, 'Client REG', date('now'), 'remboursement', 200, 0, 200, 0, 'remboursement', ?)`
      ).bind(wrNum, invoiceId).run();
      wrId = Number(wrIns.meta.last_row_id);
      await c.env.DB.prepare(
        `INSERT INTO invoice_items (invoice_id, product_id, product_name, sku, quantity, unit_price, tax_rate, line_total)
         VALUES (?, ?, ?, ?, 2, 100, 0, 200)`
      ).bind(wrId, productId, `Produit ${tag}`, `src_item:0|restock:1`).run();
      await applyStockDelta(c.env.DB, productId, 2, `WR ${wrNum} — retour stock`, wrNum, { type: 'refund_restock' });
      const st2 = await c.env.DB.prepare(`SELECT stock_quantity FROM products WHERE id = ?`).bind(productId).first() as any;
      steps.push({ name: 'wr_restock', ok: Number(st2?.stock_quantity) === 7, detail: String(st2?.stock_quantity) });
  
      // 6) Delete WR reverses restock
      await applyStockDelta(c.env.DB, productId, -2, 'WR deleted', wrNum, { type: 'sale' });
      await c.env.DB.prepare(`DELETE FROM invoice_items WHERE invoice_id = ?`).bind(wrId).run();
      await c.env.DB.prepare(`DELETE FROM invoices WHERE id = ?`).bind(wrId).run();
      wrId = 0;
      const st3 = await c.env.DB.prepare(`SELECT stock_quantity FROM products WHERE id = ?`).bind(productId).first() as any;
      steps.push({ name: 'wr_delete_reverse', ok: Number(st3?.stock_quantity) === 5, detail: String(st3?.stock_quantity) });
  
      // Cleanup invoice + product
      await c.env.DB.prepare(`DELETE FROM invoice_payments WHERE invoice_id = ?`).bind(invoiceId).run();
      await c.env.DB.prepare(`DELETE FROM invoice_items WHERE invoice_id = ?`).bind(invoiceId).run();
      await c.env.DB.prepare(`DELETE FROM invoices WHERE id = ?`).bind(invoiceId).run();
      invoiceId = 0;
      await applyStockDelta(c.env.DB, productId, -Number(st3?.stock_quantity || 0), 'REG cleanup', tag, { allowNegative: true, type: 'adjustment' });
      await c.env.DB.prepare(`DELETE FROM stock_movements WHERE product_id = ?`).bind(productId).run();
      await c.env.DB.prepare(`DELETE FROM products WHERE id = ?`).bind(productId).run();
      productId = 0;
  
      const allOk = steps.every((s) => s.ok);
      return c.json({ success: allOk, data: { steps, tag }, message: allOk ? 'Regression OK' : 'Regression FAILED' }, allOk ? 200 : 500);
    } catch (e: any) {
      // best-effort cleanup
      try {
        if (wrId) {
          await c.env.DB.prepare(`DELETE FROM invoice_items WHERE invoice_id = ?`).bind(wrId).run();
          await c.env.DB.prepare(`DELETE FROM invoices WHERE id = ?`).bind(wrId).run();
        }
        if (invoiceId) {
          await c.env.DB.prepare(`DELETE FROM invoice_payments WHERE invoice_id = ?`).bind(invoiceId).run();
          await c.env.DB.prepare(`DELETE FROM invoice_items WHERE invoice_id = ?`).bind(invoiceId).run();
          await c.env.DB.prepare(`DELETE FROM invoices WHERE id = ?`).bind(invoiceId).run();
        }
        if (productId) {
          await c.env.DB.prepare(`DELETE FROM stock_movements WHERE product_id = ?`).bind(productId).run();
          await c.env.DB.prepare(`DELETE FROM products WHERE id = ?`).bind(productId).run();
        }
      } catch { /* */ }
      return c.json({ success: false, error: e?.message || 'regression failed', steps }, 500);
    }
  });
  
  /** Phase 1 — period lock */
  app.get('/api/fiscal/period-lock', async (c) => {
    await ensurePeriodLockColumn(c.env.DB);
    const row = await c.env.DB.prepare(`SELECT fiscal_locked_through FROM company_settings WHERE id = 1`).first() as any;
    return c.json({ success: true, data: { fiscal_locked_through: row?.fiscal_locked_through || null } });
  });
  
  app.put('/api/fiscal/period-lock', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    await ensurePeriodLockColumn(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    let through = String(body.fiscal_locked_through || body.locked_through || '').trim();
    if (through && !/^\d{4}-\d{2}$/.test(through)) {
      return c.json({ success: false, error: 'Format attendu : YYYY-MM (ex. 2026-07)', code: 'INVALID_PERIOD' }, 400);
    }
    if (body.clear) through = '';
    await c.env.DB.prepare(`UPDATE company_settings SET fiscal_locked_through = ? WHERE id = 1`).bind(through).run();
    await afterBusinessMutation(c.env.CACHE, c.env.MOBILE_HUB);
    return c.json({
      success: true,
      data: { fiscal_locked_through: through || null },
      message: through ? `Période clôturée jusqu’à ${through}` : 'Clôture fiscale annulée',
    });
  });
  
  /** Phase 1 — client aging */
  
  
  /** Lightweight counts for sidebar / phone nav badges */
  app.get('/api/nav-badges', async (c) => {
    const limited = refreshLimitGate(c, 'nav-badges', 45);
    if (limited) return limited;
    try {
      const canSeePayroll = !(await requireEmployeeAdmin(c));
      const NAV_BADGES_TTL = 300;
      const cached = await doCacheGet<any>(c.env.MOBILE_HUB, c.env.CACHE, 'nav-badges', NAV_BADGES_TTL);
      if (cached) {
        return c.json({ success: true, data: canSeePayroll ? cached : { ...cached, employees_pay_due: 0 }, meta: { cache: 'hit' } }, 200, {
          'Cache-Control': 'private, max-age=60',
        });
      }
      await ensureCoreIndexes(c.env.DB);
      const [invRow, billRow, lowStock, pendingActions, employees_pay_due] = await Promise.all([
        c.env.DB.prepare(
          `SELECT
             COALESCE(SUM(CASE
               WHEN status NOT IN ('quote','devis','cancelled','remboursement','paid')
                AND COALESCE(doc_kind,'') NOT IN ('remboursement','quick_sale','ticket')
                AND IFNULL(number,'') NOT LIKE 'VR-%'
                AND IFNULL(number,'') NOT LIKE 'VR/%'
                AND (total - COALESCE(amount_paid, 0)) > 0.001
               THEN 1 ELSE 0 END), 0) AS invoices_unpaid,
             COALESCE(SUM(CASE
               WHEN status IN ('quote','devis')
               THEN 1 ELSE 0 END), 0) AS quotes_open,
             COALESCE(SUM(CASE
               WHEN status NOT IN ('cancelled','paid')
                AND (COALESCE(doc_kind,'') IN ('quick_sale','ticket') OR IFNULL(number,'') LIKE 'VR-%' OR IFNULL(number,'') LIKE 'VR/%')
                AND (total - COALESCE(amount_paid, 0)) > 0.001
               THEN 1 ELSE 0 END), 0) AS vr_open
           FROM invoices`
        ).first().catch(() => ({ invoices_unpaid: 0, quotes_open: 0, vr_open: 0 })) as Promise<any>,
        c.env.DB.prepare(
          `SELECT
             COALESCE(SUM(CASE
               WHEN status NOT IN ('cancelled','paid')
                AND (total - COALESCE(amount_paid, 0)) > 0.001
               THEN 1 ELSE 0 END), 0) AS bills_unpaid,
             COALESCE(SUM(CASE
               WHEN status NOT IN ('cancelled')
                AND COALESCE(receive_status, 'pending') IN ('pending', 'partial')
               THEN 1 ELSE 0 END), 0) AS bills_receive
           FROM bills`
        ).first().catch(() => ({ bills_unpaid: 0, bills_receive: 0 })) as Promise<any>,
        c.env.DB.prepare(
          `SELECT COUNT(*) as n FROM products
           WHERE is_active = 1 AND track_inventory = 1
             AND stock_quantity <= COALESCE(low_stock_threshold, 0)`
        ).first().catch(() => ({ n: 0 })) as Promise<any>,
        c.env.DB.prepare(
          `SELECT COUNT(*) as n FROM mobile_actions WHERE status = 'pending'`
        ).first().catch(() => ({ n: 0 })) as Promise<any>,
        countEmployeesPayDue(c.env.DB).catch(() => 0),
      ]);
  
      const data = {
        invoices_unpaid: Number(invRow?.invoices_unpaid || 0),
        bills_unpaid: Number(billRow?.bills_unpaid || 0),
        bills_receive: Number(billRow?.bills_receive || 0),
        products_low: Number(lowStock?.n || 0),
        actions_pending: Number(pendingActions?.n || 0),
        quotes_open: Number(invRow?.quotes_open || 0),
        vr_open: Number(invRow?.vr_open || 0),
        employees_pay_due: Number(employees_pay_due || 0),
      };
      await doCachePut(c.env.MOBILE_HUB, c.env.CACHE, 'nav-badges', data, NAV_BADGES_TTL);
      return c.json({ success: true, data: canSeePayroll ? data : { ...data, employees_pay_due: 0 } }, 200, { 'Cache-Control': 'private, max-age=60' });
    } catch (e: any) {
      console.error('nav-badges', e);
      return c.json({
        success: true,
        data: {
          invoices_unpaid: 0,
          bills_unpaid: 0,
          bills_receive: 0,
          products_low: 0,
          actions_pending: 0,
          quotes_open: 0,
          vr_open: 0,
          employees_pay_due: 0,
        },
      });
    }
  });
  
  app.get('/api/dashboard', async (c) => {
    const limited = refreshLimitGate(c, 'dashboard', 45);
    if (limited) return limited;
    // v0.7.1 — inventory privacy: non-financial roles get an operational
    // dashboard (counts + low-stock basics), never money aggregates.
    const dashRole = normalizeInventoryRole(sessionUserFromHeader(c.req.header('Authorization')).role);
    if (!roleCanSeeFinancial(dashRole)) {
      const [counts, low] = await Promise.all([
        c.env.DB.prepare(`SELECT COUNT(*) as count FROM products WHERE is_active = 1`).first(),
        c.env.DB
          .prepare(
            `SELECT id, sku, name, barcode, category, unit, stock_quantity, low_stock_threshold, track_inventory
             FROM products WHERE is_active = 1 AND track_inventory = 1 AND stock_quantity <= low_stock_threshold
             ORDER BY name LIMIT 50`,
          )
          .all(),
      ]);
      return c.json({
        success: true,
        data: {
          operational_only: true,
          role: dashRole,
          products: (counts as any)?.count ?? 0,
          low_stock: (low as any)?.results || [],
        },
        meta: { privacy: 'inventory-policy' },
      });
    }
    // DO + memory cache reduces D1 reads & avoids KV write limits.
    const ttl = Math.max(120, Math.min(1800, Number(c.env.CACHE_TTL_SECONDS || DEFAULT_CACHE_TTL)));
    const cached = await doCacheGet<any>(c.env.MOBILE_HUB, c.env.CACHE, 'dash', ttl);
    if (cached) {
      return c.json({ success: true, data: cached, meta: { cache: 'hit' } });
    }
  
    await ensureCoreIndexes(c.env.DB);
    await ensurePaymentHistoryTable(c.env.DB);
    await ensureInvoiceRefundColumns(c.env.DB);
    await ensureExpenseTypeColumn(c.env.DB);
  
    const [settings, prodAgg, invAgg, billAgg] = await Promise.all([
      c.env.DB.prepare(`SELECT starting_balance, currency FROM company_settings WHERE id = 1`).first() as Promise<any>,
      c.env.DB.prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END), 0) as count,
           COALESCE(SUM(CASE WHEN is_active = 1 THEN stock_quantity * cost ELSE 0 END), 0) as stock_value,
           COALESCE(SUM(CASE WHEN is_active = 1 AND track_inventory = 1 AND stock_quantity <= low_stock_threshold THEN 1 ELSE 0 END), 0) as low_stock_count
         FROM products`
      ).first() as Promise<any>,
      c.env.DB.prepare(
        `SELECT
           COALESCE(SUM(CASE
             WHEN status IN ('sent', 'partial', 'overdue', 'draft')
              AND status NOT IN ('quote', 'devis', 'cancelled', 'remboursement')
              AND COALESCE(doc_kind, '') != 'remboursement'
             THEN 1 ELSE 0 END), 0) as unpaid_count,
           COALESCE(SUM(CASE
             WHEN status IN ('sent', 'partial', 'overdue', 'draft')
              AND status NOT IN ('quote', 'devis', 'cancelled', 'remboursement')
              AND COALESCE(doc_kind, '') != 'remboursement'
             THEN (total - COALESCE(amount_paid, 0)) ELSE 0 END), 0) as unpaid_total,
           COALESCE(SUM(CASE
             WHEN status IN ('sent', 'partial', 'draft')
              AND status NOT IN ('quote', 'devis', 'cancelled', 'remboursement')
              AND COALESCE(doc_kind, '') != 'remboursement'
              AND (due_date IS NULL OR due_date >= date('now'))
             THEN (total - COALESCE(amount_paid, 0)) ELSE 0 END), 0) as open_total,
           COALESCE(SUM(CASE
             WHEN status IN ('sent', 'partial', 'overdue')
              AND status NOT IN ('quote', 'devis', 'cancelled', 'remboursement')
              AND COALESCE(doc_kind, '') != 'remboursement'
              AND due_date IS NOT NULL AND due_date < date('now')
             THEN (total - COALESCE(amount_paid, 0)) ELSE 0 END), 0) as overdue_total,
           COALESCE(SUM(CASE
             WHEN status = 'remboursement' OR doc_kind = 'remboursement'
             THEN total ELSE 0 END), 0) as refunds_total
         FROM invoices`
      ).first() as Promise<any>,
      c.env.DB.prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status IN ('sent', 'partial', 'draft') THEN 1 ELSE 0 END), 0) as unpaid_count,
           COALESCE(SUM(CASE WHEN status IN ('sent', 'partial', 'draft') THEN (total - COALESCE(amount_paid, 0)) ELSE 0 END), 0) as unpaid_total,
           COALESCE(SUM(CASE WHEN status IN ('sent', 'partial', 'draft') AND (due_date IS NULL OR due_date >= date('now')) THEN (total - COALESCE(amount_paid, 0)) ELSE 0 END), 0) as open_total,
           COALESCE(SUM(CASE WHEN status IN ('sent', 'partial', 'draft') AND due_date IS NOT NULL AND due_date < date('now') THEN (total - COALESCE(amount_paid, 0)) ELSE 0 END), 0) as overdue_total,
           COALESCE(SUM(CASE WHEN status IN ('paid', 'partial') THEN amount_paid ELSE 0 END), 0) as paid_total
         FROM bills`
      ).first() as Promise<any>,
    ]);
  
    // Entrées ventes = vrais encaissements uniquement (pas les avoirs WR, pas les lignes « Avoir … »)
    // Single-pass query used for both salesReceivedNet and monthly salesMap
    let salesReceivedNet = 0;
    let salesByMonth: { results?: any[] } = { results: [] };
    try {
      salesByMonth = await c.env.DB.prepare(
        `SELECT substr(replace(COALESCE(p.paid_at, p.created_at, ''), 'T', ' '), 1, 7) as ym, COALESCE(SUM(p.amount), 0) as total
         FROM invoice_payments p
         INNER JOIN invoices i ON i.id = p.invoice_id
         WHERE COALESCE(i.status, '') NOT IN ('quote', 'devis', 'cancelled', 'remboursement')
           AND COALESCE(i.doc_kind, '') != 'remboursement'
           AND COALESCE(p.note, '') NOT LIKE 'Avoir %'
         GROUP BY ym`
      ).all();
    } catch {
      salesByMonth = await c.env.DB.prepare(
        `SELECT substr(replace(COALESCE(issue_date, created_at, ''), 'T', ' '), 1, 7) as ym, COALESCE(SUM(amount_paid), 0) as total
         FROM invoices
         WHERE status IN ('paid', 'partial')
           AND COALESCE(status, '') != 'remboursement'
           AND COALESCE(doc_kind, '') != 'remboursement'
         GROUP BY ym`
      ).all();
    }
    for (const r of (salesByMonth.results || []) as any[]) {
      salesReceivedNet += Number(r.total || 0);
    }
  
    // Single-pass expenses monthly + totals query (replaces 9 separate scans)
    const expByMonth = await c.env.DB.prepare(
      `SELECT
         substr(replace(COALESCE(expense_date, created_at, ''), 'T', ' '), 1, 7) as ym,
         COALESCE(SUM(CASE WHEN COALESCE(entry_type, 'expense') = 'expense' THEN amount ELSE 0 END), 0) as expense_total,
         COALESCE(SUM(CASE WHEN entry_type = 'income' AND COALESCE(category, '') != 'Encaissement client' THEN amount ELSE 0 END), 0) as income_total,
         COALESCE(SUM(CASE WHEN entry_type = 'owner_draw' THEN amount ELSE 0 END), 0) as owner_draw_total,
         COALESCE(SUM(CASE WHEN entry_type = 'owner_contrib' THEN amount ELSE 0 END), 0) as owner_contrib_total,
         COALESCE(SUM(CASE WHEN COALESCE(entry_type, 'expense') = 'expense' AND (category = 'Salaire' OR notes LIKE 'employee_id:%') THEN amount ELSE 0 END), 0) as salary_total
       FROM expenses
       GROUP BY ym`
    ).all().catch(() => ({ results: [] }));
  
    let expensesSum = 0;
    let otherIncomeSum = 0;
    let ownerDrawSum = 0;
    let ownerContribSum = 0;
    const salesMap: Record<string, number> = {};
    const spendMap: Record<string, number> = {};
    const salaryMap: Record<string, number> = {};
    const ownerContribMap: Record<string, number> = {};
    const ownerDrawMap: Record<string, number> = {};
    for (const r of (expByMonth.results || []) as any[]) {
      const exp = Number(r.expense_total || 0);
      const inc = Number(r.income_total || 0);
      const draw = Number(r.owner_draw_total || 0);
      const contrib = Number(r.owner_contrib_total || 0);
      const sal = Number(r.salary_total || 0);
      expensesSum += exp;
      otherIncomeSum += inc;
      ownerDrawSum += draw;
      ownerContribSum += contrib;
      if (r.ym) {
        salesMap[r.ym] = (salesMap[r.ym] || 0) + inc + contrib;
        spendMap[r.ym] = (spendMap[r.ym] || 0) + exp + draw;
        if (sal) salaryMap[r.ym] = sal;
        if (contrib) ownerContribMap[r.ym] = contrib;
        if (draw) ownerDrawMap[r.ym] = draw;
      }
    }
  
    const starting = settings?.starting_balance || 0;
    // Remboursements client (expense) sortent déjà du solde ; les WR ne sont jamais des entrées.
    const balance = starting
      + salesReceivedNet
      + otherIncomeSum
      + ownerContribSum
      - Number(billAgg?.paid_total || 0)
      - expensesSum
      - ownerDrawSum;
    const recentInvoices = await c.env.DB.prepare(`SELECT * FROM invoices ORDER BY created_at DESC LIMIT 5`).all();
    const recentBills = await c.env.DB.prepare(`SELECT * FROM bills ORDER BY created_at DESC LIMIT 5`).all();
    const recentExpenses = await c.env.DB.prepare(`SELECT * FROM expenses ORDER BY expense_date DESC LIMIT 8`).all();
    const unpaidInvoiceList = await c.env.DB.prepare(`SELECT id, number, client_name, issue_date, due_date, total, amount_paid, status FROM invoices WHERE status IN ('sent', 'partial', 'overdue', 'draft') AND status NOT IN ('quote', 'devis', 'remboursement') AND COALESCE(doc_kind, '') != 'remboursement' ORDER BY due_date ASC NULLS LAST, issue_date ASC LIMIT 10`).all();
    const unpaidBillList = await c.env.DB.prepare(`SELECT id, number, vendor_name, issue_date, due_date, total, amount_paid, status FROM bills WHERE status IN ('sent', 'partial', 'draft') ORDER BY due_date ASC NULLS LAST, issue_date ASC LIMIT 10`).all();
  
    // Up to 36 months so chart presets (1m / 6m / 1y / 2y / ytd) always have points
    const monthKeys: string[] = [];
    const monthLabels: string[] = [];
    const frMonths = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
    const now = new Date();
    for (let i = 35; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      monthKeys.push(key);
      monthLabels.push(`${frMonths[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`);
    }
    for (const r of (salesByMonth.results || []) as any[]) {
      if (r.ym) salesMap[r.ym] = (salesMap[r.ym] || 0) + Number(r.total || 0);
    }
  
    // Single-pass bills monthly query (purchasesPaidByMonth + billMap)
    const billsMonthly = await c.env.DB.prepare(
      `SELECT
         substr(replace(COALESCE(issue_date, created_at, ''), 'T', ' '), 1, 7) as ym,
         COALESCE(SUM(CASE WHEN status IN ('paid', 'partial') THEN amount_paid ELSE 0 END), 0) as paid_total,
         COALESCE(SUM(CASE WHEN status NOT IN ('cancelled') THEN total ELSE 0 END), 0) as billed_total
       FROM bills
       GROUP BY ym`
    ).all().catch(() => ({ results: [] }));
    const billMap: Record<string, number> = {};
    for (const r of (billsMonthly.results || []) as any[]) {
      if (!r.ym) continue;
      spendMap[r.ym] = (spendMap[r.ym] || 0) + Number(r.paid_total || 0);
      billMap[r.ym] = Number(r.billed_total || 0);
    }
  
    // Single-pass invoices monthly breakdown (faMap + vrMap)
    const faMap: Record<string, number> = {};
    const vrMap: Record<string, number> = {};
    const invMonthly = await c.env.DB.prepare(
      `SELECT
         substr(replace(COALESCE(issue_date, created_at, ''), 'T', ' '), 1, 7) as ym,
         COALESCE(SUM(CASE
           WHEN status NOT IN ('cancelled','quote','devis','remboursement')
            AND COALESCE(doc_kind,'') NOT IN ('quick_sale','ticket','remboursement')
            AND IFNULL(number,'') NOT LIKE 'VR-%' AND IFNULL(number,'') NOT LIKE 'VR/%'
           THEN total ELSE 0 END), 0) as fa_total,
         COALESCE(SUM(CASE
           WHEN status NOT IN ('cancelled')
            AND (COALESCE(doc_kind,'') IN ('quick_sale','ticket') OR IFNULL(number,'') LIKE 'VR-%' OR IFNULL(number,'') LIKE 'VR/%')
           THEN total ELSE 0 END), 0) as vr_total
       FROM invoices
       GROUP BY ym`
    ).all().catch(() => ({ results: [] }));
    for (const r of (invMonthly.results || []) as any[]) {
      if (!r.ym) continue;
      faMap[r.ym] = Number(r.fa_total || 0);
      vrMap[r.ym] = Number(r.vr_total || 0);
    }
  
    const clientMap: Record<string, number> = {};
    const receiptMap: Record<string, number> = {};
    try {
      const cl = await c.env.DB.prepare(
        `SELECT substr(replace(COALESCE(created_at, ''), 'T', ' '), 1, 7) as ym, COUNT(*) as total FROM clients GROUP BY ym`
      ).all();
      for (const r of (cl.results || []) as any[]) clientMap[r.ym] = Number(r.total || 0);
    } catch { /* */ }
    try {
      const rc = await c.env.DB.prepare(
        `SELECT substr(replace(COALESCE(p.paid_at, p.created_at, ''), 'T', ' '), 1, 7) as ym, COALESCE(SUM(p.amount),0) as total
         FROM invoice_payments p
         INNER JOIN invoices i ON i.id = p.invoice_id
         WHERE COALESCE(i.status, '') NOT IN ('quote', 'devis', 'cancelled', 'remboursement')
           AND COALESCE(i.doc_kind, '') != 'remboursement'
           AND COALESCE(p.note, '') NOT LIKE 'Avoir %'
         GROUP BY ym`
      ).all();
      for (const r of (rc.results || []) as any[]) receiptMap[r.ym] = Number(r.total || 0);
    } catch { /* */ }
  
    const monthlySeries = monthKeys.map((k, i) => ({
      key: k,
      label: monthLabels[i],
      sales: salesMap[k] || 0,
      expenses: spendMap[k] || 0,
      profit: (salesMap[k] || 0) - (spendMap[k] || 0),
      income: salesMap[k] || 0,
      expense: spendMap[k] || 0,
      salaries: salaryMap[k] || 0,
      invoices_fa: faMap[k] || 0,
      sales_vr: vrMap[k] || 0,
      bills: billMap[k] || 0,
      clients_new: clientMap[k] || 0,
      receipts: receiptMap[k] || 0,
      owner_contrib: ownerContribMap[k] || 0,
      owner_draw: ownerDrawMap[k] || 0,
    }));
    // Charges only: never mix income rows (e.g. Encaissement client) into expense breakdown
    const expenseCats = await c.env.DB.prepare(
      `SELECT COALESCE(category, 'Autre') as category, COALESCE(SUM(amount), 0) as total
       FROM expenses
       WHERE COALESCE(entry_type, 'expense') = 'expense'
       GROUP BY category
       ORDER BY total DESC
       LIMIT 8`
    ).all();
  
    const payload = {
        currency: settings?.currency || 'MAD',
        startingBalance: starting,
        currentBalance: balance,
        productCount: Number(prodAgg?.count || 0),
        stockValue: Number(prodAgg?.stock_value || 0),
        lowStockCount: Number(prodAgg?.low_stock_count || 0),
        unpaidSales: {
          count: Number(invAgg?.unpaid_count || 0),
          total: Number(invAgg?.unpaid_total || 0),
          open: Number(invAgg?.open_total || 0),
          overdue: Number(invAgg?.overdue_total || 0),
        },
        unpaidPurchases: {
          count: Number(billAgg?.unpaid_count || 0),
          total: Number(billAgg?.unpaid_total || 0),
          open: Number(billAgg?.open_total || 0),
          overdue: Number(billAgg?.overdue_total || 0),
        },
        salesReceived: salesReceivedNet,
        refundsTotal: Number(invAgg?.refunds_total || 0),
        purchasesPaid: Number(billAgg?.paid_total || 0),
        expensesTotal: expensesSum,
        otherIncomeTotal: otherIncomeSum,
        ownerDrawTotal: ownerDrawSum,
        ownerContribTotal: ownerContribSum,
        recentInvoices: recentInvoices.results || [],
        recentBills: recentBills.results || [],
        recentExpenses: recentExpenses.results || [],
        unpaidInvoiceList: unpaidInvoiceList.results || [],
        unpaidBillList: unpaidBillList.results || [],
        monthlySeries,
        expenseCategories: (expenseCats.results || []).map((r: any) => ({
          category: r.category,
          total: Number(r.total || 0),
        })),
        expenseByCategory: (expenseCats.results || []).map((r: any) => ({
          category: r.category,
          total: Number(r.total || 0),
        })),
      };
    await doCachePut(c.env.MOBILE_HUB, c.env.CACHE, 'dash', payload, ttl);
    // KPI sparklines: the cash balance only exists as a computed total, so keep
    // one value per day for the « Solde actuel » card (best effort).
    try {
      await recordMetricSnapshots(c.env.DB, todayUtc(), { balance });
    } catch { /* metric_snapshots missing on an old tenant — card shows « Aucune donnée » */ }
    return c.json({
      success: true,
      data: payload,
      meta: { cache: 'miss' },
    });
  });
  
  /* ─── Send Invoice Email ─── */
  
  app.post('/api/invoices/:id/send-email', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const to = String(body.to || '').trim();
    if (!to || !to.includes('@')) {
      return c.json({ success: false, error: 'Adresse e-mail du destinataire invalide' }, 400);
    }
    const apiKey = c.env.RESEND_API_KEY;
    if (!apiKey) {
      return c.json({ success: false, error: 'L\'envoi d\'e-mails n\'est pas disponible. Veuillez contacter l\'administrateur.', code: 'EMAIL_NOT_CONFIGURED' }, 503);
    }
    const invoice = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first() as any;
    if (!invoice) return c.json({ success: false, error: 'Facture introuvable' }, 404);
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const { results: items } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).bind(id).all();
    const from = c.env.RESEND_FROM || 'onboarding@resend.dev';
    const company = settings?.company_name || 'Company';
    const html = generateInvoiceEmailHTML(settings, invoice, items as any[], company);
    const resendUrl = assertSafeOutboundUrl('https://api.resend.com/emails');
    const res = await fetch(resendUrl.toString(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: `Facture ${invoice.number} — ${company}`, html }),
    });
    const data = await res.json().catch(() => ({})) as any;
    if (!res.ok) {
      return c.json({ success: false, error: data.message || 'Échec de l\'envoi via Resend', details: data }, 502);
    }
    try { await ensureMailSchema(c.env.DB); } catch { /* table optional */ }
    try {
      await c.env.DB.prepare(
        `INSERT INTO mail_messages (direction, mailbox, from_addr, to_addr, subject, body_html, resend_id, status, meta_json)
         VALUES ('out', ?, ?, ?, ?, ?, ?, 'sent', ?)`
      ).bind(
        from.includes('afmarbre') ? from : 'admin@afmarbre.com',
        from,
        to,
        `Facture ${invoice.number} — ${company}`,
        html.slice(0, 200000),
        String(data.id || ''),
        JSON.stringify({ type: 'invoice', invoice_id: id }),
      ).run();
    } catch { /* */ }
    return c.json({ success: true, data: { id: data.id, to } });
  });
  
  
}
