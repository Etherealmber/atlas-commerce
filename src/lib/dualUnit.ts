export type UnitOption = { id?: number | null; name: string; symbol?: string };

export const DEFAULT_UNIT_OPTIONS: UnitOption[] = [
  { name: 'unité', symbol: 'u' },
  { name: 'pièce', symbol: 'pce' },
  { name: 'kg', symbol: 'kg' },
  { name: 'g', symbol: 'g' },
  { name: 'L', symbol: 'L' },
  { name: 'mL', symbol: 'mL' },
  { name: 'm', symbol: 'm' },
  { name: 'cm', symbol: 'cm' },
  { name: 'm²', symbol: 'm²' },
  { name: 'm³', symbol: 'm³' },
  { name: 'boîte', symbol: 'bte' },
  { name: 'carton', symbol: 'ctn' },
  { name: 'paquet', symbol: 'paq' },
  { name: 'lot', symbol: 'lot' },
  { name: 'sac', symbol: 'sac' },
  { name: 'bouteille', symbol: 'btl' },
  { name: 'pack', symbol: 'pack' },
  { name: 'douzaine', symbol: 'dz' },
  { name: 'heure', symbol: 'h' },
  { name: 'jour', symbol: 'j' },
  { name: 'forfait', symbol: 'forf' },
  { name: 'service', symbol: 'svc' },
];

export function mergeUnitOptions(serverUnits: UnitOption[] = []): UnitOption[] {
  const seen = new Set<string>();
  const out: UnitOption[] = [];
  for (const raw of [...serverUnits, ...DEFAULT_UNIT_OPTIONS]) {
    const name = String(raw?.name || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: raw.id ?? null, name, symbol: raw.symbol || '' });
  }
  return out;
}

/** Inventory and prices remain in the primary unit. The second unit is a
 * derived display only, never an independent stock balance. */
export type DualUnitProduct = {
  unit?: string | null;
  secondary_unit?: string | null;
  secondary_unit_factor?: number | string | null;
  stock_quantity?: number | null;
  stock?: number | null;
};
const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 6 });
export function dualStockLabel(product: DualUnitProduct, quantity = Number(product.stock_quantity ?? product.stock ?? 0)): string {
  const base = `${numberFormat.format(quantity)}${product.unit ? ` ${product.unit}` : ''}`;
  const factor = Number(product.secondary_unit_factor);
  const converted = quantity * factor;
  if (!product.secondary_unit || !Number.isFinite(factor) || factor <= 0 || !Number.isFinite(converted)) return base;
  return `${base} · ${numberFormat.format(converted)} ${product.secondary_unit}`;
}
