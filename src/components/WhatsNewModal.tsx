import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Heart } from 'lucide-react';
import { APP_CHANNEL, WHATS_NEW_VERSION } from '../version';
import { RELEASES } from '../pages/WhatsNew';
import {
  shouldShowWhatsNewModal,
  markWhatsNewModalSeen,
  markWhatsNewSeen,
} from '../lib/whatsNew';
import { getContributorsForRelease } from '../lib/contributors';
import { isOnboardingPending, isPhoneOnboardingPending } from '../lib/onboarding';

const OTHER_POPUP = '.modal-overlay, .ac-lang-layer, .ac-user-dropdown, .ac-notif-panel, .ac-onboard-layer, .po-layer, .ph-modal-bg, [aria-modal="true"]';

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
    // Never pop over the guided tour or another open popup (Langue, déconnexion,
    // assistant…): wait until they are closed, then show once.
    let t = 0;
    const tryOpen = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        if (!shouldShowWhatsNewModal()) return;
        if (isOnboardingPending() || isPhoneOnboardingPending() || document.querySelector(OTHER_POPUP)) {
          tryOpen();
          return;
        }
        setOpen(true);
      }, 900);
    };
    tryOpen();
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
        <div className="wn-release-contributors" style={{ marginBottom: 14 }}>
          <span className="wn-contributors-label"><Heart size={13} strokeWidth={2.2} aria-hidden="true" /> Merci à</span>
          {getContributorsForRelease(release.version).map((c) => (
            <a
              key={c.login}
              href={c.url}
              target="_blank"
              rel="noreferrer noopener"
              className="wn-contributor-pill"
              title={`${c.name} (${c.handle})`}
            >
              {c.avatarUrl ? <img src={c.avatarUrl} alt="" width={20} height={20} className="wn-contributor-avatar" loading="lazy" decoding="async" /> : <span className="wn-contributor-fallback" aria-hidden="true">{c.name.slice(0, 1).toUpperCase()}</span>}
              <span className="wn-contributor-name">{c.handle}</span>
            </a>
          ))}
        </div>
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
