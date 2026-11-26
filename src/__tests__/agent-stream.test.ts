// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../fingerprint', () => ({ getCachedFingerprint: async () => 'device' }));
import { readAgentStream } from '../lib/agentStream';
import { api } from '../api';
import { clearToken, setToken } from '../auth';

const stream = (...parts: string[]) => new ReadableStream<Uint8Array>({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); } });

describe('Agent tool event streaming', () => {
  beforeEach(() => { localStorage.clear(); setToken('token', undefined, 'alice', 'admin'); });
  afterEach(() => { clearToken(); vi.unstubAllGlobals(); });
  it('handles split frames and reports completed tool events before the final answer', async () => {
    const events: string[] = [];
    const done = await readAgentStream(stream('event: tool\r\ndata: {"name":"search_', 'products","ok":true}\r\n\r\nevent: token\ndata: {"t":"Hi"}\n\nevent: done\ndata: {"reply":"Hi"}\n\n'), (name, data) => events.push(`${name}:${data.name || data.t}`), () => {});
    expect(events).toEqual(['tool:search_products', 'token:Hi']);
    expect(done.reply).toBe('Hi');
  });
  it('does not treat a truncated or failed stream as success', async () => {
    await expect(readAgentStream(stream('event: token\ndata: {"t":"partial"}\n\n'), () => {}, () => {})).rejects.toThrow('interrompue');
    await expect(readAgentStream(stream('event: error\ndata: {"code":"failed","error":"Indisponible"}\n\n'), () => {}, () => {})).rejects.toThrow('Indisponible');
  });
  it('uses the authenticated streaming endpoint and returns the final trace', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(stream('event: tool\ndata: {"name":"search_products","ok":true}\n\nevent: done\ndata: {"reply":"Stock","tool_trace":[{"name":"search_products","ok":true}]}\n\n'), { headers: { 'Content-Type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchMock);
    const events = vi.fn();
    const controller = new AbortController();
    const result = await api.assistChat('Stock?', { onAgentEvent: events, signal: controller.signal });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/assist/chat/stream');
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal);
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer token' });
    expect(events).toHaveBeenCalledWith('tool', expect.objectContaining({ name: 'search_products' }));
    expect(result.data.reply).toBe('Stock');
  });
  it('does not deliver events after the authenticated user changes', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })));
    const events = vi.fn();
    const pending = api.assistChat('Stock?', { onAgentEvent: events });
    await vi.waitFor(() => expect(body.locked).toBe(true));
    setToken('other-token', undefined, 'bob', 'user');
    controller.enqueue(new TextEncoder().encode('event: tool\ndata: {"name":"search_products"}\n\n'));
    controller.close();
    await expect(pending).rejects.toThrow('La session a changé');
    expect(events).not.toHaveBeenCalled();
  });
});
