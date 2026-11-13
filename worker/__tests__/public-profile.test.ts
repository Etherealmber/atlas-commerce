import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { registerPublicRoutes } from '../routes/public';

afterEach(() => vi.unstubAllGlobals());

describe('public GitHub profile', () => {
  it('fetches the Etherealmber profile and repositories', async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(
      url.includes('/repos?') ? [{ name: 'atlas-commerce', fork: false }] : { login: 'Etherealmber' },
    ), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const app = new Hono();
    registerPublicRoutes(app);
    const response = await app.request('/api/public/github-profile');
    const body: any = await response.json();
    expect(body.data.user.login).toBe('Etherealmber');
    expect(body.data.repos).toHaveLength(1);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'https://api.github.com/users/Etherealmber',
      'https://api.github.com/users/Etherealmber/repos?sort=updated&per_page=20',
    ]);
  });

  it('returns the Etherealmber fallback when GitHub fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('unavailable')));
    const app = new Hono();
    registerPublicRoutes(app);
    const response = await app.request('/api/public/github-profile');
    const body: any = await response.json();
    expect(response.headers.get('X-Profile-Source')).toBe('fallback');
    expect(body.data.user.login).toBe('Etherealmber');
    expect(body.data.user.html_url).toBe('https://github.com/Etherealmber');
  });
});
