import { onAgentDraft } from '../lib/agentDraft';
import { useNavigate, useLocation } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import DatePicker from '../components/DatePicker';
import { draftProductFromFile } from '../lib/assist';
import { validateProductForm, firstError } from '../lib/formValidate';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ListPager } from '../components/ui/ListPager';
import { createPortal } from 'react-dom';
import { useDebouncedValue } from '../lib/perf';
import { api } from '../api';
import SaveFeedback from '../components/SaveFeedback';
import { openReport } from '../lib/reports';
import { downloadExport } from '../lib/export';
import { useUi } from '../components/AppDialogs';
import { TimedUndoDelete, RunActionButton, EXPORT_CSV_STEPS } from '../components/ui';
import { numStr, numFromInput } from '../lib/numInput';
import NumberField from '../components/NumberField';
import VirtualTableBody, { VirtualScroll } from '../components/VirtualTableBody';
import { isStockRole } from '../auth';
import ProductImageEditor from '../components/ProductImageEditor';
import { printProductLabel } from '../lib/printProductLabel';
import { KitsPanel } from '../components/atlas-v209-panels';
import RefreshIconButton from '../components/RefreshIconButton';
import '../components/erp/catalog-inventory.css';
import { FloatingPortal } from '../components/FloatingPortal';
import { ModalFormError, FieldHint } from '../components/ModalFormFeedback';

