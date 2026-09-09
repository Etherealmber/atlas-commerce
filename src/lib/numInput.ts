/**
 * Number fields: never show 0 — empty string in the UI.
 * type="text" + inputMode="decimal" avoids browser forcing 0 on <input type="number">.
 * Empty still saves as 0 when the API expects a number.
 */

/** Display value: blank for 0 / null / undefined / "" */
export function numStr(v: number | string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n === 0) return '';
  return String(v);
}

/** Parse typing → number; empty → 0 (allowed on save) */
export function numFromInput(raw: string): number {
  const t = String(raw ?? '').trim().replace(',', '.');
  if (t === '' || t === '-' || t === '.' || t === '-.') return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

/** Keep '' while typing empty; otherwise number */
export function numFromInputOrEmpty(raw: string): number | '' {
  const t = String(raw ?? '').trim().replace(',', '.');
  if (t === '' || t === '-' || t === '.' || t === '-.') return '';
  const n = Number(t);
  return Number.isFinite(n) ? n : '';
}

export function numOrZero(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** Shared props for money / qty fields (no forced zero) */
export const numFieldProps = {
  type: 'text' as const,
  inputMode: 'decimal' as const,
  autoComplete: 'off' as const,
};
