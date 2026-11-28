import { expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

it('reports missing and installed objects without changing the schema or revealing data', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    const sql = readFileSync('supabase/agent-readiness-check.sql', 'utf8');
    const empty = await db.query<any>(sql);
    expect(empty.rows).toHaveLength(15); expect(empty.rows.every(r => !r.present)).toBe(true);
    await db.exec(readFileSync('supabase/agent-preparation.sql', 'utf8'));
    await db.exec(readFileSync('supabase/agent-rpc-draft.sql', 'utf8'));
    const ready = await db.query<any>(sql);
    for (const row of ready.rows) {
      expect(row).toMatchObject({ present: true, anon_allowed: false, authenticated_allowed: false });
      if (row.kind === 'table') expect(row).toMatchObject({ rls_enabled: true, service_role_allowed: false });
      else expect(row).toMatchObject({ security_definer: true, restricted_search_path: true, service_role_allowed: true });
    }
    await db.exec('grant insert on public.atlas_agent_conversations to anon');
    const unsafe = await db.query<any>(sql);
    expect(unsafe.rows.find(r => r.kind === 'table' && r.name === 'conversations').anon_allowed).toBe(true);
  } finally { await db.close(); }
});
