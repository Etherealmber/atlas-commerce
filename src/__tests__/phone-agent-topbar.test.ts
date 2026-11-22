// @vitest-environment happy-dom
import { act, createElement, useCallback, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PhoneAgentMobile } from '../mobile/PhoneApp';
import { usePhoneTopBar } from '../mobile/usePhoneTopBar';
import { api } from '../api';

let host: HTMLDivElement; let root: Root;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); localStorage.clear(); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); vi.restoreAllMocks(); });

it('sends and resets a local Agent conversation without inventing extra controls', async () => {
  const chat = vi.spyOn(api, 'assistChat').mockResolvedValue({ data: { reply: 'Stock disponible' } } as any);
  await act(async () => root.render(createElement(PhoneAgentMobile)));
  expect(host.querySelector('[aria-label="Questions suggérées"]')).not.toBeNull();
  expect(host.textContent).toContain('fournisseur IA configuré');
  const input = host.querySelector<HTMLTextAreaElement>('.ph-agent-input')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Quel stock ?'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(chat).toHaveBeenCalledWith('Quel stock ?', expect.objectContaining({ task: 'mobile_field' }));
  expect(host.textContent).toContain('Stock disponible'); expect(host.textContent).toContain('Vous');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Nouvelle discussion"]')!.click());
  expect(host.textContent).not.toContain('Stock disponible'); expect(host.textContent).toContain('Quels articles sont en rupture');
});

it('collapses on downward nested scroll, expands on upward scroll or tap, and resets on route change', async () => {
  const onCollapse = vi.fn();
  function View({ path }: { path: string }) {
    const close = useCallback(() => onCollapse(), []);
    const [collapsed, setCollapsed] = usePhoneTopBar(path, close);
    return createElement('div', null, createElement('button', { onClick: () => setCollapsed(false) }, collapsed ? 'compact' : 'expanded'), createElement('div', { className: 'scroll-area' }));
  }
  const render = async (path: string) => act(async () => root.render(createElement(View, { path })));
  await render('/m/agent');
  const area = host.querySelector<HTMLDivElement>('.scroll-area')!;
  await act(async () => { area.scrollTop = 15; area.dispatchEvent(new Event('scroll')); });
  expect(host.querySelector('button')?.textContent).toBe('compact'); expect(onCollapse).toHaveBeenCalled();
  await act(async () => { area.scrollTop = 0; area.dispatchEvent(new Event('scroll')); });
  expect(host.querySelector('button')?.textContent).toBe('expanded');
  await act(async () => { area.scrollTop = 20; area.dispatchEvent(new Event('scroll')); });
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
  await act(async () => host.querySelector('button')!.click()); expect(host.querySelector('button')?.textContent).toBe('expanded');
  await act(async () => { area.scrollTop = 35; area.dispatchEvent(new Event('scroll')); });
  expect(host.querySelector('button')?.textContent).toBe('expanded');
  now.mockReturnValue(1500);
  await act(async () => { area.scrollTop = 50; area.dispatchEvent(new Event('scroll')); });
  expect(host.querySelector('button')?.textContent).toBe('compact');
  await render('/m/products/7/historique'); expect(host.querySelector('button')?.textContent).toBe('expanded');
  await act(async () => { area.scrollTop = 60; area.dispatchEvent(new Event('scroll')); });
  expect(host.querySelector('button')?.textContent).toBe('expanded');
});

it('ignores scrolls within floating menus and dialogs', async () => {
  const onCollapse = vi.fn();
  function View() { const [collapsed] = usePhoneTopBar('/m', onCollapse); return createElement('div', null, createElement('span', null, collapsed ? 'compact' : 'expanded'), createElement('header', { className: 'phone-topbar' }, createElement('div', { className: 'menu' })), createElement('div', { role: 'dialog' }, createElement('div', { className: 'dialog-scroll' }))); }
  await act(async () => root.render(createElement(View)));
  for (const selector of ['.menu', '.dialog-scroll']) { const area = host.querySelector<HTMLDivElement>(selector)!; await act(async () => { area.scrollTop = 50; area.dispatchEvent(new Event('scroll')); }); }
  expect(host.querySelector('span')?.textContent).toBe('expanded'); expect(onCollapse).not.toHaveBeenCalled();
});

