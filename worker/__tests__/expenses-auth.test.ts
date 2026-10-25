/**
 * v264 — Authorization & validation tests for the ledger WRITE routes
 * (POST /api/expenses, POST /api/expenses/import), now extracted into
 * routes/expenses.ts with an explicit owner/admin gate.
 *
 * Audit finding covered here: both routes previously sat behind the generic
 * /api/* authentication middleware ONLY — any authenticated role ('stock',
 * 'user', 'secretaire'…) could insert ledger rows, including owner movements
 * (entry_type owner_contrib / owner_draw). These tests lock the contract:
 *  - owner/admin  → 201 + persisted row + dashboard-cache invalidation + audit;
 *  - any other authenticated role → 403 OWNER_ONLY, nothing persisted;
 *  - missing/invalid session → 401;
 *  - validation → 422 VALIDATION (amount bounds) / 400 (missing description),
 *    entry_type whitelist coerces unknown values to 'expense'.
 *
 * Real integration: the route module runs against an in-process SQLite
 * (node:sqlite) wrapped in a D1-compatible shim — same harness style as
 * finance.test.ts — through a REAL Hono app.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
// node:sqlite (Node ≥ 22.5) — imported dynamically because the repo has no
// @types/node; the shim below is deliberately any-typed (test harness only).
const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };
type DatabaseSync = any;
import { Hono } from 'hono';
import { registerExpenseWriteRoutes } from '../routes/expenses';

/* ─────────────────────────── D1 shim over node:sqlite ─────────────────────────── */

function makeD1() {
  const sqlite = new DatabaseSync(':memory:');
  const db = {
    prepare(sql: string) {
      let params: any[] = [];
      const api: any = {
        bind(...p: any[]) { params = p; return api; },
        async run() {
          const s = sqlite.prepare(sql);
          const r = s.run(...(params as any));
          return { success: true, meta: { changes: Number(r.changes || 0), last_row_id: Number(r.lastInsertRowid || 0) } };
        },
        async first() {
          const s = sqlite.prepare(sql);
          const r = s.get(...(params as any));
          return r === undefined ? null : { ...(r as any) };
        },
        async all() {
          const s = sqlite.prepare(sql);
          const rows = s.all(...(params as any)).map((r: any) => ({ ...r }));
          return { success: true, results: rows, meta: {} };
        },
      };
      return api;
    },
  } as unknown as D1Database;
  return { db, sqlite };
}

/* ─────────────────────────── session fixtures ─────────────────────────── */

const SESSIONS: Record<string, { username: string; role: string }> = {
  'owner-tok': { username: 'boss', role: 'owner' },
  'admin-tok': { username: 'adm', role: 'admin' },
  'sec-tok': { username: 'sec', role: 'secretaire' },
  'stock-tok': { username: 'mag', role: 'stock' },
  'user-tok': { username: 'usr', role: 'user' },
  // A token the auth layer rejects (expired/revoked) — sessionUserFromHeader
  // still decodes a role but authFailReason says no.
  'bad-tok': { username: 'ghost', role: 'owner' },
};

let db: D1Database;
let sqlite: DatabaseSync;
let app: Hono<any>;
let env: any;
// any-typed spies (test harness only — the deps contract is asserted below).
let invalidateSpy: any;
let auditSpy: any;

