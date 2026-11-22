import { describe, expect, it } from 'vitest';
import { MobileHub } from '../durable/MobileHub';
import { doCacheGet, doCachePut, invalidateDashboardCache } from '../lib/cache';

function makeDoNamespace() {
  const values = new Map<string, unknown>();
  const state: any = {
    storage: {
      async get(keyOrKeys: string | string[]) {
        if (Array.isArray(keyOrKeys)) {
          return new Map(keyOrKeys.filter((k) => values.has(k)).map((k) => [k, values.get(k)]));
        }
        return values.get(keyOrKeys);
      },
      async put(keyOrPatch: string | Record<string, unknown>, val?: unknown) {
        if (typeof keyOrPatch === 'string') {
          values.set(keyOrPatch, val);
          return;
        }
        for (const [k, v] of Object.entries(keyOrPatch)) values.set(k, v);
      },
    },
  };
  const hub = new MobileHub(state, {} as any);
  const ns: any = {
    idFromName: (name: string) => name,
    get: () => ({
      fetch: (url: string | Request, init?: RequestInit) =>
        hub.fetch(url instanceof Request ? url : new Request(url, init)),
    }),
  };
  return { hub, ns, values };
}

describe('MobileHub shared snapshot cache (offloads D1 and KV limits)', () => {
  it('stores, serves, and invalidates high-refresh snapshots via Durable Object without using KV', async () => {
    const { ns } = makeDoNamespace();
    let kvGets = 0;
    let kvPuts = 0;
    const kv: any = {
      get: async () => { kvGets += 1; return null; },
      put: async () => { kvPuts += 1; },
    };

    expect(await doCacheGet(ns, kv, 'nav-badges', 300)).toBeNull();
    await doCachePut(ns, kv, 'nav-badges', { invoices_unpaid: 4, vr_open: 2 }, 300);

    const hit = await doCacheGet<{ invoices_unpaid: number; vr_open: number }>(ns, kv, 'nav-badges', 300);
    expect(hit).toEqual({ invoices_unpaid: 4, vr_open: 2 });
    expect(kvGets).toBe(0);
    expect(kvPuts).toBe(0);

    await invalidateDashboardCache(undefined, ns);
    expect(await doCacheGet(ns, kv, 'nav-badges', 300)).toBeNull();
  });
});
