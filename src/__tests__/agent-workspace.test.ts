// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AtlasAgent from '../components/AtlasAgent';
import { api } from '../api';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear(); sessionStorage.clear();
  sessionStorage.setItem('atlas_agent_open', '1');
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(api, 'getAgentPolicy').mockResolvedValue({ data: null } as any);
  vi.spyOn(api, 'getAgentPermissions').mockResolvedValue({ data: { mode: 'full' } } as any);
  vi.spyOn(api, 'getAgentThread').mockResolvedValue({ data: null } as any);
  vi.spyOn(api, 'listAgentThreads').mockResolvedValue({ data: [] } as any);
  vi.spyOn(api, 'putAgentThread').mockResolvedValue({ data: null } as any);
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); localStorage.clear(); sessionStorage.clear(); vi.restoreAllMocks(); });
const render = () => act(async () => root.render(createElement(MemoryRouter, null, createElement(AtlasAgent))));
const click = (selector: string) => act(async () => { const button = host.querySelector<HTMLButtonElement>(selector); expect(button).not.toBeNull(); button!.click(); });

it('shows the welcome workspace and opens the conversation picker', async () => {
  await render();
  expect(host.textContent).toContain('Comment puis-je vous aider');
  expect(host.textContent).toContain('Surveiller le stock');
  await click('[aria-label="Historique des conversations"]');
  expect(host.querySelector('[aria-label="Rechercher une conversation"]')).not.toBeNull();
  expect(host.textContent).toContain('Aucune conversation trouvée');
  expect(host.querySelector('.atlas-agent-panel--expanded')).toBeNull();
  await click('[aria-label="Agrandir le panneau"]');
  expect(host.querySelector('[aria-label="Conversations Atlas Agent"]')).not.toBeNull();
  expect(localStorage.getItem('atlas_agent_expanded')).toBe('1');
  await click('[aria-label="Réduire le panneau"]');
  expect(host.querySelector('.atlas-agent-panel--expanded')).toBeNull();
  expect(localStorage.getItem('atlas_agent_expanded')).toBe('0');
});

it('switches existing conversations without carrying messages into a new conversation', async () => {
  localStorage.setItem('atlas_agent_threads_v1:admin', JSON.stringify([{ id: 'thread-a', title: 'Premier échange', updated: 10 }, { id: 'thread-b', title: 'Autre échange', updated: 5 }]));
  localStorage.setItem('atlas_agent_active_thread:admin', 'thread-a');
  localStorage.setItem('atlas_agent_msgs_v1:admin:thread-a', JSON.stringify([{ role: 'user', text: 'Question A' }, { role: 'assistant', text: 'Réponse A' }]));
  localStorage.setItem('atlas_agent_msgs_v1:admin:thread-b', JSON.stringify([{ role: 'user', text: 'Question B' }, { role: 'assistant', text: 'Réponse B' }]));
  vi.mocked(api.getAgentThread).mockImplementation(async (id: string) => ({ data: { title: id, messages: JSON.parse(localStorage.getItem(`atlas_agent_msgs_v1:admin:${id}`) || '[]') }, meta: { version: id } } as any));
  await render(); expect(host.textContent).toContain('Réponse A');
  await click('[aria-label="Historique des conversations"]');
  const option = [...host.querySelectorAll<HTMLButtonElement>('.atlas-agent-history-choice')].find((el) => el.textContent?.includes('Autre échange'))!;
  await act(async () => option.click());
  expect(host.textContent).toContain('Réponse B'); expect(host.textContent).not.toContain('Réponse A');
  await click('[aria-label="Nouvelle conversation"]');
  expect(host.textContent).not.toContain('Réponse B'); expect(host.textContent).toContain('Comment puis-je vous aider');
  expect(JSON.parse(localStorage.getItem('atlas_agent_msgs_v1:admin:thread-b')!)[1].text).toBe('Réponse B');
});

