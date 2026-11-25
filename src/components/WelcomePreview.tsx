import { ArrowLeft, ArrowRight } from 'lucide-react';
import { WELCOME_PREVIEWS } from '../lib/welcome';
import { useLang } from '../i18n/core';
import { themedShotSrc } from '../lib/useDocTheme';

/** One real capture per welcome screen; navigation belongs to the full wizard. */
export function WelcomePreview({ index, onPrevious, onNext }: {
  index: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const preview = WELCOME_PREVIEWS[index];
  const lang = useLang();
  const src = preview.src === '/shots/site-dashboard-light.webp' && lang !== 'fr'
    ? `/shots/site-dashboard-${lang}-light.webp`
    : themedShotSrc(preview.src, 'light', lang);
  return (
    <section className="welcome-panel welcome-panel-wide welcome-preview-step" aria-labelledby="welcome-preview-title">
      <p className="welcome-kicker">Découvrez Atlas · Aperçu {index + 1} sur {WELCOME_PREVIEWS.length}</p>
      <h2 id="welcome-preview-title" className="welcome-title" tabIndex={-1}>{preview.title}</h2>
      <p className="welcome-sub">{preview.description}</p>
      <figure className="welcome-preview-media">
        <img src={src} alt={preview.alt} decoding="async" />
      </figure>
      <div className="welcome-nav">
        <button type="button" className="welcome-btn-ghost" onClick={onPrevious}>
          <ArrowLeft size={16} aria-hidden="true" /> Précédent
        </button>
        <button type="button" className="welcome-cta" onClick={onNext}>
          Suivant <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
