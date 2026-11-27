import { describe, expect, it } from 'vitest';
import { JournalBuffer } from '../durable/JournalBuffer';
import { enqueueBufferedApi, withBufferedJournal } from '../lib/journalBuffered';
import { writeAudit } from '../lib/authHelpers';
import { readArchivedApiCall, readArchivedJournal, listArchivedJournal } from '../lib/journalArchive';

function setup() {
  const pending = new Map<string, any>(); const objects = new Map<string, Uint8Array>(); let alarm: number | null = null;
  const storage: any = { async get(k: string) { return pending.get(k); }, async put(k: string, v: any) { pending.set(k, v); }, async delete(k: string) { return pending.delete(k); }, async getAlarm() { return alarm; }, async setAlarm(v: number) { alarm = v; }, async list(o: any) { return new Map([...pending].filter(([k]) => k.startsWith(o.prefix) && (!o.startAfter || k > o.startAfter)).slice(0, o.limit)); }, async transaction(fn: any) { return fn(storage); } };
  const bucket = { async list(options: { prefix: string }) { return { objects: [...objects.keys()].filter(k => k.startsWith(options.prefix)).map(key => ({ key })), truncated: false }; }, async put(k: string, b: Uint8Array) { if (!objects.has(k)) objects.set(k, b.slice()); }, async get(k: string) { const bytes = objects.get(k); return bytes ? { arrayBuffer: async () => bytes.slice().buffer } : null; } };
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
    const auditPath = [...f.objects.keys()].find(p => p.startsWith('audit-journal/'))!;
    expect(await readArchivedJournal(f.env, auditPath, 'audit')).toMatchObject({ username: 'alice', action: 'update', detail: 'private detail' });
    expect(await readArchivedJournal(f.env, auditPath, 'api')).toBeNull();
    const day = new Date().toISOString().slice(0, 10);
    expect((await listArchivedJournal(f.env, day, undefined, 'audit')).keys).toEqual([auditPath]);
    expect((await listArchivedJournal(f.env, day, undefined, 'api')).keys).toEqual([apiPath]);
  });
  it('does not fall back to D1 when the buffer is unavailable', async () => {
    const f = setup(); delete f.env.JOURNAL_BUFFER;
    await expect(withBufferedJournal(f.env, () => writeAudit(f.env.DB, { action: 'test' }))).rejects.toThrow();
    expect(f.writes()).toBe(0);
  });
});

it('retries a lost enqueue acknowledgement with the identical encrypted event', async () => {
  const f = setup();
  const original = f.env.JOURNAL_BUFFER;
  const bodies: string[] = [];
  f.env.JOURNAL_BUFFER = { idFromName: () => 'id', get: () => ({ fetch: async (url: string, init: RequestInit) => {
    bodies.push(String(init.body));
    const response = await original.get().fetch(url, init);
    if (bodies.length === 1) throw new Error('ack lost');
    return response;
  } }) };
  await withBufferedJournal(f.env, () => writeAudit(f.env.DB, { action: 'update' }));
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toBe(bodies[1]);
  expect(f.pending.size).toBe(1);
  expect(f.writes()).toBe(0);
  await f.buffer.alarm();
  expect(f.objects.size).toBe(1);
});
