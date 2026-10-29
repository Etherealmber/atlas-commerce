import { SwitchMode } from './components/ui/SwitchMode';
import MobileBottomNav from './components/erp/MobileBottomNav';
import { useEffect, useState, useRef, lazy, Suspense } from 'react';
import { User, CreditCard, Mail, Sparkles, LogOut, Sun, Moon, Monitor, Type } from 'lucide-react';
import { createPortal } from 'react-dom';
import { BrowserRouter, Routes, Route, NavLink, Navigate, Link, useNavigate, useLocation } from 'react-router-dom';
import { applyPageTitle } from './lib/pageTitle';
import Login from './pages/Login';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import AccessPage, { RoleGate } from './pages/AccessPage'
import { HttpErrorPage } from './pages/AccessPage';
import {
  isLoggedIn,
  getToken,
  clearToken,
  startSessionGuard,
  getUsername,
  getDisplayInitials,
  getDisplayName,
  hasAvatarUrl,
  getRole,
  setProfileCache,
  canManageStock,
  canOfficeWork,
  canAccessCompanySettings,
  canAccessInventoryOps,
  canAccessAdminSettings,
  canAccessSettingsBeyondProfile,
  isStockRole,
  canSell,
  isOwnerRole,
} from './auth';
import { PublicNav, PublicSessionCta } from './components/PublicChrome';
import GlobalSearchPanel from './components/GlobalSearchPanel';
import { startDestination } from './lib/startPage';
import { AppDialogsProvider } from './components/AppDialogs';
/** v0.7 — stale hashed chunks after a deploy: one silent reload, then fail
 * clean into the ErrorBoundary page instead of a blank/wrong screen. */
function lazyRetry(fn: () => Promise<any>) {
  return lazy(() =>
    fn().catch((e: any) => {
      try {
        const key = 'atlas-chunk-reload';
        if (!sessionStorage.getItem(key)) {
          sessionStorage.setItem(key, '1');
          window.location.reload();
          return new Promise(() => {}); // navigating away
        }
      } catch { /* private mode etc. */ }
      throw e;
    }),
  );
}
const AtlasAgent = lazyRetry(() => import('./components/AtlasAgent'));
import { ErrorBoundary } from './components/ErrorBoundary';
import { isNativeApp } from './config';
import './App.css';
import './styles/theme.css';
import './styles/shell.css';

import { applyDensityFromStorage, getDensity, setDensity, getUiScale, setUiScale, subscribeUiPrefs, type Density, type UiScale } from './lib/density';
import AtlasLoadingBar from './components/AtlasLoadingBar';
import { isWelcomeCompleted } from './lib/welcome';
import { hasUnreadWhatsNew } from './lib/whatsNew';
import { openConsentSettings } from './lib/cookieConsent';
import { resetWelcome } from './lib/welcome';
import {
  filterSettingsHits,
  searchSettings,
  setPendingAnchor,
  resolveHitByLabel,
  loadSearchHistory,
  pushSearchHistory,
  removeSearchHistoryItem,
  clearSearchHistory,
  SETTINGS_TAB_ICON,
  SETTINGS_TAB_LABELS,
  type SettingsSearchHit,
} from './lib/settingsSearch';
import { api } from './api';
import ScrollToTop from './components/ScrollToTop';
import PageTransition from './components/PageTransition';
import PageSkeleton from './components/PageSkeleton';
import OfflineBanner from './components/OfflineBanner';
import CookieConsent from './components/CookieConsent';
import DownloadTeaser from './components/DownloadTeaser';
import { TopbarUserMenu } from './components/shell/TopbarUserMenu';
import { AvatarImage } from './components/ui/AvatarImage';
import { invalidateAvatarCache } from './lib/avatarCache';
import { useProfileWarm, useProfileTick } from './lib/useProfileWarm';
import { DemoProvider } from './context/DemoContext';
const Welcome = lazyRetry(() => import('./pages/Welcome'));

type NavBadges = {
  invoices_unpaid: number;
  vr_open: number;
  employees_pay_due: number;
  bills_unpaid: number;
  bills_receive: number;
  products_low: number;
  actions_pending: number;
  quotes_open: number;
};

const EMPTY_BADGES: NavBadges = {
  invoices_unpaid: 0,
  vr_open: 0,
  employees_pay_due: 0,
  bills_unpaid: 0,
  bills_receive: 0,
  products_low: 0,
  actions_pending: 0,
  quotes_open: 0,
};