it('shows streamed tokens while waiting, then replaces them with the authoritative reply', async () => {
  let finish!: (result: any) => void;
  let emit!: (event: string, data: any) => void;
  vi.spyOn(api, 'assistChat').mockImplementation((_prompt: any, options: any) => {
    emit = options.onAgentEvent;
    return new Promise((resolve) => { finish = resolve; });
  });
  await render();
  const suggestion = [...host.querySelectorAll<HTMLButtonElement>('.atlas-agent-welcome-cards button')][0];
  await act(async () => suggestion.click());
  await act(async () => emit('token', { t: 'Réponse partielle' }));
  expect(host.textContent).toContain('Réponse partielle');
  expect(host.querySelector('.atlas-agent-thinking-row')).toBeNull();
  expect(Object.keys(localStorage).filter((key) => key.startsWith('atlas_agent_msgs_v1:')).every((key) => !localStorage.getItem(key)?.includes('Réponse partielle'))).toBe(true);
  await act(async () => finish({ data: { reply: 'Réponse complète', tool_trace: [] } }));
  expect(host.textContent).toContain('Réponse complète');
  expect(host.textContent).not.toContain('Réponse partielle');
});

it('shows the real completed tool steps above the answer and lets them expand', async () => {
  vi.spyOn(api, 'assistChat').mockResolvedValue({ data: { reply: 'Voici le stock.', tool_trace: [{ name: 'list_low_stock', ok: true }, { name: 'search_products', ok: false }] } } as any);
  await render();
  const suggestion = host.querySelector<HTMLButtonElement>('.atlas-agent-welcome-cards button')!;
  await act(async () => suggestion.click());
  const activity = host.querySelector<HTMLButtonElement>('.atlas-agent-tools-toggle')!;
  expect(activity.textContent).toContain('2 étapes');
  expect(activity.getAttribute('aria-expanded')).toBe('false');
  const bubble = activity.closest('.atlas-agent-msg')!.querySelector('.atlas-agent-bubble')!;
  expect(activity.compareDocumentPosition(bubble) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await act(async () => activity.click());
  expect(host.textContent).toContain('Consulter les stocks bas');
  expect(host.textContent).toContain('Échec');
});

it('reads the remote conversation without overwriting it on mount', async () => {
  localStorage.setItem('atlas_agent_active_thread:admin', 'remote-thread');
  vi.mocked(api.getAgentThread).mockResolvedValue({ data: { title: 'R2', messages: [{ role: 'user', text: 'Question R2' }, { role: 'assistant', text: 'Réponse R2', tools: [{ name: 'search_products', ok: true }] }] }, meta: { version: 'r2-v1' } } as any);
  await render();
  expect(host.textContent).toContain('Réponse R2');
  expect(host.textContent).toContain('1 étape');
  expect(api.putAgentThread).not.toHaveBeenCalled();
});

it('saves a completed reply with the R2 version and shows a failure instead of claiming success', async () => {
  vi.useFakeTimers();
  try {
    vi.mocked(api.getAgentThread).mockResolvedValue({ data: { messages: [] }, meta: { version: null } } as any);
    vi.mocked(api.putAgentThread).mockRejectedValue(new Error('storage failed'));
    vi.spyOn(api, 'assistChat').mockResolvedValue({ data: { reply: 'Réponse R2', tool_trace: [] } } as any);
    await render();
    const suggestion = host.querySelector<HTMLButtonElement>('.atlas-agent-welcome-cards button')!;
    await act(async () => suggestion.click());
    await act(async () => { await vi.advanceTimersByTimeAsync(550); });
    expect(api.putAgentThread).toHaveBeenCalledOnce();
    expect(vi.mocked(api.putAgentThread).mock.calls[0][1]).toMatchObject({ expected_version: null, messages: expect.arrayContaining([expect.objectContaining({ text: 'Réponse R2' })]) });
    expect(host.textContent).toContain('R2 indisponible');
    expect(Object.keys(localStorage).some(key => key.startsWith('atlas_agent_pending_v1:admin:'))).toBe(true);
  } finally { vi.useRealTimers(); }
});

it('preserves a local edit when another device has changed the R2 version', async () => {
  localStorage.setItem('atlas_agent_active_thread:admin', 'conflict');
  localStorage.setItem('atlas_agent_msgs_v1:admin:conflict', JSON.stringify([{ role: 'user', text: 'Mon édition locale' }]));
  localStorage.setItem('atlas_agent_pending_v1:admin:conflict', JSON.stringify({ known: true, version: 'old' }));
  vi.mocked(api.getAgentThread).mockResolvedValue({ data: { title: 'Remote', messages: [{ role: 'user', text: 'Autre appareil' }] }, meta: { version: 'new' } } as any);
  await render();
  expect(host.textContent).toContain('Mon édition locale');
  expect(host.textContent).toContain('modifiée ailleurs');
  expect(host.textContent).toContain('Enregistrer une copie');
  expect(api.putAgentThread).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem('atlas_agent_pending_v1:admin:conflict')!).version).toBe('old');
});

