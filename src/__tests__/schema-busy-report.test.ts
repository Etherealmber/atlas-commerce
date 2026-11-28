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
  expect(mock).toHaveBeenCalledTimes(2);
  expect(reportCrash).toHaveBeenCalledOnce();
  expect(vi.mocked(reportCrash).mock.calls[0][0]).toMatchObject({ message: 'Initialisation du schéma indisponible après attente' });
  expect(vi.mocked(reportCrash).mock.calls[0][1]).toEqual({ route: '/application', componentStack: expect.stringContaining('migration=unknown; phase=unknown; age=unknown') });
});
it('does not report unrelated service errors as migration problems', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, code: 'DB_QUOTA_EXCEEDED', error: 'Quota' }), { status: 503 })));
  await expect(api.getDashboard()).rejects.toMatchObject({ code: 'DB_QUOTA_EXCEEDED' });
  expect(reportCrash).not.toHaveBeenCalled();
});

it('retries a confirmed schema-busy GET once after the server cooldown and avoids a false crash report on recovery', async () => {
  vi.useFakeTimers();
  try {
    const busy = () => new Response(JSON.stringify({ success: false, code: 'SERVICE_UNAVAILABLE', details: { reason: 'SCHEMA_INITIALIZING' } }), { status: 503, headers: { 'Retry-After': '1' } });
    const mock = vi.fn().mockResolvedValueOnce(busy()).mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }));
    vi.stubGlobal('fetch', mock);
    const request = api.getProducts({ q: 'recovery-test' });
    await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1000);
    await expect(request).resolves.toMatchObject({ success: true });
    expect(mock).toHaveBeenCalledTimes(2);
    expect(reportCrash).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

it('never retries a mutation on a schema-busy response', async () => {
  const mock = vi.fn(async () => new Response(JSON.stringify({ success: false, code: 'SERVICE_UNAVAILABLE', details: { reason: 'SCHEMA_INITIALIZING' } }), { status: 503, headers: { 'Retry-After': '3' } }));
  vi.stubGlobal('fetch', mock);
  await expect(api.createReceipt({ client_name: 'Test', amount: 10 } as any)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  expect(mock).toHaveBeenCalledOnce();
  expect(reportCrash).toHaveBeenCalledOnce();
});

it('allowlists diagnostic metadata rather than forwarding attacker-controlled values', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: false, code: 'SERVICE_UNAVAILABLE', details: { reason: 'SCHEMA_INITIALIZING', migration: 'auto_sql_migrations_0013_0020', phase: 'payroll', age: 'over_5m', secret: 'private' } }), { status: 503 })));
  await expect(api.createReceipt({} as any)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  const ctx = vi.mocked(reportCrash).mock.calls[0][1]!;
  expect(ctx.componentStack).toContain('migration=auto_sql_migrations_0013_0020; phase=payroll; age=over_5m');
  expect(JSON.stringify(ctx)).not.toContain('private');
});
