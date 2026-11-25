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

export { registerAtlasV209Routes, dispatchWebhook } from './atlas-v209';

export { registerFinanceRoutes } from './finance';

export { registerExpenseWriteRoutes } from './expenses';

export { registerVendorRoutes } from './vendors';
export { registerExportRoutes } from './exports';
export { registerMobileActionsRoutes } from './mobileActions';
export { registerAttendanceRoutes } from './attendance';
export { registerCatalogRoutes } from './catalog';
export { registerCategoriesUnitsRoutes } from './categoriesUnits';
export { registerDataImportRoutes } from './dataImport';
export { registerBackupRoutes, makeVerifyBackupAccess } from './backups';
export { registerReportRoutes, reportShell } from './reports';
export { registerInventoryOpsRoutes, ensureStockLocations, getDefaultLocationId, adjustLocationStock } from './inventoryOps';
export { registerAssistRoutes, purgeAgentConversationsOlderThan } from './assist';
export { registerReportsAndUpdatesRoutes, readAppUpdateState } from './reportsAndUpdates';
export { registerPublicSignedRoutes } from './publicSigned';
export { registerProductsScanRoutes } from './productsScan';
export { registerDashboardIntegrityRoutes } from './dashboardIntegrity';
export { registerMetricsRoutes, recordMetricSnapshots, todayUtc } from './metrics';
export { registerInvoicesWriteRoutes } from './invoicesWrite';
export { registerBillsReceiptsRoutes, ensureBillPaymentsTable } from './billsReceipts';
export { registerCashShiftRoutes } from './cashShifts';
export { registerPayrollRoutes } from './payroll';
export { registerFecRoutes } from './fec';
export { registerDunningRoutes, runDailyDunning } from './dunning';
export { registerDgiRoutes } from './dgi';
