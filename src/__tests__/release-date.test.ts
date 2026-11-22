import { describe, expect, it } from 'vitest';
import { publicationDate, sameReleaseVersion } from '../lib/releaseDate';
describe('release dates', () => {
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
