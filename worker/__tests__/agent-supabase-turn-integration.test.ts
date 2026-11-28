import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { registerMailboxRoutes } from '../routes/mailbox';
import { registerAssistRoutes } from '../routes/assist';

afterEach(() => vi.unstubAllGlobals());
it('runs versioned first turn, transcript, isolation, conflict and deletion through routes and SQL', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(readFileSync('supabase/agent-preparation.sql', 'utf8'));
    await db.exec(readFileSync('supabase/agent-rpc-draft.sql', 'utf8'));
    const sql: Record<string, string[]> = {
      atlas_agent_get: ['p_account', 'p_thread'], atlas_agent_put: ['p_account', 'p_thread', 'p_payload', 'p_expected_version', 'p_summary'],
      atlas_agent_list: ['p_account', 'p_limit'], atlas_agent_tombstone: ['p_account', 'p_thread'],
      atlas_agent_transcript_get: ['p_account', 'p_thread'], atlas_agent_transcript_put: ['p_account', 'p_thread', 'p_payload', 'p_expected_version'],
    };
    const provider = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (url: any, opts: any) => {
      if (String(url).startsWith('https://project.supabase.co/rest/v1/rpc/')) {
        const name = String(url).split('/').pop()!; const args = sql[name]; if (!args) throw new Error('unexpected RPC');
        const body = JSON.parse(opts.body); const result = await db.query<any>(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as v`, args.map(k => body[k]));
        return Response.json(result.rows[0].v);
      }
      provider(); return Response.json({ model: 'openai/gpt-oss-20b', choices: [{ message: { content: 'Réponse privée' } }], usage: { prompt_tokens: 20, completion_tokens: 10 } });
    }));
    const d1: any = { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({ success: true }) }), first: async () => null, all: async () => ({ results: [] }), run: async () => ({ success: true }) }) };
    const r2 = { get: vi.fn(), list: vi.fn(), put: vi.fn(), delete: vi.fn() };
    const env: any = { ENVIRONMENT: 'agent-storage-test', AGENT_STORAGE_PREVIEW: '1', SUPABASE_JOURNAL_URL: 'https://project.supabase.co', SUPABASE_JOURNAL_SECRET_KEY: 'sb_secret_test', AGENT_HISTORY_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(42))), GROQ_API_KEY: 'test', DB: d1, IMAGES: r2 };
    const app = new Hono<any>();
    const sessionUserFromHeader = (header: string) => ({ username: header === 'Bearer bob' ? 'bob' : 'alice', role: 'admin' });
    registerMailboxRoutes(app, { sessionUserFromHeader } as any);
    registerAssistRoutes(app, { sessionUserFromHeader, clientIp: () => 'test', writeAudit: async () => {} } as any);
    const request = (path: string, method = 'GET', body?: any, user = 'alice') => app.request(path, { method, headers: { Authorization: `Bearer ${user}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, env);
    const thread = '/api/admin/agent/threads/mobile-one';
    const messages = [{ role: 'user', text: 'Question privée' }];
    expect((await request('/api/assist/chat', 'POST', { message: messages[0].text, thread_id: 'mobile-one' })).status).toBe(502);
    expect(provider).not.toHaveBeenCalled();
    const created = await request(thread, 'PUT', { title: 'Question privée', messages, expected_version: null });
    expect((await created.json() as any).data.version).toBe('1');
    expect((await request('/api/assist/chat', 'POST', { message: messages[0].text, thread_id: 'mobile-one' })).status).toBe(200);
    expect(provider).toHaveBeenCalledOnce();
    const reply = [...messages, { role: 'assistant', text: 'Réponse privée' }];
    expect((await request(thread, 'PUT', { title: 'Question privée', messages: reply, expected_version: '1' })).status).toBe(200);
    expect((await request(thread, 'PUT', { title: 'stale', messages: [], expected_version: '1' })).status).toBe(409);
    expect((await (await request(thread)).json() as any).data.messages).toEqual(reply);
    expect((await (await request(thread, 'GET', undefined, 'bob')).json() as any).meta.empty).toBe(true);
    const stored = await db.query<any>('select c.encrypted_payload, c.encrypted_summary, t.encrypted_payload transcript from public.atlas_agent_conversations c join public.atlas_agent_transcripts t using(account_id,thread_id)');
    expect(stored.rows).toHaveLength(1); expect(JSON.stringify(stored.rows)).not.toContain('Question privée'); expect(JSON.stringify(stored.rows)).not.toContain('Réponse privée');
    const deleted = await request(thread, 'DELETE'); expect((await deleted.json() as any).meta.image_cleanup_pending).toBe(true);
    expect((await request(thread, 'PUT', { title: 'revive', messages: [], expected_version: null })).status).toBe(409);
    expect((await db.query<any>('select count(*)::int n from public.atlas_agent_transcripts')).rows[0].n).toBe(0);
    expect(r2.get).not.toHaveBeenCalled(); expect(r2.put).not.toHaveBeenCalled(); expect(r2.delete).not.toHaveBeenCalled();
  } finally { await db.close(); }
});
