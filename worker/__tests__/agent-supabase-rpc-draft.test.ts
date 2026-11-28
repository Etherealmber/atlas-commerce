import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

describe('Agent Supabase RPC draft (local only)', () => {
  it('isolates accounts, rejects stale writes and keeps deleted and expired IDs closed', async () => {
    const db = new PGlite();
    try {
      await db.exec('create role anon; create role authenticated; create role service_role;');
      await db.exec(readFileSync('supabase/agent-preparation.sql', 'utf8'));
      const script = readFileSync('supabase/agent-rpc-draft.sql', 'utf8');
      await db.exec(script); await db.exec(script);
      const put = async (account: string, version: string | null) => (await db.query<any>('select public.atlas_agent_put($1, $2, $3, $4) as result', [account, 'thread', 'ciphertext', version])).rows[0].result;
      const get = async (account: string) => (await db.query<any>('select public.atlas_agent_get($1,$2) as result', [account, 'thread'])).rows[0].result;
      expect(await put('alice', null)).toEqual({ ok: true, version: '1' });
      expect(await get('bob')).toBeNull();
      expect(await put('alice', '1')).toEqual({ ok: true, version: '2' });
      expect(await put('alice', '1')).toEqual({ ok: false, conflict: true });
      await db.query('select public.atlas_agent_tombstone($1,$2)', ['alice', 'thread']);
      expect(await get('alice')).toBeNull();
      expect(await put('alice', null)).toEqual({ ok: false, conflict: true });
      expect(await put('alice', '2')).toEqual({ ok: false, conflict: true });
      await put('bob', null);
      await db.exec("update public.atlas_agent_conversations set last_activity_at = now() - interval '31 days' where account_id = 'bob'");
      expect(await get('bob')).toBeNull();
      expect(await put('bob', '1')).toEqual({ ok: false, conflict: true });
      const privileges = await db.query<any>("select has_function_privilege('anon','public.atlas_agent_get(text,text)','execute') as anon, has_function_privilege('service_role','public.atlas_agent_get(text,text)','execute') as service");
      expect(privileges.rows[0]).toEqual({ anon: false, service: true });
    } finally { await db.close(); }
  });
});
