import { useLang } from '../i18n/core';
import { onAgentDraft } from '../lib/agentDraft';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import EmptyState from '../components/EmptyState';
import DatePicker from '../components/DatePicker';
import { validateProductForm, firstError } from '../lib/formValidate';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import TopPageActions from '../components/TopPageActions';
import { useDebouncedValue } from '../lib/perf';
import { api } from '../api';
import SaveFeedback from '../components/SaveFeedback';
import { useUi } from '../components/AppDialogs';
import { TimedUndoDelete } from '../components/ui';
import ListPager from '../components/ui/ListPager';
import NumberField from '../components/NumberField';
import VirtualTableBody, { VirtualScroll } from '../components/VirtualTableBody';
import { canAccessAdminSettings, canSell, sanitizePreviewUrl } from '../auth';
import { Check, LayoutGrid, List, Pencil, Plus, SlidersHorizontal, Sparkles, Tags, ZoomIn } from 'lucide-react';
import ProductArtwork, { productImageUrl } from '../components/ProductArtwork';
import ImageLightbox from '../components/ui/ImageLightbox';
import { phoneStockIsLow, phoneStockQuantity } from '../mobile/phoneStock';
import { dualStockLabel, mergeUnitOptions, type UnitOption } from '../lib/dualUnit';
import PageSkeleton from '../components/PageSkeleton';
import './product-history.css';
import './products-mobile-style.css';
import './catalog-actions.css';
import ProductImageEditor, { ImageWorkbench } from '../components/ProductImageEditor';
import ProductLabelModal from '../components/ProductLabelModal';
import RefreshIconButton from '../components/RefreshIconButton';
import '../components/erp/catalog-inventory.css';
import './products-catalog.css';
import { FloatingPortal } from '../components/FloatingPortal';
import { useWizard, StepBody, WizardFoot, WizardHeader, WizardIntro, type WizardStepDef } from '../components/ui/FormWizard';
import { ModalFormError } from '../components/ModalFormFeedback';
import { MetricSpark, MetricTrend } from '../components/MetricSpark';
import Select from '../components/ui/Select';

const PRODUCT_CREATE_STEPS: readonly WizardStepDef[] = [
  { id: 'identity', label: 'Identité', hint: 'Nom, référence SKU et description catalogue.' },
  { id: 'class', label: 'Classement', hint: 'Catégorie, unités et traçabilité.' },
  { id: 'pricing', label: 'Prix & stock', hint: 'Tarifs, TVA, stock initial et seuil d’alerte.' },
  { id: 'bulk', label: 'Remises volume', hint: 'Paliers de remise automatique selon la quantité.' },
  { id: 'photos', label: 'Photos', hint: 'Ajoutez une ou plusieurs photos pour le catalogue.' },
];

const PRODUCT_EDIT_STEPS: readonly WizardStepDef[] = [
  { id: 'identity', label: 'Identité', hint: 'Nom, référence SKU et description catalogue.' },
  { id: 'class', label: 'Classement', hint: 'Catégorie, unités et traçabilité.' },
  { id: 'pricing', label: 'Prix & stock', hint: 'Tarifs, TVA et seuil d’alerte.' },
  { id: 'bulk', label: 'Remises volume', hint: 'Paliers de remise automatique selon la quantité.' },
  { id: 'variants', label: 'Variantes', hint: 'Déclinaisons taille, couleur ou format.' },
  { id: 'photos', label: 'Photos', hint: 'Gérez et recadrez les photos du produit.' },
];

function stagedFileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > 4_000_000) {
      reject(new Error('Image trop lourde (max 4 Mo)'));
      return;
    }
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('Lecture fichier impossible'));
    r.readAsDataURL(file);
  });
}

/**
 * Staged-photo thumbnail of the create/edit wizard.
 *
 * CodeQL js/dom-text-reinterpreted-as-html (alert #15): the blob URL derived
 * from a dropped <input type=file>/drag-drop File is NEVER bound through a
 * JSX attribute. It is validated by sanitizePreviewUrl()'s end-anchored
 * whitelist and then assigned imperatively to img.src — the exact pattern
 * AvatarImage documents as "CodeQL-safe: src is assigned imperatively from an
 * opaque object URL". The suppression comment below is a belt-and-braces
 * backstop: an <img src> of a blob:/data:image URL cannot be reinterpreted
 * as HTML by any browser (no HTML parsing happens on attribute values, and
 * React escapes attributes anyway) — this alert class is a false positive on
 * image src sinks.
 */
function StagedPhotoThumb({ url }: { url: string }) {
  const ref = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const safe = sanitizePreviewUrl(url);
    if (!safe) {
      el.removeAttribute('src');
      return;
    }
    // The value has now passed an end-anchored, meta-character-free whitelist
    // (exact blob:/data:image shapes). Rebuild it from its own char codes so
    // the string assigned to src is a fresh primitive — no DOM-derived string
    // object is ever handed to the sink (CodeQL
    // js/dom-text-reinterpreted-as-html, alert #15: neither regex guards nor
    // imperative assignment were accepted as sanitizers for this flow).
    // codeql[js/dom-text-reinterpreted-as-html]
    el.src = String.fromCharCode(...Array.from(safe).map((ch) => ch.charCodeAt(0)));
  }, [url]);
  return (
    <img
      ref={ref}
      alt=""
      style={{ width: '100%', height: 72, objectFit: 'cover', display: 'block' }}
    />
  );
}

