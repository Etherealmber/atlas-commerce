/**
 * Atlas Commerce — Shared Currency-Aware Deterministic Financial Core.
 *
 * Pure TypeScript, zero side-effects, zero IO/DB dependencies.
 * Designed with explicit domain types and versioned input/output contracts so
 * calculation kernels remain single-sourced across frontend previews, Hono API
 * handlers, reporting, and any future compiled financial engine.
 */

export const FINANCE_CORE_CONTRACT_VERSION = '1.0.0' as const;
export const FINANCE_WASM_ABI_VERSION = 2 as const;

export const REQUIRED_FINANCE_WASM_EXPORTS = [
  'memory',
  'fc_abi_version',
  'fc_alloc',
  'fc_dealloc',
  'fc_round2',
  'fc_round_dh',
  'fc_round6',
  'fc_round_with_mode',
  'fc_is_valid_ymd',
  'fc_classify_doc_state',
  'fc_classify_doc_remaining',
  'fc_days_between',
  'fc_compute_payroll',
  'fc_compute_refund_split',
  'fc_compute_invoice_batch',
  'fc_apply_bulk_discount',
  'fc_validate_credit_prefix',
  'fc_validate_next_credit_number',
  'fc_validate_period',
] as const;

export interface FinanceWasmExports {
  readonly memory: WebAssembly.Memory;
  fc_abi_version(): number;
  fc_alloc(byteLen: number): number;
  fc_dealloc(ptr: number, byteLen: number): void;
  fc_round2(v: number): number;
  fc_round_dh(v: number): number;
  fc_round6(v: number): number;
  fc_round_with_mode(v: number, decimals: number, mode: number): number;
  fc_is_valid_ymd(y: number, m: number, d: number): number;
  fc_classify_doc_state(
    total: number,
    paid: number,
    hasDue: number,
    dueY: number,
    dueM: number,
    dueD: number,
    todayY: number,
    todayM: number,
    todayD: number,
  ): number;
  fc_classify_doc_remaining(total: number, paid: number): number;
  fc_days_between(y1: number, m1: number, d1: number, y2: number, m2: number, d2: number): number;
  fc_compute_payroll(
    active: number,
    payAmount: number,
    cycleDays: number,
    anchorY: number,
    anchorM: number,
    anchorD: number,
    asofY: number,
    asofM: number,
    asofD: number,
    advances: number,
    outPtr: number,
  ): number;
  fc_compute_refund_split(
    refundTotal: number,
    sourceTotal: number,
    sourcePaid: number,
    sourceIsPaid: number,
    invoiceDecimals: number,
    outPtr: number,
  ): number;
  fc_compute_invoice_batch(
    inPtr: number,
    lineCount: number,
    outPtr: number,
    defaultTax: number,
    isQuickSale: number,
    taxExempt: number,
    explicitInclusive: number,
    invoiceDecimals: number,
  ): number;
  fc_apply_bulk_discount(
    listPrice: number,
    qty: number,
    tiersPtr: number,
    tierCount: number,
    outPtr: number,
  ): number;
  fc_validate_credit_prefix(ptr: number, len: number): number;
  fc_validate_next_credit_number(n: number): number;
  fc_validate_period(ptr: number, len: number): number;
}

export type FinanceEngineStatus =
  | 'wasm_active'
  | 'typescript_fallback'
  | 'wasm_initialization_failed'
  | 'abi_incompatible'
  | 'wasm_not_bundled';

let activeWasm: FinanceWasmExports | null = null;
let wasmBundledFlag = false;
let wasmInitError: string | null = null;
let intentionalFallbackFlag = false;
const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

export function markFinanceWasmBundled(bundled: boolean): void {
  wasmBundledFlag = bundled;
}

export function markIntentionalTsFallback(enabled: boolean): void {
  intentionalFallbackFlag = enabled;
  if (enabled) {
    activeWasm = null;
    wasmInitError = null;
  }
}

export function attachFinanceWasmInstance(instance: WebAssembly.Instance): boolean {
  const raw = instance?.exports as Record<string, unknown> | undefined;
  if (!raw) {
    wasmInitError = 'NO_EXPORTS';
    activeWasm = null;
    return false;
  }
  const missing: string[] = [];
  for (const name of REQUIRED_FINANCE_WASM_EXPORTS) {
    if (name === 'memory') {
      if (!(raw.memory instanceof WebAssembly.Memory)) missing.push(name);
    } else if (typeof raw[name] !== 'function') {
      missing.push(name);
    }
  }
  if (missing.length > 0) {
    wasmInitError = `MISSING_EXPORTS:${missing.join(',')}`;
    activeWasm = null;
    return false;
  }
  const exportsObj = raw as unknown as FinanceWasmExports;
  let abi = -1;
  try {
    abi = Number(exportsObj.fc_abi_version());
  } catch (err) {
    wasmInitError = `ABI_PROBE_FAILED:${err instanceof Error ? err.message : String(err)}`;
    activeWasm = null;
    return false;
  }
  if (abi !== FINANCE_WASM_ABI_VERSION) {
    wasmInitError = `ABI_MISMATCH:expected=${FINANCE_WASM_ABI_VERSION},got=${abi}`;
    activeWasm = null;
    return false;
  }
  activeWasm = exportsObj;
  wasmInitError = null;
  intentionalFallbackFlag = false;
  return true;
}

export function initFinanceWasmFromModule(mod: WebAssembly.Module): boolean {
  try {
    const imports = WebAssembly.Module.imports(mod);
    if (imports.length > 0) {
      wasmInitError = `UNEXPECTED_IMPORTS:${imports.map((i) => `${i.module}.${i.name}`).join(',')}`;
      activeWasm = null;
      return false;
    }
    const instance = new WebAssembly.Instance(mod, {});
    return attachFinanceWasmInstance(instance);
  } catch (err) {
    wasmInitError = `INSTANTIATE_FAILED:${err instanceof Error ? err.message : String(err)}`;
    activeWasm = null;
    return false;
  }
}

export function detachFinanceWasm(reason: string | null = null): void {
  activeWasm = null;
  wasmInitError = reason;
  intentionalFallbackFlag = reason === 'intentional-ts-fallback';
}

export function isFinanceWasmActive(): boolean {
  return activeWasm !== null;
}

export function getFinanceCoreStats(): {
  contractVersion: string;
  engine: 'wasm' | 'ts-mirror';
  status: FinanceEngineStatus;
  abiVersion: number | null;
  wasmBundled: boolean;
  requiredExportsVerified: boolean;
  initError: string | null;
} {
  let status: FinanceEngineStatus;
  if (activeWasm) {
    status = 'wasm_active';
  } else if (
    wasmInitError?.startsWith('ABI_MISMATCH') ||
    wasmInitError?.startsWith('MISSING_EXPORTS') ||
    wasmInitError?.startsWith('UNEXPECTED_IMPORTS')
  ) {
    status = 'abi_incompatible';
  } else if (wasmBundledFlag || wasmInitError?.startsWith('INSTANTIATE_FAILED') || wasmInitError === 'NO_EXPORTS' || wasmInitError?.startsWith('ABI_PROBE_FAILED')) {
    status = 'wasm_initialization_failed';
  } else if (intentionalFallbackFlag) {
    status = 'typescript_fallback';
  } else {
    status = 'wasm_not_bundled';
  }

  return {
    contractVersion: FINANCE_CORE_CONTRACT_VERSION,
    engine: activeWasm ? 'wasm' : 'ts-mirror',
    status,
    abiVersion: activeWasm ? FINANCE_WASM_ABI_VERSION : null,
    wasmBundled: wasmBundledFlag,
    requiredExportsVerified: activeWasm !== null,
    initError: wasmInitError,
  };
}

