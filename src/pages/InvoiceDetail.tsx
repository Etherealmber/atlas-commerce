import DocumentActors from '../components/DocumentActors';
import TopPageActions from '../components/TopPageActions';
import { Ban, FileCode2, Pencil, Printer, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { whatsAppDraft } from '../lib/assist';
import { useParams, Link, Navigate, useNavigate } from 'react-router-dom';
import { api, BASE } from '../api';
import { getToken } from '../auth';
import { statusFr, statusBadgeClass } from '../lib/labels';
import { fmtMoney, paymentMethodLabel, remainingBalance } from '../lib/money';
import { useUi } from '../components/AppDialogs';
import PasswordConfirm from '../components/PasswordConfirm';
import RemboursementModal from '../components/RemboursementModal';
import { TimedUndoDelete } from '../components/ui';
import PageSkeleton from '../components/PageSkeleton';
import { numStr, numFromInput } from '../lib/numInput';
import NumberField from '../components/NumberField';


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

type EditLine = {
  product_id?: number;
  product_name: string;
  sku?: string;
  quantity: number;
  list_price: number;
  unit_price: number;
  tax_rate: number;
  product_query?: string;
};

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast, alert, confirm } = useUi();
  const [invoice, setInvoice] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState('');
  const [payments, setPayments] = useState<any[]>([]);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [editingClient, setEditingClient] = useState(false);
  const [clientForm, setClientForm] = useState({
    client_id: '', client_name: '', client_ice: '', client_address: '', client_city: '', client_email: '', client_phone: '',
    issue_date: '', due_date: '', notes: '',
  });
  const [clients, setClients] = useState<any[]>([]);
  const [savingClient, setSavingClient] = useState(false);
  const [editingLines, setEditingLines] = useState(false);
  const [editLines, setEditLines] = useState<EditLine[]>([]);
  const [savingLines, setSavingLines] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const [notesEdit, setNotesEdit] = useState('');
  const [clearance, setClearance] = useState<any>(null);
  const [ublBusy, setUblBusy] = useState(false);
  const [dunningInfo, setDunningInfo] = useState<any>(null);
  const [dunningBusy, setDunningBusy] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwDesc, setPwDesc] = useState('');
  const [pendingDelete, setPendingDelete] = useState<null | ((password: string) => Promise<void>)>(null);
  const [showRefund, setShowRefund] = useState(false);
  const linesCardRef = useRef<HTMLDivElement>(null);

  const reload = async () => {
    if (!id) return;
    const [res, pays] = await Promise.all([
      api.getInvoice(+id),
      api.getInvoicePayments(+id).catch(() => ({ data: [] })),
    ]);
    setInvoice(res.data);
    if (res.data && res.data.status !== 'quote' && res.data.status !== 'devis') {
      api.ublClearance(+id!).then((r) => setClearance(r.data)).catch(() => setClearance(null));
      api.getInvoiceDunning(+id!).then((r) => setDunningInfo(r.data)).catch(() => setDunningInfo(null));
    } else {
      setClearance(null);
      setDunningInfo(null);
    }
    if (res.data.client_email) setEmail(res.data.client_email);
    setPayments(pays.data || []);
    setClientForm({
      client_id: res.data.client_id ? String(res.data.client_id) : '',
      client_name: res.data.client_name || '',
      client_ice: res.data.client_ice || '',
      client_address: res.data.client_address || '',
      client_city: res.data.client_city || '',
      client_email: res.data.client_email || '',
      client_phone: res.data.client_phone || '',
      issue_date: String(res.data.issue_date || '').slice(0, 10),
      due_date: String(res.data.due_date || '').slice(0, 10),
      notes: res.data.notes || '',
    });
    setNotesEdit(res.data.notes || '');
    try {
      const r = await api.getReceipts();
      setReceipts((r.data || []).filter((x: any) => Number(x.invoice_id) === Number(id)));
    } catch {
      setReceipts([]);
    }
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

  const isQuote = invoice && (invoice.status === 'quote' || invoice.status === 'devis');
  const paid = Number(invoice?.amount_paid || 0);
  const canEditLines =
    !!invoice &&
    (isQuote || (paid <= 0.0001 && invoice.status !== 'paid' && invoice.status !== 'cancelled'));

  const startEditLines = () => {
    const lines: EditLine[] = (invoice.items || []).map((it: any) => ({
      product_id: it.product_id || undefined,
      product_name: it.product_name || '',
      sku: it.sku || '',
      quantity: Number(it.quantity || 1),
      list_price: Number(it.list_price ?? it.unit_price ?? 0),
      unit_price: Number(it.unit_price || 0),
      tax_rate: Number(it.tax_rate ?? 20),
      product_query: it.product_name || '',
    }));
    setEditLines(lines.length ? lines : [{ product_name: '', quantity: 1, list_price: 0, unit_price: 0, tax_rate: 20, product_query: '' }]);
    setNotesEdit(invoice.notes || '');
    setEditingLines(true);
  };

  const updateEditLine = (idx: number, field: string, value: any) => {
    const next = [...editLines];
    (next[idx] as any)[field] = value;
    if (field === 'product_id' && value) {
      const p = products.find((x) => x.id === +value);
      if (p) {
        next[idx].product_name = p.name;
        next[idx].sku = p.sku;
        next[idx].list_price = Number(p.price || 0);
        next[idx].unit_price = Number(p.price || 0);
        next[idx].product_query = p.name;
      }
    }
    setEditLines(next);
  };

  const saveLines = async () => {
    if (!invoice) return;
    if (editLines.some((l) => !l.product_name || l.quantity <= 0)) {
      setMsg('Chaque ligne doit avoir une désignation et une quantité > 0.');
      return;
    }
    setSavingLines(true);
    setMsg('');
    try {
      const res: any = await api.updateInvoice(invoice.id, {
        notes: notesEdit,
        items: editLines.map((l) => ({
          product_id: l.product_id,
          product_name: l.product_name,
          sku: l.sku,
          quantity: l.quantity,
          list_price: l.list_price,
          unit_price: l.unit_price,
          tax_rate: l.tax_rate,
        })),
      });
      setInvoice({ ...invoice, ...res.data });
      setEditingLines(false);
      setMsg(res.message || 'Lignes enregistrées.');
      await reload();
    } catch (e: any) {
      setMsg(e.message || 'Erreur enregistrement lignes');
    } finally {
      setSavingLines(false);
    }
  };

  const sendMail = async () => {
    if (!email.includes('@')) {
      setMsg('Adresse e-mail invalide');
      return;
    }
    setSending(true);
    setMsg('');
    try {
      await api.sendInvoiceEmail(+id!, email);
      setMsg('Facture envoyée par e-mail avec succès.');
    } catch (e: any) {
      const err = e.message || '';
      if (err.includes('RESEND') || err.includes('configur')) {
        setMsg("L'envoi par e-mail n'est pas disponible. Contactez l'administrateur.");
      } else {
        setMsg(err || "Échec de l'envoi");
      }
    } finally {
      setSending(false);
    }
  };

  if (loading) return <div className="atlas-orders invoice-detail-page"><PageSkeleton variant="form" /></div>;
  if (!invoice) return <div className="empty">Facture introuvable</div>;
  if (
    invoice.doc_kind === 'quick_sale' ||
    invoice.doc_kind === 'ticket' ||
    String(invoice.number || '').startsWith('VR')
  ) {
    return <Navigate to={`/quick-sale/${invoice.id}`} replace />;
  }

  const fmt = (n: number) => fmtMoney(n, 'MAD');
  const saveClient = async () => {
    if (!invoice) return;
    if (!String(clientForm.client_name || '').trim()) {
      setMsg('Erreur : le nom du client est obligatoire.');
      return;
    }
    setSavingClient(true);
    try {
      const payload: Record<string, any> = {
        client_id: clientForm.client_id ? Number(clientForm.client_id) : null,
        client_name: clientForm.client_name,
        client_ice: clientForm.client_ice,
        client_address: clientForm.client_address,
        client_city: clientForm.client_city,
        client_email: clientForm.client_email,
        client_phone: clientForm.client_phone,
        notes: clientForm.notes,
      };
      if (clientForm.issue_date) payload.issue_date = clientForm.issue_date;
      if (clientForm.due_date) payload.due_date = clientForm.due_date;
      const res = (await api.updateInvoice(invoice.id, payload)) as { data?: Record<string, any> };
      setInvoice({ ...invoice, ...res.data });
      setEditingClient(false);
      setMsg('Informations de la facture enregistrées.');
    } catch (e: any) {
      setMsg(e.message || 'Erreur');
    } finally {
      setSavingClient(false);
    }
  };

  const due = remainingBalance(invoice.total, invoice.amount_paid);

  return (
    <div>
      {invoice && (
        <div className="card" style={{ marginBottom: 12, padding: '10px 14px', fontSize: 13 }}>
          <strong>Messages client</strong>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {[
              ['quote', 'Devis'],
              ['invoice', 'Facture'],
              ['reminder', 'Rappel'],
              ['paid', 'Accusé règlement'],
            ].map(([k, lab]) => (
              <button
                key={k}
                type="button"
                className="secondary"
                style={{ fontSize: 12 }}
                onClick={() => {
                  const t = whatsAppDraft(k as any, {
                    number: invoice.number,
                    client: invoice.client_name,
                    total: k === 'reminder'
                      ? remainingBalance(invoice.total, invoice.amount_paid)
                      : invoice.total,
                  });
                  void navigator.clipboard?.writeText(t).then(() => {});
                  void alert(t, 'Message WhatsApp (copié)');
                }}
              >
                {lab}
              </button>
            ))}
          </div>
        </div>
      )}
      {invoice && invoice.status !== 'cancelled' && invoice.status !== 'remboursement' && invoice.status !== 'quote' && invoice.status !== 'devis' && (
        <div className="card" style={{ marginBottom: 12, padding: '10px 14px', fontSize: 13, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span>
            <strong>Avoir / WR</strong> — pour un retour ou correction, créez un remboursement (WR-) directement ici. Si cette facture est déjà payée, le WR génère une sortie de caisse dans Solde.
          </span>
          <button type="button" className="secondary" style={{ fontSize: 12 }} onClick={() => setShowRefund(true)}>
            <RotateCcw size={14} aria-hidden="true" /> Créer un remboursement
          </button>
        </div>
      )}
      <div className="page-header dock-page-header">
        <h1 className="sr-only">{isQuote ? 'Devis' : 'Facture'} {invoice.number}</h1>
        <TopPageActions>
          <button
            type="button"
            className="secondary"
            title="Imprimer"
            onClick={() => window.open(`${BASE}/api/invoices/${invoice.id}/print?token=${encodeURIComponent(getToken() || '')}`, '_blank', 'noopener,noreferrer')}
          >
            <Printer size={16} aria-hidden="true" />
            <span className="tpa-label">Imprimer</span>
          </button>
          {invoice.status !== 'quote' && invoice.status !== 'devis' && (
            <button
              type="button"
              className="secondary"
              title="Export UBL XML"
              onClick={() => window.open(`${BASE}/api/invoices/${invoice.id}/ubl?token=${encodeURIComponent(getToken() || '')}`, '_blank', 'noopener,noreferrer')}
            >
              <FileCode2 size={16} aria-hidden="true" />
              <span className="tpa-label">Export UBL XML</span>
            </button>
          )}
          {canEditLines && !editingLines && (
            <button
              type="button"
              title="Modifier lignes & promo"
              onClick={() => {
                startEditLines();
                requestAnimationFrame(() => linesCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
              }}
            >
              <Pencil size={16} aria-hidden="true" />
              <span className="tpa-label">Modifier lignes &amp; promo</span>
            </button>
          )}
          {invoice.status !== 'cancelled' && invoice.status !== 'remboursement' && invoice.status !== 'quote' && invoice.status !== 'devis' && (
            <button type="button" className="secondary" title="Créer un remboursement" onClick={() => setShowRefund(true)}>
              <RotateCcw size={16} aria-hidden="true" />
              <span className="tpa-label">Créer un remboursement</span>
            </button>
          )}
        </TopPageActions>
      </div>

      {msg && (
        <p style={{ marginBottom: 12, fontSize: 14, color: msg.toLowerCase().includes('erreur') || msg.toLowerCase().includes('échec') ? 'var(--bad)' : 'var(--ok)' }}>
          {msg}
        </p>
      )}


      {invoice.status !== 'quote' && invoice.status !== 'devis' && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0, fontSize: 16 }}>Clearance UBL (M1 — local)</h3>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>
            Prépare un snapshot UBL 2.1 + statut local. Pas d’envoi DGI/PDP tant que les credentials officiels ne sont pas branchés.
          </p>
          <p style={{ fontSize: 13, marginBottom: 8 }}>
            Statut :{' '}
            <strong>{clearance?.status || 'draft'}</strong>
            {clearance?.xml_sha256 ? (
              <span style={{ color: 'var(--muted)', fontSize: 11 }}> · SHA-256 {String(clearance.xml_sha256).slice(0, 12)}…</span>
            ) : null}
            {invoice.dgi_status ? (
              <span style={{ color: 'var(--muted)', fontSize: 11 }}> · dgi_status={invoice.dgi_status}</span>
            ) : null}
          </p>
          {Array.isArray(clearance?.errors) && clearance.errors.length > 0 && (
            <ul style={{ fontSize: 12, color: 'var(--bad, #b91c1c)', marginTop: 0 }}>
              {clearance.errors.map((e: unknown, i: number) => (
                <li key={i}>{formatIssue(e)}</li>
              ))}
            </ul>
          )}
          {Array.isArray(clearance?.warnings) && clearance.warnings.length > 0 && (
            <ul style={{ fontSize: 12, color: '#b45309', marginTop: 0 }}>
              {clearance.warnings.map((e: unknown, i: number) => (
                <li key={i}>{formatIssue(e)}</li>
              ))}
            </ul>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button
              type="button"
              disabled={ublBusy}
              onClick={async () => {
                setUblBusy(true);
                try {
                  const r = await api.ublPrepare(invoice.id);
                  toast(r.message || 'UBL préparé', 'success');
                  setClearance(r.data);
                  const inv = await api.getInvoice(invoice.id);
                  setInvoice(inv.data);
                } catch (e: any) {
                  toast(e?.message || 'Préparation UBL impossible', 'error');
                } finally {
                  setUblBusy(false);
                }
              }}
            >
              {ublBusy ? '…' : 'Préparer UBL'}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={ublBusy || !clearance?.has_snapshot && clearance?.status === 'draft' && !clearance?.xml_sha256}
              onClick={async () => {
                try {
                  const tkn = getToken();
                  const res = await fetch(`${BASE}${api.ublSnapshotUrl(invoice.id)}`, {
                    headers: tkn ? { Authorization: `Bearer ${tkn}` } : {},
                  });
                  if (!res.ok) throw new Error('Snapshot indisponible');
                  const blob = await res.blob();
                  const u = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = u;
                  a.download = `facture-${invoice.number || invoice.id}.ubl.snapshot.xml`;
                  a.click();
                  URL.revokeObjectURL(u);
                } catch (e: any) {
                  toast(e?.message || 'Snapshot introuvable — préparer d’abord', 'error');
                }
              }}
            >
              Télécharger snapshot
            </button>
            <button
              type="button"
              className="secondary"
              disabled={ublBusy || clearance?.status !== 'ready'}
              title="Simulation locale uniquement"
              onClick={async () => {
                setUblBusy(true);
                try {
                  const r = await api.ublSetStatus(invoice.id, { status: 'submitted', note: 'Simulation locale (pas DGI)' });
                  toast(r.message || 'Marqué soumis (local)', 'success');
                  const c = await api.ublClearance(invoice.id);
                  setClearance(c.data);
                } catch (e: any) {
                  toast(e?.message || 'Statut impossible', 'error');
                } finally {
                  setUblBusy(false);
                }
              }}
            >
              Simuler soumis
            </button>
            <button
              type="button"
              className="secondary"
              disabled={ublBusy || !['submitted', 'ready'].includes(clearance?.status)}
              onClick={async () => {
                setUblBusy(true);
                try {
                  const r = await api.ublSetStatus(invoice.id, { status: 'accepted', external_ref: 'LOCAL-TEST' });
                  toast(r.message || 'Accepté (local)', 'success');
                  const c = await api.ublClearance(invoice.id);
                  setClearance(c.data);
                } catch (e: any) {
                  toast(e?.message || 'Statut impossible', 'error');
                } finally {
                  setUblBusy(false);
                }
              }}
            >
              Simuler accepté
            </button>
            <button
              type="button"
              className="danger"
              disabled={ublBusy || !clearance?.status || clearance?.status === 'draft'}
              onClick={async () => {
                setUblBusy(true);
                try {
                  const r = await api.ublSetStatus(invoice.id, { status: 'rejected', note: 'Rejet simulé' });
                  toast(r.message || 'Rejeté (local)', 'success');
                  const c = await api.ublClearance(invoice.id);
                  setClearance(c.data);
                } catch (e: any) {
                  toast(e?.message || 'Statut impossible', 'error');
                } finally {
                  setUblBusy(false);
                }
              }}
            >
              Simuler rejeté
            </button>
          </div>
        </div>
      )}

      {dunningInfo && Number(dunningInfo.remaining || 0) > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <strong>Relance impayé</strong> · Reste dû : {fmtMoney(dunningInfo.remaining)} ·{' '}
              <span>{dunningInfo.paused ? 'Relances en pause' : 'Relances actives'}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="secondary"
                disabled={dunningBusy}
                onClick={async () => {
                  setDunningBusy(true);
                  try {
                    const next = !dunningInfo.paused;
                    await api.setInvoiceDunningPause(invoice.id, next);
                    const ref = await api.getInvoiceDunning(invoice.id);
                    setDunningInfo(ref.data);
                    toast(next ? 'Relances mises en pause' : 'Relances réactivées', 'success');
                  } catch (e: any) {
                    toast(e?.message || 'Action impossible', 'error');
                  } finally {
                    setDunningBusy(false);
                  }
                }}
              >
                {dunningInfo.paused ? 'Reprendre relances' : 'Mettre en pause'}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={dunningBusy || !dunningInfo.client_email}
                onClick={async () => {
                  setDunningBusy(true);
                  try {
                    await api.sendInvoiceDunning(invoice.id, { channel: 'email' });
                    const ref = await api.getInvoiceDunning(invoice.id);
                    setDunningInfo(ref.data);
                    toast('Relance e-mail envoyée', 'success');
                  } catch (e: any) {
                    toast(e?.message || 'Envoi e-mail impossible', 'error');
                  } finally {
                    setDunningBusy(false);
                  }
                }}
              >
                Envoyer relance e-mail
              </button>
              {dunningInfo.whatsapp_url && (
                <button
                  type="button"
                  disabled={dunningBusy}
                  onClick={async () => {
                    window.open(dunningInfo.whatsapp_url, '_blank', 'noopener,noreferrer');
                    try {
                      await api.sendInvoiceDunning(invoice.id, { channel: 'whatsapp' });
                      const ref = await api.getInvoiceDunning(invoice.id);
                      setDunningInfo(ref.data);
                    } catch {
                      /* non-blocking */
                    }
                  }}
                >
                  Relancer via WhatsApp
                </button>
              )}
            </div>
          </div>
          {Array.isArray(dunningInfo.events) && dunningInfo.events.length > 0 && (
            <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>
              Historique ({dunningInfo.events.length}) :{' '}
              {dunningInfo.events.slice(0, 4).map((ev: any) => `${ev.stage} (${ev.channel}/${ev.status})`).join(' · ')}
            </p>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <p>Numéro : <strong>{invoice.number}</strong> · <span className={`badge ${statusBadgeClass(invoice.status)}`}>{statusFr(invoice.status)}</span></p>
          <DocumentActors document={invoice} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Client</h3>
          {!editingClient ? (
            <button type="button" className="secondary" style={{ fontSize: 12 }} onClick={() => setEditingClient(true)}>
              Modifier
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={saveClient} disabled={savingClient}>
                {savingClient ? '…' : 'Enregistrer'}
              </button>
              <button type="button" className="secondary" onClick={() => setEditingClient(false)}>
                Annuler
              </button>
            </div>
          )}
        </div>
        {editingClient ? (
          <div className="grid grid-2">
            <div className="form-row" style={{ gridColumn: '1 / -1' }}>
              <label>Client enregistré (optionnel)</label>
              <select
                value={clientForm.client_id}
                onChange={(e) => {
                  const cid = e.target.value;
                  const c = clients.find((x) => String(x.id) === cid);
                  if (c) {
                    setClientForm((f) => ({
                      ...f,
                      client_id: cid,
                      client_name: c.name || f.client_name,
                      client_ice: c.ice || '',
                      client_address: c.address || '',
                      client_city: c.city || '',
                      client_email: c.email || '',
                      client_phone: c.phone || '',
                    }));
                  } else {
                    setClientForm((f) => ({ ...f, client_id: '' }));
                  }
                }}
              >
                <option value="">— Saisie libre / inchangé —</option>
                {clients.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}{c.ice ? ` · ${c.ice}` : ''}
                  </option>
                ))}
              </select>
            </div>
            {(['client_name', 'client_ice', 'client_address', 'client_city', 'client_email', 'client_phone'] as const).map((k) => (
              <div className="form-row" key={k}>
                <label>{k.replace('client_', '')}</label>
                <input
                  value={(clientForm as any)[k]}
                  onChange={(e) => setClientForm({ ...clientForm, [k]: e.target.value })}
                />
              </div>
            ))}
            <div className="form-row">
              <label>Date d’émission</label>
              <input type="date" value={clientForm.issue_date} onChange={(e) => setClientForm({ ...clientForm, issue_date: e.target.value })} />
            </div>
            <div className="form-row">
              <label>Date d’échéance</label>
              <input type="date" value={clientForm.due_date} onChange={(e) => setClientForm({ ...clientForm, due_date: e.target.value })} />
            </div>
            <div className="form-row" style={{ gridColumn: '1 / -1' }}>
              <label>Notes</label>
              <textarea rows={2} value={clientForm.notes} onChange={(e) => setClientForm({ ...clientForm, notes: e.target.value })} />
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>
            <strong>{invoice.client_name}</strong>
            {invoice.client_ice && <div>ICE : {invoice.client_ice}</div>}
            {(invoice.client_address || invoice.client_city) && (
              <div>
                {invoice.client_address} {invoice.client_city}
              </div>
            )}
            {invoice.client_email && <div>{invoice.client_email}</div>}
            {invoice.client_phone && <div>{invoice.client_phone}</div>}
            {(invoice.issue_date || invoice.due_date) && (
              <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                Émise le {invoice.issue_date || '—'}{invoice.due_date ? ` · Échéance ${invoice.due_date}` : ''}
              </div>
            )}
          </div>
        )}
        {!isQuote && (
          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, fontSize: 13 }}>
            <div>
              <div style={{ color: 'var(--muted)', fontSize: 11 }}>TOTAL</div>
              <strong>{fmt(invoice.total)}</strong>
            </div>
            <div>
              <div style={{ color: 'var(--muted)', fontSize: 11 }}>PAYÉ</div>
              <strong style={{ color: 'var(--ok)' }}>{fmt(invoice.amount_paid || 0)}</strong>
            </div>
            <div>
              <div style={{ color: 'var(--muted)', fontSize: 11 }}>RESTE</div>
              <strong>{fmt(due)}</strong>
            </div>
          </div>
        )}
      </div>

      {payments.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, marginBottom: 8 }}>Historique des paiements</h3>
          <div className="table-wrap">
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
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>{p.paid_at}</td>
                    <td>{fmt(p.amount)}</td>
                    <td>{paymentMethodLabel(p.payment_method)}</td>
                    <td>{p.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {receipts.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, marginBottom: 8 }}>Reçus liés</h3>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {receipts.map((r) => (
              <li key={r.id}>
                <Link to={`/receipts`}>{r.number}</Link> — {fmt(r.amount)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginBottom: 12, fontSize: 16 }}>Envoyer par e-mail</h3>
        <div className="grid grid-2">
          <div className="form-row">
            <label>E-mail du destinataire</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="client@exemple.com" />
          </div>
          <div className="form-row" style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button onClick={sendMail} disabled={sending}>
              {sending ? 'Envoi…' : 'Envoyer'}
            </button>
          </div>
        </div>
      </div>

      <div className="card" ref={linesCardRef}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>Lignes</h3>
          {canEditLines && !editingLines && (
            <button type="button" className="secondary" style={{ fontSize: 12 }} onClick={startEditLines}>
              Éditer (prix / promo / qté)
            </button>
          )}
        </div>

        {editingLines ? (
          <div>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
              {isQuote
                ? 'Devis entièrement modifiable (lignes, quantités, prix catalogue et prix client).'
                : 'Facture encore impayée : lignes et promo modifiables. Dès le premier paiement, les lignes sont verrouillées.'}
            </p>
            {editLines.map((item, idx) => {
              const q = (item.product_query || '').toLowerCase();
              const filtered = q
                ? products
                    .filter(
                      (p) =>
                        p.name?.toLowerCase().includes(q) ||
                        p.sku?.toLowerCase().includes(q) ||
                        String(p.barcode || '').includes(q),
                    )
                    .slice(0, 30)
                : products.slice(0, 30);
              const promo = Number(item.list_price) > Number(item.unit_price);
              return (
                <div key={idx} style={{ borderBottom: '1px solid var(--border, #e8e4dc)', paddingBottom: 12, marginBottom: 12 }}>
                  <div className="grid grid-2" style={{ gap: 8 }}>
                    <div className="form-row">
                      <label>Recherche produit</label>
                      <input
                        value={item.product_query || ''}
                        onChange={(e) => updateEditLine(idx, 'product_query', e.target.value)}
                        placeholder="Nom, SKU…"
                      />
                      <select
                        style={{ marginTop: 4 }}
                        value={item.product_id || ''}
                        onChange={(e) => updateEditLine(idx, 'product_id', e.target.value ? numFromInput(e.target.value) : undefined)}
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
                      <input value={item.product_name} onChange={(e) => updateEditLine(idx, 'product_name', e.target.value)} />
                    </div>
                    <div className="form-row">
                      <label>Quantité</label>
                      <NumberField value={item.quantity} onValueChange={(n) => updateEditLine(idx, 'quantity', n)} min={0.01} step="0.01" />
                    </div>
                    <div className="form-row">
                      <label>Prix catalogue</label>
                      <NumberField value={item.list_price} onValueChange={(n) => updateEditLine(idx, 'list_price', n)} min={0} step="0.01" />
                    </div>
                    <div className="form-row">
                      <label>Prix client (promo)</label>
                      <NumberField value={item.unit_price} onValueChange={(n) => updateEditLine(idx, 'unit_price', n)} min={0} step="0.01" />
                    </div>
                    <div className="form-row">
                      <label>TVA %</label>
                      <NumberField value={item.tax_rate} onValueChange={(n) => updateEditLine(idx, 'tax_rate', n)} min={0} step="0.01" />
                    </div>
                  </div>
                  {promo && (
                    <div style={{ fontSize: 12, color: 'var(--ok)', marginTop: 4 }}>
                      Promo −{(Number(item.list_price) - Number(item.unit_price)).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} / u (
                      {(
                        ((Number(item.list_price) - Number(item.unit_price)) / Number(item.list_price)) *
                        100
                      ).toFixed(1)}
                      %)
                    </div>
                  )}
                  <button type="button" className="danger" style={{ marginTop: 6, fontSize: 12 }} onClick={() => setEditLines(editLines.filter((_, i) => i !== idx))}>
                    Supprimer la ligne
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="secondary"
              style={{ marginBottom: 12 }}
              onClick={() =>
                setEditLines([
                  ...editLines,
                  { product_name: '', quantity: 1, list_price: 0, unit_price: 0, tax_rate: 20, product_query: '' },
                ])
              }
            >
              + Ligne
            </button>
            <div className="form-row">
              <label>Notes</label>
              <textarea rows={2} value={notesEdit} onChange={(e) => setNotesEdit(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button type="button" onClick={saveLines} disabled={savingLines}>
                {savingLines ? '…' : 'Enregistrer les lignes'}
              </button>
              <button type="button" className="secondary" onClick={() => setEditingLines(false)}>
                Annuler
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Produit</th>
                    <th>Qté</th>
                    <th>Catalogue HT</th>
                    <th>Client HT</th>
                    <th>Remise HT</th>
                    <th>TVA %</th>
                    <th>Total TTC</th>
                  </tr>
                </thead>
                <tbody>
                  {(invoice.items || []).length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ color: 'var(--muted)' }}>
                        Aucune ligne
                      </td>
                    </tr>
                  ) : (
                    (invoice.items || []).map((it: any) => {
                      const listP = Number(it.list_price ?? it.unit_price ?? 0);
                      const unitP = Number(it.unit_price || 0);
                      const rate = Number(it.tax_rate ?? 20) / 100;
                      const disc = listP > unitP ? listP - unitP : 0;
                      const listTtc = listP * (1 + rate);
                      const unitTtc = unitP * (1 + rate);
                      return (
                        <tr key={it.id}>
                          <td>
                            {it.product_name} {it.sku && <small>({it.sku})</small>}
                          </td>
                          <td>{it.quantity}</td>
                          <td>
                            {fmt(listP)}
                            <small style={{ display: 'block', color: 'var(--muted)', fontSize: 11 }}>
                              {fmt(listTtc)} TTC
                            </small>
                          </td>
                          <td>
                            {fmt(unitP)}
                            <small style={{ display: 'block', color: 'var(--muted)', fontSize: 11 }}>
                              {fmt(unitTtc)} TTC
                            </small>
                          </td>
                          <td>{disc > 0 ? `−${fmt(disc)}` : '—'}</td>
                          <td>{it.tax_rate}%</td>
                          <td>{fmt(it.line_total)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 16, textAlign: 'right' }}>
              <div>Sous-total HT : {fmt(invoice.subtotal)}</div>
              <div>TVA : {fmt(invoice.tax_amount)}</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>Total TTC : {fmt(invoice.total)}</div>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, fontWeight: 400 }}>
                Saisie en TTC à la création · unitaires affichés en HT · total = HT + TVA.
              </p>
            </div>
            {!canEditLines && !isQuote && (
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
                Lignes verrouillées (paiement déjà enregistré ou facture soldée).
              </p>
            )}
          </>
        )}
      </div>

      <section className="card ac-danger-zone" aria-label="Zone de danger">
        <div className="ac-danger-zone-head">
          <div>
            <h3>Zone de danger</h3>
            <p>Annulez ce document ou supprimez-le définitivement avec ses éléments liés.</p>
          </div>
          <div className="ac-danger-zone-actions">
            {invoice.status !== 'cancelled' && invoice.status !== 'remboursement' && (
              <button
                type="button"
                className="danger"
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Annuler le document',
                    message: `Annuler ${invoice.number} ? Les stocks liés seront rétablis.`,
                    confirmLabel: 'Annuler le document',
                    danger: true,
                  });
                  if (!ok) return;
                  try {
                    await api.updateInvoiceStatus(invoice.id, { status: 'cancelled' });
                    toast('Document annulé', 'success');
                    await reload();
                  } catch (e: any) {
                    toast(e?.message || 'Annulation impossible', 'error');
                  }
                }}
              >
                <Ban size={15} aria-hidden="true" />
                <span>Annuler</span>
              </button>
            )}
            <TimedUndoDelete
              deleteLabel="Supprimer"
              undoLabel="Annuler"
              initialSeconds={10}
              onConfirm={async () => {
                let disclaimer = 'Suppression définitive de la facture et des éléments liés. Confirmez pour continuer.';
                try {
                  const links = await api.getInvoiceLinks(invoice.id);
                  const d = links.data;
                  if (d?.has_links) {
                    const bits: string[] = [];
                    if (d.receipts?.length) bits.push(`${d.receipts.length} reçu(s)`);
                    if (d.expenses?.length) bits.push(`${d.expenses.length} écriture(s) solde`);
                    if (d.payments_count) bits.push(`${d.payments_count} paiement(s)`);
                    disclaimer = `ATTENTION : la suppression effacera aussi ${bits.join(', ') || 'les éléments liés'}. Confirmez pour continuer.`;
                  }
                } catch { /* ignore */ }
                setPwDesc(disclaimer);
                setPendingDelete(() => async (password: string) => {
                  await api.deleteInvoice(invoice.id, password);
                  setPwOpen(false);
                  setPendingDelete(null);
                  navigate('/invoices');
                });
                setPwOpen(true);
              }}
            />
          </div>
        </div>
      </section>

      <RemboursementModal
        open={showRefund}
        initialSourceId={invoice.id}
        onClose={() => setShowRefund(false)}
        onCreated={() => void reload()}
      />

      {pwOpen && pendingDelete && (
        <PasswordConfirm
          open={pwOpen}
          title="Supprimer le document"
          description={pwDesc}
          confirmLabel="Supprimer définitivement"
          onCancel={() => { setPwOpen(false); setPendingDelete(null); }}
          onConfirm={async (password) => { await pendingDelete(password); }}
        />
      )}
    </div>
  );
}