import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportCrash } from '../lib/crashReporter';

type Props = { children: ReactNode; label?: string };
type State = { error: Error | null };

function classifyClientError(err: Error | null): { kind: string; code: string; detail: string } {
  const msg = err?.message || String(err || 'Erreur inconnue');
  const name = err?.name || '';
  const low = msg.toLowerCase();

  // Network / HTTP-ish
  if (/failed to fetch|networkerror|load failed|net::/.test(low)) {
    return { kind: 'bad-gateway', code: '503', detail: msg };
  }
  if (/\b502\b|bad gateway/.test(low)) {
    return { kind: 'bad-gateway', code: '502', detail: msg };
  }
  if (/\b503\b|service unavailable/.test(low)) {
    return { kind: 'bad-gateway', code: '503', detail: msg };
  }
  if (/\b504\b|timeout|timed out/.test(low)) {
    return { kind: 'bad-gateway', code: '504', detail: msg };
  }
  if (/\b401\b|unauthorized|not authenticated/.test(low)) {
    return { kind: 'crash', code: '401', detail: msg };
  }
  if (/\b403\b|forbidden|accès refusé|access denied/.test(low)) {
    return { kind: 'crash', code: '403', detail: msg };
  }
  if (/\b404\b|not found/.test(low)) {
    return { kind: 'not-found', code: '404', detail: msg };
  }
  if (/\b500\b|internal server/.test(low)) {
    return { kind: 'crash', code: '500', detail: msg };
  }
  if (name === 'ChunkLoadError' || /loading chunk|dynamically imported module/.test(low)) {
    return { kind: 'bad-gateway', code: '503', detail: 'Mise à jour en cours — rechargez la page.\n' + msg };
  }
  if (/before initialization|cannot access/.test(low)) {
    return {
      kind: 'crash',
      code: 'ERR',
      detail: 'Erreur d’initialisation (ordre de chargement). Rechargez la page.\n' + msg,
    };
  }
  return { kind: 'crash', code: 'ERR', detail: msg };
}

/**
 * Full-page crash UI (same ghost language as 404 / AccessPage).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', this.props.label || 'app', error, info?.componentStack);
    // v260 — auto-report to the owner's GitHub issues (deduped + sanitized)
    reportCrash(error, { componentStack: String(info?.componentStack || '').slice(0, 2000) });
  }

  reset = () => this.setState({ error: null });

  reload = () => {
    try {
      window.location.reload();
    } catch {
      /* */
    }
  };

  /** Leave the crash screen for home; full navigation so the boundary unmounts. */
  goHome = () => {
    const path = (typeof window !== 'undefined' && window.location?.pathname) || '/';
    const onDashboard = path === '/' || path === '' || path.startsWith('/dashboard');
    this.setState({ error: null });
    try {
      // Dashboard-related crash: hard reload home so a broken dashboard tree is not reused
      if (onDashboard) {
        window.location.assign('/');
      } else {
        window.location.assign('/');
      }
    } catch {
      try { window.location.href = '/'; } catch { /* */ }
    }
  };

  render() {
    if (!this.state.error) return this.props.children;
    const classified = classifyClientError(this.state.error);
    // Static UI only — AccessPage uses useLocation and cannot run outside <Router>
    return (
      <div
        className="error-boundary-root"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: '#f5f2eb',
          fontFamily: 'system-ui, sans-serif',
          color: '#0f1b2d',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: '#94a3b8', margin: '0 0 8px' }}>
            ATLAS · {classified.code}
          </p>
          <h1 style={{ fontSize: '1.35rem', margin: '0 0 10px' }}>Une erreur a interrompu l’app</h1>
          <p style={{ fontSize: 14, color: '#71717a', margin: '0 0 20px', whiteSpace: 'pre-wrap' }}>
            {classified.detail}
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={this.reload}
              style={{
                padding: '12px 18px',
                borderRadius: 12,
                border: 0,
                background: '#0a0a0a',
                color: '#fff',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Actualiser
            </button>
            <button
              type="button"
              onClick={this.goHome}
              style={{
                padding: '12px 18px',
                borderRadius: 12,
                border: '1px solid #e5e0d6',
                background: '#fff',
                color: '#0a0a0a',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Accueil
            </button>
          </div>
        </div>
      </div>
    );
  }
}
