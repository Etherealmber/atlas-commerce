/** Offline building block for a future operator-controlled D1 -> private R2 copy.
 * Not wired to an endpoint or cron: a cutover also needs a snapshot, reconciliation,
 * retention configuration and a durable ongoing tail. Never deletes source rows. */
type Source = 'audit_log' | 'api_log';
type BackfillEnv = { JOURNAL_ARCHIVE?: R2Bucket; IMAGES?: R2Bucket; JOURNAL_ENCRYPTION_KEY?: string };
type Row = Record<string, unknown> & { id: number };
const encoder = new TextEncoder();
const magic = encoder.encode('JBF1');

async function encryptionKey(env: BackfillEnv): Promise<CryptoKey> {
  if (!env.JOURNAL_ARCHIVE || env.JOURNAL_ARCHIVE === env.IMAGES) throw new Error('A separate private journal bucket is required');
  let raw: Uint8Array;
  try { raw = Uint8Array.from(atob(env.JOURNAL_ENCRYPTION_KEY || ''), c => c.charCodeAt(0)); }
  catch { throw new Error('Invalid journal encryption key'); }
  if (raw.length !== 32) throw new Error('Invalid journal encryption key');
  return crypto.subtle.importKey('raw', new Uint8Array(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
function objectPath(namespace: string, source: Source, id: number): string {
  if (!/^[a-z0-9-]{8,64}$/.test(namespace) || !Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid source namespace or ID');
  return `journal-backfill/v1/${namespace}/${source}/${id}.journal`;
}
async function decode(key: CryptoKey, path: string, bytes: Uint8Array): Promise<string> {
  if (bytes.length < 32 || magic.some((byte, i) => bytes[i] !== byte)) throw new Error('Invalid backfill object');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(4, 16), additionalData: encoder.encode(path) }, key, bytes.slice(16));
  return new TextDecoder().decode(plain);
}

/** One bounded page; checkpoint only the returned cursor after the entire page succeeds.
 * A unique persistent namespace must identify the original database, not a restore. */
export async function copyJournalPage(env: BackfillEnv, db: D1Database, input: { namespace: string; source: Source; afterId: number; throughId: number; limit?: number }) {
  const { namespace, source, afterId, throughId } = input;
  if (source !== 'audit_log' && source !== 'api_log') throw new Error('Invalid journal source');
  objectPath(namespace, source, 1);
  if (!Number.isSafeInteger(afterId) || afterId < 0 || !Number.isSafeInteger(throughId) || throughId < afterId) throw new Error('Invalid journal cursor');
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid page size');
  const key = await encryptionKey(env);
  const result = await db.prepare(`SELECT * FROM ${source} WHERE id > ? AND id <= ? ORDER BY id ASC LIMIT ?`).bind(afterId, throughId, limit).all<Row>();
  const rows = result.results || [];
  let cursor = afterId;
  for (const row of rows) {
    if (!Number.isSafeInteger(row.id) || row.id <= cursor || row.id > throughId) throw new Error('Invalid source row order');
    const path = objectPath(namespace, source, row.id);
    const payload = JSON.stringify({ version: 1, source, row });
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(path) }, key, encoder.encode(payload)));
    const bytes = new Uint8Array(16 + ciphertext.length);
    bytes.set(magic); bytes.set(iv, 4); bytes.set(ciphertext, 16);
    const created = await env.JOURNAL_ARCHIVE!.put(path, bytes, { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'no-store' } });
    // A successful PUT alone is not a verified copy. Read and authenticate it
    // before allowing the caller to checkpoint, including on retries.
    const existing = await env.JOURNAL_ARCHIVE!.get(path);
    if (!existing || await decode(key, path, new Uint8Array(await existing.arrayBuffer())) !== payload) {
      throw new Error(created ? 'Journal read-back differs from source' : 'Existing journal object differs from source');
    }
    cursor = row.id;
  }
  return { cursor, copied: rows.length, done: rows.length < limit || cursor === throughId };
}

/** Re-read and authenticate previously copied source rows without modifying
 * either store. This is one page only: an operator still needs a stable source
 * snapshot, full-table accounting and a separately tested restore before any
 * cutover or D1 deletion. */
export async function verifyJournalPage(env: BackfillEnv, db: D1Database, input: { namespace: string; source: Source; afterId: number; throughId: number; limit?: number }) {
  const { namespace, source, afterId, throughId } = input;
  if (source !== 'audit_log' && source !== 'api_log') throw new Error('Invalid journal source');
  objectPath(namespace, source, 1);
  if (!Number.isSafeInteger(afterId) || afterId < 0 || !Number.isSafeInteger(throughId) || throughId < afterId) throw new Error('Invalid journal cursor');
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid page size');
  const key = await encryptionKey(env);
  const result = await db.prepare(`SELECT * FROM ${source} WHERE id > ? AND id <= ? ORDER BY id ASC LIMIT ?`).bind(afterId, throughId, limit).all<Row>();
  const rows = result.results || [];
  let cursor = afterId;
  for (const row of rows) {
    if (!Number.isSafeInteger(row.id) || row.id <= cursor || row.id > throughId) throw new Error('Invalid source row order');
    const path = objectPath(namespace, source, row.id);
    const archived = await env.JOURNAL_ARCHIVE!.get(path);
    const expected = JSON.stringify({ version: 1, source, row });
    if (!archived || await decode(key, path, new Uint8Array(await archived.arrayBuffer())) !== expected) throw new Error('Journal verification failed');
    cursor = row.id;
  }
  return { cursor, verified: rows.length, done: rows.length < limit || cursor === throughId };
}
