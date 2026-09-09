import { useEffect, useMemo, useState } from 'react';
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
  const k = String(s.key || s.label || '');
  if (/^\d{4}-\d{2}/.test(k)) {
    const [ys, ms] = k.split('-');
    return `${ms}/${ys.slice(2)}`;
  }
  // Try extract from "Sep 25" style labels
  const m = k.match(/(\d{2})\/(\d{2})/);
  if (m) return `${m[1]}/${m[2]}`;
  return String(s.label || s.key || '').slice(0, 6);
}

/** Simple SVG bar chart — adaptive labels for 1m…24m (no overlapping axis text) */
function BarChart({
  series,
  keys,
}: {
  series: { key: string; label?: string; [k: string]: any }[];
  keys: { key: string; label: string; color: string }[];
  colors?: string[];
}) {
  if (!series.length) {
    return (
      <div className="atlas-empty" style={{ minHeight: 160 }}>
        <p>Pas encore de données pour cette période.</p>
      </div>
    );
  }
  const allZero = series.every((s) => keys.every((k) => !Number(s[k.key] || 0)));
  const max = Math.max(
    1,
    ...series.flatMap((s) => keys.map((k) => Number(s[k.key] || 0)))
  );
  const n = series.length;
  // 24 months → label every 4th; 12 → every 2nd; never draw all 24 full strings
  const labelEvery = n <= 4 ? 1 : n <= 8 ? 1 : n <= 12 ? 2 : n <= 18 ? 3 : 4;
  const rotate = false; // labels rendered in HTML below SVG
  const w = Math.max(560, Math.min(1100, n * 32));
  const bottomPad = 16;
  const h = 180;
  const pad = 40;
  const groupW = (w - pad * 2) / Math.max(1, n);
  const barW = Math.min(16, Math.max(2.5, (groupW - 4) / Math.max(1, keys.length)));

  // Year boundary markers for long ranges
  const yearStarts = new Set<number>();
  series.forEach((s, i) => {
    const k = String(s.key || '');
    if (/^\d{4}-01$/.test(k.slice(0, 7))) yearStarts.add(i);
  });

  return (
    <div style={{ width: '100%' }}>
      {allZero && (
        <p style={{ margin: '0 0 8px', fontSize: 12, color: '#8a9a92', textAlign: 'center' }}>
          Aucun mouvement sur cette période — les barres resteront à 0.
        </p>
      )}
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ maxHeight: 260 }} role="img" aria-label="Graphique flux de trésorerie">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = h - bottomPad - t * (h - bottomPad - 12);
          return (
            <g key={t}>
              <line x1={pad} x2={w - 8} y1={y} y2={y} stroke="#ebe6dc" strokeWidth="1" />
              <text x={4} y={y + 3} fontSize="9" fill="#8a9a92">
                {max >= 1000 ? `${Math.round((max * t) / 1000)}k` : Math.round(max * t)}
              </text>
            </g>
          );
        })}
        {series.map((s, i) => {
          const x0 = pad + i * groupW + groupW / 2;
          const showLabel = i % labelEvery === 0 || i === n - 1 || yearStarts.has(i);
          const lab = shortMonthLabel(s);
          return (
            <g key={s.key || i}>
              {yearStarts.has(i) && (
                <line
                  x1={x0 - groupW / 2}
                  x2={x0 - groupW / 2}
                  y1={12}
                  y2={h - bottomPad}
                  stroke="#e5dfd4"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
              )}
              {keys.map((k, ki) => {
                const val = Number(s[k.key] || 0);
                const bh = (val / max) * (h - bottomPad - 12);
                const x = x0 - (keys.length * barW) / 2 + ki * barW;
                const y = h - bottomPad - bh;
                return (
                  <rect
                    key={k.key}
                    x={x}
                    y={y}
                    width={Math.max(2, barW - 1)}
                    height={Math.max(0, bh)}
                    rx={2}
                    fill={k.color}
                  >
                    <title>{`${lab} · ${k.label}: ${val}`}</title>
                  </rect>
                );
              })}
              {/* labels drawn outside SVG for clarity */}
            </g>
          );
        })}
      </svg>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`,
          gap: 0,
          paddingLeft: pad,
          paddingRight: 12,
          marginTop: 4,
          fontSize: n > 18 ? 9 : 10,
          color: '#5c6b66',
          lineHeight: 1.2,
        }}
      >
        {series.map((s, i) => {
          const show = i % labelEvery === 0 || i === n - 1 || yearStarts.has(i);
          return (
            <span
              key={s.key || i}
              style={{
                textAlign: 'center',
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                visibility: show ? 'visible' : 'hidden',
                fontWeight: yearStarts.has(i) ? 700 : 500,
              }}
              title={shortMonthLabel(s)}
            >
              {show ? shortMonthLabel(s) : ''}
            </span>
          );
        })}
      </div>
    </div>
  );
}



/** Line chart for profit / trends over long ranges */
function LineChart({
  series,
  valueKey = 'profit',
  color = '#0f766e',
  label = 'Profit',
}: {
  series: { key: string; label?: string; [k: string]: any }[];
  valueKey?: string;
  color?: string;
  label?: string;
}) {
  if (!series.length) {
    return (
      <div className="atlas-empty" style={{ minHeight: 140 }}>
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
        <line x1={padL} x2={w - 8} y1={padT + plotH / 2} y2={padT + plotH / 2} stroke="#e5dfd4" strokeWidth="1" strokeDasharray="4 3" />
        <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={3} fill={color}>
            <title>{`${p.lab}: ${Math.round(p.v)}`}</title>
          </circle>
        ))}
        <text x={4} y={padT + 8} fontSize="9" fill="#8a9a92">{max >= 1000 ? `${Math.round(max / 1000)}k` : Math.round(max)}</text>
      </svg>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, paddingLeft: padL, paddingRight: 12, fontSize: 10, color: '#5c6b66' }}>
        {pts.map((p, i) => (
          <span key={i} style={{ textAlign: 'center', visibility: (i % labelEvery === 0 || i === n - 1) ? 'visible' : 'hidden' }}>{p.lab}</span>
        ))}
      </div>
    </div>
  );
}

function HBarChart({
  items,
  color = '#1a6b66',
}: {
  items: { label: string; value: number }[];
  color?: string;
}) {
  if (!items.length) {
    return (
      <div className="atlas-empty" style={{ minHeight: 100 }}>
        <p>Aucune catégorie.</p>
      </div>
    );
  }
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.slice(0, 8).map((it) => (
        <div key={it.label} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 72px', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#3d4f4a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.label}>{it.label}</span>
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
  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const size = 120;
  const cx = size / 2;
  const cy = size / 2;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f0ebe3" strokeWidth="12" />
        {segments.map((seg, i) => {
          const frac = Math.max(0, seg.value) / total;
          const dash = frac * c;
          const el = (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth="12"
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
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
        }}
      >
        <strong style={{ fontSize: '0.95rem', color: '#14221f', letterSpacing: '-0.02em' }}>{centerValue}</strong>
        <span style={{ fontSize: '0.65rem', color: '#6b7c76' }}>{centerLabel}</span>
      </div>
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
    <div className="atlas-card" style={{ marginBottom: 12 }}>
      <div className="atlas-card-head">
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
      <div className="atlas-page">
        <div className="skeleton" style={{ height: 14, width: 180, marginBottom: 12 }} />
        <div className="skeleton" style={{ height: 36, width: 280, marginBottom: 20 }} />
        <div className="atlas-loading-grid">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton" />
          ))}
        </div>
        <div className="skeleton" style={{ height: 220, borderRadius: 18, marginTop: 8 }} />
      </div>
    );
  if (error && !data)
    return (
      <div className="empty" style={{ color: 'var(--bad)' }}>
        Erreur : {error}
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
  const recent = actions.slice(0, 8);
  const name = getUsername();
  const incomeSum = filteredSeries.reduce((a, s) => a + s.income, 0);
  const expenseSum = filteredSeries.reduce((a, s) => a + s.expense, 0);

  return (
    <div className="atlas-page">
      <p className="atlas-eyebrow">{todayLabel()}</p>
      <h1 className="atlas-hello">Bonjour, {name}.</h1>
      <p className="atlas-lead">
        Votre surface de vente est synchronisée. Voici ce qui mérite votre attention.
      </p>

      <div className="atlas-stat-grid">
        <div className="atlas-stat mint">
          <div className="as-label"><svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>Produits</div>
          <div className="as-value">{productCount}</div>
          <div className="as-hint">valeur {fmt(Number(data?.stockValue ?? 0), cur)}</div>
        </div>
        <div className="atlas-stat sand">
          <div className="as-label"><svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/></svg>Stock bas</div>
          <div className="as-value">{lowCount}</div>
          <div className="as-hint">à vérifier en rayon</div>
        </div>
        <div className="atlas-stat blush">
          <div className="as-label"><svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16v12H4z"/><path d="M4 12l8 5 8-5"/></svg>À traiter</div>
          <div className="as-value">{pending}</div>
          <div className="as-hint">envois mobile</div>
        </div>
        <div className="atlas-stat paper">
          <div className="as-label"><svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>Ventes du jour</div>
          <div className="as-value">{fmt(todayRev, cur)}</div>
          <div className="as-hint">toutes factures</div>
        </div>
      </div>

      <NextActionsPanel />
      <div className="atlas-card" style={{ marginBottom: 14 }}>
        <div className="atlas-card-head">
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
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: '#6b7c76' }}>
            Du{' '}
            <input
              type="date"
              value={range.from}
              onChange={(e) => {
                setPreset('custom');
                setRange((r) => ({ ...r, from: e.target.value }));
              }}
              style={{ marginLeft: 6 }}
            />
          </label>
          <label style={{ fontSize: 12, color: '#6b7c76' }}>
            Au{' '}
            <input
              type="date"
              value={range.to}
              onChange={(e) => {
                setPreset('custom');
                setRange((r) => ({ ...r, to: e.target.value }));
              }}
              style={{ marginLeft: 6 }}
            />
          </label>
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#6b7c76' }}>
            Entrées <strong style={{ color: '#1a6b66' }}>{fmt(incomeSum, cur)}</strong>
            {' · '}
            Sorties <strong style={{ color: '#b91c1c' }}>{fmt(expenseSum, cur)}</strong>
            {' · '}
            Profit <strong>{fmt(incomeSum - expenseSum, cur)}</strong>
          </span>
        </div>
        <BarChart
          series={filteredSeries}
          keys={[
            { key: 'income', label: 'Entrées', color: '#1a6b66' },
            { key: 'expense', label: 'Sorties', color: '#c4a574' },
          ]}
        />
        <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: '#6b7c76' }}>
          <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#1a6b66', marginRight: 6 }} />Entrées</span>
          <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#c4a574', marginRight: 6 }} />Sorties</span>
        </div>

        <div style={{ marginTop: 18, borderTop: '1px solid #ebe6dc', paddingTop: 14 }}>
          <h4 style={{ margin: '0 0 6px', fontSize: 14 }}>Évolution du profit</h4>
          <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--muted)' }}>Résultat net mensuel sur la période sélectionnée</p>
          <LineChart series={filteredSeries} valueKey="profit" color="#0f766e" label="Profit" />
        </div>
      </div>

      {(Array.isArray(data?.expenseCategories) || Array.isArray(data?.expenseByCategory) || Array.isArray(data?.expenseCats)) && (
        <div className="atlas-card" style={{ marginBottom: 14 }}>
          <div className="atlas-card-head">
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

      <div className="atlas-stat-grid" style={{ marginBottom: 14 }}>
        <div className="atlas-stat paper">
          <div className="as-label"><svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M2 10h20"/></svg>Solde actuel</div>
          <div className="as-value" style={{ fontSize: '1.35rem' }}>
            {fmt(data?.balance ?? data?.cashBalance, cur)}
          </div>
          <div className="as-hint">caisse &amp; banque</div>
        </div>
        <div className="atlas-stat paper">
          <div className="as-label"><svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>Créances</div>
          <div className="as-value" style={{ fontSize: '1.35rem' }}>
            {fmt(data?.receivables ?? data?.clientDebt, cur)}
          </div>
          <div className="as-hint">clients</div>
        </div>
        <div className="atlas-stat paper">
          <div className="as-label"><svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z"/><path d="M3 9l2-4h14l2 4"/></svg>Dettes</div>
          <div className="as-value" style={{ fontSize: '1.35rem' }}>
            {fmt(data?.payables ?? data?.vendorDebt, cur)}
          </div>
          <div className="as-hint">fournisseurs</div>
        </div>
        <div className="atlas-stat paper">
          <div className="as-label"><svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/></svg>Profit période</div>
          <div className="as-value" style={{ fontSize: '1.35rem' }}>
            {fmt(incomeSum - expenseSum, cur)}
          </div>
          <div className="as-hint">selon filtre dates</div>
        </div>
      </div>


      <div className="atlas-donut-wrap">
        <div className="atlas-donut-card">
          <h4>Créances clients</h4>
          <p className="dd-sub">Crédit ouvert vs en retard</p>
          <DonutChart
            segments={[
              { value: Number(data?.unpaidSales?.open ?? 0), color: '#1a6b66', label: 'Ouvert' },
              { value: Number(data?.unpaidSales?.overdue ?? 0), color: '#c45c4a', label: 'En retard' },
            ]}
            centerLabel="DH"
            centerValue={fmt(Number(data?.unpaidSales?.total ?? data?.receivables ?? 0), '')}
          />
          <div className="atlas-legend">
            <span><i style={{ background: '#1a6b66' }} />Ouvert {fmt(Number(data?.unpaidSales?.open ?? 0), cur)}</span>
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
              { value: Math.max(0, productCount - lowCount), color: '#1a6b66', label: 'OK' },
              { value: lowCount, color: '#e8a317', label: 'Bas' },
            ]}
            centerLabel="articles"
            centerValue={String(productCount)}
          />
          <div className="atlas-legend">
            <span><i style={{ background: '#1a6b66' }} />OK {Math.max(0, productCount - lowCount)}</span>
            <span><i style={{ background: '#e8a317' }} />Bas {lowCount}</span>
          </div>
        </div>
        <div className="atlas-donut-card">
          <h4>Répartition charges</h4>
          <p className="dd-sub">Top catégories</p>
          <DonutChart
            segments={(data?.expenseCategories || []).slice(0, 5).map((c: any, i: number) => ({
              value: Number(c.total || 0),
              color: ['#1a6b66', '#c4a574', '#e8a317', '#6b7c76', '#c45c4a'][i % 5],
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
                <i style={{ background: ['#1a6b66', '#c4a574', '#e8a317', '#6b7c76'][i % 4] }} />
                {c.category}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="atlas-split">
        <div className="atlas-card">
          <div className="atlas-card-head">
            <div>
              <h3><svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight:6,verticalAlign:'middle'}}><path d="M9 5h12M9 12h12M9 19h12M5 5v.01M5 12v.01M5 19v.01"/></svg>Prochaines actions</h3>
              <p>Traitez les envois du terrain.</p>
            </div>
            <Link to="/actions" className="atlas-link">
              Voir la boîte →
            </Link>
          </div>
          {pendingActions.length === 0 ? (
            <div className="atlas-empty">
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
              <div className="atlas-row-item" key={a.id}>
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

        <div className="atlas-card">
          <div className="atlas-card-head">
            <div>
              <h3><svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight:6,verticalAlign:'middle'}}><path d="M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8"/></svg>Santé du stock</h3>
              <p>Articles sous le minimum rayon.</p>
            </div>
            <Link to="/products" className="atlas-link">
              →
            </Link>
          </div>
          {lowList.length === 0 ? (
            <div className="atlas-empty">
              <div className="atlas-empty-icon" aria-hidden><IconPackage size={32} /></div>
              <strong>Stock OK</strong>
              <p>Aucun article sous le seuil.</p>
            </div>
          ) : (
            lowList.map((p: any) => (
              <div className="atlas-row-item" key={p.id || p.sku}>
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

      <div className="atlas-card">
        <div className="atlas-card-head">
          <div>
            <h3><svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight:6,verticalAlign:'middle'}}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>Activité récente</h3>
            <p>Scans et demandes mobile.</p>
          </div>
        </div>
        {recent.length === 0 ? (
          <div className="atlas-empty">
            <p>Pas encore d&apos;activité mobile.</p>
          </div>
        ) : (
          <div className="atlas-activity">
            {recent.map((a) => (
              <div className="atlas-act" key={a.id}>
                <span className={`dot ${a.type === 'stock_check' ? 'warn' : ''}`} />
                <div>
                  <strong>{a.title}</strong>
                  <span>
                    {a.detail || a.type} · {a.created_at?.replace('T', ' ').slice(0, 19)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
