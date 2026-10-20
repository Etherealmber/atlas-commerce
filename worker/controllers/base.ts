/**
 * Controller layer helpers — thin handlers that:
 * 1. Validate input
 * 2. Call services
 * 3. Map results / errors to HTTP
 *
 * Routes register controllers; services own business rules; repositories own SQL.
 */

import type { Context } from 'hono';
import { apiFail, apiOk } from '../lib/api-response';
import { AppError, toClientError } from '../lib/errors';
import type { FieldErrors } from '../lib/validate';

export type ControllerResult<T = unknown> =
  | { ok: true; data?: T; message?: string; status?: number }
  | { ok: false; error: string; code?: string; details?: unknown; status?: number };

/** Run a controller function and always return a safe JSON response. */
export async function runController(
  c: Context,
  fn: () => Promise<ControllerResult>,
) {
  try {
    const result = await fn();
    if (result.ok) {
      return apiOk(c, result.data, result.message, result.status ?? 200);
    }
    const code = (result.code as any) || 'BAD_REQUEST';
    return apiFail(c, result.error, code, result.details, result.status);
  } catch (err) {
    const safe = toClientError(err);
    return apiFail(c, safe.error, safe.code, safe.details, safe.status);
  }
}

/** Throw validation AppError from FieldErrors map. */
export function rejectValidation(errors: FieldErrors): never {
  const first = Object.values(errors).find(Boolean) || 'Données invalides';
  throw new AppError('VALIDATION', first, errors);
}

/** Require a non-empty JSON body object. */
export async function readJsonBody<T extends Record<string, unknown> = Record<string, unknown>>(
  c: Context,
): Promise<T> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new AppError('BAD_REQUEST', 'Corps JSON invalide');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError('BAD_REQUEST', 'Corps JSON invalide');
  }
  return body as T;
}
