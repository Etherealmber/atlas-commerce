import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

describe('R2 agent conversation handling & backup cron D1 read reduction', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('purgeAgentConversationsOlderThan paginates using listed.cursor (not boolean listed.truncated)', async () => {
    const { purgeAgentConversationsOlderThan } = await import('../routes/assist');
    const listCursors: Array<string | undefined> = [];
    const deletedKeys: string[] = [];
    const oldDate = new Date(Date.now() - 40 * 86400000).toISOString();

    const env = {
      IMAGES: {
        list: vi.fn(async ({ prefix, cursor }: { prefix: string; cursor?: string }) => {
          listCursors.push(cursor);
          expect(typeof cursor === 'string' || cursor === undefined).toBe(true);
          if (prefix === 'agent/' && !cursor) {
            return {
              objects: [{ key: 'agent/old-1.json', uploaded: oldDate }],
              truncated: true,
              cursor: 'page-2',
            };
          }
          if (prefix === 'agent/' && cursor === 'page-2') {
            return {
              objects: [{ key: 'agent/old-2.json', uploaded: oldDate }],
              truncated: false,
            };
          }
          return { objects: [], truncated: false };
        }),
        delete: vi.fn(async (key: string) => {
          deletedKeys.push(key);
        }),
      },
    };

    const res = await purgeAgentConversationsOlderThan(env, 30);
    expect(res.deleted).toBe(2);
    expect(deletedKeys).toEqual(['agent/old-1.json', 'agent/old-2.json']);
    expect(listCursors).toEqual([undefined, 'page-2', undefined]);
  });

  it('POST /api/assist/chat avoids r2_get on nonexistent thread keys and reads existing transcripts at most once', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            model: 'openai/gpt-oss-20b',
            choices: [{ message: { content: 'Réponse de test.' } }],
            usage: { prompt_tokens: 20, completion_tokens: 10 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    const store = new Map<string, Uint8Array>();
    const r2Get = vi.fn(async (key: string) => {
      const bytes = store.get(key);
      if (!bytes) return null;
      return { etag: Buffer.from(bytes).toString('base64'), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    });
    const r2List = vi.fn(async ({ prefix }: { prefix: string }) => {
      const objects = [...store.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => ({ key: k }));
      return { objects, truncated: false };
    });
    const r2Put = vi.fn(async (key: string, data: Uint8Array, options: any) => {
      const current = store.get(key);
      const condition = options?.onlyIf;
      if (condition instanceof Headers && condition.get('If-None-Match') === '*' && current) return null;
      if (condition?.etagMatches && (!current || Buffer.from(current).toString('base64') !== condition.etagMatches)) return null;
      store.set(key, new Uint8Array(data));
      return { etag: Buffer.from(data).toString('base64') };
    });

    const { registerAssistRoutes } = await import('../routes/assist');
    const app = new Hono<{ Bindings: any }>();
    registerAssistRoutes(app, {
      authFailReason: async () => 'ok',
      sessionUserFromHeader: () => ({ username: 'admin', role: 'admin' }),
      clientIp: () => '127.0.0.1',
      requireOwner: async () => ({ ok: true, username: 'admin', role: 'admin' }),
      requireOwnerOrAdmin: async () => ({ ok: true, username: 'admin', role: 'admin' }),
      writeAudit: async () => {},
      issueDeleteOtp: async () => ({}),
      verifyDeleteOtp: async () => ({ ok: true }),
      userMail: async () => null,
      syncMobileHub: async () => {},
      notifyAssistApproval: async () => {},
    } as any);

    const env = {
      GROQ_API_KEY: 'gsk-test',
      BACKUP_ENCRYPTION_KEY: 'secret-test-key',
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => null,
            all: async () => ({ results: [] }),
            run: async () => ({ success: true }),
          }),
          first: async () => null,
          all: async () => ({ results: [] }),
          run: async () => ({ success: true }),
        }),
      },
      IMAGES: { get: r2Get, list: r2List, put: r2Put },
    };

    const first = await app.request(
      '/api/assist/chat',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Bonjour', thread_id: 'mobile-thread-1' }),
      },
      env as any,
    );
    expect(first.status).toBe(200);
    // Brand-new thread: list finds nothing -> 0 r2_get calls (no 10007 errors)
    expect(r2Get).toHaveBeenCalledTimes(0);
    expect(r2Put).toHaveBeenCalledTimes(1);

    const second = await app.request(
      '/api/assist/chat',
      {
        method: 'POST',
        headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Deuxième tour', thread_id: 'mobile-thread-1' }),
      },
      env as any,
    );
    expect(second.status).toBe(200);
    // Existing thread: 1 r2_get call for loadCompactHistoryWithTranscript, reused by putAgentChatTurn
    expect(r2Get).toHaveBeenCalledTimes(1);
    expect(r2Put).toHaveBeenCalledTimes(2);
    // Reject legacy plaintext, corrupted ciphertext, and storage failures without
    // replacing the existing bytes or sending a prompt without its history.
    const key = 'agent-chats/v2/admin/mobile-thread-1.conv';
    for (const bytes of [new TextEncoder().encode('U|old|private history\n'), new TextEncoder().encode('ACH2broken ciphertext value')]) {
      store.set(key, bytes);
      const response = await app.request('/api/assist/chat', {
        method: 'POST', headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Nouveau tour', thread_id: 'mobile-thread-1' }),
      }, env as any);
      expect(response.status).toBe(502);
      expect(store.get(key)).toEqual(bytes);
      expect(r2Put).toHaveBeenCalledTimes(2);
    }
    const legacy = 'U|2025-01-01T12:00:00.000Z|Private old question\nA|2025-01-01T12:00:01.000Z|Private old answer\n';
    store.set(key, new TextEncoder().encode(legacy));
    const noSecret = await app.request('/api/assist/chat', {
      method: 'POST', headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Bonjour', thread_id: 'mobile-thread-1' }),
    }, { ...env, BACKUP_ENCRYPTION_KEY: '' } as any);
    expect(noSecret.status).toBe(502);
    expect(new TextDecoder().decode(store.get(key))).toBe(legacy);
    r2Put.mockResolvedValueOnce(null); // failed conditional migration
    const conflict = await app.request('/api/assist/chat', {
      method: 'POST', headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Bonjour', thread_id: 'mobile-thread-1' }),
    }, env as any);
    expect(conflict.status).toBe(502);
    expect(new TextDecoder().decode(store.get(key))).toBe(legacy);
    const migrated = await app.request('/api/assist/chat', {
      method: 'POST', headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Bonjour', thread_id: 'mobile-thread-1' }),
    }, env as any);
    expect(migrated.status).toBe(200);
    const encrypted = store.get(key)!;
    expect(new TextDecoder().decode(encrypted.slice(0, 4))).toBe('ACH2');
    expect(new TextDecoder().decode(encrypted)).not.toContain('Private old');
    const read = await app.request('/api/assist/transcripts/get?key=' + encodeURIComponent(key), {
      headers: { Authorization: 'Bearer tok' },
    }, env as any);
    const readData: any = await read.json();
    expect(readData.data.raw).toContain(legacy);
    expect(readData.data.raw).toContain('Bonjour');
    // Wrong key must not reinterpret ciphertext as legacy or replace it.
    const wrongKey = await app.request('/api/assist/chat', {
      method: 'POST', headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Bonjour', thread_id: 'mobile-thread-1' }),
    }, { ...env, BACKUP_ENCRYPTION_KEY: 'different-secret' } as any);
    expect(wrongKey.status).toBe(502);
    expect(store.get(key)).toEqual(encrypted);
    // A concurrent change after the read refuses the append rather than overwriting it.
    r2Put.mockResolvedValueOnce(null);
    const appendConflict = await app.request('/api/assist/chat', {
      method: 'POST', headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Bonjour', thread_id: 'mobile-thread-1' }),
    }, env as any);
    expect(appendConflict.status).toBe(502);
    expect(store.get(key)).toEqual(encrypted);
    // A streaming reply uses the same migration and appends the new turn.
    const streamKey = 'agent-chats/v2/admin/stream-legacy.conv';
    store.set(streamKey, new TextEncoder().encode(legacy));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"Stream answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })));
    const stream = await app.request('/api/assist/chat/stream', {
      method: 'POST', headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Bonjour', thread_id: 'stream-legacy' }),
    }, env as any);
    expect(await stream.text()).toContain('event: done');
    const streamRead = await app.request('/api/assist/transcripts/get?key=' + encodeURIComponent(streamKey), { headers: { Authorization: 'Bearer tok' } }, env as any);
    const streamData: any = await streamRead.json();
    expect(streamData.data.raw).toContain(legacy);
    expect(streamData.data.raw).toContain('Stream answer');
    const putCount = r2Put.mock.calls.length;
    r2List.mockRejectedValueOnce(new Error('storage unavailable'));
    const failedRead = await app.request('/api/assist/chat', {
      method: 'POST', headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Nouveau tour', thread_id: 'mobile-thread-1' }),
    }, env as any);
    expect(failedRead.status).toBe(502);
    expect(r2Put).toHaveBeenCalledTimes(putCount);
  });

  it('POST /api/cron/backup-execute skips redundant D1 table dumps when no business mutation occurred', async () => {
    const { registerBackupRoutes } = await import('../routes/backups');
    const app = new Hono<{ Bindings: any }>();
    registerBackupRoutes(app, {
      requireOwner: () => ({ ok: true, username: 'owner' }),
      hmacSha256Hex: async () => 'hmac',
      writeAudit: async () => {},
      purgeAgentConversationsOlderThan: async () => ({ deleted: 0 }),
    });

    const kvStore = new Map<string, string>();
    const uploads = new Map<string, Date>();
    let d1Queries = 0;
    const env = {
      CRON_SECRET: 'cron-secret',
      BACKUP_ENCRYPTION_KEY: 'bkp-secret',
      CACHE: {
        get: async (k: string, type?: string) => {
          const v = kvStore.get(k);
          if (v === undefined) return null;
          return type === 'json' ? JSON.parse(v) : v;
        },
        put: async (k: string, v: string) => {
          kvStore.set(k, v);
        },
      },
      IMAGES: {
        list: async () => ({ objects: [], truncated: false }),
        put: async (k: string) => { uploads.set(k, new Date()); },
        head: async (k: string) => (uploads.has(k) ? { key: k, uploaded: uploads.get(k) } : null),
      },
      DB: {
        prepare: () => {
          d1Queries++;
          return {
            all: async () => ({ results: [] }),
            first: async () => null,
            run: async () => ({ success: true }),
            bind: () => ({
              all: async () => ({ results: [] }),
              first: async () => null,
              run: async () => ({ success: true }),
            }),
          };
        },
      },
    };

    const run1 = await app.request(
      '/api/cron/backup-execute',
      { method: 'POST', headers: { Authorization: 'Bearer cron-secret' } },
      env as any,
    );
    expect(run1.status).toBe(200);
    const j1 = (await run1.json()) as any;
    expect(j1.skipped).toBe(false);
    const queriesOnFirstRun = d1Queries;
    expect(queriesOnFirstRun).toBeGreaterThan(0);

    const run2 = await app.request(
      '/api/cron/backup-execute',
      { method: 'POST', headers: { Authorization: 'Bearer cron-secret' } },
      env as any,
    );
    expect(run2.status).toBe(200);
    const j2 = (await run2.json()) as any;
    expect(j2.skipped).toBe(true);
    expect(d1Queries).toBe(queriesOnFirstRun);

    // A business write wipes the generation-versioned cache; the 12 h cadence
    // must still hold (it used to re-read every table on the next cron call).
    const { bumpCacheGen } = await import('../lib/cache');
    await bumpCacheGen(env.CACHE as any);
    const run3 = await app.request(
      '/api/cron/backup-execute',
      { method: 'POST', headers: { Authorization: 'Bearer cron-secret' } },
      env as any,
    );
    expect(((await run3.json()) as any).skipped).toBe(true);
    expect(d1Queries).toBe(queriesOnFirstRun);

    // Past the cooldown the next cron call runs again.
    uploads.set('backups/v5/index.abk', new Date(Date.now() - 12 * 3600 * 1000));
    const run4 = await app.request(
      '/api/cron/backup-execute',
      { method: 'POST', headers: { Authorization: 'Bearer cron-secret' } },
      env as any,
    );
    expect(((await run4.json()) as any).skipped).toBe(false);
    expect(d1Queries).toBeGreaterThan(queriesOnFirstRun);
  });

  it('runDailyBackup uses incremental delta queries for append-only tables and skips unchanged R2 writes', async () => {
    const { runDailyBackup, decryptBackupBytes } = await import('../routes/backups');
    const r2Store = new Map<string, { bytes: Uint8Array; uploaded: Date }>();
    let movementRows = [
      { id: 1, product_id: 10, type: 'in', quantity: 5, created_at: '2026-10-01T00:00:00Z' },
    ];
    const queries: string[] = [];

    const env = {
      BACKUP_ENCRYPTION_KEY: 'bkp-secret-incremental',
      IMAGES: {
        get: async (k: string) => {
          const entry = r2Store.get(k);
          if (!entry) return null;
          return { arrayBuffer: async () => entry.bytes.buffer.slice(entry.bytes.byteOffset, entry.bytes.byteOffset + entry.bytes.byteLength) };
        },
        head: async (k: string) => (r2Store.has(k) ? { key: k, size: r2Store.get(k)!.bytes.length } : null),
        put: async (k: string, data: Uint8Array) => {
          r2Store.set(k, { bytes: new Uint8Array(data), uploaded: new Date() });
        },
        list: async ({ prefix = '' }: { prefix?: string }) => ({
          objects: [...r2Store.keys()]
            .filter((k) => k.startsWith(prefix))
            .map((k) => ({ key: k, size: r2Store.get(k)!.bytes.length, uploaded: r2Store.get(k)!.uploaded })),
          truncated: false,
        }),
      },
      DB: {
        prepare: (sql: string) => {
          queries.push(sql);
          const exec = (binds: any[] = []) => ({
            all: async () => {
              if (sql.includes(`sqlite_master`)) {
                return { results: [{ name: 'products' }, { name: 'stock_movements' }, { name: 'app_config' }] };
              }
              if (sql.includes('FROM stock_movements WHERE id > ?')) {
                const afterId = Number(binds[0] || 0);
                return { results: movementRows.filter((r) => r.id > afterId) };
              }
              if (sql.includes('FROM stock_movements')) return { results: [...movementRows] };
              if (sql.includes('FROM products')) return { results: [{ id: 10, name: 'Marbre' }] };
              return { results: [] };
            },
            first: async () => {
              if (sql.includes('MAX(id)') && sql.includes('stock_movements')) {
                return { max_id: movementRows[movementRows.length - 1]?.id || 0 };
              }
              return null;
            },
            run: async () => ({ success: true }),
          });
          return {
            ...exec(),
            bind: (...args: any[]) => exec(args),
          };
        },
      },
    };

    const first = await runDailyBackup(env);
    expect(first.ok).toBe(true);
    expect(first.skipped).toBe(false);
    expect(r2Store.has('backups/v5/index.abk')).toBe(true);
    expect(r2Store.has('backups/v5/tables/stock_movements.abk')).toBe(true);

    queries.length = 0;
    const second = await runDailyBackup(env);
    expect(second.ok).toBe(true);
    expect(second.skipped).toBe(true);
    expect(second.changed_tables).toBe(0);
    // Append-only table probed via MAX(id) instead of scanning all rows
    expect(queries.some((q) => q.includes('SELECT COALESCE(MAX(id), 0) AS max_id FROM stock_movements'))).toBe(true);
    expect(queries.some((q) => q.includes('SELECT * FROM stock_movements LIMIT'))).toBe(false);

    // Append 1 new stock movement -> only id > 1 is read from D1 and merged
    movementRows.push({ id: 2, product_id: 10, type: 'out', quantity: 2, created_at: '2026-10-02T00:00:00Z' });
    queries.length = 0;
    const third = await runDailyBackup(env);
    expect(third.ok).toBe(true);
    expect(third.skipped).toBe(false);
    expect(third.changed_tables).toBe(1);
    expect(queries.some((q) => q.includes('SELECT * FROM stock_movements WHERE id > ?'))).toBe(true);

    const latestObj = r2Store.get('backups/latest.abk')!;
    const decrypted = await decryptBackupBytes(env, latestObj.bytes);
    expect(decrypted.tables.stock_movements.map((r: any) => r.id)).toEqual([1, 2]);
  });

  it('purgeDeletedAccountFromBackups scrubs deleted users from existing backups and blocks restore resurrection', async () => {
    const {
      runDailyBackup,
      purgeDeletedAccountFromBackups,
      decryptBackupBytes,
      restoreFromBackupPayload,
    } = await import('../routes/backups');
    const { DatabaseSync } = await import('node:sqlite');
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      CREATE TABLE app_config (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE app_users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, role TEXT, password_hash TEXT, active INTEGER);
      CREATE TABLE trusted_devices (fingerprint TEXT PRIMARY KEY, username TEXT);
      CREATE TABLE webauthn_credentials (id TEXT PRIMARY KEY, username TEXT);
      INSERT INTO app_users (username, role, password_hash, active) VALUES ('alice', 'stock', 'hash-a', 1), ('bob', 'admin', 'hash-b', 1);
      INSERT INTO trusted_devices (fingerprint, username) VALUES ('fp-a', 'alice'), ('fp-b', 'bob');
      INSERT INTO webauthn_credentials (id, username) VALUES ('cred-a', 'alice');
    `);

    const wrapD1 = () => ({
      prepare: (sql: string) => {
        const exec = (args: any[] = []) => ({
          all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
          first: async () => sqlite.prepare(sql).get(...args) ?? null,
          run: async () => sqlite.prepare(sql).run(...args),
        });
        return { ...exec(), bind: (...args: any[]) => exec(args) };
      },
    });

    const r2Store = new Map<string, { bytes: Uint8Array; uploaded: Date }>();
    r2Store.set('agent-chats/v2/alice/t1.conv', { bytes: new Uint8Array([1, 2, 3]), uploaded: new Date() });
    r2Store.set('agent-chats/v2/bob/t1.conv', { bytes: new Uint8Array([4, 5, 6]), uploaded: new Date() });

    const env = {
      BACKUP_ENCRYPTION_KEY: 'bkp-secret-scrub',
      DB: wrapD1(),
      IMAGES: {
        get: async (k: string) => {
          const entry = r2Store.get(k);
          if (!entry) return null;
          return { arrayBuffer: async () => entry.bytes.buffer.slice(entry.bytes.byteOffset, entry.bytes.byteOffset + entry.bytes.byteLength) };
        },
        head: async (k: string) => (r2Store.has(k) ? { key: k, size: r2Store.get(k)!.bytes.length } : null),
        put: async (k: string, data: Uint8Array) => {
          r2Store.set(k, { bytes: new Uint8Array(data), uploaded: new Date() });
        },
        delete: async (k: string) => {
          r2Store.delete(k);
        },
        list: async ({ prefix = '' }: { prefix?: string }) => ({
          objects: [...r2Store.keys()]
            .filter((k) => k.startsWith(prefix))
            .map((k) => ({ key: k, size: r2Store.get(k)!.bytes.length, uploaded: r2Store.get(k)!.uploaded })),
          truncated: false,
        }),
      },
    };

    // Snapshot while alice still exists
    const snapBefore = await runDailyBackup(env, { forceFull: true });
    expect(snapBefore.ok).toBe(true);
    const oldSnapshotBytes = new Uint8Array(r2Store.get('backups/latest.abk')!.bytes);

    // Delete alice + scrub backups
    sqlite.exec(`DELETE FROM app_users WHERE username='alice'; DELETE FROM trusted_devices WHERE username='alice'; DELETE FROM webauthn_credentials WHERE username='alice';`);
    const purgeRes = await purgeDeletedAccountFromBackups(env, 'alice');
    expect(purgeRes.scrubbed).toBeGreaterThan(0);
    expect(r2Store.has('agent-chats/v2/alice/t1.conv')).toBe(false);
    expect(r2Store.has('agent-chats/v2/bob/t1.conv')).toBe(true);

    // Existing latest.abk & incremental chunk no longer contain alice, but keep bob
    const latestAfter = await decryptBackupBytes(env, r2Store.get('backups/latest.abk')!.bytes);
    expect(latestAfter.tables.app_users.map((u: any) => u.username)).toEqual(['bob']);
    expect(latestAfter.tables.trusted_devices.map((d: any) => d.username)).toEqual(['bob']);
    expect(latestAfter.tables.webauthn_credentials).toEqual([]);
    expect(latestAfter.r2_object_keys).not.toContain('agent-chats/v2/alice/t1.conv');

    // Even restoring the pre-deletion oldSnapshotBytes will NOT resurrect alice due to tombstones
    const oldPayload = await decryptBackupBytes(env, oldSnapshotBytes);
    await restoreFromBackupPayload(env.DB as any, oldPayload);
    const usersInDb = sqlite.prepare(`SELECT username FROM app_users ORDER BY username`).all() as any[];
    expect(usersInDb.map((u) => u.username)).toEqual(['bob']);
  });

  it('writes compressed ABK2 backups and purgeExpiredBackups preserves at least 2 snapshots while purging >7d and stale restore-work', async () => {
    const { runDailyBackup, purgeExpiredBackups } = await import('../routes/backups');
    const r2Store = new Map<string, { bytes: Uint8Array; uploaded: Date }>();
    const now = Date.now();
    // 4 snapshots all older than 7 days -> newest 2 must remain, older 2 must be deleted
    r2Store.set('backups/30m/atlas-1.abk', { bytes: new Uint8Array([1]), uploaded: new Date(now - 12 * 86400_000) });
    r2Store.set('backups/30m/atlas-2.abk', { bytes: new Uint8Array([2]), uploaded: new Date(now - 10 * 86400_000) });
    r2Store.set('backups/30m/atlas-3.abk', { bytes: new Uint8Array([3]), uploaded: new Date(now - 9 * 86400_000) });
    r2Store.set('backups/30m/atlas-4.abk', { bytes: new Uint8Array([4]), uploaded: new Date(now - 8 * 86400_000) });
    r2Store.set('backups/pre-revert/old.abk', { bytes: new Uint8Array([5]), uploaded: new Date(now - 9 * 86400_000) });
    r2Store.set('backups/restore-work/stale.json', { bytes: new Uint8Array([6]), uploaded: new Date(now - 36 * 3600_000) });
    r2Store.set('backups/restore-work/active.json', { bytes: new Uint8Array([7]), uploaded: new Date(now - 2 * 3600_000) });

    const env = {
      BACKUP_ENCRYPTION_KEY: 'bkp-abk2-test',
      DB: {
        prepare: () => ({
          all: async () => ({ results: [{ name: 'products' }] }),
          first: async () => null,
          run: async () => ({ success: true }),
        }),
      },
      IMAGES: {
        get: async (k: string) => {
          const entry = r2Store.get(k);
          if (!entry) return null;
          return { arrayBuffer: async () => entry.bytes.buffer.slice(entry.bytes.byteOffset, entry.bytes.byteOffset + entry.bytes.byteLength) };
        },
        head: async (k: string) => (r2Store.has(k) ? { key: k, size: r2Store.get(k)!.bytes.length } : null),
        put: async (k: string, data: Uint8Array) => {
          r2Store.set(k, { bytes: new Uint8Array(data), uploaded: new Date() });
        },
        delete: async (k: string) => { r2Store.delete(k); },
        list: async ({ prefix = '' }: { prefix?: string }) => ({
          objects: [...r2Store.keys()]
            .filter((k) => k.startsWith(prefix))
            .map((k) => ({ key: k, size: r2Store.get(k)!.bytes.length, uploaded: r2Store.get(k)!.uploaded })),
          truncated: false,
        }),
      },
    };

    const purgeRes = await purgeExpiredBackups(env);
    expect(purgeRes.deleted).toBe(4); // atlas-1, atlas-2, pre-revert/old, restore-work/stale
    expect(r2Store.has('backups/30m/atlas-3.abk')).toBe(true);
    expect(r2Store.has('backups/30m/atlas-4.abk')).toBe(true);
    expect(r2Store.has('backups/restore-work/active.json')).toBe(true);

    const snap = await runDailyBackup(env, { forceFull: true });
    expect(snap.ok).toBe(true);
    const latest = r2Store.get('backups/latest.abk')!.bytes;
    expect(new TextDecoder().decode(latest.slice(0, 4))).toBe('ABK2');
  });

  it('POST /api/cron/backup-execute answers immediately (202) and runs the backup in the Durable Object alarm', async () => {
    const { registerBackupRoutes } = await import('../routes/backups');
    const { RestoreHub } = await import('../durable/RestoreHub');
    const app = new Hono<{ Bindings: any }>();
    const agentPurge = vi.fn(async () => ({ deleted: 0 }));
    registerBackupRoutes(app, {
      requireOwner: () => ({ ok: true, username: 'owner' }),
      hmacSha256Hex: async () => 'hmac',
      writeAudit: async () => {},
      purgeAgentConversationsOlderThan: agentPurge,
    });
    const store = new Map<string, unknown>();
    let alarmAt: number | null = null;
    const state = {
      storage: {
        get: async (k: string) => store.get(k),
        put: async (k: string, v: unknown) => { store.set(k, structuredClone(v)); },
        delete: async (k: string) => store.delete(k),
        setAlarm: async (t: number) => { alarmAt = t; },
        deleteAlarm: async () => { alarmAt = null; },
      },
    };
    const uploads = new Map<string, Date>();
    let d1Queries = 0;
    const stmt = { all: async () => ({ results: [] }), first: async () => null, run: async () => ({ success: true }) };
    const env: any = {
      CRON_SECRET: 'cron-secret',
      BACKUP_ENCRYPTION_KEY: 'bkp-secret',
      IMAGES: {
        list: async () => ({ objects: [], truncated: false }),
        put: async (k: string) => { uploads.set(k, new Date()); },
        head: async (k: string) => (uploads.has(k) ? { key: k, uploaded: uploads.get(k) } : null),
        get: async () => null,
      },
      DB: { prepare: () => { d1Queries++; return { ...stmt, bind: () => stmt }; } },
    };
    const hub = new RestoreHub(state as any, env);
    env.RESTORE_HUB = {
      idFromName: (n: string) => n,
      get: () => ({ fetch: (u: string, init?: RequestInit) => hub.fetch(new Request(u, init)) }),
    };
    const headers = { Authorization: 'Bearer cron-secret' };

    const res = await app.request('/api/cron/backup-execute', { method: 'POST', headers }, env);
    expect(res.status).toBe(202);
    const j = (await res.json()) as any;
    expect(j).toMatchObject({ success: true, queued: true, skipped: false });
    expect(d1Queries).toBe(0); // no table was read while the cron service waited
    expect(alarmAt).not.toBeNull();

    // A second call while queued does not start another run.
    const again = (await (await app.request('/api/cron/backup-execute', { method: 'POST', headers }, env)).json()) as any;
    expect(again.already_running).toBe(true);

    await hub.alarm();
    expect(d1Queries).toBeGreaterThan(0);
    const status = (await (await app.request('/api/cron/backup-status', { headers }, env)).json()) as any;
    expect(status.data).toMatchObject({ status: 'ok', attempts: 1 });
    expect(status.data.result.success).toBe(true);

    // Unauthorized callers get nothing.
    expect((await app.request('/api/cron/backup-status', {}, env)).status).toBe(401);
  });
});
