// @vitest-environment happy-dom
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoginDesktopPhone from '../pages/LoginDesktopPhone';
import { parsePhoneApproval } from '../lib/desktopPhoneApproval';

const session = vi.hoisted(() => ({ token: 'fictional-phone-session' }));
vi.mock('../auth', () => ({ getToken: () => session.token }));
vi.mock('../fingerprint', () => ({ getCachedFingerprint: async () => 'phone-fingerprint-0123456789' }));
const ORIGIN = 'https://self-hosted.example:8443';
const ID = 'a'.repeat(64);
const NONCE = 'b'.repeat(64);
let root: Root;
let host: HTMLDivElement;
let calls: { path: string; init: RequestInit; body: any }[];

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  (window as any).happyDOM.setURL(`${ORIGIN}/login/desktop-phone#request_id=${ID}`);
  session.token = 'fictional-phone-session';
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); calls = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); calls.push({ path, init, body });
    if (path.endsWith('/prepare')) return Response.json({ success: true, data: {
      request_id: ID, origin: ORIGIN, username: 'alice', device_label: 'PC bureau', pairing_code: 'ABCD1-EFGH2', consent_nonce: NONCE,
      expires_at: new Date(Date.now() + 180_000).toISOString(), consent_expires_at: new Date(Date.now() + 60_000).toISOString(),
    } });
    return Response.json({ success: true, data: { status: body.decision === 'approve' ? 'approved' : 'denied' } });
  }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function render(strict = false) { await act(async () => root.render(strict ? createElement(StrictMode, null, createElement(LoginDesktopPhone)) : createElement(LoginDesktopPhone))); }
function button(text: string) { const b = [...host.querySelectorAll('button')].find(x => x.textContent === text); if (!b) throw new Error('button missing'); return b; }

describe('phone v2 consent page', () => {
  it('accepts only one request reference on an HTTPS origin', () => {
    expect(parsePhoneApproval(`#request_id=${ID}`, ORIGIN, '')).toEqual({ request_id: ID, origin: ORIGIN });
    for (const fragment of [`#request_id=${ID}&state=secret`, `#request_id=${ID}&request_id=${ID}`, '#request_id=bad', `#request_id=${ID}&token=secret`]) expect(parsePhoneApproval(fragment, ORIGIN, '')).toBeNull();
    expect(parsePhoneApproval(`#request_id=${ID}`, 'http://test.example', '')).toBeNull();
    expect(parsePhoneApproval(`#request_id=${ID}`, ORIGIN, '?return_to=https://evil.example')).toBeNull();
  });
  it('prepares once even in StrictMode, removes the fragment, displays details but does not approve', async () => {
    await render(true);
    expect(calls).toHaveLength(1); expect(calls[0].path).toBe('/api/auth/desktop/v2/phone/prepare');
    expect(calls[0].body).toEqual({ request_id: ID, origin: ORIGIN });
    expect(calls[0].init).toMatchObject({ redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', credentials: 'omit' });
    expect(window.location.hash).toBe('');
    for (const text of ['alice', ORIGIN, 'PC bureau', 'ABCD1-EFGH2']) expect(host.textContent).toContain(text);
    expect(button('Autoriser ce desktop').disabled).toBe(true);
  });
  it('requires explicit comparison and click to approve', async () => {
    await render();
    await act(async () => button('Autoriser ce desktop').click()); expect(calls).toHaveLength(1);
    await act(async () => (host.querySelector('input') as HTMLInputElement).click());
    await act(async () => button('Autoriser ce desktop').click());
    expect(calls[1].path).toBe('/api/auth/desktop/v2/phone/decision');
    expect(calls[1].body).toEqual({ request_id: ID, origin: ORIGIN, consent_nonce: NONCE, decision: 'approve', compare_confirmed: true });
    expect(host.textContent).toContain('Desktop autorisé');
    expect(host.textContent).not.toContain(session.token); expect(host.textContent).not.toContain(NONCE);
  });
  it('allows explicit refusal without comparison', async () => {
    await render(); await act(async () => button('Refuser').click());
    expect(calls[1].body).toMatchObject({ decision: 'deny', compare_confirmed: false });
    expect(host.textContent).toContain('Connexion refusée');
  });
  it('sends no request when logged out, invalid or substituted', async () => {
    session.token = ''; await render(); expect(calls).toHaveLength(0);
    expect(host.textContent).toContain('Connectez-vous');
  });
  it('does not send credentials on unexpected query or fragment fields', async () => {
    window.history.replaceState(null, '', `/login/desktop-phone?return_to=https://evil.example#request_id=${ID}`);
    await render(); expect(calls).toHaveLength(0); expect(window.location.search).toBe(''); expect(window.location.hash).toBe('');
  });
  it('does not use a nonce after account switching', async () => {
    await render(); session.token = 'other-account';
    await act(async () => button('Refuser').click());
    expect(calls).toHaveLength(1); expect(host.textContent).toContain('compte a changé');
  });
  it('rejects wrong-origin prepare responses and never shows upstream errors', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ success: true, data: { origin: 'https://evil.example', request_id: ID, error: 'secret-from-server' } }));
    await render();
    expect(host.querySelector('button')).toBeNull(); expect(host.textContent).not.toContain('secret-from-server');
  });
});
