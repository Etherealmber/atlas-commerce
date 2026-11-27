import { parseJournalDeviceContext } from './lib/journalDeviceContext';
import { withBufferedJournal } from './lib/journalBuffered';
import { otpCopy } from './lib/otpCopy';
import { withAuditShadow } from './lib/auditShadow';
import { REPORT_TICKET_PATHS, mintScopedReportTicket, verifyScopedReportTicket, verifyScopedPrintTicket } from './lib/report-ticket';
import { withLedgerCreators } from './lib/documentCreators';
import { verifyArchiveIdentity } from './lib/finance-report-archive-validation';
import { roundDh as coreRoundDh, initWorkerFinanceWasm, verifyWorkerFinanceEngine } from './lib/financeCore';
import { registerMobilePreferencesRoutes } from './routes/mobilePreferences';
import { migrateProductImagePage, normalizeProductImageReference, isNormalizedProductUrl, ProductImageError } from './lib/product-images';
import { registerSnakeScoreRoutes } from './routes/snakeScore';
import { registerWorkStatusRoute } from './routes/workStatus';
import { Hono } from 'hono';
import { schemaOnce, registerDbRoot, resolveRootDb } from './lib/schema';
import { ensureAutoSqlMigrations, requiresAutoSqlMigrations } from './lib/autoMigrations';
import { sha256Hex, ensurePaymentHistoryTable, ensureReceiptsTable, expensesLinkedToReceipt, getInvoiceLinks, cascadeDeleteInvoice, publicRateLimit, ensureReceiptSituationColumn, ensureQrPrivacySettings, ensureInvoicePublicToken, makePublicToken, ensureHmacKeyColumns, publicTokenSecretsAsync, hmacSha256Hex, makeSecureQrPayload, parseSecureQrPayload, documentIntegrityHash, createAtlasTimestampToken, verifyAtlasTimestampToken, invoiceDocHashPayload, digestSignatureImage, validateStoredSignature, ensureInvoiceItemPromoColumns, ensureInvoiceTaxExempt, ensureInvoiceRefundColumns, validateRefundReason, validateCreditPrefix, ensureProductBulkDiscounts, tableColumns, hasColumn, applyBulkDiscount, ensureStockMovementsTable, ensureValuationTables, getValuationMethod, runAutoTransfers, applyMovingAverageCost, applyStockDelta, purgeEphemeralSecurityData, ensureIdempotencyTable, extractIdempotencyKey, idempotencyGet, idempotencyPut, ensurePeriodLockColumn, assertPeriodOpen, ensureVoidColumns, archiveInvoiceSnapshot, ensureDocumentActors } from './lib/ledgerHelpers';
import {
  cfGeo,
  touchTrustedDevice,
  getPassword,
  normalizePassword,
  generateOTP,
  passwordsMatch,
  randomChallenge,
  getOwnerUsername,
  derivePbkdf2Bits,
  hashUserPassword,
  isModernPasswordHash,
  verifyUserPassword,
  upgradeUserPasswordHash,
  writeAudit,
  makeSessionProof,
  getConfig,
  setConfig,
  clientIp,
  makeTokenV2,
  parseToken,
  ensureSecurityTables,
  trustDevice,
  checkConfirmPassword,
  getReputation,
  credentialAttemptGate,
  isRateLimited,
  recordLogin,
  authFailReason,
  requireOwnerOrAdmin,
  sessionUserFromHeader,
  secretMaterialForUsername,
  nativeCurrentIdentity,
  runWithRequestAuthContext,
  parseAuthorizationHeader,
  isNativeV3AuthHeader,
  isAnyNativeV3TokenHeader,
} from './lib/authHelpers';
import { registerAuthRoutes } from './routes/authRoutes';
import { registerUsersAdminRoutes, registerSettingsRoutes } from './routes/usersAdmin';
import { registerCanaryHealthRoutes, registerLedgerMiscRoutes, registerProductRequestRoutes } from './routes/ledgerMisc';
import { addColumnIfMissing } from './lib/schema';
import { generateReceiptHTML, generateEmployeeFormHTML, generateInvoiceHTML, registerEmployeeFormPrintRoutes } from './lib/printTemplates';
import { hasCredentialAttemptBudget } from './lib/credential-attempt-limits';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { doCacheGet, doCachePut, hasLiveCache, checkRefreshLimit, invalidateDashboardCache } from './lib/cache';
import { keyFromCdnUrl, deleteR2Object } from './lib/r2';
import { rateLimit, isAllowedImageUrl, clientIpFromRequest } from './lib/security';
import { shouldLogApiCall, geoFromCf, isIdleQrPoll } from './lib/apiLog';
import { recordApiJournal } from './lib/journalSink';
import { canMutateBusiness, normalizeRole } from './lib/rbac';
import { apiFail, apiOk } from './lib/api-response';
import { toClientError } from './lib/errors';
import { SchemaBusyError } from './lib/schema';
import { repairProductSearchIndex } from './lib/reliability';
import { androidReleaseRouter, serveAppUpdatesAsset } from './routes/androidRelease';
import { desktopReleaseRouter } from './routes/desktopRelease';
import { registerDeviceTokenRoutes } from './routes/deviceToken';
import { isDesktopAuthPath, isPublicDesktopAuthPath, DESKTOP_AUTH } from './routes/desktopAuth';
import { DESKTOP_NATIVE_V2_CAPABILITIES, DESKTOP_NATIVE_V3_CAPABILITIES } from './routes/desktopNativeDiscovery';
import { EMBEDDED_CHALLENGE_PATH, EMBEDDED_CHALLENGE_CSP } from './lib/desktop-pilot-webview';
import { isNativeV2Operation, NATIVE_V2 } from './routes/desktopNativeV2';
import { isNativeV3PublicPost, NATIVE_V3 } from './routes/desktopNativeV3';
import { V3_WEBVIEW_CHALLENGE_PATH, V3_BROWSER_CHALLENGE_PATH, V3_CHALLENGE_CSP } from './lib/desktop-v3-webview';
import { androidMinVersionGuard, readMinVersionPolicy } from './lib/app-update-policy';
import { reliabilityStatus } from './lib/reliability';
import { detectBffSurface } from './lib/bff';
import { afterBusinessMutation } from './lib/delete-coord';
import { notifyAssistApproval as fcmNotifyAssistApproval } from './lib/fcm';
import { MobileHub } from './durable/MobileHub';
import { AgentQuotaHub } from './durable/AgentQuotaHub';
export { AgentQuotaHub };
import { DemoHub } from './durable/DemoHub';
export { DemoHub };
import { handleDemoRequest } from './lib/demo/gateway';
import { RestoreHub } from './durable/RestoreHub';
import { NumberHub } from './durable/NumberHub';
import { registerAdminReadRoutes, registerInvoiceReadRoutes, registerStockReadRoutes, registerWholesaleRoutes, registerEmployeeRoutes, registerPublicRoutes, registerClientRoutes, registerMailboxRoutes, registerPartnerV1Routes, registerAtlasV209Routes, dispatchWebhook, registerFinanceRoutes, registerExpenseWriteRoutes, registerVendorRoutes, registerExportRoutes, registerMobileActionsRoutes, registerAttendanceRoutes, registerCatalogRoutes, registerCategoriesUnitsRoutes, registerDataImportRoutes, registerBackupRoutes, makeVerifyBackupAccess, registerReportRoutes, reportShell, registerInventoryOpsRoutes, ensureStockLocations, getDefaultLocationId, adjustLocationStock, registerAssistRoutes, purgeAgentConversationsOlderThan, readAppUpdateState, registerPublicSignedRoutes, registerProductsScanRoutes, registerDashboardIntegrityRoutes, registerMetricsRoutes, registerInvoicesWriteRoutes, registerBillsReceiptsRoutes, registerCashShiftRoutes, registerPayrollRoutes, registerFecRoutes, registerDunningRoutes, runDailyDunning, registerDgiRoutes, ensureBillPaymentsTable } from './routes';
import { registerStockAdjustmentRoutes } from './routes/stockAdjustments';
import { registerDeviceRoutes } from './routes/devices';
import { registerDocPreviewRoutes } from './routes/docPreviews';
import { DEFAULT_CATEGORIES, DEFAULT_UNITS } from './lib/product-defaults';
import { normalizeInventoryRole, roleCanSeeFinancial, deviceLabelFromUA } from './lib/inventory-policy';
import { runFinanceReminders } from './lib/finance';
import { buildReportLinkQuery } from './lib/report-period';
import { retryPendingReports } from './lib/reports';
import { qrToSvg } from './qrSvg';







/**
 * Native Android app (Gradle + OkHttp/Retrofit) calls the Worker API directly.
 * Mobile browsers (Chrome/Safari) are NOT native — they still use Turnstile.
 * Only skip Turnstile for real native HTTP clients / explicit app hints.
 */
function isNativeAuthRequest(c: any, body?: Record<string, unknown>): boolean {
  const ua = String(c.req.header('User-Agent') || '').toLowerCase();
  const clientHint = String(
    (body && (body.client || body.platform || body.source)) ||
      c.req.header('X-Atlas-Client') ||
      c.req.header('X-Client') ||
      c.req.query('client') ||
      '',
  ).toLowerCase();
  const xrw = String(c.req.header('X-Requested-With') || '').toLowerCase();

  // Explicit app markers (Android should send these)
  if (
    clientHint === 'native' ||
    clientHint === 'android' ||
    clientHint === 'ios' ||
    clientHint === 'apk' ||
    clientHint === 'okhttp' ||
    clientHint === 'app' ||
    clientHint === 'capacitor'
  ) {
    return true;
  }

  // OkHttp / Retrofit / Volley / Dalvik — native stack, not Chrome Mobile
  if (
    ua.includes('okhttp') ||
    ua.includes('retrofit') ||
    ua.includes('dalvik') ||
    ua.includes('atlas-android') ||
    ua.includes('atlas-ios')
  ) {
    return true;
  }

  // ApplicationId in X-Requested-With (browsers use XMLHttpRequest or omit)
  if (
    xrw &&
    xrw !== 'xmlhttprequest' &&
    !xrw.includes('com.google.android') &&
    (xrw.includes('.') || xrw.includes('atlas'))
  ) {
    return true;
  }

  // Non-browser UA with no Mozilla token (OkHttp often has neither Mozilla nor Chrome)
  const looksLikeBrowser =
    ua.includes('mozilla') ||
    ua.includes('chrome/') ||
    ua.includes('safari/') ||
    ua.includes('firefox/') ||
    ua.includes('edg/');
  if (ua && !looksLikeBrowser && (ua.includes('http') || ua.includes('okhttp') || ua.length < 40)) {
    // short non-browser UA typical of API clients
    if (!ua.includes('mozilla')) return true;
  }

  return false;
}

async function verifyTurnstile(
  env: Env,
  token: string | undefined,
  ip: string,
  opts?: { native?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  if (opts?.native) return { ok: true };
  const secret = (env.TURNSTILE_SECRET_KEY || '').trim();
  const siteKey = (env.TURNSTILE_SITE_KEY || '').trim();
  // Only enforce when BOTH keys are set. Secret alone (no widget) must not block login.
  if (!secret || !siteKey) return { ok: true };
  const t = String(token || '').trim();
  if (!t) {
    return {
      ok: false,
      error: 'Vérification anti-bot requise. Attendez le captcha ou rechargez la page.',
    };
  }
  try {
    const body = new URLSearchParams();
    body.set('secret', secret);
    body.set('response', t);
    if (ip) body.set('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
    if (data?.success) return { ok: true };
    console.error('turnstile_verify_failed');
    return { ok: false, error: 'Vérification anti-bot échouée. Rechargez la page.' };
  } catch {
    // Network failure: fail open so login is not bricked
    return { ok: true };
  }
}

/** Sync live counters into free-tier Durable Object (phone + PC). Best-effort only. */
async function syncMobileHub(env: Env, extra?: {
  lastBarcode?: string | null;
  lastProductId?: number | null;
}) {
  try {
    if (!env.MOBILE_HUB) return;
    const [pending, products] = await Promise.all([
      env.DB.prepare(`SELECT COUNT(*) as n FROM mobile_actions WHERE status = 'pending'`).first() as Promise<any>,
      env.DB.prepare(
        `SELECT COUNT(*) as count,
                COALESCE(SUM(CASE WHEN is_active = 1 AND track_inventory = 1 AND stock_quantity <= low_stock_threshold THEN 1 ELSE 0 END), 0) as low,
                COALESCE(SUM(CASE WHEN is_active = 1 THEN stock_quantity * cost ELSE 0 END), 0) as stock_value
         FROM products`
      ).first() as Promise<any>,
    ]);
    const id = env.MOBILE_HUB.idFromName('atlas-main');
    const stub = env.MOBILE_HUB.get(id);
    const body: Record<string, unknown> = {
      pending: Number(pending?.n || 0),
      productCount: Number(products?.count || 0),
      lowStock: Number(products?.low || 0),
      stockValue: Number(products?.stock_value || 0),
    };
    if (extra && 'lastBarcode' in extra) body.lastBarcode = extra.lastBarcode;
    if (extra && 'lastProductId' in extra) body.lastProductId = extra.lastProductId;
    await stub.fetch('https://do/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    /* never block */
  }
}

/** @deprecated alias */
async function syncMobileHubPending(env: Env) {
  return syncMobileHub(env);
}

/** Per-user profile in free-tier DO (idFromName('profile:' + username)). Best-effort. */
async function readProfileFromDo(
  env: Env,
  username: string
): Promise<{
  display_name: string;
  email: string;
  phone: string;
  avatar_url: string;
  notes: string;
} | null> {
  try {
    if (!env.MOBILE_HUB || !username) return null;
    const id = env.MOBILE_HUB.idFromName('profile:' + username);
    const stub = env.MOBILE_HUB.get(id);
    const res = await stub.fetch('https://do/profile', { method: 'GET' });
    if (!res.ok) return null;
    const j = (await res.json().catch(() => null)) as any;
    const d = j?.data;
    if (!d) return null;
    return {
      display_name: String(d.display_name || ''),
      email: String(d.email || ''),
      phone: String(d.phone || ''),
      avatar_url: String(d.avatar_url || ''),
      notes: String(d.notes || ''),
    };
  } catch {
    return null;
  }
}

async function writeProfileToDo(
  env: Env,
  username: string,
  profile: {
    display_name?: string;
    email?: string;
    phone?: string;
    avatar_url?: string;
    notes?: string;
  }
): Promise<{
  display_name: string;
  email: string;
  phone: string;
  avatar_url: string;
  notes: string;
} | null> {
  try {
    if (!env.MOBILE_HUB || !username) return null;
    const id = env.MOBILE_HUB.idFromName('profile:' + username);
    const stub = env.MOBILE_HUB.get(id);
    const res = await stub.fetch('https://do/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    });
    if (!res.ok) return null;
    const j = (await res.json().catch(() => null)) as any;
    const d = j?.data;
    if (!d) return null;
    return {
      display_name: String(d.display_name || ''),
      email: String(d.email || ''),
      phone: String(d.phone || ''),
      avatar_url: String(d.avatar_url || ''),
      notes: String(d.notes || ''),
    };
  } catch {
    return null;
  }
}



function roundDh(n: number | null | undefined): number {
  return coreRoundDh(n);
}

const app = new Hono<{
  Bindings: Env;
  Variables: {
    bffSurface?: string;
    requestId?: string;
    role?: string;
    user?: { username?: string; role?: string };
  };
}>();

// Initialize compiled Rust/WASM finance core once per Worker isolate if bundled.
initWorkerFinanceWasm();

/* ── Journal des appels API (all /api/* calls, failures included; 30 days) ──
 * Registered first so it also sees requests rejected by later middleware
 * (401, 403, 413, 426, 503…). The INSERT runs in waitUntil after the
 * response, so it never adds latency. */
app.use('/api/*', async (c, next) => {
  const started = Date.now();
  let status = 500;
  try {
    await next();
    status = c.res?.status || 200;
  } finally {
    try {
      const path = new URL(c.req.url).pathname;
      const auth = c.req.header('Authorization');
      const db = (c.env as any)?.DB as D1Database | undefined;
      let ctx: { waitUntil(p: Promise<unknown>): void } | undefined;
      try { ctx = c.executionCtx; } catch { ctx = undefined; }
      if (db && ctx && shouldLogApiCall(path, auth)) {
        const who = sessionUserFromHeader(auth);
        const row = {
          method: c.req.method.toUpperCase(),
          path,
          status,
          ms: Date.now() - started,
          username: who.username || null,
          role: who.role || null,
          ip: clientIpFromRequest(c),
          ua: c.req.header('User-Agent') || null,
          request_id: String(c.get('requestId') || '') || null,
          surface: String(c.get('bffSurface') || '') || null,
          device_context: parseJournalDeviceContext(c.req.header('X-Atlas-Journal-Context')),
          ...geoFromCf((c.req.raw as any).cf),
        };
        const response = c.res;
        const journalWrite = (async () => {
          await recordApiJournal(c.env, db, row, await isIdleQrPoll(row.method, path, status, response));
        })();
        if (c.env.JOURNAL_ARCHIVE_MODE === 'buffered' || c.env.JOURNAL_ARCHIVE_MODE === 'supabase') {
          // Wait for durable acceptance rather than returning a response while
          // the first enqueue still exists only in request-owned waitUntil.
          try { await journalWrite; } catch { console.error('journal_buffer_enqueue_failed'); }
        } else ctx.waitUntil(journalWrite);
      }
    } catch { /* journaling never breaks a request */ }
  }
});

app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (path !== '/api/health' && path !== '/api/canary') {
    const check = verifyWorkerFinanceEngine(c.env);
    if (!check.ok) {
      return c.json(
        {
          success: false,
          code: 'FINANCE_ENGINE_UNAVAILABLE',
          error: check.error,
          finance_core: {
            contract_version: check.stats.contractVersion,
            engine: check.stats.engine,
            status: check.stats.status,
            abi_version: check.stats.abiVersion,
            wasm_bundled: check.stats.wasmBundled,
            exports_verified: check.stats.requiredExportsVerified,
          },
        },
        503,
      );
    }
  }
  return next();
});

app.use('/api/mobile/preferences', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('CDN-Cache-Control', 'no-store');
});

app.use('/api/mobile/snake-score', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('CDN-Cache-Control', 'no-store');
});

