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

export { registerFinanceRoutes } from './finance';

export { registerExpenseWriteRoutes } from './expenses';

export { registerVendorRoutes } from './vendors';
export { registerExportRoutes } from './exports';
export { registerMobileActionsRoutes } from './mobileActions';
export { registerAttendanceRoutes } from './attendance';
export { registerCatalogRoutes } from './catalog';
export { registerCategoriesUnitsRoutes } from './categoriesUnits';
export { registerDataImportRoutes } from './dataImport';
export { registerBackupRoutes, purgeExpiredBackups, runDailyBackup, makeVerifyBackupAccess } from './backups';
export { registerReportRoutes, reportShell, type ReportRouteDeps } from './reports';
export {
  registerInventoryOpsRoutes,
  ensureMarbleUnits,
  ensureStockLocations,
  placeProductStockOnDefault,
  getDefaultLocationId,
  adjustLocationStock,
  ensureBillReceive,
  type InventoryOpsRouteDeps,
} from './inventoryOps';
export { registerAssistRoutes, purgeAgentConversationsOlderThan, type AssistRouteDeps } from './assist';
export {
  registerReportsAndUpdatesRoutes,
  readAppUpdateState,
  APP_UPDATE_MAX_APK_BYTES,
  type ReportsAndUpdatesDeps,
} from './reportsAndUpdates';
export {
  registerPublicSignedRoutes,
  ensureReceiptPublicToken,
  renderPublicReceiptVerify,
  type PublicSignedRouteDeps,
} from './publicSigned';
export { registerProductsScanRoutes, type ProductsScanRouteDeps } from './productsScan';
export { registerDashboardIntegrityRoutes, type DashboardIntegrityRouteDeps } from './dashboardIntegrity';
export { registerInvoicesWriteRoutes, type InvoicesWriteRouteDeps } from './invoicesWrite';
export { registerBillsReceiptsRoutes, ensureBillPaymentsTable, type BillsReceiptsRouteDeps } from './billsReceipts';
export { registerCashShiftRoutes, type CashShiftRouteDeps } from './cashShifts';
export { registerPayrollRoutes, type PayrollRouteDeps } from './payroll';
export { registerFecRoutes, type FecRouteDeps } from './fec';
export { registerDunningRoutes, runDailyDunning, type DunningRouteDeps } from './dunning';
