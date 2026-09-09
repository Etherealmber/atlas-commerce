import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode; label?: string };
type State = { error: Error | null };

/**
 * Catches render errors so the whole app does not go white-screen.
 * "Réessayer" remounts children; "Recharger" does a full page reload.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    try {
      console.error('[ErrorBoundary]', this.props.label || 'app', error, info?.componentStack);
    } catch {
      /* ignore */
    }
  }

  private reset = () => this.setState({ error: null });

  private reload = () => {
    try {
      window.location.reload();
    } catch {
      this.reset();
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    const msg = this.state.error.message || 'Erreur inattendue';
    return (
      <div
        role="alert"
        style={{
          minHeight: '60vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          background: 'var(--bg, #f5f2eb)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            maxWidth: 420,
            width: '100%',
            background: '#fff',
            borderRadius: 16,
            padding: '28px 24px',
            boxShadow: '0 8px 32px rgba(26,24,20,0.08)',
            border: '1px solid #ebe6dc',
          }}
        >
          <p style={{ margin: 0, fontSize: 12, letterSpacing: '0.06em', color: '#8a9a92', textTransform: 'uppercase' }}>
            Atlas Commerce
          </p>
          <h1 style={{ margin: '8px 0 12px', fontSize: 22, color: '#1a1814' }}>Une erreur est survenue</h1>
          <p style={{ margin: '0 0 8px', fontSize: 14, color: '#5c6b64', lineHeight: 1.5 }}>
            L&apos;écran a planté. Vos données sur le serveur ne sont pas perdues. Réessayez ou rechargez la page.
          </p>
          <pre
            style={{
              margin: '12px 0 20px',
              padding: 12,
              fontSize: 11,
              background: '#f7f4ee',
              borderRadius: 8,
              overflow: 'auto',
              maxHeight: 100,
              color: '#8a4b3c',
            }}
          >
            {msg}
          </pre>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={this.reset}
              style={{
                border: 'none',
                borderRadius: 999,
                padding: '10px 18px',
                background: '#1a6b66',
                color: '#fff',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Réessayer
            </button>
            <button
              type="button"
              onClick={this.reload}
              style={{
                border: '1px solid #d9d2c6',
                borderRadius: 999,
                padding: '10px 18px',
                background: '#fff',
                color: '#1a1814',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Recharger
            </button>
          </div>
        </div>
      </div>
    );
  }
}
