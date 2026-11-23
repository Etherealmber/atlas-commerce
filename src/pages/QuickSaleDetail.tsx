import DocumentActors from '../components/DocumentActors';
import TopPageActions from '../components/TopPageActions';
import { Ban, Pencil, Printer, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, BASE } from '../api';
import { getToken } from '../auth';
import { statusFr, statusBadgeClass } from '../lib/labels';
import { fmtMoney, paymentMethodLabel, remainingBalance } from '../lib/money';
import { useUi } from '../components/AppDialogs';
import PasswordConfirm from '../components/PasswordConfirm';
import RemboursementModal from '../components/RemboursementModal';
import SaveFeedback from '../components/SaveFeedback';
import NumberField from '../components/NumberField';
import { TimedUndoDelete } from '../components/ui';
import PageSkeleton from '../components/PageSkeleton';
import { friendlyError } from '../lib/errors';

function isVrDoc(inv: any) {
  return (
    inv?.doc_kind === 'quick_sale' ||
    inv?.doc_kind === 'ticket' ||
    String(inv?.number || '').startsWith('VR')
  );
}

type VrEditLine = {
  product_id?: number;
  product_name: string;
  sku?: string;
  quantity: number;
  unit_price: number;
  product_query?: string;
};

export default function QuickSaleDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { toast, confirm, prompt } = useUi();
  const [ticket, setTicket] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'success' | 'error'>('success');
  const [payAmount, setPayAmount] = useState(0);
  const [payMethod, setPayMethod] = useState('cash');
  const [paying, setPaying] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwDesc, setPwDesc] = useState('');
  const [pendingDelete, setPendingDelete] = useState<null | ((password: string) => Promise<void>)>(null);

  // In-place editing for VR ticket info & unpaid lines
  const [clients, setClients] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [editingInfo, setEditingInfo] = useState(false);
  const [savingInfo, setSavingInfo] = useState(false);
  const [infoForm, setInfoForm] = useState({
    client_id: '',
    client_name: '',
    client_ice: '',
    client_phone: '',
    client_city: '',
    client_address: '',
    issue_date: '',
    notes: '',
  });
  const [editingLines, setEditingLines] = useState(false);
  const [savingLines, setSavingLines] = useState(false);
  const [editLines, setEditLines] = useState<VrEditLine[]>([]);
  const [notesEdit, setNotesEdit] = useState('');
  const [showRefund, setShowRefund] = useState(false);
  const infoCardRef = useRef<HTMLDivElement>(null);
  const linesCardRef = useRef<HTMLDivElement>(null);

  const flash = (m: string, type: 'success' | 'error' = 'success') => {
    setMsg(m);
    setMsgType(type);
    setTimeout(() => setMsg(''), 5000);
  };

  const reload = async () => {
    if (!id) return;
    const [res, pays] = await Promise.all([
      api.getInvoice(+id),
      api.getInvoicePayments(+id).catch(() => ({ data: [] })),
    ]);
    setTicket(res.data);
    setPayments(pays.data || []);
    const due = remainingBalance(res.data?.total, res.data?.amount_paid);
    setPayAmount(due);
    setInfoForm({
      client_id: res.data?.client_id ? String(res.data.client_id) : '',
      client_name: res.data?.client_name || '',
      client_ice: res.data?.client_ice || '',
      client_phone: res.data?.client_phone || '',
      client_city: res.data?.client_city || '',
      client_address: res.data?.client_address || '',
      issue_date: String(res.data?.issue_date || '').slice(0, 10),
      notes: res.data?.notes || '',
    });
    setNotesEdit(res.data?.notes || '');
  };

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    reload()
      .then(() => Promise.all([
        api.getProducts().then((p) => setProducts(p.data || [])).catch(() => {}),
        api.getClients().then((c) => setClients(c.data || [])).catch(() => {}),
      ]))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="atlas-orders quicksale-detail-page"><PageSkeleton variant="form" /></div>;
  if (!ticket) return <div className="empty">Ticket introuvable</div>;
  if (!isVrDoc(ticket)) return <Navigate to={`/invoices/${ticket.id}`} replace />;

  const fmt = (n: number) => fmtMoney(n, 'MAD');
  const due = remainingBalance(ticket.total, ticket.amount_paid);
  const cancelled = ticket.status === 'cancelled';
  const paid = Number(ticket.amount_paid || 0);
  const canEditLines = !cancelled && ticket.status !== 'paid' && paid <= 0.0001;
  const token = getToken() || '';

  const saveInfo = async () => {
    if (!String(infoForm.client_name || '').trim()) {
      flash('Le nom du client est obligatoire.', 'error');
      return;
    }
    setSavingInfo(true);
    try {
      const payload: Record<string, any> = {
        client_id: infoForm.client_id ? Number(infoForm.client_id) : null,
        client_name: infoForm.client_name,
        client_ice: infoForm.client_ice,
        client_phone: infoForm.client_phone,
        client_city: infoForm.client_city,
        client_address: infoForm.client_address,
        notes: infoForm.notes,
      };
      if (infoForm.issue_date) payload.issue_date = infoForm.issue_date;
      const r: any = await api.updateInvoice(ticket.id, payload);
      setTicket({ ...ticket, ...r.data });
      setEditingInfo(false);
      flash(r.message || 'Ticket VR mis à jour.');
      toast('Ticket mis à jour', 'success');
      await reload();
    } catch (e: any) {
      flash(friendlyError(e), 'error');
    } finally {
      setSavingInfo(false);
    }
  };

  const startEditLines = () => {
    const lines: VrEditLine[] = (ticket.items || []).map((it: any) => ({
      product_id: it.product_id || undefined,
      product_name: it.product_name || '',
      sku: it.sku || '',
      quantity: Number(it.quantity || 1),
      unit_price: Number(it.unit_price || 0),
      product_query: it.product_name || '',
    }));
    setEditLines(lines.length ? lines : [{ product_name: '', quantity: 1, unit_price: 0, product_query: '' }]);
    setNotesEdit(ticket.notes || '');
    setEditingLines(true);
  };

  const updateLine = (idx: number, field: keyof VrEditLine, value: any) => {
    const next = [...editLines];
    (next[idx] as any)[field] = value;
    if (field === 'product_id' && value) {
      const p = products.find((x) => Number(x.id) === Number(value));
      if (p) {
        next[idx].product_name = p.name;
        next[idx].sku = p.sku || '';
        next[idx].unit_price = Number(p.price ?? p.unit_price ?? 0);
        next[idx].product_query = p.name;
      }
    }
    setEditLines(next);
  };

  const saveLines = async () => {
    if (!editLines.length || editLines.some((l) => !String(l.product_name || '').trim() || l.quantity <= 0)) {
      flash('Chaque ligne doit avoir une désignation et une quantité > 0.', 'error');
      return;
    }
    setSavingLines(true);
    try {
      const r: any = await api.updateInvoice(ticket.id, {
        notes: notesEdit,
        tax_exempt: true,
        items: editLines.map((l) => ({
          product_id: l.product_id,
          product_name: l.product_name,
          sku: l.sku,
          quantity: l.quantity,
          list_price: l.unit_price,
          unit_price: l.unit_price,
          tax_rate: 0,
        })),
      });
      setEditingLines(false);
      flash(r.message || 'Lignes du ticket mises à jour.');
      toast('Ticket mis à jour', 'success');
      await reload();
    } catch (e: any) {
      flash(friendlyError(e), 'error');
    } finally {
      setSavingLines(false);
    }
  };

  const goRefund = () => {
    setShowRefund(true);
  };

  const cancelTicket = async () => {
    const ok = await confirm({
      title: 'Annuler ce ticket VR',
      message:
        'Le numéro VR est conservé (pas de trou de série).\nLe stock sera rétabli.\nLes encaissements restent en historique jusqu’à suppression.',
      danger: true,
      confirmLabel: 'Continuer',
    });
    if (!ok) return;
    const voidReason = await prompt({
      title: 'Motif d’annulation (obligatoire)',
      message: 'Ex. erreur de caisse, doublon, client a changé d’avis…',
      placeholder: 'Motif (min. 5 caractères)',
      confirmLabel: 'Annuler le ticket',
    });
    if (!voidReason || voidReason.trim().length < 5) {
      toast('Motif trop court — annulation annulée.', 'error');
      return;
    }
    try {
      const r: any = await api.updateInvoiceStatus(ticket.id, {
        status: 'cancelled',
        void_reason: voidReason.trim(),
      } as any);
      flash(r.message || 'Ticket annulé — stock rétabli.');
      toast('Ticket VR annulé', 'success');
      await reload();
    } catch (e: any) {
      flash(friendlyError(e), 'error');
    }
  };

  const requestDelete = async () => {
    let disclaimer =
      'Suppression définitive du ticket VR, des paiements et reçus liés. Le stock sera rétabli si le ticket n’est pas déjà annulé. Confirmez pour continuer.';
    try {
      const links = await api.getInvoiceLinks(ticket.id);
      const d = links.data;
      const bits: string[] = [];
      if (d?.receipts?.length) bits.push(`${d.receipts.length} reçu(s)`);
      if (d?.payments_count) bits.push(`${d.payments_count} paiement(s)`);
      if (bits.length) {
        disclaimer = `ATTENTION : ce ticket VR et ${bits.join(', ')} seront effacés. Stock rétabli. Confirmez pour continuer.`;
      }
    } catch { /* */ }
    setPwDesc(disclaimer);
    setPendingDelete(() => async (password: string) => {
      const res: any = await api.deleteInvoice(ticket.id, password);
      toast(res.message || 'Ticket supprimé', 'success');
      setPwOpen(false);
      setPendingDelete(null);
      nav('/quick-sale');
    });
    setPwOpen(true);
  };

  const recordPay = async () => {
    if (payAmount <= 0) {
      flash('Montant invalide.', 'error');
      return;
    }
    setPaying(true);
    try {
      await api.recordInvoicePayment(ticket.id, {
        amount: payAmount,
        payment_method: payMethod,
        payee: 'company',
        note: 'Encaissement ticket VR',
      });
      flash('Paiement enregistré.');
      toast('Paiement VR enregistré', 'success');
      await reload();
    } catch (e: any) {
      flash(friendlyError(e), 'error');
    } finally {
      setPaying(false);
    }
  };

  return (
    <div>
      <div className="page-header dock-page-header">
        <h1 className="sr-only">Ticket {ticket.number}</h1>
        <TopPageActions>
          <button
            type="button"
            className="secondary"
            title="Imprimer"
            onClick={() => window.open(`${BASE}/api/invoices/${ticket.id}/print?token=${encodeURIComponent(token)}`, '_blank', 'noopener,noreferrer')}
          >
            <Printer size={16} aria-hidden="true" />
            <span className="tpa-label">Imprimer</span>
          </button>
          {!cancelled && !editingInfo && (
            <button
              type="button"
              className="secondary"
              title="Modifier le client et les infos"
              onClick={() => {
                setEditingInfo(true);
                requestAnimationFrame(() => infoCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
              }}
            >
              <Pencil size={16} aria-hidden="true" />
              <span className="tpa-label">Modifier infos</span>
            </button>
          )}
          {canEditLines && !editingLines && (
            <button
              type="button"
              title="Modifier les lignes"
              onClick={() => {
                startEditLines();
                requestAnimationFrame(() => linesCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
              }}
            >
              <Pencil size={16} aria-hidden="true" />
              <span className="tpa-label">Modifier lignes</span>
            </button>
          )}
          {!cancelled && ticket.status !== 'remboursement' && (
            <button type="button" className="secondary" title="Créer un remboursement" onClick={goRefund}>
              <RotateCcw size={16} aria-hidden="true" />
              <span className="tpa-label">Créer un remboursement</span>
            </button>
          )}
        </TopPageActions>
      </div>

      <SaveFeedback message={msg} type={msgType} />

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <div className="card" ref={infoCardRef}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ fontSize: 15, margin: 0 }}>Client &amp; infos</h3>
            {!cancelled && !editingInfo ? (
              <button type="button" className="secondary" style={{ fontSize: 12 }} onClick={() => setEditingInfo(true)}>
                Modifier
              </button>
            ) : editingInfo ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => void saveInfo()} disabled={savingInfo}>
                  {savingInfo ? '…' : 'Enregistrer'}
                </button>
                <button type="button" className="secondary" onClick={() => setEditingInfo(false)} disabled={savingInfo}>
                  Annuler
                </button>
              </div>
            ) : null}
          </div>
          {editingInfo ? (
            <div className="grid grid-2" style={{ gap: 8 }}>
              <div className="form-row" style={{ gridColumn: '1 / -1' }}>
                <label>Client enregistré</label>
                <select
                  value={infoForm.client_id}
                  onChange={(e) => {
                    const cid = e.target.value;
                    const c = clients.find((x) => String(x.id) === cid);
                    if (c) {
                      setInfoForm((f) => ({
                        ...f,
                        client_id: cid,
                        client_name: c.name || f.client_name,
                        client_ice: c.ice || '',
                        client_phone: c.phone || '',
                        client_city: c.city || '',
                        client_address: c.address || '',
                      }));
                    } else {
                      setInfoForm((f) => ({ ...f, client_id: '' }));
                    }
                  }}
                >
                  <option value="">— Saisie libre —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}{c.ice ? ` · ${c.ice}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <label>Nom du client *</label>
                <input value={infoForm.client_name} onChange={(e) => setInfoForm({ ...infoForm, client_name: e.target.value })} />
              </div>
              <div className="form-row">
                <label>ICE</label>
                <input value={infoForm.client_ice} onChange={(e) => setInfoForm({ ...infoForm, client_ice: e.target.value })} />
              </div>
              <div className="form-row">
                <label>Téléphone</label>
                <input value={infoForm.client_phone} onChange={(e) => setInfoForm({ ...infoForm, client_phone: e.target.value })} />
              </div>
              <div className="form-row">
                <label>Date d’émission</label>
                <input type="date" value={infoForm.issue_date} onChange={(e) => setInfoForm({ ...infoForm, issue_date: e.target.value })} />
              </div>
              <div className="form-row">
                <label>Ville</label>
                <input value={infoForm.client_city} onChange={(e) => setInfoForm({ ...infoForm, client_city: e.target.value })} />
              </div>
              <div className="form-row">
                <label>Adresse</label>
                <input value={infoForm.client_address} onChange={(e) => setInfoForm({ ...infoForm, client_address: e.target.value })} />
              </div>
              <div className="form-row" style={{ gridColumn: '1 / -1' }}>
                <label>Notes</label>
                <textarea rows={2} value={infoForm.notes} onChange={(e) => setInfoForm({ ...infoForm, notes: e.target.value })} />
              </div>
            </div>
          ) : (
            <>
              <p style={{ margin: 0, fontWeight: 700 }}>{ticket.client_name || '—'}</p>
              {ticket.client_ice && <p style={{ margin: '4px 0 0', fontSize: 13 }}>ICE {ticket.client_ice}</p>}
              {ticket.client_phone && <p style={{ margin: '4px 0 0', fontSize: 13 }}>{ticket.client_phone}</p>}
              {(ticket.client_address || ticket.client_city) && (
                <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
                  {[ticket.client_address, ticket.client_city].filter(Boolean).join(' · ')}
                </p>
              )}
            </>
          )}
        </div>
        <div className="card">
          <h3 style={{ fontSize: 15, marginTop: 0 }}>Ticket {ticket.number} <span className={`badge ${statusBadgeClass(ticket.status)}`}>{statusFr(ticket.status)}</span></h3>
          <p style={{ margin: 0, fontSize: 13 }}>Date : {ticket.issue_date || '—'}</p>
          <DocumentActors document={ticket} />
          <p style={{ margin: '4px 0 0', fontSize: 13 }}>Total : <strong>{fmt(ticket.total)}</strong></p>
          <p style={{ margin: '4px 0 0', fontSize: 13 }}>Payé : {fmt(ticket.amount_paid || 0)}</p>
          <p style={{ margin: '4px 0 0', fontSize: 13 }}>
            Reste : <strong style={{ color: due > 0.001 && !cancelled ? 'var(--bad)' : 'var(--muted)' }}>{cancelled ? '—' : fmt(due)}</strong>
          </p>
          {ticket.void_reason && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--muted)' }}>Motif d’annulation : {ticket.void_reason}</p>
          )}
        </div>
      </div>

      {Math.abs(Number(ticket.tax_amount || 0)) > 0.001 && <p role="alert">Ce ticket historique contient une TVA enregistrée. Ses montants et paiements n’ont pas été modifiés ; une régularisation est nécessaire.</p>}
      <div className="card" style={{ marginBottom: 16 }} ref={linesCardRef}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ fontSize: 15, margin: 0 }}>Lignes (sans TVA)</h3>
          {canEditLines && !editingLines && (
            <button type="button" className="secondary" style={{ fontSize: 12 }} onClick={startEditLines}>
              Modifier les lignes
            </button>
          )}
        </div>
        {editingLines ? (
          <div>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 0 }}>
              Ticket impayé : lignes, quantités et prix unitaires modifiables (sans TVA). Le stock est ajusté automatiquement selon les écarts.
            </p>
            {editLines.map((item, idx) => {
              const q = (item.product_query || '').toLowerCase();
              const filtered = q
                ? products.filter((p) => p.name?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || String(p.barcode || '').includes(q)).slice(0, 30)
                : products.slice(0, 30);
              return (
                <div key={idx} style={{ borderBottom: '1px solid var(--border, #e8e4dc)', paddingBottom: 12, marginBottom: 12 }}>
                  <div className="grid grid-2" style={{ gap: 8 }}>
                    <div className="form-row">
                      <label>Recherche produit</label>
                      <input
                        value={item.product_query || ''}
                        onChange={(e) => updateLine(idx, 'product_query', e.target.value)}
                        placeholder="Nom, SKU…"
                      />
                      <select
                        style={{ marginTop: 4 }}
                        value={item.product_id || ''}
                        onChange={(e) => updateLine(idx, 'product_id', e.target.value ? Number(e.target.value) : undefined)}
                      >
                        <option value="">— libre —</option>
                        {filtered.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} · {Math.round(Number(p.price || 0)).toLocaleString('fr-FR')}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-row">
                      <label>Désignation *</label>
                      <input value={item.product_name} onChange={(e) => updateLine(idx, 'product_name', e.target.value)} />
                    </div>
                    <div className="form-row">
                      <label>Quantité</label>
                      <NumberField value={item.quantity} onValueChange={(n) => updateLine(idx, 'quantity', n)} min={0.01} step="0.01" />
                    </div>
                    <div className="form-row">
                      <label>Prix unitaire</label>
                      <NumberField value={item.unit_price} onValueChange={(n) => updateLine(idx, 'unit_price', n)} min={0} step="0.01" />
                    </div>
                  </div>
                  <button
                    type="button"
                    className="danger"
                    style={{ marginTop: 6, fontSize: 12 }}
                    disabled={editLines.length <= 1}
                    onClick={() => setEditLines(editLines.filter((_, i) => i !== idx))}
                  >
                    Supprimer la ligne
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="secondary"
              style={{ marginBottom: 12 }}
              onClick={() => setEditLines([...editLines, { product_name: '', quantity: 1, unit_price: 0, product_query: '' }])}
            >
              + Ajouter une ligne
            </button>
            <div className="form-row">
              <label>Notes</label>
              <textarea rows={2} value={notesEdit} onChange={(e) => setNotesEdit(e.target.value)} />
            </div>
            <div className="form-actions">
              <button type="button" onClick={() => void saveLines()} disabled={savingLines}>
                {savingLines ? 'Enregistrement…' : 'Enregistrer les lignes'}
              </button>
              <button type="button" className="secondary" onClick={() => setEditingLines(false)} disabled={savingLines}>
                Annuler
              </button>
            </div>
          </div>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th>Désignation</th>
                  <th>Qté</th>
                  <th>P.U.</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {(ticket.items || []).map((it: any) => (
                  <tr key={it.id || `${it.product_name}-${it.quantity}`}>
                    <td>
                      {it.product_name}
                      {it.sku ? <small style={{ display: 'block', color: 'var(--muted)' }}>{it.sku}</small> : null}
                    </td>
                    <td>{it.quantity}{it.unit ? ` ${it.unit}` : ''}</td>
                    <td>{fmt(it.unit_price)}</td>
                    <td style={{ fontWeight: 700 }}>{fmt(it.line_total ?? Number(it.quantity) * Number(it.unit_price))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ticket.notes && (
              <p style={{ marginTop: 12, fontSize: 13, color: 'var(--muted)' }}>{ticket.notes}</p>
            )}
          </>
        )}
      </div>

      {!cancelled && due > 0.001 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 15, marginTop: 0 }}>Encaisser le reste</h3>
          <div className="grid grid-2">
            <div className="form-row">
              <label>Montant</label>
              <NumberField value={payAmount} onValueChange={(n) => setPayAmount(n)} min={0} step="0.01" />
            </div>
            <div className="form-row">
              <label>Mode</label>
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                <option value="cash">Espèces</option>
                <option value="card">Carte</option>
                <option value="transfer">Virement</option>
                <option value="cheque">Chèque</option>
              </select>
            </div>
          </div>
          <button type="button" onClick={() => void recordPay()} disabled={paying}>
            {paying ? '…' : `Encaisser ${fmt(payAmount)}`}
          </button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, marginTop: 0 }}>Paiements</h3>
        {payments.length === 0 ? (
          <p style={{ color: 'var(--muted)', fontSize: 13, margin: 0 }}>Aucun paiement enregistré.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Montant</th>
                <th>Mode</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p: any) => (
                <tr key={p.id}>
                  <td>{String(p.paid_at || '').slice(0, 10)}</td>
                  <td>{fmt(p.amount)}</td>
                  <td>{paymentMethodLabel(p.payment_method) || p.payment_method}</td>
                  <td>{p.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <section className="card ac-danger-zone" aria-label="Zone de danger">
        <div className="ac-danger-zone-head">
          <div>
            <h3>Zone de danger</h3>
            <p>Annulez le ticket pour rétablir le stock, ou supprimez définitivement ce ticket VR.</p>
          </div>
          <div className="ac-danger-zone-actions">
            {!cancelled && (
              <button type="button" className="danger" onClick={() => void cancelTicket()}>
                <Ban size={15} aria-hidden="true" />
                <span>Annuler (stock)</span>
              </button>
            )}
            <TimedUndoDelete
              deleteLabel="Supprimer"
              undoLabel="Annuler"
              initialSeconds={10}
              onConfirm={() => void requestDelete()}
            />
          </div>
        </div>
      </section>

      <RemboursementModal
        open={showRefund}
        initialSourceId={ticket.id}
        preferQuickSale
        onClose={() => setShowRefund(false)}
        onCreated={() => void reload()}
      />

      {pwOpen && pendingDelete && (
        <PasswordConfirm
          open={pwOpen}
          title="Supprimer le ticket VR"
          description={pwDesc}
          confirmLabel="Supprimer définitivement"
          onCancel={() => { setPwOpen(false); setPendingDelete(null); }}
          onConfirm={async (password) => { await pendingDelete(password); }}
        />
      )}
    </div>
  );
}
