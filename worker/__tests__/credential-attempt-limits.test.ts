import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CREDENTIAL_ATTEMPT_LIMITS, hasCredentialAttemptBudget, reserveCredentialAttempt } from '../lib/credential-attempt-limits';
const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = await import(SQLITE_MODULE) as { DatabaseSync: new (path: string) => any };
const NOW = 1_800_000_000_000;
let sqlite: any;
let db: any;
/** Real SQLite conditional SQL, wrapped with the subset of D1 used here. */
function connection(sql: any) {
  return {
    prepare(query: string) {
      let params: any[] = [];
      const stmt = {
        bind(...values: any[]) { params = values; return stmt; },
        async run() { return sql.prepare(query).run(...params); },
        async first() { return sql.prepare(query).get(...params) ?? null; },
      };
      return stmt;
    },
  };
}
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  db = connection(sqlite);
});
afterEach(() => sqlite.close());
const reserve = (account = 'alice', ip = '203.0.113.1', purpose: 'password' | 'otp' = 'password', now = NOW) => reserveCredentialAttempt(db, ip, account, purpose, now);

describe('persistent account-aware credential admission', () => {
  it('scopes routing exactly, not by an auth prefix', () => {
    for (const path of ['/api/auth/login', '/api/auth/verify-otp', '/api/auth/verify-link']) expect(hasCredentialAttemptBudget(path)).toBe(true);
    for (const path of ['/api/health', '/api/auth/login/', '/api/auth/login-biometric', '/api/auth/webauthn/login/verify', '/api/auth/desktop/v1/poll']) expect(hasCredentialAttemptBudget(path)).toBe(false);
  });
  it('does not give B the exhausted A/IP budget', async () => {
    const calls = await Promise.all(Array.from({ length: 5 }, () => reserve('alice')));
    expect(calls.every(r => r.allowed)).toBe(true);
    expect((await reserve('alice')).allowed).toBe(false);
    expect((await reserve('bob')).allowed).toBe(true);
  });
  it('normalizes account spelling without trusting a fingerprint', async () => {
    await Promise.all(Array.from({ length: 5 }, () => reserve(' Alice ')));
    expect((await reserve('alice')).allowed).toBe(false);
  });
  it('bounds an account across rotating VPN IPs', async () => {
    const calls = await Promise.all(Array.from({ length: 20 }, (_, i) => reserve('alice', `198.51.100.${i + 1}`)));
    expect(calls.every(r => r.allowed)).toBe(true);
    expect((await reserve('alice', '198.51.100.100')).allowed).toBe(false);
  });
  it('gives OTP its own pair budget but shares code/link OTP capacity', async () => {
    await Promise.all(Array.from({ length: 5 }, () => reserve('alice')));
    expect((await reserve('alice')).allowed).toBe(false);
    expect((await reserve('alice', '203.0.113.1', 'otp')).allowed).toBe(true);
  });
  it('retains a shared-IP ceiling against username spraying', async () => {
    const calls = await Promise.all(Array.from({ length: 60 }, (_, i) => reserve(`spray-${i}`)));
    expect(calls.filter(r => r.allowed)).toHaveLength(60);
    const denied = await reserve('another-account');
    expect(denied).toEqual({ allowed: false, retryAfter: 60 });
    expect((await reserve('another-account', '203.0.113.2')).allowed).toBe(true);
  });
  it('retains a sustained IP ceiling across minute windows', async () => {
    // Five bursts in separate minutes consume 300 admissions, below 60/min.
    const bursts = Array.from({ length: 5 }, (_, minute) => Promise.all(Array.from({ length: 60 }, (entry, i) => reserve(`u-${minute}-${i}`, '203.0.113.1', 'password', NOW + minute * 60_000))));
    const results = (await Promise.all(bursts)).flat();
    expect(results.every(r => r.allowed)).toBe(true);
    expect(await reserve('new-account', '203.0.113.1', 'password', NOW + 300_000)).toEqual({ allowed: false, retryAfter: 300 });
  });
  it('honors atomic pair admission under concurrency', async () => {
    const calls = await Promise.all(Array.from({ length: 12 }, () => reserve()));
    expect(calls.filter(r => r.allowed)).toHaveLength(CREDENTIAL_ATTEMPT_LIMITS.accountIpPurposeTenMinutes);
    const pair = sqlite.prepare(`SELECT attempts FROM credential_attempt_limits_v1 WHERE bucket LIKE 'pair:%'`).get();
    expect(pair.attempts).toBe(5);
  });
  it('survives a fresh connection/Worker wrapper (not an isolate-only counter)', async () => {
    await Promise.all(Array.from({ length: 5 }, () => reserve()));
    db = connection(sqlite);
    expect((await reserve()).allowed).toBe(false);
  });
  it('does not slide expiry or count denied traffic indefinitely', async () => {
    await Promise.all(Array.from({ length: 5 }, () => reserve()));
    expect((await reserve('alice', '203.0.113.1', 'password', NOW + 59_000)).retryAfter).toBe(541);
    expect((await reserve('alice', '203.0.113.1', 'password', NOW + 599_000)).retryAfter).toBe(1);
    expect((await reserve('alice', '203.0.113.1', 'password', NOW + 600_000)).allowed).toBe(true);
  });
  it('stores pseudonymous bounded keys, not raw account names or IPs', async () => {
    await reserve('privacy-account');
    const rows = JSON.stringify(sqlite.prepare('SELECT * FROM credential_attempt_limits_v1').all());
    expect(rows).not.toContain('privacy-account');
    expect(rows).not.toContain('203.0.113.1');
  });
  it('does not fail open when storage is unavailable', async () => {
    const unavailable = { prepare() { throw new Error('private-database-error'); } };
    await expect(reserveCredentialAttempt(unavailable as any, '203.0.113.1', 'alice', 'password', NOW)).rejects.toThrow();
  });
  it('refuses unknown source IP or invalid time', async () => {
    await expect(reserveCredentialAttempt(db, 'unknown', 'alice', 'password', NOW)).rejects.toThrow('AUTH_LIMIT_UNAVAILABLE');
    await expect(reserveCredentialAttempt(db, '203.0.113.1', 'alice', 'password', Number.NaN)).rejects.toThrow('AUTH_LIMIT_UNAVAILABLE');
  });
});
