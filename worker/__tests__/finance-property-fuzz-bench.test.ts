import { describe, expect, it } from 'vitest';
import {
  aggregateDocumentTotals,
  computeBillLine,
  computeInvoiceLine,
  computePaymentApplication,
  fromMinorUnits,
  getCurrencySpec,
  roundCurrency,
  sanitizeFiniteNumber,
  sanitizeNonNegativeAmount,
  sanitizePositiveAmount,
  toMinorUnits,
} from '../../shared/financeCore';
import { assertSafeOutboundUrl, escapeHtml, safeImageSrc } from '../lib/security';
import { csvEscape } from '../routes/exports';
import { parsePeriodMonth } from '../lib/report-period';
import { parseBulkDiscounts } from '../lib/ledgerHelpers';

/** Deterministic PRNG (Mulberry32) so property/fuzz failures are 100% reproducible. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CURRENCIES = ['MAD', 'EUR', 'USD', 'TND', 'JPY'] as const;

describe('Phase 2 & 10: Property-based monetary arithmetic invariants (TS core)', () => {
  it('preserves minor-unit round-trips and safe-integer bounds across 250 randomized multi-currency scenarios', () => {
    const rng = mulberry32(0x20261020);
    for (let i = 0; i < 250; i++) {
      const currency = CURRENCIES[i % CURRENCIES.length];
      const spec = getCurrencySpec(currency);
      const qty = Math.max(0.01, Math.round((rng() * 50 + 0.1) * 100) / 100);
      const listPrice = Math.round((rng() * 5000 + 0.01) * 1000) / 1000;
      const discountPct = rng() < 0.3 ? Math.round(rng() * 35 * 100) / 100 : 0;
      const price = Math.round(listPrice * (1 - discountPct / 100) * 1000) / 1000;
      const taxRate = rng() < 0.25 ? 0 : [7, 10, 14, 20][Math.floor(rng() * 4)];
      const pricesTtc = rng() < 0.5;

      const line = computeInvoiceLine({
        quantity: qty,
        unitPrice: price,
        listPrice,
        taxRate,
        defaultTax: 20,
        pricesTtc,
        isQuickSale: false,
        taxExempt: taxRate === 0,
        explicitInclusive: pricesTtc,
        currency,
      });

      expect(Number.isFinite(line.line_ht)).toBe(true);
      expect(Number.isFinite(line.line_tax_real)).toBe(true);
      expect(Number.isFinite(line.line_total)).toBe(true);
      expect(line.line_ht).toBeGreaterThanOrEqual(0);
      expect(line.line_tax_real).toBeGreaterThanOrEqual(0);
      expect(line.line_total).toBe(roundCurrency(line.line_ht + line.line_tax_real, currency, 'invoice'));

      const totals = aggregateDocumentTotals([line], currency);
      expect(totals.total).toBe(roundCurrency(totals.subtotal + totals.tax_amount, currency, 'invoice'));
      expect(Number.isSafeInteger(toMinorUnits(totals.total, currency))).toBe(true);
      expect(fromMinorUnits(toMinorUnits(totals.total, currency), currency)).toBe(
        roundCurrency(totals.total, currency, 'ledger'),
      );

      // Payment application invariants: 0 <= applied <= remaining, balance_after >= 0
      const paidBefore = rng() < 0.5 ? roundCurrency(totals.total * rng() * 0.8, currency, 'ledger') : 0;
      const payReq = roundCurrency((totals.total - paidBefore) * (0.1 + rng() * 1.4), currency, 'ledger');
      if (totals.total - paidBefore > 0 && payReq > 0) {
        const appRes = computePaymentApplication(payReq, totals.total, paidBefore, currency);
        if (appRes) {
          expect(appRes.applied).toBeGreaterThan(0);
          expect(appRes.applied).toBeLessThanOrEqual(roundCurrency(totals.total - paidBefore + 1 / 10 ** spec.minorDecimals, currency, 'ledger'));
          expect(appRes.remaining).toBeGreaterThanOrEqual(0);
          expect(['paid', 'partial']).toContain(appRes.status);
        }
      }

      // Bill line invariants
      const billLine = computeBillLine({
        quantity: qty,
        unitCost: price,
        taxRate,
        defaultTax: 20,
        currency,
      });
      expect(billLine.line_ht).toBeGreaterThanOrEqual(0);
      expect(billLine.line_tax).toBeGreaterThanOrEqual(0);
      expect(billLine.line_total).toBe(roundCurrency(billLine.line_ht + billLine.line_tax, currency, 'invoice'));
    }
  });

  it('rejects non-finite, unsafe-integer, and invalid monetary inputs cleanly', () => {
    for (const bad of [NaN, Infinity, -Infinity, 'abc', null, undefined, -10]) {
      expect(sanitizePositiveAmount(bad, { decimals: 2 })).toBeNull();
    }
    expect(sanitizeNonNegativeAmount(-0, { decimals: 2 })).toBe(0);
    expect(Object.is(sanitizeNonNegativeAmount(-0), -0)).toBe(false);
    expect(sanitizeFiniteNumber(NaN, 0)).toBe(0);
    expect(sanitizeFiniteNumber(Infinity, 0)).toBe(0);
    expect(sanitizePositiveAmount(Number.MAX_SAFE_INTEGER + 1000)).toBeNull();
    expect(Object.is(roundCurrency(-0, 'MAD', 'ledger'), -0)).toBe(false);
    expect(computePaymentApplication(NaN, 100, 0, 'MAD')).toBeNull();
    expect(computePaymentApplication(Infinity, 100, 0, 'MAD')).toBeNull();
    expect(computePaymentApplication(0, 100, 0, 'MAD')).toBeNull();
    expect(computePaymentApplication(-5, 100, 0, 'MAD')).toBeNull();
  });
});

describe('Phase 10: Security fuzzing (CSV, SSRF, XSS, JSON/bulk-discounts)', () => {
  it('neutralizes CSV formula injection payloads across control characters and prefixes', () => {
    const payloads = ['=CMD()', '+SUM(1,2)', '-1+1', '@SUM(A1)', '\t=1+1', '\r=1+1'];
    for (const p of payloads) {
      const cell = csvEscape(p);
      // Either quoted with leading apostrophe or prefixed with apostrophe so spreadsheet engines never execute it
      expect(cell.replace(/^"|"$/g, '').startsWith("'")).toBe(true);
    }
  });

  it('rejects unsafe image src URLs and malformed YYYY-MM period inputs', () => {
    for (const badImg of ['javascript:alert(1)', 'data:text/html,<script>', 'vbscript:msgbox(1)', '//evil.example/x.png']) {
      expect(safeImageSrc(badImg)).toBe('');
    }
    for (const badPeriod of ['', '2026', '2026-13', '2026-00', '2026-10-01', 'not-a-date', null, undefined]) {
      expect(parsePeriodMonth(badPeriod)).toBeNull();
    }
    expect(parsePeriodMonth('2026-10')).toEqual({ year: 2026, month: 10 });
  });

  it('blocks SSRF internal/loopback/link-local/non-HTTPS URLs', () => {
    const badUrls = [
      'http://localhost/hook',
      'https://127.0.0.1:8787/hook',
      'https://169.254.169.254/latest/meta-data',
      'https://10.0.0.1/internal',
      'https://192.168.1.50/admin',
      'https://172.16.0.5/hook',
      'https://[::1]/hook',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'https://user:pass@example.com/hook',
    ];
    for (const u of badUrls) {
      expect(() => assertSafeOutboundUrl(u)).toThrow();
    }
    expect(assertSafeOutboundUrl('https://api.resend.com/emails').hostname).toBe('api.resend.com');
  });

  it('escapes HTML/SVG XSS vectors and handles malformed bulk discount JSON safely', () => {
    const escaped = escapeHtml(`<img src=x onerror="alert('xss')">&'`);
    expect(escaped).not.toContain('<');
    expect(escaped).not.toContain('>');
    expect(escaped).toContain('&lt;img');
    expect(escaped).toContain('&quot;');

    for (const fuzz of ['', '{bad', 'null', '{"__proto__":{}}', '[{"min_qty":-5,"discount_pct":999}]', null, 42]) {
      const parsed = parseBulkDiscounts(fuzz as any);
      expect(Array.isArray(parsed)).toBe(true);
    }
  });
});

describe('Phase 13: Reproducible TS finance-core throughput benchmark (Node TS fallback)', () => {
  it('computes 10,000 multi-currency invoice lines + totals within tight latency budget', () => {
    const iterations = 10_000;
    const t0 = performance.now();
    let checksum = 0;
    for (let i = 0; i < iterations; i++) {
      const currency = CURRENCIES[i % CURRENCIES.length];
      const unitPrice = 125.5 + (i % 50);
      const listPrice = unitPrice * (1 + (i % 10) / 100);
      const line = computeInvoiceLine({
        quantity: (i % 20) + 1,
        unitPrice,
        listPrice,
        taxRate: 20,
        defaultTax: 20,
        pricesTtc: i % 2 === 1,
        isQuickSale: false,
        taxExempt: false,
        explicitInclusive: i % 2 === 1,
        currency,
      });
      const totals = aggregateDocumentTotals([line], currency);
      checksum += totals.total;
    }
    const elapsedMs = performance.now() - t0;
    const opsPerSec = Math.round((iterations / Math.max(0.001, elapsedMs)) * 1000);
    // Keep benchmark informative and deterministic without flaky tight-CPU failures
    expect(checksum).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(2000);
    console.info(`[bench:ts-finance-core] ${iterations} iterations in ${elapsedMs.toFixed(2)} ms (${opsPerSec} ops/s)`);
  });
});
