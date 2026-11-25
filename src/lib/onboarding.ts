/**
 * v0.9.3 — Visite guidée (après le guide de bienvenue).
 *
 * `atlas_onboarding` = { status: 'pending' | 'done', step: number }.
 * - Welcome « Explorer Atlas Commerce » → restartOnboarding() (status pending, step 0).
 * - GuidedOnboarding (App shell) lit l’état, avance l’étape, puis finishOnboarding().
 * - Paramètres → Mon profil « Revoir la visite guidée » → restartOnboarding().
 * - Mobile web : PhoneWelcome → restartPhoneOnboarding(), PhoneOnboarding (clé séparée
 *   `atlas_phone_onboarding`), Réglages mobile → restartPhoneOnboarding().
 * - Refaire le guide de bienvenue (resetWelcome) → resetAllOnboarding() : les deux
 *   visites repartent de zéro quand le guide est terminé, même si elles étaient « done ».
 */

export const ONBOARDING_KEY = 'atlas_onboarding';
export const ONBOARDING_EVENT = 'atlas-onboarding';
/** Mobile web keeps its own tour (different steps, different screen). */
export const PHONE_ONBOARDING_KEY = 'atlas_phone_onboarding';
export const PHONE_ONBOARDING_EVENT = 'atlas-phone-onboarding';

export type OnboardingState = { status: 'pending' | 'done'; step: number };

function read(key: string): OnboardingState | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<OnboardingState> | null;
    if (!v || (v.status !== 'pending' && v.status !== 'done')) return null;
    const step = Number.isFinite(v.step) && (v.step as number) >= 0 ? Math.floor(v.step as number) : 0;
    return { status: v.status, step };
  } catch {
    return null;
  }
}

function write(key: string, event: string, state: OnboardingState) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    /* private mode: the tour simply runs once per session */
  }
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(event, { detail: state }));
    } catch {
      /* */
    }
  }
}

export function getOnboarding(): OnboardingState | null {
  return read(ONBOARDING_KEY);
}

export function isOnboardingPending(): boolean {
  return getOnboarding()?.status === 'pending';
}

export function queueOnboarding(): void {
  const cur = getOnboarding();
  if (cur?.status === 'done') return;
  write(ONBOARDING_KEY, ONBOARDING_EVENT, { status: 'pending', step: 0 });
}

export function restartOnboarding(): void {
  write(ONBOARDING_KEY, ONBOARDING_EVENT, { status: 'pending', step: 0 });
}

export function setOnboardingStep(step: number): void {
  write(ONBOARDING_KEY, ONBOARDING_EVENT, { status: 'pending', step: Math.max(0, Math.floor(step)) });
}

export function finishOnboarding(): void {
  write(ONBOARDING_KEY, ONBOARDING_EVENT, { status: 'done', step: 0 });
}

/* ---- Mobile web tour (PhoneOnboarding) ---- */

export function getPhoneOnboarding(): OnboardingState | null {
  return read(PHONE_ONBOARDING_KEY);
}

export function isPhoneOnboardingPending(): boolean {
  return getPhoneOnboarding()?.status === 'pending';
}

export function queuePhoneOnboarding(): void {
  if (getPhoneOnboarding()?.status === 'done') return;
  write(PHONE_ONBOARDING_KEY, PHONE_ONBOARDING_EVENT, { status: 'pending', step: 0 });
}

export function restartPhoneOnboarding(): void {
  write(PHONE_ONBOARDING_KEY, PHONE_ONBOARDING_EVENT, { status: 'pending', step: 0 });
}

export function setPhoneOnboardingStep(step: number): void {
  write(PHONE_ONBOARDING_KEY, PHONE_ONBOARDING_EVENT, { status: 'pending', step: Math.max(0, Math.floor(step)) });
}

export function finishPhoneOnboarding(): void {
  write(PHONE_ONBOARDING_KEY, PHONE_ONBOARDING_EVENT, { status: 'done', step: 0 });
}

/** Forget both tours (desktop + mobile web). Used when the welcome guide is redone. */
export function resetAllOnboarding(): void {
  for (const [key, event] of [[ONBOARDING_KEY, ONBOARDING_EVENT], [PHONE_ONBOARDING_KEY, PHONE_ONBOARDING_EVENT]] as const) {
    try { localStorage.removeItem(key); } catch { /* */ }
    try { window.dispatchEvent(new CustomEvent(event, { detail: null })); } catch { /* */ }
  }
}
