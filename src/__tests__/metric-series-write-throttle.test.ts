/**
 * D1 read budget: business writes must not force an immediate KPI reload.
 * Each /api/metrics/daily recompute costs the server ~20 aggregate queries,
 * so bursts of writes coalesce into one reload, at most every 30 s.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getMetricsDaily = vi.fn(async () => ({ data: { days: 7, dates: ['2026-10-20'], series: {}, kinds: {} } }));
vi.mock('../api', () => ({ api: { getMetricsDaily } }));
vi.mock('../auth', () => ({ getToken: () => 'tok' }));

const listeners = new Map<string, Set<() => void>>();
(globalThis as any).window = {
  addEventListener: (t: string, fn: () => void) => { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t)!.add(fn); },
  removeEventListener: (t: string, fn: () => void) => listeners.get(t)?.delete(fn),
};
(globalThis as any).document = { visibilityState: 'visible' };
const fireWrite = () => { for (const fn of listeners.get('atlas-lists-refresh') || []) fn(); };

const mod = await import('../lib/metricSeries');

describe('metric series reload after writes', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mod.__resetMetricSeries(null);
    getMetricsDaily.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it('coalesces a burst of writes into one delayed reload, respecting the minimum gap', async () => {
    const off = mod.subscribeMetricSeries(() => {});
    await vi.runOnlyPendingTimersAsync();
    expect(getMetricsDaily).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 25; i++) fireWrite(); // a scanning session
    await vi.advanceTimersByTimeAsync(mod.WRITE_RELOAD_DEBOUNCE_MS);
    expect(getMetricsDaily).toHaveBeenCalledTimes(1); // still inside the 30 s gap
    await vi.advanceTimersByTimeAsync(mod.WRITE_RELOAD_MIN_GAP_MS);
    expect(getMetricsDaily).toHaveBeenCalledTimes(2);

    fireWrite();
    await vi.advanceTimersByTimeAsync(mod.WRITE_RELOAD_MIN_GAP_MS + 1000);
    expect(getMetricsDaily).toHaveBeenCalledTimes(3);
    off();
  });

  it('does not reload when no chart is on screen', async () => {
    fireWrite();
    await vi.advanceTimersByTimeAsync(mod.WRITE_RELOAD_MIN_GAP_MS * 2);
    expect(getMetricsDaily).not.toHaveBeenCalled();
  });
});
