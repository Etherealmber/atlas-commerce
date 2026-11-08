// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoginDesktop from '../pages/LoginDesktop';
import { clearDesktopApproval, DESKTOP_APPROVAL_KEY, desktopLoginReturn, loadDesktopApproval, parseDesktopApproval, saveDesktopApproval } from '../lib/desktopApproval';

const session = vi.hoisted(() => ({ token: 'browser-session-private' }));
vi.mock('../auth', () => ({
  getToken: () => session.token,
  isLoggedIn: () => !!session.token,
  clearToken: () => { session.token = ''; },
}));
vi.mock('../fingerprint', () => ({ getCachedFingerprint: async () => 'browser-fingerprint-0123456789' }));
const ORIGIN = 'https://self-hosted.example:8443';
const ID = 'a'.repeat(64);
const STATE = 's'.repeat(64);
const HASH = `#request_id=${ID}&state=${STATE}`;
let root: Root;
let host: HTMLDivElement;
let calls: { path: string; init: RequestInit; body: any }[];

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (window as any).happyDOM.setURL(`${ORIGIN}/login/desktop${HASH}`);
  sessionStorage.clear();
  session.token = 'browser-session-private';
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    calls.push({ path, init, body: JSON.parse(String(init.body)) });
    if (path === '/api/auth/desktop/v1/prepare') return Response.json({ success: true, data: {
      request_id: ID, origin: ORIGIN, username: 'alice', device_label: 'Mon desktop', pairing_code: 'ABCD-EFGH', csrf_token: 'n'.repeat(64),
      expires_at: new Date(Date.now() + 120_000).toISOString(), consent_expires_at: new Date(Date.now() + 60_000).toISOString(),
    } });
    return Response.json({ success: true, data: { status: 'approved' } });
  }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/** The real login/OTP endpoints are tested in worker/desktop-auth.test.ts.
 * This stub isolates the browser handoff across that existing login route. */
function LoginReturnStub() {
  const navigate = useNavigate();
  return createElement('button', { onClick: () => { session.token = 'after-web-otp'; navigate(desktopLoginReturn() || '/dashboard'); } }, 'Retour après connexion web et OTP');
}
async function render() {
  await act(async () => {
    root.render(createElement(MemoryRouter, { initialEntries: ['/login/desktop'] },
      createElement(Routes, null,
        createElement(Route, { path: '/login/desktop', element: createElement(LoginDesktop) }),
        createElement(Route, { path: '/login', element: createElement(LoginReturnStub) }),
      )));
  });
}
function button(label: string): HTMLButtonElement {
  const b = [...host.querySelectorAll('button')].find(e => e.textContent === label);
  if (!b) throw new Error(`Button missing: ${label}`);
  return b;
}