function withWasmBytes<T>(bytes: Uint8Array, fn: (w: FinanceWasmExports, ptr: number, len: number) => T): T | null {
  const w = activeWasm;
  if (!w) return null;
  const len = bytes.length;
  if (len === 0) return fn(w, 0, 0);
  const ptr = w.fc_alloc(len);
  if (!ptr) return null;
  try {
    new Uint8Array(w.memory.buffer, ptr, len).set(bytes);
    return fn(w, ptr, len);
  } finally {
    w.fc_dealloc(ptr, len);
  }
}

/* ─────────────────────────── Domain Types & Currencies ─────────────────────────── */

export type CurrencyCode =
  | 'MAD'
  | 'EUR'
  | 'USD'
  | 'GBP'
  | 'CAD'
  | 'TND'
  | 'DZD'
  | 'JPY'
  | 'KWD'
  | 'BHD'
  | 'OMR'
  | 'JOD'
  | (string & {});

export type RoundingMode = 'half-up' | 'half-even' | 'truncate';

export interface CurrencySpec {
  readonly code: string;
  /** Standard ISO-4217 minor unit decimal places (e.g. MAD=2, EUR=2, TND=3, JPY=0). */
  readonly minorDecimals: number;
  /** Document/UI rounding precision (MAD uses 0 whole dirhams by Moroccan business convention). */
  readonly invoiceDecimals: number;
  readonly symbol: string;
}

export interface MoneyValue {
  readonly amount: number;
  readonly minorUnits: number;
  readonly currency: string;
  readonly decimals: number;
}

export interface QuantityValue {
  readonly value: number;
  readonly unit?: string;
}

export interface PercentageValue {
  readonly percent: number;
}

export interface TaxRateValue {
  readonly ratePercent: number;
  readonly exempt?: boolean;
}

export interface ExchangeRateValue {
  readonly fromCurrency: string;
  readonly toCurrency: string;
  readonly rate: number;
}

const CURRENCY_SPECS: Record<string, CurrencySpec> = {
  MAD: { code: 'MAD', minorDecimals: 2, invoiceDecimals: 0, symbol: 'DH' },
  DH: { code: 'MAD', minorDecimals: 2, invoiceDecimals: 0, symbol: 'DH' },
  MADH: { code: 'MAD', minorDecimals: 2, invoiceDecimals: 0, symbol: 'DH' },
  EUR: { code: 'EUR', minorDecimals: 2, invoiceDecimals: 2, symbol: '€' },
  USD: { code: 'USD', minorDecimals: 2, invoiceDecimals: 2, symbol: '$' },
  GBP: { code: 'GBP', minorDecimals: 2, invoiceDecimals: 2, symbol: '£' },
  CAD: { code: 'CAD', minorDecimals: 2, invoiceDecimals: 2, symbol: 'CA$' },
  DZD: { code: 'DZD', minorDecimals: 2, invoiceDecimals: 2, symbol: 'DA' },
  TND: { code: 'TND', minorDecimals: 3, invoiceDecimals: 3, symbol: 'DT' },
  KWD: { code: 'KWD', minorDecimals: 3, invoiceDecimals: 3, symbol: 'KD' },
  BHD: { code: 'BHD', minorDecimals: 3, invoiceDecimals: 3, symbol: 'BD' },
  OMR: { code: 'OMR', minorDecimals: 3, invoiceDecimals: 3, symbol: 'OMR' },
  JOD: { code: 'JOD', minorDecimals: 3, invoiceDecimals: 3, symbol: 'JOD' },
  JPY: { code: 'JPY', minorDecimals: 0, invoiceDecimals: 0, symbol: '¥' },
};

export function normalizeCurrencyCode(code?: string | null): string {
  const raw = String(code || 'MAD').toUpperCase().trim();
  if (!raw || raw === 'DH' || raw === 'MADH') return 'MAD';
  return raw;
}

export function getCurrencySpec(code?: string | null): CurrencySpec {
  const norm = normalizeCurrencyCode(code);
  const hit = CURRENCY_SPECS[norm];
  if (hit) return hit;
  return { code: norm, minorDecimals: 2, invoiceDecimals: 2, symbol: norm };
}

export function currencySymbol(code?: string | null): string {
  return getCurrencySpec(code).symbol;
}

function resolveDecimals(currencyOrDecimals?: string | number | null, stage: 'invoice' | 'ledger' = 'ledger'): number {
  if (typeof currencyOrDecimals === 'number') {
    if (!Number.isFinite(currencyOrDecimals)) return 2;
    return Math.max(0, Math.min(6, Math.trunc(currencyOrDecimals)));
  }
  const spec = getCurrencySpec(currencyOrDecimals);
  return stage === 'invoice' ? spec.invoiceDecimals : spec.minorDecimals;
}

/* ─────────────────── Exact Scaled-Decimal Rounding Primitives ─────────────────── */

/**
 * Exact decimal string scaling to avoid IEEE-754 half-way loss
 * (e.g. `1.005 * 100 === 100.49999999999999` in raw JS float).
 */
function jsMathRound(v: number): number {
  if (!Number.isFinite(v) || v === 0) return 0;
  if (Math.abs(v) >= 4503599627370496) return v;
  const t = Math.floor(v);
  const r = v - t >= 0.5 ? t + 1 : t;
  return r === 0 ? 0 : r;
}

function scaleToBigInt(value: number, decimals: number, mode: RoundingMode): bigint | null {
  if (!Number.isFinite(value)) return 0n;
  const d = Math.max(0, Math.min(8, Math.trunc(decimals)));
  if (value === 0) return 0n;
  const factor = 10 ** d;
  if (Math.abs(value) >= 4503599627370496 / factor) return null;
  const neg = value < 0;
  const abs = Math.abs(value);

  const str = abs.toPrecision(15);
  let digits: string;
  let exp10 = 0;

  const eIdx = str.indexOf('e');
  const mant = eIdx >= 0 ? str.slice(0, eIdx) : str;
  if (eIdx >= 0) {
    exp10 = Number(str.slice(eIdx + 1));
  }

  const dotIdx = mant.indexOf('.');
  if (dotIdx >= 0) {
    digits = mant.slice(0, dotIdx) + mant.slice(dotIdx + 1);
    exp10 -= mant.length - dotIdx - 1;
  } else {
    digits = mant;
  }

  digits = digits.replace(/^0+/, '') || '0';
  const shift = exp10 + d;

  let intPartStr: string;
  let fracStr: string;

  if (shift >= 0) {
    intPartStr = digits + '0'.repeat(shift);
    fracStr = '';
  } else {
    const cut = digits.length + shift;
    if (cut <= 0) {
      intPartStr = '0';
      fracStr = '0'.repeat(-cut) + digits;
    } else {
      intPartStr = digits.slice(0, cut);
      fracStr = digits.slice(cut);
    }
  }

  fracStr = fracStr.replace(/0+$/, '');
  let intVal = BigInt(intPartStr);

  if (fracStr.length > 0 && mode !== 'truncate') {
    const firstDigit = fracStr.charCodeAt(0) - 48;
    const hasMore = fracStr.length > 1;
    let roundUp = false;

    if (mode === 'half-up') {
      if (!neg) {
        roundUp = firstDigit >= 5;
      } else {
        roundUp = firstDigit > 5 || (firstDigit === 5 && hasMore);
      }
    } else if (mode === 'half-even') {
      if (firstDigit > 5 || (firstDigit === 5 && hasMore)) {
        roundUp = true;
      } else if (firstDigit === 5 && !hasMore) {
        roundUp = intVal % 2n === 1n;
      }
    }

    if (roundUp) intVal += 1n;
  }

  const signed = neg ? -intVal : intVal;
  return signed === 0n ? 0n : signed;
}

