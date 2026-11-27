import DocumentActors from '../components/DocumentActors';
import TopPageActions from '../components/TopPageActions';
import { FileText, Plus, Printer, QrCode } from 'lucide-react';
import { TimedUndoDelete } from '../components/ui';
import ListPager from '../components/ui/ListPager';
import { onAgentDraft } from '../lib/agentDraft';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import DatePicker from '../components/DatePicker';
import { api, BASE } from '../api';
import { getToken } from '../auth';
import SaveFeedback from '../components/SaveFeedback';
import { paymentMethodFr } from '../lib/labels';
import { remainingBalance } from '../lib/money';
import PasswordConfirm from '../components/PasswordConfirm';
import { useUi } from '../components/AppDialogs';
import { numFromInput } from '../lib/numInput';
import NumberField from '../components/NumberField';
import EmptyState from '../components/EmptyState';
import RefreshIconButton from '../components/RefreshIconButton';
import PageSkeleton from '../components/PageSkeleton';
import { FloatingPortal } from '../components/FloatingPortal';
import { useWizard, StepBody, WizardFoot, WizardHeader, WizardIntro, type WizardStepDef } from '../components/ui/FormWizard';
import { ModalFormError } from '../components/ModalFormFeedback';
import Select from '../components/ui/Select';
import '../styles/receipt-situation.css';

const RECEIPT_STEPS: readonly WizardStepDef[] = [
  { id: 'client', label: 'Client & montant', hint: 'Associez une facture ou saisissez le client et le montant.' },
  { id: 'payment', label: 'Paiement & notes', hint: 'Mode de règlement, date et remarques.' },
];

