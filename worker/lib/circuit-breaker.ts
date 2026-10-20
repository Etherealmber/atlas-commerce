/**
 * Lightweight circuit breaker for upstream APIs (Groq, GitHub, mail).
 * Per-isolate state (Workers have no global Redis) — good enough to shed load
 * after consecutive failures without a separate mesh.
 */

type State = 'closed' | 'open' | 'half_open';

type Bucket = {
  state: State;
  failures: number;
  openedAt: number;
  halfOpenProbes: number;
};

const buckets = new Map<string, Bucket>();

const DEFAULTS = {
  failureThreshold: 5,
  openMs: 30_000,
  halfOpenMax: 2,
};

export function circuitAllow(name: string, opts = DEFAULTS): boolean {
  const b = buckets.get(name);
  if (!b || b.state === 'closed') return true;
  const now = Date.now();
  if (b.state === 'open') {
    if (now - b.openedAt >= opts.openMs) {
      b.state = 'half_open';
      b.halfOpenProbes = 0;
      buckets.set(name, b);
      return true;
    }
    return false;
  }
  // half_open
  if (b.halfOpenProbes >= opts.halfOpenMax) return false;
  b.halfOpenProbes += 1;
  buckets.set(name, b);
  return true;
}

export function circuitSuccess(name: string): void {
  buckets.set(name, { state: 'closed', failures: 0, openedAt: 0, halfOpenProbes: 0 });
}

export function circuitFailure(name: string, opts = DEFAULTS): void {
  const b = buckets.get(name) || { state: 'closed' as State, failures: 0, openedAt: 0, halfOpenProbes: 0 };
  b.failures += 1;
  if (b.state === 'half_open' || b.failures >= opts.failureThreshold) {
    b.state = 'open';
    b.openedAt = Date.now();
    b.failures = 0;
  }
  buckets.set(name, b);
}

export function circuitStatus(name: string): State {
  return buckets.get(name)?.state || 'closed';
}
