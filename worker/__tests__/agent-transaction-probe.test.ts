import { expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

it('runs the synthetic RPC probe twice and leaves no rows or tombstones', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(readFileSync('supabase/agent-preparation.sql', 'utf8'));
    await db.exec(readFileSync('supabase/agent-rpc-draft.sql', 'utf8'));
    const sql = readFileSync('supabase/agent-transaction-probe.sql', 'utf8');
    await db.exec(sql); await db.exec(sql);
    for (const table of ['atlas_agent_conversations', 'atlas_agent_transcripts', 'atlas_agent_cleanup_queue', 'atlas_agent_upload_intents']) {
      expect((await db.query<any>(`select count(*)::int as n from public.${table}`)).rows[0].n).toBe(0);
    }
  } finally { await db.close(); }
});
