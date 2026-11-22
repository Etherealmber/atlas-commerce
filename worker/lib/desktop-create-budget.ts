import { normalizeIp } from './security';

async function hash(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
}

// Staging opt-in only: a common IP budget prevents splitting desktop request
// creation across v1, phone v2 and challenge-pilot v2. No web-login path uses it.
const ready = new WeakSet<object>();
export async function reserveDesktopCreate(db: D1Database, rawIp: string, now = Date.now()): Promise<boolean> {
  const ip = normalizeIp(rawIp);
  if (!ip || ip === 'unknown' || ip === '0.0.0.0' || !/^[0-9a-f:.]+$/i.test(ip) || ip.length > 64) throw new Error('UNAVAILABLE');
  if (!ready.has(db)) {
    await db.prepare(`CREATE TABLE IF NOT EXISTS desktop_shared_create_limits_v1 (bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at INTEGER NOT NULL)`).run();
    await db.prepare('CREATE INDEX IF NOT EXISTS desktop_shared_create_limits_expiry_v1 ON desktop_shared_create_limits_v1(expires_at)').run();
    ready.add(db);
  }
  const window = Math.floor(now / 300_000);
  const key = await hash(JSON.stringify(['desktop-create', ip, window]));
  await db.prepare('DELETE FROM desktop_shared_create_limits_v1 WHERE bucket IN (SELECT bucket FROM desktop_shared_create_limits_v1 WHERE expires_at<=? LIMIT 100)').bind(now).run();
  const reserved = await db.prepare(`INSERT INTO desktop_shared_create_limits_v1 (bucket,attempts,expires_at) VALUES (?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 WHERE attempts<8 RETURNING attempts`).bind(key, (window + 1) * 300_000).first();
  return !!reserved;
}
