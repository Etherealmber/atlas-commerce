/**
 * Products service — business rules; no Hono Context.
 */
import type { Env } from '../env';
import { AppError } from '../lib/errors';
import * as productsRepo from '../repositories/productsRepo';
import { requireString, optionalString, type FieldErrors } from '../lib/validate';

export async function listProductsSafe(
  env: Env,
  query: { q?: string; limit?: string | number; offset?: string | number },
) {
  const limit = Number(query.limit ?? 100);
  const offset = Number(query.offset ?? 0);
  if (!Number.isFinite(limit) || limit < 1 || limit > 500) {
    throw new AppError('VALIDATION', 'Paramètre limit invalide (1–500)');
  }
  if (!Number.isFinite(offset) || offset < 0) {
    throw new AppError('VALIDATION', 'Paramètre offset invalide');
  }
  const q = typeof query.q === 'string' ? query.q.slice(0, 120) : undefined;
  return productsRepo.listProducts(env, { q, limit, offset });
}

export async function getProductSafe(env: Env, idRaw: string) {
  const id = Number(idRaw);
  if (!Number.isFinite(id) || id <= 0) {
    throw new AppError('VALIDATION', 'Identifiant produit invalide');
  }
  const row = await productsRepo.getProductById(env, id);
  if (!row) throw new AppError('NOT_FOUND', 'Produit introuvable');
  return row;
}

/** Validate product write payload before any DB hit. */
export function validateProductInput(body: Record<string, unknown>): FieldErrors {
  const errors: FieldErrors = {};
  const nameErr = requireString(body.name, 'Nom', { min: 1, max: 200 });
  if (nameErr) errors.name = nameErr;
  const skuErr = optionalString(body.sku, 'SKU', { max: 64 });
  if (skuErr) errors.sku = skuErr;
  if (body.price != null && (typeof body.price !== 'number' || body.price < 0)) {
    errors.price = 'Prix invalide';
  }
  if (body.quantity != null && (typeof body.quantity !== 'number' || body.quantity < 0)) {
    errors.quantity = 'Quantité invalide';
  }
  return errors;
}
