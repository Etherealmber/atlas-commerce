import { REPORT_TICKET_PATHS, mintScopedReportTicket, verifyScopedReportTicket, mintScopedPrintTicket, verifyScopedPrintTicket } from './lib/report-ticket';
import { verifyArchiveIdentity } from './lib/finance-report-archive-validation';
import { readBalanceReport, balanceIsIncome } from './lib/report-balance';
import { registerMobilePreferencesRoutes } from './routes/mobilePreferences';
import { migrateProductImagePage, normalizeProductImageReference, isNormalizedProductUrl, ProductImageError } from './lib/product-images';
import { recordReportOwner } from './lib/report-ownership';
import { ensureProductActors, ensureMovementApprover, withInventoryActors } from './lib/inventory-actors';
import { registerSnakeScoreRoutes } from './routes/snakeScore';
import { registerWorkStatusRoute } from './routes/workStatus';
import { Hono } from 'hono';
import { isQuickSaleIntent } from './lib/quick-assist-intent';
import { schemaOnce } from './lib/schema';
import { addColumnIfMissing } from './lib/schema';
import {
  atlasQrImg,
  ensureDocAssetColumns,
  generateReceiptHTMLMinimal,
  generateReceiptHTML,
  REFUND_POLICY_TEXT,
  generateEmployeeFormHTML,
  generateInvoiceHTML,
  notifyClientDocument,
  generateInvoiceEmailHTML,
  registerEmployeeFormPrintRoutes,
} from './lib/printTemplates';
import { hasCredentialAttemptBudget, reserveCredentialAttempt, type CredentialAttemptPurpose } from './lib/credential-attempt-limits';
import { cors } from 'hono/cors';
import PostalMime from 'postal-mime';
import type { Env } from './env';
import { buildInvoicePdf } from './pdf';
import { buildInvoicePdfLib } from './pdf-lib-invoice';
import { buildUblInvoiceXml, invoiceToUblInput, validateUblInvoice } from './ubl';
import { sendSms, whatsappDeepLink, documentSmsBody } from './sms';
import {
  kvGetJson,
  kvPutJson,
  doCacheGet,
  doCachePut,
  checkRefreshLimit,
  invalidateDashboardCache,
  dashboardCacheKey,
  settingsCacheKey,
  productsCacheKey,
  DEFAULT_CACHE_TTL,
  getCacheGen,
} from './lib/cache';
import { nextDocumentNumber } from './lib/numbering';
import {
  uploadDataUrlImage,
  companyAssetKey,
  keyFromCdnUrl,
  deleteR2Object,
  publicImageUrl,
} from './lib/r2';
import {
  rateLimit,
  assertSafeOutboundUrl,
  isAllowedImageUrl,
  clientIpFromRequest,
  normalizeIp,
  escapeHtml,
  safeImageSrc,
} from './lib/security';
import { canMutateBusiness, canHardDeleteStock, normalizeRole } from './lib/rbac';
import { apiFail, apiOk } from './lib/api-response';
import { toClientError, AppError } from './lib/errors';
import { repairProductSearchIndex, proactiveFtsHealth } from './lib/reliability';
import { androidReleaseRouter, serveAppUpdatesAsset } from './routes/androidRelease';
import { registerDeviceTokenRoutes } from './routes/deviceToken';
import { registerDesktopAuthRoutes, isDesktopAuthPath, isPublicDesktopAuthPath, DESKTOP_AUTH } from './routes/desktopAuth';
import { registerDesktopNativeDiscovery, DESKTOP_NATIVE_V2_CAPABILITIES, DESKTOP_NATIVE_V3_CAPABILITIES } from './routes/desktopNativeDiscovery';
import { registerDesktopPilotWebView, EMBEDDED_CHALLENGE_PATH, EMBEDDED_CHALLENGE_CSP } from './lib/desktop-pilot-webview';
import { registerDesktopNativeV2, isNativeV2Operation, NATIVE_V2 } from './routes/desktopNativeV2';
import { parseNativePilotToken, validateNativePilotToken } from './lib/desktop-native-session';
import {
  androidMinVersionGuard,
  manifestWithPolicy,
  readMinVersionPolicy,
  validateMinVersionPolicy,
  writeMinVersionPolicy,
  parseMinVersionPolicy,
  type MinVersionPolicy,
} from './lib/app-update-policy';
import { fetchWithTimeout } from './lib/http-client';
import { searchProducts, reliabilityStatus, ensureProductSearchIndex, reliableFetch } from './lib/reliability';
import { detectBffSurface } from './lib/bff';
import { enqueue } from './lib/job-queue';
import { ensureMailSchema } from './routes/mailbox';
import { ensureClientTaxExempt, ensureClientCreditLimit, checkClientCreditLimit } from './lib/clients-schema';
import { validateClientWrite, validateProductWrite, validateInvoiceWrite, validateVendorWrite, validateExpenseWrite, validateReceiptWrite, validateBillWrite } from './lib/validate';
import {
  deleteProductImagesFromR2,
  afterBusinessMutation,
  listR2Prefix,
} from './lib/delete-coord';
import { icebergCatalogInfo } from './lib/iceberg';
import {
  listAllToolNames,
  listAllToolsMeta,
  toolsForRole,
  buildNextActions,
  runAssistTool,
  auditAssist,
} from './lib/agent';
import { geminiSimpleChat, atlasAgentSystem, scrubVendorNames, normalizeResponseLanguage } from './lib/gemini-assist';
import { pickUiLang, tr } from './lib/error-i18n';
import { tokenraChat } from './lib/tokenra-assist';
import { groqChat, groqChatStream, groqChatStreamWithTools, groqChatWithTools, proposalsFromToolTrace, type AgentToolTrace, type AgentToolResult } from './lib/groq-assist';
import {
  loadAgentKnowledge,
  addMemory,
  deleteMemory,
  setContext,
  addGuardrail,
  setGuardrailActive,
  deleteGuardrail,
  setToolPref,
  addDoc,
  deleteDoc,
  retrieveKnowledge,
  knowledgePromptSections,
  KNOWLEDGE_TOOL_DEFS,
} from './lib/agent-knowledge';
import { parseAgentDocumentsAsync, agentDocumentPromptSection } from './lib/agent-docs';
import {
  upsertDeviceToken,
  notifyAssistApproval as fcmNotifyAssistApproval,
  notifyLowStock as fcmNotifyLowStock,
  sendFcmToUser as fcmSendToUser,
} from './lib/fcm';
import { MobileHub } from './durable/MobileHub';
import { AgentQuotaHub } from './durable/AgentQuotaHub';
export { AgentQuotaHub };
import { RestoreHub } from './durable/RestoreHub';
import { NumberHub } from './durable/NumberHub';
import {
  registerAdminReadRoutes,
  registerInvoiceReadRoutes,
  registerStockReadRoutes,
  registerWholesaleRoutes,
  registerEmployeeRoutes,
  registerPublicRoutes,
  registerClientRoutes,
  registerMailboxRoutes,
  registerPartnerV1Routes,
  registerAtlasV209Routes,
  registerFinanceRoutes,
  registerExpenseWriteRoutes,
  registerVendorRoutes,
  registerExportRoutes,
  registerMobileActionsRoutes,
  registerAttendanceRoutes,
  registerCatalogRoutes,
  registerCategoriesUnitsRoutes,
  registerDataImportRoutes,
  registerBackupRoutes,
  purgeExpiredBackups,
  makeVerifyBackupAccess,
  registerReportRoutes,
  reportShell,
  registerInventoryOpsRoutes,
  ensureMarbleUnits,
  ensureStockLocations,
  placeProductStockOnDefault,
  getDefaultLocationId,
  adjustLocationStock,
  ensureBillReceive,
  registerAssistRoutes,
  purgeAgentConversationsOlderThan,
  registerReportsAndUpdatesRoutes,
  readAppUpdateState,
  registerPublicSignedRoutes,
  ensureReceiptPublicToken,
  renderPublicReceiptVerify,
  registerProductsScanRoutes,
  registerDashboardIntegrityRoutes,
  registerInvoicesWriteRoutes,
  registerBillsReceiptsRoutes,
  ensureBillPaymentsTable,
} from './routes';
import { countEmployeesPayDue } from './routes/employees';
import { registerStockAdjustmentRoutes } from './routes/stockAdjustments';
import { registerDeviceRoutes } from './routes/devices';
import { registerDocPreviewRoutes } from './routes/docPreviews';
import { DEFAULT_CATEGORIES, DEFAULT_UNITS } from './lib/product-defaults';
import {
  normalizeInventoryRole,
  roleCanDirectAdjustStock,
  roleCanSeeFinancial,
  roleCanSeeSellPrices,
  scrubProductForRole,
  deviceLabelFromUA,
} from './lib/inventory-policy';
import { localTodayYmd, notifyPaymentRecorded, runFinanceReminders } from './lib/finance';
import { buildReportLinkQuery, computePeriodBounds } from './lib/report-period';
import {
  consumeChallenge as waConsumeChallenge,
  createChallenge as waCreateChallenge,
  androidLegacyOrigin,
  androidOrigin,
  androidOrigins,
  credentialDescriptors,
  expectedOrigin,
  parseClientData,
  policyFromEnv,
  userHandleFor,
  verifyAuthentication,
  verifyRegistration,
  type WebAuthnPolicy,
} from './lib/webauthn';
import {
  ensureReportTables,
  githubConfig,
  listReports,
  reportCrash,
  reportUser,
  retryPendingReports,
  saveGithubConfig,
  validateGithubToken,
  REPORTS_REPO_DEFAULT,
} from './lib/reports';
import { qrToSvg } from './qrSvg';

