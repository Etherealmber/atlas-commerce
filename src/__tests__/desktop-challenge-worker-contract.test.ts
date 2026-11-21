// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DesktopChallengePilot from '../pages/DesktopChallengePilot';
import { desktopHash } from '../../worker/routes/desktopAuth';

const account = vi.hoisted(() => ({ token: '' }));
vi.mock('../auth', () => ({ getToken: () => account.token, isLoggedIn: () => !!account.token }));
vi.mock('../fingerprint', () => ({ getCachedFingerprint: async () => 'phone-fingerprint-0123456789' }));
// The image codec is unrelated to auth; its Node WASM loader cannot run under happy-dom.
vi.mock('../../worker/lib/product-image-codec', () => ({ normalizeProductImage: async () => new Uint8Array(), PRODUCT_IMAGE_MAX_BYTES: 4194304 }));
const SQLITE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = await import(SQLITE);
const ORIGIN = 'https://store.example:8443';
const PC = 'desktop-fingerprint-0123456789';
const PHONE = 'phone-fingerprint-0123456789';
const STATE = 's'.repeat(64);
const VERIFIER = 'v'.repeat(64);
let sqlite: any; let env: any; let worker: any; let host: HTMLDivElement; let root: Root;
async function hex(s: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), b => b.toString(16).padStart(2, '0')).join('');
}
function adapter(db: any) {
  return {
    prepare(sql: string) {
      let params: any[] = [];
      const st: any = {
        bind(...args: any[]) { params = args; return st; },
        async run() { const r = db.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
        async first() { const r = db.prepare(sql).get(...params); return r ? { ...r } : null; },
        async all() { return { success: true, results: db.prepare(sql).all(...params).map((row: any) => Object.assign({}, row)), meta: {} }; },
      };
      return st;
    },
    async batch(stmts: any[]) {
      db.exec('BEGIN');
      try {
        const out: any[] = [];
        // eslint-disable-next-line no-await-in-loop -- emulate a sequential transactional D1 batch.
        for (const st of stmts) out.push(await st.run());
        db.exec('COMMIT'); return out;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
async function backend(path: string, body: any, phone = false) {
  const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': phone ? '198.51.100.5' : '203.0.113.5', 'X-Device-Fingerprint': phone ? PHONE : PC, ...(phone ? { Authorization: `Bearer ${account.token}`, Origin: ORIGIN } : {}) };
  return worker.fetch(new Request(`${ORIGIN}${path}`, { method: 'POST', headers, body: JSON.stringify(body) }), env, { waitUntil() {} });
}
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE company_settings (id INTEGER PRIMARY KEY, company_name TEXT DEFAULT '', email TEXT DEFAULT '');
    INSERT INTO company_settings VALUES (1,'Test','');
    CREATE TABLE app_config (key TEXT PRIMARY KEY,value TEXT NOT NULL DEFAULT '',updated_at TEXT DEFAULT '');
    CREATE TABLE app_users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT, password_salt TEXT DEFAULT '', role TEXT, display_name TEXT DEFAULT '', active INTEGER DEFAULT 1, email TEXT DEFAULT '', created_by TEXT DEFAULT '', created_at TEXT DEFAULT '', last_login TEXT);
    CREATE TABLE trusted_devices (fingerprint TEXT PRIMARY KEY, username TEXT DEFAULT '', last_ip TEXT DEFAULT '', last_seen TEXT DEFAULT '', created_at TEXT DEFAULT '', user_agent TEXT DEFAULT '', biometric_credential_id TEXT DEFAULT '');
  `);
  const hash = await hex('fictional-hash-material');
  sqlite.prepare('INSERT INTO app_users (id,username,password_hash,role,active) VALUES (1,?,?,?,1)').run('alice', hash, 'user');
  sqlite.prepare('INSERT INTO trusted_devices (fingerprint,username) VALUES (?,?)').run(PHONE, 'alice');
  account.token = btoa(`stock-auth-v2|alice|user|198.51.100.5|${PHONE}|${await hex(`proof|alice|user|${hash}|198.51.100.5|${PHONE}`)}`);
  env = { DB: adapter(sqlite), ADMIN_PASSWORD: 'fictional-owner', DESKTOP_NATIVE_V2_DISCOVERY: 'true', DESKTOP_NATIVE_V2_PHONE_APPROVAL: 'true' };
  const mod: any = await import('../../worker/index'); worker = mod.default;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(async () => { if (root) await act(async () => root.unmount()); host?.remove(); sqlite?.close(); vi.unstubAllGlobals(); });

describe('staging browser challenge and Worker contract', () => {
  it('runs browser ceremony then native password and OTP against the Worker', async () => {
    const password = 'staging-test-password'; const salt = 'isolated-test-salt';
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(`pc-salt:${salt}`), iterations:100000 }, material, 256);
    const hash = Array.from(new Uint8Array(bits), x => x.toString(16).padStart(2,'0')).join('');
    sqlite.prepare('UPDATE app_users SET password_salt=?,password_hash=? WHERE username=?').run(salt, `pbkdf2$100000$${hash}`, 'alice');
    const email = vi.fn(async (_value: any) => ({}));
    Object.assign(env, { ENVIRONMENT:'staging', DESKTOP_NATIVE_V2_PILOT_CHALLENGE:'true', DESKTOP_NATIVE_V2_PILOT_LOGIN:'true', DESKTOP_NATIVE_V2_PILOT_ORIGIN:ORIGIN, DESKTOP_NATIVE_V2_PILOT_USERNAME:'alice', DESKTOP_NATIVE_V2_PILOT_OTP_FROM:'test@example.test', DESKTOP_NATIVE_V2_PILOT_OTP_TO:'mailbox@example.test', DESKTOP_NATIVE_V2_PILOT_OTP_KEY:'test-key-only-not-a-real-secret-12345', TURNSTILE_SITE_KEY:'site', TURNSTILE_SECRET_KEY:'secret', EMAIL:{send:email} });
    const create = await backend('/api/auth/desktop/v2/pilot/requests', {origin:ORIGIN,state:STATE,code_challenge:await desktopHash(VERIFIER),code_challenge_method:'S256',device_label:'Fictional PC'});
    expect(create.status).toBe(201); const request: any = (await create.json()).data;
    (window as any).happyDOM.setURL(`${ORIGIN}/login/desktop-challenge#request_id=${request.request_id}`);
    let inFlight: Promise<Response> | undefined; let widgetOptions: any;
    (window as any).turnstile = { render: (_: any, o: any) => { widgetOptions=o; return 'widget'; }, remove:vi.fn() };
    vi.stubGlobal('fetch', (path: string, init: RequestInit) => {
      if (String(path).startsWith('https://challenges.cloudflare.com/')) return Promise.resolve(new Response(JSON.stringify({success:true,hostname:'store.example',action:widgetOptions.action,cdata:widgetOptions.cData})));
      const r = new Request(`${ORIGIN}${path}`, { method:'POST', headers:{'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.5'}, body:init.body });
      // happy-dom strips the forbidden Origin request header; simulate the browser adding it.
      const get = r.headers.get.bind(r.headers); r.headers.get = (name: string) => name.toLowerCase() === 'origin' ? ORIGIN : get(name);
      inFlight = worker.fetch(r, env, {waitUntil() {}}); return inFlight;
    });
    await act(async () => root.render(createElement(DesktopChallengePilot))); await act(async () => { await inFlight; });
    await act(async () => widgetOptions.callback('provider-token')); await act(async () => (host.querySelector('input') as HTMLInputElement).click());
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Confirmer la vérification')!.click()); await act(async () => { await inFlight; });
    const proof = {origin:ORIGIN,request_id:request.request_id,state:STATE,code_verifier:VERIFIER};
    const first = await backend('/api/auth/desktop/v2/pilot/login/password',{...proof,username:'alice',password}); expect(first.status).toBe(200);
    for (let i=0; i<20 && sqlite.prepare('SELECT delivered FROM desktop_native_login_pilot_v1 WHERE id=?').get(request.request_id)?.delivered !== 1; i++) await new Promise(r => setTimeout(r,2));
    const otp = /Code de test : (\d{6})/.exec(email.mock.calls[0]?.[0]?.text || '')?.[1]; expect(otp).toBeTruthy();
    const result = await backend('/api/auth/desktop/v2/pilot/login/otp',{...proof,otp}); expect(result.status).toBe(200);
    const session: any = (await result.json()).data; expect(session.username).toBe('alice'); expect(session.access_token).toMatch(/^np1\./);
    const logout = await backend('/api/auth/desktop/v2/pilot/session/logout',{origin:ORIGIN,refresh_token:session.refresh_token}); expect(logout.status).toBe(200);
    delete (window as any).turnstile;
  });
  it('requires checkbox and Turnstile, then verifies without creating a session', async () => {
    env.ENVIRONMENT = 'staging'; env.DESKTOP_NATIVE_V2_PILOT_CHALLENGE = 'true';
    env.TURNSTILE_SITE_KEY = 'site'; env.TURNSTILE_SECRET_KEY = 'secret';
    const create = await backend('/api/auth/desktop/v2/pilot/requests', { origin: ORIGIN, state: STATE, code_challenge: await desktopHash(VERIFIER), code_challenge_method: 'S256', device_label: 'Fictional PC' });
    expect(create.status).toBe(201);
    const request: any = (await create.json()).data;
    (window as any).happyDOM.setURL(`${ORIGIN}/login/desktop-challenge#request_id=${request.request_id}`);
    let inFlight: Promise<Response> | undefined;
    let widgetOptions: any;
    (window as any).turnstile = { render: (_element: any, options: any) => { widgetOptions = options; return 'widget'; }, remove: vi.fn() };
    vi.stubGlobal('fetch', (path: string, init: RequestInit) => {
      if (String(path).startsWith('https://challenges.cloudflare.com/')) return Promise.resolve(new Response(JSON.stringify({success:true, hostname: 'store.example', action: widgetOptions.action, cdata: widgetOptions.cData})));
      const r = new Request(`${ORIGIN}${path}`, {method:'POST', headers:{'Content-Type':'application/json', Origin:ORIGIN, 'CF-Connecting-IP':'203.0.113.5'}, body: init.body}); const get = r.headers.get.bind(r.headers); r.headers.get = (name: string) => name.toLowerCase() === 'origin' ? ORIGIN : get(name); inFlight = worker.fetch(r, env, {waitUntil() {}});
      return inFlight;
    });
    await act(async () => root.render(createElement(DesktopChallengePilot)));
    await act(async () => { await inFlight; });
    expect(window.location.hash).toBe('');
    expect(host.textContent).toContain(request.pairing_code);
    expect(host.querySelectorAll('input:not([type="checkbox"])')).toHaveLength(0);
    expect(widgetOptions).toMatchObject({ size: 'normal', appearance: 'always', action: 'atlas_desktop_v2' });
    const approve = [...host.querySelectorAll('button')].find(b => b.textContent === 'Confirmer la vérification')!;
    expect(approve.disabled).toBe(true);
    await act(async () => widgetOptions.callback('provider-token'));
    expect(approve.disabled).toBe(true);
    await act(async () => (host.querySelector('input') as HTMLInputElement).click());
    expect(approve.disabled).toBe(false);
    await act(async () => widgetOptions['expired-callback']());
    expect(approve.disabled).toBe(true);
    expect(host.textContent).toContain('navigateur système');
    await act(async () => widgetOptions.callback('provider-token'));
    expect(approve.disabled).toBe(false);
    await act(async () => approve.click()); await act(async () => { await inFlight; });
    expect(host.textContent).toContain('aucune connexion n’a été créée');
    const proof = {origin: ORIGIN, request_id: request.request_id, state: STATE, code_verifier: VERIFIER};
    const consumed = await backend('/api/auth/desktop/v2/pilot/consume', proof);
    expect(consumed.status).toBe(200);
    expect(JSON.stringify(await consumed.json())).not.toMatch(/token|session|grant/i);
    delete (window as any).turnstile;
  });
});
