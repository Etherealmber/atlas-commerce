// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api';
vi.mock('../fingerprint', () => ({ getCachedFingerprint: async () => 'test' }));
afterEach(() => { vi.unstubAllGlobals(); });
it('does not reuse an in-flight mobile catalog request after a write', async () => {
  const responses: ((response: Response) => void)[] = [];
  const fetcher = vi.fn(() => new Promise<Response>(resolve => responses.push(resolve)));
  vi.stubGlobal('fetch', fetcher);
  const oldRequest = api.getProducts({ fields: 'mobile', limit: 400 });
  const freshRequest = api.getProducts({ fields: 'mobile', limit: 400 });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(fetcher.mock.calls.every((call: any) => call[1].cache === 'no-store')).toBe(true);
  responses[1](new Response(JSON.stringify({ data: [{ id: 2 }] }), { status: 200 }));
  responses[0](new Response(JSON.stringify({ data: [{ id: 1 }] }), { status: 200 }));
  expect((await freshRequest).data[0].id).toBe(2); expect((await oldRequest).data[0].id).toBe(1);
});
it('bypasses browser and in-flight caches for explicitly refreshed activity', async () => {
  const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ data: [] }), { status: 200 })); vi.stubGlobal('fetch', fetcher);
  await api.listMobileActions({ status: 'all', limit: 40, noStore: true });
  expect(fetcher.mock.calls[0][1]).toEqual(expect.objectContaining({ cache: 'no-store' }));
});
