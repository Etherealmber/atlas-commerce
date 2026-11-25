import { apiFail } from '../lib/api-response';
import { rateLimit } from '../lib/security';
import { tableExists } from '../lib/schema';

const MAX_BODY = 4096;
const COOLDOWN_MS = 5 * 60 * 1000;
const frequencies = ['daily', 'weekly', 'monthly', 'yearly'] as const;
type Frequency = typeof frequencies[number];
const options: Record<string, readonly (string | boolean)[]> = {
  theme: ['system', 'light', 'dark'],
  language: ['system', 'en', 'fr', 'ar'],
  density: ['comfortable', 'compact'],
  animations: [true, false],
  navigation_default: ['dashboard', 'products', 'scan', 'sales'],
  scan_behavior: ['preview', 'auto'],
  sale_confirmation: [true, false],
  product_view: ['list', 'grid'],
  update_notifications: [true, false],
  update_channel: ['stable', 'beta'],
  onboarding_completed: [true, false],
};
const defaults: Record<string, string | boolean> = {
  theme: 'system', language: 'system', density: 'comfortable', animations: true,
  navigation_default: 'dashboard', scan_behavior: 'preview', sale_confirmation: true,
  product_view: 'list', update_notifications: true, update_channel: 'stable', onboarding_completed: false,
};
const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
function validSettings(x: unknown): x is Record<string, string | boolean> {
  return isObject(x) && Object.keys(x).every(k => Object.hasOwn(options, k) && options[k].includes(x[k] as string | boolean));
}

/** Calendar-based UTC increments clamp to the last day of the target month. */
export function nextPreferenceSync(last: string | null, frequency: Frequency): string | null {
  if (!last) return null;
  const d = new Date(last);
  if (!Number.isFinite(d.getTime())) throw new Error('invalid date');
  if (frequency === 'daily' || frequency === 'weekly') {
    d.setUTCDate(d.getUTCDate() + (frequency === 'daily' ? 1 : 7));
  } else {
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + (frequency === 'monthly' ? 1 : 12));
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, end));
  }
  return d.toISOString();
}

