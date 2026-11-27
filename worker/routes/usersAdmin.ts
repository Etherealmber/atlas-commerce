import type { AtlasApp } from './types';
import { DEMO_USERNAME } from '../lib/demo/policy';
import { API_LOG_RETENTION_DAYS, classifyNetwork, ensureApiLogTable, geoForIps } from '../lib/apiLog';
import { explainLogLine } from '../lib/auditExplain';
import { listArchivedJournal, readArchivedJournal } from '../lib/journalArchive';
import { schemaOnce, addColumnIfMissing } from '../lib/schema';
import { ensureDocAssetColumns } from '../lib/printTemplates';
import {
  kvGetJson,
  kvPutJson,
  invalidateDashboardCache,
  settingsCacheKey,
  DEFAULT_CACHE_TTL,
} from '../lib/cache';
import { uploadDataUrlImage } from '../lib/r2';
import { purgeDeletedAccountFromBackups } from './backups';
import { listAllToolNames } from '../lib/agent';
import {
  ensureHmacKeyColumns,
  ensureInvoiceRefundColumns,
  sha256Hex,
  validateCreditPrefix,
  validateNextCreditNumber,
} from '../lib/ledgerHelpers';
import {
  ensureRevokedWebTokensTable,
  isNativeV3AuthHeader,
  parseAuthorizationHeader,
  revokeWebToken,
  webTokenHash,
} from '../lib/authHelpers';

interface UsersAdminDeps {
  authFailReason: any;
  cfGeo: any;
  checkConfirmPassword: any;
  clientIp: any;
  ensureSecurityTables: any;
  getConfig: any;
  getOwnerUsername: any;
  getPassword: any;
  getReputation: any;
  hashUserPassword: any;
  makeSessionProof: any;
  makeTokenV2: any;
  normalizePassword: any;
  parseToken: any;
  randomChallenge: any;
  readProfileFromDo: any;
  refreshLimitGate: any;
  requireBizMutator: any;
  requireOwner: any;
  resolveUserProfileAvatar: any;
  sessionUserFromHeader: any;
  setConfig: any;
  touchTrustedDevice: any;
  writeAudit: any;
  writeProfileToDo: any;
  ensureHrSettings: any;
  issueDeleteOtp: any;
}

export function registerUsersAdminRoutes(app: AtlasApp, deps: UsersAdminDeps) {
  const {
    authFailReason,
    cfGeo,
    checkConfirmPassword,
    clientIp,
    ensureSecurityTables,
    getConfig,
    getOwnerUsername,
    getPassword,
    getReputation,
    hashUserPassword,
    makeSessionProof,
    makeTokenV2,
    normalizePassword,
    parseToken,
    randomChallenge,
    readProfileFromDo,
    refreshLimitGate,
    requireOwner,
    resolveUserProfileAvatar,
    sessionUserFromHeader,
    setConfig,
    touchTrustedDevice,
    writeAudit,
    writeProfileToDo,
  } = deps;

app.post('/api/admin/users', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  const body = await c.req.json().catch(() => ({}));
  const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
  if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);

  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  const displayName = String(body.display_name || username).trim();
  const role = ['admin', 'secretaire', 'stock', 'user'].includes(String(body.role))
    ? String(body.role)
    : 'user';
  const email = String(body.email || '').trim().toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return c.json({ success: false, error: 'Adresse e-mail invalide' }, 400);
  }

  if (!username || username.length < 2) {
    return c.json({ success: false, error: 'Nom d\'utilisateur trop court (min. 2 caractères)' }, 400);
  }
  if (!/^[a-z0-9._-]+$/.test(username)) {
    return c.json({ success: false, error: 'Nom d\'utilisateur: lettres minuscules, chiffres, . _ - uniquement' }, 400);
  }
  if (username === DEMO_USERNAME) {
    return c.json({ success: false, error: 'Ce nom est réservé au compte de démonstration.', code: 'USERNAME_RESERVED' }, 400);
  }
  if (username === getOwnerUsername(c.env)) {
    return c.json({ success: false, error: 'Ce nom est réservé à l\'administrateur principal' }, 400);
  }
  if (normalizePassword(password).length < 6) {
    return c.json({ success: false, error: 'Mot de passe: minimum 6 caractères' }, 400);
  }

  await ensureSecurityTables(c.env.DB);
  const existing = await c.env.DB.prepare(`SELECT id FROM app_users WHERE username = ?`).bind(username).first();
  if (existing) return c.json({ success: false, error: 'Cet utilisateur existe déjà' }, 409);

  const salt = randomChallenge().slice(0, 16);
  const password_hash = await hashUserPassword(password, salt);
  await c.env.DB.prepare(
    `INSERT INTO app_users (username, password_hash, password_salt, role, display_name, created_by, email)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(username, password_hash, salt, role, displayName, gate.username, email).run();

  await writeAudit(c.env.DB, {
    username: gate.username, role: 'owner', action: 'user.create', entity: 'app_users',
    entity_id: username, detail: `role=${role}`, ip: c.req.header('cf-connecting-ip') || '',
  });
  return c.json({ success: true, message: `Utilisateur « ${username} » créé.` });
});

app.delete('/api/admin/users/:id', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  const body = await c.req.json().catch(() => ({}));
  const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
  if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);

  const id = Number(c.req.param('id'));
  await ensureSecurityTables(c.env.DB);
  const row = await c.env.DB.prepare(`SELECT * FROM app_users WHERE id = ?`).bind(id).first() as any;
  if (!row) return c.json({ success: false, error: 'Utilisateur introuvable' }, 404);
  const uname = String(row.username || '').trim().toLowerCase();
  await c.env.DB.prepare(`DELETE FROM app_users WHERE id = ?`).bind(id).run();
  if (uname) {
    try { await c.env.DB.prepare(`DELETE FROM trusted_devices WHERE lower(username) = ?`).bind(uname).run(); } catch { /* */ }
    try { await c.env.DB.prepare(`DELETE FROM webauthn_credentials WHERE lower(username) = ?`).bind(uname).run(); } catch { /* */ }
    try { await c.env.DB.prepare(`DELETE FROM push_tokens WHERE lower(username) = ?`).bind(uname).run(); } catch { /* */ }
    try { await c.env.DB.prepare(`DELETE FROM device_push_tokens WHERE lower(username) = ?`).bind(uname).run(); } catch { /* */ }
    try { await purgeDeletedAccountFromBackups(c.env, uname); } catch { /* */ }
  }
  return c.json({ success: true, message: `Utilisateur « ${row.username} » supprimé.` });
});


app.put('/api/admin/users/:id', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  const body = await c.req.json().catch(() => ({}));
  const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
  if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);

  const id = Number(c.req.param('id'));
  await ensureSecurityTables(c.env.DB);
  const row = await c.env.DB.prepare(`SELECT * FROM app_users WHERE id = ?`).bind(id).first() as any;
  if (!row) return c.json({ success: false, error: 'Utilisateur introuvable' }, 404);

  const display_name = body.display_name != null ? String(body.display_name).trim() : row.display_name;
  let role = row.role;
  if (body.role && ['admin', 'secretaire', 'stock', 'user'].includes(String(body.role))) {
    role = String(body.role);
  }
  const active = body.active === false || body.active === 0 ? 0 : 1;
  let email = String(row.email || '');
  if (body.email != null) {
    email = String(body.email).trim().toLowerCase();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return c.json({ success: false, error: 'Adresse e-mail invalide' }, 400);
    }
  }

  if (body.password && normalizePassword(body.password).length >= 6) {
    const salt = randomChallenge().slice(0, 16);
    const password_hash = await hashUserPassword(body.password, salt);
    await c.env.DB.prepare(
      `UPDATE app_users SET display_name = ?, role = ?, active = ?, password_hash = ?, password_salt = ?, email = ? WHERE id = ?`
    ).bind(display_name, role, active, password_hash, salt, email, id).run();
  } else {
    await c.env.DB.prepare(
      `UPDATE app_users SET display_name = ?, role = ?, active = ?, email = ? WHERE id = ?`
    ).bind(display_name, role, active, email, id).run();
  }

  return c.json({ success: true, message: `Utilisateur « ${row.username} » mis à jour.` });
});


app.get('/api/admin/audit', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  // The legacy endpoint is D1-backed; never silently read it in buffered R2 mode.
  if (c.env.JOURNAL_ARCHIVE_MODE === 'buffered' && c.env.ATLAS_DEMO !== '1') {
    return c.json({ success: false, code: 'JOURNAL_R2_ONLY', error: 'Consultez les archives R2. Cette vue historique D1 est désactivée.' }, 503);
  }
  await ensureSecurityTables(c.env.DB);

  // Cursor-based (keyset) pagination — stable and cheap on D1 free tier.
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 40)));
  const cursorRaw = (c.req.query('cursor') || '').trim();
  const cursorId = cursorRaw ? Math.max(0, Math.floor(Number(cursorRaw))) : 0;
  const action = (c.req.query('action') || '').trim();
  const username = (c.req.query('username') || '').trim().toLowerCase();
  const q = (c.req.query('q') || '').trim();
  const range = (c.req.query('range') || '7d').trim(); // 24h | 7d | 30d | all
  const wantStats = c.req.query('stats') === '1';

  let where = '1=1';
  const binds: any[] = [];
  if (range === '24h') {
    where += " AND created_at >= datetime('now', '-1 day')";
  } else if (range === '30d') {
    where += " AND created_at >= datetime('now', '-30 days')";
  } else if (range !== 'all') {
    where += " AND created_at >= datetime('now', '-7 days')";
  }
  if (cursorId > 0) {
    where += ' AND id < ?';
    binds.push(cursorId);
  }
  if (action) {
    where += ' AND action = ?';
    binds.push(action);
  }
  if (username) {
    where += ' AND LOWER(username) = ?';
    binds.push(username);
  }
  if (q) {
    where += ' AND (detail LIKE ? OR entity LIKE ? OR action LIKE ? OR username LIKE ?)';
    const like = `%${q}%`;
    binds.push(like, like, like, like);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT id, username, role, action, entity, entity_id, detail, ip, created_at
     FROM audit_log WHERE ${where}
     ORDER BY id DESC
     LIMIT ?`
  ).bind(...binds, limit + 1).all();

  const rows = (results || []) as any[];
  const has_more = rows.length > limit;
  const page = has_more ? rows.slice(0, limit) : rows;
  const next_cursor = has_more && page.length ? String(page[page.length - 1].id) : null;
  // City / country / operator / VPN flag for each IP, from what Cloudflare told
  // us on that IP's latest API call (api_log). No external geo-IP lookup.
  const geo = await geoForIps(c.env.DB, page.map((r) => String(r.ip || '')));
  for (const r of page) {
    const g = geo.get(String(r.ip || ''));
    if (g) r.geo = g;
  }

  let stats: any = null;
  if (wantStats && cursorId === 0) {
    try {
      // One indexed pass (idx_audit_log_created) gives the current window AND
      // the previous window of the same length, so the KPIs can show a real
      // comparison ("14 vs 6 the previous 24 h") instead of a global metric.
      const span = range === '24h' ? '-1 day' : range === '30d' ? '-30 days' : range === 'all' ? null : '-7 days';
      const prevSpan = range === '24h' ? '-2 days' : range === '30d' ? '-60 days' : '-14 days';
      const rangeSql = span ? `created_at >= datetime('now', '${span}')` : '1=1';
      const kpi = span
        ? await c.env.DB.prepare(
          `SELECT
             SUM(CASE WHEN created_at >= datetime('now', ?) THEN 1 ELSE 0 END) AS cur,
             SUM(CASE WHEN created_at <  datetime('now', ?) THEN 1 ELSE 0 END) AS prev,
             COUNT(DISTINCT CASE WHEN created_at >= datetime('now', ?) THEN username END) AS actors,
             COUNT(DISTINCT CASE WHEN created_at <  datetime('now', ?) THEN username END) AS prev_actors
           FROM audit_log WHERE created_at >= datetime('now', ?)`,
        ).bind(span, span, span, span, prevSpan).first() as any
        : await c.env.DB.prepare(
          `SELECT COUNT(*) AS cur, COUNT(DISTINCT username) AS actors FROM audit_log`,
        ).first() as any;
      const { results: topActions } = await c.env.DB.prepare(
        `SELECT action, COUNT(*) as n FROM audit_log WHERE ${rangeSql} GROUP BY action ORDER BY n DESC LIMIT 8`,
      ).all();
      const { results: byDay } = await c.env.DB.prepare(
        `SELECT substr(created_at, 1, 10) as day, COUNT(*) as n
         FROM audit_log WHERE ${rangeSql}
         GROUP BY substr(created_at, 1, 10)
         ORDER BY day ASC
         LIMIT 40`,
      ).all();
      stats = {
        total: Number(kpi?.cur || 0),
        unique_actors: Number(kpi?.actors || 0),
        // null for "all" — there is no previous window to compare with.
        previous_total: span ? Number(kpi?.prev || 0) : null,
        previous_actors: span ? Number(kpi?.prev_actors || 0) : null,
        top_actions: topActions || [],
        by_day: byDay || [],
        range,
        capped: false,
      };
    } catch {
      stats = null;
    }
  }

  return c.json({
    success: true,
    data: page,
    meta: {
      limit,
      has_more,
      next_cursor,
      cursor: cursorId > 0 ? String(cursorId) : null,
      range,
      stats,
    },
  });
});

