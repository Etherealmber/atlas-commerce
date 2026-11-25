/**
 * Real comparison chip: "+8 (+133 %)" with the previous value spelled out in
 * the tooltip/screen-reader text. Unlike MetricTrend (global daily series),
 * this one compares two numbers the caller actually fetched for the selected
 * period, so it changes when the period changes.
 */
const intFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const pctFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });

export function deltaOf(current: number, previous: number | null | undefined) {
  if (previous === null || previous === undefined || !Number.isFinite(previous)) return null;
  const diff = current - previous;
  const pct = previous === 0 ? (current === 0 ? 0 : null) : (diff / previous) * 100;
  return { diff, pct, direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat' } as const;
}

export function DeltaChip({
  current,
  previous,
  against,
  invert = false,
}: {
  current: number;
  previous: number | null | undefined;
  /** e.g. "les 24 h précédentes" */
  against: string;
  /** true when going down is good (debts, errors…) */
  invert?: boolean;
}) {
  const d = deltaOf(current, previous);
  if (!d) return null;
  const good = d.direction === 'flat' ? null : (d.direction === 'up') !== invert;
  const tone = good === null ? 'is-flat' : good ? 'is-good' : 'is-bad';
  const sign = d.diff > 0 ? '+' : d.diff < 0 ? '−' : '±';
  const abs = `${sign}${intFmt.format(Math.abs(d.diff))}`;
  const pct = d.pct === null ? 'nouveau' : `${d.pct > 0 ? '+' : d.pct < 0 ? '−' : ''}${pctFmt.format(Math.abs(d.pct))} %`;
  const title = `${abs} (${pct}) — ${intFmt.format(previous as number)} sur ${against}`;
  return (
    <span className={`ms-trend ac-delta-chip ${tone}`} title={title} data-delta-chip>
      <span>{abs}</span>
      <span className="ac-delta-chip-pct">{pct}</span>
      <span className="sr-only"> — {intFmt.format(previous as number)} sur {against}</span>
    </span>
  );
}
