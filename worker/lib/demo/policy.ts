/** Demo sandbox limits: 1 hour of use per fingerprint, once every 24 hours. */
export const DEMO_USERNAME = 'test';
export const DEMO_PASSWORD = 'test';
export const DEMO_SESSION_MINUTES = 60;
export const DEMO_SESSION_MS = DEMO_SESSION_MINUTES * 60 * 1000;

/** « 1 heure », « 2 heures », « 45 minutes » — for user-facing messages. */
export function demoDurationLabel(minutes: number = DEMO_SESSION_MINUTES): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} heure${h > 1 ? 's' : ''}`;
  }
  return `${minutes} minutes`;
}
export const DEMO_WINDOW_HOURS = 24;
export const DEMO_WINDOW_MS = DEMO_WINDOW_HOURS * 60 * 60 * 1000;

export interface DemoMeta {
  started_at: number;
  expires_at: number;
  gen: number;
  seeded: boolean;
  wiped?: boolean;
}

export type DemoDecision =
  | { action: 'new' }
  | { action: 'active' }
  | { action: 'denied'; retry_at: number };

/**
 * - no previous session, or the 24 h window is over → fresh sandbox;
 * - inside the session (1 h) → resume the same sandbox (same data);
 * - minutes used up → wait for the end of the 24 h window.
 */
export function decideDemoSession(meta: DemoMeta | null | undefined, now: number): DemoDecision {
  if (!meta || !Number.isFinite(meta.started_at) || now >= meta.started_at + DEMO_WINDOW_MS || now < meta.started_at - 60_000) {
    return { action: 'new' };
  }
  if (now < meta.expires_at && !meta.wiped) return { action: 'active' };
  return { action: 'denied', retry_at: meta.started_at + DEMO_WINDOW_MS };
}

export function formatWait(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h} h ${String(m).padStart(2, '0')}`;
  if (h) return `${h} h`;
  return `${m} min`;
}

export function demoIntroMessage(): string {
  const d = demoDurationLabel();
  return `Mode démo : ${d} d’essai par tranche de ${DEMO_WINDOW_HOURS} heures. Les données sont fictives, modifiables, et la base est réinitialisée au bout de ${d}. Vos vraies données ne sont jamais touchées.`;
}
