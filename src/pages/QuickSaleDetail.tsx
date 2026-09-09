import { printInvoiceTicket } from '../lib/thermal';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { api, BASE } from '../api';
import { getToken } from '../auth';
import { statusFr, statusBadgeClass } from '../lib/labels';
import { fmtMoney, paymentMethodLabel } from '../lib/money';
import { useUi } from '../components/AppDialogs';
import PasswordConfirm from '../components/PasswordConfirm';
import SaveFeedback from '../components/SaveFeedback';
import NumberField from '../components/NumberField';
import { friendlyError } from '../lib/errors';

function isVrDoc(inv: any) {
  return (
    inv?.doc_kind === 'quick_sale' ||
    inv?.doc_kind === 'ticket' ||
    String(inv?.number || '').startsWith('VR')
  );
}

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
    const due = Math.max(0, Number(res.data?.total || 0) - Number(res.data?.amount_paid || 0));
    setPayAmount(due);
  };

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    reload().finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="empty">Chargement du ticket…</div>;
  if (!ticket) return <div className="empty">Ticket introuvable</div>;
  if (!isVrDoc(ticket)) return <Navigate to={`/invoices/${ticket.id}`} replace />;

  const fmt = (n: number) => fmtMoney(n, 'MAD');
  const due = Math.max(0, Number(ticket.total || 0) - Number(ticket.amount_paid || 0));
  const cancelled = ticket.status === 'cancelled';
  const token = getToken() || '';

  const goRefund = () => {
    // Reuse FA refund flow with preselected VR ticket
    nav(`/invoices?refund=${ticket.id}`);
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
      'Suppression définitive du ticket VR, des paiements et reçus liés. Le stock sera rétabli si le ticket n’est pas déjà annulé. Saisissez votre mot de passe.';
    try {
      const links = await api.getInvoiceLinks(ticket.id);
      const d = links.data;
      const bits: string[] = [];
      if (d?.receipts?.length) bits.push(`${d.receipts.length} reçu(s)`);
      if (d?.payments_count) bits.push(`${d.payments_count} paiement(s)`);
      if (bits.length) {
        disclaimer = `ATTENTION : ce ticket VR et ${bits.join(', ')} seront effacés. Stock rétabli. Confirmez avec votre mot de passe.`;
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
      {!cancelled && ticket.status !== 'remboursement' && (
        <div className="card" style={{ marginBottom: 12, padding: '10px 14px', fontSize: 13, lineHeight: 1.45 }}>
          <strong>Remboursement WR</strong> — ce ticket VR peut faire l’objet d’un avoir (série WR-),
          sans TVA. S’il est déjà encaissé, la sortie apparaît dans Solde.
          {' '}
          <button type="button" className="secondary" style={{ marginLeft: 8 }} onClick={goRefund}>
            Créer un WR…
          </button>
        </div>
      )}
      <div className="page-header">
        <div>
          <Link to="/quick-sale" style={{ fontSize: 13, color: 'var(--muted)' }}>
            ← Retour aux ventes rapides
          </Link>
          <h1 style={{ marginTop: 4 }}>
            Ticket {ticket.number}
            <span className={`badge ${statusBadgeClass(ticket.status)}`} style={{ marginLeft: 10, fontSize: 13 }}>
              {statusFr(ticket.status)}
            </span>
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>
            Vente rapide (série VR) — sans TVA · stock déduit à l’encaissement
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a
            className="btn secondary"
            href={`${BASE}/api/invoices/${ticket.id}/print?token=${encodeURIComponent(token)}`}
            target="_blank"
            rel="noreferrer"
          >
            Imprimer
          </a>
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              try {
                await printInvoiceTicket(ticket.id, { prefer: 'auto' });
                flash('Ticket envoyé à l’imprimante');
              } catch (e: any) {
                flash(e?.message || 'Impression thermique indisponible — utilisez Imprimer', 'error');
              }
            }}
          >
            Ticket thermique
          </button>
          <a
            className="btn secondary"
            href={`${BASE}/api/invoices/${ticket.id}/pdf?token=${encodeURIComponent(token)}`}
            target="_blank"
            rel="noreferrer"
          >
            PDF
          </a>
          {!cancelled && (
            <button type="button" className="secondary" onClick={() => void cancelTicket()}>
              Annuler (stock)
            </button>
          )}
          <button type="button" className="danger" onClick={() => void requestDelete()}>
            Supprimer
          </button>
        </div>
      </div>

      <SaveFeedback message={msg} type={msgType} />

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <h3 style={{ fontSize: 15, marginTop: 0 }}>Client</h3>
          <p style={{ margin: 0, fontWeight: 700 }}>{ticket.client_name || '—'}</p>
          {ticket.client_ice && <p style={{ margin: '4px 0 0', fontSize: 13 }}>ICE {ticket.client_ice}</p>}
          {ticket.client_phone && <p style={{ margin: '4px 0 0', fontSize: 13 }}>{ticket.client_phone}</p>}
        </div>
        <div className="card">
          <h3 style={{ fontSize: 15, marginTop: 0 }}>Ticket</h3>
          <p style={{ margin: 0, fontSize: 13 }}>Date : {ticket.issue_date || '—'}</p>
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

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, marginTop: 0 }}>Lignes (sans TVA)</h3>
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

      <div className="card">
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
