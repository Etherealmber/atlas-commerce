import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { registerUsersAdminRoutes } from '../routes/usersAdmin';
import { ensureApiLogTable } from '../lib/apiLog';

const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = await import(SQLITE_MODULE) as { DatabaseSync: new (path: string) => any };

describe('API journal charts', () => {
  it('returns full-period daily counts and correctly ranked paths without changing filtered rows', async () => {
    const sqlite = new DatabaseSync(':memory:');
    const queries: string[] = [];
    const db: any = { prepare(sql: string) {
      queries.push(sql);
      let params: any[] = [];
      const stmt = {
        bind(...args: any[]) { params = args; return stmt; },
        async run() { return sqlite.prepare(sql).run(...params); },
        async first() { return sqlite.prepare(sql).get(...params) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...params) }; },
      };
      return stmt;
    } };
    try {
      await ensureApiLogTable(db);
      sqlite.exec(`INSERT INTO api_log (created_at,method,path,status,ms,ip) VALUES
        (datetime('now'), 'GET','/api/a',200,10,'1.1.1.1'),
        (datetime('now'), 'GET','/api/a',500,30,'1.1.1.1'),
        (datetime('now','-2 days'), 'GET','/api/a',200,20,'1.1.1.1'),
        (datetime('now','-2 days'), 'POST','/api/b',400,40,'2.2.2.2')`);
      const app = new Hono<any>();
      registerUsersAdminRoutes(app, { requireOwner: () => ({ ok: true }) } as any);
      const response = await app.request('/api/admin/api-log?range=7d&stats=1&status=error', {}, { DB: db });
      expect(response.status).toBe(200);
      const body: any = await response.json();
      expect(body.data).toHaveLength(2);
      expect(body.meta.stats).toMatchObject({ total: 4, errors: 2, unique_ips: 2, avg_ms: 25 });
      expect(body.meta.stats.top_paths).toEqual([
        { method: 'GET', path: '/api/a', n: 3, errors: 1 },
        { method: 'POST', path: '/api/b', n: 1, errors: 1 },
      ]);
      expect(body.meta.stats.by_day.map((r: any) => [r.n, r.errors])).toEqual([[2, 1], [2, 1]]);
      expect(queries.filter(q => q.includes('daily_paths AS MATERIALIZED'))).toHaveLength(1);
      const short = await app.request('/api/admin/api-log?range=24h&stats=1', {}, { DB: db });
      const shortBody: any = await short.json();
      expect(shortBody.meta.stats.total).toBe(2);
      expect(shortBody.meta.stats.by_day.map((r: any) => r.n)).toEqual([2]);
    } finally { sqlite.close(); }
  });
});
