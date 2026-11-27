import { describe, expect, it } from 'vitest';
import { JournalBuffer } from '../durable/JournalBuffer';

const path = 'api-journal/v1/2026-01-01/2026-01-01T00-00-00-000Z-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.journal';
const bytes = new Uint8Array(40); bytes.set(new TextEncoder().encode('AJR1'));
const encode = (v: Uint8Array) => btoa(String.fromCharCode(...v));
function setup() {
  const pending = new Map<string, any>(); const objects = new Map<string, Uint8Array>();
  let alarm: number | null = null; let fail = false;
  const storage: any = {
    async get(k: string) { return pending.get(k); }, async put(k: string, v: any) { pending.set(k, v); },
    async delete(k: string) { return pending.delete(k); }, async getAlarm() { return alarm; }, async setAlarm(v: number) { alarm = v; },
    async list(o: any) { return new Map([...pending].filter(([k]) => k.startsWith(o.prefix)).slice(0, o.limit)); },
    async transaction(fn: any) { return fn(storage); },
  };
  const bucket = { async put(k: string, v: Uint8Array) { if (fail) throw new Error('offline'); if (!objects.has(k)) objects.set(k, v.slice()); }, async get(k: string) { const v = objects.get(k); return v ? { arrayBuffer: async () => v.slice().buffer } : null; } };
  const buffer = new JournalBuffer({ storage } as any, { JOURNAL_ARCHIVE: bucket } as any);
  const enqueue = (data = bytes) => buffer.fetch(new Request('https://journal/enqueue', { method: 'POST', body: JSON.stringify({ path, ciphertext: encode(data) }) }));
  return { buffer, enqueue, pending, objects, setFail(v: boolean) { fail = v; }, getAlarm: () => alarm };
}
describe('encrypted journal outbox building block', () => {
  it('persists before acknowledging and retries the same object after an outage', async () => {
    const f = setup(); expect((await f.enqueue()).status).toBe(202); expect(f.pending.size).toBe(1); expect(f.getAlarm()).not.toBeNull();
    f.setFail(true); await f.buffer.alarm(); expect(f.pending.size).toBe(1);
    f.setFail(false); await f.buffer.alarm(); expect(f.pending.size).toBe(0); expect(f.objects.get(path)).toEqual(bytes);
  });
  it('reports a bounded backlog and alarm without exposing journal data', async () => {
    const f = setup(); await f.enqueue();
    const res = await f.buffer.fetch(new Request('https://journal/health'));
    expect(await res.json()).toEqual({ pending_at_least: 1, has_more: false, alarm_scheduled: true });
  });
  it('accepts identical retries but refuses conflicting ciphertext', async () => {
    const f = setup(); expect((await f.enqueue()).status).toBe(202); expect((await f.enqueue()).status).toBe(202);
    const changed = bytes.slice(); changed[8] = 42; expect((await f.enqueue(changed)).status).toBe(409);
    expect(f.pending.size).toBe(1);
  });
  it('keeps the pending item when an existing object differs', async () => {
    const f = setup(); await f.enqueue(); const changed = bytes.slice(); changed[8] = 42; f.objects.set(path, changed);
    await f.buffer.alarm(); expect(f.pending.size).toBe(1);
  });
});
