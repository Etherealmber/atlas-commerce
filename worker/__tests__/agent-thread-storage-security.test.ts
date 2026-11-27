import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { registerMailboxRoutes } from '../routes/mailbox';

function app() {
  const router = new Hono<any>();
  registerMailboxRoutes(router, { sessionUserFromHeader: () => ({ username: 'alice', role: 'owner' }) } as any);
  return router;
}
const request = () => new Request('https://example.test/api/admin/agent/threads/thread1', {
  method: 'PUT', headers: { Authorization: 'Bearer session', 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'private', messages: [{ role: 'user', text: 'secret message' }] }),
});

describe('agent thread storage security', () => {
  it('does not create a new object using the legacy hardcoded key', async () => {
    const put = vi.fn();
    const res = await app().fetch(request(), { IMAGES: { put } } as any);
    expect(res.status).toBe(503);
    expect((await res.json() as any).code).toBe('AGENT_STORAGE_UNAVAILABLE');
    expect(put).not.toHaveBeenCalled();
  });
  it('does not fall back to writing plaintext conversations to KV', async () => {
    const put = vi.fn();
    const res = await app().fetch(request(), { CACHE: { put } } as any);
    expect(res.status).toBe(503);
    expect((await res.json() as any).code).toBe('AGENT_STORAGE_UNAVAILABLE');
    expect(put).not.toHaveBeenCalled();
  });
  it('encrypts a new thread when a server secret exists', async () => {
    const put = vi.fn(async (_key: string, _data: Uint8Array) => ({ etag: 'v1' }));
    const res = await app().fetch(request(), { IMAGES: { put }, AGENT_CHAT_SECRET: 'test-secret-only' } as any);
    expect((await res.json() as any).data.storage).toBe('r2');
    expect(put).toHaveBeenCalledOnce();
    expect(new TextDecoder().decode(put.mock.calls[0][1] as Uint8Array)).not.toContain('secret message');
  });
});

it('recovers a missing conversation title from its encrypted R2 messages', async () => {
  const objects = new Map<string, Uint8Array>();
  const images = {
    put: async (key: string, value: Uint8Array) => { objects.set(key, value); return { etag: 'v1' }; },
    get: async (key: string) => { const bytes = objects.get(key); return bytes ? { etag: 'v1', arrayBuffer: async () => bytes.slice().buffer } : null; },
    list: async () => ({ objects: [...objects.keys()].map(key => ({ key, uploaded: new Date() })) }),
  };
  const env: any = { IMAGES: images, AGENT_CHAT_SECRET: 'test-secret' };
  const router = app();
  await router.fetch(new Request('https://example.test/api/admin/agent/threads/t1', { method: 'PUT', headers: { Authorization: 'Bearer session', 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Sans titre', messages: [{ role: 'user', text: 'Chercher un produit' }] }) }), env);
  const res = await router.fetch(new Request('https://example.test/api/admin/agent/threads', { headers: { Authorization: 'Bearer session' } }), env);
  expect((await res.json() as any).data).toMatchObject([{ id: 't1', title: 'Chercher un produit', message_count: 1 }]);
});

it('round-trips encrypted R2 threads and rejects stale concurrent writers', async () => {
  const objects = new Map<string, { bytes: Uint8Array; etag: string }>(); let revision = 0;
  const images = {
    async put(key: string, bytes: Uint8Array, options: any) {
      const existing = objects.get(key); const condition = options.onlyIf;
      if (condition instanceof Headers && condition.get('If-None-Match') === '*' && existing) return null;
      if (condition?.etagMatches && condition.etagMatches !== existing?.etag) return null;
      const etag = `v${++revision}`; objects.set(key, { bytes: bytes.slice(), etag }); return { etag };
    },
    async get(key: string) { const o = objects.get(key); return o ? { etag: o.etag, arrayBuffer: async () => o.bytes.slice().buffer } : null; },
    async list() { return { objects: [...objects.keys()].map(key => ({ key, uploaded: new Date() })), truncated: false }; },
  };
  const env: any = { IMAGES: images, AGENT_CHAT_SECRET: 'secret' }; const router = app();
  const path = 'https://example.test/api/admin/agent/threads/t1';
  const put = (message: string, version: string | null) => router.fetch(new Request(path, { method: 'PUT', headers: { Authorization: 'Bearer session', 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Hello', expected_version: version, messages: [{ role: 'user', text: message }, { role: 'assistant', text: 'Answer', tools: [{ name: 'search_products', ok: true }] }] }) }), env);
  const first = await put('first', null); expect(first.status).toBe(200);
  const firstVersion = (await first.json() as any).data.version;
  expect(new TextDecoder().decode([...objects.values()][0].bytes)).not.toContain('first');
  const loaded = await router.fetch(new Request(path, { headers: { Authorization: 'Bearer session' } }), env);
  const result = await loaded.json() as any;
  expect(result.meta.version).toBe(firstVersion);
  expect(result.data.messages[1].tools[0].name).toBe('search_products');
  const next = await put('second', firstVersion); expect(next.status).toBe(200);
  expect((await put('stale', firstVersion)).status).toBe(409);
  expect((await put('create-again', null)).status).toBe(409);
  const latest = await router.fetch(new Request(path, { headers: { Authorization: 'Bearer session' } }), env);
  expect((await latest.json() as any).data.messages[0].text).toBe('second');
  env.AGENT_CHAT_SECRET = 'wrong key';
  const unreadable = await router.fetch(new Request(path, { headers: { Authorization: 'Bearer session' } }), env);
  expect(unreadable.status).toBe(503);
  expect((await unreadable.json() as any).code).toBe('AGENT_STORAGE_UNAVAILABLE');
});

it('reads existing encrypted threads after an Agent secret is added while the previous key remains configured', async () => {
  const objects = new Map<string, Uint8Array>();
  const bucket = {
    put: async (key: string, bytes: Uint8Array) => { objects.set(key, bytes.slice()); return { etag: 'v1' }; },
    get: async (key: string) => { const bytes = objects.get(key); return bytes ? { etag: 'v1', arrayBuffer: async () => bytes.slice().buffer } : null; },
  };
  const router = app(); const env: any = { IMAGES: bucket, JWT_SECRET: 'old-secret' };
  expect((await router.fetch(request(), env)).status).toBe(200);
  env.AGENT_CHAT_SECRET = 'new-secret';
  const response = await router.fetch(new Request('https://example.test/api/admin/agent/threads/thread1', { headers: { Authorization: 'Bearer session' } }), env);
  expect(response.status).toBe(200);
  expect((await response.json() as any).data.messages[0].text).toBe('secret message');
});

it('reports unavailable R2 instead of pretending history is empty', async () => {
  const response = await app().fetch(new Request('https://example.test/api/admin/agent/threads', { headers: { Authorization: 'Bearer session' } }), { CACHE: { get: vi.fn() } } as any);
  expect(response.status).toBe(503);
  expect((await response.json() as any).code).toBe('AGENT_STORAGE_UNAVAILABLE');
});
