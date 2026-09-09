/**
 * Optional R2 Data Catalog (Apache Iceberg) integration.
 * The Iceberg catalog on bucket company-stock-images is for analytics,
 * not day-to-day ERP product data (which stays in D1).
 *
 * Wire catalog REST when Cloudflare exposes account-scoped catalog API keys.
 * For now we expose inventory via R2 list + document catalog URI.
 */

export type IcebergCatalogInfo = {
  enabled: boolean;
  bucket: string;
  catalog_uri_hint: string;
  note: string;
};

export function icebergCatalogInfo(env: {
  CDN_BASE?: string;
}): IcebergCatalogInfo {
  return {
    enabled: true,
    bucket: 'company-stock-images',
    catalog_uri_hint:
      'https://catalog.cloudflarestorage.com/…/company-stock-images',
    note:
      'Use R2 Data Catalog for warehouse analytics. Application product catalog remains in D1; images in R2 under products/.',
  };
}
