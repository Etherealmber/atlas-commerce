import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('../lib/reliability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/reliability')>()),
  proactiveFtsHealth: async () => {},
  ensureProductSearchIndex: async () => false,
}));
import { readFileSync } from 'node:fs';
import {
  addMoneyAmounts,
  aggregateDocumentTotals,
  applyBulkDiscount,
  computeBillLine,
  computeInventoryValuation,
  computeInvoiceLine,
  computeInvoiceLinesAndTotals,
  computeMovingAverageCost,
  computePaymentApplication,
  computeRefundSplit,
  convertCurrency,
  FINANCE_CORE_CONTRACT_VERSION,
  fmtMoney,
  fromMinorUnits,
  getCurrencySpec,
  remainingBalance,
  round2,
  roundDh,
  roundMoneyForCurrency,
  sanitizeFiniteNumber,
  sanitizeNonNegativeAmount,
  sanitizePositiveAmount,
  subMoneyAmounts,
  sumMoneyAmounts,
  toMinorUnits,
} from '../../shared/financeCore';

const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };
const { default: app } = await import('../index');

function seededRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

describe('shared/financeCore — monetary integrity & edge cases', () => {
  it('exports stable contract version', () => {
    expect(FINANCE_CORE_CONTRACT_VERSION).toBe('1.0.0');
  });

  it('eliminates IEEE-754 half-up drift on 1.005, 0.1+0.2, and fractional sums', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(-1.005)).toBe(-1);
    expect(round2(-2.675)).toBe(-2.67);
    expect(addMoneyAmounts(0.1, 0.2, 'EUR')).toBe(0.3);
    expect(sumMoneyAmounts([0.1, 0.2, 0.3, 0.4, 0.005], 'EUR')).toBe(1.01);
    expect(subMoneyAmounts(100, 99.9, 'EUR')).toBe(0.1);
  });

  it('supports MAD whole-dirham invoice policy and non-2-decimal currencies', () => {
    expect(getCurrencySpec('DH').code).toBe('MAD');
    expect(getCurrencySpec('TND').minorDecimals).toBe(3);
    expect(getCurrencySpec('KWD').minorDecimals).toBe(3);
    expect(getCurrencySpec('JPY').minorDecimals).toBe(0);

    expect(toMinorUnits(12.345, 'TND')).toBe(12345);
    expect(fromMinorUnits(12345, 'TND')).toBe(12.345);
    expect(roundMoneyForCurrency(12.3455, 'TND')).toBe(12.346);
    expect(roundMoneyForCurrency(1549.5, 'JPY')).toBe(1550);
    expect(roundDh(115.49)).toBe(115);
    expect(roundDh(115.5)).toBe(116);
    expect(fmtMoney(12.345, 'TND')).toContain('DT');
  });

  it('handles currency conversions deterministically without drift', () => {
    expect(convertCurrency(100, 'EUR', 'MAD', 10.875)).toBe(1087.5);
    expect(convertCurrency(100, 'USD', 'TND', 3.1234)).toBe(312.34);
    expect(convertCurrency(Number.NaN, 'EUR', 'MAD', 10)).toBe(0);
    expect(convertCurrency(100, 'EUR', 'MAD', -1)).toBe(0);
  });

  it('computes VAT inclusive vs exclusive, tax_exempt, and VR quick-sale lines', () => {
    const exclusive = computeInvoiceLine({
      quantity: 2,
      unitPrice: 100,
      listPrice: 120,
      defaultTax: 20,
      pricesTtc: false,
      isQuickSale: false,
      taxExempt: false,
      explicitInclusive: false,
      currency: 'MAD',
    });
    expect(exclusive.stored_unit_price).toBe(100);
    expect(exclusive.line_ht).toBe(200);
    expect(exclusive.line_tax_real).toBe(40);
    expect(exclusive.line_total).toBe(240);
    expect(exclusive.discount_amount).toBe(40);

    const inclusive = computeInvoiceLine({
      quantity: 1,
      unitPrice: 120,
      listPrice: 120,
      defaultTax: 20,
      pricesTtc: true,
      isQuickSale: false,
      taxExempt: false,
      explicitInclusive: false,
      currency: 'MAD',
    });
    expect(inclusive.stored_unit_price).toBe(100);
    expect(inclusive.line_ht).toBe(100);
    expect(inclusive.line_tax_real).toBe(20);
    expect(inclusive.line_total).toBe(120);

    const vr = computeInvoiceLine({
      quantity: 3,
      unitPrice: 150,
      listPrice: 150,
      taxRate: 20,
      defaultTax: 20,
      pricesTtc: false,
      isQuickSale: true,
      taxExempt: false,
      explicitInclusive: false,
    });
    expect(vr.tax_rate).toBe(0);
    expect(vr.line_tax_real).toBe(0);
    expect(vr.line_total).toBe(450);
  });

  it('handles fractional quantities, bulk discounts, and large totals', () => {
    const bulk = applyBulkDiscount(200, 15, JSON.stringify([{ min_qty: 10, percent: 12.5 }]));
    expect(bulk.bulk_percent).toBe(12.5);
    expect(bulk.unit_price).toBe(175);

    const frac = computeInvoiceLine({
      quantity: 1.375,
      unitPrice: 245.5,
      listPrice: 245.5,
      defaultTax: 20,
      pricesTtc: false,
      isQuickSale: false,
      taxExempt: false,
      explicitInclusive: false,
      currency: 'EUR',
    });
    expect(frac.line_ht).toBe(337.5625);
    const aggEur = aggregateDocumentTotals([frac], 'EUR');
    expect(aggEur.subtotal).toBe(337.56);
    expect(aggEur.tax_amount).toBe(67.51);
    expect(aggEur.total).toBe(405.07);

    const large = computeInvoiceLine({
      quantity: 10_000,
      unitPrice: 1_234.56,
      listPrice: 1_234.56,
      defaultTax: 20,
      pricesTtc: false,
      isQuickSale: false,
      taxExempt: false,
      explicitInclusive: false,
      currency: 'MAD',
    });
    const aggMad = aggregateDocumentTotals([large], 'MAD');
    expect(aggMad.subtotal).toBe(12_345_600);
    expect(aggMad.tax_amount).toBe(2_469_120);
    expect(aggMad.total).toBe(14_814_720);
  });

  it('splits payments cleanly without float dust and conserves refund totals', () => {
    const p1 = computePaymentApplication(33.33, 100, 0, 'EUR');
    expect(p1).toEqual({ applied: 33.33, next_paid: 33.33, remaining: 66.67, status: 'partial' });
    const p2 = computePaymentApplication(33.33, 100, p1!.next_paid, 'EUR');
    expect(p2).toEqual({ applied: 33.33, next_paid: 66.66, remaining: 33.34, status: 'partial' });
    const p3 = computePaymentApplication(50, 100, p2!.next_paid, 'EUR');
    expect(p3).toEqual({ applied: 33.34, next_paid: 100, remaining: 0, status: 'paid' });
    expect(computePaymentApplication(1, 100, 100, 'EUR')).toBeNull();

    const wr = computeRefundSplit(350, 1000, 400, 'partial', 'MAD');
    expect(wr.credit_vs_debt + wr.cash_refund).toBe(350);
  });

  it('rejects NaN, Infinity, -Infinity, and negative values in sanitizers', () => {
    expect(sanitizeFiniteNumber(Number.NaN, -1)).toBe(-1);
    expect(sanitizeFiniteNumber(Number.POSITIVE_INFINITY, 0)).toBe(0);
    expect(sanitizeFiniteNumber(Number.NEGATIVE_INFINITY, 0)).toBe(0);
    expect(sanitizeNonNegativeAmount(-0.01)).toBeNull();
    expect(sanitizePositiveAmount(0)).toBeNull();
    expect(sanitizePositiveAmount(1.005, { decimals: 2 })).toBe(1.01);
    expect(remainingBalance(100, 120)).toBe(0);
    expect(remainingBalance(Number.NaN, 10)).toBe(0);
  });

  it('computes moving average cost and inventory valuation accurately', () => {
    expect(computeMovingAverageCost(10, 100, 10, 150)).toBe(125);
    expect(computeMovingAverageCost(0, 99, 5, 80)).toBe(80);
    expect(computeMovingAverageCost(10, 100, Number.NaN, 80)).toBeNull();

    const val = computeInventoryValuation([{ stock_quantity: 12.5, cost: 40.25, price: 65.5, track_inventory: 1 }], 'MAD');
    expect(val.cost_total).toBe(503.13);
    expect(val.sell_total).toBe(818.75);
    expect(val.potential_margin).toBe(315.62);
  });

  it('satisfies deterministic property-based invariants across 200 randomized inputs', () => {
    const rng = seededRng(20261020);
    for (let i = 0; i < 200; i++) {
      const cur = (['MAD', 'EUR', 'TND', 'JPY'] as const)[i % 4];
      const lineCount = 1 + Math.floor(rng() * 6);
      const lines = Array.from({ length: lineCount }, () => {
        const qty = Number((0.1 + rng() * 50).toFixed(3));
        const unitPrice = Number((1 + rng() * 2500).toFixed(3));
        const taxRate = [0, 7, 10, 14, 20][Math.floor(rng() * 5)];
        return computeInvoiceLine({
          quantity: qty,
          unitPrice,
          listPrice: unitPrice,
          taxRate,
          defaultTax: 20,
          pricesTtc: rng() > 0.5,
          isQuickSale: false,
          taxExempt: false,
          explicitInclusive: false,
          currency: cur,
        });
      });

      const doc = aggregateDocumentTotals(lines, cur);
      expect(Number.isFinite(doc.subtotal)).toBe(true);
      expect(Number.isFinite(doc.tax_amount)).toBe(true);
      expect(Number.isFinite(doc.total)).toBe(true);
      expect(doc.total).toBeGreaterThanOrEqual(doc.subtotal);

      // Sequential payment split conservation
      let paid = 0;
      let totalApplied = 0;
      for (let step = 0; step < 4; step++) {
        const pay = Number((1 + rng() * (doc.total * 0.6 + 5)).toFixed(cur === 'JPY' ? 0 : 2));
        const res = computePaymentApplication(pay, doc.total, paid, cur);
        if (!res) break;
        totalApplied = addMoneyAmounts(totalApplied, res.applied, cur);
        paid = res.next_paid;
        expect(res.remaining).toBeGreaterThanOrEqual(0);
        expect(addMoneyAmounts(paid, res.remaining, cur)).toBe(roundMoneyForCurrency(doc.total, cur, 'invoice'));
      }
      expect(totalApplied).toBe(paid);

      // Refund split conservation
      const reqRefund = Number((1 + rng() * Math.max(1, doc.total)).toFixed(2));
      const srcPaid = Number((rng() * doc.total).toFixed(2));
      const wr = computeRefundSplit(reqRefund, doc.total, srcPaid, srcPaid >= doc.total ? 'paid' : 'partial', cur);
      expect(addMoneyAmounts(wr.credit_vs_debt, wr.cash_refund, cur === 'MAD' ? 0 : cur)).toBe(
        roundMoneyForCurrency(reqRefund, cur, 'invoice'),
      );
    }
  });
});

