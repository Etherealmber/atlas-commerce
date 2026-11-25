import { useSyncExternalStore } from 'react';
import { useLang, type Lang } from '../i18n/core';

/** The theme actually painted (`html[data-theme]`), live — follows every toggle. */
export type DocTheme = 'light' | 'dark';

function read(): DocTheme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function subscribe(onChange: () => void): () => void {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return () => {};
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => mo.disconnect();
}

export function useDocTheme(): DocTheme {
  return useSyncExternalStore(subscribe, read, () => 'light');
}

/** Demo captures that also exist in a dark version (`<name>-dark.webp`, see scripts/capture-demo-shots.mjs). */
const DARK_SHOTS = new Set(['phone-home-demo', 'phone-products-demo', 'phone-balance-demo', 'desktop-products-demo']);

/** `/shots/phone-products-demo.webp` → `/shots/phone-products-demo-dark.webp` in dark mode. */
export function themedShotSrc(src: string, theme: DocTheme, lang: Lang = 'fr'): string {
  const m = /^\/shots\/([a-z0-9-]+)\.webp$/.exec(src);
  if (!m || !DARK_SHOTS.has(m[1])) return src;
  if (lang !== 'fr') return `/shots/${m[1]}-${lang}-${theme}.webp`;
  return theme === 'dark' ? `/shots/${m[1]}-dark.webp` : src;
}

/** Hook form: the capture matching the current theme. */
export function useThemedShot(src: string): string {
  return themedShotSrc(src, useDocTheme(), useLang());
}
