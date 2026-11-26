import { describe, expect, it } from 'vitest';
import { copyJournalPage } from '../lib/journalBackfill';

function fixture() {
  const objects = new Map<string, Uint8Array>();
  const bucket = {
    put: async (path: string, data: Uint8Array, opts: any) => {
      expect(opts.onlyIf.etagDoesNotMatch).toBe('*');
      if (objects.has(path)) return null;
      objects.set(path, data.slice()); return {};
    },
    get: async (path: string) => objects.has(path) ? { arrayBuffer: async () => objects.get(path)!.slice().buffer } : null,
  };
  const rows: any[] = [{ id: 1, action: 'secret action', ip: '192.0.2.1' }, { id: 3, action: 'other' }, { id: 8, action: 'after watermark' }];
  const db = { prepare: (sql: string) => ({ bind: (after: number, through: number, limit: number) => ({ all: async () => {
    expect(sql).toContain('ORDER BY id ASC'); return { results: rows.filter(r => r.id > after && r.id <= through).slice(0, limit) };
  } }) }) };
  return { objects, rows, db: db as any, env: { JOURNAL_ARCHIVE: bucket as any, JOURNAL_ENCRYPTION_KEY: btoa('a'.repeat(32)) } };
}
describe('journal backfill building block', () => {
  it.each(['audit_log', 'api_log'] as const)('copies %s pages encrypted, resumably and without touching source', async source => {
    const f = fixture(); const input = { namespace: 'production-001', source, afterId: 0, throughId: 3, limit: 1 };
    expect(await copyJournalPage(f.env, f.db, input)).toEqual({ cursor: 1, copied: 1, done: false });
    expect(await copyJournalPage(f.env, f.db, input)).toEqual({ cursor: 1, copied: 1, done: false });
    expect(await copyJournalPage(f.env, f.db, { ...input, afterId: 1 })).toEqual({ cursor: 3, copied: 1, done: true });
    expect(f.objects.size).toBe(2); expect(f.rows).toHaveLength(3);
    expect(new TextDecoder().decode([...f.objects.values()][0])).not.toContain('secret action');
    f.rows[0].action = 'changed';
    await expect(copyJournalPage(f.env, f.db, input)).rejects.toThrow('differs');
  });
  it('fails closed for invalid keys, bucket, source, and cursors', async () => {
    const f = fixture(); const input = { namespace: 'production-001', source: 'audit_log' as const, afterId: 0, throughId: 3 };
    await expect(copyJournalPage({ ...f.env, JOURNAL_ENCRYPTION_KEY: '' }, f.db, input)).rejects.toThrow();
    await expect(copyJournalPage({ ...f.env, IMAGES: f.env.JOURNAL_ARCHIVE }, f.db, input)).rejects.toThrow();
    await expect(copyJournalPage(f.env, f.db, { ...input, source: 'audit_log; DROP TABLE audit_log' as any })).rejects.toThrow();
    await expect(copyJournalPage(f.env, f.db, { ...input, afterId: -1 })).rejects.toThrow();
    expect(f.objects.size).toBe(0);
  });
});
