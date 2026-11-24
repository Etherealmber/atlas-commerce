/**
 * Desktop (Windows · macOS · Linux) release ingestion & update serving — CDN1 (`app-updates/desktop/`).
 *
 * Mirrors the Android CDN1 pipeline (`worker/routes/androidRelease.ts`) while
 * remaining strictly isolated from mobile (never serves or accepts APKs/IPAs):
 *  - `POST /api/admin/desktop-release` (Bearer DESKTOP_RELEASE_TOKEN):
 *      Streams a Desktop artifact (`.exe`, `.msi`, `.zip`, `.dmg`, `.AppImage`,
 *      `.AppImage.zsync`, `.tar.gz`, `.deb`, `.rpm`) to R2 under `app-updates/desktop/`
 *      (versioned key + optional `latest-*` alias + `checksums.txt` + `latest.json`).
 *      When the release version changes, ALL older files under `app-updates/desktop/`
 *      are purged so old installers never accumulate. Within the same version,
 *      sibling OS/arch artifacts are preserved while replacing the matching slot.
 *  - `GET` / `HEAD /api/app/desktop-update` (public, pre-login):
 *      Returns Desktop update availability for `windows`, `macos`, `linux`, or `all`,
 *      including SHA-256, file size, CDN1 URLs, zsync URL, notes, `minimum_version`
 *      enforcement, and the full multi-platform `platforms` / `assets` map.
 *  - `GET` / `PUT /api/admin/desktop-update` & `POST /api/admin/desktop-update/installer`
 *      (owner/admin session): inspect/manage `app-updates/desktop/` from Settings.
 */
import { Hono } from 'hono';
import type { Env } from '../env';
import { sessionUserFromHeader } from '../lib/authHelpers';
import { normalizeRole } from '../lib/rbac';

export const DESKTOP_UPDATE_PREFIX = 'app-updates/desktop';
export const DESKTOP_JSON_KEY = `${DESKTOP_UPDATE_PREFIX}/latest.json`;
export const DESKTOP_LATEST_EXE_KEY = `${DESKTOP_UPDATE_PREFIX}/latest-setup.exe`;
export const DESKTOP_LATEST_DMG_KEY = `${DESKTOP_UPDATE_PREFIX}/latest-macos.dmg`;
export const DESKTOP_CHECKSUMS_KEY = `${DESKTOP_UPDATE_PREFIX}/checksums.txt`;
export const DESKTOP_MAX_INSTALLER_BYTES = 350 * 1024 * 1024;
const NO_CACHE_HEADERS = { 'Cache-Control': 'no-cache, max-age=0, must-revalidate' };

export type DesktopOs = 'windows' | 'macos' | 'linux';
export type DesktopArch = 'universal' | 'x86_64' | 'arm64';
export type DesktopArtifactKind = 'installer' | 'msi' | 'appimage' | 'zsync' | 'archive' | 'package';

export type DesktopAssetEntry = {
  platform: DesktopOs;
  arch: DesktopArch;
  kind: DesktopArtifactKind;
  filename: string;
  key: string;
  aliasKey: string | null;
  downloadUrl: string;
  latestUrl: string | null;
  sha256: string | null;
  sizeBytes: number;
  githubUrl: string | null;
  zsyncUrl?: string | null;
};

export type DesktopPlatformsMap = {
  windows?: {
    universal?: DesktopAssetEntry;
    x86_64?: DesktopAssetEntry;
    arm64?: DesktopAssetEntry;
    msi_x86_64?: DesktopAssetEntry;
    msi_arm64?: DesktopAssetEntry;
    archive_x86_64?: DesktopAssetEntry;
    archive_arm64?: DesktopAssetEntry;
  };
  macos?: {
    universal?: DesktopAssetEntry;
    x86_64?: DesktopAssetEntry;
    arm64?: DesktopAssetEntry;
  };
  linux?: {
    x86_64?: DesktopAssetEntry;
    arm64?: DesktopAssetEntry;
    zsync_x86_64?: DesktopAssetEntry;
    zsync_arm64?: DesktopAssetEntry;
    archive_x86_64?: DesktopAssetEntry;
    archive_arm64?: DesktopAssetEntry;
  };
};

