/** Isolated cleanup runner; not scheduled or connected to production. */
import { deleteAgentImagesDraft } from './images';

type Job = { account_id: string; thread_id: string; attempts: number };
type Queue = {
  expire(limit: number): Promise<number>;
  claim(token: string, limit: number): Promise<Job[]>;
  finish(job: Job, token: string, complete: boolean): Promise<boolean>;
};
type Bucket = Pick<R2Bucket, 'put' | 'get' | 'list' | 'delete'>;

/**
 * Experimental worker: performs real R2 deletion, never scheduled here.
 * Only safe when ALL writers use the durable SQL upload fence and only the
 * SQL finish RPC can acknowledge completion. Unknown uploads retain intents.
 */
export async function runAgentCleanupDraft(queue: Queue, bucket: Bucket): Promise<{ expired: number; claimed: number; failed: number; pending: number }> {
  const expired = await queue.expire(50);
  const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  const jobs = await queue.claim(token, 10);
  if (!Array.isArray(jobs) || jobs.length > 10) throw new Error('Invalid cleanup response');
  let failed = 0; let pending = 0;
  for (const job of jobs) {
    let empty = false;
    try { empty = (await deleteAgentImagesDraft(bucket, job.account_id, job.thread_id, 10)).complete; }
    catch { failed++; }
    try {
      // The DB refuses completion while any upload intent exists. If a batch
      // is unfinished or fenced, release the lease with a retry delay.
      const finished = empty && await queue.finish(job, token, true);
      if (!finished) {
        pending++;
        if (!await queue.finish(job, token, false)) failed++;
      }
    } catch { failed++; }
  }
  return { expired, claimed: jobs.length, failed, pending };
}
