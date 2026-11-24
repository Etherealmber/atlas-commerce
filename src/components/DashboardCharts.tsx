import { useEffect, useRef, useState, type MouseEvent } from 'react';

export type SeriesPoint = {
  key: string;
  label?: string;
  [k: string]: any;
};

export type ChartSeriesKey = {
  key: string;
  label: string;
  color: string;
};

/** Short axis label: always "MM/YY" so dense multi-month axes stay aligned and readable. */
export function shortMonthLabel(s: { key?: string; label?: string }) {
  const k = String(s.key || '');
  if (/^\d{4}-\d{2}/.test(k)) {
    return `${k.slice(5, 7)}/${k.slice(2, 4)}`;
  }
  const lab = String(s.label || '');
  const m = lab.match(/(\d{2})\/(\d{2})/);
  if (m) return `${m[1]}/${m[2]}`;
  return lab.slice(0, 8) || '—';
}

function longMonthLabel(s: { key?: string; label?: string }) {
  const k = String(s.key || '');
  if (/^\d{4}-\d{2}/.test(k)) {
    const [y, m] = k.split('-').map(Number);
    const fr = [
      'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
      'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
    ];
    if (m >= 1 && m <= 12) return `${fr[m - 1]} ${y}`;
  }
  return String(s.label || k || '—');
}

function trimCompactDecimal(num: number): string {
  return Math.abs(num) >= 100 ? String(Math.round(num)) : num.toFixed(1).replace(/\.0$/, '');
}

/**
 * Format chart values with compact k / M / B suffixes when numbers are large
 * or space is tight, keeping full exact numbers when there is plenty of room.
 */
export function formatCompactNum(v: number, unit = '', compactFrom = 100_000): string {
  const n = Number(v || 0);
  if (!Number.isFinite(n) || n === 0) return unit ? `0 ${unit}` : '0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  let body: string;
  if (abs >= compactFrom && abs >= 1_000_000_000) {
    body = `${sign}${trimCompactDecimal(abs / 1_000_000_000)}B`;
  } else if (abs >= compactFrom && abs >= 1_000_000) {
    body = `${sign}${trimCompactDecimal(abs / 1_000_000)}M`;
  } else if (abs >= compactFrom && abs >= 1_000) {
    body = `${sign}${trimCompactDecimal(abs / 1_000)}k`;
  } else {
    body = Math.round(n).toLocaleString('fr-FR');
  }
  return unit ? `${body} ${unit}` : body;
}

