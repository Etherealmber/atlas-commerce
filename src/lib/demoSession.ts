/**
 * Demo sandbox (« test / test ») — client side.
 * The server returns `demo: { expires_at, minutes, window_hours, message }`
 * with the login response; we keep it to show the countdown and to leave the
 * sandbox cleanly when the demo hour is over.
 */
export const DEMO_STORAGE_KEY = 'atlas_demo_session';
export const DEMO_TOKEN_PREFIX = 'atlasdemo.';
export const DEMO_EVENT = 'atlas-demo-session';

export interface DemoSessionInfo {
  started_at: number;
  expires_at: number;
  minutes: number;
  window_hours: number;
  message?: string;
  intro_seen?: boolean;
}

export interface DemoConfig {
  enabled: boolean;
  highlight: boolean;
  username: string;
  password: string;
  minutes: number;
  window_hours: number;
  message: string;
}

export function isDemoToken(token: string | null | undefined): boolean {
  return !!token && token.startsWith(DEMO_TOKEN_PREFIX);
}

export function getDemoSession(): DemoSessionInfo | null {
  try {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as DemoSessionInfo;
    if (!v || !Number.isFinite(v.expires_at)) return null;
    return v;
  } catch {
    return null;
  }
}

function emit() {
  try { window.dispatchEvent(new Event(DEMO_EVENT)); } catch { /* SSR / tests */ }
}

export function setDemoSession(info: Partial<DemoSessionInfo> & { expires_at: number }): void {
  const value: DemoSessionInfo = {
    started_at: Number(info.started_at) || Date.now(),
    expires_at: Number(info.expires_at),
    minutes: Number(info.minutes) || 60,
    window_hours: Number(info.window_hours) || 24,
    message: info.message,
    intro_seen: !!info.intro_seen,
  };
  try { localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(value)); } catch { /* */ }
  emit();
}

export function markDemoIntroSeen(): void {
  const cur = getDemoSession();
  if (cur) setDemoSession({ ...cur, intro_seen: true });
}

export function clearDemoSession(): void {
  try { localStorage.removeItem(DEMO_STORAGE_KEY); } catch { /* */ }
  restoreDemoGuides();
  emit();
}

/**
 * A fresh demo hour replays the welcome guide and the guided tour, like a
 * brand-new install. The browser's own progress (and the theme the welcome
 * lets you pick) is saved first and put back when the demo ends, so a real
 * user who tried the demo is not sent through the guide again.
 */
export const DEMO_GUIDE_BACKUP_KEY = 'atlas_demo_guide_backup';
const GUIDE_KEYS = [
  'atlas_welcome_completed',
  'atlas_welcome_step',
  'atlas_welcome_layout',
  'atlas_welcome_prefs',
  'atlas_onboarding',
  'atlas_phone_onboarding',
  'atlas-theme',
  'atlas_ui_density',
  'atlas_ui_glass',
] as const;

export function startDemoGuides(): void {
  try {
    if (localStorage.getItem(DEMO_GUIDE_BACKUP_KEY) === null) {
      const saved: Record<string, string | null> = {};
      for (const k of GUIDE_KEYS) saved[k] = localStorage.getItem(k);
      localStorage.setItem(DEMO_GUIDE_BACKUP_KEY, JSON.stringify(saved));
    }
    localStorage.setItem('atlas_welcome_completed', 'false');
    localStorage.setItem('atlas_welcome_step', '0');
    localStorage.removeItem('atlas_onboarding');
    localStorage.removeItem('atlas_phone_onboarding');
    sessionStorage.removeItem('atlas_phone_welcome_step');
  } catch { /* storage disabled: the demo simply skips the guide */ }
}

export function restoreDemoGuides(): void {
  try {
    const raw = localStorage.getItem(DEMO_GUIDE_BACKUP_KEY);
    if (raw === null) return;
    const saved = JSON.parse(raw) as Record<string, string | null>;
    for (const k of GUIDE_KEYS) {
      const v = saved?.[k];
      if (typeof v === 'string') localStorage.setItem(k, v);
      else localStorage.removeItem(k);
    }
    localStorage.removeItem(DEMO_GUIDE_BACKUP_KEY);
  } catch { /* */ }
}

/** « 1 heure », « 2 heures », « 45 minutes ». */
export function durationLabel(minutes: number): string {
  const m = Number(minutes) || 60;
  if (m >= 60 && m % 60 === 0) return `${m / 60} heure${m / 60 > 1 ? 's' : ''}`;
  return `${m} minutes`;
}

/** « 18:05 » for the countdown chip. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

let configPromise: Promise<DemoConfig | null> | null = null;

export function fetchDemoConfig(apiBase = ''): Promise<DemoConfig | null> {
  configPromise ??= fetch(`${apiBase}/api/demo/config`, { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((j: any) => (j?.success && j.data ? (j.data as DemoConfig) : null))
    .catch(() => null);
  return configPromise;
}