/** Signed short-lived tokens for external viewers (Google / Microsoft) — works across Worker isolates. */
function b64urlBytes(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]!);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function b64urlJson(obj: unknown): string {
  return b64urlBytes(new TextEncoder().encode(JSON.stringify(obj)));
}
async function mailPreviewSecret(env: any): Promise<string> {
  return String(env.MAIL_PREVIEW_SECRET || env.JWT_SECRET || env.BACKUP_TOKEN || env.RESEND_API_KEY || 'atlas-mail-preview').slice(0, 128);
}
async function signMailPreviewToken(
  env: any,
  data: { key: string; filename: string; contentType: string; exp: number },
): Promise<string> {
  const payload = b64urlJson(data);
  const secret = await mailPreviewSecret(env);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(payload));
  return `${payload}.${b64urlBytes(sig)}`;
}
async function verifyMailPreviewToken(
  env: any,
  token: string,
): Promise<{ key: string; filename: string; contentType: string; exp: number } | null> {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig || payload.length < 8 || sig.length < 8) return null;
  const secret = await mailPreviewSecret(env);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const pad = sig.length % 4 === 0 ? '' : '='.repeat(4 - (sig.length % 4));
  const bin = atob(sig.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const sigBytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) sigBytes[i] = bin.charCodeAt(i);
  const ok = await crypto.subtle.verify('HMAC', cryptoKey, sigBytes, new TextEncoder().encode(payload));
  if (!ok) return null;
  try {
    const pad2 = payload.length % 4 === 0 ? '' : '='.repeat(4 - (payload.length % 4));
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/') + pad2);
    const data = JSON.parse(json) as { key: string; filename: string; contentType: string; exp: number };
    if (!data?.key || !data.exp || data.exp < Date.now()) return null;
    if (!String(data.key).startsWith('mail/')) return null;
    return data;
  } catch {
    return null;
  }
}
function officeMimeFromName(name: string, fallback = 'application/octet-stream'): string {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  if (n.endsWith('.gif')) return 'image/gif';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.doc')) return 'application/msword';
  if (n.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (n.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (n.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (n.endsWith('.ppt')) return 'application/vnd.ms-powerpoint';
  if (n.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (n.endsWith('.odt')) return 'application/vnd.oasis.opendocument.text';
  if (n.endsWith('.ods')) return 'application/vnd.oasis.opendocument.spreadsheet';
  if (n.endsWith('.odp')) return 'application/vnd.oasis.opendocument.presentation';
  if (n.endsWith('.txt') || n.endsWith('.csv')) return 'text/plain; charset=utf-8';
  return fallback;
}


/** No truncation — Gemini finishReason handles length. */
function briefen(s: string): string {
  let t = String(s || '').trim();
  if (!t) return t;
  t = t.replace(/^(NO introductory phrases|No introductory phrases)[.\s]*/i, '');
  return t.trim();
}




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
  const x = Number(n || 0);
  return Number.isFinite(x) ? Math.round(x) : 0;
}

const app = new Hono<{ Bindings: Env }>();

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
  allowHeaders: ['Content-Type', 'Authorization', 'X-Api-Key', 'Idempotency-Key', 'X-Device-Fingerprint', 'X-Admin-Backup-Token', 'X-Backup-Signature', 'X-Backup-Timestamp'],
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

    try {
      if (path.startsWith('/api/reports/') || path.startsWith(`${NATIVE_V2}/`) || c.req.header('Authorization')?.startsWith('Bearer np1.') || path === '/api/mobile/work-status' || path === '/api/mobile/snake-score' || path === '/api/mobile/preferences' || path === '/api/reports' || path === '/api/admin/product-images/normalize') {
        session = rawDb.withSession('first-primary');
      } else if (path === '/api/health') {
        // Health check: can use unconstrained replica or available session
        session = rawDb.withSession();
      } else if (isCriticalSecurityPath(path, method)) {
        // Security-sensitive reads and business mutations: first-primary or trustworthy bookmark
        session = bm ? rawDb.withSession(bm) : rawDb.withSession('first-primary');
      } else {
        // Replica-eligible reads: use bookmark if available, else standard session
        session = bm ? rawDb.withSession(bm) : rawDb.withSession();
      }
    } catch {
      // Native v2 must never silently fall back to an unconstrained D1 replica.
      if (path.startsWith(`${NATIVE_V2}/`) || c.req.header('Authorization')?.startsWith('Bearer np1.')) {
        return c.json({ success: false, code: 'UNAVAILABLE', error: 'Connexion indisponible.' }, 503);
      }
      try {
        session = rawDb.withSession('first-primary');
      } catch {
        session = null;
      }
    }

    if (session) {
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
app.use('*', async (c, next) => {
  if (c.env.DB_TARGET) {
    (c.env as any).DB_SOURCE = c.env.DB; // remember the physical source before any swap
    try {
      const privateResource = new URL(c.req.url).pathname === '/api/mobile/preferences' || new URL(c.req.url).pathname.startsWith('/api/reports/') || new URL(c.req.url).pathname.startsWith(`${NATIVE_V2}/`) || !!c.req.header('Authorization')?.startsWith('Bearer np1.');
      // These resources must not fall back to the wrong database if
      // cutover state cannot be read; do not use the cached, fail-open flag.
      const flag = privateResource
        ? (await c.env.DB.prepare(`SELECT value FROM app_config WHERE key = 'db_primary'`).first() as any)?.value
        : await dbPrimaryFlag(c.env);
      if (flag === 'target') {
        const target = c.env.DB_TARGET as any;
        if ((new URL(c.req.url).pathname.startsWith(`${NATIVE_V2}/`) || c.req.header('Authorization')?.startsWith('Bearer np1.')) && typeof target.withSession !== 'function') throw new Error('Native v2 requires a primary D1 session');
        (c.env as any).DB = privateResource && typeof target.withSession === 'function'
          ? target.withSession('first-primary') : target;
      }
    } catch {
      // Never silently switch this private resource back to the source database
      // if the configured target's primary session cannot be established.
      if (new URL(c.req.url).pathname === '/api/mobile/preferences' || new URL(c.req.url).pathname.startsWith('/api/reports/') || new URL(c.req.url).pathname.startsWith(`${NATIVE_V2}/`) || c.req.header('Authorization')?.startsWith('Bearer np1.')) {
        return c.json({ success: false, code: 'SERVICE_UNAVAILABLE', error: 'Service indisponible' }, 503);
      }
    }
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

app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  // A staging native session must not be used to bootstrap a legacy web/QR
  // session or to activate fingerprint-based trust. Native refresh/logout use
  // their own proof-bearing POST bodies instead of Authorization.
  const nativeHeader = c.req.header('Authorization')?.startsWith('Bearer np1.');
  if (nativeHeader && path.startsWith('/api/auth/') && path !== '/api/auth/me') return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Non autorisé' }, 401);
  if ((c.req.query('token') || '').startsWith('np1.')) return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Non autorisé' }, 401);
  if (
    path.startsWith('/api/public/') ||
    path.startsWith('/api/cron/') ||
    path === '/api/media/proxy' ||
    // Public health/canary probes — the Android server picker pings
    // /api/health BEFORE login, and /api/canary is a deploy-smoke endpoint
    // designed to expose no secrets (subsystem ok flags + WAF counters).
    path === '/api/health' ||
    path === '/api/canary' ||
    // Read-only APK update manifest check — called by the app before login
    // (mandatory-update flow). Exposes only public CDN info.
    path === '/api/app/android-update' ||
    // CI release ingestion — Bearer ANDROID_RELEASE_TOKEN, no session/CSRF.
    path === '/api/admin/android-release' ||
    // QR login bridge: the PC creates/polls its session ANONYMOUSLY (the
    // phone side authenticates with its Bearer + the one-time QR token).
    path.startsWith('/api/auth/qr/') ||
    // Exact public desktop endpoints verify PKCE + state + creation IP/FP themselves.
    // prepare/authorize stay behind this normal web session gate.
    isPublicDesktopAuthPath(path) ||
    // Exact v2 operations enforce their own PKCE or authenticated-phone checks and D1 budgets.
    ((path === DESKTOP_NATIVE_V2_CAPABILITIES || path === DESKTOP_NATIVE_V3_CAPABILITIES) && c.req.method === 'GET') ||
    (isNativeV2Operation(path) && c.req.method === 'POST') ||
    path === '/api/auth/login' ||
    path === '/api/auth/verify-otp' ||
    path === '/api/auth/verify-link' ||
    path === '/api/auth/login-biometric' ||
    path === '/api/auth/webauthn/login/options' ||
    path === '/api/auth/webauthn/login/verify' ||
    path === '/api/auth/webauthn/status' ||
    path === '/.well-known/assetlinks.json' ||
    // v260 — crash intake is public by design (fire-and-forget from global
    // error handlers, incl. logged-out sessions); rate-limited + sanitized.
    path === '/api/crash-reports' ||
    path === '/api/auth/device-status' ||
    path === '/api/auth/turnstile-config'
  ) {
    return next();
  }
  if (c.req.header('Authorization')?.slice(7).startsWith('np1.') && new URL(c.req.url).origin !== c.env.DESKTOP_NATIVE_V2_PILOT_ORIGIN) return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Non autorisé' }, 401);

  // ─── Extract session token from query (print / PDF / reports in new tab) ───
  function extractQueryToken(rawUrl: string): string | null {
    try {
      const u = new URL(rawUrl);
      let t = u.searchParams.get('token');
      if (!t) {
        // Manual parse if + was treated as space or param mangled
        const m = rawUrl.match(/[?&]token=([^&]+)/);
        if (m) t = m[1];
      }
      if (!t) return null;
      // Spaces from form-encoding of + ; repeated decode safety
      t = t.replace(/ /g, '+');
      try { t = decodeURIComponent(t); } catch { /* already decoded */ }
      t = t.replace(/ /g, '+');
      // base64url → base64
      if (t.includes('-') || t.includes('_')) {
        t = t.replace(/-/g, '+').replace(/_/g, '/');
      }
      return t || null;
    } catch {
      return null;
    }
  }

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
    path.match(/^\/api\/bills\/\d+\/pdf$/) ||
    path.match(/^\/api\/receipts\/\d+\/print$/) ||
    path.match(/^\/api\/receipts\/\d+\/pdf$/) ||
    path.match(/^\/api\/print\/thermal\/\d+$/) ||
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
    if (queryToken?.startsWith('np1.')) return deny(401, 'INVALID_TOKEN');
    const rt = c.req.query('rt');
    if (rt && !auth && !queryToken && path !== '/api/reports/link-ticket') {
      const verified = await verifyScopedReportTicket(reportTicketEnvironment(c.env), rt, getOwnerUsername(c.env));
      if (verified !== 'ok') return deny(401, verified === 'expired' ? 'TICKET_EXPIRED' : 'INVALID_TICKET');
      if (!REPORT_TICKET_PATHS.has(path)) return c.json({ success: false, code: 'UNSUPPORTED_REPORT', error: 'Rapport non pris en charge' }, 404);
      (c as any).set('reportTicket', rt);
      return next();
    }
    const identity = await verifyArchiveIdentity(c.env, auth || (queryToken ? `Bearer ${queryToken}` : undefined), clientIp(c), undefined, {
      authFailReason: (header, env, db, ip, fp) => authFailReason(header, env as Env, db, ip, fp, { relaxSession: true }),
      sessionUserFromHeader,
      ownerUsername: (env) => getOwnerUsername(env as Env),
    });
    if (!identity.ok) return deny(identity.status, identity.code);
    (c as any).set('reportIdentity', identity.identity);
    if (path !== '/api/reports/link-ticket' && REPORT_TICKET_PATHS.has(path)) {
      try {
        const ticket = await mintScopedReportTicket(reportTicketEnvironment(c.env), identity.identity as any, getOwnerUsername(c.env));
        (c as any).set('reportTicket', ticket.rt);
      } catch { return deny(503, 'REPORT_TICKET_UNAVAILABLE'); }
    }
    return next();
  }

  if (isPrintLike) {
    const ip = clientIp(c);
    const queryToken = extractQueryToken(c.req.url);
    const authHeader = c.req.header('Authorization');
    const wantsJson =
      (c.req.header('Accept') || '').includes('application/json') ||
      (c.req.header('Content-Type') || '').includes('application/json') ||
      !!authHeader?.startsWith('Bearer ');

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
        return next();
      }
    } catch { /* */ }

    // 1) Query token (PDF tab / openReport)
    if (queryToken && !queryToken.startsWith('np1.')) {
      const reason = await authFailReason(`Bearer ${queryToken}`, c.env, c.env.DB, ip, undefined, { relaxSession: true });
      if (reason === 'ok') {
        if (isReport) {
          const sess = sessionUserFromHeader(`Bearer ${queryToken}`);
          const role = (sess.role || '').toLowerCase();
          if (role !== 'owner' && role !== 'admin') {
            return reportForbidden(
              'Accès réservé',
              'Les rapports comptables sont réservés au propriétaire et aux administrateurs.',
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
        if (role !== 'owner' && role !== 'admin') {
          return reportForbidden(
            'Accès réservé',
            'Les rapports sont réservés au propriétaire et aux administrateurs.',
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

    // Print-like via Authorization (SPA fetch) or remaining cases — relax session
    if (authHeader?.startsWith('Bearer ')) {
      const reason = await authFailReason(authHeader, c.env, c.env.DB, ip, undefined, { relaxSession: true });
      if (reason === 'ok') return next();
      return reportForbidden(
        'Session requise',
        'Reconnectez-vous puis rouvrez le document depuis l’application.',
        reason || 'UNAUTHORIZED',
      );
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
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, ip, fp, { allowRoleRefresh: roleRefreshPath });
  if (reason === 'role_changed') return c.json({ success: false, error: 'Votre rôle a changé. Actualisez votre session.', code: 'ROLE_CHANGED' }, 409);
  if (reason !== 'ok') {
    return c.json({
      success: false,
      error:
        reason === 'ip_changed' ? 'Adresse IP modifiée — reconnexion requise'
        : reason === 'fp_changed' ? 'Appareil différent — reconnexion requise'
        : reason === 'device_revoked' ? 'Appareil révoqué — reconnexion requise'
        : 'Non autorisé',
      code:
        reason === 'ip_changed' ? 'IP_CHANGED'
        : reason === 'fp_changed' ? 'DEVICE_CHANGED'
        : reason === 'device_revoked' ? 'DEVICE_REVOKED'
        : 'UNAUTHORIZED',
    }, 401);
  }
  return next();
});

app.use('*', async (c, next) => {
  c.set('bffSurface', detectBffSurface(c));
  await next();
  try { c.header('X-Atlas-Bff', String(c.get('bffSurface') || 'web')); } catch { /* */ }
  const path = new URL(c.req.url).pathname;
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
  if (path === '/login/desktop' || path === '/login/desktop-phone' || path === '/login/desktop-challenge' || path === EMBEDDED_CHALLENGE_PATH || path === `${EMBEDDED_CHALLENGE_PATH}.js`) {
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
  c.header('Referrer-Policy', path === '/login/desktop' || path === '/login/desktop-phone' || path === '/login/desktop-challenge' || path === EMBEDDED_CHALLENGE_PATH || path === `${EMBEDDED_CHALLENGE_PATH}.js` || isDesktopAuthPath(path) || path.startsWith(`${NATIVE_V2}/`) ? 'no-referrer' : 'strict-origin-when-cross-origin');
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
    path === EMBEDDED_CHALLENGE_PATH ? EMBEDDED_CHALLENGE_CSP : [
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
  if (isDesktopAuthPath(c.req.path) || isNativeV2Operation(c.req.path)) return next();
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
  if (new URL(c.req.url).pathname.startsWith(`${NATIVE_V2}/`)) {
    return c.json({ success: false, code: 'UNAVAILABLE', error: 'Connexion indisponible.' }, 503);
  }
  // Authentication errors may contain request secrets; never log their raw exceptions.
  try { if (!new URL(c.req.url).pathname.startsWith('/api/reports/') && !new URL(c.req.url).pathname.startsWith('/api/auth/') && !new URL(c.req.url).pathname.startsWith(EMBEDDED_CHALLENGE_PATH)) console.error('[onError]', c.req.method, new URL(c.req.url).pathname, String((err as any)?.stack || err || '').slice(0, 500)); } catch { /* */ }
  const safe = toClientError(err, { log: !new URL(c.req.url).pathname.startsWith('/api/auth/') && !new URL(c.req.url).pathname.startsWith(EMBEDDED_CHALLENGE_PATH) });
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
registerInvoiceReadRoutes(app);
registerStockReadRoutes(app);
registerWholesaleRoutes(app, { requireBizMutator });
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
  const result = await verifyArchiveIdentity(c.env, c.req.header('Authorization'), clientIp(c), c.req.header('X-Device-Fingerprint'), {
    authFailReason: (header, env, db, ip, fp) => authFailReason(header, env as Env, db, ip, fp),
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
registerAtlasV209Routes(app, { sessionUserFromHeader, applyStockDelta, adjustLocationStock, getDefaultLocationId });
// Admin read routes need helpers defined later — registered near Users & Admin section

/* ═══ v225 — Atlas Agent governance: usage caps, injection lockout, privacy deletes, 2FA, devices ═══ */
/* Prompt-injection / abuse tripwire: client flags the session user; agent locked until an admin restores. */
/* ── v232 — canary endpoint: deploy smoke + subsystem health + WAF stats (no secrets) ── */
app.get('/api/canary', async (c) => {
  const t0 = Date.now();
  const checks: Record<string, { ok: boolean; ms: number }> = {};
  try {
    const a = Date.now();
    await c.env.DB.prepare(`SELECT 1 AS ok`).first();
    checks.d1 = { ok: true, ms: Date.now() - a };
  } catch { checks.d1 = { ok: false, ms: Date.now() - t0 }; }
  if (c.env.CACHE) {
    try {
      const a = Date.now();
      await c.env.CACHE.get('canary-ping');
      checks.kv = { ok: true, ms: Date.now() - a };
    } catch { checks.kv = { ok: false, ms: Date.now() - t0 }; }
  } else checks.kv = { ok: false, ms: 0 };
  if (c.env.IMAGES) {
    try {
      const a = Date.now();
      await c.env.IMAGES.head('__canary_ping__');
      checks.r2 = { ok: true, ms: Date.now() - a };
    } catch { checks.r2 = { ok: false, ms: Date.now() - t0 }; }
  } else checks.r2 = { ok: false, ms: 0 };
  const allOk = Object.values(checks).every((k) => k.ok);
  return c.json({
    success: allOk,
    data: {
      version: '0.4.9-beta',
      environment: String((c.env as any).ENVIRONMENT || 'unknown'),
      ts: new Date().toISOString(),
      totalMs: Date.now() - t0,
      checks,
      waf: { blocked: WAF_STATS.blocked, lastAt: WAF_STATS.lastAt, lastSig: WAF_STATS.lastSig },
      dbTarget: { bound: !!c.env.DB_TARGET, primary: c.env.DB_TARGET ? await dbPrimaryFlag(c.env) : 'source' },
    },
  }, allOk ? 200 : 503);
});

/* ── v232 — D1 → D1 migration tooling (owner only). Target binding optional. ── */
// Private game scores must not appear in admin migration counts or copy summaries.
const MIG_SKIP = /^(sqlite_|d1_|_cf_|snake_personal_best$|work_status_report_owners$|user_report_dedup$|user_report_delivery_leases$)/;
async function migTables(db: D1Database): Promise<{ name: string; rows: number }[]> {
  const list = (await db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name`).all()) as any;
  const out: { name: string; rows: number }[] = [];
  for (const r of list.results || []) {
    const name = String(r.name || '');
    if (!name || MIG_SKIP.test(name)) continue;
    try {
      const c = (await db.prepare(`SELECT COUNT(*) AS c FROM \`${name}\``).first()) as any;
      out.push({ name, rows: Number(c?.c || 0) });
    } catch { out.push({ name, rows: -1 }); }
  }
  return out;
}
app.get('/api/admin/db-migrate/status', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  const target = (c.env as any).DB_TARGET as D1Database | undefined;
  return c.json({
    success: true,
    data: {
      enabled: !!target,
      primary: target ? await dbPrimaryFlag(c.env) : 'source',
      source: await migTables(((c.env as any).DB_SOURCE || c.env.DB) as D1Database),
      target: target ? await migTables(target) : [],
    },
  });
});
app.post('/api/admin/db-migrate/copy', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  const target = (c.env as any).DB_TARGET as D1Database | undefined;
  if (!target) return c.json({ success: false, error: 'Binding D1 « DB_TARGET » absente — ajoutez-la (atlas-db) puis redéployez.', code: 'NO_TARGET' }, 400);
  const body = await c.req.json().catch(() => ({}));
  const only = Array.isArray(body.tables) ? body.tables.map((t: any) => String(t)).slice(0, 80) : null;
  const cursorIn = body.cursor && typeof body.cursor === 'object' ? body.cursor : {};
  const copied: Record<string, number> = {};
  const cursor: Record<string, number> = { ...cursorIn };
  const done: string[] = [];
  let budget = 1500; // rows per call (Workers CPU-friendly)
  const physSrc = ((c.env as any).DB_SOURCE || c.env.DB) as D1Database;
  const tables = await migTables(physSrc);
  for (const t of tables) {
    if (only && !only.includes(t.name)) continue;
    const name = t.name;
    const ddl = (await physSrc.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).bind(name).first()) as any;
    if (!ddl?.sql) continue;
    try { await target.prepare(String(ddl.sql)).run(); } catch { /* exists or incompatible → skip table */ }
    const cols = (await physSrc.prepare(`PRAGMA table_info(\`${name}\`)`).all()) as any;
    const colNames = (cols.results || []).map((r: any) => `\`${String(r.name)}\``).join(', ');
    if (!colNames) { done.push(name); continue; }
    let last = Number(cursor[name] || 0);
    let guard = 0;
    while (budget > 0 && guard < 40) {
      guard += 1;
      const batch = (await physSrc.prepare(`SELECT rowid AS __rid, * FROM \`${name}\` WHERE rowid > ? ORDER BY rowid LIMIT 200`).bind(last).all()) as any;
      const rows = batch.results || [];
      if (!rows.length) { done.push(name); delete cursor[name]; break; }
      for (const row of rows) {
        const { __rid, ...rest } = row as any;
        const vals = Object.keys(rest).map((k) => (rest as any)[k]);
        const places = Object.keys(rest).map(() => '?').join(', ');
        const keys = Object.keys(rest).map((k) => `\`${k}\``).join(', ');
        try { await target.prepare(`INSERT OR REPLACE INTO \`${name}\` (${keys}) VALUES (${places})`).bind(...vals).run(); } catch { /* row-level skip */ }
        last = Number(__rid);
        budget -= 1;
      }
      cursor[name] = last;
      copied[name] = (copied[name] || 0) + rows.length;
      if (rows.length < 200) { done.push(name); delete cursor[name]; break; }
    }
    if (budget <= 0) break;
  }
  return c.json({ success: true, data: { copied, cursor, done, remainingBudget: budget } });
});
app.post('/api/admin/db-migrate/cutover', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  const target = (c.env as any).DB_TARGET as D1Database | undefined;
  if (!target) return c.json({ success: false, error: 'Binding D1 « DB_TARGET » absente.', code: 'NO_TARGET' }, 400);
  const body = await c.req.json().catch(() => ({}));
  const on = body.on === true || body.on === 'true';
  const value = on ? 'target' : 'source';
  const stamp = new Date().toISOString();
  const physicalSource = ((c.env as any).DB_SOURCE || c.env.DB) as D1Database;
  for (const db of [physicalSource, target]) {
    try {
      await db.prepare(`INSERT INTO app_config (key, value, updated_at) VALUES ('db_primary', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(value, stamp).run();
    } catch { /* best effort per side */ }
  }
  dbPrimaryCache = { value, at: Date.now() };
  return c.json({ success: true, data: { primary: value } });
});

/* ── Account deletion (OTP-gated) ── */
app.post('/api/settings/account/request-delete-otp', async (c) => {
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), c.req.header('X-Device-Fingerprint') || '');
  if (reason !== 'ok') return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const username = String(session.username || '').toLowerCase();
  const res = await issueDeleteOtp(c.env, 'account-delete', username, 'votre compte Atlas Commerce', 'Code de confirmation — suppression de compte', { toEmail: await userMail(c.env.DB, username) });
  return c.json({ success: true, emailed: res.emailed, message: res.message, otp: res.emailed ? undefined : res.otp });
});

app.post('/api/settings/account/delete', async (c) => {
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), c.req.header('X-Device-Fingerprint') || '');
  if (reason !== 'ok') return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const username = String(session.username || '').toLowerCase();
  if (session.role === 'owner') return c.json({ success: false, error: 'Le compte propriétaire ne peut pas être supprimé ici.' }, 400);
  const body = await c.req.json().catch(() => ({}));
  const check = await verifyDeleteOtp(c.env.DB, 'account-delete', username, String(body.otp || ''));
  if (!check.ok) return c.json({ success: false, error: check.error }, check.status as any);
  await c.env.DB.prepare(`DELETE FROM app_users WHERE lower(username) = ?`).bind(username).run();
  await c.env.DB.prepare(`DELETE FROM trusted_devices WHERE lower(username) = ?`).bind(username).run();
  await c.env.DB.prepare(`DELETE FROM webauthn_credentials WHERE lower(username) = ?`).bind(username).run();
  await writeAudit(c.env.DB, { username, role: session.role, action: 'account.delete', entity: username, detail: 'otp-verified' });
  return c.json({ success: true });
});

/* ── 2FA (OTP at every login, even trusted devices) ── */
app.get('/api/settings/2fa', async (c) => {
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), c.req.header('X-Device-Fingerprint') || '');
  if (reason !== 'ok') return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  const v = await getConfig(c.env.DB, 'twofa_enabled', '0');
  return c.json({ success: true, data: { enabled: v === '1' } });
});

app.put('/api/settings/2fa', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  const body = await c.req.json().catch(() => ({}));
  const enabled = body.enabled ? '1' : '0';
  await setConfig(c.env.DB, 'twofa_enabled', enabled);
  await writeAudit(c.env.DB, { username: gate.username, role: 'owner', action: 'security.2fa_toggle', entity: 'auth', detail: enabled === '1' ? 'enabled' : 'disabled' });
  return c.json({ success: true, data: { enabled: enabled === '1' } });
});

/* ── Logged-in devices (every user sees their own; revoke supported) ── */
function cfGeo(c: any): { city: string; country: string } {
  const cf = (c?.req?.raw as any)?.cf || {};
  return { city: String(cf.city || ''), country: String(cf.country || '') };
}

const _touchDeviceCache = new WeakMap<object, Map<string, number>>();
const TOUCH_DEVICE_THROTTLE_MS = 180_000;

async function touchTrustedDevice(
  db: D1Database,
  username: string,
  fingerprint: string,
  ip: string,
  userAgent: string,
  geo?: { city?: string; country?: string } | null,
): Promise<void> {
  const fp = String(fingerprint || '').trim();
  const uname = String(username || '').trim().toLowerCase();
  if (!fp || fp === 'none' || !uname) return;
  const cacheKey = `${fp}|${uname}|${String(ip || '')}`;
  let perDb = _touchDeviceCache.get(db as unknown as object);
  const now = Date.now();
  const last = perDb?.get(cacheKey);
  if (last && now - last < TOUCH_DEVICE_THROTTLE_MS) return;
  await ensureSecurityTables(db);
  await db
    .prepare(
      `INSERT INTO trusted_devices (fingerprint, username, user_agent, last_ip, last_seen, city, country)
       VALUES (?, ?, ?, ?, datetime('now'), ?, ?)
       ON CONFLICT(fingerprint) DO UPDATE SET
         username = excluded.username,
         user_agent = excluded.user_agent,
         last_ip = excluded.last_ip,
         last_seen = datetime('now'),
         city = COALESCE(NULLIF(excluded.city, ''), city),
         country = COALESCE(NULLIF(excluded.country, ''), country)`,
    )
    .bind(
      fp.slice(0, 128),
      uname,
      String(userAgent || '').slice(0, 200),
      String(ip || '').slice(0, 64),
      String(geo?.city || '').slice(0, 80),
      String(geo?.country || '').slice(0, 80),
    )
    .run();
  if (!perDb) {
    perDb = new Map<string, number>();
    _touchDeviceCache.set(db as unknown as object, perDb);
  }
  perDb.set(cacheKey, now);
  if (perDb.size > 300) {
    const first = perDb.keys().next().value;
    if (first) perDb.delete(first);
  }
}

/** Phase 3: health / bindings observability (no secrets). */
app.get('/api/health', async (c) => {
  void proactiveFtsHealth(c.env.DB);
  let d1 = false;
  try {
    await c.env.DB.prepare('SELECT 1 as ok').first();
    d1 = true;
  } catch { /* */ }
  let cacheStatus = null;
  try {
    if (c.env.CACHE) {
      const raw = await c.env.CACHE.get('meta:cache_status', 'text');
      cacheStatus = raw ? JSON.parse(raw) : null;
    }
  } catch { /* */ }
  return c.json({
    success: true,
    data: {
      ok: true,
      d1,
      kv: !!c.env.CACHE,
      r2: !!c.env.IMAGES,
      cdn: c.env.CDN_BASE || 'https://cdn1.afmarbre.com',
      environment: c.env.ENVIRONMENT || 'unknown',
      cache_status: cacheStatus,
      time: new Date().toISOString(),
    },
  });
});

/** List R2 objects under products/ (owner) — inventory of stored images (not Iceberg catalog). */
app.get('/api/admin/r2/images', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  const prefix = (c.req.query('prefix') || 'products/').slice(0, 64);
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') || 50)));
  const objects = await listR2Prefix(c.env.IMAGES, prefix, limit);
  return c.json({
    success: true,
    data: objects,
    meta: {
      bucket: 'company-stock-images',
      cdn: c.env.CDN_BASE || 'https://cdn1.afmarbre.com',
      note: 'R2 object inventory. R2 Data Catalog (Iceberg) is optional analytics, not required for product images.',
    },
  });
});

/* ─── Auth ─── */

function getPassword(env: Env): string | null {
  // Support common secret names (Cloudflare dashboard typos / legacy)
  const candidates = [
    env.ADMIN_PASSWORD,
    (env as any).PASSWORD,
    (env as any).ADMIN_PASS,
    (env as any).ADMIN_PASSWORD_SECRET,
  ];
  for (const c of candidates) {
    if (c == null) continue;
    // Strip wrapping quotes that sometimes get stored with secrets
    let raw = String(c).trim();
    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      raw = raw.slice(1, -1).trim();
    }
    // Strip BOM / zero-width chars from secret managers
    raw = raw.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D]/g, '');
    if (raw.length > 0) return raw;
  }
  return null;
}

/** Normalize password for comparison (trim + Unicode NFC + strip invisible chars). */
function normalizePassword(p: string): string {
  try {
    return String(p || '')
      .replace(/^\uFEFF/, '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim()
      .normalize('NFC');
  } catch {
    return String(p || '').trim();
  }
}

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function passwordsMatch(input: string, expected: string): boolean {
  const a = normalizePassword(input);
  const b = normalizePassword(expected);
  if (a.length === 0 || b.length === 0) return false;
  if (a === b) return true;
  // Also try NFD (some mobile keyboards)
  try {
    if (a.normalize('NFD') === b.normalize('NFD')) return true;
  } catch { /* ignore */ }
  return false;
}

/** Random base64url challenge for WebAuthn */
function randomChallenge(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function getOwnerUsername(env: Env): string {
  const u = (env.ADMIN_USERNAME ?? 'admin').toString().trim().toLowerCase();
  return u.length > 0 ? u : 'admin';
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** PBKDF2-SHA-256 cost for interactive logins on Workers.
 * Cloudflare Web Crypto rejects iteration counts above 100_000.
 * Format: pbkdf2$<iterations>$<hex> — verify uses the stored iteration count.
 */
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_ITERATIONS_MAX = 100_000;

async function derivePbkdf2Bits(password: string, salt: string, iterations: number): Promise<string> {
  const iters = Math.min(Math.max(1, iterations | 0), PBKDF2_ITERATIONS_MAX);
  const normalized = normalizePassword(password);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(normalized),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(`pc-salt:${salt}`),
      iterations: iters,
    },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(bits)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Strong password hash: PBKDF2-SHA-256 with per-user salt.
 * Stored as `pbkdf2$100000$<hex>` so we can evolve iterations later.
 * Legacy single-pass SHA-256 (`pc:salt:pw`) still verifies for existing rows.
 */
async function hashUserPassword(password: string, salt: string): Promise<string> {
  const hex = await derivePbkdf2Bits(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${hex}`;
}

/** Legacy one-shot SHA-256 used before PBKDF2 migration. */
async function hashUserPasswordLegacy(password: string, salt: string): Promise<string> {
  return sha256Hex(`pc:${salt}:${normalizePassword(password)}`);
}

function isModernPasswordHash(stored: string): boolean {
  return String(stored || '').startsWith('pbkdf2$');
}

function isLegacyPasswordHash(stored: string): boolean {
  return /^[a-f0-9]{64}$/i.test(String(stored || ''));
}

/**
 * Verify password against stored material.
 * Supports: PBKDF2 (current), legacy single-pass SHA-256, and accidental plaintext
 * (plaintext is accepted once so we can re-hash on next successful login — never leave it).
 */
async function verifyUserPassword(password: string, salt: string, storedHash: string): Promise<boolean> {
  const stored = String(storedHash || '');
  if (!stored) return false;
  if (isModernPasswordHash(stored)) {
    // pbkdf2$<iterations>$<hex> — use stored iterations (capped at platform max)
    const parts = stored.split('$');
    const storedIters = parseInt(parts[1] || '', 10);
    const storedHex = (parts[2] || '').toLowerCase();
    if (!storedHex || !Number.isFinite(storedIters) || storedIters < 1) return false;
    // Platform max 100k: hashes created with 120k cannot be re-derived here.
    // Try capped derive; if stored was exactly <= 100k, compare hex.
    if (storedIters <= PBKDF2_ITERATIONS_MAX) {
      const hex = await derivePbkdf2Bits(password, salt, storedIters);
      return hex.toLowerCase() === storedHex;
    }
    // Pre-1.3.2 hashes used 120000 — re-derive at 100k cannot match.
    // Fall through: allow one successful login via legacy paths only if any;
    // otherwise force password reset path is safer. Attempt 100k as last resort
    // only when admin reset the hash. Return false so login fails cleanly
    // rather than throwing "iteration counts above 100000".
    return false;
  }
  if (isLegacyPasswordHash(stored)) {
    const legacy = await hashUserPasswordLegacy(password, salt);
    return legacy === stored;
  }
  // Accidental plaintext in password_hash — match then caller must upgrade
  return passwordsMatch(password, stored);
}

/** Re-hash to PBKDF2 after a successful login (upgrades legacy / plaintext rows). */
async function upgradeUserPasswordHash(db: D1Database, userId: number, password: string): Promise<string> {
  const salt = randomChallenge().slice(0, 16);
  const password_hash = await hashUserPassword(password, salt);
  await db.prepare(
    `UPDATE app_users SET password_hash = ?, password_salt = ? WHERE id = ?`
  ).bind(password_hash, salt, userId).run();
  return password_hash;
}


/** secretaire = bureau: devis, clients, factures, rapports — pas admin serveur ni suppression masse */
function roleAtLeast(role: string, min: 'user' | 'secretaire' | 'admin' | 'owner'): boolean {
  const order = { user: 1, secretaire: 2, admin: 3, owner: 4 };
  return (order[normalizeRole(role) as keyof typeof order] || 0) >= order[min];
}

async function writeAudit(
  db: D1Database,
  opts: { username?: string; role?: string; action: string; entity?: string; entity_id?: string | number; detail?: string; ip?: string }
) {
  try {
    await ensureSecurityTables(db);
    await db.prepare(
      `INSERT INTO audit_log (username, role, action, entity, entity_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      opts.username || null,
      opts.role || null,
      opts.action,
      opts.entity || null,
      opts.entity_id != null ? String(opts.entity_id) : null,
      opts.detail || null,
      opts.ip || null
    ).run();
  } catch { /* never break business flow */ }
}

async function makeSessionProof(username: string, role: string, secretMaterial: string, ip: string, fp: string): Promise<string> {
  return sha256Hex(`proof|${username}|${role}|${secretMaterial}|${ip}|${fp}`);
}

async function getConfig(db: D1Database, key: string, fallback = ''): Promise<string> {
  const row = await db.prepare(`SELECT value FROM app_config WHERE key = ?`).bind(key).first() as any;
  return row?.value != null ? String(row.value) : fallback;
}

async function setConfig(db: D1Database, key: string, value: string) {
  await db.prepare(
    `INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')`
  ).bind(key, value, value).run();
}


function clientIp(c: any): string {
  const raw = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || c.req.header('X-Real-IP') || 'unknown';
  return normalizeIp(raw);
}

/** Session token v2: username + role + proof (no raw password). Legacy v1 still parsed. */
async function makeTokenV2(
  username: string,
  role: string,
  secretMaterial: string,
  ip: string,
  fingerprint: string,
): Promise<string> {
  const fp = (fingerprint || 'none').slice(0, 128);
  const user = username.toLowerCase();
  const proof = await makeSessionProof(user, role, secretMaterial, ip, fp);
  return btoa(unescape(encodeURIComponent(`stock-auth-v2|${user}|${role}|${ip}|${fp}|${proof}`)));
}

/** @deprecated legacy single-admin token — still accepted for old sessions briefly */
function makeToken(password: string, ip: string, fingerprint: string): string {
  const fp = (fingerprint || 'none').slice(0, 128);
  return btoa(unescape(encodeURIComponent(`stock-auth|${password}|${ip}|${fp}`)));
}

function parseToken(token: string): {
  version: 1 | 2;
  password?: string;
  username?: string;
  role?: string;
  ip: string;
  fingerprint: string;
  proof?: string;
} | null {
  const candidates = [
    token,
    token.replace(/ /g, '+'),
    (() => { try { return decodeURIComponent(token); } catch { return token; } })(),
  ];
  for (const tok of candidates) {
    try {
      const raw = decodeURIComponent(escape(atob(tok)));
      const parts = raw.split('|');
      if (parts[0] === 'stock-auth-v2' && parts.length >= 6) {
        return {
          version: 2,
          username: parts[1],
          role: parts[2],
          ip: parts[3],
          fingerprint: parts[4] || 'none',
          proof: parts[5],
        };
      }
      if (parts[0] === 'stock-auth' && parts.length >= 3) {
        return { version: 1, password: parts[1], ip: parts[2], fingerprint: parts[3] || 'none' };
      }
    } catch {
      continue;
    }
  }
  return null;
}

async function ensureSecurityTables(db: D1Database) {
  await schemaOnce('security_tables', async () => {

  await db.prepare(`CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    username TEXT,
    role TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    detail TEXT,
    ip TEXT
  )`).run();
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_audit_log_id_desc ON audit_log(id DESC)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_audit_log_username ON audit_log(username)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)`).run();
  } catch { /* index already exists or D1 limitation */ }

  await db.prepare(`CREATE TABLE IF NOT EXISTS login_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, ip TEXT NOT NULL, fingerprint TEXT DEFAULT '', success INTEGER DEFAULT 0, reputation_delta INTEGER DEFAULT 0, user_agent TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS ip_reputation (ip TEXT PRIMARY KEY, score INTEGER NOT NULL DEFAULT 50, failed_count INTEGER DEFAULT 0, success_count INTEGER DEFAULT 0, blocked_until TEXT, updated_at TEXT DEFAULT (datetime('now')))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS otp_codes (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), UNIQUE(resource_type, resource_id))`).run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS qr_login_sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    role TEXT NOT NULL,
    created_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    claim_fingerprint TEXT DEFAULT '',
    claim_ua TEXT DEFAULT '',
    claim_ip TEXT DEFAULT '',
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_qr_login_status ON qr_login_sessions(status, expires_at)`).run();
  // Devices that completed password+OTP once — subsequent logins only need password (or WebAuthn)
  await db.prepare(`CREATE TABLE IF NOT EXISTS trusted_devices (
    fingerprint TEXT PRIMARY KEY,
    label TEXT DEFAULT '',
    last_ip TEXT DEFAULT '',
    last_seen TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    biometric_credential_id TEXT DEFAULT ''
  )`).run();
  await addColumnIfMissing(db, 'trusted_devices', 'biometric_credential_id', "TEXT DEFAULT ''");

  // Multiple WebAuthn credentials per device (platform biometric + hardware security keys)
  await db.prepare(`CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id TEXT PRIMARY KEY,
    fingerprint TEXT NOT NULL,
    device_type TEXT DEFAULT 'platform',
    transports TEXT DEFAULT '',
    label TEXT DEFAULT '',
    username TEXT DEFAULT '',
    role TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    last_used TEXT
  )`).run();
  await addColumnIfMissing(db, 'webauthn_credentials', 'username', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'webauthn_credentials', 'role', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'webauthn_credentials', 'device_info', "TEXT DEFAULT ''");
  // v259 — verified credential material (the pre-v259 schema stored NO key)
  await addColumnIfMissing(db, 'webauthn_credentials', 'public_key_jwk', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'webauthn_credentials', 'counter', 'INTEGER DEFAULT 0');
  await addColumnIfMissing(db, 'webauthn_credentials', 'backup_eligible', 'INTEGER DEFAULT 0');
  await addColumnIfMissing(db, 'webauthn_credentials', 'backup_state', 'INTEGER DEFAULT 0');
  await addColumnIfMissing(db, 'webauthn_credentials', 'rp_id', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'webauthn_credentials', 'origin', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'webauthn_credentials', 'cred_user_handle', "TEXT DEFAULT ''");

  // Short-lived challenges for WebAuthn register/login
  await db.prepare(`CREATE TABLE IF NOT EXISTS webauthn_challenges (
    id TEXT PRIMARY KEY,
    challenge TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    purpose TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  // v259 — purpose/account/RP/origin binding + atomic single-use consumption
  await addColumnIfMissing(db, 'webauthn_challenges', 'username', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'webauthn_challenges', 'rp_id', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'webauthn_challenges', 'origin', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'webauthn_challenges', 'consumed', 'INTEGER DEFAULT 0');
  await addColumnIfMissing(db, 'webauthn_challenges', 'consumed_at', 'TEXT DEFAULT NULL');

  // Multi-user accounts (owner is always env ADMIN_USERNAME + ADMIN_PASSWORD)
  await db.prepare(`CREATE TABLE IF NOT EXISTS app_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    display_name TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    avatar_url TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_by TEXT DEFAULT 'admin',
    created_at TEXT DEFAULT (datetime('now')),
    last_login TEXT
  )`).run();

  // Existing DBs: add missing columns only (never fail on duplicate)
  await addColumnIfMissing(db, 'app_users', 'email', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'app_users', 'phone', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'app_users', 'avatar_url', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'app_users', 'notes', "TEXT DEFAULT ''");

  // Server / admin configuration (owner-only)
  await db.prepare(`CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now'))
  )`).run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS mail_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    direction TEXT NOT NULL CHECK(direction IN ('in','out')),
    mailbox TEXT NOT NULL DEFAULT 'admin@afmarbre.com',
    from_addr TEXT NOT NULL DEFAULT '',
    to_addr TEXT NOT NULL DEFAULT '',
    cc_addr TEXT DEFAULT '',
    subject TEXT DEFAULT '',
    body_text TEXT DEFAULT '',
    body_html TEXT DEFAULT '',
    resend_id TEXT DEFAULT '',
    r2_key TEXT DEFAULT '',
    thread_key TEXT DEFAULT '',
    status TEXT DEFAULT 'received',
    meta_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  try { await db.prepare(`CREATE INDEX IF NOT EXISTS idx_mail_created ON mail_messages(created_at DESC)`).run(); } catch { /* */ }
  try { await db.prepare(`CREATE INDEX IF NOT EXISTS idx_mail_mailbox ON mail_messages(mailbox, direction)`).run(); } catch { /* */ }
  try { await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_resend ON mail_messages(resend_id) WHERE resend_id IS NOT NULL AND resend_id != ''`).run(); } catch { /* */ }
  });
}


async function isTrustedDevice(db: D1Database, fingerprint: string): Promise<boolean> {
  if (!fingerprint || fingerprint === 'none') return false;
  const row = await db.prepare(`SELECT fingerprint FROM trusted_devices WHERE fingerprint = ?`).bind(fingerprint).first();
  return !!row;
}

async function trustDevice(db: D1Database, fingerprint: string, ip: string, username?: string, userAgent?: string) {
  if (!fingerprint || fingerprint === 'none') return;
  await addColumnIfMissing(db, 'trusted_devices', 'username', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'trusted_devices', 'user_agent', "TEXT DEFAULT ''");
  // v0.7.1 — city/country captured from Cloudflare cf at login/touch (IP-based).
  await addColumnIfMissing(db, 'trusted_devices', 'city', "TEXT DEFAULT ''");
  // v0.7.5 — reprise après auto-déconnexion (30 j, même compte + même appareil)
  await addColumnIfMissing(db, 'trusted_devices', 'resume_until', "TEXT DEFAULT ''");
  await addColumnIfMissing(db, 'trusted_devices', 'country', "TEXT DEFAULT ''");
  // v0.7.1 — main company email = OTP fallback destination until a user has one.
  await addColumnIfMissing(db, 'company_settings', 'email', "TEXT DEFAULT ''");
  const u = String(username || '').slice(0, 80);
  const ua = String(userAgent || '').slice(0, 160);
  await db.prepare(
    `INSERT INTO trusted_devices (fingerprint, last_ip, last_seen, username, user_agent) VALUES (?, ?, datetime('now'), ?, ?)
     ON CONFLICT(fingerprint) DO UPDATE SET last_ip = ?, last_seen = datetime('now'),
       username = CASE WHEN excluded.username != '' THEN excluded.username ELSE trusted_devices.username END,
       user_agent = CASE WHEN excluded.user_agent != '' THEN excluded.user_agent ELSE trusted_devices.user_agent END`
  ).bind(fingerprint, ip, u, ua, ip).run();
}

/** Part 2: re-confirm admin password for create / edit / delete (OTP is login-only). */
/**
 * Confirm destructive action with the **current user's own password**.
 * Owner → ADMIN_PASSWORD secret. Secondary user → their app_users password.
 */
async function checkConfirmPassword(
  env: Env,
  db: D1Database,
  authHeader: string | undefined,
  body: any,
): Promise<{ ok: true } | { ok: false; error: string; status: number; code: string }> {
  const provided = String(
    body?.confirm_password ?? body?.password_confirm ?? body?.password ?? '',
  );
  // Timed UI undo (10s) — session + role already checked by route gate
  if (!provided.trim() && (body?.confirm_mode === 'timed_undo' || body?.session_confirm === true)) {
    return { ok: true };
  }
  // No password typed → the session itself is the confirmation.
  // Delete/confirm dialogs never ask for a password anymore (product decision):
  // login + OTP + per-route role gates are the security boundary. If a legacy
  // client DOES send one, it is still verified below.
  if (!provided.trim()) {
    return { ok: true };
  }

  const session = sessionUserFromHeader(authHeader);
  const username = (session.username || '').toLowerCase();
  const role = session.role || 'user';
  const ownerUser = getOwnerUsername(env);

  // Owner (or legacy session): Cloudflare secret
  if (role === 'owner' || username === ownerUser) {
    const expected = getPassword(env);
    if (!expected) {
      return {
        ok: false,
        error: 'Le mot de passe administrateur n\'est pas configuré (secret ADMIN_PASSWORD).',
        status: 503,
        code: 'NO_PASSWORD_CONFIGURED',
      };
    }
    if (!passwordsMatch(provided, expected)) {
      // 403: wrong confirm password must NOT invalidate the active session
      return { ok: false, error: 'Mot de passe incorrect', status: 403, code: 'BAD_PASSWORD' };
    }
    return { ok: true };
  }

  // Secondary user: their own password
  await ensureSecurityTables(db);
  const row = await db.prepare(
    `SELECT * FROM app_users WHERE username = ? AND active = 1`
  ).bind(username).first() as any;
  if (!row) {
    return { ok: false, error: 'Session utilisateur invalide', status: 403, code: 'BAD_PASSWORD' };
  }
  if (!(await verifyUserPassword(provided, row.password_salt, row.password_hash))) {
    return { ok: false, error: 'Mot de passe incorrect', status: 403, code: 'BAD_PASSWORD' };
  }
  return { ok: true };
}

async function getReputation(db: D1Database, ip: string) {
  let row = await db.prepare(`SELECT * FROM ip_reputation WHERE ip = ?`).bind(ip).first();
  if (!row) {
    await db.prepare(`INSERT OR IGNORE INTO ip_reputation (ip, score, failed_count, success_count) VALUES (?, 50, 0, 0)`).bind(ip).run();
    row = { ip, score: 50, failed_count: 0, success_count: 0, blocked_until: null };
  }
  return row;
}

/** Password/OTP admission is account-aware, but explicit IP denials still win.
 * Never record a throttled request as another authentication failure.
 */
async function credentialAttemptGate(c: any, username: string, purpose: CredentialAttemptPurpose): Promise<Response | null> {
  try {
    const ip = clientIp(c);
    const rep = await getReputation(c.env.DB, ip) as any;
    const until = Date.parse(String(rep.blocked_until || ''));
    if (until > Date.now() || Number(rep.score ?? 50) <= 10) {
      const retryAfter = until > Date.now() ? Math.max(1, Math.ceil((until - Date.now()) / 1000)) : 900;
      c.header('Retry-After', String(retryAfter));
      return c.json({ success: false, code: 'RATE_LIMITED', error: 'Trop de tentatives. Réessayez plus tard.', retry_after: retryAfter }, 429);
    }
    const budget = await reserveCredentialAttempt(c.env.DB, ip, username, purpose);
    if (!budget.allowed) {
      c.header('Retry-After', String(budget.retryAfter));
      return c.json({ success: false, code: 'RATE_LIMITED', error: 'Trop de tentatives. Réessayez plus tard.', retry_after: budget.retryAfter }, 429);
    }
    return null;
  } catch {
    // No raw DB error, username, IP, password or OTP in logs/response.
    return c.json({ success: false, code: 'AUTH_LIMIT_UNAVAILABLE', error: 'Vérification de sécurité indisponible. Réessayez plus tard.' }, 503);
  }
}

async function isRateLimited(db: D1Database, ip: string): Promise<{ blocked: boolean; reason?: string }> {
  const rep = await getReputation(db, ip) as any;
  if (rep.blocked_until) {
    const until = new Date(rep.blocked_until).getTime();
    if (until > Date.now()) {
      return { blocked: true, reason: 'Trop de tentatives. Compte / IP temporairement bloqué. Réessayez plus tard.' };
    }
  }
  // Named password/OTP attempts already consume durable account-aware budgets
  // (delta 0). Do not let an unrelated legacy route re-ban their shared IP.
  const recent = await db.prepare(
    `SELECT COUNT(*) as c FROM login_attempts WHERE ip = ? AND success = 0 AND reputation_delta < 0 AND created_at > datetime('now', '-10 minutes')`
  ).bind(ip).first();
  const fails = Number(recent?.c || 0);
  if (fails >= 5) {
    const blockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await db.prepare(
      `UPDATE ip_reputation SET blocked_until = ?, score = MAX(0, score - 25), updated_at = datetime('now') WHERE ip = ?`
    ).bind(blockedUntil, ip).run();
    return { blocked: true, reason: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' };
  }
  if ((rep.score ?? 50) <= 10) {
    return { blocked: true, reason: 'Accès refusé (réputation IP). Contactez l’administrateur.' };
  }
  return { blocked: false };
}

async function recordLogin(db: D1Database, ip: string, fingerprint: string, success: boolean, userAgent: string, accountBudgeted = false) {
  // Budgeted password/OTP failures are isolated by account. Preserve telemetry,
  // but don't turn five unrelated failures into an automatic shared-IP score ban.
  // Legacy methods retain their existing reputation behavior.
  const delta = success ? 5 : accountBudgeted ? 0 : -8;
  await db.prepare(`INSERT INTO login_attempts (ip, fingerprint, success, reputation_delta, user_agent) VALUES (?, ?, ?, ?, ?)`).bind(ip, fingerprint || '', success ? 1 : 0, delta, userAgent || '').run();
  await getReputation(db, ip);
  if (accountBudgeted) {
    await db.prepare(`UPDATE ip_reputation SET score = MIN(100, score + ?),
      success_count = success_count + ?, failed_count = failed_count + ?, updated_at = datetime('now') WHERE ip = ?`)
      .bind(success ? 5 : 0, success ? 1 : 0, success ? 0 : 1, ip).run();
  } else if (success) {
    await db.prepare(`UPDATE ip_reputation SET score = MIN(100, score + 5), success_count = success_count + 1, failed_count = failed_count, blocked_until = NULL, updated_at = datetime('now') WHERE ip = ?`).bind(ip).run();
  } else {
    await db.prepare(`UPDATE ip_reputation SET score = MAX(0, score - 8), failed_count = failed_count + 1, updated_at = datetime('now') WHERE ip = ?`).bind(ip).run();
  }
}

async function authFailReason(
  authHeader: string | undefined,
  env: Env,
  db: D1Database,
  ip: string,
  fingerprint: string | undefined,
  opts?: { relaxSession?: boolean; allowRoleRefresh?: boolean },
): Promise<string> {
  if (!authHeader?.startsWith('Bearer ')) return 'missing';
  if (authHeader.slice(7).startsWith('np1.')) return await validateNativePilotToken(env, authHeader.slice(7), nativeCurrentIdentity) ? 'ok' : 'bad_token';
  const parsed = parseToken(authHeader.slice(7));
  if (!parsed) return 'bad_token';

  let roleChanged = false;
  if (parsed.version === 1) {
    const exp = getPassword(env);
    // Legacy v1 tokens embedded the raw password — reject them (force re-login → v2)
    return 'bad_password';
  } else {
    const user = (parsed.username || '').toLowerCase();
    const role = parsed.role || 'user';
    const proof = parsed.proof || '';
    const ownerUser = getOwnerUsername(env);
    if (user === ownerUser && role === 'owner') {
      const exp = getPassword(env);
      if (!exp) return 'bad_password';
      const ownerMaterial = await sha256Hex(`owner-key|${user}|${normalizePassword(exp)}`);
      const expectedProof = await makeSessionProof(user, 'owner', ownerMaterial, parsed.ip, parsed.fingerprint);
      if (proof !== expectedProof) return 'bad_password';
    } else {
      await ensureSecurityTables(db);
      const row = await db.prepare(
        `SELECT * FROM app_users WHERE username = ? AND active = 1`
      ).bind(user).first() as any;
      if (!row) return 'bad_password';
      // A stale role is proof of the same credential, not authority to use it.
      // It may only exchange for a current-role token at the dedicated endpoint.
      const expectedProof = await makeSessionProof(user, role, row.password_hash, parsed.ip, parsed.fingerprint);
      if (proof !== expectedProof) return 'bad_password';
      roleChanged = role !== row.role;
    }
  }

  // v0.7.5 — device revocation MUST kill live sessions (security audit finding):
  // a token whose fingerprint no longer has a trusted_devices row was revoked
  // remotely (« Appareils connectés » → révoquer). Every login path inserts the
  // row before handing out the token (trustDevice / touchTrustedDevice), and
  // /api/auth/me keeps re-touching it while the device is active — so a missing
  // row means « revoked », not « never seen ». Android signs out on any
  // authenticated 401; the web client drops to /login the same way.
  const revokedFp = parsed.fingerprint && parsed.fingerprint !== 'none' ? String(parsed.fingerprint).slice(0, 128) : '';
  if (revokedFp) {
    const dev = (await db
      .prepare(`SELECT username FROM trusted_devices WHERE fingerprint = ?`)
      .bind(revokedFp)
      .first()) as { username?: string } | null;
    if (!dev) return 'device_revoked';
    const devUser = String(dev.username || '').toLowerCase();
    const tokUser = String(parsed.username || '').toLowerCase();
    if (devUser && tokUser && devUser !== tokUser) return 'device_revoked';
  }

  if (opts?.relaxSession) return roleChanged && !opts?.allowRoleRefresh ? 'role_changed' : 'ok';
  // Device-bound sessions: fingerprint is the strong signal. Mobile / CGNAT / IPv6
  // often change IP mid-session — do not force re-login when the same device token is used.
  const tokenFp = parsed.fingerprint && parsed.fingerprint !== 'none' ? parsed.fingerprint : '';
  const reqFp = fingerprint && fingerprint !== 'none' ? fingerprint : '';
  if (tokenFp) {
    if (reqFp && reqFp !== tokenFp) return 'fp_changed';
    return roleChanged && !opts?.allowRoleRefresh ? 'role_changed' : 'ok';
  }
  // Legacy sessions without fingerprint: still bind to IP
  if (parsed.ip && ip && parsed.ip !== ip) {
    return 'ip_changed';
  }
  return roleChanged && !opts?.allowRoleRefresh ? 'role_changed' : 'ok';
}

/**
 * Extract the session identity from an Authorization header.
 *
 * SECURITY (2026-10-22, patrol finding): this function NEVER falls back to
 * 'owner'. It used to return the owner identity when the header was missing
 * or unparseable — every route gated only by requireOwner()/requireBizMutator()
 * (the 58 routes that were registered before the /api/* auth middleware, e.g.
 * /api/admin/r2/images, /api/admin/users, /api/admin/config, /api/admin/audit…)
 * was therefore world-open. Anonymous now means anonymous: gates reject, and
 * the auth middleware — registered FIRST, before every route — performs the
 * real verification (HMAC proof, IP/fingerprint binding) via authFailReason().
 * Callers must handle { username: '', role: '' } as "not authenticated".
 */
async function requireOwnerOrAdmin(c: any): Promise<{ ok: true } | { ok: false; response: any }> {
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), c.req.header('X-Device-Fingerprint') || '');
  if (reason !== 'ok') return { ok: false, response: c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401) };
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  if (session.role !== 'owner' && session.role !== 'admin') {
    return { ok: false, response: c.json({ success: false, error: 'Réservé owner/admin.', code: 'FORBIDDEN' }, 403) };
  }
  return { ok: true };
}

function sessionUserFromHeader(authHeader: string | undefined): { username: string; role: string } {
  const ANONYMOUS = { username: '', role: '' };
  if (!authHeader?.startsWith('Bearer ')) return ANONYMOUS;
  const native = parseNativePilotToken(authHeader.slice(7));
  if (native) return native; // only after the global authentication gate verifies its full hash
  const parsed = parseToken(authHeader.slice(7));
  if (!parsed) return ANONYMOUS;
  if (parsed.version === 2) {
    return { username: parsed.username || '', role: parsed.role || '' };
  }
  // Legacy v1 token (embeds the admin password): the auth middleware already
  // validated it against the stored credentials before we get here.
  return { username: getOwnerUsername({} as Env), role: 'admin' };
}

/* ─── Auth Routes ─── */

app.get('/api/auth/turnstile-config', (c) => {
  const siteKey = String(c.env.TURNSTILE_SITE_KEY || '').trim();
  const secretOk = !!(String(c.env.TURNSTILE_SECRET_KEY || '').trim());
  const isNative = isNativeAuthRequest(c, {
    client: c.req.query('client') || c.req.header('X-Atlas-Client') || '',
  });
  // Native APK / WebView: never expose site key. Browser only when both keys set.
  const enabled = !isNative && !!(siteKey && secretOk);
  return c.json({
    success: true,
    data: {
      enabled,
      site_key: enabled ? siteKey : null,
      web_only: true,
      native_skip: isNative,
    },
  });
});

app.post('/api/auth/login', async (c) => {
  let accountEmail = '';
  const body = await c.req.json().catch(() => ({}));
  const username = String(body.username ?? getOwnerUsername(c.env)).trim().toLowerCase();
  const password = String(body.password ?? '');
  const fingerprint = String(body.fingerprint || c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const ip = clientIp(c);
  const ua = c.req.header('User-Agent') || '';

  const turnstileToken = String(body.turnstile_token || body['cf-turnstile-response'] || '');
  const isNativeClient = isNativeAuthRequest(c, body as Record<string, unknown>);
  const ts = await verifyTurnstile(c.env, turnstileToken, ip, { native: isNativeClient });
  if (!ts.ok) {
    return c.json({ success: false, error: ts.error, code: 'TURNSTILE_FAILED' }, 403);
  }

  await ensureSecurityTables(c.env.DB);
  try { await purgeEphemeralSecurityData(c.env.DB); } catch { /* */ }

  const limitResponse = await credentialAttemptGate(c, username, 'password');
  if (limitResponse) return limitResponse;

  const ownerUser = getOwnerUsername(c.env);
  let role = 'user';
  let secretMaterial = '';
  let displayName = username;

  if (username === ownerUser) {
    // Original owner — password from Cloudflare secret ADMIN_PASSWORD
    const expected = getPassword(c.env);
    if (!expected) {
      return c.json({
        success: false,
        error: 'Le mot de passe administrateur n\'est pas configuré (secret ADMIN_PASSWORD).',
        code: 'NO_PASSWORD_CONFIGURED',
      }, 503);
    }
    if (!passwordsMatch(password, expected)) {
      await recordLogin(c.env.DB, ip, fingerprint, false, ua, true);
      await writeAudit(c.env.DB, { username, role: 'owner', action: 'auth.login_failed', entity: 'session', detail: 'bad_password', ip });
      const rep2 = await getReputation(c.env.DB, ip) as any;
      return c.json({
        success: false,
        error: 'Identifiant ou mot de passe incorrect',
        code: 'BAD_PASSWORD',
        reputationScore: rep2.score,
      }, 401);
    }
    role = 'owner';
    accountEmail = '';
    // Derive session material from password — never embed the raw ADMIN_PASSWORD in tokens
    secretMaterial = await sha256Hex(`owner-key|${ownerUser}|${normalizePassword(expected)}`);
    displayName = 'Administrateur';
  } else {
    // Secondary user from app_users table
    const row = await c.env.DB.prepare(
      `SELECT * FROM app_users WHERE username = ? AND active = 1`
    ).bind(username).first() as any;
    if (!row) {
      await recordLogin(c.env.DB, ip, fingerprint, false, ua, true);
      return c.json({ success: false, error: 'Identifiant ou mot de passe incorrect', code: 'BAD_PASSWORD' }, 401);
    }
    if (!(await verifyUserPassword(password, row.password_salt, row.password_hash))) {
      await recordLogin(c.env.DB, ip, fingerprint, false, ua, true);
      const ph = String(row.password_hash || '');
      const highIter = /^pbkdf2\$(\d+)\$/i.exec(ph);
      const iters = highIter ? parseInt(highIter[1], 10) : 0;
      if (iters > 100_000) {
        return c.json({
          success: false,
          error:
            'Ce compte utilise un ancien hachage mot de passe (120k itérations) incompatible avec la plateforme. Un administrateur doit réinitialiser le mot de passe depuis Admin → Utilisateurs.',
          code: 'PASSWORD_REHASH_REQUIRED',
        }, 401);
      }
      return c.json({ success: false, error: 'Identifiant ou mot de passe incorrect', code: 'BAD_PASSWORD' }, 401);
    }
    role = ['owner', 'admin', 'secretaire', 'stock', 'user'].includes(String(row.role))
      ? String(row.role)
      : 'user';
    // Never keep plaintext or weak hashes in D1 — upgrade to PBKDF2 on successful login
    let hashForSession = String(row.password_hash || '');
    if (!isModernPasswordHash(hashForSession)) {
      hashForSession = await upgradeUserPasswordHash(c.env.DB, Number(row.id), password);
    }
    secretMaterial = hashForSession;
    displayName = row.display_name || username;
    accountEmail = String(row?.email || '').trim();
    await c.env.DB.prepare(`UPDATE app_users SET last_login = datetime('now') WHERE id = ?`).bind(row.id).run();
  }

  // v0.7.5 — reprise après auto-déconnexion : même compte + même appareil +
  // marque resume_until valide (<= 30 j) + 2FA désactivée → pas d'OTP.
  // Le trou v0.7.1 reste fermé : un AUTRE compte sur l'appareil garde l'OTP.
  if (fingerprint && fingerprint !== 'none') {
    try {
      const twofaOn = (await getConfig(c.env.DB, 'twofa_enabled', '0')) === '1';
      if (!twofaOn) {
        // Atomic check + consumption: two simultaneous logins cannot both
        // reuse one marker. Password validation above remains mandatory.
        const rrow = await c.env.DB.prepare(
          `UPDATE trusted_devices SET resume_until = '', last_seen = datetime('now'), last_ip = ?
           WHERE fingerprint = ? AND lower(username) = ?
             AND resume_until != '' AND resume_until > datetime('now')
           RETURNING username`,
        ).bind(ip, fingerprint.slice(0, 128), username).first() as any;
        if (rrow) {
          await recordLogin(c.env.DB, ip, fingerprint, true, ua, true);
          await writeAudit(c.env.DB, { username, role, action: 'auth.login', entity: 'session', detail: 'resume_after_self_logout', ip });
          const resumeToken = await makeTokenV2(username, role, secretMaterial, ip, fingerprint);
          return c.json({
            success: true,
            needs_otp: false,
            trusted_device: true,
            token: resumeToken,
            ip,
            username,
            role,
            displayName,
            message: 'Appareil repris après votre déconnexion — code non requis.',
          });
        }
      }
    } catch { /* repli OTP */ }
  }

  // v0.7.1 — OTP REQUIRED FOR EVERY PASSWORD LOGIN (owner and users),
  // including first-ever login of a brand-new account and account switching
  // on an already-trusted device. The trusted-device shortcut was the hole:
  // being logged in as A on a trusted device let B sign in with no OTP.
  // (WebAuthn/passkey login stays a separate, possession-based flow.)

  // New device — OTP required (owner and users) — fast path: parallel DB + background email
  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const loginResourceId = fingerprint !== 'none' ? `fp:${fingerprint}` : `ip:${ip}`;
  const ctxJson = JSON.stringify({ username, role, secretMaterial });
  // Cloudflare Email binding only allows the configured destination (admin@).
  // security@ is valid as FROM only — never as TO or sends fail with "not allowed".
  const fromAddr = (c.env.OTP_FROM || (c.env as any).RESEND_FROM || 'noreply@afmarbre.com').trim() || 'security@afmarbre.com';
  // v235+v0.7.1 — the user's own inbox first; else the company MAIN email
  // (company_settings.email) until the user has one; else configured inbox.
  let toAddr = accountEmail;
  // One-tap verification link: the SPA /verify page submits the code itself
  // (and hands off to the PWA / native Android app when present) — the user
  // never types the OTP.
  const linkExp = new Date(expiresAt).getTime();
  const linkSig = await sha256Hex(`otplink|${username}|${otp}|${linkExp}|${secretMaterial}`);
  const verifyUrl =
    `https://stock.afmarbre.com/verify?user=${encodeURIComponent(username)}` +
    `&code=${encodeURIComponent(otp)}&sig=${linkSig}&exp=${linkExp}`;

  // Parallel: OTP rows + company name
  const [settings] = await Promise.all([
    c.env.DB.prepare(`SELECT company_name, email FROM company_settings WHERE id = 1`).first() as Promise<any>,
    c.env.DB.prepare(
      `INSERT INTO otp_codes (code, resource_type, resource_id, expires_at) VALUES (?, 'login', ?, ?)
       ON CONFLICT(resource_type, resource_id) DO UPDATE SET code = ?, expires_at = ?, created_at = datetime('now')`
    ).bind(otp, loginResourceId, expiresAt, otp, expiresAt).run(),
    c.env.DB.prepare(
      `INSERT INTO otp_codes (code, resource_type, resource_id, expires_at) VALUES (?, 'login_ctx', ?, ?)
       ON CONFLICT(resource_type, resource_id) DO UPDATE SET code = ?, expires_at = ?, created_at = datetime('now')`
    ).bind(ctxJson, loginResourceId, expiresAt, ctxJson, expiresAt).run(),
  ]);
  const companyName = settings?.company_name || 'Atlas Commerce';
  if (!toAddr) toAddr = String(settings?.email || '').trim();
  if (!toAddr) {
    toAddr = (c.env.OTP_TO || 'security@afmarbre.com').trim() || 'admin@afmarbre.com';
    if (toAddr.toLowerCase() === fromAddr.toLowerCase() || toAddr.toLowerCase() === 'security@afmarbre.com') {
      toAddr = 'admin@afmarbre.com';
    }
  }
  const emailHtml = otpEmailHTML(otp, 'connexion', companyName, 'login', {
    ip,
    ua,
    fingerprint: fingerprint !== 'none' ? fingerprint : undefined,
    username,
    verifyUrl,
  });
  const emailText =
    `Code de connexion Atlas : ${otp}\n` +
    `Compte : ${username}\n` +
    `IP : ${ip}\n` +
    `Empreinte : ${fingerprint}\n` +
    `Appareil : ${ua.slice(0, 160)}\n` +
    `Lien : ${verifyUrl}\n` +
    `Valable 10 minutes.`;

  // Free tier: no Queues (paid). Background email via waitUntil only — do not block the response.
  if (!c.env.EMAIL?.send) {
    // Local development without an e-mail binding: the OTP could never
    // arrive, so trust this device and continue. Production ALWAYS binds
    // EMAIL, therefore the e-mail OTP remains enforced everywhere else.
  await trustDevice(c.env.DB, fingerprint, ip, username, c.req.header('User-Agent') || '');
    await recordLogin(c.env.DB, ip, fingerprint, true, ua, true);
    await writeAudit(c.env.DB, { username, role, action: 'auth.login', entity: 'session', detail: 'dev_no_email_binding', ip });
    const devToken = await makeTokenV2(username, role, secretMaterial, ip, fingerprint);
    return c.json({
      success: true,
      needs_otp: false,
      trusted_device: true,
      token: devToken,
      ip,
      username,
      role,
      displayName,
      message: 'Environnement local sans service e-mail — appareil approuvé automatiquement.',
    });
  }
  // OTPs are never written to logs, including on development/preview hosts.
  const sendTask = sendOtpMail(c.env, {
    to: toAddr,
    from: fromAddr,
    subject: `Code de connexion — ${companyName} (${username})`,
    html: emailHtml,
    text: emailText,
  }).then((ok) => {
    if (!ok) console.error('otp_email_failed_all_transports', username);
  });
  try {
    const ec = (c as any).executionCtx;
    if (ec?.waitUntil) ec.waitUntil(sendTask);
    else void sendTask;
  } catch {
    void sendTask;
  }

  const masked = toAddr.replace(/^(.{2})[^@]*(@.*)$/, '$1•••$2');
  return c.json({
    success: true,
    needs_otp: true,
    emailed: true,
    username,
    otp_sent_to: masked,
    message: `Un code de vérification a été envoyé à ${masked}. Vérifiez votre boîte de réception.`,
  });
});

app.post('/api/auth/verify-otp', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const username = String(body.username ?? getOwnerUsername(c.env)).trim().toLowerCase();
  const password = String(body.password ?? '');
  const otp = String(body.otp || '').trim();
  const fingerprint = String(body.fingerprint || c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const ip = clientIp(c);
  const ua = c.req.header('User-Agent') || '';

  await ensureSecurityTables(c.env.DB);

  const loginResourceId = fingerprint !== 'none' ? `fp:${fingerprint}` : `ip:${ip}`;
  // Bind attempts to the server's pending login principal, not a username an
  // attacker can rotate while guessing one fingerprint-scoped OTP.
  const ctxRow = await c.env.DB.prepare(
    `SELECT * FROM otp_codes WHERE resource_type = 'login_ctx' AND resource_id = ? ORDER BY created_at DESC LIMIT 1`
  ).bind(loginResourceId).first() as any;
  let otpSubject = username;
  try { otpSubject = String(JSON.parse(ctxRow?.code || '{}').username || username).trim().toLowerCase(); } catch { /* legacy context fallback */ }
  const limitResponse = await credentialAttemptGate(c, otpSubject, 'otp');
  if (limitResponse) return limitResponse;
  if (otpSubject !== username) {
    await recordLogin(c.env.DB, ip, fingerprint, false, ua, true);
    return c.json({ success: false, error: 'Code incorrect', code: 'BAD_OTP' }, 401);
  }

  if (!otp || otp.length < 4) {
    return c.json({ success: false, error: 'Code OTP obligatoire', code: 'OTP_REQUIRED' }, 400);
  }

  const record = await c.env.DB.prepare(
    `SELECT * FROM otp_codes WHERE resource_type = 'login' AND resource_id = ? ORDER BY created_at DESC LIMIT 1`
  ).bind(loginResourceId).first() as any;

  if (!record) {
    return c.json({
      success: false,
      error: 'Aucun code demandé. Veuillez d\'abord saisir votre mot de passe.',
      code: 'OTP_NOT_REQUESTED',
    }, 400);
  }
  if (record.code !== otp) {
    await recordLogin(c.env.DB, ip, fingerprint, false, ua, true);
    return c.json({ success: false, error: 'Code incorrect', code: 'BAD_OTP' }, 401);
  }
  if (new Date(record.expires_at) < new Date()) {
    return c.json({
      success: false,
      error: 'Code expiré. Veuillez recommencer la connexion.',
      code: 'OTP_EXPIRED',
    }, 400);
  }

  // Restore the already-loaded server login context.
  let role = 'owner';
  let secretMaterial = '';
  let user = username;

  if (ctxRow?.code) {
    try {
      const ctx = JSON.parse(ctxRow.code);
      user = ctx.username || username;
      role = ctx.role || 'owner';
      secretMaterial = ctx.secretMaterial || '';
    } catch { /* fall through */ }
  }

  if (!secretMaterial) {
    // Re-validate password to rebuild secret
    const ownerUser = getOwnerUsername(c.env);
    if (user === ownerUser) {
      const expected = getPassword(c.env);
      if (!expected || !passwordsMatch(password, expected)) {
        return c.json({ success: false, error: 'Mot de passe incorrect', code: 'BAD_PASSWORD' }, 401);
      }
      role = 'owner';
      secretMaterial = await sha256Hex(`owner-key|${ownerUser}|${normalizePassword(expected)}`);
    } else {
      const row = await c.env.DB.prepare(`SELECT * FROM app_users WHERE username = ? AND active = 1`).bind(user).first() as any;
      if (!row) return c.json({ success: false, error: 'Utilisateur introuvable', code: 'BAD_PASSWORD' }, 401);
      if (!(await verifyUserPassword(password, row.password_salt, row.password_hash))) {
        const ph = String(row.password_hash || '');
        const highIter = /^pbkdf2\$(\d+)\$/i.exec(ph);
        const iters = highIter ? parseInt(highIter[1], 10) : 0;
        if (iters > 100_000) {
          return c.json({
            success: false,
            error: 'Ancien hachage mot de passe (120k) — un admin doit réinitialiser le mot de passe.',
            code: 'PASSWORD_REHASH_REQUIRED',
          }, 401);
        }
        return c.json({ success: false, error: 'Mot de passe incorrect', code: 'BAD_PASSWORD' }, 401);
      }
      role = row.role;
      let hashForSession = String(row.password_hash || '');
      if (!isModernPasswordHash(hashForSession)) {
        hashForSession = await upgradeUserPasswordHash(c.env.DB, Number(row.id), password);
      }
      secretMaterial = hashForSession;
    }
  }

  await c.env.DB.prepare(`DELETE FROM otp_codes WHERE resource_type = 'login' AND resource_id = ?`).bind(loginResourceId).run();
  await c.env.DB.prepare(`DELETE FROM otp_codes WHERE resource_type = 'login_ctx' AND resource_id = ?`).bind(loginResourceId).run();
  // Best-effort: sweep all expired security rows
  try { await purgeEphemeralSecurityData(c.env.DB); } catch { /* */ }

  await trustDevice(c.env.DB, fingerprint, ip, username, c.req.header('User-Agent') || '');
  await recordLogin(c.env.DB, ip, fingerprint, true, ua, true);
  const rep = await getReputation(c.env.DB, ip) as any;
  const token = await makeTokenV2(user, role, secretMaterial, ip, fingerprint);
  return c.json({
    success: true,
    trusted_device: true,
    token,
    ip,
    username: user,
    role,
    reputationScore: rep.score,
  });
});

/* ─── One-tap e-mail verification link (2026-10-23) ───────────────────────
 * The OTP e-mail carries a signed link (?user&code&sig&exp). Opening it —
 * in the browser, the installed PWA, or the native Android app — verifies
 * the device WITHOUT typing the code: possession of the signed link is the
 * first factor, the OTP row check the second. Single use: the login rows are
 * consumed on success. Cross-device by design (mail opened on the phone
 * while the PC requested the login): the OTP row is looked up by code, not
 * by requesting fingerprint. Signature = sha256(otplink|user|otp|exp|secret)
 * so a leaked URL cannot be replayed after expiry nor tampered with.
 * ──────────────────────────────────────────────────────────────────────── */
app.post('/api/auth/verify-link', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const username = String(body.username ?? '').trim().toLowerCase();
  const otp = String(body.otp || '').trim();
  const sig = String(body.sig || '');
  const exp = Number(body.exp || 0);
  const fingerprint = String(body.fingerprint || c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const ip = clientIp(c);
  const ua = c.req.header('User-Agent') || '';

  await ensureSecurityTables(c.env.DB);
  const limitResponse = await credentialAttemptGate(c, username, 'otp');
  if (limitResponse) return limitResponse;
  if (!username || !otp || otp.length < 4 || !sig || !exp) {
    return c.json({ success: false, error: 'Lien de vérification incomplet', code: 'LINK_MALFORMED' }, 400);
  }
  if (Date.now() > exp) {
    return c.json({ success: false, error: 'Lien expiré — reconnectez-vous', code: 'LINK_EXPIRED' }, 400);
  }

  // Device-independent lookup: the e-mail may be opened anywhere.
  const record = await c.env.DB.prepare(
    `SELECT * FROM otp_codes WHERE resource_type = 'login' AND code = ? ORDER BY created_at DESC LIMIT 1`,
  ).bind(otp).first() as any;
  if (!record) return c.json({ success: false, error: 'Code invalide ou déjà utilisé', code: 'BAD_OTP' }, 401);
  if (new Date(record.expires_at) < new Date()) {
    return c.json({ success: false, error: 'Code expiré. Veuillez recommencer la connexion.', code: 'OTP_EXPIRED' }, 400);
  }

  let user = username;
  let role = 'owner';
  let secretMaterial = '';
  const ctxRow = await c.env.DB.prepare(
    `SELECT * FROM otp_codes WHERE resource_type = 'login_ctx' AND resource_id = ? ORDER BY created_at DESC LIMIT 1`,
  ).bind(record.resource_id).first() as any;
  if (ctxRow?.code) {
    try {
      const ctx = JSON.parse(ctxRow.code);
      user = ctx.username || user;
      role = ctx.role || 'owner';
      secretMaterial = ctx.secretMaterial || '';
    } catch { /* fall through */ }
  }
  if (String(user).trim().toLowerCase() !== username) {
    await recordLogin(c.env.DB, ip, fingerprint, false, ua, true);
    return c.json({ success: false, error: 'Lien invalide', code: 'LINK_INVALID' }, 401);
  }
  if (!secretMaterial) {
    secretMaterial = (await secretMaterialForUsername(c.env, c.env.DB, user, role)) || '';
  }
  if (!secretMaterial) return c.json({ success: false, error: 'Compte introuvable', code: 'BAD_PASSWORD' }, 401);

  // Constant-time signature check (recomputed exactly as at send time)
  const expected = await sha256Hex(`otplink|${user}|${otp}|${exp}|${secretMaterial}`);
  const a = expected.length === sig.length ? expected : expected + '\x00';
  const b = expected.length === sig.length ? sig : sig + '\x00';
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  if (diff !== 0 || expected.length !== sig.length) {
    await recordLogin(c.env.DB, ip, fingerprint, false, ua, true);
    return c.json({ success: false, error: 'Signature du lien invalide', code: 'LINK_INVALID' }, 401);
  }

  // Single use: consume the login rows wherever they live
  await c.env.DB.prepare(`DELETE FROM otp_codes WHERE resource_type = 'login' AND resource_id = ?`).bind(record.resource_id).run();
  await c.env.DB.prepare(`DELETE FROM otp_codes WHERE resource_type = 'login_ctx' AND resource_id = ?`).bind(record.resource_id).run();
  try { await purgeEphemeralSecurityData(c.env.DB); } catch { /* */ }

  await trustDevice(c.env.DB, fingerprint, ip, username, c.req.header('User-Agent') || '');
  await recordLogin(c.env.DB, ip, fingerprint, true, ua, true);
  const rep = await getReputation(c.env.DB, ip) as any;
  const token = await makeTokenV2(user, role, secretMaterial, ip, fingerprint);
  return c.json({
    success: true,
    trusted_device: true,
    verified_via: 'email-link',
    token,
    ip,
    username: user,
    role,
    reputationScore: rep.score,
  });
});


/* ─── QR login (PC shows code, phone scans — one-time, 60s) ─── */

async function secretMaterialForUsername(env: Env, db: D1Database, username: string, role: string): Promise<string | null> {
  const ownerUser = getOwnerUsername(env);
  const u = String(username || '').trim().toLowerCase();
  if (!u) return null;
  if (u === ownerUser || role === 'owner') {
    const expected = getPassword(env);
    if (!expected) return null;
    return sha256Hex(`owner-key|${ownerUser}|${normalizePassword(expected)}`);
  }
  const row = await db.prepare(`SELECT password_hash FROM app_users WHERE username = ? AND active = 1`).bind(u).first() as any;
  if (!row?.password_hash) return null;
  return String(row.password_hash);
}

function randomQrToken(): string {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}


/** Versioned desktop flow: reuse existing proof validation, trust and v2 format. */
registerDesktopNativeDiscovery(app);
registerDesktopPilotWebView(app);

// Verify the actual token fingerprint and database role; neither the declared
// fingerprint nor the parsed role alone constitutes an identity.
async function nativeCurrentIdentity(env: Env, username: string, role: string) {
  if (!username || username !== username.toLowerCase()) return null;
  if (username === getOwnerUsername(env)) {
    if (role !== 'owner') return null;
    const material = await secretMaterialForUsername(env, env.DB, username, role);
    return material ? { username, role, material, userId: null } : null;
  }
  if (!['admin', 'secretaire', 'stock', 'user'].includes(role)) return null;
  const row: any = await env.DB.prepare('SELECT id, role, password_hash FROM app_users WHERE username = ? AND active = 1').bind(username).first();
  if (!row || row.role !== role || !row.password_hash || !Number.isSafeInteger(row.id) || row.id <= 0) return null;
  return { username, role, material: String(row.password_hash), userId: Number(row.id) };
}
registerDesktopNativeV2(app, {
  currentIdentity: nativeCurrentIdentity,
  pilotPassword: async (env, username, password) => {
    // One explicitly configured non-owner test account; no legacy or weak hashes.
    const configured = String(env.DESKTOP_NATIVE_V2_PILOT_USERNAME || '').trim().toLowerCase();
    const row: any = username === configured && username !== getOwnerUsername(env) ? await env.DB.prepare('SELECT id, username, role, password_salt, password_hash FROM app_users WHERE username=? AND active=1').bind(username).first() : null;
    const validRow = row && ['admin', 'secretaire', 'stock', 'user'].includes(row.role) && /^pbkdf2\$100000\$[a-f0-9]{64}$/i.test(String(row.password_hash || ''));
    const salt = validRow ? String(row.password_salt) : 'atlas-native-staging-dummy-salt';
    const actual = await derivePbkdf2Bits(password, salt, 100000);
    const expected = validRow ? String(row.password_hash).split('$')[2].toLowerCase() : '0'.repeat(64);
    let diff = 0; for (let i = 0; i < 64; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
    return validRow && diff === 0 ? { username, role: String(row.role), material: String(row.password_hash), userId: Number(row.id) } : null;
  },
  pilotSendOtp: async (env, otp) => {
    if (!env.EMAIL?.send) return false;
    try { await env.EMAIL.send({ to: env.DESKTOP_NATIVE_V2_PILOT_OTP_TO!, from: env.DESKTOP_NATIVE_V2_PILOT_OTP_FROM!, subject: 'Atlas staging — code de connexion', text: `Code de test : ${otp}\nValable pendant cinq minutes au maximum. Ne partagez jamais ce code.` }); return true; } catch { return false; }
  },
  phoneIdentity: async (c, ip, fp) => {
    const header = c.req.header('Authorization');
    if (!header?.startsWith('Bearer ')) return null;
    const parsed = parseToken(header.slice(7));
    if (!parsed || parsed.version !== 2 || !parsed.username || parsed.fingerprint !== fp || !parsed.role) return null;
    if (await authFailReason(header, c.env, c.env.DB, ip, fp) !== 'ok') return null;
    const trusted: any = await c.env.DB.prepare('SELECT username FROM trusted_devices WHERE fingerprint = ?').bind(fp).first();
    if (!trusted?.username || String(trusted.username).toLowerCase() !== parsed.username.toLowerCase()) return null;
    return nativeCurrentIdentity(c.env, parsed.username, parsed.role);
  },
  mint: makeTokenV2,
});

registerDesktopAuthRoutes(app, {
  ip: clientIp,
  authenticate: async c => {
    const fp = c.req.header('X-Device-Fingerprint') || '';
    const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), fp);
    return reason === 'ok' ? sessionUserFromHeader(c.req.header('Authorization')) : null;
  },
  material: async (env, username, role) => {
    if (username === getOwnerUsername(env)) {
      return role === 'owner' ? secretMaterialForUsername(env, env.DB, username, role) : null;
    }
    const row = await env.DB.prepare('SELECT password_hash, role FROM app_users WHERE username = ? AND active = 1').bind(username).first() as any;
    return row && row.role === role ? String(row.password_hash) : null;
  },
  mint: makeTokenV2,
  trust: async (env, fp, ip, username, ua) => { await trustDevice(env.DB, fp, ip, username, ua); },
  audit: async (c, identity, event) => {
    if (event === 'exchange') {
      try { await recordLogin(c.env.DB, clientIp(c), c.req.header('X-Device-Fingerprint') || '', true, c.req.header('User-Agent') || ''); } catch { /* best effort */ }
    }
    await writeAudit(c.env.DB, {
      ...identity, action: `auth.desktop_${event}`, entity: 'session', detail: 'desktop_v1', ip: clientIp(c),
    });
  },
});

/** Public: PC login page QR — phone (logged-in) scans to authenticate this browser */
app.post('/api/auth/qr/pc-session', async (c) => {
  await ensureSecurityTables(c.env.DB);
  const token = randomQrToken();
  const expiresAt = new Date(Date.now() + 60 * 1000).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO qr_login_sessions (token, username, role, created_by, status, expires_at) VALUES (?, '', '', 'pc-login', 'pending', ?)`
  ).bind(token, expiresAt).run();
  const origin = new URL(c.req.url).origin;
  const qrUrl = `${origin}/login/qr?t=${token}&mode=pc`;
  let qrSvg = '';
  try {
    const { qrToSvg } = await import('./qrSvg');
    qrSvg = qrToSvg(qrUrl, 200, 2);
  } catch { /* */ }
  try {
    await qrDoPut(c.env, token, {
      status: 'pending',
      username: '',
      role: '',
      created_by: 'pc-login',
      expires_at: expiresAt,
      _schedule_alarm: true,
    });
  } catch { /* */ }
  return c.json({
    success: true,
    data: { token, expires_at: expiresAt, expires_in: 60, qr_url: qrUrl, qr_svg: qrSvg },
  });
});


/** Deterministic default avatar (SVG data URI) when user has no photo */

/** QR session DO (idFromName qr:token) — hot path off D1 for free-tier CPU. */
function qrSessionStub(env: Env, token: string) {
  if (!env.MOBILE_HUB || !token) return null;
  try {
    const id = env.MOBILE_HUB.idFromName('qr:' + String(token).slice(0, 64));
    return env.MOBILE_HUB.get(id);
  } catch {
    return null;
  }
}

async function qrDoGet(env: Env, token: string): Promise<any | null> {
  const stub = qrSessionStub(env, token);
  if (!stub) return null;
  try {
    const res = await stub.fetch('https://do/qr', { method: 'GET' });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null) as any;
    return j?.data || null;
  } catch {
    return null;
  }
}

async function qrDoPut(env: Env, token: string, body: Record<string, unknown>): Promise<any | null> {
  const stub = qrSessionStub(env, token);
  if (!stub) return null;
  try {
    const res = await stub.fetch('https://do/qr', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null) as any;
    return j?.data || null;
  } catch {
    return null;
  }
}

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


/** Phone (already logged in): bind account to PC QR session and approve */
app.post('/api/auth/qr/session/:token/phone-bind', async (c) => {
  const fingerprint = String(c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), fingerprint);
  if (reason !== 'ok') {
    return c.json({ success: false, error: 'Connectez-vous sur le téléphone d’abord', code: 'UNAUTHORIZED' }, 401);
  }
  await ensureSecurityTables(c.env.DB);
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const token = String(c.req.param('token') || '').slice(0, 64);
  const body = await c.req.json().catch(() => ({}));
  const phoneFp = String(body.fingerprint || fingerprint).slice(0, 128);
  const ua = String(body.user_agent || c.req.header('User-Agent') || '').slice(0, 240);
  const ip = clientIp(c);

  const row = await c.env.DB.prepare(`SELECT * FROM qr_login_sessions WHERE token = ?`).bind(token).first() as any;
  if (!row) return c.json({ success: false, error: 'QR invalide', code: 'NOT_FOUND' }, 404);
  if (new Date(row.expires_at) < new Date()) {
    await c.env.DB.prepare(`UPDATE qr_login_sessions SET status = 'expired' WHERE token = ?`).bind(token).run();
    return c.json({ success: false, error: 'QR expiré', code: 'EXPIRED' }, 410);
  }
  if (row.status === 'consumed' || row.status === 'denied') {
    return c.json({ success: false, error: 'QR déjà utilisé', code: 'USED' }, 409);
  }

  const confirm = body.confirm === true || body.confirm === 'true' || body.approve === true;
  const nextStatus = confirm ? 'approved' : 'claimed';
  await c.env.DB.prepare(
    `UPDATE qr_login_sessions SET status = ?, username = ?, role = ?, claim_fingerprint = ?, claim_ua = ?, claim_ip = ? WHERE token = ?`
  ).bind(nextStatus, session.username, session.role, phoneFp, ua, ip, token).run();

  const profile = await resolveUserProfileAvatar(c.env, session.username);
  try {
    await qrDoPut(c.env, token, {
      status: nextStatus,
      username: session.username,
      role: session.role,
      claim_fingerprint: phoneFp,
      display_name: profile.display_name,
      avatar_url: profile.avatar_url,
    });
  } catch { /* */ }

  return c.json({
    success: true,
    data: {
      status: nextStatus,
      username: session.username,
      role: session.role,
      display_name: profile.display_name,
      avatar_url: profile.avatar_url,
      message: confirm
        ? 'PC autorisé — finalisez sur l’ordinateur.'
        : 'Confirmez sur le téléphone pour autoriser cet ordinateur.',
      needs_confirm: !confirm,
    },
  });
});

/** PC: create a 60s one-time QR session for self or (owner/admin) another user */
app.post('/api/auth/qr/session', async (c) => {
  const fingerprint = String(c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), fingerprint);
  if (reason !== 'ok') {
    return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  }
  await ensureSecurityTables(c.env.DB);
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const body = await c.req.json().catch(() => ({}));
  let targetUser = String(body.username || session.username || '').trim().toLowerCase();
  let targetRole = session.role || 'user';

  if (body.username && String(body.username).toLowerCase() !== session.username) {
    if (session.role !== 'owner' && session.role !== 'admin') {
      return c.json({ success: false, error: 'Seuls owner/admin peuvent générer un QR pour un autre compte', code: 'FORBIDDEN' }, 403);
    }
    const ownerUser = getOwnerUsername(c.env);
    if (targetUser === ownerUser) {
      targetRole = 'owner';
    } else {
      const row = await c.env.DB.prepare(`SELECT username, role FROM app_users WHERE username = ? AND active = 1`).bind(targetUser).first() as any;
      if (!row) return c.json({ success: false, error: 'Utilisateur introuvable', code: 'NOT_FOUND' }, 404);
      targetRole = String(row.role || 'user');
    }
  }

  // Expire previous pending sessions for this creator
  await c.env.DB.prepare(
    `UPDATE qr_login_sessions SET status = 'expired' WHERE created_by = ? AND status IN ('pending','claimed')`
  ).bind(session.username).run();

  const token = randomQrToken();
  const expiresAt = new Date(Date.now() + 60 * 1000).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO qr_login_sessions (token, username, role, created_by, status, expires_at) VALUES (?, ?, ?, ?, 'pending', ?)`
  ).bind(token, targetUser, targetRole, session.username, expiresAt).run();

  const origin = new URL(c.req.url).origin;
  const qrUrl = `${origin}/login/qr?t=${token}`;
  let qrSvg = '';
  try {
    const { qrToSvg } = await import('./qrSvg');
    qrSvg = qrToSvg(qrUrl, 220, 2);
  } catch {
    qrSvg = '';
  }

  try {
    await qrDoPut(c.env, token, {
      status: 'pending',
      username: targetUser,
      role: targetRole,
      created_by: session.username,
      expires_at: expiresAt,
      _schedule_alarm: true,
    });
  } catch { /* */ }
  return c.json({
    success: true,
    data: {
      token,
      expires_at: expiresAt,
      expires_in: 60,
      qr_url: qrUrl,
      qr_svg: qrSvg,
      username: targetUser,
      role: targetRole,
    },
  });
});

/** Public: status — Durable Object first (fast), D1 fallback */
app.get('/api/auth/qr/session/:token', async (c) => {
  const token = String(c.req.param('token') || '').slice(0, 64);
  if (!token) return c.json({ success: false, error: 'Session introuvable', code: 'NOT_FOUND' }, 404);

  const fromDoRaw = await qrDoGet(c.env, token);
  // v0.7.7 — self-heal : une copie DO bloquée à « pending » ne doit plus masquer
  // un claim écrit en D1 (sessions créées avant le write-through).
  const fromDo =
    fromDoRaw && String(fromDoRaw.status || 'pending') === 'pending'
      ? await (async () => {
          try {
            const d1 = await c.env.DB.prepare(
              `SELECT status, username, role FROM qr_login_sessions WHERE token = ?`,
            ).bind(token).first() as any;
            if (d1 && String(d1.status || 'pending') !== 'pending') {
              await qrDoPut(c.env, token, { status: String(d1.status), username: d1.username, role: d1.role });
              return { ...fromDoRaw, status: String(d1.status), username: d1.username || fromDoRaw.username, role: d1.role || fromDoRaw.role };
            }
          } catch { /* */ }
          return fromDoRaw;
        })()
      : fromDoRaw;
  if (fromDo) {
    const uname = String(fromDo.username || '').trim();
    let displayName = String(fromDo.display_name || uname);
    let avatarUrl = String(fromDo.avatar_url || '');
    if (uname && (!avatarUrl || avatarUrl.startsWith('data:image/svg'))) {
      try {
        const profile = await resolveUserProfileAvatar(c.env, uname);
        if (profile.display_name) displayName = profile.display_name;
        if (profile.avatar_url) avatarUrl = profile.avatar_url;
      } catch { /* */ }
    }
    return c.json({
      success: true,
      data: {
        status: fromDo.status || 'pending',
        username: uname,
        display_name: displayName,
        avatar_url: avatarUrl,
        role: fromDo.role || '',
        created_by: fromDo.created_by || '',
        expires_at: fromDo.expires_at,
        claim_fingerprint: fromDo.claim_fingerprint || '',
        has_device: !!fromDo.has_device,
      },
    });
  }

  let row: any = null;
  try {
    row = await c.env.DB.prepare(
      `SELECT status, username, role, created_by, expires_at, claim_fingerprint FROM qr_login_sessions WHERE token = ?`
    ).bind(token).first();
  } catch {
    return c.json({ success: false, error: 'Session introuvable', code: 'NOT_FOUND' }, 404);
  }
  if (!row) return c.json({ success: false, error: 'Session introuvable', code: 'NOT_FOUND' }, 404);
  let status = String(row.status || 'pending');
  if (status !== 'consumed' && status !== 'denied' && row.expires_at && new Date(row.expires_at) < new Date()) {
    status = 'expired';
  }
  const uname = String(row.username || '').trim();
  const profile = uname ? await resolveUserProfileAvatar(c.env, uname) : { display_name: '', avatar_url: '' };
  return c.json({
    success: true,
    data: {
      status,
      username: uname,
      display_name: profile.display_name || uname,
      avatar_url: profile.avatar_url,
      role: row.role || '',
      created_by: row.created_by || '',
      expires_at: row.expires_at,
      claim_fingerprint: row.claim_fingerprint ? String(row.claim_fingerprint).slice(0, 12) + '…' : '',
      has_device: !!row.claim_fingerprint,
    },
  });
});

/** Phone: claim the session after scanning */
app.post('/api/auth/qr/session/:token/claim', async (c) => {
  await ensureSecurityTables(c.env.DB);
  const token = String(c.req.param('token') || '').slice(0, 64);
  const body = await c.req.json().catch(() => ({}));
  const fingerprint = String(body.fingerprint || c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const ua = String(body.user_agent || c.req.header('User-Agent') || '').slice(0, 240);
  const ip = clientIp(c);

  const row = await c.env.DB.prepare(`SELECT * FROM qr_login_sessions WHERE token = ?`).bind(token).first() as any;
  if (!row) return c.json({ success: false, error: 'QR invalide', code: 'NOT_FOUND' }, 404);
  if (new Date(row.expires_at) < new Date()) {
    await c.env.DB.prepare(`UPDATE qr_login_sessions SET status = 'expired' WHERE token = ?`).bind(token).run();
    try { await qrDoPut(c.env, token, { status: 'expired' }); } catch { /* */ }
    return c.json({ success: false, error: 'QR expiré — regénérez-le sur l’ordinateur', code: 'EXPIRED' }, 410);
  }
  if (row.status === 'consumed' || row.status === 'denied' || row.status === 'expired') {
    return c.json({ success: false, error: 'QR déjà utilisé ou annulé', code: 'USED' }, 409);
  }
  if (row.status === 'claimed' && row.claim_fingerprint && row.claim_fingerprint !== fingerprint) {
    return c.json({ success: false, error: 'Ce QR est déjà lié à un autre appareil', code: 'OTHER_DEVICE' }, 409);
  }

  await c.env.DB.prepare(
    `UPDATE qr_login_sessions SET status = 'claimed', claim_fingerprint = ?, claim_ua = ?, claim_ip = ? WHERE token = ?`
  ).bind(fingerprint, ua, ip, token).run();
  // v0.7.7 — write-through : le poll PC lit le Durable Object EN PREMIER ;
  // sans ce put la copie DO restait « pending » et le PC ne voyait jamais le scan.
  try {
    await qrDoPut(c.env, token, {
      status: 'claimed',
      username: row.username,
      role: row.role,
      claim_fingerprint: fingerprint,
    });
  } catch { /* */ }

  return c.json({
    success: true,
    data: {
      status: 'claimed',
      username: row.username,
      role: row.role,
      message: 'En attente de validation sur l’ordinateur…',
    },
  });
});

/** PC: approve claimed device → phone can fetch token once */
app.post('/api/auth/qr/session/:token/approve', async (c) => {
  const fingerprint = String(c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), fingerprint);
  if (reason !== 'ok') return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  await ensureSecurityTables(c.env.DB);
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const token = String(c.req.param('token') || '').slice(0, 64);
  const row = await c.env.DB.prepare(`SELECT * FROM qr_login_sessions WHERE token = ?`).bind(token).first() as any;
  if (!row) return c.json({ success: false, error: 'Session introuvable', code: 'NOT_FOUND' }, 404);
  if (row.created_by !== session.username && session.role !== 'owner' && session.role !== 'admin') {
    return c.json({ success: false, error: 'Non autorisé', code: 'FORBIDDEN' }, 403);
  }
  if (row.status !== 'claimed') {
    return c.json({ success: false, error: 'En attente du scan téléphone', code: 'NOT_CLAIMED' }, 400);
  }
  if (new Date(row.expires_at) < new Date()) {
    await c.env.DB.prepare(`UPDATE qr_login_sessions SET status = 'expired' WHERE token = ?`).bind(token).run();
    return c.json({ success: false, error: 'Expiré', code: 'EXPIRED' }, 410);
  }
  await c.env.DB.prepare(`UPDATE qr_login_sessions SET status = 'approved' WHERE token = ?`).bind(token).run();
  try { await qrDoPut(c.env, token, { status: 'approved', username: row.username, role: row.role }); } catch { /* */ }
  await writeAudit(c.env.DB, {
    username: session.username,
    role: session.role,
    action: 'auth.qr_approve',
    entity: 'qr_login',
    detail: `user=${row.username} fp=${String(row.claim_fingerprint || '').slice(0, 16)}`,
    ip: clientIp(c),
  });
  return c.json({ success: true, data: { status: 'approved' } });
});

/** PC: deny */
app.post('/api/auth/qr/session/:token/deny', async (c) => {
  const fingerprint = String(c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), fingerprint);
  if (reason !== 'ok') return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  await ensureSecurityTables(c.env.DB);
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const token = String(c.req.param('token') || '').slice(0, 64);
  const row = await c.env.DB.prepare(`SELECT * FROM qr_login_sessions WHERE token = ?`).bind(token).first() as any;
  if (!row) return c.json({ success: false, error: 'Session introuvable', code: 'NOT_FOUND' }, 404);
  if (row.created_by !== session.username && session.role !== 'owner' && session.role !== 'admin') {
    return c.json({ success: false, error: 'Non autorisé', code: 'FORBIDDEN' }, 403);
  }
  await c.env.DB.prepare(`UPDATE qr_login_sessions SET status = 'denied' WHERE token = ?`).bind(token).run();
  try { await qrDoPut(c.env, token, { status: 'denied' }); } catch { /* */ }
  return c.json({ success: true, data: { status: 'denied' } });
});

/** Phone: after approve, fetch JWT once (one-time) */
app.post('/api/auth/qr/session/:token/complete', async (c) => {
  await ensureSecurityTables(c.env.DB);
  const token = String(c.req.param('token') || '').slice(0, 64);
  const body = await c.req.json().catch(() => ({}));
  const fingerprint = String(body.fingerprint || c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const ip = clientIp(c);
  const ua = c.req.header('User-Agent') || '';

  const row = await c.env.DB.prepare(`SELECT * FROM qr_login_sessions WHERE token = ?`).bind(token).first() as any;
  if (!row) return c.json({ success: false, error: 'Session introuvable', code: 'NOT_FOUND' }, 404);
  if (row.status === 'consumed') {
    return c.json({ success: false, error: 'Déjà utilisé', code: 'USED' }, 409);
  }
  if (row.status === 'denied' || row.status === 'expired') {
    return c.json({ success: false, error: 'Refusé ou expiré', code: row.status.toUpperCase() }, 410);
  }
  if (row.status !== 'approved') {
    return c.json({ success: false, error: 'Pas encore approuvé', code: 'WAIT', status: row.status }, 202);
  }
  // Settings flow (phone logs in): fingerprint must match claim.
  // PC-login flow (phone authorizes PC): PC fingerprint differs from phone — allow when created_by = pc-login.
  if (row.created_by !== 'pc-login' && row.claim_fingerprint && row.claim_fingerprint !== fingerprint) {
    return c.json({ success: false, error: 'Appareil différent du scan', code: 'DEVICE_MISMATCH' }, 403);
  }
  if (!row.username) {
    return c.json({ success: false, error: 'Compte non lié', code: 'NO_USER' }, 400);
  }

  const secretMaterial = await secretMaterialForUsername(c.env, c.env.DB, row.username, row.role);
  if (!secretMaterial) {
    return c.json({ success: false, error: 'Compte indisponible', code: 'NO_SECRET' }, 500);
  }

  // Mark consumed BEFORE issuing token (one-time)
  const upd = await c.env.DB.prepare(
    `UPDATE qr_login_sessions SET status = 'consumed', consumed_at = datetime('now') WHERE token = ? AND status = 'approved'`
  ).bind(token).run();
  if (!(upd as any)?.meta?.changes && !(upd as any)?.success) {
    // D1 returns success differently — re-check
    const again = await c.env.DB.prepare(`SELECT status FROM qr_login_sessions WHERE token = ?`).bind(token).first() as any;
    if (again?.status === 'consumed') {
      return c.json({ success: false, error: 'Déjà utilisé', code: 'USED' }, 409);
    }
  }
  try { await qrDoPut(c.env, token, { status: 'consumed', username: row.username, role: row.role }); } catch { /* */ }

  const authToken = await makeTokenV2(row.username, row.role, secretMaterial, ip, fingerprint);
  try {
    await trustDevice(c.env.DB, fingerprint, ip, String(row.username || ''), c.req.header('User-Agent') || '');
  } catch { /* */ }
  await recordLogin(c.env.DB, ip, fingerprint, true, ua);
  await writeAudit(c.env.DB, {
    username: row.username,
    role: row.role,
    action: 'auth.qr_login',
    entity: 'session',
    detail: 'qr_one_time',
    ip,
  });

  let displayName = String(row.username || '');
  let avatarUrl = '';
  try {
    const profile = await resolveUserProfileAvatar(c.env, String(row.username || ''));
    displayName = profile.display_name || displayName;
    avatarUrl = profile.avatar_url || '';
  } catch { /* */ }
  try {
    await qrDoPut(c.env, token, {
      status: 'consumed',
      username: row.username,
      role: row.role,
      display_name: displayName,
      avatar_url: avatarUrl,
    });
  } catch { /* */ }

  return c.json({
    success: true,
    data: {
      token: authToken,
      username: row.username,
      role: row.role,
      display_name: displayName,
      avatar_url: avatarUrl,
      trusted_device: true,
    },
  });
});

/* ─── WebAuthn: platform biometrics + hardware security keys (v259 hardened) ───
 * ALL cryptographic verification lives in worker/lib/webauthn.ts (W3C WebAuthn
 * L2 procedures). These routes only wire session/authz/persistence: every
 * success path requires verifyRegistration()/verifyAuthentication() to return
 * ok — client-submitted fields are never treated as proof of anything.
 * Feature-gated: WEBAUTHN_ENABLED !== 'true' → 503 WEBAUTHN_DISABLED, and
 * clients must consult GET /api/auth/webauthn/status before offering passkeys.
 * Android Credential Manager: allowed only via the documented assetlinks
 * association (WEBAUTHN_ANDROID_PACKAGE + WEBAUTHN_ANDROID_CERT_HASH). */

function waPolicy(env: any): WebAuthnPolicy {
  return policyFromEnv(env as Record<string, string | undefined>);
}

function waDisabledResponse() {
  return { success: false, error: 'Passkeys désactivées sur ce serveur', code: 'WEBAUTHN_DISABLED' };
}

/** Build a readable passkey label from client + User-Agent (Windows / iPhone / Android…). */
function buildPasskeyLabel(body: any, ua: string, deviceType: string): string {
  const fromClient = String(body.device_label || body.label || '').trim();
  if (fromClient) return fromClient.slice(0, 120);
  const u = ua || '';
  if (/iPhone/i.test(u)) {
    const m = u.match(/OS (\d+)[._](\d+)/);
    return m ? `iPhone · iOS ${m[1]}.${m[2]}` : 'iPhone · iOS';
  }
  if (/iPad/i.test(u)) {
    const m = u.match(/OS (\d+)[._](\d+)/);
    return m ? `iPad · iPadOS ${m[1]}.${m[2]}` : 'iPad · iPadOS';
  }
  if (/Android/i.test(u)) {
    const v = u.match(/Android (\d+(?:\.\d+)?)/);
    const model = u.match(/;\s*([^;)]+)\s*Build\//);
    const name = model ? model[1].trim() : 'Android';
    return v ? `${name} · Android ${v[1]}` : `${name} · Android`;
  }
  if (/Windows NT 10/i.test(u)) return 'PC Windows · Windows 10/11 · Windows Hello';
  if (/Windows/i.test(u)) return 'PC Windows · Windows Hello';
  if (/Mac OS X/i.test(u)) {
    const m = u.match(/Mac OS X (\d+[._]\d+)/);
    const ver = m ? m[1].replace(/_/g, '.') : '';
    return ver ? `Mac · macOS ${ver} · Touch ID` : 'Mac · macOS · Touch ID';
  }
  if (deviceType === 'cross-platform') return 'Clé de sécurité (USB / NFC)';
  return deviceType === 'platform' ? 'Biométrie (appareil)' : 'Clé de sécurité';
}

function enrichCredentialRow(r: any): any {
  if (!r) return r;
  let label = String(r.label || '').trim();
  if (!label || label === 'Biométrie' || label === 'Clé de sécurité') {
    label = r.device_type === 'cross-platform'
      ? 'Clé de sécurité (ancienne)'
      : 'Biométrie (ancienne — sans détail appareil)';
  }
  return {
    ...r,
    label,
    display_label: label,
    platform: r.device_type === 'cross-platform' ? 'security_key' : 'platform',
  };
}

/** Start WebAuthn registration — returns PublicKeyCredentialCreationOptions fields */
app.post('/api/auth/webauthn/register/options', async (c) => {
  const policy = waPolicy(c.env);
  if (!policy.enabled) return c.json(waDisabledResponse(), 503);
  const body = await c.req.json().catch(() => ({}));
  const fingerprint = String(body.fingerprint || c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  await ensureSecurityTables(c.env.DB);

  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), fingerprint);
  if (reason !== 'ok') {
    return c.json({ success: false, error: 'Session invalide — connectez-vous d\'abord', code: 'UNAUTHORIZED' }, 401);
  }
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const username = String(session.username || '').toLowerCase();
  if (!username) return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  const origin = expectedOrigin(policy);

  // Challenge bound to the SESSION account (not to any client-supplied value).
  const challenge = await waCreateChallenge(c.env.DB, { purpose: 'register', username, rpId: policy.rpId, origin });
  // v0.7 — exclude ONLY credentials with stored verification material: a
  // legacy row without public_key_jwk must not block re-registration (same
  // filter as login/options; nothing is deleted, no check weakened).
  const exclude = await credentialDescriptors(c.env.DB, username);
  const userHandle = await userHandleFor(username);
  const deviceType = body.device_type === 'cross-platform' ? 'cross-platform' : 'platform';

  return c.json({
    success: true,
    options: {
      challenge,
      rp: { name: policy.rpName, id: policy.rpId },
      user: { id: userHandle, name: username, displayName: username },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: {
        residentKey: 'preferred',
        requireResidentKey: false,
        userVerification: policy.requireUV ? 'required' : 'preferred',
      },
      timeout: 60000,
      attestation: policy.attestation,
      excludeCredentials: exclude,
    },
    device_type: deviceType,
    rp_id: policy.rpId,
  });
});

/** Finish WebAuthn registration — full attestation/authData/COSE verification */
app.post('/api/auth/webauthn/register/verify', async (c) => {
  const policy = waPolicy(c.env);
  if (!policy.enabled) return c.json(waDisabledResponse(), 503);
  const body = await c.req.json().catch(() => ({}));
  const fingerprint = String(body.fingerprint || c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  await ensureSecurityTables(c.env.DB);

  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), fingerprint);
  if (reason !== 'ok') return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const username = String(session.username || '').toLowerCase();
  if (!username) return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);

  // Accept flat fields OR nested Credential Manager registration JSON.
  const cred = (body.credential && typeof body.credential === 'object') ? body.credential : {};
  const response = (cred.response && typeof cred.response === 'object') ? cred.response : {};
  const credentialIdHint = String(body.credential_id || cred.id || '').trim();
  const clientDataJSON = String(response.clientDataJSON || body.clientDataJSON || '').trim();
  const attestationObject = String(response.attestationObject || body.attestation_object || '').trim();
  const transportsRaw = body.transports || cred.transports || response.transports;
  const transports = Array.isArray(transportsRaw) ? transportsRaw.join(',') : String(transportsRaw || '');
  const deviceType = body.device_type === 'cross-platform' ? 'cross-platform' : 'platform';
  if (!clientDataJSON || !attestationObject) {
    return c.json({ success: false, error: 'Réponse passkey incomplète', code: 'BAD_CREDENTIAL' }, 400);
  }

  let challenge = '';
  try {
    challenge = parseClientData(clientDataJSON).json.challenge;
  } catch {
    return c.json({ success: false, error: 'clientDataJSON invalide', code: 'WEBAUTHN_MALFORMED_CLIENTDATA' }, 400);
  }
  // Atomic single-use, bound to this account + purpose + RP + origin.
  const consumed = await waConsumeChallenge(c.env.DB, {
    challenge, purpose: 'register', rpId: policy.rpId, origin: expectedOrigin(policy), username,
  });
  if (!consumed) {
    return c.json({ success: false, error: 'Challenge invalide ou expiré. Réessayez.', code: 'BAD_CHALLENGE' }, 400);
  }

  let verified;
  try {
    verified = await verifyRegistration({
      clientDataJSON,
      attestationObject,
      expectedChallenge: challenge,
      policy,
    });
  } catch (e: any) {
    return c.json({ success: false, error: 'Vérification passkey impossible', code: String(e?.code || 'WEBAUTHN_VERIFY_FAILED') }, 400);
  }
  if (credentialIdHint && credentialIdHint !== verified.credentialId) {
    return c.json({ success: false, error: 'Identifiant de credential incohérent', code: 'WEBAUTHN_BAD_CREDENTIAL_ID' }, 400);
  }

  const ua = c.req.header('User-Agent') || '';
  const label = buildPasskeyLabel(body, ua, deviceType).slice(0, 120);
  let deviceInfo = '';
  try {
    deviceInfo = typeof body.device_info === 'string'
      ? body.device_info.slice(0, 800)
      : JSON.stringify(body.device_info || { ua: ua.slice(0, 200) }).slice(0, 800);
  } catch {
    deviceInfo = ua.slice(0, 200);
  }
  const userHandle = await userHandleFor(username);
  try {
    await c.env.DB.prepare(
      `INSERT INTO webauthn_credentials (id, fingerprint, device_type, transports, label, username, role, device_info,
        public_key_jwk, counter, backup_eligible, backup_state, rp_id, origin, cred_user_handle, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).bind(
      verified.credentialId, fingerprint, deviceType, transports, label, username,
      normalizeRole(session.role || 'user'), deviceInfo,
      JSON.stringify(verified.publicKeyJwk), verified.counter,
      verified.backupEligible ? 1 : 0, verified.backupState ? 1 : 0,
      policy.rpId, expectedOrigin(policy), userHandle,
    ).run();
  } catch {
    return c.json({ success: false, error: 'Cette passkey est déjà enregistrée', code: 'DUPLICATE_CREDENTIAL' }, 409);
  }

  await trustDevice(c.env.DB, fingerprint, clientIp(c), username, c.req.header('User-Agent') || '');
  return c.json({
    success: true,
    credential_id: verified.credentialId.slice(0, 16) + '…',
    username,
    role: normalizeRole(session.role || 'user'),
    label,
    message: `Passkey enregistrée : ${label}. Sur l’écran de connexion, utilisez « Connexion passkey ».`,
  });
});

/** Start WebAuthn authentication (login) */
app.post('/api/auth/webauthn/login/options', async (c) => {
  const policy = waPolicy(c.env);
  if (!policy.enabled) return c.json(waDisabledResponse(), 503);
  const body = await c.req.json().catch(() => ({}));
  const ip = clientIp(c);
  await ensureSecurityTables(c.env.DB);
  const limited = await isRateLimited(c.env.DB, ip);
  if (limited.blocked) return c.json({ success: false, error: limited.reason, code: 'RATE_LIMITED' }, 429);

  const usernameFilter = String(body.username || '').trim().toLowerCase();
  const challenge = await waCreateChallenge(c.env.DB, {
    purpose: 'login', username: usernameFilter, rpId: policy.rpId, origin: expectedOrigin(policy),
  });
  // Verifiable credentials only (rows with a stored public key). Legacy
  // biometric ids without keys can never pass verification — not offered.
  let allow: any[] = [];
  if (usernameFilter) {
    allow = await credentialDescriptors(c.env.DB, usernameFilter);
  }
  return c.json({
    success: true,
    options: {
      challenge,
      timeout: 60000,
      userVerification: policy.requireUV ? 'required' : 'preferred',
      allowCredentials: allow,
      rpId: policy.rpId,
    },
  });
});

/** Finish WebAuthn authentication — session issued ONLY after full verification */
app.post('/api/auth/webauthn/login/verify', async (c) => {
  const policy = waPolicy(c.env);
  if (!policy.enabled) return c.json(waDisabledResponse(), 503);
  const body = await c.req.json().catch(() => ({}));
  const fingerprint = String(body.fingerprint || c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const ip = clientIp(c);
  const ua = c.req.header('User-Agent') || '';
  await ensureSecurityTables(c.env.DB);
  const limited = await isRateLimited(c.env.DB, ip);
  if (limited.blocked) return c.json({ success: false, error: limited.reason, code: 'RATE_LIMITED' }, 429);

  const credNested = (body.credential && typeof body.credential === 'object') ? body.credential : {};
  const respNested = (credNested.response && typeof credNested.response === 'object') ? credNested.response : {};
  const credentialId = String(body.credential_id || credNested.id || '').trim();
  const clientDataJSON = String(respNested.clientDataJSON || body.clientDataJSON || '').trim();
  const authenticatorData = String(respNested.authenticatorData || body.authenticatorData || '').trim();
  const signature = String(respNested.signature || body.signature || '').trim();
  const userHandle = String(respNested.userHandle || body.userHandle || '').trim();

  // One generic failure shape for EVERY verification error: no credential
  // oracle, no account enumeration, no difference between "unknown key" and
  // "bad signature" (both recorded as failed logins for reputation).
  const fail = async () => {
    await recordLogin(c.env.DB, ip, fingerprint, false, ua);
    return c.json({ success: false, error: 'Vérification passkey impossible', code: 'WEBAUTHN_VERIFY_FAILED' }, 401);
  };

  if (!credentialId || !clientDataJSON || !authenticatorData || !signature) return fail();
  let challenge = '';
  try {
    challenge = parseClientData(clientDataJSON).json.challenge;
  } catch {
    return fail();
  }
  const consumed = await waConsumeChallenge(c.env.DB, {
    challenge, purpose: 'login', rpId: policy.rpId, origin: expectedOrigin(policy),
  });
  if (!consumed) {
    await recordLogin(c.env.DB, ip, fingerprint, false, ua);
    return c.json({ success: false, error: 'Challenge invalide ou expiré', code: 'BAD_CHALLENGE' }, 401);
  }

  const cred = await c.env.DB.prepare(`SELECT * FROM webauthn_credentials WHERE id = ?`).bind(credentialId).first() as any;
  if (!cred || !String(cred.public_key_jwk || '')) return fail();
  // Challenge requested for a specific account cannot unlock another account.
  if (consumed.username && String(cred.username || '').toLowerCase() !== consumed.username) return fail();

  let jwk: any;
  try { jwk = JSON.parse(String(cred.public_key_jwk)); } catch { return fail(); }
  let verified;
  try {
    verified = await verifyAuthentication({
      clientDataJSON,
      authenticatorData,
      signature,
      userHandle: userHandle || undefined,
      expectedChallenge: challenge,
      policy,
      stored: {
        publicKeyJwk: jwk,
        counter: Number(cred.counter || 0),
        backupEligible: Number(cred.backup_eligible || 0) === 1,
        userHandle: String(cred.cred_user_handle || ''),
      },
    });
  } catch {
    return fail();
  }

  await c.env.DB.prepare(
    `UPDATE webauthn_credentials SET counter = ?, backup_state = ?, last_used = datetime('now') WHERE id = ?`,
  ).bind(verified.counter, verified.backupState ? 1 : 0, credentialId).run().catch(() => {});
  await trustDevice(c.env.DB, fingerprint, ip, String(cred.username || ''), c.req.header('User-Agent') || '');
  await recordLogin(c.env.DB, ip, fingerprint, true, ua);
  const rep = await getReputation(c.env.DB, ip) as any;

  // Account comes ONLY from the verified credential row — never from the body.
  const ownerUser = getOwnerUsername(c.env);
  let username = String(cred.username || '').toLowerCase();
  let role = normalizeRole(cred.role || 'user');
  let secretMaterial: string;
  let displayName = username;
  if (!username) return fail();
  if (username === ownerUser || role === 'owner') {
    const expected = getPassword(c.env);
    if (!expected) {
      return c.json({ success: false, error: 'Mot de passe administrateur non configuré', code: 'NO_PASSWORD_CONFIGURED' }, 503);
    }
    username = ownerUser;
    role = 'owner';
    secretMaterial = await sha256Hex(`owner-key|${ownerUser}|${normalizePassword(expected)}`);
    displayName = 'Administrateur';
  } else {
    const row = await c.env.DB.prepare(
      `SELECT * FROM app_users WHERE username = ? AND active = 1`,
    ).bind(username).first() as any;
    if (!row) return fail();
    role = normalizeRole(row.role);
    secretMaterial = row.password_hash;
    displayName = row.display_name || username;
  }

  const token = await makeTokenV2(username, role, secretMaterial, ip, fingerprint);
  return c.json({
    success: true,
    needs_otp: false,
    trusted_device: true,
    biometric: true,
    token,
    ip,
    username,
    role,
    displayName,
    reputationScore: rep.score,
    message: 'Connexion passkey réussie.',
  });
});

/** Capability probe — clients offer passkeys ONLY when this says enabled. */
app.get('/api/auth/webauthn/status', async (c) => {
  const policy = waPolicy(c.env);
  return c.json({
    success: true,
    data: {
      enabled: policy.enabled,
      rp: { id: policy.rpId, name: policy.rpName },
      origins: policy.origins,
      registration: policy.enabled,
      login: policy.enabled,
      user_verification: policy.requireUV ? 'required' : 'preferred',
      attestation: policy.attestation,
      algorithms: ['ES256'],
      android: {
        enabled: policy.enabled && !!policy.androidPackage && !!androidOrigin(policy),
        package: policy.androidPackage || null,
        // Native origins accepted for the configured signing cert(s) — device
        // teams verify what their build emits against these exact values.
        // Credential Manager emits the -sha256 form; the legacy FIDO2/GMS form
        // (base64 of SHA-1) is also accepted when WEBAUTHN_ANDROID_CERT_SHA1 is set.
        origin: androidOrigin(policy),
        // v0.7 — all accepted native origins (one per signing fingerprint).
        origins_android: androidOrigins(policy),
        origin_legacy: androidLegacyOrigin(policy),
        assetlinks: '/.well-known/assetlinks.json',
      },
    },
  }, 200, { 'Cache-Control': 'public, max-age=60' });
});

/** Digital Asset Links for Android Credential Manager (configured builds only). */
app.get('/.well-known/assetlinks.json', async (c) => {
  const policy = waPolicy(c.env);
  if (!policy.androidPackage || !policy.androidCertHashes.length) {
    return c.json({ error: 'not configured' }, 404);
  }
  // v0.7 — Digital Asset Links accepts several signing fingerprints: list
  // EVERY configured key (Play App Signing + release/CDN keystore) so both
  // Play installs and GitHub-Release installs associate. Debug builds get
  // their package variant too (same keys), as the historical static file did.
  const fps = policy.androidCertHashes;
  const relation = [
    'delegate_permission/common.handle_all_urls',
    'delegate_permission/common.get_login_creds',
  ];
  const entry = (pkg: string) => ({
    relation,
    target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: fps },
  });
  return c.json(
    [entry(policy.androidPackage), entry(`${policy.androidPackage}.debug`)],
    200,
    { 'Cache-Control': 'public, max-age=300' },
  );
});

/** List WebAuthn credentials — device + legacy + all for owner/admin */
registerReportsAndUpdatesRoutes(app, {
  authFailReason,
  sessionUserFromHeader,
  getOwnerUsername,
  clientIp,
  isRateLimited,
});
app.get('/api/auth/webauthn/credentials', async (c) => {
  await ensureSecurityTables(c.env.DB);
  const fingerprint = String(c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), fingerprint);
  if (reason !== 'ok') {
    return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  }
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const isAdmin = session.role === 'owner' || session.role === 'admin';
  const sessionUser = String(session.username || '').toLowerCase();
  // only owner/admin can request all=1; everyone else only sees THEIR passkeys
  const wantAll = isAdmin && c.req.query('all') === '1';

  let results: any[] = [];
  if (wantAll) {
    const q = await c.env.DB.prepare(
      `SELECT id, fingerprint, device_type, transports, label, username, role, device_info, created_at, last_used
       FROM webauthn_credentials ORDER BY datetime(created_at) DESC LIMIT 100`
    ).all();
    results = (q.results || []) as any[];
  } else if (sessionUser) {
    // Per-user isolation (same phone can have haytam + owner keys — only show current user)
    const q = await c.env.DB.prepare(
      `SELECT id, fingerprint, device_type, transports, label, username, role, device_info, created_at, last_used
       FROM webauthn_credentials
       WHERE lower(username) = ?
       ORDER BY datetime(created_at) DESC LIMIT 50`
    ).bind(sessionUser).all();
    results = (q.results || []) as any[];
  } else {
    const q = await c.env.DB.prepare(
      `SELECT id, fingerprint, device_type, transports, label, username, role, device_info, created_at, last_used
       FROM webauthn_credentials WHERE fingerprint = ? ORDER BY datetime(created_at) DESC LIMIT 50`
    ).bind(fingerprint).all();
    results = (q.results || []) as any[];
  }

  // Legacy only for current device + current user context (avoid leaking other accounts)
  if (!wantAll) {
    const legacyQ = await c.env.DB.prepare(
      `SELECT fingerprint, biometric_credential_id FROM trusted_devices
       WHERE fingerprint = ? AND biometric_credential_id IS NOT NULL AND biometric_credential_id != ''`
    ).bind(fingerprint).all();
    const seen = new Set(results.map((r: any) => r.id));
    for (const row of (legacyQ.results || []) as any[]) {
      const id = String(row.biometric_credential_id || '');
      if (!id || seen.has(id)) continue;
      // only include if no username-scoped rows (legacy predates username column)
      if (results.length > 0) continue;
      seen.add(id);
      results.push({
        id,
        fingerprint: row.fingerprint,
        device_type: 'platform',
        transports: 'internal',
        label: 'Biométrie (ancienne)',
        username: sessionUser || '',
        created_at: null,
        last_used: null,
        legacy: true,
      });
    }
  }

  const enriched = (results || []).map(enrichCredentialRow);
  return c.json({
    success: true,
    data: enriched,
    meta: {
      fingerprint,
      scope: wantAll ? 'all' : 'user',
      username: sessionUser,
      count: results.length,
    },
  });
});

/** Rename a passkey label */
app.patch('/api/auth/webauthn/credentials/:id', async (c) => {
  await ensureSecurityTables(c.env.DB);
  const fingerprint = String(c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), fingerprint);
  if (reason !== 'ok') {
    return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  }
  const id = decodeURIComponent(c.req.param('id') || '');
  const body = await c.req.json().catch(() => ({}));
  const label = String(body.label || '').trim().slice(0, 80);
  if (!id || !label) return c.json({ success: false, error: 'id et label obligatoires' }, 400);
  const row = await c.env.DB.prepare(`SELECT * FROM webauthn_credentials WHERE id = ?`).bind(id).first() as any;
  if (!row) return c.json({ success: false, error: 'Clé introuvable' }, 404);
  // Device-scoped: only own fingerprint unless owner managing all
  if (row.fingerprint !== fingerprint) {
    // allow owner session only
    const sess = sessionUserFromHeader(c.req.header('Authorization'));
    if (sess.role !== 'owner' && sess.role !== 'admin') {
      return c.json({ success: false, error: 'Non autorisé' }, 403);
    }
  }
  await c.env.DB.prepare(`UPDATE webauthn_credentials SET label = ? WHERE id = ?`).bind(label, id).run();
  return c.json({ success: true, message: 'Libellé mis à jour', data: { id, label } });
});

/** Delete passkey from server (client should also clear local id + signal authenticator) */

function webauthnIdVariants(raw: string): string[] {
  const id = decodeURIComponent(String(raw || '').trim());
  if (!id) return [];
  const set = new Set<string>([id]);
  // base64url <-> base64
  set.add(id.replace(/-/g, '+').replace(/_/g, '/'));
  set.add(id.replace(/\+/g, '-').replace(/\//g, '_'));
  // with/without padding
  // oxlint-disable-next-line unicorn/no-useless-spread -- snapshot on purpose: variants are ADDED to the set during the loop
  for (const v of [...set]) {
    const pad = v.length % 4 === 0 ? v : v + '='.repeat((4 - (v.length % 4)) % 4);
    set.add(pad);
    set.add(v.replace(/=+$/, ''));
  }
  return [...set].filter(Boolean);
}

async function deleteWebauthnCredentialRow(db: D1Database, idRaw: string, fingerprint: string, role: string) {
  const variants = webauthnIdVariants(idRaw);
  if (!variants.length) return { ok: false as const, code: 400 as const, error: 'id obligatoire' };

  let row: any = null;
  let matchedId = '';
  for (const id of variants) {
    row = await db.prepare(`SELECT * FROM webauthn_credentials WHERE id = ?`).bind(id).first();
    if (row) { matchedId = String(row.id); break; }
  }
  // fallback: suffix match for truncated path params
  if (!row && variants[0] && variants[0].length >= 16) {
    const q = await db.prepare(`SELECT * FROM webauthn_credentials WHERE id LIKE ? LIMIT 5`).bind('%' + variants[0].slice(-24)).all();
    const hits = (q.results || []) as any[];
    if (hits.length === 1) {
      row = hits[0];
      matchedId = String(row.id);
    }
  }

  // Legacy passkeys only live on trusted_devices.biometric_credential_id (list merges them in)
  let legacyCleared = 0;
  for (const id of variants) {
    try {
      // permission: non-admin can only clear own fingerprint's legacy row
      if (role === 'owner' || role === 'admin') {
        const r = await db.prepare(
          `UPDATE trusted_devices SET biometric_credential_id = '' WHERE biometric_credential_id = ?`
        ).bind(id).run();
        legacyCleared += Number((r as any)?.meta?.changes || 0);
      } else {
        const r = await db.prepare(
          `UPDATE trusted_devices SET biometric_credential_id = '' WHERE biometric_credential_id = ? AND fingerprint = ?`
        ).bind(id, fingerprint).run();
        legacyCleared += Number((r as any)?.meta?.changes || 0);
      }
    } catch { /* column may differ */ }
  }

  if (row) {
    if (row.fingerprint !== fingerprint && role !== 'owner' && role !== 'admin') {
      return { ok: false as const, code: 403 as const, error: 'Non autorisé' };
    }
    await db.prepare(`DELETE FROM webauthn_credentials WHERE id = ?`).bind(matchedId).run();
    // also clear any trusted_devices pointing at this id
    try {
      await db.prepare(
        `UPDATE trusted_devices SET biometric_credential_id = '' WHERE biometric_credential_id = ?`
      ).bind(matchedId).run();
    } catch { /* */ }
    return { ok: true as const, id: matchedId, fingerprint: String(row.fingerprint || fingerprint) };
  }

  if (legacyCleared > 0) {
    return { ok: true as const, id: variants[0], fingerprint };
  }

  return { ok: false as const, code: 404 as const, error: 'Clé introuvable (déjà supprimée ou autre appareil)' };
}



app.delete('/api/auth/webauthn/credentials/:id', async (c) => {
  await ensureSecurityTables(c.env.DB);
  const fingerprint = String(c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), fingerprint);
  if (reason !== 'ok') {
    return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  }
  const sess = sessionUserFromHeader(c.req.header('Authorization'));
  const id = c.req.param('id') || '';
  const result = await deleteWebauthnCredentialRow(c.env.DB, id, fingerprint, sess.role || '');
  if (!result.ok) {
    // Idempotent: treat missing as success so UI can refresh cleanly
    if (result.code === 404) {
      return c.json({ success: true, message: 'Clé déjà absente du serveur.', data: { id } });
    }
    return c.json({ success: false, error: result.error }, result.code);
  }
  return c.json({
    success: true,
    message: "Clé supprimée du serveur. Retirez-la aussi dans les réglages de l'appareil si elle apparaît encore.",
    data: { id: result.id, fingerprint: result.fingerprint },
  });
});

/** Body-based delete (avoids path encoding issues with long credential ids) */
app.post('/api/auth/webauthn/credentials/delete', async (c) => {
  await ensureSecurityTables(c.env.DB);
  const fingerprint = String(c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), fingerprint);
  if (reason !== 'ok') {
    return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  }
  const body = await c.req.json().catch(() => ({})) as any;
  const id = String(body.id || body.credential_id || '').trim();
  if (!id) return c.json({ success: false, error: 'id obligatoire' }, 400);
  const sess = sessionUserFromHeader(c.req.header('Authorization'));
  const result = await deleteWebauthnCredentialRow(c.env.DB, id, fingerprint, sess.role || '');
  if (!result.ok) {
    if (result.code === 404) {
      return c.json({ success: true, message: 'Clé déjà absente du serveur.', data: { id } });
    }
    return c.json({ success: false, error: result.error }, result.code);
  }
  return c.json({
    success: true,
    message: "Clé supprimée du serveur. Retirez-la aussi dans les réglages de l'appareil si elle apparaît encore.",
    data: { id: result.id, fingerprint: result.fingerprint },
  });
});


/** Legacy aliases */
app.post('/api/auth/register-biometric', async (c) => {
  // Redirect clients: use /api/auth/webauthn/register/*
  return c.json({
    success: false,
    error: 'Utilisez /api/auth/webauthn/register/options puis /verify',
    code: 'USE_WEBAUTHN_FLOW',
  }, 400);
});

app.post('/api/auth/login-biometric', async (c) => {
  return c.json({
    success: false,
    error: 'Utilisez /api/auth/webauthn/login/options puis /verify',
    code: 'USE_WEBAUTHN_FLOW',
  }, 400);
});

/** Public probe: trusted device + credentials count */

/** List trusted devices for current session user (admin sees all). */
app.get('/api/auth/trusted-devices', async (c) => {
  await ensureSecurityTables(c.env.DB);
  const ip = clientIp(c);
  const fp = String(c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, ip, fp);
  if (reason !== 'ok') {
    return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  }
  await addColumnIfMissing(c.env.DB, 'trusted_devices', 'username', "TEXT DEFAULT ''");
  await addColumnIfMissing(c.env.DB, 'trusted_devices', 'user_agent', "TEXT DEFAULT ''");
  const sess = sessionUserFromHeader(c.req.header('Authorization'));
  const isAdmin = sess.role === 'owner' || sess.role === 'admin';
  let rows: any[] = [];
  try {
    if (isAdmin) {
      const r = await c.env.DB.prepare(
        `SELECT fingerprint, label, last_ip, last_seen, created_at, username, user_agent
         FROM trusted_devices ORDER BY datetime(last_seen) DESC LIMIT 50`
      ).all();
      rows = r.results || [];
    } else {
      const r = await c.env.DB.prepare(
        `SELECT fingerprint, label, last_ip, last_seen, created_at, username, user_agent
         FROM trusted_devices
         WHERE username = ? OR fingerprint = ?
         ORDER BY datetime(last_seen) DESC LIMIT 30`
      ).bind(sess.username || '', fp).all();
      rows = r.results || [];
    }
  } catch (e: any) {
    console.error('trusted-devices list', e?.message);
  }
  const data = (rows || []).map((r: any) => ({
    fingerprint: r.fingerprint,
    label: r.label || r.user_agent || 'Appareil',
    last_ip: r.last_ip || '',
    last_seen: r.last_seen || '',
    created_at: r.created_at || '',
    username: r.username || '',
    is_current: r.fingerprint === fp,
  }));
  return c.json({ success: true, data });
});

/** Remove a trusted device (self or admin). */
app.delete('/api/auth/trusted-devices/:fingerprint', async (c) => {
  await ensureSecurityTables(c.env.DB);
  const ip = clientIp(c);
  const fp = String(c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, ip, fp);
  if (reason !== 'ok') {
    return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  }
  const target = decodeURIComponent(c.req.param('fingerprint') || '').slice(0, 128);
  if (!target) return c.json({ success: false, error: 'Empreinte requise' }, 400);
  const sess = sessionUserFromHeader(c.req.header('Authorization'));
  const isAdmin = sess.role === 'owner' || sess.role === 'admin';
  const row = await c.env.DB.prepare(`SELECT * FROM trusted_devices WHERE fingerprint = ?`).bind(target).first() as any;
  if (!row) return c.json({ success: true, message: 'Déjà retiré' });
  if (!isAdmin && row.fingerprint !== fp && String(row.username || '') !== String(sess.username || '')) {
    return c.json({ success: false, error: 'Non autorisé' }, 403);
  }
  await c.env.DB.prepare(`DELETE FROM trusted_devices WHERE fingerprint = ?`).bind(target).run();
  return c.json({ success: true, message: 'Appareil retiré' });
});

app.post('/api/auth/device-status', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const fingerprint = String(body.fingerprint || c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  await ensureSecurityTables(c.env.DB);
  if (!fingerprint || fingerprint === 'none') {
    return c.json({ success: true, trusted: false, biometric_registered: false, credential_count: 0 });
  }
  const row = await c.env.DB.prepare(
    `SELECT biometric_credential_id FROM trusted_devices WHERE fingerprint = ?`
  ).bind(fingerprint).first() as any;
  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as c FROM webauthn_credentials WHERE fingerprint = ?`
  ).bind(fingerprint).first() as any;
  const count = Number(countRow?.c || 0) + (row?.biometric_credential_id ? 1 : 0);
  return c.json({
    success: true,
    trusted: !!row,
    biometric_registered: count > 0,
    credential_count: count,
    password_configured: !!getPassword(c.env),
  });
});

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


app.post('/api/admin/users', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  const body = await c.req.json().catch(() => ({}));
  const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
  if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);

  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  const displayName = String(body.display_name || username).trim();
  const role = ['admin', 'secretaire', 'stock', 'user'].includes(String(body.role))
    ? String(body.role)
    : 'user';
  const email = String(body.email || '').trim().toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return c.json({ success: false, error: 'Adresse e-mail invalide' }, 400);
  }

  if (!username || username.length < 2) {
    return c.json({ success: false, error: 'Nom d\'utilisateur trop court (min. 2 caractères)' }, 400);
  }
  if (!/^[a-z0-9._-]+$/.test(username)) {
    return c.json({ success: false, error: 'Nom d\'utilisateur: lettres minuscules, chiffres, . _ - uniquement' }, 400);
  }
  if (username === getOwnerUsername(c.env)) {
    return c.json({ success: false, error: 'Ce nom est réservé à l\'administrateur principal' }, 400);
  }
  if (normalizePassword(password).length < 6) {
    return c.json({ success: false, error: 'Mot de passe: minimum 6 caractères' }, 400);
  }

  await ensureSecurityTables(c.env.DB);
  const existing = await c.env.DB.prepare(`SELECT id FROM app_users WHERE username = ?`).bind(username).first();
  if (existing) return c.json({ success: false, error: 'Cet utilisateur existe déjà' }, 409);

  const salt = randomChallenge().slice(0, 16);
  const password_hash = await hashUserPassword(password, salt);
  await c.env.DB.prepare(
    `INSERT INTO app_users (username, password_hash, password_salt, role, display_name, created_by, email)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(username, password_hash, salt, role, displayName, gate.username, email).run();

  await writeAudit(c.env.DB, {
    username: gate.username, role: 'owner', action: 'user.create', entity: 'app_users',
    entity_id: username, detail: `role=${role}`, ip: c.req.header('cf-connecting-ip') || '',
  });
  return c.json({ success: true, message: `Utilisateur « ${username} » créé.` });
});

app.delete('/api/admin/users/:id', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  const body = await c.req.json().catch(() => ({}));
  const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
  if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);

  const id = Number(c.req.param('id'));
  await ensureSecurityTables(c.env.DB);
  const row = await c.env.DB.prepare(`SELECT * FROM app_users WHERE id = ?`).bind(id).first() as any;
  if (!row) return c.json({ success: false, error: 'Utilisateur introuvable' }, 404);
  await c.env.DB.prepare(`DELETE FROM app_users WHERE id = ?`).bind(id).run();
  return c.json({ success: true, message: `Utilisateur « ${row.username} » supprimé.` });
});


app.put('/api/admin/users/:id', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  const body = await c.req.json().catch(() => ({}));
  const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
  if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);

  const id = Number(c.req.param('id'));
  await ensureSecurityTables(c.env.DB);
  const row = await c.env.DB.prepare(`SELECT * FROM app_users WHERE id = ?`).bind(id).first() as any;
  if (!row) return c.json({ success: false, error: 'Utilisateur introuvable' }, 404);

  const display_name = body.display_name != null ? String(body.display_name).trim() : row.display_name;
  let role = row.role;
  if (body.role && ['admin', 'secretaire', 'stock', 'user'].includes(String(body.role))) {
    role = String(body.role);
  }
  const active = body.active === false || body.active === 0 ? 0 : 1;
  let email = String(row.email || '');
  if (body.email != null) {
    email = String(body.email).trim().toLowerCase();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return c.json({ success: false, error: 'Adresse e-mail invalide' }, 400);
    }
  }

  if (body.password && normalizePassword(body.password).length >= 6) {
    const salt = randomChallenge().slice(0, 16);
    const password_hash = await hashUserPassword(body.password, salt);
    await c.env.DB.prepare(
      `UPDATE app_users SET display_name = ?, role = ?, active = ?, password_hash = ?, password_salt = ?, email = ? WHERE id = ?`
    ).bind(display_name, role, active, password_hash, salt, email, id).run();
  } else {
    await c.env.DB.prepare(
      `UPDATE app_users SET display_name = ?, role = ?, active = ?, email = ? WHERE id = ?`
    ).bind(display_name, role, active, email, id).run();
  }

  return c.json({ success: true, message: `Utilisateur « ${row.username} » mis à jour.` });
});


app.get('/api/admin/audit', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  await ensureSecurityTables(c.env.DB);

  // Cursor-based (keyset) pagination — stable and cheap on D1 free tier.
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 40)));
  const cursorRaw = (c.req.query('cursor') || '').trim();
  const cursorId = cursorRaw ? Math.max(0, Math.floor(Number(cursorRaw))) : 0;
  const action = (c.req.query('action') || '').trim();
  const username = (c.req.query('username') || '').trim().toLowerCase();
  const q = (c.req.query('q') || '').trim();
  const range = (c.req.query('range') || '7d').trim(); // 24h | 7d | 30d | all
  const wantStats = c.req.query('stats') === '1';

  let where = '1=1';
  const binds: any[] = [];
  if (range === '24h') {
    where += " AND created_at >= datetime('now', '-1 day')";
  } else if (range === '30d') {
    where += " AND created_at >= datetime('now', '-30 days')";
  } else if (range !== 'all') {
    where += " AND created_at >= datetime('now', '-7 days')";
  }
  if (cursorId > 0) {
    where += ' AND id < ?';
    binds.push(cursorId);
  }
  if (action) {
    where += ' AND action = ?';
    binds.push(action);
  }
  if (username) {
    where += ' AND LOWER(username) = ?';
    binds.push(username);
  }
  if (q) {
    where += ' AND (detail LIKE ? OR entity LIKE ? OR action LIKE ? OR username LIKE ?)';
    const like = `%${q}%`;
    binds.push(like, like, like, like);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT id, username, role, action, entity, entity_id, detail, ip, created_at
     FROM audit_log WHERE ${where}
     ORDER BY id DESC
     LIMIT ?`
  ).bind(...binds, limit + 1).all();

  const rows = (results || []) as any[];
  const has_more = rows.length > limit;
  const page = has_more ? rows.slice(0, limit) : rows;
  const next_cursor = has_more && page.length ? String(page[page.length - 1].id) : null;

  let stats: any = null;
  if (wantStats && cursorId === 0) {
    try {
      // Cap work on free tier: sample recent window only
      const rangeSql =
        range === '24h'
          ? "created_at >= datetime('now', '-1 day')"
          : range === '30d'
            ? "created_at >= datetime('now', '-30 days')"
            : range === 'all'
              ? '1=1'
              : "created_at >= datetime('now', '-7 days')";
      const totalRow = await c.env.DB.prepare(
        `SELECT COUNT(*) as n FROM (SELECT id FROM audit_log WHERE ${rangeSql} LIMIT 5000)`,
      ).first() as any;
      const actorsRow = await c.env.DB.prepare(
        `SELECT COUNT(DISTINCT username) as n FROM (SELECT username FROM audit_log WHERE ${rangeSql} LIMIT 2000)`,
      ).first() as any;
      const { results: topActions } = await c.env.DB.prepare(
        `SELECT action, COUNT(*) as n FROM audit_log WHERE ${rangeSql} GROUP BY action ORDER BY n DESC LIMIT 8`,
      ).all();
      const { results: byDay } = await c.env.DB.prepare(
        `SELECT substr(created_at, 1, 10) as day, COUNT(*) as n
         FROM audit_log WHERE ${rangeSql}
         GROUP BY substr(created_at, 1, 10)
         ORDER BY day ASC
         LIMIT 40`,
      ).all();
      stats = {
        total: Number(totalRow?.n || 0),
        unique_actors: Number(actorsRow?.n || 0),
        top_actions: topActions || [],
        by_day: byDay || [],
        range,
        capped: true,
      };
    } catch {
      stats = null;
    }
  }

  return c.json({
    success: true,
    data: page,
    meta: {
      limit,
      has_more,
      next_cursor,
      cursor: cursorId > 0 ? String(cursorId) : null,
      range,
      stats,
    },
  });
});

