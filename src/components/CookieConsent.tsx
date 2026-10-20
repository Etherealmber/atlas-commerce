import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  acceptAll,
  acceptNecessaryOnly,
  getConsent,
  hasDecidedConsent,
  saveConsent,
  type ConsentRecord,
} from '../lib/cookieConsent';

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [panel, setPanel] = useState<'banner' | 'details'>('banner');
  const [prefs, setPrefs] = useState(true);
  const [analytics, setAnalytics] = useState(false);

  useEffect(() => {
    setVisible(!hasDecidedConsent());
    const open = () => {
      const c = getConsent();
      if (c) {
        setPrefs(c.preferences);
        setAnalytics(c.analytics);
      }
      setPanel('details');
      setVisible(true);
    };
    window.addEventListener('atlas-consent-open', open);
    return () => window.removeEventListener('atlas-consent-open', open);
  }, []);

  const closeWith = (record: ConsentRecord) => {
    setPrefs(record.preferences);
    setAnalytics(record.analytics);
    setVisible(false);
    setPanel('banner');
  };

  if (!visible || typeof document === 'undefined') return null;

  const body = (
    <div
      className="cookie-consent"
      role="dialog"
      aria-labelledby="cookie-consent-title"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && hasDecidedConsent()) {
          setVisible(false);
          setPanel('banner');
        }
      }}
    >
      <div className="cookie-consent-card" onClick={(e) => e.stopPropagation()}>
        <div className="cookie-consent-head">
          <h2 id="cookie-consent-title">Cookies &amp; données locales</h2>
          <p>
            Atlas Commerce enregistre localement ce qui est nécessaire à la session sécurisée
            (connexion, rôles). Aucune publicité. Détails dans la{' '}
            <a href="/privacy" onClick={() => setVisible(false)}>
              politique de confidentialité
            </a>
            .
          </p>
        </div>

        {panel === 'details' && (
          <div className="cookie-consent-details">
            <label className="cookie-consent-row">
              <input type="checkbox" checked disabled readOnly />
              <span>
                <strong>Nécessaires</strong>
                <em>
                  Session, sécurité (OTP, limitation des abus), protection anti-bot éventuelle
                  (Cloudflare Turnstile). Toujours actifs.
                </em>
              </span>
            </label>
            <label className="cookie-consent-row">
              <input
                type="checkbox"
                checked={prefs}
                onChange={(e) => setPrefs(e.target.checked)}
              />
              <span>
                <strong>Préférences</strong>
                <em>Thème clair/sombre, liquid glass, guide d&apos;accueil.</em>
              </span>
            </label>
            <label className="cookie-consent-row">
              <input
                type="checkbox"
                checked={analytics}
                onChange={(e) => setAnalytics(e.target.checked)}
              />
              <span>
                <strong>Mesure d&apos;audience</strong>
                <em>Non utilisée aujourd&apos;hui — réservée à un outil anonymisé futur.</em>
              </span>
            </label>
          </div>
        )}

        <div className="cookie-consent-actions">
          {panel === 'banner' ? (
            <>
              <button type="button" className="cookie-btn linkish" onClick={() => setPanel('details')}>
                Personnaliser
              </button>
              <button type="button" className="cookie-btn secondary" onClick={() => closeWith(acceptNecessaryOnly())}>
                Nécessaires seulement
              </button>
              <button type="button" className="cookie-btn primary" onClick={() => closeWith(acceptAll())}>
                Tout accepter
              </button>
            </>
          ) : (
            <>
              <button type="button" className="cookie-btn linkish" onClick={() => setPanel('banner')}>
                Retour
              </button>
              <button
                type="button"
                className="cookie-btn primary"
                onClick={() => closeWith(saveConsent({ preferences: prefs, analytics }, 'custom'))}
              >
                Enregistrer mes choix
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(body, document.body);
}