/* ── v0.7 — minimum supported Android version (owner/admin-controlled) ──
 * Outdated Android API clients get 426 APP_UPDATE_REQUIRED; web clients,
 * health and the update-check/download routes are never blocked. Registered
 * first so an outdated client sees the update prompt, not an auth error. */
app.use(
  '/api/*',
  androidMinVersionGuard({
    readPolicy: (db) => readMinVersionPolicy(db),
    readManifest: async (env) => (await readAppUpdateState(env)).manifest,
  }),
);

/** Reject oversized request bodies early (DoS / memory pressure). */
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MiB default
/** APK uploads stream straight to R2 — exempt from the 2 MiB API body cap. */
const APP_UPDATE_MAX_APK_BYTES = 200 * 1024 * 1024;
const PRODUCT_IMAGE_JSON_LIMIT = 6 * 1024 * 1024;
function isProductImageWrite(path: string, method: string): boolean {
  return ((method === 'POST' || method === 'PUT') && /^\/api\/catalog\/products\/[^/]+\/images(?:\/[^/]+)?$/.test(path)) ||
    (method === 'POST' && ['/api/products', '/api/mobile-actions', '/api/stock/product-requests'].includes(path)) ||
    (method === 'PUT' && /^\/api\/products\/[^/]+$/.test(path));
}
app.use('/api/*', async (c, next) => {
  const cl = c.req.header('content-length');
  if (cl) {
    const n = Number(cl);
      const path = new URL(c.req.url).pathname;
      const limit = path === '/api/admin/app-update/apk'
        ? APP_UPDATE_MAX_APK_BYTES
        : isProductImageWrite(path, c.req.method.toUpperCase()) ? PRODUCT_IMAGE_JSON_LIMIT : MAX_BODY_BYTES;
    if (n > limit) {
      return c.json({
        success: false,
        error: `Corps de requête trop volumineux (max ${Math.floor(limit / (1024 * 1024))} Mo).`,
        code: 'PAYLOAD_TOO_LARGE',
      }, 413);
    }
  }
  return next();
});

