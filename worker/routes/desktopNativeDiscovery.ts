import { Hono } from 'hono';
import { pilotLoginConfigured } from '../lib/desktop-native-session';
import { desktopV3Readiness } from '../lib/desktop-v3-session';
import { expectedOrigin, policyFromEnv } from '../lib/webauthn';

/**
 * Discovery alone enables nothing. Phone, staging password pilots, and v3 each
 * require their own independent gates and runtime dependencies.
 */
export const DESKTOP_NATIVE_V2_CAPABILITIES = '/api/auth/desktop/v2/capabilities';
export const DESKTOP_NATIVE_V3_CAPABILITIES = '/api/auth/desktop/v3/capabilities';

export function registerDesktopNativeDiscovery(app: Hono<any>): void {
  // Production v3 stays disabled unless all server gates, dedicated mail
  // transport, Turnstile keys, MAC keys, and production approval are ready.
  app.get(DESKTOP_NATIVE_V3_CAPABILITIES, c => {
    c.header('Cache-Control', 'no-store');
    c.header('CDN-Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    const url = new URL(c.req.url);
    const originHeader = c.req.header('Origin');
    if (url.protocol !== 'https:') return c.json({ success: false, code: 'HTTPS_REQUIRED', error: 'HTTPS requis.' }, 400);
    if (url.search || (originHeader !== undefined && originHeader !== url.origin)) return c.json({ success: false, code: 'INVALID_REQUEST', error: 'Requête invalide.' }, 400);
    const gate = desktopV3Readiness(c.env);
    if (!gate.ready) {
      return c.json({
        success: true,
        data: {
          version: 3,
          enabled: false,
          reason: gate.reason,
          methods: { password_otp: { available: false }, mailbox_enrollment: { available: false }, recovery: { available: false }, device_proof: { available: false } },
          browser_fallback: { version: 1, capabilities_path: '/api/auth/desktop/v1/capabilities', automatic: false },
        },
      });
    }
    const native = c.env.DESKTOP_NATIVE_V3_NATIVE_LOGIN === 'true';
    const passkeyPolicy = policyFromEnv(c.env);
    const V3 = '/api/auth/desktop/v3';
    return c.json({
      success: true,
      data: {
        version: 3,
        enabled: true,
        methods: {
          password_otp: {
            available: true,
            version: 3,
            challenge_modes: native ? ['native', 'turnstile_webview', 'system_browser'] : ['turnstile_webview', 'system_browser'],
            native_presentation: native,
            automatic_fallback: false,
            otp_required: true,
            dpop_required: true,
            dpop_alg: 'ES256',
            verified_mailbox_required: true,
            challenge_paths: {
              turnstile_webview: '/login/desktop-v3-challenge',
              system_browser: '/login/desktop-v3-browser',
            },
          },
          qr: native
            ? { available: true, version: 3, presentation: 'native', start_path: `${V3}/qr/start`, exchange_path: `${V3}/qr/exchange`, expires_in: 120, interval: 2, phone_approval_required: true, dpop_required: true }
            : { available: false, reason: 'METHOD_DISABLED' },
          passkey: native && passkeyPolicy.enabled
            ? { available: true, version: 3, presentation: 'native', options_path: `${V3}/webauthn/options`, verify_path: `${V3}/webauthn/verify`, rp_id: passkeyPolicy.rpId, origin: expectedOrigin(passkeyPolicy), user_verification: passkeyPolicy.requireUV ? 'required' : 'preferred', dpop_required: true }
            : { available: false, reason: 'METHOD_DISABLED' },
          mailbox_enrollment: { available: true, version: 1 },
          recovery: { available: true, version: 1, admin_approval_required: true },
          device_proof: {
            available: true,
            alg: 'ES256',
            format: 'dpop+jwt',
            hardware_attestation_claimed: false,
          },
        },
        browser_fallback: { version: 1, capabilities_path: '/api/auth/desktop/v1/capabilities', automatic: false },
      },
    });
  });
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
          ? { available: true, version: 2, experimental: true, staging_only: true, challenge: 'system_browser_turnstile', otp_required: true, challenge_presentation: { hosted_path: '/login/desktop-challenge', embedded_path: '/login/desktop-challenge-embedded', modes: ['embedded_webview', 'system_browser'], webview2: 'staging_supported_requires_client_validation', system_browser: 'explicit_choice_only', same_ip_required: true, server_verified: true } }
          : { available: false, reason: 'NATIVE_ABUSE_VERIFIER_UNAVAILABLE' },
        windows_passkey: { available: false, reason: 'NATIVE_ASSOCIATION_UNVERIFIED' },
      },
      browser_fallback: { version: 1, capabilities_path: '/api/auth/desktop/v1/capabilities', automatic: false },
    } });
  });
}