/** Phase 2: export audit log (CSV or JSON) — owner only, capped to protect free tier. */
app.get('/api/admin/audit/export', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  await ensureSecurityTables(c.env.DB);
  const format = ((c.req.query('format') || 'csv').toLowerCase() === 'json') ? 'json' : 'csv';
  const max = Math.min(2000, Math.max(1, Number(c.req.query('limit') || 500)));
  const { results } = await c.env.DB.prepare(
    `SELECT id, created_at, username, role, action, entity, entity_id, detail, ip
     FROM audit_log ORDER BY id DESC LIMIT ?`
  ).bind(max).all();
  const rows = (results || []) as any[];

  await writeAudit(c.env.DB, {
    username: gate.username,
    role: 'owner',
    action: 'audit.export',
    entity: 'audit_log',
    detail: `format=${format};count=${rows.length}`,
    ip: c.req.header('cf-connecting-ip') || '',
  });

  if (format === 'json') {
    return c.json({ success: true, data: rows, meta: { count: rows.length, limit: max } });
  }

  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = 'id,created_at,username,role,action,entity,entity_id,detail,ip';
  const lines = rows.map((r) =>
    [r.id, r.created_at, r.username, r.role, r.action, r.entity, r.entity_id, r.detail, r.ip].map(esc).join(',')
  );
  const body = [header, ...lines].join('\n');
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
});


