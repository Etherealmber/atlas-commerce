/**
 * Expand-to-confirm action (FamilyReceive-style).
 * Primary uses Atlas shell tokens (black/white), not sky blue.
 */
import React, { useState } from 'react';
import {
  motion,
  AnimatePresence,
  LayoutGroup,
  type Transition,
} from 'motion/react';
import { X, Fingerprint } from 'lucide-react';

export interface ConfirmExpandButtonProps {
  triggerLabel?: string;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void | Promise<void>;
  icon?: React.ReactNode;
  className?: string;
  /** 'primary' | 'danger' — danger uses red confirm */
  variant?: 'primary' | 'danger';
}

const springTransition: Transition = {
  type: 'spring',
  bounce: 0,
  duration: 0.4,
};

export function ConfirmExpandButton({
  triggerLabel = 'Confirmer',
  title = 'Confirmer',
  description = 'Voulez-vous continuer ?',
  confirmLabel = 'Confirmer',
  cancelLabel = 'Annuler',
  onConfirm,
  icon,
  className = '',
  variant = 'primary',
}: ConfirmExpandButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const confirmBg =
    variant === 'danger'
      ? 'var(--ac-danger, #dc2626)'
      : 'var(--ac-primary, #0a0a0a)';
  const confirmFg =
    variant === 'danger' ? '#fff' : 'var(--ac-primary-fg, #fafafa)';

  async function handleConfirm() {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm?.();
      setIsOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`ac-confirm-expand ${className}`.trim()}>
      <LayoutGroup>
        <AnimatePresence>
          {!isOpen && (
            <motion.button
              key="trigger"
              type="button"
              layoutId="ac-action-button"
              onClick={() => setIsOpen(true)}
              className="ac-confirm-expand-trigger"
              style={{ background: confirmBg, color: confirmFg }}
              whileTap={{ scale: 0.97 }}
              transition={springTransition}
            >
              {triggerLabel}
            </motion.button>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {isOpen && (
            <motion.div
              key="overlay"
              className="ac-confirm-expand-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              role="presentation"
              onClick={() => !busy && setIsOpen(false)}
            >
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-labelledby="ac-confirm-expand-title"
                initial={{ y: 40, opacity: 0, scale: 0.98 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: 24, opacity: 0, scale: 0.98 }}
                transition={springTransition}
                className="ac-confirm-expand-card"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="ac-confirm-expand-close secondary"
                  aria-label="Fermer"
                  disabled={busy}
                  onClick={() => setIsOpen(false)}
                >
                  <X size={20} />
                </button>
                <div className="ac-confirm-expand-head">
                  <div className="ac-confirm-expand-icon">
                    {icon ?? <Fingerprint size={22} style={{ color: 'var(--ac-accent, #3b82f6)' }} />}
                  </div>
                  <h2 id="ac-confirm-expand-title">{title}</h2>
                </div>
                <p className="ac-confirm-expand-desc">{description}</p>
                <div className="ac-confirm-expand-actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() => setIsOpen(false)}
                  >
                    {cancelLabel}
                  </button>
                  <motion.button
                    type="button"
                    layoutId="ac-action-button"
                    disabled={busy}
                    onClick={() => void handleConfirm()}
                    className="ac-confirm-expand-confirm"
                    style={{ background: confirmBg, color: confirmFg }}
                    transition={springTransition}
                  >
                    {busy ? '…' : confirmLabel}
                  </motion.button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </LayoutGroup>
    </div>
  );
}

export default ConfirmExpandButton;
