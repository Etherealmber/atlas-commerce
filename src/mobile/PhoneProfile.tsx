import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { clearToken, getDisplayName, getUsername, getRole, setProfileCache } from '../auth';
import { ChevronRight, MonitorSmartphone, Edit3, LogOut, Settings, UserRound } from 'lucide-react';
import { AvatarImage } from '../components/ui/AvatarImage';
import PhoneDialog from './PhoneDialog';
import { timeZoneOptions } from '../lib/profilePrefs';
import { PhoneAppearanceSettings, type PhonePreferenceProps } from './PhoneSettings';
import Select from '../components/ui/Select';

function roleLabel(role: string) { return ({ owner: 'Propriétaire (Admin)', admin: 'Administrateur', secretaire: 'Secrétaire · Ventes', stock: 'Magasinier · Stock' } as Record<string, string>)[role] || 'Opérateur'; }
type ProfileFields = { display_name: string; email: string; phone: string; job_title: string; working_hours: string; timezone: string };
const EMPTY_PROFILE: ProfileFields = { display_name: '', email: '', phone: '', job_title: '', working_hours: '', timezone: 'Africa/Casablanca' };
const fieldsFrom = (m: any): ProfileFields => ({ display_name: m?.display_name || '', email: m?.email || '', phone: m?.phone || '', job_title: m?.job_title || '', working_hours: m?.working_hours || '', timezone: m?.timezone || 'Africa/Casablanca' });
export default function PhoneProfile({ onChanged, preferences }: { onChanged?: () => void; preferences?: PhonePreferenceProps }) {
  const nav = useNavigate();
  const [form, setForm] = useState<ProfileFields>(EMPTY_PROFILE); const savedProfile = useRef(form);
  const [loaded, setLoaded] = useState(false); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const savingRef = useRef(false);
  const [message, setMessage] = useState(''); const [edit, setEdit] = useState(false); const [confirmLogout, setConfirmLogout] = useState(false);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const id = ++generation.current; setLoading(true); setMessage('');
    try { const r = await api.getMe(); if (id !== generation.current) return; const fields = fieldsFrom(r.data || {}); savedProfile.current = fields; setForm(fields); setLoaded(true); }
    catch { if (id === generation.current) setMessage('Impossible de charger le profil.'); }
    finally { if (id === generation.current) setLoading(false); }
  }, []);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  const save = async (e: FormEvent) => {
    e.preventDefault(); if (savingRef.current) return;
    savingRef.current = true; setSaving(true); setMessage('');
    try { const display_name = form.display_name.trim().slice(0, 80); const r: any = await api.updateMe({ display_name, email: form.email.trim().slice(0, 120), phone: form.phone.trim().slice(0, 40), job_title: form.job_title.trim().slice(0, 60), working_hours: form.working_hours.trim().slice(0, 40), timezone: form.timezone }); setProfileCache({ display_name }); savedProfile.current = fieldsFrom({ ...form, display_name, ...r?.data }); setForm(savedProfile.current); onChanged?.(); setEdit(false); setMessage('Profil enregistré.'); }
    catch (err: any) { setMessage(err?.message ? `Impossible d’enregistrer le profil : ${err.message}` : 'Impossible d’enregistrer le profil. Réessayez.'); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const username = getUsername() || ''; const name = getDisplayName() || username || 'Mon profil';
  return <div className="ph-settings ph-native-settings ph-profile">
    <section className="ph-settings-card ph-profile-header"><div className="ph-profile-identity"><div className="ph-profile-avatar"><AvatarImage className="ph-profile-avatar-image" fallback={<span>{(name.trim()[0] || 'A').toUpperCase()}</span>} /></div><div><strong>{name}</strong><small>{username ? `@${username}` : roleLabel(getRole())}</small><small>{roleLabel(getRole())}</small></div><button type="button" className="ph-native-icon" aria-label="Modifier le profil" disabled={!loaded || loading} onClick={() => { setMessage(''); setEdit(true); }}><Edit3 size={20} /></button></div>
      <button type="button" className="ph-native-outline" onClick={() => nav('/m/device-scan')}><MonitorSmartphone size={19} /> Appareils liés</button>
      <button type="button" className="ph-native-outline" onClick={() => setConfirmLogout(true)}><LogOut size={19} /> Se déconnecter de cette session</button>
      {loading && !loaded && <p role="status">Chargement du profil…</p>}{message && !edit && <p role="status">{message}{!loaded && <button type="button" className="ph-native-text" onClick={() => void load()}>Réessayer</button>}</p>}
    </section>
    <section className="ph-settings-card"><h2><UserRound size={19} aria-hidden="true" /> Compte</h2><div className="ph-settings-row"><span>Nom</span><strong>{name}</strong></div><div className="ph-settings-row"><span>Rôle</span><strong>{roleLabel(getRole())}</strong></div>{form.job_title && <div className="ph-settings-row"><span>Fonction</span><strong>{form.job_title}</strong></div>}{form.working_hours && <div className="ph-settings-row"><span>Horaires</span><strong>{form.working_hours}</strong></div>}<div className="ph-settings-row"><span>Fuseau horaire</span><strong>{timeZoneOptions(form.timezone).find(z => z.id === form.timezone)?.label || form.timezone}</strong></div></section>
    {preferences && <PhoneAppearanceSettings {...preferences} />}
    <section className="ph-settings-card"><h2><Settings size={19} aria-hidden="true" /> Apparence, navigation &amp; animations</h2><button type="button" className="ph-setting-link" onClick={() => nav('/m/settings', { state: { phoneBack: '/m/profile' } })}><Settings size={20} aria-hidden="true" /><span><strong>Paramètres</strong><small>Apparence, navigation et scanner</small></span><ChevronRight size={18} aria-hidden="true" /></button></section>
    {edit && <PhoneDialog className="ph-native-dialog ph-profile-edit" titleId="ph-profile-edit-title" onClose={() => { if (!saving) { setEdit(false); setMessage(''); setForm(savedProfile.current); } }}><form onSubmit={save} className="ph-sale-fields"><h2 id="ph-profile-edit-title">Modifier le profil</h2><label>Nom affiché<input value={form.display_name} maxLength={80} disabled={saving} onChange={e => setForm({ ...form, display_name: e.target.value })} /></label><label>E-mail<input type="email" value={form.email} maxLength={120} disabled={saving} onChange={e => setForm({ ...form, email: e.target.value })} /></label><label>Téléphone<input type="tel" value={form.phone} maxLength={40} disabled={saving} onChange={e => setForm({ ...form, phone: e.target.value })} /></label><label>Fonction<input value={form.job_title} maxLength={60} placeholder="Gérant, comptable…" disabled={saving} onChange={e => setForm({ ...form, job_title: e.target.value })} /></label><label>Horaires<input value={form.working_hours} maxLength={40} placeholder="09:00 – 18:00" disabled={saving} onChange={e => setForm({ ...form, working_hours: e.target.value })} /></label><label>Fuseau horaire<Select value={form.timezone} disabled={saving} onChange={e => setForm({ ...form, timezone: e.target.value })}>{timeZoneOptions(form.timezone).map(z => <option key={z.id} value={z.id}>{z.label}</option>)}</Select></label>{message && <p role="alert">{message}</p>}<div className="ph-native-dialog-actions"><button type="button" disabled={saving} onClick={() => { setEdit(false); setMessage(''); setForm(savedProfile.current); }}>Annuler</button><button type="submit" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button></div></form></PhoneDialog>}
    {confirmLogout && <PhoneDialog className="ph-native-dialog" titleId="ph-logout-title" onClose={() => setConfirmLogout(false)}><h2 id="ph-logout-title">Se déconnecter ?</h2><p>La session actuelle sera fermée. Les données du serveur ne seront pas supprimées.</p><div className="ph-native-dialog-actions"><button type="button" onClick={() => setConfirmLogout(false)}>Annuler</button><button type="button" className="is-danger" onClick={() => { clearToken(); window.location.href = '/login'; }}>Se déconnecter</button></div></PhoneDialog>}
  </div>;
}
