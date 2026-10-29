import { useNavigate } from 'react-router-dom';
import { getDisplayName, getUsername, getRole, clearToken } from '../auth';
import { DISPLAY_VERSION } from '../version';

type Props = {
  theme: string;
  glass: boolean;
  onTheme: (t: 'light' | 'dark' | 'system') => void;
  onGlass: (v: boolean) => void;
};

/* v255 — same words as the native app (Roles.kt label). */
function androidRoleLabel(role: string | null | undefined): string {
  const r = String(role || '').trim().toLowerCase();
  if (r === 'owner') return 'Propriétaire (Admin)';
  if (r === 'admin') return 'Administrateur';
  if (r === 'secretaire') return 'Secrétaire · Ventes';
  if (r === 'stock' || r === 'magasinier') return 'Magasinier · Stock';
  return 'Opérateur';
}

export default function PhoneSettings({ theme, onTheme }: Props) {
  const nav = useNavigate();

  return (
    <div className="ph-settings">
      <header className="ph-page-head" style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 12 }}>
        <button
          type="button"
          className="ph-refresh"
          aria-label="Retour"
          style={{ marginLeft: -8 }}
          onClick={() => nav('/m')}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
        </button>
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>Mon profil</h1>
      </header>

      <section className="ph-settings-card">
        <h2>Compte</h2>
        <div className="ph-settings-row">
          <span>Nom</span>
          <strong>{getDisplayName() || getUsername() || '—'}</strong>
        </div>
        <div className="ph-settings-row">
          <span>Rôle</span>
          <strong>{androidRoleLabel(getRole())}</strong>
        </div>
      </section>

      <section className="ph-settings-card">
        <h2>Affichage</h2>
        <p className="ph-settings-hint" style={{ margin: '0 0 10px', fontSize: 13, color: '#9aa3b5' }}>
          Thème de l&apos;application sur cet appareil.
        </p>
        <div className="ph-seg">
          <button type="button" className={theme === 'light' ? 'on' : ''} onClick={() => onTheme('light')}>
            Clair
          </button>
          <button type="button" className={theme === 'dark' ? 'on' : ''} onClick={() => onTheme('dark')}>
            Sombre
          </button>
          <button type="button" className={theme === 'system' ? 'on' : ''} onClick={() => onTheme('system')}>
            Système
          </button>
        </div>
      </section>

      <section className="ph-settings-card">
        <h2>Application</h2>
        <div className="ph-settings-row">
          <span>Version</span>
          <strong className="mono">{DISPLAY_VERSION}</strong>
        </div>
        <div className="ph-settings-row">
          <span>Mode</span>
          <strong>Mobile / PWA</strong>
        </div>
      </section>

      <section className="ph-settings-card">
        <button
          type="button"
          className="ph-primary"
          style={{ width: '100%' }}
          onClick={() => {
            clearToken();
            window.location.href = '/login';
          }}
        >
          Se déconnecter
        </button>
      </section>
    </div>
  );
}
