import TopPageActions from '../components/TopPageActions';
import {
  CheckCircle2,
  ClipboardCheck,
  Package,
  PackagePlus,
  X,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useUi } from '../components/AppDialogs';
import { ImageWorkbench } from '../components/ProductImageEditor';
import RefreshIconButton from '../components/RefreshIconButton';
import { ModalFormError } from '../components/ModalFormFeedback';
import { mergeUnitOptions, type UnitOption } from '../lib/dualUnit';
import ListPager from '../components/ui/ListPager';
import EmptyState from '../components/EmptyState';

type Action = {
  id: number;
  type: string;
  title: string;
  detail: string;
  barcode?: string;
  status: string;
  created_at: string;
  completed_at?: string;
  created_by?: string;
  completed_by?: string;
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
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;
  useEffect(() => { setPage(0); }, [tab]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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
    invoice_price_mode: 'exclusive',
    stock: '0',
    category: 'Épicerie',
    unit: 'unité',
    secondary_unit: '',
    secondary_unit_factor: '',
    image_data_url: '' as string,
    image_url: '' as string,
  });
  const [units, setUnits] = useState<UnitOption[]>(() => mergeUnitOptions());
  const [busy, setBusy] = useState(false);

  const loadUnits = useCallback(async () => {
    try {
      const r = await api.getUnits();
      setUnits(mergeUnitOptions(r.data || []));
    } catch { /* keep defaults */ }
  }, []);

  const addUnit = async (target: 'unit' | 'secondary_unit') => {
    const name = await prompt({
      title: 'Nouvelle unité',
      message: 'Ex. palette, sachet…',
      placeholder: "Nom de l'unité",
    });
    if (!name?.trim()) return;
    const clean = name.trim();
    try {
      await api.createUnit({ name: clean });
      await loadUnits();
      setForm((f) => ({ ...f, [target]: clean }));
      toast('Unité créée');
    } catch (e: any) {
      toast(e?.message || 'Erreur unité', 'error');
    }
  };

  const load = useCallback(async (soft = false) => {
    if (soft) setRefreshing(true);
    else setLoading(true);
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
      setRefreshing(false);
    }
  }, [tab]);

  useEffect(() => {
    load();
    void loadUnits();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load(true);
    }, 90000);
    const onVisibility = () => { if (document.visibilityState === 'visible') load(true); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load, loadUnits]);

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
      invoice_price_mode: 'exclusive',
      stock: body.stock_quantity != null ? String(body.stock_quantity) : '0',
      category: body.category || 'Épicerie',
      unit: body.unit || 'unité',
      secondary_unit: String(body.secondary_unit || ''),
      secondary_unit_factor: body.secondary_unit_factor != null ? String(body.secondary_unit_factor) : '',
      image_data_url: String(body.image_data_url || body.data_url || meta.image_data_url || ''),
      image_url: String(body.image_url || meta.image_url || ''),
    });
    setErr('');
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
    const second = form.secondary_unit.trim();
    const rawFactor = form.secondary_unit_factor.trim();
    const factor = Number(rawFactor.replace(',', '.'));
    if ((second || rawFactor) && (!second || !rawFactor || !Number.isFinite(factor) || factor <= 0 || factor > 1_000_000_000 || second.toLowerCase() === form.unit.trim().toLowerCase())) {
      setErr('Indiquez une deuxième unité différente et un coefficient positif valide.'); return;
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
        ...(second ? { secondary_unit: second, secondary_unit_factor: factor } : {}),
        track_inventory: true,
        invoice_price_mode: form.invoice_price_mode,
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
            ...(second ? { secondary_unit: second, secondary_unit_factor: factor } : {}),
            track_inventory: true,
            invoice_price_mode: form.invoice_price_mode,
            force_duplicate: true,
          });
          await api.completeMobileAction(approve.id, { completed_by: 'pc' });
          toast('Produit créé (doublon forcé)');
          setApprove(null);
          load(true);
          return;
        } catch (e2: any) {
          setErr(e2.message || e.message || 'Erreur création');
        }
      } else {
        setErr(e.message || 'Erreur création');
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
      meta.proposed_stock != null ? String(meta.proposed_stock) : meta.stock != null ? String(meta.stock) : '0',
    );
    setErr('');
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
      setErr(e.message || 'Erreur ajustement stock');
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

  const stats = useMemo(() => {
    let pending = 0;
    let newProducts = 0;
    let stockChecks = 0;
    let resolved = 0;
    for (const r of rows) {
      if (r.status === 'pending') pending++;
      else resolved++;
      if (r.type === 'new_product') newProducts++;
      else if (r.type === 'stock_check') stockChecks++;
    }
    return { pending, newProducts, stockChecks, resolved };
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedRows = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <div className="atlas-page ac-dash actions-page ac-erp-page">
      <div className="page-header dock-page-header">
        <h1 className="sr-only">Boîte d&apos;actions</h1>
        <TopPageActions>
          <RefreshIconButton onClick={() => load(true)} loading={refreshing} />
          <Link to="/products" className="btn secondary" title="Produits" style={{ textDecoration: 'none' }}>
            <Package size={16} aria-hidden="true" />
            <span className="tpa-label">Produits</span>
          </Link>
        </TopPageActions>
      </div>

      {/* Bento Hero */}
      <header className="ac-dash-hero">
        <div className="ac-dash-hero-row">
          <div className="ac-dash-hero-text">
            <h2 className="ac-dash-hello">Boîte d&apos;actions</h2>
            <p className="ac-dash-lead">
              Validation des demandes terrain, créations produit et ajustements de stock.
            </p>
          </div>
          <div className="ac-dash-hero-side">
            <span className={`ac-status-pill ${stats.pending > 0 ? 'is-dirty' : 'is-ok'}`}>
              {stats.pending > 0 ? (
                <ClipboardCheck size={13} aria-hidden="true" />
              ) : (
                <CheckCircle2 size={13} aria-hidden="true" />
              )}
              {stats.pending > 0 ? `${stats.pending} en attente` : 'Tout est à jour'}
            </span>
          </div>
        </div>
      </header>

      {/* 4 Dashboard KPI Bento Cards */}
      <section className="ac-metric-grid" aria-label="Résumé des actions">
        <article className="ac-metric">
          <span className="ac-metric-label">En attente</span>
          <strong className="ac-metric-val">{stats.pending}</strong>
          <span className="ac-metric-meta">demande(s) à valider</span>
        </article>
        <article className="ac-metric">
          <span className="ac-metric-label">Nouveaux produits</span>
          <strong className="ac-metric-val">{stats.newProducts}</strong>
          <span className="ac-metric-meta">créations proposées</span>
        </article>
        <article className="ac-metric">
          <span className="ac-metric-label">Contrôles stock</span>
          <strong className="ac-metric-val">{stats.stockChecks}</strong>
          <span className="ac-metric-meta">inventaires &amp; écarts</span>
        </article>
        <article className="ac-metric">
          <span className="ac-metric-label">Clôturées</span>
          <strong className="ac-metric-val">{stats.resolved}</strong>
          <span className="ac-metric-meta">sur {rows.length} affichée(s)</span>
        </article>
      </section>

      {/* Main Bento Panel */}
      <section className="ac-panel">
        <div className="ac-panel-head" style={{ gap: '12px' }}>
          <div className="ac-dash-period-pills" role="group" aria-label="Filtrer les actions">
            {(['pending', 'done', 'all'] as const).map((t) => (
              <button
                key={t}
                type="button"
                className="ac-seg-btn"
                aria-pressed={tab === t}
                onClick={() => setTab(t)}
              >
                {t === 'pending' ? 'En attente' : t === 'done' ? 'Terminées' : 'Toutes'}
              </button>
            ))}
          </div>
          <div className="ac-erp-actions-row">
            <span className="ac-panel-count">{rows.length} enregistrement(s)</span>
            <ListPager
              page={safePage}
              pageSize={PAGE_SIZE}
              total={rows.length}
              onPageChange={setPage}
            />
          </div>
        </div>

        {err && (
          <p className="msg-error" role="alert">
            {err}
          </p>
        )}

        {!loading && !err && rows.length === 0 && (
          <EmptyState
            title="Aucune action"
            description="Les nouvelles demandes produit, ventes rapides et contrôles de stock apparaissent ici."
            icon="package"
          />
        )}

        {loading && rows.length === 0 && (
          <p className="muted" style={{ margin: '12px 0' }}>
            Chargement des actions…
          </p>
        )}

        {pagedRows.length > 0 && (
          <ul className="ac-erp-open-list">
            {pagedRows.map((a) => {
              const approveNeeded = needsProductApproval(a);
              const stockNeeded = needsStockApproval(a);
              const meta = parseMeta(a);
              const iconBg =
                a.type === 'stock_check'
                  ? 'var(--bad-bg)'
                  : a.type === 'new_product'
                    ? 'var(--warn-bg)'
                    : 'var(--zellij-soft)';
              return (
                <li key={a.id} className="ac-erp-open-item">
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flex: '1 1 260px', minWidth: 0 }}>
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: '12px',
                        background: iconBg,
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 11,
                        fontWeight: 750,
                        flexShrink: 0,
                      }}
                    >
                      {a.type === 'new_product' ? (
                        <PackagePlus size={17} aria-hidden="true" />
                      ) : (
                        (a.type || 'AC').slice(0, 2).toUpperCase()
                      )}
                    </div>
                    <div className="ac-erp-open-meta">
                      <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: '0.7rem', fontWeight: 700 }}>
                        {a.type} · {a.created_at?.replace('T', ' ').slice(0, 16)}
                      </span>
                      <strong>{a.title}</strong>
                      <span>{a.detail}</span>
                      {((a.created_by && !['mobile', 'mobile-offline', 'pc'].includes(a.created_by.toLowerCase())) ||
                        (a.completed_by && a.completed_by.toLowerCase() !== 'pc')) && (
                        <span>
                          {a.created_by && !['mobile', 'mobile-offline', 'pc'].includes(a.created_by.toLowerCase())
                            ? `Demandé par ${a.created_by}`
                            : ''}
                          {a.completed_by && a.completed_by.toLowerCase() !== 'pc'
                            ? ` · ${a.status === 'cancelled' ? 'Refusé' : 'Traité'} par ${a.completed_by}`
                            : ''}
                        </span>
                      )}
                      {stockNeeded && meta.proposed_stock != null && (
                        <span>
                          Stock proposé : <strong>{meta.proposed_stock}</strong>
                          {meta.stock != null ? ` (système ${meta.stock})` : ''}
                        </span>
                      )}
                      {stockNeeded && meta.cycle_batch && Array.isArray(meta.lines) && (
                        <span>
                          Inventaire lot : <strong>{meta.lines.length}</strong> ligne(s)
                        </span>
                      )}
                      {a.barcode && (
                        <span style={{ fontFamily: 'monospace' }}>#{a.barcode}</span>
                      )}
                      {a.status === 'cancelled' && meta.reject_reason && (
                        <span style={{ color: 'var(--bad)' }}>Refus : {meta.reject_reason}</span>
                      )}
                    </div>
                  </div>

                  {a.status === 'pending' ? (
                    <div className="ac-erp-actions-row">
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
                        <button type="button" disabled={busy} onClick={() => submitInvoiceApprove(a)}>
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
                    <span className="ac-status-pill is-warn">
                      <XCircle size={13} aria-hidden="true" />
                      Refusé
                    </span>
                  ) : (
                    <span className="ac-status-pill is-ok">
                      <CheckCircle2 size={13} aria-hidden="true" />
                      Traité
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {approve && (
        <div className="modal-overlay" onClick={() => { if (busy) return; setErr(''); setApprove(null); }}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Approuver la création produit</h2>
              <button type="button" className="modal-x" aria-label="Fermer" onClick={() => { if (!busy) { setErr(''); setApprove(null); } }}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              Même formulaire que Produits. Le produit est ajouté au catalogue, puis la demande est clôturée.
            </p>
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
            <div className="grid grid-2">
              <div className="form-row">
                <label>Prix (MAD)</label>
                <input value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} inputMode="decimal" />
              </div>
              <div className="form-row">
                <label>Coût (MAD)</label>
                <input value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} inputMode="decimal" />
              </div>
            </div>
            <div className="form-row">
              <label>Prix sur facture</label>
              <select value={form.invoice_price_mode} onChange={(e) => setForm({ ...form, invoice_price_mode: e.target.value })}>
                <option value="exclusive">TVA ajoutée au prix (HT)</option>
                <option value="inclusive">TVA incluse dans le prix (TTC)</option>
              </select>
              <small>Pour les ventes rapides, le prix reste sans TVA.</small>
            </div>
            <div className="grid grid-2">
              <div className="form-row">
                <label>Stock initial</label>
                <input value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} inputMode="numeric" />
              </div>
              <div className="form-row">
                <label>Catégorie</label>
                <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-2">
              <div className="form-row">
                <label>Unité</label>
                <select
                  value={form.unit || ''}
                  onChange={(e) => {
                    if (e.target.value === '__new__') { void addUnit('unit'); return; }
                    setForm({ ...form, unit: e.target.value });
                  }}
                >
                  <option value="">— Choisir —</option>
                  {units.map((u) => (
                    <option key={u.id ?? u.name} value={u.name}>
                      {u.symbol ? `${u.name} (${u.symbol})` : u.name}
                    </option>
                  ))}
                  {form.unit && !units.some((u) => u.name.toLowerCase() === form.unit.trim().toLowerCase()) && (
                    <option value={form.unit}>{form.unit}</option>
                  )}
                  <option value="__new__">+ Nouvelle unité…</option>
                </select>
              </div>
              <div className="form-row">
                <label>Deuxième unité (facultatif)</label>
                <select
                  value={form.secondary_unit || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '__new__') { void addUnit('secondary_unit'); return; }
                    if (!val) { setForm({ ...form, secondary_unit: '', secondary_unit_factor: '' }); return; }
                    setForm({ ...form, secondary_unit: val });
                  }}
                >
                  <option value="">— Aucune —</option>
                  {units.map((u) => (
                    <option
                      key={u.id ?? u.name}
                      value={u.name}
                      disabled={Boolean(form.unit) && u.name.toLowerCase() === form.unit.trim().toLowerCase()}
                    >
                      {u.symbol ? `${u.name} (${u.symbol})` : u.name}
                    </option>
                  ))}
                  {form.secondary_unit && !units.some((u) => u.name.toLowerCase() === form.secondary_unit.trim().toLowerCase()) && (
                    <option value={form.secondary_unit}>{form.secondary_unit}</option>
                  )}
                  <option value="__new__">+ Nouvelle unité…</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <label>Quantité par {form.unit || 'unité'}</label>
              <input value={form.secondary_unit_factor} inputMode="decimal" onChange={(e) => setForm({ ...form, secondary_unit_factor: e.target.value })} placeholder="Ex. 1,59" />
              <small>Le stock et le prix restent enregistrés par unité principale.</small>
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
            {err ? <ModalFormError message={err} /> : null}
            <div className="modal-actions">
              <button type="button" className="secondary" disabled={busy} onClick={() => { setErr(''); setApprove(null); }}>
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
        <div className="modal-overlay" onClick={() => { if (busy) return; setErr(''); setStockApprove(null); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>
                {parseMeta(stockApprove).cycle_batch
                  ? 'Appliquer l’inventaire lot'
                  : 'Approuver l’ajustement de stock'}
              </h2>
              <button type="button" className="modal-x" aria-label="Fermer" onClick={() => { if (!busy) { setErr(''); setStockApprove(null); } }}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>
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
            {err ? <ModalFormError message={err} /> : null}
            <div className="modal-actions">
              <button type="button" className="secondary" disabled={busy} onClick={() => { setErr(''); setStockApprove(null); }}>
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
