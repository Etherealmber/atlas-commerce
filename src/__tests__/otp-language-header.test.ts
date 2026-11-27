// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import { setLang } from '../i18n/core';

vi.mock('../fingerprint', () => ({ getCachedFingerprint: vi.fn().mockResolvedValue('fingerprint') }));
afterEach(() => { setLang('fr'); vi.unstubAllGlobals(); });

it('sends the selected app language on OTP-related API calls', async () => {
  const send = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ emailed: true, message: 'ok' }), { status: 200 }));
  vi.stubGlobal('fetch', send);
  setLang('ar');
  await api.requestAccountOtp();
  expect(send.mock.calls[0]?.[1]?.headers).toMatchObject({ 'Accept-Language': 'ar' });
});
