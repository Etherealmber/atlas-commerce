import { expect, it, vi } from 'vitest';
import { runAgentCleanupDraft } from '../../experiments/agent-storage/cleanup';

it('acknowledges an empty fenced prefix and releases failures for retry', async () => {
  const jobs = [{ account_id: 'a'.repeat(64), thread_id: 'one', attempts: 1 }, { account_id: 'a'.repeat(64), thread_id: 'two', attempts: 1 }];
  const queue = { expire: vi.fn(async () => 2), claim: vi.fn(async () => jobs), finish: vi.fn(async () => true) };
  const bucket: any = { list: vi.fn(async ({ prefix }: any) => { if (prefix.includes('/two/')) throw new Error('R2 unavailable'); return { objects: [], truncated: false }; }), delete: vi.fn() };
  expect(await runAgentCleanupDraft(queue, bucket)).toEqual({ expired: 2, claimed: 2, failed: 1, pending: 1 });
  expect(queue.claim).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{32}$/), 10);
  expect(queue.finish).toHaveBeenCalledTimes(2);
  expect(queue.finish.mock.calls.map((call: any[]) => call[2])).toEqual([true, false]);
});

it('does not acknowledge a pending upload and releases the lease', async () => {
  const job = { account_id: 'a'.repeat(64), thread_id: 'one', attempts: 1 };
  const finish = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const queue = { expire: vi.fn(async () => 0), claim: vi.fn(async () => [job]), finish };
  const bucket: any = { list: vi.fn(async () => ({ objects: [], truncated: false })), delete: vi.fn() };
  expect(await runAgentCleanupDraft(queue, bucket)).toEqual({ expired: 0, claimed: 1, failed: 0, pending: 1 });
  expect(finish.mock.calls.map(call => call[2])).toEqual([true, false]);
});
