/** Product identity + version — all releases are beta until stable. */
export const APP_NAME = 'Atlas Commerce';
export const APP_TAGLINE = 'Stock · Caisse · Facturation';
export const APP_VERSION = '0.7.7-beta';
/* v0.7 — date toujours à jour (demande user) : date du jour UTC. */
export const APP_BUILD_DATE = new Date().toISOString().slice(0, 10);
export const APP_BUILD = APP_BUILD_DATE;
export const APP_CHANNEL = 'beta' as const;

export const APP_CREATOR = 'etherealmber';
export const APP_CREATOR_NAME = 'Etherealmber';
export const APP_TEAM = 'etherealmber';
export const APP_GITHUB = 'https://github.com/etherealmber';
export const APP_TEAM_GITHUB = 'https://github.com/etherealmber';
export const APP_INSTAGRAM = '';
export const APP_LOCATION = 'El Jadida, Maroc';
export const APP_DESCRIPTION =
  'Logiciel de gestion stock, caisse et facturation pour commerces et entrepôts au Maroc.';
export const APP_PROFILE = 'https://github.com/etherealmber';

/**
 * VERSION AFFICHÉE (directive utilisateur, 06/11/2026) : 0.7.9 partout — saut
 * DIRECT depuis 0.7.5 (rien entre les deux : ni 0.7.6, ni 0.7.7, ni 0.7.8).
 * Le journal « Nouveautés » reste figé sur sa release publique 0.7.5 : aucune
 * version intermédiaire ni entrée 0.7.9 n'y est ajoutée (directive). Ne bumper
 * qu' sur ordre explicite.
 */
export const DISPLAY_VERSION = '0.7.9';
export const RELEASE_VISIBLE_CAP = '0.7.9';

/** true si `v` (ex. « 0.7.2 », « 0.7.6-beta ») est ≤ `cap` en semver simplifié. */
export function semverAtMost(v: string, cap: string): boolean {
  const parse = (x: string): number[] =>
    (x.match(/(\d+)\.(\d+)\.(\d+)/) || []).slice(1, 4).map(Number);
  const a = parse(v);
  const b = parse(cap);
  if (a.length < 3 || b.length < 3) return true;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return true;
}
