import { getLang, type Lang } from './core';

// Only known geographic display values are translated. Unknown names stay intact.
const cities: Record<string, readonly [string, string, string]> = {
  casablanca: ['Casablanca', 'Casablanca', 'الدار البيضاء'],
  rabat: ['Rabat', 'Rabat', 'الرباط'],
  marrakech: ['Marrakech', 'Marrakesh', 'مراكش'],
  marrakesh: ['Marrakech', 'Marrakesh', 'مراكش'],
  fes: ['Fès', 'Fez', 'فاس'], 'fès': ['Fès', 'Fez', 'فاس'], fez: ['Fès', 'Fez', 'فاس'],
  tangier: ['Tanger', 'Tangier', 'طنجة'], tanger: ['Tanger', 'Tangier', 'طنجة'],
  agadir: ['Agadir', 'Agadir', 'أكادير'], meknes: ['Meknès', 'Meknes', 'مكناس'],
  oujda: ['Oujda', 'Oujda', 'وجدة'], paris: ['Paris', 'Paris', 'باريس'],
  london: ['Londres', 'London', 'لندن'], londres: ['Londres', 'London', 'لندن'],
  tokyo: ['Tokyo', 'Tokyo', 'طوكيو'],
};
const regions: Record<string, string> = { morocco: 'MA', maroc: 'MA', 'المغرب': 'MA', france: 'FR', japan: 'JP', japon: 'JP', 'united kingdom': 'GB', 'united states': 'US' };
export function cityName(value?: string | null, lang: Lang = getLang()): string {
  const raw = value?.trim() || '';
  const known = cities[raw.toLocaleLowerCase('en')];
  return known ? known[lang === 'fr' ? 0 : lang === 'en' ? 1 : 2] : raw;
}
export function countryName(value?: string | null, lang: Lang = getLang()): string {
  const raw = value?.trim() || '';
  const code = regions[raw.toLocaleLowerCase('en')] || raw.toUpperCase();
  if (code === 'T1') return 'Tor';
  if (!/^[A-Z]{2}$/.test(code) || code === 'XX') return raw;
  try { return new Intl.DisplayNames([lang], { type: 'region' }).of(code) || raw; } catch { return raw; }
}
