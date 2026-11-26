import { writeApiLog, type ApiLogRow } from './apiLog';
import { archiveApiCall } from './journalArchive';
import type { Env } from '../env';

/** R2-first mode falls back to D1 if the encrypted write is unavailable.
 * Shadow remains D1-authoritative; idle QR polling is excluded from D1. */
export async function recordApiJournal(env: Env, db: D1Database, row: ApiLogRow, idle: boolean): Promise<void> {
  if (env.JOURNAL_ARCHIVE_MODE === 'r2') {
    if (idle) return;
    try {
      if (await archiveApiCall(env, row)) return;
    } catch { console.error('journal_archive_write_failed'); }
    await writeApiLog(db, row);
    return;
  }
  const archived = archiveApiCall(env, row).catch(() => { console.error('journal_archive_write_failed'); });
  if (!idle) await writeApiLog(db, row);
  await archived;
}
