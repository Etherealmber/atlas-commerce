/**
 * Frontend performance helpers — debounce, in-flight request dedupe, short GET cache.
 * Keep dependencies zero (no React Query required on free-tier stack).
 */
import { useEffect, useState } from 'react';

/** Debounce a value (search boxes, autocomplete). Default 300ms. */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/** Classic function debounce (for event handlers). */
export function debounce<T extends (...args: any[]) => void>(fn: T, wait = 300): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  }) as T;
}

type CacheEntry = { expires: number; data: unknown };

const inflight = new Map<string, Promise<unknown>>();
const getCache = new Map<string, CacheEntry>();

/** Max entries to avoid unbounded memory on long sessions */
const MAX_CACHE = 80;

/**
 * Deduplicate concurrent identical GET requests and optionally cache successful
 * responses for `ttlMs` (stale-while-revalidate style for low-volatility data).
 */
export function dedupedGet<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs = 0
): Promise<T> {
  if (ttlMs > 0) {
    const hit = getCache.get(key);
    if (hit && hit.expires > Date.now()) {
      return Promise.resolve(hit.data as T);
    }
  }
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;

  const p = fetcher()
    .then((data) => {
      if (ttlMs > 0) {
        if (getCache.size >= MAX_CACHE) {
          const first = getCache.keys().next().value;
          if (first != null) getCache.delete(first);
        }
        getCache.set(key, { expires: Date.now() + ttlMs, data });
      }
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, p);
  return p;
}

/** Drop cached GET entries (call after mutations that invalidate lists). */
export function invalidateGetCache(prefix?: string) {
  if (!prefix) {
    getCache.clear();
    return;
  }
  for (const k of [...getCache.keys()]) {
    if (k.startsWith(prefix)) getCache.delete(k);
  }
}
