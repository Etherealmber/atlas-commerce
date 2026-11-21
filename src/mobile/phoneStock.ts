/** Product fields returned by the mobile catalog and barcode endpoints. */
export type PhoneStock = {
  stock_quantity?: number | null;
  stock?: number | null;
  low_stock_threshold?: number | null;
  min_stock?: number | null;
  track_inventory?: number | boolean | null;
};
export function phoneStockQuantity(product: PhoneStock): number {
  return Number(product.stock_quantity ?? product.stock ?? 0);
}
export function phoneStockThreshold(product: PhoneStock): number {
  return Number(product.low_stock_threshold ?? product.min_stock ?? 5);
}
export function phoneStockIsLow(product: PhoneStock): boolean {
  if (product.track_inventory != null && !Number(product.track_inventory)) return false;
  return phoneStockQuantity(product) <= phoneStockThreshold(product);
}