async function ensureTable(db: D1Database) {
  if (await tableExists(db, 'mobile_preferences_v1')) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS mobile_preferences_v1 (
    user_id INTEGER UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
    owner_username TEXT UNIQUE CHECK (owner_username IS NULL OR length(owner_username) > 0),
    settings_json TEXT NOT NULL DEFAULT '{}',
    sync_frequency TEXT NOT NULL DEFAULT 'daily' CHECK (sync_frequency IN ('daily','weekly','monthly','yearly')),
    revision INTEGER NOT NULL DEFAULT 0 CHECK (typeof(revision) = 'integer' AND revision >= 0),
    updated_at TEXT, last_synced_at TEXT,
    CHECK ((user_id IS NOT NULL AND owner_username IS NULL) OR (user_id IS NULL AND owner_username IS NOT NULL))
  )`).run();
}

async function readBody(c: any): Promise<unknown> {
  const length = c.req.header('content-length');
  if (length && Number(length) > MAX_BODY) throw new Error('TOO_LARGE');
  const reader = c.req.raw.body?.getReader();
  if (!reader) throw new Error('INVALID');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    // Sequential reads are required to bound streaming bodies.
    // eslint-disable-next-line no-await-in-loop
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > MAX_BODY) {
      // eslint-disable-next-line no-await-in-loop
      await reader.cancel().catch(() => {});
      throw new Error('TOO_LARGE');
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let pos = 0;
  for (const chunk of chunks) { bytes.set(chunk, pos); pos += chunk.length; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export function registerMobilePreferencesRoutes(app: any, deps: {
  session: (header: string | undefined) => { username: string; role: string };
  ownerUsername: (env: any) => string;
  ensureSecurityTables: (db: D1Database) => Promise<void>;
}) {
  const handler = async (c: any) => {
    const session = deps.session(c.req.header('Authorization'));
    const username = String(session.username || '').toLowerCase();
    if (!username) return apiFail(c, 'Session invalide', 'UNAUTHORIZED');
    const owner = username === deps.ownerUsername(c.env) && session.role === 'owner';
    try {
      let id: number | null = null;
      if (!owner) {
        const user = await c.env.DB.prepare('SELECT id, role FROM app_users WHERE username = ? AND active = 1').bind(username).first();
        if (!user || user.role !== session.role || !Number.isSafeInteger(user.id) || user.id <= 0) return apiFail(c, 'Session invalide', 'UNAUTHORIZED');
        id = user.id;
      }
      let now = Date.now();
      let serverTime = new Date(now).toISOString();
      const rate = await rateLimit(c.env.CACHE, `mobile-preferences:${owner ? `owner:${username}` : `user:${id}`}`, 120, 60);
      const blocked = (seconds: number, code = 'RATE_LIMITED') => {
        c.header('Retry-After', String(seconds));
        return c.json({ success: false, code, error: 'Synchronisation trop fréquente', server_time: serverTime, retry_after_seconds: seconds }, 429);
      };
      if (!rate.ok) return blocked(rate.retryAfter || 60);
      if (new URL(c.req.url).search) return apiFail(c, 'Paramètres non autorisés', 'VALIDATION');
      let body: any;
      if (c.req.method === 'PUT') {
        try { body = await readBody(c); } catch (e) {
          if (e instanceof Error && e.message === 'TOO_LARGE') return c.json({ success: false, code: 'PAYLOAD_TOO_LARGE', error: 'Corps trop volumineux' }, 413);
          return apiFail(c, 'JSON invalide', 'VALIDATION');
        }
        if (!isObject(body) || Object.keys(body).some(k => !['schema_version', 'revision', 'sync_type', 'settings', 'sync_frequency'].includes(k)) ||
            body.schema_version !== 1 || !Number.isSafeInteger(body.revision) || (body.revision as number) < 0 ||
            !['manual', 'scheduled'].includes(body.sync_type as string) || !validSettings(body.settings) ||
            (body.sync_frequency !== undefined && !frequencies.includes(body.sync_frequency as Frequency))) {
          return apiFail(c, 'Préférences invalides', 'VALIDATION');
        }
      }
      if (owner && !await tableExists(c.env.DB, 'app_users')) {
        await deps.ensureSecurityTables(c.env.DB);
      }
      await ensureTable(c.env.DB);
      if (owner) {
        await c.env.DB.prepare('INSERT INTO mobile_preferences_v1 (owner_username) VALUES (?) ON CONFLICT(owner_username) DO NOTHING').bind(username).run();
      } else {
        await c.env.DB.prepare(`INSERT INTO mobile_preferences_v1 (user_id)
          SELECT id FROM app_users WHERE id = ? AND username = ? AND role = ? AND active = 1
          ON CONFLICT(user_id) DO NOTHING`).bind(id, username, session.role).run();
      }
      const query = () => owner
        ? c.env.DB.prepare(`SELECT *, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS server_now FROM mobile_preferences_v1 WHERE owner_username = ?`).bind(username).first()
        : c.env.DB.prepare(`SELECT p.*, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS server_now FROM mobile_preferences_v1 p JOIN app_users u ON u.id = p.user_id WHERE p.user_id = ? AND u.username = ? AND u.role = ? AND u.active = 1`).bind(id, username, session.role).first();
      let row = await query();
      if (!row) return apiFail(c, 'Session invalide', 'UNAUTHORIZED');
      // Database time is authoritative for both the decision and the atomic write.
      now = Date.parse(row.server_now);
      if (!Number.isFinite(now)) throw new Error('invalid server clock');
      serverTime = row.server_now;
      const response = (r: any) => {
        const settings = JSON.parse(r.settings_json);
        if (!validSettings(settings) || !frequencies.includes(r.sync_frequency)) throw new Error('invalid storage');
        return { schema_version: 1, settings: { ...defaults, ...settings }, revision: r.revision,
          updated_at: r.updated_at, server_time: serverTime, sync_frequency: r.sync_frequency,
          last_synced_at: r.last_synced_at, next_sync_at: nextPreferenceSync(r.last_synced_at, r.sync_frequency) };
      };
      if (c.req.method === 'GET') return c.json(response(row));
      const decide = (r: any) => {
        if (r.revision !== body.revision) return c.json({ success: false, code: 'CONFLICT', error: 'Révision obsolète', server_time: serverTime, revision: r.revision }, 409);
        if (r.last_synced_at) {
          const remaining = Math.ceil((Date.parse(r.last_synced_at) + COOLDOWN_MS - now) / 1000);
          if (remaining > 0) return blocked(remaining);
          const due = nextPreferenceSync(r.last_synced_at, r.sync_frequency);
          if (body.sync_type === 'scheduled' && due && Date.parse(due) > now) {
            return c.json({ success: false, code: 'NOT_DUE', error: 'Synchronisation non prévue', server_time: serverTime, next_sync_at: due }, 409);
          }
        }
        return null;
      };
      const rejection = decide(row);
      if (rejection) return rejection;
      const current = response(row);
      const merged = { ...current.settings, ...body.settings };
      const frequency = body.sync_frequency ?? row.sync_frequency;
      const guard = owner ? 'owner_username = ?' : 'user_id = ? AND EXISTS (SELECT 1 FROM app_users WHERE id = ? AND username = ? AND role = ? AND active = 1)';
      const scheduledDue = body.sync_type === 'scheduled' ? nextPreferenceSync(row.last_synced_at, row.sync_frequency) : null;
      // Evaluate timestamp, cooldown, and due time inside the atomic D1 write.
      // A delayed D1 write cannot backdate an accepted sync.
      const statement = c.env.DB.prepare(`UPDATE mobile_preferences_v1 SET settings_json = ?, sync_frequency = ?, revision = revision + 1,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), last_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE ${guard} AND revision = ? AND (last_synced_at IS NULL OR last_synced_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 minutes'))
        AND (? IS NULL OR strftime('%Y-%m-%dT%H:%M:%fZ', 'now') >= ?) RETURNING *`);
      const args = [JSON.stringify(merged), frequency, ...(owner ? [username] : [id, id, username, session.role]), body.revision, scheduledDue, scheduledDue];
      const saved = await statement.bind(...args).first();
      if (!saved) {
        row = await query();
        if (!row) return apiFail(c, 'Session invalide', 'UNAUTHORIZED');
        now = Date.parse(row.server_now);
        if (!Number.isFinite(now)) throw new Error('invalid server clock');
        serverTime = row.server_now;
        return decide(row) || c.json({ success: false, code: 'CONFLICT', error: 'Révision obsolète', server_time: serverTime, revision: row.revision }, 409);
      }
      serverTime = saved.last_synced_at;
      return c.json(response(saved));
    } catch {
      // Do not log settings, credentials, request bodies, or database errors.
      return apiFail(c, 'Service indisponible', 'SERVICE_UNAVAILABLE');
    }
  };
  app.get('/api/mobile/preferences', handler);
  app.put('/api/mobile/preferences', handler);
}
