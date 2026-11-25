import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Data scope for per-isolate memory caches.
 *
 * Demo sessions (« test / test ») run the very same Hono app against their own
 * SQLite database. Any module-level memo (memory cache, "schema already
 * ensured" flags, recent metrics…) must therefore be keyed by the database the
 * request is served from, otherwise a demo request could reuse production data
 * (or the opposite). Production requests run in the default empty scope, so
 * their keys are unchanged.
 */
const als = new AsyncLocalStorage<string>();

export function currentDataScope(): string {
  return als.getStore() || '';
}

export function runInDataScope<T>(scope: string, fn: () => T): T {
  return als.run(scope, fn);
}

/** Prefix a memo/cache key with the current data scope (no-op in production). */
export function scopedKey(key: string): string {
  const scope = als.getStore();
  return scope ? `${scope}|${key}` : key;
}

/** True while serving a demo sandbox request. */
export function inDemoScope(): boolean {
  return (als.getStore() || '').startsWith('demo:');
}
