/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { registerCashShiftRoutes } from '../routes/cashShifts';
import { reportShell } from '../routes/reports';

function makeSqliteD1(sqlite: DatabaseSync) {
  function prepare(sql: string) {
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
        const info = sqlite.prepare(sql).run(...this.params);
        return {
          success: true,
          meta: {
            changes: Number(info.changes || 0),
            last_row_id: Number(info.lastInsertRowid || 0),
          },
        };
      },
    };
  }
  return {
    prepare,
    async batch(stmts: any[]) {
      sqlite.exec('BEGIN');
      try {
        const out: any[] = [];
        for (const s of stmts) out.push(await s.run());
        sqlite.exec('COMMIT');
        return out;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  } as unknown as D1Database;
}

function setupCashShiftApp() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now')), username TEXT, role TEXT, action TEXT, entity TEXT, entity_id TEXT, detail TEXT, ip TEXT);
    CREATE TABLE company_settings (id INTEGER PRIMARY KEY, company_name TEXT, report_footer TEXT, notes TEXT);
    INSERT INTO company_settings (id, company_name) VALUES (1, 'Atlas Marbre');
    CREATE TABLE expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, entry_type TEXT, amount REAL, payment_method TEXT, reference TEXT, description TEXT, expense_date TEXT, created_at TEXT);
  `);
  sqlite.exec(readFileSync('migrations/0014_cash_shifts.sql', 'utf8'));
  const db = makeSqliteD1(sqlite);
  const app = new Hono<any>();
  registerCashShiftRoutes(app as any, {
    sessionUserFromHeader: (hdr?: string) => {
      const role = hdr?.replace('Bearer ', '') || '';
      if (!role) return {};
      return { username: `${role}-user`, role };
    },
    writeAudit: async (database, entry) => {
      await database
        .prepare(`INSERT INTO audit_log (username, role, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(entry.username || '', entry.role || '', entry.action, entry.entity || '', entry.entity_id || '', entry.detail || '')
        .run();
    },
    reportShell,
  });
  return { app, env: { DB: db }, sqlite };
}

