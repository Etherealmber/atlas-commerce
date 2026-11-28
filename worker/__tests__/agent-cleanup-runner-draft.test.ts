import { expect, it, vi } from 'vitest';
import { runAgentCleanupDraft } from '../../experiments/agent-storage/cleanup';

it('keeps cleanup intent even after empty listing, and releases failures for retry', async () => {
  const jobs = [{ account_id: 'a'.repeat(64), thread_id: 'one', attempts: 1 }, { account_id: 'a'.repeat(64), thread_id: 'two', attempts: 1 }];
  const queue = { expire: vi.fn(async () => 2), claim: vi.fn(async () => jobs), finish: vi.fn(async () => true) };
  const bucket: any = { list: vi.fn(async ({ prefix }: any) => { if (prefix.includes('/two/')) throw new Error('R2 unavailable'); return { objects: [], truncated: false }; }), delete: vi.fn() };
  expect(await runAgentCleanupDraft(queue, bucket)).toEqual({ expired: 2, claimed: 2, failed: 1 });
  expect(queue.claim).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{32}$/), 10);
  expect(queue.finish).toHaveBeenCalledTimes(2);
  for (const call of queue.finish.mock.calls as any[]) expect(call[2]).toBe(false);
});
