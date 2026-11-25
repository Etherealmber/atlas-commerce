/**
 * D1 read budget of the schema helpers: `addColumnIfMissing` reads
 * `PRAGMA table_info` once per table per binding, `tableExists` remembers
 * positive answers, and a table rebuild (`forgetTableSchema`) re-reads.
 * Also checks migration 0023 applies on a fresh migrated database.
 */
import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { addColumnIfMissing, forgetTableSchema, tableExists } from '../lib/schema';

function makeCountingD1(sqlite: DatabaseSync) {
  const log: string[] = [];
  function prepare(sql: string) {
    log.push(sql);
    return {
      params: [] as any[],
      bind(...params: any[]) {
        this.params = params;
        return this;
      },
      async first() {
        const row = sqlite.prepare(sql).get(...this.params);
        return row === undefined ? null : { ...(row as any) };
      },
      async all() {
        const rows = sqlite.prepare(sql).all(...this.params).map((r: any) => ({ ...r }));
        return { success: true, results: rows, meta: {} };
      },
      async run() {
        sqlite.prepare(sql).run(...this.params);
        return { success: true, meta: {} };
      },
    };
  }
  return { db: { prepare } as unknown as D1Database, log };
}

const count = (log: string[], re: RegExp) => log.filter((s) => re.test(s)).length;

describe('schema helpers read budget', () => {
  it('addColumnIfMissing issues one PRAGMA per table, then answers from memory', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('CREATE TABLE widgets (id INTEGER PRIMARY KEY, name TEXT)');
    const { db, log } = makeCountingD1(sqlite);

    await addColumnIfMissing(db, 'widgets', 'name', 'TEXT');
    await addColumnIfMissing(db, 'widgets', 'color', `TEXT DEFAULT ''`);
    await addColumnIfMissing(db, 'widgets', 'color', `TEXT DEFAULT ''`);
    await addColumnIfMissing(db, 'widgets', 'NAME', 'TEXT');
    await addColumnIfMissing(db, 'widgets', 'size', 'INTEGER');

    expect(count(log, /PRAGMA table_info/)).toBe(1);
    expect(count(log, /ALTER TABLE widgets ADD COLUMN color/)).toBe(1);
    expect(count(log, /ALTER TABLE widgets ADD COLUMN size/)).toBe(1);
    const cols = sqlite.prepare('PRAGMA table_info(widgets)').all().map((r: any) => r.name);
    expect(cols).toEqual(['id', 'name', 'color', 'size']);
  });

  it('never issues ALTER on a missing table and re-checks it later', async () => {
    const sqlite = new DatabaseSync(':memory:');
    const { db, log } = makeCountingD1(sqlite);
    await addColumnIfMissing(db, 'ghosts', 'x', 'TEXT');
    expect(count(log, /ALTER TABLE/)).toBe(0);
    sqlite.exec('CREATE TABLE ghosts (id INTEGER)');
    await addColumnIfMissing(db, 'ghosts', 'x', 'TEXT');
    expect(count(log, /ALTER TABLE ghosts ADD COLUMN x/)).toBe(1);
  });

  it('tableExists caches positive answers only', async () => {
    const sqlite = new DatabaseSync(':memory:');
    const { db, log } = makeCountingD1(sqlite);
    expect(await tableExists(db, 'later')).toBe(false);
    expect(await tableExists(db, 'later')).toBe(false);
    expect(count(log, /sqlite_master/)).toBe(2);
    sqlite.exec('CREATE TABLE later (id INTEGER)');
    expect(await tableExists(db, 'later')).toBe(true);
    expect(await tableExists(db, 'later')).toBe(true);
    expect(await tableExists(db, 'later')).toBe(true);
    expect(count(log, /sqlite_master/)).toBe(3);
  });

  it('forgetTableSchema makes the next call re-read the rebuilt table', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('CREATE TABLE t (id INTEGER, a TEXT)');
    const { db, log } = makeCountingD1(sqlite);
    await addColumnIfMissing(db, 't', 'a', 'TEXT');
    // Rebuild without column a (like a _v2 + RENAME migration).
    sqlite.exec('CREATE TABLE t_v2 (id INTEGER); DROP TABLE t; ALTER TABLE t_v2 RENAME TO t;');
    forgetTableSchema(db, 't');
    await addColumnIfMissing(db, 't', 'a', 'TEXT');
    expect(count(log, /PRAGMA table_info/)).toBe(2);
    const cols = sqlite.prepare('PRAGMA table_info(t)').all().map((r: any) => r.name);
    expect(cols).toEqual(['id', 'a']);
  });
});

describe('migration 0023 — partner lookup indexes', () => {
  it('applies on a fresh migrated database and creates the indexes', () => {
    const sqlite = new DatabaseSync(':memory:');
    const dir = new URL('../../migrations/', import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    expect(files).toContain('0023_partner_lookup_indexes.sql');
    for (const f of files) sqlite.exec(readFileSync(new URL(f, dir), 'utf8'));
    const names = sqlite
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_invoices_client','idx_invoices_created','idx_bills_vendor','idx_receipts_invoice')`)
      .all()
      .map((r: any) => r.name)
      .sort();
    expect(names).toEqual(['idx_bills_vendor', 'idx_invoices_client', 'idx_invoices_created', 'idx_receipts_invoice']);
    // Re-running is a no-op.
    sqlite.exec(readFileSync(new URL('0023_partner_lookup_indexes.sql', dir), 'utf8'));
  });
});
