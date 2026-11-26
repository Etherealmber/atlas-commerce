import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };
import app from '../index';

describe('Financial security, concurrency, multi-currency & reconciliation certification', () => {
  let sqlite: any;
  let env: any;
  const ip = '203.0.113.222';

  function dbFor(database: any) {
    return {
      prepare(sql: string) {
        let args: any[] = [];
        const stmt: any = {
          bind(...a: any[]) {
            args = a;
            return stmt;
          },
          async first() {
            await new Promise((r) => setTimeout(r, 1));
            return database.prepare(sql).get(...args) || null;
          },
          async all() {
            await new Promise((r) => setTimeout(r, 1));
            return { results: database.prepare(sql).all(...args) };
          },
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

  async function userToken(username: string, role: string, passwordHash: string) {
    const proof = await sha256(`proof|${username}|${role}|${passwordHash}|${ip}|none`);
    return btoa(`stock-auth-v2|${username}|${role}|${ip}|none|${proof}`);
  }

  async function call(path: string, tok: string | null, method = 'GET', body?: unknown) {
    const headers: Record<string, string> = {
      'CF-Connecting-IP': ip,
      'Content-Type': 'application/json',
    };
    if (tok) headers.Authorization = `Bearer ${tok}`;
    return app.fetch(
      new Request(`http://test.local${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
      {} as any,
    );
  }

  beforeAll(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'));
    sqlite.exec(`ALTER TABLE invoices ADD COLUMN doc_kind TEXT DEFAULT '';`);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS app_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        display_name TEXT DEFAULT '',
        role TEXT NOT NULL DEFAULT 'user',
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        email TEXT DEFAULT '',
        phone TEXT DEFAULT '',
        active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
    sqlite.exec(`
      INSERT INTO products (name, sku, price, cost, stock_quantity, track_inventory, is_active)
      VALUES
        ('Produit Alpha', 'PA-01', 100, 60, 50, 1, 1),
        ('Produit Beta', 'PB-02', 200, 120, 2, 1, 1);
      INSERT INTO app_users (username, display_name, role, password_hash, password_salt, active)
      VALUES
        ('magasinier1', 'Magasinier', 'stock', 'hash-stock-1', 'salt-1', 1),
        ('viewer1', 'User', 'user', 'hash-user-1', 'salt-2', 1);
    `);
    env = { DB: dbFor(sqlite), ADMIN_PASSWORD: 'OwnerPass123!', EMAIL: { send: async () => ({}) } };
  });

  afterAll(() => sqlite.close());

  it('prevents concurrent partial WR refunds from exceeding refundable line quantity or invoice total', async () => {
    const tok = await ownerToken();
    const invRes = await call('/api/invoices', tok, 'POST', {
      client_name: 'Client Concurrent WR',
      items: [{ product_id: 1, product_name: 'Produit Alpha', sku: 'PA-01', quantity: 5, unit_price: 100, tax_rate: 20 }],
    });
    expect(invRes.status).toBe(201);
    const inv: any = await invRes.json();
    const invId = inv.data.id;
    const invItem = sqlite.prepare('SELECT id FROM invoice_items WHERE invoice_id = ?').get(invId) as { id: number };
    const stockAfterSale = Number((sqlite.prepare('SELECT stock_quantity FROM products WHERE id = 1').get() as any).stock_quantity);

    const payload = {
      refund_of_invoice_id: invId,
      reason_code: 'defective_shipped',
      reason_detail: 'Pièces défectueuses constatées lors du contrôle qualité',
      items: [{ invoice_item_id: invItem.id, quantity: 4, restock: true }],
    };

    // Launch two concurrent WR refunds each asking for 4 of 5 units (sum = 8 > 5!)
    const [r1, r2] = await Promise.all([
      call('/api/invoices/remboursement', tok, 'POST', payload),
      call('/api/invoices/remboursement', tok, 'POST', payload),
    ]);
    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    expect(statuses[0]).toBe(201);
    expect([400, 409]).toContain(statuses[1]);

    // Exactly ONE WR credit note exists, stock restocked only ONCE (+4), and source amount_paid = 480
    const wrRows = sqlite.prepare(`SELECT id, total FROM invoices WHERE refund_of_invoice_id = ?`).all(invId) as any[];
    expect(wrRows.length).toBe(1);
    expect(wrRows[0].total).toBe(480);

    const srcAfter = sqlite.prepare(`SELECT amount_paid, status FROM invoices WHERE id = ?`).get(invId) as any;
    expect(srcAfter.amount_paid).toBe(480);
    expect(srcAfter.status).toBe('partial');

    const stockAfterWr = Number((sqlite.prepare('SELECT stock_quantity FROM products WHERE id = 1').get() as any).stock_quantity);
    expect(stockAfterWr).toBe(stockAfterSale + 4);
  });

  it('prevents concurrent invoice and bill payments from double-recording payments or ledger entries', async () => {
    const tok = await ownerToken();

    // Invoice concurrent payments
    const invRes = await call('/api/invoices', tok, 'POST', {
      client_name: 'Client Concurrent Pay',
      tax_exempt: true,
      items: [{ product_id: 1, product_name: 'Produit Alpha', sku: 'PA-01', quantity: 10, unit_price: 100, tax_rate: 0 }],
    });
    expect(invRes.status).toBe(201);
    const invId = ((await invRes.json()) as any).data.id;

    const [ip1, ip2] = await Promise.all([
      call(`/api/invoices/${invId}/payments`, tok, 'POST', { amount: 1000, payment_method: 'cash' }),
      call(`/api/invoices/${invId}/payments`, tok, 'POST', { amount: 1000, payment_method: 'cash' }),
    ]);
    const ipStatuses = [ip1.status, ip2.status].sort((a, b) => a - b);
    expect(ipStatuses[0]).toBe(200);
    expect([400, 409]).toContain(ipStatuses[1]);

    const invPayments = sqlite.prepare(`SELECT amount FROM invoice_payments WHERE invoice_id = ?`).all(invId) as any[];
    expect(invPayments.length).toBe(1);
    expect(invPayments[0].amount).toBe(1000);
    const invRow = sqlite.prepare(`SELECT amount_paid, status FROM invoices WHERE id = ?`).get(invId) as any;
    expect(invRow.amount_paid).toBe(1000);
    expect(invRow.status).toBe('paid');

    // Bill concurrent payments
    const billRes = await call('/api/bills', tok, 'POST', {
      vendor_name: 'Fournisseur Concurrent',
      items: [{ product_name: 'Bloc brut', quantity: 5, unit_cost: 100, tax_rate: 0 }],
    });
    expect(billRes.status).toBe(201);
    const billId = ((await billRes.json()) as any).data.id;

    const [bp1, bp2] = await Promise.all([
      call(`/api/bills/${billId}/payments`, tok, 'POST', { amount: 500, payment_method: 'cash' }),
      call(`/api/bills/${billId}/payments`, tok, 'POST', { amount: 500, payment_method: 'cash' }),
    ]);
    const bpStatuses = [bp1.status, bp2.status].sort((a, b) => a - b);
    expect(bpStatuses[0]).toBe(200);
    expect([400, 409]).toContain(bpStatuses[1]);

    const billPayments = sqlite.prepare(`SELECT amount FROM bill_payments WHERE bill_id = ?`).all(billId) as any[];
    expect(billPayments.length).toBe(1);
    expect(billPayments[0].amount).toBe(500);
    const billRow = sqlite.prepare(`SELECT amount_paid, status FROM bills WHERE id = ?`).get(billId) as any;
    expect(billRow.amount_paid).toBe(500);
    expect(billRow.status).toBe('paid');
  });

  it('prevents concurrent payroll advances past 50% cap and duplicate cycle salary payments', async () => {
    const tok = await ownerToken();
    const empRes = await call('/api/employees', tok, 'POST', {
      first_name: 'Karim',
      last_name: 'Test',
      pay_amount: 6000,
      pay_cycle_type: 'monthly',
      joined_date: '2025-01-01',
    });
    expect(empRes.status).toBe(201);
    const empId = ((await empRes.json()) as any).data.id;

    // Two concurrent advances of 2500 (50% cap is 3000; sum 5000 > 3000!)
    const [a1, a2] = await Promise.all([
      call(`/api/employees/${empId}/advance`, tok, 'POST', { amount: 2500, note: 'Avance urgente justifiée par dossier' }),
      call(`/api/employees/${empId}/advance`, tok, 'POST', { amount: 2500, note: 'Avance urgente justifiée par dossier' }),
    ]);
    expect([a1.status, a2.status].sort((a, b) => a - b)).toEqual([200, 409]);

    const advRows = sqlite.prepare(`SELECT amount FROM employee_payments WHERE employee_id = ?`).all(empId) as any[];
    expect(advRows.length).toBe(1);
    expect(advRows[0].amount).toBe(2500);

    // Sequential retry over the cap is refused too (never clamped to the remainder).
    const a3 = await call(`/api/employees/${empId}/advance`, tok, 'POST', { amount: 2500, note: 'Avance urgente justifiée par dossier' });
    expect(a3.status).toBe(409);
    const a3j: any = await a3.json();
    expect(a3j.code).toBe('ADVANCE_CAP_EXCEEDED');
    expect(a3j.data.max_advance).toBe(500);
    expect((sqlite.prepare(`SELECT COUNT(*) AS n FROM employee_payments WHERE employee_id = ?`).get(empId) as any).n).toBe(1);

    // Two concurrent full salary payments in the same cycle -> only one commits
    const [p1, p2] = await Promise.all([
      call(`/api/employees/${empId}/pay`, tok, 'POST', { paid_at: '2026-10-20', amount: 1500 }),
      call(`/api/employees/${empId}/pay`, tok, 'POST', { paid_at: '2026-10-20', amount: 1500 }),
    ]);
    expect([p1.status, p2.status].sort((a, b) => a - b)).toEqual([200, 409]);

    // A retry after the first commit must not pay the same or an earlier date again,
    // even when it reads the already-updated employee row.
    const sameDay = await call(`/api/employees/${empId}/pay`, tok, 'POST', { paid_at: '2026-10-20', amount: 1500 });
    const earlier = await call(`/api/employees/${empId}/pay`, tok, 'POST', { paid_at: '2026-10-19', amount: 1500 });
    expect(sameDay.status).toBe(409);
    expect(earlier.status).toBe(409);
    const payRows = sqlite.prepare(`SELECT amount FROM employee_payments WHERE employee_id = ?`).all(empId) as any[];
    expect(payRows.length).toBe(2); // 1 advance + 1 pay
    const later = await call(`/api/employees/${empId}/pay`, tok, 'POST', { paid_at: '2026-10-21', amount: 1500 });
    expect(later.status).toBe(200);
  });

  it('rolls back completely when multi-line or duplicate-product invoice exceeds stock', async () => {
    const tok = await ownerToken();
    const stockABefore = Number((sqlite.prepare('SELECT stock_quantity FROM products WHERE id = 1').get() as any).stock_quantity);
    const stockBBefore = Number((sqlite.prepare('SELECT stock_quantity FROM products WHERE id = 2').get() as any).stock_quantity);
    expect(stockBBefore).toBe(2);

    // Line 1 ok (Alpha qty 4), Line 2 insufficient (Beta qty 5 > 2)
    const failMulti = await call('/api/invoices', tok, 'POST', {
      client_name: 'Client Stock Rollback',
      items: [
        { product_id: 1, product_name: 'Produit Alpha', sku: 'PA-01', quantity: 4, unit_price: 100, tax_rate: 20 },
        { product_id: 2, product_name: 'Produit Beta', sku: 'PB-02', quantity: 5, unit_price: 200, tax_rate: 20 },
      ],
    });
    expect(failMulti.status).toBe(400);
    expect(((await failMulti.json()) as any).code).toBe('INSUFFICIENT_STOCK');
    expect(Number((sqlite.prepare('SELECT stock_quantity FROM products WHERE id = 1').get() as any).stock_quantity)).toBe(stockABefore);
    expect(Number((sqlite.prepare('SELECT stock_quantity FROM products WHERE id = 2').get() as any).stock_quantity)).toBe(stockBBefore);

    // Duplicate lines for same product exceeding stock (2 + 2 = 4 > 2)
    const failDup = await call('/api/invoices', tok, 'POST', {
      client_name: 'Client Duplicate Line',
      items: [
        { product_id: 2, product_name: 'Produit Beta', sku: 'PB-02', quantity: 2, unit_price: 200, tax_rate: 20 },
        { product_id: 2, product_name: 'Produit Beta', sku: 'PB-02', quantity: 2, unit_price: 200, tax_rate: 20 },
      ],
    });
    expect(failDup.status).toBe(400);
    expect(Number((sqlite.prepare('SELECT stock_quantity FROM products WHERE id = 2').get() as any).stock_quantity)).toBe(stockBBefore);
  });

  it('enforces server-side RBAC: rejects unauthenticated (401) and stock/user roles (403) on all financial write/export/admin routes', async () => {
    const ownerTok = await ownerToken();
    const stockTok = await userToken('magasinier1', 'stock', 'hash-stock-1');
    const userTok = await userToken('viewer1', 'user', 'hash-user-1');

    // Seed one invoice, bill, receipt, vendor for targeted IDOR/RBAC calls
    const invId = (((await (await call('/api/invoices', ownerTok, 'POST', {
      client_name: 'Client RBAC',
      items: [{ product_id: 1, product_name: 'Produit Alpha', sku: 'PA-01', quantity: 1, unit_price: 100, tax_rate: 20 }],
    })).json()) as any).data.id);
    const quoteId = (((await (await call('/api/invoices', ownerTok, 'POST', {
      client_name: 'Client Quote RBAC',
      status: 'quote',
      items: [{ product_id: 1, product_name: 'Produit Alpha', sku: 'PA-01', quantity: 1, unit_price: 100, tax_rate: 20 }],
    })).json()) as any).data.id);
    const billId = (((await (await call('/api/bills', ownerTok, 'POST', {
      vendor_name: 'Vendor RBAC',
      items: [{ product_name: 'Item', quantity: 1, unit_cost: 50 }],
    })).json()) as any).data.id);
    const recId = (((await (await call('/api/receipts', ownerTok, 'POST', {
      client_name: 'Client RBAC',
      amount: 50,
      issue_date: '2026-10-20',
    })).json()) as any).data.id);

    // Unauthenticated must be 401
    expect((await call('/api/invoices/remboursement', null, 'POST', {})).status).toBe(401);
    expect((await call('/api/export/invoices', null, 'GET')).status).toBe(401);
    expect((await call('/api/integrity/status', null, 'GET')).status).toBe(401);

    const forbiddenForStock: Array<[string, string, unknown?]> = [
      ['POST', '/api/invoices/remboursement', { refund_of_invoice_id: invId, reason_code: 'defective_shipped', reason_detail: 'Raison suffisamment longue pour test', items: [] }],
      ['PATCH', `/api/invoices/${invId}/status`, { status: 'paid' }],
      ['PUT', `/api/invoices/${invId}`, { notes: 'hacked' }],
      ['POST', `/api/invoices/${invId}/payments`, { amount: 10 }],
      ['POST', `/api/invoices/${quoteId}/convert-quote`, {}],
      ['POST', '/api/bills', { vendor_name: 'Hacked', items: [{ product_name: 'X', quantity: 1, unit_cost: 10 }] }],
      ['PATCH', `/api/bills/${billId}/status`, { status: 'paid' }],
      ['POST', '/api/bills/bulk-delete', { ids: [billId] }],
      ['POST', '/api/receipts', { client_name: 'Hacked', amount: 10 }],
      ['PUT', `/api/receipts/${recId}`, { amount: 999 }],
      ['POST', '/api/bills/import', { rows: [{ vendor_name: 'X', total: 10 }] }],
      ['GET', '/api/export/invoices'],
      ['GET', '/api/export/expenses'],
      ['GET', '/api/export/clients'],
      ['GET', '/api/export/payments'],
      ['POST', '/api/vendors', { name: 'Vendor Hacked' }],
      ['PUT', '/api/vendors/1', { name: 'Vendor Hacked' }],
      ['POST', '/api/admin/revoke-public-token', { invoice_id: invId }],
      ['GET', '/api/integrity/status'],
    ];

    for (const [method, path, body] of forbiddenForStock) {
      const resStock = await call(path, stockTok, method, body);
      expect(resStock.status, `stock ${method} ${path}`).toBe(403);
      const resUser = await call(path, userTok, method, body);
      expect(resUser.status, `user ${method} ${path}`).toBe(403);
    }

    // Operational product export for stock role MUST scrub cost and sell price
    const expProd = await call('/api/export/products', stockTok, 'GET');
    expect(expProd.status).toBe(200);
    const csvText = await expProd.text();
    expect(csvText).toContain('Produit Alpha');
    expect(csvText).not.toContain(';60;100;');
  });

  it('formats 3-decimal currencies (TND) accurately on public/report HTML, escapes XSS, and reports clean D1 integrity', async () => {
    const tok = await ownerToken();
    sqlite.prepare(`UPDATE company_settings SET currency = 'TND' WHERE id = 1`).run();
    try {
      const invRes = await call('/api/invoices', tok, 'POST', {
        client_name: 'Client Tunis',
        tax_exempt: true,
        items: [{ product_name: 'Dalle TND', quantity: 1, unit_price: 10.125, tax_rate: 0 }],
      });
      expect(invRes.status).toBe(201);
      const invData: any = await invRes.json();
      expect(invData.data.total).toBe(10.125);

      const pubUrl = new URL(invData.data.public_url);
      const pubRes = await call(pubUrl.pathname, null, 'GET');
      expect(pubRes.status).toBe(200);
      const pubHtml = await pubRes.text();
      expect(pubHtml).toContain('10,125');
      expect(pubHtml).toContain('TND');

      // Employee with XSS payload in name + TND currency formatting
      const empRes = await call('/api/employees', tok, 'POST', {
        first_name: '<script>alert(1)</script>',
        last_name: 'Tunis',
        pay_amount: 1500.375,
        pay_cycle_type: 'monthly',
      });
      expect(empRes.status).toBe(201);
      const empId = ((await empRes.json()) as any).data.id;

      const empSitRes = await call(`/api/reports/employee-situation?employee_id=${empId}`, tok, 'GET');
      expect(empSitRes.status).toBe(200);
      const empHtml = await empSitRes.text();
      expect(empHtml).not.toContain('<script>alert(1)</script>');
      expect(empHtml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(empHtml).toMatch(/1[\s\u202f\u00a0]?500,375 TND/);
    } finally {
      sqlite.prepare(`UPDATE company_settings SET currency = 'MAD' WHERE id = 1`).run();
    }

    // Full D1 integrity reconciliation check after all mutations & concurrent conflicts
    const intRes = await call('/api/integrity/status', tok, 'GET');
    expect(intRes.status).toBe(200);
    const intBody: any = await intRes.json();
    expect(intBody.data.ok).toBe(true);
    expect(intBody.data.negative_stock_products).toBe(0);
    expect(intBody.data.duplicate_invoice_numbers).toBe(0);
    expect(intBody.data.payments_on_wr).toBe(0);
    expect(intBody.data.overpaid_invoices).toBe(0);
    expect(intBody.data.overrefunded_invoices).toBe(0);
    expect(intBody.data.bill_payment_mismatches).toBe(0);
    expect(intBody.data.invoice_payment_mismatches).toBe(0);
  });

  it('enforces RBAC, price/cost scrubbing, SSRF, and XSS escaping across auxiliary routes', async () => {
    const ownerTok = await ownerToken();
    const stockTok = await userToken('magasinier1', 'stock', 'hash-stock-1');
    const userTok = await userToken('viewer1', 'user', 'hash-user-1');

    // Endpoints restricted from stock/user
    const restricted: Array<[string, string, unknown?]> = [
      ['GET', '/api/admin/hmac-status'],
      ['POST', '/api/admin/rotate-hmac-keys', {}],
      ['GET', '/api/expenses'],
      ['GET', '/api/ledger/reconcile'],
      ['POST', '/api/ledger/fix-receipts', {}],
      ['GET', '/api/inventory/valuation'],
      ['GET', '/api/bills'],
      ['GET', '/api/receipts'],
      ['GET', '/api/clients/1/prices'],
      ['PUT', '/api/catalog/settings', { title: 'Hacked' }],
      ['POST', '/api/mobile-actions/1/complete', {}],
      ['PATCH', '/api/receipts/1/client-situation', { situation: 'paid' }],
      ['POST', '/api/invoices/1/send-email', {}],
      ['POST', '/api/webhooks', { url: 'https://example.com/hook', events: 'invoice.created' }],
      ['POST', '/api/vendors/parts', { vendor_id: 1, product_id: 1 }],
      ['POST', '/api/import/commit', { type: 'expenses', rows: [{ description: 'Test', amount: 10 }] }],
    ];
    for (const [method, path, body] of restricted) {
      expect((await call(path, stockTok, method, body)).status, `stock ${method} ${path}`).toBe(403);
      expect((await call(path, userTok, method, body)).status, `user ${method} ${path}`).toBe(403);
    }

    // Operational reads allowed for stock MUST omit cost/price/valuation
    const stockRep = await call('/api/inventory/stock-report', stockTok, 'GET');
    expect(stockRep.status).toBe(200);
    const stockRepJson: any = await stockRep.json();
    expect(stockRepJson.data.totals.value).toBeUndefined();

    const reorderRes = await call('/api/inventory/reorder', stockTok, 'GET');
    expect(reorderRes.status).toBe(200);
    const reorderSug = await call('/api/inventory/reorder-suggestions', stockTok, 'GET');
    expect(reorderSug.status).toBe(200);
    for (const row of ((await reorderSug.json()) as any).data || []) {
      expect(row.unit_cost).toBeUndefined();
    }

    const catRes = await call('/api/catalog/products', stockTok, 'GET');
    expect(catRes.status).toBe(200);
    for (const p of ((await catRes.json()) as any).data || []) {
      expect(p.cost).toBeUndefined();
      expect(p.price).toBeUndefined();
    }

    const lblRes = await call('/api/products/1/label.svg', stockTok, 'GET');
    expect(lblRes.status).toBe(200);
    const lblSvg = await lblRes.text();
    expect(lblSvg).not.toContain('100 MAD');

    // SSRF rejection on webhook endpoints
    for (const ssrfUrl of ['http://127.0.0.1/hook', 'https://169.254.169.254/latest/meta-data/']) {
      expect((await call('/api/webhooks', ownerTok, 'POST', { url: ssrfUrl, events: '*' })).status).toBe(400);
      expect((await call('/api/integrations/webhooks', ownerTok, 'POST', { url: ssrfUrl })).status).toBe(400);
    }

    // XSS & signature validation on public invoice & print endpoints
    const xssInv = await call('/api/invoices', ownerTok, 'POST', {
      client_name: '<img src=x onerror=alert(9)>',
      tax_exempt: true,
      items: [{ product_name: '<svg onload=alert(8)>', quantity: 1, unit_price: 50, tax_rate: 0 }],
    });
    expect(xssInv.status).toBe(201);
    const xssData: any = await xssInv.json();
    const pubPath = new URL(xssData.data.public_url).pathname;
    const pubToken = pubPath.split('/').pop()!;

    const pubApiRes = await call(`/api/public/invoices/${pubToken}`, null, 'GET');
    expect(pubApiRes.status).toBe(200);
    const pubHtml = await pubApiRes.text();
    expect(pubHtml).not.toContain('<img src=x');
    expect(pubHtml).toContain('&lt;img');

    const badSign = await call(`/api/public/invoices/${pubToken}/sign`, null, 'POST', {
      client_signature: 'javascript:alert(1)',
    });
    expect(badSign.status).toBe(400);
  });

  it('excludes tax-exempt invoices from TVA, excludes WR from dashboard/preview receivables, and rejects receiving cancelled bills', async () => {
    const ownerTok = await ownerToken();

    // Tax-exempt invoice with default 20% company tax_rate must be 0% TVA in reports
    const exemptRes = await call('/api/invoices', ownerTok, 'POST', {
      client_name: 'Client Exonéré',
      issue_date: '2026-10-21',
      tax_exempt: true,
      items: [{ product_id: 1, product_name: 'Produit Alpha', sku: 'PA-01', quantity: 2, unit_price: 150, tax_rate: 0 }],
    });
    expect(exemptRes.status).toBe(201);
    const exemptInv: any = await exemptRes.json();
    expect(exemptInv.data.tax_amount).toBe(0);

    const tvaRes = await call('/api/reports/tva?from=2026-10-21&to=2026-10-21', ownerTok, 'GET');
    expect(tvaRes.status).toBe(200);
    const tvaBody: any = await tvaRes.json();
    expect(tvaBody.data.sales).toEqual([expect.objectContaining({ tax_rate: 0, base_ht: 300, tva: 0 })]);
    expect(tvaBody.data.net_tva).toBe(0);

    // Cancelled bill must not be receivable
    const billRes = await call('/api/bills', ownerTok, 'POST', {
      vendor_name: 'Fournisseur Annulé',
      items: [{ product_id: 1, product_name: 'Produit Alpha', sku: 'PA-01', quantity: 5, unit_cost: 60 }],
    });
    expect(billRes.status).toBe(201);
    const billId = ((await billRes.json()) as any).data.id;
    expect((await call(`/api/bills/${billId}/status`, ownerTok, 'PATCH', { status: 'cancelled' })).status).toBe(200);
    const recvCancelled = await call(`/api/bills/${billId}/receive`, ownerTok, 'POST', {});
    expect(recvCancelled.status).toBe(400);
    expect(((await recvCancelled.json()) as any).code).toBe('BILL_CANCELLED');

    // Dashboard unpaidInvoiceList must never include WR remboursement rows
    const dashRes = await call('/api/dashboard', ownerTok, 'GET');
    expect(dashRes.status).toBe(200);
    const dashJson: any = await dashRes.json();
    for (const inv of dashJson.data.unpaidInvoiceList || []) {
      expect(String(inv.number || '')).not.toMatch(/^WR-/);
    }
  });

  it('enforces RBAC on invoices, clients, categories/units, product pricing, client bulk-delete blockers, and backup restore SQL allowlisting', async () => {
    const ownerTok = await ownerToken();
    const stockTok = await userToken('magasinier1', 'stock', 'hash-stock-1');
    const userTok = await userToken('viewer1', 'user', 'hash-user-1');

    // Invoices & clients reads must be blocked for stock and user
    for (const [method, path, body] of [
      ['GET', '/api/invoices'],
      ['GET', '/api/invoices/1'],
      ['GET', '/api/clients'],
      ['POST', '/api/clients/import/preview', { rows: [{ name: 'Probe' }] }],
      ['DELETE', '/api/products/variants/999', {}],
    ] as Array<[string, string, unknown?]>) {
      expect((await call(path, stockTok, method, body)).status, `stock ${method} ${path}`).toBe(403);
      expect((await call(path, userTok, method, body)).status, `user ${method} ${path}`).toBe(403);
    }

    // Plain user cannot mutate categories, units, products, or quick-product
    for (const [method, path, body] of [
      ['POST', '/api/categories', { name: 'ViewerCat' }],
      ['PUT', '/api/categories/1', { name: 'Renamed' }],
      ['POST', '/api/units', { name: 'ViewerUnit' }],
      ['POST', '/api/products', { name: 'ViewerProd', stock_quantity: 0 }],
      ['PUT', '/api/products/1', { name: 'Renamed' }],
      ['POST', '/api/scan/quick-product', { barcode: '999000111', name: 'Quick' }],
    ] as Array<[string, string, unknown?]>) {
      expect((await call(path, userTok, method, body)).status, `user ${method} ${path}`).toBe(403);
    }

    // stock cannot overwrite prices/costs or inject initial stock > 0 on product creation
    const stockWithQty = await call('/api/products', stockTok, 'POST', {
      name: 'StockBypassAttempt',
      sku: 'SBA-1',
      stock_quantity: 50,
    });
    expect(stockWithQty.status).toBe(403);

    const stockPriceEdit = await call('/api/products/1', stockTok, 'PUT', { price: 9999 });
    expect(stockPriceEdit.status).toBe(403);

    const stockSafeProd = await call('/api/products', stockTok, 'POST', {
      name: 'StockSafeProd',
      sku: 'SSP-1',
      price: 123,
      cost: 77,
      stock_quantity: 0,
    });
    expect(stockSafeProd.status).toBe(201);
    const sspJson: any = await stockSafeProd.json();
    expect(sspJson.data.price).toBeUndefined();
    expect(sspJson.data.cost).toBeUndefined();
    const dbRow: any = sqlite.prepare(`SELECT price, cost FROM products WHERE id = ?`).get(sspJson.data.id);
    expect(dbRow.price).toBe(0);
    expect(dbRow.cost).toBe(0);

    // Client credit_limit validation & bulk-delete blocker when client has invoices
    const cliRes = await call('/api/clients', ownerTok, 'POST', { name: 'Client Historique' });
    expect(cliRes.status).toBe(201);
    const cliId = ((await cliRes.json()) as any).data.id;
    expect((await call(`/api/clients/${cliId}`, ownerTok, 'PUT', { credit_limit: -50 })).status).toBe(422);
    expect((await call(`/api/clients/${cliId}`, ownerTok, 'PUT', { credit_limit: 'NaN' })).status).toBe(422);

    const cliInv = await call('/api/invoices', ownerTok, 'POST', {
      client_id: cliId,
      client_name: 'Client Historique',
      items: [{ product_name: 'Service', quantity: 1, unit_price: 100, tax_rate: 0 }],
    });
    expect(cliInv.status).toBe(201);

    const bulkDel = await call('/api/clients/bulk-delete', ownerTok, 'POST', {
      ids: [cliId],
      confirm_password: 'OwnerPass123!',
    });
    expect(bulkDel.status).toBe(400);
    expect(((await bulkDel.json()) as any).code).toBe('CLIENT_HAS_HISTORY');

    // Backup restore SQL identifier allowlist: ignores malicious table/column keys safely
    const { restoreFromBackupPayload } = await import('../routes/backups');
    const restoreRes = await restoreFromBackupPayload(env.DB, {
      tables: {
        'sqlite_master': [{ type: 'table', name: 'evil' }],
        'clients; DROP TABLE products--': [{ id: 999, name: 'Hacked' }],
        clients: [{ id: 9991, name: 'RestoredSafeClient', 'evil_col) VALUES (1);--': 'x', __proto__: 'bad' }],
      },
    });
    expect(restoreRes.tables).toEqual(['clients']);
    const restoredCli: any = sqlite.prepare(`SELECT name FROM clients WHERE id = 9991`).get();
    expect(restoredCli?.name).toBe('RestoredSafeClient');
  });

  it('enforces idempotency keys on bills/receipts/payroll, X-Request-Id correlation, and 413 body size guard', async () => {
    const ownerTok = await ownerToken();

    // X-Request-Id propagation & validation
    const reqIdRes = await app.fetch(
      new Request('http://test.local/api/health', {
        headers: { 'CF-Connecting-IP': ip, 'X-Request-Id': 'req-corr-12345' },
      }),
      env,
      {} as any,
    );
    expect(reqIdRes.status).toBe(200);
    expect(reqIdRes.headers.get('X-Request-Id')).toBe('req-corr-12345');

    // 413 guard on oversized Content-Length JSON mutation
    const bigRes = await app.fetch(
      new Request('http://test.local/api/expenses', {
        method: 'POST',
        headers: {
          'CF-Connecting-IP': ip,
          Authorization: `Bearer ${ownerTok}`,
          'Content-Type': 'application/json',
          'Content-Length': '5000000',
        },
        body: '{}',
      }),
      env,
      {} as any,
    );
    expect(bigRes.status).toBe(413);
    expect(((await bigRes.json()) as any).code).toBe('PAYLOAD_TOO_LARGE');

    // Idempotency replay on POST /api/bills
    const billBody = {
      vendor_name: 'Fournisseur Idem',
      items: [{ product_name: 'Bloc', quantity: 1, unit_cost: 200, tax_rate: 0 }],
      idempotency_key: 'idem-bill-001',
    };
    const b1 = await call('/api/bills', ownerTok, 'POST', billBody);
    const b2 = await call('/api/bills', ownerTok, 'POST', billBody);
    expect(b1.status).toBe(201);
    expect(b2.status).toBe(201);
    const b1j: any = await b1.json();
    const b2j: any = await b2.json();
    expect(b2j.replayed).toBe(true);
    expect(b2j.data.id).toBe(b1j.data.id);

    // Idempotency replay on POST /api/receipts
    const recBody = {
      client_name: 'Client Idem',
      amount: 150,
      payment_method: 'cash',
      idempotency_key: 'idem-rec-001',
    };
    const r1 = await call('/api/receipts', ownerTok, 'POST', recBody);
    const r2 = await call('/api/receipts', ownerTok, 'POST', recBody);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const r1j: any = await r1.json();
    const r2j: any = await r2.json();
    expect(r2j.replayed).toBe(true);
    expect(r2j.data.id).toBe(r1j.data.id);

    // Idempotency replay on POST /api/employees/:id/pay & /advance
    const empRes = await call('/api/employees', ownerTok, 'POST', {
      first_name: 'Idem',
      last_name: 'Worker',
      pay_amount: 3000,
      pay_cycle_type: 'monthly',
    });
    expect(empRes.status).toBe(201);
    const empId = ((await empRes.json()) as any).data.id;

    const advBody = { amount: 100, note: 'Justificatif test', idempotency_key: 'idem-adv-001' };
    const a1 = await call(`/api/employees/${empId}/advance`, ownerTok, 'POST', advBody);
    const a2 = await call(`/api/employees/${empId}/advance`, ownerTok, 'POST', advBody);
    expect(a1.status).toBe(200);
    expect(a2.status).toBe(200);
    expect(((await a2.json()) as any).replayed).toBe(true);

    const payBody = { amount: 500, idempotency_key: 'idem-pay-001' };
    const p1 = await call(`/api/employees/${empId}/pay`, ownerTok, 'POST', payBody);
    const p2 = await call(`/api/employees/${empId}/pay`, ownerTok, 'POST', payBody);
    expect(p1.status).toBe(200);
    expect(p2.status).toBe(200);
    expect(((await p2.json()) as any).replayed).toBe(true);

    const payCount: any = sqlite.prepare(`SELECT COUNT(*) AS cnt FROM employee_payments WHERE employee_id = ?`).get(empId);
    expect(payCount.cnt).toBe(2);
  });
});
