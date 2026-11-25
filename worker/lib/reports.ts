import { githubJson } from './github-json';
import { tableExists, schemaOnceForDb, addColumnIfMissing } from './schema';
import { triageIssue, triageLabels, triageMarkdown, type TriageEnv, type TriageInput } from './issueTriage';

/**
 * v260 — Crash reporting & user reports → GitHub issues.
 *
 * Two queues, one sink:
 *  - crash_reports: automatic, sent by the app's global error handlers
 *    (window error / unhandledrejection / ErrorBoundary). Public endpoint but
 *    rate-limited, size-capped, deduplicated by fingerprint and SANITIZED —
 *    tokens, JWTs, API keys and atlas_ keys are redacted before anything is
 *    stored or forwarded.
 *  - user_reports: explicit "Signaler un problème" submissions from logged-in
 *    users (any role).
 *
 * GitHub sync: when a token is available (env GITHUB_ISSUE_TOKEN secret or the
 * owner-configured app_config value — set in-app, never echoed back), each
 * report becomes an issue in the configured repo (default
 * Etherealmber/atlas-commerce) with labels crash-report / user-report.
 * Crashes are deduplicated against OPEN issues carrying the fingerprint in
 * the title, so one bug = one issue (occurrence count kept in D1).
 * Without a token everything queues in D1 with status 'new'/'pending' and
 * retryPendingReports() (daily cron + owner button) drains the queue once the
 * token is configured. No report is ever lost, no CLI needed.
 *
 * Privacy: crash IPs are stored as a truncated SHA-256 (abuse control only);
 * user reports store only the reporting account's own username/role.
 *
 * v0.9.3 — two delivery channels, two secrets:
 *  - `android` (native app) → GITHUB_ISSUE_TOKEN / GITHUB_ISSUE_REPO
 *    (default Etherealmber/atlas-commerce-android) — unchanged;
 *  - `web` (browser app, desktop or phone) → GITHUB_WEB_ISSUE_TOKEN /
 *    GITHUB_WEB_ISSUE_REPO (default Etherealmber/atlas-commerce).
 *  Each row stores its channel; a channel without a token keeps its rows
 *  queued until that secret exists. New issues can be triaged by Groq
 *  (issueTriage.ts) when a key is configured.
 */

/** v0.7 — crash/user reports come FROM the apps: issues land in the ANDROID repo. */
export const REPORTS_REPO_DEFAULT = 'Etherealmber/atlas-commerce-android';
/** Pre-0.7 default (web repo): migrated on read so old saved configs follow. */
export const REPORTS_REPO_LEGACY = 'Etherealmber/atlas-commerce';
/** Resolve the delivery repo: explicit override wins, legacy default migrates. */
export function resolveReportsRepo(configured?: string | null): string {
  const raw = String(configured || '').trim();
  if (!raw || raw === REPORTS_REPO_LEGACY) return REPORTS_REPO_DEFAULT;
  return raw;
}
/** Web app reports land in the web repo (own secret, see header). */
export const WEB_REPORTS_REPO_DEFAULT = 'Etherealmber/atlas-commerce';
export type ReportChannel = 'web' | 'android';

/**
 * Which app sent the report. Explicit `platform`/`client` wins; otherwise a
 * real browser UA (Mozilla…, not an Android WebView) means the web app, and
 * native HTTP stacks (okhttp, Dalvik…) or unknown clients mean Android — the
 * historical default, so existing rows/tests keep their routing.
 */
export function classifyReportChannel(hint: { platform?: unknown; client?: unknown; ua?: unknown; headerUa?: unknown }): ReportChannel {
  const explicit = String(hint.platform || hint.client || '').trim().toLowerCase();
  if (explicit === 'web' || explicit === 'browser' || explicit === 'desktop' || explicit === 'pwa') return 'web';
  if (['android', 'native', 'apk', 'okhttp', 'app'].includes(explicit)) return 'android';
  const ua = String(hint.ua || hint.headerUa || '').toLowerCase();
  if (!ua) return 'android';
  if (/okhttp|dalvik|retrofit|atlas-android|; wv\)/.test(ua)) return 'android';
  if (ua.startsWith('mozilla/')) return 'web';
  return 'android';
}

const LABEL_CRASH = 'crash-report';
const LABEL_USER = 'user-report';
const LABEL_FROM_APP = 'from-app';

/** Once per D1 binding per isolate — the DDL below is idempotent, so
 *  re-running it on every request only cost D1 round-trips. */
export async function ensureReportTables(db: D1Database): Promise<void> {
  await schemaOnceForDb(db, 'ensureReportTables', () => ensureReportTablesBody(db));
}

