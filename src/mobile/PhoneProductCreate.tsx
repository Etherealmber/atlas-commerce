import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { getRole } from '../auth';
import PhoneDialog from './PhoneDialog';
import { bounceDialogOf } from '../lib/unsavedGuard';
import { dualStockLabel, mergeUnitOptions, type UnitOption } from '../lib/dualUnit';
import Select from '../components/ui/Select';

/** Admins create directly; other roles submit an approval request, never a product write. */
export default function PhoneProductCreate({ onClose, onCreated }: { onClose: () => void; onCreated: (direct: boolean) => void }) {
  const role = getRole(); const direct = role === 'owner' || role === 'admin';
  const [units, setUnits] = useState<UnitOption[]>(() => mergeUnitOptions());
  const [baseUnitChoice, setBaseUnitChoice] = useState('unité');
  const [customBaseUnit, setCustomBaseUnit] = useState('');
  const [secondUnitChoice, setSecondUnitChoice] = useState('');
  const [customSecondUnit, setCustomSecondUnit] = useState('');
  const [factorText, setFactorText] = useState(''); const [stockText, setStockText] = useState('0');
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const sending = useRef(false);
  // Same step model as the web wizards: short screens, no long scroll. Every
  // field stays mounted (hidden steps), so the FormData submit is unchanged.
  const [step, setStep] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const baseUnit = baseUnitChoice === '__custom__' ? customBaseUnit : baseUnitChoice;
  const secondUnit = secondUnitChoice === '__custom__' ? customSecondUnit : secondUnitChoice;
  useEffect(() => {
    let active = true;
    api.getUnits?.().then((r) => {
      if (active && Array.isArray(r?.data)) setUnits(mergeUnitOptions(r.data));
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  const close = () => { if (!sending.current) onClose(); };
  const STEPS = ['Produit', 'Stock', direct ? 'Prix' : 'Photo'];
  const stepValid = (i: number) => {
    const form = formRef.current; if (!form) return true;
    const fields = Array.from(form.querySelectorAll(`[data-step="${i}"] input, [data-step="${i}"] select`)) as Array<HTMLInputElement | HTMLSelectElement>;
    const bad = fields.find((f) => !f.checkValidity());
    if (!bad) return true;
    setError(i === 0 ? 'Indiquez au moins le nom du produit.' : 'Indiquez une unité et un stock initial valides (≥ 0).');
    return false;
  };
  const next = () => {
    if (!stepValid(step)) { bounceDialogOf(formRef.current); return; }
    setError(''); setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };
  const jump = (i: number) => {
    if (i <= step) { setError(''); setStep(i); return; }
    for (let k = step; k < i; k++) if (!stepValid(k)) { setStep(k); bounceDialogOf(formRef.current); return; }
    setError(''); setStep(i);
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (sending.current) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') || '').trim(); const sku = String(form.get('sku') || '').trim();
    const barcode = String(form.get('barcode') || '').trim(); const unit = String(form.get('unit') || '').trim();
    const category = String(form.get('category') || '').trim(); const note = String(form.get('note') || '').trim();
    const second = String(form.get('secondary_unit') || '').trim(); const rawFactor = String(form.get('secondary_unit_factor') || '').trim(); const factor = Number(rawFactor.replace(',', '.'));
    if ((second || rawFactor) && (!second || !rawFactor || !Number.isFinite(factor) || factor <= 0 || factor > 1_000_000_000 || second.toLowerCase() === unit.toLowerCase())) { setError('Indiquez une deuxième unité différente et un coefficient positif valide.'); return; }
    const quantity = Number(form.get('quantity')); const price = direct ? Number(form.get('price')) : 0;
    const photo = form.get('photo'); const file = photo instanceof File && photo.size ? photo : null;
    if (!name || !unit || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(price) || price < 0) { setError('Indiquez un nom, une unité et des nombres valides supérieurs ou égaux à zéro.'); return; }
    if (file && (!/^image\/(jpeg|png|webp|gif)$/i.test(file.type) || file.size > 4_000_000)) { setError('Choisissez une image JPG, PNG, WebP ou GIF de 4 Mo maximum.'); return; }
    sending.current = true; setBusy(true); setError('');
    try {
      const image = file ? await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.addEventListener('load', () => resolve(String(reader.result || '')), { once: true }); reader.addEventListener('error', () => reject(new Error('Lecture de l’image impossible.')), { once: true }); reader.readAsDataURL(file); }) : '';
      const requestBody = { name, sku, unit, stock_quantity: quantity, ...(second ? { secondary_unit: second, secondary_unit_factor: factor } : {}) };
      const body = { ...requestBody, barcode, category: category || 'General', price, description: note, invoice_price_mode: String(form.get('invoice_price_mode') || 'exclusive') };
      if (direct) await api.createProduct({ ...body, ...(image ? { image_url: image } : {}) });
      else await api.createMobileAction({ type: 'new_product', source: 'web', title: `Nouveau produit à créer : ${name}`, detail: [sku && `Réf : ${sku}`, `Quantité : ${quantity} ${unit}`].filter(Boolean).join(' · '), barcode: sku || undefined, meta: { target_role: 'admin', needs_approval: true, category: 'product_creation_request', create_product_body: { ...requestBody, ...(image ? { image_data_url: image } : {}) } } });
      onCreated(direct);
    } catch (e) { setError(e instanceof Error ? e.message : 'Impossible de soumettre le produit. Réessayez.'); }
    finally { sending.current = false; setBusy(false); }
  };
  return <PhoneDialog titleId="ph-create-title" onClose={close} className="ph-create-dialog">
    <form ref={formRef} className="ph-create-form ph-wz" onSubmit={submit} noValidate onKeyDown={(e) => { if (e.key === 'Enter' && step < STEPS.length - 1 && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); next(); } }}>
      <h2 id="ph-create-title">{direct ? 'Créer un produit' : 'Demander un produit à l’Admin'}</h2>
      <p>{direct ? 'Le produit sera ajouté au catalogue.' : 'Votre demande sera envoyée pour validation ; le catalogue ne sera pas modifié directement.'}</p>
      <ol className="ph-wz-steps" aria-label="Étapes">
        {STEPS.map((label, i) => (
          <li key={label}>
            <button type="button" className={`ph-wz-step${i === step ? ' is-on' : ''}${i < step ? ' is-done' : ''}`} aria-current={i === step ? 'step' : undefined} onClick={() => jump(i)}>
              <span>{i + 1}</span>{label}
            </button>
          </li>
        ))}
      </ol>
      <div className="ph-wz-progress" aria-hidden="true"><span style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} /></div>
      <fieldset data-step="0" className="ph-wz-page" hidden={step !== 0}>
      <label>Nom *<input name="name" maxLength={120} required autoComplete="off" /></label>
      <label>Référence / SKU<input name="sku" maxLength={80} autoComplete="off" /></label>
      {direct && <label>Code-barres<input name="barcode" maxLength={120} autoComplete="off" /></label>}
      {direct && <label>Catégorie<input name="category" maxLength={120} /></label>}
      </fieldset>
      <fieldset data-step="1" className="ph-wz-page" hidden={step !== 1}>
      <div className="ph-create-fields">
        <label>Unité principale *
          <Select
            name={baseUnitChoice === '__custom__' ? undefined : 'unit'}
            value={baseUnitChoice}
            onChange={e => setBaseUnitChoice(e.target.value)}
            required={baseUnitChoice !== '__custom__'}
          >
            {units.map((u) => (
              <option key={u.id ?? u.name} value={u.name}>{u.symbol ? `${u.name} (${u.symbol})` : u.name}</option>
            ))}
            <option value="__custom__">Autre unité…</option>
          </Select>
          {baseUnitChoice === '__custom__' && (
            <input name="unit" value={customBaseUnit} onChange={e => setCustomBaseUnit(e.target.value)} maxLength={40} placeholder="Nom de l’unité" required />
          )}
        </label>
        <label>Stock initial *<input name="quantity" type="number" min="0" step="any" value={stockText} onChange={e => setStockText(e.target.value)} required inputMode="decimal" /></label>
      </div>
      <div className="ph-create-fields">
        <label>Deuxième unité (facultatif)
          <Select
            name={secondUnitChoice === '__custom__' ? undefined : 'secondary_unit'}
            value={secondUnitChoice}
            onChange={e => {
              const val = e.target.value;
              setSecondUnitChoice(val);
              if (!val) { setCustomSecondUnit(''); setFactorText(''); }
            }}
          >
            <option value="">— Aucune —</option>
            {units.map((u) => (
              <option
                key={u.id ?? u.name}
                value={u.name}
                disabled={Boolean(baseUnit) && u.name.toLowerCase() === baseUnit.trim().toLowerCase()}
              >
                {u.symbol ? `${u.name} (${u.symbol})` : u.name}
              </option>
            ))}
            <option value="__custom__">Autre unité…</option>
          </Select>
          {secondUnitChoice === '__custom__' && (
            <input name="secondary_unit" value={customSecondUnit} onChange={e => setCustomSecondUnit(e.target.value)} maxLength={40} placeholder="Ex. m²" />
          )}
        </label>
        <label>Quantité par {baseUnit || 'unité'}<input name="secondary_unit_factor" inputMode="decimal" value={factorText} onChange={e => setFactorText(e.target.value)} placeholder="Ex. 1,59" /></label>
      </div>
      <p>Exemple : 1 carton = 1,59 m². Stock et prix sont enregistrés par unité principale.{secondUnit && Number(factorText.replace(',', '.')) > 0 ? ` Stock : ${dualStockLabel({ unit: baseUnit, secondary_unit: secondUnit, secondary_unit_factor: Number(factorText.replace(',', '.')), stock_quantity: Number(stockText) || 0 })}` : ''}</p>
      </fieldset>
      <fieldset data-step="2" className="ph-wz-page" hidden={step !== 2}>
      <label>Photo facultative (4 Mo maximum)<input name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif" /></label>
      {direct && <label>Prix de vente (MAD)<input name="price" type="number" min="0" step="any" defaultValue="0" inputMode="decimal" /></label>}
      {direct && <><label>Prix sur facture<Select name="invoice_price_mode" defaultValue="exclusive"><option value="exclusive">TVA ajoutée au prix (HT)</option><option value="inclusive">TVA incluse dans le prix (TTC)</option></Select></label><p>Les ventes rapides utilisent le prix sans TVA.</p><label>Note<textarea name="note" rows={2} maxLength={500} /></label></>}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <div className="ph-create-actions">
        {step === 0
          ? <button type="button" className="secondary" disabled={busy} onClick={close}>Annuler</button>
          : <button type="button" className="secondary" disabled={busy} onClick={() => { setError(''); setStep(step - 1); }}>Retour</button>}
        {step < STEPS.length - 1
          ? <button type="button" onClick={next}>Continuer</button>
          : <button type="submit" disabled={busy}>{busy ? 'Envoi…' : direct ? 'Créer le produit' : 'Envoyer la demande'}</button>}
      </div>
    </form>
  </PhoneDialog>;
}
