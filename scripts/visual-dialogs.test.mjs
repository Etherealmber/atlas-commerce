import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visualDialogsForPage } from './visual-dialogs.mjs';

test('demo screenshots do not attempt to create users', () => {
  assert.deepEqual(visualDialogsForPage('16-settings-users', 'desktop'), []);
  assert.deepEqual(visualDialogsForPage('15-settings-categories', 'desktop'), [
    'category-create', 'category-edit', 'unit-create', 'unit-edit',
  ]);
  assert.deepEqual(visualDialogsForPage('15-settings-categories', 'mobile'), []);
});