it('saves to R2 then restores the answer on a fresh browser cache', async () => {
  vi.useFakeTimers();
  try {
    let stored: any = null;
    vi.mocked(api.getAgentThread).mockImplementation(async () => stored ? { data: stored.messagesData, meta: { version: stored.version } } as any : { data: { messages: [] }, meta: { version: null } } as any);
    vi.mocked(api.putAgentThread).mockImplementation(async (_id, body) => {
      stored = { messagesData: { title: body.title, messages: body.messages }, version: 'r2-version' };
      return { data: { id: _id, storage: 'r2', version: stored.version } };
    });
    vi.spyOn(api, 'assistChat').mockResolvedValue({ data: { reply: 'Réponse sauvegardée', tool_trace: [{ name: 'list_low_stock', ok: true }] } } as any);
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>('.atlas-agent-welcome-cards button')!.click());
    await act(async () => { await vi.advanceTimersByTimeAsync(550); });
    expect(stored.messagesData.messages.some((m: any) => m.text === 'Réponse sauvegardée')).toBe(true);
    expect(Object.keys(localStorage).some(key => key.startsWith('atlas_agent_pending_v1:admin:'))).toBe(false);
    const id = localStorage.getItem('atlas_agent_active_thread:admin')!;
    await act(async () => root.unmount());
    localStorage.clear(); localStorage.setItem('atlas_agent_active_thread:admin', id);
    root = createRoot(host);
    await render();
    expect(host.textContent).toContain('Réponse sauvegardée');
    expect(host.textContent).toContain('1 étape');
  } finally { vi.useRealTimers(); }
});


it('shows a shimmer only while an empty conversation hydrates from R2', async () => {
  let resolve!: (value: any) => void;
  vi.mocked(api.getAgentThread).mockReturnValue(new Promise(r => { resolve = r; }));
  await render();
  expect(host.querySelector('.atlas-agent-shimmer-bubble--user')).not.toBeNull();
  expect(host.textContent).not.toContain('Comment puis-je vous aider');
  expect(api.putAgentThread).not.toHaveBeenCalled();
  await act(async () => resolve({ data: { messages: [{ role: 'user', text: 'Question R2' }, { role: 'assistant', text: 'Réponse R2' }] }, meta: { version: 'v1' } }));
  expect(host.querySelector('.atlas-agent-shimmer-bubble--user')).toBeNull();
  expect(host.textContent).toContain('Réponse R2');
  expect(api.putAgentThread).not.toHaveBeenCalled();
});

it('renders one header title and immediately deletes the selected R2 thread after confirmation', async () => {
  localStorage.setItem('atlas_agent_threads_v1:admin', JSON.stringify([{ id: 'thread-a', title: 'Factures impayées', updated: 10 }]));
  localStorage.setItem('atlas_agent_active_thread:admin', 'thread-a');
  vi.mocked(api.getAgentThread).mockImplementation(async id => id === 'thread-a' ? { data: { title: 'Factures impayées', messages: [{ role: 'user', text: 'Factures impayées' }] }, meta: { version: 'v1' } } as any : { data: { messages: [] }, meta: { version: null } } as any);
  const remove = vi.spyOn(api, 'deleteAgentThread').mockResolvedValue({ success: true } as any);
  await render();
  await click('[aria-label="Agrandir le panneau"]');
  expect(host.querySelectorAll('.atlas-agent-header-title strong')).toHaveLength(1);
  const del = host.querySelector<HTMLButtonElement>('.atlas-agent-workspace-sidebar [aria-label="Supprimer Factures impayées"]')!;
  expect(del).not.toBeNull();
  await act(async () => del.click());
  expect(remove).not.toHaveBeenCalled();
  await act(async () => document.querySelector<HTMLButtonElement>('.ac-confirm-ok')!.click());
  expect(remove).toHaveBeenCalledWith('thread-a');
  expect(host.querySelector('.atlas-agent-workspace-sidebar [aria-label="Supprimer Factures impayées"]')).toBeNull();
  expect(localStorage.getItem('atlas_agent_msgs_v1:admin:thread-a')).toBeNull();
});

