import { githubConfig, redactSecrets } from '../lib/reports';
import { rateLimit } from '../lib/security';

const integer = (v: string | null, fallback: number | null, max: number) => {
  if (v === null) return fallback;
  if (!/^[1-9]\d*$/.test(v)) return NaN;
  const n = Number(v);
  return Number.isSafeInteger(n) && n <= max ? n : NaN;
};

const unavailable = (error: string) => ({ availability: 'unavailable', synced_at: null, items: [], next_cursor: null, error });

// The outer API middleware must verify the session before this route runs.
export function registerWorkStatusRoute(app: any, deps: {
  session: (header: string | undefined) => { username: string; role: string };
  ownerUsername: (env: any) => string;
}) {
  app.get('/api/mobile/work-status', async (c: any) => {
    c.header('Cache-Control', 'no-store');
    c.header('CDN-Cache-Control', 'no-store');
    const session = deps.session(c.req.header('Authorization'));
    const username = String(session.username || '').toLowerCase();
    if (!username) return c.json({ success: false, code: 'UNAUTHORIZED' }, 401);
    // Do not trust the token's role claim: compare with the authoritative account.
    let accountCreated: string | null = null;
    try {
      let role: string;
      if (username === deps.ownerUsername(c.env) && session.role === 'owner') role = 'owner';
      else {
        const user = await c.env.DB.prepare('SELECT role, created_at FROM app_users WHERE username = ? AND active = 1').bind(username).first();
        if (!user) return c.json({ success: false, code: 'UNAUTHORIZED' }, 401);
        role = String(user.role || '');
        const created = String(user.created_at || '');
        if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(created) && Number.isFinite(Date.parse(created + 'Z'))) accountCreated = created;
      }
      if (role !== session.role || !['owner', 'admin', 'secretaire', 'stock', 'user'].includes(role)) {
        return c.json({ success: false, code: 'UNAUTHORIZED' }, 401);
      }
    } catch {
      return c.json({ success: false, code: 'AUTH_UNAVAILABLE' }, 503);
    }
    const rl = await rateLimit(c.env.CACHE, `work-status:${username}`, 30, 60);
    if (!rl.ok) {
      c.header('Retry-After', String(rl.retryAfter || 60));
      return c.json({ success: false, code: 'RATE_LIMITED', retry_after: rl.retryAfter }, 429);
    }
    const params = new URL(c.req.url).searchParams;
    if ([...params.keys()].some(k => !['limit', 'in_app_cursor', 'github_cursor'].includes(k)) ||
        ['limit', 'in_app_cursor', 'github_cursor'].some(k => params.getAll(k).length > 1)) {
      return c.json({ success: false, code: 'INVALID_QUERY' }, 400);
    }
    const limit = integer(params.get('limit'), 5, 5)!;
    const inCursor = integer(params.get('in_app_cursor'), null, Number.MAX_SAFE_INTEGER);
    const ghCursor = integer(params.get('github_cursor'), null, Number.MAX_SAFE_INTEGER);
    if ([limit, inCursor, ghCursor].some(v => v !== null && Number.isNaN(v))) {
      return c.json({ success: false, code: 'INVALID_QUERY' }, 400);
    }
    let inApp: any;
    try {
      if (!accountCreated) throw new Error('ownership');
      const { results } = await c.env.DB.prepare(
        `SELECT id, product_name, status FROM stock_adjustment_requests
         WHERE lower(requested_by) = ? AND requested_at > ? AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?`
      ).bind(username, accountCreated, inCursor, inCursor, limit + 1).all();
      const page = results.slice(0, limit);
      inApp = { availability: 'available', synced_at: new Date().toISOString(), items: page.map((r: any) => ({
        source: 'stock_adjustment_request', id: String(r.id), title: r.product_name || null,
        status: r.status, updated_at: null,
      })), next_cursor: results.length > limit ? String(page[page.length - 1].id) : null, error: null };
    } catch {
      inApp = unavailable(accountCreated ? 'SOURCE_UNAVAILABLE' : 'OWNERSHIP_UNVERIFIABLE');
    }

    let github: any = unavailable('NOT_CONFIGURED');
    if (String(c.env.WORK_STATUS_GITHUB_ENABLED || '') === 'true') {
      try {
        if (!accountCreated) throw new Error('ownership');
        const config = await githubConfig(c.env);
        if (config.token && /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(config.repo)) {
          const { results } = await c.env.DB.prepare(
            `SELECT id, issue_number, issue_url FROM user_reports WHERE lower(username) = ? AND status = 'linked'
             AND issue_number IS NOT NULL AND created_at > ? AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?`
          ).bind(username, accountCreated, ghCursor, ghCursor, limit + 1).all();
          const page = results.slice(0, limit);
          if (!page.length) {
            // No upstream call was made; do not imply the tracker is healthy or clear.
            github = unavailable('NO_LINKED_REPORTS');
          } else {
            const items = await Promise.all(page.map(async (r: any) => {
              const number = Number(r.issue_number);
              const expectedPath = `/${config.repo}/issues/${number}`;
              const stored = new URL(String(r.issue_url));
              if (!Number.isSafeInteger(number) || number <= 0 || stored.protocol !== 'https:' ||
                  stored.hostname !== 'github.com' || stored.port || stored.username || stored.password ||
                  stored.pathname.toLowerCase() !== expectedPath.toLowerCase() || stored.search || stored.hash) throw new Error('link');
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), 4000);
              try {
                const response = await fetch(`https://api.github.com/repos/${config.repo}/issues/${number}`, {
                  headers: { Authorization: `Bearer ${config.token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'atlas-commerce-work-status' },
                  redirect: 'error', signal: controller.signal,
                });
                if (!response.ok) throw new Error('upstream');
                // Bound the body as well as the request duration; never return issue bodies.
                const reader = response.body?.getReader();
                if (!reader) throw new Error('empty');
                const chunks: Uint8Array[] = [];
                let bytes = 0;
                while (true) {
                  // Sequential reads enforce a strict streaming size limit.
                  // eslint-disable-next-line no-await-in-loop
                  const part = await reader.read();
                  if (part.done) break;
                  bytes += part.value.length;
                  if (bytes > 65536) {
                    controller.abort();
                    throw new Error('oversize');
                  }
                  chunks.push(part.value);
                }
                const data = new Uint8Array(bytes);
                let offset = 0;
                for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
                const issue: any = JSON.parse(new TextDecoder().decode(data));
                const link = new URL(String(issue.html_url));
                if (issue.number !== number || issue.pull_request || !['open', 'closed'].includes(issue.state) ||
                    link.protocol !== 'https:' || link.hostname !== 'github.com' || link.port || link.username || link.password ||
                    link.pathname.toLowerCase() !== expectedPath.toLowerCase() || link.search || link.hash ||
                    typeof issue.title !== 'string' || typeof issue.updated_at !== 'string' || !Number.isFinite(Date.parse(issue.updated_at))) throw new Error('invalid');
                return { source: 'github', id: String(number), title: redactSecrets(issue.title).slice(0, 200), status: issue.state,
                  updated_at: issue.updated_at, url: link.toString() };
              } finally { clearTimeout(timer); }
            }));
            github = { availability: 'available', synced_at: new Date().toISOString(), items,
              next_cursor: results.length > limit ? String(page[page.length - 1].id) : null, error: null };
          }
        }
      } catch {
        // Do not log URLs, usernames, tokens, upstream responses, or report text.
        github = unavailable(accountCreated ? 'SOURCE_UNAVAILABLE' : 'OWNERSHIP_UNVERIFIABLE');
      }
    }
    return c.json({ success: true, in_app: inApp, trackers: { github, linear: unavailable('NOT_CONFIGURED') } });
  });
}
