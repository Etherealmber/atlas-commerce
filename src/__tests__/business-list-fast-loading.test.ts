// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../api';
import Invoices from '../pages/Invoices';
import Bills from '../pages/Bills';
import Products from '../pages/Products';
import QuickSale from '../pages/QuickSale';

afterEach(() => vi.restoreAllMocks());
it.each([
  ['Invoices', Invoices, '/invoices', 'FA-42'],
  ['Bills', Bills, '/bills', 'BA-42'],
  ['Products', Products, '/products', 'Produit test'],
  ['QuickSale', QuickSale, '/quick-sale', 'VR-42'],
] as const)('%s shows its list while auxiliary lookups are still loading', async (name, Page, path, text) => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const pending = () => new Promise<any>(() => {});
  vi.spyOn(api, 'getInvoices').mockImplementation(async (_status, opts) => ({ data: [{ id: 1, number: opts?.kind === 'quick_sale' ? 'VR-42' : 'FA-42', status: 'sent', total: 10 }] } as any));
  vi.spyOn(api, 'getBills').mockResolvedValue({ data: [{ id: 1, number: 'BA-42', status: 'sent', total: 10 }] } as any);
  vi.spyOn(api, 'getProducts').mockImplementation(() => name === 'Products' ? Promise.resolve({ data: [{ id: 1, name: 'Produit test', stock_quantity: 1, price: 1 }] } as any) : pending());
  vi.spyOn(api, 'getClients').mockImplementation(pending);
  vi.spyOn(api, 'getVendors').mockImplementation(pending);
  vi.spyOn(api, 'getStockLocations').mockImplementation(pending);
  vi.spyOn(api, 'getCategories').mockImplementation(pending);
  vi.spyOn(api, 'getUnits').mockImplementation(pending);
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(Page))));
  expect(host.textContent).toContain(text);
  await act(async () => root.unmount()); host.remove();
});