describe('HTTP + D1 round-trip financial integrity regressions', () => {
  let sqlite: any;
  let env: any;
  const ip = '203.0.113.109';

  function dbFor(database: any) {
    return {
      prepare(sql: string) {
        let args: any[] = [];
        const stmt: any = {
          bind(...a: any[]) { args = a; return stmt; },
          async first() { return database.prepare(sql).get(...args) || null; },
          async all() { return { results: database.prepare(sql).all(...args) }; },
          async run() {
            const r = database.prepare(sql).run(...args);
            return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
          },
        };
        return stmt;
      },
      async batch(stmts: any[]) {
        database.exec('BEGIN');
        try {
          const out = [];
          for (const stmt of stmts) out.push(await stmt.run());
          database.exec('COMMIT');
          return out;
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      },
    };
  }

  async function sha256(text: string) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async function ownerToken() {
    const material = await sha256('owner-key|admin|OwnerPass123!');
    const proof = await sha256(`proof|admin|owner|${material}|${ip}|none`);
    return btoa(`stock-auth-v2|admin|owner|${ip}|none|${proof}`);
  }

  async function call(path: string, tok: string, method = 'GET', body?: unknown) {
    return app.fetch(
      new Request(`http://test.local${path}`, {
        method,
        headers: {
          'CF-Connecting-IP': ip,
          Authorization: `Bearer ${tok}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
      {} as any,
    );
  }

  beforeAll(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'));
    sqlite.exec(`ALTER TABLE invoices ADD COLUMN doc_kind TEXT DEFAULT '';`);
    sqlite.exec(`INSERT INTO products (name, sku, price, cost, stock_quantity, track_inventory, is_active)
      VALUES ('Marbre Crema', 'MC-01', 100, 60, 100, 1, 1);`);
    env = { DB: dbFor(sqlite), ADMIN_PASSWORD: 'OwnerPass123!', EMAIL: { send: async () => ({}) } };
  });

  afterAll(() => sqlite.close());

  it('rounds PUT /api/invoices/:id lines/totals cleanly and rejects negative prices', async () => {
    const tok = await ownerToken();
    const createRes = await call('/api/invoices', tok, 'POST', {
      client_name: 'Client Test',
      items: [{ product_id: 1, product_name: 'Marbre Crema', sku: 'MC-01', quantity: 2, unit_price: 100, tax_rate: 20 }],
    });
    expect(createRes.status).toBe(201);
    const created: any = await createRes.json();
    const invId = created.data.id;

    // Reject negative unit price on PUT
    const badPut = await call(`/api/invoices/${invId}`, tok, 'PUT', {
      client_name: 'Client Test',
      items: [{ product_id: 1, product_name: 'Marbre Crema', sku: 'MC-01', quantity: 1, unit_price: -50, tax_rate: 20 }],
    });
    expect(badPut.status).toBe(400);

    // Valid PUT with fractional quantity produces clean rounded MAD totals
    const goodPut = await call(`/api/invoices/${invId}`, tok, 'PUT', {
      client_name: 'Client Test',
      items: [{ product_id: 1, product_name: 'Marbre Crema', sku: 'MC-01', quantity: 1.375, unit_price: 245.5, tax_rate: 20 }],
    });
    expect(goodPut.status).toBe(200);
    const putData: any = await goodPut.json();
    expect(putData.data.subtotal).toBe(338);
    expect(putData.data.tax_amount).toBe(68);
    expect(putData.data.total).toBe(406);

    // Sequential split payments leave zero float dust and transition to paid
    const p1 = await call(`/api/invoices/${invId}/payments`, tok, 'POST', { amount: 200.5, payment_method: 'cash' });
    expect(p1.status).toBe(200);
    const p2 = await call(`/api/invoices/${invId}/payments`, tok, 'POST', { amount: 500, payment_method: 'cash' });
    expect(p2.status).toBe(200);
    const p2Body: any = await p2.json();
    expect(p2Body.data.amount_paid).toBe(406);
    expect(p2Body.data.status).toBe('paid');

    // Reject invalid status amount_paid
    const badStatus = await call(`/api/invoices/${invId}/status`, tok, 'PATCH', { status: 'partial', amount_paid: -10 });
    expect(badStatus.status).toBe(400);
  });

  it('persists clean bill totals, split bill payments, and rejects invalid expenses/imports', async () => {
    const tok = await ownerToken();

    // Negative bill item cost rejected (422 validation)
    const badBill = await call('/api/bills', tok, 'POST', {
      vendor_name: 'Fournisseur Test',
      items: [{ product_name: 'Bloc', quantity: 2, unit_cost: -10 }],
    });
    expect(badBill.status).toBe(422);

    const billRes = await call('/api/bills', tok, 'POST', {
      vendor_name: 'Fournisseur Test',
      items: [{ product_name: 'Bloc', quantity: 1.5, unit_cost: 100.5, tax_rate: 20 }],
    });
    expect(billRes.status).toBe(201);
    const bill: any = await billRes.json();
    expect(bill.data.subtotal).toBe(151);
    expect(bill.data.tax_amount).toBe(30);
    expect(bill.data.total).toBe(181);

    const bp1 = await call(`/api/bills/${bill.data.id}/payments`, tok, 'POST', { amount: 80.25, payment_method: 'cash' });
    expect(bp1.status).toBe(200);
    const bp2 = await call(`/api/bills/${bill.data.id}/payments`, tok, 'POST', { amount: 200, payment_method: 'cash' });
    expect(bp2.status).toBe(200);
    const bp2Body: any = await bp2.json();
    expect(bp2Body.data.amount_paid).toBe(181);
    expect(bp2Body.data.status).toBe('paid');

    // Expense precision + import rejection of Infinity/negatives
    const expRes = await call('/api/expenses', tok, 'POST', {
      description: 'Transport',
      amount: 100.005,
      payment_method: 'cash',
    });
    expect(expRes.status).toBe(201);
    const expBody: any = await expRes.json();
    expect(expBody.data.amount).toBe(100.01);

    const expImp = await call('/api/expenses/import', tok, 'POST', {
      rows: [
        { description: 'Bad', amount: -5 },
        { description: 'Inf', amount: 'Infinity' },
        { description: 'Good', amount: 42.125 },
      ],
    });
    expect(expImp.status).toBe(200);
    const expImpBody: any = await expImp.json();
    expect(expImpBody.count).toBe(1);

    const billImp = await call('/api/bills/import', tok, 'POST', {
      rows: [
        { vendor_name: 'V1', total: -50 },
        { vendor_name: 'V2', items: [{ product_name: 'X', quantity: 2, unit_price: 50.25, tax_rate: 20 }] },
      ],
    });
    expect(billImp.status).toBe(200);
    const billImpBody: any = await billImp.json();
    expect(billImpBody.count).toBe(1);
    expect(billImpBody.data[0].total).toBe(121);
  });

  it('prevents sequential over-refunds on WR credit notes and preserves BigInt/multi-currency accuracy', async () => {
    const tok = await ownerToken();

    // Create a multi-line invoice (including two lines with distinct item IDs)
    const invRes = await call('/api/invoices', tok, 'POST', {
      client_name: 'Client Remboursement',
      items: [
        { product_id: 1, product_name: 'Marbre Crema', sku: 'MC-01', quantity: 5, unit_price: 100, tax_rate: 20 },
        { product_id: 1, product_name: 'Marbre Crema', sku: 'MC-01', quantity: 3, unit_price: 80, tax_rate: 20 },
      ],
    });
    expect(invRes.status).toBe(201);
    const invBody: any = await invRes.json();
    const invId = invBody.data.id;
    const invItems = sqlite.prepare('SELECT id, quantity FROM invoice_items WHERE invoice_id = ? ORDER BY id ASC').all(invId) as Array<{ id: number; quantity: number }>;
    expect(invItems.length).toBe(2);

    // 1st partial WR on first line: 3 of 5
    const wr1 = await call('/api/invoices/remboursement', tok, 'POST', {
      refund_of_invoice_id: invId,
      reason_code: 'defective_shipped',
      reason_detail: 'Pièce fissurée constatée à la livraison client',
      items: [{ invoice_item_id: invItems[0].id, quantity: 3, restock: true }],
    });
    expect(wr1.status).toBe(201);
    const wr1Body: any = await wr1.json();
    expect(wr1Body.data.total).toBe(360);

    // 2nd partial WR attempting to over-refund first line (only 2 left, asking 3) MUST be rejected with 400 QTY_EXCEEDED
    const wrOver = await call('/api/invoices/remboursement', tok, 'POST', {
      refund_of_invoice_id: invId,
      reason_code: 'defective_shipped',
      reason_detail: 'Seconde tentative de remboursement partiel',
      items: [{ invoice_item_id: invItems[0].id, quantity: 3, restock: true }],
    });
    expect(wrOver.status).toBe(400);
    const wrOverBody: any = await wrOver.json();
    expect(wrOverBody.code).toBe('QTY_EXCEEDED');

    // 2nd valid WR taking the exact remaining 2 on line 0 + 1 on line 1 succeeds cleanly
    const wr2 = await call('/api/invoices/remboursement', tok, 'POST', {
      refund_of_invoice_id: invId,
      reason_code: 'defective_shipped',
      reason_detail: 'Remboursement du reliquat validé par le client',
      items: [
        { invoice_item_id: invItems[0].id, quantity: 2, restock: true },
        { invoice_item_id: invItems[1].id, quantity: 1, restock: false, disposition: 'broken_unusable' },
      ],
    });
    expect(wr2.status).toBe(201);
    const wr2Body: any = await wr2.json();
    expect(wr2Body.data.subtotal).toBe(280);
    expect(wr2Body.data.tax_amount).toBe(56);
    expect(wr2Body.data.total).toBe(336);

    // Switch company currency to EUR (2 decimals) and verify invoice, edit, payment, quote conversion, and bill import keep cents
    sqlite.prepare(`UPDATE company_settings SET currency = 'EUR' WHERE id = 1`).run();
    try {
      const eurInv = await call('/api/invoices', tok, 'POST', {
        client_name: 'Euro Client',
        items: [{ product_name: 'Service', quantity: 1, unit_price: 10.25, tax_rate: 20 }],
      });
      expect(eurInv.status).toBe(201);
      const eurInvBody: any = await eurInv.json();
      expect(eurInvBody.data.subtotal).toBe(10.25);
      expect(eurInvBody.data.tax_amount).toBe(2.05);
      expect(eurInvBody.data.total).toBe(12.3);

      const eurPut = await call(`/api/invoices/${eurInvBody.data.id}`, tok, 'PUT', {
        client_name: 'Euro Client',
        items: [{ product_name: 'Service', quantity: 3, unit_price: 10.15, tax_rate: 20 }],
      });
      expect(eurPut.status).toBe(200);
      const eurPutBody: any = await eurPut.json();
      expect(eurPutBody.data.subtotal).toBe(30.45);
      expect(eurPutBody.data.tax_amount).toBe(6.09);
      expect(eurPutBody.data.total).toBe(36.54);

      const eurBillImp = await call('/api/bills/import', tok, 'POST', {
        rows: [{ vendor_name: 'Euro Supplier', total: 99.95 }],
      });
      expect(eurBillImp.status).toBe(200);
      const eurBillImpBody: any = await eurBillImp.json();
      expect(eurBillImpBody.data[0].total).toBe(99.95);
    } finally {
      sqlite.prepare(`UPDATE company_settings SET currency = 'MAD' WHERE id = 1`).run();
    }
  });

  it('maintains BigInt minor-unit exactness and mixed inclusive/exclusive invoice batching', () => {
    // 1000 * 0.01 = 10.00 exactly
    expect(sumMoneyAmounts(Array.from({ length: 1000 }, () => 0.01), 2)).toBe(10);
    // Large values near MAX_SAFE_INTEGER scale
    expect(addMoneyAmounts(90_000_000_000_000, 0.05, 2)).toBe(90_000_000_000_000.05);
    expect(subMoneyAmounts(90_000_000_000_000.05, 0.05, 2)).toBe(90_000_000_000_000);

    // Mixed explicitInclusive lines produce exact totals
    const mixed = computeInvoiceLinesAndTotals(
      [
        { quantity: 2, unitPrice: 120, listPrice: 120, taxRate: 20, defaultTax: 20, pricesTtc: true, isQuickSale: false, taxExempt: false, explicitInclusive: true },
        { quantity: 1, unitPrice: 50, listPrice: 50, taxRate: 20, defaultTax: 20, pricesTtc: false, isQuickSale: false, taxExempt: false, explicitInclusive: false },
      ],
      { defaultTax: 20, isQuickSale: false, taxExempt: false, currency: 'EUR' },
    );
    expect(mixed.totals.subtotal).toBe(250);
    expect(mixed.totals.tax_amount).toBe(50);
    expect(mixed.totals.total).toBe(300);
  });
});