export type DesktopManifest = {
  success?: boolean;
  ok?: boolean;
  platform: DesktopOs;
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
  platforms?: DesktopPlatformsMap;
  assets?: DesktopAssetEntry[];
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

function parseDesktopOs(raw: string | null | undefined, filename?: string): DesktopOs | null {
  const s = String(raw || '').trim().toLowerCase();
  if (s) {
    if (['windows', 'win', 'win32'].includes(s)) return 'windows';
    if (['macos', 'mac', 'darwin', 'osx'].includes(s)) return 'macos';
    if (['linux', 'gnu-linux'].includes(s)) return 'linux';
    return null;
  }
  const f = String(filename || '').toLowerCase();
  if (/\.(dmg|pkg)$/.test(f) || f.includes('macos') || f.includes('darwin')) return 'macos';
  if (/\.(appimage|zsync|deb|rpm|tar\.gz)$/.test(f) || f.includes('linux')) return 'linux';
  return 'windows';
}

function parseDesktopArch(raw: string | null | undefined, filename?: string): DesktopArch {
  const s = String(raw || '').trim().toLowerCase();
  const f = String(filename || '').toLowerCase();
  const src = s || f;
  if (src.includes('aarch64') || src.includes('arm64')) {
    return src.includes('universal') ? 'universal' : 'arm64';
  }
  if (src.includes('x86_64') || src.includes('x64') || src.includes('amd64')) {
    return src.includes('universal') ? 'universal' : 'x86_64';
  }
  return 'universal';
}

function parseArtifactKind(raw: string | null | undefined, filename: string, os: DesktopOs): DesktopArtifactKind {
  const k = String(raw || '').trim().toLowerCase();
  if (k === 'installer' || k === 'msi' || k === 'appimage' || k === 'zsync' || k === 'archive' || k === 'package') {
    return k;
  }
  const f = filename.toLowerCase();
  if (f.endsWith('.zsync')) return 'zsync';
  if (f.endsWith('.appimage')) return 'appimage';
  if (f.endsWith('.msi')) return 'msi';
  if (f.endsWith('.zip') || f.endsWith('.tar.gz')) return 'archive';
  if (f.endsWith('.deb') || f.endsWith('.rpm')) return 'package';
  if (os === 'linux') return 'appimage';
  return 'installer';
}

function defaultDesktopFilename(os: DesktopOs, arch: DesktopArch, kind: DesktopArtifactKind, version: string): string {
  if (os === 'windows') {
    if (kind === 'msi') return `atlas-commerce-desktop-v${version}-${arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc.msi`;
    if (kind === 'archive') return `atlas-commerce-desktop-v${version}-${arch === 'arm64' ? 'aarch64' : 'x86_64'}-pc-windows-msvc.zip`;
    return `atlas-commerce-desktop-v${version}-windows-${arch}-setup.exe`;
  }
  if (os === 'macos') {
    if (kind === 'archive') return `atlas-commerce-desktop-v${version}-macos-${arch}.tar.gz`;
    return `atlas-commerce-desktop-v${version}-macos-${arch}.dmg`;
  }
  const linuxArch = arch === 'arm64' ? 'aarch64' : 'x86_64';
  if (kind === 'zsync') return `atlas-commerce-desktop-v${version}-linux-${linuxArch}.AppImage.zsync`;
  if (kind === 'archive') return `atlas-commerce-desktop-v${version}-${linuxArch}-unknown-linux-gnu.tar.gz`;
  if (kind === 'package') return `atlas-commerce-desktop-v${version}-linux-${linuxArch}.deb`;
  return `atlas-commerce-desktop-v${version}-linux-${linuxArch}.AppImage`;
}

function sanitizeDesktopFilename(
  raw: string | null | undefined,
  os: DesktopOs,
  arch: DesktopArch,
  kind: DesktopArtifactKind,
  version: string,
): string | null {
  const clean =
    String(raw || '')
      .trim()
      .split(/[/\\]/)
      .pop()
      ?.replace(/[^0-9A-Za-z._-]/g, '') || '';
  if (!clean) return defaultDesktopFilename(os, arch, kind, version);
  // Reject non-desktop artifacts (APKs, IPAs, HTML, scripts)
  if (/\.(apk|aab|ipa|html|js|sh|ps1)$/i.test(clean)) return null;
  if (!/\.(exe|msi|zip|dmg|appimage|zsync|tar\.gz|deb|rpm)$/i.test(clean)) return null;
  return clean;
}

function mimeForDesktopFile(filename: string): string {
  const f = filename.toLowerCase();
  if (f.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable';
  if (f.endsWith('.msi')) return 'application/x-msi';
  if (f.endsWith('.dmg')) return 'application/x-apple-diskimage';
  if (f.endsWith('.zip')) return 'application/zip';
  if (f.endsWith('.tar.gz')) return 'application/gzip';
  if (f.endsWith('.zsync')) return 'application/octet-stream';
  if (f.endsWith('.deb')) return 'application/vnd.debian.binary-package';
  if (f.endsWith('.rpm')) return 'application/x-rpm';
  return 'application/octet-stream';
}

function aliasKeyForAsset(os: DesktopOs, arch: DesktopArch, kind: DesktopArtifactKind): string | null {
  if (os === 'windows' && kind === 'installer') return DESKTOP_LATEST_EXE_KEY;
  if (os === 'macos' && kind === 'installer') return DESKTOP_LATEST_DMG_KEY;
  if (os === 'linux' && kind === 'appimage') {
    return `${DESKTOP_UPDATE_PREFIX}/latest-linux-${arch === 'arm64' ? 'arm64' : 'x86_64'}.AppImage`;
  }
  if (os === 'linux' && kind === 'zsync') {
    return `${DESKTOP_UPDATE_PREFIX}/latest-linux-${arch === 'arm64' ? 'arm64' : 'x86_64'}.AppImage.zsync`;
  }
  return null;
}

function sanitizeChannel(raw: string | null | undefined): 'stable' | 'prerelease' {
  return String(raw || '').trim().toLowerCase() === 'prerelease' ? 'prerelease' : 'stable';
}

function buildPlatformsMap(assets: DesktopAssetEntry[]): DesktopPlatformsMap {
  const platforms: DesktopPlatformsMap = {};
  for (const a of assets) {
    if (a.platform === 'windows') {
      platforms.windows = platforms.windows || {};
      if (a.kind === 'installer') {
        if (a.arch === 'arm64') platforms.windows.arm64 = a;
        else if (a.arch === 'x86_64') platforms.windows.x86_64 = a;
        else platforms.windows.universal = a;
      } else if (a.kind === 'msi') {
        if (a.arch === 'arm64') platforms.windows.msi_arm64 = a;
        else platforms.windows.msi_x86_64 = a;
      } else if (a.kind === 'archive') {
        if (a.arch === 'arm64') platforms.windows.archive_arm64 = a;
        else platforms.windows.archive_x86_64 = a;
      }
    } else if (a.platform === 'macos') {
      platforms.macos = platforms.macos || {};
      if (a.arch === 'arm64') platforms.macos.arm64 = a;
      else if (a.arch === 'x86_64') platforms.macos.x86_64 = a;
      else platforms.macos.universal = a;
    } else if (a.platform === 'linux') {
      platforms.linux = platforms.linux || {};
      if (a.kind === 'zsync') {
        if (a.arch === 'arm64') platforms.linux.zsync_arm64 = a;
        else platforms.linux.zsync_x86_64 = a;
      } else if (a.kind === 'archive') {
        if (a.arch === 'arm64') platforms.linux.archive_arm64 = a;
        else platforms.linux.archive_x86_64 = a;
      } else {
        if (a.arch === 'arm64') platforms.linux.arm64 = a;
        else platforms.linux.x86_64 = a;
      }
    }
  }
  // Attach zsyncUrl onto matching Linux AppImages
  if (platforms.linux?.x86_64 && platforms.linux.zsync_x86_64) {
    platforms.linux.x86_64.zsyncUrl = platforms.linux.zsync_x86_64.downloadUrl;
  }
  if (platforms.linux?.arm64 && platforms.linux.zsync_arm64) {
    platforms.linux.arm64.zsyncUrl = platforms.linux.zsync_arm64.downloadUrl;
  }
  return platforms;
}

function selectAssetForQuery(
  manifest: DesktopManifest,
  requestedOs: DesktopOs | 'all',
  requestedArch: DesktopArch,
): DesktopAssetEntry | null {
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  if (assets.length === 0) return null;

  const findInOs = (os: DesktopOs): DesktopAssetEntry | null => {
    const osAssets = assets.filter((a) => a.platform === os && a.kind !== 'zsync');
    if (osAssets.length === 0) return null;
    if (os === 'windows') {
      return (
        osAssets.find((a) => a.kind === 'installer' && a.arch === requestedArch) ||
        osAssets.find((a) => a.kind === 'installer' && a.arch === 'universal') ||
        osAssets.find((a) => a.kind === 'installer') ||
        osAssets.find((a) => a.arch === requestedArch) ||
        osAssets[0]
      );
    }
    if (os === 'macos') {
      return (
        osAssets.find((a) => a.kind === 'installer' && a.arch === requestedArch) ||
        osAssets.find((a) => a.kind === 'installer' && a.arch === 'universal') ||
        osAssets.find((a) => a.kind === 'installer') ||
        osAssets[0]
      );
    }
    // linux
    const linuxArch: DesktopArch = requestedArch === 'arm64' ? 'arm64' : 'x86_64';
    return (
      osAssets.find((a) => a.kind === 'appimage' && a.arch === linuxArch) ||
      osAssets.find((a) => a.kind === 'appimage') ||
      osAssets.find((a) => a.arch === linuxArch) ||
      osAssets[0]
    );
  };

  if (requestedOs !== 'all') return findInOs(requestedOs);
  return findInOs('windows') || findInOs('macos') || findInOs('linux') || assets[0];
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
 * so old Desktop installers/packages never accumulate across releases.
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
        let parsedAssets: DesktopAssetEntry[] = [];
        try {
          if (map.desktop_update_assets_json) parsedAssets = JSON.parse(map.desktop_update_assets_json);
        } catch { /* */ }
        manifest = {
          platform: 'windows',
          arch: map.desktop_update_arch || 'universal',
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
          assets: parsedAssets,
          platforms: parsedAssets.length > 0 ? buildPlatformsMap(parsedAssets) : undefined,
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
      ['desktop_update_arch', String(m.arch || 'universal')],
      ['desktop_update_mandatory', m.mandatory ? '1' : '0'],
      ['desktop_update_minimum_version', String(m.minimum_version || '')],
      ['desktop_update_sha256', String(m.sha256 || '')],
      ['desktop_update_size_bytes', m.sizeBytes != null ? String(m.sizeBytes) : ''],
      ['desktop_update_download_url', String(m.downloadUrl || '')],
      ['desktop_update_github_url', String(m.githubUrl || '')],
      ['desktop_update_notes', String(m.notes || '')],
      ['desktop_update_published_at', String(m.publishedAt || '')],
      ['desktop_update_assets_json', JSON.stringify(m.assets || [])],
    ];
    await Promise.all(
      rows.map(([k, v]) =>
        db
          .prepare(`INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
          .bind(k, v)
          .run(),
      ),
    );
  } catch { /* best-effort */ }
}

function gateDesktopAdmin(c: any): { ok: true; username: string } | { ok: false; status: number; error: string } {
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  if (!session.username) return { ok: false, status: 401, error: 'Non authentifié' };
  const role = normalizeRole(session.role || 'user');
  if (role !== 'owner' && role !== 'admin') return { ok: false, status: 403, error: 'Réservé admin/owner' };
  return { ok: true, username: session.username };
}

async function putStreamToR2(
  bucket: any,
  versionedKey: string,
  aliasKey: string | null,
  stream: ReadableStream<Uint8Array>,
  contentLength: number,
  contentType: string,
  customMetadata?: Record<string, string>,
): Promise<void> {
  if (aliasKey) {
    const [rawA, rawB] = stream.tee();
    const fixedA = new FixedLengthStream(contentLength);
    const fixedB = new FixedLengthStream(contentLength);
    void rawA.pipeTo(fixedA.writable);
    void rawB.pipeTo(fixedB.writable);
    await Promise.all([
      bucket.put(versionedKey, fixedA.readable, {
        httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' },
        ...(customMetadata ? { customMetadata } : {}),
      }),
      bucket.put(aliasKey, fixedB.readable, {
        httpMetadata: { contentType, cacheControl: 'no-cache, max-age=0, must-revalidate' },
        ...(customMetadata ? { customMetadata } : {}),
      }),
    ]);
  } else {
    const fixed = new FixedLengthStream(contentLength);
    void stream.pipeTo(fixed.writable);
    await bucket.put(versionedKey, fixed.readable, {
      httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' },
      ...(customMetadata ? { customMetadata } : {}),
    });
  }
}

export const desktopReleaseRouter = new Hono<{ Bindings: Env }>();

/* ── CI ingestion: Windows / macOS / Linux artifacts → R2 (`app-updates/desktop/`) ── */
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

  const rawFilename = (c.req.header('X-Release-Filename') || '').trim();
  const os = parseDesktopOs(c.req.header('X-Release-Platform'), rawFilename);
  if (!os) {
    return json({ ok: false, success: false, error: 'UNSUPPORTED_PLATFORM' }, 400);
  }
  const arch = parseDesktopArch(c.req.header('X-Release-Arch'), rawFilename);
  const kind = parseArtifactKind(c.req.header('X-Release-Kind'), rawFilename || defaultDesktopFilename(os, arch, 'installer', version), os);
  const filename = sanitizeDesktopFilename(rawFilename, os, arch, kind, version);
  if (!filename) {
    return json({ ok: false, success: false, error: 'UNSUPPORTED_FILE_TYPE' }, 400);
  }

  const channel = sanitizeChannel(c.req.header('X-Release-Channel'));
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
  const minBytes = kind === 'zsync' ? 512 : 10_000;

  const request = c.req.raw;
  const contentLength = Number(request.headers.get('content-length') || '0');
  if (
    !request.body ||
    !Number.isFinite(contentLength) ||
    contentLength < minBytes ||
    contentLength > DESKTOP_MAX_INSTALLER_BYTES
  ) {
    return json({ ok: false, success: false, error: 'INVALID_INSTALLER_BODY' }, 400);
  }

  const prevState = await readDesktopManifest(env);
  if (!minimumVersion && prevState.manifest?.minimum_version) {
    minimumVersion = normalizeSemver(prevState.manifest.minimum_version);
  }

  const versionedKey = `${DESKTOP_UPDATE_PREFIX}/${filename}`;
  const aliasKey = aliasKeyForAsset(os, arch, kind);
  const contentType = mimeForDesktopFile(filename);

  try {
    await putStreamToR2(bucket, versionedKey, aliasKey, request.body, contentLength, contentType);
  } catch (e) {
    console.error('[desktop-release] R2 put failed', String((e as any)?.message || e).slice(0, 300));
    return json({ ok: false, success: false, error: 'R2_WRITE_FAILED' }, 502);
  }

  const cdn1Base = desktopCdn1Base(env);
  const downloadUrl = `${cdn1Base}/${filename}`;
  const latestUrl = aliasKey ? `${cdn1Base}/${aliasKey.split('/').pop()}` : null;
  const githubUrl =
    githubHeaderUrl ||
    `https://github.com/Etherealmber/atlas-commerce-desktop/releases/download/v${version}/${filename}`;

  const entry: DesktopAssetEntry = {
    platform: os,
    arch,
    kind,
    filename,
    key: versionedKey,
    aliasKey,
    downloadUrl,
    latestUrl,
    sha256,
    sizeBytes: contentLength,
    githubUrl,
  };

  // Same version keeps sibling OS/arch entries; a new version replaces the entire release set.
  const sameVersion =
    prevState.manifest?.version &&
    normalizeSemver(prevState.manifest.version) === version &&
    (c.req.header('X-Release-Purge-All') || '').trim() !== 'true';
  const priorAssets: DesktopAssetEntry[] = sameVersion && Array.isArray(prevState.manifest?.assets)
    ? prevState.manifest!.assets!
    : [];
  const mergedAssets = [
    ...priorAssets.filter((a) => !(a.platform === os && a.arch === arch && a.kind === kind)),
    entry,
  ];

  const platforms = buildPlatformsMap(mergedAssets);
  const primaryEntry =
    platforms.windows?.universal ||
    platforms.windows?.x86_64 ||
    platforms.macos?.universal ||
    platforms.linux?.x86_64 ||
    entry;

  const hasAnySha = mergedAssets.some((a) => !!a.sha256);
  const checksumsUrl = hasAnySha ? `${cdn1Base}/checksums.txt` : null;

  const manifest: DesktopManifest = {
    success: true,
    ok: true,
    platform: primaryEntry.platform,
    arch: primaryEntry.arch,
    channel,
    version,
    mandatory: sameVersion ? (mandatory || !!prevState.manifest?.mandatory) : mandatory,
    minimum_version: minimumVersion,
    sha256: primaryEntry.sha256,
    sizeBytes: primaryEntry.sizeBytes,
    downloadUrl: primaryEntry.downloadUrl,
    latestUrl: primaryEntry.latestUrl || primaryEntry.downloadUrl,
    cdn1Url: primaryEntry.downloadUrl,
    checksumsUrl,
    githubUrl: primaryEntry.githubUrl,
    notes: notes || (sameVersion ? prevState.manifest?.notes || '' : ''),
    publishedAt: new Date().toISOString(),
    filename: primaryEntry.filename,
    platforms,
    assets: mergedAssets,
  };

  const keepKeys = new Set<string>([DESKTOP_JSON_KEY]);
  for (const a of mergedAssets) {
    keepKeys.add(a.key);
    if (a.aliasKey) keepKeys.add(a.aliasKey);
  }

  if (hasAnySha) {
    keepKeys.add(DESKTOP_CHECKSUMS_KEY);
    const lines: string[] = [];
    for (const a of mergedAssets) {
      if (!a.sha256) continue;
      lines.push(`${a.sha256}  ${a.filename}`);
      if (a.aliasKey) lines.push(`${a.sha256}  ${a.aliasKey.split('/').pop()}`);
    }
    await bucket
      .put(DESKTOP_CHECKSUMS_KEY, `${lines.join('\n')}\n`, {
        httpMetadata: { contentType: 'text/plain; charset=utf-8', cacheControl: 'no-cache, max-age=0, must-revalidate' },
      })
      .catch(() => null);
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
  console.log('[desktop-release] ingested', os, arch, kind, version, filename, contentLength, 'bytes, deleted', deletedKeys.length, 'old file(s)');
  return json({ ok: true, success: true, asset: entry, manifest, deletedKeys });
});

/* ── Public Desktop update check (pre-login) + HEAD ── */
async function buildDesktopUpdateResponse(c: any, head: boolean): Promise<Response> {
  const env = c.env as Env;
  const rawPlatform = String(c.req.query('platform') || 'windows').trim().toLowerCase();
  const requestedOs: DesktopOs | 'all' | null =
    rawPlatform === 'all' ? 'all' : parseDesktopOs(rawPlatform);
  if (!requestedOs) {
    return json(
      { success: false, ok: false, error: 'UNSUPPORTED_PLATFORM', message: 'Plateformes Desktop supportées : windows, macos, linux' },
      400,
      NO_CACHE_HEADERS,
    );
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
  const requestedArch = parseDesktopArch(c.req.query('arch'));

  const { manifest } = await readDesktopManifest(env);
  if (!manifest || !manifest.version) {
    const emptyBody = {
      success: true,
      ok: true,
      platform: requestedOs,
      arch: requestedArch,
      channel: requestedChannel || 'stable',
      hasRelease: false,
      platformAvailable: false,
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
      zsyncUrl: null,
      notes: null,
      publishedAt: null,
      platforms: {},
      assets: [],
      message: 'Aucun manifeste Desktop publié (uploadez app-updates/desktop/latest.json sur R2)',
    };
    if (head) return new Response(null, { status: 200, headers: NO_CACHE_HEADERS });
    return json(emptyBody, 200, NO_CACHE_HEADERS);
  }

  const remoteChannel = sanitizeChannel(manifest.channel);
  if (requestedChannel === 'stable' && remoteChannel === 'prerelease') {
    const channelMismatch = {
      success: true,
      ok: true,
      platform: requestedOs,
      arch: requestedArch,
      channel: 'stable',
      hasRelease: false,
      platformAvailable: false,
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
      zsyncUrl: null,
      notes: null,
      publishedAt: null,
      platforms: {},
      assets: [],
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

  const selected = selectAssetForQuery(manifest, requestedOs, requestedArch);
  const legacyMatch =
    !manifest.assets?.length && (requestedOs === 'all' || requestedOs === (manifest.platform || 'windows'));
  const platformAvailable = !!selected || legacyMatch;

  const downloadUrl = selected?.downloadUrl ?? (legacyMatch ? manifest.downloadUrl || `${base}/latest-setup.exe` : null);
  const latestUrl = selected?.latestUrl ?? (legacyMatch ? manifest.latestUrl || `${base}/latest-setup.exe` : null);

  const body = {
    success: true,
    ok: true,
    platform: requestedOs === 'all' ? (selected?.platform || manifest.platform || 'windows') : requestedOs,
    arch: selected?.arch || (legacyMatch ? manifest.arch : requestedArch),
    channel: remoteChannel,
    hasRelease: true,
    platformAvailable,
    updateAvailable: updateAvailable && platformAvailable,
    version: remoteVersion,
    mandatory: !!manifest.mandatory,
    minimum_version: minVer,
    minimumVersionRequired,
    sha256: selected?.sha256 ?? (legacyMatch ? manifest.sha256 || null : null),
    sizeBytes: selected?.sizeBytes ?? (legacyMatch ? manifest.sizeBytes ?? null : null),
    downloadUrl,
    latestUrl,
    cdn1Url: downloadUrl,
    checksumsUrl: manifest.checksumsUrl || null,
    githubUrl: selected?.githubUrl ?? (legacyMatch ? manifest.githubUrl || null : null),
    zsyncUrl: selected?.zsyncUrl ?? null,
    notes: manifest.notes ?? null,
    publishedAt: manifest.publishedAt || null,
    filename: selected?.filename ?? (legacyMatch ? manifest.filename || null : null),
    platforms: manifest.platforms || (manifest.assets ? buildPlatformsMap(manifest.assets) : {}),
    assets: manifest.assets || [],
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
        arch: 'universal',
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
        platforms: {},
        assets: [],
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
    platform: prev.manifest?.platform || 'windows',
    arch: prev.manifest?.arch || 'universal',
    channel: sanitizeChannel(body.channel),
    version,
    mandatory: body.mandatory === true || body.mandatory === 'true' || body.mandatory === 1,
    minimum_version: minimumVersion,
    sha256: shaRaw ? shaRaw.toLowerCase() : (prev.manifest?.sha256 ?? null),
    sizeBytes: prev.exeMeta?.size ?? prev.manifest?.sizeBytes ?? null,
    downloadUrl,
    latestUrl: prev.manifest?.latestUrl || `${base}/latest-setup.exe`,
    cdn1Url: downloadUrl,
    checksumsUrl: prev.manifest?.checksumsUrl ?? null,
    githubUrl: body.githubUrl ? String(body.githubUrl).trim() : (prev.manifest?.githubUrl ?? null),
    notes: String(body.notes || '').slice(0, 8000),
    publishedAt: new Date().toISOString(),
    filename: prev.manifest?.filename,
    platforms: prev.manifest?.platforms,
    assets: prev.manifest?.assets,
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

  const rawFilename = (c.req.header('X-Release-Filename') || '').trim();
  const os = parseDesktopOs(c.req.header('X-Release-Platform'), rawFilename);
  if (!os) return c.json({ success: false, error: 'Plateforme Desktop invalide (windows, macos, linux)' }, 400);
  const arch = parseDesktopArch(c.req.header('X-Release-Arch'), rawFilename);
  const kind = parseArtifactKind(c.req.header('X-Release-Kind'), rawFilename || 'setup.exe', os);

  const len = Number(c.req.header('Content-Length') || 0);
  const minBytes = kind === 'zsync' ? 512 : 10_000;
  if (!Number.isFinite(len) || len < minBytes) return c.json({ success: false, error: 'Installateur invalide' }, 400);
  if (len > DESKTOP_MAX_INSTALLER_BYTES) return c.json({ success: false, error: 'Fichier trop lourd (max 350 Mo)' }, 413);
  const stream = c.req.raw.body;
  if (!stream) return c.json({ success: false, error: 'Corps du fichier absent' }, 400);

  const prev = await readDesktopManifest(c.env);
  const version = normalizeSemver(c.req.header('X-Release-Version') || prev.manifest?.version || '') || '0.0.0';
  const filename = sanitizeDesktopFilename(rawFilename, os, arch, kind, version);
  if (!filename) return c.json({ success: false, error: 'Extension de fichier non supportée' }, 400);

  const versionedKey = `${DESKTOP_UPDATE_PREFIX}/${filename}`;
  const aliasKey = aliasKeyForAsset(os, arch, kind);
  const contentType = mimeForDesktopFile(filename);

  try {
    await putStreamToR2(c.env.IMAGES, versionedKey, aliasKey, stream, len, contentType, {
      updated_by: gate.username,
      updated_at: new Date().toISOString(),
    });
  } catch (e: any) {
    return c.json({ success: false, error: `Échec upload R2 : ${e?.message || e}` }, 502);
  }

  const base = desktopCdn1Base(c.env);
  const entry: DesktopAssetEntry = {
    platform: os,
    arch,
    kind,
    filename,
    key: versionedKey,
    aliasKey,
    downloadUrl: `${base}/${filename}`,
    latestUrl: aliasKey ? `${base}/${aliasKey.split('/').pop()}` : null,
    sha256: null,
    sizeBytes: len,
    githubUrl: prev.manifest?.githubUrl || null,
  };

  const sameVersion = !!prev.manifest?.version && normalizeSemver(prev.manifest.version) === version;
  const priorAssets: DesktopAssetEntry[] = sameVersion && Array.isArray(prev.manifest?.assets) ? prev.manifest!.assets! : [];
  const mergedAssets = [
    ...priorAssets.filter((a) => !(a.platform === os && a.arch === arch && a.kind === kind)),
    entry,
  ];
  const platforms = buildPlatformsMap(mergedAssets);
  const keepKeys = new Set<string>([DESKTOP_JSON_KEY]);
  for (const a of mergedAssets) {
    keepKeys.add(a.key);
    if (a.aliasKey) keepKeys.add(a.aliasKey);
  }

  if (prev.manifest) {
    const primary = platforms.windows?.universal || platforms.windows?.x86_64 || platforms.macos?.universal || platforms.linux?.x86_64 || entry;
    const updated: DesktopManifest = {
      ...prev.manifest,
      version,
      platform: primary.platform,
      arch: primary.arch,
      sizeBytes: primary.sizeBytes,
      downloadUrl: primary.downloadUrl,
      latestUrl: primary.latestUrl || primary.downloadUrl,
      cdn1Url: primary.downloadUrl,
      filename: primary.filename,
      platforms,
      assets: mergedAssets,
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
    data: { key: versionedKey, aliasKey, size: len, url: entry.downloadUrl, latestUrl: entry.latestUrl, asset: entry, deletedKeys },
  });
});
