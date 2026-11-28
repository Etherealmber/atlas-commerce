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

type AgentRpc = 'atlas_agent_get' | 'atlas_agent_put' | 'atlas_agent_list';
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

/** One bounded metadata request, with no decrypted titles or message bodies. */
export async function listAgentDraft(env: DraftEnv, username: string, fetcher: typeof fetch = fetch): Promise<Array<{ id: string; updated_at: string }>> {
  const account = await agentAccountId(username);
  const rows = await rpc(env, 'atlas_agent_list', { p_account: account, p_limit: 20 }, fetcher);
  if (!Array.isArray(rows) || rows.length > 20 || rows.some(row => !row || typeof row.id !== 'string' || !validThread(row.id) || typeof row.updated_at !== 'string' || !Number.isFinite(Date.parse(row.updated_at)))) throw new AgentStorageUnavailable();
  return rows.map(row => ({ id: row.id, updated_at: row.updated_at }));
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
export async function putAgentDraft(env: DraftEnv, username: string, thread: string, payload: string, version: string | null, fetcher: typeof fetch = fetch): Promise<string> {
  if (!validThread(thread) || (version !== null && !/^[1-9][0-9]{0,18}$/.test(version))) throw new AgentStorageUnavailable();
  const key = secret(env); const account = await agentAccountId(username);
  let ciphertext: string;
  try { ciphertext = await encryptAgentPayload(key, account, thread, payload); }
  catch { throw new AgentStorageUnavailable(); }
  const result = await rpc(env, 'atlas_agent_put', { p_account: account, p_thread: thread, p_payload: ciphertext, p_expected_version: version }, fetcher);
  if (result?.ok === false && result.conflict === true) throw new AgentStorageConflict();
  if (result?.ok !== true || typeof result.version !== 'string' || !/^[1-9][0-9]{0,18}$/.test(result.version)) throw new AgentStorageUnavailable();
  return result.version;
}