app.use('*', cors({
  origin: (origin) => {
    const allowed = new Set([
      'https://stock.afmarbre.com',
      'https://localhost',
      'http://localhost:5173',
      'http://localhost:8080',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:8080',
    ]);
    if (!origin) return 'https://stock.afmarbre.com';
    try {
      const host = new URL(origin).hostname.toLowerCase();
      if (allowed.has(origin)) return origin;
      if (host === 'stock.afmarbre.com' || host.endsWith('.afmarbre.com')) return origin;
      if (host === 'localhost' || host === '127.0.0.1') return origin;
    } catch { /* */ }
    return 'https://stock.afmarbre.com';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Accept-Language', 'Authorization', 'DPoP', 'X-Api-Key', 'Idempotency-Key', 'X-Device-Fingerprint', 'X-Atlas-Journal-Context', 'X-Atlas-Client', 'X-Admin-Backup-Token', 'X-Backup-Signature', 'X-Backup-Timestamp'],
  maxAge: 86400,
}));

/* ── D1 Sessions API (global read replication) — fully automatic ──────────
 * Every request swaps c.env.DB for a D1 Session before ANY middleware/route
 * touches the database, so reads can be served by the nearest read replica
 * with sequential consistency once replication is enabled in the D1 settings
 * (and cost nothing when it isn't: sessions then behave like the binding).
 * Read-your-writes survives across requests via a short-lived bookmark
 * cookie; brand-new sessions start on the primary so they never read stale.
 * Degrades silently to the plain binding when withSession() is unavailable
 * (e.g. local wrangler dev). */
const D1_BM_COOKIE = '__atlas_d1_bm';
function readD1Bookmark(c: any): string | null {
  try {
    const raw = String(c.req.header('Cookie') || '');
    for (const part of raw.split(';')) {
      const i = part.indexOf('=');
      if (i < 0) continue;
      if (part.slice(0, i).trim() === D1_BM_COOKIE) return decodeURIComponent(part.slice(i + 1).trim()) || null;
    }
  } catch { /* */ }
  return null;
}
function readD1BookmarkFromReq(c: any): string | null {
  const headerBm = c.req.header('x-d1-bookmark') || c.req.header('X-D1-Bookmark');
  if (headerBm) {
    const s = String(headerBm).trim();
    if (s && s.length <= 512 && /^[a-zA-Z0-9_.-]+$/.test(s)) return s;
  }
  return readD1Bookmark(c);
}

function isCriticalSecurityPath(path: string, method: string): boolean {
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') return true;
  if (path.startsWith('/api/auth/')) return true;
  if (path.startsWith('/api/admin/')) return true;
  if (path.startsWith('/api/assist/approve')) return true;
  if (path.startsWith('/api/stock-adjustment-requests')) return true;
  if (path.startsWith('/api/mobile-actions')) return true;
  if (path === '/api/mobile/work-status') return true;
  return false;
}

app.use('*', async (c, next) => {
  const rawDb: any = (c.env as any).DB;
  let session: any = null;
  if (rawDb && typeof rawDb.withSession === 'function') {
    const path = new URL(c.req.url).pathname;
    const method = c.req.method.toUpperCase();
    const bm = readD1BookmarkFromReq(c);

    const authHeader = c.req.header('Authorization');
    const isNativeAuth =
      path.startsWith(`${NATIVE_V2}/`) ||
      path.startsWith(`${NATIVE_V3}/`) ||
      !!authHeader?.startsWith('Bearer np1.') ||
      isAnyNativeV3TokenHeader(authHeader);
    try {
      if (path.startsWith('/api/reports/') || isNativeAuth || path === '/api/auth/logout' || path === '/api/auth/role-refresh' || path === '/api/mobile/work-status' || path === '/api/mobile/snake-score' || path === '/api/mobile/preferences' || path === '/api/reports' || path === '/api/admin/product-images/normalize') {
        session = rawDb.withSession('first-primary');
      } else if (path === '/api/health') {
        // Health check: can use unconstrained replica or available session
        session = rawDb.withSession();
      } else if (isCriticalSecurityPath(path, method) || (Boolean(authHeader) && !bm)) {
        // Security-sensitive reads, business mutations, and bookmarkless authenticated reads:
        // first-primary or trustworthy bookmark so revocation checks never hit a stale replica.
        session = bm ? rawDb.withSession(bm) : rawDb.withSession('first-primary');
      } else {
        // Replica-eligible reads: use bookmark if available, else standard session
        session = bm ? rawDb.withSession(bm) : rawDb.withSession();
      }
    } catch {
      // Native v2/v3 and session revocation paths must never silently fall back to an unconstrained D1 replica.
      if (isNativeAuth || path === '/api/auth/logout') {
        return c.json({ success: false, code: 'UNAVAILABLE', error: 'Connexion indisponible.' }, 503);
      }
      try {
        session = rawDb.withSession('first-primary');
      } catch {
        session = null;
      }
    }

    if (session) {
      registerDbRoot(session, rawDb);
      (c.env as any).DB = session;
    }
  }

  await next();

  if (session && typeof session.getBookmark === 'function') {
    try {
      const nb = session.getBookmark();
      if (nb) {
        c.res.headers.set('x-d1-bookmark', nb);
        c.res.headers.append(
          'Set-Cookie',
          `${D1_BM_COOKIE}=${encodeURIComponent(nb)}; Path=/; Max-Age=600; SameSite=Lax; Secure`,
        );
      }
    } catch { /* */ }
  }

  // Safe diagnostics: served_by_region and served_by_primary (without leaking user data or full bookmarks)
  try {
    const meta: any = (c.res as any)?._meta || (session as any)?._meta;
    if (meta?.served_by_region) {
      c.res.headers.set('x-d1-region', String(meta.served_by_region));
    }
    if (typeof meta?.served_by_primary === 'boolean') {
      c.res.headers.set('x-d1-primary', meta.served_by_primary ? '1' : '0');
    }
  } catch { /* */ }
});

/* ── v232 — in-worker WAF (free): blocks classic attack signatures before any route runs ── */
const WAF_STATS = { blocked: 0, lastAt: null as string | null, lastSig: '' };
const WAF_SIGS: RegExp[] = [
  /(union[\s+]+select|select[\s+]+[^()]{0,40}[\s+]+from[\s+]*(information_schema|pg_catalog|sqlite_master))/i,
  /(sleep\(\d|benchmark\(|waitfor[\s+]+delay|xp_cmdshell|pg_sleep\()/i,
  /(\.\.[/\\](etc|proc|windows)|[/\\]etc[/\\]passwd|proc[/\\]self[/\\]environ)/i,
  /(<script|%3cscript|javascript:|onerror\s*=|onload\s*=)/i,
  /(\$\{jndi:|log4j)/i,
];
app.use('*', async (c, next) => {
  const u = new URL(c.req.url);
  if (u.pathname.startsWith('/api')) {
    const probe = `${u.pathname}?${u.search}`.slice(0, 4000);
    let decoded = probe;
    try { decoded = decodeURIComponent(probe); } catch { /* keep raw */ }
    for (const sig of WAF_SIGS) {
      if (sig.test(decoded)) {
        WAF_STATS.blocked += 1;
        WAF_STATS.lastAt = new Date().toISOString();
        WAF_STATS.lastSig = sig.source.slice(0, 60);
        return c.json({ success: false, error: 'Requête bloquée par le pare-feu applicatif (WAF).', code: 'WAF_BLOCKED' }, 403);
      }
    }
  }
  await next();
});

/* ── v232 — optional D1 cutover: when app_config db_primary='target' and DB_TARGET is bound, serve from it ── */
let dbPrimaryCache: { value: string; at: number } | null = null;
async function dbPrimaryFlag(env: Env): Promise<string> {
  const now = Date.now();
  if (dbPrimaryCache && now - dbPrimaryCache.at < 60000) return dbPrimaryCache.value;
  let value = 'source';
  try {
    const row = (await env.DB.prepare(`SELECT value FROM app_config WHERE key = 'db_primary'`).first()) as any;
    if (row && String(row.value) === 'target') value = 'target';
  } catch { /* no app_config yet → stay on source */ }
  dbPrimaryCache = { value, at: now };
  return value;
}
/**
 * Strict variant for private resources (native auth, reports, preferences):
 * only a SUCCESSFUL read is memoised, for 15 s per source binding, and any
 * read error still propagates (fail closed → 503). Saves one D1 read on every
 * private request without ever guessing the cutover state.
 */
const PRIVATE_DB_PRIMARY_TTL_MS = 15_000;
let privateDbPrimaryCache = new WeakMap<object, { value: string | undefined; at: number }>();
async function strictDbPrimaryFlag(db: D1Database): Promise<string | undefined> {
  const now = Date.now();
  const hit = privateDbPrimaryCache.get(db as object);
  if (hit && now - hit.at < PRIVATE_DB_PRIMARY_TTL_MS) return hit.value;
  const value = (await db.prepare(`SELECT value FROM app_config WHERE key = 'db_primary'`).first() as any)?.value as string | undefined;
  privateDbPrimaryCache.set(db as object, { value, at: now });
  return value;
}
app.use('*', async (c, next) => {
  if (c.env.DB_TARGET) {
    (c.env as any).DB_SOURCE = c.env.DB; // remember the physical source before any swap
    try {
      const reqPath = new URL(c.req.url).pathname;
      const authHeader = c.req.header('Authorization');
      const isNativeReq =
        reqPath.startsWith(`${NATIVE_V2}/`) ||
        reqPath.startsWith(`${NATIVE_V3}/`) ||
        !!authHeader?.startsWith('Bearer np1.') ||
        isAnyNativeV3TokenHeader(authHeader);
      const privateResource = reqPath === '/api/mobile/preferences' || reqPath.startsWith('/api/reports/') || reqPath === '/api/auth/logout' || reqPath === '/api/auth/role-refresh' || isNativeReq;
      // These resources must not fall back to the wrong database if
      // cutover state cannot be read; do not use the cached, fail-open flag.
      const flag = privateResource
        ? await strictDbPrimaryFlag(c.env.DB)
        : await dbPrimaryFlag(c.env);
      if (flag === 'target') {
        const target = c.env.DB_TARGET as any;
        if (isNativeReq && typeof target.withSession !== 'function') throw new Error('Native auth requires a primary D1 session');
        const targetDb = privateResource && typeof target.withSession === 'function'
          ? target.withSession('first-primary') : target;
        registerDbRoot(targetDb, target);
        (c.env as any).DB = targetDb;
      }
    } catch {
      // Never silently switch this private resource back to the source database
      // if the configured target's primary session cannot be established.
      const reqPath = new URL(c.req.url).pathname;
      const authHeader = c.req.header('Authorization');
      if (reqPath === '/api/mobile/preferences' || reqPath.startsWith('/api/reports/') || reqPath === '/api/auth/logout' || reqPath === '/api/auth/role-refresh' || reqPath.startsWith(`${NATIVE_V2}/`) || reqPath.startsWith(`${NATIVE_V3}/`) || authHeader?.startsWith('Bearer np1.') || isAnyNativeV3TokenHeader(authHeader)) {
        return c.json({ success: false, code: 'SERVICE_UNAVAILABLE', error: 'Service indisponible' }, 503);
      }
    }
  }
  if ((c.env.JOURNAL_ARCHIVE_MODE === 'buffered' || c.env.JOURNAL_ARCHIVE_MODE === 'supabase') && c.env.ATLAS_DEMO !== '1') {
    await withBufferedJournal(c.env, () => next());
  } else if (c.env.JOURNAL_AUDIT_SHADOW === '1' && c.env.ATLAS_DEMO !== '1') {
    // Some test/embedded callers have no ExecutionContext. Do not break the
    // request when shadow scheduling is unavailable; emit a fixed diagnostic.
    let executionCtx: { waitUntil(promise: Promise<unknown>): void } | undefined;
    try { executionCtx = c.executionCtx; } catch { console.error('audit_shadow_context_unavailable'); }
    if (executionCtx) await withAuditShadow(c.env, executionCtx, () => next());
    else await next();
  } else {
    await next();
  }
});

app.use('/api/*', async (c, next) => {
  // Widget configuration only reads environment keys. Database migrations can
  // fail or be slow even though the public configuration itself is available.
  // Login and all database-backed endpoints retain their normal checks.
  if (c.req.method === 'GET' && new URL(c.req.url).pathname === '/api/auth/turnstile-config') return next();
  const path = new URL(c.req.url).pathname;
  if (requiresAutoSqlMigrations(c.req.method, path)) {
    const migrationDb = (resolveRootDb((c.env as any).DB) || (c.env as any).DB) as D1Database | undefined;
    await ensureAutoSqlMigrations(migrationDb);
  }
  await next();
});

/* ─────────────────────────────────────────────────────────────────────────
 * /api/* AUTH GATE — MUST STAY REGISTERED FIRST (before every app.get/post/…).
 * Hono applies app.use() only to routes registered AFTER it. Until
 * 2026-10-22 this middleware sat ~4,500 lines down, so the 58 routes above
 * (admin/users, admin/config, admin/audit, admin/db-migrate, r2/images,
 * auth/me, settings/2fa…) never saw it and were gated only by requireOwner()
 * — which trusted the old sessionUserFromHeader() fallback that made EVERY
 * anonymous caller an owner. The security patrol caught it live
 * (GET /api/admin/r2/images → 200 + real data, no credentials).
 * Add routes anywhere you like — but NEVER move this block below them.
 * ───────────────────────────────────────────────────────────────────────── */
// Apply even when the normal auth gate returns early (401/403).
app.use('/api/print/link-ticket', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('CDN-Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
});
function extractQueryToken(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl);
    let t = u.searchParams.get('token');
    if (!t) {
      const m = rawUrl.match(/[?&]token=([^&]+)/);
      if (m) t = m[1];
    }
    if (!t) return null;
    t = t.replace(/ /g, '+');
    try { t = decodeURIComponent(t); } catch { /* already decoded */ }
    t = t.replace(/ /g, '+');
    if (t.includes('-') || t.includes('_')) {
      t = t.replace(/-/g, '+').replace(/_/g, '/');
    }
    return t || null;
  } catch {
    return null;
  }
}

app.use('/api/reports/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('CDN-Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'SAMEORIGIN');
  c.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'self'");
});
app.use(`${DESKTOP_AUTH}/*`, async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('CDN-Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
});

app.use(`${NATIVE_V2}/*`, async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('CDN-Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
});

app.use(`${NATIVE_V3}/*`, async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('CDN-Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
});

app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  // A staging/v3 native session must not be used to bootstrap a legacy web/QR
  // session or to activate fingerprint-based trust. Native refresh/logout use
  // their own proof-bearing POST bodies instead of Authorization.
  const parsedAuth = parseAuthorizationHeader(c.req.header('Authorization'));
  const authTok = parsedAuth?.token || '';
  const nativeHeader = parsedAuth?.scheme === 'Bearer' && authTok.startsWith('np1.');
  const nv3Header = isNativeV3AuthHeader(c.req.header('Authorization'));
  const nv3MisusedBearer = parsedAuth?.scheme === 'Bearer' && authTok.startsWith('nv3.');
  if (nv3MisusedBearer) return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Non autorisé' }, 401);
  if (nativeHeader && path.startsWith('/api/auth/') && path !== '/api/auth/me') return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Non autorisé' }, 401);
  if (nv3Header && path.startsWith('/api/auth/') && path !== '/api/auth/me' && !path.startsWith(`${NATIVE_V3}/`)) return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Non autorisé' }, 401);
  const queryTok = c.req.query('token') || '';
  if (queryTok.startsWith('np1.') || queryTok.startsWith('nv3.')) return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Non autorisé' }, 401);
  if (
    path.startsWith('/api/public/') ||
    path.startsWith('/api/cron/') ||
    path === '/api/media/proxy' ||
    // Public health/canary probes — the Android server picker pings
    // /api/health BEFORE login, and /api/canary is a deploy-smoke endpoint
    // designed to expose no secrets (subsystem ok flags + WAF counters).
    path === '/api/health' ||
    path === '/api/canary' ||
    // Read-only APK & Desktop update manifest checks — called before login
    // (mandatory-update flow). Expose only public CDN info.
    path === '/api/app/android-update' ||
    path === '/api/app/desktop-update' ||
    // CI release ingestion — Bearer release token, no session/CSRF.
    path === '/api/admin/android-release' ||
    path === '/api/admin/desktop-release' ||
    // QR login bridge: the PC creates/polls its session ANONYMOUSLY (the
    // phone side authenticates with its Bearer + the one-time QR token).
    path.startsWith('/api/auth/qr/') ||
    // Exact public desktop endpoints verify PKCE + state + creation IP/FP themselves.
    // prepare/authorize stay behind this normal web session gate.
    isPublicDesktopAuthPath(path) ||
    // Exact v2/v3 operations enforce their own PKCE/DPoP or authenticated-phone checks and D1 budgets.
    ((path === DESKTOP_NATIVE_V2_CAPABILITIES || path === DESKTOP_NATIVE_V3_CAPABILITIES) && c.req.method === 'GET') ||
    (isNativeV2Operation(path) && c.req.method === 'POST') ||
    (isNativeV3PublicPost(path) && c.req.method === 'POST') ||
    path === '/api/auth/login' ||
    path === '/api/auth/verify-otp' ||
    path === '/api/auth/verify-link' ||
    path === '/api/auth/login-biometric' ||
    path === '/api/auth/webauthn/login/options' ||
    path === '/api/auth/webauthn/login/verify' ||
    path === '/api/auth/webauthn/status' ||
    path === '/.well-known/assetlinks.json' ||
    path === '/.well-known/apple-app-site-association' ||
    // v260 — crash intake is public by design (fire-and-forget from global
    // error handlers, incl. logged-out sessions); rate-limited + sanitized.
    path === '/api/crash-reports' ||
    path === '/api/auth/device-status' ||
    path === '/api/auth/turnstile-config'
  ) {
    return next();
  }
  if (c.req.header('Authorization')?.slice(7).startsWith('np1.') && new URL(c.req.url).origin !== c.env.DESKTOP_NATIVE_V2_PILOT_ORIGIN) return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Non autorisé' }, 401);

  function reportDeniedHtml(title: string, message: string, reason?: string): Response {
    const detail = reason ? `<p style="color:#666;font-size:13px">Code : <code>${reason}</code></p>` : '';
    return c.html(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${title}</title></head>
<body style="font-family:system-ui,sans-serif;padding:40px;max-width:520px;margin:auto;color:#111;line-height:1.5">
  <h1 style="font-size:1.35rem;margin:0 0 12px">${title}</h1>
  <p>${message}</p>
  ${detail}
  <p style="margin-top:20px">Reconnectez-vous dans <strong>Atlas Commerce</strong>, puis rouvrez le rapport depuis le bouton dans l’application (ne partagez pas le lien).</p>
  <p><a href="/login" style="color:#0f1b2d">Ouvrir la page de connexion</a></p>
</body></html>`, 401);
  }

  // Allow print/PDF/thermal/reports with token via query param OR Authorization header
  // (relax IP/fingerprint — same session as when the user opened the document)
  const isReport = path.startsWith('/api/reports/');
  const isPrintLike =
    path.match(/^\/api\/invoices\/\d+\/print$/) ||
    path.match(/^\/api\/invoices\/\d+\/pdf$/) ||
    path.match(/^\/api\/invoices\/\d+\/ubl$/) ||
    path.match(/^\/api\/invoices\/\d+\/ubl\.xml$/) ||
    path.match(/^\/api\/bills\/\d+\/print$/) ||
    path.match(/^\/api\/delivery-notes\/\d+\/print$/) ||
    path.match(/^\/api\/bills\/\d+\/pdf$/) ||
    path.match(/^\/api\/receipts\/\d+\/print$/) ||
    path.match(/^\/api\/receipts\/\d+\/pdf$/) ||
    path.match(/^\/api\/print\/thermal\/\d+$/) ||
    path.match(/^\/api\/cash-shifts\/\d+\/(x-report|z-report)$/) ||
    path.match(/^\/api\/payroll\/runs\/\d+\/lines\/\d+\/bulletin$/) ||
    path.match(/^\/api\/payroll\/runs\/\d+\/declaration$/) ||
    path === '/api/accounting/fec/export' ||
    path.match(/^\/api\/invoices\/\d+\/dgi\/archive$/) ||
    path === '/api/settings/invoice-preview' ||
    path.startsWith('/api/attendance/export') ||
    path === '/api/employees/form/print' ||
    path.match(/^\/api\/employees\/\d+\/form\/print$/) ||
    isReport;

  // Finance report tickets are GET-only, account-bound and cannot mint tickets.
  // Legacy print tickets remain valid only on the separate document print paths.
  if (isReport) {
    const deny = (status: 401 | 403 | 503, code: string) => c.json({ success: false, error: 'Accès au rapport refusé', code }, status);
    if (c.req.method !== 'GET') return deny(403, 'FORBIDDEN');
    const auth = c.req.header('Authorization');
    const queryToken = extractQueryToken(c.req.url);
    if (queryToken?.startsWith('np1.') || queryToken?.startsWith('nv3.')) return deny(401, 'INVALID_TOKEN');
    if (isAnyNativeV3TokenHeader(auth) && !isNativeV3AuthHeader(auth)) return deny(401, 'INVALID_TOKEN');
    const rt = c.req.query('rt');
    if (rt && !auth && !queryToken && path !== '/api/reports/link-ticket') {
      const verified = await verifyScopedReportTicket(reportTicketEnvironment(c.env), rt, getOwnerUsername(c.env));
      if (verified !== 'ok') return deny(401, verified === 'expired' ? 'TICKET_EXPIRED' : 'INVALID_TICKET');
      if (!REPORT_TICKET_PATHS.has(path)) return c.json({ success: false, code: 'UNSUPPORTED_REPORT', error: 'Rapport non pris en charge' }, 404);
      (c as any).set('reportTicket', rt);
      return next();
    }
    const reqAuthCtx = {
      dpopHeader: c.req.header('DPoP'),
      method: 'GET',
      requestUrl: c.req.url,
    };
    const isNativeV3Dpop = isNativeV3AuthHeader(auth);
    const runReport = async () => {
      let lastFailReason = 'bad_token';
      const identity = await verifyArchiveIdentity(c.env, auth || (queryToken ? `Bearer ${queryToken}` : undefined), clientIp(c), undefined, {
        authFailReason: async (header, env, db, ip, fp) => {
          const r = await authFailReason(header, env as Env, db, ip, fp, {
            relaxSession: !isNativeV3Dpop,
            dpopHeader: reqAuthCtx.dpopHeader,
            method: reqAuthCtx.method,
            requestUrl: reqAuthCtx.requestUrl,
          });
          lastFailReason = r;
          return r;
        },
        sessionUserFromHeader,
        ownerUsername: (env) => getOwnerUsername(env as Env),
        allowSecretaire: true,
      });
      if (!identity.ok) {
        return deny(
          identity.status,
          identity.status === 401 && lastFailReason === 'invalid_dpop' ? 'INVALID_DPOP' : identity.code,
        );
      }
      (c as any).set('reportIdentity', identity.identity);
      if (path !== '/api/reports/link-ticket' && REPORT_TICKET_PATHS.has(path)) {
        try {
          const ticket = await mintScopedReportTicket(reportTicketEnvironment(c.env), identity.identity as any, getOwnerUsername(c.env));
          (c as any).set('reportTicket', ticket.rt);
        } catch { return deny(503, 'REPORT_TICKET_UNAVAILABLE'); }
      }
      return next();
    };
    return isNativeV3Dpop ? runWithRequestAuthContext(reqAuthCtx, runReport) : runReport();
  }

  if (isPrintLike) {
    const ip = clientIp(c);
    const queryToken = extractQueryToken(c.req.url);
    const authHeader = c.req.header('Authorization');
    const isNativeV3Dpop = isNativeV3AuthHeader(authHeader);
    const wantsJson =
      (c.req.header('Accept') || '').includes('application/json') ||
      (c.req.header('Content-Type') || '').includes('application/json') ||
      !!authHeader?.startsWith('Bearer ') ||
      isNativeV3Dpop;

    const reportForbidden = (title: string, message: string, reason?: string) => {
      if (wantsJson) {
        return c.json({
          success: false,
          error: message,
          code: reason || 'UNAUTHORIZED',
        }, reason === 'FORBIDDEN_ROLE' ? 403 : 401);
      }
      return reportDeniedHtml(title, message, reason);
    };

    // 0) Short-lived print/report ticket (rt) — not a session JWT
    try {
      const u = new URL(c.req.url);
      const rt = u.searchParams.get('rt');
      if (rt && (await verifyReportLinkTicket(c.env, rt, path))) {
        (c as any).set('printTicketOk', true);
        return next();
      }
    } catch { /* */ }

    // 1) Query token (PDF tab / openReport)
    if (queryToken && !queryToken.startsWith('np1.') && !queryToken.startsWith('nv3.')) {
      const reason = await authFailReason(`Bearer ${queryToken}`, c.env, c.env.DB, ip, undefined, { relaxSession: true });
      if (reason === 'ok') {
        if (isReport) {
          const sess = sessionUserFromHeader(`Bearer ${queryToken}`);
          const role = (sess.role || '').toLowerCase();
          if (role !== 'owner' && role !== 'admin' && role !== 'secretaire') {
            return reportForbidden(
              'Accès réservé',
              'Les rapports comptables sont réservés au propriétaire, aux administrateurs et aux secrétaires.',
              'FORBIDDEN_ROLE'
            );
          }
        }
        return next();
      }
      if (isReport) {
        return reportForbidden(
          'Accès au rapport refusé',
          'La session n’a pas pu être validée. Reconnectez-vous puis rouvrez le rapport.',
          reason
        );
      }
    }

    // 2) Authorization header (SPA fetch for /api/reports/aging, tva, cogs, etc.)
    if (isReport && authHeader?.startsWith('Bearer ')) {
      const reason = await authFailReason(authHeader, c.env, c.env.DB, ip, undefined, { relaxSession: true });
      if (reason === 'ok') {
        const sess = sessionUserFromHeader(authHeader);
        const role = (sess.role || '').toLowerCase();
        if (role !== 'owner' && role !== 'admin' && role !== 'secretaire') {
          return reportForbidden(
            'Accès réservé',
            'Les rapports sont réservés au propriétaire, aux administrateurs et aux secrétaires.',
            'FORBIDDEN_ROLE'
          );
        }
        return next();
      }
      return reportForbidden('Accès au rapport refusé', 'Session invalide — reconnectez-vous.', reason);
    }

    // Report without any token
    if (isReport) {
      return reportForbidden(
        'Session requise',
        'Ouvrez ce rapport depuis l’application pendant que vous êtes connecté.',
        'missing'
      );
    }

    // Print-like via Authorization (SPA fetch / Desktop DPoP) or remaining cases — relax session
    if (authHeader?.startsWith('Bearer ')) {
      const reason = await authFailReason(authHeader, c.env, c.env.DB, ip, undefined, { relaxSession: true });
      if (reason === 'ok') return next();
      return reportForbidden(
        'Session requise',
        'Reconnectez-vous puis rouvrez le document depuis l’application.',
        reason || 'UNAUTHORIZED',
      );
    }
    if (isNativeV3Dpop) {
      const reqAuthCtx = {
        dpopHeader: c.req.header('DPoP'),
        method: c.req.method.toUpperCase(),
        requestUrl: c.req.url,
      };
      return runWithRequestAuthContext(reqAuthCtx, async () => {
        const reason = await authFailReason(authHeader, c.env, c.env.DB, ip, undefined, {
          dpopHeader: reqAuthCtx.dpopHeader,
          method: reqAuthCtx.method,
          requestUrl: reqAuthCtx.requestUrl,
        });
        if (reason === 'ok') return next();
        return reportForbidden(
          'Session requise',
          reason === 'invalid_dpop'
            ? 'Preuve DPoP invalide ou expirée.'
            : 'Reconnectez-vous puis rouvrez le document depuis l’application.',
          reason === 'invalid_dpop' ? 'INVALID_DPOP' : reason || 'UNAUTHORIZED',
        );
      });
    }
    // No token / no rt on print-like → friendly HTML (not raw JSON)
    return reportForbidden(
      'Session requise',
      'Ouvrez ce document depuis l’application pendant que vous êtes connecté.',
      'missing',
    );
  }
  const ip = clientIp(c);
  const fp = c.req.header('X-Device-Fingerprint') || undefined;
  if (c.req.header('Authorization')?.slice(7).startsWith('np1.') && new URL(c.req.url).origin !== c.env.DESKTOP_NATIVE_V2_PILOT_ORIGIN) return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Non autorisé' }, 401);
  const roleRefreshPath = path === '/api/auth/role-refresh' && c.req.method === 'POST';
  const reqAuthCtx = {
    dpopHeader: c.req.header('DPoP'),
    method: c.req.method.toUpperCase(),
    requestUrl: c.req.url,
  };
  return runWithRequestAuthContext(reqAuthCtx, async () => {
    let reason: string;
    try {
      reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, ip, fp, {
        allowRoleRefresh: roleRefreshPath,
        dpopHeader: reqAuthCtx.dpopHeader,
        method: reqAuthCtx.method,
        requestUrl: reqAuthCtx.requestUrl,
      });
    } catch (err) {
      if (path === '/api/auth/logout' && c.req.method === 'POST') {
        return c.json(
          { success: false, resume_prepared: false, code: 'LOGOUT_REVOCATION_FAILED', error: 'Déconnexion serveur impossible.' },
          503,
        );
      }
      throw err;
    }
    if (reason === 'role_changed') return c.json({ success: false, error: 'Votre rôle a changé. Actualisez votre session.', code: 'ROLE_CHANGED' }, 409);
    if (reason !== 'ok') {
      return c.json({
        success: false,
        error:
          reason === 'ip_changed' ? 'Adresse IP modifiée — reconnexion requise'
          : reason === 'fp_changed' ? 'Appareil différent — reconnexion requise'
          : reason === 'device_revoked' ? 'Appareil révoqué — reconnexion requise'
          : reason === 'invalid_dpop' ? 'Preuve DPoP invalide ou expirée'
          : 'Non autorisé',
        code:
          reason === 'ip_changed' ? 'IP_CHANGED'
          : reason === 'fp_changed' ? 'DEVICE_CHANGED'
          : reason === 'device_revoked' ? 'DEVICE_REVOKED'
          : reason === 'invalid_dpop' ? 'INVALID_DPOP'
          : 'UNAUTHORIZED',
      }, 401);
    }
    if (
      path !== '/api/auth/logout' &&
      path !== '/api/auth/devices/revoke' &&
      !path.startsWith('/api/auth/trusted-devices/')
    ) {
      try {
        const authStr = c.req.header('Authorization');
        const pAuth = parseAuthorizationHeader(authStr);
        const rawAuthTok = pAuth?.scheme === 'Bearer' ? pAuth.token : '';
        const parsedTok =
          rawAuthTok && !rawAuthTok.startsWith('np1.') && !rawAuthTok.startsWith('nv3.')
            ? parseToken(rawAuthTok)
            : null;
        const effectiveFp =
          (fp && fp !== 'none' ? fp : '') ||
          (parsedTok?.fingerprint && parsedTok.fingerprint !== 'none' ? parsedTok.fingerprint : '');
        const sess = sessionUserFromHeader(authStr);
        if (effectiveFp && sess.username && !isAnyNativeV3TokenHeader(authStr) && !rawAuthTok.startsWith('nv3.')) {
          await touchTrustedDevice(
            c.env.DB,
            sess.username,
            effectiveFp,
            ip,
            c.req.header('User-Agent') || '',
            cfGeo(c),
            { updateOnly: true },
          );
        }
      } catch { /* best-effort */ }
    }
    return next();
  });
});

app.use('*', async (c, next) => {
  const rawReqId = String(c.req.header('X-Request-Id') || '').trim();
  const requestId = /^[A-Za-z0-9._-]{8,64}$/.test(rawReqId) ? rawReqId : crypto.randomUUID();
  c.set('requestId', requestId);
  c.set('bffSurface', detectBffSurface(c));
  const reqPath = new URL(c.req.url).pathname;
  if (
    reqPath.startsWith('/api/') &&
    ['POST', 'PUT', 'PATCH'].includes(c.req.method.toUpperCase()) &&
    !/\/(android-release|desktop-release|desktop-update\/installer|backups\/restore|image|agent\/files|import|parse-document|parse-id|id-document|cdn-upload)/.test(reqPath)
  ) {
    const cl = Number(c.req.header('Content-Length') || 0);
    if (Number.isFinite(cl) && cl > 2_000_000) {
      c.header('X-Request-Id', requestId);
      return c.json(
        { success: false, error: 'Charge utile trop volumineuse (max 2 Mo).', code: 'PAYLOAD_TOO_LARGE', request_id: requestId },
        413,
      );
    }
  }
  await next();
  try { c.header('X-Request-Id', requestId); } catch { /* */ }
  try { c.header('X-Atlas-Bff', String(c.get('bffSurface') || 'web')); } catch { /* */ }
  const path = reqPath;
  // ── Edge-cache guard (2026-10-22, security patrol finding) ──
  // A Cloudflare "cache everything"-style rule can store API responses at
  // the edge and replay them to OTHER visitors: the patrol caught an
  // authenticated /api/admin/r2/images listing being served anonymously
  // from cache, and a stale 403 of /api/health. Origins must be explicit:
  //  - no Cache-Control at all → no-store (JSON APIs are never cacheable)
  //  - private/no-* Cache-Control → keep it for browsers, but pin the
  //    Cloudflare edge with CDN-Cache-Control: no-store (CF-specific header
  //    that survives even misconfigured cache rules)
  //  - public Cache-Control → deliberate (public images/SVG); left as-is.
  if (path === '/login/desktop' || path === '/login/desktop-phone' || path === '/login/desktop-challenge' || path === EMBEDDED_CHALLENGE_PATH || path === `${EMBEDDED_CHALLENGE_PATH}.js` || path === V3_WEBVIEW_CHALLENGE_PATH || path === `${V3_WEBVIEW_CHALLENGE_PATH}.js` || path === V3_BROWSER_CHALLENGE_PATH || path === `${V3_BROWSER_CHALLENGE_PATH}.js`) {
    c.header('Cache-Control', 'no-store');
    c.header('CDN-Cache-Control', 'no-store');
  }
  if (path.startsWith('/api')) {
    try {
      const cc = (c.res.headers.get('Cache-Control') || '').toLowerCase();
      if (!cc) {
        c.header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        c.header('CDN-Cache-Control', 'no-store');
      } else if (!cc.startsWith('public')) {
        c.header('CDN-Cache-Control', 'no-store');
      }
    } catch { /* response already immutable — nothing we can do */ }
  }
  // Security headers (defence in depth)
  c.header('X-Content-Type-Options', 'nosniff');
  // v0.7.1 — l'aperçu PDF s'affiche DANS une iframe same-origin (Settings) :
  // SAMEORIGIN suffit à bloquer le clickjacking externe tout en laissant
  // passer notre propre modal. Tout le reste reste DENY.
  c.header('X-Frame-Options', c.req.path === '/api/settings/invoice-preview' ? 'SAMEORIGIN' : 'DENY');
  c.header('Referrer-Policy', path === '/login/desktop' || path === '/login/desktop-phone' || path === '/login/desktop-challenge' || path === EMBEDDED_CHALLENGE_PATH || path === `${EMBEDDED_CHALLENGE_PATH}.js` || path === V3_WEBVIEW_CHALLENGE_PATH || path === `${V3_WEBVIEW_CHALLENGE_PATH}.js` || path === V3_BROWSER_CHALLENGE_PATH || path === `${V3_BROWSER_CHALLENGE_PATH}.js` || isDesktopAuthPath(path) || path.startsWith(`${NATIVE_V2}/`) || path.startsWith(`${NATIVE_V3}/`) ? 'no-referrer' : 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=()');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  c.header('Cross-Origin-Opener-Policy', 'same-origin');
  c.header('Cross-Origin-Resource-Policy', 'same-site');
  c.header('X-DNS-Prefetch-Control', 'off');
  // CSP: allow same-origin + inline styles (React) + the CDN used for product images.
  // Scripts are restricted; form-action limited to self.
  // CSP — allow service worker, Turnstile, CDN images, and same-origin API.
  // Report-only style violations from browser extensions are expected and harmless.
  c.header(
    'Content-Security-Policy',
    path === EMBEDDED_CHALLENGE_PATH
      ? EMBEDDED_CHALLENGE_CSP
      : (path === V3_WEBVIEW_CHALLENGE_PATH || path === V3_BROWSER_CHALLENGE_PATH)
        ? V3_CHALLENGE_CSP
        : [
      "default-src 'self'",
      // The bundled barcode decoder uses WebAssembly; do not enable JavaScript unsafe-eval.
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
      "worker-src 'self' blob:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https: http: https://cdn1.afmarbre.com https://*.r2.cloudflarestorage.com",
      "media-src 'self' blob: data:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://challenges.cloudflare.com https://cdn1.afmarbre.com https://cloudflareinsights.com https://api.github.com https://avatars.githubusercontent.com",
      "frame-src 'self' blob: https://challenges.cloudflare.com https://docs.google.com",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join('; ')
  );
  // HSTS only meaningful on HTTPS production hosts
  const host = (c.req.header('host') || '').toLowerCase();
  if (host && !host.includes('localhost') && !host.includes('127.0.0.1')) {
    c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
});

/** Phase 2: rate-limit admin API (owner-only, still protect against stolen sessions / scripts).
 *  restore-status is polled during long restores → use a generous dedicated budget so the UI
 *  never gets stuck on 429 while the background job is still running.
 */
app.use('/api/admin/*', async (c, next) => {
  if (c.req.method === 'OPTIONS') return next();
  const path = new URL(c.req.url).pathname;
  const ip = clientIpFromRequest(c);
  // Progress polling during restore must not compete with the strict admin budget
  if (path === '/api/admin/backups/restore-status' || path.endsWith('/backups/restore-status')) {
    const rl = await rateLimit(c.env.CACHE, `admin-restore-status:${ip}`, 120, 60); // 120/min
    if (!rl.ok) {
      return c.json(
        { success: false, error: 'Trop de requêtes de statut. Réessayez dans un instant.', code: 'RATE_LIMITED', retry_after: rl.retryAfter },
        429
      );
    }
    c.header('X-RateLimit-Remaining', String(rl.remaining));
    return next();
  }
  // Atlas Agent thread sync is frequent (every message) — separate generous bucket, not the 60/min admin cap
  if (path.includes('/api/admin/agent/threads') || path.includes('/api/admin/agent-permissions')) {
    const rl = await rateLimit(c.env.CACHE, `admin-agent:${ip}`, 180, 60); // 180/min
    if (!rl.ok) {
      return c.json(
        { success: false, error: 'Trop de sync agent. Réessayez dans un instant.', code: 'RATE_LIMITED', retry_after: rl.retryAfter },
        429
      );
    }
    c.header('X-RateLimit-Remaining', String(rl.remaining));
    return next();
  }
  const rl = await rateLimit(c.env.CACHE, `admin:${ip}`, 90, 60); // 90 req / min / IP (was 60)
  if (!rl.ok) {
    return c.json(
      { success: false, error: 'Trop de requêtes administrateur. Réessayez dans un instant.', code: 'RATE_LIMITED', retry_after: rl.retryAfter },
      429
    );
  }
  c.header('X-RateLimit-Remaining', String(rl.remaining));
  return next();
});

/** Phase 2: rate-limit auth endpoints (login / OTP). Complements IP reputation. */
app.use('/api/auth/*', async (c, next) => {
  if (c.req.method === 'OPTIONS' || c.req.method === 'GET') return next();
  // Desktop PKCE has separate atomic D1 budgets and a per-request poll cap.
  // Credential paths below have account-aware budgets; legacy auth retains 8/min.
  if (isDesktopAuthPath(c.req.path) || isNativeV2Operation(c.req.path) || c.req.path.startsWith(`${NATIVE_V3}/`)) return next();
  // These exact handlers reserve persistent per-account and shared-IP budgets.
  // Do not apply the old 8/min shared-IP gate on top of those budgets.
  if (hasCredentialAttemptBudget(c.req.path)) return next();
  const ip = clientIpFromRequest(c);
  const rl = await rateLimit(c.env.CACHE, `auth:${ip}`, 8, 60); // 8 writes / min / IP
  if (!rl.ok) {
    c.header('Retry-After', String(rl.retryAfter || 60));
    return c.json(
      { success: false, error: 'Trop de tentatives. Réessayez dans une minute.', code: 'RATE_LIMITED', retry_after: rl.retryAfter },
      429
    );
  }
  return next();
});

app.use('/api/public/*', async (c, next) => {
  if (c.req.method === 'OPTIONS') return next();
  const ip = clientIpFromRequest(c);
  const rl = await rateLimit(c.env.CACHE, `pub:${ip}`, 40, 60);
  if (!rl.ok) {
    c.header('Retry-After', String(rl.retryAfter || 60));
    return c.json(
      { success: false, error: 'Trop de requêtes. Réessayez plus tard.', code: 'RATE_LIMITED' },
      429,
    );
  }
  return next();
});

/** Never leak SQL / D1 / stack traces — always safe JSON. */
app.onError(async (err, c) => {
  const errPath = new URL(c.req.url).pathname;
  if (errPath.startsWith(`${NATIVE_V2}/`) || errPath.startsWith(`${NATIVE_V3}/`)) {
    return c.json({ success: false, code: 'UNAVAILABLE', error: 'Connexion indisponible.' }, 503);
  }
  if (err instanceof SchemaBusyError) {
    c.header('Retry-After', '3');
    return apiFail(c, err.message, 'SERVICE_UNAVAILABLE');
  }
  // Authentication errors may contain request secrets; never log their raw exceptions.
  try { if (!errPath.startsWith('/api/reports/') && !errPath.startsWith('/api/auth/') && !errPath.startsWith(EMBEDDED_CHALLENGE_PATH) && !errPath.startsWith(V3_WEBVIEW_CHALLENGE_PATH) && !errPath.startsWith(V3_BROWSER_CHALLENGE_PATH)) console.error('[onError]', c.get('requestId') || '-', c.req.method, errPath, String((err as any)?.stack || err || '').slice(0, 500)); } catch { /* */ }
  const safe = toClientError(err, { log: !errPath.startsWith('/api/auth/') && !errPath.startsWith(EMBEDDED_CHALLENGE_PATH) && !errPath.startsWith(V3_WEBVIEW_CHALLENGE_PATH) && !errPath.startsWith(V3_BROWSER_CHALLENGE_PATH) });
  // v243.4: SQLITE_CORRUPT(_VTAB) on this app almost always means the
  // products_fts FTS5 shadow pages — derived data we can rebuild ourselves.
  // Heal now, tell the client to retry; a TimeTravel restore is NOT needed.
  if (safe.code === 'DB_CORRUPT') {
    const how = await repairProductSearchIndex(c.env.DB).catch(() => 'failed' as const);
    if (how !== 'failed') {
      return apiFail(
        c,
        'Index de recherche produit corrompu — réparation automatique effectuée (aucune donnée perdue). Réessayez votre action.',
        'SERVICE_UNAVAILABLE',
        { repaired: how },
        503,
      );
    }
  }
  try {
    return apiFail(c, safe.error, safe.code as any, safe.details, safe.status);
  } catch {
    return new Response(
      JSON.stringify({ success: false, error: 'Erreur interne — réessayez plus tard', code: 'INTERNAL' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});


/** Reliability / infra status (owner) — LB, CDN, cache, queue, search, backups */
app.get('/api/admin/reliability', async (c) => {
  const role = normalizeRole((c.get('role') as string) || (c.get('user') as any)?.role || '');
  if (role !== 'owner' && role !== 'admin') {
    return apiFail(c, 'Action non autorisée', 'FORBIDDEN');
  }
  return apiOk(c, reliabilityStatus(c.env));
});

/** Owner/admin: manual FTS self-heal (same path as the automatic repair). */
app.post('/api/admin/search-index/rebuild', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  const how = await repairProductSearchIndex(c.env.DB, { force: true });
  return c.json({ success: how !== 'failed', result: how });
});

/* Domain route modules (extracted from monolith) */
registerInvoiceReadRoutes(app, { requireBizMutator });
registerStockReadRoutes(app, { requireFloorStock, sessionUserFromHeader, dispatchWebhook });
registerWholesaleRoutes(app, { requireBizMutator, sessionUserFromHeader });
registerPublicRoutes(app);
registerClientRoutes(app, {
  issueDeleteOtp,
  requireBizMutator,
  checkConfirmPassword,
  clientDeleteBlockers,
  writeAudit,
});
registerPartnerV1Routes(app);
/* Mail UI removed from the shell, but the mailbox module still serves the
   Atlas Agent thread sync routes (/api/admin/agent/threads*) — keep them live. */
registerMailboxRoutes(app, {
  verifyBackupAccess: makeVerifyBackupAccess(requireOwner, hmacSha256Hex),
  sessionUserFromHeader,
});
async function requireEmployeeAdmin(c: any): Promise<Response | null> {
  if ((c as any).get('printTicketOk') === true) return null;
  const path = c.req.path;
  const isPrintRoute =
    path === '/api/settings/invoice-preview' ||
    path === '/api/employees/form/print' ||
    /^\/api\/employees\/\d+\/form\/print$/.test(path) ||
    // Opened in a new tab (no Authorization header possible). The global
    // print-like gate already validated the ?token= session for these paths.
    /^\/api\/payroll\/runs\/\d+\/lines\/\d+\/bulletin$/.test(path) ||
    /^\/api\/payroll\/runs\/\d+\/declaration$/.test(path);
  const authHeader = c.req.header('Authorization');
  const queryToken = isPrintRoute ? extractQueryToken(c.req.url) : undefined;
  const effectiveHeader = authHeader || (queryToken && !queryToken.startsWith('np1.') ? `Bearer ${queryToken}` : undefined);
  const result = await verifyArchiveIdentity(c.env, effectiveHeader, clientIp(c), authHeader ? c.req.header('X-Device-Fingerprint') : undefined, {
    authFailReason: (header, env, db, ip, fp) => authFailReason(header, env as Env, db, ip, fp, isPrintRoute && !authHeader ? { relaxSession: true } : undefined),
    sessionUserFromHeader,
    ownerUsername: env => getOwnerUsername(env as Env),
  });
  return result.ok ? null : c.json({ success: false, error: 'Accès refusé', code: result.code }, result.status);
}
async function requireEmployeeDirectory(c: any): Promise<Response | null> {
  try {
    const authHeader = c.req.header('Authorization');
    if (await authFailReason(authHeader, c.env as Env, c.env.DB, clientIp(c), c.req.header('X-Device-Fingerprint')) !== 'ok') {
      return c.json({ success: false, error: 'Accès refusé', code: 'UNAUTHORIZED' }, 401);
    }
    const session = sessionUserFromHeader(authHeader);
    const username = String(session.username || '').toLowerCase();
    if (!username) return c.json({ success: false, error: 'Accès refusé', code: 'UNAUTHORIZED' }, 401);
    const owner = username === getOwnerUsername(c.env as Env) && session.role === 'owner';
    let role = 'owner';
    if (!owner) {
      const user = await c.env.DB.prepare('SELECT id, role FROM app_users WHERE username = ? AND active = 1').bind(username).first() as { id: number; role: string } | null;
      if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || user.role !== session.role) {
        return c.json({ success: false, error: 'Accès refusé', code: 'UNAUTHORIZED' }, 401);
      }
      role = String(user.role || '').toLowerCase();
    }
    if (role !== 'owner' && role !== 'admin' && role !== 'secretaire') {
      return c.json({ success: false, error: 'Accès refusé', code: 'FIN_FORBIDDEN' }, 403);
    }
    return null;
  } catch {
    return c.json({ success: false, error: 'Service indisponible', code: 'SERVICE_UNAVAILABLE' }, 503);
  }
}
registerEmployeeRoutes(app, { checkConfirmPassword, requireEmployeeAdmin, requireEmployeeDirectory });
/* v254 — role-safe finance, payroll & reminders (owner/admin gated, server-computed) */
registerFinanceRoutes(app, { sessionUserFromHeader, authFailReason, clientIp, writeAudit, requireEmployeeAdmin });
registerCashShiftRoutes(app, { sessionUserFromHeader, writeAudit, reportShell });
registerPayrollRoutes(app, { requireEmployeeAdmin, loadAttendanceRules, writeAudit, sessionUserFromHeader, clientIp });
registerFecRoutes(app, { requireOwner, requireFecAccess, writeAudit, clientIp });
registerDunningRoutes(app, { requireEmployeeAdmin, sessionUserFromHeader, writeAudit, clientIp });
registerDgiRoutes(app, { requireBizMutator, requireOwner, writeAudit, clientIp });
registerAtlasV209Routes(app, { sessionUserFromHeader, applyStockDelta, adjustLocationStock, getDefaultLocationId });
// Admin read routes need helpers defined later — registered near Users & Admin section

/* ═══ v225 — Atlas Agent governance: usage caps, injection lockout, privacy deletes, 2FA, devices ═══ */
/* Prompt-injection / abuse tripwire: client flags the session user; agent locked until an admin restores. */
registerCanaryHealthRoutes(app, {
  WAF_STATS,
  authFailReason,
  clientIp,
  dbPrimaryFlag,
  setDbPrimaryCache: (v: { value: string; at: number } | null) => { dbPrimaryCache = v; privateDbPrimaryCache = new WeakMap(); },
  getConfig,
  issueDeleteOtp,
  requireOwner,
  sessionUserFromHeader,
  setConfig,
  userMail,
  verifyDeleteOtp,
  writeAudit,
});
// Extracted auth, session, OTP, PBKDF2, and device helpers → ./lib/authHelpers.ts
registerAuthRoutes(app, {
  authFailReason,
  clientIp,
  credentialAttemptGate,
  derivePbkdf2Bits,
  ensureSecurityTables,
  generateOTP,
  getConfig,
  getOwnerUsername,
  getPassword,
  getReputation,
  isModernPasswordHash,
  isNativeAuthRequest,
  isRateLimited,
  makeTokenV2,
  nativeCurrentIdentity,
  normalizePassword,
  otpEmailHTML,
  parseToken,
  passwordsMatch,
  recordLogin,
  resolveUserProfileAvatar,
  secretMaterialForUsername,
  sendOtpMail,
  sessionUserFromHeader,
  trustDevice,
  upgradeUserPasswordHash,
  verifyTurnstile,
  verifyUserPassword,
  writeAudit,
});
function defaultUserAvatar(username: string, avatarUrl?: string | null): string {
  const url = String(avatarUrl || '').trim();
  if (url && (url.startsWith('http') || url.startsWith('data:') || url.startsWith('/'))) return url;
  const name = String(username || '?').trim() || '?';
  const letter = name.slice(0, 1).toUpperCase();
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const bg = `hsl(${hue} 35% 22%)`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="${bg}"/><text x="64" y="64" dy="0.35em" text-anchor="middle" font-family="system-ui,sans-serif" font-size="56" font-weight="700" fill="#fafafa">${letter}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Resolve display name + avatar like /api/auth/me (DO → app_users → app_config). */
async function resolveUserProfileAvatar(
  env: Env,
  username: string,
): Promise<{ display_name: string; avatar_url: string }> {
  const uname = String(username || '').trim();
  if (!uname) return { display_name: '', avatar_url: '' };
  let displayName = uname;
  let avatarUrl = '';
  // 1) Durable Object profile (same as /api/auth/me)
  try {
    const fromDo = await readProfileFromDo(env, uname);
    if (fromDo) {
      if (fromDo.display_name) displayName = fromDo.display_name;
      if (fromDo.avatar_url) avatarUrl = String(fromDo.avatar_url).trim();
    }
  } catch { /* */ }
  // 2) app_users row
  try {
    const u = await env.DB
      .prepare(`SELECT display_name, avatar_url, role FROM app_users WHERE lower(username) = lower(?)`)
      .bind(uname)
      .first() as any;
    if (u?.display_name && displayName === uname) displayName = String(u.display_name);
    if (!avatarUrl && u?.avatar_url) avatarUrl = String(u.avatar_url).trim();
    const role = String(u?.role || '').toLowerCase();
    const isOwnerLike =
      !u || role === 'owner' || role === 'admin' || uname.toLowerCase() === 'admin';
    // 3) Owner fields in app_config (NOT app_settings)
    if (!avatarUrl || isOwnerLike) {
      try {
        const dn = await env.DB.prepare(`SELECT value FROM app_config WHERE key = 'owner_display_name'`).first() as any;
        const av = await env.DB.prepare(`SELECT value FROM app_config WHERE key = 'owner_avatar_url'`).first() as any;
        if (isOwnerLike && dn?.value) displayName = String(dn.value);
        if (av?.value && String(av.value).trim()) {
          if (!avatarUrl || isOwnerLike) avatarUrl = String(av.value).trim();
        }
      } catch { /* */ }
    }
  } catch { /* */ }
  return {
    display_name: displayName || uname,
    avatar_url: defaultUserAvatar(uname, avatarUrl),
  };
}


/* ─── Users & Admin configuration (owner only) ─── */

function requireOwner(c: any): { ok: true; username: string } | { ok: false; response: Response } {
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  // Principal account is 'owner'; accept legacy 'admin' role as equivalent for server admin endpoints
  if (session.role !== 'owner' && session.role !== 'admin') {
    return {
      ok: false,
      response: c.json({ success: false, error: 'Réservé à l\'administrateur principal', code: 'OWNER_ONLY' }, 403),
    };
  }
  return { ok: true, username: session.username };
}

/** Accounting / FEC access: owner, admin, and secretaire (supports validated query ?token= on /export). */
function requireFecAccess(c: any): { ok: true; username: string; role: string } | { ok: false; response: Response } {
  if ((c as any).get('printTicketOk')) {
    return { ok: true, username: 'ticket', role: 'owner' };
  }
  let authHeader = c.req.header('Authorization');
  if (!authHeader && c.req.path === '/api/accounting/fec/export') {
    const qt = extractQueryToken(c.req.url);
    if (qt && !qt.startsWith('np1.') && !qt.startsWith('nv3.')) {
      authHeader = `Bearer ${qt}`;
    }
  }
  const session = sessionUserFromHeader(authHeader);
  const role = normalizeRole(session.role);
  if (!canMutateBusiness(role)) {
    return {
      ok: false,
      response: c.json(
        {
          success: false,
          error: 'Réservé aux rôles administrateur ou secrétaire.',
          code: 'FORBIDDEN_ROLE',
          role,
        },
        403,
      ),
    };
  }
  return { ok: true, username: session.username || 'user', role };
}

/** Business mutations (invoices, products, clients…): secretaire / admin / owner. */
function requireBizMutator(c: any): { ok: true; username: string; role: string } | { ok: false; response: Response } {
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const role = normalizeRole(session.role);
  if (!canMutateBusiness(role)) {
    return {
      ok: false,
      response: c.json(
        {
          success: false,
          error: 'Votre rôle ne permet pas cette action. Demandez à un secrétaire ou administrateur.',
          code: 'FORBIDDEN_ROLE',
          role,
        },
        403
      ),
    };
  }
  return { ok: true, username: session.username || 'user', role };
}

/** Floor stock ops (cycle count, transfer between locations): includes magasinier. */
function requireFloorStock(c: any): { ok: true; username: string; role: string } | { ok: false; response: Response } {
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const role = normalizeRole(session.role);
  if (!(role === 'owner' || role === 'admin' || role === 'secretaire' || role === 'stock')) {
    return {
      ok: false,
      response: c.json(
        {
          success: false,
          error: 'Rôle insuffisant pour inventaire / transfert.',
          code: 'FORBIDDEN_ROLE',
          role,
        },
        403
      ),
    };
  }
  return { ok: true, username: session.username || 'user', role };
}

// Extracted admin read routes
registerAdminReadRoutes(app, {
  requireOwner,
  getOwnerUsername,
  ensureSecurityTables,
});


/* GET /api/admin/users → worker/routes/admin.ts */


registerUsersAdminRoutes(app, {
  authFailReason,
  cfGeo,
  checkConfirmPassword,
  clientIp,
  ensureSecurityTables,
  getConfig,
  getOwnerUsername,
  getPassword,
  getReputation,
  hashUserPassword,
  makeSessionProof,
  makeTokenV2,
  normalizePassword,
  parseToken,
  randomChallenge,
  readProfileFromDo,
  refreshLimitGate,
  requireBizMutator,
  requireOwner,
  resolveUserProfileAvatar,
  sessionUserFromHeader,
  setConfig,
  touchTrustedDevice,
  writeAudit,
  writeProfileToDo,
  ensureHrSettings,
  issueDeleteOtp,
});
/* ─── Auth Middleware ─── */

/* ─── Public Routes ─── */

registerPublicSignedRoutes(app, {
  requireOwner,
  requireBizMutator,
  writeAudit,
  ensurePaymentHistoryTable,
  ensureReceiptsTable,
  ensureReceiptSituationColumn,
  ensureHmacKeyColumns,
  ensureQrPrivacySettings,
  ensureInvoicePublicToken,
  publicTokenSecretsAsync,
  publicRateLimit,
  purgeEphemeralSecurityData,
  createAtlasTimestampToken,
  verifyAtlasTimestampToken,
  invoiceDocHashPayload,
  sha256Hex,
  parseSecureQrPayload,
  validateStoredSignature,
  digestSignatureImage,
});
async function ensureEmployeeTeamColumn(db: D1Database) {
  await schemaOnce('employee_team', async () => {
    await addColumnIfMissing(db, 'employees', 'team', "TEXT DEFAULT ''");
    await addColumnIfMissing(db, 'employees', 'returned_at', 'TEXT');
    await addColumnIfMissing(db, 'employees', 'last_paid_at', 'TEXT');
    await addColumnIfMissing(db, 'employees', 'joined_date', 'TEXT');
    await addColumnIfMissing(db, 'employees', 'job_title', "TEXT DEFAULT ''");
  });
}

async function ensureHrSettings(db: D1Database) {
  await schemaOnce('hr_settings', async () => {
    await addColumnIfMissing(db, 'company_settings', 'tax_rate', `REAL DEFAULT 20`);
    await addColumnIfMissing(db, 'company_settings', 'currency', `TEXT DEFAULT 'MAD'`);
    await addColumnIfMissing(db, 'company_settings', 'attendance_enabled', `INTEGER DEFAULT 0`);
    await addColumnIfMissing(db, 'company_settings', 'attendance_late_grace_pct', `REAL DEFAULT 25`);
    await addColumnIfMissing(db, 'company_settings', 'attendance_late_block_pct', `REAL DEFAULT 10`);
    await addColumnIfMissing(db, 'company_settings', 'attendance_late_half_days', `REAL DEFAULT 0.5`);
    await addColumnIfMissing(db, 'company_settings', 'attendance_late_threshold', `TEXT DEFAULT '09:15'`);
    await addColumnIfMissing(db, 'company_settings', 'attendance_early_threshold', `TEXT DEFAULT '18:00'`);
    await addColumnIfMissing(db, 'company_settings', 'attendance_overtime_after_hours', `REAL DEFAULT 8`);
    await addColumnIfMissing(db, 'company_settings', 'attendance_overtime_multiplier', `REAL DEFAULT 1.25`);
    await addColumnIfMissing(db, 'company_settings', 'attendance_half_morning', `TEXT DEFAULT '09:00-13:00'`);
    await addColumnIfMissing(db, 'company_settings', 'attendance_half_afternoon', `TEXT DEFAULT '14:00-18:00'`);
    await addColumnIfMissing(db, 'company_settings', 'attendance_workday_hours', `REAL DEFAULT 8`);
    await addColumnIfMissing(db, 'company_settings', 'attendance_acompte_week1_pct', `REAL DEFAULT 5`);
    await addColumnIfMissing(db, 'company_settings', 'attendance_acompte_week2_pct', `REAL DEFAULT 5`);
    await addColumnIfMissing(db, 'company_settings', 'attendance_acompte_monthly_max_pct', `REAL DEFAULT 15`);
    await addColumnIfMissing(db, 'company_settings', 'attendance_acompte_week4_pct', `REAL DEFAULT 5`);
    await addColumnIfMissing(db, 'company_settings', 'attendance_acompte_week3_pct', `REAL DEFAULT 5`);
    await addColumnIfMissing(db, 'company_settings', 'attendance_acompte_short_cycle_days', `INTEGER DEFAULT 14`);
    await addColumnIfMissing(db, 'company_settings', 'attendance_acompte_short_max_pct', `REAL DEFAULT 5`);
    await addColumnIfMissing(db, 'company_settings', 'attendance_acompte_require_presence', `INTEGER DEFAULT 1`);
    await addColumnIfMissing(db, 'company_settings', 'attendance_pay_use_presence', `INTEGER DEFAULT 1`);
    await addColumnIfMissing(db, 'company_settings', 'attendance_minute_deduct', `INTEGER DEFAULT 0`);
    await addColumnIfMissing(db, 'company_settings', 'attendance_warn_late_count', `INTEGER DEFAULT 3`);
    await addColumnIfMissing(db, 'company_settings', 'attendance_blame_late_count', `INTEGER DEFAULT 6`);
    await addColumnIfMissing(db, 'company_settings', 'attendance_pay_mode', `TEXT DEFAULT 'presence'`);
  });
}

export type AttendanceRules = {
  enabled: boolean;
  grace_pct: number;
  block_pct: number;
  half_days: number;
  late_threshold: string;
  early_threshold: string;
  overtime_after_hours: number;
  overtime_multiplier: number;
  half_morning: string;
  half_afternoon: string;
  workday_hours: number;
  acompte_week1_pct: number;
  acompte_week2_pct: number;
  acompte_short_cycle_days: number;
  acompte_short_max_pct: number;
  acompte_require_presence: boolean;
  pay_use_presence: boolean;
  /** presence = pay worked days; calendar = pro-rata elapsed days */
  pay_mode: 'presence' | 'calendar';
  /** Optional: deduct unpaid late minutes after threshold */
  minute_deduct: boolean;
  warn_late_count: number;
  blame_late_count: number;
};

async function loadAttendanceRules(db: D1Database): Promise<AttendanceRules> {
  try { await ensureHrSettings(db); } catch { /* */ }
  const defaults: AttendanceRules = {
    enabled: false,
    grace_pct: 25,
    block_pct: 10,
    half_days: 0.5,
    late_threshold: '09:15',
    early_threshold: '18:00',
    overtime_after_hours: 8,
    overtime_multiplier: 1.25,
    half_morning: '09:00-13:00',
    half_afternoon: '14:00-18:00',
    workday_hours: 8,
    acompte_week1_pct: 5,
    acompte_week2_pct: 5,
    acompte_short_cycle_days: 14,
    acompte_short_max_pct: 5,
    acompte_require_presence: true,
    pay_use_presence: true,
    pay_mode: 'presence',
    minute_deduct: false,
    warn_late_count: 3,
    blame_late_count: 6,
  };
  try {
    const s = await db.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    if (!s) return defaults;
    const mode = String(s.attendance_pay_mode || 'presence').toLowerCase() === 'calendar' ? 'calendar' : 'presence';
    return {
      enabled: Number(s.attendance_enabled) === 1,
      grace_pct: Math.max(0, Math.min(100, Number(s.attendance_late_grace_pct ?? 25))),
      block_pct: Math.max(1, Math.min(50, Number(s.attendance_late_block_pct ?? 10))),
      half_days: Math.max(0, Math.min(5, Number(s.attendance_late_half_days ?? 0.5))),
      late_threshold: String(s.attendance_late_threshold || '09:15').slice(0, 5),
      early_threshold: String(s.attendance_early_threshold || '18:00').slice(0, 5),
      overtime_after_hours: Math.max(1, Math.min(24, Number(s.attendance_overtime_after_hours ?? s.attendance_workday_hours ?? 8))),
      overtime_multiplier: Math.max(1, Math.min(3, Number(s.attendance_overtime_multiplier ?? 1.25))),
      half_morning: String(s.attendance_half_morning || '09:00-13:00'),
      half_afternoon: String(s.attendance_half_afternoon || '14:00-18:00'),
      workday_hours: Math.max(1, Math.min(24, Number(s.attendance_workday_hours ?? 8))),
      acompte_week1_pct: Math.max(0, Math.min(50, Number(s.attendance_acompte_week1_pct ?? 5))),
      acompte_week2_pct: Math.max(0, Math.min(50, Number(s.attendance_acompte_week2_pct ?? 5))),
      acompte_short_cycle_days: Math.max(1, Math.min(60, Number(s.attendance_acompte_short_cycle_days ?? 14))),
      acompte_short_max_pct: Math.max(0, Math.min(50, Number(s.attendance_acompte_short_max_pct ?? 5))),
      acompte_require_presence: Number(s.attendance_acompte_require_presence ?? 1) === 1,
      pay_use_presence: Number(s.attendance_pay_use_presence ?? 1) === 1,
      pay_mode: mode,
      minute_deduct: Number(s.attendance_minute_deduct) === 1,
      warn_late_count: Math.max(1, Math.min(30, Number(s.attendance_warn_late_count ?? 3))),
      blame_late_count: Math.max(1, Math.min(60, Number(s.attendance_blame_late_count ?? 6))),
    };
  } catch {
    return defaults;
  }
}

registerSettingsRoutes(app, {
  authFailReason,
  cfGeo,
  checkConfirmPassword,
  clientIp,
  ensureSecurityTables,
  getConfig,
  getOwnerUsername,
  getPassword,
  getReputation,
  hashUserPassword,
  makeSessionProof,
  makeTokenV2,
  normalizePassword,
  parseToken,
  randomChallenge,
  readProfileFromDo,
  refreshLimitGate,
  requireBizMutator,
  requireOwner,
  resolveUserProfileAvatar,
  sessionUserFromHeader,
  setConfig,
  touchTrustedDevice,
  writeAudit,
  writeProfileToDo,
  ensureHrSettings,
  issueDeleteOtp,
});

registerCategoriesUnitsRoutes(app, { ensureCategoriesTable, ensureUnitsTable, checkConfirmPassword });

registerProductsScanRoutes(app, {
  sessionUserFromHeader,
  requireBizMutator,
  checkConfirmPassword,
  issueDeleteOtp,
  writeAudit,
  refreshLimitGate,
  readProductImageJson,
  productImageFailure,
  applyStockDelta,
  ensureCategoriesTable,
  ensureUnitsTable,
  ensureProductBulkDiscounts,
  tableColumns,
  hasColumn,
});

async function clientDeleteBlockers(db: D1Database, clientId: number | string): Promise<string | null> {
  const id = Number(clientId);
  if (!id) return null;
  try {
    const due = await db.prepare(
      `SELECT COALESCE(SUM(total - COALESCE(amount_paid, 0)), 0) AS due
       FROM invoices
       WHERE client_id = ?
         AND status NOT IN ('quote','devis','cancelled','remboursement')
         AND COALESCE(doc_kind,'') != 'remboursement'
         AND (total - COALESCE(amount_paid, 0)) > 0.001`,
    ).bind(id).first() as any;
    if (Number(due?.due || 0) > 0.001) {
      return `Solde client non nul (${Number(due.due).toFixed(2)}). Archivez le compte ou soldez les factures.`;
    }
  } catch { /* */ }
  try {
    const open = await db.prepare(
      `SELECT COUNT(*) AS n FROM invoices
       WHERE client_id = ?
         AND status IN ('sent','partial','overdue','quote','devis')`,
    ).bind(id).first() as any;
    if (Number(open?.n || 0) > 0) {
      return `Ce client a ${open.n} document(s) ouvert(s) (facture / devis). Suppression bloquée.`;
    }
  } catch { /* */ }
  try {
    const any = await db.prepare(
      `SELECT COUNT(*) AS n FROM invoices WHERE client_id = ? LIMIT 1`,
    ).bind(id).first() as any;
    if (Number(any?.n || 0) > 0) {
      return 'Historique de transactions lié à ce client — suppression définitive interdite. Utilisez l’archivage.';
    }
  } catch { /* */ }
  return null;
}

/* ─── Clients ─── */

/* clients routes → registerClientRoutes in routes/clients.ts */

registerCatalogRoutes(app, {
  ensureCatalogTables,
  readProductImageJson,
  productImageFailure,
  isAllowedImageUrl,
  keyFromCdnUrl,
  deleteR2Object,
  normalizeProductImageReference,
  isNormalizedProductUrl,
  migrateProductImagePage,
  afterBusinessMutation,
  sessionUserFromHeader,
  authFailReason,
  clientIp,
  getOwnerUsername,
  requireBizMutator,
});

/** Bound JSON reads even when Content-Length is absent or incorrect. */
async function readProductImageJson(c: any): Promise<any> {
  const reader = c.req.raw.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > PRODUCT_IMAGE_JSON_LIMIT) { await reader.cancel().catch(() => {}); throw new ProductImageError('PAYLOAD_TOO_LARGE'); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new ProductImageError('INVALID_IMAGE'); }
}

function productImageFailure(c: any, e: unknown) {
  const code = e instanceof ProductImageError ? e.code : 'STORAGE_UNAVAILABLE';
  const status = code === 'PAYLOAD_TOO_LARGE' ? 413 : code === 'INVALID_IMAGE' || code === 'UNSUPPORTED_SOURCE' || code === 'SOURCE_MISSING' ? 400 : 503;
  return c.json({ success: false, code, error: 'Image invalide ou stockage indisponible.' }, status);
}

/* catalog & public catalog routes → worker/routes/catalog.ts */

registerVendorRoutes(app, { requireBizMutator, checkConfirmPassword, writeAudit });

// Extracted ledger, stock, HMAC, and invoice helpers → ./lib/ledgerHelpers.ts
registerInvoicesWriteRoutes(app, {
  requireBizMutator,
  sessionUserFromHeader,
  checkConfirmPassword,
  writeAudit,
  ensureDocumentActors,
  ensureInvoiceItemPromoColumns,
  ensureInvoiceTaxExempt,
  ensureProductBulkDiscounts,
  ensureInvoiceRefundColumns,
  ensureInvoicePublicToken,
  ensureVoidColumns,
  ensurePaymentHistoryTable,
  ensureExpenseTypeColumn,
  ensureReceiptsTable,
  ensureStockMovementsTable,
  ensureHrSettings,
  extractIdempotencyKey,
  idempotencyGet,
  idempotencyPut,
  applyBulkDiscount,
  applyStockDelta,
  runAutoTransfers,
  archiveInvoiceSnapshot,
  assertPeriodOpen,
  roundDh,
  moroccoTodayStr,
  makePublicToken,
  makeSecureQrPayload,
  validateRefundReason,
  validateCreditPrefix,
  generateOTP,
  otpEmailHTML,
  getInvoiceLinks,
  cascadeDeleteInvoice,
});
/* ─── OTP email helper (generateOTP is defined once near top of file) ─── */

function otpEmailHTML(
  otp: string,
  resourceLabel: string,
  companyName: string,
  purpose: 'delete' | 'login' = 'delete',
  meta?: {
    ip?: string;
    ua?: string;
    fingerprint?: string;
    username?: string;
    verifyUrl?: string;
    language?: string;
  },
): string {
  const esc = (s: string) =>
    String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const safeOtp = esc(otp.trim());
  const safeResource = esc(resourceLabel);
  const safeCompany = esc(companyName || 'Atlas Commerce');
  const isLogin = purpose === 'login';
  const copy = otpCopy(meta?.language);
  const tag = isLogin ? copy.loginTag : copy.deleteTag;
  const h1 = isLogin ? copy.loginHeading : copy.deleteHeading;
  const intro = isLogin ? copy.loginIntro : `${copy.deleteIntro} (${safeResource})`;
  const ORANGE = '#c45c26'; /* terracotta Atlas */
  const LIGHT_TAG = '#9a461c';
  const DARK_SALMON = '#d4a017';
  const LIGHT_CANVAS = '#f4f4f5';
  const LIGHT_CARD = '#ffffff';
  const LIGHT_LINE = '#e4e4e7';
  const LIGHT_INK = '#09090b';
  const LIGHT_VAL = '#18181b';
  const LIGHT_GREY = '#52525b';
  const LIGHT_FAINT = '#71717a';
  const DARK_CANVAS = '#09090b';
  const DARK_CARD = '#18181b';
  const DARK_LINE = '#27272a';
  const DARK_INK = '#fafafa';
  const DARK_VAL = '#e4e4e7';
  const DARK_GREY = '#a1a1aa';
  const DARK_FAINT = '#71717a';
  const rows = [
    meta?.username ? [copy.account, esc(meta.username)] : null,
    meta?.ip ? [copy.ip, esc(meta.ip)] : null,
    meta?.ua ? [copy.device, esc(meta.ua.slice(0, 120))] : null,
    meta?.fingerprint ? [copy.fingerprint, esc(meta.fingerprint.slice(0, 24))] : null,
  ].filter(Boolean) as [string, string][];
  // tableau role=presentation : évite que Gmail colle libellé et valeur.
  const deviceBlock = rows.length
    ? `<div class="ac-mail-card" style="margin:24px 0 0;background:${LIGHT_CARD};border:1px solid ${LIGHT_LINE};border-radius:12px;padding:10px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows
        .map(
          ([k, v]) =>
            `<tr><td class="ac-mail-muted" style="padding:5px 14px 5px 0;font-size:12px;color:${LIGHT_GREY};white-space:nowrap;vertical-align:top;text-align:left">${k}</td><td class="ac-mail-val" style="padding:5px 0;font-size:12px;font-weight:600;color:${LIGHT_VAL};text-align:right;word-break:break-word">${v}</td></tr>`,
        )
        .join('')}</table></div>`
    : '';
  const button = meta?.verifyUrl
    ? `<a href="${esc(meta.verifyUrl)}" style="display:block;width:100%;box-sizing:border-box;background:${ORANGE};border-radius:10px;padding:16px 12px;text-align:center;color:#ffffff;font-size:15px;font-weight:800;letter-spacing:1.2px;text-decoration:none;text-transform:uppercase">${copy.button}</a>`
    : '';
  const social = (href: string, d: string) =>
    `<a href="${href}" style="display:inline-block;margin-left:14px;text-decoration:none"><svg width="17" height="17" viewBox="0 0 24 24" fill="#71717a" xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg></a>`;
  return `<!doctype html>
<html lang="${copy.lang}" dir="${copy.dir}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${safeOtp} — ${tag}</title>
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  .ac-logo-dark { display: none !important; }
  .ac-logo-light { display: block !important; }
  @media (prefers-color-scheme: dark) {
    .ac-mail-body, .ac-mail-canvas { background-color: ${DARK_CANVAS} !important; color: ${DARK_INK} !important; }
    .ac-mail-card { background-color: ${DARK_CARD} !important; border-color: ${DARK_LINE} !important; }
    .ac-mail-ink, .ac-otp-code { color: ${DARK_INK} !important; }
    .ac-mail-val { color: ${DARK_VAL} !important; }
    .ac-mail-muted { color: ${DARK_GREY} !important; }
    .ac-mail-faint { color: ${DARK_FAINT} !important; }
    .ac-mail-tag, .ac-mail-em { color: ${DARK_SALMON} !important; }
    .ac-logo-pill { background-color: ${DARK_CARD} !important; background-image: none !important; border-color: ${DARK_LINE} !important; }
    .ac-logo-light { display: none !important; }
    .ac-logo-dark { display: block !important; }
    .ac-mail-footer { background-color: #0b0b0d !important; border-top-color: ${DARK_LINE} !important; }
    .ac-mail-footer-ink { color: #a1a1aa !important; }
  }
  [data-ogsc] .ac-mail-body, [data-ogsc] .ac-mail-canvas, [data-ogsb] .ac-mail-body, [data-ogsb] .ac-mail-canvas { background-color: ${DARK_CANVAS} !important; color: ${DARK_INK} !important; }
  [data-ogsc] .ac-mail-card, [data-ogsb] .ac-mail-card { background-color: ${DARK_CARD} !important; border-color: ${DARK_LINE} !important; }
  [data-ogsc] .ac-mail-ink, [data-ogsc] .ac-otp-code { color: ${DARK_INK} !important; }
  [data-ogsc] .ac-mail-val { color: ${DARK_VAL} !important; }
  [data-ogsc] .ac-mail-muted { color: ${DARK_GREY} !important; }
  [data-ogsc] .ac-mail-faint { color: ${DARK_FAINT} !important; }
  [data-ogsc] .ac-mail-tag, [data-ogsc] .ac-mail-em { color: ${DARK_SALMON} !important; }
  [data-ogsc] .ac-logo-pill, [data-ogsb] .ac-logo-pill { background-color: ${DARK_CARD} !important; background-image: none !important; border-color: ${DARK_LINE} !important; }
  [data-ogsc] .ac-logo-light { display: none !important; }
  [data-ogsc] .ac-logo-dark { display: block !important; }
</style>
</head>
<body class="ac-mail-body" style="margin:0;padding:0;background-color:${LIGHT_CANVAS};font-family:-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:${LIGHT_INK}">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${copy.preheader}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
  <div class="ac-mail-canvas" style="background-color:${LIGHT_CANVAS};padding:28px 16px 24px">
    <div style="max-width:580px;margin:0 auto;text-align:center">
      <div class="ac-logo-pill" style="display:inline-block;padding:10px 18px;border-radius:14px;background-color:${LIGHT_CARD};background-image:linear-gradient(${LIGHT_CARD},${LIGHT_CARD});border:1px solid ${LIGHT_LINE}">
        <img src="https://stock.afmarbre.com/atlas-logo-light.png" alt="Atlas" class="ac-logo-light" width="148" height="48" style="display:block;height:36px;width:auto;max-width:100%;margin:0 auto" />
        <!--[if !mso]><!--><img src="https://stock.afmarbre.com/atlas-logo-dark.png" alt="Atlas" class="ac-logo-dark" width="148" height="48" style="display:none;height:36px;width:auto;max-width:100%;margin:0 auto" /><!--<![endif]-->
      </div>
      <div style="height:26px"></div>
      <div class="ac-mail-tag" style="font-size:12px;font-weight:800;letter-spacing:2px;color:${LIGHT_TAG};text-transform:uppercase">${tag}</div>
      <h1 class="ac-mail-ink" style="margin:12px 0 0;font-size:30px;line-height:1.2;font-weight:800;color:${LIGHT_INK}">${h1}</h1>
      <p class="ac-mail-muted" style="margin:16px auto 0;max-width:440px;font-size:15px;line-height:1.65;color:${LIGHT_GREY}">${intro}</p>
      <div class="ac-mail-card" style="margin:26px 0 0;background:${LIGHT_CARD};border:1px solid ${LIGHT_LINE};border-radius:14px;padding:24px 16px">
        <div class="ac-mail-muted" style="font-size:12px;font-weight:600;letter-spacing:0.6px;text-transform:uppercase;color:${LIGHT_GREY};margin-bottom:8px">${copy.code}</div>
        <code dir="ltr" class="ac-otp-code" style="font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:36px;font-weight:800;letter-spacing:6px;font-variant-numeric:tabular-nums;color:${LIGHT_INK};background:transparent;display:inline-block;user-select:all;-webkit-user-select:all">${safeOtp}</code>
      </div>
      ${button ? `<div style="margin:20px 0 0">${button}</div>` : ''}
      ${deviceBlock}
      <p class="ac-mail-muted" style="margin:24px auto 0;max-width:400px;font-size:14px;line-height:1.6;color:${LIGHT_GREY}">${copy.warning}</p>
      <p class="ac-mail-faint" style="margin:8px auto 0;max-width:440px;font-size:12px;line-height:1.6;color:${LIGHT_FAINT}">${copy.expiry} · ${safeCompany}</p>
    </div>
  </div>
  <div class="ac-mail-footer" style="background-color:${LIGHT_CARD};border-top:1px solid ${LIGHT_LINE};padding:26px 22px 24px;text-align:center">
    <div style="max-width:580px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div class="ac-mail-footer-ink" style="display:flex;align-items:center;gap:9px;font-size:18px;font-weight:800;color:${LIGHT_GREY}">Atlas</div>
        <div style="white-space:nowrap">${social('https://www.facebook.com/', 'M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12Z')}
${social('https://x.com/', 'M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.4 22H3.3l7.3-8.3L1 2h6.4l4.4 5.9L18.9 2Zm-1.1 18h1.7L7.7 3.9H5.9L17.8 20Z')}
${social('https://www.linkedin.com/', 'M20.4 20.4h-3.6v-5.6c0-1.3 0-3-1.9-3s-2.1 1.4-2.1 2.9v5.7H9.4V9h3.4v1.6h.1c.5-.9 1.6-1.9 3.4-1.9 3.6 0 4.3 2.4 4.3 5.5v6.2ZM5.3 7.4a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2Zm1.8 13H3.5V9h3.6v11.4Z')}
${social('https://www.youtube.com/', 'M23 12s0-3.9-.5-5.7c-.3-1-1.1-1.8-2.1-2.1C18.6 3.7 12 3.7 12 3.7s-6.6 0-8.4.5c-1 .3-1.8 1.1-2.1 2.1C1 8.1 1 12 1 12s0 3.9.5 5.7c.3 1 1.1 1.8 2.1 2.1 1.8.5 8.4.5 8.4.5s6.6 0 8.4-.5c1-.3 1.8-1.1 2.1-2.1.5-1.8.5-5.7.5-5.7ZM9.8 15.5v-7l6 3.5-6 3.5Z')}
${social('https://www.instagram.com/', 'M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.9.2 2.3.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1.1.4 2.3.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.2 1.9-.4 2.3-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1.1.4-2.3.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.9-.2-2.3-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1.1-.4-2.3-.1-1.3-.1-1.7-.1-4.9s0-3.6.1-4.9c.1-1.2.2-1.9.4-2.3.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1.1-.4 2.3-.4 1.3-.1 1.7-.1 4.9-.1Zm0 3.8a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm0 9.9a3.9 3.9 0 1 1 0-7.8 3.9 3.9 0 0 1 0 7.8Zm6.2-10.1a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0Z')}</div>
      </div>
      <div class="ac-mail-footer-ink" style="margin-top:20px;font-size:13px;color:${LIGHT_GREY}">
        <a href="https://stock.afmarbre.com/" style="color:inherit;text-decoration:underline">${copy.home}</a>
        <span style="margin:0 8px;opacity:0.45">|</span>
        <a href="https://stock.afmarbre.com/about" style="color:inherit;text-decoration:underline">${copy.about}</a>
        <span style="margin:0 8px;opacity:0.45">|</span>
        <a href="https://stock.afmarbre.com/whats-new" style="color:inherit;text-decoration:underline">${copy.news}</a>
        <span style="margin:0 8px;opacity:0.45">|</span>
        <a href="https://stock.afmarbre.com/privacy" style="color:inherit;text-decoration:underline">${copy.privacy}</a>
      </div>
      <div class="ac-mail-faint" style="margin-top:12px;font-size:12px;line-height:1.6;color:${LIGHT_FAINT}">Atlas — stock.afmarbre.com<br/>© ${new Date().getUTCFullYear()} Etherealmber · MIT ou Apache-2.0</div>
      <div style="margin-top:8px"><a href="https://stock.afmarbre.com/settings" class="ac-mail-footer-ink" style="font-size:12px;color:${LIGHT_GREY};text-decoration:underline">${copy.settings}</a></div>
    </div>
  </div>
</body>
</html>`;
}

/* v235 — OTP e-mail: Resend first (configured domain), then CF Email binding. Never throws. */
async function sendOtpMail(
  env: Env,
  opts: { to: string; from: string; subject: string; html: string; text: string },
): Promise<boolean> {
  const key = String((env as any).RESEND_API_KEY || '').trim();
  if (key) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: opts.from, to: [opts.to], subject: opts.subject, html: opts.html, text: opts.text }),
      });
      if (res.ok) return true;
      console.error('otp_resend_failed', res.status);
    } catch {
      console.error('otp_resend_error');
    }
  }
  if (env.EMAIL?.send) {
    console.log('[otp-mail] Resend unavailable or failed — using the CF Send-Email binding fallback');
    try {
      await env.EMAIL.send({ to: opts.to, from: opts.from, subject: opts.subject, html: opts.html, text: opts.text });
      return true;
    } catch {
      console.error('otp_binding_failed');
    }
  }
  if (!key && !env.EMAIL?.send) console.error('otp_transport_unconfigured');
  return false;
}

async function userMail(db: D1Database, username: string): Promise<string> {
  try {
    const row = (await db.prepare(`SELECT email FROM app_users WHERE username = ?`).bind(username).first()) as any;
    return String(row?.email || '').trim();
  } catch {
    return '';
  }
}

/** Store OTP, attempt email; never block deletion if email fails — return code as fallback. */
async function issueDeleteOtp(
  env: Env,
  resourceType: string,
  resourceId: string,
  resourceLabel: string,
  emailSubject: string,
  opts?: { toEmail?: string; language?: string },
): Promise<{ otp: string; emailed: boolean; to: string; message: string }> {
  await ensureSecurityTables(env.DB);
  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO otp_codes (code, resource_type, resource_id, expires_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(resource_type, resource_id) DO UPDATE SET code = ?, expires_at = ?, created_at = datetime('now')`
  ).bind(otp, resourceType, resourceId, expiresAt, otp, expiresAt).run();

  const settings = await env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const companyName = settings?.company_name || 'Atlas Commerce';
  const fromAddr = env.OTP_FROM || (env as any).RESEND_FROM || 'security@afmarbre.com';
  // v235 — send to the actual user when we know their address; never leak codes in production
  const isProd = String((env as any).ENVIRONMENT || '').toLowerCase() === 'production';
  const securityKind = resourceType === 'account-delete' || resourceType === 'agent-data';
  const toAddr =
    String(opts?.toEmail || '').trim() ||
    (securityKind ? await userMail(env.DB, resourceId) : '') ||
    env.OTP_TO ||
    'admin@afmarbre.com';

  const copy = otpCopy(opts?.language);
  const label = resourceType === 'agent-data'
    ? copy.lang === 'ar' ? 'حذف جميع محادثات Atlas Agent' : copy.lang === 'en' ? 'Delete all Atlas Agent conversations' : resourceLabel
    : resourceLabel;
  const sendPromise = sendOtpMail(env, {
    to: toAddr,
    from: fromAddr,
    subject: copy.lang === 'fr' ? emailSubject : `${copy.deleteTag} — ${label}`,
    html: otpEmailHTML(otp, label, companyName, 'delete', { language: opts?.language }),
    text: `${copy.deleteIntro} ${label}\n${copy.code}: ${otp}\n${copy.expiry}\n${copy.warning}`,
  });
  let emailed = false;
  try {
    emailed = await Promise.race([
      sendPromise,
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2500)),
    ]);
  } catch {
    emailed = false;
  }
  if (!emailed) {
    try {
      sendPromise.catch(() => { /* logged inside sendOtpMail */ });
    } catch { /* */ }
  }

  if (emailed) {
    return {
      otp: isProd ? '' : otp,
      emailed: true,
      to: toAddr,
      message: `Code envoyé à ${toAddr}. Vérifiez votre boîte de réception.`,
    };
  }
  if (isProd) {
    // SECURITY: never surface OTPs in API responses in production
    return {
      otp: '',
      emailed: false,
      to: '',
      message: 'E-mail indisponible. Vérifiez la configuration e-mail (Resend) ou contactez l’administrateur.',
    };
  }
  // Dev-only convenience: code visible so local flows are never blocked
  return {
    otp,
    emailed: false,
    to: toAddr,
    message: `E-mail indisponible. Utilisez ce code de confirmation : ${otp}`,
  };
}

