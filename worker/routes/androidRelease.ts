/**
 * Android release ingestion & update serving — zero manual uploads.
 *
 * GitHub Actions in Etherealmber/atlas-commerce-android POSTs every signed
 * APK to `POST /api/admin/android-release` (Bearer ANDROID_RELEASE_TOKEN).
 * The worker streams it into the R2 bucket behind https://cdn1.afmarbre.com
 * (binding IMAGES) twice — immutable versioned key + `latest.apk` alias —
 * using request.body.tee() + FixedLengthStream (no full buffering in worker
 * memory), then writes the live `latest.json` manifest.
 *
 * The Android app (v1.0.8+) reads `GET /api/app/android-update?versionCode=…`
 * (public, pre-login) and pings `HEAD /app-updates/android/latest.apk` for
 * its mirror-latency meter — served via bucket.head() so HEAD never 404/405s
 * when cdn1 traffic reaches the worker.
 */
import { Hono } from 'hono';
import type { Env } from '../env';

export const ANDROID_UPDATE_PREFIX = 'app-updates/android';
const APK_MIME = 'application/vnd.android.package-archive';

function json(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...(headers || {}) },
  });
}

/** Constant-time secret comparison (SHA-256 digests → fixed-length compare). */
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

/** Safe UTF-8 base64 decode (TextDecoder over Uint8Array). */
function b64ToText(b64: string): string {
  try {
    const bin = atob(String(b64 || '').replace(/\s/g, ''));
    const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

export const androidReleaseRouter = new Hono<{ Bindings: Env }>();

/* ── CI ingestion: raw signed APK stream → R2 (versioned + latest) + manifest ── */
androidReleaseRouter.post('/api/admin/android-release', async (c) => {
  const env = c.env;
  const expected = String(env.ANDROID_RELEASE_TOKEN || '').trim();
  if (!expected) return json({ ok: false, success: false, error: 'RELEASE_TOKEN_UNCONFIGURED' }, 503);

  const authHeader = c.req.header('Authorization') || '';
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!provided || !(await secretMatches(provided, expected))) {
    return json({ ok: false, success: false, error: 'UNAUTHORIZED' }, 401);
  }

  const bucket = env.IMAGES;
  if (!bucket) return json({ ok: false, success: false, error: 'R2_UNAVAILABLE' }, 503);

  const versionCode = Number.parseInt((c.req.header('X-Release-Version-Code') || '').trim(), 10);
  if (!Number.isFinite(versionCode) || versionCode <= 0) {
    return json({ ok: false, success: false, error: 'INVALID_VERSION_CODE' }, 400);
  }
  const versionName = String(c.req.header('X-Release-Version-Name') || '')
    .replace(/[^0-9A-Za-z._-]/g, '')
    .trim();
  if (!versionName) return json({ ok: false, success: false, error: 'INVALID_VERSION_NAME' }, 400);

  const shaHeader = (c.req.header('X-Release-Sha256') || '').trim();
  const sha256 = /^[0-9a-fA-F]{64}$/.test(shaHeader) ? shaHeader.toLowerCase() : null;
  const githubHeaderUrl = (c.req.header('X-Release-Github-Url') || '').trim();
  const mandatory = (c.req.header('X-Release-Mandatory') || '').trim() === 'true';
  const notes = b64ToText((c.req.header('X-Release-Notes-B64') || '').trim());

  const request = c.req.raw;
  const contentLength = Number(request.headers.get('content-length') || '0');
  if (!request.body || !Number.isFinite(contentLength) || contentLength < 10_000) {
    return json({ ok: false, success: false, error: 'INVALID_APK_BODY' }, 400);
  }

  // Stream twice with minimal buffering: R2 requires FixedLengthStream for
  // non-buffered put() bodies.
  const [rawA, rawB] = request.body.tee();
  const fixedA = new FixedLengthStream(contentLength);
  const fixedB = new FixedLengthStream(contentLength);
  void rawA.pipeTo(fixedA.writable);
  void rawB.pipeTo(fixedB.writable);
  try {
    await Promise.all([
      bucket.put(`${ANDROID_UPDATE_PREFIX}/atlas-commerce-v${versionName}.apk`, fixedA.readable, {
        httpMetadata: { contentType: APK_MIME, cacheControl: 'public, max-age=31536000, immutable' },
      }),
      bucket.put(`${ANDROID_UPDATE_PREFIX}/latest.apk`, fixedB.readable, {
        httpMetadata: { contentType: APK_MIME, cacheControl: 'public, max-age=60' },
      }),
    ]);
  } catch (e) {
    console.error('[android-release] R2 put failed', String((e as any)?.message || e).slice(0, 300));
    return json({ ok: false, success: false, error: 'R2_WRITE_FAILED' }, 502);
  }

  const cdn1Base = (env.CDN1_PUBLIC_BASE_URL || 'https://cdn1.afmarbre.com/app-updates/android').replace(/\/+$/, '');
  const cdn1VersionedUrl = `${cdn1Base}/atlas-commerce-v${versionName}.apk`;
  const githubUrl =
    githubHeaderUrl ||
    `https://github.com/Etherealmber/atlas-commerce-android/releases/download/v${versionName}/atlas-commerce-v${versionName}.apk`;
  const manifest = {
    success: true,
    ok: true,
    updateAvailable: true,
    versionCode,
    versionName,
    mandatory,
    sha256: sha256 || null,
    sizeBytes: contentLength,
    apkUrl: cdn1VersionedUrl,
    apk_url: cdn1VersionedUrl,
    cdn1Url: cdn1VersionedUrl,
    cdn1_url: cdn1VersionedUrl,
    githubUrl,
    github_url: githubUrl,
    notes,
    publishedAt: new Date().toISOString(),
  };
  try {
    await bucket.put(`${ANDROID_UPDATE_PREFIX}/latest.json`, JSON.stringify(manifest, null, 2), {
      httpMetadata: {
        contentType: 'application/json; charset=utf-8',
        cacheControl: 'no-cache, max-age=0, must-revalidate',
      },
    });
  } catch (e) {
    console.error('[android-release] latest.json write failed', String((e as any)?.message || e).slice(0, 300));
    return json({ ok: false, success: false, error: 'MANIFEST_WRITE_FAILED' }, 502);
  }
  console.log('[android-release] ingested', versionName, 'code', versionCode, contentLength, 'bytes');
  return json({ ok: true, success: true, manifest });
});

/* ── Public update check (pre-login) + HEAD variant ── */
async function buildAndroidUpdateResponse(c: any, head: boolean): Promise<Response> {
  const env = c.env as Env;
  const clientCode = Number(c.req.query('versionCode') || '0');
  const noCache = { 'Cache-Control': 'no-cache, max-age=0, must-revalidate' };
  let manifest: any = null;
  try {
    if (env.IMAGES) {
      const obj = await env.IMAGES.get(`${ANDROID_UPDATE_PREFIX}/latest.json`);
      if (obj) manifest = JSON.parse(await obj.text());
    }
  } catch { /* */ }
  if (!manifest && env.DB) {
    // Legacy fallback: owner-configured rows keep working until the first CI release.
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
      }
    } catch { /* */ }
  }
  if (!manifest) {
    const body = {
      success: true,
      ok: true,
      updateAvailable: false,
      versionCode: clientCode,
      versionName: c.req.query('versionName') || null,
      apkUrl: null,
      cdn1Url: null,
      githubUrl: null,
      mandatory: false,
      sha256: null,
      sizeBytes: null,
      notes: null,
      message: 'Aucun manifeste de mise à jour (uploadez app-updates/android/latest.json sur R2)',
    };
    if (head) return new Response(null, { status: 200, headers: noCache });
    return json(body, 200, noCache);
  }
  const remoteCode = Number(manifest.versionCode || manifest.version_code || 0);
  const apkUrl = manifest.apkUrl || manifest.apk_url || null;
  const body = {
    success: true,
    ok: true,
    updateAvailable: remoteCode > clientCode,
    versionCode: remoteCode,
    versionName: manifest.versionName || manifest.version_name || null,
    mandatory: !!manifest.mandatory,
    sha256: manifest.sha256 || null,
    sizeBytes: manifest.sizeBytes ?? null,
    apkUrl,
    apk_url: apkUrl,
    cdn1Url: manifest.cdn1Url || manifest.cdn1_url || apkUrl,
    githubUrl: manifest.githubUrl || manifest.github_url || null,
    notes: manifest.notes ?? null,
  };
  if (head) return new Response(null, { status: 200, headers: noCache });
  return json(body, 200, noCache);
}
androidReleaseRouter.get('/api/app/android-update', (c) => buildAndroidUpdateResponse(c, false));
androidReleaseRouter.on('HEAD', '/api/app/android-update', (c) => buildAndroidUpdateResponse(c, true));

