import { useEffect, useState } from 'react';
import { whatsAppDraft } from '../lib/assist';
import { useParams, Link, Navigate } from 'react-router-dom';
import { api, BASE } from '../api';
import { printInvoiceTicket, downloadTicket } from '../lib/thermal';
import { getToken } from '../auth';
import { statusFr, statusBadgeClass } from '../lib/labels';
import { fmtMoney, paymentMethodLabel } from '../lib/money';
import { useUi } from '../components/AppDialogs';
import { numStr, numFromInput } from '../lib/numInput';
import NumberField from '../components/NumberField';
import { isDemoMode, openDemoInvoicePrint } from '../lib/demoMode';


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
  const { toast, alert } = useUi();
  const [invoice, setInvoice] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState('');
  const [payments, setPayments] = useState<any[]>([]);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [editingClient, setEditingClient] = useState(false);
  const [clientForm, setClientForm] = useState({
    client_name: '', client_ice: '', client_address: '', client_city: '', client_email: '', client_phone: '',
  });
  const [savingClient, setSavingClient] = useState(false);
  const [editingLines, setEditingLines] = useState(false);
  const [editLines, setEditLines] = useState<EditLine[]>([]);
  const [savingLines, setSavingLines] = useState(false);
  const [products, setProducts] = useState<any[]>([]);
  const [notesEdit, setNotesEdit] = useState('');
  const [clearance, setClearance] = useState<any>(null);
  const [ublBusy, setUblBusy] = useState(false);

  const reload = async () => {
    if (!id) return;
    const [res, pays] = await Promise.all([
      api.getInvoice(+id),
      api.getInvoicePayments(+id).catch(() => ({ data: [] })),
    ]);
    setInvoice(res.data);
    if (res.data && res.data.status !== 'quote' && res.data.status !== 'devis') {
      api.ublClearance(+id!).then((r) => setClearance(r.data)).catch(() => setClearance(null));
    } else {
      setClearance(null);
    }
    if (res.data.client_email) setEmail(res.data.client_email);
    setPayments(pays.data || []);
    setClientForm({
      client_name: res.data.client_name || '',
      client_ice: res.data.client_ice || '',
      client_address: res.data.client_address || '',
      client_city: res.data.client_city || '',
      client_email: res.data.client_email || '',
      client_phone: res.data.client_phone || '',
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
      .then(() => api.getProducts().then((p) => setProducts(p.data || [])).catch(() => {}))
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

  if (loading) return <div className="empty">Chargement…</div>;
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
    setSavingClient(true);
    try {
      const res = await api.updateInvoice(invoice.id, clientForm);
      setInvoice({ ...invoice, ...res.data });
      setEditingClient(false);
      setMsg('Coordonnées client enregistrées.');
    } catch (e: any) {
      setMsg(e.message || 'Erreur');
    } finally {
      setSavingClient(false);
    }
  };

  const due = Math.max(0, Number(invoice.total || 0) - Number(invoice.amount_paid || 0));

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
                      ? Math.max(0, Number(invoice.total || 0) - Number(invoice.amount_paid || 0))
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
        <div className="card" style={{ marginBottom: 12, padding: '10px 14px', fontSize: 13 }}>
          <strong>Avoir / WR</strong> — pour un retour ou correction, créez un remboursement (WR-) depuis Factures
          (« + Remboursement »). Si cette facture est déjà payée, le WR génère une sortie de caisse dans Solde.
        </div>
      )}
      <div className="page-header">
        <div>
          <Link to="/invoices" style={{ fontSize: 13, color: 'var(--muted)' }}>
            ← Retour aux factures
          </Link>
          <h1 style={{ marginTop: 4 }}>
            {isQuote ? 'Devis' : 'Facture'} {invoice.number}
            <span className={`badge ${statusBadgeClass(invoice.status)}`} style={{ marginLeft: 10, fontSize: 13 }}>
              {statusFr(invoice.status)}
            </span>
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: 14 }}>
            {isQuote
              ? "Document d'estimation — non facturé"
              : 'Facture de vente (le reçu est un document distinct à solde nul)'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <a
            className="btn secondary"
            href={isDemoMode() ? undefined : `${BASE}/api/invoices/${invoice.id}/print?token=${encodeURIComponent(getToken() || '')}`}
            onClick={(e) => { if (isDemoMode()) { e.preventDefault(); openDemoInvoicePrint(Number(invoice.id)); } }}
            target="_blank"
            rel="noreferrer"
          >
            Imprimer
          </a>
          <a
            className="btn secondary"
            href={isDemoMode() ? undefined : `${BASE}/api/invoices/${invoice.id}/pdf?token=${encodeURIComponent(getToken() || '')}`}
            onClick={(e) => { if (isDemoMode()) { e.preventDefault(); openDemoInvoicePrint(Number(invoice.id)); } }}
            target="_blank"
            rel="noreferrer"
            title="Même mise en page que Imprimer — choisissez « Enregistrer au format PDF » dans la boîte d'impression"
          >
            PDF
          </a>
          <button
            type="button"
            className="secondary"
            title="Imprimer via Bluetooth BLE ou USB Serial (Chrome)"
            onClick={async () => {
              try {
                if (isDemoMode() && invoice?.id) { openDemoInvoicePrint(Number(invoice.id)); toast('Aperçu impression démo ouvert', 'success'); return; }
                  const t = await printInvoiceTicket(invoice.id, { width: 32 });
                toast(t === 'bluetooth' ? 'Envoyé via Bluetooth' : 'Envoyé via USB Serial', 'success');
              } catch (e: any) {
                toast(e?.message || 'Impression impossible — utilisez « Télécharger ticket ».', 'error');
              }
            }}
          >
            Imprimer ticket
          </button>
          <button
            type="button"
            className="secondary"
            title="Télécharger le fichier ESC/POS (.bin) pour APK ou outil externe"
            onClick={async () => {
              try {
                await downloadTicket(invoice.id, 32, `ticket-${invoice.number || invoice.id}.bin`);
                toast('Ticket téléchargé (.bin)', 'success');
              } catch (e: any) {
                toast(e?.message || 'Ticket indisponible', 'error');
              }
            }}
          >
            Télécharger ticket
          </button>
          <button
            type="button"
            className="secondary"
            title="Ticket 80mm (48 colonnes)"
            onClick={async () => {
              try {
                await downloadTicket(invoice.id, 48, `ticket-${invoice.number || invoice.id}-80mm.bin`);
                toast('Ticket 80mm téléchargé (.bin)', 'success');
              } catch (e: any) {
                toast(e?.message || 'Ticket 80mm indisponible', 'error');
              }
            }}
          >
            Ticket 80mm
          </button>
          {invoice.status !== 'quote' && invoice.status !== 'devis' && (
            <a
              className="btn secondary"
              href={`${BASE}/api/invoices/${invoice.id}/ubl?token=${encodeURIComponent(getToken() || '')}`}
              target="_blank"
              rel="noreferrer"
            >
              Export UBL XML
            </a>
          )}
          {canEditLines && !editingLines && (
            <button type="button" onClick={startEditLines}>
              Modifier lignes & promo
            </button>
          )}
        </div>
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

      <div className="card" style={{ marginBottom: 16 }}>
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
            {(['client_name', 'client_ice', 'client_address', 'client_city', 'client_email', 'client_phone'] as const).map((k) => (
              <div className="form-row" key={k}>
                <label>{k.replace('client_', '')}</label>
                <input
                  value={(clientForm as any)[k]}
                  onChange={(e) => setClientForm({ ...clientForm, [k]: e.target.value })}
                />
              </div>
            ))}
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

      <div className="card">
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
                    <th>Prix catalogue</th>
                    <th>Prix client</th>
                    <th>Remise</th>
                    <th>TVA %</th>
                    <th>Total ligne</th>
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
                      const disc = listP > unitP ? listP - unitP : 0;
                      return (
                        <tr key={it.id}>
                          <td>
                            {it.product_name} {it.sku && <small>({it.sku})</small>}
                          </td>
                          <td>{it.quantity}</td>
                          <td>{fmt(listP)}</td>
                          <td>{fmt(unitP)}</td>
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
            </div>
            {!canEditLines && !isQuote && (
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 10 }}>
                Lignes verrouillées (paiement déjà enregistré ou facture soldée).
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}