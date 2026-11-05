import { afterEach, describe, expect, it, vi } from 'vitest';
import { MobileHub } from '../durable/MobileHub';
import { addColumnIfMissing } from '../lib/schema';
import { ensureFinanceSchema } from '../lib/finance';

const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = await import(SQLITE_MODULE);

function makeD1() {
  const sqlite = new DatabaseSync(':memory:');
  const statements: string[] = [];
  const errors: string[] = [];
  const db: any = {
    prepare(sql: string) {
      let params: any[] = [];
      function execute(mode: 'run' | 'get' | 'all') {
        statements.push(sql);
        try { return sqlite.prepare(sql)[mode](...params); }
        catch (e) { errors.push(String(e)); throw e; }
      }
      const stmt: any = {
        bind(...values: any[]) { params = values; return stmt; },
        async run() { const r = execute('run'); return { success: true, meta: { changes: Number(r.changes) } }; },
        async first() { return execute('get') ?? null; },
        async all() { return { success: true, results: execute('all') }; },
      };
      return stmt;
    },
  };
  return { db, sqlite, statements, errors };
}

function makeHub() {
  const values = new Map<string, unknown>();
  const state: any = { storage: {
    async get(keys: string[]) { return new Map(keys.filter((k) => values.has(k)).map((k) => [k, values.get(k)])); },
    async put(patch: Record<string, unknown>) { for (const [k, v] of Object.entries(patch)) values.set(k, v); },
  } };
  const hub = new MobileHub(state, {} as any);
  return { hub, values };
}

const avatarRequest = (v: string, init?: RequestInit) => new Request(`https://do/avatar?v=${v}`, init);
afterEach(() => vi.unstubAllGlobals());

