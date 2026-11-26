import { describe, expect, it, vi } from 'vitest';
import { writeAudit } from '../lib/authHelpers';

describe('audit write availability', () => {
  it('reports a storage failure without leaking record contents or breaking the business flow', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const db = { prepare() { throw new Error('private D1 failure'); } } as unknown as D1Database;
      await expect(writeAudit(db, { action: 'private-action', username: 'private-user', ip: '203.0.113.7', detail: 'private-detail' })).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledWith('audit_journal_write_failed');
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|203\.0\.113/);
    } finally { log.mockRestore(); }
  });
});
