/** Isolated prototype, used only by explicitly gated preview routes. */
import { decryptAgentPayload, encryptAgentPayload } from './crypto';

const MAX_IMAGE_BYTES = 1_000_000;
const MAX_IMAGE_BASE64 = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const ID = /^[a-zA-Z0-9._-]{1,80}$/;
const ACCOUNT = /^[a-f0-9]{64}$/;
const IMAGE = /^[a-f0-9]{32}$/;
const MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

type Bucket = Pick<R2Bucket, 'put' | 'get' | 'list' | 'delete'>;

function prefix(account: string, thread: string): string {
  if (!ACCOUNT.test(account) || !ID.test(thread) || thread === '.' || thread === '..') throw new Error('Invalid image context');
  return `agent-images/v1/${account}/${thread}/`;
}
function objectKey(account: string, thread: string, imageId: string): string {
  if (!IMAGE.test(imageId)) throw new Error('Invalid image id');
  return prefix(account, thread) + imageId;
}
function checkDataUrl(dataUrl: string): void {
  // Validate before decoding to keep hostile input bounded. Re-encoding rejects
  // non-canonical or malformed padding that some base64 decoders tolerate.
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl);
  if (!match || !MIME.has(match[1]) || !match[2] || match[2].length > MAX_IMAGE_BASE64) throw new Error('Invalid image');
  let bytes: string;
  try { bytes = atob(match[2]); } catch { throw new Error('Invalid image'); }
  if (bytes.length > MAX_IMAGE_BYTES || btoa(bytes) !== match[2]) throw new Error('Invalid image');
}

type UploadFence = {
  begin(account: string, thread: string, imageId: string): Promise<boolean>;
  finish(account: string, thread: string, imageId: string, removed: boolean): Promise<boolean>;
};

/**
 * Register before the R2 write. Unknown PUT outcomes leave an intent forever
 * until a safe recovery protocol resolves them. This trades liveness for safety.
 */
export async function putAgentImageDraft(bucket: Bucket, fence: UploadFence, key: string, account: string, thread: string, dataUrl: string): Promise<string> {
  checkDataUrl(dataUrl);
  const imageId = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  const path = objectKey(account, thread, imageId);
  const envelope = await encryptAgentPayload(key, `${account}:image:${imageId}`, thread, dataUrl);
  if (!await fence.begin(account, thread, imageId)) throw new Error('Conversation unavailable');
  // An exception may have an unknown outcome. Do not clear the intent.
  const written = await bucket.put(path, envelope, { httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store' } });
  if (!written) throw new Error('Upload outcome unknown');
  if (await fence.finish(account, thread, imageId, false)) return imageId;
  // The completed upload raced a tombstone: remove the exact object first.
  await bucket.delete(path);
  if (!await fence.finish(account, thread, imageId, true)) throw new Error('Upload cleanup pending');
  throw new Error('Conversation unavailable');
}

/** Caller must first authorize the account and check the conversation is active. */
export async function getAgentImageDraft(bucket: Bucket, key: string, account: string, thread: string, imageId: string): Promise<string | null> {
  const object = await bucket.get(objectKey(account, thread, imageId));
  if (!object) return null;
  // Refuse unexpected oversized objects before reading their body.
  if (object.size > 2_100_000) throw new Error('Invalid image envelope');
  const result = await decryptAgentPayload(key, `${account}:image:${imageId}`, thread, await object.text());
  checkDataUrl(result);
  return result;
}

/**
 * Deletes at most maxPages pages from a tombstoned thread. Each pass starts at
 * the prefix, so retries don't rely on a cursor after deletion. `complete`
 * requires a subsequent empty listing. This cannot prevent concurrent uploads;
 * a production protocol must fence writers before calling it.
 */
export async function deleteAgentImagesDraft(bucket: Bucket, account: string, thread: string, maxPages = 10): Promise<{ complete: boolean; deleted: number }> {
  const scope = prefix(account, thread);
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) throw new Error('Invalid page limit');
  let deleted = 0;
  for (let page = 0; page < maxPages; page++) {
    const result = await bucket.list({ prefix: scope, limit: 100 });
    const keys = result.objects.map(object => object.key);
    if (keys.some(key => !key.startsWith(scope))) throw new Error('Invalid listing');
    if (!keys.length) {
      if (result.truncated) throw new Error('Incomplete listing');
      return { complete: true, deleted };
    }
    await bucket.delete(keys);
    deleted += keys.length;
  }
  return { complete: false, deleted };
}
