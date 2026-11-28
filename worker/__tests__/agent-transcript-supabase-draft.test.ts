import { expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { getAgentTranscriptDraft, putAgentTranscriptDraft, AgentStorageConflict } from '../lib/agentSupabaseDraft';

it('stores independent encrypted context with CAS and deletes it with its parent', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(readFileSync('supabase/agent-preparation.sql', 'utf8'));
    await db.exec(readFileSync('supabase/agent-rpc-draft.sql', 'utf8'));
    const env: any = { SUPABASE_JOURNAL_URL: 'https://project.supabase.co', SUPABASE_JOURNAL_SECRET_KEY: 'sb_secret_test', AGENT_HISTORY_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(42))) };
    const fetcher = vi.fn(async (url: any, options: any) => {
      const args = JSON.parse(options.body);
      if (String(url).endsWith('atlas_agent_transcript_get')) return Response.json((await db.query<any>('select public.atlas_agent_transcript_get($1,$2) as result', [args.p_account, args.p_thread])).rows[0].result);
      if (String(url).endsWith('atlas_agent_transcript_put')) return Response.json((await db.query<any>('select public.atlas_agent_transcript_put($1,$2,$3,$4) as result', [args.p_account, args.p_thread, args.p_payload, args.p_expected_version])).rows[0].result);
      throw new Error('Unexpected RPC');
    }) as any;
    const { agentAccountId } = await import('../lib/agentSupabaseDraft');
    const account = await agentAccountId('alice');
    await expect(putAgentTranscriptDraft(env, 'alice', 't', 'private context', null, fetcher)).rejects.toBeInstanceOf(AgentStorageConflict);
    await db.query('select public.atlas_agent_put($1,$2,$3,$4,$5)', [account, 't', 'snapshot', null, 'summary']);
    expect(await putAgentTranscriptDraft(env, 'alice', 't', 'private context', null, fetcher)).toBe('1');
    expect(await getAgentTranscriptDraft(env, 'alice', 't', fetcher)).toEqual({ payload: 'private context', version: '1' });
    expect(await getAgentTranscriptDraft(env, 'bob', 't', fetcher)).toBeNull();
    expect(JSON.stringify((await db.query('select * from public.atlas_agent_transcripts')).rows)).not.toContain('private context');
    await db.query("update public.atlas_agent_conversations set last_activity_at = now() - interval '29 days' where account_id=$1 and thread_id='t'", [account]);
    expect(await putAgentTranscriptDraft(env, 'alice', 't', 'next', '1', fetcher)).toBe('2');
    expect((await db.query<any>("select last_activity_at > now() - interval '1 minute' as recent from public.atlas_agent_conversations where account_id=$1 and thread_id='t'", [account])).rows[0].recent).toBe(true);
    await expect(putAgentTranscriptDraft(env, 'alice', 't', 'stale', '1', fetcher)).rejects.toBeInstanceOf(AgentStorageConflict);
    await db.query('select public.atlas_agent_tombstone($1,$2)', [account, 't']);
    expect((await db.query<any>('select count(*)::int as n from public.atlas_agent_transcripts')).rows[0].n).toBe(0);
    await expect(putAgentTranscriptDraft(env, 'alice', 't', 'resurrect', null, fetcher)).rejects.toBeInstanceOf(AgentStorageConflict);
    await db.query('select public.atlas_agent_put($1,$2,$3,$4,$5)', [account, 'expired', 'snapshot', null, 'summary']);
    await putAgentTranscriptDraft(env, 'alice', 'expired', 'old context', null, fetcher);
    await db.query("update public.atlas_agent_conversations set last_activity_at = now() - interval '31 days' where account_id=$1 and thread_id='expired'", [account]);
    expect(await getAgentTranscriptDraft(env, 'alice', 'expired', fetcher)).toBeNull();
    await db.query('select public.atlas_agent_expire(20)');
    expect((await db.query<any>('select count(*)::int as n from public.atlas_agent_transcripts')).rows[0].n).toBe(0);
  } finally { await db.close(); }
});
