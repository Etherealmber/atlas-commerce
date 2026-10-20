/** Unique document titles per route — all under 60 characters. */

const BRAND = 'Atlas';

/** Exact path → title (no brand suffix yet). */
const EXACT: Record<string, string> = {
  '/': 'Tableau de bord',
  '/actions': 'Actions en attente',
  '/products': 'Produits & stock',
  '/scan': 'Scan code-barres',
  '/clients': 'Clients',
  '/employees': 'Employés',
  '/attendance': 'Présence',
  '/vendors': 'Fournisseurs',
  '/quotes': 'Devis',
  '/quick-sale': 'Vente rapide',
  '/invoices': 'Factures de vente',
  '/reimbursements': 'Remboursements',
  '/bills': "Factures d'achat",
  '/receipts': 'Reçus',
  '/balance': 'Solde & recettes',
  '/reports': 'Rapports & clôture',
  '/inventory-ops': 'Ops stock',
  '/settings': 'Paramètres',
  '/about': 'À propos',
  '/whats-new': 'Nouveautés',
  '/privacy': 'Confidentialité',
  '/terms': "Conditions d'utilisation",
  '/login': 'Connexion',
  '/welcome': 'Bienvenue',
  '/404': 'Page introuvable',
  '/403': 'Accès refusé',
};

function withBrand(page: string): string {
  const full = `${page} · ${BRAND}`;
  return full.length <= 60 ? full : page.slice(0, 60);
}

/**
 * Resolve a unique <title> for a location pathname.
 * Dynamic segments (ids) get a stable generic title.
 */
export function titleForPath(pathname: string): string {
  const path = (pathname || '/').replace(/\/+$/, '') || '/';

  if (EXACT[path]) return withBrand(EXACT[path]);

  // Dynamic desktop routes
  if (/^\/products\/[^/]+\/historique$/.test(path)) return withBrand('Historique produit');
  if (/^\/quick-sale\/[^/]+$/.test(path)) return withBrand('Détail vente rapide');
  if (/^\/invoices\/[^/]+$/.test(path)) return withBrand('Détail facture');
  if (/^\/error\/[^/]+$/.test(path)) return withBrand('Erreur');
  if (path.startsWith('/settings')) return withBrand('Paramètres');
  if (path === '/m-legacy') return withBrand('Mobile');

  return withBrand('Atlas Commerce');
}

const DEFAULT_DESC =
  'Atlas Commerce — stock, caisse et facturation pour commerces et entrepôts au Maroc.';
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
export function applyPageMeta(pathname: string): void {
  const title = titleForPath(pathname);
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
export function applyPageTitle(pathname: string): void {
  applyPageMeta(pathname);
}
