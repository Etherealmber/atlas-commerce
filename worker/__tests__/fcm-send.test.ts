import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendFcmToUser, upsertDeviceToken, resetLocalSchemaOnceForTests } from '../lib/fcm';

const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = await import(SQLITE_MODULE);
let testPem: string;

beforeAll(async () => {
  // Ephemeral local test key, never production credentials or written to disk.
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const bytes = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  testPem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...bytes))}\n-----END PRIVATE KEY-----`;
});

function makeD1() {
  const sqlite = new DatabaseSync(':memory:');
  const db: any = {
    prepare(sql: string) {
      let params: any[] = [];
      const stmt: any = {
        bind(...p: any[]) { params = p; return stmt; },
        async run() { const r = sqlite.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes) } }; },
        async all() { return { results: sqlite.prepare(sql).all(...params) }; },
      };
      return stmt;
    },
  };
  return { sqlite, db };
}

let db: any;
let sqlite: any;
let env: any;
let sends: any[];
let response: (body: any) => Response | Promise<Response>;
let oauthStatus: number;
let logs: unknown[][];
const opts = { title: 'Atlas Commerce', body: 'Une demande attend votre validation.', data: { event: 'stock_request_submitted', request_id: '42' } };
const fcmError = (code: string, status = 404, extra: unknown[] = []) => Response.json({ error: { status: status === 404 ? 'NOT_FOUND' : 'INVALID_ARGUMENT', details: [...extra, { '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: code }] } }, { status });
const count = () => Number(sqlite.prepare('SELECT COUNT(*) AS n FROM device_push_tokens').get().n);

beforeEach(async () => {
  resetLocalSchemaOnceForTests();
  ({ db, sqlite } = makeD1());
  await upsertDeviceToken(db, 'alice', 'registration-private-1');
  env = { DB: db, FIREBASE_PROJECT_ID: 'atlas-test', FIREBASE_CLIENT_EMAIL: 'test@atlas-test.iam.gserviceaccount.com', FIREBASE_PRIVATE_KEY: testPem };
  sends = [];
  logs = [];
  oauthStatus = 200;
  response = () => Response.json({ name: 'projects/atlas-test/messages/message-123' });
  for (const method of ['info', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logs.push(args); });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (new URL(String(url)).hostname === 'oauth2.googleapis.com') return Response.json(oauthStatus === 200 ? { access_token: 'oauth-private-token' } : { error: 'invalid_grant', error_description: 'credential-private-text' }, { status: oauthStatus });
    const body = JSON.parse(String(init.body));
    sends.push({ url: String(url), ...body });
    return response(body);
  });
});
afterEach(() => { sqlite.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('FCM Android send path', () => {
  it('sends a visible v1 notification on atlas_assist with event/IDs and logs the accepted message ID', async () => {
    expect(await sendFcmToUser(env, 'alice', opts)).toEqual({ sent: 1, purged: 0 });
    expect(sends[0]).toMatchObject({
      url: 'https://fcm.googleapis.com/v1/projects/atlas-test/messages:send',
      message: { token: 'registration-private-1', notification: { title: opts.title, body: opts.body }, android: { priority: 'HIGH', notification: { channel_id: 'atlas_assist' } }, data: { event: 'stock_request_submitted', request_id: '42', click_action: 'ATLAS_ASSIST_APPROVAL' } },
    });
    expect(JSON.stringify(logs)).toContain('message-123');
    expect(JSON.stringify(logs)).toContain('http_status');
    expect(JSON.stringify(logs)).not.toMatch(/registration-private|oauth-private|PRIVATE KEY|credential-private/);
  });

  it('supports normal priority and preserves older type-based click metadata', async () => {
    await sendFcmToUser(env, 'alice', { ...opts, data: { type: 'low_stock', product_id: '2' }, priority: 'NORMAL' });
    expect(sends[0].message.android.priority).toBe('NORMAL');
    expect(sends[0].message.data).toMatchObject({ event: 'low_stock', type: 'low_stock', product_id: '2' });
  });

  it.each([{ title: ' ', body: 'body' }, { title: 'title', body: '' }])('does not send an empty user-visible notification: %j', async (invalid) => {
    expect(await sendFcmToUser(env, 'alice', invalid)).toEqual({ sent: 0, purged: 0 });
    expect(sends).toHaveLength(0);
    expect(count()).toBe(1);
  });

  it('purges only explicit typed UNREGISTERED, even after an unrelated first detail', async () => {
    response = () => fcmError('UNREGISTERED', 404, [{ '@type': 'type.googleapis.com/google.rpc.BadRequest', fieldViolations: [] }]);
    expect(await sendFcmToUser(env, 'alice', opts)).toEqual({ sent: 0, purged: 1 });
    expect(count()).toBe(0);
  });

  it.each([400, 401, 403, 404, 410, 429, 500, 503])('retains tokens on bare HTTP %s and logs its response code', async (status) => {
    response = () => Response.json({ error: { status: 'NOT_FOUND', message: 'registration-private-1 oauth-private-token' } }, { status });
    expect(await sendFcmToUser(env, 'alice', opts)).toEqual({ sent: 0, purged: 0 });
    expect(count()).toBe(1);
    expect(JSON.stringify(logs)).toContain(`"http_status":${status}`);
    expect(JSON.stringify(logs)).not.toMatch(/registration-private|oauth-private/);
  });

  it.each(['SENDER_ID_MISMATCH', 'INVALID_ARGUMENT', 'THIRD_PARTY_AUTH_ERROR', 'QUOTA_EXCEEDED', 'UNAVAILABLE'])('retains tokens explicitly rejected with %s', async (code) => {
    response = () => fcmError(code, 403);
    expect(await sendFcmToUser(env, 'alice', opts)).toEqual({ sent: 0, purged: 0 });
    expect(count()).toBe(1);
    expect(JSON.stringify(logs)).toContain(code);
  });

  it('does not mistake a generic or incorrectly typed error for an FCM unregistration', async () => {
    response = () => Response.json({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }, { status: 404 });
    expect((await sendFcmToUser(env, 'alice', opts)).purged).toBe(0);
    expect(count()).toBe(1);
  });

  it('does not count an empty, malformed or wrong-project 2xx response as acceptance', async () => {
    for (const body of [{}, { name: 'projects/other-project/messages/m1' }, { name: 'projects/atlas-test/messages/' }]) {
      response = () => Response.json(body);
      expect((await sendFcmToUser(env, 'alice', opts)).sent).toBe(0);
    }
    expect(count()).toBe(1);
  });

  it('continues to other devices on a network failure and never logs exception text', async () => {
    await upsertDeviceToken(db, 'alice', 'registration-private-2');
    response = (body) => {
      if (body.message.token === 'registration-private-1') throw new Error('registration-private-1 oauth-private-token');
      return Response.json({ name: 'projects/atlas-test/messages/other-message' });
    };
    expect(await sendFcmToUser(env, 'alice', opts)).toEqual({ sent: 1, purged: 0 });
    expect(sends).toHaveLength(2);
    expect(count()).toBe(2);
    expect(JSON.stringify(logs)).not.toMatch(/registration-private|oauth-private/);
  });

  it('does not fall back to legacy after configured v1 OAuth is rejected', async () => {
    env.FCM_SERVER_KEY = 'legacy-private-key';
    oauthStatus = 401;
    expect(await sendFcmToUser(env, 'alice', opts)).toEqual({ sent: 0, purged: 0 });
    expect(sends).toHaveLength(0);
    expect(count()).toBe(1);
    expect(JSON.stringify(logs)).not.toMatch(/credential-private|legacy-private|PRIVATE KEY/);
  });

  it('legacy compatibility inspects per-recipient errors; bare 404 cannot purge', async () => {
    delete env.FIREBASE_PROJECT_ID;
    env.FCM_SERVER_KEY = 'legacy-private-key';
    response = () => new Response('gone', { status: 404 });
    expect(await sendFcmToUser(env, 'alice', opts)).toEqual({ sent: 0, purged: 0 });
    expect(count()).toBe(1);
    response = () => Response.json({ results: [{ error: 'NotRegistered' }] });
    expect(await sendFcmToUser(env, 'alice', opts)).toEqual({ sent: 0, purged: 1 });
    expect(count()).toBe(0);
  });

  it('legacy HTTP 200 with a quota error is not accepted or purged', async () => {
    delete env.FIREBASE_PROJECT_ID;
    env.FCM_SERVER_KEY = 'legacy-private-key';
    response = () => Response.json({ results: [{ error: 'Unavailable' }] });
    expect(await sendFcmToUser(env, 'alice', opts)).toEqual({ sent: 0, purged: 0 });
    expect(count()).toBe(1);
  });

  it('creates the registration table independently for each database without discarding tokens', async () => {
    const other = makeD1();
    try {
      await upsertDeviceToken(other.db, 'alice', 'registration-private-other');
      expect(Number(other.sqlite.prepare('SELECT COUNT(*) n FROM device_push_tokens').get().n)).toBe(1);
      expect(count()).toBe(1);
    } finally { other.sqlite.close(); }
  });
});
