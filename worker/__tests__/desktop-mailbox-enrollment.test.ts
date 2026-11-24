import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMailboxEnrollment } from '../lib/desktop-mailbox-enrollment';
import { createConfiguredNativeMailbox } from '../lib/desktop-mail-transport';
const SQLITE_MODULE = ['node:', 'sqlite'].join('');
const { DatabaseSync } = await import(SQLITE_MODULE);
let sqlite: any; let db: any; let send: any; let authorize: any;
const key = 'isolated-test-only-key-not-a-real-secret';
const ip = '203.0.113.42';
function connection(handle: any) {
  return {
    prepare(query: string) {
      let params: any[] = [];
      const statement: any = {
        bind(...args: any[]) { params = args; return statement; },
        async first() { return handle.prepare(query).get(...params) ?? null; },
        async run() { const result = handle.prepare(query).run(...params); return {meta:{changes:Number(result.changes)}}; },
      }; return statement;
    },
    async batch(statements: any[]) {
      handle.exec('BEGIN');
      try { const result = []; for (const stmt of statements) result.push(await stmt.run()); handle.exec('COMMIT'); return result; }
      catch (e) { handle.exec('ROLLBACK'); throw e; }
    },
  };
}
beforeEach(() => {
  sqlite = new DatabaseSync(':memory:'); db = connection(sqlite);
  sqlite.exec(`CREATE TABLE app_users (id INTEGER PRIMARY KEY,username TEXT,role TEXT,password_hash TEXT,password_salt TEXT,active INTEGER,email TEXT);
    INSERT INTO app_users VALUES (1,'alice','user','hash','salt',1,'editable@example.test');
    INSERT INTO app_users VALUES (2,'bob','user','other','salt',1,'other@example.test');`);
  send = vi.fn(async () => true); authorize = vi.fn(async (context: any) => context?.authenticated && context?.reauthenticated ? {userId:context.userId} : null);
});
afterEach(() => { sqlite.close(); vi.restoreAllMocks(); });
const context = {authenticated:true,reauthenticated:true,userId:1};
const service = () => createMailboxEnrollment(db, key, {send,authorize})!;
const sent = (purpose: string) => send.mock.calls.map((x: any[]) => x[0]).findLast((m: any) => m.purpose === purpose);
async function first(s: ReturnType<typeof service>) {
  const pending = await s.start(context, 'new@example.test', ip); expect(pending).not.toBeNull();
  expect(await s.confirm(context, pending!.request_id, sent('new_mailbox').code, undefined, ip)).toBe(true);
  return pending!;
}

