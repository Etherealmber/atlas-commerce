import { writeApiLog, type ApiLogRow } from './apiLog';
import { archiveApiCall } from './journalArchive';
import type { Env } from '../env';
import { enqueueBufferedApi } from './journalBuffered';

/** R2 mode never falls back to D1. This is not a durable queue: a failed
 * background write can lose an event, so do not enable it before cutover work.
 * Shadow remains D1-authoritative; idle QR polling is excluded from D1. */
export async function recordApiJournal(env: Env, db: D1Database, row: ApiLogRow, idle: boolean): Promise<void> {
  if (env.JOURNAL_ARCHIVE_MODE === 'buffered') {
    if (!idle) await enqueueBufferedApi(env, row);
    return;
  }
  if (env.JOURNAL_ARCHIVE_MODE === 'r2') {
    if (idle) return;
    try {
      if (!await archiveApiCall(env, row)) throw new Error('Journal archive disabled');
    } catch {
      console.error('journal_archive_write_failed');
      throw new Error('R2 journal write failed');
    }
    return;
  }
  const archived = archiveApiCall(env, row).catch(() => { console.error('journal_archive_write_failed'); });
  if (!idle) await writeApiLog(db, row);
  await archived;
}
