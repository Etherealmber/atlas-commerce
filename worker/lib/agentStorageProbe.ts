import type { Env } from '../env';
import { decryptAgentPayload, encryptAgentPayload } from '../../experiments/agent-storage/crypto';
import { getAgentDraft } from './agentSupabaseDraft';

/** No persistent writes, no actual account identifiers, no returned secrets. */
export async function probeAgentStorage(env: Env, fetcher: typeof fetch = fetch): Promise<{ key_self_test: 'pass' | 'fail'; read_rpc: 'pass' | 'fail' | 'not_checked' }> {
  const key = String(env.AGENT_HISTORY_ENCRYPTION_KEY || '');
  try {
    const cipher = await encryptAgentPayload(key, 'atlas-probe', 'probe', 'atlas-test');
    if (await decryptAgentPayload(key, 'atlas-probe', 'probe', cipher) !== 'atlas-test') throw new Error('encryption');
  } catch { return { key_self_test: 'fail', read_rpc: 'not_checked' }; }
  try {
    // Random probe account is deliberately unrelated to any real user. Reading
    // a missing row never creates state, even when the production mode is off.
    const row = await getAgentDraft(env, `atlas-probe-${crypto.randomUUID()}`, 'probe', fetcher);
    if (row !== null) throw new Error('unexpected row');
    return { key_self_test: 'pass', read_rpc: 'pass' };
  } catch { return { key_self_test: 'pass', read_rpc: 'fail' }; }
}
