import { useEffect, useRef, type FC, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * v0.9.4 — confirmation courte (ex. « Se déconnecter ? »).
 * Même carte que le dialogue Langue (`.ac-lang-*`), donc identique en clair
 * et en sombre. Échap ou clic sur le fond = Annuler. Le focus démarre sur
 * « Annuler » pour qu’un Entrée réflexe ne valide pas une action destructive.
 */
export const ConfirmDialog: FC<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  icon?: ReactNode;
  tone?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ open, title, message, confirmLabel, cancelLabel = 'Annuler', icon, tone = 'danger', onConfirm, onCancel }) => {
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => cancelRef.current?.focus(), 30);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(t);
    };
  }, [open, onCancel]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="ac-lang-layer ac-confirm-layer" role="alertdialog" aria-modal="true" aria-labelledby="ac-confirm-title" aria-describedby="ac-confirm-msg">
      <div className="ac-lang-backdrop" aria-hidden onClick={onCancel} />
      <div className={`ac-lang-card ac-confirm-card ac-confirm-card--${tone}`}>
        <div className="ac-lang-head">
          {icon ? (
            <span className="ac-lang-ico ac-confirm-ico" aria-hidden>
              {icon}
            </span>
          ) : null}
          <div className="ac-lang-titles">
            <strong id="ac-confirm-title">{title}</strong>
            <span id="ac-confirm-msg">{message}</span>
          </div>
          <button type="button" className="ac-lang-x" aria-label="Fermer" onClick={onCancel}>
            <X size={15} strokeWidth={2} aria-hidden />
          </button>
        </div>
        <div className="ac-lang-foot ac-confirm-foot">
          <button ref={cancelRef} type="button" className="ac-confirm-cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="ac-confirm-ok" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ConfirmDialog;
