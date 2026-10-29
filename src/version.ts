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