function NavIcon({ d, paths }: { d?: string; paths?: string[] }) {
  const list = paths?.length ? paths : d ? [d] : [];
  return (
    <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {list.map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  );
}

function NavCount({ n, tone = 'default' }: { n: number; tone?: 'default' | 'warn' | 'danger' }) {
  if (!n || n < 1) return null;
  const label = n > 99 ? '99+' : String(n);
  return (
    <span className={`nav-count nav-count-${tone}`} aria-label={`${n}`}>
      {label}
    </span>
  );
}

const Dashboard = lazyRetry(() => import('./pages/Dashboard'));
const ProductHistory = lazyRetry(() => import('./pages/ProductHistory'));
const Products = lazyRetry(() => import('./pages/Products'));
const Scan = lazyRetry(() => import('./pages/Scan'));
const LoginQr = lazyRetry(() => import('./pages/LoginQr'));
const EmailVerify = lazyRetry(() => import('./pages/EmailVerify'));
const Invoices = lazyRetry(() => import('./pages/Invoices'));
const InvoiceDetail = lazyRetry(() => import('./pages/InvoiceDetail'));
const Bills = lazyRetry(() => import('./pages/Bills'));
const Receipts = lazyRetry(() => import('./pages/Receipts'));
const QuickSale = lazyRetry(() => import('./pages/QuickSale'));
const QuickSaleDetail = lazyRetry(() => import('./pages/QuickSaleDetail'));
const Balance = lazyRetry(() => import('./pages/Balance'));
const Reports = lazyRetry(() => import('./pages/Reports'));
const InventoryOps = lazyRetry(() => import('./pages/InventoryOps'));
const Settings = lazyRetry(() => import('./pages/Settings'));
const Clients = lazyRetry(() => import('./pages/Clients'));
const Employees = lazyRetry(() => import('./pages/Employees'));
const Attendance = lazyRetry(() => import('./pages/Attendance'));
const Vendors = lazyRetry(() => import('./pages/Vendors'));
const Quotes = lazyRetry(() => import('./pages/Quotes'));
const Reimbursements = lazyRetry(() => import('./pages/Reimbursements'));
const About = lazyRetry(() => import('./pages/About'));
const Download = lazyRetry(() => import('./pages/Download'));
const Home = lazyRetry(() => import('./pages/Home'));
const DesktopPage = lazyRetry(() => import('./pages/Desktop'));
const WhatsNew = lazyRetry(() => import('./pages/WhatsNew'));
const WhatsNewModal = lazyRetry(() => import('./components/WhatsNewModal'));
const Actions = lazyRetry(() => import('./pages/Actions'));
const PhoneApp = lazyRetry(() => import('./mobile/PhoneApp'));

const LOADING_QUIPS = [
  'On aligne les carreaux…',
  'Le marbre se polit tout seul…',
  'Comptage des sacs de ciment…',
  'Les factures font la queue…',
  'Un instant, le stock respire…',
  'Préparation du café et des données…',
];


function MobileOnlyGuard({ children }: { children: React.ReactNode }) {
  // /m removed — one responsive app for phone and desktop
  return <>{children}</>;
}

function PageFallback() {
  return <PageSkeleton variant="list" />;
}
function PhonePageFallback() {
  return <PageSkeleton variant="phone" />;
}

function roleLabelFr(role: string | null | undefined) {
  if (role === 'owner') return 'Propriétaire';
  if (role === 'admin') return 'Admin';
  if (role === 'secretaire') return 'Secrétaire';
  if (role === 'stock') return 'Magasinier';
  return 'Utilisateur';
}

function MenuSvg({ d, size = 16 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="account-menu-svg">
      <path d={d} />
    </svg>
  );
}

/** Account popup aligned with sidebar styling */
function AccountMenu({
  themeMode,
  setThemeMode,
  onLogout,
  sidebarCollapsed,
  onToggleSidebar,
}: {
  themeMode: ThemeMode;
  setThemeMode: (m: ThemeMode) => void;
  onLogout: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [whatsNewUnread, setWhatsNewUnread] = useState(() => hasUnreadWhatsNew());
  useEffect(() => {
    const sync = () => setWhatsNewUnread(hasUnreadWhatsNew());
    sync();
    window.addEventListener('atlas-whats-new-seen', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('atlas-whats-new-seen', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const [d, setD] = useState<Density>(() => getDensity());
  const [scale, setScale] = useState<UiScale>(() => getUiScale());
  const [profileTick, setProfileTick] = useState(0);
  useEffect(() => {
    const sync = () => setProfileTick((t) => t + 1);
    window.addEventListener('atlas-profile-changed', sync);
    window.addEventListener('atlas-avatar-changed', sync);
    return () => {
      window.removeEventListener('atlas-profile-changed', sync);
      window.removeEventListener('atlas-avatar-changed', sync);
    };
  }, []);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
  useEffect(() => { applyDensityFromStorage(); }, []);

  // Live sync density / scale from Settings or other panels
  useEffect(() => {
    return subscribeUiPrefs(() => {
      setD(getDensity());
      setScale(getUiScale());
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await api.getMe();
        const m = (r as any)?.data || r || {};
        if (cancelled) return;
        setProfileCache({
          display_name: m.display_name,
          avatar_url: m.avatar_url,
          username: m.username,
          role: m.role,
        });
        setProfileTick((tick) => tick + 1);
      } catch {
        /* best-effort */
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const el = triggerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = 280;
      const gap = 6;
      const pad = 8;
      let left: number;
      let bottom: number;

      if (sidebarCollapsed) {
        // Stick flush to the right edge of the collapsed sidebar rail
        const rail = document.querySelector('.sidebar') as HTMLElement | null;
        const railRight = rail ? rail.getBoundingClientRect().right : r.right;
        left = Math.round(railRight + gap);
        if (left + width > window.innerWidth - pad) {
          left = Math.max(pad, window.innerWidth - width - pad);
        }
        // Bottom of panel aligns with bottom of avatar trigger
        bottom = Math.max(pad, Math.round(window.innerHeight - r.bottom));
      } else {
        left = Math.round(r.left);
        if (left + width > window.innerWidth - pad) {
          left = Math.max(pad, window.innerWidth - width - pad);
        }
        // Sit just above the trigger
        bottom = Math.max(pad, Math.round(window.innerHeight - r.top + gap));
      }

      setPanelStyle({
        position: 'fixed',
        left,
        bottom,
        width,
        zIndex: 10050,
        maxHeight: 'min(72vh, 520px)',
        overflowY: 'auto',
        margin: 0,
        transform: 'none',
        // Never liquid glass — solid panel always
        background: '#0d1018',
        backgroundColor: '#0d1018',
        opacity: 1,
        backdropFilter: 'none',
        WebkitBackdropFilter: 'none',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 12,
        boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
        color: '#e8eef6',
        isolation: 'isolate',
        mixBlendMode: 'normal',
      });
    };
    place();
    // Second pass after paint so max-height / content is known
    const t = window.setTimeout(place, 0);
    window.addEventListener('resize', place);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', place);
    };
  }, [open, sidebarCollapsed]);

  useEffect(() => {
    if (open) document.documentElement.classList.add('account-menu-open');
    else document.documentElement.classList.remove('account-menu-open');
    return () => document.documentElement.classList.remove('account-menu-open');
  }, [open]);


  const menuBody = (
            <>
              <div className="account-menu-head">
                <span className="account-menu-email">{getUsername()}</span>
                <strong key={`nm-${profileTick}`} className="account-menu-name">{getDisplayName()}</strong>
              </div>

              <button type="button" role="menuitem" className="account-menu-item" onClick={() => { setOpen(false); window.location.assign('/settings'); }}>
                <MenuSvg d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.98 1.01 1.64 1.01H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                Paramètres
              </button>
              <button type="button" role="menuitem" className="account-menu-item account-menu-item--novelties" onClick={() => { setOpen(false); window.location.assign('/whats-new'); }}>
                <MenuSvg d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                <span className="account-menu-item-label">Nouveautés</span>
                {whatsNewUnread ? <span className="whats-new-badge" aria-label="Nouveautés non lues">1</span> : null}
              </button>
              <button type="button" role="menuitem" className="account-menu-item" onClick={() => { setOpen(false); window.location.assign('/about'); }}>
                <MenuSvg d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01" />
                À propos
              </button>
              <button type="button" role="menuitem" className="account-menu-item" onClick={() => { onToggleSidebar(); }}>
                <MenuSvg d={sidebarCollapsed ? "M9 18l6-6-6-6" : "M15 18l-6-6 6-6"} />
                {sidebarCollapsed ? 'Agrandir le menu' : 'Réduire le menu'}
              </button>

              <div className="account-menu-divider" />
              <div className="account-menu-section-label">Thème</div>
              <div className="account-theme-icons" role="group" aria-label="Thème">
                <button type="button" data-theme-toggle className={themeMode === 'system' ? 'active' : undefined} title="Système" aria-label="Système" aria-pressed={themeMode === 'system'} onClick={() => setThemeMode('system')}>
                  <MenuSvg d="M2 4h20v12H2zM8 20h8M12 16v4" size={15} />
                </button>
                <button type="button" data-theme-toggle className={themeMode === 'light' ? 'active' : undefined} title="Clair" aria-label="Clair" aria-pressed={themeMode === 'light'} onClick={() => setThemeMode('light')}>
                  <MenuSvg d="M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4l1.4-1.4M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" size={15} />
                </button>
                <button type="button" data-theme-toggle className={themeMode === 'dark' ? 'active' : undefined} title="Sombre" aria-label="Sombre" aria-pressed={themeMode === 'dark'} onClick={() => setThemeMode('dark')}>
                  <MenuSvg d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z" size={15} />
                </button>
              </div>

              <div className="account-menu-divider" />
              <button type="button" role="menuitem" className="account-menu-item account-menu-danger" onClick={() => { setOpen(false); onLogout(); }}>
                <MenuSvg d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                Déconnexion
              </button>
            </>
  );

  const menuPortal =
    open && !sidebarCollapsed && typeof document !== 'undefined'
      ? createPortal(
          <>
            <button
              type="button"
              className="account-menu-backdrop"
              aria-label="Fermer"
              onClick={() => setOpen(false)}
            />
            <div
              className="account-menu-panel account-menu-panel--portal"
              role="menu"
              style={panelStyle}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {menuBody}
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <div className="account-menu-wrap" data-open={open ? '1' : '0'} data-rail={sidebarCollapsed ? '1' : '0'}>
      <button
        type="button"
        ref={triggerRef}
        className={`account-menu-trigger${open ? ' open' : ''}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {hasAvatarUrl() ? (
          <AvatarImage key={`av-${profileTick}`} className="sidebar-avatar sidebar-avatar-img" width={36} height={36} fallback={<span className="sidebar-avatar sidebar-avatar-img ac-topbar-avatar--ini">{typeof getDisplayInitials === 'function' ? getDisplayInitials() : '?'}</span>} />
        ) : (
          <span key={`ini-${profileTick}`} className="sidebar-avatar">{getDisplayInitials()}</span>
        )}
        <div className="sidebar-user-meta">
          <strong className="account-trigger-name">{getDisplayName()}</strong>
          <span className="account-trigger-role">{roleLabelFr(getRole())}</span>
        </div>
      </button>

      {open && sidebarCollapsed ? (
        <>
          <button
            type="button"
            className="account-menu-backdrop account-menu-backdrop--rail"
            aria-label="Fermer"
            onClick={() => setOpen(false)}
          />
          <div
            className="account-menu-panel account-menu-panel--rail-inline"
            role="menu"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {menuBody}
          </div>
        </>
      ) : null}
      {menuPortal}
    </div>
  );
}


/** If already logged in, skip the login screen.
 * Prefer getToken() so the check remains correct even if a bundler
 * ever fails to keep the isLoggedIn binding in a split chunk.
 */
function LoginGate() {
  const loggedIn = typeof isLoggedIn === 'function' ? isLoggedIn() : !!getToken();
  if (loggedIn) {
    // v0.7.6 — déjà connecté : /login renvoie vers la page d'ouverture
    // choisie (tableau de bord par défaut), plus jamais vers la vitrine.
    return <Navigate to={startDestination()} replace />;
  }
  return <Login />;
}

function Protected({ children }: { children: React.ReactNode }) {
  const loggedIn = typeof isLoggedIn === 'function' ? isLoggedIn() : !!getToken();
  if (!loggedIn) {
    return <Navigate to="/login" replace state={{ from: 'protected' }} />;
  }
  // First-run welcome locks the app until completed (survives refresh / URL changes)
  if (!isWelcomeCompleted()) {
    return <Navigate to="/welcome" replace />;
  }
  return <>{children}</>;
}

/** v0.7 — /download readable WITHOUT an account: APK manifest from the CDN,
 * standalone layout. Logged-in users keep the exact same Shell. */
function DownloadRoute() {
  // v0.7.1 — /download est TOUJOURS une landing standalone : ni topbar,
  // ni sidebar, ni FAB, ni Agent, connecté ou non (directive user).
  return (
    <div className="download-standalone">
      <Suspense fallback={<div style={{ padding: 48, textAlign: 'center' }}>Chargement…</div>}>
        <Download />
      </Suspense>
    </div>
  );
}

/** v0.7.3 — `/` est l'ACCUEIL public : aucune redirection en navigateur
 * classique (directive user) — le tableau de bord vit sur /dashboard et la
 * connexion sur /login. Deux exceptions qui doivent continuer de fonctionner :
 * la WebView native Android (UA « Atlas-Android ») et la PWA installée
 * (display-mode standalone) ouvrent `/` comme racine d'app — elles partent
 * vers /dashboard (ou /login), sinon l'app installée serait cassée. */
function HomeRoute() {
  const loggedIn = typeof isLoggedIn === 'function' ? isLoggedIn() : !!getToken();
  const native = /Atlas-Android/i.test(navigator.userAgent || '');
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  if (native || standalone) {
    return <Navigate to={loggedIn ? startDestination() : '/login'} replace />;
  }
  // v0.7.7 — « / » reste la VITRINE pour tout le monde, même connecté :
  // personne n'est renvoyé vers le dashboard en demandant explicitement la
  // homepage. La page d'ouverture ne s'applique qu'après la connexion
  // (LoginGate / welcome / WebView & PWA).
  return (
    <div className="download-standalone">
      <Suspense fallback={<div style={{ padding: 48, textAlign: 'center' }}>Chargement…</div>}>
        <Home />
      </Suspense>
    </div>
  );
}

/** v0.7.3 — /desktop : landing standalone de l'app bureau, comme /download. */
function DesktopRoute() {
  return (
    <div className="download-standalone">
      <Suspense fallback={<div style={{ padding: 48, textAlign: 'center' }}>Chargement…</div>}>
        <DesktopPage />
      </Suspense>
    </div>
  );
}

/** v0.7 — /about readable WITHOUT an account: standalone layout (no topbar,
 * no Agent, no session access). Logged-in users keep the exact same Shell. */
function AboutRoute() {
  // v0.7.6 — même barre pill que l'accueil ; v0.7.7 — liens identiques pour
  // tous, seul le CTA suit la session.
  return (
    <div className="public-about">
      <PublicNav
        // v0.7.7 — même navigation que pour un visiteur non connecté :
        // seuls le CTA (Se connecter / Ouvrir l'app) et le toggle suivent la session.
        links={[
          { href: '/', label: 'Accueil' },
          { href: '/desktop', label: 'Bureau' },
          { href: '/android', label: 'Android' },
          { href: '/whats-new', label: 'Nouveautés' },
        ]}
        cta={<PublicSessionCta />}
      />
      <Suspense fallback={<div style={{ padding: 48, textAlign: 'center' }}>Chargement…</div>}>
        <About />
      </Suspense>
    </div>
  );
}

/** v0.7 — /whats-new readable WITHOUT an account: static changelog only, in a
 * dedicated standalone layout (no topbar, no Agent, no API call, no session
 * access). Logged-in users keep the exact same Shell experience as before. */
function WhatsNewRoute() {
  // v0.7.6 — barre pill commune ; v0.7.7 — liens identiques pour tous.
  return (
    <div className="public-whats-new">
      <PublicNav
        // v0.7.7 — identique à la version visiteurs ; CTA adapté à la session.
        links={[
          { href: '/', label: 'Accueil' },
          { href: '/desktop', label: 'Bureau' },
          { href: '/android', label: 'Android' },
          { href: '/about', label: 'À propos' },
        ]}
        cta={<PublicSessionCta />}
      />
      <Suspense fallback={<div style={{ padding: 48, textAlign: 'center' }}>Chargement…</div>}>
        <WhatsNew />
      </Suspense>
    </div>
  );
}

function WelcomeGate() {
  const loggedIn = typeof isLoggedIn === 'function' ? isLoggedIn() : !!getToken();
  if (!loggedIn) {
    return <Navigate to="/login" replace />;
  }
  if (isWelcomeCompleted()) {
    return <Navigate to={startDestination()} replace />;
  }
  return (
    <Suspense fallback={<div className="welcome-stage"><p style={{ textAlign: 'center', padding: 48 }}>Chargement…</p></div>}>
      <Welcome />
    </Suspense>
  );
}

/** Prefer phone shell on native APK or narrow viewports / ?mode=phone */
function useIsPhoneShell() {
  const [phone, setPhone] = useState(() => {
    if (typeof window === 'undefined') return false;
    if (isNativeApp()) return true;
    if (new URLSearchParams(window.location.search).get('mode') === 'phone') return true;
    if (new URLSearchParams(window.location.search).get('mode') === 'pc') return false;
    return window.matchMedia('(max-width: 900px)').matches;
  });
  useEffect(() => {
    if (isNativeApp()) {
      setPhone(true);
      return;
    }
    const mq = window.matchMedia('(max-width: 900px)');
    const fn = () => {
      const mode = new URLSearchParams(window.location.search).get('mode');
      if (mode === 'phone') setPhone(true);
      else if (mode === 'pc') setPhone(false);
      else setPhone(mq.matches);
    };
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return phone;
}

type ThemeMode = 'light' | 'dark' | 'system';

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  }
  return mode;
}

// v0.7 — remember where a theme control was clicked so the circular reveal
// grows from that exact spot. Controls are tagged [data-theme-toggle].
let themeRevealOrigin: { x: number; y: number } | null = null;
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener(
    'click',
    (e) => {
      const t = e.target as HTMLElement | null;
      if (t && typeof t.closest === 'function' && t.closest('[data-theme-toggle]')) {
        themeRevealOrigin = { x: e.clientX, y: e.clientY };
      }
    },
    true,
  );
}
function takeThemeRevealOrigin() {
  const o = themeRevealOrigin;
  themeRevealOrigin = null;
  return o;
}

function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const v = localStorage.getItem('atlas-theme') || 'system';
    return v === 'dark' || v === 'light' || v === 'system' ? v : 'system';
  });
  useEffect(() => {
    const sync = () => {
      const v = localStorage.getItem('atlas-theme') || 'system';
      setMode(v === 'dark' || v === 'light' || v === 'system' ? v : 'system');
    };
    window.addEventListener('atlas-theme-change', sync);
    return () => window.removeEventListener('atlas-theme-change', sync);
  }, []);

  /* Professional dialog system (global): every .modal-card gets an
     accessible close "X", and keyboard focus is trapped inside the
     topmost open overlay (Tab / Shift+Tab cycle). */
  useEffect(() => {
    const ensureClose = (card: HTMLElement) => {
      if (card.querySelector(':scope > .modal-x')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'modal-x modal-close';
      btn.setAttribute('aria-label', 'Fermer');
      btn.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
      btn.addEventListener('click', () => {
        const overlay = card.closest('.modal-overlay');
        if (overlay) overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      card.insertBefore(btn, card.firstChild);
    };
    const scan = () =>
      document.querySelectorAll<HTMLElement>('.modal-overlay .modal-card, .modal-overlay > .modal').forEach(ensureClose);
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });
    scan();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const overlays = document.querySelectorAll('.modal-overlay');
      const top = overlays[overlays.length - 1] as HTMLElement | undefined;
      if (!top) return;
      const f = Array.from(
        top.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!top.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      mo.disconnect();
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);
  useEffect(() => {
    const apply = () => {
      const resolved = resolveTheme(mode);
      const root = document.documentElement;
      const doApply = (colorFade = true) => {
        root.setAttribute('data-theme', resolved);
        // Legacy rules + skeletons key off .theme-dark — keep both in sync.
        root.classList.toggle('theme-dark', resolved === 'dark');
        // Native controls (select, date pickers, scrollbars) follow the theme.
        root.style.colorScheme = resolved;
        // Brief global color transition so the swap never flashes (skipped
        // when the circular reveal already animates the whole swap).
        if (colorFade) {
          root.classList.add('theme-anim');
          window.setTimeout(() => root.classList.remove('theme-anim'), 260);
        }
        // Browser / WebView chrome (status bar on phone) follows the theme.
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', resolved === 'dark' ? '#111113' : '#f4f5f7');
      };
      // v0.7 — theme swap: a circular reveal that grows from the exact spot
      // of the switch the user clicked (light→dark AND dark→light), via the
      // View Transitions API; graceful cross-fade fallback where it is missing.
      const prev = root.getAttribute('data-theme');
      const reduce = typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (prev && prev !== resolved && !reduce) {
        const doc = document as Document & { startViewTransition?: (cb: () => void) => any };
        if (typeof doc.startViewTransition === 'function') {
          const o = takeThemeRevealOrigin();
          const x = o ? o.x : window.innerWidth - 44;
          const y = o ? o.y : 44;
          const vt = doc.startViewTransition(() => doApply(false));
          const ready = vt ? vt.ready : null;
          if (ready && typeof ready.then === 'function') {
            ready.then(() => {
              const radius = Math.hypot(
                Math.max(x, window.innerWidth - x),
                Math.max(y, window.innerHeight - y),
              );
              doc.documentElement.animate(
                {
                  clipPath: [
                    `circle(0px at ${x}px ${y}px)`,
                    `circle(${radius}px at ${x}px ${y}px)`,
                  ],
                },
                {
                  duration: 480,
                  easing: 'cubic-bezier(0.35, 0, 0.25, 1)',
                  pseudoElement: '::view-transition-new(root)',
                },
              );
            }).catch(() => { /* transition skipped (interrupted) — fine */ });
          }
          return;
        }
        root.classList.add('theme-anim');
        doApply();
        window.setTimeout(() => root.classList.remove('theme-anim'), 420);
        return;
      }
      doApply();
    };
    apply();
    localStorage.setItem('atlas-theme', mode);
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = () => apply();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [mode]);
  return {
    mode,
    resolved: resolveTheme(mode),
    setMode,
    toggle: () => setMode((m) => (resolveTheme(m) === 'dark' ? 'light' : 'dark')),
  };
}

/** Full PC desk — all ERP modules + action inbox */
function DesktopShell() {
  const navigate = useNavigate();
  const location = useLocation();
  useProfileWarm();
  // v0.7 — topbar/avatar re-render as soon as the profile cache warms.
  useProfileTick();
  const isFocusRoute =
    location.pathname === '/settings' ||
    location.pathname.startsWith('/settings/') ||
    location.pathname === '/about' ||
    location.pathname === '/whats-new';
  const isSettingsRoute = location.pathname === '/settings' || location.pathname.startsWith('/settings/');
  const settingsTab = new URLSearchParams(location.search).get('tab') || 'profile';
  const [focusUserMenuOpen, setFocusUserMenuOpen] = useState(false);
  const [shellSearchOpen, setShellSearchOpen] = useState(false);
  const [searchOpts, setSearchOpts] = useState({ whole: false, regex: false, notes: true });
  const [shellAlerts, setShellAlerts] = useState<any[]>([]);
  const [shellSearch, setShellSearch] = useState('');
  const [shellSearchHits, setShellSearchHits] = useState<{ type: string; id: number | string; label: string; sub?: string; to: string }[]>([]);
  const [shellSearchLoading, setShellSearchLoading] = useState(false);
  const [shellUserOpen, setShellUserOpen] = useState(false);
  

  const [shellNotifOpen, setShellNotifOpen] = useState(false);
  const [settingsTopSearch, setSettingsTopSearch] = useState('');
  const [settingsSearchOpen, setSettingsSearchOpen] = useState(false);
  const [settingsSearchHistory, setSettingsSearchHistory] = useState<string[]>(() => loadSearchHistory());

  // v0.7.7 — la topbar Paramètres rétrécit en descendant, grandit en remontant
  const [settingsBarCompact, setSettingsBarCompact] = useState(false);
  useEffect(() => {
    // v0.7.7 — hystérésis 48 px : aucun scintillement au scroll.
    let last = window.scrollY;
    let acc = 0;
    let compactNow = false;
    const onScroll = () => {
      const y = window.scrollY;
      const d = y - last;
      last = y;
      if (y <= 60) {
        acc = 0;
        if (compactNow) { compactNow = false; setSettingsBarCompact(false); }
        return;
      }
      if (d > 0) {
        acc = acc > 0 ? acc + d : d;
        if (!compactNow && y > 140 && acc > 48) { compactNow = true; setSettingsBarCompact(true); }
      } else if (d < 0) {
        acc = acc < 0 ? acc + d : d;
        if (compactNow && acc < -48) { compactNow = false; setSettingsBarCompact(false); }
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const [focusWhatsNewUnread, setFocusWhatsNewUnread] = useState(() => hasUnreadWhatsNew());
  useEffect(() => {
    const sync = () => setFocusWhatsNewUnread(hasUnreadWhatsNew());
    window.addEventListener('atlas-whats-new-seen', sync);
    return () => window.removeEventListener('atlas-whats-new-seen', sync);
  }, []);

  useEffect(() => {
    if (!shellNotifOpen) { setShellAlerts([]); return; }
    let cancelled = false;
    api.getAlerts().then((r: any) => { if (!cancelled) setShellAlerts(r?.data || []); }).catch(() => { if (!cancelled) setShellAlerts([]); });
    return () => { cancelled = true; };
  }, [shellNotifOpen]);

  useEffect(() => {
    const q = shellSearch.trim();
    if (!shellSearchOpen || q.length < 2) {
      setShellSearchHits([]);
      setShellSearchLoading(false);
      return;
    }
    let cancelled = false;
    setShellSearchLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let match: (s: string) => boolean;
        if (searchOpts.regex) {
          try { const re = new RegExp(q, 'i'); match = (v: string) => re.test(v); } catch { match = () => false; }
        } else if (searchOpts.whole) {
          const re = new RegExp(`(^|[^\\w])${esc}([^\\w]|$)`, 'i'); match = (v: string) => re.test(v);
        } else {
          const ql0 = q.toLowerCase(); match = (v: string) => v.toLowerCase().includes(ql0);
        }
        const [clientsRes, productsRes, invoicesRes, vendorsRes] = await Promise.all([
          api.getClients().catch(() => ({ data: [] as any[] })),
          api.getProducts().catch(() => ({ data: [] as any[] })),
          api.getInvoices().catch(() => ({ data: [] as any[] })),
          (api as any).getVendors ? (api as any).getVendors().catch(() => ({ data: [] as any[] })) : Promise.resolve({ data: [] as any[] }),
        ]);
        if (cancelled) return;
        const hits: { type: string; id: number | string; label: string; sub?: string; to: string }[] = [];
        const PAGES: [string, string][] = [['tableau de bord', '/'], ['produits', '/products'], ['stock', '/products'], ['clients', '/clients'], ['factures', '/invoices'], ['devis', '/quotes'], ['caisse', '/quick-sale'], ['scan', '/scan'], ['fournisseurs', '/vendors'], ['achats', '/bills'], ['paramètres', '/settings'], ['nouveautés', '/whats-new'], ['à propos', '/about']];
        for (const [label, to] of PAGES) {
          if (match(label)) hits.push({ type: 'Page', id: to, label: label[0].toUpperCase() + label.slice(1), to });
        }
        for (const c of (clientsRes as any)?.data || []) {
          const blob = `${c.name || ''} ${c.ice || ''} ${c.city || ''} ${c.email || ''} ${c.phone || ''} ${searchOpts.notes ? (c.notes || '') : ''}`;
          if (match(blob)) {
            hits.push({ type: 'Client', id: c.id, label: c.name || `Client #${c.id}`, sub: [c.ice, c.city].filter(Boolean).join(' · '), to: '/clients' });
          }
          if (hits.length >= 8) break;
        }
        for (const p of (productsRes as any)?.data || []) {
          const blob = `${p.name || ''} ${p.sku || ''} ${p.barcode || ''} ${p.category || ''} ${searchOpts.notes ? (p.description || '') : ''}`;
          if (match(blob)) {
            hits.push({ type: 'Produit', id: p.id, label: p.name || `Produit #${p.id}`, sub: p.sku || p.category || '', to: '/products' });
          }
          if (hits.filter((h) => h.type === 'Produit').length >= 6) break;
        }
        for (const v of (vendorsRes as any)?.data || []) {
          const blob = `${v.name || ''} ${v.contact || ''} ${v.phone || ''} ${v.city || ''}`;
          if (match(blob)) {
            hits.push({ type: 'Fournisseur', id: v.id, label: v.name || `Fournisseur #${v.id}`, sub: v.city || v.phone || '', to: '/vendors' });
          }
          if (hits.filter((h) => h.type === 'Fournisseur').length >= 4) break;
        }
        for (const inv of (invoicesRes as any)?.data || []) {
          const blob = `${inv.number || ''} ${inv.client_name || ''} ${inv.status || ''}`;
          if (match(blob)) {
            hits.push({
              type: inv.kind === 'quote' ? 'Devis' : 'Facture',
              id: inv.id,
              label: inv.number || `Doc #${inv.id}`,
              sub: inv.client_name || inv.status || '',
              to: inv.kind === 'quote' ? '/quotes' : `/invoices/${inv.id}`,
            });
          }
          if (hits.filter((h) => h.type === 'Facture' || h.type === 'Devis').length >= 6) break;
        }
        setShellSearchHits(hits.slice(0, 16));
      } catch {
        if (!cancelled) setShellSearchHits([]);
      } finally {
        if (!cancelled) setShellSearchLoading(false);
      }
    }, 280);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [shellSearch, shellSearchOpen, searchOpts]);

  useEffect(() => {
    // Close focus user menu when route changes
    setFocusUserMenuOpen(false);
    setShellUserOpen(false);
  }, [location.pathname, location.search]);

  const SETTINGS_TOP_TABS: { id: string; label: string; icon: string }[] = [
    { id: 'profile', label: 'Mon profil', icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z' },
    { id: 'company', label: 'Société', icon: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6' },
    { id: 'attendance', label: 'Présence', icon: 'M12 6v6l4 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z' },
    { id: 'legal', label: 'Légal', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6' },
    { id: 'invoicing', label: 'Facturation', icon: 'M8 2h8a2 2 0 0 1 2 2v16l-3-1.5L12 21l-3-1.5L6 20V4a2 2 0 0 1 2-2z' },
    { id: 'documents', label: 'PDF', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h4' },
    { id: 'warehouse', label: 'Entrepôts', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
    { id: 'categories', label: 'Catégories', icon: 'M4 6h16M4 12h16M4 18h10' },
    { id: 'integrations', label: 'API', icon: 'M10 13a5 5 0 0 0 7.07 0l1.41-1.41a5 5 0 0 0-7.07-7.07L10 5.5M14 11a5 5 0 0 0-7.07 0L5.5 12.43a5 5 0 0 0 7.07 7.07L14 18.5' },
    { id: 'app', label: 'Mise à jour app', icon: 'M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 18h2M12 2v0' },
    { id: 'admin', label: 'Admin', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68V3a2 2 0 1 1 4 0v.09c0 .66.39 1.26 1 1.51.6.26 1.3.12 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.66 0 1.26.39 1.51 1H21a2 2 0 1 1 0 4h-.09c-.25.61-.85 1-1.51 1z' },
    { id: 'audit', label: 'Journal d’audit', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h4' },
  ];
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const [badges, setBadges] = useState<NavBadges>(EMPTY_BADGES);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const v = localStorage.getItem('atlas-sidebar-collapsed');
      // Default collapsed when unset (cleaner first paint / compact-friendly)
      if (v === null || v === '') return true;
      return v === '1';
    } catch {
      return true;
    }
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const shellOverlayOpen = shellNotifOpen || shellSearchOpen || mobileNavOpen;
  useEffect(() => {
    document.documentElement.classList.toggle('atlas-overlay-open', shellOverlayOpen);
    return () => document.documentElement.classList.remove('atlas-overlay-open');
  }, [shellOverlayOpen]);
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.documentElement.classList.add('mobile-nav-open');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.documentElement.classList.remove('mobile-nav-open');
    };
  }, [mobileNavOpen]);
  // Close drawer on route change
  const locPath = useLocation().pathname;
  useEffect(() => {
    setMobileNavOpen(false);
  }, [locPath]);
  useEffect(() => {
    try {
      localStorage.setItem('atlas-sidebar-collapsed', sidebarCollapsed ? '1' : '0');
    } catch { /* ignore */ }
  }, [sidebarCollapsed]);
  useEffect(() => startSessionGuard(), []);

  useEffect(() => {
    const run = () => {
      void import('./pages/Dashboard');
      void import('./pages/Products');
      void import('./pages/Invoices');
      void import('./pages/Actions');
    };
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(run, { timeout: 2500 });
    } else {
      setTimeout(run, 1200);
    }
  }, []);

  // Nav notification counts (unpaid, low stock, pending actions…)
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api
        .getNavBadges()
        .then((r: any) => {
          if (!cancelled && r?.data) setBadges({ ...EMPTY_BADGES, ...r.data });
        })
        .catch(() => { /* keep last */ });
    };
    load();
    const t = window.setInterval(load, 60_000);
    const onFocus = () => load();
    const onRefresh = () => load();
    window.addEventListener('focus', onFocus);
    window.addEventListener('atlas-nav-badges-refresh', onRefresh as EventListener);
    return () => {
      cancelled = true;
      window.clearInterval(t);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('atlas-nav-badges-refresh', onRefresh as EventListener);
    };
  }, []);

  const logout = () => {
    clearToken();
    invalidateAvatarCache();
    // Full navigation so protected Shell cannot flash dashboard without session
    window.location.replace('/login');
  };

  return (
    <>
      <ScrollToTop />
      <AtlasLoadingBar />
      <GlobalSearchPanel />
      <div className={`layout${sidebarCollapsed ? ' sidebar-collapsed' : ''}${mobileNavOpen ? ' mobile-nav-open' : ''}${isFocusRoute ? ' layout-settings-focus' : ''}`}>
      <OfflineBanner />

      <button
        type="button"
        className="mobile-nav-toggle"
        aria-label={mobileNavOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
        aria-expanded={mobileNavOpen}
        onClick={() => setMobileNavOpen((v) => !v)}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          {mobileNavOpen ? (
            <>
              <path d="M18 6L6 18" />
              <path d="M6 6l12 12" />
            </>
          ) : (
            <>
              <path d="M4 7h16" />
              <path d="M4 12h16" />
              <path d="M4 17h16" />
            </>
          )}
        </svg>
      </button>
      {mobileNavOpen && (
        <button
          type="button"
          className="mobile-nav-backdrop"
          aria-label="Fermer le menu"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      
      {/* v0.7 — dock mobile (téléphone / tablette portrait) : barre basse
          translucide, libellés opaques, bouton central surélevé */}
      <nav className="mobile-dock" aria-label="Navigation principale mobile">
        <NavLink to="/dashboard" end className={({ isActive }) => `mobile-dock-item${isActive ? ' active' : ''}`}>
          <NavIcon d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z" />
          <span>Accueil</span>
        </NavLink>
        <NavLink to="/products" className={({ isActive }) => `mobile-dock-item${isActive ? ' active' : ''}`}>
          <NavIcon d="M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8" />
          <span>Produits</span>
        </NavLink>
        {canManageStock() && (
          <NavLink to="/scan" className={({ isActive }) => `mobile-dock-item mobile-dock-center${isActive ? ' active' : ''}`}>
            <span className="dock-bubble">
              <NavIcon d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2M8 12h8" />
            </span>
            <span>Scan</span>
          </NavLink>
        )}
        {canSell() && (
          <NavLink to="/quick-sale" className={({ isActive }) => `mobile-dock-item${isActive ? ' active' : ''}`}>
            <NavIcon d="M6 2h12l1 5H5l1-5zM5 7v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7M9 11h6" />
            <span>Vente</span>
          </NavLink>
        )}
        <NavLink to="/settings" className={({ isActive }) => `mobile-dock-item${isActive ? ' active' : ''}`}>
          <NavIcon d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM19.4 12a7.4 7.4 0 0 0-.12-1.3l2.1-1.6-2-3.5-2.45 1a7.4 7.4 0 0 0-2.2-1.3L14.3 2.6h-4l-.43 2.7a7.4 7.4 0 0 0-2.2 1.3l-2.45-1-2 3.5 2.1 1.6a7.4 7.4 0 0 0 0 2.6l-2.1 1.6 2 3.5 2.45-1a7.4 7.4 0 0 0 2.2 1.3l.43 2.7h4l.43-2.7a7.4 7.4 0 0 0 2.2-1.3l2.45 1 2-3.5-2.1-1.6c.08-.43.12-.86.12-1.3z" />
          <span>Réglages</span>
        </NavLink>
      </nav>

      <aside
        className={`sidebar ac-sidebar${sidebarCollapsed ? ' is-collapsed' : ''}${mobileNavOpen ? ' mobile-open' : ''}`}
        aria-expanded={!sidebarCollapsed || mobileNavOpen}
        onClick={(e) => {
          const a = (e.target as HTMLElement).closest('a');
          if (a) setMobileNavOpen(false);
        }}
      >
        <div className="logo" title="Double-clic pour réduire / agrandir le menu" onDoubleClick={() => setSidebarCollapsed((v) => !v)} style={{ cursor: 'pointer' }}>
          {/* v265 — raster brand: black art in light theme, white art in dark */}
          <img src="/atlas-icon-light.png" alt="" className="logo-img brand-img brand-img--light" width={36} height={36} />
          <img src="/atlas-icon-dark.png" alt="" className="logo-img brand-img brand-img--dark" width={36} height={36} />
          {/* v0.7 — expanded sidebar: the FULL lockup (mark + wordmark), per theme */}
          <img src="/atlas-logo-light.png" alt="Atlas Commerce" className="brand-lockup brand-lockup--light brand-img brand-img--light" width={105} height={34} />
          <img src="/atlas-logo-dark.png" alt="Atlas Commerce" className="brand-lockup brand-lockup--dark brand-img brand-img--dark" width={105} height={34} />
          <div className="logo-text">
            <span className="logo-sub">{isStockRole() ? 'Stock · magasinier' : 'Stock & facturation'}</span>
          </div>
        </div>
                <nav>
          <div className="nav-section">Vue d&apos;ensemble</div>
          {canOfficeWork() && (
          <NavLink to="/dashboard" end className={({ isActive }) => (isActive ? 'active' : '')} data-tooltip="Tableau de bord" title="Tableau de bord">
            <span className="nav-main"><NavIcon d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z" /><span className="nav-label">Tableau de bord</span></span>
          </NavLink>
          )}
          <div className="nav-section">Catalogue</div>
{canManageStock() && (
          <NavLink to="/products" className={({ isActive }) => (isActive ? 'active' : '')} data-tooltip="Produits & stock" title="Produits & stock">
            <span className="nav-main"><NavIcon d="M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8" /><span className="nav-label">Produits &amp; stock</span></span>
          </NavLink>
          )}
          {canOfficeWork() && (
          <>
          <div className="nav-section">Relation client</div>
          <NavLink to="/clients" className={({ isActive }) => (isActive ? 'active' : '')} data-tooltip="Clients" title="Clients">
            <span className="nav-main"><NavIcon paths={['M17 18a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2', 'M12 14a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M16 2v4', 'M14 4h4']} /><span className="nav-label">Clients</span></span>
          </NavLink>
          <div className="nav-section">Équipe</div>
          <NavLink to="/employees" className={({ isActive }) => (isActive ? 'active' : '')} data-tooltip="Employés" title="Employés">
            <span className="nav-main"><NavIcon paths={['M16 20V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v15', 'M2 10h20v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8z', 'M6 10V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2']} /><span className="nav-label">Employés</span></span>
          </NavLink>
          
          <NavLink to="/attendance" className={({ isActive }) => (isActive ? 'active' : '')} data-tooltip="Présence" title="Présence">
            <span className="nav-main"><NavIcon d="M12 6v6l4 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z"/><span className="nav-label">Présence</span></span>
          </NavLink>
<NavLink to="/quotes" className={({ isActive }) => (isActive ? 'active' : '')} data-tooltip="Devis" title="Devis">
            <span className="nav-main"><NavIcon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h4" /><span className="nav-label">Devis</span></span>
          </NavLink>
          <NavLink to="/quick-sale" className={({ isActive }) => (isActive ? 'active' : '')} data-tooltip="Vente rapide" title="Vente rapide">
            <span className="nav-main"><NavIcon d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L20 7H7M9 19a1.5 1.5 0 1 0 0.01 0M17 19a1.5 1.5 0 1 0 0.01 0" /><span className="nav-label">Vente rapide</span></span></NavLink>
          <NavLink to="/invoices" className={({ isActive }) => (isActive ? 'active' : '')} data-tooltip="Factures de vente" title="Factures de vente">
            <span className="nav-main"><NavIcon d="M8 2h8a2 2 0 0 1 2 2v16l-3-1.5L12 21l-3-1.5L6 20V4a2 2 0 0 1 2-2zM9 8h6M9 12h6" /><span className="nav-label">Factures de vente</span></span>
          </NavLink>
          <NavLink to="/reimbursements" className={({ isActive }) => (isActive ? 'active' : '')} data-tooltip="Remboursements" title="Remboursements">
            <span className="nav-main"><NavIcon d="M3 12a9 9 0 1 0 9-9M3 4v5h5M12 8v4l3 2" /><span className="nav-label">Remboursements</span></span>
          </NavLink>
          <NavLink to="/receipts" className={({ isActive }) => (isActive ? 'active' : '')} data-tooltip="Reçus" title="Reçus">
            <span className="nav-main"><NavIcon d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21V3zM9 8h6M9 12h6" /><span className="nav-label">Reçus</span></span>
          </NavLink>
          </>
          )}
          {canOfficeWork() && (
          <>
          <div className="nav-section">Achats</div>
          <NavLink to="/vendors" className={({ isActive }) => (isActive ? 'active' : '')} data-tooltip="Fournisseurs" title="Fournisseurs">
            <span className="nav-main"><NavIcon d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6" /><span className="nav-label">Fournisseurs</span></span>
          </NavLink>
          <NavLink to="/bills" className={({ isActive }) => (isActive ? 'active' : '')} data-tooltip="Factures d'achat" title="Factures d'achat">
            <span className="nav-main"><NavIcon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 18v-6M9 15h6" /><span className="nav-label">Factures d&apos;achat</span></span>
            <NavCount n={Math.max(badges.bills_unpaid, badges.bills_receive)} tone="warn" />
          </NavLink>
          </>
          )}
          {canOfficeWork() && (
          <>
          <div className="nav-section">Finance</div>
          <NavLink to="/balance" className={({ isActive }) => (isActive ? 'active' : '')} data-tooltip="Solde & recettes" title="Solde & recettes">
            <span className="nav-main"><NavIcon d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /><span className="nav-label">Solde &amp; recettes</span></span>
          </NavLink>
          <NavLink to="/reports" className={({ isActive }) => (isActive ? 'active' : '')} data-tooltip="Rapports & clôture" title="Rapports & clôture">
            <span className="nav-main"><NavIcon d="M3 3v18h18M7 14l4-4 3 3 5-6" /><span className="nav-label">Rapports &amp; clôture</span></span>
          </NavLink>
          </>
          )}
          {canAccessInventoryOps() && (
          <NavLink to="/inventory-ops" className={({ isActive }) => (isActive ? 'active' : '')} data-tooltip="Ops stock" title="Ops stock">
            <span className="nav-main"><NavIcon d="M4 7V5a1 1 0 0 1 1-1h2M20 7V5a1 1 0 0 0-1-1h-2M4 17v2a1 1 0 0 0 1 1h2M20 17v2a1 1 0 0 1-1 1h-2M7 12h10" /><span className="nav-label">Ops stock</span></span>
          </NavLink>
          )}
        </nav>
        {/* collapse: double-clic logo or bouton topbar */}
      </aside>
      

        {sidebarCollapsed && (
          <div className="atlas-collapsed-alerts" aria-label="Alertes">
{badges.invoices_unpaid > 0 && (
              <NavLink to="/invoices" className="atlas-collapsed-alert tone-danger">
                <span className="aca-dot" />
                <span>Factures impayées</span>
                <span className="aca-count">{badges.invoices_unpaid}</span>
              </NavLink>
            )}
            {badges.products_low > 0 && (
              <NavLink to="/products" className="atlas-collapsed-alert tone-danger">
                <span className="aca-dot" />
                <span>Stock bas</span>
                <span className="aca-count">{badges.products_low}</span>
              </NavLink>
            )}
            {badges.actions_pending > 0 && (
              <NavLink to="/actions" className="atlas-collapsed-alert tone-warn">
                <span className="aca-dot" />
                <span>Actions mobile</span>
                <span className="aca-count">{badges.actions_pending}</span>
              </NavLink>
            )}
            {badges.vr_open > 0 && (
              <NavLink to="/quick-sale" className="atlas-collapsed-alert tone-warn">
                <span className="aca-dot" />
                <span>VR ouvertes</span>
                <span className="aca-count">{badges.vr_open}</span>
              </NavLink>
            )}
          </div>
        )}

        <div className="ac-main-column">
        {!isFocusRoute && (
        <header className={`ac-topbar ac-topbar--bionis${shellSearchOpen ? ' ac-topbar--searching' : ''}`} role="banner">
          <div className="ac-topbar-left">
            <button
              type="button"
              className="ac-topbar-icon ac-topbar-menu-btn secondary ac-topbar-menu-mobile"
              aria-label={mobileNavOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
              onClick={() => {
                setMobileNavOpen((v) => {
                  const next = !v;
                  if (next) setSidebarCollapsed(false); // always full labels in phone drawer
                  return next;
                });
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
              </svg>
            </button>
            {sidebarCollapsed && (
              <button
                type="button"
                className="ac-topbar-icon secondary ac-topbar-collapse-desktop"
                aria-label="Agrandir le menu"
                onClick={() => setSidebarCollapsed(false)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <rect x="3" y="4" width="18" height="16" rx="3" />
                  <path d="M9 4v16" />
                </svg>
              </button>
            )}
            <span className="ac-topbar-title">
              {location.pathname === '/' || location.pathname === ''
                ? 'Tableau de bord'
                : location.pathname.replace(/^\//, '').split('/')[0].replace(/-/g, ' ')}
            </span>
          </div>
          <div className="ac-topbar-right">
            {shellSearchOpen ? (
              <div className="ac-topbar-search-wrap">
                <div className="ac-topbar-search-expanded">
                  <svg className="ac-topbar-search-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" strokeLinecap="round" />
                  </svg>
                  <input
                    className="ac-topbar-search-input"
                    type="search"
                    autoFocus
                    placeholder="Rechercher clients, produits, factures…"
                    value={shellSearch}
                    onChange={(e) => setShellSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setShellSearch('');
                        setShellSearchHits([]);
                        setShellSearchOpen(false);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="ac-topbar-search-clear secondary"
                    aria-label="Fermer la recherche"
                    onClick={() => { setShellSearch(''); setShellSearchHits([]); setShellSearchOpen(false); }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" /></svg>
                  </button>
                </div>
                <div className="ac-shell-search-opts" role="group" aria-label="Options de recherche">
                  {([['whole', 'Mot entier'], ['regex', 'Regex'], ['notes', 'Notes']] as const).map(([k, lbl]) => (
                    <label key={k} className="ac-shell-search-opt">
                      <input
                        type="checkbox"
                        checked={(searchOpts as any)[k]}
                        onChange={(e) => setSearchOpts((o) => ({ ...o, [k]: e.target.checked }))}
                      />
                      <span>{lbl}</span>
                    </label>
                  ))}
                </div>
                {(shellSearch.trim().length >= 2) && (
                  <div className="ac-shell-search-dropdown" role="listbox">
                    {shellSearchLoading && <div className="ac-shell-search-empty">Recherche…</div>}
                    {!shellSearchLoading && shellSearchHits.length === 0 && (
                      <div className="ac-shell-search-empty">Aucun résultat pour « {shellSearch.trim()} »</div>
                    )}
                    {!shellSearchLoading && shellSearchHits.map((h) => (
                      <button
                        key={`${h.type}-${h.id}`}
                        type="button"
                        className="ac-shell-search-hit secondary"
                        role="option"
                        onClick={() => {
                          setShellSearchOpen(false);
                          setShellSearch('');
                          setShellSearchHits([]);
                          navigate(h.to);
                        }}
                      >
                        <span className="ac-shell-search-type">{h.type}</span>
                        <span className="ac-shell-search-label">
                          <strong>{h.label}</strong>
                          {h.sub ? <em>{h.sub}</em> : null}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                className="ac-topbar-icon secondary"
                aria-label="Rechercher"
                onClick={() => setShellSearchOpen(true)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                  <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" strokeLinecap="round" />
                </svg>
              </button>
            )}

            <button
              type="button"
              data-theme-toggle
              className="ac-topbar-icon secondary ac-topbar-theme"
              aria-label={resolveTheme(themeMode) === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre'}
              title={resolveTheme(themeMode) === 'dark' ? 'Thème clair' : 'Thème sombre'}
              aria-pressed={resolveTheme(themeMode) === 'dark'}
              onClick={() => setThemeMode(resolveTheme(themeMode) === 'dark' ? 'light' : 'dark')}
            >
              {resolveTheme(themeMode) === 'dark' ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden>
                  <circle cx="12" cy="12" r="4.2" />
                  <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden>
                  <path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
            <div className="ac-topbar-notif-wrap">
              <button
                type="button"
                className="ac-topbar-icon secondary ac-topbar-bell"
                aria-label="Notifications"
                aria-expanded={shellNotifOpen}
                onClick={() => { setShellNotifOpen((v) => !v); setShellUserOpen(false); }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden>
                  <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                </svg>
                {(badges.actions_pending + badges.employees_pay_due + badges.invoices_unpaid + badges.products_low) > 0 ? (
                  <span className="ac-topbar-badge">
                    {Math.min(99, badges.actions_pending + badges.employees_pay_due + badges.invoices_unpaid + badges.products_low)}
                  </span>
                ) : null}
              </button>
              {shellNotifOpen && (
                <>
                  <div className="ac-topbar-menu-backdrop" role="presentation" aria-hidden onClick={() => setShellNotifOpen(false)} />
                  <div className="ac-notif-panel" role="dialog" aria-label="Notifications">
                    <div className="ac-notif-head">
                      <strong>Notifications</strong>
                      <span className="ac-notif-unread">
                        {badges.actions_pending + badges.employees_pay_due + badges.invoices_unpaid + badges.products_low} alertes
                      </span>
                    </div>
                    <ul className="ac-notif-list">
                      {badges.actions_pending > 0 && (
                        <li>
                          <button type="button" className="ac-notif-item" onClick={() => { setShellNotifOpen(false); navigate('/actions'); }}>
                            <span className="ac-notif-dot warn" />
                            <span>
                              <strong>Actions mobile</strong>
                              <em>{badges.actions_pending} en attente</em>
                            </span>
                          </button>
                        </li>
                      )}
                      {badges.products_low > 0 && (
                        <li>
                          <button type="button" className="ac-notif-item" onClick={() => { setShellNotifOpen(false); navigate('/products'); }}>
                            <span className="ac-notif-dot danger" />
                            <span>
                              <strong>Stock bas</strong>
                              <em>{badges.products_low} articles</em>
                            </span>
                          </button>
                        </li>
                      )}
                      {badges.invoices_unpaid > 0 && (
                        <li>
                          <button type="button" className="ac-notif-item" onClick={() => { setShellNotifOpen(false); navigate('/invoices'); }}>
                            <span className="ac-notif-dot danger" />
                            <span>
                              <strong>Factures impayées</strong>
                              <em>{badges.invoices_unpaid}</em>
                            </span>
                          </button>
                        </li>
                      )}
                      {badges.employees_pay_due > 0 && (
                        <li>
                          <button type="button" className="ac-notif-item" onClick={() => { setShellNotifOpen(false); navigate('/employees'); }}>
                            <span className="ac-notif-dot warn" />
                            <span>
                              <strong>Paies dues</strong>
                              <em>{badges.employees_pay_due} employé(s)</em>
                            </span>
                          </button>
                        </li>
                      )}
                      {(badges.actions_pending + badges.employees_pay_due + badges.invoices_unpaid + badges.products_low) === 0 && (
                        <li className="ac-notif-empty">Tout est à jour</li>
                      )}
                                          {shellAlerts.slice(0, 8).map((a: any, idx: number) => (
                        <li key={`al-${a.kind}-${idx}`}>
                          <button type="button" className="ac-notif-item" onClick={() => { setShellNotifOpen(false); navigate(a.href || '/'); }}>
                            <span className={`ac-notif-dot ${a.severity === 'high' ? 'danger' : a.severity === 'medium' ? 'warn' : ''}`} />
                            <span>
                              <strong>{a.label}</strong>
                              <em>{String(a.kind).replace(/_/g, ' ')}</em>
                            </span>
                          </button>
                        </li>
                      ))}
</ul>
                    <button type="button" className="ac-notif-all" onClick={() => { setShellNotifOpen(false); navigate('/actions'); }}>
                      Tout voir
                    </button>
                  </div>
                </>
              )}
            </div>
            <TopbarUserMenu
              displayName={typeof getDisplayName === 'function' ? getDisplayName() : 'Utilisateur'}
              roleLabel={roleLabelFr(typeof getRole === 'function' ? getRole() : '')}
              initials={typeof getDisplayInitials === 'function' ? getDisplayInitials() : '?'}
              onLogout={logout}
            />
          </div>
        </header>
        )}

      {isFocusRoute && (
        <header className={`settings-topbar${settingsBarCompact ? ' settings-topbar--compact' : ''}`} role="banner">
          <div className="settings-topbar-left">
            <button
              type="button"
              className="settings-topbar-back"
              onClick={() => navigate('/dashboard')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Tableau de bord
            </button>
            <span className="settings-topbar-sep" aria-hidden />
            <div className="settings-topbar-brand">
              <img src="/atlas-icon-light.png" alt="" className="brand-img brand-img--light" width={28} height={28} />
              <img src="/atlas-icon-dark.png" alt="" className="brand-img brand-img--dark" width={28} height={28} />
              <div>
                <strong>
                  {isSettingsRoute
                    ? 'Paramètres'
                    : location.pathname === '/whats-new'
                      ? 'Nouveautés'
                      : 'À propos'}
                </strong>
                <span>Atlas Commerce · beta</span>
              </div>
            </div>
          </div>
          {isSettingsRoute && (
            <nav className="settings-topbar-tabs" aria-label="Sections paramètres">
              {SETTINGS_TOP_TABS.filter((tab) => {
                if (tab.id === 'profile') return true;
                if (tab.id === 'admin' || tab.id === 'audit' || tab.id === 'app') return canAccessAdminSettings();
                return canAccessCompanySettings();
              }).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`settings-topbar-tab secondary${settingsTab === tab.id ? ' active' : ''}`}
                  title={tab.label}
                  aria-label={tab.label}
                  aria-current={settingsTab === tab.id ? 'page' : undefined}
                  onClick={() => navigate(`/settings?tab=${tab.id}`)}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={tab.icon} />
                  </svg>
                </button>
              ))}
            </nav>
          )}

          {location.pathname === '/whats-new' && (
            <nav className="settings-topbar-tabs whats-new-topbar-tabs" aria-label="Filtrer les nouveautés">
              {(
                [
                  { id: 'all', label: 'Tout', icon: 'M4 6h16M4 12h16M4 18h10' },
                  { id: 'added', label: 'Ajouté', icon: 'M12 5v14M5 12h14' },
                  { id: 'improved', label: 'Amélioré', icon: 'M12 19V5M5 12l7-7 7 7' },
                  { id: 'fixed', label: 'Corrigé', icon: 'M20 6L9 17l-5-5' },
                ] as const
              ).map((tab) => {
                const f = new URLSearchParams(location.search).get('f') || 'all';
                const active = tab.id === 'all' ? f === 'all' : f === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    className={`settings-topbar-tab secondary${active ? ' active' : ''}`}
                    title={tab.label}
                    aria-label={tab.label}
                    aria-current={active ? 'page' : undefined}
                    onClick={() =>
                      navigate(tab.id === 'all' ? '/whats-new' : `/whats-new?f=${tab.id}`)
                    }
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d={tab.icon} />
                    </svg>
                  </button>
                );
              })}
              <button
                type="button"
                className="settings-topbar-tab secondary"
                title="Copier le lien"
                aria-label="Copier le lien de la page Nouveautés"
                onClick={async (e) => {
                  try {
                    const url = window.location.href;
                    await navigator.clipboard?.writeText(url);
                    const btn = e.currentTarget;
                    const prev = btn.getAttribute('title') || 'Copier le lien';
                    btn.setAttribute('title', 'Lien copié !');
                    btn.classList.add('active');
                    window.setTimeout(() => {
                      btn.setAttribute('title', prev);
                      btn.classList.remove('active');
                    }, 1500);
                  } catch { /* */ }
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="9" y="9" width="13" height="13" rx="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            </nav>
          )}

          {location.pathname === '/about' && (
            <nav className="settings-topbar-tabs about-topbar-tabs" aria-label="Liens et confidentialité">
              <button
                type="button"
                className="settings-topbar-tab secondary"
                title="Politique de confidentialité"
                aria-label="Politique de confidentialité"
                onClick={() => navigate('/privacy')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </button>
              <button
                type="button"
                className="settings-topbar-tab secondary"
                title="Conditions d'utilisation"
                aria-label="Conditions d'utilisation"
                onClick={() => navigate('/terms')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                </svg>
              </button>
              <button
                type="button"
                className="settings-topbar-tab secondary"
                title="Cookies"
                aria-label="Préférences cookies"
                onClick={() => openConsentSettings()}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="12" cy="12" r="9" />
                  <circle cx="9" cy="10" r="1" fill="currentColor" stroke="none" />
                  <circle cx="14" cy="9" r="1" fill="currentColor" stroke="none" />
                  <circle cx="11" cy="14" r="1" fill="currentColor" stroke="none" />
                  <circle cx="15" cy="14" r="1.2" fill="currentColor" stroke="none" />
                </svg>
              </button>
              <button
                type="button"
                className="settings-topbar-tab secondary"
                title="Nouveautés"
                aria-label="Nouveautés"
                onClick={() => window.location.assign('/whats-new')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 2l2.4 7.2H22l-6 4.8 2.3 7L12 16.8 5.7 21l2.3-7-6-4.8h7.6z" />
                </svg>
              </button>
              <button
                type="button"
                className="settings-topbar-tab secondary"
                title="Revoir le guide"
                aria-label="Revoir le guide d'accueil"
                onClick={() => {
                  resetWelcome();
                  window.location.assign('/welcome');
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                </svg>
              </button>
            </nav>
          )}


          {isSettingsRoute && (
            <div className="settings-topbar-search-wrap">
              <div className="settings-topbar-search-inner">
                <input
                  type="text"
                  className="settings-topbar-search"
                  placeholder="Rechercher : réglage, produit, client, facture…"
                  value=""
                  readOnly
                  autoComplete="off"
                  onFocus={(e) => {
                    // v0.7.7 — tap = panneau latéral (au-dessus de l'Agent si ouvert)
                    e.currentTarget.blur();
                    setSettingsSearchOpen(false);
                    window.dispatchEvent(new Event('atlas-search-open'));
                  }}
                  onChange={(e) => {
                    setSettingsTopSearch(e.target.value);
                    setSettingsSearchOpen(true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setSettingsTopSearch('');
                      setSettingsSearchOpen(false);
                    }
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const hits = searchSettings(settingsTopSearch).hits.length
                        ? searchSettings(settingsTopSearch).hits
                        : searchSettings(settingsTopSearch).suggestions;
                      if (hits[0]) {
                        pushSearchHistory(hits[0].label);
                        setSettingsSearchHistory(loadSearchHistory());
                        setSettingsSearchOpen(false);
                        setSettingsTopSearch('');
                        setPendingAnchor(hits[0].id, hits[0].tab);
                        navigate(`/settings?tab=${encodeURIComponent(hits[0].tab)}`);
                        window.setTimeout(() => {
                          try {
                            window.dispatchEvent(
                              new CustomEvent('atlas-settings-go-anchor', {
                                detail: { id: hits[0].id, tab: hits[0].tab },
                              }),
                            );
                          } catch { /* */ }
                        }, 100);
                      }
                    }
                  }}
                  aria-label="Rechercher dans les paramètres"
                  aria-expanded={settingsSearchOpen}
                />
                {settingsTopSearch ? (
                  <button
                    type="button"
                    className="settings-topbar-search-clear secondary"
                    aria-label="Effacer la recherche"
                    onClick={() => {
                      setSettingsTopSearch('');
                      setSettingsSearchOpen(true);
                    }}
                  >
                    ×
                  </button>
                ) : null}
              </div>
              {settingsSearchOpen && (
                <>
                  <div
                    className="settings-search-dd-backdrop"
                    onClick={() => setSettingsSearchOpen(false)}
                    aria-hidden
                  />
                  <div className="settings-search-dropdown" role="listbox">
                    {(() => {
                      const q = settingsTopSearch.trim();
                      const { hits, suggestions } = searchSettings(q);
                      if (!q) {
                        if (settingsSearchHistory.length === 0) {
                          return (
                            <div className="settings-search-dd-empty muted">
                              Tapez pour chercher un réglage…
                            </div>
                          );
                        }
                        return (
                          <>
                            <div className="settings-search-dd-label settings-search-dd-label-row">
                              <span>Historique</span>
                              <button
                                type="button"
                                className="secondary settings-search-dd-clear-all"
                                title="Effacer tout l'historique"
                                aria-label="Effacer tout l'historique de recherche"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  clearSearchHistory();
                                  setSettingsSearchHistory([]);
                                }}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                  <path d="M3 6h18" />
                                  <path d="M8 6V4h8v2" />
                                  <path d="M19 6l-1 14H6L5 6" />
                                  <path d="M10 11v6M14 11v6" />
                                </svg>
                              </button>
                            </div>
                            {settingsSearchHistory.map((h) => (
                              <div key={h} className="settings-search-dd-row">
                                <button
                                  type="button"
                                  className="secondary settings-search-dd-item"
                                  onClick={() => {
                                    const exact = resolveHitByLabel(h);
                                    if (exact) {
                                      try {
                                        sessionStorage.setItem(
                                          'atlas-settings-pending-anchor',
                                          JSON.stringify({ id: exact.id, tab: exact.tab }),
                                        );
                                      } catch { /* */ }
                                      setSettingsSearchOpen(false);
                                      setSettingsTopSearch('');
                                      navigate(`/settings?tab=${encodeURIComponent(exact.tab)}`);
                                      window.setTimeout(() => {
                                        try {
                                          window.dispatchEvent(
                                            new CustomEvent('atlas-settings-go-anchor', {
                                              detail: { id: exact.id, tab: exact.tab },
                                            }),
                                          );
                                        } catch { /* */ }
                                      }, 280);
                                    } else {
                                      setSettingsTopSearch(h);
                                      setSettingsSearchOpen(true);
                                    }
                                  }}
                                >
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                    <circle cx="12" cy="12" r="10" />
                                    <path d="M12 6v6l4 2" />
                                  </svg>
                                  <span>{h}</span>
                                </button>
                                <button
                                  type="button"
                                  className="secondary settings-search-dd-del"
                                  aria-label={`Supprimer ${h}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeSearchHistoryItem(h);
                                    setSettingsSearchHistory(loadSearchHistory());
                                  }}
                                >
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                    <path d="M3 6h18" />
                                    <path d="M8 6V4h8v2" />
                                    <path d="M19 6l-1 14H6L5 6" />
                                    <path d="M10 11v6M14 11v6" />
                                  </svg>
                                </button>
                              </div>
                            ))}
                          </>
                        );
                      }
                      const renderHit = (hit: SettingsSearchHit) => (
                        <button
                          key={hit.id}
                          type="button"
                          className="secondary settings-search-dd-item"
                          role="option"
                          onClick={() => {
                            pushSearchHistory(hit.label);
                            setSettingsSearchHistory(loadSearchHistory());
                            setSettingsSearchOpen(false);
                            setSettingsTopSearch('');
                            setPendingAnchor(hit.id, hit.tab);
                            navigate(`/settings?tab=${encodeURIComponent(hit.tab)}`);
                            window.setTimeout(() => {
                              try {
                                window.dispatchEvent(
                                  new CustomEvent('atlas-settings-go-anchor', {
                                    detail: { id: hit.id, tab: hit.tab },
                                  }),
                                );
                              } catch { /* */ }
                            }, 100);
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d={SETTINGS_TAB_ICON[hit.tab] || SETTINGS_TAB_ICON.profile} />
                          </svg>
                          <span className="settings-search-dd-item-text">
                            <span>{hit.label}</span>
                            <span className="settings-search-dd-path">{SETTINGS_TAB_LABELS[hit.tab] || hit.tab}</span>
                          </span>
                        </button>
                      );

                      if (hits.length === 0 && suggestions.length === 0) {
                        return (
                          <div className="settings-search-dd-empty">
                            <strong>Aucun élément trouvé</strong>
                            <span className="muted">Essayez TVA, logo, présence… ou Atlas Agent.</span>
                          </div>
                        );
                      }
                      if (hits.length === 0 && suggestions.length > 0) {
                        return (
                          <>
                            <div className="settings-search-dd-label">Vouliez-vous dire</div>
                            {suggestions.map(renderHit)}
                          </>
                        );
                      }
                      return (
                        <>
                          {hits.map(renderHit)}
                          {suggestions.length > 0 && (
                            <>
                              <div className="settings-search-dd-label">Vouliez-vous dire</div>
                              {suggestions.map(renderHit)}
                            </>
                          )}
                        </>
                      );
                      /* legacy map removed */
                      })()}
                  </div>
                </>
              )}
            </div>
          )}
          <div className="settings-topbar-right">
            <div className="settings-topbar-theme" role="group" aria-label="Thème">
              <button type="button" data-theme-toggle className={themeMode === 'system' ? 'active' : undefined} title="Système" aria-label="Système" aria-pressed={themeMode === 'system'} onClick={() => setThemeMode('system')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
              </button>
              <button type="button" data-theme-toggle className={themeMode === 'light' ? 'active' : undefined} title="Clair" aria-label="Clair" aria-pressed={themeMode === 'light'} onClick={() => setThemeMode('light')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
              </button>
              <button type="button" data-theme-toggle className={themeMode === 'dark' ? 'active' : undefined} title="Sombre" aria-label="Sombre" aria-pressed={themeMode === 'dark'} onClick={() => setThemeMode('dark')}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden><path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z"/></svg>
              </button>
            </div>
            <button
              type="button"
              className="settings-topbar-user-btn"
              aria-haspopup="menu"
              aria-expanded={focusUserMenuOpen}
              onClick={() => setFocusUserMenuOpen((v) => !v)}
            >
              {hasAvatarUrl() ? (
                <AvatarImage className="settings-topbar-avatar" fallback={<span className="settings-topbar-avatar ac-topbar-avatar--ini">{typeof getDisplayInitials === 'function' ? getDisplayInitials() : '?'}</span>} />
              ) : (
                <span className="settings-topbar-avatar settings-topbar-avatar--ini">{getDisplayInitials()}</span>
              )}
              <div className="settings-topbar-user-meta">
                <strong>{getDisplayName() || getUsername()}</strong>
                <span>{getRole() || 'utilisateur'}</span>
              </div>
              {focusWhatsNewUnread ? <span className="whats-new-dot" aria-hidden /> : null}
            </button>
            {focusUserMenuOpen && (
              <>
                <button
                  type="button"
                  className="settings-topbar-menu-backdrop"
                  aria-label="Fermer le menu"
                  onClick={() => setFocusUserMenuOpen(false)}
                  style={{ position: 'fixed', inset: 0, border: 0, background: 'transparent', zIndex: 70 }}
                />
                <div className="settings-topbar-menu" role="menu">
                  {location.pathname !== '/settings' && !location.pathname.startsWith('/settings/') && (
                    <button type="button" role="menuitem" className="secondary settings-topbar-menu-item" onClick={() => { setFocusUserMenuOpen(false); window.location.assign('/settings'); }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82V9c.26-.6.98-1.01 1.64-1.01H21a2 2 0 1 0 0-4h-.09a1.65 1.65 0 0 1-1.51-1z" /></svg>
                      Paramètres
                    </button>
                  )}
                  {location.pathname !== '/about' && (
                    <button type="button" role="menuitem" className="secondary settings-topbar-menu-item" onClick={() => { setFocusUserMenuOpen(false); window.location.assign('/about'); }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                      À propos
                    </button>
                  )}
                  {location.pathname !== '/whats-new' && (
                    <button type="button" role="menuitem" className="secondary settings-topbar-menu-item settings-topbar-menu-item--novelties" onClick={() => { setFocusUserMenuOpen(false); window.location.assign('/whats-new'); }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                      <span className="account-menu-item-label">Nouveautés</span>
                      {focusWhatsNewUnread ? <span className="whats-new-badge" aria-label="Nouveautés non lues">1</span> : null}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </header>
      )}

      <main className={`content${isFocusRoute ? ' content-settings-focus' : ''}`}>
        <ErrorBoundary label="desktop">
          <Suspense fallback={<PageFallback />}>
            <PageTransition>
            {location.pathname === '/whats-new' ? (
              // v0.7 — guaranteed changelog on /whats-new: rendered directly,
              // independent of the Routes table below (no wrong-page flash).
              <WhatsNew />
            ) : location.pathname === '/about' ? (
              // v0.7.1 — same guarantee for /about (descendant <Routes> would
              // otherwise fall through to the "/" dashboard route).
              <About />
            ) : (
            <Routes>
              <Route path="/dashboard" element={<Dashboard />} />
              {/* v0.7.5 — parent "/dashboard/*" : le reste "/" EST le dashboard
                  (un Navigate vers /dashboard rebouclait : même URL → re-render
                  infini → « Throttling navigation » + contenu vide). */}
              <Route path="/" element={<Dashboard />} />
              <Route path="/actions" element={<Actions />} />
              <Route path="/products" element={<Products />} />
              <Route path="/scan" element={<RoleGate allow={canManageStock()}><Scan /></RoleGate>} />
              <Route path="/products/:id/historique" element={<ProductHistory />} />
              <Route path="/clients" element={<RoleGate allow={canOfficeWork()}><Clients /></RoleGate>} />
              <Route path="/employees" element={<RoleGate allow={canOfficeWork()}><Employees /></RoleGate>} />
              <Route path="/attendance" element={<RoleGate allow={canOfficeWork()}><Attendance /></RoleGate>} />
              <Route path="/vendors" element={<RoleGate allow={canOfficeWork()}><Vendors /></RoleGate>} />
              <Route path="/quotes" element={<RoleGate allow={canOfficeWork()}><Quotes /></RoleGate>} />
              <Route path="/quick-sale" element={<RoleGate allow={canSell()}><QuickSale /></RoleGate>} />
              <Route path="/quick-sale/:id" element={<RoleGate allow={canSell()}><QuickSaleDetail /></RoleGate>} />
              <Route path="/invoices" element={<RoleGate allow={canOfficeWork()}><Invoices /></RoleGate>} />
              <Route path="/reimbursements" element={<RoleGate allow={canOfficeWork()}><Reimbursements /></RoleGate>} />
              <Route path="/invoices/:id" element={<RoleGate allow={canOfficeWork()}><InvoiceDetail /></RoleGate>} />
              <Route path="/bills" element={<RoleGate allow={canOfficeWork()}><Bills /></RoleGate>} />
              <Route path="/receipts" element={<RoleGate allow={canOfficeWork()}><Receipts /></RoleGate>} />
              <Route path="/balance" element={<RoleGate allow={canOfficeWork()}><Balance /></RoleGate>} />
              <Route path="/reports" element={<RoleGate allow={canOfficeWork()}><Reports /></RoleGate>} />
              <Route path="/inventory-ops" element={<RoleGate allow={canAccessInventoryOps()}><InventoryOps /></RoleGate>} />
              <Route path="/settings" element={<Settings />} />
              {/* v0.7.7 — /about & /whats-new sont STRICTEMENT standalone
                  (PublicNav) : plus de topbar shell ni de bouton retour ici */}
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/m" element={<Navigate to="/dashboard" replace />} />
              <Route path="/m/scan" element={<Navigate to="/scan" replace />} />
              <Route path="/m/products" element={<Navigate to="/products" replace />} />
              <Route path="/m/vente" element={<Navigate to="/quick-sale" replace />} />
              <Route path="/m/bills" element={<Navigate to="/bills" replace />} />
              <Route path="/m/warehouse" element={<Navigate to="/inventory-ops" replace />} />
              <Route path="/m/invoice" element={<Navigate to="/quotes" replace />} />
              <Route path="/m/settings" element={<Navigate to="/settings" replace />} />
              <Route path="/m/agent" element={<Navigate to="/dashboard" replace />} />
              <Route path="/m/more" element={<Navigate to="/settings" replace />} />
              <Route path="/m/*" element={<Navigate to="/dashboard" replace />} />
              <Route path="/m-legacy" element={<Navigate to="/dashboard" replace />} />
              <Route path="*" element={<NotFoundRedirect />} />
            </Routes>
            )}
            </PageTransition>
          </Suspense>
        </ErrorBoundary>
      </main>
      <MobileBottomNav />
      {!isFocusRoute && (
        <Suspense fallback={null}>
          <AtlasAgent />
        </Suspense>
      )}
      {!location.pathname.startsWith('/login') && (
        <Suspense fallback={null}><WhatsNewModal /></Suspense>
      )}
        </div>{/* ac-main-column */}
    </div>
    </>
  );
}

function PhonePcOnlyPage() {
  return (
    <div className="ph-restricted" style={{ margin: '48px auto', maxWidth: 420, padding: '28px 20px', textAlign: 'center' }}>
      <h1 style={{ margin: '0 0 10px', fontSize: '1.25rem' }}>Espace ordinateur uniquement</h1>
      <p style={{ color: '#9aa3b5', margin: '0 0 18px', lineHeight: 1.45 }}>
        Cette page (paramètres complets, solde, rapports, factures, etc.) n&apos;est pas disponible sur le téléphone.
        Utilisez l&apos;espace terrain <strong>/m</strong>, ou ouvrez Atlas Commerce sur un ordinateur.
      </p>
      <a
        href="/m"
        style={{
          display: 'inline-block',
          padding: '12px 18px',
          borderRadius: 12,
          background: '#0a0a0a',
          color: '#fff',
          textDecoration: 'none',
          fontWeight: 600,
        }}
      >
        Aller à l&apos;accueil mobile
      </a>
    </div>
  );
}

function PhoneShell() {
  useEffect(() => startSessionGuard(), []);
  useEffect(() => {
    document.documentElement.classList.add('phone-shell');
    const isPwa =
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches) ||
      !!(window.navigator as any).standalone;
    document.documentElement.classList.toggle('atlas-pwa', !!isPwa);
    document.documentElement.dataset.pwa = isPwa ? '1' : '0';
    return () => {
      document.documentElement.classList.remove('phone-shell');
      document.documentElement.classList.remove('atlas-pwa');
      delete document.documentElement.dataset.pwa;
    };
  }, []);
  // v253 material ripple — adapted from React Bits "Ripple"
  // (github.com/DavidHDev/react-bits, MIT): one delegated pointerdown gives
  // every tappable element of the terrain app native-feeling touch feedback.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const host = (e.target as HTMLElement | null)?.closest?.(
        'button, a.ptab, .ph-chip, .ph-cta, .phone-icon-btn'
      ) as HTMLElement | null;
      if (!host || host.dataset.ripple === 'off') return;
      const rect = host.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const size = Math.max(rect.width, rect.height) * 1.1;
      const span = document.createElement('span');
      span.className = 'ph-ripple';
      span.style.width = `${size}px`;
      span.style.height = `${size}px`;
      span.style.left = `${e.clientX - rect.left - size / 2}px`;
      span.style.top = `${e.clientY - rect.top - size / 2}px`;
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      const prevOverflow = host.style.overflow;
      host.style.overflow = 'hidden';
      host.appendChild(span);
      span.addEventListener('animationend', () => {
        span.remove();
        host.style.overflow = prevOverflow;
      }, { once: true });
    };
    document.addEventListener('pointerdown', onDown, { passive: true });
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);
  return (
    <>
      <AtlasLoadingBar />
      <ErrorBoundary label="phone">
        <Suspense fallback={<PhonePageFallback />}>
          <PageTransition>
          <Routes>
            {/* Legal still readable on phone */}
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            {/* Mobile terrain app */}
            <Route path="/m/*" element={<PhoneApp />} />
            <Route path="/m-legacy" element={<PhoneApp />} />
            {/* Default phone landing */}
            <Route path="/" element={<Navigate to="/m" replace />} />
            <Route path="/dashboard" element={<Navigate to="/m" replace />} />
            {/* Everything else PC-only: /settings, /balance, /dashboard, … */}
            <Route path="/*" element={<PhonePcOnlyPage />} />
          </Routes>
          </PageTransition>
        </Suspense>
      </ErrorBoundary>
      <Suspense fallback={null}><WhatsNewModal /></Suspense>
    </>
  );
}

function Shell() {
  // v253 — phones are optimized again: narrow viewports, the native APK and
  // ?mode=phone get the purpose-built terrain app (/m: scan-first, offline
  // catalog, tab bar — minimized field experience), while PCs keep the full
  // ERP shell. Directive: phones minimize, PC keeps everything.
  const isPhone = useIsPhoneShell();
  return isPhone ? <PhoneShell /> : <DesktopShell />;
}


/** Unknown routes leave the shell (no sidebar / agent) and open standalone 404. */
function NotFoundRedirect() {
  const loc = useLocation();
  return <Navigate to="/404" replace state={{ attempted: loc.pathname + loc.search }} />;
}

/** Keeps <title> in sync with the current route (unique, ≤60 chars).
 * Uses window.location so it never depends on Router context (boot-safe).
 */
function PageTitleSync() {
  useEffect(() => {
    const sync = () => {
      try {
        applyPageTitle(window.location.pathname || '/');
      } catch { /* */ }
    };
    sync();
    window.addEventListener('popstate', sync);
    // React Router navigations don't always fire popstate — poll lightly
    const id = window.setInterval(sync, 800);
    return () => {
      window.removeEventListener('popstate', sync);
      window.clearInterval(id);
    };
  }, []);
  return null;
}

export default function App() {
  // v0.7 — theme (html[data-theme]) must exist on EVERY route, login included:
  // the login brand pair and dark surfaces key off it (before, only the
  // DesktopShell mounted useTheme → login fell back to the black lockup).
  useTheme();
  useEffect(() => {
    //Chunks loaded fine on this boot → arm the one-shot reload again.
    try { sessionStorage.removeItem('atlas-chunk-reload'); } catch { /* */ }
  }, []);
  return (
    <BrowserRouter>
      <AppDialogsProvider>
        <DemoProvider>
          <PageTitleSync />
          <Routes>
            <Route path="/login" element={<LoginGate />} />
            <Route path="/login/qr" element={<Suspense fallback={null}><LoginQr /></Suspense>} />
            <Route path="/verify" element={<Suspense fallback={null}><EmailVerify /></Suspense>} />
            <Route path="/welcome" element={<WelcomeGate />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/403" element={<div className="access-page-standalone"><AccessPage kind="forbidden" /></div>} />
            <Route path="/error/:code" element={<div className="access-page-standalone"><HttpErrorPage /></div>} />
            <Route path="/404" element={<div className="access-page-standalone"><AccessPage kind="not-found" /></div>} />
            <Route path="/whats-new" element={<WhatsNewRoute />} />
            <Route path="/about" element={<AboutRoute />} />
            <Route path="/android" element={<DownloadRoute />} />
            {/* v0.7.7 — l'ancienne page /download déménage sur /android */}
            <Route path="/download" element={<Navigate to="/android" replace />} />
            <Route path="/" element={<HomeRoute />} />
            <Route path="/desktop" element={<DesktopRoute />} />
            <Route path="/dashboard/*" element={<Protected><Shell /></Protected>} />
            <Route path="/*" element={<Protected><Shell /></Protected>} />
          </Routes>
          <CookieConsent />
          <DownloadTeaser />
        </DemoProvider>
      </AppDialogsProvider>
    </BrowserRouter>
  );
}
