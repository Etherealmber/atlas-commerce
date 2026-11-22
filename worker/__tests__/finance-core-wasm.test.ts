import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FINANCE_WASM_ABI_VERSION,
  REQUIRED_FINANCE_WASM_EXPORTS,
  addMoneyAmounts,
  aggregateDocumentTotals,
  applyBulkDiscount,
  attachFinanceWasmInstance,
  classifyDoc,
  computeInvoiceBatchWasm,
  computeInvoiceLine,
  computeInvoiceLinesAndTotals,
  computePayrollObligation,
  computeRefundSplit,
  daysBetweenYmd,
  detachFinanceWasm,
  getFinanceCoreStats,
  initFinanceWasmFromModule,
  isFinanceWasmActive,
  isValidPeriod,
  isValidYmd,
  markFinanceWasmBundled,
  markIntentionalTsFallback,
  round2,
  round6,
  roundDh,
  roundWithMode,
  subMoneyAmounts,
  validateCreditPrefixCore,
  validateNextCreditNumberCore,
} from '../../shared/financeCore';
import { getWorkerFinanceHealthStats, resetWorkerFinanceWasmForTest, verifyWorkerFinanceEngine } from '../lib/financeCore';

const WASM_PATH = resolve(process.cwd(), 'worker/wasm/atlas_finance_core.wasm');
const REQUIRE_WASM = process.env.ATLAS_REQUIRE_WASM === '1';
const HAS_REAL_WASM = existsSync(WASM_PATH);

