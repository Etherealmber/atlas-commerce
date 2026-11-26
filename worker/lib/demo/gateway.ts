/**
 * Demo gateway — runs in front of the Hono app (worker/index.ts `fetch`).
 *
 *  • POST /api/auth/login with « test / test » → opens (or resumes) the
 *    caller's sandbox and runs the normal login handler against it. The
 *    returned token is wrapped: `atlasdemo.<fp>.<gen>.<exp>.<sig>~<token>`.
 *  • Any request carrying a wrapped token (Authorization header or ?token=)
 *    is unwrapped and served by the same app with the sandbox environment.
 *  • GET /api/demo/config tells the login page whether to highlight the demo.
 *
 * Works for the web app, the mobile web app (/m) and the Android app, which
 * all log in through /api/auth/login and treat the token as opaque.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Env } from '../../env';
import { runInDataScope } from '../dataScope';
import { DemoD1, type DemoTransport } from './demoD1';
import { buildDemoEnv } from './demoEnv';
import {
  DEMO_PASSWORD,
  DEMO_SESSION_MINUTES,
  demoDurationLabel,
  DEMO_USERNAME,
  DEMO_WINDOW_HOURS,
  demoIntroMessage,
  formatWait,
} from './policy';
import { seedDemoData } from './seed';

export const DEMO_TOKEN_PREFIX = 'atlasdemo.';
const MAX_NEW_SANDBOXES_PER_IP_PER_DAY = 8;

type AppFetch = (req: Request, env: Env, ctx: ExecutionContext) => Response | Promise<Response>;
type TurnstileCheck = (env: Env, token: string, ip: string, native: boolean) => Promise<{ ok: boolean; error?: string }>;

interface DemoClaims {
  fp: string;
  gen: number;
  exp: number;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(secret: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

function gatewaySecret(env: Env): string {
  return `atlas-demo-gw|${env.JWT_SECRET || env.ADMIN_PASSWORD || 'local-dev'}`;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function wrapDemoToken(env: Env, claims: DemoClaims, inner: string): Promise<string> {
  const body = `${claims.fp}.${claims.gen}.${claims.exp}`;
  const sig = (await hmacHex(gatewaySecret(env), body)).slice(0, 40);
  return `${DEMO_TOKEN_PREFIX}${body}.${sig}~${inner}`;
}

export async function unwrapDemoToken(env: Env, token: string): Promise<{ claims: DemoClaims; inner: string } | null> {
  if (!token.startsWith(DEMO_TOKEN_PREFIX)) return null;
  const tilde = token.indexOf('~');
  if (tilde < 0) return null;
  const head = token.slice(DEMO_TOKEN_PREFIX.length, tilde);
  const inner = token.slice(tilde + 1);
  const m = /^([a-f0-9]{16,64})\.(\d{1,9})\.(\d{10,15})\.([a-f0-9]{40})$/.exec(head);
  if (!m || !inner) return null;
  const [, fp, gen, exp, sig] = m;
  const expected = (await hmacHex(gatewaySecret(env), `${fp}.${gen}.${exp}`)).slice(0, 40);
  if (!constantTimeEqual(sig, expected)) return null;
  return { claims: { fp, gen: Number(gen), exp: Number(exp) }, inner };
}

/** Localhost, LAN, sandbox previews and non-production environments. */
/** Loopback or private-LAN host: a developer machine, never a public deployment. */
export function isDevMachineHost(url: URL): boolean {
  const h = url.hostname.toLowerCase();
  return (
    h === 'localhost' || h === '0.0.0.0' || h === '[::1]' || h === '::1' ||
    h.endsWith('.localhost') || h.startsWith('127.') || h.startsWith('10.') ||
    h.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  );
}

export function isLocalOrPreview(url: URL, env: Env): boolean {
  const h = url.hostname.toLowerCase();
  if (env.ENVIRONMENT && env.ENVIRONMENT !== 'production') return true;
  return (
    h === 'localhost' ||
    h === '0.0.0.0' ||
    h === '[::1]' ||
    h === '::1' ||
    h.endsWith('.localhost') ||
    h.endsWith('.local') ||
    h.startsWith('127.') ||
    h.startsWith('10.') ||
    h.startsWith('192.168.') ||
    h.startsWith('169.254.') ||
    h.endsWith('.e2b.app') ||
    h.endsWith('.workers.dev')
  );
}

