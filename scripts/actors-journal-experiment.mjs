// Local-only compatibility/rollback test. Never reads production credentials.
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import assert from 'node:assert/strict';

const entry = (module) => `export { JournalBuffer } from '${module}'; export default { fetch() { return new Response('local only'); } };`;
async function bundle(module) {
  const result = await build({ stdin: { contents: entry(module), resolveDir: process.cwd(), sourcefile: 'actors-compat-entry.ts' }, bundle: true, format: 'esm', platform: 'browser', external: ['cloudflare:workers'], write: false });
  return result.outputFiles[0].text;
}
const legacy = await bundle('./worker/durable/JournalBuffer.ts');
const actor = await bundle('./experiments/actors-journal/JournalBufferActor.ts');
const options = (script) => convertV4MiniflareOptions({ modules: true, script, compatibilityDate: '2025-04-01', durableObjects: { JOURNAL_BUFFER: { className: 'JournalBuffer', useSQLite: true } }, r2Buckets: ['JOURNAL_ARCHIVE'] });
const mf = new Miniflare(options(legacy));
const path = 'api-journal/v1/2026-01-01/2026-01-01T00-00-00-000Z-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.journal';
const bytes = new Uint8Array(40); bytes.set(new TextEncoder().encode('AJR1'));
const payload = JSON.stringify({ path, ciphertext: btoa(String.fromCharCode(...bytes)) });
const stub = async () => { const ns = await mf.getDurableObjectNamespace('JOURNAL_BUFFER'); return ns.get(ns.idFromName('journal-v1')); };
const health = async (s) => (await s.fetch('https://journal/health')).json();
try {
  let s = await stub();
  assert.equal((await s.fetch('https://journal/enqueue', { method: 'POST', body: payload })).status, 202);
  assert.equal((await health(s)).pending_at_least, 1);
  await mf.setOptions(options(actor));
  s = await stub();
  const afterUpgrade = await health(s);
  assert.equal(afterUpgrade.pending_at_least, 1, 'pending item survived actor upgrade');
  assert.equal(afterUpgrade.alarm_scheduled, true, 'original alarm survived actor initialization');
  assert.equal((await s.fetch('https://journal/enqueue', { method: 'POST', body: payload })).status, 202);
  await mf.setOptions(options(legacy));
  s = await stub();
  assert.equal((await health(s)).pending_at_least, 1, 'pending item survived rollback');
  assert.equal((await health(s)).alarm_scheduled, true, 'original alarm survived rollback');
  await new Promise(resolve => setTimeout(resolve, 2500));
  const bucket = await mf.getR2Bucket('JOURNAL_ARCHIVE');
  const stored = await bucket.get(path);
  assert.ok(stored, 'legacy alarm drained the preserved item after rollback');
  assert.deepEqual(new Uint8Array(await stored.arrayBuffer()), bytes);
  assert.equal((await health(s)).pending_at_least, 0);
  // A second item verifies alarm delivery while the adapter remains active.
  const actorPath = path.replace('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  const actorPayload = JSON.stringify({ path: actorPath, ciphertext: btoa(String.fromCharCode(...bytes)) });
  await mf.setOptions(options(actor));
  s = await stub();
  assert.equal((await s.fetch('https://journal/enqueue', { method: 'POST', body: actorPayload })).status, 202);
  await new Promise(resolve => setTimeout(resolve, 2500));
  const actorBucket = await mf.getR2Bucket('JOURNAL_ARCHIVE');
  const actorStored = await actorBucket.get(actorPath);
  assert.ok(actorStored, 'Actors adapter processed the native alarm');
  assert.deepEqual(new Uint8Array(await actorStored.arrayBuffer()), bytes);
  assert.equal((await health(s)).pending_at_least, 0);
  const conflict = bytes.slice(); conflict[8] = 9;
  // Existing stored object is not a queue entry; enqueue conflicts are tested
  // concurrently before the alarm gets a chance to drain the pending entry.
  const concurrentPath = path.replace('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'cccccccc-cccc-cccc-cccc-cccccccccccc');
  const firstBody = JSON.stringify({ path: concurrentPath, ciphertext: btoa(String.fromCharCode(...bytes)) });
  const changedBody = JSON.stringify({ path: concurrentPath, ciphertext: btoa(String.fromCharCode(...conflict)) });
  assert.equal((await s.fetch('https://journal/enqueue', { method: 'POST', body: firstBody })).status, 202);
  assert.equal((await s.fetch('https://journal/enqueue', { method: 'POST', body: changedBody })).status, 409);
  const duplicate = await Promise.all(Array.from({ length: 8 }, () => s.fetch('https://journal/enqueue', { method: 'POST', body: firstBody })));
  assert.ok(duplicate.every(response => response.status === 202), 'identical concurrent retries are accepted');
  assert.equal((await health(s)).pending_at_least, 1);
  await new Promise(resolve => setTimeout(resolve, 2500));
  assert.equal((await health(s)).pending_at_least, 0);
  assert.deepEqual(new Uint8Array(await (await actorBucket.get(concurrentPath)).arrayBuffer()), bytes);
  console.log('Local only: legacy → Actors adapter → rollback preserved queue, alarm, and bytes; adapter alarm and duplicate handling passed.');
} finally { await mf.dispose(); }

// Supabase-mode failure/rollback check: intentionally invalid ciphertext must
// remain encrypted in the queue and must never fall back to local R2.
const supabaseOptions = (script) => convertV4MiniflareOptions({
  modules: true, script, compatibilityDate: '2025-04-01',
  durableObjects: { JOURNAL_BUFFER: { className: 'JournalBuffer', useSQLite: true } },
  r2Buckets: ['JOURNAL_ARCHIVE'],
  bindings: { JOURNAL_ARCHIVE_MODE: 'supabase', JOURNAL_ENCRYPTION_KEY: btoa('x'.repeat(32)), SUPABASE_JOURNAL_URL: 'https://example.supabase.co', SUPABASE_JOURNAL_SECRET_KEY: 'sb_secret_test' },
});
const failedMf = new Miniflare(supabaseOptions(actor));
try {
  const getStub = async () => { const ns = await failedMf.getDurableObjectNamespace('JOURNAL_BUFFER'); return ns.get(ns.idFromName('journal-v1')); };
  let s = await getStub();
  assert.equal((await s.fetch('https://journal/enqueue', { method: 'POST', body: payload })).status, 202);
  await new Promise(resolve => setTimeout(resolve, 2500));
  let state = await health(s);
  assert.equal(state.pending_at_least, 1);
  assert.equal(state.alarm_scheduled, true);
  assert.equal(state.last_failure.reason, 'decrypt');
  assert.equal(await (await failedMf.getR2Bucket('JOURNAL_ARCHIVE')).get(path), null);
  await failedMf.setOptions(supabaseOptions(legacy));
  s = await getStub(); state = await health(s);
  assert.equal(state.pending_at_least, 1);
  assert.equal(state.alarm_scheduled, true);
  assert.equal(state.last_failure.reason, 'decrypt');
  console.log('Supabase-mode local failure remains queued with alarm and diagnostics after rollback; no R2 fallback.');
} finally { await failedMf.dispose(); }
