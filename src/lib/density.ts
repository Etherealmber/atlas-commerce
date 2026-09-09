/** UI density + liquid-glass + text scale (Atlas Commerce).
 *
 * State priority rule:
 *   Compact density ALWAYS overrides Liquid Glass.
 *   isLiquidGlassActive = userPrefersGlass && density !== 'compact'
 */

const KEY = 'atlas_ui_density';
const GLASS_KEY = 'atlas_ui_glass';
const SCALE_KEY = 'atlas_ui_scale';

export type Density = 'comfortable' | 'compact';
/** Text / control scale — works with both density modes */
export type UiScale = 'sm' | 'md' | 'lg';

/** Default density is compact (tighter layout, readable sizes). */
export function getDensity(): Density {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'comfortable') return 'comfortable';
    if (v === 'compact') return 'compact';
    return 'compact';
  } catch {
    return 'compact';
  }
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

export function isGlassEnabled(): boolean {
  try {
    const v = localStorage.getItem(GLASS_KEY);
    if (v === '0' || v === 'off') return false;
    if (v === '1' || v === 'on') return true;
  } catch {
    /* */
  }
  return true;
}

export function isLiquidGlassActive(): boolean {
  if (getDensity() === 'compact') return false;
  return isGlassEnabled();
}

function applyEffectiveGlassToDom() {
  if (typeof document === 'undefined') return;
  const active = isLiquidGlassActive();
  const root = document.documentElement;
  root.setAttribute('data-liquid-glass', active ? 'on' : 'off');
  root.setAttribute('data-glass', active ? 'on' : 'off');
  root.classList.toggle('liquid-glass-active', active);
  root.classList.toggle('liquid-glass-off', !active);
}

/** Broadcast so Settings + AccountMenu update live without refresh. */
export function notifyUiPrefs() {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(
      new CustomEvent('atlas-ui-prefs', {
        detail: {
          density: getDensity(),
          scale: getUiScale(),
          glass: isGlassEnabled(),
          liquidActive: isLiquidGlassActive(),
        },
      }),
    );
  } catch {
    /* */
  }
}

export function subscribeUiPrefs(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const fn = () => cb();
  window.addEventListener('atlas-ui-prefs', fn);
  window.addEventListener('storage', fn);
  return () => {
    window.removeEventListener('atlas-ui-prefs', fn);
    window.removeEventListener('storage', fn);
  };
}

export function setDensity(d: Density) {
  try {
    localStorage.setItem(KEY, d);
  } catch {
    /* private mode */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.density = d;
    document.documentElement.setAttribute('data-density', d);
    applyEffectiveGlassToDom();
  }
  notifyUiPrefs();
}

export function setUiScale(s: UiScale) {
  try {
    localStorage.setItem(SCALE_KEY, s);
  } catch {
    /* */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.uiScale = s;
    document.documentElement.setAttribute('data-ui-scale', s);
  }
  notifyUiPrefs();
}

export function setGlassEnabled(on: boolean) {
  try {
    localStorage.setItem(GLASS_KEY, on ? 'on' : 'off');
  } catch {
    /* */
  }
  applyEffectiveGlassToDom();
  notifyUiPrefs();
}

export function applyDensityFromStorage() {
  const d = getDensity();
  const s = getUiScale();
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.density = d;
    document.documentElement.setAttribute('data-density', d);
    document.documentElement.dataset.uiScale = s;
    document.documentElement.setAttribute('data-ui-scale', s);
    applyEffectiveGlassToDom();
  }
}