async function verifyDeleteOtp(
  db: D1Database,
  resourceType: string,
  resourceId: string,
  otp: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  await ensureSecurityTables(db);
  if (!otp) return { ok: false, error: 'Code OTP obligatoire', status: 400 };
  const record = await db.prepare(
    `SELECT * FROM otp_codes WHERE resource_type = ? AND resource_id = ? ORDER BY created_at DESC LIMIT 1`
  ).bind(resourceType, resourceId).first() as any;
  if (!record) return { ok: false, error: 'Aucun code demandé. Veuillez d\'abord demander un code.', status: 400 };
  if (record.code !== otp) return { ok: false, error: 'Code incorrect', status: 400 };
  if (new Date(record.expires_at) < new Date()) {
    return { ok: false, error: 'Code expiré. Veuillez demander un nouveau code.', status: 400 };
  }
  return { ok: true };
}

registerBillsReceiptsRoutes(app, {
  requireBizMutator,
  sessionUserFromHeader,
  checkConfirmPassword,
  writeAudit,
  issueDeleteOtp,
  ensureDocumentActors,
  ensurePaymentHistoryTable,
  ensureExpenseTypeColumn,
  ensureReceiptsTable,
  ensureReceiptSituationColumn,
  ensureInvoicePublicToken,
  ensureQrPrivacySettings,
  extractIdempotencyKey,
  idempotencyGet,
  idempotencyPut,
  applyStockDelta,
  applyMovingAverageCost,
  assertPeriodOpen,
  roundDh,
  moroccoTodayStr,
  makePublicToken,
  makeSecureQrPayload,
  createAtlasTimestampToken,
  documentIntegrityHash,
  invoiceDocHashPayload,
  sha256Hex,
  validateStoredSignature,
  generateOTP,
  otpEmailHTML,
  expensesLinkedToReceipt,
  cascadeDeleteInvoice,
});
/* ─── Expenses / Incomes (ledger entries) ─── */

