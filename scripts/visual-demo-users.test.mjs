import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDemoUserCreationDisabled } from './visual-demo-users.mjs';

test('requires a visible demo restriction and refuses a create button', async () => {
  const seen = [];
  const page = { waitForSelector: async (selector, options) => { seen.push([selector, options]); }, $: async () => null };
  await assertDemoUserCreationDisabled(page);
  assert.equal(seen[0][0], '[data-visual-review="demo-user-create-disabled"]');
  assert.equal(seen[0][1].visible, true);
  await assert.rejects(assertDemoUserCreationDisabled({ ...page, $: async () => ({}) }), /must not offer user creation/);
});

test('failure reports safe diagnostic state without swallowing the timeout', async () => {
  const page = {
    waitForSelector: async () => { throw new Error('timeout'); },
    evaluate: async () => ({ path: '/settings', tab: 'profile', isDemo: true, role: 'owner', hasSettingsError: false, hasCreateButton: false }),
  };
  await assert.rejects(assertDemoUserCreationDisabled(page), /notice missing.*"tab":"profile"/);
});
