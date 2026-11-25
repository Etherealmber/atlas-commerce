/** UI density + text scale (Atlas Commerce).
 * v0.9.3 — « Compacte » fonctionne de nouveau : le choix est stocké et posé sur
 * `<html data-ui-density="compact">`, qui pilote une couche CSS dédiée
 * (`src/styles/density-compact.css` : boutons, champs, cartes, tableaux, barre
 * flottante, barre latérale…). `data-density` reste « comfortable » exprès :
 * des centaines d’anciennes règles `[data-density="compact"]` (retirées en 0.8)
 * ne doivent jamais se réactiver. Le mobile reste toujours confortable.
 * Liquid glass permanently disabled.
 */

const KEY = 'atlas_ui_density';
const GLASS_KEY = 'atlas_ui_glass';
const SCALE_KEY = 'atlas_ui_scale';

export type Density = 'comfortable' | 'compact';
export type UiScale = 'sm' | 'md' | 'lg';

export function getDensity(): Density {
  try {
    return localStorage.getItem(KEY) === 'compact' ? 'compact' : 'comfortable';
  } catch {
    return 'comfortable';
  }
}

function applyDensityToDom(d: Density) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-density', 'comfortable');
  root.classList.remove('density-compact');
  root.classList.add('density-comfortable');
  root.setAttribute('data-ui-density', d);
}

export function setDensity(d: Density = 'comfortable') {
  const next: Density = d === 'compact' ? 'compact' : 'comfortable';
  try {
    localStorage.setItem(KEY, next);
  } catch {
    /* */
  }
  applyDensityToDom(next);
  applyEffectiveGlassToDom();
  notifyUiPrefs();
}

export function getUiScale(): UiScale {
  try {
    const v = localStorage.getItem(SCALE_KEY);
    if (v === 'sm' || v === 'lg' || v === 'md') return v;
  } catch {
    /* */
  }
  return 'md';
}

function setUiScale(scale: UiScale) {
  try {
    localStorage.setItem(SCALE_KEY, scale);
  } catch {
    /* */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-ui-scale', scale);
  }
  notifyUiPrefs();
}


export function setGlassEnabled(_on: boolean) {
  try {
    localStorage.setItem(GLASS_KEY, '0');
  } catch {
    /* */
  }
  applyEffectiveGlassToDom();
  notifyUiPrefs();
}


function applyEffectiveGlassToDom() {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-liquid-glass', 'off');
  root.setAttribute('data-glass', 'off');
  root.classList.remove('liquid-glass-active');
  root.classList.add('liquid-glass-off');
  root.style.setProperty('--glass-blur', '0px');
  root.style.setProperty('--glass-saturate', '1');
  root.style.setProperty('--glass-bg', 'transparent');
  try {
    localStorage.setItem(GLASS_KEY, '0');
  } catch {
    /* */
  }
}

function notifyUiPrefs() {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent('atlas-ui-prefs', {
        detail: {
          density: getDensity(),
          scale: getUiScale(),
          glass: false,
          liquidActive: false,
        },
      }),
    );
  } catch {
    /* */
  }
}

export function applyDensityFromStorage() {
  applyDensityToDom(getDensity());
  setUiScale(getUiScale());
  applyEffectiveGlassToDom();
}

export function subscribeUiPrefs(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => cb();
  window.addEventListener('atlas-ui-prefs', handler);
  return () => window.removeEventListener('atlas-ui-prefs', handler);
}
