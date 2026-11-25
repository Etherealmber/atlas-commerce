/**
 * v0.9.3 — reports are routed per app: web app → web repo with its own
 * secret (GITHUB_WEB_ISSUE_TOKEN), native Android → Android repo
 * (GITHUB_ISSUE_TOKEN). Plus the optional Groq triage of new issues.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  classifyReportChannel, ensureReportTables, githubConfig, listReports, reportCrash, reportUser,
  retryPendingReports, saveGithubConfig, WEB_REPORTS_REPO_DEFAULT,
} from '../lib/reports';
import { buildTriagePrompt, parseTriage, triageIssue, ISSUE_TRIAGE_DEFAULT_MODEL } from '../lib/issueTriage';

function makeD1() {
  const sqlite = new DatabaseSync(':memory:');
  const db = {
    prepare(sql: string) {
      let params: any[] = [];
      const api: any = {
        bind(...p: any[]) { params = p; return api; },
        async run() {
          const r = sqlite.prepare(sql).run(...(params as any));
          return { success: true, meta: { changes: Number(r.changes || 0), last_row_id: Number(r.lastInsertRowid || 0) } };
        },
        async first() { const r = sqlite.prepare(sql).get(...(params as any)); return r ? { ...(r as any) } : null; },
        async all() { return { results: sqlite.prepare(sql).all(...(params as any)).map((r: any) => ({ ...r })) }; },
      };
      return api;
    },
  };
  return { db: db as unknown as D1Database, sqlite };
}

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36';
const WEB_CRASH = {
  message: "Failed to execute 'contains' on 'Node': parameter 1 is not of type 'Node'.",
  stack: 'TypeError: x\n    at onPointerLeave (https://stock.afmarbre.com/assets/index-abc.js:1:2)\n    at a (r.js:1:1)',
  route: '/dashboard', version: '0.9.3-beta', ua: BROWSER_UA, platform: 'web',
};

let made: ReturnType<typeof makeD1>;
beforeEach(async () => { made = makeD1(); await ensureReportTables(made.db); });
afterEach(() => vi.unstubAllGlobals());

function stubGithub() {
  const posts: { url: string; body: any; auth: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    const u = String(url);
    if (u.includes('/search/issues')) return Response.json({ items: [] });
    if (u.endsWith('/labels')) return new Response('{}', { status: 422 });
    if (u.endsWith('/issues') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      posts.push({ url: u, body, auth: String(init.headers?.Authorization || '') });
      const repo = u.split('/repos/')[1].replace(/\/issues$/, '');
      return Response.json({ number: posts.length, html_url: `https://github.com/${repo}/issues/${posts.length}` }, { status: 201 });
    }
    return Response.json({});
  }));
  return posts;
}

describe('report channel classification', () => {
  it('explicit platform wins; browsers are web; native stacks and unknown are android', () => {
    expect(classifyReportChannel({ platform: 'web' })).toBe('web');
    expect(classifyReportChannel({ platform: 'android', ua: BROWSER_UA })).toBe('android');
    expect(classifyReportChannel({ ua: BROWSER_UA })).toBe('web');
    expect(classifyReportChannel({ ua: 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit Chrome/120 Mobile' })).toBe('android');
    expect(classifyReportChannel({ ua: 'okhttp/4.12.0' })).toBe('android');
    expect(classifyReportChannel({})).toBe('android');
  });
});

describe('separate secrets per channel', () => {
  it('web config uses GITHUB_WEB_ISSUE_TOKEN and the web repo by default', async () => {
    const env = { DB: made.db, GITHUB_ISSUE_TOKEN: 'android-tok', GITHUB_WEB_ISSUE_TOKEN: 'web-tok' };
    expect(await githubConfig(env, 'web')).toEqual({ token: 'web-tok', repo: WEB_REPORTS_REPO_DEFAULT, source: 'env' });
    expect((await githubConfig(env, 'android')).token).toBe('android-tok');
    expect((await githubConfig(env)).repo).toBe('Etherealmber/atlas-commerce-android');
  });

  it('the android token is never used for the web repo', async () => {
    expect(await githubConfig({ DB: made.db, GITHUB_ISSUE_TOKEN: 'android-tok' }, 'web'))
      .toEqual({ token: '', repo: WEB_REPORTS_REPO_DEFAULT, source: null });
  });

  it('in-app web token is stored separately', async () => {
    await saveGithubConfig(made.db, 'web-app-tok', 'Org/web', 'web');
    expect(await githubConfig({ DB: made.db }, 'web')).toEqual({ token: 'web-app-tok', repo: 'Org/web', source: 'app' });
    expect((await githubConfig({ DB: made.db }, 'android')).token).toBe('');
  });

  it('a web crash goes to the web repo with the web token', async () => {
    const posts = stubGithub();
    const out = await reportCrash(made.db, { DB: made.db, GITHUB_ISSUE_TOKEN: 'android-tok', GITHUB_WEB_ISSUE_TOKEN: 'web-tok' }, WEB_CRASH, '1.1.1.1');
    expect(out.issue_url).toBe(`https://github.com/${WEB_REPORTS_REPO_DEFAULT}/issues/1`);
    expect(posts[0].auth).toBe('Bearer web-tok');
    const row = made.sqlite.prepare('SELECT channel, status FROM crash_reports').get() as any;
    expect(row).toEqual({ channel: 'web', status: 'linked' });
  });

  it('web reports wait for the web secret, android ones drain with theirs', async () => {
    await reportCrash(made.db, { DB: made.db }, WEB_CRASH, '1.1.1.1');
    await reportUser(made.db, { DB: made.db }, { username: 'u', role: 'staff', kind: 'bug', message: 'Bouton bloqué (Android)', channel: 'android' });
    const posts = stubGithub();
    const first = await retryPendingReports({ DB: made.db, GITHUB_ISSUE_TOKEN: 'android-tok' });
    expect(first.by_channel.android.user_reports).toBe(1);
    expect(first.by_channel.web).toMatchObject({ crashes: 0, configured: false });
    expect((await listReports(made.db)).pending_by_channel).toEqual({ web: 1, android: 0 });
    const second = await retryPendingReports({ DB: made.db, GITHUB_ISSUE_TOKEN: 'android-tok', GITHUB_WEB_ISSUE_TOKEN: 'web-tok' });
    expect(second.by_channel.web.crashes).toBe(1);
    expect(posts.map((p) => p.url.includes(`/repos/${WEB_REPORTS_REPO_DEFAULT}/`))).toEqual([false, true]);
    expect((await listReports(made.db)).pending).toBe(0);
  });

  it('one drain opens a single issue per crash message (per-build fingerprints) and respects the subrequest budget', async () => {
    // Same bug, three builds → three fingerprints (different bundle frames).
    for (const [i, route] of ['/dashboard', '/settings', '/clients'].entries()) {
      await reportCrash(made.db, { DB: made.db }, { ...WEB_CRASH, route, stack: `TypeError: x\n    at onPointerLeave (https://stock.afmarbre.com/assets/index-b${i}.js:1:${i})` }, `1.1.1.${i}`);
    }
    for (let i = 0; i < 4; i++) {
      await reportCrash(made.db, { DB: made.db }, { ...WEB_CRASH, message: `Other bug ${i}`, stack: `Error\n    at f${i} (x.js:1:1)` }, `2.2.2.${i}`);
    }
    made.sqlite.exec(`UPDATE crash_reports SET last_seen = CASE WHEN message LIKE 'Failed to execute%' THEN '2026-10-20 10:00:00' ELSE '2026-10-19 10:00:00' END`);
    const posts = stubGithub();
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const out = await retryPendingReports({ DB: made.db, GITHUB_WEB_ISSUE_TOKEN: 'web-tok', REPORTS_SUBREQUEST_BUDGET: '12' });
    // Budget 12 / 4 per new crash issue = 3 new issues; the 3 contains rows share one.
    expect(posts.length).toBe(3);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(12);
    expect(out.more).toBe(true);
    const linked = made.sqlite.prepare("SELECT COUNT(DISTINCT issue_number) AS n, COUNT(*) AS c FROM crash_reports WHERE status = 'linked' AND message LIKE 'Failed to execute%'").get() as any;
    expect(linked).toEqual({ n: 1, c: 3 });
    const rest = await retryPendingReports({ DB: made.db, GITHUB_WEB_ISSUE_TOKEN: 'web-tok' });
    expect(rest.more).toBe(false);
    expect((await listReports(made.db)).pending).toBe(0);
  });

  it('queued browser crashes from before the split are moved to the web channel', async () => {
    const legacy = makeD1();
    legacy.sqlite.exec(`CREATE TABLE crash_reports (id INTEGER PRIMARY KEY AUTOINCREMENT, fingerprint TEXT NOT NULL UNIQUE, message TEXT NOT NULL DEFAULT '',
      stack TEXT NOT NULL DEFAULT '', component_stack TEXT NOT NULL DEFAULT '', route TEXT NOT NULL DEFAULT '', version TEXT NOT NULL DEFAULT '',
      ua TEXT NOT NULL DEFAULT '', ip_hash TEXT NOT NULL DEFAULT '', count INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'new',
      issue_number INTEGER, issue_url TEXT NOT NULL DEFAULT '', first_seen TEXT, last_seen TEXT);
      INSERT INTO crash_reports (fingerprint, ua, status) VALUES ('a', '${BROWSER_UA}', 'pending'), ('b', 'okhttp/4', 'pending'), ('c', '${BROWSER_UA}', 'linked');`);
    await ensureReportTables(legacy.db);
    const rows = legacy.sqlite.prepare('SELECT fingerprint, channel FROM crash_reports ORDER BY id').all().map((r: any) => `${r.fingerprint}:${r.channel}`);
    expect(rows).toEqual(['a:web', 'b:android', 'c:android']);
  });
});

describe('Groq issue triage (free tier friendly)', () => {
  const GOOD = JSON.stringify({
    title: 'Crash au survol du dock quand le pointeur quitte la fenêtre', summary: 'La page plante quand la souris sort du navigateur.',
    cause: 'relatedTarget vaut window, contains() exige un Node.', where: 'src/App.tsx onPointerLeave', fix: 'Vérifier instanceof Node.',
    severity: 'high', area: 'ui',
  });

  it('builds a compact prompt without personal data', () => {
    const prompt = buildTriagePrompt({ kind: 'crash', channel: 'web', message: 'boom', stack: 'at a\n'.repeat(200), route: '/x', version: '1' });
    expect(prompt.length).toBeLessThan(2600);
    expect(prompt).toContain('app web');
  });

  it('parses and validates the JSON answer', () => {
    const t = parseTriage('```json\n' + GOOD + '\n```', 'm');
    expect(t).toMatchObject({ severity: 'high', area: 'ui', model: 'm' });
    expect(parseTriage(JSON.stringify({ title: 'x', summary: 'y', severity: 'nope', area: 'zzz' }), 'm')).toMatchObject({ severity: 'medium', area: 'other' });
    expect(parseTriage('not json', 'm')).toBeNull();
  });

  it('skips without a key, respects the daily cap and pauses on 429', async () => {
    const input = { kind: 'crash' as const, channel: 'web' as const, message: 'boom' };
    let calls = 0;
    const ok = async () => { calls++; return Response.json({ choices: [{ message: { content: GOOD } }] }); };
    expect(await triageIssue({ DB: made.db }, input, ok)).toBeNull();
    expect(calls).toBe(0);

    const env = { DB: made.db, GROQ_API_KEY: 'gsk_x', GROQ_ISSUES_DAILY_LIMIT: '2' };
    const first = await triageIssue(env, input, ok);
    expect(first?.model).toBe(ISSUE_TRIAGE_DEFAULT_MODEL);
    await triageIssue(env, input, ok);
    expect(await triageIssue(env, input, ok)).toBeNull();
    expect(calls).toBe(2);

    const fresh = makeD1(); await ensureReportTables(fresh.db);
    const env2 = { DB: fresh.db, GROQ_ISSUES_API_KEY: 'gsk_y' };
    let limited = 0;
    const tooMany = async () => { limited++; return new Response('{}', { status: 429, headers: { 'retry-after': '120' } }); };
    expect(await triageIssue(env2, input, tooMany)).toBeNull();
    expect(await triageIssue(env2, input, tooMany)).toBeNull();
    expect(limited).toBe(1);
  });

  it('a triaged crash gets the AI title, analysis and severity label', async () => {
    const posts: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
      const u = String(url);
      if (u.includes('api.groq.com')) {
        const req = JSON.parse(init.body);
        expect(req.model).toBe(ISSUE_TRIAGE_DEFAULT_MODEL);
        expect(req.max_tokens).toBeLessThanOrEqual(700);
        return Response.json({ choices: [{ message: { content: GOOD } }] });
      }
      if (u.includes('/search/issues')) return Response.json({ items: [] });
      if (u.endsWith('/labels')) return new Response('{}', { status: 201 });
      if (u.endsWith('/issues')) { posts.push(JSON.parse(init.body)); return Response.json({ number: 7, html_url: `https://github.com/${WEB_REPORTS_REPO_DEFAULT}/issues/7` }, { status: 201 }); }
      return Response.json({});
    }));
    await reportCrash(made.db, { DB: made.db, GITHUB_WEB_ISSUE_TOKEN: 'web-tok', GROQ_API_KEY: 'gsk_x' }, WEB_CRASH, '2.2.2.2');
    expect(posts[0].title).toMatch(/^\[crash [0-9a-f]{16}\] Crash au survol du dock/);
    expect(posts[0].body).toContain('### Analyse automatique');
    expect(posts[0].labels).toEqual(expect.arrayContaining(['crash-report', 'severity:high', 'area:ui']));
  });
});
