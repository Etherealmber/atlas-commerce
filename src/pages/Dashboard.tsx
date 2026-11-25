import { intlLocale, t, useLang } from '../i18n/core';
import { useEffect, useMemo, useState } from 'react';
import ProductArtwork from '../components/ProductArtwork';
import { DateRangePicker } from '../components/DatePicker';
import { Link, Navigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { api } from '../api';
import { getUsername, isStockRole } from '../auth';
import { IconPackage } from '../components/Icons';
import { AreaChart, BarChart, DonutChart, HBarChart, formatCompactNum } from '../components/DashboardCharts';
import PageSkeleton from '../components/PageSkeleton';
import { MetricSpark, MetricTrend } from '../components/MetricSpark';
import Select from '../components/ui/Select';

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
    .toLocaleDateString(intlLocale(), { weekday: 'long', day: 'numeric', month: 'long' })
    .toUpperCase();
  const place = devicePlaceLabel();
  return place ? `${date} · ${place.toUpperCase()}` : date;
}

function fmt(n: number, cur = 'MAD') {
  const formatted = Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
  return cur ? `${formatted} ${cur}` : formatted;
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
  to.setHours(12, 0, 0, 0); // noon local -> stable date
  let from = new Date(to);
  if (preset === '7d') from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 6);
  else if (preset === '1m') from = new Date(to.getFullYear(), to.getMonth(), 1);
  else if (preset === '6m') from = new Date(to.getFullYear(), to.getMonth() - 5, 1);
  else if (preset === '12m' || preset === '1y') from = new Date(to.getFullYear(), to.getMonth() - 11, 1);
  else if (preset === '24m' || preset === '2y') from = new Date(to.getFullYear(), to.getMonth() - 23, 1);
  else if (preset === 'ytd' || preset === 'year') from = new Date(to.getFullYear(), 0, 1);
  else if (preset === '3m') from = new Date(to.getFullYear(), to.getMonth() - 2, 1);
  else from = new Date(to.getFullYear(), to.getMonth() - 5, 1);
  from.setHours(12, 0, 0, 0);
  return { from: toLocalYMD(from), to: toLocalYMD(to) };
}

