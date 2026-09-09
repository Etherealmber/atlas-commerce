import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  open: boolean;
  title?: string;
  description?: string;
  confirmLabel?: string;
  onConfirm: (password: string) => void | Promise<void>;
  onCancel: () => void;
};

/** Modal: re-type admin password before create / edit / delete. Portaled above all other modals. */
export default function PasswordConfirm({
  open,
  title = "Confirmer l'action",
  description = 'Saisissez votre mot de passe administrateur pour confirmer.',
  confirmLabel = 'Confirmer',
  onConfirm,
  onCancel,
}: Props) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPassword('');
      setError('');
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) {
      setError('Veuillez saisir votre mot de passe.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await onConfirm(password);
    } catch (err: any) {
      const raw = String(err?.message || err?.error || '');
      const code = String(err?.code || '');
      let msg = raw || 'Échec de la confirmation.';
      if (code === 'BAD_PASSWORD' || /mot de passe incorrect|password/i.test(raw)) {
        msg = 'Mot de passe incorrect. Vérifiez et réessayez.';
      } else if (code === 'PASSWORD_REQUIRED' || /saisir|obligatoire|required/i.test(raw)) {
        msg = 'Veuillez saisir votre mot de passe.';
      } else if (code === 'FORBIDDEN_ROLE' || code === 'OWNER_ONLY') {
        msg = 'Action non autorisée pour votre compte.';
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
        background: 'rgba(15, 27, 45, 0.55)',
        backdropFilter: 'blur(6px)',
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
          background: 'var(--paper, #faf8f4)',
          borderRadius: 12,
          padding: '24px 28px',
          maxWidth: 400,
          width: '100%',
          boxShadow: '0 12px 40px rgba(0,0,0,0.22)',
          border: '1px solid var(--line, #e0d9cc)',
          position: 'relative',
          zIndex: 11001,
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pw-confirm-title"
      >
        <h2
          id="pw-confirm-title"
          style={{
            margin: '0 0 8px',
            fontFamily: 'Instrument Serif, Georgia, serif',
            fontSize: 22,
            color: 'var(--ink, #1a1814)',
          }}
        >
          {title}
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 14, color: 'var(--muted, #7a756c)', lineHeight: 1.45 }}>
          {description}
        </p>
        {error && (
          <div
            role="alert"
            style={{
              background: '#fce8e8',
              border: '1px solid #e8b4b4',
              color: '#8b2e2e',
              padding: '10px 12px',
              borderRadius: 8,
              marginBottom: 12,
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}
        <form onSubmit={submit}>
          <label
            htmlFor="confirm-password"
            style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: 'var(--muted, #7a756c)',
              marginBottom: 6,
            }}
          >
            Mot de passe
          </label>
          <input
            ref={inputRef}
            id="confirm-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            disabled={loading}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 8,
              border: '1.5px solid var(--line, #c9c0b0)',
              fontSize: 15,
              marginBottom: 16,
              background: '#fff',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="secondary"
              style={{
                padding: '10px 16px',
                borderRadius: 8,
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: 14,
              }}
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: '10px 18px',
                borderRadius: 8,
                border: 'none',
                background: 'var(--ink, #1a1814)',
                color: '#faf8f4',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {loading ? 'Vérification...' : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
