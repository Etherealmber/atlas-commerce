/**
 * Tests for the Windows Desktop CDN1 release pipeline:
 *  - POST /api/admin/desktop-release (Bearer auth, R2 dual write, old-asset purge)
 *  - GET / HEAD /api/app/desktop-update (pre-login update check, semver & min-version)
 *  - serveAppUpdatesAsset for app-updates/desktop/* (no-cache on live files, Range/HEAD)
 *  - Isolation from Android (android/* untouched, unsupported platform rejected, 426 exempt)
 */
import { describe, expect, it } from 'vitest';
import {
  desktopReleaseRouter,
  DESKTOP_JSON_KEY,
  DESKTOP_LATEST_EXE_KEY,
  DESKTOP_CHECKSUMS_KEY,
} from '../routes/desktopRelease';
import { serveAppUpdatesAsset } from '../routes/androidRelease';
import { androidMinVersionGuard } from '../lib/app-update-policy';

if (typeof (globalThis as any).FixedLengthStream === 'undefined') {
  (globalThis as any).FixedLengthStream = class FixedLengthStream extends TransformStream {
    constructor(_expectedLength?: number) {
      super();
    }
  };
}

class MemBucket {
  map = new Map<string, { bytes: Uint8Array; httpMetadata: Record<string, string> }>();
  async put(key: string, body: any, opts?: any) {
    let bytes: Uint8Array;
    if (typeof body === 'string') {
      bytes = new TextEncoder().encode(body);
    } else if (body instanceof Uint8Array) {
      bytes = body;
    } else if (body && typeof body.getReader === 'function') {
      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const c = value instanceof Uint8Array ? value : new Uint8Array(value);
        chunks.push(c);
        total += c.byteLength;
      }
      bytes = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        bytes.set(c, off);
        off += c.byteLength;
      }
    } else {
      bytes = new Uint8Array(0);
    }
    this.map.set(key, { bytes, httpMetadata: opts?.httpMetadata || {} });
  }
  async head(key: string) {
    const e = this.map.get(key);
    if (!e) return null;
    return {
      size: e.bytes.byteLength,
      etag: 'etag-' + e.bytes.byteLength,
      uploaded: new Date('2026-10-20T12:00:00.000Z'),
      httpMetadata: e.httpMetadata,
      writeHttpMetadata(h: Headers) {
        if (e.httpMetadata.contentType) h.set('Content-Type', e.httpMetadata.contentType);
        if (e.httpMetadata.cacheControl) h.set('Cache-Control', e.httpMetadata.cacheControl);
      },
    };
  }
  async get(key: string, opts?: any) {
    const e = this.map.get(key);
    if (!e) return null;
    let slice = e.bytes;
    if (opts?.range) {
      const off = Number(opts.range.offset || 0);
      const len = Number(opts.range.length || slice.byteLength);
      slice = e.bytes.subarray(off, off + len);
    }
    return {
      size: e.bytes.byteLength,
      etag: 'etag-' + e.bytes.byteLength,
      httpMetadata: e.httpMetadata,
      body: new ReadableStream({
        start(ctrl) {
          ctrl.enqueue(slice);
          ctrl.close();
        },
      }),
      writeHttpMetadata(h: Headers) {
        if (e.httpMetadata.contentType) h.set('Content-Type', e.httpMetadata.contentType);
        if (e.httpMetadata.cacheControl) h.set('Cache-Control', e.httpMetadata.cacheControl);
      },
      async text() {
        return new TextDecoder().decode(slice);
      },
    };
  }
  async list(opts?: { prefix?: string; cursor?: string }) {
    const prefix = opts?.prefix || '';
    const all = Array.from(this.map.entries())
      .filter(([k]) => k.startsWith(prefix))
      .sort(([a], [b]) => a.localeCompare(b));
    const offset = opts?.cursor ? Number(opts.cursor) : 0;
    const pageSize = 2; // small page size to exercise pagination in purgeOldDesktopAssets
    const slice = all.slice(offset, offset + pageSize);
    const nextOffset = offset + slice.length;
    return {
      objects: slice.map(([key, v]) => ({
        key,
        size: v.bytes.byteLength,
        uploaded: new Date('2026-10-20T12:00:00.000Z'),
      })),
      truncated: nextOffset < all.length,
      cursor: nextOffset < all.length ? String(nextOffset) : undefined,
    };
  }
  async delete(keys: string | string[]) {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const k of list) this.map.delete(k);
  }
}

function makeEnv(bucket = new MemBucket(), overrides: Record<string, any> = {}): any {
  return {
    IMAGES: bucket,
    DESKTOP_RELEASE_TOKEN: 'desktop-ci-secret-token',
    CDN_BASE: 'https://cdn1.afmarbre.com',
    ...overrides,
  };
}