/** Atlas Agent permission mode — owner/admin only */
app.get('/api/admin/agent-permissions', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  await ensureSecurityTables(c.env.DB);
  const mode = await getConfig(c.env.DB, 'agent_perm_mode', 'full');
  const toolsRaw = await getConfig(c.env.DB, 'agent_perm_tools', '[]');
  let tools: string[] = [];
  try { tools = JSON.parse(toolsRaw); } catch { tools = []; }
  return c.json({
    success: true,
    data: {
      mode: mode === 'read_only' || mode === 'custom' ? mode : 'full',
      tools,
      available: listAllToolNames(),
      groups: {
        stock: ['get_dashboard_snapshot', 'search_products', 'get_product', 'list_low_stock', 'warehouse_stock', 'list_warehouses', 'list_actions_pending', 'summarize_pending_actions', 'explain_pending_action', 'propose_inventory_adjustment', 'anomaly_notes'],
        sales: ['list_open_quotes', 'list_unpaid_invoices', 'list_recent_invoices', 'get_invoice_brief', 'search_clients', 'draft_client_message', 'propose_quote_lines', 'closing_pack', 'draft_day_close_report'],
      },
    },
  });
});

app.put('/api/admin/agent-permissions', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  await ensureSecurityTables(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const mode = String(body.mode || 'full');
  if (!['full', 'read_only', 'custom'].includes(mode)) {
    return c.json({ success: false, error: 'mode invalide' }, 400);
  }
  await setConfig(c.env.DB, 'agent_perm_mode', mode);
  if (Array.isArray(body.tools)) {
    const clean = body.tools.map((x: any) => String(x)).filter(Boolean).slice(0, 40);
    await setConfig(c.env.DB, 'agent_perm_tools', JSON.stringify(clean));
  }
  await writeAudit(c.env.DB, {
    username: gate.username,
    role: 'owner',
    action: 'agent.permissions_update',
    entity: 'atlas_agent',
    detail: mode,
    ip: clientIp(c),
  });
  return c.json({ success: true, message: 'Permissions agent enregistrées.' });
});


