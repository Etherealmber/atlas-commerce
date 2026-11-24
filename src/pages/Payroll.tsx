import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Lock,
  Pencil,
  Play,
  RotateCcw,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { api } from '../api';
import { getRole, getToken } from '../auth';
import SaveFeedback from '../components/SaveFeedback';
import TopPageActions from '../components/TopPageActions';
import RefreshIconButton from '../components/RefreshIconButton';
import PageSkeleton from '../components/PageSkeleton';
import { fmtMoney } from '../lib/money';

function openAuthedUrl(url: string) {
  const token = getToken();
  const sep = url.includes('?') ? '&' : '?';
  const full = token ? `${url}${sep}token=${encodeURIComponent(token)}` : url;
  window.open(full, '_blank', 'noopener');
}

export default function Payroll() {
  const role = getRole();
  const isOwnerOrAdmin = role === 'owner' || role === 'admin';

  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<any | null>(null);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  // Line edit modal state
  const [editingLine, setEditingLine] = useState<any | null>(null);
  const [editBonus, setEditBonus] = useState('0');
  const [editAdj, setEditAdj] = useState('0');
  const [editNotes, setEditNotes] = useState('');

  const loadRuns = useCallback(async (pickId?: number) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.listPayrollRuns();
      const rows = Array.isArray(res.data) ? res.data : [];
      setRuns(rows);
      const targetId = pickId || rows[0]?.id;
      if (targetId) {
        const det = await api.getPayrollRun(Number(targetId));
        setSelectedRun(det.data || null);
      } else {
        setSelectedRun(null);
      }
    } catch (e: any) {
      setError(e?.message || 'Impossible de charger les lots de paie.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const selectRun = async (id: number) => {
    setError('');
    try {
      const det = await api.getPayrollRun(id);
      setSelectedRun(det.data || null);
    } catch (e: any) {
      setError(e?.message || 'Erreur lors du chargement du lot.');
    }
  };

  const createRegularRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const res = await api.createPayrollRun({ period_month: month, run_kind: 'regular' });
      setFeedback(`Lot de paie ${month} généré (brouillon).`);
      await loadRuns(Number(res.data?.id));
    } catch (err: any) {
      setError(err?.message || 'Impossible de générer le lot de paie.');
    } finally {
      setBusy(false);
    }
  };

  const createCorrectiveRun = async () => {
    if (!selectedRun) return;
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      const res = await api.createPayrollRun({
        period_month: selectedRun.period_month,
        run_kind: 'corrective',
        corrects_run_id: Number(selectedRun.id),
        notes: `Correction du lot #${selectedRun.id}`,
      });
      setFeedback(`Lot correctif généré pour ${selectedRun.period_month}.`);
      await loadRuns(Number(res.data?.id));
    } catch (err: any) {
      setError(err?.message || 'Impossible de créer le lot correctif.');
    } finally {
      setBusy(false);
    }
  };

  const closeRun = async () => {
    if (!selectedRun || selectedRun.status === 'closed') return;
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      await api.closePayrollRun(Number(selectedRun.id));
      setFeedback(`Lot #${selectedRun.id} clôturé et verrouillé (immuable).`);
      await loadRuns(Number(selectedRun.id));
    } catch (err: any) {
      setError(err?.message || 'Erreur lors de la clôture.');
    } finally {
      setBusy(false);
    }
  };

  const saveLineEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRun || !editingLine) return;
    setBusy(true);
    setError('');
    try {
      await api.updatePayrollLine(Number(selectedRun.id), Number(editingLine.id), {
        bonuses: Number(editBonus || 0),
        attendance_adjustment: Number(editAdj || 0),
        notes: editNotes,
      });
      setEditingLine(null);
      setFeedback('Ligne de paie recalculée.');
      await selectRun(Number(selectedRun.id));
    } catch (err: any) {
      setError(err?.message || 'Erreur lors de la mise à jour.');
    } finally {
      setBusy(false);
    }
  };

  const closedCount = useMemo(() => runs.filter((r) => r.status === 'closed').length, [runs]);
  const draftCount = runs.length - closedCount;
  const runLines: any[] = Array.isArray(selectedRun?.lines) ? selectedRun.lines : [];

  if (loading && !runs.length && !selectedRun && !error) {
    return (
      <div className="atlas-page ac-dash payroll-page ac-erp-page">
        <div className="page-header dock-page-header">
          <h1 className="sr-only">Paie CNSS / AMO</h1>
        </div>
        <PageSkeleton variant="dashboard" />
      </div>
    );
  }

  return (
    <div className="atlas-page ac-dash payroll-page ac-erp-page">
      <div className="page-header dock-page-header">
        <h1 className="sr-only">Paie CNSS / AMO</h1>
        <TopPageActions>
          <RefreshIconButton onClick={() => void loadRuns(selectedRun?.id)} loading={loading} />
          <Link to="/settings?tab=payroll" className="btn secondary">
            <SlidersHorizontal size={16} aria-hidden="true" />
            <span className="tpa-label">Paramètres CNSS / AMO</span>
          </Link>
        </TopPageActions>
      </div>

      {error && <p className="msg-error" role="alert">{error}</p>}
      <SaveFeedback message={feedback} />

      {/* 4 Dashboard KPI Bento Cards */}
      <section className="ac-metric-grid" aria-label="Indicateurs de paie">
        <article className="ac-metric">
          <span className="ac-metric-label">Lots générés</span>
          <strong className="ac-metric-val">{runs.length}</strong>
          <span className="ac-metric-meta">
            {closedCount} clôturé(s) · {draftCount} brouillon(s)
          </span>
        </article>
        <article className="ac-metric">
          <span className="ac-metric-label">Masse brute</span>
          <strong className="ac-metric-val">{fmtMoney(selectedRun?.total_gross ?? 0)}</strong>
          <span className="ac-metric-meta">
            CNSS sal. {fmtMoney(selectedRun?.total_cnss_emp ?? 0)}
          </span>
        </article>
        <article className="ac-metric">
          <span className="ac-metric-label">Net à payer</span>
          <strong className="ac-metric-val">{fmtMoney(selectedRun?.total_net ?? 0)}</strong>
          <span className="ac-metric-meta">
            IGR {fmtMoney(selectedRun?.total_igr ?? 0)} · {runLines.length} salarié(s)
          </span>
        </article>
        <article className="ac-metric">
          <span className="ac-metric-label">Coût employeur</span>
          <strong className="ac-metric-val">{fmtMoney(selectedRun?.total_employer_cost ?? 0)}</strong>
          <span className="ac-metric-meta">
            AMO sal. {fmtMoney(selectedRun?.total_amo_emp ?? 0)}
          </span>
        </article>
      </section>

      {/* Generate payroll run Bento panel */}
      <section className="ac-panel">
        <div className="ac-panel-head">
          <div>
            <h3>Générer un lot de paie</h3>
            <p className="ac-panel-sub">
              Crée ou recalcule un brouillon mensuel à partir des présences enregistrées.
            </p>
          </div>
          <span
            className={`ac-status-pill ${
              selectedRun
                ? selectedRun.status === 'closed'
                  ? 'is-ok'
                  : 'is-dirty'
                : ''
            }`}
          >
            {selectedRun ? (
              <>
                {selectedRun.status === 'closed' ? (
                  <Lock size={13} aria-hidden="true" />
                ) : (
                  <CheckCircle2 size={13} aria-hidden="true" />
                )}
                Lot #{selectedRun.id} · {selectedRun.status === 'closed' ? 'Clôturé' : 'Brouillon'}
              </>
            ) : (
              'Aucun lot sélectionné'
            )}
          </span>
        </div>
        <form onSubmit={createRegularRun} className="ac-erp-toolbar">
          <label className="ac-erp-field" style={{ minWidth: '180px' }}>
            <span>Période (mois)</span>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              required
            />
          </label>
          <button type="submit" className="ac-erp-btn-ico" disabled={busy || !isOwnerOrAdmin}>
            <Play size={15} aria-hidden="true" />
            <span>{busy ? 'Calcul…' : 'Générer le lot de paie'}</span>
          </button>
          {!isOwnerOrAdmin && (
            <span className="muted" style={{ fontSize: '0.82rem' }}>
              Réservé au propriétaire / administrateur.
            </span>
          )}
        </form>
      </section>

      {/* Selected run details Bento panel */}
      {selectedRun && (
        <section className="ac-panel">
          <div className="ac-panel-head">
            <div>
              <h3>
                Lot #{selectedRun.id} — {selectedRun.period_month}
              </h3>
              <p className="ac-panel-sub">
                {selectedRun.run_kind === 'corrective'
                  ? `Lot correctif du lot #${selectedRun.corrects_run_id || ''}`
                  : 'Lot mensuel principal'}{' '}
                · {runLines.length} bulletin(s)
              </p>
            </div>
            <div className="ac-erp-actions-row">
              <span
                className={`ac-status-pill ${
                  selectedRun.status === 'closed' ? 'is-ok' : 'is-dirty'
                }`}
              >
                {selectedRun.status === 'closed' ? 'Clôturé (immuable)' : 'Brouillon'}
              </span>
              <button
                type="button"
                className="secondary ac-erp-btn-ico"
                onClick={() => openAuthedUrl(api.payrollDeclarationUrl(Number(selectedRun.id), 'csv'))}
              >
                <Download size={14} aria-hidden="true" />
                <span>Déclaration CSV</span>
              </button>
              <button
                type="button"
                className="secondary ac-erp-btn-ico"
                onClick={() => openAuthedUrl(api.payrollDeclarationUrl(Number(selectedRun.id), 'xls'))}
              >
                <FileSpreadsheet size={14} aria-hidden="true" />
                <span>Excel (.xls)</span>
              </button>
              {selectedRun.status === 'draft' && isOwnerOrAdmin && (
                <button
                  type="button"
                  className="ac-erp-btn-ico"
                  disabled={busy}
                  onClick={() => void closeRun()}
                >
                  <Lock size={14} aria-hidden="true" />
                  <span>Clôturer le lot</span>
                </button>
              )}
              {selectedRun.status === 'closed' && isOwnerOrAdmin && (
                <button
                  type="button"
                  className="secondary ac-erp-btn-ico"
                  disabled={busy}
                  onClick={() => void createCorrectiveRun()}
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  <span>Lot correctif</span>
                </button>
              )}
            </div>
          </div>

          <div className="ac-erp-summary-chips">
            <span className="ac-erp-chip">
              Brut total : <strong>{fmtMoney(selectedRun.total_gross)}</strong>
            </span>
            <span className="ac-erp-chip">
              CNSS sal. : <strong>{fmtMoney(selectedRun.total_cnss_emp)}</strong>
            </span>
            <span className="ac-erp-chip">
              AMO sal. : <strong>{fmtMoney(selectedRun.total_amo_emp)}</strong>
            </span>
            <span className="ac-erp-chip">
              IGR : <strong>{fmtMoney(selectedRun.total_igr)}</strong>
            </span>
            <span className="ac-erp-chip">
              Net à payer : <strong>{fmtMoney(selectedRun.total_net)}</strong>
            </span>
            <span className="ac-erp-chip">
              Coût employeur : <strong>{fmtMoney(selectedRun.total_employer_cost)}</strong>
            </span>
          </div>

          <div className="ac-audit-table-wrap">
            <table className="ac-audit-table">
              <thead>
                <tr>
                  <th>Salarié</th>
                  <th>Jours / H. sup.</th>
                  <th>Base</th>
                  <th>Ajust. / Primes</th>
                  <th>Brut</th>
                  <th>CNSS sal.</th>
                  <th>AMO sal.</th>
                  <th>IGR</th>
                  <th>Net à payer</th>
                  <th>Coût employeur</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {runLines.map((l: any) => (
                  <tr key={l.id}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{l.employee_name}</div>
                      <div className="muted" style={{ fontSize: '0.75rem' }}>
                        {l.emp_number || '—'} · CNSS : {l.cnss_number || '—'}
                      </div>
                    </td>
                    <td>
                      {l.days_worked} j
                      {Number(l.overtime_hours || 0) > 0 ? ` (+${l.overtime_hours} h)` : ''}
                    </td>
                    <td>{fmtMoney(l.base_salary)}</td>
                    <td>
                      {fmtMoney(
                        Number(l.attendance_adjustment || 0) +
                          Number(l.bonuses || 0) +
                          Number(l.overtime_amount || 0),
                      )}
                    </td>
                    <td><strong>{fmtMoney(l.gross_salary)}</strong></td>
                    <td>{fmtMoney(l.cnss_emp)}</td>
                    <td>{fmtMoney(l.amo_emp)}</td>
                    <td>{fmtMoney(l.igr)}</td>
                    <td><strong>{fmtMoney(l.net_salary)}</strong></td>
                    <td>{fmtMoney(l.employer_cost)}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div className="ac-ops-row-actions">
                        <button
                          type="button"
                          className="secondary ac-erp-btn-ico"
                          onClick={() => openAuthedUrl(api.payrollBulletinUrl(Number(selectedRun.id), Number(l.id)))}
                        >
                          <FileText size={13} aria-hidden="true" />
                          <span>Bulletin PDF</span>
                        </button>
                        {selectedRun.status === 'draft' && isOwnerOrAdmin && (
                          <button
                            type="button"
                            className="secondary ac-erp-btn-ico"
                            onClick={() => {
                              setEditingLine(l);
                              setEditBonus(String(l.bonuses ?? 0));
                              setEditAdj(String(l.attendance_adjustment ?? 0));
                              setEditNotes(String(l.notes || ''));
                            }}
                          >
                            <Pencil size={13} aria-hidden="true" />
                            <span>Modifier</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {runLines.length === 0 && (
                  <tr>
                    <td colSpan={11} className="muted">
                      Aucun salarié actif sur ce lot.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* History Bento panel */}
      <section className="ac-panel">
        <div className="ac-panel-head">
          <div>
            <h3>Historique des lots de paie</h3>
            <p className="ac-panel-sub">Sélectionnez un lot pour consulter ou exporter les bulletins.</p>
          </div>
          <span className="ac-panel-count">{runs.length} lot(s)</span>
        </div>
        <div className="ac-audit-table-wrap">
          <table className="ac-audit-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Période</th>
                <th>Type</th>
                <th>Statut</th>
                <th>Brut</th>
                <th>Net</th>
                <th>Coût employeur</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td><strong>#{r.id}</strong></td>
                  <td>{r.period_month}</td>
                  <td>
                    {r.run_kind === 'corrective'
                      ? `Correctif (#${r.corrects_run_id || ''})`
                      : 'Mensuel'}
                  </td>
                  <td>
                    <span className={`ac-status-pill ${r.status === 'closed' ? 'is-ok' : 'is-dirty'}`}>
                      {r.status === 'closed' ? 'Clôturé' : 'Brouillon'}
                    </span>
                  </td>
                  <td>{fmtMoney(r.total_gross)}</td>
                  <td><strong>{fmtMoney(r.total_net)}</strong></td>
                  <td>{fmtMoney(r.total_employer_cost)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="ac-ops-row-actions">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void selectRun(Number(r.id))}
                      >
                        Ouvrir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    {loading ? 'Chargement des lots de paie…' : 'Aucun lot de paie généré.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editingLine && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="payroll-edit-title" onClick={() => setEditingLine(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2 id="payroll-edit-title">Modifier ligne — {editingLine.employee_name}</h2>
              <button
                type="button"
                className="modal-x"
                aria-label="Fermer"
                onClick={() => setEditingLine(null)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={saveLineEdit}>
              <div className="ac-ops-form-grid-2">
                <label className="ac-erp-field">
                  <span>Primes / indemnités (MAD)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={editBonus}
                    onChange={(e) => setEditBonus(e.target.value)}
                  />
                </label>
                <label className="ac-erp-field">
                  <span>Ajustement présence / retenue (MAD)</span>
                  <input
                    type="number"
                    step="0.01"
                    value={editAdj}
                    onChange={(e) => setEditAdj(e.target.value)}
                  />
                </label>
              </div>
              <label className="ac-erp-field" style={{ marginTop: '12px' }}>
                <span>Note / motif</span>
                <input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
              </label>
              <div className="modal-actions" style={{ marginTop: '16px' }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setEditingLine(null)}
                >
                  Annuler
                </button>
                <button type="submit" disabled={busy}>
                  {busy ? 'Recalcul…' : 'Enregistrer & recalculer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
