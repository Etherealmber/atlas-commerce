// @vitest-environment happy-dom
import { act, createElement, useCallback } from 'react';
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
  expect(host.textContent).toContain('Assistant Atlas'); expect(host.querySelector('.ph-mascot svg')).not.toBeNull();
  expect(host.textContent).toContain('fournisseur IA configuré');
  const input = host.querySelector<HTMLTextAreaElement>('.ph-agent-input')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Quel stock ?'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(chat).toHaveBeenCalledWith('Quel stock ?', expect.objectContaining({ task: 'mobile_field' }));
  expect(host.textContent).toContain('Stock disponible'); expect(host.textContent).toContain('Vous');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Nouvelle discussion"]')!.click());
  expect(host.textContent).not.toContain('Stock disponible'); expect(host.textContent).toContain('Bonjour, comment puis-je vous aider');
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
  await act(async () => host.querySelector('button')!.click()); expect(host.querySelector('button')?.textContent).toBe('expanded');
  await act(async () => { area.scrollTop = 35; area.dispatchEvent(new Event('scroll')); });
  await render('/m/products/7/historique'); expect(host.querySelector('button')?.textContent).toBe('expanded');
  await act(async () => { area.scrollTop = 60; area.dispatchEvent(new Event('scroll')); });
  expect(host.querySelector('button')?.textContent).toBe('expanded');
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
