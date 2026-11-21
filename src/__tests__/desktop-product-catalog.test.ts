// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Products from '../pages/Products';
import { api } from '../api';
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; localStorage.setItem('stock_role', 'owner'); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  vi.spyOn(api, 'getProducts').mockResolvedValue({ data: [{ id: 4, name: 'Marbre', sku: 'M-4', price: 25, cost: 12, stock_quantity: 4, low_stock_threshold: 2, track_inventory: 1, image_url: '/cdn/marbre.webp' }] });
  vi.spyOn(api, 'getStockLocations').mockResolvedValue({ data: [] }); vi.spyOn(api, 'getCategories').mockResolvedValue({ data: [] }); vi.spyOn(api, 'getUnits').mockResolvedValue({ data: [] });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.removeItem('stock_role'); localStorage.removeItem('atlas_desktop_products_view'); vi.restoreAllMocks(); });
it('offers list and grid, preserves actions, and opens product history from a card', async () => {
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/products'] }, createElement(Routes, null, createElement(Route, { path: '/products', element: createElement(Products) }), createElement(Route, { path: '/products/:id/historique', element: createElement('p', null, 'Product destination') })) )));
  expect(host.querySelector('.product-list-open')?.getAttribute('href')).toBe('/products/4/historique');
  expect([...host.querySelectorAll('button')].some(b => b.textContent === 'Historique')).toBe(false);
  const rowDelete = host.querySelector<HTMLElement>('.product-table-row [role="button"]')!;
  await act(async () => rowDelete.click());
  expect(host.querySelector('.product-table-row')).not.toBeNull();
  await act(async () => rowDelete.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Affichage en grille"]')!.click());
  expect(host.querySelector('.desktop-product-card img')?.getAttribute('src')).toContain('/cdn/marbre.webp');
  expect(localStorage.getItem('atlas_desktop_products_view')).toBe('grid');
  expect(host.textContent).toContain('Ajuster'); expect(host.textContent).toContain('Modifier'); expect(host.textContent).toContain('Supprimer');
  const selection = host.querySelector<HTMLInputElement>('[aria-label="Sélectionner Marbre"]')!;
  await act(async () => selection.click()); expect(selection.checked).toBe(true);
  await act(async () => (host.querySelector('.desktop-product-card-link') as HTMLAnchorElement).click());
  expect(host.textContent).toContain('Product destination');
});
