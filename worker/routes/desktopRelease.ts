/**
 * Desktop (Windows) release ingestion & update serving — CDN1 (`app-updates/desktop/`).
 *
 * Mirrors the Android CDN1 pipeline (`worker/routes/androidRelease.ts`) while
 * remaining strictly isolated from Android (never serves or accepts APKs):
 *  - `POST /api/admin/desktop-release` (Bearer DESKTOP_RELEASE_TOKEN):
 *      Streams the signed universal/x86 Windows setup installer to R2 under
 *      `app-updates/desktop/` (versioned file + `latest-setup.exe` alias +
 *      `checksums.txt` + `latest.json`), and deletes ALL previously stored
 *      files under `app-updates/desktop/` so old installers are replaced.
 *  - `GET` / `HEAD /api/app/desktop-update` (public, pre-login):
 *      Returns Windows Desktop update availability, SHA-256, CDN1 URLs, notes,
 *      and `minimum_version` enforcement using semver comparison.
 *  - `GET` / `PUT /api/admin/desktop-update` & `POST /api/admin/desktop-update/installer`
 *      (owner/admin session): manage `app-updates/desktop/latest.json` and
 *      upload an installer from the web Settings panel.
 */
import { Hono } from 'hono';
import type { Env } from '../env';
import { sessionUserFromHeader } from '../lib/authHelpers';
import { normalizeRole } from '../lib/rbac';

export const DESKTOP_UPDATE_PREFIX = 'app-updates/desktop';
export const DESKTOP_JSON_KEY = `${DESKTOP_UPDATE_PREFIX}/latest.json`;
export const DESKTOP_LATEST_EXE_KEY = `${DESKTOP_UPDATE_PREFIX}/latest-setup.exe`;
export const DESKTOP_CHECKSUMS_KEY = `${DESKTOP_UPDATE_PREFIX}/checksums.txt`;
export const DESKTOP_MAX_INSTALLER_BYTES = 250 * 1024 * 1024;
const DESKTOP_EXE_MIME = 'application/vnd.microsoft.portable-executable';
const NO_CACHE_HEADERS = { 'Cache-Control': 'no-cache, max-age=0, must-revalidate' };

export type DesktopManifest = {
  success?: boolean;
  ok?: boolean;
  platform: 'windows';
  arch: string;
  channel: 'stable' | 'prerelease';
  version: string;
  mandatory: boolean;
  minimum_version: string | null;
  sha256: string | null;
  sizeBytes: number | null;
  downloadUrl: string;
  latestUrl: string;
  cdn1Url: string;
  checksumsUrl: string | null;
  githubUrl: string | null;
  notes: string;
  publishedAt: string;
  filename?: string;
};

function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

async function secretMatches(provided: string, expected: string): Promise<boolean> {
  try {
    const enc = new TextEncoder();
    const [a, b] = await Promise.all([
      crypto.subtle.digest('SHA-256', enc.encode(provided)),
      crypto.subtle.digest('SHA-256', enc.encode(expected)),
    ]);
    const ua = new Uint8Array(a);
    const ub = new Uint8Array(b);
    let diff = 0;
    for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ ub[i];
    return diff === 0;
  } catch {
    return false;
  }
}

function b64ToText(b64: string): string {
  try {
    const bin = atob(String(b64 || '').replace(/\s/g, ''));
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

export function desktopCdn1Base(env: Partial<Env>): string {
  if (env.DESKTOP_CDN1_PUBLIC_BASE_URL) {
    return String(env.DESKTOP_CDN1_PUBLIC_BASE_URL).replace(/\/+$/, '');
  }
  const base = String(env.CDN_BASE || 'https://cdn1.afmarbre.com').replace(/\/+$/, '');
  return `${base}/${DESKTOP_UPDATE_PREFIX}`;
}

export function normalizeSemver(raw: string): string | null {
  const trimmed = String(raw || '').trim().replace(/^v/i, '');
  if (!trimmed) return null;
  const m = trimmed.match(/^(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3] ?? '0');
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor) || !Number.isSafeInteger(patch)) return null;
  return `${major}.${minor}.${patch}${m[4] ? `-${m[4]}` : ''}`;
}

