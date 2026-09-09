/**
 * Phase 3: coordinated delete across D1 + R2 + KV.
 * Always remove CDN objects when D1 image rows are deleted.
 */

import { invalidateDashboardCache } from './cache';
import { deleteR2Object, keyFromCdnUrl } from './r2';

type EnvLike = {
  DB: D1Database;
  CACHE?: KVNamespace;
  IMAGES?: R2Bucket;
  CDN_BASE?: string;
};

/** Delete all product_images rows for a product and their R2 objects. */
export async function deleteProductImagesCascade(
  env: EnvLike,
  productId: string | number
): Promise<{ removed_db: number; removed_r2: number }> {
  const id = String(productId);
  const { results } = await env.DB.prepare(
    `SELECT id, url FROM product_images WHERE product_id = ?`
  ).bind(id).all();
  const rows = (results || []) as { id: number; url: string }[];
  let removed_r2 = 0;
  for (const row of rows) {
    const key = keyFromCdnUrl(env, String(row.url || ''));
    if (key) {
      await deleteR2Object(env.IMAGES, key);
      removed_r2 += 1;
    }
    // Also try products/{id}/ prefix cleanup is done per-object via key
  }
  // Remove primary image_url on product if it pointed at CDN
  const product = await env.DB.prepare(`SELECT image_url FROM products WHERE id = ?`).bind(id).first() as any;
  if (product?.image_url) {
    const key = keyFromCdnUrl(env, String(product.image_url));
    if (key) {
      await deleteR2Object(env.IMAGES, key);
      removed_r2 += 1;
    }
  }
  const del = await env.DB.prepare(`DELETE FROM product_images WHERE product_id = ?`).bind(id).run();
  const removed_db = Number(del.meta?.changes || rows.length);
  return { removed_db, removed_r2 };
}

/** Full product hard-delete: images (R2+D1) → product row → KV dashboard. */
export async function deleteProductCascade(
  env: EnvLike,
  productId: string | number
): Promise<{ removed_db: number; removed_r2: number }> {
  const img = await deleteProductImagesCascade(env, productId);
  await env.DB.prepare(`DELETE FROM products WHERE id = ?`).bind(String(productId)).run();
  await invalidateDashboardCache(env.CACHE);
  return img;
}

/** Bulk product delete with image cleanup. */
export async function deleteProductsCascade(
  env: EnvLike,
  ids: number[]
): Promise<{ count: number; removed_r2: number }> {
  let removed_r2 = 0;
  for (const id of ids) {
    const r = await deleteProductImagesCascade(env, id);
    removed_r2 += r.removed_r2;
  }
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    await env.DB.prepare(`DELETE FROM products WHERE id IN (${placeholders})`).bind(...ids).run();
  }
  await invalidateDashboardCache(env.CACHE);
  return { count: ids.length, removed_r2 };
}

/** Delete a single image row + R2 object. */
export async function deleteOneImageCascade(
  env: EnvLike,
  productId: string | number,
  imageId: string | number
): Promise<boolean> {
  const existing = await env.DB.prepare(
    `SELECT * FROM product_images WHERE id = ? AND product_id = ?`
  ).bind(imageId, productId).first() as any;
  if (!existing) return false;
  const key = keyFromCdnUrl(env, String(existing.url || ''));
  if (key) await deleteR2Object(env.IMAGES, key);
  await env.DB.prepare(`DELETE FROM product_images WHERE id = ? AND product_id = ?`)
    .bind(imageId, productId).run();
  return true;
}