/* ── CDN1 mirror paths through the worker: GET streams, HEAD uses bucket.head() ── */
function assetHeaders(o: any): Headers {
  const h = new Headers();
  const meta = o?.httpMetadata || {};
  h.set('Content-Type', meta.contentType || 'application/octet-stream');
  h.set('Cache-Control', meta.cacheControl || 'public, max-age=60');
  const size = o?.size ?? meta.contentLength;
  if (size != null) h.set('Content-Length', String(size));
  if (o?.etag) h.set('ETag', `"${o.etag}"`);
  return h;
}

export async function serveAppUpdatesAsset(request: Request, env: Env): Promise<Response> {
  const bucket = env.IMAGES;
  if (!bucket) return new Response('R2 unavailable', { status: 503 });
  const key = decodeURIComponent(new URL(request.url).pathname.replace(/^\/+/, ''));
  if (!key.startsWith(`${ANDROID_UPDATE_PREFIX}/`)) return new Response('Not found', { status: 404 });
  if (request.method === 'HEAD') {
    const head = await bucket.head(key).catch(() => null);
    if (!head) return new Response(null, { status: 404 });
    return new Response(null, { status: 200, headers: assetHeaders(head) });
  }
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const obj = await bucket.get(key).catch(() => null);
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body as unknown as BodyInit, { status: 200, headers: assetHeaders(obj) });
}
