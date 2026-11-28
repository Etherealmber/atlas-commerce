import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { putAgentDraft } from '../lib/agentSupabaseDraft';
import { registerAssistRoutes } from '../routes/assist';

afterEach(() => vi.unstubAllGlobals());
it('uses Supabase transcripts for buffered and streaming turns in isolated preview, without R2', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(readFileSync('supabase/agent-preparation.sql', 'utf8'));
    await db.exec(readFileSync('supabase/agent-rpc-draft.sql', 'utf8'));
    let rejectWrite = false; const prompts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: any, options: any) => {
      if (String(url).startsWith('https://project.supabase.co/rest/v1/rpc/')) {
        const action = String(url).split('/').pop(); const b = JSON.parse(options.body);
        if (action === 'atlas_agent_get') return Response.json((await db.query<any>('select public.atlas_agent_get($1,$2) as v', [b.p_account, b.p_thread])).rows[0].v);
        if (action === 'atlas_agent_put') return Response.json((await db.query<any>('select public.atlas_agent_put($1,$2,$3,$4,$5) as v', [b.p_account, b.p_thread, b.p_payload, b.p_expected_version, b.p_summary])).rows[0].v);
        if (action === 'atlas_agent_transcript_get') return Response.json((await db.query<any>('select public.atlas_agent_transcript_get($1,$2) as v', [b.p_account, b.p_thread])).rows[0].v);
        if (action === 'atlas_agent_transcript_put') {
          if (rejectWrite) return Response.json({ ok: false, conflict: true });
          return Response.json((await db.query<any>('select public.atlas_agent_transcript_put($1,$2,$3,$4) as v', [b.p_account, b.p_thread, b.p_payload, b.p_expected_version])).rows[0].v);
        }
        throw new Error(`unexpected RPC ${action}`);
      }
      const body = JSON.parse(options.body); prompts.push(JSON.stringify(body.messages));
      if (body.stream) return new Response('data: {"choices":[{"delta":{"content":"Stream reply"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
      return Response.json({ model: 'openai/gpt-oss-20b', choices: [{ message: { content: 'Buffered reply' } }], usage: { prompt_tokens: 20, completion_tokens: 10 } });
    }));
    const d1: any = { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({ success: true }) }), first: async () => null, all: async () => ({ results: [] }), run: async () => ({ success: true }) }) };
    const r2 = { get: vi.fn(), list: vi.fn(), put: vi.fn() };
    const env: any = { ENVIRONMENT: 'agent-storage-test', AGENT_STORAGE_PREVIEW: '1', SUPABASE_JOURNAL_URL: 'https://project.supabase.co', SUPABASE_JOURNAL_SECRET_KEY: 'sb_secret_test', AGENT_HISTORY_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(42))), GROQ_API_KEY: 'test', DB: d1, IMAGES: r2 };
    const app = new Hono<any>();
    registerAssistRoutes(app, { sessionUserFromHeader: () => ({ username: 'alice', role: 'admin' }), clientIp: () => 'test', writeAudit: async () => {} } as any);
    const request = (path: string, body: object) => app.request(path, { method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
    const first = await request('/api/assist/chat', { message: 'Bonjour', thread_id: 't1' });
    expect(first.status).toBe(502); expect(prompts).toHaveLength(0); // no snapshot, no provider call
    await putAgentDraft(env, 'alice', 't1', JSON.stringify({ title: 'First', messages: [] }), null, { title: 'First', message_count: 0 });
    expect((await request('/api/assist/chat', { message: 'Bonjour', thread_id: 't1' })).status).toBe(200);
    const stream = await request('/api/assist/chat/stream', { message: 'Deuxième', thread_id: 't1' });
    expect(await stream.text()).toContain('event: done');
    expect(prompts[1]).toContain('Buffered reply');
    rejectWrite = true;
    const conflict = await request('/api/assist/chat/stream', { message: 'Conflit', thread_id: 't1' });
    const output = await conflict.text(); expect(output).toContain('event: error'); expect(output).not.toContain('event: done');
    expect((await request('/api/assist/chat', { message: 'image', thread_id: 't1', images: ['data:image/png;base64,AAA='] })).status).toBe(422);
    const legacy = await app.request('/api/assist/transcripts', { headers: { Authorization: 'Bearer token' } }, env);
    expect(legacy.status).toBe(503);
    const wipe = await request('/api/settings/agent-data/delete', { otp: '000000' }); expect(wipe.status).toBe(503);
    expect(r2.get).not.toHaveBeenCalled(); expect(r2.put).not.toHaveBeenCalled(); expect(r2.list).not.toHaveBeenCalled();
  } finally { await db.close(); }
});
