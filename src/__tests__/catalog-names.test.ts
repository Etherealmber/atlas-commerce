// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import CatalogNames, { type CatalogNamesValue } from '../components/settings/CatalogNames';
import { api } from '../api';

it('keeps existing names when optional AI suggestions arrive and allows editing all three', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  const spy = vi.spyOn(api, 'assistChat').mockResolvedValue({ data: { reply: JSON.stringify({ fr: 'Carreau', en: 'Tile', ar: 'بلاط' }) } } as any);
  function Harness() {
    const [names, setNames] = useState<CatalogNamesValue>({ fr: 'Carrelage', en: '', ar: '' });
    return createElement(CatalogNames, { kind: 'category', value: names, onChange: setNames, disabled: false });
  }
  try {
    await act(async () => root.render(createElement(Harness)));
    expect(host.querySelectorAll('input')).toHaveLength(3);
    await act(async () => { host.querySelector('button')!.click(); });
    expect(spy).toHaveBeenCalledWith(expect.any(String), { task: 'catalog_translation', silent: true });
    expect(host.querySelector<HTMLInputElement>('#category-name-fr')!.value).toBe('Carrelage');
    expect(host.querySelector<HTMLInputElement>('#category-name-en')!.value).toBe('Tile');
    expect(host.querySelector<HTMLInputElement>('#category-name-ar')!.value).toBe('بلاط');
  } finally { await act(async () => root.unmount()); host.remove(); spy.mockRestore(); }
});

it('keeps manual entry available and reports an optional suggestion failure in the dialog', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  const spy = vi.spyOn(api, 'assistChat').mockRejectedValue(new Error('upstream'));
  function Harness() {
    const [names, setNames] = useState<CatalogNamesValue>({ fr: 'Informatique', en: '', ar: '' });
    return createElement(CatalogNames, { kind: 'category', value: names, onChange: setNames, disabled: false });
  }
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => host.querySelector('button')!.click());
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Suggestion indisponible');
    expect(host.querySelector<HTMLInputElement>('#category-name-en')!.disabled).toBe(false);
    expect(host.querySelector<HTMLInputElement>('#category-name-fr')!.value).toBe('Informatique');
  } finally { await act(async () => root.unmount()); host.remove(); spy.mockRestore(); }
});
