import { describe, expect, it, vi } from 'vitest';
import { enqueueAuditShadow, withAuditShadow } from '../lib/auditShadow';
import { verifyJournalPage } from '../lib/journalBackfill';
import { runInDataScope } from '../lib/dataScope';
import { registerDbRoot } from '../lib/schema';

function fixture() {
  const rows = [{ id: 1, username: 'private-user', detail: 'private-detail', action: 'test' }];
  const objects = new Map<string, Uint8Array>();
  const bucket = {
    put: vi.fn(async (path: string, bytes: Uint8Array) => { if (objects.has(path)) return null; objects.set(path, bytes.slice()); return {}; }),
    get: vi.fn(async (path: string) => objects.has(path) ? { arrayBuffer: async () => objects.get(path)!.slice().buffer } : null),
  };
  const db: any = { prepare: () => ({ bind: (after: number, through: number, limit: number) => ({ all: async () => ({ results: rows.filter(r => r.id > after && r.id <= through).slice(0, limit) }) }) }) };
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil(p: Promise<unknown>) { pending.push(p); } };
  const env: any = { DB: db, JOURNAL_AUDIT_SHADOW: '1', JOURNAL_AUDIT_NAMESPACE: 'production-001', JOURNAL_ARCHIVE: bucket, JOURNAL_ENCRYPTION_KEY: btoa('a'.repeat(32)) };
  return { rows, objects, bucket, db, env, ctx, pending };
}

describe('request-scoped audit shadow', () => {
  it('copies a committed row encrypted and read-verifies it without modifying D1', async () => {
    const f = fixture();
    withAuditShadow(f.env, f.ctx, () => enqueueAuditShadow(f.db, 1));
    expect(f.pending).toHaveLength(1);
    await Promise.all(f.pending);
    const [key, bytes] = [...f.objects.entries()][0];
    expect(key).toBe('journal-backfill/v1/production-001/audit_log/1.journal');
    expect(new TextDecoder().decode(bytes)).not.toContain('private');
    expect(await verifyJournalPage(f.env, f.db, { namespace: 'production-001', source: 'audit_log', afterId: 0, throughId: 1 })).toMatchObject({ verified: 1 });
    expect(f.rows).toHaveLength(1);
  });
  it('stays off by default and isolates demo or different database requests', async () => {
    const f = fixture();
    withAuditShadow({ ...f.env, JOURNAL_AUDIT_SHADOW: '' }, f.ctx, () => enqueueAuditShadow(f.db, 1));
    runInDataScope('demo:test', () => withAuditShadow(f.env, f.ctx, () => enqueueAuditShadow(f.db, 1)));
    withAuditShadow({ ...f.env, ATLAS_DEMO: '1' }, f.ctx, () => enqueueAuditShadow(f.db, 1));
    withAuditShadow(f.env, f.ctx, () => enqueueAuditShadow({} as D1Database, 1));
    enqueueAuditShadow(f.db, 1);
    expect(f.pending).toHaveLength(0);
    expect(f.bucket.put).not.toHaveBeenCalled();
  });
  it('uses separate namespaces for a routed target, including D1 sessions', async () => {
    const f = fixture(); const source = {} as D1Database; const target = {} as D1Database;
    registerDbRoot(f.db, target);
    const env = { ...f.env, DB: f.db, DB_TARGET: target, JOURNAL_AUDIT_NAMESPACE: 'source-001', JOURNAL_AUDIT_TARGET_NAMESPACE: 'target-001' };
    withAuditShadow(env, f.ctx, () => enqueueAuditShadow(f.db, 1));
    await Promise.all(f.pending);
    expect([...f.objects.keys()][0]).toContain('/target-001/audit_log/1.journal');
    expect(source).not.toBe(target);
  });
  it('reports configuration, missing ids and copy errors without sensitive details', async () => {
    const f = fixture(); const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      withAuditShadow({ ...f.env, JOURNAL_AUDIT_NAMESPACE: '' }, f.ctx, () => enqueueAuditShadow(f.db, 1));
      withAuditShadow(f.env, f.ctx, () => enqueueAuditShadow(f.db, undefined));
      withAuditShadow({ ...f.env, JOURNAL_ENCRYPTION_KEY: '' }, f.ctx, () => enqueueAuditShadow(f.db, 1));
      await Promise.all(f.pending);
      expect(error.mock.calls.map(call => call[0])).toEqual(['audit_shadow_configuration_invalid', 'audit_shadow_missing_id', 'audit_shadow_copy_failed']);
      expect(JSON.stringify(error.mock.calls)).not.toContain('private');
    } finally { error.mockRestore(); }
  });
});

it('wires an actual writeAudit D1 insert to the request-scoped shadow', async () => {
  const { writeAudit } = await import('../lib/authHelpers');
  const f = fixture();
  const generatedRows: any[] = [];
  const db: any = { prepare(sql: string) {
    let params: any[] = [];
    const statement = {
      bind(...args: any[]) { params = args; return statement; },
      async run() {
        if (sql.includes('INSERT INTO audit_log')) {
          generatedRows.push({ id: 42, username: params[0], action: params[2], detail: params[5] });
          return { meta: { last_row_id: 42 } };
        }
        return { meta: {} };
      },
      async first() { return null; },
      async all() {
        if (sql.includes('SELECT * FROM audit_log')) return { results: generatedRows.filter(r => r.id > params[0] && r.id <= params[1]) };
        // Existing columns satisfy the defensive table initialization.
        return { results: [{ name: 'email' }, { name: 'phone' }, { name: 'avatar_url' }, { name: 'notes' }, { name: 'username' }] };
      },
    };
    return statement;
  } };
  const env = { ...f.env, DB: db };
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    await withAuditShadow(env, f.ctx, () => writeAudit(db, { username: 'private-user', action: 'invoice.create', detail: 'private-detail' }));
    await Promise.all(f.pending);
    expect(generatedRows).toHaveLength(1);
    expect([...f.objects.keys()]).toEqual(['journal-backfill/v1/production-001/audit_log/42.journal']);
    expect(spy).not.toHaveBeenCalled();
  } finally { spy.mockRestore(); }
});
