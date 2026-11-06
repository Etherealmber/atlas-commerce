/**
 * v0.7.8 — parité outils du flux Agent (/api/assist/chat/stream).
 *
 * Le jumeau bufferisé (/api/assist/chat) appelle groqChatWithTools avec les
 * outils métier filtrés par rôle (+ outils « savoir ») et renvoie tool_trace.
 * Le flux SSE devait offrir EXACTEMENT la même capacité : ces tests verrouillent
 *  - groqChatStreamWithTools : rounds streamés, tool_calls assemblés depuis les
 *    deltas, exécuteur appelé, trace + usage sommés, repli bufferisé final ;
 *  - la route SSE : mêmes outils role-filtered envoyés à Groq (owner vs stock),
 *    `event: tool` diffusé par exécution, `tool_trace` dans `event: done`,
 *    tokens toujours streamés en direct.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };
import { groqChatStreamWithTools, proposalsFromToolTrace } from '../lib/groq-assist';
import { toolsForRole } from '../lib/agent';

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
const legacyHash = (salt: string, pw: string) => sha256(`pc:${salt}:${pw}`);
let IP = '203.0.113.7';
let ipSeq = 0;

/* ─────────────────────────── niveau lib ─────────────────────────── */

function sseResponse(chunks: any[], status = 200): Response {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

const toolCallDelta = (index: number, id: string, name: string, args: string) => ({
  choices: [{ delta: { tool_calls: [{ index, id, type: 'function', function: { name, arguments: args } }] } }],
});
const contentDelta = (t: string) => ({ choices: [{ delta: { content: t } }] });
const usageChunk = (p: number, c: number) => ({ usage: { prompt_tokens: p, completion_tokens: c } });

describe('groqChatStreamWithTools (lib)', () => {
  it('streame les tokens, exécute l’outil appelé, trace + usage sommés', async () => {
    const bodies: any[] = [];
    let call = 0;
    const fetchImpl = (async (_u: any, init: any) => {
      bodies.push(JSON.parse(init.body));
      call += 1;
      if (call === 1) {
        return sseResponse([
          toolCallDelta(0, 'call_1', 'warehouse_stock', '{"warehouse":"A"}'),
          usageChunk(10, 5),
        ]);
      }
      return sseResponse([contentDelta('Stock: '), contentDelta('42 unités'), usageChunk(20, 7)]);
    }) as unknown as typeof fetch;

    const tokens: string[] = [];
    const tools: any[] = [];
    const out = await groqChatStreamWithTools({
      apiKey: 'k',
      system: 'sys',
      message: 'stock ?',
      tools: [{ type: 'function', function: { name: 'warehouse_stock' } }],
      executor: async (name, args) => ({ ok: true, data: { name, args, qty: 42 } }),
      onToken: (t) => tokens.push(t),
      onTool: (t) => tools.push(t),
      fetchImpl,
    });

    expect(tokens.join('')).toBe('Stock: 42 unités'); // flux vivant conservé
    expect(tools).toEqual([{ name: 'warehouse_stock', ok: true, error: undefined, data: { name: 'warehouse_stock', args: { warehouse: 'A' }, qty: 42 } }]);
    expect(out.tool_trace).toHaveLength(1);
    expect(out.reply).toBe('Stock: 42 unités');
    expect(out.usage).toEqual({ prompt: 30, completion: 12 }); // somme des rounds
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({ stream: true, tool_choice: 'auto' });
    expect(bodies[1].messages.some((m: any) => m.role === 'tool')).toBe(true); // contexte outil rejoué
    expect(bodies[1].messages.find((m: any) => m.role === 'tool').content).toContain('42');
  });

  it('sans tool_calls : un seul round, trace vide', async () => {
    const fetchImpl = (async () => sseResponse([contentDelta('Bonjour !')])) as unknown as typeof fetch;
    const out = await groqChatStreamWithTools({
      apiKey: 'k', system: 's', message: 'm', tools: [], executor: async () => ({ ok: true }), onToken: () => {}, fetchImpl,
    });
    expect(out.reply).toBe('Bonjour !');
    expect(out.tool_trace).toEqual([]);
  });

  it('exécuteur en erreur → trace ok:false + erreur, le flux continue', async () => {
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      if (call === 1) return sseResponse([toolCallDelta(0, 'c1', 'list_low_stock', '{}')]);
      return sseResponse([contentDelta('Réponse finale.')]);
    }) as unknown as typeof fetch;
    const tools: any[] = [];
    const out = await groqChatStreamWithTools({
      apiKey: 'k', system: 's', message: 'm', tools: [], executor: async () => ({ ok: false, error: 'table manquante' }),
      onToken: () => {}, onTool: (t) => tools.push(t), fetchImpl,
    });
    expect(tools[0]).toMatchObject({ name: 'list_low_stock', ok: false, error: 'table manquante' });
    expect(out.tool_trace[0].ok).toBe(false);
    expect(out.reply).toBe('Réponse finale.');
  });
});

