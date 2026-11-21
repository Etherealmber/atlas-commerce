import { describe, expect, it } from 'vitest';
import app from '../index';

describe('scanner security policy', () => {
  it('allows the bundled WASM decoder without enabling JavaScript unsafe-eval', async () => {
    const env = { ASSETS: { fetch: async () => new Response('<!doctype html><html></html>', { headers: { 'Content-Type': 'text/html' } }) } };
    const response = await app.fetch(new Request('https://test.local/scan', { headers: { 'CF-Connecting-IP': '203.0.113.25' } }), env as any, { waitUntil() {} } as any);
    const csp = response.headers.get('content-security-policy') || '';
    const script = csp.split(';').find((part) => part.trim().startsWith('script-src ')) || '';
    expect(script).toContain("'wasm-unsafe-eval'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });
});