export function parseSemverTuple(raw: string): [number, number, number, number, string] | null {
  const norm = normalizeSemver(raw);
  if (!norm) return null;
  const [core, pre = ''] = norm.split('-', 2);
  const [maj, min, pat] = core.split('.').map(Number);
  return [maj, min, pat, pre ? 0 : 1, pre];
}

export function compareSemver(candidate: string, current: string): number {
  const a = parseSemverTuple(candidate);
  const b = parseSemverTuple(current);
  if (!a || !b) return 0;
  for (let i = 0; i < 4; i++) {
    if (a[i] !== b[i]) return (a[i] as number) > (b[i] as number) ? 1 : -1;
  }
  if (a[4] === b[4]) return 0;
  return a[4] > b[4] ? 1 : -1;
}

function sanitizeDesktopFilename(raw: string | null | undefined, version: string): string {
  const fallback = `atlas-commerce-desktop-v${version}-windows-universal-setup.exe`;
  const clean = String(raw || '')
    .trim()
    .split(/[/\\]/)
    .pop()
    ?.replace(/[^0-9A-Za-z._-]/g, '') || '';
  if (!clean || !/\.(exe|msi)$/i.test(clean)) return fallback;
  return clean;
}

function sanitizeArch(raw: string | null | undefined): string {
  const s = String(raw || '').trim().toLowerCase();
  if (!s || s === 'universal' || s === 'universal-x86_64' || s === 'x86_64' || s === 'x64' || s === 'amd64' || s === 'x86') {
    return s === 'x86_64' || s === 'x64' || s === 'amd64' || s === 'x86' ? 'universal-x86_64' : 'universal-x86_64';
  }
  if (s === 'aarch64' || s === 'arm64') return 'universal-x86_64';
  return s.replace(/[^0-9a-z._-]/g, '').slice(0, 32) || 'universal-x86_64';
}

function sanitizeChannel(raw: string | null | undefined): 'stable' | 'prerelease' {
  return String(raw || '').trim().toLowerCase() === 'prerelease' ? 'prerelease' : 'stable';
}

export async function listDesktopAssets(bucket: any): Promise<Array<{ key: string; size: number; uploaded: string | null }>> {
  if (!bucket || typeof bucket.list !== 'function') return [];
  const items: Array<{ key: string; size: number; uploaded: string | null }> = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const res: any = await bucket.list({ prefix: `${DESKTOP_UPDATE_PREFIX}/`, cursor }).catch(() => null);
    if (!res) break;
    for (const obj of (res.objects || []) as any[]) {
      if (obj?.key) {
        items.push({
          key: String(obj.key),
          size: Number(obj.size || 0),
          uploaded: obj.uploaded ? new Date(obj.uploaded).toISOString() : null,
        });
      }
    }
    if (!res.truncated || !res.cursor) break;
    cursor = String(res.cursor);
  }
  return items;
}

/**
 * Deletes every existing object under `app-updates/desktop/` except keys in `keepKeys`
 * so old Windows installers/files are purged on every new release.
 */
export async function purgeOldDesktopAssets(bucket: any, keepKeys: Set<string>): Promise<string[]> {
  if (!bucket) return [];
  const existing = await listDesktopAssets(bucket);
  const toDelete = existing.map((o) => o.key).filter((k) => !keepKeys.has(k));
  if (toDelete.length === 0 || typeof bucket.delete !== 'function') return [];
  try {
    await bucket.delete(toDelete);
  } catch {
    await Promise.all(toDelete.map((k) => bucket.delete(k).catch(() => null)));
  }
  return toDelete;
}

