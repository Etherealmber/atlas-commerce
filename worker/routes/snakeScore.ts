import { apiFail } from '../lib/api-response';
import { rateLimit } from '../lib/security';

const MAX_SCORE = 2147483647; // Android's signed 32-bit Int range.
const MAX_BODY = 1024;

/** Auto-initialize on an authenticated request; migration 0009 remains compatible. */
async function ensureSnakeScores(db: D1Database): Promise<void> {
  const table = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'snake_personal_best'").first();
  if (table) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS snake_personal_best (
    user_id INTEGER UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
    owner_slot INTEGER UNIQUE CHECK (owner_slot IS NULL OR owner_slot = 1),
    personal_best INTEGER NOT NULL DEFAULT 0
      CHECK (typeof(personal_best) = 'integer' AND personal_best BETWEEN 0 AND 2147483647),
    CHECK ((user_id IS NOT NULL AND owner_slot IS NULL) OR
           (user_id IS NULL AND owner_slot IS NOT NULL AND owner_slot = 1))
  )`).run();
}

// The Worker auth middleware has already verified the session proof.
export function registerSnakeScoreRoutes(app: any, deps: {
  session: (header: string | undefined) => { username: string; role: string };
  ownerUsername: (env: any) => string;
}) {
  const handler = async (c: any) => {
    c.header('Cache-Control', 'no-store');
    c.header('CDN-Cache-Control', 'no-store');
    const session = deps.session(c.req.header('Authorization'));
    const username = String(session.username || '').toLowerCase();
    if (!username) return apiFail(c, 'Session invalide', 'UNAUTHORIZED');
    const isOwner = username === deps.ownerUsername(c.env) && session.role === 'owner';
    let userId: number | null = null;
    try {
      if (!isOwner) {
        const user = await c.env.DB.prepare('SELECT id, role FROM app_users WHERE username = ? AND active = 1').bind(username).first();
        if (!user || user.role !== session.role || !Number.isSafeInteger(user.id) || user.id <= 0) {
          return apiFail(c, 'Session invalide', 'UNAUTHORIZED');
        }
        userId = user.id;
      }
      const limit = await rateLimit(c.env.CACHE, `snake-score:${isOwner ? 'owner' : `user:${userId}`}`, 120, 60);
      if (!limit.ok) {
        c.header('Retry-After', String(limit.retryAfter || 60));
        return apiFail(c, 'Trop de requêtes', 'RATE_LIMITED', { retry_after: limit.retryAfter });
      }
      if (new URL(c.req.url).search) return apiFail(c, 'Paramètres non autorisés', 'VALIDATION');
      await ensureSnakeScores(c.env.DB);
      if (c.req.method === 'GET') {
        const row = isOwner
          ? await c.env.DB.prepare('SELECT personal_best FROM snake_personal_best WHERE owner_slot = 1').first()
          : await c.env.DB.prepare(`SELECT COALESCE(s.personal_best, 0) AS personal_best FROM app_users u
              LEFT JOIN snake_personal_best s ON s.user_id = u.id
              WHERE u.id = ? AND u.username = ? AND u.role = ? AND u.active = 1`)
              .bind(userId, username, session.role).first();
        if (!isOwner && !row) return apiFail(c, 'Session invalide', 'UNAUTHORIZED');
        return c.json({ personalBest: row?.personal_best ?? 0 });
      }
      let input: unknown;
      try {
        const length = c.req.header('content-length');
        if (length && Number(length) > MAX_BODY) return c.json({ success: false, error: 'Corps de requête trop volumineux', code: 'PAYLOAD_TOO_LARGE' }, 413);
        const reader = c.req.raw.body?.getReader();
        if (!reader) return apiFail(c, 'JSON invalide', 'VALIDATION');
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          // Read incrementally to enforce the cap even without Content-Length.
          // eslint-disable-next-line no-await-in-loop
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > MAX_BODY) {
            // eslint-disable-next-line no-await-in-loop
            await reader.cancel().catch(() => {});
            return c.json({ success: false, error: 'Corps de requête trop volumineux', code: 'PAYLOAD_TOO_LARGE' }, 413);
          }
          chunks.push(part.value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch {
        return apiFail(c, 'JSON invalide', 'VALIDATION');
      }
      if (!input || typeof input !== 'object' || Array.isArray(input) ||
          Object.keys(input).length !== 1 || !Object.hasOwn(input, 'personalBest')) {
        return apiFail(c, 'personalBest invalide', 'VALIDATION');
      }
      const score = (input as { personalBest: unknown }).personalBest;
      if (typeof score !== 'number' || !Number.isInteger(score) || score < 0 || score > MAX_SCORE) {
        return apiFail(c, 'personalBest invalide', 'VALIDATION');
      }
      const row = isOwner
        ? await c.env.DB.prepare(`INSERT INTO snake_personal_best (owner_slot, personal_best) VALUES (1, ?)
            ON CONFLICT(owner_slot) DO UPDATE SET personal_best = max(snake_personal_best.personal_best, excluded.personal_best)
            RETURNING personal_best`).bind(score).first()
        : await c.env.DB.prepare(`INSERT INTO snake_personal_best (user_id, personal_best)
            SELECT id, ? FROM app_users WHERE id = ? AND username = ? AND role = ? AND active = 1
            ON CONFLICT(user_id) DO UPDATE SET personal_best = max(snake_personal_best.personal_best, excluded.personal_best)
            RETURNING personal_best`).bind(score, userId, username, session.role).first();
      if (!row) return apiFail(c, 'Session invalide', 'UNAUTHORIZED');
      return c.json({ personalBest: row.personal_best });
    } catch {
      // Never expose or log DB errors, scores, or session material.
      return apiFail(c, 'Service indisponible', 'SERVICE_UNAVAILABLE');
    }
  };
  app.get('/api/mobile/snake-score', handler);
  app.put('/api/mobile/snake-score', handler);
}
