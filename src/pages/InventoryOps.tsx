import { useEffect, useState } from 'react';
import { api } from '../api';
import { useUi } from '../components/AppDialogs';
import { friendlyError } from '../lib/errors';
import NumberField from '../components/NumberField';

const fmt = (n: number) =>
  Math.round(Number(n || 0)).toLocaleString('fr-FR');

type Tab = 'locations' | 'transfer' | 'cycle' | 'report' | 'valuation' | 'auto';

export default function InventoryOps() {
  const { toast, confirm, prompt } = useUi();
  const [tab, setTab] = useState<Tab>('report');
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
  const [autoRules, setAutoRules] = useState<any[]>([]);
  const [newRule, setNewRule] = useState({
    name: 'Réappro magasin',
    product_id: 0,
    from_location_id: 0,
    to_location_id: 0,
    threshold: 5,
    transfer_qty: 10,
  });

  const load = async () => {
    try {
      const [loc, pr, val, rules] = await Promise.all([
        api.getStockLocations(),
        api.getProducts({}),
        api.getStockValuation(reportLoc === 'all' ? undefined : reportLoc),
        api.getAutoTransferRules(),
      ]);
      setLocations((loc as any).data || []);
      setProducts(((pr as any).data || []).filter((p: any) => p.track_inventory));
      setValuation((val as any).data);
      setAutoRules((rules as any).data || []);
    } catch (e: any) {
      toast(friendlyError(e), 'error');
    }
  };

  const loadReport = async (loc = reportLoc) => {
    try {
      const r = await api.getStockReport({ location_id: loc });
      setReport((r as any).data);
    } catch (e: any) {
      toast(friendlyError(e), 'error');
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (tab === 'report') loadReport(reportLoc);
    if (tab === 'valuation') {
      api.getStockValuation(reportLoc === 'all' ? undefined : reportLoc)
        .then((r: any) => setValuation(r.data))
        .catch(() => {});
    }
  }, [tab, reportLoc]);

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
      load();
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
      load();
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
      load();
      if (tab === 'report') loadReport();
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
      load();
    } catch (e: any) {
      toast(friendlyError(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="atlas-page">
      <p className="atlas-eyebrow">Stock</p>
      <div className="page-header">
        <div>
          <h1 className="atlas-hello" style={{ fontSize: '1.75rem' }}>Opérations stock</h1>
          <p className="atlas-lead">
            Emplacements réels, stock par entrepôt, totaux par catégorie, transferts.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {(
          [
            ['report', 'Rapport stock'],
            ['locations', 'Emplacements'],
            ['transfer', 'Transfert'],
            ['cycle', 'Inventaire'],
            ['valuation', 'Valorisation'],
            ['auto', 'Transferts auto'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button key={k} type="button" className={tab === k ? '' : 'secondary'} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'report' && (
        <div className="card">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end', marginBottom: 16 }}>
            <div className="form-row" style={{ margin: 0, minWidth: 220 }}>
              <label>Entrepôt / emplacement</label>
              <select value={reportLoc} onChange={(e) => setReportLoc(e.target.value)}>
                <option value="all">Tous les entrepôts (consolidé)</option>
                {locations.map((l) => (
                  <option key={l.id} value={String(l.id)}>
                    {l.name} ({l.code})
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className="secondary" onClick={() => loadReport(reportLoc)}>Actualiser</button>
          </div>

          {report && (
            <>
              <div className="atlas-stat-grid" style={{ marginBottom: 16 }}>
                <div className="atlas-stat paper">
                  <div className="as-label">Unités</div>
                  <div className="as-value" style={{ fontSize: '1.15rem' }}>{fmt(report.totals?.qty)}</div>
                </div>
                <div className="atlas-stat paper">
                  <div className="as-label">Valeur (coût)</div>
                  <div className="as-value" style={{ fontSize: '1.15rem' }}>{fmt(report.totals?.value)} MAD</div>
                </div>
                <div className="atlas-stat paper">
                  <div className="as-label">Lignes</div>
                  <div className="as-value" style={{ fontSize: '1.15rem' }}>{report.totals?.lines ?? 0}</div>
                </div>
              </div>

              {reportLoc === 'all' && (report.by_warehouse || []).length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, marginTop: 8 }}>Par entrepôt</h3>
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
                </>
              )}

              <h3 style={{ fontSize: 14, marginTop: 20 }}>Totaux par catégorie</h3>
              <table>
                <thead>
                  <tr><th>Catégorie</th><th>Réfs</th><th>Qté</th><th>Valeur</th></tr>
                </thead>
                <tbody>
                  {(report.by_category || []).map((c: any) => (
                    <tr key={c.category}>
                      <td>{c.category}</td>
                      <td>{c.products}</td>
                      <td style={{ fontWeight: 700 }}>{fmt(c.qty)}</td>
                      <td>{fmt(c.value)}</td>
                    </tr>
                  ))}
                  {!(report.by_category || []).length && (
                    <tr><td colSpan={4} style={{ color: 'var(--muted)' }}>Aucune donnée — transférez ou vendez pour peupler les emplacements.</td></tr>
                  )}
                </tbody>
              </table>

              {reportLoc === 'all' && (report.category_by_warehouse || []).length > 0 && (
                <>
                  <h3 style={{ fontSize: 14, marginTop: 20 }}>Catégorie × entrepôt</h3>
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
                </>
              )}

              <h3 style={{ fontSize: 14, marginTop: 20 }}>Détail produits</h3>
              <div className="table-wrap" style={{ maxHeight: 420, overflow: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      {reportLoc === 'all' && <th>Entrepôt</th>}
                      <th>SKU</th><th>Produit</th><th>Catégorie</th><th>Qté</th><th>Valeur</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report.lines || []).map((ln: any, i: number) => (
                      <tr key={`${ln.product_id}-${ln.location_id}-${i}`}>
                        {reportLoc === 'all' && <td>{ln.location_name}</td>}
                        <td>{ln.sku || '—'}</td>
                        <td>{ln.product_name}</td>
                        <td>{ln.category}</td>
                        <td style={{ fontWeight: 700 }}>{fmt(ln.quantity)}</td>
                        <td>{fmt(ln.value)}</td>
                      </tr>
                    ))}
                    {!(report.lines || []).length && (
                      <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>Aucun stock placé.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'locations' && (
        <div className="card">
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Emplacements / entrepôts</h2>
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
                      <button type="button" className="secondary" style={{ fontSize: 12, padding: '4px 8px' }} onClick={() => setDefaultLoc(l.id)}>
                        Défaut
                      </button>
                    )}
                    <button type="button" className="secondary" style={{ fontSize: 12, padding: '4px 8px' }} onClick={async () => {
                      const name = await prompt({ title: 'Renommer l\'emplacement', placeholder: 'Nom', defaultValue: l.name });
                      if (!name?.trim()) return;
                      try {
                        await api.updateStockLocation(l.id, { name: name.trim() });
                        toast('Renommé', 'success');
                        load();
                      } catch (e: any) { toast(friendlyError(e), 'error'); }
                    }}>Renommer</button>
                    <button type="button" className="danger" style={{ fontSize: 12, padding: '4px 8px' }} onClick={async () => {
                      const ok = await confirm({
                        title: 'Supprimer l\'emplacement',
                        message: `Supprimer « ${l.name} » ? Le stock doit être à 0 (transférez d'abord).`,
                        danger: true,
                      });
                      if (!ok) return;
                      try {
                        await api.deleteStockLocation(l.id);
                        toast('Emplacement supprimé', 'success');
                        load();
                      } catch (e: any) { toast(friendlyError(e), 'error'); }
                    }}>Suppr.</button>
                  </td>
                </tr>
              ))}
              {!locations.length && (
                <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>Aucun — créez Magasin / Réserve.</td></tr>
              )}
            </tbody>
          </table>
          <div className="grid grid-2" style={{ marginTop: 16, gap: 12 }}>
            <div className="form-row"><label>Code</label>
              <input value={newLoc.code} onChange={(e) => setNewLoc({ ...newLoc, code: e.target.value })} placeholder="MAG2" />
            </div>
            <div className="form-row"><label>Nom</label>
              <input value={newLoc.name} onChange={(e) => setNewLoc({ ...newLoc, name: e.target.value })} placeholder="Dépôt Casablanca" />
            </div>
          </div>
          <button type="button" disabled={busy} onClick={createLoc}>Ajouter un entrepôt</button>
        </div>
      )}

      {tab === 'transfer' && (
        <div className="card" style={{ maxWidth: 520 }}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Transfert inter-emplacements</h2>
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
          <div className="form-row">
            <label>Quantité</label>
            <NumberField min={0.01} step="0.01" value={transfer.quantity} onValueChange={(n) => setTransfer({ ...transfer, quantity: n })} />
          </div>
          <div className="form-row">
            <label>Note</label>
            <input value={transfer.note} onChange={(e) => setTransfer({ ...transfer, note: e.target.value })} />
          </div>
          <button type="button" disabled={busy} onClick={doTransfer}>Transférer</button>
        </div>
      )}

      {tab === 'cycle' && (
        <div className="card" style={{ maxWidth: 520 }}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Inventaire physique (cycle count)</h2>
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
          <div className="form-row">
            <label>Quantité comptée</label>
            <NumberField min={0} step="0.01" value={cycle.counted_qty} onValueChange={(n) => setCycle({ ...cycle, counted_qty: n })} />
          </div>
          <div className="form-row">
            <label>Note</label>
            <input value={cycle.note} onChange={(e) => setCycle({ ...cycle, note: e.target.value })} />
          </div>
          <button type="button" disabled={busy} onClick={doCycle}>Enregistrer le comptage</button>
        </div>
      )}

      {tab === 'valuation' && valuation && (
        <div className="card">
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Valorisation stock (coût moyen)</h2>
          <div className="form-row" style={{ maxWidth: 240 }}>
            <label>Périmètre</label>
            <select value={reportLoc} onChange={(e) => setReportLoc(e.target.value)}>
              <option value="all">Tous les entrepôts</option>
              {locations.map((l) => (
                <option key={l.id} value={String(l.id)}>{l.name}</option>
              ))}
            </select>
          </div>
          <p style={{ fontSize: 14 }}>
            Valeur totale : <strong>{fmt(valuation.total_value)} MAD</strong>
            {' · '}{valuation.lines?.length || 0} références
          </p>
          {(valuation.by_category || []).length > 0 && (
            <>
              <h3 style={{ fontSize: 14 }}>Par catégorie</h3>
              <table>
                <thead><tr><th>Catégorie</th><th>Valeur</th></tr></thead>
                <tbody>
                  {valuation.by_category.map((c: any) => (
                    <tr key={c.category}><td>{c.category}</td><td>{fmt(c.value)}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <table>
            <thead>
              <tr><th>Produit</th><th>Qté</th><th>Coût u.</th><th>Valeur</th></tr>
            </thead>
            <tbody>
              {(valuation.lines || []).map((l: any) => (
                <tr key={l.product_id}>
                  <td>{l.name}</td>
                  <td>{l.qty}</td>
                  <td>{fmt(l.unit_cost)}</td>
                  <td style={{ fontWeight: 700 }}>{fmt(l.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'auto' && (
        <div className="card">
          <h2 style={{ fontSize: 16, marginTop: 0 }}>Transferts automatiques</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.45 }}>
            Quand le stock de l&apos;emplacement destination passe sous le seuil (ex. magasin),
            le système tire automatiquement depuis la source (ex. réserve), après chaque vente.
          </p>
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
                    <button type="button" className="danger" style={{ fontSize: 12, padding: '2px 8px' }}
                      onClick={async () => {
                        try {
                          await api.deleteAutoTransferRule(r.id);
                          toast('Règle supprimée', 'success');
                          load();
                        } catch (e: any) {
                          toast(friendlyError(e), 'error');
                        }
                      }}
                    >Suppr.</button>
                  </td>
                </tr>
              ))}
              {!autoRules.length && (
                <tr><td colSpan={7} style={{ color: 'var(--muted)' }}>Aucune règle — créez Réserve → Magasin ci-dessous.</td></tr>
              )}
            </tbody>
          </table>
          <h3 style={{ fontSize: 14, marginTop: 20 }}>Nouvelle règle</h3>
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
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
            <button type="button" disabled={busy} onClick={async () => {
              setBusy(true);
              try {
                await api.createAutoTransferRule(newRule);
                toast('Règle créée', 'success');
                load();
              } catch (e: any) {
                toast(friendlyError(e), 'error');
              } finally {
                setBusy(false);
              }
            }}>Enregistrer la règle</button>
            <button type="button" className="secondary" disabled={busy} onClick={async () => {
              setBusy(true);
              try {
                const r: any = await api.runAutoTransfers();
                toast(r.message || 'Exécution terminée', 'success');
                load();
              } catch (e: any) {
                toast(friendlyError(e), 'error');
              } finally {
                setBusy(false);
              }
            }}>Exécuter maintenant</button>
          </div>
        </div>
      )}

    </div>
  );
}
