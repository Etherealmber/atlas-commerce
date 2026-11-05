/**
 * v0.7.8 — push notifications des demandes d'ajustement de stock.
 *
 * Verrouille (route réelle, D1 shim SQLite, FCM legacy stubbé) :
 *  1. submit → seuls les approveurs autorisés (politique de rôle) sont poussés,
 *     demandeur exclu, rôles non-approveurs exclus ;
 *  2. replay idempotent → AUCUN push supplémentaire ;
 *  3. isolation tenant : chaque base D1 ne pousse que ses propres jetons ;
 *  4. approve / reject → seul le demandeur est notifié, après le changement de
 *     statut réussi ; transition répétée (409) → aucun push ;
 *  5. échec push (HTTP 500) → la demande/la décision restent intactes ;
 *  6. jeton mort (404) → purgé de device_push_tokens.
 * Payload non sensible : event + request_id (+ status), texte générique.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };
import { createHash } from 'node:crypto';

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
const legacyHash = (salt: string, pw: string) => sha256(`pc:${salt}:${pw}`);
let IP = '203.0.113.5';
let ipSeq = 0;

function makeD1() {
  const sqlite = new DatabaseSync(':memory:');
  const db: any = {
    prepare(sql: string) {
      let params: any[] = [];
      const api: any = {
        bind(...p: any[]) { params = p; return api; },
        async run() {
          const r = sqlite.prepare(sql).run(...(params as any));
          return { success: true, meta: { changes: Number(r.changes || 0), last_row_id: Number(r.lastInsertRowid || 0) } };
        },
        async first() {
          const r = sqlite.prepare(sql).get(...(params as any));
          return r === undefined ? null : { ...(r as any) };
        },
        async all() {
          const rows = sqlite.prepare(sql).all(...(params as any)).map((r: any) => ({ ...r }));
          return { success: true, results: rows, meta: {} };
        },
      };
      return api;
    },
    async batch(stmts: any[]) {
      const out: any[] = [];
      for (const st of stmts) out.push(await st.run());
      return out;
    },
  };
  return { db, sqlite };
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS company_settings (id INTEGER PRIMARY KEY, company_name TEXT DEFAULT '', email TEXT DEFAULT '');
  INSERT INTO company_settings (id, company_name, email) VALUES (1, 'TestCo', 'main@corp.ma');
  CREATE TABLE IF NOT EXISTS app_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT DEFAULT '',
    password_salt TEXT DEFAULT '', role TEXT DEFAULT 'user', display_name TEXT DEFAULT '',
    active INTEGER DEFAULT 1, email TEXT DEFAULT '', created_by TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')), last_login TEXT
  );
  CREATE TABLE IF NOT EXISTS login_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL, fingerprint TEXT DEFAULT '', success INTEGER DEFAULT 0, reputation_delta INTEGER DEFAULT 0, user_agent TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS ip_reputation (ip TEXT PRIMARY KEY, score INTEGER NOT NULL DEFAULT 50, failed_count INTEGER DEFAULT 0, success_count INTEGER DEFAULT 0, blocked_until TEXT, updated_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS otp_codes (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), UNIQUE(resource_type, resource_id));
  CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS trusted_devices (fingerprint TEXT PRIMARY KEY, label TEXT DEFAULT '', last_ip TEXT DEFAULT '', last_seen TEXT DEFAULT (datetime('now')), created_at TEXT DEFAULT (datetime('now')), biometric_credential_id TEXT DEFAULT '', username TEXT DEFAULT '', user_agent TEXT DEFAULT '', city TEXT DEFAULT '', country TEXT DEFAULT '', resume_until TEXT DEFAULT '');
  CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT DEFAULT '', is_active INTEGER DEFAULT 1, track_inventory INTEGER DEFAULT 1, stock_quantity INTEGER DEFAULT 0, updated_at TEXT DEFAULT (datetime('now')));
  CREATE TABLE IF NOT EXISTS device_push_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    token TEXT NOT NULL,
    platform TEXT DEFAULT 'android',
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(username, token)
  );
`;

let sqliteA: any;
let envA: any;
let envB: any;
let app: any;
let pushes: { to: string; data: any; notification: any }[] = [];
let pushStatus = 200;

beforeEach(async () => {
  ipSeq += 1;
  IP = `203.0.113.${100 + ipSeq}`;
  pushes = [];
  pushStatus = 200;
  vi.stubGlobal('fetch', (async (url: any, init: any) => {
    const body = JSON.parse(String(init.body));
    pushes.push({ to: String(body.to || ''), data: body.data || {}, notification: body.notification || {} });
    return new Response(pushStatus === 200 ? JSON.stringify({ message_id: 'm' }) : 'boom', { status: pushStatus });
  }) as unknown as typeof fetch);

  const a = makeD1();
  sqliteA = a.sqlite;
  sqliteA.exec(SCHEMA);
  sqliteA.exec(`INSERT INTO products (id, name, is_active, track_inventory, stock_quantity) VALUES (1, 'Produit A', 1, 1, 50)`);
  const b = makeD1();
  sqliteBHolder = b.sqlite;
  b.sqlite.exec(SCHEMA);
  b.sqlite.exec(`INSERT INTO products (id, name, is_active, track_inventory, stock_quantity) VALUES (1, 'Produit B', 1, 1, 50)`);

  const baseEnv = (db: any) => ({
    DB: db,
    CACHE: {},
    EMAIL: { send: async () => ({}) },
    ADMIN_PASSWORD: 'OwnerPass123!',
    TURNSTILE_SECRET_KEY: '',
    TURNSTILE_SITE_KEY: '',
    FCM_SERVER_KEY: 'legacy-key',
  });
  envA = baseEnv(a.db);
  envB = baseEnv(b.db);
  const mod: any = await import('../index');
  app = mod.default?.fetch ? mod.default : mod.app;
});

afterEach(() => vi.unstubAllGlobals());

async function seedUser(sqlite: any, username: string, pw: string, role: string) {
  const salt = `s-${username}`;
  const hash = await legacyHash(salt, pw);
  sqlite.exec(
    `INSERT INTO app_users (username, password_salt, password_hash, role, email)
     VALUES ('${username}', '${salt}', '${hash}', '${role}', '${username}@corp.ma')`,
  );
  return hash;
}

function seedDeviceSql(sqlite: any, fp: string, username: string) {
  sqlite.exec(`INSERT OR REPLACE INTO trusted_devices (fingerprint, username, user_agent, last_ip, last_seen) VALUES ('${fp}', '${username}', 'ua', '${IP}', datetime('now'))`);
}

function seedPushToken(sqlite: any, username: string, token: string) {
  sqlite.exec(`INSERT OR IGNORE INTO device_push_tokens (username, token, platform, updated_at) VALUES ('${username}', '${token}', 'android', datetime('now'))`);
}

async function tokenFor(username: string, role: string, secretMaterial: string, fp: string) {
  const user = username.toLowerCase();
  const proof = await sha256(`proof|${user}|${role}|${secretMaterial}|${IP}|${fp}`);
  return btoa(unescape(encodeURIComponent(`stock-auth-v2|${user}|${role}|${IP}|${fp}|${proof}`)));
}

async function call(env: any, path: string, token: string, body?: any) {
  const res = await app.fetch(
    new Request(`http://test.local${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'CF-Connecting-IP': IP },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const tos = () => pushes.map((p) => p.to);

describe('v0.7.8 — push demandes de stock', () => {
  it('submit → approveurs autorisés seulement (demandeur et stock exclus)', async () => {
    const mag = await seedUser(sqliteA, 'mag', 'Test1234!', 'stock');
    const adm = await seedUser(sqliteA, 'adm1', 'Test1234!', 'admin');
    const sec = await seedUser(sqliteA, 'sec1', 'Test1234!', 'secretaire');
    const bob = await seedUser(sqliteA, 'bob', 'Test1234!', 'stock');
    seedDeviceSql(sqliteA, 'fp-mag', 'mag');
    seedDeviceSql(sqliteA, 'fp-adm', 'adm1');
    seedPushToken(sqliteA, 'mag', 'tok-mag');
    seedPushToken(sqliteA, 'adm1', 'tok-adm1');
    seedPushToken(sqliteA, 'sec1', 'tok-sec1');
    seedPushToken(sqliteA, 'bob', 'tok-bob');

    const r = await call(envA, '/api/stock-adjustment-requests', await tokenFor('mag', 'stock', mag, 'fp-mag'), {
      product_id: 1, direction: 'out', quantity: 3, reason: 'casse', idempotency_key: 'k1',
    });
    expect(r.status).toBe(201);
    expect(tos().sort()).toEqual(['tok-adm1', 'tok-sec1']); // owner sans appareil = silencieux
    expect(pushes[0].data).toMatchObject({ event: 'stock_request_submitted', request_id: '1' });
    expect(pushes[0].notification.body).toContain('ajustement de stock');
    expect(JSON.stringify(pushes[0].data)).not.toContain('Produit A'); // non sensible
    void adm; void sec; void bob;
  });

  it('replay idempotent → aucun push supplémentaire', async () => {
    const mag = await seedUser(sqliteA, 'mag', 'Test1234!', 'stock');
    await seedUser(sqliteA, 'sec1', 'Test1234!', 'secretaire');
    seedDeviceSql(sqliteA, 'fp-mag', 'mag');
    seedPushToken(sqliteA, 'sec1', 'tok-sec1');
    const tok = await tokenFor('mag', 'stock', mag, 'fp-mag');
    const first = await call(envA, '/api/stock-adjustment-requests', tok, { product_id: 1, direction: 'in', quantity: 2, idempotency_key: 'kk' });
    expect(first.status).toBe(201);
    const n = pushes.length;
    const replay = await call(envA, '/api/stock-adjustment-requests', tok, { product_id: 1, direction: 'in', quantity: 2, idempotency_key: 'kk' });
    expect(replay.status).toBe(200);
    expect((replay.body as any).replayed).toBe(true);
    expect(pushes.length).toBe(n); // pas de doublon
  });

  it('isolation tenant : aucun jeton du tenant B poussé par le tenant A', async () => {
    const magA = await seedUser(sqliteA, 'mag', 'Test1234!', 'stock');
    await seedUser(sqliteA, 'sec1', 'Test1234!', 'secretaire');
    const magB = await seedUser(sqliteBHolder, 'mag', 'Test1234!', 'stock');
    seedDeviceSql(sqliteA, 'fp-mag', 'mag');
    seedPushToken(sqliteA, 'sec1', 'tok-sec1-A');
    seedPushToken(sqliteBHolder, 'mag', 'tok-mag-B');
    seedPushToken(sqliteBHolder, 'sec1', 'tok-sec1-B');
    const r = await call(envA, '/api/stock-adjustment-requests', await tokenFor('mag', 'stock', magA, 'fp-mag'), { product_id: 1, direction: 'out', quantity: 1 });
    expect(r.status).toBe(201);
    expect(tos()).toEqual(['tok-sec1-A']);
    void magB;
  });

  it('approve → demandeur notifié une fois ; 2e approve (409) silencieux', async () => {
    const mag = await seedUser(sqliteA, 'mag', 'Test1234!', 'stock');
    const adm = await seedUser(sqliteA, 'adm1', 'Test1234!', 'admin');
    seedDeviceSql(sqliteA, 'fp-mag', 'mag');
    seedDeviceSql(sqliteA, 'fp-adm', 'adm1');
    seedPushToken(sqliteA, 'mag', 'tok-mag');
    seedPushToken(sqliteA, 'adm1', 'tok-adm1');
    const sub = await call(envA, '/api/stock-adjustment-requests', await tokenFor('mag', 'stock', mag, 'fp-mag'), { product_id: 1, direction: 'out', quantity: 2 });
    expect(sub.status).toBe(201);
    const id = (sub.body as any).data.id;
    pushes = [];
    const ap = await call(envA, `/api/stock-adjustment-requests/${id}/approve`, await tokenFor('adm1', 'admin', adm, 'fp-adm'), {});
    expect(ap.status).toBe(200);
    expect(tos()).toEqual(['tok-mag']);
    expect(pushes[0].data).toMatchObject({ event: 'stock_request_decided', status: 'approved', request_id: String(id) });
    const again = await call(envA, `/api/stock-adjustment-requests/${id}/approve`, await tokenFor('adm1', 'admin', adm, 'fp-adm'), {});
    expect(again.status).toBe(409);
    expect(pushes.length).toBe(1); // transition répétée = silencieuse
  });

  it('reject → demandeur notifié status rejected', async () => {
    const mag = await seedUser(sqliteA, 'mag', 'Test1234!', 'stock');
    const adm = await seedUser(sqliteA, 'adm1', 'Test1234!', 'admin');
    seedDeviceSql(sqliteA, 'fp-mag', 'mag');
    seedDeviceSql(sqliteA, 'fp-adm', 'adm1');
    seedPushToken(sqliteA, 'mag', 'tok-mag');
    seedPushToken(sqliteA, 'adm1', 'tok-adm1');
    const sub = await call(envA, '/api/stock-adjustment-requests', await tokenFor('mag', 'stock', mag, 'fp-mag'), { product_id: 1, direction: 'in', quantity: 5 });
    const id = (sub.body as any).data.id;
    pushes = [];
    const rj = await call(envA, `/api/stock-adjustment-requests/${id}/reject`, await tokenFor('adm1', 'admin', adm, 'fp-adm'), { note: 'non' });
    expect(rj.status).toBe(200);
    expect(tos()).toEqual(['tok-mag']);
    expect(pushes[0].data).toMatchObject({ event: 'stock_request_decided', status: 'rejected' });
  });

  it('échec push (500) → demande et décision intactes', async () => {
    pushStatus = 500;
    const mag = await seedUser(sqliteA, 'mag', 'Test1234!', 'stock');
    const adm = await seedUser(sqliteA, 'adm1', 'Test1234!', 'admin');
    seedDeviceSql(sqliteA, 'fp-mag', 'mag');
    seedDeviceSql(sqliteA, 'fp-adm', 'adm1');
    seedPushToken(sqliteA, 'mag', 'tok-mag');
    seedPushToken(sqliteA, 'adm1', 'tok-adm1');
    const sub = await call(envA, '/api/stock-adjustment-requests', await tokenFor('mag', 'stock', mag, 'fp-mag'), { product_id: 1, direction: 'out', quantity: 1 });
    expect(sub.status).toBe(201); // push en échec ne défait rien
    const id = (sub.body as any).data.id;
    const ap = await call(envA, `/api/stock-adjustment-requests/${id}/approve`, await tokenFor('adm1', 'admin', adm, 'fp-adm'), {});
    expect(ap.status).toBe(200);
    expect((ap.body as any).data.status).toBe('approved');
  });

  it('jeton mort (404) → purgé de device_push_tokens', async () => {
    pushStatus = 404;
    const mag = await seedUser(sqliteA, 'mag', 'Test1234!', 'stock');
    await seedUser(sqliteA, 'sec1', 'Test1234!', 'secretaire');
    seedDeviceSql(sqliteA, 'fp-mag', 'mag');
    seedPushToken(sqliteA, 'sec1', 'tok-dead');
    const sub = await call(envA, '/api/stock-adjustment-requests', await tokenFor('mag', 'stock', mag, 'fp-mag'), { product_id: 1, direction: 'in', quantity: 1 });
    expect(sub.status).toBe(201);
    const left = sqliteA.prepare(`SELECT COUNT(*) as c FROM device_push_tokens WHERE token = 'tok-dead'`).get() as any;
    expect(Number(left.c)).toBe(0);
  });
});

/* base D1 du tenant B, créée dans beforeEach */
let sqliteBHolder: any;
