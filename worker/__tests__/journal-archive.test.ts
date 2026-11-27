import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { archiveApiCall, listArchivedApiCalls, readArchivedApiCall } from '../lib/journalArchive';
import { registerUsersAdminRoutes } from '../routes/usersAdmin';

function bucket() {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    put: vi.fn(async (key: string, data: Uint8Array) => { objects.set(key, new Uint8Array(data)); }),
    get: vi.fn(async (key: string) => objects.has(key) ? { arrayBuffer: async () => objects.get(key)!.slice().buffer } : null),
    list: vi.fn(async ({ prefix }: { prefix: string }) => ({ objects: [...objects.keys()].filter(k => k.startsWith(prefix)).sort().map(key => ({ key })), truncated: false })),
  };
}
const row = { method: 'GET', path: '/api/auth/qr/session/secret?password=hidden', status: 200, ms: 15, username: 'alice', role: 'owner', ip: '1.2.3.4', ua: 'Example', request_id: 'r', surface: 'web', country: 'MA', city: 'Rabat', region: null, asn: 1, as_org: 'Provider' };
const secret = btoa('x'.repeat(32));
describe('private encrypted API shadow archive', () => {
  it('encrypts each object with a random IV and authenticates its object key', async () => {
    const r2 = bucket(); const env: any = { JOURNAL_ARCHIVE: r2, JOURNAL_ARCHIVE_MODE: 'shadow', JOURNAL_ENCRYPTION_KEY: secret };
    const at = new Date();
    await archiveApiCall(env, { ...row, authorization: 'private-token', body: 'private-body' } as typeof row, at); await archiveApiCall(env, row, at);
    const paths = [...r2.objects.keys()]; expect(new Set(paths).size).toBe(2);
    expect(paths[0]).toMatch(/\.journal$/);
    expect(new TextDecoder().decode(r2.objects.get(paths[0]))).not.toContain('alice');
    expect(paths[0]).not.toContain('alice');
    const loaded: any = await readArchivedApiCall(env, paths[0], at.getTime());
    expect(loaded).toMatchObject({ username: 'alice', path: '/api/auth/qr/session/:token', status: 200 });
    expect(JSON.stringify(loaded)).not.toContain('password');
    expect(JSON.stringify(loaded)).not.toContain('private-token');
    expect(JSON.stringify(loaded)).not.toContain('private-body');
    expect((await listArchivedApiCalls(env, at.toISOString().slice(0, 10), undefined, at.getTime())).keys).toHaveLength(2);
    r2.objects.set(paths[1], r2.objects.get(paths[0])!);
    await expect(readArchivedApiCall(env, paths[1], at.getTime())).rejects.toThrow();
  });
  it('does not write unless explicitly enabled, and refuses missing or invalid encryption keys', async () => {
    const r2 = bucket();
    expect(await archiveApiCall({ JOURNAL_ARCHIVE: r2 as any }, row)).toBe(false);
    await expect(archiveApiCall({ JOURNAL_ARCHIVE_MODE: 'shadow', JOURNAL_ENCRYPTION_KEY: secret }, row)).rejects.toThrow();
    await expect(archiveApiCall({ JOURNAL_ARCHIVE: r2 as any, JOURNAL_ARCHIVE_MODE: 'shadow' }, row)).rejects.toThrow();
    await expect(archiveApiCall({ JOURNAL_ARCHIVE: r2 as any, IMAGES: r2 as any, JOURNAL_ARCHIVE_MODE: 'shadow', JOURNAL_ENCRYPTION_KEY: secret }, row)).rejects.toThrow();
    expect(r2.put).not.toHaveBeenCalled();
  });
  it('requires an exact R2 read-back before reporting an R2-first write as successful', async () => {
    const r2 = bucket(); const env: any = { JOURNAL_ARCHIVE: r2, JOURNAL_ARCHIVE_MODE: 'r2', JOURNAL_ENCRYPTION_KEY: secret };
    expect(await archiveApiCall(env, row)).toBe(true);
    expect(r2.get).toHaveBeenCalledOnce();
    r2.get.mockResolvedValueOnce(null);
    await expect(archiveApiCall(env, row)).rejects.toThrow('read-back missing');
    r2.get.mockImplementationOnce(async () => ({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }));
    await expect(archiveApiCall(env, row)).rejects.toThrow('read-back differs');
  });
  it('cannot read objects older than 30 days, arbitrary paths or invalid dates', async () => {
    const r2 = bucket(); const env: any = { JOURNAL_ARCHIVE: r2, JOURNAL_ARCHIVE_MODE: 'shadow', JOURNAL_ENCRYPTION_KEY: secret };
    const now = Date.now(); const at = new Date(now - 31 * 86400_000);
    await archiveApiCall(env, row, at);
    const path = [...r2.objects.keys()][0];
    expect(await readArchivedApiCall(env, path, now)).toBeNull();
    expect(await readArchivedApiCall(env, 'backups/latest.abk', now)).toBeNull();
    await expect(listArchivedApiCalls(env, at.toISOString().slice(0, 10), undefined, now)).rejects.toThrow();
    expect(r2.get).not.toHaveBeenCalled();
  });
  it('requires the owner/admin gate before listing or reading archive items', async () => {
    const app = new Hono<any>();
    registerUsersAdminRoutes(app, { requireOwner: () => ({ ok: false, response: new Response('Forbidden', { status: 403 }) }) } as any);
    const r2 = bucket(); const env: any = { JOURNAL_ARCHIVE: r2, JOURNAL_ARCHIVE_MODE: 'shadow', JOURNAL_ENCRYPTION_KEY: secret };
    for (const path of ['/api/admin/journal-archive?day=2026-01-01', '/api/admin/journal-archive/item?key=test']) expect((await app.request(path, {}, env)).status).toBe(403);
    expect(r2.list).not.toHaveBeenCalled(); expect(r2.get).not.toHaveBeenCalled();
  });
});

it('lists decrypted R2 entries in bounded pages, surfaces unreadable items and enforces the owner gate', async () => {
  const r2 = bucket(); const env: any = { JOURNAL_ARCHIVE: r2, JOURNAL_ARCHIVE_MODE: 'buffered', JOURNAL_ENCRYPTION_KEY: secret, DB: { prepare: () => { throw new Error('no D1'); } } };
  await archiveApiCall(env, row); await archiveApiCall(env, { ...row, path: '/api/products', status: 503 });
  const keys = [...r2.objects.keys()]; r2.objects.set(keys[1], new Uint8Array([0, 1, 2]));
  const app = new Hono<any>(); let authorized = false;
  registerUsersAdminRoutes(app, { requireOwner: (c: any) => authorized ? { ok: true, username: 'owner' } : { ok: false, response: c.json({ error: 'Forbidden' }, 403) } } as any);
  const path = `/api/admin/journal-archive?day=${new Date().toISOString().slice(0, 10)}&kind=api&include=entries`;
  expect((await app.request(path, {}, env)).status).toBe(403);
  expect(r2.list).not.toHaveBeenCalled();
  authorized = true;
  const response = await app.request(path, {}, env);
  expect(response.status).toBe(200);
  const data = await response.json() as any;
  expect(data.data).toHaveLength(2);
  expect(data.data.find((x: any) => x.key === keys[0]).row).toMatchObject({ username: 'alice', method: 'GET', status: 200 });
  expect(data.data.find((x: any) => x.key === keys[1])).toMatchObject({ unreadable: true, row: null });
  expect(r2.list.mock.calls[0][0]).toMatchObject({ limit: 25 });
});