async function ensureExpenseTypeColumn(db: D1Database) {
  await schemaOnce('ensureExpenseTypeColumn', async () => {
  await addColumnIfMissing(db, 'expenses', 'entry_type', `TEXT DEFAULT 'expense'`);

  });
}

app.get('/api/expenses', async (c) => {
  const role = normalizeInventoryRole(sessionUserFromHeader(c.req.header('Authorization'))?.role);
  if (!roleCanSeeFinancial(role)) {
    return c.json({ success: false, error: 'Accès réservé owner/admin.', code: 'FORBIDDEN_ROLE' }, 403);
  }
  if (hasLiveCache(c.env)) {
    const hit = await doCacheGet<any[]>(c.env.MOBILE_HUB, c.env.CACHE, 'expenses:list', 300);
    if (hit) return c.json({ success: true, data: hit, cached: true });
  }
  await ensureExpenseTypeColumn(c.env.DB);
  const { results: rawExpenses } = await c.env.DB.prepare(`SELECT * FROM expenses ORDER BY expense_date DESC, created_at DESC`).all();
  // « Créé par » : a transaction generated by an invoice / quick sale / receipt / bill carries that document's creator.
  const results = await withLedgerCreators(c.env.DB, (rawExpenses || []) as any[]);
  if (hasLiveCache(c.env)) {
    await doCachePut(c.env.MOBILE_HUB, c.env.CACHE, 'expenses:list', results || [], 300);
  }
  return c.json({ success: true, data: results });
});

