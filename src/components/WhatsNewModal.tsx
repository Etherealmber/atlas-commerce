import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { APP_VERSION, APP_BUILD_DATE, APP_CHANNEL } from '../version';
import {
  shouldShowWhatsNewModal,
  markWhatsNewModalSeen,
  markWhatsNewSeen,
} from '../lib/whatsNew';

/** Lightweight once-per-version intro modal (P3). */
export default function WhatsNewModal() {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (
      location.pathname.startsWith('/whats-new') ||
      location.pathname.startsWith('/login') ||
      location.pathname.startsWith('/welcome')
    ) {
      setOpen(false);
      return;
    }
    const t = window.setTimeout(() => {
      if (shouldShowWhatsNewModal()) setOpen(true);
    }, 900);
    return () => window.clearTimeout(t);
  }, [location.pathname]);

  if (!open) return null;

  const dismiss = (goFull = false) => {
    markWhatsNewModalSeen();
    setOpen(false);
    try {
      window.dispatchEvent(new CustomEvent('atlas-whats-new-seen'));
    } catch { /* */ }
    if (goFull) {
      markWhatsNewSeen();
      navigate('/whats-new');
    }
  };

  return (
    <div className="whats-new-modal-backdrop" role="presentation" onClick={() => dismiss(false)}>
      <div
        className="whats-new-modal card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="atlas-eyebrow" style={{ marginBottom: 6 }}>Mise à jour</p>
        <h2 id="whats-new-modal-title" style={{ margin: '0 0 8px', fontSize: '1.25rem' }}>
          Atlas Commerce {APP_VERSION}
        </h2>
        <p className="muted" style={{ margin: '0 0 16px', lineHeight: 1.45 }}>
          Canal <strong>{APP_CHANNEL}</strong> · build {APP_BUILD_DATE}.  
          Paramètres plein écran, nouveautés versionnées, et améliorations mobile.
        </p>
        <ul className="whats-new-modal-bullets">
          <li>Mode paramètres / à propos sans barre latérale</li>
          <li>Page Nouveautés avec historique détaillé</li>
          <li>Recherche dans les paramètres + barre d’enregistrement</li>
        </ul>
        <div className="whats-new-modal-actions">
          <button type="button" className="secondary" onClick={() => dismiss(false)}>
            Plus tard
          </button>
          <button type="button" onClick={() => dismiss(true)}>
            Voir les nouveautés
          </button>
        </div>
      </div>
    </div>
  );
}
