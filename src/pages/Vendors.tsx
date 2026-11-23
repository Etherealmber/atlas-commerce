import TopPageActions from '../components/TopPageActions';
import { Plus } from 'lucide-react';
import { TimedUndoDelete } from '../components/ui';
import ListPager from '../components/ui/ListPager';
import { useEffect, useState } from 'react';
import { api } from '../api';
import PasswordConfirm from '../components/PasswordConfirm';
import SaveFeedback from '../components/SaveFeedback';
import { validateVendorForm, firstError } from '../lib/formValidate';
import EmptyState from '../components/EmptyState';
import RefreshIconButton from '../components/RefreshIconButton';
import PageSkeleton from '../components/PageSkeleton';
import '../components/erp/crm-parties.css';
import { FloatingPortal } from '../components/FloatingPortal';
import { useWizard, StepBody, WizardFoot, WizardHeader, WizardIntro, type WizardStepDef } from '../components/ui/FormWizard';
import { ModalFormError } from '../components/ModalFormFeedback';

const VENDOR_STEPS: readonly WizardStepDef[] = [
  { id: 'identity', label: 'Identité', hint: 'Nom du fournisseur et identifiants fiscaux.' },
  { id: 'contact', label: 'Contact', hint: 'Adresse, ville, téléphone et e-mail.' },
];

