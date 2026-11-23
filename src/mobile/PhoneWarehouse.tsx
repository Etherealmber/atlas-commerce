/** Phone warehouse: pick location, cycle-count session, transfer between locations */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { friendlyError } from '../lib/errors';
import { isStockRole } from '../auth';
import {
  cacheLocations,
  countOfflineInventoryOps,
  listCachedLocations,
  listOfflineInventoryOps,
  removeOfflineInventoryOpBySeq,
  isOnline,
  listLowStockOffline,
  type QueuedOfflineInventoryOp,
} from '../lib/offlineCatalog';
import {
  executeOrQueueOfflineInventoryOp,
  replayOfflineInventoryQueue,
} from '../lib/offlineInventoryClient';

const fmt = (n: number) => Math.round(Number(n || 0)).toLocaleString('fr-FR');

const STORAGE_KEY = 'atlas_phone_location_id';

export function getPhoneLocationId(): number {
  try {
    return Number(localStorage.getItem(STORAGE_KEY) || 0) || 0;
  } catch {
    return 0;
  }
}

export function setPhoneLocationId(id: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(id || 0));
  } catch { /* */ }
}

type Props = { onToast: (msg: string) => void };

type CountLine = { product_id: number; name: string; sku?: string; system_qty: number; counted: string };

