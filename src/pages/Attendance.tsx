import TopPageActions from '../components/TopPageActions';
import { Clock, Download, FileText, LogIn, LogOut, Pencil, QrCode, Settings, Smartphone, Users, UserX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, BASE } from '../api';
import { getToken } from '../auth';
import DatePicker from '../components/DatePicker';
import TimePicker from '../components/TimePicker';
import RefreshIconButton from '../components/RefreshIconButton';
import SaveFeedback from '../components/SaveFeedback';
import PageSkeleton from '../components/PageSkeleton';
import { getCachedFingerprint } from '../fingerprint';
import { openReport } from '../lib/reports';
import ListPager from '../components/ui/ListPager';

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
  worked_hours?: number;
  overtime_hours?: number;
  is_late?: boolean;
  is_early_leave?: boolean;
  early_minutes?: number;
  source?: string;
  badge_code?: string;
};

function sourceLabel(s?: string) {
  if (s === 'badge') return 'Badge';
  if (s === 'mobile') return 'Mobile';
  return 'Manuel';
}

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
  const j = (await res.json().catch(() => ({}))) as { error?: string; data?: any };
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
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;
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

  // Part 3 — badge input, monthly recap view, employee & month filters
  const [viewMode, setViewMode] = useState<'daily' | 'monthly'>('daily');
  const [badgeInput, setBadgeInput] = useState('');
  const [badgeBusy, setBadgeBusy] = useState(false);
  const [badgeBanner, setBadgeBanner] = useState<string | null>(null);
  const [monthFilter, setMonthFilter] = useState(() => todayMA().slice(0, 7));
  const [employeeFilter, setEmployeeFilter] = useState<string>('all');
  const [monthlyData, setMonthlyData] = useState<{ recap: any[]; entries: any[]; rules?: any } | null>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [attRules, setAttRules] = useState<any>(null);

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
      setAttRules(j?.data?.rules || null);
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

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const allFilteredIds = paged.map((r) => r.employee_id);
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

  const loadMonthly = useCallback(async () => {
    if (!enabled) return;
    setMonthlyLoading(true);
    try {
      const empId = employeeFilter !== 'all' ? Number(employeeFilter) : undefined;
      const res = await api.getMonthlyAttendance({ month: monthFilter, employee_id: empId });
      setMonthlyData(res.data || { recap: [], entries: [] });
    } catch (e: any) {
      flash(e?.message || 'Impossible de charger le récapitulatif mensuel', 'error');
    } finally {
      setMonthlyLoading(false);
    }
  }, [enabled, monthFilter, employeeFilter]);

  useEffect(() => {
    if (viewMode === 'monthly' && enabled) {
      void loadMonthly();
    }
  }, [viewMode, enabled, loadMonthly]);

  const handleBadgeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = badgeInput.trim();
    if (!code) return;
    setBadgeBusy(true);
    setBadgeBanner(null);
    try {
      const res = await api.attendanceBadgeCheck({ badge_code: code, date });
      const d = res.data;
      setBadgeInput('');
      const label =
        d.action === 'in'
          ? `Entrée badge enregistrée : ${d.name} (${d.check_in})`
          : d.action === 'out'
            ? `Sortie badge enregistrée : ${d.name} (${d.check_out} · ${d.worked_hours ?? 0} h)`
            : `${d.name} déjà pointé entrée/sortie aujourd’hui`;
      setBadgeBanner(label);
      flash(label);
      await load(true);
      if (viewMode === 'monthly') await loadMonthly();
    } catch (err: any) {
      flash(err?.message || 'Badge introuvable', 'error');
    } finally {
      setBadgeBusy(false);
    }
  };

  const handleMobileSelfCheck = async (employee_id: number, action: 'in' | 'out') => {
    setBusyId(employee_id);
    try {
      await api.attendanceSelfCheck({ employee_id, action, source: 'mobile' });
      flash(action === 'in' ? 'Entrée mobile enregistrée' : 'Sortie mobile enregistrée');
      await load(true);
    } catch (e: any) {
      flash(e?.message || 'Erreur pointage mobile', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const downloadMonthlyCsv = async () => {
    const token = getToken() || '';
    const fp = await getCachedFingerprint();
    const q = new URLSearchParams({ month: monthFilter, format: 'csv' });
    if (employeeFilter !== 'all') q.set('employee_id', employeeFilter);
    const url = `${BASE}/api/attendance/export?${q.toString()}`;
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
    a.download = `presence_${monthFilter}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    flash('CSV mensuel téléchargé');
  };

  const enableAttendanceNow = async () => {
    try {
      await api.updateSettings({ attendance_enabled: 1 });
      flash('Module Présence activé');
      await load();
    } catch (e: any) {
      flash(e?.message || 'Impossible d’activer le module', 'error');
    }
  };

  const checkIn = async (employee_id: number) => {
    setBusyId(employee_id);
    try {
      await attFetch('/api/attendance/check-in', {
        method: 'POST',
        body: JSON.stringify({ employee_id, date, source: 'manual' }),
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
      const j = (await res.json().catch(() => null)) as { error?: string; data?: any } | null;
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
        <div className="page-header dock-page-header">
          <h1 className="sr-only">Présence</h1>
        </div>
        <PageSkeleton variant="list" />
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="atlas-crm attendance-page">
        <div className="page-header dock-page-header">
          <h1 className="sr-only">Présence</h1>
        </div>
        <section className="ac-panel ac-disabled-module-card" aria-label="Module Présence désactivé">
          <div className="ac-disabled-module-body">
            <div className="ac-disabled-module-icon" aria-hidden="true">
              <Clock size={22} strokeWidth={1.9} />
            </div>
            <div className="ac-disabled-module-copy">
              <span className="ac-disabled-module-badge">Module inactif</span>
              <h2 className="ac-disabled-module-title">Module Présence désactivé</h2>
              <p className="ac-disabled-module-desc">
                Le module présence est <strong>désactivé</strong> (réglage enregistré en base).
                Activez-le dans <strong>Paramètres → Présence</strong> pour charger et enregistrer le pointage de l’équipe.
              </p>
            </div>
          </div>
          <div className="ac-disabled-module-actions">
            <button type="button" className="btn ac-disabled-module-cta" onClick={() => void enableAttendanceNow()}>
              <Clock size={15} aria-hidden="true" />
              <span>Activer maintenant</span>
            </button>
            <Link to="/settings?tab=attendance" className="btn secondary ac-disabled-module-cta">
              <Settings size={15} aria-hidden="true" />
              <span>Ouvrir les paramètres Présence</span>
            </Link>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="atlas-crm attendance-page">
      <div className="page-header dock-page-header">
        <h1 className="sr-only">Présence / pointage</h1>
        <TopPageActions>
          <div className="tpa-date-wrap" style={{ minWidth: 150 }}>
            <DatePicker value={date} onChange={setDate} />
          </div>
          <RefreshIconButton onClick={() => load(true)} loading={refreshing} />
          <button type="button" className="secondary" onClick={() => setExportOpen(true)} title="Export CSV / PDF">
            <Download size={16} aria-hidden="true" />
            <span className="tpa-label">Export CSV / PDF</span>
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => setAbsentOpen(true)}
            disabled={!selected.length}
            title={`Absents (${selected.length})`}
          >
            <UserX size={16} aria-hidden="true" />
            <span className="tpa-label">Absents ({selected.length})</span>
          </button>
          <Link
            to="/employees"
            title="Employés / paie"
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
            <Users size={16} aria-hidden="true" />
            <span className="tpa-label">Employés / paie</span>
          </Link>
        </TopPageActions>
      </div>
      <SaveFeedback message={msg} type={msgType} />

      {/* Onglets vue journalière / récapitulatif mensuel + lecteur badge */}
      <div className="ac-panel" style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={viewMode === 'daily' ? '' : 'secondary'}
            onClick={() => setViewMode('daily')}
          >
            Pointage du jour
          </button>
          <button
            type="button"
            className={viewMode === 'monthly' ? '' : 'secondary'}
            onClick={() => setViewMode('monthly')}
          >
            Récapitulatif mensuel
          </button>
        </div>
        <form onSubmit={handleBadgeSubmit} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <QrCode size={16} aria-hidden="true" />
          <input
            value={badgeInput}
            onChange={(e) => setBadgeInput(e.target.value)}
            placeholder="Scanner ou saisir code badge / N°"
            aria-label="Code badge ou numéro employé"
            style={{ minWidth: 220 }}
          />
          <button type="submit" disabled={badgeBusy || !badgeInput.trim()}>
            {badgeBusy ? 'Pointage…' : 'Pointer badge'}
          </button>
        </form>
      </div>

      {badgeBanner && (
        <div className="ac-panel" style={{ marginBottom: 12, padding: '10px 14px', fontWeight: 600 }}>
          {badgeBanner}
        </div>
      )}

      {attRules && (
        <p className="muted" style={{ fontSize: 12, margin: '0 0 10px' }}>
          Règles actives : retard après {attRules.late_threshold} · départ anticipé avant {attRules.early_threshold || '18:00'} · heures sup. au-delà de {attRules.overtime_after_hours ?? attRules.workday_hours} h/j (×{attRules.overtime_multiplier ?? 1.25}).
        </p>
      )}

      {viewMode === 'monthly' ? (
        <div className="ac-panel" style={{ overflow: 'auto' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>Mois</span>
                <input
                  type="month"
                  value={monthFilter}
                  onChange={(e) => setMonthFilter(e.target.value)}
                  aria-label="Filtrer par mois"
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>Employé</span>
                <select
                  className="ac-filter-select"
                  value={employeeFilter}
                  onChange={(e) => setEmployeeFilter(e.target.value)}
                  aria-label="Filtrer par employé"
                >
                  <option value="all">Tous les employés</option>
                  {rows.map((r) => (
                    <option key={r.employee_id} value={String(r.employee_id)}>
                      {r.name} {r.emp_number ? `(${r.emp_number})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="secondary" onClick={() => void loadMonthly()}>
                Actualiser
              </button>
              <button type="button" onClick={() => void downloadMonthlyCsv()}>
                <Download size={14} aria-hidden="true" />
                <span>Export CSV ({monthFilter})</span>
              </button>
            </div>
          </div>

          {monthlyLoading ? (
            <PageSkeleton variant="list" />
          ) : (
            <>
              <h3 style={{ marginTop: 4 }}>Récapitulatif par employé — {monthFilter}</h3>
              <table className="data-dense ac-products-table" style={{ marginBottom: 18 }}>
                <thead>
                  <tr>
                    <th>N°</th>
                    <th>Employé</th>
                    <th>Jours travaillés</th>
                    <th>Heures</th>
                    <th>Heures sup.</th>
                    <th>Retards</th>
                    <th>Départs anticipés</th>
                    <th>Absences</th>
                  </tr>
                </thead>
                <tbody>
                  {(monthlyData?.recap || []).map((rec: any) => (
                    <tr key={rec.employee_id}>
                      <td>{rec.emp_number || '—'}</td>
                      <td>{rec.name}</td>
                      <td>{rec.worked_days} j ({rec.days_logged} pointés)</td>
                      <td>{rec.worked_hours} h</td>
                      <td>{rec.overtime_hours > 0 ? `${rec.overtime_hours} h` : '—'}</td>
                      <td>{rec.late_days} ({rec.late_minutes} min)</td>
                      <td>{rec.early_leave_days} ({rec.early_minutes} min)</td>
                      <td>{rec.absent_days}</td>
                    </tr>
                  ))}
                  {!(monthlyData?.recap || []).length && (
                    <tr>
                      <td colSpan={8} className="muted">Aucune donnée pour ce mois.</td>
                    </tr>
                  )}
                </tbody>
              </table>

              <h3>Détail journalier ({(monthlyData?.entries || []).length} pointage(s))</h3>
              <table className="data-dense ac-products-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Employé</th>
                    <th>Entrée</th>
                    <th>Sortie</th>
                    <th>Heures</th>
                    <th>H. sup.</th>
                    <th>Statut & alertes</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {(monthlyData?.entries || []).map((en: any) => (
                    <tr key={`${en.employee_id}-${en.work_date}`}>
                      <td>{en.work_date}</td>
                      <td>{en.name}</td>
                      <td>{en.check_in || '—'}</td>
                      <td>{en.check_out || '—'}</td>
                      <td>{en.worked_hours} h</td>
                      <td>{en.overtime_hours > 0 ? `${en.overtime_hours} h` : '—'}</td>
                      <td>
                        {statusLabel(en.status)}
                        {en.is_early_leave ? ' · Départ anticipé' : ''}
                      </td>
                      <td>{sourceLabel(en.source)}</td>
                    </tr>
                  ))}
                  {!(monthlyData?.entries || []).length && (
                    <tr>
                      <td colSpan={8} className="muted">Aucun pointage sur la période.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </>
          )}
        </div>
      ) : (
        <>

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
        <div className="ac-table-pager-bar">
          <span className="ac-table-pager-meta">{filtered.length} employé{filtered.length === 1 ? '' : 's'} · 20 par page</span>
          <ListPager page={safePage} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />
        </div>
        {loading ? (
          <div style={{ padding: 20, display: 'grid', gap: 10 }} aria-busy="true" aria-label="Chargement des pointages">
            <div className="skeleton" style={{ height: 38, borderRadius: 10 }} />
            <div className="skeleton" style={{ height: 48, borderRadius: 10 }} />
            <div className="skeleton" style={{ height: 48, borderRadius: 10 }} />
            <div className="skeleton" style={{ height: 48, borderRadius: 10 }} />
          </div>
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
                <th>Heures</th>
                <th>Source</th>
                <th>Taux</th>
                <th>Paie*</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((r) => (
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
                  <td>
                    <div>{statusLabel(r.status)}</div>
                    {r.is_early_leave && (
                      <div className="muted" style={{ fontSize: 10, color: 'var(--warn, #b45309)' }}>
                        Départ anticipé ({r.early_minutes} min)
                      </div>
                    )}
                  </td>
                  <td>{r.check_in || '—'}</td>
                  <td>{r.check_out || '—'}</td>
                  <td>
                    <div>{r.worked_hours ? `${r.worked_hours} h` : '—'}</div>
                    {Number(r.overtime_hours || 0) > 0 && (
                      <div className="muted" style={{ fontSize: 10 }}>
                        +{r.overtime_hours} h sup.
                      </div>
                    )}
                  </td>
                  <td>{r.check_in || r.check_out ? sourceLabel(r.source) : '—'}</td>
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
                  <td className="row-actions-cell">
                    <div className="row-actions">
                      <button
                        type="button"
                        className="secondary"
                        disabled={!!r.check_in || busyId === r.employee_id}
                        onClick={() => checkIn(r.employee_id)}
                      >
                        <LogIn size={14} aria-hidden="true" />
                        <span>Entrée</span>
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={!r.check_in || !!r.check_out || busyId === r.employee_id}
                        onClick={() => checkOut(r.employee_id)}
                      >
                        <LogOut size={14} aria-hidden="true" />
                        <span>Sortie</span>
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={!!r.check_out || busyId === r.employee_id}
                        title="Pointage mobile (Entrée / Sortie)"
                        onClick={() => void handleMobileSelfCheck(r.employee_id, r.check_in ? 'out' : 'in')}
                      >
                        <Smartphone size={14} aria-hidden="true" />
                        <span>Mobile</span>
                      </button>
                      <button type="button" className="secondary" onClick={() => openEdit(r)}>
                        <Pencil size={14} aria-hidden="true" />
                        <span>Modifier</span>
                      </button>
                      <button type="button" className="secondary" onClick={() => void loadRecord(r, 'cycle')}>
                        <FileText size={14} aria-hidden="true" />
                        <span>Fiche</span>
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
        </>
      )}

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
            {recordLoading && (
              <div style={{ display: 'grid', gap: 8, margin: '8px 0 12px' }} aria-busy="true" aria-label="Chargement de l'historique">
                <div className="skeleton" style={{ height: 14, width: '45%' }} />
                <div className="skeleton" style={{ height: 64, borderRadius: 12 }} />
                <div className="skeleton" style={{ height: 96, borderRadius: 12 }} />
              </div>
            )}
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
