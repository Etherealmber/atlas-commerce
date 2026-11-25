import { githubJson } from '../lib/github-json';
import { ensureReportTables, githubConfig, redactSecrets } from '../lib/reports';
import { rateLimit } from '../lib/security';
import { tableExists } from '../lib/schema';

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
    let userId: number | null = null;
    const isOwner = username === deps.ownerUsername(c.env) && session.role === 'owner';
    try {
      let role: string;
      if (isOwner) role = 'owner';
      else {
        const user = await c.env.DB.prepare('SELECT id, role, created_at FROM app_users WHERE username = ? AND active = 1').bind(username).first();
        if (!user) return c.json({ success: false, code: 'UNAUTHORIZED' }, 401);
        role = String(user.role || '');
        if (Number.isSafeInteger(user.id) && user.id > 0) userId = user.id;
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
    if (String(c.env.WORK_STATUS_GITHUB_ENABLED || '') !== 'false') {
      try {
        const ownerTable = await tableExists(c.env.DB, 'work_status_report_owners');
        if (!accountCreated && !(ownerTable && (isOwner || userId))) { github = unavailable('OWNERSHIP_UNVERIFIABLE'); } else {
        // Reports are delivered per app: Android → GITHUB_ISSUE_*, web → GITHUB_WEB_ISSUE_*.
        await ensureReportTables(c.env.DB);
        const REPO_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
        const configs = {
          android: await githubConfig(c.env, 'android'),
          web: await githubConfig(c.env, 'web'),
        };
        const usable = (cfg: { token: string; repo: string }) => Boolean(cfg.token) && REPO_RE.test(cfg.repo);
        if (usable(configs.android) || usable(configs.web)) {
          // Without explicit private-repo consent, make all reads anonymously so
          // a repo becoming private cannot expose privileged issue contents.
          const privateAllowed = String(c.env.WORK_STATUS_GITHUB_ENABLED || '') === 'true';
          const publicChecks = new Map<string, Promise<void>>();
          const ensurePublic = (repoName: string) => {
            if (privateAllowed) return Promise.resolve();
            let check = publicChecks.get(repoName);
            if (!check) {
              check = githubJson(`https://api.github.com/repos/${repoName}`, '').then((repo: any) => {
                if (repo?.private !== false || String(repo?.full_name || '').toLowerCase() !== repoName.toLowerCase() ||
                    (repo.visibility != null && repo.visibility !== 'public')) throw new Error('not_public');
              });
              publicChecks.set(repoName, check);
            }
            return check;
          };
          const { results } = ownerTable
            ? await c.env.DB.prepare(
              `SELECT id, issue_number, issue_url, channel FROM user_reports r WHERE status = 'linked' AND issue_number IS NOT NULL
               AND (EXISTS (SELECT 1 FROM work_status_report_owners o WHERE o.report_id = r.id AND
                    ((? = 1 AND o.owner_slot = 1) OR (? = 0 AND o.user_id = ?)))
                 OR (? = 0 AND lower(r.username) = ? AND r.created_at > ?
                     AND NOT EXISTS (SELECT 1 FROM work_status_report_owners o WHERE o.report_id = r.id)))
               AND (? IS NULL OR r.id < ?) ORDER BY r.id DESC LIMIT ?`
            ).bind(isOwner ? 1 : 0, isOwner ? 1 : 0, userId, isOwner ? 1 : 0, username, accountCreated, ghCursor, ghCursor, limit + 1).all()
            : await c.env.DB.prepare(
              `SELECT id, issue_number, issue_url, channel FROM user_reports WHERE lower(username) = ? AND status = 'linked'
               AND issue_number IS NOT NULL AND created_at > ? AND (? IS NULL OR id < ?) ORDER BY id DESC LIMIT ?`
            ).bind(username, accountCreated, ghCursor, ghCursor, limit + 1).all();
          const page = results.slice(0, limit);
          if (!page.length) {
            // No upstream call was made; do not imply the tracker is healthy or clear.
            github = unavailable('NO_LINKED_REPORTS');
          } else {
            const items = await Promise.all(page.map(async (r: any) => {
              const config = r.channel === 'web' ? configs.web : configs.android;
              if (!usable(config)) throw new Error('not_configured');
              await ensurePublic(config.repo);
              const issueToken = privateAllowed ? config.token : '';
              const number = Number(r.issue_number);
              const expectedPath = `/${config.repo}/issues/${number}`;
              const stored = new URL(String(r.issue_url));
              if (!Number.isSafeInteger(number) || number <= 0 || stored.protocol !== 'https:' ||
                  stored.hostname !== 'github.com' || stored.port || stored.username || stored.password ||
                  stored.pathname.toLowerCase() !== expectedPath.toLowerCase() || stored.search || stored.hash) throw new Error('link');
              const issue: any = await githubJson(`https://api.github.com/repos/${config.repo}/issues/${number}`, issueToken);
              const link = new URL(String(issue.html_url));
              if (issue.number !== number || issue.pull_request || !['open', 'closed'].includes(issue.state) ||
                  link.protocol !== 'https:' || link.hostname !== 'github.com' || link.port || link.username || link.password ||
                  link.pathname.toLowerCase() !== expectedPath.toLowerCase() || link.search || link.hash ||
                  typeof issue.title !== 'string' || typeof issue.updated_at !== 'string' || !Number.isFinite(Date.parse(issue.updated_at))) throw new Error('invalid');
              return { source: 'github', id: String(number), title: redactSecrets(issue.title).slice(0, 200), status: issue.state,
                updated_at: issue.updated_at, url: link.toString() };

            }));
            github = { availability: 'available', synced_at: new Date().toISOString(), items,
              next_cursor: results.length > limit ? String(page[page.length - 1].id) : null, error: null };
          }
        }
        }
      } catch {
        // Do not log URLs, usernames, tokens, upstream responses, or report text.
        github = unavailable(accountCreated || isOwner || userId ? 'SOURCE_UNAVAILABLE' : 'OWNERSHIP_UNVERIFIABLE');
      }
    }
    return c.json({ success: true, in_app: inApp, trackers: { github, linear: unavailable('NOT_CONFIGURED') } });
  });
}
