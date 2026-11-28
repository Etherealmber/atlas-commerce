import { describe, expect, it } from 'vitest';
import { encryptAgentPayload, decryptAgentPayload } from '../../experiments/agent-storage/crypto';

const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(42)));
describe('offline Agent storage encryption prototype', () => {
  it('round trips without plaintext and uses a fresh nonce', async () => {
    const a = await encryptAgentPayload(key, 'alice', 'thread-1', 'message privé');
    const b = await encryptAgentPayload(key, 'alice', 'thread-1', 'message privé');
    expect(a).not.toContain('message privé'); expect(a).not.toBe(b);
    expect(await decryptAgentPayload(key, 'alice', 'thread-1', a)).toBe('message privé');
  });
  it('rejects other users, threads, keys and modified ciphertext', async () => {
    const a = await encryptAgentPayload(key, 'alice', 'thread-1', 'hello');
    await expect(decryptAgentPayload(key, 'bob', 'thread-1', a)).rejects.toThrow();
    await expect(decryptAgentPayload(key, 'alice', 'thread-2', a)).rejects.toThrow();
    await expect(decryptAgentPayload(btoa(String.fromCharCode(...new Uint8Array(32).fill(4))), 'alice', 'thread-1', a)).rejects.toThrow();
    const value = JSON.parse(a); value.ciphertext = btoa('not authentic ciphertext');
    await expect(decryptAgentPayload(key, 'alice', 'thread-1', JSON.stringify(value))).rejects.toThrow();
  });
  it('rejects malformed keys, formats, and oversized payloads', async () => {
    await expect(encryptAgentPayload('bad', 'alice', 't', 'x')).rejects.toThrow();
    await expect(encryptAgentPayload(key, 'alice', 't', 'x'.repeat(1_500_001))).rejects.toThrow();
    await expect(decryptAgentPayload(key, 'alice', 't', '{"v":2}')).rejects.toThrow();
  });
});