async function readDesktopManifest(env: Partial<Env>): Promise<{
  manifest: DesktopManifest | null;
  source: 'r2' | 'db' | null;
  jsonMeta: { size: number; uploaded: string | null } | null;
  exeMeta: { size: number; uploaded: string | null } | null;
}> {
  let manifest: DesktopManifest | null = null;
  let source: 'r2' | 'db' | null = null;
  let jsonMeta: { size: number; uploaded: string | null } | null = null;
  let exeMeta: { size: number; uploaded: string | null } | null = null;

  if (env.IMAGES) {
    try {
      const head = await env.IMAGES.head(DESKTOP_JSON_KEY);
      if (head) jsonMeta = { size: head.size, uploaded: head.uploaded ? new Date(head.uploaded).toISOString() : null };
      const obj = await env.IMAGES.get(DESKTOP_JSON_KEY);
      if (obj) {
        manifest = JSON.parse(await obj.text()) as DesktopManifest;
        source = 'r2';
      }
    } catch { /* ignore invalid JSON */ }
    try {
      const h = await env.IMAGES.head(DESKTOP_LATEST_EXE_KEY);
      if (h) exeMeta = { size: h.size, uploaded: h.uploaded ? new Date(h.uploaded).toISOString() : null };
    } catch { /* */ }
  }

  if (!manifest && env.DB) {
    try {
      const rows = await env.DB.prepare(`SELECT key, value FROM app_config WHERE key LIKE 'desktop_update_%'`).all();
      const map: Record<string, string> = {};
      for (const r of (rows?.results || []) as any[]) map[String(r.key)] = String(r.value || '');
      if (map.desktop_update_version || map.desktop_update_download_url) {
        const base = desktopCdn1Base(env);
        manifest = {
          platform: 'windows',
          arch: map.desktop_update_arch || 'universal-x86_64',
          channel: sanitizeChannel(map.desktop_update_channel),
          version: map.desktop_update_version || '',
          mandatory: map.desktop_update_mandatory === '1' || map.desktop_update_mandatory === 'true',
          minimum_version: map.desktop_update_minimum_version || null,
          sha256: map.desktop_update_sha256 || null,
          sizeBytes: map.desktop_update_size_bytes ? Number(map.desktop_update_size_bytes) : null,
          downloadUrl: map.desktop_update_download_url || `${base}/latest-setup.exe`,
          latestUrl: `${base}/latest-setup.exe`,
          cdn1Url: map.desktop_update_download_url || `${base}/latest-setup.exe`,
          checksumsUrl: map.desktop_update_sha256 ? `${base}/checksums.txt` : null,
          githubUrl: map.desktop_update_github_url || null,
          notes: map.desktop_update_notes || '',
          publishedAt: map.desktop_update_published_at || '',
        };
        source = 'db';
      }
    } catch { /* */ }
  }

  return { manifest, source, jsonMeta, exeMeta };
}

async function mirrorDesktopConfig(db: D1Database | undefined, m: DesktopManifest): Promise<void> {
  if (!db) return;
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT)`).run();
    const rows: [string, string][] = [
      ['desktop_update_version', String(m.version || '')],
      ['desktop_update_channel', String(m.channel || 'stable')],
      ['desktop_update_arch', String(m.arch || 'universal-x86_64')],
      ['desktop_update_mandatory', m.mandatory ? '1' : '0'],
      ['desktop_update_minimum_version', String(m.minimum_version || '')],
      ['desktop_update_sha256', String(m.sha256 || '')],
      ['desktop_update_size_bytes', m.sizeBytes != null ? String(m.sizeBytes) : ''],
      ['desktop_update_download_url', String(m.downloadUrl || '')],
      ['desktop_update_github_url', String(m.githubUrl || '')],
      ['desktop_update_notes', String(m.notes || '')],
      ['desktop_update_published_at', String(m.publishedAt || '')],
    ];
    for (const [k, v] of rows) {
      await db
        .prepare(`INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
        .bind(k, v)
        .run();
    }
  } catch { /* best-effort */ }
}

