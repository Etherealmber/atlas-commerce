/**
 * Regression guard: the dashboard payload is cached (DO/KV/memory); a successful
 * business write (afterBusinessMutation) must make the next GET recompute.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };
import app from '../index';

describe('dashboard cache freshness after writes', () => {
  let sqlite: any;
  let env: any;
  const ip = '203.0.113.231';

  function dbFor(database: any) {
    return {
      prepare(sql: string) {
        let args: any[] = [];
        const stmt: any = {
          bind(...a: any[]) { args = a; return stmt; },
          async first() { return database.prepare(sql).get(...args) || null; },
          async all() { return { results: database.prepare(sql).all(...args) }; },
          async run() {
            const r = database.prepare(sql).run(...args);
            return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
          },
        };
        return stmt;
      },
      async batch(stmts: any[]) {
        database.exec('BEGIN');
        try {
          const out = [];
          for (const stmt of stmts) out.push(await stmt.run());
          database.exec('COMMIT');
          return out;
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      },
    };
  }

  async function sha256(text: string) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  async function ownerToken() {
    const material = await sha256('owner-key|admin|OwnerPass123!');
    const proof = await sha256(`proof|admin|owner|${material}|${ip}|none`);
    return btoa(`stock-auth-v2|admin|owner|${ip}|none|${proof}`);
  }
  async function call(path: string, tok: string, method = 'GET', body?: unknown) {
    const res = await app.fetch(
      new Request(`http://test.local${path}`, {
        method,
        headers: { 'CF-Connecting-IP': ip, 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
      { waitUntil() {}, passThroughOnException() {} } as any,
    );
    return { status: res.status, body: (await res.json().catch(() => null)) as any };
  }
  const thisMonth = () => new Date().toISOString().slice(0, 7);

  beforeAll(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'));
    sqlite.exec(`ALTER TABLE invoices ADD COLUMN doc_kind TEXT DEFAULT '';`);
    env = { DB: dbFor(sqlite), ADMIN_PASSWORD: 'OwnerPass123!', EMAIL: { send: async () => ({}) } };
  });
  afterAll(() => sqlite.close());

  it('serves the cache between reads, refreshes after a successful client create, not after a rejected write', async () => {
    const tok = await ownerToken();
    const first = await call('/api/dashboard', tok);
    expect(first.status).toBe(200);
    const cur = (d: any) => d.data.monthlySeries.find((s: any) => s.key === thisMonth());
    const before = cur(first.body).clients_new;

    const second = await call('/api/dashboard', tok);
    expect(second.body.meta.cache).toBe('hit');

    // Rejected write (validation error) must not invalidate.
    const bad = await call('/api/clients', tok, 'POST', {});
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect((await call('/api/dashboard', tok)).body.meta.cache).toBe('hit');

    const created = await call('/api/clients', tok, 'POST', { name: 'Client Frais' });
    expect(created.status).toBeLessThan(300);

    const fresh = await call('/api/dashboard', tok);
    expect(fresh.body.meta.cache).toBe('miss');
    expect(cur(fresh.body).clients_new).toBe(before + 1);
  });
});
