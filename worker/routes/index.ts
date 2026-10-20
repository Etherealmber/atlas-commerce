/**
 * Domain route modules — gradually peel handlers off worker/index.ts.
 */
export { registerAdminReadRoutes } from './admin';
export { registerInvoiceReadRoutes } from './invoices';
export { registerStockReadRoutes } from './stock';
export { registerWholesaleRoutes } from './wholesale';
export { registerEmployeeRoutes } from './employees';
export { registerPublicRoutes } from './public';
export { registerClientRoutes } from './clients';

export { registerPartnerV1Routes } from './partner-v1';

export { registerMailboxRoutes } from './mailbox';

export { registerAtlasV209Routes, dispatchWebhook, ensureV209Schema } from './atlas-v209';
