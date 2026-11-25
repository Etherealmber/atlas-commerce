import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { clearToken, getToken } from '../auth';
import {
  DEMO_EVENT,
  DEMO_STORAGE_KEY,
  durationLabel,
  formatCountdown,
  getDemoSession,
  isDemoToken,
  markDemoIntroSeen,
  type DemoSessionInfo,
} from '../lib/demoSession';
import '../styles/demo-session.css';

/** Showcase / legal / auth pages: no demo chrome there. */
const PUBLIC_PAGE_RE = /^\/(?:$|login|welcome|verify|privacy|terms|licenses|about|support|supprot|whats-new|android|download|desktop(?:$|\/)|p\/|403|404|error\/)/;

type DemoCtx = { active: boolean; session: DemoSessionInfo | null };

const Ctx = createContext<DemoCtx>({ active: false, session: null });

export function useDemoSession(): DemoCtx {
  return useContext(Ctx);
}

function readActive(): DemoSessionInfo | null {
  const s = getDemoSession();
  return s && isDemoToken(getToken()) ? s : null;
}

function leaveDemo(reason: 'DEMO_EXPIRED' | 'DEMO_LEFT') {
  clearToken();
  window.location.href = `/login?reason=${reason}`;
}

/** Countdown chip + one-time introduction shown while using the demo sandbox. */
function DemoSessionChrome({ session }: { session: DemoSessionInfo }) {
  const [now, setNow] = useState(() => Date.now());
  const [introOpen, setIntroOpen] = useState(!session.intro_seen);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const left = session.expires_at - now;
  useEffect(() => {
    if (left <= 0) leaveDemo('DEMO_EXPIRED');
  }, [left]);

  const closeIntro = () => {
    markDemoIntroSeen();
    setIntroOpen(false);
  };
  const urgent = left < 3 * 60_000;

  return (
    <>
      <div className={`demo-chip${urgent ? ' is-urgent' : ''}`} role="status" aria-live="off">
        <span className="demo-chip-dot" aria-hidden />
        <span className="demo-chip-label">Démo</span>
        <span className="demo-chip-time" title="Temps restant avant la réinitialisation de la base fictive">
          {formatCountdown(left)}
        </span>
        <button type="button" className="demo-chip-info" onClick={() => setIntroOpen(true)} aria-label="À propos du mode démo">
          i
        </button>
        <button type="button" className="demo-chip-exit" onClick={() => leaveDemo('DEMO_LEFT')}>
          Quitter
        </button>
      </div>
      {introOpen && (
        <div className="demo-intro-backdrop" role="presentation" onClick={closeIntro}>
          <div
            className="demo-intro"
            role="dialog"
            aria-modal="true"
            aria-labelledby="demo-intro-title"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="demo-intro-badge">Mode démo</span>
            <h2 id="demo-intro-title">{durationLabel(session.minutes)} pour tout essayer</h2>
            <ul className="demo-intro-list">
              <li><strong>{durationLabel(session.minutes)} d’essai</strong>, une fois toutes les {session.window_hours} heures sur cet appareil.</li>
              <li><strong>Données fictives</strong> : créez, modifiez ou supprimez librement produits, ventes, clients…</li>
              <li><strong>Remise à zéro automatique</strong> : la base de démo est effacée au bout de {durationLabel(session.minutes)}.</li>
              <li><strong>Aucun accès à vos vraies données</strong> : la démo tourne sur sa propre petite base SQLite.</li>
            </ul>
            <p className="demo-intro-time">Temps restant : <strong>{formatCountdown(left)}</strong></p>
            <button type="button" className="demo-intro-go" onClick={closeIntro}>
              Commencer la démo
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export function DemoProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<DemoSessionInfo | null>(() => readActive());
  const location = useLocation();

  useEffect(() => {
    const sync = () => setSession(readActive());
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === DEMO_STORAGE_KEY || e.key === 'stock_auth_token') sync();
    };
    window.addEventListener(DEMO_EVENT, sync);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(DEMO_EVENT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => { setSession(readActive()); }, [location.pathname]);

  const show = !!session && !PUBLIC_PAGE_RE.test(location.pathname);

  return (
    <Ctx.Provider value={{ active: !!session, session }}>
      {children}
      {show && session && <DemoSessionChrome session={session} />}
    </Ctx.Provider>
  );
}
