// Disposable local demo only: prove the issued wrapped token actually works.
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:5173';
const fingerprint = `demo-login-smoke-${Date.now()}`;
const headers = { 'content-type': 'application/json', 'x-device-fingerprint': fingerprint };
const response = await fetch(`${base}/api/auth/login`, {
  method: 'POST', headers,
  body: JSON.stringify({ username: 'test', password: 'test', fingerprint, client: 'web' }),
});
const login = await response.json();
assert.equal(response.status, 200, `Demo login failed: ${login.code || response.status}`);
assert.equal(login.needs_otp, false);
assert.equal(login.demo?.active, true);
assert.ok(login.token?.startsWith('atlasdemo.'));
const me = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${login.token}`, 'x-device-fingerprint': fingerprint } });
assert.equal(me.status, 200, `Demo session was not usable: ${me.status}`);
console.log('Demo login and authenticated session passed.');
