import { useEffect, useState, type FC } from 'react';
import { sanitizePreviewUrl } from '../../auth';
import { Lens } from './Bits';
import './ImageLightbox.css';

type Props = {
  src: string;
  name?: string;
  onClose: () => void;
};

/**
 * In-app image viewer (attachment popups). See-through backdrop, Esc or
 * outside click closes, click on the image toggles 1x / 2x zoom.
 */
export const ImageLightbox: FC<Props> = ({ src, name, onClose }) => {
  const [zoom, setZoom] = useState(false);
  const safe = sanitizePreviewUrl(src);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.documentElement.classList.add('atlas-overlay-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('atlas-overlay-open');
    };
  }, [onClose]);

  return (
    <div
      className="atlas-lightbox-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={name || 'Image'}
      onClick={onClose}
    >
      <div
        className={`atlas-lightbox-frame${zoom ? ' atlas-lightbox-frame--zoom' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setZoom((z) => !z);
        }}
        title={zoom ? 'Réduire' : 'Agrandir'}
      >
        {safe ? <Lens src={safe} alt={name || 'Pièce jointe'} /> : null}
      </div>
      {name ? <p className="atlas-lightbox-name">{name}</p> : null}
      <button
        type="button"
        className="atlas-lightbox-close modal-close"
        aria-label="Fermer"
        title="Fermer (Échap)"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
};

export default ImageLightbox;
