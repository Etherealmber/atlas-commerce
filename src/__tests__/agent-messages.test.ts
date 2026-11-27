import { describe, expect, it } from 'vitest';
import { finishAgentReply } from '../lib/agentMessages';

type Message = { role: 'user' | 'assistant'; text: string; streaming?: boolean; variants?: string[]; variantIndex?: number; failed?: boolean };
describe('Agent reply completion', () => {
  it('adds complete responses without fake animation', () => {
    const messages: Message[] = [{ role: 'user', text: 'hello' }];
    expect(finishAgentReply(messages, { role: 'assistant', text: 'Hello back' })).toEqual([...messages, { role: 'assistant', text: 'Hello back' }]);
  });
  it('replaces a retry in its original position even when later messages exist', () => {
    const messages: Message[] = [{ role: 'assistant', text: '', streaming: true, variants: ['old'] }, { role: 'user', text: 'later' }];
    expect(finishAgentReply(messages, { role: 'assistant', text: 'new' })).toEqual([
      { role: 'assistant', text: 'new', variants: ['old', 'new'], variantIndex: 1 }, { role: 'user', text: 'later' },
    ]);
  });
  it('replaces a failed retry placeholder with the error', () => {
    const messages: Message[] = [{ role: 'assistant', text: '', streaming: true }];
    expect(finishAgentReply(messages, { role: 'assistant', text: 'Unavailable', failed: true })[0]).toMatchObject({ text: 'Unavailable', failed: true });
  });
});
