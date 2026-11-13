/** Detect the general sales-help intent without changing the anchored vente branch. */
export function isQuickSaleIntent(q: string): boolean {
  return (/^vente\b/.test(q) || /vendre|encaisser/.test(q)) && !/jour|aujourd|ca /.test(q);
}
