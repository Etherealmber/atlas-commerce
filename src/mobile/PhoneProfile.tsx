import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { clearToken, getDisplayName, getUsername, getRole, setProfileCache } from '../auth';

function roleLabel(role: string) { return ({ owner: 'Propriétaire (Admin)', admin: 'Administrateur', secretaire: 'Secrétaire · Ventes', stock: 'Magasinier · Stock' } as Record<string, string>)[role] || 'Opérateur'; }
export default function PhoneProfile({ onChanged }: { onChanged?: () => void }) {
  const nav = useNavigate();
  const [form, setForm] = useState({ display_name: '', email: '', phone: '', avatar_url: '', notes: '' });
  const [loaded, setLoaded] = useState(false); const [saving, setSaving] = useState(false); const [message, setMessage] = useState('');
  useEffect(() => { let active = true; api.getMe().then(r => { if (!active) return; const m = r.data || {}; setForm({ display_name: m.display_name || '', email: m.email || '', phone: m.phone || '', avatar_url: m.avatar_url || '', notes: m.notes || '' }); setLoaded(true); }).catch(() => { if (active) setMessage('Impossible de charger le profil.'); }); return () => { active = false; }; }, []);
  const save = async (e: FormEvent) => { e.preventDefault(); if (saving) return; setSaving(true); setMessage(''); try { const display_name = form.display_name.trim().slice(0, 80); await api.updateMe({ display_name, email: form.email.trim().slice(0, 120), phone: form.phone.trim().slice(0, 40) }); setProfileCache({ display_name }); setForm(current => ({ ...current, display_name })); onChanged?.(); setMessage('Profil enregistré.'); } catch { setMessage('Impossible d’enregistrer le profil. Réessayez.'); } finally { setSaving(false); } };
  return <div className="ph-settings ph-native-settings"><section className="ph-settings-card"><h2>Compte</h2><div className="ph-settings-row"><span>Nom</span><strong>{getDisplayName() || getUsername() || '—'}</strong></div><div className="ph-settings-row"><span>Rôle</span><strong>{roleLabel(getRole())}</strong></div></section>
    <section className="ph-settings-card"><h2>Modifier le profil</h2>{loaded ? <form className="pb-form" onSubmit={save}><label>Nom affiché<input value={form.display_name} maxLength={120} onChange={e => setForm({ ...form, display_name: e.target.value })} /></label><label>E-mail<input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label><label>Téléphone<input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label><button className="ph-primary" type="submit" disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button></form> : !message && <p role="status">Chargement du profil…</p>}{message && <p role="status">{message}</p>}</section>
    <section className="ph-settings-card"><h2>Appareils</h2><p className="ph-settings-hint">Autoriser une demande de connexion desktop avec un QR compatible.</p><button type="button" className="ph-chip" onClick={() => nav('/m/device-scan')}>Scanner un appareil</button></section>
    <section className="ph-settings-card"><button type="button" className="ph-primary" style={{ width: '100%' }} onClick={() => { clearToken(); window.location.href = '/login'; }}>Se déconnecter</button></section></div>;
}
