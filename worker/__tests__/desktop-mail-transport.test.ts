import { describe, expect, it, vi } from 'vitest';
import { createConfiguredNativeMailbox, createNativeMailTransport } from '../lib/desktop-mail-transport';
const config = {DESKTOP_NATIVE_MAIL_TRANSPORT:'resend-v1',DESKTOP_NATIVE_RESEND_API_KEY:'re_testkey12345',DESKTOP_NATIVE_MAIL_FROM:'security@example.test',DESKTOP_NATIVE_MAILBOX_MAC_KEY:'dedicated-test-secret-at-least-32-characters'};
const message = {to:'alice@example.test',code:'123456',purpose:'new_mailbox' as const};
describe('dedicated native mail transport', () => {
  it('is opt-in and requires separate transport configuration and authorization policy', () => {
    expect(createNativeMailTransport({})).toBeNull();
    expect(createNativeMailTransport({...config,DESKTOP_NATIVE_MAIL_FROM:'bad\r\nFrom:x'})).toBeNull();
    expect(createNativeMailTransport({...config,DESKTOP_NATIVE_RESEND_API_KEY:'bad'})).toBeNull();
    expect(createConfiguredNativeMailbox({} as D1Database,config)).toBeNull();
  });
  it('uses only the fixed provider, single supplied recipient, no fallback and no redirects', async () => {
    const fetcher = vi.fn(async () => new Response('{}',{status:200}));
    const send=createNativeMailTransport(config,fetcher as any)!;
    const signal=new AbortController().signal;
    expect(await send(message,signal)).toBe(true);
    const [url,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe('https://api.resend.com/emails'); expect(init.redirect).toBe('error'); expect(init.signal).toBe(signal);
    expect(JSON.parse(String(init.body))).toMatchObject({from:'security@example.test',to:['alice@example.test'],text:expect.stringContaining('123456')});
    expect(await send({...message,to:'bob@example.test'},signal)).toBe(true);
    expect(JSON.parse(String((fetcher.mock.calls[1] as any)[1].body)).to).toEqual(['bob@example.test']);
  });
  it('fails closed for errors, provider rejection, abort and injection', async () => {
    const fetcher=vi.fn(async () => new Response('secret provider output',{status:500})); const send=createNativeMailTransport(config,fetcher as any)!;
    const controller=new AbortController();
    expect(await send(message,controller.signal)).toBe(false);
    expect(await send({...message,to:'a@example.test\r\nBcc:evil@example.test'},controller.signal)).toBe(false);
    controller.abort(); expect(await send(message,controller.signal)).toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
    const throwing=createNativeMailTransport(config,vi.fn(async () => {throw new Error('secret');}) as any)!;
    expect(await throwing(message,new AbortController().signal)).toBe(false);
  });
});
