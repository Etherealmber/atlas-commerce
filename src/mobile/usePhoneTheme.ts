import { useCallback, useEffect, useState } from 'react';
import { getTheme, setTheme, THEME_EVENT, type ThemeChoice } from '../theme';

function systemIsDark(): boolean {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches; }
  catch { return false; }
}

let themeTransitionTimer: number | undefined;

export function applyPhoneTheme(choice: ThemeChoice): void {
  const dark = choice === 'dark' || (choice === 'system' && systemIsDark());
  const root = document.documentElement;
  const next = dark ? 'dark' : 'light';
  let animate = true;
  try { animate = localStorage.getItem('atlas_phone_animations') !== 'off' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* use default */ }
  if (animate && root.dataset.theme && root.dataset.theme !== next) {
    if (themeTransitionTimer !== undefined) window.clearTimeout(themeTransitionTimer);
    root.classList.add('phone-theme-transition');
    // Commit the transition styles before changing theme; works without the
    // View Transitions API in Safari, Firefox and Chromium.
    void root.offsetWidth;
    themeTransitionTimer = window.setTimeout(() => root.classList.remove('phone-theme-transition'), 300);
  }
  root.dataset.theme = next;
  root.classList.toggle('theme-dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#111113' : '#f4f5f7');
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
