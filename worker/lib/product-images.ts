import { cdnBase, publicImageUrl, isNormalizedProductKey } from './r2';
import { normalizeProductImage, PRODUCT_IMAGE_MAX_BYTES } from './product-image-codec';

type ImageEnv = { IMAGES?: R2Bucket; CDN_BASE?: string };
const NORMALIZED = 'square-webp-v1';

export class ProductImageError extends Error {
  constructor(public code: string) { super(code); }
}

function ownedKey(env: ImageEnv, raw: string): string | null {
  try {
    const base = new URL(cdnBase(env) + '/');
    const url = new URL(raw);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.username || url.password || url.hash) return null;
    const key = decodeURIComponent(url.pathname.slice(base.pathname.length));
    if (!/^(products\/|pending\/mobile\/|product-requests\/)/.test(key) || key.includes('..') || key.includes('\\')) return null;
    return key;
  } catch { return null; }
}

export function isNormalizedProductUrl(env: ImageEnv, url: string): boolean {
  const key = ownedKey(env, url);
  return !!key && isNormalizedProductKey(key);
}

function decodeImageData(raw: string): Uint8Array {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(raw.trim());
  if (!m || m[2].length > Math.ceil(PRODUCT_IMAGE_MAX_BYTES / 3) * 4) throw new ProductImageError('INVALID_IMAGE');
  try {
    const bin = atob(m[2]);
    if (!bin.length || bin.length > PRODUCT_IMAGE_MAX_BYTES) throw new Error();
    return Uint8Array.from(bin, c => c.charCodeAt(0));
  } catch { throw new ProductImageError('INVALID_IMAGE'); }
}

/** Only reads this deployment's R2 bucket; never fetches arbitrary URLs. */
export async function normalizeProductImageReference(env: ImageEnv, productId: number | string, raw: string): Promise<{ url: string; unchanged: boolean }> {
  if (!env.IMAGES) throw new ProductImageError('STORAGE_UNAVAILABLE');
  let input: Uint8Array;
  if (raw.startsWith('data:')) {
    input = decodeImageData(raw);
  } else {
    const key = ownedKey(env, raw);
    if (!key) throw new ProductImageError('UNSUPPORTED_SOURCE');
    const obj = await env.IMAGES.get(key);
    if (!obj) throw new ProductImageError('SOURCE_MISSING');
    if (isNormalizedProductKey(key) && obj.customMetadata?.productImage === NORMALIZED && obj.httpMetadata?.contentType === 'image/webp') {
      return { url: publicImageUrl(env, key), unchanged: true };
    }
    if (obj.size > PRODUCT_IMAGE_MAX_BYTES) throw new ProductImageError('INVALID_IMAGE');
    input = new Uint8Array(await obj.arrayBuffer());
  }
  let output: Uint8Array;
  try { output = await normalizeProductImage(input); } catch { throw new ProductImageError('INVALID_IMAGE'); }
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(input).buffer))).map(x => x.toString(16).padStart(2, '0')).join('');
  const id = String(productId).replace(/[^0-9]/g, '') || '0';
  const key = `products/${id}/normalized/v1/${digest}.webp`;
  await env.IMAGES.put(key, output, {
    httpMetadata: { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' },
    customMetadata: { productImage: NORMALIZED },
  });
  return { url: publicImageUrl(env, key), unchanged: false };
}

/** One bounded, restartable page. Original R2 objects are never removed. */
export async function migrateProductImagePage(db: D1Database, env: ImageEnv, phase: 'images' | 'products', after: number, limit: number) {
  const sql = phase === 'images'
    ? `SELECT id, product_id, url FROM product_images WHERE id > ? ORDER BY id LIMIT ?`
    : `SELECT id, id AS product_id, image_url AS url FROM products WHERE id > ? AND image_url IS NOT NULL AND image_url != '' ORDER BY id LIMIT ?`;
  const rows = (await db.prepare(sql).bind(after, limit).all()).results as any[];
  let updated = 0, unchanged = 0, failed = 0;
  const failures: { id: number; code: string }[] = [];
  for (const row of rows) {
    try {
      const old = String(row.url || '');
      if (!old) { unchanged++; continue; }
      const result = await normalizeProductImageReference(env, row.product_id, old);
      if (result.url === old) { unchanged++; continue; }
      if (phase === 'images') {
        const changes = await db.batch([
          db.prepare('UPDATE product_images SET url = ? WHERE id = ? AND product_id = ? AND url = ?').bind(result.url, row.id, row.product_id, old),
          db.prepare('UPDATE products SET image_url = ? WHERE id = ? AND image_url = ? AND EXISTS (SELECT 1 FROM product_images WHERE id = ? AND product_id = ? AND url = ?)').bind(result.url, row.product_id, old, row.id, row.product_id, result.url),
        ]);
        if (!changes[0].meta?.changes) { failures.push({ id: row.id, code: 'CONFLICT' }); failed++; continue; }
      } else {
        const change = await db.prepare('UPDATE products SET image_url = ? WHERE id = ? AND image_url = ?').bind(result.url, row.id, old).run();
        if (!change.meta?.changes) { failures.push({ id: row.id, code: 'CONFLICT' }); failed++; continue; }
      }
      updated++;
    } catch (e) {
      failures.push({ id: Number(row.id), code: e instanceof ProductImageError ? e.code : 'STORAGE_OR_DATABASE_ERROR' });
      failed++;
    }
  }
  return { phase, updated, unchanged, failed, failures, next_after: rows.length === limit ? Number(rows[rows.length - 1].id) : null };
}