it('keeps local conversations separate per account and ignores the old shared cache', async () => {
  localStorage.setItem('atlas-agent-mobile-msgs', JSON.stringify([{ role: 'assistant', text: 'Ancien compte privé' }]));
  localStorage.setItem('stock_auth_user', 'alice');
  await act(async () => root.render(createElement(PhoneAgentMobile)));
  expect(host.textContent).not.toContain('Ancien compte privé');
  const chat = vi.spyOn(api, 'assistChat').mockResolvedValue({ data: { reply: 'Réponse Alice' } } as any);
  const input = host.querySelector<HTMLTextAreaElement>('.ph-agent-input')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Bonjour'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(chat).toHaveBeenCalledOnce(); expect(host.textContent).toContain('Réponse Alice');
  await act(async () => root.render(null)); localStorage.setItem('stock_auth_user', 'bob');
  await act(async () => root.render(createElement(PhoneAgentMobile)));
  expect(host.textContent).not.toContain('Réponse Alice'); expect(host.textContent).not.toContain('Ancien compte privé');
  await act(async () => root.render(null)); localStorage.setItem('stock_auth_user', 'alice');
  await act(async () => root.render(createElement(PhoneAgentMobile)));
  expect(host.textContent).toContain('Réponse Alice');
});

it('uses one server thread per conversation and starts a fresh one on reset', async () => {
  localStorage.setItem('stock_auth_user', 'agent-user');
  const chat = vi.spyOn(api, 'assistChat').mockResolvedValue({ data: { reply: 'Réponse' } } as any);
  await act(async () => root.render(createElement(PhoneAgentMobile)));
  const send = async (text: string) => {
    const field = host.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, text); field.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  };
  await send('Un'); await send('Deux');
  const first = chat.mock.calls[0][1]?.thread_id;
  expect(first).toMatch(/^mobile-/); expect(chat.mock.calls[1][1]?.thread_id).toBe(first);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Nouvelle discussion"]')!.click());
  await send('Trois'); expect(chat.mock.calls[2][1]?.thread_id).not.toBe(first);
});

it('shows working Android-style shortcuts and sends suggested prompts', async () => {
  const onTheme = vi.fn(); const onNavigate = vi.fn();
  const chat = vi.spyOn(api, 'assistChat').mockResolvedValue({ data: { reply: 'Aucun article' } } as any);
  await act(async () => root.render(createElement(PhoneAgentMobile as ComponentType<{ onTheme: typeof onTheme; onNavigate: typeof onNavigate }>, { onTheme, onNavigate })));
  const button = (text: string) => [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!;
  await act(async () => button('Thème sombre').click()); expect(onTheme).toHaveBeenCalledWith('dark');
  await act(async () => button('Scanner').click()); expect(onNavigate).toHaveBeenCalledWith('/m/scan');
  await act(async () => button('Quels articles sont en rupture ou à réapprovisionner ?').click());
  expect(chat).toHaveBeenCalledWith('Quels articles sont en rupture ou à réapprovisionner ?', expect.objectContaining({ task: 'mobile_field' }));
  expect(host.textContent).toContain('Aucun article'); expect(host.textContent).not.toContain('Thème sombre');
});

it('does not collapse the floating bar for automatic chat scrolling', async () => {
  const onCollapse = vi.fn();
  function View() { const [collapsed] = usePhoneTopBar('/m/agent', onCollapse); return createElement('div', null, createElement('span', null, collapsed ? 'compact' : 'expanded'), createElement('div', { className: 'messages' })); }
  await act(async () => root.render(createElement(View)));
  const area = host.querySelector<HTMLDivElement>('.messages')!;
  await act(async () => { area.dataset.phoneProgrammaticScroll = 'true'; area.scrollTop = 200; area.dispatchEvent(new Event('scroll')); });
  expect(host.querySelector('span')?.textContent).toBe('expanded');
  await act(async () => { delete area.dataset.phoneProgrammaticScroll; area.scrollTop = 215; area.dispatchEvent(new Event('scroll')); });
  expect(host.querySelector('span')?.textContent).toBe('compact');
});

it('keeps the composer above the visual viewport keyboard and cleans up listeners', async () => {
  const listeners: Record<string, () => void> = {};
  const viewport = { height: 500, offsetTop: 0, addEventListener: vi.fn((type: string, fn: () => void) => { listeners[type] = fn; }), removeEventListener: vi.fn() };
  const previous = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
  try {
    await act(async () => root.render(createElement(PhoneAgentMobile)));
    const shell = host.querySelector<HTMLElement>('.ph-agent-shell')!;
    expect(shell.style.getPropertyValue('--ph-agent-keyboard-inset')).toBe(`${Math.max(0, window.innerHeight - 500)}px`);
    viewport.height = window.innerHeight; await act(async () => listeners.resize());
    expect(shell.style.getPropertyValue('--ph-agent-keyboard-inset')).toBe('0px');
    await act(async () => root.render(null)); expect(viewport.removeEventListener).toHaveBeenCalledTimes(2);
  } finally { if (previous) Object.defineProperty(window, 'visualViewport', previous); else Reflect.deleteProperty(window, 'visualViewport'); }
});