async function ensureReportTablesBody(db: D1Database): Promise<void> {
  await db.prepare(`CREATE TABLE IF NOT EXISTS crash_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fingerprint TEXT NOT NULL UNIQUE,
    message TEXT NOT NULL DEFAULT '',
    stack TEXT NOT NULL DEFAULT '',
    component_stack TEXT NOT NULL DEFAULT '',
    route TEXT NOT NULL DEFAULT '',
    version TEXT NOT NULL DEFAULT '',
    ua TEXT NOT NULL DEFAULT '',
    ip_hash TEXT NOT NULL DEFAULT '',
    count INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'new',
    issue_number INTEGER,
    issue_url TEXT NOT NULL DEFAULT '',
    first_seen TEXT DEFAULT (datetime('now')),
    last_seen TEXT DEFAULT (datetime('now'))
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS user_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'bug',
    message TEXT NOT NULL DEFAULT '',
    contact TEXT NOT NULL DEFAULT '',
    page TEXT NOT NULL DEFAULT '',
    version TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new',
    issue_number INTEGER,
    issue_url TEXT NOT NULL DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now'))
  )`).run();
  // v0.9.3 — delivery channel (web / android). Legacy rows were all sent to
  // the Android repo, so they default to 'android'…
  await addColumnIfMissing(db, 'crash_reports', 'channel', `TEXT NOT NULL DEFAULT 'android'`);
  await addColumnIfMissing(db, 'user_reports', 'channel', `TEXT NOT NULL DEFAULT 'android'`);
  // …except crashes still waiting in the queue that clearly came from a
  // browser: they belong to the web repo. Idempotent, runs once per isolate.
  try {
    await db.prepare(`UPDATE crash_reports SET channel = 'web'
      WHERE channel = 'android' AND status != 'linked' AND lower(ua) LIKE 'mozilla/%'
        AND lower(ua) NOT LIKE '%; wv)%' AND lower(ua) NOT LIKE '%okhttp%'`).run();
  } catch { /* column just added on a busy DB — next isolate retries */ }
}

/* ─────────────────────────── sanitization ─────────────────────────── */

/** Anything that looks like a credential gets redacted before storage/sync. */
const SECRET_PATTERNS: RegExp[] = [
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /github_pat_[A-Za-z0-9_]+/g,
  /\bghp_[A-Za-z0-9]+/g,
  /\bgho_[A-Za-z0-9]+/g,
  /\batlas_[A-Za-z0-9]+/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bgsk_[A-Za-z0-9]+/g,
  /\bre_[A-Za-z0-9_]{16,}/g,
  // JWT-ish triples
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  // long base64/hex blobs (data URLs, keys)
  /\b[A-Za-z0-9+/]{120,}={0,2}\b/g,
];

export function redactSecrets(text: string): string {
  let out = String(text || '');
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[REDACTED]');
  return out;
}

type SanitizedCrash = {
  message: string;
  stack: string;
  componentStack: string;
  route: string;
  version: string;
  ua: string;
};

export function sanitizeCrashPayload(body: any): SanitizedCrash {
  const clip = (v: unknown, n: number) => redactSecrets(String(v ?? '')).slice(0, n);
  return {
    message: clip(body?.message, 400) || 'Erreur inconnue',
    stack: clip(body?.stack, 4000),
    componentStack: clip(body?.componentStack, 2000),
    route: clip(body?.route, 200),
    version: clip(body?.version, 40),
    ua: clip(body?.ua, 200),
  };
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Stable fingerprint: message + first meaningful stack frames. */
export async function fingerprintOf(p: SanitizedCrash): Promise<string> {
  const frames = p.stack
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('at '))
    .slice(0, 3)
    .join('|');
  return (await sha256Hex(`${p.message}§${frames}`)).slice(0, 16);
}

async function hashIp(ip: string): Promise<string> {
  return (await sha256Hex(`atlas-crash-ip§${ip}`)).slice(0, 16);
}

/* ─────────────────────────── github config ─────────────────────────── */

type ReportsEnv = TriageEnv & {
  DB: D1Database;
  GITHUB_ISSUE_TOKEN?: string;
  GITHUB_ISSUE_REPO?: string;
  GITHUB_WEB_ISSUE_TOKEN?: string;
  GITHUB_WEB_ISSUE_REPO?: string;
  /** Max outbound fetches (GitHub + Groq) per queue drain. Default 40 — the
   *  Workers free plan allows 50 subrequests per invocation. */
  REPORTS_SUBREQUEST_BUDGET?: string;
};

function cleanRepo(v: unknown): string {
  return String(v || '').trim();
}

