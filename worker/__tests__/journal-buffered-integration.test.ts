import { describe, expect, it } from 'vitest';
import { JournalBuffer } from '../durable/JournalBuffer';
import { enqueueBufferedApi, withBufferedJournal } from '../lib/journalBuffered';
import { writeAudit } from '../lib/authHelpers';
import { readArchivedApiCall } from '../lib/journalArchive';

function setup() {
  const pending = new Map<string, any>(); const objects = new Map<string, Uint8Array>(); let alarm: number | null = null;
  const storage: any = { async get(k: string) { return pending.get(k); }, async put(k: string, v: any) { pending.set(k, v); }, async delete(k: string) { return pending.delete(k); }, async getAlarm() { return alarm; }, async setAlarm(v: number) { alarm = v; }, async list(o: any) { return new Map([...pending].filter(([k]) => k.startsWith(o.prefix)).slice(0, o.limit)); }, async transaction(fn: any) { return fn(storage); } };
  const bucket = { async put(k: string, b: Uint8Array) { if (!objects.has(k)) objects.set(k, b.slice()); }, async get(k: string) { const bytes = objects.get(k); return bytes ? { arrayBuffer: async () => bytes.slice().buffer } : null; } };
  let writes = 0; const db = { prepare() { writes++; throw new Error('D1 must not be used'); } };
  const env: any = { DB: db, JOURNAL_ARCHIVE_MODE: 'buffered', JOURNAL_ARCHIVE: bucket, JOURNAL_ENCRYPTION_KEY: btoa('k'.repeat(32)) };
  const buffer = new JournalBuffer({ storage } as any, env);
  env.JOURNAL_BUFFER = { idFromName: () => 'id', get: () => ({ fetch: (url: string, init: RequestInit) => buffer.fetch(new Request(url, init)) }) };
  return { env, buffer, pending, objects, writes: () => writes };
}
describe('buffered R2 journal producers', () => {
  it('encrypts and queues API and audit events without a D1 write', async () => {
    const f = setup();
    await enqueueBufferedApi(f.env, { method: 'GET', path: '/api/items?token=secret', status: 200, ms: 1, username: 'alice', role: 'owner', ip: null, ua: null, request_id: null, surface: null, country: null, city: null, region: null, asn: null, as_org: null });
    await withBufferedJournal(f.env, () => writeAudit(f.env.DB, { username: 'alice', action: 'update', entity: 'products', entity_id: 5, detail: 'private detail' }));
    expect(f.writes()).toBe(0); expect(f.pending.size).toBe(2);
    for (const item of f.pending.values()) expect(new TextDecoder().decode(item.bytes)).not.toContain('alice');
    await f.buffer.alarm(); expect(f.pending.size).toBe(0);
    const apiPath = [...f.objects.keys()].find(p => p.startsWith('api-journal/'))!;
    expect(await readArchivedApiCall(f.env, apiPath)).toMatchObject({ username: 'alice', path: '/api/items' });
    expect([...f.objects.keys()].some(p => p.startsWith('audit-journal/'))).toBe(true);
  });
  it('does not fall back to D1 when the buffer is unavailable', async () => {
    const f = setup(); delete f.env.JOURNAL_BUFFER;
    await expect(withBufferedJournal(f.env, () => writeAudit(f.env.DB, { action: 'test' }))).rejects.toThrow();
    expect(f.writes()).toBe(0);
  });
});
