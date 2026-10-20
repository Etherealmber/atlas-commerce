import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { openPrintDoc } from '../lib/reports';
import SaveFeedback from '../components/SaveFeedback';
import EmptyState from '../components/EmptyState';
import RefreshIconButton from '../components/RefreshIconButton';
import RemboursementModal from '../components/RemboursementModal';
import PasswordConfirm from '../components/PasswordConfirm';
import { useUi } from '../components/AppDialogs';
import { statusFr, statusBadgeClass } from '../lib/labels';
import { fmtMoney } from '../lib/money';

function isRemboursement(inv: any) {
  const kind = String(inv.doc_kind || '').toLowerCase();
  const st = String(inv.status || '').toLowerCase();
  const num = String(inv.number || '');
  return kind === 'remboursement' || st === 'remboursement' || num.startsWith('WR');
}

export default function Reimbursements() {
  const { confirm } = useUi();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const [saveMsgType, setSaveMsgType] = useState<'success' | 'error'>('success');
  const [showCreate, setShowCreate] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);

  const flash = (msg: string, type: 'success' | 'error' = 'success') => {
    setSaveMsg(msg);
    setSaveMsgType(type);
    setTimeout(() => setSaveMsg(''), 4500);
  };

  const load = (soft = false) => {
    if (soft) setRefreshing(true);
    else setLoading(true);
    Promise.all([
      api.getInvoices('remboursement', { kind: 'all' }).catch(() => ({ data: [] })),
      api.getInvoices(undefined, { kind: 'all' }).catch(() => ({ data: [] })),
    ])
      .then(([byStatus, all]) => {
        const merged = [...(byStatus.data || []), ...(all.data || [])];
        const map = new Map<number, any>();
        for (const inv of merged) {
          if (inv?.id != null && isRemboursement(inv)) map.set(inv.id, inv);
        }
        setList(
          Array.from(map.values()).sort((a, b) =>
            String(b.issue_date || '').localeCompare(String(a.issue_date || '')),
          ),
        );
      })
      .catch((e: any) => flash(e?.message || 'Chargement impossible', 'error'))
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
    load();
  }, []);

  const filtered = list.filter((inv) => {
    if (!search.trim()) return true;
    const s = search.trim().toLowerCase();
    return (
      String(inv.number || '').toLowerCase().includes(s) ||
      String(inv.client_name || '').toLowerCase().includes(s) ||
      String(inv.notes || '').toLowerCase().includes(s)
    );
  });

  const printDoc = (id: number) => openPrintDoc(`/api/invoices/${id}/print`);

  const sendEmail = async (inv: any) => {
    const to = String(inv.client_email || '').trim();
    if (!to) {
      flash('Aucune adresse e-mail client sur ce document.', 'error');
      return;
    }
    try {
      await api.sendInvoiceEmail(inv.id, to);
      flash(`E-mail envoyé à ${to} (PDF inclus).`);
    } catch (e: any) {
      flash(e?.message || 'Envoi impossible', 'error');
    }
  };

  const requestDeleteWr = async (inv: any) => {
    const ok = await confirm({
      title: `Supprimer ${inv.number || 'cet avoir WR'} ?`,
      message:
        'La suppression annule le remboursement :\n' +
        '• stock re-déduit pour les articles remis en stock\n' +
        '• crédit retiré de la facture d’origine (si elle existe encore)\n' +
        '• sortie de caisse / solde annulée (argent rétabli)\n\n' +
        'Cette action est définitive.',
      confirmLabel: 'Continuer',
      cancelLabel: 'Retour',
    });
    if (!ok) return;
    setPendingDeleteId(inv.id);
    setPwOpen(true);
  };

  const confirmDeleteWr = async (password: string) => {
    if (pendingDeleteId == null) return;
    try {
      const res: any = await api.deleteInvoice(pendingDeleteId, password);
      flash(res?.message || 'Avoir WR supprimé — stock et solde rétabli.');
      setPwOpen(false);
      setPendingDeleteId(null);
      load(true);
    } catch (e: any) {
      flash(e?.message || 'Suppression refusée', 'error');
      throw e;
    }
  };

  if (loading) return <div className="empty">Chargement des remboursements…</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Remboursements</h1>
          <p style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>
            Documents WR exclusivement — isolés des factures FA, devis et tickets VR.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <RefreshIconButton onClick={() => load(true)} loading={refreshing} />
          <button type="button" onClick={() => setShowCreate(true)}>
            + Remboursement (WR)
          </button>
        </div>
      </div>

      <SaveFeedback message={saveMsg} type={saveMsgType} />

      <div className="ac-panel ac-products-filters">
        <div className="ac-products-filters-row">
          <div className="ac-search-field">
            <input
              className="ac-search-input"
              type="search"
              placeholder="Rechercher n°, client…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Rechercher remboursements"
            />
          </div>
        </div>
      </div>

      <div className="ac-panel ac-products-table-panel">
        <div className="table-wrap">
          <table className="data-dense ac-products-table">
            <thead>
              <tr>
                <th>N°</th>
                <th>Client</th>
                <th>Date</th>
                <th>Statut</th>
                <th style={{ textAlign: 'right' }}>Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
                <tr key={inv.id}>
                  <td>
                    <strong>{inv.number}</strong>
                    {inv.refund_of_invoice_id ? (
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        Source #{inv.refund_of_invoice_id}
                      </div>
                    ) : null}
                  </td>
                  <td>{inv.client_name || '—'}</td>
                  <td>{inv.issue_date || '—'}</td>
                  <td>
                    <span className={`badge ${statusBadgeClass(inv.status)}`}>
                      {statusFr(inv.status)}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>
                    {fmtMoney(Number(inv.total || 0), 'MAD')}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button
                      type="button"
                      className="secondary"
                      style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={() => printDoc(inv.id)}
                    >
                      PDF
                    </button>{' '}
                    <button
                      type="button"
                      className="secondary"
                      style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={() => sendEmail(inv)}
                    >
                      E-mail
                    </button>{' '}
                    <button
                      type="button"
                      className="danger"
                      style={{ fontSize: 12, padding: '4px 10px' }}
                      onClick={() => requestDeleteWr(inv)}
                    >
                      Suppr.
                    </button>
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      title="Aucun remboursement"
                      description="Créez un avoir WR via le bouton « + Remboursement (WR) »."
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <RemboursementModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => load(true)}
      />

      {pwOpen && pendingDeleteId != null && (
        <PasswordConfirm
          open={pwOpen}
          title="Supprimer l’avoir WR"
          description="Confirmez la suppression et le rétablissement du stock / solde. Cette action est définitive."
          confirmLabel="Supprimer définitivement"
          onCancel={() => { setPwOpen(false); setPendingDeleteId(null); }}
          onConfirm={confirmDeleteWr}
        />
      )}
    </div>
  );
}
