import { describe, it, expect, vi } from 'vitest';
import { recordApiJournal } from '../lib/journalSink';
import * as api from '../lib/apiLog';
import * as archive from '../lib/journalArchive';

const row = { method: 'GET', path: '/api/invoices', status: 200, ms: 1, username: null, role: null, ip: null, ua: null, request_id: null, surface: null, country: null, city: null, region: null, asn: null, as_org: null };
const db = {} as D1Database;
describe('journal sink routing', () => {
  it('uses R2 instead of D1 when an encrypted write succeeds', async () => {
    const r2 = vi.spyOn(archive, 'archiveApiCall').mockResolvedValue(true);
    const d1 = vi.spyOn(api, 'writeApiLog').mockResolvedValue();
    await recordApiJournal({ JOURNAL_ARCHIVE_MODE: 'r2' } as any, db, row, false);
    expect(r2).toHaveBeenCalledOnce(); expect(d1).not.toHaveBeenCalled();
    r2.mockRestore(); d1.mockRestore();
  });
  it('reports R2 failure without writing D1 and skips idle polls', async () => {
    const r2 = vi.spyOn(archive, 'archiveApiCall').mockRejectedValue(new Error('unavailable'));
    const d1 = vi.spyOn(api, 'writeApiLog').mockResolvedValue();
    await expect(recordApiJournal({ JOURNAL_ARCHIVE_MODE: 'r2' } as any, db, row, false)).rejects.toThrow('R2 journal write failed');
    await recordApiJournal({ JOURNAL_ARCHIVE_MODE: 'r2' } as any, db, row, true);
    expect(d1).not.toHaveBeenCalled(); expect(r2).toHaveBeenCalledOnce();
    r2.mockRestore(); d1.mockRestore();
  });
});
