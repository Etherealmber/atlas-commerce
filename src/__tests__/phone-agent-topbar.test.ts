// @vitest-environment happy-dom
import { act, createElement, useCallback, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PhoneAgentMobile } from '../mobile/PhoneApp';
import { usePhoneTopBar } from '../mobile/usePhoneTopBar';
import { api } from '../api';
import * as exportTools from '../lib/agentConversationExport';

let host: HTMLDivElement; let root: Root;
beforeEach(() => { vi.spyOn(api, 'assistStatus').mockResolvedValue({ data: { configured: true } } as any); (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); localStorage.clear(); });
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

it('collapses the Agent dock to a title on deliberate scroll and expands on tap', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(10_000);
  await act(async () => root.render(createElement(PhoneAgentMobile)));
  const dock = host.querySelector<HTMLElement>('.ph-agent-dock')!;
  const messages = host.querySelector<HTMLDivElement>('.ph-agent-msgs')!;
  expect(dock.querySelector('[aria-label="Historique des discussions"]')).not.toBeNull();
  await act(async () => { messages.dataset.phoneProgrammaticScroll = 'true'; messages.scrollTop = 100; messages.dispatchEvent(new Event('scroll')); });
  expect(dock.classList.contains('is-collapsed')).toBe(false);
  await act(async () => { delete messages.dataset.phoneProgrammaticScroll; messages.scrollTop = 170; messages.dispatchEvent(new Event('scroll')); });
  const title = dock.querySelector<HTMLButtonElement>('.ph-agent-dock-expand')!;
  expect(title.textContent).toBe('Atlas Agent');
  expect(title.getAttribute('aria-expanded')).toBe('false');
  expect(dock.querySelector('[aria-label="Historique des discussions"]')).toBeNull();
  await act(async () => title.click());
  expect(dock.querySelector('[aria-label="Historique des discussions"]')).not.toBeNull();
  await act(async () => { messages.scrollTop = 250; messages.dispatchEvent(new Event('scroll')); });
  expect(dock.classList.contains('is-collapsed')).toBe(false);
  clock.mockReturnValue(10_500);
  await act(async () => { messages.scrollTop = 320; messages.dispatchEvent(new Event('scroll')); });
  expect(dock.classList.contains('is-collapsed')).toBe(true);
  await act(async () => { messages.scrollTop = 260; messages.dispatchEvent(new Event('scroll')); });
  expect(dock.classList.contains('is-collapsed')).toBe(false);
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

it('archives and restores conversations locally without overwriting other accounts', async () => {
  localStorage.setItem('stock_auth_user', 'alice');
  vi.spyOn(api, 'assistChat').mockResolvedValue({ data: { reply: 'Réponse privée' } } as any);
  await act(async () => root.render(createElement(PhoneAgentMobile)));
  await act(async () => host.querySelector<HTMLButtonElement>('.ph-agent-prompts button')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Nouvelle discussion"]')!.click());
  expect(host.textContent).not.toContain('Réponse privée');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Historique des discussions"]')!.click());
  expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Quels articles');
  await act(async () => document.body.querySelector<HTMLButtonElement>('.ph-agent-history-list button')!.click());
  expect(host.textContent).toContain('Réponse privée');
  await act(async () => root.render(null)); localStorage.setItem('stock_auth_user', 'bob');
  await act(async () => root.render(createElement(PhoneAgentMobile)));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Historique des discussions"]')!.click());
  expect(document.body.querySelector('[role="dialog"]')?.textContent).not.toContain('Quels articles');
});

it('refreshes real context endpoints and displays actual quota or failure', async () => {
  vi.spyOn(api, 'assistStatus').mockResolvedValue({ data: { configured: true } } as any);
  const quota = vi.spyOn(api, 'getAgentPolicy').mockResolvedValue({ data: { blocked: false, isAdmin: false, dailyUsed: 12, dailyLimit: 100, weeklyUsed: 42, weeklyLimit: 500 } });
  vi.spyOn(api, 'assistNextActions').mockResolvedValue({ data: { items: [] } } as any);
  await act(async () => root.render(createElement(PhoneAgentMobile)));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Actualiser le contexte"]')!.click());
  expect(host.textContent).toContain('Contexte actualisé');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Quota IA"]')!.click());
  expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('12 / 100');
  await act(async () => document.body.querySelector<HTMLButtonElement>('[role="dialog"] button')!.click());
  quota.mockRejectedValue(new Error('offline'));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Quota IA"]')!.click());
  expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Quota indisponible');
});

it('shows refreshed AI suggestions only for an administrator', async () => {
  vi.spyOn(api, 'assistStatus').mockResolvedValue({ data: { configured: true } } as any);
  vi.spyOn(api, 'getAgentPolicy').mockResolvedValue({ data: { blocked: false, isAdmin: false, dailyUsed: 0, dailyLimit: 100, weeklyUsed: 0, weeklyLimit: 500 } });
  vi.spyOn(api, 'assistNextActions').mockResolvedValue({ data: { items: [{ priority: 1, title: 'Suggestion sensible', detail: 'Vérifier' }] } });
  localStorage.setItem('stock_role', 'stock');
  await act(async () => root.render(createElement(PhoneAgentMobile)));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Actualiser le contexte"]')!.click());
  expect(host.textContent).not.toContain('Suggestion sensible');
  await act(async () => root.render(null)); localStorage.setItem('stock_role', 'owner');
  await act(async () => root.render(createElement(PhoneAgentMobile)));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Actualiser le contexte"]')!.click());
  expect(host.textContent).toContain('Suggestion sensible');
});

it('renders assistant Markdown safely, leaves user text untouched and copies the original reply', async () => {
  const original = '# Résumé\n\n**Important** et *texte*\n\n- Un\n- Deux\n\n| Stock | Qté |\n| --- | --- |\n| A | 2 |\n\n```js\nconst x = 1;\n```\n\n[Site](https://example.com) [dangereux](javascript:alert(1))\n\n<img src=x onerror=alert(1)> ![externe](https://example.com/tracker.png)';
  vi.spyOn(api, 'assistChat').mockResolvedValue({ data: { reply: original } } as any);
  const copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  await act(async () => root.render(createElement(PhoneAgentMobile)));
  const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '**texte utilisateur**'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const answer = host.querySelector('.ph-agent-bubble.assistant')!;
  expect(answer.querySelector('h1')?.textContent).toBe('Résumé');
  expect(answer.querySelector('strong')?.textContent).toBe('Important');
  expect(answer.querySelectorAll('li')).toHaveLength(2); expect(answer.querySelector('table')).not.toBeNull();
  expect(answer.querySelector('pre code')?.textContent).toContain('const x = 1');
  expect(answer.querySelector<HTMLAnchorElement>('a')?.href).toBe('https://example.com/');
  expect(answer.querySelector('a[href^="javascript:"]')).toBeNull(); expect(answer.querySelector('img')).toBeNull();
  expect(host.querySelector('.ph-agent-bubble.user')?.textContent).toBe('**texte utilisateur**');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Copier la réponse"]')!.click());
  expect(copy).toHaveBeenCalledWith(original);
});

it('shows native-style quick actions in a new conversation without a dock toggle or data changes', async () => {
  const create = vi.spyOn(api, 'createProduct');
  const onNavigate = vi.fn();
  vi.spyOn(api, 'assistChat').mockResolvedValue({ data: { reply: 'Réponse' } } as any);
  await act(async () => root.render(createElement(PhoneAgentMobile as ComponentType<{ onNavigate: typeof onNavigate }>, { onNavigate })));
  expect(host.querySelector('[aria-label="Raccourcis Atlas Agent"]')).toBeNull();
  expect(host.querySelector('[aria-label="Actions rapides"]')?.textContent).toContain('Mon activité');
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Demander un produit')!.click());
  expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('produit');
  expect(create).not.toHaveBeenCalled();
  await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent === 'Annuler')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('.ph-agent-prompts button')!.click());
  expect(host.querySelector('[aria-label="Actions rapides"]')).toBeNull();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Nouvelle discussion"]')!.click());
  expect(host.querySelector('[aria-label="Actions rapides"]')).not.toBeNull();
});

