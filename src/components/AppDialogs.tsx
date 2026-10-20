/**
 * CSS-based toast / confirm / prompt — replaces window.alert, confirm, prompt.
 * Always portaled to document.body with high z-index so they sit above page modals.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

type ToastKind = 'success' | 'error' | 'info';

type ToastItem = {
  id: number;
  message: string;
  kind: ToastKind;
};

type ConfirmState = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Single-button informational dialog (replaces window.alert) */
  alertOnly?: boolean;
  resolve: (ok: boolean) => void;
} | null;

type PromptState = {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  resolve: (value: string | null) => void;
} | null;

type UiApi = {
  toast: (message: string, kind?: ToastKind) => void;
  /** Styled modal replacing window.alert */
  alert: (message: string, title?: string) => Promise<void>;
  confirm: (opts: {
    title?: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
  }) => Promise<boolean>;
  prompt: (opts: {
    title: string;
    message?: string;
    defaultValue?: string;
    placeholder?: string;
    confirmLabel?: string;
  }) => Promise<string | null>;
};

const UiContext = createContext<UiApi | null>(null);

let idSeq = 1;


/** Icons aligned with react-icons/tb style (no extra dependency) */
function ToastGlyph({ kind }: { kind: string }) {
  const common = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const };
  if (kind === 'success') {
    return (
      <svg {...common}>
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
        <polyline points="22 4 12 14.01 9 11.01" />
      </svg>
    );
  }
  if (kind === 'info') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
      </svg>
    );
  }
  // error / alert — TbFileAlert-like
  return (
    <svg {...common}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M12 18v-4" />
      <path d="M12 10h.01" />
    </svg>
  );
}

