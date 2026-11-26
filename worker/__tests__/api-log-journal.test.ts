/**
 * Journal des appels API: every /api/* call (failures included) is journaled
 * with Cloudflare's geo / operator data, VPN-like networks are flagged, rows
 * older than 30 days are purged, and « Expliquer » always answers (Groq, or
 * the deterministic fallback).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  classifyNetwork, geoFromCf, normalizeApiPath, shouldLogApiCall, writeApiLog, purgeOldLogs, geoForIps, ensureApiLogTable,
} from '../lib/apiLog';
import { explainLogLine, ruleExplanation } from '../lib/auditExplain';

const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };

function makeD1() {
  const sqlite = new DatabaseSync(':memory:');
  const db: any = {
    prepare(sql: string) {
      let params: any[] = [];
      const api: any = {
        bind(...p: any[]) { params = p; return api; },
        async run() { const r = sqlite.prepare(sql).run(...params); return { success: true, meta: { changes: Number(r.changes || 0) } }; },
        async first() { const r = sqlite.prepare(sql).get(...params); return r === undefined ? null : { ...r }; },
        async all() { return { success: true, results: sqlite.prepare(sql).all(...params).map((r: any) => ({ ...r })) }; },
      };
      return api;
    },
  };
  return { db, sqlite };
}

const baseRow = {
  method: 'GET', path: '/api/invoices/62', status: 200, ms: 12, username: 'owner', role: 'owner', ip: '196.64.1.2',
  ua: 'Mozilla', request_id: 'req-1', surface: 'web', country: 'MA', city: 'Casablanca', region: 'Casablanca-Settat', asn: 36903, as_org: 'Maroc Telecom',
};

describe('API journal', () => {
  it('classifies VPN, proxy, hosting, mobile and residential networks', () => {
    expect(classifyNetwork('Datacamp Limited', 212238)).toMatchObject({ kind: 'vpn', risky: true });
    expect(classifyNetwork('NordVPN S.A.', 0).kind).toBe('vpn');
    expect(classifyNetwork('Bright Data Ltd', 0).kind).toBe('proxy');
    expect(classifyNetwork('DigitalOcean, LLC', 14061)).toMatchObject({ kind: 'hosting', risky: true });
    expect(classifyNetwork('Maroc Telecom', 36903)).toMatchObject({ kind: 'mobile', risky: false });
    expect(classifyNetwork('Free SAS', 12322)).toMatchObject({ kind: 'residential', risky: false });
    expect(classifyNetwork(null, null).kind).toBe('unknown');
    expect(classifyNetwork(null, null, '127.0.0.1').label).toBe('Réseau local');
    expect(classifyNetwork(null, null, '192.168.1.20').label).toBe('Réseau local');
    expect(classifyNetwork(null, null, '41.250.10.1').label).toBe('Inconnu');
  });

  it('reads Cloudflare request.cf and normalises paths', () => {
    expect(geoFromCf({ country: 'MA', city: 'Rabat', asn: 6713, asOrganization: 'IAM' })).toEqual({ country: 'MA', city: 'Rabat', region: null, asn: 6713, as_org: 'IAM' });
    expect(geoFromCf(undefined)).toEqual({ country: null, city: null, region: null, asn: null, as_org: null });
    expect(normalizeApiPath('/api/invoices/62/pdf?x=1')).toBe('/api/invoices/:id/pdf');
    expect(shouldLogApiCall('/api/health', '')).toBe(false);
    expect(shouldLogApiCall('/api/products', 'Bearer atlasdemo.x.y')).toBe(false);
    expect(shouldLogApiCall('/api/products', 'Bearer abc')).toBe(true);
  });

  it('writes rows, enriches IPs, and purges api_log + audit_log beyond 30 days', async () => {
    const { db, sqlite } = makeD1();
    await writeApiLog(db, baseRow);
    await writeApiLog(db, { ...baseRow, status: 401, ip: '185.1.1.1', username: null, country: 'NL', city: 'Amsterdam', asn: 212238, as_org: 'Datacamp Limited' });
    const rows = sqlite.prepare('SELECT path, status, country, as_org FROM api_log ORDER BY id').all();
    expect(rows).toHaveLength(2);
    expect(rows[0].path).toBe('/api/invoices/:id');
    expect(rows[1]).toMatchObject({ status: 401, country: 'NL' });

    const geo = await geoForIps(db, ['185.1.1.1', '196.64.1.2', '10.0.0.1']);
    expect(geo.get('185.1.1.1')).toMatchObject({ city: 'Amsterdam', kind: 'vpn', risky: true });
    expect(geo.get('196.64.1.2')).toMatchObject({ city: 'Casablanca', risky: false });
    expect(geo.has('10.0.0.1')).toBe(false);

    sqlite.exec(`CREATE TABLE audit_log (id INTEGER PRIMARY KEY, action TEXT, created_at TEXT DEFAULT (datetime('now')))`);
    sqlite.exec(`INSERT INTO audit_log (action, created_at) VALUES ('old', datetime('now', '-31 days')), ('new', datetime('now'))`);
    sqlite.exec(`UPDATE api_log SET created_at = datetime('now', '-40 days') WHERE id = 1`);
    const purged = await purgeOldLogs(db);
    expect(purged).toEqual({ api: 1, audit: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM api_log').get().n).toBe(1);
    expect(sqlite.prepare('SELECT action FROM audit_log').all().map((r: any) => r.action)).toEqual(['new']);
  });

  it('journals real calls (including a 401) through the worker with geo data, in waitUntil', async () => {
    const { db, sqlite } = makeD1();
    await ensureApiLogTable(db);
    const mod: any = await import('../index');
    const app = mod.default?.fetch ? mod.default : mod.app;
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException() {} };
    const req = new Request('http://test.local/api/products', { headers: { 'CF-Connecting-IP': '185.2.2.2', 'User-Agent': 'curl/8' } });
    Object.defineProperty(req, 'cf', { value: { country: 'NL', city: 'Amsterdam', asn: 9009, asOrganization: 'M247 Europe SRL' } });
    const res = await app.fetch(req, { DB: db, CACHE: {} }, ctx);
    expect(res.status).toBeGreaterThanOrEqual(400);
    await Promise.all(pending);
    const row = sqlite.prepare('SELECT * FROM api_log ORDER BY id DESC LIMIT 1').get();
    expect(row).toMatchObject({ method: 'GET', path: '/api/products', ip: '185.2.2.2', country: 'NL', city: 'Amsterdam', asn: 9009 });
    expect(row.status).toBe(res.status);
    expect(classifyNetwork(row.as_org, row.asn).risky).toBe(true);
  });

  it('« Expliquer » falls back to rules without a key, uses Groq when available, and caches', async () => {
    const line = { kind: 'api' as const, id: 7, method: 'POST', path: '/api/auth/login', status: 401, ip: '185.1.1.1', country: 'NL', city: 'Amsterdam', asn: 212238, as_org: 'Datacamp Limited', ip_recent_failures: 9 };
    const rules = ruleExplanation(line);
    expect(rules.risk).toBe('suspect');
    expect(rules.summary).toMatch(/401/);
    expect((await explainLogLine({}, line)).source).toBe('rules');

    const kv = new Map<string, string>();
    const CACHE: any = { get: async (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => { kv.set(k, v); } };
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: 'Tentatives de connexion refusées depuis un VPN aux Pays-Bas.', risk: 'suspect', advice: 'Bloquez cette IP.' }) } }] }), { status: 200 }));
    const { db } = makeD1();
    const env = { GROQ_API_KEY: 'k', CACHE, DB: db };
    await db.prepare('CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)').run();
    const first = await explainLogLine(env, line, fetcher);
    expect(first).toMatchObject({ source: 'groq', risk: 'suspect' });
    const second = await explainLogLine(env, line, fetcher);
    expect(second.source).toBe('cache');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const requestBody = JSON.stringify(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)));
    expect(requestBody).not.toContain('185.1.1.1');
    expect(requestBody).not.toContain('/api/auth/login');
    expect(requestBody).not.toContain('Amsterdam');
    const auditFetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: 'Agent event.', risk: 'normal', advice: 'Review.' }) } }] }), { status: 200 }));
    await explainLogLine({ GROQ_API_KEY: 'k' }, { kind: 'audit', id: 44, action: 'assist.chat.stream', ip: '192.0.2.4', detail: 'sensitive', status: 200 }, auditFetcher);
    const auditBody = JSON.parse(String(auditFetcher.mock.calls[0][1].body));
    const data = JSON.parse(auditBody.messages[1].content);
    expect(data).toMatchObject({ kind: 'audit', action: 'assist.chat.stream', status: null, method: null });
    expect(JSON.stringify(auditBody)).not.toContain('192.0.2.4');
    expect(JSON.stringify(auditBody)).not.toContain('sensitive');
    expect(auditBody.messages[0].content).toContain('ne dis jamais que la requête a réussi ou échoué');
    const arabicRules = await explainLogLine({}, { ...line, language: 'ar' });
    const englishRules = await explainLogLine({}, { ...line, language: 'en' });
    expect(arabicRules.summary).toContain('الحدث');
    expect(englishRules.summary).toContain('Recorded event');
    const english = await explainLogLine(env, { ...line, language: 'en' }, fetcher);
    expect(english.source).toBe('groq');
    expect(fetcher).toHaveBeenCalledTimes(2);

    const limited = vi.fn(async () => new Response('{}', { status: 429, headers: { 'retry-after': '120' } }));
    expect((await explainLogLine({ ...env, CACHE: undefined }, { ...line, id: 8 }, limited)).source).toBe('rules');
    // Paused after a 429: no further upstream call.
    await explainLogLine({ ...env, CACHE: undefined }, { ...line, id: 9 }, limited);
    expect(limited).toHaveBeenCalledTimes(1);
  });
});

describe('pending QR polling journal policy', () => {
  it('omits only successful, unclaimed pending status reads, not failures or transitions', async () => {
    const { isIdleQrPoll } = await import('../lib/apiLog');
    const path = '/api/auth/qr/session/opaque-token';
    const body = (status: string, has_device = false) => Response.json({ success: true, data: { status, has_device } });
    expect(await isIdleQrPoll('GET', path, 200, body('pending'))).toBe(true);
    expect(await isIdleQrPoll('GET', path, 200, body('pending', true))).toBe(false);
    for (const state of ['claimed', 'approved', 'denied', 'expired', 'consumed']) expect(await isIdleQrPoll('GET', path, 200, body(state))).toBe(false);
    expect(await isIdleQrPoll('GET', path, 401, body('pending'))).toBe(false);
    expect(await isIdleQrPoll('POST', path, 200, body('pending'))).toBe(false);
    expect(await isIdleQrPoll('GET', `${path}/claim`, 200, body('pending'))).toBe(false);
    expect(await isIdleQrPoll('GET', path, 200, new Response('bad json'))).toBe(false);
  });
});
