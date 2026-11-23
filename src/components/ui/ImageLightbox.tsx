import { useEffect, useRef, useState, type CSSProperties, type FC } from 'react';
import { createPortal } from 'react-dom';
import { X, ZoomIn, ZoomOut } from 'lucide-react';
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
 * image click toggle 1x / 2x zoom with drag-to-pan on the expanded stage.
 */
export const ImageLightbox: FC<Props> = ({ src, name, onClose }) => {
  const [zoom, setZoom] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [baseSize, setBaseSize] = useState<{ w: number; h: number } | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const safe = sanitizePreviewUrl(src);

  useEffect(() => {
    setZoom(false);
    setBaseSize(null);
  }, [src]);

  useEffect(() => {
    if (!zoom) return;
    const frame = frameRef.current;
    if (!frame) return;
    // Center scrollbars inside the expanded stage once the zoomed image paints.
    const id = requestAnimationFrame(() => {
      if (frame.scrollWidth > frame.clientWidth) {
        frame.scrollLeft = (frame.scrollWidth - frame.clientWidth) / 2;
      }
      if (frame.scrollHeight > frame.clientHeight) {
        frame.scrollTop = Math.max(0, (frame.scrollHeight - frame.clientHeight) / 3);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [zoom]);

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

  const toggleZoom = () => {
    if (!zoom && frameRef.current) {
      const img = frameRef.current.querySelector('img');
      if (img) {
        const rect = img.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setBaseSize({ w: Math.round(rect.width), h: Math.round(rect.height) });
        }
      }
    }
    setZoom((z) => !z);
  };

  const zoomImgStyle: CSSProperties | undefined = zoom && baseSize
    ? {
        width: Math.round(baseSize.w * 1.9),
        height: Math.round(baseSize.h * 1.9),
        maxWidth: 'none',
        maxHeight: 'none',
      }
    : undefined;

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
            title={zoom ? 'Réduire (1×)' : 'Zoomer (1,9×)'}
            onClick={toggleZoom}
          >
            {zoom ? <ZoomOut size={16} aria-hidden="true" /> : <ZoomIn size={16} aria-hidden="true" />}
            <span>{zoom ? '1×' : 'Zoom'}</span>
          </button>
          <button
            type="button"
            className="atlas-lightbox-close"
            aria-label="Fermer"
            title="Fermer (Échap)"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
          >
            <X size={16} strokeWidth={2.3} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        ref={frameRef}
        className={`atlas-lightbox-frame${zoom ? ' atlas-lightbox-frame--zoom' : ''}${dragging ? ' is-dragging' : ''}`}
        onPointerDown={(e) => {
          if (!zoom || e.button !== 0) return;
          const frame = frameRef.current;
          if (!frame) return;
          dragRef.current = {
            x: e.clientX,
            y: e.clientY,
            left: frame.scrollLeft,
            top: frame.scrollTop,
            moved: false,
          };
          setDragging(true);
        }}
        onPointerMove={(e) => {
          const d = dragRef.current;
          const frame = frameRef.current;
          if (!d || !frame) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (Math.abs(dx) > 5 || Math.abs(dy) > 5) d.moved = true;
          frame.scrollLeft = d.left - dx;
          frame.scrollTop = d.top - dy;
        }}
        onPointerUp={() => {
          setDragging(false);
        }}
        onPointerCancel={() => {
          dragRef.current = null;
          setDragging(false);
        }}
        onClick={(e) => {
          e.stopPropagation();
          if (dragRef.current?.moved) {
            dragRef.current = null;
            return;
          }
          dragRef.current = null;
          toggleZoom();
        }}
        title={zoom ? 'Glisser pour déplacer · Cliquer pour réduire' : 'Cliquer pour agrandir'}
      >
        {safe ? (
          <Lens
            src={safe}
            alt={name || 'Aperçu de l’image'}
            disabled={zoom}
            imgStyle={zoomImgStyle}
            onImageLoad={(e) => {
              const img = e.currentTarget;
              if (!zoom && img) {
                const r = img.getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {
                  setBaseSize({ w: Math.round(r.width), h: Math.round(r.height) });
                }
              }
            }}
          />
        ) : null}
      </div>
    </div>,
    document.body,
  );
};

export default ImageLightbox;
