// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { registerDesktopPilotWebView } from '../../worker/lib/desktop-pilot-webview';

const origin = 'https://stage.example:8443';
const id = 'a'.repeat(64);
const env = { ENVIRONMENT:'staging', DESKTOP_NATIVE_V2_PILOT_CHALLENGE:'true', DESKTOP_NATIVE_V2_PILOT_LOGIN:'true', DESKTOP_NATIVE_V2_PILOT_ORIGIN:origin, DESKTOP_NATIVE_V2_PILOT_USERNAME:'testuser', DESKTOP_NATIVE_V2_PILOT_OTP_KEY:'k'.repeat(32), DESKTOP_NATIVE_V2_PILOT_OTP_FROM:'from@example.test', DESKTOP_NATIVE_V2_PILOT_OTP_TO:'to@example.test', TURNSTILE_SITE_KEY:'site', TURNSTILE_SECRET_KEY:'secret', EMAIL:{ send() {} }, DB:{ prepare() {}, batch() {} } };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (window as any).turnstile; document.body.innerHTML = ''; });

it('renders an interactive challenge and posts the provider result directly, with no desktop bridge', async () => {
  const app = new Hono<any>(); registerDesktopPilotWebView(app);
  const script = await (await app.request(`${origin}/login/desktop-challenge-embedded.js`, {}, env)).text();
  (window as any).happyDOM.setURL(`${origin}/login/desktop-challenge-embedded#request_id=${id}`);
  document.body.innerHTML = '<p id="status"></p><div id="challenge"></div>';
  const calls: { path: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    calls.push({ path, init });
    const data = path.endsWith('/prepare') ? { origin, request_id:id, presentation:'embedded_webview', site_key:'site', action:'atlas_desktop_v2', cdata:'b'.repeat(64), expires_at:new Date(Date.now() + 120000).toISOString() } : {status:'verified'};
    return new Response(JSON.stringify({ success:true, data }), { status:200 });
  }));
  let widget: any;
  (window as any).turnstile = { render: vi.fn((_box: unknown, options: any) => { widget = options; }) };
  vi.spyOn(document.head, 'appendChild').mockImplementation((node: any) => { if (node.tagName === 'SCRIPT') queueMicrotask(() => node.dispatchEvent(new Event('load'))); return node; });
  window.eval(script);
  for (let i = 0; i < 20 && !widget; i++) await new Promise(resolve => setTimeout(resolve, 0));
  expect(location.hash).toBe('');
  expect(widget?.appearance).toBe('always'); expect(widget?.size).toBe('normal');
  expect(calls).toHaveLength(1);
  await widget.callback('test-provider-result');
  expect(calls).toHaveLength(2);
  expect(calls[1].path).toBe('/api/auth/desktop/v2/pilot/browser/decision');
  expect(JSON.parse(calls[1].init.body as string)).toEqual({origin, request_id:id, decision:'approve', turnstile_token:'test-provider-result'});
  expect(calls[1].init.credentials).toBe('omit');
  expect(calls[1].init.redirect).toBe('error');
  expect(document.querySelector('#status')?.textContent).toContain('Vérification terminée');
  await widget.callback('duplicate');
  expect(calls).toHaveLength(2);
});