export function formatAxisVal(v: number, span: number) {
  if (!Number.isFinite(v)) return '0';
  const abs = Math.abs(v);
  if (abs === 0) return '0';
  const sign = v < 0 ? '-' : '';
  if (span >= 1_000_000_000) return `${sign}${trimCompactDecimal(abs / 1_000_000_000)}B`;
  if (span >= 1_000_000) return `${sign}${trimCompactDecimal(abs / 1_000_000)}M`;
  if (span >= 20_000) return `${sign}${Math.round(abs / 1000)}k`;
  if (span >= 1000) {
    const k = abs / 1000;
    return `${sign}${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return `${sign}${Math.round(abs)}`;
}

function nicePositiveScale(rawMax: number, emptyFallback = 1000) {
  if (!Number.isFinite(rawMax) || rawMax <= 0) {
    return {
      max: emptyFallback,
      ticks: [0, 0.25, 0.5, 0.75, 1].map((t) => emptyFallback * t),
    };
  }
  const rawStep = rawMax / 4;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const norm = rawStep / mag;
  const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  const step = Math.max(1, niceNorm * mag);
  const max = Math.ceil(rawMax / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return { max: Math.max(step, max), ticks };
}

function niceSignedScale(rawMin: number, rawMax: number, emptyFallback = 1000) {
  if (rawMin >= 0) {
    const pos = nicePositiveScale(rawMax, emptyFallback);
    return { min: 0, max: pos.max, ticks: pos.ticks };
  }
  const absMax = Math.max(Math.abs(rawMin), Math.abs(rawMax), 4);
  const halfStepRaw = absMax / 2;
  const mag = 10 ** Math.floor(Math.log10(halfStepRaw));
  const norm = halfStepRaw / mag;
  const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  const step = Math.max(1, niceNorm * mag);
  const max = Math.max(step, Math.ceil(Math.max(0, rawMax) / step) * step);
  const min = -Math.max(step, Math.ceil(Math.abs(rawMin) / step) * step);
  const ticks: number[] = [];
  for (let v = min; v <= max + step * 0.001; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return { min, max, ticks };
}

/**
 * Fritsch-Carlson monotone cubic spline interpolation (same algorithm as D3 curveMonotoneX).
 * Guarantees smooth curves without overshoot below 0 or looping artifacts.
 */
function monotonePath(pts: { x: number; y: number }[]) {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  if (pts.length === 2) {
    return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)} L${pts[1].x.toFixed(1)},${pts[1].y.toFixed(1)}`;
  }
  const n = pts.length;
  const dx: number[] = [];
  const dy: number[] = [];
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dxi = Math.max(0.0001, pts[i + 1].x - pts[i].x);
    const dyi = pts[i + 1].y - pts[i].y;
    dx.push(dxi);
    dy.push(dyi);
    slopes.push(dyi / dxi);
  }
  const tangents = Array.from<number>({ length: n }).fill(0);
  tangents[0] = slopes[0];
  tangents[n - 1] = slopes[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slopes[i - 1] * slopes[i] <= 0) {
      tangents[i] = 0;
    } else {
      const m0 = slopes[i - 1];
      const m1 = slopes[i];
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      tangents[i] = (w1 + w2) / (w1 / m0 + w2 / m1);
    }
  }
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    const cp1x = pts[i].x + h;
    const cp1y = pts[i].y + tangents[i] * h;
    const cp2x = pts[i + 1].x - h;
    const cp2y = pts[i + 1].y - tangents[i + 1] * h;
    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${pts[i + 1].x.toFixed(1)},${pts[i + 1].y.toFixed(1)}`;
  }
  return d;
}

function topRoundedBarPath(x: number, y: number, w: number, h: number, r = 5) {
  if (h <= 0 || w <= 0) return '';
  const rad = Math.min(r, w / 2, h);
  const right = x + w;
  const bottom = y + h;
  return [
    `M${x.toFixed(1)},${bottom.toFixed(1)}`,
    `L${x.toFixed(1)},${(y + rad).toFixed(1)}`,
    `Q${x.toFixed(1)},${y.toFixed(1)} ${(x + rad).toFixed(1)},${y.toFixed(1)}`,
    `L${(right - rad).toFixed(1)},${y.toFixed(1)}`,
    `Q${right.toFixed(1)},${y.toFixed(1)} ${right.toFixed(1)},${(y + rad).toFixed(1)}`,
    `L${right.toFixed(1)},${bottom.toFixed(1)}`,
    'Z',
  ].join(' ');
}

/** Measure container width live so SVG viewBox always matches real CSS pixels (zero aspect distortion). */
function useChartWidth(fallback = 720) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const next = Math.round(el.getBoundingClientRect().width);
      if (next >= 220) setWidth((prev) => (Math.abs(prev - next) >= 2 ? next : prev));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, width };
}

function formatTooltipNum(v: number, unit?: string, compactFrom = 100_000) {
  return formatCompactNum(v, unit || '', compactFrom);
}

export function AreaChart({
  series,
  keys,
  height = 260,
  unit = 'MAD',
  allowNegative = false,
  showNetDelta = false,
  emptyLabel = 'Aucune donnée sur cette période',
}: {
  series: SeriesPoint[];
  keys: ChartSeriesKey[];
  height?: number;
  unit?: string;
  allowNegative?: boolean;
  showNetDelta?: boolean;
  emptyLabel?: string;
}) {
  const { ref, width } = useChartWidth(740);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const safeSeries: SeriesPoint[] =
    series.length > 0
      ? series
      : [{ key: 'empty', label: '—', ...Object.fromEntries(keys.map((k) => [k.key, 0])) }];

  const allVals = safeSeries.flatMap((s) => keys.map((k) => Number(s[k.key] || 0)));
  const rawMax = Math.max(0, ...allVals);
  const rawMin = Math.min(0, ...allVals);
  const allZero = allVals.every((v) => v === 0);

  const scale = allowNegative && rawMin < 0
    ? niceSignedScale(rawMin, rawMax, 1000)
    : (() => {
        const s = nicePositiveScale(rawMax, 1000);
        return { min: 0, max: s.max, ticks: s.ticks };
      })();

  const span = Math.max(1, scale.max - scale.min);
  const n = safeSeries.length;
  const minW = n > 16 ? Math.max(width, n * 44) : width;
  const leftPad = 48;
  const rightPad = 18;
  const topPad = 16;
  const bottomPad = 30;
  const w = Math.max(300, minW);
  const h = height;
  const plotW = w - leftPad - rightPad;
  const plotH = h - topPad - bottomPad;

  const xAt = (i: number) => leftPad + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => {
    const frac = (Number(v) - scale.min) / span;
    return topPad + plotH * (1 - Math.max(0, Math.min(1, frac)));
  };
  const zeroY = yAt(0);

  const paths = keys.map((k, ki) => {
    const pts = safeSeries.map((s, i) => ({
      x: xAt(i),
      y: yAt(Number(s[k.key] || 0)),
      v: Number(s[k.key] || 0),
    }));
    const line = monotonePath(pts);
    const area =
      pts.length > 1
        ? `${line} L${pts[pts.length - 1].x.toFixed(1)},${zeroY.toFixed(1)} L${pts[0].x.toFixed(1)},${zeroY.toFixed(1)} Z`
        : '';
    return { k, ki, pts, line, area };
  });

  const handleSvgMove = (e: MouseEvent<SVGSVGElement>) => {
    if (n <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width) return;
    const svgX = ((e.clientX - rect.left) / rect.width) * w;
    if (n === 1) {
      setHoverIdx(0);
      return;
    }
    const rel = Math.max(0, Math.min(1, (svgX - leftPad) / Math.max(1, plotW)));
    const idx = Math.round(rel * (n - 1));
    setHoverIdx(idx);
  };

  const activePoint = hoverIdx != null ? safeSeries[hoverIdx] : null;
  const activePct = hoverIdx != null ? (xAt(hoverIdx) / w) * 100 : 50;
  const maxXLabels = Math.max(4, Math.floor(plotW / 44));
  const xStep = Math.max(1, Math.ceil(n / maxXLabels));
  const gradPrefix = useRef(`ag-${Math.random().toString(36).slice(2, 8)}`).current;

  return (
    <div className="ac-chart-wrap" ref={ref}>
      <div className="ac-chart-head-row">
        <div className="ac-chart-legend" style={{ margin: 0, padding: 0, justifyContent: 'flex-start' }}>
          {keys.map((k) => (
            <span key={k.key} className="ac-chart-legend-item">
              <i style={{ background: k.color }} />
              {k.label}
            </span>
          ))}
        </div>
      </div>

      <div className="ac-chart-canvas-shell" style={{ overflowX: minW > width ? 'auto' : 'visible' }}>
        <svg
          viewBox={`0 0 ${w} ${h}`}
          width="100%"
          height={h}
          style={{ width: minW > width ? minW : '100%', height: h, display: 'block' }}
          role="img"
          aria-label={keys.map((k) => k.label).join(' / ')}
          className="ac-bionis-chart ac-area-chart"
          onMouseMove={handleSvgMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            {keys.map((k, ki) => (
              <linearGradient key={k.key} id={`${gradPrefix}-${ki}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={k.color} stopOpacity={allZero ? '0.04' : '0.24'} />
                <stop offset="85%" stopColor={k.color} stopOpacity="0.03" />
                <stop offset="100%" stopColor={k.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>

          {scale.ticks.map((v) => {
            const y = yAt(v);
            const isZero = Math.abs(v) < 0.001;
            return (
              <g key={v}>
                <line
                  x1={leftPad}
                  x2={w - rightPad}
                  y1={y}
                  y2={y}
                  stroke={isZero ? 'var(--ac-chart-zero, var(--ac-line))' : 'var(--ac-chart-grid, var(--ac-line))'}
                  strokeWidth={isZero ? 1.25 : 1}
                  strokeDasharray={isZero ? undefined : '3 4'}
                  opacity={isZero ? 0.95 : 0.85}
                />
                <text
                  x={leftPad - 8}
                  y={y + 3.5}
                  fontSize="11"
                  fill="var(--ac-muted)"
                  textAnchor="end"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatAxisVal(v, span)}
                </text>
              </g>
            );
          })}

          {hoverIdx != null && (
            <line
              x1={xAt(hoverIdx)}
              x2={xAt(hoverIdx)}
              y1={topPad}
              y2={topPad + plotH}
              stroke="var(--ac-muted)"
              strokeWidth="1"
              strokeDasharray="3 3"
              opacity={0.75}
            />
          )}

          {paths.map(({ k, ki, line, area, pts }) => (
            <g key={k.key}>
              {area && !allZero && <path d={area} fill={`url(#${gradPrefix}-${ki})`} className="ac-chart-area" />}
              <path
                d={line}
                fill="none"
                stroke={k.color}
                strokeWidth={allZero ? 1.75 : 2.5}
                strokeOpacity={allZero ? 0.45 : 1}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="ac-chart-line"
              />
              {pts.map((pt, i) => {
                const isHover = hoverIdx === i;
                const showDot = isHover || (n <= 12 && !allZero);
                if (!showDot) return null;
                return (
                  <g key={i}>
                    {isHover && (
                      <circle cx={pt.x} cy={pt.y} r={9} fill={k.color} fillOpacity="0.16" />
                    )}
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={isHover ? 4.5 : 3}
                      fill="var(--ac-paper, #fff)"
                      stroke={k.color}
                      strokeWidth={isHover ? 2.5 : 2}
                      className="ac-chart-dot"
                    />
                  </g>
                );
              })}
            </g>
          ))}

          {safeSeries.map((s, i) => {
            const cx = xAt(i);
            const lab = shortMonthLabel(s);
            const show = i % xStep === 0 || i === n - 1;
            if (!show && hoverIdx !== i) return null;
            return (
              <text
                key={s.key || i}
                x={cx}
                y={h - 8}
                fontSize="11"
                fill={hoverIdx === i ? 'var(--ac-ink)' : 'var(--ac-muted)'}
                fontWeight={hoverIdx === i ? 700 : 500}
                textAnchor="middle"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {lab}
              </text>
            );
          })}
        </svg>

        {allZero && (
          <div className="ac-chart-zero-pill" aria-live="polite">
            {emptyLabel}
          </div>
        )}

        {activePoint && (
          <div
            className="ac-chart-tooltip"
            style={{
              left: `${Math.max(6, Math.min(94, activePct))}%`,
              transform: activePct > 68 ? 'translate(-100%, 0)' : activePct < 24 ? 'translate(0, 0)' : 'translate(-50%, 0)',
            }}
          >
            <div className="ac-chart-tooltip-title">{longMonthLabel(activePoint)}</div>
            <div className="ac-chart-tooltip-rows">
              {keys.map((k) => (
                <div key={k.key} className="ac-chart-tooltip-row">
                  <span><i style={{ background: k.color }} />{k.label}</span>
                  <strong>{formatTooltipNum(Number(activePoint[k.key] || 0), unit, width < 440 ? 10_000 : 100_000)}</strong>
                </div>
              ))}
              {showNetDelta && keys.length >= 2 && (
                <div className="ac-chart-tooltip-row ac-chart-tooltip-net">
                  <span>Résultat</span>
                  <strong
                    style={{
                      color:
                        Number(activePoint[keys[0].key] || 0) - Number(activePoint[keys[1].key] || 0) >= 0
                          ? 'var(--ac-chart-green, #10b981)'
                          : 'var(--ac-chart-red, #ef4444)',
                    }}
                  >
                    {Number(activePoint[keys[0].key] || 0) - Number(activePoint[keys[1].key] || 0) >= 0 ? '+' : ''}
                    {formatTooltipNum(
                      Number(activePoint[keys[0].key] || 0) - Number(activePoint[keys[1].key] || 0),
                      unit,
                      width < 440 ? 10_000 : 100_000,
                    )}
                  </strong>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function BarChart({
  series,
  keys,
  secondaryLineKey,
  height = 220,
  unit = 'MAD',
  secondaryUnit = '',
}: {
  series: SeriesPoint[];
  keys: ChartSeriesKey[];
  secondaryLineKey?: ChartSeriesKey;
  height?: number;
  unit?: string;
  secondaryUnit?: string;
}) {
  const { ref, width } = useChartWidth(620);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!series.length) {
    return (
      <div className="ac-dash-empty" style={{ minHeight: 160 }}>
        <p>Pas encore de données pour cette période.</p>
      </div>
    );
  }

  const primaryVals = series.flatMap((s) => keys.map((k) => Number(s[k.key] || 0)));
  const rawMax = Math.max(0, ...primaryVals);
  const allPrimaryZero = primaryVals.every((v) => v === 0);
  const scale = nicePositiveScale(rawMax, 1000);

  const secVals = secondaryLineKey ? series.map((s) => Number(s[secondaryLineKey.key] || 0)) : [];
  const rawSecMax = secondaryLineKey ? Math.max(0, ...secVals) : 0;
  const secScale = secondaryLineKey ? nicePositiveScale(rawSecMax, 10) : null;
  const allZero = allPrimaryZero && (!secondaryLineKey || secVals.every((v) => v === 0));

  const n = series.length;
  const minW = n > 14 ? Math.max(width, n * 44) : width;
  const leftPad = 46;
  const rightPad = secondaryLineKey ? 36 : 14;
  const topPad = 14;
  const bottomPad = 28;
  const w = Math.max(300, minW);
  const h = height;
  const plotW = w - leftPad - rightPad;
  const plotH = h - topPad - bottomPad;
  const groupW = plotW / Math.max(1, n);
  const barW = Math.min(24, Math.max(5, (groupW - 10) / Math.max(1, keys.length)));

  const maxXLabels = Math.max(4, Math.floor(plotW / 54));
  const labelEvery = Math.max(1, Math.ceil(n / maxXLabels));
  const yearStarts = new Set<number>();
  series.forEach((s, i) => {
    const k = String(s.key || '');
    if (/^\d{4}-01$/.test(k.slice(0, 7)) && i > 0) yearStarts.add(i);
  });

  const secPts =
    secondaryLineKey && secScale
      ? series.map((s, i) => {
          const val = Number(s[secondaryLineKey.key] || 0);
          const x = leftPad + i * groupW + groupW / 2;
          const y = topPad + plotH * (1 - Math.max(0, Math.min(1, val / secScale.max)));
          return { x, y, val };
        })
      : [];
  const secPath = secPts.length ? monotonePath(secPts) : '';

  const activePoint = hoverIdx != null ? series[hoverIdx] : null;
  const activePct = hoverIdx != null ? ((leftPad + hoverIdx * groupW + groupW / 2) / w) * 100 : 50;
  const gradPrefix = useRef(`bg-${Math.random().toString(36).slice(2, 8)}`).current;

  return (
    <div className="ac-chart-wrap" ref={ref}>
      <div className="ac-chart-head-row">
        <div className="ac-chart-legend" style={{ margin: 0, padding: 0, justifyContent: 'flex-start' }}>
          {keys.map((k) => (
            <span key={k.key} className="ac-chart-legend-item">
              <i style={{ background: k.color }} />
              {k.label}
            </span>
          ))}
          {secondaryLineKey && (
            <span className="ac-chart-legend-item">
              <i style={{ background: secondaryLineKey.color, borderRadius: 2 }} />
              {secondaryLineKey.label}
            </span>
          )}
        </div>
      </div>

      <div className="ac-chart-canvas-shell" style={{ overflowX: minW > width ? 'auto' : 'visible' }}>
        <svg
          viewBox={`0 0 ${w} ${h}`}
          width="100%"
          height={h}
          style={{ width: minW > width ? minW : '100%', height: h, display: 'block' }}
          role="img"
          aria-label="Graphique en barres"
          className="ac-bionis-chart"
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            {keys.map((k, ki) => (
              <linearGradient key={k.key} id={`${gradPrefix}-${ki}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={k.color} stopOpacity="0.98" />
                <stop offset="100%" stopColor={k.color} stopOpacity="0.72" />
              </linearGradient>
            ))}
          </defs>

          {scale.ticks.map((v) => {
            const y = topPad + plotH * (1 - v / scale.max);
            const isZero = v === 0;
            return (
              <g key={v}>
                <line
                  x1={leftPad}
                  x2={w - rightPad}
                  y1={y}
                  y2={y}
                  stroke={isZero ? 'var(--ac-chart-zero, var(--ac-line))' : 'var(--ac-chart-grid, var(--ac-line))'}
                  strokeWidth={isZero ? 1.2 : 1}
                  strokeDasharray={isZero ? undefined : '3 4'}
                  opacity={isZero ? 0.95 : 0.85}
                />
                <text
                  x={leftPad - 8}
                  y={y + 3.5}
                  fontSize="11"
                  fill="var(--ac-muted)"
                  textAnchor="end"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatAxisVal(v, scale.max)}
                </text>
              </g>
            );
          })}

          {secScale &&
            [0, 0.5, 1].map((t) => {
              const v = secScale.max * t;
              const y = topPad + plotH * (1 - t);
              return (
                <text
                  key={`sec-${t}`}
                  x={w - rightPad + 8}
                  y={y + 3.5}
                  fontSize="10.5"
                  fill={secondaryLineKey?.color || 'var(--ac-muted)'}
                  textAnchor="start"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {Math.round(v)}
                </text>
              );
            })}

          {series.map((s, i) => {
            const x0 = leftPad + i * groupW + groupW / 2;
            const lab = shortMonthLabel(s);
            const showLabel = i % labelEvery === 0 || i === n - 1 || yearStarts.has(i);
            const isActive = hoverIdx === i;
            const totalBarsW = keys.length * barW + Math.max(0, keys.length - 1) * 3;

            return (
              <g
                key={s.key || i}
                onMouseEnter={() => setHoverIdx(i)}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={leftPad + i * groupW + 2}
                  y={topPad}
                  width={Math.max(4, groupW - 4)}
                  height={plotH}
                  rx={6}
                  fill="var(--ac-ink)"
                  fillOpacity={isActive ? 0.045 : 0}
                />
                {yearStarts.has(i) && (
                  <line
                    x1={leftPad + i * groupW}
                    x2={leftPad + i * groupW}
                    y1={topPad}
                    y2={topPad + plotH}
                    stroke="var(--ac-line)"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                )}
                {keys.map((k, ki) => {
                  const val = Math.max(0, Number(s[k.key] || 0));
                  const bh = scale.max > 0 ? (val / scale.max) * plotH : 0;
                  const bx = x0 - totalBarsW / 2 + ki * (barW + 3);
                  const by = topPad + plotH - bh;
                  const pathD = topRoundedBarPath(bx, by, barW, bh, 5);
                  return pathD ? (
                    <path
                      key={k.key}
                      d={pathD}
                      fill={`url(#${gradPrefix}-${ki})`}
                      opacity={hoverIdx == null || isActive ? 1 : 0.48}
                      className="ac-chart-bar"
                    />
                  ) : null;
                })}
                {showLabel && (
                  <text
                    x={x0}
                    y={h - 8}
                    fontSize="11"
                    fill={isActive ? 'var(--ac-ink)' : 'var(--ac-muted)'}
                    textAnchor="middle"
                    fontWeight={isActive || yearStarts.has(i) ? 700 : 500}
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {lab}
                  </text>
                )}
              </g>
            );
          })}

          {secondaryLineKey && secPath && !allZero && (
            <g style={{ pointerEvents: 'none' }}>
              <path
                d={secPath}
                fill="none"
                stroke={secondaryLineKey.color}
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {secPts.map((pt, i) =>
                hoverIdx === i || n <= 12 ? (
                  <circle
                    key={i}
                    cx={pt.x}
                    cy={pt.y}
                    r={hoverIdx === i ? 4.5 : 3}
                    fill="var(--ac-paper, #fff)"
                    stroke={secondaryLineKey.color}
                    strokeWidth={2}
                  />
                ) : null,
              )}
            </g>
          )}
        </svg>

        {allZero && (
          <div className="ac-chart-zero-pill">
            Aucun mouvement sur cette période
          </div>
        )}

        {activePoint && (
          <div
            className="ac-chart-tooltip"
            style={{
              left: `${Math.max(6, Math.min(94, activePct))}%`,
              transform: activePct > 68 ? 'translate(-100%, 0)' : activePct < 24 ? 'translate(0, 0)' : 'translate(-50%, 0)',
            }}
          >
            <div className="ac-chart-tooltip-title">{longMonthLabel(activePoint)}</div>
            <div className="ac-chart-tooltip-rows">
              {keys.map((k) => (
                <div key={k.key} className="ac-chart-tooltip-row">
                  <span><i style={{ background: k.color }} />{k.label}</span>
                  <strong>{formatTooltipNum(Number(activePoint[k.key] || 0), unit, width < 440 ? 10_000 : 100_000)}</strong>
                </div>
              ))}
              {secondaryLineKey && (
                <div className="ac-chart-tooltip-row">
                  <span><i style={{ background: secondaryLineKey.color }} />{secondaryLineKey.label}</span>
                  <strong>{formatTooltipNum(Number(activePoint[secondaryLineKey.key] || 0), secondaryUnit, width < 440 ? 10_000 : 100_000)}</strong>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function HBarChart({
  items,
  color = 'var(--ac-chart-amber, #d97706)',
  unit = 'MAD',
}: {
  items: { label: string; value: number }[];
  color?: string;
  unit?: string;
}) {
  const { ref, width } = useChartWidth(420);
  if (!items.length) {
    return (
      <div className="ac-dash-empty" style={{ minHeight: 110 }} ref={ref}>
        <p>Aucune catégorie.</p>
      </div>
    );
  }
  const total = items.reduce((acc, it) => acc + Math.max(0, Math.abs(it.value)), 0) || 1;
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  const compactThreshold = width < 420 ? 10_000 : 100_000;
  return (
    <div className="ac-hbar-list" ref={ref}>
      {items.slice(0, 8).map((it) => {
        const val = Math.abs(it.value);
        const pct = Math.round((val / total) * 100);
        const barPct = Math.min(100, (val / max) * 100);
        const fullStr = `${Math.round(it.value).toLocaleString('fr-FR')}${unit ? ` ${unit}` : ''}`;
        return (
          <div key={it.label} className="ac-hbar-row">
            <div className="ac-hbar-top">
              <span className="ac-hbar-label" title={it.label}>{it.label}</span>
              <span className="ac-hbar-val" title={fullStr}>
                <strong>{formatCompactNum(it.value, unit, compactThreshold)}</strong>
                <em>{pct}%</em>
              </span>
            </div>
            <div className="ac-hbar-track">
              <div className="ac-hbar-fill" style={{ width: `${barPct}%`, background: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function DonutChart({
  segments,
  centerLabel,
  centerValue,
  unit = '',
}: {
  segments: { value: number; color: string; label: string }[];
  centerLabel: string;
  centerValue: string;
  unit?: string;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const sum = segments.reduce((a, s) => a + Math.max(0, s.value), 0);
  const hasValues = sum > 0;
  const total = hasValues ? sum : 1;
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const size = 152;
  const cx = size / 2;
  const cy = size / 2;
  const fallbackPalette = [
    'var(--ac-chart-blue, #2563eb)',
    'var(--ac-chart-sky, #0ea5e9)',
    'var(--ac-chart-amber-bright, #f59e0b)',
    'var(--ac-chart-red, #ef4444)',
    'var(--ac-chart-zinc, #71717a)',
  ];

  const activeSeg = hoverIdx != null && segments[hoverIdx] ? segments[hoverIdx] : null;
  const displayValue = activeSeg
    ? formatCompactNum(activeSeg.value, unit, 10_000)
    : centerValue;
  const displayLabel = activeSeg
    ? `${activeSeg.label} (${hasValues ? Math.round((Math.max(0, activeSeg.value) / total) * 100) : 0}%)`
    : centerLabel;

  return (
    <div className="ac-donut">
      <div className="ac-donut-ring" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--ac-chart-track, var(--ac-line, #e4e4e7))" strokeWidth="13" opacity="0.9" />
          {hasValues &&
            segments.map((seg, i) => {
              const val = Math.max(0, seg.value);
              const frac = val / total;
              const dash = Math.max(0, frac * c - (segments.filter((s) => s.value > 0).length > 1 ? 2.5 : 0));
              const stroke = seg.color || fallbackPalette[i % fallbackPalette.length];
              const isActive = hoverIdx === i;
              const el = (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={isActive ? 16 : 13}
                  strokeDasharray={`${dash} ${Math.max(0, c - dash)}`}
                  strokeDashoffset={-offset}
                  strokeLinecap="butt"
                  transform={`rotate(-90 ${cx} ${cy})`}
                  opacity={hoverIdx == null || isActive ? 1 : 0.45}
                  style={{ transition: 'stroke-width 0.15s ease, opacity 0.15s ease', cursor: 'pointer' }}
                  onMouseEnter={() => setHoverIdx(i)}
                  onMouseLeave={() => setHoverIdx(null)}
                >
                  <title>{`${seg.label}: ${Math.round(seg.value).toLocaleString('fr-FR')}`}</title>
                </circle>
              );
              offset += frac * c;
              return el;
            })}
        </svg>
        <div className="ac-donut-center">
          <strong>{displayValue}</strong>
          <span>{displayLabel}</span>
        </div>
      </div>
      <ul className="ac-donut-legend ac-donut-legend--rows">
        {segments.map((seg, i) => {
          const pct = hasValues ? Math.round((Math.max(0, seg.value) / total) * 100) : 0;
          const color = seg.color || fallbackPalette[i % fallbackPalette.length];
          return (
            <li
              key={i}
              className={hoverIdx === i ? 'is-active' : undefined}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx(null)}
            >
              <span className="ac-donut-leg-left">
                <i style={{ background: color }} />
                <span>{seg.label}</span>
              </span>
              <span className="ac-donut-leg-val" title={`${Math.round(seg.value).toLocaleString('fr-FR')}${unit ? ` ${unit}` : ''}`}>
                {formatCompactNum(seg.value, unit, 10_000)}
                {hasValues ? ` · ${pct}%` : ''}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
