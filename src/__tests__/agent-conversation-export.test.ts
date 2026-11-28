// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { downloadAgentConversation, formatAgentConversation } from '../lib/agentConversationExport';

describe('Agent visible conversation export', () => {
  it('produces plain text, explains exclusions and does not export streaming messages', () => {
    const text = formatAgentConversation([{ role: 'user', text: 'Bonjour <ami>' }, { role: 'assistant', text: 'Salut' }, { role: 'assistant', text: 'unfinished', streaming: true }]);
    expect(text).toContain('Bonjour <ami>'); expect(text).toContain('Salut');
    expect(text).not.toContain('unfinished'); expect(text).toContain('pièces jointes'); expect(text).toContain('non synchronisées');
    expect(() => formatAgentConversation([{ role: 'assistant', text: 'Welcome' }])).toThrow('Aucune conversation');
  });
  it('downloads a private text blob with a generic filename', () => {
    vi.useFakeTimers();
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { expect(this.download).toBe('atlas-agent-conversation.txt'); expect(this.href).toBe('blob:test'); });
    try {
      downloadAgentConversation([{ role: 'user', text: 'Private text' }]);
      expect(create).toHaveBeenCalledOnce(); expect((create.mock.calls[0][0] as Blob).type).toContain('text/plain'); expect(click).toHaveBeenCalledOnce();
      expect(revoke).not.toHaveBeenCalled(); vi.runAllTimers(); expect(revoke).toHaveBeenCalledWith('blob:test');
    } finally { vi.restoreAllMocks(); vi.useRealTimers(); }
  });
});
