// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import AgentStorageProbe from '../components/settings/AgentStorageProbe';
import { api } from '../api';

it('only checks storage when requested and does not claim a full cutover', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'); document.body.appendChild(host); const root = createRoot(host);
  const probe = vi.spyOn(api, 'probeAgentStorage').mockResolvedValue({ data: { key_self_test: 'pass', read_rpc: 'pass', storage_mode_changed: false, write_test_performed: false } });
  try {
    await act(async () => root.render(createElement(AgentStorageProbe)));
    expect(probe).not.toHaveBeenCalled();
    await act(async () => host.querySelector('button')!.click());
    expect(probe).toHaveBeenCalledOnce();
    expect(host.textContent).toContain('Lecture RPC : réussie');
    expect(host.textContent).toContain('ne vérifie pas les écritures');
  } finally { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); }
});
