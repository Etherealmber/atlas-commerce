/** Version-aware mobile-web snapshot operations for Supabase mode. */
type Message = { role: 'user' | 'assistant'; text: string };
type Client = {
  getAgentThread(id: string): Promise<{ data: { messages?: any[] }; meta?: { version: string | null; storage?: string } }>;
  putAgentThread(id: string, body: { title: string; messages: Message[]; expected_version: string | null }): Promise<{ data: { storage: string; version: string } }>;
};
export type PreparedPhoneTurn = { version: string; title: string; messages: Message[]; storage: string };

/** Never rewrite richer desktop messages through the mobile text-only DTO. */
function strictMessages(messages: unknown): Message[] {
  if (!Array.isArray(messages) || messages.some(m => !m || typeof m !== 'object' || !['user', 'assistant'].includes(m.role) || typeof m.text !== 'string' || Object.keys(m).some(k => k !== 'role' && k !== 'text'))) throw new Error('La conversation contient des données incompatibles avec la synchronisation mobile.');
  return messages.map(m => ({ role: m.role, text: m.text }));
}

/** Reject divergence rather than importing a legacy local conversation. */
export async function preparePhonePreviewTurn(client: Client, id: string, local: Message[], text: string): Promise<PreparedPhoneTurn | null> {
  const result = await client.getAgentThread(id);
  if (!['supabase-preview', 'supabase'].includes(result.meta?.storage || '')) return null;
  const storage = result.meta!.storage!;
  const version = result.meta!.version;
  if ((version !== null && (typeof version !== 'string' || !version)) || !Array.isArray(result.data?.messages)) throw new Error('Version ou conversation serveur invalide.');
  const remote = result.data.messages;
  const localMessages = strictMessages(local); const remoteMessages = strictMessages(remote);
  if (JSON.stringify(localMessages) !== JSON.stringify(remoteMessages)) throw new Error('La conversation locale diffère du serveur. Ouvrez une nouvelle discussion.');
  const messages: Message[] = [...localMessages, { role: 'user', text }];
  const title = (messages.find(m => m.role === 'user')?.text || 'Sans titre').trim().slice(0, 48);
  const saved = await client.putAgentThread(id, { title, messages, expected_version: version });
  if (saved.data?.storage !== storage || typeof saved.data.version !== 'string' || !saved.data.version) throw new Error('Confirmation de sauvegarde manquante.');
  return { version: saved.data.version, title, messages, storage };
}

export async function finishPhonePreviewTurn(client: Client, id: string, prepared: PreparedPhoneTurn, reply: string): Promise<void> {
  const saved = await client.putAgentThread(id, { title: prepared.title, messages: [...prepared.messages, { role: 'assistant', text: reply }], expected_version: prepared.version });
  if (saved.data?.storage !== prepared.storage || typeof saved.data.version !== 'string' || !saved.data.version) throw new Error('Confirmation de sauvegarde manquante.');
}

/**
 * Recover a known model reply without calling the model again. The caller is
 * responsible for durable, account-scoped persistence of the recovery record.
 * Neither stale edits nor unknown storage modes may be overwritten.
 */
export async function reconcilePhoneReply(client: Client, id: string, prepared: PreparedPhoneTurn, reply: string): Promise<'already-saved' | 'saved'> {
  if (!['supabase', 'supabase-preview'].includes(prepared.storage) || typeof prepared.version !== 'string' || !prepared.version || typeof prepared.title !== 'string' || typeof reply !== 'string' || !reply.trim()) throw new Error('Données de récupération invalides.');
  const base = strictMessages(prepared.messages);
  const desired: Message[] = [...base, { role: 'assistant', text: reply }];
  const current = await client.getAgentThread(id);
  if (current.meta?.storage !== prepared.storage || typeof current.meta.version !== 'string' || !current.meta.version) throw new Error('Conversation serveur indisponible.');
  const remote = strictMessages(current.data?.messages);
  if (JSON.stringify(remote) === JSON.stringify(desired)) return 'already-saved';
  if (current.meta.version !== prepared.version || JSON.stringify(remote) !== JSON.stringify(base)) throw new Error('Conversation modifiée ailleurs : sauvegarde non écrasée.');
  await finishPhonePreviewTurn(client, id, prepared, reply);
  return 'saved';
}