function hubStub(env: Env, name: string): DurableObjectStub | null {
  const ns = (env as any).DEMO_HUB as DurableObjectNamespace | undefined;
  if (!ns) return null;
  return ns.get(ns.idFromName(name));
}

async function callHub(stub: DurableObjectStub, path: string, body?: unknown): Promise<any> {
  const res = await stub.fetch(`https://demo-hub${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }));
}

/**
 * Durable Object stubs are request-bound I/O objects: each request carries
 * its own stub in async-local storage, while the proxy object itself is
 * shared per sandbox generation so per-DB memo caches (schema checks…) work.
 */
const requestStub = new AsyncLocalStorage<DurableObjectStub>();
const transport: DemoTransport = (op, payload) => {
  const stub = requestStub.getStore();
  if (!stub) return Promise.resolve({ ok: false, error: 'Sandbox indisponible (contexte de requête manquant)' });
  return callHub(stub, `/${op}`, payload);
};

function withSandboxStub<T>(env: Env, claims: DemoClaims, fn: () => T): T | null {
  const stub = hubStub(env, `demo:${claims.fp}`);
  if (!stub) return null;
  return requestStub.run(stub, fn);
}

const demoDbs = new Map<string, DemoD1>();

function demoDbFor(env: Env, claims: DemoClaims): DemoD1 | null {
  if (!(env as any).DEMO_HUB) return null;
  const key = `${claims.fp}:${claims.gen}`;
  const hit = demoDbs.get(key);
  if (hit) return hit;
  const db = new DemoD1(transport, key);
  demoDbs.set(key, db);
  if (demoDbs.size > 64) {
    const first = demoDbs.keys().next().value;
    if (first) demoDbs.delete(first);
  }
  return db;
}

function clientIp(req: Request): string {
  return (req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For')?.split(',')[0] || 'unknown').trim();
}

async function fingerprintHash(req: Request, body: Record<string, unknown>): Promise<string> {
  const fp = String(body.fingerprint || req.headers.get('X-Device-Fingerprint') || '').trim();
  const stable = fp && fp !== 'none' ? `fp:${fp.slice(0, 128)}` : `ipua:${clientIp(req)}|${(req.headers.get('User-Agent') || '').slice(0, 200)}`;
  return (await sha256Hex(`atlas-demo-fingerprint|${stable}`)).slice(0, 32);
}

function demoInfo(meta: { started_at: number; expires_at: number; retry_at?: number }, state: string) {
  return {
    active: true,
    state,
    minutes: DEMO_SESSION_MINUTES,
    window_hours: DEMO_WINDOW_HOURS,
    started_at: meta.started_at,
    expires_at: meta.expires_at,
    retry_at: meta.retry_at,
    message: demoIntroMessage(),
  };
}

async function runInSandbox(app: AppFetch, env: Env, ctx: ExecutionContext, claims: DemoClaims, req: Request): Promise<Response> {
  const db = demoDbFor(env, claims);
  if (!db) return json({ success: false, code: 'DEMO_UNAVAILABLE', error: 'Le mode démo est indisponible sur ce déploiement.' }, 503);
  const sandboxKey = `${claims.fp}:${claims.gen}`;
  const demoEnv = await buildDemoEnv(env, db as unknown as D1Database, sandboxKey);
  const aiGate = await configureDemoAi(env, demoEnv, sandboxKey, req);
  if (aiGate) return aiGate;
  const res = withSandboxStub(env, claims, () => runInDataScope(`demo:${sandboxKey}`, async () => {
    try {
      return await app(req, demoEnv, ctx);
    } catch (e) {
      if ((e as any)?.code === 'DEMO_EXPIRED') return expiredResponse();
      throw e;
    }
  }));
  if (!res) return json({ success: false, code: 'DEMO_UNAVAILABLE', error: 'Le mode démo est indisponible.' }, 503);
  return rewrapTokens(env, claims, await res);
}

/** Inject only the dedicated demo credential on assistant routes, with a
 * fail-closed request budget before invoking the provider. */
export async function configureDemoAi(env: Env, demoEnv: Env, sandboxKey: string, req: Request): Promise<Response | null> {
  const path = new URL(req.url).pathname;
  const demoGroq = String(env.DEMO_GROQ_API_KEY || env.GROQ_API_KEY || '').trim();
  const chat = req.method === 'POST' && (path === '/api/assist/chat' || path === '/api/assist/chat/stream');
  const status = req.method === 'GET' && (path === '/api/assist/status' || path === '/api/settings/assist-provider');
  if (demoGroq && (chat || status)) {
    if (chat) {
      // Count requests before any provider call, including failures. Both limits
      // are shared durable counters; do not rely on the demo owner's unlimited quota.
      try {
        for (const [name, max] of [[`demo-ai-session:${sandboxKey}`, 5], ['demo-ai-global', 20]] as const) {
          const stub = hubStub(env, name);
          if (!stub || (await callHub(stub, '/ip-quota', { max }))?.ok !== true) {
            const lang = (req.headers.get('Accept-Language') || '').toLowerCase();
            const error = lang.startsWith('ar') ? 'بلغت النسخة التجريبية حد استخدام Atlas Agent. استضف خادمك الخاص أو حاول مجددًا بعد منتصف الليل بالتوقيت العالمي.' : lang.startsWith('en') ? 'The demo Atlas Agent limit has been reached. Self-host your own server or try again after midnight UTC.' : 'La limite de l’Agent en démo est atteinte. Hébergez votre propre serveur ou réessayez après minuit UTC.';
            const resetAt = new Date(); resetAt.setUTCHours(24, 0, 0, 0);
            return json({ success: false, code: 'DEMO_AI_QUOTA', error, resets_at: resetAt.toISOString() }, 429);
          }
        }
      } catch {
        return json({ success: false, code: 'DEMO_AI_UNAVAILABLE', error: 'Demo AI is temporarily unavailable.' }, 503);
      }
    }
    demoEnv.GROQ_API_KEY = demoGroq;
  }
  return null;
}

/**
 * Session refreshes (/auth/me, role refresh…) hand out new tokens: wrap them
 * again so the client keeps talking to its sandbox.
 */
export async function rewrapTokens(env: Env, claims: DemoClaims, res: Response): Promise<Response> {
  const type = res.headers.get('Content-Type') || '';
  if (!type.includes('application/json') || res.status === 101) return res;
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { return new Response(text, res); }
  let changed = false;
  const patch = async (obj: any) => {
    if (obj && typeof obj === 'object' && typeof obj.token === 'string' && obj.token && !obj.token.startsWith(DEMO_TOKEN_PREFIX) && !obj.token.includes('.')) {
      obj.token = await wrapDemoToken(env, claims, obj.token);
      changed = true;
    }
  };
  await patch(body);
  await patch(body?.data);
  // Report / print link tickets (`?rt=`): opened later in a new tab without any
  // Authorization header, so they must carry the sandbox claims themselves —
  // otherwise the real deployment refuses them (INVALID_TICKET).
  const rt = body?.data?.rt;
  if (typeof rt === 'string' && rt && !rt.startsWith(DEMO_TOKEN_PREFIX)) {
    body.data.rt = await wrapDemoToken(env, claims, rt);
    changed = true;
  }
  const headers = new Headers(res.headers);
  headers.delete('Content-Length');
  return new Response(changed ? JSON.stringify(body) : text, { status: res.status, statusText: res.statusText, headers });
}

/**
 * Actions that need the real deployment's infrastructure (encrypted R2
 * backups / restores). The sandbox has neither the keys nor its own bucket, so
 * answer with a clear demo message instead of a technical secrets error.
 */
const DEMO_OFF_LIMITS: { method: string; re: RegExp }[] = [
  { method: 'POST', re: /^\/api\/admin\/backup-now$/ },
  { method: 'POST', re: /^\/api\/admin\/backups\/restore$/ },
];

export function demoOffLimitsResponse(pathname: string, method: string): Response | null {
  const m = method.toUpperCase();
  if (!DEMO_OFF_LIMITS.some((r) => r.method === m && r.re.test(pathname))) return null;
  return json({
    success: false,
    code: 'DEMO_DISABLED',
    error: 'Indisponible en mode démo : les sauvegardes et restaurations ne concernent que votre vraie base.',
  }, 403);
}

function expiredResponse(): Response {
  return json({
    success: false,
    code: 'DEMO_EXPIRED',
    error: `Votre session de démo (${demoDurationLabel()}) est terminée : la base fictive a été réinitialisée. Revenez dans ${DEMO_WINDOW_HOURS} h pour un nouvel essai.`,
  }, 401);
}

async function handleDemoLogin(
  app: AppFetch,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  body: Record<string, unknown>,
  verifyTurnstile: TurnstileCheck,
): Promise<Response> {
  const native = String(body.client || request.headers.get('X-Atlas-Client') || '').toLowerCase() === 'native';
  const ip = clientIp(request);
  const ts = await verifyTurnstile(env, String(body.turnstile_token || body['cf-turnstile-response'] || ''), ip, native);
  if (!ts.ok) return json({ success: false, code: 'TURNSTILE_FAILED', error: ts.error || 'Vérification anti-robot requise.' }, 403);

  const fp = await fingerprintHash(request, body);
  const stub = hubStub(env, `demo:${fp}`);
  if (!stub) return json({ success: false, code: 'DEMO_UNAVAILABLE', error: 'Le mode démo est indisponible sur ce déploiement.' }, 503);

  const status = await callHub(stub, '/status');
  const hasLive = status?.meta && Date.now() < Number(status.meta.expires_at);
  // Per-network cap protects public deployments. A dev machine (localhost /
  // LAN address) funnels every browser, emulator and phone through the same
  // IP, so the cap would lock local testing after a few devices — skip it
  // there; the per-fingerprint 1 h / 24 h rule still applies.
  if (!hasLive && !isDevMachineHost(new URL(request.url))) {
    const ipStub = hubStub(env, `demo-ip:${(await sha256Hex(`atlas-demo-ip|${ip}`)).slice(0, 32)}`);
    const quota = ipStub ? await callHub(ipStub, '/ip-quota', { max: MAX_NEW_SANDBOXES_PER_IP_PER_DAY }) : { ok: true };
    if (quota && quota.ok === false) {
      return json({ success: false, code: 'DEMO_QUOTA', error: 'Trop de sessions de démo depuis ce réseau aujourd’hui. Réessayez demain.' }, 429);
    }
  }

  const session = await callHub(stub, '/session', {});
  if (!session?.ok) {
    const retryAt = Number(session?.retry_at || 0);
    const wait = retryAt ? formatWait(retryAt - Date.now()) : `${DEMO_WINDOW_HOURS} h`;
    return json({
      success: false,
      code: 'DEMO_QUOTA',
      retry_at: retryAt || undefined,
      error: `Vous avez déjà utilisé votre ${demoDurationLabel()} de démo pour aujourd’hui. Nouvel essai possible dans ${wait}.`,
    }, 429);
  }

  const claims: DemoClaims = { fp, gen: Number(session.gen), exp: Number(session.expires_at) };
  const db = demoDbFor(env, claims);
  if (!db) return json({ success: false, code: 'DEMO_UNAVAILABLE', error: 'Le mode démo est indisponible.' }, 503);

  const loginBody = JSON.stringify({ ...body, username: DEMO_USERNAME, password: DEMO_PASSWORD, turnstile_token: '' });
  const headers = new Headers(request.headers);
  headers.set('Content-Type', 'application/json');
  headers.delete('Content-Length');
  const innerReq = new Request(request.url, { method: 'POST', headers, body: loginBody });

  const sandboxKey = `${claims.fp}:${claims.gen}`;
  const demoEnv = await buildDemoEnv(env, db as unknown as D1Database, sandboxKey);
  const pending = withSandboxStub(env, claims, () => runInDataScope(`demo:${sandboxKey}`, async () => {
    if (!session.seeded) {
      await seedDemoData(db as unknown as D1Database, Date.now());
      await callHub(stub, '/seeded', {});
    }
    return app(innerReq, demoEnv, ctx);
  }));
  if (!pending) return json({ success: false, code: 'DEMO_UNAVAILABLE', error: 'Le mode démo est indisponible.' }, 503);
  const res = await pending;

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok && typeof data.token === 'string' && data.token) {
    data.token = await wrapDemoToken(env, claims, data.token);
    data.display_name = 'Compte démo';
    data.displayName = 'Compte démo'; // native clients read the camelCase field
    data.message = demoIntroMessage();
  }
  data.demo = demoInfo(session, String(session.state));
  return json(data, res.status);
}

/**
 * Returns a Response when the request belongs to the demo sandbox (or is the
 * demo config endpoint); `null` lets the caller serve it normally.
 */
export async function handleDemoRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  app: AppFetch,
  verifyTurnstile: TurnstileCheck,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/')) return null;

  if (url.pathname === '/api/demo/config' && request.method === 'GET') {
    return json({
      success: true,
      data: {
        enabled: !!(env as any).DEMO_HUB,
        highlight: isLocalOrPreview(url, env),
        username: DEMO_USERNAME,
        password: DEMO_PASSWORD,
        minutes: DEMO_SESSION_MINUTES,
        window_hours: DEMO_WINDOW_HOURS,
        message: demoIntroMessage(),
      },
    });
  }

  if (url.pathname === '/api/auth/login' && request.method === 'POST') {
    const body = (await request.clone().json().catch(() => null)) as Record<string, unknown> | null;
    if (body && String(body.username ?? '').trim().toLowerCase() === DEMO_USERNAME && String(body.password ?? '') === DEMO_PASSWORD) {
      return handleDemoLogin(app, request, env, ctx, body, verifyTurnstile);
    }
    return null;
  }

  const auth = request.headers.get('Authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const queryToken = url.searchParams.get('token') || '';
  const ticket = url.searchParams.get('rt') || '';
  const wrapped = bearer.startsWith(DEMO_TOKEN_PREFIX)
    ? bearer
    : queryToken.startsWith(DEMO_TOKEN_PREFIX)
      ? queryToken
      : ticket.startsWith(DEMO_TOKEN_PREFIX) && !bearer && !queryToken
        ? ticket
        : '';
  if (!wrapped) return null;

  const parsed = await unwrapDemoToken(env, wrapped);
  if (!parsed) return json({ success: false, code: 'UNAUTHORIZED', error: 'Session de démo invalide.' }, 401);
  if (Date.now() >= parsed.claims.exp) return expiredResponse();
  if (url.pathname === '/api/demo/session' && request.method === 'GET') {
    try {
      const stub = hubStub(env, `demo:${parsed.claims.fp}`);
      if (!stub) return json({ success: false, code: 'DEMO_UNAVAILABLE' }, 503);
      const status = await callHub(stub, '/status');
      const meta = status?.meta;
      if (status?.ok !== true || !meta) return json({ success: false, code: 'DEMO_UNAVAILABLE' }, 503);
      if (Number(meta.gen) !== parsed.claims.gen || Number(meta.expires_at) !== parsed.claims.exp || Number(status.now) >= Number(meta.expires_at)) return expiredResponse();
      return json({ success: true, data: { expires_at: meta.expires_at, server_now: status.now } });
    } catch { return json({ success: false, code: 'DEMO_UNAVAILABLE' }, 503); }
  }
  const offLimits = demoOffLimitsResponse(url.pathname, request.method);
  if (offLimits) return offLimits;

  const headers = new Headers(request.headers);
  if (bearer === wrapped) headers.set('Authorization', `Bearer ${parsed.inner}`);
  const nextUrl = new URL(request.url);
  if (queryToken === wrapped) nextUrl.searchParams.set('token', parsed.inner);
  const viaTicket = ticket === wrapped && bearer !== wrapped && queryToken !== wrapped;
  if (viaTicket) nextUrl.searchParams.set('rt', parsed.inner);
  const init: RequestInit & { duplex?: string } = { method: request.method, headers, redirect: request.redirect };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    init.duplex = 'half';
  }
  const innerReq = new Request(nextUrl.toString(), init);
  const res = await runInSandbox(app, env, ctx, parsed.claims, innerReq);
  return viaTicket ? relinkTicket(res, parsed.inner, wrapped) : res;
}

/**
 * The combined report links to its sections with the same ticket: swap the
 * inner ticket for the wrapped one so those links stay in the sandbox too.
 */
export async function relinkTicket(res: Response, inner: string, wrapped: string): Promise<Response> {
  const type = res.headers.get('Content-Type') || '';
  if (!type.includes('text/html') || !inner) return res;
  const html = await res.text();
  const headers = new Headers(res.headers);
  headers.delete('Content-Length');
  return new Response(html.split(inner).join(encodeURIComponent(wrapped)), { status: res.status, statusText: res.statusText, headers });
}
