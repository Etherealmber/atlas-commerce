// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LoginDesktopPhone from '../pages/LoginDesktopPhone';
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

describe('mobile-web and Worker desktop v2 contract', () => {
  it('runs create → QR reference → visible consent → PKCE exchange', async () => {
    const create = await backend('/api/auth/desktop/v2/requests', { origin: ORIGIN, state: STATE, code_challenge: await desktopHash(VERIFIER), code_challenge_method: 'S256', device_label: 'Fictional PC' });
    expect(create.status).toBe(201);
    const request: any = (await create.json()).data;
    (window as any).happyDOM.setURL(`${ORIGIN}/login/desktop-phone#request_id=${request.request_id}`);
    let inFlight: Promise<Response> | undefined;
    vi.stubGlobal('fetch', (path: string, init: RequestInit) => {
      inFlight = backend(path, JSON.parse(String(init.body)), true);
      return inFlight;
    });
    await act(async () => root.render(createElement(LoginDesktopPhone)));
    await act(async () => { await inFlight; });
    expect(host.textContent).toContain('alice'); expect(host.textContent).toContain('Fictional PC'); expect(host.textContent).toContain(request.pairing_code);
    expect((await backend('/api/auth/desktop/v2/exchange', { origin: ORIGIN, request_id: request.request_id, state: STATE, code_verifier: VERIFIER })).status).toBe(409);
    const approve = [...host.querySelectorAll('button')].find(b => b.textContent === 'Autoriser ce desktop')!;
    expect(approve.disabled).toBe(true);
    await act(async () => (host.querySelector('input') as HTMLInputElement).click());
    await act(async () => approve.click());
    await act(async () => { await inFlight; });
    expect(host.textContent).toContain('Desktop autorisé');
    const exchange = await backend('/api/auth/desktop/v2/exchange', { origin: ORIGIN, request_id: request.request_id, state: STATE, code_verifier: VERIFIER });
    expect(exchange.status).toBe(200);
    const result: any = await exchange.json(); expect(result.data).toMatchObject({ username: 'alice', role: 'user', origin: ORIGIN, request_id: request.request_id, token_type: 'Bearer' });
    expect(result.data.token).toBeTruthy();
    expect((await backend('/api/auth/desktop/v2/exchange', { origin: ORIGIN, request_id: request.request_id, state: STATE, code_verifier: VERIFIER })).status).toBe(409);
  });
});
