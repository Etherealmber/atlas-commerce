import { useEffect, useMemo, useState } from 'react';
import DatePicker, { DateRangePicker } from '../components/DatePicker';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../api';
import { getUsername, isStockRole } from '../auth';
import { IconPackage } from '../components/Icons';
import { useUi } from '../components/AppDialogs';

/**
 * Date + place from the *device* clock/timezone only (never IP geolocation).
 * VPNs change IP but not the phone/PC timezone the user set — so this stays correct.
 */
function devicePlaceLabel(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const map: Record<string, string> = {
      'Africa/Casablanca': 'Casablanca',
      'Africa/El_Aaiun': 'Laâyoune',
      'Europe/Paris': 'Paris',
      'Asia/Shanghai': 'Shanghai',
      'Asia/Tokyo': 'Tokyo',
      'UTC': 'UTC',
    };
    if (map[tz]) return map[tz];
    const tail = tz.split('/').pop() || tz;
    return tail.replace(/_/g, ' ');
  } catch {
    return '';
  }
}

function todayLabel() {
  const d = new Date(); // device local time
  const date = d
    .toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
    .toUpperCase();
  const place = devicePlaceLabel();
  return place ? `${date} · ${place.toUpperCase()}` : date;
}

function fmt(n: number, cur = 'MAD') {
  return `${Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} ${cur}`;
}

/** Local YYYY-MM-DD (avoids UTC shift from toISOString that breaks "2 ans" ranges). */
function toLocalYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function defaultRange(preset: string) {
  const to = new Date();
  to.setHours(12, 0, 0, 0); // noon local → stable date
  let from = new Date(to);
  if (preset === '1m') from = new Date(to.getFullYear(), to.getMonth(), 1);
  else if (preset === '6m') from = new Date(to.getFullYear(), to.getMonth() - 5, 1);
  else if (preset === '12m' || preset === '1y') from = new Date(to.getFullYear(), to.getMonth() - 11, 1);
  else if (preset === '24m' || preset === '2y') from = new Date(to.getFullYear(), to.getMonth() - 23, 1);
  else if (preset === 'ytd' || preset === 'year') from = new Date(to.getFullYear(), 0, 1);
  else if (preset === '3m') from = new Date(to.getFullYear(), to.getMonth() - 2, 1);
  else from = new Date(to.getFullYear(), to.getMonth() - 5, 1);
  from.setHours(12, 0, 0, 0);
  return { from: toLocalYMD(from), to: toLocalYMD(to) };
}

/** Short axis label: always "MM/YY" so it stays readable when dense */
function shortMonthLabel(s: { key?: string; label?: string }) {
  const k = String(s.key || '');
  if (/^\d{4}-\d{2}/.test(k)) {
    return `${k.slice(5, 7)}/${k.slice(2, 4)}`;
  }
  const lab = String(s.label || '');
  const m = lab.match(/(\d{2})\/(\d{2})/);
  if (m) return `${m[1]}/${m[2]}`;
  return lab.slice(0, 8) || '—';
}

