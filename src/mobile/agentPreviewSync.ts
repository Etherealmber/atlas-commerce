/** Version-aware mobile-web snapshot operations for the isolated preview only. */
type Message = { role: 'user' | 'assistant'; text: string };
type Client = {
  getAgentThread(id: string): Promise<{ data: { messages?: any[] }; meta?: { version: string | null; storage?: string } }>;
  putAgentThread(id: string, body: { title: string; messages: Message[]; expected_version: string | null }): Promise<{ data: { storage: string; version: string } }>;
};
type Prepared = { version: string; title: string; messages: Message[] };

/** Reject divergence rather than importing a legacy local conversation. */
export async function preparePhonePreviewTurn(client: Client, id: string, local: Message[], text: string): Promise<Prepared | null> {
  const result = await client.getAgentThread(id);
  if (result.meta?.storage !== 'supabase-preview') return null;
  const remote = Array.isArray(result.data?.messages) ? result.data.messages : [];
  const clean = (messages: any[]): Message[] => messages.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string').map(m => ({ role: m.role, text: m.text }));
  const localMessages = clean(local); const remoteMessages = clean(remote);
  if (JSON.stringify(localMessages) !== JSON.stringify(remoteMessages)) throw new Error('La conversation locale diffère du serveur. Ouvrez une nouvelle discussion.');
  const messages: Message[] = [...localMessages, { role: 'user', text }];
  const title = (messages.find(m => m.role === 'user')?.text || 'Sans titre').trim().slice(0, 48);
  const saved = await client.putAgentThread(id, { title, messages, expected_version: result.meta.version });
  if (saved.data?.storage !== 'supabase-preview' || !saved.data.version) throw new Error('Confirmation de sauvegarde manquante.');
  return { version: saved.data.version, title, messages };
}

export async function finishPhonePreviewTurn(client: Client, id: string, prepared: Prepared, reply: string): Promise<void> {
  const saved = await client.putAgentThread(id, { title: prepared.title, messages: [...prepared.messages, { role: 'assistant', text: reply }], expected_version: prepared.version });
  if (saved.data?.storage !== 'supabase-preview' || !saved.data.version) throw new Error('Confirmation de sauvegarde manquante.');
}
