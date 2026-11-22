// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import QuickSaleDetail from '../pages/QuickSaleDetail';
import InvoiceDetail from '../pages/InvoiceDetail';
import ProductHistory from '../pages/ProductHistory';
import { AppDialogsProvider } from '../components/AppDialogs';
import { api } from '../api';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ success: true, data: [] }), { headers: { 'Content-Type': 'application/json' } })),
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Detail page TopPageActions, Danger Zone, and ProductHistory layout', () => {
  it('QuickSaleDetail keeps only Imprimer & Remboursement in top actions and puts Annuler/Supprimer in bottom Danger Zone', async () => {
    vi.spyOn(api, 'getInvoice').mockResolvedValue({
      data: {
        id: 7,
        number: 'VR-2026-0007',
        doc_kind: 'quick_sale',
        status: 'sent',
        total: 500,
        amount_paid: 0,
        items: [],
      },
    } as any);
    vi.spyOn(api, 'getInvoicePayments').mockResolvedValue({ data: [] } as any);

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ['/quick-sale/7'] },
          createElement(
            AppDialogsProvider,
            null,
            createElement(
              Routes,
              null,
              createElement(Route, { path: '/quick-sale/:id', element: createElement(QuickSaleDetail) }),
            ),
          ),
        ),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const topActions = host.querySelector('.top-page-actions');
    expect(topActions).toBeTruthy();
    const topText = topActions?.textContent || '';
    expect(topText).toContain('Imprimer');
    expect(topText).toContain('Créer un remboursement');
    expect(topText).not.toContain('PDF');
    expect(topText).not.toContain('Ticket thermique');
    expect(topText).not.toContain('Annuler (stock)');
    expect(topText).not.toContain('Supprimer');

    const dz = host.querySelector('.ac-danger-zone');
    expect(dz).toBeTruthy();
    expect(dz?.textContent).toContain('Annuler (stock)');
    expect(dz?.querySelector('[data-atlas-delete="1"]')).toBeTruthy();
  });

  it('InvoiceDetail removes PDF/ticket clutter from top actions and renders bottom Danger Zone', async () => {
    vi.spyOn(api, 'getInvoice').mockResolvedValue({
      data: {
        id: 12,
        number: 'FAC-2026-0012',
        doc_kind: 'invoice',
        status: 'sent',
        total: 1200,
        amount_paid: 0,
        items: [],
      },
    } as any);
    vi.spyOn(api, 'getInvoicePayments').mockResolvedValue({ data: [] } as any);
    vi.spyOn(api, 'getProducts').mockResolvedValue({ data: [] } as any);
    vi.spyOn(api, 'getReceipts').mockResolvedValue({ data: [] } as any);
    vi.spyOn(api, 'ublClearance').mockResolvedValue({ data: { status: 'draft' } } as any);

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ['/invoices/12'] },
          createElement(
            AppDialogsProvider,
            null,
            createElement(
              Routes,
              null,
              createElement(Route, { path: '/invoices/:id', element: createElement(InvoiceDetail) }),
            ),
          ),
        ),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const topActions = host.querySelector('.top-page-actions');
    expect(topActions).toBeTruthy();
    const topText = topActions?.textContent || '';
    expect(topText).toContain('Imprimer');
    expect(topText).toContain('Export UBL XML');
    expect(topText).toContain('Modifier lignes & promo');
    expect(topText).not.toContain('PDF');
    expect(topText).not.toContain('Imprimer ticket');
    expect(topText).not.toContain('Télécharger ticket');
    expect(topText).not.toContain('Ticket 80mm');

    const dz = host.querySelector('.ac-danger-zone');
    expect(dz).toBeTruthy();
    expect(dz?.textContent).toContain('Annuler');
    expect(dz?.querySelector('[data-atlas-delete="1"]')).toBeTruthy();
  });

  it('ProductHistory moves delete button into bottom Danger Zone', async () => {
    localStorage.setItem('stock_auth_token', 't');
    localStorage.setItem('stock_role', 'admin');
    localStorage.setItem('stock_auth_user', JSON.stringify({ role: 'admin', username: 'admin' }));
    vi.spyOn(api, 'getProduct').mockResolvedValue({
      data: { id: 9, name: 'Marbre Blanc', stock_quantity: 5, track_inventory: 1, price: 250 },
    } as any);
    vi.spyOn(api, 'getProductMovements').mockResolvedValue({ data: [] } as any);

    await act(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ['/products/9/historique'] },
          createElement(
            Routes,
            null,
            createElement(Route, { path: '/products/:id/historique', element: createElement(ProductHistory) }),
          ),
        ),
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const topActions = host.querySelector('.product-history-actions');
    expect(topActions).toBeTruthy();
    expect(topActions?.querySelector('[data-atlas-delete="1"]')).toBeNull();
    const dz = host.querySelector('.ac-danger-zone');
    expect(dz?.querySelector('[data-atlas-delete="1"]')).toBeTruthy();
  });
});
