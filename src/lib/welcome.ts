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

/** Real captures are individual welcome steps, never a stacked gallery. */
export const WELCOME_PREVIEWS = [
  { src: '/shots/demo.gif', title: 'Parcours complet dans Atlas', description: 'Créez un devis, suivez le stock et validez vos opérations en quelques secondes.', alt: 'Enregistrement réel d’une session Atlas Commerce', poster: '/shots/devis-modal-dark.png' },
  { src: '/shots/dashboard-dark.png', title: 'Tableau de bord Bento — sombre', description: 'Indicateurs clés, graphiques interactifs et trésorerie dans l’interface Bento sombre.', alt: 'Tableau de bord Atlas Commerce en thème sombre' },
  { src: '/shots/dashboard-light.png', title: 'Tableau de bord Bento — clair', description: 'Retrouvez la même clarté Bento et le dock adaptatif en thème clair.', alt: 'Tableau de bord Atlas Commerce en thème clair' },
  { src: '/shots/devis-modal-dark.png', title: 'Assistant devis étape par étape', description: 'Client, lignes et récapitulatif guidé pour éviter toute erreur de saisie.', alt: 'Assistant de création de devis Atlas Commerce' },
  { src: '/shots/settings-dark.png', title: 'Navigation Focus & réglages', description: 'Barre latérale Focus dédiée pour configurer société, légal, IA et sécurité.', alt: 'Paramètres d’apparence Atlas Commerce' },
  { src: '/shots/phone-dashboard-dark.png', title: 'Votre activité sur téléphone', description: 'Consultez votre tableau de bord et vos alertes depuis l’application mobile.', alt: 'Tableau de bord Atlas Commerce sur téléphone' },
  { src: '/shots/phone-quotes-dark.png', title: 'Devis et opérations sur mobile', description: 'Retrouvez vos devis et synchronisez le terrain avec le bureau en direct.', alt: 'Liste des devis Atlas Commerce sur téléphone' },
] as const;

export const WELCOME_PREVIEW_START = 2;
export const WELCOME_FEATURES_STEP = WELCOME_PREVIEW_START + WELCOME_PREVIEWS.length;
export const WELCOME_COMPARE_STEP = WELCOME_FEATURES_STEP + 1;
export const WELCOME_FINAL_STEP = WELCOME_COMPARE_STEP + 1;
export const WELCOME_STEP_COUNT = WELCOME_FINAL_STEP + 1;
const WELCOME_LAYOUT_KEY = 'atlas_welcome_layout';
const WELCOME_LAYOUT = 'capture-steps-v2';

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
    localStorage.setItem(WELCOME_LAYOUT_KEY, WELCOME_LAYOUT);
  } catch {
    /* */
  }
}

export function getWelcomeStep(): number {
  try {
    const n = parseInt(localStorage.getItem(WELCOME_STEP_KEY) || '0', 10);
    if (Number.isFinite(n) && n >= 0 && n < WELCOME_STEP_COUNT) {
      // Keep existing in-progress users on comparison / final screens after
      // inserting previews. Completed installs are not forced through again.
      if (localStorage.getItem(WELCOME_LAYOUT_KEY) !== WELCOME_LAYOUT) {
        if (n === 3) return WELCOME_COMPARE_STEP;
        if (n === 4) return WELCOME_FINAL_STEP;
        if (n > 4) return 0;
      }
      return n;
    }
  } catch {
    /* */
  }
  return 0;
}

export function setWelcomeStep(step: number): void {
  try {
    const s = Math.max(0, Math.min(WELCOME_STEP_COUNT - 1, step));
    localStorage.setItem(WELCOME_STEP_KEY, String(s));
    localStorage.setItem(WELCOME_LAYOUT_KEY, WELCOME_LAYOUT);
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
