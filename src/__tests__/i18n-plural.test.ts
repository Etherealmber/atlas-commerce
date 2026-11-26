import { describe, expect, it } from 'vitest';
import { formatPlural, requiredPluralCategories } from '../i18n/plural';

const ar = { zero: 'zero {n}', one: 'one {n}', two: 'two {n}', few: 'few {n}', many: 'many {n}', other: 'other {n}' };
describe('CLDR plural selection', () => {
  it.each([[0, 'zero'], [1, 'one'], [2, 'two'], [3, 'few'], [10, 'few'], [11, 'many'], [99, 'many'], [100, 'other'], [101, 'other'], [103, 'few'], [111, 'many'], [1.5, 'other']])('Arabic %s selects %s', (value, category) => {
    expect(formatPlural('ar', value as number, ar)).toMatch(new RegExp(`^${category} \\u2066.*\\u2069$`));
  });
  it('requires every locale form instead of silently guessing', () => {
    expect(requiredPluralCategories('ar')).toEqual(expect.arrayContaining(['zero', 'one', 'two', 'few', 'many', 'other']));
    expect(() => formatPlural('ar', 2, { other: '{n}' })).toThrow(/Missing plural categories/);
    expect(() => formatPlural('ar', Number.NaN, ar)).toThrow(RangeError);
  });
  it('uses each locale’s rules and substitutes every count placeholder', () => {
    expect(formatPlural('en', 1, { one: '{n} one', other: '{n} other' })).toBe('1 one');
    expect(formatPlural('en', 2, { one: '{n} one', other: '{n} other' })).toBe('2 other');
    const fr = Object.fromEntries(requiredPluralCategories('fr').map(category => [category, `${category} {n} / {n}`]));
    expect(formatPlural('fr', 0, fr)).toBe('one 0 / 0');
  });
});
