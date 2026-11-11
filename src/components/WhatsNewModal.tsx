import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { APP_CHANNEL, WHATS_NEW_VERSION } from '../version';
import { RELEASES } from '../pages/WhatsNew';
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

  const release = RELEASES.find((r) => r.version === WHATS_NEW_VERSION);
  if (!open || !release) return null;

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
          Atlas Commerce {release.version}
        </h2>
        <p className="muted" style={{ margin: '0 0 16px', lineHeight: 1.45 }}>
          Canal <strong>{APP_CHANNEL}</strong> · notes du {release.date}.
        </p>
        <ul className="whats-new-modal-bullets">
          {release.sections.flatMap((s) => s.items)
            .slice(0, 3)
            .map((it) => (
              <li key={it.id}>{it.text}</li>
            ))}
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