describe('browser consent and safe login return', () => {
  it('parses only a request/state fragment on an exact HTTPS origin', () => {
    expect(parseDesktopApproval(HASH, ORIGIN)).toMatchObject({ request_id: ID, state: STATE, origin: ORIGIN });
    for (const fragment of [HASH + '&callback=atlas://finish', HASH + '&state=duplicate', '#request_id=wrong&state=x', '#redirect_uri=https://evil.example', HASH + '&origin=https://evil.example']) {
      expect(parseDesktopApproval(fragment, ORIGIN)).toBeNull();
    }
    expect(parseDesktopApproval(HASH, 'http://insecure.example')).toBeNull();
    expect(parseDesktopApproval(HASH, `${ORIGIN}/path`)).toBeNull();
  });

  it('post-login return is one fixed route, not a stored or supplied redirect URL', () => {
    const context = parseDesktopApproval(HASH, ORIGIN)!;
    saveDesktopApproval(context);
    expect(desktopLoginReturn()).toBe('/login/desktop');
    sessionStorage.setItem(DESKTOP_APPROVAL_KEY, JSON.stringify({ ...context, return_to: 'https://evil.example' }));
    expect(desktopLoginReturn()).toBeNull();
    expect(sessionStorage.getItem(DESKTOP_APPROVAL_KEY)).toBeNull();
    saveDesktopApproval({ ...context, origin: 'https://another-server.example' });
    expect(desktopLoginReturn()).toBeNull();
    saveDesktopApproval({ ...context, expiresAt: Date.now() - 1 });
    expect(desktopLoginReturn()).toBeNull();
    clearDesktopApproval();
  });

  it('already logged in: only prepares; account/server/code and explicit buttons appear', async () => {
    await render();
    expect(calls.map(c => c.path)).toEqual(['/api/auth/desktop/v1/prepare']);
    expect(host.textContent).toContain('alice');
    expect(host.textContent).toContain(ORIGIN);
    expect(host.textContent).toContain('ABCD-EFGH');
    expect(button('Autoriser ce desktop').disabled).toBe(true);
    expect(button('Refuser').disabled).toBe(false);
    expect(window.location.hash).toBe('');
    expect(sessionStorage.getItem(DESKTOP_APPROVAL_KEY)).not.toContain(session.token);
  });

  it('preserves the request across logged-out → existing login/OTP → explicit consent', async () => {
    session.token = '';
    await render();
    expect(calls).toHaveLength(0);
    expect(loadDesktopApproval()?.request_id).toBe(ID);
    await act(async () => button('Retour après connexion web et OTP').click());
    expect(calls.map(c => c.path)).toEqual(['/api/auth/desktop/v1/prepare']);
    expect(calls[0].body).toMatchObject({ request_id: ID, state: STATE, origin: ORIGIN });
    expect(host.textContent).toContain('Autoriser le desktop');
    expect(button('Autoriser ce desktop').disabled).toBe(true);
  });

  it('cannot approve until comparison is checked and the approval button is clicked', async () => {
    await render();
    await act(async () => button('Autoriser ce desktop').click());
    expect(calls).toHaveLength(1);
    await act(async () => (host.querySelector('input[type=checkbox]') as HTMLInputElement).click());
    expect(calls).toHaveLength(1);
    expect(button('Autoriser ce desktop').disabled).toBe(false);
    await act(async () => button('Autoriser ce desktop').click());
    expect(calls[1].path).toBe('/api/auth/desktop/v1/authorize');
    expect(calls[1].body).toMatchObject({ decision: 'approve', csrf_token: 'n'.repeat(64), request_id: ID, state: STATE, origin: ORIGIN });
    expect(sessionStorage.getItem(DESKTOP_APPROVAL_KEY)).toBeNull();
    expect(host.textContent).toContain('Revenez dans l’application desktop');
  });

  it('refusal requires a separate click, without comparison or auto-authorization', async () => {
    await render();
    await act(async () => button('Refuser').click());
    expect(calls[1].body.decision).toBe('deny');
    expect(host.textContent).toContain('Connexion refusée');
    expect(sessionStorage.getItem(DESKTOP_APPROVAL_KEY)).toBeNull();
  });

  it('uses same-origin, no-store, no-referrer fetch with redirects forbidden', async () => {
    await render();
    expect(calls[0].path).toBe('/api/auth/desktop/v1/prepare');
    expect(calls[0].init).toMatchObject({ redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', credentials: 'same-origin' });
    expect(calls[0].body).not.toHaveProperty('token');
    expect(calls[0].body).not.toHaveProperty('code_verifier');
  });

  it('rejects callback/query substitution without sending a request', async () => {
    window.history.replaceState(null, '', `/login/desktop?callback=https://evil.example${HASH}`);
    await render();
    expect(calls).toHaveLength(0);
    expect(host.textContent).toContain('Demande invalide');
    expect(loadDesktopApproval()).toBeNull();
  });

  it('ignores a forged callback fragment instead of adopting its alleged session token', async () => {
    window.history.replaceState(null, '', '/login/desktop#access_token=forged-session&state=forged');
    await render();
    expect(calls).toHaveLength(0);
    expect(session.token).toBe('browser-session-private');
    expect(loadDesktopApproval()).toBeNull();
    expect(host.textContent).not.toContain('forged-session');
  });

  it('never renders or logs untrusted server error bodies or session tokens', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ success: false, code: 'UNAVAILABLE', error: 'secret-from-upstream browser-session-private' }, { status: 503 }));
    await render();
    expect(host.textContent).not.toContain('secret-from-upstream');
    expect(host.textContent).not.toContain(session.token);
    expect(JSON.stringify([warn.mock.calls, error.mock.calls])).not.toContain('secret-from-upstream');
    expect(host.querySelector('button')).toBeNull();
  });
});