const PRESET_OPTIONS = [
  ['7d', '7j', '7 jours'],
  ['1m', '1m', '1 mois'],
  ['6m', '6m', '6 mois'],
  ['12m', '1a', '1 an'],
  ['24m', '2a', '2 ans'],
  ['ytd', 'YTD', 'Cette année'],
] as const;

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
  if (err || !items.length) return null;
  return (
    <section className="ac-panel ac-dash-next-strip" aria-labelledby="dash-next-title">
      <header className="ac-dash-next-head">
        <span className="ac-dash-next-badge" aria-hidden="true">{items.length}</span>
        <div>
          <strong id="dash-next-title">Que faire ensuite ?</strong>
          <span className="ac-dash-next-sub">Priorités calculées à partir de vos données du jour</span>
        </div>
      </header>
      <ul className="ac-dash-next-items">
        {items.map((it, i) => {
          const tone = it.priority >= 9 ? 'high' : it.priority >= 7 ? 'mid' : 'low';
          const body = (
            <>
              <span className="ac-dash-next-text">
                <strong>{it.title}</strong>
                <span>{it.detail}</span>
              </span>
              {it.href ? (
                <span className="ac-dash-next-go">Ouvrir<ArrowRight size={14} strokeWidth={2.25} aria-hidden="true" /></span>
              ) : null}
            </>
          );
          return (
            <li key={i} className={`ac-dash-next-item is-${tone}`}>
              {it.href ? <Link to={it.href} className="ac-dash-next-card">{body}</Link> : <div className="ac-dash-next-card">{body}</div>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function Dashboard() {
  useLang(); // re-render greeting/date on language change
  const [attEnabled, setAttEnabled] = useState(false);
  const [attWeek, setAttWeek] = useState<{ date: string; present: number; late: number; absent: number }[] | null>(null);
  const [attEmpId, setAttEmpId] = useState<string>('');
  const [attDays, setAttDays] = useState(7);
  const [attEmployees, setAttEmployees] = useState<{ id: number; name: string }[]>([]);

  const stockOnly = isStockRole();
  const [data, setData] = useState<any>(null);
  const [actions, setActions] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
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
        const token = getToken() || '';
        const base = getApiBase();
        /* Silent-skip when the Pointage module is disabled — avoids a noisy 403. */
        let attOn = false;
        try {
          const s: any = await api.getSettings();
          attOn = Number(s?.data?.attendance_enabled) === 1;
        } catch {
          attOn = false;
        }
        if (!attOn) {
          if (!cancelled) {
            setAttEnabled(false);
            setAttWeek([]);
          }
          return;
        }
        if (!cancelled) setAttEnabled(true);
        try {
          const el: any = await api.getEmployees?.({ status: 'active' });
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
        const j = (await r.json().catch(() => null)) as { data?: { days?: any[] } } | null;
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
    let lastLoadedAt = 0;
    let productsLoadedAt = 0;
    const baseMs = 300_000;
    // The full product list (with variants) only feeds the product count and the
    // « stock bas » list, and the dashboard payload already carries the counts.
    // Background refreshes re-read it at most every 15 min instead of every 5.
    const PRODUCTS_REFRESH_MS = 900_000;

    const schedule = () => {
      if (stopped) return;
      if (timer) window.clearTimeout(timer);
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
      const delay = hidden
        ? baseMs * 3
        : Math.min(baseMs * Math.pow(2, Math.min(failStreak, 2)), 900_000);
      timer = window.setTimeout(() => void load(true), delay);
    };

    const load = async (soft = false) => {
      if (!soft) setLoading(true);
      try {
        const wantProducts = !soft || Date.now() - productsLoadedAt >= PRODUCTS_REFRESH_MS;
        const [dash, ac, pr, st] = await Promise.all([
          api.getDashboard().catch((e) => {
            throw e;
          }),
          api.listMobileActions({ status: 'all', limit: 12 }).catch(() => ({ data: [] })),
          wantProducts
            // Light projection: only the columns this page shows (name, sku,
            // stock, threshold, small artwork) — no `SELECT *`, no inline
            // megabyte photos, no schema checks, shared DO cache.
            ? api.getProducts({ include_variants: true, fields: 'light' }).catch(() => null)
            : Promise.resolve(null),
          api.getMobileActionStats().catch(() => ({ data: { pending: 0 } })),
        ]);
        if (stopped) return;
        lastLoadedAt = Date.now();
        setData(dash.data);
        setActions(ac.data || []);
        if (pr) {
          productsLoadedAt = Date.now();
          setProducts(pr.data || []);
        }
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
      if (document.visibilityState === 'visible') {
        if (Date.now() - lastLoadedAt > 90_000) void load(true);
      } else {
        schedule();
      }
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

  if (loading && !data) {
    return (
      <div className="atlas-page ac-dash ac-dash-page" aria-busy="true" aria-label="Chargement du tableau de bord">
        <PageSkeleton variant="dashboard" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="ac-dash ac-dash-page ac-dash-error">
        <strong>Impossible de charger le tableau de bord</strong>
        <p>{error}</p>
      </div>
    );
  }

  const cur = data?.currency || 'MAD';
  const productCount = products.length || Number(data?.productCount || 0);
  const lowList = (
    products.length
      ? products.filter(
          (p: any) =>
            Number(p.stock_quantity ?? p.stock ?? 0) <
            Number(p.low_stock_threshold ?? p.min_stock ?? 5),
        )
      : data?.lowStockProducts || []
  ).slice(0, 5);
  const lowCount = products.length
    ? products.filter(
        (p: any) =>
          Number(p.stock_quantity ?? p.stock ?? 0) <
          Number(p.low_stock_threshold ?? p.min_stock ?? 5),
      ).length
    : Number(data?.lowStockCount || 0);
  const todayRev = Number(data?.today_revenue ?? data?.todayRevenue ?? data?.salesToday ?? 0);
  const currentBalance = Number(data?.currentBalance ?? data?.balance ?? data?.cashBalance ?? 0);
  const receivablesTotal = Number(data?.unpaidSales?.total ?? data?.receivables ?? data?.clientDebt ?? 0);
  const payablesTotal = Number(data?.unpaidPurchases?.total ?? data?.payables ?? data?.vendorDebt ?? 0);
  const pendingActions = actions.filter((a) => a.status === 'pending').slice(0, 5);
  const name = getUsername();
  const incomeSum = filteredSeries.reduce((a, s) => a + s.income, 0);
  const expenseSum = filteredSeries.reduce((a, s) => a + s.expense, 0);
  const netPeriod = incomeSum - expenseSum;
  const expenseCategories = (
    data?.expenseCategories || data?.expenseByCategory || data?.expenseCats || []
  )
    .map((c: any) => ({
      label: String(c.category || c.name || c.label || 'Autre'),
      value: Number(c.total || c.value || c.amount || 0),
    }))
    .filter((c: { value: number }) => c.value > 0);

  return (
    <div className="atlas-page ac-dash ac-dash-page">
      <header className="ac-dash-hero">
        <p className="ac-dash-eyebrow">{todayLabel()}</p>
        <div className="ac-dash-hero-row">
          <div>
            <h1 className="ac-dash-hello">{t('Bonjour, {name}.', { name })}</h1>
            <p className="ac-dash-lead">
              Surface de vente synchronisée — voici ce qui mérite votre attention.
            </p>
          </div>
          <div className="ac-dash-hero-controls">
            <div className="ac-dash-period-pills" role="group" aria-label="Période rapide">
              {PRESET_OPTIONS.map(([k, shortLab, fullLab]) => (
                <button
                  key={k}
                  type="button"
                  className="ac-seg-btn"
                  aria-pressed={preset === k}
                  title={fullLab}
                  onClick={() => applyPreset(k)}
                >
                  {shortLab}
                </button>
              ))}
            </div>
            <div className="ac-dash-hero-picker">
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
          </div>
        </div>
      </header>

      <div className="ac-metric-grid ac-dash-kpis">
        <div className="ac-metric">
          <div className="as-label">
            <svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
            Produits
          </div>
          <div className="as-value">{productCount}<MetricTrend k="products" /></div>
          <div className="as-hint">valeur {fmt(Number(data?.stockValue ?? 0), cur)}</div>
          <MetricSpark k="products" />
        </div>
        <div className={`ac-metric ${lowCount > 0 ? 'ac-metric--warn' : ''}`}>
          <div className="as-label">
            <svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" /></svg>
            Stock bas
          </div>
          <div className="as-value">{lowCount}<MetricTrend k="low_stock" invert /></div>
          <div className="as-hint">à vérifier en rayon</div>
          <MetricSpark k="low_stock" invert />
        </div>
        <div className="ac-metric">
          <div className="as-label">
            <svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16v12H4z" /><path d="M4 12l8 5 8-5" /></svg>
            À traiter
          </div>
          <div className="as-value">{pending}<MetricTrend k="pending_actions" invert /></div>
          <div className="as-hint">envois mobile</div>
          <MetricSpark k="pending_actions" invert />
        </div>
        <div className="ac-metric">
          <div className="as-label">
            <svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
            Ventes du jour
          </div>
          <div className="as-value">{fmt(todayRev, cur)}<MetricTrend k="sales" compare="day" /></div>
          <div className="as-hint">toutes factures</div>
          <MetricSpark k="sales" unit="money" currency={cur} />
        </div>
      </div>

      <NextActionsPanel />

      <div className="ac-dash-primary-grid">
        <div className="ac-panel ac-dash-cashflow-panel">
          <div className="ac-panel-head">
            <div>
              <h3>
                <svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-6" /></svg>
                Flux de trésorerie
              </h3>
              <p>Entrées et sorties mensuelles sur la période</p>
            </div>
            <div className="ac-stat-pair">
              <div title={fmt(incomeSum, cur)}>
                <span className="ac-stat-pair-lab">ENTRÉES</span>
                <strong>{formatCompactNum(incomeSum, cur, 1_000_000)}</strong>
              </div>
              <div title={fmt(expenseSum, cur)}>
                <span className="ac-stat-pair-lab">SORTIES</span>
                <strong>{formatCompactNum(expenseSum, cur, 1_000_000)}</strong>
              </div>
              <div title={fmt(netPeriod, cur)}>
                <span className="ac-stat-pair-lab">NET</span>
                <strong style={{ color: netPeriod > 0 ? 'var(--ac-chart-green, #10b981)' : netPeriod < 0 ? 'var(--ac-chart-red, #ef4444)' : undefined }}>
                  {netPeriod > 0 ? '+' : ''}{formatCompactNum(netPeriod, cur, 1_000_000)}
                </strong>
              </div>
            </div>
          </div>
          <AreaChart
            series={filteredSeries}
            keys={[
              { key: 'income', label: 'Entrées', color: 'var(--ac-chart-blue, #2563eb)' },
              { key: 'expense', label: 'Sorties', color: 'var(--ac-chart-amber-bright, #f59e0b)' },
            ]}
            height={270}
            unit={cur}
            showNetDelta
            emptyLabel="Aucune entrée/sortie sur cette période"
          />
        </div>

        <div className="ac-panel ac-dash-profit-panel">
          <div className="ac-panel-head">
            <div>
              <h3>Évolution du profit</h3>
              <p>Résultat net mensuel</p>
            </div>
            <span
              className={`ac-dash-net-pill ${netPeriod > 0 ? 'is-pos' : netPeriod < 0 ? 'is-neg' : ''}`}
              title={fmt(netPeriod, cur)}
            >
              {netPeriod > 0 ? '+' : ''}{formatCompactNum(netPeriod, cur, 1_000_000)}
            </span>
          </div>
          <AreaChart
            series={filteredSeries}
            keys={[{ key: 'profit', label: 'Profit', color: 'var(--ac-chart-sky, #0ea5e9)' }]}
            height={270}
            unit={cur}
            allowNegative
            emptyLabel="Aucun résultat enregistré"
          />
        </div>
      </div>

      <div className="ac-metric-grid ac-dash-fin-kpis">
        <div className="ac-metric">
          <div className="as-label">
            <svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M2 10h20" /></svg>
            Solde actuel
          </div>
          <div className="as-value" style={{ fontSize: '1.35rem' }}>
            {fmt(currentBalance, cur)}
          <MetricTrend k="balance" /></div>
          <div className="as-hint">caisse &amp; banque</div>
          <MetricSpark k="balance" unit="money" currency={cur} />
        </div>
        <div className="ac-metric">
          <div className="as-label">
            <svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
            Créances
          </div>
          <div className="as-value" style={{ fontSize: '1.35rem' }}>
            {fmt(receivablesTotal, cur)}
          <MetricTrend k="receivables" invert /></div>
          <div className="as-hint">clients</div>
          <MetricSpark k="receivables" invert unit="money" currency={cur} />
        </div>
        <div className="ac-metric">
          <div className="as-label">
            <svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z" /><path d="M3 9l2-4h14l2 4" /></svg>
            Dettes
          </div>
          <div className="as-value" style={{ fontSize: '1.35rem' }}>
            {fmt(payablesTotal, cur)}
          <MetricTrend k="payables" invert /></div>
          <div className="as-hint">fournisseurs</div>
          <MetricSpark k="payables" invert unit="money" currency={cur} />
        </div>
        <div className="ac-metric">
          <div className="as-label">
            <svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-6" /></svg>
            Profit période
          </div>
          <div className="as-value" style={{ fontSize: '1.35rem' }}>
            {fmt(netPeriod, cur)}
          <MetricTrend k="net_flow" /></div>
          <div className="as-hint">selon filtre dates</div>
          <MetricSpark k="net_flow" unit="money" currency={cur} />
        </div>
      </div>

      <div className="ac-dash-charts-grid has-four">
        <div className="ac-panel">
          <div className="ac-panel-head">
            <div>
              <h3>Ventes FA vs VR / vente rapide</h3>
              <p>Chiffre d’affaires factures vs tickets / VR</p>
            </div>
          </div>
          <BarChart
            series={filteredSeries}
            keys={[
              { key: 'invoices_fa', color: 'var(--ac-chart-blue, #2563eb)', label: 'Factures (FA)' },
              { key: 'sales_vr', color: 'var(--ac-chart-sky, #0ea5e9)', label: 'VR / Quick sale' },
            ]}
            height={215}
            unit={cur}
          />
        </div>

        <div className="ac-panel">
          <div className="ac-panel-head">
            <div>
              <h3>Achats fournisseurs &amp; salaires</h3>
              <p>Factures d’achat et masse salariale</p>
            </div>
          </div>
          <BarChart
            series={filteredSeries}
            keys={[
              { key: 'bills', color: 'var(--ac-chart-amber, #d97706)', label: 'Achats (bills)' },
              { key: 'salaries', color: 'var(--ac-chart-zinc, #71717a)', label: 'Salaires' },
            ]}
            height={215}
            unit={cur}
          />
        </div>

        <div className="ac-panel">
          <div className="ac-panel-head">
            <div>
              <h3>Encaissements &amp; nouveaux clients</h3>
              <p>Recettes encaissées et acquisition mensuelle</p>
            </div>
          </div>
          <BarChart
            series={filteredSeries}
            keys={[{ key: 'receipts', color: 'var(--ac-chart-green, #10b981)', label: 'Encaissements' }]}
            secondaryLineKey={{ key: 'clients_new', color: 'var(--ac-chart-ink, #0f172a)', label: 'Nouveaux clients' }}
            height={215}
            unit={cur}
            secondaryUnit="clients"
          />
        </div>

        <div className="ac-panel ac-dash-charges-panel">
          <div className="ac-panel-head">
            <div>
              <h3>Répartition des charges</h3>
              <p>Top catégories de dépenses (hors achats)</p>
            </div>
            <Link to="/balance" className="ac-dash-link">
              Voir la balance
              <ArrowRight className="ac-dash-link-arrow" size={14} strokeWidth={2.25} aria-hidden="true" />
            </Link>
          </div>
          <HBarChart
            color="var(--ac-chart-amber, #d97706)"
            items={expenseCategories}
            unit={cur}
            placeholder={['Salaires', 'Loyer', 'Transport', 'Électricité', 'Autre']}
          />
        </div>
      </div>

      <div className="atlas-donut-wrap">
        <div className="atlas-donut-card">
          <h4>Créances clients</h4>
          <p className="dd-sub">Crédit ouvert vs en retard</p>
          <DonutChart
            segments={[
              { value: Number(data?.unpaidSales?.open ?? 0), color: 'var(--ac-chart-blue-bright, #3b82f6)', label: 'Ouvert' },
              { value: Number(data?.unpaidSales?.overdue ?? 0), color: 'var(--ac-chart-red, #ef4444)', label: 'En retard' },
            ]}
            centerLabel={cur}
            centerValue={formatCompactNum(Number(data?.unpaidSales?.total ?? receivablesTotal), '', 10_000)}
            unit={cur}
          />
        </div>
        <div className="atlas-donut-card">
          <h4>Dettes fournisseurs</h4>
          <p className="dd-sub">À payer</p>
          <DonutChart
            segments={[
              { value: Number(data?.unpaidPurchases?.open ?? 0), color: 'var(--ac-chart-amber-bright, #f59e0b)', label: 'Ouvert' },
              { value: Number(data?.unpaidPurchases?.overdue ?? 0), color: 'var(--ac-chart-red, #ef4444)', label: 'En retard' },
            ]}
            centerLabel={cur}
            centerValue={formatCompactNum(Number(data?.unpaidPurchases?.total ?? payablesTotal), '', 10_000)}
            unit={cur}
          />
        </div>
        <div className="atlas-donut-card">
          <h4>Santé stock</h4>
          <p className="dd-sub">OK vs sous seuil</p>
          <DonutChart
            segments={[
              { value: Math.max(0, productCount - lowCount), color: 'var(--ac-chart-green, #10b981)', label: 'OK' },
              { value: lowCount, color: 'var(--ac-chart-amber-bright, #f59e0b)', label: 'Bas' },
            ]}
            centerLabel="articles"
            centerValue={formatCompactNum(productCount, '', 10_000)}
          />
        </div>
        <div className="atlas-donut-card">
          <h4>Répartition charges</h4>
          <p className="dd-sub">Top catégories</p>
          <DonutChart
            segments={(expenseCategories.length
              ? expenseCategories
              : [{ label: 'Salaires', value: 0 }, { label: 'Loyer', value: 0 }]
            ).slice(0, 5).map((c: { label: string; value: number }, i: number) => ({
              value: c.value,
              color: ['var(--ac-chart-blue, #2563eb)', 'var(--ac-chart-sky, #0ea5e9)', 'var(--ac-chart-amber-bright, #f59e0b)', 'var(--ac-chart-red, #ef4444)', 'var(--ac-chart-slate, #64748b)'][i % 5],
              label: c.label,
            }))}
            centerLabel="charges"
            centerValue={formatCompactNum(
              expenseCategories.reduce((a: number, c: { value: number }) => a + c.value, 0),
              '',
              10_000,
            )}
            unit={cur}
          />
        </div>
      </div>

      {attEnabled && (
        <div className="ac-panel ac-presence-panel" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: 15, flex: '1 1 auto' }}>Présence</h3>
            <Select
              value={attEmpId}
              onChange={(e) => setAttEmpId(e.target.value)}
              className="dash-range-select"
              style={{ minWidth: 160 }}
              aria-label="Employé"
            >
              <option value="">Tous les employés</option>
              {attEmployees.map((e) => (
                <option key={e.id} value={String(e.id)}>{e.name}</option>
              ))}
            </Select>
            <Select
              value={attDays}
              onChange={(e) => setAttDays(Number(e.target.value))}
              className="dash-range-select"
              style={{ minWidth: 110 }}
              aria-label="Période"
            >
              <option value={7}>7 jours</option>
              <option value={14}>14 jours</option>
              <option value={30}>30 jours</option>
            </Select>
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
      )}

      <div className="atlas-split">
        <div className="ac-panel">
          <div className="ac-panel-head">
            <div>
              <h3>
                <svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 5h12M9 12h12M9 19h12M5 5v.01M5 12v.01M5 19v.01" /></svg>
                Prochaines actions
              </h3>
              <p>Traitez les envois du terrain.</p>
            </div>
            <Link to="/actions" className="ac-dash-link">
              Voir la boîte
              <ArrowRight className="ac-dash-link-arrow" size={14} strokeWidth={2.25} aria-hidden="true" />
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
              <h3>
                <svg className="as-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8" /></svg>
                Santé du stock
              </h3>
              <p>Articles sous le minimum rayon.</p>
            </div>
            <Link to="/products" className="ac-dash-link">
              Voir le catalogue
              <ArrowRight className="ac-dash-link-arrow" size={14} strokeWidth={2.25} aria-hidden="true" />
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
                <ProductArtwork url={p.image_url} largeImageProductId={p.image_inline_large ? p.id : undefined} alt="" className="ari-av ac-dash-art" />
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
