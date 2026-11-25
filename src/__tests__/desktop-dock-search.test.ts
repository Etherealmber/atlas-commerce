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
  localStorage.setItem('atlas-whats-new-modal-seen', '0.9.3');
  localStorage.setItem('atlas-whats-new-seen', '0.9.3');
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
    // Compact dock hides (but keeps mounted) its controls so open dialogs survive.
    expect(dock.querySelector<HTMLElement>('.ac-topbar-right')?.hidden).toBe(true);
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

    // Top-right page actions: hovering or keyboard-focusing the compact bar keeps it compact —
    // only the hovered/focused button widens (CSS). Tapping the bar background still pins it open.
    const actionsSlot = host.querySelector<HTMLElement>('#desktop-catalog-actions')!;
    expect(actionsSlot.classList.contains('desktop-catalog-actions-slot--compact')).toBe(true);
    await act(async () => actionsSlot.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' })));
    expect(actionsSlot.classList.contains('desktop-catalog-actions-slot--compact')).toBe(true);
    await act(async () => actionsSlot.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' })));
    expect(actionsSlot.classList.contains('desktop-catalog-actions-slot--compact')).toBe(true);
    await act(async () => actionsSlot.dispatchEvent(new FocusEvent('focusin', { bubbles: true })));
    expect(actionsSlot.classList.contains('desktop-catalog-actions-slot--compact')).toBe(true);
    await act(async () => actionsSlot.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body })));
    expect(actionsSlot.classList.contains('desktop-catalog-actions-slot--compact')).toBe(true);
    await act(async () => actionsSlot.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' })));
    await act(async () => actionsSlot.click());
    await act(async () => actionsSlot.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' })));
    expect(actionsSlot.classList.contains('desktop-catalog-actions-slot--compact')).toBe(false);

    // Clicking a child action button via mouse and moving the cursor outside still re-minimizes actionsSlot.
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 460 });
    clock.mockReturnValue(now + 3000);
    await act(async () => window.dispatchEvent(new Event('scroll')));
    expect(actionsSlot.classList.contains('desktop-catalog-actions-slot--compact')).toBe(true);
    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.textContent = 'Actualiser';
    actionsSlot.appendChild(actionBtn);
    await act(async () => actionsSlot.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' })));
    expect(actionsSlot.classList.contains('desktop-catalog-actions-slot--compact')).toBe(true);
    await act(async () => {
      actionBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
      actionBtn.focus();
      actionBtn.click();
    });
    await act(async () => document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerType: 'mouse' })));
    expect(actionsSlot.classList.contains('desktop-catalog-actions-slot--compact')).toBe(true);
    actionBtn.remove();

    clock.mockRestore();
    await act(async () => host.querySelector<HTMLAnchorElement>('aside.sidebar a[href="/products"]')!.click());
    expect(host.querySelector('.ac-desktop-dock')?.classList.contains('ac-topbar--compact')).toBe(false);
    expect(host.querySelector('.ac-dock-expand')?.textContent?.trim()).toBe('Produits & stock');
    await act(async () => host.querySelector<HTMLAnchorElement>('aside.sidebar a[href="/quotes"]')!.click());
    expect(host.querySelector('.ac-dock-expand')?.textContent?.trim()).toBe('Devis');
    await act(async () => { window.history.pushState({}, '', '/products/7/historique'); window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(host.querySelector('.ac-dock-expand')?.textContent?.trim()).toBe('Historique du produit');
    // The floating dock carries no back arrow; a detail page gets its own back pill
    // (expanded at the top), and the « Tableau de bord » pill only lives on focus pages.
    expect(host.querySelector('header.ac-desktop-dock a[aria-label^="Retour"]')).toBeNull();
    expect(host.querySelector('.ac-desktop-top-row > a.ac-home-pill:not(.ac-back-pill)')).toBeNull();
    const back = host.querySelector<HTMLAnchorElement>('.ac-desktop-top-row > a.ac-back-pill');
    expect(back?.getAttribute('href')).toBe('/products');
    expect(back?.getAttribute('aria-label')).toBe('Retour : Produits');
    expect(back?.classList.contains('is-expanded')).toBe(true);
    expect(back?.querySelector('.ac-home-pill-label')?.textContent).toBe('Produits');
    await act(async () => back!.click()); // opened directly (no in-app history) → the list
    expect(host.querySelector('.ac-dock-expand')?.textContent?.trim()).toBe('Produits & stock');
    expect(host.querySelector('.ac-desktop-top-row > a.ac-home-pill')).toBeNull();
    await act(async () => host.querySelector<HTMLAnchorElement>('a[href="/settings"]')!.click());
    // Settings is a lazy chunk: the navigation commits once it has loaded.
    for (let i = 0; i < 60 && !host.querySelector('.layout--focus'); i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    }
    const home = host.querySelector<HTMLAnchorElement>('.ac-desktop-top-row > a.ac-home-pill');
    expect(home?.getAttribute('href')).toBe('/dashboard');
    expect(home?.getAttribute('aria-label')).toBe('Retour au tableau de bord');
    expect(home?.querySelector('svg')).not.toBeNull();
    expect(home?.querySelector('.ac-home-pill-label')?.textContent).toBe('Tableau de bord');
    await act(async () => home!.click());
    expect(host.querySelector('.ac-dock-expand')?.textContent?.trim()).toBe('Tableau de bord');
    expect(host.querySelector('.ac-desktop-top-row > a.ac-home-pill')).toBeNull();
  } finally {
    if (originalScroll) Object.defineProperty(window, 'scrollY', originalScroll);
    else Reflect.deleteProperty(window, 'scrollY');
  }
});
