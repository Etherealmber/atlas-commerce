import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DESKTOP_NATIVE_V2_CAPABILITIES as path, registerDesktopNativeDiscovery } from '../routes/desktopNativeDiscovery';

function app() { const a = new Hono<any>(); registerDesktopNativeDiscovery(a); return a; }
async function call(url: string, env: any = {}, headers: Record<string, string> = {}) {
  const res = await app().request(url, { headers }, env);
  return { res, data: await res.json() as any };
}

describe('desktop native v2 discovery contract', () => {
  it('is opt-in for discovery and advertises no native method even if opted in', async () => {
    const flags = [undefined, 'false', 'true', 'TRUE'];
    const responses = await Promise.all(flags.map(flag => call(`https://self-hosted.example:8443${path}`, { DESKTOP_NATIVE_V2_DISCOVERY: flag })));
    for (const [i, { res, data }] of responses.entries()) {
      const flag = flags[i];
      expect(res.status).toBe(200);
      expect(data.data.version).toBe(2);
      expect(data.data.discovery_enabled).toBe(flag === 'true');
      expect(Object.values(data.data.methods).every((x: any) => x.available === false)).toBe(true);
      expect(data.data.browser_fallback).toEqual({ version: 1, capabilities_path: '/api/auth/desktop/v1/capabilities', automatic: false });
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    }
  });
  it('does not advertise phone approval without both D1 prepare and transactional batch support', async () => {
    const url = `https://self-hosted.example:8443${path}`;
    const flags = { DESKTOP_NATIVE_V2_DISCOVERY: 'true', DESKTOP_NATIVE_V2_PHONE_APPROVAL: 'true' };
    for (const DB of [{ prepare() {} }, { batch() {} }, null]) {
      // eslint-disable-next-line no-await-in-loop -- verify each missing binding independently.
      const response = await call(url, { ...flags, DB });
      expect(response.data.data.methods.phone_approval.available).toBe(false);
    }
    const response = await call(url, { ...flags, DB: { prepare() {}, batch() {} } });
    expect(response.data.data.methods.phone_approval.available).toBe(true);
    expect(response.data.data.methods.password_otp.available).toBe(false);
    expect(response.data.data.methods.windows_passkey.available).toBe(false);
  });
  it('does not infer availability from native hints, identity, headers or global WebAuthn settings', async () => {
    const url = `https://self-hosted.example:8443${path}`;
    const first = await call(url, { WEBAUTHN_ENABLED: 'true', TURNSTILE_SECRET_KEY: 'not-exposed' });
    const second = await call(url, { WEBAUTHN_ENABLED: 'true', TURNSTILE_SECRET_KEY: 'not-exposed' }, { 'User-Agent': 'Native Atlas', 'X-Device-Fingerprint': 'fake', Authorization: 'Bearer secret' });
    expect(second.data).toEqual(first.data);
    expect(JSON.stringify(second.data)).not.toMatch(/secret|fake|Native Atlas/);
  });
  it('requires HTTPS, exact web Origin including port, and no query', async () => {
    expect((await call(`http://self-hosted.example${path}`)).data.code).toBe('HTTPS_REQUIRED');
    expect((await call(`https://self-hosted.example:8443${path}`, {}, { Origin: 'https://self-hosted.example' })).data.code).toBe('INVALID_REQUEST');
    expect((await call(`https://self-hosted.example:8443${path}`, {}, { Origin: 'https://self-hosted.example:8443' })).res.status).toBe(200);
    expect((await call(`https://self-hosted.example:8443${path}?password=secret`)).data.code).toBe('INVALID_REQUEST');
  });
  it('provides no v2 operation or token issuance even when discovery is enabled', async () => {
    const endpoints = ['requests', 'prepare', 'approve', 'poll', 'exchange', 'password', 'otp', 'passkey'];
    const responses = await Promise.all(endpoints.map(endpoint => app().request(`https://self-hosted.example:8443/api/auth/desktop/v2/${endpoint}`, { method: 'POST' }, { DESKTOP_NATIVE_V2_DISCOVERY: 'true' })));
    for (const res of responses) expect(res.status).toBe(404);
  });
});
