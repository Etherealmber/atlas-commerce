/**
 * Safe application errors — never leak SQL / D1 / stack traces to clients.
 */

export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'VALIDATION'
  | 'INTERNAL'
  | 'SERVICE_UNAVAILABLE'
  | 'DB_CORRUPT'
  | 'TIMEOUT';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  VALIDATION: 422,
  INTERNAL: 500,
  SERVICE_UNAVAILABLE: 503,
  DB_CORRUPT: 503,
  TIMEOUT: 504,
};

/** User-facing French messages — never include raw DB text. */
const SAFE_DEFAULTS: Record<ErrorCode, string> = {
  BAD_REQUEST: 'Requête invalide',
  UNAUTHORIZED: 'Session invalide ou expirée',
  FORBIDDEN: 'Action non autorisée',
  NOT_FOUND: 'Ressource introuvable',
  CONFLICT: 'Conflit de données',
  RATE_LIMITED: 'Trop de requêtes — réessayez plus tard',
  VALIDATION: 'Données invalides',
  INTERNAL: 'Erreur interne — réessayez plus tard',
  SERVICE_UNAVAILABLE: 'Service temporairement indisponible',
  DB_CORRUPT: 'Base de données D1 corrompue (SQLITE_CORRUPT) — aucune écriture n’est possible tant qu’une restauration Cloudflare (TimeTravel / backup) n’a pas été faite. Contactez l’administrateur puis réessayez.',
  TIMEOUT: 'Délai dépassé — réessayez',
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(code: ErrorCode, message?: string, details?: unknown) {
    super(message || SAFE_DEFAULTS[code]);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS[code] ?? 500;
    this.details = details;
    this.expose = code !== 'INTERNAL';
  }
}

/** Physical D1/SQLite corruption — storage-level, needs a restore, not a retry. */
const DB_CORRUPT_RE = /SQLITE_CORRUPT|database disk image is malformed/i;

const DB_LEAK_RE =
  /\b(SQLITE_|D1_|SQLSTATE|near\s+"|syntax error|UNIQUE constraint|FOREIGN KEY|no such table|no such column|constraint failed|database is locked|disk i\/o error)\b/i;

/**
 * Convert any thrown value into a client-safe payload.
 * Raw database / driver messages are replaced with a generic INTERNAL message.
 */
export function toClientError(err: unknown): {
  status: number;
  code: ErrorCode;
  error: string;
  details?: unknown;
} {
  if (err instanceof AppError) {
    const msg = DB_LEAK_RE.test(err.message) ? SAFE_DEFAULTS[err.code] : err.message;
    return {
      status: err.status,
      code: err.code,
      error: msg,
      details: err.expose ? err.details : undefined,
    };
  }

  if (err instanceof Error) {
    const name = err.name || '';
    const msg = err.message || '';

    if (name === 'AbortError' || /aborted|timeout|timed out/i.test(msg)) {
      return { status: 504, code: 'TIMEOUT', error: SAFE_DEFAULTS.TIMEOUT };
    }

    if (DB_CORRUPT_RE.test(msg)) {
      console.error('[db-corrupt]', msg.slice(0, 400));
      return { status: 503, code: 'DB_CORRUPT', error: SAFE_DEFAULTS.DB_CORRUPT };
    }

    if (DB_LEAK_RE.test(msg) || /D1_|prepare\(|\.bind\(/i.test(msg)) {
      console.error('[db-error]', msg.slice(0, 400));
      return { status: 500, code: 'INTERNAL', error: SAFE_DEFAULTS.INTERNAL };
    }

    // Unknown Error — log server-side, generic client message
    console.error('[unhandled]', name, msg.slice(0, 400));
    return { status: 500, code: 'INTERNAL', error: SAFE_DEFAULTS.INTERNAL };
  }

  console.error('[unhandled-nonerror]', String(err).slice(0, 200));
  return { status: 500, code: 'INTERNAL', error: SAFE_DEFAULTS.INTERNAL };
}

/** Guard: true if a string looks like a leaked DB / SQL error. */
export function looksLikeDbError(message: string): boolean {
  return DB_LEAK_RE.test(message || '');
}
