import { useEffect, useState } from 'react';
import { matchProducts } from '../lib/assist';
import { SuggestList } from '../components/AssistBits';
import { Link } from 'react-router-dom';
import { api, BASE } from '../api';
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
import '../components/erp/orders-fulfillment.css';
import RemboursementModal from '../components/RemboursementModal';

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
  const [list, setList] = useState<any[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showRefund, setShowRefund] = useState(false);
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

  const [clientId, setClientId] = useState<number | ''>('');
  const [clientName, setClientName] = useState('Client de passage');
  const [clientIce, setClientIce] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [issueDate, setIssueDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<Line[]>([
    { product_name: '', quantity: 1, list_price: 0, unit_price: 0, product_query: '' },
  ]);
  const [payMode, setPayMode] = useState<'cash' | 'card'>('cash');
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

  const load = (soft = false) => {
    if (soft) setRefreshing(true);
    else setLoading(true);
    Promise.all([
      api.getInvoices(filter || undefined, { kind: 'quick_sale' }).catch(() => ({ data: [] })),
      api.getProducts({ include_variants: true } as any).catch(() => ({ data: [] })),
      api.getClients().catch(() => ({ data: [] })),
    ])
      .then(([i, p, c]: any[]) => {
        setList(i.data || []);
        setProducts(p.data || []);
        setClients(c.data || []);
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };
  useEffect(() => { load(); }, [filter]);

  const selectClient = (id: number | '') => {
    setClientId(id);
    if (!id) {
      setClientName('Client de passage');
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
      load(true);
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
      toast('Motif trop court.', 'error');
      return;
    }
    try {
      const r: any = await api.updateInvoiceStatus(id, { status: 'cancelled', void_reason: voidReason.trim() } as any);
      flash(r.message || 'Ticket annulé — stock rétabli.');
      load(true);
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
    setPwDesc(disclaimer + ' Saisissez votre mot de passe.');
    setPendingAction(() => async (password: string) => {
      const res: any = await api.deleteInvoice(id, password);
      flash(res.message || 'Ticket supprimé.');
      setPwOpen(false);
      setPendingAction(null);
      load(true);
    });
    setPwOpen(true);
  };

  const resetForm = () => {
    setClientId('');
    setClientName('Client de passage');
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
      flash('Indiquez un nom de client (ou « Client de passage »).', 'error');
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
      flash(`Ticket ${number} créé · ${fmt(invTotal)} (à encaisser)`, 'success');
      toast(`Ticket ${number} enregistré — paiement non appliqué`, 'success');
      resetForm();
      setShowModal(false);
      load(true);
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
    <div className="atlas-orders">
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
          <button onClick={() => { resetForm(); setShowModal(true); }}>+ Nouvelle vente</button>
        </div>
      </div>

      
      <div className="atlas-stat-grid" style={{ marginBottom: 16 }}>
        <div className="atlas-stat paper"><div className="as-label">Tickets</div><div className="as-value">{qsKpis.n}</div></div>
        <div className="atlas-stat paper"><div className="as-label">Ouverts</div><div className="as-value">{qsKpis.open}</div></div>
        <div className="atlas-stat paper"><div className="as-label">Payés</div><div className="as-value">{qsKpis.paid}</div></div>
      </div>
<SaveFeedback message={msg} type={msgType} />

      <div className="card" style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div className="search-bar">
          <input
            className="search-input"
            placeholder="Rechercher par numéro ou nom de client..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="card">
        <VirtualScroll maxHeight={filtered.length > 60 ? 560 : undefined}>
          <table className="data-dense">
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
                      onAction={() => { resetForm(); setShowModal(true); }}
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
        <div className="modal-overlay" onClick={() => !busy && setShowModal(false)}>
          <div className="modal" style={{ maxWidth: 1080, width: '96vw' }} onClick={(e) => e.stopPropagation()}>
            <h2>Nouvelle vente rapide (caisse)</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.45 }}>
              Prix saisis tels quels. <strong>Aucune TVA</strong> n’est calculée sur les tickets VR.
            </p>

            <div className="form-row">
              <label>Client enregistré</label>
              <select
                value={clientId}
                onChange={(e) => selectClient(e.target.value ? Number(e.target.value) : '')}
              >
                <option value="">— Client de passage / saisie manuelle —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.ice ? ` (ICE ${c.ice})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-2">
              <div className="form-row">
                <label>Nom du client *</label>
                <input
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Client de passage"
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
                <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              </div>
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
                    <div>
                      <input
                        placeholder="Rechercher nom, SKU…"
                        value={item.product_query ?? ''}
                        onChange={(e) => updateLine(idx, 'product_query', e.target.value)}
                        list={`qs-prod-${idx}`}
                      />
                      <datalist id={`qs-prod-${idx}`}>
                        {filteredP.map((p) => (
                          <option key={p.id} value={p.name} />
                        ))}
                      </datalist>
                      
                    </div>
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
                      onClick={() => setItems(items.filter((_, i) => i !== idx))}
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

            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              {([['cash', 'Espèces'], ['card', 'Carte']] as const).map(([k, lab]) => (
                <button
                  key={k}
                  type="button"
                  className={payMode === k ? '' : 'secondary'}
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

            <div className="form-actions">
              <button type="button" onClick={() => void checkout()} disabled={busy}>
                {busy ? 'Encaissement…' : `Encaisser · ${fmt(total)}`}
              </button>
              <button type="button" className="secondary" onClick={() => !busy && setShowModal(false)}>Annuler</button>
            </div>
          </div>
        </div>
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
        <div className="modal-overlay" onClick={() => !settleSaving && setPayTarget(null)}>
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
                <strong style={{ color: 'var(--success, #2d5a2d)' }}>{fmt(payTarget.amount_paid || 0)}</strong>
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
              <input type="date" value={settleDate} onChange={(e) => setSettleDate(e.target.value)} disabled={settleSaving} />
            </div>

            <div className="form-row">
              <label>Note (optionnel)</label>
              <input type="text" value={settleNote} onChange={(e) => setSettleNote(e.target.value)} disabled={settleSaving} />
            </div>

            <div className="form-actions">
              <button type="button" onClick={() => void submitSettle()} disabled={settleSaving}>
                {settleSaving ? '…' : settleMode === 'full' ? 'Valider le règlement intégral' : 'Enregistrer ce paiement'}
              </button>
              <button type="button" className="secondary" onClick={() => setPayTarget(null)} disabled={settleSaving}>
                Annuler
              </button>
            </div>
          </div>
        </div>
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