import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarCheck,
  ClipboardCopy,
  FileText,
  Layers,
  Lock,
  PackageCheck,
  Receipt,
} from 'lucide-react';
import { DateRangePicker } from '../components/DatePicker';
import TopPageActions from '../components/TopPageActions';
import PageSkeleton from '../components/PageSkeleton';
import { openReport } from '../lib/reports';
import { api } from '../api';
import { useUi } from '../components/AppDialogs';
import { friendlyError } from '../lib/errors';
import { downloadExport } from '../lib/export';
import { RunActionButton, EXPORT_REPORT_STEPS } from '../components/ui';
import { draftReorderMessage, demandHint } from '../lib/assist';
import { canAccessCompanySettings, getRole } from '../auth';
import RefreshIconButton from '../components/RefreshIconButton';

const fmt = (n: number) => Math.round(Number(n || 0)).toLocaleString('fr-FR');

function toLocalYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function presetRange(preset: string): { from: string; to: string } {
  const to = new Date();
  to.setHours(12, 0, 0, 0);
  let from = new Date(to);
  if (preset === '7d') from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - 6);
  else if (preset === '1m') from = new Date(to.getFullYear(), to.getMonth(), 1);
  else if (preset === '6m') from = new Date(to.getFullYear(), to.getMonth() - 5, 1);
  else if (preset === '12m' || preset === '1y') from = new Date(to.getFullYear(), to.getMonth() - 11, 1);
  else if (preset === '24m' || preset === '2y') from = new Date(to.getFullYear(), to.getMonth() - 23, 1);
  else if (preset === 'ytd' || preset === 'year') from = new Date(to.getFullYear(), 0, 1);
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