export default function Receipts() {
  const [modalError, setModalError] = useState('');
  const { confirm } = useUi();
  const [list, setList] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [invoiceStatus, setInvoiceStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const loadGeneration = useRef(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const wz = useWizard(2);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;
  useEffect(() => { setPage(0); }, [search]);
  const [saving, setSaving] = useState(false);
  const [togglingSituation, setTogglingSituation] = useState<number | null>(null);
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
    const generation = ++loadGeneration.current;
    if (soft) setRefreshing(true);
    else setLoading(true);
    setLoadError('');
    setInvoiceStatus('loading');
    void api.getReceipts(soft ? { fresh: true } : undefined).then(r => {
      if (generation === loadGeneration.current) setList(r.data);
    }).catch(() => {
      if (generation === loadGeneration.current) setLoadError('Impossible de charger les reçus. Réessayez.');
    }).finally(() => {
      if (generation === loadGeneration.current) { setLoading(false); setRefreshing(false); }
    });
    void api.getInvoices().then(inv => {
      if (generation === loadGeneration.current) { setInvoices(inv.data); setInvoiceStatus('ready'); }
    }).catch(() => {
      if (generation === loadGeneration.current) setInvoiceStatus('error');
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
        setAmount(remainingBalance(inv.total, inv.amount_paid));
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
    } catch (e: any) { setModalError(e?.message || 'Enregistrement impossible'); } finally { setSaving(false); }
  };

  const toggleSituation = async (r: any) => {
    const next = !(Number(r.include_client_situation) === 1);
    setTogglingSituation(r.id);
    try {
      const res: any = await api.setReceiptClientSituation(r.id, next);
      flash(res.message || (next ? 'Situation activée pour ce reçu — réimprimez.' : 'Situation désactivée pour ce reçu.'));
    } catch (e: any) {
      flash(e?.message || 'Erreur', 'error');
    } finally { setTogglingSituation(null); }
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
    });
    setPwOpen(true);
  };

  const fmt = (n: number) => Math.round(Number(n || 0)).toLocaleString('fr-FR');
  const filtered = list.filter((r) => !search || r.number?.toLowerCase().includes(search.toLowerCase()) || r.client_name?.toLowerCase().includes(search.toLowerCase()));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const token = encodeURIComponent(getToken() || '');

  if (loading) return <div className="receipts-page"><PageSkeleton variant="table-only" /></div>;

  return (
    <div className="receipts-page">
      <div className="page-header dock-page-header">
        <h1 className="sr-only">Reçus</h1>
        <TopPageActions>
          <RefreshIconButton onClick={() => load(true)} loading={refreshing} />
          <button title="Nouveau reçu" onClick={() => { setModalError(''); setShowModal(true); }}><Plus size={16} aria-hidden="true" /><span className="tpa-label">Nouveau reçu</span></button>
        </TopPageActions>
      </div>

      <SaveFeedback message={saveMsg} type={saveMsgType} />
      {loadError && <p role="alert">{loadError} <button type="button" onClick={() => load(true)}>Réessayer</button></p>}

      <div className="ac-panel ac-products-filters">
        <div className="search-bar"><input className="search-input" placeholder="Rechercher par numéro ou nom de client..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </div>

      <div className="ac-panel ac-products-table-panel">
        <div className="ac-table-pager-bar">
          <span className="ac-table-pager-meta">{loadError ? 'Liste indisponible' : `${filtered.length} reçu${filtered.length === 1 ? '' : 's'} · 20 par page`}</span>
          <ListPager page={safePage} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />
        </div>
        <div className="table-wrap">
          <table className="data-dense ac-products-table">
            <thead>
              <tr><th>Numéro</th><th>Client</th><th>Montant</th><th>Mode</th><th>Date</th><th>Facture</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {paged.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.number}</strong><DocumentActors document={r} /></td>
                  <td>{r.client_name}</td>
                  <td style={{ fontWeight: 700, color: 'var(--success)' }}>{fmt(r.amount)}</td>
                  <td><span className="badge info">{paymentMethodFr(r.payment_method)}</span></td>
                  <td>{r.issue_date}</td>
                  <td>{r.invoice_id ? <Link to={`/invoices/${r.invoice_id}`} className="ac-number-link"><strong>{r.invoice_number || `#${r.invoice_id}`}</strong></Link> : (r.invoice_number ? <strong>{r.invoice_number}</strong> : '—')}</td>
                  <td className="row-actions-cell">
                    <div className="row-actions" style={{ pointerEvents: 'auto' }}>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => window.open(`${BASE}/api/receipts/${r.id}/print?layout=full&token=${token}`, '_blank', 'noopener,noreferrer')}
                      >
                        <Printer size={14} aria-hidden="true" />
                        <span>Reçu détail</span>
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => window.open(`${BASE}/api/receipts/${r.id}/print?layout=minimal&token=${token}`, '_blank', 'noopener,noreferrer')}
                      >
                        <FileText size={14} aria-hidden="true" />
                        <span>Ticket minimal</span>
                      </button>
                      <button
                        type="button"
                        disabled={togglingSituation !== null}
                        aria-pressed={Number(r.include_client_situation) === 1}
                        className={`secondary receipt-situation-toggle ${Number(r.include_client_situation) === 1 ? 'is-on' : 'is-off'}`}
                        title="Active ou désactive le QR situation client pour ce reçu uniquement"
                        onClick={() => toggleSituation(r)}
                      >
                        <QrCode size={14} aria-hidden="true" />
                        <span>{Number(r.include_client_situation) === 1 ? 'Situation QR : activée' : 'Situation QR : désactivée'}</span>
                      </button>
                      <TimedUndoDelete iconOnly width="34px"
                        deleteLabel="Supprimer"
                        undoLabel="Annuler"
                        initialSeconds={10}
                        onConfirm={() => requestDelete(r.id)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {!filtered.length && !loadError && (
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
        <FloatingPortal><div className="modal-overlay" onClick={() => { setShowModal(false); setModalError(''); wz.reset(); }}>
          <div className="modal step-wizard" role="dialog" aria-modal="true" aria-labelledby="receipt-wizard-title" onClick={(e) => e.stopPropagation()}>
            <WizardHeader eyebrow="ENCAISSEMENT" title="Nouveau reçu" titleId="receipt-wizard-title" wz={wz} steps={RECEIPT_STEPS} />
            <div className="step-wizard__body">
            <WizardIntro step={RECEIPT_STEPS[wz.step - 1]} />
            <StepBody active={wz.step === 1}>
            <div className="form-row">
              <label>Lier à une facture (optionnel)</label>
              <Select value={invoiceId} disabled={invoiceStatus !== 'ready'} onChange={(e) => selectInvoice(e.target.value ? numFromInput(e.target.value) : '')}>
                <option value="">— Reçu indépendant —</option>
                {invoices.filter((i) => i.status !== 'paid' && i.status !== 'cancelled').map((inv) => (
                  <option key={inv.id} value={inv.id}>{inv.number} — {inv.client_name} (Reste : {fmt(remainingBalance(inv.total, inv.amount_paid))})</option>
                ))}
              </Select>
              {invoiceStatus === 'loading' && <small role="status">Chargement des factures…</small>}
              {invoiceStatus === 'error' && <small role="alert">Factures indisponibles. Actualisez la page pour réessayer ; un reçu indépendant reste possible.</small>}
            </div>
            <div className="grid grid-2">
              <div className="form-row"><label>Nom du client *</label><input value={clientName} onChange={(e) => { setClientName(e.target.value); if (modalError) setModalError(''); }} /></div>
              <div className="form-row"><label>Montant *</label><NumberField value={amount} onValueChange={(n) => { setAmount(n); if (modalError) setModalError(''); }} step="0.01" min={0.01} /></div>
            </div>
            </StepBody>
            <StepBody active={wz.step === 2}>
            <div className="grid grid-2">
              <div className="form-row"><label>Mode de paiement</label>
                <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="cash">Espèces</option>
                  <option value="bank">Virement bancaire</option>
                  <option value="check">Chèque</option>
                  <option value="card">Carte bancaire</option>
                  <option value="other">Autre</option>
                </Select>
              </div>
              <div className="form-row"><label>Date</label><DatePicker value={issueDate} onChange={setIssueDate} /></div>
            </div>
            <div className="form-row"><label>Notes</label><textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            </StepBody>
            <ModalFormError message={modalError} />
            </div>
            <WizardFoot
              title="Nouveau reçu"
              wz={wz}
              stepLabel={RECEIPT_STEPS[wz.step - 1].label}
              onCancel={() => { setShowModal(false); setModalError(''); wz.reset(); }}
              onBack={() => setModalError('')}
              onNext={() => {
                if (wz.step === 1) {
                  if (!clientName.trim()) { setModalError('Le nom du client est obligatoire.'); return false; }
                  if (!(Number(amount) > 0)) { setModalError('Indiquez un montant supérieur à 0.'); return false; }
                }
                setModalError('');
                return true;
              }}
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
