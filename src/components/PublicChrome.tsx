import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getTheme, setTheme as applyTheme, subscribeTheme, type ThemeChoice } from '../theme';
import { isLoggedIn, getDisplayName, getUsername, getRole, getDisplayInitials, hasAvatarUrl } from '../auth';
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
  const c = useChromeColors();
  if (!isLoggedIn()) return null;
  const name = getDisplayName() || getUsername() || 'utilisateur';
  const role = getRole() || 'utilisateur';
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '4px 12px 4px 5px', borderRadius: 999, flex: '0 0 auto',
        background: c.ghostBg, border: `1px solid ${c.ghostBorder}`,
      }}
    >
      {hasAvatarUrl() ? (
        <AvatarImage
          className="pn-chip-avatar"
          width={26}
          height={26}
          fallback={
            <span
              className="pn-chip-ini"
              style={{ background: c.ink, color: c.navBg }}
              aria-hidden="true"
            >
              {getDisplayInitials() || '?'}
            </span>
          }
        />
      ) : (
        <span
          className="pn-chip-ini"
          style={{ background: c.ink, color: c.navBg }}
          aria-hidden="true"
        >
          {getDisplayInitials() || '?'}
        </span>
      )}
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
        <strong style={{ fontSize: 12.5, color: c.ink, fontWeight: 700 }}>{name}</strong>
        <span style={{ fontSize: 10.5, color: c.sub }}>{role}</span>
      </span>
    </span>
  );
}

export type NavLink = { href: string; label: string };

/** Barre de navigation flottante « pill » — une seule image de logo, choisie
 *  par le thème résolu (plus jamais deux logos côte à côte). */
export function PublicNav({ links, cta }: { links: NavLink[]; cta?: ReactNode }) {
  const c = useChromeColors();
  const [menu, setMenu] = useState(false);
  // v0.7.7 — la pilule RÉTRÉCIT quand on descend, reprend sa taille en remontant.
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setCompact((prev) => {
        if (y <= 60) return false;
        if (y > 140 && y > last) return true;
        if (y < last) return false;
        return prev;
      });
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
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
        <div className="pn-links" style={{ display: 'flex', gap: 2, margin: '0 auto', minWidth: 0, overflow: 'hidden' }}>
          {links.map((l) => (
            <a key={l.href} href={l.href} style={linkSt()}>{l.label}</a>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto', flex: '0 0 auto' }}>
          <PublicThemeToggle />
          {isLoggedIn() ? <PublicProfileChip /> : cta}
          <button
            type="button"
            aria-label="Menu"
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
            className="pn-burger-btn"
            style={{
              display: 'none', placeItems: 'center', width: 34, height: 34, padding: 0,
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
    if (p === 'android') return android?.url || '/download';
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
