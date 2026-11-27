// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import TypeaheadField from '../components/TypeaheadField';

afterEach(() => { document.body.innerHTML = ''; document.documentElement.dir = ''; vi.restoreAllMocks(); });

it('opens outside clipped scroll containers, flips above, and selects an item', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
  document.documentElement.dir = 'rtl';
  const host = document.createElement('div'); host.style.overflow = 'auto'; document.body.appendChild(host);
  const root = createRoot(host); const onPick = vi.fn();
  try {
    await act(async () => root.render(createElement(TypeaheadField, { value: '', onChange: vi.fn(), onPick, options: [{ id: 1, label: 'Product' }] })));
    const anchor = host.querySelector('.atlas-typeahead')!;
    vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue({ x: 320, y: 540, left: 320, top: 540, right: 390, bottom: 580, width: 70, height: 40, toJSON() {} });
    await act(async () => host.querySelector('input')!.focus());
    const menu = document.querySelector<HTMLElement>('.atlas-typeahead-portal')!;
    expect(menu.parentElement).toBe(document.body);
    expect(host.contains(menu)).toBe(false);
    expect(menu.getAttribute('dir')).toBe('rtl');
    expect(menu.style.position).toBe('fixed');
    expect(parseFloat(menu.style.top)).toBeLessThan(540);
    expect(parseFloat(menu.style.left) + parseFloat(menu.style.width)).toBeLessThanOrEqual(400);
    expect(host.querySelector('input')!.getAttribute('aria-controls')).toBe(menu.id);
    await act(async () => menu.querySelector<HTMLButtonElement>('[role="option"]')!.click());
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    expect(document.querySelector('.atlas-typeahead-portal')).toBeNull();
    await act(async () => host.querySelector('input')!.click());
    expect(document.querySelector('.atlas-typeahead-portal')).not.toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it('closes on outside pointer, external scroll and Escape, without closing its parent dialog', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.appendChild(host);
  const root = createRoot(host); const parentKey = vi.fn(); document.addEventListener('keydown', parentKey);
  try {
    await act(async () => root.render(createElement(TypeaheadField, { value: '', onChange: vi.fn(), onPick: vi.fn(), options: [{ id: 1, label: 'Product' }] })));
    const input = host.querySelector('input')!;
    await act(async () => input.focus());
    const menu = document.querySelector<HTMLElement>('.atlas-typeahead-portal')!;
    await act(async () => menu.dispatchEvent(new Event('scroll', { bubbles: true })));
    expect(document.querySelector('.atlas-typeahead-portal')).not.toBeNull();
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('.atlas-typeahead-portal')).toBeNull(); expect(parentKey).not.toHaveBeenCalled();
    await act(async () => { input.blur(); input.focus(); });
    await act(async () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(document.querySelector('.atlas-typeahead-portal')).toBeNull();
  } finally { await act(async () => root.unmount()); host.remove(); document.removeEventListener('keydown', parentKey); }
});