function scaleToIntegerWithMode(value: number, decimals: number, mode: RoundingMode): number | null {
  const scaled = scaleToBigInt(value, decimals, mode);
  if (scaled === null) return null;
  const num = Number(scaled);
  return num === 0 ? 0 : num;
}

export function roundWithMode(n: number, decimals = 2, mode: RoundingMode = 'half-up'): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  if (v === 0) return 0;
  const d = Math.max(0, Math.min(8, Math.trunc(decimals)));
  if (activeWasm) {
    const mCode = mode === 'half-even' ? 1 : mode === 'truncate' ? 2 : 0;
    const r = activeWasm.fc_round_with_mode(v, d, mCode);
    return r === 0 ? 0 : r;
  }
  if (d === 0 && mode === 'half-up') return jsMathRound(v);
  const factor = 10 ** d;
  if (Math.abs(v) >= 4503599627370496 / factor) return v;
  const scaled = scaleToIntegerWithMode(v, d, mode);
  if (scaled === null) return v;
  if (scaled === 0) return 0;
  if (d === 0) return scaled;
  const out = scaled / factor;
  return out === 0 ? 0 : out;
}

/** Half-up rounding to 2 decimals — treasury, payroll, document aging classification. */
export function round2(n: number): number {
  const v = Number(n);
  if (activeWasm) {
    const r = activeWasm.fc_round2(v);
    return r === 0 ? 0 : r;
  }
  return roundWithMode(v, 2, 'half-up');
}

/** Whole-dirham rounding — Moroccan Dirham invoices, quotes, VR, WR, UI totals. */
export function roundDh(n: unknown): number {
  const v = Number(n || 0);
  if (activeWasm) {
    const r = activeWasm.fc_round_dh(v);
    return r === 0 ? 0 : r;
  }
  return roundWithMode(v, 0, 'half-up');
}

/** 6-decimal rounding for `explicitInclusive` HT unit-price persistence. */
export function round6(n: number): number {
  const v = Number(n);
  if (activeWasm) {
    const r = activeWasm.fc_round6(v);
    return r === 0 ? 0 : r;
  }
  return roundWithMode(v, 6, 'half-up');
}

export function roundCurrency(
  n: number,
  currency: string = 'MAD',
  stage: 'invoice' | 'ledger' = 'ledger',
  mode: RoundingMode = 'half-up',
): number {
  const decimals = resolveDecimals(currency, stage);
  return roundWithMode(Number(n), decimals, mode);
}

export function roundTo(n: number | null | undefined, decimals = 2): number {
  return roundWithMode(Number(n || 0), decimals, 'half-up');
}

export function roundMoneyForCurrency(
  n: number | null | undefined,
  currency: string = 'MAD',
  stage: 'invoice' | 'ledger' = 'ledger',
): number {
  return roundCurrency(Number(n || 0), currency, stage, 'half-up');
}

export function fmtMoney(n: number | null | undefined, currency: string = 'MAD'): string {
  const spec = getCurrencySpec(currency);
  const dec = spec.invoiceDecimals;
  const rounded = roundWithMode(Number(n || 0), dec, 'half-up');
  const v = rounded.toLocaleString('fr-FR', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  });
  const sym = spec.symbol;
  if (sym === 'DH' || sym === 'DT' || sym === 'DA' || sym === 'KD' || sym === 'BD' || sym === 'OMR' || sym === 'JOD') {
    return `${v} ${sym}`;
  }
  if (sym === '€' || sym === '$' || sym === '£' || sym === '¥') return `${sym}${v}`;
  return `${v} ${sym}`;
}

/* ─────────────────── Integer Minor-Unit Monetary Operations ─────────────────── */

export function toMinorUnits(
  amount: number,
  currencyOrDecimals: string | number = 2,
  mode: RoundingMode = 'half-up',
): number {
  const d = resolveDecimals(currencyOrDecimals, 'ledger');
  const v = Number(amount);
  const scaled = scaleToIntegerWithMode(v, d, mode);
  if (scaled === null) return Number.isFinite(v) ? Math.trunc(v * 10 ** d) : 0;
  return scaled;
}

export function fromMinorUnits(minorUnits: number, currencyOrDecimals: string | number = 2): number {
  if (!Number.isFinite(minorUnits)) return 0;
  const d = resolveDecimals(currencyOrDecimals, 'ledger');
  if (d === 0) return minorUnits === 0 ? 0 : Math.trunc(minorUnits);
  const res = Math.trunc(minorUnits) / 10 ** d;
  return res === 0 ? 0 : res;
}

export function makeMoney(
  amount: number,
  currency: string = 'MAD',
  stage: 'invoice' | 'ledger' = 'ledger',
): MoneyValue {
  const code = normalizeCurrencyCode(currency);
  const decimals = resolveDecimals(code, stage);
  const scaled = scaleToIntegerWithMode(Number(amount), decimals, 'half-up');
  const minorUnits = scaled ?? 0;
  const normAmount = scaled === null ? roundWithMode(Number(amount), decimals, 'half-up') : (decimals === 0 ? minorUnits : minorUnits / 10 ** decimals);
  return {
    amount: normAmount === 0 ? 0 : normAmount,
    minorUnits,
    currency: code,
    decimals,
  };
}

function fromBigIntMinorUnits(minor: bigint, decimals: number): number {
  if (minor === 0n) return 0;
  if (decimals === 0) return Number(minor);
  const scale = 10n ** BigInt(decimals);
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const intPart = abs / scale;
  const fracPart = abs % scale;
  if (intPart <= BigInt(Number.MAX_SAFE_INTEGER)) {
    const out = Number(intPart) + Number(fracPart) / Number(scale);
    const signed = neg ? -out : out;
    return signed === 0 ? 0 : signed;
  }
  const str = `${neg ? '-' : ''}${intPart.toString()}.${fracPart.toString().padStart(decimals, '0')}`;
  const out = Number(str);
  return out === 0 ? 0 : out;
}

export function addMoneyAmounts(
  a: number,
  b: number,
  currencyOrDecimals: string | number = 2,
): number {
  const d = resolveDecimals(currencyOrDecimals, 'ledger');
  const ia = scaleToBigInt(Number(a), d, 'half-up');
  const ib = scaleToBigInt(Number(b), d, 'half-up');
  if (ia !== null && ib !== null) {
    return fromBigIntMinorUnits(ia + ib, d);
  }
  return roundWithMode(Number(a) + Number(b), d, 'half-up');
}