export default function Vendors() {
  const [pwOpen, setPwOpen] = useState(false);
  const [pwTitle, setPwTitle] = useState('');
  const [pwDesc, setPwDesc] = useState('');
  const [pendingAction, setPendingAction] = useState<null | ((password: string) => Promise<void>)>(null);
  const [deleteArmId, setDeleteArmId] = useState<number | null>(null);
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [show, setShow] = useState(false);
  const wz = useWizard(2);
  const [editId, setEditId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;
  useEffect(() => { setPage(0); }, [search]);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveMsg, setSaveMsg] = useState('');
  const [saveMsgType, setSaveMsgType] = useState<'success' | 'error'>('success');
  const [form, setForm] = useState({ name: '', ice: '', if_number: '', address: '', city: '', phone: '', email: '' });

  const flash = (msg: string, type: 'success' | 'error' = 'success') => {
    setSaveMsg(msg); setSaveMsgType(type);
    setTimeout(() => setSaveMsg(''), 4500);
  };

  const load = (soft = false) => {
    if (soft) setRefreshing(true);
    else setLoading(true);
    api.getVendors().then((r) => setList(r.data)).finally(() => {
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

  useEffect(() => { load(); }, []);

  const openEdit = (v: any) => {
    setEditId(Number(v.id));
    setForm({
      name: v.name || '',
      ice: v.ice || '',
      if_number: v.if_number || '',
      address: v.address || '',
      city: v.city || '',
      phone: v.phone || '',
      email: v.email || '',
    });
    setShow(true);
  };

  const save = async () => {
    const fe = validateVendorForm(form);
    setFieldErrors(fe);
    if (Object.keys(fe).length) return; // erreurs affichées sous chaque champ
    if (!form.name.trim()) { flash('Le nom du fournisseur est obligatoire.', 'error'); return; }
    setSaving(true);
    try {
      if (editId) {
        await api.updateVendor(editId, form);
      } else {
        await api.createVendor(form);
      }
      setShow(false);
      setForm({ name: '', ice: '', if_number: '', address: '', city: '', phone: '', email: '' });
      setEditId(null);
      flash('Fournisseur enregistré dans la base de données avec succès.');
      load(true);
    } catch (e: any) { flash(e.message, 'error'); } finally { setSaving(false); }
  };

  const remove = (id: number) => {
    setPwTitle('Supprimer le fournisseur');
    setPwDesc('Cette action est définitive. Confirmez pour continuer.');
    setPendingAction(() => async (password: string) => {
      await api.deleteVendor(id, password);
      flash('Fournisseur supprimé de la base de données.');
      setPwOpen(false); setPendingAction(null);
      load(true);
    });
    setPwOpen(true);
  };

  const filtered = list.filter((v) => !search || v.name?.toLowerCase().includes(search.toLowerCase()) || v.ice?.toLowerCase().includes(search.toLowerCase()));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const paged = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  if (loading) return <div className="atlas-crm vendors-page"><PageSkeleton variant="list" /></div>;

  const totalDue = list.reduce((s, v) => s + Number(v.balance_due || 0), 0);
  const withDue = list.filter((v) => Number(v.balance_due || 0) > 0.001).length;
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const newMonth = list.filter((v) => String(v.created_at || '').startsWith(ym)).length;

  return (
    <div className="atlas-crm vendors-page">
      <div className="page-header dock-page-header">
        <h1 className="sr-only">Fournisseurs</h1>
        <TopPageActions>
          <RefreshIconButton onClick={() => load(true)} loading={refreshing} />
          <button title="Nouveau fournisseur" onClick={() => { setEditId(null); setForm({ name: '', ice: '', if_number: '', address: '', city: '', phone: '', email: '' }); wz.reset(); setShow(true); }}><Plus size={16} aria-hidden="true" /><span className="tpa-label">Nouveau fournisseur</span></button>
        </TopPageActions>
      </div>

      <SaveFeedback message={saveMsg} type={saveMsgType} />

      <div className="ac-metric-grid" style={{ marginBottom: 16 }}>
        <div className="ac-metric">
          <div className="as-label">Solde total dû</div>
          <div className="as-value" style={{ fontSize: '1.35rem' }}>{Math.round(totalDue).toLocaleString('fr-FR')} MAD</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>sur {withDue} fournisseur{withDue !== 1 ? 's' : ''}</div>
          {withDue > 0 && <span className="badge" style={{ marginTop: 6, background: '#fef3c7', color: '#92400e' }}>à payer</span>}
        </div>
        <div className="ac-metric">
          <div className="as-label">Nouveaux ce mois</div>
          <div className="as-value" style={{ fontSize: '1.35rem' }}>{newMonth}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>fournisseurs ajoutés</div>
        </div>
        <div className="ac-metric">
          <div className="as-label">Fournisseurs actifs</div>
          <div className="as-value" style={{ fontSize: '1.35rem' }}>{list.length}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>dans le fichier</div>
        </div>
      </div>

      <div className="ac-panel ac-products-filters">
        <div className="search-bar"><input className="ac-search-input" placeholder="Rechercher par nom ou identifiant..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      </div>

      <div className="ac-panel ac-products-table-panel">
        <div className="ac-table-pager-bar">
          <span className="ac-table-pager-meta">{filtered.length} fournisseur{filtered.length === 1 ? '' : 's'} · 20 par page</span>
          <ListPager page={safePage} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />
        </div>
        <div className="table-wrap">
          <table className="data-dense ac-products-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>ICE / Identifiant</th>
                <th>Ville</th>
                <th>Solde</th>
                <th>Statut</th>
                <th>Téléphone</th>
                <th>E-mail</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {paged.map((v) => {
                const due = Number(v.balance_due || 0);
                return (
                  <tr key={v.id}>
                    <td>
                      <span
                        className="party-name party-name-link"
                        role="button"
                        tabIndex={0}
                        title="Modifier"
                        onClick={() => openEdit(v)}
                        onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openEdit(v); } }}
                      >
                        {v.name}
                      </span>
                      {v.ice && <div className="party-sub">{v.ice}</div>}
                    </td>
                    <td>{v.ice || '—'}</td>
                    <td>{v.city || '—'}</td>
                    <td><span className="mono-amt">{Math.round(due).toLocaleString('fr-FR')} MAD</span></td>
                    <td>
                      {due > 0.001
                        ? <span className="credit-pill warn">Solde dû</span>
                        : <span className="credit-pill ok">Soldé</span>}
                    </td>
                    <td>{v.phone || '—'}</td>
                    <td>{v.email || '—'}</td>
                    <td className="row-actions-cell"><div className="row-actions">
                      {deleteArmId === v.id ? (
                        <TimedUndoDelete autoStart deleteLabel="Supprimer" undoLabel="Annuler" initialSeconds={10}
                          onConfirm={() => { setDeleteArmId(null); void remove(v.id); }} />
                      ) : (
                        <TimedUndoDelete deleteLabel="Supprimer" undoLabel="Annuler" initialSeconds={10} onConfirm={() => { setDeleteArmId(null); remove(v.id); }} />
                      )}
                    </div></td>
                  </tr>
                );
              })}
              {!filtered.length && (
                <tr><td colSpan={8}>
                    <EmptyState
                      title="Aucun fournisseur"
                      description="Ajoutez vos fournisseurs pour les rattacher aux factures d'achat."
                      actionLabel="Ajouter mon premier fournisseur"
                      onAction={() => { setEditId(null); setForm({ name: '', ice: '', if_number: '', address: '', city: '', phone: '', email: '' }); wz.reset(); setShow(true); }}
                      icon="building"
                    />
                  </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {show && (
        <FloatingPortal><div className="modal-overlay" onClick={() => { setShow(false); setFieldErrors({}); wz.reset(); }}>
          <div className="modal step-wizard" role="dialog" aria-modal="true" aria-labelledby="vendor-wizard-title" onClick={(e) => e.stopPropagation()}>
            <WizardHeader eyebrow="FICHE FOURNISSEUR" title={editId ? 'Modifier le fournisseur' : 'Nouveau fournisseur'} titleId="vendor-wizard-title" wz={wz} steps={VENDOR_STEPS} />
            <div className="step-wizard__body">
            <WizardIntro step={VENDOR_STEPS[wz.step - 1]} />
            <StepBody active={wz.step === 1}>
            <div className="form-row"><label>Nom *</label><input className={fieldErrors.name ? 'field-error' : undefined} value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); setFieldErrors((x) => ({ ...x, name: '' })); }} placeholder="Ex. Ciments du Maroc" /><span className="field-error-msg">{fieldErrors.name || ''}</span></div>
            <div className="grid grid-2">
              <div className="form-row"><label>ICE / Identifiant fiscal</label><input className={fieldErrors.ice ? 'field-error' : undefined} value={form.ice} onChange={(e) => { setForm({ ...form, ice: e.target.value }); setFieldErrors((x) => ({ ...x, ice: '' })); }} /></div>
              <div className="form-row"><label>IF</label><input value={form.if_number} onChange={(e) => setForm({ ...form, if_number: e.target.value })} /></div>
            </div>
            </StepBody>
            <StepBody active={wz.step === 2}>
            <div className="form-row"><label>Adresse</label><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
            <div className="grid grid-2">
              <div className="form-row"><label>Ville</label><input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
              <div className="form-row"><label>Téléphone</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            </div>
            <div className="form-row"><label>E-mail</label><input type="email" className={fieldErrors.email ? 'field-error' : undefined} value={form.email} onChange={(e) => { setForm({ ...form, email: e.target.value }); setFieldErrors((x) => ({ ...x, email: '' })); }} placeholder="contact@fournisseur.ma" /><span className="field-error-msg">{fieldErrors.email || ''}</span></div>
            </StepBody>
            <ModalFormError message={firstError(fieldErrors) || ''} />
            </div>
            <WizardFoot
              title={editId ? 'Modifier le fournisseur' : 'Nouveau fournisseur'}
              wz={wz}
              stepLabel={VENDOR_STEPS[wz.step - 1].label}
              onCancel={() => { setShow(false); setFieldErrors({}); wz.reset(); }}
              onBack={() => setFieldErrors({})}
              onNext={() => {
                if (wz.step === 1) {
                  if (!form.name.trim()) {
                    setFieldErrors({ name: 'Le nom du fournisseur est obligatoire.' });
                    return false;
                  }
                  const ice = form.ice.replace(/\s/g, '');
                  if (ice && !/^\d{15}$/.test(ice)) {
                    setFieldErrors({ ice: 'ICE : 15 chiffres (sans espaces).' });
                    return false;
                  }
                }
                setFieldErrors({});
                return true;
              }}
              onSubmit={() => void save()}
              submitLabel={saving ? 'Enregistrement...' : 'Enregistrer dans la base'}
              saving={saving}
            />
          </div>
        </div></FloatingPortal>
      )}

      {pwOpen && pendingAction && (
        <PasswordConfirm
          open={pwOpen}
          title={pwTitle}
          description={pwDesc}
          confirmLabel="Confirmer"
          onCancel={() => { setPwOpen(false); setPendingAction(null); }}
          onConfirm={async (password) => { await pendingAction(password); }}
        />
      )}
    </div>
  );
}