app.get('/api/admin/config', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  await ensureSecurityTables(c.env.DB);
  const attestation = await getConfig(c.env.DB, 'webauthn_attestation', 'none');
  const userVerification = await getConfig(c.env.DB, 'webauthn_user_verification', 'preferred');
  const fido2Only = await getConfig(c.env.DB, 'webauthn_fido2_only', '0');
  return c.json({
    success: true,
    data: {
      owner_username: getOwnerUsername(c.env),
      password_configured: !!getPassword(c.env),
      password_secret_format: {
        name: 'ADMIN_PASSWORD',
        rules: [
          'Cloudflare Workers → Settings → Variables → Secrets',
          'Nom exact: ADMIN_PASSWORD',
          'Valeur = mot de passe en clair, SANS guillemets',
          'Pas d\'espaces avant/après (ils sont ignorés au trim)',
          'Optionnel: ADMIN_USERNAME (défaut: admin)',
        ],
        example: 'MonMotDePasse2024!',
      },
      webauthn: {
        attestation, // none | indirect | direct | enterprise
        user_verification: userVerification, // required | preferred | discouraged
        fido2_only: fido2Only === '1',
        attestation_types: {
          none: 'Pas d\'attestation (recommandé, vie privée)',
          indirect: 'Attestation anonymisée via un service',
          direct: 'Attestation complète du fabricant (AAGUID)',
          enterprise: 'Attestation entreprise (déploiements gérés)',
        },
        fido2_notes: [
          'FIDO2 / WebAuthn Level 2 — authentifiants plateforme (biométrie) et roaming (clés USB/NFC)',
          'Les clés certifiées FIDO2 apparaissent avec un AAGUID reconnu',
          'userVerification=required force PIN/biométrie sur la clé',
        ],
      },
      otp_to: c.env.OTP_TO || '',
      otp_from: c.env.OTP_FROM || '',
      environment: c.env.ENVIRONMENT || 'production',
    },
  });
});

app.put('/api/admin/config', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  const body = await c.req.json().catch(() => ({}));
  const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
  if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);

  await ensureSecurityTables(c.env.DB);
  if (body.webauthn_attestation) {
    const allowed = ['none', 'indirect', 'direct', 'enterprise'];
    if (allowed.includes(body.webauthn_attestation)) {
      await setConfig(c.env.DB, 'webauthn_attestation', body.webauthn_attestation);
    }
  }
  if (body.webauthn_user_verification) {
    const allowed = ['required', 'preferred', 'discouraged'];
    if (allowed.includes(body.webauthn_user_verification)) {
      await setConfig(c.env.DB, 'webauthn_user_verification', body.webauthn_user_verification);
    }
  }
  if (body.webauthn_fido2_only != null) {
    await setConfig(c.env.DB, 'webauthn_fido2_only', body.webauthn_fido2_only ? '1' : '0');
  }
  return c.json({ success: true, message: 'Configuration administrateur enregistrée.' });
});

// Same-origin avatar proxy: cdn1 has no CORS headers, so clients fetch
// through the worker (server-side fetch is not CORS-bound).
app.get('/api/me/avatar', async (c) => {
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  if (!session?.username) return c.json({ success: false, error: 'Non authentifié' }, 401);
  const prof = await resolveUserProfileAvatar(c.env, session.username);
  const url = String(prof.avatar_url || '').trim();
  if (!url) return c.json({ success: false, error: 'Aucun avatar' }, 404);
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',');
    const meta = url.slice(5, comma);
    const payload = url.slice(comma + 1);
    let bytes: Uint8Array;
    if (/;base64$/i.test(meta)) {
      const bin = atob(payload);
      bytes = new Uint8Array(bin.length);
      for (let i2 = 0; i2 < bin.length; i2++) bytes[i2] = bin.charCodeAt(i2);
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(payload));
    }
    return new Response(bytes as unknown as BodyInit, {
      headers: { 'Content-Type': meta.split(';')[0] || 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' },
    });
  }
  // v243 — Durable-Object blob cache first (warm DO = sub-ms), then edge-cached
  // origin fetch; both keyed by a hash of the avatar URL so uploads invalidate.
  let version = 5381;
  for (let i2 = 0; i2 < url.length; i2++) version = ((version * 33) ^ url.charCodeAt(i2)) >>> 0;
  const vkey = String(version);
  let bytes: Uint8Array | null = null;
  let ctype = 'image/jpeg';
  let doStub: DurableObjectStub | null = null;
  try {
    if (c.env.MOBILE_HUB) {
      doStub = c.env.MOBILE_HUB.get(c.env.MOBILE_HUB.idFromName('profile:' + session.username));
      const hit = await doStub.fetch(`https://do/avatar?v=${vkey}`);
      // A cold / version-mismatched cache returns 204, not image bytes.
      if (hit.status === 200) {
        bytes = new Uint8Array(await hit.arrayBuffer());
        ctype = hit.headers.get('x-avatar-ctype') || ctype;
      }
    }
  } catch { /* DO cold/unavailable — fall through to origin */ }
  if (!bytes) {
    try {
      const r = await fetch(url, {
        headers: { Accept: 'image/*' },
        cf: { cacheTtl: 86400, cacheEverything: true } as any,
      });
      if (!r.ok) return c.json({ success: false, error: 'Avatar indisponible' }, 502);
      ctype = r.headers.get('Content-Type') || ctype;
      bytes = new Uint8Array(await r.arrayBuffer());
      if (doStub && bytes.byteLength <= 4_000_000) {
        c.executionCtx?.waitUntil(
          doStub
            .fetch(`https://do/avatar?v=${vkey}`, {
              method: 'PUT',
              headers: { 'x-avatar-ctype': ctype },
              body: bytes.slice() as unknown as BodyInit,
            })
            .catch(() => {}),
        );
      }
    } catch (e) {
      console.error('avatar proxy', String((e as any)?.message || e).slice(0, 200));
      return c.json({ success: false, error: 'Avatar indisponible' }, 502);
    }
  }
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': ctype,
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=86400',
    },
  });
});

/** v0.7.5 — déconnexion VOLONTAIRE : l'appareil de confiance reste connu et est
 *  marqué « reprenable » 30 j pour le MÊME compte → reconnexion mot de passe seul
 *  (2FA désactivée). Un appareil révoqué ou un autre compte restent exclus. */
app.post('/api/auth/logout', async (c) => {
  if (c.req.header('Authorization')?.slice(7).startsWith('np1.')) return c.json({ success: false, code: 'USE_NATIVE_LOGOUT', error: 'Utilisez la déconnexion native.' }, 400);
  const fingerprint = String(c.req.header('X-Device-Fingerprint') || '').slice(0, 128);
  const sess = sessionUserFromHeader(c.req.header('Authorization'));
  await ensureSecurityTables(c.env.DB);
  let resumePrepared = false;
  if (fingerprint && sess?.username) {
    try {
      const marked = await c.env.DB.prepare(
        `UPDATE trusted_devices SET resume_until = datetime('now', '+30 days') WHERE fingerprint = ? AND lower(username) = ?`,
      ).bind(fingerprint, String(sess.username).toLowerCase()).run();
      resumePrepared = Number(marked.meta?.changes || 0) > 0;
    } catch {
      return c.json({ success: false, resume_prepared: false, code: 'RESUME_PREPARATION_FAILED', error: 'Reprise indisponible. Une vérification pourra être nécessaire à la prochaine connexion.' }, 503);
    }
    await writeAudit(c.env.DB, {
      username: sess.username,
      role: sess.role || '',
      action: 'auth.logout',
      entity: 'session',
      detail: 'self_logout_resume_30d',
      ip: clientIp(c),
    });
  }
  return c.json({ success: true, resume_prepared: resumePrepared });
});

// Only this exchange accepts a stale-role proof. Business routes continue to
// reject it, including print/report paths, until a current token is issued.
app.post('/api/auth/role-refresh', async (c) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Bearer ') || header.slice(7).startsWith('np1.')) return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Session invalide' }, 401);
  const token = parseToken(header.slice(7));
  if (!token || token.version !== 2) return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Session invalide' }, 401);
  // Verify again here: do not rely on an unverified routing identity or body.
  if (await authFailReason(header, c.env, c.env.DB, clientIp(c), c.req.header('X-Device-Fingerprint'), { allowRoleRefresh: true }) !== 'ok')
    return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Session invalide' }, 401);
  const username = String(token.username || '').toLowerCase();
  let role: string;
  let material: string;
  if (username === getOwnerUsername(c.env) && token.role === 'owner') {
    role = 'owner';
    material = await sha256Hex(`owner-key|${username}|${normalizePassword(getPassword(c.env) || '')}`);
  } else {
    const row = await c.env.DB.prepare(`SELECT role, password_hash FROM app_users WHERE username = ? AND active = 1`).bind(username).first() as any;
    if (!row || !['user', 'stock', 'secretaire', 'admin'].includes(String(row.role))) return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Session invalide' }, 401);
    role = row.role;
    material = String(row.password_hash || '');
    // A password change between checks must never refresh an old proof.
    if (token.proof !== await makeSessionProof(username, String(token.role || ''), material, token.ip, token.fingerprint))
      return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Session invalide' }, 401);
  }
  const refreshed = await makeTokenV2(username, role, material, token.ip, token.fingerprint);
  return c.json({ success: true, data: { token: refreshed, username, role } });
});

