import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Camera, History, RefreshCw } from 'lucide-react';
import { api } from '../api';
import { canSell } from '../auth';
import ProductArtwork from '../components/ProductArtwork';
import PhoneSkeleton from '../mobile/PhoneSkeleton';
import './product-history.css';

const PAGE_SIZE = 40;
const types: Record<string, string> = { initial: 'Stock initial', sale: 'Vente', purchase: 'Achat', restock: 'Réapprovisionnement', refund_restock: 'Réapprovisionnement', in: 'Entrée', out: 'Sortie', adjust: 'Ajustement', adjustment: 'Ajustement', transfer: 'Transfert', return: 'Retour' };
const actor = (value: unknown, fallback: string) => typeof value === 'string' && value.trim() ? value : fallback;
const quantity = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('fr-FR', { maximumFractionDigits: 3 }) : '—';

type Props = { mobile?: boolean; onProductUpdated?: () => void };
export default function ProductHistory({ mobile = false, onProductUpdated }: Props) {
  const { id } = useParams(); const productId = Number(id);
  const valid = /^\d+$/.test(id || '') && Number.isSafeInteger(productId) && productId > 0;
  const [product, setProduct] = useState<any>(null); const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true); const [loadingMore, setLoadingMore] = useState(false);
  const [productError, setProductError] = useState(''); const [error, setError] = useState(''); const [hasMore, setHasMore] = useState(false);
  const [imageBusy, setImageBusy] = useState(false); const [imageMessage, setImageMessage] = useState('');
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
  return <div className={`product-history${mobile ? ' product-history--phone' : ''}`}>
    {!mobile && <header className="product-history-top"><Link to="/products" aria-label="Retour aux produits"><ArrowLeft size={22} /></Link><div><h1>Historique du produit</h1><p>Détails et mouvements de stock</p></div></header>}
    {productError && <div className="product-history-card" role="alert">{productError} {valid && <button type="button" onClick={() => void load()}>Réessayer</button>}</div>}
    {loading && !product && (mobile ? <PhoneSkeleton variant="rows" label="Chargement du produit" /> : <p role="status">Chargement du produit…</p>)}
    {product && <section className="product-history-card"><div className="product-history-hero"><div className="product-history-photo"><ProductArtwork url={product.image_url} />{canSell() && <><input ref={imageInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={changePhoto} /><button type="button" className="secondary product-history-photo-action" aria-label="Modifier la photo du produit" title="Modifier la photo du produit" disabled={imageBusy} onClick={() => imageInput.current?.click()}><Camera size={16} /></button></>}</div><div><span className="product-history-tag">Fiche produit</span><h2>{product.name}</h2><p>{[product.sku, product.barcode, product.category].filter(Boolean).join(' · ') || 'Sans référence'}</p></div></div>
      <p className="product-history-actors">Créé par {actor(product.created_by, 'non renseigné')} · Approuvé par {actor(product.approved_by, 'non transmis par le serveur')}</p>
      {imageMessage && <p role="status">{imageMessage}</p>}
      <div className="product-history-chips"><span>{product.track_inventory != null && !Number(product.track_inventory) ? 'Stock non suivi' : `Stock ${quantity(product.stock_quantity ?? product.stock)} ${product.unit || ''}`}</span>{canSell() && typeof product.price === 'number' && <span>{product.price.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MAD</span>}</div>
    </section>}
    <section className="product-history-card"><div className="product-history-section-head"><History size={20} /><h2>Historique des mouvements</h2>{!loading && !error && <span className="product-history-tag">{rows.length}{hasMore ? '+' : ''}</span>}<button type="button" className="secondary product-history-refresh" aria-label="Actualiser l’historique" title="Actualiser l’historique" disabled={loading} onClick={() => void refreshMovements()}><RefreshCw size={19} /></button></div>
      {loading && (mobile && !rows.length ? <PhoneSkeleton variant="rows" label="Chargement des mouvements" /> : <p role="status">Actualisation des mouvements…</p>)}
      {error && <p role="alert">{error} <button type="button" onClick={() => void refreshMovements()}>Réessayer</button></p>}
      {!loading && !error && rows.length === 0 && <p>Aucun mouvement enregistré pour ce produit.</p>}
      {rows.map((m, index) => <div className="product-history-movement" key={m.id ?? `${m.created_at}-${index}`}><div><strong>{types[String(m.type || '').toLowerCase()] || m.type || 'Mouvement'}</strong><time>{String(m.created_at || '—').replace('T', ' ').slice(0, 16)}</time></div><p>Qté {quantity(m.quantity)} · {quantity(m.previous_quantity)} → {quantity(m.new_quantity)}</p>{(m.reason || m.reference) && <p>{[m.reason, m.reference].filter(Boolean).join(' · ')}</p>}<small>Créé par {actor(m.created_by, 'non renseigné')} · Approuvé par {actor(m.approved_by, 'non transmis par le serveur')}</small></div>)}
      {hasMore && <button type="button" className="product-history-more" disabled={loadingMore} onClick={() => void more()}>{loadingMore ? 'Chargement…' : 'Charger la suite'}</button>}
    </section>
  </div>;
}
