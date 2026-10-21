/**
 * Runtime config for web + Capacitor (Android / iOS).
 *
 * On the phone, the WebView origin is https://localhost — relative /api calls
 * never reach Cloudflare. We force the production Worker URL on native.
 *
 * Override at build time: VITE_API_URL=https://your-worker.example.com
 */
const DEFAULT_API = 'https://stock.afmarbre.com';

function readEnvApi(): string {
  try {
    const v = (import.meta as any)?.env?.VITE_API_URL;
    if (v && typeof v === 'string' && v.startsWith('http')) return v.replace(/\/$/, '');
  } catch { /* ignore */ }
  return '';
}

/** True when running inside Capacitor native shell */
export function isNativeApp(): boolean {
  try {
    const w = window as any;
    if (w.Capacitor?.isNativePlatform?.()) return true;
    if (w.Capacitor?.getPlatform?.() === 'android' || w.Capacitor?.getPlatform?.() === 'ios') return true;
  } catch { /* ignore */ }
  // Fallback: Capacitor androidScheme loads as https://localhost
  try {
    const h = window.location.hostname;
    if (h === 'localhost' && window.location.protocol === 'https:') return true;
  } catch { /* ignore */ }
  return false;
}

/**
 * API origin (no trailing slash).
 * - Web (same Worker): '' → relative paths
 * - Native APK/IPA: absolute Worker URL
 */
export function getApiBase(): string {
  const env = readEnvApi();
  if (env) return env;
  if (isNativeApp()) return DEFAULT_API;
  // Browser on production domain — same origin
  try {
    const host = window.location.hostname;
    if (host && host !== 'localhost' && host !== '127.0.0.1') return '';
  } catch { /* ignore */ }
  // Local vite dev → hit production API (or set VITE_API_URL)
  if (typeof window !== 'undefined' && /localhost|127\.0\.0\.1/.test(window.location.hostname)) {
    return DEFAULT_API;
  }
  return '';
}

export const APP_NAME = 'Atlas Commerce';
export const APP_TAGLINE = 'Stock · Caisse · Facturation';
export const APP_VERSION = '0.5.2-beta';
