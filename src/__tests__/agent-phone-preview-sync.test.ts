import { expect, it, vi } from 'vitest';
import { finishPhonePreviewTurn, preparePhonePreviewTurn } from '../mobile/agentPreviewSync';

it('saves a first question and reply with consecutive versions', async () => {
  const client = { getAgentThread: vi.fn(async () => ({ data: { messages: [] }, meta: { storage: 'supabase-preview', version: null } })), putAgentThread: vi.fn().mockResolvedValueOnce({ data: { storage: 'supabase-preview', version: '1' } }).mockResolvedValueOnce({ data: { storage: 'supabase-preview', version: '2' } }) };
  const turn = await preparePhonePreviewTurn(client, 't', [], 'Bonjour');
  expect(client.putAgentThread).toHaveBeenNthCalledWith(1, 't', { title: 'Bonjour', messages: [{ role: 'user', text: 'Bonjour' }], expected_version: null });
  await finishPhonePreviewTurn(client, 't', turn!, 'Salut');
  expect(client.putAgentThread).toHaveBeenNthCalledWith(2, 't', { title: 'Bonjour', messages: [{ role: 'user', text: 'Bonjour' }, { role: 'assistant', text: 'Salut' }], expected_version: '1' });
});

it('refuses to republish a local-only or changed conversation and propagates CAS failure', async () => {
  const client = { getAgentThread: vi.fn(async () => ({ data: { messages: [] }, meta: { storage: 'supabase-preview', version: null } })), putAgentThread: vi.fn().mockRejectedValue(new Error('conflict')) };
  await expect(preparePhonePreviewTurn(client, 't', [{ role: 'user', text: 'old local' }], 'new')).rejects.toThrow('diffère');
  expect(client.putAgentThread).not.toHaveBeenCalled();
  await expect(preparePhonePreviewTurn(client, 't', [], 'new')).rejects.toThrow('conflict');
});

it('does not write a snapshot for the legacy R2 mode', async () => {
  const client = { getAgentThread: vi.fn(async () => ({ data: { messages: [] }, meta: { version: null } })), putAgentThread: vi.fn() };
  expect(await preparePhonePreviewTurn(client, 't', [], 'new')).toBeNull();
  expect(client.putAgentThread).not.toHaveBeenCalled();
});
