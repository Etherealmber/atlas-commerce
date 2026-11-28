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
 * Bounded experimental worker that performs real image deletion but never acknowledges
 * completion: writer fencing and upload recovery are not implemented yet.
 * A rejected R2 call or failed lease release leaves the job durable for retry.
 */
export async function runAgentCleanupDraft(queue: Queue, bucket: Bucket): Promise<{ expired: number; claimed: number; failed: number }> {
  const expired = await queue.expire(50);
  const token = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
  const jobs = await queue.claim(token, 10);
  if (!Array.isArray(jobs) || jobs.length > 10) throw new Error('Invalid cleanup response');
  let failed = 0;
  for (const job of jobs) {
    try {
      await deleteAgentImagesDraft(bucket, job.account_id, job.thread_id, 10);
    } catch { failed++; }
    // Until writer fencing exists, even an empty prefix cannot prove that a
    // delayed upload won't create an orphan. Always retain the cleanup intent.
    try { if (!await queue.finish(job, token, false)) failed++; } catch { failed++; }
  }
  return { expired, claimed: jobs.length, failed };
}
