/**
 * v0.7 — pastille flottante animée qui attire l'attention vers la page de
 * téléchargement de l'APK. Le clic sur le lien ouvre /download dans un
 * nouvel onglet ET masque la pastille ; un × permet de la masquer aussi.
 * Respecte prefers-reduced-motion (voir CSS).
 */
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getToken } from '../auth';

const KEY = 'atlas-dl-teaser';

export default function DownloadTeaser() {
  const [hidden, setHidden] = useState<boolean>(() => {
    try { return localStorage.getItem(KEY) === 'off'; } catch { return true; }
  });
  const loc = useLocation();
  if (hidden || ['/', '/download', '/android', '/desktop'].includes(loc.pathname)) return null;
  const dismiss = () => {
    try { localStorage.setItem(KEY, 'off'); } catch { /* private mode */ }
    setHidden(true);
  };
  // v0.7.1 — never cover the floating buttons: stack above the Agent fab
  // when connected, and above both fabs on /settings.
  const loggedIn = !!getToken();
  const stack = loc.pathname === '/settings' ? ' atlas-dl-teaser--settings' : loggedIn ? ' atlas-dl-teaser--app' : '';
  return (
    <div className={`atlas-dl-teaser${stack}`}>
      <a
        className="atlas-dl-teaser-link"
        href="/android"
        target="_blank"
        rel="noopener noreferrer"
        onClick={dismiss}
      >
        <span className="atlas-dl-teaser-dot" aria-hidden />
        App Android · Télécharger l&apos;APK
      </a>
      <button type="button" aria-label="Masquer la suggestion" onClick={dismiss}>×</button>
    </div>
  );
}
