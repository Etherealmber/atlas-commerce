
/** Parse typing → number; empty → 0 (allowed on save) */
export function numFromInput(raw: string): number {
  const t = String(raw ?? '').trim().replace(',', '.');
  if (t === '' || t === '-' || t === '.' || t === '-.') return 0;
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}



