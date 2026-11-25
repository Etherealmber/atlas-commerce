import TopPageActions from '../components/TopPageActions';
import { AlertTriangle, BarChart3, CheckCircle2, FileText, Info, Printer, ShieldCheck, ShieldOff, UserCheck, UserMinus, UserPlus, Wallet } from 'lucide-react';
import { TimedUndoDelete } from '../components/ui';
import ListPager from '../components/ui/ListPager';
import { onAgentDraft } from '../lib/agentDraft';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { getToken } from '../auth';
import { openReport, openPrintDoc } from '../lib/reports';
import RefreshIconButton from '../components/RefreshIconButton';
import { DesktopTableSkeleton } from '../components/PageSkeleton';
import NumberField from '../components/NumberField';
import SaveFeedback from '../components/SaveFeedback';
import DatePicker from '../components/DatePicker';
import { FloatingPortal } from '../components/FloatingPortal';
import { ModalFormError, FieldHint } from '../components/ModalFormFeedback';
import { isEmail } from '../lib/formValidate';
import { round2 } from '../lib/money';
import './employee-wizard.css';
import { MetricSpark, MetricTrend } from '../components/MetricSpark';
import Select from '../components/ui/Select';

type Emp = Record<string, any>;

/** CNSS caps the declared days at 26 per month (bordereau DAMANCOM). */
const CNSS_MAX_DAYS = 26;

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
  cnss_declared: true,
  cnss_days: CNSS_MAX_DAYS,
  notes: '',
  // v256 — compte de connexion lié (permet à l'employé de voir SA date de paie)
  user_username: '',
};

const STEPS = [
  { id: 'personal', label: 'Personnel', hint: 'Les informations de base de votre collaborateur.' },
  { id: 'identity', label: 'Identité', hint: 'Ses pièces d’identité et justificatifs.' },
  { id: 'coverage', label: 'Social & fiscal', hint: 'Numéro fiscal, CNSS et couverture santé.' },
  { id: 'work', label: 'Poste', hint: 'Son rôle et sa date d’arrivée.' },
  { id: 'contact', label: 'Contact', hint: 'Ses coordonnées et son adresse.' },
  { id: 'pay', label: 'Salaire', hint: 'Définissez le montant et la fréquence de paiement.' },
  { id: 'cnss', label: 'Déclaration CNSS', hint: 'Est-il déclaré à la CNSS, et combien de jours par mois ?' },
  { id: 'contract', label: 'Contrat', hint: 'Les conditions de travail et les coordonnées bancaires.' },
  { id: 'details', label: 'Détails', hint: 'Complétez les informations utiles à la fiche.' },
] as const;
type StepId = (typeof STEPS)[number]['id'];