export function subMoneyAmounts(
  a: number,
  b: number,
  currencyOrDecimals: string | number = 2,
): number {
  const d = resolveDecimals(currencyOrDecimals, 'ledger');
  const ia = scaleToBigInt(Number(a), d, 'half-up');
  const ib = scaleToBigInt(Number(b), d, 'half-up');
  if (ia !== null && ib !== null) {
    return fromBigIntMinorUnits(ia - ib, d);
  }
  return roundWithMode(Number(a) - Number(b), d, 'half-up');
}

export function sumMoneyAmounts(
  values: ReadonlyArray<number>,
  currencyOrDecimals: string | number = 2,
): number {
  const d = resolveDecimals(currencyOrDecimals, 'ledger');
  let totalMinor = 0n;
  for (const v of values) {
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    const scaled = scaleToBigInt(n, d, 'half-up');
    if (scaled === null) {
      let acc = fromBigIntMinorUnits(totalMinor, d);
      for (const x of values) {
        if (Number.isFinite(Number(x))) acc += Number(x);
      }
      return roundWithMode(acc, d, 'half-up');
    }
    totalMinor += scaled;
  }
  return fromBigIntMinorUnits(totalMinor, d);
}

export function convertCurrency(
  amount: number,
  _fromCurrency: string,
  toCurrency: string,
  exchangeRate: number,
  mode: RoundingMode = 'half-up',
): number {
  const a = Number(amount);
  const r = Number(exchangeRate);
  if (!Number.isFinite(a) || !Number.isFinite(r) || r <= 0) return 0;
  const targetDecimals = resolveDecimals(toCurrency, 'ledger');
  return roundWithMode(a * r, targetDecimals, mode);
}

/* ─────────────────── Validation & Sanitization Guards ─────────────────── */

export function sanitizeFiniteNumber(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return n === 0 ? 0 : n;
}

export function sanitizeNonNegativeAmount(
  v: unknown,
  opts?: { max?: number; decimals?: number },
): number | null {
  if (v === '' || v === null || v === undefined || typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER) return null;
  if (opts?.max != null && n > opts.max) return null;
  const out = opts?.decimals != null ? roundWithMode(n, opts.decimals, 'half-up') : n;
  return out === 0 ? 0 : out;
}

export function sanitizePositiveAmount(
  v: unknown,
  opts?: { max?: number; decimals?: number },
): number | null {
  if (v === '' || v === null || v === undefined || typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > Number.MAX_SAFE_INTEGER) return null;
  if (opts?.max != null && n > opts.max) return null;
  const out = opts?.decimals != null ? roundWithMode(n, opts.decimals, 'half-up') : n;
  return out === 0 ? null : out;
}

export function remainingBalance(total: number, paid: number, decimals = 2): number {
  const t = roundWithMode(Number(total || 0), decimals, 'half-up');
  const p = roundWithMode(Number(paid || 0), decimals, 'half-up');
  const diff = subMoneyAmounts(t, p, decimals);
  return diff > 0 ? diff : 0;
}

/* ─────────────────────── Bulk Discounts & Line Pricing ─────────────────────── */

export type BulkTier = { min_qty: number; percent: number };

export function parseBulkDiscounts(raw: unknown): BulkTier[] {
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x: any) => ({ min_qty: Number(x?.min_qty || 0), percent: Number(x?.percent || 0) }))
      .filter((x) => Number.isFinite(x.min_qty) && Number.isFinite(x.percent) && x.min_qty > 0 && x.percent > 0 && x.percent <= 100)
      .sort((a, b) => b.min_qty - a.min_qty);
  } catch {
    return [];
  }
}

export function applyBulkDiscount(
  listPrice: number,
  qty: number,
  bulkRaw: unknown,
): { unit_price: number; bulk_percent: number } {
  const tiers = parseBulkDiscounts(bulkRaw);
  const list = Number(listPrice || 0);
  if (!Number.isFinite(list) || !Number.isFinite(qty) || list <= 0 || qty <= 0 || !tiers.length) {
    return { unit_price: Number.isFinite(list) && list >= 0 ? list : 0, bulk_percent: 0 };
  }
  if (activeWasm && tiers.length <= 256) {
    const w = activeWasm;
    const inBytes = tiers.length * 16;
    const outBytes = 16;
    const inPtr = w.fc_alloc(inBytes);
    const outPtr = w.fc_alloc(outBytes);
    if (inPtr && outPtr) {
      try {
        const inView = new Float64Array(w.memory.buffer, inPtr, tiers.length * 2);
        for (let i = 0; i < tiers.length; i++) {
          inView[i * 2] = tiers[i].min_qty;
          inView[i * 2 + 1] = tiers[i].percent;
        }
        const rc = w.fc_apply_bulk_discount(list, qty, inPtr, tiers.length, outPtr);
        if (rc === 0) {
          const outView = new Float64Array(w.memory.buffer, outPtr, 2);
          return { unit_price: outView[0], bulk_percent: outView[1] };
        }
      } finally {
        w.fc_dealloc(inPtr, inBytes);
        w.fc_dealloc(outPtr, outBytes);
      }
    } else {
      if (inPtr) w.fc_dealloc(inPtr, inBytes);
      if (outPtr) w.fc_dealloc(outPtr, outBytes);
    }
  }
  for (const t of tiers) {
    if (qty >= t.min_qty) {
      const unit = round2(list * (1 - t.percent / 100));
      return { unit_price: unit, bulk_percent: t.percent };
    }
  }
  return { unit_price: list, bulk_percent: 0 };
}

export function computeInvoiceBatchWasm(
  lines: ReadonlyArray<InvoiceLineCalcInput>,
  opts: {
    defaultTax: number;
    isQuickSale: boolean;
    taxExempt: boolean;
    explicitInclusive: boolean;
    currency?: string;
  },
): { lines: InvoiceLineCalcResult[]; totals: { subtotal: number; tax_amount: number; total: number } } | null {
  const w = activeWasm;
  if (!w || lines.length === 0 || lines.length > 4096) return null;
  const invDecimals = resolveDecimals(opts.currency || 'MAD', 'invoice');
  const inBytes = lines.length * 6 * 8;
  const outBytes = (lines.length * 11 + 3) * 8;
  const inPtr = w.fc_alloc(inBytes);
  const outPtr = w.fc_alloc(outBytes);
  if (!inPtr || !outPtr) {
    if (inPtr) w.fc_dealloc(inPtr, inBytes);
    if (outPtr) w.fc_dealloc(outPtr, outBytes);
    return null;
  }
  try {
    const inView = new Float64Array(w.memory.buffer, inPtr, lines.length * 6);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const b = i * 6;
      inView[b] = Number(l.quantity);
      inView[b + 1] = Number(l.unitPrice);
      inView[b + 2] = Number(l.listPrice);
      inView[b + 3] = l.taxRate != null ? Number(l.taxRate) : opts.defaultTax;
      inView[b + 4] = l.taxRate != null ? 1 : 0;
      inView[b + 5] = l.pricesTtc ? 1 : 0;
    }
    const rc = w.fc_compute_invoice_batch(
      inPtr,
      lines.length,
      outPtr,
      opts.defaultTax,
      opts.isQuickSale ? 1 : 0,
      opts.taxExempt ? 1 : 0,
      opts.explicitInclusive ? 1 : 0,
      invDecimals,
    );
    if (rc !== 0) return null;
    const outView = new Float64Array(w.memory.buffer, outPtr, lines.length * 11 + 3);
    const results: InvoiceLineCalcResult[] = [];
    for (let i = 0; i < lines.length; i++) {
      const ob = i * 11;
      results.push({
        unit_ht: outView[ob],
        list_ht: outView[ob + 1],
        stored_unit_price: outView[ob + 2],
        stored_list_price: outView[ob + 3],
        tax_rate: outView[ob + 4],
        line_ht: outView[ob + 5],
        line_tax_real: outView[ob + 6],
        line_ttc: outView[ob + 7],
        line_total: outView[ob + 8],
        discount_amount: outView[ob + 9],
        discount_percent: outView[ob + 10],
      });
    }
    const tail = lines.length * 11;
    return {
      lines: results,
      totals: {
        subtotal: outView[tail],
        tax_amount: outView[tail + 1],
        total: outView[tail + 2],
      },
    };
  } finally {
    w.fc_dealloc(inPtr, inBytes);
    w.fc_dealloc(outPtr, outBytes);
  }
}

