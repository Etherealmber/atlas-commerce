import { expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { agentAccountId, getAgentDraft, getAgentTranscriptDraft, listAgentDraft, putAgentDraft, putAgentTranscriptDraft } from '../lib/agentSupabaseDraft';

it('encrypts snapshots, summaries and transcripts across the adapter and SQL, with service-only RPC access', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(readFileSync('supabase/agent-preparation.sql', 'utf8'));
    const draft = readFileSync('supabase/agent-rpc-draft.sql', 'utf8');
    await db.exec(draft); await db.exec(draft);
    const checks = await db.query<any>(`select c.relname, c.relrowsecurity,
      has_table_privilege('anon', c.oid, 'select') as anon_read,
      has_table_privilege('authenticated', c.oid, 'select') as auth_read,
      has_table_privilege('service_role', c.oid, 'select') as service_read
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname in ('atlas_agent_conversations','atlas_agent_transcripts','atlas_agent_cleanup_queue','atlas_agent_upload_intents')`);
    expect(checks.rows).toHaveLength(4);
    for (const row of checks.rows) expect(row).toMatchObject({ relrowsecurity: true, anon_read: false, auth_read: false, service_read: false });
    const privileges = await db.query<any>(`select p.proname, p.prosecdef, p.proconfig,
      has_function_privilege('anon',p.oid,'execute') as anon_call,
      has_function_privilege('authenticated',p.oid,'execute') as auth_call,
      has_function_privilege('service_role',p.oid,'execute') as service_call
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname like 'atlas_agent_%'`);
    expect(privileges.rows).toHaveLength(11);
    for (const row of privileges.rows) expect(row).toMatchObject({ prosecdef: true, proconfig: ['search_path=pg_catalog'], anon_call: false, auth_call: false, service_call: true });
    await db.exec('set role anon');
    await expect(db.query("select public.atlas_agent_get('alice','thread')")).rejects.toThrow();
    await expect(db.query('select * from public.atlas_agent_conversations')).rejects.toThrow();
    await db.exec('reset role');

    const env: any = { SUPABASE_JOURNAL_URL: 'https://project.supabase.co', SUPABASE_JOURNAL_SECRET_KEY: 'sb_secret_test', AGENT_HISTORY_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(42))) };
    const routes: Record<string, string[]> = {
      atlas_agent_put: ['p_account', 'p_thread', 'p_payload', 'p_expected_version', 'p_summary'],
      atlas_agent_get: ['p_account', 'p_thread'],
      atlas_agent_list: ['p_account', 'p_limit'],
      atlas_agent_transcript_put: ['p_account', 'p_thread', 'p_payload', 'p_expected_version'],
      atlas_agent_transcript_get: ['p_account', 'p_thread'],
    };
    const fetcher = (async (url: any, init: any) => {
      const name = String(url).split('/').pop()!; const args = routes[name];
      if (!args) throw new Error('unexpected RPC');
      const body = JSON.parse(init.body);
      const result = await db.query<any>(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as result`, args.map(k => body[k]));
      return Response.json(result.rows[0].result);
    }) as typeof fetch;
    const snapshot = JSON.stringify({ messages: [{ role: 'user', text: 'Private snapshot 1749' }] });
    const transcript = 'Private model transcript 1749';
    expect(await putAgentDraft(env, 'alice', 't1', snapshot, null, { title: 'Private title 1749', message_count: 1 }, fetcher)).toBe('1');
    expect(await putAgentTranscriptDraft(env, 'alice', 't1', transcript, null, fetcher)).toBe('1');
    const stored = await db.query<any>('select c.encrypted_payload, c.encrypted_summary, t.encrypted_payload transcript from public.atlas_agent_conversations c join public.atlas_agent_transcripts t using(account_id,thread_id)');
    for (const text of ['Private snapshot 1749', 'Private title 1749', transcript]) expect(JSON.stringify(stored.rows)).not.toContain(text);
    expect(await getAgentDraft(env, 'alice', 't1', fetcher)).toEqual({ payload: snapshot, version: '1' });
    expect(await getAgentTranscriptDraft(env, 'alice', 't1', fetcher)).toEqual({ payload: transcript, version: '1' });
    expect(await getAgentDraft(env, 'bob', 't1', fetcher)).toBeNull();
    expect((await listAgentDraft(env, 'alice', fetcher))[0].title).toBe('Private title 1749');
    const account = await agentAccountId('alice');
    await db.query('select public.atlas_agent_tombstone($1,$2)', [account, 't1']);
    expect(await getAgentDraft(env, 'alice', 't1', fetcher)).toBeNull();
    expect(await getAgentTranscriptDraft(env, 'alice', 't1', fetcher)).toBeNull();
    const raw = await db.query<any>('select encrypted_payload, encrypted_summary from public.atlas_agent_conversations where account_id=$1', [account]);
    expect(raw.rows[0]).toEqual({ encrypted_payload: '', encrypted_summary: null });
    expect((await db.query<any>('select count(*)::int as n from public.atlas_agent_transcripts')).rows[0].n).toBe(0);
  } finally { await db.close(); }
});