app.get('/api/auth/me', async (c) => {
  const limited = refreshLimitGate(c, 'auth-me', 60);
  if (limited) return limited;
  // v243.2 — every active device (web/phone) registers itself so the
  // "appareils connectés" popup always lists yours, current one included.
  try {
    const sess = sessionUserFromHeader(c.req.header('Authorization'));
    if (!c.req.header('Authorization')?.slice(7).startsWith('np1.')) await touchTrustedDevice(c.env.DB, sess.username, c.req.header('X-Device-Fingerprint') || '', clientIp(c), c.req.header('User-Agent') || '', cfGeo(c));
  } catch { /* best-effort */ }
  const ip = clientIp(c);
  const fp = c.req.header('X-Device-Fingerprint') || undefined;
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, ip, fp);
  if (reason !== 'ok') {
    const code = reason === 'ip_changed' ? 'IP_CHANGED' : reason === 'fp_changed' ? 'DEVICE_CHANGED' : 'UNAUTHORIZED';
    return c.json({ success: false, error: 'Session invalide', code, currentIp: ip }, 401);
  }
  await ensureSecurityTables(c.env.DB);
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const ownerUser = getOwnerUsername(c.env);
  const rep = await getReputation(c.env.DB, ip).catch(() => ({ score: 50 })) as any;
  let profile: any = {
    display_name: session.role === 'owner' ? 'Administrateur' : session.username,
    email: '',
    phone: '',
    avatar_url: '',
    notes: '',
  };
  // Prefer free-tier Durable Object profile (fast, survives D1 free limits)
  const fromDo = await readProfileFromDo(c.env, session.username);
  if (fromDo && (fromDo.display_name || fromDo.email || fromDo.phone || fromDo.avatar_url || fromDo.notes)) {
    profile = { ...profile, ...fromDo };
    if (!profile.display_name) {
      profile.display_name = session.role === 'owner' ? 'Administrateur' : session.username;
    }
  } else if (session.username === ownerUser || session.role === 'owner') {
    const keys = ['owner_display_name', 'owner_email', 'owner_phone', 'owner_avatar_url', 'owner_notes'];
    for (const k of keys) {
      const r = await c.env.DB.prepare(`SELECT value FROM app_config WHERE key = ?`).bind(k).first() as any;
      if (!r?.value) continue;
      if (k === 'owner_display_name') profile.display_name = r.value;
      if (k === 'owner_email') profile.email = r.value;
      if (k === 'owner_phone') profile.phone = r.value;
      if (k === 'owner_avatar_url') profile.avatar_url = r.value;
      if (k === 'owner_notes') profile.notes = r.value;
    }
    if (!profile.display_name) profile.display_name = 'Administrateur';
  } else {
    const row = await c.env.DB.prepare(
      `SELECT display_name, email, phone, avatar_url, notes, role FROM app_users WHERE username = ?`
    ).bind(session.username).first() as any;
    if (row) {
      profile = {
        display_name: row.display_name || session.username,
        email: row.email || '',
        phone: row.phone || '',
        avatar_url: row.avatar_url || '',
        notes: row.notes || '',
      };
    }
  }
  return c.json({
    success: true,
    data: {
      ok: true,
      ip,
      username: session.username,
      role: session.role,
      is_owner: session.role === 'owner' || session.role === 'admin',
      reputationScore: rep.score,
      token: await makeTokenV2(
        session.username,
        session.role,
        session.username === ownerUser
          ? await sha256Hex(`owner-key|${session.username}|${normalizePassword(getPassword(c.env))}`)
          : String((await c.env.DB.prepare(`SELECT password_hash FROM app_users WHERE username = ?`).bind(session.username).first() as any)?.password_hash || ''),
        ip,
        fp || 'none',
      ),
      ...profile,
    },
  });
});

/** Self profile update — role is NEVER changeable here */
app.patch('/api/auth/me', async (c) => {
  const ip = clientIp(c);
  const fp = c.req.header('X-Device-Fingerprint') || undefined;
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, ip, fp);
  if (reason !== 'ok') {
    return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  }
  await ensureSecurityTables(c.env.DB);
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const ownerUser = getOwnerUsername(c.env);
  const body = await c.req.json().catch(() => ({}));
  if (body.role != null) {
    return c.json({
      success: false,
      error: 'Vous ne pouvez pas modifier votre rôle. Contactez un administrateur pour plus d\'accès.',
      code: 'ROLE_LOCKED',
    }, 403);
  }
  if (body.username != null || body.login != null || body.user != null) {
    return c.json({
      success: false,
      error: 'L\'identifiant ne peut pas être modifié ici. Contactez un administrateur.',
      code: 'USERNAME_LOCKED',
    }, 403);
  }
  if (body.password != null || body.new_password != null || body.password_hash != null || body.current_password != null) {
    return c.json({
      success: false,
      error: 'Le mot de passe ne peut pas être modifié depuis le profil. Demandez à un administrateur.',
      code: 'PASSWORD_LOCKED',
    }, 403);
  }
  const display_name = body.display_name != null ? String(body.display_name).trim().slice(0, 80) : undefined;
  const email = body.email != null ? String(body.email).trim().slice(0, 120) : undefined;
  const phone = body.phone != null ? String(body.phone).trim().slice(0, 40) : undefined;
  const notes = body.notes != null ? String(body.notes).trim().slice(0, 300) : undefined;

  // Avatar: data-URL → R2 CDN (data URLs are too large for D1 / 500-char slice)
  let avatar_url: string | undefined = undefined;
  if (body.avatar_url != null) {
    const raw = String(body.avatar_url).trim();
    if (!raw) {
      avatar_url = '';
    } else if (raw.startsWith('data:image') && c.env.IMAGES) {
      const safeUser = session.username.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'user';
      const key = `avatars/${safeUser}/${Date.now().toString(36)}.jpg`;
      const cdn = await uploadDataUrlImage(c.env.IMAGES, c.env, raw, key);
      if (!cdn) {
        return c.json({ success: false, error: 'Impossible d\'enregistrer la photo (format ou taille). Utilisez JPG/PNG < 4 Mo.' }, 400);
      }
      avatar_url = cdn;
    } else if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('/')) {
      avatar_url = raw.slice(0, 500);
    } else if (raw.startsWith('data:image')) {
      // No R2 — keep short placeholder message
      return c.json({
        success: false,
        error: 'Stockage images (R2) indisponible. Configurez le bucket IMAGES ou utilisez une URL https.',
      }, 503);
    } else {
      avatar_url = raw.slice(0, 500);
    }
  }

  // Always write to free-tier Durable Object first (source of truth for profile UX)
  const existingDo = await readProfileFromDo(c.env, session.username);
  const mergedForDo = {
    display_name:
      display_name != null
        ? display_name
        : existingDo?.display_name || (session.role === 'owner' ? 'Administrateur' : session.username),
    email: email != null ? email : existingDo?.email || '',
    phone: phone != null ? phone : existingDo?.phone || '',
    avatar_url: avatar_url != null ? avatar_url : existingDo?.avatar_url || '',
    notes: notes != null ? notes : existingDo?.notes || '',
  };
  const savedDo = await writeProfileToDo(c.env, session.username, mergedForDo);

  if (session.username === ownerUser || session.role === 'owner') {
    const put = async (k: string, v: string) => {
      await c.env.DB.prepare(
        `INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
      ).bind(k, v).run();
    };
    if (display_name != null) await put('owner_display_name', display_name);
    if (email != null) await put('owner_email', email);
    if (phone != null) await put('owner_phone', phone);
    if (avatar_url != null) await put('owner_avatar_url', avatar_url);
    if (notes != null) await put('owner_notes', notes);
    const out = savedDo || {
      display_name: display_name ?? mergedForDo.display_name,
      email: email ?? mergedForDo.email,
      phone: phone ?? mergedForDo.phone,
      avatar_url: avatar_url ?? mergedForDo.avatar_url,
      notes: notes ?? mergedForDo.notes,
    };
    return c.json({
      success: true,
      message: 'Profil mis à jour',
      data: out,
    });
  }

  const row = await c.env.DB.prepare(`SELECT id FROM app_users WHERE username = ?`).bind(session.username).first() as any;
  if (!row) {
    // Still ok if DO wrote — owner-only secret user may not be in app_users
    if (savedDo) {
      return c.json({ success: true, message: 'Profil mis à jour', data: savedDo });
    }
    return c.json({ success: false, error: 'Utilisateur introuvable' }, 404);
  }
  const cur = await c.env.DB.prepare(`SELECT * FROM app_users WHERE id = ?`).bind(row.id).first() as any;
  const nextAvatar = avatar_url != null ? avatar_url : (cur.avatar_url || '');
  const nextDisplay = display_name != null ? display_name : (cur.display_name || '');
  const nextEmail = email != null ? email : (cur.email || '');
  const nextPhone = phone != null ? phone : (cur.phone || '');
  const nextNotes = notes != null ? notes : (cur.notes || '');
  try {
    await c.env.DB.prepare(
      `UPDATE app_users SET display_name = ?, email = ?, phone = ?, avatar_url = ?, notes = ? WHERE id = ?`
    ).bind(nextDisplay, nextEmail, nextPhone, nextAvatar, nextNotes, row.id).run();
  } catch {
    /* DO is primary; D1 mirror is best-effort */
  }
  const out = savedDo || {
    display_name: nextDisplay,
    email: nextEmail,
    phone: nextPhone,
    avatar_url: nextAvatar,
    notes: nextNotes,
  };
  return c.json({
    success: true,
    message: 'Profil mis à jour',
    data: out,
  });
});

/* ─── Auth Middleware ─── */

/* ─── Public Routes ─── */

registerPublicSignedRoutes(app, {
  requireOwner,
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

app.get('/api/settings' , async (c) => {
  try { await ensureHrSettings(c.env.DB); } catch { /* */ }

  const ttl = Math.max(60, Number(c.env.CACHE_TTL_SECONDS || DEFAULT_CACHE_TTL));
  const cached = await kvGetJson<any>(c.env.CACHE, await settingsCacheKey(c.env.CACHE));
  if (cached) return c.json({ success: true, data: cached, meta: { cache: 'hit' } });

  await ensureDocAssetColumns(c.env.DB);
  await ensureHmacKeyColumns(c.env.DB);
  await ensureInvoiceRefundColumns(c.env.DB);
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  if (settings) {
    const { hmac_secret_current, hmac_secret_previous, ...safe } = settings;
    const data = {
      ...safe,
      hmac_configured: !!(hmac_secret_current || hmac_secret_previous),
      hmac_rotated_at: settings.hmac_rotated_at || null,
      hmac_rotate_days: settings.hmac_rotate_days ?? 90,
    };
    await kvPutJson(c.env.CACHE, await settingsCacheKey(c.env.CACHE), data, ttl);
    return c.json({ success: true, data, meta: { cache: 'miss' } });
  }
  return c.json({ success: true, data: settings });
});

app.put('/api/settings', async (c) => {
  try { await ensureHrSettings(c.env.DB); } catch { /* */ }

  // Company settings: owner / admin / secrétaire only (not stock / user)
  const gate = requireBizMutator(c);
  if (!gate.ok) return gate.response;
  await ensureInvoiceRefundColumns(c.env.DB);
  const body = await c.req.json();

  if (body.credit_prefix !== undefined) {
    const p = validateCreditPrefix(body.credit_prefix);
    if (!p.ok) return c.json({ success: false, error: p.error, code: p.code }, 400);
    body.credit_prefix = p.value;
  }
  if (body.next_credit_number !== undefined) {
    const n = validateNextCreditNumber(body.next_credit_number);
    if (!n.ok) return c.json({ success: false, error: n.error, code: n.code }, 400);
    body.next_credit_number = n.value;
  }
  // Other document prefixes: light sanitize
  for (const key of ['invoice_prefix', 'quote_prefix', 'receipt_prefix', 'bill_prefix'] as const) {
    if (body[key] !== undefined) {
      const v = String(body[key] || '').trim().slice(0, 12);
      if (v && !/^[A-Za-z0-9][A-Za-z0-9\-/]{0,11}$/.test(v)) {
        return c.json({
          success: false,
          error: `Préfixe « ${key} » invalide. Lettres, chiffres, - ou / uniquement (max 12).`,
          code: 'PREFIX_INVALID',
        }, 400);
      }
      body[key] = v;
    }
  }

    // HR flags (0/1)
  if (body.attendance_enabled !== undefined) {
    body.attendance_enabled = body.attendance_enabled ? 1 : 0;
  }
  if (body.attendance_late_grace_pct !== undefined) {
    body.attendance_late_grace_pct = Math.max(0, Math.min(100, Number(body.attendance_late_grace_pct) || 25));
  }
  if (body.attendance_late_block_pct !== undefined) {
    body.attendance_late_block_pct = Math.max(1, Math.min(50, Number(body.attendance_late_block_pct) || 10));
  }
  if (body.attendance_late_half_days !== undefined) {
    body.attendance_late_half_days = Math.max(0, Math.min(5, Number(body.attendance_late_half_days) || 0.5));
  }
  if (body.attendance_late_threshold !== undefined) {
    const th = String(body.attendance_late_threshold || '09:15').trim();
    body.attendance_late_threshold = /^\d{1,2}:\d{2}$/.test(th) ? th.padStart(5, '0') : '09:15';
  }

  if (body.attendance_half_morning !== undefined) body.attendance_half_morning = String(body.attendance_half_morning || '09:00-13:00').slice(0, 20);
  if (body.attendance_half_afternoon !== undefined) body.attendance_half_afternoon = String(body.attendance_half_afternoon || '14:00-18:00').slice(0, 20);
  if (body.attendance_workday_hours !== undefined) body.attendance_workday_hours = Math.max(1, Math.min(24, Number(body.attendance_workday_hours) || 8));
  if (body.attendance_acompte_week1_pct !== undefined) body.attendance_acompte_week1_pct = Math.max(0, Math.min(50, Number(body.attendance_acompte_week1_pct) || 5));
  if (body.attendance_acompte_week2_pct !== undefined) body.attendance_acompte_week2_pct = Math.max(0, Math.min(50, Number(body.attendance_acompte_week2_pct) || 5));
  if (body.attendance_acompte_week3_pct !== undefined) body.attendance_acompte_week3_pct = Math.max(0, Math.min(50, Number(body.attendance_acompte_week3_pct) || 5));
  if (body.attendance_acompte_week4_pct !== undefined) body.attendance_acompte_week4_pct = Math.max(0, Math.min(50, Number(body.attendance_acompte_week4_pct) || 5));
  if (body.attendance_acompte_monthly_max_pct !== undefined) body.attendance_acompte_monthly_max_pct = Math.max(0, Math.min(50, Number(body.attendance_acompte_monthly_max_pct) || 15));
  if (body.attendance_acompte_short_cycle_days !== undefined) body.attendance_acompte_short_cycle_days = Math.max(1, Math.min(60, Number(body.attendance_acompte_short_cycle_days) || 14));
  if (body.attendance_acompte_short_max_pct !== undefined) body.attendance_acompte_short_max_pct = Math.max(0, Math.min(50, Number(body.attendance_acompte_short_max_pct) || 5));
  if (body.attendance_acompte_require_presence !== undefined) body.attendance_acompte_require_presence = body.attendance_acompte_require_presence ? 1 : 0;
  if (body.attendance_pay_use_presence !== undefined) body.attendance_pay_use_presence = body.attendance_pay_use_presence ? 1 : 0;

  if (body.attendance_minute_deduct !== undefined) body.attendance_minute_deduct = body.attendance_minute_deduct ? 1 : 0;
  if (body.attendance_warn_late_count !== undefined) body.attendance_warn_late_count = Math.max(1, Math.min(30, Number(body.attendance_warn_late_count) || 3));
  if (body.attendance_blame_late_count !== undefined) body.attendance_blame_late_count = Math.max(1, Math.min(60, Number(body.attendance_blame_late_count) || 6));
  if (body.attendance_pay_mode !== undefined) {
    body.attendance_pay_mode = String(body.attendance_pay_mode).toLowerCase() === 'calendar' ? 'calendar' : 'presence';
  }



  const fields = [
    'company_name', 'legal_form', 'address', 'city', 'postal_code', 'country',
    'phone', 'email', 'website', 'ice', 'if_number', 'rc', 'patente', 'cnss',
    'logo_url', 'company_signature_url', 'company_stamp_url', 'currency', 'date_format', 'tax_rate',
    'invoice_prefix', 'quote_prefix', 'receipt_prefix', 'bill_prefix', 'credit_prefix', 'quick_sale_prefix',
    'next_invoice_number', 'next_quote_number', 'next_receipt_number', 'next_bill_number', 'next_credit_number', 'next_quick_sale_number',
    'numbering_style', 'numbering_pad',
    'starting_balance', 'bank_name', 'bank_iban', 'bank_swift', 'notes', 'report_footer', 'show_legal_footer', 'price_decimals', 'retention_cancelled_days', 'document_footer_note', 'pdf_show_logo', 'pdf_show_qr', 'pdf_show_bank', 'pdf_show_stamp', 'pdf_show_promo', 'pdf_accent_color', 'pdf_footer_text', 'qr_client_situation', 'qr_situation_ttl_days', 'client_data_retention_days',
    'multi_warehouse', 'sales_location_id', 'purchase_location_id', 'inventory_valuation_method',
    'secondary_currency', 'secondary_currency_rate',
    'attendance_enabled',
    'attendance_late_threshold',
    'attendance_late_half_days',
    'attendance_late_block_pct',
    'attendance_late_grace_pct',
    'attendance_pay_use_presence',
    'attendance_pay_mode',
    'attendance_blame_late_count',
    'attendance_warn_late_count',
    'attendance_minute_deduct',
    'attendance_acompte_require_presence',
    'attendance_acompte_short_max_pct',
    'attendance_acompte_short_cycle_days',
    'attendance_acompte_week2_pct',
    'attendance_acompte_monthly_max_pct',
    'attendance_acompte_week4_pct',
    'attendance_acompte_week3_pct',
    'attendance_acompte_week1_pct',
    'attendance_workday_hours',
    'attendance_half_afternoon',
    'attendance_half_morning',
    'employee_prefix', 'next_employee_number',
  ];
  const updates: string[] = [];
  const values: any[] = [];
  for (const f of fields) {
    if (body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(body[f]);
    }
  }
  if (updates.length === 0) return c.json({ success: false, error: 'Aucun champ à modifier. Vérifiez les valeurs saisies.', code: 'NO_FIELDS' }, 400);
  updates.push(`updated_at = datetime('now')`);
  try {
    try { await ensureHrSettings(c.env.DB); } catch { /* */ }
    await schemaOnce('settings_extra_cols', async () => {
      await addColumnIfMissing(c.env.DB, 'company_settings', 'secondary_currency', "TEXT DEFAULT ''");
      await addColumnIfMissing(c.env.DB, 'company_settings', 'secondary_currency_rate', 'REAL DEFAULT 0');
      await addColumnIfMissing(c.env.DB, 'company_settings', 'employee_prefix', "TEXT DEFAULT 'EMP-'");
      await addColumnIfMissing(c.env.DB, 'company_settings', 'next_employee_number', 'INTEGER DEFAULT 1');
      await addColumnIfMissing(c.env.DB, 'company_settings', 'tax_rate', 'REAL DEFAULT 20');
    });
    await c.env.DB.prepare(`UPDATE company_settings SET ${updates.join(', ')} WHERE id = 1`).bind(...values).run();
  } catch (e: any) {
    return c.json({
      success: false,
      error: 'Impossible d’enregistrer les paramètres (colonne manquante ou base indisponible). Réessayez après déploiement.',
      code: 'SETTINGS_SAVE_FAILED',
      detail: String(e?.message || e),
    }, 500);
  }
  await invalidateDashboardCache(c.env.CACHE, c.env.MOBILE_HUB);
  try {
    const su = sessionUserFromHeader(c.req.header('Authorization'));
    const changed = fields.filter((f) => body[f] !== undefined).slice(0, 24);
    await writeAudit(c.env.DB, {
      username: su?.username,
      role: su?.role,
      action: 'settings.update',
      entity: 'company_settings',
      entity_id: '1',
      detail: changed.length ? `champs=${changed.join(',')}` : 'settings',
      ip: c.req.header('cf-connecting-ip') || '',
    });
  } catch { /* */ }
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first();
  return c.json({ success: true, data: settings, message: 'Paramètres enregistrés.' });
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
/** Open AR / linked docs for client — blocks hard delete. */
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

async function ensurePaymentHistoryTable(db: D1Database) {
  await schemaOnce('ensurePaymentHistoryTable', async () => {
  await db.prepare(`CREATE TABLE IF NOT EXISTS invoice_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT DEFAULT 'cash',
    payee TEXT DEFAULT 'company',
    note TEXT DEFAULT '',
    paid_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();

  });
}

async function ensureReceiptsTable(db: D1Database) {
  await schemaOnce('ensureReceiptsTable', async () => {
  await db.prepare(`CREATE TABLE IF NOT EXISTS receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL UNIQUE,
    invoice_id INTEGER,
    client_name TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    payment_method TEXT DEFAULT 'cash',
    issue_date TEXT,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();

  });
}

/** Find ledger expenses linked to an invoice (via notes invoice_id:N) */
async function expensesLinkedToInvoice(db: D1Database, invoiceId: string | number) {
  const { results } = await db.prepare(
    `SELECT * FROM expenses WHERE notes LIKE ? OR reference = (SELECT number FROM invoices WHERE id = ?) ORDER BY id`
  ).bind(`%invoice_id:${invoiceId}%`, invoiceId).all();
  return results || [];
}

async function expensesLinkedToReceipt(db: D1Database, receipt: any) {
  if (!receipt) return [];
  const invId = receipt.invoice_id;
  if (invId) return expensesLinkedToInvoice(db, invId);
  // Manual receipt: match by reference = receipt number or description
  const { results } = await db.prepare(
    `SELECT * FROM expenses WHERE reference = ? OR notes LIKE ? ORDER BY id`
  ).bind(receipt.number || '', `%receipt:${receipt.id}%`).all();
  return results || [];
}

async function getInvoiceLinks(db: D1Database, invoiceId: string | number) {
  await ensureReceiptsTable(db);
  await ensurePaymentHistoryTable(db);
  const invoice = await db.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(invoiceId).first() as any;
  if (!invoice) return null;
  const { results: payments } = await db.prepare(
    `SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY id`
  ).bind(invoiceId).all();
  const { results: receipts } = await db.prepare(
    `SELECT * FROM receipts WHERE invoice_id = ? ORDER BY id`
  ).bind(invoiceId).all();
  const expenses = await expensesLinkedToInvoice(db, invoiceId);
  return {
    invoice,
    payments: payments || [],
    receipts: receipts || [],
    expenses,
  };
}

async function cascadeDeleteInvoice(db: D1Database, invoiceId: string | number) {
  await ensureInvoiceRefundColumns(db);
  const links = await getInvoiceLinks(db, invoiceId);
  if (!links) return null;
  const inv = links.invoice;
  const wasQuote = inv.status === 'quote' || inv.status === 'devis';
  const isRefund = inv.status === 'remboursement' || inv.doc_kind === 'remboursement';
  const { results: items } = await db.prepare(
    `SELECT product_id, quantity FROM invoice_items WHERE invoice_id = ?`
  ).bind(invoiceId).all();

  if (isRefund) {
    // 1) Stock: reverse only lines that were restocked on WR create (sku restock:0 = no return)
    for (const it of (items || []) as any[]) {
      if (!it.product_id) continue;
      const sku = String(it.sku || '');
      const noRestock = /restock:0\b/.test(sku);
      if (noRestock) continue;
      await applyStockDelta(
        db,
        it.product_id,
        -Number(it.quantity || 0),
        'WR deleted (annuler retour stock)',
        inv.number,
        { type: 'sale' },
      );
    }

    const sourceId = inv.refund_of_invoice_id;
    const wrTotal = Number(inv.total || 0);

    // 2) Balance: remove cash-outflow expenses created for this WR (money returns to caisse/banque)
    let cashRefundAmount = 0;
    try {
      const { results: wrExp } = await db.prepare(
        `SELECT id, amount FROM expenses WHERE notes LIKE ? OR reference = ?`
      ).bind(`%credit_id:${invoiceId}%`, inv.number || '').all();
      for (const e of (wrExp || []) as any[]) {
        cashRefundAmount += Number(e.amount || 0);
        await db.prepare(`DELETE FROM expenses WHERE id = ?`).bind(e.id).run();
      }
    } catch { /* */ }

    // 3) Source invoice still exists → undo credit applied to amount_paid (unpaid portion only)
    //    cash portion never changed amount_paid on create; only creditVsDebt did.
    if (sourceId && wrTotal > 0.001) {
      const source = await db.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(sourceId).first() as any;
      if (source) {
        const creditVsDebt = Math.max(0, Math.round((wrTotal - cashRefundAmount) * 100) / 100);
        const paid = Number(source.amount_paid || 0);
        const srcTotal = Number(source.total || 0);
        const nextPaid = Math.max(0, Math.min(srcTotal, paid - creditVsDebt));
        let newStatus = source.status;
        if (source.status === 'cancelled') {
          newStatus = 'cancelled';
        } else if (nextPaid <= 0.001) {
          newStatus = 'sent';
        } else if (nextPaid + 0.001 >= srcTotal) {
          newStatus = 'paid';
        } else {
          newStatus = 'partial';
        }
        await db.prepare(
          `UPDATE invoices SET amount_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
        ).bind(nextPaid, newStatus, sourceId).run();
        try {
          await db.prepare(
            `DELETE FROM invoice_payments WHERE invoice_id = ? AND (note LIKE ? OR note LIKE ?)`
          ).bind(sourceId, `%${inv.number}%`, `%Avoir ${inv.number}%`).run();
        } catch { /* */ }
      }
      // source already deleted → nothing to restore on AR; expenses already removed above
    }
  } else if (!wasQuote && inv.status !== 'cancelled') {
    // Normal sale invoice: deleting restores stock
    for (const it of (items || []) as any[]) {
      if (it.product_id) {
        await applyStockDelta(db, it.product_id, Number(it.quantity || 0), 'Ticket / facture supprimé (retour stock)', inv.number);
      }
    }
  }
  // expenses linked to invoice
  for (const e of links.expenses) {
    await db.prepare(`DELETE FROM expenses WHERE id = ?`).bind(e.id).run();
  }
  for (const r of links.receipts) {
    await db.prepare(`DELETE FROM receipts WHERE id = ?`).bind(r.id).run();
  }
  await db.prepare(`DELETE FROM invoice_payments WHERE invoice_id = ?`).bind(invoiceId).run();
  await db.prepare(`DELETE FROM invoice_items WHERE invoice_id = ?`).bind(invoiceId).run();
  await db.prepare(`DELETE FROM invoices WHERE id = ?`).bind(invoiceId).run();
  return links;
}





async function publicRateLimit(env: any, key: string, limit = 30, windowTtl = 60): Promise<boolean> {
  try {
    if (!env.CACHE) return false;
    const k = `pub_rl:${key}`;
    const n = Number((await env.CACHE.get(k)) || 0);
    if (n >= limit) return true;
    await env.CACHE.put(k, String(n + 1), { expirationTtl: windowTtl });
    return false;
  } catch { return false; }
}

async function ensureReceiptSituationColumn(db: D1Database) {
  await schemaOnce('ensureReceiptSituationColumn', async () => {
  await addColumnIfMissing(db, 'receipts', 'include_client_situation', `INTEGER DEFAULT 0`);

  });
}

async function ensureQrPrivacySettings(db: D1Database) {
  await schemaOnce('ensureQrPrivacySettings', async () => {
  await addColumnIfMissing(db, 'company_settings', 'qr_client_situation', `INTEGER DEFAULT 0`);
  await addColumnIfMissing(db, 'company_settings', 'qr_situation_ttl_days', `INTEGER DEFAULT 90`);
  await addColumnIfMissing(db, 'company_settings', 'client_data_retention_days', `INTEGER DEFAULT 1825`);

  });
}

async function ensureInvoicePublicToken(db: D1Database) {
  await schemaOnce('ensureInvoicePublicToken', async () => {
  await addColumnIfMissing(db, 'invoices', 'public_token', `TEXT`);
  await addColumnIfMissing(db, 'invoices', 'client_signature', `TEXT`);
  await addColumnIfMissing(db, 'invoices', 'signed_at', `TEXT`);
  await addColumnIfMissing(db, 'invoices', 'signature_digest', `TEXT`);
  await addColumnIfMissing(db, 'invoices', 'signed_doc_hash', `TEXT`);
  await addColumnIfMissing(db, 'invoices', 'timestamp_token', `TEXT`);
  await addColumnIfMissing(db, 'invoices', 'timestamp_at', `TEXT`);

  });
}

function makePublicToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/**
 * HMAC secrets — automated rotation (DB) + optional env bootstrap.
 *
 * Storage (company_settings):
 *   hmac_secret_current, hmac_secret_previous, hmac_rotated_at, hmac_rotate_days
 *
 * Auto-rotate every hmac_rotate_days (default 90) on first print/verify after expiry.
 * Manual: POST /api/admin/rotate-hmac-keys (owner only).
 *
 * Env bootstrap (optional): PUBLIC_TOKEN_SECRET / PUBLIC_TOKEN_SECRET_PREVIOUS
 * used only until DB secrets exist.
 */
function envBootstrapSecrets(env: Env): { current: string; previous: string | null } {
  const current = String(
    (env as any).PUBLIC_TOKEN_SECRET || (env as any).JWT_SECRET || '',
  ).trim();
  const prevRaw = (env as any).PUBLIC_TOKEN_SECRET_PREVIOUS;
  const previous = prevRaw != null && String(prevRaw).trim() !== '' ? String(prevRaw) : null;
  return { current, previous };
}

function randomHmacSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function ensureHmacKeyColumns(db: D1Database) {
  await schemaOnce('hmac_key_cols', async () => {
    await addColumnIfMissing(db, 'company_settings', 'hmac_secret_current', 'TEXT');
    await addColumnIfMissing(db, 'company_settings', 'hmac_secret_previous', 'TEXT');
    await addColumnIfMissing(db, 'company_settings', 'hmac_rotated_at', 'TEXT');
    await addColumnIfMissing(db, 'company_settings', 'hmac_rotate_days', 'INTEGER DEFAULT 90');
  });
}

/** Resolve secrets; auto-rotate if stale. Always returns at least current. */
async function publicTokenSecretsAsync(
  env: Env,
  db?: D1Database,
  opts?: { forceRotate?: boolean },
): Promise<{ current: string; previous: string | null; rotated: boolean; rotatedAt: string | null }> {
  const boot = envBootstrapSecrets(env);
  if (!db) {
    return { current: boot.current, previous: boot.previous, rotated: false, rotatedAt: null };
  }
  await ensureHmacKeyColumns(db);
  let row = await db.prepare(
    `SELECT hmac_secret_current, hmac_secret_previous, hmac_rotated_at, hmac_rotate_days FROM company_settings WHERE id = 1`,
  ).first() as any;

  // Bootstrap DB from env if empty — never use a hardcoded fallback secret
  if (!row?.hmac_secret_current) {
    const now = new Date().toISOString();
    const seed = boot.current || randomHmacSecret();
    try {
      await db.prepare(
        `UPDATE company_settings SET hmac_secret_current = ?, hmac_secret_previous = ?, hmac_rotated_at = ?, hmac_rotate_days = COALESCE(hmac_rotate_days, 90) WHERE id = 1`,
      ).bind(seed, boot.previous, now).run();
    } catch {
      /* ignore */
    }
    row = {
      hmac_secret_current: seed,
      hmac_secret_previous: boot.previous,
      hmac_rotated_at: now,
      hmac_rotate_days: 90,
    };
  }

  const days = Math.max(7, Number(row.hmac_rotate_days || 90));
  const rotatedAt = row.hmac_rotated_at ? new Date(row.hmac_rotated_at).getTime() : 0;
  const ageMs = Date.now() - rotatedAt;
  const stale = !rotatedAt || ageMs > days * 24 * 60 * 60 * 1000;
  let rotated = false;
  let current = String(row.hmac_secret_current || boot.current);
  let previous = row.hmac_secret_previous ? String(row.hmac_secret_previous) : boot.previous;
  let newRotatedAt = row.hmac_rotated_at || null;

  if (opts?.forceRotate || stale) {
    const next = randomHmacSecret();
    previous = current;
    current = next;
    newRotatedAt = new Date().toISOString();
    try {
      await db.prepare(
        `UPDATE company_settings SET hmac_secret_current = ?, hmac_secret_previous = ?, hmac_rotated_at = ? WHERE id = 1`,
      ).bind(current, previous, newRotatedAt).run();
      rotated = true;
    } catch (e) {
      console.error('hmac auto-rotate failed', e);
      // keep old keys
      current = String(row.hmac_secret_current || boot.current);
      previous = row.hmac_secret_previous ? String(row.hmac_secret_previous) : boot.previous;
      rotated = false;
    }
  }

  return { current, previous, rotated, rotatedAt: newRotatedAt };
}

