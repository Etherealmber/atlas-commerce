import { TimedUndoDelete } from '../components/ui';
import { onAgentDraft } from '../lib/agentDraft';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { getToken } from '../auth';
import { openReport, openPrintDoc } from '../lib/reports';
import RefreshIconButton from '../components/RefreshIconButton';
import NumberField from '../components/NumberField';
import SaveFeedback from '../components/SaveFeedback';
import DatePicker from '../components/DatePicker';
import PasswordConfirm from '../components/PasswordConfirm';
import { FloatingPortal } from '../components/FloatingPortal';
import { ModalFormError, FieldHint } from '../components/ModalFormFeedback';

type Emp = Record<string, any>;

const emptyForm = {
  emp_number: '',
  first_name: '',
  last_name: '',
  name: '',
  phone: '',
  email: '',
  role_title: '',
  department: '',
  category: '',
  employment_status: '',
  joined_date: '',
  date_of_birth: '',
  gender: '',
  nationality: 'Marocaine',
  marital_status: '',
  immigration_status: '',
  national_id: '',
  tax_id: '',
  social_insurance: '',
  health_insurance: '',
  driving_license: '',
  address: '',
  city: '',
  country: '',
  postal_code: '',
  home_phone: '',
  work_phone: '',
  pay_amount: 0,
  pay_cycle_type: 'monthly' as 'monthly' | 'days',
  pay_cycle_days: 7,
  contract_type: 'CDI',
  trial_days: 90,
  weekly_hours: 44,
  job_description: '',
  rib: '',
  cnss_number: '',
  notes: '',
  // v256 — compte de connexion lié (permet à l'employé de voir SA date de paie)
  user_username: '',
};

const STEPS = [
  { id: 'personal', label: 'Personnel' },
  { id: 'identity', label: 'Identification' },
  { id: 'work', label: 'Travail' },
  { id: 'contact', label: 'Contact' },
  { id: 'pay', label: 'Salaire & pièce' },
] as const;

function fmt(n: number) {
  return `${Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} MAD`;
}

function cycleLabel(e: Emp) {
  if (e.pay_cycle_type === 'days') {
    const d = Number(e.pay_cycle_days || 7);
    return `Tous les ${d} jour${d > 1 ? 's' : ''}`;
  }
  return 'Mensuel';
}

function empName(e: Emp): string {
  // v0.7.4 — le nom complet (prénom + nom de famille) fait foi partout dans l'UI.
  return `${e.first_name || ''} ${e.last_name || ''}`.trim() || String(e.display_name || '') || String(e.name || '') || '—';
}

/** v0.7.4 — libellé compact pour les listes denses : nom complet, ou prénom + initiale(s) du nom de famille si trop long. */
function empShort(e: Emp, max = 22): string {
  const full = empName(e);
  if (full.length <= max) return full;
  const first = String(e.first_name || '').trim() || String(full).split(' ')[0];
  const rest = String(full).split(/\s+/).filter((w: string) => w && w !== first);
  const initials = rest.map((w: string) => `${w[0].toUpperCase()}.`).join('');
  return initials ? `${first} ${initials}` : `${full.slice(0, max - 1)}…`;
}