async function getConfigValue(db: D1Database, key: string): Promise<string> {
  try {
    const row = await db.prepare(`SELECT value FROM app_config WHERE key = ?`).bind(key).first() as any;
    return String(row?.value || '');
  } catch { return ''; }
}

async function setConfigValue(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare(
    `INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).bind(key, value).run();
}

/**
 * env secret wins over the in-app configured token; repo is overridable.
 * `android` (default, historical) and `web` use separate secrets and repos.
 */
export async function githubConfig(env: ReportsEnv, channel: ReportChannel = 'android'): Promise<{ token: string; repo: string; source: 'env' | 'app' | null }> {
  if (channel === 'web') {
    const repoFrom = (v: unknown) => cleanRepo(v) || cleanRepo(env.GITHUB_WEB_ISSUE_REPO) || WEB_REPORTS_REPO_DEFAULT;
    const envWebToken = String(env.GITHUB_WEB_ISSUE_TOKEN || '').trim();
    if (envWebToken) return { token: envWebToken, repo: repoFrom(''), source: 'env' };
    const appWebToken = await getConfigValue(env.DB, 'github_web_reports_token');
    const appWebRepo = await getConfigValue(env.DB, 'github_web_reports_repo');
    if (appWebToken) return { token: appWebToken, repo: repoFrom(appWebRepo), source: 'app' };
    return { token: '', repo: repoFrom(appWebRepo), source: null };
  }
  const envToken = String(env.GITHUB_ISSUE_TOKEN || '').trim();
  if (envToken) {
    return { token: envToken, repo: resolveReportsRepo(env.GITHUB_ISSUE_REPO), source: 'env' };
  }
  const appToken = await getConfigValue(env.DB, 'github_reports_token');
  const appRepo = await getConfigValue(env.DB, 'github_reports_repo');
  if (appToken) {
    return { token: appToken, repo: resolveReportsRepo(appRepo || env.GITHUB_ISSUE_REPO), source: 'app' };
  }
  return { token: '', repo: resolveReportsRepo(env.GITHUB_ISSUE_REPO), source: null };
}

export async function saveGithubConfig(db: D1Database, token: string, repo: string, channel: ReportChannel = 'android'): Promise<void> {
  const prefix = channel === 'web' ? 'github_web_reports' : 'github_reports';
  await setConfigValue(db, `${prefix}_token`, token);
  if (repo) await setConfigValue(db, `${prefix}_repo`, repo);
}

async function gh(token: string, method: string, path: string, body?: any): Promise<{ ok: boolean; status: number; json: any }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`https://api.github.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'atlas-commerce-reports',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      redirect: 'manual', signal: controller.signal,
      body: body ? JSON.stringify(body) : undefined,
    });
    let json: any = null;
    try { json = await res.json(); } catch { /* 204 etc. */ }
    return { ok: res.ok, status: res.status, json };
  } finally { clearTimeout(timeout); }
}

/** Validate a token (used before storing it). Returns login name or null. */
export async function validateGithubToken(token: string): Promise<{ ok: boolean; login?: string; error?: string }> {
  try {
    const r = await gh(token, 'GET', '/user');
    if (r.ok && r.json?.login) return { ok: true, login: String(r.json.login) };
    if (r.status === 401 || r.status === 403) return { ok: false, error: 'Token refusé par GitHub (401/403)' };
    return { ok: false, error: `GitHub a répondu ${r.status}` };
  } catch {
    return { ok: false, error: 'GitHub injoignable — réessayez' };
  }
}

const LABEL_META: Record<string, [string, string]> = {
  [LABEL_CRASH]: ['Bugs détectés automatiquement par l’application', 'd73a4a'],
  [LABEL_USER]: ['Signalements envoyés par les utilisateurs depuis l’application', '0075ca'],
  [LABEL_FROM_APP]: ['Créé automatiquement par Atlas Commerce', 'ededed'],
  'severity:critical': ['Gravité estimée : critique', 'b60205'],
  'severity:high': ['Gravité estimée : élevée', 'd93f0b'],
  'severity:medium': ['Gravité estimée : moyenne', 'fbca04'],
  'severity:low': ['Gravité estimée : faible', 'c2e0c6'],
};
/** Labels already ensured per repo in this isolate — saves 3+ GitHub calls per issue. */
const _ensuredLabels = new Map<string, Set<string>>();

async function ensureLabels(token: string, repo: string, labels: string[]): Promise<void> {
  let done = _ensuredLabels.get(repo);
  if (!done) { done = new Set(); _ensuredLabels.set(repo, done); }
  for (const name of labels) {
    if (done.has(name)) continue;
    const [description, color] = LABEL_META[name] || ['Zone estimée par le triage automatique', '5319e7'];
    try {
      const r = await gh(token, 'POST', `/repos/${repo}/labels`, { name, description, color });
      if (r.ok || r.status === 422) done.add(name); /* 422 = exists */
    } catch { /* labels are cosmetic — never block a report */ }
  }
}

