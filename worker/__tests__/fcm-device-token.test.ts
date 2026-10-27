/**
 * v0.7 — FCM device-token route + schema helper.
 * Locks the production bugfix: worker/lib/fcm.ts must declare
 * fetchWithTimeout/localSchemaOnce OUTSIDE any comment (a commented-out
 * import made prod throw "localSchemaOnce is not defined"), the route must
 * create/ensure the table, upsert the token, and NEVER leak raw exception
 * text or stack details to the app.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';

const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };

import { upsertDeviceToken, resetLocalSchemaOnceForTests } from '../lib/fcm';
import { registerDeviceTokenRoutes } from '../routes/deviceToken';

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

describe('upsertDeviceToken (schema helper)', () => {
  beforeEach(() => resetLocalSchemaOnceForTests());
  it('creates the table on first call and upserts (would catch a commented-out declaration)', async () => {
    const db = makeD1();
    await upsertDeviceToken(db, 'alice', 'fcm-token-1', 'android');
    const rows = await db.prepare(`SELECT * FROM device_push_tokens WHERE username = ?`).bind('alice').all();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].token).toBe('fcm-token-1');
    // idempotent re-registration: same (username, token) → still ONE row
    await upsertDeviceToken(db, 'alice', 'fcm-token-1', 'android');
    const again = await db.prepare(`SELECT * FROM device_push_tokens WHERE username = ?`).bind('alice').all();
    expect(again.results).toHaveLength(1);
  });

  it('rejects when D1 fails (route maps it to a safe code)', async () => {
    const broken = { prepare: () => { throw new Error('D1 boom — internal stack trace'); } };
    await expect(upsertDeviceToken(broken as any, 'alice', 'tok', 'android')).rejects.toThrow();
  });
});

describe('POST /api/assist/device-token', () => {
  beforeEach(() => resetLocalSchemaOnceForTests());
  function buildApp(db: any) {
    const app = new Hono();
    registerDeviceTokenRoutes(app as any, () => ({ username: 'alice', role: 'owner' }));
    return app;
  }
  const post = (body: any, auth = 'Bearer session-token') => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) },
    body: JSON.stringify(body),
  });

  it('registers a token after schema setup → success', async () => {
    const db = makeD1();
    const app = buildApp(db);
    const r = await app.request('/api/assist/device-token', post({ token: 'fcm-abc' }), { DB: db } as any);
    expect(r.status).toBe(200);
    const body: any = await r.json();
    expect(body.success).toBe(true);
    expect(body.data.registered).toBe(true);
    const rows = await db.prepare(`SELECT * FROM device_push_tokens`).all();
    expect(rows.results).toHaveLength(1);
  });

  it('D1 failure → 500 with stable code, NO raw exception text or stack', async () => {
    const db = { prepare: () => { throw new Error('D1 boom — secret-stack-at /worker/fcm.ts:99'); } };
    const app = buildApp(db);
    const r = await app.request('/api/assist/device-token', post({ token: 'fcm-abc' }), { DB: db } as any);
    expect(r.status).toBe(500);
    const body: any = await r.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('DEVICE_TOKEN_STORE_ERROR');
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/D1 boom/);
    expect(raw).not.toMatch(/stack|fcm\.ts/i);
  });

  it('auth + validation contract unchanged', async () => {
    const db = makeD1();
    const app = buildApp(db);
    expect((await app.request('/api/assist/device-token', post({ token: 'x' }, ''), { DB: db } as any)).status).toBe(401);
    expect((await app.request('/api/assist/device-token', post({}), { DB: db } as any)).status).toBe(400);
  });
});
