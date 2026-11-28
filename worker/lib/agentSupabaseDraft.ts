/** Supabase Agent adapter. Production requires explicit configuration and provisioning. */
import type { Env } from '../env';
import { supabaseJournalConfig } from './journalSupabase';
import { decryptAgentPayload, encryptAgentPayload } from '../../experiments/agent-storage/crypto';

export class AgentStorageUnavailable extends Error {
  constructor() { super('Agent history unavailable'); }
}
export class AgentStorageConflict extends Error {
  constructor() { super('Agent history conflict'); }
}

type AgentRpc = 'atlas_agent_get' | 'atlas_agent_put' | 'atlas_agent_list' | 'atlas_agent_tombstone' | 'atlas_agent_transcript_get' | 'atlas_agent_transcript_put' | 'atlas_agent_expire' | 'atlas_agent_cleanup_claim' | 'atlas_agent_cleanup_finish' | 'atlas_agent_upload_begin' | 'atlas_agent_upload_finish';
type DraftEnv = Env;

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

/** Explicit production opt-in; demo remains isolated. No R2 fallback on failure. */
export function useAgentSupabaseStorage(env: any): boolean {
  return useAgentStoragePreview(env) || (env?.ENVIRONMENT === 'production' && env?.AGENT_HISTORY_STORAGE === 'supabase' && env?.ATLAS_DEMO !== '1');
}
export function agentSupabaseStorageLabel(env: any): 'supabase' | 'supabase-preview' {
  return useAgentStoragePreview(env) ? 'supabase-preview' : 'supabase';
}

/** Independent encrypted model-context revision, never falls back to R2. */
export async function getAgentTranscriptDraft(env: DraftEnv, username: string, thread: string, fetcher: typeof fetch = fetch): Promise<{ payload: string; version: string } | null> {
  if (!validThread(thread)) throw new AgentStorageUnavailable();
  const key = secret(env); const account = await agentAccountId(username);
  const row = await rpc(env, 'atlas_agent_transcript_get', { p_account: account, p_thread: thread }, fetcher);
  if (row === null) return null;
  if (!row || typeof row.payload !== 'string' || typeof row.version !== 'string' || !/^[1-9][0-9]{0,18}$/.test(row.version)) throw new AgentStorageUnavailable();
  try { return { payload: await decryptAgentPayload(key, `${account}:transcript`, thread, row.payload), version: row.version }; }
  catch { throw new AgentStorageUnavailable(); }
}

export async function putAgentTranscriptDraft(env: DraftEnv, username: string, thread: string, payload: string, version: string | null, fetcher: typeof fetch = fetch): Promise<string> {
  if (!validThread(thread) || (version !== null && !/^[1-9][0-9]{0,18}$/.test(version))) throw new AgentStorageUnavailable();
  const key = secret(env); const account = await agentAccountId(username);
  let ciphertext: string;
  try { ciphertext = await encryptAgentPayload(key, `${account}:transcript`, thread, payload); }
  catch { throw new AgentStorageUnavailable(); }
  const result = await rpc(env, 'atlas_agent_transcript_put', { p_account: account, p_thread: thread, p_payload: ciphertext, p_expected_version: version }, fetcher);
  if (result?.ok === false && result.conflict === true) throw new AgentStorageConflict();
  if (result?.ok !== true || typeof result.version !== 'string' || !/^[1-9][0-9]{0,18}$/.test(result.version)) throw new AgentStorageUnavailable();
  return result.version;
}

/**
 * Prepare the parent required by a first model turn. Create-only CAS prevents
 * overwriting an existing snapshot or reviving a deleted/expired thread. A
 * concurrent successful creator is accepted only after a fresh readable get.
 * This helper is not connected to live or preview chat routes yet.
 */
export async function ensureAgentParentDraft(env: DraftEnv, username: string, thread: string, fetcher: typeof fetch = fetch): Promise<void> {
  if (await getAgentDraft(env, username, thread, fetcher)) return;
  const snapshot = { title: 'Sans titre', messages: [], updated_at: new Date().toISOString() };
  try {
    await putAgentDraft(env, username, thread, JSON.stringify(snapshot), null, { title: snapshot.title, message_count: 0 }, fetcher);
  } catch (error) {
    if (!(error instanceof AgentStorageConflict)) throw error;
    if (!(await getAgentDraft(env, username, thread, fetcher))) throw error;
  }
}

/** Worker-only queue bridge for isolated testing; not installed as a cron. */
export function agentCleanupQueueDraft(env: DraftEnv, fetcher: typeof fetch = fetch) {
  const validToken = (token: string) => /^[a-f0-9]{32,64}$/.test(token);
  return {
    async expire(limit: number): Promise<number> {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AgentStorageUnavailable();
      const result = await rpc(env, 'atlas_agent_expire', { p_limit: limit }, fetcher);
      if (!Number.isInteger(result) || result < 0 || result > limit) throw new AgentStorageUnavailable();
      return result;
    },
    async claim(token: string, limit: number): Promise<Array<{ account_id: string; thread_id: string; attempts: number }>> {
      if (!validToken(token) || !Number.isInteger(limit) || limit < 1 || limit > 25) throw new AgentStorageUnavailable();
      const result = await rpc(env, 'atlas_agent_cleanup_claim', { p_token: token, p_limit: limit }, fetcher);
      if (!Array.isArray(result) || result.length > limit || result.some(job => !job || typeof job.account_id !== 'string' || !/^[a-f0-9]{64}$/.test(job.account_id) || typeof job.thread_id !== 'string' || !validThread(job.thread_id) || !Number.isSafeInteger(job.attempts) || job.attempts < 1)) throw new AgentStorageUnavailable();
      return result.map(job => ({ account_id: job.account_id, thread_id: job.thread_id, attempts: job.attempts }));
    },
    async finish(job: { account_id: string; thread_id: string }, token: string, complete: boolean): Promise<boolean> {
      if (!/^[a-f0-9]{64}$/.test(job.account_id) || !validThread(job.thread_id) || !validToken(token) || typeof complete !== 'boolean') throw new AgentStorageUnavailable();
      const result = await rpc(env, 'atlas_agent_cleanup_finish', { p_account: job.account_id, p_thread: job.thread_id, p_token: token, p_complete: complete }, fetcher);
      if (typeof result !== 'boolean') throw new AgentStorageUnavailable();
      return result;
    },
  };
}

/** SQL-backed upload fence for isolated testing; accounts are server-derived. */
export function agentUploadFenceDraft(env: DraftEnv, fetcher: typeof fetch = fetch) {
  async function invoke(name: 'atlas_agent_upload_begin' | 'atlas_agent_upload_finish', account: string, thread: string, imageId: string, removed?: boolean): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/.test(account) || !validThread(thread) || !/^[a-f0-9]{32}$/.test(imageId)) throw new AgentStorageUnavailable();
    const result = await rpc(env, name, { p_account: account, p_thread: thread, p_image: imageId, ...(removed === undefined ? {} : { p_removed: removed }) }, fetcher);
    if (typeof result !== 'boolean') throw new AgentStorageUnavailable();
    return result;
  }
  return {
    begin: (account: string, thread: string, imageId: string) => invoke('atlas_agent_upload_begin', account, thread, imageId),
    finish: (account: string, thread: string, imageId: string, removed: boolean) => invoke('atlas_agent_upload_finish', account, thread, imageId, removed),
  };
}
