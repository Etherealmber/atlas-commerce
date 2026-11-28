import type { PreparedPhoneTurn } from './agentPreviewSync';

export type PendingPhoneReply = { threadId: string; prepared: PreparedPhoneTurn; reply: string };
export type PendingRead = { kind: 'none' } | { kind: 'invalid' } | { kind: 'pending'; record: PendingPhoneReply; serialized: string };

/** Browser cache is plaintext like the existing phone conversation cache. */
export function readPendingPhoneReply(storage: Storage, key: string, mode: string): PendingRead {
  try {
    const serialized = storage.getItem(key); if (serialized === null) return { kind: 'none' };
    const r = JSON.parse(serialized); const p = r?.prepared;
    if (!r || typeof r.threadId !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(r.threadId) || r.threadId === '.' || r.threadId === '..' || typeof r.reply !== 'string' || !r.reply.trim() || r.reply.length > 1_500_000 || !p || p.storage !== mode || typeof p.version !== 'string' || !p.version || typeof p.title !== 'string' || !Array.isArray(p.messages) || p.messages.length > 500 || p.messages.some((m: any) => !m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.text !== 'string' || Object.keys(m).some(k => k !== 'role' && k !== 'text'))) return { kind: 'invalid' };
    return { kind: 'pending', record: r as PendingPhoneReply, serialized };
  } catch { return { kind: 'invalid' }; }
}

/** Do not replace an older outstanding recovery record. */
export function savePendingPhoneReply(storage: Storage, key: string, record: PendingPhoneReply): string {
  if (storage.getItem(key) !== null) throw new Error('Une autre réponse attend déjà sa sauvegarde.');
  const serialized = JSON.stringify(record); storage.setItem(key, serialized); return serialized;
}

/** Avoid deleting a newer record if another tab changed the local cache. */
export function clearPendingPhoneReply(storage: Storage, key: string, serialized: string): boolean {
  if (storage.getItem(key) !== serialized) return false;
  storage.removeItem(key); return true;
}
