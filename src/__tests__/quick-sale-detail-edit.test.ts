// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QuickSaleDetail from '../pages/QuickSaleDetail';
import { api } from '../api';

vi.mock('../auth', () => ({ getToken: () => 'tok' }));
vi.mock('../components/AppDialogs', () => ({
  useUi: () => ({
    toast: vi.fn(),
    confirm: vi.fn(async () => true),
    prompt: vi.fn(async () => 'motif valide'),
  }),
}));

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('QuickSaleDetail in-place editing', () => {
  it('allows editing client/info and unpaid VR lines in-place', async () => {
    const ticket = {
      id: 42,
      number: 'VR-0042',
      doc_kind: 'quick_sale',
      status: 'sent',
      total: 300,
      amount_paid: 0,
      tax_amount: 0,
      client_name: 'Client Comptoir',
      issue_date: '2026-10-20',
      items: [{ id: 1, product_id: 7, product_name: 'Marbre blanc', quantity: 2, unit_price: 150, line_total: 300 }],
    };
    vi.spyOn(api, 'getInvoice').mockResolvedValue({ data: ticket });
    vi.spyOn(api, 'getInvoicePayments').mockResolvedValue({ data: [] });
    vi.spyOn(api, 'getProducts').mockResolvedValue({ data: [{ id: 7, name: 'Marbre blanc', price: 150 }] });
    vi.spyOn(api, 'getClients').mockResolvedValue({ data: [{ id: 1, name: 'Client Pro', ice: 'ICE123' }] });
    const updateInvoice = vi.spyOn(api, 'updateInvoice').mockResolvedValue({ data: ticket });

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ['/quick-sale/42'] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: '/quick-sale/:id', element: createElement(QuickSaleDetail) }),
          ),
        ),
      );
    });

    // Click "Modifier infos"
    const infoBtn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Modifier infos'))!;
    expect(infoBtn).toBeDefined();
    await act(async () => infoBtn.click());
    const saveInfoBtn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Enregistrer')!;
    await act(async () => saveInfoBtn.click());
    expect(updateInvoice).toHaveBeenCalledWith(42, expect.objectContaining({ client_name: 'Client Comptoir' }));

    // Click "Modifier lignes" (unpaid ticket)
    const linesBtn = [...host.querySelectorAll('button')].find((b) => b.textContent?.includes('Modifier lignes'))!;
    expect(linesBtn).toBeDefined();
    await act(async () => linesBtn.click());
    const saveLinesBtn = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Enregistrer les lignes')!;
    await act(async () => saveLinesBtn.click());
    expect(updateInvoice).toHaveBeenLastCalledWith(
      42,
      expect.objectContaining({
        tax_exempt: true,
        items: [expect.objectContaining({ product_name: 'Marbre blanc', quantity: 2, unit_price: 150, tax_rate: 0 })],
      }),
    );
  });
});
