import { afterEach, expect, it, vi } from 'vitest';
import { copyD1JournalPageToSupabase } from '../lib/journalSupabaseBackfill';

afterEach(() => vi.unstubAllGlobals());
const rows = [{ id: 1, created_at: '2026-01-01 00:00:00', action: 'old' }, { id: 2, created_at: '2026-01-20 12:00:00', action: 'new' }, { id: 3, created_at: '2026-01-21T12:00:00.000Z', action: 'next' }];
const db: any = { prepare: (sql: string) => ({ bind: (after: number, through: number, limit: number) => ({ all: async () => { expect(sql).toContain('ORDER BY id ASC'); return { results: rows.filter(r => r.id > after && r.id <= through).slice(0, limit) }; } }) }) };
const env: any = { SUPABASE_JOURNAL_URL: 'https://example.supabase.co', SUPABASE_JOURNAL_SECRET_KEY: 'sb_secret_test' };
const input = { namespace: 'database-001', source: 'audit_log' as const, afterId: 0, throughId: 2, cutoff: '2026-01-10T00:00:00.000Z' };
it('imports only retained rows with stable source keys and does not change the source', async () => {
  const requests: any[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => { const body = JSON.parse(init.body); requests.push(body); return Response.json({ accepted: true, count: body.p_items.length }); }));
  const result = await copyD1JournalPageToSupabase(env, db, input);
  expect(result).toEqual({ cursor: 2, scanned: 2, submitted: 1, expired: 1, done: true });
  await copyD1JournalPageToSupabase(env, db, input);
  expect(requests[0]).toEqual(requests[1]);
  expect(requests[0].p_items[0]).toMatchObject({ p_key: 'd1-journal/v1/database-001/audit_log/2', p_kind: 'audit', p_data: { created_at: '2026-01-20T12:00:00.000Z', action: 'new' } });
  expect(rows).toHaveLength(3);
});
it('does not return a checkpoint after an outage or invalid acknowledgement', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ accepted: true, count: 0 })));
  await expect(copyD1JournalPageToSupabase(env, db, input)).rejects.toThrow('acknowledgement');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));
  await expect(copyD1JournalPageToSupabase(env, db, input)).rejects.toThrow();
});
it('validates source and page without sending data', async () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(copyD1JournalPageToSupabase(env, db, { ...input, source: 'audit_log;drop' as any })).rejects.toThrow();
  await expect(copyD1JournalPageToSupabase(env, db, { ...input, limit: 26 })).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
