// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PhoneProductCreate from '../mobile/PhoneProductCreate';
import { api } from '../api';
let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); localStorage.setItem('stock_role', 'owner'); vi.spyOn(api, 'getUnits').mockResolvedValue({ data: [] }); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.removeItem('stock_role'); vi.restoreAllMocks(); });
async function render(done = vi.fn()) { await act(async () => root.render(createElement(PhoneProductCreate, { onClose: vi.fn(), onCreated: done }))); return done; }
function form() { return document.querySelector<HTMLFormElement>('.ph-create-form')!; }
function fill() { form().querySelector<HTMLInputElement>('[name="name"]')!.value = 'Marbre'; form().querySelector<HTMLInputElement>('[name="sku"]')!.value = 'MAR-1'; form().querySelector<HTMLInputElement>('[name="quantity"]')!.value = '4'; }
async function submit() { await act(async () => form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
it('creates a catalog product for owner/admin', async () => {
  const create = vi.spyOn(api, 'createProduct').mockResolvedValue({ data: { id: 1 } }); const request = vi.spyOn(api, 'createMobileAction');
  const done = await render(); fill(); await submit();
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Marbre', sku: 'MAR-1', stock_quantity: 4 })); expect(request).not.toHaveBeenCalled(); expect(done).toHaveBeenCalledWith(true);
});
it.each(['stock', 'secretaire', 'user'])('sends an approval request rather than a direct write for %s', async (role) => {
  localStorage.setItem('stock_role', role); const create = vi.spyOn(api, 'createProduct'); const request = vi.spyOn(api, 'createMobileAction').mockResolvedValue({ data: {} } as any);
  const done = await render(); fill(); expect(form().querySelector('[name="price"]')).toBeNull(); await submit();
  expect(form().querySelector('[name="barcode"]')).toBeNull(); expect(form().querySelector('[name="category"]')).toBeNull(); expect(form().querySelector('[name="invoice_price_mode"]')).toBeNull();
  expect(create).not.toHaveBeenCalled(); expect(request).toHaveBeenCalledWith(expect.objectContaining({ type: 'new_product', source: 'web', meta: expect.objectContaining({ needs_approval: true, create_product_body: expect.objectContaining({ name: 'Marbre', stock_quantity: 4 }) }) })); expect((request.mock.calls[0]?.[0] as any)?.meta?.create_product_body).not.toHaveProperty('price'); expect(done).toHaveBeenCalledWith(false);
});
it('keeps the entered data and displays server failures without reporting success', async () => {
  vi.spyOn(api, 'createProduct').mockRejectedValue(new Error('Produit en doublon')); const done = await render(); fill(); await submit();
  expect(form().textContent).toContain('Produit en doublon'); expect(form().querySelector<HTMLInputElement>('[name="name"]')?.value).toBe('Marbre'); expect(done).not.toHaveBeenCalled();
});
it('rejects unsupported photo files before sending a write', async () => {
  const create = vi.spyOn(api, 'createProduct'); await render(); fill();
  const input = form().querySelector<HTMLInputElement>('[name="photo"]')!;
  const dt = new DataTransfer(); dt.items.add(new File(['bad'], 'bad.txt', { type: 'text/plain' })); input.files = dt.files;
  await submit(); expect(form().textContent).toContain('Choisissez une image'); expect(create).not.toHaveBeenCalled();
});
it('includes a selected photo in a direct product write', async () => {
  const create = vi.spyOn(api, 'createProduct').mockResolvedValue({ data: { id: 1 } }); const done = await render(); fill();
  const input = form().querySelector<HTMLInputElement>('[name="photo"]')!;
  const dt = new DataTransfer(); dt.items.add(new File(['image'], 'photo.png', { type: 'image/png' })); input.files = dt.files;
  await act(async () => { form().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ image_url: expect.stringMatching(/^data:image\/png;base64,/) })); expect(done).toHaveBeenCalledWith(true);
});
it('includes an optional carton-to-area conversion in a price-free request', async () => {
  localStorage.setItem('stock_role', 'stock');
  const request = vi.spyOn(api, 'createMobileAction').mockResolvedValue({ data: {} } as any);
  await render(); fill();
  const unitSelect = form().querySelector<HTMLSelectElement>('[name="unit"]')!;
  const secondSelect = form().querySelector<HTMLSelectElement>('[name="secondary_unit"]')!;
  expect(unitSelect.tagName).toBe('SELECT');
  expect(secondSelect.tagName).toBe('SELECT');
  unitSelect.value = 'carton';
  secondSelect.value = 'm²';
  form().querySelector<HTMLInputElement>('[name="secondary_unit_factor"]')!.value = '1,59';
  await submit();
  const body = (request.mock.calls[0][0] as any).meta.create_product_body;
  expect(body).toMatchObject({ unit:'carton', secondary_unit:'m²', secondary_unit_factor:1.59, stock_quantity:4 });
  expect(body).not.toHaveProperty('price');
});
