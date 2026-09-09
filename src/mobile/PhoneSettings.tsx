import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDensity, setDensity, isGlassEnabled, setGlassEnabled, type Density } from '../lib/density';
import { getDisplayName, getUsername, getRole, canAccessSettingsBeyondProfile } from '../auth';
import { APP_VERSION } from '../version';

type ThemeMode = 'light' | 'dark' | 'system';

function readTheme(): ThemeMode {
  try {
    const t = localStorage.getItem('atlas-theme') || localStorage.getItem('theme') || 'system';
    if (t === 'dark' || t === 'light' || t === 'system') return t;
  } catch { /* */ }
  return 'system';
}

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = mode === 'dark' || (mode === 'system' && prefersDark);
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  root.classList.toggle('dark', dark);
  try {
    localStorage.setItem('atlas-theme', mode);
  } catch { /* */ }
}

/** Phone-native settings — densite, glass, theme, profil. */
export default function PhoneSettings() {
  const nav = useNavigate();
  const [density, setDensityState] = useState<Density>(() => getDensity());
  const [glass, setGlassState] = useState(() => isGlassEnabled());
  const [theme, setTheme] = useState<ThemeMode>(() => readTheme());

  useEffect(() => {
    document.documentElement.setAttribute('data-density', density);
  }, [density]);

  const onDensity = (d: Density) => {
    setDensity(d);
    setDensityState(d);
  };
  const onGlass = (on: boolean) => {
    setGlassEnabled(on);
    setGlassState(on);
  };
  const onTheme = (m: ThemeMode) => {
    setTheme(m);
    applyTheme(m);
  };

  return (
    <div className="phone-panel phone-settings">
      <header className="ph-settings-head">
        <button type="button" className="ph-back" onClick={() => nav(-1)} aria-label="Retour">
          ←
        </button>
        <h1>Paramètres</h1>
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
        <h2>Apparence</h2>
        <p className="ph-settings-hint">Densité et Liquid Glass (comme sur le bureau).</p>
        <div className="ph-seg">
          <button type="button" className={density === 'compact' ? 'on' : ''} onClick={() => onDensity('compact')}>
            Compact
          </button>
          <button type="button" className={density === 'comfortable' ? 'on' : ''} onClick={() => onDensity('comfortable')}>
            Confort
          </button>
        </div>
        <div className="ph-seg" style={{ marginTop: 10 }}>
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
        <label className="ph-toggle-row">
          <span>Liquid Glass</span>
          <input type="checkbox" checked={glass} onChange={(e) => onGlass(e.target.checked)} />
        </label>
      </section>

      {canAccessSettingsBeyondProfile() && (
        <section className="ph-settings-card">
          <h2>Société (PC)</h2>
          <p className="ph-settings-hint">
            PDF, TVA, utilisateurs et intégrations se gèrent mieux sur ordinateur.
          </p>
          <button type="button" className="ph-primary" onClick={() => { window.location.href = '/settings'; }}>
            Ouvrir paramètres complets
          </button>
        </section>
      )}

      <section className="ph-settings-card">
        <h2>Application</h2>
        <div className="ph-settings-row">
          <span>Version</span>
          <strong className="mono">{APP_VERSION}</strong>
        </div>
      </section>
    </div>
  );
}
