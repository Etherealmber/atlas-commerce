import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import { registerUsersAdminRoutes } from '../routes/usersAdmin';

it('never reads legacy D1 journal views in buffered R2 mode', async () => {
  const app = new Hono<any>();
  registerUsersAdminRoutes(app as any, { requireOwner: () => ({ ok: true, username: 'owner' }) } as any);
  const prepare = vi.fn(() => { throw new Error('D1 should not be consulted'); });
  const env = { DB: { prepare }, JOURNAL_ARCHIVE_MODE: 'buffered' };
  for (const [method, path] of [['GET', '/api/admin/audit'], ['GET', '/api/admin/api-log'], ['POST', '/api/admin/audit/explain'], ['GET', '/api/admin/audit/export']]) {
    const res = await app.fetch(new Request(`https://example.com${path}`, { method }), env);
    expect(res.status).toBe(409);
    expect((await res.json() as any).code).toBe('JOURNAL_R2_ONLY');
  }
  expect(prepare).not.toHaveBeenCalled();
});

it('allows only an owner to inspect bounded outbox health', async () => {
  const app = new Hono<any>();
  let allowed = false;
  registerUsersAdminRoutes(app as any, { requireOwner: (c: any) => allowed ? { ok: true, username: 'owner' } : { ok: false, response: c.json({ error: 'Forbidden' }, 403) } } as any);
  const fetch = vi.fn(async () => Response.json({ pending_at_least: 2, has_more: false, alarm_scheduled: true }));
  const env = { JOURNAL_ARCHIVE_MODE: 'buffered', JOURNAL_ARCHIVE: {}, JOURNAL_BUFFER: { idFromName: () => 'id', get: () => ({ fetch }) } };
  expect((await app.fetch(new Request('https://example.com/api/admin/journal-buffer-status'), env)).status).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
  allowed = true;
  const res = await app.fetch(new Request('https://example.com/api/admin/journal-buffer-status'), env);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ data: { pending_at_least: 2, alarm_scheduled: true } });
});

 it('reports the active view only to authorized users, without D1 journal reads', async () => {
  const app = new Hono<any>(); let allowed = false;
  registerUsersAdminRoutes(app as any, { requireOwner: (c: any) => allowed ? { ok: true, username: 'owner' } : { ok: false, response: c.json({ error: 'Forbidden' }, 403) } } as any);
  const prepare = vi.fn(() => { throw new Error('unexpected D1'); });
  const env = { DB: { prepare }, JOURNAL_ARCHIVE_MODE: 'buffered' };
  expect((await app.request('/api/admin/journal-mode', {}, env)).status).toBe(403);
  allowed = true;
  const res = await app.request('/api/admin/journal-mode', {}, env);
  expect(await res.json()).toMatchObject({ data: { mode: 'r2' } });
  expect(prepare).not.toHaveBeenCalled();
  const demo = await app.request('/api/admin/journal-mode', {}, { ...env, ATLAS_DEMO: '1' });
  expect(await demo.json()).toMatchObject({ data: { mode: 'legacy' } });
});
