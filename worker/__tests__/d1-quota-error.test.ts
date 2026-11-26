import { describe, expect, it } from 'vitest';
import { toClientError } from '../lib/errors';

describe('D1 quota error handling', () => {
  it.each(['read', 'write'])('recognizes the documented %s limit without exposing raw errors', (operation) => {
    const result = toClientError(new Error(`D1_ERROR: Your account has exceeded D1's free tier daily row ${operation} limit. SQL secret`), { log: false });
    expect(result).toMatchObject({ status: 503, code: 'DB_QUOTA_EXCEEDED' });
    expect(result.error).toContain('minuit UTC');
    expect(result.error).not.toContain('SQL secret');
  });
  it('does not guess quota on unrelated D1 failures', () => {
    expect(toClientError(new Error('D1_ERROR: network connection lost'), { log: false }).code).toBe('INTERNAL');
  });
});