function fakeExe(size = 16_384, seed = 0x4d): Uint8Array {
  const b = new Uint8Array(size);
  b[0] = 0x4d;
  b[1] = 0x5a; // MZ header
  for (let i = 2; i < b.length; i++) b[i] = (i + seed) & 0xff;
  return b;
}

describe('desktopReleaseRouter', () => {
  it('returns structured empty state when no desktop release is published yet', async () => {
    const env = makeEnv();
    const res = await desktopReleaseRouter.fetch(
      new Request('https://api.example.com/api/app/desktop-update?version=0.9.1&platform=windows'),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('no-cache');
    const j: any = await res.json();
    expect(j.hasRelease).toBe(false);
    expect(j.updateAvailable).toBe(false);
    expect(j.platform).toBe('windows');
  });

  it('rejects non-windows platforms so desktop endpoint never mixes with android', async () => {
    const env = makeEnv();
    const res = await desktopReleaseRouter.fetch(
      new Request('https://api.example.com/api/app/desktop-update?platform=android&version=1.0.0'),
      env,
    );
    expect(res.status).toBe(400);
    const j: any = await res.json();
    expect(j.error).toBe('UNSUPPORTED_PLATFORM');
  });

  it('requires DESKTOP_RELEASE_TOKEN and valid Bearer header on POST /api/admin/desktop-release', async () => {
    const envNoToken = makeEnv(new MemBucket(), { DESKTOP_RELEASE_TOKEN: '' });
    const r503 = await desktopReleaseRouter.fetch(
      new Request('https://api.example.com/api/admin/desktop-release', { method: 'POST' }),
      envNoToken,
    );
    expect(r503.status).toBe(503);

    const env = makeEnv();
    const r401 = await desktopReleaseRouter.fetch(
      new Request('https://api.example.com/api/admin/desktop-release', {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong-token' },
      }),
      env,
    );
    expect(r401.status).toBe(401);
  });

  it('ingests a new desktop release, purges ALL old desktop files, and preserves android files', async () => {
    const bucket = new MemBucket();
    // Seed old desktop installers + unrelated android object
    await bucket.put('app-updates/desktop/atlas-commerce-desktop-v0.9.0-windows-universal-setup.exe', fakeExe(12_000));
    await bucket.put('app-updates/desktop/atlas-commerce-desktop-v0.9.1-windows-universal-setup.exe', fakeExe(12_000));
    await bucket.put('app-updates/desktop/stale-notes.txt', 'old');
    await bucket.put('app-updates/android/latest.apk', fakeExe(12_000));

    const env = makeEnv(bucket);
    const bytes = fakeExe(24_576, 7);
    const sha = 'a'.repeat(64);
    const notesB64 = Buffer.from('Correction flicker Windows & v3 auth', 'utf8').toString('base64');

    const res = await desktopReleaseRouter.fetch(
      new Request('https://api.example.com/api/admin/desktop-release', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer desktop-ci-secret-token',
          'Content-Type': 'application/vnd.microsoft.portable-executable',
          'Content-Length': String(bytes.byteLength),
          'X-Release-Version': 'v0.9.3',
          'X-Release-Channel': 'stable',
          'X-Release-Arch': 'universal',
          'X-Release-Filename': 'atlas-commerce-desktop-v0.9.3-windows-universal-setup.exe',
          'X-Release-Sha256': sha,
          'X-Release-Minimum-Version': '0.9.1',
          'X-Release-Mandatory': 'false',
          'X-Release-Notes-B64': notesB64,
        },
        body: bytes as any,
      }),
      env,
    );
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.ok).toBe(true);
    expect(body.manifest.version).toBe('0.9.3');
    expect(body.manifest.minimum_version).toBe('0.9.1');
    expect(body.manifest.downloadUrl).toBe(
      'https://cdn1.afmarbre.com/app-updates/desktop/atlas-commerce-desktop-v0.9.3-windows-universal-setup.exe',
    );
    expect(body.manifest.latestUrl).toBe('https://cdn1.afmarbre.com/app-updates/desktop/latest-setup.exe');
    expect(body.deletedKeys).toHaveLength(3);

    // Old desktop objects must be gone
    expect(bucket.map.has('app-updates/desktop/atlas-commerce-desktop-v0.9.0-windows-universal-setup.exe')).toBe(false);
    expect(bucket.map.has('app-updates/desktop/atlas-commerce-desktop-v0.9.1-windows-universal-setup.exe')).toBe(false);
    expect(bucket.map.has('app-updates/desktop/stale-notes.txt')).toBe(false);

    // New desktop objects must exist
    expect(bucket.map.has('app-updates/desktop/atlas-commerce-desktop-v0.9.3-windows-universal-setup.exe')).toBe(true);
    expect(bucket.map.has(DESKTOP_LATEST_EXE_KEY)).toBe(true);
    expect(bucket.map.has(DESKTOP_CHECKSUMS_KEY)).toBe(true);
    expect(bucket.map.has(DESKTOP_JSON_KEY)).toBe(true);

    // Android bucket prefix remains untouched
    expect(bucket.map.has('app-updates/android/latest.apk')).toBe(true);
  });

  it('computes semver updateAvailable and minimumVersionRequired accurately', async () => {
    const bucket = new MemBucket();
    const env = makeEnv(bucket);
    const bytes = fakeExe(20_000);
    await desktopReleaseRouter.fetch(
      new Request('https://api.example.com/api/admin/desktop-release', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer desktop-ci-secret-token',
          'Content-Length': String(bytes.byteLength),
          'X-Release-Version': '0.9.3',
          'X-Release-Minimum-Version': '0.9.1',
          'X-Release-Sha256': 'b'.repeat(64),
        },
        body: bytes as any,
      }),
      env,
    );

    const oldClient = await desktopReleaseRouter.fetch(
      new Request('https://api.example.com/api/app/desktop-update?version=0.9.0&platform=windows'),
      env,
    );
    const oldJson: any = await oldClient.json();
    expect(oldJson.hasRelease).toBe(true);
    expect(oldJson.updateAvailable).toBe(true);
    expect(oldJson.minimumVersionRequired).toBe(true);

    const midClient = await desktopReleaseRouter.fetch(
      new Request('https://api.example.com/api/app/desktop-update?version=0.9.2&platform=windows'),
      env,
    );
    const midJson: any = await midClient.json();
    expect(midJson.updateAvailable).toBe(true);
    expect(midJson.minimumVersionRequired).toBe(false);

    const upToDate = await desktopReleaseRouter.fetch(
      new Request('https://api.example.com/api/app/desktop-update?version=v0.9.3&platform=windows'),
      env,
    );
    const upJson: any = await upToDate.json();
    expect(upJson.updateAvailable).toBe(false);
    expect(upJson.minimumVersionRequired).toBe(false);

    const headRes = await desktopReleaseRouter.fetch(
      new Request('https://api.example.com/api/app/desktop-update?version=0.9.2&platform=windows', { method: 'HEAD' }),
      env,
    );
    expect(headRes.status).toBe(200);
  });

  it('serves app-updates/desktop/* through serveAppUpdatesAsset with no-cache on live assets & Range support', async () => {
    const bucket = new MemBucket();
    const env = makeEnv(bucket);
    const bytes = fakeExe(16_384, 3);
    await desktopReleaseRouter.fetch(
      new Request('https://api.example.com/api/admin/desktop-release', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer desktop-ci-secret-token',
          'Content-Length': String(bytes.byteLength),
          'X-Release-Version': '0.9.4',
          'X-Release-Filename': 'atlas-commerce-desktop-v0.9.4-windows-universal-setup.exe',
          'X-Release-Sha256': 'c'.repeat(64),
        },
        body: bytes as any,
      }),
      env,
    );

    const jsonRes = await serveAppUpdatesAsset(
      new Request('https://cdn1.afmarbre.com/app-updates/desktop/latest.json'),
      env,
    );
    expect(jsonRes.status).toBe(200);
    expect(jsonRes.headers.get('Cache-Control')).toBe('no-cache, max-age=0, must-revalidate');

    const latestExeRes = await serveAppUpdatesAsset(
      new Request('https://cdn1.afmarbre.com/app-updates/desktop/latest-setup.exe'),
      env,
    );
    expect(latestExeRes.status).toBe(200);
    expect(latestExeRes.headers.get('Cache-Control')).toBe('no-cache, max-age=0, must-revalidate');
    expect(latestExeRes.headers.get('Content-Length')).toBe(String(bytes.byteLength));

    const versionedHead = await serveAppUpdatesAsset(
      new Request('https://cdn1.afmarbre.com/app-updates/desktop/atlas-commerce-desktop-v0.9.4-windows-universal-setup.exe', {
        method: 'HEAD',
      }),
      env,
    );
    expect(versionedHead.status).toBe(200);
    expect(versionedHead.headers.get('Cache-Control')).toContain('immutable');

    const traversal = await serveAppUpdatesAsset(
      new Request('https://cdn1.afmarbre.com/app-updates/desktop/../secrets.json'),
      env,
    );
    expect(traversal.status).toBe(404);
  });

  it('is exempt from the Android minimum-version 426 guard', async () => {
    const mw = androidMinVersionGuard({
      readPolicy: async () => ({ enabled: true, code: 999 }),
      readManifest: async () => ({ versionCode: 999, apkUrl: 'https://cdn1.afmarbre.com/app-updates/android/latest.apk' }),
    });
    let nextCalled = false;
    const fakeContext: any = {
      req: {
        url: 'https://api.example.com/api/app/desktop-update?version=0.9.0&platform=windows',
        header: (k: string) =>
          k.toLowerCase() === 'x-atlas-client'
            ? 'android'
            : k.toLowerCase() === 'x-atlas-app-version-code'
              ? '1'
              : undefined,
      },
      env: {},
    };
    await mw(fakeContext, async () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(true);
  });
});