beforeEach(() => {
  const made = makeD1();
  db = made.db;
  sqlite = made.sqlite;
  sqlite.exec(`
    CREATE TABLE expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT DEFAULT '', description TEXT DEFAULT '', amount REAL DEFAULT 0,
      payment_method TEXT DEFAULT 'cash', expense_date TEXT DEFAULT '',
      vendor_name TEXT DEFAULT '', reference TEXT DEFAULT '', notes TEXT DEFAULT '',
      entry_type TEXT DEFAULT 'expense', created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  invalidateSpy = vi.fn(async () => {});
  auditSpy = vi.fn(async () => {});
  env = { DB: db, CACHE: {} };
  app = new Hono();
  registerExpenseWriteRoutes(app as any, {
    sessionUserFromHeader: (h) => {
      const tok = String(h || '').replace(/^Bearer\s+/i, '').trim();
      return SESSIONS[tok] || { username: '', role: '' };
    },
    authFailReason: async (h) => {
      const tok = String(h || '').replace(/^Bearer\s+/i, '').trim();
      if (!tok) return 'missing';
      if (tok === 'bad-tok') return 'invalid';
      return SESSIONS[tok] ? 'ok' : 'invalid';
    },
    clientIp: () => '203.0.113.9',
    ensureExpenseTypeColumn: async () => {},
    invalidateDashboardCache: invalidateSpy,
    writeAudit: auditSpy,
  });
});

function call(path: string, body: unknown, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token !== undefined) headers.Authorization = `Bearer ${token}`;
  return app.fetch(
    new Request(`http://test.local${path}`, { method: 'POST', headers, body: JSON.stringify(body) }),
    env,
  );
}

async function rowCount(): Promise<number> {
  const r = await (db as any).prepare('SELECT COUNT(*) c FROM expenses').first();
  return Number(r?.c || 0);
}

const VALID = {
  category: 'Loyer',
  description: 'Loyer local septembre',
  amount: 1500.5,
  payment_method: 'bank',
  expense_date: '2026-09-05',
  vendor_name: 'SCI Atlas',
  reference: 'LOY-09',
  notes: 'virement',
  entry_type: 'expense',
};

/* ─────────────────────────── authorization ─────────────────────────── */

describe('POST /api/expenses — owner/admin authorization (v264 audit fix)', () => {
  it('owner can create a ledger entry (201, persisted, cache invalidated, audited)', async () => {
    const res = await call('/api/expenses', { ...VALID, entry_type: 'owner_contrib' }, 'owner-tok');
    expect(res.status).toBe(201);
    const j: any = await res.json();
    expect(j.success).toBe(true);
    expect(j.data?.description).toBe('Loyer local septembre');
    // owner movements are exactly what the gate must protect — owner keeps them.
    expect(j.data?.entry_type).toBe('owner_contrib');
    expect(j.message).toContain('enregistrée');
    expect(await rowCount()).toBe(1);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy).toHaveBeenCalledTimes(1);
    expect(auditSpy.mock.calls[0][1]).toMatchObject({ username: 'boss', role: 'owner', action: 'expense.create' });
  });

  it('admin can create a ledger entry (201)', async () => {
    const res = await call('/api/expenses', VALID, 'admin-tok');
    expect(res.status).toBe(201);
    const j: any = await res.json();
    expect(j.success).toBe(true);
    expect(j.data?.entry_type).toBe('expense');
    expect(await rowCount()).toBe(1);
  });

  it.each([
    ['secretaire', 'sec-tok'],
    ['stock', 'stock-tok'],
    ['user', 'user-tok'],
  ])('%s is refused (403 OWNER_ONLY) and nothing is persisted', async (_label, tok) => {
    const res = await call('/api/expenses', VALID, tok);
    expect(res.status).toBe(403);
    const j: any = await res.json();
    expect(j.success).toBe(false);
    expect(j.code).toBe('OWNER_ONLY');
    expect(await rowCount()).toBe(0);
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it('secretaire cannot create owner movements either (the pre-fix hole)', async () => {
    const res = await call('/api/expenses', { ...VALID, entry_type: 'owner_draw', amount: 99999 }, 'sec-tok');
    expect(res.status).toBe(403);
    expect(await rowCount()).toBe(0);
  });

  it('missing Authorization → 401', async () => {
    const res = await call('/api/expenses', VALID);
    expect(res.status).toBe(401);
    const j: any = await res.json();
    expect(j.success).toBe(false);
    expect(j.code).toBe('UNAUTHORIZED');
    expect(await rowCount()).toBe(0);
  });

  it('session rejected by the auth layer → 401 even if the token decodes owner', async () => {
    const res = await call('/api/expenses', VALID, 'bad-tok');
    expect(res.status).toBe(401);
    expect(await rowCount()).toBe(0);
  });
});

describe('POST /api/expenses — validation contract (unchanged, French)', () => {
  it('amount below the minimum → 422 VALIDATION with field details', async () => {
    const res = await call('/api/expenses', { ...VALID, amount: 0 }, 'owner-tok');
    expect(res.status).toBe(422);
    const j: any = await res.json();
    expect(j.code).toBe('VALIDATION');
    expect(j.details?.amount).toBeTruthy();
    expect(await rowCount()).toBe(0);
  });

  it('non-numeric amount → 422 VALIDATION', async () => {
    const res = await call('/api/expenses', { ...VALID, amount: 'abc' }, 'owner-tok');
    expect(res.status).toBe(422);
    expect((await res.json() as any).code).toBe('VALIDATION');
  });

  it('negative amount → 422 VALIDATION', async () => {
    const res = await call('/api/expenses', { ...VALID, amount: -5 }, 'admin-tok');
    expect(res.status).toBe(422);
  });

  it('missing description → 400 with the French obligation message', async () => {
    const res = await call('/api/expenses', { amount: 25 }, 'owner-tok');
    expect(res.status).toBe(400);
    const j: any = await res.json();
    expect(j.success).toBe(false);
    expect(j.error).toBe('La description et le montant sont obligatoires');
    expect(await rowCount()).toBe(0);
  });

  it('unknown entry_type is coerced to expense (whitelist)', async () => {
    const res = await call('/api/expenses', { ...VALID, entry_type: 'money-printer' }, 'owner-tok');
    expect(res.status).toBe(201);
    const j: any = await res.json();
    expect(j.data?.entry_type).toBe('expense');
  });

  it('income entry returns the Recette message', async () => {
    const res = await call('/api/expenses', { ...VALID, entry_type: 'income', description: 'Vente marché' }, 'owner-tok');
    expect(res.status).toBe(201);
    const j: any = await res.json();
    expect(j.message).toBe('Recette enregistrée dans la base de données.');
    expect(j.data?.entry_type).toBe('income');
  });
});

/* ─────────────────────────── bulk import ─────────────────────────── */

describe('POST /api/expenses/import — same owner/admin gate + row rules', () => {
  const ROWS = {
    rows: [
      { amount: 50, description: 'Taxi', date: '2026-09-01' },
      { amount: 0, description: 'ligne ignorée (montant invalide)' },
      { amount: 25, description: 'Recette kiosque', direction: 'in', date: '2026-09-02' },
    ],
  };

  it('owner imports valid rows only, direction "in" becomes income', async () => {
    const res = await call('/api/expenses/import', ROWS, 'owner-tok');
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j.success).toBe(true);
    expect(j.count).toBe(2);
    expect(await rowCount()).toBe(2);
    const income = await (db as any)
      .prepare(`SELECT entry_type, category FROM expenses WHERE description = 'Recette kiosque'`)
      .first();
    expect(income.entry_type).toBe('income');
    expect(income.category).toBe('Import Excel');
    expect(auditSpy.mock.calls[0][1]).toMatchObject({ action: 'expense.import', username: 'boss' });
  });

  it('admin can import (200)', async () => {
    const res = await call('/api/expenses/import', ROWS, 'admin-tok');
    expect(res.status).toBe(200);
    expect(await rowCount()).toBe(2);
  });

  it.each(['sec-tok', 'stock-tok', 'user-tok'])('%s cannot import (403, nothing persisted)', async (tok) => {
    const res = await call('/api/expenses/import', ROWS, tok);
    expect(res.status).toBe(403);
    expect((await res.json() as any).code).toBe('OWNER_ONLY');
    expect(await rowCount()).toBe(0);
  });

  it('empty rows → 400', async () => {
    const res = await call('/api/expenses/import', { rows: [] }, 'owner-tok');
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toBe('Aucune ligne à importer');
  });

  it('unauthenticated import → 401', async () => {
    const res = await call('/api/expenses/import', ROWS);
    expect(res.status).toBe(401);
    expect(await rowCount()).toBe(0);
  });
});
