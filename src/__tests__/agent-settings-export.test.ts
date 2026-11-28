// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import AgentDataExport from '../components/settings/AgentDataExport';
import { api } from '../api';
import * as exporter from '../lib/agentConversationExport';
import * as auth from '../auth';

it('loads only on request and downloads the selected saved text, not other account data', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  const list = vi.spyOn(api, 'listAgentThreads').mockResolvedValue({ data: [{ id: 't1', title: 'Premier' }, { id: 't2', title: 'Deuxième' }] });
  const get = vi.spyOn(api, 'getAgentThread').mockResolvedValue({ data: { messages: [{ role: 'user', text: 'Question' }, { role: 'assistant', text: 'Réponse' }] }, meta: { version: '3' } });
  const download = vi.spyOn(exporter, 'downloadAgentConversation').mockImplementation(() => {});
  try {
    await act(async () => root.render(createElement(AgentDataExport)));
    expect(list).not.toHaveBeenCalled(); expect(host.textContent).toContain('pas une exportation complète');
    await act(async () => host.querySelector('button')!.click());
    expect(list).toHaveBeenCalledOnce();
    const select = host.querySelector('select')! as unknown as HTMLInputElement;
    await act(async () => { select.value = 't2'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Télécharger le texte')!.click());
    expect(get).toHaveBeenCalledWith('t2');
    expect(download).toHaveBeenCalledWith([{ role: 'user', text: 'Question' }, { role: 'assistant', text: 'Réponse' }]);
  } finally { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); }
});

it('refuses a download after the active session changes', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  const user = vi.spyOn(auth, 'getUsername').mockReturnValue('alice');
  vi.spyOn(api, 'listAgentThreads').mockResolvedValue({ data: [{ id: 't1', title: 'Private' }] });
  const get = vi.spyOn(api, 'getAgentThread'); const download = vi.spyOn(exporter, 'downloadAgentConversation').mockImplementation(() => {});
  try {
    await act(async () => root.render(createElement(AgentDataExport)));
    await act(async () => host.querySelector('button')!.click());
    user.mockReturnValue('bob');
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Télécharger le texte')!.click());
    expect(get).not.toHaveBeenCalled(); expect(download).not.toHaveBeenCalled(); expect(host.textContent).toContain('session a changé');
  } finally { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); }
});
