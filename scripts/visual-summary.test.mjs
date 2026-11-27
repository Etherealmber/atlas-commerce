import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { selectPreviews } from './visual-summary.mjs';

test('selects all safe screenshots across languages, excluding diagnostics', () => {
  const names = [];
  for (const lang of ['ar', 'en', 'fr']) for (const device of ['desktop', 'mobile']) for (const page of ['01-dashboard', '02-products', '03-clients']) names.push(`${page}--${lang}--${device}--light.png`);
  names.push('../secret.png', 'not-demo.png', 'x--ar--desktop--loading.png');
  const result = selectPreviews(names);
  assert.equal(result.length, 18);
  assert.equal(new Set(result).size, 18);
  assert.ok(result.some(x => x.includes('--ar--')) && result.some(x => x.includes('--en--')) && result.some(x => x.includes('--fr--')));
  assert.ok(result.every(x => names.includes(x) && x.endsWith('--light.png')));
});
test('handles partial and empty captures', () => {
  assert.deepEqual(selectPreviews([]), []);
  assert.deepEqual(selectPreviews(['01-dashboard--en--desktop--light.png']), ['01-dashboard--en--desktop--light.png']);
});

test('bounds summary output for unusually large capture sets', () => {
  const files = Array.from({ length: 600 }, (_, i) => `${i}-page--en--desktop--light.png`);
  assert.equal(selectPreviews(files).length, 500);
});
