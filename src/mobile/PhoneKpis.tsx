import { useMemo } from 'react';
import { MetricSpark, MetricTrend } from '../components/MetricSpark';
import { isEmptySeries, useMetricSeries } from '../lib/metricSeries';

/**
 * Phone KPI strip — swipeable cards (label · value · trend chip · sparkline).
 * Reads the one shared `/api/metrics/daily` series (module cache), so adding it
 * to several phone pages costs no extra request and no extra D1 reads. Keys the
 * signed-in role may not read are absent from the payload and simply skipped.
 */
export interface PhoneKpi {
  k: string;
  label: string;
  unit?: 'count' | 'money';
  /** Rising is bad (stock bas, absences, créances…). */
  invert?: boolean;
}

const countFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/** Flow metrics show the current period total; level metrics their latest value. */
export function kpiValue(values: (number | null)[] | undefined, kind: 'flow' | 'level', days: number): number | null {
  if (!values || !values.length) return null;
  if (kind === 'flow') {
    const cur = values.slice(-Math.max(1, days));
    return cur.reduce<number>((a, v) => a + (v ?? 0), 0);
  }
  for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return values[i];
  return null;
}

export function PhoneKpiStrip({ items, currency = 'MAD', label = 'Indicateurs' }: { items: PhoneKpi[]; currency?: string; label?: string }) {
  const { data, loading } = useMetricSeries();
  const visible = useMemo(() => (data ? items.filter((it) => Array.isArray(data.series[it.k])) : items), [data, items]);
  if (data && !visible.length) return null;
  return (
    <section className="ph-kpis" aria-label={label} aria-busy={loading && !data}>
      {visible.map((it) => {
        const kind = data?.kinds[it.k] || 'flow';
        const values = data?.series[it.k];
        const v = data ? kpiValue(values, kind, data.days) : null;
        const empty = !values || isEmptySeries(values, kind);
        const shown = v === null || (empty && kind === 'level')
          ? '—'
          : it.unit === 'money' ? `${countFmt.format(v)} ${currency}` : countFmt.format(v);
        return (
          <div className={`ph-kpi${it.invert ? ' is-invert' : ''}`} key={it.k} data-phone-kpi={it.k}>
            <span className="ph-kpi-label">
              {it.label}
              {kind === 'flow' && data ? <small> · {data.days} j</small> : null}
            </span>
            <strong className="ph-kpi-value">
              <span>{data ? shown : '…'}</span>
              <MetricTrend k={it.k} invert={it.invert} />
            </strong>
            <MetricSpark k={it.k} invert={it.invert} unit={it.unit || 'count'} currency={currency} />
          </div>
        );
      })}
    </section>
  );
}

export const HOME_KPIS: PhoneKpi[] = [
  { k: 'sales', label: 'Ventes', unit: 'money' },
  { k: 'money_in', label: 'Encaissements', unit: 'money' },
  { k: 'stock_moves', label: 'Mouvements de stock' },
  { k: 'low_stock', label: 'Stock bas', invert: true },
  { k: 'pending_actions', label: 'Demandes en attente', invert: true },
];
export const EMPLOYEE_KPIS: PhoneKpi[] = [
  { k: 'employees_active', label: 'Employés actifs' },
  { k: 'att_present', label: 'Présences' },
  { k: 'att_absent', label: 'Absences', invert: true },
];
export const CLIENT_KPIS: PhoneKpi[] = [
  { k: 'clients_total', label: 'Clients' },
  { k: 'clients_new', label: 'Nouveaux clients' },
  { k: 'receivables', label: 'Créances', unit: 'money', invert: true },
  { k: 'receipts', label: 'Encaissé', unit: 'money' },
];
export const SCAN_KPIS: PhoneKpi[] = [
  { k: 'stock_moves', label: 'Mouvements' },
  { k: 'actions_new', label: 'Envois au PC' },
  { k: 'low_stock', label: 'Stock bas', invert: true },
  { k: 'products', label: 'Produits actifs' },
];
