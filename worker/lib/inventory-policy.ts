/**
 * v0.7.1 — Server-side role-based inventory privacy (Atlas Commerce Worker).
 *
 * Policy (single source of truth, enforced on EVERY response — Android, web,
 * agent/LLM context — by omitting restricted fields from the JSON, never by
 * client-side masking):
 *
 *  - owner / admin            → financial access (costs, valuation, totals…);
 *  - owner / admin / secretaire → selling prices needed for sales;
 *  - stock (magasinier) / user (operator) → operational product basics and
 *    stock quantities ONLY: no selling price, no cost price, no stock
 *    valuation, no sales totals, no balances, no receivables/payables, no
 *    payroll amounts.
 *
 * Stock-adjustment workflow roles:
 *  - submit request  : any authenticated role (stock/user cannot mutate stock
 *                      directly — see roleCanDirectAdjustStock);
 *  - approve / reject: owner / admin / secretaire only;
 *  - direct adjust   : owner / admin / secretaire only (POST
 *                      /api/products/:id/adjust-stock); stock/user get 403
 *                      APPROVAL_REQUIRED and must use
 *                      POST /api/stock-adjustment-requests.
 *
 * Identity/role/tenant always come from the signed server session token (and a
 * fresh users-table read at decision time) — never from client-supplied body
 * or query values. The deployment is single-tenant per D1 database: a product
 * that does not exist in this database IS the cross-tenant case (404).
 */

/** Fields that carry selling-price information. */
export const SELL_PRICE_FIELDS = ['price', 'unit_price'] as const;

/** Fields that carry cost / valuation / margin information. */
export const COST_FIELDS = [
  'cost',
  'cost_price',
  'average_cost',
  'stock_value',
  'valuation',
  'margin',
] as const;

export function normalizeInventoryRole(role: unknown): string {
  const r = String(role || '')
    .trim()
    .toLowerCase();
  return ['owner', 'admin', 'secretaire', 'stock', 'user'].includes(r) ? r : 'user';
}

/** Owner/admin only: costs, valuation, sales totals, balances, payroll… */
export function roleCanSeeFinancial(role: string): boolean {
  const r = normalizeInventoryRole(role);
  return r === 'owner' || r === 'admin';
}

/** Selling prices (needed for sales): owner/admin/secretaire. */
export function roleCanSeeSellPrices(role: string): boolean {
  const r = normalizeInventoryRole(role);
  return r === 'owner' || r === 'admin' || r === 'secretaire';
}

/** Approve/reject stock-adjustment requests: owner/admin/secretaire. */
export function roleCanApproveStockAdjustment(role: string): boolean {
  const r = normalizeInventoryRole(role);
  return r === 'owner' || r === 'admin' || r === 'secretaire';
}

/** Any authenticated role may propose an adjustment (it never mutates stock). */
export function roleCanSubmitStockAdjustmentRequest(role: string): boolean {
  return !!normalizeInventoryRole(role);
}

/** Direct inventory mutation (adjust-stock): owner/admin/secretaire. */
export function roleCanDirectAdjustStock(role: string): boolean {
  return roleCanApproveStockAdjustment(role);
}

/**
 * Return a copy of a product row with the fields the role must never receive.
 * Owner/admin rows pass through untouched.
 */
export function scrubProductForRole<T extends Record<string, any>>(row: T, role: string): Partial<T> {
  const r = normalizeInventoryRole(role);
  if (roleCanSeeFinancial(r)) return { ...row };
  const out: Record<string, any> = { ...row };
  if (!roleCanSeeSellPrices(r)) {
    for (const f of SELL_PRICE_FIELDS) delete out[f];
  }
  for (const f of COST_FIELDS) delete out[f];
  return out as Partial<T>;
}

/**
 * Human-readable device label from a User-Agent string — the devices modal
 * must show a device name, never a raw fingerprint hex blob.
 *  "Atlas-Android/1.2.3 (Android 14; PGEM10)" → "Atlas Android 1.2.3 · PGEM10 (Android 14)"
 *  Chrome/Windows UA                          → "Chrome 15x · Windows 10/11"
 *  iPhone Safari UA                           → "Safari · iPhone (iOS 18.7)"
 */
export function deviceLabelFromUA(ua: unknown): string {
  const s = String(ua || '');
  if (!s) return 'Appareil';
  const atlas = s.match(/Atlas-Android\/([\d.]+)\s*\(([^;)]*?);\s*([^)]+)\)/i);
  if (atlas) return `Atlas Android ${atlas[1]} · ${String(atlas[3]).trim()} (${String(atlas[2]).trim()})`;
  const browser = /Edg\//.test(s)
    ? 'Edge'
    : /OPR\//.test(s)
      ? 'Opera'
      : /Chrome\//.test(s)
        ? 'Chrome'
        : /Firefox\//.test(s)
          ? 'Firefox'
          : /Safari\//.test(s)
            ? 'Safari'
            : 'Navigateur';
  const bver = (s.match(new RegExp(`${browser}\\/(\\d+)`)) || [])[1] || '';
  const ios = s.match(/\((iPhone|iPad)[^)]*OS\s+(\d+(?:[_]\d+)*)/i);
  if (ios) return `${browser}${bver ? ` ${bver}` : ''} · ${ios[1]} (iOS ${ios[2].replace(/_/g, '.')})`;
  const android = s.match(/\(Android\s+([\d.]+)/i);
  if (android) return `${browser}${bver ? ` ${bver}` : ''} · Android ${android[1]}`;
  const os = /Windows NT 10/.test(s)
    ? 'Windows 10/11'
    : /Windows NT/.test(s)
      ? 'Windows'
      : /Mac OS X/.test(s)
        ? 'macOS'
        : /Linux/.test(s)
          ? 'Linux'
          : '';
  const label = [browser + (bver ? ` ${bver}` : ''), os].filter(Boolean).join(' · ');
  return label || s.slice(0, 40);
}
