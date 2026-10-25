/**
 * v260 — crash & user reports test suite (docs/reports-github.md).
 *
 * Covers: sanitization (secret redaction + truncation), fingerprint stability,
 * D1 intake (insert + dedup counter), queueing without a GitHub token,
 * draining with a stubbed GitHub API (create → linked, failure → stays
 * pending), token precedence (env > app) and the admin list view.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = (await import(SQLITE_MODULE)) as { DatabaseSync: new (path: string) => any };

import {
  ensureReportTables,
  fingerprintOf,
  githubConfig,
  listReports,
  redactSecrets,
  reportCrash,
  reportUser,
  retryPendingReports,
  sanitizeCrashPayload,
  saveGithubConfig,
} from '../lib/reports';

function makeD1() {
  const sqlite = new DatabaseSync(':memory:');
  const db = {
    prepare(sql: string) {
      let params: any[] = [];
      const api: any = {
        bind(...p: any[]) { params = p; return api; },
        async run() {
          const r = sqlite.prepare(sql).run(...(params as any));
          return { success: true, meta: { changes: Number(r.changes || 0), last_row_id: Number(r.lastInsertRowid || 0) } };
        },
        async first() { return sqlite.prepare(sql).get(...(params as any)) ?? null; },
        async all() { return { results: sqlite.prepare(sql).all(...(params as any)) }; },
      };
      return api;
    },
  };
  return { db: db as unknown as D1Database, sqlite };
}

const CRASH = {
  message: 'Cannot read properties of undefined (reading \'total\')',
  stack: "TypeError: boom\n    at Dashboard (https://stock.afmarbre.com/assets/Dashboard-abc.js:10:5)\n    at render (x.js:1:1)\n    at y (x.js:2:2)\n    at z (x.js:3:3)",
  route: '/dashboard',
  version: '0.5.9-beta',
  ua: 'TestBrowser/1.0',
};

let made: ReturnType<typeof makeD1>;

beforeEach(async () => {
  made = makeD1();
  await ensureReportTables(made.db);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sanitization', () => {
  it('redacts bearer tokens, JWTs, github/atlas/groq/resend keys and long blobs', () => {
    const dirty = [
      'Authorization: Bearer abc123.DEF-456_xyz',
      'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJoYWNrZXIifQ.c2lnbmF0dXJlLXBhcnQ',
      'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      'github_pat_11AAAAAAAAA0Bbbbbbbbb_CCCCCCCCCCCCCCCCCCCCCC',
      'atlas_livekey123456',
      'gsk_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345',
      're_1234567890_AbCdEfGhIjKlMnOpQrStUvWx',
      'data:image/png;base64,' + 'A'.repeat(200),
    ].join(' | ');
    const clean = redactSecrets(dirty);
    expect(clean).not.toMatch(/Bearer abc123/);
    expect(clean).not.toMatch(/eyJhbGci/);
    expect(clean).not.toMatch(/ghp_/);
    expect(clean).not.toMatch(/github_pat_/);
    expect(clean).not.toMatch(/atlas_livekey/);
    expect(clean).not.toMatch(/gsk_/);
    expect(clean).not.toMatch(/re_1234567890/);
    expect(clean).not.toMatch(/A{120}/);
    expect(clean).toMatch(/\[REDACTED\]/);
  });

  it('keeps ordinary text intact', () => {
    expect(redactSecrets('Erreur sur /dashboard en cliquant sur "Valider"')).toBe('Erreur sur /dashboard en cliquant sur "Valider"');
  });

  it('truncates and defaults crash fields', () => {
    // realistic prose (spaces break the long-blob redaction pattern, so the
    // truncation limits are what apply)
    const p = sanitizeCrashPayload({ message: 'erreur calcul total '.repeat(60), stack: 'at frame (x.js:1:1) '.repeat(500), route: '/page/very/deep '.repeat(40) });
    expect(p.message.length).toBe(400);
    expect(p.stack.length).toBe(4000);
    expect(p.route.length).toBe(200);
    expect(sanitizeCrashPayload({}).message).toBe('Erreur inconnue');
    // opaque long blobs (data URLs, dumped keys) are redacted before truncation
    expect(sanitizeCrashPayload({ message: 'A'.repeat(300) }).message).toBe('[REDACTED]');
  });
});

describe('fingerprint', () => {
  it('is stable for same message+frames and differs across bugs', async () => {
    const a = sanitizeCrashPayload(CRASH);
    const b = sanitizeCrashPayload({ ...CRASH, route: '/other', version: '9.9.9' });
    const c = sanitizeCrashPayload({ ...CRASH, message: 'Autre erreur' });
    expect(await fingerprintOf(a)).toBe(await fingerprintOf(b)); // route/version do not split bugs
    expect(await fingerprintOf(a)).not.toBe(await fingerprintOf(c));
    expect((await fingerprintOf(a)).length).toBe(16);
  });
});

describe('intake without a GitHub token (queueing)', () => {
  it('stores a crash as pending, dedups repeats with a counter', async () => {
    const first = await reportCrash(made.db, { DB: made.db }, CRASH, '1.2.3.4');
    expect(first.id).toBeGreaterThan(0);
    expect(first.deduped).toBe(false);
    const again = await reportCrash(made.db, { DB: made.db }, { ...CRASH, route: '/elsewhere' }, '1.2.3.4');
    expect(again.id).toBe(first.id);
    expect(again.deduped).toBe(true);
    const row = await made.db.prepare(`SELECT count, status, ip_hash FROM crash_reports WHERE id = ?`).bind(first.id).first() as any;
    expect(Number(row.count)).toBe(2);
    expect(row.status).toBe('pending');
    expect(row.ip_hash).not.toMatch(/1\.2\.3\.4/); // hashed, never plain
    expect(String(row.ip_hash).length).toBe(16);
  });

  it('stores a user report as pending with an R- reference', async () => {
    const out = await reportUser(made.db, { DB: made.db }, {
      username: 'Yasmine', role: 'admin', kind: 'bug', message: 'Le total ne s’affiche plus', contact: 'y@example.ma', page: '/dashboard', version: '0.5.9-beta',
    });
    expect(out.reference).toMatch(/^R-\d+$/);
    expect(out.issue_url).toBe('');
    const row = await made.db.prepare(`SELECT username, status FROM user_reports WHERE id = ?`).bind(Number(out.reference.slice(2))).first() as any;
    expect(row.username).toBe('yasmine');
    expect(row.status).toBe('pending');
  });

  it('retryPendingReports skips cleanly without a token', async () => {
    await reportCrash(made.db, { DB: made.db }, CRASH, '9.9.9.9');
    const r = await retryPendingReports({ DB: made.db });
    expect(r).toEqual({ crashes: 0, user_reports: 0, skipped: true });
  });
});

describe('github config precedence', () => {
  it('env secret wins over the app-configured token; default repo', async () => {
    await saveGithubConfig(made.db, 'app-token-123', 'Etherealmber/other-repo');
    const appCfg = await githubConfig({ DB: made.db });
    expect(appCfg).toEqual({ token: 'app-token-123', repo: 'Etherealmber/other-repo', source: 'app' });
    const envCfg = await githubConfig({ DB: made.db, GITHUB_ISSUE_TOKEN: 'env-token' });
    expect(envCfg.source).toBe('env');
    expect(envCfg.token).toBe('env-token');
    expect(envCfg.repo).toBe('Etherealmber/atlas-commerce');
    const none = await githubConfig({ DB: makeD1().db });
    expect(none).toEqual({ token: '', repo: 'Etherealmber/atlas-commerce', source: null });
  });
});

describe('github sync with a stubbed API', () => {
  function stubGithub(opts: { createOk?: boolean } = {}) {
    const calls: { method: string; url: string }[] = [];
    const original = globalThis.fetch;
    const stub = vi.fn(async (input: any, init: any) => {
      const url = String(input);
      const method = String(init?.method || 'GET');
      calls.push({ method, url });
      const respond = (status: number, body: any) => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      }) as unknown as Response;
      if (url.includes('/search/issues')) return respond(200, { items: [] });
      if (url.endsWith('/labels')) return respond(422, { message: 'exists' });
      if (url.endsWith('/issues') && method === 'POST') {
        return opts.createOk === false
          ? respond(403, { message: 'rate limited' })
          : respond(201, { number: 42, html_url: 'https://github.com/Etherealmber/atlas-commerce/issues/42' });
      }
      return respond(200, {});
    });
    vi.stubGlobal('fetch', stub);
    return { calls, restore: () => vi.stubGlobal('fetch', original) };
  }

  it('creates a labeled issue and links the crash row', async () => {
    stubGithub();
    const out = await reportCrash(made.db, { DB: made.db, GITHUB_ISSUE_TOKEN: 'tok' }, CRASH, '5.5.5.5');
    expect(out.issue_url).toBe('https://github.com/Etherealmber/atlas-commerce/issues/42');
    const row = await made.db.prepare(`SELECT status, issue_number, issue_url FROM crash_reports WHERE id = ?`).bind(out.id).first() as any;
    expect(row.status).toBe('linked');
    expect(Number(row.issue_number)).toBe(42);
    // second occurrence links to the SAME issue (search stub returns [] → dedup by D1 fingerprint)
    const again = await reportCrash(made.db, { DB: made.db, GITHUB_ISSUE_TOKEN: 'tok' }, CRASH, '5.5.5.5');
    expect(again.deduped).toBe(true);
    expect(again.issue_url).toBe(out.issue_url);
  });

  it('creates an issue for a user report', async () => {
    stubGithub();
    const out = await reportUser(made.db, { DB: made.db, GITHUB_ISSUE_TOKEN: 'tok' }, {
      username: 'owner', role: 'owner', kind: 'feedback', message: 'Ajouter un export CSV des devis',
    });
    expect(out.issue_url).toContain('/issues/42');
    const row = await made.db.prepare(`SELECT status FROM user_reports WHERE id = ?`).bind(Number(out.reference.slice(2))).first() as any;
    expect(row.status).toBe('linked');
  });

  it('GitHub failure keeps the report pending (never lost)', async () => {
    stubGithub({ createOk: false });
    const out = await reportCrash(made.db, { DB: made.db, GITHUB_ISSUE_TOKEN: 'tok' }, CRASH, '6.6.6.6');
    expect(out.issue_url).toBe('');
    const row = await made.db.prepare(`SELECT status FROM crash_reports WHERE id = ?`).bind(out.id).first() as any;
    expect(row.status).toBe('pending');
  });

  it('retryPendingReports drains the queue once GitHub answers', async () => {
    // queue two reports without token
    await reportCrash(made.db, { DB: made.db }, CRASH, '7.7.7.7');
    await reportUser(made.db, { DB: made.db }, { username: 'u', role: 'staff', kind: 'bug', message: 'Bouton bloqué sur la vente rapide' });
    stubGithub();
    const r = await retryPendingReports({ DB: made.db, GITHUB_ISSUE_TOKEN: 'tok' });
    expect(r.skipped).toBe(false);
    expect(r.crashes).toBe(1);
    expect(r.user_reports).toBe(1);
    const left = await listReports(made.db);
    expect(left.pending).toBe(0);
  });
});

describe('admin list view', () => {
  it('returns recent crashes, user reports and the pending count', async () => {
    await reportCrash(made.db, { DB: made.db }, CRASH, '8.8.8.8');
    await reportUser(made.db, { DB: made.db }, { username: 'u', role: 'staff', kind: 'other', message: 'Question sur la TVA' });
    const view = await listReports(made.db, 10);
    expect(view.crashes.length).toBe(1);
    expect(view.user_reports.length).toBe(1);
    expect(view.pending).toBe(2);
    expect(view.crashes[0].message).toBe(CRASH.message);
  });
});
