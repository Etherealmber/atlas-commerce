/**
 * R2 helpers for product / company images and optional archives.
 * Bucket binding: IMAGES → company-stock-images
 * Public CDN: CDN_BASE (https://cdn1.afmarbre.com) must be configured
 * as a custom domain on the R2 bucket in the Cloudflare dashboard.
 */

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB — stay well under Worker memory limits
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export function cdnBase(env: { CDN_BASE?: string }): string {
  const b = (env.CDN_BASE || 'https://cdn1.afmarbre.com').trim().replace(/\/$/, '');
  return b || 'https://cdn1.afmarbre.com';
}

export function publicImageUrl(env: { CDN_BASE?: string }, key: string): string {
  return `${cdnBase(env)}/${key.replace(/^\//, '')}`;
}

/** Safe object key: products/{productId}/{uuid}.{ext} */
export function productImageKey(productId: string | number, ext: string): string {
  const id = String(productId).replace(/[^0-9]/g, '') || '0';
  const e = (ext || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `products/${id}/${rand}.${e}`;
}

export function companyAssetKey(kind: 'logo' | 'signature' | 'stamp', ext: string): string {
  const e = (ext || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
  return `company/${kind}.${e}`;
}

function extFromMime(mime: string): string {
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  return 'jpg';
}

/**
 * Upload raw bytes to R2. Returns public CDN URL or null if R2 unavailable / invalid.
 */
export async function uploadImageBytes(
  bucket: R2Bucket | undefined,
  env: { CDN_BASE?: string },
  key: string,
  bytes: ArrayBuffer | Uint8Array,
  contentType: string
): Promise<string | null> {
  if (!bucket) return null;
  const mime = (contentType || '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_MIME.has(mime)) return null;
  const size = bytes instanceof ArrayBuffer ? bytes.byteLength : bytes.byteLength;
  if (size <= 0 || size > MAX_IMAGE_BYTES) return null;
  try {
    await bucket.put(key, bytes, {
      httpMetadata: {
        contentType: mime,
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
    return publicImageUrl(env, key);
  } catch {
    return null;
  }
}

/**
 * Accept data-URL (data:image/png;base64,...) or raw base64 + mime.
 * Returns CDN URL or null.
 */
export async function uploadDataUrlImage(
  bucket: R2Bucket | undefined,
  env: { CDN_BASE?: string },
  dataUrl: string,
  key: string
): Promise<string | null> {
  if (!bucket || !dataUrl || typeof dataUrl !== 'string') return null;
  const m = /^data:(image\/[a-z0-9+.-]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) return null;
  const mime = m[1].toLowerCase();
  if (!ALLOWED_MIME.has(mime)) return null;
  try {
    const binary = atob(m[2]);
    const len = binary.length;
    if (len > MAX_IMAGE_BYTES) return null;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return uploadImageBytes(bucket, env, key, bytes, mime);
  } catch {
    return null;
  }
}

export async function deleteR2Object(bucket: R2Bucket | undefined, key: string): Promise<void> {
  if (!bucket || !key) return;
  try {
    await bucket.delete(key);
  } catch {
    /* ignore */
  }
}

/** Extract R2 object key from a CDN URL if it matches our CDN base. */
export function keyFromCdnUrl(env: { CDN_BASE?: string }, url: string): string | null {
  if (!url) return null;
  try {
    const base = cdnBase(env).replace(/\/$/, '');
    if (url.startsWith(base + '/')) {
      return decodeURIComponent(url.slice(base.length + 1).split('?')[0]);
    }
    // Also accept common R2 public hosts / custom domains pointing at the same keys
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (
      host === 'cdn1.afmarbre.com' ||
      host.endsWith('.r2.dev') ||
      host.endsWith('.afmarbre.com')
    ) {
      const key = u.pathname.replace(/^\//, '');
      return key ? decodeURIComponent(key) : null;
    }
  } catch { /* */ }
  return null;
}

export function mimeToExt(mime: string): string {
  return extFromMime(mime);
}

export async function r2PutText(
  bucket: R2Bucket | undefined,
  key: string,
  body: string,
  contentType = 'application/json'
): Promise<boolean> {
  if (!bucket) return false;
  try {
    await bucket.put(key, body, { httpMetadata: { contentType } });
    return true;
  } catch {
    return false;
  }
}

export async function r2GetText(bucket: R2Bucket | undefined, key: string): Promise<string | null> {
  if (!bucket) return null;
  try {
    const obj = await bucket.get(key);
    if (!obj) return null;
    return await obj.text();
  } catch {
    return null;
  }
}

export function auditArchiveKey(ymd: string): string {
  return `audit/${ymd}.jsonl`;
}
