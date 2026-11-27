/** Encrypted R2 journal outbox; buffered mode is disabled until configured.
 * Accepted items and their alarm are persisted atomically; retry writes use the
 * same immutable key and ciphertext. Does not guarantee upstream capture. */
import type { Env } from '../env';

const PREFIX = 'pending/';
const MAX_BATCH = 25;
const MAX_BYTES = 100_000;
const CURSOR = 'meta/drain-cursor';
const PATH = /^(?:api|audit)-journal\/v1\/\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f-]{36}\.journal$/;
type Item = { path: string; bytes: Uint8Array };

function equal(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

export class JournalBuffer {
  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/health') {
      const entries = await this.state.storage.list({ prefix: PREFIX, limit: 101 });
      const alarm = await this.state.storage.getAlarm();
      return Response.json({ pending_at_least: Math.min(entries.size, 100), has_more: entries.size > 100, alarm_scheduled: alarm !== null }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (request.method !== 'POST' || path !== '/enqueue') return new Response(null, { status: 404 });
    const length = Number(request.headers.get('content-length') || 0);
    if (length > 150_000) return new Response(null, { status: 413 });
    const input = await request.json().catch(() => null) as { path?: unknown; ciphertext?: unknown } | null;
    if (!input || typeof input.path !== 'string' || !PATH.test(input.path) || typeof input.ciphertext !== 'string' || input.ciphertext.length > 140_000) return new Response(null, { status: 400 });
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(input.ciphertext), c => c.charCodeAt(0)); } catch { return new Response(null, { status: 400 }); }
    if (bytes.length < 32 || bytes.length > MAX_BYTES || new TextDecoder().decode(bytes.slice(0, 4)) !== 'AJR1') return new Response(null, { status: 400 });
    const objectPath = input.path;
    const key = PREFIX + objectPath;
    const ok = await this.state.storage.transaction(async tx => {
      const existing = await tx.get<Item>(key);
      if (existing && !equal(existing.bytes, bytes)) return false;
      if (!existing) await tx.put(key, { path: objectPath, bytes });
      if (await tx.getAlarm() === null) await tx.setAlarm(Date.now() + 1000);
      return true;
    });
    return new Response(null, { status: ok ? 202 : 409 });
  }

  async alarm(): Promise<void> {
    const cursor = await this.state.storage.get<string>(CURSOR);
    let items = await this.state.storage.list<Item>({ prefix: PREFIX, limit: MAX_BATCH, ...(cursor ? { startAfter: cursor } : {}) });
    if (!items.size && cursor) {
      await this.state.storage.delete(CURSOR);
      items = await this.state.storage.list<Item>({ prefix: PREFIX, limit: MAX_BATCH });
    }
    if (!items.size) return;
    const bucket = this.env.JOURNAL_ARCHIVE;
    if (!bucket || bucket === this.env.IMAGES) {
      console.error('journal_buffer_drain_failed');
      await this.state.storage.setAlarm(Date.now() + 60_000);
      return;
    }
    let failed = false;
    for (const [key, item] of items) {
      try {
        // If-None-Match protects an existing immutable object on retries.
        await bucket.put(item.path, item.bytes, { onlyIf: new Headers({ 'If-None-Match': '*' }), httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'no-store' } });
        const stored = await bucket.get(item.path);
        if (!stored || !equal(new Uint8Array(await stored.arrayBuffer()), item.bytes)) throw new Error('journal read-back mismatch');
        await this.state.storage.delete(key);
      } catch {
        failed = true;
        console.error('journal_buffer_item_failed');
      }
    }
    // Even if one object fails, other items in this batch can make progress.
    // Keep failed entries and explicitly rearm beyond the platform retry limit.
    if ((await this.state.storage.list({ prefix: PREFIX, limit: 1 })).size) {
      await this.state.storage.put(CURSOR, [...items.keys()].at(-1));
      await this.state.storage.setAlarm(Date.now() + (failed ? 60_000 : 1000));
    } else {
      await this.state.storage.delete(CURSOR);
    }
  }
}
