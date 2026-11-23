import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { getToken } from '../auth';
import PageSkeleton from '../components/PageSkeleton';
import SaveFeedback from '../components/SaveFeedback';
import { fmtMoney } from '../lib/money';

function openAuthedUrl(url: string) {
  const token = getToken();
  const sep = url.includes('?') ? '&' : '?';
  const full = token ? `${url}${sep}token=${encodeURIComponent(token)}` : url;
  window.open(full, '_blank', 'noopener');
}

export default function Payroll() {
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<any | null>(null);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [editingLine, setEditingLine] = useState<any | null>(null);
  const [editBonus, setEditBonus] = useState('0');
  const [editAdj, setEditAdj] = useState('0');
  const [editNotes, setEditNotes] = useState('');

  const loadRuns = useCallback(async (pickId?: number) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.listPayrollRuns();
      const rows = res.data || [];
      setRuns(rows);
      const targetId = pickId || rows[0]?.id;
      if (targetId) {
        const det = await api.getPayrollRun(Number(targetId));
        setSelectedRun(det.data);
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
    try {
      const det = await api.getPayrollRun(id);
      setSelectedRun(det.data);
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

  if (loading) return <PageSkeleton variant="dashboard" />;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Paie mensuelle (CNSS / AMO / IGR)</h1>
          <p className="muted">
            Calcul automatique à partir des présences/heures sup. et du barème Maroc (à vérifier avec votre comptable).
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to="/settings?tab=payroll" className="btn secondary">
            Paramètres CNSS / AMO
          </Link>
          <button type="button" className="secondary" onClick={() => void loadRuns(selectedRun?.id)}>
            Actualiser
          </button>
        </div>
      </div>

      {error && <div className="alert error" role="alert">{error}</div>}
      <SaveFeedback message={feedback} />

      <form className="card" onSubmit={createRegularRun} style={{ marginBottom: 16, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end' }}>
        <label>
          <span>Période (mois)</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? 'Calcul…' : 'Générer le lot de paie'}
        </button>
      </form>

      {selectedRun && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h2 style={{ margin: 0 }}>
                Lot #{selectedRun.id} — {selectedRun.period_month} ({selectedRun.run_kind === 'corrective' ? 'Correctif' : 'Mensuel'}) ·{' '}
                {selectedRun.status === 'closed' ? 'Clôturé (immuable)' : 'Brouillon'}
              </h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                Brut total : {fmtMoney(selectedRun.total_gross)} · CNSS sal. : {fmtMoney(selectedRun.total_cnss_emp)} · AMO sal. : {fmtMoney(selectedRun.total_amo_emp)} · IGR : {fmtMoney(selectedRun.total_igr)} · Net total : {fmtMoney(selectedRun.total_net)} · Coût employeur : {fmtMoney(selectedRun.total_employer_cost)}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="secondary"
                onClick={() => openAuthedUrl(api.payrollDeclarationUrl(Number(selectedRun.id), 'csv'))}
              >
                Déclaration CSV
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => openAuthedUrl(api.payrollDeclarationUrl(Number(selectedRun.id), 'xls'))}
              >
                Déclaration Excel (.xls)
              </button>
              {selectedRun.status === 'draft' ? (
                <button type="button" disabled={busy} onClick={() => void closeRun()}>
                  Clôturer le lot (immuable)
                </button>
              ) : (
                <button type="button" disabled={busy} onClick={() => void createCorrectiveRun()}>
                  Créer un lot correctif
                </button>
              )}
            </div>
          </div>

          <div style={{ overflowX: 'auto', marginTop: 12 }}>
            <table className="table">
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
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {(selectedRun.lines || []).map((l: any) => (
                  <tr key={l.id}>
                    <td>
                      <strong>{l.employee_name}</strong>
                      <div className="muted" style={{ fontSize: 11 }}>
                        {l.emp_number || '—'} · CNSS: {l.cnss_number || '—'}
                      </div>
                    </td>
                    <td>
                      {l.days_worked} j
                      {Number(l.overtime_hours || 0) > 0 ? ` (+${l.overtime_hours} h)` : ''}
                    </td>
                    <td>{fmtMoney(l.base_salary)}</td>
                    <td>
                      {fmtMoney(Number(l.attendance_adjustment || 0) + Number(l.bonuses || 0) + Number(l.overtime_amount || 0))}
                    </td>
                    <td>{fmtMoney(l.gross_salary)}</td>
                    <td>{fmtMoney(l.cnss_emp)}</td>
                    <td>{fmtMoney(l.amo_emp)}</td>
                    <td>{fmtMoney(l.igr)}</td>
                    <td><strong>{fmtMoney(l.net_salary)}</strong></td>
                    <td>{fmtMoney(l.employer_cost)}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => openAuthedUrl(api.payrollBulletinUrl(Number(selectedRun.id), Number(l.id)))}
                      >
                        Bulletin PDF
                      </button>
                      {selectedRun.status === 'draft' && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => {
                            setEditingLine(l);
                            setEditBonus(String(l.bonuses ?? 0));
                            setEditAdj(String(l.attendance_adjustment ?? 0));
                            setEditNotes(String(l.notes || ''));
                          }}
                        >
                          Modifier
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editingLine && (
        <div className="modal-backdrop" onClick={() => setEditingLine(null)} role="presentation">
          <form className="modal-card" onClick={(e) => e.stopPropagation()} onSubmit={saveLineEdit} style={{ maxWidth: 420 }}>
            <h2 style={{ marginTop: 0 }}>Modifier ligne — {editingLine.employee_name}</h2>
            <label style={{ display: 'block', marginBottom: 8 }}>
              <span>Primes / indemnités (MAD)</span>
              <input type="number" step="0.01" value={editBonus} onChange={(e) => setEditBonus(e.target.value)} />
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              <span>Ajustement présence / retenue (MAD)</span>
              <input type="number" step="0.01" value={editAdj} onChange={(e) => setEditAdj(e.target.value)} />
            </label>
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span>Note</span>
              <input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} />
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="secondary" onClick={() => setEditingLine(null)}>Annuler</button>
              <button type="submit" disabled={busy}>Enregistrer &amp; recalculer</button>
            </div>
          </form>
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Historique des lots de paie</h2>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Période</th>
                <th>Type</th>
                <th>Statut</th>
                <th>Brut</th>
                <th>Net</th>
                <th>Coût employeur</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{r.id}</td>
                  <td>{r.period_month}</td>
                  <td>{r.run_kind === 'corrective' ? `Correctif (#${r.corrects_run_id || ''})` : 'Mensuel'}</td>
                  <td>{r.status === 'closed' ? 'Clôturé' : 'Brouillon'}</td>
                  <td>{fmtMoney(r.total_gross)}</td>
                  <td>{fmtMoney(r.total_net)}</td>
                  <td>{fmtMoney(r.total_employer_cost)}</td>
                  <td>
                    <button type="button" className="secondary" onClick={() => void selectRun(Number(r.id))}>
                      Ouvrir
                    </button>
                  </td>
                </tr>
              ))}
              {runs.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">Aucun lot de paie généré.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