/** Owner-only, bounded backlog visibility. No event content or key is returned. */
app.get('/api/admin/journal-buffer-status', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  c.header('Cache-Control', 'no-store');
  if (c.env.JOURNAL_ARCHIVE_MODE !== 'buffered' || !c.env.JOURNAL_BUFFER || !c.env.JOURNAL_ARCHIVE || c.env.JOURNAL_ARCHIVE === c.env.IMAGES) {
    return c.json({ success: false, code: 'JOURNAL_UNCONFIGURED', error: 'Journal R2 non configuré.' }, 503);
  }
  try {
    const stub = c.env.JOURNAL_BUFFER.get(c.env.JOURNAL_BUFFER.idFromName('journal-v1'));
    const res = await stub.fetch('https://journal-buffer/health');
    if (!res.ok) throw new Error('unavailable');
    const data = await res.json();
    return c.json({ success: true, data });
  } catch { return c.json({ success: false, code: 'JOURNAL_UNAVAILABLE', error: 'État du journal indisponible.' }, 503); }
});

/** Owner/admin access to the optional private shadow archive; never expose bucket URLs. */
app.get('/api/admin/journal-archive', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  c.header('Cache-Control', 'no-store');
  const day = String(c.req.query('day') || '');
  const cursor = String(c.req.query('cursor') || '');
  const kind = c.req.query('kind') || 'api';
  if (kind !== 'api' && kind !== 'audit') return c.json({ success: false, error: 'Type invalide.' }, 400);
  if (cursor.length > 2048) return c.json({ success: false, error: 'Curseur invalide.' }, 400);
  try {
    const result = await listArchivedJournal(c.env, day, cursor || undefined, kind);
    return c.json({ success: true, data: result.keys, meta: { next_cursor: result.cursor, mode: c.env.JOURNAL_ARCHIVE_MODE } });
  } catch (e) {
    if (e instanceof Error && e.message === 'Invalid archive date') return c.json({ success: false, error: 'Date invalide.' }, 400);
    return c.json({ success: false, error: 'Archive indisponible.' }, 503);
  }
});
app.get('/api/admin/journal-archive/item', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  c.header('Cache-Control', 'no-store');
  try {
    const kind = c.req.query('kind') || 'api';
    if (kind !== 'api' && kind !== 'audit') return c.json({ success: false, error: 'Type invalide.' }, 400);
    const row = await readArchivedJournal(c.env, String(c.req.query('key') || ''), kind);
    if (!row) return c.json({ success: false, error: 'Entrée introuvable.' }, 404);
    return c.json({ success: true, data: row });
  } catch { return c.json({ success: false, error: 'Archive indisponible.' }, 503); }
});

