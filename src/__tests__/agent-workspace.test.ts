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
  expect(host.querySelector('.atlas-agent-panel--expanded')).not.toBeNull();
  expect(host.querySelector('[aria-label="Conversations Atlas Agent"]')).not.toBeNull();
  await click('[aria-label="Réduire le panneau"]');
  expect(host.querySelector('.atlas-agent-panel--expanded')).toBeNull();
  await click('[aria-label="Agrandir le panneau"]');
  expect(host.querySelector('.atlas-agent-panel--expanded')).not.toBeNull();
});

it('switches existing conversations without carrying messages into a new conversation', async () => {
  localStorage.setItem('atlas_agent_threads_v1:admin', JSON.stringify([{ id: 'thread-a', title: 'Premier échange', updated: 10 }, { id: 'thread-b', title: 'Autre échange', updated: 5 }]));
  localStorage.setItem('atlas_agent_active_thread:admin', 'thread-a');
  localStorage.setItem('atlas_agent_msgs_v1:admin:thread-a', JSON.stringify([{ role: 'user', text: 'Question A' }, { role: 'assistant', text: 'Réponse A' }]));
  localStorage.setItem('atlas_agent_msgs_v1:admin:thread-b', JSON.stringify([{ role: 'user', text: 'Question B' }, { role: 'assistant', text: 'Réponse B' }]));
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
