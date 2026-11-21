/** Prevent a login/approval QR or URL from being sent to the inventory lookup URL. */
export function isSafeInventoryCode(code: string): boolean {
  const value = code.trim();
  if (!value || value.length > 200 || value.startsWith('{') || value.startsWith('[')) return false;
  if (Array.from(code).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) || /^www\./i.test(value)) return false;
  if (/^(?:atlas|otpauth|data|javascript):/i.test(value) || /(?:^|[?&#])(?:token|otp|code_verifier|state|rt)=/i.test(value)) return false;
  return true;
}
