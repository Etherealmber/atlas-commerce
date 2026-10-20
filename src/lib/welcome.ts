/**
 * First-run welcome experience — persistent completion + in-progress step.
 * atlas_welcome_completed: 'true' when finished.
 * atlas_welcome_step: current step index while in progress (survives refresh).
 * atlas_welcome_prefs: JSON of theme / density / glass choices.
 */

export const WELCOME_COMPLETED_KEY = 'atlas_welcome_completed';
export const WELCOME_STEP_KEY = 'atlas_welcome_step';
export const WELCOME_PREFS_KEY = 'atlas_welcome_prefs';

export type WelcomeTheme = 'light' | 'dark' | 'system';
export type WelcomeDensity = 'comfortable' | 'compact';

export type WelcomePrefs = {
  theme: WelcomeTheme;
  density: WelcomeDensity;
  liquidGlass: boolean;
};

export const WELCOME_STEP_COUNT = 6;

export function isWelcomeCompleted(): boolean {
  try {
    const v = localStorage.getItem(WELCOME_COMPLETED_KEY);
    // Explicit false → must complete (or re-run via « Revoir le guide »)
    if (v === 'false') return false;
    if (v === 'true') return true;
    // Missing key: treat as completed for existing installs; first-time
    // installs get false only after we opt them in below.
    // Brand-new browser: no theme / onboarding yet → show welcome.
    const hadOnboarding =
      localStorage.getItem('atlas_onboarding_v1') === 'done' ||
      localStorage.getItem('atlas_onboarding_v1') === 'skipped';
    const hadTheme = !!localStorage.getItem('atlas-theme');
    if (hadOnboarding || hadTheme) {
      try {
        localStorage.setItem(WELCOME_COMPLETED_KEY, 'true');
      } catch {
        /* */
      }
      return true;
    }
    return false;
  } catch {
    return true; // fail-open if storage blocked
  }
}

export function markWelcomeCompleted(): void {
  try {
    localStorage.setItem(WELCOME_COMPLETED_KEY, 'true');
    localStorage.removeItem(WELCOME_STEP_KEY);
  } catch {
    /* */
  }
}

export function resetWelcome(): void {
  try {
    localStorage.setItem(WELCOME_COMPLETED_KEY, 'false');
    localStorage.setItem(WELCOME_STEP_KEY, '0');
  } catch {
    /* */
  }
}

export function getWelcomeStep(): number {
  try {
    const n = parseInt(localStorage.getItem(WELCOME_STEP_KEY) || '0', 10);
    if (Number.isFinite(n) && n >= 0 && n < WELCOME_STEP_COUNT) return n;
  } catch {
    /* */
  }
  return 0;
}

export function setWelcomeStep(step: number): void {
  try {
    const s = Math.max(0, Math.min(WELCOME_STEP_COUNT - 1, step));
    localStorage.setItem(WELCOME_STEP_KEY, String(s));
  } catch {
    /* */
  }
}

export function getWelcomePrefs(): WelcomePrefs {
  try {
    const raw = localStorage.getItem(WELCOME_PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        theme: p.theme === 'dark' || p.theme === 'system' || p.theme === 'light' ? p.theme : 'system',
        density: p.density === 'comfortable' ? 'comfortable' : 'compact',
        liquidGlass: false,
      };
    }
  } catch {
    /* */
  }
  return { theme: 'system', density: 'comfortable', liquidGlass: false };
}

export function saveWelcomePrefs(prefs: Partial<WelcomePrefs>): WelcomePrefs {
  const next = { ...getWelcomePrefs(), ...prefs };
  try {
    localStorage.setItem(WELCOME_PREFS_KEY, JSON.stringify(next));
  } catch {
    /* */
  }
  return next;
}
