import { translate, type Lang } from '../i18n/core';

/** Unique document titles per route — all under 60 characters. */

const BRAND = 'Atlas';

/** Exact path → title (no brand suffix yet). */
const EXACT: Record<string, string> = {
  '/': 'Accueil',
  '/dashboard': 'Tableau de bord',
  '/android': 'Application Android',
  '/download': 'Application Android',
  '/desktop': 'Application bureau',
  '/m': 'Accueil',
  '/m/products': 'Produits & stock',
  '/m/scan': 'Scan code-barres',
  '/m/vente': 'Vente rapide',
  '/m/balance': 'Solde & mouvements',
  '/m/bills': "Factures d'achat",
  '/m/employees': 'Employés',
  '/m/warehouse': 'Opérations stock',
  '/m/invoice': 'Devis',
  '/m/settings': 'Paramètres',
  '/m/agent': 'Atlas Agent',
  '/m/more': 'Paramètres',
  '/actions': 'Actions en attente',
  '/products': 'Produits & stock',
  '/scan': 'Scan code-barres',
  '/clients': 'Clients',
  '/employees': 'Employés',
  '/payroll': 'Paie CNSS / AMO',
  '/attendance': 'Présence',
  '/vendors': 'Fournisseurs',
  '/quotes': 'Devis',
  '/quick-sale': 'Vente rapide',
  '/invoices': 'Factures de vente',
  '/reimbursements': 'Remboursements',
  '/bills': "Factures d'achat",
  '/receipts': 'Reçus',
  '/balance': 'Solde & mouvements',
  '/cash-shifts': 'Clôtures de caisse (X / Z)',
  '/reports': 'Rapports & clôture',
  '/inventory-ops': 'Opérations stock',
  '/settings': 'Paramètres',
  '/about': 'À propos',
  '/whats-new': 'Nouveautés',
  '/privacy': 'Confidentialité',
  '/licenses': 'Licences',
  '/terms': "Conditions d'utilisation",
  '/support': 'Support & assistance',
  '/supprot': 'Support & assistance',
  '/login': 'Connexion',
  '/welcome': 'Bienvenue',
  '/404': 'Page introuvable',
  '/403': 'Accès refusé',
};

function withBrand(page: string, lang: Lang): string {
  const localPage = translate(page, lang);
  const full = `${localPage} · ${translate(BRAND, lang)}`;
  return full.length <= 60 ? full : localPage.slice(0, 60);
}

/**
 * Resolve a unique <title> for a location pathname.
 * Dynamic segments (ids) get a stable generic title.
 */
export function titleForPath(pathname: string, lang: Lang = 'fr'): string {
  const path = (pathname || '/').replace(/\/+$/, '') || '/';

  if (EXACT[path]) return withBrand(EXACT[path], lang);

  // Dynamic desktop routes
  if (/^\/p\/[^/]+$/.test(path)) return withBrand('Détail produit', lang);
  if (/^\/products\/[^/]+\/historique$/.test(path)) return withBrand('Historique du produit', lang);
  if (/^\/quick-sale\/[^/]+$/.test(path)) return withBrand('Détail vente rapide', lang);
  if (/^\/invoices\/[^/]+$/.test(path)) return withBrand('Détail facture', lang);
  if (/^\/error\/[^/]+$/.test(path)) return withBrand('Erreur', lang);
  if (path.startsWith('/settings')) return withBrand('Paramètres', lang);
  if (path === '/m-legacy') return withBrand('Mobile', lang);

  return withBrand('Atlas Commerce', lang);
}

const DEFAULT_DESC =
  'Atlas Commerce — stock, caisse et facturation pour commerces et entrepôts.';
const OG_IMAGE = '/og-image.png';

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  try {
    let el = document.head.querySelector(`meta[${attr}="${key}"]`) as HTMLMetaElement | null;
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute(attr, key);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  } catch {
    /* */
  }
}

/** Title + Open Graph / Twitter cards for the current route. */
function applyPageMeta(pathname: string, lang: Lang): void {
  const title = titleForPath(pathname, lang);
  try {
    document.title = title;
  } catch {
    /* */
  }
  setMeta('property', 'og:title', title);
  setMeta('property', 'og:description', DEFAULT_DESC);
  setMeta('property', 'og:image', OG_IMAGE);
  setMeta('property', 'og:type', 'website');
  setMeta('property', 'og:site_name', 'Atlas Commerce');
  setMeta('name', 'twitter:card', 'summary_large_image');
  setMeta('name', 'twitter:title', title);
  setMeta('name', 'twitter:description', DEFAULT_DESC);
  setMeta('name', 'twitter:image', OG_IMAGE);
  setMeta('name', 'description', DEFAULT_DESC);
}

// Keep legacy name working
export function applyPageTitle(pathname: string, lang: Lang = 'fr'): void {
  applyPageMeta(pathname, lang);
}
