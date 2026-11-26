import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateCatalogs } from './i18n-validate.mjs';

test('validates placeholders, keys, duplicates and JSON', () => {
  const fr = '{"Bonjour {name}":"Bonjour {name}"}';
  const en = '{"Bonjour {name}":"Hello {name}"}';
  const ar = '{"Bonjour {name}":"مرحبا {name}"}';
  assert.deepEqual(validateCatalogs({fr, en, ar}), []);
  assert.match(validateCatalogs({fr, en: '{"Bonjour {name}":"Hello"}', ar}).join(), /placeholder mismatch/);
  assert.match(validateCatalogs({fr, en: '{}', ar}).join(), /missing translation/);
  assert.match(validateCatalogs({fr, en: '{"x":"one","x":"two"}', ar}).join(), /duplicate key/);
  assert.match(validateCatalogs({fr, en: '{', ar}).join(), /invalid JSON/);
});
