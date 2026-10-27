/**
 * v0.7 — minimum supported Android version: policy persistence, validation,
 * CI carry-over, 426 enforcement guard and public update-check fields.
 * Real Hono apps + in-process SQLite (node:sqlite) D1 shim + in-memory R2.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';

const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };

import {
  ANDROID_MIN_GUARD_EXEMPT,
  androidMinVersionGuard,
  carryPolicyIntoManifest,
  manifestWithPolicy,
  parseMinVersionPolicy,
  readMinVersionPolicy,
  resetMinVersionPolicyCacheForTests,
  updateRequiredBody,
  validateMinVersionPolicy,
  writeMinVersionPolicy,
  type MinVersionPolicy,
} from '../lib/app-update-policy';
import { androidReleaseRouter } from '../routes/androidRelease';

function makeD1() {
  const sqlite = new DatabaseSync(':memory:');
  const db: any = {
    prepare(sql: string) {
      let params: any[] = [];
      const api: any = {
        bind(...p: any[]) { params = p; return api; },
        async run() {
          const r = sqlite.prepare(sql).run(...(params as any));
          return { success: true, meta: { changes: Number(r.changes || 0), last_row_id: Number(r.lastInsertRowid || 0) } };
        },
        async first() { return sqlite.prepare(sql).get(...(params as any)) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...(params as any)).map((r: any) => ({ ...r })) }; },
      };
      return api;
    },
  };
  return db;
}

function makeBucket(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    store,
    async get(key: string) {
      return store.has(key) ? { text: async () => store.get(key)! } : null;
    },
    async head(key: string) {
      return store.has(key) ? { size: (store.get(key) || '').length, uploaded: new Date().toISOString() } : null;
    },
    async put(key: string, value: any) {
      store.set(key, typeof value === 'string' ? value : '[stream]');
    },
  };
}

const RELEASE = {
  versionCode: 42,
  versionName: '1.2.0',
  apkUrl: 'https://cdn1.afmarbre.com/app-updates/android/latest.apk',
  mandatory: false,
  notes: '',
};

describe('policy parsing & validation', () => {
  it('parses enabled/code defensively (defaults disabled)', () => {
    expect(parseMinVersionPolicy(undefined, undefined)).toEqual({ enabled: false, code: 0 });
    expect(parseMinVersionPolicy('1', '12')).toEqual({ enabled: true, code: 12 });
    expect(parseMinVersionPolicy(true, -3)).toEqual({ enabled: true, code: 0 });
    expect(parseMinVersionPolicy('true', '7.9')).toEqual({ enabled: true, code: 7 });
  });

  it('rejects unsafe floors before a blocking policy can activate', () => {
    expect(validateMinVersionPolicy({ enabled: false, code: 0 }, null)).toBeNull();
    expect(validateMinVersionPolicy({ enabled: true, code: 0 }, RELEASE)).toMatch(/entier/);
    expect(validateMinVersionPolicy({ enabled: true, code: 43 }, RELEASE)).toMatch(/d[ée]passer/);
    expect(validateMinVersionPolicy({ enabled: true, code: 10 }, { ...RELEASE, apkUrl: '' })).toMatch(/APK/);
    expect(validateMinVersionPolicy({ enabled: true, code: 10 }, null)).toMatch(/release/);
    expect(validateMinVersionPolicy({ enabled: true, code: 42 }, RELEASE)).toBeNull();
  });

  it('manifest mirror + CI carry-over never reset the admin policy', () => {
    const policy: MinVersionPolicy = { enabled: true, code: 30 };
    const withMin = manifestWithPolicy(RELEASE, policy);
    expect(withMin.minimumVersionEnabled).toBe(true);
    expect(withMin.minimumSupportedVersionCode).toBe(30);
    // CI publishes a NEW release: policy carried from previous manifest…
    const next = carryPolicyIntoManifest({ ...RELEASE, versionCode: 50 }, withMin, null);
    expect(next.policy).toEqual(policy);
    expect(next.manifest.minimumSupportedVersionCode).toBe(30);
    // …or from app_config when the old manifest had none…
    const fromDb = carryPolicyIntoManifest({ ...RELEASE, versionCode: 50 }, RELEASE, policy);
    expect(fromDb.policy).toEqual(policy);
    // …and stays disabled when nothing was ever configured.
    const fresh = carryPolicyIntoManifest(RELEASE, null, null);
    expect(fresh.policy).toEqual({ enabled: false, code: 0 });
  });
});

describe('policy persistence (app_config)', () => {
  let db: any;
  beforeEach(() => { db = makeD1(); });

  it('reads disabled by default and round-trips writes', async () => {
    expect(await readMinVersionPolicy(db, { bypassCache: true })).toEqual({ enabled: false, code: 0 });
    await writeMinVersionPolicy(db, { enabled: true, code: 21 });
    expect(await readMinVersionPolicy(db, { bypassCache: true })).toEqual({ enabled: true, code: 21 });
    await writeMinVersionPolicy(db, { enabled: false, code: 21 });
    expect(await readMinVersionPolicy(db, { bypassCache: true })).toEqual({ enabled: false, code: 21 });
  });

  it('survives a broken DB as disabled (backward compatible)', async () => {
    const broken = { prepare: () => { throw new Error('D1 down'); } };
    expect(await readMinVersionPolicy(broken, { bypassCache: true })).toEqual({ enabled: false, code: 0 });
  });
});

describe('Android 426 enforcement guard', () => {
  let db: any;
  let app: Hono<any>;
  const manifest = manifestWithPolicy(RELEASE, { enabled: true, code: 40 });

  beforeEach(async () => {
    resetMinVersionPolicyCacheForTests();
    db = makeD1();
    app = new Hono();
    app.use(
      '/api/*',
      androidMinVersionGuard({
        readPolicy: (d: any) => readMinVersionPolicy(d, { bypassCache: true }),
        readManifest: async () => manifest,
      }),
    );
    app.get('/api/health', (c) => c.json({ ok: true }));
    app.get('/api/app/android-update', (c) => c.json({ ok: true }));
    app.get('/api/products', (c) => c.json({ ok: true, route: 'products' }));
  });

  const android = (code?: string) => {
    const h: Record<string, string> = { 'X-Atlas-Client': 'android' };
    if (code !== undefined) h['X-Atlas-App-Version-Code'] = code;
    return { headers: h };
  };
  const env = () => ({ DB: db });

  it('disabled policy → Android clients untouched', async () => {
    const r = await app.request('/api/products', android('1'), env());
    expect(r.status).toBe(200);
  });

  it('below-floor Android request → 426 APP_UPDATE_REQUIRED with update payload', async () => {
    await writeMinVersionPolicy(db, { enabled: true, code: 40 });
    const r = await app.request('/api/products', android('39'), env());
    expect(r.status).toBe(426);
    const body: any = await r.json();
    expect(body.code).toBe('APP_UPDATE_REQUIRED');
    expect(body.update.versionCode).toBe(42);
    expect(body.update.apkUrl).toBe(RELEASE.apkUrl);
    expect(body.update.minimumSupportedVersionCode).toBe(40);
  });

  it('old Android client WITHOUT version headers → update prompt, not an auth error', async () => {
    await writeMinVersionPolicy(db, { enabled: true, code: 40 });
    const r = await app.request('/api/products', android(), env());
    expect(r.status).toBe(426);
    expect(((await r.json()) as any).code).toBe('APP_UPDATE_REQUIRED');
  });

  it('at-or-above floor → passes through', async () => {
    await writeMinVersionPolicy(db, { enabled: true, code: 40 });
    expect((await app.request('/api/products', android('40'), env())).status).toBe(200);
    expect((await app.request('/api/products', android('41'), env())).status).toBe(200);
  });

  it('web clients never blocked', async () => {
    await writeMinVersionPolicy(db, { enabled: true, code: 40 });
    const r = await app.request('/api/products', { headers: {} }, env());
    expect(r.status).toBe(200);
  });

  it('bootstrap/health + update-check stay reachable for outdated clients', async () => {
    await writeMinVersionPolicy(db, { enabled: true, code: 40 });
    for (const p of ANDROID_MIN_GUARD_EXEMPT) {
      const r = await app.request(p, android('1'), env());
      expect(r.status).toBe(200);
    }
  });

  it('426 body builder is stable and safe (no stack, no secrets)', () => {
    const body = updateRequiredBody(manifest, { enabled: true, code: 40 });
    expect(body.code).toBe('APP_UPDATE_REQUIRED');
    expect(JSON.stringify(body)).not.toMatch(/at |\n\s+at |stack/i);
  });
});

describe('public GET /api/app/android-update echoes the policy', () => {
  it('returns minimum fields + latest usable release, uncached', async () => {
    resetMinVersionPolicyCacheForTests();
    const bucket = makeBucket({
      'app-updates/android/latest.json': JSON.stringify(
        manifestWithPolicy(RELEASE, { enabled: true, code: 40 }),
      ),
    });
    const app = new Hono();
    app.route('/', androidReleaseRouter as any);
    const env = { IMAGES: bucket, DB: makeD1() };
    const r = await app.request('/api/app/android-update?versionCode=39', {}, env as any);
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toMatch(/no-cache/);
    const body: any = await r.json();
    expect(body.updateAvailable).toBe(true);
    expect(body.minimumVersionEnabled).toBe(true);
    expect(body.minimumSupportedVersionCode).toBe(40);
    expect(body.minimumVersionRequired).toBe(true);
    expect(body.apkUrl).toBe(RELEASE.apkUrl);

    const ok = await app.request('/api/app/android-update?versionCode=40', {}, env as any);
    expect(((await ok.json()) as any).minimumVersionRequired).toBe(false);

    const head = await app.request('/api/app/android-update', { method: 'HEAD' }, env as any);
    expect(head.status).toBe(200);
  });

  it('DB fallback keeps working when R2 has no manifest', async () => {
    resetMinVersionPolicyCacheForTests();
    const db = makeD1();
    await db.prepare(`CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT)`).run();
    for (const [k, v] of [
      ['android_update_version_code', '12'],
      ['android_update_apk_url', 'https://cdn1.afmarbre.com/app-updates/android/latest.apk'],
    ]) {
      await db.prepare(`INSERT INTO app_config (key, value) VALUES (?, ?)`).bind(k, v).run();
    }
    const app = new Hono();
    app.route('/', androidReleaseRouter as any);
    const r = await app.request('/api/app/android-update?versionCode=5', {}, { IMAGES: makeBucket(), DB: db } as any);
    const body: any = await r.json();
    expect(body.versionCode).toBe(12);
    expect(body.minimumVersionEnabled).toBe(false);
    expect(body.minimumVersionRequired).toBe(false);
  });
});
