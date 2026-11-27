import { expect, it, vi } from 'vitest';
import { groqChat } from '../lib/assist';

it('sets low reasoning only for gpt-oss when explicitly requested', async () => {
  const fetchImpl = vi.fn(async (_url: any, init: any) => new Response(JSON.stringify({ choices: [{ message: { content: '{"fr":"test"}' } }] }), { status: 200 }));
  const common = { apiKey: 'test', system: 'test', message: 'test', maxTokens: 512, reasoningEffort: 'low' as const, fetchImpl: fetchImpl as any };
  await groqChat({ ...common, model: 'openai/gpt-oss-20b' });
  await groqChat({ ...common, model: 'llama-3.3-70b-versatile' });
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ max_tokens: 512, reasoning_effort: 'low' });
  expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).not.toHaveProperty('reasoning_effort');
});
