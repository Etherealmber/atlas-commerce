/** Optional, best-effort shadow of newly committed business-audit rows.
 * D1 stays authoritative; this is not a durable queue or a cutover. */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Env } from '../env';
import { inDemoScope } from './dataScope';
import { copyJournalPage } from './journalBackfill';
import { resolveRootDb } from './schema';

type Scope = { env: Pick<Env, 'JOURNAL_ARCHIVE' | 'IMAGES' | 'JOURNAL_ENCRYPTION_KEY'>; root: object | null; namespace: string; ctx: { waitUntil(promise: Promise<unknown>): void } };
const storage = new AsyncLocalStorage<Scope>();

/** Wrap only request-owned downstream work, after D1 target routing is known. */
export function withAuditShadow<T>(env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }, fn: () => T): T {
  if (env.JOURNAL_AUDIT_SHADOW !== '1' || env.ATLAS_DEMO === '1' || inDemoScope()) return fn();
  const root = resolveRootDb(env.DB);
  const targetRoot = resolveRootDb(env.DB_TARGET);
  const source = String(env.JOURNAL_AUDIT_NAMESPACE || '');
  const target = String(env.JOURNAL_AUDIT_TARGET_NAMESPACE || '');
  const namespace = targetRoot && root === targetRoot ? target : source;
  // A target database and source need distinct namespaces, including after a
  // cutover, to prevent an unrelated restored row from colliding with an ID.
  if (!root || !/^[a-z0-9-]{8,64}$/.test(namespace) || (targetRoot && (!target || !source || target === source))) {
    console.error('audit_shadow_configuration_invalid');
    return fn();
  }
  const archiveEnv = { JOURNAL_ARCHIVE: env.JOURNAL_ARCHIVE, IMAGES: env.IMAGES, JOURNAL_ENCRYPTION_KEY: env.JOURNAL_ENCRYPTION_KEY };
  return storage.run({ env: archiveEnv, root, namespace, ctx }, fn);
}

export function enqueueAuditShadow(db: D1Database, id: unknown): void {
  const scope = storage.getStore();
  if (!scope || inDemoScope() || resolveRootDb(db) !== scope.root) return;
  const rowId = Number(id);
  if (!Number.isSafeInteger(rowId) || rowId <= 0) { console.error('audit_shadow_missing_id'); return; }
  try {
    const task = copyJournalPage(scope.env, db, { namespace: scope.namespace, source: 'audit_log', afterId: rowId - 1, throughId: rowId, limit: 1 })
      .then(result => { if (result.copied !== 1 || result.cursor !== rowId) throw new Error('Missing audit source row'); })
      .catch(() => { console.error('audit_shadow_copy_failed'); });
    scope.ctx.waitUntil(task);
  } catch { console.error('audit_shadow_schedule_failed'); }
}
