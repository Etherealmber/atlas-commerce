import { describe, expect, it, vi } from 'vitest';
import { schemaOnce, schemaOnceForDb } from '../lib/schema';

const db = () => ({ prepare: () => ({}) } as unknown as D1Database);
describe('request-owned initialization', () => {
  it('does not await a stuck request and caches only successful work', async () => {
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const first = schemaOnce('cross-request-test', () => blocked);
    const run = vi.fn(async () => {});
    await schemaOnce('cross-request-test', run);
    expect(run).toHaveBeenCalledOnce();
    await schemaOnce('cross-request-test', run);
    expect(run).toHaveBeenCalledOnce();
    release(); await first;
  });
  it('retries failed initialization and separates DB bindings', async () => {
    const a = db(); const b = db(); const run = vi.fn(async () => {});
    await expect(schemaOnceForDb(a, 'test', async () => { throw new Error('failed'); })).rejects.toThrow('failed');
    await schemaOnceForDb(a, 'test', run); await schemaOnceForDb(a, 'test', run); await schemaOnceForDb(b, 'test', run);
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('does not overlap potentially destructive legacy migrations', async () => {
    const database = db(); let release!: () => void;
    const first = schemaOnceForDb(database, 'offline_ops_schema_v20', () => new Promise<void>(resolve => { release = resolve; }));
    const run = vi.fn(async () => {});
    await expect(schemaOnceForDb(database, 'offline_ops_schema_v20', run)).rejects.toThrow('busy');
    expect(run).not.toHaveBeenCalled(); release(); await first;
    await schemaOnceForDb(database, 'offline_ops_schema_v20', run); expect(run).not.toHaveBeenCalled();
  });
});

it('omits undefined R2 options in the demo bucket while preserving pagination', async () => {
  const { prefixedBucket } = await import('../lib/demo/demoEnv');
  const list = vi.fn(async (options: any) => {
    expect(Object.hasOwn(options, 'startAfter')).toBe(false);
    if (options.cursor === undefined) expect(Object.hasOwn(options, 'cursor')).toBe(false);
    return { objects: [], truncated: false, delimitedPrefixes: [] };
  });
  const wrapped = prefixedBucket({ list } as any, 'demo/');
  await wrapped.list({ prefix: 'agent/', cursor: undefined } as any);
  await wrapped.list({ prefix: 'agent/', cursor: 'next' });
  expect(list.mock.calls[0][0].prefix).toBe('demo/agent/');
  expect(list.mock.calls[1][0].cursor).toBe('next');
});
