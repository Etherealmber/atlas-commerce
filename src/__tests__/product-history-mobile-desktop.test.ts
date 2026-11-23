// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProductHistory from '../pages/ProductHistory';
import ProductArtwork, { productImageUrl } from '../components/ProductArtwork';
import { api } from '../api';
import { phoneBackTarget, showPhoneDock } from '../mobile/PhoneDock';

const identity = vi.hoisted(() => ({ sell: true }));
vi.mock('../auth', () => ({ canSell: () => identity.sell, getToken: () => 'token', clearToken: vi.fn() }));
let root: Root; let host: HTMLDivElement;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; identity.sell = true; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const product = { id: 7, name: 'Marbre', sku: 'MAR-7', image_url: '/cdn/stone.webp', stock_quantity: 8, unit: 'm²', track_inventory: 1, price: 50, created_by: 'alice', approved_by: null };
const movements = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, type: 'in', quantity: 3, previous_quantity: 5, new_quantity: 8, created_at: '2026-10-20T09:30:00', created_by: 'bob' }));
async function renderHistory(mobile = false) {
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: [mobile ? '/m/products/7/historique' : '/products/7/historique'] }, createElement(Routes, null, createElement(Route, { path: mobile ? '/m/products/:id/historique' : '/products/:id/historique', element: createElement(ProductHistory, { mobile }) })))));
}
describe('product artwork', () => {
  it('resolves API-relative image paths and rejects unsafe references', () => {
    expect(productImageUrl('/cdn/p.webp', 'https://api.example')).toBe('https://api.example/cdn/p.webp');
    expect(productImageUrl('//evil.example/image.png', '')).toBe('');
    expect(productImageUrl('javascript:alert(1)', '')).toBe('');
    expect(productImageUrl('https://user:pass@example.com/x', '')).toBe('');
  });
  it('loads oversized legacy images only when their card enters the viewport', async () => {
    let show!: () => void;
    vi.stubGlobal('IntersectionObserver', class { constructor(callback: IntersectionObserverCallback) { show = () => callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); } observe() {} disconnect() {} });
    const get = vi.spyOn(api, 'getProduct').mockResolvedValue({ data: { image_url: 'data:image/png;base64,AAAA' } });
    await act(async () => root.render(createElement(ProductArtwork, { largeImageProductId: 7 })));
    expect(get).not.toHaveBeenCalled();
    await act(async () => show());
    expect(get).toHaveBeenCalledWith(7); expect(host.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
  });
  it('shows a fallback if an image fails', async () => {
    await act(async () => root.render(createElement(ProductArtwork, { url: '/cdn/p.webp' })));
    const image = host.querySelector('img')!; expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
    await act(async () => image.dispatchEvent(new Event('error')));
    expect(host.querySelector('img')).toBeNull(); expect(host.querySelector('svg')).not.toBeNull();
  });
});
describe('product history', () => {
  it('shows real product data and pages through full movement history', async () => {
    vi.spyOn(api, 'getProduct').mockResolvedValue({ data: product });
    const getMovements = vi.spyOn(api, 'getProductMovements').mockResolvedValueOnce({ data: movements }).mockResolvedValueOnce({ data: [{ id: 999, type: 'sale', quantity: 1, previous_quantity: 8, new_quantity: 7 }] });
    await renderHistory();
    expect(host.textContent).toContain('Historique du produit'); expect(host.textContent).toContain('Marbre'); expect(host.textContent).toContain('Créé par alice'); expect(host.textContent).toContain('Qté 3 · 5 → 8');
    expect(host.querySelector('img')?.getAttribute('src')).toContain('/cdn/stone.webp');
    expect(host.querySelector('.product-history-top')).toBeNull();
    expect(host.querySelector('h1')?.classList.contains('sr-only')).toBe(true);
    expect(host.querySelector('[aria-label="Modifier la photo du produit"] svg')).not.toBeNull();
    expect(host.querySelector('[aria-label="Actualiser l’historique"] svg')).not.toBeNull();
    expect(host.textContent).toContain('Ajuster le stock'); expect(host.textContent).toContain('Modifier les détails');
    expect(host.querySelector('.product-history-action-stock svg')).not.toBeNull();
    expect(host.querySelector('.product-history-action-edit svg')).not.toBeNull();
    expect(host.textContent).not.toContain('Approuvé par');
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Charger la suite')!.click());
    expect(getMovements).toHaveBeenLastCalledWith(7, 40, { full: true, offset: 40 }); expect(host.textContent).toContain('Vente'); expect(host.textContent).not.toContain('Charger la suite');
  });
  it('refreshes movements without refetching or clearing the product', async () => {
    const getProduct = vi.spyOn(api, 'getProduct').mockResolvedValue({ data: product });
    const getMovements = vi.spyOn(api, 'getProductMovements').mockResolvedValueOnce({ data: movements }).mockResolvedValueOnce({ data: [] });
    await renderHistory(true);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Actualiser l’historique"]')!.click());
    expect(getProduct).toHaveBeenCalledTimes(1); expect(getMovements).toHaveBeenCalledTimes(2); expect(host.textContent).toContain('Marbre'); expect(host.textContent).toContain('Aucun mouvement enregistré');
  });
  it('keeps prices and image editing hidden for stock roles', async () => {
    identity.sell = false; vi.spyOn(api, 'getProduct').mockResolvedValue({ data: product }); vi.spyOn(api, 'getProductMovements').mockResolvedValue({ data: [] });
    await renderHistory(true);
    expect(host.textContent).not.toContain('50,00 MAD'); expect(host.querySelector('[aria-label="Modifier la photo du produit"]')).toBeNull();
    expect(showPhoneDock('/m/products/7/historique')).toBe(false); expect(phoneBackTarget('/m/products/7/historique')).toBe('/m/products');
  });
  it('updates the primary photo through the authenticated product-image API', async () => {
    vi.spyOn(api, 'getProduct').mockResolvedValue({ data: product }); vi.spyOn(api, 'getProductMovements').mockResolvedValue({ data: [] });
    const upload = vi.spyOn(api, 'addProductImage').mockResolvedValue({ data: { url: '/cdn/new.webp' } } as any);
    await renderHistory(true);
    const input = host.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['image data'], 'photo.png', { type: 'image/png' })] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(upload).toHaveBeenCalledWith(7, expect.objectContaining({ is_primary: true, alt_text: 'Marbre' }));
    expect(host.textContent).toContain('Photo du produit mise à jour'); expect(host.querySelector('img')?.getAttribute('src')).toContain('/cdn/new.webp');
  });
  it('reports history errors instead of claiming there are no movements', async () => {
    vi.spyOn(api, 'getProduct').mockResolvedValue({ data: product }); vi.spyOn(api, 'getProductMovements').mockRejectedValue(new Error('offline'));
    await renderHistory(true); expect(host.textContent).toContain('Impossible de charger les mouvements'); expect(host.textContent).not.toContain('Aucun mouvement enregistré');
  });
});
it.each([false, true])('shows derived carton and square-metre stock on product detail (mobile=%s)', async mobile => {
  vi.spyOn(api, 'getProduct').mockResolvedValue({ data: { ...product, unit:'carton', stock_quantity:6, secondary_unit:'m²', secondary_unit_factor:1.59 } });
  vi.spyOn(api, 'getProductMovements').mockResolvedValue({ data: [] });
  await renderHistory(mobile);
  expect(host.textContent).toContain('6 carton · 9,54 m²');
});

