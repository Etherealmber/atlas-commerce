import { describe, expect, it } from 'vitest';

import { RELEASES } from '../pages/WhatsNew';

/**
 * v0.7 — the public changelog must never lose an entry, and 0.7.0-beta must
 * exist (APP_VERSION is 0.7.0-beta while the page used to stop at 0.6.6-beta,
 * so the "Nouveautés" badge pointed at an empty section).
 */
describe('WhatsNew releases', () => {
  it('0.7.0-beta is the first release and covers the 0.7 batch', () => {
    expect(RELEASES[0].version).toBe('0.7.0-beta');
    const texts = RELEASES[0].sections.flatMap((s) => s.items.map((i) => i.text)).join(' ');
    expect(texts).toContain('response_language');
    expect(texts).toContain('APP_UPDATE_REQUIRED');
    expect(texts).toContain('sans compte');
    expect(texts).toContain('Accept-Language');
    expect(texts).toContain('FCM');
    expect(texts).toContain('assetlinks');
    expect(texts).toContain('reçu PDF');
  });

  it('every release keeps a unique version and valid items', () => {
    const versions = RELEASES.map((r) => r.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (const release of RELEASES) {
      expect(release.date.length).toBeGreaterThan(4);
      expect(release.sections.length).toBeGreaterThan(0);
      for (const section of release.sections) {
        expect(['features', 'improvements', 'fixes', 'breaking']).toContain(section.kind);
        for (const item of section.items) {
          expect(item.id.length).toBeGreaterThan(0);
          expect(item.text.length).toBeGreaterThan(10);
        }
      }
    }
  });

  it('0.7.0-beta covers web, android, desktop and server scopes', () => {
    const items = RELEASES[0].sections.flatMap((s) => s.items) as any[];
    const plats = new Set(items.flatMap((i) => i.platforms || []));
    for (const p of ['web', 'android', 'desktop', 'server']) {
      expect(plats.has(p)).toBe(true);
    }
    const texts = items.map((i) => i.text).join(' ');
    expect(texts).toContain('RTL');
    expect(texts).toContain('GitHub Releases');
  });

  it('platform badges stay within the allowlist, item ids are unique', () => {
    const ids: string[] = [];
    for (const release of RELEASES) {
      for (const section of release.sections) {
        for (const item of section.items as any[]) {
          ids.push(item.id);
          expect((item.platforms || []).length).toBeGreaterThan(0);
          for (const pl of item.platforms || []) {
            expect(['web', 'android', 'desktop', 'server']).toContain(pl);
          }
        }
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no historical release was removed', () => {
    const versions = RELEASES.map((r) => r.version);
    for (const kept of [
      '0.6.6-beta', '0.6.5-beta', '0.6.4-beta', '0.6.3-beta', '0.6.2-beta', '0.6.1-beta',
      '0.5.9-beta', '0.5.8-beta', '0.5.7-beta', '0.5.6-beta', '0.5.5-beta', '0.5.4-beta',
      '0.5.3-beta', '0.5.2-beta', '0.5.1-beta', '0.5.0-beta', '0.4.9-beta', '0.4.8-beta',
      '0.4.7-beta', '0.4.6-beta',
    ]) {
      expect(versions).toContain(kept);
    }
  });
});
