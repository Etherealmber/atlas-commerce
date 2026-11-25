/**
 * DemoHub — one SQLite-backed Durable Object per demo fingerprint
 * (idFromName('demo:' + fingerprintHash)).
 *
 * It holds a small, self-contained copy of the Atlas schema filled with fake
 * data. The real D1 database is never involved: the Worker swaps `env.DB` for
 * a proxy (worker/lib/demo/demoD1.ts) that forwards every statement here.
 *
 * Lifecycle:
 *   POST /session → fresh sandbox (wipe + migrations) or resume, or deny when
 *                   the 20 minutes of the current 24 h window are used up.
 *   POST /seeded  → marks the fake data as inserted.
 *   POST /query | /batch | /exec → D1-shaped execution (rejected once expired).
 *   alarm()       → at the end of the 20 minutes the whole database is wiped;
 *                   only the quota record survives until the 24 h window ends.
 */
import { DEMO_MIGRATIONS } from '../lib/demo/migrations';
import { decideDemoSession, DEMO_SESSION_MS, DEMO_WINDOW_MS, type DemoMeta } from '../lib/demo/policy';
import {
  encodeResult,
  execScript,
  runBatch,
  runStatement,
  type SqlBackend,
  type SqlValue,
  type WireStatement,
} from '../lib/demo/sqlEngine';

const META_KEY = 'demo:meta';

export function durableSqlBackend(state: DurableObjectState): SqlBackend {
  const sql = (state.storage as any).sql;
  return {
    run(query: string, params: SqlValue[]) {
      const cursor = sql.exec(query, ...params);
      const rows = [...cursor.raw()] as SqlValue[][];
      return { columns: [...(cursor.columnNames || [])], rows };
    },
    transaction<T>(fn: () => T): T {
      return (state.storage as any).transactionSync(fn);
    },
  };
}

/** Replays every bundled migration on an empty sandbox. */
export function applyDemoMigrations(backend: SqlBackend): string[] {
  const errors: string[] = [];
  for (const m of DEMO_MIGRATIONS) {
    const r = execScript(backend, m.sql, { tolerant: true });
    for (const e of r.errors) errors.push(`${m.name}: ${e}`);
  }
  return errors;
}

export class DemoHub {
  private meta: DemoMeta | null | undefined;

  constructor(
    private readonly state: DurableObjectState,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _env: unknown,
  ) {}

  private async loadMeta(): Promise<DemoMeta | null> {
    if (this.meta === undefined) this.meta = ((await this.state.storage.get<DemoMeta>(META_KEY)) || null);
    return this.meta;
  }

  private async saveMeta(meta: DemoMeta): Promise<void> {
    this.meta = meta;
    await this.state.storage.put(META_KEY, meta);
  }

  private async wipe(): Promise<void> {
    const keep = await this.loadMeta();
    await this.state.storage.deleteAll();
    if (keep) await this.saveMeta(keep);
  }

  private json(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  }

  private publicMeta(meta: DemoMeta) {
    return {
      gen: meta.gen,
      started_at: meta.started_at,
      expires_at: meta.expires_at,
      retry_at: meta.started_at + DEMO_WINDOW_MS,
      seeded: meta.seeded,
    };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const now = Date.now();
    const path = url.pathname;

    if (request.method === 'POST' && path.endsWith('/session')) {
      const meta = await this.loadMeta();
      const decision = decideDemoSession(meta, now);
      if (decision.action === 'denied') {
        return this.json({ ok: false, state: 'denied', retry_at: decision.retry_at });
      }
      if (decision.action === 'active' && meta) {
        return this.json({ ok: true, state: 'active', ...this.publicMeta(meta) });
      }
      await this.state.storage.deleteAll();
      const fresh: DemoMeta = {
        started_at: now,
        expires_at: now + DEMO_SESSION_MS,
        gen: (meta?.gen || 0) + 1,
        seeded: false,
      };
      const errors = applyDemoMigrations(durableSqlBackend(this.state));
      await this.saveMeta(fresh);
      await this.state.storage.setAlarm(fresh.expires_at);
      return this.json({ ok: true, state: 'new', migration_errors: errors.slice(0, 5), ...this.publicMeta(fresh) });
    }

    if (request.method === 'POST' && path.endsWith('/seeded')) {
      const meta = await this.loadMeta();
      if (meta) await this.saveMeta({ ...meta, seeded: true });
      return this.json({ ok: true });
    }

    if (request.method === 'POST' && path.endsWith('/ip-quota')) {
      // Separate instance per network (demo-ip:<hash>): caps new sandboxes/day.
      const body = (await request.json().catch(() => ({}))) as { max?: number };
      const max = Math.max(1, Number(body.max) || 8);
      const day = new Date(now).toISOString().slice(0, 10);
      const rec = ((await this.state.storage.get<{ day: string; count: number }>('ipq')) || { day, count: 0 });
      const cur = rec.day === day ? rec.count : 0;
      if (cur >= max) return this.json({ ok: false, count: cur });
      await this.state.storage.put('ipq', { day, count: cur + 1 });
      return this.json({ ok: true, count: cur + 1 });
    }

    if (request.method === 'GET' && path.endsWith('/status')) {
      const meta = await this.loadMeta();
      return this.json({ ok: true, meta: meta ? this.publicMeta(meta) : null, now });
    }

    if (request.method === 'POST' && (path.endsWith('/query') || path.endsWith('/batch') || path.endsWith('/exec'))) {
      const meta = await this.loadMeta();
      if (!meta || meta.wiped || now >= meta.expires_at) return this.json({ ok: false, expired: true }, 410);
      const body = (await request.json().catch(() => ({}))) as any;
      const backend = durableSqlBackend(this.state);
      try {
        if (path.endsWith('/query')) {
          const stmt = body as WireStatement;
          return this.json({ ok: true, result: encodeResult(runStatement(backend, String(stmt.sql || ''), stmt.params || [])) });
        }
        if (path.endsWith('/batch')) {
          const list = (Array.isArray(body.statements) ? body.statements : []) as WireStatement[];
          return this.json({ ok: true, results: runBatch(backend, list).map(encodeResult) });
        }
        const r = backend.transaction(() => execScript(backend, String(body.sql || '')));
        return this.json({ ok: true, count: r.count });
      } catch (e) {
        return this.json({ ok: false, error: String((e as Error)?.message || e).slice(0, 500) });
      }
    }

    return this.json({ ok: false, error: 'not_found' }, 404);
  }

  /** End of the 20 minutes: drop every table, keep only the quota record. */
  async alarm(): Promise<void> {
    const meta = await this.loadMeta();
    if (!meta) return;
    if (Date.now() < meta.expires_at - 1000) {
      await this.state.storage.setAlarm(meta.expires_at);
      return;
    }
    await this.wipe();
    await this.saveMeta({ ...meta, wiped: true, seeded: false });
  }
}
