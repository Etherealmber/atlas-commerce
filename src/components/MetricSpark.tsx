import { useId, useMemo, useRef, useState, type PointerEvent } from 'react';
import { computeTrend, isEmptySeries, shortDay, useMetricSeries, type TrendCompare } from '../lib/metricSeries';
import './metric-spark.css';

/**
 * KPI cards « façon Cloudflare »:
 *   <div className="ac-metric">
 *     <div className="as-label">Ventes</div>
 *     <div className="as-value">1 250 MAD <MetricTrend k="sales" /></div>
 *     <MetricSpark k="sales" unit="money" />
 *   </div>
 * The trend chip sits next to the value; the sparkline fills the bottom edge of
 * the card. No data → a faint flat line with an « Aucune donnée » pill.
 */

type Unit = 'count' | 'money';

interface CommonProps {
  /** Series key from GET /api/metrics/daily. */
  k: string;
  /** Rising is bad (dépenses, stock bas, créances…): colours are swapped. */
  invert?: boolean;
}

const pctFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });

function ArrowIcon({ up }: { up: boolean }) {
  return (
    <svg className="ms-svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {up ? <path d="M7 17 17 7M8 7h9v9" /> : <path d="M7 7l10 10M17 8v9H8" />}
    </svg>
  );
}

export function MetricTrend({ k, invert = false, compare = 'period' }: CommonProps & { compare?: TrendCompare }) {
  const { data } = useMetricSeries();
  const trend = useMemo(() => {
    if (!data) return null;
    const values = data.series[k];
    if (!values || isEmptySeries(values, data.kinds[k] || 'flow')) return null;
    return computeTrend(data.series[k], data.kinds[k] || 'flow', data.dates, compare);
  }, [data, k, compare]);
  if (!trend) return null;
  const good = trend.direction === 'flat' ? null : (trend.direction === 'up') !== invert;
  const tone = good === null ? 'is-flat' : good ? 'is-good' : 'is-bad';
  const label = `${trend.pct > 0 ? '+' : trend.pct < 0 ? '−' : ''}${pctFmt.format(Math.abs(trend.pct))} %`;
  return (
    <span className={`ms-trend ${tone}`} title={`${label} ${trend.against}`} data-metric-trend={k}>
      {trend.direction !== 'flat' ? <ArrowIcon up={trend.direction === 'up'} /> : null}
      <span>{pctFmt.format(Math.abs(trend.pct))}%</span>
      <span className="sr-only"> {trend.direction === 'up' ? 'en hausse' : trend.direction === 'down' ? 'en baisse' : 'stable'} {trend.against}</span>
    </span>
  );
}

const W = 100;
const H = 40;
const PAD_TOP = 6;
const PAD_BOTTOM = 3;

/** One SVG path per run of known values (gaps stay gaps). */
function buildPaths(values: (number | null)[]) {
  const known = values.filter((v): v is number => v !== null);
  // Scale to the series' own range (Cloudflare-style) so a 118 → 121 stock
  // level still reads as a trend; a constant series sits mid-height.
  let min = Math.min(...known);
  let max = Math.max(...known);
  if (max - min < 1e-9) { min -= 1; max += 1; }
  const pad = (max - min) * 0.08;
  min -= pad; max += pad;
  const span = max - min;
  const n = values.length;
  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => PAD_TOP + (1 - (v - min) / span) * (H - PAD_TOP - PAD_BOTTOM);
  const runs: Array<Array<[number, number]>> = [];
  let run: Array<[number, number]> = [];
  values.forEach((v, i) => {
    if (v === null) { if (run.length) runs.push(run); run = []; return; }
    run.push([x(i), y(v)]);
  });
  if (run.length) runs.push(run);
  const line = runs.map((r) => r.map(([px, py], j) => `${j ? 'L' : 'M'}${px.toFixed(2)},${py.toFixed(2)}`).join('')).join('');
  const area = runs
    .filter((r) => r.length > 1)
    .map((r) => `M${r[0][0].toFixed(2)},${H}` + r.map(([px, py]) => `L${px.toFixed(2)},${py.toFixed(2)}`).join('') + `L${r[r.length - 1][0].toFixed(2)},${H}Z`)
    .join('');
  return { line, area, y, x };
}

export function MetricSpark({ k, invert = false, unit = 'count', currency = 'MAD' }: CommonProps & { unit?: Unit; currency?: string }) {
  const { data, loading } = useMetricSeries();
  const gid = useId().replace(/:/g, '');
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const values = data?.series[k];
  const kind = data?.kinds[k] || 'flow';
  const empty = !values || isEmptySeries(values, kind);
  const paths = useMemo(() => (values && !empty ? buildPaths(values) : null), [values, empty]);

  if (!data) {
    // Not loaded (or not allowed for this role): keep the card height stable.
    return <div className={`ms-spark ${loading ? 'is-loading' : 'is-idle'}`} aria-hidden="true" />;
  }

  if (empty || !paths) {
    return (
      <div className="ms-spark is-empty" data-metric-spark={k}>
        <svg className="ms-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <path className="ms-wave" d="M0,26 C10,22 18,30 28,26 S46,22 56,26 S74,30 84,26 S96,23 100,25" />
        </svg>
        <span className="ms-empty-pill">Aucune donnée</span>
      </div>
    );
  }

  const fmt = (v: number) => (unit === 'money'
    ? `${v.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} ${currency}`
    : v.toLocaleString('fr-FR', { maximumFractionDigits: 1 }));
  const n = values!.length;
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    const i = Math.round(((e.clientX - box.left) / box.width) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const hv = hover === null ? null : values![hover];
  const firstDay = data.dates[0] ? shortDay(data.dates[0]) : '';
  const lastDay = data.dates[n - 1] ? shortDay(data.dates[n - 1]) : '';
  let latest: number | null = null;
  for (let i = n - 1; i >= 0; i--) { if (values![i] !== null) { latest = values![i]; break; } }
  return (
    <div
      ref={ref}
      className={`ms-spark${invert ? ' is-invert' : ''}`}
      data-metric-spark={k}
      role="img"
      aria-label={`Évolution du ${firstDay} au ${lastDay}${latest !== null ? ` — dernière valeur ${fmt(latest)}` : ''}`}
      onPointerMove={onMove}
      onPointerLeave={() => setHover(null)}
    >
      <svg className="ms-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={`ms-g-${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="ms-stop-a" />
            <stop offset="100%" className="ms-stop-b" />
          </linearGradient>
        </defs>
        {paths.area ? <path className="ms-area" d={paths.area} fill={`url(#ms-g-${gid})`} /> : null}
        <path className="ms-line" d={paths.line} vectorEffect="non-scaling-stroke" />
      </svg>
      {hover !== null ? (
        <>
          <span className="ms-guide" style={{ left: `${(hover / Math.max(1, n - 1)) * 100}%` }} aria-hidden="true" />
          {hv !== null ? (
            <span className="ms-dot" style={{ left: `${(hover / Math.max(1, n - 1)) * 100}%`, top: `${(paths.y(hv) / H) * 100}%` }} aria-hidden="true" />
          ) : null}
          <span className={`ms-tip${hover > n / 2 ? ' is-left' : ''}`} style={{ left: `${(hover / Math.max(1, n - 1)) * 100}%` }} aria-hidden="true">
            <b>{hv === null ? '—' : fmt(hv)}</b> {shortDay(data.dates[hover] || '')}
          </span>
        </>
      ) : null}
    </div>
  );
}