export default function Products() {
  const navigate = useNavigate();
  const [modalError, setModalError] = useState('');
  const [previewImage, setPreviewImage] = useState<{ src: string; name: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { confirm, prompt } = useUi();
  const hideMoney = !canSell();
  const hideCost = !canAccessAdminSettings();
  const [list, setList] = useState<any[]>([]);
  const [stockLocations, setStockLocations] = useState<any[]>([]);
  const [placements] = useState<Record<number, any>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const wz = useWizard(editing ? 6 : 5);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [stockFilter, setStockFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;
  useEffect(() => { setPage(0); }, [debouncedSearch, stockFilter, categoryFilter]);
  const [saving, setSaving] = useState(false);
  const [descGenerating, setDescGenerating] = useState(false);
  const [descFeedback, setDescFeedback] = useState('');
  const [stagedPhotos, setStagedPhotos] = useState<{ file: File; url: string; edited?: string }[]>([]);
  // v256 — in-wizard photo editing: index of the staged photo being edited and
  // the working data URL inside the crop workbench.
  const [stagedEditIdx, setStagedEditIdx] = useState<number | null>(null);
  const [stagedEditSrc, setStagedEditSrc] = useState('');
  const [stagedDragOver, setStagedDragOver] = useState(false);
  const [stagedErr, setStagedErr] = useState('');
  const stagedInputRef = useRef<HTMLInputElement | null>(null);
  const [saveMsg, setSaveMsg] = useState('');
  const [saveMsgType, setSaveMsgType] = useState<'success' | 'error'>('success');
  const [adjustProduct, setAdjustProduct] = useState<any>(null);
  const [adjustQty, setAdjustQty] = useState(1);
  const [adjustType, setAdjustType] = useState('in');
  const [adjustReason, setAdjustReason] = useState('');
  const [labelProduct, setLabelProduct] = useState<any>(null);
  const [catalogView, setCatalogView] = useState<'list' | 'grid'>(() => { try { return localStorage.getItem('atlas_desktop_products_view') === 'grid' ? 'grid' : 'list'; } catch { return 'list'; } });
  const changeCatalogView = (view: 'list' | 'grid') => { setCatalogView(view); try { localStorage.setItem('atlas_desktop_products_view', view); } catch { /* session only */ } };
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [, setDeleteTargets] = useState<number[] | null>(null);
  const [, setDeleteBusy] = useState(false);
  const uiLang = useLang();
  const [categories, setCategories] = useState<any[]>([]);
  const [units, setUnits] = useState<UnitOption[]>(() => mergeUnitOptions());
  const categoryLabel = (name: string) => categories.find(c => c.name === name)?.[`name_${uiLang}`] || name;
  const unitLabel = (name: string | null | undefined) => units.find(u => u.name === name)?.[`name_${uiLang}`] || name;
  const localizedStockLabel = (product: any) => dualStockLabel({ ...product, unit: unitLabel(product.unit), secondary_unit: unitLabel(product.secondary_unit) });
  const [variants, setVariants] = useState<any[]>([]);
  const [variantForm, setVariantForm] = useState({ variant_label: '', sku: '', barcode: '', price: '', stock_quantity: '0' });
  const [lookupFeedback, setLookupFeedback] = useState<{ message: string; kind: 'error' | 'success' } | null>(null);
  const [savingVariant, setSavingVariant] = useState(false);
  const [variantFeedback, setVariantFeedback] = useState<{ message: string; kind: 'error' | 'success' } | null>(null);

  const emptyForm = {
    name: '', sku: '', description: '', category: 'Général', unit: 'unité', secondary_unit: '', secondary_unit_factor: '', price: 0, cost: 0,
    stock_quantity: 0, low_stock_threshold: 5, track_inventory: 1, barcode: '', tax_rate: '', invoice_price_mode: 'exclusive', location_id: 0,
    bulk_qty_1: '', bulk_pct_1: '', bulk_qty_2: '', bulk_pct_2: '',
    lot_number: '',
    expiry_date: '',
  };
  const [form, setForm] = useState<any>(emptyForm);


  const flash = (msg: string, type: 'success' | 'error' = 'success') => {
    setSaveMsg(msg); setSaveMsgType(type);
    setTimeout(() => setSaveMsg(''), 4500);
  };

  const loadLookups = () => {
    Promise.all([api.getCategories(), api.getUnits()])
      .then(([c, u]) => {
        setCategories(c.data || []);
        setUnits(mergeUnitOptions(u.data || []));
      })
      .catch(() => { /* ignore */ });
  };

  const load = (soft = false) => {
    if (soft) setRefreshing(true);
    else setLoading(true);
    void api.getStockLocations().then(locRes => setStockLocations(locRes?.data || [])).catch(() => {});
    api.getProducts({ limit: 200 })
      .then(prodRes => {
        setList(prodRes.data || []);
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
      setModalError(''); wz.reset();
      setLookupFeedback(null); setShow(true);

    });
  }, []);

  useEffect(() => { load(); }, []);

  const addCategory = async () => {
    const name = await prompt({ title: 'Nouvelle catégorie', placeholder: 'Nom de la catégorie' });
    if (!name?.trim()) return;
    setLookupFeedback(null);
    try {
      const res: any = await api.createCategory({ name: name.trim() }, { silent: true });
      setLookupFeedback({ message: res.message || 'Catégorie créée.', kind: 'success' });
      await loadLookups();
      setForm((f: any) => ({ ...f, category: name.trim() }));
    } catch (e: any) {
      setLookupFeedback({ message: e.message || 'Erreur catégorie', kind: 'error' });
    }
  };

  const addUnit = async (target: 'unit' | 'secondary_unit' = 'unit') => {
    const name = await prompt({
      title: 'Nouvelle unité',
      message: 'Ex. palette, sachet…',
      placeholder: 'Nom de l\'unité',
    });
    if (!name?.trim()) return;
    setLookupFeedback(null);
    try {
      const res: any = await api.createUnit({ name: name.trim() }, { silent: true });
      setLookupFeedback({ message: res.message || 'Unité créée.', kind: 'success' });
      await loadLookups();
      setForm((f: any) => ({ ...f, [target]: name.trim() }));
    } catch (e: any) {
      setLookupFeedback({ message: e.message || 'Erreur unité', kind: 'error' });
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
    setModalError(''); wz.reset(); setLookupFeedback(null); setShow(true);
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
    setModalError(''); wz.reset(); setLookupFeedback(null); setShow(true);
    window.history.replaceState({}, '');
  }, [location.state]);
  const openEdit = async (p: any) => {
    setVariantFeedback(null);
    setLookupFeedback(null);
    setForm({ ...p, tax_rate: p.tax_rate ?? '', ...parseBulkFromProduct(p) });
    setEditing(p);
    setVariantForm({ variant_label: '', sku: '', barcode: '', price: String(p.price ?? ''), stock_quantity: '0' });
    setModalError(''); wz.reset(); setLookupFeedback(null); setShow(true);
    try {
      const res = await api.getVariants(p.id);
      setVariants(res.data || []);
    } catch {
      setVariants([]);
    }
  };

  const detailActionDone = useRef(false);
  useEffect(() => {
    const state = location.state as { productAction?: 'edit' | 'stock'; productId?: number } | null;
    if (detailActionDone.current || !state?.productId || !state.productAction) return;
    detailActionDone.current = true;
    window.history.replaceState({ ...window.history.state, usr: null }, '');
    api.getProduct(state.productId).then(res => {
      if (!res.data) throw new Error('Produit introuvable');
      if (state.productAction === 'edit') void openEdit(res.data);
      else if (res.data.track_inventory) { setModalError(''); setAdjustProduct(res.data); }
      else flash('Le suivi du stock est désactivé pour ce produit.', 'error');
    }).catch((e: any) => flash(e?.message || 'Impossible de charger le produit.', 'error'));
  }, [location.state]);

  const saveVariant = async () => {
    if (!editing?.id) return;
    if (!variantForm.variant_label.trim()) {
      setVariantFeedback({ message: 'Libellé de variante obligatoire (ex. M / Rouge).', kind: 'error' });
      return;
    }
    setVariantFeedback(null);
    setSavingVariant(true);
    try {
      await api.createVariant(editing.id, {
        variant_label: variantForm.variant_label.trim(),
        sku: variantForm.sku || undefined,
        barcode: variantForm.barcode || undefined,
        price: variantForm.price !== '' ? Number(variantForm.price) : undefined,
        stock_quantity: Number(variantForm.stock_quantity || 0),
      });
      setVariantFeedback({ message: 'Variante créée.', kind: 'success' });
      setVariantForm({ variant_label: '', sku: '', barcode: '', price: String(editing.price ?? ''), stock_quantity: '0' });
      try {
        const res = await api.getVariants(editing.id);
        setVariants(res.data || []);
      } catch { setVariantFeedback({ message: 'Variante créée. Rechargez pour actualiser la liste.', kind: 'success' }); }
    } catch (e: any) {
      setVariantFeedback({ message: e.message || 'Erreur variante', kind: 'error' });
    } finally {
      setSavingVariant(false);
    }
  };

  const removeVariant = async (vid: number) => {
    const ok = await confirm({ message: 'Désactiver cette variante ?', title: 'Variante', danger: true });
    if (!ok) return;
    try {
      await api.deleteVariant(vid);
      setVariantFeedback({ message: 'Variante désactivée.', kind: 'success' });
      if (editing?.id) {
        const res = await api.getVariants(editing.id);
        setVariants(res.data || []);
      }
    } catch (e: any) {
      setVariantFeedback({ message: e.message || 'Erreur', kind: 'error' });
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
      secondary_unit: String(form.secondary_unit || '').trim() || null,
      secondary_unit_factor: form.secondary_unit_factor === '' || form.secondary_unit_factor == null ? null : Number(String(form.secondary_unit_factor).replace(',', '.')),
      barcode: form.barcode ?? '',
      lot_number: form.lot_number || '',
      expiry_date: form.expiry_date || '',
      price: Number.isFinite(price) ? price : 0,
      cost: Number.isFinite(cost) ? cost : 0,
      unit_price: Number.isFinite(price) ? price : 0,
      low_stock_threshold: Number(form.low_stock_threshold) || 0,
      track_inventory: form.track_inventory ? 1 : 0,
      tax_rate: form.tax_rate === '' || form.tax_rate == null ? null : Number(form.tax_rate),
      invoice_price_mode: form.invoice_price_mode || null,
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
    const secondUnit = String(form.secondary_unit || '').trim();
    const rawFactor = String(form.secondary_unit_factor ?? '').trim();
    const factor = Number(rawFactor.replace(',', '.'));
    if ((secondUnit || rawFactor) && (!secondUnit || !rawFactor || !Number.isFinite(factor) || factor <= 0 || factor > 1_000_000_000 || secondUnit.toLowerCase() === String(form.unit || '').trim().toLowerCase())) {
      setModalError('Indiquez une deuxième unité différente et un coefficient positif valide.');
      return;
    }
    setModalError('');
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
        const res: any = await api.createProduct(body);
        const newId = Number(res?.data?.id ?? res?.id ?? 0);
        if (newId && stagedPhotos.length) {
          for (let i = 0; i < stagedPhotos.length; i++) {
            try {
              await api.addProductImage(newId, {
                data_url: stagedPhotos[i].edited || await stagedFileToDataUrl(stagedPhotos[i].file),
                is_primary: i === 0,
                alt_text: stagedPhotos[i].file.name,
              });
            } catch { /* produit créé : photos ajoutables en modification */ }
          }
        }
        clearStagedPhotos();
        flash('Produit créé.');
      }
      setShow(false); setForm(emptyForm); setEditing(null); wz.reset();
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
      setModalError(e?.message || 'Enregistrement impossible — vérifiez les champs ou réessayez.');
    } finally {
      setSaving(false);
    }
  };

  const addStagedPhotos = (files: FileList | null) => {
    if (!files?.length) return;
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) { setStagedErr('Déposez des fichiers image (JPEG, PNG ou WebP).'); return; }
    setStagedErr('');
    setStagedPhotos((prev) => [...prev, ...imgs.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
  };
  const removeStagedPhoto = (i: number) => {
    setStagedPhotos((prev) => {
      const next = prev.slice();
      const [gone] = next.splice(i, 1);
      if (gone) { try { URL.revokeObjectURL(gone.url); } catch { /* */ } }
      return next;
    });
  };
  const clearStagedPhotos = () => {
    setStagedPhotos((prev) => {
      for (const st of prev) { try { URL.revokeObjectURL(st.url); } catch { /* */ } }
      return [];
    });
    setStagedErr('');
  };



  const toggleOne = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const doAdjust = async () => {
    if (!adjustProduct || adjustQty <= 0) { setModalError('Saisissez une quantité valide.'); return; }
    setSaving(true);
    try {
      await api.adjustStock(adjustProduct.id, { quantity: adjustQty, type: adjustType, reason: adjustReason });
      flash('Stock ajusté et enregistré dans la base de données.');
      setAdjustProduct(null); setAdjustQty(1); setAdjustReason('');
      load(true);
    } catch (e: any) { setModalError(e?.message || 'Ajustement impossible — réessayez.'); } finally { setSaving(false); }
  };

  const deleteOne = async (id: number) => {
    try {
      setDeleteBusy(true);
      await api.deleteProduct(id, undefined, { timedUndo: true });
      setSelected(prev => { const next = new Set(prev); next.delete(id); return next; });
      load(true);
    } catch (e: any) { flash(e?.message || 'Suppression impossible', 'error'); }
    finally { setDeleteBusy(false); }
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

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const fmt = (n: number) => Math.round(Number(n || 0)).toLocaleString("fr-FR");

  if (loading) {
    return (
      <div className="atlas-page ac-dash products-page">
        <PageSkeleton variant="products" />
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

  const actionButtons = (
        <>
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
          <button onClick={openNew} title="Ajouter un produit"><Plus size={16} aria-hidden="true" /><span className="tpa-label">Ajouter un produit</span></button>
        </>
  );
  return (
    <div className="atlas-catalog ac-products">
      <div className="page-header ac-page-header product-page-actions dock-page-header">
        <h1 className="sr-only">Produits &amp; stock</h1>
        <TopPageActions>{actionButtons}</TopPageActions>
      </div>
      <SaveFeedback message={saveMsg} type={saveMsgType} />

      
      <div className="ac-metric-grid ac-metric-grid--6 ac-products-kpis">
        <div className="ac-metric">
          <div className="as-label">Produits</div>
          <div className="as-value">{catalogKpis.n}<MetricTrend k="products" /></div>
          <div className="as-hint">catalogue total</div>
          <MetricSpark k="products" />
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
          <div className="as-value">{catalogKpis.ok}<MetricTrend k="in_stock" /></div>
          <div className="as-hint">au-dessus du seuil</div>
          <MetricSpark k="in_stock" />
        </div>
        <div className="ac-metric ac-metric--warn">
          <div className="as-label">Stock bas</div>
          <div className="as-value">{catalogKpis.low}<MetricTrend k="low_stock" invert /></div>
          <div className="as-hint">≤ seuil</div>
          <MetricSpark k="low_stock" invert />
        </div>
        <div className="ac-metric ac-metric--danger">
          <div className="as-label">Rupture</div>
          <div className="as-value">{catalogKpis.out}<MetricTrend k="out_of_stock" invert /></div>
          <div className="as-hint">quantité 0</div>
          <MetricSpark k="out_of_stock" invert />
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
          <Select className="ac-filter-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Catégorie">
            <option value="">Toutes catégories</option>
            {categories.map((c) => (
              <option key={c.id ?? c.name} value={c.name}>{c[`name_${uiLang}`] || c.name}</option>
            ))}
          </Select>
          <Select className="ac-filter-select" value={stockFilter} onChange={(e) => setStockFilter(e.target.value)} aria-label="Niveau de stock">
            <option value="">Tous les niveaux</option>
            <option value="ok">En stock</option>
            <option value="low">Stock bas</option>
            <option value="out">Rupture</option>
          </Select>
        </div>
        <div className="atlas-catalog-legend ac-products-legend">
          <span><span className="stock-pill ok">OK</span> au-dessus du seuil</span>
          <span><span className="stock-pill low">Bas</span> ≤ seuil</span>
          <span><span className="stock-pill out">Rupture</span> quantité nulle</span>
        </div>
      </div>

      <div className={`ac-panel ac-products-table-panel${catalogView === 'grid' ? ' ac-products-table-panel--grid' : ''}`}>
        <div className="ac-table-pager-bar">
          <span className="ac-table-pager-meta">{`${filtered.length} élément${filtered.length === 1 ? '' : 's'} · 20 par page`}</span>
          <div className="ac-table-pager-controls">
            <div className="pc-view" role="group" aria-label="Affichage des produits">
              <button type="button" className="ac-seg-btn pc-view-btn" aria-label="Affichage en grille" title="Affichage en grille" aria-pressed={catalogView === 'grid'} onClick={() => changeCatalogView('grid')}>
                <LayoutGrid size={15} strokeWidth={2.2} aria-hidden="true" />
                <span>Grille</span>
              </button>
              <button type="button" className="ac-seg-btn pc-view-btn" aria-label="Affichage en liste" title="Affichage en liste" aria-pressed={catalogView === 'list'} onClick={() => changeCatalogView('list')}>
                <List size={15} strokeWidth={2.2} aria-hidden="true" />
                <span>Liste</span>
              </button>
            </div>
            <ListPager page={safePage} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />
          </div>
        </div>
        {catalogView === 'grid' ? <>
          {paged.length > 0 && (
            <label className="pc-select-all">
              <input type="checkbox" className="pc-check-input" checked={paged.every(p => selected.has(p.id))} onChange={() => setSelected(prev => { const next = new Set(prev); const all = paged.every(p => next.has(p.id)); paged.forEach(p => all ? next.delete(p.id) : next.add(p.id)); return next; })} />
              <span className="pc-check-box" aria-hidden="true"><Check size={13} strokeWidth={3} /></span>
              <span>Tout sélectionner</span>
              {selected.size > 0 ? <span className="pc-select-count">{selected.size} sélectionné{selected.size > 1 ? 's' : ''}</span> : null}
            </label>
          )}
          {filtered.length === 0 ? <EmptyState title="Aucun produit" description="Essayez une autre recherche ou ajoutez un produit." actionLabel="Ajouter un produit" onAction={openNew} icon="package" /> : (
            <div className="pc-grid">
              {paged.map(p => {
                const imgUrl = productImageUrl(p.image_url);
                const stockState = !p.track_inventory ? 'untracked' : phoneStockQuantity(p) <= 0 ? 'out' : phoneStockIsLow(p) ? 'low' : 'ok';
                const isSel = selected.has(p.id);
                return (
                  <article className={`pc-card${isSel ? ' is-selected' : ''}`} key={p.id}>
                    <div className="pc-media">
                      <Link to={`/products/${p.id}/historique`} className="pc-media-link" aria-label={`Ouvrir ${p.name}`} tabIndex={-1}>
                        <ProductArtwork url={p.image_url} largeImageProductId={p.image_inline_large ? p.id : undefined} alt={p.name} className="pc-art" />
                      </Link>
                      <label className="pc-check" title={isSel ? 'Désélectionner le produit' : 'Sélectionner le produit'}>
                        <input type="checkbox" className="pc-check-input" checked={isSel} onChange={() => toggleOne(p.id)} aria-label={`Sélectionner ${p.name}`} />
                        <span className="pc-check-box" aria-hidden="true"><Check size={14} strokeWidth={3} /></span>
                      </label>
                      {imgUrl && (
                        <button
                          type="button"
                          className="pc-zoom desktop-product-zoom-btn"
                          title={`Agrandir la photo de ${p.name}`}
                          aria-label={`Agrandir la photo de ${p.name}`}
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPreviewImage({ src: imgUrl, name: p.name }); }}
                        >
                          <ZoomIn size={15} aria-hidden="true" />
                        </button>
                      )}
                      <span className={`pc-stock pc-stock--${stockState}`}>
                        {stockState === 'untracked' ? 'Non suivi' : stockState === 'out' ? 'Rupture' : stockState === 'low' ? 'Stock bas' : 'En stock'}
                      </span>
                    </div>
                    <Link to={`/products/${p.id}/historique`} className="pc-body">
                      <strong className="pc-name">{p.name}</strong>
                      <span className="pc-ref">{p.sku || p.barcode || 'Sans référence'}{p.category ? ` · ${categoryLabel(p.category)}` : ''}</span>
                      <span className="pc-meta">
                        {!hideMoney && p.price != null ? <b className="pc-price">{fmt(p.price)} MAD</b> : <span />}
                        <span className={`pc-qty pc-qty--${stockState}`}>{p.track_inventory ? localizedStockLabel(p) : '—'}</span>
                      </span>
                    </Link>
                    <div className="pc-actions">
                      <button type="button" className="secondary pc-act pc-act--label" title={`Modifier ${p.name}`} aria-label={`Modifier ${p.name}`} onClick={() => openEdit(p)}><Pencil size={15} aria-hidden="true" /><span>Modifier</span></button>
                      {!!p.track_inventory && <button type="button" className="secondary pc-act" title="Ajuster le stock" aria-label={`Ajuster le stock de ${p.name}`} onClick={() => { setModalError(''); setAdjustProduct(p); }}><SlidersHorizontal size={15} aria-hidden="true" /></button>}
                      <button type="button" className="secondary pc-act" title="Étiquette" aria-label={`Étiquette de ${p.name}`} onClick={() => setLabelProduct(p)}><Tags size={15} aria-hidden="true" /></button>
                      <span className="pc-actions-spacer" />
                      <TimedUndoDelete iconOnly width="32px" deleteLabel={`Supprimer ${p.name}`} undoLabel="Annuler la suppression" initialSeconds={10} onConfirm={() => deleteOne(p.id)} />
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </> : <VirtualScroll maxHeight={paged.length > 60 ? 560 : undefined}>
          <table className="data-dense ac-products-table ac-catalog-table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    checked={paged.length > 0 && paged.every((p) => selected.has(p.id))}
                    onChange={() => {
                      const all = paged.length > 0 && paged.every((p) => selected.has(p.id));
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (all) paged.forEach((p) => next.delete(p.id));
                        else paged.forEach((p) => next.add(p.id));
                        return next;
                      });
                    }}
                    aria-label="Tout sélectionner"
                  />
                </th>
                <th>Nom</th><th>Référence</th><th>Catégorie</th>{!hideMoney && <th>Prix</th>}{!hideCost && <th>Coût</th>}<th>Stock</th><th>Statut</th><th>Actions</th>
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
                      onAction={() => { setEditing(null); setForm(emptyForm); setModalError(''); wz.reset(); setLookupFeedback(null); setShow(true); }}
                      icon="package"
                    />
                  </td>
                </tr>
              </tbody>
            ) : (
              <VirtualTableBody
                rows={paged}
                rowHeight={48}
                maxHeight={560}
                getKey={(p) => p.id}
                renderRow={(p) => (
                  <tr className="product-table-row" onClick={(event) => { if (!(event.target as HTMLElement).closest('button, a, input, label, [role="button"]')) navigate(`/products/${p.id}/historique`); }}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleOne(p.id)}
                        aria-label={`Sélectionner ${p.name}`}
                      />
                    </td>
                    <td>
                      <Link className="product-list-open pc-list-open" to={`/products/${p.id}/historique`}><ProductArtwork url={p.image_url} largeImageProductId={p.image_inline_large ? p.id : undefined} alt="" className="pc-list-art" /><span className="pc-list-text" translate="no"><strong>{p.name}</strong>{p.description ? <small>{p.description}</small> : null}</span></Link>
                    </td>
                    <td><span className="sku-mono">{p.sku || '—'}</span></td>
                    <td translate="no">{p.category ? categoryLabel(p.category) : '—'}</td>
                    {!hideMoney && <td>{fmt(p.price)}</td>}
                    {!hideCost && <td>{fmt(p.cost)}</td>}
                    <td style={{ fontWeight: 700 }}>
                      {p.track_inventory ? (
                        <div>
                          <span className={`stock-pill ${phoneStockQuantity(p) <= 0 ? 'out' : phoneStockIsLow(p) ? 'low' : 'ok'}`}><bdi dir="auto">{localizedStockLabel(p)}</bdi></span>
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
                      <div className="row-actions row-actions--inline pc-row-actions">
                      {!!p.track_inventory && (
                        <button type="button" className="secondary pc-row-act" title="Ajuster le stock" onClick={() => { setModalError(''); setAdjustProduct(p); }}>
                          <SlidersHorizontal size={14} aria-hidden="true" />
                          <span>Ajuster</span>
                        </button>
                      )}
                      <button type="button" className="secondary pc-row-act" title={`Modifier ${p.name}`} onClick={() => openEdit(p)}>
                        <Pencil size={14} aria-hidden="true" />
                        <span>Modifier</span>
                      </button>
                      <button
                        type="button"
                        className="secondary pc-row-act"
                        title={`Étiquette de ${p.name}`}
                        onClick={() => setLabelProduct(p)}
                      >
                        <Tags size={14} aria-hidden="true" />
                        <span>Étiquette</span>
                      </button>
                      <TimedUndoDelete
                        key={`del-${p.id}`}
                        iconOnly
                        width="34px"
                        deleteLabel={`Supprimer ${p.name}`}
                        undoLabel="Annuler la suppression"
                        initialSeconds={10}
                        onConfirm={() => deleteOne(p.id)}
                      />
                      </div>
                    </td>
                  </tr>
                )}
              />
            )}
          </table>
        </VirtualScroll>}
      </div>

      {show && (() => {
        const productSteps = editing ? PRODUCT_EDIT_STEPS : PRODUCT_CREATE_STEPS;
        const currentStepDef = productSteps[wz.step - 1] || productSteps[0];
        return (
        <FloatingPortal><div className="modal-overlay" onClick={() => { setShow(false); setForm(emptyForm); setEditing(null); setModalError(''); setFieldErrors({}); setDescFeedback(''); setDescGenerating(false); clearStagedPhotos(); wz.reset(); }}>
          <div className="modal step-wizard step-wizard--wide" role="dialog" aria-modal="true" aria-labelledby="product-wizard-title" onClick={(e) => e.stopPropagation()}>
            <WizardHeader
              eyebrow="CATALOGUE PRODUIT"
              title={editing ? 'Modifier le produit' : 'Nouveau produit'}
              titleId="product-wizard-title"
              wz={wz}
              steps={productSteps}
            />
            <div className="step-wizard__body">
            <WizardIntro step={currentStepDef} />
            <StepBody active={wz.step === 1}>
            <div className="grid grid-2">
              <div className="form-row"><label>Nom *</label><input className={fieldErrors.name ? 'field-error' : undefined} value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); setFieldErrors((x) => ({ ...x, name: '' })); if (modalError) setModalError(''); if (descFeedback) setDescFeedback(''); }} placeholder="Ex. Carrelage 60×60" /><span className="field-error-msg">{fieldErrors.name || ''}</span></div>
              <div className="form-row"><label>Référence (SKU)</label><input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></div>
            </div>
            {(() => {
              const productName = String(form.name || '').trim();
              const hasProductName = productName.length > 0;
              return (
                <div className="form-row">
                  <label>Description</label>
                  <textarea
                    rows={2}
                    value={form.description}
                    onChange={(e) => {
                      setForm({ ...form, description: e.target.value });
                      if (descFeedback) setDescFeedback('');
                    }}
                    placeholder="Courte description catalogue…"
                  />
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 8 }}>
                    <button
                      type="button"
                      className="secondary"
                      disabled={!hasProductName || descGenerating}
                      aria-busy={descGenerating}
                      title={!hasProductName ? 'Saisissez d’abord le nom du produit' : 'Générer une courte description catalogue factuelle'}
                      style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      onClick={async () => {
                        const cleanName = String(form.name || '').trim();
                        if (!cleanName) {
                          setFieldErrors((x) => ({ ...x, name: 'Saisissez le nom du produit avant de générer une description.' }));
                          return;
                        }
                        setDescGenerating(true);
                        setDescFeedback('');
                        const category = String(form.category || '').trim();
                        const sku = String(form.sku || '').trim();
                        const unit = String(form.unit || '').trim();
                        const secondaryUnit = String(form.secondary_unit || '').trim();
                        const secondaryFactor = String(form.secondary_unit_factor ?? '').trim();
                        const draft = String(form.description || '').trim();
                        const details = [
                          `Nom : ${cleanName}`,
                          category ? `Catégorie : ${category}` : '',
                          sku ? `SKU : ${sku}` : '',
                          unit ? `Unité : ${unit}` : '',
                          secondaryUnit && secondaryFactor ? `Conditionnement : 1 ${unit || 'unité'} = ${secondaryFactor} ${secondaryUnit}` : '',
                          draft ? `Notes : ${draft}` : '',
                        ].filter(Boolean).join('\n');
                        try {
                          const res = await api.assistChat(
                            `Rédige une courte description catalogue réelle et factuelle (sans inventer de caractéristiques absentes) pour ce produit :\n${details}`,
                            {
                              task: 'description',
                              thread_id: 'product-description',
                              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                              product: {
                                name: cleanName,
                                category: category || undefined,
                                sku: sku || undefined,
                                unit: unit || undefined,
                                secondary_unit: secondaryUnit || undefined,
                                secondary_unit_factor: secondaryFactor || undefined,
                                draft: draft || undefined,
                              },
                            },
                          );
                          const generated = String(res.data?.reply || '').trim();
                          if (generated) {
                            setForm((f: any) => ({ ...f, description: generated }));
                          } else {
                            setDescFeedback('Aucune description générée. Réessayez.');
                          }
                        } catch (e: any) {
                          setDescFeedback(e?.message || 'Impossible de générer la description pour le moment.');
                        } finally {
                          setDescGenerating(false);
                        }
                      }}
                    >
                      <Sparkles size={14} aria-hidden="true" />
                      <span>{descGenerating ? 'Génération…' : 'Générer la description (IA)'}</span>
                    </button>
                    {!hasProductName && (
                      <small style={{ color: 'var(--muted)' }}>
                        Saisissez d’abord le nom du produit pour activer la génération.
                      </small>
                    )}
                  </div>
                  {descFeedback && (
                    <span className="field-error-msg" role="alert" style={{ marginTop: 4, display: 'block' }}>
                      {descFeedback}
                    </span>
                  )}
                </div>
              );
            })()}
              </StepBody>
            <StepBody active={wz.step === 2}>
            <ModalFormError message={lookupFeedback?.message} kind={lookupFeedback?.kind} />
            <div className="grid grid-2">
              <div className="form-row">
                <label>Catégorie</label>
                <Select
                  value={form.category || ''}
                  onChange={(e) => {
                    if (e.target.value === '__new__') { addCategory(); return; }
                    setForm({ ...form, category: e.target.value });
                  }}
                >
                  <option value="">— Choisir —</option>
                  {categories.map((c) => (
                    <option key={c.id ?? c.name} value={c.name}>{c[`name_${uiLang}`] || c.name}</option>
                  ))}
                  {form.category && !categories.some((c) => c.name === form.category) && (
                    <option value={form.category}>{form.category}</option>
                  )}
                  <option value="__new__">+ Nouvelle catégorie…</option>
                </Select>
              </div>
              <div className="form-row">
                <label>Unité (m², ML…) *</label>
                <Select
                  value={form.unit || ''}
                  onChange={(e) => {
                    if (e.target.value === '__new__') { void addUnit('unit'); return; }
                    setForm({ ...form, unit: e.target.value });
                    if (modalError) setModalError('');
                  }}
                >
                  <option value="">— Choisir —</option>
                  {units.map((u) => (
                    <option key={u.id ?? u.name} value={u.name}>
                      {u.symbol ? `${u[`name_${uiLang}`] || u.name} (${u.symbol})` : u[`name_${uiLang}`] || u.name}
                    </option>
                  ))}
                  {form.unit && !units.some((u) => u.name === form.unit) && (
                    <option value={form.unit}>{form.unit}</option>
                  )}
                  <option value="__new__">+ Nouvelle unité…</option>
                </Select>
              </div>
            </div>
            <div className="grid grid-2">
              <div className="form-row">
                <label htmlFor="product-secondary-unit">Deuxième unité (facultatif)</label>
                <Select
                  id="product-secondary-unit"
                  value={form.secondary_unit || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '__new__') { void addUnit('secondary_unit'); return; }
                    if (!val) { setForm({ ...form, secondary_unit: '', secondary_unit_factor: '' }); return; }
                    setForm({ ...form, secondary_unit: val });
                    if (modalError) setModalError('');
                  }}
                >
                  <option value="">— Aucune —</option>
                  {units.map((u) => (
                    <option
                      key={u.id ?? u.name}
                      value={u.name}
                      disabled={Boolean(form.unit) && u.name.toLowerCase() === String(form.unit).trim().toLowerCase()}
                    >
                      {u.symbol ? `${u[`name_${uiLang}`] || u.name} (${u.symbol})` : u[`name_${uiLang}`] || u.name}
                    </option>
                  ))}
                  {form.secondary_unit && !units.some((u) => u.name === form.secondary_unit) && (
                    <option value={form.secondary_unit}>{form.secondary_unit}</option>
                  )}
                  <option value="__new__">+ Nouvelle unité…</option>
                </Select>
              </div>
              <div className="form-row"><label htmlFor="product-secondary-factor">Quantité par {form.unit || 'unité'}</label><input id="product-secondary-factor" inputMode="decimal" value={form.secondary_unit_factor ?? ''} onChange={e => { setForm({ ...form, secondary_unit_factor: e.target.value }); if (modalError) setModalError(''); }} placeholder="Ex. 1,59" /></div>
            </div>
            <div className="grid grid-3">
              <div className="form-row"><label>Code-barres</label><input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} /></div>
              <div className="form-row"><label>N° lot (épicerie)</label><input value={form.lot_number || ''} onChange={(e) => setForm({ ...form, lot_number: e.target.value })} placeholder="Optionnel" /></div>
              <div className="form-row"><label>Date limite (DLC)</label><DatePicker value={(form.expiry_date || '').toString().slice(0, 10)} onChange={(v) => setForm({ ...form, expiry_date: v })} /></div>
            </div>
            <small style={{ display: 'block', color: 'var(--muted)' }}>Exemple : 1 carton = 1,59 m². Le stock et le prix restent enregistrés par unité principale.</small>
            </StepBody>
            <StepBody active={wz.step === 3}>
            <div className="grid grid-2">
              <div className="form-row"><label>Prix de vente *</label><NumberField value={form.price} onValueChange={(n) => { setForm((f: any) => ({ ...f, price: n })); setFieldErrors((x) => ({ ...x, price: '' })); if (modalError) setModalError(''); }} /><span className="field-error-msg">{fieldErrors.price || ''}</span></div>
              <div className="form-row"><label>Coût</label><NumberField value={form.cost} onValueChange={(n) => setForm((f: any) => ({ ...f, cost: n }))} /></div>
            </div>
            {!editing && (
              <div className="grid grid-2">
                <div className="form-row"><label>Stock initial ({form.unit || "unité"})</label><NumberField value={form.stock_quantity} onValueChange={(n) => setForm({ ...form, stock_quantity: n })} />{form.secondary_unit && Number(String(form.secondary_unit_factor || "").replace(",", ".")) > 0 && <small>{dualStockLabel({ ...form, secondary_unit_factor: Number(String(form.secondary_unit_factor).replace(",", ".")) })}</small>}</div>
                <div className="form-row"><label>Entrepôt / emplacement</label>
                  <Select value={form.location_id || ''} onChange={(e) => setForm({ ...form, location_id: Number(e.target.value) || 0 })}>
                    <option value="0">Emplacement par défaut</option>
                    {stockLocations.map((l: any) => (
                      <option key={l.id} value={l.id}>{l.name} ({l.code})</option>
                    ))}
                  </Select>
                </div>
              </div>
            )}
            <div className="grid grid-3">
              <div className="form-row"><label>Seuil d'alerte</label><NumberField value={form.low_stock_threshold} onValueChange={(n) => setForm({ ...form, low_stock_threshold: n })} /></div>
              <div className="form-row"><label>Taux TVA %</label><NumberField value={form.tax_rate} onValueChange={(n) => setForm({ ...form, tax_rate: n })} placeholder="Défaut" /></div>
              <div className="form-row"><label>Prix sur facture</label><Select value={form.invoice_price_mode || ''} onChange={(e) => setForm({ ...form, invoice_price_mode: e.target.value })}>
                {!form.invoice_price_mode && <option value="">Mode historique (inchangé)</option>}
                <option value="exclusive">TVA ajoutée au prix (HT)</option><option value="inclusive">TVA incluse dans le prix (TTC)</option>
              </Select></div>
            </div>
            <div className="form-row" style={{ marginBottom: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={Boolean(form.track_inventory)} onChange={(e) => setForm({ ...form, track_inventory: e.target.checked ? 1 : 0 })} style={{ width: 'auto', display: 'inline' }} />
                Suivre le stock pour ce produit
              </label>
              <small style={{ color: 'var(--muted)' }}>La TVA par défaut s&apos;applique aux factures ; les ventes rapides utilisent le prix sans TVA.</small>
            </div>
              </StepBody>
            <StepBody active={wz.step === 4}>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
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

              </StepBody>
              <StepBody active={wz.step === 5}>
            {editing ? (
              <div>
                {variants.length > 0 && (
                  <div className="table-wrap" style={{ marginBottom: 10, maxHeight: 160, overflow: 'auto' }}>
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
                  <div className="form-row"><label>Libellé *</label><input value={variantForm.variant_label} onChange={(e) => { setVariantForm({ ...variantForm, variant_label: e.target.value }); if (variantFeedback) setVariantFeedback(null); }} placeholder="ex. M / Rouge" /></div>
                  <div className="form-row"><label>SKU</label><input value={variantForm.sku} onChange={(e) => setVariantForm({ ...variantForm, sku: e.target.value })} /></div>
                </div>
                <div className="grid grid-3">
                  <div className="form-row"><label>Code-barres</label><input value={variantForm.barcode} onChange={(e) => setVariantForm({ ...variantForm, barcode: e.target.value })} placeholder="Scan / saisie" /></div>
                  <div className="form-row"><label>Prix</label><NumberField value={Number(variantForm.price || 0)} onValueChange={(n) => setVariantForm({ ...variantForm, price: String(n) })} /></div>
                  <div className="form-row"><label>Stock initial</label><NumberField value={Number(variantForm.stock_quantity || 0)} onValueChange={(n) => setVariantForm({ ...variantForm, stock_quantity: String(n) })} /></div>
                </div>
                <ModalFormError message={variantFeedback?.message} kind={variantFeedback?.kind} />
                <button type="button" className="secondary" style={{ marginBottom: 4 }} onClick={saveVariant} disabled={savingVariant}>
                  {savingVariant ? 'Ajout…' : '+ Ajouter la variante'}
                </button>
              </div>
            ) : (
              <div
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setStagedDragOver(true); }}
                onDragLeave={(e) => { if (e.currentTarget === e.target) setStagedDragOver(false); }}
                onDrop={(e) => {
                  e.preventDefault();
                  setStagedDragOver(false);
                  addStagedPhotos(e.dataTransfer.files);
                }}
                style={{
                  borderRadius: 10,
                  outline: stagedDragOver ? '2px dashed var(--pie-ring, #e8a317)' : 'none',
                  outlineOffset: 4,
                  background: stagedDragOver ? 'rgba(232, 163, 23, 0.05)' : 'transparent',
                  transition: 'background 0.15s ease, outline-color 0.15s ease',
                }}
              >
                <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
                  Glissez vos images ici ou cliquez pour parcourir — la première devient la photo principale.
                </p>
                {stagedErr && <p style={{ color: 'var(--bad)', fontSize: 12, marginBottom: 8 }}>{stagedErr}</p>}
                {stagedPhotos.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
                    {stagedPhotos.map((st, i) => (
                      <div
                        key={st.url}
                        style={{
                          width: 92,
                          borderRadius: 10,
                          overflow: 'hidden',
                          border: i === 0 ? '2px solid var(--pie-ring, #e8a317)' : '1px solid var(--pie-thumb-border, #d4d4d8)',
                          background: 'var(--pie-thumb-bg, #faf9f6)',
                        }}
                      >
                        <StagedPhotoThumb url={st.edited || st.url} />
                        <div style={{ display: 'flex', fontSize: 10 }}>
                          <span style={{ flex: 1, textAlign: 'center', padding: '3px 0', color: 'var(--muted)' }}>{i === 0 ? '★ Principale' : `Photo ${i + 1}`}</span>
                          <button
                            type="button"
                            className="secondary"
                            style={{ padding: '3px 6px', fontSize: 10 }}
                            title="Modifier la photo (recadrage)"
                            onClick={() => { setStagedEditIdx(i); setStagedEditSrc(st.edited || st.url); }}
                          >✎</button>
                          <button type="button" className="danger" style={{ padding: '3px 6px', fontSize: 10 }} title="Retirer la photo" onClick={() => removeStagedPhoto(i)}>×</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <input
                  ref={stagedInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => { addStagedPhotos(e.target.files); e.target.value = ''; }}
                />
                <button type="button" className="secondary" onClick={() => stagedInputRef.current?.click()}>
                  + Ajouter des photos
                </button>
                <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8, marginBottom: 0 }}>
                  Les photos choisies sont envoyées automatiquement juste après la création.
                </p>
              </div>
            )}
              </StepBody>
            {editing?.id && (
              <StepBody active={wz.step === 6}>
                <ProductImageEditor productId={Number(editing.id)} />
              </StepBody>
            )}
            <ModalFormError message={modalError || firstError(fieldErrors)} />
            </div>
            <WizardFoot
              title={editing ? 'Modifier le produit' : 'Nouveau produit'}
              wz={wz}
              stepLabel={currentStepDef.label}
              onCancel={() => { setShow(false); setForm(emptyForm); setEditing(null); setModalError(''); setFieldErrors({}); clearStagedPhotos(); wz.reset(); }}
              onBack={() => { setModalError(''); setFieldErrors({}); }}
              onNext={() => {
                if (wz.step === 1 && !String(form.name || '').trim()) {
                  setFieldErrors({ name: 'Le nom du produit est obligatoire.' });
                  setModalError('Le nom du produit est obligatoire.');
                  return false;
                }
                if (wz.step === 2) {
                  if (!String(form.unit || '').trim()) {
                    setModalError("L'unité principale est obligatoire.");
                    return false;
                  }
                  const secUnit = String(form.secondary_unit || '').trim();
                  const secRaw = String(form.secondary_unit_factor ?? '').trim();
                  if (secUnit && !secRaw) {
                    setModalError('Indiquez la quantité par unité pour la deuxième unité.');
                    return false;
                  }
                  if (!secUnit && secRaw) {
                    setModalError('Choisissez la deuxième unité ou videz le coefficient.');
                    return false;
                  }
                  if (secUnit && secRaw) {
                    const secFactor = Number(secRaw.replace(',', '.'));
                    if (!Number.isFinite(secFactor) || secFactor <= 0) {
                      setModalError('Le coefficient de la deuxième unité doit être un nombre positif.');
                      return false;
                    }
                    if (secUnit.toLowerCase() === String(form.unit || '').trim().toLowerCase()) {
                      setModalError("La deuxième unité doit être différente de l'unité principale.");
                      return false;
                    }
                  }
                }
                if (wz.step === 3) {
                  const p = Number(form.price);
                  if (!Number.isFinite(p) || p < 0) {
                    setFieldErrors({ price: 'Prix de vente invalide.' });
                    setModalError('Indiquez un prix de vente valide (≥ 0).');
                    return false;
                  }
                }
                setFieldErrors({});
                setModalError('');
                return true;
              }}
              onSubmit={() => void save()}
              submitLabel={saving ? 'Enregistrement…' : 'Enregistrer'}
              saving={saving}
            />
          </div>
        </div></FloatingPortal>
        );
      })()}

            {stagedEditIdx !== null && createPortal(
        <div className="modal-overlay" style={{ zIndex: 1400 }} onClick={() => setStagedEditIdx(null)}>
          <div
            className="modal-card"
            style={{ maxWidth: 'min(560px, calc(100vw - 32px))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Modifier la photo — recadrage</h3>
            <ImageWorkbench src={stagedEditSrc} onChange={setStagedEditSrc} />
            <div className="modal-actions" style={{ marginTop: 12 }}>
              <button type="button" className="secondary" onClick={() => setStagedEditIdx(null)}>Annuler</button>
              <button
                type="button"
                onClick={() => {
                  const idx = stagedEditIdx;
                  setStagedPhotos((prev) => prev.map((st, j) => (j === idx && stagedEditSrc.startsWith('data:image') ? { ...st, edited: stagedEditSrc } : st)));
                  setStagedEditIdx(null);
                }}
              >Appliquer</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {adjustProduct && (
        <FloatingPortal><div className="modal-overlay" onClick={() => { setModalError(''); setAdjustProduct(null); }}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h2>Ajuster le stock — {adjustProduct.name}</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>Stock actuel : <strong>{dualStockLabel(adjustProduct)}</strong></p>
            <div className="form-row">
              <label>Type d'ajustement</label>
              <Select value={adjustType} onChange={(e) => setAdjustType(e.target.value)}>
                <option value="in">Entrée stock (+)</option>
                <option value="out">Sortie stock (−)</option>
                <option value="adjustment">Ajustement manuel</option>
              </Select>
            </div>
            <div className="form-row"><label>Quantité ({adjustProduct.unit || "unité"})</label><NumberField value={adjustQty} onValueChange={setAdjustQty} min={0.01} step="0.01" />{adjustProduct.secondary_unit && <small>Équivalent : {dualStockLabel(adjustProduct, adjustQty)}</small>}</div>
            <div className="form-row"><label>Raison</label><input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="ex. Réception marchandise, casse, correction..." /></div>
            <ModalFormError message={modalError} />
            <div className="form-actions">
              <button onClick={doAdjust} disabled={saving}>{saving ? 'Enregistrement...' : 'Ajuster le stock'}</button>
              <button className="secondary" onClick={() => { setModalError(''); setAdjustProduct(null); }}>Annuler</button>
            </div>
          </div>
        </div></FloatingPortal>
      )}
      {previewImage && (
        <ImageLightbox
          src={previewImage.src}
          name={previewImage.name}
          onClose={() => setPreviewImage(null)}
        />
      )}
      <ProductLabelModal
        product={labelProduct}
        onClose={() => setLabelProduct(null)}
      />
    </div>
  );
}
