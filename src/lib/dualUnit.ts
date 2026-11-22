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
