// Exercises the real Durable Object in local workerd with an isolated R2 bucket.
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import assert from 'node:assert/strict';
const bundled = await build({ stdin: { contents: "export { JournalBuffer } from './worker/durable/JournalBuffer.ts'; export default { fetch() { return new Response('ok'); } };", resolveDir: process.cwd(), sourcefile: 'journal-smoke-entry.ts' }, bundle: true, format: 'esm', platform: 'browser', write: false });
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2025-04-01', durableObjects: { JOURNAL_BUFFER: { className: 'JournalBuffer', useSQLite: true } }, r2Buckets: ['JOURNAL_ARCHIVE'] }));
try {
  const ns = await mf.getDurableObjectNamespace('JOURNAL_BUFFER');
  const stub = ns.get(ns.idFromName('journal-v1'));
  const bucket = await mf.getR2Bucket('JOURNAL_ARCHIVE');
  const key = 'api-journal/v1/2026-01-01/2026-01-01T00-00-00-000Z-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.journal';
  const bytes = new Uint8Array(40); bytes.set(new TextEncoder().encode('AJR1'));
  const response = await stub.fetch('https://journal/enqueue', { method: 'POST', body: JSON.stringify({ path: key, ciphertext: btoa(String.fromCharCode(...bytes)) }) });
  assert.equal(response.status, 202);
  const health = await (await stub.fetch('https://journal/health')).json();
  assert.equal(health.pending_at_least, 1); assert.equal(health.alarm_scheduled, true);
  await new Promise(resolve => setTimeout(resolve, 2500));
  const object = await bucket.get(key); assert.ok(object, 'Alarm did not drain into local R2');
  assert.deepEqual(new Uint8Array(await object.arrayBuffer()), bytes);
  assert.equal((await (await stub.fetch('https://journal/health')).json()).pending_at_least, 0);
  const changed = bytes.slice(); changed[8] = 10;
  assert.equal(await bucket.put(key, changed, { onlyIf: new Headers({ 'If-None-Match': '*' }) }), null);
  assert.deepEqual(new Uint8Array(await (await bucket.get(key)).arrayBuffer()), bytes);
  console.log('Local workerd SQLite outbox, alarm, R2 read-back and conditional create passed.');
} finally { await mf.dispose(); }