describe('avatar cache observability', () => {
  it('returns a bodyless 204 for a cold cache, not an error span', async () => {
    const { hub } = makeHub();
    const response = await hub.fetch(avatarRequest('1'));
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('serves the cached image only for the matching version', async () => {
    const { hub } = makeHub();
    await hub.fetch(avatarRequest('1', { method: 'PUT', headers: { 'x-avatar-ctype': 'image/png' }, body: new Uint8Array([1, 2, 3]) }));
    const hit = await hub.fetch(avatarRequest('1'));
    expect(hit.status).toBe(200);
    expect(hit.headers.get('x-avatar-ctype')).toBe('image/png');
    expect([...new Uint8Array(await hit.arrayBuffer())]).toEqual([1, 2, 3]);
    expect((await hub.fetch(avatarRequest('2'))).status).toBe(204);
    // A version miss must not corrupt the previously cached image.
    expect((await hub.fetch(avatarRequest('1'))).status).toBe(200);
  });

  it('retains actual method errors instead of masking them', async () => {
    const { hub } = makeHub();
    expect((await hub.fetch(avatarRequest('1', { method: 'DELETE' }))).status).toBe(405);
  });

  it('the authenticated avatar proxy falls back on 204, warms the cache, then serves a hit', async () => {
    const { db, sqlite } = makeD1();
    const { hub, values } = makeHub();
    values.set('avatar_url', 'https://cdn1.afmarbre.com/test-avatar.png');
    sqlite.exec(`
      CREATE TABLE app_users (username TEXT, display_name TEXT, avatar_url TEXT, role TEXT);
      CREATE TABLE app_config (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE trusted_devices (fingerprint TEXT PRIMARY KEY, username TEXT);
      INSERT INTO trusted_devices VALUES ('avatar-fp', 'admin');
    `);
    const digest = async (value: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map((v) => v.toString(16).padStart(2, '0')).join('');
    const ip = '203.0.113.29';
    const secret = 'test-owner-password';
    const material = await digest(`owner-key|admin|${secret}`);
    const proof = await digest(`proof|admin|owner|${material}|${ip}|avatar-fp`);
    const token = btoa(`stock-auth-v2|admin|owner|${ip}|avatar-fp|${proof}`);
    const stub = { fetch: vi.fn((url: string, init?: RequestInit) => hub.fetch(new Request(url, init))) };
    const env: any = { DB: db, ADMIN_PASSWORD: secret, MOBILE_HUB: { idFromName: (name: string) => name, get: () => stub } };
    const origin = vi.fn(async () => new Response(new Uint8Array([7, 8, 9]), { headers: { 'Content-Type': 'image/png' } }));
    vi.stubGlobal('fetch', origin);
    const { default: app } = await import('../index');
    const pending: Promise<unknown>[] = [];
    const ctx: any = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {} };
    const call = (authorized = true) => app.fetch(new Request('https://test.local/api/me/avatar', { headers: {
      ...(authorized ? { Authorization: `Bearer ${token}` } : {}), 'CF-Connecting-IP': ip,
    } }), env, ctx);
    try {
      const cold = await call();
      expect(cold.status).toBe(200);
      expect(cold.headers.get('Content-Type')).toBe('image/png');
      expect([...new Uint8Array(await cold.arrayBuffer())]).toEqual([7, 8, 9]);
      await Promise.all(pending);
      const warm = await call();
      expect(warm.status).toBe(200);
      expect([...new Uint8Array(await warm.arrayBuffer())]).toEqual([7, 8, 9]);
      expect(origin).toHaveBeenCalledTimes(1);
      expect((await call(false)).status).toBe(401);
      // Genuine upstream failures remain errors, not successful empty images.
      values.set('avatar_url', 'https://cdn1.afmarbre.com/missing.png');
      origin.mockImplementation(async () => new Response('missing', { status: 404 }));
      expect((await call()).status).toBe(502);
    } finally { sqlite.close(); }
  });
});

describe('D1 schema observability', () => {
  it('does not issue failing ALTERs for existing columns, including case differences', async () => {
    const { db, sqlite, statements, errors } = makeD1();
    try {
      sqlite.exec('CREATE TABLE products (id INTEGER PRIMARY KEY, Barcode TEXT)');
      await addColumnIfMissing(db, 'products', 'barcode', "TEXT DEFAULT ''");
      await addColumnIfMissing(db, 'products', 'barcode', "TEXT DEFAULT ''");
      expect(statements.some((sql) => sql.startsWith('ALTER TABLE'))).toBe(false);
      expect(errors).toEqual([]);
    } finally { sqlite.close(); }
  });

  it('upgrades legacy schemas once and leaves persisted data intact on repeated calls', async () => {
    const { db, sqlite, statements, errors } = makeD1();
    try {
      sqlite.exec("CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO products VALUES (1, 'Produit')");
      for (let i = 0; i < 3; i++) await addColumnIfMissing(db, 'products', 'barcode', "TEXT DEFAULT ''");
      expect(statements.filter((sql) => sql.startsWith('ALTER TABLE'))).toHaveLength(1);
      expect(sqlite.prepare('SELECT * FROM products').get()).toMatchObject({ id: 1, name: 'Produit', barcode: '' });
      expect(errors).toEqual([]);
    } finally { sqlite.close(); }
  });

  it('finance initialization is error-free both on legacy and already-migrated schemas', async () => {
    const { db, sqlite, statements, errors } = makeD1();
    try {
      sqlite.exec("CREATE TABLE company_settings (id INTEGER PRIMARY KEY); INSERT INTO company_settings VALUES (1)");
      await ensureFinanceSchema(db);
      sqlite.exec("UPDATE company_settings SET finance_currency = 'EUR'");
      await ensureFinanceSchema(db);
      expect(statements.filter((sql) => sql.startsWith('ALTER TABLE'))).toHaveLength(3);
      expect(errors).toEqual([]);
      expect(sqlite.prepare('SELECT * FROM company_settings').get()).toMatchObject({ finance_timezone: 'Africa/Casablanca', finance_currency: 'EUR', finance_push_amounts: 1 });
    } finally { sqlite.close(); }
  });

  it('inventory locations produces no D1 errors on legacy and already-migrated databases', async () => {
    for (const migrated of [false, true]) {
      // Fresh module simulates a fresh Worker isolate, not a schemaOnce cache hit.
      vi.resetModules();
      const { default: app } = await import('../index');
      const { db, sqlite, errors } = makeD1();
      const digest = async (value: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map((v) => v.toString(16).padStart(2, '0')).join('');
      const secret = 'test-location-password';
      const ip = '203.0.113.30';
      const material = await digest(`owner-key|admin|${secret}`);
      const proof = await digest(`proof|admin|owner|${material}|${ip}|location-fp`);
      const token = btoa(`stock-auth-v2|admin|owner|${ip}|location-fp|${proof}`);
      try {
        sqlite.exec(`
          CREATE TABLE trusted_devices (fingerprint TEXT PRIMARY KEY, username TEXT);
          INSERT INTO trusted_devices VALUES ('location-fp', 'admin');
          CREATE TABLE company_settings (id INTEGER PRIMARY KEY ${migrated ? ', multi_warehouse INTEGER DEFAULT 1, sales_location_id INTEGER, purchase_location_id INTEGER' : ''});
          INSERT INTO company_settings (id) VALUES (1);
          CREATE TABLE stock_locations (id INTEGER PRIMARY KEY, code TEXT UNIQUE, name TEXT ${migrated ? ', is_active INTEGER DEFAULT 1, is_default INTEGER DEFAULT 0' : ''});
          INSERT INTO stock_locations (id, code, name) VALUES (1, 'MAG', 'Magasin');
        `);
        const response = await app.fetch(new Request('https://test.local/api/inventory/locations', { headers: {
          Authorization: `Bearer ${token}`, 'CF-Connecting-IP': ip,
        } }), { DB: db, ADMIN_PASSWORD: secret } as any, { waitUntil() {}, passThroughOnException() {} } as any);
        expect(response.status).toBe(200);
        const body: any = await response.json();
        expect(body.success).toBe(true);
        expect(body.data).toHaveLength(1);
        expect(body.data[0]).toMatchObject({ code: 'MAG', name: 'Magasin', is_active: 1 });
        expect(errors).toEqual([]);
      } finally { sqlite.close(); }
    }
  });

  it('core lazy migrations use the shared PRAGMA-first helper, not unconditional ALTERs', async () => {
    const FS_MODULE = ['node:', 'fs/promises'].join('');
    const { readFile } = await import(FS_MODULE);
    for (const path of ['../index.ts', '../lib/finance.ts']) {
      const source: string = await readFile(new URL(path, import.meta.url), 'utf8');
      expect(source).not.toMatch(/ALTER TABLE \w+ ADD COLUMN/);
      expect(source).toContain('import { addColumnIfMissing }');
    }
  });
});