async function findOpenIssueByFingerprint(token: string, repo: string, fingerprint: string): Promise<{ number: number; url: string } | null> {
  try {
    const q = encodeURIComponent(`repo:${repo} is:issue is:open "${fingerprint}" in:title`);
    const r = await gh(token, 'GET', `/search/issues?q=${q}&per_page=1`);
    const item = r.ok ? r.json?.items?.[0] : null;
    if (item?.number) return { number: Number(item.number), url: String(item.html_url || '') };
  } catch { /* fall through → create a new issue */ }
  return null;
}

async function createIssue(
  token: string, repo: string, title: string, body: string, labels: string[],
): Promise<{ number: number; url: string } | null> {
  try {
    await ensureLabels(token, repo, labels);
    const r = await gh(token, 'POST', `/repos/${repo}/issues`, { title: title.slice(0, 200), body: body.slice(0, 60000), labels });
    if (r.ok && r.json?.number) return { number: Number(r.json.number), url: String(r.json.html_url || '') };
    return null;
  } catch {
    return null;
  }
}

/**
 * Title/body/labels for a NEW issue, enriched by the AI triage when available
 * (never required — falls back to the plain report).
 */
async function composeIssue(
  env: ReportsEnv, input: TriageInput, prefix: string, fallbackTitle: string, body: string, labels: string[],
): Promise<{ title: string; body: string; labels: string[] }> {
  const t = await triageIssue(env, input);
  if (!t) return { title: `${prefix} ${fallbackTitle}`, body, labels };
  return { title: `${prefix} ${t.title}`, body: `${body}\n${triageMarkdown(t)}`, labels: [...labels, ...triageLabels(t)] };
}

/* ─────────────────────────── crash intake ─────────────────────────── */

type CrashIntakeResult = { id: number; deduped: boolean; issue_url: string };

export async function reportCrash(db: D1Database, env: ReportsEnv, rawBody: any, ip: string, hint: { headerUa?: string } = {}): Promise<CrashIntakeResult> {
  const p = sanitizeCrashPayload(rawBody);
  const fingerprint = await fingerprintOf(p);
  const ipHash = await hashIp(ip);

  const existing = await db.prepare(
    `SELECT id, count, issue_number, issue_url, status, channel FROM crash_reports WHERE fingerprint = ?`
  ).bind(fingerprint).first() as any;
  const channel: ReportChannel = existing?.channel === 'web' || existing?.channel === 'android'
    ? existing.channel
    : classifyReportChannel({ platform: rawBody?.platform, client: rawBody?.client, ua: p.ua, headerUa: hint.headerUa });

  let id: number;
  let deduped = false;
  if (existing?.id) {
    deduped = true;
    id = Number(existing.id);
    await db.prepare(
      `UPDATE crash_reports SET count = count + 1, last_seen = datetime('now'), version = ?, route = ?, ua = ? WHERE id = ?`
    ).bind(p.version, p.route, p.ua, id).run();
  } else {
    const res = await db.prepare(
      `INSERT INTO crash_reports (fingerprint, message, stack, component_stack, route, version, ua, ip_hash, count, status, channel)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'new', ?)`
    ).bind(fingerprint, p.message, p.stack, p.componentStack, p.route, p.version, p.ua, ipHash, channel).run();
    id = Number((res.meta as any)?.last_row_id || 0);
  }

  const { token, repo } = await githubConfig(env, channel);
  let issueUrl = String(existing?.issue_url || '');
  if (token) {
    const alreadyLinked = existing?.issue_number && existing?.status === 'linked';
    if (!alreadyLinked) {
      const found = await findOpenIssueByFingerprint(token, repo, fingerprint);
      if (found) {
        issueUrl = found.url;
        await db.prepare(`UPDATE crash_reports SET status='linked', issue_number=?, issue_url=? WHERE id=?`)
          .bind(found.number, found.url, id).run();
      } else {
        const body = [
          `**Plantage détecté automatiquement par l'application Atlas Commerce.**`,
          ``,
          `- Empreinte : \`${fingerprint}\``,
          `- Occurrences : ${deduped ? Number(existing?.count || 0) + 1 : 1}`,
          `- Version : ${p.version || '?'}`,
          `- Page : \`${p.route || '?'}\``,
          `- User-Agent : ${p.ua || '?'}`,
          ``,
          `### Message`, '```', p.message, '```',
          p.stack ? `### Stack\n\`\`\`\n${p.stack}\n\`\`\`` : '',
          p.componentStack ? `### Composant React\n\`\`\`\n${p.componentStack}\n\`\`\`` : '',
          ``,
          `> Rapport assaini automatiquement (secrets retirés). Les occurrences suivantes de la même empreinte mettent à jour ce ticket au lieu d'en créer un nouveau.`,
        ].filter(Boolean).join('\n');
        const issue = await composeIssue(env, {
          kind: 'crash', channel, message: p.message, stack: p.stack, componentStack: p.componentStack,
          route: p.route, version: p.version, ua: p.ua, occurrences: deduped ? Number(existing?.count || 0) + 1 : 1,
        }, `[crash ${fingerprint}]`, p.message.slice(0, 100), body, [LABEL_CRASH, LABEL_FROM_APP]);
        const created = await createIssue(token, repo, issue.title, issue.body, issue.labels);
        if (created) {
          issueUrl = created.url;
          await db.prepare(`UPDATE crash_reports SET status='linked', issue_number=?, issue_url=? WHERE id=?`)
            .bind(created.number, created.url, id).run();
        } else {
          await db.prepare(`UPDATE crash_reports SET status='pending' WHERE id=?`).bind(id).run();
        }
      }
    }
  } else {
    // No token yet — keep queued for retryPendingReports() once configured.
    await db.prepare(`UPDATE crash_reports SET status='pending' WHERE id=? AND status='new'`).bind(id).run();
  }
  return { id, deduped, issue_url: issueUrl };
}