export function AppDialogsProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const [promptState, setPromptState] = useState<PromptState>(null);
  const [promptValue, setPromptValue] = useState('');
  const promptInputRef = useRef<HTMLInputElement>(null);

  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = idSeq++;
    setToasts((prev) => [...prev, { id, message, kind }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const confirm = useCallback(
    (opts: {
      title?: string;
      message: string;
      confirmLabel?: string;
      cancelLabel?: string;
      danger?: boolean;
    }) =>
      new Promise<boolean>((resolve) => {
        setConfirmState({
          title: opts.title || 'Confirmation',
          message: opts.message,
          confirmLabel: opts.confirmLabel || 'Confirmer',
          cancelLabel: opts.cancelLabel || 'Annuler',
          danger: opts.danger,
          resolve,
        });
      }),
    []
  );

  const alertFn = useCallback(
    (message: string, title?: string) =>
      new Promise<void>((resolve) => {
        setConfirmState({
          title: title || 'Information',
          message,
          confirmLabel: 'OK',
          cancelLabel: '',
          alertOnly: true,
          resolve: () => resolve(),
        });
      }),
    []
  );

  const prompt = useCallback(
    (opts: {
      title: string;
      message?: string;
      defaultValue?: string;
      placeholder?: string;
      confirmLabel?: string;
    }) =>
      new Promise<string | null>((resolve) => {
        setPromptValue(opts.defaultValue || '');
        setPromptState({
          title: opts.title,
          message: opts.message,
          defaultValue: opts.defaultValue,
          placeholder: opts.placeholder,
          confirmLabel: opts.confirmLabel || 'OK',
          resolve,
        });
      }),
    []
  );

  useEffect(() => {
    if (promptState) {
      const t = window.setTimeout(() => promptInputRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
  }, [promptState]);

  /* Esc closes confirm / prompt; trap focus remains on dialog body */
  useEffect(() => {
    if (!confirmState && !promptState) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (confirmState) {
        confirmState.resolve(false);
        setConfirmState(null);
      } else if (promptState) {
        promptState.resolve(null);
        setPromptState(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmState, promptState]);

  const api: UiApi = { toast, alert: alertFn, confirm, prompt };

  // Expose for non-React modules (export.ts, reports.ts, thermal fallbacks)
  useEffect(() => {
    (window as any).__atlasUi = api;
    return () => {
      delete (window as any).__atlasUi;
    };
  }, [api]);

  const overlayUi =
    typeof document !== 'undefined'
      ? createPortal(
          <>
            {/* Toasts — always on top */}
            <div className="app-toast-stack" aria-live="polite">
              {toasts.map((t) => (
                <div key={t.id} className={`app-toast app-toast-${t.kind}`} role="status">
                  <div className="app-toast-icon-rail" aria-hidden>
                    <ToastGlyph kind={t.kind} />
                  </div>
                  <div className="app-toast-body">
                    <span className="app-toast-msg app-toast-title">{t.message}</span>
                  </div>
                  <button
                    type="button"
                    className="app-toast-close"
                    aria-label="Fermer"
                    onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            {/* Confirm */}
            {confirmState && (
              <div
                className="modal-overlay modal-overlay-top"
                style={{ zIndex: 12000 }}
                role="presentation"
                onClick={() => {
                  confirmState.resolve(false);
                  setConfirmState(null);
                }}
              >
                <div
                  className="modal app-dialog-card"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="atlas-confirm-title"
                  aria-describedby="atlas-confirm-desc"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h2 id="atlas-confirm-title">{confirmState.title}</h2>
                  <p id="atlas-confirm-desc" style={{ whiteSpace: 'pre-line' }}>
                    {confirmState.message}
                  </p>
                  <div className="dialog-actions">
                    {!confirmState.alertOnly && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          confirmState.resolve(false);
                          setConfirmState(null);
                        }}
                      >
                        {confirmState.cancelLabel || 'Annuler'}
                      </button>
                    )}
                    <button
                      type="button"
                      className={confirmState.danger ? 'danger' : undefined}
                      autoFocus
                      onClick={() => {
                        confirmState.resolve(true);
                        setConfirmState(null);
                      }}
                    >
                      {confirmState.confirmLabel || 'OK'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Prompt */}
            {promptState && (
              <div
                className="modal-overlay modal-overlay-top"
                style={{ zIndex: 12000 }}
                role="presentation"
                onClick={() => {
                  promptState.resolve(null);
                  setPromptState(null);
                }}
              >
                <div
                  className="modal app-dialog-card"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="atlas-prompt-title"
                  onClick={(e) => e.stopPropagation()}
                >
                  <h2 id="atlas-prompt-title">{promptState.title}</h2>
                  {promptState.message && <p>{promptState.message}</p>}
                  <input
                    ref={promptInputRef}
                    type="text"
                    value={promptValue}
                    placeholder={promptState.placeholder}
                    aria-label={promptState.title}
                    onChange={(e) => setPromptValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        promptState.resolve(promptValue.trim() || null);
                        setPromptState(null);
                      }
                    }}
                    style={{ width: '100%', marginBottom: 16 }}
                  />
                  <div className="dialog-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        promptState.resolve(null);
                        setPromptState(null);
                      }}
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        promptState.resolve(promptValue.trim() || null);
                        setPromptState(null);
                      }}
                    >
                      {promptState.confirmLabel}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>,
          document.body
        )
      : null;

  return (
    <UiContext.Provider value={api}>
      {children}
      {overlayUi}
    </UiContext.Provider>
  );
}

export function useUi(): UiApi {
  const ctx = useContext(UiContext);
  if (!ctx) {
    // Fallback if used outside provider (should not happen)
    return {
      toast: (m) => console.warn('[toast]', m),
      alert: async (m, title) => { console.warn('[alert]', title || '', m); },
      confirm: async ({ message }) => {
        console.warn('[confirm]', message);
        return false;
      },
      prompt: async () => null,
    };
  }
  return ctx;
}

/** For modules outside React (export.ts, reports.ts). */
export function uiToast(message: string, kind: ToastKind = 'info') {
  const api = (window as any).__atlasUi as UiApi | undefined;
  if (api) api.toast(message, kind);
  else console.warn('[toast]', message);
}

export function uiConfirm(message: string, opts?: { title?: string; danger?: boolean }) {
  const api = (window as any).__atlasUi as UiApi | undefined;
  if (api) return api.confirm({ message, title: opts?.title, danger: opts?.danger });
  console.warn('[confirm]', message);
  return Promise.resolve(false);
}

export function uiAlert(message: string, title?: string) {
  const api = (window as any).__atlasUi as UiApi | undefined;
  if (api) return api.alert(message, title);
  console.warn('[alert]', title || '', message);
  return Promise.resolve();
}
