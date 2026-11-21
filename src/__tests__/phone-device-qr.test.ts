import { describe, expect, it } from 'vitest';
import { deviceApprovalPath } from '../mobile/phoneDeviceQr';

const origin = 'https://store.example:8443';
const id = 'a'.repeat(64);
describe('mobile device scanner QR validation', () => {
  it('opens only the desktop v2 approval on the exact origin and port', () => {
    expect(deviceApprovalPath(`${origin}/login/desktop-phone#request_id=${id}`, origin)).toBe(`/login/desktop-phone#request_id=${id}`);
  });
  it.each([
    `https://store.example/login/desktop-phone#request_id=${id}`,
    `https://evil.example:8443/login/desktop-phone#request_id=${id}`,
    `https://user@store.example:8443/login/desktop-phone#request_id=${id}`,
    `${origin}/login/qr?t=secret`,
    `${origin}/login/desktop-phone?token=secret#request_id=${id}`,
    `${origin}/login/desktop-phone#request_id=${id}&state=secret`,
    `${origin}/login/desktop-phone#request_id=${id}&request_id=${id}`,
    `${origin}/login/desktop-phone#request_id=bad`,
    'javascript:alert(1)',
  ])('rejects unsafe or incompatible QR %s', raw => expect(deviceApprovalPath(raw, origin)).toBeNull());
});