function gateDesktopAdmin(c: any): { ok: true; username: string } | { ok: false; status: number; error: string } {
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  if (!session.username) return { ok: false, status: 401, error: 'Non authentifié' };
  const role = normalizeRole(session.role || 'user');
  if (role !== 'owner' && role !== 'admin') return { ok: false, status: 403, error: 'Réservé admin/owner' };
  return { ok: true, username: session.username };
}

export const desktopReleaseRouter = new Hono<{ Bindings: Env }>();

/* ── CI ingestion: Windows setup stream → R2 (purge old + versioned + latest-setup.exe + latest.json) ── */
desktopReleaseRouter.post('/api/admin/desktop-release', async (c) => {
  const env = c.env;
  const expected = String(env.DESKTOP_RELEASE_TOKEN || '').trim();
  if (!expected) return json({ ok: false, success: false, error: 'DESKTOP_RELEASE_TOKEN_UNCONFIGURED' }, 503);

  const authHeader = c.req.header('Authorization') || '';
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!provided || !(await secretMatches(provided, expected))) {
    return json({ ok: false, success: false, error: 'UNAUTHORIZED' }, 401);
  }

  const bucket = env.IMAGES;
  if (!bucket) return json({ ok: false, success: false, error: 'R2_UNAVAILABLE' }, 503);

  const rawVersion = (c.req.header('X-Release-Version') || '').trim();
  const version = normalizeSemver(rawVersion);
  if (!version) return json({ ok: false, success: false, error: 'INVALID_VERSION' }, 400);

  const channel = sanitizeChannel(c.req.header('X-Release-Channel'));
  const arch = sanitizeArch(c.req.header('X-Release-Arch'));
  const filename = sanitizeDesktopFilename(c.req.header('X-Release-Filename'), version);

  const shaHeader = (c.req.header('X-Release-Sha256') || '').trim();
  if (shaHeader && !/^[0-9a-fA-F]{64}$/.test(shaHeader)) {
    return json({ ok: false, success: false, error: 'INVALID_SHA256' }, 400);
  }
  const sha256 = shaHeader ? shaHeader.toLowerCase() : null;

  const rawMinVersion = (c.req.header('X-Release-Minimum-Version') || '').trim();
  let minimumVersion: string | null = null;
  if (rawMinVersion) {
    minimumVersion = normalizeSemver(rawMinVersion);
    if (!minimumVersion) return json({ ok: false, success: false, error: 'INVALID_MINIMUM_VERSION' }, 400);
  }

  const githubHeaderUrl = (c.req.header('X-Release-Github-Url') || '').trim();
  const mandatory = (c.req.header('X-Release-Mandatory') || '').trim() === 'true';
  const notes = b64ToText((c.req.header('X-Release-Notes-B64') || '').trim()).slice(0, 8000);

  const request = c.req.raw;
  const contentLength = Number(request.headers.get('content-length') || '0');
  if (
    !request.body ||
    !Number.isFinite(contentLength) ||
    contentLength < 10_000 ||
    contentLength > DESKTOP_MAX_INSTALLER_BYTES
  ) {
    return json({ ok: false, success: false, error: 'INVALID_INSTALLER_BODY' }, 400);
  }

  // Read prior manifest before replacing so omitted minimum_version stays intact.
  const prevState = await readDesktopManifest(env);
  if (!minimumVersion && prevState.manifest?.minimum_version) {
    minimumVersion = normalizeSemver(prevState.manifest.minimum_version);
  }

  const versionedKey = `${DESKTOP_UPDATE_PREFIX}/${filename}`;
  const [rawA, rawB] = request.body.tee();
  const fixedA = new FixedLengthStream(contentLength);
  const fixedB = new FixedLengthStream(contentLength);
  void rawA.pipeTo(fixedA.writable);
  void rawB.pipeTo(fixedB.writable);

  try {
    await Promise.all([
      bucket.put(versionedKey, fixedA.readable, {
        httpMetadata: { contentType: DESKTOP_EXE_MIME, cacheControl: 'public, max-age=31536000, immutable' },
      }),
      bucket.put(DESKTOP_LATEST_EXE_KEY, fixedB.readable, {
        httpMetadata: { contentType: DESKTOP_EXE_MIME, cacheControl: 'no-cache, max-age=0, must-revalidate' },
      }),
    ]);
  } catch (e) {
    console.error('[desktop-release] R2 put failed', String((e as any)?.message || e).slice(0, 300));
    return json({ ok: false, success: false, error: 'R2_WRITE_FAILED' }, 502);
  }

  const cdn1Base = desktopCdn1Base(env);
  const downloadUrl = `${cdn1Base}/${filename}`;
  const latestUrl = `${cdn1Base}/latest-setup.exe`;
  const checksumsUrl = sha256 ? `${cdn1Base}/checksums.txt` : null;
  const githubUrl =
    githubHeaderUrl ||
    `https://github.com/Etherealmber/atlas-commerce-desktop/releases/download/v${version}/${filename}`;

  const manifest: DesktopManifest = {
    success: true,
    ok: true,
    platform: 'windows',
    arch,
    channel,
    version,
    mandatory,
    minimum_version: minimumVersion,
    sha256,
    sizeBytes: contentLength,
    downloadUrl,
    latestUrl,
    cdn1Url: downloadUrl,
    checksumsUrl,
    githubUrl,
    notes,
    publishedAt: new Date().toISOString(),
    filename,
  };

  const keepKeys = new Set<string>([versionedKey, DESKTOP_LATEST_EXE_KEY, DESKTOP_JSON_KEY]);
  if (sha256) {
    keepKeys.add(DESKTOP_CHECKSUMS_KEY);
    const checksumsBody = `${sha256}  ${filename}\n${sha256}  latest-setup.exe\n`;
    await bucket.put(DESKTOP_CHECKSUMS_KEY, checksumsBody, {
      httpMetadata: { contentType: 'text/plain; charset=utf-8', cacheControl: 'no-cache, max-age=0, must-revalidate' },
    }).catch(() => null);
  }

  try {
    await bucket.put(DESKTOP_JSON_KEY, JSON.stringify(manifest, null, 2), {
      httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-cache, max-age=0, must-revalidate' },
    });
  } catch (e) {
    console.error('[desktop-release] latest.json write failed', String((e as any)?.message || e).slice(0, 300));
    return json({ ok: false, success: false, error: 'MANIFEST_WRITE_FAILED' }, 502);
  }

  const deletedKeys = await purgeOldDesktopAssets(bucket, keepKeys);
  await mirrorDesktopConfig(env.DB, manifest);
  console.log('[desktop-release] ingested', version, filename, contentLength, 'bytes, deleted', deletedKeys.length, 'old file(s)');
  return json({ ok: true, success: true, manifest, deletedKeys });
});

