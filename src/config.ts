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
    const v = import.meta.env.VITE_API_URL;
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
  // Browser (production domain OR local `npm run dev` / `wrangler dev`) —
  // same origin. Local dev runs the Worker in-process through the Cloudflare
  // Vite plugin, so relative /api calls hit the LOCAL worker + local D1 (and
  // the `test` / `test` demo works offline). To develop against the
  // production API instead, set VITE_API_URL=https://stock.afmarbre.com.
  return '';
}

