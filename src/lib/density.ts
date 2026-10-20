/** UI density + text scale (Atlas Commerce).
 * Compact mode removed. Liquid glass permanently disabled.
 */

const KEY = 'atlas_ui_density';
const GLASS_KEY = 'atlas_ui_glass';
const SCALE_KEY = 'atlas_ui_scale';

/** @deprecated Compact removed; always comfortable. */
export type Density = 'comfortable' | 'compact';
export type UiScale = 'sm' | 'md' | 'lg';

export function getDensity(): Density {
  return 'comfortable';
}

export function setDensity(_d?: Density) {
  try {
    localStorage.setItem(KEY, 'comfortable');
  } catch {
    /* */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-density', 'comfortable');
    document.documentElement.classList.remove('density-compact');
    document.documentElement.classList.add('density-comfortable');
  }
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

export function setUiScale(scale: UiScale) {
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

/** Liquid glass permanently disabled. */
export function isGlassEnabled(): boolean {
  return false;
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

export function isLiquidGlassActive(): boolean {
  return false;
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

export function notifyUiPrefs() {
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
  setDensity('comfortable');
  setUiScale(getUiScale());
  applyEffectiveGlassToDom();
}

export function subscribeUiPrefs(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => cb();
  window.addEventListener('atlas-ui-prefs', handler);
  return () => window.removeEventListener('atlas-ui-prefs', handler);
}