export function computeInvoiceLinesAndTotals(
  lines: ReadonlyArray<InvoiceLineCalcInput>,
  opts: {
    defaultTax: number;
    isQuickSale: boolean;
    taxExempt: boolean;
    currency?: string;
  },
): { lines: InvoiceLineCalcResult[]; totals: { subtotal: number; tax_amount: number; total: number } } {
  const currency = opts.currency || 'MAD';
  if (lines.length === 0) {
    return { lines: [], totals: { subtotal: 0, tax_amount: 0, total: 0 } };
  }
  const allSameExplicit = lines.every((l) => Boolean(l.explicitInclusive) === Boolean(lines[0].explicitInclusive));
  if (activeWasm && allSameExplicit && lines.length <= 4096) {
    const wasmRes = computeInvoiceBatchWasm(lines, {
      defaultTax: opts.defaultTax,
      isQuickSale: opts.isQuickSale,
      taxExempt: opts.taxExempt,
      explicitInclusive: Boolean(lines[0].explicitInclusive),
      currency,
    });
    if (wasmRes) return wasmRes;
  }
  if (activeWasm) {
    const computed: InvoiceLineCalcResult[] = [];
    for (const l of lines) {
      const one = computeInvoiceBatchWasm([l], {
        defaultTax: opts.defaultTax,
        isQuickSale: opts.isQuickSale,
        taxExempt: opts.taxExempt,
        explicitInclusive: Boolean(l.explicitInclusive),
        currency,
      });
      computed.push(one ? one.lines[0] : computeInvoiceLine({ ...l, currency }));
    }
    return {
      lines: computed,
      totals: aggregateDocumentTotals(computed, currency),
    };
  }
  const computed = lines.map((l) => computeInvoiceLine({ ...l, currency }));
  return {
    lines: computed,
    totals: aggregateDocumentTotals(computed, currency),
  };
}

export interface InvoiceLineCalcInput {
  quantity: number;
  unitPrice: number;
  listPrice: number;
  taxRate?: number | null;
  defaultTax: number;
  pricesTtc: boolean;
  isQuickSale: boolean;
  taxExempt: boolean;
  explicitInclusive: boolean;
  currency?: string;
}

export interface InvoiceLineCalcResult {
  unit_ht: number;
  list_ht: number;
  stored_unit_price: number;
  stored_list_price: number;
  tax_rate: number;
  line_ht: number;
  line_tax_real: number;
  line_ttc: number;
  line_total: number;
  discount_amount: number;
  discount_percent: number;
}

export function computeInvoiceLine(inp: InvoiceLineCalcInput): InvoiceLineCalcResult {
  const qty = Number.isFinite(Number(inp.quantity)) && Number(inp.quantity) > 0 ? Number(inp.quantity) : 0;
  const rawUnit = Number(inp.unitPrice);
  const unitP = Number.isFinite(rawUnit) && rawUnit >= 0 ? rawUnit : 0;
  const rawList = Number(inp.listPrice);
  const listP = Number.isFinite(rawList) && rawList > 0 ? rawList : unitP;
  const invDecimals = resolveDecimals(inp.currency || 'MAD', 'invoice');

  const safeDefaultTax = Number.isFinite(Number(inp.defaultTax)) && Number(inp.defaultTax) >= 0
    ? Number(inp.defaultTax)
    : 0;

  let taxRate = inp.isQuickSale
    ? 0
    : Number(inp.taxRate ?? safeDefaultTax);

  if (!inp.isQuickSale) {
    if (!Number.isFinite(taxRate) || taxRate < 0) taxRate = safeDefaultTax;
    if (!inp.taxExempt && taxRate === 0 && safeDefaultTax > 0) taxRate = safeDefaultTax;
    if (inp.taxExempt) taxRate = 0;
  }

  let unitHt = unitP;
  let listHt = listP;
  if (inp.pricesTtc && taxRate > 0) {
    const factor = 1 + taxRate / 100;
    unitHt = unitP / factor;
    listHt = listP / factor;
  }

  const lineHt = qty * unitHt;
  const lineTtc = inp.pricesTtc && taxRate > 0 ? qty * unitP : lineHt * (1 + taxRate / 100);
  const lineTaxReal = lineTtc - lineHt;
  const discAmt = Math.max(0, listHt - unitHt) * qty;
  const discPct = listHt > 0 ? Math.max(0, ((listHt - unitHt) / listHt) * 100) : 0;

  return {
    unit_ht: unitHt,
    list_ht: listHt,
    stored_unit_price: inp.explicitInclusive ? round6(unitHt) : roundWithMode(unitHt, invDecimals, 'half-up'),
    stored_list_price: inp.explicitInclusive ? round6(listHt) : roundWithMode(listHt, invDecimals, 'half-up'),
    tax_rate: taxRate,
    line_ht: lineHt,
    line_tax_real: lineTaxReal,
    line_ttc: lineTtc,
    line_total: roundWithMode(lineTtc, invDecimals, 'half-up'),
    discount_amount: discAmt,
    discount_percent: discPct,
  };
}

export function aggregateDocumentTotals(
  lines: ReadonlyArray<{ line_ht: number; line_tax_real: number }>,
  currency: string = 'MAD',
): { subtotal: number; tax_amount: number; total: number } {
  const invDecimals = resolveDecimals(currency, 'invoice');
  let sub = 0;
  let tax = 0;
  for (const l of lines) {
    const lh = Number(l.line_ht || 0);
    const lt = Number(l.line_tax_real || 0);
    if (Number.isFinite(lh)) sub += lh;
    if (Number.isFinite(lt)) tax += lt;
  }
  const subtotal = roundWithMode(sub, invDecimals, 'half-up');
  const tax_amount = roundWithMode(tax, invDecimals, 'half-up');
  const total = addMoneyAmounts(subtotal, tax_amount, invDecimals);
  return { subtotal, tax_amount, total };
}

/* ─────────────────────── Supplier Bill Line & Total Engine ─────────────────────── */

export interface BillLineCalcInput {
  quantity: number;
  unitCost: number;
  taxRate?: number | null;
  defaultTax: number;
  currency?: string;
}

