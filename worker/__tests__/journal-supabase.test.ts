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
  const fetch = vi.fn(async (_url: string, init: any) => { const body = JSON.parse(init.body); expect(init.headers.apikey).toBe('sb_secret_test'); expect(init.headers.Authorization).toBeUndefined(); for (const event of body.p_items) events.set(event.p_key, event); return Response.json({ accepted: true, count: body.p_items.length }); });
  vi.stubGlobal('fetch', fetch);
  await enqueueBufferedApi(f.env, { method: 'GET', path: '/api/products?token=private', status: 200, ms: 3, username: 'alice', role: 'owner', ip: null, ua: null, request_id: null, surface: null, country: null, city: null, region: null, asn: null, as_org: null, device_context: { language: 'fr-FR', timezone: 'Africa/Casablanca' } });
  await withBufferedJournal(f.env, () => writeAudit(f.env.DB, { username: 'alice', action: 'product.create', entity: 'products', entity_id: 42 }));
  expect(f.pending.size).toBe(2);
  for (const item of f.pending.values()) expect(new TextDecoder().decode(item.bytes)).not.toContain('alice');
  await f.buffer.alarm();
  expect(f.pending.size).toBe(0); expect(fetch).toHaveBeenCalledTimes(1); expect(events.size).toBe(2); expect(f.db.prepare).not.toHaveBeenCalled();
  const rows = [...events.values()];
  expect(rows.find(r => r.p_kind === 'api').p_data.path).toBe('/api/products');
  expect(rows.find(r => r.p_kind === 'api').p_data.device_context).toEqual({ language: 'fr-FR', timezone: 'Africa/Casablanca' });
  expect(rows.find(r => r.p_kind === 'audit').p_data).toMatchObject({ action: 'product.create', entity_id: '42' });
});
it('retains encrypted items on failed delivery and retries the same id after lost acknowledgement', async () => {
  const f = setup(); const ids: string[] = []; let count = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => { const items = JSON.parse(init.body).p_items; ids.push(items[0].p_key); if (++count === 1) throw new Error('lost ack'); return Response.json({ accepted: true, count: items.length }); }));
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
  expect((await app.request('/api/admin/audit/explain', { method: 'POST' }, f.env)).status).toBe(400);
  expect(f.db.prepare).not.toHaveBeenCalled();
});

it('isolates rejected rows but does not fan out during a service outage', async () => {
  const f = setup(); let outage = true; const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
    calls.push(url);
    if (outage) return new Response(null, { status: 503 });
    if (url.endsWith('_batch')) return new Response(null, { status: 400 });
    const row = JSON.parse(init.body);
    return row.p_data.action === 'bad' ? new Response(null, { status: 400 }) : Response.json({ accepted: true });
  }));
  await withBufferedJournal(f.env, () => writeAudit(f.env.DB, { action: 'bad' }));
  await withBufferedJournal(f.env, () => writeAudit(f.env.DB, { action: 'good' }));
  await f.buffer.alarm();
  expect(calls).toHaveLength(1);
  expect([...f.pending.keys()].filter(k => k.startsWith('pending/'))).toHaveLength(2);
  outage = false; await f.buffer.alarm();
  expect(calls).toHaveLength(4);
  expect([...f.pending.keys()].filter(k => k.startsWith('pending/'))).toHaveLength(1);
});
it('falls back to the existing single-event RPC when the batch RPC is not installed', async () => {
  const f = setup(); const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    return url.endsWith('_batch') ? new Response(null, { status: 404 }) : Response.json({ accepted: true });
  }));
  await withBufferedJournal(f.env, () => writeAudit(f.env.DB, { action: 'one' }));
  await withBufferedJournal(f.env, () => writeAudit(f.env.DB, { action: 'two' }));
  await f.buffer.alarm();
  expect(calls).toHaveLength(3);
  expect([...f.pending.keys()].filter(k => k.startsWith('pending/'))).toHaveLength(0);
});
it('redirects legacy R2 outbox entries to Supabase after cutover without R2 writes', async () => {
  const f = setup();
  const put = vi.fn(); f.env.JOURNAL_ARCHIVE = { put };
  const fetch = vi.fn(async (_url: string, init: any) => Response.json({ accepted: true, count: JSON.parse(init.body).p_items.length }));
  vi.stubGlobal('fetch', fetch);
  await withBufferedJournal(f.env, () => writeAudit(f.env.DB, { action: 'queued-before-cutover' }));
  for (const item of f.pending.values()) item.destination = 'r2';
  await f.buffer.alarm();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(put).not.toHaveBeenCalled();
  expect(f.db.prepare).not.toHaveBeenCalled();
  expect([...f.pending.keys()].filter(k => k.startsWith('pending/'))).toHaveLength(0);
});
it('does not fall back to D1 or R2 if Supabase configuration is missing', async () => {
  const f = setup(); delete f.env.SUPABASE_JOURNAL_SECRET;
  const put = vi.fn(); f.env.JOURNAL_ARCHIVE = { put };
  await expect(withBufferedJournal(f.env, () => writeAudit(f.env.DB, { action: 'missing-config' }))).rejects.toThrow();
  expect(f.db.prepare).not.toHaveBeenCalled();
  expect(put).not.toHaveBeenCalled();
  expect(f.pending.size).toBe(0);
});
it('reports safe actionable diagnostics to owners without exposing upstream details', async () => {
  const f = setup(); const app = new Hono<any>();
  registerUsersAdminRoutes(app, { requireOwner: () => ({ ok: true, username: 'owner' }) } as any);
  delete f.env.SUPABASE_JOURNAL_SECRET;
  let res = await app.request('/api/admin/audit', {}, f.env);
  expect(await res.json()).toMatchObject({ code: 'JOURNAL_SUPABASE_UNAVAILABLE', reason: 'configuration' });
  f.env.SUPABASE_JOURNAL_SECRET = 'sb_secret_test';
  vi.stubGlobal('fetch', vi.fn(async () => new Response('secret internals', { status: 404 })));
  res = await app.request('/api/admin/audit', {}, f.env);
  const data: any = await res.json();
  expect(data.reason).toBe('schema');
  expect(JSON.stringify(data)).not.toContain('secret internals');
});
it('reports a sanitized queue failure to an owner and clears it after successful drain', async () => {
  const f = setup();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('key and URL must not leak', { status: 403 })));
  await withBufferedJournal(f.env, () => writeAudit(f.env.DB, { action: 'safe diagnostic' }));
  await f.buffer.alarm();
  const app = new Hono<any>();
  registerUsersAdminRoutes(app, { requireOwner: () => ({ ok: true, username: 'owner' }) } as any);
  delete f.env.SUPABASE_JOURNAL_SECRET; // health remains available even with broken config
  let response = await app.request('/api/admin/journal-buffer-status', {}, f.env);
  const data: any = await response.json();
  expect(data.data.last_failure.reason).toBe('credentials');
  expect(data.data.config_valid).toBe(false);
  expect(data.data.pending_at_least).toBe(1);
  expect(JSON.stringify(data)).not.toMatch(/key and URL|safe diagnostic|sb_secret/);
  f.env.SUPABASE_JOURNAL_SECRET = 'sb_secret_test';
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => Response.json({ accepted: true, count: JSON.parse(init.body).p_items.length })));
  await f.buffer.alarm();
  response = await app.request('/api/admin/journal-buffer-status', {}, f.env);
  expect((await response.json() as any).data).toMatchObject({ pending_at_least: 0, last_failure: null });
});