/** Sync helper for call sites that still expect sync shape — prefer publicTokenSecretsAsync. */
function publicTokenSecrets(env: Env): { current: string; previous: string | null } {
  return envBootstrapSecrets(env);
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function b64urlEncode(str: string): string {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): string {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return decodeURIComponent(escape(atob(s)));
}

/**
 * Secure QR payload:
 * - v2.<type>.<token>.<exp>.<kid>.<hmac16>  (kid 1 = current, 0 = previous)
 * - v1.<type>.<token>.<exp>.<hmac16>        (legacy, verified against current then previous)
 */
async function makeSecureQrPayload(
  env: Env,
  type: 'invoice' | 'receipt',
  dbToken: string,
  ttlSeconds = 0,
  db?: D1Database,
): Promise<string> {
  const exp = ttlSeconds > 0 ? Math.floor(Date.now() / 1000) + ttlSeconds : 0;
  const kid = 1; // always sign with current key
  const secrets = await publicTokenSecretsAsync(env, db);
  const msg = `v2|${type}|${dbToken}|${exp}|${kid}`;
  const mac = await hmacSha256Hex(secrets.current, msg);
  return `v2.${type}.${dbToken}.${exp}.${kid}.${mac.slice(0, 16)}`;
}

type SecureQrParse =
  | { ok: true; type: 'invoice' | 'receipt'; token: string; exp: number; kid?: number }
  | { ok: false; reason: string };

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function parseSecureQrPayload(env: Env, raw: string, db?: D1Database): Promise<SecureQrParse> {
  const s = String(raw || '').trim();
  if (!s) return { ok: false, reason: 'empty' };
  const secrets = await publicTokenSecretsAsync(env, db);
  const secretsToTry = [secrets.current, secrets.previous].filter(Boolean) as string[];

  // v2 with key id
  if (s.startsWith('v2.')) {
    const parts = s.split('.');
    if (parts.length !== 6) return { ok: false, reason: 'bad_format' };
    const [, type, token, expStr, kidStr, mac] = parts;
    if (type !== 'invoice' && type !== 'receipt') return { ok: false, reason: 'bad_type' };
    if (!/^[a-z0-9]{16,48}$/i.test(token)) return { ok: false, reason: 'bad_token' };
    const exp = Number(expStr);
    const kid = Number(kidStr);
    if (!Number.isFinite(exp) || exp < 0) return { ok: false, reason: 'bad_exp' };
    if (exp > 0 && Math.floor(Date.now() / 1000) > exp) return { ok: false, reason: 'expired' };
    if (kid !== 0 && kid !== 1) return { ok: false, reason: 'bad_kid' };
    const msg = `v2|${type}|${token}|${exp}|${kid}`;
    // Prefer matching kid: 1 → current, 0 → previous; still try all secrets
    const ordered =
      kid === 1
        ? secretsToTry
        : secrets.previous
          ? [secrets.previous, secrets.current]
          : secretsToTry;
    for (const sec of ordered) {
      const expected = (await hmacSha256Hex(sec, msg)).slice(0, 16);
      if (timingSafeEqual(expected, mac)) {
        return { ok: true, type, token, exp, kid };
      }
    }
    return { ok: false, reason: 'bad_mac' };
  }

  // v1 legacy
  if (s.startsWith('v1.')) {
    const parts = s.split('.');
    if (parts.length !== 5) return { ok: false, reason: 'bad_format' };
    const [, type, token, expStr, mac] = parts;
    if (type !== 'invoice' && type !== 'receipt') return { ok: false, reason: 'bad_type' };
    if (!/^[a-z0-9]{16,48}$/i.test(token)) return { ok: false, reason: 'bad_token' };
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp < 0) return { ok: false, reason: 'bad_exp' };
    if (exp > 0 && Math.floor(Date.now() / 1000) > exp) return { ok: false, reason: 'expired' };
    const msg = `v1|${type}|${token}|${exp}`;
    for (const sec of secretsToTry) {
      const expected = (await hmacSha256Hex(sec, msg)).slice(0, 16);
      if (timingSafeEqual(expected, mac)) {
        return { ok: true, type, token, exp };
      }
    }
    return { ok: false, reason: 'bad_mac' };
  }

  // Bare DB token (very old prints)
  if (/^[a-z0-9]{16,48}$/i.test(s)) {
    return { ok: true, type: 'invoice', token: s, exp: 0 };
  }
  return { ok: false, reason: 'unsupported' };
}


/** Canonical integrity fingerprint for a sales/purchase document (PDF seal). */
async function documentIntegrityHash(parts: Record<string, string | number | null | undefined>): Promise<string> {
  const keys = Object.keys(parts).sort();
  const payload = keys.map((k) => `${k}=${parts[k] ?? ''}`).join('|');
  return sha256Hex(payload);
}

/**
 * Cryptographic timestamp (PAdES-T intent / ETSI EN 319 142 B-T aligned).
 *
 * Full Adobe PAdES-B-T embeds an RFC 3161 TSA token inside a CMS signature
 * in the PDF. Workers cannot hold a commercial TSA private key by default.
 * We issue an **Atlas Timestamp Token (ATT)** bound by HMAC-SHA256 to:
 *   - document integrity hash
 *   - UTC time (ISO-8601)
 *   - nonce
 * Verifiable offline against current/previous HMAC keys.
 * Structure is stable so a future RFC 3161 TSA can replace the inner proof
 * without changing public APIs.
 */
type AtlasTimestampToken = {
  v: 1;
  alg: 'HMAC-SHA256';
  /** ISO-8601 UTC */
  t: string;
  /** Document hash being timestamped */
  h: string;
  /** Random nonce (hex) */
  n: string;
  /** HMAC over v|t|h|n */
  mac: string;
  /** Key id 1=current 0=previous at issue time */
  kid: number;
  /** Human label */
  profile: 'PAdES-B-T-aligned';
};

async function createAtlasTimestampToken(
  env: Env,
  docHash: string,
  db?: D1Database,
): Promise<{ token: AtlasTimestampToken; compact: string; issuedAt: string }> {
  const secrets = await publicTokenSecretsAsync(env, db);
  const issuedAt = new Date().toISOString();
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const n = Array.from(nonceBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  const h = String(docHash || '').toLowerCase();
  const msg = `att1|${issuedAt}|${h}|${n}`;
  const mac = (await hmacSha256Hex(secrets.current, msg)).slice(0, 32);
  const token: AtlasTimestampToken = {
    v: 1,
    alg: 'HMAC-SHA256',
    t: issuedAt,
    h,
    n,
    mac,
    kid: 1,
    profile: 'PAdES-B-T-aligned',
  };
  const compact = b64urlEncode(JSON.stringify(token));
  return { token, compact, issuedAt };
}

async function verifyAtlasTimestampToken(
  env: Env,
  compactOrJson: string,
  expectedHash?: string,
  db?: D1Database,
): Promise<{ ok: boolean; reason?: string; token?: AtlasTimestampToken }> {
  let token: AtlasTimestampToken;
  try {
    const raw = compactOrJson.trim().startsWith('{')
      ? compactOrJson
      : b64urlDecode(compactOrJson.trim());
    token = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'bad_token_encoding' };
  }
  if (!token || token.v !== 1 || token.alg !== 'HMAC-SHA256') {
    return { ok: false, reason: 'bad_token_version' };
  }
  if (expectedHash && token.h && token.h.toLowerCase() !== expectedHash.toLowerCase()) {
    return { ok: false, reason: 'hash_mismatch' };
  }
  const msg = `att1|${token.t}|${token.h}|${token.n}`;
  const secrets = await publicTokenSecretsAsync(env, db);
  const trySecrets = [secrets.current, secrets.previous].filter(Boolean) as string[];
  for (const sec of trySecrets) {
    const expected = (await hmacSha256Hex(sec, msg)).slice(0, 32);
    if (timingSafeEqual(expected, token.mac)) {
      return { ok: true, token };
    }
  }
  return { ok: false, reason: 'bad_mac' };
}


/** Canonical document snapshot at signature time (detect later total changes). */
function invoiceDocHashPayload(inv: any): string {
  return [
    inv.number || '',
    inv.client_name || '',
    Number(inv.total || 0),
    Number(inv.amount_paid || 0),
    inv.issue_date || '',
    inv.status || '',
  ].join('|');
}

async function digestSignatureImage(dataUrl: string): Promise<string> {
  // Hash the base64 body only (stable fingerprint of the drawing)
  const i = dataUrl.indexOf(',');
  const body = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  return sha256Hex(body.slice(0, 200_000));
}

async function validateStoredSignature(inv: any): Promise<{
  present: boolean;
  imageOk: boolean;
  digestOk: boolean;
  docUnchanged: boolean;
  signedAt: string | null;
  message: string;
}> {
  const present = !!(inv.client_signature && String(inv.client_signature).startsWith('data:image'));
  if (!present) {
    return {
      present: false,
      imageOk: false,
      digestOk: false,
      docUnchanged: true,
      signedAt: null,
      message: 'Aucune signature client enregistrée.',
    };
  }
  const imageOk =
    inv.client_signature.startsWith('data:image/png') ||
    inv.client_signature.startsWith('data:image/jpeg') ||
    inv.client_signature.startsWith('data:image/jpg') ||
    inv.client_signature.startsWith('data:image/webp');
  let digestOk = true;
  if (inv.signature_digest) {
    const d = await digestSignatureImage(String(inv.client_signature));
    digestOk = d === inv.signature_digest;
  }
  let docUnchanged = true;
  if (inv.signed_doc_hash) {
    const h = await sha256Hex(invoiceDocHashPayload(inv));
    docUnchanged = h === inv.signed_doc_hash;
  }
  let message = 'Signature client valide.';
  if (!imageOk) message = 'Format de signature non reconnu.';
  else if (!digestOk) message = 'Signature altérée (empreinte ne correspond pas).';
  else if (!docUnchanged) message = 'Attention : montants ou statut modifiés après la signature.';
  else message = `Signature client valide${inv.signed_at ? ' · ' + inv.signed_at : ''}.`;
  return {
    present: true,
    imageOk,
    digestOk,
    docUnchanged,
    signedAt: inv.signed_at || null,
    message,
  };
}

/** Ensure invoice_items promo columns exist */
async function ensureInvoiceItemPromoColumns(db: D1Database) {
  await schemaOnce('ensureInvoiceItemPromoColumns', async () => {
  await addColumnIfMissing(db, 'invoice_items', 'list_price', `REAL DEFAULT 0`);
  await addColumnIfMissing(db, 'invoice_items', 'discount_amount', `REAL DEFAULT 0`);
  await addColumnIfMissing(db, 'invoice_items', 'discount_percent', `REAL DEFAULT 0`);

  });
}

/* client schema helpers → lib/clients-schema.ts */



/** Invoice-level tax exempt */
async function ensureInvoiceTaxExempt(db: D1Database) {
  await schemaOnce('ensureInvoiceTaxExempt', async () => {
  await addColumnIfMissing(db, 'invoices', 'tax_exempt', `INTEGER DEFAULT 0`);

  });
}

/** Remboursement / avoir (WR-) columns */
async function ensureInvoiceRefundColumns(db: D1Database) {
  await schemaOnce('invoice_refund_cols', async () => {
    await addColumnIfMissing(db, 'invoices', 'doc_kind', "TEXT DEFAULT 'invoice'");
    await addColumnIfMissing(db, 'invoices', 'refund_of_invoice_id', 'INTEGER');
    await addColumnIfMissing(db, 'invoices', 'refund_reason', "TEXT DEFAULT ''");
    await addColumnIfMissing(db, 'invoices', 'refund_reason_code', "TEXT DEFAULT ''");
    await addColumnIfMissing(db, 'company_settings', 'next_credit_number', 'INTEGER DEFAULT 1');
    await addColumnIfMissing(db, 'company_settings', 'credit_prefix', "TEXT DEFAULT 'WR-'");
    await addColumnIfMissing(db, 'company_settings', 'quick_sale_prefix', "TEXT DEFAULT 'VR-'");
    await addColumnIfMissing(db, 'company_settings', 'next_quick_sale_number', 'INTEGER DEFAULT 1');
  });
}

const REFUND_REASON_CODES: Record<string, string> = {
  our_error: 'Erreur de notre part (erreur de commande / facturation)',
  defective_shipped: 'Article cassé ou défectueux à l’envoi — non causé par le client',
  wrong_item: 'Mauvais article / non conforme envoyé',
  missing_qty: 'Quantité manquante à la livraison',
  damaged_transit: 'Dommage constaté à la réception (transport)',
};

function validateRefundReason(code: string, detail: string): { ok: true; label: string; full: string } | { ok: false; error: string } {
  const c = String(code || '').trim();
  const d = String(detail || '').trim();
  if (!c || !REFUND_REASON_CODES[c]) {
    return {
      ok: false,
      error:
        'Un motif de remboursement valide est obligatoire. Choisissez : erreur de notre part, article défectueux envoyé, mauvais article, quantité manquante, ou dommage transport. Un remboursement sans explication valable n’est pas accepté.',
    };
  }
  if (d.length < 12) {
    return {
      ok: false,
      error:
        'Précisez le motif (min. 12 caractères). Un remboursement sans explication détaillée n’est pas accepté, quel que soit le cas.',
    };
  }
  // Reject lazy placeholders
  const low = d.toLowerCase();
  const bad = ['test', 'xxx', 'n/a', 'na', 'aucune', 'rien', 'ok', 'oui', 'non'];
  if (bad.includes(low) || low.length < 12) {
    return { ok: false, error: 'Explication trop vague. Décrivez clairement le problème (ex. article reçu cassé, erreur de référence…).' };
  }
  const label = REFUND_REASON_CODES[c];
  return { ok: true, label, full: `${label}. Détail : ${d}` };
}

/** Préfixe WR / avoir : 1–12 car. lettres, chiffres, - ou / */
function validateCreditPrefix(raw: unknown): { ok: true; value: string } | { ok: false; error: string; code: string } {
  const v = String(raw ?? '').trim();
  if (!v) {
    return { ok: false, error: 'Le préfixe des remboursements (WR) est obligatoire (ex. WR-).', code: 'WR_PREFIX_INVALID' };
  }
  if (v.length > 12 || !/^[A-Za-z0-9][A-Za-z0-9\-/]{0,11}$/.test(v)) {
    return {
      ok: false,
      error: 'Préfixe WR invalide. Utilisez 1 à 12 caractères (lettres, chiffres, tiret ou slash), ex. WR- ou AVOIR-.',
      code: 'WR_PREFIX_INVALID',
    };
  }
  return { ok: true, value: v };
}

function validateNextCreditNumber(raw: unknown): { ok: true; value: number } | { ok: false; error: string; code: string } {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1 || n > 999999999 || Math.floor(n) !== n) {
    return {
      ok: false,
      error: 'Le prochain numéro WR doit être un entier ≥ 1.',
      code: 'WR_NUMBER_INVALID',
    };
  }
  return { ok: true, value: n };
}

/**
 * Product bulk discount tiers stored as JSON text:
 * [{"min_qty":10,"percent":5},{"min_qty":50,"percent":10}]
 * Highest matching min_qty wins.
 */
async function ensureProductBulkDiscounts(db: D1Database) {
  try {
    await schemaOnce('ensureProductBulkDiscounts', async () => {
      await addColumnIfMissing(db, 'products', 'bulk_discounts', `TEXT DEFAULT '[]'`);
    });
  } catch (e) {
    // Never 500 a product save because of an optional column migration.
    console.error('ensureProductBulkDiscounts_err', String((e as any)?.message || e).slice(0, 300));
  }
}

/** Lowercased column names of a table, or null when PRAGMA is unavailable. */
async function tableColumns(db: D1Database, table: string): Promise<Set<string> | null> {
  try {
    const info = await db.prepare(`PRAGMA table_info(${table})`).all();
    return new Set(((info?.results || []) as { name?: string }[]).map((r) => String(r.name || '').toLowerCase()));
  } catch {
    return null;
  }
}

/** True when the column exists (or PRAGMA unavailable — assume yes). */
async function hasColumn(db: D1Database, table: string, column: string): Promise<boolean> {
  try {
    const info = await db.prepare(`PRAGMA table_info(${table})`).all();
    return ((info?.results || []) as { name?: string }[]).some((r) => String(r.name || '').toLowerCase() === column.toLowerCase());
  } catch {
    return true;
  }
}

function parseBulkDiscounts(raw: any): { min_qty: number; percent: number }[] {
  if (!raw) return [];
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(arr)) return [];
    return arr
      .map((x: any) => ({ min_qty: Number(x.min_qty || 0), percent: Number(x.percent || 0) }))
      .filter((x) => x.min_qty > 0 && x.percent > 0 && x.percent <= 100)
      .sort((a, b) => b.min_qty - a.min_qty);
  } catch {
    return [];
  }
}

/** Apply bulk discount to list price given quantity; returns unit price after best tier */
function applyBulkDiscount(listPrice: number, qty: number, bulkRaw: any): { unit_price: number; bulk_percent: number } {
  const tiers = parseBulkDiscounts(bulkRaw);
  const list = Number(listPrice || 0);
  if (list <= 0 || qty <= 0 || !tiers.length) return { unit_price: list, bulk_percent: 0 };
  for (const t of tiers) {
    if (qty >= t.min_qty) {
      const unit = Math.round(list * (1 - t.percent / 100) * 100) / 100;
      return { unit_price: unit, bulk_percent: t.percent };
    }
  }
  return { unit_price: list, bulk_percent: 0 };
}

/**
 * ── Inventory audit log (stock_movements) ──────────────────────────────
 * Every REAL quantity change on tracked products writes one row:
 *   product_id, type, quantity (absolute), previous_quantity, new_quantity,
 *   reason, reference, created_by, created_at
 *
 * Zero-delta rule: if the signed quantity is 0 (or near-zero), nothing is
 * written and stock is not updated. Invoice edit uses NET deltas per product
 * so saving the same quantities (price/promo/notes only) leaves stock + audit
 * untouched.
 *
 * Types (normalized):
 *   sale | purchase | in | out | adjustment | restock | initial
 *
 * Writers:
 *   - product create (initial stock > 0) → initial
 *   - POST /api/products/:id/adjust-stock → body.type
 *   - invoice create → sale (per line product)
 *   - invoice edit → sale | restock only for products whose qty changed
 *   - invoice cancel / delete → restock (if not already cancelled / not quote)
 *   - quote→invoice convert → sale
 *   - bill create → purchase
 * Quotes never write movements.
 *
 * Readers:
 *   GET /api/products/:id/movements?limit=50 — last N for one product
 *   GET /api/stock/movements?product_id=&type=&q=&limit=&offset= — global audit
 * History is retained when a product is deleted (orphan rows allowed).
 */

async function ensureStockMovementsTable(db: D1Database) {
  await schemaOnce('ensureStockMovementsTable', async () => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER,
      type TEXT NOT NULL DEFAULT 'adjustment',
      quantity REAL NOT NULL DEFAULT 0,
      previous_quantity REAL NOT NULL DEFAULT 0,
      new_quantity REAL NOT NULL DEFAULT 0,
      reason TEXT DEFAULT '',
      reference TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
  await addColumnIfMissing(db, 'stock_movements', 'reference', `TEXT DEFAULT ''`);
  await addColumnIfMissing(db, 'stock_movements', 'created_by', `TEXT DEFAULT ''`);

  });
}

function normalizeMovementType(qtySigned: number, reason: string, explicit?: string): string {
  if (explicit) {
    const t = String(explicit).toLowerCase().trim();
    if (['sale', 'purchase', 'in', 'out', 'adjustment', 'restock', 'initial', 'refund_restock', 'refund_no_restock'].includes(t)) return t;
  }
  const r = (reason || '').toLowerCase();
  if (qtySigned < 0) {
    if (r.includes('sale') || r.includes('invoice') || r.includes('facture') || r.includes('qty up') || r.includes('line added')) return 'sale';
    return 'out';
  }
  if (r.includes('purchase') || r.includes('bill') || r.includes('achat')) return 'purchase';
  if (
    r.includes('restock') ||
    r.includes('rétabli') ||
    r.includes('retabli') ||
    r.includes('cancel') ||
    r.includes('annul') ||
    r.includes('deleted') ||
    r.includes('qty down') ||
    r.includes('line removed') ||
    r.includes('rembours') ||
    r.includes('retour stock')
  ) return 'restock';
  if (r.includes('initial') || r.includes('stock initial')) return 'initial';
  if (r.includes('réception') || r.includes('reception')) return 'in';
  return 'adjustment';
}

/**
 * Stock movement helper + audit writer.
 * qtySigned > 0 → stock in | qtySigned < 0 → stock out
 * Near-zero qtySigned → no-op (no product update, no audit row).
 * Quotes must never call this.
 */
/**
 * Moving Weighted Average Cost (MAC) — industry-standard for mixed purchase prices.
 * new_cost = (qty_on_hand * old_cost + qty_bought * buy_price) / (qty_on_hand + qty_bought)
 * If stock was empty, cost becomes the purchase price.
 * Also stores last_purchase_cost when column exists.
 */
async function ensureValuationTables(db: D1Database) {
  await schemaOnce('ensureValuationTables', async () => {
  await addColumnIfMissing(db, 'company_settings', 'inventory_valuation_method', `TEXT DEFAULT 'average'`);
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS stock_cost_layers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      quantity_remaining REAL NOT NULL,
      unit_cost REAL NOT NULL,
      source_ref TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auto_transfer_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      product_id INTEGER,
      from_location_id INTEGER NOT NULL,
      to_location_id INTEGER NOT NULL,
      trigger_type TEXT NOT NULL DEFAULT 'low_stock',
      threshold REAL NOT NULL DEFAULT 5,
      transfer_qty REAL NOT NULL DEFAULT 10,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();

  });
}

async function getValuationMethod(db: D1Database): Promise<'average' | 'fifo' | 'standard'> {
  await ensureValuationTables(db);
  const row = await db.prepare(`SELECT inventory_valuation_method FROM company_settings WHERE id = 1`).first() as any;
  const m = String(row?.inventory_valuation_method || 'average').toLowerCase();
  if (m === 'fifo' || m === 'standard') return m;
  return 'average';
}

async function pushFifoLayer(db: D1Database, productId: number | string, qty: number, unitCost: number, ref: string) {
  await ensureValuationTables(db);
  await db.prepare(
    `INSERT INTO stock_cost_layers (product_id, quantity_remaining, unit_cost, source_ref) VALUES (?, ?, ?, ?)`
  ).bind(productId, qty, unitCost, ref || '').run();
}

async function runAutoTransfers(
  db: D1Database,
  productIds: (number | string)[],
): Promise<{ transferred: number; details: string[] }> {
  await ensureValuationTables(db);
  await ensureStockLocations(db);
  const details: string[] = [];
  let transferred = 0;
  const { results: rules } = await db.prepare(
    `SELECT * FROM auto_transfer_rules WHERE is_active = 1 AND trigger_type = 'low_stock'`
  ).all();
  if (!(rules || []).length) return { transferred: 0, details: [] };

  for (const pid of productIds) {
    if (!pid) continue;
    for (const rule of (rules || []) as any[]) {
      if (rule.product_id && Number(rule.product_id) !== Number(pid)) continue;
      const toId = Number(rule.to_location_id);
      const fromId = Number(rule.from_location_id);
      if (!toId || !fromId || toId === fromId) continue;
      const toRow = await db.prepare(
        `SELECT quantity FROM stock_location_qty WHERE location_id = ? AND product_id = ?`
      ).bind(toId, pid).first() as any;
      const toQty = Number(toRow?.quantity || 0);
      const threshold = Number(rule.threshold || 0);
      if (toQty > threshold) continue;
      const fromRow = await db.prepare(
        `SELECT quantity FROM stock_location_qty WHERE location_id = ? AND product_id = ?`
      ).bind(fromId, pid).first() as any;
      const fromQty = Number(fromRow?.quantity || 0);
      let move = Number(rule.transfer_qty || 0);
      if (move <= 0) move = Math.max(1, threshold - toQty + 1);
      move = Math.min(move, fromQty);
      if (move <= 1e-9) continue;
      try {
        await adjustLocationStock(db, pid, fromId, -move);
        await adjustLocationStock(db, pid, toId, move);
        await applyStockDelta(db, pid, 0, `Transfert auto règle#${rule.id} ×${move}`, 'auto-transfer', {
          type: 'adjustment',
          skipLocation: true,
        });
        transferred += 1;
        details.push(`Produit ${pid}: ${move} de loc ${fromId} → ${toId}`);
      } catch (e) {
        console.error('auto transfer', e);
      }
    }
  }
  return { transferred, details };
}

async function applyMovingAverageCost(
  db: D1Database,
  productId: number | string,
  qtyBought: number,
  unitCost: number,
  ref = '',
): Promise<number | null> {
  const qty = Number(qtyBought);
  const price = Number(unitCost);
  if (!productId || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price < 0) return null;
  const method = await getValuationMethod(db);

  if (method === 'fifo') {
    await pushFifoLayer(db, productId, qty, price, ref);
    const { results } = await db.prepare(
      `SELECT quantity_remaining, unit_cost FROM stock_cost_layers WHERE product_id = ? AND quantity_remaining > 0`
    ).bind(productId).all();
    let q = 0, c = 0;
    for (const r of (results || []) as any[]) {
      q += Number(r.quantity_remaining || 0);
      c += Number(r.quantity_remaining || 0) * Number(r.unit_cost || 0);
    }
    const avg = q > 0 ? Math.round((c / q) * 10000) / 10000 : price;
    try {
      await db.prepare(`UPDATE products SET cost = ?, last_purchase_cost = ?, updated_at = datetime('now') WHERE id = ?`).bind(avg, price, productId).run();
    } catch {
      await db.prepare(`UPDATE products SET cost = ?, updated_at = datetime('now') WHERE id = ?`).bind(avg, productId).run();
    }
    return avg;
  }

  if (method === 'standard') {
    try {
      await db.prepare(`UPDATE products SET last_purchase_cost = ?, updated_at = datetime('now') WHERE id = ?`).bind(price, productId).run();
    } catch { /* */ }
    const pstd = await db.prepare(`SELECT cost FROM products WHERE id = ?`).bind(productId).first() as any;
    return Number(pstd?.cost || price);
  }

  const prod = await db.prepare(
    `SELECT stock_quantity, cost FROM products WHERE id = ?`
  ).bind(productId).first() as any;
  if (!prod) return null;
  // stock_quantity here is BEFORE this purchase is applied — caller order matters
  const onHand = Math.max(0, Number(prod.stock_quantity || 0));
  const oldCost = Number(prod.cost || 0);
  let newCost: number;
  if (onHand <= 1e-9) {
    newCost = price;
  } else {
    newCost = (onHand * oldCost + qty * price) / (onHand + qty);
  }
  // Round to 4 decimals for money hygiene
  newCost = Math.round(newCost * 10000) / 10000;
  try {
    await db.prepare(
      `UPDATE products SET cost = ?, last_purchase_cost = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(newCost, price, productId).run();
  } catch {
    await db.prepare(
      `UPDATE products SET cost = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(newCost, productId).run();
  }
  return newCost;
}

/**
 * Atomic stock mutation (Phase 0).
 * - Decrements use conditional UPDATE so concurrent sales cannot oversell.
 * - Insufficient stock → throws { code: 'INSUFFICIENT_STOCK' } unless allowNegative.
 * - qty 0 + explicit type (e.g. refund_no_restock) → audit movement only, no qty change.
 */
async function applyStockDelta(
  db: D1Database,
  productId: number | string | null | undefined,
  qtySigned: number,
  reason: string,
  reference: string,
  opts?: { createdBy?: string; approvedBy?: string;
    /** When set, may send FCM low-stock push */
    env?: any; type?: string; allowNegative?: boolean; locationId?: number | null; skipLocation?: boolean },
) {
  if (!productId) return null;
  const delta = Number(qtySigned);
  if (!Number.isFinite(delta)) return null;
  await ensureStockMovementsTable(db);
  if (opts?.approvedBy) await ensureMovementApprover(db);

  const prod = await db.prepare(
    `SELECT id, stock_quantity, track_inventory, name FROM products WHERE id = ?`
  ).bind(productId).first() as any;
  if (!prod) return null;
  if (!prod.track_inventory) return null;

  const prev = Number(prod.stock_quantity || 0);
  const type = normalizeMovementType(delta, reason, opts?.type);

  // Audit-only (no stock change) — e.g. WR hors stock
  if (Math.abs(delta) < 1e-9) {
    await db.prepare(
      `INSERT INTO stock_movements (product_id, type, quantity, previous_quantity, new_quantity, reason, reference, created_by)
       VALUES (?, ?, 0, ?, ?, ?, ?, ?)`
    ).bind(productId, type || 'adjustment', prev, prev, reason || '', reference || '', opts?.createdBy || '').run();
    return { previous_quantity: prev, new_quantity: prev, type: type || 'adjustment', audit_only: true };
  }

  if (delta < 0 && !opts?.allowNegative) {
    // Atomic: only succeed if enough stock at write time
    const need = Math.abs(delta);
    const res = await db.prepare(
      `UPDATE products
       SET stock_quantity = stock_quantity + ?, updated_at = datetime('now')
       WHERE id = ? AND track_inventory = 1 AND stock_quantity >= ?`
    ).bind(delta, productId, need).run();
    if (!res.meta?.changes) {
      const err: any = new Error(
        `Stock insuffisant pour « ${prod.name || productId} » (disponible : ${prev}, demandé : ${need}).`
      );
      err.code = 'INSUFFICIENT_STOCK';
      err.available = prev;
      err.requested = need;
      err.product_id = productId;
      throw err;
    }
  } else {
    // Restock / force negative / positive
    await db.prepare(
      `UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = datetime('now') WHERE id = ? AND track_inventory = 1`
    ).bind(delta, productId).run();
  }

  const after = await db.prepare(`SELECT stock_quantity FROM products WHERE id = ?`).bind(productId).first() as any;
  const newQty = Number(after?.stock_quantity ?? prev + delta);

  // Mirror onto warehouse placement (default / sales location) so reports show real places
  if (!opts?.skipLocation) {
    try {
      await ensureStockLocations(db);
      let locId = opts?.locationId ?? null;
      if (!locId) locId = await getDefaultLocationId(db);
      if (locId) {
        const cnt = await db.prepare(
          `SELECT COUNT(*) as c FROM stock_location_qty WHERE product_id = ?`
        ).bind(productId).first() as any;
        if (!Number(cnt?.c) && prev > 0) {
          // Seed previous global stock onto default before applying delta
          await db.prepare(
            `INSERT INTO stock_location_qty (location_id, product_id, quantity) VALUES (?, ?, ?)`
          ).bind(locId, productId, prev).run();
        }
        const row = await db.prepare(
          `SELECT quantity FROM stock_location_qty WHERE location_id = ? AND product_id = ?`
        ).bind(locId, productId).first() as any;
        const locPrev = Number(row?.quantity || 0);
        let locNext = locPrev + delta;
        if (!opts?.allowNegative && locNext < 0) locNext = 0;
        if (row) {
          await db.prepare(
            `UPDATE stock_location_qty SET quantity = ? WHERE location_id = ? AND product_id = ?`
          ).bind(locNext, locId, productId).run();
        } else {
          await db.prepare(
            `INSERT INTO stock_location_qty (location_id, product_id, quantity) VALUES (?, ?, ?)`
          ).bind(locId, productId, Math.max(0, locNext)).run();
        }
      }
    } catch (e) {
      console.error('location mirror', e);
    }
  }

  await db.prepare(
    `INSERT INTO stock_movements (product_id, type, quantity, previous_quantity, new_quantity, reason, reference, created_by${opts?.approvedBy ? ', approved_by' : ''})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?${opts?.approvedBy ? ', ?' : ''})`
  ).bind(
    productId,
    type,
    Math.abs(delta),
    prev,
    newQty,
    reason || '',
    reference || '',
    opts?.createdBy || '',
    ...(opts?.approvedBy ? [opts.approvedBy] : []),
  ).run();
  // Optional push when crossing into low / rupture
  try {
    const envAny = (opts as any)?.env;
    if (envAny && Number.isFinite(newQty)) {
      const prod = await db
        .prepare(
          `SELECT name, sku, low_stock_threshold, track_inventory FROM products WHERE id = ?`,
        )
        .bind(productId)
        .first() as any;
      if (prod && Number(prod.track_inventory) === 1) {
        const th = Number(prod.low_stock_threshold || 0);
        const wasOk = prev > th;
        const nowLow = newQty <= th;
        if (nowLow && (wasOk || newQty <= 0)) {
          await fcmNotifyLowStock(envAny, {
            id: productId,
            name: String(prod.name || ''),
            sku: String(prod.sku || ''),
            stock: newQty,
            threshold: th,
          });
        }
      }
    }
  } catch (e) {
    console.error('low_stock_notify', e);
  }
  return { previous_quantity: prev, new_quantity: newQty, type };
}


/** Delete expired / stale security rows from D1 (OTP, WebAuthn challenges, old login attempts, idempotency). */
async function purgeEphemeralSecurityData(db: D1Database): Promise<{
  otp: number;
  webauthn_challenges: number;
  login_attempts: number;
  idempotency: number;
}> {
  const out = { otp: 0, webauthn_challenges: 0, login_attempts: 0, idempotency: 0 };
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS otp_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL,
      resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
      expires_at TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(resource_type, resource_id)
    )`).run();
    const r1 = await db.prepare(
      `DELETE FROM otp_codes WHERE datetime(expires_at) < datetime('now')`
    ).run();
    out.otp = Number(r1.meta?.changes || 0);
  } catch (e) {
    console.log('purge otp', e);
  }
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS webauthn_challenges (
      id TEXT PRIMARY KEY, challenge TEXT NOT NULL, fingerprint TEXT NOT NULL,
      purpose TEXT NOT NULL, expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`).run();
    const r2 = await db.prepare(
      `DELETE FROM webauthn_challenges WHERE datetime(expires_at) < datetime('now')`
    ).run();
    out.webauthn_challenges = Number(r2.meta?.changes || 0);
  } catch (e) {
    console.log('purge webauthn_challenges', e);
  }
  try {
    // Keep 14 days of login attempt history for rate-limit / reputation
    const r3 = await db.prepare(
      `DELETE FROM login_attempts WHERE datetime(created_at) < datetime('now', '-14 days')`
    ).run();
    out.login_attempts = Number(r3.meta?.changes || 0);
  } catch (e) {
    console.log('purge login_attempts', e);
  }
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY, route TEXT NOT NULL DEFAULT '',
      response_json TEXT NOT NULL DEFAULT '', status_code INTEGER DEFAULT 200,
      created_at TEXT DEFAULT (datetime('now'))
    )`).run();
    const r4 = await db.prepare(
      `DELETE FROM idempotency_keys WHERE datetime(created_at) < datetime('now', '-7 days')`
    ).run();
    out.idempotency = Number(r4.meta?.changes || 0);
  } catch (e) {
    console.log('purge idempotency', e);
  }
  return out;
}

/** Idempotency store — prevents double-post on retry (payment, WR, invoice). */
async function ensureIdempotencyTable(db: D1Database) {
  await schemaOnce('ensureIdempotencyTable', async () => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      route TEXT NOT NULL DEFAULT '',
      response_json TEXT NOT NULL DEFAULT '',
      status_code INTEGER DEFAULT 200,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();

  });
}

function extractIdempotencyKey(c: any, body: any): string {
  const h = c.req.header('Idempotency-Key') || c.req.header('idempotency-key') || '';
  const b = body?.idempotency_key || body?.idempotencyKey || '';
  return String(h || b || '').trim().slice(0, 128);
}

async function idempotencyGet(db: D1Database, key: string): Promise<{ status: number; body: any } | null> {
  if (!key) return null;
  await ensureIdempotencyTable(db);
  const row = await db.prepare(`SELECT response_json, status_code FROM idempotency_keys WHERE key = ?`).bind(key).first() as any;
  if (!row) return null;
  try {
    return { status: Number(row.status_code || 200), body: JSON.parse(row.response_json || '{}') };
  } catch {
    return null;
  }
}

async function idempotencyPut(db: D1Database, key: string, route: string, status: number, body: any) {
  if (!key) return;
  await ensureIdempotencyTable(db);
  try {
    await db.prepare(
      `INSERT OR REPLACE INTO idempotency_keys (key, route, response_json, status_code, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    ).bind(key, route, JSON.stringify(body).slice(0, 100000), status).run();
  } catch (e) {
    console.error('idempotencyPut', e);
  }
}

