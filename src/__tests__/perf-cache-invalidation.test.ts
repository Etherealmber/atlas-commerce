import { afterEach, describe, expect, it, vi } from 'vitest';
import { dedupedGet, invalidateGetCache, peekFreshGet } from '../lib/perf';

afterEach(() => { invalidateGetCache(); vi.useRealTimers(); });
describe('session-scoped fresh cache', () => {
  it('only exposes fresh cached data for its exact session key', async () => {
    vi.useFakeTimers();
    await dedupedGet('GET:/api/settings:session:a', async () => ({ data: { name: 'A' } }), 100);
    expect(peekFreshGet('GET:/api/settings:session:a')).toEqual({ data: { name: 'A' } });
    expect(peekFreshGet('GET:/api/settings:session:b')).toBeUndefined();
    vi.advanceTimersByTime(101);
    expect(peekFreshGet('GET:/api/settings:session:a')).toBeUndefined();
  });
  it('does not reuse or repopulate an invalidated in-flight response', async () => {
    const key = 'GET:/api/settings:session:a';
    let resolveOld!: (v: string) => void;
    const old = dedupedGet(key, () => new Promise<string>(resolve => { resolveOld = resolve; }), 1000);
    invalidateGetCache('GET:/api/settings');
    let resolveNew!: (v: string) => void;
    const fresh = dedupedGet(key, () => new Promise<string>(resolve => { resolveNew = resolve; }), 1000);
    resolveOld('old'); await old;
    expect(peekFreshGet(key)).toBeUndefined();
    expect(dedupedGet(key, async () => 'unwanted', 1000)).toBe(fresh);
    resolveNew('new'); await fresh;
    expect(peekFreshGet(key)).toBe('new');
  });
});
