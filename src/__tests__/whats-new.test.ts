import { describe, expect, it } from 'vitest';

import { RELEASES } from '../pages/WhatsNew';
import { APP_VERSION, DISPLAY_VERSION, RELEASE_VISIBLE_CAP, WHATS_NEW_VERSION, semverAtMost } from '../version';

/**
 * v0.7 — the public changelog must never lose an entry, and 0.7.0-beta must
 * exist (APP_VERSION is 0.7.0-beta while the page used to stop at 0.6.6-beta,
 * so the "Nouveautés" badge pointed at an empty section).
 */
describe('WhatsNew releases', () => {
  it('publishes the authorized 0.8.1 notes without changing the product version', () => {
    expect(DISPLAY_VERSION).toBe('0.8.1');
    expect(RELEASE_VISIBLE_CAP).toBe('0.8.1');
    expect(APP_VERSION).toBe('0.8.1-beta');
    expect(RELEASES[0].version).toBe('0.8.1');
    expect(WHATS_NEW_VERSION).toBe(RELEASES[0].version);
    expect(RELEASES[0].sections.flatMap((s) => s.items).map((i) => i.id)).toEqual(['081s1', '081s2', '081s4', '081s5', '081s3']);
    const text = RELEASES[0].sections.flatMap((s) => s.items).map((i) => i.text).join(' ');
    expect(text).toContain('reste désactivé');
    expect(text).toContain('79 tests backend');
    expect(text).toContain('Connexion sur VPN et réseaux partagés');
    expect(text).toContain('compteurs persistants');
    expect(text).toContain('même budget de tentatives OTP');
    const previous = RELEASES.find((r) => r.version === '0.8.0')!;
    expect(previous.sections.flatMap((s) => s.items).map((i) => i.id)).toEqual(['080s1', '080s2', '080s4', '080s3']);
    for (const release of RELEASES) expect(semverAtMost(release.version, DISPLAY_VERSION)).toBe(true);
  });

  it('keeps the published 0.7.9 additions', () => {
    const release = RELEASES.find((r) => r.version === '0.7.9')!;
    expect(release.date).toBe('5 novembre 2026');
    const items = release.sections.flatMap((s) => s.items);
    expect(items.map((i) => i.id)).toEqual(['079s1', '079s2', '079s3', '079s4', '079s5']);
    const texts = items.map((i) => i.text).join(' ');
    for (const detail of ['push', 'approbation ou refus', 'streaming', 'Support et Hébergement', '7 tests']) {
      expect(texts).toContain(detail);
    }
    for (const release of RELEASES) {
      expect(semverAtMost(release.version, DISPLAY_VERSION)).toBe(true);
    }
  });

  it('the public log merges everything after 0.7.2 under 0.7.5 (bump 0.7.2 -> 0.7.5, no .3/.4)', () => {
    // v0.7.5 — groupes internes *-beta fusionnés sous la release publique 0.7.5.
    expect(RELEASES.find((r) => r.version === '0.7.5')).toBeDefined();
    expect(semverAtMost(RELEASES[0].version, RELEASE_VISIBLE_CAP)).toBe(true);
    const versions = RELEASES.map((r) => r.version);
    for (const hidden of ['0.7.3-beta', '0.7.4-beta', '0.7.5-beta', '0.7.6-beta', '0.7.7-beta']) {
      expect(versions).not.toContain(hidden);
    }
    // v0.7.9 — directive : aucune version entre 0.7.5 et 0.7.9 dans le journal.
    for (const between of ['0.7.6', '0.7.7', '0.7.8']) {
      expect(versions).not.toContain(between);
    }
    // v0.7.5 — release publique condensée en résumés thématiques courts.
    const topItems = RELEASES.find((r) => r.version === '0.7.5')!.sections.flatMap((s) => s.items);
    expect(topItems.length).toBeLessThanOrEqual(12);
    const topIds = topItems.map((i) => i.id);
    expect(topIds).toContain('075s1'); // comptes : reprise sans OTP + bascule
    expect(topIds).toContain('075s10'); // correctifs groupés
    for (const item of topItems) {
      expect(item.platforms?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('0.7.0-beta keeps the 0.7 batch', () => {
    const r07 = RELEASES.find((r) => r.version === '0.7.0-beta');
    expect(r07).toBeDefined();
    const texts = (r07 as any).sections.flatMap((s: any) => s.items.map((i: any) => i.text)).join(' ');
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
    const r07 = RELEASES.find((r) => r.version === '0.7.0-beta') as any;
    const items = r07.sections.flatMap((s: any) => s.items) as any[];
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
