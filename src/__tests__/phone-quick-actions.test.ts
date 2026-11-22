// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import PhoneQuickActions from '../mobile/PhoneQuickActions';

let host: HTMLDivElement; let root: ReturnType<typeof createRoot>;
const navigate = vi.fn();
function View({ allowSell = true, pending = 101 }: { allowSell?: boolean; pending?: number }) {
  const [open, setOpen] = useState(false);
  return createElement(PhoneQuickActions, { open, setOpen, allowSell, pending, onNavigate: navigate });
}
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllMocks(); });
it('opens a non-blocking quick menu with a bounded badge and restores focus on Escape', async () => {
  await act(async () => root.render(createElement(View, {})));
  const trigger = host.querySelector<HTMLButtonElement>('.ph-quick-ball')!;
  expect(trigger.getAttribute('aria-label')).toContain('101 actions en attente'); expect(trigger.textContent).toContain('99+');
  await act(async () => trigger.click());
  expect(trigger.getAttribute('aria-expanded')).toBe('true'); expect(trigger.getAttribute('aria-controls')).toBe('phone-quick-menu');
  expect(host.textContent).toContain('Notifications'); expect(host.textContent).toContain('Vente'); expect(host.querySelector('.ph-menu-backdrop')).toBeNull();
  host.querySelector<HTMLButtonElement>('.ph-quick-item')!.focus();
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  expect(trigger.getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(trigger);
});
it('dismisses on outside pointer and gates the sales shortcut by role', async () => {
  await act(async () => root.render(createElement(View, { allowSell: false, pending: 0 })));
  const trigger = host.querySelector<HTMLButtonElement>('.ph-quick-ball')!;
  await act(async () => trigger.click()); expect(host.textContent).not.toContain('Vente');
  await act(async () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  await act(async () => trigger.click());
  await act(async () => host.querySelector<HTMLButtonElement>('.ph-quick-item')!.click());
  expect(navigate).toHaveBeenCalledWith('/m/inbox'); expect(trigger.getAttribute('aria-expanded')).toBe('false');
});
