// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../fingerprint', () => ({ getCachedFingerprint: async () => 'device' }));
vi.mock('../lib/crashReporter', () => ({ reportCrash: vi.fn() }));
import { api } from '../api';
import { setToken, clearToken } from '../auth';
import { reportCrash } from '../lib/crashReporter';

beforeEach(() => { localStorage.clear(); setToken('token', undefined, 'alice', 'admin'); });
afterEach(() => { clearToken(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
it('reports exhausted schema initialization without forwarding a request URL or data', async () => {
  const mock = vi.fn(async () => new Response(JSON.stringify({ success: false, code: 'SERVICE_UNAVAILABLE', error: 'Initialisation en cours. Réessayez dans quelques instants.', details: { reason: 'SCHEMA_INITIALIZING' } }), { status: 503, headers: { 'Retry-After': '3' } }));
  vi.stubGlobal('fetch', mock);
  await expect(api.getProducts({ q: 'private-product' })).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  expect(mock).toHaveBeenCalledTimes(1);
  expect(reportCrash).toHaveBeenCalledOnce();
  expect(vi.mocked(reportCrash).mock.calls[0][0]).toMatchObject({ message: 'Initialisation du schéma indisponible après attente' });
  expect(vi.mocked(reportCrash).mock.calls[0][1]).toEqual({ route: '/application' });
});
it('does not report unrelated service errors as migration problems', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, code: 'DB_QUOTA_EXCEEDED', error: 'Quota' }), { status: 503 })));
  await expect(api.getDashboard()).rejects.toMatchObject({ code: 'DB_QUOTA_EXCEEDED' });
  expect(reportCrash).not.toHaveBeenCalled();
});
