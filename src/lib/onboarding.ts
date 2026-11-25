/**
 * v0.9.4 — Visite guidée (après le guide de bienvenue).
 *
 * `atlas_onboarding` = { status: 'pending' | 'done', step: number }.
 * - Welcome « Explorer Atlas Commerce » → queueOnboarding() (status pending, step 0).
 * - GuidedOnboarding (App shell) lit l’état, avance l’étape, puis finishOnboarding().
 * - Paramètres → Mon profil « Revoir la visite guidée » → restartOnboarding().
 */

export const ONBOARDING_KEY = 'atlas_onboarding';
export const ONBOARDING_EVENT = 'atlas-onboarding';

export type OnboardingState = { status: 'pending' | 'done'; step: number };

export function getOnboarding(): OnboardingState | null {
  try {
    const raw = localStorage.getItem(ONBOARDING_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<OnboardingState> | null;
    if (!v || (v.status !== 'pending' && v.status !== 'done')) return null;
    const step = Number.isFinite(v.step) && (v.step as number) >= 0 ? Math.floor(v.step as number) : 0;
    return { status: v.status, step };
  } catch {
    return null;
  }
}

function write(state: OnboardingState) {
  try {
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify(state));
  } catch {
    /* private mode: the tour simply runs once per session */
  }
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(ONBOARDING_EVENT, { detail: state }));
    } catch {
      /* */
    }
  }
}

export function isOnboardingPending(): boolean {
  return getOnboarding()?.status === 'pending';
}

export function queueOnboarding(): void {
  const cur = getOnboarding();
  if (cur?.status === 'done') return;
  write({ status: 'pending', step: 0 });
}

export function restartOnboarding(): void {
  write({ status: 'pending', step: 0 });
}

export function setOnboardingStep(step: number): void {
  write({ status: 'pending', step: Math.max(0, Math.floor(step)) });
}

export function finishOnboarding(): void {
  write({ status: 'done', step: 0 });
}