/** Journal des appels API — eligible API calls, including failures, 30 days. */
app.get('/api/admin/api-log', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  // The legacy endpoint is D1-backed; never silently read it in buffered R2 mode.
  if (c.env.JOURNAL_ARCHIVE_MODE === 'buffered' && c.env.ATLAS_DEMO !== '1') {
    return c.json({ success: false, code: 'JOURNAL_R2_ONLY', error: 'Consultez les archives R2. Cette vue historique D1 est désactivée.' }, 503);
  }
  await ensureApiLogTable(c.env.DB);
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 40)));
  const cursorId = Math.max(0, Math.floor(Number(c.req.query('cursor') || 0))) || 0;
  const range = (c.req.query('range') || '24h').trim();
  const status = (c.req.query('status') || '').trim(); // '' | ok | error | auth
  const q = (c.req.query('q') || '').trim();
  const ip = (c.req.query('ip') || '').trim();
  const span = range === '7d' ? '-7 days' : range === '30d' ? '-30 days' : '-1 day';
  let where = `created_at >= datetime('now', '${span}')`;
  const binds: unknown[] = [];
  if (cursorId > 0) { where += ' AND id < ?'; binds.push(cursorId); }
  if (status === 'ok') where += ' AND status < 400';
  else if (status === 'error') where += ' AND status >= 400';
  else if (status === 'auth') where += ' AND status IN (401, 403)';
  if (ip) { where += ' AND ip = ?'; binds.push(ip); }
  if (q) {
    where += ' AND (path LIKE ? OR username LIKE ? OR ip LIKE ? OR as_org LIKE ? OR city LIKE ?)';
    const like = `%${q}%`;
    binds.push(like, like, like, like, like);
  }
  const { results } = await c.env.DB.prepare(
    `SELECT id, created_at, method, path, status, ms, username, role, ip, country, city, region, asn, as_org, ua, surface
     FROM api_log WHERE ${where} ORDER BY id DESC LIMIT ?`,
  ).bind(...binds, limit + 1).all();
  const rows = (results || []) as any[];
  const has_more = rows.length > limit;
  const page = (has_more ? rows.slice(0, limit) : rows).map((r) => ({ ...r, network: classifyNetwork(r.as_org, r.asn, r.ip) }));
  let stats: unknown = null;
  if (c.req.query('stats') === '1' && cursorId === 0) {
    try {
      const k = await c.env.DB.prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors,
                SUM(CASE WHEN status IN (401, 403) THEN 1 ELSE 0 END) AS auth_failures,
                COUNT(DISTINCT ip) AS ips,
                CAST(AVG(ms) AS INTEGER) AS avg_ms
         FROM api_log WHERE created_at >= datetime('now', ?)`,
      ).bind(span).first() as any;
      // Aggregate the period once from D1, then derive both charts from the
      // grouped rows. Avoid a second full period scan just for the daily chart.
      const { results: chartRows } = await c.env.DB.prepare(
        `WITH daily_paths AS MATERIALIZED (
           SELECT substr(created_at, 1, 10) AS day, method, path, COUNT(*) AS n,
                  SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) AS errors
           FROM api_log WHERE created_at >= datetime('now', ?)
           GROUP BY day, method, path
         )
         SELECT 'path' AS kind, method, path, NULL AS day, n, errors FROM (
           SELECT method, path, SUM(n) AS n, SUM(errors) AS errors
           FROM daily_paths GROUP BY method, path ORDER BY n DESC, method, path LIMIT 6
         )
         UNION ALL
         SELECT 'day' AS kind, NULL AS method, NULL AS path, day, SUM(n) AS n, SUM(errors) AS errors
         FROM daily_paths GROUP BY day ORDER BY kind, day, n DESC`,
      ).bind(span).all();
      const topPaths = ((chartRows || []) as any[]).filter(row => row.kind === 'path')
        .map(({ method, path, n, errors }) => ({ method, path, n, errors }))
        .sort((a, b) => Number(b.n) - Number(a.n) || String(a.method).localeCompare(String(b.method)) || String(a.path).localeCompare(String(b.path)));
      const byDay = ((chartRows || []) as any[]).filter(row => row.kind === 'day')
        .map(({ day, n, errors }) => ({ day, n, errors }));
      const { results: nets } = await c.env.DB.prepare(
        `SELECT as_org, asn, COUNT(*) AS n FROM api_log WHERE created_at >= datetime('now', ?) AND (as_org IS NOT NULL OR asn IS NOT NULL)
         GROUP BY as_org, asn ORDER BY n DESC LIMIT 40`,
      ).bind(span).all();
      const risky = ((nets || []) as any[]).filter((n) => classifyNetwork(n.as_org, n.asn).risky).reduce((a, n) => a + Number(n.n || 0), 0);
      stats = {
        total: Number(k?.total || 0), errors: Number(k?.errors || 0), auth_failures: Number(k?.auth_failures || 0),
        unique_ips: Number(k?.ips || 0), avg_ms: Number(k?.avg_ms || 0), risky_calls: risky,
        top_paths: topPaths, by_day: byDay, retention_days: API_LOG_RETENTION_DAYS, range,
      };
    } catch { stats = null; }
  }
  return c.json({ success: true, data: page, meta: { limit, has_more, next_cursor: has_more && page.length ? String(page[page.length - 1].id) : null, range, stats } });
});

/** « Expliquer » — plain-French explanation of one audit / API log line (Groq free tier, cached). */
app.post('/api/admin/audit/explain', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  // The legacy endpoint is D1-backed; never silently read it in buffered R2 mode.
  if (c.env.JOURNAL_ARCHIVE_MODE === 'buffered' && c.env.ATLAS_DEMO !== '1') {
    return c.json({ success: false, code: 'JOURNAL_R2_ONLY', error: 'Consultez les archives R2. Cette vue historique D1 est désactivée.' }, 503);
  }
  const body = (await c.req.json().catch(() => ({}))) as { kind?: string; id?: unknown; language?: string };
  const kind = body.kind === 'api' ? 'api' : 'audit';
  const id = Math.floor(Number(body.id));
  if (!Number.isFinite(id) || id <= 0) return c.json({ success: false, error: 'Ligne introuvable.' }, 400);
  let row: any = null;
  if (kind === 'api') {
    await ensureApiLogTable(c.env.DB);
    row = await c.env.DB.prepare('SELECT * FROM api_log WHERE id = ?').bind(id).first();
  } else {
    await ensureSecurityTables(c.env.DB);
    row = await c.env.DB.prepare('SELECT id, created_at, username, role, action, entity, entity_id, detail, ip FROM audit_log WHERE id = ?').bind(id).first();
    if (row?.ip) {
      const g = (await geoForIps(c.env.DB, [String(row.ip)])).get(String(row.ip));
      if (g) Object.assign(row, { country: g.country, city: g.city, asn: g.asn, as_org: g.as_org });
    }
  }
  if (!row) return c.json({ success: false, error: 'Ligne introuvable.' }, 404);
  let recent = { failures: 0, users: 0 };
  if (row.ip) {
    try {
      await ensureApiLogTable(c.env.DB);
      const r = await c.env.DB.prepare(
        `SELECT SUM(CASE WHEN status IN (401, 403) THEN 1 ELSE 0 END) AS f, COUNT(DISTINCT username) AS u
         FROM api_log WHERE ip = ? AND created_at >= datetime('now', '-1 day')`,
      ).bind(String(row.ip)).first() as any;
      recent = { failures: Number(r?.f || 0), users: Number(r?.u || 0) };
    } catch { /* */ }
  }
  const explanation = await explainLogLine(c.env as any, {
    kind, id, ...row, language: body.language === 'ar' || body.language === 'en' ? body.language : 'fr', ip_recent_failures: recent.failures, ip_recent_users: recent.users,
  });
  return c.json({ success: true, data: { ...explanation, network: classifyNetwork(row.as_org, row.asn, row.ip) } });
});

/** Phase 2: export audit log (CSV or JSON) — owner only, capped to protect free tier. */
app.get('/api/admin/audit/export', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  // The legacy endpoint is D1-backed; never silently read it in buffered R2 mode.
  if (c.env.JOURNAL_ARCHIVE_MODE === 'buffered' && c.env.ATLAS_DEMO !== '1') {
    return c.json({ success: false, code: 'JOURNAL_R2_ONLY', error: 'Consultez les archives R2. Cette vue historique D1 est désactivée.' }, 503);
  }
  await ensureSecurityTables(c.env.DB);
  const format = ((c.req.query('format') || 'csv').toLowerCase() === 'json') ? 'json' : 'csv';
  const max = Math.min(2000, Math.max(1, Number(c.req.query('limit') || 500)));
  const { results } = await c.env.DB.prepare(
    `SELECT id, created_at, username, role, action, entity, entity_id, detail, ip
     FROM audit_log ORDER BY id DESC LIMIT ?`
  ).bind(max).all();
  const rows = (results || []) as any[];

  await writeAudit(c.env.DB, {
    username: gate.username,
    role: 'owner',
    action: 'audit.export',
    entity: 'audit_log',
    detail: `format=${format};count=${rows.length}`,
    ip: c.req.header('cf-connecting-ip') || '',
  });

  if (format === 'json') {
    return c.json({ success: true, data: rows, meta: { count: rows.length, limit: max } });
  }

  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = 'id,created_at,username,role,action,entity,entity_id,detail,ip';
  const lines = rows.map((r) =>
    [r.id, r.created_at, r.username, r.role, r.action, r.entity, r.entity_id, r.detail, r.ip].map(esc).join(',')
  );
  const body = [header, ...lines].join('\n');
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});


/** Atlas Agent permission mode — owner/admin only */
app.get('/api/admin/agent-permissions', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  await ensureSecurityTables(c.env.DB);
  const mode = await getConfig(c.env.DB, 'agent_perm_mode', 'full');
  const toolsRaw = await getConfig(c.env.DB, 'agent_perm_tools', '[]');
  let tools: string[] = [];
  try { tools = JSON.parse(toolsRaw); } catch { tools = []; }
  return c.json({
    success: true,
    data: {
      mode: mode === 'read_only' || mode === 'custom' ? mode : 'full',
      tools,
      available: listAllToolNames(),
      groups: {
        stock: ['get_dashboard_snapshot', 'search_products', 'get_product', 'list_low_stock', 'warehouse_stock', 'list_warehouses', 'list_actions_pending', 'summarize_pending_actions', 'explain_pending_action', 'propose_inventory_adjustment', 'anomaly_notes'],
        sales: ['list_open_quotes', 'list_unpaid_invoices', 'list_recent_invoices', 'get_invoice_brief', 'search_clients', 'draft_client_message', 'propose_quote_lines', 'closing_pack', 'draft_day_close_report'],
      },
    },
  });
});

app.put('/api/admin/agent-permissions', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  await ensureSecurityTables(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const mode = String(body.mode || 'full');
  if (!['full', 'read_only', 'custom'].includes(mode)) {
    return c.json({ success: false, error: 'mode invalide' }, 400);
  }
  await setConfig(c.env.DB, 'agent_perm_mode', mode);
  if (Array.isArray(body.tools)) {
    const clean = body.tools.map((x: any) => String(x)).filter(Boolean).slice(0, 40);
    await setConfig(c.env.DB, 'agent_perm_tools', JSON.stringify(clean));
  }
  await writeAudit(c.env.DB, {
    username: gate.username,
    role: 'owner',
    action: 'agent.permissions_update',
    entity: 'atlas_agent',
    detail: mode,
    ip: clientIp(c),
  });
  return c.json({ success: true, message: 'Permissions agent enregistrées.' });
});


app.get('/api/admin/config', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  await ensureSecurityTables(c.env.DB);
  const attestation = await getConfig(c.env.DB, 'webauthn_attestation', 'none');
  const userVerification = await getConfig(c.env.DB, 'webauthn_user_verification', 'preferred');
  const fido2Only = await getConfig(c.env.DB, 'webauthn_fido2_only', '0');
  return c.json({
    success: true,
    data: {
      owner_username: getOwnerUsername(c.env),
      password_configured: !!getPassword(c.env),
      password_secret_format: {
        name: 'ADMIN_PASSWORD',
        rules: [
          'Cloudflare Workers → Settings → Variables → Secrets',
          'Nom exact: ADMIN_PASSWORD',
          'Valeur = mot de passe en clair, SANS guillemets',
          'Pas d\'espaces avant/après (ils sont ignorés au trim)',
          'Optionnel: ADMIN_USERNAME (défaut: admin)',
        ],
        example: 'MonMotDePasse2024!',
      },
      webauthn: {
        attestation, // none | indirect | direct | enterprise
        user_verification: userVerification, // required | preferred | discouraged
        fido2_only: fido2Only === '1',
        attestation_types: {
          none: 'Pas d\'attestation (recommandé, vie privée)',
          indirect: 'Attestation anonymisée via un service',
          direct: 'Attestation complète du fabricant (AAGUID)',
          enterprise: 'Attestation entreprise (déploiements gérés)',
        },
        fido2_notes: [
          'FIDO2 / WebAuthn Level 2 — authentifiants plateforme (biométrie) et roaming (clés USB/NFC)',
          'Les clés certifiées FIDO2 apparaissent avec un AAGUID reconnu',
          'userVerification=required force PIN/biométrie sur la clé',
        ],
      },
      otp_to: c.env.OTP_TO || '',
      otp_from: c.env.OTP_FROM || '',
      environment: c.env.ENVIRONMENT || 'production',
    },
  });
});

app.put('/api/admin/config', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  const body = await c.req.json().catch(() => ({}));
  const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
  if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);

  await ensureSecurityTables(c.env.DB);
  if (body.webauthn_attestation) {
    const allowed = ['none', 'indirect', 'direct', 'enterprise'];
    if (allowed.includes(body.webauthn_attestation)) {
      await setConfig(c.env.DB, 'webauthn_attestation', body.webauthn_attestation);
    }
  }
  if (body.webauthn_user_verification) {
    const allowed = ['required', 'preferred', 'discouraged'];
    if (allowed.includes(body.webauthn_user_verification)) {
      await setConfig(c.env.DB, 'webauthn_user_verification', body.webauthn_user_verification);
    }
  }
  if (body.webauthn_fido2_only != null) {
    await setConfig(c.env.DB, 'webauthn_fido2_only', body.webauthn_fido2_only ? '1' : '0');
  }
  return c.json({ success: true, message: 'Configuration administrateur enregistrée.' });
});

// Same-origin avatar proxy: cdn1 has no CORS headers, so clients fetch
// through the worker (server-side fetch is not CORS-bound).
app.get('/api/me/avatar', async (c) => {
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  if (!session?.username) return c.json({ success: false, error: 'Non authentifié' }, 401);
  const prof = await resolveUserProfileAvatar(c.env, session.username);
  const url = String(prof.avatar_url || '').trim();
  if (!url) return c.json({ success: false, error: 'Aucun avatar' }, 404);
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',');
    const meta = url.slice(5, comma);
    const payload = url.slice(comma + 1);
    let bytes: Uint8Array;
    if (/;base64$/i.test(meta)) {
      const bin = atob(payload);
      bytes = new Uint8Array(bin.length);
      for (let i2 = 0; i2 < bin.length; i2++) bytes[i2] = bin.charCodeAt(i2);
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(payload));
    }
    return new Response(bytes as unknown as BodyInit, {
      headers: { 'Content-Type': meta.split(';')[0] || 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' },
    });
  }
  // v243 — Durable-Object blob cache first (warm DO = sub-ms), then edge-cached
  // origin fetch; both keyed by a hash of the avatar URL so uploads invalidate.
  let version = 5381;
  for (let i2 = 0; i2 < url.length; i2++) version = ((version * 33) ^ url.charCodeAt(i2)) >>> 0;
  const vkey = String(version);
  let bytes: Uint8Array | null = null;
  let ctype = 'image/jpeg';
  let doStub: DurableObjectStub | null = null;
  try {
    if (c.env.MOBILE_HUB) {
      doStub = c.env.MOBILE_HUB.get(c.env.MOBILE_HUB.idFromName('profile:' + session.username));
      const hit = await doStub.fetch(`https://do/avatar?v=${vkey}`);
      // A cold / version-mismatched cache returns 204, not image bytes.
      if (hit.status === 200) {
        bytes = new Uint8Array(await hit.arrayBuffer());
        ctype = hit.headers.get('x-avatar-ctype') || ctype;
      }
    }
  } catch { /* DO cold/unavailable — fall through to origin */ }
  if (!bytes) {
    try {
      const r = await fetch(url, {
        headers: { Accept: 'image/*' },
        cf: { cacheTtl: 86400, cacheEverything: true } as any,
      });
      if (!r.ok) return c.json({ success: false, error: 'Avatar indisponible' }, 502);
      ctype = r.headers.get('Content-Type') || ctype;
      bytes = new Uint8Array(await r.arrayBuffer());
      if (doStub && bytes.byteLength <= 4_000_000) {
        c.executionCtx?.waitUntil(
          doStub
            .fetch(`https://do/avatar?v=${vkey}`, {
              method: 'PUT',
              headers: { 'x-avatar-ctype': ctype },
              body: bytes.slice() as unknown as BodyInit,
            })
            .catch(() => {}),
        );
      }
    } catch (e) {
      console.error('avatar proxy', String((e as any)?.message || e).slice(0, 200));
      return c.json({ success: false, error: 'Avatar indisponible' }, 502);
    }
  }
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': ctype,
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=86400',
    },
  });
});

