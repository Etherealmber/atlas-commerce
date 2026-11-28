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

it('accepts the Supabase production label while preserving create-only semantics', async () => {
  const client = { getAgentThread: vi.fn(async () => ({ data: { messages: [] }, meta: { storage: 'supabase', version: null } })), putAgentThread: vi.fn().mockResolvedValue({ data: { storage: 'supabase', version: '1' } }) };
  const turn = await preparePhonePreviewTurn(client, 't', [], 'Bonjour');
  expect(turn?.version).toBe('1');
  expect(client.putAgentThread).toHaveBeenCalledWith('t', expect.objectContaining({ expected_version: null }));
});


it('rejects malformed server revisions and snapshots before any write', async () => {
  const client: any = { getAgentThread: vi.fn(), putAgentThread: vi.fn() };
  for (const result of [
    { data: { messages: [] }, meta: { storage: 'supabase' } },
    { data: { messages: [] }, meta: { storage: 'supabase', version: 42 } },
    { data: {}, meta: { storage: 'supabase', version: null } },
    { data: { messages: [{ role: 'user' }] }, meta: { storage: 'supabase', version: '1' } },
  ]) {
    client.getAgentThread.mockResolvedValueOnce(result);
    await expect(preparePhonePreviewTurn(client, 't', [], 'new')).rejects.toThrow();
  }
  expect(client.putAgentThread).not.toHaveBeenCalled();
});

it('rejects acknowledgements from a different storage mode', async () => {
  const client = { getAgentThread: vi.fn(async () => ({ data: { messages: [] }, meta: { storage: 'supabase', version: null } })), putAgentThread: vi.fn().mockResolvedValue({ data: { storage: 'supabase-preview', version: '1' } }) };
  await expect(preparePhonePreviewTurn(client, 't', [], 'new')).rejects.toThrow('Confirmation');
});

it('refuses to overwrite rich desktop messages with a text-only mobile snapshot', async () => {
  const client = { getAgentThread: vi.fn(async () => ({ data: { messages: [{ role: 'user', text: 'Bonjour', images: ['image-data'] }] }, meta: { storage: 'supabase', version: '1' } })), putAgentThread: vi.fn() };
  await expect(preparePhonePreviewTurn(client, 't', [{ role: 'user', text: 'Bonjour' }], 'next')).rejects.toThrow('incompatibles');
  expect(client.putAgentThread).not.toHaveBeenCalled();
});

it('reconciles a lost reply acknowledgement without resending the model turn', async () => {
  const { reconcilePhoneReply } = await import('../mobile/agentPreviewSync');
  const prepared = { storage: 'supabase', version: '1', title: 'Question', messages: [{ role: 'user' as const, text: 'Question' }] };
  const client: any = { getAgentThread: vi.fn(), putAgentThread: vi.fn().mockResolvedValue({ data: { storage: 'supabase', version: '2' } }) };
  client.getAgentThread.mockResolvedValueOnce({ data: { messages: [...prepared.messages, { role: 'assistant', text: 'Réponse' }] }, meta: { storage: 'supabase', version: '2' } });
  expect(await reconcilePhoneReply(client, 't', prepared, 'Réponse')).toBe('already-saved');
  expect(client.putAgentThread).not.toHaveBeenCalled();
  client.getAgentThread.mockResolvedValueOnce({ data: { messages: prepared.messages }, meta: { storage: 'supabase', version: '1' } });
  expect(await reconcilePhoneReply(client, 't', prepared, 'Réponse')).toBe('saved');
  expect(client.putAgentThread).toHaveBeenCalledWith('t', expect.objectContaining({ expected_version: '1', messages: [...prepared.messages, { role: 'assistant', text: 'Réponse' }] }));
});

it('does not reconcile over a changed, expired, or richer server snapshot', async () => {
  const { reconcilePhoneReply } = await import('../mobile/agentPreviewSync');
  const prepared = { storage: 'supabase', version: '1', title: 'Question', messages: [{ role: 'user' as const, text: 'Question' }] };
  const client: any = { getAgentThread: vi.fn(), putAgentThread: vi.fn() };
  for (const result of [
    { data: { messages: prepared.messages }, meta: { storage: 'supabase', version: '2' } },
    { data: { messages: [] }, meta: { storage: 'supabase', version: null } },
    { data: { messages: [{ role: 'user', text: 'Question', images: ['x'] }] }, meta: { storage: 'supabase', version: '1' } },
    { data: { messages: prepared.messages }, meta: { storage: 'supabase-preview', version: '1' } },
  ]) {
    client.getAgentThread.mockResolvedValueOnce(result);
    await expect(reconcilePhoneReply(client, 't', prepared, 'Réponse')).rejects.toThrow();
  }
  expect(client.putAgentThread).not.toHaveBeenCalled();
});
