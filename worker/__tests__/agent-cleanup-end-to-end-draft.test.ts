import { expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { agentAccountId, agentCleanupQueueDraft } from '../lib/agentSupabaseDraft';
import { runAgentCleanupDraft } from '../../experiments/agent-storage/cleanup';

it('connects the queue RPCs to bounded R2 deletion without completing during an unresolved upload', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(readFileSync('supabase/agent-preparation.sql', 'utf8'));
    await db.exec(readFileSync('supabase/agent-rpc-draft.sql', 'utf8'));
    const account = await agentAccountId('alice'); const image = 'a'.repeat(32);
    await db.query('select public.atlas_agent_put($1,$2,$3,$4,$5)', [account, 'thread', 'cipher', null, 'summary']);
    await db.query('select public.atlas_agent_upload_begin($1,$2,$3)', [account, 'thread', image]);
    await db.query('select public.atlas_agent_tombstone($1,$2)', [account, 'thread']);
    const env: any = { SUPABASE_JOURNAL_URL: 'https://project.supabase.co', SUPABASE_JOURNAL_SECRET_KEY: 'sb_secret_test' };
    const fetcher = vi.fn(async (url: any, init: any) => {
      const name = String(url).split('/').pop(); const b = JSON.parse(init.body);
      if (name === 'atlas_agent_expire') return Response.json((await db.query<any>('select public.atlas_agent_expire($1) as result', [b.p_limit])).rows[0].result);
      if (name === 'atlas_agent_cleanup_claim') return Response.json((await db.query<any>('select public.atlas_agent_cleanup_claim($1,$2) as result', [b.p_token, b.p_limit])).rows[0].result);
      if (name === 'atlas_agent_cleanup_finish') return Response.json((await db.query<any>('select public.atlas_agent_cleanup_finish($1,$2,$3,$4) as result', [b.p_account, b.p_thread, b.p_token, b.p_complete])).rows[0].result);
      throw new Error('unexpected RPC');
    }) as any;
    const objects = new Map([[`agent-images/v1/${account}/thread/${image}`, 'encrypted']]);
    const bucket: any = { list: vi.fn(async ({ prefix }: any) => ({ objects: [...objects.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })), truncated: false })), delete: vi.fn(async (keys: string[]) => keys.forEach(k => objects.delete(k))) };
    const queue = agentCleanupQueueDraft(env, fetcher);
    expect(await runAgentCleanupDraft(queue, bucket)).toEqual({ expired: 0, claimed: 1, failed: 0, pending: 1 });
    expect(objects.size).toBe(0);
    expect((await db.query<any>('select count(*)::int n from public.atlas_agent_cleanup_queue')).rows[0].n).toBe(1);
    // The upload is now known completed and the object's deletion confirmed.
    await db.query('select public.atlas_agent_upload_finish($1,$2,$3,$4)', [account, 'thread', image, true]);
    await db.exec("update public.atlas_agent_cleanup_queue set next_attempt_at = now() - interval '1 second'");
    expect(await runAgentCleanupDraft(queue, bucket)).toEqual({ expired: 0, claimed: 1, failed: 0, pending: 0 });
    expect((await db.query<any>('select count(*)::int n from public.atlas_agent_cleanup_queue')).rows[0].n).toBe(0);
  } finally { await db.close(); }
});