describe('Finance Core — Shared Contract, Safety & ABI Verification', () => {
  afterEach(() => {
    resetWorkerFinanceWasmForTest();
  });

  it('fixes all audited IEEE-754 rounding and overflow edge cases in TS engine', () => {
    expect(round2(35.855)).toBe(35.86);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(-2.675)).toBe(-2.67);
    expect(Object.is(round2(-0), 0)).toBe(true);
    expect(round2(Number.NaN)).toBe(0);
    expect(round2(Number.POSITIVE_INFINITY)).toBe(0);
    expect(round2(Number.NEGATIVE_INFINITY)).toBe(0);
    expect(Number.isFinite(round2(1e307))).toBe(true);
    expect(round2(1e307)).toBe(1e307);
    expect(Number.isFinite(round6(1e303))).toBe(true);
    expect(round6(1e303)).toBe(1e303);

    expect(roundDh(0.49999999999999994)).toBe(0);
    expect(Object.is(roundDh(-0.5), 0)).toBe(true);
    expect(roundDh(-0.5000000000000001)).toBe(-1);
    expect(roundDh(12.5)).toBe(13);
    expect(roundWithMode(2.5, 0, 'half-even')).toBe(2);
    expect(roundWithMode(3.5, 0, 'half-even')).toBe(4);
  });

  it('validates strict Gregorian calendar dates (rejects 2026-02-31 and non-leap 2026-02-29)', () => {
    expect(isValidYmd(2024, 2, 29)).toBe(true);
    expect(isValidYmd(2026, 2, 29)).toBe(false);
    expect(isValidYmd(2026, 2, 31)).toBe(false);
    expect(isValidYmd(2026, 4, 31)).toBe(false);
    expect(daysBetweenYmd('2026-02-31', '2026-03-01')).toBe(0);
    expect(classifyDoc(100, 0, '2026-02-31', '2026-10-20').overdue).toBe(false);
  });

  it('rejects negative and over-refund inputs safely in computeRefundSplit', () => {
    const neg = computeRefundSplit(-50, 1000, 0, 'sent', 'MAD');
    expect(neg.credit_vs_debt).toBe(0);
    expect(neg.cash_refund).toBe(0);

    const capped = computeRefundSplit(1500, 1000, 200, 'partial', 'MAD');
    expect(capped.credit_vs_debt).toBe(800);
    expect(capped.cash_refund).toBe(200);
    expect(capped.next_paid).toBe(1000);
    expect(capped.new_status).toBe('paid');
  });

  it('refuses partial WASM ABI activation, reports exact status taxonomy, and fails closed when required', () => {
    // 1. Default unbundled state
    resetWorkerFinanceWasmForTest();
    expect(getFinanceCoreStats().status).toBe('wasm_not_bundled');

    // 2. Intentional TS fallback
    markIntentionalTsFallback(true);
    expect(getFinanceCoreStats().status).toBe('typescript_fallback');

    // 3. Partial ABI exports rejected (abi_incompatible)
    const partialInstance = {
      exports: {
        memory: new WebAssembly.Memory({ initial: 1 }),
        fc_abi_version: () => FINANCE_WASM_ABI_VERSION,
        fc_round2: (v: number) => v,
      },
    } as unknown as WebAssembly.Instance;

    expect(attachFinanceWasmInstance(partialInstance)).toBe(false);
    expect(isFinanceWasmActive()).toBe(false);
    const stats = getFinanceCoreStats();
    expect(stats.engine).toBe('ts-mirror');
    expect(stats.status).toBe('abi_incompatible');
    expect(stats.requiredExportsVerified).toBe(false);
    expect(stats.initError).toContain('MISSING_EXPORTS:');

    // 4. Wrong ABI version rejected even if all functions exist
    const fullButWrongAbi: Record<string, unknown> = {
      memory: new WebAssembly.Memory({ initial: 1 }),
    };
    for (const name of REQUIRED_FINANCE_WASM_EXPORTS) {
      if (name === 'memory') continue;
      fullButWrongAbi[name] = name === 'fc_abi_version' ? () => 999 : () => 0;
    }
    expect(attachFinanceWasmInstance({ exports: fullButWrongAbi } as unknown as WebAssembly.Instance)).toBe(false);
    expect(getFinanceCoreStats().status).toBe('abi_incompatible');
    expect(getFinanceCoreStats().initError).toContain('ABI_MISMATCH:');

    // 5. Corrupt/empty module instantiation failure (wasm_initialization_failed)
    markFinanceWasmBundled(true);
    expect(initFinanceWasmFromModule({} as WebAssembly.Module)).toBe(false);
    expect(getFinanceCoreStats().status).toBe('wasm_initialization_failed');

    // 6. Fail-closed Worker verification when FINANCE_REQUIRE_WASM=true
    const check = verifyWorkerFinanceEngine({ ENVIRONMENT: 'production', FINANCE_REQUIRE_WASM: 'true' });
    expect(check.ok).toBe(false);
  });

  it('matches an independent BigInt decimal precision oracle for currency rounding & invoice/refund totals', () => {
    // Independent decimal-string oracle for ECMAScript/Atlas round-half-towards-+infinity:
    // avoids any circular dependency on shared/financeCore.ts logic.
    const oracleRoundHalfPlusInf = (decimalStr: string, decimals: number): number => {
      const neg = decimalStr.startsWith('-');
      const abs = neg ? decimalStr.slice(1) : decimalStr;
      const [intPart, fracPart = ''] = abs.split('.');
      const padded = fracPart.padEnd(decimals + 1, '0');
      const kept = BigInt(intPart + padded.slice(0, decimals));
      const nextDigit = Number(padded[decimals] ?? '0');
      const hasTrailingNonZero = /[1-9]/.test(padded.slice(decimals + 1));
      const roundMagUp = neg
        ? nextDigit > 5 || (nextDigit === 5 && hasTrailingNonZero)
        : nextDigit >= 5;
      const rounded = roundMagUp ? kept + 1n : kept;
      const denom = 10n ** BigInt(decimals);
      const num = Number(rounded) / Number(denom);
      return neg ? (num === 0 ? 0 : -num) : num;
    };

    const vectors: Array<[number, string, number]> = [
      [35.855, '35.855', 2],
      [1.005, '1.005', 2],
      [2.675, '2.675', 2],
      [-2.675, '-2.675', 2],
      [-2.6751, '-2.6751', 2],
      [19.995, '19.995', 2],
      [0.0049, '0.0049', 2],
      [1234.565, '1234.565', 2],
      [0.1234565, '0.1234565', 6],
    ];

    for (const [val, repr, dec] of vectors) {
      const expected = oracleRoundHalfPlusInf(repr, dec);
      expect(dec === 2 ? round2(val) : round6(val)).toBe(expected);
    }

    // Independent exact invoice math: qty=3, unit=19.995 HT, 20% VAT, EUR (2dp)
    // Line HT: round2(3 * 19.995) = round2(59.985) = 59.99
    // Line Tax: 59.99 * 0.20 = 11.998 -> rounded total 59.99 + 11.998 = 71.988 -> 71.99, tax = 12.00
    const line = computeInvoiceLine({
      quantity: 3,
      unitPrice: 19.995,
      listPrice: 19.995,
      taxRate: 20,
      defaultTax: 20,
      pricesTtc: false,
      isQuickSale: false,
      taxExempt: false,
      explicitInclusive: false,
      currency: 'EUR',
    });
    const totals = aggregateDocumentTotals([line], 'EUR');
    expect(totals.subtotal).toBe(59.99);
    expect(totals.tax_amount).toBe(12);
    expect(totals.total).toBe(71.99);
  });
});

