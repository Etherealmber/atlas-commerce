import { afterEach, beforeEach, expect, it } from 'vitest';
import { reserveDesktopCreate } from '../lib/desktop-create-budget';
const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = await import(SQLITE_MODULE);
let sqlite: any; let db: any;
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  db = { prepare(sql: string) { let params: any[] = []; const q: any = {
    bind(...args: any[]) { params = args; return q; },
    async run() { return sqlite.prepare(sql).run(...params); },
    async first() { return sqlite.prepare(sql).get(...params) ?? null; },
  }; return q; } };
});
afterEach(() => sqlite.close());
it('atomically caps cross-channel creations, persists across wrappers, and expires fixed windows', async () => {
  const now = 1_800_000_000_000;
  const results = await Promise.all(Array.from({length:12}, () => reserveDesktopCreate(db,'203.0.113.1',now)));
  expect(results.filter(Boolean)).toHaveLength(8);
  expect(await reserveDesktopCreate({...db},'203.0.113.1',now)).toBe(false);
  expect(await reserveDesktopCreate(db,'203.0.113.2',now)).toBe(true);
  expect(await reserveDesktopCreate(db,'203.0.113.1',now+300_000)).toBe(true);
  expect(JSON.stringify(sqlite.prepare('SELECT * FROM desktop_shared_create_limits_v1').all())).not.toContain('203.0.113.1');
});
it('normalizes simple IPv6 casing and rejects unknown or untrusted-looking inputs', async () => {
  for (let n=0; n<8; n++) expect(await reserveDesktopCreate(db,'2001:DB8::1',1_800_000_000_000)).toBe(true);
  expect(await reserveDesktopCreate(db,'2001:db8::1',1_800_000_000_000)).toBe(false);
  await expect(reserveDesktopCreate(db,'unknown')).rejects.toThrow('UNAVAILABLE');
  await expect(reserveDesktopCreate(db,'1.1.1.1, 2.2.2.2')).rejects.toThrow('UNAVAILABLE');
});
