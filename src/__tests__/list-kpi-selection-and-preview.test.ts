// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Quotes from '../pages/Quotes';
import { api } from '../api';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.setItem('stock_role', 'owner');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.removeItem('stock_role');
  vi.restoreAllMocks();
});

describe('KPI placement, TopPageActions selection docking, and preview/print auth', () => {
  it('renders 4 KPI cards above the search bar on Quotes (Devis)', async () => {
    vi.spyOn(api, 'getInvoices').mockResolvedValue({
      data: [
        { id: 1, number: 'DEV-0001', client_name: 'Client A', issue_date: '2026-10-10', due_date: '2099-12-31', status: 'quote', total: 1200 },
        { id: 2, number: 'DEV-0002', client_name: 'Client B', issue_date: '2026-01-01', due_date: '2026-02-01', status: 'quote', total: 800 },
      ],
    } as any);
    vi.spyOn(api, 'getClients').mockResolvedValue({ data: [] } as any);
    vi.spyOn(api, 'getProducts').mockResolvedValue({ data: [] } as any);

    await act(async () => {
      root.render(createElement(MemoryRouter, { initialEntries: ['/quotes'] }, createElement(Quotes)));
    });

    const kpiGrid = host.querySelector('.ac-metric-grid')!;
    const filters = host.querySelector('.ac-products-filters')!;
    expect(kpiGrid).not.toBeNull();
    expect(filters).not.toBeNull();
    expect(kpiGrid.querySelectorAll('.ac-metric')).toHaveLength(4);
    expect(kpiGrid.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(kpiGrid.textContent).toContain('Devis');
    expect(kpiGrid.textContent).toContain('En cours');
    expect(kpiGrid.textContent).toContain('Expirés');
    expect(kpiGrid.textContent).toContain('Montant devis');
  });

  it('places KPI summary grids above search filters on Clients, Vendors, and Employees', () => {
    for (const file of ['Clients.tsx', 'Vendors.tsx', 'Employees.tsx', 'Quotes.tsx', 'Invoices.tsx', 'Products.tsx', 'QuickSale.tsx']) {
      const src = readFileSync(resolve(process.cwd(), 'src/pages', file), 'utf8');
      const kpiIdx = src.indexOf('ac-metric-grid');
      const searchIdx = src.indexOf('ac-products-filters');
      expect(kpiIdx).toBeGreaterThan(-1);
      expect(searchIdx).toBeGreaterThan(-1);
      expect(kpiIdx).toBeLessThan(searchIdx);
    }
  });

  it('keeps TopPageActions docked during multi-select and keeps add + delete together', () => {
    for (const file of ['Clients.tsx', 'Bills.tsx']) {
      const src = readFileSync(resolve(process.cwd(), 'src/pages', file), 'utf8');
      expect(src).not.toContain('enabled={selected.size === 0}');
    }
    const productsSrc = readFileSync(resolve(process.cwd(), 'src/pages/Products.tsx'), 'utf8');
    expect(productsSrc).not.toContain('product-selection-bar');
    expect(productsSrc).toContain('selected.size > 0');
  });

  it('supports qr_situation query toggle on receipt preview and print ticket auth on employee print', () => {
    const docPreviewSrc = readFileSync(resolve(process.cwd(), 'worker/routes/docPreviews.ts'), 'utf8');
    expect(docPreviewSrc).toContain("c.req.query('qr_situation')");
    const workerSrc = readFileSync(resolve(process.cwd(), 'worker/index.ts'), 'utf8');
    expect(workerSrc).toContain("set('printTicketOk', true)");
    expect(workerSrc).toContain("get('printTicketOk') === true");
  });
});
