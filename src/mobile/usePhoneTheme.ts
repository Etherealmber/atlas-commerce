import { useCallback, useEffect, useState } from 'react';
import { getTheme, setTheme, THEME_EVENT, type ThemeChoice } from '../theme';

function systemIsDark(): boolean {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches; }
  catch { return false; }
}

export function applyPhoneTheme(choice: ThemeChoice): void {
  const dark = choice === 'dark' || (choice === 'system' && systemIsDark());
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
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
