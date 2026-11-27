import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ensureAutoSqlMigrations, requiresAutoSqlMigrations } from '../lib/autoMigrations';
import { registerDbRoot } from '../lib/schema';

const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = await import(SQLITE_MODULE);

function makeTestD1() {
  const sqlite = new DatabaseSync(':memory:');
  const statements: string[] = [];
  const errors: string[] = [];
  const db: any = {
    prepare(sql: string) {
      let params: any[] = [];
      function exec(mode: 'run' | 'get' | 'all') {
        statements.push(sql);
        try {
          return sqlite.prepare(sql)[mode](...params);
        } catch (e) {
          errors.push(String(e));
          throw e;
        }
      }
      const stmt: any = {
        bind(...values: any[]) {
          params = values;
          return stmt;
        },
        async run() {
          const r = exec('run');
          return { success: true, meta: { changes: Number(r.changes || 0) } };
        },
        async first() {
          return exec('get') ?? null;
        },
        async all() {
          return { success: true, results: exec('all') };
        },
      };
      return stmt;
    },
  };
  return { db, sqlite, statements, errors };
}

describe('ensureAutoSqlMigrations (0013–0020 auto-applied at runtime)', () => {
  it('provisions all tables, indexes, and default seed rows on a fresh database with zero SQL errors', async () => {
    const { db, sqlite, errors } = makeTestD1();
    try {
      await ensureAutoSqlMigrations(db);
      expect(errors).toEqual([]);

      const tables = (sqlite
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all() as Array<{ name: string }>).map((r) => r.name);

      expect(tables).toEqual(
        expect.arrayContaining([
          'offline_idempotency',
          'stock_location_revisions',
          'stock_movements',
          'cash_shifts',
          'cash_shift_movements',
          'employee_attendance',
          'payroll_settings',
          'payroll_runs',
          'payroll_lines',
          'accounting_accounts',
          'dunning_settings',
          'dunning_invoice_overrides',
          'dunning_events',
          'dgi_clearance',
          'dgi_status_events',
        ]),
      );

      expect((sqlite.prepare(`SELECT COUNT(*) AS c FROM payroll_settings`).get() as any).c).toBe(1);
      expect((sqlite.prepare(`SELECT COUNT(*) AS c FROM accounting_accounts`).get() as any).c).toBe(15);
      expect((sqlite.prepare(`SELECT COUNT(*) AS c FROM dunning_settings`).get() as any).c).toBe(1);
    } finally {
      sqlite.close();
    }
  });

  it('auto-upgrades legacy 0013 offline_idempotency and stock_location_revisions (TEXT -> INTEGER) preserving data', async () => {
    const { db, sqlite, errors } = makeTestD1();
    try {
      sqlite.exec(readFileSync('migrations/0013_offline_operations.sql', 'utf8'));
      sqlite.exec(`
        INSERT INTO offline_idempotency (key, device_id, op, request_hash, status, response, created_at)
        VALUES ('k-1', 'dev-a', 'receive', 'h1', 200, '{"ok":true}', '2026-10-20T00:00:00Z');
        INSERT INTO stock_location_revisions (product_id, location_id, revision, updated_at)
        VALUES ('42', '3', 7, '2026-10-20T00:00:00Z');
      `);

      await ensureAutoSqlMigrations(db);
      expect(errors).toEqual([]);

      const idemCols = sqlite.prepare(`PRAGMA table_info(offline_idempotency)`).all() as Array<{ name: string; pk: number }>;
      expect(idemCols.find((c) => c.name === 'account_id')?.pk).toBeGreaterThan(0);
      expect(idemCols.find((c) => c.name === 'key')?.pk).toBeGreaterThan(0);
      expect(idemCols.some((c) => c.name === 'kind')).toBe(true);

      const revCols = sqlite.prepare(`PRAGMA table_info(stock_location_revisions)`).all() as Array<{ name: string; type: string }>;
      expect(revCols.find((c) => c.name === 'product_id')?.type.toUpperCase()).toBe('INTEGER');
      expect(revCols.find((c) => c.name === 'location_id')?.type.toUpperCase()).toBe('INTEGER');

      const revRow = sqlite
        .prepare(`SELECT product_id, location_id, revision FROM stock_location_revisions WHERE product_id = 42 AND location_id = 3`)
        .get() as any;
      expect(revRow).toEqual({ product_id: 42, location_id: 3, revision: 7 });

      const idemRow = sqlite
        .prepare(`SELECT account_id, key, kind FROM offline_idempotency WHERE key = 'k-1'`)
        .get() as any;
      expect(idemRow).toEqual({ account_id: 'default', key: 'k-1', kind: 'receive' });
    } finally {
      sqlite.close();
    }
  });

  it('runs only once per root D1 binding across multiple withSession() wrappers', async () => {
    const { db, sqlite, statements } = makeTestD1();
    try {
      const session1 = { ...db };
      const session2 = { ...db };
      registerDbRoot(session1, db);
      registerDbRoot(session2, db);

      await ensureAutoSqlMigrations(session1 as any);
      const countAfterFirst = statements.length;
      expect(countAfterFirst).toBeGreaterThan(0);

      await ensureAutoSqlMigrations(session2 as any);
      expect(statements.length).toBe(countAfterFirst);
    } finally {
      sqlite.close();
    }
  });
});

it('only lets explicitly reviewed read paths bypass the unrelated initialization barrier', () => {
  for (const path of ['/api/dashboard', '/api/admin/journal-mode', '/api/admin/journal-archive', '/api/admin/journal-archive/item']) {
    expect(requiresAutoSqlMigrations('GET', path)).toBe(false);
    expect(requiresAutoSqlMigrations('POST', path)).toBe(true);
  }
  for (const path of ['/api/stock/receive', '/api/payroll', '/api/assist/approve', '/api/dashboard/anything']) expect(requiresAutoSqlMigrations('GET', path)).toBe(true);
});

it('skips the unrelated schema barrier only for reviewed agent chat and thread reads', () => {
  for (const path of ['/api/assist/chat', '/api/assist/chat/stream']) {
    expect(requiresAutoSqlMigrations('POST', path)).toBe(false);
    expect(requiresAutoSqlMigrations('GET', path)).toBe(true);
  }
  expect(requiresAutoSqlMigrations('GET', '/api/admin/agent/threads')).toBe(false);
  expect(requiresAutoSqlMigrations('GET', '/api/admin/agent/threads/abc')).toBe(false);
  expect(requiresAutoSqlMigrations('PUT', '/api/admin/agent/threads/abc')).toBe(false);
  expect(requiresAutoSqlMigrations('DELETE', '/api/admin/agent/threads/abc')).toBe(true);
  expect(requiresAutoSqlMigrations('POST', '/api/assist/approve')).toBe(true);
});
