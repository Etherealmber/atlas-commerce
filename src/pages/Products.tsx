import EmptyState from '../components/EmptyState';
import { draftProductFromFile } from '../lib/assist';
import { validateProductForm, firstError } from '../lib/formValidate';
import { useEffect, useMemo, useState } from 'react';
import { useDebouncedValue } from '../lib/perf';
import { api } from '../api';
import SaveFeedback from '../components/SaveFeedback';
import PasswordConfirm from '../components/PasswordConfirm';
import { openReport } from '../lib/reports';
import { downloadExport } from '../lib/export';
import { useUi } from '../components/AppDialogs';
import { numStr, numFromInput } from '../lib/numInput';
import NumberField from '../components/NumberField';
import VirtualTableBody, { VirtualScroll } from '../components/VirtualTableBody';
import { isStockRole } from '../auth';
import ProductImageEditor from '../components/ProductImageEditor';
import { printProductLabel } from '../lib/printProductLabel';
import RefreshIconButton from '../components/RefreshIconButton';
import '../components/erp/catalog-inventory.css';

export default function Products() {
  const { confirm, prompt } = useUi();
  const hideMoney = isStockRole();
  const [list, setList] = useState<any[]>([]);
  const [stockLocations, setStockLocations] = useState<any[]>([]);
  const [placements, setPlacements] = useState<Record<number, any>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [stockFilter, setStockFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveMsg, setSaveMsg] = useState('');
  const [saveMsgType, setSaveMsgType] = useState<'success' | 'error'>('success');
  const [adjustProduct, setAdjustProduct] = useState<any>(null);
  const [adjustQty, setAdjustQty] = useState(1);
  const [adjustType, setAdjustType] = useState('in');
  const [adjustReason, setAdjustReason] = useState('');
  const [movements, setMovements] = useState<any[] | null>(null);
  const [movementsFor, setMovementsFor] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pwOpen, setPwOpen] = useState(false);
  const [pwTitle, setPwTitle] = useState('');
  const [pwDesc, setPwDesc] = useState('');
  const [pendingAction, setPendingAction] = useState<null | ((password: string) => Promise<void>)>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);
  const [variants, setVariants] = useState<any[]>([]);
  const [variantForm, setVariantForm] = useState({ variant_label: '', sku: '', barcode: '', price: '', stock_quantity: '0' });
  const [savingVariant, setSavingVariant] = useState(false);

  const emptyForm = {
    name: '', sku: '', description: '', category: 'Général', unit: 'unité', price: 0, cost: 0,
    stock_quantity: 0, low_stock_threshold: 5, track_inventory: 1, barcode: '', tax_rate: '', location_id: 0,
    bulk_qty_1: '', bulk_pct_1: '', bulk_qty_2: '', bulk_pct_2: '',
    lot_number: '',
    expiry_date: '',
  };
  const [form, setForm] = useState<any>(emptyForm);

  const loadPlacements = async (productId: number) => {
    if (placements[productId]) return;
    try {
      const r: any = await api.getProductPlacements(productId);
      setPlacements((prev) => ({ ...prev, [productId]: r.data }));
    } catch { /* */ }
  };

  const flash = (msg: string, type: 'success' | 'error' = 'success') => {
    setSaveMsg(msg); setSaveMsgType(type);
    setTimeout(() => setSaveMsg(''), 4500);
  };

  const loadLookups = () => {
    Promise.all([api.getCategories(), api.getUnits()])
      .then(([c, u]) => {
        setCategories(c.data || []);
        setUnits(u.data || []);
      })
      .catch(() => { /* ignore */ });
  };

  const load = (soft = false) => {
    if (soft) setRefreshing(true);
    else setLoading(true);
    Promise.all([
      api.getProducts({ limit: 200 }),
      api.getStockLocations().catch(() => ({ data: [] as any[] })),
    ])
      .then(([prodRes, locRes]: any[]) => {
        setList(prodRes.data || []);
        setStockLocations(locRes?.data || []);
        // Placements load on demand via loadPlacements() — avoids N+1 on list
      })
      .catch((e: any) => {
        flash(e?.message || 'Chargement produits impossible', 'error');
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
    loadLookups();
  };
  useEffect(() => { load(); }, []);

  const addCategory = async () => {
    const name = await prompt({ title: 'Nouvelle catégorie', placeholder: 'Nom de la catégorie' });
    if (!name?.trim()) return;
    try {
      const res: any = await api.createCategory({ name: name.trim() });
      flash(res.message || 'Catégorie créée.');
      await loadLookups();
      setForm((f: any) => ({ ...f, category: name.trim() }));
    } catch (e: any) {
      flash(e.message || 'Erreur catégorie', 'error');
    }
  };

  const addUnit = async () => {
    const name = await prompt({
      title: 'Nouvelle unité',
      message: 'Ex. palette, sachet…',
      placeholder: 'Nom de l\'unité',
    });
    if (!name?.trim()) return;
    try {
      const res: any = await api.createUnit({ name: name.trim() });
      flash(res.message || 'Unité créée.');
      await loadLookups();
      setForm((f: any) => ({ ...f, unit: name.trim() }));
    } catch (e: any) {
      flash(e.message || 'Erreur unité', 'error');
    }
  };

  const parseBulkFromProduct = (p: any) => {
    let tiers: { min_qty: number; percent: number }[] = [];
    try {
      const raw = typeof p.bulk_discounts === 'string' ? JSON.parse(p.bulk_discounts || '[]') : (p.bulk_discounts || []);
      if (Array.isArray(raw)) tiers = raw;
    } catch { /* ignore */ }
    tiers = tiers.sort((a, b) => a.min_qty - b.min_qty);
    return {
      bulk_qty_1: tiers[0]?.min_qty ?? '',
      bulk_pct_1: tiers[0]?.percent ?? '',
      bulk_qty_2: tiers[1]?.min_qty ?? '',
      bulk_pct_2: tiers[1]?.percent ?? '',
    };
  };

  const openNew = () => {
    setForm(emptyForm);
    setEditing(null);
    setVariants([]);
    setVariantForm({ variant_label: '', sku: '', barcode: '', price: '', stock_quantity: '0' });
    setShow(true);
  };
  const openEdit = async (p: any) => {
    setForm({ ...p, tax_rate: p.tax_rate ?? '', ...parseBulkFromProduct(p) });
    setEditing(p);
    setVariantForm({ variant_label: '', sku: '', barcode: '', price: String(p.price ?? ''), stock_quantity: '0' });
    setShow(true);
    try {
      const res = await api.getVariants(p.id);
      setVariants(res.data || []);
    } catch {
      setVariants([]);
    }
  };

  const saveVariant = async () => {
    if (!editing?.id) return;
    if (!variantForm.variant_label.trim()) {
      flash('Libellé de variante obligatoire (ex. M / Rouge).', 'error');
      return;
    }
    setSavingVariant(true);
    try {
      await api.createVariant(editing.id, {
        variant_label: variantForm.variant_label.trim(),
        sku: variantForm.sku || undefined,
        barcode: variantForm.barcode || undefined,
        price: variantForm.price !== '' ? Number(variantForm.price) : undefined,
        stock_quantity: Number(variantForm.stock_quantity || 0),
      });
      flash('Variante créée.');
      setVariantForm({ variant_label: '', sku: '', barcode: '', price: String(editing.price ?? ''), stock_quantity: '0' });
      const res = await api.getVariants(editing.id);
      setVariants(res.data || []);
    } catch (e: any) {
      flash(e.message || 'Erreur variante', 'error');
    } finally {
      setSavingVariant(false);
    }
  };

  const removeVariant = async (vid: number) => {
    const ok = await confirm({ message: 'Désactiver cette variante ?', title: 'Variante', danger: true });
    if (!ok) return;
    try {
      await api.deleteVariant(vid);
      flash('Variante désactivée.');
      if (editing?.id) {
        const res = await api.getVariants(editing.id);
        setVariants(res.data || []);
      }
    } catch (e: any) {
      flash(e.message || 'Erreur', 'error');
    }
  };

  const buildProductBody = (force = false) => {
    const bulk: { min_qty: number; percent: number }[] = [];
    if (Number(form.bulk_qty_1) > 0 && Number(form.bulk_pct_1) > 0) {
      bulk.push({ min_qty: Number(form.bulk_qty_1), percent: Number(form.bulk_pct_1) });
    }
    if (Number(form.bulk_qty_2) > 0 && Number(form.bulk_pct_2) > 0) {
      bulk.push({ min_qty: Number(form.bulk_qty_2), percent: Number(form.bulk_pct_2) });
    }
    // Explicit numeric price/cost so updates always hit the API fields
    const price = Number(form.price);
    const cost = Number(form.cost);
    const body: any = {
      name: form.name,
      sku: form.sku,
      description: form.description ?? '',
      category: form.category,
      unit: form.unit,
      barcode: form.barcode ?? '',
      lot_number: form.lot_number || '',
      expiry_date: form.expiry_date || '',
      price: Number.isFinite(price) ? price : 0,
      cost: Number.isFinite(cost) ? cost : 0,
      unit_price: Number.isFinite(price) ? price : 0,
      low_stock_threshold: Number(form.low_stock_threshold) || 0,
      track_inventory: form.track_inventory ? 1 : 0,
      tax_rate: form.tax_rate === '' || form.tax_rate == null ? null : Number(form.tax_rate),
      bulk_discounts: bulk,
    };
    // stock only on create (edit uses adjust-stock)
    if (!editing) {
      body.stock_quantity = Number(form.stock_quantity) || 0;
    }
    if (force) body.force_duplicate = true;
    if (form.location_id) body.location_id = Number(form.location_id);
    return body;
  };

  const save = async (force = false) => {
    const fe = validateProductForm(form);
    setFieldErrors(fe);
    if (Object.keys(fe).length) { flash(firstError(fe) || 'Complétez les champs obligatoires.', 'error'); return; }
    setSaving(true);
    try {
      const body = buildProductBody(force);
      if (editing) {
        await api.updateProduct(editing.id, body);
        flash('Produit mis à jour.');
      } else {
        await api.createProduct(body);
        flash('Produit créé.');
      }
      setShow(false); setForm(emptyForm); setEditing(null);
      load(true);
    } catch (e: any) {
      if (e.code === 'DUPLICATE_PRODUCT' && e.force_required && !force) {
        const matchHint = (e.matches || [])
          .map((m: any) => `${m.on}: « ${m.name} » (id ${m.id})`)
          .join(' · ');
        const ok = await confirm({
          title: 'Produit en doublon',
          message: `${e.message}\n\n${matchHint || e.hint || ''}\n\nForcer l'enregistrement quand même ?`,
          confirmLabel: 'Forcer',
          danger: true,
        });
        if (ok) {
          setSaving(false);
          await save(true);
          return;
        }
      }
      flash(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const openDelete = (ids?: number[]) => {
    const targetIds = ids && ids.length ? ids : Array.from(selected);
    if (!targetIds.length) { flash('Cochez au moins un produit à supprimer.', 'error'); return; }
    setSelected(new Set(targetIds));
    setPwTitle(targetIds.length === 1 ? 'Supprimer le produit' : `Supprimer ${targetIds.length} produits`);
    setPwDesc('Cette action est définitive. Saisissez votre mot de passe pour confirmer.');
    setPendingAction(() => async (password: string) => {
      const res = targetIds.length === 1
        ? await api.deleteProduct(targetIds[0], password)
        : await api.bulkDeleteProducts(targetIds, password);
      flash((res as any).message || 'Produit(s) supprimé(s).');
      setPwOpen(false); setPendingAction(null);
      setSelected(new Set());
      load(true);
    });
    setPwOpen(true);
  };

  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const doAdjust = async () => {
    if (!adjustProduct || adjustQty <= 0) { flash('Saisissez une quantité valide.', 'error'); return; }
    setSaving(true);
    try {
      await api.adjustStock(adjustProduct.id, { quantity: adjustQty, type: adjustType, reason: adjustReason });
      flash('Stock ajusté et enregistré dans la base de données.');
      setAdjustProduct(null); setAdjustQty(1); setAdjustReason('');
      load(true);
    } catch (e: any) { flash(e.message, 'error'); } finally { setSaving(false); }
  };

  const loadMovements = async (id: number) => {
    if (movementsFor === id) { setMovements(null); setMovementsFor(null); return; }
    try {
      const res = await api.getProductMovements(id);
      setMovements(res.data); setMovementsFor(id);
    } catch { setMovements([]); setMovementsFor(id); }
  };

  const filtered = useMemo(() => {
    const q = (debouncedSearch || '').toLowerCase().trim();
    return list.filter((p) => {
      const matchSearch =
        !q ||
        p.name?.toLowerCase().includes(q) ||
        p.sku?.toLowerCase().includes(q) ||
        (p.barcode && String(p.barcode).toLowerCase().includes(q));
      const matchStock =
        !stockFilter ||
        (stockFilter === 'low' && p.stock_quantity <= p.low_stock_threshold) ||
        (stockFilter === 'out' && p.stock_quantity === 0) ||
        (stockFilter === 'ok' && p.stock_quantity > p.low_stock_threshold);
      const matchCat = !categoryFilter || p.category === categoryFilter;
      return matchSearch && matchStock && matchCat;
    });
  }, [list, debouncedSearch, stockFilter, categoryFilter]);

  const fmt = (n: number) => Math.round(Number(n || 0)).toLocaleString("fr-FR");

  if (loading) return <div className="empty">Chargement des produits...</div>;

  const catalogKpis = (() => {
    const tracked = list.filter((p) => p.track_inventory);
    const low = tracked.filter((p) => Number(p.stock_quantity) > 0 && Number(p.stock_quantity) <= Number(p.low_stock_threshold || 0)).length;
    const out = tracked.filter((p) => Number(p.stock_quantity) === 0).length;
    const ok = tracked.filter((p) => Number(p.stock_quantity) > Number(p.low_stock_threshold || 0)).length;
    const skus = list.filter((p) => p.sku || p.barcode).length;
    return { n: list.length, low, out, ok, skus, shown: filtered.length };
  })();

  return (
    <div className="atlas-catalog">
      <div className="page-header">
        <div>
          <h1>Produits &amp; stock</h1>
          <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>
            {list.length} produits · {list.filter(p => p.stock_quantity <= p.low_stock_threshold && p.track_inventory).length} stock bas · {list.filter(p => p.stock_quantity === 0).length} en rupture
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <RefreshIconButton onClick={() => load(true)} loading={refreshing} />
          {selected.size > 0 && (
            <button className="danger" onClick={() => openDelete()}>
              Supprimer la sélection ({selected.size})
            </button>
          )}
          <button className="secondary" onClick={() => openReport('/api/reports/stock')}>PDF Stock</button>
          <button
            className="secondary"
            type="button"
            disabled={exportBusy}
            onClick={async () => {
              setExportBusy(true);
              try {
                await downloadExport('/api/export/products', 'produits.csv');
              } finally {
                setExportBusy(false);
              }
            }}
          >
            {exportBusy ? 'Export…' : 'Excel CSV'}
          </button>
          <button onClick={openNew}>+ Nouveau produit</button>
        </div>
      </div>

      <SaveFeedback message={saveMsg} type={saveMsgType} />

      
      <div className="atlas-stat-grid" style={{ marginBottom: 16 }}>
        <div className="atlas-stat paper"><div className="as-label">Produits</div><div className="as-value">{catalogKpis.n}</div></div>
        <div className="atlas-stat paper"><div className="as-label">Affichés</div><div className="as-value">{catalogKpis.shown}</div></div>
        <div className="atlas-stat paper"><div className="as-label">SKU / CB</div><div className="as-value">{catalogKpis.skus}</div></div>
        <div className="atlas-stat paper"><div className="as-label">OK</div><div className="as-value">{catalogKpis.ok}</div></div>
        <div className="atlas-stat paper"><div className="as-label">Stock bas</div><div className="as-value">{catalogKpis.low}</div></div>
        <div className="atlas-stat paper"><div className="as-label">Rupture</div><div className="as-value">{catalogKpis.out}</div></div>
      </div>
      <div className="atlas-catalog-legend">
        <span><span className="stock-pill ok">OK</span> au-dessus du seuil</span>
        <span><span className="stock-pill low">Bas</span> ≤ seuil</span>
        <span><span className="stock-pill out">Rupture</span> qty 0</span>
        <span>Recherche : nom · réf · code-barres</span>
      </div>
<div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="search-bar" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}><input className="search-input" placeholder="Rechercher par nom, référence ou code-barres..." value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Rechercher produits" /></div>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={{ width: 'auto', minWidth: 140 }}>
            <option value="">Toutes catégories</option>
            {categories.map((c) => (
              <option key={c.id ?? c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
          <select value={stockFilter} onChange={(e) => setStockFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="">Tous les niveaux</option>
            <option value="ok">En stock</option>
            <option value="low">Stock bas</option>
            <option value="out">Rupture</option>
          </select>
        </div>
      </div>

      <div className="card">
        <VirtualScroll maxHeight={filtered.length > 60 ? 560 : undefined}>
          <table className="data-dense">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every((p) => selected.has(p.id))}
                    onChange={() => {
                      const all = filtered.length > 0 && filtered.every((p) => selected.has(p.id));
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (all) filtered.forEach((p) => next.delete(p.id));
                        else filtered.forEach((p) => next.add(p.id));
                        return next;
                      });
                    }}
                    aria-label="Tout sélectionner"
                  />
                </th>
                <th>Nom</th><th>Référence</th><th>Catégorie</th>{!hideMoney && <th>Prix</th>}{!hideMoney && <th>Coût</th>}<th>Stock</th><th>Statut</th><th>Actions</th>
              </tr>
            </thead>
            {filtered.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={9}>
                    <EmptyState
                      title="Aucun produit"
                      description="Ajoutez des articles avec stock, prix et seuil bas pour piloter les ventes et les alertes."
                      actionLabel="Nouveau produit"
                      onAction={() => { setEditing(null); setForm(emptyForm); setShow(true); }}
                      icon="package"
                    />
                  </td>
                </tr>
              </tbody>
            ) : (
              <VirtualTableBody
                rows={filtered}
                rowHeight={48}
                maxHeight={560}
                getKey={(p) => p.id}
                renderRow={(p) => (
                  <tr>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleOne(p.id)}
                        aria-label={`Sélectionner ${p.name}`}
                      />
                    </td>
                    <td>
                      <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        {p.image_url ? (
                          <img src={p.image_url} alt="" width={32} height={32} loading="lazy" decoding="async" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 6, flexShrink: 0 }} />
                        ) : null}
                        {p.name}
                      </strong>
                      {p.description && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.description}</div>}
                    </td>
                    <td><span className="sku-mono">{p.sku || '—'}</span></td>
                    <td>{p.category || '—'}</td>
                    {!hideMoney && <td>{fmt(p.price)}</td>}
                    {!hideMoney && <td>{fmt(p.cost)}</td>}
                    <td style={{ fontWeight: 700 }}>
                      {p.track_inventory ? (
                        <div>
                          <span className="stock-cell">{p.stock_quantity}</span>
                        {p.track_inventory && Number(p.stock_quantity) === 0 && <span className="stock-pill out">Rupture</span>}
                        {p.track_inventory && Number(p.stock_quantity) > 0 && Number(p.stock_quantity) <= Number(p.low_stock_threshold || 0) && <span className="stock-pill low">Bas</span>}
                        {p.track_inventory && Number(p.stock_quantity) > Number(p.low_stock_threshold || 0) && <span className="stock-pill ok">OK</span>}
                          {placements[p.id]?.placements ? (
                            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, lineHeight: 1.35, fontWeight: 500 }}>
                              {placements[p.id].placements
                                .filter((x: any) => Number(x.quantity) > 0)
                                .map((x: any) => (
                                  <span key={x.location_id} style={{ marginRight: 8 }}>
                                    {String(x.code || '—')}:&nbsp;
                                    <strong style={{ color: 'var(--ink)' }}>{x.quantity}</strong>
                                  </span>
                                ))}
                              {!placements[p.id].placements.some((x: any) => Number(x.quantity) > 0) && (
                                <span style={{ fontWeight: 400 }}>Non réparti</span>
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : '—'}
                    </td>
                    <td>{p.is_active === 0 ? <span className="badge danger">Inactif</span> : <span className="badge success">Actif</span>}</td>
                    <td className="row-actions" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {p.track_inventory && <button className="secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setAdjustProduct(p)}>Ajuster</button>}
                      <button className="secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => loadMovements(p.id)}>Historique</button>
                      <button className="secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => openEdit(p)}>Modifier</button>
                      <button
                        type="button"
                        className="secondary"
                        style={{ padding: '4px 10px', fontSize: 12 }}
                        onClick={() =>
                          printProductLabel({
                            name: p.name,
                            sku: p.sku,
                            barcode: p.barcode,
                            price: p.price,
                            showPrice: !hideMoney,
                          })
                        }
                      >
                        Étiquette
                      </button>
                      <button className="danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => openDelete([p.id])}>Suppr.</button>
                    </td>
                  </tr>
                )}
              />
            )}
          </table>
        </VirtualScroll>
        {movementsFor && movements && (
          <div style={{ background: 'var(--stone)', padding: '12px 20px', borderTop: '1px solid var(--border, #e5e0d8)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong style={{ fontSize: 13 }}>Historique des mouvements — produit #{movementsFor}</strong>
              <button type="button" className="secondary" style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => { setMovementsFor(null); setMovements(null); }}>Fermer</button>
            </div>
            {movements.length ? (
              <table>
                <thead><tr><th>Date</th><th>Type</th><th>Qté</th><th>Avant</th><th>Après</th><th>Raison</th><th>Référence</th></tr></thead>
                <tbody>
                  {movements.map((m) => (
                    <tr key={m.id}>
                      <td style={{ fontSize: 12 }}>{m.created_at}</td>
                      <td><span className="badge info" style={{ textTransform: 'capitalize' }}>{m.type}</span></td>
                      <td>{m.quantity}</td>
                      <td>{m.previous_quantity}</td>
                      <td style={{ fontWeight: 700 }}>{m.new_quantity}</td>
                      <td style={{ fontSize: 12 }}>{m.reason || '—'}</td>
                      <td style={{ fontSize: 12 }}>{m.reference || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="empty" style={{ padding: 12 }}>Aucun mouvement de stock enregistré.</div>}
          </div>
        )}
      </div>

      {show && (
        <div className="modal-overlay" onClick={() => setShow(false)}>
          <div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
            <h2>{editing ? 'Modifier le produit' : 'Nouveau produit'}</h2>
            <div className="grid grid-2">
              <div className="form-row"><label>Nom *</label><input className={fieldErrors.name ? 'field-error' : undefined} value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); setFieldErrors((x) => ({ ...x, name: '' })); }} placeholder="Ex. Carrelage 60×60" /><span className="field-error-msg">{fieldErrors.name || ''}</span></div>
              <div className="form-row"><label>Référence (SKU)</label><input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></div>
            </div>
            <div className="form-row">
              <label>Description</label>
              <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Courte description catalogue…" />
              <button
                type="button"
                className="secondary"
                style={{ marginTop: 6, fontSize: 12 }}
                onClick={async () => {
                  const hint = [form.name, form.category, form.sku].filter(Boolean).join(' · ') || 'produit marbre';
                  try {
                    const res = await api.assistChat(
                      `Rédige la description catalogue pour: ${hint}. ${form.description || ''}`.trim(),
                      { task: 'description', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
                    );
                    if (res.data?.reply) setForm((f: any) => ({ ...f, description: res.data.reply.trim() }));
                  } catch { /* local silent */ }
                }}
              >
                Générer la description (IA)
              </button>
            </div>
            <div className="grid grid-3">
              <div className="form-row">
                <label>Catégorie</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select
                    value={form.category || ''}
                    onChange={(e) => {
                      if (e.target.value === '__new__') { addCategory(); return; }
                      setForm({ ...form, category: e.target.value });
                    }}
                    style={{ flex: 1 }}
                  >
                    <option value="">— Choisir —</option>
                    {categories.map((c) => (
                      <option key={c.id ?? c.name} value={c.name}>{c.name}</option>
                    ))}
                    {form.category && !categories.some((c) => c.name === form.category) && (
                      <option value={form.category}>{form.category}</option>
                    )}
                    <option value="__new__">+ Nouvelle catégorie…</option>
                  </select>
                  <button
                    type="button"
                    className="secondary"
                    style={{ fontSize: 12, whiteSpace: 'nowrap' }}
                    onClick={async () => {
                      const hint = [form.name, form.description, form.sku].filter(Boolean).join(' · ') || 'matériau';
                      try {
                        const res = await api.assistChat(
                          `Propose la meilleure catégorie produit pour: ${hint}`,
                          { task: 'category', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
                        );
                        const cat = (res.data?.reply || '').split('\n')[0].replace(/^["«]|["»]$/g, '').trim();
                        if (cat) setForm((f: any) => ({ ...f, category: cat.slice(0, 60) }));
                      } catch { /* */ }
                    }}
                  >
                    IA
                  </button>
                </div>
              </div>
              <div className="form-row">
                <label>Unité (m², ML…)</label>
                <select
                  value={form.unit || ''}
                  onChange={(e) => {
                    if (e.target.value === '__new__') { addUnit(); return; }
                    setForm({ ...form, unit: e.target.value });
                  }}
                >
                  <option value="">— Choisir —</option>
                  {units.map((u) => (
                    <option key={u.id ?? u.name} value={u.name}>
                      {u.symbol ? `${u.name} (${u.symbol})` : u.name}
                    </option>
                  ))}
                  {form.unit && !units.some((u) => u.name === form.unit) && (
                    <option value={form.unit}>{form.unit}</option>
                  )}
                  <option value="__new__">+ Nouvelle unité…</option>
                </select>
              </div>
              <div className="form-row"><label>Code-barres</label><input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} /></div>
                          <div className="form-row"><label>N° lot (épicerie)</label><input value={form.lot_number || ''} onChange={(e) => setForm({ ...form, lot_number: e.target.value })} placeholder="Optionnel" /></div>
              <div className="form-row"><label>Date limite (DLC)</label><input type="date" value={(form.expiry_date || '').toString().slice(0, 10)} onChange={(e) => setForm({ ...form, expiry_date: e.target.value })} /></div>
</div>
            <div className="grid grid-2">
              <div className="form-row"><label>Prix de vente *</label><NumberField value={form.price} onValueChange={(n) => { setForm((f: any) => ({ ...f, price: n })); setFieldErrors((x) => ({ ...x, price: '' })); }} /><span className="field-error-msg">{fieldErrors.price || ''}</span></div>
              <div className="form-row"><label>Coût</label><NumberField value={form.cost} onValueChange={(n) => setForm((f: any) => ({ ...f, cost: n }))} /></div>
            </div>
            {!editing && (
              <div className="grid grid-3">
                <div className="form-row"><label>Stock initial</label><NumberField value={form.stock_quantity} onValueChange={(n) => setForm({ ...form, stock_quantity: n })} /></div>
                <div className="form-row"><label>Entrepôt / emplacement</label>
                  <select value={form.location_id || ''} onChange={(e) => setForm({ ...form, location_id: Number(e.target.value) || 0 })}>
                    <option value="0">Emplacement par défaut</option>
                    {stockLocations.map((l: any) => (
                      <option key={l.id} value={l.id}>{l.name} ({l.code})</option>
                    ))}
                  </select>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {editing ? 'À l’enregistrement, le stock total sera placé sur cet entrepôt.' : 'Le stock initial sera placé ici.'}
                  </span>
                </div>
                <div className="form-row"><label>Seuil d'alerte</label><NumberField value={form.low_stock_threshold} onValueChange={(n) => setForm({ ...form, low_stock_threshold: n })} /></div>
                <div className="form-row"><label>Taux TVA %</label><NumberField value={form.tax_rate} onValueChange={(n) => setForm({ ...form, tax_rate: n })} placeholder="Défaut" /></div>
              </div>
            )}
            {editing && (
              <div className="grid grid-2">
                <div className="form-row"><label>Seuil d'alerte</label><NumberField value={form.low_stock_threshold} onValueChange={(n) => setForm({ ...form, low_stock_threshold: n })} /></div>
                <div className="form-row"><label>Taux TVA %</label><NumberField value={form.tax_rate} onValueChange={(n) => setForm({ ...form, tax_rate: n })} placeholder="Défaut" /></div>
              </div>
            )}
            <div className="form-row">
              <label><input type="checkbox" checked={form.track_inventory} onChange={(e) => setForm({ ...form, track_inventory: e.target.checked ? 1 : 0 })} style={{ width: 'auto', display: 'inline', marginRight: 8 }} />Suivre le stock pour ce produit</label>
            </div>
            <h3 style={{ fontSize: 13, margin: '12px 0 6px' }}>Remises volume (bulk discount)</h3>
            <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
              Si la quantité sur facture/devis atteint le seuil et qu&apos;aucun prix promo manuel n&apos;est saisi, la remise s&apos;applique automatiquement.
            </p>
            <div className="grid grid-2">
              <div className="form-row"><label>Palier 1 — Qté min</label><NumberField value={form.bulk_qty_1} onValueChange={(n) => setForm({ ...form, bulk_qty_1: n })} placeholder="ex. 10" /></div>
              <div className="form-row"><label>Palier 1 — Remise %</label><NumberField value={form.bulk_pct_1} onValueChange={(n) => setForm({ ...form, bulk_pct_1: n })} min={0} max={100} step="0.1" placeholder="ex. 5" /></div>
            </div>
            <div className="grid grid-2">
              <div className="form-row"><label>Palier 2 — Qté min</label><NumberField value={form.bulk_qty_2} onValueChange={(n) => setForm({ ...form, bulk_qty_2: n })} placeholder="ex. 50" /></div>
              <div className="form-row"><label>Palier 2 — Remise %</label><NumberField value={form.bulk_pct_2} onValueChange={(n) => setForm({ ...form, bulk_pct_2: n })} min={0} max={100} step="0.1" placeholder="ex. 10" /></div>
            </div>

            {editing && (
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border, #e0d9cc)' }}>
                <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Variantes (taille / couleur / etc.)</h3>
                <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
                  Chaque variante a son propre SKU, code-barres et stock — idéal pour le scan mobile.
                </p>
                {variants.length > 0 && (
                  <div className="table-wrap" style={{ marginBottom: 10, maxHeight: 180, overflow: 'auto' }}>
                    <table style={{ fontSize: 12 }}>
                      <thead>
                        <tr>
                          <th>Libellé</th>
                          <th>SKU</th>
                          <th>Code-barres</th>
                          <th>Prix</th>
                          <th>Stock</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {variants.map((v) => (
                          <tr key={v.id}>
                            <td><strong>{v.variant_label || v.name}</strong></td>
                            <td>{v.sku || '—'}</td>
                            <td>{v.barcode || '—'}</td>
                            <td>{Math.round(Number(v.price || 0)).toLocaleString("fr-FR")}</td>
                            <td>{v.track_inventory ? v.stock_quantity : '—'}</td>
                            <td>
                              <button type="button" className="danger" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => removeVariant(v.id)}>×</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="grid grid-2">
                  <div className="form-row"><label>Libellé *</label><input value={variantForm.variant_label} onChange={(e) => setVariantForm({ ...variantForm, variant_label: e.target.value })} placeholder="ex. M / Rouge" /></div>
                  <div className="form-row"><label>SKU</label><input value={variantForm.sku} onChange={(e) => setVariantForm({ ...variantForm, sku: e.target.value })} /></div>
                </div>
                <div className="grid grid-3">
                  <div className="form-row"><label>Code-barres</label><input value={variantForm.barcode} onChange={(e) => setVariantForm({ ...variantForm, barcode: e.target.value })} placeholder="Scan / saisie" /></div>
                  <div className="form-row"><label>Prix</label><NumberField value={variantForm.price} onValueChange={(n) => setVariantForm({ ...variantForm, price: n })} /></div>
                  <div className="form-row"><label>Stock initial</label><NumberField value={variantForm.stock_quantity} onValueChange={(n) => setVariantForm({ ...variantForm, stock_quantity: n })} /></div>
                </div>
                <button type="button" className="secondary" style={{ marginBottom: 8 }} onClick={saveVariant} disabled={savingVariant}>
                  {savingVariant ? 'Ajout…' : '+ Ajouter la variante'}
                </button>
              </div>
            )}

            {editing?.id ? <ProductImageEditor productId={Number(editing.id)} /> : (
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>
                Enregistrez le produit pour ajouter, recadrer et tourner des photos.
              </p>
            )}

            <div className="form-actions">
              {firstError(fieldErrors) && <span className="save-error-inline">{firstError(fieldErrors)}</span>}
              <button onClick={() => save()} disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
              <button className="secondary" onClick={() => setShow(false)}>Annuler</button>
            </div>
          </div>
        </div>
      )}

      {adjustProduct && (
        <div className="modal-overlay" onClick={() => setAdjustProduct(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2>Ajuster le stock — {adjustProduct.name}</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Stock actuel : <strong>{adjustProduct.stock_quantity}</strong></p>
            <div className="form-row">
              <label>Type d'ajustement</label>
              <select value={adjustType} onChange={(e) => setAdjustType(e.target.value)}>
                <option value="in">Entrée stock (+)</option>
                <option value="out">Sortie stock (−)</option>
                <option value="adjustment">Ajustement manuel</option>
              </select>
            </div>
            <div className="form-row"><label>Quantité</label><NumberField value={adjustQty} onValueChange={setAdjustQty} min={0.01} step="0.01" /></div>
            <div className="form-row"><label>Raison</label><input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="ex. Réception marchandise, casse, correction..." /></div>
            <div className="form-actions">
              <button onClick={doAdjust} disabled={saving}>{saving ? 'Enregistrement...' : 'Ajuster le stock'}</button>
              <button className="secondary" onClick={() => setAdjustProduct(null)}>Annuler</button>
            </div>
          </div>
        </div>
      )}

      {pwOpen && pendingAction && (
        <PasswordConfirm
          open={pwOpen}
          title={pwTitle}
          description={pwDesc}
          confirmLabel="Confirmer"
          onCancel={() => { setPwOpen(false); setPendingAction(null); }}
          onConfirm={async (password) => { await pendingAction(password); }}
        />
      )}
    </div>
  );
}