it('loads only read-only personal activity and preserves partial source failures', async () => {
  const activity = vi.spyOn(api, 'mobileWorkStatus').mockResolvedValue({ success: true, in_app: { availability: 'available', items: [{ id: '7', title: 'Marbre', status: 'pending' }], next_cursor: '7' }, trackers: { github: { availability: 'unavailable', items: [], next_cursor: null } } });
  await act(async () => root.render(createElement(PhoneAgentMobile)));
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Mon activité')!.click());
  expect(activity).toHaveBeenCalledWith(undefined);
  expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Marbre');
  expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Source indisponible');
  activity.mockRejectedValueOnce(new Error('offline'));
  await act(async () => [...document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(b => b.textContent === 'Afficher plus')!.click());
  expect(activity).toHaveBeenLastCalledWith({ source: 'in_app', value: '7' });
  expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Marbre');
  expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('Impossible de charger');
});

it('shows the full labeled agent dock before scrolling and collapses on deliberate scroll', async () => {
  await act(async () => root.render(createElement(PhoneAgentMobile)));
  const dock = host.querySelector<HTMLElement>('.ph-agent-dock')!;
  expect(dock.classList.contains('is-collapsed')).toBe(false);
  expect(dock.querySelector('.ph-agent-dock-title')?.textContent).toBe('Atlas Agent');
  expect(dock.querySelector('.ph-agent-dock-actions')?.querySelectorAll('button').length).toBe(4);
  const msgs = host.querySelector<HTMLElement>('.ph-agent-msgs')!;
  await act(async () => { msgs.scrollTop = 80; msgs.dispatchEvent(new Event('scroll')); });
  expect(dock.classList.contains('is-collapsed')).toBe(true);
  expect(dock.querySelector('.ph-agent-dock-expand')?.textContent).toBe('Atlas Agent');
  await act(async () => dock.querySelector<HTMLButtonElement>('.ph-agent-dock-expand')!.click());
  expect(dock.classList.contains('is-collapsed')).toBe(false);
});


it('deletes an archived conversation only after the server confirms, and retains it on failure', async () => {
  localStorage.setItem('stock_auth_user', 'alice');
  vi.spyOn(api, 'assistChat').mockResolvedValue({ data: { reply: 'Réponse' } } as any);
  const remove = vi.spyOn(api, 'deleteAgentThread').mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ success: true });
  await act(async () => root.render(createElement(PhoneAgentMobile)));
  await act(async () => host.querySelector<HTMLButtonElement>('.ph-agent-prompts button')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Nouvelle discussion"]')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Historique des discussions"]')!.click());
  const dialog = document.body.querySelector('[role="dialog"]')!;
  await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label^="Supprimer "]')!.click());
  const confirm = () => [...dialog.querySelectorAll('button')].find(b => b.textContent === 'Confirmer la suppression')!;
  expect(remove).not.toHaveBeenCalled();
  await act(async () => confirm().click());
  expect(dialog.textContent).toContain('Suppression impossible');
  expect(dialog.textContent).toContain('Quels articles');
  await act(async () => confirm().click());
  expect(remove).toHaveBeenCalledTimes(2);
  expect(dialog.textContent).not.toContain('Quels articles');
  expect(dialog.textContent).toContain('Conversation supprimée');
});

