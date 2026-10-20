import { useEffect, useState } from 'react';
import DatePicker from '../components/DatePicker';
import { matchProducts } from '../lib/assist';
import { SuggestList } from '../components/AssistBits';
import { Link } from 'react-router-dom';
import { api, BASE } from '../api';
import TypeaheadField, { productTypeaheadOptions, partyTypeaheadOptions } from '../components/TypeaheadField';
import { getToken } from '../auth';
import SaveFeedback from '../components/SaveFeedback';
import NumberField from '../components/NumberField';
import EmptyState from '../components/EmptyState';
import VirtualTableBody, { VirtualScroll } from '../components/VirtualTableBody';
import { statusFr, statusBadgeClass } from '../lib/labels';
import { fmtMoney, PAYMENT_METHODS } from '../lib/money';
import { useUi } from '../components/AppDialogs';
import PasswordConfirm from '../components/PasswordConfirm';
import { friendlyError } from '../lib/errors';
import RefreshIconButton from '../components/RefreshIconButton';
import { useWizard, StepBody, WizardFoot } from '../components/ui/FormWizard';
import '../components/erp/orders-fulfillment.css';
import RemboursementModal from '../components/RemboursementModal';
import { FloatingPortal } from '../components/FloatingPortal';
import { ModalFormError, FieldHint } from '../components/ModalFormFeedback';

type Product = {
  id: number;
  name: string;
  sku?: string;
  barcode?: string;
  price?: number;
  unit_price?: number;
  stock_quantity?: number;
};

type Line = {
  product_id?: number;
  product_name: string;
  product_query?: string;
  quantity: number;
  list_price: number;
  unit_price: number;
};

const today = () => new Date().toISOString().slice(0, 10);

