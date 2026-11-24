import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { Hono } from 'hono';
import { qrToSvg } from '../qrSvg';
import { registerAtlasV209Routes } from '../routes/atlas-v209';
import { registerPublicSignedRoutes } from '../routes/publicSigned';

function makeProductDb(rows: any[]) {
  return {
    prepare(sql: string) {
      let args: any[] = [];
      return {
        bind(...b: any[]) {
          args = b;
          return this;
        },
        async run() { return { success: true, meta: {} }; },
        async first() {
          if (/FROM company_settings/i.test(sql)) {
            return { company_name: 'Atlas Marbre', currency: 'MAD' };
          }
          if (/FROM products/i.test(sql)) {
            if (/WHERE id = \?/i.test(sql)) {
              const id = Number(args[0]);
              return rows.find((r) => r.id === id && Number(r.is_active ?? 1) === 1) ?? null;
            }
            const ref = String(args[0] || '').toLowerCase();
            return rows.find(
              (r) =>
                Number(r.is_active ?? 1) === 1 &&
                (String(r.barcode || '').toLowerCase() === ref || String(r.sku || '').toLowerCase() === ref),
            ) ?? null;
          }
          return null;
        },
        async all() { return { results: [] }; },
      };
    },
  };
}

function makePublicSignedApp(rows: any[], rateLimited = false) {
  const app = new Hono();
  const db = makeProductDb(rows);
  registerPublicSignedRoutes(app as any, {
    requireOwner: () => null,
    writeAudit: async () => {},
    ensurePaymentHistoryTable: async () => {},
    ensureReceiptsTable: async () => {},
    ensureReceiptSituationColumn: async () => {},
    ensureHmacKeyColumns: async () => {},
    ensureQrPrivacySettings: async () => {},
    ensureInvoicePublicToken: async () => {},
    publicTokenSecretsAsync: async () => [],
    publicRateLimit: async () => rateLimited,
    purgeEphemeralSecurityData: async () => ({}),
    createAtlasTimestampToken: async () => ({}),
    verifyAtlasTimestampToken: async () => ({ valid: false }),
    invoiceDocHashPayload: () => ({}),
    sha256Hex: async () => '0'.repeat(64),
    parseSecureQrPayload: async () => null,
    validateStoredSignature: () => true,
    digestSignatureImage: async () => '0'.repeat(64),
  });
  return { app, db };
}

it('encodes the public /p/:id URL in /api/products/:id/label.svg QR code', async () => {
  const app = new Hono();
  const db = makeProductDb([
    {
      id: 7,
      name: 'hhj',
      sku: 'HHJ-1LVZ',
      barcode: 'HHJ-1LVZ',
      price: 1500,
      unit: 'pièce',
      location: '',
      is_active: 1,
    },
  ]);
  registerAtlasV209Routes(app as any, {
    sessionUserFromHeader: () => ({ username: 'admin', role: 'owner' }),
  });

  const res = await app.request(
    'https://stock.example.test/api/products/7/label.svg',
    { headers: { Authorization: 'Bearer ok' } },
    { DB: db } as any,
  );
  expect(res.status).toBe(200);
  const svg = await res.text();
  const expectedQr = qrToSvg('https://stock.example.test/p/7', 96, 2);
  const expectedPath = expectedQr.match(/<path fill="#0a0a0a" d="([^"]+)"\/>/)?.[1];
  expect(expectedPath).toBeTruthy();
  expect(svg).toContain(expectedPath!);
  expect(svg).toContain('width="96" height="96"');
});

it('serves /api/public/product/:ref without auth and returns only selling price and stock', async () => {
  const rows = [
    {
      id: 7,
      name: 'hhj',
      variant_label: 'Poli',
      sku: 'HHJ-1LVZ',
      barcode: '3760000000072',
      unit: 'pièce',
      price: 1500,
      cost_price: 920,
      supplier_id: 14,
      notes: 'Internal vendor note',
      stock_quantity: 12,
      low_stock_threshold: 5,
      track_inventory: 1,
      is_active: 1,
    },
    {
      id: 8,
      name: 'Article bas',
      sku: 'LOW-8',
      barcode: 'LOW-8',
      unit: 'm²',
      price: 250.5,
      stock_quantity: 2,
      low_stock_threshold: 5,
      track_inventory: 1,
      is_active: 1,
    },
    {
      id: 9,
      name: 'Service libre',
      sku: 'SRV-9',
      barcode: '',
      unit: 'h',
      price: 400,
      stock_quantity: 0,
      low_stock_threshold: 0,
      track_inventory: 0,
      is_active: 1,
    },
    {
      id: 10,
      name: 'Inactif',
      sku: 'OFF-10',
      barcode: 'OFF-10',
      price: 100,
      stock_quantity: 5,
      track_inventory: 1,
      is_active: 0,
    },
  ];
  const { app, db } = makePublicSignedApp(rows);

  for (const ref of ['7', 'P7', 'HHJ-1LVZ', '3760000000072']) {
    const res = await app.request(`https://stock.example.test/api/public/product/${ref}`, {}, { DB: db } as any);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual({
      id: 7,
      name: 'hhj',
      variant_label: 'Poli',
      sku: 'HHJ-1LVZ',
      barcode: '3760000000072',
      unit: 'pièce',
      price: 1500,
      currency: 'MAD',
      track_inventory: true,
      stock_quantity: 12,
      stock_status: 'in_stock',
      company_name: 'Atlas Marbre',
    });
    expect('cost_price' in json.data).toBe(false);
    expect('supplier_id' in json.data).toBe(false);
    expect('notes' in json.data).toBe(false);
  }

  const lowRes = await app.request('https://stock.example.test/api/public/product/8', {}, { DB: db } as any);
  expect(((await lowRes.json()) as any).data.stock_status).toBe('low_stock');

  const untrackedRes = await app.request('https://stock.example.test/api/public/product/9', {}, { DB: db } as any);
  const untrackedJson: any = await untrackedRes.json();
  expect(untrackedJson.data.track_inventory).toBe(false);
  expect(untrackedJson.data.stock_quantity).toBeNull();
  expect(untrackedJson.data.stock_status).toBe('untracked');

  const inactiveRes = await app.request('https://stock.example.test/api/public/product/10', {}, { DB: db } as any);
  expect(inactiveRes.status).toBe(404);

  const missingRes = await app.request('https://stock.example.test/api/public/product/unknown-ref', {}, { DB: db } as any);
  expect(missingRes.status).toBe(404);
});

