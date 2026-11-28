// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { clearPendingPhoneReply, readPendingPhoneReply, savePendingPhoneReply } from '../mobile/agentPhonePending';
const record = { threadId: 'mobile-123', prepared: { storage: 'supabase', version: '1', title: 'Bonjour', messages: [{ role: 'user' as const, text: 'Bonjour' }] }, reply: 'Salut' };
afterEach(() => localStorage.clear());
it('preserves account-scoped pending reply until a matching acknowledgement', () => {
  const raw = savePendingPhoneReply(localStorage, 'alice:pending', record);
  expect(readPendingPhoneReply(localStorage, 'alice:pending', 'supabase')).toEqual({ kind: 'pending', record, serialized: raw });
  expect(readPendingPhoneReply(localStorage, 'bob:pending', 'supabase')).toEqual({ kind: 'none' });
  expect(readPendingPhoneReply(localStorage, 'alice:pending', 'supabase-preview')).toEqual({ kind: 'invalid' });
  expect(() => savePendingPhoneReply(localStorage, 'alice:pending', record)).toThrow();
  expect(clearPendingPhoneReply(localStorage, 'alice:pending', 'wrong')).toBe(false);
  expect(localStorage.getItem('alice:pending')).toBe(raw);
  expect(clearPendingPhoneReply(localStorage, 'alice:pending', raw)).toBe(true);
});
it('fails closed on corrupt or rich pending messages without deleting them', () => {
  const raw = JSON.stringify({ ...record, prepared: { ...record.prepared, messages: [{ role: 'user', text: 'Bonjour', images: ['not allowed'] }] } });
  localStorage.setItem('pending', raw);
  expect(readPendingPhoneReply(localStorage, 'pending', 'supabase')).toEqual({ kind: 'invalid' });
  expect(localStorage.getItem('pending')).toBe(raw);
});