it('keeps the conversation when deletion fails or is cancelled', async () => {
  localStorage.setItem('atlas_agent_threads_v1:admin', JSON.stringify([{ id: 'thread-a', title: 'Factures', updated: 10 }]));
  const remove = vi.spyOn(api, 'deleteAgentThread').mockRejectedValue(new Error('offline'));
  await render();
  await click('[aria-label="Agrandir le panneau"]');
  const del = host.querySelector<HTMLButtonElement>('.atlas-agent-workspace-sidebar [aria-label="Supprimer Factures"]')!;
  await act(async () => del.click()); expect(remove).not.toHaveBeenCalled();
  await act(async () => document.querySelector<HTMLButtonElement>('.ac-confirm-cancel')!.click());
  expect(remove).not.toHaveBeenCalled();
  await act(async () => del.click());
  await act(async () => document.querySelector<HTMLButtonElement>('.ac-confirm-ok')!.click());
  expect(remove).toHaveBeenCalledOnce();
  expect(host.textContent).toContain('Suppression impossible');
  expect(host.querySelector('.atlas-agent-workspace-sidebar [aria-label="Supprimer Factures"]')).not.toBeNull();
});

it('restores the previously selected expanded state on remount', async () => {
  localStorage.setItem('atlas_agent_expanded', '1');
  await render();
  expect(host.querySelector('.atlas-agent-panel--expanded')).not.toBeNull();
});

it('places the agent name inside the answer, and keeps the user name accessible without a visible label', async () => {
  localStorage.setItem('atlas_agent_active_thread:admin', 'labels');
  localStorage.setItem('atlas_agent_msgs_v1:admin:labels', JSON.stringify([{ role: 'user', text: 'Bonjour' }, { role: 'assistant', text: 'Bienvenue' }]));
  vi.mocked(api.getAgentThread).mockResolvedValue({ data: { messages: [{ role: 'user', text: 'Bonjour' }, { role: 'assistant', text: 'Bienvenue' }] }, meta: { version: 'v1' } } as any);
  await render();
  expect(host.querySelector('.atlas-agent-msg.assistant .atlas-agent-bubble .atlas-agent-msg-label')?.textContent).toBe('Atlas Agent');
  expect(host.querySelector('.atlas-agent-msg.user .atlas-agent-bubble .sr-only')?.textContent).toBe('Vous');
});

it('shows a dismissible mascot hint and opens the agent when it is selected', async () => {
  vi.useFakeTimers();
  try {
    sessionStorage.setItem('atlas_agent_open', '0');
    await render();
    expect(host.querySelector('.atlas-agent-fab .ph-mascot')).not.toBeNull();
    expect(host.querySelector('.atlas-agent-mascot-hint')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(host.querySelector('.atlas-agent-mascot-hint')).not.toBeNull();
    await click('.atlas-agent-hint-open');
    expect(host.querySelector('.atlas-agent-panel.open')).not.toBeNull();
    expect(host.querySelector('.atlas-agent-mascot-hint')).toBeNull();
  } finally { vi.useRealTimers(); }
});

it('keeps automatic modification unavailable even with a legacy auto preference', async () => {
  localStorage.setItem('atlas_agent_exec_mode', 'auto');
  await render();
  expect(host.textContent).toContain('Demander avant modification');
  const disabled = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Modification automatique'));
  expect(disabled?.disabled).toBe(true);
  expect(host.textContent).toContain('propositions nécessitent une validation');
});
