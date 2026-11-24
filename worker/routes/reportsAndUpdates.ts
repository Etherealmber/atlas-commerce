import type { Hono } from 'hono';
import { recordReportOwner } from '../lib/report-ownership';
import { normalizeRole } from '../lib/rbac';
import { sessionUserFromHeader } from '../lib/authHelpers';
import {
  manifestWithPolicy,
  readMinVersionPolicy,
  validateMinVersionPolicy,
  writeMinVersionPolicy,
  parseMinVersionPolicy,
  type MinVersionPolicy,
} from '../lib/app-update-policy';
import {
  ensureReportTables,
  githubConfig,
  listReports,
  reportCrash,
  reportUser,
  retryPendingReports,
  saveGithubConfig,
  validateGithubToken,
  REPORTS_REPO_DEFAULT,
} from '../lib/reports';

const APP_UPDATE_MAX_APK_BYTES = 200 * 1024 * 1024;

interface ReportsAndUpdatesDeps {
  authFailReason: (header: string | undefined, env: any, db: D1Database, ip: string, fp?: string) => Promise<string>;
  sessionUserFromHeader: (header: string | undefined) => any;
  getOwnerUsername: (env: any) => string | null;
  clientIp: (c: any) => string;
  isRateLimited: (db: D1Database, ip: string) => Promise<{ blocked: boolean; reason?: string }>;
}

const APP_UPDATE_JSON_KEY = 'app-updates/android/latest.json';
const APP_UPDATE_APK_KEY = 'app-updates/android/latest.apk';
const APP_UPDATE_APK_MIME = 'application/vnd.android.package-archive';

function appUpdateCdnBase(env: any): string {
  return String(env.CDN_BASE || 'https://cdn1.afmarbre.com').replace(/\/+$/, '');
}

/** owner/admin gate shared by the admin app-update routes. */
function gateAppUpdateAdmin(c: any): { ok: true; username: string } | { ok: false; status: number; error: string } {
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  if (!session.username) return { ok: false, status: 401, error: 'Non authentifié' };
  const role = normalizeRole(session.role || 'user');
  if (role !== 'owner' && role !== 'admin') return { ok: false, status: 403, error: 'Réservé admin/owner' };
  return { ok: true, username: session.username };
}

/** Read manifest (R2 first, app_config fallback — same order as public check) + R2 object info. */
export async function readAppUpdateState(env: any) {
  let manifest: any = null;
  let source: 'r2' | 'db' | null = null;
  let jsonMeta: { size: number; uploaded: string | null } | null = null;
  if (env.IMAGES) {
    try {
      const head = await env.IMAGES.head(APP_UPDATE_JSON_KEY);
      if (head) jsonMeta = { size: head.size, uploaded: head.uploaded ? new Date(head.uploaded).toISOString() : null };
      const obj = await env.IMAGES.get(APP_UPDATE_JSON_KEY);
      if (obj) { manifest = JSON.parse(await obj.text()); source = 'r2'; }
    } catch { /* */ }
  }
  if (!manifest) {
    try {
      const rows = await env.DB.prepare(`SELECT key, value FROM app_config WHERE key LIKE 'android_update_%'`).all();
      const map: Record<string, string> = {};
      for (const r of (rows?.results || []) as any[]) map[String(r.key)] = String(r.value || '');
      if (map.android_update_version_code || map.android_update_apk_url) {
        manifest = {
          versionCode: Number(map.android_update_version_code || 0),
          versionName: map.android_update_version_name || '',
          apkUrl: map.android_update_apk_url || '',
          mandatory: map.android_update_mandatory === '1' || map.android_update_mandatory === 'true',
          notes: map.android_update_notes || '',
        };
        source = 'db';
      }
    } catch { /* */ }
  }
  let apk: { size: number; uploaded: string | null } | null = null;
  if (env.IMAGES) {
    try {
      const h = await env.IMAGES.head(APP_UPDATE_APK_KEY);
      if (h) apk = { size: h.size, uploaded: h.uploaded ? new Date(h.uploaded).toISOString() : null };
    } catch { /* */ }
  }
  return { manifest, source, jsonMeta, apk };
}

