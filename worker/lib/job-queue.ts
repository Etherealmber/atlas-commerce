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