/* ─────────────────────────── user reports ─────────────────────────── */

type UserReportInput = {
  username: string;
  role: string;
  kind: string;
  message: string;
  contact?: string;
  page?: string;
  version?: string;
  /** Which app sent it (see classifyReportChannel); default android. */
  channel?: ReportChannel;
};

type UserReportResult = { reference: string; issue_url: string; already_reported: boolean; issue_status: 'open' | 'closed' | null };
type ReportIdentity = { owner: boolean; userId: number | null };

async function ensureReportDedup(db: D1Database): Promise<void> {
  await db.prepare(`CREATE TABLE IF NOT EXISTS user_report_dedup (
    scope TEXT NOT NULL, repo TEXT NOT NULL, fingerprint TEXT NOT NULL,
    report_id INTEGER NOT NULL REFERENCES user_reports(id) ON DELETE CASCADE,
    PRIMARY KEY (scope, repo, fingerprint)
  )`).run();
}

/** Only trust an issue whose stored and returned URLs match the configured repo. */
async function duplicateIssueStatus(token: string, repo: string, row: any): Promise<{ url: string; status: 'open' | 'closed' | null }> {
  try {
    if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(repo)) throw new Error('repo');
    const number = Number(row.issue_number);
    const path = `/${repo}/issues/${number}`.toLowerCase();
    const validUrl = (value: unknown) => {
      const url = new URL(String(value));
      return url.protocol === 'https:' && url.hostname === 'github.com' && !url.port && !url.username && !url.password &&
        url.pathname.toLowerCase() === path && !url.search && !url.hash;
    };
    if (!Number.isSafeInteger(number) || number <= 0 || !validUrl(row.issue_url)) throw new Error('link');
    if (!token) return { url: '', status: null };
    const issue = await githubJson(`https://api.github.com/repos/${repo}/issues/${number}`, token);
    if (issue.number !== number || issue.pull_request || !validUrl(issue.html_url) || !['open', 'closed'].includes(issue.state)) throw new Error('issue');
    return { url: String(issue.html_url), status: issue.state };
  } catch { return { url: '', status: null }; }
}

