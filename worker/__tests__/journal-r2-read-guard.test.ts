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
    expect(res.status).toBe(503);
    expect((await res.json() as any).code).toBe('JOURNAL_R2_ONLY');
  }
  expect(prepare).not.toHaveBeenCalled();
});
