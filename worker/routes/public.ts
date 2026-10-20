import type { Hono } from 'hono';
import { apiOk } from '../lib/api-response';

/**
 * Static fallback profile — served only when GitHub is unreachable AND no
 * cached copy exists. Keeps the About/credit screen functional; this is a
 * display-only public endpoint, so it must never 5xx.
 */
const FALLBACK_PROFILE = {
  user: {
    login: 'loxdpsy',
    name: 'loxdpy',
    html_url: 'https://github.com/loxdpsy',
    avatar_url: 'https://github.com/loxdpsy.png',
    bio: null,
    public_repos: 0,
    followers: 0,
    following: 0,
    created_at: null,
  },
  repos: [] as any[],
};

const CACHE_KEY = 'public:github-profile:loxdpsy';
const CACHE_TTL_SECONDS = 21600; // 6h — also keeps us far below GitHub's 60 req/h anonymous limit
const FETCH_TIMEOUT_MS = 4000;

/** Public unauthenticated routes — safe for web + native shell. */
export function registerPublicRoutes(app: Hono<any>): void {
  app.get('/api/public/github-profile', async (c) => {
    const kv = c.env?.CACHE as KVNamespace | undefined;

    // 1) Fresh KV cache hit → serve immediately (no GitHub call at all)
    if (kv) {
      try {
        const cached = await kv.get(CACHE_KEY);
        if (cached) {
          c.header('Cache-Control', 'public, max-age=600');
          c.header('X-Profile-Source', 'cache');
          return apiOk(c, JSON.parse(cached));
        }
      } catch { /* KV read failure — fall through to live fetch */ }
    }

    // 2) Live GitHub fetch with a hard timeout
    try {
      const headers = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'AtlasCommerce-About',
      };
      // AbortSignal.timeout where supported; degrade gracefully elsewhere
      const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(FETCH_TIMEOUT_MS)
        : undefined;
      const opts: RequestInit = signal ? { headers, signal } : { headers };
      const [uRes, rRes] = await Promise.all([
        fetch('https://api.github.com/users/loxdpsy', opts),
        fetch('https://api.github.com/users/loxdpsy/repos?sort=updated&per_page=20', opts),
      ]);
      if (!uRes.ok) throw new Error(`GitHub user ${uRes.status}`);
      const profile = await uRes.json();
      let repos: any[] = [];
      try {
        if (rRes.ok) {
          const raw = await rRes.json();
          if (Array.isArray(raw)) repos = raw.filter((x: any) => !x.fork);
        }
      } catch { /* repo list is decorative — ignore */ }

      const payload = { user: profile, repos };
      // Persist for the next 6h without delaying the response
      if (kv) {
        c.executionCtx.waitUntil(
          kv.put(CACHE_KEY, JSON.stringify(payload), { expirationTtl: CACHE_TTL_SECONDS }).catch(() => {}),
        );
      }
      c.header('Cache-Control', 'public, max-age=600');
      c.header('X-Profile-Source', 'live');
      return apiOk(c, payload);
    } catch {
      // 3) Never 503 on a display endpoint — serve the static fallback
      c.header('Cache-Control', 'public, max-age=60');
      c.header('X-Profile-Source', 'fallback');
      return apiOk(c, FALLBACK_PROFILE);
    }
  });
}
