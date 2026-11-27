import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('runs the Supabase schema and journal RPCs in Postgres, with private permissions and 30-day reads', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    // PGlite does not include pg_cron. Verify the retention scheduler on the real project separately.
    await db.exec(readFileSync('supabase/journal.sql', 'utf8').split('-- Requires pg_cron')[0]);
    const ingest = (id: string, kind: string, data: any) => db.query('select public.atlas_journal_ingest($1,$2,$3::jsonb)', [id, kind, JSON.stringify(data)]);
    const now = new Date().toISOString();
    await ingest('audit-a', 'audit', { created_at: now, action: 'create', entity: 'products', entity_id: '42', username: 'alice' });
    await ingest('audit-a', 'audit', { created_at: now, action: 'create', entity: 'products', entity_id: '42', username: 'alice' });
    await ingest('audit-b', 'audit', { created_at: now, action: 'update', username: 'bob' });
    await ingest('audit-old', 'audit', { created_at: new Date(Date.now() - 31 * 86400_000).toISOString(), action: 'old' });
    await ingest('api-a', 'api', { created_at: now, method: 'POST', path: '/api/products', status: 403, ms: 10, username: 'alice', ip: '203.0.113.1' });
    const batch = [{ p_key: 'batch-a', p_kind: 'audit', p_data: { created_at: now, action: 'batch' } }, { p_key: 'batch-b', p_kind: 'audit', p_data: { created_at: now, action: 'batch' } }];
    const batchResult = await db.query<any>('select public.atlas_journal_ingest_batch($1::jsonb) result', [JSON.stringify(batch)]);
    expect(batchResult.rows[0].result).toEqual({ accepted: true, count: 2 });
    await db.query('select public.atlas_journal_ingest_batch($1::jsonb)', [JSON.stringify(batch)]);
    expect((await db.query<any>("select count(*)::int n from public.atlas_journal where event_key like 'batch-%'")).rows[0].n).toBe(2);
    await expect(db.query('select public.atlas_journal_ingest_batch($1::jsonb)', [JSON.stringify([batch[0], { p_key: 'invalid', p_kind: 'audit', p_data: {} }])])).rejects.toThrow();
    await db.exec("delete from public.atlas_journal where event_key like 'batch-%'");
    const page = async (kind: string, limit: number, cursor = 0, query = '', status = '') => (await db.query<any>('select public.atlas_journal_page($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) result', [kind, '30d', limit, cursor, query, '', status, '', '', true])).rows[0].result;
    const first = await page('audit', 1);
    expect(first.meta).toMatchObject({ has_more: true, stats: { total: 2, unique_actors: 2 } });
    expect(first.data[0].action).toBe('update');
    const next = await page('audit', 1, Number(first.meta.next_cursor));
    expect(next.data[0]).toMatchObject({ action: 'create', entity_id: '42' });
    expect((await page('audit', 20, 0, 'products')).data).toHaveLength(1);
    expect((await page('api', 20, 0, '', 'auth')).meta.stats).toMatchObject({ total: 1, errors: 1, auth_failures: 1, avg_ms: 10 });
    expect((await page('api', 20, 0, '', 'ok')).data).toHaveLength(0);
    const grants = await db.query<any>("select has_table_privilege('anon', 'public.atlas_journal', 'select') as table_read, has_function_privilege('anon', 'public.atlas_journal_page(text,text,integer,bigint,text,text,text,text,text,boolean)', 'execute') as rpc_read, has_function_privilege('service_role', 'public.atlas_journal_page(text,text,integer,bigint,text,text,text,text,text,boolean)', 'execute') as service_read");
    const batchGrants = await db.query<any>("select has_function_privilege('anon', 'public.atlas_journal_ingest_batch(jsonb)', 'execute') anon_exec, has_function_privilege('service_role', 'public.atlas_journal_ingest_batch(jsonb)', 'execute') service_exec");
    expect(batchGrants.rows[0]).toEqual({ anon_exec: false, service_exec: true });
    expect(grants.rows[0]).toEqual({ table_read: false, rpc_read: false, service_read: true });
  } finally { await db.close(); }
}, 30_000);
