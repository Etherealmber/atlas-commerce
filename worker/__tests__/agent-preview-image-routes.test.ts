import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { registerMailboxRoutes } from '../routes/mailbox';
import { agentAccountId, agentCleanupQueueDraft, putAgentDraft } from '../lib/agentSupabaseDraft';
import { runAgentCleanupDraft } from '../../experiments/agent-storage/cleanup';

afterEach(() => vi.unstubAllGlobals());
it('encrypts preview images, restricts access to the account, and queues cleanup on deletion', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(readFileSync('supabase/agent-preparation.sql', 'utf8'));
    await db.exec(readFileSync('supabase/agent-rpc-draft.sql', 'utf8'));
    vi.stubGlobal('fetch', vi.fn(async (url: any, options: any) => {
      const op = String(url).split('/').pop() || '', b = JSON.parse(options.body);
      const calls: Record<string, [string, any[]]> = {
        atlas_agent_get: ['select public.atlas_agent_get($1,$2) as v', [b.p_account, b.p_thread]],
        atlas_agent_put: ['select public.atlas_agent_put($1,$2,$3,$4,$5) as v', [b.p_account, b.p_thread, b.p_payload, b.p_expected_version, b.p_summary]],
        atlas_agent_upload_begin: ['select public.atlas_agent_upload_begin($1,$2,$3) as v', [b.p_account, b.p_thread, b.p_image]],
        atlas_agent_upload_finish: ['select public.atlas_agent_upload_finish($1,$2,$3,$4) as v', [b.p_account, b.p_thread, b.p_image, b.p_removed]],
        atlas_agent_tombstone: ['select public.atlas_agent_tombstone($1,$2) as v', [b.p_account, b.p_thread]],
        atlas_agent_expire: ['select public.atlas_agent_expire($1) as v', [b.p_limit]],
        atlas_agent_cleanup_claim: ['select public.atlas_agent_cleanup_claim($1,$2) as v', [b.p_token, b.p_limit]],
        atlas_agent_cleanup_finish: ['select public.atlas_agent_cleanup_finish($1,$2,$3,$4) as v', [b.p_account, b.p_thread, b.p_token, b.p_complete]],
      };
      if (!calls[op]) throw new Error('unexpected RPC');
      return Response.json((await db.query<any>(calls[op][0], calls[op][1])).rows[0].v);
    }));
    const objects = new Map<string, string>();
    const bucket: any = {
      put: vi.fn(async (key: string, value: string) => { objects.set(key, value); return {}; }),
      get: vi.fn(async (key: string) => { const value = objects.get(key); return value === undefined ? null : { size: value.length, text: async () => value }; }),
      list: vi.fn(async ({ prefix }: any) => ({ objects: [...objects.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })), truncated: false })),
      delete: vi.fn(async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); }),
    };
    const env: any = { ENVIRONMENT: 'agent-storage-test', AGENT_STORAGE_PREVIEW: '1', SUPABASE_JOURNAL_URL: 'https://project.supabase.co', SUPABASE_JOURNAL_SECRET_KEY: 'sb_secret_test', AGENT_HISTORY_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(42))), IMAGES: bucket };
    await putAgentDraft(env, 'alice', 'thread', JSON.stringify({ title: 'test', messages: [] }), null, { title: 'test', message_count: 0 });
    const app = new Hono<any>(); registerMailboxRoutes(app, { sessionUserFromHeader: (header: string) => ({ username: header.slice(7), role: 'user' }) } as any);
    const request = (method: string, path: string, user = 'alice', body?: string, runtime = env) => app.request(path, { method, headers: { Authorization: `Bearer ${user}`, 'Content-Type': 'application/json' }, ...(body !== undefined ? { body } : {}) }, runtime);
    const root = '/api/admin/agent/threads/thread'; const dataUrl = 'data:image/png;base64,aGVsbG8=';
    const uploaded = await request('POST', `${root}/images`, 'alice', JSON.stringify({ data_url: dataUrl }));
    expect(uploaded.status).toBe(200); const imageId = (await uploaded.json() as any).data.id;
    expect(imageId).toMatch(/^[a-f0-9]{32}$/); expect(objects.size).toBe(1);
    expect([...objects.values()][0]).not.toContain('aGVsbG8=');
    const read = await request('GET', `${root}/images/${imageId}`); expect((await read.json() as any).data.data_url).toBe(dataUrl);
    expect(read.headers.get('cache-control')).toContain('no-store');
    expect((await request('GET', `${root}/images/${imageId}`, 'bob')).status).toBe(404);
    expect((await request('POST', `${root}/images`, 'alice', JSON.stringify({ data_url: 'data:text/html;base64,YQ==' }))).status).toBe(400);
    expect((await request('POST', `${root}/images`, 'alice', 'x'.repeat(1_340_001))).status).toBe(413);
    expect((await request('GET', `${root}/images/${imageId}`, 'alice', undefined, { ...env, ENVIRONMENT: 'production' })).status).toBe(404);
    const deleted = await request('DELETE', root); expect((await deleted.json() as any).meta.image_cleanup_pending).toBe(true);
    expect((await request('GET', `${root}/images/${imageId}`)).status).toBe(404);
    expect(objects.size).toBe(1); // tombstone is not a claim of physical deletion
    expect(await runAgentCleanupDraft(agentCleanupQueueDraft(env), bucket)).toEqual({ expired: 0, claimed: 1, failed: 0, pending: 0 });
    expect(objects.size).toBe(0);
    expect((await db.query<any>('select count(*)::int as n from public.atlas_agent_cleanup_queue where account_id=$1', [await agentAccountId('alice')])).rows[0].n).toBe(0);
  } finally { await db.close(); }
});