/* ─────────────────────────── niveau route SSE ─────────────────────────── */

function makeD1() {
  const sqlite = new DatabaseSync(':memory:');
  const db: any = {
    prepare(sql: string) {
      let params: any[] = [];
      const api: any = {
        bind(...p: any[]) { params = p; return api; },
        async run() {
          const r = sqlite.prepare(sql).run(...(params as any));
          return { success: true, meta: { changes: Number(r.changes || 0), last_row_id: Number(r.lastInsertRowid || 0) } };
        },
        async first() {
          const r = sqlite.prepare(sql).get(...(params as any));
          return r === undefined ? null : { ...(r as any) };
        },
        async all() {
          const rows = sqlite.prepare(sql).all(...(params as any)).map((r: any) => ({ ...r }));
          return { success: true, results: rows, meta: {} };
        },
      };
      return api;
    },
    async batch(stmts: any[]) {
      const out: any[] = [];
      for (const st of stmts) out.push(await st.run());
      return out;
    },
  };
  return { db, sqlite };
}

let db: any;
let sqlite: any;
let app: any;
let env: any;
let groqBodies: any[] = [];

beforeEach(async () => {
  ipSeq += 1;
  IP = `203.0.113.${100 + ipSeq}`;
  const made = makeD1();
  db = made.db;
  sqlite = made.sqlite;
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS company_settings (id INTEGER PRIMARY KEY, company_name TEXT DEFAULT '', email TEXT DEFAULT '');
    INSERT INTO company_settings (id, company_name, email) VALUES (1, 'TestCo', 'main@corp.ma');
    CREATE TABLE IF NOT EXISTS app_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, password_hash TEXT DEFAULT '',
      password_salt TEXT DEFAULT '', role TEXT DEFAULT 'user', display_name TEXT DEFAULT '',
      active INTEGER DEFAULT 1, email TEXT DEFAULT '', created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')), last_login TEXT
    );
    CREATE TABLE IF NOT EXISTS login_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL, fingerprint TEXT DEFAULT '', success INTEGER DEFAULT 0, reputation_delta INTEGER DEFAULT 0, user_agent TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS ip_reputation (ip TEXT PRIMARY KEY, score INTEGER NOT NULL DEFAULT 50, failed_count INTEGER DEFAULT 0, success_count INTEGER DEFAULT 0, blocked_until TEXT, updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS otp_codes (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), UNIQUE(resource_type, resource_id));
    CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TEXT DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS trusted_devices (fingerprint TEXT PRIMARY KEY, label TEXT DEFAULT '', last_ip TEXT DEFAULT '', last_seen TEXT DEFAULT (datetime('now')), created_at TEXT DEFAULT (datetime('now')), biometric_credential_id TEXT DEFAULT '', username TEXT DEFAULT '', user_agent TEXT DEFAULT '', city TEXT DEFAULT '', country TEXT DEFAULT '', resume_until TEXT DEFAULT '');
  `);
  groqBodies = [];
  let call = 0;
  const groqFetch = (async (_u: any, init: any) => {
    groqBodies.push(JSON.parse(init.body));
    call += 1;
    if (call === 1) return sseResponse([toolCallDelta(0, 'call_9', 'get_dashboard_snapshot', '{}')]);
    return sseResponse([contentDelta('Grounded '), contentDelta('answer.')]);
  }) as unknown as typeof fetch;
  vi.stubGlobal('fetch', groqFetch);
  env = {
    DB: db,
    CACHE: {},
    EMAIL: { send: async () => ({}) },
    ADMIN_PASSWORD: 'OwnerPass123!',
    TURNSTILE_SECRET_KEY: '',
    TURNSTILE_SITE_KEY: '',
    GROQ_API_KEY: 'test-key',
  };
  const mod: any = await import('../index');
  app = mod.default?.fetch ? mod.default : mod.app;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function seedUser(username: string, pw: string, role: string) {
  const salt = `s-${username}`;
  const hash = await legacyHash(salt, pw);
  sqlite.exec(
    `INSERT INTO app_users (username, password_salt, password_hash, role, email)
     VALUES ('${username}', '${salt}', '${hash}', '${role}', '${username}@corp.ma')`,
  );
  return hash;
}

function seedDevice(fp: string, username: string) {
  sqlite.exec(
    `INSERT OR REPLACE INTO trusted_devices (fingerprint, username, user_agent, last_ip, last_seen)
     VALUES ('${fp}', '${username}', 'ua', '${IP}', datetime('now'))`,
  );
}

async function tokenFor(username: string, role: string, secretMaterial: string, fp: string) {
  const user = username.toLowerCase();
  const proof = await sha256(`proof|${user}|${role}|${secretMaterial}|${IP}|${fp}`);
  return btoa(unescape(encodeURIComponent(`stock-auth-v2|${user}|${role}|${IP}|${fp}|${proof}`)));
}

async function streamChat(token: string, body: any) {
  const res = await app.fetch(
    new Request('http://test.local/api/assist/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': IP,
        'Accept-Language': 'en',
      },
      body: JSON.stringify(body),
    }),
    env,
  );
  const text = await res.text();
  return { status: res.status, text };
}

const toolNames = (body: any) => (body.tools || []).map((t: any) => t?.function?.name);

describe('POST /api/assist/chat/stream — parité outils (v0.7.8)', () => {
  it('owner : outils métier complets envoyés en flux, event tool + tool_trace dans done', async () => {
    const secret = await seedUser('alice', 'Test1234!', 'owner');
    seedDevice('fpS', 'alice');
    const r = await streamChat(await tokenFor('alice', 'owner', secret, 'fpS'), {
      message: 'give me the grounded dashboard numbers',
      response_language: 'en',
    });
    expect(r.status).toBe(200);
    expect(groqBodies.length).toBe(2); // round outil + round réponse
    const names = toolNames(groqBodies[0]);
    expect(names).toContain('get_dashboard_snapshot');
    expect(names).toContain('list_unpaid_invoices'); // money tools allowed for owner
    expect(groqBodies[0]).toMatchObject({ stream: true, tool_choice: 'auto' });
    expect(r.text).toContain('event: tool');
    expect(r.text).toContain('get_dashboard_snapshot');
    expect(r.text).toContain('event: token');
    const doneLine = r.text.split('\n').find((l: string) => l.startsWith('data:') && l.includes('tool_trace')) || '';
    const done = JSON.parse(doneLine.slice(5).trim());
    expect(done.tool_trace[0].name).toBe('get_dashboard_snapshot');
    expect(done.reply).toBe('Grounded answer.');
  });

  it('stock : outils filtrés par rôle — money tools ABSENTS du flux aussi', async () => {
    const secret = await seedUser('mag', 'Test1234!', 'stock');
    seedDevice('fpS', 'mag');
    const r = await streamChat(await tokenFor('mag', 'stock', secret, 'fpS'), {
      message: 'grounded stock numbers please',
      response_language: 'en',
    });
    expect(r.status).toBe(200);
    const names = toolNames(groqBodies[0]);
    expect(names).toContain('warehouse_stock');
    expect(names).not.toContain('list_unpaid_invoices'); // rôle stock = outils stock uniquement
    expect(names).toEqual(expect.arrayContaining(toolsForRole('stock').map((t: any) => t.function.name)));
    expect(r.text).toContain('event: tool');
  });

  it('sans tool_calls : un seul round Groq, done avec tool_trace vide', async () => {
    const secret = await seedUser('alice2', 'Test1234!', 'owner');
    seedDevice('fpS', 'alice2');
    // le stub rend un tool_call au 1er appel : on recharge un fetch sans outil
    vi.stubGlobal('fetch', (async (_u: any, init: any) => {
      groqBodies.push(JSON.parse(init.body));
      return sseResponse([contentDelta('Plain stream.')]);
    }) as unknown as typeof fetch);
    const r = await streamChat(await tokenFor('alice2', 'owner', secret, 'fpS'), {
      message: 'just chat a bit',
      response_language: 'en',
    });
    expect(r.status).toBe(200);
    expect(groqBodies.length).toBe(1);
    expect(r.text).toContain('event: token');
    const doneLine = r.text.split('\n').find((l: string) => l.startsWith('data:') && l.includes('tool_trace')) || '';
    expect(JSON.parse(doneLine.slice(5).trim()).tool_trace).toEqual([]);
  });
  it('returns the same server-generated proposals in buffered and SSE responses, without changing stock', async () => {
    const secret = await seedUser('planner', 'Test1234!', 'owner');
    seedDevice('fpP', 'planner');
    sqlite.exec(`CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, sku TEXT, stock_quantity REAL);
      INSERT INTO products VALUES (1, 'Produit', 'P1', 20)`);
    vi.stubGlobal('fetch', (async (_u: any, init: any) => {
      const body = JSON.parse(init.body);
      groqBodies.push(body);
      const called = body.messages.some((m: any) => m.role === 'tool');
      const call = { id: 'p1', type: 'function', function: { name: 'propose_inventory_adjustment', arguments: '{"product_id":1,"delta":2}' } };
      if (body.stream) return called
        ? sseResponse([contentDelta('Please review the proposal.'), usageChunk(12, 4)])
        : sseResponse([toolCallDelta(0, call.id, call.function.name, call.function.arguments), usageChunk(10, 3)]);
      return Response.json({ model: 'test', choices: [{ message: called ? { content: 'Please review the proposal.' } : { tool_calls: [call] } }], usage: { prompt_tokens: 10, completion_tokens: 3 } });
    }) as unknown as typeof fetch);
    const token = await tokenFor('planner', 'owner', secret, 'fpP');
    const body = { message: 'propose adding two units', response_language: 'en', task: 'stock', thread_id: 'android-thread' };
    const buffered = await app.fetch(new Request('http://test.local/api/assist/chat', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'CF-Connecting-IP': IP }, body: JSON.stringify(body),
    }), env);
    const json = await buffered.json();
    const streamed = await streamChat(token, body);
    const events = parseEvents(streamed.text);
    const done = events.find((e) => e.event === 'done')!.data;
    expect(json.data.proposals).toHaveLength(1);
    expect(done.proposals).toEqual(json.data.proposals);
    expect(done.proposals[0]).toMatchObject({ type: 'inventory_adjustment', product_id: 1, delta: 2, requires_approval: true });
    expect(done).toMatchObject({ reply: 'Please review the proposal.', thread_id: 'android-thread', task: 'stock', documents: [], usage: { prompt: 22, completion: 7 } });
    expect(events.filter((e) => e.event === 'done')).toHaveLength(1);
    expect(events.find((e) => e.event === 'tool')!.data.proposal).toEqual(done.proposals[0]);
    expect(sqlite.prepare('SELECT stock_quantity FROM products WHERE id = 1').get().stock_quantity).toBe(20);
  });

  it('rejects model-invented calls to disabled tools instead of emitting a proposal', async () => {
    const secret = await seedUser('disabled', 'Test1234!', 'owner');
    seedDevice('fpD', 'disabled');
    sqlite.exec(`CREATE TABLE IF NOT EXISTS agent_tool_prefs (tool TEXT PRIMARY KEY, enabled INTEGER, updated_at TEXT);
      INSERT INTO agent_tool_prefs VALUES ('propose_inventory_adjustment', 0, '')`);
    let round = 0;
    vi.stubGlobal('fetch', (async (_u: any, init: any) => {
      groqBodies.push(JSON.parse(init.body));
      return ++round === 1
        ? sseResponse([toolCallDelta(0, 'disabled-call', 'propose_inventory_adjustment', '{"product_id":1,"delta":2}')])
        : sseResponse([contentDelta('Not allowed.')]);
    }) as unknown as typeof fetch);
    const result = await streamChat(await tokenFor('disabled', 'owner', secret, 'fpD'), { message: 'propose stock change', response_language: 'en' });
    expect(toolNames(groqBodies[0])).not.toContain('propose_inventory_adjustment');
    const done = parseEvents(result.text).find((e) => e.event === 'done')!.data;
    expect(done.proposals).toEqual([]);
    expect(done.tool_trace[0]).toMatchObject({ name: 'propose_inventory_adjustment', ok: false });
  });

  it('streams tokens before the upstream has finished, not only in the final event', async () => {
    const secret = await seedUser('live', 'Test1234!', 'owner');
    seedDevice('fpL', 'live');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const enc = new TextEncoder();
    vi.stubGlobal('fetch', (async () => new Response(new ReadableStream({
      async start(controller) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(contentDelta('Live '))}\n\n`));
        await gate;
        controller.enqueue(enc.encode(`data: ${JSON.stringify(contentDelta('answer.'))}\n\ndata: [DONE]\n\n`));
        controller.close();
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } })) as unknown as typeof fetch);
    const token = await tokenFor('live', 'owner', secret, 'fpL');
    const response = await app.fetch(new Request('http://test.local/api/assist/chat/stream', {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'CF-Connecting-IP': IP },
      body: JSON.stringify({ message: 'live response please', response_language: 'en' }),
    }), env);
    expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    const reader = response.body.getReader();
    let text = '';
    try {
      const first = await reader.read();
      text = new TextDecoder().decode(first.value);
      expect(text).toContain('event: token');
      expect(text).toContain('Live ');
      expect(text).not.toContain('event: done');
    } finally { release(); }
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
    }
    expect(parseEvents(text).find((e) => e.event === 'done')!.data).toMatchObject({ reply: 'Live answer.', proposals: [] });
  });

  it('a stock account cannot execute a money tool even if the model invents the call', async () => {
    const secret = await seedUser('floor', 'Test1234!', 'stock');
    seedDevice('fpF', 'floor');
    let round = 0;
    vi.stubGlobal('fetch', (async () => ++round === 1
      ? sseResponse([toolCallDelta(0, 'forbidden', 'create_invoice_draft', '{}')])
      : sseResponse([contentDelta('Not permitted.')])) as unknown as typeof fetch);
    const response = await streamChat(await tokenFor('floor', 'stock', secret, 'fpF'), { message: 'create invoice', response_language: 'en' });
    const done = parseEvents(response.text).find((e) => e.event === 'done')!.data;
    expect(done.proposals).toEqual([]);
    expect(done.tool_trace[0]).toMatchObject({ name: 'create_invoice_draft', ok: false });
    expect(done.tool_trace[0].error).toContain('non autorisé');
  });

  it('upstream errors terminate with an error event, never a successful done', async () => {
    const secret = await seedUser('errors', 'Test1234!', 'owner');
    seedDevice('fpE', 'errors');
    vi.stubGlobal('fetch', (async () => new Response('unavailable', { status: 500 })) as unknown as typeof fetch);
    const response = await streamChat(await tokenFor('errors', 'owner', secret, 'fpE'), { message: 'answer please', response_language: 'en' });
    const events = parseEvents(response.text);
    expect(events.filter((e) => e.event === 'error')).toHaveLength(1);
    expect(events.some((e) => e.event === 'done')).toBe(false);
    expect(events[0].data.code).toBe('assist_upstream');
  });

  it('failed tools cannot contribute proposals', () => {
    expect(proposalsFromToolTrace([{ name: 'propose_inventory_adjustment', ok: false, proposal: { type: 'forged' } }])).toEqual([]);
  });

});

function parseEvents(text: string): { event: string; data: any }[] {
  return text.trim().split(/\n\n/).map((frame) => ({
    event: frame.split('\n').find((l) => l.startsWith('event:'))!.slice(6).trim(),
    data: JSON.parse(frame.split('\n').find((l) => l.startsWith('data:'))!.slice(5).trim()),
  }));
}
