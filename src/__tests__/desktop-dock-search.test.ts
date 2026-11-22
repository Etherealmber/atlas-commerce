// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import App from '../App';

vi.mock('../pages/Dashboard', () => ({ default: () => null }));
vi.mock('../pages/Products', () => ({ default: () => null }));
vi.mock('../pages/Quotes', () => ({ default: () => null }));
vi.mock('../pages/ProductHistory', () => ({ default: () => null }));
vi.mock('../components/AtlasAgent', () => ({ default: () => null }));
vi.mock('../components/WhatsNewModal', () => ({ default: () => null }));
vi.mock('../components/PageTransition', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); localStorage.clear(); vi.unstubAllGlobals(); });

it('does not show the removed search in the desktop dock while keeping its other controls', async () => {
  localStorage.setItem('stock_auth_token', 'test-token');
  localStorage.setItem('stock_role', 'owner');
  localStorage.setItem('stock_auth_user', 'test');
  localStorage.setItem('atlas_welcome_completed', 'true');
  localStorage.setItem('atlas-whats-new-modal-seen', '0.9.1');
  localStorage.setItem('atlas-whats-new-seen', '0.9.1');
  window.history.replaceState({}, '', '/dashboard?mode=pc');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: [] }), { headers: { 'Content-Type': 'application/json' } })));
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await Promise.all([import('../pages/Dashboard'), import('../pages/Products'), import('../pages/Quotes'), import('../pages/ProductHistory'), import('../components/AtlasAgent'), import('../components/WhatsNewModal')]);
  await act(async () => { root.render(createElement(App)); });
  const dock = host.querySelector<HTMLElement>('.ac-desktop-dock')!;
  expect(dock).not.toBeNull();
  expect(dock?.querySelector('[aria-label="Rechercher"]')).toBeNull();
  expect(dock?.querySelector('.ac-topbar-search-wrap')).toBeNull();
  expect(dock?.querySelector('[aria-label="Agrandir le menu"]')).toBeNull();
  expect(dock?.classList.contains('ac-topbar--compact')).toBe(false);
  expect(dock?.querySelector('[data-theme-toggle]')).not.toBeNull();
  expect(dock?.querySelector('[aria-label="Notifications"]')).not.toBeNull();
  await act(async () => dock.querySelector<HTMLButtonElement>('[aria-label="Notifications"]')!.click());
  expect(host.querySelector('.ac-notif-panel')).not.toBeNull();
  await act(async () => dock.querySelector<HTMLButtonElement>('[aria-label="Notifications"]')!.click());
  const originalScroll = Object.getOwnPropertyDescriptor(window, 'scrollY');
  try {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 200 });
    await act(async () => window.dispatchEvent(new Event('scroll')));
    expect(dock?.classList.contains('ac-topbar--compact')).toBe(true);
    const title = dock.querySelector<HTMLButtonElement>('.ac-dock-expand')!;
    expect(title.getAttribute('aria-expanded')).toBe('false');
    expect(dock.querySelector('.ac-topbar-right')).toBeNull();
    await act(async () => title.click());
    expect(title.getAttribute('aria-expanded')).toBe('true');
    expect(dock.querySelector('[aria-label="Notifications"]')).not.toBeNull();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 275 });
    await act(async () => window.dispatchEvent(new Event('scroll')));
    expect(dock.classList.contains('ac-topbar--compact')).toBe(false);
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 1000);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 350 });
    await act(async () => window.dispatchEvent(new Event('scroll')));
    expect(dock.classList.contains('ac-topbar--compact')).toBe(true);
    await act(async () => dock.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' })));
    expect(dock.classList.contains('ac-topbar--compact')).toBe(false);
    expect(dock.querySelector('[aria-label="Notifications"]')).not.toBeNull();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 450 });
    clock.mockReturnValue(now + 2000);
    await act(async () => window.dispatchEvent(new Event('scroll')));
    expect(dock.classList.contains('ac-topbar--compact')).toBe(false);
    await act(async () => dock.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' })));
    expect(dock.classList.contains('ac-topbar--compact')).toBe(true);

    // Hover then tap keeps the dock expanded even after pointer leaves.
    await act(async () => dock.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' })));
    expect(dock.classList.contains('ac-topbar--compact')).toBe(false);
    await act(async () => title.click());
    await act(async () => dock.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' })));
    expect(dock.classList.contains('ac-topbar--compact')).toBe(false);

    // Top-right page actions mirror the compact / hover / keyboard-focus / leave-unless-tapped lifecycle.
    const actionsSlot = host.querySelector<HTMLElement>('#desktop-catalog-actions')!;
    expect(actionsSlot.classList.contains('desktop-catalog-actions-slot--compact')).toBe(true);
    await act(async () => actionsSlot.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' })));
    expect(actionsSlot.classList.contains('desktop-catalog-actions-slot--compact')).toBe(false);
    await act(async () => actionsSlot.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' })));
    expect(actionsSlot.classList.contains('desktop-catalog-actions-slot--compact')).toBe(true);
    await act(async () => actionsSlot.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    expect(actionsSlot.classList.contains('desktop-catalog-actions-slot--compact')).toBe(false);
    await act(async () => actionsSlot.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body })));
    expect(actionsSlot.classList.contains('desktop-catalog-actions-slot--compact')).toBe(true);
    await act(async () => actionsSlot.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' })));
    await act(async () => actionsSlot.click());
    await act(async () => actionsSlot.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' })));
    expect(actionsSlot.classList.contains('desktop-catalog-actions-slot--compact')).toBe(false);

    clock.mockRestore();
    await act(async () => host.querySelector<HTMLAnchorElement>('aside.sidebar a[href="/products"]')!.click());
    expect(host.querySelector('.ac-desktop-dock')?.classList.contains('ac-topbar--compact')).toBe(false);
    expect(host.querySelector('.ac-dock-expand')?.textContent?.trim()).toBe('Produits & stock');
    await act(async () => host.querySelector<HTMLAnchorElement>('aside.sidebar a[href="/quotes"]')!.click());
    expect(host.querySelector('.ac-dock-expand')?.textContent?.trim()).toBe('Devis');
    await act(async () => { window.history.pushState({}, '', '/products/7/historique'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(host.querySelector('.ac-dock-expand')?.textContent?.trim()).toBe('Historique du produit');
    expect(host.querySelector('header a[aria-label="Retour aux produits"]')?.getAttribute('href')).toBe('/products');
    await act(async () => host.querySelector<HTMLAnchorElement>('header a[aria-label="Retour aux produits"]')!.click());
    expect(host.querySelector('.ac-dock-expand')?.textContent?.trim()).toBe('Produits & stock');
  } finally {
    if (originalScroll) Object.defineProperty(window, 'scrollY', originalScroll);
    else Reflect.deleteProperty(window, 'scrollY');
  }
});
