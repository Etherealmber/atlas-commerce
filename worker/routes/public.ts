import type { Hono } from 'hono';
import { apiFail, apiOk } from '../lib/api-response';

/** Public unauthenticated routes — safe for web + native shell. */
export function registerPublicRoutes(app: Hono<any>): void {
  app.get('/api/public/github-profile', async (c) => {
    const user = 'loxdpsy';
    try {
      const [uRes, rRes] = await Promise.all([
        fetch(`https://api.github.com/users/${user}`, {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'AtlasCommerce-About',
          },
        }),
        fetch(`https://api.github.com/users/${user}/repos?sort=updated&per_page=20`, {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'AtlasCommerce-About',
          },
        }),
      ]);
      if (!uRes.ok) {
        return apiFail(c, `GitHub user ${uRes.status}`, 'SERVICE_UNAVAILABLE');
      }
      const profile = await uRes.json();
      const repos = rRes.ok ? await rRes.json() : [];
      c.header('Cache-Control', 'public, max-age=600');
      return apiOk(c, {
        user: profile,
        repos: Array.isArray(repos) ? repos.filter((x: any) => !x.fork) : [],
      });
    } catch (e: any) {
      return apiFail(c, e?.message || 'GitHub fetch failed', 'SERVICE_UNAVAILABLE');
    }
  });
}
