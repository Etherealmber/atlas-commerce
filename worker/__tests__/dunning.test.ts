/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { registerDunningRoutes, runDailyDunning } from '../routes/dunning';

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
  return { prepare } as unknown as D1Database;
}

function setupDunningApp() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now')), username TEXT, role TEXT, action TEXT, entity TEXT, entity_id TEXT, detail TEXT, ip TEXT);
    CREATE TABLE company_settings (id INTEGER PRIMARY KEY, company_name TEXT, currency TEXT);
    INSERT INTO company_settings (id, company_name, currency) VALUES (1, 'Atlas Marbre', 'MAD');
    CREATE TABLE clients (id INTEGER PRIMARY KEY, name TEXT, email TEXT, phone TEXT, ice TEXT);
    INSERT INTO clients (id, name, email, phone, ice) VALUES (1, 'BatiMaroc', 'compta@batimaroc.ma', '0661234567', '001122334455667');
    CREATE TABLE invoices (id INTEGER PRIMARY KEY, number TEXT UNIQUE NOT NULL, due_date TEXT, total REAL, amount_paid REAL, status TEXT, doc_kind TEXT, client_id INTEGER, client_name TEXT, client_email TEXT, client_phone TEXT, client_ice TEXT);
    INSERT INTO invoices (id, number, due_date, total, amount_paid, status, doc_kind, client_id, client_name) VALUES (1, 'FAC-2026-010', '2026-11-23', 5000, 1000, 'partial', 'invoice', 1, 'BatiMaroc');
    INSERT INTO invoices (id, number, due_date, total, amount_paid, status, doc_kind, client_id, client_name) VALUES (2, 'FAC-2026-011', '2026-11-23', 2000, 0, 'sent', 'invoice', 1, 'BatiMaroc');
  `);

  const db = makeSqliteD1(sqlite);
  const app = new Hono<any>();
  registerDunningRoutes(app as any, {
    requireEmployeeAdmin: async () => null,
    sessionUserFromHeader: () => ({ username: 'owner', role: 'owner' }),
    writeAudit: async (database, entry) => {
      await database
        .prepare(`INSERT INTO audit_log (username, role, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(entry.username || '', entry.role || '', entry.action, entry.entity || '', entry.entity_id || '', entry.detail || '')
        .run();
    },
    clientIp: () => '127.0.0.1',
  });
  return { app, db, sqlite };
}

describe('Part 6 — unpaid invoice dunning', () => {
  it('renders templates with client/amount/due_date/invoice_number/ICE, builds wa.me link, pauses per invoice, and deduplicates daily cron runs', async () => {
    const { app, db } = setupDunningApp();

    // Enable dunning with D+1 stage
    await app.fetch(
      new Request('http://test.local/api/dunning/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, stages: ['D-3', 'D+1', 'D+7', 'D+15'] }),
      }),
      { DB: db } as any,
    );

    // Pause invoice #2
    await app.fetch(
      new Request('http://test.local/api/dunning/invoices/2/pause', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: true, reason: 'Litige livraison' }),
      }),
      { DB: db } as any,
    );

    // Check rendered template & wa.me link for invoice #1 (remaining = 4000)
    const infoRes = await app.fetch(new Request('http://test.local/api/dunning/invoices/1'), { DB: db } as any);
    expect(infoRes.status).toBe(200);
    const info = ((await infoRes.json()) as any).data;
    expect(info.remaining).toBe(4000);
    expect(info.rendered_email).toContain('BatiMaroc');
    expect(info.rendered_email).toContain('FAC-2026-010');
    expect(info.rendered_email).toContain('001122334455667');
    expect(info.whatsapp_url).toMatch(/^https:\/\/wa\.me\/212661234567\?text=/);

    // Mock Cloudflare EMAIL binding
    const sentEmails: any[] = [];
    const env = {
      DB: db,
      EMAIL: {
        async send(msg: any) {
          sentEmails.push(msg);
        },
      },
    };

    // Run daily dunning for 2026-11-24 (due_date 2026-11-23 => D+1): only invoice #1 sent (#2 paused)
    const run1 = await runDailyDunning(env, { today: '2026-11-24' });
    expect(run1.skipped).toBe(false);
    expect(run1.sent).toBe(1);
    expect(sentEmails.length).toBe(1);
    expect(sentEmails[0].to).toBe('compta@batimaroc.ma');

    // Second run same day -> dedup prevents double-send!
    const run2 = await runDailyDunning(env, { today: '2026-11-24' });
    expect(run2.sent).toBe(0);
    expect(sentEmails.length).toBe(1);
  });

  it('returns 200 on GET /api/dunning/invoices/:id against real schema.sql (number column, not invoice_number)', async () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(readFileSync('schema.sql', 'utf8'));
    sqlite.exec(`CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now')), username TEXT, role TEXT, action TEXT, entity TEXT, entity_id TEXT, detail TEXT, ip TEXT);`);
    sqlite.prepare(`INSERT INTO clients (id, name, email, phone, ice) VALUES (1, 'Marbre Sud', 'm@sud.ma', '0660000000', '001122334455667')`).run();
    sqlite
      .prepare(`INSERT INTO invoices (id, number, client_id, client_name, issue_date, due_date, status, total, amount_paid) VALUES (1, 'INV-2026-042', 1, 'Marbre Sud', '2026-11-01', '2026-11-15', 'sent', 3000, 500)`)
      .run();

    const db = makeSqliteD1(sqlite);
    const app = new Hono<any>();
    registerDunningRoutes(app as any, {
      requireEmployeeAdmin: async () => null,
      sessionUserFromHeader: () => ({ username: 'owner', role: 'owner' }),
      writeAudit: async () => {},
      clientIp: () => '127.0.0.1',
    });

    const res = await app.fetch(new Request('http://test.local/api/dunning/invoices/1'), { DB: db } as any);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.invoice_id).toBe(1);
    expect(json.data.remaining).toBe(2500);
    expect(json.data.rendered_subject).toContain('INV-2026-042');
    expect(json.data.rendered_email).toContain('INV-2026-042');
    expect(json.data.rendered_whatsapp).toContain('INV-2026-042');

    const waRes = await app.fetch(
      new Request('http://test.local/api/dunning/invoices/1/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: 'whatsapp', stage: 'MANUAL-1' }),
      }),
      { DB: db } as any,
    );
    expect(waRes.status).toBe(200);
    const waJson = (await waRes.json()) as any;
    expect(waJson.data.message).toContain('INV-2026-042');
  });
});
