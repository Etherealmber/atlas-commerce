import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyDesktopTurnstile } from '../lib/desktop-native-turnstile';

const input = { token: 'fictional-token', secret: 'fictional-secret', hostname: 'inventaire.example', action: 'desktop_v2', cdata: 'a'.repeat(64) };
const valid = { success: true, hostname: input.hostname, action: input.action, cdata: input.cdata };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('future native Turnstile verifier (not an enabled login method)', () => {
  it('requires a genuine server validation response bound to the expected hostname, action and ceremony', async () => {
    const request = vi.fn(async () => response(valid));
    expect(await verifyDesktopTurnstile(input, request as typeof fetch)).toBe(true);
    const [url, options] = request.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(options.method).toBe('POST'); expect(options.redirect).toBe('manual');
    expect((options.body as URLSearchParams).get('response')).toBe(input.token);
    expect((options.body as URLSearchParams).get('secret')).toBe(input.secret);
    expect(url).not.toContain(input.token); expect(url).not.toContain(input.secret);
  });
  it.each([
    { ...valid, success: false }, { ...valid, success: 'true' },
    { ...valid, hostname: 'other.example' }, { ...valid, action: 'other' },
    { ...valid, cdata: 'b'.repeat(64) }, { ...valid, cdata: undefined }, {},
  ])('rejects invalid provider responses %#', async payload => {
    expect(await verifyDesktopTurnstile(input, (async () => response(payload)) as typeof fetch)).toBe(false);
  });
  it('rejects the provider response for an expired or already-used token', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(valid))
      .mockResolvedValueOnce(response({ success: false, 'error-codes': ['timeout-or-duplicate'] }));
    expect(await verifyDesktopTurnstile(input, fetcher as typeof fetch)).toBe(true);
    expect(await verifyDesktopTurnstile(input, fetcher as typeof fetch)).toBe(false);
  });
  it('fails closed on HTTP errors, malformed JSON, or network failure and does not log secrets', async () => {
    const log = vi.spyOn(console, 'error');
    const fetches = [
      async () => response(valid, 503),
      async () => new Response('invalid json'),
      async () => { throw new Error(`${input.token} ${input.secret}`); },
    ];
    for (const fetcher of fetches) {
      // eslint-disable-next-line no-await-in-loop -- inspect independent failure modes.
      expect(await verifyDesktopTurnstile(input, fetcher as typeof fetch)).toBe(false);
    }
    expect(log).not.toHaveBeenCalled();
  });
  it('rejects redirects instead of following the provider to another origin', async () => {
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      expect(options.redirect).toBe('manual');
      return new Response(null, { status: 302, headers: { Location: 'https://other.example/' } });
    });
    expect(await verifyDesktopTurnstile(input, fetcher as typeof fetch)).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('fails closed on timeout even if the transport ignores cancellation', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const fetcher = ((_url: string, options: RequestInit) => { signal = options.signal; return new Promise<Response>(() => {}); }) as typeof fetch;
    const pending = verifyDesktopTurnstile(input, fetcher);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBe(false); expect(signal?.aborted).toBe(true);
  });
  it('does not call the provider for missing/oversized input or malformed binding', async () => {
    const fetcher = vi.fn();
    for (const bad of [{ ...input, token: '' }, { ...input, token: 'x'.repeat(2049) }, { ...input, secret: '' }, { ...input, cdata: 'bad value' }, { ...input, action: 'bad value' }]) {
      // eslint-disable-next-line no-await-in-loop -- inspect independent validation failures.
      expect(await verifyDesktopTurnstile(bad, fetcher as typeof fetch)).toBe(false);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
