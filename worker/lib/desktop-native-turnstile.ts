/**
 * Strict verifier for the staging-only browser challenge ceremony. Its result
 * is transaction-bound and may be consumed by the separately gated staging
 * password/OTP pilot. The relay risk requires review before production use.
 * Never pass user-supplied host/action/cData as the expected values.
 */
export async function verifyDesktopTurnstile(input: {
  token: string;
  secret: string;
  hostname: string;
  action: string;
  cdata: string;
}, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const { token, secret, hostname, action, cdata } = input;
  if (!token || token.length > 2048 || !secret || secret.length > 2048 ||
      !hostname || hostname.length > 253 || !/^[A-Za-z0-9_-]{1,32}$/.test(action) ||
      !/^[A-Za-z0-9_-]{1,255}$/.test(cdata)) return false;

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const verify = async () => {
      const body = new URLSearchParams({ secret, response: token });
      const response = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body, signal: controller.signal, redirect: 'error',
      });
      if (!response.ok) return false;
      const result = await response.json() as { success?: unknown; hostname?: unknown; action?: unknown; cdata?: unknown };
      return result?.success === true && typeof result.hostname === 'string' &&
        result.hostname.toLowerCase() === hostname.toLowerCase() &&
        result.action === action && result.cdata === cdata;
    };
    return await Promise.race([
      verify(),
      new Promise<boolean>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(false); }, 5000); }),
    ]);
  } catch {
    // Deliberately fail closed; do not log tokens, secrets, provider bodies, or exceptions.
    return false;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
