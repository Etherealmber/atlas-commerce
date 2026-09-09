/** RBAC — shared by Worker */

export function normalizeRole(role: string | undefined | null): string {
  const r = String(role || 'user').toLowerCase().trim();
  if (r === 'owner' || r === 'admin' || r === 'secretaire' || r === 'stock' || r === 'user') return r;
  return 'user';
}

/** Invoices, clients, hard product create, payments — not stock-only floor staff */
export function canMutateBusiness(role: string | undefined | null): boolean {
  const r = normalizeRole(role);
  return r === 'owner' || r === 'admin' || r === 'secretaire';
}

export function canHardDeleteStock(role: string | undefined | null): boolean {
  const r = normalizeRole(role);
  return r === 'owner' || r === 'admin';
}

/** Floor: scan, propose products, stock checks */
export function canFloorStock(role: string | undefined | null): boolean {
  const r = normalizeRole(role);
  return r === 'owner' || r === 'admin' || r === 'secretaire' || r === 'stock';
}
