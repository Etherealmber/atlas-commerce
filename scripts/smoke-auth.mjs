/**
 * Auth smoke — CI only. Does not run without secrets.
 *
 * Required env:
 *   ATLAS_SMOKE_BASE   e.g. https://stock.example.com
 *   ATLAS_SMOKE_USER
 *   ATLAS_SMOKE_PASSWORD
 *
 * Never commit real passwords. Use GitHub Actions secrets / Wrangler CI vars.
 */
const base = (process.env.ATLAS_SMOKE_BASE || '').replace(/\/$/, '');
const user = process.env.ATLAS_SMOKE_USER || '';
const pass = process.env.ATLAS_SMOKE_PASSWORD || '';

if (!base || !user || !pass) {
  console.log('skip auth smoke (set ATLAS_SMOKE_BASE, ATLAS_SMOKE_USER, ATLAS_SMOKE_PASSWORD)');
  process.exit(0);
}

const res = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  body: JSON.stringify({ username: user, password: pass }),
});
const json = await res.json().catch(() => ({}));
if (!res.ok && res.status !== 401 && res.status !== 403) {
  console.error('login unexpected status', res.status, json);
  process.exit(1);
}
// 200 = session; 401/403 = rejected but shape ok; 429 = rate limit
if (json && typeof json.success === 'boolean') {
  console.log('ok auth shape success=', json.success, 'status=', res.status);
  process.exit(0);
}
console.error('auth response missing success field', json);
process.exit(1);
