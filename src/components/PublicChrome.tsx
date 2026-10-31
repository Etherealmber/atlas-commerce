import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { getTheme, setTheme as applyTheme, subscribeTheme, type ThemeChoice } from '../theme';
import { isLoggedIn, getDisplayName, getUsername, getRole, getDisplayInitials, hasAvatarUrl, clearToken } from '../auth';
import { invalidateAvatarCache } from '../lib/avatarCache';
import { resetWelcome } from '../lib/welcome';
import { useProfileWarm, useProfileTick } from '../lib/useProfileWarm';
import { AvatarImage } from './ui/AvatarImage';

const LOGO_DARK = '/atlas-logo-dark.png';
const LOGO_LIGHT = '/atlas-logo-light.png';

/* ------------------------------------------------------------------ */
/* v0.7.6 — chrome partagé des pages publiques (/, /desktop, /download,
   /about, /whats-new). Tout le rendu critique (formes, couleurs, icônes)
   passe en styles INLINE : aucune feuille de style globale (ancien thème,
   overrides, extensions) ne peut plus transformer les boutons en pastilles
   noires, souligner les pills ni dédoubler le logo. */
/* ------------------------------------------------------------------ */

export type Platform = 'android' | 'windows' | 'macos' | 'linux';

export const PLATFORM_LABEL: Record<Platform, string> = {
  android: 'Android',
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
};

/** Détection simple de la plateforme de l'appareil qui visite la page. */
export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'windows';
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'android';
  if (/mac os x|macintosh/i.test(ua)) return 'macos';
  if (/linux|x11/i.test(ua)) return 'linux';
  return 'windows';
}

export function useResolvedTheme(): ThemeChoice {
  const [theme, setT] = useState<ThemeChoice>(() => getTheme());
  useEffect(() => subscribeTheme(setT), []);
  return theme;
}

function resolvedNow(): 'light' | 'dark' {
  const t = getTheme();
  if (t !== 'system') return t;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'dark';
  }
}

/** Thème réellement affiché ('light' | 'dark'), le mode système suivant l'OS. */
export function useThemeValue(): 'light' | 'dark' {
  const [v, setV] = useState<'light' | 'dark'>(() => resolvedNow());
  useEffect(() => {
    const fn = () => setV(resolvedNow());
    window.addEventListener('atlas-theme-change', fn);
    window.addEventListener('storage', fn);
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', fn);
    } catch { /* anciens navigateurs */ }
    return () => {
      window.removeEventListener('atlas-theme-change', fn);
      window.removeEventListener('storage', fn);
      try { mq?.removeEventListener('change', fn); } catch { /* */ }
    };
  }, []);
  return v;
}

/** Palette du chrome public, selon le thème résolu. */
function useChromeColors() {
  const dark = useThemeValue() === 'dark';
  return dark
    ? {
        dark: true,
        navBg: 'rgba(24,24,27,.78)', navBorder: 'rgba(63,63,70,.75)', navShadow: '0 10px 34px rgba(0,0,0,.38)',
        ink: '#fafafa', sub: '#a1a1aa', faint: '#71717a',
        pillBg: 'rgba(255,255,255,.05)', pillBorder: 'rgba(63,63,70,.8)',
        ghostBg: 'rgba(255,255,255,.03)', ghostBorder: 'rgba(63,63,70,.95)', ghostInk: '#e4e4e7',
        hover: 'rgba(255,255,255,.08)',
        menuBg: '#18181b', menuBorder: '#27272a', menuShadow: '0 20px 48px rgba(0,0,0,.55)',
        cta: '#c45c26',
      }
    : {
        dark: false,
        navBg: 'rgba(255,255,255,.85)', navBorder: '#e4e4e7', navShadow: '0 10px 30px rgba(0,0,0,.08)',
        ink: '#18181b', sub: '#52525b', faint: '#71717a',
        pillBg: '#f4f4f5', pillBorder: '#e4e4e7',
        ghostBg: '#ffffff', ghostBorder: '#e4e4e7', ghostInk: '#27272a',
        hover: '#f4f4f5',
        menuBg: '#ffffff', menuBorder: '#e4e4e7', menuShadow: '0 20px 48px rgba(0,0,0,.14)',
        cta: '#b4531f',
      };
}

