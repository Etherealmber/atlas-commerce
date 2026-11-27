// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../fingerprint', () => ({ getCachedFingerprint: async () => 'device' }));
import { clearToken, getRole, getToken, refreshSessionRole, setToken } from '../auth';
import { api } from '../api';

beforeEach(() => { localStorage.clear(); setToken('old-token', undefined, 'alice', 'admin'); });
afterEach(() => { clearToken(); vi.unstubAllGlobals(); });
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

it('refreshes a stale role once for concurrent requests and retries under the same account', async () => {
  const requests: string[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    requests.push(url);
    const auth = (init.headers as Record<string, string>).Authorization;
    if (url.endsWith('/api/auth/role-refresh')) return response({ success: true, data: { username: 'alice', role: 'user', token: 'new-token' } });
    return auth === 'Bearer old-token' ? response({ code: 'ROLE_CHANGED' }, 409) : response({ success: true, data: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  const events = vi.fn(); window.addEventListener('atlas-profile-changed', events);
  try {
    await Promise.all([api.getProducts({ q: 'first' }), api.getProducts({ q: 'second' })]);
    expect(requests.filter(x => x.endsWith('/api/auth/role-refresh'))).toHaveLength(1);
    expect(getRole()).toBe('user'); expect(getToken()).toBe('new-token'); expect(events).toHaveBeenCalled();
  } finally { window.removeEventListener('atlas-profile-changed', events); }
});

it('does not replace another account when a refresh finishes late', async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const pending = refreshSessionRole('old-token', 'device');
  setToken('bob-token', undefined, 'bob', 'stock');
  finish(response({ success: true, data: { username: 'alice', role: 'user', token: 'new-token' } }));
  expect(await pending).toBe('switched'); expect(getToken()).toBe('bob-token'); expect(getRole()).toBe('stock');
});

it('keeps the session on transient refresh failures', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => response({}, 503)));
  expect(await refreshSessionRole('old-token', 'device')).toBe('unavailable');
  expect(getToken()).toBe('old-token');
});

it('discards an in-flight old-account response after switching accounts', async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const request = api.getProducts({ q: 'old-account-response' });
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  setToken('bob-token', undefined, 'bob', 'stock');
  finish(response({ success: true, data: [{ name: 'private' }] }));
  await expect(request).rejects.toThrow('La session a changé');
  expect(getToken()).toBe('bob-token');
});

it('does not retry a D1 quota error or a server-requested cooldown', async () => {
  for (const [body, headers] of [
    [{ code: 'DB_QUOTA_EXCEEDED', error: 'Quota atteint' }, {}],
    [{ code: 'SERVICE_UNAVAILABLE', error: 'Initialisation en cours' }, { 'Retry-After': '3' }],
  ] as const) {
    const mock = vi.fn(async () => new Response(JSON.stringify(body), { status: 503, headers: { 'Content-Type': 'application/json', ...headers } }));
    vi.stubGlobal('fetch', mock);
    await expect(api.getDashboard()).rejects.toMatchObject({ code: body.code });
    expect(mock).toHaveBeenCalledTimes(1);
  }
});
