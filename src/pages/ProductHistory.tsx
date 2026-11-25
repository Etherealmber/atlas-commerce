import { dualStockLabel } from '../lib/dualUnit';
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Camera, History, Maximize2, Pencil, RefreshCw, SlidersHorizontal, Sparkles, Tags } from 'lucide-react';
import { api } from '../api';
import { canSell } from '../auth';
import { TimedUndoDelete } from '../components/ui';
import { FloatingPortal } from '../components/FloatingPortal';
import { useWizard, StepBody, WizardFoot, WizardHeader, WizardIntro, type WizardStepDef } from '../components/ui/FormWizard';
import ImageLightbox from '../components/ui/ImageLightbox';
import ProductLabelModal from '../components/ProductLabelModal';
import ProductArtwork, { productImageUrl } from '../components/ProductArtwork';
import NumberField from '../components/NumberField';
import './product-history.css';

const PH_EDIT_STEPS: readonly WizardStepDef[] = [
  { id: 'identity', label: 'Identité', hint: 'Nom, catégorie, références et description catalogue.' },
  { id: 'units', label: 'Unités & stock', hint: 'Unité principale, deuxième unité et suivi de stock.' },
  { id: 'pricing', label: 'Tarifs & TVA', hint: 'Prix de vente, coût d’achat et régime de TVA.' },
];

const PH_ADJUST_STEPS: readonly WizardStepDef[] = [
  { id: 'movement', label: 'Mouvement', hint: 'Choisissez le sens du mouvement et la quantité.' },
  { id: 'reason', label: 'Motif', hint: 'Précisez le motif pour la traçabilité du stock.' },
];

const PAGE_SIZE = 40;
const types: Record<string, string> = { initial: 'Stock initial', sale: 'Vente', purchase: 'Achat', restock: 'Réapprovisionnement', refund_restock: 'Réapprovisionnement', in: 'Entrée', out: 'Sortie', adjust: 'Ajustement', adjustment: 'Ajustement', transfer: 'Transfert', return: 'Retour' };
const actor = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value : fallback;
const quantity = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('fr-FR', { maximumFractionDigits: 3 }) : '—';

type Props = { mobile?: boolean; onProductUpdated?: () => void };
/** Shimmer mirroring the product card: photo, tag, name, reference, author,
 *  action pills and stock/price chips — no layout jump once data lands. */
function ProductHeroSkeleton({ withActions }: { withActions: boolean }) {
  return (
    <section className="product-history-card ph-sk" role="status" aria-busy="true" aria-label="Chargement du produit">
      <div className="product-history-hero">
        <span className="skeleton ph-sk-photo" />
        <div className="ph-sk-copy">
          <span className="skeleton ph-sk-pill" style={{ width: 92, height: 24 }} />
          <span className="skeleton ph-sk-line" style={{ width: '46%', maxWidth: 240, height: 20 }} />
          <span className="skeleton ph-sk-line" style={{ width: '30%', maxWidth: 160 }} />
        </div>
      </div>
      <span className="skeleton ph-sk-line ph-sk-actors" style={{ width: 150 }} />
      {withActions && (
        <div className="product-history-actions ph-sk-actions">
          <span className="skeleton ph-sk-pill" style={{ width: 132 }} />
          <span className="skeleton ph-sk-pill" style={{ width: 160 }} />
          <span className="skeleton ph-sk-pill" style={{ width: 104 }} />
        </div>
      )}
      <div className="ph-sk-chips">
        <span className="skeleton ph-sk-pill" style={{ width: 96, height: 24 }} />
        <span className="skeleton ph-sk-pill" style={{ width: 100, height: 24 }} />
      </div>
    </section>
  );
}

const MOVEMENT_SK_WIDTHS = [
  { title: 64, qty: 120, reason: 150 },
  { title: 54, qty: 104, reason: 128 },
  { title: 84, qty: 112, reason: 0 },
  { title: 60, qty: 96, reason: 140 },
];

/** Shimmer rows mirroring `.product-history-movement`: type + time, quantity
 *  line, optional reason, author. */
