import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { JournalBuffer } from '../durable/JournalBuffer';
import { enqueueBufferedApi, withBufferedJournal } from '../lib/journalBuffered';
import { writeAudit } from '../lib/authHelpers';
import { registerUsersAdminRoutes } from '../routes/usersAdmin';
import { supabaseJournalConfig } from '../lib/journalSupabase';

afterEach(() => vi.unstubAllGlobals());
function setup() {
  const pending = new Map<string, any>(); let alarm: number | null = null;
  const storage: any = { async get(k: string) { return pending.get(k); }, async put(k: string, v: any) { pending.set(k, v); }, async delete(k: string) { return pending.delete(k); }, async getAlarm() { return alarm; }, async setAlarm(v: number) { alarm = v; }, async list(o: any) { return new Map([...pending].filter(([k]) => k.startsWith(o.prefix) && (!o.startAfter || k > o.startAfter)).sort(([a], [b]) => a.localeCompare(b)).slice(0, o.limit)); }, async transaction(fn: any) { return fn(storage); } };
  const db = { prepare: vi.fn(() => { throw new Error('D1 journal forbidden'); }) };
  const env: any = { DB: db, JOURNAL_ARCHIVE_MODE: 'supabase', JOURNAL_ENCRYPTION_KEY: btoa('k'.repeat(32)), SUPABASE_JOURNAL_URL: 'https://example.supabase.co', SUPABASE_JOURNAL_SECRET: 'sb_secret_test' };
  const buffer = new JournalBuffer({ storage } as any, env);
  env.JOURNAL_BUFFER = { idFromName: () => 'id', get: () => ({ fetch: (url: string, init: RequestInit) => buffer.fetch(new Request(url, init)) }) };
  return { env, buffer, pending, db };
}
it('queues encrypted API and audit events and delivers to Supabase without R2 or D1', async () => {
  const f = setup(); const events = new Map<string, any>();
  const fetch = vi.fn(async (_url: string, init: any) => { const body = JSON.parse(init.body); expect(init.headers.apikey).toBe('sb_secret_test'); expect(init.headers.Authorization).toBeUndefined(); events.set(body.p_key, body); return Response.json({ accepted: true }); });
  vi.stubGlobal('fetch', fetch);
  await enqueueBufferedApi(f.env, { method: 'GET', path: '/api/products?token=private', status: 200, ms: 3, username: 'alice', role: 'owner', ip: null, ua: null, request_id: null, surface: null, country: null, city: null, region: null, asn: null, as_org: null });
  await withBufferedJournal(f.env, () => writeAudit(f.env.DB, { username: 'alice', action: 'product.create', entity: 'products', entity_id: 42 }));
  expect(f.pending.size).toBe(2);
  for (const item of f.pending.values()) expect(new TextDecoder().decode(item.bytes)).not.toContain('alice');
  await f.buffer.alarm();
  expect(f.pending.size).toBe(0); expect(events.size).toBe(2); expect(f.db.prepare).not.toHaveBeenCalled();
  const rows = [...events.values()];
  expect(rows.find(r => r.p_kind === 'api').p_data.path).toBe('/api/products');
  expect(rows.find(r => r.p_kind === 'audit').p_data).toMatchObject({ action: 'product.create', entity_id: '42' });
});
it('retains encrypted items on failed delivery and retries the same id after lost acknowledgement', async () => {
  const f = setup(); const ids: string[] = []; let count = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => { ids.push(JSON.parse(init.body).p_key); if (++count === 1) throw new Error('lost ack'); return Response.json({ accepted: true }); }));
  await withBufferedJournal(f.env, () => writeAudit(f.env.DB, { action: 'test' }));
  await f.buffer.alarm(); expect([...f.pending.keys()].some(k => k.startsWith('pending/'))).toBe(true);
  await f.buffer.alarm(); expect(ids[0]).toEqual(ids[1]); expect([...f.pending.keys()].filter(k => k.startsWith('pending/'))).toHaveLength(0);
});
it('guards credentials and provides authorized Supabase pages without D1 fallback', async () => {
  expect(() => supabaseJournalConfig({ SUPABASE_JOURNAL_URL: 'https://supabase.co.evil.example/', SUPABASE_JOURNAL_SECRET: 'x' })).toThrow();
  const f = setup(); const app = new Hono<any>(); let allowed = false;
  registerUsersAdminRoutes(app, { requireOwner: (c: any) => allowed ? { ok: true, username: 'owner' } : { ok: false, response: c.json({ error: 'Forbidden' }, 403) } } as any);
  const fetch = vi.fn(async () => Response.json({ data: [{ id: 1, action: 'create' }], meta: { has_more: false, next_cursor: null, stats: { total: 1 } } })); vi.stubGlobal('fetch', fetch);
  expect((await app.request('/api/admin/audit?stats=1', {}, f.env)).status).toBe(403); expect(fetch).not.toHaveBeenCalled();
  allowed = true;
  expect(await (await app.request('/api/admin/journal-mode', {}, f.env)).json()).toMatchObject({ data: { mode: 'supabase' } });
  const res = await app.request('/api/admin/audit?stats=1', {}, f.env); expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ data: [{ action: 'create' }], meta: { stats: { total: 1 } } });
  expect((await app.request('/api/admin/api-log?cursor=bad', {}, f.env)).status).toBe(400);
  expect((await app.request('/api/admin/audit/export', {}, f.env)).status).toBe(409);
  expect((await app.request('/api/admin/audit/explain', { method: 'POST' }, f.env)).status).toBe(409);
  expect(f.db.prepare).not.toHaveBeenCalled();
});