export interface BillLineCalcResult {
  quantity: number;
  unit_cost: number;
  tax_rate: number;
  line_ht: number;
  line_tax: number;
  line_total: number;
}

export function computeBillLine(inp: BillLineCalcInput): BillLineCalcResult {
  const qty = Number.isFinite(Number(inp.quantity)) && Number(inp.quantity) > 0 ? Number(inp.quantity) : 0;
  const cost = Number.isFinite(Number(inp.unitCost)) && Number(inp.unitCost) >= 0 ? Number(inp.unitCost) : 0;
  const defTax = Number.isFinite(Number(inp.defaultTax)) && Number(inp.defaultTax) >= 0 ? Number(inp.defaultTax) : 0;
  let rate = inp.taxRate != null ? Number(inp.taxRate) : defTax;
  if (!Number.isFinite(rate) || rate < 0) rate = defTax;

  const invDecimals = resolveDecimals(inp.currency || 'MAD', 'invoice');
  const lineHt = qty * cost;
  const lineTax = lineHt * (rate / 100);
  return {
    quantity: qty,
    unit_cost: cost,
    tax_rate: rate,
    line_ht: lineHt,
    line_tax: lineTax,
    line_total: roundWithMode(lineHt + lineTax, invDecimals, 'half-up'),
  };
}

/* ─────────────────────── Payments & Refund (WR) Splits ─────────────────────── */

export interface PaymentApplicationResult {
  applied: number;
  next_paid: number;
  remaining: number;
  status: 'paid' | 'partial';
}

export function computePaymentApplication(
  requestedAmount: number,
  docTotal: number,
  alreadyPaid: number,
  currency: string = 'MAD',
): PaymentApplicationResult | null {
  const spec = getCurrencySpec(currency);
  const invDecimals = spec.invoiceDecimals;
  const payDecimals = spec.minorDecimals;
  const req = Number(requestedAmount);
  if (!Number.isFinite(req) || req <= 0) return null;
  const total = roundWithMode(Number(docTotal || 0), invDecimals, 'half-up');
  const prev = roundWithMode(Number(alreadyPaid || 0), payDecimals, 'half-up');
  const remainingBefore = Math.max(0, subMoneyAmounts(total, prev, payDecimals));
  if (remainingBefore <= 0.001) return null;

  const roundedReq = roundWithMode(req, payDecimals, 'half-up');
  const applied = roundWithMode(Math.min(roundedReq, remainingBefore), payDecimals, 'half-up');
  if (applied <= 0) return null;

  const nextPaid = addMoneyAmounts(prev, applied, payDecimals);
  const rem = Math.max(0, subMoneyAmounts(total, nextPaid, payDecimals));
  const status: 'paid' | 'partial' = rem <= 0.001 ? 'paid' : 'partial';
  return {
    applied,
    next_paid: nextPaid,
    remaining: rem <= 0.001 ? 0 : rem,
    status,
  };
}

export interface RefundSplitResult {
  credit_vs_debt: number;
  cash_refund: number;
  next_paid: number;
  new_status: 'paid' | 'partial' | 'sent' | string;
}

export function computeRefundSplit(
  refundTotal: number,
  sourceTotal: number,
  sourcePaid: number,
  sourceStatus: string,
  currency: string = 'MAD',
): RefundSplitResult {
  const invDecimals = resolveDecimals(currency, 'invoice');
  const rawTotal = Number(refundTotal);
  const rawSrcTotal = Number(sourceTotal);
  const rawSrcPaid = Number(sourcePaid);
  const safeSrcTotal = Number.isFinite(rawSrcTotal) && rawSrcTotal >= 0 ? rawSrcTotal : 0;
  const safeSrcPaid = Number.isFinite(rawSrcPaid) && rawSrcPaid >= 0 ? Math.min(rawSrcPaid, safeSrcTotal) : 0;
  const safeRefundTotal = Number.isFinite(rawTotal) && rawTotal >= 0
    ? Math.min(rawTotal, safeSrcTotal)
    : 0;

  if (activeWasm) {
    const w = activeWasm;
    const outPtr = w.fc_alloc(32);
    if (outPtr) {
      try {
        const rc = w.fc_compute_refund_split(
          safeRefundTotal,
          safeSrcTotal,
          safeSrcPaid,
          sourceStatus === 'paid' ? 1 : 0,
          invDecimals,
          outPtr,
        );
        if (rc === 0) {
          const out = new Float64Array(w.memory.buffer, outPtr, 4);
          const code = out[3];
          const newStatus = code === 2 ? 'paid' : code === 1 ? 'partial' : (sourceStatus === 'paid' ? 'paid' : 'sent');
          return {
            credit_vs_debt: out[0],
            cash_refund: out[1],
            next_paid: out[2],
            new_status: newStatus,
          };
        }
      } finally {
        w.fc_dealloc(outPtr, 32);
      }
    }
  }

  const total = roundWithMode(safeRefundTotal, invDecimals, 'half-up');
  const paid = safeSrcPaid;
  const srcTotal = roundWithMode(safeSrcTotal, invDecimals, 'half-up');
  const remaining = Math.max(0, subMoneyAmounts(srcTotal, paid, invDecimals));
  const fullyPaid = remaining <= 0.001 || sourceStatus === 'paid' || paid + 0.001 >= srcTotal;

  let creditVsDebt = fullyPaid ? 0 : Math.min(total, remaining);
  let cashRefund = fullyPaid ? total : Math.max(0, subMoneyAmounts(total, creditVsDebt, invDecimals));
  creditVsDebt = roundWithMode(creditVsDebt, invDecimals, 'half-up');
  cashRefund = roundWithMode(cashRefund, invDecimals, 'half-up');

  let nextPaid = paid;
  let newStatus = sourceStatus;
  if (creditVsDebt > 0.001) {
    nextPaid = Math.max(0, Math.min(srcTotal, addMoneyAmounts(paid, creditVsDebt, Math.max(invDecimals, 2))));
    if (nextPaid >= srcTotal - 0.001) newStatus = 'paid';
    else if (nextPaid > 0.001) newStatus = 'partial';
    else newStatus = sourceStatus === 'paid' ? 'paid' : 'sent';
  } else if (cashRefund > 0.001 && creditVsDebt < 0.001) {
    nextPaid = paid;
    newStatus = fullyPaid || paid >= srcTotal - 0.001 ? 'paid' : (paid > 0.001 ? 'partial' : newStatus);
  }

  return {
    credit_vs_debt: creditVsDebt,
    cash_refund: cashRefund,
    next_paid: nextPaid,
    new_status: newStatus,
  };
}

/* ─────────────────────── Inventory Valuation & Costing ─────────────────────── */

export function computeMovingAverageCost(
  onHandQty: number,
  oldCost: number,
  qtyBought: number,
  unitCost: number,
): number | null {
  const qty = Number(qtyBought);
  const price = Number(unitCost);
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price < 0) return null;
  const onHand = Math.max(0, Number.isFinite(Number(onHandQty)) ? Number(onHandQty) : 0);
  const prevCost = Number.isFinite(Number(oldCost)) && Number(oldCost) >= 0 ? Number(oldCost) : 0;
  if (onHand <= 1e-9) return roundWithMode(price, 4, 'half-up');
  const next = (onHand * prevCost + qty * price) / (onHand + qty);
  return roundWithMode(next, 4, 'half-up');
}

