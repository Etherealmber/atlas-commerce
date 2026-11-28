import { expect, it } from 'vitest';
import { Hono } from 'hono';
import { registerAssistRoutes } from '../routes/assist';

it('reports truthful storage capabilities with no stale cache or secrets', async () => {
  const app = new Hono<any>(); registerAssistRoutes(app, {} as any);
  const get = async (env: any) => { const res = await app.request('/api/assist/status', {}, env); return { res, body: await res.json() as any }; };
  const legacy = await get({ ENVIRONMENT: 'production', GROQ_API_KEY: 'private' });
  expect(legacy.body.data.agent_history).toMatchObject({ storage: 'r2', require_expected_version: false, retention_days: null });
  expect(legacy.res.headers.get('cache-control')).toContain('no-store');
  expect(JSON.stringify(legacy.body)).not.toContain('private');
  const production = await get({ ENVIRONMENT: 'production', AGENT_HISTORY_STORAGE: 'supabase' });
  expect(production.body.data.agent_history).toEqual({ storage: 'supabase', version_type: 'string', require_expected_version: true, retention_days: 30, image_api: 'experimental', physical_cleanup: 'asynchronous' });
  const demo = await get({ ENVIRONMENT: 'production', AGENT_HISTORY_STORAGE: 'supabase', ATLAS_DEMO: '1' });
  expect(demo.body.data.agent_history.storage).toBe('r2');
  const preview = await get({ ENVIRONMENT: 'agent-storage-test', AGENT_STORAGE_PREVIEW: '1' });
  expect(preview.body.data.agent_history.storage).toBe('supabase-preview');
});