/** v0.7.5 — déconnexion VOLONTAIRE : l'appareil de confiance reste connu et est
 *  marqué « reprenable » 30 j pour le MÊME compte → reconnexion mot de passe seul
 *  (2FA désactivée). Un appareil révoqué ou un autre compte restent exclus. */
app.post('/api/auth/logout', async (c) => {
  const authHeader = c.req.header('Authorization');
  const parsedAuth = parseAuthorizationHeader(authHeader);
  if (parsedAuth?.token.startsWith('np1.') || parsedAuth?.token.startsWith('nv3.')) {
    return c.json({ success: false, code: 'USE_NATIVE_LOGOUT', error: 'Utilisez la déconnexion native.' }, 400);
  }
  if (!parsedAuth || parsedAuth.scheme !== 'Bearer') {
    return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Session invalide' }, 401);
  }
  const fingerprint = String(c.req.header('X-Device-Fingerprint') || '').slice(0, 128);
  const sess = sessionUserFromHeader(authHeader);
  await ensureSecurityTables(c.env.DB);
  let resumePrepared = false;
  if (fingerprint && sess?.username) {
    try {
      await ensureRevokedWebTokensTable(c.env.DB);
      const tokenHash = await webTokenHash(parsedAuth.token);
      const batchRes: any[] = await c.env.DB.batch([
        c.env.DB
          .prepare(`INSERT OR IGNORE INTO revoked_web_tokens (token_hash, username, revoked_at) VALUES (?, ?, ?)`)
          .bind(tokenHash, String(sess.username).toLowerCase(), Date.now()),
        c.env.DB
          .prepare(`UPDATE trusted_devices SET resume_until = datetime('now', '+30 days') WHERE fingerprint = ? AND lower(username) = ?`)
          .bind(fingerprint, String(sess.username).toLowerCase()),
      ]);
      resumePrepared = Number(batchRes[1]?.meta?.changes || 0) > 0;
    } catch {
      return c.json({ success: false, resume_prepared: false, code: 'RESUME_PREPARATION_FAILED', error: 'Déconnexion serveur impossible.' }, 503);
    }
    await writeAudit(c.env.DB, {
      username: sess.username,
      role: sess.role || '',
      action: 'auth.logout',
      entity: 'session',
      detail: 'self_logout_resume_30d',
      ip: clientIp(c),
    });
  } else {
    try {
      await revokeWebToken(c.env.DB, parsedAuth.token, sess?.username || '');
    } catch {
      return c.json({ success: false, resume_prepared: false, code: 'LOGOUT_REVOCATION_FAILED', error: 'Déconnexion serveur impossible.' }, 503);
    }
    if (sess?.username) {
      await writeAudit(c.env.DB, {
        username: sess.username,
        role: sess.role || '',
        action: 'auth.logout',
        entity: 'session',
        detail: 'self_logout_revoked',
        ip: clientIp(c),
      });
    }
  }
  return c.json({ success: true, resume_prepared: resumePrepared });
});

