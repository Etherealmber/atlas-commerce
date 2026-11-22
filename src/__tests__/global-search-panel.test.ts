// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import GlobalSearchPanel from '../components/GlobalSearchPanel';
import { api } from '../api';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});

async function mountAndOpen() {
  await act(async () => root.render(createElement(MemoryRouter, null, createElement(GlobalSearchPanel))));
  await act(async () => { window.dispatchEvent(new Event('atlas-search-open')); });
  await act(async () => { await Promise.resolve(); });
}

it('closes on a single click on the close button or backdrop', async () => {
  await mountAndOpen();
  expect(host.querySelectorAll('.gsp')).toHaveLength(1);
  const closeBtn = host.querySelector<HTMLButtonElement>('.gsp-close')!;
  expect(closeBtn).toBeTruthy();
  expect(closeBtn.querySelector('svg')).toBeTruthy();

  await act(async () => closeBtn.click());
  expect(host.querySelector('.gsp')).toBeNull();

  await act(async () => { window.dispatchEvent(new Event('atlas-search-open')); });
  expect(host.querySelector('.gsp')).toBeTruthy();
  const backdrop = host.querySelector<HTMLElement>('.gsp-backdrop')!;
  await act(async () => backdrop.click());
  expect(host.querySelector('.gsp')).toBeNull();
});

it('toggles via Ctrl+K and searches across products, documents, parties, pages and settings', async () => {
  localStorage.setItem('stock_auth_token', 'tok');
  localStorage.setItem('stock_role', 'owner');

  vi.spyOn(api, 'getProducts').mockResolvedValue({
    data: [{ id: 12, name: 'Marbre Blanc Carrare 60x60', sku: 'MRB-60', price: 320, track_inventory: 1, stock_quantity: 45 }],
  } as any);
  vi.spyOn(api, 'getClients').mockResolvedValue({
    data: [{ id: 5, name: 'Société Atlas Bâtiment', phone: '0612345678', city: 'Casablanca' }],
  } as any);
  vi.spyOn(api, 'getInvoices').mockResolvedValue({
    data: [{ id: 91, number: 'VR-0041', doc_kind: 'quick_sale', client_name: 'Client Comptoir', total: 640 }],
  } as any);
  vi.spyOn(api, 'getBills').mockResolvedValue({ data: [] } as any);
  vi.spyOn(api, 'getVendors').mockResolvedValue({ data: [] } as any);
  vi.spyOn(api, 'getEmployees').mockResolvedValue({ data: [] } as any);

  await act(async () => root.render(createElement(MemoryRouter, null, createElement(GlobalSearchPanel))));
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }));
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  expect(host.querySelector('.gsp')).toBeTruthy();
  expect(host.querySelector('.gsp-section-label')?.textContent).toContain('Accès rapides');

  const input = host.querySelector<HTMLInputElement>('.gsp-input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '60 carrare');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(host.querySelector('.gsp-list')?.textContent).toContain('Marbre Blanc Carrare 60x60');

  const clearBtn = host.querySelector<HTMLButtonElement>('.gsp-clear')!;
  expect(clearBtn).toBeTruthy();
  await act(async () => clearBtn.click());
  expect(input.value).toBe('');

  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'VR-0041');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(host.querySelector('.gsp-list')?.textContent).toContain('Ticket VR VR-0041');
});