/** Simple SVG bar chart — labels in SVG so bars align with months */
function formatAxisVal(v: number, max: number) {
  if (!Number.isFinite(v)) return '0';
  if (max >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (max >= 10_000) return `${Math.round(v / 1000)}k`;
  if (max >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (max < 10) return (Math.round(v * 10) / 10).toString();
  return String(Math.round(v));
}

function niceMax(raw: number) {
  if (raw <= 0) return 1;
  if (raw <= 1) return 1;
  if (raw <= 5) return Math.ceil(raw);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * mag;
}

function BarChart({
  series,
  keys,
}: {
  series: { key: string; label?: string; [k: string]: any }[];
  keys: { key: string; label: string; color: string }[];
  colors?: string[];
}) {
  // Dual-tone greyscale pairs (reference Total Revenue style)
  const toneKeys = keys.map((k, i) => ({
    ...k,
    color: i % 2 === 0 ? '#d4d4d8' : '#52525b',
  }));
  keys = toneKeys;
  if (!series.length) {
    return (
      <div className="ac-dash-empty" style={{ minHeight: 160 }}>
        <p>Pas encore de données pour cette période.</p>
      </div>
    );
  }
  const allZero = series.every((s) => keys.every((k) => !Number(s[k.key] || 0)));
  const rawMax = Math.max(0, ...series.flatMap((s) => keys.map((k) => Number(s[k.key] || 0))));
  const max = niceMax(rawMax || 0);
  const n = series.length;
  const labelEvery = n <= 6 ? 1 : n <= 12 ? 1 : n <= 18 ? 2 : 3;
  const leftPad = 44;
  const rightPad = 12;
  const topPad = 12;
  const bottomPad = 28;
  const barAreaMinW = Math.max(28, Math.min(48, Math.floor(720 / Math.max(n, 1))));
  const w = leftPad + rightPad + n * barAreaMinW;
  const h = 200;
  const plotH = h - topPad - bottomPad;
  const groupW = (w - leftPad - rightPad) / Math.max(1, n);
  const barW = Math.min(14, Math.max(3, (groupW - 6) / Math.max(1, keys.length)));

  const yearStarts = new Set<number>();
  series.forEach((s, i) => {
    const k = String(s.key || '');
    if (/^\d{4}-01$/.test(k.slice(0, 7))) yearStarts.add(i);
  });

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    t,
    v: max * t,
    y: topPad + plotH * (1 - t),
  }));


  return (
    <div style={{ width: '100%', overflowX: n > 14 ? 'auto' : 'visible' }}>
      {allZero && (
        <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--ac-muted)', textAlign: 'center' }}>
          Aucun mouvement sur cette période — les barres resteront à 0.
        </p>
      )}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        style={{ maxHeight: 280, minWidth: n > 14 ? w : undefined, display: 'block' }}
        role="img"
        aria-label="Graphique"
        className="ac-bionis-chart"
      >
        <defs>
          {keys.map((k) => (
            <linearGradient key={`g-${k.key}`} id={`ac-bar-${k.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={k.color} stopOpacity="1" />
              <stop offset="100%" stopColor={k.color} stopOpacity="0.75" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map(({ t, v, y }) => (
          <g key={t}>
            <line x1={leftPad} x2={w - rightPad} y1={y} y2={y} stroke="var(--ac-line)" strokeWidth="1" strokeDasharray={t === 0 ? undefined : '4 4'} opacity={t === 0 ? 1 : 0.7} />
            <text x={leftPad - 6} y={y + 3} fontSize="10" fill="var(--ac-muted)" textAnchor="end">
              {formatAxisVal(v, max)}
            </text>
          </g>
        ))}
        {series.map((s, i) => {
          const x0 = leftPad + i * groupW + groupW / 2;
          const lab = shortMonthLabel(s);
          const showLabel = i % labelEvery === 0 || i === n - 1 || yearStarts.has(i);
          return (
            <g key={s.key || i}>
              {yearStarts.has(i) && (
                <line
                  x1={x0 - groupW / 2}
                  x2={x0 - groupW / 2}
                  y1={topPad}
                  y2={topPad + plotH}
                  stroke="var(--ac-line)"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
              )}
              {keys.map((k, ki) => {
                const val = Number(s[k.key] || 0);
                const bh = max > 0 ? (val / max) * plotH : 0;
                const x = x0 - (keys.length * barW) / 2 + ki * barW;
                const y = topPad + plotH - bh;
                return (
                  <rect
                    key={k.key}
                    x={x}
                    y={y}
                    width={Math.max(2, barW - 1)}
                    height={Math.max(0, bh)}
                    rx={6}
                    fill={`url(#ac-bar-${k.key})`}
                    className="ac-chart-bar"
                  >
                    <title>{`${lab} · ${k.label}: ${val}`}</title>
                  </rect>
                );
              })}
              {showLabel && (
                <text
                  x={x0}
                  y={h - 8}
                  fontSize={n > 18 ? 9 : 10}
                  fill="#9aa3b5"
                  textAnchor="middle"
                  fontWeight={yearStarts.has(i) ? 700 : 500}
                >
                  {lab}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Line chart for profit / trends over long ranges */
function LineChart({
  series,
  valueKey = 'profit',
  color = '#71717a',
  label = 'Profit',
}: {
  series: { key: string; label?: string; [k: string]: any }[];
  valueKey?: string;
  color?: string;
  label?: string;
}) {
  if (!series.length) {
    return (
      <div className="ac-dash-empty" style={{ minHeight: 140 }}>
        <p>Pas de données.</p>
      </div>
    );
  }
  const vals = series.map((s) => Number(s[valueKey] || 0));
  const max = Math.max(1, ...vals.map((v) => Math.abs(v)));
  const w = Math.max(560, Math.min(960, series.length * 28));
  const h = 180;
  const padL = 40;
  const padB = 36;
  const padT = 16;
  const plotW = w - padL - 12;
  const plotH = h - padB - padT;
  const n = series.length;
  const pts = series.map((s, i) => {
    const x = padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const v = Number(s[valueKey] || 0);
    const y = padT + plotH / 2 - (v / max) * (plotH / 2);
    return { x, y, v, lab: shortMonthLabel(s) };
  });
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const labelEvery = n <= 8 ? 1 : n <= 14 ? 2 : 4;
  return (
    <div style={{ width: '100%' }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ maxHeight: 180 }} role="img" aria-label={label}>
        <line x1={padL} x2={w - 8} y1={padT + plotH / 2} y2={padT + plotH / 2} stroke="var(--ac-line)" strokeWidth="1" strokeDasharray="4 3" />
        <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill={color}>
            <title>{`${p.lab}: ${Math.round(p.v)}`}</title>
          </circle>
        ))}
        <text x={4} y={padT + 8} fontSize="9" fill="var(--ac-muted)">{max >= 1000 ? `${Math.round(max / 1000)}k` : Math.round(max)}</text>
      </svg>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, paddingLeft: padL, paddingRight: 12, fontSize: 10, color: '#9aa3b5' }}>
        {pts.map((p, i) => (
          <span key={i} style={{ textAlign: 'center', visibility: (i % labelEvery === 0 || i === n - 1) ? 'visible' : 'hidden' }}>{p.lab}</span>
        ))}
      </div>
    </div>
  );
}