describe('Part 2 — cash shifts + X/Z-report', () => {
  it('enforces one open shift per till, computes per-method variance, restricts close & Z-reprint to owner/admin, and audits close', async () => {
    const { app, env, sqlite } = setupCashShiftApp();

    // Cashier (user) opens shift with 500 DH float
    const open1 = await app.fetch(
      new Request('http://test.local/api/cash-shifts/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer user' },
        body: JSON.stringify({ till_id: 'CAISSE-1', opening_float: 500 }),
      }),
      env as any,
    );
    expect(open1.status).toBe(201);
    const shiftId = ((await open1.json()) as any).data.id;

    // Duplicate open on same till -> 409 SHIFT_ALREADY_OPEN
    const dup = await app.fetch(
      new Request('http://test.local/api/cash-shifts/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
        body: JSON.stringify({ till_id: 'CAISSE-1', opening_float: 100 }),
      }),
      env as any,
    );
    expect(dup.status).toBe(409);

    // Add cash & card movements
    await app.fetch(
      new Request(`http://test.local/api/cash-shifts/${shiftId}/movements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer user' },
        body: JSON.stringify({ direction: 'in', payment_method: 'cash', amount: 300, label: 'Vente comptoir' }),
      }),
      env as any,
    );
    await app.fetch(
      new Request(`http://test.local/api/cash-shifts/${shiftId}/movements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer user' },
        body: JSON.stringify({ direction: 'in', payment_method: 'card', amount: 150, label: 'TPE' }),
      }),
      env as any,
    );

    // X-report available mid-shift
    const xRes = await app.fetch(
      new Request(`http://test.local/api/cash-shifts/${shiftId}/x-report`, {
        headers: { Authorization: 'Bearer user' },
      }),
      env as any,
    );
    expect(xRes.status).toBe(200);
    const xHtml = await xRes.text();
    expect(xHtml).toContain('Rapport X');
    expect(xHtml).toContain('CAISSE-1');

    // Non-owner/admin (user or secretaire) cannot close or print Z-report
    const closeDenied = await app.fetch(
      new Request(`http://test.local/api/cash-shifts/${shiftId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer secretaire' },
        body: JSON.stringify({ denominations: { '200': 4 } }),
      }),
      env as any,
    );
    expect(closeDenied.status).toBe(403);

    // Admin closes with denominations: 3*200 + 1*100 + 1*50 + 2*20 = 790 (expected 800 -> variance -10)
    const closeOk = await app.fetch(
      new Request(`http://test.local/api/cash-shifts/${shiftId}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin' },
        body: JSON.stringify({
          denominations: { '200': 3, '100': 1, '50': 1, '20': 2 },
          counted_by_method: { card: 150 },
          notes: 'Manque 10 DH',
        }),
      }),
      env as any,
    );
    expect(closeOk.status).toBe(200);
    const closed = ((await closeOk.json()) as any).data;
    expect(closed.status).toBe('closed');
    expect(closed.expected_amount).toBe(800);
    expect(closed.counted_amount).toBe(790);
    expect(closed.variance).toBe(-10);
    expect(closed.summary.methods.card.expected).toBe(150);
    expect(closed.summary.methods.card.variance).toBe(0);

    // Audit recorded
    const audits = sqlite.prepare(`SELECT action FROM audit_log WHERE entity = 'cash_shifts'`).all() as any[];
    expect(audits.map((a) => a.action)).toContain('cash_shift.close');

    // Z-reprint denied to secretaire, allowed to owner + audited
    const zDenied = await app.fetch(
      new Request(`http://test.local/api/cash-shifts/${shiftId}/z-report?reprint=1`, {
        headers: { Authorization: 'Bearer secretaire' },
      }),
      env as any,
    );
    expect(zDenied.status).toBe(403);

    const zOk = await app.fetch(
      new Request(`http://test.local/api/cash-shifts/${shiftId}/z-report?reprint=1`, {
        headers: { Authorization: 'Bearer owner' },
      }),
      env as any,
    );
    expect(zOk.status).toBe(200);
    const zHtml = await zOk.text();
    expect(zHtml).toContain('Rapport Z');
    expect(zHtml).toContain('Manque 10 DH');

    const auditsAfter = sqlite.prepare(`SELECT action FROM audit_log WHERE entity = 'cash_shifts'`).all() as any[];
    expect(auditsAfter.map((a) => a.action)).toContain('cash_shift.z_reprint');
  });
});

describe('X/Z reports opened in a new tab (?token=) on the real worker', () => {
  it('reads the role from the validated query token, without trusting it for other paths', async () => {
    const { default: realApp } = await import('../index');
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      CREATE TABLE app_users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT, password_salt TEXT DEFAULT '', role TEXT, active INTEGER DEFAULT 1, created_at TEXT);
      INSERT INTO app_users VALUES (1,'alice','secret-alice','','admin',1,'2026-01-01');
      CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now')), username TEXT, role TEXT, action TEXT, entity TEXT, entity_id TEXT, detail TEXT, ip TEXT);
    `);
    const env = { DB: makeSqliteD1(sqlite), ADMIN_PASSWORD: 'OwnerPass123!', JWT_SECRET: 'cash-test-secret' } as any;
    const ip = '203.0.113.57';
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`proof|alice|admin|secret-alice|${ip}|none`));
    const proof = [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const tok = btoa(`stock-auth-v2|alice|admin|${ip}|none|${proof}`);
    const get = (path: string, t: string) =>
      realApp.fetch(new Request(`http://test.local${path}?token=${encodeURIComponent(t)}`, { headers: { 'CF-Connecting-IP': ip } }), env, {} as any);

    // Shift 999 does not exist: getting past the role gate means 404 (was 403 FORBIDDEN_ROLE).
    for (const kind of ['x', 'z']) {
      const res = await get(`/api/cash-shifts/999/${kind}-report`, tok);
      expect(res.status).toBe(404);
    }
    // A forged token is still rejected by the global gate before the handler.
    const forged = btoa(`stock-auth-v2|alice|owner|${ip}|none|${'0'.repeat(64)}`);
    const bad = await get('/api/cash-shifts/999/z-report', forged);
    expect(bad.status).toBe(401);
  });
});