/* ── Public Desktop update check (pre-login) + HEAD ── */
async function buildDesktopUpdateResponse(c: any, head: boolean): Promise<Response> {
  const env = c.env as Env;
  const rawPlatform = String(c.req.query('platform') || 'windows').trim().toLowerCase();
  if (!['windows', 'win', 'win32'].includes(rawPlatform)) {
    return json({ success: false, ok: false, error: 'UNSUPPORTED_PLATFORM', message: 'Plateforme Desktop supportée : windows' }, 400, NO_CACHE_HEADERS);
  }

  const rawVersion = String(c.req.query('version') || '').trim();
  let clientVersion = '0.0.0';
  if (rawVersion && rawVersion !== '0') {
    const parsed = normalizeSemver(rawVersion);
    if (!parsed) {
      return json({ success: false, ok: false, error: 'INVALID_VERSION' }, 400, NO_CACHE_HEADERS);
    }
    clientVersion = parsed;
  }

  const requestedChannel = c.req.query('channel') ? sanitizeChannel(c.req.query('channel')) : null;
  const arch = sanitizeArch(c.req.query('arch'));

  const { manifest } = await readDesktopManifest(env);
  if (!manifest || !manifest.version) {
    const emptyBody = {
      success: true,
      ok: true,
      platform: 'windows',
      arch,
      channel: requestedChannel || 'stable',
      hasRelease: false,
      updateAvailable: false,
      version: null,
      mandatory: false,
      minimum_version: null,
      minimumVersionRequired: false,
      sha256: null,
      sizeBytes: null,
      downloadUrl: null,
      latestUrl: null,
      cdn1Url: null,
      checksumsUrl: null,
      githubUrl: null,
      notes: null,
      publishedAt: null,
      message: 'Aucun manifeste Desktop publié (uploadez app-updates/desktop/latest.json sur R2)',
    };
    if (head) return new Response(null, { status: 200, headers: NO_CACHE_HEADERS });
    return json(emptyBody, 200, NO_CACHE_HEADERS);
  }

  const remoteChannel = sanitizeChannel(manifest.channel);
  // Stable clients ignore prerelease manifests; prerelease clients can install both.
  if (requestedChannel === 'stable' && remoteChannel === 'prerelease') {
    const channelMismatch = {
      success: true,
      ok: true,
      platform: 'windows',
      arch,
      channel: 'stable',
      hasRelease: false,
      updateAvailable: false,
      version: null,
      mandatory: false,
      minimum_version: null,
      minimumVersionRequired: false,
      sha256: null,
      sizeBytes: null,
      downloadUrl: null,
      latestUrl: null,
      cdn1Url: null,
      checksumsUrl: null,
      githubUrl: null,
      notes: null,
      publishedAt: null,
      message: 'Aucune release stable publiée pour le moment',
    };
    if (head) return new Response(null, { status: 200, headers: NO_CACHE_HEADERS });
    return json(channelMismatch, 200, NO_CACHE_HEADERS);
  }

  const remoteVersion = normalizeSemver(manifest.version) || manifest.version;
  const updateAvailable = compareSemver(remoteVersion, clientVersion) > 0;
  const minVer = manifest.minimum_version ? normalizeSemver(manifest.minimum_version) : null;
  const minimumVersionRequired = !!minVer && compareSemver(minVer, clientVersion) > 0;
  const base = desktopCdn1Base(env);
  const downloadUrl = manifest.downloadUrl || `${base}/latest-setup.exe`;

  const body = {
    success: true,
    ok: true,
    platform: 'windows',
    arch: manifest.arch || arch,
    channel: remoteChannel,
    hasRelease: true,
    updateAvailable,
    version: remoteVersion,
    mandatory: !!manifest.mandatory,
    minimum_version: minVer,
    minimumVersionRequired,
    sha256: manifest.sha256 || null,
    sizeBytes: manifest.sizeBytes ?? null,
    downloadUrl,
    latestUrl: manifest.latestUrl || `${base}/latest-setup.exe`,
    cdn1Url: manifest.cdn1Url || downloadUrl,
    checksumsUrl: manifest.checksumsUrl || null,
    githubUrl: manifest.githubUrl || null,
    notes: manifest.notes ?? null,
    publishedAt: manifest.publishedAt || null,
    filename: manifest.filename || null,
  };
  if (head) return new Response(null, { status: 200, headers: NO_CACHE_HEADERS });
  return json(body, 200, NO_CACHE_HEADERS);
}