// Only this exchange accepts a stale-role proof. Business routes continue to
// reject it, including print/report paths, until a current token is issued.
app.post('/api/auth/role-refresh', async (c) => {
  const header = c.req.header('Authorization');
  const parsedAuth = parseAuthorizationHeader(header);
  if (!parsedAuth || parsedAuth.scheme !== 'Bearer' || parsedAuth.token.startsWith('np1.') || parsedAuth.token.startsWith('nv3.')) {
    return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Session invalide' }, 401);
  }
  const token = parseToken(parsedAuth.token);
  if (!token || token.version !== 2) return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Session invalide' }, 401);
  // Verify again here: do not rely on an unverified routing identity or body.
  if (await authFailReason(header, c.env, c.env.DB, clientIp(c), c.req.header('X-Device-Fingerprint'), { allowRoleRefresh: true }) !== 'ok')
    return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Session invalide' }, 401);
  const inputHash = await webTokenHash(parsedAuth.token);
  const username = String(token.username || '').toLowerCase();
  let role: string;
  let material: string;
  if (username === getOwnerUsername(c.env) && token.role === 'owner') {
    role = 'owner';
    material = await sha256Hex(`owner-key|${username}|${normalizePassword(getPassword(c.env) || '')}`);
  } else {
    const row = await c.env.DB.prepare(`SELECT role, password_hash FROM app_users WHERE username = ? AND active = 1`).bind(username).first() as any;
    if (!row || !['user', 'stock', 'secretaire', 'admin'].includes(String(row.role))) return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Session invalide' }, 401);
    role = row.role;
    material = String(row.password_hash || '');
    // A password change between checks must never refresh an old proof.
    if (token.proof !== await makeSessionProof(username, String(token.role || ''), material, token.ip, token.fingerprint, token.sid))
      return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Session invalide' }, 401);
  }
  const refreshed = await makeTokenV2(username, role, material, token.ip, token.fingerprint);
  await ensureRevokedWebTokensTable(c.env.DB);
  const refreshedHash = await webTokenHash(refreshed);
  const raceRevoked = await c.env.DB
    .prepare(
      `INSERT OR IGNORE INTO revoked_web_tokens (token_hash, username, revoked_at)
       SELECT ?, ?, ?
       WHERE EXISTS (SELECT 1 FROM revoked_web_tokens WHERE token_hash = ?)
       RETURNING token_hash`,
    )
    .bind(refreshedHash, username, Date.now(), inputHash)
    .first();
  if (raceRevoked) {
    return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Session invalide' }, 401);
  }
  return c.json({ success: true, data: { token: refreshed, username, role } });
});

