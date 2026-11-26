import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { clearToken, getToken } from '../auth';
import { getApiBase } from '../config';
import {
  DEMO_EVENT,
  DEMO_STORAGE_KEY,
  durationLabel,
  formatCountdown,
  getDemoSession,
  isDemoToken,
  markDemoIntroSeen,
  setDemoSession,
  type DemoSessionInfo,
} from '../lib/demoSession';
import '../styles/demo-session.css';
import { translate, t as tr, useLang } from '../i18n/core';

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
  const lang = useLang();
  const duration = translate(durationLabel(session.minutes), lang);
  const [now, setNow] = useState(() => Date.now());
  const [introOpen, setIntroOpen] = useState(!session.intro_seen);

  // The Durable Object is authoritative; browser storage is only a display
  // cache. Re-sync on opening and focus without polling once per second.
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      const token = getToken();
      if (!isDemoToken(token)) return;
      try {
        const res = await fetch(`${getApiBase()}/api/demo/session`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
        if (cancelled || getToken() !== token) return;
        if (res.status === 401) { leaveDemo('DEMO_EXPIRED'); return; }
        if (!res.ok) return; // keep cached countdown when temporarily offline
        const body = await res.json() as { data?: { expires_at?: number; server_now?: number } };
        const remaining = Number(body?.data?.expires_at) - Number(body?.data?.server_now);
        if (!Number.isFinite(remaining)) return;
        if (remaining <= 0) { leaveDemo('DEMO_EXPIRED'); return; }
        const current = getDemoSession();
        if (current) setDemoSession({ ...current, expires_at: Date.now() + remaining });
      } catch { /* temporary network failure: server still enforces expiry */ }
    };
    void sync();
    window.addEventListener('focus', sync);
    return () => { cancelled = true; window.removeEventListener('focus', sync); };
  }, []);

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
        <span className="demo-chip-label">{tr('Démo')}</span>
        <span className="demo-chip-time" title={tr('Temps restant avant la réinitialisation de la base fictive')}>
          {formatCountdown(left)}
        </span>
        <button type="button" className="demo-chip-info" onClick={() => setIntroOpen(true)} aria-label={tr('À propos du mode démo')}>
          i
        </button>
        <button type="button" className="demo-chip-exit" onClick={() => leaveDemo('DEMO_LEFT')}>
          {tr('Quitter')}
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
            <span className="demo-intro-badge">{tr('Mode démo')}</span>
            <h2 id="demo-intro-title">{tr('{duration} pour tout essayer', { duration })}</h2>
            <ul className="demo-intro-list">
              <li>{tr('{duration} d’essai, une fois toutes les {n} heures sur cet appareil.', { duration, n: session.window_hours })}</li>
              <li><strong>{tr('Données fictives')}</strong> : {tr('Créez, modifiez ou supprimez librement produits, ventes et clients.')}</li>
              <li><strong>{tr('Remise à zéro automatique')}</strong> : {tr('la base de démo est effacée au bout de {duration}.', { duration })}</li>
              <li><strong>{tr('Aucun accès à vos vraies données')}</strong> : {tr('La démo utilise sa propre base SQLite isolée.')}</li>
            </ul>
            <p className="demo-intro-time">{tr('Temps restant :')} <strong>{formatCountdown(left)}</strong></p>
            <button type="button" className="demo-intro-go" onClick={closeIntro}>
              {tr('Commencer la démo')}
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