desktopReleaseRouter.get('/api/app/desktop-update', (c) => buildDesktopUpdateResponse(c, false));
desktopReleaseRouter.on('HEAD', '/api/app/desktop-update', (c) => buildDesktopUpdateResponse(c, true));

/* ── Owner/Admin panel routes ── */
desktopReleaseRouter.get('/api/admin/desktop-update', async (c) => {
  const gate = gateDesktopAdmin(c);
  if (!gate.ok) return c.json({ success: false, error: gate.error }, gate.status as any);
  const { manifest, source, jsonMeta, exeMeta } = await readDesktopManifest(c.env);
  const base = desktopCdn1Base(c.env);
  const files = await listDesktopAssets(c.env.IMAGES);
  return c.json({
    success: true,
    data: {
      manifest: manifest || {
        platform: 'windows',
        arch: 'universal-x86_64',
        channel: 'stable',
        version: '',
        mandatory: false,
        minimum_version: null,
        sha256: null,
        sizeBytes: null,
        downloadUrl: `${base}/latest-setup.exe`,
        latestUrl: `${base}/latest-setup.exe`,
        cdn1Url: `${base}/latest-setup.exe`,
        checksumsUrl: null,
        githubUrl: null,
        notes: '',
        publishedAt: '',
      },
      source,
      json: { key: DESKTOP_JSON_KEY, url: `${base}/latest.json`, size: jsonMeta?.size ?? null, uploaded: jsonMeta?.uploaded ?? null },
      installer: { key: DESKTOP_LATEST_EXE_KEY, url: `${base}/latest-setup.exe`, size: exeMeta?.size ?? null, uploaded: exeMeta?.uploaded ?? null },
      files,
      maxBytes: DESKTOP_MAX_INSTALLER_BYTES,
    },
  });
});

