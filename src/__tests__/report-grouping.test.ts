import { describe, expect, it } from 'vitest';
import { groupSimilarReports, pageOf, reportTitle } from '../lib/reportGrouping';

const R = (id: number, message: string) => ({ id, message, kind: 'bug', channel: 'android' });
// The real list from Settings (R-1…R-7).
const reports = [
  R(7, 'Type: BUG · Mise à jour / Réseau Titre: it doest let me log in only after some trime same the serevr check plus it ask for otp once again Appareil: Microsoft Corporation Subsystem for Android(TM) · Android 17 (SDK 37) App: v1.6.1 (161)'),
  R(6, 'Type: OTHER · Autre anomalie Titre: firebase crash analytics Description: cant use crash analytics firebase is initilaized Appareil: Samsung SM-X910N · Android 14 (SDK 34) App: v1.5.1 (151)'),
  R(5, 'Automatic Android passkey failure Stage: REGISTRATION_TIMEOUT HTTP status: not available Android SDK: 34 App: 1.2.6 (126)'),
  R(4, 'Type: BUG · Affichage / Interface Titre: passkey stuck Description: kepp or still stuck Appareil: OPPO PGEM10 · Android 14 (SDK 34) App: v1.2.2 (122)'),
  R(3, 'Type: BUG · Affichage / Interface Titre: passkey doesnt work at all Description: paskkey Appareil: OPPO PGEM10 · Android 14 (SDK 34) App: v1.2.1 (121)'),
  R(2, 'Type: BUG · Affichage / Interface Titre: Affichage / Interface Appareil: OPPO PGEM10 · Android 14 (SDK 34) App: v1.1.8 (118)'),
  R(1, 'Type: BUG · Affichage / Interface Titre: passkye Description: paskskye doesnt work at all Appareil: OPPO PGEM10 · Android 14 (SDK 34) App: v1.1.7 (117)'),
];

describe('look-alike report grouping', () => {
  it('extracts what the user typed', () => {
    expect(reportTitle(reports[3].message)).toBe('passkey stuck — kepp or still stuck');
  });
  it('groups the passkey reports together and keeps unrelated ones single', () => {
    const { clusters, singles } = groupSimilarReports(reports);
    const passkey = clusters.find((c) => c.items.some((r) => r.id === 3));
    expect(passkey?.items.map((r) => r.id)).toEqual(expect.arrayContaining([5, 4, 3, 1]));
    expect(singles.map((r) => r.id)).toEqual(expect.arrayContaining([7, 6]));
    expect(singles.some((r) => r.id === 3)).toBe(false);
  });
  it('matches French and English wording but not a single shared word', () => {
    const list = [
      R(1, 'Titre: Passkey bloquée Description: impossible de créer une passkey'),
      R(2, 'Titre: passkey stuck Description: stuck at creation'),
      R(3, 'Titre: Facture PDF vide Description: le PDF de la facture est vide'),
      R(4, 'Titre: PDF facture vide à l’impression'),
      R(5, 'Titre: Impression ticket 58mm'),
    ];
    const { clusters, singles } = groupSimilarReports(list);
    expect(clusters.map((c) => c.items.map((r) => r.id))).toEqual([[1, 2], [3, 4]]);
    expect(singles.map((r) => r.id)).toEqual([5]);
  });
  it('pages lists', () => {
    const list = Array.from({ length: 23 }, (_, i) => i);
    expect(pageOf(list, 0, 10)).toHaveLength(10);
    expect(pageOf(list, 2, 10)).toEqual([20, 21, 22]);
  });
});
