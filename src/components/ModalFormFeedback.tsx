import { useEffect, useRef } from 'react';
import { bounceDialogOf } from '../lib/unsavedGuard';

/** Error / success banner at the bottom of a modal (French UI).
 *  A new error message bounces the dialog so it is noticed. */
export function ModalFormError({
  message,
  kind = 'error',
}: {
  message?: string | null;
  kind?: 'error' | 'success' | 'info';
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (message && kind === 'error') bounceDialogOf(ref.current);
  }, [message, kind]);
  if (!message) return null;
  return (
    <div
      ref={ref}
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


