import type { Env } from '../env';
import { agentCleanupQueueDraft, useAgentSupabaseStorage } from './agentSupabaseDraft';
import { runAgentCleanupDraft } from '../../experiments/agent-storage/cleanup';

/** Bounded cron pass. Missing/uncertain work stays queued; no legacy R2 scan. */
export async function runScheduledAgentCleanup(env: Env): Promise<{ skipped: true } | { skipped: false; expired: number; claimed: number; failed: number; pending: number }> {
  if (!useAgentSupabaseStorage(env)) return { skipped: true };
  if (!env.IMAGES) throw new Error('Agent image storage unavailable');
  return { skipped: false, ...await runAgentCleanupDraft(agentCleanupQueueDraft(env), env.IMAGES) };
}
