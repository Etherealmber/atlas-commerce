/** Optional encrypted shadow archive. D1 stays authoritative until a verified cutover.
 * Use a dedicated PRIVATE R2 bucket with a 30-day lifecycle rule, not IMAGES. */
import type { ApiLogRow } from './apiLog';
import { normalizeApiPath } from './apiLog';

const PREFIX = 'api-journal/v1/';
const RETENTION_MS = 30 * 86400_000;
const MAGIC = new TextEncoder().encode('AJR1');
type ArchiveEnv = { IMAGES?: R2Bucket; JOURNAL_ARCHIVE?: R2Bucket; JOURNAL_ARCHIVE_MODE?: string; JOURNAL_ENCRYPTION_KEY?: string };

function enabled(env: ArchiveEnv): boolean {
  if (env.JOURNAL_ARCHIVE_MODE !== 'shadow' && env.JOURNAL_ARCHIVE_MODE !== 'r2') return false;
  if (!env.JOURNAL_ARCHIVE) throw new Error('Journal archive bucket missing');
  if (env.JOURNAL_ARCHIVE === env.IMAGES) throw new Error('Journal archive requires a separate private bucket');
  return true;
}
async function keyFromSecret(env: ArchiveEnv): Promise<CryptoKey> {
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(String(env.JOURNAL_ENCRYPTION_KEY || '')), ch => ch.charCodeAt(0)); }
  catch { throw new Error('Journal key must be base64-encoded 32 bytes'); }
  if (bytes.length !== 32) throw new Error('Journal key must be base64-encoded 32 bytes');
  return crypto.subtle.importKey('raw', new Uint8Array(bytes), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Immutable, collision-resistant key; no user identifiers or URL in object names. */
function makeKey(date: Date): string {
  const iso = date.toISOString();
  return `${PREFIX}${iso.slice(0, 10)}/${iso.replace(/[:.]/g, '-')}-${crypto.randomUUID()}.journal`;
}
const KEY_FORMAT = /^api-journal\/v1\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)-[0-9a-f-]{36}\.journal$/;
function validKey(path: string, now = Date.now()): boolean {
  const m = KEY_FORMAT.exec(path);
  if (!m || !m[2].startsWith(m[1])) return false;
  const stamp = m[2].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z');
  const parsed = Date.parse(stamp);
  return Number.isFinite(parsed) && parsed >= now - RETENTION_MS && parsed <= now + 60000;
}

export async function archiveApiCall(env: ArchiveEnv, row: ApiLogRow, at = new Date()): Promise<boolean> {
  if (!enabled(env)) return false;
  const key = await keyFromSecret(env);
  const path = makeKey(at);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  // Only the already-sanitized API journal schema: no auth headers, bodies or query strings.
  const payload = new TextEncoder().encode(JSON.stringify({ version: 1, created_at: at.toISOString(), method: row.method, path: normalizeApiPath(row.path), status: row.status, ms: row.ms, username: row.username, role: row.role, ip: row.ip, ua: row.ua, request_id: row.request_id, surface: row.surface, country: row.country, city: row.city, region: row.region, asn: row.asn, as_org: row.as_org }));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(path) }, key, payload));
  const bytes = new Uint8Array(16 + ciphertext.length);
  bytes.set(MAGIC); bytes.set(iv, 4); bytes.set(ciphertext, 16);
  await env.JOURNAL_ARCHIVE!.put(path, bytes, { httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'no-store' }, customMetadata: { format: 'AJR1' } });
  if (env.JOURNAL_ARCHIVE_MODE === 'r2') {
    // Before the caller skips its D1 fallback, check that the exact encrypted
    // object can be retrieved. This is not a durable retry queue or a cutover.
    const stored = await env.JOURNAL_ARCHIVE!.get(path);
    if (!stored) throw new Error('Journal read-back missing');
    const actual = new Uint8Array(await stored.arrayBuffer());
    if (actual.length !== bytes.length || actual.some((value, i) => value !== bytes[i])) {
      throw new Error('Journal read-back differs');
    }
  }
  return true;
}

export async function readArchivedApiCall(env: ArchiveEnv, path: string, now = Date.now()): Promise<unknown | null> {
  if (!enabled(env)) throw new Error('Journal archive disabled');
  if (!validKey(path, now)) return null;
  const key = await keyFromSecret(env);
  const object = await env.JOURNAL_ARCHIVE!.get(path);
  if (!object) return null;
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.length < 32 || MAGIC.some((v, i) => bytes[i] !== v)) throw new Error('Invalid journal object');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(4, 16), additionalData: new TextEncoder().encode(path) }, key, bytes.slice(16));
  return JSON.parse(new TextDecoder().decode(plain));
}

/** Limited listing; callers must provide a day, no unbounded cross-month scan. */
export async function listArchivedApiCalls(env: ArchiveEnv, day: string, cursor?: string, now = Date.now()) {
  if (!enabled(env)) throw new Error('Journal archive disabled');
  const parsed = Date.parse(`${day}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== day || parsed + 86400_000 <= now - RETENTION_MS || parsed > now + 86400_000) throw new Error('Invalid archive date');
  const result = await env.JOURNAL_ARCHIVE!.list({ prefix: `${PREFIX}${day}/`, limit: 100, ...(cursor ? { cursor } : {}) });
  return { keys: result.objects.map(o => o.key).filter(k => validKey(k, now)), cursor: result.truncated ? result.cursor : null };
}
