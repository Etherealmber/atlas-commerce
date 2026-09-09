import MobileBottomNav from './components/erp/MobileBottomNav';
import { useEffect, useState, useRef, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom';
import Login from './pages/Login';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import AccessPage, { RoleGate } from './pages/AccessPage';
import {
  isLoggedIn,
  getToken,
  clearToken,
  startSessionGuard,
  getUsername,
  getDisplayInitials,
  getDisplayName,
  getAvatarUrl,
  getRole,
  setProfileCache,
  canManageStock,
  canOfficeWork,
  canAccessCompanySettings,
  canAccessInventoryOps,
  isStockRole,
  canSell,
  isOwnerRole,
} from './auth';
import { AppDialogsProvider } from './components/AppDialogs';
const AtlasAgent = lazy(() => import('./components/AtlasAgent'));
import { ErrorBoundary } from './components/ErrorBoundary';
import { isNativeApp } from './config';
import './App.css';
import { applyDensityFromStorage, getDensity, setDensity, getUiScale, setUiScale, isGlassEnabled, setGlassEnabled, isLiquidGlassActive, subscribeUiPrefs, type Density, type UiScale } from './lib/density';
import AtlasLoadingBar from './components/AtlasLoadingBar';
import { isWelcomeCompleted } from './lib/welcome';
import { api } from './api';
import OfflineBanner from './components/OfflineBanner';
import CookieConsent from './components/CookieConsent';
import { isDemoMode, exitDemoMode, enterDemoMode, resetDemoData } from './lib/demoMode';
import { DemoProvider, useDemo } from './context/DemoContext';
const Welcome = lazy(() => import('./pages/Welcome'));

type NavBadges = {
  invoices_unpaid: number;
  bills_unpaid: number;
  bills_receive: number;
  products_low: number;
  actions_pending: number;
  quotes_open: number;
};

const EMPTY_BADGES: NavBadges = {
  invoices_unpaid: 0,
  bills_unpaid: 0,
  bills_receive: 0,
  products_low: 0,
  actions_pending: 0,
  quotes_open: 0,
};


function NavIcon({ d }: { d: string }) {
  return (
    <svg className="nav-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
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

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Products = lazy(() => import('./pages/Products'));
const Invoices = lazy(() => import('./pages/Invoices'));
const InvoiceDetail = lazy(() => import('./pages/InvoiceDetail'));
const Bills = lazy(() => import('./pages/Bills'));
const Receipts = lazy(() => import('./pages/Receipts'));
const QuickSale = lazy(() => import('./pages/QuickSale'));
const QuickSaleDetail = lazy(() => import('./pages/QuickSaleDetail'));
const Balance = lazy(() => import('./pages/Balance'));
const Reports = lazy(() => import('./pages/Reports'));
const InventoryOps = lazy(() => import('./pages/InventoryOps'));
const Settings = lazy(() => import('./pages/Settings'));
const Clients = lazy(() => import('./pages/Clients'));
const Vendors = lazy(() => import('./pages/Vendors'));
const Quotes = lazy(() => import('./pages/Quotes'));
const Reimbursements = lazy(() => import('./pages/Reimbursements'));
const About = lazy(() => import('./pages/About'));
const Actions = lazy(() => import('./pages/Actions'));
const Mailbox = lazy(() => import('./pages/Mailbox'));
const PhoneApp = lazy(() => import('./mobile/PhoneApp'));

const LOADING_QUIPS = [
  'On aligne les carreaux…',
  'Le marbre se polit tout seul…',
  'Comptage des sacs de ciment…',
  'Les factures font la queue…',
  'Un instant, le stock respire…',
  'Préparation du café et des données…',
];

function PageFallback() {
  return (
    <div className="atlas-page atlas-page-loading" style={{ paddingTop: 48, textAlign: 'center' }}>
      <div className="atlas-loading-banner" style={{ display: 'inline-flex', margin: '0 auto' }}>
        <div className="atlas-loading-spinner" aria-hidden />
        <div>
          <strong>Chargement…</strong>
        </div>
      </div>
    </div>
  );
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
  const [d, setD] = useState<Density>(() => getDensity());
  const [scale, setScale] = useState<UiScale>(() => getUiScale());
  const [glass, setGlass] = useState(() => isGlassEnabled());
  const [profileTick, setProfileTick] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
  useEffect(() => { applyDensityFromStorage(); }, []);

  // Live sync density / scale / glass from Settings or other panels
  useEffect(() => {
    return subscribeUiPrefs(() => {
      setD(getDensity());
      setScale(getUiScale());
      setGlass(isGlassEnabled());
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
        background: '#0d2a24',
        backgroundColor: '#0d2a24',
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

              <button type="button" role="menuitem" className="account-menu-item" onClick={() => { setOpen(false); navigate('/settings'); }}>
                <MenuSvg d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.98 1.01 1.64 1.01H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                Paramètres
              </button>
              <button type="button" role="menuitem" className="account-menu-item" onClick={() => { setOpen(false); navigate('/about'); }}>
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
                <button type="button" className={themeMode === 'system' ? 'active' : undefined} title="Système" aria-label="Système" aria-pressed={themeMode === 'system'} onClick={() => setThemeMode('system')}>
                  <MenuSvg d="M2 4h20v12H2zM8 20h8M12 16v4" size={15} />
                </button>
                <button type="button" className={themeMode === 'light' ? 'active' : undefined} title="Clair" aria-label="Clair" aria-pressed={themeMode === 'light'} onClick={() => setThemeMode('light')}>
                  <MenuSvg d="M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4l1.4-1.4M17 7l1.4-1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" size={15} />
                </button>
                <button type="button" className={themeMode === 'dark' ? 'active' : undefined} title="Sombre" aria-label="Sombre" aria-pressed={themeMode === 'dark'} onClick={() => setThemeMode('dark')}>
                  <MenuSvg d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z" size={15} />
                </button>
              </div>

              <div className="account-menu-section-label">Interface</div>
              <div className="account-seg" role="group" aria-label="Densité">
                <button type="button" className={d === 'comfortable' ? 'active' : undefined} onClick={() => { setDensity('comfortable'); setD('comfortable'); }}>Confort</button>
                <button type="button" className={d === 'compact' ? 'active' : undefined} onClick={() => { setDensity('compact'); setD('compact'); }}>Compact</button>
              </div>
              <div className="account-menu-section-label">Taille du texte</div>
              <div className="account-seg" role="group" aria-label="Taille du texte">
                <button type="button" className={scale === 'sm' ? 'active' : undefined} onClick={() => { setUiScale('sm'); setScale('sm'); }}>Petit</button>
                <button type="button" className={scale === 'md' ? 'active' : undefined} onClick={() => { setUiScale('md'); setScale('md'); }}>Moyen</button>
                <button type="button" className={scale === 'lg' ? 'active' : undefined} onClick={() => { setUiScale('lg'); setScale('lg'); }}>Grand</button>
              </div>
              <div className="account-glass-row">
                <span>
                  Liquid glass
                  {d === 'compact' && (
                    <span className="account-glass-hint" title="Désactivé en mode Compact">{' '}(Compact)</span>
                  )}
                </span>
                <button
                  type="button"
                  className={`account-glass-switch${isLiquidGlassActive() && glass ? ' on' : ''}${d === 'compact' ? ' is-locked' : ''}`}
                  role="switch"
                  aria-checked={isLiquidGlassActive()}
                  aria-disabled={d === 'compact'}
                  title={d === 'compact' ? 'Liquid glass est désactivé en mode Compact' : undefined}
                  onClick={() => {
                    if (d === 'compact') return;
                    const next = !glass;
                    setGlassEnabled(next);
                    setGlass(next);
                  }}
                >
                  <span className="account-glass-knob" />
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
        {getAvatarUrl() ? (
          <img key={`av-${profileTick}`} className="sidebar-avatar sidebar-avatar-img" src={getAvatarUrl()!} alt="" width={36} height={36} />
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
    return <Navigate to={isStockRole() ? '/products' : '/'} replace />;
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

function WelcomeGate() {
  const loggedIn = typeof isLoggedIn === 'function' ? isLoggedIn() : !!getToken();
  if (!loggedIn) {
    return <Navigate to="/login" replace />;
  }
  if (isWelcomeCompleted()) {
    return <Navigate to="/" replace />;
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

function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const v = localStorage.getItem('atlas-theme') || 'light';
    return v === 'dark' || v === 'system' ? v : 'light';
  });
  useEffect(() => {
    const apply = () => {
      document.documentElement.setAttribute('data-theme', resolveTheme(mode));
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
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const [badges, setBadges] = useState<NavBadges>(EMPTY_BADGES);
  const [demo, setDemo] = useState(() => isDemoMode());
  useEffect(() => {
    const fn = (e: Event) => {
      const on = (e as CustomEvent).detail?.on;
      setDemo(on === true || (on !== false && isDemoMode()));
    };
    window.addEventListener('atlas-demo-mode', fn as EventListener);
    return () => window.removeEventListener('atlas-demo-mode', fn as EventListener);
  }, []);
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
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(t);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const logout = () => {
    clearToken();
    // Full navigation so protected Shell cannot flash dashboard without session
    window.location.replace('/login');
  };

  return (
    <>
      <AtlasLoadingBar />
      <div className={`layout${sidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <OfflineBanner />
      {demo && (
        <div className="demo-mode-banner" role="status">
          <span className="demo-mode-badge">Mode Démonstration</span>
          <span>Vous explorez Atlas Commerce en mode démo. Aucune donnée réelle n&apos;est affectée.</span>
          <button
            type="button"
            className="demo-mode-reset"
            onClick={() => {
              resetDemoData();
              window.location.reload();
            }}
          >
            Réinitialiser les données
          </button>
          <button
            type="button"
            onClick={() => {
              exitDemoMode();
              setDemo(false);
              window.location.assign('/');
            }}
          >
            Quitter le mode démo
          </button>
        </div>
      )}
      <aside className={`sidebar${sidebarCollapsed ? ' is-collapsed' : ''}`} aria-expanded={!sidebarCollapsed}>
        <div className="logo" title="Double-clic pour réduire / agrandir le menu" onDoubleClick={() => setSidebarCollapsed((v) => !v)} style={{ cursor: 'pointer' }}>
          <img src="/favicon.svg" alt="" className="logo-img" width={36} height={36} onError={(e) => { (e.target as HTMLImageElement).src = '/logo-mark.svg'; }} />
          <div className="logo-text">
            <span className="logo-mark">Atlas Commerce</span>
            <span className="logo-sub">{isStockRole() ? 'Stock · magasinier' : 'Stock & facturation'}</span>
          </div>
        </div>
                <nav>
          <div className="nav-section">Pilot</div>
          {canOfficeWork() && (
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')} data-tooltip="Tableau de bord" title="Tableau de bord">
            <span className="nav-main"><NavIcon d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z" /><span className="nav-label">Tableau de bord</span></span>
          </NavLink>
          )}
          {canManageStock() && (
          <NavLink to="/actions" className={({ isActive }) => (isActive ? 'active' : '')} data-tooltip="Boîte d'actions" title="Boîte d'actions">
            <span className="nav-main"><NavIcon d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" /><span className="nav-label">Boîte d&apos;actions</span></span>
            <NavCount n={badges.actions_pending} tone="warn" />
          </NavLink>
          )}
          {canManageStock() && (
          <NavLink to="/products" className={({ isActive }) => (isActive ? 'active' : '')} data-tooltip="Produits & stock" title="Produits & stock">
            <span className="nav-main"><NavIcon d="M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8" /><span className="nav-label">Produits &amp; stock</span></span>
            <NavCount n={badges.products_low} tone="danger" />
          </NavLink>
          )}
          {canOfficeWork() && (
          <>
          <NavLink to="/clients" className={({ isActive }) => (isActive ? 'active' : '')} data-tooltip="Clients" title="Clients">
            <span className="nav-main"><NavIcon d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /><span className="nav-label">Clients</span></span>
          </NavLink>
          <NavLink to="/quotes" className={({ isActive }) => (isActive ? 'active' : '')} data-tooltip="Devis" title="Devis">
            <span className="nav-main"><NavIcon d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h4" /><span className="nav-label">Devis</span></span>
            <NavCount n={badges.quotes_open} />
          </NavLink>
          <NavLink to="/quick-sale" className={({ isActive }) => (isActive ? 'active' : '')} data-tooltip="Vente rapide" title="Vente rapide">
            <span className="nav-main"><NavIcon d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.6L20 7H7M9 19a1.5 1.5 0 1 0 0.01 0M17 19a1.5 1.5 0 1 0 0.01 0" /><span className="nav-label">Vente rapide</span></span>
          </NavLink>
          <NavLink to="/invoices" className={({ isActive }) => (isActive ? 'active' : '')} data-tooltip="Factures de vente" title="Factures de vente">
            <span className="nav-main"><NavIcon d="M8 2h8a2 2 0 0 1 2 2v16l-3-1.5L12 21l-3-1.5L6 20V4a2 2 0 0 1 2-2zM9 8h6M9 12h6" /><span className="nav-label">Factures de vente</span></span>
            <NavCount n={badges.invoices_unpaid} tone="danger" />
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
          {isOwnerRole() && (
          <NavLink to="/mailbox" className={({ isActive }) => (isActive ? 'active' : '')} data-tooltip="Messagerie" title="Messagerie">
            <span className="nav-main"><NavIcon d="M4 6h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM3.5 7l8.5 6 8.5-6" /><span className="nav-label">Messagerie</span></span>
          </NavLink>
          )}
        </nav>
        <div className="sidebar-footer sidebar-footer-compact">
          <AccountMenu themeMode={themeMode} setThemeMode={setThemeMode} onLogout={logout} sidebarCollapsed={sidebarCollapsed} onToggleSidebar={() => setSidebarCollapsed((v) => !v)} />
        </div>
      </aside>
      
      <main className="content">
        <ErrorBoundary label="desktop">
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/actions" element={<Actions />} />
              <Route path="/products" element={<Products />} />
              <Route path="/clients" element={<RoleGate allow={canOfficeWork()}><Clients /></RoleGate>} />
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
              <Route path="/mailbox" element={<RoleGate allow={isOwnerRole()}><Mailbox /></RoleGate>} />
              <Route path="/mailbox/compose" element={<RoleGate allow={isOwnerRole()}><Mailbox /></RoleGate>} />
              <Route path="/mailbox/m/:id" element={<RoleGate allow={isOwnerRole()}><Mailbox /></RoleGate>} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/about" element={<About />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/m/*" element={<Navigate to={isStockRole() ? '/products' : '/actions'} replace />} />
              <Route path="*" element={<NotFoundRedirect />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
      <MobileBottomNav />
      <Suspense fallback={null}><AtlasAgent /></Suspense>
    </div>
    </>
  );
}

function PhoneShell() {
  useEffect(() => startSessionGuard(), []);
  useEffect(() => {
    document.documentElement.classList.add('phone-shell');
    return () => document.documentElement.classList.remove('phone-shell');
  }, []);
  return (
    <>
      <AtlasLoadingBar />
      <ErrorBoundary label="phone">
        <Suspense fallback={<PageFallback />}>
          <Routes>
            {/* Settings / profile — same RBAC as PC (stock = profile only) */}
            <Route path="/settings" element={<Settings />} />
            <Route path="/about" element={<About />} />
            <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
            <Route path="/m/*" element={<PhoneApp />} />
            <Route path="/*" element={<PhoneApp />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </>
  );
}

function Shell() {
  const phone = useIsPhoneShell();
  if (phone) return <PhoneShell />;
  return <DesktopShell />;
}


/** Unknown routes leave the shell (no sidebar / agent) and open standalone 404. */
function NotFoundRedirect() {
  const loc = useLocation();
  return <Navigate to="/404" replace state={{ attempted: loc.pathname + loc.search }} />;
}

export default function App() {
  return (
    <AppDialogsProvider>
      <DemoProvider>
      <Routes>
        <Route path="/login" element={<LoginGate />} />
        <Route path="/welcome" element={<WelcomeGate />} />
        <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
        <Route path="/403" element={<div className="access-page-standalone"><AccessPage kind="forbidden" /></div>} />
        <Route path="/404" element={<div className="access-page-standalone"><AccessPage kind="not-found" /></div>} />
        <Route path="/*" element={<Protected><Shell /></Protected>} />
      </Routes>
      <CookieConsent />
      </DemoProvider>
    </AppDialogsProvider>
  );
}