it('negotiates Supabase and saves a versioned first turn before the model call', async () => {
  localStorage.setItem('stock_auth_user', 'alice');
  localStorage.setItem(`atlas-agent-mobile-msgs-v2:${encodeURIComponent(window.location.origin)}:alice`, JSON.stringify({ threadId: 'mobile-old', messages: [{ role: 'user', text: 'Legacy private' }] }));
  vi.mocked(api.assistStatus).mockResolvedValue({ data: { configured: true, agent_history: { storage: 'supabase', version_type: 'string', require_expected_version: true } } } as any);
  vi.spyOn(api, 'getAgentThread').mockResolvedValue({ data: { messages: [] }, meta: { storage: 'supabase', version: null } } as any);
  let completeFirst!: (value: any) => void;
  const put = vi.spyOn(api, 'putAgentThread').mockImplementationOnce(() => new Promise(resolve => { completeFirst = resolve; })).mockResolvedValueOnce({ data: { storage: 'supabase', version: '2' } } as any);
  const chat = vi.spyOn(api, 'assistChat').mockResolvedValue({ data: { reply: 'Salut' } } as any);
  await act(async () => root.render(createElement(PhoneAgentMobile)));
  expect(host.textContent).not.toContain('Legacy private');
  const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Bonjour'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(put.mock.calls[0][1]).toMatchObject({ expected_version: null, messages: [{ role: 'user', text: 'Bonjour' }] });
  expect(chat).not.toHaveBeenCalled();
  await act(async () => completeFirst({ data: { storage: 'supabase', version: '1' } }));
  expect(chat).toHaveBeenCalledOnce();
  expect(put.mock.calls[1][1]).toMatchObject({ expected_version: '1', messages: [{ role: 'user', text: 'Bonjour' }, { role: 'assistant', text: 'Salut' }] });
  expect(host.textContent).toContain('Salut');
  expect(localStorage.getItem(`atlas-agent-mobile-msgs-v2:${encodeURIComponent(window.location.origin)}:alice`)).toContain('Legacy private');
});

