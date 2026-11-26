import test from 'node:test';
import assert from 'node:assert/strict';
import { whatsNewVersion } from './visual-current-version.mjs';

test('visual fixtures use a published release version', () => {
  assert.match(whatsNewVersion, /^\d+\.\d+\.\d+$/);
});