export async function reportUser(db: D1Database, env: ReportsEnv, input: UserReportInput, onCreated?: (id: number) => Promise<void>, identity?: ReportIdentity): Promise<UserReportResult> {
  const kind = ['bug', 'feedback', 'other'].includes(input.kind) ? input.kind : 'other';
  const message = redactSecrets(String(input.message || '')).slice(0, 2000);
  const contact = redactSecrets(String(input.contact || '')).slice(0, 120);
  const page = redactSecrets(String(input.page || '')).slice(0, 200);
  const version = String(input.version || '').slice(0, 40);
  const channel: ReportChannel = input.channel === 'web' ? 'web' : 'android';

  const { token, repo } = await githubConfig(env, channel);
  const scope = identity?.owner ? 'owner' : identity?.userId ? `user:${identity.userId}` : '';
  // Redaction can make different messages identical; do not suppress those reports.
  const canDedup = Boolean(scope) && !message.includes('[REDACTED]');
  const fingerprint = canDedup ? await sha256Hex(JSON.stringify([kind, message])) : '';
  if (canDedup) {
    await ensureReportDedup(db);
    // Adopt earlier linked reports only if their server-created ownership binding
    // and URL match. Unbound legacy rows cannot prove account ownership.
    const ownerTable = await tableExists(db, 'work_status_report_owners');
    if (ownerTable) {
      await db.prepare(`INSERT OR IGNORE INTO user_report_dedup (scope, repo, fingerprint, report_id)
        SELECT ?, ?, ?, r.id FROM user_reports r JOIN work_status_report_owners o ON o.report_id = r.id
        WHERE r.kind = ? AND r.message = ? AND r.status = 'linked' AND r.issue_number > 0
          AND lower(r.issue_url) = lower('https://github.com/' || ? || '/issues/' || r.issue_number)
          AND ((? = 1 AND o.owner_slot = 1) OR (? = 0 AND o.user_id = ?))
        ORDER BY r.id ASC LIMIT 1`).bind(scope, repo.toLowerCase(), fingerprint, kind, message, repo,
          identity?.owner ? 1 : 0, identity?.owner ? 1 : 0, identity?.userId ?? null).run();
    }
  }
  const res = await db.prepare(
    `INSERT INTO user_reports (username, role, kind, message, contact, page, version, status, channel)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(String(input.username || '').toLowerCase(), input.role, kind, message, contact, page, version, canDedup ? 'dedup_check' : 'new', channel).run();
  const id = Number((res.meta as any)?.last_row_id || 0);
  const reference = `R-${id}`;
  if (canDedup) {
    try {
      const claim = await db.prepare('INSERT OR IGNORE INTO user_report_dedup (scope, repo, fingerprint, report_id) VALUES (?, ?, ?, ?)')
        .bind(scope, repo.toLowerCase(), fingerprint, id).run();
      if (!claim.meta?.changes) {
        const existing = await db.prepare(`SELECT r.id, r.issue_number, r.issue_url FROM user_report_dedup d
          JOIN user_reports r ON r.id = d.report_id WHERE d.scope = ? AND d.repo = ? AND d.fingerprint = ?`)
          .bind(scope, repo.toLowerCase(), fingerprint).first() as any;
        if (!existing) throw new Error('dedup unavailable');
        await db.prepare('DELETE FROM user_reports WHERE id = ?').bind(id).run();
        const issue = await duplicateIssueStatus(token, repo, existing);
        return { reference: `R-${existing.id}`, issue_url: issue.url, already_reported: true, issue_status: issue.status };
      }
    } catch (e) {
      // Prevent the queue from creating an issue when deduplication failed.
      await db.prepare("UPDATE user_reports SET status = 'dedup_error' WHERE id = ?").bind(id).run().catch(() => {});
      throw e;
    }
  }
  if (onCreated && Number.isSafeInteger(id) && id > 0) await onCreated(id).catch(() => {});
  if (canDedup) await db.prepare('UPDATE user_reports SET status = ? WHERE id = ?').bind(token ? 'sending' : 'pending', id).run();
  let issueUrl = '';
  if (token) {
    const body = [
      `**Signalement utilisateur envoyé depuis l'application Atlas Commerce.**`,
      ``,
      `- Référence : \`${reference}\``,
      `- Type : ${kind}`,
      `- Compte : ${input.username || '?'} (rôle : ${input.role || '?'})`,
      page ? `- Page : \`${page}\`` : '',
      version ? `- Version : ${version}` : '',
      contact ? `- Contact laissé : ${contact}` : '',
      ``,
      `### Message`, message,
    ].filter(Boolean).join('\n');
    const issue = await composeIssue(env, { kind: 'report', channel, reportKind: kind, message, route: page, version },
      `[report:${kind} ${reference}]`, message.slice(0, 90), body, [LABEL_USER, LABEL_FROM_APP]);
    const created = await createIssue(token, repo, issue.title, issue.body, issue.labels);
    if (created) {
      issueUrl = created.url;
      await db.prepare(`UPDATE user_reports SET status='linked', issue_number=?, issue_url=? WHERE id=?`)
        .bind(created.number, created.url, id).run();
    } else {
      await db.prepare(`UPDATE user_reports SET status='pending' WHERE id=?`).bind(id).run();
    }
  } else {
    await db.prepare(`UPDATE user_reports SET status='pending' WHERE id=?`).bind(id).run();
  }
  return { reference, issue_url: issueUrl, already_reported: false, issue_status: null };
}

/* ─────────────────────────── queue drain + admin views ─────────────────────────── */

type RetryCounts = { crashes: number; user_reports: number };
export type RetryResult = RetryCounts & {
  skipped: boolean;
  /** True when the subrequest budget ran out with rows still queued. */
  more?: boolean;
  by_channel: Record<ReportChannel, RetryCounts & { configured: boolean; repo: string }>;
};

