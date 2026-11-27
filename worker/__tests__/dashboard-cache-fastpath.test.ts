import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import { registerDashboardIntegrityRoutes } from '../routes/dashboardIntegrity';

vi.mock('../lib/cache', () => ({
  DEFAULT_CACHE_TTL: 1800,
  doCacheGet: vi.fn(async (_hub: unknown, _kv: unknown, key: string) => key === 'dash' ? { productCount: 4 } : { products_low: 2, employees_pay_due: 8 }),
  doCachePut: vi.fn(),
}));

it('serves cached dashboard and authorized badge projections without initializing indexes', async () => {
  const app = new Hono<any>();
  const ensureCoreIndexes = vi.fn(async () => {});
  const db = { prepare: vi.fn(() => { throw new Error('unexpected D1'); }) };
  registerDashboardIntegrityRoutes(app, { ensureCoreIndexes, refreshLimitGate: () => null, sessionUserFromHeader: () => ({ role: 'owner' }), requireEmployeeAdmin: () => ({ denied: true }) } as any);
  const dashboard = await app.request('/api/dashboard', {}, { DB: db });
  expect((await dashboard.json() as any).data.productCount).toBe(4);
  const badges = await app.request('/api/nav-badges', {}, { DB: db });
  expect((await badges.json() as any).data).toMatchObject({ products_low: 2, employees_pay_due: 0 });
  expect(ensureCoreIndexes).not.toHaveBeenCalled(); expect(db.prepare).not.toHaveBeenCalled();
});
