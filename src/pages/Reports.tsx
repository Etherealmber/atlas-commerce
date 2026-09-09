import { useEffect, useState } from 'react';
import { api } from '../api';
import { useUi } from '../components/AppDialogs';
import { friendlyError } from '../lib/errors';
import { downloadExport } from '../lib/export';
import { draftReorderMessage, demandHint } from '../lib/assist';
import { canAccessCompanySettings, getRole } from '../auth';
import RefreshIconButton from '../components/RefreshIconButton';

const fmt = (n: number) =>
  Math.round(Number(n || 0)).toLocaleString('fr-FR');

type Tab = 'aging' | 'tva' | 'reorder' | 'period' | 'cogs';

export default function Reports() {
  const { toast, alert } = useUi();
  const [tab, setTab] = useState<Tab>('aging');
  const [loading, setLoading] = useState(false);
  const [aging, setAging] = useState<any>(null);
  const [tva, setTva] = useState<any>(null);
  const [reorder, setReorder] = useState<any[]>([]);
  const [cogs, setCogs] = useState<any>(null);
  const [period, setPeriod] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const isOwner = getRole() === 'owner' || canAccessCompanySettings();
  const [exporting, setExporting] = useState(false);

  const openHtmlReport = (path: string, label = 'rapport') => {
    void (async () => {
      setExporting(true);
      try {
        const { getToken } = await import('../auth');
        const { getCachedFingerprint } = await import('../fingerprint');
        const { BASE } = await import('../api');
        const token = getToken();
        const fp = await getCachedFingerprint();
        const res = await fetch(`${BASE}${path}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Device-Fingerprint': fp || '',
          },
        });
        if (!res.ok) throw new Error(`Export ${res.status}`);
        const html = await res.text();
        if (!html || html.length < 40) throw new Error('Rapport vide');
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const u = URL.createObjectURL(blob);
        const w = window.open(u, '_blank', 'noopener');
        if (!w) toast('Autorisez les pop-ups pour ouvrir le ' + label, 'error');
        else toast(label.charAt(0).toUpperCase() + label.slice(1) + ' généré', 'success');
        setTimeout(() => URL.revokeObjectURL(u), 120_000);
      } catch (e: any) {
        toast(friendlyError(e), 'error');
      } finally {
        setExporting(false);
      }
    })();
  };

  const loadAging = async () => {
    setLoading(true);
    try {
      const r = await api.getAgingReport();
      setAging(r.data);
    } catch (e: any) {
      toast(friendlyError(e), 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadTva = async () => {
    setLoading(true);
    try {
      const r = await api.getTvaReport(from || undefined, to || undefined);
      setTva(r.data);
    } catch (e: any) {
      toast(friendlyError(e), 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadReorder = async () => {
    setLoading(true);
    try {
      const r = await api.getReorderList();
      setReorder((r as any).data || []);
    } catch (e: any) {
      toast(friendlyError(e), 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadPeriod = async () => {
    try {
      const r = await api.getPeriodLock();
      setPeriod(r.data?.fiscal_locked_through || '');
    } catch {
      /* */
    }
  };

  useEffect(() => {
    if (tab === 'aging') loadAging();
    if (tab === 'tva') loadTva();
    if (tab === 'reorder') loadReorder();
    if (tab === 'cogs') {
      api.getCogsReport(from || undefined, to || undefined).then((r: any) => setCogs(r.data)).catch((e: any) => toast(friendlyError(e), 'error'));
    }
    if (tab === 'period') loadPeriod();
  }, [tab]);

  const savePeriod = async (clear = false) => {
    try {
      const r: any = await api.setPeriodLock(clear ? { clear: true } : { fiscal_locked_through: period });
      toast(r.message || 'Période enregistrée', 'success');
      loadPeriod();
    } catch (e: any) {
      toast(friendlyError(e), 'error');
    }
  };

  return (
    <div className="atlas-page">
      <p className="atlas-eyebrow">Pilotage</p>
      <div className="page-header">
        <div>
          <h1 className="atlas-hello" style={{ fontSize: '1.75rem' }}>Rapports &amp; clôture</h1>
          <p className="atlas-lead">Balance âgée, TVA, réapprovisionnement, période fiscale.</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {(
          [
            ['aging', 'Balance âgée'],
            ['tva', 'TVA'],
            ['cogs', 'COGS / FIFO'],
            ['reorder', 'À commander'],
            ['period', 'Clôture période'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={tab === k ? '' : 'secondary'}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {(loading || exporting) && <p style={{ color: 'var(--muted)' }}>{exporting ? 'Génération du rapport…' : 'Chargement…'}</p>}

      
          <div className="card" style={{ marginTop: 12 }}>
            <h3 style={{ fontSize: 14, marginTop: 0 }}>Assistant réassort</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>
              Génère un message français pour votre fournisseur à partir de la liste.
            </p>
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
              Copier le message fournisseur
            </button>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
              {demandHint((reorder || []).slice(0, 6).map(() => 1))}
              {' '}— indication simple basée sur la liste de réassort (historique détaillé à venir).
            </p>
          </div>
{tab === 'aging' && aging && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <h2 style={{ fontSize: 16, marginTop: 0, marginBottom: 0 }}>Créances clients — au {aging.as_of}</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="secondary" onClick={() => openHtmlReport('/api/reports/aging.html')}>
                Imprimer / PDF
              </button>
              <button type="button" className="secondary" onClick={() => downloadExport('/api/reports/aging.csv', `balance-agee-${aging.as_of || 'export'}.csv`)}>
                Excel / CSV
              </button>
            </div>
          </div>
          <div className="atlas-stat-grid" style={{ marginBottom: 16, marginTop: 12 }}>
            {[
              ['Courant', aging.buckets?.current],
              ['1–30 j', aging.buckets?.d1_30],
              ['31–60 j', aging.buckets?.d31_60],
              ['61–90 j', aging.buckets?.d61_90],
              ['90+ j', aging.buckets?.d90_plus],
            ].map(([lab, val]) => (
              <div key={String(lab)} className="atlas-stat paper">
                <div className="as-label">{lab}</div>
                <div className="as-value" style={{ fontSize: '1.1rem' }}>{fmt(Number(val))} MAD</div>
              </div>
            ))}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>N°</th><th>Client</th><th>Échéance</th><th>Jours</th><th style={{ textAlign: 'right' }}>Reste</th><th>Tranche</th>
                </tr>
              </thead>
              <tbody>
                {(aging.rows || []).map((r: any) => (
                  <tr key={r.id}>
                    <td>{r.number}</td>
                    <td>{r.client_name}</td>
                    <td>{r.due_date || r.issue_date}</td>
                    <td>{r.days_overdue}</td>
                    <td style={{ fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(r.remaining)} MAD</td>
                    <td>{r.bucket}</td>
                  </tr>
                ))}
                {!(aging.rows || []).length && (
                  <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>Aucune créance ouverte.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'tva' && (
        <div className="card">
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Récapitulatif TVA</h2>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14, alignItems: 'end' }}>
            <div className="form-row" style={{ margin: 0 }}>
              <label>Du</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="form-row" style={{ margin: 0 }}>
              <label>Au</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <RefreshIconButton onClick={loadTva} />
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
            <button
              type="button"
              className="secondary"
              onClick={() => {
                const q = new URLSearchParams();
                if (from) q.set('from', from);
                if (to) q.set('to', to);
                const s = q.toString();
                downloadExport(`/api/reports/tva.csv${s ? `?${s}` : ''}`, `tva-${from || 'debut'}_${to || 'fin'}.csv`);
              }}
            >
              Excel / CSV
            </button>
          </div>
          {tva && (
            <>
              <p style={{ fontSize: 14, marginBottom: 12 }}>
                TVA collectée : <strong>{fmt(tva.total_sales_tva ?? 0)}</strong>
                {' · '}TVA sur avoirs WR : <strong>{fmt(tva.total_credits_tva ?? 0)}</strong>
                {' · '}Net : <strong>{fmt(tva.net_tva ?? 0)}</strong>
                {tva.default_tax_rate != null && (
                  <span style={{ color: 'var(--muted)', fontSize: 12 }}> (taux défaut {tva.default_tax_rate}%)</span>
                )}
              </p>
              <h3 style={{ fontSize: 14 }}>Ventes</h3>
              <table>
                <thead><tr><th>Taux</th><th>Base HT</th><th>TVA</th></tr></thead>
                <tbody>
                  {(tva.sales || []).map((r: any) => (
                    <tr key={`s-${r.tax_rate}`}>
                      <td>{r.tax_rate} %</td>
                      <td>{fmt(r.base_ht)}</td>
                      <td>{fmt(r.tva)}</td>
                    </tr>
                  ))}
                  {!(tva.sales || []).length && (
                    <tr><td colSpan={3} style={{ color: 'var(--muted)' }}>Aucune vente.</td></tr>
                  )}
                </tbody>
              </table>
              <h3 style={{ fontSize: 14, marginTop: 16 }}>Avoirs WR (à déduire)</h3>
              <table>
                <thead><tr><th>Taux</th><th>Base HT</th><th>TVA</th></tr></thead>
                <tbody>
                  {(tva.credits || []).map((r: any) => (
                    <tr key={`c-${r.tax_rate}`}>
                      <td>{r.tax_rate} %</td>
                      <td>{fmt(r.base_ht)}</td>
                      <td>{fmt(r.tva)}</td>
                    </tr>
                  ))}
                  {!(tva.credits || []).length && (
                    <tr><td colSpan={3} style={{ color: 'var(--muted)' }}>Aucun avoir.</td></tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {tab === 'reorder' && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <h2 style={{ fontSize: 16, marginTop: 0, marginBottom: 0 }}>À réapprovisionner</h2>
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
                  loadReorder();
                } catch (e: any) {
                  toast(friendlyError(e), 'error');
                } finally {
                  setLoading(false);
                }
              }}
            >
              Créer brouillon d'achat
            </button>
          </div>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>
            Génère une facture d'achat brouillon avec les quantités suggérées (2× seuil − stock).
            Puis allez dans Achats → réception pour entrer le stock.
          </p>
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
                  <td style={{ fontWeight: 700, color: 'var(--bad)' }}>{p.stock_quantity}</td>
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
      )}

      
      {tab === 'cogs' && (
        <div className="card">
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Coût des ventes (COGS) &amp; couches FIFO</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            Méthode active : <strong>{cogs?.method || '…'}</strong>. {cogs?.note}
          </p>
          {cogs && (
            <>
              <p style={{ fontSize: 14 }}>
                COGS période : <strong>{fmt(cogs.total_cogs)}</strong> MAD
                {cogs.method === 'fifo' && (
                  <> · Couches FIFO restantes : {fmt(cogs.fifo_layers_qty)} u. / {fmt(cogs.fifo_layers_value)} MAD</>
                )}
              </p>
              <table>
                <thead>
                  <tr><th>Produit</th><th>Qté vendue</th><th>Coût u.</th><th>COGS</th></tr>
                </thead>
                <tbody>
                  {(cogs.lines || []).map((l: any) => (
                    <tr key={l.product_id}>
                      <td>{l.name}</td>
                      <td>{l.qty_sold}</td>
                      <td>{fmt(l.unit_cost)}</td>
                      <td style={{ fontWeight: 700 }}>{fmt(l.cogs)}</td>
                    </tr>
                  ))}
                  {!(cogs.lines || []).length && (
                    <tr><td colSpan={4} style={{ color: 'var(--muted)' }}>Aucun mouvement de vente sur la période.</td></tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}

      {tab === 'period' && (
        <div className="card" style={{ maxWidth: 560 }}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Clôture de période fiscale</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.45 }}>
            Bloque la création de factures datées jusqu’au mois inclus (format YYYY-MM).
            Réservé au propriétaire.
          </p>
          <div
            style={{
              background: 'var(--stone, #f5f2eb)',
              borderRadius: 8,
              padding: 14,
              marginBottom: 16,
              fontSize: 13,
              lineHeight: 1.55,
            }}
          >
            <strong style={{ display: 'block', marginBottom: 8 }}>Checklist avant clôture</strong>
            <ol style={{ margin: 0, paddingLeft: 18 }}>
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
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => savePeriod(false)}>Enregistrer</button>
              <button type="button" className="secondary" onClick={() => savePeriod(true)}>Rouvrir tout</button>
            </div>
          ) : (
            <p style={{ color: 'var(--muted)', fontSize: 13 }}>Lecture seule — contactez le propriétaire.</p>
          )}
        </div>
      )}
    </div>
  );
}
