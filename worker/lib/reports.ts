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
 */

const DEFAULT_REPO = 'Etherealmber/atlas-commerce';
const LABEL_CRASH = 'crash-report';
const LABEL_USER = 'user-report';
const LABEL_FROM_APP = 'from-app';

export async function ensureReportTables(db: D1Database): Promise<void> {
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

export type SanitizedCrash = {
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

export async function hashIp(ip: string): Promise<string> {
  return (await sha256Hex(`atlas-crash-ip§${ip}`)).slice(0, 16);
}

/* ─────────────────────────── github config ─────────────────────────── */

export type ReportsEnv = {
  DB: D1Database;
  GITHUB_ISSUE_TOKEN?: string;
  GITHUB_ISSUE_REPO?: string;
};

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

/** env secret wins over the in-app configured token; repo is overridable. */
export async function githubConfig(env: ReportsEnv): Promise<{ token: string; repo: string; source: 'env' | 'app' | null }> {
  const envToken = String(env.GITHUB_ISSUE_TOKEN || '').trim();
  if (envToken) {
    return { token: envToken, repo: String(env.GITHUB_ISSUE_REPO || DEFAULT_REPO).trim(), source: 'env' };
  }
  const appToken = await getConfigValue(env.DB, 'github_reports_token');
  const appRepo = await getConfigValue(env.DB, 'github_reports_repo');
  if (appToken) {
    return { token: appToken, repo: (appRepo || String(env.GITHUB_ISSUE_REPO || DEFAULT_REPO)).trim(), source: 'app' };
  }
  return { token: '', repo: String(env.GITHUB_ISSUE_REPO || DEFAULT_REPO).trim(), source: null };
}

export async function saveGithubConfig(db: D1Database, token: string, repo: string): Promise<void> {
  await setConfigValue(db, 'github_reports_token', token);
  if (repo) await setConfigValue(db, 'github_reports_repo', repo);
}

async function gh(token: string, method: string, path: string, body?: any): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'atlas-commerce-reports',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* 204 etc. */ }
  return { ok: res.ok, status: res.status, json };
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

async function ensureLabels(token: string, repo: string): Promise<void> {
  const wanted: [string, string, string][] = [
    [LABEL_CRASH, 'Bugs detectedés automatiquement par l’application', 'd73a4a'],
    [LABEL_USER, 'Signalements envoyés par les utilisateurs depuis l’application', '0075ca'],
    [LABEL_FROM_APP, 'Créé automatiquement par Atlas Commerce', 'ededed'],
  ];
  for (const [name, description, color] of wanted) {
    try {
      const r = await gh(token, 'POST', `/repos/${repo}/labels`, { name, description, color });
      if (!r.ok && r.status !== 422) { /* 422 = exists */ }
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
    await ensureLabels(token, repo);
    const r = await gh(token, 'POST', `/repos/${repo}/issues`, { title: title.slice(0, 200), body: body.slice(0, 60000), labels });
    if (r.ok && r.json?.number) return { number: Number(r.json.number), url: String(r.json.html_url || '') };
    return null;
  } catch {
    return null;
  }
}

/* ─────────────────────────── crash intake ─────────────────────────── */

export type CrashIntakeResult = { id: number; deduped: boolean; issue_url: string };

export async function reportCrash(db: D1Database, env: ReportsEnv, rawBody: any, ip: string): Promise<CrashIntakeResult> {
  const p = sanitizeCrashPayload(rawBody);
  const fingerprint = await fingerprintOf(p);
  const ipHash = await hashIp(ip);

  const existing = await db.prepare(
    `SELECT id, count, issue_number, issue_url, status FROM crash_reports WHERE fingerprint = ?`
  ).bind(fingerprint).first() as any;

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
      `INSERT INTO crash_reports (fingerprint, message, stack, component_stack, route, version, ua, ip_hash, count, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'new')`
    ).bind(fingerprint, p.message, p.stack, p.componentStack, p.route, p.version, p.ua, ipHash).run();
    id = Number((res.meta as any)?.last_row_id || 0);
  }

  const { token, repo } = await githubConfig(env);
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
        const created = await createIssue(token, repo, `[crash ${fingerprint}] ${p.message.slice(0, 100)}`, body, [LABEL_CRASH, LABEL_FROM_APP]);
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

export type UserReportInput = {
  username: string;
  role: string;
  kind: string;
  message: string;
  contact?: string;
  page?: string;
  version?: string;
};

export type UserReportResult = { reference: string; issue_url: string };

export async function reportUser(db: D1Database, env: ReportsEnv, input: UserReportInput): Promise<UserReportResult> {
  const kind = ['bug', 'feedback', 'other'].includes(input.kind) ? input.kind : 'other';
  const message = redactSecrets(String(input.message || '')).slice(0, 2000);
  const contact = redactSecrets(String(input.contact || '')).slice(0, 120);
  const page = redactSecrets(String(input.page || '')).slice(0, 200);
  const version = String(input.version || '').slice(0, 40);

  const res = await db.prepare(
    `INSERT INTO user_reports (username, role, kind, message, contact, page, version, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'new')`
  ).bind(String(input.username || '').toLowerCase(), input.role, kind, message, contact, page, version).run();
  const id = Number((res.meta as any)?.last_row_id || 0);
  const reference = `R-${id}`;

  const { token, repo } = await githubConfig(env);
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
    const created = await createIssue(token, repo, `[report:${kind} ${reference}] ${message.slice(0, 90)}`, body, [LABEL_USER, LABEL_FROM_APP]);
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
  return { reference, issue_url: issueUrl };
}

/* ─────────────────────────── queue drain + admin views ─────────────────────────── */

/** Cron + owner button: push queued reports to GitHub once a token exists. */
export async function retryPendingReports(env: ReportsEnv): Promise<{ crashes: number; user_reports: number; skipped: boolean }> {
  const db = env.DB;
  const { token, repo } = await githubConfig(env);
  if (!token) return { crashes: 0, user_reports: 0, skipped: true };

  let crashes = 0;
  let userReports = 0;
  const pendingCrashes = await db.prepare(
    `SELECT id, fingerprint, message, stack, component_stack, route, version, ua, count FROM crash_reports
     WHERE status IN ('new','pending','failed') ORDER BY last_seen DESC LIMIT 10`
  ).all() as any;
  for (const row of (pendingCrashes.results || []) as any[]) {
    const found = await findOpenIssueByFingerprint(token, repo, String(row.fingerprint));
    const created = found || await createIssue(token, repo, `[crash ${row.fingerprint}] ${String(row.message).slice(0, 100)}`, [
      `**Plantage détecté automatiquement par l'application Atlas Commerce.** (rattrapage file d'attente)`,
      ``, `- Empreinte : \`${row.fingerprint}\``, `- Occurrences : ${row.count}`, `- Version : ${row.version || '?'}`, `- Page : \`${row.route || '?'}\``,
      ``, `### Message`, '```', String(row.message), '```',
      row.stack ? `### Stack\n\`\`\`\n${String(row.stack).slice(0, 4000)}\n\`\`\`` : '',
    ].filter(Boolean).join('\n'), [LABEL_CRASH, LABEL_FROM_APP]);
    if (created) {
      await db.prepare(`UPDATE crash_reports SET status='linked', issue_number=?, issue_url=? WHERE id=?`)
        .bind(created.number, created.url, Number(row.id)).run();
      crashes++;
    }
  }

  const pendingUser = await db.prepare(
    `SELECT id, username, role, kind, message, contact, page, version FROM user_reports
     WHERE status IN ('new','pending','failed') ORDER BY created_at DESC LIMIT 10`
  ).all() as any;
  for (const row of (pendingUser.results || []) as any[]) {
    const created = await createIssue(token, repo, `[report:${row.kind} R-${row.id}] ${String(row.message).slice(0, 90)}`, [
      `**Signalement utilisateur envoyé depuis l'application Atlas Commerce.** (rattrapage file d'attente)`,
      ``, `- Référence : \`R-${row.id}\``, `- Type : ${row.kind}`, `- Compte : ${row.username} (rôle : ${row.role})`,
      row.page ? `- Page : \`${row.page}\`` : '', row.version ? `- Version : ${row.version}` : '',
      row.contact ? `- Contact laissé : ${row.contact}` : '', ``, `### Message`, String(row.message),
    ].filter(Boolean).join('\n'), [LABEL_USER, LABEL_FROM_APP]);
    if (created) {
      await db.prepare(`UPDATE user_reports SET status='linked', issue_number=?, issue_url=? WHERE id=?`)
        .bind(created.number, created.url, Number(row.id)).run();
      userReports++;
    }
  }
  return { crashes, user_reports: userReports, skipped: false };
}

/** Owner/admin view — D1 rows only, already sanitized at intake. */
export async function listReports(db: D1Database, limit = 25): Promise<{ crashes: any[]; user_reports: any[]; pending: number }> {
  const cap = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const crashes = await db.prepare(
    `SELECT id, fingerprint, message, route, version, count, status, issue_number, issue_url, first_seen, last_seen
     FROM crash_reports ORDER BY last_seen DESC LIMIT ?`
  ).bind(cap).all() as any;
  const users = await db.prepare(
    `SELECT id, username, role, kind, message, contact, page, version, status, issue_number, issue_url, created_at
     FROM user_reports ORDER BY created_at DESC LIMIT ?`
  ).bind(cap).all() as any;
  const pendingRow = await db.prepare(
    `SELECT (SELECT COUNT(*) FROM crash_reports WHERE status != 'linked') + (SELECT COUNT(*) FROM user_reports WHERE status != 'linked') AS n`
  ).first() as any;
  return {
    crashes: (crashes.results || []) as any[],
    user_reports: (users.results || []) as any[],
    pending: Number(pendingRow?.n || 0),
  };
}