/**
 * Cron + owner button: push queued reports to GitHub once a token exists.
 * Each channel (android / web) drains with its own token and repo; a channel
 * without a token simply keeps its rows queued.
 */
export async function retryPendingReports(env: ReportsEnv): Promise<RetryResult> {
  const db = env.DB;
  const [android, web] = await Promise.all([githubConfig(env, 'android'), githubConfig(env, 'web')]);
  const by_channel: RetryResult['by_channel'] = {
    android: { crashes: 0, user_reports: 0, configured: !!android.token, repo: android.repo },
    web: { crashes: 0, user_reports: 0, configured: !!web.token, repo: web.repo },
  };
  if (!android.token && !web.token) return { crashes: 0, user_reports: 0, skipped: true, by_channel };

  // Outbound budget per drain: a new crash issue costs a dedupe search, the
  // optional Groq triage and the create call (+ first-time label setup), a
  // user report the triage + create. Rows beyond the budget wait for the
  // next drain (daily cron or the owner button) instead of failing midway.
  const budgetEnv = Number.parseInt(String(env.REPORTS_SUBREQUEST_BUDGET || ''), 10);
  let budget = Number.isFinite(budgetEnv) && budgetEnv > 0 ? Math.min(budgetEnv, 900) : 40;
  let more = false;
  const CRASH_COST = 4;
  const REPORT_COST = 3;

  // A crashed intake may leave its winning claim in progress. Do not recover
  // unclaimed rows: they may be duplicates that never completed arbitration.
  try {
    await db.prepare(`UPDATE user_reports SET status = 'pending'
      WHERE status IN ('dedup_check', 'sending') AND created_at < datetime('now', '-5 minutes')
      AND id IN (SELECT report_id FROM user_report_dedup)`).run();
  } catch { /* Older installations may not have the optional dedup table. */ }
  // Serialize concurrent queue drains per report; leases expire after crashes.
  await db.prepare(`CREATE TABLE IF NOT EXISTS user_report_delivery_leases (
    report_id INTEGER PRIMARY KEY, lease_id TEXT NOT NULL, started_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`).run();

  for (const [channel, cfg] of [['android', android], ['web', web]] as const) {
    const { token, repo } = cfg;
    if (!token) continue;
    const counts = by_channel[channel];
    const pendingCrashes = await db.prepare(
      `SELECT id, fingerprint, message, stack, component_stack, route, version, ua, count FROM crash_reports
       WHERE status IN ('new','pending','failed') AND channel = ? ORDER BY last_seen DESC LIMIT 30`
    ).bind(channel).all() as any;
    // The same bug often lands under several fingerprints (stack frames carry
    // per-build bundle names / line numbers). Within one drain, rows sharing a
    // message reuse the first issue instead of opening near-duplicates.
    const issueByMessage = new Map<string, { number: number; url: string }>();
    for (const row of (pendingCrashes.results || []) as any[]) {
      const messageKey = String(row.message || '').trim().toLowerCase().slice(0, 300);
      const sibling = messageKey ? issueByMessage.get(messageKey) : undefined;
      if (!sibling && budget < CRASH_COST) { more = true; continue; }
      let created = sibling || null;
      if (!created) {
        budget -= CRASH_COST;
        created = await findOpenIssueByFingerprint(token, repo, String(row.fingerprint));
      }
      if (!created) {
        const body = [
          `**Plantage détecté automatiquement par l'application Atlas Commerce.** (rattrapage file d'attente)`,
          ``, `- Empreinte : \`${row.fingerprint}\``, `- Occurrences : ${row.count}`, `- Version : ${row.version || '?'}`, `- Page : \`${row.route || '?'}\``,
          row.ua ? `- User-Agent : ${row.ua}` : '',
          ``, `### Message`, '```', String(row.message), '```',
          row.stack ? `### Stack\n\`\`\`\n${String(row.stack).slice(0, 4000)}\n\`\`\`` : '',
          row.component_stack ? `### Composant React\n\`\`\`\n${String(row.component_stack).slice(0, 2000)}\n\`\`\`` : '',
        ].filter(Boolean).join('\n');
        const issue = await composeIssue(env, {
          kind: 'crash', channel, message: String(row.message), stack: String(row.stack || ''), componentStack: String(row.component_stack || ''),
          route: String(row.route || ''), version: String(row.version || ''), ua: String(row.ua || ''), occurrences: Number(row.count) || 1,
        }, `[crash ${row.fingerprint}]`, String(row.message).slice(0, 100), body, [LABEL_CRASH, LABEL_FROM_APP]);
        created = await createIssue(token, repo, issue.title, issue.body, issue.labels);
      }
      if (created && messageKey) issueByMessage.set(messageKey, created);
      if (created) {
        await db.prepare(`UPDATE crash_reports SET status='linked', issue_number=?, issue_url=? WHERE id=?`)
          .bind(created.number, created.url, Number(row.id)).run();
        counts.crashes++;
      }
    }

    const pendingUser = await db.prepare(
      `SELECT id, username, role, kind, message, contact, page, version FROM user_reports
       WHERE status IN ('new','pending','failed') AND channel = ? ORDER BY created_at DESC LIMIT 30`
    ).bind(channel).all() as any;
    for (const row of (pendingUser.results || []) as any[]) {
      if (budget < REPORT_COST) { more = true; break; }
      const lease = crypto.randomUUID();
      const acquired = await db.prepare(`INSERT INTO user_report_delivery_leases (report_id, lease_id, started_at)
        VALUES (?, ?, datetime('now')) ON CONFLICT(report_id) DO UPDATE SET lease_id=excluded.lease_id, started_at=excluded.started_at
        WHERE user_report_delivery_leases.started_at < datetime('now', '-5 minutes')`).bind(row.id, lease).run();
      if (!acquired.meta?.changes) continue;
      try {
        const current = await db.prepare("SELECT status FROM user_reports WHERE id = ?").bind(row.id).first() as any;
        if (!current || !['new', 'pending', 'failed'].includes(current.status)) continue;
        budget -= REPORT_COST;
        const body = [
          `**Signalement utilisateur envoyé depuis l'application Atlas Commerce.** (rattrapage file d'attente)`,
          ``, `- Référence : \`R-${row.id}\``, `- Type : ${row.kind}`, `- Compte : ${row.username} (rôle : ${row.role})`,
          row.page ? `- Page : \`${row.page}\`` : '', row.version ? `- Version : ${row.version}` : '',
          row.contact ? `- Contact laissé : ${row.contact}` : '', ``, `### Message`, String(row.message),
        ].filter(Boolean).join('\n');
        const issue = await composeIssue(env, {
          kind: 'report', channel, reportKind: String(row.kind), message: String(row.message), route: String(row.page || ''), version: String(row.version || ''),
        }, `[report:${row.kind} R-${row.id}]`, String(row.message).slice(0, 90), body, [LABEL_USER, LABEL_FROM_APP]);
        const created = await createIssue(token, repo, issue.title, issue.body, issue.labels);
        if (created) {
          await db.prepare(`UPDATE user_reports SET status='linked', issue_number=?, issue_url=? WHERE id=?`)
            .bind(created.number, created.url, Number(row.id)).run();
          counts.user_reports++;
        }
      } finally {
        await db.prepare('DELETE FROM user_report_delivery_leases WHERE report_id = ? AND lease_id = ?').bind(row.id, lease).run();
      }
    }
  }
  return {
    crashes: by_channel.android.crashes + by_channel.web.crashes,
    user_reports: by_channel.android.user_reports + by_channel.web.user_reports,
    skipped: false,
    more,
    by_channel,
  };
}

