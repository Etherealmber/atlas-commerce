/**
 * v260 — Crash reporting (docs/reports-github.md).
 *
 * Fire-and-forget: window errors, unhandled promise rejections and React
 * ErrorBoundary crashes are POSTed to /api/crash-reports (public endpoint,
 * rate-limited + sanitized server-side). The worker queues them in D1 and —
 * when the owner configured a GitHub token — turns each unique crash into a
 * deduplicated issue in the project repo.
 *
 * Rules: never throw, never block the UI, max 5 reports per session,
 * same message+frame deduped client-side, network noise ignored.
 */
import { getApiBase } from '../config';
import { APP_VERSION } from '../version';

const MAX_PER_SESSION = 5;
let sent = 0;
const seen = new Set<string>();

export function reportCrash(err: unknown, ctx: { route?: string; componentStack?: string } = {}): void {
  try {
    if (sent >= MAX_PER_SESSION) return;
    const e = err instanceof Error ? err : new Error(String(err ?? 'Erreur inconnue'));
    const message = (e.message || 'Erreur inconnue').slice(0, 400);
    const firstFrame =
      (e.stack || '').split('\n').map((l) => l.trim()).find((l) => l.startsWith('at ')) || '';
    const key = `${message}|${firstFrame}`;
    if (seen.has(key)) return;
    seen.add(key);
    sent += 1;
    const payload = JSON.stringify({
      message,
      stack: (e.stack || '').slice(0, 4000),
      componentStack: (ctx.componentStack || '').slice(0, 2000),
      route: ctx.route || (typeof location !== 'undefined' ? location.pathname : ''),
      version: APP_VERSION,
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    });
    const url = `${getApiBase()}/api/crash-reports`;
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {
      try {
        navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
      } catch {
        /* abandon — reporting must never make things worse */
      }
    });
  } catch {
    /* never throw from the reporter */
  }
}

export function installCrashReporting(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (ev) => {
    reportCrash(ev.error instanceof Error ? ev.error : new Error(String(ev.message || 'Erreur globale')), {
      route: typeof location !== 'undefined' ? location.pathname : '',
    });
  });
  window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
    const r = ev.reason;
    const msg = r instanceof Error ? r.message : String(r ?? '');
    // Network noise is already surfaced by the ErrorBoundary UX — don't spam.
    if (/failed to fetch|networkerror|load failed|net::/i.test(msg)) return;
    reportCrash(r instanceof Error ? r : new Error(`Promise rejetée : ${msg.slice(0, 300)}`));
  });
}
