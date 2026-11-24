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

  it('supports Windows, macOS, and Linux multi-OS ingestion within one version and purges all old versions on bump', async () => {
    const bucket = new MemBucket();
    const env = makeEnv(bucket);
    const exe = fakeExe(18_000, 1);
    const dmg = fakeExe(22_000, 2);
    const appImgX64 = fakeExe(25_000, 3);
    const zsyncX64 = new TextEncoder().encode('zsync: 0.6.2\nFilename: atlas-commerce-desktop-v0.9.5-linux-x86_64.AppImage\n'.repeat(12));
    const appImgArm = fakeExe(24_000, 4);

    const postAsset = (headers: Record<string, string>, body: Uint8Array) =>
      desktopReleaseRouter.fetch(
        new Request('https://api.example.com/api/admin/desktop-release', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer desktop-ci-secret-token',
            'Content-Length': String(body.byteLength),
            'X-Release-Version': '0.9.5',
            ...headers,
          },
          body: body as any,
        }),
        env,
      );

    expect((await postAsset({
      'X-Release-Platform': 'windows',
      'X-Release-Arch': 'universal',
      'X-Release-Filename': 'atlas-commerce-desktop-v0.9.5-setup.exe',
      'X-Release-Sha256': '1'.repeat(64),
    }, exe)).status).toBe(200);

    expect((await postAsset({
      'X-Release-Platform': 'macos',
      'X-Release-Arch': 'universal',
      'X-Release-Filename': 'atlas-commerce-desktop-v0.9.5-macos-universal.dmg',
      'X-Release-Sha256': '2'.repeat(64),
    }, dmg)).status).toBe(200);

    expect((await postAsset({
      'X-Release-Platform': 'linux',
      'X-Release-Arch': 'x86_64',
      'X-Release-Filename': 'atlas-commerce-desktop-v0.9.5-linux-x86_64.AppImage',
      'X-Release-Sha256': '3'.repeat(64),
    }, appImgX64)).status).toBe(200);

    expect((await postAsset({
      'X-Release-Platform': 'linux',
      'X-Release-Arch': 'x86_64',
      'X-Release-Kind': 'zsync',
      'X-Release-Filename': 'atlas-commerce-desktop-v0.9.5-linux-x86_64.AppImage.zsync',
      'X-Release-Sha256': '4'.repeat(64),
    }, zsyncX64)).status).toBe(200);

    expect((await postAsset({
      'X-Release-Platform': 'linux',
      'X-Release-Arch': 'arm64',
      'X-Release-Filename': 'atlas-commerce-desktop-v0.9.5-linux-aarch64.AppImage',
      'X-Release-Sha256': '5'.repeat(64),
    }, appImgArm)).status).toBe(200);

    // Reject APK uploads on desktop endpoint
    const badApk = await postAsset({
      'X-Release-Platform': 'windows',
      'X-Release-Filename': 'app-release.apk',
    }, exe);
    expect(badApk.status).toBe(400);

    // Verify macOS query
    const macRes: any = await (await desktopReleaseRouter.fetch(
      new Request('https://api.example.com/api/app/desktop-update?platform=macos&version=0.9.4'),
      env,
    )).json();
    expect(macRes.platform).toBe('macos');
    expect(macRes.platformAvailable).toBe(true);
    expect(macRes.updateAvailable).toBe(true);
    expect(macRes.downloadUrl).toBe('https://cdn1.afmarbre.com/app-updates/desktop/atlas-commerce-desktop-v0.9.5-macos-universal.dmg');
    expect(macRes.latestUrl).toBe('https://cdn1.afmarbre.com/app-updates/desktop/latest-macos.dmg');
    expect(macRes.sha256).toBe('2'.repeat(64));

    // Verify Linux x86_64 query includes zsyncUrl
    const linuxX64: any = await (await desktopReleaseRouter.fetch(
      new Request('https://api.example.com/api/app/desktop-update?platform=linux&arch=x86_64&version=0.9.4'),
      env,
    )).json();
    expect(linuxX64.platform).toBe('linux');
    expect(linuxX64.arch).toBe('x86_64');
    expect(linuxX64.downloadUrl).toBe('https://cdn1.afmarbre.com/app-updates/desktop/atlas-commerce-desktop-v0.9.5-linux-x86_64.AppImage');
    expect(linuxX64.zsyncUrl).toBe('https://cdn1.afmarbre.com/app-updates/desktop/atlas-commerce-desktop-v0.9.5-linux-x86_64.AppImage.zsync');

    // Verify Linux arm64 query
    const linuxArm: any = await (await desktopReleaseRouter.fetch(
      new Request('https://api.example.com/api/app/desktop-update?platform=linux&arch=arm64&version=0.9.4'),
      env,
    )).json();
    expect(linuxArm.arch).toBe('arm64');
    expect(linuxArm.downloadUrl).toBe('https://cdn1.afmarbre.com/app-updates/desktop/atlas-commerce-desktop-v0.9.5-linux-aarch64.AppImage');

    // Verify live alias cache headers for macOS DMG and Linux AppImage
    const dmgHead = await serveAppUpdatesAsset(
      new Request('https://cdn1.afmarbre.com/app-updates/desktop/latest-macos.dmg', { method: 'HEAD' }),
      env,
    );
    expect(dmgHead.status).toBe(200);
    expect(dmgHead.headers.get('Cache-Control')).toBe('no-cache, max-age=0, must-revalidate');

    const appImgHead = await serveAppUpdatesAsset(
      new Request('https://cdn1.afmarbre.com/app-updates/desktop/latest-linux-x86_64.AppImage', { method: 'HEAD' }),
      env,
    );
    expect(appImgHead.status).toBe(200);
    expect(appImgHead.headers.get('Cache-Control')).toBe('no-cache, max-age=0, must-revalidate');

    // Bump to 0.9.6: ALL 0.9.5 Windows/macOS/Linux binaries + old aliases must be purged
    const v96Res: any = await (await desktopReleaseRouter.fetch(
      new Request('https://api.example.com/api/admin/desktop-release', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer desktop-ci-secret-token',
          'Content-Length': String(exe.byteLength),
          'X-Release-Version': '0.9.6',
          'X-Release-Platform': 'windows',
          'X-Release-Arch': 'universal',
          'X-Release-Filename': 'atlas-commerce-desktop-v0.9.6-setup.exe',
          'X-Release-Sha256': '6'.repeat(64),
        },
        body: exe as any,
      }),
      env,
    )).json();
    expect(v96Res.ok).toBe(true);
    expect(bucket.map.has('app-updates/desktop/atlas-commerce-desktop-v0.9.5-macos-universal.dmg')).toBe(false);
    expect(bucket.map.has('app-updates/desktop/latest-macos.dmg')).toBe(false);
    expect(bucket.map.has('app-updates/desktop/atlas-commerce-desktop-v0.9.5-linux-x86_64.AppImage')).toBe(false);
    expect(bucket.map.has('app-updates/desktop/atlas-commerce-desktop-v0.9.6-setup.exe')).toBe(true);
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
