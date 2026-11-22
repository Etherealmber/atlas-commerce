import { useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { getRole } from '../auth';
import PhoneDialog from './PhoneDialog';

/** Admins create directly; other roles submit an approval request, never a product write. */
export default function PhoneProductCreate({ onClose, onCreated }: { onClose: () => void; onCreated: (direct: boolean) => void }) {
  const role = getRole(); const direct = role === 'owner' || role === 'admin';
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const sending = useRef(false);
  const close = () => { if (!sending.current) onClose(); };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (sending.current) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') || '').trim(); const sku = String(form.get('sku') || '').trim();
    const barcode = String(form.get('barcode') || '').trim(); const unit = String(form.get('unit') || '').trim();
    const category = String(form.get('category') || '').trim(); const note = String(form.get('note') || '').trim();
    const quantity = Number(form.get('quantity')); const price = direct ? Number(form.get('price')) : 0;
    const photo = form.get('photo'); const file = photo instanceof File && photo.size ? photo : null;
    if (!name || !unit || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(price) || price < 0) { setError('Indiquez un nom, une unité et des nombres valides supérieurs ou égaux à zéro.'); return; }
    if (file && (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type) || file.size > 4_000_000)) { setError('Choisissez une image JPG, PNG, WebP ou GIF de 4 Mo maximum.'); return; }
    sending.current = true; setBusy(true); setError('');
    try {
      const image = file ? await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.addEventListener('load', () => resolve(String(reader.result || '')), { once: true }); reader.addEventListener('error', () => reject(new Error('Lecture de l’image impossible.')), { once: true }); reader.readAsDataURL(file); }) : '';
      const body = { name, sku, barcode, unit, category: category || 'General', stock_quantity: quantity, price, description: note };
      let sender = ''; try { sender = localStorage.getItem('stock_auth_user') || ''; } catch { /* no cached identity */ }
      if (direct) await api.createProduct({ ...body, ...(image ? { image_url: image } : {}) });
      else await api.createMobileAction({ type: 'new_product', source: 'web', ...(sender ? { created_by: sender } : {}), title: `Nouveau produit à créer : ${name}`, detail: [sku && `Réf : ${sku}`, barcode && `Code : ${barcode}`, `Quantité : ${quantity} ${unit}`, note].filter(Boolean).join(' · '), barcode: barcode || sku || undefined, meta: { target_role: 'admin', needs_approval: true, category: 'product_creation_request', create_product_body: { ...body, ...(image ? { image_data_url: image } : {}) } } });
      onCreated(direct);
    } catch (e) { setError(e instanceof Error ? e.message : 'Impossible de soumettre le produit. Réessayez.'); }
    finally { sending.current = false; setBusy(false); }
  };
  return <PhoneDialog titleId="ph-create-title" onClose={close} className="ph-create-dialog">
    <form className="ph-create-form" onSubmit={submit}>
      <h2 id="ph-create-title">{direct ? 'Créer un produit' : 'Demander un produit à l’Admin'}</h2>
      <p>{direct ? 'Le produit sera ajouté au catalogue.' : 'Votre demande sera envoyée pour validation ; le catalogue ne sera pas modifié directement.'}</p>
      <label>Nom *<input name="name" maxLength={120} required autoComplete="off" /></label>
      <label>Référence / SKU<input name="sku" maxLength={80} autoComplete="off" /></label>
      <label>Code-barres<input name="barcode" maxLength={120} autoComplete="off" /></label>
      <div className="ph-create-fields"><label>Unité *<input name="unit" defaultValue="unité" maxLength={40} required /></label><label>Stock initial *<input name="quantity" type="number" min="0" step="any" defaultValue="0" required inputMode="decimal" /></label></div>
      <label>Catégorie<input name="category" maxLength={120} /></label>
      <label>Photo facultative (4 Mo maximum)<input name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label>
      {direct && <label>Prix de vente (MAD)<input name="price" type="number" min="0" step="any" defaultValue="0" inputMode="decimal" /></label>}
      <label>Note<textarea name="note" rows={2} maxLength={500} /></label>
      {error && <p role="alert">{error}</p>}
      <div className="ph-create-actions"><button type="button" className="secondary" disabled={busy} onClick={close}>Annuler</button><button type="submit" disabled={busy}>{busy ? 'Envoi…' : direct ? 'Créer le produit' : 'Envoyer la demande'}</button></div>
    </form>
  </PhoneDialog>;
}
