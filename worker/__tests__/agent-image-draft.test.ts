import { describe, expect, it, vi } from 'vitest';
import { deleteAgentImagesDraft, getAgentImageDraft, putAgentImageDraft } from '../../experiments/agent-storage/images';

const account = 'a'.repeat(64); const other = 'b'.repeat(64);
const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(42)));
const image = 'data:image/png;base64,aGVsbG8=';
const fence = { begin: async () => true, finish: async () => true };
function fakeBucket() {
  const objects = new Map<string, string>();
  const bucket = {
    put: vi.fn(async (path: string, value: string) => { objects.set(path, value); return {}; }),
    get: vi.fn(async (path: string) => { const value = objects.get(path); return value === undefined ? null : { size: value.length, text: async () => value }; }),
    list: vi.fn(async ({ prefix, limit }: any) => { const paths = [...objects.keys()].filter(k => k.startsWith(prefix)); return { objects: paths.slice(0, limit).map(path => ({ key: path })), truncated: paths.length > limit }; }),
    delete: vi.fn(async (paths: string | string[]) => { for (const path of Array.isArray(paths) ? paths : [paths]) objects.delete(path); }),
  };
  return { bucket: bucket as any, mock: bucket, objects };
}
describe('isolated Agent image prototype', () => {
  it('encrypts data and binds ciphertext to account, thread and image id', async () => {
    const { bucket, objects } = fakeBucket();
    const id = await putAgentImageDraft(bucket, fence, key, account, 'thread', image);
    const path = `agent-images/v1/${account}/thread/${id}`;
    expect(objects.get(path)).not.toContain('aGVsbG8=');
    expect(await getAgentImageDraft(bucket, key, account, 'thread', id)).toBe(image);
    const anotherId = 'f'.repeat(32);
    objects.set(`agent-images/v1/${other}/thread/${id}`, objects.get(path)!);
    objects.set(`agent-images/v1/${account}/other/${id}`, objects.get(path)!);
    objects.set(`agent-images/v1/${account}/thread/${anotherId}`, objects.get(path)!);
    await expect(getAgentImageDraft(bucket, key, other, 'thread', id)).rejects.toThrow();
    await expect(getAgentImageDraft(bucket, key, account, 'other', id)).rejects.toThrow();
    await expect(getAgentImageDraft(bucket, key, account, 'thread', anotherId)).rejects.toThrow();
  });
  it('rejects malformed, oversized and path-traversal inputs without writing', async () => {
    const { bucket, mock } = fakeBucket();
    for (const data of ['data:text/html;base64,YQ==', 'data:image/png;base64,@@', 'data:image/png;base64,' + 'A'.repeat(1_400_000)])
      await expect(putAgentImageDraft(bucket, fence, key, account, 'thread', data)).rejects.toThrow();
    await expect(putAgentImageDraft(bucket, fence, key, account, '../thread', image)).rejects.toThrow();
    expect(mock.put).not.toHaveBeenCalled();
  });
  it('deletes in bounded retryable batches without touching another thread', async () => {
    const { bucket, objects, mock } = fakeBucket();
    for (let n = 0; n < 205; n++) objects.set(`agent-images/v1/${account}/thread/${n}`, 'cipher');
    const otherPath = `agent-images/v1/${account}/thread2/image`; objects.set(otherPath, 'cipher');
    expect(await deleteAgentImagesDraft(bucket, account, 'thread', 2)).toEqual({ complete: false, deleted: 200 });
    mock.delete.mockRejectedValueOnce(new Error('R2 unavailable'));
    await expect(deleteAgentImagesDraft(bucket, account, 'thread')).rejects.toThrow();
    expect(await deleteAgentImagesDraft(bucket, account, 'thread')).toEqual({ complete: true, deleted: 5 });
    expect(objects.has(otherPath)).toBe(true);
    expect(await deleteAgentImagesDraft(bucket, account, 'thread')).toEqual({ complete: true, deleted: 0 });
  });
});

it('fences upload against deletion and retains uncertain writes', async () => {
  const { bucket, mock, objects } = fakeBucket();
  const racing = { begin: vi.fn(async () => true), finish: vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true) };
  await expect(putAgentImageDraft(bucket, racing, key, account, 'thread', image)).rejects.toThrow('Conversation unavailable');
  expect(objects.size).toBe(0);
  expect(racing.finish.mock.calls.map((call: any[]) => call[3])).toEqual([false, true]);
  const uncertain = { begin: vi.fn(async () => true), finish: vi.fn(async () => true) };
  mock.put.mockRejectedValueOnce(new Error('unknown PUT outcome'));
  await expect(putAgentImageDraft(bucket, uncertain, key, account, 'thread', image)).rejects.toThrow();
  expect(uncertain.finish).not.toHaveBeenCalled();
  const denied = { begin: vi.fn(async () => false), finish: vi.fn(async () => true) };
  const puts = mock.put.mock.calls.length;
  await expect(putAgentImageDraft(bucket, denied, key, account, 'thread', image)).rejects.toThrow();
  expect(mock.put).toHaveBeenCalledTimes(puts);
});