const ICONS: Record<ThemeChoice, ReactNode> = {
  system: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block' }}>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  ),
  light: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block' }}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  ),
  dark: (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block' }}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  ),
};

/** Toggle système/clair/sombre — v0.7.7 : STRICTEMENT le même trio que le
 *  dashboard (`.settings-topbar-theme`), actif terracotta via CSS. */
export function PublicThemeToggle() {
  const theme = useResolvedTheme();
  const btn = (v: ThemeChoice, label: string): ReactNode => {
    const active = theme === v;
    return (
      <button
        key={v}
        type="button"
        data-theme-toggle
        className={active ? 'active' : undefined}
        onClick={() => applyTheme(v)}
        title={`Thème ${label}`}
        aria-label={`Thème ${label}`}
        aria-pressed={active}
      >
        {ICONS[v]}
      </button>
    );
  };
  return (
    <div className="settings-topbar-theme public-theme-trio" role="group" aria-label="Thème">
      {btn('system', 'système')}
      {btn('light', 'clair')}
      {btn('dark', 'sombre')}
    </div>
  );
}

/** v0.7.7 — chip profil (comme celle des Paramètres) pour les pages publiques
 *  quand un appareil est connecté ; remplace le CTA « Ouvrir l'app ». */
export function PublicProfileChip() {
  useProfileWarm();
  useProfileTick();
  const c = useChromeColors();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      if (box.current && !box.current.contains(ev.target as Node)) setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  if (!isLoggedIn()) return null;
  const name = getDisplayName() || getUsername() || 'utilisateur';
  const role = getRole() || 'utilisateur';
  const mi = (href: string, label: string): ReactNode => (
    <Link
      key={href}
      to={href}
      role="menuitem"
      style={{
        display: 'block', padding: '10px 14px', borderRadius: 10, color: c.ink,
        textDecoration: 'none', fontSize: 13.5, fontWeight: 600,
      }}
    >
      {label}
    </Link>
  );
  return (
    <span ref={box} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className="pn-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ background: c.ghostBg, border: `1px solid ${c.ghostBorder}`, cursor: 'pointer', font: 'inherit' }}
      >
        <span className="pn-chip-avatar-slot" style={{ color: c.navBg }}>
          <span className="pn-chip-ini pn-chip-ini--base" style={{ background: c.ink }} aria-hidden="true">
            {getDisplayInitials() || '?'}
          </span>
          {hasAvatarUrl() ? <AvatarImage className="pn-chip-avatar" width={26} height={26} fallback={null} /> : null}
        </span>
        <span className="pn-chip-meta">
          <strong style={{ color: c.ink }}>{name}</strong>
          <span style={{ color: c.sub }}>{role}</span>
        </span>
      </button>
      {open && (
        <>
          <button
            type="button"
            className="settings-topbar-menu-backdrop"
            aria-label="Fermer le menu"
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, border: 0, background: 'transparent', zIndex: 70 }}
          />
          <div className="settings-topbar-menu" role="menu">
            <button type="button" role="menuitem" className="secondary settings-topbar-menu-item" onClick={() => { setOpen(false); window.location.assign('/settings'); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82V9c.26-.6.98-1.01 1.64-1.01H21a2 2 0 1 0 0-4h-.09a1.65 1.65 0 0 1-1.51-1z" /></svg>
              Paramètres
            </button>
            {window.location.pathname !== '/about' && (
            <button type="button" role="menuitem" className="secondary settings-topbar-menu-item" onClick={() => { setOpen(false); window.location.assign('/about'); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
              À propos
            </button>
            )}
            {window.location.pathname !== '/whats-new' && (
            <button type="button" role="menuitem" className="secondary settings-topbar-menu-item settings-topbar-menu-item--novelties" onClick={() => { setOpen(false); window.location.assign('/whats-new'); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
              <span className="account-menu-item-label">Nouveautés</span>
            </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="secondary settings-topbar-menu-item"
              style={{ color: '#c45c26' }}
              onClick={() => { setOpen(false); clearToken(); invalidateAvatarCache(); window.location.replace('/login'); }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" aria-hidden><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
              Déconnexion
            </button>
          </div>
        </>
      )}
    </span>
  );
}

/** v0.7.7 — carte flottante SÉPARÉE (à côté de la pilule, jamais dedans) :
 *  raccourcis connectés « Tableau de bord » + « Paramètres ». */
export function PublicQuickBar() {
  const c = useChromeColors();
  if (!isLoggedIn()) return null;
  const items: { href: string; label: string; d: string }[] = [
    { href: '/dashboard', label: 'Tableau de bord', d: 'M3 3h8v8H3zM13 3h8v5h-8zM13 12h8v9h-8zM3 15h8v6H3z' },
    { href: '/quick-sale', label: 'Vente rapide', d: 'M6 6h15l-1.5 8h-12zM6 6L5 3H2M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z' },
    { href: '/products', label: 'Produits & stock', d: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8' },
    { href: '/invoices', label: 'Factures', d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h4' },
    { href: '/clients', label: 'Clients', d: 'M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75' },
    { href: '/reports', label: 'Rapports', d: 'M4 20V10M10 20V4M16 20v-7M21 20H3' },
  ];
  return (
    <div
      className="pn-quick"
      role="navigation"
      aria-label="Raccourcis espace de travail"
      style={{ background: c.navBg, border: `1px solid ${c.navBorder}`, boxShadow: c.navShadow }}
    >
      {items.map((it) => (
        <Link
          key={it.href}
          to={it.href}
          title={it.label}
          aria-label={it.label}
          style={{
            display: 'grid', placeItems: 'center', width: 32, height: 32,
            borderRadius: 10, color: c.sub, textDecoration: 'none', background: 'transparent',
          }}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block' }}>
            <path d={it.d} />
          </svg>
        </Link>
      ))}
    </div>
  );
}

export type NavLink = { href: string; label: string };

/** v0.7.7 — onglets icônes des connectés : LÉGACY de l'ancienne topbar
 *  (conditions, confidentialité, GitHub, guide, cookies) — rien qui duplique
 *  la sidebar ; rendu avec les MÊMES classes que la topbar Paramètres. */
const PN_TABS: { id: string; label: string; d: string }[] = [
  { id: 'terms', label: "Conditions d'utilisation", d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 15l2 2 4-4' },
  { id: 'privacy', label: 'Confidentialité', d: 'M12 22s8-3.5 8-10V5l-8-3-8 3v7c0 6.5 8 10 8 10z' },
  { id: 'github', label: 'GitHub', d: 'M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22' },
  { id: 'welcome', label: "Guide d'accueil", d: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z' },
  { id: 'cookies', label: 'Préférences cookies', d: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M9 10h.01M14 9h.01M10 14h.01' },
];

/** v0.7.7 — onglets legacy (Conditions, Confidentialité, GitHub, Guide,
 *  Cookies) rendus avec les classes littérales de la topbar Paramètres.
 *  La page en cours n'est JAMAIS affichée ; rien ne duplique la sidebar. */
export function PnLegacyTabs() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div className="settings-topbar-tabs pn-tabs" role="navigation" aria-label="Liens utiles">
        {PN_TABS.filter((t) => {
          if (t.id === 'terms') return location.pathname !== '/terms';
          if (t.id === 'privacy') return location.pathname !== '/privacy';
          return true;
        }).map((t) => {
          const svg = (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: 'block' }}>
              <path d={t.d} />
            </svg>
          );
          if (t.id === 'github') {
            return (
              <button key={t.id} type="button" className="settings-topbar-tab secondary" title={t.label} aria-label={t.label} onClick={() => window.open('https://github.com/Etherealmber', '_blank', 'noopener,noreferrer')}>
                {svg}
                  </button>
            );
              }
          if (t.id === 'cookies') {
            return (
              <button key={t.id} type="button" className="settings-topbar-tab secondary" title={t.label} aria-label={t.label} onClick={() => window.dispatchEvent(new Event('atlas-consent-open'))}>
                {svg}
                  </button>
            );
              }
          if (t.id === 'welcome') {
            return (
              <button key={t.id} type="button" className="settings-topbar-tab secondary" title={t.label} aria-label={t.label} onClick={() => { resetWelcome(); navigate('/welcome'); }}>
                {svg}
                  </button>
            );
              }
          return (
            <Link key={t.id} className="settings-topbar-tab secondary" to={`/${t.id}`} title={t.label} aria-label={t.label}>
                  {svg}
                </Link>
          );
            })}
          </div>
  );
}

export function PublicNav({ links, cta, classic = false }: { links: NavLink[]; cta?: ReactNode; classic?: boolean }) {
  const c = useChromeColors();
  const [menu, setMenu] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const loggedIn = isLoggedIn();
  // v0.7.7 — la pilule RÉTRÉCIT quand on descend, reprend sa taille en remontant.
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    // v0.7.7 — hystérésis : il faut un cumul de 48 px dans une direction pour
    // changer d'état → plus de scintillement au moindre pixel de scroll.
    let last = window.scrollY;
    let acc = 0;
    let compactNow = false;
    const onScroll = () => {
      const y = window.scrollY;
      const d = y - last;
      last = y;
      if (y <= 60) {
        acc = 0;
        if (compactNow) { compactNow = false; setCompact(false); }
        return;
      }
      if (d > 0) {
        acc = acc > 0 ? acc + d : d;
        if (!compactNow && y > 140 && acc > 48) { compactNow = true; setCompact(true); }
      } else if (d < 0) {
        acc = acc < 0 ? acc + d : d;
        if (compactNow && acc < -48) { compactNow = false; setCompact(false); }
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const tabSt = (extra?: CSSProperties): CSSProperties => ({
    display: 'grid', placeItems: 'center', width: compact ? 28 : 32, height: compact ? 28 : 32,
    borderRadius: 10, color: c.sub, textDecoration: 'none', background: 'transparent',
    transition: 'width .18s ease, height .18s ease', ...extra,
  });
  const linkSt = (extra?: CSSProperties): CSSProperties => ({
    padding: compact ? '5px 9px' : '7px 12px', borderRadius: 999, color: c.sub,
    fontSize: compact ? 12.5 : 13.5,
    textDecoration: 'none', whiteSpace: 'nowrap', background: 'transparent',
    border: 0, cursor: 'pointer', fontWeight: 600,
    transition: 'padding .18s ease, font-size .18s ease', ...extra,
  });
  return (
    <header
      style={{
        position: 'sticky', top: compact ? 8 : 14, zIndex: 60,
        padding: compact ? '6px 10px 0' : '14px 16px 0',
        transition: 'padding .18s ease, top .18s ease',
      }}
    >
      <nav
        aria-label="Navigation publique"
        style={{
          maxWidth: 1080, margin: '0 auto', display: 'flex', alignItems: 'center', gap: compact ? 10 : 14,
          padding: compact ? '5px 8px 5px 12px' : '8px 10px 8px 18px', borderRadius: 999,
          background: c.navBg, border: `1px solid ${c.navBorder}`,
          backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
          boxShadow: c.navShadow,
          transition: 'padding .18s ease, gap .18s ease',
        }}
      >
        <Link to="/" style={{ display: 'flex', alignItems: 'center', textDecoration: 'none', flex: '0 0 auto' }} aria-label="Atlas — accueil">
          <img src={c.dark ? LOGO_DARK : LOGO_LIGHT} alt="Atlas" style={{ height: compact ? 19 : 24, width: 'auto', display: 'block', transition: 'height .18s ease' }} />
        </Link>
        {loggedIn && !classic ? (
          <PnLegacyTabs />
        ) : (
          <div className="pn-links" style={{ gap: 2, margin: '0 auto', minWidth: 0, overflow: 'hidden' }}>
            {links.map((l) => (
              <a key={l.href} href={l.href} style={linkSt()}>{l.label}</a>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flex: '0 0 auto' }}>
          {!classic && (
            <button
              type="button"
              aria-label="Recherche globale"
              title="Recherche globale"
              onClick={() => window.dispatchEvent(new Event('atlas-search-open'))}
              style={{
                display: 'grid', placeItems: 'center', width: 32, height: 32, borderRadius: 999,
                border: 0, background: 'transparent', color: c.sub, cursor: 'pointer', padding: 0,
              }}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ display: 'block' }}>
                <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" />
              </svg>
            </button>
          )}
          <PublicThemeToggle />
          {isLoggedIn() ? <PublicProfileChip /> : cta}
          <button
            type="button"
            aria-label="Menu"
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
            className="pn-burger-btn pn-burger"
            style={{
              placeItems: 'center', width: 34, height: 34, padding: 0,
              border: `1px solid ${c.ghostBorder}`, borderRadius: 999,
              background: c.ghostBg, color: c.ghostInk, cursor: 'pointer',
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ display: 'block' }}>
              {menu ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </nav>
      {menu && (
        <div
          style={{
            maxWidth: 1080, margin: '8px auto 0', padding: 8, borderRadius: 18,
            background: c.menuBg, border: `1px solid ${c.menuBorder}`, boxShadow: c.menuShadow,
          }}
        >
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setMenu(false)}
              style={{ display: 'block', padding: '11px 14px', borderRadius: 12, color: c.ghostInk, textDecoration: 'none', fontSize: 14, fontWeight: 600 }}
            >
              {l.label}
            </a>
          ))}
        </div>
      )}
    </header>
  );
}

type ReleaseAssets = Record<string, string>;

/** Récupère les dernières versions (bureau via GitHub, Android via manifest.json public). */
/** v0.7.7 — /about et /whats-new : la pill publique est SUPPRIMÉE au profit de
 *  la topbar Paramètres LITTÉRALE (mêmes classes) : sticky, visible au scroll,
 *  compacte (hystérésis 48 px, aucun scintillement). Un SEUL bouton recherche. */
export function PublicSettingsTopbar() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    let acc = 0;
    let compactNow = false;
    const onScroll = () => {
      const y = window.scrollY;
      const d = y - last;
      last = y;
      if (y <= 60) {
        acc = 0;
        if (compactNow) { compactNow = false; setCompact(false); }
        return;
      }
      if (d > 0) {
        acc = acc > 0 ? acc + d : d;
        if (!compactNow && y > 140 && acc > 48) { compactNow = true; setCompact(true); }
      } else if (d < 0) {
        acc = acc < 0 ? acc + d : d;
        if (compactNow && acc < -48) { compactNow = false; setCompact(false); }
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const loggedIn = isLoggedIn();
  const title = location.pathname === '/whats-new' ? 'Nouveautés' : 'À propos';
  return (
    <header className={`settings-topbar public-settings-topbar${compact ? ' settings-topbar--compact' : ''}`} role="banner">
      <div className="settings-topbar-left">
        {loggedIn && (
          <>
            <button type="button" className="settings-topbar-back" onClick={() => window.location.assign('/dashboard')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Tableau de bord
            </button>
            <span className="settings-topbar-sep" aria-hidden />
          </>
        )}
        <div className="settings-topbar-brand">
          <img src="/atlas-icon-light.png" alt="" className="brand-img brand-img--light" width={28} height={28} />
          <img src="/atlas-icon-dark.png" alt="" className="brand-img brand-img--dark" width={28} height={28} />
          <div>
            <strong>{title}</strong>
            <span>Atlas Commerce · beta</span>
          </div>
        </div>
      </div>
      {location.pathname === '/whats-new' ? (
        <div className="settings-topbar-tabs pst-filters" role="group" aria-label="Filtrer le journal">
          {[
            { id: 'all', label: 'Tout' },
            { id: 'added', label: 'Nouveautés' },
            { id: 'improved', label: 'Améliorations' },
            { id: 'fixed', label: 'Corrections' },
          ].map((f) => (
            <button
              key={f.id}
              type="button"
              className={`wn-filter${(params.get('f') || 'all') === f.id ? ' active' : ''}`}
              aria-pressed={(params.get('f') || 'all') === f.id}
              onClick={() => setParams(f.id === 'all' ? {} : { f: f.id })}
            >
              {f.label}
            </button>
          ))}
        </div>
      ) : null}
      {loggedIn && <PnLegacyTabs />}
      <div className="settings-topbar-right">
        {/* v0.7.7 — même gabarit d'icône que la topbar Paramètres, collé au sélecteur
            de thème, jamais masqué (ni en compact, ni en scroll) */}
        <button
          type="button"
          className="settings-topbar-tab secondary settings-topbar-searchtab"
          aria-label="Recherche globale"
          title="Recherche globale"
          onClick={() => window.dispatchEvent(new Event('atlas-search-open'))}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        </button>
        <PublicThemeToggle />
        {loggedIn ? <PublicProfileChip /> : <PublicSessionCta />}
      </div>
    </header>
  );
}

export function usePublicReleases(): { desktop: ReleaseAssets; android: { url: string; label: string } | null; loaded: boolean } {
  const [desktop, setDesktop] = useState<ReleaseAssets>({});
  const [android, setAndroid] = useState<{ url: string; label: string } | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let dead = false;
    const done = () => { if (!dead) setLoaded(true); };
    void (async () => {
      try {
        const r = await fetch('https://api.github.com/repos/Etherealmber/atlas-commerce-desktop/releases/latest', { headers: { Accept: 'application/vnd.github+json' } });
        if (r.ok) {
          const j: any = await r.json();
          const assets: { name?: string; browser_download_url?: string }[] = Array.isArray(j?.assets) ? j.assets : [];
          const pick = (re: RegExp) => {
            const f = assets.find((a) => typeof a.name === 'string' && re.test(a.name));
            return f?.browser_download_url || '';
          };
          if (!dead) {
            setDesktop({
              windows: pick(/setup\.exe$/i) || pick(/\.msi$/i),
              macos: pick(/\.dmg$/i),
              linux: pick(/\.AppImage$/i),
            });
          }
        }
      } catch { /* hors-ligne : repli vers /desktop */ }
      // v0.7.7 — source de vérité APK : le manifeste R2 `latest.json`
      // (celui que l'appli Android consulte pour se mettre à jour).
      let apkSet = false;
      try {
        const res = await fetch('https://cdn1.afmarbre.com/app-updates/android/latest.json', { cache: 'no-store' });
        if (res.ok) {
          const m: any = await res.json();
          if (m?.apkUrl && !dead) {
            setAndroid({ url: String(m.apkUrl), label: String(m.versionName || m.version || '') });
            apkSet = true;
          }
        }
      } catch { /* repli ci-dessous */ }
      if (!apkSet) {
        try {
          const res = await fetch('/public/android/manifest.json');
          if (res.ok) {
            const m: any = await res.json();
            const apk = Array.isArray(m?.artifacts) ? m.artifacts.find((a: any) => (a.url || '').endsWith('.apk')) : null;
            if (apk?.url && !dead) setAndroid({ url: String(apk.url), label: String(m?.version || '') });
          }
        } catch { /* /download reste la valeur de repli */ }
      }
      done();
    })();
    return () => { dead = true; };
  }, []);
  return { desktop, android, loaded };
}

/** Démarre un téléchargement : vrai BOUTON (pas un lien) qui ouvre l'asset. */
function startDownload(url: string) {
  if (url.startsWith('/')) {
    window.location.assign(url);
    return;
  }
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Bouton de téléchargement scindé : action principale + menu des autres
 *  plateformes. Forme et couleurs 100 % inline (conteneur = pill orange). */
export function PublicDownloadCta({ prefer, full = true }: { prefer?: Platform; full?: boolean }) {
  const { desktop, android } = usePublicReleases();
  const main: Platform = prefer || detectPlatform();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const navigate = useNavigate();
  const c = useChromeColors();

  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      if (box.current && !box.current.contains(ev.target as Node)) setOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const urlFor = (p: Platform): string => {
    if (p === 'android') return android?.url || '/android';
    return desktop[p] || `/desktop#${p}`;
  };
  const extFor = (p: Platform): string =>
    p === 'android' ? 'APK' : p === 'windows' ? 'MSI / EXE' : p === 'macos' ? 'DMG' : 'AppImage';

  const order: Platform[] = ['android', 'windows', 'macos', 'linux'];
  const others = order.filter((p) => p !== main);

  return (
    <div
      ref={box}
      style={{
        position: 'relative', display: 'inline-flex', alignItems: 'stretch',
        background: c.cta, borderRadius: 999, overflow: 'visible',
        boxShadow: '0 14px 34px rgba(196,92,38,.35)',
      }}
    >
      <button
        type="button"
        onClick={() => startDownload(urlFor(main))}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 9,
          padding: '13px 20px', border: 0, borderRadius: full ? '999px 0 0 999px' : 999,
          background: 'transparent', color: '#fff', fontWeight: 700, fontSize: 14,
          textDecoration: 'none', whiteSpace: 'nowrap', cursor: 'pointer',
        }}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block' }}>
          <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
        </svg>
        Télécharger pour {PLATFORM_LABEL[main]}
      </button>
      <button
        type="button"
        aria-label="Autres plateformes"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: 40, border: 0, borderLeft: '1px solid rgba(255,255,255,.28)',
          borderRadius: '0 999px 999px 0', background: 'transparent', color: '#fff',
          cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 0,
        }}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block' }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: 'calc(100% + 10px)', left: 0, minWidth: 272,
            display: 'flex', flexDirection: 'column', padding: 6, zIndex: 40,
            background: c.menuBg, border: `1px solid ${c.menuBorder}`, borderRadius: 16,
            boxShadow: c.menuShadow,
          }}
        >
          {others.map((p) => (
            <button
              key={p}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); startDownload(urlFor(p)); }}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                padding: '10px 12px', borderRadius: 10, border: 0, textAlign: 'left',
                background: 'transparent', color: c.ghostInk, fontSize: 13.5, fontWeight: 600,
                cursor: 'pointer', textDecoration: 'none',
              }}
            >
              <span>Télécharger pour {PLATFORM_LABEL[p]}</span>
              <span style={{ color: c.faint, fontSize: 12, fontWeight: 700 }}>{extFor(p)}</span>
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => { setOpen(false); navigate('/desktop'); }}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
              padding: '10px 12px', borderRadius: 10, border: 0, textAlign: 'left',
              background: 'transparent', color: c.ghostInk, fontSize: 13.5, fontWeight: 600,
              cursor: 'pointer', textDecoration: 'none',
            }}
          >
            <span>Toutes les versions bureau</span>
            <span style={{ color: c.faint, fontSize: 12, fontWeight: 700 }}>→</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** Bouton « Star » GitHub avec compteur live. */
export function GitHubStarButton({ repo = 'Etherealmber/atlas-commerce' }: { repo?: string }) {
  const [stars, setStars] = useState<number | null>(null);
  const c = useChromeColors();
  useEffect(() => {
    let dead = false;
    void (async () => {
      try {
        const r = await fetch(`https://api.github.com/repos/${repo}`);
        if (r.ok) {
          const j: any = await r.json();
          if (!dead && typeof j?.stargazers_count === 'number') setStars(j.stargazers_count);
        }
      } catch { /* simple bouton */ }
    })();
    return () => { dead = true; };
  }, [repo]);
  return (
    <a
      href={`https://github.com/${repo}`}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={`Dépôt GitHub ${repo}${stars != null ? ` — ${stars} étoiles` : ''}`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 16px',
        borderRadius: 999, border: `1px solid ${c.ghostBorder}`, color: c.ghostInk,
        textDecoration: 'none', whiteSpace: 'nowrap', background: c.ghostBg,
        fontSize: 14, fontWeight: 600,
      }}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true" style={{ display: 'block' }}>
        <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.1 4.7 18.1 5 18.1 5c.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5z" />
      </svg>
      <span>GitHub</span>
      {stars != null && <span style={{ color: c.dark ? '#d4a017' : '#a16207', fontSize: 12.5, fontWeight: 700 }}>★ {stars.toLocaleString('fr-FR')}</span>}
    </a>
  );
}

/** CTA de connexion / tableau de bord selon la session. */
export function PublicSessionCta({ solid = true }: { solid?: boolean }) {
  const c = useChromeColors();
  const st: CSSProperties = {
    padding: '8px 16px', borderRadius: 999, fontSize: 13.5, fontWeight: 700,
    textDecoration: 'none', whiteSpace: 'nowrap',
    color: solid ? '#fff' : c.ink,
    border: `1px solid ${solid ? c.cta : c.ghostBorder}`,
    background: solid ? c.cta : c.ghostBg,
  };
  return isLoggedIn() ? (
    <Link to="/dashboard" style={st}>Ouvrir l’app</Link>
  ) : (
    <Link to="/login" style={st}>Se connecter</Link>
  );
}
