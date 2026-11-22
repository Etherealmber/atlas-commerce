/**
 * Money helpers — backed by shared/financeCore.ts so UI previews match Worker calculations.
 * Moroccan dirham (MAD) displayed as DH (whole dirhams for MAD; currency-aware for non-2-decimal currencies).
 */
import {
  currencySymbol,
  fmtMoney as coreFmtMoney,
  getCurrencySpec,
  normalizeCurrencyCode,
  remainingBalance,
  round2,
  roundDh,
  roundMoneyForCurrency,
} from '../../shared/financeCore';

export {
  currencySymbol,
  getCurrencySpec,
  normalizeCurrencyCode,
  remainingBalance,
  round2,
  roundDh,
  roundMoneyForCurrency,
};

/** Round to nearest whole dirham (MAD client-facing convention) or currency default. */
export function roundMoney(n: number | null | undefined, currency = 'MAD'): number {
  const code = normalizeCurrencyCode(currency);
  if (code === 'MAD') return roundDh(n);
  return roundMoneyForCurrency(n, code);
}

/** 2-decimal internal rounding with exact decimal scaling (never raw Math.round(x * 100) / 100). */
export function roundMoney2(n: number | null | undefined): number {
  return round2(Number(n ?? 0));
}

/**
 * Format for UI: "1 234 DH" for MAD, or decimal-aware for EUR/USD/TND/JPY.
 */
export function fmtMoney(n: number | null | undefined, currency = 'MAD'): string {
  return coreFmtMoney(n, currency);
}

export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Espèces (caisse)' },
  { value: 'bank_company', label: 'Virement bancaire — compte société' },
  { value: 'bank_owner', label: 'Virement bancaire — compte propriétaire' },
  { value: 'check_company', label: 'Chèque — à l’ordre de la société' },
  { value: 'check_owner', label: 'Chèque — à l’ordre du propriétaire' },
  { value: 'card', label: 'Carte bancaire' },
  { value: 'other', label: 'Autre' },
] as const;

export function paymentMethodLabel(code?: string): string {
  const m = PAYMENT_METHODS.find((x) => x.value === code);
  if (m) return m.label;
  const legacy: Record<string, string> = {
    bank: 'Virement bancaire',
    check: 'Chèque',
    cash: 'Espèces',
  };
  return legacy[code || ''] || code || '—';
}