export interface InventoryValuationRow {
  stock_quantity?: number | null;
  cost?: number | null;
  price?: number | null;
  track_inventory?: number | boolean | null;
}

export function computeInventoryValuation(
  rows: ReadonlyArray<InventoryValuationRow>,
  currency: string = 'MAD',
): {
  cost_total: number;
  sell_total: number;
  potential_margin: number;
  margin_percent: number | null;
  tracked_units: number;
} {
  const d = resolveDecimals(currency, 'ledger');
  let costAcc = 0;
  let sellAcc = 0;
  let units = 0;
  for (const r of rows) {
    const qty = Number(r.stock_quantity || 0);
    const cost = Number(r.cost || 0);
    const price = Number(r.price || 0);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    if (Number.isFinite(cost) && cost >= 0) costAcc += qty * cost;
    if (Number.isFinite(price) && price >= 0) sellAcc += qty * price;
    if (r.track_inventory) units += qty;
  }
  const cost_total = roundWithMode(costAcc, d, 'half-up');
  const sell_total = roundWithMode(sellAcc, d, 'half-up');
  const potential_margin = subMoneyAmounts(sell_total, cost_total, d);
  const margin_percent = cost_total > 0 ? roundWithMode((potential_margin / cost_total) * 100, 1, 'half-up') : null;
  return { cost_total, sell_total, potential_margin, margin_percent, tracked_units: roundWithMode(units, 4, 'half-up') };
}

/* ─────────────────────── Frontend Preview Helpers ─────────────────────── */

export function estimateInvoiceLineTtc(opts: {
  quantity: number;
  unitPrice: number;
  productTaxRate?: number | null;
  defaultTax: number;
  taxExempt: boolean;
  isQuote: boolean;
  priceModeExclusive: boolean;
  currency?: string;
}): number {
  const qty = Number.isFinite(Number(opts.quantity)) && Number(opts.quantity) > 0 ? Number(opts.quantity) : 0;
  const price = Number.isFinite(Number(opts.unitPrice)) && Number(opts.unitPrice) >= 0 ? Number(opts.unitPrice) : 0;
  const amount = qty * price;
  const pt = Number(opts.productTaxRate || 0);
  const rate = pt > 0 ? pt : opts.defaultTax;
  const raw = !opts.taxExempt && (opts.isQuote || opts.priceModeExclusive)
    ? amount * (1 + rate / 100)
    : amount;
  return roundCurrency(raw, opts.currency || 'MAD', 'invoice');
}

export function computeQuoteDraftTotals(
  items: ReadonlyArray<{ quantity?: number; unit_price?: number; tax_rate?: number }>,
  taxExempt: boolean,
  currency: string = 'MAD',
): { ht: number; tax: number; ttc: number } {
  const invDecimals = resolveDecimals(currency, 'invoice');
  let htRaw = 0;
  let taxRaw = 0;
  for (const it of items) {
    const q = Number(it.quantity || 0);
    const p = Number(it.unit_price || 0);
    if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p < 0) continue;
    const line = q * p;
    htRaw += line;
    const rate = taxExempt ? 0 : Math.max(0, Number(it.tax_rate ?? 20) || 0);
    taxRaw += line * (rate / 100);
  }
  const ht = roundWithMode(htRaw, invDecimals, 'half-up');
  const tax = roundWithMode(taxRaw, invDecimals, 'half-up');
  return { ht, tax, ttc: addMoneyAmounts(ht, tax, invDecimals) };
}

/* ─────────────────────── Dates, Aging & Payroll ─────────────────────── */

export function isValidYmd(y: number, m: number, d: number): boolean {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1 || y > 9999 || m < 1 || m > 12 || d < 1) return false;
  if (activeWasm) {
    return activeWasm.fc_is_valid_ymd(y, m, d) === 1;
  }
  const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const maxDay = m === 2 ? (isLeap ? 29 : 28) : (m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31);
  return d <= maxDay;
}