desktopReleaseRouter.put('/api/admin/desktop-update', async (c) => {
  const gate = gateDesktopAdmin(c);
  if (!gate.ok) return c.json({ success: false, error: gate.error }, gate.status as any);
  let body: any = {};
  try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'JSON invalide' }, 400); }

  const version = normalizeSemver(String(body.version || ''));
  if (!version) return c.json({ success: false, error: 'Version semver invalide (ex. 0.9.3)' }, 400);

  const minRaw = String(body.minimum_version || '').trim();
  let minimumVersion: string | null = null;
  if (minRaw) {
    minimumVersion = normalizeSemver(minRaw);
    if (!minimumVersion) return c.json({ success: false, error: 'minimum_version semver invalide' }, 400);
    if (compareSemver(minimumVersion, version) > 0) {
      return c.json({ success: false, error: 'minimum_version ne peut pas dépasser version' }, 400);
    }
  }

  const base = desktopCdn1Base(c.env);
  const downloadUrl = String(body.downloadUrl || '').trim() || `${base}/latest-setup.exe`;
  if (!/^https:\/\/\S+$/i.test(downloadUrl)) {
    return c.json({ success: false, error: 'downloadUrl doit être une URL https://' }, 400);
  }
  const shaRaw = String(body.sha256 || '').trim();
  if (shaRaw && !/^[0-9a-fA-F]{64}$/.test(shaRaw)) {
    return c.json({ success: false, error: 'sha256 invalide (64 caractères hexadécimaux)' }, 400);
  }

  const prev = await readDesktopManifest(c.env);
  const manifest: DesktopManifest = {
    success: true,
    ok: true,
    platform: 'windows',
    arch: 'universal-x86_64',
    channel: sanitizeChannel(body.channel),
    version,
    mandatory: body.mandatory === true || body.mandatory === 'true' || body.mandatory === 1,
    minimum_version: minimumVersion,
    sha256: shaRaw ? shaRaw.toLowerCase() : (prev.manifest?.sha256 ?? null),
    sizeBytes: prev.exeMeta?.size ?? prev.manifest?.sizeBytes ?? null,
    downloadUrl,
    latestUrl: `${base}/latest-setup.exe`,
    cdn1Url: downloadUrl,
    checksumsUrl: prev.manifest?.checksumsUrl ?? null,
    githubUrl: body.githubUrl ? String(body.githubUrl).trim() : (prev.manifest?.githubUrl ?? null),
    notes: String(body.notes || '').slice(0, 8000),
    publishedAt: new Date().toISOString(),
    filename: prev.manifest?.filename,
  };

  if (c.env.IMAGES) {
    await c.env.IMAGES.put(DESKTOP_JSON_KEY, JSON.stringify(manifest, null, 2), {
      httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-cache, max-age=0, must-revalidate' },
      customMetadata: { updated_by: gate.username, updated_at: manifest.publishedAt },
    });
  }
  await mirrorDesktopConfig(c.env.DB, manifest);
  return c.json({ success: true, data: { manifest } });
});

