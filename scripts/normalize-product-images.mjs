/** Operator-run, bounded migration; requires an existing owner session. */
const base = process.env.ATLAS_URL;
const token = process.env.ATLAS_SESSION;
if (!base || !token) {
  console.error('Set ATLAS_URL and ATLAS_SESSION in your environment.');
  process.exit(2);
}
let origin;
try {
  const url = new URL(base);
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) throw new Error();
  origin = url.origin;
} catch {
  console.error('ATLAS_URL must be HTTPS (HTTP is allowed only on localhost).');
  process.exit(2);
}
let failures = 0;
try {
  for (const phase of ['images', 'products']) {
    let after = 0;
    while (true) {
      const response = await fetch(`${origin}/api/admin/product-images/normalize`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(process.env.ATLAS_FINGERPRINT ? { 'X-Device-Fingerprint': process.env.ATLAS_FINGERPRINT } : {}) },
        body: JSON.stringify({ phase, after, limit: 3 }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} in ${phase} after ${after}`);
      const body = await response.json();
      if (!body?.success || !body.data || !Array.isArray(body.data.failures)) throw new Error('Invalid response');
      const page = body.data;
      console.log(`${phase} after=${after} updated=${page.updated} unchanged=${page.unchanged} failed=${page.failed}`);
      for (const item of page.failures) console.error(`${phase} id=${item.id} code=${item.code}`);
      failures += page.failed;
      if (page.next_after == null) break;
      if (!Number.isSafeInteger(page.next_after) || page.next_after <= after) throw new Error('Invalid migration cursor');
      after = page.next_after;
    }
  }
} catch (e) {
  console.error(`Migration stopped: ${e instanceof Error ? e.message : 'request failed'}`);
  process.exit(1);
}
if (failures) {
  console.error(`${failures} records need review. Rerun from the beginning after resolving them.`);
  process.exit(1);
}
console.log('Migration complete.');
