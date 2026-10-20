import type { ReactNode } from 'react';

/** Error / success banner at the bottom of a modal (French UI). */
export function ModalFormError({
  message,
  kind = 'error',
}: {
  message?: string | null;
  kind?: 'error' | 'success' | 'info';
}) {
  if (!message) return null;
  return (
    <div
      className={'modal-form-alert modal-form-alert--' + kind}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      {message}
    </div>
  );
}

/** Clear inline error / hint under a form field. */
export function FieldHint({ error, hint }: { error?: string | null; hint?: string | null }) {
  if (error) {
    return (
      <span className="field-error-msg field-hint field-hint--error" role="alert">
        {error}
      </span>
    );
  }
  if (hint) return <span className="field-hint">{hint}</span>;
  return null;
}

/** Inline error only — use next to any input. */
export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <span className="field-error-msg" role="alert">
      {message}
    </span>
  );
}

/** Wrapper: puts children then sticky error at bottom of modal body */
export function ModalFormFooter({
  error,
  success,
  children,
}: {
  error?: string | null;
  success?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="modal-form-footer">
      <ModalFormError message={error} kind="error" />
      <ModalFormError message={success} kind="success" />
      {children}
    </div>
  );
}
