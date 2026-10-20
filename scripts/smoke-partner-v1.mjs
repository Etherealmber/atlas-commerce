/**
 * Partner v1 smoke.
 * Skips if server unreachable (unless ATLAS_SMOKE_REQUIRE=1).
 * With ATLAS_PARTNER_KEY expects success on /api/v1/health.
 *
 * Setup (pick one):
 *   1) Wrangler secret:  npx wrangler secret put PARTNER_API_KEY
 *      value = a long random string, e.g. openssl rand -hex 32
 *   2) Or insert into D1 partner_api_keys (key_hash = SHA-256 hex of key)
 *
 * Then smoke with key:
 *   set ATLAS_PARTNER_KEY=your-same-secret
 *   set ATLAS_SMOKE_BASE=https://stock.afmarbre.com
 *   npm run smoke
 *
 * Without key, 401 UNAUTHORIZED is the expected "ok" shape.
 */

const base = (process.env.ATLAS_SMOKE_BASE || process.argv[2] || 'https://stock.afmarbre.com').replace(/\/$/, '');
const key = process.env.ATLAS_PARTNER_KEY || '';
const requireLive = process.env.ATLAS_SMOKE_REQUIRE === '1' || process.env.ATLAS_SMOKE_REQUIRE === 'true';

const headers = { Accept: 'application/json' };
if (key) headers['X-Api-Key'] = key;

let res;
let json = {};
try {
  res = await fetch(`${base}/api/v1/health`, { headers });
  json = await res.json().catch(() => ({}));
} catch (e) {
  const code = e?.cause?.code || e?.code || '';
  const msg = String(e?.message || e);
  if (
    !requireLive &&
    (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || /fetch failed|ECONNREFUSED/i.test(msg))
  ) {
    console.log(`skip partner v1 smoke — no server at ${base}`);
    process.exit(0);
  }
  console.error('partner fetch failed', msg);
  process.exit(1);
}

if (typeof json.success !== 'boolean') {
  console.error('missing success field', res.status, json);
  process.exit(1);
}
if (key) {
  if (!res.ok || !json.success) {
    console.error('partner health failed', res.status, json);
    process.exit(1);
  }
  console.log('ok partner v1 health', json.data);
} else {
  if (json.success !== false) {
    console.error('expected success:false without key', json);
    process.exit(1);
  }
  console.log('ok partner v1 denied shape code=', json.code, 'status=', res.status);
}
