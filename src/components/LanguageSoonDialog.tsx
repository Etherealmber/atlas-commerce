import { useEffect, useRef, type FC } from 'react';
import { createPortal } from 'react-dom';
import { Check, Languages, X } from 'lucide-react';

/**
 * Langue de l’interface — v0.9.3.
 * Seul le français est disponible ; l’arabe et l’anglais arrivent.
 * Utilisé depuis Paramètres (barre latérale + section Profil), le menu
 * utilisateur du haut et les réglages mobiles.
 */
export const LANGUAGE_SOON_MESSAGE = 'Bientôt disponible — l’arabe et l’anglais arrivent.';

const LANGS: { code: string; native: string; label: string; ready: boolean; dir?: 'rtl' }[] = [
  { code: 'fr', native: 'Français', label: 'Langue actuelle', ready: true },
  { code: 'ar', native: 'العربية', label: 'Arabe', ready: false, dir: 'rtl' },
  { code: 'en', native: 'English', label: 'Anglais', ready: false },
];

export const LanguageSoonDialog: FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const okRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => okRef.current?.focus(), 30);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
    };
    // Only `open` drives this effect: parents pass inline callbacks, and re-running it on
    // every parent render re-focused the button and could look like the popup reset itself.
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="ac-lang-layer" role="dialog" aria-modal="true" aria-labelledby="ac-lang-title">
      <div className="ac-lang-backdrop" aria-hidden onClick={onClose} />
      <div className="ac-lang-card">
        <div className="ac-lang-head">
          <span className="ac-lang-ico" aria-hidden>
            <Languages size={18} strokeWidth={1.9} />
          </span>
          <div className="ac-lang-titles">
            <strong id="ac-lang-title">Langue</strong>
            <span>{LANGUAGE_SOON_MESSAGE}</span>
          </div>
          <button type="button" className="ac-lang-x" aria-label="Fermer" onClick={onClose}>
            <X size={15} strokeWidth={2} aria-hidden />
          </button>
        </div>
        <ul className="ac-lang-list">
          {LANGS.map((l) => (
            <li key={l.code} className={`ac-lang-row${l.ready ? ' is-current' : ' is-soon'}`} aria-disabled={!l.ready}>
              <span className="ac-lang-native" dir={l.dir} lang={l.code}>{l.native}</span>
              <span className="ac-lang-label">{l.label}</span>
              {l.ready ? (
                <span className="ac-lang-check" aria-label="Sélectionnée">
                  <Check size={14} strokeWidth={2.4} aria-hidden />
                </span>
              ) : (
                <span className="ac-lang-soon">Bientôt</span>
              )}
            </li>
          ))}
        </ul>
        <div className="ac-lang-foot">
          <button ref={okRef} type="button" className="ac-lang-ok" onClick={onClose}>
            Compris
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default LanguageSoonDialog;
