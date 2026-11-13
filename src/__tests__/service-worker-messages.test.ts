/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function harness(client: { type: string; url: string } | null) {
  const listeners: Record<string, (e: any) => void> = {};
  const postMessage = vi.fn();
  const skipWaiting = vi.fn(async () => {});
  const get = vi.fn(async () => client);
  const matchAll = vi.fn(async () => [{ postMessage }]);
  const self = {
    location: { origin: 'https://example.test' },
    clients: { get, matchAll }, skipWaiting,
    addEventListener(type: string, fn: (event: any) => void) { listeners[type] = fn; },
  };
  runInNewContext(readFileSync('public/sw.js', 'utf8'), { self, URL });
  async function send(origin: string, source: any, type: string) {
    let pending: Promise<void> | undefined;
    listeners.message({ origin, source, data: { type }, waitUntil(p: Promise<void>) { pending = p; } });
    await pending;
  }
  return { send, get, skipWaiting, matchAll, postMessage };
}

describe('service worker message authorization', () => {
  it('permits same-origin window clients to flush and activate', async () => {
    const h = harness({ type: 'window', url: 'https://example.test/login' });
    await h.send('https://example.test', { id: 'same-origin' }, 'REQUEST_SYNC');
    await h.send('https://example.test', { id: 'same-origin' }, 'SKIP_WAITING');
    expect(h.postMessage).toHaveBeenCalledWith({ type: 'FLUSH_OUTBOX' });
    expect(h.skipWaiting).toHaveBeenCalledOnce();
  });

  it('rejects cross-origin, unknown, non-window and malformed clients', async () => {
    const good = harness({ type: 'window', url: 'https://example.test/' });
    await good.send('https://evil.test', { id: 'client' }, 'SKIP_WAITING');
    await good.send('https://example.test', null, 'REQUEST_SYNC');
    await good.send('https://example.test', { id: 'client' }, 'UNKNOWN');
    expect(good.get).not.toHaveBeenCalled();
    for (const client of [null, { type: 'worker', url: 'https://example.test/' }, { type: 'window', url: 'https://evil.test/' }, { type: 'window', url: 'not a URL' }]) {
      const h = harness(client);
      await h.send('https://example.test', { id: 'client' }, 'SKIP_WAITING');
      await h.send('https://example.test', { id: 'client' }, 'REQUEST_SYNC');
      expect(h.skipWaiting).not.toHaveBeenCalled();
      expect(h.matchAll).not.toHaveBeenCalled();
    }
  });
});
