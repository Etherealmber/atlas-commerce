// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDialogsProvider } from '../components/AppDialogs';
import Products from '../pages/Products';
import { api } from '../api';

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  localStorage.setItem('atlas_token', 'test');
  localStorage.setItem('atlas_role', 'owner');
  localStorage.setItem('atlas_username', 'owner');
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  vi.spyOn(api, 'getProducts').mockResolvedValue({ data: [] } as any);
  vi.spyOn(api, 'getStockLocations').mockResolvedValue({ data: [] } as any);
  vi.spyOn(api, 'getCategories').mockResolvedValue({ data: [{ id: 1, name: 'Carrelage' }] } as any);
  vi.spyOn(api, 'getUnits').mockResolvedValue({ data: [{ id: 1, name: 'm²', symbol: 'm²' }] } as any);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function openNewProductModal() {
  await act(async () => {
    root.render(
      createElement(MemoryRouter, null, createElement(AppDialogsProvider, null, createElement(Products))),
    );
  });
  await act(async () => { await Promise.resolve(); });
  const addBtn = [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('Ajouter un produit'),
  )!;
  await act(async () => { addBtn.click(); });
}

describe('Products AI description generation', () => {
  it('blocks generating a description when the product name is empty', async () => {
    const assistSpy = vi.spyOn(api, 'assistChat');
    await openNewProductModal();

    const dlg = document.querySelector('[role="dialog"]')!;
    const genBtn = [...dlg.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Générer la description (IA)'),
    ) as HTMLButtonElement;

    expect(genBtn).toBeTruthy();
    expect(genBtn.disabled).toBe(true);
    expect(dlg.textContent).toContain('Saisissez d’abord le nom du produit');

    await act(async () => { genBtn.click(); });
    expect(assistSpy).not.toHaveBeenCalled();
  });

  it('sends real structured product attributes and populates the description once a title is provided', async () => {
    const assistSpy = vi.spyOn(api, 'assistChat').mockResolvedValue({
      data: { reply: 'Carrelage beige en grès destiné au revêtement intérieur, vendu à l’unité.' },
    } as any);
    await openNewProductModal();

    const dlg = document.querySelector('[role="dialog"]')!;
    const nameInput = dlg.querySelector('input[placeholder*="Carrelage"]') as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    await act(async () => {
      setter.call(nameInput, 'Carrelage Grès Beige 60×60');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const genBtn = [...dlg.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Générer la description (IA)'),
    ) as HTMLButtonElement;
    expect(genBtn.disabled).toBe(false);

    await act(async () => { genBtn.click(); });
    expect(assistSpy).toHaveBeenCalledTimes(1);
    const [prompt, opts] = assistSpy.mock.calls[0];
    expect(prompt).toContain('Carrelage Grès Beige 60×60');
    expect(prompt).not.toContain('produit marbre');
    expect(opts).toMatchObject({
      task: 'description',
      thread_id: 'product-description',
      product: expect.objectContaining({
        name: 'Carrelage Grès Beige 60×60',
      }),
    });

    const textarea = dlg.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Carrelage beige en grès destiné au revêtement intérieur, vendu à l’unité.');
  });
});
