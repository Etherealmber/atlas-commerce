import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { probeAgentStorage } from '../lib/agentStorageProbe';
import { registerAssistRoutes } from '../routes/assist';
const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(42)));
const env: any = { AGENT_HISTORY_ENCRYPTION_KEY: key, SUPABASE_JOURNAL_URL: 'https://project.supabase.co', SUPABASE_JOURNAL_SECRET_KEY: 'sb_secret_test' };
afterEach(() => vi.unstubAllGlobals());

it('self-tests the key and performs only an isolated read-only RPC', async () => {
  const fetcher = vi.fn(async (url: any, init: any) => {
    expect(String(url)).toBe('https://project.supabase.co/rest/v1/rpc/atlas_agent_get');
    expect(JSON.parse(init.body)).toMatchObject({ p_thread: 'probe' });
    return Response.json(null);
  }) as any;
  expect(await probeAgentStorage(env, fetcher)).toEqual({ key_self_test: 'pass', read_rpc: 'pass' });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(await probeAgentStorage({ ...env, AGENT_HISTORY_ENCRYPTION_KEY: 'invalid' }, fetcher)).toEqual({ key_self_test: 'fail', read_rpc: 'not_checked' });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(await probeAgentStorage(env, (async () => new Response('secret upstream error', { status: 500 })) as any)).toEqual({ key_self_test: 'pass', read_rpc: 'fail' });
});

it('requires a valid session and owner gate, and excludes demo without exposing secrets', async () => {
  const fetcher = vi.fn(async () => Response.json(null)); vi.stubGlobal('fetch', fetcher);
  let auth = 'ok'; let allowed = true;
  const app = new Hono<any>(); registerAssistRoutes(app, { authFailReason: async () => auth, clientIp: () => 'test', requireOwner: (c: any) => allowed ? { ok: true, username: 'alice' } : { ok: false, response: c.json({ success: false }, 403) } } as any);
  const request = (bindings: any = env) => app.request('/api/admin/agent-storage-probe', { method: 'POST' }, bindings);
  auth = 'invalid'; expect((await request()).status).toBe(401); expect(fetcher).not.toHaveBeenCalled();
  auth = 'ok'; allowed = false; expect((await request()).status).toBe(403); expect(fetcher).not.toHaveBeenCalled();
  allowed = true; expect((await request({ ...env, ATLAS_DEMO: '1' })).status).toBe(403); expect(fetcher).not.toHaveBeenCalled();
  const res = await request(); const body = await res.json() as any;
  expect(res.status).toBe(200); expect(res.headers.get('cache-control')).toContain('no-store');
  expect(body.data).toEqual({ key_self_test: 'pass', read_rpc: 'pass', storage_mode_changed: false, write_test_performed: false });
  expect(JSON.stringify(body)).not.toContain(key); expect(JSON.stringify(body)).not.toContain('sb_secret_test');
});
