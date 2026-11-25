import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { addColumnIfMissing, knownTableColumns } from '../lib/schema';

function fakeDb(tables: Record<string, string[]>) {
  const calls: string[] = [];
  const db: any = {
    prepare(sql: string) {
      calls.push(sql);
      const stmt: any = {
        bind: () => stmt,
        async all() {
          const m = /PRAGMA table_info\((\w+)\)/.exec(sql);
          const cols = m ? tables[m[1]] || [] : [];
          return { results: cols.map((name) => ({ name })) };
        },
        async first() {
          return null;
        },
        async run() {
          const m = /ALTER TABLE (\w+) ADD COLUMN (\w+)/.exec(sql);
          if (m) (tables[m[1]] ||= []).push(m[2]);
          return { success: true };
        },
      };
      return stmt;
    },
  };
  return { db, calls };
}

describe('knownTableColumns — product list structure check is memoised', () => {
  it('reads PRAGMA once per binding, then answers from memory', async () => {
    const { db, calls } = fakeDb({ products: ['id', 'Name', 'image_url'] });
    const a = await knownTableColumns(db, 'products');
    const b = await knownTableColumns(db, 'products');
    expect([...(a || [])]).toEqual(['id', 'name', 'image_url']);
    expect(b).toBe(a);
    expect(calls.filter((s) => s.startsWith('PRAGMA'))).toHaveLength(1);
  });

  it('never caches a missing table', async () => {
    const { db, calls } = fakeDb({});
    expect(await knownTableColumns(db, 'products')).toBeNull();
    expect(await knownTableColumns(db, 'products')).toBeNull();
    expect(calls.filter((s) => s.startsWith('PRAGMA'))).toHaveLength(2);
  });

  it('shares its cache with addColumnIfMissing (new column visible, no extra PRAGMA)', async () => {
    const { db, calls } = fakeDb({ products: ['id'] });
    await knownTableColumns(db, 'products');
    await addColumnIfMissing(db, 'products', 'created_by', 'TEXT');
    const cols = await knownTableColumns(db, 'products');
    expect(cols?.has('created_by')).toBe(true);
    expect(calls.filter((s) => s.startsWith('PRAGMA'))).toHaveLength(1);
  });

  it('the /api/products light path and barcode scan use the memoised helper', () => {
    const src = readFileSync(resolve(__dirname, '../routes/productsScan.ts'), 'utf8');
    expect(src).toContain("light ? await lightProductColumns(c.env.DB) : null");
    expect(src).toContain("const scanColumns = await lightProductColumns(c.env.DB)");
  });

  it('the Dashboard refresh asks for the light product projection', () => {
    const src = readFileSync(resolve(__dirname, '../../src/pages/Dashboard.tsx'), 'utf8');
    expect(src).toContain("api.getProducts({ include_variants: true, fields: 'light' })");
  });
});
