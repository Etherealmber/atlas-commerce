import { describe, expect, it } from 'vitest';
import { publicationDate, sameReleaseVersion } from '../lib/releaseDate';
import { RELEASES } from '../pages/WhatsNew';

describe('release dates', () => {
  it('keeps release dates valid and in newest-first order', () => {
    const months = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    let previous = Infinity;
    for (const release of RELEASES) {
      const match = /^(\d{1,2}) ([a-zéû]+) (\d{4})$/.exec(release.date);
      expect(match, `Invalid date for ${release.version}`).not.toBeNull();
      if (!match) throw new Error(`Invalid date for ${release.version}`);
      const day = Number(match[1]), month = months.indexOf(match[2]), year = Number(match[3]);
      expect(month, `Invalid month for ${release.version}`).toBeGreaterThanOrEqual(0);
      const date = new Date(Date.UTC(year, month, day));
      expect(date.getUTCFullYear()).toBe(year);
      expect(date.getUTCMonth()).toBe(month);
      expect(date.getUTCDate()).toBe(day);
      expect(date.getTime(), `${release.version} is dated after a newer release`).toBeLessThanOrEqual(previous);
      previous = date.getTime();
    }
  });
  it('formats the published calendar day without shifting time zones', () => {
    expect(publicationDate('2026-11-22T23:59:59Z')).toBe('22 novembre 2026');
    expect(publicationDate('2026-11-17')).toBe('17 novembre 2026');
  });
  it('does not invent a date or match unrelated versions', () => {
    expect(publicationDate(undefined)).toBeNull(); expect(publicationDate('2026-02-31')).toBeNull();
    expect(sameReleaseVersion('v1.8.0', '1.8.0')).toBe(true);
    expect(sameReleaseVersion('v1.8.1', '1.8.0')).toBe(false);
    expect(sameReleaseVersion(undefined, '1.8.0')).toBe(false);
  });
});