export default function Reports() {
  const { toast, alert } = useUi();
  const [loading, setLoading] = useState(false);
  const [aging, setAging] = useState<any>(null);
  const [tva, setTva] = useState<any>(null);
  const [reorder, setReorder] = useState<any[]>([]);
  const [cogs, setCogs] = useState<any>(null);
  const [period, setPeriod] = useState('');
  const [rangePreset, setRangePreset] = useState<string>('custom');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const isOwner = getRole() === 'owner' || canAccessCompanySettings();

  const openHtmlReport = (path: string) => {
    const [p, qs] = path.split('?');
    const params: Record<string, string> = {};
    if (qs) {
      for (const part of qs.split('&')) {
        const [k, v] = part.split('=');
        if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || '');
      }
    }
    openReport(p, Object.keys(params).length ? params : undefined);
  };

  const loadAll = useCallback(async (rangeFrom = from, rangeTo = to) => {
    setLoading(true);
    try {
      const [agingRes, tvaRes, reorderRes, cogsRes, periodRes] = await Promise.allSettled([
        api.getAgingReport(),
        api.getTvaReport(rangeFrom || undefined, rangeTo || undefined),
        api.getReorderList(),
        api.getCogsReport(rangeFrom || undefined, rangeTo || undefined),
        api.getPeriodLock(),
      ]);
      if (agingRes.status === 'fulfilled') {
        const d = (agingRes.value as any)?.data;
        setAging(d && typeof d === 'object' && !Array.isArray(d) ? d : null);
      }
      if (tvaRes.status === 'fulfilled') {
        const d = (tvaRes.value as any)?.data;
        setTva(d && typeof d === 'object' && !Array.isArray(d) ? d : null);
      }
      if (reorderRes.status === 'fulfilled') {
        const d = (reorderRes.value as any)?.data;
        setReorder(Array.isArray(d) ? d : []);
      }
      if (cogsRes.status === 'fulfilled') {
        const d = (cogsRes.value as any)?.data;
        setCogs(d && typeof d === 'object' && !Array.isArray(d) ? d : null);
      }
      if (periodRes.status === 'fulfilled') {
        const d = (periodRes.value as any)?.data;
        setPeriod(d?.fiscal_locked_through || '');
      }
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  const loadTvaAndCogs = async (rangeFrom = from, rangeTo = to) => {
    setLoading(true);
    try {
      const [tvaRes, cogsRes] = await Promise.allSettled([
        api.getTvaReport(rangeFrom || undefined, rangeTo || undefined),
        api.getCogsReport(rangeFrom || undefined, rangeTo || undefined),
      ]);
      if (tvaRes.status === 'fulfilled') {
        const d = (tvaRes.value as any)?.data;
        setTva(d && typeof d === 'object' && !Array.isArray(d) ? d : null);
      }
      if (cogsRes.status === 'fulfilled') {
        const d = (cogsRes.value as any)?.data;
        setCogs(d && typeof d === 'object' && !Array.isArray(d) ? d : null);
      }
    } catch (e: any) {
      toast(friendlyError(e), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll('', '');
  }, []);

  const savePeriod = async (clear = false) => {
    try {
      const r: any = await api.setPeriodLock(clear ? { clear: true } : { fiscal_locked_through: period });
      toast(r.message || 'Période enregistrée', 'success');
      const pRes = await api.getPeriodLock();
      setPeriod((pRes as any)?.data?.fiscal_locked_through || '');
    } catch (e: any) {
      toast(friendlyError(e), 'error');
    }
  };

  const totalAging = useMemo(() => {
    const b = aging?.buckets || {};
    return (
      Number(b.current || 0) +
      Number(b.d1_30 || 0) +
      Number(b.d31_60 || 0) +
      Number(b.d61_90 || 0) +
      Number(b.d90_plus || 0)
    );
  }, [aging]);

  if (loading && !aging && !tva && !cogs && !reorder.length) {
    return (
      <div className="atlas-page ac-dash reports-page">
        <div className="page-header dock-page-header">
          <h1 className="sr-only">Rapports &amp; clôture</h1>
        </div>
        <PageSkeleton variant="dashboard" />
      </div>
    );
  }

  return (
    <div className="atlas-page ac-dash reports-page">
      <div className="page-header dock-page-header">
        <h1 className="sr-only">Rapports &amp; clôture</h1>
        <TopPageActions>
          <RefreshIconButton onClick={() => void loadAll()} loading={loading} />
          <button
            type="button"
            className="secondary"
            title="Balance âgée PDF"
            onClick={() => openHtmlReport('/api/reports/aging.html')}
          >
            <FileText size={16} aria-hidden="true" />
            <span className="tpa-label">Balance âgée</span>
          </button>
          <button
            type="button"
            className="secondary"
            title="Employés & paie"
            onClick={() => openHtmlReport('/api/reports/employees')}
          >
            <Layers size={16} aria-hidden="true" />
            <span className="tpa-label">Paie PDF</span>
          </button>
          <button
            type="button"
            title="Pack rapports"
            onClick={() => openHtmlReport('/api/reports/combined')}
          >
            <PackageCheck size={16} aria-hidden="true" />
            <span className="tpa-label">Pack rapports</span>
          </button>
        </TopPageActions>
      </div>

      {/* Bento Hero */}
      <header className="ac-dash-hero">
        <div className="ac-dash-hero-text">
          <p className="ac-dash-eyebrow">
            <span>Finance &amp; conformité</span>
          </p>
          <h2>Rapports &amp; clôture</h2>
          <p className="ac-dash-lead">
            Balance âgée, récapitulatif TVA, coût des ventes COGS / FIFO, réassort fournisseur et clôture fiscale sur une même vue.
          </p>
        </div>
        <div className="ac-dash-hero-side">
          <div className="ac-dash-range">
            <div className="ac-dash-presets" role="group" aria-label="Périodes rapides">
              {PRESET_OPTIONS.map(([key, short, title]) => (
                <button
                  key={key}
                  type="button"
                  title={title}
                  className={`ac-dash-preset${rangePreset === key ? ' is-active' : ''}`}
                  disabled={loading}
                  onClick={() => {
                    const r = presetRange(key);
                    setRangePreset(key);
                    setFrom(r.from);
                    setTo(r.to);
                    void loadTvaAndCogs(r.from, r.to);
                  }}
                >
                  {short}
                </button>
              ))}
            </div>
            <DateRangePicker
              size="sm"
              from={from}
              to={to}
              showPresets
              disabled={loading}
              onChange={(nextFrom, nextTo) => {
                setRangePreset('custom');
                setFrom(nextFrom);
                setTo(nextTo);
                void loadTvaAndCogs(nextFrom, nextTo);
              }}
            />
          </div>
        </div>
      </header>

      {/* Bento 4-Metric Row */}
      <section className="ac-metric-grid" aria-label="Indicateurs financiers">
        <article className="ac-metric">
          <span className="ac-metric-label">Créances ouvertes</span>
          <strong className="ac-metric-val">{fmt(totalAging)} MAD</strong>
          <span className="ac-metric-meta">{(aging?.rows || []).length} facture(s) en attente</span>
        </article>
        <article className="ac-metric">
          <span className="ac-metric-label">TVA nette</span>
          <strong className="ac-metric-val">{fmt(Number(tva?.net_tva || 0))} MAD</strong>
          <span className="ac-metric-meta">Collectée {fmt(Number(tva?.total_sales_tva || 0))} · Avoirs {fmt(Number(tva?.total_credits_tva || 0))}</span>
        </article>
        <article className="ac-metric">
          <span className="ac-metric-label">COGS période</span>
          <strong className="ac-metric-val">{fmt(Number(cogs?.total_cogs || 0))} MAD</strong>
          <span className="ac-metric-meta">Méthode : {cogs?.method || 'FIFO / CUMP'}</span>
        </article>
        <article className="ac-metric">
          <span className="ac-metric-label">À réapprovisionner</span>
          <strong className="ac-metric-val">{reorder.length} article(s)</strong>
          <span className="ac-metric-meta">{period ? `Clôturé jusqu’à ${period}` : 'Période ouverte'}</span>
        </article>
      </section>

      {/* Section 1: Balance âgée (full-width Bento panel) */}
      <section className="ac-panel" style={{ marginBottom: 14 }}>
        <div className="ac-panel-head">
          <div>
            <h2>Balance âgée — créances clients{aging?.as_of ? ` au ${aging.as_of}` : ''}</h2>
            <span className="ac-panel-sub">Répartition des impayés par ancienneté d’échéance</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="secondary" onClick={() => openHtmlReport('/api/reports/aging.html')}>
              Imprimer / PDF
            </button>
            <RunActionButton
              size="sm"
              idleLabel="Excel / CSV"
              doneLabel="Téléchargé"
              steps={EXPORT_REPORT_STEPS}
              onRun={async () => {
                await downloadExport('/api/reports/aging.csv', `balance-agee-${aging?.as_of || 'export'}.csv`);
              }}
            />
          </div>
        </div>

        <div className="ac-bento-buckets">
          {[
            ['Courant', aging?.buckets?.current],
            ['1–30 j', aging?.buckets?.d1_30],
            ['31–60 j', aging?.buckets?.d31_60],
            ['61–90 j', aging?.buckets?.d61_90],
            ['90+ j', aging?.buckets?.d90_plus],
          ].map(([lab, val]) => (
            <div key={String(lab)} className="ac-bento-bucket">
              <span>{lab}</span>
              <strong>{fmt(Number(val))} MAD</strong>
            </div>
          ))}
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>N°</th>
                <th>Client</th>
                <th>Échéance</th>
                <th>Jours</th>
                <th style={{ textAlign: 'right' }}>Reste</th>
                <th>Tranche</th>
              </tr>
            </thead>
            <tbody>
              {(aging?.rows || []).map((r: any) => (
                <tr key={r.id}>
                  <td>{r.number}</td>
                  <td>{r.client_name}</td>
                  <td>{r.due_date || r.issue_date}</td>
                  <td>{r.days_overdue}</td>
                  <td style={{ fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {fmt(r.remaining)} MAD
                  </td>
                  <td>{r.bucket}</td>
                </tr>
              ))}
              {!(aging?.rows || []).length && (
                <tr>
                  <td colSpan={6} style={{ color: 'var(--muted)' }}>
                    Aucune créance ouverte.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Sections 2–5: TVA + Réassort (left column) & COGS + Clôture fiscale (right column) */}
      <div className="ac-bento-grid-2">
        <div className="ac-bento-stack">
        <section className="ac-panel">
          <div className="ac-panel-head">
            <div>
              <h2>Récapitulatif TVA</h2>
              <span className="ac-panel-sub">
                Collectée : {fmt(tva?.total_sales_tva ?? 0)} · Avoirs : {fmt(tva?.total_credits_tva ?? 0)} · Net : {fmt(tva?.net_tva ?? 0)} MAD
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  const q = new URLSearchParams();
                  if (from) q.set('from', from);
                  if (to) q.set('to', to);
                  const s = q.toString();
                  openHtmlReport(`/api/reports/tva.html${s ? `?${s}` : ''}`);
                }}
              >
                Imprimer / PDF
              </button>
              <RunActionButton
                size="sm"
                idleLabel="CSV"
                doneLabel="Téléchargé"
                steps={EXPORT_REPORT_STEPS}
                onRun={async () => {
                  const q = new URLSearchParams();
                  if (from) q.set('from', from);
                  if (to) q.set('to', to);
                  const s = q.toString();
                  await downloadExport(`/api/reports/tva.csv${s ? `?${s}` : ''}`, `tva-${from || 'debut'}_${to || 'fin'}.csv`);
                }}
              />
            </div>
          </div>

          <div className="ac-bento-stack">
            <div>
              <h3 style={{ fontSize: 13.5, margin: '0 0 8px' }}>Ventes</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Taux</th><th>Base HT</th><th>TVA</th></tr>
                  </thead>
                  <tbody>
                    {(tva?.sales || []).map((r: any) => (
                      <tr key={`s-${r.tax_rate}`}>
                        <td>{r.tax_rate} %</td>
                        <td>{fmt(r.base_ht)}</td>
                        <td>{fmt(r.tva)}</td>
                      </tr>
                    ))}
                    {!(tva?.sales || []).length && (
                      <tr><td colSpan={3} style={{ color: 'var(--muted)' }}>Aucune vente.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <h3 style={{ fontSize: 13.5, margin: '0 0 8px' }}>Avoirs WR (à déduire)</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Taux</th><th>Base HT</th><th>TVA</th></tr>
                  </thead>
                  <tbody>
                    {(tva?.credits || []).map((r: any) => (
                      <tr key={`c-${r.tax_rate}`}>
                        <td>{r.tax_rate} %</td>
                        <td>{fmt(r.base_ht)}</td>
                        <td>{fmt(r.tva)}</td>
                      </tr>
                    ))}
                    {!(tva?.credits || []).length && (
                      <tr><td colSpan={3} style={{ color: 'var(--muted)' }}>Aucun avoir.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <section className="ac-panel">
          <div className="ac-panel-head">
            <div>
              <h2>À réapprovisionner</h2>
              <span className="ac-panel-sub">
                Génère un brouillon d&apos;achat avec les quantités suggérées (2× seuil − stock).
              </span>
            </div>
            <button
              type="button"
              disabled={!reorder.length || loading}
              onClick={async () => {
                try {
                  setLoading(true);
                  const r: any = await api.createReorderBill({
                    product_ids: reorder.map((p: any) => p.id),
                  });
                  toast(r.message || "Brouillon d'achat créé", 'success');
                  const next = await api.getReorderList();
                  setReorder(Array.isArray((next as any)?.data) ? (next as any).data : []);
                } catch (e: any) {
                  toast(friendlyError(e), 'error');
                } finally {
                  setLoading(false);
                }
              }}
            >
              Créer brouillon d&apos;achat
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>SKU</th><th>Produit</th><th>Stock</th><th>Seuil</th><th>Suggéré</th>
                </tr>
              </thead>
              <tbody>
                {reorder.map((p: any) => (
                  <tr key={p.id}>
                    <td>{p.sku || '—'}</td>
                    <td>{p.name}</td>
                    <td style={{ fontWeight: 700, color: 'var(--bad, #dc2626)' }}>{p.stock_quantity}</td>
                    <td>{p.low_stock_threshold}</td>
                    <td>{p.qty_to_order}</td>
                  </tr>
                ))}
                {!reorder.length && (
                  <tr><td colSpan={5} style={{ color: 'var(--muted)' }}>Aucun produit sous le seuil.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="ac-reports-assist-box">
            <div className="ac-reports-assist-head">
              <strong>Assistant réassort</strong>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  const text = draftReorderMessage(reorder || []);
                  void navigator.clipboard?.writeText(text).then(
                    () => toast('Message fournisseur copié dans le presse-papiers', 'success'),
                    () => { void alert(text, 'Message'); },
                  );
                }}
              >
                <ClipboardCopy size={14} aria-hidden="true" />
                Copier le message fournisseur
              </button>
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: '6px 0 0' }}>
              {demandHint((reorder || []).slice(0, 6).map(() => 1))} — indication basée sur la liste de réassort.
            </p>
          </div>
        </section>
        </div>

        <div className="ac-bento-stack">
        <section className="ac-panel">
          <div className="ac-panel-head">
            <div>
              <h2>Coût des ventes (COGS) &amp; couches FIFO</h2>
              <span className="ac-panel-sub">
                Méthode active : <strong>{cogs?.method || '…'}</strong>
                {cogs?.method === 'fifo'
                  ? ` · Couches restantes : ${fmt(cogs.fifo_layers_qty)} u. / ${fmt(cogs.fifo_layers_value)} MAD`
                  : ''}
              </span>
            </div>
            <span className="ac-status-pill">
              <Receipt size={13} strokeWidth={2} aria-hidden="true" />
              {fmt(cogs?.total_cogs ?? 0)} MAD
            </span>
          </div>
          {cogs?.note && (
            <p className="muted" style={{ fontSize: 12.5, marginTop: 0, marginBottom: 12 }}>{cogs.note}</p>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Produit</th><th>Qté vendue</th><th>Coût u.</th><th>COGS</th></tr>
              </thead>
              <tbody>
                {(cogs?.lines || []).map((l: any) => (
                  <tr key={l.product_id}>
                    <td>{l.name}</td>
                    <td>{l.qty_sold}</td>
                    <td>{fmt(l.unit_cost)}</td>
                    <td style={{ fontWeight: 700 }}>{fmt(l.cogs)}</td>
                  </tr>
                ))}
                {!(cogs?.lines || []).length && (
                  <tr><td colSpan={4} style={{ color: 'var(--muted)' }}>Aucun mouvement de vente sur la période.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="ac-panel">
          <div className="ac-panel-head">
            <div>
              <h2>Clôture de période fiscale</h2>
              <span className="ac-panel-sub">
                Bloque la création de factures datées jusqu’au mois inclus (YYYY-MM).
              </span>
            </div>
            <span className={`ac-status-pill ${period ? 'is-ok' : ''}`}>
              <Lock size={13} strokeWidth={2} aria-hidden="true" />
              {period || 'Ouverte'}
            </span>
          </div>

          <div className="ac-reports-checklist">
            <strong>Checklist avant clôture</strong>
            <ol>
              <li>Tous les paiements clients du mois sont saisis (partiels inclus)</li>
              <li>Factures d’achat reçues + stock réceptionné</li>
              <li>Règlements fournisseurs (paiements partiels OK)</li>
              <li>Rapport TVA + balance âgée exportés (PDF)</li>
              <li>Pack mensuel JSON/CSV téléchargé (Paramètres → Admin)</li>
              <li>Aucun stock négatif (Intégrité E2E)</li>
            </ol>
          </div>

          <div className="form-row">
            <label>Clôturé jusqu’à (YYYY-MM)</label>
            <input
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              placeholder="2026-06"
              disabled={!isOwner}
            />
          </div>
          {isOwner ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => void savePeriod(false)}>
                <CalendarCheck size={14} aria-hidden="true" />
                Enregistrer
              </button>
              <button type="button" className="secondary" onClick={() => void savePeriod(true)}>
                <AlertTriangle size={14} aria-hidden="true" />
                Rouvrir tout
              </button>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>Lecture seule — contactez le propriétaire.</p>
          )}
        </section>
        </div>
      </div>
    </div>
  );
}