export default function Products() {
  const navigate = useNavigate();
  const [modalError, setModalError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
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
  const [saveMsg, setSaveMsg] = useState('');
  const [saveMsgType, setSaveMsgType] = useState<'success' | 'error'>('success');
  const [adjustProduct, setAdjustProduct] = useState<any>(null);
  const [adjustQty, setAdjustQty] = useState(1);
  const [adjustType, setAdjustType] = useState('in');
  const [adjustReason, setAdjustReason] = useState('');
  const [movements, setMovements] = useState<any[] | null>(null);
  const [movementsFor, setMovementsFor] = useState<number | null>(null);
  const [movementsPage, setMovementsPage] = useState(1);
  const [reorderSuggestions, setReorderSuggestions] = useState<any[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deleteTargets, setDeleteTargets] = useState<number[] | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
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
  
  useEffect(() => {
    const onLists = () => {
      try { load(true); } catch { /* */ }
    };
    window.addEventListener('atlas-lists-refresh', onLists as EventListener);
    return () => window.removeEventListener('atlas-lists-refresh', onLists as EventListener);
  }, []);

  

  
  useEffect(() => {
    return onAgentDraft((d) => {
      if (d.entity && d.entity !== 'product') return;
      
      const pre = (d.prefill || {}) as any;
      setEditing(null);
      setForm((f: any) => ({
        ...emptyForm,
        ...f,
        name: pre.name ?? '',
        price: pre.price != null ? Number(pre.price) : 0,
        stock_quantity: pre.stock_quantity != null ? Number(pre.stock_quantity) : 0,
        sku: pre.sku ?? '',
      }));
      setModalError('');
      setShow(true);

    });
  }, []);

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
    setModalError(''); setShow(true);
  };
  // Scan page → "Créer produit" on an open creation request: open the form
  // with the scanned barcode (and optional name) prefilled. Price stays empty
  // for the PC user to complete.
  const location = useLocation();
  const reqPrefillDone = useRef(false);
  useEffect(() => {
    const st = location.state as {
      newWithBarcode?: string; newWithName?: string; newWithSku?: string;
      newWithUnit?: string; newWithQuantity?: number; newWithCategory?: string;
    } | null;
    if (reqPrefillDone.current || !st?.newWithBarcode) return;
    reqPrefillDone.current = true;
    setForm({
      ...emptyForm,
      barcode: String(st.newWithBarcode || ''),
      sku: String(st.newWithSku || st.newWithBarcode || ''),
      name: String(st.newWithName || ''),
      unit: String(st.newWithUnit || 'unité'),
      stock_quantity: Number(st.newWithQuantity || 0),
      category: String(st.newWithCategory || 'Général'),
    });
    setEditing(null);
    setVariants([]);
    setVariantForm({ variant_label: '', sku: '', barcode: '', price: '', stock_quantity: '0' });
    setModalError(''); setShow(true);
    window.history.replaceState({}, '');
  }, [location.state]);
  const openEdit = async (p: any) => {
    setForm({ ...p, tax_rate: p.tax_rate ?? '', ...parseBulkFromProduct(p) });
    setEditing(p);
    setVariantForm({ variant_label: '', sku: '', barcode: '', price: String(p.price ?? ''), stock_quantity: '0' });
    setModalError(''); setShow(true);
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
    if (Object.keys(fe).length) return; // erreurs affichées sous chaque champ
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
    // Do NOT mark rows as selected — only arm timed delete
    setDeleteTargets(targetIds);
  };

  const confirmDeleteTargets = async () => {
    if (!deleteTargets?.length || deleteBusy) return;
    setDeleteBusy(true);
    try {
      const res =
        deleteTargets.length === 1
          ? await api.deleteProduct(deleteTargets[0], undefined, { timedUndo: true })
          : await api.bulkDeleteProducts(deleteTargets, undefined, { timedUndo: true });
      flash((res as any).message || 'Produit(s) supprimé(s).');
      setDeleteTargets(null);
      setSelected(new Set());
      load(true);
    } catch (e: any) {
      flash(e?.message || 'Suppression impossible', 'error');
    } finally {
      setDeleteBusy(false);
    }
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
    setMovementsFor(id);
    setMovements(null);
    setMovementsPage(1);
    try {
      const res = await api.getProductMovements(id, 200);
      const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
      const rows = (res.data || []).filter((m: any) => {
        const ts = Date.parse(String(m.created_at || m.date || ''));
        return !ts || ts >= cutoff;
      });
      setMovements(rows);
    } catch {
      setMovements([]);
    }
  };

  const fmtMovType = (raw: string) => {
    const s = String(raw || '').toLowerCase();
    if (s.includes('sale') || s === 'out') return 'Vente';
    if (s.includes('restock') || s.includes('in') || s === 'in') return 'Entrée';
    if (s.includes('adjust')) return 'Ajustement';
    if (s.includes('transfer')) return 'Transfert';
    return raw || '—';
  };
  const fmtMovReason = (raw: string) => {
    let s = String(raw || '');
    s = s.replace(/Invoice cancelled \(restock\)/gi, 'Facture annulée (retour stock)');
    s = s.replace(/Ticket VR \/ facture deleted \(restock\)/gi, 'Ticket / facture supprimé (retour stock)');
    s = s.replace(/Invoice/gi, 'Facture');
    s = s.replace(/restock/gi, 'retour stock');
    return s || '—';
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

  if (loading) {
    return (
      <div className="atlas-page ac-dash products-page">
        <div className="ac-metric-grid">
          {[1,2,3,4,5,6].map((i) => (
            <div key={i} className="ac-metric skeleton" style={{ minHeight: 88 }} />
          ))}
        </div>
        <div className="skeleton" style={{ height: 320, borderRadius: 16, marginTop: 12 }} />
      </div>
    );
  }

  const catalogKpis = (() => {
    const tracked = list.filter((p) => p.track_inventory);
    const low = tracked.filter((p) => Number(p.stock_quantity) > 0 && Number(p.stock_quantity) <= Number(p.low_stock_threshold || 0)).length;
    const out = tracked.filter((p) => Number(p.stock_quantity) === 0).length;
    const ok = tracked.filter((p) => Number(p.stock_quantity) > Number(p.low_stock_threshold || 0)).length;
    const skus = list.filter((p) => p.sku || p.barcode).length;
    return { n: list.length, low, out, ok, skus, shown: filtered.length };
  })();

  return (
    <div className="atlas-catalog ac-products">
      <div className="page-header ac-page-header">
        <div>
          <p className="ac-dash-eyebrow">Catalogue</p>
          <h1 className="ac-dash-hello" style={{ fontSize: '1.5rem' }}>Produits &amp; stock</h1>
          <p className="ac-dash-lead">Références, seuils et mouvements de stock.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <RefreshIconButton onClick={() => load(true)} loading={refreshing} />
          {selected.size > 0 && (
            <TimedUndoDelete
              deleteLabel={selected.size === 1 ? 'Supprimer' : `Supprimer (${selected.size})`}
              undoLabel="Annuler"
              initialSeconds={10}
              onConfirm={async () => {
                const targets = Array.from(selected);
                if (!targets.length) return;
                setDeleteTargets(targets);
                // delete immediately after timer (targets set synchronously before confirm runs async)
                try {
                  setDeleteBusy(true);
                  if (targets.length === 1) await api.deleteProduct(targets[0], undefined, { timedUndo: true });
                  else await api.bulkDeleteProducts(targets, undefined, { timedUndo: true });
                  setSelected(new Set());
                  setDeleteTargets(null);
                  await load(true);
                } catch (e: any) {
                  flash(e?.message || 'Suppression impossible', 'error');
                } finally {
                  setDeleteBusy(false);
                }
              }}
            />
          )}
          <button className="secondary" onClick={() => openReport('/api/reports/stock')}>Voir le stock (PDF)</button>
          <button type="button" className="secondary" onClick={async () => {
            try {
              const r = await api.getReorderSuggestions(40);
              setReorderSuggestions(r.data || []);
            } catch (e: any) {
              flash(e?.message || 'Réassort impossible', 'error');
            }
          }}>Suggestions de réassort</button>
          <RunActionButton
            size="sm"
            idleLabel="Excel CSV"
            doneLabel="Téléchargé"
            steps={EXPORT_CSV_STEPS}
            onRun={async () => {
              setExportBusy(true);
              try {
                await downloadExport('/api/export/products', 'produits.csv');
              } finally {
                setExportBusy(false);
              }
            }}
          />
          <button onClick={openNew}>Ajouter un produit</button>
        </div>
      </div>

      <SaveFeedback message={saveMsg} type={saveMsgType} />

      
      <div className="ac-metric-grid ac-metric-grid--6 ac-products-kpis">
        <div className="ac-metric">
          <div className="as-label">Produits</div>
          <div className="as-value">{catalogKpis.n}</div>
          <div className="as-hint">catalogue total</div>
        </div>
        <div className="ac-metric">
          <div className="as-label">Affichés</div>
          <div className="as-value">{catalogKpis.shown}</div>
          <div className="as-hint">filtre actuel</div>
        </div>
        <div className="ac-metric">
          <div className="as-label">SKU / CB</div>
          <div className="as-value">{catalogKpis.skus}</div>
          <div className="as-hint">références</div>
        </div>
        <div className="ac-metric ac-metric--ok">
          <div className="as-label">OK</div>
          <div className="as-value">{catalogKpis.ok}</div>
          <div className="as-hint">au-dessus du seuil</div>
        </div>
        <div className="ac-metric ac-metric--warn">
          <div className="as-label">Stock bas</div>
          <div className="as-value">{catalogKpis.low}</div>
          <div className="as-hint">≤ seuil</div>
        </div>
        <div className="ac-metric ac-metric--danger">
          <div className="as-label">Rupture</div>
          <div className="as-value">{catalogKpis.out}</div>
          <div className="as-hint">quantité 0</div>
        </div>
      </div>

      <div className="ac-panel ac-products-filters">
        <div className="ac-products-filters-row">
          <div className="ac-search-field">
            <svg className="ac-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" strokeLinecap="round" />
            </svg>
            <input
              className="ac-search-input"
              placeholder="Nom, référence ou code-barres…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Rechercher produits"
            />
          </div>
          <select className="ac-filter-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Catégorie">
            <option value="">Toutes catégories</option>
            {categories.map((c) => (
              <option key={c.id ?? c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
          <select className="ac-filter-select" value={stockFilter} onChange={(e) => setStockFilter(e.target.value)} aria-label="Niveau de stock">
            <option value="">Tous les niveaux</option>
            <option value="ok">En stock</option>
            <option value="low">Stock bas</option>
            <option value="out">Rupture</option>
          </select>
        </div>
        <div className="atlas-catalog-legend ac-products-legend">
          <span><span className="stock-pill ok">OK</span> au-dessus du seuil</span>
          <span><span className="stock-pill low">Bas</span> ≤ seuil</span>
          <span><span className="stock-pill out">Rupture</span> qty 0</span>
        </div>
      </div>

      <div className="ac-panel ac-products-table-panel">

        {reorderSuggestions && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <strong>Suggestions de réassort</strong>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
                  Basé sur ventes 30 jours et stock (couverture &lt; 14 j ou sous seuil)
                </p>
              </div>
              <button type="button" className="secondary" onClick={() => setReorderSuggestions(null)}>Fermer</button>
            </div>
            {reorderSuggestions.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--muted)' }}>Aucun produit à réapprovisionner pour le moment.</p>
            ) : (
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Produit</th>
                      <th>Stock</th>
                      <th>Ventes 30j</th>
                      <th>Couverture</th>
                      <th>Qté suggérée</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reorderSuggestions.map((r) => (
                      <tr key={r.product_id}>
                        <td>{r.name}{r.sku ? ` · ${r.sku}` : ''}</td>
                        <td>{r.stock}</td>
                        <td>{r.sold_30d}</td>
                        <td>{r.days_cover === 999 ? '—' : `${r.days_cover} j`}</td>
                        <td><strong>{r.suggest_qty}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        <VirtualScroll maxHeight={filtered.length > 60 ? 560 : undefined}>
          <table className="data-dense ac-products-table">
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
                      actionLabel="Ajouter mon premier produit"
                      onAction={() => { setEditing(null); setForm(emptyForm); setModalError(''); setShow(true); }}
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
                    <td className="row-actions-cell">
                      <div className="row-actions row-actions--inline">
                      {p.track_inventory && <button type="button" className="secondary" onClick={() => setAdjustProduct(p)}>Ajuster</button>}
                      <button type="button" className="secondary" onClick={() => loadMovements(p.id)}>Historique</button>
                      <button type="button" className="secondary" onClick={() => openEdit(p)}>Modifier</button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => window.open(api.labelUrl(p.id), '_blank', 'noopener')}
                      >
                        Étiquette
                      </button>
                      <TimedUndoDelete
                        key={`del-${p.id}`}
                        deleteLabel="Supprimer"
                        undoLabel="Annuler"
                        initialSeconds={10}
                        onConfirm={async () => {
                          try {
                            setDeleteBusy(true);
                            await api.deleteProduct(p.id, undefined, { timedUndo: true });
                            setSelected((prev) => {
                              const n = new Set(prev);
                              n.delete(p.id);
                              return n;
                            });
                            await load(true);
                          } catch (e: any) {
                            flash(e?.message || 'Suppression impossible', 'error');
                          } finally {
                            setDeleteBusy(false);
                          }
                        }}
                      />
                      </div>
                    </td>
                  </tr>
                )}
              />
            )}
          </table>
        </VirtualScroll>
        {movementsFor != null &&
          createPortal(
            <div
              className="modal-overlay"
              style={{ zIndex: 10000 }}
              onClick={() => {
                setMovementsFor(null);
                setMovements(null);
              }}
            >
              <div
                className="modal"
                style={{
                  width: 'max-content',
                  maxWidth: 'min(960px, 94vw)',
                  minWidth: 'min(320px, 94vw)',
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <h2>Historique des mouvements</h2>
                <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: -8, marginBottom: 16 }}>
                  Produit #{movementsFor} · 90 derniers jours
                  {movements && movements.length > 0
                    ? ` · ${movements.length} mouvement${movements.length > 1 ? 's' : ''}`
                    : ''}
                </p>
                {!movements ? (
                  <div className="empty" style={{ padding: 16 }}>
                    Chargement…
                  </div>
                ) : movements.length === 0 ? (
                  <div className="empty" style={{ padding: 16 }}>
                    Aucun mouvement sur 90 jours
                  </div>
                ) : (
                  <>
                    <div style={{ overflowX: 'hidden' }}>
                      <table style={{ width: '100%', tableLayout: 'auto' }}>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Type</th>
                            <th>Qté</th>
                            <th>Avant</th>
                            <th>Après</th>
                            <th>Raison</th>
                            <th>Réf.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {movements
                            .slice((movementsPage - 1) * 20, movementsPage * 20)
                            .map((mv: any, i: number) => (
                              <tr key={mv.id || i}>
                                <td style={{ whiteSpace: 'nowrap' }}>
                                  {String(mv.created_at || '—').replace('T', ' ').slice(0, 16)}
                                </td>
                                <td>{fmtMovType(mv.type)}</td>
                                <td>{mv.quantity ?? '—'}</td>
                                <td>{mv.previous_quantity ?? '—'}</td>
                                <td>
                                  <strong>{mv.new_quantity ?? '—'}</strong>
                                </td>
                                <td style={{ maxWidth: 220, wordBreak: 'break-word' }}>
                                  {fmtMovReason(mv.reason || '')}
                                </td>
                                <td style={{ whiteSpace: 'nowrap' }}>{mv.reference || '—'}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                    {movements.length > 20 && (
                      <div style={{ display: 'flex', justifyContent: 'center', marginTop: 14 }}>
                        <ListPager
                          page={movementsPage}
                          pageSize={20}
                          total={movements.length}
                          onPageChange={setMovementsPage}
                          pageBase={1}
                        />
                      </div>
                    )}
                  </>
                )}
                <ModalFormError message={modalError} />
            <div className="form-actions" style={{ marginTop: 16, displayContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      const id = movementsFor;
                      setMovementsFor(null);
                      setMovements(null);
                      if (id != null) navigate(`/products/${id}/historique`);
                    }}
                  >
                    Voir plus — historique complet
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setMovementsFor(null);
                      setMovements(null);
                    }}
                  >
                    Fermer
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )}
      </div>

      {show && (
        <FloatingPortal><div className="modal-overlay" onClick={() => { setShow(false); setForm(emptyForm); setEditing(null); setModalError(''); }}>
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
              <div className="form-row"><label>Date limite (DLC)</label><DatePicker value={(form.expiry_date || '').toString().slice(0, 10)} onChange={(v) => setForm({ ...form, expiry_date: v })} /></div>
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

            <ModalFormError message={modalError} />
            {/* Same pinned action bar as every other form */}
            <div className="wizard-foot">
              <div className="wizard-foot-nav">
                {firstError(fieldErrors) ? (
                  <span className="wizard-foot-step save-error-inline">{firstError(fieldErrors)}</span>
                ) : (
                  <span className="wizard-foot-step">Fiche produit</span>
                )}
                <div className="wizard-foot-actions">
                  <button className="secondary" onClick={() => { setShow(false); setForm(emptyForm); setEditing(null); setModalError(''); }}>Annuler</button>
                  <button onClick={() => save()} disabled={saving}>
                    {saving ? 'Enregistrement…' : 'Enregistrer'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div></FloatingPortal>
      )}

      {adjustProduct && (
        <FloatingPortal><div className="modal-overlay" onClick={() => setAdjustProduct(null)}>
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
            <ModalFormError message={modalError} />
            <div className="form-actions">
              <button onClick={doAdjust} disabled={saving}>{saving ? 'Enregistrement...' : 'Ajuster le stock'}</button>
              <button className="secondary" onClick={() => setAdjustProduct(null)}>Annuler</button>
            </div>
          </div>
        </div></FloatingPortal>
      )}
      <KitsPanel />
    </div>
  );
}
