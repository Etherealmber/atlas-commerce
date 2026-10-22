/**
 * Integration tests for the Android release pipeline:
 *  - POST /api/admin/android-release (auth + R2 writes + manifest)
 *  - GET  /api/app/android-update?versionCode=107 vs 108
 *  - HEAD /api/app/android-update + HEAD /app-updates/* ping
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { androidReleaseRouter, serveAppUpdatesAsset } from '../routes/androidRelease';

// Workers-only API polyfill for the Node test runtime.
if (typeof (globalThis as any).FixedLengthStream === 'undefined') {
  (globalThis as any).FixedLengthStream = class extends TransformStream {
    constructor(_len: number) {
      super({});
    }
  };
}

class MemBucket {
  store = new Map<string, { body: Uint8Array; httpMetadata?: any }>();
  async put(key: string, body: any, opts?: any) {
    let bytes: Uint8Array;
    if (body instanceof Uint8Array) bytes = body;
    else if (typeof body === 'string') bytes = new TextEncoder().encode(body);
    else if (body instanceof ArrayBuffer) bytes = new Uint8Array(body);
    else {
      const chunks: Uint8Array[] = [];
      const rd = (body as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const { done, value } = await rd.read();
        if (done) break;
        chunks.push(value);
      }
      const total = chunks.reduce((n, cch) => n + cch.length, 0);
      bytes = new Uint8Array(total);
      let off = 0;
      for (const cch of chunks) {
        bytes.set(cch, off);
        off += cch.length;
      }
    }
    this.store.set(key, { body: bytes, httpMetadata: opts?.httpMetadata });
  }
  async get(key: string) {
    const e = this.store.get(key);
    if (!e) return null;
    return {
      text: async () => new TextDecoder().decode(e.body),
      body: new Blob([e.body as BlobPart]).stream(),
      httpMetadata: e.httpMetadata,
      size: e.body.length,
      etag: 'test-etag',
    };
  }
  async head(key: string) {
    const e = this.store.get(key);
    if (!e) return null;
    return { size: e.body.length, httpMetadata: e.httpMetadata, etag: 'test-etag' };
  }
}

const TOKEN = 'test-release-token';
let bucket: MemBucket;
let env: any;

beforeEach(() => {
  bucket = new MemBucket();
  env = { IMAGES: bucket, ANDROID_RELEASE_TOKEN: TOKEN };
});

const APK = new Uint8Array(20_000).fill(7);

function postInit(headers: Record<string, string> = {}) {
  return {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/vnd.android.package-archive',
      'content-length': String(APK.length),
      'X-Release-Version-Code': '108',
      'X-Release-Version-Name': '1.0.8',
      'X-Release-Sha256': 'a'.repeat(64),
      'X-Release-Mandatory': 'false',
      'X-Release-Notes-B64': Buffer.from('Release 1.0.8 — pipeline auto', 'utf8').toString('base64'),
      ...headers,
    },
    body: APK as any,
  };
}

describe('POST /api/admin/android-release', () => {
  it('rejects missing/invalid bearer token with 401 UNAUTHORIZED', async () => {
    const bad = await androidReleaseRouter.request('/api/admin/android-release', {
      ...postInit(),
      headers: { ...postInit().headers, Authorization: 'Bearer nope' },
    }, { ...env });
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({ ok: false, success: false, error: 'UNAUTHORIZED' });

    const missing = await androidReleaseRouter.request('/api/admin/android-release', {
      method: 'POST',
      headers: { 'content-length': String(APK.length) },
      body: APK as any,
    }, { ...env });
    expect(missing.status).toBe(401);
  });

  it('returns 503 when the secret is unconfigured', async () => {
    const res = await androidReleaseRouter.request('/api/admin/android-release', postInit(), {
      IMAGES: bucket,
    });
    expect(res.status).toBe(503);
  });

  it('streams the APK to both R2 keys and writes latest.json', async () => {
    const res = await androidReleaseRouter.request('/api/admin/android-release', postInit(), env);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.ok).toBe(true);
    expect(body.success).toBe(true);
    expect(body.manifest.versionCode).toBe(108);
    expect(body.manifest.versionName).toBe('1.0.8');
    expect(body.manifest.apkUrl).toBe('https://cdn1.afmarbre.com/app-updates/android/atlas-commerce-v1.0.8.apk');
    expect(body.manifest.cdn1Url).toBe(body.manifest.apkUrl);
    expect(body.manifest.sha256).toBe('a'.repeat(64));
    expect(body.manifest.sizeBytes).toBe(APK.length);
    expect(body.manifest.notes).toBe('Release 1.0.8 — pipeline auto');

    const versioned = bucket.store.get('app-updates/android/atlas-commerce-v1.0.8.apk');
    const latest = bucket.store.get('app-updates/android/latest.apk');
    expect(versioned?.body.length).toBe(APK.length);
    expect(latest?.body.length).toBe(APK.length);
    expect(versioned?.httpMetadata.cacheControl).toBe('public, max-age=31536000, immutable');
    expect(latest?.httpMetadata.cacheControl).toBe('public, max-age=60');
    expect(versioned?.httpMetadata.contentType).toBe('application/vnd.android.package-archive');

    const manifestObj = bucket.store.get('app-updates/android/latest.json');
    expect(manifestObj?.httpMetadata.cacheControl).toBe('no-cache, max-age=0, must-revalidate');
    const parsed = JSON.parse(new TextDecoder().decode(manifestObj!.body));
    expect(parsed.versionCode).toBe(108);
    expect(parsed.githubUrl).toContain('/releases/download/v1.0.8/');
  });

  it('rejects tiny bodies and bad version headers', async () => {
    const tiny = await androidReleaseRouter.request('/api/admin/android-release', {
      method: 'POST',
      headers: { ...postInit().headers, 'content-length': '5' },
      body: new Uint8Array(5) as any,
    }, env);
    expect(tiny.status).toBe(400);
    expect((await tiny.json() as any).error).toBe('INVALID_APK_BODY');

    const badCode = await androidReleaseRouter.request('/api/admin/android-release', postInit({ 'X-Release-Version-Code': '0' }), env);
    expect(badCode.status).toBe(400);
  });
});

describe('GET /api/app/android-update', () => {
  beforeEach(async () => {
    await androidReleaseRouter.request('/api/admin/android-release', postInit(), env);
  });

  it('reports updateAvailable=true for an older client (107)', async () => {
    const res = await androidReleaseRouter.request('/api/app/android-update?versionCode=107', {}, env);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-cache, max-age=0, must-revalidate');
    const body: any = await res.json();
    expect(body.updateAvailable).toBe(true);
    expect(body.versionCode).toBe(108);
    expect(body.versionName).toBe('1.0.8');
    expect(body.apkUrl).toContain('atlas-commerce-v1.0.8.apk');
    expect(body.cdn1Url).toBe(body.apkUrl);
  });

  it('reports updateAvailable=false for the current client (108)', async () => {
    const res = await androidReleaseRouter.request('/api/app/android-update?versionCode=108', {}, env);
    const body: any = await res.json();
    expect(body.updateAvailable).toBe(false);
    expect(body.versionCode).toBe(108);
  });

  it('HEAD returns 200 without a body', async () => {
    const res = await androidReleaseRouter.request('/api/app/android-update', { method: 'HEAD' }, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });
});

describe('CDN1 mirror paths', () => {
  it('HEAD /app-updates/android/latest.apk uses bucket.head (200, headers)', async () => {
    await androidReleaseRouter.request('/api/admin/android-release', postInit(), env);
    const res = await serveAppUpdatesAsset(
      new Request('https://cdn1.afmarbre.com/app-updates/android/latest.apk', { method: 'HEAD' }),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/vnd.android.package-archive');
    expect(res.headers.get('Content-Length')).toBe(String(APK.length));
  });

  it('GET streams the object, unknown key 404s', async () => {
    await androidReleaseRouter.request('/api/admin/android-release', postInit(), env);
    const ok = await serveAppUpdatesAsset(
      new Request('https://cdn1.afmarbre.com/app-updates/android/latest.json'),
      env,
    );
    expect(ok.status).toBe(200);
    expect(JSON.parse(await ok.text()).versionCode).toBe(108);
    const miss = await serveAppUpdatesAsset(
      new Request('https://cdn1.afmarbre.com/app-updates/android/nope.apk'),
      env,
    );
    expect(miss.status).toBe(404);
  });
});
