import { useEffect, useState, type FC } from 'react';
import { createPortal } from 'react-dom';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { sanitizePreviewUrl } from '../../auth';
import { Lens } from './Bits';
import './ImageLightbox.css';

type Props = {
  src: string;
  name?: string;
  onClose: () => void;
};

/**
 * In-app image viewer (attachment, product, capture, and preview popups).
 * Smooth backdrop & scale entrance, Esc or outside click closes, toolbar and
 * image click toggle 1x / 1.8x zoom.
 */
export const ImageLightbox: FC<Props> = ({ src, name, onClose }) => {
  const [zoom, setZoom] = useState(false);
  const safe = sanitizePreviewUrl(src);

  useEffect(() => {
    setZoom(false);
  }, [src]);

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

  // Portal to <body>: ancestor transforms (e.g. drawer/panel animations) would
  // otherwise trap position:fixed overlays inside a narrower container.
  return createPortal(
    <div
      className="atlas-lightbox-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={name || 'Aperçu de l’image'}
      onClick={onClose}
    >
      <div className="atlas-lightbox-bar" onClick={(e) => e.stopPropagation()}>
        {name ? <p className="atlas-lightbox-name">{name}</p> : <span />}
        <div className="atlas-lightbox-actions">
          <button
            type="button"
            className="atlas-lightbox-tool"
            aria-label={zoom ? 'Réduire le zoom' : 'Agrandir le zoom'}
            aria-pressed={zoom}
            title={zoom ? 'Réduire (1×)' : 'Zoomer (1,8×)'}
            onClick={() => setZoom((z) => !z)}
          >
            {zoom ? <ZoomOut size={16} aria-hidden="true" /> : <ZoomIn size={16} aria-hidden="true" />}
            <span>{zoom ? '1×' : 'Zoom'}</span>
          </button>
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
      </div>

      <div
        className={`atlas-lightbox-frame${zoom ? ' atlas-lightbox-frame--zoom' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setZoom((z) => !z);
        }}
        title={zoom ? 'Cliquer pour réduire' : 'Cliquer pour agrandir'}
      >
        {safe ? <Lens src={safe} alt={name || 'Aperçu de l’image'} /> : null}
      </div>
    </div>,
    document.body,
  );
};

export default ImageLightbox;
