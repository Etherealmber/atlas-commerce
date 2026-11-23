import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { getRole, getToken } from '../auth';
import PageSkeleton from '../components/PageSkeleton';
import SaveFeedback from '../components/SaveFeedback';
import { fmtMoney } from '../lib/money';

const DENOMINATIONS = [200, 100, 50, 20, 10, 5, 2, 1, 0.5];

export default function CashShifts() {
  const role = getRole();
  const isOwnerOrAdmin = role === 'owner' || role === 'admin';

  const [shifts, setShifts] = useState<any[]>([]);
  const [selectedShift, setSelectedShift] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  // Open shift form
  const [tillId, setTillId] = useState('CAISSE-1');
  const [openingFloat, setOpeningFloat] = useState('0');
  const [openNotes, setOpenNotes] = useState('');
  const [openingBusy, setOpeningBusy] = useState(false);

  // Manual movement form
  const [mvDir, setMvDir] = useState<'in' | 'out'>('in');
  const [mvMethod, setMvMethod] = useState('cash');
  const [mvAmount, setMvAmount] = useState('');
  const [mvLabel, setMvLabel] = useState('');
  const [mvBusy, setMvBusy] = useState(false);

  // Close shift form (owner/admin only)
  const [denoms, setDenoms] = useState<Record<string, string>>({});
  const [manualCounted, setManualCounted] = useState('');
  const [cardCounted, setCardCounted] = useState('');
  const [transferCounted, setTransferCounted] = useState('');
  const [checkCounted, setCheckCounted] = useState('');
  const [closeNotes, setCloseNotes] = useState('');
  const [closingBusy, setClosingBusy] = useState(false);

  const loadShifts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.listCashShifts();
      const rows = res.data || [];
      setShifts(rows);
      const openOne = rows.find((r: any) => r.status === 'open') || rows[0] || null;
      if (openOne) {
        const det = await api.getCashShift(Number(openOne.id));
        setSelectedShift(det.data);
      } else {
        setSelectedShift(null);
      }
    } catch (e: any) {
      setError(e?.message || 'Impossible de charger les sessions de caisse.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadShifts();
  }, [loadShifts]);

  const selectShift = async (id: number) => {
    try {
      const det = await api.getCashShift(id);
      setSelectedShift(det.data);
    } catch (e: any) {
      setError(e?.message || 'Erreur lors du chargement de la session.');
    }
  };

  const denomSum = useMemo(() => {
    let total = 0;
    for (const face of DENOMINATIONS) {
      const cnt = Number(denoms[String(face)] || 0);
      if (Number.isFinite(cnt) && cnt > 0) total += face * cnt;
    }
    return Math.round(total * 100) / 100;
  }, [denoms]);

  const effectiveCounted = manualCounted.trim() !== '' ? Number(manualCounted) : denomSum;

  const openReportWindow = (id: number, kind: 'x' | 'z', reprint = false) => {
    const token = getToken();
    const base = api.cashShiftReportUrl(id, kind, reprint);
    const sep = base.includes('?') ? '&' : '?';
    const url = token ? `${base}${sep}token=${encodeURIComponent(token)}` : base;
    window.open(url, '_blank', 'noopener');
  };

  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setOpeningBusy(true);
    setError('');
    setFeedback('');
    try {
      const res = await api.openCashShift({
        till_id: tillId.trim() || 'CAISSE-1',
        opening_float: Number(openingFloat || 0),
        notes: openNotes.trim(),
      });
      setFeedback('Session de caisse ouverte.');
      setOpenNotes('');
      await loadShifts();
      if (res.data?.id) await selectShift(Number(res.data.id));
    } catch (err: any) {
      setError(err?.message || 'Impossible d’ouvrir la caisse.');
    } finally {
      setOpeningBusy(false);
    }
  };

  const handleAddMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedShift || selectedShift.status !== 'open') return;
    setMvBusy(true);
    setError('');
    try {
      await api.addCashShiftMovement(Number(selectedShift.id), {
        direction: mvDir,
        payment_method: mvMethod,
        amount: Number(mvAmount || 0),
        label: mvLabel.trim() || (mvDir === 'in' ? 'Apport caisse' : 'Retrait caisse'),
      });
      setMvAmount('');
      setMvLabel('');
      setFeedback('Mouvement enregistré.');
      await selectShift(Number(selectedShift.id));
    } catch (err: any) {
      setError(err?.message || 'Erreur lors de l’ajout du mouvement.');
    } finally {
      setMvBusy(false);
    }
  };

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedShift || selectedShift.status !== 'open' || !isOwnerOrAdmin) return;
    setClosingBusy(true);
    setError('');
    setFeedback('');
    try {
      const denomPayload: Record<string, number> = {};
      for (const face of DENOMINATIONS) {
        const cnt = Number(denoms[String(face)] || 0);
        if (cnt > 0) denomPayload[String(face)] = cnt;
      }
      const countedByMethod: Record<string, number> = {};
      if (cardCounted.trim() !== '') countedByMethod.card = Number(cardCounted);
      if (transferCounted.trim() !== '') countedByMethod.transfer = Number(transferCounted);
      if (checkCounted.trim() !== '') countedByMethod.check = Number(checkCounted);

      await api.closeCashShift(Number(selectedShift.id), {
        counted_amount: Number.isFinite(effectiveCounted) ? effectiveCounted : 0,
        denominations: denomPayload,
        counted_by_method: Object.keys(countedByMethod).length ? countedByMethod : undefined,
        notes: closeNotes.trim(),
      });
      setFeedback('Session clôturée (Rapport Z généré).');
      setDenoms({});
      setManualCounted('');
      setCardCounted('');
      setTransferCounted('');
      setCheckCounted('');
      setCloseNotes('');
      await loadShifts();
    } catch (err: any) {
      setError(err?.message || 'Erreur lors de la clôture.');
    } finally {
      setClosingBusy(false);
    }
  };

  if (loading) return <PageSkeleton variant="dashboard" />;

  const activeOpenShifts = shifts.filter((s) => s.status === 'open');
  const expectedCash = Number(selectedShift?.summary?.expectedCash ?? selectedShift?.expected_amount ?? 0);
  const liveVariance = Math.round(((Number.isFinite(effectiveCounted) ? effectiveCounted : 0) - expectedCash) * 100) / 100;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Clôtures de caisse (X / Z)</h1>
          <p className="muted">Ouverture de caisse, suivi des mouvements par moyen de paiement et rapport Z audité.</p>
        </div>
        <button type="button" className="secondary" onClick={() => void loadShifts()}>
          Actualiser
        </button>
      </div>

      {error && <div className="alert error" role="alert">{error}</div>}
      <SaveFeedback message={feedback} />

      <div className="grid-2" style={{ gap: '16px', alignItems: 'start', marginBottom: '16px' }}>
        <form className="card" onSubmit={handleOpenShift}>
          <h2 style={{ marginTop: 0 }}>Ouvrir une session de caisse</h2>
          <div className="form-grid">
            <label>
              <span>Caisse</span>
              <input value={tillId} onChange={(e) => setTillId(e.target.value)} placeholder="CAISSE-1" required />
            </label>
            <label>
              <span>Fond d’ouverture (DH)</span>
              <input type="number" step="0.01" min="0" value={openingFloat} onChange={(e) => setOpeningFloat(e.target.value)} />
            </label>
          </div>
          <label style={{ display: 'block', marginTop: '10px' }}>
            <span>Notes d’ouverture</span>
            <input value={openNotes} onChange={(e) => setOpenNotes(e.target.value)} placeholder="Optionnel" />
          </label>
          <div style={{ marginTop: '12px' }}>
            <button type="submit" disabled={openingBusy}>
              {openingBusy ? 'Ouverture…' : 'Ouvrir la caisse'}
            </button>
          </div>
        </form>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Sessions ouvertes ({activeOpenShifts.length})</h2>
          {activeOpenShifts.length === 0 ? (
            <p className="muted">Aucune session de caisse actuellement ouverte.</p>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '8px' }}>
              {activeOpenShifts.map((s) => (
                <li key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                  <div>
                    <strong>{s.till_id}</strong> · {s.operator} · Fond {fmtMoney(s.opening_float)}
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button type="button" className="secondary" onClick={() => void selectShift(Number(s.id))}>
                      Détails
                    </button>
                    <button type="button" className="secondary" onClick={() => openReportWindow(Number(s.id), 'x')}>
                      Rapport X
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {selectedShift && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h2 style={{ margin: 0 }}>
                Session #{selectedShift.id} — {selectedShift.till_id} ({selectedShift.status === 'open' ? 'Ouverte' : 'Clôturée'})
              </h2>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                Opérateur : {selectedShift.operator} · Ouverte le {String(selectedShift.opened_at).slice(0, 16).replace('T', ' ')}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button type="button" className="secondary" onClick={() => openReportWindow(Number(selectedShift.id), 'x')}>
                Imprimer Rapport X
              </button>
              {selectedShift.status === 'closed' && isOwnerOrAdmin && (
                <button type="button" onClick={() => openReportWindow(Number(selectedShift.id), 'z', true)}>
                  Réimprimer Rapport Z
                </button>
              )}
            </div>
          </div>

          <div style={{ overflowX: 'auto', marginTop: '12px' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Moyen</th>
                  <th>Entrées</th>
                  <th>Sorties</th>
                  <th>Attendu</th>
                  <th>Compté</th>
                  <th>Écart</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(selectedShift.summary?.methods || {}).map((m: any) => (
                  <tr key={m.method}>
                    <td>{m.label}</td>
                    <td>{fmtMoney(m.in_total)}</td>
                    <td>{fmtMoney(m.out_total)}</td>
                    <td>{fmtMoney(m.expected)}</td>
                    <td>{m.counted == null ? '—' : fmtMoney(m.counted)}</td>
                    <td>{m.variance == null ? '—' : fmtMoney(m.variance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selectedShift.status === 'open' && (
            <div className="grid-2" style={{ gap: '16px', marginTop: '16px', alignItems: 'start' }}>
              <form onSubmit={handleAddMovement} className="card" style={{ padding: '12px' }}>
                <h3 style={{ marginTop: 0 }}>Mouvement manuel sur session</h3>
                <div className="form-grid">
                  <label>
                    <span>Sens</span>
                    <select value={mvDir} onChange={(e) => setMvDir(e.target.value as 'in' | 'out')}>
                      <option value="in">Entrée (apport)</option>
                      <option value="out">Sortie (retrait / dépense)</option>
                    </select>
                  </label>
                  <label>
                    <span>Moyen</span>
                    <select value={mvMethod} onChange={(e) => setMvMethod(e.target.value)}>
                      <option value="cash">Espèces</option>
                      <option value="card">Carte</option>
                      <option value="transfer">Virement</option>
                      <option value="check">Chèque</option>
                    </select>
                  </label>
                  <label>
                    <span>Montant (DH)</span>
                    <input type="number" step="0.01" min="0.01" value={mvAmount} onChange={(e) => setMvAmount(e.target.value)} required />
                  </label>
                  <label>
                    <span>Libellé</span>
                    <input value={mvLabel} onChange={(e) => setMvLabel(e.target.value)} placeholder="Motif" />
                  </label>
                </div>
                <button type="submit" className="secondary" disabled={mvBusy} style={{ marginTop: '10px' }}>
                  {mvBusy ? 'Ajout…' : 'Ajouter le mouvement'}
                </button>
              </form>

              {isOwnerOrAdmin ? (
                <form onSubmit={handleCloseShift} className="card" style={{ padding: '12px' }}>
                  <h3 style={{ marginTop: 0 }}>Clôturer la session (Rapport Z)</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '8px' }}>
                    {DENOMINATIONS.map((face) => (
                      <label key={face} style={{ fontSize: '0.85rem' }}>
                        <span>{face} DH ×</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={denoms[String(face)] || ''}
                          onChange={(e) => setDenoms((d) => ({ ...d, [String(face)]: e.target.value }))}
                          placeholder="0"
                        />
                      </label>
                    ))}
                  </div>
                  <div className="form-grid" style={{ marginTop: '10px' }}>
                    <label>
                      <span>Compté espèces total (auto : {fmtMoney(denomSum)})</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={manualCounted}
                        onChange={(e) => setManualCounted(e.target.value)}
                        placeholder={String(denomSum)}
                      />
                    </label>
                    <label>
                      <span>TPE / Carte compté (optionnel)</span>
                      <input type="number" step="0.01" min="0" value={cardCounted} onChange={(e) => setCardCounted(e.target.value)} />
                    </label>
                    <label>
                      <span>Virements comptés (optionnel)</span>
                      <input type="number" step="0.01" min="0" value={transferCounted} onChange={(e) => setTransferCounted(e.target.value)} />
                    </label>
                    <label>
                      <span>Chèques comptés (optionnel)</span>
                      <input type="number" step="0.01" min="0" value={checkCounted} onChange={(e) => setCheckCounted(e.target.value)} />
                    </label>
                  </div>
                  <label style={{ display: 'block', marginTop: '10px' }}>
                    <span>Observations de clôture</span>
                    <input value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} placeholder="Écart justifié, remise banque…" />
                  </label>
                  <p style={{ marginTop: '10px', fontWeight: 600 }}>
                    Attendu espèces : {fmtMoney(expectedCash)} · Écart estimé : {fmtMoney(liveVariance)}
                  </p>
                  <button type="submit" disabled={closingBusy}>
                    {closingBusy ? 'Clôture…' : 'Clôturer & Générer Rapport Z'}
                  </button>
                </form>
              ) : (
                <div className="card" style={{ padding: '12px' }}>
                  <h3 style={{ marginTop: 0 }}>Clôture (Rapport Z)</h3>
                  <p className="muted">Seul le propriétaire ou un administrateur peut clôturer la caisse et réimprimer le rapport Z.</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Historique des sessions</h2>
        <div style={{ overflowX: 'auto' }}>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Caisse</th>
                <th>Opérateur</th>
                <th>Ouverture</th>
                <th>Clôture</th>
                <th>Fond</th>
                <th>Attendu</th>
                <th>Compté</th>
                <th>Écart</th>
                <th>Statut</th>
                <th>Rapports</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => (
                <tr key={s.id}>
                  <td>{s.id}</td>
                  <td>{s.till_id}</td>
                  <td>{s.operator}</td>
                  <td>{String(s.opened_at).slice(0, 16).replace('T', ' ')}</td>
                  <td>{s.closed_at ? String(s.closed_at).slice(0, 16).replace('T', ' ') : '—'}</td>
                  <td>{fmtMoney(s.opening_float)}</td>
                  <td>{s.expected_amount == null ? '—' : fmtMoney(s.expected_amount)}</td>
                  <td>{s.counted_amount == null ? '—' : fmtMoney(s.counted_amount)}</td>
                  <td>{s.variance == null ? '—' : fmtMoney(s.variance)}</td>
                  <td>{s.status === 'open' ? 'Ouverte' : 'Clôturée'}</td>
                  <td style={{ display: 'flex', gap: '6px' }}>
                    <button type="button" className="secondary" onClick={() => void selectShift(Number(s.id))}>
                      Voir
                    </button>
                    <button type="button" className="secondary" onClick={() => openReportWindow(Number(s.id), 'x')}>
                      X
                    </button>
                    {s.status === 'closed' && isOwnerOrAdmin && (
                      <button type="button" className="secondary" onClick={() => openReportWindow(Number(s.id), 'z', true)}>
                        Réimprimer Z
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {shifts.length === 0 && (
                <tr>
                  <td colSpan={11} className="muted">Aucune session enregistrée.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