export default function PhoneWarehouse({ onToast }: Props) {
  const stockOnly = isStockRole();
  const [tab, setTab] = useState<'view' | 'ops' | 'count' | 'transfer'>('view');
  const [locations, setLocations] = useState<any[]>([]);
  const [selected, setSelected] = useState(getPhoneLocationId);
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(!isOnline());
  const [low, setLow] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [pq, setPq] = useState('');
  const [lines, setLines] = useState<CountLine[]>([]);
  const [busy, setBusy] = useState(false);

  // Part 3: offline-operations field movement state (receive / issue / count)
  const [opKind, setOpKind] = useState<'receive' | 'issue' | 'count'>('receive');
  const [opProduct, setOpProduct] = useState<any>(null);
  const [opLocId, setOpLocId] = useState<number>(getPhoneLocationId);
  const [opQty, setOpQty] = useState('1');
  const [opNote, setOpNote] = useState('');
  const [opRev, setOpRev] = useState<number>(0);
  const [opCurrentQty, setOpCurrentQty] = useState<number>(0);
  const [pendingOpsCount, setPendingOpsCount] = useState(0);
  const [queuedOps, setQueuedOps] = useState<QueuedOfflineInventoryOp[]>([]);
  const [conflictAlert, setConflictAlert] = useState<{
    current_quantity: number;
    current_revision: number;
    message: string;
  } | null>(null);

  // transfer form
  const [tProduct, setTProduct] = useState<any>(null);
  const [tFrom, setTFrom] = useState(0);
  const [tTo, setTTo] = useState(0);
  const [tQty, setTQty] = useState('1');
  const [tNote, setTNote] = useState('');

  const load = async (locId: number | string = selected || 'all') => {
    setLoading(true);
    setOffline(!isOnline());
    try {
      if (!isOnline()) {
        const cached = await listCachedLocations();
        setLocations(cached);
        const lows = await listLowStockOffline();
        setLow(lows.slice(0, 8));
        setReport(null);
        onToast('Mode hors ligne — emplacements en cache');
        return;
      }
      const [loc, rep, prods] = await Promise.all([
        api.getStockLocations(),
        api.getStockReport({ location_id: locId || 'all' }),
        api.getProducts({ limit: 500, fields: 'mobile' } as any).catch(() => ({ data: [] })),
      ]);
      const list = (loc as any).data || [];
      setLocations(list);
      await cacheLocations(list);
      setReport((rep as any).data);
      setProducts(Array.isArray((prods as any)?.data) ? (prods as any).data : Array.isArray(prods) ? prods as any : []);
      setLow([]);
      if (list.length >= 2 && !tFrom) {
        setTFrom(list[0].id);
        setTTo(list[1].id);
      }
    } catch (e: any) {
      try {
        const cached = await listCachedLocations();
        if (cached.length) {
          setLocations(cached);
          onToast('Serveur indisponible — cache local');
        } else {
          onToast(friendlyError(e));
        }
      } catch {
        onToast(friendlyError(e));
      }
    } finally {
      setLoading(false);
    }
  };

  const refreshQueueBadge = async () => {
    try {
      const [counts, items] = await Promise.all([countOfflineInventoryOps(), listOfflineInventoryOps()]);
      setPendingOpsCount(counts.pending);
      setQueuedOps(items);
    } catch { /* */ }
  };

  useEffect(() => {
    load(selected || 'all');
    void refreshQueueBadge();
    const on = async () => {
      setOffline(false);
      try {
        const res = await replayOfflineInventoryQueue();
        if (res.applied > 0) onToast(`${res.applied} opération(s) synchronisée(s)`);
        if (res.conflicts > 0) onToast(`${res.conflicts} conflit(s) de comptage détecté(s)`);
      } catch { /* */ }
      await refreshQueueBadge();
      load(selected || 'all');
    };
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    if (!opProduct?.id || !opLocId || !isOnline()) return;
    api
      .getStockLocationsForProduct(Number(opProduct.id))
      .then((res) => {
        const match = (res.data || []).find((l) => Number(l.id) === Number(opLocId));
        if (match) {
          setOpRev(Number(match.revision ?? 0));
          setOpCurrentQty(Number(match.quantity ?? 0));
        }
      })
      .catch(() => { /* */ });
  }, [opProduct, opLocId]);

  const pick = (id: number) => {
    setSelected(id);
    setPhoneLocationId(id);
    load(id || 'all');
  };

  const activeName =
    selected === 0
      ? 'Tous les entrepôts'
      : locations.find((l) => l.id === selected)?.name || 'Entrepôt';

  const filtered = useMemo(() => {
    const q = pq.trim().toLowerCase();
    if (!q) return products.slice(0, 40);
    return products
      .filter((p) =>
        [p.name, p.sku, p.barcode].some((x) => String(x || '').toLowerCase().includes(q)),
      )
      .slice(0, 40);
  }, [products, pq]);

  const addToCount = (p: any) => {
    if (lines.some((l) => l.product_id === p.id)) {
      onToast('Déjà dans la session');
      return;
    }
    setLines((prev) => [
      ...prev,
      {
        product_id: p.id,
        name: p.name,
        sku: p.sku,
        system_qty: Number(p.stock_quantity ?? p.stock ?? 0),
        counted: String(Number(p.stock_quantity ?? p.stock ?? 0)),
      },
    ]);
  };

  const submitCount = async () => {
    if (!lines.length) {
      onToast('Ajoutez au moins un produit');
      return;
    }
    setBusy(true);
    try {
      const r = await api.cycleCountBatch({
        lines: lines.map((l) => ({
          product_id: l.product_id,
          counted_qty: Number(l.counted) || 0,
        })),
        note: `Inventaire mobile · ${activeName}`,
        apply: false,
      });
      onToast((r as any).message || 'Inventaire envoyé au PC');
      setLines([]);
      setTab('view');
    } catch (e: any) {
      onToast(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const submitTransfer = async () => {
    if (!tProduct || !tFrom || !tTo || tFrom === tTo) {
      onToast('Produit + emplacements source et destination requis');
      return;
    }
    const qty = Number(tQty);
    if (!qty || qty <= 0) {
      onToast('Quantité invalide');
      return;
    }
    setBusy(true);
    try {
      const r = await api.stockTransfer({
        product_id: tProduct.id,
        quantity: qty,
        from_location_id: tFrom,
        to_location_id: tTo,
        note: tNote || 'Transfert mobile',
      });
      onToast((r as any).message || 'Transfert enregistré');
      setTProduct(null);
      setTQty('1');
      setTNote('');
      load(selected || 'all');
    } catch (e: any) {
      onToast(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const submitFieldOp = async () => {
    if (!opProduct?.id || !opLocId) {
      onToast('Sélectionnez un produit et un emplacement');
      return;
    }
    const qtyVal = Number(opQty);
    if (!Number.isFinite(qtyVal) || (opKind === 'count' ? qtyVal < 0 : qtyVal <= 0)) {
      onToast(opKind === 'count' ? 'Quantité comptée invalide (>= 0)' : 'Quantité invalide (> 0)');
      return;
    }
    setBusy(true);
    setConflictAlert(null);
    try {
      const locName = locations.find((l) => Number(l.id) === Number(opLocId))?.name || '';
      const outcome = await executeOrQueueOfflineInventoryOp({
        kind: opKind,
        product_id: Number(opProduct.id),
        location_id: Number(opLocId),
        quantity_delta: opKind === 'count' ? undefined : qtyVal,
        counted_quantity: opKind === 'count' ? qtyVal : undefined,
        observed_quantity: opKind === 'count' ? opCurrentQty : undefined,
        observed_revision: opKind === 'count' ? opRev : undefined,
        note: opNote || undefined,
        product_name: opProduct.name,
        location_name: locName,
      });
      if (outcome.state === 'applied') {
        setOpRev(Number(outcome.data?.revision ?? opRev + 1));
        setOpCurrentQty(Number(outcome.data?.new_quantity ?? qtyVal));
        setOpNote('');
        onToast(`Mouvement appliqué (rév. ${outcome.data?.revision})`);
        void load(selected || 'all');
      } else if (outcome.state === 'queued') {
        onToast('Hors ligne — opération mise en file d’attente');
      } else if (outcome.state === 'conflict') {
        setConflictAlert({
          current_quantity: outcome.current_quantity,
          current_revision: outcome.current_revision,
          message: outcome.message,
        });
        setOpRev(outcome.current_revision);
        setOpCurrentQty(outcome.current_quantity);
        onToast('Conflit de comptage détecté (409)');
      }
      await refreshQueueBadge();
    } catch (e: any) {
      onToast(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="phone-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h1 className="ph-title" style={{ fontSize: 22, margin: 0 }}>Entrepôts</h1>
        {(pendingOpsCount > 0 || queuedOps.some((q) => q.status === 'conflict')) && (
          <span className="ph-chip on" style={{ fontSize: 12 }}>
            {pendingOpsCount} en attente
          </span>
        )}
      </div>
      <p className="ph-sub">
        Emplacement, inventaire et transferts.
        {offline && <span style={{ color: '#b45309' }}> · Hors ligne</span>}
      </p>

      <div className="ph-seg" style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {([
          ['view', 'Aperçu'],
          ['ops', 'Mouvements'],
          ['count', 'Inventaire'],
          ['transfer', 'Transfert'],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`ph-chip ${tab === k ? 'on' : ''}`}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'view' && (
        <>
          <div className="ph-wh-active">
            <span className="lbl">Sélection</span>
            <strong>{activeName}</strong>
          </div>

          <div className="ph-wh-chips" role="listbox" aria-label="Choisir un entrepôt">
            <button
              type="button"
              role="option"
              aria-selected={!selected}
              className={`ph-chip ${!selected ? 'on' : ''}`}
              onClick={() => pick(0)}
            >
              Tous
            </button>
            {locations.map((l) => (
              <button
                key={l.id}
                type="button"
                role="option"
                aria-selected={selected === l.id}
                className={`ph-chip ${selected === l.id ? 'on' : ''}`}
                onClick={() => pick(l.id)}
              >
                <span className="ph-chip-code">{l.code}</span>
                {l.is_default ? <span className="ph-chip-star">★</span> : null}
              </button>
            ))}
          </div>

          {loading && <p className="ph-sub">Chargement…</p>}

          {report && !loading && (
            <>
              <div className="ph-stats">
                <div className="ph-stat">
                  <span className="lbl">Unités</span>
                  <strong>{fmt(report.totals?.qty)}</strong>
                  <span className="hint">en stock</span>
                </div>
                {!stockOnly && (
                  <div className="ph-stat peach">
                    <span className="lbl">Valeur</span>
                    <strong style={{ fontSize: 20 }}>{fmt(report.totals?.value)}</strong>
                    <span className="hint">MAD</span>
                  </div>
                )}
                <div className="ph-stat rose">
                  <span className="lbl">Lignes</span>
                  <strong>{fmt(report.totals?.lines)}</strong>
                  <span className="hint">références</span>
                </div>
              </div>
              {Array.isArray(report.lines) && report.lines.length > 0 && (
                <div className="ph-panel" style={{ marginTop: 10, padding: 0 }}>
                  {report.lines.slice(0, 12).map((row: any) => (
                    <div key={row.product_id || row.sku} className="ph-row ph-card" style={{ padding: '10px 12px' }}>
                      <div>
                        <div className="ph-row-title">{row.name}</div>
                        <div className="ph-row-detail">{row.sku || '—'} · qté {fmt(row.quantity ?? row.qty)}</div>
                      </div>
                      {!stockOnly && <strong>{fmt(row.value)} MAD</strong>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {low.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <p className="ph-sub">Stock bas (cache)</p>
              {low.map((p) => (
                <div key={p.id} className="ph-row ph-card">
                  <div className="ph-row-title">{p.name}</div>
                  <div className="ph-row-detail">qté {p.stock_quantity}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'ops' && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {([
              ['receive', 'Réception'],
              ['issue', 'Sortie'],
              ['count', 'Comptage'],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={`ph-chip ${opKind === k ? 'on' : ''}`}
                onClick={() => {
                  setOpKind(k);
                  setConflictAlert(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          <select
            aria-label="Emplacement du mouvement"
            value={opLocId}
            onChange={(e) => setOpLocId(Number(e.target.value))}
            style={{ width: '100%', height: 44, borderRadius: 12 }}
          >
            <option value={0}>Choisir un entrepôt…</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.code} — {l.name}</option>
            ))}
          </select>

          <input
            className="ph-search"
            value={pq}
            onChange={(e) => setPq(e.target.value)}
            placeholder="Produit…"
          />
          {!opProduct ? (
            <div className="ph-panel" style={{ padding: 0, maxHeight: 160, overflow: 'auto' }}>
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="ph-row ph-card"
                  style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent' }}
                  onClick={() => setOpProduct(p)}
                >
                  <div>
                    <div className="ph-row-title">{p.name}</div>
                    <div className="ph-row-detail">{p.sku || '—'} · total {Number(p.stock_quantity ?? 0)}</div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="ph-panel" style={{ padding: 10 }}>
              <div className="ph-row-title">{opProduct.name}</div>
              <div className="ph-row-detail">
                Emplacement qté : {opCurrentQty} · révision {opRev}
              </div>
              <button type="button" className="ph-chip" style={{ marginTop: 6 }} onClick={() => setOpProduct(null)}>
                Changer de produit
              </button>
            </div>
          )}

          <input
            type="number"
            inputMode="decimal"
            aria-label={opKind === 'count' ? 'Quantité comptée' : 'Quantité'}
            value={opQty}
            onChange={(e) => setOpQty(e.target.value)}
            placeholder={opKind === 'count' ? 'Quantité comptée' : 'Quantité'}
            style={{ width: '100%', height: 44, borderRadius: 12, padding: '0 12px' }}
          />
          <input
            value={opNote}
            onChange={(e) => setOpNote(e.target.value)}
            placeholder="Note (optionnel)"
            style={{ width: '100%', height: 44, borderRadius: 12, padding: '0 12px' }}
          />

          {conflictAlert && (
            <div role="alert" className="ph-sale-error" style={{ padding: 10, borderRadius: 10 }}>
              <strong>Conflit de révision (409)</strong>
              <p style={{ margin: '4px 0', fontSize: 12 }}>
                {conflictAlert.message} — Serveur : qté {conflictAlert.current_quantity}, rév. {conflictAlert.current_revision}.
              </p>
              <button
                type="button"
                className="ph-chip on"
                onClick={() => {
                  setOpRev(conflictAlert.current_revision);
                  setOpCurrentQty(conflictAlert.current_quantity);
                  setConflictAlert(null);
                }}
              >
                Utiliser la révision {conflictAlert.current_revision}
              </button>
            </div>
          )}

          <button type="button" className="ph-inv-go" disabled={busy} onClick={() => void submitFieldOp()}>
            {busy ? 'Envoi…' : opKind === 'receive' ? 'Enregistrer réception →' : opKind === 'issue' ? 'Enregistrer sortie →' : 'Valider comptage →'}
          </button>

          {queuedOps.length > 0 && (
            <div className="ph-panel" style={{ padding: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <strong style={{ fontSize: 13 }}>File hors ligne ({queuedOps.length})</strong>
                {isOnline() && (
                  <button
                    type="button"
                    className="ph-chip on"
                    onClick={async () => {
                      await replayOfflineInventoryQueue();
                      await refreshQueueBadge();
                    }}
                  >
                    Synchroniser
                  </button>
                )}
              </div>
              {queuedOps.map((q) => (
                <div key={q.operation_id} style={{ fontSize: 12, padding: '6px 0', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
                  <div>
                    <strong>{q.kind}</strong> · {q.product_name || `#${q.product_id}`} · <span>{q.status}</span>
                  </div>
                  {q.status === 'conflict' && q.conflict && (
                    <div style={{ color: '#b91c1c' }}>
                      Conflit : serveur qté {q.conflict.current_quantity} (rév. {q.conflict.current_revision})
                    </div>
                  )}
                  {q.error_message && q.status !== 'pending' && (
                    <div style={{ color: '#b91c1c' }}>{q.error_message}</div>
                  )}
                  {q.seq != null && q.status !== 'pending' && (
                    <button
                      type="button"
                      className="ph-chip"
                      style={{ marginTop: 4 }}
                      onClick={async () => {
                        await removeOfflineInventoryOpBySeq(q.seq!);
                        await refreshQueueBadge();
                      }}
                    >
                      Ignorer
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'count' && (
        <>
          <p className="ph-sub" style={{ marginBottom: 8 }}>
            Session d’inventaire — les quantités partent au PC pour validation (magasinier).
          </p>
          <input
            className="ph-search"
            value={pq}
            onChange={(e) => setPq(e.target.value)}
            placeholder="Rechercher produit à compter…"
            style={{ marginBottom: 8 }}
          />
          <div className="ph-panel" style={{ padding: 0, maxHeight: 180, overflow: 'auto', marginBottom: 10 }}>
            {filtered.map((p) => (
              <button
                key={p.id}
                type="button"
                className="ph-row ph-card"
                style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent' }}
                onClick={() => addToCount(p)}
              >
                <div>
                  <div className="ph-row-title">{p.name}</div>
                  <div className="ph-row-detail">
                    {p.sku || '—'} · système {Number(p.stock_quantity ?? 0)}
                  </div>
                </div>
                <span className="ph-chip">+</span>
              </button>
            ))}
          </div>

          {lines.length > 0 && (
            <>
              <p className="ph-sub">{lines.length} ligne(s) dans la session</p>
              {lines.map((l, idx) => (
                <div key={l.product_id} className="ph-row ph-card" style={{ alignItems: 'center', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div className="ph-row-title">{l.name}</div>
                    <div className="ph-row-detail">Système: {l.system_qty}</div>
                  </div>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={l.counted}
                    onChange={(e) => {
                      const v = e.target.value;
                      setLines((prev) => prev.map((x, i) => (i === idx ? { ...x, counted: v } : x)));
                    }}
                    style={{ width: 72, height: 40, borderRadius: 10, border: '1px solid #e5e0d6', padding: '0 8px' }}
                  />
                  <button
                    type="button"
                    className="ph-chip"
                    onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="ph-inv-go"
                style={{ marginTop: 12 }}
                disabled={busy}
                onClick={() => void submitCount()}
              >
                {busy ? 'Envoi…' : 'Envoyer l’inventaire au PC →'}
              </button>
            </>
          )}
        </>
      )}

      {tab === 'transfer' && (
        <>
          <p className="ph-sub" style={{ marginBottom: 8 }}>
            Déplacer du stock entre entrepôts (MAG ↔ RES…).
          </p>
          <input
            className="ph-search"
            value={pq}
            onChange={(e) => setPq(e.target.value)}
            placeholder="Produit à transférer…"
            style={{ marginBottom: 8 }}
          />
          {!tProduct && (
            <div className="ph-panel" style={{ padding: 0, maxHeight: 160, overflow: 'auto', marginBottom: 10 }}>
              {filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="ph-row ph-card"
                  style={{ width: '100%', textAlign: 'left', border: 'none', background: 'transparent' }}
                  onClick={() => setTProduct(p)}
                >
                  <div>
                    <div className="ph-row-title">{p.name}</div>
                    <div className="ph-row-detail">{p.sku} · stock {Number(p.stock_quantity ?? 0)}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
          {tProduct && (
            <div className="ph-panel" style={{ marginBottom: 10 }}>
              <div className="ph-row-title">{tProduct.name}</div>
              <button type="button" className="ph-chip" style={{ marginTop: 6 }} onClick={() => setTProduct(null)}>
                Changer de produit
              </button>
            </div>
          )}

          <div className="form-row" style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 12 }}>De</label>
            <select
              value={tFrom}
              onChange={(e) => setTFrom(Number(e.target.value))}
              style={{ width: '100%', height: 44, borderRadius: 12 }}
            >
              <option value={0}>—</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.code} — {l.name}</option>
              ))}
            </select>
          </div>
          <div className="form-row" style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 12 }}>Vers</label>
            <select
              value={tTo}
              onChange={(e) => setTTo(Number(e.target.value))}
              style={{ width: '100%', height: 44, borderRadius: 12 }}
            >
              <option value={0}>—</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>{l.code} — {l.name}</option>
              ))}
            </select>
          </div>
          <div className="form-row" style={{ marginBottom: 8 }}>
            <label style={{ fontSize: 12 }}>Quantité</label>
            <input
              type="number"
              inputMode="decimal"
              value={tQty}
              onChange={(e) => setTQty(e.target.value)}
              style={{ width: '100%', height: 44, borderRadius: 12, padding: '0 12px' }}
            />
          </div>
          <div className="form-row" style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12 }}>Note</label>
            <input
              value={tNote}
              onChange={(e) => setTNote(e.target.value)}
              placeholder="Optionnel"
              style={{ width: '100%', height: 44, borderRadius: 12, padding: '0 12px' }}
            />
          </div>
          <button type="button" className="ph-inv-go" disabled={busy} onClick={() => void submitTransfer()}>
            {busy ? 'Transfert…' : 'Transférer →'}
          </button>
        </>
      )}
    </div>
  );
}
