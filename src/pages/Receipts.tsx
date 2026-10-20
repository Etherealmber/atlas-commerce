import { onAgentDraft } from '../lib/agentDraft';
import { useEffect, useState } from 'react';
import DatePicker from '../components/DatePicker';
import { api, BASE } from '../api';
import { getToken } from '../auth';
import SaveFeedback from '../components/SaveFeedback';
import { paymentMethodFr } from '../lib/labels';
import PasswordConfirm from '../components/PasswordConfirm';
import { useUi } from '../components/AppDialogs';
import { numStr, numFromInput } from '../lib/numInput';
import NumberField from '../components/NumberField';
import EmptyState from '../components/EmptyState';
import RefreshIconButton from '../components/RefreshIconButton';
import { FloatingPortal } from '../components/FloatingPortal';
import { useWizard, StepBody, WizardFoot } from '../components/ui/FormWizard';
import { ModalFormError, FieldHint } from '../components/ModalFormFeedback';

export default function Receipts() {
  const [modalError, setModalError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const { confirm } = useUi();
  const [list, setList] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const wz = useWizard(2);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [saveMsgType, setSaveMsgType] = useState<'success' | 'error'>('success');

  const [invoiceId, setInvoiceId] = useState<number | ''>('');
  const [clientName, setClientName] = useState('');
  const [amount, setAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');

  // Delete OTP state
  const [pwOpen, setPwOpen] = useState(false);
  const [pwTitle, setPwTitle] = useState('');
  const [pwDesc, setPwDesc] = useState('');
  const [pendingAction, setPendingAction] = useState<null | ((password: string) => Promise<void>)>(null);

  const flash = (msg: string, type: 'success' | 'error' = 'success') => {
    setSaveMsg(msg); setSaveMsgType(type);
    setTimeout(() => setSaveMsg(''), 4500);
  };

  const load = (soft = false) => {
    if (soft) setRefreshing(true);
    else setLoading(true);
    Promise.all([api.getReceipts(), api.getInvoices()])
      .then(([r, inv]) => { setList(r.data); setInvoices(inv.data); })
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
      if (d.entity && d.entity !== 'receipt') return;
      setModalError('');
      setShowModal(true);
    });
  }, []);

  useEffect(() => { load(); }, []);


  const selectInvoice = (id: number | '') => {
    setInvoiceId(id);
    if (id) {
      const inv = invoices.find((x) => x.id === id);
      if (inv) {
        setClientName(inv.client_name);
        setAmount(Number(inv.total) - Number(inv.amount_paid || 0));
      }
    }
  };

  const create = async () => {
    if (!clientName || amount <= 0) { flash('Le nom du client et le montant sont obligatoires.', 'error'); return; }
    setSaving(true);
    try {
      await api.createReceipt({
        invoice_id: invoiceId || undefined, client_name: clientName, amount,
        payment_method: paymentMethod, issue_date: issueDate, notes,
      });
      setShowModal(false);
      setClientName(''); setAmount(0); setNotes(''); setInvoiceId('');
      flash('Reçu enregistré dans la base de données avec succès.');
      load(true);
    } catch (e: any) { setModalError(e?.message || 'Enregistrement impossible'); } finally { setSaving(false); }
  };

  const toggleSituation = async (r: any) => {
    const next = !(Number(r.include_client_situation) === 1);
    try {
      const res: any = await api.setReceiptClientSituation(r.id, next);
      flash(res.message || (next ? 'Situation activée pour ce reçu — réimprimez.' : 'Situation désactivée pour ce reçu.'));
      const resList: any = await api.getReceipts();
      setList(resList.data || resList || []);
    } catch (e: any) {
      flash(e?.message || 'Erreur', 'error');
    }
  };

  const requestDelete = async (id: number) => {
    let disclaimer = 'Cette action est définitive. Confirmez pour continuer.';
    let cascade_invoice = false;
    try {
      const links = await api.getReceiptLinks(id);
      const d = links.data;
      if (d?.disclaimer || d?.expenses?.length || d?.invoice) {
        const bits: string[] = [];
        if (d.expenses?.length) bits.push(`${d.expenses.length} écriture(s) solde`);
        if (d.invoice) bits.push(`liée à la facture ${d.invoice.number}`);
        disclaimer =
          `ATTENTION : suppression du reçu` + (bits.length ? ` (${bits.join(', ')})` : '') +
          '. Les écritures de solde liées seront aussi supprimées. Confirmez pour continuer.';
      }
      // Ask cascade BEFORE password so dialogs never stack on each other
      if (d?.invoice) {
        cascade_invoice = await confirm({
          title: 'Reçu lié à une facture',
          message: `Ce reçu est lié à la facture ${d.invoice.number}.\nOui = supprimer aussi la facture et ses paiements.\nNon = supprimer seulement le reçu et le solde lié.`,
          confirmLabel: 'Tout supprimer',
          cancelLabel: 'Reçu uniquement',
          danger: true,
        });
      }
    } catch { /* ignore */ }
    setPwTitle('Supprimer le reçu et éléments liés');
    setPwDesc(disclaimer);
    setPendingAction(() => async (password: string) => {
      const res = await api.deleteReceipt(id, password, cascade_invoice);
      flash((res as any).message || 'Reçu supprimé.');
      setPwOpen(false); setPendingAction(null);
      load(true);
    });
    setPwOpen(true);
  };

  const fmt = (n: number) => Math.round(Number(n || 0)).toLocaleString('fr-FR');
  const filtered = list.filter((r) => !search || r.number?.toLowerCase().includes(search.toLowerCase()) || r.client_name?.toLowerCase().includes(search.toLowerCase()));
  const token = encodeURIComponent(getToken() || '');

  if (loading) return <div className="empty">Chargement des reçus...</div>;

  return (
    <div className="receipts-page">
      <div className="page-header">
        <h1>Reçus</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <RefreshIconButton onClick={() => load(true)} loading={refreshing} />
          <button onClick={() => { setModalError(''); setShowModal(true); }}>+ Nouveau reçu</button>
        </div>
      </div>

      <SaveFeedback message={saveMsg} type={saveMsgType} />

      <div className="ac-panel ac-products-filters">
        <div className="search-bar"><input className="search-input" placeholder="Rechercher par numéro ou nom de client..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </div>

      <div className="ac-panel ac-products-table-panel">
        <div className="table-wrap">
          <table className="data-dense ac-products-table">
            <thead>
              <tr><th>Numéro</th><th>Client</th><th>Montant</th><th>Mode</th><th>Date</th><th>Facture</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.number}</strong></td>
                  <td>{r.client_name}</td>
                  <td style={{ fontWeight: 700, color: 'var(--success)' }}>{fmt(r.amount)}</td>
                  <td><span className="badge info">{paymentMethodFr(r.payment_method)}</span></td>
                  <td>{r.issue_date}</td>
                  <td>{r.invoice_number ? <strong>{r.invoice_number}</strong> : (r.invoice_id ? `#${r.invoice_id}` : '—')}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', pointerEvents: 'auto' }}>
                      <a className="btn secondary" style={{ padding: '4px 10px', fontSize: 12, cursor: 'pointer' }} href={`${BASE}/api/receipts/${r.id}/print?layout=full&token=${token}`} target="_blank" rel="noreferrer">Reçu détail</a>
                      <a className="btn secondary" style={{ padding: '4px 10px', fontSize: 12, cursor: 'pointer' }} href={`${BASE}/api/receipts/${r.id}/print?layout=minimal&token=${token}`} target="_blank" rel="noreferrer">Ticket minimal</a>
                      <a className="btn secondary" style={{ padding: '4px 10px', fontSize: 12, cursor: 'pointer' }} href={`${BASE}/api/receipts/${r.id}/pdf?token=${token}`} target="_blank" rel="noreferrer">PDF</a>
                      <button
                        type="button"
                        className="secondary"
                        style={{
                          padding: '4px 10px',
                          fontSize: 12,
                          cursor: 'pointer',
                          borderColor: Number(r.include_client_situation) === 1 ? 'var(--ok, #3f3f46)' : undefined,
                          background: Number(r.include_client_situation) === 1 ? 'rgba(99, 102, 241, 0.12)' : undefined,
                        }}
                        title="Affiche le QR situation client uniquement sur ce reçu (paramètre global reste inchangé)"
                        onClick={() => toggleSituation(r)}
                      >
                        {Number(r.include_client_situation) === 1 ? 'Situation QR : ON' : 'Situation QR'}
                      </button>
                      <button type="button" className="danger" style={{ padding: '4px 10px', fontSize: 12, background: '#6b2828', cursor: 'pointer' }} onClick={() => requestDelete(r.id)}>Suppr.</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={7}>
                    <EmptyState
                      title="Aucun reçu"
                      description="Créez un reçu manuellement, ou soldez une facture (un reçu est généré automatiquement)."
                      actionLabel="Créer mon premier reçu"
                      onAction={() => { setModalError(''); wz.reset(); setShowModal(true); }}
                      icon="receipt"
                    />
                  </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <FloatingPortal><div className="modal-overlay" onClick={() => { setShowModal(false); wz.reset(); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>Nouveau reçu</h2>
            <StepBody active={wz.step === 1}>
            <div className="form-row">
              <label>Lier à une facture (optionnel)</label>
              <select value={invoiceId} onChange={(e) => selectInvoice(e.target.value ? numFromInput(e.target.value) : '')}>
                <option value="">— Reçu indépendant —</option>
                {invoices.filter((i) => i.status !== 'paid' && i.status !== 'cancelled').map((inv) => (
                  <option key={inv.id} value={inv.id}>{inv.number} — {inv.client_name} (Reste : {fmt(Number(inv.total) - Number(inv.amount_paid || 0))})</option>
                ))}
              </select>
            </div>
            <div className="grid grid-2">
              <div className="form-row"><label>Nom du client *</label><input value={clientName} onChange={(e) => setClientName(e.target.value)} /></div>
              <div className="form-row"><label>Montant *</label><NumberField value={amount} onValueChange={setAmount} step="0.01" min={0.01} /></div>
            </div>
            </StepBody>
            <StepBody active={wz.step === 2}>
            <div className="grid grid-2">
              <div className="form-row"><label>Mode de paiement</label>
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="cash">Espèces</option>
                  <option value="bank">Virement bancaire</option>
                  <option value="check">Chèque</option>
                  <option value="card">Carte bancaire</option>
                  <option value="other">Autre</option>
                </select>
              </div>
              <div className="form-row"><label>Date</label><DatePicker value={issueDate} onChange={setIssueDate} /></div>
            </div>
            <div className="form-row"><label>Notes</label><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            </StepBody>
            <ModalFormError message={modalError} />
            <WizardFoot
              title="Nouveau reçu"
              wz={wz}
              stepLabel={wz.step === 1 ? 'Client & montant' : 'Paiement & notes'}
              onCancel={() => { setShowModal(false); wz.reset(); }}
              onSubmit={() => void create()}
              submitLabel={saving ? 'Enregistrement...' : 'Enregistrer dans la base'}
              saving={saving}
            />
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
