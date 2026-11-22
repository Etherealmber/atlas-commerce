import { Hono } from 'hono';
import { pilotLoginConfigured } from './desktop-native-session';

export const EMBEDDED_CHALLENGE_PATH = '/login/desktop-challenge-embedded';
const SCRIPT_PATH = '/login/desktop-challenge-embedded.js';
export const EMBEDDED_CHALLENGE_CSP = [
  "default-src 'none'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'unsafe-inline'",
  "connect-src 'self' https://challenges.cloudflare.com",
  "frame-src https://challenges.cloudflare.com",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

// This is a standalone document, not the normal SPA or website login. It does
// not register a service worker, load analytics or contain credentials.
const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vérification de sécurité</title><style>html{color-scheme:light dark;font:15px system-ui}body{margin:0;padding:20px;display:grid;place-items:center;min-height:calc(100vh - 40px)}main{max-width:340px;width:100%}h1{font-size:1.1rem}#challenge{min-height:75px;max-width:100%;overflow:auto}p{line-height:1.45}</style><script src="/login/desktop-challenge-embedded.js" defer></script></head><body><main><h1>Vérification de sécurité</h1><p id="status" role="status">Préparation du contrôle…</p><div id="challenge"></div></main></body></html>`;

// The provider callback stays entirely in this document and is sent directly
// to the same-origin backend. There is intentionally no desktop bridge.
const script = String.raw`(() => {
  'use strict';
  const status = document.getElementById('status');
  const box = document.getElementById('challenge');
  const fail = () => { status.textContent = 'Vérification indisponible ou expirée. Fermez cette fenêtre et recommencez dans Atlas ; vous pouvez choisir le navigateur système.'; };
  const origin = location.origin;
  const params = new URLSearchParams(location.hash.slice(1));
  const ids = params.getAll('request_id');
  const valid = location.protocol === 'https:' && !location.search && [...params.keys()].length === 1 && ids.length === 1 && /^[a-f0-9]{64}$/.test(ids[0]);
  try { history.replaceState(null, '', '/login/desktop-challenge-embedded'); } catch (_) { fail(); return; }
  if (!valid) { fail(); return; }
  const context = { origin, request_id: ids[0] };
  async function post(action, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch('/api/auth/desktop/v2/pilot/browser/' + action, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
      });
      const json = await res.json();
      if (!res.ok || json?.success !== true) throw new Error('failed');
      return json.data;
    } finally { clearTimeout(timeout); }
  }
  let finished = false;
  function unavailable() { if (!finished) { finished = true; fail(); } }
  post('prepare', context).then(challenge => {
    const expiry = Date.parse(challenge?.expires_at);
    if (challenge?.presentation !== 'embedded_webview' || challenge.origin !== origin || challenge.request_id !== context.request_id ||
        typeof challenge.site_key !== 'string' || !challenge.site_key || challenge.site_key.length > 255 ||
        challenge.action !== 'atlas_desktop_v2' || !/^[a-f0-9]{64}$/.test(challenge.cdata || '') ||
        !Number.isFinite(expiry)) { unavailable(); return; }
    status.textContent = 'Terminez le contrôle de sécurité. Une interaction peut être demandée.';
    let rendered = false;
    const provider = document.createElement('script');
    provider.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    provider.async = true;
    provider.onerror = unavailable;
    provider.onload = () => {
      if (finished) return;
      try {
        if (!window.turnstile?.render) { unavailable(); return; }
        window.turnstile.render(box, {
          sitekey: challenge.site_key, action: challenge.action, cData: challenge.cdata, size: 'normal', appearance: 'always',
          callback: async token => {
            if (finished || typeof token !== 'string' || !token || token.length > 2048) return;
            finished = true;
            status.textContent = 'Vérification en cours…';
            try {
              const result = await post('decision', { ...context, decision: 'approve', turnstile_token: token });
              status.textContent = result?.status === 'verified' ? 'Vérification terminée. Revenez dans Atlas.' : 'Vérification indisponible. Recommencez dans Atlas.';
            } catch (_) { fail(); }
          },
          'error-callback': unavailable, 'expired-callback': unavailable, 'timeout-callback': unavailable,
        });
        rendered = true;
      } catch (_) { unavailable(); }
    };
    document.head.appendChild(provider);
    setTimeout(() => { if (!rendered) unavailable(); }, 10000);
    // The server is authoritative for expiration. Device wall clocks can be
    // skewed; bound this view locally without treating its clock as proof.
    setTimeout(unavailable, 300000);
  }).catch(unavailable);
})();`;

export function registerDesktopPilotWebView(app: Hono<any>): void {
  for (const path of [EMBEDDED_CHALLENGE_PATH, SCRIPT_PATH]) {
    app.get(path, c => {
      const url = new URL(c.req.url);
      if (url.protocol !== 'https:' || url.search || !pilotLoginConfigured(c.env) || url.origin !== c.env.DESKTOP_NATIVE_V2_PILOT_ORIGIN) {
        return c.text('Indisponible', 404);
      }
      c.header('Cache-Control', 'no-store');
      c.header('CDN-Cache-Control', 'no-store');
      c.header('Referrer-Policy', 'no-referrer');
      if (path === SCRIPT_PATH) return c.body(script, 200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      return c.html(html);
    });
  }
}