/* v264 — ledger writes moved to routes/expenses.ts with EXPLICIT owner/admin
 * authorization (audit fix: these two routes previously sat behind the generic
 * /api/* auth middleware only, so any authenticated role could insert ledger
 * rows — including owner_contrib/owner_draw movements). Behavior, response
 * shapes and French messages are unchanged; see __tests__/expenses-auth.test.ts. */
/* v0.7.1 — stock-adjustment approval workflow (role-gated, audited). */
registerWorkStatusRoute(app, { session: sessionUserFromHeader, ownerUsername: getOwnerUsername });
registerSnakeScoreRoutes(app, { session: sessionUserFromHeader, ownerUsername: getOwnerUsername });
registerMobilePreferencesRoutes(app, { session: sessionUserFromHeader, ownerUsername: getOwnerUsername, ensureSecurityTables });

registerStockAdjustmentRoutes(app, {
  session: (c) => {
    const s = sessionUserFromHeader(c.req.header('Authorization'));
    return s?.username ? { username: s.username, role: s.role } : null;
  },
  freshRole: async (db, username) => {
    const row = (await db.prepare(`SELECT role FROM users WHERE lower(username) = lower(?)`).bind(username).first()) as any;
    return row?.role || null;
  },
  audit: (db, e) => writeAudit(db, e),
});