describe('Finance Core — Compiled Rust WASM Binary Parity & Benchmarks', () => {
  afterEach(() => {
    detachFinanceWasm(null);
  });

  const wasmIt = HAS_REAL_WASM || REQUIRE_WASM ? it : it.skip;

  wasmIt('loads compiled worker/wasm/atlas_finance_core.wasm, verifies ABI v2 + full parity, and benchmarks workloads', async () => {
    expect(
      existsSync(WASM_PATH),
      `Expected compiled Rust WASM binary at ${WASM_PATH}. Run "npm run build:finance-wasm" with Rust 1.82.0 + wasm32-unknown-unknown.`,
    ).toBe(true);

    const bytes = readFileSync(WASM_PATH);
    const mod = await WebAssembly.compile(bytes);
    const inst = new WebAssembly.Instance(mod, {});
    expect(attachFinanceWasmInstance(inst)).toBe(true);
    expect(isFinanceWasmActive()).toBe(true);
    expect(getFinanceCoreStats()).toMatchObject({
      engine: 'wasm',
      abiVersion: FINANCE_WASM_ABI_VERSION,
      requiredExportsVerified: true,
      initError: null,
    });

    const roundCases = [
      0, -0, 0.49999999999999994, 0.5, -0.5, -0.5000000000000001,
      1.005, 2.675, -2.675, 35.855, 10.125, 10.124, 100 / 1.2,
      Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY,
      1e307, 1e303,
    ];

    for (const v of roundCases) {
      const wR2 = round2(v);
      const wDh = roundDh(v);
      const wR6 = round6(v);
      const wHe = roundWithMode(v, 2, 'half-even');

      detachFinanceWasm(null);
      const tsR2 = round2(v);
      const tsDh = roundDh(v);
      const tsR6 = round6(v);
      const tsHe = roundWithMode(v, 2, 'half-even');

      expect(Object.is(wR2, tsR2)).toBe(true);
      expect(Object.is(wDh, tsDh)).toBe(true);
      expect(Object.is(wR6, tsR6)).toBe(true);
      expect(Object.is(wHe, tsHe)).toBe(true);

      expect(attachFinanceWasmInstance(inst)).toBe(true);
    }

    // Batch invoice parity (MAD + EUR + TND)
    const batchLines = [
      { quantity: 1.375, unitPrice: 245.5, listPrice: 245.5, taxRate: 20, defaultTax: 20, pricesTtc: false, isQuickSale: false, taxExempt: false, explicitInclusive: false, currency: 'EUR' },
      { quantity: 3, unitPrice: 120, listPrice: 150, taxRate: 20, defaultTax: 20, pricesTtc: true, isQuickSale: false, taxExempt: false, explicitInclusive: true, currency: 'EUR' },
    ];
    const wasmBatch = computeInvoiceBatchWasm(batchLines, {
      defaultTax: 20,
      isQuickSale: false,
      taxExempt: false,
      explicitInclusive: true,
      currency: 'EUR',
    });
    expect(wasmBatch).not.toBeNull();
    detachFinanceWasm(null);
    const tsLines = batchLines.map((l) => computeInvoiceLine(l));
    const tsTotals = aggregateDocumentTotals(tsLines, 'EUR');
    expect(wasmBatch!.totals).toEqual(tsTotals);

    expect(attachFinanceWasmInstance(inst)).toBe(true);

    // Bulk discount, refund split, payroll, doc classification, validation parity
    const tiers = [{ min_qty: 10, percent: 5 }, { min_qty: 50, percent: 12.5 }];
    const wBulk = applyBulkDiscount(200, 50, tiers);
    const wSplit = computeRefundSplit(800, 1000, 400, 'partial', 'MAD');
    const wPayroll = computePayrollObligation(
      { id: 1, first_name: 'Amina', last_name: 'B.', pay_amount: 3000, pay_cycle_type: 'monthly', joined_date: '2026-10-01', active: 1 },
      '2026-10-16',
      250,
    );
    const wClass = classifyDoc(1000, 200, '2026-10-10', '2026-10-20');
    const wPrefixOk = validateCreditPrefixCore('WR-');
    const wPrefixBad = validateCreditPrefixCore('-WR');
    const wNumOk = validateNextCreditNumberCore(42);
    const wPerOk = isValidPeriod('2026-10');
    const wPerBad = isValidPeriod('2026-13');

    detachFinanceWasm(null);
    expect(wBulk).toEqual(applyBulkDiscount(200, 50, tiers));
    expect(wSplit).toEqual(computeRefundSplit(800, 1000, 400, 'partial', 'MAD'));
    expect(wPayroll).toEqual(
      computePayrollObligation(
        { id: 1, first_name: 'Amina', last_name: 'B.', pay_amount: 3000, pay_cycle_type: 'monthly', joined_date: '2026-10-01', active: 1 },
        '2026-10-16',
        250,
      ),
    );
    expect(wClass).toEqual(classifyDoc(1000, 200, '2026-10-10', '2026-10-20'));
    expect(wPrefixOk).toEqual(validateCreditPrefixCore('WR-'));
    expect(wPrefixBad).toEqual(validateCreditPrefixCore('-WR'));
    expect(wNumOk).toEqual(validateNextCreditNumberCore(42));
    expect(wPerOk).toBe(true);
    expect(wPerBad).toBe(false);

    // Lightweight benchmark (2,000 batch calls)
    expect(attachFinanceWasmInstance(inst)).toBe(true);
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) {
      computeInvoiceBatchWasm(batchLines, {
        defaultTax: 20,
        isQuickSale: false,
        taxExempt: false,
        explicitInclusive: true,
        currency: 'EUR',
      });
    }
    const wasmMs = performance.now() - t0;
    expect(Number.isFinite(wasmMs)).toBe(true);

    // 500 deterministic randomized WASM vs TS parity checks for computeInvoiceLinesAndTotals,
    // computeRefundSplit (incl. minor-unit additions), classifyDoc, and computePayrollObligation
    let prng = 0x13579bdf;
    const rand = () => {
      prng = (1664525 * prng + 1013904223) >>> 0;
      return prng / 4294967296;
    };
    const currencies = ['MAD', 'EUR', 'USD', 'TND', 'JPY'];
    for (let i = 0; i < 200; i++) {
      const cur = currencies[i % currencies.length];
      const len = 1 + (i % 5);
      const isQuickSale = i % 7 === 0;
      const taxExempt = i % 5 === 0;
      const explicitInclusive = i % 2 === 0 && !isQuickSale;
      const lines = Array.from({ length: len }, () => ({
        quantity: Number((0.1 + rand() * 25).toFixed(3)),
        unitPrice: Number((rand() * 2000).toFixed(3)),
        listPrice: Number((rand() * 2500).toFixed(3)),
        taxRate: i % 4 === 0 ? undefined : [0, 7, 10, 14, 20][Math.floor(rand() * 5)],
        defaultTax: 20,
        pricesTtc: explicitInclusive,
        isQuickSale,
        taxExempt,
        explicitInclusive,
      }));
      expect(attachFinanceWasmInstance(inst)).toBe(true);
      const wRes = computeInvoiceLinesAndTotals(lines, { defaultTax: 20, isQuickSale, taxExempt, currency: cur });
      const reqRef = Number((1 + rand() * Math.max(1, wRes.totals.total)).toFixed(2));
      const paidAmt = Number((rand() * wRes.totals.total).toFixed(2));
      const wRefund = computeRefundSplit(reqRef, wRes.totals.total, paidAmt, paidAmt >= wRes.totals.total ? 'paid' : 'partial', cur);
      const wClass = classifyDoc(wRes.totals.total, paidAmt, '2026-10-10', '2026-10-20');
      const wPay = computePayrollObligation(
        { id: 1, first_name: 'T', last_name: 'U', pay_amount: 1000 + Math.round(rand() * 9000), pay_cycle_type: i % 2 === 0 ? 'monthly' : 'weekly', joined_date: '2026-10-01', active: 1 },
        '2026-10-18',
        Number((rand() * 500).toFixed(2)),
      );

      detachFinanceWasm(null);
      const tRes = computeInvoiceLinesAndTotals(lines, { defaultTax: 20, isQuickSale, taxExempt, currency: cur });
      const tRefund = computeRefundSplit(reqRef, tRes.totals.total, paidAmt, paidAmt >= tRes.totals.total ? 'paid' : 'partial', cur);
      const tClass = classifyDoc(tRes.totals.total, paidAmt, '2026-10-10', '2026-10-20');
      const tPay = computePayrollObligation(
        { id: 1, first_name: 'T', last_name: 'U', pay_amount: 1000 + Math.round(rand() * 9000), pay_cycle_type: i % 2 === 0 ? 'monthly' : 'weekly', joined_date: '2026-10-01', active: 1 },
        '2026-10-18',
        Number((rand() * 500).toFixed(2)),
      );

      expect(wRes.totals).toEqual(tRes.totals);
      expect(wRes.lines).toEqual(tRes.lines);
      expect(wRefund).toEqual(tRefund);
      expect(wClass).toEqual(tClass);
      expect(wPay).toEqual(tPay);
      expect(subMoneyAmounts(wRes.totals.total, wRes.totals.tax_amount, cur === 'MAD' ? 0 : cur)).toBe(wRes.totals.subtotal);
      expect(addMoneyAmounts(wRes.totals.subtotal, wRes.totals.tax_amount, cur === 'MAD' ? 0 : cur)).toBe(wRes.totals.total);
    }

    // Isolate state check: verify getWorkerFinanceHealthStats reflects ts-fallback cleanly
    resetWorkerFinanceWasmForTest();
    expect(getWorkerFinanceHealthStats({ FINANCE_ENGINE_MODE: 'ts-fallback' }).status).toBe('typescript_fallback');
    expect(verifyWorkerFinanceEngine({ FINANCE_ENGINE_MODE: 'ts-fallback' }).ok).toBe(true);
    resetWorkerFinanceWasmForTest();
  });
});
