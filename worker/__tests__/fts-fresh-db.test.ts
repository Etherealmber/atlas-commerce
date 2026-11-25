/**
 * v0.9.3 — fresh databases (new install, every demo sandbox) got
 * « no such column: T.variant_label » + a noisy integrity → rebuild → drop
 * cycle because the FTS index was probed before it existed and the column was
 * only added lazily by the scan routes.
 */
import { describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { ensureProductSearchIndex, proactiveFtsHealth } from '../lib/reliability';

function makeD1() {
  const sqlite = new DatabaseSync(':memory:');
  const db = {
    prepare(sql: string) {
      let params: any[] = [];
      const api: any = {
        bind(...p: any[]) { params = p; return api; },
        async run() { const r = sqlite.prepare(sql).run(...(params as any)); return { success: true, meta: { changes: Number(r.changes || 0) } }; },
        async first() { const r = sqlite.prepare(sql).get(...(params as any)); return r ? { ...(r as any) } : null; },
        async all() { return { results: sqlite.prepare(sql).all(...(params as any)).map((r: any) => ({ ...r })) }; },
      };
      return api;
    },
  };
  return { db: db as unknown as D1Database, sqlite };
}

describe('product search index on a fresh database', () => {
  it('creates the column + index quietly and stays searchable', async () => {
    const { db, sqlite } = makeD1();
    sqlite.exec(`CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, sku TEXT, barcode TEXT, category TEXT);
      INSERT INTO products (name, sku, barcode, category) VALUES ('Carrelage Atlas 60x60', 'CAR-60', '611', 'Carrelage');`);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await proactiveFtsHealth(db);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    const cols = sqlite.prepare('PRAGMA table_info(products)').all().map((r: any) => r.name);
    expect(cols).toContain('variant_label');
    expect(await ensureProductSearchIndex(db)).toBe(true);
    const hit = sqlite.prepare(`SELECT rowid FROM products_fts WHERE products_fts MATCH 'atlas'`).all();
    expect(hit.length).toBe(1);
    warn.mockRestore(); error.mockRestore();
  });
});
