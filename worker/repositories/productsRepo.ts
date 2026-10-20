/**
 * Products repository — all product SQL lives here.
 * Never return raw driver errors; wrap as AppError INTERNAL.
 */
import type { Env } from '../env';
import { AppError } from '../lib/errors';
import { searchProducts as ftsSearch } from '../lib/reliability';

export type ProductRow = Record<string, unknown>;

export async function listProducts(
  env: Env,
  opts: { q?: string; limit?: number; offset?: number } = {},
): Promise<ProductRow[]> {
  const limit = Math.min(Math.max(1, opts.limit ?? 100), 500);
  const offset = Math.max(0, opts.offset ?? 0);
  const q = (opts.q || '').trim();

  try {
    if (q) {
      const rows = await ftsSearch(env.DB, q, limit + offset);
      return rows.slice(offset, offset + limit) as ProductRow[];
    }
    const { results } = await env.DB.prepare(
      `SELECT id, name, sku, barcode, quantity, price, cost, category, image_url, updated_at
       FROM products
       ORDER BY name ASC
       LIMIT ? OFFSET ?`,
    )
      .bind(limit, offset)
      .all();
    return (results || []) as ProductRow[];
  } catch (e) {
    console.error('[productsRepo.listProducts]', e);
    throw new AppError('INTERNAL');
  }
}

export async function getProductById(env: Env, id: number): Promise<ProductRow | null> {
  if (!Number.isFinite(id) || id <= 0) throw new AppError('BAD_REQUEST', 'Identifiant produit invalide');
  try {
    const row = await env.DB.prepare(
      `SELECT * FROM products WHERE id = ? LIMIT 1`,
    )
      .bind(id)
      .first();
    return (row as ProductRow) || null;
  } catch (e) {
    console.error('[productsRepo.getProductById]', e);
    throw new AppError('INTERNAL');
  }
}
