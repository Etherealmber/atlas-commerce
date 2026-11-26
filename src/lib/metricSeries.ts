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

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Only a well-formed payload reaches the cards — anything else (an older worker
 *  mid-deploy, an empty list…) means « no series », never a crashed page. */
export function normalizeMetricsDaily(raw: unknown): MetricsDaily | null {
  if (!isRecord(raw) || !isRecord(raw.series) || !Array.isArray(raw.dates)) return null;
  return {
    days: Number(raw.days) || raw.dates.length,
    dates: raw.dates.map(String),
    series: raw.series as MetricsDaily['series'],
    kinds: (isRecord(raw.kinds) ? raw.kinds : {}) as MetricsDaily['kinds'],
  };
}
let state: State = { data: null, loading: false, error: false };
let fetchedAt = 0;
/** Last completed network load (unlike `fetchedAt`, never reset by writes). */
let lastLoadAt = 0;
let inflight: Promise<void> | null = null;
let cacheToken: string | null = null;

// Never show one session's financial metrics to a subsequent session.
function syncSession(): string | null {
  const token = getToken();
  if (token !== cacheToken) {
    cacheToken = token;
    state = { data: null, loading: false, error: false };
    fetchedAt = 0;
    lastLoadAt = 0;
    inflight = null;
    if (writeReloadTimer) { clearTimeout(writeReloadTimer); writeReloadTimer = null; }
  }
  return token;
}
const listeners = new Set<(s: State) => void>();

function publish(next: State) {
  state = next;
  for (const fn of listeners) fn(state);
}

export function loadMetricSeries(force = false): Promise<void> {
  const previousToken = cacheToken;
  const token = syncSession();
  if (previousToken !== token) publish(state);
  if (!token) return Promise.resolve();
  if (inflight) return inflight;
  if (!force && state.data && Date.now() - fetchedAt < TTL_MS) return Promise.resolve();
  publish({ ...state, loading: true });
  const request = Promise.resolve()
    .then(() => api.getMetricsDaily(7))
    .then((r) => {
      if (getToken() !== token || cacheToken !== token) return;
      fetchedAt = Date.now();
      lastLoadAt = fetchedAt;
      publish({ data: normalizeMetricsDaily(r?.data), loading: false, error: false });
    })
    .catch(() => { if (getToken() === token && cacheToken === token) publish({ ...state, loading: false, error: true }); })
    .finally(() => { if (inflight === request) inflight = null; });
  inflight = request;
  return request;
}

/** Writes come in bursts (a scanning session, a multi-line invoice): coalesce
 *  them into one reload, and never reload more often than this. Each reload
 *  can cost the server ~20 aggregate queries. */
export const WRITE_RELOAD_DEBOUNCE_MS = 4_000;
export const WRITE_RELOAD_MIN_GAP_MS = 30_000;
let writeReloadTimer: ReturnType<typeof setTimeout> | null = null;

/** A business write happened: mark the series stale and schedule one coalesced reload. */
export function scheduleMetricReloadAfterWrite(): void {
  fetchedAt = 0;
  if (writeReloadTimer) clearTimeout(writeReloadTimer);
  const lastLoad = lastLoadAt;
  const wait = Math.max(WRITE_RELOAD_DEBOUNCE_MS, lastLoad ? WRITE_RELOAD_MIN_GAP_MS - (Date.now() - lastLoad) : 0);
  writeReloadTimer = setTimeout(() => {
    writeReloadTimer = null;
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    // Hidden tab or no chart on screen: the next mount / focus loads fresh data.
    if (listeners.size && !hidden) void loadMetricSeries(true);
  }, wait);
}

let refreshBound = false;
function bindRefresh() {
  if (refreshBound || typeof window === 'undefined') return;
  refreshBound = true;
  // Any successful business write (see api.ts) makes the next read recompute.
  window.addEventListener('atlas-lists-refresh', scheduleMetricReloadAfterWrite);
  // Keep the last snapshot visible while refreshing after returning to the app.
  const refreshVisible = () => { if (listeners.size && document.visibilityState !== 'hidden') void loadMetricSeries(); };
  window.addEventListener('focus', refreshVisible);
  document.addEventListener?.('visibilitychange', refreshVisible);
}

/** Subscribe to the shared series (loads it if stale); returns the unsubscribe. */
export function subscribeMetricSeries(fn: (s: State) => void): () => void {
  bindRefresh();
  syncSession();
  listeners.add(fn);
  fn(state);
  void loadMetricSeries();
  return () => { listeners.delete(fn); };
}

export function useMetricSeries(): State {
  const [snap, setSnap] = useState<State>(() => getToken() === cacheToken ? state : { data: null, loading: false, error: false });
  useEffect(() => subscribeMetricSeries(setSnap), []);
  return snap;
}

/** Test hook: reset the module cache. */
export function __resetMetricSeries(next?: MetricsDaily | null) {
  cacheToken = getToken();
  state = { data: next ?? null, loading: false, error: false };
  fetchedAt = next ? Date.now() : 0;
  lastLoadAt = fetchedAt;
  inflight = null;
  if (writeReloadTimer) { clearTimeout(writeReloadTimer); writeReloadTimer = null; }
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
