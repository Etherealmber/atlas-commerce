/** Staging-only adapter. Not wired to Agent routes; no R2/image cleanup. */
import type { Env } from '../env';
import { supabaseJournalConfig } from './journalSupabase';
import { decryptAgentPayload, encryptAgentPayload } from '../../experiments/agent-storage/crypto';

export class AgentStorageUnavailable extends Error {
  constructor() { super('Agent history unavailable'); }
}
export class AgentStorageConflict extends Error {
  constructor() { super('Agent history conflict'); }
}

type AgentRpc = 'atlas_agent_get' | 'atlas_agent_put' | 'atlas_agent_list' | 'atlas_agent_tombstone';
type DraftEnv = Env & { AGENT_HISTORY_ENCRYPTION_KEY?: string };

/** Hash exact authenticated username; never use a lossy R2-safe encoding. */
export async function agentAccountId(username: string): Promise<string> {
  if (!username || username.length > 200) throw new AgentStorageUnavailable();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`atlas-agent-account-v1|${username}`));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

async function rpc(env: DraftEnv, name: AgentRpc, body: object, fetcher: typeof fetch): Promise<any> {
  try {
    const { base, key } = supabaseJournalConfig(env);
    const headers: Record<string, string> = { apikey: key, 'content-type': 'application/json' };
    if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
    const response = await fetcher(`${base}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body), redirect: 'manual', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('upstream');
    return await response.json();
  } catch { throw new AgentStorageUnavailable(); }
}
function validThread(id: string): boolean { return /^[a-zA-Z0-9._-]{1,80}$/.test(id) && id !== '.' && id !== '..'; }
function secret(env: DraftEnv): string {
  const value = String(env.AGENT_HISTORY_ENCRYPTION_KEY || '');
  if (!value) throw new AgentStorageUnavailable();
  return value;
}

/** One bounded request, decrypting small title summaries without fetching messages. */
export async function listAgentDraft(env: DraftEnv, username: string, fetcher: typeof fetch = fetch): Promise<Array<{ id: string; title: string; message_count: number; updated_at: string }>> {
  const account = await agentAccountId(username); const key = secret(env);
  const rows = await rpc(env, 'atlas_agent_list', { p_account: account, p_limit: 20 }, fetcher);
  if (!Array.isArray(rows) || rows.length > 20 || rows.some(row => !row || typeof row.id !== 'string' || !validThread(row.id) || typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at)) || typeof row.encrypted_summary !== 'string' || row.encrypted_summary.length > 4096)) throw new AgentStorageUnavailable();
  try {
    return await Promise.all(rows.map(async row => {
      const raw = await decryptAgentPayload(key, `${account}:summary`, row.id, row.encrypted_summary);
      const summary = JSON.parse(raw);
      if (typeof summary.title !== 'string' || summary.title.length > 200 || !Number.isSafeInteger(summary.message_count) || summary.message_count < 0 || summary.message_count > 500) throw new Error('invalid summary');
      return { id: row.id as string, title: summary.title, message_count: summary.message_count as number, updated_at: row.updated_at as string };
    }));
  } catch { throw new AgentStorageUnavailable(); }
}

/** No fallback to legacy R2. Returns only after authenticated decryption. */
export async function getAgentDraft(env: DraftEnv, username: string, thread: string, fetcher: typeof fetch = fetch): Promise<{ payload: string; version: string } | null> {
  if (!validThread(thread)) throw new AgentStorageUnavailable();
  const key = secret(env); const account = await agentAccountId(username);
  const row = await rpc(env, 'atlas_agent_get', { p_account: account, p_thread: thread }, fetcher);
  if (row === null) return null;
  if (!row || typeof row.payload !== 'string' || typeof row.version !== 'string' || !/^[1-9][0-9]{0,18}$/.test(row.version)) throw new AgentStorageUnavailable();
  try { return { payload: await decryptAgentPayload(key, account, thread, row.payload), version: row.version }; }
  catch { throw new AgentStorageUnavailable(); }
}

/** Explicit create-only null or previously observed version; never blind write. */
export async function putAgentDraft(env: DraftEnv, username: string, thread: string, payload: string, version: string | null, summary: { title: string; message_count: number }, fetcher: typeof fetch = fetch): Promise<string> {
  if (!validThread(thread) || (version !== null && !/^[1-9][0-9]{0,18}$/.test(version))) throw new AgentStorageUnavailable();
  const key = secret(env); const account = await agentAccountId(username);
  if (!summary || typeof summary.title !== 'string' || summary.title.length > 200 || !Number.isSafeInteger(summary.message_count) || summary.message_count < 0 || summary.message_count > 500) throw new AgentStorageUnavailable();
  let ciphertext: string; let encryptedSummary: string;
  try {
    ciphertext = await encryptAgentPayload(key, account, thread, payload);
    encryptedSummary = await encryptAgentPayload(key, `${account}:summary`, thread, JSON.stringify(summary));
  }
  catch { throw new AgentStorageUnavailable(); }
  const result = await rpc(env, 'atlas_agent_put', { p_account: account, p_thread: thread, p_payload: ciphertext, p_expected_version: version, p_summary: encryptedSummary }, fetcher);
  if (result?.ok === false && result.conflict === true) throw new AgentStorageConflict();
  if (result?.ok !== true || typeof result.version !== 'string' || !/^[1-9][0-9]{0,18}$/.test(result.version)) throw new AgentStorageUnavailable();
  return result.version;
}

/** Preview-only metadata tombstone. It does not remove attachments. */
export async function tombstoneAgentDraft(env: DraftEnv, username: string, thread: string, fetcher: typeof fetch = fetch): Promise<void> {
  if (!validThread(thread)) throw new AgentStorageUnavailable();
  const account = await agentAccountId(username);
  const result = await rpc(env, 'atlas_agent_tombstone', { p_account: account, p_thread: thread }, fetcher);
  if (result?.ok !== true) throw new AgentStorageUnavailable();
}

/** Explicitly limited to an isolated test environment, never production/demo. */
export function useAgentStoragePreview(env: any): boolean {
  return env?.ENVIRONMENT === 'agent-storage-test' && env?.AGENT_STORAGE_PREVIEW === '1' && env?.ATLAS_DEMO !== '1';
}
