import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useUi } from '../components/AppDialogs';
import { ImageWorkbench } from '../components/ProductImageEditor';
import RefreshIconButton from '../components/RefreshIconButton';

type Action = {
  id: number;
  type: string;
  title: string;
  detail: string;
  barcode?: string;
  status: string;
  created_at: string;
  completed_at?: string;
  product_id?: number;
  meta_json?: string;
};

function parseMeta(a: Action): any {
  try {
    return a.meta_json ? JSON.parse(a.meta_json) : {};
  } catch {
    return {};
  }
}

function autoSku(name: string, barcode: string): string {
  if (barcode.trim()) {
    const digits = barcode.replace(/\D/g, '');
    if (digits.length >= 4) return digits.slice(-8).toUpperCase();
    return barcode.trim().slice(0, 16).toUpperCase();
  }
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 12)
    .toUpperCase();
  return (base || 'SKU') + '-' + Date.now().toString(36).slice(-4).toUpperCase();
}

export default function Actions() {
  const { toast, prompt } = useUi();
  const [tab, setTab] = useState<'pending' | 'done' | 'all'>('pending');
  const [rows, setRows] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [approve, setApprove] = useState<Action | null>(null);
  const [stockApprove, setStockApprove] = useState<Action | null>(null);
  const [stockQty, setStockQty] = useState('');
  const [form, setForm] = useState({
    name: '',
    sku: '',
    barcode: '',
    price: '',
    cost: '',
    stock: '0',
    category: 'Épicerie',
    unit: 'unité',
    image_data_url: '' as string,
    image_url: '' as string,
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (soft = false) => {
    if (!soft) setLoading(true);
    setErr('');
    try {
      const res = await api.listMobileActions({
        status: tab === 'all' ? 'all' : tab === 'done' ? 'done' : 'pending',
        limit: 100,
      });
      setRows((res.data || []) as Action[]);
    } catch (e: any) {
      setErr(e.message || 'Erreur chargement');
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), 10000);
    return () => clearInterval(t);
  }, [load]);

  const complete = async (id: number) => {
    try {
      await api.completeMobileAction(id, { completed_by: 'pc' });
      toast('Action traitée');
      load(true);
    } catch (e: any) {
      toast(e.message || 'Erreur', 'error');
    }
  };

  const openApprove = async (a: Action) => {
    let full = a;
    try {
      const r: any = await api.getMobileAction(a.id);
      if (r?.data) full = r.data;
    } catch { /* use list row */ }
    const meta = parseMeta(full);
    const body = meta.create_product_body || {};
    const barcode = body.barcode || full.barcode || '';
    const name = body.name || '';
    const sku = body.sku || (barcode ? autoSku(name || 'PROD', barcode) : '');
    setForm({
      name,
      sku,
      barcode,
      price: body.unit_price != null ? String(body.unit_price) : body.price != null ? String(body.price) : '',
      cost: body.cost != null ? String(body.cost) : '',
      stock: body.stock_quantity != null ? String(body.stock_quantity) : '0',
      category: body.category || 'Épicerie',
      unit: body.unit || 'unité',
      image_data_url: String(body.image_data_url || body.data_url || meta.image_data_url || ''),
      image_url: String(body.image_url || meta.image_url || ''),
    });
    setApprove(full);
  };

  const submitApprove = async () => {
    if (!approve) return;
    if (!form.name.trim()) {
      toast('Le nom du produit est obligatoire', 'error');
      return;
    }
    if (form.price !== '' && Number(form.price) < 0) {
      toast('Prix invalide', 'error');
      return;
    }
    const sku = (form.sku.trim() || autoSku(form.name, form.barcode)).toUpperCase();
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        sku,
        barcode: form.barcode.trim() || sku,
        price: Number(form.price) || 0,
        unit_price: Number(form.price) || 0,
        cost: Number(form.cost) || 0,
        stock_quantity: Number(form.stock) || 0,
        category: form.category || 'Épicerie',
        unit: form.unit || 'unité',
        track_inventory: true,
        tax_rate: 20,
      };
      if (form.image_url) body.image_url = form.image_url;
      const created: any = await api.createProduct(body);
      const newId = Number(created?.data?.id || created?.id);
      if (newId && (form.image_data_url || form.image_url)) {
        try {
          await api.addProductImage(newId, {
            data_url: form.image_data_url || undefined,
            url: form.image_url || undefined,
            is_primary: true,
            alt_text: form.name.trim(),
          });
        } catch { /* image optional */ }
      }
      await api.completeMobileAction(approve.id, { completed_by: 'pc' });
      toast('Produit enregistré dans le catalogue · demande clôturée');
      setApprove(null);
      load(true);
    } catch (e: any) {
      // Allow force duplicate if API supports it
      if (e.code === 'DUPLICATE_PRODUCT') {
        try {
          await api.createProduct({
            name: form.name.trim(),
            sku: (form.sku.trim() || autoSku(form.name, form.barcode) + '-2').toUpperCase(),
            barcode: form.barcode.trim() || undefined,
            price: Number(form.price) || 0,
            unit_price: Number(form.price) || 0,
            stock_quantity: Number(form.stock) || 0,
            category: form.category || 'Épicerie',
            unit: form.unit || 'unité',
            track_inventory: true,
            force_duplicate: true,
          });
          await api.completeMobileAction(approve.id, { completed_by: 'pc' });
          toast('Produit créé (doublon forcé)');
          setApprove(null);
          load(true);
          return;
        } catch (e2: any) {
          toast(e2.message || e.message || 'Erreur création', 'error');
        }
      } else {
        toast(e.message || 'Erreur création', 'error');
      }
    } finally {
      setBusy(false);
    }
  };

  const needsProductApproval = (a: Action) => {
    if (a.type !== 'new_product' || a.status !== 'pending') return false;
    const meta = parseMeta(a);
    return meta.needs_approval || meta.create_product || !a.product_id;
  };

  const needsStockApproval = (a: Action) => {
    if (a.type !== 'stock_check' || a.status !== 'pending') return false;
    const meta = parseMeta(a);
    if (meta.cycle_batch && Array.isArray(meta.lines) && meta.lines.length) return true;
    return !!(meta.adjust_stock || meta.proposed_stock != null) && !!a.product_id;
  };

  const needsInvoiceApproval = (a: Action) => {
    if (a.type !== 'invoice' || a.status !== 'pending') return false;
    const meta = parseMeta(a);
    return !!(meta.needs_approval || meta.quick_sale || meta.create_invoice_body);
  };

  const submitInvoiceApprove = async (a: Action) => {
    const meta = parseMeta(a);
    const body = meta.create_invoice_body || {};
    if (!body.items || !Array.isArray(body.items) || !body.items.length) {
      toast('Panier manquant dans la demande', 'error');
      return;
    }
    setBusy(true);
    try {
      const invBody = {
        client_id: body.client_id || null,
        client_name: body.client_name || 'Comptoir',
        status: 'paid',
        quick_sale: true,
        doc_kind: 'quick_sale',
        tax_exempt: body.tax_exempt !== false,
        notes: body.notes || 'Vente rapide validée depuis le téléphone',
        items: body.items,
      };
      const inv: any = await api.createInvoice(invBody);
      const invId = inv?.data?.id;
      const invTotal = Number(inv?.data?.total || meta.total || 0);
      if (invId && invTotal > 0) {
        try {
          await api.recordInvoicePayment(invId, {
            amount: invTotal,
            payment_method: 'cash',
            payee: 'company',
            note: 'Validation vente rapide mobile (PC)',
          });
        } catch {
          try {
            await api.updateInvoiceStatus(invId, { status: 'paid', amount_paid: invTotal });
          } catch { /* */ }
        }
      }
      await api.completeMobileAction(a.id, { completed_by: 'pc' });
      toast(inv?.data?.number ? `Ticket ${inv.data.number} créé et payé` : 'Vente validée');
      load(true);
    } catch (e: any) {
      toast(e.message || 'Erreur validation vente', 'error');
    } finally {
      setBusy(false);
    }
  };

  const openStockApprove = (a: Action) => {
    const meta = parseMeta(a);
    setStockQty(
      meta.proposed_stock != null ? String(meta.proposed_stock) : meta.stock != null ? String(meta.stock) : '0'
    );
    setStockApprove(a);
  };

  const submitStockApprove = async () => {
    if (!stockApprove) return;
    const meta = parseMeta(stockApprove);
    setBusy(true);
    try {
      if (meta.cycle_batch && Array.isArray(meta.lines)) {
        await api.completeMobileAction(stockApprove.id, {
          completed_by: 'pc',
          apply_stock: true,
        });
        toast(`Inventaire ${meta.lines.length} produit(s) appliqué`);
      } else {
        if (!stockApprove.product_id) return;
        const qty = Number(stockQty);
        if (!Number.isFinite(qty) || qty < 0) {
          toast('Stock invalide', 'error');
          setBusy(false);
          return;
        }
        await api.completeMobileAction(stockApprove.id, {
          completed_by: 'pc',
          apply_stock: true,
          product_id: stockApprove.product_id,
          proposed_stock: qty,
        });
        toast(`Stock mis à jour → ${qty}`);
      }
      setStockApprove(null);
      load(true);
    } catch (e: any) {
      toast(e.message || 'Erreur ajustement stock', 'error');
    } finally {
      setBusy(false);
    }
  };

  const rejectAction = async (a: Action) => {
    const reason = await prompt({
      title: 'Refuser la demande',
      message: 'Motif du refus (visible sur le téléphone). Obligatoire.',
      placeholder: 'Ex. prix incorrect, produit déjà en stock…',
      confirmLabel: 'Refuser',
    });
    if (reason == null) return;
    if (!String(reason).trim()) {
      toast('Motif obligatoire', 'error');
      return;
    }
    setBusy(true);
    try {
      await api.rejectMobileAction(a.id, String(reason).trim());
      toast('Demande refusée');
      load(true);
    } catch (e: any) {
      toast(e.message || 'Refus impossible', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="atlas-page">
      <div className="page-header">
        <div>
          <p className="atlas-eyebrow">Espace partagé</p>
          <h1 className="atlas-hello" style={{ fontSize: '1.75rem' }}>Boîte d&apos;actions</h1>
          <p className="atlas-lead" style={{ marginBottom: 0 }}>
            Scans et demandes du téléphone — validez ici.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/products" className="btn secondary" style={{ textDecoration: 'none' }}>
            Produits
          </Link>
          <RefreshIconButton onClick={() => load(true)} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {(['pending', 'done', 'all'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={tab === t ? '' : 'secondary'}
            onClick={() => setTab(t)}
            style={{ borderRadius: 999, padding: '8px 16px' }}
          >
            {t === 'pending' ? 'En attente' : t === 'done' ? 'Terminées' : 'Toutes'}
          </button>
        ))}
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600 }}>
          {rows.length} ENREGISTREMENTS
        </span>
      </div>

      {loading && rows.length === 0 && (
        <div className="empty-state">
          <div className="skeleton" style={{ height: 16, width: 160, margin: '0 auto' }} />
        </div>
      )}
      {err && (
        <div className="empty-state" style={{ color: 'var(--bad)' }}>
          {err}
        </div>
      )}
      {!loading && !err && rows.length === 0 && (
        <div className="empty-state">
          <div className="empty-state__title">Aucune action</div>
          <div className="empty-state__desc">
            Quand le téléphone envoie un scan ou une demande produit, elle apparaît ici.
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((a) => {
          const approveNeeded = needsProductApproval(a);
          const stockNeeded = needsStockApproval(a);
          const meta = parseMeta(a);
          return (
            <div
              key={a.id}
              className="ac-panel"
              style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', flexWrap: 'wrap' }}
            >
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: '50%',
                  background:
                    a.type === 'stock_check'
                      ? 'var(--bad-bg)'
                      : a.type === 'new_product'
                        ? 'var(--warn-bg)'
                        : 'var(--zellij-soft)',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {(a.type || 'AC').slice(0, 2).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    color: 'var(--muted)',
                    textTransform: 'uppercase',
                  }}
                >
                  {a.type} · {a.created_at?.replace('T', ' ').slice(0, 16)}
                </div>
                <div style={{ fontWeight: 600 }}>{a.title}</div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {a.detail}
                </div>
                {stockNeeded && meta.proposed_stock != null && (
                  <div style={{ fontSize: 13, marginTop: 4 }}>
                    Stock proposé : <strong>{meta.proposed_stock}</strong>
                    {meta.stock != null ? ` (système ${meta.stock})` : ''}
                  </div>
                )}
                {stockNeeded && meta.cycle_batch && Array.isArray(meta.lines) && (
                  <div style={{ fontSize: 13, marginTop: 4 }}>
                    Inventaire lot : <strong>{meta.lines.length}</strong> ligne(s)
                  </div>
                )}
                {a.barcode && (
                  <div className="muted" style={{ fontSize: 12, fontFamily: 'monospace' }}>
                    #{a.barcode}
                  </div>
                )}
                {(a as any).source && (
                  <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 4px' }}>
                    Source : {(a as any).source}
                  </p>
                )}
                {a.status === 'cancelled' && meta.reject_reason && (
                  <div style={{ fontSize: 12, color: 'var(--bad)', marginTop: 4 }}>
                    Refus : {meta.reject_reason}
                  </div>
                )}
              </div>
              {a.status === 'pending' ? (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {approveNeeded && (
                    <button type="button" onClick={() => openApprove(a)}>
                      Approuver le produit
                    </button>
                  )}
                  {stockNeeded && (
                    <button type="button" onClick={() => openStockApprove(a)}>
                      {meta.cycle_batch ? 'Appliquer inventaire' : 'Approuver le stock'}
                    </button>
                  )}
                  {needsInvoiceApproval(a) && (
                    <button type="button" className="primary" disabled={busy} onClick={() => submitInvoiceApprove(a)}>
                      Marquer payé
                    </button>
                  )}
                  <button type="button" className="secondary" onClick={() => complete(a.id)}>
                    Marquer traité
                  </button>
                  <button type="button" className="danger" disabled={busy} onClick={() => rejectAction(a)}>
                    Refuser
                  </button>
                </div>
              ) : a.status === 'cancelled' ? (
                <span className="badge" style={{ background: 'var(--bad-bg)' }}>Refusé</span>
              ) : (
                <span className="badge success">Traité</span>
              )}
            </div>
          );
        })}
      </div>

      {approve && (
        <div className="modal-overlay" onClick={() => !busy && setApprove(null)}>
          <div className="modal-card" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <h3>Approuver la création produit</h3>
            <p>Même formulaire que Produits. Le produit est ajouté au catalogue, puis la demande est clôturée.</p>
            <div className="form-row">
              <label>Nom *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Réf. (SKU) — auto si vide</label>
              <input
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                placeholder="Généré depuis le code-barres"
              />
            </div>
            <div className="form-row">
              <label>Code-barres</label>
              <input value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Prix (MAD)</label>
              <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" />
            </div>
            <div className="form-row">
              <label>Coût (MAD)</label>
              <input value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} inputMode="decimal" />
            </div>
            <div className="form-row">
              <label>Stock initial</label>
              <input value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} inputMode="numeric" />
            </div>
            <div className="form-row">
              <label>Catégorie</label>
              <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Unité</label>
              <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
            </div>
            {(form.image_data_url || form.image_url) && (
              <div className="form-row">
                <label>Photo (téléphone) — recadrez / tournez avant d’approuver</label>
                <ImageWorkbench
                  src={form.image_data_url || form.image_url}
                  onChange={(next) => setForm({ ...form, image_data_url: next })}
                  compact
                />
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="secondary" disabled={busy} onClick={() => setApprove(null)}>
                Annuler
              </button>
              <button type="button" disabled={busy} onClick={submitApprove}>
                {busy ? 'Création…' : 'Créer et approuver'}
              </button>
            </div>
          </div>
        </div>
      )}

      {stockApprove && (
        <div className="modal-overlay" onClick={() => !busy && setStockApprove(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>
              {parseMeta(stockApprove).cycle_batch
                ? 'Appliquer l’inventaire lot'
                : 'Approuver l’ajustement de stock'}
            </h3>
            <p>
              {stockApprove.title}
              <br />
              <span className="muted">{stockApprove.detail}</span>
            </p>
            {parseMeta(stockApprove).cycle_batch ? (
              <p style={{ fontSize: 13 }}>
                {(parseMeta(stockApprove).lines || []).length} ligne(s) seront appliquées au stock système.
              </p>
            ) : (
              <div className="form-row">
                <label>Nouveau stock (quantité réelle)</label>
                <input
                  value={stockQty}
                  onChange={(e) => setStockQty(e.target.value)}
                  inputMode="numeric"
                  autoFocus
                />
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="secondary" disabled={busy} onClick={() => setStockApprove(null)}>
                Annuler
              </button>
              <button type="button" disabled={busy} onClick={submitStockApprove}>
                {busy ? 'Application…' : parseMeta(stockApprove).cycle_batch ? 'Appliquer inventaire' : 'Appliquer le stock'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
