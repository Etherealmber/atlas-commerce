/**
 * v0.7 — pastille flottante animée qui attire l'attention vers la page de
 * téléchargement de l'APK. Le clic sur le lien ouvre /download dans un
 * nouvel onglet ET masque la pastille ; un × permet de la masquer aussi.
 * Respecte prefers-reduced-motion (voir CSS).
 */
import { useState } from 'react';
import { useLocation } from 'react-router-dom';

const KEY = 'atlas-dl-teaser';

export default function DownloadTeaser() {
  const [hidden, setHidden] = useState<boolean>(() => {
    try { return localStorage.getItem(KEY) === 'off'; } catch { return true; }
  });
  const loc = useLocation();
  if (hidden || loc.pathname === '/download') return null;
  const dismiss = () => {
    try { localStorage.setItem(KEY, 'off'); } catch { /* private mode */ }
    setHidden(true);
  };
  return (
    <div className="atlas-dl-teaser">
      <a
        className="atlas-dl-teaser-link"
        href="/download"
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