/** Bionis-style area chart (filled path + stroke). */
function AreaChart({
  series,
  keys,
  height = 220,
}: {
  series: { key: string; label?: string; [k: string]: any }[];
  keys: { key: string; label: string; color: string }[];
  height?: number;
}) {
  // Always draw axes + baseline — even when every value is 0
  const safeSeries =
    series.length > 0
      ? series
      : [{ key: 'empty', label: '—', ...Object.fromEntries(keys.map((k) => [k.key, 0])) }];
  const rawMax = Math.max(
    0,
    ...safeSeries.flatMap((s) => keys.map((k) => Number(s[k.key] || 0))),
  );
  const allZero = rawMax <= 0;
  const max = niceMax(rawMax || 0) || 1;
  const n = safeSeries.length;
  const leftPad = 44;
  const rightPad = 12;
  const topPad = 16;
  const bottomPad = 28;
  const w = Math.max(320, leftPad + rightPad + n * 36);
  const h = height;
  const plotH = h - topPad - bottomPad;
  const plotW = w - leftPad - rightPad;

  const xAt = (i: number) => leftPad + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => topPad + plotH * (1 - (max > 0 ? Number(v) / max : 0));

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => ({
    t,
    v: max * t,
    y: topPad + plotH * (1 - t),
  }));

  const paths = keys.map((k) => {
    const pts = safeSeries.map((s, i) => ({ x: xAt(i), y: yAt(Number(s[k.key] || 0)), v: Number(s[k.key] || 0) }));
    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const area =
      pts.length > 0
        ? `${line} L${pts[pts.length - 1].x.toFixed(1)},${(topPad + plotH).toFixed(1)} L${pts[0].x.toFixed(1)},${(topPad + plotH).toFixed(1)} Z`
        : '';
    return { k, pts, line, area };
  });

  return (
    <div style={{ width: '100%', overflowX: n > 14 ? 'auto' : 'visible' }}>
      {allZero && (
        <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--ac-muted, #71717a)', textAlign: 'center' }}>
          Aucune entrée/sortie sur cette période.
        </p>
      )}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        style={{ maxHeight: height + 20, minWidth: n > 14 ? w : undefined, display: 'block' }}
        role="img"
        aria-label="Graphique aire"
        className="ac-bionis-chart ac-area-chart"
      >
        <defs>
          {keys.map((k) => (
            <linearGradient key={`ag-${k.key}`} id={`ac-area-${k.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={k.color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={k.color} stopOpacity="0.02" />
            </linearGradient>
          ))}
        </defs>
        {ticks.map(({ t, v, y }) => (
          <g key={t}>
            <line
              x1={leftPad}
              x2={w - rightPad}
              y1={y}
              y2={y}
              stroke="var(--ac-line)"
              strokeWidth="1"
              strokeDasharray={t === 0 ? undefined : '4 4'}
              opacity={t === 0 ? 1 : 0.65}
            />
            <text x={leftPad - 6} y={y + 3} fontSize="10" fill="var(--ac-muted)" textAnchor="end">
              {formatAxisVal(v, max)}
            </text>
          </g>
        ))}
        {paths.map(({ k, line, area, pts }) => (
          <g key={k.key}>
            {area && <path d={area} fill={`url(#ac-area-${k.key})`} className="ac-chart-area" />}
            <path d={line} fill="none" stroke={k.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="ac-chart-line" />
            {pts.map((pt, i) => (
              <circle key={i} cx={pt.x} cy={pt.y} r="3.5" fill="#fff" stroke={k.color} strokeWidth="2" className="ac-chart-dot">
                <title>{`${shortMonthLabel(safeSeries[i] || {})} · ${k.label}: ${pt.v}`}</title>
              </circle>
            ))}
          </g>
        ))}
        {safeSeries.map((s, i) => {
          const lab = shortMonthLabel(s);
          const show = n <= 12 || i % Math.ceil(n / 8) === 0 || i === n - 1;
          if (!show) return null;
          return (
            <text key={s.key || i} x={xAt(i)} y={h - 8} fontSize={n > 18 ? 9 : 10} fill="#71717a" textAnchor="middle">
              {lab}
            </text>
          );
        })}
      </svg>
      <div className="ac-chart-legend">
        {keys.map((k) => (
          <span key={k.key} className="ac-chart-legend-item">
            <i style={{ background: k.color }} />
            {k.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function HBarChart({
  items,
  color = 'var(--ac-ink)',
}: {
  items: { label: string; value: number }[];
  color?: string;
}) {
  if (!items.length) {
    return (
      <div className="ac-dash-empty" style={{ minHeight: 100 }}>
        <p>Aucune catégorie.</p>
      </div>
    );
  }
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.slice(0, 8).map((it) => (
        <div key={it.label} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 72px', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#9aa3b5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.label}>{it.label}</span>
          <div style={{ height: 10, background: '#f0ebe3', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, (Math.abs(it.value) / max) * 100)}%`, height: '100%', background: color, borderRadius: 99 }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, textAlign: 'right' }}>{Math.round(it.value).toLocaleString('fr-FR')}</span>
        </div>
      ))}
    </div>
  );
}


function DonutChart({
  segments,
  centerLabel,
  centerValue,
}: {
  segments: { value: number; color: string; label: string }[];
  centerLabel: string;
  centerValue: string;
}) {
  const total = segments.reduce((a, s) => a + Math.max(0, s.value), 0) || 1;
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const size = 160;
  const cx = size / 2;
  const cy = size / 2;
  // Force greyscale palette like reference
  const greys = ['#a3a3a3', '#737373', '#525252', '#262626', '#d4d4d4'];
  return (
    <div className="ac-donut">
      <div className="ac-donut-ring" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f4f4f5" strokeWidth="18" />
          {segments.map((seg, i) => {
            const frac = Math.max(0, seg.value) / total;
            const dash = frac * c;
            const stroke = greys[i % greys.length];
            const el = (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={stroke}
                strokeWidth="18"
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${cx} ${cy})`}
              />
            );
            offset += dash;
            return el;
          })}
        </svg>
        <div className="ac-donut-center">
          <strong>{centerValue}</strong>
          <span>{centerLabel}</span>
        </div>
      </div>
      <ul className="ac-donut-legend">
        {segments.map((seg, i) => (
          <li key={i}>
            <i style={{ background: greys[i % greys.length] }} />
            {seg.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function NextActionsPanel() {
  const [items, setItems] = useState<{ priority: number; title: string; detail: string; href?: string }[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    let cancelled = false;
    api.assistNextActions()
      .then((r) => { if (!cancelled) setItems(r.data?.items || []); })
      .catch((e: any) => { if (!cancelled) setErr(e?.message || 'Impossible de charger'); });
    return () => { cancelled = true; };
  }, []);
  if (err) return null;
  if (!items.length) return null;
  return (
    <div className="ac-panel" style={{ marginBottom: 12 }}>
      <div className="ac-panel-head">
        <h3 style={{ margin: 0, fontSize: 15 }}>Que faire ensuite ?</h3>
      </div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.45 }}>
        {items.map((it, i) => (
          <li key={i} style={{ marginBottom: 6 }}>
            <strong>{it.title}</strong>
            <span style={{ color: 'var(--muted)' }}> — {it.detail}</span>
            {it.href ? (
              <a href={it.href} style={{ marginLeft: 6, fontSize: 12 }}>Ouvrir</a>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Dashboard() {
  const [attWeek, setAttWeek] = useState<{ date: string; present: number; late: number; absent: number }[] | null>(null);
  const [attEmpId, setAttEmpId] = useState<string>('');
  const [attDays, setAttDays] = useState(7);
  const [attEmployees, setAttEmployees] = useState<{ id: number; name: string }[]>([]);

  const { toast } = useUi();

  const stockOnly = isStockRole();
  const [data, setData] = useState<any>(null);
  const [actions, setActions] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [preset, setPreset] = useState('6m');
  const [range, setRange] = useState(() => defaultRange('6m'));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getToken } = await import('../auth');
        const { getApiBase } = await import('../config');
        const { api } = await import('../api');
        const token = getToken() || '';
        const base = getApiBase();
        try {
          const el: any = await api.getEmployees?.({ status: 'active', limit: 200 });
          const list = el?.data?.rows || el?.data || [];
          if (!cancelled && Array.isArray(list)) {
            setAttEmployees(
              list.map((e: any) => ({
                id: Number(e.id),
                name: e.display_name || e.name || `${e.first_name || ''} ${e.last_name || ''}`.trim() || `#${e.id}`,
              })),
            );
          }
        } catch {
          /* */
        }
        const q = new URLSearchParams({ days: String(attDays) });
        if (attEmpId) q.set('employee_id', attEmpId);
        const r = await fetch(`${base}/api/attendance/weekly?${q}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const j = await r.json().catch(() => null);
        if (!cancelled && j?.data?.days) setAttWeek(j.data.days);
        else if (!cancelled) setAttWeek([]);
      } catch {
        if (!cancelled) setAttWeek([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attEmpId, attDays]);


  useEffect(() => {
    let stopped = false;
    let timer: number | null = null;
    let failStreak = 0;
    const baseMs = 90000;

    const schedule = () => {
      if (stopped) return;
      if (timer) window.clearTimeout(timer);
      // Pause when tab hidden; backoff on errors (30s → 60s → 120s max)
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      const delay = hidden
        ? baseMs * 4
        : Math.min(baseMs * Math.pow(2, Math.min(failStreak, 2)), 120000);
      timer = window.setTimeout(() => void load(true), delay);
    };

    const load = async (soft = false) => {
      if (!soft) setLoading(true);
      try {
        const [dash, ac, pr, st, locs] = await Promise.all([
          api.getDashboard().catch((e) => {
            throw e;
          }),
          api.listMobileActions({ status: 'all', limit: 12 }).catch(() => ({ data: [] })),
          api.getProducts({ include_variants: true }).catch(() => ({ data: [] })),
          api.getMobileActionStats().catch(() => ({ data: { pending: 0 } })),
          api.getStockLocations().catch(() => ({ data: [] })),
        ]);
        if (stopped) return;
        setData(dash.data);
        setActions(ac.data || []);
        setProducts(pr.data || []);
        setLocations(locs.data || []);
        setPending(Number(st.data?.pending || 0));
        setError('');
        failStreak = 0;
      } catch (e: any) {
        if (!stopped) {
          setError(e.message || 'Erreur réseau');
          failStreak += 1;
        }
      } finally {
        if (!stopped) {
          setLoading(false);
          schedule();
        }
      }
    };

    void load();
    const onVis = () => {
      if (document.visibilityState === 'visible') void load(true);
      else schedule();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  const filteredSeries = useMemo(() => {
    const series = data?.monthlySeries || data?.monthly_series || data?.cashflow || [];
    const fromKey = range.from.slice(0, 7);
    const toKey = range.to.slice(0, 7);
    const byKey: Record<string, any> = {};
    if (Array.isArray(series)) {
      for (const s of series) {
        const k = String(s.key || s.month || '').slice(0, 7);
        if (k.length === 7 && k[4] === '-') byKey[k] = s;
      }
    }
    // Always materialize every month in the selected range so 1y / 2y charts never go blank
    const keys: string[] = [];
    {
      let [y, m] = fromKey.split('-').map(Number);
      const [ty, tm] = toKey.split('-').map(Number);
      let guard = 0;
      while ((y < ty || (y === ty && m <= tm)) && guard < 48) {
        keys.push(`${y}-${String(m).padStart(2, '0')}`);
        m += 1;
        if (m > 12) { m = 1; y += 1; }
        guard += 1;
      }
    }
    const fr = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
    return keys.map((k) => {
      const s = byKey[k] || {};
      const income = Number(s.sales ?? s.income ?? 0);
      const expense = Number(s.expenses ?? s.expense ?? 0);
      const [ys, ms] = k.split('-');
      const mi = Math.max(0, Math.min(11, Number(ms) - 1));
      return {
        key: k,
        label: `${fr[mi]} ${ys.slice(2)}`,
        income,
        expense,
        profit: Number(s.profit ?? income - expense),
        invoices_fa: Number(s.invoices_fa || 0),
        sales_vr: Number(s.sales_vr || 0),
        bills: Number(s.bills || 0),
        salaries: Number(s.salaries || 0),
        clients_new: Number(s.clients_new || 0),
        receipts: Number(s.receipts || 0),
        owner_contrib: Number(s.owner_contrib || 0),
        owner_draw: Number(s.owner_draw || 0),
      };
    });
  }, [data, range]);

  const applyPreset = (p: string) => {
    setPreset(p);
    setRange(defaultRange(p));
  };

  if (stockOnly) {
    return <Navigate to="/products" replace />;
  }

  if (loading && !data)
    return (
      <div className="atlas-page ac-dash">
        <div className="ac-dash-hero">
          <div className="skeleton" style={{ height: 12, width: 160, marginBottom: 10 }} />
          <div className="skeleton" style={{ height: 32, width: 240, marginBottom: 8 }} />
          <div className="skeleton" style={{ height: 14, width: 320 }} />
        </div>
        <div className="ac-metric-grid">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="ac-metric skeleton" style={{ minHeight: 100 }} />
          ))}
        </div>
        <div className="skeleton" style={{ height: 240, borderRadius: 16, marginTop: 12 }} />
      </div>
    );
  if (error && !data)
    return (
      <div className="ac-dash ac-dash-error">
        <strong>Impossible de charger le tableau de bord</strong>
        <p>{error}</p>
      </div>
    );

  const cur = data?.currency || 'MAD';
  const productCount = products.length || data?.productCount || 0;
  const lowList = (
    products.length
      ? products.filter(
          (p: any) =>
            Number(p.stock_quantity ?? p.stock ?? 0) <
            Number(p.low_stock_threshold ?? p.min_stock ?? 5)
        )
      : data?.lowStockProducts || []
  ).slice(0, 5);
  const lowCount = lowList.length || data?.lowStockCount || 0;
  const todayRev = data?.today_revenue ?? data?.todayRevenue ?? data?.salesToday ?? 0;
  const pendingActions = actions.filter((a) => a.status === 'pending').slice(0, 5);
  const name = getUsername();
  const incomeSum = filteredSeries.reduce((a, s) => a + s.income, 0);
  const expenseSum = filteredSeries.reduce((a, s) => a + s.expense, 0);

  return (
    <div className="atlas-page ac-dash">
      <header className="ac-dash-hero">
        <p className="ac-dash-eyebrow">{todayLabel()}</p>
        <div className="ac-dash-hero-row">
          <div>
            <h1 className="ac-dash-hello">Bonjour, {name}.</h1>
            <p className="ac-dash-lead">
              Surface de vente synchronisée — voici ce qui mérite votre attention.
            </p>
          </div>
        </div>
      </header>

      <div className="ac-metric-grid">
        <div className="ac-metric">
          <div className="as-label"><svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>Produits</div>
          <div className="as-value">{productCount}</div>
          <div className="as-hint">valeur {fmt(Number(data?.stockValue ?? 0), cur)}</div>
        </div>
        <div className="ac-metric">
          <div className="as-label"><svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/></svg>Stock bas</div>
          <div className="as-value">{lowCount}</div>
          <div className="as-hint">à vérifier en rayon</div>
        </div>
        <div className="ac-metric">
          <div className="as-label"><svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16v12H4z"/><path d="M4 12l8 5 8-5"/></svg>À traiter</div>
          <div className="as-value">{pending}</div>
          <div className="as-hint">envois mobile</div>
        </div>
        <div className="ac-metric">
          <div className="as-label"><svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>Ventes du jour</div>
          <div className="as-value">{fmt(todayRev, cur)}</div>
          <div className="as-hint">toutes factures</div>
        </div>
      </div>

      
      <div className="ac-usage-grid">
        <div className="ac-usage-card">
          <span className="ac-usage-lab">Produits</span>
          <strong className="ac-usage-val">{productCount}</strong>
          <div className="ac-usage-track"><i style={{ width: `${Math.min(100, productCount ? 40 + (productCount % 50) : 8)}%` }} /></div>
          <div className="ac-usage-meta"><span>catalogue</span><span>{productCount} fiches</span></div>
        </div>
        <div className="ac-usage-card">
          <span className="ac-usage-lab">Stock bas</span>
          <strong className="ac-usage-val">{lowCount}</strong>
          <div className="ac-usage-track"><i style={{ width: `${productCount ? Math.min(100, Math.round((lowCount / Math.max(productCount, 1)) * 100)) : 0}%` }} /></div>
          <div className="ac-usage-meta"><span>{productCount ? Math.round((lowCount / Math.max(productCount, 1)) * 100) : 0}%</span><span>du catalogue</span></div>
        </div>
        <div className="ac-usage-card">
          <span className="ac-usage-lab">Créances</span>
          <strong className="ac-usage-val">{fmt(data?.receivables ?? data?.clientDebt, cur)}</strong>
          <div className="ac-usage-track"><i style={{ width: `${Math.min(100, Number(data?.receivables ?? 0) ? 55 : 5)}%` }} /></div>
          <div className="ac-usage-meta"><span>ouvert</span><span>clients</span></div>
        </div>
        <div className="ac-usage-card">
          <span className="ac-usage-lab">Ventes du jour</span>
          <strong className="ac-usage-val">{fmt(todayRev, cur)}</strong>
          <div className="ac-usage-track"><i style={{ width: `${Math.min(100, todayRev ? 62 : 5)}%` }} /></div>
          <div className="ac-usage-meta"><span>jour</span><span>{cur}</span></div>
        </div>
      </div>

      <NextActionsPanel />
      <div className="ac-panel" style={{ marginBottom: 14 }}>
        <div className="ac-panel-head">
<div>
            <h3><svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight:6,verticalAlign:'middle'}}><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/></svg>Flux de trésorerie</h3>
            <p>Entrées, sorties et résultat par mois</p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            {[
              ['1m', '1 mois'],
              ['6m', '6 mois'],
              ['12m', '1 an'],
              ['24m', '2 ans'],
              ['ytd', 'Cette année'],
            ].map(([k, lab]) => (
              <button
                key={k}
                type="button"
                className={preset === k ? '' : 'secondary'}
                style={{ borderRadius: 999, padding: '6px 12px', fontSize: 12 }}
                onClick={() => applyPreset(k)}
              >
                {lab}
              </button>
            ))}
          </div>
        </div>
        <div className="ac-chart-toolbar">
          <div className="dash-date-range" style={{ marginTop: 0, minWidth: 220, flex: '1 1 220px' }}>
            <DateRangePicker
              size="sm"
              from={range.from}
              to={range.to}
              showPresets
              onChange={(from, to) => {
                setPreset('custom');
                setRange({ from, to });
              }}
            />
          </div>
          <div className="ac-stat-pair">
            <div>
              <span className="ac-stat-pair-lab">ENTRÉES</span>
              <strong>{fmt(incomeSum, cur)}</strong>
            </div>
            <div>
              <span className="ac-stat-pair-lab">SORTIES</span>
              <strong>{fmt(expenseSum, cur)}</strong>
            </div>
          </div>
        </div>
        <AreaChart
          series={filteredSeries}
          keys={[
            { key: 'income', label: 'Entrées', color: '#2563eb' },
            { key: 'expense', label: 'Sorties', color: '#f59e0b' },
          ]}
          height={240}
        />

        <div style={{ marginTop: 18, borderTop: '1px solid #e8eaef', paddingTop: 14 }}>
          <h4 style={{ margin: '0 0 6px', fontSize: 14, fontWeight: 700 }}>Évolution du profit</h4>
          <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--muted)' }}>Résultat net mensuel sur la période sélectionnée</p>
          <AreaChart
            series={filteredSeries}
            keys={[{ key: 'profit', label: 'Profit', color: '#0ea5e9' }]}
            height={180}
          />
        </div>
      </div>

      
      <div className="ac-panel" style={{ marginBottom: 14 }}>
        <div className="ac-panel-head">
          <div>
            <h3>Ventes FA vs VR / vente rapide</h3>
            <p>Chiffre d’affaires factures vs tickets / VR sur la période</p>
          </div>
        </div>
        <BarChart
          series={filteredSeries}
          keys={[
            { key: 'invoices_fa', color: '#2563eb', label: 'Factures (FA)' },
            { key: 'sales_vr', color: '#0369a1', label: 'VR / Quick sale' },
          ]}
        />
      </div>

      <div className="ac-panel" style={{ marginBottom: 14 }}>
        <div className="ac-panel-head">
          <div>
            <h3>Achats fournisseurs & salaires</h3>
            <p>Factures d’achat (bills) et masse salariale débitée du solde</p>
          </div>
        </div>
        <BarChart
          series={filteredSeries}
          keys={[
            { key: 'bills', color: '#b45309', label: 'Achats (bills)' },
            { key: 'salaries', color: '#52525b', label: 'Salaires' },
          ]}
        />
      </div>

      <div className="ac-panel" style={{ marginBottom: 14 }}>
        <div className="ac-panel-head">
          <div>
            <h3>Encaissements & nouveaux clients</h3>
            <p>Recettes encaissées et clients créés par mois</p>
          </div>
        </div>
        <BarChart
          series={filteredSeries}
          keys={[
            { key: 'receipts', color: '#525252', label: 'Encaissements' },
            { key: 'clients_new', color: '#a3a3a3', label: 'Nouveaux clients' },
          ]}
        />
      </div>

      {(Array.isArray(data?.expenseCategories) || Array.isArray(data?.expenseByCategory) || Array.isArray(data?.expenseCats)) && (
        <div className="ac-panel" style={{ marginBottom: 14 }}>
          <div className="ac-panel-head">
            <div>
              <h3>Répartition des charges</h3>
              <p>Top catégories de dépenses (hors achats fournisseurs)</p>
            </div>
          </div>
          <HBarChart
            color="#b45309"
            items={(data.expenseCategories || data.expenseByCategory || data.expenseCats || []).map((c: any) => ({
              label: String(c.category || c.name || c.label || 'Autre'),
              value: Number(c.total || c.value || c.amount || 0),
            }))}
          />
        </div>
      )}

      <div className="ac-metric-grid" style={{ marginBottom: 14 }}>
        <div className="ac-metric">
          <div className="as-label"><svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M2 10h20"/></svg>Solde actuel</div>
          <div className="as-value" style={{ fontSize: '1.35rem' }}>
            {fmt(data?.balance ?? data?.cashBalance, cur)}
          </div>
          <div className="as-hint">caisse &amp; banque</div>
        </div>
        <div className="ac-metric">
          <div className="as-label"><svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>Créances</div>
          <div className="as-value" style={{ fontSize: '1.35rem' }}>
            {fmt(data?.receivables ?? data?.clientDebt, cur)}
          </div>
          <div className="as-hint">clients</div>
        </div>
        <div className="ac-metric">
          <div className="as-label"><svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z"/><path d="M3 9l2-4h14l2 4"/></svg>Dettes</div>
          <div className="as-value" style={{ fontSize: '1.35rem' }}>
            {fmt(data?.payables ?? data?.vendorDebt, cur)}
          </div>
          <div className="as-hint">fournisseurs</div>
        </div>
        <div className="ac-metric">
          <div className="as-label"><svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/></svg>Profit période</div>
          <div className="as-value" style={{ fontSize: '1.35rem' }}>
            {fmt(incomeSum - expenseSum, cur)}
          </div>
          <div className="as-hint">selon filtre dates</div>
        </div>
      </div>

      <div className="ac-panel ac-presence-panel" style={{ marginBottom: 16, padding: 16 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, flex: '1 1 auto' }}>Présence</h3>
          <select
            value={attEmpId}
            onChange={(e) => setAttEmpId(e.target.value)}
            style={{ minWidth: 160, padding: '8px 10px' }}
            aria-label="Employé"
          >
            <option value="">Tous les employés</option>
            {attEmployees.map((e) => (
              <option key={e.id} value={String(e.id)}>{e.name}</option>
            ))}
          </select>
          <select
            value={attDays}
            onChange={(e) => setAttDays(Number(e.target.value))}
            style={{ minWidth: 100, padding: '8px 10px' }}
            aria-label="Période"
          >
            <option value={7}>7 jours</option>
            <option value={14}>14 jours</option>
            <option value={30}>30 jours</option>
          </select>
        </div>
        {attWeek && attWeek.length > 0 ? (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 110, overflowX: 'auto' }}>
            {attWeek.map((d) => {
              const mx = Math.max(1, ...attWeek.map((x) => x.present + x.late));
              const hh = Math.round(((d.present + d.late) / mx) * 80);
              return (
                <div key={d.date} style={{ flex: '1 0 28px', textAlign: 'center', minWidth: 28 }} title={`${d.date}: ${d.present}p ${d.late}r ${d.absent}a`}>
                  <div style={{ height: 80, justifyContent: 'flex-end', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ width: '70%', height: Math.max(hh, d.present || d.late ? 4 : 0), background: 'var(--ac-primary)', borderRadius: '4px 4px 0 0' }} />
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>{d.date.slice(8)}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>Aucune donnée de présence sur la période.</p>
        )}
      </div>



      <div className="atlas-donut-wrap">
        <div className="atlas-donut-card">
          <h4>Créances clients</h4>
          <p className="dd-sub">Crédit ouvert vs en retard</p>
          <DonutChart
            segments={[
              { value: Number(data?.unpaidSales?.open ?? 0) || 1, color: '#737373', label: 'Ouvert' },
              { value: Number(data?.unpaidSales?.overdue ?? 0) || 0, color: '#262626', label: 'En retard' },
            ]}
            centerLabel="Créances"
            centerValue={fmt(Number(data?.unpaidSales?.total ?? data?.receivables ?? 0), cur)}
          />
          <div className="atlas-legend">
            <span><i style={{ background: 'var(--ac-ink)' }} />Ouvert {fmt(Number(data?.unpaidSales?.open ?? 0), cur)}</span>
            <span><i style={{ background: '#c45c4a' }} />Retard {fmt(Number(data?.unpaidSales?.overdue ?? 0), cur)}</span>
          </div>
        </div>
        <div className="atlas-donut-card">
          <h4>Dettes fournisseurs</h4>
          <p className="dd-sub">À payer</p>
          <DonutChart
            segments={[
              { value: Number(data?.unpaidPurchases?.open ?? 0), color: '#c4a574', label: 'Ouvert' },
              { value: Number(data?.unpaidPurchases?.overdue ?? 0), color: '#b91c1c', label: 'En retard' },
            ]}
            centerLabel="DH"
            centerValue={fmt(Number(data?.unpaidPurchases?.total ?? data?.payables ?? 0), '')}
          />
          <div className="atlas-legend">
            <span><i style={{ background: '#c4a574' }} />Ouvert {fmt(Number(data?.unpaidPurchases?.open ?? 0), cur)}</span>
            <span><i style={{ background: '#b91c1c' }} />Retard {fmt(Number(data?.unpaidPurchases?.overdue ?? 0), cur)}</span>
          </div>
        </div>
        <div className="atlas-donut-card">
          <h4>Santé stock</h4>
          <p className="dd-sub">OK vs sous seuil</p>
          <DonutChart
            segments={[
              { value: Math.max(0, productCount - lowCount), color: 'var(--ac-ink)', label: 'OK' },
              { value: lowCount, color: '#e8a317', label: 'Bas' },
            ]}
            centerLabel="articles"
            centerValue={String(productCount)}
          />
          <div className="atlas-legend">
            <span><i style={{ background: 'var(--ac-ink)' }} />OK {Math.max(0, productCount - lowCount)}</span>
            <span><i style={{ background: '#e8a317' }} />Bas {lowCount}</span>
          </div>
        </div>
        <div className="atlas-donut-card">
          <h4>Répartition charges</h4>
          <p className="dd-sub">Top catégories</p>
          <DonutChart
            segments={(data?.expenseCategories || []).slice(0, 5).map((c: any, i: number) => ({
              value: Number(c.total || 0),
              color: ['var(--ac-ink)', '#c4a574', '#e8a317', '#9aa3b5', '#c45c4a'][i % 5],
              label: c.category,
            }))}
            centerLabel="charges"
            centerValue={fmt(
              (data?.expenseCategories || []).reduce((a: number, c: any) => a + Number(c.total || 0), 0),
              ''
            )}
          />
          <div className="atlas-legend">
            {(data?.expenseCategories || []).slice(0, 4).map((c: any, i: number) => (
              <span key={c.category}>
                <i style={{ background: ['var(--ac-ink)', '#c4a574', '#e8a317', '#9aa3b5'][i % 4] }} />
                {c.category}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="atlas-split">
        <div className="ac-panel">
          <div className="ac-panel-head">
            <div>
              <h3><svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight:6,verticalAlign:'middle'}}><path d="M9 5h12M9 12h12M9 19h12M5 5v.01M5 12v.01M5 19v.01"/></svg>Prochaines actions</h3>
              <p>Traitez les envois du terrain.</p>
            </div>
            <Link to="/actions" className="ac-dash-link">
              Voir la boîte →
            </Link>
          </div>
          {pendingActions.length === 0 ? (
            <div className="ac-dash-empty">
              <div className="ae-ico">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <strong>Tout est à jour</strong>
              <p>Les nouveaux scans du téléphone apparaîtront ici.</p>
            </div>
          ) : (
            pendingActions.map((a) => (
              <div className="ac-dash-row" key={a.id}>
                <div className="ari-av">{(a.type || 'AC').slice(0, 2).toUpperCase()}</div>
                <div>
                  <div className="ari-title">{a.title}</div>
                  <div className="ari-sub">
                    {a.type} · {a.created_at?.replace('T', ' ').slice(0, 16)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="ac-panel">
          <div className="ac-panel-head">
            <div>
              <h3><svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight:6,verticalAlign:'middle'}}><path d="M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8"/></svg>Santé du stock</h3>
              <p>Articles sous le minimum rayon.</p>
            </div>
            <Link to="/products" className="ac-dash-link">
              →
            </Link>
          </div>
          {lowList.length === 0 ? (
            <div className="ac-dash-empty">
              <div className="atlas-empty-icon" aria-hidden><IconPackage size={32} /></div>
              <strong>Stock OK</strong>
              <p>Aucun article sous le seuil.</p>
            </div>
          ) : (
            lowList.map((p: any) => (
              <div className="ac-dash-row" key={p.id || p.sku}>
                <div className="ari-av" style={{ display:"flex",alignItems:"center",justifyContent:"center" }}><IconPackage size={18} /></div>
                <div>
                  <div className="ari-title">{p.name}</div>
                  <div className="ari-sub">{p.sku}</div>
                </div>
                <div className="ari-right bad">
                  {Number(p.stock_quantity ?? p.stock ?? 0)}
                  <div className="ari-sub">min {p.low_stock_threshold ?? p.min_stock ?? '—'}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