describe('unwired verified-mailbox building block', () => {
  it('is unavailable without both adapters, a strong-length key and transactional D1', () => {
    expect(createMailboxEnrollment(db, key)).toBeNull();
    expect(createMailboxEnrollment(db, 'short', {send,authorize})).toBeNull();
    expect(createMailboxEnrollment({...db,batch:undefined}, key, {send,authorize})).toBeNull();
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='desktop_mailbox_pending_v1'").get()).toBeUndefined();
  });
  it('integrates explicitly injected authorization with configured direct-recipient transport', async () => {
    const calls: any[] = [];
    const fetcher = vi.fn(async (_url: any, init: any) => { calls.push(JSON.parse(init.body)); return new Response('{}', {status:200}); });
    const configured = createConfiguredNativeMailbox(db, {DESKTOP_NATIVE_MAIL_TRANSPORT:'resend-v1', DESKTOP_NATIVE_RESEND_API_KEY:'re_testkey12345', DESKTOP_NATIVE_MAIL_FROM:'security@example.test', DESKTOP_NATIVE_MAILBOX_MAC_KEY:key}, authorize, fetcher as any)!;
    const pending = await configured.start(context,'real-recipient@example.test',ip); expect(pending).not.toBeNull();
    expect(calls[0].to).toEqual(['real-recipient@example.test']);
    const otp = calls[0].text.match(/\b\d{6}\b/)[0];
    expect(await configured.confirm(context,pending!.request_id,otp,undefined,ip)).toBe(true);
    expect((sqlite.prepare('SELECT address FROM desktop_mailbox_verified_v1 WHERE user_id=1').get() as any).address).toBe('real-recipient@example.test');
  });
  it('never treats an editable existing address as verified and requires session plus reauthentication', async () => {
    const s = service();
    expect(await s.start({authenticated:true,userId:1}, 'new@example.test', ip)).toBeNull();
    expect(await s.start(context, 'bad\r\n@example.test', ip)).toBeNull();
    const pending = await s.start(context, 'new@example.test', ip); expect(pending).not.toBeNull();
    expect(sqlite.prepare('SELECT * FROM desktop_mailbox_verified_v1').all()).toHaveLength(0);
    const stored = JSON.stringify(sqlite.prepare('SELECT * FROM desktop_mailbox_pending_v1').all());
    expect(stored).not.toContain(sent('new_mailbox').code);
    expect((sqlite.prepare('SELECT email FROM app_users WHERE id=1').get() as any).email).toBe('editable@example.test');
    expect(await s.confirm({authenticated:true,userId:1}, pending!.request_id, sent('new_mailbox').code, undefined, ip)).toBe(false);
    expect(await s.confirm({authenticated:true,reauthenticated:true,userId:2}, pending!.request_id, sent('new_mailbox').code, undefined, ip)).toBe(false);
    expect(await s.confirm(context, pending!.request_id, sent('new_mailbox').code, undefined, ip)).toBe(true);
    expect(await s.confirm(context, pending!.request_id, sent('new_mailbox').code, undefined, ip)).toBe(false);
    expect((sqlite.prepare('SELECT address FROM desktop_mailbox_verified_v1 WHERE user_id=1').get() as any).address).toBe('new@example.test');
  });
  it('notifies and proves both old and new addresses before changing a verified mailbox', async () => {
    const s = service(); await first(s); send.mockClear();
    const pending = await s.start(context,'replacement@example.test',ip); expect(pending).not.toBeNull();
    expect(sent('old_mailbox_change').to).toBe('new@example.test');
    expect(sent('new_mailbox').to).toBe('replacement@example.test');
    expect(await s.confirm(context,pending!.request_id,sent('new_mailbox').code,undefined,ip)).toBe(false);
    expect(await s.confirm(context,pending!.request_id,sent('new_mailbox').code,sent('old_mailbox_change').code,ip)).toBe(true);
    expect((sqlite.prepare('SELECT address FROM desktop_mailbox_verified_v1 WHERE user_id=1').get() as any).address).toBe('replacement@example.test');
  });
  it('does not verify if mail fails, even after old-address notice was sent', async () => {
    const s = service(); await first(s); send.mockClear();
    send.mockImplementation(async (message: any) => message.purpose === 'old_mailbox_change');
    expect(await s.start(context,'replacement@example.test',ip)).toBeNull();
    expect((sqlite.prepare('SELECT address FROM desktop_mailbox_verified_v1 WHERE user_id=1').get() as any).address).toBe('new@example.test');
    expect((sqlite.prepare('SELECT status FROM desktop_mailbox_pending_v1 WHERE user_id=1').get() as any).status).toBe('failed');
  });
  it('rejects expired, wrong and exhausted codes without creating a factor', async () => {
    const s = service(); const pending = await s.start(context,'new@example.test',ip);
    const correct = sent('new_mailbox').code; const wrong = correct === '000000' ? '000001' : '000000';
    for (let i=0; i<5; i++) expect(await s.confirm(context,pending!.request_id,wrong,undefined,ip)).toBe(false);
    expect(await s.confirm(context,pending!.request_id,correct,undefined,ip)).toBe(false);
    expect(sqlite.prepare('SELECT * FROM desktop_mailbox_verified_v1').all()).toHaveLength(0);
    sqlite.prepare('UPDATE desktop_mailbox_pending_v1 SET attempts=0,expires_at=?').run(Date.now()-1);
    expect(await s.confirm(context,pending!.request_id,correct,undefined,ip)).toBe(false);
  });
  it('serializes competing starts and approvals; only one proof can be consumed', async () => {
    const s = service();
    const starts = await Promise.all([s.start(context,'a@example.test',ip),s.start(context,'b@example.test',ip)]);
    expect(starts.filter(Boolean)).toHaveLength(1);
    const id = starts.find(Boolean)!.request_id; const otp = sent('new_mailbox').code;
    const approvals = await Promise.all([s.confirm(context,id,otp,undefined,ip),s.confirm(context,id,otp,undefined,ip)]);
    expect(approvals.filter(Boolean)).toHaveLength(1);
    expect(sqlite.prepare('SELECT * FROM desktop_mailbox_verified_v1').all()).toHaveLength(1);
  });
  it('cancels pending and suspends verified factors permanently on account change/disablement', async () => {
    const s = service(); await first(s);
    const pending = await s.start(context,'replacement@example.test',ip);
    const next = sent('new_mailbox').code; const old = sent('old_mailbox_change').code;
    sqlite.prepare('UPDATE app_users SET email=? WHERE id=1').run('changed@example.test');
    expect(await s.confirm(context,pending!.request_id,next,old,ip)).toBe(false);
    sqlite.prepare('UPDATE app_users SET email=? WHERE id=1').run('editable@example.test');
    expect((sqlite.prepare('SELECT active FROM desktop_mailbox_verified_v1 WHERE user_id=1').get() as any).active).toBe(0);
    expect(await s.start(context,'fresh@example.test',ip)).toBeNull();
  });
  it('fails closed when account is disabled while mail delivery is in flight', async () => {
    let release!: (value: boolean) => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    send.mockImplementation(async () => { started(); return new Promise<boolean>(resolve => { release = resolve; }); });
    const s = service(); const running = s.start(context,'new@example.test',ip); await entered;
    sqlite.prepare('UPDATE app_users SET active=0 WHERE id=1').run(); release(true);
    expect(await running).toBeNull();
    sqlite.prepare('UPDATE app_users SET active=1 WHERE id=1').run();
    expect((sqlite.prepare('SELECT status FROM desktop_mailbox_pending_v1 WHERE user_id=1').get() as any).status).toBe('cancelled');
    expect(sqlite.prepare('SELECT * FROM desktop_mailbox_verified_v1').all()).toHaveLength(0);
  });
  it('times out a hung provider and never activates a late delivery', async () => {
    vi.useFakeTimers();
    let release!: (value: boolean) => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    send.mockImplementation(() => { started(); return new Promise<boolean>(resolve => { release = resolve; }); });
    const s = service(); const running = s.start(context,'new@example.test',ip); await entered;
    expect(send).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5000);
    expect(await running).toBeNull(); release(true);
    expect((sqlite.prepare('SELECT status FROM desktop_mailbox_pending_v1 WHERE user_id=1').get() as any).status).toBe('failed');
    vi.useRealTimers();
  });
  it('rolls back both verification and consumption on a transactional insert failure', async () => {
    const s = service(); const pending = await s.start(context,'new@example.test',ip); const otp = sent('new_mailbox').code;
    const original = db.batch;
    db.batch = (statements: any[]) => original([statements[0], db.prepare('INSERT INTO missing_factor_table VALUES (1)')]);
    await expect(s.confirm(context,pending!.request_id,otp,undefined,ip)).rejects.toThrow();
    db.batch = original;
    expect((sqlite.prepare('SELECT status FROM desktop_mailbox_pending_v1 WHERE user_id=1').get() as any).status).toBe('pending');
    expect(sqlite.prepare('SELECT * FROM desktop_mailbox_verified_v1').all()).toHaveLength(0);
    expect(await s.confirm(context,pending!.request_id,otp,undefined,ip)).toBe(true);
  });
});
