/** Offline building block only. Not attached to routes, cron, or deployment.
 * Never deletes source rows. Cross-store shadow duplicates require reconciliation
 * before this can be used against production. */
import type { Env } from '../env';
import { journalRpc } from './journalSupabase';

type Source = 'audit_log' | 'api_log';
type Row = Record<string, unknown> & { id: number; created_at: unknown };
type Input = { namespace: string; source: Source; afterId: number; throughId: number; cutoff: string; limit?: number };

/** One ID-bounded page from a fixed snapshot watermark. Return a cursor only
 * after the entire batch has been acknowledged. Replaying an acknowledged page
 * uses the same keys. No checkpoint or production scheduling is provided here. */
export async function copyD1JournalPageToSupabase(env: Env, db: D1Database, input: Input) {
  const { namespace, source, afterId, throughId, cutoff } = input;
  const limit = input.limit ?? 25;
  if (!/^[a-z0-9-]{8,64}$/.test(namespace) || (source !== 'api_log' && source !== 'audit_log')) throw new Error('Invalid journal source');
  if (!Number.isSafeInteger(afterId) || afterId < 0 || !Number.isSafeInteger(throughId) || throughId < afterId || !Number.isInteger(limit) || limit < 1 || limit > 25) throw new Error('Invalid journal page');
  const cutoffMs = Date.parse(cutoff);
  if (!Number.isFinite(cutoffMs) || new Date(cutoffMs).toISOString() !== cutoff) throw new Error('Invalid cutoff');
  const result = await db.prepare(`SELECT * FROM ${source} WHERE id > ? AND id <= ? ORDER BY id ASC LIMIT ?`).bind(afterId, throughId, limit).all<Row>();
  const rows = result.results || [];
  let cursor = afterId;
  const events: { p_key: string; p_kind: 'api' | 'audit'; p_data: Record<string, unknown> }[] = [];
  for (const row of rows) {
    if (!Number.isSafeInteger(row.id) || row.id <= cursor || row.id > throughId) throw new Error('Invalid source row order');
    cursor = row.id;
    if (typeof row.created_at !== 'string') throw new Error('Invalid source timestamp');
    // SQLite datetime('now') is UTC; accept explicit ISO UTC timestamps too.
    const stamp = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(row.created_at) ? row.created_at.replace(' ', 'T') + 'Z' : row.created_at;
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(stamp)) throw new Error('Invalid source timestamp');
    const at = Date.parse(stamp);
    if (!Number.isFinite(at)) throw new Error('Invalid source timestamp');
    if (at < cutoffMs) continue;
    events.push({ p_key: `d1-journal/v1/${namespace}/${source}/${row.id}`, p_kind: source === 'api_log' ? 'api' : 'audit', p_data: { ...row, created_at: new Date(at).toISOString() } });
  }
  if (events.length) {
    if (new TextEncoder().encode(JSON.stringify({ p_items: events })).length > 500_000) throw new Error('Journal batch too large; reduce page size');
    const ack = await journalRpc(env, 'atlas_journal_ingest_batch', { p_items: events });
    if (ack?.accepted !== true || ack.count !== events.length) throw new Error('Journal acknowledgement missing');
  }
  return { cursor, scanned: rows.length, submitted: events.length, expired: rows.length - events.length, done: rows.length < limit || cursor === throughId };
}