export default function Employees() {
  const [deleteArmId, setDeleteArmId] = useState<string | number | null>(null);
  const [list, setList] = useState<Emp[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'resigned' | 'all'>('active');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [step, setStep] = useState(0);
  const [editing, setEditing] = useState<Emp | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  // v0.7.4 — « Autre nationalité » explicite : plus de confusion avec une valeur vide.
  const [natOther, setNatOther] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'success' | 'error'>('success');
  const [modalError, setModalError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [payTarget, setPayTarget] = useState<Emp | null>(null);
  const [payAmount, setPayAmount] = useState(0);
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payNote, setPayNote] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [payBusy, setPayBusy] = useState(false);
  const [advanceWarn, setAdvanceWarn] = useState<Emp | null>(null);
  const [plafondWarn, setPlafondWarn] = useState<Emp | null>(null);
  const [advanceTarget, setAdvanceTarget] = useState<Emp | null>(null);
  const [advanceAmount, setAdvanceAmount] = useState(0);
  const [advanceNote, setAdvanceNote] = useState('');
  const [advanceBusy, setAdvanceBusy] = useState(false);
  const [detail, setDetail] = useState<Emp | null>(null);
  const [idFile, setIdFile] = useState<File | null>(null);
  const [idUploading, setIdUploading] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwTitle, setPwTitle] = useState('');
  const [pwDesc, setPwDesc] = useState('');
  const [pwMode, setPwMode] = useState<'resign' | 'delete'>('resign');
  const [resignSettle, setResignSettle] = useState(true);
  const [resignAmount, setResignAmount] = useState(0);
  const [resignReason, setResignReason] = useState('Démission');
  const [resignNote, setResignNote] = useState('');
  const [resignCycleType, setResignCycleType] = useState<'monthly' | 'days'>('monthly');
  const [resignCycleDays, setResignCycleDays] = useState(30);
  const [resignPayRef, setResignPayRef] = useState(0);
  const [pendingDelete, setPendingDelete] = useState<Emp | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewFields, setReviewFields] = useState<Record<string, string>>({});
  const [reviewMsg, setReviewMsg] = useState('');

  const flash = (m: string, type: 'success' | 'error' = 'success') => {
    setMsg(m);
    setMsgType(type);
    setTimeout(() => setMsg(''), 4000);
  };

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const load = (soft = false) => {
    if (soft) setRefreshing(true);
    else setLoading(true);
    api
      .getEmployees({ status: statusFilter, q: debouncedQ, category: categoryFilter || undefined })
      .then((r) => {
        setList(r.data || []);
        if (Array.isArray((r as any).categories)) setCategories((r as any).categories);
      })
      .catch((e: any) => flash(e?.message || 'Chargement impossible', 'error'))
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  };

  useEffect(() => {
    load();
  }, [debouncedQ, statusFilter, categoryFilter]);

  
  useEffect(() => {
    return onAgentDraft((d) => {
      if (d.entity && d.entity !== 'employee') return;
      setModalError('');
      setShowModal(true);
    });
  }, []);

  useEffect(() => {
    const onLists = () => load(true);
    window.addEventListener('atlas-lists-refresh', onLists as EventListener);
    return () => window.removeEventListener('atlas-lists-refresh', onLists as EventListener);
  }, [debouncedQ, statusFilter, categoryFilter]);

  const setF = (k: string, v: any) => setForm((prev) => ({ ...prev, [k]: v }));

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setNatOther(false);
    setStep(0);
    setIdFile(null);
    setModalError(''); setFieldErrors({}); setShowModal(true);
  };

  const openEdit = (e: Emp) => {
    setEditing(e);
    setForm({
      ...emptyForm,
      emp_number: e.emp_number || '',
      first_name: e.first_name || '',
      last_name: e.last_name || '',
      name: e.name || '',
      phone: e.phone || '',
      email: e.email || '',
      role_title: e.role_title || '',
      department: e.department || '',
      category: e.category || '',
      employment_status: e.employment_status || '',
      joined_date: e.joined_date || '',
      date_of_birth: e.date_of_birth || '',
      gender: e.gender || '',
      nationality: e.nationality || '',
      marital_status: e.marital_status || '',
      immigration_status: e.immigration_status || '',
      national_id: e.national_id || '',
      tax_id: e.tax_id || '',
      social_insurance: e.social_insurance || '',
      health_insurance: e.health_insurance || '',
      driving_license: e.driving_license || '',
      address: e.address || '',
      city: e.city || '',
      country: e.country || '',
      postal_code: e.postal_code || '',
      home_phone: e.home_phone || '',
      work_phone: e.work_phone || '',
      pay_amount: Number(e.pay_amount || 0),
      pay_cycle_type: e.pay_cycle_type === 'days' ? 'days' : 'monthly',
      pay_cycle_days: Number(e.pay_cycle_days || 7),
      contract_type: e.contract_type || 'CDI',
      trial_days: Number(e.trial_days || 90),
      weekly_hours: Number(e.weekly_hours || 44),
      job_description: e.job_description || '',
      rib: e.rib || '',
      cnss_number: e.cnss_number || e.social_insurance || '',
      notes: e.notes || '',
      user_username: e.user_username || '',
    });
    setNatOther(!!(e.nationality && e.nationality !== 'Marocaine'));
    setStep(0);
    setIdFile(null);
    setModalError(''); setFieldErrors({}); setShowModal(true);
  };

  const fileToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(new Error('Lecture fichier'));
      r.readAsDataURL(file);
    });

  const save = async () => {
    // v0.7.4 — plus de « nom affiché » : le nom complet (prénom + nom de famille) est enregistré tel quel.
    const name = `${form.first_name} ${form.last_name}`.trim();
    const fe: Record<string, string> = {};
    if (!name) fe.name = 'Indiquez le prénom ou le nom de famille.';
    if (form.base_salary !== '' && form.base_salary != null && Number.isNaN(Number(form.base_salary))) {
      fe.base_salary = 'Chiffres uniquement pour le salaire.';
    }
    setFieldErrors(fe);
    if (Object.keys(fe).length) {
      setModalError(Object.values(fe)[0]);
      setStep(0);
      return;
    }
    setModalError('');
    setSaving(true);
    try {
      const body = {
        ...form,
        name,
        pay_cycle_days: form.pay_cycle_type === 'monthly' ? 30 : Number(form.pay_cycle_days || 7),
        contract_type: form.contract_type || 'CDI',
        trial_days: Number(form.trial_days || 0),
        weekly_hours: Number(form.weekly_hours || 44),
        job_description: form.job_description || '',
        rib: form.rib || '',
        cnss_number: form.cnss_number || form.social_insurance || '',
        social_insurance: form.cnss_number || form.social_insurance || '',
        user_username: (form.user_username || '').trim().toLowerCase(),
      };
      let id = editing?.id;
      if (editing) {
        await api.updateEmployee(editing.id, body);
        flash('Employé mis à jour');
      } else {
        const r: any = await api.createEmployee(body);
        id = r?.data?.id;
        flash(r?.message || 'Employé ajouté');
        const newId = Number(r?.data?.id || r?.id || 0);
        if (newId) {
          try {
            openPrintDoc(`/api/employees/${newId}/form/print`);
          } catch { /* */ }
        }
      }
      if (id && idFile) {
        setIdUploading(true);
        const data_url = await fileToDataUrl(idFile);
        await api.uploadEmployeeIdDoc(Number(id), {
          data_url,
          file_name: idFile.name,
          mime: idFile.type,
        });
      }
      setShowModal(false);
      load(true);
    } catch (e: any) {
      setModalError(e?.message || 'Enregistrement impossible');
    } finally {
      setSaving(false);
      setIdUploading(false);
    }
  };


  const advanceTierLabel = (tier?: string) => {
    const m: Record<string, string> = {
      short: 'Cycle court',
      w1: '1re semaine',
      w1_early: '1re semaine (début de cycle)',
      w2: '2e semaine',
      w3: '3e semaine',
      w3_proof: '3e semaine (justificatif)',
      w4_proof: '4e semaine (justificatif)',
      none: '—',
    };
    return m[String(tier || '')] || String(tier || '—');
  };

  const openAdvanceForm = (e: Emp, opts?: { forceHalfCap?: boolean }) => {
    const salary = Number(e.pay_amount || 0);
    const half = Number((e as any).half_cycle_cap ?? salary * 0.5);
    const already = Number(e.advances_in_period || 0);
    const hardLeft = Math.max(0, Math.round((half - already) * 100) / 100);
    if (hardLeft <= 0) {
      setAdvanceWarn(null);
      setPlafondWarn(e);
      return;
    }
    // Default amount in the popup = 5% of cycle salary (capped by what remains under 50%)
    const fivePct = Math.round(salary * 0.05 * 100) / 100;
    const suggest = Math.min(fivePct > 0 ? fivePct : hardLeft, hardLeft);
    setPlafondWarn(null);
    setAdvanceTarget(e);
    setAdvanceAmount(suggest);
    setAdvanceNote('');
    setAdvanceWarn(null);
  };

  const openAdvance = (e: Emp) => {
    if (!e.pay_amount && !e.can_advance) {
      flash('Acompte impossible : configurez le salaire de l’employé.', 'error');
      return;
    }
    const progress = Number(e.cycle_progress ?? 0);
    const meets = (e as any).meets_cycle_gate === true || progress >= 0.25;
    if (!meets) {
      setAdvanceWarn(e);
      return;
    }
    openAdvanceForm(e);
  };

  const confirmAdvance = async () => {
    if (!advanceTarget) return;
    setAdvanceBusy(true);
    try {
      const r: any = await api.advanceEmployee(advanceTarget.id, {
        amount: advanceAmount,
        note: advanceNote,
        payment_method: 'cash',
      });
      flash(r.message || 'Acompte enregistré');
      setAdvanceTarget(null);
      // Patch list immediately then full reload for totals
      if (r?.data?.id != null) {
        setEmployees((prev: Emp[]) =>
          prev.map((x) =>
            x.id === r.data.id
              ? {
                  ...x,
                  ...r.data,
                  suggested_pay: r.data.suggested_pay,
                  advances_in_period: r.data.advances_in_period,
                  max_advance: r.data.max_advance,
                  gross_accrued: r.data.gross_accrued,
                }
              : x,
          ),
        );
      }
      await load(true);
      try {
        window.dispatchEvent(new CustomEvent('atlas-lists-refresh', { detail: { source: 'employee-advance' } }));
      } catch { /* */ }
    } catch (e: any) {
      flash(e?.message || 'Acompte impossible', 'error');
    } finally {
      setAdvanceBusy(false);
    }
  };

  const openPay = (e: Emp) => {
    setPayTarget(e);
    // Accrued since last payment (resets after each pay)
    const suggested = Number(e.suggested_pay ?? e.pay_amount ?? 0);
    setPayAmount(suggested > 0 ? suggested : Number(e.pay_amount || 0));
    setPayDate(new Date().toISOString().slice(0, 10));
    const from = e.period_from ? String(e.period_from).slice(0, 10) : '';
    const days = e.accrued_days != null ? Number(e.accrued_days) : 0;
    setPayNote(
      from
        ? `Période ${from} → aujourd'hui (${days} j · cycle ${e.cycle_days || 30} j)`
        : '',
    );
    setPayMethod('cash');
  };

  const confirmPay = async () => {
    if (!payTarget) return;
    if (payAmount <= 0) {
      flash('Montant invalide', 'error');
      return;
    }
    setPayBusy(true);
    try {
      const r: any = await api.payEmployee(payTarget.id, {
        amount: payAmount,
        paid_at: payDate,
        note: payNote,
        payment_method: payMethod,
      });
      flash(r.message || 'Paiement enregistré');
      setPayTarget(null);
      load(true);
    } catch (e: any) {
      flash(e?.message || 'Paiement impossible', 'error');
    } finally {
      setPayBusy(false);
    }
  };

  const openResign = (e: Emp) => {
    setPendingDelete(e);
    setPwMode('resign');
    setPwTitle(`Démission — ${empName(e)}`);
    setPwDesc('Réglez le solde des jours travaillés si besoin, puis confirmez la démission.');
    setResignSettle(true);
    setResignAmount(Number(e.suggested_pay || 0));
    setResignReason(String(e.employment_status || 'Démission') || 'Démission');
    setResignNote('');
    setResignCycleType(e.pay_cycle_type === 'days' ? 'days' : 'monthly');
    setResignCycleDays(Number(e.pay_cycle_days || (e.pay_cycle_type === 'days' ? 7 : 30)));
    setResignPayRef(Number(e.pay_amount || 0));
    setPwOpen(true);
  };

  const openDelete = (target: Emp | number | number[]) => {
    // TimedUndo sometimes passed [id] by mistake — resolve to Emp
    let emp: Emp | undefined;
    if (Array.isArray(target)) {
      const id = Number(target[0]);
      emp = list.find((x) => Number(x.id) === id) || (detail && Number(detail.id) === id ? detail : undefined);
    } else if (typeof target === 'number') {
      emp = list.find((x) => Number(x.id) === target) || (detail && Number(detail.id) === target ? detail : undefined);
    } else {
      emp = target;
    }
    if (!emp) {
      flash('Employé introuvable.', 'error');
      return;
    }
    const inactive =
      Boolean((emp as any).is_resigned) ||
      Number((emp as any).active) === 0 ||
      String((emp as any).employment_status || '').toLowerCase().includes('démission') ||
      String((emp as any).employment_status || '').toLowerCase().includes('demission');
    if (!inactive) {
      flash('Démissionnez d’abord l’employé avant de le supprimer.', 'error');
      return;
    }
    setPendingDelete(emp);
    setPwMode('delete');
    setPwTitle(`Supprimer ${empName(emp)}`);
    setPwDesc('Suppression de la fiche uniquement. L’historique des paiements reste en base.');
    void (async () => {
      try {
        const r: any = await api.deleteEmployee(emp!.id, '');
        flash(r.message || 'Employé supprimé');
        setDetail(null);
        load(true);
      } catch (err: any) {
        flash(err?.message || 'Suppression impossible', 'error');
      } finally {
        setPendingDelete(null);
      }
    })();
  };

  const confirmSensitive = async (_password?: string) => {
    if (!pendingDelete) return;
    if (pwMode === 'resign') {
      const r: any = await api.resignEmployee(pendingDelete.id, {
        confirm_password: '',
        settle_pay: resignSettle,
        amount: resignSettle ? resignAmount : undefined,
        pay_amount: resignPayRef,
        pay_cycle_type: resignCycleType,
        pay_cycle_days: resignCycleType === 'days' ? resignCycleDays : 30,
        reason: resignReason,
        note: resignNote,
        payment_method: 'cash',
      });
      flash(r.message || 'Démission enregistrée');
    } else {
      const r: any = await api.deleteEmployee(pendingDelete.id, '');
      flash(r.message || 'Employé supprimé');
    }
    setPwOpen(false);
    setPendingDelete(null);
    setDetail(null);
    load(true);
  };

  const reactivate = async (e: Emp) => {
    try {
      const r: any = await api.reactivateEmployee(e.id);
      flash(r.message || 'Réactivé');
      load(true);
    } catch (err: any) {
      flash(err?.message || 'Réactivation impossible', 'error');
    }
  };

  const openDetail = async (e: Emp) => {
    try {
      const r = await api.getEmployee(e.id);
      setDetail(r.data);
    } catch (err: any) {
      flash(err?.message || 'Détail impossible', 'error');
    }
  };

  const downloadId = async (id: number) => {
    try {
      const token = getToken();
      const res = await fetch(api.employeeIdDocUrl(id), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('Téléchargement impossible');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'piece-identite';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      flash(e?.message || 'Document indisponible', 'error');
    }
  };

  const activeCount = list.filter((e) => Number(e.active) !== 0).length;
  const payDueCount = list.filter((e) => e.pay_overdue).length;
  const payroll = list
    .filter((e) => Number(e.active) !== 0)
    .reduce((s, e) => s + Number(e.pay_amount || 0), 0);

  return (
    <div className="atlas-crm employees-page">
      <div className="page-header">
        <h1>Employés</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <RefreshIconButton onClick={() => load(true)} loading={refreshing} />
          <button
            type="button"
            className="secondary"
            onClick={() => openPrintDoc('/api/employees/form/print')}
            title="Formulaire vierge à faire remplir avant embauche"
          >
            Imprimer fiche d’embauche
          </button>
          <button type="button" onClick={openCreate}>
            + Ajouter un employé
          </button>
        </div>
      </div>

      <SaveFeedback message={msg} type={msgType} />

      <div className="ac-panel ac-products-filters"><div className="ac-products-filters-row employees-toolbar">
          <input
            className="ac-search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher nom, n° employé, poste, téléphone, CIN…"
            style={{ flex: '1 1 240px', minWidth: 0, width: '100%' }}
            aria-label="Recherche employés"
          />
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            style={{ flex: '0 1 160px', minWidth: 140 }}
            aria-label="Catégorie"
          >
            <option value="">Toutes catégories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value="Magasin">Magasin</option>
            <option value="Bureau">Bureau</option>
            <option value="Chantier">Chantier</option>
            <option value="Direction">Direction</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            style={{ flex: '0 1 140px', minWidth: 120 }}
            aria-label="Statut"
          >
            <option value="active">Actifs</option>
            <option value="resigned">Démissionnaires</option>
            <option value="all">Tous</option>
          </select>
        </div>
      </div>

      <div className="ac-metric-grid ac-metric-grid--3" style={{ marginBottom: 16 }}>
        <div className="ac-metric">
          <div className="as-label">Actifs</div>
          <div className="as-value" style={{ fontSize: '1.35rem' }}>
            {activeCount}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>dans la liste</div>
        </div>
        <div className="ac-metric">
          <div className="as-label">À payer</div>
          <div className="as-value" style={{ fontSize: '1.35rem' }}>
            {payDueCount}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>échéance dépassée</div>
        </div>
        <div className="ac-metric">
          <div className="as-label">Masse (actifs)</div>
          <div className="as-value" style={{ fontSize: '1.35rem' }}>
            {Math.round(payroll).toLocaleString('fr-FR')} MAD
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>somme des salaires</div>
        </div>
      </div>

      {loading ? (
        <div className="empty">Chargement…</div>
      ) : list.length === 0 ? (
        <div className="ac-panel" style={{ padding: '48px 24px', textAlign: 'center' }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Aucun enregistrement</h2>
          <p style={{ color: 'var(--muted)', margin: '0 0 16px', fontSize: 14 }}>
            {debouncedQ
              ? 'Aucun employé ne correspond à votre recherche.'
              : 'Ajoutez un collaborateur avec identité, poste et salaire.'}
          </p>
          {!debouncedQ && (
            <button type="button" onClick={openCreate}>
              + Ajouter un employé
            </button>
          )}
        </div>
      ) : (
        <div className="ac-panel ac-products-table-panel" style={{ padding: 0, width: '100%' }}>
          <div className="table-wrap">
            <table className="data-dense ac-products-table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>N°</th>
                  <th>Poste</th>
                  <th>Salaire</th>
                  <th>Cycle</th>
                  <th>Dernier paiement</th>
                  <th>Prochaine échéance</th>
                  <th>Pièce ID</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id} style={{ opacity: Number(e.active) === 0 ? 0.55 : 1 }}>
                    <td>
                      <span
                        className="party-name party-name-link"
                        role="button"
                        tabIndex={0}
                        title={`${empName(e)} — modifier`}
                        onClick={() => openEdit(e)}
                        onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openEdit(e); } }}
                      >
                        {empShort(e)}
                      </span>
                      {e.phone ? <div style={{ fontSize: 12, color: 'var(--muted)' }}>{e.phone}</div> : null}
                    </td>
                    <td style={{ fontSize: 13, color: 'var(--muted)' }}>{e.emp_number || '—'}</td>
                    <td>{e.role_title || '—'}</td>
                    <td style={{ fontWeight: 700 }}>{fmt(Number(e.pay_amount || 0))}</td>
                    <td>{cycleLabel(e)}</td>
                    <td>{e.last_paid_at ? String(e.last_paid_at).slice(0, 10) : 'Jamais'}</td>
                    <td>
                      {e.pay_overdue ? (
                        <span className="badge danger">{e.next_due} · à payer</span>
                      ) : (
                        <span>{e.next_due || '—'}</span>
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {e.national_id ? <div className="mono-amt" style={{ fontSize: 12 }}>{e.national_id}</div> : null}
                      {e.has_id_doc ? (
                        <button type="button" className="secondary" style={{ padding: '2px 8px', fontSize: 11, marginTop: e.national_id ? 4 : 0 }} onClick={() => downloadId(e.id)}>
                          Voir pièce
                        </button>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>{e.national_id ? '' : '—'}</span>
                      )}
                    </td>
                    <td className="row-actions-cell">
                      <div className="row-actions">
                        <button
                          type="button"
                          className="secondary"
                          title="Dossier imprimable (1 page A4)"
                          onClick={() => openPrintDoc(`/api/employees/${e.id}/form/print`)}
                        >
                          Fiche
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          title="Situation RH (rapport)"
                          onClick={() =>
                            openReport('/api/reports/employee-situation', {
                              employee_id: String(e.id),
                            })
                          }
                        >
                          Situation
                        </button>
                        {Number(e.active) !== 0 && (
                          <>
                            <button type="button" className="success" onClick={() => openPay(e)}>
                              Marquer payé
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              title="Acompte selon cycle (semaines) — pas lié à la présence"
                              onClick={() => openAdvance(e)}
                            >
                              Acompte
                            </button>
                          </>
                        )}
                        {Number(e.active) !== 0 ? (
                          <button type="button" className="secondary" onClick={() => openResign(e)}>
                            Démissionner
                          </button>
                        ) : (
                          <>
                            <button type="button" className="secondary" onClick={() => reactivate(e)}>
                              Réactiver
                            </button>
                            {deleteArmId === e.id ? (
                              <TimedUndoDelete autoStart deleteLabel="Supprimer" undoLabel="Annuler" initialSeconds={10}
                                onConfirm={() => { setDeleteArmId(null); openDelete(e); }} />
                            ) : (
                              <TimedUndoDelete deleteLabel="Supprimer" undoLabel="Annuler" initialSeconds={10} onConfirm={() => { setDeleteArmId(null); openDelete(e); }} />
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showModal && (
        <FloatingPortal><div className="modal-overlay" onClick={() => { setShowModal(false); setEditing(null); setForm({ ...emptyForm }); setNatOther(false); setStep(0); setModalError(''); setFieldErrors({}); }}>
          <div className="modal" style={{ maxWidth: 640, width: '94vw' }} onClick={(ev) => ev.stopPropagation()}>
            <h2 style={{ marginBottom: 8 }}>{editing ? 'Modifier l’employé' : 'Nouvel employé'}</h2>

            {step === 0 && (
              <div className="grid grid-2">
                <div className="form-row">
                  <label>Prénom</label>
                  <input value={form.first_name} onChange={(e) => setF('first_name', e.target.value)} />
                </div>
                <div className="form-row">
                  <label>Nom de famille</label>
                  <input value={form.last_name} onChange={(e) => setF('last_name', e.target.value)} />
                </div>
                <div className="form-row">
                  <label>Date de naissance</label>
                  <DatePicker value={form.date_of_birth} onChange={(v) => setF('date_of_birth', v)} minYear={1910} maxYear={new Date().getFullYear()} />
                </div>
                <div className="form-row">
                  <label>Genre</label>
                  <select value={form.gender} onChange={(e) => setF('gender', e.target.value)}>
                    <option value="">—</option>
                    <option value="Homme">Homme</option>
                    <option value="Femme">Femme</option>
                  </select>
                </div>
                <div className="form-row">
                  <label>Nationalité</label>
                  <select
                    value={natOther || (form.nationality !== '' && form.nationality !== 'Marocaine') ? '__other__' : 'Marocaine'}
                    onChange={(e) => {
                      if (e.target.value === 'Marocaine') { setNatOther(false); setF('nationality', 'Marocaine'); }
                      else { setNatOther(true); if (form.nationality === 'Marocaine') setF('nationality', ''); }
                    }}
                  >
                    <option value="Marocaine">Marocaine</option>
                    <option value="__other__">Autre</option>
                  </select>
                </div>
                {(natOther || (form.nationality !== '' && form.nationality !== 'Marocaine')) && (
                  <div className="form-row">
                    <label>Préciser la nationalité</label>
                    <input
                      value={form.nationality}
                      onChange={(e) => setF('nationality', e.target.value)}
                      placeholder="Ex. Française, Sénégalaise…"
                    />
                  </div>
                )}
                <div className="form-row">
                  <label>Situation familiale</label>
                  <select value={form.marital_status} onChange={(e) => setF('marital_status', e.target.value)}>
                    <option value="">—</option>
                    <option value="Célibataire">Célibataire</option>
                    <option value="Marié(e)">Marié(e)</option>
                  </select>
                </div>
              </div>
            )}

            {step === 1 && (
              <>
                <div className="form-row">
                  <label>Statut d’identité / séjour</label>
                  <select value={form.immigration_status} onChange={(e) => setF('immigration_status', e.target.value)}>
                    <option value="">— Choisir —</option>
                    <option value="citizen">Citoyen (CIN)</option>
                    <option value="resident">Résident permanent</option>
                    <option value="work_permit">Titulaire de permis de travail</option>
                    <option value="other">Autre / document de voyage</option>
                  </select>
                </div>
                <div className="grid grid-2">
                  <div className="form-row">
                    <label>
                      {form.immigration_status === 'work_permit'
                        ? 'N° permis de travail'
                        : form.immigration_status === 'other'
                          ? 'N° passeport / document'
                          : form.immigration_status === 'resident'
                            ? 'N° carte de séjour'
                            : 'CIN / National ID'}
                    </label>
                    <input value={form.national_id} onChange={(e) => setF('national_id', e.target.value)} />
                  </div>
                  <div className="form-row">
                    <label>Identifiant fiscal</label>
                    <input value={form.tax_id} onChange={(e) => setF('tax_id', e.target.value)} />
                  </div>
                  {(form.immigration_status === 'citizen' ||
                    form.immigration_status === 'resident' ||
                    form.immigration_status === '') && (
                    <>
                      <div className="form-row">
                        <label>CNSS / Social</label>
                        <input value={form.social_insurance} onChange={(e) => setF('social_insurance', e.target.value)} />
                      </div>
                      <div className="form-row">
                        <label>Assurance maladie</label>
                        <input value={form.health_insurance} onChange={(e) => setF('health_insurance', e.target.value)} />
                      </div>
                    </>
                  )}
                  {form.immigration_status === 'work_permit' && (
                    <div className="form-row">
                      <label>Assurance (si applicable)</label>
                      <input value={form.health_insurance} onChange={(e) => setF('health_insurance', e.target.value)} />
                    </div>
                  )}
                  <div className="form-row">
                    <label>Permis de conduire</label>
                    <input value={form.driving_license} onChange={(e) => setF('driving_license', e.target.value)} />
                  </div>
                </div>
                <div className="form-row">
                  <label>Fichier CIN / passeport (PDF ou image)</label>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={async (e) => {
                      const f = e.target.files?.[0] || null;
                      setIdFile(f);
                      if (!f || !f.type.startsWith('image/')) return;
                      try {
                        const data_url = await fileToDataUrl(f);
                        const r: any = await api.parseEmployeeId({ data_url });
                        setReviewFields(r?.data?.fields || {});
                        setReviewMsg(
                          r?.data?.review_message ||
                            'Veuillez vérifier que les informations lues sont correctes.',
                        );
                        setReviewOpen(true);
                      } catch {
                        setReviewFields({});
                        setReviewMsg('Vérifiez et saisissez les champs manuellement.');
                        setReviewOpen(true);
                      }
                    }}
                  />
                </div>
              </>
            )}

            {step === 2 && (
              <div className="grid grid-2">
                <div className="form-row">
                  <label>Intitulé du poste</label>
                  <input value={form.role_title} onChange={(e) => setF('role_title', e.target.value)} />
                </div>
                <div className="form-row">
                  <label>Département</label>
                  <input value={form.department} onChange={(e) => setF('department', e.target.value)} />
                </div>
                <div className="form-row">
                  <label>Catégorie</label>
                  <select value={form.category} onChange={(e) => setF('category', e.target.value)}>
                    <option value="">—</option>
                    <option value="Magasin">Magasin</option>
                    <option value="Bureau">Bureau</option>
                    <option value="Chantier">Chantier</option>
                    <option value="Direction">Direction</option>
                  </select>
                </div>
                <div className="form-row">
                  <label>Statut d’emploi</label>
                  <select value={form.employment_status} onChange={(e) => setF('employment_status', e.target.value)}>
                    <option value="">—</option>
                    <option value="CDI">CDI</option>
                    <option value="CDI_TP">CDI temps plein</option>
                    <option value="CDD">CDD</option>
                    <option value="Stage">Stage</option>
                  </select>
                </div>
                <div className="form-row">
                  <label>Date d’embauche</label>
                  <DatePicker value={form.joined_date} onChange={(v) => setF('joined_date', v)} />
                </div>
              </div>
            )}

            {step === 3 && (
              <>
                <div className="form-row">
                  <label>Adresse</label>
                  <input value={form.address} onChange={(e) => setF('address', e.target.value)} />
                </div>
                <div className="grid grid-2">
                  <div className="form-row">
                    <label>Ville</label>
                    <input value={form.city} onChange={(e) => setF('city', e.target.value)} />
                  </div>
                  <div className="form-row">
                    <label>Pays</label>
                    <input value={form.country} onChange={(e) => setF('country', e.target.value)} />
                  </div>
                  <div className="form-row">
                    <label>Mobile</label>
                    <input value={form.phone} onChange={(e) => setF('phone', e.target.value)} />
                  </div>
                  <div className="form-row">
                    <label>E-mail</label>
                    <input type="email" value={form.email} onChange={(e) => setF('email', e.target.value)} />
                  </div>
                </div>
              </>
            )}

            {step === 4 && (
              <>
                <div className="form-row">
                  <label>Montant (MAD)</label>
                  <NumberField value={form.pay_amount} onValueChange={(n) => setF('pay_amount', n)} min={0} step="1" />
                </div>
                <div className="form-row">
                  <label>Fréquence de paiement</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className={form.pay_cycle_type === 'monthly' ? '' : 'secondary'}
                      onClick={() => setForm((f) => ({ ...f, pay_cycle_type: 'monthly', pay_cycle_days: 30 }))}
                    >
                      Mensuel
                    </button>
                    <button
                      type="button"
                      className={form.pay_cycle_type === 'days' ? '' : 'secondary'}
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          pay_cycle_type: 'days',
                          pay_cycle_days: f.pay_cycle_days || 7,
                        }))
                      }
                    >
                      Tous les N jours
                    </button>
                  </div>
                </div>
                {form.pay_cycle_type === 'days' && (
                  <div className="form-row">
                    <label>Nombre de jours</label>
                    <NumberField
                      value={form.pay_cycle_days}
                      onValueChange={(n) => setF('pay_cycle_days', Math.max(1, Math.min(365, n || 1)))}
                      min={1}
                      max={365}
                      step="1"
                    />
                  </div>
                )}
                <div className="grid grid-2">
                  <div className="form-row">
                    <label>Type de contrat</label>
                    <select value={form.contract_type || 'CDI'} onChange={(e) => setF('contract_type', e.target.value)}>
                      <option value="CDI">CDI — Contrat à durée indéterminée</option>
                      <option value="CDI_TP">CDI temps plein (signé avec la société)</option>
                      <option value="CDD">CDD — Contrat à durée déterminée</option>
                      <option value="Anapec">ANAPEC / insertion</option>
                      <option value="Stage">Stage</option>
                      <option value="Autre">Autre</option>
                    </select>
                  </div>
                  <div className="form-row">
                    <label>Période d’essai (jours)</label>
                    <input
                      type="number"
                      min={0}
                      max={365}
                      value={form.trial_days ?? 90}
                      onChange={(e) => setF('trial_days', Number(e.target.value) || 0)}
                    />
                  </div>
                </div>
                <div className="grid grid-2">
                  <div className="form-row">
                    <label>Durée hebdomadaire (h) — légal 44 h</label>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={form.weekly_hours ?? 44}
                      onChange={(e) => setF('weekly_hours', Number(e.target.value) || 44)}
                    />
                  </div>
                  <div className="form-row">
                    <label>N° CNSS salarié</label>
                    <input
                      value={form.cnss_number || form.social_insurance || ''}
                      onChange={(e) => {
                        setF('cnss_number', e.target.value);
                        setF('social_insurance', e.target.value);
                      }}
                      placeholder="Immatriculation CNSS"
                    />
                  </div>
                </div>
                <div className="form-row">
                  <label>RIB (versement salaire)</label>
                  <input
                    value={form.rib || ''}
                    onChange={(e) => setF('rib', e.target.value)}
                    placeholder="MA00 0000 0000 0000 0000 0000 000"
                  />
                </div>
                <div className="form-row">
                  <label>Compte lié (identifiant de connexion)</label>
                  <input
                    value={form.user_username || ''}
                    onChange={(e) => setF('user_username', e.target.value)}
                    placeholder="ex. yasmine — permet à l'employé de voir sa propre date de paie"
                    autoComplete="off"
                  />
                  <FieldHint hint="L'employé connecté avec cet identifiant verra SA fiche de paie (date de paie uniquement) via l'app." />
                </div>
                <div className="form-row">
                  <label>Description du poste / fonctions</label>
                  <textarea
                    rows={3}
                    value={form.job_description || ''}
                    onChange={(e) => setF('job_description', e.target.value)}
                    placeholder="Tâches principales, lieu de travail, horaires…"
                  />
                </div>
                <div className="form-row">
                  <label>Notes</label>
                  <textarea rows={2} value={form.notes || ''} onChange={(e) => setF('notes', e.target.value)} />
                </div>
                <div className="form-row" style={{ marginTop: 8, paddingTop: 12, borderTop: '1px solid var(--line, #e5e5e5)' }}>
                  <label>Pièce d’identité (CIN / passeport) — stockée chiffrée (R2)</label>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={async (e) => {
                      const f = e.target.files?.[0] || null;
                      setIdFile(f);
                      if (!f || !f.type.startsWith('image/')) return;
                      try {
                        const data_url = await fileToDataUrl(f);
                        const r: any = await api.parseEmployeeId({ data_url });
                        setReviewFields(r?.data?.fields || {});
                        setReviewMsg(
                          r?.data?.review_message ||
                            'Veuillez vérifier que les informations lues sont correctes.',
                        );
                        setReviewOpen(true);
                      } catch {
                        setReviewFields({});
                        setReviewMsg('Vérifiez et saisissez les champs manuellement.');
                        setReviewOpen(true);
                      }
                    }}
                  />
                  <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
                    {idFile
                      ? `Fichier prêt : ${idFile.name} (chiffré à l’enregistrement, hors base D1)`
                      : 'PDF ou image — obligatoire recommandé à la création. Chiffrement AES côté serveur, clé R2 .id uniquement.'}
                  </p>
                </div>
              </>
            )}

            <ModalFormError message={modalError} />
            {/* Guided steps — the action bar never moves: Retour left,
                Continuer / Créer always at the same place on the right. */}
            <div className="wizard-foot">
              <div className="wizard-foot-nav">
                <span className="wizard-foot-step">
                  Étape {step + 1}/{STEPS.length} · {STEPS[step].label}
                </span>
                <div className="wizard-foot-actions">
                  <button type="button" className="secondary" onClick={() => { setModalError(''); setShowModal(false); }}>
                    Annuler
                  </button>
                  {step > 0 && (
                    <button type="button" className="secondary" onClick={() => setStep((s) => Math.max(0, s - 1))}>
                      Retour
                    </button>
                  )}
                  {step < STEPS.length - 1 ? (
                    <button type="button" onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}>
                      Continuer
                    </button>
                  ) : (
                    <button type="button" onClick={save} disabled={saving || idUploading}>
                      {saving || idUploading ? 'Enregistrement…' : editing ? 'Enregistrer' : 'Créer l’employé'}
                    </button>
                  )}
                </div>
              </div>
              {editing && (
                <div className="wizard-foot-extra">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => openPrintDoc(`/api/employees/${editing.id}/form/print`)}
                  >
                    Fiche
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      openReport('/api/reports/employee-situation', {
                        employee_id: String(editing.id),
                      })
                    }
                  >
                    Situation
                  </button>
                </div>
              )}
            </div>
          </div>
        </div></FloatingPortal>
      )}

      
      
      
      {plafondWarn && (
        <FloatingPortal><div className="modal-overlay" onClick={() => setPlafondWarn(null)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <h2 style={{ marginTop: 0 }}>Plafond d’acompte atteint</h2>
            <p style={{ fontSize: 14, lineHeight: 1.45 }}>
              <strong>{empName(plafondWarn)}</strong> a déjà atteint le maximum d’acomptes pour ce
              cycle (<strong>50&nbsp;% du salaire</strong>
              {plafondWarn.pay_amount != null
                ? ` — ${fmt(Number((plafondWarn as any).half_cycle_cap ?? Number(plafondWarn.pay_amount) * 0.5))}`
                : ''}
              ).
            </p>
            <p className="muted" style={{ fontSize: 13 }}>
              Déjà versé : {fmt(Number(plafondWarn.advances_in_period || 0))}. Le plafond absolu est
              50&nbsp;% du salaire de cycle. <strong>Continuer</strong> n’autorise un versement que
              s’il reste de la marge sous ce plafond.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" className="secondary" onClick={() => setPlafondWarn(null)}>
                Annuler
              </button>
              <button
                type="button"
                onClick={() => {
                  const e = plafondWarn;
                  if (!e) {
                    setPlafondWarn(null);
                    return;
                  }
                  const half = Number((e as any).half_cycle_cap ?? Number(e.pay_amount || 0) * 0.5);
                  const hardLeft = Math.max(0, half - Number(e.advances_in_period || 0));
                  setPlafondWarn(null);
                  if (hardLeft > 0) openAdvanceForm(e, { forceHalfCap: true });
                }}
              >
                Continuer
              </button>
            </div>
          </div>
        </div></FloatingPortal>
      )}

      {advanceWarn && (
        <FloatingPortal><div className="modal-overlay" onClick={() => setAdvanceWarn(null)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <h2 style={{ marginTop: 0 }}>Acompte — condition non remplie</h2>
            <p style={{ fontSize: 14, lineHeight: 1.45 }}>
              <strong>{empName(advanceWarn)}</strong> n’a pas encore atteint{' '}
              <strong>25&nbsp;% du cycle</strong> (
              {Math.round(Number(advanceWarn.cycle_progress || 0) * 100)}&nbsp;% —{' '}
              {advanceWarn.accrued_days ?? 0} j / {advanceWarn.cycle_days || '—'} j).
            </p>
            <p className="muted" style={{ fontSize: 13 }}>
              Vous pouvez continuer, mais le montant reste plafonné (max. 50&nbsp;% du salaire de
              cycle, et selon la tranche semaine). Confirmer pour ouvrir l’acompte.
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="button" className="secondary" onClick={() => setAdvanceWarn(null)}>
                Annuler
              </button>
              <button type="button" onClick={() => openAdvanceForm(advanceWarn)}>
                OK, continuer
              </button>
            </div>
          </div>
        </div></FloatingPortal>
      )}

      {advanceTarget && (
        <FloatingPortal><div className="modal-overlay" onClick={() => setAdvanceTarget(null)} role="presentation">
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <h2 style={{ marginTop: 0 }}>Acompte — {empName(advanceTarget)}</h2>
            <div className="muted" style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>
              <div>
                Cycle de <strong>{advanceTarget.cycle_days || '—'} j</strong>
                {' · '}
                <strong>{advanceTarget.accrued_days ?? 0} j</strong> écoulés
                {' · '}
                {Math.round(Number(advanceTarget.cycle_progress || 0) * 100)}% du cycle
              </div>
              <div>
                Tranche : <strong>{advanceTierLabel((advanceTarget as any).advance_tier)}</strong>
              </div>
              <div>
                Montant proposé : <strong>5% du salaire de cycle</strong> (
                {fmt(Math.round(Number(advanceTarget.pay_amount || 0) * 0.05 * 100) / 100)}
                ). Max. autorisé :{' '}
                {fmt(
                  Math.max(
                    0,
                    Number((advanceTarget as any).half_cycle_cap ?? Number(advanceTarget.pay_amount || 0) * 0.5) -
                      Number(advanceTarget.advances_in_period || 0),
                  ),
                )}{' '}
                (50% − déjà versé {fmt(Number(advanceTarget.advances_in_period || 0))})
              </div>
              <div>
                Plafond absolu du cycle :{' '}
                <strong>
                  {fmt(
                    Number(
                      (advanceTarget as any).half_cycle_cap ??
                        Number(advanceTarget.pay_amount || 0) * 0.5,
                    ),
                  )}
                </strong>{' '}
                (50% du salaire)
              </div>
              {(advanceTarget as any).advance_needs_proof ? (
                <div style={{ color: 'var(--bad, #b91c1c)' }}>Justificatif obligatoire.</div>
              ) : null}
              {Number(advanceTarget.cycle_progress || 0) < 0.25 ? (
                <div>Dérogation : moins de 25% du cycle écoulé.</div>
              ) : null}
            </div>
            <div className="form-row">
              <label>Montant</label>
              <NumberField value={advanceAmount} onValueChange={setAdvanceAmount} min={0} step="1" />
            </div>
            <div className="form-row">
              <label>
                Note{(advanceTarget as any).advance_needs_proof ? ' / justificatif *' : ''}
              </label>
              <input
                value={advanceNote}
                onChange={(e) => setAdvanceNote(e.target.value)}
                placeholder={
                  (advanceTarget as any).advance_needs_proof
                    ? 'Motif / preuve (obligatoire)'
                    : 'Optionnel'
                }
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="secondary" onClick={() => setAdvanceTarget(null)}>
                Annuler
              </button>
              <button type="button" disabled={advanceBusy} onClick={() => void confirmAdvance()}>
                {advanceBusy ? '…' : 'Verser l’acompte'}
              </button>
            </div>
          </div>
        </div></FloatingPortal>
      )}

{payTarget && (
        <FloatingPortal><div className="modal-overlay" onClick={() => setPayTarget(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(ev) => ev.stopPropagation()}>
            <h2>Marquer payé — {empName(payTarget)}</h2>
            {Number(payTarget.advances_in_period || 0) > 0 && (
              <p className="muted" style={{ fontSize: 13 }}>
                Acomptes déjà versés sur la période :{' '}
                <strong>{fmt(Number(payTarget.advances_in_period))}</strong>
                {' · '}
                reste suggéré : <strong>{fmt(Number(payTarget.suggested_pay || 0))}</strong>
              </p>
            )}
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              Montant suggéré depuis le dernier paiement
              {payTarget.period_from ? (
                <> ({String(payTarget.period_from).slice(0, 10)} → aujourd&apos;hui, {payTarget.accrued_days ?? 0} j)</>
              ) : (
                <> (depuis l&apos;entrée)</>
              )}
              . Se remet à zéro après chaque paiement. Vous pouvez modifier le montant.
            </p>
            <div className="form-row">
              <label>Montant (MAD)</label>
              <NumberField value={payAmount} onValueChange={setPayAmount} min={0} step="1" />
            </div>
            <div className="form-row">
              <label>Date</label>
              <DatePicker value={payDate} onChange={setPayDate} />
            </div>
            <div className="form-row">
              <label>Mode de paiement</label>
              <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                <option value="cash">Espèces (caisse)</option>
                <option value="bank">Virement / banque</option>
                <option value="card">Carte</option>
              </select>
            </div>
            <div className="form-row">
              <label>Note</label>
              <input value={payNote} onChange={(e) => setPayNote(e.target.value)} />
            </div>
            <div className="form-actions">
              <button type="button" className="success" onClick={confirmPay} disabled={payBusy}>
                {payBusy ? '…' : `Confirmer · ${fmt(payAmount)}`}
              </button>
              <button type="button" className="secondary" onClick={() => setPayTarget(null)}>
                Annuler
              </button>
            </div>
          </div>
        </div></FloatingPortal>
      )}

      {detail && (
        <FloatingPortal><div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal" style={{ maxWidth: 640 }} onClick={(ev) => ev.stopPropagation()}>
            <h2>{empName(detail)}</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>
              {[detail.emp_number, detail.role_title, detail.category].filter(Boolean).join(' · ') || 'Employé'}
            </p>
            <div style={{ fontSize: 13, marginBottom: 12 }}>
              Salaire : <strong>{fmt(Number(detail.pay_amount || 0))}</strong> · {cycleLabel(detail)}
              <br />
              Pièce ID :{' '}
              {detail.has_id_doc ? (
                <button type="button" className="secondary" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => downloadId(detail.id)}>
                  Télécharger
                </button>
              ) : (
                '—'
              )}
            </div>
            <h3 style={{ fontSize: 14 }}>Paiements</h3>
            {!detail.payments?.length ? (
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>Aucun paiement.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Montant</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.payments.map((p: any) => (
                      <tr key={p.id}>
                        <td>{String(p.paid_at).slice(0, 10)}</td>
                        <td style={{ fontWeight: 700 }}>{fmt(Number(p.amount || 0))}</td>
                        <td>{p.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="form-actions" style={{ marginTop: 16 }}>
              {Number(detail.active) !== 0 && (
                <button type="button" className="success" onClick={() => { setDetail(null); openPay(detail); }}>
                  Marquer payé
                </button>
              )}
              {Number(detail.active) !== 0 ? (
                <button type="button" className="secondary" onClick={() => openResign(detail)}>
                  Démissionner
                </button>
              ) : (
                <>
                  <button type="button" className="success" onClick={() => reactivate(detail)}>
                    Réactiver
                  </button>
                  {deleteArmId === detail.id ? (
                              <TimedUndoDelete autoStart deleteLabel="Supprimer" undoLabel="Annuler" initialSeconds={10}
                                onConfirm={() => { setDeleteArmId(null); openDelete(detail); }} />
                            ) : (
                              <TimedUndoDelete deleteLabel="Supprimer" undoLabel="Annuler" initialSeconds={10} onConfirm={() => { setDeleteArmId(null); openDelete(detail); }} />
                            )}
                </>
              )}
              <button type="button" className="secondary" onClick={() => setDetail(null)}>
                Fermer
              </button>
            </div>
          </div>
        </div></FloatingPortal>
      )}

      {reviewOpen && (
        <FloatingPortal><div className="modal-overlay" onClick={() => setReviewOpen(false)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={(ev) => ev.stopPropagation()}>
            <h2>Vérifiez les informations</h2>
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>{reviewMsg}</p>
            <div className="grid grid-2">
              {(['first_name', 'last_name', 'date_of_birth', 'gender', 'nationality', 'national_id'] as const).map((k) => (
                <div className="form-row" key={k}>
                  <label>
                    {
                      (
                        {
                          first_name: 'Prénom',
                          last_name: 'Nom',
                          date_of_birth: 'Naissance',
                          gender: 'Genre',
                          nationality: 'Nationalité',
                          national_id: 'CIN',
                        } as any
                      )[k]
                    }
                  </label>
                  <input
                    value={reviewFields[k] || ''}
                    onChange={(e) => setReviewFields((prev) => ({ ...prev, [k]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <div className="form-actions">
              <button
                type="button"
                onClick={() => {
                  setForm((f) => ({
                    ...f,
                    first_name: reviewFields.first_name || f.first_name,
                    last_name: reviewFields.last_name || f.last_name,
                    date_of_birth: reviewFields.date_of_birth || f.date_of_birth,
                    gender: reviewFields.gender || f.gender,
                    nationality: reviewFields.nationality || f.nationality,
                    national_id: reviewFields.national_id || f.national_id,
                    name:
                      f.name ||
                      `${reviewFields.first_name || f.first_name} ${reviewFields.last_name || f.last_name}`.trim(),
                  }));
                  setReviewOpen(false);
                  flash('Champs mis à jour — vérifiez avant d’enregistrer');
                }}
              >
                Appliquer à la fiche
              </button>
              <button type="button" className="secondary" onClick={() => setReviewOpen(false)}>
                Ignorer
              </button>
            </div>
          </div>
        </div></FloatingPortal>
      )}

      {pwOpen && pendingDelete && pwMode === 'resign' && (
        <FloatingPortal><div className="modal-overlay" role="presentation">
          <div className="modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>{pwTitle}</h2>
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              {pwDesc}
            </p>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={resignSettle}
                onChange={(e) => setResignSettle(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span>
                Payer le solde des jours travaillés depuis le dernier paiement
                {pendingDelete.period_from
                  ? ` (${String(pendingDelete.period_from).slice(0, 10)} → aujourd'hui, ${pendingDelete.accrued_days ?? 0} j)`
                  : ''}
                {pendingDelete.suggested_pay != null
                  ? ` — suggéré ${fmt(Number(pendingDelete.suggested_pay))}`
                  : ''}
              </span>
            </label>
            {resignSettle && (
              <>
                <div className="form-row">
                  <label>Montant solde (modifiable)</label>
                  <NumberField value={resignAmount} onValueChange={setResignAmount} min={0} step="1" />
                </div>
                <div className="form-row">
                  <label>Salaire de référence</label>
                  <NumberField value={resignPayRef} onValueChange={setResignPayRef} min={0} step="1" />
                </div>
                <div className="grid grid-2">
                  <div className="form-row">
                    <label>Cycle de paie</label>
                    <select
                      value={resignCycleType}
                      onChange={(e) => {
                        const v = e.target.value as 'monthly' | 'days';
                        setResignCycleType(v);
                        if (v === 'monthly') setResignCycleDays(30);
                      }}
                    >
                      <option value="monthly">Mensuel (~30 j)</option>
                      <option value="days">Tous les X jours</option>
                    </select>
                  </div>
                  {resignCycleType === 'days' && (
                    <div className="form-row">
                      <label>Jours / cycle</label>
                      <NumberField value={resignCycleDays} onValueChange={setResignCycleDays} min={1} step="1" />
                    </div>
                  )}
                </div>
              </>
            )}
            <div className="form-row">
              <label>Motif</label>
              <select value={resignReason} onChange={(e) => setResignReason(e.target.value)}>
                <option value="Démission">Démission</option>
                <option value="Fin de contrat">Fin de contrat</option>
                <option value="Licenciement">Licenciement</option>
                <option value="Rupture conventionnelle">Rupture conventionnelle</option>
                <option value="Autre">Autre</option>
              </select>
            </div>
            <div className="form-row">
              <label>Note</label>
              <input
                value={resignNote}
                onChange={(e) => setResignNote(e.target.value)}
                placeholder="Optionnel"
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setPwOpen(false);
                  setPendingDelete(null);
                }}
              >
                Annuler
              </button>
              <button type="button" onClick={() => void confirmSensitive()}>
                Confirmer
              </button>
            </div>
          </div>
        </div></FloatingPortal>
      )}
    </div>
  );
}
