import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

describe('Agent cleanup queue SQL (not deployed)', () => {
  it('atomically queues deletion and expiry, leases jobs, rejects stale acknowledgements and retries', async () => {
    const db = new PGlite();
    try {
      await db.exec('create role anon; create role authenticated; create role service_role;');
      await db.exec(readFileSync('supabase/agent-preparation.sql', 'utf8'));
      const draft = readFileSync('supabase/agent-rpc-draft.sql', 'utf8');
      await db.exec(draft); await db.exec(draft);
      await db.query('select public.atlas_agent_put($1,$2,$3,$4,$5)', ['alice', 'a', 'encrypted', null, 'summary']);
      await db.query('select public.atlas_agent_put($1,$2,$3,$4,$5)', ['bob', 'b', 'encrypted', null, 'summary']);
      const image = 'e'.repeat(32);
      const begin = async () => (await db.query<any>('select public.atlas_agent_upload_begin($1,$2,$3) as result', ['alice', 'a', image])).rows[0].result;
      const uploadFinish = async (removed: boolean) => (await db.query<any>('select public.atlas_agent_upload_finish($1,$2,$3,$4) as result', ['alice', 'a', image, removed])).rows[0].result;
      expect(await begin()).toBe(true);
      await db.query('select public.atlas_agent_tombstone($1,$2)', ['alice', 'a']);
      await db.query('select public.atlas_agent_tombstone($1,$2)', ['alice', 'a']);
      await db.exec("update public.atlas_agent_conversations set last_activity_at = now() - interval '31 days' where account_id = 'bob'");
      expect((await db.query<any>('select public.atlas_agent_expire(10) as result')).rows[0].result).toBe(1);
      const records = (await db.query<any>('select account_id, encrypted_payload, encrypted_summary, deleted_at from public.atlas_agent_conversations order by account_id')).rows;
      expect(records.every(r => r.encrypted_payload === '' && r.encrypted_summary === null && r.deleted_at)).toBe(true);
      const token1 = 'a'.repeat(32), token2 = 'b'.repeat(32);
      const claim = async (token: string, limit: number) => (await db.query<any>('select public.atlas_agent_cleanup_claim($1,$2) as result', [token, limit])).rows[0].result;
      const finish = async (account: string, thread: string, token: string, complete: boolean) => (await db.query<any>('select public.atlas_agent_cleanup_finish($1,$2,$3,$4) as result', [account, thread, token, complete])).rows[0].result;
      const first = await claim(token1, 1); const second = await claim(token2, 10);
      expect(first).toHaveLength(1); expect(second).toHaveLength(1);
      expect(await claim('c'.repeat(32), 10)).toEqual([]);
      const aliceJob = [...first, ...second].find((j: any) => j.account_id === 'alice');
      const aliceToken = first[0].account_id === 'alice' ? token1 : token2;
      expect(await begin()).toBe(false);
      expect(await uploadFinish(false)).toBe(false);
      expect(await finish(aliceJob.account_id, aliceJob.thread_id, aliceToken, true)).toBe(false);
      expect(await uploadFinish(true)).toBe(true);
      const job = first[0];
      expect(await finish(job.account_id, job.thread_id, token2, true)).toBe(false);
      expect(await finish(job.account_id, job.thread_id, token1, false)).toBe(true);
      expect(await claim(token1, 10)).toEqual([]);
      await db.exec("update public.atlas_agent_cleanup_queue set next_attempt_at = now() - interval '1 second', lease_until = now() - interval '1 second'");
      const retries = await claim('d'.repeat(32), 10); expect(retries).toHaveLength(2);
      expect(retries.every((j: any) => j.attempts === 2)).toBe(true);
      expect(await finish(second[0].account_id, second[0].thread_id, token2, true)).toBe(false);
      for (const item of retries) expect(await finish(item.account_id, item.thread_id, 'd'.repeat(32), true)).toBe(true);
      expect((await db.query<any>('select count(*)::int as n from public.atlas_agent_cleanup_queue')).rows[0].n).toBe(0);
      expect((await db.query<any>("select has_table_privilege('service_role','public.atlas_agent_cleanup_queue','select') as direct, has_function_privilege('anon','public.atlas_agent_cleanup_claim(text,integer)','execute') as anon, has_function_privilege('service_role','public.atlas_agent_cleanup_claim(text,integer)','execute') as service")).rows[0]).toEqual({ direct: false, anon: false, service: true });
    } finally { await db.close(); }
  });
});
