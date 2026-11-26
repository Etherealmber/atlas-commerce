import { describe, expect, it } from 'vitest';
import worker from '../index';

const ctx = { waitUntil: () => {} } as unknown as ExecutionContext;
const env = { FINANCE_ENGINE_MODE: 'ts-fallback', TURNSTILE_SITE_KEY: 'test-site', TURNSTILE_SECRET_KEY: 'test-secret' } as any;
const origin = 'https://store.afmarbre.com';

describe('cross-origin login configuration', () => {
  it.each(['/api/auth/turnstile-config', '/api/auth/login'])('permits the existing Atlas client header for preflight to %s', async path => {
    const res = await worker.fetch(new Request(`https://stock.afmarbre.com${path}`, {
      method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': path.endsWith('/login') ? 'POST' : 'GET', 'Access-Control-Request-Headers': 'content-type,x-device-fingerprint,x-atlas-client' },
    }), env, ctx);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(res.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).toContain('x-atlas-client');
  });
  it('returns public config for a browser hint without requiring a database', async () => {
    const res = await worker.fetch(new Request('https://stock.afmarbre.com/api/auth/turnstile-config?client=web', {
      headers: { Origin: origin, 'User-Agent': 'Mozilla/5.0 Chrome/120.0 Safari/537.36' },
    }), env, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(await res.json()).toMatchObject({ data: { enabled: true, site_key: 'test-site', native_skip: false } });
  });
  it('does not approve an untrusted origin', async () => {
    const res = await worker.fetch(new Request('https://stock.afmarbre.com/api/auth/login', {
      method: 'OPTIONS', headers: { Origin: 'https://example.invalid', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-atlas-client' },
    }), env, ctx);
    expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('https://example.invalid');
  });
});
