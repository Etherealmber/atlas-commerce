/** Buffered R2 journal candidate. Capture is acknowledged only after the
 * encrypted item and alarm are committed by the Durable Object. */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Env } from '../env';
import { inDemoScope } from './dataScope';
import { normalizeApiPath, type ApiLogRow } from './apiLog';
import { resolveRootDb } from './schema';
import { supabaseJournalConfig } from './journalSupabase';

const scope = new AsyncLocalStorage<{ env: Env; root: object | null }>();
export function withBufferedJournal<T>(env: Env, fn: () => T): T {
  if (env.JOURNAL_ARCHIVE_MODE !== 'buffered' && env.JOURNAL_ARCHIVE_MODE !== 'supabase' || env.ATLAS_DEMO === '1' || inDemoScope()) return fn();
  return scope.run({ env, root: resolveRootDb(env.DB) }, fn);
}

export async function enqueueBufferedJournal(env: Env, kind: 'api' | 'audit', data: unknown): Promise<void> {
  if (!env.JOURNAL_BUFFER) throw new Error('Journal buffer configuration missing');
  if (env.JOURNAL_ARCHIVE_MODE === 'supabase') supabaseJournalConfig(env);
  else if (!env.JOURNAL_ARCHIVE || env.JOURNAL_ARCHIVE === env.IMAGES) throw new Error('Journal buffer configuration missing');
  let secret: Uint8Array;
  try { secret = Uint8Array.from(atob(env.JOURNAL_ENCRYPTION_KEY || ''), c => c.charCodeAt(0)); } catch { throw new Error('Journal encryption key invalid'); }
  if (secret.length !== 32) throw new Error('Journal encryption key invalid');
  const now = new Date(); const iso = now.toISOString();
  const path = `${kind}-journal/v1/${iso.slice(0, 10)}/${iso.replace(/[:.]/g, '-')}-${crypto.randomUUID()}.journal`;
  const key = await crypto.subtle.importKey('raw', new Uint8Array(secret), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const content = new TextEncoder().encode(JSON.stringify({ version: 1, created_at: iso, ...data as object }));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(path) }, key, content));
  const bytes = new Uint8Array(16 + encrypted.length); bytes.set(new TextEncoder().encode('AJR1')); bytes.set(iv, 4); bytes.set(encrypted, 16);
  if (bytes.length > 100_000) throw new Error('Journal event too large');
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
  const stub = env.JOURNAL_BUFFER.get(env.JOURNAL_BUFFER.idFromName('journal-v1'));
  // Reuse exactly the same id and ciphertext if the acknowledgement is lost.
  // A new id here would duplicate an event that was already accepted.
  const body = JSON.stringify({ path, ciphertext: btoa(binary), destination: env.JOURNAL_ARCHIVE_MODE === 'supabase' ? 'supabase' : 'r2' });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await stub.fetch('https://journal-buffer/enqueue', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      if (response.ok) return;
      if (response.status < 500) throw new Error('Journal buffer rejected event');
    } catch (error) {
      if (error instanceof Error && error.message === 'Journal buffer rejected event') throw error;
    }
  }
  throw new Error('Journal buffer unavailable');
}

export async function enqueueBufferedApi(env: Env, row: ApiLogRow): Promise<void> {
  await enqueueBufferedJournal(env, 'api', { ...row, path: normalizeApiPath(row.path) });
}

/** Returns false only when this request is not using the buffered mode. */
export async function enqueueBufferedAudit(db: D1Database, row: Record<string, unknown>): Promise<boolean> {
  const current = scope.getStore();
  if (!current || inDemoScope()) return false;
  if (!current.root || resolveRootDb(db) !== current.root) throw new Error('Journal database scope mismatch');
  await enqueueBufferedJournal(current.env, 'audit', row);
  return true;
}