// Profile details from « Modifier le profil » (migration 0021). Stored in D1 for
// every login — owner included — so they follow the user to every device.
const PROFILE_PREFS_DEFAULT_TZ = 'Africa/Casablanca';
type ProfilePrefs = { timezone: string; working_hours: string; job_title: string; profile_updated_at: string };
const emptyProfilePrefs = (): ProfilePrefs => ({ timezone: PROFILE_PREFS_DEFAULT_TZ, working_hours: '', job_title: '', profile_updated_at: '' });
async function ensureProfilePrefsTable(db: D1Database): Promise<void> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS user_profile_prefs (
       username TEXT PRIMARY KEY,
       timezone TEXT NOT NULL DEFAULT 'Africa/Casablanca',
       working_hours TEXT NOT NULL DEFAULT '',
       job_title TEXT NOT NULL DEFAULT '',
       updated_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`,
  ).run();
}
async function readProfilePrefs(db: D1Database, username: string): Promise<ProfilePrefs> {
  try {
    await ensureProfilePrefsTable(db);
    const row = await db
      .prepare(`SELECT timezone, working_hours, job_title, updated_at FROM user_profile_prefs WHERE username = ?`)
      .bind(username)
      .first() as any;
    if (!row) return emptyProfilePrefs();
    return {
      timezone: String(row.timezone || PROFILE_PREFS_DEFAULT_TZ),
      working_hours: String(row.working_hours || ''),
      job_title: String(row.job_title || ''),
      profile_updated_at: String(row.updated_at || ''),
    };
  } catch {
    return emptyProfilePrefs();
  }
}
/** Valid IANA zone (as understood by the runtime), at most 64 chars; otherwise null. */
function cleanTimeZone(raw: unknown): string | null {
  const tz = String(raw ?? '').trim();
  if (!tz || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return null;
  try {
    const resolved = new Intl.DateTimeFormat('en-US', { timeZone: tz }).resolvedOptions().timeZone;
    return resolved ? tz : null;
  } catch {
    return null;
  }
}

app.get('/api/auth/me', async (c) => {
  const limited = refreshLimitGate(c, 'auth-me', 60);
  if (limited) return limited;
  const ip = clientIp(c);
  const fp = c.req.header('X-Device-Fingerprint') || undefined;
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, ip, fp);
  if (reason !== 'ok') {
    const code = reason === 'ip_changed' ? 'IP_CHANGED' : reason === 'fp_changed' ? 'DEVICE_CHANGED' : 'UNAUTHORIZED';
    return c.json({ success: false, error: 'Session invalide', code, currentIp: ip }, 401);
  }
  await ensureSecurityTables(c.env.DB);
  const authHeader = c.req.header('Authorization');
  const session = sessionUserFromHeader(authHeader);
  const parsedAuth = parseAuthorizationHeader(authHeader);
  const isNativeV3 = isNativeV3AuthHeader(authHeader);
  // v243.2 — every active device (web/phone/desktop) keeps its IP & app version up to date immediately.
  try {
    const isPilot = parsedAuth?.scheme === 'Bearer' && parsedAuth.token.startsWith('np1.');
    if (!isNativeV3) {
      await touchTrustedDevice(c.env.DB, session.username, fp || '', ip, c.req.header('User-Agent') || '', cfGeo(c), isPilot ? { updateOnly: true } : undefined);
    }
  } catch { /* best-effort */ }
  const ownerUser = getOwnerUsername(c.env);
  const rep = await getReputation(c.env.DB, ip).catch(() => ({ score: 50 })) as any;
  let profile: any = {
    display_name: session.role === 'owner' ? 'Administrateur' : session.username,
    email: '',
    phone: '',
    avatar_url: '',
    notes: '',
  };
  // Prefer free-tier Durable Object profile (fast, survives D1 free limits)
  const fromDo = await readProfileFromDo(c.env, session.username);
  if (fromDo && (fromDo.display_name || fromDo.email || fromDo.phone || fromDo.avatar_url || fromDo.notes)) {
    profile = { ...profile, ...fromDo };
    if (!profile.display_name) {
      profile.display_name = session.role === 'owner' ? 'Administrateur' : session.username;
    }
  } else if (session.username === ownerUser || session.role === 'owner') {
    const keys = ['owner_display_name', 'owner_email', 'owner_phone', 'owner_avatar_url', 'owner_notes'];
    for (const k of keys) {
      const r = await c.env.DB.prepare(`SELECT value FROM app_config WHERE key = ?`).bind(k).first() as any;
      if (!r?.value) continue;
      if (k === 'owner_display_name') profile.display_name = r.value;
      if (k === 'owner_email') profile.email = r.value;
      if (k === 'owner_phone') profile.phone = r.value;
      if (k === 'owner_avatar_url') profile.avatar_url = r.value;
      if (k === 'owner_notes') profile.notes = r.value;
    }
    if (!profile.display_name) profile.display_name = 'Administrateur';
  } else {
    const row = await c.env.DB.prepare(
      `SELECT display_name, email, phone, avatar_url, notes, role FROM app_users WHERE username = ?`
    ).bind(session.username).first() as any;
    if (row) {
      profile = {
        display_name: row.display_name || session.username,
        email: row.email || '',
        phone: row.phone || '',
        avatar_url: row.avatar_url || '',
        notes: row.notes || '',
      };
    }
  }
  const parsedTok = parsedAuth?.scheme === 'Bearer' ? parseToken(parsedAuth.token) : null;
  const preserveSid = parsedTok?.version === 2 ? parsedTok.sid : undefined;
  return c.json({
    success: true,
    data: {
      ok: true,
      ip,
      username: session.username,
      role: session.role,
      is_owner: session.role === 'owner' || session.role === 'admin',
      reputationScore: rep.score,
      ...(isNativeV3
        ? {}
        : {
            token: await makeTokenV2(
              session.username,
              session.role,
              session.username === ownerUser
                ? await sha256Hex(`owner-key|${session.username}|${normalizePassword(getPassword(c.env))}`)
                : String((await c.env.DB.prepare(`SELECT password_hash FROM app_users WHERE username = ?`).bind(session.username).first() as any)?.password_hash || ''),
              ip,
              fp || 'none',
              preserveSid,
            ),
          }),
      ...profile,
      ...(await readProfilePrefs(c.env.DB, session.username)),
    },
  });
});

/** Self profile update — role is NEVER changeable here */
app.patch('/api/auth/me', async (c) => {
  const ip = clientIp(c);
  const fp = c.req.header('X-Device-Fingerprint') || undefined;
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, ip, fp);
  if (reason !== 'ok') {
    return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  }
  await ensureSecurityTables(c.env.DB);
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const ownerUser = getOwnerUsername(c.env);
  const body = await c.req.json().catch(() => ({}));
  if (body.role != null) {
    return c.json({
      success: false,
      error: 'Vous ne pouvez pas modifier votre rôle. Contactez un administrateur pour plus d\'accès.',
      code: 'ROLE_LOCKED',
    }, 403);
  }
  if (body.username != null || body.login != null || body.user != null) {
    return c.json({
      success: false,
      error: 'L\'identifiant ne peut pas être modifié ici. Contactez un administrateur.',
      code: 'USERNAME_LOCKED',
    }, 403);
  }
  if (body.password != null || body.new_password != null || body.password_hash != null || body.current_password != null) {
    return c.json({
      success: false,
      error: 'Le mot de passe ne peut pas être modifié depuis le profil. Demandez à un administrateur.',
      code: 'PASSWORD_LOCKED',
    }, 403);
  }
  const display_name = body.display_name != null ? String(body.display_name).trim().slice(0, 80) : undefined;
  const email = body.email != null ? String(body.email).trim().slice(0, 120) : undefined;
  const phone = body.phone != null ? String(body.phone).trim().slice(0, 40) : undefined;
  const notes = body.notes != null ? String(body.notes).trim().slice(0, 300) : undefined;

  // Avatar: data-URL → R2 CDN (data URLs are too large for D1 / 500-char slice)
  let avatar_url: string | undefined = undefined;
  if (body.avatar_url != null) {
    const raw = String(body.avatar_url).trim();
    if (!raw) {
      avatar_url = '';
    } else if (raw.startsWith('data:image') && c.env.IMAGES) {
      const safeUser = session.username.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'user';
      const key = `avatars/${safeUser}/${Date.now().toString(36)}.jpg`;
      const cdn = await uploadDataUrlImage(c.env.IMAGES, c.env, raw, key);
      if (!cdn) {
        return c.json({ success: false, error: 'Impossible d\'enregistrer la photo (format ou taille). Utilisez JPG/PNG < 4 Mo.' }, 400);
      }
      avatar_url = cdn;
    } else if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('/')) {
      avatar_url = raw.slice(0, 500);
    } else if (raw.startsWith('data:image')) {
      // No R2 — keep short placeholder message
      return c.json({
        success: false,
        error: 'Stockage images (R2) indisponible. Configurez le bucket IMAGES ou utilisez une URL https.',
      }, 503);
    } else {
      avatar_url = raw.slice(0, 500);
    }
  }

  let timezone: string | undefined;
  if (body.timezone != null) {
    const tz = cleanTimeZone(body.timezone);
    if (!tz) return c.json({ success: false, error: 'Fuseau horaire invalide.', code: 'INVALID_TIMEZONE' }, 400);
    timezone = tz;
  }
  const working_hours = body.working_hours != null ? String(body.working_hours).trim().slice(0, 40) : undefined;
  const job_title = body.job_title != null ? String(body.job_title).trim().slice(0, 60) : undefined;

  // Time zone, hours and job title live in D1 (user_profile_prefs). Every
  // successful PATCH stamps updated_at, which the UI shows as « Mis à jour ».
  let prefsOut: ProfilePrefs;
  try {
    await ensureProfilePrefsTable(c.env.DB);
    const cur = await readProfilePrefs(c.env.DB, session.username);
    await c.env.DB.prepare(
      `INSERT INTO user_profile_prefs (username, timezone, working_hours, job_title, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(username) DO UPDATE SET
         timezone = excluded.timezone,
         working_hours = excluded.working_hours,
         job_title = excluded.job_title,
         updated_at = excluded.updated_at`,
    ).bind(
      session.username,
      timezone ?? cur.timezone,
      working_hours ?? cur.working_hours,
      job_title ?? cur.job_title,
    ).run();
    prefsOut = await readProfilePrefs(c.env.DB, session.username);
  } catch (prefErr: any) {
    console.error('profile_prefs_write_failed', String(prefErr?.message || prefErr));
    return c.json({ success: false, error: 'Impossible d’enregistrer le profil. Réessayez.', code: 'PROFILE_SAVE_FAILED' }, 500);
  }

  // Always write to free-tier Durable Object first (source of truth for profile UX)
  const existingDo = await readProfileFromDo(c.env, session.username);
  const mergedForDo = {
    display_name:
      display_name != null
        ? display_name
        : existingDo?.display_name || (session.role === 'owner' ? 'Administrateur' : session.username),
    email: email != null ? email : existingDo?.email || '',
    phone: phone != null ? phone : existingDo?.phone || '',
    avatar_url: avatar_url != null ? avatar_url : existingDo?.avatar_url || '',
    notes: notes != null ? notes : existingDo?.notes || '',
  };
  const savedDo = await writeProfileToDo(c.env, session.username, mergedForDo);

  if (session.username === ownerUser || session.role === 'owner') {
    const put = async (k: string, v: string) => {
      await c.env.DB.prepare(
        `INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
      ).bind(k, v).run();
    };
    if (display_name != null) await put('owner_display_name', display_name);
    if (email != null) await put('owner_email', email);
    if (phone != null) await put('owner_phone', phone);
    if (avatar_url != null) await put('owner_avatar_url', avatar_url);
    if (notes != null) await put('owner_notes', notes);
    const out = savedDo || {
      display_name: display_name ?? mergedForDo.display_name,
      email: email ?? mergedForDo.email,
      phone: phone ?? mergedForDo.phone,
      avatar_url: avatar_url ?? mergedForDo.avatar_url,
      notes: notes ?? mergedForDo.notes,
    };
    return c.json({
      success: true,
      message: 'Profil mis à jour',
      data: { ...out, ...prefsOut },
    });
  }

  const row = await c.env.DB.prepare(`SELECT id FROM app_users WHERE username = ?`).bind(session.username).first() as any;
  if (!row) {
    // Still ok if DO wrote — owner-only secret user may not be in app_users
    if (savedDo) {
      return c.json({ success: true, message: 'Profil mis à jour', data: { ...savedDo, ...prefsOut } });
    }
    return c.json({ success: false, error: 'Utilisateur introuvable' }, 404);
  }
  const cur = await c.env.DB.prepare(`SELECT * FROM app_users WHERE id = ?`).bind(row.id).first() as any;
  const nextAvatar = avatar_url != null ? avatar_url : (cur.avatar_url || '');
  const nextDisplay = display_name != null ? display_name : (cur.display_name || '');
  const nextEmail = email != null ? email : (cur.email || '');
  const nextPhone = phone != null ? phone : (cur.phone || '');
  const nextNotes = notes != null ? notes : (cur.notes || '');
  try {
    await c.env.DB.prepare(
      `UPDATE app_users SET display_name = ?, email = ?, phone = ?, avatar_url = ?, notes = ? WHERE id = ?`
    ).bind(nextDisplay, nextEmail, nextPhone, nextAvatar, nextNotes, row.id).run();
  } catch {
    /* DO is primary; D1 mirror is best-effort */
  }
  const out = savedDo || {
    display_name: nextDisplay,
    email: nextEmail,
    phone: nextPhone,
    avatar_url: nextAvatar,
    notes: nextNotes,
  };
  return c.json({
    success: true,
    message: 'Profil mis à jour',
    data: { ...out, ...prefsOut },
  });
});

}

