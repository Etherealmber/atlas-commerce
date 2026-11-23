import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { touchTrustedDevice } from '../lib/authHelpers';
import { registerDeviceRoutes } from '../routes/devices';

function makeDb() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS trusted_devices (
      fingerprint TEXT PRIMARY KEY,
      label TEXT DEFAULT '',
      last_ip TEXT DEFAULT '',
      last_seen TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      biometric_credential_id TEXT DEFAULT '',
      username TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      city TEXT DEFAULT '',
      country TEXT DEFAULT '',
      resume_until TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS company_settings (id INTEGER PRIMARY KEY, email TEXT DEFAULT '');
  `);
  const db = {
    prepare(sql: string) {
      const stmt = sqlite.prepare(sql);
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              const res = stmt.run(...(args as any[]));
              return { meta: { changes: res.changes } };
            },
            async first() {
              return stmt.get(...(args as any[])) ?? null;
            },
            async all() {
              return { results: stmt.all(...(args as any[])) };
            },
          };
        },
        async run() {
          const res = stmt.run();
          return { meta: { changes: res.changes } };
        },
        async first() {
          return stmt.get() ?? null;
        },
        async all() {
          return { results: stmt.all() };
        },
      };
    },
  } as unknown as D1Database;
  return { sqlite, db };
}

describe('trusted_devices immediate IP and User-Agent sync', () => {
  it('updates last_ip and user_agent immediately on change, including back-and-forth IP switches', async () => {
    const { sqlite, db } = makeDb();

    await touchTrustedDevice(db, 'admin', 'fp-android-1', '103.151.173.100', 'Atlas-Android/1.8.0 (Android 14)', { city: 'Casablanca', country: 'MA' });
    let row = sqlite.prepare('SELECT last_ip, user_agent, city, country FROM trusted_devices WHERE fingerprint = ?').get('fp-android-1') as any;
    expect(row).toEqual({ last_ip: '103.151.173.100', user_agent: 'Atlas-Android/1.8.0 (Android 14)', city: 'Casablanca', country: 'MA' });

    // IP changes immediately (no 3-minute throttle wait)
    await touchTrustedDevice(db, 'admin', 'fp-android-1', '41.141.37.145', 'Atlas-Android/1.8.0 (Android 14)', { city: 'Rabat', country: 'MA' }, { updateOnly: true });
    row = sqlite.prepare('SELECT last_ip, user_agent, city FROM trusted_devices WHERE fingerprint = ?').get('fp-android-1') as any;
    expect(row).toEqual({ last_ip: '41.141.37.145', user_agent: 'Atlas-Android/1.8.0 (Android 14)', city: 'Rabat' });

    // App version updates immediately on same IP
    await touchTrustedDevice(db, 'admin', 'fp-android-1', '41.141.37.145', 'Atlas-Android/1.8.1 (Android 14)', { city: 'Rabat', country: 'MA' }, { updateOnly: true });
    row = sqlite.prepare('SELECT last_ip, user_agent FROM trusted_devices WHERE fingerprint = ?').get('fp-android-1') as any;
    expect(row).toEqual({ last_ip: '41.141.37.145', user_agent: 'Atlas-Android/1.8.1 (Android 14)' });

    // Switching back to previous IP still updates immediately
    await touchTrustedDevice(db, 'admin', 'fp-android-1', '103.151.173.100', 'Atlas-Android/1.8.1 (Android 14)', { city: 'Casablanca', country: 'MA' }, { updateOnly: true });
    row = sqlite.prepare('SELECT last_ip FROM trusted_devices WHERE fingerprint = ?').get('fp-android-1') as any;
    expect(row.last_ip).toBe('103.151.173.100');
  });

  it('updateOnly never re-inserts a revoked device row', async () => {
    const { sqlite, db } = makeDb();
    await touchTrustedDevice(db, 'abtef', 'fp-revoked', '196.114.182.77', 'Atlas-Desktop/0.3.2 (windows-x86_64)', null, { updateOnly: true });
    const row = sqlite.prepare('SELECT * FROM trusted_devices WHERE fingerprint = ?').get('fp-revoked');
    expect(row).toBeUndefined();
  });

  it('GET /api/auth/devices returns city/country and syncs changed IP and version immediately', async () => {
    const { sqlite, db } = makeDb();
    sqlite.prepare(`INSERT INTO trusted_devices (fingerprint, username, user_agent, last_ip, city, country) VALUES (?, ?, ?, ?, ?, ?)`)
      .run('fp-desk-1', 'admin', 'Atlas-Desktop/0.3.2 (windows-x86_64)', '103.151.173.211', 'Casablanca', 'MA');

    const app = new Hono<any>();
    registerDeviceRoutes(app, {
      sessionUserFromHeader: () => ({ username: 'admin', role: 'owner' }),
      authFailReason: async () => 'ok',
      clientIp: () => '41.249.195.202',
      ensureSecurityTables: async () => {},
      touchTrustedDevice,
      deviceLabelFromUA: (ua) => String(ua || ''),
      cfGeo: () => ({ city: 'Marrakech', country: 'MA' }),
      writeAudit: async () => {},
    });

    const res = await app.request('http://test/api/auth/devices', {
      headers: {
        Authorization: 'Bearer ok',
        'X-Device-Fingerprint': 'fp-desk-1',
        'User-Agent': 'Atlas-Desktop/0.3.3 (windows-x86_64)',
      },
    }, { DB: db });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data[0]).toMatchObject({
      full: 'fp-desk-1',
      last_ip: '41.249.195.202',
      user_agent: 'Atlas-Desktop/0.3.3 (windows-x86_64)',
      city: 'Marrakech',
      country: 'MA',
      current: true,
    });
    const dbRow = sqlite.prepare('SELECT last_ip, user_agent FROM trusted_devices WHERE fingerprint = ?').get('fp-desk-1') as any;
    expect(dbRow).toEqual({ last_ip: '41.249.195.202', user_agent: 'Atlas-Desktop/0.3.3 (windows-x86_64)' });
  });
});
