import { describe, expect, it } from 'vitest';
import { isSafeInventoryCode } from '../mobile/phoneScan';

describe('inventory scanner input', () => {
  it.each(['1234567890123', 'SKU-123_45', 'ABC/123'])('accepts product code %s', (code) => {
    expect(isSafeInventoryCode(code)).toBe(true);
  });
  it.each(['https://example.org/login/qr?token=secret', 'atlascommerce://login?token=secret', 'otpauth://totp/test', '{"token":"secret"}', '?token=secret', 'a\nb'])('rejects auth links and structured payloads without submitting them', (code) => {
    expect(isSafeInventoryCode(code)).toBe(false);
  });
});