export default function QuickSale() {
  const { toast, confirm, prompt } = useUi();
  const [modalError, setModalError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [list, setList] = useState<any[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showRefund, setShowRefund] = useState(false);
  const [cashIn, setCashIn] = useState(0);
  const [wrTotal, setWrTotal] = useState(0);
  // Encaissement list row (distinct from create-ticket payMode cash/card)
  const [payTarget, setPayTarget] = useState<any>(null);
  const [settleMode, setSettleMode] = useState<'full' | 'partial'>('full');
  const [settleAmount, setSettleAmount] = useState(0);
  const [settleMethod, setSettleMethod] = useState('cash');
  const [settleNote, setSettleNote] = useState('');
  const [settleDate, setSettleDate] = useState(today());
  const [settleSaving, setSettleSaving] = useState(false);
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const wz = useWizard(3);

  const [clientId, setClientId] = useState<number | ''>('');
  const [clientName, setClientName] = useState('');
  const [clientIce, setClientIce] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [issueDate, setIssueDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<Line[]>([
    { product_name: '', quantity: 1, list_price: 0, unit_price: 0, product_query: '' },
  ]);
  const [payMode, setPayMode] = useState<'cash' | 'card'>('cash');
  const [barcodeScan, setBarcodeScan] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'success' | 'error'>('success');
  const [pwOpen, setPwOpen] = useState(false);
  const [pwTitle, setPwTitle] = useState('');
  const [pwDesc, setPwDesc] = useState('');
  const [pendingAction, setPendingAction] = useState<null | ((password: string) => Promise<void>)>(null);

  const flash = (m: string, type: 'success' | 'error' = 'success') => {
    setMsg(m);
    setMsgType(type);
    setTimeout(() => setMsg(''), 4500);
  };

  const refreshCounts = () => load(true);
  const load = (soft = false) => {
    if (soft) setRefreshing(true);
    else setLoading(true);
    Promise.all([
      api.getInvoices(filter || undefined, { kind: 'quick_sale' }).catch(() => ({ data: [] })),
      api.getProducts({ include_variants: true } as any).catch(() => ({ data: [] })),
      api.getClients().catch(() => ({ data: [] })),
      api.getInvoices(undefined, { kind: 'all' } as any).catch(() => ({ data: [] })),
    ])
      .then(([i, p, c, all]: any[]) => {
        setList(i.data || []);
        setProducts(p.data || []);
        setClients(c.data || []);
        const allArr: any[] = all.data || [];
        const isVR = (x: any) => /^VR[-/]/.test(x.number || '') || ['quick_sale', 'ticket'].includes(x.doc_kind || '');
        const isWR = (x: any) => /^WR[-/]/.test(x.number || '') || (x.doc_kind || '') === 'remboursement';
        setCashIn(allArr.filter((x) => isVR(x) && x.status === 'paid').reduce((s2, x) => s2 + (Number(x.amount_paid) || Number(x.total) || 0), 0));
        setWrTotal(allArr.filter((x) => isWR(x) && x.status !== 'cancelled').reduce((s2, x) => s2 + (Number(x.total) || 0), 0));
      })
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


  const applyBarcodeScan = async (code: string) => {
    const c = code.trim();
    if (!c) return;
    let p = products.find(
      (x) => String(x.barcode || '') === c || String(x.sku || '') === c || String(x.id) === c,
    );
    if (!p) {
      try {
        const list: any = await api.getProducts({ q: c, limit: 8 } as any);
        const rows = list?.data || [];
        p = rows.find(
          (x: any) => String(x.barcode || '') === c || String(x.sku || '').toLowerCase() === c.toLowerCase(),
        ) || rows[0];
      } catch { /* */ }
    }
    if (!p) {
      flash('Produit introuvable pour ce code.', 'error');
      setBarcodeScan('');
      return;
    }
    let unit = Number(p.price || 0);
    if (clientId) {
      try {
        const pr: any = await api.getClientPriceForProduct(Number(clientId), Number(p.id));
        if (pr?.data?.unit_price != null) unit = Number(pr.data.unit_price);
      } catch { /* */ }
    }
    setItems((prev) => {
      const emptyIdx = prev.findIndex((it) => !it.product_id && !String(it.product_name || '').trim());
      const row = {
        product_id: p.id,
        product_name: p.name || '',
        product_query: p.name || '',
        sku: p.sku || '',
        quantity: 1,
        list_price: Number(p.price || 0),
        unit_price: unit,
      };
      if (emptyIdx >= 0) {
        const next = [...prev];
        next[emptyIdx] = { ...next[emptyIdx], ...row };
        return next;
      }
      return [...prev, row];
    });
    setBarcodeScan('');
    flash(`Ajouté: ${p.name}`);
  };

  useEffect(() => { load(); }, [filter]);

  const selectClient = (id: number | '') => {
    setClientId(id);
    if (!id) {
      setClientName('');
      setClientIce('');
      setClientPhone('');
      return;
    }
    const cl = clients.find((x) => Number(x.id) === Number(id));
    if (cl) {
      setClientName(cl.name || '');
      setClientIce(cl.ice || '');
      setClientPhone(cl.phone || '');
    }
  };

  const updateLine = (idx: number, field: string, value: any) => {
    setItems((prev) => {
      const next = [...prev];
      const line = { ...next[idx], [field]: value };
      if (field === 'product_id' && value) {
        const p = products.find((x) => Number(x.id) === Number(value));
        if (p) {
          const price = Number(p.unit_price ?? p.price ?? 0);
          line.product_name = p.name;
          line.list_price = price;
          line.unit_price = price;
          line.product_query = p.name;
        }
      }
      if (field === 'product_query') {
        const q = String(value || '').toLowerCase();
        const match = products.find(
          (p) =>
            p.name?.toLowerCase() === q ||
            p.sku?.toLowerCase() === q ||
            String(p.barcode || '') === String(value),
        );
        if (match) {
          const price = Number(match.unit_price ?? match.price ?? 0);
          line.product_id = match.id;
          line.product_name = match.name;
          line.list_price = price;
          line.unit_price = price;
        }
      }
      next[idx] = line;
      return next;
    });
  };

  const total = items.reduce(
    (s, it) => s + Number(it.quantity || 0) * Number(it.unit_price || 0),
    0,
  );
  const fmt = (n: number) => fmtMoney(n, 'MAD');

  const remainingOf = (inv: any) =>
    Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0));

  const markPaid = (inv: any) => {
    const rest = remainingOf(inv);
    if (rest <= 0) {
      flash('Ce ticket est déjà soldé.', 'error');
      return;
    }
    setPayTarget(inv);
    setSettleAmount(rest);
    setSettleMethod('cash');
    setSettleNote('Règlement intégral');
    setSettleDate(today());
    setSettleMode('full');
  };

  const openPartialPay = (inv: any) => {
    const rest = remainingOf(inv);
    if (rest <= 0) {
      flash('Ce ticket est déjà soldé.', 'error');
      return;
    }
    setPayTarget(inv);
    setSettleAmount(rest);
    setSettleMethod('cash');
    setSettleNote('');
    setSettleDate(today());
    setSettleMode('partial');
  };

  const submitSettle = async () => {
    if (!payTarget) return;
    const rest = remainingOf(payTarget);
    const amount = settleMode === 'full' ? rest : Number(settleAmount);
    if (!amount || amount <= 0) {
      flash('Montant invalide', 'error');
      return;
    }
    if (amount > rest + 0.001) {
      flash(`Le montant ne peut pas dépasser le reste dû (${fmt(rest)}).`, 'error');
      return;
    }
    setSettleSaving(true);
    try {
      const res: any = await api.recordInvoicePayment(payTarget.id, {
        amount,
        payment_method: settleMethod,
        payee: settleMethod.includes('owner') ? 'owner' : 'company',
        note: settleNote || (settleMode === 'full' ? 'Règlement intégral' : ''),
        paid_at: settleDate,
      });
      flash(res.message || 'Paiement enregistré');
      setPayTarget(null);
      refreshCounts();
    } catch (e: any) {
      flash(e?.message || 'Paiement impossible', 'error');
    } finally {
      setSettleSaving(false);
    }
  };


  const cancelTicket = async (id: number) => {
    const ok = await confirm({
      title: 'Annuler ce ticket VR',
      message: 'Le numéro VR est conservé. Le stock sera rétabli.',
      danger: true,
      confirmLabel: 'Continuer',
    });
    if (!ok) return;
    const voidReason = await prompt({
      title: 'Motif d’annulation (obligatoire)',
      message: 'Ex. erreur de caisse, doublon…',
      placeholder: 'Motif (min. 5 caractères)',
      confirmLabel: 'Annuler le ticket',
    });
    if (!voidReason || voidReason.trim().length < 5) {
      setModalError('Motif trop court.');
      return;
    }
    try {
      const r: any = await api.updateInvoiceStatus(id, { status: 'cancelled', void_reason: voidReason.trim() } as any);
      flash(r.message || 'Ticket annulé — stock rétabli.');
      refreshCounts();
    } catch (e: any) {
      flash(friendlyError(e), 'error');
    }
  };

  const requestDelete = async (id: number) => {
    let disclaimer =
      'Suppression définitive du ticket VR et des paiements liés. Stock rétabli si le ticket n’est pas déjà annulé.';
    try {
      const links = await api.getInvoiceLinks(id);
      const d = links.data;
      const bits: string[] = [];
      if (d?.receipts?.length) bits.push(`${d.receipts.length} reçu(s)`);
      if (d?.payments_count) bits.push(`${d.payments_count} paiement(s)`);
      if (bits.length) disclaimer = `Ce ticket VR et ${bits.join(', ')} seront effacés. Stock rétabli.`;
    } catch { /* */ }
    setPwTitle('Supprimer le ticket VR');
    setPwDesc(disclaimer + ' Confirmez pour continuer.');
    setPendingAction(() => async (password: string) => {
      const res: any = await api.deleteInvoice(id, password);
      flash(res.message || 'Ticket supprimé.');
      setPwOpen(false);
      setPendingAction(null);
      refreshCounts();
    });
    setPwOpen(true);
  };

  const resetForm = () => {
    setClientId('');
    setClientName('');
    setClientIce('');
    setClientPhone('');
    setIssueDate(today());
    setNotes('');
    setPayMode('cash');
    setItems([{ product_name: '', quantity: 1, list_price: 0, unit_price: 0, product_query: '' }]);
  };

  const checkout = async () => {
    const lines = items.filter(
      (it) => (it.product_name || '').trim() && Number(it.quantity) > 0,
    );
    if (!lines.length) {
      flash('Ajoutez au moins une ligne produit.', 'error');
      return;
    }
    if (!(clientName || '').trim()) {
      flash('Indiquez un nom de client.', 'error');
      return;
    }
    setBusy(true);
    try {
      const inv: any = await api.createInvoice({
        client_id: clientId || undefined,
        client_name: clientName.trim(),
        client_ice: clientIce,
        client_phone: clientPhone,
        issue_date: issueDate,
        status: 'sent',
        quick_sale: true,
        doc_kind: 'quick_sale',
        tax_exempt: true,
        notes:
          notes ||
          `Vente rapide · mode prévu : ${payMode === 'card' ? 'Carte' : 'Espèces'} · sans TVA · non encaissé`,
        items: lines.map((l) => ({
          product_id: l.product_id,
          product_name: l.product_name,
          quantity: l.quantity,
          unit_price: l.unit_price,
          list_price: l.list_price,
          tax_rate: 0,
        })),
      });
      const data = inv?.data || inv;
      const invId = Number(data?.id);
      const invTotal = Number(data?.total ?? total);
      const number = String(data?.number || invId);

      // VR is NOT paid automatically — user encaisses later from the ticket page
      // Remember client-specific prices when discounted vs catalogue
      if (clientId) {
        for (const it of items) {
          if (!it.product_id) continue;
          const list = Number(it.list_price || 0);
          const unit = Number(it.unit_price || 0);
          if (unit > 0 && (list <= 0 || Math.abs(unit - list) > 0.001)) {
            api.setClientProductPrice(Number(clientId), Number(it.product_id), unit).catch(() => {});
          }
        }
      }
      flash(`Ticket ${number} créé · ${fmt(invTotal)} (à encaisser)`, 'success');
      toast(`Ticket ${number} créé — à encaisser · ${fmt(invTotal)}`, 'success');
      resetForm();
      setShowModal(false);
      refreshCounts();
    } catch (e: any) {
      flash(e?.message || 'Échec de la vente rapide', 'error');
    } finally {
      setBusy(false);
    }
  };

  const isQuickSaleDoc = (inv: any) => {
    const kind = String(inv.doc_kind || '').toLowerCase();
    const st = String(inv.status || '').toLowerCase();
    const num = String(inv.number || '');
    if (st === 'quote' || st === 'devis' || st === 'remboursement') return false;
    if (kind === 'quote' || kind === 'devis' || kind === 'remboursement') return false;
    if (kind === 'quick_sale' || kind === 'ticket' || num.startsWith('VR')) return true;
    // Backend kind=quick_sale already scopes list; keep search-only pass-through for VR rows
    return true;
  };
  const filtered = list.filter((inv) => {
    if (!isQuickSaleDoc(inv)) return false;
    if (!search) return true;
    const s = search.toLowerCase();
    return (inv.number || '').toLowerCase().includes(s) || (inv.client_name || '').toLowerCase().includes(s);
  });

  const token = getToken() || '';

  if (loading) return <div className="empty">Chargement des ventes rapides...</div>;

  const qsKpis = (() => {
    const open = filtered.filter((i: any) => i.status !== 'paid' && i.status !== 'cancelled').length;
    const paid = filtered.filter((i: any) => i.status === 'paid').length;
    return { n: filtered.length, open, paid };
  })();

  return (
    <div className="atlas-orders quicksale-page">
      <div className="page-header">
        <div>
          <h1>Vente rapide</h1>
          <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>
            Tickets caisse série VR — sans TVA. Le paiement n’est pas appliqué automatiquement : encaissement depuis le ticket. Distinct des factures FA.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <RefreshIconButton onClick={() => load(true)} loading={refreshing} />
          <button
            type="button"
            className="secondary"
            style={{ borderColor: 'var(--copper, #b87333)', color: 'var(--copper-dark, #8a5520)' }}
            onClick={() => setShowRefund(true)}
          >
            + Remboursement (WR)
          </button>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 'auto' }} aria-label="Filtrer par statut">
            <option value="">Tous les tickets</option>
            <option value="sent">Non soldés</option>
            <option value="partial">Partiels</option>
            <option value="paid">Encaissés</option>
            <option value="cancelled">Annulés</option>
          </select>
          <button onClick={() => { resetForm(); setModalError(''); wz.reset(); setShowModal(true); }}>+ Nouvelle vente</button>
        </div>
      </div>

      
      <div className="ac-metric-grid" style={{ marginBottom: 16 }}>
        <div className="ac-metric"><div className="as-label">Tickets</div><div className="as-value">{qsKpis.n}</div></div>
        <div className="ac-metric"><div className="as-label">Ouverts</div><div className="as-value">{qsKpis.open}</div></div>
        <div className="ac-metric"><div className="as-label">Payés</div><div className="as-value">{qsKpis.paid}</div></div>
        <div className="ac-metric ac-metric--solde"><div className="as-label">Solde caisse</div><div className="as-value">{new Intl.NumberFormat('fr-MA', { maximumFractionDigits: 2 }).format(cashIn - wrTotal)} <small>MAD</small></div><div className="as-hint">encaissé {new Intl.NumberFormat('fr-MA', { maximumFractionDigits: 0 }).format(cashIn)} − remboursements {new Intl.NumberFormat('fr-MA', { maximumFractionDigits: 0 }).format(wrTotal)}</div></div>
      </div>
<SaveFeedback message={msg} type={msgType} />

      <div className="ac-panel ac-products-filters" style={{ marginBottom: 16 }}>
        <div className="ac-products-filters-row">
          <div className="ac-search-field">
            <input
              className="ac-search-input"
              placeholder="Rechercher par numéro ou nom de client..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="ac-panel ac-products-table-panel">
        <VirtualScroll maxHeight={filtered.length > 60 ? 560 : undefined}>
          <table className="data-dense ac-products-table">
            <thead>
              <tr>
                <th>Numéro</th>
                <th>Client</th>
                <th>Date</th>
                <th>Statut</th>
                <th>Total</th>
                <th>Payé</th>
                <th>Reste</th>
                <th>Actions</th>
              </tr>
            </thead>
            {filtered.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      title="Aucune vente rapide"
                      description="Créez un ticket caisse (série VR). Aucune TVA n’est appliquée."
                      actionLabel="Nouvelle vente"
                      onAction={() => { resetForm(); setModalError(''); wz.reset(); setShowModal(true); }}
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
                    <td><Link to={`/quick-sale/${inv.id}`}><strong>{inv.number}</strong></Link></td>
                    <td>{inv.client_name}</td>
                    <td>{inv.issue_date}</td>
                    <td><span className={`badge ${statusBadgeClass(inv.status)}`}>{statusFr(inv.status)}</span></td>
                    <td style={{ fontWeight: 700 }}>{fmt(inv.total)}</td>
                    <td>{fmt(inv.amount_paid || 0)}</td>
                    <td style={{ fontWeight: 700, color: inv.status === 'paid' || inv.status === 'cancelled' ? 'var(--muted)' : 'var(--bad)' }}>
                      {inv.status === 'cancelled' ? '—' : fmt(Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0)))}
                    </td>
                    <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {inv.status !== 'cancelled' && remainingOf(inv) > 0.001 && (
                        <>
                          <button
                            type="button"
                            className="success"
                            style={{ padding: '4px 10px', fontSize: 12 }}
                            onClick={() => markPaid(inv)}
                          >
                            Tout payer
                          </button>
                          <button
                            type="button"
                            className="secondary"
                            style={{ padding: '4px 10px', fontSize: 12 }}
                            onClick={() => openPartialPay(inv)}
                          >
                            Paiement
                          </button>
                        </>
                      )}
                      <Link to={`/quick-sale/${inv.id}`} className="btn secondary" style={{ padding: '4px 10px', fontSize: 12 }}>Ouvrir</Link>
                      <a
                        className="btn secondary"
                        style={{ padding: '4px 10px', fontSize: 12 }}
                        href={`${BASE}/api/invoices/${inv.id}/print?token=${encodeURIComponent(token)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Imprimer
                      </a>
                      {inv.status !== 'cancelled' && (
                        <button
                          type="button"
                          className="secondary"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                          onClick={() => void cancelTicket(inv.id)}
                        >
                          Annuler
                        </button>
                      )}
                      <button
                        type="button"
                        className="danger"
                        style={{ padding: '4px 10px', fontSize: 12 }}
                        onClick={() => void requestDelete(inv.id)}
                      >
                        Suppr.
                      </button>
                    </td>
                  </tr>
                )}
              />
            )}
          </table>
        </VirtualScroll>
      </div>

      {showModal && (
        <FloatingPortal><div className="modal-overlay" onClick={() => { if (busy) return; setShowModal(false); resetForm(); wz.reset(); }}>
          <div className="modal" style={{ maxWidth: 1080, width: '96vw' }} onClick={(e) => e.stopPropagation()}>
            <h2>Nouvelle vente rapide (caisse)</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.45 }}>
              Prix saisis tels quels. <strong>Aucune TVA</strong> n’est calculée sur les tickets VR.
            </p>

            <StepBody active={wz.step === 1}>
            <div className="form-row">
              <label>Client enregistré</label>
              <TypeaheadField
                value={clientName}
                placeholder="Rechercher un client…"
                options={partyTypeaheadOptions(clients, 'client')}
                onOpen={() => {
                  api.getClients().then((r: any) => {
                    if (Array.isArray(r?.data)) setClients(r.data);
                  }).catch(() => {});
                }}
                onChange={(v) => {
                  setClientName(v);
                  setClientId('');
                }}
                onPick={(o) => {
                  selectClient(Number(o.id));
                }}
                emptyLabel="Aucun client"
              />
            </div>

            <div className="grid grid-2">
              <div className="form-row">
                <label>Nom du client *</label>
                <input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Nom du client"
                />
              </div>
              <div className="form-row">
                <label>ICE / Identifiant fiscal</label>
                <input value={clientIce} onChange={(e) => setClientIce(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-2">
              <div className="form-row">
                <label>Téléphone</label>
                <input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} />
              </div>
              <div className="form-row">
                <label>Date d'émission</label>
                <DatePicker value={issueDate} onChange={setIssueDate} />
              </div>
            </div>

            </StepBody>
            <StepBody active={wz.step === 2}>
            <div className="form-row" style={{ marginTop: 12 }}>
              <label>Code-barres / SKU (Entrée = ajouter)</label>
              <input
                value={barcodeScan}
                onChange={(e) => setBarcodeScan(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    applyBarcodeScan(barcodeScan);
                  }
                }}
                placeholder="Scanner ou saisir puis Entrée…"
                autoComplete="off"
              />
            </div>

            <h3 style={{ margin: '16px 0 8px', fontSize: 14 }}>
              Lignes — recherche produit · prix · quantité
            </h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1.5fr 1.2fr 70px 100px 100px 100px 36px',
                gap: 6,
                marginBottom: 6,
                fontSize: 10,
                color: 'var(--muted)',
                fontWeight: 600,
              }}
            >
              <span>Recherche / produit</span>
              <span>Désignation</span>
              <span>Qté</span>
              <span>P.U. catalogue</span>
              <span>P.U. client</span>
              <span>Total</span>
              <span />
            </div>
            {items.map((item, idx) => {
              const lineTotal = Number(item.quantity || 0) * Number(item.unit_price || 0);
              const q = (item.product_query || '').toLowerCase();
              const filteredP = q
                ? products.filter(
                    (p) =>
                      p.name?.toLowerCase().includes(q) ||
                      p.sku?.toLowerCase().includes(q) ||
                      String(p.barcode || '').includes(q),
                  ).slice(0, 40)
                : products.slice(0, 40);
              return (
                <div key={idx} style={{ marginBottom: 10 }}>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1.5fr 1.2fr 70px 100px 100px 100px 36px',
                      gap: 6,
                      alignItems: 'center',
                    }}
                  >
                    <TypeaheadField
                      value={item.product_query ?? ''}
                      placeholder="Rechercher nom, SKU…"
                      options={productTypeaheadOptions(products)}
                    onOpen={() => {
                      api.getProducts({ fields: 'light', limit: 500 }).then((r: any) => {
                        if (Array.isArray(r?.data)) setProducts(r.data);
                      }).catch(() => {});
                    }}
                      onChange={(v) => updateLine(idx, 'product_query', v)}
                      onPick={async (o) => {
                        const p = products.find((x) => String(x.id) === String(o.id));
                        if (!p) return;
                        let unit = Number(p.price || 0);
                        if (clientId) {
                          try {
                            const pr: any = await api.getClientPriceForProduct(Number(clientId), Number(p.id));
                            if (pr?.data?.unit_price != null) unit = Number(pr.data.unit_price);
                          } catch { /* */ }
                        }
                        updateLine(idx, 'product_id', p.id);
                        updateLine(idx, 'product_name', p.name || '');
                        updateLine(idx, 'product_query', p.name || '');
                        updateLine(idx, 'list_price', Number(p.price || 0));
                        updateLine(idx, 'unit_price', unit);
                        if (p.sku) updateLine(idx, 'sku', p.sku);
                      }}
                      emptyLabel="Aucun produit"
                    />
                    <input
                      placeholder="Désignation *"
                      value={item.product_name}
                      onChange={(e) => updateLine(idx, 'product_name', e.target.value)}
                    />
                    <NumberField value={item.quantity} onValueChange={(n) => updateLine(idx, 'quantity', n)} min={0.01} step="0.01" />
                    <NumberField value={item.list_price} onValueChange={(n) => updateLine(idx, 'list_price', n)} min={0} step="0.01" />
                    <NumberField value={item.unit_price} onValueChange={(n) => updateLine(idx, 'unit_price', n)} min={0} step="0.01" />
                    <div style={{ fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>
                      {fmt(lineTotal)}
                    </div>
                    <button
                      type="button"
                      className="danger"
                      style={{ padding: '6px 8px' }}
                      onClick={() =>
                        setItems((prev) => {
                          if (prev.length <= 1) {
                            return [{ product_name: '', quantity: 1, list_price: 0, unit_price: 0, product_query: '' }];
                          }
                          return prev.filter((_, i) => i !== idx);
                        })
                      }
                      aria-label="Supprimer"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
            <button
              type="button"
              className="secondary"
              onClick={() =>
                setItems([...items, { product_name: '', quantity: 1, list_price: 0, unit_price: 0, product_query: '' }])
              }
              style={{ marginBottom: 16 }}
            >
              + Ajouter une ligne
            </button>

            </StepBody>
            <StepBody active={wz.step === 3}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {([['cash', 'Espèces'], ['card', 'Carte']] as const).map(([k, lab]) => (
                <button
                  key={k}
                  type="button"
                  className={payMode === k ? 'qs-pay is-on' : 'secondary qs-pay'}
                  onClick={() => setPayMode(k)}
                >
                  {lab}
                </button>
              ))}
            </div>

            <div style={{ fontSize: 16, fontWeight: 800, textAlign: 'right', marginBottom: 12 }}>
              Total {fmt(total)}
            </div>

            <div className="form-row">
              <label>Notes</label>
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optionnel" />
            </div>

            </StepBody>
            <ModalFormError message={modalError} />
            <WizardFoot
              wz={wz}
              title="Nouvelle vente rapide (caisse)"
              stepLabel={['Client', 'Articles', 'Paiement'][wz.step - 1]}
              onCancel={() => { if (busy) return; setShowModal(false); resetForm(); wz.reset(); }}
              onSubmit={() => void checkout()}
              submitLabel={`Encaisser · ${fmt(total)}`}
              saving={busy}
            />
          </div>
        </div></FloatingPortal>
      )}

      {pwOpen && pendingAction && (
        <PasswordConfirm
          open={pwOpen}
          title={pwTitle}
          description={pwDesc}
          confirmLabel="Supprimer définitivement"
          onCancel={() => { setPwOpen(false); setPendingAction(null); }}
          onConfirm={async (password) => { await pendingAction(password); }}
        />
      )}
    
      {payTarget && (
        <FloatingPortal><div className="modal-overlay" onClick={() => !settleSaving && setPayTarget(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <h2 style={{ marginTop: 0 }}>
              {settleMode === 'full' ? 'Tout payer — ticket VR' : 'Paiement partiel — ticket VR'}
            </h2>
            <p style={{ fontSize: 14, lineHeight: 1.5, marginBottom: 16 }}>
              Ticket <strong>{payTarget.number}</strong> — {payTarget.client_name}
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
              <label>Montant à encaisser</label>
              <NumberField
                min={0.01}
                step="0.01"
                value={settleAmount}
                onValueChange={(v) => {
                  const max = remainingOf(payTarget);
                  const clamped = Math.min(v, max);
                  setSettleAmount(clamped);
                  setSettleMode(clamped >= max - 0.001 ? 'full' : 'partial');
                }}
                disabled={settleMode === 'full' || settleSaving}
              />
              {settleMode === 'full' && (
                <small style={{ color: 'var(--muted)', fontSize: 12 }}>Montant fixé au reste dû.</small>
              )}
            </div>

            <div className="form-row">
              <label>Mode de paiement *</label>
              <select value={settleMethod} onChange={(e) => setSettleMethod(e.target.value)} disabled={settleSaving}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            <div className="form-row">
              <label>Date</label>
              <DatePicker value={settleDate} onChange={setSettleDate} disabled={settleSaving} />
            </div>

            <div className="form-row">
              <label>Note (optionnel)</label>
              <input type="text" value={settleNote} onChange={(e) => setSettleNote(e.target.value)} disabled={settleSaving} />
            </div>

            <ModalFormError message={modalError} />
            <div className="form-actions">
              <button type="button" onClick={() => void submitSettle()} disabled={settleSaving}>
                {settleSaving ? '…' : settleMode === 'full' ? 'Valider le règlement intégral' : 'Enregistrer ce paiement'}
              </button>
              <button type="button" className="secondary" onClick={() => setPayTarget(null)} disabled={settleSaving}>
                Annuler
              </button>
            </div>
          </div>
        </div></FloatingPortal>
      )}

      <RemboursementModal
        open={showRefund}
        onClose={() => setShowRefund(false)}
        onCreated={() => load(true)}
        preferQuickSale
      />
</div>
  );
}