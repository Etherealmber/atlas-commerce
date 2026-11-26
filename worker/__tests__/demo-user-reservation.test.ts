import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { registerUsersAdminRoutes } from '../routes/usersAdmin';
import { demoOffLimitsResponse } from '../lib/demo/gateway';

describe('demo user restrictions', () => {
  it('blocks user creation in demo but leaves other operations available', async () => {
    const response = demoOffLimitsResponse('/api/admin/users', 'post');
    expect(response?.status).toBe(403);
    expect(await response!.json()).toMatchObject({ code: 'DEMO_DISABLED' });
    expect(demoOffLimitsResponse('/api/admin/users', 'GET')).toBeNull();
    expect(demoOffLimitsResponse('/api/products', 'POST')).toBeNull();
  });

  it('reserves normalized test usernames while allowing normal accounts', async () => {
    const inserts: unknown[][] = [];
    const db = { prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = { bind(...values: unknown[]) { args = values; return stmt; },
        async first() { return null; },
        async run() { if (sql.includes('INSERT INTO app_users')) inserts.push(args); return {}; } };
      return stmt;
    } };
    const app = new Hono<any>();
    registerUsersAdminRoutes(app as any, {
      requireOwner: () => ({ ok: true, username: 'owner' }),
      checkConfirmPassword: async () => ({ ok: true }),
      getOwnerUsername: () => 'owner', normalizePassword: (s: string) => s,
      ensureSecurityTables: async () => {}, randomChallenge: () => 'abcdefghijklmnop',
      hashUserPassword: async () => 'hash', writeAudit: async () => {},
    } as any);
    const create = (username: string) => app.request('/api/admin/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'password', confirm_password: 'owner-password' }),
    }, { DB: db });
    for (const username of ['test', ' TEST ', 'TeSt']) {
      const response = await create(username);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'USERNAME_RESERVED' });
    }
    expect(inserts).toHaveLength(0);
    expect((await create('colleague')).status).toBe(200);
    expect(inserts[0][0]).toBe('colleague');
  });
});
