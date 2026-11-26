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
    expect((await res.json() as any).data.storage).toBe('local_only');
    expect(put).not.toHaveBeenCalled();
  });
  it('does not fall back to writing plaintext conversations to KV', async () => {
    const put = vi.fn();
    const res = await app().fetch(request(), { CACHE: { put } } as any);
    expect((await res.json() as any).data.storage).toBe('local_only');
    expect(put).not.toHaveBeenCalled();
  });
  it('encrypts a new thread when a server secret exists', async () => {
    const put = vi.fn(async (_key: string, _data: Uint8Array) => {});
    const res = await app().fetch(request(), { IMAGES: { put }, AGENT_CHAT_SECRET: 'test-secret-only' } as any);
    expect((await res.json() as any).data.storage).toBe('r2');
    expect(put).toHaveBeenCalledOnce();
    expect(new TextDecoder().decode(put.mock.calls[0][1] as Uint8Array)).not.toContain('secret message');
  });
});