it('rate limits /api/public/product/:ref when publicRateLimit returns true', async () => {
  const { app, db } = makePublicSignedApp([], true);
  const res = await app.request('https://stock.example.test/api/public/product/7', {}, { DB: db } as any);
  expect(res.status).toBe(429);
});

it('mounts /p/:ref outside Protected in App.tsx', () => {
  const appSource = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  const routeIdx = appSource.indexOf('path="/p/:ref"');
  const protectedIdx = appSource.indexOf('<Protected>');
  expect(routeIdx).toBeGreaterThan(-1);
  expect(protectedIdx).toBeGreaterThan(-1);
  expect(routeIdx).toBeLessThan(protectedIdx);
});

it('works against a real SQLite DB built strictly from migrations/ (no variant_label / finance_currency columns)', async () => {
  const { DatabaseSync } = await import(['node:', 'sqlite'].join('')) as { DatabaseSync: new (p: string) => any };
  const sqlite = new DatabaseSync(':memory:');
  const migDir = path.resolve(process.cwd(), 'migrations');
  const files = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
  expect(files.length).toBeGreaterThan(0);
  for (const f of files) {
    sqlite.exec(fs.readFileSync(path.join(migDir, f), 'utf8'));
  }

  sqlite.prepare(
    `INSERT INTO products (sku, name, barcode, unit, price, cost, stock_quantity, low_stock_threshold, track_inventory, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run('MIG-001', 'Marbre Blanc', '3760000000999', 'm²', 890, 410, 18, 5, 1, 1);

  const realDb = {
    prepare(sql: string) {
      let args: any[] = [];
      return {
        bind(...b: any[]) { args = b; return this; },
        async run() {
          const r = sqlite.prepare(sql).run(...args);
          return { success: true, meta: { changes: Number(r.changes || 0), last_row_id: Number(r.lastInsertRowid || 0) } };
        },
        async first() {
          const r = sqlite.prepare(sql).get(...args);
          return r === undefined ? null : { ...(r as any) };
        },
        async all() {
          return { success: true, results: sqlite.prepare(sql).all(...args).map((r: any) => ({ ...r })), meta: {} };
        },
      };
    },
  };

  const app = new Hono();
  registerPublicSignedRoutes(app as any, {
    requireOwner: () => null,
    writeAudit: async () => {},
    ensurePaymentHistoryTable: async () => {},
    ensureReceiptsTable: async () => {},
    ensureReceiptSituationColumn: async () => {},
    ensureHmacKeyColumns: async () => {},
    ensureQrPrivacySettings: async () => {},
    ensureInvoicePublicToken: async () => {},
    publicTokenSecretsAsync: async () => [],
    publicRateLimit: async () => false,
    purgeEphemeralSecurityData: async () => ({}),
    createAtlasTimestampToken: async () => ({}),
    verifyAtlasTimestampToken: async () => ({ valid: false }),
    invoiceDocHashPayload: () => ({}),
    sha256Hex: async () => '0'.repeat(64),
    parseSecureQrPayload: async () => null,
    validateStoredSignature: () => true,
    digestSignatureImage: async () => '0'.repeat(64),
  });

  for (const ref of ['1', 'P1', 'MIG-001', '3760000000999']) {
    const res = await app.request(`https://stock.example.test/api/public/product/${ref}`, {}, { DB: realDb } as any);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual({
      id: 1,
      name: 'Marbre Blanc',
      variant_label: '',
      sku: 'MIG-001',
      barcode: '3760000000999',
      unit: 'm²',
      price: 890,
      currency: 'MAD',
      track_inventory: true,
      stock_quantity: 18,
      stock_status: 'in_stock',
      company_name: 'My Company',
    });
    expect('cost' in json.data).toBe(false);
  }
});
