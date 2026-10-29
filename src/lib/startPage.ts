/**
 * v0.7.6 — « page d'ouverture » : chaque personne choisit où arriver après
 * la connexion (et en ouvrant « / » connecté) : tableau de bord par défaut,
 * ou n'importe quelle page de l'app, ou la vitrine publique.
 *
 * Préférence côté client (localStorage) : elle fonctionne partout, y compris
 * en auto-hébergement, sans réglage serveur ni migration de base.
 */

export type StartPage = { value: string; label: string };

export const START_PAGES: StartPage[] = [
  { value: '/dashboard', label: 'Tableau de bord' },
  { value: '/quick-sale', label: 'Vente rapide (caisse)' },
  { value: '/products', label: 'Stock & produits' },
  { value: '/clients', label: 'Clients' },
  { value: '/invoices', label: 'Factures' },
  { value: '/balance', label: 'Créances & balance' },
  { value: '/reports', label: 'Rapports' },
  { value: '/settings', label: 'Paramètres' },
  { value: '/home', label: 'Accueil public (vitrine)' },
];

const KEY = 'atlas-start-page';
export const START_PAGE_EVENT = 'atlas-start-page-change';

export function getStartPage(): string {
  try {
    const v = localStorage.getItem(KEY);
    return v && START_PAGES.some((p) => p.value === v) ? v : '/dashboard';
  } catch {
    return '/dashboard';
  }
}

export function setStartPage(v: string): void {
  const ok = START_PAGES.some((p) => p.value === v) ? v : '/dashboard';
  try {
    localStorage.setItem(KEY, ok);
  } catch { /* navigation privée */ }
  window.dispatchEvent(new Event(START_PAGE_EVENT));
}

/** Destination réelle après connexion : « /home » signifie la vitrine « / ». */
export function startDestination(): string {
  const sp = getStartPage();
  return sp === '/home' ? '/' : sp;
}
