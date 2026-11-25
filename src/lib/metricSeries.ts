import { useEffect, useState } from 'react';
import { api } from '../api';
import { getToken } from '../auth';

/** Daily KPI series shared by every page (one request, cached for a minute). */
export interface MetricsDaily {
  days: number;
  dates: string[];
  series: Record<string, (number | null)[]>;
  kinds: Record<string, 'flow' | 'level'>;
}

interface State {
  data: MetricsDaily | null;
  loading: boolean;
  error: boolean;
}

const TTL_MS = 60_000;
let state: State = { data: null, loading: false, error: false };
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<(s: State) => void>();

function publish(next: State) {
  state = next;
  for (const fn of listeners) fn(state);
}

export function loadMetricSeries(force = false): Promise<void> {
  if (!getToken()) return Promise.resolve();
  if (inflight) return inflight;
  if (!force && state.data && Date.now() - fetchedAt < TTL_MS) return Promise.resolve();
  publish({ ...state, loading: true });
  inflight = Promise.resolve()
    .then(() => api.getMetricsDaily(7))
    .then((r) => {
      fetchedAt = Date.now();
      publish({ data: r?.data || null, loading: false, error: false });
    })
    .catch(() => publish({ ...state, loading: false, error: true }))
    .finally(() => { inflight = null; });
  return inflight;
}

let refreshBound = false;
function bindRefresh() {
  if (refreshBound || typeof window === 'undefined') return;
  refreshBound = true;
  // Any successful business write (see api.ts) makes the next read recompute.
  window.addEventListener('atlas-lists-refresh', () => {
    fetchedAt = 0;
    if (listeners.size) void loadMetricSeries(true);
  });
}

export function useMetricSeries(): State {
  const [snap, setSnap] = useState<State>(state);
  useEffect(() => {
    bindRefresh();
    listeners.add(setSnap);
    setSnap(state);
    void loadMetricSeries();
    return () => { listeners.delete(setSnap); };
  }, []);
  return snap;
}

/** Test hook: reset the module cache. */
export function __resetMetricSeries(next?: MetricsDaily | null) {
  state = { data: next ?? null, loading: false, error: false };
  fetchedAt = next ? Date.now() : 0;
  inflight = null;
}

export type TrendCompare = 'period' | 'day';

export interface TrendResult {
  pct: number;
  direction: 'up' | 'down' | 'flat';
  /** Human comparison, e.g. « vs 7 jours précédents » or « vs 18 nov. ». */
  against: string;
}

const SHORT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
export const shortDay = (iso: string) => SHORT.format(new Date(`${iso}T00:00:00Z`));

/**
 * Trend of one series, Cloudflare style.
 * - flow + period: sum of the last `days` points vs the `days` before.
 * - flow + day:    last point vs the one before (« vs hier »).
 * - level:         latest value vs the value `days` earlier, or the oldest known value.
 * Returns null when there is nothing honest to compare with.
 */
export function computeTrend(
  values: (number | null)[] | undefined,
  kind: 'flow' | 'level',
  dates: string[],
  compare: TrendCompare = 'period',
): TrendResult | null {
  if (!values || values.length < 2) return null;
  const n = values.length;
  let cur: number;
  let prev: number;
  let against: string;
  if (kind === 'flow') {
    if (compare === 'day') {
      cur = values[n - 1] ?? 0;
      prev = values[n - 2] ?? 0;
      against = 'vs hier';
    } else {
      const half = Math.floor(n / 2);
      cur = values.slice(half).reduce<number>((a, v) => a + (v ?? 0), 0);
      prev = values.slice(0, half).reduce<number>((a, v) => a + (v ?? 0), 0);
      against = `vs ${half} jours précédents`;
    }
  } else {
    const last = values[n - 1];
    if (last === null) return null;
    let idx = -1;
    const target = Math.floor(n / 2) - 1;
    for (let i = target; i >= 0; i--) if (values[i] !== null) { idx = i; break; }
    if (idx < 0) for (let i = target + 1; i < n - 1; i++) if (values[i] !== null) { idx = i; break; }
    if (idx < 0) return null;
    cur = last;
    prev = values[idx] as number;
    against = idx === n - 2 ? 'vs hier' : `vs ${shortDay(dates[idx] || '')}`;
  }
  if (prev === 0 && cur === 0) return { pct: 0, direction: 'flat', against };
  if (prev === 0) return null; // « +∞ % » helps nobody
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const rounded = Math.round(pct * 10) / 10;
  return { pct: rounded, direction: rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat', against };
}

/** True when a series has nothing to draw. */
export function isEmptySeries(values: (number | null)[] | undefined, kind: 'flow' | 'level'): boolean {
  if (!values || !values.length) return true;
  const known = values.filter((v): v is number => v !== null);
  if (kind === 'level') return known.length < 2;
  return known.every((v) => v === 0);
}
