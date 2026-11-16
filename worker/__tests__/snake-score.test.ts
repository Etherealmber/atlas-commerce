import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };
const { default: app } = await import('../index');
const up = readFileSync(new URL('../../migrations/0009_snake_personal_best.sql', import.meta.url), 'utf8');
const down = readFileSync(new URL('../../docs/rollback/0009_snake_personal_best.sql', import.meta.url), 'utf8');
const ip = '203.0.113.91';
let sqlite: any, env: any;
function dbFor(database: any) {
  return {
    prepare(sql: string) {
      let args: any[] = [];
      const stmt: any = {
        bind(...a: any[]) { args = a; return stmt; },
        async first() { return database.prepare(sql).get(...args) || null; },
        async all() { return { results: database.prepare(sql).all(...args) }; },
        async run() { const r = database.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      };
      return stmt;
    },
    async batch(stmts: any[]) { return Promise.all(stmts.map(s => s.run())); },
  };
}
async function sha256(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function token(username = 'alice', role = 'stock', proofRole = role) {
  const material = username === 'admin' && proofRole === 'owner' ? await sha256('owner-key|admin|OwnerPass123!') : `secret-${username}`;
  const proof = await sha256(`proof|${username}|${proofRole}|${material}|${ip}|none`);
  return btoa(`stock-auth-v2|${username}|${role}|${ip}|none|${proof}`);
}
async function request(method: 'GET' | 'PUT', t?: string, body?: string, query = '', extra: Record<string, string> = {}) {
  return app.fetch(new Request(`http://test.local/api/mobile/snake-score${query}`, {
    method, headers: { ...(t ? { Authorization: `Bearer ${t}` } : {}), 'CF-Connecting-IP': ip, 'Content-Type': 'application/json', ...extra },
    ...(body === undefined ? {} : { body }),
  }), env, {} as any);
}
const json = (score: unknown) => JSON.stringify({ personalBest: score });
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE app_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT, password_salt TEXT DEFAULT '', role TEXT, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
    INSERT INTO app_users (username,password_hash,role) VALUES ('alice','secret-alice','stock'), ('bob','secret-bob','user');`);
  sqlite.exec(up);
  env = { DB: dbFor(sqlite), ADMIN_PASSWORD: 'OwnerPass123!', EMAIL: { send: async () => ({}) } };
});
afterEach(() => sqlite.close());

describe('private mobile Snake personal best', () => {
  it('rejects anonymous requests and mismatched role claims', async () => {
    for (const method of ['GET', 'PUT'] as const) {
      // eslint-disable-next-line no-await-in-loop
      const response = await request(method, undefined, method === 'PUT' ? json(1) : undefined);
      expect(response.status).toBe(401);
      // eslint-disable-next-line no-await-in-loop
      expect((await response.json() as any).code).toBe('UNAUTHORIZED');
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    expect((await request('GET', await token('alice', 'admin', 'stock'))).status).toBe(401);
  });
  it('starts at zero and atomically keeps the maximum for retries and stale devices', async () => {
    const t = await token();
    expect(await (await request('GET', t)).json()).toEqual({ personalBest: 0 });
    for (const [score, expected] of [[0, 0], [123, 123], [2, 123], [123, 123], [150, 150], [2147483647, 2147483647]]) {
      // eslint-disable-next-line no-await-in-loop
      const r = await request('PUT', t, json(score));
      expect(r.status).toBe(200);
      // eslint-disable-next-line no-await-in-loop
      expect(await r.json()).toEqual({ personalBest: expected });
    }
    const get = await request('GET', t);
    expect(get.headers.get('cdn-cache-control')).toBe('no-store');
    expect(await get.json()).toEqual({ personalBest: 2147483647 });
  });
  it('separates accounts and environment owner and rejects any client-selected principal', async () => {
    const a = await token(), b = await token('bob', 'user'), owner = await token('admin', 'owner');
    await request('PUT', a, json(123));
    await request('PUT', b, json(15));
    await request('PUT', owner, json(30));
    expect(await (await request('GET', a)).json()).toEqual({ personalBest: 123 });
    expect(await (await request('GET', b)).json()).toEqual({ personalBest: 15 });
    expect(await (await request('GET', owner)).json()).toEqual({ personalBest: 30 });
    expect((await request('GET', b, undefined, '?username=alice')).status).toBe(422);
    expect((await request('PUT', b, JSON.stringify({ personalBest: 500, username: 'alice' }))).status).toBe(422);
    expect(await (await request('GET', a)).json()).toEqual({ personalBest: 123 });
  });
  it('prevents username reuse inheriting a deleted account score', async () => {
    await request('PUT', await token(), json(123));
    sqlite.exec("DELETE FROM app_users WHERE username='alice'; INSERT INTO app_users (username,password_hash,role) VALUES ('alice','secret-alice','stock')");
    expect(sqlite.prepare('SELECT count(*) AS n FROM snake_personal_best').get().n).toBe(0);
    expect(await (await request('GET', await token())).json()).toEqual({ personalBest: 0 });
  });
  it('validates malformed, missing, invalid, extra and oversized payloads', async () => {
    const t = await token();
    for (const body of ['{', '{}', 'null', '[]', json(-1), json(0.5), json('123'), json(null), json(2147483648), json(9007199254740992), '{"personalBest":1,"role":"owner"}']) {
      // eslint-disable-next-line no-await-in-loop
      const r = await request('PUT', t, body);
      expect(r.status).toBe(422);
      // eslint-disable-next-line no-await-in-loop
      expect((await r.json() as any).code).toBe('VALIDATION');
    }
    expect((await request('PUT', t, ' '.repeat(1025))).status).toBe(413);
    expect(await (await request('GET', t)).json()).toEqual({ personalBest: 0 });
  });
  it('does not expose score table or counts in the admin database migration status', async () => {
    await request('PUT', await token(), json(123));
    const response = await app.fetch(new Request('http://test.local/api/admin/db-migrate/status', {
      headers: { Authorization: `Bearer ${await token('admin', 'owner')}`, 'CF-Connecting-IP': ip },
    }), env, {} as any);
    expect(response.status).toBe(200);
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain('snake_personal_best');
    expect(body).not.toContain('123');
  });
  it('enforces schema ownership and range constraints', () => {
    expect(() => sqlite.exec('INSERT INTO snake_personal_best(personal_best) VALUES (1)')).toThrow();
    expect(() => sqlite.exec('INSERT INTO snake_personal_best(user_id,owner_slot,personal_best) VALUES (1,1,1)')).toThrow();
    expect(() => sqlite.exec('INSERT INTO snake_personal_best(user_id,personal_best) VALUES (1,-1)')).toThrow();
    expect(() => sqlite.exec('INSERT INTO snake_personal_best(user_id,personal_best) VALUES (999,1)')).toThrow();
  });
  it('uses the primary even when a stale bookmark is supplied', async () => {
    const calls: string[] = [];
    const database = env.DB;
    env.DB = { ...database, withSession: (mode: string) => { calls.push(mode); return database; } };
    expect((await request('GET', await token(), undefined, '', { 'x-d1-bookmark': 'old' })).status).toBe(200);
    expect(calls).toEqual(['first-primary']);
  });
  it('rate limits repeated calls using the existing best-effort limiter', async () => {
    sqlite.exec("INSERT INTO app_users (username,password_hash,role) VALUES ('carol','secret-carol','user')");
    const t = await token('carol', 'user');
    let r: Response | undefined;
    for (let i = 0; i < 121; i++) {
      // eslint-disable-next-line no-await-in-loop
      r = await request('GET', t);
    }
    expect(r!.status).toBe(429);
    expect(r!.headers.get('retry-after')).toBeTruthy();
    expect((await r!.json() as any).code).toBe('RATE_LIMITED');
  });
  it('handles concurrent PUTs through the Worker without losing a maximum', async () => {
    const t = await token();
    const scores = [25, 250, 4, 100, 199, 3];
    const responses = await Promise.all(scores.map(score => request('PUT', t, json(score))));
    expect(responses.every(r => r.status === 200)).toBe(true);
    expect(await (await request('GET', t)).json()).toEqual({ personalBest: 250 });
  });
  it('automatically initializes storage when migration 0009 has not been applied', async () => {
    sqlite.exec('DROP TABLE snake_personal_best');
    const t = await token();
    expect(await (await request('GET', t)).json()).toEqual({ personalBest: 0 });
    expect(await (await request('PUT', t, json(42))).json()).toEqual({ personalBest: 42 });
    expect(await (await request('GET', t)).json()).toEqual({ personalBest: 42 });
  });
  it('fails closed if automatic initialization cannot create storage', async () => {
    sqlite.exec('DROP TABLE snake_personal_best');
    const original = env.DB;
    env.DB = { ...original, prepare(sql: string) {
      if (sql.startsWith('CREATE TABLE IF NOT EXISTS snake_personal_best')) throw new Error('unavailable');
      return original.prepare(sql);
    } };
    const r = await request('GET', await token());
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ success: false, error: 'Service indisponible', code: 'SERVICE_UNAVAILABLE' });
  });
});

describe('migration and database concurrency', () => {
  it('upgrades existing accounts, rolls back and can be applied again', () => {
    sqlite.exec(`CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT UNIQUE); INSERT INTO d1_migrations(name) VALUES ('0009_snake_personal_best.sql');`);
    expect(sqlite.prepare('SELECT count(*) n FROM app_users').get().n).toBe(2);
    sqlite.exec("INSERT INTO snake_personal_best (user_id, personal_best) VALUES (1, 22)");
    sqlite.exec(down);
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='snake_personal_best'").get()).toBeUndefined();
    expect(sqlite.prepare('SELECT count(*) n FROM d1_migrations').get().n).toBe(0);
    expect(sqlite.prepare('SELECT count(*) n FROM app_users').get().n).toBe(2);
    sqlite.exec(up);
    expect(sqlite.prepare('SELECT count(*) n FROM snake_personal_best').get().n).toBe(0);
  });
  it('retains the maximum under concurrent SQLite connections', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'atlas-snake-'));
    const file = join(dir, 'db.sqlite');
    const db = new DatabaseSync(file);
    try {
      db.exec('PRAGMA journal_mode=WAL; CREATE TABLE app_users (id INTEGER PRIMARY KEY); INSERT INTO app_users VALUES (1);');
      db.exec(up);
      db.close();
      const barrier = new SharedArrayBuffer(4);
      const code = `const { parentPort, workerData } = require('node:worker_threads');
        const { DatabaseSync } = require('node:sqlite');
        try {
          const db = new DatabaseSync(workerData.file); db.exec('PRAGMA busy_timeout=10000');
          const st = db.prepare('INSERT INTO snake_personal_best (user_id, personal_best) VALUES (1, ?) ON CONFLICT(user_id) DO UPDATE SET personal_best=max(snake_personal_best.personal_best, excluded.personal_best) RETURNING personal_best');
          parentPort.postMessage('ready'); Atomics.wait(new Int32Array(workerData.barrier), 0, 0);
          for (const score of workerData.scores) st.get(score);
          db.close(); parentPort.postMessage('done');
        } catch (e) { parentPort.postMessage({ error: String(e) }); }`;
      const workers = [[50, 2, 12], [200, 1, 8], [80, 3, 7], [9, 1000, 4]].map(scores => new Worker(code, { eval: true, workerData: { file, barrier, scores } }));
      const ready = workers.map(w => new Promise<void>((resolve, reject) => { w.once('message', m => m === 'ready' ? resolve() : reject(new Error(JSON.stringify(m)))); w.once('error', reject); }));
      const done = workers.map(w => new Promise<void>((resolve, reject) => { w.on('message', m => { if (m === 'done') resolve(); else if (m?.error) reject(new Error(m.error)); }); w.once('error', reject); }));
      await Promise.all(ready);
      Atomics.store(new Int32Array(barrier), 0, 1); Atomics.notify(new Int32Array(barrier), 0);
      await Promise.all(done);
      const check = new DatabaseSync(file);
      try { expect(check.prepare('SELECT personal_best FROM snake_personal_best WHERE user_id=1').get().personal_best).toBe(1000); } finally { check.close(); }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
