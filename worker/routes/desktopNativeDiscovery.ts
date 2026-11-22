import { Hono } from 'hono';
import { pilotLoginConfigured } from '../lib/desktop-native-session';

/**
 * Discovery alone enables nothing. Phone and staging password pilots each
 * require their own independent gates and runtime dependencies.
 */
export const DESKTOP_NATIVE_V2_CAPABILITIES = '/api/auth/desktop/v2/capabilities';

export function registerDesktopNativeDiscovery(app: Hono<any>): void {
  app.get(DESKTOP_NATIVE_V2_CAPABILITIES, c => {
    c.header('Cache-Control', 'no-store');
    c.header('CDN-Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    const url = new URL(c.req.url);
    const originHeader = c.req.header('Origin');
    if (url.protocol !== 'https:') {
      return c.json({ success: false, code: 'HTTPS_REQUIRED', error: 'HTTPS requis.' }, 400);
    }
    if (url.search || (originHeader !== undefined && originHeader !== url.origin)) {
      return c.json({ success: false, code: 'INVALID_REQUEST', error: 'Requête invalide.' }, 400);
    }
    return c.json({ success: true, data: {
      version: 2,
      discovery_enabled: c.env.DESKTOP_NATIVE_V2_DISCOVERY === 'true',
      methods: {
        phone_approval: c.env.DESKTOP_NATIVE_V2_DISCOVERY === 'true' && c.env.DESKTOP_NATIVE_V2_PHONE_APPROVAL === 'true' && typeof c.env.DB?.prepare === 'function' && typeof c.env.DB?.batch === 'function'
          ? { available: true, version: 2, code_challenge_method: 'S256', expires_in: 300, interval: 5, max_polls: 60, requires_phone_client: true }
          : { available: false, reason: 'METHOD_DISABLED' },
        password_otp: pilotLoginConfigured(c.env) && url.origin === c.env.DESKTOP_NATIVE_V2_PILOT_ORIGIN
          ? { available: true, version: 2, experimental: true, staging_only: true, challenge: 'system_browser_turnstile', otp_required: true, challenge_presentation: { hosted_path: '/login/desktop-challenge', webview2: 'unverified_requires_client_validation', system_browser: 'explicit_choice_only', same_ip_required: true, server_verified: true } }
          : { available: false, reason: 'NATIVE_ABUSE_VERIFIER_UNAVAILABLE' },
        windows_passkey: { available: false, reason: 'NATIVE_ASSOCIATION_UNVERIFIED' },
      },
      browser_fallback: { version: 1, capabilities_path: '/api/auth/desktop/v1/capabilities', automatic: false },
    } });
  });
}
