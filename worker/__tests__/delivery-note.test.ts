import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { generateDeliveryNoteHTML } from '../lib/printTemplates';

describe('bon de livraison', () => {
  const settings = { company_name: 'Atlas <SARL>', ice: '0012', rc: 'RC 456789', address: '128 bd Anfa' };
  it('renders an A4 BL without prices, escaped, with signatures', () => {
    const html = generateDeliveryNoteHTML(settings, { number: 'BL-2026-0001', issue_date: '2026-11-25', client_name: 'Café <b>' }, [
      { product_name: 'Cire 1 L', sku: 'ENT-023', quantity: 2 },
      { product_name: 'Plan 3 m', quantity: 1.5, unit: 'm' },
    ], { number: 'VR-2026-0012', doc_kind: 'quick_sale' }, false);
    expect(html).toContain('BON DE LIVRAISON');
    expect(html).toContain('BL-2026-0001');
    expect(html).toContain('25/11/2026');
    expect(html).toContain('Ticket : VR-2026-0012');
    expect(html).toContain('Atlas &lt;SARL&gt;');
    expect(html).toContain('Café &lt;b&gt;');
    expect(html).toContain('RC 456789');
    expect(html).not.toContain('RC RC');
    expect(html).toContain('3,5'); // total quantity
    expect(html).toContain('Client — bon pour réception');
    expect(html).not.toMatch(/MAD|Total TTC|Prix/);
    expect(html).not.toContain('window.print()},250');
  });
  it('is reachable with a ?token= print link and allowed by the service worker', () => {
    expect(readFileSync('worker/index.ts', 'utf8')).toContain('delivery-notes\\/\\d+\\/print$/');
    expect(readFileSync('public/sw.js', 'utf8')).toContain('delivery-notes\\/\\d+\\/print');
    const ops = readFileSync('worker/routes/inventoryOps.ts', 'utf8');
    expect(ops).toContain('BL_NOT_ALLOWED');
    expect(ops).toContain('existing: true');
  });
  it('quick sale offers the BL', () => {
    const qs = readFileSync('src/pages/QuickSale.tsx', 'utf8');
    expect(qs).toContain('reserveDeliveryNoteTab()');
    expect(readFileSync('src/pages/QuickSaleDetail.tsx', 'utf8')).toContain('openDeliveryNote(ticket.id)');
  });
});
