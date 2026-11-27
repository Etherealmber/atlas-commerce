import { Hono } from 'hono';
import { expect, it, vi } from 'vitest';
import { registerAuthRoutes } from '../routes/authRoutes';
import { runInDataScope } from '../lib/dataScope';
import { DemoD1 } from '../lib/demo/demoD1';

it('does not exhaust real-account budgets on repeated gateway-verified sandbox logins', async () => {
  const app = new Hono<any>();
  const credentialAttemptGate = vi.fn(async (c: any) => c.json({ code: 'RATE_LIMITED' }, 429));
  const deps: any = {
    credentialAttemptGate, isNativeAuthRequest: () => false, verifyTurnstile: async () => ({ ok: true }), clientIp: () => '127.0.0.1',
    ensureSecurityTables: async () => {}, getOwnerUsername: () => 'test', getPassword: () => 'test',
    passwordsMatch: (a: string, b: string) => a === b, normalizePassword: (x: string) => x,
    trustDevice: async () => {}, recordLogin: async () => {}, writeAudit: async () => {},
    makeTokenV2: async () => 'sandbox-token',
  };
  registerAuthRoutes(app as any, deps);
  const db = new DemoD1(async () => ({ ok: true, result: { columns: [], rows: [], meta: {} } }), 'rate-test');
  const env: any = { DB: db, ATLAS_DEMO: '1' };
  const req = (password = 'test') => new Request('https://example.com/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'test', password }) });
  for (let i = 0; i < 8; i++) {
    const response = await runInDataScope('demo:isolated:1', () => app.fetch(req(), env));
    expect(response.status).toBe(200);
    expect((await response.json() as any).needs_otp).toBe(false);
  }
  expect(credentialAttemptGate).not.toHaveBeenCalled();
  expect((await app.fetch(req(), env)).status).toBe(429); // no trusted demo scope
  expect((await runInDataScope('demo:isolated:1', () => app.fetch(req('wrong'), env))).status).toBe(429);
  expect((await runInDataScope('demo:isolated:1', () => app.fetch(req(), { ...env, DB: { prepare: () => ({ bind() { return this; }, all: async () => ({ results: [] }), run: async () => ({}) }) } }))).status).toBe(429);
  expect(credentialAttemptGate).toHaveBeenCalledTimes(3);
});
