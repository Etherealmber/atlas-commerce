/**
 * /m/employees (Directory) + /m/employees/:id (Detail) — parity with Android
 * EmployeeDirectoryScreen.kt & EmployeesScreen.kt.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, RefreshCw, Search, Users } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { friendlyError } from '../lib/errors';
import PhoneSkeleton from './PhoneSkeleton';

export const PHONE_EMPLOYEES_PAGE_SIZE = 20;

export interface PhoneEmployeeSummary {
  id: number;
  name: string;
  role_title: string;
  department: string;
  status: string;
  phone: string;
  email: string;
  contract_type: string;
  pay_amount: number;
  pay_cycle_type: string;
  pay_cycle_days: number;
  cnss_number: string;
  national_id: string;
  weekly_hours: number;
  joined_date: string;
  rib: string;
}

export function mapEmployeeRow(raw: any): PhoneEmployeeSummary {
  const full = [raw?.first_name, raw?.last_name].filter(Boolean).join(' ').trim() || String(raw?.name || '');
  return {
    id: Number(raw?.id || 0),
    name: full || `Employé #${raw?.id || ''}`,
    role_title: String(raw?.role_title || ''),
    department: String(raw?.department || ''),
    status: String(raw?.employment_status || (Number(raw?.is_active ?? 1) === 1 ? 'active' : 'inactive')),
    phone: String(raw?.phone || ''),
    email: String(raw?.email || ''),
    contract_type: String(raw?.contract_type || 'CDI'),
    pay_amount: Number(raw?.pay_amount || 0),
    pay_cycle_type: String(raw?.pay_cycle_type || 'monthly'),
    pay_cycle_days: Number(raw?.pay_cycle_days || 7),
    cnss_number: String(raw?.cnss_number || raw?.social_insurance || ''),
    national_id: String(raw?.national_id || ''),
    weekly_hours: Number(raw?.weekly_hours || 44),
    joined_date: String(raw?.joined_date || ''),
    rib: String(raw?.rib || ''),
  };
}

export function filterMobileEmployees(
  list: PhoneEmployeeSummary[],
  query: string,
  roleFilter: string,
): PhoneEmployeeSummary[] {
  const q = query.trim().toLowerCase();
  const rf = roleFilter.trim().toLowerCase();
  return list.filter((e) => {
    if (rf && rf !== 'all') {
      const hay = `${e.role_title} ${e.department}`.toLowerCase();
      if (!hay.includes(rf)) return false;
    }
    if (!q) return true;
    return [e.name, e.role_title, e.department, e.phone, e.cnss_number].some((v) =>
      v.toLowerCase().includes(q),
    );
  });
}

const fmtSalary = (n: number) => `${Math.round(Number(n || 0)).toLocaleString('fr-FR')} MAD`;

export function PhoneEmployeeDirectory() {
  const navigate = useNavigate();
  const [list, setList] = useState<PhoneEmployeeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.getEmployees();
      const rows = Array.isArray((res as any)?.data) ? (res as any).data : [];
      setList(rows.map(mapEmployeeRow));
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(0);
  }, [query, roleFilter]);

  const roleOptions = useMemo(() => {
    const roles = Array.from(new Set(list.map((e) => e.role_title).filter(Boolean)));
    return roles.slice(0, 8);
  }, [list]);

  const filtered = useMemo(
    () => filterMobileEmployees(list, query, roleFilter),
    [list, query, roleFilter],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PHONE_EMPLOYEES_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const visible = filtered.slice(
    safePage * PHONE_EMPLOYEES_PAGE_SIZE,
    (safePage + 1) * PHONE_EMPLOYEES_PAGE_SIZE,
  );

  return (
    <div className="phone-panel">
      <div className="ph-native-section-head">
        <div>
          <h1 className="ph-title" style={{ fontSize: 22 }}>Employés</h1>
          <p className="ph-sub">Répertoire du personnel.</p>
        </div>
        <button type="button" className="ph-native-icon" aria-label="Actualiser les employés" onClick={() => void load()}>
          <RefreshCw size={18} />
        </button>
      </div>

      <div className="ph-catalog-search" style={{ marginBottom: 10 }}>
        <Search size={17} aria-hidden="true" />
        <input
          type="search"
          aria-label="Rechercher un employé"
          placeholder="Nom, poste ou CNSS…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="ph-native-chips" style={{ marginBottom: 10 }}>
        <button type="button" aria-pressed={roleFilter === 'all'} onClick={() => setRoleFilter('all')}>
          Tous
        </button>
        {roleOptions.map((r) => (
          <button key={r} type="button" aria-pressed={roleFilter === r} onClick={() => setRoleFilter(r)}>
            {r}
          </button>
        ))}
      </div>

      {loading ? (
        <PhoneSkeleton variant="rows" label="Chargement des employés" />
      ) : error ? (
        <div className="ph-sale-error" role="alert">
          {error}{' '}
          <button type="button" className="ph-native-text" onClick={() => void load()}>
            Réessayer
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="ph-empty">
          <Users size={26} />
          <h2>Aucun employé</h2>
          <p>Modifiez votre recherche ou filtre de poste.</p>
        </div>
      ) : (
        <>
          <div className="ph-catalog-summary" aria-live="polite">
            <span>{filtered.length} employé{filtered.length > 1 ? 's' : ''}</span>
          </div>
          <div className="ph-catalog-list">
            {visible.map((emp) => (
              <button
                type="button"
                key={emp.id}
                className="ph-catalog-card"
                style={{ width: '100%', textAlign: 'left' }}
                onClick={() => navigate(`/m/employees/${emp.id}`)}
              >
                <div className="ph-catalog-info">
                  <strong>{emp.name}</strong>
                  <p>{emp.role_title || 'Poste non précisé'}{emp.department ? ` · ${emp.department}` : ''}</p>
                  <small>{emp.contract_type} · {fmtSalary(emp.pay_amount)}</small>
                </div>
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            ))}
          </div>
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
              <button type="button" className="ph-chip" disabled={safePage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                Précédent
              </button>
              <span className="ph-muted" style={{ fontSize: 12 }}>Page {safePage + 1} / {totalPages}</span>
              <button type="button" className="ph-chip" disabled={safePage + 1 >= totalPages} onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}>
                Suivant
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function PhoneEmployeeDetail() {
  const { id } = useParams();
  const [emp, setEmp] = useState<PhoneEmployeeSummary | null>(null);
  const [raw, setRaw] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.getEmployee(Number(id));
      const data = (res as any)?.data;
      setRaw(data);
      setEmp(data ? mapEmployeeRow(data) : null);
    } catch (e: any) {
      setError(friendlyError(e));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <div className="phone-panel"><PhoneSkeleton variant="rows" label="Chargement de la fiche" /></div>;
  if (error || !emp) {
    return (
      <div className="phone-panel">
        <div className="ph-sale-error" role="alert">
          {error || 'Employé introuvable.'}{' '}
          <button type="button" className="ph-native-text" onClick={() => void load()}>Réessayer</button>
        </div>
      </div>
    );
  }

  return (
    <div className="phone-panel" style={{ display: 'grid', gap: 12 }}>
      <section className="ph-native-card">
        <h1 className="ph-title" style={{ fontSize: 20, marginBottom: 4 }}>{emp.name}</h1>
        <p className="ph-sub" style={{ margin: 0 }}>
          {emp.role_title || 'Poste non précisé'}{emp.department ? ` · ${emp.department}` : ''}
        </p>
      </section>

      <section className="ph-native-card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Contrat</h2>
        <p style={{ margin: '4px 0', fontSize: 13 }}>Type : <strong>{emp.contract_type}</strong> · {emp.weekly_hours} h/semaine</p>
        <p style={{ margin: '4px 0', fontSize: 13 }}>Date d’arrivée : {emp.joined_date || '—'}</p>
      </section>

      <section className="ph-native-card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Salaire</h2>
        <p style={{ margin: '4px 0', fontSize: 13 }}>
          Salaire : <strong>{fmtSalary(emp.pay_amount)}</strong> ({emp.pay_cycle_type === 'days' ? `Tous les ${emp.pay_cycle_days} jours` : 'Mensuel'})
        </p>
        <p style={{ margin: '4px 0', fontSize: 13 }}>RIB : {emp.rib || '—'}</p>
      </section>

      <section className="ph-native-card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>CNSS</h2>
        <p style={{ margin: '4px 0', fontSize: 13 }}>Numéro CNSS : <strong>{emp.cnss_number || '—'}</strong></p>
        <p style={{ margin: '4px 0', fontSize: 13 }}>N° fiscal : {raw?.tax_id || '—'}</p>
      </section>

      <section className="ph-native-card">
        <h2 style={{ fontSize: 15, marginTop: 0 }}>Pièce d’identité</h2>
        <p style={{ margin: '4px 0', fontSize: 13 }}>CIN / Passeport : <strong>{emp.national_id || '—'}</strong></p>
        <p style={{ margin: '4px 0', fontSize: 13 }}>Nationalité : {raw?.nationality || 'Marocaine'}</p>
        <p style={{ margin: '4px 0', fontSize: 13 }}>Téléphone : {emp.phone || '—'} · Email : {emp.email || '—'}</p>
      </section>
    </div>
  );
}
