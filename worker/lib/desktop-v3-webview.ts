/**
 * Minimal, CSP-locked hosted challenge pages for Desktop v3:
 *  - `/login/desktop-v3-challenge`: tiny Turnstile-only WebView page. Posts the
 *    Turnstile token directly to the server; zero desktop bridge, zero SPA,
 *    zero cookies/storage/credential fields.
 *  - `/login/desktop-v3-browser`: explicit system-browser comparison ceremony
 *    showing pairing code + Turnstile + explicit confirmation checkbox.
 */
import { Hono } from 'hono';
import { desktopV3Enabled } from './desktop-v3-session';

export const V3_WEBVIEW_CHALLENGE_PATH = '/login/desktop-v3-challenge';
const V3_WEBVIEW_SCRIPT_PATH = '/login/desktop-v3-challenge.js';
export const V3_BROWSER_CHALLENGE_PATH = '/login/desktop-v3-browser';
const V3_BROWSER_SCRIPT_PATH = '/login/desktop-v3-browser.js';

export const V3_CHALLENGE_CSP = [
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

const webviewHtml = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vérification Turnstile — Atlas</title><style>html{color-scheme:light dark;font:14px system-ui}body{margin:0;padding:18px;display:grid;place-items:center;min-height:calc(100vh - 36px)}main{max-width:340px;width:100%}h1{font-size:1.05rem;margin:0 0 8px}#challenge{min-height:72px;max-width:100%;overflow:auto}p{line-height:1.45;margin:0 0 12px}</style><script src="/login/desktop-v3-challenge.js" defer></script></head><body><main><h1>Vérification de sécurité</h1><p id="status" role="status">Préparation du contrôle…</p><div id="challenge"></div></main></body></html>`;

const browserHtml = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vérification navigateur — Atlas</title><style>html{color-scheme:light dark;font:15px system-ui}body{margin:0;padding:24px;display:grid;place-items:center;min-height:calc(100vh - 48px)}main{max-width:400px;width:100%;border:1px solid rgba(128,128,128,.25);border-radius:14px;padding:20px}h1{font-size:1.15rem;margin:0 0 8px}.code{font:700 1.4rem/1.2 ui-monospace,monospace;letter-spacing:.08em;padding:10px 14px;border-radius:10px;background:rgba(128,128,128,.12);text-align:center;margin:10px 0}#challenge{min-height:72px;margin:12px 0}.row{display:flex;gap:8px;align-items:flex-start;margin:12px 0}button{padding:9px 14px;border-radius:8px;border:1px solid rgba(128,128,128,.35);cursor:pointer}</style><script src="/login/desktop-v3-browser.js" defer></script></head><body><main><h1>Confirmation de sécurité Atlas Desktop</h1><p id="device"></p><div class="code" id="pairing">—</div><label class="row"><input type="checkbox" id="confirm"><span>Ce code correspond exactement au code affiché dans Atlas Desktop.</span></label><p id="status" role="status">Préparation du contrôle…</p><div id="challenge"></div><button type="button" id="deny">Refuser</button></main></body></html>`;

function buildChallengeScript(mode: 'turnstile_webview' | 'system_browser'): string {
  const isBrowser = mode === 'system_browser';
  return String.raw`(() => {
  'use strict';
  const status = document.getElementById('status');
  const box = document.getElementById('challenge');
  const confirmEl = ${isBrowser ? "document.getElementById('confirm')" : 'null'};
  const denyEl = ${isBrowser ? "document.getElementById('deny')" : 'null'};
  const pairingEl = ${isBrowser ? "document.getElementById('pairing')" : 'null'};
  const deviceEl = ${isBrowser ? "document.getElementById('device')" : 'null'};
  const fail = () => { status.textContent = 'Vérification indisponible ou expirée. Fermez cette fenêtre et recommencez dans Atlas.'; };
  const origin = location.origin;
  const params = new URLSearchParams(location.hash.slice(1));
  const ids = params.getAll('request_id');
  const valid = location.protocol === 'https:' && !location.search && [...params.keys()].length === 1 && ids.length === 1 && /^[a-f0-9]{64}$/.test(ids[0]);
  try { history.replaceState(null, '', '${isBrowser ? V3_BROWSER_CHALLENGE_PATH : V3_WEBVIEW_CHALLENGE_PATH}'); } catch (_) { fail(); return; }
  if (!valid) { fail(); return; }
  const context = { origin, request_id: ids[0] };
  async function post(action, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch('/api/auth/desktop/v3/challenge/' + action, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', signal: controller.signal,
      });
      const json = await res.json();
      if (!res.ok || json?.success !== true) throw new Error('failed');
      return json.data;
    } finally { clearTimeout(timeout); }
  }
  let finished = false;
  let pendingToken = '';
  let submitting = false;
  function unavailable() { if (!finished) { finished = true; pendingToken = ''; fail(); } }
  async function trySubmitApproval() {
    if (finished || submitting || !pendingToken) return;
    if (confirmEl && !confirmEl.checked) {
      status.textContent = 'Cochez la confirmation du code pour terminer la vérification.';
      return;
    }
    submitting = true;
    const tokenToSend = pendingToken;
    pendingToken = '';
    status.textContent = 'Vérification en cours…';
    try {
      const payload = { ...context, decision: 'approve', turnstile_token: tokenToSend };
      if (confirmEl) payload.compare_confirmed = true;
      const result = await post('verify', payload);
      if (result?.status === 'verified') {
        finished = true;
        status.textContent = 'Vérification terminée. Revenez dans Atlas.';
      } else {
        submitting = false;
        fail();
      }
    } catch (_) {
      submitting = false;
      fail();
    }
  }
  if (confirmEl) {
    confirmEl.addEventListener('change', () => {
      if (confirmEl.checked && pendingToken) void trySubmitApproval();
    });
  }
  if (denyEl) {
    denyEl.addEventListener('click', async () => {
      if (finished) return;
      try {
        const result = await post('verify', { ...context, decision: 'deny' });
        if (result?.status === 'denied') {
          finished = true;
          pendingToken = '';
          status.textContent = 'Demande refusée. Revenez dans Atlas.';
          return;
        }
      } catch (_) {}
      status.textContent = 'Impossible de confirmer le refus. Annulez la connexion depuis Atlas.';
    });
  }
  post('prepare', context).then(challenge => {
    const expiry = Date.parse(challenge?.expires_at);
    if (challenge?.presentation !== '${mode}' || challenge.origin !== origin || challenge.request_id !== context.request_id ||
        typeof challenge.site_key !== 'string' || !challenge.site_key || challenge.site_key.length > 255 ||
        challenge.action !== 'atlas_desktop_v3' || !/^[a-f0-9]{64}$/.test(challenge.cdata || '') ||
        !Number.isFinite(expiry)) { unavailable(); return; }
    if (pairingEl && challenge.pairing_code) pairingEl.textContent = challenge.pairing_code;
    if (deviceEl && challenge.device_label) deviceEl.textContent = 'Appareil : ' + challenge.device_label;
    status.textContent = ${isBrowser ? "'Cochez la correspondance du code puis terminez le contrôle Turnstile.'" : "'Terminez le contrôle Turnstile pour continuer dans Atlas.'"};
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
          callback: token => {
            if (finished || typeof token !== 'string' || !token || token.length > 2048) return;
            pendingToken = token;
            void trySubmitApproval();
          },
          'error-callback': unavailable,
          'expired-callback': () => { pendingToken = ''; unavailable(); },
          'timeout-callback': () => { pendingToken = ''; unavailable(); },
        });
        rendered = true;
      } catch (_) { unavailable(); }
    };
    document.head.appendChild(provider);
    setTimeout(() => { if (!rendered) unavailable(); }, 10000);
    setTimeout(unavailable, 300000);
  }).catch(unavailable);
})();`;
}

const webviewScript = buildChallengeScript('turnstile_webview');
const browserScript = buildChallengeScript('system_browser');

export function registerDesktopV3WebView(app: Hono<any>): void {
  const routes: Array<[string, 'html' | 'js', string]> = [
    [V3_WEBVIEW_CHALLENGE_PATH, 'html', webviewHtml],
    [V3_WEBVIEW_SCRIPT_PATH, 'js', webviewScript],
    [V3_BROWSER_CHALLENGE_PATH, 'html', browserHtml],
    [V3_BROWSER_SCRIPT_PATH, 'js', browserScript],
  ];
  for (const [path, kind, body] of routes) {
    app.get(path, c => {
      const url = new URL(c.req.url);
      if (url.protocol !== 'https:' || url.search || !desktopV3Enabled(c.env)) {
        return c.text('Indisponible', 404);
      }
      c.header('Cache-Control', 'no-store');
      c.header('CDN-Cache-Control', 'no-store');
      c.header('Referrer-Policy', 'no-referrer');
      c.header('Content-Security-Policy', V3_CHALLENGE_CSP);
      c.header('X-Frame-Options', 'DENY');
      if (kind === 'js') {
        return c.body(body, 200, { 'Content-Type': 'application/javascript; charset=utf-8' });
      }
      return c.html(body);
    });
  }
}
