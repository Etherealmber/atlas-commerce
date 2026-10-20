import { useNavigate } from 'react-router-dom';
import { getDisplayName, getUsername, getRole, clearToken } from '../auth';
import { APP_VERSION } from '../version';

type Props = {
  theme: string;
  glass: boolean;
  onTheme: (t: 'light' | 'dark' | 'system') => void;
  onGlass: (v: boolean) => void;
};

export default function PhoneSettings({ theme, onTheme }: Props) {
  const nav = useNavigate();

  return (
    <div className="ph-settings">
      <header className="ph-page-head" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h1 style={{ margin: 0, fontSize: '1.25rem' }}>Paramètres</h1>
      </header>

      <section className="ph-settings-card">
        <h2>Compte</h2>
        <div className="ph-settings-row">
          <span>Nom</span>
          <strong>{getDisplayName() || getUsername() || '—'}</strong>
        </div>
        <div className="ph-settings-row">
          <span>Rôle</span>
          <strong>{getRole() || '—'}</strong>
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
          <strong className="mono">{APP_VERSION}</strong>
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
