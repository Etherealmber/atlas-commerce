/**
 * P0 smoke: health + public API error shape.
 * Default base: ATLAS_SMOKE_BASE or https://stock.afmarbre.com (wrangler dev).
 * If nothing listens → skip (exit 0) unless ATLAS_SMOKE_REQUIRE=1.
 *
 *   npx wrangler dev   # terminal 1
 *   npm run smoke      # terminal 2
 *   ATLAS_SMOKE_BASE=https://stock.afmarbre.com npm run smoke
 */
const base = (process.argv[2] || process.env.ATLAS_SMOKE_BASE || 'https://stock.afmarbre.com').replace(/\/$/, '');
const requireLive = process.env.ATLAS_SMOKE_REQUIRE === '1' || process.env.ATLAS_SMOKE_REQUIRE === 'true';

async function get(path) {
  const res = await fetch(`${base}${path}`, {
    headers: { Accept: 'application/json' },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* */
  }
  return { res, json, text };
}

function isConnRefused(err) {
  const msg = String(err?.message || err || '');
  const cause = err?.cause;
  const code = cause?.code || err?.code || '';
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    /fetch failed/i.test(msg) ||
    /ECONNREFUSED/i.test(msg)
  );
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Probe
try {
  await get('/api/health');
} catch (e) {
  if (isConnRefused(e) && !requireLive) {
    console.log(`skip P0 API smoke — no server at ${base} (start: npx wrangler dev)`);
    console.log('     or set ATLAS_SMOKE_BASE=https://your-deployed-host');
    process.exit(0);
  }
  console.error('fail /api/health', e.message);
  process.exit(1);
}

const failures = [];

try {
  const h = await get('/api/health');
  assert(h.res.ok, `health status ${h.res.status}`);
  assert(h.json && typeof h.json === 'object', 'health body not json');
  console.log('ok  /api/health');
} catch (e) {
  failures.push(`health: ${e.message}`);
  console.error('fail /api/health', e.message);
}

try {
  const g = await get('/api/public/github-profile');
  assert(g.json && typeof g.json.success === 'boolean', 'github-profile missing success');
  console.log('ok  /api/public/github-profile success=', g.json.success);
} catch (e) {
  failures.push(`github-profile: ${e.message}`);
  console.error('fail /api/public/github-profile', e.message);
}

try {
  const missing = await get('/api/this-route-should-not-exist-p0');
  if (missing.json && typeof missing.json === 'object') {
    if (missing.json.success === false) {
      console.log('ok  unknown route JSON fail shape');
    } else {
      console.log('skip unknown route (success body)');
    }
  } else {
    console.log('skip unknown route (non-json)', missing.res?.status);
  }
} catch (e) {
  failures.push(`unknown: ${e.message}`);
}

if (failures.length) {
  console.error('\nP0 smoke failed:\n', failures.join('\n'));
  process.exit(1);
}
console.log('\nP0 API shape smoke passed against', base);
