import { onAgentDraft } from '../lib/agentDraft';
import { useEffect, useState } from 'react';
import DatePicker from '../components/DatePicker';
import { useDebouncedValue } from '../lib/perf';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import TypeaheadField, { productTypeaheadOptions, partyTypeaheadOptions } from '../components/TypeaheadField';
import PasswordConfirm from '../components/PasswordConfirm';
import { getToken } from '../auth';
import SaveFeedback from '../components/SaveFeedback';
import { openReport } from '../lib/reports';
import { statusFr, statusBadgeClass, REFUND_REASON_OPTIONS, STOCK_DISPOSITION_OPTIONS } from '../lib/labels';
import { fmtMoney, PAYMENT_METHODS } from '../lib/money';
import { downloadExport } from '../lib/export';
import { useUi } from '../components/AppDialogs';
import { matchProducts, polishRefundReason, priceAnomaly, clientRisk } from '../lib/assist';
import { NoteChips, SuggestList } from '../components/AssistBits';
import { friendlyError } from '../lib/errors';
import EmptyState from '../components/EmptyState';
import { validateInvoiceForm, firstError } from '../lib/formValidate';

function formatIssue(e: unknown): string {
  if (e == null) return '';
  if (typeof e === 'string' || typeof e === 'number' || typeof e === 'boolean') return String(e);
  if (typeof e === 'object') {
    const o = e as Record<string, unknown>;
    if (typeof o.message === 'string' && o.message.trim()) {
      const code = typeof o.code === 'string' && o.code ? ` [${o.code}]` : '';
      return `${o.message}${code}`;
    }
    if (typeof o.error === 'string') return o.error;
    try { return JSON.stringify(e); } catch { return String(e); }
  }
  return String(e);
}

import { numStr, numFromInput } from '../lib/numInput';
import NumberField from '../components/NumberField';
import VirtualTableBody, { VirtualScroll } from '../components/VirtualTableBody';
import RefreshIconButton from '../components/RefreshIconButton';
import '../components/erp/orders-fulfillment.css';
import { FloatingPortal } from '../components/FloatingPortal';
import { ModalFormError, FieldHint } from '../components/ModalFormFeedback';

