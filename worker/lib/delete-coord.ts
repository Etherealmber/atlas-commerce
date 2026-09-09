/**
 * Coordinated delete: D1 rows + R2 objects + KV cache invalidation.
 */
import { invalidateDashboardCache } from './cache';
import { keyFromCdnUrl, deleteR2Object } from './r2';

export async function deleteProductImagesFromR2(
  db: D1Database,
  images: R2Bucket | undefined,
  env: { CDN_BASE?: string },
  productId: string | number
): Promise<number> {
  let n = 0;
  try {
    const { results } = await db
      .prepare(`SELECT id, url FROM product_images WHERE product_id = ?`)
      .bind(productId)
      .all();
    for (const row of (results || []) as any[]) {
      const key = keyFromCdnUrl(env, String(row.url || ''));
      if (key) {
        await deleteR2Object(images, key);
        n++;
      }
    }
    await db.prepare(`DELETE FROM product_images WHERE product_id = ?`).bind(productId).run();
  } catch {
    /* best-effort */
  }
  // Also remove product.image_url object if CDN
  try {
    const p = await db.prepare(`SELECT image_url FROM products WHERE id = ?`).bind(productId).first() as any;
    if (p?.image_url) {
      const key = keyFromCdnUrl(env, String(p.image_url));
      if (key) {
        await deleteR2Object(images, key);
        n++;
      }
    }
  } catch {
    /* ignore */
  }
  return n;
}

export async function afterBusinessMutation(kv: KVNamespace | undefined): Promise<void> {
  await invalidateDashboardCache(kv);
}

/** List R2 objects under a prefix (for admin inventory / catalog of stored files). */
export async function listR2Prefix(
  bucket: R2Bucket | undefined,
  prefix: string,
  limit = 50
): Promise<{ key: string; size: number; uploaded: string }[]> {
  if (!bucket) return [];
  try {
    const listed = await bucket.list({ prefix, limit: Math.min(1000, limit) });
    return (listed.objects || []).map((o) => ({
      key: o.key,
      size: o.size,
      uploaded: o.uploaded?.toISOString?.() || String(o.uploaded || ''),
    }));
  } catch {
    return [];
  }
}