async function ensureCategoriesTable(db: D1Database) {
  await schemaOnce('product_categories', async () => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS product_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
  for (const lang of ['fr', 'en', 'ar']) await addColumnIfMissing(db, 'product_categories', `name_${lang}`, "TEXT NOT NULL DEFAULT ''");
  const catalogColumns = await db.prepare(`PRAGMA table_info(product_categories)`).all();
  const catalogColumnNames = new Set((catalogColumns.results || []).map((row: any) => row.name));
  if (!['name_fr', 'name_en', 'name_ar'].every(column => catalogColumnNames.has(column))) throw new Error('Catalog language schema unavailable');
  const count = await db.prepare(`SELECT COUNT(*) as c FROM product_categories`).first() as any;
  if (!Number(count?.c || 0)) {
    for (const cat of DEFAULT_CATEGORIES) {
      try {
        await db.prepare(
          `INSERT INTO product_categories (name, description, sort_order) VALUES (?, ?, ?)`
        ).bind(cat.name, cat.description, cat.sort_order).run();
      } catch { /* unique race */ }
    }
  }
  });
}

async function ensureUnitsTable(db: D1Database) {
  await schemaOnce('product_units', async () => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS product_units (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      symbol TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
  for (const lang of ['fr', 'en', 'ar']) await addColumnIfMissing(db, 'product_units', `name_${lang}`, "TEXT NOT NULL DEFAULT ''");
  const catalogColumns = await db.prepare(`PRAGMA table_info(product_units)`).all();
  const catalogColumnNames = new Set((catalogColumns.results || []).map((row: any) => row.name));
  if (!['name_fr', 'name_en', 'name_ar'].every(column => catalogColumnNames.has(column))) throw new Error('Catalog language schema unavailable');
  const count = await db.prepare(`SELECT COUNT(*) as c FROM product_units`).first() as any;
  if (!Number(count?.c || 0)) {
    for (const u of DEFAULT_UNITS) {
      try {
        await db.prepare(
          `INSERT INTO product_units (name, symbol, sort_order) VALUES (?, ?, ?)`
        ).bind(u.name, u.symbol, u.sort_order).run();
      } catch { /* unique race */ }
    }
  }
  });
}

