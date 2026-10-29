import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { getTheme, setTheme as applyTheme, subscribeTheme, type ThemeChoice } from '../theme';
import { isLoggedIn } from '../auth';

const LOGO_DARK = '/atlas-logo-dark.png';
const LOGO_LIGHT = '/atlas-logo-light.png';

/* ------------------------------------------------------------------ */
/* v0.7.4 — chrome partagé des pages publiques (/, /desktop, /download) */
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
  if (/iphone|ipad|ipod/i.test(ua)) return 'android'; // iOS : pas de build natif → renvoie vers l'app Android/web
  if (/mac os x|macintosh/i.test(ua)) return 'macos';
  if (/linux|x11/i.test(ua)) return 'linux';
  return 'windows';
}

export function useResolvedTheme(): ThemeChoice {
  const [theme, setT] = useState<ThemeChoice>(() => getTheme());
  useEffect(() => subscribeTheme(setT), []);
  return theme;
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

function resolvedNow(): 'light' | 'dark' {
  const t = getTheme();
  if (t !== 'system') return t;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'dark';
  }
}

/** Boutons de thème en icônes SVG (système · clair · sombre) — fini les emojis. */
export function PublicThemeToggle() {
  const theme = useResolvedTheme();
  const btn = (v: ThemeChoice, label: string, icon: ReactNode) => (
    <button
      key={v}
      type="button"
      className="pn-tgl-btn"
      data-theme-toggle
      data-active={theme === v}
      onClick={() => applyTheme(v)}
      title={`Thème ${label}`}
      aria-label={`Thème ${label}`}
      aria-pressed={theme === v}
    >
      {icon}
    </button>
  );
  return (
    <div className="pn-tgl" role="group" aria-label="Thème">
      {btn('system', 'système', (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="4" width="20" height="13" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      ))}
      {btn('light', 'clair', (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ))}
      {btn('dark', 'sombre', (
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      ))}
    </div>
  );
}

export type NavLink = { href: string; label: string };

/** Barre de navigation flottante « pill », inspirée du site Liner. */
export function PublicNav({ links, cta }: { links: NavLink[]; cta?: ReactNode }) {
  const [menu, setMenu] = useState(false);
  return (
    <header className="pn-wrap">
      <nav className="pn-nav" aria-label="Navigation publique">
        <Link to="/" className="pn-logo" onClick={() => setMenu(false)}>
          <img className="pn-logo-img theme-logo-dark" src={LOGO_DARK} alt="Atlas" />
          <img className="pn-logo-img theme-logo-light" src={LOGO_LIGHT} alt="Atlas" />
        </Link>
        <div className="pn-links">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="pn-link">{l.label}</a>
          ))}
        </div>
        <div className="pn-right">
          <PublicThemeToggle />
          {cta}
          <button
            type="button"
            className="pn-burger"
            aria-label="Menu"
            aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              {menu ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </nav>
      {menu && (
        <div className="pn-menu">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="pn-menu-link" onClick={() => setMenu(false)}>{l.label}</a>
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
      } catch { /* hors-ligne : les liens retombent sur /desktop */ }
      try {
        const res = await fetch('/public/android/manifest.json');
        if (res.ok) {
          const m: any = await res.json();
          const apk = Array.isArray(m?.artifacts) ? m.artifacts.find((a: any) => (a.url || '').endsWith('.apk')) : null;
          if (apk?.url && !dead) setAndroid({ url: String(apk.url), label: String(m?.version || '') });
        }
      } catch { /* /download reste la valeur de repli */ }
      done();
    })();
    return () => { dead = true; };
  }, []);
  return { desktop, android, loaded };
}

/** Bouton de téléchargement scindé : action principale + menu déroulant des autres plateformes. */
export function PublicDownloadCta({ prefer, full = true }: { prefer?: Platform; full?: boolean }) {
  const { desktop, android } = usePublicReleases();
  const main: Platform = prefer || detectPlatform();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);

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
    <div className="pn-split" ref={box}>
      <a className="pn-split-main" href={urlFor(main)} data-full={full}>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
        </svg>
        Télécharger pour {PLATFORM_LABEL[main]}
      </a>
      <button
        type="button"
        className="pn-split-caret"
        aria-label="Autres plateformes"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="pn-split-menu" role="menu">
          {others.map((p) => (
            <a key={p} className="pn-split-item" role="menuitem" href={urlFor(p)}>
              <span className="pn-split-os">Télécharger pour {PLATFORM_LABEL[p]}</span>
              <span className="pn-split-ext">{extFor(p)}</span>
            </a>
          ))}
          <Link className="pn-split-item" role="menuitem" to="/desktop">
            <span className="pn-split-os">Toutes les versions bureau</span>
            <span className="pn-split-ext">→</span>
          </Link>
        </div>
      )}
    </div>
  );
}

/** Bouton « Star » GitHub avec compteur live. */
export function GitHubStarButton({ repo = 'Etherealmber/atlas-commerce' }: { repo?: string }) {
  const [stars, setStars] = useState<number | null>(null);
  useEffect(() => {
    let dead = false;
    void (async () => {
      try {
        const r = await fetch(`https://api.github.com/repos/${repo}`);
        if (r.ok) {
          const j: any = await r.json();
          if (!dead && typeof j?.stargazers_count === 'number') setStars(j.stargazers_count);
        }
      } catch { /* le bouton reste un simple lien */ }
    })();
    return () => { dead = true; };
  }, [repo]);
  return (
    <a
      className="pn-star"
      href={`https://github.com/${repo}`}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={`Dépôt GitHub ${repo}${stars != null ? ` — ${stars} étoiles` : ''}`}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
        <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.1 4.7 18.1 5 18.1 5c.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5z" />
      </svg>
      <span>GitHub</span>
      {stars != null && <span className="pn-star-count">★ {stars.toLocaleString('fr-FR')}</span>}
    </a>
  );
}

/** CTA de connexion / tableau de bord selon la session. */
export function PublicSessionCta({ solid = true }: { solid?: boolean }) {
  return isLoggedIn() ? (
    <Link to="/dashboard" className={`pn-cta${solid ? ' solid' : ''}`}>Ouvrir l’app</Link>
  ) : (
    <Link to="/login" className={`pn-cta${solid ? ' solid' : ''}`}>Se connecter</Link>
  );
}