it('keeps the input and does not call the model after a Supabase conflict', async () => {
  vi.mocked(api.assistStatus).mockResolvedValue({ data: { configured: true, agent_history: { storage: 'supabase', version_type: 'string', require_expected_version: true } } } as any);
  vi.spyOn(api, 'getAgentThread').mockResolvedValue({ data: { messages: [] }, meta: { storage: 'supabase', version: null } } as any);
  vi.spyOn(api, 'putAgentThread').mockRejectedValue(new Error('Conflit de version'));
  const chat = vi.spyOn(api, 'assistChat');
  await act(async () => root.render(createElement(PhoneAgentMobile)));
  const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Bonjour'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(chat).not.toHaveBeenCalled(); expect(input.value).toBe('Bonjour'); expect(host.textContent).toContain('Conflit de version');
});

it('does not show or overwrite old phone history if storage negotiation fails', async () => {
  localStorage.setItem('stock_auth_user', 'alice');
  const key = `atlas-agent-mobile-msgs-v2:${encodeURIComponent(window.location.origin)}:alice`;
  localStorage.setItem(key, JSON.stringify({ threadId: 'mobile-old', messages: [{ role: 'user', text: 'Legacy secret' }] }));
  vi.mocked(api.assistStatus).mockRejectedValue(new Error('offline'));
  await act(async () => root.render(createElement(PhoneAgentMobile)));
  expect(host.textContent).not.toContain('Legacy secret');
  expect(host.textContent).toContain('Stockage de l’Agent indisponible');
  expect(localStorage.getItem(key)).toContain('Legacy secret');
});

it('warns when the model answered but the versioned reply save fails', async () => {
  vi.mocked(api.assistStatus).mockResolvedValue({ data: { configured: true, agent_history: { storage: 'supabase', version_type: 'string', require_expected_version: true } } } as any);
  vi.spyOn(api, 'getAgentThread').mockResolvedValue({ data: { messages: [] }, meta: { storage: 'supabase', version: null } } as any);
  vi.spyOn(api, 'putAgentThread').mockResolvedValueOnce({ data: { storage: 'supabase', version: '1' } } as any).mockRejectedValueOnce(new Error('offline'));
  vi.spyOn(api, 'assistChat').mockResolvedValue({ data: { reply: 'Réponse reçue' } } as any);
  await act(async () => root.render(createElement(PhoneAgentMobile)));
  const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Bonjour'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(host.textContent).toContain('Réponse reçue');
  expect(host.textContent).toContain('sauvegarde serveur non confirmée');
});


it('downloads the displayed phone conversation from history', async () => {
  vi.spyOn(api, 'assistChat').mockResolvedValue({ data: { reply: 'Réponse mobile' } } as any);
  const download = vi.spyOn(exportTools, 'downloadAgentConversation').mockImplementation(() => {});
  await act(async () => root.render(createElement(PhoneAgentMobile)));
  const input = host.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, 'Bonjour'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Historique des discussions"]')!.click());
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Télécharger la conversation affichée"]')!.click());
  expect(download).toHaveBeenCalledWith(expect.arrayContaining([{ role: 'user', text: 'Bonjour' }, { role: 'assistant', text: 'Réponse mobile' }]));
});