export function registerSettingsRoutes(app: AtlasApp, deps: UsersAdminDeps) {
  const {
    ensureHrSettings,
    requireBizMutator,
    sessionUserFromHeader,
    writeAudit,
  } = deps;

app.get('/api/settings' , async (c) => {
  try { await ensureHrSettings(c.env.DB); } catch { /* */ }

  const ttl = Math.max(60, Number(c.env.CACHE_TTL_SECONDS || DEFAULT_CACHE_TTL));
  const cached = await kvGetJson<any>(c.env.CACHE, await settingsCacheKey(c.env.CACHE));
  if (cached) return c.json({ success: true, data: cached, meta: { cache: 'hit' } });

  await ensureDocAssetColumns(c.env.DB);
  await ensureHmacKeyColumns(c.env.DB);
  await ensureInvoiceRefundColumns(c.env.DB);
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  if (settings) {
    const { hmac_secret_current, hmac_secret_previous, ...safe } = settings;
    const data = {
      ...safe,
      hmac_configured: !!(hmac_secret_current || hmac_secret_previous),
      hmac_rotated_at: settings.hmac_rotated_at || null,
      hmac_rotate_days: settings.hmac_rotate_days ?? 90,
    };
    await kvPutJson(c.env.CACHE, await settingsCacheKey(c.env.CACHE), data, ttl);
    return c.json({ success: true, data, meta: { cache: 'miss' } });
  }
  return c.json({ success: true, data: settings });
});

app.put('/api/settings', async (c) => {
  try { await ensureHrSettings(c.env.DB); } catch { /* */ }

  // Company settings: owner / admin / secrétaire only (not stock / user)
  const gate = requireBizMutator(c);
  if (!gate.ok) return gate.response;
  await ensureInvoiceRefundColumns(c.env.DB);
  const body = await c.req.json();

  if (body.credit_prefix !== undefined) {
    const p = validateCreditPrefix(body.credit_prefix);
    if (!p.ok) return c.json({ success: false, error: p.error, code: p.code }, 400);
    body.credit_prefix = p.value;
  }
  if (body.next_credit_number !== undefined) {
    const n = validateNextCreditNumber(body.next_credit_number);
    if (!n.ok) return c.json({ success: false, error: n.error, code: n.code }, 400);
    body.next_credit_number = n.value;
  }
  // Other document prefixes: light sanitize
  for (const key of ['invoice_prefix', 'quote_prefix', 'receipt_prefix', 'bill_prefix'] as const) {
    if (body[key] !== undefined) {
      const v = String(body[key] || '').trim().slice(0, 12);
      if (v && !/^[A-Za-z0-9][A-Za-z0-9\-/]{0,11}$/.test(v)) {
        return c.json({
          success: false,
          error: `Préfixe « ${key} » invalide. Lettres, chiffres, - ou / uniquement (max 12).`,
          code: 'PREFIX_INVALID',
        }, 400);
      }
      body[key] = v;
    }
  }

    // HR flags (0/1)
  if (body.attendance_enabled !== undefined) {
    body.attendance_enabled = body.attendance_enabled ? 1 : 0;
  }
  if (body.attendance_late_grace_pct !== undefined) {
    body.attendance_late_grace_pct = Math.max(0, Math.min(100, Number(body.attendance_late_grace_pct) || 25));
  }
  if (body.attendance_late_block_pct !== undefined) {
    body.attendance_late_block_pct = Math.max(1, Math.min(50, Number(body.attendance_late_block_pct) || 10));
  }
  if (body.attendance_late_half_days !== undefined) {
    body.attendance_late_half_days = Math.max(0, Math.min(5, Number(body.attendance_late_half_days) || 0.5));
  }
  if (body.attendance_late_threshold !== undefined) {
    const th = String(body.attendance_late_threshold || '09:15').trim();
    body.attendance_late_threshold = /^\d{1,2}:\d{2}$/.test(th) ? th.padStart(5, '0') : '09:15';
  }
  if (body.attendance_early_threshold !== undefined) {
    const eth = String(body.attendance_early_threshold || '18:00').trim();
    body.attendance_early_threshold = /^\d{1,2}:\d{2}$/.test(eth) ? eth.padStart(5, '0') : '18:00';
  }
  if (body.attendance_overtime_after_hours !== undefined) {
    body.attendance_overtime_after_hours = Math.max(1, Math.min(24, Number(body.attendance_overtime_after_hours) || 8));
  }
  if (body.attendance_overtime_multiplier !== undefined) {
    body.attendance_overtime_multiplier = Math.max(1, Math.min(3, Number(body.attendance_overtime_multiplier) || 1.25));
  }

  if (body.attendance_half_morning !== undefined) body.attendance_half_morning = String(body.attendance_half_morning || '09:00-13:00').slice(0, 20);
  if (body.attendance_half_afternoon !== undefined) body.attendance_half_afternoon = String(body.attendance_half_afternoon || '14:00-18:00').slice(0, 20);
  if (body.attendance_workday_hours !== undefined) body.attendance_workday_hours = Math.max(1, Math.min(24, Number(body.attendance_workday_hours) || 8));
  if (body.attendance_acompte_week1_pct !== undefined) body.attendance_acompte_week1_pct = Math.max(0, Math.min(50, Number(body.attendance_acompte_week1_pct) || 5));
  if (body.attendance_acompte_week2_pct !== undefined) body.attendance_acompte_week2_pct = Math.max(0, Math.min(50, Number(body.attendance_acompte_week2_pct) || 5));
  if (body.attendance_acompte_week3_pct !== undefined) body.attendance_acompte_week3_pct = Math.max(0, Math.min(50, Number(body.attendance_acompte_week3_pct) || 5));
  if (body.attendance_acompte_week4_pct !== undefined) body.attendance_acompte_week4_pct = Math.max(0, Math.min(50, Number(body.attendance_acompte_week4_pct) || 5));
  if (body.attendance_acompte_monthly_max_pct !== undefined) body.attendance_acompte_monthly_max_pct = Math.max(0, Math.min(50, Number(body.attendance_acompte_monthly_max_pct) || 15));
  if (body.attendance_acompte_short_cycle_days !== undefined) body.attendance_acompte_short_cycle_days = Math.max(1, Math.min(60, Number(body.attendance_acompte_short_cycle_days) || 14));
  if (body.attendance_acompte_short_max_pct !== undefined) body.attendance_acompte_short_max_pct = Math.max(0, Math.min(50, Number(body.attendance_acompte_short_max_pct) || 5));
  if (body.attendance_acompte_require_presence !== undefined) body.attendance_acompte_require_presence = body.attendance_acompte_require_presence ? 1 : 0;
  if (body.attendance_pay_use_presence !== undefined) body.attendance_pay_use_presence = body.attendance_pay_use_presence ? 1 : 0;

  if (body.attendance_minute_deduct !== undefined) body.attendance_minute_deduct = body.attendance_minute_deduct ? 1 : 0;
  if (body.attendance_warn_late_count !== undefined) body.attendance_warn_late_count = Math.max(1, Math.min(30, Number(body.attendance_warn_late_count) || 3));
  if (body.attendance_blame_late_count !== undefined) body.attendance_blame_late_count = Math.max(1, Math.min(60, Number(body.attendance_blame_late_count) || 6));
  if (body.attendance_pay_mode !== undefined) {
    body.attendance_pay_mode = String(body.attendance_pay_mode).toLowerCase() === 'calendar' ? 'calendar' : 'presence';
  }



  const fields = [
    'company_name', 'legal_form', 'address', 'city', 'postal_code', 'country',
    'phone', 'email', 'website', 'ice', 'if_number', 'rc', 'patente', 'cnss',
    'logo_url', 'company_signature_url', 'company_stamp_url', 'currency', 'date_format', 'tax_rate',
    'invoice_prefix', 'quote_prefix', 'receipt_prefix', 'bill_prefix', 'credit_prefix', 'quick_sale_prefix',
    'next_invoice_number', 'next_quote_number', 'next_receipt_number', 'next_bill_number', 'next_credit_number', 'next_quick_sale_number',
    'numbering_style', 'numbering_pad',
    'starting_balance', 'bank_name', 'bank_iban', 'bank_swift', 'notes', 'report_footer', 'show_legal_footer', 'price_decimals', 'retention_cancelled_days', 'document_footer_note', 'pdf_show_logo', 'pdf_show_qr', 'pdf_show_bank', 'pdf_show_stamp', 'pdf_show_promo', 'pdf_accent_color', 'pdf_footer_text', 'qr_client_situation', 'qr_situation_ttl_days', 'client_data_retention_days',
    'multi_warehouse', 'sales_location_id', 'purchase_location_id', 'inventory_valuation_method',
    'secondary_currency', 'secondary_currency_rate',
    'attendance_enabled',
    'attendance_late_threshold',
    'attendance_early_threshold',
    'attendance_overtime_after_hours',
    'attendance_overtime_multiplier',
    'attendance_late_half_days',
    'attendance_late_block_pct',
    'attendance_late_grace_pct',
    'attendance_pay_use_presence',
    'attendance_pay_mode',
    'attendance_blame_late_count',
    'attendance_warn_late_count',
    'attendance_minute_deduct',
    'attendance_acompte_require_presence',
    'attendance_acompte_short_max_pct',
    'attendance_acompte_short_cycle_days',
    'attendance_acompte_week2_pct',
    'attendance_acompte_monthly_max_pct',
    'attendance_acompte_week4_pct',
    'attendance_acompte_week3_pct',
    'attendance_acompte_week1_pct',
    'attendance_workday_hours',
    'attendance_half_afternoon',
    'attendance_half_morning',
    'employee_prefix', 'next_employee_number',
  ];
  const updates: string[] = [];
  const values: any[] = [];
  for (const f of fields) {
    if (body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(body[f]);
    }
  }
  if (updates.length === 0) return c.json({ success: false, error: 'Aucun champ à modifier. Vérifiez les valeurs saisies.', code: 'NO_FIELDS' }, 400);
  updates.push(`updated_at = datetime('now')`);
  try {
    try { await ensureHrSettings(c.env.DB); } catch { /* */ }
    await schemaOnce('settings_extra_cols', async () => {
      await addColumnIfMissing(c.env.DB, 'company_settings', 'secondary_currency', "TEXT DEFAULT ''");
      await addColumnIfMissing(c.env.DB, 'company_settings', 'secondary_currency_rate', 'REAL DEFAULT 0');
      await addColumnIfMissing(c.env.DB, 'company_settings', 'employee_prefix', "TEXT DEFAULT 'EMP-'");
      await addColumnIfMissing(c.env.DB, 'company_settings', 'next_employee_number', 'INTEGER DEFAULT 1');
      await addColumnIfMissing(c.env.DB, 'company_settings', 'tax_rate', 'REAL DEFAULT 20');
    });
    await c.env.DB.prepare(`UPDATE company_settings SET ${updates.join(', ')} WHERE id = 1`).bind(...values).run();
  } catch (e: any) {
    return c.json({
      success: false,
      error: 'Impossible d’enregistrer les paramètres (colonne manquante ou base indisponible). Réessayez après déploiement.',
      code: 'SETTINGS_SAVE_FAILED',
      detail: String(e?.message || e),
    }, 500);
  }
  await invalidateDashboardCache(c.env.CACHE, c.env.MOBILE_HUB);
  try {
    const su = sessionUserFromHeader(c.req.header('Authorization'));
    const changed = fields.filter((f) => body[f] !== undefined).slice(0, 24);
    await writeAudit(c.env.DB, {
      username: su?.username,
      role: su?.role,
      action: 'settings.update',
      entity: 'company_settings',
      entity_id: '1',
      detail: changed.length ? `champs=${changed.join(',')}` : 'settings',
      ip: c.req.header('cf-connecting-ip') || '',
    });
  } catch { /* */ }
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first();
  return c.json({ success: true, data: settings, message: 'Paramètres enregistrés.' });
});

}

