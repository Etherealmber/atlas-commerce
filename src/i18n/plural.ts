/** CLDR plural selection for explicitly translated messages.
 * Catalog integration and translator-reviewed forms must be provided per message;
 * this helper never guesses or machine-translates missing forms. */
import { langMeta, type Lang } from './core';

export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
export type PluralForms = Partial<Record<PluralCategory, string>>;

export function requiredPluralCategories(lang: Lang): readonly PluralCategory[] {
  return new Intl.PluralRules(langMeta(lang).locale).resolvedOptions().pluralCategories as PluralCategory[];
}

/** All locale categories must exist; otherwise fail instead of displaying broken grammar. */
export function formatPlural(lang: Lang, count: number, forms: PluralForms): string {
  if (!Number.isFinite(count)) throw new RangeError('Plural count must be finite');
  const missing = requiredPluralCategories(lang).filter(category => typeof forms[category] !== 'string' || !forms[category]!.trim());
  if (missing.length) throw new Error(`Missing plural categories for ${lang}: ${missing.join(', ')}`);
  const category = new Intl.PluralRules(langMeta(lang).locale).select(count) as PluralCategory;
  const formatted = new Intl.NumberFormat(langMeta(lang).locale).format(count);
  // Isolate the numeric run, never reverse its digits.
  const number = lang === 'ar' ? `\u2066${formatted}\u2069` : formatted;
  return forms[category]!.replaceAll('{n}', () => number);
}