/** Mirror manifest into app_config so the DB fallback never goes stale. */
async function mirrorAppUpdateConfig(db: D1Database, m: any): Promise<void> {
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT)`).run();
    const rows: [string, string][] = [
      ['android_update_version_code', String(Number(m.versionCode || 0))],
      ['android_update_version_name', String(m.versionName || '')],
      ['android_update_apk_url', String(m.apkUrl || '')],
      ['android_update_mandatory', m.mandatory ? '1' : '0'],
      ['android_update_notes', String(m.notes || '')],
    ];
    for (const [k, v] of rows) {
      await db
        .prepare(`INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
        .bind(k, v)
        .run();
    }
  } catch { /* best-effort */ }
}

/** R2 key when the URL is served by our own CDN base; null for external URLs. */
function cdnKeyForUrl(env: any, url: string): string | null {
  const base = appUpdateCdnBase(env);
  const u = String(url || '').trim();
  if (!u.startsWith(base + '/')) return null;
  return decodeURIComponent(u.slice(base.length + 1));
}

/** v0.7 — does the APK the manifest points at actually exist on our CDN?
 * Saving latest.json never uploads the binary: the admin UI must say so. */
async function cdnApkExists(env: any, url: string): Promise<boolean | null> {
  if (!env?.IMAGES) return null;
  const key = cdnKeyForUrl(env, url);
  if (!key) return null;
  try {
    return !!(await env.IMAGES.head(key));
  } catch {
    return null;
  }
}

/** Current manifest + R2 object metadata for the admin UI. */

