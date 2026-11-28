import { describe, expect, it, vi } from 'vitest';
import { agentAccountId, AgentStorageConflict, getAgentDraft, listAgentDraft, putAgentDraft } from '../lib/agentSupabaseDraft';

const env: any = { SUPABASE_JOURNAL_URL: 'https://project.supabase.co', SUPABASE_JOURNAL_SECRET_KEY: 'sb_secret_test', AGENT_HISTORY_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(42))) };
describe('staging-only encrypted Agent Supabase adapter', () => {
  it('round trips an opaque payload with a conditional version and scopes the authenticated user', async () => {
    let stored: any;
    const fetcher = vi.fn(async (url: any, init: any) => {
      const body = JSON.parse(init.body);
      expect(init.headers.Authorization).toBeUndefined();
      if (String(url).endsWith('atlas_agent_put')) { stored = body; return Response.json({ ok: true, version: '1' }); }
      return Response.json({ payload: stored.p_payload, version: '1' });
    }) as any;
    expect(await putAgentDraft(env, 'alice', 't1', 'private conversation', null, fetcher)).toBe('1');
    expect(stored.p_account).toBe(await agentAccountId('alice'));
    expect(stored.p_expected_version).toBeNull();
    expect(stored.p_payload).not.toContain('private conversation');
    expect(await getAgentDraft(env, 'alice', 't1', fetcher)).toEqual({ payload: 'private conversation', version: '1' });
    await expect(getAgentDraft(env, 'bob', 't1', fetcher)).rejects.toThrow('Agent history unavailable');
  });
  it('fails closed on conflict, errors and missing configuration', async () => {
    const conflict = vi.fn(async () => Response.json({ ok: false, conflict: true })) as any;
    await expect(putAgentDraft(env, 'alice', 't1', 'x', '1', conflict)).rejects.toBeInstanceOf(AgentStorageConflict);
    const failure = vi.fn(async () => new Response('private server error', { status: 503 })) as any;
    await expect(getAgentDraft(env, 'alice', 't1', failure)).rejects.toThrow('Agent history unavailable');
    const fetcher = vi.fn();
    await expect(putAgentDraft({ ...env, AGENT_HISTORY_ENCRYPTION_KEY: '' }, 'alice', 't1', 'x', null, fetcher as any)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    expect(await agentAccountId('a@b')).not.toBe(await agentAccountId('a_b'));
  });
});

it('lists only bounded, validated metadata from the authenticated account', async () => {
  const fetcher = vi.fn(async (_url: any, init: any) => {
    expect(JSON.parse(init.body)).toEqual({ p_account: await agentAccountId('alice'), p_limit: 20 });
    return Response.json([{ id: 't1', updated_at: '2026-10-20T00:00:00Z', private: 'ignored' }]);
  }) as any;
  expect(await listAgentDraft(env, 'alice', fetcher)).toEqual([{ id: 't1', updated_at: '2026-10-20T00:00:00Z' }]);
  const bad = vi.fn(async () => Response.json([{ id: '../private', updated_at: 'bad' }])) as any;
  await expect(listAgentDraft(env, 'alice', bad)).rejects.toThrow('Agent history unavailable');
});
