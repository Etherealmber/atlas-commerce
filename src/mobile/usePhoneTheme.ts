import { useCallback, useEffect, useState } from 'react';
import { getTheme, setTheme, THEME_EVENT, type ThemeChoice } from '../theme';

function systemIsDark(): boolean {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches; }
  catch { return false; }
}

let themeTransitionTimer: number | undefined;
let phoneThemeRevealOrigin: { x: number; y: number } | null = null;

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener(
    'click',
    (e) => {
      const target = e.target as HTMLElement | null;
      const toggle = target && typeof target.closest === 'function'
        ? target.closest<HTMLElement>('[data-theme-toggle]')
        : null;
      if (!toggle) return;
      if (e.clientX > 0 || e.clientY > 0) {
        phoneThemeRevealOrigin = { x: e.clientX, y: e.clientY };
      } else {
        const rect = toggle.getBoundingClientRect();
        phoneThemeRevealOrigin = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
      }
    },
    true,
  );
}

function takePhoneThemeRevealOrigin(): { x: number; y: number } | null {
  const origin = phoneThemeRevealOrigin;
  phoneThemeRevealOrigin = null;
  return origin;
}

function commitPhoneTheme(dark: boolean): void {
  const root = document.documentElement;
  const next = dark ? 'dark' : 'light';
  root.dataset.theme = next;
  root.classList.toggle('theme-dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#111113' : '#f4f5f7');
}

export function applyPhoneTheme(choice: ThemeChoice): void {
  const dark = choice === 'dark' || (choice === 'system' && systemIsDark());
  const root = document.documentElement;
  const next = dark ? 'dark' : 'light';
  let animate = true;
  try {
    animate = localStorage.getItem('atlas_phone_animations') !== 'off'
      && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch { /* use default */ }

  const changed = Boolean(root.dataset.theme && root.dataset.theme !== next);
  if (animate && changed) {
    const doc = document as Document & {
      startViewTransition?: (cb: () => void) => { ready?: Promise<void> };
    };
    if (typeof doc.startViewTransition === 'function') {
      const origin = takePhoneThemeRevealOrigin();
      const x = origin ? origin.x : window.innerWidth / 2;
      const y = origin ? origin.y : 48;
      root.classList.remove('phone-theme-transition');
      const vt = doc.startViewTransition(() => commitPhoneTheme(dark));
      if (vt?.ready && typeof vt.ready.then === 'function') {
        vt.ready.then(() => {
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
              duration: 420,
              easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
              pseudoElement: '::view-transition-new(root)',
            },
          );
        }).catch(() => { /* interrupted transition — safe no-op */ });
      }
      return;
    }

    if (themeTransitionTimer !== undefined) window.clearTimeout(themeTransitionTimer);
    root.classList.add('phone-theme-transition');
    // Commit the transition styles before changing theme; works without the
    // View Transitions API in Safari, Firefox and Chromium.
    void root.offsetWidth;
    themeTransitionTimer = window.setTimeout(() => root.classList.remove('phone-theme-transition'), 300);
  }
  commitPhoneTheme(dark);
}

/** Keep phone settings, native controls and system theme changes in sync. */
export function usePhoneTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(getTheme);
  useEffect(() => {
    applyPhoneTheme(choice);
    let media: MediaQueryList | undefined;
    try { media = window.matchMedia('(prefers-color-scheme: dark)'); } catch { /* unavailable */ }
    const systemChanged = () => { if (choice === 'system') applyPhoneTheme('system'); };
    if (media?.addEventListener) media.addEventListener('change', systemChanged);
    else media?.addListener?.(systemChanged);
    const sync = () => setChoice(getTheme());
    window.addEventListener(THEME_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      if (media?.removeEventListener) media.removeEventListener('change', systemChanged);
      else media?.removeListener?.(systemChanged);
      window.removeEventListener(THEME_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [choice]);
  const change = useCallback((next: ThemeChoice) => {
    setTheme(next);
    // Even if storage is unavailable, the choice applies for this session.
    setChoice(next);
    applyPhoneTheme(next);
  }, []);
  return [choice, change];
}
