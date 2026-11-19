import { describe, expect, it, vi } from 'vitest';
import { validateArchiveInput, verifyArchiveIdentity } from '../lib/finance-report-archive-validation';

const combined = ['balance', 'stock', 'receivables', 'payables', 'employees', 'aging', 'tva'];
const input = (override: Record<string, unknown> = {}) => ({ schema_version: 1, kind: 'combined', period: 'month', sections: ['balance'], ...override });
const validate = (value: unknown) => validateArchiveInput(value, '2026-03-31', combined);

describe('planned archive request validation', () => {
  it('uses existing period bounds and defaults to French', () => {
    expect(validate(input())).toEqual({ schema_version: 1, kind: 'combined', period: 'month', from: '2026-03-01', to: '2026-03-31', sections: ['balance'], locale: 'fr' });
    expect(validate(input({ period: '2024-02', locale: 'ar-MA' }))).toMatchObject({ from: '2024-02-01', to: '2024-02-29', locale: 'ar-MA' });
    expect(validate(input({ period: 'custom', from: '2026-02-10', to: '2026-04-30', locale: 'en' }))).toMatchObject({ from: '2026-02-10', to: '2026-03-31', locale: 'en' });
  });
  it('accepts only explicit supported relative periods and strict real custom dates', () => {
    for (const period of ['month', '3m', '6m', '9m', '12m', '24m', '36m', '48m', 'year', 'ytd']) expect(validate(input({ period }))).not.toBeNull();
    for (const period of ['hour', '2026-1', '2026-13', ' 2024-02 ', '1900-01', '2101-01', '2099-01']) expect(validate(input({ period }))).toBeNull();
    for (const [from, to] of [['2026-02-30', '2026-03-01'], ['2026-03-02', '2026-03-01'], ['2026-04-01', '2026-04-30'], ['2024-02-30', '2024-03-01']]) {
      expect(validate(input({ period: 'custom', from, to }))).toBeNull();
    }
    expect(validate(input({ period: 'month', from: '2026-01-01', to: '2026-01-02' }))).toBeNull();
  });
  it('handles monthly bounds and rejects extra fields, sections and locales', () => {
    expect(validate(input({ kind: 'monthly', period: '2024-02', locale: 'en' }))).toMatchObject({ from: '2024-02-01', to: '2024-02-29' });
    for (const body of [input({ tenant: 'other' }), input({ schema_version: 2 }), input({ sections: [] }), input({ sections: ['balance', 'balance'] }), input({ sections: ['password'] }), input({ locale: 'ar' }), input({ locale: null }), input({ kind: 'monthly', period: 'custom' }), input({ kind: 'monthly', period: '2026-02', from: '2026-02-01' })]) expect(validate(body)).toBeNull();
  });
});

describe('planned archive identity gate', () => {
  const users: Record<string, { id: number; role: string }> = { alice: { id: 4, role: 'admin' }, bob: { id: 5, role: 'stock' } };
  const db = { prepare: () => ({ bind: (name: string) => ({ first: async () => users[name] || null }) }) } as unknown as D1Database;
  const deps = (username: string, role: string, auth = 'ok') => ({
    authFailReason: vi.fn(async () => auth),
    sessionUserFromHeader: () => ({ username, role }),
    ownerUsername: () => 'owner',
  });
  it('accepts the verified owner and a current active admin only', async () => {
    expect(await verifyArchiveIdentity({ DB: db }, 'Bearer token', 'ip', undefined, deps('owner', 'owner'))).toMatchObject({ ok: true, identity: { username: 'owner', role: 'owner', userId: null, tenant: 'main' } });
    expect(await verifyArchiveIdentity({ DB: db }, 'Bearer token', 'ip', undefined, deps('alice', 'admin'))).toMatchObject({ ok: true, identity: { userId: 4, tenant: 'main' } });
    expect(await verifyArchiveIdentity({ DB: db }, 'Bearer token', 'ip', undefined, deps('bob', 'stock'))).toMatchObject({ ok: false, status: 403, code: 'FIN_FORBIDDEN' });
  });
  it('rejects missing authentication, altered role claims and missing users', async () => {
    expect(await verifyArchiveIdentity({ DB: db }, undefined, 'ip', undefined, deps('owner', 'owner', 'missing'))).toMatchObject({ ok: false, status: 401 });
    expect(await verifyArchiveIdentity({ DB: db }, 'Bearer token', 'ip', undefined, deps('bob', 'admin'))).toMatchObject({ ok: false, status: 401 });
    expect(await verifyArchiveIdentity({ DB: db }, 'Bearer token', 'ip', undefined, deps('ghost', 'admin'))).toMatchObject({ ok: false, status: 401 });
    expect(await verifyArchiveIdentity({ DB: db }, 'Bearer token', 'ip', undefined, deps('owner', 'admin'))).toMatchObject({ ok: false, status: 401 });
  });
  it('fails closed on database errors', async () => {
    const broken = { prepare: () => { throw new Error('private database detail'); } } as unknown as D1Database;
    expect(await verifyArchiveIdentity({ DB: broken }, 'Bearer token', 'ip', undefined, deps('alice', 'admin'))).toEqual({ ok: false, status: 503, code: 'SERVICE_UNAVAILABLE' });
  });
});
