import { expect, it } from 'vitest';
import { Hono } from 'hono';
import { qrToSvg } from '../qrSvg';
import { registerAtlasV209Routes } from '../routes/atlas-v209';

it('renders the light-theme Atlas mark on a white center plate with a four-module quiet zone', () => {
  const svg = qrToSvg('https://example.org/verify/abc', 100, 2);
  expect(svg).toMatch(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" rx="[\d.]+" fill="#ffffff"\/>/);
  expect(svg).not.toMatch(/<rect x="[\d.]+" y="[\d.]+" width="[\d.]+" height="[\d.]+" rx="[\d.]+" fill="#0a0a0a"\/>/);
  expect(svg).toContain('data:image/png;base64,');
  expect(svg).toContain('M4 4h1v1h-1z');
});

it('renders /api/products/:id/label.svg without nested <?xml processing instructions and without QR/barcode overlap', async () => {
  const app = new Hono();
  const db: any = {
    prepare(sql: string) {
      return {
        bind() { return this; },
        async run() { return { success: true, meta: {} }; },
        async first() {
          if (/FROM products/i.test(sql)) {
            return {
              id: 7,
              name: 'Marbre Carrara Poli Extra Long Label',
              sku: 'MAR-CARRARA-POLI-2026-001',
              barcode: '3760123456789012',
              price: 1250,
              unit: 'm²',
              location: 'A1-04',
            };
          }
          return { currency: 'MAD' };
        },
        async all() { return { results: [] }; },
      };
    },
  };
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
  expect(svg.startsWith('<svg ')).toBe(true);
  expect(svg).not.toContain('<?xml');

  const qrMatch = svg.match(/<svg x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"[^>]*shape-rendering="crispEdges"/);
  const barMatch = svg.match(/<svg x="(\d+)" y="(\d+)"[^>]*width="(\d+)" height="(\d+)"[^>]*fill="#0a0a0a"/);
  expect(qrMatch).not.toBeNull();
  expect(barMatch).not.toBeNull();

  const qrX = Number(qrMatch![1]);
  const barX = Number(barMatch![1]);
  const barW = Number(barMatch![3]);
  expect(barX + barW).toBeLessThan(qrX);
});
