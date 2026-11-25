/** Back pill target for detail pages (product history, invoice, quick-sale ticket). */
export function detailBackTarget(pathname: string): { to: string; label: string } | null {
  if (/^\/products\/[^/]+\/historique\/?$/.test(pathname)) return { to: '/products', label: 'Produits' };
  if (/^\/invoices\/[^/]+\/?$/.test(pathname)) return { to: '/invoices', label: 'Factures' };
  if (/^\/quick-sale\/[^/]+\/?$/.test(pathname)) return { to: '/quick-sale', label: 'Ventes rapides' };
  return null;
}