function MovementSkeleton({ rows }: { rows: number }) {
  return (
    <div className="ph-sk-movements" role="status" aria-busy="true" aria-label="Chargement des mouvements">
      {MOVEMENT_SK_WIDTHS.slice(0, rows).map((w, i) => (
        <div key={i} className="product-history-movement ph-sk-movement" aria-hidden="true">
          <div>
            <span className="skeleton ph-sk-line" style={{ width: w.title, height: 14 }} />
            <span className="skeleton ph-sk-line" style={{ width: 96, height: 11 }} />
          </div>
          <span className="skeleton ph-sk-line" style={{ width: w.qty }} />
          {w.reason > 0 && <span className="skeleton ph-sk-line" style={{ width: w.reason }} />}
          <span className="skeleton ph-sk-line ph-sk-line--sm" style={{ width: 92 }} />
        </div>
      ))}
    </div>
  );
}

export default function ProductHistory({ mobile = false, onProductUpdated }: Props) {
  const navigate = useNavigate();
  const { id } = useParams(); const productId = Number(id);
  const valid = /^\d+$/.test(id || '') && Number.isSafeInteger(productId) && productId > 0;
  const [product, setProduct] = useState<any>(null); const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true); const [loadingMore, setLoadingMore] = useState(false);
  const [productError, setProductError] = useState(''); const [error, setError] = useState(''); const [hasMore, setHasMore] = useState(false);
  const [imageBusy, setImageBusy] = useState(false); const [imageMessage, setImageMessage] = useState(''); const [lightboxOpen, setLightboxOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);

  // In-place stock adjustment modal
  const [adjustOpen, setAdjustOpen] = useState(false);
  const adjustWz = useWizard(PH_ADJUST_STEPS.length);
  const [adjustQty, setAdjustQty] = useState<number>(1);
  const [adjustType, setAdjustType] = useState<'in' | 'out' | 'adjust'>('in');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustBusy, setAdjustBusy] = useState(false);
  const [adjustError, setAdjustError] = useState('');

  // In-place product details edit modal
  const [editOpen, setEditOpen] = useState(false);
  const editWz = useWizard(PH_EDIT_STEPS.length);
  const [editForm, setEditForm] = useState<any>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState('');
  const [descGenerating, setDescGenerating] = useState(false);
  const [categories, setCategories] = useState<any[]>([]);
  const [units, setUnits] = useState<any[]>([]);

  const generation = useRef(0); const movementGeneration = useRef(0); const imageInput = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    const current = ++generation.current; const movementCurrent = ++movementGeneration.current; setLoading(true); setLoadingMore(false); setImageBusy(false); setImageMessage(''); setProduct(null); setRows([]); setError(''); setProductError(''); setHasMore(false);
    if (!valid) { setLoading(false); setProductError('Produit introuvable.'); return; }
    const [prod, movements] = await Promise.allSettled([api.getProduct(productId), api.getProductMovements(productId, PAGE_SIZE, { full: true })]);
    if (generation.current !== current) return;
    if (prod.status === 'fulfilled' && prod.value.data) setProduct(prod.value.data); else setProductError('Impossible de charger ce produit.');
    if (movementGeneration.current === movementCurrent) {
      if (movements.status === 'fulfilled' && Array.isArray(movements.value.data)) { setRows(movements.value.data); setHasMore(movements.value.data.length === PAGE_SIZE); }
      else setError('Impossible de charger les mouvements. Réessayez.');
      setLoading(false);
    }
  }, [productId, valid]);
  useEffect(() => { void load(); return () => { generation.current++; movementGeneration.current++; }; }, [load]);
  const refreshMovements = async () => {
    if (!valid || loading) return;
    const current = ++movementGeneration.current; setLoading(true); setLoadingMore(false); setError('');
    try { const result = await api.getProductMovements(productId, PAGE_SIZE, { full: true }); if (current !== movementGeneration.current) return; setRows(result.data || []); setHasMore((result.data || []).length === PAGE_SIZE); }
    catch { if (current === movementGeneration.current) setError('Impossible de charger les mouvements. Réessayez.'); }
    finally { if (current === movementGeneration.current) setLoading(false); }
  };
  const more = async () => {
    if (loadingMore || !hasMore) return; const current = movementGeneration.current; setLoadingMore(true); setError('');
    try { const result = await api.getProductMovements(productId, PAGE_SIZE, { full: true, offset: rows.length }); if (movementGeneration.current !== current) return; setRows(old => [...old, ...(result.data || [])]); setHasMore((result.data || []).length === PAGE_SIZE); }
    catch { if (movementGeneration.current === current) setError('Impossible de charger la suite. Réessayez.'); }
    finally { if (movementGeneration.current === current) setLoadingMore(false); }
  };
  const changePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file || imageBusy) return;
    if (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type) || file.size > 4_000_000) { setImageMessage('Choisissez une image JPG, PNG, WebP ou GIF de 4 Mo maximum.'); return; }
    const current = generation.current; setImageBusy(true); setImageMessage('');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.addEventListener('load', () => resolve(String(reader.result || '')), { once: true }); reader.addEventListener('error', () => reject(new Error('Lecture impossible')), { once: true }); reader.readAsDataURL(file); });
      const response: any = await api.addProductImage(productId, { data_url: dataUrl, is_primary: true, alt_text: product?.name || '' });
      if (generation.current !== current) return;
      if (!response.data?.url) throw new Error('Image non retournée par le serveur');
      setProduct((old: any) => ({ ...old, image_url: response.data.url })); setImageMessage('Photo du produit mise à jour.'); onProductUpdated?.();
    } catch { if (generation.current === current) setImageMessage('Impossible d’enregistrer la photo. Réessayez.'); }
    finally { if (generation.current === current) setImageBusy(false); }
  };

  const openAdjustModal = () => {
    setAdjustQty(1);
    setAdjustType('in');
    setAdjustReason('');
    setAdjustError('');
    adjustWz.reset();
    setAdjustOpen(true);
  };

  const submitAdjust = async () => {
    if (!product || adjustQty <= 0) {
      setAdjustError('Saisissez une quantité valide.');
      return;
    }
    setAdjustBusy(true);
    setAdjustError('');
    try {
      await api.adjustStock(productId, { quantity: adjustQty, type: adjustType, reason: adjustReason });
      setAdjustOpen(false);
      await load();
      setImageMessage('Stock ajusté et enregistré.');
      onProductUpdated?.();
    } catch (e: any) {
      setAdjustError(e?.message || 'Ajustement impossible — réessayez.');
    } finally {
      setAdjustBusy(false);
    }
  };

  const openEditModal = () => {
    if (!product) return;
    setEditError('');
    setEditForm({
      name: product.name || '',
      sku: product.sku || '',
      barcode: product.barcode || '',
      category: product.category || '',
      unit: product.unit || 'pièce',
      secondary_unit: product.secondary_unit || '',
      secondary_unit_factor: product.secondary_unit_factor != null && product.secondary_unit_factor !== '' ? String(product.secondary_unit_factor) : '',
      description: product.description || '',
      price: Number(product.price ?? product.unit_price ?? 0),
      cost: Number(product.cost ?? 0),
      low_stock_threshold: Number(product.low_stock_threshold ?? 0),
      tax_rate: product.tax_rate != null ? String(product.tax_rate) : '',
      invoice_price_mode: product.invoice_price_mode || '',
      track_inventory: Number(product.track_inventory) !== 0,
    });
    setEditOpen(true);
    editWz.reset();
    if (!categories.length) {
      api.getCategories().then((r: any) => setCategories(r?.data || [])).catch(() => {});
    }
    if (!units.length) {
      api.getUnits().then((r: any) => setUnits(r?.data || [])).catch(() => {});
    }
  };

  const generateEditDescription = async () => {
    if (!editForm || descGenerating) return;
    const title = String(editForm.name || '').trim();
    if (!title) {
      setEditError('Renseignez d’abord le titre du produit avant de générer la description.');
      return;
    }
    setEditError('');
    setDescGenerating(true);
    try {
      const r = await api.assistChat(
        `Rédige une description catalogue factuelle pour le produit "${title}".`,
        {
          task: 'description',
          product: {
            name: title,
            category: String(editForm.category || '').trim(),
            sku: String(editForm.sku || '').trim(),
            unit: String(editForm.unit || '').trim(),
            secondary_unit: String(editForm.secondary_unit || '').trim(),
            secondary_unit_factor: String(editForm.secondary_unit_factor || '').trim(),
            draft: String(editForm.description || '').trim(),
          },
        },
      );
      if (r.data?.reply) {
        setEditForm((f: any) => (f ? { ...f, description: r.data.reply } : f));
      }
    } catch (e: any) {
      setEditError(e?.message || 'Génération de description indisponible.');
    } finally {
      setDescGenerating(false);
    }
  };

  const submitEdit = async () => {
    if (!editForm || editBusy) return;
    const name = String(editForm.name || '').trim();
    if (!name) {
      setEditError('Le nom du produit est obligatoire.');
      return;
    }
    const price = Number(editForm.price);
    if (!Number.isFinite(price) || price < 0) {
      setEditError('Prix de vente invalide.');
      return;
    }
    const secondUnit = String(editForm.secondary_unit || '').trim();
    const rawFactor = String(editForm.secondary_unit_factor ?? '').trim();
    const factor = Number(rawFactor.replace(',', '.'));
    if ((secondUnit || rawFactor) && (!secondUnit || !rawFactor || !Number.isFinite(factor) || factor <= 0 || factor > 1_000_000_000 || secondUnit.toLowerCase() === String(editForm.unit || '').trim().toLowerCase())) {
      setEditError('Indiquez une deuxième unité différente et un coefficient positif valide.');
      return;
    }
    setEditBusy(true);
    setEditError('');
    try {
      const cost = Number(editForm.cost);
      await api.updateProduct(productId, {
        name,
        sku: String(editForm.sku || '').trim(),
        barcode: String(editForm.barcode || '').trim(),
        category: String(editForm.category || '').trim(),
        unit: String(editForm.unit || 'pièce').trim() || 'pièce',
        secondary_unit: secondUnit || null,
        secondary_unit_factor: secondUnit ? factor : null,
        description: String(editForm.description || '').trim(),
        price,
        unit_price: price,
        cost: Number.isFinite(cost) ? cost : 0,
        low_stock_threshold: Number(editForm.low_stock_threshold) || 0,
        track_inventory: editForm.track_inventory ? 1 : 0,
        tax_rate: editForm.tax_rate === '' || editForm.tax_rate == null ? null : Number(editForm.tax_rate),
        invoice_price_mode: editForm.invoice_price_mode || null,
      });
      setEditOpen(false);
      await load();
      setImageMessage('Détails du produit mis à jour.');
      onProductUpdated?.();
    } catch (e: any) {
      setEditError(e?.message || 'Enregistrement impossible — réessayez.');
    } finally {
      setEditBusy(false);
    }
  };

  return <div className={`product-history${mobile ? ' product-history--phone' : ''}`}>
    {!mobile && <h1 className="sr-only">Historique du produit</h1>}
    {productError && <div className="product-history-card" role="alert">{productError} {valid && <button type="button" onClick={() => void load()}>Réessayer</button>}</div>}
    {loading && !product && !productError && <ProductHeroSkeleton withActions={!mobile && canSell()} />}
    {product && <section className="product-history-card"><div className="product-history-hero"><div className="product-history-photo">{productImageUrl(product.image_url) ? <button type="button" className="product-history-photo-zoom" aria-label="Agrandir la photo du produit" title="Agrandir la photo" onClick={() => setLightboxOpen(true)}><ProductArtwork url={product.image_url} alt={product.name || ''} /><span className="product-history-photo-zoom-badge" aria-hidden="true"><Maximize2 size={12} strokeWidth={2.3} /></span></button> : <ProductArtwork url={product.image_url} />}{canSell() && <><input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={changePhoto} /><button type="button" className="secondary product-history-photo-action" aria-label="Modifier la photo du produit" title="Modifier la photo du produit" disabled={imageBusy} onClick={() => imageInput.current?.click()}><Camera size={16} /></button></>}</div><div><span className="product-history-tag">Fiche produit</span><h2>{product.name}</h2><p>{[product.sku, product.barcode, product.category].filter(Boolean).join(' · ') || 'Sans référence'}</p></div></div>
      <p className="product-history-actors">Créé par {actor(product.created_by, 'Système')}{product.approved_by && <> · Approuvé par {product.approved_by}</>}</p>
      {!mobile && canSell() && <div className="product-history-actions">
        {Number(product.track_inventory) !== 0 && <button type="button" className="secondary product-history-action-stock" onClick={openAdjustModal}><SlidersHorizontal size={14} aria-hidden="true" />Ajuster le stock</button>}
        <button type="button" className="secondary product-history-action-edit" onClick={openEditModal}><Pencil size={14} aria-hidden="true" />Modifier les détails</button>
        <button type="button" className="secondary product-history-action-label" onClick={() => setLabelOpen(true)}><Tags size={14} aria-hidden="true" />Étiquette</button>
      </div>}
      {imageMessage && <p role="status">{imageMessage}</p>}
      <div className="product-history-chips"><span>{product.track_inventory != null && !Number(product.track_inventory) ? 'Stock non suivi' : `Stock ${dualStockLabel(product)}`}</span>{canSell() && typeof product.price === 'number' && <span>{product.price.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD</span>}</div>
    </section>}
    <section className={`product-history-card product-history-movements${loading && rows.length ? ' is-refreshing' : ''}`} aria-busy={loading || undefined}><div className="product-history-section-head"><History size={20} /><h2>Historique des mouvements</h2>{!loading && !error && <span className="product-history-tag">{rows.length}{hasMore ? '+' : ''}</span>}<button type="button" className="secondary product-history-refresh" aria-label="Actualiser l’historique" title="Actualiser l’historique" disabled={loading} onClick={() => void refreshMovements()}><RefreshCw size={19} /></button></div>
      {loading && !rows.length && <MovementSkeleton rows={mobile ? 3 : 4} />}
      {error && <p role="alert">{error} <button type="button" onClick={() => void refreshMovements()}>Réessayer</button></p>}
      {!loading && !error && rows.length === 0 && <p>Aucun mouvement enregistré pour ce produit.</p>}
      {rows.map((m, index) => <div className="product-history-movement" key={m.id ?? `${m.created_at}-${index}`}><div><strong>{types[String(m.type || '').toLowerCase()] || m.type || 'Mouvement'}</strong><time>{String(m.created_at || '—').replace('T', ' ').slice(0, 16)}</time></div><p>Qté {quantity(m.quantity)} · {quantity(m.previous_quantity)} → {quantity(m.new_quantity)}</p>{(m.reason || m.reference) && <p>{[m.reason, m.reference].filter(Boolean).join(' · ')}</p>}<small>Créé par {actor(m.created_by, 'Système')}{m.approved_by && <> · Approuvé par {m.approved_by}</>}</small></div>)}
      {hasMore && <button type="button" className="product-history-more" disabled={loadingMore} onClick={() => void more()}>{loadingMore ? 'Chargement…' : 'Charger la suite'}</button>}
    </section>
    {!mobile && canSell() && product && (
      <section className="product-history-card ac-danger-zone" aria-label="Zone de danger">
        <div className="ac-danger-zone-head">
          <div>
            <h3>Zone de danger</h3>
            <p>Supprimer ce produit le retire du catalogue actif (conservation des documents historiques).</p>
          </div>
          <div className="ac-danger-zone-actions">
            <TimedUndoDelete deleteLabel="Supprimer" undoLabel="Annuler" initialSeconds={10} onConfirm={async () => { try { await api.deleteProduct(productId, undefined, { timedUndo: true }); navigate('/products'); } catch (e: any) { setImageMessage(e?.message || 'Suppression impossible.'); } }} />
          </div>
        </div>
      </section>
    )}
    {adjustOpen && product && (
      <FloatingPortal><div className="modal-overlay" onClick={() => { if (!adjustBusy) setAdjustOpen(false); }}>
        <div className="modal step-wizard" role="dialog" aria-modal="true" aria-labelledby="ph-adjust-title" onClick={(e) => e.stopPropagation()}>
          <WizardHeader
            eyebrow="STOCK PRODUIT"
            title={`Ajuster le stock — ${product.name}`}
            titleId="ph-adjust-title"
            wz={adjustWz}
            steps={PH_ADJUST_STEPS}
          />
          <div className="step-wizard__body">
            <WizardIntro step={PH_ADJUST_STEPS[adjustWz.step - 1] || PH_ADJUST_STEPS[0]} />
            <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>Stock actuel : <strong>{dualStockLabel(product)}</strong></p>
            {adjustError && <div className="error-msg" style={{ marginBottom: 10 }}>{adjustError}</div>}
            <StepBody active={adjustWz.step === 1}>
              <div className="form-row">
                <label>Type de mouvement</label>
                <select value={adjustType} onChange={(e) => setAdjustType(e.target.value as any)} disabled={adjustBusy}>
                  <option value="in">Entrée (ajouter au stock)</option>
                  <option value="out">Sortie (retirer du stock)</option>
                  <option value="adjust">Définir le stock exact</option>
                </select>
              </div>
              <div className="form-row">
                <label>{adjustType === 'adjust' ? 'Nouveau stock exact' : 'Quantité'}</label>
                <NumberField value={adjustQty} onValueChange={setAdjustQty} min={0} step="0.01" disabled={adjustBusy} />
              </div>
            </StepBody>
            <StepBody active={adjustWz.step === 2}>
              <div className="form-row">
                <label>Motif / note</label>
                <input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="Ex. inventaire physique, casse, réapprovisionnement…" disabled={adjustBusy} />
              </div>
            </StepBody>
          </div>
          <WizardFoot
            title={product.name}
            wz={adjustWz}
            stepLabel={(PH_ADJUST_STEPS[adjustWz.step - 1] || PH_ADJUST_STEPS[0]).label}
            onCancel={() => { if (!adjustBusy) setAdjustOpen(false); }}
            onNext={() => {
              if (adjustWz.step === 1 && (!Number.isFinite(adjustQty) || adjustQty <= 0)) {
                setAdjustError('Saisissez une quantité valide.');
                return false;
              }
              setAdjustError('');
              return true;
            }}
            onSubmit={() => void submitAdjust()}
            submitLabel="Enregistrer"
            saving={adjustBusy}
          />
        </div>
      </div></FloatingPortal>
    )}
    {editOpen && product && editForm && (
      <FloatingPortal><div className="modal-overlay" onClick={() => { if (!editBusy) setEditOpen(false); }}>
        <div className="modal step-wizard step-wizard--wide" role="dialog" aria-modal="true" aria-labelledby="ph-edit-title" onClick={(e) => e.stopPropagation()}>
          <WizardHeader
            eyebrow="CATALOGUE PRODUIT"
            title={`Modifier les détails — ${product.name}`}
            titleId="ph-edit-title"
            wz={editWz}
            steps={PH_EDIT_STEPS}
          />
          <div className="step-wizard__body">
            <WizardIntro step={PH_EDIT_STEPS[editWz.step - 1] || PH_EDIT_STEPS[0]} />
            {editError && <div className="error-msg" style={{ marginBottom: 10 }}>{editError}</div>}
            <StepBody active={editWz.step === 1}>
              <div className="grid grid-2">
                <div className="form-row"><label>Nom *</label><input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} disabled={editBusy} /></div>
                <div className="form-row"><label>Catégorie</label>
                  <select value={editForm.category} onChange={(e) => setEditForm({ ...editForm, category: e.target.value })} disabled={editBusy}>
                    <option value="">Sans catégorie</option>
                    {categories.map((c: any) => <option key={c.id ?? c.name} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-2">
                <div className="form-row"><label>SKU / Référence</label><input value={editForm.sku} onChange={(e) => setEditForm({ ...editForm, sku: e.target.value })} disabled={editBusy} /></div>
                <div className="form-row"><label>Code-barres</label><input value={editForm.barcode} onChange={(e) => setEditForm({ ...editForm, barcode: e.target.value })} disabled={editBusy} /></div>
              </div>
              <div className="form-row">
                <label>Description</label>
                <textarea rows={2} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} disabled={editBusy} />
                <div style={{ marginTop: 6 }}>
                  <button type="button" className="secondary" disabled={descGenerating || editBusy || !String(editForm.name || '').trim()} onClick={() => void generateEditDescription()}>
                    <Sparkles size={14} aria-hidden="true" /> {descGenerating ? 'Génération…' : 'Générer la description (IA)'}
                  </button>
                </div>
              </div>
            </StepBody>
            <StepBody active={editWz.step === 2}>
              <div className="grid grid-2">
                <div className="form-row"><label>Unité principale</label>
                  <select value={editForm.unit} onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })} disabled={editBusy}>
                    {units.length ? units.map((u: any) => <option key={u.id ?? u.name} value={u.name}>{u.name}</option>) : (
                      <>
                        <option value="pièce">pièce</option>
                        <option value="m²">m²</option>
                        <option value="kg">kg</option>
                        <option value="carton">carton</option>
                      </>
                    )}
                  </select>
                </div>
                <div className="form-row"><label>Seuil d’alerte</label><NumberField value={editForm.low_stock_threshold} onValueChange={(n) => setEditForm({ ...editForm, low_stock_threshold: n })} min={0} disabled={editBusy} /></div>
              </div>
              <div className="grid grid-2">
                <div className="form-row"><label>Deuxième unité (optionnel)</label><input value={editForm.secondary_unit} onChange={(e) => setEditForm({ ...editForm, secondary_unit: e.target.value })} placeholder="ex. m²" disabled={editBusy} /></div>
                <div className="form-row"><label>Coefficient (1 {editForm.unit || 'unité'} = …)</label><input value={editForm.secondary_unit_factor} onChange={(e) => setEditForm({ ...editForm, secondary_unit_factor: e.target.value })} placeholder="ex. 1.59" disabled={editBusy} /></div>
              </div>
              <div className="form-row">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={Boolean(editForm.track_inventory)} onChange={(e) => setEditForm({ ...editForm, track_inventory: e.target.checked })} disabled={editBusy} style={{ width: 'auto', display: 'inline' }} />
                  Suivre le stock pour ce produit
                </label>
              </div>
            </StepBody>
            <StepBody active={editWz.step === 3}>
              <div className="grid grid-2">
                <div className="form-row"><label>Prix de vente *</label><NumberField value={editForm.price} onValueChange={(n) => setEditForm({ ...editForm, price: n })} min={0} step="0.01" disabled={editBusy} /></div>
                <div className="form-row"><label>Coût</label><NumberField value={editForm.cost} onValueChange={(n) => setEditForm({ ...editForm, cost: n })} min={0} step="0.01" disabled={editBusy} /></div>
              </div>
              <div className="grid grid-2">
                <div className="form-row"><label>Taux TVA %</label><NumberField value={editForm.tax_rate} onValueChange={(n) => setEditForm({ ...editForm, tax_rate: n })} placeholder="Défaut" disabled={editBusy} /></div>
                <div className="form-row"><label>Prix sur facture</label>
                  <select value={editForm.invoice_price_mode} onChange={(e) => setEditForm({ ...editForm, invoice_price_mode: e.target.value })} disabled={editBusy}>
                    {!editForm.invoice_price_mode && <option value="">Mode historique (inchangé)</option>}
                    <option value="exclusive">TVA ajoutée au prix (HT)</option>
                    <option value="inclusive">TVA incluse dans le prix (TTC)</option>
                  </select>
                </div>
              </div>
            </StepBody>
          </div>
          <WizardFoot
            title={editForm.name || product.name}
            wz={editWz}
            stepLabel={(PH_EDIT_STEPS[editWz.step - 1] || PH_EDIT_STEPS[0]).label}
            onCancel={() => { if (!editBusy) setEditOpen(false); }}
            onNext={() => {
              if (editWz.step === 1 && !String(editForm.name || '').trim()) {
                setEditError('Le nom du produit est obligatoire.');
                return false;
              }
              setEditError('');
              return true;
            }}
            onSubmit={() => void submitEdit()}
            submitLabel="Enregistrer les modifications"
            saving={editBusy}
          />
        </div>
      </div></FloatingPortal>
    )}
    {lightboxOpen && product && productImageUrl(product.image_url) && (
      <ImageLightbox
        src={productImageUrl(product.image_url)}
        name={product.name || 'Photo du produit'}
        onClose={() => setLightboxOpen(false)}
      />
    )}
    <ProductLabelModal
      product={labelOpen ? product : null}
      onClose={() => setLabelOpen(false)}
    />
  </div>;
}
