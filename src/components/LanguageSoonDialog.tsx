import { useEffect, useRef, type FC } from 'react';
import { createPortal } from 'react-dom';
import { Check, Languages, X } from 'lucide-react';

import { LANGS, setLang, useLang, type Lang } from '../i18n/core';

/**
 * Langue de l’interface — français, arabe (RTL) et anglais.
 * Utilisé depuis Paramètres, le menu utilisateur du haut, la page de connexion
 * et les réglages mobiles. Le choix est mémorisé sur l’appareil et transmis à
 * l’app Android native (window.AtlasAndroid.setLanguage).
 */
export const LANGUAGE_SOON_MESSAGE = 'Choisissez la langue de l’interface. L’arabe s’affiche de droite à gauche.';
export const LANGUAGE_DIALOG_MESSAGE = LANGUAGE_SOON_MESSAGE;

const LANG_LABEL: Record<Lang, string> = { fr: 'Français', ar: 'Arabe', en: 'Anglais' };

export const LanguageSoonDialog: FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const lang = useLang();
  const okRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => okRef.current?.focus(), 30);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
      if (previousFocus?.isConnected) previousFocus.focus();
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
            <span>{LANGUAGE_DIALOG_MESSAGE}</span>
          </div>
          <button type="button" className="ac-lang-x" aria-label="Fermer" onClick={onClose}>
            <X size={15} strokeWidth={2} aria-hidden />
          </button>
        </div>
        <ul className="ac-lang-list" role="radiogroup" aria-labelledby="ac-lang-title">
          {LANGS.map((l) => {
            const selected = l.code === lang;
            return (
              <li key={l.code}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  onKeyDown={(event) => {
                    const index = LANGS.findIndex((item) => item.code === l.code);
                    const delta = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
                    if (!delta) return;
                    event.preventDefault();
                    const next = (index + delta + LANGS.length) % LANGS.length;
                    setLang(LANGS[next].code);
                    event.currentTarget.closest('[role="radiogroup"]')?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
                  }}
                  className={`ac-lang-row${selected ? ' is-current' : ''}`}
                  onClick={() => setLang(l.code)}
                >
                  <span className="ac-lang-native notranslate" dir={l.dir} lang={l.code}>{l.native}</span>
                  <span className="ac-lang-label">{selected ? 'Langue actuelle' : LANG_LABEL[l.code]}</span>
                  {selected ? (
                    <span className="ac-lang-check" aria-label="Sélectionnée">
                      <Check size={14} strokeWidth={2.4} aria-hidden />
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="ac-lang-foot">
          <button ref={okRef} type="button" className="ac-lang-ok" onClick={onClose}>
            Terminé
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default LanguageSoonDialog;

export const LanguageDialog = LanguageSoonDialog;
