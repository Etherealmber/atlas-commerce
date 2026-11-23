/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { HttpDgiAdapter, StubDgiAdapter, selectDgiAdapter } from '../lib/dgiAdapter';
import { registerDgiRoutes } from '../routes/dgi';

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

function makeFakeR2() {
  const store = new Map<string, { body: string | ArrayBuffer; customMetadata?: Record<string, string> }>();
  return {
    store,
    async put(key: string, value: any, opts?: any) {
      store.set(key, { body: value, customMetadata: opts?.customMetadata });
    },
    async get(key: string) {
      const hit = store.get(key);
      if (!hit) return null;
      return {
        async text() {
          return typeof hit.body === 'string' ? hit.body : new TextDecoder().decode(hit.body as any);
        },
        async arrayBuffer() {
          if (typeof hit.body === 'string') return new TextEncoder().encode(hit.body).buffer;
          if (ArrayBuffer.isView(hit.body)) {
            return hit.body.buffer.slice(hit.body.byteOffset, hit.body.byteOffset + hit.body.byteLength);
          }
          return hit.body;
        },
      };
    },
  };
}

function setupDgiApp() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT DEFAULT (datetime('now')), username TEXT, role TEXT, action TEXT, entity TEXT, entity_id TEXT, detail TEXT, ip TEXT);
    CREATE TABLE status_events (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL, from_status TEXT DEFAULT '', to_status TEXT NOT NULL, by_user TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE company_settings (id INTEGER PRIMARY KEY, company_name TEXT, address TEXT, city TEXT, ice TEXT, if_number TEXT, rc TEXT, cnss TEXT, email TEXT, phone TEXT);
    INSERT INTO company_settings (id, company_name, address, city, ice, if_number, rc, cnss) VALUES (1, 'Atlas Marbre SARL', 'Zone Ind.', 'El Jadida', '001234567890123', '12345678', 'RC9988', 'CNSS7766');
    CREATE TABLE invoices (id INTEGER PRIMARY KEY, number TEXT, invoice_number TEXT, issue_date TEXT, due_date TEXT, doc_kind TEXT, status TEXT, dgi_status TEXT, client_name TEXT, client_ice TEXT, client_address TEXT, client_city TEXT, subtotal REAL, tax_amount REAL, total REAL, amount_paid REAL, updated_at TEXT);
    INSERT INTO invoices (id, number, invoice_number, issue_date, due_date, doc_kind, status, client_name, client_ice, client_address, client_city, subtotal, tax_amount, total, amount_paid)
    VALUES (1, 'FAC-2026-100', 'FAC-2026-100', '2026-11-24', '2026-12-24', 'invoice', 'sent', 'BatiMaroc', '009988776655443', 'Bd Zerktouni', 'Casablanca', 1000, 200, 1200, 0);
    CREATE TABLE invoice_items (id INTEGER PRIMARY KEY, invoice_id INTEGER, product_name TEXT, quantity REAL, unit_price REAL, tax_rate REAL, total REAL);
    INSERT INTO invoice_items (id, invoice_id, product_name, quantity, unit_price, tax_rate, total) VALUES (1, 1, 'Marbre Crème', 10, 100, 20, 1200);
  `);

  const db = makeSqliteD1(sqlite);
  const r2 = makeFakeR2();
  const app = new Hono<any>();
  registerDgiRoutes(app as any, {
    requireBizMutator: (c) => ({ ok: true, username: c.req.header('x-user') || 'admin', role: 'owner' }),
    requireOwner: (c) => {
      if ((c.req.header('x-role') || 'owner') !== 'owner') {
        return { ok: false, response: c.json({ success: false, error: 'Owner required' }, 403) };
      }
      return { ok: true, username: 'owner', role: 'owner' };
    },
    writeAudit: async (database, entry) => {
      await database
        .prepare(`INSERT INTO audit_log (username, role, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(entry.username || '', entry.role || '', entry.action, entry.entity || '', entry.entity_id || '', entry.detail || '')
        .run();
    },
    clientIp: () => '127.0.0.1',
  });
  return { app, db, r2 };
}

describe('Part 7 — DGI e-invoicing clearance layer', () => {
  it('prepares UBL, submits via StubDgiAdapter (is_stub=true), archives XML+PDF to R2 with 10-year retention, and restricts archive download to owner', async () => {
    const { app, db, r2 } = setupDgiApp();

    // Adapter selection defaults to StubDgiAdapter when DGI env vars are unset
    expect(selectDgiAdapter({})).toBeInstanceOf(StubDgiAdapter);
    expect(selectDgiAdapter({ DGI_BASE_URL: 'https://dgi.test', DGI_CLIENT_ID: 'cid', DGI_CLIENT_SECRET: 'sec' })).toBeInstanceOf(HttpDgiAdapter);

    // Prepare UBL -> ubl_ready
    const prepRes = await app.fetch(new Request('http://test.local/api/invoices/1/dgi/prepare', { method: 'POST' }), {
      DB: db,
      IMAGES: r2,
    } as any);
    expect(prepRes.status).toBe(200);
    const prepJson = (await prepRes.json()) as any;
    expect(prepJson.data.status).toBe('ubl_ready');
    expect(prepJson.data.is_stub).toBe(true);

    // Submit -> cleared via StubDgiAdapter + R2 archival (10-year retention metadata)
    const subRes = await app.fetch(new Request('http://test.local/api/invoices/1/dgi/submit', { method: 'POST' }), {
      DB: db,
      IMAGES: r2,
    } as any);
    expect(subRes.status).toBe(200);
    const subJson = (await subRes.json()) as any;
    expect(subJson.data.status).toBe('cleared');
    expect(subJson.data.is_stub).toBe(true);
    expect(subJson.data.clearance_ref).toMatch(/^DGI-STUB-1-/);
    expect(subJson.data.retention_until).toBe('2036-11-24');
    expect(r2.store.has(subJson.data.r2_xml_key)).toBe(true);
    expect(r2.store.has(subJson.data.r2_pdf_key)).toBe(true);
    expect(r2.store.get(subJson.data.r2_xml_key)?.customMetadata?.retention_years).toBe('10');

    // Event log recorded queued -> submitted -> cleared
    const states = subJson.data.events.map((e: any) => e.to_status);
    expect(states).toContain('ubl_ready');
    expect(states).toContain('queued');
    expect(states).toContain('submitted');
    expect(states).toContain('cleared');

    // Non-owner blocked from archive download (403); owner gets XML (200)
    const nonOwnerRes = await app.fetch(
      new Request('http://test.local/api/invoices/1/dgi/archive?kind=xml', { headers: { 'x-role': 'staff' } }),
      { DB: db, IMAGES: r2 } as any,
    );
    expect(nonOwnerRes.status).toBe(403);

    const ownerXmlRes = await app.fetch(
      new Request('http://test.local/api/invoices/1/dgi/archive?kind=xml', { headers: { 'x-role': 'owner' } }),
      { DB: db, IMAGES: r2 } as any,
    );
    expect(ownerXmlRes.status).toBe(200);
    expect(ownerXmlRes.headers.get('X-Retention-Until')).toBe('2036-11-24');
    expect(await ownerXmlRes.text()).toContain('FAC-2026-100');
  });
});
