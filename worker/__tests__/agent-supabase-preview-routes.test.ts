import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { registerMailboxRoutes } from '../routes/mailbox';

afterEach(() => vi.unstubAllGlobals());
it.each([{ ENVIRONMENT: 'agent-storage-test', AGENT_STORAGE_PREVIEW: '1', label: 'supabase-preview' }, { ENVIRONMENT: 'production', AGENT_HISTORY_STORAGE: 'supabase', label: 'supabase' }])('uses $label for versioned list, save, load and deletion without R2', async (mode) => {
  const rows = new Map<string, any>(); const writes = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
    const body = JSON.parse(String(options.body)); const key = `${body.p_account}:${body.p_thread}`;
    if (url.endsWith('/atlas_agent_list')) return Response.json([...rows.values()].filter(row => row.account === body.p_account && !row.deleted).map(row => ({ id: row.thread, updated_at: '2026-10-20T00:00:00Z', encrypted_summary: row.summary })));
    if (url.endsWith('/atlas_agent_get')) { const row = rows.get(key); return Response.json(row && !row.deleted ? { payload: row.payload, version: String(row.version) } : null); }
    if (url.endsWith('/atlas_agent_tombstone')) { const row = rows.get(key); if (row) row.deleted = true; else rows.set(key, { deleted: true }); return Response.json({ ok: true }); }
    if (url.endsWith('/atlas_agent_put')) {
      writes(body); const row = rows.get(key);
      if ((body.p_expected_version === null && row) || (body.p_expected_version !== null && (!row || row.deleted || String(row.version) !== body.p_expected_version))) return Response.json({ ok: false, conflict: true });
      const version = (row?.version || 0) + 1; rows.set(key, { account: body.p_account, thread: body.p_thread, payload: body.p_payload, summary: body.p_summary, version }); return Response.json({ ok: true, version: String(version) });
    }
    return new Response('', { status: 404 });
  }));
  const app = new Hono<any>();
  registerMailboxRoutes(app, { sessionUserFromHeader: () => ({ username: 'alice', role: 'owner' }) } as any);
  const env: any = { ...mode, SUPABASE_JOURNAL_URL: 'https://project.supabase.co', SUPABASE_JOURNAL_SECRET_KEY: 'sb_secret_test', AGENT_HISTORY_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(42))) };
  const path = 'https://example.test/api/admin/agent/threads/t1';
  const request = (method: string, body?: any, url = path) => app.fetch(new Request(url, { method, headers: { Authorization: 'Bearer session', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
  const payload = { title: 'Private title', messages: [{ role: 'user', text: 'private message' }], expected_version: null };
  const put = await request('PUT', payload); expect(put.status).toBe(200); expect((await put.json() as any).data).toMatchObject({ storage: mode.label, version: '1' });
  expect(JSON.stringify(writes.mock.calls)).not.toContain('private message');
  const list = await request('GET', undefined, 'https://example.test/api/admin/agent/threads'); expect((await list.json() as any).data).toMatchObject([{ id: 't1', title: 'Private title' }]);
  const get = await request('GET'); expect((await get.json() as any).data.messages[0].text).toBe('private message');
  expect((await request('PUT', payload)).status).toBe(409);
  expect((await request('PUT', { ...payload, messages: [{ images: ['data:image/png;base64,AAAA'] }] })).status).toBe(422);
  expect((await request('PUT', { title: 'legacy android', messages: [] })).status).toBe(409);
  expect((await request('DELETE')).status).toBe(200);
  expect((await request('PUT', payload)).status).toBe(409);
  expect((await (await request('GET')).json() as any).meta.empty).toBe(true);
});

it('never enables the preview for production or demo contexts', async () => {
  const { useAgentStoragePreview } = await import('../lib/agentSupabaseDraft');
  expect(useAgentStoragePreview({ ENVIRONMENT: 'production', AGENT_STORAGE_PREVIEW: '1' })).toBe(false);
  expect(useAgentStoragePreview({ ENVIRONMENT: 'agent-storage-test', AGENT_STORAGE_PREVIEW: '1', ATLAS_DEMO: '1' })).toBe(false);
  expect(useAgentStoragePreview({ ENVIRONMENT: 'agent-storage-test' })).toBe(false);
});

it('selects Supabase only with explicit production configuration and never falls back to R2 on failure', async () => {
  const { useAgentSupabaseStorage } = await import('../lib/agentSupabaseDraft');
  const { purgeAgentConversationsOlderThan } = await import('../routes/assist');
  const { runScheduledAgentCleanup } = await import('../lib/agentCleanupScheduled');
  expect(useAgentSupabaseStorage({ ENVIRONMENT: 'production' })).toBe(false);
  expect(useAgentSupabaseStorage({ ENVIRONMENT: 'production', AGENT_HISTORY_STORAGE: 'supabase' })).toBe(true);
  expect(useAgentSupabaseStorage({ ENVIRONMENT: 'production', AGENT_HISTORY_STORAGE: 'supabase', ATLAS_DEMO: '1' })).toBe(false);
  expect(await runScheduledAgentCleanup({ ENVIRONMENT: 'production' } as any)).toEqual({ skipped: true });
  const bucket = { list: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn() };
  const env: any = { ENVIRONMENT: 'production', AGENT_HISTORY_STORAGE: 'supabase', IMAGES: bucket };
  const app = new Hono<any>(); registerMailboxRoutes(app, { sessionUserFromHeader: () => ({ username: 'alice', role: 'owner' }) } as any);
  const response = await app.request('/api/admin/agent/threads/t1', { method: 'PUT', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [], expected_version: null }) }, env);
  expect(response.status).toBe(503);
  expect(await purgeAgentConversationsOlderThan(env)).toEqual({ deleted: 0 });
  expect(bucket.put).not.toHaveBeenCalled(); expect(bucket.get).not.toHaveBeenCalled(); expect(bucket.list).not.toHaveBeenCalled(); expect(bucket.delete).not.toHaveBeenCalled();
});
