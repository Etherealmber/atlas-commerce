/** Encrypted journal outbox for Supabase (and legacy R2 destinations).
 * Accepted items and their alarm are persisted atomically; retry writes use the
 * same immutable key and ciphertext. Does not guarantee upstream capture. */
import type { Env } from '../env';
import { journalRpc, JournalServiceError, JournalConfigurationError } from '../lib/journalSupabase';

const PREFIX = 'pending/';
const MAX_BATCH = 25;
const MAX_BYTES = 100_000;
const CURSOR = 'meta/drain-cursor';
const FAILURE = 'meta/last-failure';
const PATH = /^(?:api|audit)-journal\/v1\/\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f-]{36}\.journal$/;
type Item = { path: string; bytes: Uint8Array; destination?: 'r2' | 'supabase' };

type JournalEvent = { p_key: string; p_kind: 'api' | 'audit'; p_data: object };
async function decryptEvent(env: Env, item: Item): Promise<JournalEvent> {
  const secret = Uint8Array.from(atob(env.JOURNAL_ENCRYPTION_KEY || ''), c => c.charCodeAt(0));
  if (secret.length !== 32) throw new Error('Journal key invalid');
  const key = await crypto.subtle.importKey('raw', secret, 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: item.bytes.slice(4, 16), additionalData: new TextEncoder().encode(item.path) }, key, item.bytes.slice(16));
  const row = JSON.parse(new TextDecoder().decode(plain));
  return { p_key: item.path, p_kind: item.path.startsWith('api-') ? 'api' : 'audit', p_data: row };
}

async function sendSingle(env: Env, event: JournalEvent) {
  const result = await journalRpc(env, 'atlas_journal_ingest', event);
  if (result?.accepted !== true) throw new Error('Journal acknowledgement missing');
}

function equal(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

export class JournalBuffer {
  constructor(private readonly state: DurableObjectState, private readonly env: Env) {}

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/health') {
      const lastFailure = await this.state.storage.get<{ reason: string; at: string }>(FAILURE);
      const entries = await this.state.storage.list({ prefix: PREFIX, limit: 101 });
      const alarm = await this.state.storage.getAlarm();
      return Response.json({ pending_at_least: Math.min(entries.size, 100), has_more: entries.size > 100, alarm_scheduled: alarm !== null, last_failure: lastFailure || null }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (request.method !== 'POST' || path !== '/enqueue') return new Response(null, { status: 404 });
    const length = Number(request.headers.get('content-length') || 0);
    if (length > 150_000) return new Response(null, { status: 413 });
    const input = await request.json().catch(() => null) as { path?: unknown; ciphertext?: unknown; destination?: unknown } | null;
    if (!input || typeof input.path !== 'string' || !PATH.test(input.path) || typeof input.ciphertext !== 'string' || input.ciphertext.length > 140_000) return new Response(null, { status: 400 });
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(input.ciphertext), c => c.charCodeAt(0)); } catch { return new Response(null, { status: 400 }); }
    if (bytes.length < 32 || bytes.length > MAX_BYTES || new TextDecoder().decode(bytes.slice(0, 4)) !== 'AJR1') return new Response(null, { status: 400 });
    if (input.destination !== undefined && input.destination !== 'r2' && input.destination !== 'supabase') return new Response(null, { status: 400 });
    const destination = input.destination === 'supabase' ? 'supabase' : 'r2';
    const objectPath = input.path;
    const key = PREFIX + objectPath;
    const ok = await this.state.storage.transaction(async tx => {
      const existing = await tx.get<Item>(key);
      if (existing && (!equal(existing.bytes, bytes) || (existing.destination || 'r2') !== destination)) return false;
      if (!existing) await tx.put(key, { path: objectPath, bytes, destination });
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
    let failed = false;
    let failureReason = '';
    const markFailed = (reason: string) => { failed = true; if (!failureReason) failureReason = reason; };
    const classify = (error: unknown): string => {
      if (error instanceof JournalConfigurationError) return 'configuration';
      if (error instanceof JournalServiceError) {
        if (error.status === 401 || error.status === 403) return 'credentials';
        if (error.status === 404) return 'schema';
        if (error.status === 400 || error.status === 422) return 'event_or_schema';
        if (error.status === 429) return 'rate_limit';
        return 'service';
      }
      return 'service';
    };
    const supabase: { key: string; event: JournalEvent; size: number }[] = [];
    for (const [key, item] of items) {
      try {
        if (item.destination === 'supabase' || this.env.JOURNAL_ARCHIVE_MODE === 'supabase') {
          const event = await decryptEvent(this.env, item);
          supabase.push({ key, event, size: new TextEncoder().encode(JSON.stringify(event)).length });
        } else {
          // Legacy mode only; Supabase mode routes all pending items to Supabase.
          if (!bucket || bucket === this.env.IMAGES) throw new Error('journal bucket unavailable');
          await bucket.put(item.path, item.bytes, { onlyIf: new Headers({ 'If-None-Match': '*' }), httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'no-store' } });
          const stored = await bucket.get(item.path);
          if (!stored || !equal(new Uint8Array(await stored.arrayBuffer()), item.bytes)) throw new Error('journal read-back mismatch');
          await this.state.storage.delete(key);
        }
      } catch {
        markFailed(item.destination === 'supabase' || this.env.JOURNAL_ARCHIVE_MODE === 'supabase' ? 'decrypt' : 'legacy_storage');
        console.error('journal_buffer_item_failed');
      }
    }
    // Bound the POST size as well as the item count. Only delete after the
    // entire batch is acknowledged; lost responses retry the same event keys.
    while (supabase.length) {
      const chunk: typeof supabase = [];
      let size = 0;
      while (supabase.length && (!chunk.length || size + supabase[0].size <= 500_000)) {
        const next = supabase.shift()!;
        chunk.push(next); size += next.size;
      }
      try {
        const result = await journalRpc(this.env, 'atlas_journal_ingest_batch', { p_items: chunk.map(x => x.event) });
        if (result?.accepted !== true || result.count !== chunk.length) throw new Error('Journal acknowledgement missing');
        for (const item of chunk) await this.state.storage.delete(item.key);
      } catch (error) {
        // A missing RPC during a rolling upgrade or a bad row must not block
        // healthy rows. Outages, rate limits and lost ACKs do not fan out.
        if (error instanceof JournalServiceError && (error.status === 400 || error.status === 404 || error.status === 422)) {
          for (const item of chunk) {
            try { await sendSingle(this.env, item.event); await this.state.storage.delete(item.key); }
            catch (singleError) {
              markFailed(classify(singleError)); console.error('journal_buffer_item_failed');
              // A missing single-event endpoint cannot be repaired by sending
              // the rest of the batch individually. Retain them for retry.
              if (singleError instanceof JournalServiceError && singleError.status === 404) break;
            }
          }
        } else {
          markFailed(classify(error));
          console.error('journal_buffer_batch_failed');
        }
      }
    }
    if (failed) await this.state.storage.put(FAILURE, { reason: failureReason, at: new Date().toISOString() });
    else if (!(await this.state.storage.list({ prefix: PREFIX, limit: 1 })).size) await this.state.storage.delete(FAILURE);
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
