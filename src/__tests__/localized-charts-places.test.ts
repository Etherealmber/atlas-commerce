import { afterEach, describe, expect, it } from 'vitest';
import { setLang } from '../i18n/core';
import { cityName, countryName } from '../i18n/places';
import { formatAxisVal, formatCompactNum } from '../components/DashboardCharts';
import { compactMoney } from '../mobile/PhoneCharts';

afterEach(() => setLang('fr'));
describe('localized chart values and geographic display', () => {
  it('localizes compact numbers and currency without changing signs', () => {
    setLang('ar');
    expect(formatCompactNum(-1_200_000_000, 'MAD')).toBe('-1.2 مليار درهم');
    expect(formatAxisVal(2000, 2000)).toBe('2 ألف');
    expect(compactMoney(2_000_000)).toContain('مليون');
    expect(compactMoney(1_000_000_000)).toContain('مليار');
    setLang('en');
    expect(formatCompactNum(2_500_000, 'DH')).toBe('2.5M MAD');
  });
  it('translates known places, preserves unknown values and handles Tor', () => {
    expect(cityName('Casablanca', 'ar')).toBe('الدار البيضاء');
    expect(cityName('Unknown City', 'ar')).toBe('Unknown City');
    expect(countryName('MA', 'ar')).toBe('المغرب');
    expect(countryName('Morocco', 'en')).toBe('Morocco');
    expect(countryName('T1', 'ar')).toBe('Tor');
    expect(countryName('somewhere unknown', 'ar')).toBe('somewhere unknown');
  });
});