export default function Invoices() {
  const navigate = useNavigate();
  const { confirm, toast, prompt } = useUi();
  const [modalError, setModalError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pwOpen, setPwOpen] = useState(false);
  const [pwTitle, setPwTitle] = useState('');
  const [pwDesc, setPwDesc] = useState('');
  const [pendingAction, setPendingAction] = useState<null | ((password: string) => Promise<void>)>(null);
  const [list, setList] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [filter, setFilter] = useState('');
  const [docMode, setDocMode] = useState<'invoice' | 'quote'>('invoice');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [searchParams, setSearchParams] = useSearchParams();
  const clientFilter = searchParams.get('client');
  const qParam = searchParams.get('q') || '';
  useEffect(() => {
    if (qParam) setSearch(qParam);
  }, [qParam]);

  const [clientId, setClientId] = useState<number | ''>('');
  const [clientName, setClientName] = useState('');
  const [clientIce, setClientIce] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [clientCity, setClientCity] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [saveMsgType, setSaveMsgType] = useState<'success' | 'error'>('success');
  const [items, setItems] = useState<{ product_id?: number; product_name: string; sku?: string; quantity: number; list_price: number; unit_price: number; product_query?: string }[]>([{ product_name: '', quantity: 1, list_price: 0, unit_price: 0, product_query: '' }]);
  const [taxExempt, setTaxExempt] = useState(false);

  // Delete OTP state
  const [payTarget, setPayTarget] = useState<any>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState('cash');
  const [payNote, setPayNote] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [payMode, setPayMode] = useState<'partial' | 'full'>('partial');

  // Remboursement (WR)
  const [showRefund, setShowRefund] = useState(false);
  const [refundSourceId, setRefundSourceId] = useState<number | ''>('');
  const [refundSource, setRefundSource] = useState<any>(null);
  const [refundLines, setRefundLines] = useState<{
    invoice_item_id: number;
    product_name: string;
    max_qty: number;
    already_refunded: number;
    quantity: number;
    unit_price: number;
    restock: boolean;
    disposition: string;
  }[]>([]);
  const [refundReasonCode, setRefundReasonCode] = useState('');
  const [refundReasonDetail, setRefundReasonDetail] = useState('');
  const [refundSaving, setRefundSaving] = useState(false);
  const [refundPayMethod, setRefundPayMethod] = useState('cash');
  const [refundSources, setRefundSources] = useState<any[]>([]);

  const buildRefundLines = async (data: any) => {
    const prior = await api.getInvoices('remboursement', { kind: 'all' }).catch(() => ({ data: [] }));
    const related = (prior.data || []).filter(
      (x: any) => Number(x.refund_of_invoice_id) === Number(data.id),
    );
    const refundedMap = new Map<number, number>();
    for (const wr of related) {
      try {
        const full = await api.getInvoice(wr.id);
        for (const it of full.data?.items || []) {
          const m = String(it.sku || it.notes || '').match(/src_item:(\d+)/);
          const key = m ? Number(m[1]) : Number(it.product_id || 0);
          if (key) refundedMap.set(key, (refundedMap.get(key) || 0) + Number(it.quantity || 0));
        }
      } catch { /* */ }
    }
    return (data.items || []).map((it: any) => {
      const already = refundedMap.get(Number(it.id)) || refundedMap.get(Number(it.product_id || 0)) || 0;
      const maxQty = Math.max(0, Number(it.quantity || 0) - already);
      return {
        invoice_item_id: it.id,
        product_name: it.product_name,
        max_qty: maxQty,
        already_refunded: already,
        quantity: maxQty,
        unit_price: Number(it.unit_price || 0),
        restock: true,
        disposition: '',
      };
    });
  };


  const flash = (msg: string, type: 'success' | 'error' = 'success') => {
    setSaveMsg(msg); setSaveMsgType(type);
    setTimeout(() => setSaveMsg(''), 4500);
  };
  const refreshCounts = () => {
    try { window.dispatchEvent(new CustomEvent('atlas-nav-badges-refresh')); } catch { /* */ }
    load(true);
  };

  const load = (soft = false) => {
    if (soft) setRefreshing(true);
    else setLoading(true);
    Promise.all([api.getInvoices(filter || undefined), api.getProducts(), api.getClients()])
      .then(([i, p, c]) => { setList(i.data); setProducts(p.data); setClients(c.data); })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
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
      if (d.entity && d.entity !== 'invoice' && d.entity !== 'quote') return;
      setDocMode(d.entity === 'quote' ? 'quote' : 'invoice');
      setModalError('');
      setFieldErrors({});
      setShowModal(true);
    });
  }, []);

  useEffect(() => { load(); }, [filter]);

  useEffect(() => {
    const rid = searchParams.get('refund');
    if (!rid) return;
    const id = Number(rid);
    if (!id) return;
    setShowRefund(true);
    setRefundSourceId(id);
    setRefundReasonCode('');
    setRefundReasonDetail('');
    void (async () => {
      try {
        const r = await api.getInvoices(undefined, { kind: 'all' });
        setRefundSources(r.data || []);
        const res = await api.getInvoice(id);
        setRefundSource(res.data);
        setRefundLines(await buildRefundLines(res.data));
      } catch { /* */ }
      setSearchParams({}, { replace: true });
    })();
  }, [searchParams]);

  const selectClient = (id: number | '') => {
    setClientId(id);
    if (id) {
      const c = clients.find((x) => x.id === id);
      if (c) {
        setClientName(c.name); setClientIce(c.ice || ''); setClientAddress(c.address || '');
        setClientCity(c.city || ''); setClientEmail(c.email || ''); setClientPhone(c.phone || '');
        setTaxExempt(!!c.tax_exempt);
      }
    } else {
      setClientName(''); setClientIce(''); setClientAddress(''); setClientCity('');
      setClientEmail(''); setClientPhone('');
      setTaxExempt(false);
    }
  };

  const updateLine = (idx: number, field: string, value: any) => {
    const next = [...items];
    (next[idx] as any)[field] = value;
    if (field === 'product_id' && value) {
      const p = products.find((x) => x.id === +value);
      if (p) { next[idx].product_name = p.name; next[idx].sku = p.sku; next[idx].list_price = p.price || 0; next[idx].unit_price = p.price || 0; next[idx].product_query = p.name; }
    }
    setItems(next);
  };

  const resetForm = () => {
    setClientId(''); setClientName(''); setClientIce(''); setClientAddress(''); setClientCity('');
    setClientEmail(''); setClientPhone(''); setDueDate(''); setNotes('');
    setItems([{ product_name: '', quantity: 1, list_price: 0, unit_price: 0, product_query: '' }]);
    setTaxExempt(false);
  };

  const create = async () => {
    const fe = validateInvoiceForm({ client_name: clientName, items });
    setFieldErrors(fe);
    if (Object.keys(fe).length) {
      flash(firstError(fe) || 'Complétez le formulaire.', 'error');
      setFieldErrors(fe);
      setModalError(firstError(fe) || 'Complétez le formulaire.');
      return;
    }
    setSaving(true);
    try {
      const idem = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `inv-${Date.now()}`;
      const res: any = await api.createInvoice({
        prices_ttc: true,
        client_id: clientId || undefined, client_name: clientName, client_ice: clientIce,
        client_address: clientAddress, client_city: clientCity, client_email: clientEmail, client_phone: clientPhone,
        issue_date: issueDate, due_date: dueDate || null, notes, items,
        status: docMode === 'quote' ? 'quote' : 'sent',
        tax_exempt: taxExempt,
      });
      setModalError(''); setFieldErrors({}); setShowModal(false); resetForm();
      flash(res.message || (docMode === 'quote'
        ? 'Devis enregistré (non comptabilisé, stock non touché).'
        : 'Facture enregistrée dans la base de données avec succès.'));
      if (res.data?.whatsapp_url) {
        const openWa = await confirm({
          title: 'WhatsApp',
          message: 'Ouvrir WhatsApp pour envoyer le lien au client ?',
        });
        if (openWa) window.open(res.data.whatsapp_url, '_blank', 'noopener,noreferrer');
      }
      load(true);
    } catch (e: any) { flash(e.message || 'Erreur lors de l\'enregistrement.', 'error'); } finally { setSaving(false); }
  };

  const remainingOf = (inv: any) =>
    Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0));

  /** Part 3: "Tout payer" → open modal to choose payment method (never silent cash). */
  const markPaid = (id: number, _total: number, inv?: any) => {
    const target = inv || list.find((x) => x.id === id);
    if (!target) return;
    const rest = remainingOf(target);
    if (rest <= 0) {
      flash('Cette facture est déjà soldée.', 'error');
      return;
    }
    setPayTarget(target);
    setPayAmount(rest);
    setPayMethod('cash');
    setPayNote('Règlement intégral');
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayMode('full');
  };

  /** Partial payment: only the amount paid now is added. */
  const openPay = (inv: any) => {
    const rest = remainingOf(inv);
    if (rest <= 0) {
      flash('Cette facture est déjà soldée.', 'error');
      return;
    }
    setPayTarget(inv);
    setPayAmount(Math.min(rest, rest)); // default remaining, user can lower it
    setPayMethod('cash');
    setPayNote('');
    setPayDate(new Date().toISOString().slice(0, 10));
    setPayMode('partial');
  };

  const submitPay = async () => {
    if (!payTarget) return;
    const rest = remainingOf(payTarget);
    const amount = payMode === 'full' ? rest : Number(payAmount);
    if (!amount || amount <= 0) {
      flash('Montant invalide', 'error');
      return;
    }
    if (amount > rest + 0.001) {
      flash(`Le montant ne peut pas dépasser le reste dû (${fmt(rest)}).`, 'error');
      return;
    }
    if (!payMethod) {
      flash('Choisissez un mode de paiement.', 'error');
      return;
    }
    setSaving(true);
    try {
      const payee =
        payMethod.includes('owner') ? 'owner' : 'company';
      const res: any = await api.recordInvoicePayment(payTarget.id, {
        amount,
        payment_method: payMethod,
        payee,
        note: payNote || (payMode === 'full' ? 'Règlement intégral' : ''),
        paid_at: payDate,
      });
      flash(res.message || 'Paiement enregistré');
      setPayTarget(null);
      load(true);
    } catch (e: any) {
      flash(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const cancelInvoice = async (id: number) => {
    const ok = await confirm({
      title: 'Annulation / void',
      message:
        'Le numéro de document est conservé (série CGI sans trou).\nLe stock sera rétabli si la facture avait déduit du stock.\n\nContinuer ?',
      danger: true,
      confirmLabel: 'Continuer',
    });
    if (!ok) return;
    const voidReason = await prompt({
      title: 'Motif d’annulation (obligatoire)',
      message: 'Ex. erreur de saisie, doublon, client a annulé la commande…',
      placeholder: 'Motif (min. 5 caractères)',
      confirmLabel: 'Annuler la facture',
    });
    if (!voidReason || voidReason.trim().length < 5) {
      toast('Motif trop court — annulation annulée.', 'error');
      return;
    }
    try {
      await api.updateInvoiceStatus(id, { status: 'cancelled', void_reason: voidReason.trim() } as any);
      flash('Facture annulée (numéro conservé).');
      toast('Facture annulée', 'success');
      load(true);
    } catch (e: any) {
      flash(friendlyError(e, e.message), 'error');
      setModalError(friendlyError(e, e.message));
    }
  };

  const convertQuote = async (id: number) => {
    const ok = await confirm({
      title: 'Conversion',
      message: 'Convertir ce devis en facture ? Le stock sera déduit et le document deviendra exigible.',
    });
    if (!ok) return;
    try {
      const res: any = await api.convertQuoteToInvoice(id);
      flash(res.message || 'Devis converti en facture.');
      load(true);
    } catch (e: any) { flash(e.message, 'error'); }
  };

  const requestDelete = async (id: number) => {
    let disclaimer = 'Cette action est définitive. Confirmez pour continuer.';
    try {
      const links = await api.getInvoiceLinks(id);
      const d = links.data;
      if (d?.disclaimer || d?.receipts?.length || d?.expenses?.length) {
        const bits: string[] = [];
        if (d.receipts?.length) bits.push(`${d.receipts.length} reçu(s)`);
        if (d.expenses?.length) bits.push(`${d.expenses.length} écriture(s) solde`);
        if (d.payments_count) bits.push(`${d.payments_count} paiement(s)`);
        disclaimer =
          `ATTENTION : la suppression de cette facture effacera aussi ${bits.join(', ') || 'les éléments liés'}. ` +
          'Facture + reçus + encaissements solde seront supprimés ensemble. Confirmez pour continuer.';
      }
    } catch { /* ignore */ }
    setPwTitle('Supprimer la facture et éléments liés');
    setPwDesc(disclaimer);
    setPendingAction(() => async (password: string) => {
      const res = await api.deleteInvoice(id, password);
      flash((res as any).message || 'Facture supprimée.');
      setPwOpen(false); setPendingAction(null);
      load(true);
    });
    setPwOpen(true);
  };

  const fmt = (n: number) => fmtMoney(n, 'MAD');
  const isStandardInvoice = (inv: any) => {
    const kind = String(inv.doc_kind || '').toLowerCase();
    const st = String(inv.status || '').toLowerCase();
    const num = String(inv.number || '');
    if (kind === 'quick_sale' || kind === 'ticket' || kind === 'quote' || kind === 'devis' || kind === 'remboursement') return false;
    if (st === 'quote' || st === 'devis' || st === 'remboursement') return false;
    if (num.startsWith('VR') || num.startsWith('WR') || num.startsWith('DV') || num.startsWith('DE')) return false;
    return true;
  };
  const filtered = list.filter((inv) => {
    const matchSearch = !debouncedSearch || inv.number?.toLowerCase().includes(debouncedSearch.toLowerCase()) || inv.client_name?.toLowerCase().includes(debouncedSearch.toLowerCase());
    const matchClient = !clientFilter || String(inv.client_id) === clientFilter;
    return matchSearch && matchClient && isStandardInvoice(inv);
  });

  if (loading) return <div className="empty">Chargement des factures...</div>;

  const orderKpis = (() => {
    const open = filtered.filter((i) => i.status !== 'paid' && i.status !== 'cancelled').length;
    const paid = filtered.filter((i) => i.status === 'paid').length;
    const due = filtered.reduce((s, i) => s + Math.max(0, Number(i.total || 0) - Number(i.amount_paid || 0)), 0);
    return { open, paid, due, n: filtered.length };
  })();


  return (
    <div className="atlas-orders invoices-page">
      <div className="page-header">
        <div>
          <h1>Factures de vente</h1>
          {clientFilter && <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>Filtré par client #{clientFilter}</p>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <RefreshIconButton onClick={() => load(true)} loading={refreshing} />
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 'auto' }} aria-label="Filtrer par statut">
            <option value="">Toutes les factures</option>
            <option value="sent">Non payées / envoyées</option>
            <option value="partial">Partiellement payées</option>
            <option value="paid">Payées</option>
            <option value="cancelled">Annulées</option>
            <option value="overdue">En retard</option>
          </select>
          <button className="secondary" onClick={() => openReport('/api/reports/receivables')}>Exporter les créances</button>
          <button className="secondary" onClick={() => downloadExport('/api/export/invoices', 'factures.csv')}>Télécharger le CSV</button>
          <button onClick={() => { setDocMode('invoice'); setShowModal(true); }}>Créer une facture</button>
          <button
            className="secondary"
            style={{ borderColor: 'var(--copper, #b87333)', color: 'var(--copper-dark, #8a5520)' }}
            onClick={() => {
              setShowRefund(true);
              setRefundSourceId('');
              setRefundSource(null);
              setRefundLines([]);
              setRefundReasonCode('');
              setRefundReasonDetail('');
              // FA + VR eligible for WR
              api.getInvoices(undefined, { kind: 'all' })
                .then((r) => setRefundSources(r.data || []))
                .catch(() => setRefundSources(list));
            }}
          >
            + Remboursement (WR)
          </button>
        </div>
      </div>

      
      <div className="ac-metric-grid" style={{ marginBottom: 16 }}>
        <div className="ac-metric"><div className="as-label">Total liste</div><div className="as-value">{orderKpis.n}</div></div>
        <div className="ac-metric"><div className="as-label">Ouvertes</div><div className="as-value">{orderKpis.open}</div></div>
        <div className="ac-metric"><div className="as-label">Payées</div><div className="as-value">{orderKpis.paid}</div></div>
        <div className="ac-metric"><div className="as-label">Reste dû</div><div className="as-value">{Math.round(orderKpis.due).toLocaleString('fr-FR')}</div></div>
      </div>
<SaveFeedback message={saveMsg} type={saveMsgType} />

      <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div className="ac-panel ac-products-filters" style={{ marginBottom: 12 }}>
        <div className="ac-products-filters-row">
          <div className="ac-search-field">
            <input className="ac-search-input" placeholder="Rechercher par numéro ou nom de client..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>
      </div>


      <div className="ac-panel ac-products-table-panel">
        <VirtualScroll maxHeight={filtered.length > 60 ? 560 : undefined}>
          <table className="data-dense ac-products-table">
            <thead>
              <tr><th>Numéro</th><th>Client</th><th>Date</th><th>Échéance</th><th>Statut</th><th>Total</th><th>Payé</th><th>Crédit (reste)</th><th>Actions</th></tr>
            </thead>
            {filtered.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={9}>
                    <EmptyState
                      title="Aucune facture"
                      description="Créez une facture de vente ou un devis. Les remboursements WR se font depuis une facture existante."
                      actionLabel="Créer ma première facture"
                      onAction={() => { setDocMode('invoice'); setShowModal(true); }}
                      icon="document"
                    />
                  </td>
                </tr>
              </tbody>
            ) : (
              <VirtualTableBody
                rows={filtered}
                rowHeight={52}
                maxHeight={560}
                getKey={(inv) => inv.id}
                renderRow={(inv) => (
                  <tr>
                    <td>
                      <Link to={`/invoices/${inv.id}`}><strong>{inv.number}</strong></Link>
                      {(inv.status === 'remboursement' || inv.doc_kind === 'remboursement') && inv.refund_of_invoice_id ? (
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          sur{' '}
                          <Link to={`/invoices/${inv.refund_of_invoice_id}`}>FA/VR #{inv.refund_of_invoice_id}</Link>
                        </div>
                      ) : null}
                    </td>
                    <td>
                      {inv.client_name}
                      {inv.client_id && <small style={{ display: 'block', color: 'var(--muted)', fontSize: 11 }}>
                        <Link to={`/clients`}>Fiche client #{inv.client_id}</Link>
                      </small>}
                    </td>
                    <td>{inv.issue_date}</td>
                    <td>{inv.due_date || '—'}</td>
                    <td><span className={`badge ${statusBadgeClass(inv.status)}`}>{statusFr(inv.status)}</span></td>
                    <td style={{ fontWeight: 700 }}>{fmt(inv.total)}</td>
                    <td>
                      {inv.status === 'remboursement' || inv.doc_kind === 'remboursement'
                        ? '—'
                        : fmt(inv.amount_paid || 0)}
                    </td>
                    <td style={{ fontWeight: 700, color: (inv.status === 'quote' || inv.status === 'devis' || inv.status === 'paid' || inv.status === 'cancelled' || inv.status === 'remboursement') ? 'var(--muted)' : 'var(--bad)' }}>
                      {(inv.status === 'quote' || inv.status === 'devis' || inv.status === 'remboursement' || inv.doc_kind === 'remboursement')
                        ? '—'
                        : fmt(Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0)))}
                    </td>
                    <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
                      {inv.status !== 'quote' && inv.status !== 'devis' && inv.status !== 'remboursement' && inv.status !== 'cancelled' && (
                        <button
                          type="button"
                          className="secondary"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                          onClick={async () => {
                            try {
                              const r: any = await api.createDeliveryNote({ invoice_id: inv.id });
                              toast(r.message || 'BL créé', 'success');
                            } catch (e: any) {
                              setModalError(friendlyError(e));
                            }
                          }}
                        >
                          BL
                        </button>
                      )}
                      {(inv.status === 'quote' || inv.status === 'devis') && (
                        <button className="success" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => convertQuote(inv.id)}>→ Facturer</button>
                      )}
                      {inv.status !== 'paid' && inv.status !== 'cancelled' && inv.status !== 'quote' && inv.status !== 'devis' && inv.status !== 'remboursement' && (
                        <>
                          <button className="secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => openPay(inv)}>Paiement…</button>
                        </>
                      )}
                      {inv.status !== 'cancelled' && inv.status !== 'quote' && inv.status !== 'devis' && inv.status !== 'remboursement' && (
                        <button
                          className="secondary"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                          onClick={async () => {
                            setShowRefund(true);
                            setRefundReasonCode('');
                            setRefundReasonDetail('');
                            setRefundSourceId(inv.id);
                            try {
                              const res = await api.getInvoice(inv.id);
                              const data = res.data;
                              setRefundSource(data);
                              setRefundLines(
                                (data.items || []).map((it: any) => ({
                                  invoice_item_id: it.id,
                                  product_name: it.product_name,
                                  max_qty: Number(it.quantity || 0),
                                  quantity: Number(it.quantity || 0),
                                  unit_price: Number(it.unit_price || 0),
                                }))
                              );
                            } catch (e: any) {
                              flash(e?.message || 'Impossible de charger la facture', 'error');
                            }
                          }}
                        >
                          WR…
                        </button>
                      )}
                      {inv.status !== 'cancelled' && inv.status !== 'remboursement' && (
                        <button className="danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => cancelInvoice(inv.id)}>Annuler</button>
                      )}
                      <button className="danger" style={{ padding: '4px 10px', fontSize: 12, background: '#6b2828' }} onClick={() => requestDelete(inv.id)}>Suppr.</button>
                    </td>
                  </tr>
                )}
              />
            )}
          </table>
        </VirtualScroll>
      </div>

      {showModal && (
        <FloatingPortal><div className="modal-overlay" onClick={() => { setModalError(''); setFieldErrors({}); setShowModal(false); }}>
          <div className="modal" style={{ maxWidth: 1080, width: '96vw' }} onClick={(e) => e.stopPropagation()}>
            <h2>{docMode === 'quote' ? 'Nouveau devis (estimation)' : 'Nouvelle facture de vente'}</h2>

            <div className="form-row">
              <label>Client enregistré</label>
              <TypeaheadField
                value={clientName}
                placeholder="Rechercher un client…"
                options={partyTypeaheadOptions(clients, 'client')}
                onChange={(v) => {
                  setClientName(v);
                  setClientId('');
                  setFieldErrors((x) => ({ ...x, client_name: '' }));
                }}
                onPick={(o) => selectClient(Number(o.id))}
                onOpen={() => {
                  api.getClients().then((r: any) => {
                    if (Array.isArray(r?.data)) setClients(r.data);
                  }).catch(() => {});
                }}
                emptyLabel="Aucun client"
              />
            </div>

            <div className="grid grid-2">
              <div className="form-row"><label>Nom du client *</label><input className={fieldErrors.client_name ? 'field-error' : undefined} value={clientName} onChange={(e) => { setClientName(e.target.value); setFieldErrors((x) => ({ ...x, client_name: '' })); }} placeholder="Nom du client" /><span className="field-error-msg">{fieldErrors.client_name || ''}</span></div>
              {clientId ? (() => {
                const c = clients.find((x) => Number(x.id) === Number(clientId));
                const due = Number(c?.balance_due ?? 0);
                const limit = Number(c?.credit_limit ?? 0);
                const risk = clientRisk(list, clientId, clientName);
                return (
                  <div style={{ fontSize: 12, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--peach, #f5f2eb)', color: 'var(--ink, #141822)', border: '1px solid var(--line, #e5e0d6)' }}>
                      {limit > 0
                        ? `Crédit : ${Math.round(due).toLocaleString('fr-FR')} MAD ouvert / limite ${Math.round(limit).toLocaleString('fr-FR')} MAD`
                        : due > 0.001
                          ? `Encours ouvert : ${Math.round(due).toLocaleString('fr-FR')} MAD (pas de limite)`
                          : 'Crédit : aucun encours · limite libre'}
                    </div>
                    {risk.level !== 'ok' ? (
                      <div style={{ padding: '8px 10px', borderRadius: 8, background: risk.level === 'high' ? 'rgba(139,46,46,0.08)' : 'rgba(166,124,0,0.1)', color: risk.level === 'high' ? 'var(--bad)' : '#6b5a00' }}>
                        {risk.message}
                      </div>
                    ) : null}
                  </div>
                );
              })() : null}
              <div className="form-row"><label>ICE / Identifiant fiscal</label><input value={clientIce} onChange={(e) => setClientIce(e.target.value)} /></div>
            </div>
            <div className="grid grid-2">
              <div className="form-row"><label>Adresse</label><input value={clientAddress} onChange={(e) => setClientAddress(e.target.value)} /></div>
              <div className="form-row"><label>Ville</label><input value={clientCity} onChange={(e) => setClientCity(e.target.value)} /></div>
            </div>
            <div className="grid grid-2">
              <div className="form-row"><label>E-mail</label><input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} /></div>
              <div className="form-row"><label>Téléphone</label><input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} /></div>
            </div>
            <div className="grid grid-2">
              <div className="form-row"><label>Date d'émission</label><DatePicker value={issueDate} onChange={setIssueDate} /></div>
              <div className="form-row"><label>Date d'échéance</label><DatePicker value={dueDate} onChange={setDueDate} /></div>
            </div>
            <div className="form-row">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={taxExempt} onChange={(e) => setTaxExempt(e.target.checked)} />
                Exonéré de TVA (tax exempt) — TVA forcée à 0 %
              </label>
            </div>

            <h3 style={{ margin: '16px 0 8px', fontSize: 14 }}>Lignes — prix TTC · TVA calculée en bas (style facture marbre)</h3>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.4 }}>
              Choisissez un produit (recherche), le <strong>prix catalogue</strong> se remplit automatiquement. Saisissez ensuite le <strong>prix client</strong> si une promo / remise s&apos;applique.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.2fr 70px 100px 100px 100px 36px', gap: 6, marginBottom: 6, fontSize: 10, color: 'var(--muted)', fontWeight: 600 }}>
              <span>Recherche / produit</span>
              <span>Désignation</span>
              <span>Qté</span>
              <span>P.U. catalogue TTC</span>
              <span>P.U. client TTC</span>
              <span>Total TTC</span>
              <span></span>
            </div>
            {items.map((item, idx) => {
              const lineTotal = Number(item.quantity || 0) * Number(item.unit_price || 0);
              const listP = Number(item.list_price || 0);
              const unitP = Number(item.unit_price || 0);
              const promo = listP > 0 && unitP < listP;
              const q = (item.product_query || '').toLowerCase();
              const filteredProducts = q
                ? products.filter((p) =>
                    p.name?.toLowerCase().includes(q) ||
                    p.sku?.toLowerCase().includes(q) ||
                    String(p.barcode || '').includes(q)
                  ).slice(0, 40)
                : products.slice(0, 40);
              return (
              <div key={idx} style={{ marginBottom: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1.2fr 70px 100px 100px 100px 36px', gap: 6, alignItems: 'center' }}>
                  <TypeaheadField
                    value={item.product_query ?? ''}
                    placeholder="Tapez pour chercher (nom, SKU, code-barres)…"
                    options={productTypeaheadOptions(products)}
                    onOpen={() => {
                      api.getProducts({ fields: 'light', limit: 500 }).then((r: any) => {
                        if (Array.isArray(r?.data)) setProducts(r.data);
                      }).catch(() => {});
                    }}
                    onChange={(v) => updateLine(idx, 'product_query', v)}
                    onPick={(o) => {
                      const p = products.find((x) => String(x.id) === String(o.id));
                      if (!p) return;
                      updateLine(idx, 'product_id', p.id);
                      updateLine(idx, 'product_name', p.name || '');
                      updateLine(idx, 'product_query', p.name || '');
                      updateLine(idx, 'list_price', Number(p.price || p.unit_price || 0));
                      updateLine(idx, 'unit_price', Number(p.price || p.unit_price || 0));
                      if (p.sku) updateLine(idx, 'sku', p.sku);
                    }}
                    emptyLabel="Aucun produit"
                  />
                  <input placeholder="Désignation *" value={item.product_name} onChange={(e) => updateLine(idx, 'product_name', e.target.value)} />
                  <NumberField value={item.quantity} onValueChange={(n) => updateLine(idx, 'quantity', n)} min={0.01} step="0.01" title="Quantité" />
                  <NumberField value={item.list_price} onValueChange={(n) => updateLine(idx, 'list_price', n)} min={0} step="0.01" title="Prix catalogue" />
                  <NumberField value={item.unit_price} onValueChange={(n) => updateLine(idx, 'unit_price', n)} min={0} step="0.01" title="Prix client (après promo)" style={promo ? { borderColor: 'var(--success, #3f3f46)' } : undefined} />
                  {!!item.product_id && (() => {
                    const p = products.find((x) => Number(x.id) === Number(item.product_id));
                    const a = priceAnomaly(Number(item.unit_price || 0), {
                      list: Number(item.list_price || p?.price || 0),
                      cost: Number(p?.cost || p?.cost_price || 0),
                    });
                    return a.warn ? (
                      <div style={{ fontSize: 11, color: a.level === 'below_cost' ? 'var(--bad)' : '#a67c00', marginTop: 4 }}>{a.message}</div>
                    ) : null;
                  })()}
                  <div style={{ fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>{lineTotal.toLocaleString('fr-FR', { maximumFractionDigits: 0 })}</div>
                  <button type="button" className="danger" style={{ padding: '6px 8px' }} onClick={() => setItems((prev) => prev.length <= 1 ? [{ product_name: '', quantity: 1, list_price: 0, unit_price: 0, product_query: '' }] : prev.filter((_, i) => i !== idx))} aria-label="Supprimer">×</button>
                </div>
                {promo && (
                  <div style={{ fontSize: 11, color: 'var(--success, #3f3f46)', marginTop: 2 }}>
                    Promo : −{(listP - unitP).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} / unité
                    ({listP > 0 ? (((listP - unitP) / listP) * 100).toFixed(1) : 0} %) · remise ligne {( (listP - unitP) * Number(item.quantity || 0) ).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}
                  </div>
                )}
              </div>
              );
            })}
            <div style={{ fontSize: 14, fontWeight: 700, textAlign: 'right', marginBottom: 12 }}>
              Total estimé TTC : {items.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unit_price || 0), 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })}
              {items.some((it) => Number(it.list_price || 0) > Number(it.unit_price || 0)) && (
                <span style={{ fontWeight: 500, color: 'var(--muted)', marginLeft: 10, fontSize: 12 }}>
                  (catalogue {items.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.list_price || it.unit_price || 0), 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} · promo active)
                </span>
              )}
            </div>
            <button type="button" className="secondary" onClick={() => setItems([...items, { product_name: '', quantity: 1, list_price: 0, unit_price: 0, product_query: '' }])} style={{ marginBottom: 16 }}>+ Ajouter une ligne</button>

            <div className="form-row"><label>Notes</label><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
              <NoteChips value={notes} onChange={setNotes} />
            <ModalFormError message={modalError} />
            <div className="form-actions">
              {firstError(fieldErrors) && <span className="save-error-inline">{firstError(fieldErrors)}</span>}
              <button onClick={create} disabled={saving}>{saving ? 'Enregistrement…' : (docMode === 'quote' ? 'Enregistrer le devis' : 'Créer la facture')}</button>
              <button type="button" className="secondary" onClick={() => { setModalError(''); setFieldErrors({}); setShowModal(false); }}>Annuler</button>
            </div>
          </div>
        </div></FloatingPortal>
      )}

      {showRefund && (
        <FloatingPortal><div className="modal-overlay" onClick={() => !refundSaving && setShowRefund(false)}>
          <div className="modal" style={{ maxWidth: 720, width: '96vw' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Remboursement / avoir (code WR)</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 12 }}>
              Choisissez une facture, les quantités, le motif, et pour chaque ligne si l’article revient en stock
              (par défaut oui). Sans remise en stock, une disposition est obligatoire (cassé, perdu…).
            </p>
            <div
              style={{
                fontSize: 12,
                lineHeight: 1.45,
                marginBottom: 14,
                padding: '10px 12px',
                background: '#fdf6ef',
                border: '1px solid #e8c9a0',
                borderRadius: 10,
                color: '#5c3d1e',
              }}
            >
              <strong>Numérotation WR-</strong> (avoir) — distincte des tickets <strong>VR-</strong>. La TVA de l’avoir reprend celle de la facture d’origine (0 % si exonéré / VR). <strong>Règle :</strong> un remboursement <em>sans explication valable n’est pas accepté</em>,
              peu importe la situation. Motifs acceptés uniquement : erreur de notre part, article cassé/défectueux
              envoyé (non causé par le client), mauvais article, quantité manquante, dommage transport.
            </div>

            <div className="form-row">
              <label>Facture d’origine *</label>
              <select
                value={refundSourceId}
                disabled={refundSaving}
                onChange={async (e) => {
                  const id = e.target.value ? Number(e.target.value) : '';
                  setRefundSourceId(id);
                  setRefundSource(null);
                  setRefundLines([]);
                  if (!id) return;
                  try {
                    const res = await api.getInvoice(id);
                    const data = res.data;
                    setRefundSource(data);
                    setRefundLines(await buildRefundLines(data));
                  } catch (err: any) {
                    flash(err?.message || 'Chargement impossible', 'error');
                  }
                }}
              >
                <option value="">— Choisir FA ou ticket VR —</option>
                {(refundSources.length ? refundSources : list)
                  .filter((inv) => inv.status !== 'quote' && inv.status !== 'devis' && inv.status !== 'cancelled' && inv.status !== 'remboursement' && inv.doc_kind !== 'remboursement')
                  .map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.number}
                      {(inv.doc_kind === 'quick_sale' || String(inv.number || '').startsWith('VR')) ? ' [VR]' : ' [FA]'}
                      {' — '}{inv.client_name} — {fmt(inv.total)}
                      {Number(inv.amount_paid || 0) >= Number(inv.total || 0) - 0.001 ? ' · payé' : ''}
                    </option>
                  ))}
              </select>
            </div>

            {refundSource && (
              <>
                <p style={{ fontSize: 13, marginBottom: 8 }}>
                  Client : <strong>{refundSource.client_name}</strong> · Statut : {statusFr(refundSource.status)} ·
                  Payé {fmt(refundSource.amount_paid || 0)} / {fmt(refundSource.total)}
                </p>
                <h3 style={{ fontSize: 14, margin: '12px 0 8px' }}>Lignes à rembourser</h3>
                <div style={{ fontSize: 11, color: 'var(--muted)', display: 'grid', gridTemplateColumns: '1.2fr 56px 72px 88px 1fr', gap: 6, marginBottom: 6 }}>
                  <span>Article</span><span>Max</span><span>Qté</span><span>Stock</span><span>Disposition si hors stock</span>
                </div>
                {refundLines.map((line, idx) => (
                  <div key={line.invoice_item_id} style={{ display: 'grid', gridTemplateColumns: '1.2fr 56px 72px 88px 1fr', gap: 6, marginBottom: 10, alignItems: 'center' }}>
                    <span style={{ fontSize: 13 }}>
                      {line.product_name}
                      {line.already_refunded > 0 && (
                        <span style={{ color: 'var(--muted)', fontWeight: 500 }}>
                          {' '}(déjà remboursé {line.already_refunded} — reste {line.max_qty})
                        </span>
                      )}
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{fmt(line.unit_price)} / u</span>
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--muted)' }}>{line.max_qty}</span>
                    <NumberField
                      min={0}
                      max={line.max_qty}
                      step="0.01"
                      value={line.quantity}
                      onValueChange={(n) => {
                        const next = [...refundLines];
                        next[idx] = { ...next[idx], quantity: Math.min(Math.max(0, n), line.max_qty) };
                        setRefundLines(next);
                      }}
                      disabled={refundSaving}
                    />
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={line.restock}
                        disabled={refundSaving}
                        onChange={(e) => {
                          const next = [...refundLines];
                          next[idx] = {
                            ...next[idx],
                            restock: e.target.checked,
                            disposition: e.target.checked ? '' : next[idx].disposition || 'broken_unusable',
                          };
                          setRefundLines(next);
                        }}
                      />
                      Retour
                    </label>
                    {line.restock ? (
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>— réintégré au stock</span>
                    ) : (
                      <select
                        value={line.disposition}
                        disabled={refundSaving}
                        onChange={(e) => {
                          const next = [...refundLines];
                          next[idx] = { ...next[idx], disposition: e.target.value };
                          setRefundLines(next);
                        }}
                        style={{ fontSize: 12, padding: '4px 6px' }}
                      >
                        <option value="">— Disposition * —</option>
                        {STOCK_DISPOSITION_OPTIONS.map((o) => (
                          <option key={o.code} value={o.code}>{o.label}</option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
                <p style={{ fontSize: 13, fontWeight: 700, textAlign: 'right', marginBottom: 12 }}>
                  Total estimé :{' '}
                  {fmt(refundLines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_price || 0), 0))}
                </p>
              </>
            )}

            <div className="form-row">
              <label>Motif valable *</label>
              <select
                value={refundReasonCode}
                onChange={(e) => setRefundReasonCode(e.target.value)}
                disabled={refundSaving}
              >
                <option value="">— Sélectionner un motif —</option>
                {REFUND_REASON_OPTIONS.map((o) => (
                  <option key={o.code} value={o.code}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>Explication détaillée * (obligatoire)</label>
              <textarea
                rows={3}
                value={refundReasonDetail}
                onChange={(e) => setRefundReasonDetail(e.target.value)}
                placeholder="Décrivez précisément le problème (ex. carton ouvert, référence X reçue cassée, erreur de quantité facturée…)"
                disabled={refundSaving}
              />
              <button
                type="button"
                className="secondary"
                style={{ marginTop: 6, fontSize: 12 }}
                disabled={refundSaving}
                onClick={() => setRefundReasonDetail(polishRefundReason(refundReasonDetail, refundReasonCode))}
              >
                Améliorer le motif (assistant)
              </button>
              <small style={{ color: 'var(--muted)', fontSize: 12 }}>
                Minimum 12 caractères. Sans explication claire, le remboursement est refusé.
              </small>
            </div>

            
            <div className="form-row">
              <label>Mode de sortie (si déjà encaissé)</label>
              <select value={refundPayMethod} onChange={(e) => setRefundPayMethod(e.target.value)} disabled={refundSaving}>
                <option value="cash">Espèces (caisse)</option>
                <option value="card">Carte</option>
                <option value="transfer">Virement</option>
                <option value="cheque">Chèque</option>
                <option value="other">Autre</option>
              </select>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0 0' }}>
                Déjà payé → sortie dans Solde. Non payé → réduction du reste dû uniquement.
              </p>
            </div>
            <ModalFormError message={modalError} />
<div className="form-actions">
              <button
                type="button"
                disabled={refundSaving}
                onClick={async () => {
                  if (!refundSourceId) {
                    const msg = 'Choisissez la facture d’origine à rembourser.';
                    flash(msg, 'error');
                    toast(msg, 'error');
                    return;
                  }
                  if (!refundReasonCode) {
                    const msg = 'Sélectionnez un motif valable (obligatoire).';
                    flash(msg, 'error');
                    toast(msg, 'error');
                    return;
                  }
                  if (refundReasonDetail.trim().length < 12) {
                    const msg = 'Explication trop courte (min. 12 caractères). Sans détail clair, le remboursement est refusé.';
                    flash(msg, 'error');
                    toast(msg, 'error');
                    return;
                  }
                  const active = refundLines.filter((l) => Number(l.quantity) > 0);
                  if (!active.length) {
                    const msg = 'Indiquez au moins une quantité à rembourser.';
                    flash(msg, 'error');
                    toast(msg, 'error');
                    return;
                  }
                  for (const l of active) {
                    if (!l.restock && !l.disposition) {
                      const msg = `Disposition obligatoire pour « ${l.product_name} » (sans retour stock).`;
                      flash(msg, 'error');
                      toast(msg, 'error');
                      return;
                    }
                  }
                  const restockCount = active.filter((l) => l.restock).length;
                  const noRestockCount = active.length - restockCount;
                  const items = active.map((l) => ({
                    invoice_item_id: l.invoice_item_id,
                    quantity: l.quantity,
                    restock: l.restock,
                    disposition: l.restock ? undefined : l.disposition,
                  }));
                  let ageNote = '';
                  if (refundSource?.issue_date) {
                    const days = Math.floor(
                      (Date.now() - new Date(refundSource.issue_date).getTime()) / 86400000,
                    );
                    if (days > 30) {
                      ageNote = `\n\n⚠ Document de ${days} jours (> 30 j). Vérifiez le motif avant de continuer.`;
                    }
                  }
                  const paidNote =
                    Number(refundSource?.amount_paid || 0) >= Number(refundSource?.total || 0) - 0.001
                      ? '\n• Pièce déjà encaissée → sortie Solde'
                      : '\n• Non encaissée → crédit sur reste dû';
                  const ok = await confirm({
                    title: 'Confirmer le remboursement WR',
                    message:
                      `Créer un avoir WR ?\n\n` +
                      `• ${restockCount} ligne(s) → retour stock\n` +
                      `• ${noRestockCount} ligne(s) → hors stock\n` +
                      paidNote +
                      ageNote,
                    confirmLabel: 'Créer l’avoir WR',
                    cancelLabel: 'Retour',
                  });
                  if (!ok) return;
                  setRefundSaving(true);
                  try {
                    const res: any = await api.createRemboursement({
                      refund_of_invoice_id: refundSourceId,
                      refund_reason_code: refundReasonCode,
                      refund_payment_method: refundPayMethod,
                      refund_reason: refundReasonDetail.trim(),
                      items,
                    });
                    const msg = res.message || `Avoir ${res.data?.number || 'WR'} créé.`;
                    flash(msg);
                    toast(msg, 'success');
                    setShowRefund(false);
                    load(true);
                  } catch (e: any) {
                    const msg = friendlyError(e, 'Impossible de créer le remboursement.');
                    flash(msg, 'error');
                    toast(msg, 'error');
                  } finally {
                    setRefundSaving(false);
                  }
                }}
              >
                {refundSaving ? 'Enregistrement…' : 'Créer le remboursement WR'}
              </button>
              <button type="button" className="secondary" disabled={refundSaving} onClick={() => setShowRefund(false)}>
                Annuler
              </button>
            </div>
          </div>
        </div></FloatingPortal>
      )}

      {payTarget && (
        <FloatingPortal><div className="modal-overlay" onClick={() => !saving && setPayTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h2 style={{ marginTop: 0 }}>
              {payMode === 'full' ? 'Tout payer — choisir le mode' : 'Enregistrer un paiement'}
            </h2>
            <p style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 16 }}>
              Facture <strong>{payTarget.number}</strong> — {payTarget.client_name}
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: 10,
                marginBottom: 16,
                padding: 12,
                background: 'var(--stone, #f5f2eb)',
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              <div>
                <div style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>Total</div>
                <strong>{fmt(payTarget.total)}</strong>
              </div>
              <div>
                <div style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>Déjà payé</div>
                <strong style={{ color: 'var(--success, #3f3f46)' }}>{fmt(payTarget.amount_paid || 0)}</strong>
              </div>
              <div>
                <div style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>Reste dû</div>
                <strong style={{ color: 'var(--bad, #8b2e2e)' }}>{fmt(remainingOf(payTarget))}</strong>
              </div>
            </div>

            <div className="form-row">
              <label>Montant à encaisser maintenant</label>
              <NumberField
                min={0.01}
                step="0.01"
                value={payAmount}
                onValueChange={(v) => {
                  const max = remainingOf(payTarget);
                  const clamped = Math.min(v, max);
                  setPayAmount(clamped);
                  setPayMode(clamped >= max - 0.001 ? 'full' : 'partial');
                }}
                disabled={payMode === 'full' || saving}
              />
              {payMode === 'full' && (
                <small style={{ color: 'var(--muted)', fontSize: 12 }}>Montant fixé au reste dû (règlement intégral).</small>
              )}
            </div>

            <div className="form-row">
              <label>Mode de paiement *</label>
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} disabled={saving}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <small style={{ color: 'var(--muted)', fontSize: 12 }}>
                Espèces / carte → caisse. Virement / chèque → banque (solde caisse vs banque).
              </small>
            </div>

            <div className="form-row">
              <label>Date du paiement</label>
              <DatePicker value={payDate} onChange={setPayDate} disabled={saving} />
            </div>

            <div className="form-row">
              <label>Note (optionnel)</label>
              <input
                type="text"
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                placeholder="Ex. chèque n°…, référence virement…"
                disabled={saving}
              />
            </div>

            <div className="form-actions">
              <button onClick={submitPay} disabled={saving}>
                {saving ? '…' : payMode === 'full' ? 'Valider le règlement intégral' : 'Enregistrer ce paiement'}
              </button>
              <button className="secondary" onClick={() => setPayTarget(null)} disabled={saving}>Annuler</button>
            </div>
          </div>
        </div></FloatingPortal>
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
