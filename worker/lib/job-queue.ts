/**
 * Lightweight async job helper for Workers.
 * Prefer c.executionCtx.waitUntil for fire-and-forget.
 * Optional KV ledger for dedupe (job id) — not Redis/SQS; same role at edge scale.
 *
 * Usage:
 *   enqueue(c.executionCtx, () => sendEmail(...));
 *   await enqueueOnce(env.CACHE, 'mail:inv:123', 3600, () => ...);
 */

export function enqueue(ctx: { waitUntil: (p: Promise<unknown>) => void } | undefined, work: () => Promise<unknown>): void {
  const p = Promise.resolve()
    .then(work)
    .catch((e) => {
      console.error('job-queue', e?.message || e);
    });
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(p);
  }
}

/** Run at most once per key within TTL seconds (KV). */
export async function enqueueOnce(
  kv: KVNamespace | undefined,
  jobId: string,
  ttlSeconds: number,
  work: () => Promise<unknown>,
  ctx?: { waitUntil: (p: Promise<unknown>) => void },
): Promise<boolean> {
  if (kv) {
    const existing = await kv.get(`job:${jobId}`);
    if (existing) return false;
    await kv.put(`job:${jobId}`, '1', { expirationTtl: Math.max(60, ttlSeconds) });
  }
  enqueue(ctx, work);
  return true;
}