it('does not fan out a whole batch when both Supabase journal functions return 404', async () => {
  const f = setup();
  const fetch = vi.fn(async () => new Response(null, { status: 404 }));
  vi.stubGlobal('fetch', fetch);
  for (let i = 0; i < 10; i++) await withBufferedJournal(f.env, () => writeAudit(f.env.DB, { action: `event-${i}` }));
  await f.buffer.alarm();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect([...f.pending.keys()].filter(k => k.startsWith('pending/'))).toHaveLength(10);
  expect((await (await f.buffer.fetch(new Request('https://journal/health'))).json() as any).last_failure.reason).toBe('schema');
});

it('explains an owner-selected Supabase event without using the legacy journal', async () => {
  const f = setup(); const app = new Hono<any>(); let allowed = false;
  registerUsersAdminRoutes(app, { requireOwner: (c: any) => allowed ? { ok: true, username: 'owner' } : { ok: false, response: c.json({ error: 'Forbidden' }, 403) } } as any);
  const fetch = vi.fn(async (url: string, init: any) => {
    expect(url).toContain('/rpc/atlas_journal_page');
    expect(JSON.parse(init.body)).toMatchObject({ p_kind: 'api', p_cursor: 43, p_limit: 1, p_stats: false });
    return Response.json({ data: [{ id: 42, method: 'GET', path: '/api/products', status: 200 }], meta: {} });
  }); vi.stubGlobal('fetch', fetch);
  const body = JSON.stringify({ kind: 'api', id: 42 });
  expect((await app.request('/api/admin/audit/explain', { method: 'POST', body }, f.env)).status).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
  allowed = true;
  const res = await app.request('/api/admin/audit/explain', { method: 'POST', body }, f.env);
  expect(res.status).toBe(200);
  expect((await res.json() as any).data).toMatchObject({ source: 'rules' });
  expect(f.db.prepare).not.toHaveBeenCalled();
});
it('does not explain a different or expired Supabase event', async () => {
  const f = setup(); const app = new Hono<any>();
  registerUsersAdminRoutes(app, { requireOwner: () => ({ ok: true, username: 'owner' }) } as any);
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ id: 41 }], meta: {} })));
  const res = await app.request('/api/admin/audit/explain', { method: 'POST', body: JSON.stringify({ kind: 'api', id: 42 }) }, f.env);
  expect(res.status).toBe(404);
});