/** Owner/admin view — D1 rows only, already sanitized at intake. */
export async function listReports(db: D1Database, limit = 25): Promise<{ crashes: any[]; user_reports: any[]; pending: number; pending_by_channel: Record<ReportChannel, number> }> {
  const cap = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const crashes = await db.prepare(
    `SELECT id, fingerprint, message, route, version, count, status, issue_number, issue_url, first_seen, last_seen, channel
     FROM crash_reports ORDER BY last_seen DESC LIMIT ?`
  ).bind(cap).all() as any;
  const users = await db.prepare(
    `SELECT id, username, role, kind, message, contact, page, version, status, issue_number, issue_url, created_at, channel
     FROM user_reports ORDER BY created_at DESC LIMIT ?`
  ).bind(cap).all() as any;
  const pendingRow = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM crash_reports WHERE status != 'linked' AND channel = 'web') +
       (SELECT COUNT(*) FROM user_reports WHERE status != 'linked' AND channel = 'web') AS web,
       (SELECT COUNT(*) FROM crash_reports WHERE status != 'linked' AND channel != 'web') +
       (SELECT COUNT(*) FROM user_reports WHERE status != 'linked' AND channel != 'web') AS android`
  ).first() as any;
  const web = Number(pendingRow?.web || 0);
  const android = Number(pendingRow?.android || 0);
  return {
    crashes: (crashes.results || []) as any[],
    user_reports: (users.results || []) as any[],
    pending: web + android,
    pending_by_channel: { web, android },
  };
}
