import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, BASE } from '../api';
import { getToken } from '../auth';
import DatePicker from '../components/DatePicker';
import TimePicker from '../components/TimePicker';
import RefreshIconButton from '../components/RefreshIconButton';
import SaveFeedback from '../components/SaveFeedback';
import { getCachedFingerprint } from '../fingerprint';
import { openReport } from '../lib/reports';

type Row = {
  employee_id: number;
  emp_number?: string;
  name: string;
  role_title?: string;
  team?: string;
  work_date: string;
  check_in: string | null;
  check_out: string | null;
  status: string;
  note?: string;
  month_rate_pct: number | null;
  suggested_pay: number | null;
};

type Summary = { present: number; absent: number; late: number; excused: number; total: number };

function todayMA(): string {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Casablanca' });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

async function attFetch(path: string, init?: RequestInit) {
  const token = getToken() || '';
  const fp = await getCachedFingerprint();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : '',
      'X-Device-Fingerprint': fp || '',
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error || `Erreur ${res.status}`);
  return j;
}

function statusLabel(s: string) {
  const m: Record<string, string> = {
    present: 'Présent',
    late: 'Retard',
    half: 'Demi',
    excused: 'Excusé',
    absent: 'Absent',
  };
  return m[s] || s || '—';
}

export default function Attendance() {
  const [date, setDate] = useState(todayMA());
  const [rows, setRows] = useState<Row[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'success' | 'error'>('success');
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [teamFilter, setTeamFilter] = useState('all');
  const [selected, setSelected] = useState<number[]>([]);

  const [editId, setEditId] = useState<number | null>(null);
  const [editIn, setEditIn] = useState('');
  const [editOut, setEditOut] = useState('');
  const [editStatus, setEditStatus] = useState('present');
  const [editNote, setEditNote] = useState('');

  const [absentOpen, setAbsentOpen] = useState(false);
  const [exportFrom, setExportFrom] = useState(() => todayMA().slice(0, 8) + '01');
  const [exportTo, setExportTo] = useState(todayMA());
  const [exportOpen, setExportOpen] = useState(false);
  const [recordTarget, setRecordTarget] = useState<Row | null>(null);
  const [recordScope, setRecordScope] = useState<'cycle' | 'career'>('cycle');
  const [recordData, setRecordData] = useState<any>(null);
  const [recordLoading, setRecordLoading] = useState(false);

  const flash = (m: string, t: 'success' | 'error' = 'success') => {
    setMsg(m);
    setMsgType(t);
    setTimeout(() => setMsg(''), 4000);
  };

  const load = useCallback(async (soft = false) => {
    if (soft) setRefreshing(true);
    else setLoading(true);
    try {
      let on = false;
      try {
        const s: any = await api.getSettings();
        on = Number(s?.data?.attendance_enabled) === 1;
      } catch {
        on = false;
      }
      setEnabled(on);
      if (!on) {
        setRows([]);
        setSummary(null);
        setSelected([]);
        return;
      }
      const j = await attFetch(`/api/attendance?date=${encodeURIComponent(date)}`);
      setRows(j?.data?.rows || []);
      setSummary(j?.data?.summary || null);
      setSelected([]);
    } catch (e: any) {
      flash(e?.message || 'Chargement impossible', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  const teams = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => {
      if (r.team) s.add(r.team);
    });
    return Array.from(s).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (teamFilter !== 'all' && (r.team || '') !== teamFilter) return false;
      if (!q) return true;
      return (
        r.name.toLowerCase().includes(q) ||
        String(r.emp_number || '').toLowerCase().includes(q) ||
        String(r.role_title || '').toLowerCase().includes(q)
      );
    });
  }, [rows, search, statusFilter, teamFilter]);

  const allFilteredIds = filtered.map((r) => r.employee_id);
  const allChecked =
    allFilteredIds.length > 0 && allFilteredIds.every((id) => selected.includes(id));

  const toggleAll = () => {
    if (allChecked) {
      setSelected((prev) => prev.filter((id) => !allFilteredIds.includes(id)));
    } else {
      setSelected((prev) => Array.from(new Set([...prev, ...allFilteredIds])));
    }
  };

  const toggleOne = (id: number) => {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const checkIn = async (employee_id: number) => {
    setBusyId(employee_id);
    try {
      await attFetch('/api/attendance/check-in', {
        method: 'POST',
        body: JSON.stringify({ employee_id, date }),
      });
      flash('Entrée enregistrée');
      await load(true);
    } catch (e: any) {
      flash(e?.message || 'Erreur', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const checkOut = async (employee_id: number) => {
    setBusyId(employee_id);
    try {
      await attFetch('/api/attendance/check-out', {
        method: 'POST',
        body: JSON.stringify({ employee_id, date }),
      });
      flash('Sortie enregistrée');
      await load(true);
    } catch (e: any) {
      flash(e?.message || 'Erreur', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const loadRecord = async (r: Row, scope: 'cycle' | 'career') => {
    setRecordTarget(r);
    setRecordScope(scope);
    setRecordLoading(true);
    setRecordData(null);
    try {
      const { getToken } = await import('../auth');
      const { getApiBase } = await import('../config');
      const token = getToken() || '';
      const base = getApiBase();
      const res = await fetch(`${base}/api/attendance/record/${r.employee_id}?scope=${scope}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error || 'Erreur fiche');
      setRecordData(j?.data || null);
    } catch (e: any) {
      flash(e?.message || 'Impossible de charger la fiche', 'error');
      setRecordTarget(null);
    } finally {
      setRecordLoading(false);
    }
  };

  const openEdit = (r: Row) => {
    setEditId(r.employee_id);
    setEditIn(r.check_in || '');
    setEditOut(r.check_out || '');
    setEditStatus(r.status === 'absent' || r.status === 'excused' ? r.status : 'auto');
    setEditNote(r.note || '');
  };

  const saveEdit = async () => {
    if (editId == null) return;
    setBusyId(editId);
    try {
      const st = String(editStatus || '').toLowerCase();
      await attFetch('/api/attendance', {
        method: 'PUT',
        body: JSON.stringify({
          employee_id: editId,
          date,
          check_in: editIn || null,
          check_out: editOut || null,
          // absent/excused only forced; present/late/half computed from times (9–13 / 14–18 = demi)
          status: st === 'absent' || st === 'excused' ? st : undefined,
          force_status: st === 'absent' || st === 'excused',
          note: editNote,
        }),
      });
      flash('Pointage mis à jour');
      setEditId(null);
      await load(true);
    } catch (e: any) {
      flash(e?.message || 'Erreur', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const confirmBulkAbsent = async () => {
    try {
      for (const employee_id of selected) {
        await attFetch('/api/attendance', {
          method: 'PUT',
          body: JSON.stringify({
            employee_id,
            date,
            check_in: null,
            check_out: null,
            status: 'absent',
            note: 'Marqué absent',
          }),
        });
      }
      flash(`${selected.length} absence(s) enregistrée(s)`);
      setAbsentOpen(false);
      await load(true);
    } catch (e: any) {
      flash(e?.message || 'Erreur', 'error');
    }
  };

  const downloadCsv = async () => {
    const token = getToken() || '';
    const fp = await getCachedFingerprint();
    const url = `${BASE}/api/attendance/export?from=${encodeURIComponent(exportFrom)}&to=${encodeURIComponent(exportTo)}&format=csv`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'X-Device-Fingerprint': fp || '' },
    });
    if (!res.ok) {
      flash('Export CSV impossible', 'error');
      return;
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `presence_${exportFrom}_${exportTo}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    flash('CSV téléchargé');
    setExportOpen(false);
  };

  const openPdfReport = () => {
    openReport('/api/attendance/export', {
      from: exportFrom,
      to: exportTo,
      format: 'html',
    });
    setExportOpen(false);
  };

  if (enabled === null || (loading && enabled === null)) {
    return (
      <div className="atlas-crm attendance-page">
        <div className="page-header">
          <h1>Présence</h1>
        </div>
        <div className="ac-panel" style={{ padding: 24 }}>
          <p className="muted" style={{ margin: 0 }}>Chargement…</p>
        </div>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="atlas-crm attendance-page">
        <div className="page-header">
          <h1>Présence</h1>
        </div>
        <div className="ac-panel" style={{ padding: 24 }}>
          <p style={{ margin: '0 0 14px' }}>
            Le module présence est <strong>désactivé</strong> (réglage enregistré en base).
            Activez-le dans <strong>Paramètres → Présence</strong> pour charger le pointage.
          </p>
          <Link to="/settings?tab=attendance" className="btn" style={{ display: 'inline-flex' }}>
            Ouvrir les paramètres Présence
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="atlas-crm attendance-page">
      <div className="page-header">
        <h1>Présence / pointage</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ minWidth: 150 }}>
            <DatePicker value={date} onChange={setDate} />
          </div>
          <RefreshIconButton onClick={() => load(true)} loading={refreshing} />
          <button type="button" className="secondary" onClick={() => setExportOpen(true)}>
            Export CSV / PDF
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setAbsentOpen(true)}
            disabled={!selected.length}
          >
            Absents ({selected.length})
          </button>
          <Link
            to="/employees"
            style={{
              textDecoration: 'none',
              padding: '8px 14px',
              borderRadius: 999,
              background: 'var(--atlas-primary, #71717a)',
              color: '#fff',
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            Employés / paie
          </Link>
        </div>
      </div>
      <SaveFeedback message={msg} type={msgType} />

      {summary && (
        <div
          className="attendance-stats-row ac-metric-grid"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 10,
            marginBottom: 12,
          }}
        >
          {(
            [
              ['Présents', summary.present],
              ['Retards', summary.late],
              ['Absents', summary.absent],
              ['Effectif', summary.total],
            ] as const
          ).map(([l, v]) => (
            <div key={l} className="ac-metric">
              <div className="as-label">{l}</div>
              <div className="as-value">{v}</div>
            </div>
          ))}
        </div>
      )}

      <div className="ac-panel ac-products-filters">
        <div className="ac-products-filters-row">
          <div className="ac-search-field">
            <svg className="ac-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" strokeLinecap="round" />
            </svg>
            <input
              className="ac-search-input"
              placeholder="Rechercher…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Rechercher présence"
            />
          </div>
          <select className="ac-filter-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Statut">
            <option value="all">Tous statuts</option>
            <option value="present">Présent</option>
            <option value="late">Retard</option>
            <option value="half">Demi</option>
            <option value="excused">Excusé</option>
            <option value="absent">Absent</option>
          </select>
          <select className="ac-filter-select" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} aria-label="Équipe">
            <option value="all">Toutes équipes</option>
            {teams.map((tm) => (
              <option key={tm} value={tm}>{tm}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="ac-panel ac-products-table-panel" style={{ overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: 24 }}>Chargement…</div>
        ) : filtered.length === 0 ? (
          <div className="empty" style={{ padding: 24 }}>
            Aucun résultat.
          </div>
        ) : (
          <table className="data-dense ac-products-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    aria-label="Tout cocher"
                  />
                </th>
                <th>N°</th>
                <th>Nom</th>
                <th>Statut</th>
                <th>Entrée</th>
                <th>Sortie</th>
                <th>Taux</th>
                <th>Paie*</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.employee_id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.includes(r.employee_id)}
                      onChange={() => toggleOne(r.employee_id)}
                      aria-label={`Sélectionner ${r.name}`}
                    />
                  </td>
                  <td>{r.emp_number || '—'}</td>
                  <td>
                    <div>{r.name}</div>
                    <div className="muted" style={{ fontSize: 11 }}>
                      {r.role_title || ''}
                      {r.team ? ` · ${r.team}` : ''}
                    </div>
                  </td>
                  <td>{statusLabel(r.status)}</td>
                  <td>{r.check_in || '—'}</td>
                  <td>{r.check_out || '—'}</td>
                  <td>{r.month_rate_pct != null ? `${r.month_rate_pct} %` : '—'}</td>
                  <td>
                    <div>{`${Number(r.suggested_pay || 0).toLocaleString('fr-FR')} MAD`}</div>
                    {(r as any).period_from && (
                      <div className="muted" style={{ fontSize: 10 }}>
                        {String((r as any).period_from).slice(0, 10)}
                        {(r as any).accrued_days != null ? ` · ${(r as any).accrued_days} j` : ''}
                      </div>
                    )}
                    {Number((r as any).late_penalty || 0) > 0 && (
                      <div className="muted" style={{ fontSize: 10, color: 'var(--bad, #b91c1c)' }}>
                        −{(r as any).late_penalty} MAD retards
                      </div>
                    )}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="secondary"
                        disabled={!!r.check_in || busyId === r.employee_id}
                        onClick={() => checkIn(r.employee_id)}
                      >
                        Entrée
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={!r.check_in || !!r.check_out || busyId === r.employee_id}
                        onClick={() => checkOut(r.employee_id)}
                      >
                        Sortie
                      </button>
                      <button type="button" className="secondary" onClick={() => openEdit(r)}>
                        Modifier
                      </button>
                      <button type="button" className="secondary" onClick={() => void loadRecord(r, 'cycle')}>
                        Fiche
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>
        Cochez les lignes pour marquer absents en groupe. Export = plage de dates (CSV ou rapport).
      </p>

      {editId != null && (
        <div className="modal-backdrop" onClick={() => setEditId(null)} role="presentation">
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <h2 style={{ marginTop: 0 }}>Corriger le pointage</h2>
            <div className="form-row">
              <label>Entrée</label>
              <TimePicker value={editIn} onChange={setEditIn} placeholder="09:00" step={5} />
            </div>
            <div className="form-row">
              <label>Sortie</label>
              <TimePicker value={editOut} onChange={setEditOut} placeholder="18:00" step={5} />
            </div>
            <div className="form-row">
              <label>Statut (auto si heures saisies)</label>
              <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}>
                <option value="auto">Automatique (heures)</option>
                <option value="excused">Excusé (forcé)</option>
                <option value="absent">Absent (forcé)</option>
              </select>
              <span className="muted" style={{ fontSize: 11 }}>
                Après 09:15 → retard · 09:00–13:00 ou 14:00–18:00 → demi-journée
              </span>
            </div>
            <div className="form-row">
              <label>Note</label>
              <input value={editNote} onChange={(e) => setEditNote(e.target.value)} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="secondary" onClick={() => setEditId(null)}>
                Annuler
              </button>
              <button type="button" onClick={() => void saveEdit()}>
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}

      {absentOpen && (
        <div className="modal-backdrop" onClick={() => setAbsentOpen(false)} role="presentation">
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <h2 style={{ marginTop: 0 }}>Marquer absents</h2>
            <p>
              Marquer <strong>{selected.length}</strong> employé(s) coché(s) absents pour le {date} ?
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="secondary" onClick={() => setAbsentOpen(false)}>
                Annuler
              </button>
              <button type="button" onClick={() => void confirmBulkAbsent()}>
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}

      
      {recordTarget && (
        <div className="modal-backdrop" onClick={() => setRecordTarget(null)} role="presentation">
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 560, maxHeight: '90vh', overflow: 'auto' }}
          >
            <h2 style={{ marginTop: 0 }}>
              Fiche présence (cycle de paie) — {recordTarget.name}
            </h2>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                className={recordScope === 'cycle' ? '' : 'secondary'}
                onClick={() => void loadRecord(recordTarget, 'cycle')}
              >
                Cycle de paie
              </button>
              <button
                type="button"
                className={recordScope === 'career' ? '' : 'secondary'}
                onClick={() => void loadRecord(recordTarget, 'career')}
              >
                Toute la carrière
              </button>
            </div>
            {recordLoading && <p className="muted">Chargement…</p>}
            {recordData && (
              <>
                <p className="muted" style={{ fontSize: 13 }}>
                  {recordData.from} → {recordData.to} · {recordData.summary?.logged || 0} jour(s)
                </p>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                    gap: 8,
                    marginBottom: 12,
                  }}
                >
                  <div className="card" style={{ padding: 10 }}>
                    <div className="muted" style={{ fontSize: 11 }}>Présent</div>
                    <strong>{recordData.summary?.present ?? 0}</strong>
                  </div>
                  <div className="card" style={{ padding: 10 }}>
                    <div className="muted" style={{ fontSize: 11 }}>Retard</div>
                    <strong>{recordData.summary?.late ?? 0}</strong>
                  </div>
                  <div className="card" style={{ padding: 10 }}>
                    <div className="muted" style={{ fontSize: 11 }}>Absent</div>
                    <strong>{recordData.summary?.absent ?? 0}</strong>
                  </div>
                  <div className="card" style={{ padding: 10 }}>
                    <div className="muted" style={{ fontSize: 11 }}>Taux</div>
                    <strong>{recordData.summary?.rate_pct ?? 0}%</strong>
                  </div>
                  <div className="card" style={{ padding: 10 }}>
                    <div className="muted" style={{ fontSize: 11 }}>% retard</div>
                    <strong>{recordData.summary?.late_pct ?? 0}%</strong>
                  </div>
                  <div className="card" style={{ padding: 10 }}>
                    <div className="muted" style={{ fontSize: 11 }}>Paie suggérée</div>
                    <strong>
                      {recordData.summary?.net_suggested ?? 0} MAD
                    </strong>
                  </div>
                  <div className="card" style={{ padding: 10 }}>
                    <div className="muted" style={{ fontSize: 11 }}>Discipline</div>
                    <strong>
                      {recordData.summary?.discipline_hint === 'blame'
                        ? 'Blâme'
                        : recordData.summary?.discipline_hint === 'avertissement'
                          ? 'Avertissement'
                          : '—'}
                    </strong>
                  </div>
                </div>
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>
                  Paie = jours travaillés × {recordData.summary?.daily_rate ?? 0} MAD/j.
                  {recordData.rules?.minute_deduct
                    ? ` Minutes de retard retenues: ${recordData.summary?.late_minutes ?? 0} min (−${recordData.summary?.late_penalty ?? 0} MAD).`
                    : ' Aucune retenue automatique sur les retards.'}
                  {' '}
                  Seuils discipline: avertissement à {recordData.rules?.warn_late_count ?? 3} retards, blâme à{' '}
                  {recordData.rules?.blame_late_count ?? 6}.
                </p>
                <table className="data-dense ac-products-table" style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Statut</th>
                      <th>Entrée</th>
                      <th>Sortie</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(recordData.days || []).map((d: any) => (
                      <tr key={d.work_date}>
                        <td>{d.work_date}</td>
                        <td>{d.status}</td>
                        <td>{d.check_in || '—'}</td>
                        <td>{d.check_out || '—'}</td>
                      </tr>
                    ))}
                    {!(recordData.days || []).length && (
                      <tr>
                        <td colSpan={4}>Aucun pointage</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </>
            )}
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <button type="button" className="secondary" onClick={() => setRecordTarget(null)}>
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

{exportOpen && (
        <div className="modal-backdrop" onClick={() => setExportOpen(false)} role="presentation">
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <h2 style={{ marginTop: 0 }}>Export présence</h2>
            <div className="form-row">
              <label>Du</label>
              <DatePicker value={exportFrom} onChange={setExportFrom} />
            </div>
            <div className="form-row">
              <label>Au</label>
              <DatePicker value={exportTo} onChange={setExportTo} />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap', marginTop: 12 }}>
              <button type="button" className="secondary" onClick={() => setExportOpen(false)}>
                Annuler
              </button>
              <button type="button" className="secondary" onClick={() => void downloadCsv()}>
                CSV
              </button>
              <button type="button" onClick={openPdfReport}>
                Rapport PDF
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @media (max-width: 640px) {
          .attendance-stats-row { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
      `}</style>
    </div>
  );
}
