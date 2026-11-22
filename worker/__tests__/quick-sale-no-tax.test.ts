import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
vi.mock('../lib/reliability', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/reliability')>(),
  proactiveFtsHealth: async () => {}, ensureProductSearchIndex: async () => false,
}));
import { readFileSync } from 'node:fs';
const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };
const { default: app } = await import('../index');

let sqlite: any, env: any;
const ip = '203.0.113.105';
function dbFor(database: any) {
  return {
    prepare(sql: string) {
      let args: any[] = [];
      const stmt: any = {
        bind(...a: any[]) { args = a; return stmt; },
        async first() { return database.prepare(sql).get(...args) || null; },
        async all() { return { results: database.prepare(sql).all(...args) }; },
        async run() { const r = database.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      };
      return stmt;
    },
    async batch(stmts: any[]) { database.exec('BEGIN'); try { const out = []; for (const stmt of stmts) out.push(await stmt.run()); database.exec('COMMIT'); return out; } catch (error) { database.exec('ROLLBACK'); throw error; } },
  };
}
async function sha256(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function token(username: string, role: string) {
  const material = username === 'admin' ? await sha256('owner-key|admin|OwnerPass123!') : `secret-${username}`;
  const proof = await sha256(`proof|${username}|${role}|${material}|${ip}|none`);
  return btoa(`stock-auth-v2|${username}|${role}|${ip}|none|${proof}`);
}
async function call(path: string, t?: string, method = 'GET', body?: unknown) {
  return app.fetch(new Request(`http://test.local${path}`, { method, headers: { 'CF-Connecting-IP': ip, ...(t ? { Authorization: `Bearer ${t}` } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, {} as any);
}
beforeAll(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'));
  sqlite.exec(`CREATE TABLE app_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT, password_salt TEXT DEFAULT '', role TEXT, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
    INSERT INTO app_users (username,password_hash,role) VALUES ('alice','secret-alice','stock'), ('bob','secret-bob','stock');`);
  env = { DB: dbFor(sqlite), ADMIN_PASSWORD: 'OwnerPass123!', EMAIL: { send: async () => ({}) } };
});
afterAll(() => sqlite.close());

describe('quick-sale tax safeguards', () => {
  it('converts an unpaid taxed quote to a quick sale using its unit prices without tax', async () => {
    sqlite.exec(`ALTER TABLE invoices ADD COLUMN doc_kind TEXT DEFAULT ''; INSERT INTO products (name, sku, stock_quantity) VALUES ('Marble', 'VRTEST', 10);
      INSERT INTO invoices (number, client_name, issue_date, status, subtotal, tax_amount, total) VALUES ('DQ-TEST', 'Client', '2026-10-19', 'quote', 100, 20, 120);
      INSERT INTO invoice_items (invoice_id, product_id, product_name, quantity, unit_price, tax_rate, line_total) VALUES (last_insert_rowid(), (SELECT id FROM products WHERE sku='VRTEST'), 'Marble', 1, 100, 20, 120);`);
    const id = sqlite.prepare("SELECT id FROM invoices WHERE number='DQ-TEST'").get().id;
    const res = await call(`/api/invoices/${id}/convert-quote`, await token('admin', 'owner'), 'POST', { target: 'quick_sale' });
    expect(res.status).toBe(200);
    expect(sqlite.prepare('SELECT total,tax_amount,subtotal,doc_kind FROM invoices WHERE id=?').get(id)).toMatchObject({ total:100, tax_amount:0, subtotal:100, doc_kind:'quick_sale' });
    expect(sqlite.prepare('SELECT tax_rate,line_total FROM invoice_items WHERE invoice_id=?').get(id)).toMatchObject({ tax_rate:0, line_total:100 });
    expect(sqlite.prepare("SELECT stock_quantity FROM products WHERE sku='VRTEST'").get().stock_quantity).toBe(9);
  });
  it('does not convert a quote with payments or change its stock', async () => {
    sqlite.exec(`INSERT INTO invoices (number,client_name,issue_date,status,subtotal,tax_amount,total,amount_paid) VALUES ('DQ-PAID','Client','2026-10-20','quote',100,20,120,50);
      INSERT INTO invoice_items (invoice_id,product_id,product_name,quantity,unit_price,tax_rate,line_total) VALUES (last_insert_rowid(),(SELECT id FROM products WHERE sku='VRTEST'),'Marble',1,100,20,120);`);
    const id = sqlite.prepare("SELECT id FROM invoices WHERE number='DQ-PAID'").get().id;
    const res = await call(`/api/invoices/${id}/convert-quote`, await token('admin','owner'), 'POST', {target:'quick_sale'});
    expect(res.status).toBe(400); expect((await res.json() as any).code).toBe('QUOTE_HAS_PAYMENTS');
    expect(sqlite.prepare('SELECT total,amount_paid FROM invoices WHERE id=?').get(id)).toMatchObject({total:120,amount_paid:50});
    expect(sqlite.prepare("SELECT stock_quantity FROM products WHERE sku='VRTEST'").get().stock_quantity).toBe(9);
  });
  it('applies per-product invoice modes and ignores them for quick sales', async () => {
    const t = await token('admin','owner');
    const makeProduct = async (name: string, mode: string) => {
      const res = await call('/api/products', t, 'POST', { name, sku: name, price: 100, track_inventory: 0, tax_rate: 20, invoice_price_mode: mode });
      expect(res.status).toBe(201); return (await res.json() as any).data.id;
    };
    const exclusive = await makeProduct('PRICE-EXCL', 'exclusive');
    const inclusive = await makeProduct('PRICE-INCL', 'inclusive');
    const variant = await call(`/api/products/${inclusive}/variants`, t, 'POST', {variant_label:'Large'});
    expect(variant.status).toBe(201); expect((await variant.json() as any).data.invoice_price_mode).toBe('inclusive');
    const lines = [exclusive, inclusive].map(id => ({product_id:id, product_name:'Item', quantity:1, unit_price:100, list_price:100}));
    const invoice = await call('/api/invoices', t, 'POST', {client_name:'Client', issue_date:'2026-10-19', status:'sent', prices_ttc:true, items:lines});
    expect(invoice.status).toBe(201);
    const inv: any = (await invoice.json() as any).data;
    expect(inv.total).toBeCloseTo(220, 2); expect(inv.tax_amount).toBe(37);
    const invoiceLines = sqlite.prepare('SELECT unit_price,line_total FROM invoice_items WHERE invoice_id=? ORDER BY id').all(inv.id);
    expect(invoiceLines[0].unit_price).toBe(100); expect(invoiceLines[1].unit_price).toBeCloseTo(83.333333, 5); expect(invoiceLines[1].line_total).toBe(100);
    const quote = await call('/api/invoices', t, 'POST', {client_name:'Client', issue_date:'2026-10-19', status:'quote', prices_ttc:true, price_mode:'ttc', items:lines});
    expect(quote.status).toBe(201);
    const quoted: any = (await quote.json() as any).data;
    expect(quoted).toMatchObject({total:240, tax_amount:40});
    const quoteLines = sqlite.prepare('SELECT unit_price,line_total FROM invoice_items WHERE invoice_id=? ORDER BY id').all(quoted.id);
    expect(quoteLines).toEqual([expect.objectContaining({unit_price:100,line_total:120}), expect.objectContaining({unit_price:100,line_total:120})]);
    const quick = await call('/api/invoices', t, 'POST', {client_name:'Client', issue_date:'2026-10-19', quick_sale:true, prices_ttc:true, price_mode:'ttc', created_by:'forged', approved_by:'forged', items:lines});
    expect(quick.status).toBe(201);
    const vr: any = (await quick.json() as any).data;
    expect(vr).toMatchObject({ total:200, tax_amount:0, created_by:'admin', approved_by:null });
    const rows = sqlite.prepare('SELECT tax_rate, line_total FROM invoice_items WHERE invoice_id=? ORDER BY id').all(vr.id);
    expect(rows).toEqual([expect.objectContaining({tax_rate:0,line_total:100}),expect.objectContaining({tax_rate:0,line_total:100})]);
  });
  it('uses zero rate for historical VRs in JSON and CSV while retaining invoice VAT', async () => {
    sqlite.exec(`INSERT INTO invoices (number,client_name,issue_date,status,subtotal,tax_amount,total,doc_kind) VALUES ('VR-OLD','Client','2026-10-20','sent',100,20,120,'quick_sale'), ('FA-TEST','Client','2026-10-20','sent',100,20,120,'invoice');
      INSERT INTO invoice_items (invoice_id,product_name,quantity,unit_price,tax_rate,line_total) SELECT id,'Item',1,100,20,120 FROM invoices WHERE number IN ('VR-OLD','FA-TEST');`);
    const t = await token('admin','owner');
    const report = await call('/api/reports/tva?from=2026-10-20&to=2026-10-20', t); expect(report.status).toBe(200);
    const body: any = await report.json();
    expect(body.data.sales).toEqual(expect.arrayContaining([expect.objectContaining({tax_rate:0,base_ht:120,tva:0}), expect.objectContaining({tax_rate:20,base_ht:100,tva:20})]));
    const csv = await call('/api/reports/tva.csv?from=2026-10-20&to=2026-10-20',t); expect(csv.status).toBe(200); expect(await csv.text()).toContain('Vente;0;120.00;0.00');
    sqlite.exec(`INSERT INTO invoices (number,client_name,issue_date,status,subtotal,tax_amount,total,doc_kind) VALUES ('WR-TEST','Client','2026-10-20','remboursement',50,0,50,'remboursement');
      INSERT INTO invoice_items (invoice_id,product_name,quantity,unit_price,tax_rate,line_total) VALUES (last_insert_rowid(),'Refund',1,50,0,50);`);
    const withCredit: any = await (await call('/api/reports/tva?from=2026-10-20&to=2026-10-20',t)).json();
    expect(withCredit.data.credits).toEqual([expect.objectContaining({tax_rate:0,base_ht:50,tva:0})]);
    const csvCredit = await call('/api/reports/tva.csv?from=2026-10-20&to=2026-10-20',t); expect(await csvCredit.text()).toContain('Avoir_WR;0;50.00;0.00');
    const html = await call('/api/reports/tva.html?from=2026-10-20&to=2026-10-20',t); expect(html.status).toBe(200); expect(await html.text()).toContain('120');
    expect(sqlite.prepare("SELECT total,tax_amount FROM invoices WHERE number='VR-OLD'").get()).toMatchObject({ total:120, tax_amount:20 });
  });
  it('keeps tax at zero when editing an untaxed quick sale even if a line supplies VAT', async () => {
    sqlite.exec(`INSERT INTO invoices (number,client_name,issue_date,status,subtotal,tax_amount,total,doc_kind) VALUES ('VR-EDIT','Client','2026-10-20','sent',100,0,100,'quick_sale');
      INSERT INTO invoice_items (invoice_id,product_name,quantity,unit_price,tax_rate,line_total) VALUES (last_insert_rowid(),'Item',1,100,0,100);`);
    const id = sqlite.prepare("SELECT id FROM invoices WHERE number='VR-EDIT'").get().id;
    const response = await call(`/api/invoices/${id}`, await token('admin','owner'), 'PUT', { items: [{ product_name:'Item', quantity:1, unit_price:100, tax_rate:20 }] });
    expect(response.status).toBe(200);
    const result: any = (await response.json() as any).data;
    expect(result).toMatchObject({ tax_amount:0, total:100, tax_exempt:1 });
    expect(result.items[0]).toMatchObject({ tax_rate:0, line_total:100 });
  });
  it('refuses to turn tax on for a quick sale', async () => {
    const id = sqlite.prepare("SELECT id FROM invoices WHERE number='VR-OLD'").get().id;
    const response = await call(`/api/invoices/${id}`, await token('admin','owner'), 'PUT', { tax_exempt: false });
    expect(response.status).toBe(400); expect((await response.json() as any).code).toBe('QUICK_SALE_NO_TAX');
    const edit = await call(`/api/invoices/${id}`, await token('admin','owner'), 'PUT', { items: [{ product_name: 'Item', quantity: 1, unit_price: 100, tax_rate: 20 }] });
    expect(edit.status).toBe(400); expect((await edit.json() as any).code).toBe('QUICK_SALE_HISTORICAL_TAX');
  });
});

describe('atomic quote conversion', () => {
  it('rolls back every product, location, movement and quote when a later product is short', async () => {
    sqlite.exec(`INSERT INTO products (name,sku,stock_quantity) VALUES ('Enough','C-GOOD',10),('Short','C-BAD',1);
      INSERT INTO invoices (number,client_name,issue_date,status,subtotal,tax_amount,total) VALUES ('DQ-ROLLBACK','Client','2026-10-20','quote',200,40,240);
      INSERT INTO invoice_items (invoice_id,product_id,product_name,quantity,unit_price,tax_rate,line_total)
        SELECT (SELECT id FROM invoices WHERE number='DQ-ROLLBACK'), id, name, 2, 100, 20, 240 FROM products WHERE sku IN ('C-GOOD','C-BAD');`);
    const id = sqlite.prepare("SELECT id FROM invoices WHERE number='DQ-ROLLBACK'").get().id;
    const res = await call(`/api/invoices/${id}/convert-quote`, await token('admin','owner'), 'POST', {target:'quick_sale'});
    expect(res.status).toBe(409);
    expect(sqlite.prepare("SELECT stock_quantity FROM products WHERE sku='C-GOOD'").get().stock_quantity).toBe(10);
    expect(sqlite.prepare("SELECT stock_quantity FROM products WHERE sku='C-BAD'").get().stock_quantity).toBe(1);
    expect(sqlite.prepare('SELECT status,total,tax_amount FROM invoices WHERE id=?').get(id)).toMatchObject({status:'quote',total:240,tax_amount:40});
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM stock_movements WHERE reason='Devis→VR' AND product_id IN (SELECT id FROM products WHERE sku IN ('C-GOOD','C-BAD'))").get().n).toBe(0);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM stock_location_qty WHERE product_id IN (SELECT id FROM products WHERE sku IN ('C-GOOD','C-BAD'))").get().n).toBe(0);
  });
  it('aggregates duplicate product lines before checking stock', async () => {
    sqlite.exec(`INSERT INTO invoices (number,client_name,issue_date,status,subtotal,tax_amount,total) VALUES ('DQ-DUP','Client','2026-10-20','quote',200,40,240);
      INSERT INTO invoice_items (invoice_id,product_id,product_name,quantity,unit_price,tax_rate,line_total)
        SELECT (SELECT id FROM invoices WHERE number='DQ-DUP'), id, name, 1, 100, 20, 120 FROM products WHERE sku='C-BAD';
      INSERT INTO invoice_items (invoice_id,product_id,product_name,quantity,unit_price,tax_rate,line_total)
        SELECT (SELECT id FROM invoices WHERE number='DQ-DUP'), id, name, 1, 100, 20, 120 FROM products WHERE sku='C-BAD';`);
    const id = sqlite.prepare("SELECT id FROM invoices WHERE number='DQ-DUP'").get().id;
    expect((await call(`/api/invoices/${id}/convert-quote`, await token('admin','owner'), 'POST', {target:'quick_sale'})).status).toBe(409);
    expect(sqlite.prepare("SELECT stock_quantity FROM products WHERE sku='C-BAD'").get().stock_quantity).toBe(1);
  });
});

describe('document creator attribution', () => {
  it('uses the authenticated creator for manually created bills and receipts', async () => {
    const t = await token('admin','owner');
    const bill = await call('/api/bills', t, 'POST', { vendor_name:'Vendor', issue_date:'2026-10-20', created_by:'forged', approved_by:'forged', items:[{product_name:'Item',quantity:1,unit_cost:10}] });
    expect(bill.status).toBe(201);
    const storedBill = sqlite.prepare("SELECT created_by,approved_by FROM bills WHERE vendor_name='Vendor'").get();
    expect(storedBill).toMatchObject({created_by:'admin',approved_by:null});
    const receipt = await call('/api/receipts', t, 'POST', {client_name:'Customer',amount:10,issue_date:'2026-10-20',created_by:'forged',approved_by:'forged'});
    expect(receipt.status).toBe(201);
    expect((await receipt.json() as any).data).toMatchObject({created_by:'admin',approved_by:null});
    const historical = sqlite.prepare("SELECT created_by,approved_by FROM invoices WHERE number='VR-OLD'").get();
    expect(historical).toMatchObject({created_by:null,approved_by:null});
  });
});

describe('dual-unit product metadata', () => {
  it('persists and exposes the factor while stock continues to be counted in primary units', async () => {
    const t = await token('admin','owner');
    const created = await call('/api/products', t, 'POST', { name:'Marble Carton',sku:'MAR-DUAL',unit:'carton',secondary_unit:'m²',secondary_unit_factor:1.59,stock_quantity:6,price:100 });
    expect(created.status).toBe(201);
    const product: any = (await created.json() as any).data;
    expect(product).toMatchObject({unit:'carton',secondary_unit:'m²',secondary_unit_factor:1.59,stock_quantity:6});
    expect(product.stock_quantity * product.secondary_unit_factor).toBeCloseTo(9.54);
    const list: any = await (await call('/api/products?fields=mobile&include_variants=1', t)).json();
    expect(list.data).toEqual(expect.arrayContaining([expect.objectContaining({id:product.id,secondary_unit:'m²',secondary_unit_factor:1.59})]));
    const variant = await call(`/api/products/${product.id}/variants`, t, 'POST', {variant_label:'large',stock_quantity:0});
    expect(variant.status).toBe(201);
    expect((await variant.json() as any).data).toMatchObject({unit:'carton', secondary_unit:'m²', secondary_unit_factor:1.59});
    const edit = await call(`/api/products/${product.id}`, t, 'PUT', {secondary_unit_factor:2});
    expect(edit.status).toBe(200); expect((await edit.json() as any).data).toMatchObject({secondary_unit_factor:2,stock_quantity:6});
    const invalid = await call(`/api/products/${product.id}`, t, 'PUT', {secondary_unit_factor:0});
    expect(invalid.status).toBe(422);
    expect(sqlite.prepare('SELECT secondary_unit_factor,stock_quantity FROM products WHERE id=?').get(product.id)).toMatchObject({secondary_unit_factor:2,stock_quantity:6});
    const remove = await call(`/api/products/${product.id}`, t, 'PUT', {secondary_unit:null,secondary_unit_factor:null});
    expect(remove.status).toBe(200); expect((await remove.json() as any).data).toMatchObject({secondary_unit:null,secondary_unit_factor:null,stock_quantity:6});
  });
  it.each([{secondary_unit:'m²'}, {secondary_unit_factor:1.59}, {secondary_unit:'carton',secondary_unit_factor:1}, {secondary_unit:'m²',secondary_unit_factor:-1}, {secondary_unit:'m²',secondary_unit_factor:'invalid'}])('rejects invalid conversion metadata: %j', async (fields) => {
    const response = await call('/api/products', await token('admin','owner'), 'POST', {name:'Invalid dual',unit:'carton', ...fields});
    expect(response.status).toBe(422);
  });
});
