/**
 * Consistent API response shape for Atlas Worker (web + Capacitor + future partners).
 * { success: true, data?, message? } | { success: false, error, code?, details? }
 */

import type { Context } from 'hono';
import { looksLikeDbError } from './errors';

export type ApiFailCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'VALIDATION'
  | 'INTERNAL'
  | 'SERVICE_UNAVAILABLE';

const STATUS: Record<ApiFailCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  VALIDATION: 422,
  INTERNAL: 500,
  SERVICE_UNAVAILABLE: 503,
};

export function apiOk(c: Context, data?: unknown, message?: string, status = 200) {
  const body: Record<string, unknown> = { success: true };
  if (data !== undefined) body.data = data;
  if (message) body.message = message;
  return c.json(body, status as any);
}

export function apiFail(
  c: Context,
  error: string,
  code: ApiFailCode = 'BAD_REQUEST',
  details?: unknown,
  statusOverride?: number,
) {
  const status = statusOverride ?? STATUS[code] ?? 400;
  // Never return raw database / driver messages to clients
  let safeError = error || 'Erreur';
  if (looksLikeDbError(safeError) || code === 'INTERNAL') {
    if (looksLikeDbError(safeError)) {
      console.error('[apiFail-db-leak]', safeError.slice(0, 300));
      safeError = 'Erreur interne — réessayez plus tard';
    }
  }
  const body: Record<string, unknown> = { success: false, error: safeError, code };
  if (details !== undefined && code !== 'INTERNAL') body.details = details;
  if (code === 'RATE_LIMITED' && details && typeof details === 'object' && details !== null && 'retry_after' in details) {
    body.retry_after = (details as any).retry_after;
  }
  return c.json(body, status as any);
}
