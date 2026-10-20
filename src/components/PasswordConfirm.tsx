import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  open: boolean;
  title?: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: (password: string) => void | Promise<void>;
  onCancel: () => void;
};

/**
 * Simple confirmation dialog (portaled above other modals).
 *
 * The session (login + OTP) is the security gate — re-typing the admin password
 * for every delete/create was removed on purpose: this dialog only asks
 * "are you sure?". `onConfirm` still receives a (empty) password argument so
 * every existing call-site keeps working unchanged.
 */
export default function PasswordConfirm({
  open,
  title = "Confirmer l'action",
  description = 'Cette action est immédiate. Confirmez pour continuer.',
  confirmLabel = 'Confirmer',
  onConfirm,
  onCancel,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setError('');
      setLoading(false);
    }
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await onConfirm('');
    } catch (err: any) {
      const raw = String(err?.message || err?.error || '');
      const code = String(err?.code || '');
      let msg = raw || 'Échec de la confirmation.';
      if (code === 'FORBIDDEN_ROLE' || code === 'OWNER_ONLY') {
        msg = 'Action non autorisée pour votre compte.';
      } else if (code === 'BAD_PASSWORD') {
        msg = 'Session expirée — reconnectez-vous puis réessayez.';
      }
      setError(msg);
      setLoading(false);
      return;
    }
    setLoading(false);
  };

  return createPortal(
    <div
      className="modal-overlay modal-overlay-top"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10, 10, 12, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 11000,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onCancel();
      }}
    >
      <div
        className="modal-card"
        style={{
          background: 'var(--ac-paper, var(--paper, #ffffff))',
          color: 'var(--ac-ink, var(--ink, #0f172a))',
          borderRadius: 14,
          padding: '22px 24px',
          maxWidth: 400,
          width: '100%',
          boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
          border: '1px solid var(--ac-line, var(--line, #e8eaef))',
          position: 'relative',
          zIndex: 11001,
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pw-confirm-title"
      >
        <h2
          id="pw-confirm-title"
          style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}
        >
          {title}
        </h2>
        <p
          style={{
            margin: '0 0 16px',
            fontSize: 14,
            color: 'var(--ac-muted, var(--muted, #64748b))',
            lineHeight: 1.45,
          }}
        >
          {description}
        </p>
        {error && (
          <div
            role="alert"
            style={{
              background: 'rgba(220, 38, 38, 0.12)',
              border: '1px solid rgba(220, 38, 38, 0.4)',
              color: 'var(--ac-danger, #dc2626)',
              padding: '10px 12px',
              borderRadius: 8,
              marginBottom: 12,
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}
        <form onSubmit={submit} style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="secondary"
            onClick={onCancel}
            disabled={loading}
            style={{ minHeight: 40, borderRadius: 10, padding: '8px 14px' }}
          >
            Annuler
          </button>
          <button
            type="submit"
            className="danger"
            disabled={loading}
            style={{ minHeight: 40, borderRadius: 10, padding: '8px 16px' }}
          >
            {loading ? '…' : confirmLabel}
          </button>
        </form>
      </div>
    </div>,
    document.body,
  );
}
