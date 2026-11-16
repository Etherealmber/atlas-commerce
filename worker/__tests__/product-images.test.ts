import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
vi.mock('../lib/reliability', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/reliability')>(), proactiveFtsHealth: async () => {}, ensureProductSearchIndex: async () => false,
}));
const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };
const { default: app } = await import('../index');
const { migrateProductImagePage } = await import('../lib/product-images');
let sqlite: any, env: any;
const objects = new Map<string, any>();
const ip = '203.0.113.111';
const dbFor = (database: any) => ({
  prepare(sql: string) {
    let args: any[] = [];
    const statement: any = {
      bind(...a: any[]) { args = a; return statement; },
      async first() { return database.prepare(sql).get(...args) || null; },
      async all() { return { results: database.prepare(sql).all(...args) }; },
      async run() { const r = database.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    };
    return statement;
  },
  async batch(stmts: any[]) { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
});
const bucket = {
  async get(key: string) { const obj = objects.get(key); return obj ? { ...obj, size: obj.bytes.length, arrayBuffer: async () => Uint8Array.from(obj.bytes).buffer } : null; },
  async put(key: string, value: Uint8Array, opts: any) { objects.set(key, { bytes: Uint8Array.from(value), ...opts }); },
  async delete(key: string) { objects.delete(key); },
};
async function sha(s: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))).map(b => b.toString(16).padStart(2, '0')).join(''); }
async function token(name: string, role: string) {
  const secret = name === 'admin' ? await sha('owner-key|admin|OwnerPass123!') : `secret-${name}`;
  return btoa(`stock-auth-v2|${name}|${role}|${ip}|none|${await sha(`proof|${name}|${role}|${secret}|${ip}|none`)}`);
}
async function call(path: string, t: string, method = 'GET', body?: any) {
  return app.fetch(new Request(`http://test.local${path}`, { method, headers: { 'CF-Connecting-IP': ip, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, {} as any);
}
const dataUrl = (mime: string, data: Buffer) => `data:${mime};base64,${data.toString('base64')}`;
beforeAll(() => {
  sqlite = new DatabaseSync(':memory:'); sqlite.exec(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'));
  sqlite.exec(`CREATE TABLE app_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT, password_salt TEXT DEFAULT '', role TEXT, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')));
    INSERT INTO app_users (username,password_hash,role) VALUES ('alice','secret-alice','stock');
    CREATE TABLE product_images (id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, url TEXT NOT NULL, alt_text TEXT DEFAULT '', sort_order INTEGER DEFAULT 0, is_primary INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')));
    INSERT INTO products (id,name,sku) VALUES (11,'Product A','P-A'), (12,'Product B','P-B'), (13,'Product C','P-C');`);
  env = { DB: dbFor(sqlite), IMAGES: bucket, CDN_BASE: 'https://example.test/cdn', ADMIN_PASSWORD: 'OwnerPass123!', EMAIL: { send: async () => ({}) } };
});
afterAll(() => sqlite.close());

describe('product image storage and migration', () => {
  it('normalizes uploads before R2 storage, preserves primary association and returns WebP metadata', async () => {
    const source = await sharp({ create: { width: 90, height: 60, channels: 3, background: '#e44' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const response = await call('/api/catalog/products/11/images', await token('alice', 'stock'), 'POST', { data_url: dataUrl('image/jpeg', source), is_primary: true, alt_text: 'front' });
    expect(response.status).toBe(201);
    const json: any = await response.json();
    expect(json.data).toMatchObject({ product_id: 11, alt_text: 'front', is_primary: 1, content_type: 'image/webp' });
    expect(json.data.url).toMatch(/^https:\/\/example\.test\/cdn\/products\/11\/normalized\/v1\/[a-f0-9]{64}\.webp$/);
    const key = json.data.url.split('/cdn/')[1]; const object = objects.get(key);
    expect(object.httpMetadata.contentType).toBe('image/webp');
    expect(await sharp(object.bytes).metadata()).toMatchObject({ format: 'webp', width: 60, height: 60 });
    expect(sqlite.prepare('SELECT image_url FROM products WHERE id=11').get().image_url).toBe(json.data.url);
  });
  it('normalizes direct product image references and reuses normalized bytes without re-encoding', async () => {
    const t = await token('alice', 'stock');
    const png = await sharp({ create: { width: 45, height: 25, channels: 4, background: '#7ab' } }).png().toBuffer();
    const created = await call('/api/products', t, 'POST', { name: 'Direct image', sku: 'DIRECT-IMG', image_url: dataUrl('image/png', png) });
    expect(created.status).toBe(201);
    const product: any = (await created.json() as any).data;
    expect(product.image_url).toMatch(/\.webp$/);
    const before = objects.size;
    const res = await call(`/api/catalog/products/${product.id}/images`, t, 'POST', { url: product.image_url });
    expect(res.status).toBe(201);
    expect((await res.json() as any).data.url).toBe(product.image_url);
    expect(objects.size).toBe(before);
  });
  it('rejects invalid bytes and missing R2 without changing product associations', async () => {
    const before = sqlite.prepare('SELECT count(*) AS n FROM product_images WHERE product_id=11').get().n;
    const invalid = await call('/api/catalog/products/11/images', await token('alice', 'stock'), 'POST', { data_url: dataUrl('image/jpeg', Buffer.from('not an image')) });
    expect(invalid.status).toBe(400);
    const missingBucket = env.IMAGES; env.IMAGES = undefined;
    try { expect((await call('/api/catalog/products/11/images', await token('alice', 'stock'), 'POST', { data_url: dataUrl('image/png', Buffer.from('bad')) })).status).toBe(503); }
    finally { env.IMAGES = missingBucket; }
    expect(sqlite.prepare('SELECT count(*) AS n FROM product_images WHERE product_id=11').get().n).toBe(before);
  });
  it('normalizes replacements and keeps prior immutable objects for other references', async () => {
    const t = await token('alice', 'stock');
    const row = sqlite.prepare('SELECT * FROM product_images WHERE product_id=11 ORDER BY id LIMIT 1').get();
    const png = await sharp({ create: { width: 80, height: 50, channels: 4, background: '#4f8' } }).png().toBuffer();
    const resp = await call(`/api/catalog/products/11/images/${row.id}`, t, 'PUT', { data_url: dataUrl('image/png', png), alt_text: 'replaced' });
    expect(resp.status).toBe(200);
    const data: any = (await resp.json() as any).data;
    expect(data).toMatchObject({ id: row.id, product_id: 11, content_type: 'image/webp', alt_text: 'replaced' });
    expect(data.url).not.toBe(row.url);
    expect(objects.has(row.url.split('/cdn/')[1])).toBe(true);
    expect(sqlite.prepare('SELECT image_url FROM products WHERE id=11').get().image_url).toBe(data.url);
    const list: any = await (await call('/api/catalog/products/11/images', t)).json();
    expect(list.data[0].content_type).toBe('image/webp');
  });
  it('rejects streaming JSON bodies beyond the limit even without Content-Length', async () => {
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(6 * 1024 * 1024 + 1)); controller.close(); } });
    const request = new Request('http://test.local/api/catalog/products/11/images', { method: 'POST', headers: { 'CF-Connecting-IP': ip, Authorization: `Bearer ${await token('alice','stock')}`, 'Content-Type': 'application/json' }, body: stream, duplex: 'half' } as any);
    expect((await app.fetch(request, env, {} as any)).status).toBe(413);
  });
  it('does not overwrite a product image that changed during migration', async () => {
    const png = await sharp({ create: { width: 20, height: 30, channels: 3, background: 'green' } }).png().toBuffer();
    await bucket.put('products/12/race.png', png, { httpMetadata: { contentType: 'image/png' } });
    const old = 'https://example.test/cdn/products/12/race.png';
    sqlite.prepare('INSERT INTO product_images (id,product_id,url,is_primary) VALUES (60,12,?,1)').run(old);
    sqlite.prepare('UPDATE products SET image_url=? WHERE id=12').run(old);
    const racingDb = { ...env.DB, async batch(stmts: any[]) { sqlite.prepare('UPDATE product_images SET url=? WHERE id=60').run('https://example.test/cdn/products/12/new.png'); return env.DB.batch(stmts); } };
    const page = await migrateProductImagePage(racingDb, env, 'images', 59, 1);
    expect(page.failures).toEqual([{ id: 60, code: 'CONFLICT' }]);
    expect(sqlite.prepare('SELECT image_url FROM products WHERE id=12').get().image_url).toBe(old);
    expect(sqlite.prepare('SELECT url FROM product_images WHERE id=60').get().url).toMatch(/new.png$/);
    sqlite.exec('DELETE FROM product_images WHERE id=60');
  });
  it('migrates old bucket and inline images in bounded batches, preserves links, and can rerun', async () => {
    const png = await sharp({ create: { width: 100, height: 70, channels: 3, background: 'blue' } }).png().toBuffer();
    await bucket.put('products/12/old.png', png, { httpMetadata: { contentType: 'image/png' } });
    const old = 'https://example.test/cdn/products/12/old.png';
    sqlite.prepare('UPDATE products SET image_url=? WHERE id=12').run(old);
    sqlite.prepare('INSERT INTO product_images (id,product_id,url,alt_text,sort_order,is_primary) VALUES (70,12,?,\'legacy\',9,1)').run(old);
    sqlite.prepare('UPDATE products SET image_url=? WHERE id=13').run(dataUrl('image/png', png));
    const owner = await token('admin', 'owner');
    expect((await call('/api/admin/product-images/normalize', await token('alice','stock'), 'POST', {})).status).toBe(403);
    const res: any = await (await call('/api/admin/product-images/normalize', owner, 'POST', { phase: 'images', after: 69, limit: 3 })).json();
    expect(res.data).toMatchObject({ updated: 1, failed: 0 });
    const record = sqlite.prepare('SELECT * FROM product_images WHERE id=70').get();
    expect(record).toMatchObject({ product_id: 12, alt_text: 'legacy', sort_order: 9, is_primary: 1 });
    expect(record.url).toMatch(/\.webp$/);
    expect(sqlite.prepare('SELECT image_url FROM products WHERE id=12').get().image_url).toBe(record.url);
    expect(objects.has('products/12/old.png')).toBe(true);
    const productRes: any = await (await call('/api/admin/product-images/normalize', owner, 'POST', { phase: 'products', after: 12, limit: 3 })).json();
    expect(productRes.data.updated).toBe(1);
    expect(sqlite.prepare('SELECT image_url FROM products WHERE id=13').get().image_url).toMatch(/\.webp$/);
    const second = await migrateProductImagePage(env.DB, env, 'images', 69, 3);
    expect(second).toMatchObject({ updated: 0, unchanged: 1, failed: 0 });
  });
  it('preserves unsupported or invalid legacy sources and reports failures', async () => {
    sqlite.prepare('INSERT INTO product_images (id,product_id,url) VALUES (80,12,?)').run('https://untrusted.example/picture.png');
    const page = await migrateProductImagePage(env.DB, env, 'images', 79, 3);
    expect(page).toMatchObject({ updated: 0, failed: 1, failures: [{ id: 80, code: 'UNSUPPORTED_SOURCE' }] });
    expect(sqlite.prepare('SELECT url FROM product_images WHERE id=80').get().url).toBe('https://untrusted.example/picture.png');
  });
});
