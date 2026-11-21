// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PhoneProduits } from '../mobile/PhoneApp';
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; localStorage.setItem('stock_role', 'owner'); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.removeItem('stock_role'); localStorage.removeItem('atlas_phone_products_view'); });
it('shows images in list and grid and links each product to its history', async () => {
  const products = [{ id: 4, name: 'Marbre', sku: 'M-4', stock_quantity: 4, track_inventory: 1, price: 25, image_url: '/cdn/marbre.webp' }];
  await act(async () => root.render(createElement(MemoryRouter, { children: createElement(PhoneProduits, { products, actions: [], onRefresh: vi.fn(), onToast: vi.fn() }) })));
  expect(host.querySelector('img')?.getAttribute('src')).toContain('/cdn/marbre.webp');
  expect(host.querySelector('.ph-catalog-product')?.getAttribute('href')).toBe('/m/products/4/historique');
  expect(host.querySelector('.ph-catalog-actions [aria-label="Affichage en grille"]')).not.toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Affichage en grille"]')!.click());
  expect(host.querySelector('.ph-catalog-list.is-grid')).not.toBeNull();
  expect(host.querySelector('[aria-label="Affichage en grille"]')?.getAttribute('aria-pressed')).toBe('true');
  expect(localStorage.getItem('atlas_phone_products_view')).toBe('grid');
});
it('shows a skeleton on first load and keeps the catalog on refresh failure', async () => {
  const refresh = vi.fn(); const products = [{ id: 4, name: 'Marbre', sku: 'M-4', stock_quantity: 4, track_inventory: 1 }];
  const render = async (overrides: Record<string, unknown>) => act(async () => root.render(createElement(MemoryRouter, { children: createElement(PhoneProduits, { products, actions: [], onRefresh: refresh, onToast: vi.fn(), ...overrides }) })));
  await render({ products: [], loading: true, ready: false });
  expect(host.querySelector('[aria-label="Chargement du catalogue"]')).not.toBeNull(); expect(host.textContent).not.toContain('Aucun produit');
  await render({ loading: true, ready: true }); expect(host.textContent).toContain('Actualisation du catalogue'); expect(host.textContent).toContain('Marbre');
  await render({ loading: false, ready: true, error: true }); expect(host.textContent).toContain('Les dernières données restent affichées'); expect(host.textContent).toContain('Marbre');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Actualiser le catalogue"]')!.click()); expect(refresh).toHaveBeenCalledWith('products');
  await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent?.includes('À valider'))!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Actualiser le catalogue"]')!.click()); expect(refresh).toHaveBeenLastCalledWith('actions');
});