export function registerReportsAndUpdatesRoutes(app: Hono<any>, deps: ReportsAndUpdatesDeps): void {
  const { authFailReason, sessionUserFromHeader: sessionUserFromHeaderLocal, getOwnerUsername, clientIp, isRateLimited } = deps;

  /* ── v260 — Crash & user reports → GitHub issues (docs/reports-github.md) ──
   * crash_reports: automatic intake from the app's global error handlers.
   * user_reports: "Signaler un problème" from any logged-in account.
   * GitHub sync is opt-in: env GITHUB_ISSUE_TOKEN secret or the owner-set
   * app_config token (in-app, never echoed). Without one, everything queues
   * in D1 and the daily cron drains it once configured — no report is lost. */
  app.post('/api/crash-reports', async (c) => {
    const ip = clientIp(c);
    const limited = await isRateLimited(c.env.DB, ip);
    if (limited.blocked) return c.json({ success: false, error: limited.reason, code: 'RATE_LIMITED' }, 429);
    let body: any = {};
    try { body = await c.req.json(); } catch { body = {}; }
    try {
      await ensureReportTables(c.env.DB);
      const out = await reportCrash(c.env.DB, c.env, body, ip);
      return c.json({ success: true, data: { reference: `C-${out.id}`, deduped: out.deduped } }, 202);
    } catch {
      // Intake must never break the app: acknowledge even if D1/GitHub fails.
      return c.json({ success: true, data: { reference: null } }, 202);
    }
  });
  
  app.post('/api/reports', async (c) => {
    const ip = clientIp(c);
    const fingerprint = String(c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
    const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, ip, fingerprint);
    if (reason !== 'ok') return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
    const limited = await isRateLimited(c.env.DB, ip);
    if (limited.blocked) return c.json({ success: false, error: limited.reason, code: 'RATE_LIMITED' }, 429);
    const session = sessionUserFromHeaderLocal(c.req.header('Authorization'));
    let body: any = {};
    try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'Requête invalide', code: 'BAD_REQUEST' }, 400); }
    const message = String(body?.message || '').trim();
    if (message.length < 5 || message.length > 2000) {
      return c.json({ success: false, error: 'Le message doit contenir entre 5 et 2000 caractères.', code: 'BAD_REQUEST' }, 400);
    }
    // Capture the immutable account ID around a second proof check. Looking up
    // the ID after GitHub delivery could bind a report to a recreated username.
    const name = String(session.username || '').toLowerCase();
    const owner = name === getOwnerUsername(c.env) && session.role === 'owner';
    let userId: number | null = null;
    if (!owner) {
      try {
        const before = await c.env.DB.prepare('SELECT id, role FROM app_users WHERE username = ? AND active = 1').bind(name).first() as any;
        if (before?.role === session.role && Number.isSafeInteger(before.id) && before.id > 0 &&
            await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, ip, fingerprint) === 'ok') {
          const after = await c.env.DB.prepare('SELECT id, role FROM app_users WHERE username = ? AND active = 1').bind(name).first() as any;
          if (after?.id === before.id && after.role === session.role) userId = before.id;
        }
      } catch { /* report is accepted, but no unverified ID is bound */ }
    }
    if (!owner && !userId) return c.json({ success: false, error: 'Impossible de vérifier le compte', code: 'AUTH_UNAVAILABLE' }, 503);
    await ensureReportTables(c.env.DB);
    let out;
    try {
    out = await reportUser(c.env.DB, c.env, {
      username: String(session.username || ''),
      role: String(session.role || ''),
      kind: String(body?.kind || 'bug'),
      message,
      contact: body?.contact ? String(body.contact) : '',
      page: body?.page ? String(body.page) : '',
      version: body?.version ? String(body.version) : '',
    }, id => recordReportOwner(c.env.DB, id, owner, userId), { owner, userId });
    } catch { return c.json({ success: false, error: 'Signalement indisponible', code: 'SERVICE_UNAVAILABLE' }, 503); }
    return c.json({ success: true, data: { reference: out.reference, issue_url: out.issue_url || null, already_reported: out.already_reported, issue_status: out.issue_status } }, 201);
  });
  
  /** Owner-only GitHub token management — the token is NEVER returned. */
  
  async function reportsOwnerSession(c: any, env: any, db: any, ip: string): Promise<{ username: string; role: string } | null> {
    const fingerprint = String(c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
    const reason = await authFailReason(c.req.header('Authorization'), env, db, ip, fingerprint);
    if (reason !== 'ok') return null;
    return sessionUserFromHeaderLocal(c.req.header('Authorization'));
  }
  
  app.get('/api/admin/github-token', async (c) => {
    const ip = clientIp(c);
    const session = await reportsOwnerSession(c, c.env, c.env.DB, ip);
    if (!session) return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
    if (session.role !== 'owner') return c.json({ success: false, error: 'Réservé au propriétaire', code: 'FORBIDDEN' }, 403);
    await ensureReportTables(c.env.DB);
    const cfg = await githubConfig(c.env);
    return c.json({ success: true, data: { configured: !!cfg.token, source: cfg.source, repo: cfg.repo } });
  });
  
  app.put('/api/admin/github-token', async (c) => {
    const ip = clientIp(c);
    const session = await reportsOwnerSession(c, c.env, c.env.DB, ip);
    if (!session) return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
    if (session.role !== 'owner') return c.json({ success: false, error: 'Réservé au propriétaire', code: 'FORBIDDEN' }, 403);
    let body: any = {};
    try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'Requête invalide', code: 'BAD_REQUEST' }, 400); }
    const token = String(body?.token || '').trim();
    const repo = String(body?.repo || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').replace(/^\/+|\/+$/g, '');
    await ensureReportTables(c.env.DB);
    if (!token) {
      await saveGithubConfig(c.env.DB, '', repo);
      return c.json({ success: true, data: { configured: false } });
    }
    if (token.length > 300 || !/^[A-Za-z0-9_]+$/.test(token)) {
      return c.json({ success: false, error: 'Format de token invalide', code: 'BAD_REQUEST' }, 400);
    }
    const v = await validateGithubToken(token);
    if (!v.ok) return c.json({ success: false, error: v.error || 'Token invalide', code: 'INVALID_TOKEN' }, 400);
    await saveGithubConfig(c.env.DB, token, repo || REPORTS_REPO_DEFAULT);
    return c.json({ success: true, data: { configured: true, login: v.login || null, repo: repo || REPORTS_REPO_DEFAULT } });
  });
  
  app.get('/api/admin/reports', async (c) => {
    const ip = clientIp(c);
    const session = await reportsOwnerSession(c, c.env, c.env.DB, ip);
    if (!session) return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
    if (session.role !== 'owner' && session.role !== 'admin') {
      return c.json({ success: false, error: 'Réservé au propriétaire/admin', code: 'FORBIDDEN' }, 403);
    }
    await ensureReportTables(c.env.DB);
    const data = await listReports(c.env.DB, Number(c.req.query('limit') || 25));
    return c.json({ success: true, data });
  });
  
  app.post('/api/admin/reports/retry', async (c) => {
    const ip = clientIp(c);
    const session = await reportsOwnerSession(c, c.env, c.env.DB, ip);
    if (!session) return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
    if (session.role !== 'owner') return c.json({ success: false, error: 'Réservé au propriétaire', code: 'FORBIDDEN' }, 403);
    await ensureReportTables(c.env.DB);
    const out = await retryPendingReports(c.env);
    if (out.skipped) {
      return c.json({ success: false, error: 'Aucun token GitHub configuré — ajoutez-le d’abord.', code: 'GITHUB_NOT_CONFIGURED' }, 409);
    }
    return c.json({ success: true, data: out });
  });
  
  
  app.get('/api/admin/app-update', async (c) => {
    const gate = gateAppUpdateAdmin(c);
    if (!gate.ok) return c.json({ success: false, error: gate.error }, gate.status as any);
    const { manifest, source, jsonMeta, apk } = await readAppUpdateState(c.env);
    const base = appUpdateCdnBase(c.env);
    const policy = await readMinVersionPolicy(c.env.DB, { bypassCache: true });
    return c.json({
      success: true,
      data: {
        minimumVersionEnabled: policy.enabled,
        minimumSupportedVersionCode: policy.code,
        manifest: manifest || {
          versionCode: 0,
          versionName: '',
          apkUrl: `${base}/${APP_UPDATE_APK_KEY}`,
          mandatory: false,
          notes: '',
        },
        source,
        json: { key: APP_UPDATE_JSON_KEY, url: `${base}/${APP_UPDATE_JSON_KEY}`, size: jsonMeta?.size ?? null, uploaded: jsonMeta?.uploaded ?? null },
        apk: { key: APP_UPDATE_APK_KEY, url: `${base}/${APP_UPDATE_APK_KEY}`, size: apk?.size ?? null, uploaded: apk?.uploaded ?? null },
        apkUrlExists: await cdnApkExists(c.env, manifest?.apkUrl || ''),
        maxApkBytes: APP_UPDATE_MAX_APK_BYTES,
      },
    });
  });
  
  /** Save (create/replace) latest.json on R2 + mirror to app_config. */
  app.put('/api/admin/app-update', async (c) => {
    const gate = gateAppUpdateAdmin(c);
    if (!gate.ok) return c.json({ success: false, error: gate.error }, gate.status as any);
    let body: any = {};
    try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'JSON invalide' }, 400); }
    const versionCode = Math.floor(Number(body.versionCode));
    if (!Number.isFinite(versionCode) || versionCode < 1) {
      return c.json({ success: false, error: 'versionCode invalide (entier ≥ 1)' }, 400);
    }
    const versionName = String(body.versionName || '').trim().slice(0, 64);
    if (!versionName) return c.json({ success: false, error: 'versionName obligatoire' }, 400);
    let apkUrl = String(body.apkUrl || '').trim();
    if (!apkUrl) apkUrl = `${appUpdateCdnBase(c.env)}/${APP_UPDATE_APK_KEY}`;
    if (!/^https:\/\/\S+$/i.test(apkUrl)) return c.json({ success: false, error: 'apkUrl doit être une URL https://' }, 400);
    const manifest = {
      versionCode,
      versionName,
      apkUrl,
      mandatory: body.mandatory === true || body.mandatory === 'true' || body.mandatory === 1,
      notes: String(body.notes || '').slice(0, 4000),
    };
    // v0.7 — minimum supported Android version. Keys absent → keep current
    // policy (a manifest rewrite must never drop it). Keys present → validate
    // against the release being saved, then persist (app_config = truth) and
    // mirror into the manifest so the public check echoes it.
    const currentPolicy = await readMinVersionPolicy(c.env.DB, { bypassCache: true });
    const hasPolicyKeys =
      body.minimumVersionEnabled !== undefined || body.minimumSupportedVersionCode !== undefined;
    const requestedPolicy: MinVersionPolicy = hasPolicyKeys
      ? parseMinVersionPolicy(
          body.minimumVersionEnabled !== undefined
            ? body.minimumVersionEnabled
            : currentPolicy.enabled,
          body.minimumSupportedVersionCode !== undefined
            ? body.minimumSupportedVersionCode
            : currentPolicy.code,
        )
      : currentPolicy;
    const policyError = validateMinVersionPolicy(requestedPolicy, manifest);
    if (policyError) return c.json({ success: false, error: policyError }, 400);
    const manifestWithMin = manifestWithPolicy(manifest, requestedPolicy);
    if (hasPolicyKeys || requestedPolicy.enabled) {
      try {
        await writeMinVersionPolicy(c.env.DB, requestedPolicy);
      } catch (e: any) {
        console.error('[app-update] policy persist failed', String(e?.message || e).slice(0, 200));
        return c.json({ success: false, error: 'Échec persistance de la politique' }, 500);
      }
    }
    if (c.env.IMAGES) {
      try {
        await c.env.IMAGES.put(APP_UPDATE_JSON_KEY, JSON.stringify(manifestWithMin, null, 2), {
          httpMetadata: { contentType: 'application/json', cacheControl: 'no-cache, max-age=0, must-revalidate' },
          customMetadata: { updated_by: gate.username, updated_at: new Date().toISOString() },
        });
      } catch (e: any) {
        return c.json({ success: false, error: `Échec écriture R2 : ${e?.message || e}` }, 502);
      }
    }
    await mirrorAppUpdateConfig(c.env.DB, manifestWithMin);
    return c.json({
      success: true,
      data: {
        manifest: manifestWithMin,
        minimumVersionEnabled: requestedPolicy.enabled,
        minimumSupportedVersionCode: requestedPolicy.code,
        storage: c.env.IMAGES ? 'r2+db' : 'db',
        apkUrlExists: await cdnApkExists(c.env, manifest.apkUrl),
      },
    });
  });
  
  /** Upload latest.apk (raw binary body streamed to R2 — no full buffering). */
  app.post('/api/admin/app-update/apk', async (c) => {
    const gate = gateAppUpdateAdmin(c);
    if (!gate.ok) return c.json({ success: false, error: gate.error }, gate.status as any);
    if (!c.env.IMAGES) return c.json({ success: false, error: 'Binding R2 (IMAGES) absent' }, 501);
    const len = Number(c.req.header('Content-Length') || 0);
    if (len > APP_UPDATE_MAX_APK_BYTES) return c.json({ success: false, error: 'APK trop lourd (max 200 Mo)' }, 413);
    const stream = c.req.raw.body;
    if (!stream) return c.json({ success: false, error: 'Corps APK absent' }, 400);
    try {
      await c.env.IMAGES.put(APP_UPDATE_APK_KEY, stream as any, {
        httpMetadata: { contentType: APP_UPDATE_APK_MIME, cacheControl: 'no-cache, max-age=0, must-revalidate' },
        customMetadata: { updated_by: gate.username, updated_at: new Date().toISOString() },
      });
    } catch (e: any) {
      return c.json({ success: false, error: `Échec upload R2 : ${e?.message || e}` }, 502);
    }
    const head = await c.env.IMAGES.head(APP_UPDATE_APK_KEY).catch(() => null);
    const base = appUpdateCdnBase(c.env);
    // If the manifest exists but has no apkUrl yet, point it at the APK we just stored.
    try {
      const { manifest } = await readAppUpdateState(c.env);
      if (manifest && !String(manifest.apkUrl || '').trim()) {
        manifest.apkUrl = `${base}/${APP_UPDATE_APK_KEY}`;
        if (c.env.IMAGES) {
          await c.env.IMAGES.put(APP_UPDATE_JSON_KEY, JSON.stringify(manifest, null, 2), {
            httpMetadata: { contentType: 'application/json', cacheControl: 'public, max-age=60' },
            customMetadata: { updated_by: gate.username, updated_at: new Date().toISOString() },
          });
        }
        await mirrorAppUpdateConfig(c.env.DB, manifest);
      }
    } catch { /* best-effort */ }
    return c.json({
      success: true,
      data: { key: APP_UPDATE_APK_KEY, size: head?.size ?? len, url: `${base}/${APP_UPDATE_APK_KEY}` },
    });
  });
}
