import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeftRight,
  Boxes,
  ClipboardCheck,
  Play,
  Sparkles,
  Warehouse,
} from 'lucide-react';
import { api } from '../api';
import { useUi } from '../components/AppDialogs';
import { friendlyError } from '../lib/errors';
import NumberField from '../components/NumberField';
import TopPageActions from '../components/TopPageActions';
import RefreshIconButton from '../components/RefreshIconButton';
import { TimedUndoDelete } from '../components/ui';

const fmt = (n: number) => Math.round(Number(n || 0)).toLocaleString('fr-FR');

export default function InventoryOps() {
  const { toast, confirm, prompt } = useUi();
  const [locations, setLocations] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [valuation, setValuation] = useState<any>(null);
  const [report, setReport] = useState<any>(null);
  const [reportLoc, setReportLoc] = useState<string>('all');
  const [newLoc, setNewLoc] = useState({ code: '', name: '' });
  const [transfer, setTransfer] = useState({
    product_id: 0,
    from_location_id: 0,
    to_location_id: 0,
    quantity: 1,
    note: '',
  });
  const [cycle, setCycle] = useState({ product_id: 0, counted_qty: 0, location_id: 0, note: '' });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [autoRules, setAutoRules] = useState<any[]>([]);
  const [newRule, setNewRule] = useState({
    name: 'Réappro magasin',
    product_id: 0,
    from_location_id: 0,
    to_location_id: 0,
    threshold: 5,
    transfer_qty: 10,
  });

  const loadAll = useCallback(async (loc = reportLoc) => {
    setLoading(true);
    try {
      const locParam = loc === 'all' ? undefined : loc;
      const [locRes, prRes, valRes, repRes, rulesRes] = await Promise.allSettled([
        api.getStockLocations(),
        api.getProducts({}),
        api.getStockValuation(locParam),
        api.getStockReport({ location_id: loc }),
        api.getAutoTransferRules(),
      ]);
      if (locRes.status === 'fulfilled') {
        const d = (locRes.value as any)?.data;
        setLocations(Array.isArray(d) ? d : []);
      }
      if (prRes.status === 'fulfilled') {
        const d = (prRes.value as any)?.data;
        setProducts(Array.isArray(d) ? d.filter((p: any) => p.track_inventory) : []);
      }
      if (valRes.status === 'fulfilled') {
        const d = (valRes.value as any)?.data;
        setValuation(d && typeof d === 'object' && !Array.isArray(d) ? d : null);
      }
      if (repRes.status === 'fulfilled') {
        const d = (repRes.value as any)?.data;
        setReport(d && typeof d === 'object' && !Array.isArray(d) ? d : null);
      }
      if (rulesRes.status === 'fulfilled') {
        const d = (rulesRes.value as any)?.data;
        setAutoRules(Array.isArray(d) ? d : []);
      }
    } finally {
      setLoading(false);
    }
  }, [reportLoc]);

  useEffect(() => {
    void loadAll(reportLoc);
  }, [reportLoc]);

  const createLoc = async () => {
    if (!newLoc.code.trim() || !newLoc.name.trim()) {
      toast('Code et nom obligatoires', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.createStockLocation(newLoc);
      toast('Emplacement créé', 'success');
      setNewLoc({ code: '', name: '' });
      void loadAll(reportLoc);
    } catch (e: any) {
      toast(friendlyError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const setDefaultLoc = async (id: number) => {
    try {
      await api.updateStockLocation(id, { is_default: true });
      toast('Emplacement par défaut mis à jour', 'success');
      void loadAll(reportLoc);
    } catch (e: any) {
      toast(friendlyError(e), 'error');
    }
  };

  const doTransfer = async () => {
    if (!transfer.product_id || !transfer.quantity) {
      toast('Produit et quantité requis', 'error');
      return;
    }
    if (!transfer.to_location_id) {
      toast('Choisissez la destination', 'error');
      return;
    }
    setBusy(true);
    try {
      const r: any = await api.stockTransfer(transfer);
      toast(r.message || 'Transfert enregistré', 'success');
      void loadAll(reportLoc);
    } catch (e: any) {
      toast(friendlyError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const doCycle = async () => {
    if (!cycle.product_id) {
      toast('Choisissez un produit', 'error');
      return;
    }
    const ok = await confirm({
      title: 'Inventaire physique',
      message: `Enregistrer le comptage ${cycle.counted_qty} ? L’écart ajustera le stock.`,
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const r: any = await api.stockCycleCount(cycle);
      toast(r.message || 'Comptage enregistré', 'success');
      void loadAll(reportLoc);
    } catch (e: any) {
      toast(friendlyError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const runAutoNow = async () => {
    setBusy(true);
    try {
      const r: any = await api.runAutoTransfers();
      toast(r.message || 'Exécution terminée', 'success');
      void loadAll(reportLoc);
    } catch (e: any) {
      toast(friendlyError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="atlas-page ac-dash inventory-ops-page">
      <div className="page-header dock-page-header">
        <h1 className="sr-only">Opérations stock</h1>
        <TopPageActions>
          <RefreshIconButton onClick={() => void loadAll(reportLoc)} loading={loading} />
          <button type="button" disabled={busy} onClick={() => void runAutoNow()}>
            <Play size={16} aria-hidden="true" />
            <span className="tpa-label">Exécuter transferts auto</span>
          </button>
        </TopPageActions>
      </div>

      {/* Bento Hero */}
      <header className="ac-dash-hero">
        <div className="ac-dash-hero-text">
          <p className="ac-dash-eyebrow">
            <Sparkles size={13} strokeWidth={2.2} aria-hidden="true" />
            <span>Logistique &amp; entrepôts</span>
          </p>
          <h2>Opérations stock</h2>
          <p className="ac-dash-lead">
            Vue unifiée des entrepôts, transferts inter-sites, inventaire physique, valorisation et règles de réapprovisionnement automatique.
          </p>
        </div>
        <div className="ac-dash-hero-side">
          <div className="form-row" style={{ margin: 0, minWidth: 220 }}>
            <label>Périmètre entrepôt</label>
            <select value={reportLoc} onChange={(e) => setReportLoc(e.target.value)}>
              <option value="all">Tous les entrepôts (consolidé)</option>
              {locations.map((l) => (
                <option key={l.id} value={String(l.id)}>
                  {l.name} ({l.code})
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      {/* Bento 4-Metric Row */}
      <section className="ac-metric-grid" aria-label="Indicateurs stock">
        <article className="ac-metric">
          <span className="ac-metric-label">Unités en stock</span>
          <strong className="ac-metric-val">{fmt(report?.totals?.qty || 0)}</strong>
          <span className="ac-metric-meta">{report?.totals?.lines ?? 0} ligne(s) suivie(s)</span>
        </article>
        <article className="ac-metric">
          <span className="ac-metric-label">Valeur (coût moyen)</span>
          <strong className="ac-metric-val">{fmt(valuation?.total_value ?? report?.totals?.value ?? 0)} MAD</strong>
          <span className="ac-metric-meta">{valuation?.lines?.length ?? products.length} référence(s)</span>
        </article>
        <article className="ac-metric">
          <span className="ac-metric-label">Entrepôts</span>
          <strong className="ac-metric-val">{locations.length}</strong>
          <span className="ac-metric-meta">
            Défaut : {locations.find((l) => l.is_default)?.name || 'Principal'}
          </span>
        </article>
        <article className="ac-metric">
          <span className="ac-metric-label">Transferts auto</span>
          <strong className="ac-metric-val">{autoRules.length} règle(s)</strong>
          <span className="ac-metric-meta">Réassort réserve → magasin</span>
        </article>
      </section>

      {/* Quick Ops: Transfer + Cycle Count (2-column Bento grid) */}
      <div className="ac-bento-grid-2">
        <section className="ac-panel">
          <div className="ac-panel-head">
            <div>
              <h2>Transfert inter-emplacements</h2>
              <span className="ac-panel-sub">Déplacer du stock entre entrepôts sans perte de traçabilité</span>
            </div>
            <span className="ac-status-pill">
              <ArrowLeftRight size={13} strokeWidth={2} aria-hidden="true" />
              Mouvement
            </span>
          </div>
          <div className="form-row">
            <label>Produit</label>
            <select
              value={transfer.product_id || ''}
              onChange={(e) => setTransfer({ ...transfer, product_id: Number(e.target.value) })}
            >
              <option value="">—</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name} (total {p.stock_quantity})</option>
              ))}
            </select>
          </div>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div className="form-row">
              <label>De</label>
              <select
                value={transfer.from_location_id || ''}
                onChange={(e) => setTransfer({ ...transfer, from_location_id: Number(e.target.value) })}
              >
                <option value="0">Emplacement défaut</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div className="form-row">
              <label>Vers</label>
              <select
                value={transfer.to_location_id || ''}
                onChange={(e) => setTransfer({ ...transfer, to_location_id: Number(e.target.value) })}
              >
                <option value="0">—</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div className="form-row">
              <label>Quantité</label>
              <NumberField min={0.01} step="0.01" value={transfer.quantity} onValueChange={(n) => setTransfer({ ...transfer, quantity: n })} />
            </div>
            <div className="form-row">
              <label>Note</label>
              <input value={transfer.note} onChange={(e) => setTransfer({ ...transfer, note: e.target.value })} placeholder="Motif ou bon interne" />
            </div>
          </div>
          <button type="button" disabled={busy} onClick={() => void doTransfer()}>Transférer</button>
        </section>

        <section className="ac-panel">
          <div className="ac-panel-head">
            <div>
              <h2>Inventaire physique (cycle count)</h2>
              <span className="ac-panel-sub">Ajuster le stock théorique à la quantité réellement comptée</span>
            </div>
            <span className="ac-status-pill">
              <ClipboardCheck size={13} strokeWidth={2} aria-hidden="true" />
              Comptage
            </span>
          </div>
          <div className="form-row">
            <label>Produit</label>
            <select
              value={cycle.product_id || ''}
              onChange={(e) => {
                const id = Number(e.target.value);
                const p = products.find((x) => x.id === id);
                setCycle({ ...cycle, product_id: id, counted_qty: Number(p?.stock_quantity || 0) });
              }}
            >
              <option value="">—</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name} (théorique {p.stock_quantity})</option>
              ))}
            </select>
          </div>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div className="form-row">
              <label>Quantité comptée</label>
              <NumberField min={0} step="0.01" value={cycle.counted_qty} onValueChange={(n) => setCycle({ ...cycle, counted_qty: n })} />
            </div>
            <div className="form-row">
              <label>Note</label>
              <input value={cycle.note} onChange={(e) => setCycle({ ...cycle, note: e.target.value })} placeholder="Ex. Contrôle rayon" />
            </div>
          </div>
          <button type="button" disabled={busy} onClick={() => void doCycle()}>Enregistrer le comptage</button>
        </section>
      </div>

      {/* Stock Report (full-width Bento panel) */}
      <section className="ac-panel" style={{ marginBottom: 14 }}>
        <div className="ac-panel-head">
          <div>
            <h2>Rapport stock consolidé</h2>
            <span className="ac-panel-sub">
              {reportLoc === 'all'
                ? 'Répartition par entrepôt, par catégorie et détail par produit'
                : `Filtré sur ${locations.find((l) => String(l.id) === reportLoc)?.name || 'emplacement sélectionné'}`}
            </span>
          </div>
          <span className="ac-status-pill">
            <Boxes size={13} strokeWidth={2} aria-hidden="true" />
            {fmt(report?.totals?.qty || 0)} u.
          </span>
        </div>

        {reportLoc === 'all' && (report?.by_warehouse || []).length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <h3 style={{ fontSize: 13.5, margin: '0 0 8px' }}>Par entrepôt</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Code</th><th>Entrepôt</th><th>SKU</th><th>Qté</th><th>Valeur</th>
                  </tr>
                </thead>
                <tbody>
                  {report.by_warehouse.map((w: any) => (
                    <tr key={w.location_id}>
                      <td>{w.code}</td>
                      <td>
                        <button type="button" className="secondary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => setReportLoc(String(w.location_id))}>
                          {w.name}
                        </button>
                      </td>
                      <td>{w.skus}</td>
                      <td style={{ fontWeight: 700 }}>{fmt(w.qty)}</td>
                      <td>{fmt(w.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="ac-bento-grid-2" style={{ marginBottom: 14 }}>
          <div>
            <h3 style={{ fontSize: 13.5, margin: '0 0 8px' }}>Totaux par catégorie</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Catégorie</th><th>Réfs</th><th>Qté</th><th>Valeur</th></tr>
                </thead>
                <tbody>
                  {(report?.by_category || []).map((c: any) => (
                    <tr key={c.category}>
                      <td>{c.category}</td>
                      <td>{c.products}</td>
                      <td style={{ fontWeight: 700 }}>{fmt(c.qty)}</td>
                      <td>{fmt(c.value)}</td>
                    </tr>
                  ))}
                  {!(report?.by_category || []).length && (
                    <tr><td colSpan={4} style={{ color: 'var(--muted)' }}>Aucune donnée — transférez ou vendez pour peupler les emplacements.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {reportLoc === 'all' && (report?.category_by_warehouse || []).length > 0 ? (
            <div>
              <h3 style={{ fontSize: 13.5, margin: '0 0 8px' }}>Catégorie × entrepôt</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Catégorie</th><th>Entrepôt</th><th>Qté</th><th>Valeur</th></tr>
                  </thead>
                  <tbody>
                    {report.category_by_warehouse.map((r: any, i: number) => (
                      <tr key={`${r.category}-${r.location_id}-${i}`}>
                        <td>{r.category}</td>
                        <td>{r.location_name}</td>
                        <td>{fmt(r.qty)}</td>
                        <td>{fmt(r.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div>
              <h3 style={{ fontSize: 13.5, margin: '0 0 8px' }}>Valorisation par catégorie</h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Catégorie</th><th>Valeur</th></tr></thead>
                  <tbody>
                    {(valuation?.by_category || []).map((c: any) => (
                      <tr key={c.category}><td>{c.category}</td><td>{fmt(c.value)} MAD</td></tr>
                    ))}
                    {!(valuation?.by_category || []).length && (
                      <tr><td colSpan={2} style={{ color: 'var(--muted)' }}>Aucune donnée valorisée.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <h3 style={{ fontSize: 13.5, margin: '0 0 8px' }}>Détail produits</h3>
        <div className="table-wrap" style={{ maxHeight: 380, overflow: 'auto' }}>
          <table>
            <thead>
              <tr>
                {reportLoc === 'all' && <th>Entrepôt</th>}
                <th>SKU</th><th>Produit</th><th>Catégorie</th><th>Qté</th><th>Valeur</th>
              </tr>
            </thead>
            <tbody>
              {(report?.lines || []).map((ln: any, i: number) => (
                <tr key={`${ln.product_id}-${ln.location_id}-${i}`}>
                  {reportLoc === 'all' && <td>{ln.location_name}</td>}
                  <td>{ln.sku || '—'}</td>
                  <td>{ln.product_name}</td>
                  <td>{ln.category}</td>
                  <td style={{ fontWeight: 700 }}>{fmt(ln.quantity)}</td>
                  <td>{fmt(ln.value)}</td>
                </tr>
              ))}
              {!(report?.lines || []).length && (
                <tr><td colSpan={reportLoc === 'all' ? 6 : 5} style={{ color: 'var(--muted)' }}>Aucun stock placé.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Locations & Valuation (2-column Bento grid) */}
      <div className="ac-bento-grid-2">
        <section className="ac-panel">
          <div className="ac-panel-head">
            <div>
              <h2>Emplacements / entrepôts</h2>
              <span className="ac-panel-sub">Gérez vos magasins, réserves et dépôts</span>
            </div>
            <span className="ac-status-pill">
              <Warehouse size={13} strokeWidth={2} aria-hidden="true" />
              {locations.length}
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Code</th><th>Nom</th><th>Unités</th><th>SKU</th><th>Défaut</th><th></th></tr>
              </thead>
              <tbody>
                {locations.map((l) => (
                  <tr key={l.id}>
                    <td>{l.code}</td>
                    <td>{l.name}</td>
                    <td style={{ fontWeight: 700 }}>{fmt(Number(l.total_units || 0))}</td>
                    <td>{l.sku_count ?? '—'}</td>
                    <td>{l.is_default ? 'Oui' : '—'}</td>
                    <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {!l.is_default && (
                        <button type="button" className="secondary" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => void setDefaultLoc(l.id)}>
                          Défaut
                        </button>
                      )}
                      <button type="button" className="secondary" style={{ fontSize: 12, padding: '4px 8px' }} onClick={async () => {
                        const name = await prompt({ title: "Renommer l'emplacement", placeholder: 'Nom', defaultValue: l.name });
                        if (!name?.trim()) return;
                        try {
                          await api.updateStockLocation(l.id, { name: name.trim() });
                          toast('Renommé', 'success');
                          void loadAll(reportLoc);
                        } catch (e: any) { toast(friendlyError(e), 'error'); }
                      }}>Renommer</button>
                      <TimedUndoDelete
                        deleteLabel="Supprimer"
                        undoLabel="Annuler"
                        initialSeconds={10}
                        onConfirm={async () => {
                          try {
                            await api.deleteStockLocation(l.id);
                            toast('Emplacement supprimé', 'success');
                            void loadAll(reportLoc);
                          } catch (e: any) { toast(friendlyError(e), 'error'); }
                        }}
                      />
                    </td>
                  </tr>
                ))}
                {!locations.length && (
                  <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>Aucun — créez Magasin / Réserve.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="grid grid-2" style={{ marginTop: 14, gap: 12 }}>
            <div className="form-row"><label>Code</label>
              <input value={newLoc.code} onChange={(e) => setNewLoc({ ...newLoc, code: e.target.value })} placeholder="MAG2" />
            </div>
            <div className="form-row"><label>Nom</label>
              <input value={newLoc.name} onChange={(e) => setNewLoc({ ...newLoc, name: e.target.value })} placeholder="Dépôt Casablanca" />
            </div>
          </div>
          <button type="button" disabled={busy} onClick={() => void createLoc()}>Ajouter un entrepôt</button>
        </section>

        <section className="ac-panel">
          <div className="ac-panel-head">
            <div>
              <h2>Valorisation stock (coût moyen)</h2>
              <span className="ac-panel-sub">
                Valeur totale : <strong>{fmt(valuation?.total_value || 0)} MAD</strong> · {valuation?.lines?.length || 0} référence(s)
              </span>
            </div>
          </div>
          <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
            <table>
              <thead>
                <tr><th>Produit</th><th>Qté</th><th>Coût u.</th><th>Valeur</th></tr>
              </thead>
              <tbody>
                {(valuation?.lines || []).map((l: any) => (
                  <tr key={l.product_id}>
                    <td>{l.name}</td>
                    <td>{l.qty}</td>
                    <td>{fmt(l.unit_cost)}</td>
                    <td style={{ fontWeight: 700 }}>{fmt(l.value)}</td>
                  </tr>
                ))}
                {!(valuation?.lines || []).length && (
                  <tr><td colSpan={4} style={{ color: 'var(--muted)' }}>Aucune ligne valorisée.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Auto-transfer rules (full-width Bento panel) */}
      <section className="ac-panel">
        <div className="ac-panel-head">
          <div>
            <h2>Transferts automatiques</h2>
            <span className="ac-panel-sub">
              Quand le stock de la destination passe sous le seuil, le système tire depuis la source après chaque vente.
            </span>
          </div>
          <button type="button" className="secondary" disabled={busy} onClick={() => void runAutoNow()}>
            <Play size={14} aria-hidden="true" />
            Exécuter maintenant
          </button>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nom</th><th>Produit</th><th>De</th><th>Vers</th><th>Seuil</th><th>Qté</th><th></th>
              </tr>
            </thead>
            <tbody>
              {autoRules.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td>{r.product_id ? `#${r.product_id}` : 'Tous'}</td>
                  <td>{locations.find((l) => l.id === r.from_location_id)?.name || r.from_location_id}</td>
                  <td>{locations.find((l) => l.id === r.to_location_id)?.name || r.to_location_id}</td>
                  <td>{r.threshold}</td>
                  <td>{r.transfer_qty}</td>
                  <td>
                    <TimedUndoDelete
                      deleteLabel="Supprimer"
                      undoLabel="Annuler"
                      initialSeconds={10}
                      onConfirm={async () => {
                        try {
                          await api.deleteAutoTransferRule(r.id);
                          toast('Règle supprimée', 'success');
                          void loadAll(reportLoc);
                        } catch (e: any) {
                          toast(friendlyError(e), 'error');
                        }
                      }}
                    />
                  </td>
                </tr>
              ))}
              {!autoRules.length && (
                <tr><td colSpan={7} style={{ color: 'var(--muted)' }}>Aucune règle — créez Réserve → Magasin ci-dessous.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <h3 style={{ fontSize: 13.5, margin: '18px 0 10px' }}>Nouvelle règle</h3>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <div className="form-row"><label>Nom</label>
            <input value={newRule.name} onChange={(e) => setNewRule({ ...newRule, name: e.target.value })} />
          </div>
          <div className="form-row"><label>Produit (0 = tous)</label>
            <select value={newRule.product_id || 0} onChange={(e) => setNewRule({ ...newRule, product_id: Number(e.target.value) })}>
              <option value={0}>Tous les produits suivis</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="form-row"><label>Depuis (réserve)</label>
            <select value={newRule.from_location_id || ''} onChange={(e) => setNewRule({ ...newRule, from_location_id: Number(e.target.value) })}>
              <option value={0}>—</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="form-row"><label>Vers (magasin)</label>
            <select value={newRule.to_location_id || ''} onChange={(e) => setNewRule({ ...newRule, to_location_id: Number(e.target.value) })}>
              <option value={0}>—</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div className="form-row"><label>Seuil bas</label>
            <NumberField min={0} value={newRule.threshold} onValueChange={(n) => setNewRule({ ...newRule, threshold: n })} />
          </div>
          <div className="form-row"><label>Qté à transférer</label>
            <NumberField min={0.01} value={newRule.transfer_qty} onValueChange={(n) => setNewRule({ ...newRule, transfer_qty: n })} />
          </div>
        </div>
        <button type="button" disabled={busy} onClick={async () => {
          setBusy(true);
          try {
            await api.createAutoTransferRule(newRule);
            toast('Règle créée', 'success');
            void loadAll(reportLoc);
          } catch (e: any) {
            toast(friendlyError(e), 'error');
          } finally {
            setBusy(false);
          }
        }}>Enregistrer la règle</button>
      </section>
    </div>
  );
}