function parseStrictYmdParts(ymd: string): [number, number, number] | null {
  const s = String(ymd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  if (!isValidYmd(y, m, d)) return null;
  return [y, m, d];
}

export function isValidPeriod(p: string): boolean {
  const s = String(p || '');
  if (activeWasm && textEncoder) {
    const res = withWasmBytes(textEncoder.encode(s), (w, ptr, len) => w.fc_validate_period(ptr, len));
    if (res !== null) return res === 1;
  }
  return /^(\d{4})-(0[1-9]|1[0-2])$/.test(s);
}

export function monthBounds(period: string): { start: string; end: string; nextStart: string } {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  const start = `${period}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${period}-${String(lastDay).padStart(2, '0')}`;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const nextStart = `${ny}-${String(nm).padStart(2, '0')}-01`;
  return { start, end, nextStart };
}

export function prevPeriod(period: string): string {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function addDaysYmd(ymd: string, days: number): string {
  const parts = parseStrictYmdParts(ymd);
  if (!parts) return ymd;
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function daysBetweenYmd(from: string, to: string): number {
  const a = parseStrictYmdParts(from);
  const b = parseStrictYmdParts(to);
  if (!a || !b) return 0;
  if (activeWasm) {
    const diff = activeWasm.fc_days_between(a[0], a[1], a[2], b[0], b[1], b[2]);
    if (diff !== -2147483648) return diff;
  }
  const d0 = Date.UTC(a[0], a[1] - 1, a[2]);
  const d1 = Date.UTC(b[0], b[1] - 1, b[2]);
  return Math.floor((d1 - d0) / 86400000);
}

export type DocMoneyState = 'paid' | 'partial' | 'unpaid' | 'overdue';

export function classifyDoc(
  total: number,
  paid: number,
  dueDate: string | null,
  todayYmd: string,
): { state: DocMoneyState; remaining: number; overdue: boolean } {
  if (activeWasm) {
    const todayParts = parseStrictYmdParts(todayYmd);
    const dueParts = dueDate ? parseStrictYmdParts(dueDate) : null;
    if (todayParts && (!dueDate || dueParts)) {
      const code = activeWasm.fc_classify_doc_state(
        Number(total),
        Number(paid),
        dueParts ? 1 : 0,
        dueParts ? dueParts[0] : 0,
        dueParts ? dueParts[1] : 0,
        dueParts ? dueParts[2] : 0,
        todayParts[0],
        todayParts[1],
        todayParts[2],
      );
      if (code >= 0) {
        const remaining = activeWasm.fc_classify_doc_remaining(Number(total), Number(paid));
        const state: DocMoneyState = code === 0 ? 'paid' : code === 3 ? 'overdue' : code === 1 ? 'partial' : 'unpaid';
        return { state, remaining: remaining === 0 ? 0 : remaining, overdue: state === 'overdue' };
      }
    }
  }
  const t = round2(total);
  const p = round2(paid);
  const remaining = Math.max(0, subMoneyAmounts(t, p, 2));
  const dueParts = dueDate ? parseStrictYmdParts(dueDate) : null;
  const due = dueParts ? String(dueDate).slice(0, 10) : '';
  const overdue = !!due && due < todayYmd && remaining > 0.005;
  if (remaining <= 0.005) return { state: 'paid', remaining: 0, overdue: false };
  if (overdue) return { state: 'overdue', remaining, overdue: true };
  if (p > 0.005) return { state: 'partial', remaining, overdue: false };
  return { state: 'unpaid', remaining, overdue: false };
}

export type PayrollEmployeeInput = {
  id: number;
  emp_number?: string | null;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  pay_amount?: number | null;
  pay_cycle_type?: string | null;
  pay_cycle_days?: number | null;
  last_paid_at?: string | null;
  joined_date?: string | null;
  active?: number | null;
};

export function payrollCycleDays(row: PayrollEmployeeInput): number {
  const t = String(row.pay_cycle_type || 'monthly');
  if (t === 'monthly') return 30;
  const d = Number(row.pay_cycle_days || 7);
  return Math.max(1, Math.min(365, d || 7));
}

export function computePayrollObligation(
  row: PayrollEmployeeInput,
  asOfYmd: string,
  advancesInPeriod: number,
): {
  employee_id: number;
  display_name: string;
  amount_due: number;
  pay_period: { from: string; to: string };
  due_date: string | null;
  daily_rate: number;
} | null {
  if (Number(row.active ?? 1) === 0) return null;
  const amount = Number(row.pay_amount || 0);
  if (!Number.isFinite(amount) || !(amount > 0)) return null;
  const cycle = payrollCycleDays(row);
  const last = row.last_paid_at ? String(row.last_paid_at).slice(0, 10) : '';
  const joined = row.joined_date ? String(row.joined_date).slice(0, 10) : '';
  const anchor = last || joined;
  const anchorParts = parseStrictYmdParts(anchor);
  const asOfParts = parseStrictYmdParts(asOfYmd);
  if (!anchorParts || !asOfParts) return null;

  const dueDate = addDaysYmd(anchor, cycle);
  let net: number;
  let dailyRate: number;

  if (activeWasm) {
    const w = activeWasm;
    const outPtr = w.fc_alloc(16);
    if (outPtr) {
      try {
        const adv = Math.max(0, Number.isFinite(Number(advancesInPeriod)) ? Number(advancesInPeriod) : 0);
        const rc = w.fc_compute_payroll(
          1,
          amount,
          cycle,
          anchorParts[0],
          anchorParts[1],
          anchorParts[2],
          asOfParts[0],
          asOfParts[1],
          asOfParts[2],
          adv,
          outPtr,
        );
        if (rc === 0) {
          const out = new Float64Array(w.memory.buffer, outPtr, 2);
          net = out[0];
          dailyRate = out[1];
          const fn = String(row.first_name || '').trim();
          const ln = String(row.last_name || '').trim();
          const display = (fn || ln ? `${fn} ${ln}`.trim() : String(row.name || '').trim()) || '—';
          return {
            employee_id: Number(row.id),
            display_name: display,
            amount_due: net,
            pay_period: { from: anchor, to: dueDate },
            due_date: dueDate,
            daily_rate: dailyRate,
          };
        }
      } finally {
        w.fc_dealloc(outPtr, 16);
      }
    }
  }

  dailyRate = round2(amount / cycle);
  const elapsed = Math.max(0, Math.min(cycle, daysBetweenYmd(anchor, asOfYmd)));
  const gross = round2((elapsed / cycle) * amount);
  const adv = Math.max(0, round2(advancesInPeriod));
  net = Math.max(0, subMoneyAmounts(gross, adv, 2));

  const fn = String(row.first_name || '').trim();
  const ln = String(row.last_name || '').trim();
  const display = (fn || ln ? `${fn} ${ln}`.trim() : String(row.name || '').trim()) || '—';
  return {
    employee_id: Number(row.id),
    display_name: display,
    amount_due: net,
    pay_period: { from: anchor, to: dueDate },
    due_date: dueDate,
    daily_rate: dailyRate,
  };
}

/* ─────────────────────── Balance Report Aggregation ─────────────────────── */

export type BalanceEntryLike = {
  entry_type?: string | null;
  payment_method?: string | null;
  amount?: number | string | null;
};

export function summarizeBalanceTotals<T extends BalanceEntryLike>(rows: T[], currency: string = 'MAD') {
  const d = resolveDecimals(currency, 'ledger');
  let cashIn = 0;
  let cashOut = 0;
  let bankIn = 0;
  let bankOut = 0;
  let ownerDraw = 0;
  let ownerContrib = 0;
  let income = 0;
  let expense = 0;

  for (const e of rows) {
    const val = Number(e.amount || 0);
    if (!Number.isFinite(val)) continue;
    const minor = toMinorUnits(val, d);
    const et = e.entry_type;
    const isInc = et === 'income' || et === 'owner_contrib';
    const isCash = !e.payment_method || e.payment_method === 'cash';

    if (isInc) {
      if (isCash) cashIn += minor;
      else bankIn += minor;
    } else {
      if (isCash) cashOut += minor;
      else bankOut += minor;
    }

    if (et === 'owner_draw') ownerDraw += minor;
    else if (et === 'owner_contrib') ownerContrib += minor;
    else if (et === 'income') income += minor;
    else if (et === 'expense' || !et) expense += minor;
  }

  return {
    rows,
    cashIn: fromMinorUnits(cashIn, d),
    cashOut: fromMinorUnits(cashOut, d),
    bankIn: fromMinorUnits(bankIn, d),
    bankOut: fromMinorUnits(bankOut, d),
    ownerDraw: fromMinorUnits(ownerDraw, d),
    ownerContrib: fromMinorUnits(ownerContrib, d),
    income: fromMinorUnits(income, d),
    expense: fromMinorUnits(expense, d),
  };
}

/* ─────────────────────── Validation Core Helpers ─────────────────────── */

export function validateCreditPrefixCore(
  raw: unknown,
): { ok: true; value: string } | { ok: false; error: string; code: string } {
  const v = String(raw ?? '').trim();
  if (!v) {
    return { ok: false, error: 'Le préfixe des remboursements (WR) est obligatoire (ex. WR-).', code: 'WR_PREFIX_INVALID' };
  }
  let valid = v.length <= 12 && /^[A-Za-z0-9][A-Za-z0-9\-/]{0,11}$/.test(v);
  if (activeWasm && textEncoder) {
    const res = withWasmBytes(textEncoder.encode(v), (w, ptr, len) => w.fc_validate_credit_prefix(ptr, len));
    if (res !== null) valid = res === 1;
  }
  if (!valid) {
    return {
      ok: false,
      error: 'Préfixe WR invalide. Utilisez 1 à 12 caractères (lettres, chiffres, tiret ou slash), ex. WR- ou AVOIR-.',
      code: 'WR_PREFIX_INVALID',
    };
  }
  return { ok: true, value: v };
}

export function validateNextCreditNumberCore(
  raw: unknown,
): { ok: true; value: number } | { ok: false; error: string; code: string } {
  const n = Number(raw);
  const valid = activeWasm
    ? activeWasm.fc_validate_next_credit_number(n) === 1
    : (Number.isFinite(n) && n >= 1 && n <= 999999999 && Math.floor(n) === n);
  if (!valid) {
    return {
      ok: false,
      error: 'Le prochain numéro WR doit être un entier ≥ 1.',
      code: 'WR_NUMBER_INVALID',
    };
  }
  return { ok: true, value: n };
}