it('adjusts stock and edits product details in-place using FormWizard without navigating away', async () => {
  const getProduct = vi.spyOn(api, 'getProduct').mockResolvedValue({ data: product });
  vi.spyOn(api, 'getProductMovements').mockResolvedValue({ data: [] });
  vi.spyOn(api, 'getCategories').mockResolvedValue({ data: [{ name: 'Pierre' }] } as any);
  vi.spyOn(api, 'getUnits').mockResolvedValue({ data: [{ name: 'm²' }] } as any);
  const adjustStock = vi.spyOn(api, 'adjustStock').mockResolvedValue({ data: { stock_quantity: 12 } } as any);
  const updateProduct = vi.spyOn(api, 'updateProduct').mockResolvedValue({ data: { ...product, name: 'Marbre poli' } } as any);

  await renderHistory(false);
  const stockBtn = host.querySelector<HTMLButtonElement>('.product-history-action-stock')!;
  await act(async () => stockBtn.click());
  expect(document.body.textContent).toContain('Ajuster le stock — Marbre');
  expect(document.body.querySelector('.step-wizard__progress')).not.toBeNull();
  const nextAdjust = [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Continuer')!;
  await act(async () => nextAdjust.click());
  const adjustSubmit = [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Enregistrer')!;
  await act(async () => adjustSubmit.click());
  expect(adjustStock).toHaveBeenCalledWith(7, expect.objectContaining({ type: 'in', quantity: 1 }));

  const editBtn = host.querySelector<HTMLButtonElement>('.product-history-action-edit')!;
  await act(async () => editBtn.click());
  expect(document.body.textContent).toContain('Modifier les détails — Marbre');
  expect(document.body.querySelectorAll('.step-wizard__progress li')).toHaveLength(3);
  await act(async () => [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Continuer')!.click());
  await act(async () => [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Continuer')!.click());
  const saveBtn = [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Enregistrer les modifications')!;
  await act(async () => saveBtn.click());
  expect(updateProduct).toHaveBeenCalledWith(7, expect.objectContaining({ name: 'Marbre', sku: 'MAR-7' }));
  expect(getProduct).toHaveBeenCalledTimes(3);
});