/** Phase 1 — period lock (YYYY-MM). Mutations with issue_date <= locked month blocked. */
async function ensurePeriodLockColumn(db: D1Database) {
  await schemaOnce('ensurePeriodLockColumn', async () => {
  await addColumnIfMissing(db, 'company_settings', 'fiscal_locked_through', `TEXT DEFAULT ''`);

  });
}

async function assertPeriodOpen(
  db: D1Database,
  issueDate?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensurePeriodLockColumn(db);
  const row = await db.prepare(`SELECT fiscal_locked_through FROM company_settings WHERE id = 1`).first() as any;
  const locked = String(row?.fiscal_locked_through || '').trim(); // YYYY-MM
  if (!locked) return { ok: true };
  const d = String(issueDate || new Date().toISOString().slice(0, 10)).slice(0, 7);
  if (d && d <= locked) {
    return {
      ok: false,
      error: `Période clôturée jusqu’à ${locked}. Impossible de créer ou modifier un document daté ${d}. Rouvrez la période (owner) si nécessaire.`,
    };
  }
  return { ok: true };
}

/** Formal void: cancel keeps number forever; void_reason required for audit (CGI no gaps). */
async function ensureVoidColumns(db: D1Database) {
  await schemaOnce('ensureVoidColumns', async () => {
  await addColumnIfMissing(db, 'invoices', 'void_reason', `TEXT DEFAULT ''`);
  await addColumnIfMissing(db, 'invoices', 'voided_at', `TEXT`);
  await addColumnIfMissing(db, 'invoices', 'voided_by', `TEXT DEFAULT ''`);

  });
}

/**
 * ── Duplicate handling API (products) ──────────────────────────────────
 *
 * Endpoints:
 *   POST /api/products          — create
 *   PUT  /api/products/:id      — update
 *
 * Collision fields checked (any one match is enough):
 *   | field   | match rule                         | when empty |
 *   |---------|------------------------------------|------------|
 *   | sku     | case-insensitive exact             | skipped    |
 *   | barcode | exact string match                 | skipped    |
 *   | name    | case-insensitive exact             | always checked (name required) |
 *
 * PUT excludes the row being edited (`id != :id`).
 *
 * On conflict → HTTP 409 Conflict:
 * {
 *   "success": false,
 *   "code": "DUPLICATE_PRODUCT",
 *   "force_required": true,
 *   "error": "Produit en doublon (SKU) : « … » (id N). Passez force_duplicate=true …",
 *   "hint": "Envoyez force_duplicate=true pour forcer, ou mettez à jour le produit existant…",
 *   "duplicate": { "id": N, "name": "…", "sku": "…", "barcode": "…" },  // first match
 *   "matches": [
 *     { "on": "SKU"|"code-barres"|"nom", "id": N, "name": "…", "sku": "…", "barcode": "…" },
 *     …
 *   ]
 * }
 *
 * Override:
 *   body.force_duplicate = true  → create/update proceeds despite collisions.
 *
 * Client UI should:
 *   1. Show matches list (which field collided, with existing id/name).
 *   2. Offer “Open existing” (navigate to product id) or “Force create”.
 *   3. On force, resubmit same payload with force_duplicate: true.
 *
 * Related (clients import — separate flow):
 *   POST /api/clients/import/preview → soft matches on ICE / email / name
 *   with suggested action skip | create | update.
 */

/**
 * Morocco-compliant sequential numbering (art. 145 CGI).
 * Styles (numbering_style setting):
 *   - prefix_pad5   → FA-00001 (legacy default)
 *   - year_seq      → 2026-0001
 *   - prefix_year   → FA-2026-0001  (recommended Morocco)
 *   - year_slash    → 2026/0001
 *   - prefix_year_slash → FA/2026/0001
 * Each document type (invoice, quote, bill, receipt) has its own prefix + counter.
 */

/** 10-year style archive: immutable JSON snapshot of invoice on R2 (best-effort). */
async function archiveInvoiceSnapshot(env: Env, inv: any, items: any[]): Promise<void> {
  try {
    if (!env.IMAGES || !inv?.number) return;
    const key = `archives/invoices/${String(inv.number).replace(/[^a-zA-Z0-9._-]+/g, '_')}.json`;
    const body = JSON.stringify({
      archived_at: new Date().toISOString(),
      retention_years: 10,
      invoice: inv,
      items: items || [],
    });
    await env.IMAGES.put(key, body, {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {
        type: 'invoice_archive',
        number: String(inv.number),
        retention: '10y',
      },
    });
  } catch (e) {
    console.log('archiveInvoiceSnapshot', e);
  }
}

async function ensureClientPricesTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS client_product_prices (
      client_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (client_id, product_id)
    )
  `).run();
}

/* nextDocumentNumber → worker/lib/numbering.ts */
/** Nullable attribution: legacy rows and workflows without approval remain unknown. */
async function ensureDocumentActors(db: D1Database, table: 'invoices' | 'bills' | 'receipts') {
  await addColumnIfMissing(db, table, 'created_by', 'TEXT DEFAULT NULL');
  await addColumnIfMissing(db, table, 'approved_by', 'TEXT DEFAULT NULL');
}

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
  },
): string {
  const isLogin = purpose === 'login';
  const tag = isLogin ? 'VÉRIFICATION DE CONNEXION' : 'VÉRIFICATION DU COMPTE';
  const h1 = isLogin
    ? 'Confirmez cette connexion pour sécuriser votre'
    : 'Confirmez votre e-mail pour sécuriser votre';
  const intro = isLogin
    ? 'Une nouvelle connexion vient d’être demandée sur votre compte. Confirmez-la en tapant le code ci-dessous, ou en un seul tap sur le bouton.'
    : `Une opération sensible concernant ${resourceLabel} nécessite votre confirmation. Utilisez le code ci-dessous depuis l’application.`;
  const ORANGE = '#c45c26'; /* terracotta Atlas */
  const SALMON = '#d4a017'; /* saffron Atlas */
  // v0.7.2 — le mail suit le thème du serveur : palette zinc sombre de l'app.
  const CANVAS = '#09090b'; /* zinc-950 */
  const CARD = '#18181b'; /* zinc-900 */
  const LINE = '#27272a'; /* zinc-800 */
  const INK = '#fafafa'; /* zinc-50 */
  const VAL = '#e4e4e7'; /* zinc-200 */
  const GREY = '#a1a1aa'; /* zinc-400 */
  const FAINT = '#71717a'; /* zinc-500 */
  const rows = [
    meta?.username ? ['Compte', meta.username] : null,
    meta?.ip ? ['Adresse IP', meta.ip] : null,
    meta?.ua ? ['Appareil', meta.ua.slice(0, 120)] : null,
    meta?.fingerprint ? ['Empreinte', meta.fingerprint.slice(0, 24)] : null,
  ].filter(Boolean) as [string, string][];
  // v0.7.2 — tableau role=presentation : les clients mail (Gmail…) cassent
  // display:flex et collaient libellé + valeur (« Compteadmin »).
  const deviceBlock = rows.length
    ? `<div style="margin:26px 0 0;background:${CARD};border:1px solid ${LINE};border-radius:12px;padding:10px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:5px 14px 5px 0;font-size:12px;color:${GREY};white-space:nowrap;vertical-align:top">${k}</td><td style="padding:5px 0;font-size:12px;font-weight:600;color:${VAL};text-align:right;word-break:break-word">${v}</td></tr>`,
        )
        .join('')}</table></div>`
    : '';
  const button = meta?.verifyUrl
    ? `<a href="${meta.verifyUrl}" style="display:block;width:100%;box-sizing:border-box;background:${ORANGE};border-radius:10px;padding:18px 12px;text-align:center;color:#ffffff;font-size:15px;font-weight:800;letter-spacing:1.5px;text-decoration:none;text-transform:uppercase">Vérifier &amp; continuer</a>`
    : '';
  const social = (href: string, d: string) =>
    `<a href="${href}" style="display:inline-block;margin-left:14px;text-decoration:none"><svg width="17" height="17" viewBox="0 0 24 24" fill="#6b7280" xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg></a>`;
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${tag}</title></head>
<body style="margin:0;padding:0;background:${CANVAS};font-family:-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:${INK}">
  <div style="display:none;max-height:0;overflow:hidden">Votre code : ${otp}</div>
  <div style="max-width:600px;margin:0 auto;padding:38px 22px 30px;text-align:center">
    <img src="https://stock.afmarbre.com/atlas-logo-dark.png" alt="Atlas" width="173" height="56" style="display:block;height:42px;width:auto;max-width:100%;margin:0 auto" />
    <div style="height:34px"></div>
    <div style="font-size:12px;font-weight:800;letter-spacing:2px;color:${SALMON};text-transform:uppercase">${tag}</div>
    <h1 style="margin:14px 0 0;font-size:33px;line-height:1.18;font-weight:800;color:${INK}">${h1} <em style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-weight:600;color:${SALMON}">compte</em></h1>
    <p style="margin:18px auto 0;max-width:420px;font-size:15px;line-height:1.7;color:${GREY}">${intro}</p>
    <div style="margin:30px 0 0;background:${CARD};border:1px solid ${LINE};border-radius:12px;padding:30px 16px">
      <div style="font-size:34px;font-weight:800;letter-spacing:3px;color:${VAL}">${otp}</div>
    </div>
    <div style="margin:22px 0 0">${button}</div>
    ${deviceBlock}
    <p style="margin:28px auto 0;max-width:380px;font-size:14px;line-height:1.65;color:${GREY}">Vous n’êtes pas à l’origine de cette demande ? Ignorez simplement ce message.</p>
    <p style="margin:10px auto 0;max-width:420px;font-size:12px;line-height:1.6;color:${FAINT}">Code à usage unique, valable 10 minutes. Ne le partagez jamais, y compris avec un membre de votre équipe. · ${companyName}</p>
  </div>
  <div style="background:#0b0b0d;padding:34px 22px 30px;text-align:center">
    <div style="max-width:600px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
        <div style="display:flex;align-items:center;gap:9px;font-size:19px;font-weight:800;color:#9aa2b1"><span style="font-size:22px">🏬</span>Atlas</div>
        <div style="white-space:nowrap">${social('https://www.facebook.com/', 'M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.4h-1.2c-1.2 0-1.6.8-1.6 1.6V12h2.7l-.4 2.9h-2.3v7A10 10 0 0 0 22 12Z')}
${social('https://x.com/', 'M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.4L6.4 22H3.3l7.3-8.3L1 2h6.4l4.4 5.9L18.9 2Zm-1.1 18h1.7L7.7 3.9H5.9L17.8 20Z')}
${social('https://www.linkedin.com/', 'M20.4 20.4h-3.6v-5.6c0-1.3 0-3-1.9-3s-2.1 1.4-2.1 2.9v5.7H9.4V9h3.4v1.6h.1c.5-.9 1.6-1.9 3.4-1.9 3.6 0 4.3 2.4 4.3 5.5v6.2ZM5.3 7.4a2.1 2.1 0 1 1 0-4.2 2.1 2.1 0 0 1 0 4.2Zm1.8 13H3.5V9h3.6v11.4Z')}
${social('https://www.youtube.com/', 'M23 12s0-3.9-.5-5.7c-.3-1-1.1-1.8-2.1-2.1C18.6 3.7 12 3.7 12 3.7s-6.6 0-8.4.5c-1 .3-1.8 1.1-2.1 2.1C1 8.1 1 12 1 12s0 3.9.5 5.7c.3 1 1.1 1.8 2.1 2.1 1.8.5 8.4.5 8.4.5s6.6 0 8.4-.5c1-.3 1.8-1.1 2.1-2.1.5-1.8.5-5.7.5-5.7ZM9.8 15.5v-7l6 3.5-6 3.5Z')}
${social('https://www.instagram.com/', 'M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.9.2 2.3.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1.1.4 2.3.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.2 1.9-.4 2.3-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1.1.4-2.3.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.9-.2-2.3-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1.1-.4-2.3-.1-1.3-.1-1.7-.1-4.9s0-3.6.1-4.9c.1-1.2.2-1.9.4-2.3.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1.1-.4 2.3-.4 1.3-.1 1.7-.1 4.9-.1Zm0 3.8a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm0 9.9a3.9 3.9 0 1 1 0-7.8 3.9 3.9 0 0 1 0 7.8Zm6.2-10.1a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0Z')}</div>
      </div>
      <div style="margin-top:26px;font-size:13px;color:#9aa2b1">
        <a href="https://stock.afmarbre.com/" style="color:#9aa2b1;text-decoration:underline">Notre blog</a>
        <span style="margin:0 8px;color:#3a3f4a">|</span>
        <a href="https://stock.afmarbre.com/" style="color:#9aa2b1;text-decoration:underline">À propos</a>
        <span style="margin:0 8px;color:#3a3f4a">|</span>
        <a href="https://stock.afmarbre.com/" style="color:#9aa2b1;text-decoration:underline">Contact</a>
        <span style="margin:0 8px;color:#3a3f4a">|</span>
        <a href="https://stock.afmarbre.com/" style="color:#9aa2b1;text-decoration:underline">Centre d’aide</a>
      </div>
      <div style="margin-top:14px;font-size:12px;line-height:1.6;color:#7c8494">Atlas — stock.afmarbre.com<br/>© ${new Date().getUTCFullYear()} Etherealmber · MIT ou Apache-2.0</div>
      <div style="margin-top:10px"><a href="https://stock.afmarbre.com/settings" style="font-size:12px;color:#9aa2b1;text-decoration:underline">Se désabonner</a></div>
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
  opts?: { toEmail?: string },
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

  const sendPromise = sendOtpMail(env, {
    to: toAddr,
    from: fromAddr,
    subject: emailSubject,
    html: otpEmailHTML(otp, resourceLabel, companyName),
    text: `Code de confirmation pour ${resourceLabel} : ${otp}. Valable 10 minutes.`,
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
  await ensureExpenseTypeColumn(c.env.DB);
  const { results } = await c.env.DB.prepare(`SELECT * FROM expenses ORDER BY expense_date DESC, created_at DESC`).all();
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
      INSERT INTO catalog_settings (id, site_title, site_tagline, show_prices, show_stock)
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

app.get('/api/expenses/:id/links', async (c) => {
  const id = c.req.param('id');
  const expense = await c.env.DB.prepare(`SELECT * FROM expenses WHERE id = ?`).bind(id).first() as any;
  if (!expense) return c.json({ success: false, error: 'Écriture introuvable' }, 404);
  const notes = String(expense.notes || '');
  const m = notes.match(/invoice_id:(\d+)/);
  let invoice = null;
  let receipts: any[] = [];
  if (m) {
    invoice = await c.env.DB.prepare(`SELECT id, number, status FROM invoices WHERE id = ?`).bind(m[1]).first();
    const { results } = await c.env.DB.prepare(`SELECT id, number FROM receipts WHERE invoice_id = ?`).bind(m[1]).all();
    receipts = results || [];
  }
  const rm = notes.match(/receipt:(\d+)/);
  if (rm && !receipts.length) {
    const r = await c.env.DB.prepare(`SELECT id, number FROM receipts WHERE id = ?`).bind(rm[1]).first();
    if (r) receipts = [r];
  }
  return c.json({
    success: true,
    data: {
      expense: { id: expense.id, description: expense.description, amount: expense.amount },
      invoice,
      receipts,
      disclaimer: (invoice || receipts.length)
        ? 'Cette écriture est liée à une facture/reçu. La supprimer n\'efface pas la facture ni le reçu (solde seulement).'
        : null,
    },
  });
});

app.delete('/api/expenses/:id', async (c) => {
  try {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
    if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);

    const expense = await c.env.DB.prepare(`SELECT * FROM expenses WHERE id = ?`).bind(id).first() as any;
    if (!expense) return c.json({ success: false, error: 'Écriture introuvable' }, 404);

    // Optional cascade: if body.cascade_linked and linked invoice requested
    if (body.cascade_linked) {
      const notes = String(expense.notes || '');
      const m = notes.match(/invoice_id:(\d+)/);
      if (m) {
        try {
          await cascadeDeleteInvoice(c.env.DB, m[1]);
        } catch (cascadeErr) {
          console.error('cascadeDeleteInvoice failed', cascadeErr);
          // Still remove the expense entry even if cascade partially fails
          await c.env.DB.prepare(`DELETE FROM expenses WHERE id = ?`).bind(id).run();
          return c.json({
            success: true,
            message: 'Écriture solde supprimée. La cascade facture a rencontré une erreur partielle.',
          });
        }
        return c.json({
          success: true,
          message: 'Écriture, facture liée, reçus et paiements supprimés.',
        });
      }
    }

    await c.env.DB.prepare(`DELETE FROM expenses WHERE id = ?`).bind(id).run();
    await afterBusinessMutation(c.env.CACHE);
    return c.json({ success: true, message: 'Écriture solde supprimée. Le solde a été recalculé.' });
  } catch (err: any) {
    console.error('DELETE /api/expenses/:id', err);
    return c.json({
      success: false,
      error: err?.message || 'Impossible de supprimer l\'écriture de solde.',
      code: 'DELETE_FAILED',
      detail: String(err?.message || err),
    }, 400);
  }
});

/** Ledger reconciliation: match invoice payments vs solde entries */
app.get('/api/ledger/reconcile', async (c) => {
  await ensurePaymentHistoryTable(c.env.DB);
  await ensureExpenseTypeColumn(c.env.DB);
  await ensureReceiptsTable(c.env.DB);

  const { results: payments } = await c.env.DB.prepare(
    `SELECT p.*, i.number AS invoice_number, i.client_name
     FROM invoice_payments p
     LEFT JOIN invoices i ON i.id = p.invoice_id
     ORDER BY p.paid_at DESC, p.id DESC`
  ).all();

  const { results: ledger } = await c.env.DB.prepare(
    `SELECT * FROM expenses WHERE entry_type = 'income' AND (notes LIKE '%invoice_id:%' OR category = 'Encaissement client')
     ORDER BY expense_date DESC, id DESC`
  ).all();

  const { results: receipts } = await c.env.DB.prepare(`SELECT * FROM receipts ORDER BY id DESC`).all();

  const unmatchedPayments: any[] = [];
  for (const p of (payments || [])) {
    const found = (ledger || []).find((e: any) =>
      String(e.notes || '').includes(`invoice_id:${p.invoice_id}`) &&
      Math.abs(Number(e.amount) - Number(p.amount)) < 0.02
    );
    if (!found) unmatchedPayments.push(p);
  }

  const orphanLedger: any[] = [];
  for (const e of (ledger || [])) {
    const m = String(e.notes || '').match(/invoice_id:(\d+)/);
    if (m) {
      const inv = await c.env.DB.prepare(`SELECT id FROM invoices WHERE id = ?`).bind(m[1]).first();
      if (!inv) orphanLedger.push(e);
    }
  }

  // Paid invoices without receipt
  const { results: paidNoReceipt } = await c.env.DB.prepare(
    `SELECT i.id, i.number, i.client_name, i.total, i.amount_paid
     FROM invoices i
     WHERE i.status = 'paid'
       AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.invoice_id = i.id)`
  ).all();

  return c.json({
    success: true,
    data: {
      payments_count: (payments || []).length,
      ledger_income_count: (ledger || []).length,
      receipts_count: (receipts || []).length,
      unmatched_payments: unmatchedPayments,
      orphan_ledger: orphanLedger,
      paid_without_receipt: paidNoReceipt || [],
      summary: {
        ok: unmatchedPayments.length === 0 && orphanLedger.length === 0,
        message: unmatchedPayments.length || orphanLedger.length || (paidNoReceipt || []).length
          ? 'Des écarts de rapprochement ont été détectés.'
          : 'Solde et paiements sont cohérents.',
      },
    },
  });
});

/** Create missing receipts for paid invoices */
app.post('/api/ledger/fix-receipts', async (c) => {
  await ensureReceiptsTable(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
  if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);

  const { results: paidNoReceipt } = await c.env.DB.prepare(
    `SELECT i.* FROM invoices i
     WHERE i.status = 'paid'
       AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.invoice_id = i.id)`
  ).all();

  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  let created = 0;
  for (const inv of (paidNoReceipt || []) as any[]) {
    const prefix = settings?.receipt_prefix || 'RCP-';
    const nextNum = settings?.next_receipt_number || 1;
    const number = `${prefix}${String(nextNum).padStart(5, '0')}`;
    await c.env.DB.prepare(
      `INSERT INTO receipts (number, invoice_id, client_name, amount, payment_method, issue_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(number, inv.id, inv.client_name, inv.total, 'cash', inv.issue_date || new Date().toISOString().slice(0, 10), 'Reçu généré (rapprochement)').run();
    await c.env.DB.prepare(
      `UPDATE company_settings SET next_receipt_number = COALESCE(next_receipt_number, 1) + 1 WHERE id = 1`
    ).run();
    created++;
  }
  return c.json({ success: true, message: `${created} reçu(s) créé(s) pour factures payées sans reçu.`, count: created });
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

/* ────────────────────────────────────────────────────────────────────────────
 * App update management (owner/admin only) — Cloudflare R2 `IMAGES` bucket:
 *   app-updates/android/latest.json  (manifest read by the APK update check)
 *   app-updates/android/latest.apk   (binary served via the CDN custom domain)
 * The public read-only check above stays untouched; these routes only write.
 * ────────────────────────────────────────────────────────────────────────── */
// App-update admin routes registered via worker/routes/reportsAndUpdates.ts
/* ────────────────────────────────────────────────────────────────────────────
 * Product creation requests — scan page: unknown barcode → phone user sends a
 * request (code + optional photo/name, NO price); a PC user (admin/owner) or
 * stock role creates the product later with the price.
 * ────────────────────────────────────────────────────────────────────────── */
async function ensureProductRequestsTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS product_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        photo_url TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        closed_at TEXT,
        product_id INTEGER
      )`,
    )
    .run();
  await db
    .prepare(`CREATE INDEX IF NOT EXISTS idx_product_requests_status ON product_requests(status, id DESC)`)
    .run();
  // v1.4.5 — scan requests carry the full minimal product sheet
  await addColumnIfMissing(db, 'product_requests', 'sku', `TEXT NOT NULL DEFAULT ''`);
  await addColumnIfMissing(db, 'product_requests', 'unit', `TEXT NOT NULL DEFAULT ''`);
  await addColumnIfMissing(db, 'product_requests', 'quantity', `REAL NOT NULL DEFAULT 0`);
  await addColumnIfMissing(db, 'product_requests', 'category', `TEXT NOT NULL DEFAULT ''`);
}

/** stock / admin / owner only (phone floor operators have the stock role). */
function gateStockRole(c: any): { ok: true; username: string } | { ok: false; status: number; error: string } {
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  if (!session.username) return { ok: false, status: 401, error: 'Non authentifié' };
  const role = normalizeRole(session.role || 'user');
  if (role !== 'owner' && role !== 'admin' && role !== 'stock') {
    return { ok: false, status: 403, error: 'Réservé aux rôles stock/admin/owner' };
  }
  return { ok: true, username: session.username };
}

/* v209-A (S7/M2): alert center — low stock, expired lots, overdue invoices, open requests */
app.get('/api/alerts', async (c) => {
  const gate = gateStockRole(c);
  if (!gate.ok) return c.json({ success: false, error: gate.error }, gate.status as any);
  const db = c.env.DB;
  await ensureProductRequestsTable(db);
  await db.prepare(`CREATE TABLE IF NOT EXISTS stock_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    lot TEXT NOT NULL DEFAULT '',
    expiry TEXT DEFAULT '',
    quantity REAL NOT NULL DEFAULT 0,
    warehouse_id INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  const alerts: any[] = [];
  const today = new Date().toISOString().slice(0, 10);
  try {
    const low = await db.prepare(`SELECT id, name, sku, stock_quantity, low_stock_threshold FROM products WHERE is_active = 1 AND track_inventory = 1 AND stock_quantity <= low_stock_threshold ORDER BY stock_quantity ASC LIMIT 20`).all();
    for (const p0 of (low as any).results || []) {
      alerts.push({ kind: Number(p0.stock_quantity) <= 0 ? 'rupture' : 'stock_bas', severity: Number(p0.stock_quantity) <= 0 ? 'high' : 'medium', label: `${p0.name} — ${Number(p0.stock_quantity) <= 0 ? 'rupture' : 'stock bas'} (${p0.stock_quantity})`, href: '/products', meta: { product_id: p0.id, sku: p0.sku } });
    }
    const lots = await db.prepare(`SELECT id, product_id, lot, expiry, quantity FROM stock_lots WHERE expiry != '' AND quantity > 0`).all();
    for (const l of (lots as any).results || []) {
      if (String(l.expiry) <= today) alerts.push({ kind: 'lot_expire', severity: 'high', label: `Lot ${l.lot || l.id} expiré (produit #${l.product_id})`, href: '/products', meta: l });
      else if (String(l.expiry) <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)) alerts.push({ kind: 'lot_bientot', severity: 'medium', label: `Lot ${l.lot || l.id} expire le ${l.expiry}`, href: '/products', meta: l });
    }
    const overdue = await db.prepare(`SELECT id, number, client_name, total, due_date FROM invoices WHERE COALESCE(doc_kind,'invoice') NOT IN ('quick_sale','ticket','remboursement') AND IFNULL(number,'') NOT LIKE 'VR-%' AND IFNULL(number,'') NOT LIKE 'WR-%' AND status != 'paid' AND status != 'cancelled' AND due_date != '' AND due_date < ? ORDER BY due_date ASC LIMIT 20`).bind(today).all();
    for (const inv of (overdue as any).results || []) {
      alerts.push({ kind: 'facture_echue', severity: 'medium', label: `${inv.number} — ${inv.client_name} échue le ${inv.due_date} (${inv.total} MAD)`, href: `/invoices/${inv.id}`, meta: inv });
    }
    const reqs = await db.prepare(`SELECT id, code, name, quantity FROM product_requests WHERE status = 'open' ORDER BY id DESC LIMIT 10`).all();
    for (const r of (reqs as any).results || []) {
      alerts.push({ kind: 'demande_produit', severity: 'low', label: `Demande scan : ${r.name} (x${r.quantity})`, href: '/products', meta: r });
    }
  } catch { /* tables may be missing on fresh DBs */ }
  const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
  alerts.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
  return c.json({ success: true, data: alerts.slice(0, 40), meta: { count: alerts.length, today } });
});

app.get('/api/stock/product-requests', async (c) => {
  const gate = gateStockRole(c);
  if (!gate.ok) return c.json({ success: false, error: gate.error }, gate.status as any);
  const status = String(c.req.query('status') || 'open');
  await ensureProductRequestsTable(c.env.DB);
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM product_requests WHERE status = ? ORDER BY id DESC LIMIT 100`,
  ).bind(status).all();
  return c.json({ success: true, data: results || [] });
});

app.post('/api/stock/product-requests', async (c) => {
  const gate = gateStockRole(c);
  if (!gate.ok) return c.json({ success: false, error: gate.error }, gate.status as any);
  let body: any = {};
  try { body = await readProductImageJson(c); } catch (e) { return productImageFailure(c, e); }
  const code = String(body.code || '').trim().slice(0, 120);
  if (!code) return c.json({ success: false, error: 'Code obligatoire' }, 400);
  const name = String(body.name || '').trim().slice(0, 120);
  const note = String(body.note || '').trim().slice(0, 500);
  const sku = String(body.sku || '').trim().slice(0, 120);
  const unit = String(body.unit || '').trim().slice(0, 40);
  const quantity = Number(body.quantity);
  const category = String(body.category || '').trim().slice(0, 120);
  // Minimal required sheet: name + unit + quantity (price stays out of scan flow)
  if (!name) return c.json({ success: false, error: 'Nom obligatoire', code: 'NAME_REQUIRED' }, 400);
  if (!unit) return c.json({ success: false, error: 'Unité obligatoire', code: 'UNIT_REQUIRED' }, 400);
  if (!Number.isFinite(quantity) || quantity < 0) {
    return c.json({ success: false, error: 'Quantité obligatoire', code: 'QTY_REQUIRED' }, 400);
  }
  let photoUrl = '';
  const dataUrl = String(body.photo_data_url || '').trim();
  if (dataUrl) {
    try { photoUrl = (await normalizeProductImageReference(c.env, 0, dataUrl)).url; }
    catch (e) { return productImageFailure(c, e); }
  }
  await ensureProductRequestsTable(c.env.DB);
  const ins = await c.env.DB.prepare(
    `INSERT INTO product_requests (code, name, note, photo_url, created_by, sku, unit, quantity, category)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(code, name, note, photoUrl, gate.username, sku || code, unit, quantity, category).run();
  const row = await c.env.DB.prepare(`SELECT * FROM product_requests WHERE id = ?`).bind(ins.meta.last_row_id).first();
  return c.json({ success: true, data: row }, 201);
});

app.post('/api/stock/product-requests/:id/close', async (c) => {
  const gate = gateStockRole(c);
  if (!gate.ok) return c.json({ success: false, error: gate.error }, gate.status as any);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id < 1) return c.json({ success: false, error: 'ID invalide' }, 400);
  let body: any = {};
  try { body = await c.req.json(); } catch { body = {}; }
  const status = body.status === 'done' ? 'done' : 'dismissed';
  const productId = Number(body.product_id || 0) || null;
  await ensureProductRequestsTable(c.env.DB);
  await c.env.DB.prepare(
    `UPDATE product_requests SET status = ?, product_id = ?, closed_at = datetime('now') WHERE id = ?`,
  ).bind(status, productId, id).run();
  return c.json({ success: true, data: { id, status, product_id: productId } });
});

registerBackupRoutes(app, {
  requireOwner,
  hmacSha256Hex,
  writeAudit,
  purgeAgentConversationsOlderThan,
});

registerDataImportRoutes(app, { requireBizMutator, ensureExpenseTypeColumn });

// Report routes registered in Batch B (worker/routes/reports.ts)
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
  async scheduled(event: any, env: Env, ctx: ExecutionContext): Promise<void> {
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
  async email(message: any, env: Env, ctx: ExecutionContext): Promise<void> {
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
        return await app.fetch(request, env, ctx);
      } catch (err: any) {
        if (!url.pathname.startsWith('/api/reports/') && !url.pathname.startsWith(`${NATIVE_V2}/`)) console.error('api_fetch_fatal', String(err?.message || err));
        return new Response(
          JSON.stringify({
            success: false,
            error: url.pathname.startsWith('/api/reports/') ? 'Rapport indisponible' : url.pathname.startsWith(`${NATIVE_V2}/`) ? 'Connexion indisponible' : String(err?.message || 'Erreur interne').slice(0, 300),
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