/** Catalog public site tables (settings + per-product catalog flags). */
async function ensureCatalogTables(db: D1Database) {
  await schemaOnce('catalog', async () => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS catalog_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      site_title TEXT DEFAULT '',
      site_tagline TEXT DEFAULT '',
      public_base_url TEXT DEFAULT '',
      show_prices INTEGER DEFAULT 1,
      show_stock INTEGER DEFAULT 0,
      contact_email TEXT DEFAULT '',
      contact_phone TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
  const row = await db.prepare(`SELECT id FROM catalog_settings WHERE id = 1`).first();
  if (!row) {
    await db.prepare(`
      INSERT OR IGNORE INTO catalog_settings (id, site_title, site_tagline, show_prices, show_stock)
      VALUES (1, 'Catalogue', '', 1, 0)
    `).run();
  }
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS product_catalog (
      product_id INTEGER PRIMARY KEY,
      slug TEXT,
      short_description TEXT DEFAULT '',
      long_description TEXT DEFAULT '',
      is_public INTEGER DEFAULT 0,
      is_featured INTEGER DEFAULT 0,
      published_at TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_product_catalog_public ON product_catalog(is_public)`).run();
  } catch { /* ignore */ }
  await addColumnIfMissing(db, 'products', 'is_public', 'INTEGER DEFAULT 0');
  await addColumnIfMissing(db, 'products', 'short_description', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'products', 'slug', 'TEXT');
  });
}

/** v0.7.1 — les liens d'un aperçu naviguent DANS le popup (iframe), jamais un nouvel onglet. */
function previewEmbed(html: string): string {
  const tag =
    `<base target="_self">` +
    `<script>document.addEventListener('click',function(ev){var t=ev.target;var a=t&&t.closest?t.closest('a'):null;if(a){a.removeAttribute('target');}},true);</script>`;
  return html.includes('<head>') ? html.replace('<head>', '<head>' + tag) : tag + html;
}

registerDeviceRoutes(app, {
  sessionUserFromHeader,
  authFailReason,
  clientIp,
  ensureSecurityTables,
  touchTrustedDevice,
  deviceLabelFromUA,
  cfGeo,
  writeAudit,
});

registerDocPreviewRoutes(app, {
  requireEmployeeAdmin,
  sessionUserFromHeader,
  authFailReason,
  generateInvoiceHTML,
  generateReceiptHTML,
  generateEmployeeFormHTML,
  reportShell,
  qrToSvg,
  makeSecureQrPayload,
  previewEmbed,
  mintPreviewReportTicket: async (c: any) => {
    const queryToken = String(c.req.query('token') || '').replace(/ /g, '+');
    const result = await verifyArchiveIdentity(c.env, c.req.header('Authorization') || (queryToken ? `Bearer ${queryToken}` : undefined), clientIp(c), undefined, {
      authFailReason: (header, env, db, ip, fp) => authFailReason(header, env as Env, db, ip, fp, { relaxSession: true }),
      sessionUserFromHeader,
      ownerUsername: env => getOwnerUsername(env as Env),
    });
    if (!result.ok) throw new Error('Report access denied');
    return (await mintScopedReportTicket(reportTicketEnvironment(c.env), result.identity as any, getOwnerUsername(c.env))).rt;
  },
  buildReportLinkQuery,
});

registerExpenseWriteRoutes(app, {
  sessionUserFromHeader, authFailReason, clientIp, ensureExpenseTypeColumn,
  invalidateDashboardCache, writeAudit,
});

registerLedgerMiscRoutes(app, {
  checkConfirmPassword,
  ensureExpenseTypeColumn,
  requireBizMutator,
  sessionUserFromHeader,
});
/* ─── Import ledger (CSV/JSON from Excel templates) ─── */
/* v264 — POST /api/expenses/import: moved to routes/expenses.ts (owner/admin gate). */

/** Short-lived signed ticket for printable report deep-links (not a session JWT). */
function reportTicketEnvironment(env: Env) {
  return { DB: env.DB, JWT_SECRET: env.JWT_SECRET, ADMIN_PASSWORD: getPassword(env) || undefined, REPORT_TICKET_TTL_SECONDS: env.REPORT_TICKET_TTL_SECONDS };
}

async function verifyReportLinkTicket(env: Env, ticket: string | null | undefined, path: string): Promise<boolean> {
  if (!ticket) return false;
  const printOk = path === '/api/employees/form/print' ||
    /^\/api\/employees\/\d+\/form\/print$/.test(path) ||
    /^\/api\/(?:invoices|bills|receipts)\/\d+\/(?:print|pdf)$/.test(path) ||
    path === '/api/settings/invoice-preview' || path.startsWith('/api/attendance/export');
  return printOk && await verifyScopedPrintTicket(reportTicketEnvironment(env), ticket, getOwnerUsername(env));
}

registerInventoryOpsRoutes(app, {
  requireOwner,
  requireBizMutator,
  requireFloorStock,
  sessionUserFromHeader,
  applyStockDelta,
  ensureValuationTables,
  getValuationMethod,
  runAutoTransfers,
  ensureBillPaymentsTable,
  ensurePaymentHistoryTable,
});
async function ensureCoreIndexes(db: D1Database) {
  await schemaOnce('core_indexes', async () => {
    const stmts = [
      `CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status)`,
      `CREATE INDEX IF NOT EXISTS idx_invoices_doc_kind ON invoices(doc_kind)`,
      `CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date)`,
      `CREATE INDEX IF NOT EXISTS idx_bills_status ON bills(status)`,
      `CREATE INDEX IF NOT EXISTS idx_bills_receive_status ON bills(receive_status)`,
      `CREATE INDEX IF NOT EXISTS idx_products_active_track ON products(is_active, track_inventory)`,
      `CREATE INDEX IF NOT EXISTS idx_stock_movements_prod_created ON stock_movements(product_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name)`,
      // Same as migrations/0023 — for databases that skipped it.
      `CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id)`,
      `CREATE INDEX IF NOT EXISTS idx_invoices_created ON invoices(created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_bills_vendor ON bills(vendor_id)`,
      `CREATE INDEX IF NOT EXISTS idx_receipts_invoice ON receipts(invoice_id)`,
    ];
    for (const sql of stmts) {
      try { await db.prepare(sql).run(); } catch { /* table may not exist yet */ }
    }
  });
}

function refreshLimitGate(c: any, endpoint: string, maxPerMinute = 45): Response | null {
  const ip = clientIpFromRequest(c);
  const user = sessionUserFromHeader(c.req.header('Authorization')).username || 'anon';
  const rl = checkRefreshLimit(`refresh:${endpoint}:${user}:${ip}`, maxPerMinute);
  if (!rl.ok) {
    c.header('Retry-After', String(rl.retryAfter));
    return c.json(
      {
        success: false,
        code: 'REFRESH_LIMIT',
        error: 'Trop d’actualisations en peu de temps. Patientez quelques secondes.',
        retry_after: rl.retryAfter,
      },
      429,
    );
  }
  c.header('X-RefreshLimit-Remaining', String(rl.remaining));
  return null;
}

registerMetricsRoutes(app, { sessionUserFromHeader, refreshLimitGate });
registerDashboardIntegrityRoutes(app, {
  requireOwner,
  requireBizMutator,
  requireEmployeeAdmin,
  requireFloorStock,
  sessionUserFromHeader,
  refreshLimitGate,
  ensureCoreIndexes,
  ensurePaymentHistoryTable,
  ensureExpenseTypeColumn,
  ensureBillPaymentsTable,
  ensureIdempotencyTable,
  ensurePeriodLockColumn,
  ensureInvoiceRefundColumns,
  ensureValuationTables,
  getValuationMethod,
  runAutoTransfers,
  applyStockDelta,
});
/* ─── Printable reports (open in browser → Enregistrer en PDF) ─── */

registerReportRoutes(app, {
  reportTicketEnvironment,
  authFailReason,
  sessionUserFromHeader,
  getOwnerUsername,
  getPassword,
  parseToken,
  clientIp,
  ensureStockLocations,
  ensureExpenseTypeColumn,
  ensureReceiptsTable,
  ensureValuationTables,
  getValuationMethod,
});

registerAssistRoutes(app, {
  authFailReason,
  sessionUserFromHeader,
  clientIp,
  requireOwner,
  requireOwnerOrAdmin,
  writeAudit,
  issueDeleteOtp,
  verifyDeleteOtp,
  userMail,
  syncMobileHub,
  notifyAssistApproval,
});
async function notifyAssistApproval(env: Env, username: string, title: string, body: string, data?: Record<string, string>) {
  return fcmNotifyAssistApproval(env as any, username, title, body, data);
}




/** Register Android FCM device token (upsert into D1). */
// v0.7 — extracted to worker/routes/deviceToken.ts (safe error codes, tested)
registerDeviceTokenRoutes(app, sessionUserFromHeader);


/**
 * Android APK update check (no app change needed beyond existing client).
 * Manifest from R2: app-updates/android/latest.json
 * Fallback app_config keys: android_update_*
 * Example JSON:
 * { "versionCode": 10, "versionName": "0.9.4", "apkUrl": "https://cdn.../atlas.apk", "mandatory": false, "notes": "..." }
 */
app.route('/', androidReleaseRouter);
app.route('/', desktopReleaseRouter);

/* ────────────────────────────────────────────────────────────────────────────
 * App update management (owner/admin only) — Cloudflare R2 `IMAGES` bucket:
 *   app-updates/android/latest.json  (manifest read by the APK update check)
 *   app-updates/android/latest.apk   (binary served via the CDN custom domain)
 * The public read-only check above stays untouched; these routes only write.
 * ────────────────────────────────────────────────────────────────────────── */
// App-update admin routes registered via worker/routes/reportsAndUpdates.ts
registerProductRequestRoutes(app, {
  productImageFailure,
  readProductImageJson,
  sessionUserFromHeader,
  writeAudit,
});

registerBackupRoutes(app, {
  requireOwner,
  hmacSha256Hex,
  writeAudit,
  purgeAgentConversationsOlderThan,
});

registerDataImportRoutes(app, { requireBizMutator, ensureExpenseTypeColumn });

/* ── Employee attendance (pointage) → worker/routes/attendance.ts ── */
function moroccoTodayStr(): string {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Casablanca' });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

registerAttendanceRoutes(app, {
  requireEmployeeAdmin,
  ensureHrSettings,
  ensureEmployeeTeamColumn,
  loadAttendanceRules,
  schemaOnce,
  addColumnIfMissing,
  reportShell,
  moroccoTodayStr,
});

registerExportRoutes(app, {
  roundDh,
  sessionUserFromHeader,
  requireOwner,
  ensureExpenseTypeColumn,
  ensurePaymentHistoryTable,
});

/* ─── SPA Fallback ─── */


registerMobileActionsRoutes(app, {
  schemaOnce,
  refreshLimitGate,
  readProductImageJson,
  productImageFailure,
  normalizeProductImageReference,
  sessionUserFromHeader,
  syncMobileHub,
  syncMobileHubPending,
  applyStockDelta,
  notifyAssistApproval,
  requireBizMutator,
  requireFloorStock,
});

/** Digital Asset Links for Android passkeys / App Links (all OEMs). */
app.get('/.well-known/assetlinks.json', async (c) => {
  const fps = [
    // Release keystore atlas-commerce-release.jks (alias atlas)
    '53:D0:74:2C:A3:34:22:36:58:E1:D7:F8:8C:DC:67:C5:4D:B0:AC:4E:17:88:59:DA:13:2D:4A:9F:30:62:65:6E',
    // Previous / debug fingerprint (keep for older installs)
    'FC:CC:F6:C3:B2:3D:B8:BE:1D:74:AF:BE:D5:04:DA:EA:5F:5D:FF:AF:8C:6F:C4:5A:F8:F0:2B:6A:C8:87:6C:C1',
  ];
  const body = [
    {
      relation: [
        'delegate_permission/common.handle_all_urls',
        'delegate_permission/common.get_login_creds',
      ],
      target: {
        namespace: 'android_app',
        package_name: 'ma.etherealmber.atlascommerce.debug',
        sha256_cert_fingerprints: fps,
      },
    },
    {
      relation: [
        'delegate_permission/common.handle_all_urls',
        'delegate_permission/common.get_login_creds',
      ],
      target: {
        namespace: 'android_app',
        package_name: 'ma.etherealmber.atlascommerce',
        sha256_cert_fingerprints: fps,
      },
    },
  ];
  return c.json(body, 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=60',
  });
});


registerEmployeeFormPrintRoutes(app, requireEmployeeAdmin);

export { MobileHub, RestoreHub, NumberHub };
export { JournalBuffer } from './durable/JournalBuffer';

/* Mailbox module removed (v240): signed deep-links + CF Email Routing inbound deleted. */

/* ─── SPA asset catch-all (MUST be last so specific /api/* routes win) ─── */
app.get('*', async (c) => {
  const url = new URL(c.req.url);

  // Safety net: never serve SPA HTML for an API path that somehow missed its route
  if (url.pathname.startsWith('/api/')) {
    return c.json(
      { success: false, error: 'Endpoint API introuvable', code: 'NOT_FOUND' },
      404
    );
  }

  // Fix mistaken relative asset paths under /m/* → /assets/*
  if (url.pathname.startsWith('/m/assets/')) {
    url.pathname = url.pathname.replace(/^\/m\/assets\//, '/assets/');
    return c.redirect(url.pathname + url.search, 302);
  }
  if (!c.env.ASSETS) {
    return c.text('Assets binding missing — run npm run build && wrangler deploy', 500);
  }
  const assetResponse = await c.env.ASSETS.fetch(c.req.raw);
  if (assetResponse.ok || assetResponse.status < 500) return assetResponse;

  // Cloudflare Pages/Workers assets can briefly return a 5xx for a history
  // route such as /m or /m/invoice. These are SPA routes, so retry the
  // immutable shell directly instead of returning an opaque 503 to mobile.
  const shellUrl = new URL('/index.html', c.req.url);
  return c.env.ASSETS.fetch(new Request(shellUrl.toString(), {
    method: 'GET',
    headers: c.req.raw.headers,
  }));
});

export default {
  /**
   * v254 — Daily finance reminders (wrangler triggers.crons: 35 7 * * *).
   * Idempotent by construction: runFinanceReminders enqueues into the durable
   * finance_outbox (UNIQUE tenant|event|period|recipient key), so re-runs,
   * worker restarts and duplicate triggers can never double-notify. Delivery
   * failures stay 'pending' with exponential backoff (max 5 attempts).
   */
  async scheduled(event: any, env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      await ensureAutoSqlMigrations(env.DB);
    } catch (e) {
      console.error('[cron-migrations] auto schema failed:', String((e as any)?.message || e));
    }
    try {
      const report = await runFinanceReminders(env);
      console.log('[cron-finance]', JSON.stringify(report));
    } catch (e) {
      // Never throw from the cron handler — the next run drains the outbox.
      console.error('[cron-finance] reminders failed:', String((e as any)?.message || e));
    }
    // v260 — drain queued crash/user reports to GitHub once a token exists.
    try {
      const r = await retryPendingReports(env as any);
      if (!r.skipped && (r.crashes || r.user_reports)) console.log('[cron-reports]', JSON.stringify(r));
    } catch (e) {
      console.error('[cron-reports] retry failed:', String((e as any)?.message || e));
    }
    // Part 6 — daily unpaid invoice dunning (Email / RESEND_API_KEY + dedup)
    try {
      const dun = await runDailyDunning(env as any);
      if (!dun.skipped) console.log('[cron-dunning]', JSON.stringify(dun));
    } catch (e) {
      console.error('[cron-dunning] failed:', String((e as any)?.message || e));
    }
  },

  /**
   * Email Routing inbound — accept and discard quietly.
   *
   * Without this export, ANY email Cloudflare routes to the worker (a reply,
   * a bounce, or an OTP mail sent through the Send-Email binding that loops
   * back through a catch-all rule on our own domain) dies with
   * "Handler does not export an email() function". The Mailbox feature is
   * gone, so inbound mail has no job here: log one line and consume it.
   */
  async email(message: any, _env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      console.log(
        '[email-event] inbound mail received and discarded:',
        String(message?.from || '?'),
        '->',
        String(message?.to || '?'),
      );
    } catch { /* never throw from an event handler */ }
  },

  /**
   * Explicit fetch entry — guarantees /api/* is always handled by Hono and
   * never falls through to the SPA assets layer (the root cause of the
   * "API returned HTML instead of JSON" error).
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // CDN1 mirror paths (APK + manifest + HEAD latency pings) when cdn1
    // traffic reaches the worker: serve straight from R2, HEAD via head().
    if (url.pathname.startsWith('/app-updates/')) {
      return serveAppUpdatesAsset(request, env);
    }
    // Force every API path through the Hono app. If something goes wrong,
    // still return JSON so the service worker / front-end never see HTML.
    if (url.pathname.startsWith('/api/')) {
      try {
        // Demo sandbox (« test / test »): same app, isolated SQLite database.
        const demo = await handleDemoRequest(
          request,
          env,
          ctx,
          (req, demoEnv, demoCtx) => app.fetch(req, demoEnv, demoCtx),
          (e, token, ip, native) => verifyTurnstile(e, token, ip, { native }),
        );
        if (demo) return demo;
        return await app.fetch(request, env, ctx);
      } catch (err: any) {
        if (!url.pathname.startsWith('/api/reports/') && !url.pathname.startsWith(`${NATIVE_V2}/`) && !url.pathname.startsWith(`${NATIVE_V3}/`)) console.error('api_fetch_fatal', String(err?.message || err));
        return new Response(
          JSON.stringify({
            success: false,
            error: url.pathname.startsWith('/api/reports/') ? 'Rapport indisponible' : (url.pathname.startsWith(`${NATIVE_V2}/`) || url.pathname.startsWith(`${NATIVE_V3}/`)) ? 'Connexion indisponible' : String(err?.message || 'Erreur interne').slice(0, 300),
            code: 'INTERNAL_ERROR',
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
    // Non-API: normal Hono routing (includes the SPA asset catch-all)
    return app.fetch(request, env, ctx);
  },
  // Cloudflare Email Routing → Worker. Requires the catch-all rule in the
  // Cloudflare dashboard (Email → Email Routing → Routing rules) to be set
  // to "Send to a Worker" → this Worker. That dashboard step is separate
  // from this code and won't happen automatically on deploy.
  // Free plan: no Cron Triggers (Error 10072). Use POST /api/cron/backup-execute instead.
};