desktopReleaseRouter.post('/api/admin/desktop-update/installer', async (c) => {
  const gate = gateDesktopAdmin(c);
  if (!gate.ok) return c.json({ success: false, error: gate.error }, gate.status as any);
  if (!c.env.IMAGES) return c.json({ success: false, error: 'Binding R2 (IMAGES) absent' }, 501);
  const len = Number(c.req.header('Content-Length') || 0);
  if (!Number.isFinite(len) || len < 10_000) return c.json({ success: false, error: 'Installateur invalide' }, 400);
  if (len > DESKTOP_MAX_INSTALLER_BYTES) return c.json({ success: false, error: 'Fichier trop lourd (max 250 Mo)' }, 413);
  const stream = c.req.raw.body;
  if (!stream) return c.json({ success: false, error: 'Corps du fichier absent' }, 400);

  const prev = await readDesktopManifest(c.env);
  const version = normalizeSemver(c.req.header('X-Release-Version') || prev.manifest?.version || '') || '0.0.0';
  const filename = sanitizeDesktopFilename(c.req.header('X-Release-Filename'), version);
  const versionedKey = `${DESKTOP_UPDATE_PREFIX}/${filename}`;

  const [rawA, rawB] = stream.tee();
  const fixedA = new FixedLengthStream(len);
  const fixedB = new FixedLengthStream(len);
  void rawA.pipeTo(fixedA.writable);
  void rawB.pipeTo(fixedB.writable);

  try {
    await Promise.all([
      c.env.IMAGES.put(versionedKey, fixedA.readable, {
        httpMetadata: { contentType: DESKTOP_EXE_MIME, cacheControl: 'public, max-age=31536000, immutable' },
        customMetadata: { updated_by: gate.username, updated_at: new Date().toISOString() },
      }),
      c.env.IMAGES.put(DESKTOP_LATEST_EXE_KEY, fixedB.readable, {
        httpMetadata: { contentType: DESKTOP_EXE_MIME, cacheControl: 'no-cache, max-age=0, must-revalidate' },
        customMetadata: { updated_by: gate.username, updated_at: new Date().toISOString() },
      }),
    ]);
  } catch (e: any) {
    return c.json({ success: false, error: `Échec upload R2 : ${e?.message || e}` }, 502);
  }

  const base = desktopCdn1Base(c.env);
  const keepKeys = new Set<string>([versionedKey, DESKTOP_LATEST_EXE_KEY, DESKTOP_JSON_KEY]);
  if (prev.manifest) {
    const updated: DesktopManifest = {
      ...prev.manifest,
      sizeBytes: len,
      downloadUrl: `${base}/${filename}`,
      latestUrl: `${base}/latest-setup.exe`,
      cdn1Url: `${base}/${filename}`,
      filename,
      publishedAt: new Date().toISOString(),
    };
    await c.env.IMAGES.put(DESKTOP_JSON_KEY, JSON.stringify(updated, null, 2), {
      httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'no-cache, max-age=0, must-revalidate' },
    });
    await mirrorDesktopConfig(c.env.DB, updated);
  }
  const deletedKeys = await purgeOldDesktopAssets(c.env.IMAGES, keepKeys);
  return c.json({
    success: true,
    data: { key: versionedKey, latestKey: DESKTOP_LATEST_EXE_KEY, size: len, url: `${base}/${filename}`, latestUrl: `${base}/latest-setup.exe`, deletedKeys },
  });
});
