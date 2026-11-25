import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  CircleDot,
  Lock,
  Plus,
  Printer,
  Unlock,
} from 'lucide-react';
import { api } from '../api';
import { getRole, getToken } from '../auth';
import SaveFeedback from '../components/SaveFeedback';
import TopPageActions from '../components/TopPageActions';
import RefreshIconButton from '../components/RefreshIconButton';
import PageSkeleton from '../components/PageSkeleton';
import { fmtMoney } from '../lib/money';
import { MetricSpark, MetricTrend } from '../components/MetricSpark';

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

  // v0.9.3 — une réponse partielle (tableau, objet sans id) affichait « #undefined ».
  const asShift = (raw: unknown, fallback: any = null) =>
    raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as any).id != null ? raw : fallback;

  const loadShifts = useCallback(async (pickId?: number) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.listCashShifts();
      const rows = Array.isArray(res.data) ? res.data : [];
      setShifts(rows);
      const target =
        (pickId ? rows.find((r: any) => Number(r.id) === pickId) : null) ||
        rows.find((r: any) => r.status === 'open') ||
        rows[0] ||
        null;
      if (target) {
        const det = await api.getCashShift(Number(target.id));
        setSelectedShift(asShift(det.data, target));
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
    setError('');
    try {
      const det = await api.getCashShift(id);
      setSelectedShift(asShift(det.data, shifts.find((r: any) => Number(r.id) === id) || null));
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
      await loadShifts(res.data?.id ? Number(res.data.id) : undefined);
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
      await loadShifts(Number(selectedShift.id));
    } catch (err: any) {
      setError(err?.message || 'Erreur lors de la clôture.');
    } finally {
      setClosingBusy(false);
    }
  };

  const activeOpenShifts = useMemo(() => shifts.filter((s) => s.status === 'open'), [shifts]);
  const closedShifts = useMemo(() => shifts.filter((s) => s.status === 'closed'), [shifts]);
  const totalVariance = useMemo(
    () => closedShifts.reduce((acc, s) => acc + Number(s.variance || 0), 0),
    [closedShifts],
  );
  const expectedCash = Number(selectedShift?.summary?.expectedCash ?? selectedShift?.expected_amount ?? 0);
  const liveVariance =
    Math.round(((Number.isFinite(effectiveCounted) ? effectiveCounted : 0) - expectedCash) * 100) / 100;
  const methodRows: any[] = Object.values(selectedShift?.summary?.methods || {});

  if (loading && !shifts.length && !selectedShift && !error) {
    return (
      <div className="atlas-page ac-dash cash-shifts-page ac-erp-page">
        <div className="page-header dock-page-header">
          <h1 className="sr-only">Clôtures de caisse (X / Z)</h1>
        </div>
        <PageSkeleton variant="cash-shifts" />
      </div>
    );
  }

  return (
    <div className="atlas-page ac-dash cash-shifts-page ac-erp-page">
      <div className="page-header dock-page-header">
        <h1 className="sr-only">Clôtures de caisse (X / Z)</h1>
        <TopPageActions>
          <RefreshIconButton onClick={() => void loadShifts(selectedShift?.id)} loading={loading} />
        </TopPageActions>
      </div>

      {error && <p className="msg-error" role="alert">{error}</p>}
      <SaveFeedback message={feedback} />

      {/* 4 Dashboard KPI Bento Cards */}
      <section className="ac-metric-grid" aria-label="Indicateurs de caisse">
        <article className="ac-metric">
          <span className="ac-metric-label">Sessions ouvertes</span>
          <strong className="ac-metric-val">{activeOpenShifts.length}</strong>
          <span className="ac-metric-meta">
            {activeOpenShifts.length > 0
              ? activeOpenShifts.map((s) => s.till_id).join(', ')
              : 'Aucune caisse active'}
          </span>
        </article>
        <article className="ac-metric">
          <span className="ac-metric-label">Attendu espèces</span>
          <strong className="ac-metric-val">{fmtMoney(expectedCash)}<MetricTrend k="cash_net" /></strong>
          <span className="ac-metric-meta">
            {selectedShift
              ? `Fond ${fmtMoney(selectedShift.opening_float)} · #${selectedShift.id}`
              : 'Sélectionnez une session'}
          </span>
          <MetricSpark k="cash_net" unit="money" />
        </article>
        <article className="ac-metric">
          <span className="ac-metric-label">Sessions clôturées</span>
          <strong className="ac-metric-val">{closedShifts.length}</strong>
          <span className="ac-metric-meta">sur {shifts.length} session(s) au total</span>
        </article>
        <article className="ac-metric">
          <span className="ac-metric-label">Écart cumulé</span>
          <strong className="ac-metric-val">{fmtMoney(totalVariance)}<MetricTrend k="cash_variance" /></strong>
          <span className="ac-metric-meta">Écarts constatés aux clôtures Z</span>
          <MetricSpark k="cash_variance" unit="money" />
        </article>
      </section>

      {/* Bento 2-column row: Open Shift + Active Open Shifts */}
      <div className="ac-bento-grid-2 ac-bento-grid-2--stretch">
        <section className="ac-panel ac-ops-panel-stretch">
          <div className="ac-panel-head">
            <div>
              <h3>Ouvrir une session de caisse</h3>
              <p className="ac-panel-sub">Déclarez la caisse et le fond initial avant d&apos;encaisser.</p>
            </div>
          </div>
          <form onSubmit={handleOpenShift} style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
            <div className="ac-ops-form-grid-2">
              <label className="ac-erp-field">
                <span>Caisse</span>
                <input
                  value={tillId}
                  onChange={(e) => setTillId(e.target.value)}
                  placeholder="CAISSE-1"
                  required
                />
              </label>
              <label className="ac-erp-field">
                <span>Fond d&apos;ouverture (DH)</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={openingFloat}
                  onChange={(e) => setOpeningFloat(e.target.value)}
                />
              </label>
            </div>
            <label className="ac-erp-field">
              <span>Notes d&apos;ouverture</span>
              <input
                value={openNotes}
                onChange={(e) => setOpenNotes(e.target.value)}
                placeholder="Ex. : Caisse principale matin"
              />
            </label>
            <div className="ac-ops-panel-foot">
              <button type="submit" className="ac-erp-btn-ico" disabled={openingBusy}>
                <Unlock size={15} aria-hidden="true" />
                <span>{openingBusy ? 'Ouverture…' : 'Ouvrir la caisse'}</span>
              </button>
            </div>
          </form>
        </section>

        <section className="ac-panel ac-ops-panel-stretch">
          <div className="ac-panel-head">
            <div>
              <h3>Sessions ouvertes</h3>
              <p className="ac-panel-sub">Accès rapide aux caisses en cours d&apos;exploitation.</p>
            </div>
            <span className={`ac-status-pill ${activeOpenShifts.length > 0 ? 'is-ok' : 'is-warn'}`}>
              {activeOpenShifts.length > 0 ? (
                <CircleDot size={13} aria-hidden="true" />
              ) : (
                <Lock size={13} aria-hidden="true" />
              )}
              {activeOpenShifts.length > 0
                ? `${activeOpenShifts.length} session(s) ouverte(s)`
                : 'Aucune session ouverte'}
            </span>
          </div>
          {activeOpenShifts.length === 0 ? (
            <p className="muted" style={{ margin: '8px 0 0' }}>
              Aucune session ouverte actuellement. Ouvrez une caisse pour suivre les mouvements en direct.
            </p>
          ) : (
            <ul className="ac-erp-open-list">
              {activeOpenShifts.map((s) => (
                <li key={s.id} className="ac-erp-open-item">
                  <div className="ac-erp-open-meta">
                    <strong>
                      #{s.id} · {s.till_id}
                    </strong>
                    <span>
                      {s.operator} · Fond {fmtMoney(s.opening_float)}
                    </span>
                  </div>
                  <div className="ac-ops-row-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void selectShift(Number(s.id))}
                    >
                      Détails
                    </button>
                    <button
                      type="button"
                      className="secondary ac-erp-btn-ico"
                      onClick={() => openReportWindow(Number(s.id), 'x')}
                    >
                      <Printer size={13} aria-hidden="true" />
                      <span>Rapport X</span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Selected Shift Bento Detail */}
      {selectedShift && (
        <section className="ac-panel">
          <div className="ac-panel-head">
            <div>
              <h3>
                Session #{selectedShift.id} — {selectedShift.till_id}
              </h3>
              <p className="ac-panel-sub">
                Opérateur : {selectedShift.operator || '—'} · Ouverte le{' '}
                {selectedShift.opened_at ? String(selectedShift.opened_at).slice(0, 16).replace('T', ' ') : '—'}
              </p>
            </div>
            <div className="ac-erp-actions-row">
              <span
                className={`ac-status-pill ${
                  selectedShift.status === 'open' ? 'is-ok' : 'is-dirty'
                }`}
              >
                {selectedShift.status === 'open' ? (
                  <CheckCircle2 size={13} aria-hidden="true" />
                ) : (
                  <Lock size={13} aria-hidden="true" />
                )}
                {selectedShift.status === 'open' ? 'Ouverte' : 'Clôturée'}
              </span>
              <button
                type="button"
                className="secondary ac-erp-btn-ico"
                onClick={() => openReportWindow(Number(selectedShift.id), 'x')}
              >
                <Printer size={14} aria-hidden="true" />
                <span>Imprimer Rapport X</span>
              </button>
              {selectedShift.status === 'closed' && isOwnerOrAdmin && (
                <button
                  type="button"
                  className="ac-erp-btn-ico"
                  onClick={() => openReportWindow(Number(selectedShift.id), 'z', true)}
                >
                  <Printer size={14} aria-hidden="true" />
                  <span>Réimprimer Rapport Z</span>
                </button>
              )}
            </div>
          </div>

          <div className="ac-audit-table-wrap">
            <table className="ac-audit-table">
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
                {methodRows.map((m: any) => (
                  <tr key={m.method}>
                    <td><strong>{m.label || m.method}</strong></td>
                    <td>{fmtMoney(m.in_total)}</td>
                    <td>{fmtMoney(m.out_total)}</td>
                    <td><strong>{fmtMoney(m.expected)}</strong></td>
                    <td>{m.counted == null ? '—' : fmtMoney(m.counted)}</td>
                    <td>{m.variance == null ? '—' : fmtMoney(m.variance)}</td>
                  </tr>
                ))}
                {methodRows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">Aucun mouvement sur cette session.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {selectedShift.status === 'open' && (
            <div className="ac-bento-grid-2" style={{ marginTop: '16px', alignItems: 'start' }}>
              <form onSubmit={handleAddMovement} className="ac-erp-subpanel">
                <h4>Mouvement manuel sur session</h4>
                <div className="ac-ops-form-grid-2">
                  <label className="ac-erp-field">
                    <span>Sens</span>
                    <select value={mvDir} onChange={(e) => setMvDir(e.target.value as 'in' | 'out')}>
                      <option value="in">Entrée (apport)</option>
                      <option value="out">Sortie (retrait / dépense)</option>
                    </select>
                  </label>
                  <label className="ac-erp-field">
                    <span>Moyen</span>
                    <select value={mvMethod} onChange={(e) => setMvMethod(e.target.value)}>
                      <option value="cash">Espèces</option>
                      <option value="card">Carte</option>
                      <option value="transfer">Virement</option>
                      <option value="check">Chèque</option>
                    </select>
                  </label>
                  <label className="ac-erp-field">
                    <span>Montant (DH)</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={mvAmount}
                      onChange={(e) => setMvAmount(e.target.value)}
                      required
                    />
                  </label>
                  <label className="ac-erp-field">
                    <span>Libellé</span>
                    <input
                      value={mvLabel}
                      onChange={(e) => setMvLabel(e.target.value)}
                      placeholder="Motif"
                    />
                  </label>
                </div>
                <button
                  type="submit"
                  className="secondary ac-erp-btn-ico"
                  disabled={mvBusy}
                  style={{ marginTop: '12px' }}
                >
                  <Plus size={14} aria-hidden="true" />
                  <span>{mvBusy ? 'Ajout…' : 'Ajouter le mouvement'}</span>
                </button>
              </form>

              {isOwnerOrAdmin ? (
                <form onSubmit={handleCloseShift} className="ac-erp-subpanel">
                  <h4>Clôturer la session (Rapport Z)</h4>
                  <div className="ac-erp-denom-grid">
                    {DENOMINATIONS.map((face) => (
                      <label key={face} className="ac-erp-field">
                        <span>{face} DH ×</span>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={denoms[String(face)] || ''}
                          onChange={(e) =>
                            setDenoms((d) => ({ ...d, [String(face)]: e.target.value }))
                          }
                          placeholder="0"
                        />
                      </label>
                    ))}
                  </div>
                  <div className="ac-ops-form-grid-2" style={{ marginTop: '12px' }}>
                    <label className="ac-erp-field">
                      <span>Compté espèces (auto : {fmtMoney(denomSum)})</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={manualCounted}
                        onChange={(e) => setManualCounted(e.target.value)}
                        placeholder={String(denomSum)}
                      />
                    </label>
                    <label className="ac-erp-field">
                      <span>TPE / Carte compté (optionnel)</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={cardCounted}
                        onChange={(e) => setCardCounted(e.target.value)}
                      />
                    </label>
                    <label className="ac-erp-field">
                      <span>Virements comptés (optionnel)</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={transferCounted}
                        onChange={(e) => setTransferCounted(e.target.value)}
                      />
                    </label>
                    <label className="ac-erp-field">
                      <span>Chèques comptés (optionnel)</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={checkCounted}
                        onChange={(e) => setCheckCounted(e.target.value)}
                      />
                    </label>
                  </div>
                  <label className="ac-erp-field" style={{ marginTop: '12px' }}>
                    <span>Observations de clôture</span>
                    <input
                      value={closeNotes}
                      onChange={(e) => setCloseNotes(e.target.value)}
                      placeholder="Écart justifié, remise banque…"
                    />
                  </label>
                  <div className="ac-erp-variance-bar">
                    <span>
                      Attendu espèces : <strong>{fmtMoney(expectedCash)}</strong>
                    </span>
                    <span>
                      Écart estimé : <strong>{fmtMoney(liveVariance)}</strong>
                    </span>
                  </div>
                  <button type="submit" className="ac-erp-btn-ico" disabled={closingBusy}>
                    <Lock size={14} aria-hidden="true" />
                    <span>{closingBusy ? 'Clôture…' : 'Clôturer & Générer Rapport Z'}</span>
                  </button>
                </form>
              ) : (
                <div className="ac-erp-subpanel">
                  <h4>Clôture (Rapport Z)</h4>
                  <p className="muted" style={{ margin: 0 }}>
                    Seul le propriétaire ou un administrateur peut clôturer la caisse et réimprimer le rapport Z.
                  </p>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* History Bento Panel */}
      <section className="ac-panel">
        <div className="ac-panel-head">
          <div>
            <h3>Historique des sessions</h3>
            <p className="ac-panel-sub">Journal chronologique des ouvertures et clôtures X / Z.</p>
          </div>
          <span className="ac-panel-count">{shifts.length} session(s)</span>
        </div>
        <div className="ac-audit-table-wrap">
          <table className="ac-audit-table">
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
                <th style={{ textAlign: 'right' }}>Rapports</th>
              </tr>
            </thead>
            <tbody>
              {shifts.map((s) => (
                <tr key={s.id}>
                  <td><strong>#{s.id}</strong></td>
                  <td>{s.till_id}</td>
                  <td>{s.operator}</td>
                  <td>{String(s.opened_at).slice(0, 16).replace('T', ' ')}</td>
                  <td>{s.closed_at ? String(s.closed_at).slice(0, 16).replace('T', ' ') : '—'}</td>
                  <td>{fmtMoney(s.opening_float)}</td>
                  <td>{s.expected_amount == null ? '—' : fmtMoney(s.expected_amount)}</td>
                  <td>{s.counted_amount == null ? '—' : fmtMoney(s.counted_amount)}</td>
                  <td>{s.variance == null ? '—' : fmtMoney(s.variance)}</td>
                  <td>
                    <span className={`ac-status-pill ${s.status === 'open' ? 'is-ok' : 'is-dirty'}`}>
                      {s.status === 'open' ? 'Ouverte' : 'Clôturée'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="ac-ops-row-actions">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void selectShift(Number(s.id))}
                      >
                        Voir
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => openReportWindow(Number(s.id), 'x')}
                      >
                        X
                      </button>
                      {s.status === 'closed' && isOwnerOrAdmin && (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => openReportWindow(Number(s.id), 'z', true)}
                        >
                          Réimprimer Z
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {shifts.length === 0 && (
                <tr>
                  <td colSpan={11} className="muted">
                    {loading ? 'Chargement des sessions…' : 'Aucune session enregistrée.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
