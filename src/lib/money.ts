/**
 * Money helpers — Moroccan dirham (MAD) displayed as DH.
 * Client-facing amounts are whole dirhams (no cents): 115.49 → 115, 115.79 → 116.
 */

const SYMBOLS: Record<string, string> = {
  MAD: 'DH',
  MADH: 'DH',
  DH: 'DH',
  EUR: '€',
  USD: '$',
  GBP: '£',
  TND: 'DT',
  DZD: 'DA',
  CAD: 'CA$',
};

export function currencySymbol(code?: string): string {
  const c = (code || 'MAD').toUpperCase();
  return SYMBOLS[c] || c;
}

export function normalizeCurrencyCode(code?: string): string {
  const c = (code || 'MAD').toUpperCase().trim();
  if (c === 'DH' || c === 'MADH') return 'MAD';
  return c || 'MAD';
}

/** Round to nearest whole dirham (clients do not use fractions). */
export function roundMoney(n: number | null | undefined): number {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x);
}

/** 2-decimal internal (rare); prefer roundMoney for UI. */
export function roundMoney2(n: number | null | undefined): number {
  const x = Number(n || 0);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

/**
 * Format for UI: "1 234 DH" — whole numbers only.
 */
export function fmtMoney(n: number | null | undefined, currency = 'MAD'): string {
  const v = roundMoney(n).toLocaleString('fr-FR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const code = normalizeCurrencyCode(currency);
  const sym = currencySymbol(code);
  if (sym === 'DH' || sym === 'DT' || sym === 'DA') return `${v} ${sym}`;
  if (sym === '€' || sym === '$' || sym === '£') return `${sym}${v}`;
  return `${v} ${sym}`;
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
