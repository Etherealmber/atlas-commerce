/**
 * v0.7.4 — petit contrat de thème partagé entre l'app (useTheme dans App.tsx)
 * et les pages publiques (nav pill des landings). Même clé localStorage
 * (« atlas-theme ») et même événement de synchronisation
 * (« atlas-theme-change ») : un changement depuis n'importe quel composant
 * est repris partout, y compris le choix « système ».
 */

export type ThemeChoice = 'light' | 'dark' | 'system';

const KEY = 'atlas-theme';
export const THEME_EVENT = 'atlas-theme-change';

export function getTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function setTheme(v: ThemeChoice): void {
  try {
    localStorage.setItem(KEY, v);
  } catch { /* navigation privée : le choix reste en mémoire */ }
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Thème réellement affiché (le mode « système » suit prefers-color-scheme). */
export function getResolvedTheme(): 'light' | 'dark' {
  const t = getTheme();
  if (t !== 'system') return t;
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'dark';
  }
}

export function subscribeTheme(cb: (t: ThemeChoice) => void): () => void {
  const fn = () => cb(getTheme());
  window.addEventListener(THEME_EVENT, fn);
  window.addEventListener('storage', fn);
  let mq: MediaQueryList | null = null;
  try {
    mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', fn);
  } catch { /* anciens navigateurs */ }
  return () => {
    window.removeEventListener(THEME_EVENT, fn);
    window.removeEventListener('storage', fn);
    try { mq?.removeEventListener('change', fn); } catch { /* */ }
  };
}