const CNSS_DAY_PRESETS = [
  { days: 26, label: 'Mois complet' },
  { days: 22, label: '22 j' },
  { days: 13, label: 'Mi-temps' },
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

export default function Employees({ phone = false }: { phone?: boolean }) {
  const [deleteArmId, setDeleteArmId] = useState<string | number | null>(null);
  const [list, setList] = useState<Emp[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'resigned' | 'all'>('active');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;
  useEffect(() => { setPage(0); }, [debouncedQ, statusFilter, categoryFilter]);
  const [categories, setCategories] = useState<string[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [step, setStep] = useState(0);
  const stepId: StepId = STEPS[Math.min(step, STEPS.length - 1)].id;
  const [editing, setEditing] = useState<Emp | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  // v0.7.4 — « Autre nationalité » explicite : plus de confusion avec une valeur vide.
  const [natOther, setNatOther] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgType, setMsgType] = useState<'success' | 'error'>('success');
  const [modalError, setModalError] = useState('');
  const [, setFieldErrors] = useState<Record<string, string>>({});
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
  const [resignReason, setResignReason] = useState('Démission');
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
      cnss_declared: e.cnss_declared === undefined || e.cnss_declared === null ? true : Number(e.cnss_declared) !== 0,
      cnss_days: e.cnss_days === undefined || e.cnss_days === null ? CNSS_MAX_DAYS : Math.max(0, Math.min(CNSS_MAX_DAYS, Number(e.cnss_days))),
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
    if (form.pay_amount != null && Number.isNaN(Number(form.pay_amount))) {
      fe.pay_amount = 'Chiffres uniquement pour le salaire.';
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
        cnss_declared: form.cnss_declared ? 1 : 0,
        cnss_days: form.cnss_declared ? Math.max(0, Math.min(CNSS_MAX_DAYS, Number(form.cnss_days) || 0)) : 0,
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

  const openAdvanceForm = (e: Emp, _opts?: { forceHalfCap?: boolean }) => {
    const salary = Number(e.pay_amount || 0);
    const half = Number((e as any).half_cycle_cap ?? salary * 0.5);
    const already = Number(e.advances_in_period || 0);
    const hardLeft = Math.max(0, round2(half - already));
    if (hardLeft <= 0) {
      setAdvanceWarn(null);
      setPlafondWarn(e);
      return;
    }
    // Default amount in the popup = 5% of cycle salary (capped by what remains under 50%)
    const fivePct = round2(salary * 0.05);
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
        setList((prev: Emp[]) =>
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
      const code = e?.code || e?.body?.code;
      const capData = e?.body?.data || {};
      if (code === 'ADVANCE_CAP_EXCEEDED' || code === 'ADVANCE_CAP') {
        // The server never shrinks the amount on its own (a concurrent advance may
        // have used part of the cap). Show the real remaining allowance and let the
        // user confirm it explicitly.
        const left = code === 'ADVANCE_CAP' ? 0 : Math.max(0, Number(capData.max_advance ?? 0));
        const target = advanceTarget;
        const already = capData.already != null ? Number(capData.already) : undefined;
        const half = capData.half_cycle_cap != null ? Number(capData.half_cycle_cap) : undefined;
        setList((prev: Emp[]) =>
          prev.map((x) =>
            x.id === target.id
              ? {
                  ...x,
                  max_advance: left,
                  ...(already != null ? { advances_in_period: already } : {}),
                  ...(half != null ? { half_cycle_cap: half } : {}),
                }
              : x,
          ),
        );
        if (left > 0) {
          setAdvanceAmount(left);
          flash(`${e?.message || 'Plafond d’acompte dépassé.'} Montant ajusté à ${fmt(left)} : vérifiez puis confirmez.`, 'error');
        } else {
          setAdvanceTarget(null);
          setPlafondWarn({
            ...target,
            ...(already != null ? { advances_in_period: already } : {}),
            ...(half != null ? { half_cycle_cap: half } : {}),
          } as Emp);
        }
        void load(true);
      } else if (code === 'ADVANCE_CONFLICT') {
        flash(e?.message || 'Opération concurrente détectée. Actualisez et réessayez.', 'error');
        void load(true);
      } else {
        flash(e?.message || 'Acompte impossible', 'error');
      }
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
    setPwDesc('Confirmez le passage de cet employé en ancien. Aucun paiement ne sera créé.');
    setResignReason(String(e.employment_status || 'Démission') || 'Démission');
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
        reason: resignReason,
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

  const employeeActions = (e: Emp) => (
    <div className="row-actions">
      <button
        type="button"
        className="secondary"
        title="Dossier imprimable (1 page A4)"
        onClick={() => openPrintDoc(`/api/employees/${e.id}/form/print`)}
      >
        <FileText size={14} aria-hidden="true" />
        <span>Fiche</span>
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
        <BarChart3 size={14} aria-hidden="true" />
        <span>Situation</span>
      </button>
      {Number(e.active) !== 0 && (
        <>
          <button type="button" className="secondary" onClick={() => openPay(e)}>
            <CheckCircle2 size={14} aria-hidden="true" />
            <span>Marquer payé</span>
          </button>
          <button
            type="button"
            className="secondary"
            title="Acompte selon cycle (semaines) — pas lié à la présence"
            onClick={() => openAdvance(e)}
          >
            <Wallet size={14} aria-hidden="true" />
            <span>Acompte</span>
          </button>
        </>
      )}
      {Number(e.active) !== 0 ? (
        <button type="button" className="secondary" onClick={() => openResign(e)}>
          <UserMinus size={14} aria-hidden="true" />
          <span>Démissionner</span>
        </button>
      ) : (
        <>
          <button type="button" className="secondary" onClick={() => reactivate(e)}>
            <UserCheck size={14} aria-hidden="true" />
            <span>Réactiver</span>
          </button>
          {deleteArmId === e.id ? (
            <TimedUndoDelete iconOnly width="34px" autoStart deleteLabel="Supprimer" undoLabel="Annuler" initialSeconds={10}
              onConfirm={() => { setDeleteArmId(null); openDelete(e); }} />
          ) : (
            <TimedUndoDelete iconOnly width="34px" deleteLabel="Supprimer" undoLabel="Annuler" initialSeconds={10} onConfirm={() => { setDeleteArmId(null); openDelete(e); }} />
          )}
        </>
      )}
    </div>
  );

  const totalPages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedList = list.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <div className={`atlas-crm employees-page${phone ? ' employees-page--phone' : ''}`}>
      <div className={`page-header${phone ? "" : " dock-page-header"}`}>
        <h1 className={phone ? undefined : "sr-only"}>Employés</h1>
        <TopPageActions enabled={!phone}>
          <RefreshIconButton onClick={() => load(true)} loading={refreshing} />
          <button
            type="button"
            className="secondary"
            onClick={() => openPrintDoc('/api/employees/form/print')}
            title="Formulaire vierge à faire remplir avant embauche"
          >
            <Printer size={16} aria-hidden="true" />
            <span className="tpa-label">Imprimer fiche d’embauche</span>
          </button>
          <button type="button" title="Ajouter un employé" onClick={openCreate}>
            <UserPlus size={16} aria-hidden="true" />
            <span className="tpa-label">Ajouter un employé</span>
          </button>
        </TopPageActions>
      </div>

      <SaveFeedback message={msg} type={msgType} />

      <div className="ac-metric-grid ac-metric-grid--3" style={{ marginBottom: 16 }}>
        <div className="ac-metric">
          <div className="as-label">Actifs</div>
          <div className="as-value" style={{ fontSize: '1.35rem' }}>
            {activeCount}
          <MetricTrend k="employees_active" /></div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>dans la liste</div>
          <MetricSpark k="employees_active" />
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

      <div className="ac-panel ac-products-filters"><div className="ac-products-filters-row employees-toolbar">
          <input
            className="ac-search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher nom, n° employé, poste, téléphone, CIN…"
            style={{ flex: '1 1 240px', minWidth: 0, width: '100%' }}
            aria-label="Recherche employés"
          />
          <Select
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
          </Select>
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            style={{ flex: '0 1 140px', minWidth: 120 }}
            aria-label="Statut"
          >
            <option value="active">Actifs</option>
            <option value="resigned">Démissionnaires</option>
            <option value="all">Tous</option>
          </Select>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '8px 0' }}>
          <DesktopTableSkeleton rows={6} cols={5} />
        </div>
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
      ) : phone ? (
        <section className="ph-employees-list" aria-label="Équipe">
          <div className="ph-employees-list-title"><h2>Équipe</h2><span>{list.length} fiche(s) dans la liste</span></div>
          <div className="ac-table-pager-bar" style={{ marginBottom: 10 }}>
            <span className="ac-table-pager-meta">{list.length} employé{list.length === 1 ? '' : 's'} · 20 par page</span>
            <ListPager page={safePage} pageSize={PAGE_SIZE} total={list.length} onPageChange={setPage} size="sm" />
          </div>
          {pagedList.map((e) => <article className="ph-employee-card" key={e.id}>
            <div className="ph-employee-head"><div className="ph-employee-avatar" aria-hidden="true">{empName(e).split(/\s+/).filter(Boolean).slice(0, 2).map((part: string) => part[0]?.toUpperCase()).join('')}</div><div className="ph-employee-name"><h3>{empName(e)}</h3><span>{e.role_title || 'Poste non renseigné'} · {e.emp_number || 'N° non renseigné'}</span></div><span className="ph-employee-status">{Number(e.active) === 0 ? 'Inactif' : 'Actif'}</span></div>
            <dl className="ph-employee-info"><div><dt>Salaire</dt><dd>{fmt(Number(e.pay_amount || 0))}</dd></div><div><dt>Cycle</dt><dd>{cycleLabel(e)}</dd></div><div><dt>Dernier paiement</dt><dd>{e.last_paid_at ? String(e.last_paid_at).slice(0, 10) : 'Jamais'}</dd></div><div><dt>Prochaine échéance</dt><dd>{e.next_due || '—'}{e.pay_overdue ? ' · à payer' : ''}</dd></div>{e.phone && <div><dt>Téléphone</dt><dd>{e.phone}</dd></div>}{e.national_id && <div><dt>Pièce ID</dt><dd>{e.national_id}</dd></div>}</dl>
            <div className="ph-employee-links"><button type="button" className="secondary" onClick={() => openEdit(e)}>Modifier</button><button type="button" className="secondary" onClick={() => void openDetail(e)}>Détails &amp; historique</button>{!!e.has_id_doc && <button type="button" className="secondary" onClick={() => void downloadId(e.id)}>Voir pièce</button>}</div>
            <details className="ph-employee-more"><summary>Actions de la fiche</summary>{employeeActions(e)}</details>
          </article>)}
        </section>
      ) : (
        <div className="ac-panel ac-products-table-panel" style={{ padding: 0, width: '100%' }}>
          <div className="ac-table-pager-bar">
            <span className="ac-table-pager-meta">{list.length} employé{list.length === 1 ? '' : 's'} · 20 par page</span>
            <ListPager page={safePage} pageSize={PAGE_SIZE} total={list.length} onPageChange={setPage} />
          </div>
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
                {pagedList.map((e) => (
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
                      {employeeActions(e)}
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
          <div className="modal employee-wizard" role="dialog" aria-modal="true" aria-labelledby="employee-wizard-title" onClick={(ev) => ev.stopPropagation()}>
            <header className="employee-wizard__header">
              <div><p className="employee-wizard__eyebrow">FICHE EMPLOYÉ</p><h2 id="employee-wizard-title">{editing ? 'Modifier l’employé' : 'Nouvel employé'}</h2></div>
              <span className="employee-wizard__count">{step + 1} / {STEPS.length}</span>
            </header>
            <ol className="employee-wizard__progress" data-many-steps="true" aria-label="Étapes de la fiche employé">
              {STEPS.map((item, index) => (
                <li
                  key={item.id}
                  className={index === step ? 'is-current' : index < step ? 'is-complete' : ''}
                  aria-current={index === step ? 'step' : undefined}
                >
                  <button
                    type="button"
                    className="step-wizard__step-btn"
                    onClick={() => {
                      if (index > 0 && !`${form.first_name} ${form.last_name}`.trim()) {
                        setModalError('Indiquez le prénom ou le nom de famille.');
                        return;
                      }
                      setModalError('');
                      setStep(index);
                    }}
                  >
                    <span>{index < step ? '✓' : index + 1}</span>
                    <b>{item.label}</b>
                  </button>
                </li>
              ))}
            </ol>
            <div className="wz-step employee-wizard__body">
              <div className="employee-wizard__intro" aria-live="polite"><h3>{STEPS[step].label}</h3><p>{STEPS[step].hint}</p></div>
            {stepId === 'personal' && (
              <div className="grid grid-2">
                <div className="form-row">
                  <label htmlFor="employee-first-name">Prénom</label>
                  <input id="employee-first-name" value={form.first_name} onChange={(e) => { setF('first_name', e.target.value); if (modalError) setModalError(''); }} aria-invalid={!!modalError && !`${form.first_name} ${form.last_name}`.trim()} />
                </div>
                <div className="form-row">
                  <label htmlFor="employee-last-name">Nom de famille</label>
                  <input id="employee-last-name" value={form.last_name} onChange={(e) => { setF('last_name', e.target.value); if (modalError) setModalError(''); }} aria-invalid={!!modalError && !`${form.first_name} ${form.last_name}`.trim()} />
                  <FieldHint hint="Indiquez au moins un prénom ou un nom." />
                </div>
                <div className="form-row">
                  <label>Date de naissance</label>
                  <DatePicker value={form.date_of_birth} onChange={(v) => setF('date_of_birth', v)} minYear={1910} maxYear={new Date().getFullYear()} />
                </div>
                <div className="form-row">
                  <label>Genre</label>
                  <Select value={form.gender} onChange={(e) => setF('gender', e.target.value)}>
                    <option value="">—</option>
                    <option value="Homme">Homme</option>
                    <option value="Femme">Femme</option>
                  </Select>
                </div>
                <div className="form-row">
                  <label>Nationalité</label>
                  <Select
                    value={natOther || (form.nationality !== '' && form.nationality !== 'Marocaine') ? '__other__' : 'Marocaine'}
                    onChange={(e) => {
                      if (e.target.value === 'Marocaine') { setNatOther(false); setF('nationality', 'Marocaine'); }
                      else { setNatOther(true); if (form.nationality === 'Marocaine') setF('nationality', ''); }
                    }}
                  >
                    <option value="Marocaine">Marocaine</option>
                    <option value="__other__">Autre</option>
                  </Select>
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
                  <Select value={form.marital_status} onChange={(e) => setF('marital_status', e.target.value)}>
                    <option value="">—</option>
                    <option value="Célibataire">Célibataire</option>
                    <option value="Marié(e)">Marié(e)</option>
                  </Select>
                </div>
              </div>
            )}

            {stepId === 'identity' && (
              <>
                <div className="grid grid-2">
                  <div className="form-row">
                    <label>Statut d’identité / séjour</label>
                    <Select value={form.immigration_status} onChange={(e) => setF('immigration_status', e.target.value)}>
                      <option value="">— Choisir —</option>
                      <option value="citizen">Citoyen (CIN)</option>
                      <option value="resident">Résident permanent</option>
                      <option value="work_permit">Titulaire de permis de travail</option>
                      <option value="other">Autre / document de voyage</option>
                    </Select>
                  </div>
                  <div className="form-row">
                    <label>
                      {form.immigration_status === 'work_permit'
                        ? 'N° permis de travail'
                        : form.immigration_status === 'other'
                          ? 'N° passeport / document'
                          : form.immigration_status === 'resident'
                            ? 'N° carte de séjour'
                            : 'CIN / pièce d’identité'}
                    </label>
                    <input value={form.national_id} onChange={(e) => setF('national_id', e.target.value)} />
                  </div>
                </div>
                <div className="form-row">
                  <label>Permis de conduire</label>
                  <input value={form.driving_license} onChange={(e) => setF('driving_license', e.target.value)} />
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
                  <FieldHint hint={idFile ? `Fichier sélectionné : ${idFile.name}` : 'PDF ou image. Vous pourrez ajouter une pièce plus tard.'} />
                </div>
              </>
            )}

            {stepId === 'coverage' && (
              <div className="grid grid-2">
                <div className="form-row">
                  <label>Identifiant fiscal</label>
                  <input value={form.tax_id} onChange={(e) => setF('tax_id', e.target.value)} />
                </div>
                {(form.immigration_status === 'citizen' ||
                  form.immigration_status === 'resident' ||
                  form.immigration_status === '') && (
                  <div className="form-row">
                    <label>CNSS / Social</label>
                    <input
                      value={form.cnss_number || form.social_insurance || ''}
                      onChange={(e) => {
                        setF('cnss_number', e.target.value);
                        setF('social_insurance', e.target.value);
                      }}
                      placeholder="Immatriculation CNSS"
                    />
                  </div>
                )}
                {(form.immigration_status === 'citizen' ||
                  form.immigration_status === 'resident' ||
                  form.immigration_status === '' ||
                  form.immigration_status === 'work_permit') && (
                  <div className="form-row">
                    <label>{form.immigration_status === 'work_permit' ? 'Assurance (si applicable)' : 'Assurance maladie'}</label>
                    <input value={form.health_insurance} onChange={(e) => setF('health_insurance', e.target.value)} />
                  </div>
                )}
              </div>
            )}

            {stepId === 'work' && (
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
                  <Select value={form.category} onChange={(e) => setF('category', e.target.value)}>
                    <option value="">—</option>
                    <option value="Magasin">Magasin</option>
                    <option value="Bureau">Bureau</option>
                    <option value="Chantier">Chantier</option>
                    <option value="Direction">Direction</option>
                  </Select>
                </div>
                <div className="form-row">
                  <label>Statut d’emploi</label>
                  <Select value={form.employment_status} onChange={(e) => setF('employment_status', e.target.value)}>
                    <option value="">—</option>
                    <option value="CDI">CDI</option>
                    <option value="CDI_TP">CDI temps plein</option>
                    <option value="CDD">CDD</option>
                    <option value="Stage">Stage</option>
                  </Select>
                </div>
                <div className="form-row">
                  <label>Date d’embauche</label>
                  <DatePicker value={form.joined_date} onChange={(v) => setF('joined_date', v)} />
                </div>
              </div>
            )}

            {stepId === 'contact' && (
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
                    <input type="email" value={form.email} onChange={(e) => { setF('email', e.target.value); if (modalError) setModalError(''); }} />
                  </div>
                </div>
              </>
            )}

            {stepId === 'pay' && (
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
              </>
            )}
            {stepId === 'cnss' && (
              <div className="emp-cnss">
                <div className="emp-cnss-choice" role="radiogroup" aria-label="Déclaration CNSS">
                  <label className={`emp-cnss-option${form.cnss_declared ? ' is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="emp-cnss-declared"
                      checked={form.cnss_declared}
                      onChange={() => setForm((f) => ({ ...f, cnss_declared: true, cnss_days: f.cnss_days > 0 ? f.cnss_days : CNSS_MAX_DAYS }))}
                    />
                    <span className="emp-cnss-option__ico" aria-hidden="true"><ShieldCheck size={18} /></span>
                    <span className="emp-cnss-option__copy">
                      <strong>Déclaré à la CNSS</strong>
                      <em>Cotisations CNSS et AMO retenues chaque mois.</em>
                    </span>
                    <span className="emp-cnss-option__dot" aria-hidden="true" />
                  </label>
                  <label className={`emp-cnss-option${!form.cnss_declared ? ' is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="emp-cnss-declared"
                      checked={!form.cnss_declared}
                      onChange={() => setForm((f) => ({ ...f, cnss_declared: false }))}
                    />
                    <span className="emp-cnss-option__ico is-off" aria-hidden="true"><ShieldOff size={18} /></span>
                    <span className="emp-cnss-option__copy">
                      <strong>Non déclaré</strong>
                      <em>0 jour au bordereau, aucune cotisation CNSS / AMO.</em>
                    </span>
                    <span className="emp-cnss-option__dot" aria-hidden="true" />
                  </label>
                </div>

                {form.cnss_declared && (
                  <div className="emp-cnss-days">
                    <div className="emp-cnss-days__head">
                      <label htmlFor="emp-cnss-days-input">Jours déclarés par mois</label>
                      <span className="emp-cnss-days__max">max {CNSS_MAX_DAYS} j</span>
                    </div>
                    <div className="emp-cnss-days__row">
                      <div className="emp-cnss-days__input">
                        <NumberField
                          id="emp-cnss-days-input"
                          value={form.cnss_days}
                          onValueChange={(n) => setF('cnss_days', Math.max(0, Math.min(CNSS_MAX_DAYS, Math.round((Number(n) || 0) * 2) / 2)))}
                          min={0}
                          max={CNSS_MAX_DAYS}
                          step="0.5"
                        />
                        <span>jours</span>
                      </div>
                      <div className="emp-cnss-presets" role="radiogroup" aria-label="Raccourcis">
                        {CNSS_DAY_PRESETS.map((p) => (
                          <label key={p.days} className={`emp-cnss-chip${Number(form.cnss_days) === p.days ? ' is-selected' : ''}`}>
                            <input
                              type="radio"
                              name="emp-cnss-preset"
                              checked={Number(form.cnss_days) === p.days}
                              onChange={() => setF('cnss_days', p.days)}
                            />
                            <b>{p.days} j</b>
                            {p.label !== `${p.days} j` && <span>{p.label}</span>}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div
                      className="emp-cnss-meter"
                      role="meter"
                      aria-valuemin={0}
                      aria-valuemax={CNSS_MAX_DAYS}
                      aria-valuenow={Number(form.cnss_days) || 0}
                      aria-label="Jours déclarés"
                    >
                      <i style={{ width: `${Math.round(((Number(form.cnss_days) || 0) / CNSS_MAX_DAYS) * 100)}%` }} />
                    </div>
                  </div>
                )}

                <div className="emp-cnss-note">
                  <Info size={16} aria-hidden="true" />
                  <p>
                    {form.cnss_declared ? (
                      <>
                        Chaque lot de paie proposera <strong>{Number(form.cnss_days) || 0} j</strong> pour ce salarié (réduits
                        automatiquement en cas d’absence pointée). Vous pouvez toujours corriger le nombre de jours ligne par
                        ligne dans <strong>Paie CNSS / AMO</strong>.
                      </>
                    ) : (
                      <>
                        Ce salarié apparaîtra avec <strong>0 jour</strong> dans la déclaration et sans retenue CNSS / AMO. Vous
                        pourrez le déclarer plus tard depuis sa fiche ou directement dans un lot de paie.
                      </>
                    )}
                  </p>
                </div>

                {form.cnss_declared && !(form.cnss_number || form.social_insurance) && (
                  <div className="emp-cnss-warn" role="status">
                    <AlertTriangle size={16} aria-hidden="true" />
                    <p>
                      N° d’immatriculation CNSS manquant.{' '}
                      <a
                        href="#cnss-number"
                        onClick={(ev) => {
                          ev.preventDefault();
                          setStep(STEPS.findIndex((x) => x.id === 'coverage'));
                        }}
                      >
                        Le compléter à l’étape Social &amp; fiscal
                      </a>
                    </p>
                  </div>
                )}
              </div>
            )}
            {stepId === 'contract' && (
              <>
                <div className="grid grid-2">
                  <div className="form-row">
                    <label>Type de contrat</label>
                    <Select value={form.contract_type || 'CDI'} onChange={(e) => setF('contract_type', e.target.value)}>
                      <option value="CDI">CDI — Contrat à durée indéterminée</option>
                      <option value="CDI_TP">CDI temps plein (signé avec la société)</option>
                      <option value="CDD">CDD — Contrat à durée déterminée</option>
                      <option value="Anapec">ANAPEC / insertion</option>
                      <option value="Stage">Stage</option>
                      <option value="Autre">Autre</option>
                    </Select>
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
                    <label>RIB (versement salaire)</label>
                    <input
                      value={form.rib || ''}
                      onChange={(e) => setF('rib', e.target.value)}
                      placeholder="MA00 0000 0000 0000 0000 0000 000"
                    />
                  </div>
                </div>
              </>
            )}
            {stepId === 'details' && (
              <>
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
                    rows={2}
                    value={form.job_description || ''}
                    onChange={(e) => setF('job_description', e.target.value)}
                    placeholder="Tâches principales, lieu de travail, horaires…"
                  />
                </div>
                <div className="form-row">
                  <label>Notes</label>
                  <textarea rows={2} value={form.notes || ''} onChange={(e) => setF('notes', e.target.value)} />
                </div>

              </>
            )}

            <ModalFormError message={modalError} />
            </div>
            {/* Guided steps — the action bar never moves: Retour left,
                Continuer / Créer always at the same place on the right. */}
            <div className="wizard-foot">
              <div
                className="wz-progress"
                role="progressbar"
                aria-valuemin={1}
                aria-valuemax={STEPS.length}
                aria-valuenow={step + 1}
                aria-label={`Étape ${step + 1} sur ${STEPS.length}`}
              >
                <i style={{ width: `${Math.round(((step + 1) / STEPS.length) * 100)}%` }} />
              </div>
              <div className="wizard-foot-nav">
                <span className="wizard-foot-step">
                  <span className="wz-chip">Étape {step + 1}/{STEPS.length}<span className="wz-step-label"> · {STEPS[step].label}</span></span>
                  {editing ? 'Modifier l’employé' : 'Nouvel employé'}
                </span>
                <div className="wizard-foot-actions">
                  <button type="button" className="secondary" onClick={() => { setModalError(''); setShowModal(false); }}>
                    Annuler
                  </button>
                  {step > 0 && (
                    <button type="button" className="secondary" onClick={() => { setModalError(''); setStep((s) => Math.max(0, s - 1)); }}>
                      Retour
                    </button>
                  )}
                  {step < STEPS.length - 1 ? (
                    <button type="button" onClick={() => {
                      if (stepId === 'personal' && !`${form.first_name} ${form.last_name}`.trim()) {
                        setModalError('Indiquez le prénom ou le nom de famille.');
                        return;
                      }
                      if (stepId === 'contact' && form.email.trim() && !isEmail(form.email)) {
                        setModalError('Adresse e-mail invalide.');
                        return;
                      }
                      if (stepId === 'pay' && (!Number.isFinite(Number(form.pay_amount)) || Number(form.pay_amount) < 0)) {
                        setModalError('Indiquez un salaire valide (≥ 0).');
                        return;
                      }
                      setModalError('');
                      setStep((s) => Math.min(STEPS.length - 1, s + 1));
                    }}>
                      Continuer
                    </button>
                  ) : (
                    <button type="button" onClick={save} disabled={saving || idUploading}>
                      {saving || idUploading ? 'Enregistrement…' : editing ? 'Enregistrer' : 'Créer l’employé'}
                    </button>
                  )}
                </div>
              </div>
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
                {fmt(round2(Number(advanceTarget.pay_amount || 0) * 0.05))}
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
              <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                <option value="cash">Espèces (caisse)</option>
                <option value="bank">Virement / banque</option>
                <option value="card">Carte</option>
              </Select>
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
            <div className="form-row">
              <label>Motif</label>
              <Select value={resignReason} onChange={(e) => setResignReason(e.target.value)}>
                <option value="Démission">Démission</option>
                <option value="Fin de contrat">Fin de contrat</option>
                <option value="Licenciement">Licenciement</option>
                <option value="Rupture conventionnelle">Rupture conventionnelle</option>
                <option value="Autre">Autre</option>
              </Select>
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
