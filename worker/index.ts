import { Hono } from 'hono';
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
  productImageKey,
  companyAssetKey,
  keyFromCdnUrl,
  deleteR2Object,
  mimeToExt,
  publicImageUrl,
} from './lib/r2';
import {
  rateLimit,
  assertSafeOutboundUrl,
  isAllowedImageUrl,
  clientIpFromRequest,
  escapeHtml,
  safeImageSrc,
} from './lib/security';
import { canMutateBusiness, canHardDeleteStock, normalizeRole } from './lib/rbac';
import { apiFail, apiOk } from './lib/api-response';
import { toClientError, AppError } from './lib/errors';
import { repairProductSearchIndex, proactiveFtsHealth } from './lib/reliability';
import { androidReleaseRouter, serveAppUpdatesAsset } from './routes/androidRelease';
import { registerDeviceTokenRoutes } from './routes/deviceToken';
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
  buildNextActions,
  runAssistTool,
  auditAssist,
} from './lib/agent';
import { geminiSimpleChat, atlasAgentSystem, scrubVendorNames, normalizeResponseLanguage } from './lib/gemini-assist';
import { pickUiLang, tr } from './lib/error-i18n';
import { tokenraChat } from './lib/tokenra-assist';
import { groqChat, groqChatStream } from './lib/groq-assist';
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
} from './routes';
import { countEmployeesPayDue } from './routes/employees';
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

type QuickSnap = {
  pending: number;
  lowStock: number;
  lowNames: string[];
  unpaidMad: number;
  unpaidCount: number;
  openQuotes: number;
  salesTodayMad: number;
  salesTodayCount: number;
};

function quickAssistHint(message: string, snap: QuickSnap): string | null {
  const q = message
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  // Explicit "what can I do on X" only — never match generic chat / greetings
  if (/\b(que faire|quoi faire|que puis-je faire|aide[- ]?moi)\b/.test(q) && /\brapport/.test(q)) {
    return 'Sur Rapports: consultez CA, stock bas et clôture du jour, puis Copier le résumé ou Sauvegarde cloud.';
  }
  if (/\b(que faire|quoi faire|que puis-je faire|aide[- ]?moi)\b/.test(q) && /\b(produit|stock)\b/.test(q)) {
    return 'Sur Produits/Stock: cherchez un article, ajustez les quantités ou traitez les alertes stock bas.';
  }
  if (/\b(que faire|quoi faire|que puis-je faire|aide[- ]?moi)\b/.test(q) && /\b(facture|devis)\b/.test(q)) {
    return 'Sur Factures/Devis: créez un document, filtrez les impayés ou convertissez un devis.';
  }
  if (/\b(que faire|quoi faire|que puis-je faire|aide[- ]?moi)\b/.test(q) && /\b(tableau|accueil|dashboard)\b/.test(q)) {
    return 'Sur le tableau de bord: lisez les KPI du jour, le stock bas et les actions en attente.';
  }

  if (/que faire ensuite|next action|que faire\b/.test(q)) {
    const bits: string[] = [];
    if (snap.pending > 0) bits.push(`${snap.pending} action(s) en attente`);
    if (snap.lowStock > 0) bits.push(`${snap.lowStock} stock bas`);
    if (snap.unpaidCount > 0) bits.push(`${snap.unpaidCount} impayé(s)`);
    if (snap.openQuotes > 0) bits.push(`${snap.openQuotes} devis ouvert(s)`);
    if (!bits.length) return 'Rien d’urgent: ventes et stocks sont calmes pour l’instant.';
    return `Priorité: ${bits.slice(0, 3).join(', ')}.`;
  }

  if (/combien.*action|actions? en attente|pending/.test(q)) {
    const n = snap.pending;
    if (n === 0) return 'Aucune action en attente pour le moment.';
    if (n === 1) return 'Il y a 1 action en attente dans la boîte d’actions.';
    return `Il y a ${n} actions en attente dans la boîte d’actions.`;
  }

  if (/stock bas|rupture|reappro|alerte stock/.test(q)) {
    if (snap.lowStock <= 0) return 'Aucun article en stock bas pour le moment.';
    const names = snap.lowNames.slice(0, 3).join(', ');
    const extra = snap.lowStock > 3 ? ` (+${snap.lowStock - 3} autres)` : '';
    return names
      ? `${snap.lowStock} article(s) en stock bas: ${names}${extra}.`
      : `${snap.lowStock} article(s) en stock bas — ouvrez Produits.`;
  }

  if (/impay|credit client|cr[eé]ance|client.*doit|dette client|receivable/.test(q)) {
    if (snap.unpaidCount <= 0 || snap.unpaidMad <= 0) {
      return 'Aucun impayé client ouvert pour le moment.';
    }
    const mad = Math.round(snap.unpaidMad).toLocaleString('fr-MA');
    return `${snap.unpaidCount} facture(s) impayée(s) pour ${mad} MAD au total.`;
  }

  if (/devis|quote/.test(q) && !/ligne/.test(q)) {
    if (snap.openQuotes <= 0) return 'Aucun devis ouvert pour le moment.';
    if (snap.openQuotes === 1) return 'Il y a 1 devis ouvert.';
    return `Il y a ${snap.openQuotes} devis ouverts.`;
  }

  if (/vente.*(jour|aujourd)|ca du jour|chiffre.*jour|sales today/.test(q)) {
    const mad = Math.round(snap.salesTodayMad).toLocaleString('fr-MA');
    return `Ventes du jour: ${mad} MAD (${snap.salesTodayCount} pièce(s)).`;
  }

  if (/^vente\b|vendre|encaisser/.test(q) && !/jour|aujourd|ca /.test(q)) {
    return 'Utilisez Vente rapide ou créez une facture depuis Factures.';
  }

  if (/qui es[- ]tu|tu es qui|c.?est quoi atlas agent/.test(q)) {
    return 'Je suis Atlas Agent, l’assistant intégré d’Atlas Commerce (stock, facturation, Maroc). Je peux t’aider sur le métier ou répondre à des questions générales — dis-moi ce dont tu as besoin.';
  }

  return null;
}

async function loadQuickSnap(env: Env): Promise<QuickSnap> {
  const empty: QuickSnap = {
    pending: 0,
    lowStock: 0,
    lowNames: [],
    unpaidMad: 0,
    unpaidCount: 0,
    openQuotes: 0,
    salesTodayMad: 0,
    salesTodayCount: 0,
  };
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [pending, low, unpaid, quotes, sales] = await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(*) as n FROM mobile_actions WHERE status = 'pending'`,
      ).first() as Promise<any>,
      env.DB.prepare(
        `SELECT name, stock_quantity, low_stock_threshold FROM products
         WHERE COALESCE(is_active,1) = 1 AND COALESCE(track_inventory,1) = 1
           AND COALESCE(stock_quantity,0) <= COALESCE(low_stock_threshold, 5)
         ORDER BY stock_quantity ASC LIMIT 8`,
      ).all() as Promise<any>,
      env.DB.prepare(
        `SELECT COUNT(*) as n, COALESCE(SUM(total - COALESCE(amount_paid,0)),0) as mad
         FROM invoices WHERE status IN ('sent','partial','overdue')`,
      ).first() as Promise<any>,
      env.DB.prepare(
        `SELECT COUNT(*) as n FROM invoices WHERE status IN ('quote','devis')`,
      ).first() as Promise<any>,
      env.DB.prepare(
        `SELECT COUNT(*) as n, COALESCE(SUM(total),0) as mad FROM invoices
         WHERE status NOT IN ('quote','devis','cancelled','remboursement')
           AND date(issue_date) = date(?)`,
      ).bind(today).first() as Promise<any>,
    ]);
    const lowRows = (low?.results || []) as any[];
    return {
      pending: Number(pending?.n || 0),
      lowStock: lowRows.length
        ? Number(
            (
              await env.DB.prepare(
                `SELECT COUNT(*) as n FROM products
                 WHERE COALESCE(is_active,1) = 1 AND COALESCE(track_inventory,1) = 1
                   AND COALESCE(stock_quantity,0) <= COALESCE(low_stock_threshold, 5)`,
              ).first() as any
            )?.n || lowRows.length,
          )
        : 0,
      lowNames: lowRows.map((r) => String(r.name || '').slice(0, 40)).filter(Boolean),
      unpaidMad: Number(unpaid?.mad || 0),
      unpaidCount: Number(unpaid?.n || 0),
      openQuotes: Number(quotes?.n || 0),
      salesTodayMad: Number(sales?.mad || 0),
      salesTodayCount: Number(sales?.n || 0),
    };
  } catch {
    return empty;
  }
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
    console.error('turnstile_verify_failed', data?.['error-codes']);
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
app.use('/api/*', async (c, next) => {
  const cl = c.req.header('content-length');
  if (cl) {
    const n = Number(cl);
      const path = new URL(c.req.url).pathname;
      const limit = path === '/api/admin/app-update/apk'
        ? APP_UPDATE_MAX_APK_BYTES
        : MAX_BODY_BYTES;
    if (n > limit) {
      return c.json({
        success: false,
        error: 'Corps de requête trop volumineux (max 2 Mo).',
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
app.use('*', async (c, next) => {
  const rawDb: any = (c.env as any).DB;
  let session: any = null;
  if (rawDb && typeof rawDb.withSession === 'function') {
    const bm = readD1Bookmark(c);
    try {
      session = bm ? rawDb.withSession(bm) : rawDb.withSession('first-primary');
    } catch { session = null; }
    if (session) {
      (c.env as any).DB = session;
    }
  }
  await next();
  if (session && typeof session.getBookmark === 'function') {
    try {
      const nb = session.getBookmark();
      if (nb) {
        c.res.headers.append(
          'Set-Cookie',
          `${D1_BM_COOKIE}=${encodeURIComponent(nb)}; Path=/; Max-Age=600; SameSite=Lax; Secure`,
        );
      }
    } catch { /* */ }
  }
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
      if ((await dbPrimaryFlag(c.env)) === 'target') (c.env as any).DB = c.env.DB_TARGET;
    } catch { /* keep source */ }
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
app.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
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
    if (queryToken) {
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
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, ip, fp);
  if (reason !== 'ok') {
    return c.json({
      success: false,
      error: reason === 'ip_changed' ? 'Adresse IP modifiée — reconnexion requise' : reason === 'fp_changed' ? 'Appareil différent — reconnexion requise' : 'Non autorisé',
      code: reason === 'ip_changed' ? 'IP_CHANGED' : reason === 'fp_changed' ? 'DEVICE_CHANGED' : 'UNAUTHORIZED',
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
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
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
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com",
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
  // Real cause stays server-side (CF logs) — clients only get safe messages.
  try { console.error('[onError]', c.req.method, new URL(c.req.url).pathname, String((err as any)?.stack || err || '').slice(0, 500)); } catch { /* */ }
  const safe = toClientError(err);
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
registerWholesaleRoutes(app);
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
  verifyBackupAccess,
  sessionUserFromHeader,
});
registerEmployeeRoutes(app, { checkConfirmPassword });
/* v254 — role-safe finance, payroll & reminders (owner/admin gated, server-computed) */
registerFinanceRoutes(app, { sessionUserFromHeader, authFailReason, clientIp, writeAudit });
registerAtlasV209Routes(app, { sessionUserFromHeader, applyStockDelta, adjustLocationStock, getDefaultLocationId });
// Admin read routes need helpers defined later — registered near Users & Admin section

/* ═══ v225 — Atlas Agent governance: usage caps, injection lockout, privacy deletes, 2FA, devices ═══ */
const AGENT_DAILY_LIMIT = 40000;
const AGENT_WEEKLY_LIMIT = 200000;

async function ensureAgentControls(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS agent_controls (
    username TEXT PRIMARY KEY,
    blocked INTEGER NOT NULL DEFAULT 0,
    daily_tokens INTEGER NOT NULL DEFAULT 0,
    daily_date TEXT NOT NULL DEFAULT '',
    weekly_tokens INTEGER NOT NULL DEFAULT 0,
    weekly_start TEXT NOT NULL DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now'))
  )`).run();
}
function agentWeekStart(): string {
  const d = new Date();
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}
async function getAgentControlRow(db: D1Database, username: string) {
  await ensureAgentControls(db);
  const today = new Date().toISOString().slice(0, 10);
  const week = agentWeekStart();
  const existing = await db.prepare(`SELECT * FROM agent_controls WHERE username = ?`).bind(username).first() as any;
  if (!existing) {
    await db.prepare(`INSERT INTO agent_controls (username, blocked, daily_tokens, daily_date, weekly_tokens, weekly_start) VALUES (?, 0, 0, ?, 0, ?)`).bind(username, today, week).run();
    return { username, blocked: 0, daily_tokens: 0, daily_date: today, weekly_tokens: 0, weekly_start: week };
  }
  let { daily_tokens, daily_date, weekly_tokens, weekly_start } = existing;
  if (daily_date !== today) { daily_tokens = 0; daily_date = today; }
  if (weekly_start !== week) { weekly_tokens = 0; weekly_start = week; }
  if (daily_tokens !== existing.daily_tokens || weekly_tokens !== existing.weekly_tokens) {
    await db.prepare(`UPDATE agent_controls SET daily_tokens = ?, daily_date = ?, weekly_tokens = ?, weekly_start = ?, updated_at = datetime('now') WHERE username = ?`).bind(daily_tokens, daily_date, weekly_tokens, weekly_start, username).run();
  }
  return { ...existing, daily_tokens, daily_date, weekly_tokens, weekly_start };
}


/* ── v231: every quota event is journaled in D1 (survives counter resets) ── */
async function ensureAgentUsageLog(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS agent_usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'add',
    tokens INTEGER NOT NULL DEFAULT 0,
    daily_total INTEGER NOT NULL DEFAULT 0,
    weekly_total INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_agent_usage_log_user ON agent_usage_log (username, id)`).run();
}
async function logAgentUsage(db: D1Database, username: string, kind: string, tokens: number, dailyTotal: number, weeklyTotal: number) {
  try {
    await ensureAgentUsageLog(db);
    await db.prepare(`INSERT INTO agent_usage_log (username, kind, tokens, daily_total, weekly_total) VALUES (?, ?, ?, ?, ?)`).bind(username, kind, tokens, dailyTotal, weeklyTotal).run();
    await db.prepare(`DELETE FROM agent_usage_log WHERE username = ? AND id NOT IN (SELECT id FROM agent_usage_log WHERE username = ? ORDER BY id DESC LIMIT 500)`).bind(username, username).run();
  } catch (e) { console.error('[agent-usage-log] journal failed:', (e as any)?.message || e); }
}
function nextUtcMidnight(): string {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}
function nextMondayUtc(): string {
  const d = new Date();
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 7);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/* ── Agent quota counters live in a Durable Object (survives deploys/restarts) ── */
function agentQuotaStub(env: Env, username: string) {
  if (!env.AGENT_QUOTA_HUB) return null;
  const id = env.AGENT_QUOTA_HUB.idFromName('agent-quota:' + username);
  return env.AGENT_QUOTA_HUB.get(id);
}
async function agentQuotaCounters(env: Env, db: D1Database, username: string) {
  const stub = agentQuotaStub(env, username);
  if (!stub) {
    const row = await getAgentControlRow(db, username);
    return { dailyUsed: row.daily_tokens, weeklyUsed: row.weekly_tokens };
  }
  const res = await stub.fetch('http://atlas-quota/');
  const j = (await res.json()) as any;
  let { dailyUsed, weeklyUsed, initialized } = j.data || { dailyUsed: 0, weeklyUsed: 0, initialized: false };
  if (!initialized) {
    const row = await getAgentControlRow(db, username);
    const seed = await stub.fetch('http://atlas-quota/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daily: row.daily_tokens, dailyDate: row.daily_date, weekly: row.weekly_tokens, weeklyStart: row.weekly_start }),
    });
    const j2 = (await seed.json()) as any;
    dailyUsed = j2.data.dailyUsed; weeklyUsed = j2.data.weeklyUsed;
    await logAgentUsage(db, username, 'seed', 0, dailyUsed, weeklyUsed);
  }
  return { dailyUsed, weeklyUsed };
}
async function agentQuotaAdd(env: Env, db: D1Database, username: string, tokens: number) {
  const stub = agentQuotaStub(env, username);
  if (!stub) {
    const row = await getAgentControlRow(db, username);
    const daily = row.daily_tokens + tokens;
    const weekly = row.weekly_tokens + tokens;
    await db.prepare(`UPDATE agent_controls SET daily_tokens = ?, weekly_tokens = ?, updated_at = datetime('now') WHERE username = ?`).bind(daily, weekly, username).run();
    await logAgentUsage(db, username, 'add', tokens, daily, weekly);
    return { dailyUsed: daily, weeklyUsed: weekly };
  }
  const res = await stub.fetch('http://atlas-quota/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tokens }),
  });
  const j = (await res.json()) as any;
  await logAgentUsage(db, username, 'add', tokens, j.data.dailyUsed, j.data.weeklyUsed);
  // best-effort mirror into D1 for admin tooling
  try {
    await db.prepare(`UPDATE agent_controls SET daily_tokens = ?, weekly_tokens = ?, updated_at = datetime('now') WHERE username = ?`).bind(j.data.dailyUsed, j.data.weeklyUsed, username).run();
  } catch { /* mirror only */ }
  return { dailyUsed: j.data.dailyUsed, weeklyUsed: j.data.weeklyUsed };
}

/**
 * v264 — server-side Atlas Agent access verdict: blocked accounts and
 * exhausted daily/weekly token quotas are refused HERE, before any LLM call.
 * Until now these checks lived only in the SPA (agentPolicy) — a crafted
 * client could bypass them entirely. Owner/admin stay unlimited (established
 * product rule); counters come from the durable quota object (D1 mirror as
 * fallback) exactly like GET /api/agent/policy.
 */
async function agentAccessVerdict(
  env: Env,
  db: D1Database,
  username: string,
  role: string,
): Promise<{ ok: true } | { ok: false; status: number; payload: any }> {
  const uname = String(username || '').toLowerCase();
  try {
    const row = await getAgentControlRow(db, uname);
    if (row.blocked) {
      return {
        ok: false,
        status: 403,
        payload: {
          success: false,
          error: 'Accès à Atlas Agent suspendu pour ce compte (abus ou injection détectés). Contactez un administrateur pour le rétablir.',
          code: 'AGENT_BLOCKED',
        },
      };
    }
  } catch { /* controls table may lag — fail open ONLY for the blocked flag */ }
  if (role === 'owner' || role === 'admin') return { ok: true };
  try {
    const counters = await agentQuotaCounters(env, db, uname);
    if (counters.dailyUsed >= AGENT_DAILY_LIMIT || counters.weeklyUsed >= AGENT_WEEKLY_LIMIT) {
      return {
        ok: false,
        status: 429,
        payload: {
          success: false,
          error: 'Quota de jetons Atlas Agent atteint — rafraîchissement à minuit UTC (quotidien) et lundi 00:00 UTC (hebdomadaire).',
          code: 'AGENT_QUOTA',
          dailyUsed: counters.dailyUsed,
          weeklyUsed: counters.weeklyUsed,
          dailyLimit: AGENT_DAILY_LIMIT,
          weeklyLimit: AGENT_WEEKLY_LIMIT,
          dailyResetsAt: nextUtcMidnight(),
          weeklyResetsAt: nextMondayUtc(),
        },
      };
    }
  } catch { /* quota infrastructure down — do not lock users out */ }
  return { ok: true };
}

app.get('/api/agent/policy', async (c) => {
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), c.req.header('X-Device-Fingerprint') || '');
  if (reason !== 'ok') return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const username = String(session.username || '').toLowerCase();
  const isAdmin = session.role === 'owner' || session.role === 'admin';
  const row = await getAgentControlRow(c.env.DB, username);
  const counters = await agentQuotaCounters(c.env, c.env.DB, username);
  return c.json({
    success: true,
    data: {
      blocked: !!row.blocked,
      isAdmin,
      dailyUsed: counters.dailyUsed,
      weeklyUsed: counters.weeklyUsed,
      dailyLimit: AGENT_DAILY_LIMIT,
      weeklyLimit: AGENT_WEEKLY_LIMIT,
      dailyResetsAt: nextUtcMidnight(),
      weeklyResetsAt: nextMondayUtc(),
    },
  });
});

app.post('/api/agent/usage', async (c) => {
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), c.req.header('X-Device-Fingerprint') || '');
  if (reason !== 'ok') return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const username = String(session.username || '').toLowerCase();
  if (session.role === 'owner' || session.role === 'admin') return c.json({ success: true, data: { unlimited: true } });
  const body = await c.req.json().catch(() => ({}));
  const tokens = Math.max(0, Math.min(200000, Number(body.tokens) || 0));
  const counters = await agentQuotaAdd(c.env, c.env.DB, username, tokens);
  return c.json({ success: true, data: { dailyUsed: counters.dailyUsed, weeklyUsed: counters.weeklyUsed, dailyLimit: AGENT_DAILY_LIMIT, weeklyLimit: AGENT_WEEKLY_LIMIT, dailyResetsAt: nextUtcMidnight(), weeklyResetsAt: nextMondayUtc() } });
});

app.get('/api/admin/agent-usage-log', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  await ensureAgentUsageLog(c.env.DB);
  const username = String(c.req.query('username') || '').trim().toLowerCase();
  const rows = username
    ? await c.env.DB.prepare(`SELECT * FROM agent_usage_log WHERE username = ? ORDER BY id DESC LIMIT 200`).bind(username).all()
    : await c.env.DB.prepare(`SELECT * FROM agent_usage_log ORDER BY id DESC LIMIT 200`).all();
  return c.json({ success: true, data: rows.results || [] });
});

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
const MIG_SKIP = /^(sqlite_|d1_|_cf_)/;
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

app.post('/api/agent/flag', async (c) => {
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), c.req.header('X-Device-Fingerprint') || '');
  if (reason !== 'ok') return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const username = String(session.username || '').toLowerCase();
  const isAdmin = session.role === 'owner' || session.role === 'admin';
  if (isAdmin) return c.json({ success: true, data: { blocked: false, note: 'admin exempt' } });
  await getAgentControlRow(c.env.DB, username);
  await c.env.DB.prepare(`UPDATE agent_controls SET blocked = 1, updated_at = datetime('now') WHERE username = ?`).bind(username).run();
  const body = await c.req.json().catch(() => ({}));
  await writeAudit(c.env.DB, { username, role: session.role, action: 'agent.security_lock', entity: 'atlas_agent', detail: String(body.reason || 'prompt_injection').slice(0, 200) });
  return c.json({ success: true, data: { blocked: true } });
});

app.get('/api/admin/agent-controls', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  await ensureAgentControls(c.env.DB);
  const rows = await c.env.DB.prepare(`SELECT username, blocked, daily_tokens, weekly_tokens, updated_at FROM agent_controls ORDER BY updated_at DESC LIMIT 100`).all() as any;
  return c.json({ success: true, data: rows.results || [] });
});

app.post('/api/admin/agent-access', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  const body = await c.req.json().catch(() => ({}));
  const username = String(body.username || '').toLowerCase().slice(0, 64);
  const action = String(body.action || '');
  if (!username || !['block', 'restore'].includes(action)) return c.json({ success: false, error: 'Paramètres invalides' }, 400);
  await getAgentControlRow(c.env.DB, username);
  await c.env.DB.prepare(`UPDATE agent_controls SET blocked = ?, updated_at = datetime('now') WHERE username = ?`).bind(action === 'block' ? 1 : 0, username).run();
  await writeAudit(c.env.DB, { username: gate.username, role: 'owner', action: action === 'block' ? 'agent.access_block' : 'agent.access_restore', entity: username, detail: 'atlas_agent' });
  return c.json({ success: true });
});

/* ── Privacy: wipe all Atlas Agent conversations (OTP-gated) ── */
app.post('/api/settings/agent-data/request-delete-otp', async (c) => {
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), c.req.header('X-Device-Fingerprint') || '');
  if (reason !== 'ok') return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const username = String(session.username || '').toLowerCase();
  const res = await issueDeleteOtp(c.env, 'agent-data', username, 'toutes les conversations Atlas Agent', 'Code de confirmation — suppression des données Atlas Agent', { toEmail: await userMail(c.env.DB, username) });
  return c.json({ success: true, emailed: res.emailed, message: res.message, otp: res.emailed ? undefined : res.otp });
});

app.post('/api/settings/agent-data/delete', async (c) => {
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), c.req.header('X-Device-Fingerprint') || '');
  if (reason !== 'ok') return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const username = String(session.username || '').toLowerCase();
  const body = await c.req.json().catch(() => ({}));
  const check = await verifyDeleteOtp(c.env.DB, 'agent-data', username, String(body.otp || ''));
  if (!check.ok) return c.json({ success: false, error: check.error }, check.status as any);
  // R2 thread files for this user
  const userKey = username.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || 'user';
  let removed = 0;
  try {
    if (c.env.IMAGES) {
      const listed = await c.env.IMAGES.list({ prefix: `agent/${userKey}/`, limit: 1000 });
      for (const obj of listed.objects || []) { await c.env.IMAGES.delete(obj.key); removed++; }
    }
  } catch { /* */ }
  await ensureAgentControls(c.env.DB);
  await c.env.DB.prepare(`UPDATE agent_controls SET daily_tokens = 0, weekly_tokens = 0, updated_at = datetime('now') WHERE username = ?`).bind(username).run();
  await writeAudit(c.env.DB, { username, role: session.role, action: 'agent.data_delete', entity: 'atlas_agent', detail: `r2=${removed}` });
  return c.json({ success: true, data: { removed } });
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
app.get('/api/auth/devices', async (c) => {
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), c.req.header('X-Device-Fingerprint') || '');
  if (reason !== 'ok') return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const username = String(session.username || '').toLowerCase();
  const fp = String(c.req.header('X-Device-Fingerprint') || '');
  await ensureSecurityTables(c.env.DB);
  const rows = await c.env.DB.prepare(`SELECT fingerprint, last_ip, last_seen, user_agent FROM trusted_devices WHERE lower(username) = ? ORDER BY last_seen DESC LIMIT 25`).bind(username).all() as any;
  const data = (rows.results || []).map((r: any) => ({
    fingerprint: String(r.fingerprint || '').slice(0, 12) + '…',
    full: String(r.fingerprint || ''),
    last_ip: r.last_ip,
    last_seen: r.last_seen,
    user_agent: String(r.user_agent || '').slice(0, 90),
    current: fp && String(r.fingerprint || '') === fp,
  }));
  if (fp && !data.some((d: any) => d.current)) {
    try {
      await touchTrustedDevice(c.env.DB, username, fp, clientIp(c), c.req.header('User-Agent') || '');
      data.unshift({
        fingerprint: fp.slice(0, 12) + '…',
        full: fp,
        last_ip: clientIp(c),
        last_seen: new Date().toISOString(),
        user_agent: String(c.req.header('User-Agent') || '').slice(0, 90),
        current: true,
      });
    } catch { /* best-effort */ }
  }
  return c.json({ success: true, data });
});

app.post('/api/auth/devices/revoke', async (c) => {
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), c.req.header('X-Device-Fingerprint') || '');
  if (reason !== 'ok') return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const username = String(session.username || '').toLowerCase();
  const body = await c.req.json().catch(() => ({}));
  const target = String(body.fingerprint || '');
  if (!target) return c.json({ success: false, error: 'Empreinte requise' }, 400);
  await c.env.DB.prepare(`DELETE FROM trusted_devices WHERE fingerprint = ? AND lower(username) = ?`).bind(target, username).run();
  await writeAudit(c.env.DB, { username, role: session.role, action: 'device.revoke', entity: target.slice(0, 12), detail: 'trusted_device' });
  return c.json({ success: true });
});

/** Best-effort: remember every device that actively uses the account. */
async function touchTrustedDevice(
  db: D1Database,
  username: string,
  fingerprint: string,
  ip: string,
  userAgent: string,
): Promise<void> {
  const fp = String(fingerprint || '').trim();
  const uname = String(username || '').trim().toLowerCase();
  if (!fp || fp === 'none' || !uname) return;
  await ensureSecurityTables(db);
  await db
    .prepare(
      `INSERT INTO trusted_devices (fingerprint, username, user_agent, last_ip, last_seen)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(fingerprint) DO UPDATE SET
         username = excluded.username,
         user_agent = excluded.user_agent,
         last_ip = excluded.last_ip,
         last_seen = datetime('now')`,
    )
    .bind(fp.slice(0, 128), uname, String(userAgent || '').slice(0, 200), String(ip || '').slice(0, 64))
    .run();
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
  return c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || c.req.header('X-Real-IP') || 'unknown';
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

/** Skip repeated CREATE/ALTER on warm isolates (main source of slow API + duplicate column noise). */
const _schemaOnce = new Set<string>();
const _schemaOnceInflight = new Map<string, Promise<void>>();

/** Run DDL at most once per isolate (safe under concurrent requests). */
async function schemaOnce(key: string, fn: () => Promise<void>): Promise<void> {
  if (_schemaOnce.has(key)) return;
  const existing = _schemaOnceInflight.get(key);
  if (existing) {
    await existing;
    return;
  }
  const p = (async () => {
    try {
      await fn();
    } finally {
      _schemaOnce.add(key);
      _schemaOnceInflight.delete(key);
    }
  })();
  _schemaOnceInflight.set(key, p);
  await p;
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

/** Idempotent ALTER TABLE ADD COLUMN — ignores duplicate column (D1/SQLite). */
async function addColumnIfMissing(db: D1Database, table: string, column: string, typeSql: string) {
  try {
    const info = await db.prepare(`PRAGMA table_info(${table})`).all();
    const rows = (info?.results || []) as { name?: string }[];
    if (rows.some((r) => String(r.name || '').toLowerCase() === column.toLowerCase())) {
      return;
    }
  } catch {
    /* pragma may fail on some bindings — fall through to ALTER */
  }
  try {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeSql}`).run();
  } catch (e: any) {
    const msg = String(e?.message || e || '');
    if (/duplicate column name/i.test(msg) || /already exists/i.test(msg)) return;
    // Non-fatal for schema drift; log only in debug
  }
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

async function isRateLimited(db: D1Database, ip: string): Promise<{ blocked: boolean; reason?: string }> {
  const rep = await getReputation(db, ip) as any;
  if (rep.blocked_until) {
    const until = new Date(rep.blocked_until).getTime();
    if (until > Date.now()) {
      return { blocked: true, reason: 'Trop de tentatives. Compte / IP temporairement bloqué. Réessayez plus tard.' };
    }
  }
  const recent = await db.prepare(
    `SELECT COUNT(*) as c FROM login_attempts WHERE ip = ? AND success = 0 AND created_at > datetime('now', '-10 minutes')`
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

async function recordLogin(db: D1Database, ip: string, fingerprint: string, success: boolean, userAgent: string) {
  const delta = success ? 5 : -8;
  await db.prepare(`INSERT INTO login_attempts (ip, fingerprint, success, reputation_delta, user_agent) VALUES (?, ?, ?, ?, ?)`).bind(ip, fingerprint || '', success ? 1 : 0, delta, userAgent || '').run();
  await getReputation(db, ip);
  if (success) {
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
  opts?: { relaxSession?: boolean },
): Promise<string> {
  if (!authHeader?.startsWith('Bearer ')) return 'missing';
  const parsed = parseToken(authHeader.slice(7));
  if (!parsed) return 'bad_token';

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
      const expectedProof = await makeSessionProof(user, row.role, row.password_hash, parsed.ip, parsed.fingerprint);
      if (proof !== expectedProof) return 'bad_password';
    }
  }

  if (opts?.relaxSession) return 'ok';
  // Device-bound sessions: fingerprint is the strong signal. Mobile / CGNAT / IPv6
  // often change IP mid-session — do not force re-login when the same device token is used.
  const tokenFp = parsed.fingerprint && parsed.fingerprint !== 'none' ? parsed.fingerprint : '';
  const reqFp = fingerprint && fingerprint !== 'none' ? fingerprint : '';
  if (tokenFp) {
    if (reqFp && reqFp !== tokenFp) return 'fp_changed';
    return 'ok';
  }
  // Legacy sessions without fingerprint: still bind to IP
  if (parsed.ip && ip && parsed.ip !== ip) {
    return 'ip_changed';
  }
  return 'ok';
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
function sessionUserFromHeader(authHeader: string | undefined): { username: string; role: string } {
  const ANONYMOUS = { username: '', role: '' };
  if (!authHeader?.startsWith('Bearer ')) return ANONYMOUS;
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
  const fingerprint = String(body.fingerprint || 'none').slice(0, 128);
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

  const limited = await isRateLimited(c.env.DB, ip);
  if (limited.blocked) {
    await recordLogin(c.env.DB, ip, fingerprint, false, ua);
    return c.json({ success: false, error: limited.reason, code: 'RATE_LIMITED' }, 429);
  }

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
      await recordLogin(c.env.DB, ip, fingerprint, false, ua);
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
      await recordLogin(c.env.DB, ip, fingerprint, false, ua);
      return c.json({ success: false, error: 'Identifiant ou mot de passe incorrect', code: 'BAD_PASSWORD' }, 401);
    }
    if (!(await verifyUserPassword(password, row.password_salt, row.password_hash))) {
      await recordLogin(c.env.DB, ip, fingerprint, false, ua);
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

  // Trusted device → no OTP — but only from IPs with a healthy reputation.
  // Low-reputation IPs must re-complete the e-mail OTP even on known devices,
  // so a stolen password + copied fingerprint never suffices from a bad IP.
  const preRep = (await getReputation(c.env.DB, ip)) as any;
  const twofaOn = (await getConfig(c.env.DB, 'twofa_enabled', '0')) === '1';
  if (!twofaOn && await isTrustedDevice(c.env.DB, fingerprint) && Number(preRep?.score ?? 50) >= 40) {
    await trustDevice(c.env.DB, fingerprint, ip);
    await recordLogin(c.env.DB, ip, fingerprint, true, ua);
    await writeAudit(c.env.DB, { username, role, action: 'auth.login', entity: 'session', detail: 'trusted_device', ip });
    const rep = await getReputation(c.env.DB, ip) as any;
    const token = await makeTokenV2(username, role, secretMaterial, ip, fingerprint);
    const row = await c.env.DB.prepare(
      `SELECT biometric_credential_id FROM trusted_devices WHERE fingerprint = ?`
    ).bind(fingerprint).first() as any;
    return c.json({
      success: true,
      needs_otp: false,
      trusted_device: true,
      biometric_registered: !!(row?.biometric_credential_id),
      token,
      ip,
      username,
      role,
      displayName,
      reputationScore: rep.score,
      message: 'Appareil de confiance — connexion sans OTP.',
    });
  }

  // New device — OTP required (owner and users) — fast path: parallel DB + background email
  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const loginResourceId = fingerprint !== 'none' ? `fp:${fingerprint}` : `ip:${ip}`;
  const ctxJson = JSON.stringify({ username, role, secretMaterial });
  // Cloudflare Email binding only allows the configured destination (admin@).
  // security@ is valid as FROM only — never as TO or sends fail with "not allowed".
  const fromAddr = (c.env.OTP_FROM || (c.env as any).RESEND_FROM || 'noreply@afmarbre.com').trim() || 'security@afmarbre.com';
  // v235 — the user's own inbox first (Resend can deliver anywhere); admin fallback for the CF binding
  let toAddr = accountEmail;
  if (!toAddr) {
    toAddr = (c.env.OTP_TO || 'security@afmarbre.com').trim() || 'admin@afmarbre.com';
    if (toAddr.toLowerCase() === fromAddr.toLowerCase() || toAddr.toLowerCase() === 'security@afmarbre.com') {
      toAddr = 'admin@afmarbre.com';
    }
  }
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
    c.env.DB.prepare(`SELECT company_name FROM company_settings WHERE id = 1`).first() as Promise<any>,
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
    await trustDevice(c.env.DB, fingerprint, ip);
    await recordLogin(c.env.DB, ip, fingerprint, true, ua);
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
  // Non-production hosts (localhost / sandbox previews): the e-mail never
  // really arrives, so print the code to the worker log for the developer.
  try {
    const h = new URL(c.req.url).hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.e2b.app') || h.endsWith('.workers.dev') || /^\d+-/.test(h)) {
      console.log('[dev-otp] login code for', username, ':', otp);
    }
  } catch { /* ignore */ }
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

  return c.json({
    success: true,
    needs_otp: true,
    emailed: true,
    username,
    message: 'Un code de vérification a été envoyé. Vérifiez votre boîte de réception.',
  });
});

app.post('/api/auth/verify-otp', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const username = String(body.username ?? getOwnerUsername(c.env)).trim().toLowerCase();
  const password = String(body.password ?? '');
  const otp = String(body.otp || '').trim();
  const fingerprint = String(body.fingerprint || 'none').slice(0, 128);
  const ip = clientIp(c);
  const ua = c.req.header('User-Agent') || '';

  await ensureSecurityTables(c.env.DB);

  const limited = await isRateLimited(c.env.DB, ip);
  if (limited.blocked) {
    await recordLogin(c.env.DB, ip, fingerprint, false, ua);
    return c.json({ success: false, error: limited.reason, code: 'RATE_LIMITED' }, 429);
  }

  if (!otp || otp.length < 4) {
    return c.json({ success: false, error: 'Code OTP obligatoire', code: 'OTP_REQUIRED' }, 400);
  }

  const loginResourceId = fingerprint !== 'none' ? `fp:${fingerprint}` : `ip:${ip}`;
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
    await recordLogin(c.env.DB, ip, fingerprint, false, ua);
    return c.json({ success: false, error: 'Code incorrect', code: 'BAD_OTP' }, 401);
  }
  if (new Date(record.expires_at) < new Date()) {
    return c.json({
      success: false,
      error: 'Code expiré. Veuillez recommencer la connexion.',
      code: 'OTP_EXPIRED',
    }, 400);
  }

  // Restore login context
  const ctxRow = await c.env.DB.prepare(
    `SELECT * FROM otp_codes WHERE resource_type = 'login_ctx' AND resource_id = ? ORDER BY created_at DESC LIMIT 1`
  ).bind(loginResourceId).first() as any;

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

  await trustDevice(c.env.DB, fingerprint, ip);
  await recordLogin(c.env.DB, ip, fingerprint, true, ua);
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
  const fingerprint = String(body.fingerprint || 'none').slice(0, 128);
  const ip = clientIp(c);
  const ua = c.req.header('User-Agent') || '';

  await ensureSecurityTables(c.env.DB);
  const limited = await isRateLimited(c.env.DB, ip);
  if (limited.blocked) {
    await recordLogin(c.env.DB, ip, fingerprint, false, ua);
    return c.json({ success: false, error: limited.reason, code: 'RATE_LIMITED' }, 429);
  }
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
    await recordLogin(c.env.DB, ip, fingerprint, false, ua);
    return c.json({ success: false, error: 'Signature du lien invalide', code: 'LINK_INVALID' }, 401);
  }

  // Single use: consume the login rows wherever they live
  await c.env.DB.prepare(`DELETE FROM otp_codes WHERE resource_type = 'login' AND resource_id = ?`).bind(record.resource_id).run();
  await c.env.DB.prepare(`DELETE FROM otp_codes WHERE resource_type = 'login_ctx' AND resource_id = ?`).bind(record.resource_id).run();
  try { await purgeEphemeralSecurityData(c.env.DB); } catch { /* */ }

  await trustDevice(c.env.DB, fingerprint, ip);
  await recordLogin(c.env.DB, ip, fingerprint, true, ua);
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

  const fromDo = await qrDoGet(c.env, token);
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

  const authToken = await makeTokenV2(row.username, row.role, secretMaterial, ip, fingerprint);
  try {
    await trustDevice(c.env.DB, fingerprint, ip);
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

  await trustDevice(c.env.DB, fingerprint, clientIp(c));
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
  const fingerprint = String(body.fingerprint || 'none').slice(0, 128);
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
  await trustDevice(c.env.DB, fingerprint, ip);
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
/* ── v260 — Crash & user reports → GitHub issues (docs/reports-github.md) ──
 * crash_reports: automatic intake from the app's global error handlers.
 * user_reports: "Signaler un problème" from any logged-in account.
 * GitHub sync is opt-in: env GITHUB_ISSUE_TOKEN secret or the owner-set
 * app_config token (in-app, never echoed). Without one, everything queues
 * in D1 and the daily cron drains it once configured — no report is lost. */
app.post('/api/crash-reports', async (c) => {
  const ip = clientIp(c);
  const limited = await isRateLimited(c.env.DB, ip);
  if (limited.blocked) return c.json({ success: false, error: limited.reason, code: 'RATE_LIMITED' }, 429);
  let body: any = {};
  try { body = await c.req.json(); } catch { body = {}; }
  try {
    await ensureReportTables(c.env.DB);
    const out = await reportCrash(c.env.DB, c.env, body, ip);
    return c.json({ success: true, data: { reference: `C-${out.id}`, deduped: out.deduped } }, 202);
  } catch {
    // Intake must never break the app: acknowledge even if D1/GitHub fails.
    return c.json({ success: true, data: { reference: null } }, 202);
  }
});

app.post('/api/reports', async (c) => {
  const ip = clientIp(c);
  const fingerprint = String(c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, ip, fingerprint);
  if (reason !== 'ok') return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  const limited = await isRateLimited(c.env.DB, ip);
  if (limited.blocked) return c.json({ success: false, error: limited.reason, code: 'RATE_LIMITED' }, 429);
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  let body: any = {};
  try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'Requête invalide', code: 'BAD_REQUEST' }, 400); }
  const message = String(body?.message || '').trim();
  if (message.length < 5 || message.length > 2000) {
    return c.json({ success: false, error: 'Le message doit contenir entre 5 et 2000 caractères.', code: 'BAD_REQUEST' }, 400);
  }
  await ensureReportTables(c.env.DB);
  const out = await reportUser(c.env.DB, c.env, {
    username: String(session.username || ''),
    role: String(session.role || ''),
    kind: String(body?.kind || 'bug'),
    message,
    contact: body?.contact ? String(body.contact) : '',
    page: body?.page ? String(body.page) : '',
    version: body?.version ? String(body.version) : '',
  });
  return c.json({ success: true, data: { reference: out.reference, issue_url: out.issue_url || null } }, 201);
});

/** Owner-only GitHub token management — the token is NEVER returned. */
async function reportsOwnerSession(c: any, env: any, db: any, ip: string): Promise<{ username: string; role: string } | null> {
  const fingerprint = String(c.req.header('X-Device-Fingerprint') || 'none').slice(0, 128);
  const reason = await authFailReason(c.req.header('Authorization'), env, db, ip, fingerprint);
  if (reason !== 'ok') return null;
  return sessionUserFromHeader(c.req.header('Authorization'));
}

app.get('/api/admin/github-token', async (c) => {
  const ip = clientIp(c);
  const session = await reportsOwnerSession(c, c.env, c.env.DB, ip);
  if (!session) return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  if (session.role !== 'owner') return c.json({ success: false, error: 'Réservé au propriétaire', code: 'FORBIDDEN' }, 403);
  await ensureReportTables(c.env.DB);
  const cfg = await githubConfig(c.env);
  return c.json({ success: true, data: { configured: !!cfg.token, source: cfg.source, repo: cfg.repo } });
});

app.put('/api/admin/github-token', async (c) => {
  const ip = clientIp(c);
  const session = await reportsOwnerSession(c, c.env, c.env.DB, ip);
  if (!session) return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  if (session.role !== 'owner') return c.json({ success: false, error: 'Réservé au propriétaire', code: 'FORBIDDEN' }, 403);
  let body: any = {};
  try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'Requête invalide', code: 'BAD_REQUEST' }, 400); }
  const token = String(body?.token || '').trim();
  const repo = String(body?.repo || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').replace(/^\/+|\/+$/g, '');
  await ensureReportTables(c.env.DB);
  if (!token) {
    await saveGithubConfig(c.env.DB, '', repo);
    return c.json({ success: true, data: { configured: false } });
  }
  if (token.length > 300 || !/^[A-Za-z0-9_]+$/.test(token)) {
    return c.json({ success: false, error: 'Format de token invalide', code: 'BAD_REQUEST' }, 400);
  }
  const v = await validateGithubToken(token);
  if (!v.ok) return c.json({ success: false, error: v.error || 'Token invalide', code: 'INVALID_TOKEN' }, 400);
  await saveGithubConfig(c.env.DB, token, repo || 'Etherealmber/atlas-commerce');
  return c.json({ success: true, data: { configured: true, login: v.login || null, repo: repo || 'Etherealmber/atlas-commerce' } });
});

app.get('/api/admin/reports', async (c) => {
  const ip = clientIp(c);
  const session = await reportsOwnerSession(c, c.env, c.env.DB, ip);
  if (!session) return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  if (session.role !== 'owner' && session.role !== 'admin') {
    return c.json({ success: false, error: 'Réservé au propriétaire/admin', code: 'FORBIDDEN' }, 403);
  }
  await ensureReportTables(c.env.DB);
  const data = await listReports(c.env.DB, Number(c.req.query('limit') || 25));
  return c.json({ success: true, data });
});

app.post('/api/admin/reports/retry', async (c) => {
  const ip = clientIp(c);
  const session = await reportsOwnerSession(c, c.env, c.env.DB, ip);
  if (!session) return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  if (session.role !== 'owner') return c.json({ success: false, error: 'Réservé au propriétaire', code: 'FORBIDDEN' }, 403);
  await ensureReportTables(c.env.DB);
  const out = await retryPendingReports(c.env);
  if (out.skipped) {
    return c.json({ success: false, error: 'Aucun token GitHub configuré — ajoutez-le d’abord.', code: 'GITHUB_NOT_CONFIGURED' }, 409);
  }
  return c.json({ success: true, data: out });
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
  const fingerprint = String(body.fingerprint || 'none').slice(0, 128);
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
    `INSERT INTO app_users (username, password_hash, password_salt, role, display_name, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(username, password_hash, salt, role, displayName, gate.username).run();

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

  if (body.password && normalizePassword(body.password).length >= 6) {
    const salt = randomChallenge().slice(0, 16);
    const password_hash = await hashUserPassword(body.password, salt);
    await c.env.DB.prepare(
      `UPDATE app_users SET display_name = ?, role = ?, active = ?, password_hash = ?, password_salt = ? WHERE id = ?`
    ).bind(display_name, role, active, password_hash, salt, id).run();
  } else {
    await c.env.DB.prepare(
      `UPDATE app_users SET display_name = ?, role = ?, active = ? WHERE id = ?`
    ).bind(display_name, role, active, id).run();
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
      if (hit.ok) {
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

app.get('/api/auth/me', async (c) => {
  // v243.2 — every active device (web/phone) registers itself so the
  // "appareils connectés" popup always lists yours, current one included.
  try {
    const sess = sessionUserFromHeader(c.req.header('Authorization'));
    await touchTrustedDevice(c.env.DB, sess.username, c.req.header('X-Device-Fingerprint') || '', clientIp(c), c.req.header('User-Agent') || '');
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


/**
 * Retention policy — ONLY cancelled documents are purged after a delay.
 * Active invoices / devis / bills / receipts are NEVER auto-deleted or auto-cancelled.
 *
 *  - Cancelled invoices (incl. cancelled quotes): purge after 7 days
 *  - Cancelled bills: purge after 7 days
 *  - Cancelled receipts: purge after 7 days
 */
app.post('/api/admin/retention/run', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;

  let invoicesPurged = 0;
  let billsPurged = 0;
  let receiptsPurged = 0;

  const settingsRow = await c.env.DB.prepare(`SELECT retention_cancelled_days FROM company_settings WHERE id = 1`).first() as any;
  const days = Math.max(1, Math.min(365, Number(settingsRow?.retention_cancelled_days ?? 14) || 14));
  const dayExpr = `-${days} days`;

  // --- Cancelled invoices only (stock already restocked at cancel time) ---
  const cancelledInv = await c.env.DB.prepare(
    `SELECT id, number FROM invoices
     WHERE status = 'cancelled'
       AND date(COALESCE(updated_at, issue_date, created_at)) < date('now', ?)`
  ).bind(dayExpr).all();
  for (const inv of (cancelledInv.results || []) as any[]) {
    try {
      // Already cancelled → no stock side-effects expected; remove dependents then row
      await c.env.DB.prepare(`DELETE FROM invoice_payments WHERE invoice_id = ?`).bind(inv.id).run();
      await c.env.DB.prepare(`DELETE FROM invoice_items WHERE invoice_id = ?`).bind(inv.id).run();
      try {
        await c.env.DB.prepare(`DELETE FROM receipts WHERE invoice_id = ?`).bind(inv.id).run();
      } catch { /* optional table */ }
      await c.env.DB.prepare(`DELETE FROM invoices WHERE id = ? AND status = 'cancelled'`).bind(inv.id).run();
      invoicesPurged++;
    } catch (e) {
      console.error('retention invoice', inv.id, e);
    }
  }

  // --- Cancelled bills only ---
  const cancelledBills = await c.env.DB.prepare(
    `SELECT id, number FROM bills
     WHERE status = 'cancelled'
       AND date(COALESCE(updated_at, issue_date, created_at)) < date('now', ?)`
  ).bind(dayExpr).all();
  for (const b of (cancelledBills.results || []) as any[]) {
    try {
      await c.env.DB.prepare(`DELETE FROM bill_items WHERE bill_id = ?`).bind(b.id).run();
      await c.env.DB.prepare(`DELETE FROM bills WHERE id = ? AND status = 'cancelled'`).bind(b.id).run();
      billsPurged++;
    } catch (e) {
      console.error('retention bill', b.id, e);
    }
  }

  // --- Cancelled receipts only (7 days) ---
  try {
    const rec = await c.env.DB.prepare(
      `SELECT id FROM receipts
       WHERE status = 'cancelled'
         AND date(COALESCE(updated_at, issue_date, created_at)) < date('now', ?)`
    ).bind(dayExpr).all();
    for (const r of (rec.results || []) as any[]) {
      await c.env.DB.prepare(`DELETE FROM receipts WHERE id = ?`).bind(r.id).run();
      receiptsPurged++;
    }
  } catch {
    /* receipts.status may not exist yet */
  }

  const ephemeral = await purgeEphemeralSecurityData(c.env.DB);
  let agentChatsPurged = 0;
  try {
    agentChatsPurged = (await purgeAgentConversationsOlderThan(c.env, 30)).deleted;
  } catch { /* */ }

  await writeAudit(c.env.DB, {
    username: gate.username,
    role: 'owner',
    action: 'retention.run',
    detail: `cancelled_invoices=${invoicesPurged};cancelled_bills=${billsPurged};cancelled_receipts=${receiptsPurged};otp=${ephemeral.otp};challenges=${ephemeral.webauthn_challenges};login_attempts=${ephemeral.login_attempts};idempotency=${ephemeral.idempotency};agent_chats=${agentChatsPurged}`,
    ip: c.req.header('cf-connecting-ip') || '',
  });

  return c.json({
    success: true,
    data: {
      cancelled_invoices_purged: invoicesPurged,
      cancelled_bills_purged: billsPurged,
      cancelled_receipts_purged: receiptsPurged,
      agent_chats_purged: agentChatsPurged,
      ephemeral,
    },
    message: `Purge: documents annulés (${days} j) + OTP/challenges expirés + tentatives login >14 j + idempotency >7 j.`,
  });
});

app.get('/api/admin/r2/catalog', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  return c.json({ success: true, data: icebergCatalogInfo(c.env) });
});



app.get('/api/public/products', async (c) => {
  return c.json({ success: false, error: 'Catalogue public désactivé', code: 'PUBLIC_DISABLED' }, 403);
});

app.get('/api/public/products/:id', async (c) => {
  return c.json({ success: false, error: 'Catalogue public désactivé', code: 'PUBLIC_DISABLED' }, 403);
});

app.get('/api/public/categories', async (c) => {
  return c.json({ success: false, error: 'Catalogue public désactivé', code: 'PUBLIC_DISABLED' }, 403);
});



app.post('/api/public/invoices/:token/sign', async (c) => {
  await ensureInvoicePublicToken(c.env.DB);
  const token = c.req.param('token');
  const body = await c.req.json().catch(() => ({})) as any;
  const signature = String(body.signature || '');
  if (!signature.startsWith('data:image')) {
    return c.json({ success: false, error: 'Signature invalide (image requise)' }, 400);
  }
  if (signature.length > 1_800_000) {
    return c.json({
      success: false,
      error: 'Signature trop volumineuse. Effacez et resignez plus simplement, ou utilisez un stylet plus fin.',
      code: 'SIGNATURE_TOO_LARGE',
      size: signature.length,
    }, 400);
  }
  const inv = await c.env.DB.prepare(`SELECT * FROM invoices WHERE public_token = ?`).bind(token).first() as any;
  if (!inv) return c.json({ success: false, error: 'Document introuvable' }, 404);
  if (inv.status === 'quote' || inv.status === 'devis') {
    return c.json({ success: false, error: 'Un devis ne peut pas être signé ici — convertissez-le en facture.' }, 400);
  }
  if (inv.status === 'cancelled') {
    return c.json({ success: false, error: 'Document annulé — signature refusée.' }, 400);
  }
  const digest = await digestSignatureImage(signature);
  const docHash = await sha256Hex(invoiceDocHashPayload(inv));
  const ts = await createAtlasTimestampToken(c.env, docHash, c.env.DB);
  try {
    await c.env.DB.prepare(
      `UPDATE invoices SET client_signature = ?, signed_at = datetime('now'), updated_at = datetime('now'),
       signature_digest = ?, signed_doc_hash = ?, timestamp_token = ?, timestamp_at = ? WHERE id = ?`
    ).bind(signature, digest, docHash, ts.compact, ts.issuedAt, inv.id).run();
  } catch {
    await ensureInvoicePublicToken(c.env.DB);
    await c.env.DB.prepare(
      `UPDATE invoices SET client_signature = ?, signed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`
    ).bind(signature, inv.id).run();
    try {
      await c.env.DB.prepare(
        `UPDATE invoices SET signature_digest = ?, signed_doc_hash = ?, timestamp_token = ?, timestamp_at = ? WHERE id = ?`
      ).bind(digest, docHash, ts.compact, ts.issuedAt, inv.id).run();
    } catch { /* ignore */ }
  }
  return c.json({
    success: true,
    message: 'Signature enregistrée, scellée et horodatée (aligné PAdES-B-T)',
    data: {
      digest: digest.slice(0, 12),
      doc_hash: docHash.slice(0, 16),
      timestamp_at: ts.issuedAt,
      timestamp_profile: 'PAdES-B-T-aligned',
    },
  });
});

/** JSON signature validation for a public invoice token. */
app.get('/api/public/invoices/:token/signature', async (c) => {
  await ensureInvoicePublicToken(c.env.DB);
  const token = c.req.param('token');
  const inv = await c.env.DB.prepare(`SELECT * FROM invoices WHERE public_token = ?`).bind(token).first() as any;
  if (!inv) return c.json({ success: false, error: 'Document introuvable' }, 404);
  const check = await validateStoredSignature(inv);
  let timestamp: any = null;
  if (inv.timestamp_token) {
    const tv = await verifyAtlasTimestampToken(c.env, String(inv.timestamp_token), inv.signed_doc_hash || undefined, c.env.DB);
    timestamp = {
      present: true,
      valid: tv.ok,
      reason: tv.reason || null,
      at: inv.timestamp_at || tv.token?.t || null,
      profile: tv.token?.profile || 'PAdES-B-T-aligned',
      hash_prefix: (tv.token?.h || inv.signed_doc_hash || '').slice(0, 16),
    };
  } else {
    timestamp = { present: false, valid: false, reason: 'no_timestamp' };
  }
  return c.json({
    success: true,
    data: {
      number: inv.number,
      status: inv.status,
      total: inv.total,
      amount_paid: inv.amount_paid,
      signature: check,
      timestamp,
      valid: check.present && check.imageOk && check.digestOk && check.docUnchanged && (!timestamp.present || timestamp.valid),
      standards_note: 'Sceau Atlas + horodatage HMAC (intention PAdES-B-T). Un horodatage RFC 3161 TSA externe peut être branché ultérieurement.',
    },
  });
});

app.get('/api/public/invoices/:token/timestamp', async (c) => {
  await ensureInvoicePublicToken(c.env.DB);
  const token = c.req.param('token');
  const inv = await c.env.DB.prepare(`SELECT * FROM invoices WHERE public_token = ?`).bind(token).first() as any;
  if (!inv) return c.json({ success: false, error: 'Document introuvable' }, 404);
  if (!inv.timestamp_token) {
    return c.json({ success: true, data: { present: false, valid: false, message: 'Aucun horodatage cryptographique.' } });
  }
  const tv = await verifyAtlasTimestampToken(c.env, String(inv.timestamp_token), inv.signed_doc_hash || undefined, c.env.DB);
  return c.json({
    success: true,
    data: {
      present: true,
      valid: tv.ok,
      reason: tv.reason || null,
      at: inv.timestamp_at || tv.token?.t,
      profile: tv.token?.profile || 'PAdES-B-T-aligned',
      hash_prefix: (tv.token?.h || '').slice(0, 24),
      standards: {
        pades: 'Intention PAdES-B-T (ETSI EN 319 142) — horodatage lié au hash document',
        rfc3161: 'Token Atlas (HMAC). Branchement TSA RFC 3161 possible sans changer l’API publique.',
        adobe: 'Adobe Acrobat affiche les signatures CMS/PAdES natives ; ce sceau est vérifiable via l’API Atlas.',
      },
    },
  });
});

app.get('/api/public/invoices/:token', async (c) => {
  await ensureInvoicePublicToken(c.env.DB);
  const token = c.req.param('token');
  const origin = new URL(c.req.url).origin;
  let inv = await c.env.DB.prepare(`SELECT * FROM invoices WHERE public_token = ?`).bind(token).first() as any;
  if (!inv) {
    // fallback: numeric id only if token looks like id (legacy) — disabled for security
    return c.html(`<!DOCTYPE html><html lang="fr"><body style="font-family:system-ui;padding:40px;text-align:center"><h1>Document introuvable</h1><p>Lien invalide ou expiré.</p></body></html>`, 404);
  }
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const { results: items } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).bind(inv.id).all();
  await ensurePaymentHistoryTable(c.env.DB);
  const { results: payHist } = await c.env.DB.prepare(`SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY paid_at ASC, id ASC`).bind(inv.id).all();
  const paid = Number(inv.amount_paid || 0);
  const total = Number(inv.total || 0);
  const due = Math.max(0, total - paid);
  const isPaid = inv.status === 'paid' || due <= 0.001;
  const isQuote = inv.status === 'quote' || inv.status === 'devis';
  const isRefund = inv.status === 'remboursement' || inv.doc_kind === 'remboursement';
  const isQuickSale = inv.doc_kind === 'quick_sale' || inv.doc_kind === 'ticket' || String(inv.number || '').startsWith('VR');
  const title = isQuote ? 'DEVIS' : isRefund ? 'REMBOURSEMENT (WR)' : isQuickSale ? 'VENTE RAPIDE' : 'FACTURE';
  if (isRefund && inv.refund_of_invoice_id) {
    try {
      const src = await c.env.DB.prepare(`SELECT number FROM invoices WHERE id = ?`).bind(inv.refund_of_invoice_id).first() as any;
      if (src?.number) inv._source_number = src.number;
    } catch { /* */ }
  }
  // Reuse print HTML with live totals; pass as invoice
  const html = generateInvoiceHTML(settings, inv, items as any[], title, false);
  // Inject live banner
  const cur = settings?.currency || 'MAD';
  const histRows = ((payHist || []) as any[]).map((p) =>
    `<tr><td>${(p.paid_at||'').toString().slice(0,10)}</td><td>${Number(p.amount)} ${cur}</td><td>${p.payment_method||''}</td><td>${p.payee==='owner'?'Propriétaire':'Société'}</td></tr>`
  ).join('') || '<tr><td colspan="4">Aucun paiement enregistré</td></tr>';
  const histTable = !isQuote ? `<h2 style="font-size:12px;margin:16px 0 6px">Historique des paiements</h2>
    <table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:12px">
      <thead><tr><th style="border:1px solid #000;padding:4px">Date</th><th style="border:1px solid #000;padding:4px">Montant</th><th style="border:1px solid #000;padding:4px">Mode</th><th style="border:1px solid #000;padding:4px">Bénéficiaire</th></tr></thead>
      <tbody>${histRows}</tbody>
    </table>` : '';
  const banner = isQuote
    ? `<div style="border:2px solid #000;padding:12px;margin-bottom:16px;text-align:center;font-weight:700">DEVIS — Estimation non facturée</div>`
    : isRefund
      ? `<div style="border:2px solid #000;padding:12px;margin-bottom:16px;text-align:center;font-weight:700">REMBOURSEMENT / AVOIR (WR) — Stock rétabli<br/><span style="font-weight:500;font-size:11px">Un remboursement sans motif valable n’est pas accepté. Motif : ${(inv.refund_reason || inv.notes || '').toString().slice(0, 280)}</span></div>`
    : isPaid
      ? `<div style="border:2px solid #000;padding:12px;margin-bottom:16px;text-align:center;font-weight:700">FACTURE SOLDÉE — Payée intégralement</div>${histTable}`
      : `<div style="border:2px solid #000;padding:12px;margin-bottom:16px;text-align:center"><strong>Crédit restant : ${due} ${cur}</strong><br/>Déjà payé : ${paid} · Total : ${total}</div>${histTable}`;
  const signPad = inv.client_signature
    ? `<div style="margin:24px 0;page-break-inside:avoid"><p style="font-size:12px;font-weight:700">Signature client (numérique)</p><img src="${inv.client_signature}" alt="Signature" style="max-height:90px;border:1px solid #000;background:#fff"/></div>`
    : (isQuote ? '' : (
        `<div class="no-print" style="margin:20px 0">
        <button type="button" id="open-sig" style="width:100%;max-width:420px;padding:14px 18px;font-size:16px;font-weight:700;background:#1a1814;color:#fff;border:0;border-radius:10px;cursor:pointer">
          Signer numériquement
        </button>
        <p id="sig-msg" style="font-size:12px;margin-top:8px;color:#666"></p>
      </div>
      <div id="sig-modal" style="display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.55);align-items:stretch;justify-content:center">
        <div style="background:#fff;width:100%;max-width:100%;height:100%;display:flex;flex-direction:column;padding:12px;box-sizing:border-box">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <strong style="font-size:16px">Signature</strong>
            <button type="button" id="sig-close" style="padding:10px 14px;font-size:15px">Fermer</button>
          </div>
          <p style="font-size:13px;color:#555;margin-bottom:8px">Signez librement avec le doigt ou le stylet (téléphone / tablette / ordinateur).</p>
          <canvas id="sig" style="flex:1;width:100%;min-height:220px;border:2px solid #1a1814;border-radius:8px;touch-action:none;background:#fff"></canvas>
          <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">
            <button type="button" id="sig-clear" style="flex:1;padding:14px;font-size:16px">Effacer</button>
            <button type="button" id="sig-save" style="flex:2;padding:14px;font-size:16px;font-weight:700;background:#1a1814;color:#fff;border:0;border-radius:8px">Enregistrer</button>
          </div>
        </div>
      </div>
      <script>
      (function(){
        var modal=document.getElementById('sig-modal');
        var c=document.getElementById('sig');
        var ctx=c.getContext('2d');
        var drawing=false, last=null;
        function resize(){
          var ratio=Math.max(window.devicePixelRatio||1,1);
          var w=c.clientWidth||window.innerWidth-24;
          var h=c.clientHeight||Math.max(240, window.innerHeight*0.55);
          c.width=w*ratio; c.height=h*ratio;
          ctx.setTransform(ratio,0,0,ratio,0,0);
          ctx.strokeStyle='#111'; ctx.lineWidth=2.2; ctx.lineCap='round'; ctx.lineJoin='round';
        }
        function pos(e){
          var r=c.getBoundingClientRect();
          var x=(e.touches?e.touches[0].clientX:e.clientX)-r.left;
          var y=(e.touches?e.touches[0].clientY:e.clientY)-r.top;
          return {x:x,y:y};
        }
        function start(e){ e.preventDefault(); drawing=true; last=pos(e); }
        function move(e){ e.preventDefault(); if(!drawing) return; var p=pos(e); ctx.beginPath(); ctx.moveTo(last.x,last.y); ctx.lineTo(p.x,p.y); ctx.stroke(); last=p; }
        function end(){ drawing=false; }
        document.getElementById('open-sig').onclick=function(){
          modal.style.display='flex';
          setTimeout(resize, 50);
        };
        document.getElementById('sig-close').onclick=function(){ modal.style.display='none'; };
        c.addEventListener('mousedown',start); c.addEventListener('mousemove',move); window.addEventListener('mouseup',end);
        c.addEventListener('touchstart',start,{passive:false}); c.addEventListener('touchmove',move,{passive:false}); c.addEventListener('touchend',end);
        document.getElementById('sig-clear').onclick=function(){ ctx.clearRect(0,0,c.width,c.height); resize(); };
        document.getElementById('sig-save').onclick=function(){
          // Downscale + JPEG to avoid "signature trop volumineuse"
          var maxW=600, scale=Math.min(1, maxW/Math.max(c.width,1));
          var off=document.createElement('canvas');
          off.width=Math.max(1, Math.floor(c.width*scale));
          off.height=Math.max(1, Math.floor(c.height*scale));
          var octx=off.getContext('2d');
          octx.fillStyle='#fff'; octx.fillRect(0,0,off.width,off.height);
          octx.drawImage(c,0,0,off.width,off.height);
          var data=off.toDataURL('image/jpeg',0.55);
          document.getElementById('sig-msg').textContent='Envoi…';
          fetch(location.pathname+'/sign',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({signature:data})})
            .then(function(r){return r.json()}).then(function(j){
              document.getElementById('sig-msg').textContent=j.message||j.error||'';
              if(j.success){ modal.style.display='none'; setTimeout(function(){ location.reload(); }, 600); }
            }).catch(function(){ document.getElementById('sig-msg').textContent='Erreur réseau'; });
        };
        window.addEventListener('resize', function(){ if(modal.style.display==='flex') resize(); });
      })();
      </scr` + `ipt>`
      ));
  // Quotes: never show QR/signing (signPad only for invoices & paid docs)
  const extra = isQuote ? '' : signPad;
  const sigCheck = await validateStoredSignature(inv);
  let sigBar = '';
  if (!isQuote && sigCheck.present) {
    const ok = sigCheck.imageOk && sigCheck.digestOk && sigCheck.docUnchanged;
    let tsLine = '';
    if (inv.timestamp_token) {
      const tv = await verifyAtlasTimestampToken(c.env, String(inv.timestamp_token), inv.signed_doc_hash || undefined, c.env.DB);
      tsLine = tv.ok
        ? `<div style="margin-top:4px"> Horodatage cryptographique valide · ${inv.timestamp_at || tv.token?.t || ''} · profil PAdES-B-T (aligné)</div>`
        : `<div style="margin-top:4px;color:#8b2e2e"> Horodatage à vérifier (${tv.reason || 'erreur'})</div>`;
    }
    sigBar = `<div style="border:1px solid ${ok ? '#6366f1' : '#8b2e2e'};background:${ok ? '#f3f8f3' : '#fdf2f2'};padding:10px 14px;margin:0 0 12px;border-radius:6px;font-size:12px;line-height:1.45">
      <strong>${ok ? '✓ Signature numérique valide' : '⚠ Signature à vérifier'}</strong>
      <div style="margin-top:4px">${sigCheck.message}</div>
      ${sigCheck.signedAt ? `<div style="color:#555;margin-top:2px">Signé le ${sigCheck.signedAt}</div>` : ''}
      ${tsLine}
    </div>`;
  }
  const statusLabel = isQuote ? 'Devis' : isRefund ? 'Avoir / WR' : isQuickSale ? (isPaid ? 'Vente encaissée' : 'Vente rapide') : isPaid ? 'Soldée' : inv.status === 'partial' ? 'Partielle' : 'En cours';
  const statusColor = isPaid ? '#6366f1' : isQuote ? '#5c4a1f' : due > 0.001 ? '#8b2e2e' : '#0f1b2d';
  const lineCount = (items || []).length;
  const qtySum = ((items || []) as any[]).reduce((s, it) => s + Number(it.quantity || 0), 0);
  const clientBits = [
    inv.client_name ? `<strong>${String(inv.client_name).replace(/</g,'')}</strong>` : '',
    inv.client_ice ? `ICE ${inv.client_ice}` : '',
    inv.client_phone ? `Tél. ${inv.client_phone}` : '',
    inv.client_email ? inv.client_email : '',
    [inv.client_address, inv.client_city].filter(Boolean).join(', '),
  ].filter(Boolean).join(' · ');
  const docTypeHint = isQuickSale
    ? 'Vente rapide (caisse) — ticket sans TVA, série VR, distinct d’une facture FA.'
    : isQuote
      ? 'Devis estimatif — non comptabilisé tant qu’il n’est pas converti en facture.'
      : isRefund
        ? 'Avoir / remboursement (WR) lié à une facture d’origine.'
        : 'Facture de vente formalisée — pièce comptable.';
  const verifyBar = `<div style="background:${isQuickSale ? '#1a1d26' : '#0f1b2d'};color:#fff;padding:16px 18px;margin:0 0 14px;border-radius:12px;font-size:13px;line-height:1.5">
    <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:flex-start;justify-content:space-between">
      <div style="max-width:34rem">
        <strong style="font-size:15px">${isQuickSale ? 'Ticket de vente authentifié' : 'Document authentifié'}</strong>
        <div style="opacity:0.95;margin-top:6px;font-size:12px">${settings?.company_name || 'Émetteur'} ${settings?.ice ? '· ICE ' + settings.ice : ''} ${settings?.phone ? '· ' + settings.phone : ''}</div>
        <div style="opacity:0.88;margin-top:4px;font-size:12px">Réf. <strong>${inv.number || '—'}</strong> · ${inv.issue_date || ''} · vérifié le ${new Date().toLocaleString('fr-FR')}</div>
        <div style="opacity:0.9;margin-top:8px;font-size:12px;padding:8px 10px;background:rgba(255,255,255,0.1);border-radius:8px">${docTypeHint}</div>
        ${clientBits ? `<div style="margin-top:8px;font-size:12px"><span style="opacity:.8">Client :</span> ${clientBits}</div>` : ''}
        <div style="margin-top:6px;font-size:12px;opacity:.9">
          Montant${isQuickSale ? '' : ' TTC'} : <strong>${Math.round(total).toLocaleString('fr-FR')} ${cur}</strong>
          ${!isQuote ? ` · Payé : <strong>${Math.round(paid).toLocaleString('fr-FR')} ${cur}</strong> · Reste : <strong>${Math.round(due).toLocaleString('fr-FR')} ${cur}</strong>` : ''}
        </div>
        <div style="margin-top:4px;font-size:11px;opacity:.8">${lineCount} ligne(s) · qté totale ${qtySum}</div>
      </div>
      <span style="background:${statusColor};color:#fff;padding:8px 14px;border-radius:999px;font-weight:800;font-size:12px;white-space:nowrap">${statusLabel}</span>
    </div>
    <div style="margin-top:14px;display:flex;flex-wrap:wrap;gap:8px" class="no-print">
      <button type="button" onclick="window.print()" style="background:#fff;color:${isQuickSale ? '#1a1d26' : '#0f1b2d'};border:0;padding:8px 14px;border-radius:8px;font-weight:700;font-size:12px;cursor:pointer">Imprimer / PDF</button>
      <button type="button" onclick="navigator.clipboard&&navigator.clipboard.writeText(location.href)" style="background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.35);padding:8px 12px;border-radius:8px;font-weight:600;font-size:12px;cursor:pointer">Copier le lien sécurisé</button>
    </div>
    <p style="margin:12px 0 0;font-size:11px;opacity:0.8">Lien issu du QR Atlas Commerce. Vérifie l’émetteur, le numéro, le client et le montant. Ne partagez pas ce lien publiquement si le document est confidentiel.</p>
  </div>`;
  const out = html
    .replace(/<body([^>]*)>/, `<body$1>${verifyBar}${sigBar}${banner}`)
    .replace('</body>', extra + '</body>');
  return c.html(out);
});

/**
 * Unified QR verification entry — scan-friendly + HMAC token support.
 * GET /api/public/verify?doc=invoice&t=TOKEN|v1.invoice.TOKEN.exp.mac
 * GET /api/public/verify?p=v1.invoice.TOKEN.exp.mac  (compact single param)
 * GET /api/public/verify?doc=receipt&t=...
 * GET /api/public/verify?doc=client&t=v2.invoice.TOKEN.exp.kid.mac
 */

/** Self-hosted QR (SVG) — no third-party image API */

app.post('/api/admin/revoke-public-token', async (c) => {
  let body: any = {};
  try { body = await c.req.json(); } catch { /* */ }
  const id = Number(body.invoice_id || 0);
  if (!id) return c.json({ success: false, error: 'invoice_id requis' }, 400);
  const neu = Array.from(crypto.getRandomValues(new Uint8Array(12))).map((b) => b.toString(16).padStart(2, '0')).join('');
  await c.env.DB.prepare(`UPDATE invoices SET public_token = ? WHERE id = ?`).bind(neu, id).run();
  try {
    await c.env.DB.prepare(
      `INSERT INTO audit_log (action, entity, entity_id, detail, created_at) VALUES ('revoke_public_token','invoice',?, 'rotated', datetime('now'))`
    ).bind(id).run();
  } catch { /* */ }
  return c.json({ success: true, message: 'Ancien QR situation invalidé. Réimprimez le document pour un nouveau lien.' });
});


/** Per-receipt: enable/disable client situation QR (global setting stays independent) */
app.patch('/api/receipts/:id/client-situation', async (c) => {
  const id = c.req.param('id');
  await ensureReceiptSituationColumn(c.env.DB);
  let body: any = {};
  try { body = await c.req.json(); } catch { /* */ }
  const on = body.enabled === true || body.enabled === 1 || body.enabled === '1' ? 1 : 0;
  const row = await c.env.DB.prepare(`SELECT id FROM receipts WHERE id = ?`).bind(id).first();
  if (!row) return c.json({ success: false, error: 'Reçu introuvable' }, 404);
  await c.env.DB.prepare(`UPDATE receipts SET include_client_situation = ? WHERE id = ?`).bind(on, id).run();
  return c.json({
    success: true,
    data: { include_client_situation: on },
    message: on
      ? 'QR situation client activé pour ce reçu uniquement. Réimprimez pour le voir.'
      : 'QR situation désactivé pour ce reçu.',
  });
});


app.get('/api/public/qr.svg', async (c) => {
  const data = String(c.req.query('d') || c.req.query('data') || '').slice(0, 1200);
  const size = Math.min(240, Math.max(80, Number(c.req.query('s') || 120) || 120));
  if (!data) return c.text('missing data', 400);
  const ip = c.req.header('cf-connecting-ip') || 'unknown';
  if (await publicRateLimit(c.env, `qr:${ip}`, 60, 60)) return c.text('rate limit', 429);
  const svg = qrToSvg(data, size, 3);
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
});


app.get('/api/public/verify', async (c) => {
  const origin = new URL(c.req.url).origin;
  const compact = String(c.req.query('p') || '').trim();
  let doc = String(c.req.query('doc') || '').toLowerCase();
  let t = String(c.req.query('t') || c.req.query('token') || '').trim();

  // Compact signed payload in ?p=
  if (compact) {
    const parsed = await parseSecureQrPayload(c.env, compact, c.env.DB);
    if (!parsed.ok) {
      return c.html(verifyErrorPage('QR invalide', `Jeton de sécurité refusé (${parsed.reason}).`), 401);
    }
    doc = parsed.type;
    t = parsed.token;
  } else if (t.startsWith('v1.')) {
    const parsed = await parseSecureQrPayload(c.env, t, c.env.DB);
    if (!parsed.ok) {
      return c.html(verifyErrorPage('QR invalide', `Jeton de sécurité refusé (${parsed.reason}).`), 401);
    }
    doc = parsed.type;
    t = parsed.token;
  }

  if (!doc) doc = 'invoice';

  if (doc === 'invoice' || doc === 'facture' || doc === 'devis') {
    if (!t) {
      return c.html(verifyErrorPage('Jeton manquant', 'Ce QR ne contient pas de référence de document.'), 400);
    }
    return c.redirect(`${origin}/api/public/invoices/${encodeURIComponent(t)}`, 302);
  }

  if (doc === 'receipt' || doc === 'recu' || doc === 'reçu') {
    if (!t) {
      return c.html(verifyErrorPage('Jeton manquant', 'Ce QR ne contient pas de référence de reçu.'), 400);
    }
    await ensureReceiptsTable(c.env.DB);
    await ensureReceiptPublicToken(c.env.DB);
    const receipt = await c.env.DB.prepare(`SELECT * FROM receipts WHERE public_token = ?`).bind(t).first() as any;
    if (!receipt) {
      return c.html(verifyErrorPage('Reçu introuvable', 'Lien invalide ou document supprimé.'), 404);
    }
    return c.html(await renderPublicReceiptVerify(c.env.DB, receipt, origin));
  }

  if (doc === 'client' || doc === 'status') {
    let tokenParam = String(t || c.req.query('p') || '').trim();
    if (!tokenParam) {
      return c.html(verifyErrorPage('Jeton manquant', 'La situation client n’est accessible que via un QR Atlas signé (reçu ou facture).'), 400);
    }
    // Signed payload v2… → extract public_token
    if (tokenParam.startsWith('v2.') || tokenParam.startsWith('v1.')) {
      const parsed = await parseSecureQrPayload(c.env, tokenParam, c.env.DB);
      if (!parsed.ok) {
        return c.html(verifyErrorPage('QR invalide', 'Jeton de sécurité refusé ou expiré.'), 401);
      }
      tokenParam = parsed.token;
    }
    return c.redirect(`${origin}/api/public/client-status?t=${encodeURIComponent(tokenParam)}`, 302);
  }

  return c.html(verifyErrorPage('Type inconnu', 'Ce QR ne correspond pas à un type de document supporté.'), 400);
});

function verifyErrorPage(title: string, message: string): string {
  const t = escapeHtml(title);
  const m = escapeHtml(message);
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${t}</title>
<style>body{font-family:system-ui,sans-serif;max-width:440px;margin:0 auto;padding:40px 20px;color:#1a1814;line-height:1.5;background:#faf8f4}
.card{background:#fff;border:1px solid #e0d9cc;border-radius:16px;padding:24px;text-align:center}
h1{font-size:1.2rem;margin:0 0 10px}p{margin:0 0 12px;color:#9aa3b5;font-size:14px}
.hint{font-size:12px;color:#8a9690;margin-top:16px}</style></head>
<body><div class="card">
  <h1>${t}</h1>
  <p>${m}</p>
  <p class="hint">Scannez uniquement un QR Atlas Commerce imprimé sur une facture ou un reçu officiel. Vérifiez que l’adresse du site correspond à votre fournisseur.</p>
</div></body></html>`;
}

async function ensureReceiptPublicToken(db: D1Database) {
  await schemaOnce('ensureReceiptPublicToken', async () => {
  await addColumnIfMissing(db, 'receipts', 'public_token', `TEXT`);

  });
}

async function renderPublicReceiptVerify(db: D1Database, receipt: any, origin: string): Promise<string> {
  const settings = await db.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const cur = settings?.currency || 'MAD';
  const fmt = (n: number) => Math.round(Number(n || 0)).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  let invNum = '';
  if (receipt.invoice_id) {
    const inv = await db.prepare(`SELECT number FROM invoices WHERE id = ?`).bind(receipt.invoice_id).first() as any;
    invNum = inv?.number || '';
  }
  const method = receipt.payment_method || '—';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Vérification reçu ${receipt.number || ''}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:28px 20px;color:#000;line-height:1.45}
.badge{display:inline-block;background:#1a1d26;color:#fff;padding:6px 12px;border-radius:4px;font-size:12px;font-weight:700;letter-spacing:.04em}
.card{border:1px solid #e2e8f0;border-radius:8px;padding:18px;margin-top:16px;background:#fff}
.amt{font-size:28px;font-weight:800;margin:8px 0}
.muted{color:#4a6;font-size:13px}
.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e0ebe5;font-size:14px}
</style></head><body>
  <span class="badge">✓ REÇU VÉRIFIÉ</span>
  <h1 style="font-size:1.35rem;margin:14px 0 4px">${escapeHtml(settings?.company_name || 'Société')}</h1>
  <p class="muted">Page publique d'authentification · ${escapeHtml(new Date().toLocaleString('fr-FR'))}</p>
  <div class="card">
    <div class="muted">N° reçu</div>
    <div style="font-size:18px;font-weight:700">${escapeHtml(receipt.number || '—')}</div>
    <div class="amt">${fmt(Number(receipt.amount))} ${escapeHtml(cur)}</div>
    <div class="row"><span>Client</span><strong>${escapeHtml(receipt.client_name || '—')}</strong></div>
    <div class="row"><span>Date</span><strong>${escapeHtml(receipt.issue_date || '—')}</strong></div>
    <div class="row"><span>Mode</span><strong>${escapeHtml(method)}</strong></div>
    ${invNum ? `<div class="row"><span>Facture liée</span><strong>${escapeHtml(invNum)}</strong></div>` : ''}
  </div>
  <p class="muted" style="margin-top:20px">Ce document prouve un encaissement enregistré dans Atlas Commerce. Conservez-le avec vos pièces comptables.</p>
</body></html>`;
}

app.get('/api/public/company', async (c) => {
  const settings = await c.env.DB.prepare(
    `SELECT company_name, city, country, logo_url, currency FROM company_settings WHERE id = 1`
  ).first();
  return c.json({ success: true, data: settings });
});



app.get('/api/public/client-status', async (c) => {
  const ip = c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || 'unknown';
  if (await publicRateLimit(c.env, `status:${ip}`, 20, 60)) {
    return c.html(verifyErrorPage('Trop de requêtes', 'Réessayez dans une minute.'), 429);
  }
  const t = String(c.req.query('t') || c.req.query('token') || '').trim();
  const compact = String(c.req.query('p') || '').trim();
  let token = t;
  if (compact || (t && (t.startsWith('v2.') || t.startsWith('v1.')))) {
    const parsed = await parseSecureQrPayload(c.env, compact || t, c.env.DB);
    if (!parsed.ok) {
      return c.html(verifyErrorPage('QR invalide ou expiré', 'Ce lien de situation n’est plus valide. Demandez un nouveau reçu.'), 401);
    }
    token = parsed.token;
  }
  if (!token) {
    return c.html(verifyErrorPage('Accès refusé', 'Ouvrez ce lien uniquement depuis un QR Atlas signé.'), 401);
  }
  await ensureInvoicePublicToken(c.env.DB);
  await ensureQrPrivacySettings(c.env.DB);
  await ensureReceiptsTable(c.env.DB);
  let seed = await c.env.DB.prepare(
    `SELECT id, client_id, client_name, public_token FROM invoices WHERE public_token = ?`
  ).bind(token).first() as any;
  if (!seed) {
    // Receipt-scoped situation QR (no invoice or invoice token missing at print time)
    const rec = await c.env.DB.prepare(
      `SELECT r.id, r.client_name, r.invoice_id, i.client_id AS inv_client_id, i.client_name AS inv_client_name
       FROM receipts r
       LEFT JOIN invoices i ON i.id = r.invoice_id
       WHERE r.public_token = ?`
    ).bind(token).first() as any;
    if (rec) {
      seed = {
        id: rec.invoice_id || rec.id,
        client_id: rec.inv_client_id || null,
        client_name: rec.inv_client_name || rec.client_name || '',
        public_token: token,
      };
    }
  }
  if (!seed) {
    return c.html(verifyErrorPage('Lien invalide', 'Document introuvable ou jeton révoqué. Réimprimez le reçu après mise à jour.'), 404);
  }

  // Audit (no long-term IP storage — hash prefix only)
  try {
    const ipHash = (ip || '').slice(0, 8);
    await c.env.DB.prepare(
      `INSERT INTO audit_log (action, entity, entity_id, detail, created_at) VALUES (?, ?, ?, ?, datetime('now'))`
    ).bind('public_situation_open', 'invoice', seed.id, `token_ok ip8=${ipHash}`).run();
  } catch { /* audit table may vary */ }

  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const cur = settings?.currency || 'MAD';
  const fmt = (n: number) => Math.round(Number(n || 0)).toLocaleString('fr-FR');
  const company = settings?.company_name || 'Atlas Commerce';
  const origin = new URL(c.req.url).origin;

  // Aggregates only — no product lines, no phone/ICE/address
  let invoices: any[] = [];
  if (seed.client_id) {
    const { results } = await c.env.DB.prepare(
      `SELECT number, issue_date, status, total, amount_paid, doc_kind
       FROM invoices WHERE client_id = ? AND status NOT IN ('quote','devis','cancelled')
       ORDER BY issue_date DESC LIMIT 50`
    ).bind(seed.client_id).all();
    invoices = results || [];
  } else {
    const { results } = await c.env.DB.prepare(
      `SELECT number, issue_date, status, total, amount_paid, doc_kind
       FROM invoices WHERE lower(client_name) = lower(?) AND status NOT IN ('quote','devis','cancelled')
       ORDER BY issue_date DESC LIMIT 50`
    ).bind(seed.client_name || '').all();
    invoices = results || [];
  }

  let totalDue = 0, totalPaid = 0, totalTTC = 0, totalCredits = 0;
  const rows = invoices.map((inv: any) => {
    const paid = Number(inv.amount_paid || 0);
    const total = Number(inv.total || 0);
    const isWr = inv.doc_kind === 'remboursement' || String(inv.number || '').startsWith('WR');
    if (isWr) {
      totalCredits += total;
      return `<tr><td>${inv.number || ''}</td><td>${inv.issue_date || ''}</td><td style="text-align:right">−${fmt(total)}</td><td style="text-align:right">—</td><td style="text-align:right;color:#6366f1">0</td><td>Avoir</td></tr>`;
    }
    const due = Math.max(0, total - paid);
    totalPaid += paid;
    totalTTC += total;
    totalDue += due;
    const st = due <= 0.001 ? 'Soldée' : paid > 0 ? 'Partielle' : 'En cours';
    return `<tr>
      <td>${inv.number || ''}</td>
      <td>${inv.issue_date || ''}</td>
      <td style="text-align:right">${fmt(total)}</td>
      <td style="text-align:right">${fmt(paid)}</td>
      <td style="text-align:right;font-weight:700;color:${due > 0.001 ? '#8b2e2e' : '#6366f1'}">${fmt(due)}</td>
      <td>${st}</td>
    </tr>`;
  }).join('');

  const displayName = (seed.client_name || 'Client').split(' ')[0] + (String(seed.client_name || '').includes(' ') ? ' …' : '');

  return c.html(`<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Situation — ${company}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:640px;margin:12px auto;padding:0 12px;color:#1a1814;position:relative}
.wm{position:fixed;inset:0;pointer-events:none;display:flex;align-items:center;justify-content:center;z-index:0;opacity:0.06;font-size:48px;font-weight:800;transform:rotate(-24deg);color:#000;text-transform:uppercase}
main{position:relative;z-index:1}
.stat{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin:16px 0}
.stat div{border:1px solid #ddd;border-radius:10px;padding:12px}
.stat .l{font-size:11px;color:#666;text-transform:uppercase}
.stat .v{font-size:20px;font-weight:700;margin-top:4px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:8px 6px;border-bottom:1px solid #eee;text-align:left}
th{font-size:11px;color:#666}
.foot{margin-top:24px;font-size:12px;color:#666;line-height:1.45}
a{color:#000}
</style></head>
<body>
<div class="wm" aria-hidden="true">Confidentiel</div>
<main>
  <p style="font-size:12px;color:#666">${company}</p>
  <h1 style="font-size:22px;margin:4px 0 0">Situation client — synthèse (montants)</h1>
  <p style="font-size:14px;color:#444">Client : <strong>${displayName}</strong> — montants uniquement, sans détail produits ni coordonnées.</p>
  <div class="stat">
    <div><div class="l">Facturé</div><div class="v">${fmt(totalTTC)} ${cur}</div></div>
    <div><div class="l">Payé</div><div class="v" style="color:#6366f1">${fmt(totalPaid)} ${cur}</div></div>
    <div><div class="l">Reste dû</div><div class="v" style="color:${totalDue > 0.001 ? '#8b2e2e' : '#6366f1'}">${fmt(totalDue)} ${cur}</div></div>
  </div>
  ${totalCredits > 0.001 ? `<p style="font-size:13px">Avoirs (WR) : ${fmt(totalCredits)} ${cur}</p>` : ''}
  <table>
    <thead><tr><th>N°</th><th>Date</th><th style="text-align:right">TTC</th><th style="text-align:right">Payé</th><th style="text-align:right">Reste</th><th>Statut</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6">Aucune pièce</td></tr>'}</tbody>
  </table>
  <div class="foot">
    <p>Document confidentiel — lien signé et à durée limitée. Ne pas diffuser publiquement.</p>
    <p><a href="${origin}/privacy">Politique de confidentialité</a> · Données traitées dans le cadre de la relation commerciale (loi 09-08 / CNDP).</p>
  </div>
</main>
</body></html>`);
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

app.post('/api/admin/rotate-hmac-keys', async (c) => {
  const body = await c.req.json().catch(() => ({})) as any;
  if (body.hmac_rotate_days != null) {
    await ensureHmacKeyColumns(c.env.DB);
    const days = Math.max(7, Math.min(365, Number(body.hmac_rotate_days) || 90));
    await c.env.DB.prepare(`UPDATE company_settings SET hmac_rotate_days = ? WHERE id = 1`).bind(days).run();
  }
  const result = await publicTokenSecretsAsync(c.env, c.env.DB, { forceRotate: true });
  return c.json({
    success: true,
    message: result.rotated
      ? 'Clés HMAC renouvelées. Nouveaux QR = clé actuelle ; anciens QR = clé précédente.'
      : 'Rotation non effectuée.',
    data: { rotated: result.rotated, rotated_at: result.rotatedAt, previous_retained: !!result.previous },
  });
});

app.get('/api/admin/hmac-status', async (c) => {
  await ensureHmacKeyColumns(c.env.DB);
  const row = await c.env.DB.prepare(
    `SELECT hmac_rotated_at, hmac_rotate_days, hmac_secret_current, hmac_secret_previous FROM company_settings WHERE id = 1`,
  ).first() as any;
  const days = Number(row?.hmac_rotate_days || 90);
  const rotatedAt = row?.hmac_rotated_at ? new Date(row.hmac_rotated_at).getTime() : 0;
  const nextDue = rotatedAt ? new Date(rotatedAt + days * 86400000).toISOString() : null;
  return c.json({
    success: true,
    data: {
      configured: !!(row?.hmac_secret_current),
      has_previous: !!(row?.hmac_secret_previous),
      rotated_at: row?.hmac_rotated_at || null,
      rotate_days: days,
      next_rotation_due: nextDue,
      auto_rotate: true,
    },
  });
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
  await invalidateDashboardCache(c.env.CACHE);
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

app.get('/api/settings/invoice-preview', async (c) => {
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const type = String(c.req.query('type') || 'invoice').toLowerCase();
  const pad = Math.min(8, Math.max(3, Number(settings?.numbering_pad || 4)));
  const tax = Number(settings?.tax_rate ?? 20);
  const company = settings?.company_name || 'Atlas Commerce';
  const DISCLAIMER = 'Document d’aperçu. Les montants réels proviennent de votre dernier enregistrement quand il existe. Ceci n’est pas une pièce comptable à remettre au client. Le QR reprend le résumé (type, numéro, partie, totaux) tel qu’il apparaîtra sur le PDF.';

  const sampleItems = [
    { product_name: 'Article exemple', sku: 'EX-01', quantity: 1, unit_price: 100, tax_rate: tax, line_total: 100 * (1 + tax / 100) },
  ];

  async function latest(sql: string, ...binds: unknown[]) {
    try {
      return await c.env.DB.prepare(sql).bind(...binds).first() as any;
    } catch {
      return null;
    }
  }
  async function lines(sql: string, id: number) {
    try {
      const r = await c.env.DB.prepare(sql).bind(id).all();
      return (r.results || []) as any[];
    } catch {
      return [];
    }
  }

  const titles: Record<string, string> = {
    invoice: 'FACTURE', quote: 'DEVIS', receipt: 'REÇU', bill: "FACTURE D'ACHAT", credit: 'AVOIR',
  };

  if (type === 'report') {
    const body = `<h2 style="margin:0 0 12px">Rapport — ${company}</h2>
      <p>TVA configurée : ${tax}% · devise ${settings?.currency || 'MAD'}</p>
      <p style="border:1px solid #000;padding:8px;background:#fff8e8"><strong>Avertissement.</strong> ${DISCLAIMER}</p>`;
    return c.html(reportShell('Rapport', company, 'Aperçu', body, settings?.report_footer || settings?.notes));
  }
  if (type === 'employee') {
    let emp: any = null;
    try { emp = await latest(`SELECT * FROM employees ORDER BY id DESC LIMIT 1`); } catch { emp = null; }
    const name = emp?.full_name || emp?.name || emp?.display_name || 'Aucun employé enregistré';
    const body = `<h2>Fiche employé</h2>
      <p><strong>${name}</strong>${emp?.job_title ? ' · ' + emp.job_title : ''}</p>
      <p>${emp ? 'Dernière fiche réelle de votre base.' : 'Aucun employé — aperçu vide.'}</p>
      <p style="border:1px solid #000;padding:8px;background:#fff8e8"><strong>Avertissement.</strong> ${DISCLAIMER}</p>`;
    return c.html(reportShell('Fiche employé', company, emp?.employee_number || '—', body, settings?.report_footer || ''));
  }

  let doc: any = null;
  let items: any[] = [];
  let real = false;
  if (type === 'bill') {
    doc = await latest(`SELECT * FROM bills ORDER BY id DESC LIMIT 1`);
    if (doc?.id) { items = await lines(`SELECT * FROM bill_items WHERE bill_id = ?`, doc.id); real = true; }
  } else if (type === 'receipt') {
    doc = await latest(`SELECT * FROM receipts ORDER BY id DESC LIMIT 1`);
    if (doc) {
      real = true;
      items = [{ product_name: doc.notes || 'Règlement', sku: '', quantity: 1, unit_price: Number(doc.amount || 0), tax_rate: 0, line_total: Number(doc.amount || 0) }];
      doc = {
        ...doc,
        client_name: doc.client_name,
        subtotal: Number(doc.amount || 0),
        tax_amount: 0,
        total: Number(doc.amount || 0),
        amount_paid: Number(doc.amount || 0),
        status: 'paid',
        issue_date: doc.issue_date,
      };
    }
  } else if (type === 'quote') {
    doc = await latest(`SELECT * FROM invoices WHERE status IN ('quote','devis') ORDER BY id DESC LIMIT 1`);
    if (doc?.id) { items = await lines(`SELECT * FROM invoice_items WHERE invoice_id = ?`, doc.id); real = true; }
  } else if (type === 'credit') {
    doc = await latest(`SELECT * FROM invoices WHERE number LIKE 'WR%' OR status IN ('refund','credit','avoir') ORDER BY id DESC LIMIT 1`);
    if (doc?.id) { items = await lines(`SELECT * FROM invoice_items WHERE invoice_id = ?`, doc.id); real = true; }
  } else {
    doc = await latest(`SELECT * FROM invoices WHERE IFNULL(status,'') NOT IN ('quote','devis') ORDER BY id DESC LIMIT 1`);
    if (doc?.id) { items = await lines(`SELECT * FROM invoice_items WHERE invoice_id = ?`, doc.id); real = true; }
  }

  const prefix = (type === 'quote' ? settings?.quote_prefix : type === 'bill' ? settings?.bill_prefix : type === 'receipt' ? settings?.receipt_prefix : type === 'credit' ? settings?.credit_prefix : settings?.invoice_prefix) || '';
  const title = titles[type] || titles.invoice;
  if (!doc) {
    const ht = 100;
    const taxAmt = Math.round(ht * (tax / 100) * 100) / 100;
    doc = {
      number: `${prefix || 'DEMO-'}${String(1).padStart(pad, '0')}`,
      issue_date: new Date().toISOString().slice(0, 10),
      status: 'draft',
      client_name: 'Client exemple (aucun document en base)',
      client_ice: settings?.ice || '',
      client_city: settings?.city || '',
      subtotal: ht,
      tax_amount: taxAmt,
      total: ht + taxAmt,
      amount_paid: 0,
      notes: '',
    };
    items = sampleItems.map((it) => ({ ...it, line_total: it.quantity * it.unit_price * (1 + tax / 100) }));
  }

  const summary = [
    'ATLAS COMMERCE',
    title,
    String(doc.number || ''),
    `Partie: ${doc.client_name || doc.vendor_name || '—'}`,
    `Total: ${Number(doc.total || 0).toFixed(2)} ${settings?.currency || 'MAD'}`,
    `Emetteur: ${company}`,
    real ? 'Source: dernier document enregistré' : 'Source: modele (aucun document)',
    'Apercu non contractuel',
  ].join('\n');

  doc.preview_qr = true;
  doc.preview_qr_text = summary;
  // v0.7 — Reçu : l'aperçu peut montrer (ou non) le QR « situation client »,
  // choisi dans l'app via ?qr_situation=1|0 (défaut = réglage de l'entreprise).
  if (type === 'receipt') {
    const qsSit = String(c.req.query('qr_situation') || '').toLowerCase();
    const sitOn = qsSit === '1' || qsSit === 'true'
      ? true
      : qsSit === '0' || qsSit === 'false'
        ? false
        : Number(settings?.qr_client_situation ?? 0) === 1;
    if (sitOn) {
      doc.preview_situation_qr = true;
      doc.preview_situation_text = [
        'ATLAS COMMERCE — SITUATION CLIENT (APERCU)',
        `Partie: ${doc.client_name || doc.vendor_name || '—'}`,
        `Total du recu: ${Number(doc.total || 0).toFixed(2)} ${settings?.currency || 'MAD'}`,
        "Exemple de QR situation tel qu'imprime sur le recu reel si l'option est activee.",
        'Apercu non contractuel',
      ].join('\n');
    }
  }
  doc.preview_banner = DISCLAIMER + (real ? ' Données : dernier document réel de ce type.' : ' Aucun document de ce type — modèle avec votre société et un article exemple.');

  return c.html(generateInvoiceHTML(settings, doc, items.length ? items : sampleItems, title, false));
});

/* ─── Categories & Units ─── */

const DEFAULT_CATEGORIES: { name: string; description: string; sort_order: number }[] = [
  { name: 'Général', description: 'Catégorie par défaut', sort_order: 0 },
  { name: 'Alimentation', description: 'Produits alimentaires', sort_order: 10 },
  { name: 'Boissons', description: 'Boissons et liquides', sort_order: 20 },
  { name: 'Électronique', description: 'Appareils et composants électroniques', sort_order: 30 },
  { name: 'Informatique', description: 'Matériel et accessoires informatiques', sort_order: 40 },
  { name: 'Vêtements', description: 'Textile et habillement', sort_order: 50 },
  { name: 'Cosmétiques', description: 'Beauté et soins', sort_order: 60 },
  { name: 'Quincaillerie', description: 'Outils et quincaillerie', sort_order: 70 },
  { name: 'Fournitures de bureau', description: 'Papeterie et bureau', sort_order: 80 },
  { name: 'Hygiène', description: 'Produits d\'hygiène et entretien', sort_order: 90 },
  { name: 'Emballage', description: 'Conditionnement et emballage', sort_order: 100 },
  { name: 'Matières premières', description: 'Matières premières', sort_order: 110 },
  { name: 'Pièces détachées', description: 'Pièces et rechanges', sort_order: 120 },
  { name: 'Services', description: 'Prestations de service', sort_order: 130 },
  { name: 'Autre', description: 'Divers', sort_order: 999 },
];

const DEFAULT_UNITS: { name: string; symbol: string; sort_order: number }[] = [
  { name: 'unité', symbol: 'u', sort_order: 0 },
  { name: 'pièce', symbol: 'pce', sort_order: 10 },
  { name: 'kg', symbol: 'kg', sort_order: 20 },
  { name: 'g', symbol: 'g', sort_order: 30 },
  { name: 'L', symbol: 'L', sort_order: 40 },
  { name: 'mL', symbol: 'mL', sort_order: 50 },
  { name: 'm', symbol: 'm', sort_order: 60 },
  { name: 'cm', symbol: 'cm', sort_order: 70 },
  { name: 'm²', symbol: 'm²', sort_order: 80 },
  { name: 'm³', symbol: 'm³', sort_order: 90 },
  { name: 'boîte', symbol: 'bte', sort_order: 100 },
  { name: 'carton', symbol: 'ctn', sort_order: 110 },
  { name: 'paquet', symbol: 'paq', sort_order: 120 },
  { name: 'lot', symbol: 'lot', sort_order: 130 },
  { name: 'sac', symbol: 'sac', sort_order: 140 },
  { name: 'bouteille', symbol: 'btl', sort_order: 150 },
  { name: 'pack', symbol: 'pack', sort_order: 160 },
  { name: 'douzaine', symbol: 'dz', sort_order: 170 },
  { name: 'heure', symbol: 'h', sort_order: 180 },
  { name: 'jour', symbol: 'j', sort_order: 190 },
  { name: 'forfait', symbol: 'forf', sort_order: 200 },
  { name: 'service', symbol: 'svc', sort_order: 210 },
];

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


app.get('/api/categories', async (c) => {
  await ensureCategoriesTable(c.env.DB);
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM product_categories ORDER BY sort_order ASC, name ASC`
  ).all();
  const { results: used } = await c.env.DB.prepare(
    `SELECT DISTINCT category as name FROM products WHERE category IS NOT NULL AND TRIM(category) != '' ORDER BY category`
  ).all();
  const names = new Set((results || []).map((r: any) => String(r.name).toLowerCase()));
  const extra = ((used || []) as any[])
    .filter((u) => u.name && !names.has(String(u.name).toLowerCase()))
    .map((u) => ({ id: null, name: u.name, description: '', sort_order: 999, from_products: true }));
  return c.json({ success: true, data: [...(results || []), ...extra] });
});

app.post('/api/categories', async (c) => {
  await ensureCategoriesTable(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  if (!name) return c.json({ success: false, error: 'Nom de catégorie obligatoire' }, 400);
  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO product_categories (name, description, sort_order) VALUES (?, ?, ?)`
    ).bind(name, String(body.description || ''), Number(body.sort_order || 0)).run();
    const row = await c.env.DB.prepare(`SELECT * FROM product_categories WHERE id = ?`).bind(r.meta.last_row_id).first();
    return c.json({ success: true, data: row, message: 'Catégorie créée.' }, 201);
  } catch (e: any) {
    if (String(e?.message || e).includes('UNIQUE')) {
      return c.json({ success: false, error: 'Cette catégorie existe déjà.', code: 'DUPLICATE_CATEGORY' }, 409);
    }
    throw e;
  }
});

app.put('/api/categories/:id', async (c) => {
  await ensureCategoriesTable(c.env.DB);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const existing = await c.env.DB.prepare(`SELECT * FROM product_categories WHERE id = ?`).bind(id).first() as any;
  if (!existing) return c.json({ success: false, error: 'Catégorie introuvable' }, 404);
  const name = body.name !== undefined ? String(body.name).trim() : existing.name;
  if (!name) return c.json({ success: false, error: 'Nom obligatoire' }, 400);
  const description = body.description !== undefined ? String(body.description) : existing.description;
  const sort_order = body.sort_order !== undefined ? Number(body.sort_order) : existing.sort_order;
  await c.env.DB.prepare(
    `UPDATE product_categories SET name = ?, description = ?, sort_order = ? WHERE id = ?`
  ).bind(name, description, sort_order, id).run();
  if (name !== existing.name) {
    await c.env.DB.prepare(`UPDATE products SET category = ? WHERE category = ?`).bind(name, existing.name).run();
  }
  const row = await c.env.DB.prepare(`SELECT * FROM product_categories WHERE id = ?`).bind(id).first();
  return c.json({ success: true, data: row, message: 'Catégorie mise à jour.' });
});

app.delete('/api/categories/:id', async (c) => {
  await ensureCategoriesTable(c.env.DB);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
  if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);

  // id === 'by-name' → delete product-only label (no row in product_categories)
  if (id === 'by-name' || id === '0') {
    const name = String(body.name || '').trim();
    if (!name) return c.json({ success: false, error: 'Nom de catégorie obligatoire' }, 400);
    const row = await c.env.DB.prepare(`SELECT * FROM product_categories WHERE LOWER(name) = LOWER(?)`).bind(name).first() as any;
    if (row) {
      await c.env.DB.prepare(`UPDATE products SET category = NULL WHERE category = ? OR LOWER(category) = LOWER(?)`).bind(row.name, row.name).run();
      await c.env.DB.prepare(`DELETE FROM product_categories WHERE id = ?`).bind(row.id).run();
      return c.json({ success: true, message: `Catégorie « ${row.name} » supprimée.` });
    }
    const cleared = await c.env.DB.prepare(
      `UPDATE products SET category = NULL WHERE category = ? OR LOWER(category) = LOWER(?)`
    ).bind(name, name).run();
    return c.json({
      success: true,
      message: `Libellé « ${name} » retiré des produits.`,
      cleared: cleared.meta?.changes || 0,
    });
  }

  const existing = await c.env.DB.prepare(`SELECT * FROM product_categories WHERE id = ?`).bind(id).first() as any;
  if (!existing) return c.json({ success: false, error: 'Catégorie introuvable' }, 404);
  await c.env.DB.prepare(
    `UPDATE products SET category = NULL WHERE category = ? OR LOWER(category) = LOWER(?)`
  ).bind(existing.name, existing.name).run();
  await c.env.DB.prepare(`DELETE FROM product_categories WHERE id = ?`).bind(id).run();
  return c.json({ success: true, message: `Catégorie « ${existing.name} » supprimée.` });
});

/* ─── Units ─── */

app.get('/api/units', async (c) => {
  await ensureUnitsTable(c.env.DB);
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM product_units ORDER BY sort_order ASC, name ASC`
  ).all();
  const { results: used } = await c.env.DB.prepare(
    `SELECT DISTINCT unit as name FROM products WHERE unit IS NOT NULL AND TRIM(unit) != '' ORDER BY unit`
  ).all();
  const names = new Set((results || []).map((r: any) => String(r.name).toLowerCase()));
  const extra = ((used || []) as any[])
    .filter((u) => u.name && !names.has(String(u.name).toLowerCase()))
    .map((u) => ({ id: null, name: u.name, symbol: '', sort_order: 999, from_products: true }));
  return c.json({ success: true, data: [...(results || []), ...extra] });
});

app.post('/api/units', async (c) => {
  await ensureUnitsTable(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  if (!name) return c.json({ success: false, error: 'Nom d\'unité obligatoire' }, 400);
  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO product_units (name, symbol, sort_order) VALUES (?, ?, ?)`
    ).bind(name, String(body.symbol || ''), Number(body.sort_order || 0)).run();
    const row = await c.env.DB.prepare(`SELECT * FROM product_units WHERE id = ?`).bind(r.meta.last_row_id).first();
    return c.json({ success: true, data: row, message: 'Unité créée.' }, 201);
  } catch (e: any) {
    if (String(e?.message || e).includes('UNIQUE')) {
      return c.json({ success: false, error: 'Cette unité existe déjà.', code: 'DUPLICATE_UNIT' }, 409);
    }
    throw e;
  }
});

app.put('/api/units/:id', async (c) => {
  await ensureUnitsTable(c.env.DB);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const existing = await c.env.DB.prepare(`SELECT * FROM product_units WHERE id = ?`).bind(id).first() as any;
  if (!existing) return c.json({ success: false, error: 'Unité introuvable' }, 404);
  const name = body.name !== undefined ? String(body.name).trim() : existing.name;
  if (!name) return c.json({ success: false, error: 'Nom obligatoire' }, 400);
  const symbol = body.symbol !== undefined ? String(body.symbol) : existing.symbol;
  const sort_order = body.sort_order !== undefined ? Number(body.sort_order) : existing.sort_order;
  await c.env.DB.prepare(
    `UPDATE product_units SET name = ?, symbol = ?, sort_order = ? WHERE id = ?`
  ).bind(name, symbol, sort_order, id).run();
  if (name !== existing.name) {
    await c.env.DB.prepare(`UPDATE products SET unit = ? WHERE unit = ?`).bind(name, existing.name).run();
  }
  const row = await c.env.DB.prepare(`SELECT * FROM product_units WHERE id = ?`).bind(id).first();
  return c.json({ success: true, data: row, message: 'Unité mise à jour.' });
});

app.delete('/api/units/:id', async (c) => {
  await ensureUnitsTable(c.env.DB);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
  if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);

  if (id === 'by-name' || id === '0') {
    const name = String(body.name || '').trim();
    if (!name) return c.json({ success: false, error: 'Nom d\'unité obligatoire' }, 400);
    const row = await c.env.DB.prepare(`SELECT * FROM product_units WHERE LOWER(name) = LOWER(?)`).bind(name).first() as any;
    if (row) {
      await c.env.DB.prepare(`UPDATE products SET unit = 'unité' WHERE unit = ? OR LOWER(unit) = LOWER(?)`).bind(row.name, row.name).run();
      await c.env.DB.prepare(`DELETE FROM product_units WHERE id = ?`).bind(row.id).run();
      return c.json({ success: true, message: `Unité « ${row.name} » supprimée.` });
    }
    await c.env.DB.prepare(`UPDATE products SET unit = 'unité' WHERE unit = ? OR LOWER(unit) = LOWER(?)`).bind(name, name).run();
    return c.json({ success: true, message: `Libellé unité « ${name} » retiré des produits.` });
  }

  const existing = await c.env.DB.prepare(`SELECT * FROM product_units WHERE id = ?`).bind(id).first() as any;
  if (!existing) return c.json({ success: false, error: 'Unité introuvable' }, 404);
  await c.env.DB.prepare(`UPDATE products SET unit = 'unité' WHERE unit = ? OR LOWER(unit) = LOWER(?)`).bind(existing.name, existing.name).run();
  await c.env.DB.prepare(`DELETE FROM product_units WHERE id = ?`).bind(id).run();
  return c.json({ success: true, message: `Unité « ${existing.name} » supprimée.` });
});

/* ─── Products & variants ─── */

/**
 * Variants = child product rows with parent_id set.
 * Each has its own sku, barcode, price, stock (same stock/audit system).
 * Columns: parent_id, variant_label, attributes (JSON e.g. {"size":"M","color":"Rouge"})
 *
 * Mobile / APK barcode flow (ready for future app):
 *   GET  /api/scan/barcode/:code     → lookup by barcode or SKU
 *   POST /api/scan/quick-product     → create product from scanned barcode
 *   POST /api/invoices               → same as web (client adds lines after scan)
 */

async function ensureProductVariantColumns(db: D1Database) {
  await schemaOnce('product_variants', async () => {
  for (const col of [
    `ALTER TABLE products ADD COLUMN parent_id INTEGER DEFAULT NULL`,
    `ALTER TABLE products ADD COLUMN variant_label TEXT DEFAULT ''`,
    `ALTER TABLE products ADD COLUMN attributes TEXT DEFAULT '{}'`,
    `ALTER TABLE products ADD COLUMN tax_rate REAL DEFAULT NULL`,
    `ALTER TABLE products ADD COLUMN bulk_discounts TEXT DEFAULT '[]'`,
    `ALTER TABLE products ADD COLUMN lot_number TEXT`,
    `ALTER TABLE products ADD COLUMN expiry_date TEXT`,
    `ALTER TABLE products ADD COLUMN barcode TEXT DEFAULT ''`,
  ]) {
    try { await db.prepare(col).run(); } catch { /* exists */ }
  }
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku)`).run();
  } catch { /* */ }
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode)`).run();
  } catch { /* */ }
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)`).run();
  } catch { /* */ }
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_products_parent ON products(parent_id)`).run();
  } catch { /* */ }
  });
}

app.get('/api/products', async (c) => {
  void proactiveFtsHealth(c.env.DB);
  // Parse filters first so mobile/light can skip schema DDL (big latency win)
  const q = String(c.req.query('q') || c.req.query('search') || '').trim().toLowerCase();
  const category = String(c.req.query('category') || '').trim();
  const parentId = c.req.query('parent_id');
  const includeVariants = c.req.query('include_variants') === '1';
  const variantsOnly = c.req.query('variants_only') === '1';
  const fields = String(c.req.query('fields') || '').trim().toLowerCase();
  const light = fields === 'mobile' || fields === 'light' || fields === 'id,name,sku,barcode,stock,price';
  if (!light) { try { await ensureProductVariantColumns(c.env.DB); } catch { /* */ } }
  const limit = Math.min(500, Math.max(1, Number(c.req.query('limit') || (light ? 300 : 200))));

  // Full desk path only: schema ensures (mobile never needs them on every list call)
  if (!light) {
    try { await ensureStockLocations(c.env.DB); } catch { /* */ }
    try { await ensureMarbleUnits(c.env.DB); } catch { /* */ }
    await ensureProductVariantColumns(c.env.DB);
  }

  // Cache only stable list queries (no free-text search) to keep KV useful and coherent
  const cacheable = !q && !parentId && !category;
  const cacheKey = await productsCacheKey(
    c.env.CACHE,
    [includeVariants ? 'v' : 'p', variantsOnly ? 'vo' : '', light ? 'm2' : 'f', String(limit)].filter(Boolean).join(':')
  );
  if (cacheable) {
    const hit = await kvGetJson<any>(c.env.CACHE, cacheKey);
    if (hit) {
      return c.json(
        { success: true, data: hit, meta: { cache: 'hit', fields: light ? 'mobile' : 'full' } },
        200,
        { 'Cache-Control': light ? 'private, max-age=60' : 'private, max-age=20' },
      );
    }
  }

  // Speed: mobile/light omits heavy columns AND images (phone never displays photos)
  const cols = light
    ? `id, sku, name, barcode, category, unit, price, stock_quantity, low_stock_threshold, parent_id, variant_label, is_active, track_inventory`
    : `*`;
  let sql = `SELECT ${cols} FROM products WHERE is_active = 1`;
  const binds: any[] = [];
  if (parentId) {
    sql += ` AND parent_id = ?`;
    binds.push(Number(parentId));
  } else if (variantsOnly) {
    sql += ` AND parent_id IS NOT NULL AND parent_id != 0`;
  } else if (!includeVariants) {
    sql += ` AND (parent_id IS NULL OR parent_id = 0)`;
  }
  if (q) {
    // Prefer FTS5 index when available (stronger ranking); fall back to multi-column LIKE
    let usedFts = false;
    try {
      const ok = await ensureProductSearchIndex(c.env.DB);
      if (ok) {
        const ftsQuery = q
          .split(/\s+/)
          .filter(Boolean)
          .map((tok) => `"${tok.replace(/"/g, '')}"*`)
          .join(' ');
        sql += ` AND id IN (SELECT rowid FROM products_fts WHERE products_fts MATCH ?)`;
        binds.push(ftsQuery);
        usedFts = true;
      }
    } catch { /* fall through */ }
    if (!usedFts) {
      sql += ` AND (LOWER(name) LIKE ? OR LOWER(COALESCE(sku,'')) LIKE ? OR LOWER(COALESCE(barcode,'')) LIKE ? OR LOWER(COALESCE(category,'')) LIKE ? OR LOWER(COALESCE(variant_label,'')) LIKE ?)`;
      const like = `%${q}%`;
      binds.push(like, like, like, like, like);
    }
  }
  if (category) {
    sql += ` AND category = ?`;
    binds.push(category);
  }
  sql += ` ORDER BY name LIMIT ?`;
  binds.push(limit);
  let results: any[] = [];
  try {
    const r = await c.env.DB.prepare(sql).bind(...binds).all();
    results = r.results || [];
  } catch (e) {
    console.warn('[products-list] query failed, simple fallback', e);
    // Safe fallback: no FTS, basic active products
    try {
      const r2 = await c.env.DB.prepare(
        `SELECT id, sku, name, barcode, category, unit, price, stock_quantity, low_stock_threshold, parent_id, variant_label, is_active, track_inventory
         FROM products WHERE is_active = 1 ORDER BY name LIMIT ?`,
      ).bind(limit).all();
      results = r2.results || [];
    } catch (e2) {
      console.error('[products-list] fallback failed', e2);
      return apiFail(c, 'Impossible de charger les produits', 'INTERNAL');
    }
  }
  if (cacheable) {
    const ttl = Math.max(90, Number(c.env.CACHE_TTL_SECONDS || DEFAULT_CACHE_TTL));
    await kvPutJson(c.env.CACHE, cacheKey, results, light ? Math.max(ttl, 120) : ttl);
  }
  return c.json(
    { success: true, data: results, meta: { cache: cacheable ? 'miss' : 'bypass', fields: light ? 'mobile' : 'full' } },
    200,
    { 'Cache-Control': light ? 'private, max-age=60' : 'private, max-age=15' },
  );
});

app.get('/api/products/:id', async (c) => {
  await ensureProductVariantColumns(c.env.DB);
  const id = c.req.param('id');
  const product = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(id).first() as any;
  if (!product) return c.json({ success: false, error: 'Produit introuvable' }, 404);
  let variants: any[] = [];
  if (!product.parent_id) {
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM products WHERE parent_id = ? AND is_active = 1 ORDER BY variant_label, name`
    ).bind(id).all();
    variants = results || [];
  }
  return c.json({ success: true, data: { ...product, variants } });
});

app.post('/api/products', async (c) => {
  try { await ensureProductVariantColumns(c.env.DB); } catch { /* */ }
  // cache invalidated after successful write below
  await ensureProductBulkDiscounts(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const verr = validateProductWrite(body);
  if (verr) return apiFail(c, verr.name || Object.values(verr)[0] || 'Validation', 'VALIDATION', verr);
  const { name, sku, description = '', category = 'General', unit = 'unit', price = 0, cost = 0, stock_quantity = 0, low_stock_threshold = 5, track_inventory = 1, image_url = '', barcode = '', tax_rate = null } = body;
  if (!name) return apiFail(c, 'Le nom du produit est obligatoire', 'VALIDATION');

  // Duplicate handling API:
  // Checks: SKU (case-insensitive), barcode (exact), name (case-insensitive).
  // On conflict → HTTP 409, code: DUPLICATE_PRODUCT, fields: error, duplicate, matches[].
  // Override: body.force_duplicate = true
  const force = !!body.force_duplicate;
  const dupChecks: { label: string; row: any }[] = [];
  if (sku) {
    const bySku = await c.env.DB.prepare(`SELECT id, name, sku, barcode FROM products WHERE LOWER(sku) = LOWER(?)`).bind(sku).first();
    if (bySku) dupChecks.push({ label: 'SKU', row: bySku });
  }
  if (barcode) {
    const byBc = await c.env.DB.prepare(`SELECT id, name, sku, barcode FROM products WHERE barcode = ?`).bind(barcode).first();
    if (byBc) dupChecks.push({ label: 'code-barres', row: byBc });
  }
  const byName = await c.env.DB.prepare(`SELECT id, name, sku, barcode FROM products WHERE LOWER(name) = LOWER(?)`).bind(name).first();
  if (byName) dupChecks.push({ label: 'nom', row: byName });
  if (dupChecks.length && !force) {
    const first = dupChecks[0];
    return c.json({
      success: false,
      code: 'DUPLICATE_PRODUCT',
      force_required: true,
      error: `Produit en doublon (${first.label}) : « ${first.row.name} » (id ${first.row.id}). Passez force_duplicate=true pour créer quand même.`,
      hint: 'Envoyez force_duplicate=true pour forcer la création, ou mettez à jour le produit existant via PUT /api/products/:id.',
      duplicate: { id: first.row.id, name: first.row.name, sku: first.row.sku, barcode: first.row.barcode },
      matches: dupChecks.map((d) => ({ on: d.label, id: d.row.id, name: d.row.name, sku: d.row.sku, barcode: d.row.barcode })),
    }, 409);
  }

  let bulkJson = '[]';
  if (body.bulk_discounts !== undefined) {
    const parsed = parseBulkDiscounts(body.bulk_discounts);
    bulkJson = JSON.stringify(parsed);
  }

  const postCols = await tableColumns(c.env.DB, 'products');
  const insertCols = ['sku', 'name', 'description', 'category', 'unit', 'price', 'cost', 'stock_quantity', 'low_stock_threshold', 'track_inventory', 'image_url', 'barcode', 'tax_rate', 'bulk_discounts'];
  const insertVals: any[] = [sku || null, name, description, category, unit, price, cost, stock_quantity, low_stock_threshold, track_inventory, image_url, barcode, tax_rate, bulkJson];
  const useCols: string[] = [];
  const useVals: any[] = [];
  insertCols.forEach((colName, i) => {
    if (postCols && !postCols.has(colName)) return;
    useCols.push(colName);
    useVals.push(insertVals[i]);
  });
  const result = await c.env.DB.prepare(
    `INSERT INTO products (${useCols.join(', ')}) VALUES (${useCols.map(() => '?').join(', ')})`
  ).bind(...useVals).run();

  try { await addColumnIfMissing(c.env.DB, 'products', 'lot_number', `TEXT`); } catch { /* non-fatal */ }
  try { await addColumnIfMissing(c.env.DB, 'products', 'expiry_date', `TEXT`); } catch { /* non-fatal */ }
  {
    const lot_number = body.lot_number != null ? String(body.lot_number).slice(0, 64) : '';
    const expiry_date = body.expiry_date != null ? String(body.expiry_date).slice(0, 32) : '';
    if (lot_number || expiry_date) {
      try {
        await c.env.DB.prepare(`UPDATE products SET lot_number = ?, expiry_date = ? WHERE id = ?`)
          .bind(lot_number || null, expiry_date || null, result.meta.last_row_id).run();
      } catch { /* */ }
    }
  }
  if (stock_quantity > 0 && track_inventory) {
    const session = sessionUserFromHeader(c.req.header('Authorization'));
    // Write initial quantity as 0 first so applyStockDelta records previous=0 correctly
    await c.env.DB.prepare(`UPDATE products SET stock_quantity = 0 WHERE id = ?`).bind(result.meta.last_row_id).run();
    let locId = body.location_id ? Number(body.location_id) : null;
    if (!locId) {
      try { locId = await getDefaultLocationId(c.env.DB); } catch { locId = null; }
    }
    await applyStockDelta(
      c.env.DB,
      result.meta.last_row_id,
      Number(stock_quantity),
      'Stock initial',
      `product:${result.meta.last_row_id}`,
      { createdBy: session.username, type: 'initial', locationId: locId || undefined },
    );
  }
  const product = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(result.meta.last_row_id).first();
  try {
    const pq = Number((product as any)?.stock_quantity || 0);
    if (product && (product as any).id) await placeProductStockOnDefault(c.env.DB, Number((product as any).id), pq);
  } catch { /* */ }
  try { const su = sessionUserFromHeader(c.req.header('Authorization')); await writeAudit(c.env.DB, { username: su.username, role: su.role, action: 'product.create', entity: 'products', entity_id: String(result?.meta?.last_row_id || ''), detail: body?.name || '', ip: c.req.header('cf-connecting-ip') || '' }); } catch {}
  await invalidateDashboardCache(c.env.CACHE);
  return c.json({ success: true, data: product, message: 'Produit enregistré dans la base de données.' }, 201);
});

app.put('/api/products/:id', async (c) => {
  // will invalidate CACHE on success

  const id = c.req.param('id');
  await ensureProductBulkDiscounts(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  if (body.name != null || body.price != null) {
    const verr = validateProductWrite({ name: body.name ?? 'x', ...body });
    if (verr && verr.price) return apiFail(c, verr.price, 'VALIDATION', verr);
  }
  const existing = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(id).first() as any;
  if (!existing) return c.json({ success: false, error: 'Produit introuvable' }, 404);

  // Duplicate check on update (exclude self) — never 500 the save if the
  // schema drifts: a failing dup probe just skips the duplicate guard.
  const force = !!body.force_duplicate;
  const checkName = body.name !== undefined ? String(body.name) : existing.name;
  const checkSku = body.sku !== undefined ? body.sku : existing.sku;
  const checkBarcode = body.barcode !== undefined ? body.barcode : existing.barcode;
  const dupChecks: { label: string; row: any }[] = [];
  try {
  if (checkSku) {
    const bySku = await c.env.DB.prepare(`SELECT id, name, sku, barcode FROM products WHERE LOWER(sku) = LOWER(?) AND id != ?`).bind(checkSku, id).first();
    if (bySku) dupChecks.push({ label: 'SKU', row: bySku });
  }
  if (checkBarcode) {
    const byBc = await c.env.DB.prepare(`SELECT id, name, sku, barcode FROM products WHERE barcode = ? AND id != ?`).bind(checkBarcode, id).first();
    if (byBc) dupChecks.push({ label: 'code-barres', row: byBc });
  }
  if (checkName) {
    const byName = await c.env.DB.prepare(`SELECT id, name, sku, barcode FROM products WHERE LOWER(name) = LOWER(?) AND id != ?`).bind(checkName, id).first();
    if (byName) dupChecks.push({ label: 'nom', row: byName });
  }
  if (dupChecks.length && !force) {
    const first = dupChecks[0];
    return c.json({
      success: false,
      code: 'DUPLICATE_PRODUCT',
      force_required: true,
      error: `Conflit de doublon (${first.label}) avec « ${first.row.name} » (id ${first.row.id}). Passez force_duplicate=true pour forcer.`,
      hint: 'Envoyez force_duplicate=true pour ignorer le conflit, ou changez le SKU / nom / code-barres.',
      duplicate: { id: first.row.id, name: first.row.name, sku: first.row.sku, barcode: first.row.barcode },
      matches: dupChecks.map((d) => ({ on: d.label, id: d.row.id, name: d.row.name, sku: d.row.sku, barcode: d.row.barcode })),
    }, 409);
  }

  // Always persist price/cost as real numbers (avoids string/null no-ops in D1)
  if (body.price !== undefined && body.price !== null && body.price !== '') {
    body.price = Number(body.price);
    if (!Number.isFinite(body.price)) body.price = 0;
  }
  if (body.cost !== undefined && body.cost !== null && body.cost !== '') {
    body.cost = Number(body.cost);
    if (!Number.isFinite(body.cost)) body.cost = 0;
  }
  // unit_price alias used by some clients → maps to price
  if (body.unit_price !== undefined && body.price === undefined) {
    body.price = Number(body.unit_price);
    if (!Number.isFinite(body.price)) body.price = 0;
  }
  } catch (e) {
    console.error('dup-check skip', String((e as any)?.message || e).slice(0, 300));
  }

  const fields = ['sku', 'name', 'description', 'category', 'unit', 'price', 'cost', 'low_stock_threshold', 'track_inventory', 'is_active', 'image_url', 'barcode', 'tax_rate'];
  // Schema-drift guard: never let a missing optional column 500 the save.
  const cols = await tableColumns(c.env.DB, 'products');
  const updates: string[] = [];
  const values: any[] = [];
  for (const f of fields) {
    if (body[f] !== undefined) {
      if (cols && !cols.has(f)) continue;
      updates.push(`${f} = ?`);
      let v = body[f];
      if (f === 'price' || f === 'cost' || f === 'low_stock_threshold' || f === 'tax_rate') {
        if (v === '' || v === null) v = f === 'tax_rate' ? null : 0;
        else if (typeof v === 'string') v = Number(v);
      }
      if (f === 'track_inventory' || f === 'is_active') {
        v = v ? 1 : 0;
      }
      values.push(v);
    }
  }
  try { await addColumnIfMissing(c.env.DB, 'products', 'lot_number', `TEXT`); } catch (e) { console.error('addColumn lot_number', String((e as any)?.message || e).slice(0, 200)); }
  try { await addColumnIfMissing(c.env.DB, 'products', 'expiry_date', `TEXT`); } catch (e) { console.error('addColumn expiry_date', String((e as any)?.message || e).slice(0, 200)); }
  if (body.lot_number !== undefined && (await hasColumn(c.env.DB, 'products', 'lot_number'))) { updates.push('lot_number = ?'); values.push(String(body.lot_number || '').slice(0, 64) || null); }
  if (body.expiry_date !== undefined && (await hasColumn(c.env.DB, 'products', 'expiry_date'))) { updates.push('expiry_date = ?'); values.push(String(body.expiry_date || '').slice(0, 32) || null); }
  if (body.bulk_discounts !== undefined && (await hasColumn(c.env.DB, 'products', 'bulk_discounts'))) {
    updates.push(`bulk_discounts = ?`);
    values.push(JSON.stringify(parseBulkDiscounts(body.bulk_discounts)));
  }
  if (updates.length === 0) return c.json({ success: false, error: 'Aucun champ à modifier' }, 400);
  if (!cols || cols.has('updated_at')) updates.push(`updated_at = datetime('now')`);
  values.push(id);
  try {
    await c.env.DB.prepare(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  } catch (e) {
    console.error('[PUT products update failed]', String((e as any)?.message || e).slice(0, 400), JSON.stringify({ updates }));
    throw e;
  }
  const product = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(id).first();
    if (body.location_id !== undefined && body.place_stock !== false) {
    try {
      const locId = Number(body.location_id);
      if (locId > 0) {
        const prod = await c.env.DB.prepare(`SELECT stock_quantity, track_inventory FROM products WHERE id = ?`).bind(id).first() as any;
        if (prod?.track_inventory && Number(prod.stock_quantity || 0) > 0) {
          await ensureStockLocations(c.env.DB);
          // Clear other placements and put all on chosen location
          await c.env.DB.prepare(`DELETE FROM stock_location_qty WHERE product_id = ?`).bind(id).run();
          await c.env.DB.prepare(
            `INSERT INTO stock_location_qty (location_id, product_id, quantity) VALUES (?, ?, ?)`
          ).bind(locId, id, Number(prod.stock_quantity || 0)).run();
        }
      }
    } catch (e) {
      console.error('place product stock', e);
    }
  }
await invalidateDashboardCache(c.env.CACHE);
  return c.json({ success: true, data: product, message: 'Produit modifié dans la base de données.' });
});

app.post('/api/products/:id/adjust-stock', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { quantity, type = 'adjustment', reason = '', reference = '' } = body;
  const locationId = body.location_id != null ? Number(body.location_id) : null;
  if (typeof quantity !== 'number' || Number.isNaN(quantity)) {
    return c.json({ success: false, error: 'La quantité est obligatoire' }, 400);
  }
  const product = await c.env.DB.prepare(`SELECT stock_quantity, track_inventory FROM products WHERE id = ?`).bind(id).first() as any;
  if (!product) return c.json({ success: false, error: 'Produit introuvable' }, 404);
  if (!product.track_inventory) {
    return c.json({ success: false, error: 'Ce produit ne suit pas le stock' }, 400);
  }
  const absQty = Math.abs(Number(quantity));
  if (absQty <= 0) return c.json({ success: false, error: 'Quantité invalide' }, 400);
  const outTypes = ['out', 'sale'];
  const delta = outTypes.includes(String(type).toLowerCase()) ? -absQty : absQty;
  const prev = Number(product.stock_quantity || 0);
  if (prev + delta < 0) return c.json({ success: false, error: 'Stock insuffisant' }, 400);

  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const movement = await applyStockDelta(
    c.env.DB,
    id,
    delta,
    reason || `Ajustement manuel (${type})`,
    reference || `adjust:${id}`,
    {
      createdBy: session.username,
      type: String(type || 'adjustment'),
      allowNegative: false,
      locationId: locationId || undefined,
    },
  );
  const updated = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(id).first();
  // Free-tier friendly: D1 + KV invalidation (no Durable Objects required)
  await invalidateDashboardCache(c.env.CACHE);
  return c.json({
    success: true,
    data: updated,
    movement,
    message: 'Stock ajusté et enregistré dans le journal d\'audit.',
  });
});

/* ─── Product variants ─── */

app.get('/api/products/:id/variants', async (c) => {
  await ensureProductVariantColumns(c.env.DB);
  const id = c.req.param('id');
  const parent = await c.env.DB.prepare(`SELECT id, name FROM products WHERE id = ?`).bind(id).first();
  if (!parent) return c.json({ success: false, error: 'Produit introuvable' }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM products WHERE parent_id = ? ORDER BY variant_label, name`
  ).bind(id).all();
  return c.json({ success: true, data: results || [], parent });
});

app.post('/api/products/:id/variants', async (c) => {
  await ensureProductVariantColumns(c.env.DB);
  await ensureProductBulkDiscounts(c.env.DB);
  const parentId = c.req.param('id');
  const parent = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(parentId).first() as any;
  if (!parent) return c.json({ success: false, error: 'Produit parent introuvable' }, 404);
  if (parent.parent_id) {
    return c.json({ success: false, error: 'Impossible d\'ajouter une variante à une variante.' }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const variant_label = String(body.variant_label || body.label || '').trim();
  if (!variant_label) {
    return c.json({ success: false, error: 'Libellé de variante obligatoire (ex. « M / Rouge »).' }, 400);
  }
  const name = String(body.name || `${parent.name} — ${variant_label}`).trim();
  const sku = body.sku != null ? String(body.sku).trim() : '';
  const barcode = body.barcode != null ? String(body.barcode).trim() : '';
  const price = body.price !== undefined ? Number(body.price) : Number(parent.price || 0);
  const cost = body.cost !== undefined ? Number(body.cost) : Number(parent.cost || 0);
  const stock_quantity = Number(body.stock_quantity || 0);
  const attributes = body.attributes
    ? (typeof body.attributes === 'string' ? body.attributes : JSON.stringify(body.attributes))
    : '{}';

  // Duplicate barcode / SKU across all products
  if (barcode) {
    const byBc = await c.env.DB.prepare(`SELECT id, name FROM products WHERE barcode = ?`).bind(barcode).first();
    if (byBc && !body.force_duplicate) {
      return c.json({
        success: false,
        code: 'DUPLICATE_PRODUCT',
        force_required: true,
        error: `Code-barres déjà utilisé par « ${(byBc as any).name} » (id ${(byBc as any).id}).`,
        duplicate: byBc,
      }, 409);
    }
  }
  if (sku) {
    const bySku = await c.env.DB.prepare(`SELECT id, name FROM products WHERE LOWER(sku) = LOWER(?)`).bind(sku).first();
    if (bySku && !body.force_duplicate) {
      return c.json({
        success: false,
        code: 'DUPLICATE_PRODUCT',
        force_required: true,
        error: `SKU déjà utilisé par « ${(bySku as any).name} » (id ${(bySku as any).id}).`,
        duplicate: bySku,
      }, 409);
    }
  }

  const result = await c.env.DB.prepare(
    `INSERT INTO products (sku, name, description, category, unit, price, cost, stock_quantity, low_stock_threshold, track_inventory, image_url, barcode, tax_rate, bulk_discounts, parent_id, variant_label, attributes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    sku || null,
    name,
    parent.description || '',
    parent.category || 'Général',
    parent.unit || 'unité',
    price,
    cost,
    stock_quantity,
    parent.low_stock_threshold ?? 5,
    parent.track_inventory ?? 1,
    parent.image_url || '',
    barcode || '',
    parent.tax_rate,
    parent.bulk_discounts || '[]',
    Number(parentId),
    variant_label,
    attributes,
  ).run();

  const variantId = result.meta.last_row_id;
  if (stock_quantity > 0) {
    await applyStockDelta(c.env.DB, variantId, stock_quantity, 'Stock initial (variante)', `variant:${variantId}`, { type: 'initial' });
  }
  const variant = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(variantId).first();
  return c.json({ success: true, data: variant, message: 'Variante créée.' }, 201);
});

app.put('/api/products/variants/:vid', async (c) => {
  await ensureProductVariantColumns(c.env.DB);
  const vid = c.req.param('vid');
  const existing = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(vid).first() as any;
  if (!existing) return c.json({ success: false, error: 'Variante introuvable' }, 404);
  if (!existing.parent_id) {
    return c.json({ success: false, error: 'Ce produit n\'est pas une variante. Utilisez PUT /api/products/:id.' }, 400);
  }
  const body = await c.req.json().catch(() => ({}));
  if (body.price !== undefined && body.price !== null && body.price !== '') {
    body.price = Number(body.price);
    if (!Number.isFinite(body.price)) body.price = 0;
  }
  if (body.cost !== undefined && body.cost !== null && body.cost !== '') {
    body.cost = Number(body.cost);
    if (!Number.isFinite(body.cost)) body.cost = 0;
  }
  const fields = ['sku', 'name', 'price', 'cost', 'barcode', 'variant_label', 'is_active', 'low_stock_threshold', 'track_inventory', 'tax_rate'];
  const updates: string[] = [];
  const values: any[] = [];
  for (const f of fields) {
    if (body[f] !== undefined) {
      updates.push(`${f} = ?`);
      let v = body[f];
      if (f === 'price' || f === 'cost' || f === 'low_stock_threshold' || f === 'tax_rate') {
        if (v === '' || v === null) v = f === 'tax_rate' ? null : 0;
        else if (typeof v === 'string') v = Number(v);
      }
      if (f === 'track_inventory' || f === 'is_active') v = v ? 1 : 0;
      values.push(v);
    }
  }
  if (body.label !== undefined && body.variant_label === undefined) {
    updates.push(`variant_label = ?`);
    values.push(String(body.label));
  }
  if (body.attributes !== undefined) {
    updates.push(`attributes = ?`);
    values.push(typeof body.attributes === 'string' ? body.attributes : JSON.stringify(body.attributes));
  }
  if (!updates.length) return c.json({ success: false, error: 'Aucun champ à modifier' }, 400);
  updates.push(`updated_at = datetime('now')`);
  values.push(vid);
  await c.env.DB.prepare(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  const row = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(vid).first();
  await invalidateDashboardCache(c.env.CACHE);
  return c.json({ success: true, data: row, message: 'Variante mise à jour.' });
});

app.delete('/api/products/variants/:vid', async (c) => {
  await ensureProductVariantColumns(c.env.DB);
  const vid = c.req.param('vid');
  const body = await c.req.json().catch(() => ({}));
  const existing = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(vid).first() as any;
  if (!existing) return c.json({ success: false, error: 'Variante introuvable' }, 404);
  if (!existing.parent_id) {
    return c.json({ success: false, error: 'Ce produit n\'est pas une variante.' }, 400);
  }
  if (body.confirm_password) {
    const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
    if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);
  }
  // Soft-delete preferred for audit; hard delete if force
  if (body.hard) {
    await c.env.DB.prepare(`DELETE FROM products WHERE id = ?`).bind(vid).run();
  } else {
    await c.env.DB.prepare(`UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ?`).bind(vid).run();
  }
  return c.json({ success: true, message: `Variante « ${existing.variant_label || existing.name} » ${body.hard ? 'supprimée' : 'désactivée'}.` });
});

/* ─── Barcode scan (mobile APK ready) ─── */

/**
 * Lookup by barcode or SKU — primary endpoint for camera scan.
 * GET /api/scan/barcode/:code
 * Returns product (or variant) + parent summary + stock status.
 */
app.get('/api/scan/barcode/:code', async (c) => {
  // Hot path: no schema DDL. Light columns — no image/description (phone never shows photos).
  const code = decodeURIComponent(c.req.param('code') || '').trim();
  if (!code) return c.json({ success: false, error: 'Code-barres vide' }, 400);

  const SCAN_COLS = `id, sku, name, barcode, category, unit, price, stock_quantity, low_stock_threshold, track_inventory, is_active, parent_id, variant_label, tax_rate`;
  let product = await c.env.DB.prepare(
    `SELECT ${SCAN_COLS} FROM products WHERE barcode = ? AND is_active = 1 LIMIT 1`
  ).bind(code).first() as any;
  if (!product) {
    product = await c.env.DB.prepare(
      `SELECT ${SCAN_COLS} FROM products WHERE LOWER(sku) = LOWER(?) AND is_active = 1 LIMIT 1`
    ).bind(code).first() as any;
  }
  if (!product) {
    // Part D: already proposed from phone, waiting for PC accept
    let pendingAction: any = null;
    try {
      pendingAction = await c.env.DB.prepare(
        `SELECT id, type, title, detail, status, created_at, created_by, barcode
         FROM mobile_actions
         WHERE status = 'pending'
           AND (
             barcode = ?
             OR detail LIKE ?
             OR detail LIKE ?
           )
         ORDER BY id DESC LIMIT 1`
      ).bind(code, `%barcode/sku=${code}%`, `%barcode=${code}%`).first();
    } catch { /* older schema */ }

    if (pendingAction) {
      return c.json({
        success: false,
        code: 'PENDING_APPROVAL',
        error: `Produit « ${code} » déjà proposé — en attente d’acceptation sur le PC.`,
        barcode: code,
        can_create: false,
        pending_action: {
          id: pendingAction.id,
          type: pendingAction.type,
          title: pendingAction.title,
          detail: pendingAction.detail,
          status: pendingAction.status,
          created_at: pendingAction.created_at,
          created_by: pendingAction.created_by,
        },
      }, 404);
    }

    return c.json({
      success: false,
      code: 'NOT_FOUND',
      error: `Aucun produit pour le code « ${code} ».`,
      barcode: code,
      can_create: true,
    }, 404);
  }

  let parent: any = null;
  if (product.parent_id) {
    parent = await c.env.DB.prepare(
      `SELECT id, name, category, unit, price FROM products WHERE id = ?`
    ).bind(product.parent_id).first();
  }

  const stockQty = Number(product.stock_quantity || 0);
  const threshold = Number(product.low_stock_threshold || 0);
  const stock_status = !product.track_inventory
    ? 'not_tracked'
    : stockQty <= 0
      ? 'out'
      : stockQty <= threshold
        ? 'low'
        : 'ok';

  return c.json({
    success: true,
    data: {
      ...product,
      parent,
      stock_status,
      display_name: product.variant_label
        ? `${parent?.name || product.name} — ${product.variant_label}`
        : product.name,
      // Ready-to-use invoice line payload for mobile
      invoice_line: {
        product_id: product.id,
        product_name: product.variant_label
          ? `${parent?.name || product.name} — ${product.variant_label}`
          : product.name,
        sku: product.sku || '',
        barcode: product.barcode || '',
        quantity: 1,
        list_price: Number(product.price || 0),
        unit_price: Number(product.price || 0),
        tax_rate: product.tax_rate,
      },
    },
  });
});

/**
 * Create a product quickly from a scanned barcode (APK "add product by scan").
 * POST /api/scan/quick-product
 * body: { barcode, name?, price?, cost?, category?, unit?, stock_quantity?, parent_id?, variant_label? }
 */
app.post('/api/scan/quick-product', async (c) => {
  await ensureProductVariantColumns(c.env.DB);
  await ensureProductBulkDiscounts(c.env.DB);
  await ensureCategoriesTable(c.env.DB);
  await ensureUnitsTable(c.env.DB);

  const body = await c.req.json().catch(() => ({}));
  const barcode = String(body.barcode || '').trim();
  if (!barcode) return c.json({ success: false, error: 'Code-barres obligatoire' }, 400);

  const existing = await c.env.DB.prepare(
    `SELECT id, name, sku, barcode FROM products WHERE barcode = ?`
  ).bind(barcode).first() as any;
  if (existing && !body.force_duplicate) {
    return c.json({
      success: false,
      code: 'DUPLICATE_PRODUCT',
      force_required: true,
      error: `Code-barres déjà associé à « ${existing.name} » (id ${existing.id}).`,
      duplicate: existing,
    }, 409);
  }

  const name = String(body.name || `Produit ${barcode}`).trim();
  const price = Number(body.price || 0);
  const cost = Number(body.cost || 0);
  const category = String(body.category || 'Général');
  const unit = String(body.unit || 'unité');
  const stock_quantity = Number(body.stock_quantity || 0);
  const parent_id = body.parent_id ? Number(body.parent_id) : null;
  const variant_label = String(body.variant_label || '').trim();
  const sku = body.sku != null ? String(body.sku).trim() : barcode;

  const result = await c.env.DB.prepare(
    `INSERT INTO products (sku, name, description, category, unit, price, cost, stock_quantity, low_stock_threshold, track_inventory, image_url, barcode, tax_rate, bulk_discounts, parent_id, variant_label, attributes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, '', ?, NULL, '[]', ?, ?, '{}')`
  ).bind(
    sku || null,
    name,
    String(body.description || ''),
    category,
    unit,
    price,
    cost,
    stock_quantity,
    Number(body.low_stock_threshold ?? 5),
    barcode,
    parent_id,
    variant_label,
  ).run();

  const id = result.meta.last_row_id;
  if (stock_quantity > 0) {
    await applyStockDelta(c.env.DB, id, stock_quantity, 'Stock initial (scan)', barcode, { type: 'initial' });
  }
  const product = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(id).first();
  return c.json({
    success: true,
    data: product,
    message: 'Produit créé depuis le code-barres.',
  }, 201);
});

/**
 * Detach / purge rows that reference products(id) so DELETE is not blocked by FK.
 * Document lines keep product_name but lose the live product link.
 */
async function purgeProductDependencies(db: D1Database, productIds: (string | number)[]) {
  const ids = productIds.map((x) => Number(x)).filter((n) => n > 0);
  if (!ids.length) return;
  const ph = ids.map(() => '?').join(',');

  // Child variants first
  try {
    await db.prepare(`DELETE FROM products WHERE parent_id IN (${ph})`).bind(...ids).run();
  } catch { /* no parent_id column */ }

  const softNullTables = [
    `UPDATE invoice_items SET product_id = NULL WHERE product_id IN (${ph})`,
    `UPDATE bill_items SET product_id = NULL WHERE product_id IN (${ph})`,
    `UPDATE delivery_note_items SET product_id = NULL WHERE product_id IN (${ph})`,
  ];
  for (const sql of softNullTables) {
    try { await db.prepare(sql).bind(...ids).run(); } catch { /* table/column may not exist */ }
  }

  // Hard-delete pure stock / catalog children
  const hardDelete = [
    `DELETE FROM stock_location_qty WHERE product_id IN (${ph})`,
    `DELETE FROM product_images WHERE product_id IN (${ph})`,
    `DELETE FROM product_catalog WHERE product_id IN (${ph})`,
    `DELETE FROM stock_movements WHERE product_id IN (${ph})`,
    `DELETE FROM reorder_suggestions WHERE product_id IN (${ph})`,
  ];
  for (const sql of hardDelete) {
    try { await db.prepare(sql).bind(...ids).run(); } catch { /* optional tables */ }
  }
}


/** True if product appears on any historical document line (invoice/bill). */
async function productHasTransactionHistory(db: D1Database, productId: number | string): Promise<boolean> {
  const id = Number(productId);
  if (!id) return false;
  try {
    const inv = await db.prepare(
      `SELECT 1 AS ok FROM invoice_items WHERE product_id = ? LIMIT 1`,
    ).bind(id).first() as any;
    if (inv?.ok) return true;
  } catch { /* */ }
  try {
    const bill = await db.prepare(
      `SELECT 1 AS ok FROM bill_items WHERE product_id = ? LIMIT 1`,
    ).bind(id).first() as any;
    if (bill?.ok) return true;
  } catch { /* */ }
  return false;
}

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

function friendlyFkDeleteError(e: any): string {
  const msg = String(e?.message || e || '');
  if (/FOREIGN KEY|SQLITE_CONSTRAINT/i.test(msg)) {
    return 'Impossible de supprimer : ce produit est encore lié à des documents ou au stock. Les liens ont été nettoyés — réessayez. Si l’erreur persiste, contactez le support.';
  }
  return msg || 'Échec de la suppression';
}

app.post('/api/products/:id/request-delete-otp', async (c) => {
  const id = c.req.param('id');
  const product = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(id).first() as any;
  if (!product) return c.json({ success: false, error: 'Produit introuvable' }, 404);
  const label = `Produit ${product.name}${product.sku ? ` (${product.sku})` : ''}`;
  const result = await issueDeleteOtp(c.env, 'product', String(id), label, `Code de suppression — ${label}`);
  return c.json({ success: true, message: result.message, emailed: result.emailed, otp: result.emailed ? undefined : result.otp });
});

app.delete('/api/products/:id', async (c) => {
  try {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    if (!canHardDeleteStock(gate.role)) {
      return c.json({ success: false, error: 'Rôle insuffisant pour supprimer un produit.', code: 'FORBIDDEN_ROLE' }, 403);
    }
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
    if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);

    const product = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ?`).bind(id).first() as any;
    if (!product) return c.json({ success: false, error: 'Produit introuvable' }, 404);

    // Hard-delete guardrail: historical lines → archive only (is_active = 0)
    if (await productHasTransactionHistory(c.env.DB, id)) {
      await c.env.DB.prepare(
        `UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ?`,
      ).bind(id).run();
      await afterBusinessMutation(c.env.CACHE);
      await writeAudit(c.env.DB, {
        username: gate.username,
        role: gate.role,
        action: 'product.archive',
        entity: 'products',
        entity_id: id,
        detail: `${product.name}; reason=linked_transactions`,
        ip: c.req.header('cf-connecting-ip') || '',
      });
      return c.json({
        success: true,
        archived: true,
        message: `Produit « ${product.name} » archivé (lié à l’historique). Suppression définitive interdite.`,
      });
    }

    const r2n = await deleteProductImagesFromR2(c.env.DB, c.env.IMAGES, c.env, id);
    await purgeProductDependencies(c.env.DB, [id]);
    await c.env.DB.prepare(`DELETE FROM products WHERE id = ?`).bind(id).run();
    await afterBusinessMutation(c.env.CACHE);

    await writeAudit(c.env.DB, {
      username: gate.username,
      role: gate.role,
      action: 'product.delete',
      entity: 'products',
      entity_id: id,
      detail: `${product.name}; r2_objects=${r2n}`,
      ip: c.req.header('cf-connecting-ip') || '',
    });

    return c.json({
      success: true,
      message: `Produit ${product.name} supprimé.`,
      meta: { r2_deleted: r2n },
    });
  } catch (e: any) {
    console.error('product delete', e);
    return c.json({ success: false, error: friendlyFkDeleteError(e), code: 'DELETE_FAILED' }, 400);
  }
});

app.post('/api/products/request-bulk-delete-otp', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const ids: number[] = Array.isArray(body.ids) ? body.ids.map((x: any) => Number(x)).filter((n: number) => n > 0) : [];
  if (!ids.length) return c.json({ success: false, error: 'Aucun produit sélectionné' }, 400);
  const placeholders = ids.map(() => '?').join(',');
  const { results: products } = await c.env.DB.prepare(`SELECT id, name, sku FROM products WHERE id IN (${placeholders})`).bind(...ids).all();
  if (!products?.length) return c.json({ success: false, error: 'Aucun produit trouvé' }, 404);
  const resourceId = ids.slice().sort((a, b) => a - b).join(',');
  const label = `${products.length} produit(s) : ${(products as any[]).map((x) => x.name).join(', ')}`;
  const result = await issueDeleteOtp(c.env, 'products_bulk', resourceId, label, `Code de suppression — ${products.length} produit(s)`);
  return c.json({ success: true, message: result.message, emailed: result.emailed, otp: result.emailed ? undefined : result.otp, count: products.length });
});

app.post('/api/products/bulk-delete', async (c) => {
  try {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    if (!canHardDeleteStock(gate.role)) {
      return c.json({ success: false, error: 'Rôle insuffisant pour supprimer des produits.', code: 'FORBIDDEN_ROLE' }, 403);
    }
    const body = await c.req.json().catch(() => ({}));
    const ids: number[] = Array.isArray(body.ids) ? body.ids.map((x: any) => Number(x)).filter((n: number) => n > 0) : [];
    if (!ids.length) return c.json({ success: false, error: 'Aucun produit sélectionné' }, 400);
    const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
    if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);

    const placeholders = ids.map(() => '?').join(',');
    for (const id of ids) {
      try { await deleteProductImagesFromR2(c.env.DB, c.env.IMAGES, c.env, id); } catch { /* */ }
    }
    await purgeProductDependencies(c.env.DB, ids);
    await c.env.DB.prepare(`DELETE FROM products WHERE id IN (${placeholders})`).bind(...ids).run();
    await afterBusinessMutation(c.env.CACHE);

    await writeAudit(c.env.DB, {
      username: gate.username,
      role: gate.role,
      action: 'product.bulk_delete',
      entity: 'products',
      entity_id: ids.join(','),
      detail: `${ids.length} produit(s)`,
      ip: c.req.header('cf-connecting-ip') || '',
    });

    return c.json({
      success: true,
      message: `${ids.length} produit(s) supprimé(s).`,
    });
  } catch (e: any) {
    console.error('product bulk-delete', e);
    return c.json({ success: false, error: friendlyFkDeleteError(e), code: 'DELETE_FAILED' }, 400);
  }
});

/* GET /api/products/:id/movements → worker/routes/stock.ts */


/**
 * Global inventory audit log.
 * Query: product_id, type, q (reason/reference search), limit (default 50, max 200), offset
 */
/* GET /api/stock/movements → worker/routes/stock.ts */


/* ─── Clients ─── */

/* clients routes → registerClientRoutes in routes/clients.ts */

app.get('/api/catalog/settings', async (c) => {
  await ensureCatalogTables(c.env.DB);
  const row = await c.env.DB.prepare(`SELECT * FROM catalog_settings WHERE id = 1`).first();
  return c.json({ success: true, data: row });
});

app.put('/api/catalog/settings', async (c) => {
  await ensureCatalogTables(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const fields = ['site_title', 'site_tagline', 'public_base_url', 'show_prices', 'show_stock', 'contact_email', 'contact_phone'];
  const updates: string[] = [];
  const values: any[] = [];
  for (const f of fields) {
    if (body[f] !== undefined) {
      updates.push(`${f} = ?`);
      values.push(body[f]);
    }
  }
  if (!updates.length) return c.json({ success: false, error: 'Aucun champ' }, 400);
  updates.push(`updated_at = datetime('now')`);
  await c.env.DB.prepare(`UPDATE catalog_settings SET ${updates.join(', ')} WHERE id = 1`).bind(...values).run();
  const row = await c.env.DB.prepare(`SELECT * FROM catalog_settings WHERE id = 1`).first();
  return c.json({ success: true, data: row, message: 'Paramètres catalogue enregistrés.' });
});

app.get('/api/catalog/products', async (c) => {
  await ensureCatalogTables(c.env.DB);
  const { results } = await c.env.DB.prepare(`
    SELECT p.id, p.sku, p.name, p.category, p.price, p.stock_quantity, p.image_url,
           COALESCE(c.is_public, p.is_public, 0) as is_public,
           COALESCE(c.is_featured, 0) as is_featured,
           COALESCE(c.short_description, p.short_description, p.description, '') as short_description,
           c.long_description, c.slug as catalog_slug, p.slug as product_slug
    FROM products p
    LEFT JOIN product_catalog c ON c.product_id = p.id
    WHERE p.is_active = 1
    ORDER BY p.name
  `).all();
  return c.json({ success: true, data: results || [] });
});

app.put('/api/catalog/products/:id', async (c) => {
  await ensureCatalogTables(c.env.DB);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const prod = await c.env.DB.prepare(`SELECT id, name FROM products WHERE id = ?`).bind(id).first();
  if (!prod) return c.json({ success: false, error: 'Produit introuvable' }, 404);

  const slug = body.slug !== undefined
    ? String(body.slug).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '')
    : undefined;
  const short_description = body.short_description !== undefined ? String(body.short_description) : undefined;
  const long_description = body.long_description !== undefined ? String(body.long_description) : undefined;
  const is_public = body.is_public !== undefined ? (body.is_public ? 1 : 0) : undefined;
  const is_featured = body.is_featured !== undefined ? (body.is_featured ? 1 : 0) : undefined;

  // Upsert product_catalog
  const existing = await c.env.DB.prepare(`SELECT product_id FROM product_catalog WHERE product_id = ?`).bind(id).first();
  if (existing) {
    const sets: string[] = [];
    const vals: any[] = [];
    if (slug !== undefined) { sets.push('slug = ?'); vals.push(slug || null); }
    if (short_description !== undefined) { sets.push('short_description = ?'); vals.push(short_description); }
    if (long_description !== undefined) { sets.push('long_description = ?'); vals.push(long_description); }
    if (is_public !== undefined) { sets.push('is_public = ?'); vals.push(is_public); }
    if (is_featured !== undefined) { sets.push('is_featured = ?'); vals.push(is_featured); }
    sets.push(`updated_at = datetime('now')`);
    if (is_public === 1) sets.push(`published_at = COALESCE(published_at, datetime('now'))`);
    vals.push(id);
    if (sets.length > 1) {
      await c.env.DB.prepare(`UPDATE product_catalog SET ${sets.join(', ')} WHERE product_id = ?`).bind(...vals).run();
    }
  } else {
    await c.env.DB.prepare(`
      INSERT INTO product_catalog (product_id, slug, short_description, long_description, is_public, is_featured, published_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      slug || null,
      short_description || '',
      long_description || '',
      is_public ?? 0,
      is_featured ?? 0,
      is_public === 1 ? new Date().toISOString() : null,
    ).run();
  }

  // Mirror flags on products for simpler public queries
  if (is_public !== undefined || slug !== undefined || short_description !== undefined) {
    const psets: string[] = [];
    const pvals: any[] = [];
    if (is_public !== undefined) { psets.push('is_public = ?'); pvals.push(is_public); }
    if (slug !== undefined) { psets.push('slug = ?'); pvals.push(slug || null); }
    if (short_description !== undefined) { psets.push('short_description = ?'); pvals.push(short_description); }
    if (psets.length) {
      pvals.push(id);
      try {
        await c.env.DB.prepare(`UPDATE products SET ${psets.join(', ')} WHERE id = ?`).bind(...pvals).run();
      } catch { /* columns may not exist on very old DB */ }
    }
  }

  return c.json({ success: true, message: 'Fiche catalogue mise à jour.' });
});

/** Same-origin image proxy — allows PC crop/rotate without CDN CORS issues */
app.get('/api/media/proxy', async (c) => {
  const raw = String(c.req.query('url') || '').trim();
  if (!raw) {
    return c.json({ success: false, error: 'URL manquante' }, 400);
  }
  // data: URLs — nothing to proxy
  if (raw.startsWith('data:image/')) {
    return c.json({ success: false, error: 'data URL — pas de proxy' }, 400);
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(raw);
  } catch {
    return c.json({ success: false, error: 'URL invalide' }, 400);
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return c.json({ success: false, error: 'Protocole URL non autorisé' }, 400);
  }
  const host = parsedUrl.hostname.toLowerCase();
  const isTrustedHost =
    host === 'afmarbre.com' ||
    host.endsWith('.afmarbre.com') ||
    host === 'r2.dev' ||
    host.endsWith('.r2.dev');
  if (!isAllowedImageUrl(raw) && !isTrustedHost) {
    return c.json({ success: false, error: 'URL image non autorisée' }, 400);
  }
  try {
    // 1) Prefer R2 binding (no CDN CORS issues)
    const key = keyFromCdnUrl(c.env, raw);
    if (key && (key.startsWith('backups/') || key.includes('/backups/'))) {
      return c.json({ success: false, error: 'Accès interdit' }, 403);
    }
    if (key && c.env.IMAGES) {
      const obj = await c.env.IMAGES.get(key);
      if (obj) {
        const buf = await obj.arrayBuffer();
        const ct = obj.httpMetadata?.contentType || 'image/jpeg';
        return new Response(buf, {
          status: 200,
          headers: {
            'Content-Type': ct,
            'Cache-Control': 'private, max-age=600',
            'Access-Control-Allow-Origin': 'https://stock.afmarbre.com',
            'Vary': 'Origin',
          },
        });
      }
    }
    // 2) Fetch remote URL from Worker (Workers can fetch any public URL)
    const res = await fetch(raw, {
      redirect: 'follow',
      headers: { Accept: 'image/*,*/*' },
    });
    if (!res.ok) {
      return c.json({ success: false, error: `Image inaccessible (${res.status})` }, 502);
    }
    const buf = await res.arrayBuffer();
    if (!buf || buf.byteLength < 32) {
      return c.json({ success: false, error: 'Image vide' }, 502);
    }
    let ct = res.headers.get('Content-Type') || 'image/jpeg';
    if (!ct.startsWith('image/')) ct = 'image/jpeg';
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': ct,
        'Cache-Control': 'private, max-age=600',
        'Access-Control-Allow-Origin': 'https://stock.afmarbre.com',
            'Vary': 'Origin',
      },
    });
  } catch (e: any) {
    return c.json({ success: false, error: e?.message || 'Proxy image échoué' }, 502);
  }
});

app.get('/api/catalog/products/:id/images', async (c) => {
  await ensureCatalogTables(c.env.DB);
  const id = c.req.param('id');
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, sort_order ASC, id ASC`
  ).bind(id).all();
  return c.json({ success: true, data: results || [] });
});

app.post('/api/catalog/products/:id/images', async (c) => {
  await ensureCatalogTables(c.env.DB);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  let url = String(body.url || '').trim();
  const dataUrl = String(body.data_url || body.dataUrl || '').trim();
  const prod = await c.env.DB.prepare(`SELECT id FROM products WHERE id = ?`).bind(id).first();
  if (!prod) return c.json({ success: false, error: 'Produit introuvable' }, 404);

  // Prefer R2 upload when data URL provided and IMAGES binding is present.
  // Stores only the CDN URL in D1 (never base64 blobs) — protects free-tier D1 size.
  if (dataUrl.startsWith('data:image') && c.env.IMAGES) {
    const mimeMatch = /^data:(image\/[a-z0-9+.-]+);base64,/i.exec(dataUrl);
    const ext = mimeMatch ? mimeToExt(mimeMatch[1].toLowerCase()) : 'jpg';
    const key = productImageKey(id, ext);
    const cdnUrl = await uploadDataUrlImage(c.env.IMAGES, c.env, dataUrl, key);
    if (!cdnUrl) {
      return c.json({ success: false, error: 'Échec envoi image vers R2 (format ou taille invalide, max 4 Mo).' }, 400);
    }
    url = cdnUrl;
  }
  if (!url) return c.json({ success: false, error: 'URL image ou data_url obligatoire' }, 400);
  if (!isAllowedImageUrl(url)) {
    return c.json({ success: false, error: 'URL image non autorisée (HTTPS CDN / R2 uniquement).' }, 400);
  }

  const is_primary = body.is_primary ? 1 : 0;
  if (is_primary) {
    await c.env.DB.prepare(`UPDATE product_images SET is_primary = 0 WHERE product_id = ?`).bind(id).run();
  }
  const ins = await c.env.DB.prepare(
    `INSERT INTO product_images (product_id, url, alt_text, sort_order, is_primary) VALUES (?, ?, ?, ?, ?)`
  ).bind(id, url, String(body.alt_text || ''), Number(body.sort_order || 0), is_primary).run();
  const newId = Number(ins.meta.last_row_id || 0);
  const row = newId
    ? await c.env.DB.prepare(`SELECT * FROM product_images WHERE id = ?`).bind(newId).first()
    : await c.env.DB.prepare(
        `SELECT * FROM product_images WHERE product_id = ? AND url = ? ORDER BY id DESC LIMIT 1`
      ).bind(id, url).first();
  if (is_primary) {
    try { await c.env.DB.prepare(`UPDATE products SET image_url = ? WHERE id = ?`).bind(url, id).run(); } catch { /* */ }
  }
  await afterBusinessMutation(c.env.CACHE);
  const isR2Storage = (() => {
    try {
      return new URL(url).hostname === 'cdn1.afmarbre.com';
    } catch {
      return false;
    }
  })();
  return c.json({ success: true, data: row, meta: { storage: isR2Storage ? 'r2' : 'url' } }, 201);
});

app.put('/api/catalog/products/:id/images/:imageId', async (c) => {
  await ensureCatalogTables(c.env.DB);
  const productId = c.req.param('id');
  const imageId = c.req.param('imageId');
  const existing = await c.env.DB.prepare(
    `SELECT * FROM product_images WHERE id = ? AND product_id = ?`
  ).bind(imageId, productId).first() as any;
  if (!existing) return c.json({ success: false, error: 'Image introuvable' }, 404);
  const body = await c.req.json().catch(() => ({}));
  let url = String(body.url || existing.url || '').trim();
  const dataUrl = String(body.data_url || body.dataUrl || '').trim();
  if (dataUrl.startsWith('data:image') && c.env.IMAGES) {
    const mimeMatch = /^data:(image\/[a-z0-9+.-]+);base64,/i.exec(dataUrl);
    const ext = mimeMatch ? mimeToExt(mimeMatch[1].toLowerCase()) : 'jpg';
    const key = productImageKey(productId, ext);
    const cdnUrl = await uploadDataUrlImage(c.env.IMAGES, c.env, dataUrl, key);
    if (!cdnUrl) {
      return c.json({ success: false, error: 'Échec envoi image vers R2 (format ou taille invalide, max 4 Mo).' }, 400);
    }
    const oldKey = keyFromCdnUrl(c.env, String(existing.url));
    if (oldKey && oldKey !== key) await deleteR2Object(c.env.IMAGES, oldKey);
    url = cdnUrl;
  }
  const is_primary = body.is_primary ? 1 : Number(existing.is_primary || 0);
  if (body.is_primary) {
    await c.env.DB.prepare(`UPDATE product_images SET is_primary = 0 WHERE product_id = ?`).bind(productId).run();
  }
  await c.env.DB.prepare(
    `UPDATE product_images SET url = ?, alt_text = ?, is_primary = ? WHERE id = ? AND product_id = ?`
  ).bind(url, body.alt_text != null ? String(body.alt_text) : existing.alt_text || '', is_primary, imageId, productId).run();
  if (is_primary) {
    try { await c.env.DB.prepare(`UPDATE products SET image_url = ? WHERE id = ?`).bind(url, productId).run(); } catch { /* */ }
  }
  const row = await c.env.DB.prepare(`SELECT * FROM product_images WHERE id = ?`).bind(imageId).first();
  await afterBusinessMutation(c.env.CACHE);
  return c.json({ success: true, data: row, message: 'Image mise à jour.' });
});

app.delete('/api/catalog/products/:id/images/:imageId', async (c) => {
  await ensureCatalogTables(c.env.DB);
  const imageId = c.req.param('imageId');
  const productId = c.req.param('id');
  const existing = await c.env.DB.prepare(
    `SELECT * FROM product_images WHERE id = ? AND product_id = ?`
  ).bind(imageId, productId).first() as any;
  if (existing?.url) {
    const key = keyFromCdnUrl(c.env, String(existing.url));
    if (key) await deleteR2Object(c.env.IMAGES, key);
  }
  await c.env.DB.prepare(`DELETE FROM product_images WHERE id = ? AND product_id = ?`)
    .bind(imageId, productId).run();
  if (existing?.is_primary) {
    const next = await c.env.DB.prepare(
      `SELECT url FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1`
    ).bind(productId).first() as any;
    try {
      await c.env.DB.prepare(`UPDATE products SET image_url = ? WHERE id = ?`).bind(next?.url || '', productId).run();
      if (next?.url) {
        await c.env.DB.prepare(`UPDATE product_images SET is_primary = 1 WHERE product_id = ? AND url = ?`).bind(productId, next.url).run();
      }
    } catch { /* */ }
  }
  await afterBusinessMutation(c.env.CACHE);
  return c.json({ success: true, message: 'Image supprimée.' });
});

/** Public catalog list (no auth) — for future website */
app.get('/api/public/catalog', async (c) => {
  await ensureCatalogTables(c.env.DB);
  const settings = await c.env.DB.prepare(`SELECT * FROM catalog_settings WHERE id = 1`).first() as any;
  const { results } = await c.env.DB.prepare(`
    SELECT p.id, p.sku, p.name, p.category, p.unit,
           CASE WHEN COALESCE(s.show_prices, 1) = 1 THEN p.price ELSE NULL END as price,
           CASE WHEN COALESCE(s.show_stock, 0) = 1 THEN p.stock_quantity ELSE NULL END as stock_quantity,
           COALESCE(c.slug, p.slug) as slug,
           COALESCE(c.short_description, p.short_description, p.description, '') as short_description,
           c.long_description,
           COALESCE(c.is_featured, 0) as is_featured,
           (SELECT url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.sort_order LIMIT 1) as image_url
    FROM products p
    LEFT JOIN product_catalog c ON c.product_id = p.id
    CROSS JOIN catalog_settings s
    WHERE p.is_active = 1 AND COALESCE(c.is_public, p.is_public, 0) = 1
    ORDER BY COALESCE(c.is_featured, 0) DESC, p.name
  `).all();
  return c.json({
    success: true,
    data: {
      settings: {
        site_title: settings?.site_title,
        site_tagline: settings?.site_tagline,
        show_prices: settings?.show_prices,
        contact_email: settings?.contact_email,
        contact_phone: settings?.contact_phone,
      },
      products: results || [],
    },
  });
});

/* ─── Vendors ─── */

app.get('/api/vendors', async (c) => {
  let results: any[] = [];
  try {
    const r = await c.env.DB.prepare(`
      SELECT v.*,
        COALESCE((
          SELECT SUM(b.total - COALESCE(b.amount_paid, 0))
          FROM bills b
          WHERE b.vendor_id = v.id
            AND b.status NOT IN ('cancelled','paid','draft')
            AND (b.total - COALESCE(b.amount_paid, 0)) > 0.001
        ), 0) as balance_due
      FROM vendors v
      ORDER BY v.name
    `).all();
    results = r.results || [];
  } catch {
    const r = await c.env.DB.prepare(`SELECT * FROM vendors ORDER BY name`).all();
    results = r.results || [];
  }
  return c.json({ success: true, data: results });
});

app.post('/api/vendors', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const verr = validateVendorWrite(body);
  if (verr) return apiFail(c, Object.values(verr)[0] || 'Validation', 'VALIDATION', verr);
  const { name, ice = '', if_number = '', address = '', city = '', phone = '', email = '' } = body;
  if (!name) return c.json({ success: false, error: 'Le nom du fournisseur est obligatoire' }, 400);
  const result = await c.env.DB.prepare(`INSERT INTO vendors (name, ice, if_number, address, city, phone, email) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(name, ice, if_number, address, city, phone, email).run();
  const vendor = await c.env.DB.prepare(`SELECT * FROM vendors WHERE id = ?`).bind(result.meta.last_row_id).first();
  return c.json({ success: true, data: vendor, message: 'Fournisseur enregistré dans la base de données.' }, 201);
});


app.put('/api/vendors/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!id) return c.json({ success: false, error: 'ID invalide' }, 400);
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  if (!name) return c.json({ success: false, error: 'Le nom du fournisseur est obligatoire' }, 400);
  const ice = String(body.ice || '');
  const if_number = String(body.if_number || '');
  const address = String(body.address || '');
  const city = String(body.city || '');
  const phone = String(body.phone || '');
  const email = String(body.email || '');
  await c.env.DB.prepare(
    `UPDATE vendors SET name=?, ice=?, if_number=?, address=?, city=?, phone=?, email=? WHERE id=?`
  ).bind(name, ice, if_number, address, city, phone, email, id).run();
  try { await bumpCacheGen(c.env.CACHE); } catch { /* */ }
  return c.json({ success: true, data: { id } });
});

app.delete('/api/vendors/:id', async (c) => {
  try {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const body = await c.req.json().catch(() => ({}));
    const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
    if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);
    const id = c.req.param('id');
    await c.env.DB.prepare(`DELETE FROM vendors WHERE id = ?`).bind(id).run();
    await afterBusinessMutation(c.env.CACHE);
    await writeAudit(c.env.DB, {
      username: gate.username, role: gate.role, action: 'vendor.delete',
      entity: 'vendors', entity_id: id, ip: c.req.header('cf-connecting-ip') || '',
    });
    return c.json({ success: true, message: 'Fournisseur supprimé de la base de données.' });
  } catch (e: any) {
    return c.json({ success: false, error: e?.message || 'Échec de la suppression', code: 'DELETE_FAILED' }, 400);
  }
});


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
  for (const sql of [
    `ALTER TABLE company_settings ADD COLUMN qr_client_situation INTEGER DEFAULT 0`,
    `ALTER TABLE company_settings ADD COLUMN qr_situation_ttl_days INTEGER DEFAULT 90`,
    `ALTER TABLE company_settings ADD COLUMN client_data_retention_days INTEGER DEFAULT 1825`,
  ]) {
    try { await db.prepare(sql).run(); } catch { /* */ }
  }

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
/** Inline SVG data-URI — reliable in print/PDF (no broken external img). */
function atlasQrImg(_origin: string | undefined, data: string, size = 100): string {
  if (!data) return '';
  try {
    const svg = qrToSvg(String(data), size, 2);
    // base64 is more reliable for print / PDF / img tags than utf8 data URIs
    const bytes = new TextEncoder().encode(svg);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return `data:image/svg+xml;base64,${btoa(bin)}`;
  } catch {
    return '';
  }
}

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
  for (const col of [
    'ALTER TABLE invoice_items ADD COLUMN list_price REAL DEFAULT 0',
    'ALTER TABLE invoice_items ADD COLUMN discount_amount REAL DEFAULT 0',
    'ALTER TABLE invoice_items ADD COLUMN discount_percent REAL DEFAULT 0',
  ]) {
    try { await db.prepare(col).run(); } catch { /* exists */ }
  }

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
  for (const col of [
    `ALTER TABLE stock_movements ADD COLUMN reference TEXT DEFAULT ''`,
    `ALTER TABLE stock_movements ADD COLUMN created_by TEXT DEFAULT ''`,
  ]) {
    try { await db.prepare(col).run(); } catch { /* exists */ }
  }

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
  opts?: { createdBy?: string;
    /** When set, may send FCM low-stock push */
    env?: any; type?: string; allowNegative?: boolean; locationId?: number | null; skipLocation?: boolean },
) {
  if (!productId) return null;
  const delta = Number(qtySigned);
  if (!Number.isFinite(delta)) return null;
  await ensureStockMovementsTable(db);

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
    `INSERT INTO stock_movements (product_id, type, quantity, previous_quantity, new_quantity, reason, reference, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    productId,
    type,
    Math.abs(delta),
    prev,
    newQty,
    reason || '',
    reference || '',
    opts?.createdBy || '',
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
  for (const sql of [
    `ALTER TABLE invoices ADD COLUMN void_reason TEXT DEFAULT ''`,
    `ALTER TABLE invoices ADD COLUMN voided_at TEXT`,
    `ALTER TABLE invoices ADD COLUMN voided_by TEXT DEFAULT ''`,
  ]) {
    try { await db.prepare(sql).run(); } catch { /* */ }
  }

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
/* ─── Invoices ─── */

/* GET /api/invoices + /:id → worker/routes/invoices.ts */

app.post('/api/invoices', async (c) => {
  try {
  // Magasinier / user: no invoice / quick-sale creation (queue via mobile-actions only)
  const gate = requireBizMutator(c);
  if (!gate.ok) return gate.response;

  await ensureInvoiceItemPromoColumns(c.env.DB);
  await ensureInvoiceTaxExempt(c.env.DB);
  await ensureClientTaxExempt(c.env.DB);
  await ensureProductBulkDiscounts(c.env.DB);

  const body = await c.req.json().catch(() => ({}));
  const idemKey = extractIdempotencyKey(c, body);
  if (idemKey) {
    const cached = await idempotencyGet(c.env.DB, `inv:${idemKey}`);
    if (cached) return c.json(cached.body, cached.status as any);
  }
  // Period lock (Phase 1)
  const lockCheck = await assertPeriodOpen(c.env.DB, body.issue_date);
  if (!lockCheck.ok) return c.json({ success: false, error: lockCheck.error, code: 'PERIOD_LOCKED' }, 403);

  const {
    client_id, client_name, client_ice = '', client_address = '', client_city = '', client_email = '', client_phone = '',
    issue_date, due_date = null, notes = '', items = [], status = 'sent',
  } = body;
  const verrInv = validateInvoiceWrite(body);
  if (verrInv) return apiFail(c, verrInv.client_name || verrInv.items || Object.values(verrInv)[0] || 'Validation', 'VALIDATION', verrInv);
  if (!client_name || !items.length) return apiFail(c, 'Le nom du client et au moins une ligne sont obligatoires', 'VALIDATION');
  const isQuote = status === 'quote' || status === 'devis';
  const finalStatus = isQuote ? 'quote' : status;
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const isQuickSale = !isQuote && (body.quick_sale === true || body.doc_kind === 'quick_sale' || body.doc_kind === 'ticket');
  const number = await nextDocumentNumber(
    c.env.DB,
    isQuote ? 'quote' : (isQuickSale ? 'quick_sale' : 'invoice'),
    settings,
    c.env,
  );
  const docKind = isQuote ? 'quote' : (isQuickSale ? 'quick_sale' : 'invoice');

  // Tax exempt: body flag OR client.tax_exempt OR vente rapide (jamais de TVA)
  let taxExempt = !!body.tax_exempt || isQuickSale;
  if (!taxExempt && client_id) {
    const cl = await c.env.DB.prepare(`SELECT tax_exempt FROM clients WHERE id = ?`).bind(client_id).first() as any;
    if (cl?.tax_exempt) taxExempt = true;
  }

  // Factures FA : TVA 20 % par défaut. Vente rapide VR : 0 % (prix tels quels, pas de T.V.A.)
  let defaultTax = isQuickSale ? 0 : Number(settings?.tax_rate ?? 20);
  if (!isQuickSale) {
    if (!Number.isFinite(defaultTax) || defaultTax < 0) defaultTax = 20;
    if (!taxExempt && defaultTax === 0) defaultTax = 20;
  }
  let subtotal = 0, tax_amount = 0;
  const lineItems: any[] = [];

  // prices_ttc: true → unit_price / list_price saisis TTC (factures FA uniquement, jamais VR)
  const pricesTtc = !isQuickSale && !!(body.prices_ttc || body.price_mode === 'ttc');

  for (const item of items) {
    const qty = Number(item.quantity || 0);
    if (qty <= 0) continue;
    let listP = Number(item.list_price ?? item.catalog_price ?? 0);
    let unitP = Number(item.unit_price ?? listP);
    let lineName = String(item.product_name || item.name || '').trim();
    let lineSku = String(item.sku || '').trim();
    let lineUnit = String(item.unit || '').trim();
    if (item.client_price !== undefined && item.client_price !== null && item.client_price !== '') {
      unitP = Number(item.client_price);
    }

    // Catalogue price + name from product when linked
    if (item.product_id) {
      const prod = await c.env.DB.prepare(
        `SELECT name, sku, price, bulk_discounts, unit, tax_rate FROM products WHERE id = ?`
      ).bind(item.product_id).first() as any;
      if (prod) {
        if (!lineName) lineName = String(prod.name || '').trim();
        if (!lineSku) lineSku = String(prod.sku || '').trim();
        if (!lineUnit) lineUnit = String(prod.unit || '').trim();
        const catalog = Number(prod.price || 0);
        if (!listP || listP < 0.001) listP = catalog || unitP;
        if (catalog > unitP && listP < catalog) listP = catalog;
        if (!unitP || unitP < 0.001) unitP = catalog || listP;
        if (listP > 0 && Math.abs(unitP - listP) < 0.001) {
          const bulk = applyBulkDiscount(listP, qty, prod.bulk_discounts);
          if (bulk.bulk_percent > 0) unitP = bulk.unit_price;
        }
        if (!isQuickSale && (item.tax_rate === undefined || item.tax_rate === null || item.tax_rate === '')) {
          if (prod.tax_rate != null && Number(prod.tax_rate) > 0) item.tax_rate = prod.tax_rate;
        }
      }
    }
    if (!lineName) lineName = 'Article';
    if (!listP) listP = unitP;

    let taxRate = isQuickSale ? 0 : Number(item.tax_rate ?? defaultTax);
    if (!isQuickSale) {
      if (!Number.isFinite(taxRate) || taxRate < 0) taxRate = defaultTax;
      if (!taxExempt && taxRate === 0 && defaultTax > 0) taxRate = defaultTax;
      if (taxExempt) taxRate = 0;
    }

    // Convert TTC → HT for storage (unit_price always HT in DB)
    let unitHt = unitP;
    let listHt = listP;
    if (pricesTtc && taxRate > 0) {
      const factor = 1 + taxRate / 100;
      unitHt = unitP / factor;
      listHt = listP / factor;
    }
    const lineHt = qty * unitHt;
    const lineTtc = pricesTtc && taxRate > 0 ? qty * unitP : lineHt * (1 + taxRate / 100);
    const lineTaxReal = lineTtc - lineHt;
    subtotal += lineHt;
    tax_amount += lineTaxReal;
    const discAmt = Math.max(0, listHt - unitHt) * qty;
    const discPct = listHt > 0 ? Math.max(0, ((listHt - unitHt) / listHt) * 100) : 0;
    lineItems.push({
      ...item,
      product_name: lineName,
      sku: lineSku || item.sku || '',
      unit: lineUnit || item.unit || '',
      quantity: qty,
      list_price: roundDh(listHt),
      unit_price: roundDh(unitHt),
      tax_rate: taxRate,
      discount_amount: discAmt,
      discount_percent: discPct,
      line_total: roundDh(lineTtc),
    });
  }

  if (!lineItems.length) return c.json({ success: false, error: 'Aucune ligne valide.' }, 400);

  subtotal = roundDh(subtotal); tax_amount = roundDh(tax_amount); const total = roundDh(subtotal + tax_amount);

  // Credit limit: only for real invoices (not devis)
  if (!isQuote) {
    await ensureClientCreditLimit(c.env.DB);
    const credit = await checkClientCreditLimit(c.env.DB, {
      clientId: client_id ? Number(client_id) : null,
      clientName: client_name,
      clientIce: client_ice,
      addAmount: total,
    });
    if (!credit.ok) {
      return c.json({
        success: false,
        error: credit.message || 'Limite de crédit dépassée',
        code: 'CREDIT_LIMIT',
        data: { outstanding: credit.outstanding, limit: credit.limit, invoice_total: total },
      }, 400);
    }
  }

  let invResult: any;
  try {
    invResult = await c.env.DB.prepare(
      `INSERT INTO invoices (number, client_id, client_name, client_ice, client_address, client_city, client_email, client_phone, issue_date, due_date, status, subtotal, tax_amount, total, notes, amount_paid, tax_exempt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(number, client_id || null, client_name, client_ice, client_address, client_city, client_email, client_phone, issue_date || new Date().toISOString().slice(0, 10), due_date, finalStatus, subtotal, tax_amount, total, notes, 0, taxExempt ? 1 : 0).run();
  } catch {
    invResult = await c.env.DB.prepare(
      `INSERT INTO invoices (number, client_id, client_name, client_ice, client_address, client_city, client_email, client_phone, issue_date, due_date, status, subtotal, tax_amount, total, notes, amount_paid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(number, client_id || null, client_name, client_ice, client_address, client_city, client_email, client_phone, issue_date || new Date().toISOString().slice(0, 10), due_date, finalStatus, subtotal, tax_amount, total, notes, 0).run();
  }
  const invoiceId = invResult.meta.last_row_id;
  await ensureInvoicePublicToken(c.env.DB);
  const pubTok = makePublicToken();
  try {
    await c.env.DB.prepare(`UPDATE invoices SET public_token = ? WHERE id = ?`).bind(pubTok, invoiceId).run();
  } catch { /* column missing on very old schema */ }

  for (const item of lineItems) {
    try {
      await c.env.DB.prepare(
        `INSERT INTO invoice_items (invoice_id, product_id, product_name, sku, quantity, unit_price, tax_rate, line_total, list_price, discount_amount, discount_percent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(invoiceId, item.product_id || null, item.product_name, item.sku || '', item.quantity, item.unit_price, item.tax_rate, item.line_total, item.list_price, item.discount_amount, item.discount_percent).run();
    } catch (insErr) {
      // Schema without promo columns — basic insert
      await c.env.DB.prepare(
        `INSERT INTO invoice_items (invoice_id, product_id, product_name, sku, quantity, unit_price, tax_rate, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(invoiceId, item.product_id || null, item.product_name, item.sku || '', item.quantity, item.unit_price, item.tax_rate, item.line_total).run();
    }
    // Stock is NEVER reduced for quotes — only real invoices (atomic; fail if oversell)
    if (!isQuote && item.product_id) {
      try {
        await applyStockDelta(c.env.DB, item.product_id, -Number(item.quantity), number.startsWith('VR') ? 'Vente rapide' : 'Facture', number, { type: 'sale', env: c.env });
      } catch (stErr: any) {
        if (stErr?.code === 'INSUFFICIENT_STOCK') {
          // Best-effort rollback of this invoice to avoid orphan unpaid stock-less doc
          try {
            await c.env.DB.prepare(`DELETE FROM invoice_items WHERE invoice_id = ?`).bind(invoiceId).run();
            await c.env.DB.prepare(`DELETE FROM invoices WHERE id = ?`).bind(invoiceId).run();
          } catch { /* */ }
          return c.json({
            success: false,
            error: stErr.message || 'Stock insuffisant',
            code: 'INSUFFICIENT_STOCK',
            product_id: stErr.product_id,
            available: stErr.available,
            requested: stErr.requested,
          }, 400);
        }
        // v243.3: any other failure (D1 corruption, lock…) must NOT leave an
        // invoice whose stock was never deducted — roll back and surface it.
        console.error('stock delta invoice', stErr);
        try {
          await c.env.DB.prepare(`DELETE FROM invoice_items WHERE invoice_id = ?`).bind(invoiceId).run();
          await c.env.DB.prepare(`DELETE FROM invoices WHERE id = ?`).bind(invoiceId).run();
        } catch { /* */ }
        const safe = toClientError(stErr);
        return c.json({
          success: false,
          error: `Stock non déduit — facture annulée. ${safe.error}`,
          code: safe.code,
        }, safe.status as any);
      }
    }
  }

  // Transferts auto si stock magasin bas
  try {
    const pids = (lineItems || []).map((it: any) => it.product_id).filter(Boolean);
    if (pids.length && !isQuote) {
      const auto = await runAutoTransfers(c.env.DB, pids);
      if (auto.transferred) console.log('auto-transfer', auto.details);
    }
  } catch (e) { console.error('auto-transfer after invoice', e); }

  if (isQuickSale) {
    try {
      await c.env.DB.prepare(`UPDATE invoices SET doc_kind = 'quick_sale' WHERE id = ?`).bind(invoiceId).run();
    } catch { /* */ }
  }

  const invoice = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(invoiceId).first() as any;
  const { results: invItems } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).bind(invoiceId).all();

  let notify: any = null;
  try {
    const origin = new URL(c.req.url).origin;
    notify = await notifyClientDocument(c.env, {
      origin,
      token: pubTok,
      number,
      docLabel: isQuote ? 'Devis' : 'Facture',
      clientName: client_name,
      clientEmail: client_email,
      clientPhone: client_phone,
      companyName: settings?.company_name || 'Société',
      total,
      currency: settings?.currency || 'MAD',
    });
  } catch (e) {
    console.error('notifyClientDocument', e);
  }

  const msgBase = isQuote
    ? 'Devis enregistré (non comptabilisé, stock intact).'
    : isQuickSale
      ? 'Vente rapide enregistrée et stock déduit.'
      : 'Facture enregistrée dans la base de données.';
  const notifyBits: string[] = [];
  if (notify?.emailed) notifyBits.push('e-mail envoyé au client');
  if (notify?.whatsapp_url) notifyBits.push('lien WhatsApp prêt');
  if (notify?.error && !notify?.emailed) notifyBits.push(`e-mail non envoyé (${notify.error})`);
  if (taxExempt) notifyBits.push('exonéré de TVA');
  const msg = msgBase + (notifyBits.length ? ' ' + notifyBits.join(' · ') + '.' : '');

  const payload = {
    success: true,
    data: {
      ...invoice,
      items: invItems,
      public_url: pubTok ? `${new URL(c.req.url).origin}/api/public/invoices/${pubTok}` : null,
      whatsapp_url: notify?.whatsapp_url || null,
      emailed: !!notify?.emailed,
    },
    message: msg,
  };
  try {
    await archiveInvoiceSnapshot(c.env, invoice, invItems || []);
  } catch { /* */ }
  await afterBusinessMutation(c.env.CACHE);
  if (idemKey) await idempotencyPut(c.env.DB, `inv:${idemKey}`, 'POST /invoices', 201, payload);
  return c.json(payload, 201);
  } catch (e: any) {
    console.error('POST /api/invoices', e);
    return c.json({
      success: false,
      error: e?.message || 'Erreur lors de la création de la facture',
      code: 'INVOICE_CREATE_FAILED',
      detail: String(e?.message || e),
    }, 500);
  }
});

/**
 * Remboursement (avoir WR-) lié à une facture existante.
 * - Motif obligatoire (code + détail)
 * - Retour stock des quantités remboursées
 * - Ajustement solde / amount_paid sur la facture d’origine
 * - Écriture de solde si encaissement à rembourser
 */
app.post('/api/invoices/remboursement', async (c) => {
  try {
    await ensureInvoiceItemPromoColumns(c.env.DB);
    await ensureInvoiceTaxExempt(c.env.DB);
    await ensureInvoiceRefundColumns(c.env.DB);
    await ensureExpenseTypeColumn(c.env.DB);
    await ensurePaymentHistoryTable(c.env.DB);

    const body = await c.req.json().catch(() => ({}));
    const idemKey = extractIdempotencyKey(c, body);
    if (idemKey) {
      const cached = await idempotencyGet(c.env.DB, `wr:${idemKey}`);
      if (cached) return c.json(cached.body, cached.status as any);
    }
    const lockCheck = await assertPeriodOpen(c.env.DB, body.issue_date);
    if (!lockCheck.ok) return c.json({ success: false, error: lockCheck.error, code: 'PERIOD_LOCKED' }, 403);
    const sourceId = Number(body.refund_of_invoice_id || body.invoice_id || 0);
    const reasonCode = String(body.refund_reason_code || body.reason_code || '').trim();
    const reasonDetail = String(body.refund_reason || body.reason_detail || body.notes || '').trim();
    const issue_date = String(body.issue_date || new Date().toISOString().slice(0, 10));
    const itemsIn = Array.isArray(body.items) ? body.items : [];

    if (!sourceId) {
      return c.json({ success: false, error: 'Sélectionnez une facture d’origine à rembourser.', code: 'SOURCE_REQUIRED' }, 400);
    }
    const reasonCheck = validateRefundReason(reasonCode, reasonDetail);
    if (!reasonCheck.ok) {
      return c.json({ success: false, error: reasonCheck.error, code: 'REASON_REQUIRED' }, 400);
    }

    const source = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(sourceId).first() as any;
    if (!source) return c.json({ success: false, error: 'Facture d’origine introuvable' }, 404);
    if (source.status === 'quote' || source.status === 'devis') {
      return c.json({ success: false, error: 'Impossible de rembourser un devis. Convertissez-le d’abord en facture.' }, 400);
    }
    if (source.status === 'cancelled') {
      return c.json({ success: false, error: 'Cette facture est annulée — pas de remboursement.' }, 400);
    }
    if (source.status === 'remboursement' || source.doc_kind === 'remboursement') {
      return c.json({ success: false, error: 'Impossible de rembourser un avoir / remboursement.' }, 400);
    }

    const { results: srcItems } = await c.env.DB.prepare(
      `SELECT * FROM invoice_items WHERE invoice_id = ?`
    ).bind(sourceId).all();
    const byId = new Map((srcItems || []).map((it: any) => [Number(it.id), it]));

    // Already refunded qty per source line (sum of prior credit notes)
    const { results: priorCredits } = await c.env.DB.prepare(
      `SELECT id FROM invoices WHERE refund_of_invoice_id = ? AND (status = 'remboursement' OR COALESCE(doc_kind,'') = 'remboursement' OR IFNULL(number,'') LIKE 'WR-%')`
    ).bind(sourceId).all();
    const refundedQty = new Map<number, number>();
    for (const cr of (priorCredits || []) as any[]) {
      const { results: crItems } = await c.env.DB.prepare(
        `SELECT product_id, product_name, quantity, notes FROM invoice_items WHERE invoice_id = ?`
      ).bind(cr.id).all();
      for (const ci of (crItems || []) as any[]) {
        // Match by product_id + name fallback
        const key = Number(ci.product_id || 0);
        const meta = String(ci.notes || '');
        const m = meta.match(/src_item:(\d+)/);
        const srcItemId = m ? Number(m[1]) : 0;
        const mapKey = srcItemId || key;
        refundedQty.set(mapKey, (refundedQty.get(mapKey) || 0) + Number(ci.quantity || 0));
      }
    }

    if (!itemsIn.length) {
      return c.json({ success: false, error: 'Sélectionnez au moins une ligne à rembourser.', code: 'ITEMS_REQUIRED' }, 400);
    }

    const lineItems: any[] = [];
    let subtotal = 0;
    let tax_amount = 0;

    const DISPOSITION_OK = new Set(['broken_unusable', 'lost_not_received', 'customer_keeps', 'destroyed', 'other']);

    for (const raw of itemsIn) {
      const srcItemId = Number(raw.invoice_item_id || raw.id || 0);
      const src = byId.get(srcItemId);
      if (!src) {
        return c.json({ success: false, error: `Ligne source #${srcItemId} introuvable sur la facture ${source.number}` }, 400);
      }
      const maxQty = Number(src.quantity || 0);
      const already = refundedQty.get(srcItemId) || 0;
      const remaining = Math.max(0, maxQty - already);
      const qty = Number(raw.quantity || 0);
      if (qty <= 0) continue;
      if (qty > remaining + 1e-9) {
        return c.json({
          success: false,
          error: `Quantité trop élevée pour « ${src.product_name} » (reste remboursable : ${remaining}).`,
          code: 'QTY_EXCEEDED',
        }, 400);
      }
      // restock default true; if false, disposition required
      const restock =
        raw.restock === false || raw.restock === 0 || raw.restock === '0' || raw.restock === 'false'
          ? false
          : true;
      const disposition = String(raw.disposition || raw.disposition_code || '').trim();
      if (!restock) {
        if (!disposition || !DISPOSITION_OK.has(disposition)) {
          return c.json({
            success: false,
            error: `Pour « ${src.product_name} » : sans remise en stock, choisissez une disposition (cassé, perdu, client conserve…).`,
            code: 'DISPOSITION_REQUIRED',
          }, 400);
        }
      }
      const unitP = Number(src.unit_price || 0); // always HT in DB
      // TVA: mirror source invoice — VR / tax_exempt → 0 %; else line rate (or pro-rata from header)
      const sourceIsVr =
        source.doc_kind === 'quick_sale' ||
        source.doc_kind === 'ticket' ||
        String(source.number || '').toUpperCase().startsWith('VR');
      const sourceExempt =
        !!Number(source.tax_exempt) ||
        sourceIsVr ||
        (Number(source.tax_amount || 0) <= 0.001 &&
          Math.abs(Number(source.subtotal || 0) - Number(source.total || 0)) < 0.02);
      let taxRate = sourceExempt ? 0 : Number(src.tax_rate || 0);
      if (!sourceExempt && (!Number.isFinite(taxRate) || taxRate < 0)) taxRate = 0;
      if (!sourceExempt && taxRate <= 0 && Number(source.tax_amount || 0) > 0.001 && Number(source.subtotal || 0) > 0.001) {
        taxRate = (Number(source.tax_amount) / Number(source.subtotal)) * 100;
      }
      if (sourceExempt) taxRate = 0;
      const lineHt = qty * unitP;
      const lineTax = sourceExempt ? 0 : lineHt * (taxRate / 100);
      subtotal += lineHt;
      tax_amount += lineTax;
      lineItems.push({
        product_id: src.product_id || null,
        product_name: src.product_name,
        sku: src.sku || '',
        quantity: qty,
        restock,
        disposition: restock ? '' : disposition,
        src_item_id: srcItemId,
        unit_price: unitP,
        list_price: Number(src.list_price || unitP),
        tax_rate: taxRate,
        discount_amount: 0,
        discount_percent: 0,
        line_total: roundDh(lineHt + lineTax),
      });
    }

    if (!lineItems.length) {
      return c.json({ success: false, error: 'Aucune quantité valide à rembourser.' }, 400);
    }

    subtotal = roundDh(subtotal);
    tax_amount = roundDh(tax_amount);
    // Safety: never invent TVA on VR / exempt sources
    const sourceIsVrFinal =
      source.doc_kind === 'quick_sale' ||
      source.doc_kind === 'ticket' ||
      String(source.number || '').toUpperCase().startsWith('VR') ||
      !!Number(source.tax_exempt);
    if (sourceIsVrFinal) tax_amount = 0;
    const total = roundDh(subtotal + tax_amount);

    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    // Ensure WR prefix is valid before allocating number
    const prefixCheck = validateCreditPrefix(settings?.credit_prefix || 'WR-');
    if (!prefixCheck.ok) {
      return c.json({ success: false, error: prefixCheck.error, code: prefixCheck.code }, 400);
    }
    if (settings) settings.credit_prefix = prefixCheck.value;

    let number = await nextDocumentNumber(c.env.DB, 'credit_note', settings, c.env);
    // Uniqueness guard (race / import)
    const clash = await c.env.DB.prepare(`SELECT id FROM invoices WHERE number = ?`).bind(number).first();
    if (clash) {
      return c.json({
        success: false,
        error: `Le numéro ${number} existe déjà. Augmentez « Prochain n° remboursement (WR) » dans Paramètres → Facturation.`,
        code: 'WR_NUMBER_TAKEN',
      }, 409);
    }
    if (!number || number.length > 40) {
      return c.json({ success: false, error: 'Numéro WR généré invalide.', code: 'WR_NUMBER_INVALID' }, 500);
    }

    const disclaimer =
      'IMPORTANT — Politique de remboursement : un remboursement sans motif valable n’est PAS accepté. ' +
      'Motifs acceptés uniquement : erreur de notre part, article cassé/défectueux envoyé (non causé par le client), ' +
      'mauvais article / non conforme, quantité manquante, dommage transport. ' +
      `Motif retenu : ${reasonCheck.full}`;

    const notes = [
      `Avoir / remboursement WR sur facture ${source.number}`,
      disclaimer,
      body.notes ? String(body.notes).trim() : '',
    ].filter(Boolean).join('\n\n');

    let invResult: any;
    try {
      invResult = await c.env.DB.prepare(
        `INSERT INTO invoices (
          number, client_id, client_name, client_ice, client_address, client_city, client_email, client_phone,
          issue_date, due_date, status, subtotal, tax_amount, total, notes, amount_paid, tax_exempt,
          doc_kind, refund_of_invoice_id, refund_reason, refund_reason_code
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'remboursement', ?, ?, ?, ?, ?, ?, 'remboursement', ?, ?, ?)`
      ).bind(
        number,
        source.client_id || null,
        source.client_name,
        source.client_ice || '',
        source.client_address || '',
        source.client_city || '',
        source.client_email || '',
        source.client_phone || '',
        issue_date,
        null,
        subtotal,
        tax_amount,
        total,
        notes,
        0, // WR never counts as encaissement / entrée
        source.tax_exempt ? 1 : 0,
        sourceId,
        reasonCheck.full,
        reasonCode,
      ).run();
    } catch {
      // Fallback without extra columns
      invResult = await c.env.DB.prepare(
        `INSERT INTO invoices (
          number, client_id, client_name, client_ice, client_address, client_city, client_email, client_phone,
          issue_date, due_date, status, subtotal, tax_amount, total, notes, amount_paid
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'remboursement', ?, ?, ?, ?, ?)`
      ).bind(
        number,
        source.client_id || null,
        source.client_name,
        source.client_ice || '',
        source.client_address || '',
        source.client_city || '',
        source.client_email || '',
        source.client_phone || '',
        issue_date,
        null,
        subtotal,
        tax_amount,
        total,
        notes,
        0,
      ).run();
    }

    const creditId = invResult.meta.last_row_id;
    await ensureInvoicePublicToken(c.env.DB);
    const pubTok = makePublicToken();
    try {
      await c.env.DB.prepare(`UPDATE invoices SET public_token = ? WHERE id = ?`).bind(pubTok, creditId).run();
    } catch { /* */ }

    for (const item of lineItems) {
      try {
        await c.env.DB.prepare(
          `INSERT INTO invoice_items (invoice_id, product_id, product_name, sku, quantity, unit_price, tax_rate, line_total, list_price, discount_amount, discount_percent)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          creditId,
          item.product_id,
          item.product_name,
          item.sku,
          item.quantity,
          item.unit_price,
          item.tax_rate,
          item.line_total,
          item.list_price,
          0,
          0,
        ).run();
      } catch {
        await c.env.DB.prepare(
          `INSERT INTO invoice_items (invoice_id, product_id, product_name, sku, quantity, unit_price, tax_rate, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(creditId, item.product_id, item.product_name, item.sku, item.quantity, item.unit_price, item.tax_rate, item.line_total).run();
      }
      // Tag source line + restock flag in sku for delete/audit (src_item:N|restock:0|1|disp:code)
      const tag = [
        item.sku || '',
        `src_item:${item.src_item_id}`,
        item.restock ? 'restock:1' : 'restock:0',
        item.disposition ? `disp:${item.disposition}` : '',
      ].filter(Boolean).join('|');
      try {
        await c.env.DB.prepare(
          `UPDATE invoice_items SET sku = ? WHERE invoice_id = ? AND product_name = ? AND quantity = ?`
        ).bind(tag, creditId, item.product_name, item.quantity).run();
      } catch { /* */ }

      if (!item.product_id) continue;

      if (item.restock) {
        try {
          await applyStockDelta(
            c.env.DB,
            item.product_id,
            Number(item.quantity),
            `WR ${number} — retour stock`,
            number,
            { type: 'refund_restock' },
          );
        } catch (e) {
          console.error('restock refund', e);
        }
      } else {
        // No quantity change — audit trail only (qty 0 movement via reason)
        try {
          const dispLabel =
            item.disposition === 'broken_unusable' ? 'cassé/inutilisable'
            : item.disposition === 'lost_not_received' ? 'perdu/non reçu'
            : item.disposition === 'customer_keeps' ? 'client conserve'
            : item.disposition === 'destroyed' ? 'détruit/rebut'
            : item.disposition || 'hors stock';
          await applyStockDelta(
            c.env.DB,
            item.product_id,
            0,
            `WR ${number} — hors stock (${dispLabel}) · qté facturée ${item.quantity}`,
            number,
            { type: 'refund_no_restock' },
          );
        } catch (e) {
          console.error('no-restock audit', e);
        }
      }
    }

    // Balance / original invoice adjustment (FA or VR) — paid or unpaid both allowed
    // Unpaid portion → credit vs debt (raise amount_paid, lower remaining due)
    // Already paid portion (incl. fully paid FA/VR) → cash/card outflow in Solde
    const paid = Number(source.amount_paid || 0);
    const srcTotal = Number(source.total || 0);
    const remaining = Math.max(0, roundDh(srcTotal - paid));
    const fullyPaid = remaining <= 0.001 || source.status === 'paid' || paid + 0.001 >= srcTotal;
    // Fully paid → entire WR is cash refund (money back to client via caisse/banque)
    // Partially paid → split credit vs unpaid + cash for the paid slice
    let creditVsDebt = fullyPaid ? 0 : Math.min(total, remaining);
    let cashRefund = fullyPaid ? total : Math.max(0, roundDh(total - creditVsDebt));
    creditVsDebt = roundDh(creditVsDebt);
    cashRefund = roundDh(cashRefund);
    const refundMethodRaw = String(body.refund_payment_method || body.payment_method || 'cash').toLowerCase();
    const refundMethod = ['cash', 'card', 'transfer', 'cheque', 'other'].includes(refundMethodRaw)
      ? refundMethodRaw
      : 'cash';

    let nextPaid = paid;
    let newStatus = source.status;
    if (creditVsDebt > 0.001) {
      // Settle unpaid AR with credit note
      nextPaid = Math.max(0, Math.min(srcTotal, paid + creditVsDebt));
      if (nextPaid >= srcTotal - 0.001) newStatus = 'paid';
      else if (nextPaid > 0.001) newStatus = 'partial';
      else newStatus = source.status === 'paid' ? 'paid' : 'sent';
    }
    // Pure cash refund on paid ticket/invoice: keep amount_paid / status (still paid)
    if (cashRefund > 0.001 && creditVsDebt < 0.001) {
      nextPaid = paid;
      newStatus = fullyPaid || paid >= srcTotal - 0.001 ? 'paid' : (paid > 0.001 ? 'partial' : newStatus);
    }

    await c.env.DB.prepare(
      `UPDATE invoices SET amount_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(nextPaid, newStatus, sourceId).run();

    // Audit trail on source (note starts with « Avoir » → excluded from sales entrées)
    try {
      await c.env.DB.prepare(
        `INSERT INTO invoice_payments (invoice_id, amount, payment_method, payee, note, paid_at)
         VALUES (?, ?, ?, 'company', ?, ?)`
      ).bind(
        sourceId,
        total,
        cashRefund > 0.001 ? refundMethod : 'other',
        `Avoir ${number} — ${reasonCheck.label}` +
          (cashRefund > 0.001 ? ` · sortie caisse ${cashRefund}` : ' · crédit sur impayé') +
          (creditVsDebt > 0.001 && cashRefund > 0.001 ? ` · dette ${creditVsDebt}` : ''),
        issue_date,
      ).run();
    } catch { /* */ }

    // Cash/card already collected → ledger outflow (Balance)
    if (cashRefund > 0.001) {
      await c.env.DB.prepare(
        `INSERT INTO expenses (category, description, amount, payment_method, expense_date, vendor_name, reference, notes, entry_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'expense')`
      ).bind(
        'Remboursement client',
        `Remboursement ${number} sur ${source.number} — ${reasonCheck.label}`,
        cashRefund,
        refundMethod,
        issue_date,
        source.client_name || '',
        number,
        `credit_id:${creditId}|source:${sourceId}|code:${reasonCode}|paid_was:${paid}`,
      ).run();
    }

    try {
      await writeAudit(c.env.DB, {
        username: sessionUserFromHeader(c.req.header('Authorization')).username,
        role: sessionUserFromHeader(c.req.header('Authorization')).role,
        action: 'invoice.remboursement',
        entity: 'invoices',
        entity_id: String(creditId),
        detail: `WR ${number} on ${source.number} total=${total} restock lines=${lineItems.length}`,
      });
    } catch { /* */ }

    await invalidateDashboardCache(c.env.CACHE).catch(() => {});

    const credit = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(creditId).first() as any;
    const { results: invItems } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).bind(creditId).all();

    const payload = {
      success: true,
      message: cashRefund > 0.001 && creditVsDebt > 0.001
        ? `Avoir ${number} créé sur ${source.number} (payé ou non). Crédit dette ${creditVsDebt} + sortie solde ${cashRefund}.`
        : cashRefund > 0.001
          ? `Avoir ${number} créé sur ${source.number} (document payé). Remboursement client enregistré en solde (${cashRefund}).`
          : `Avoir ${number} créé sur ${source.number}. Crédit appliqué au solde client (${creditVsDebt}).`,
      data: {
        ...credit,
        items: invItems,
        source_invoice_id: sourceId,
        source_number: source.number,
        cash_refund: cashRefund,
        credit_applied_to_debt: creditVsDebt,
        public_url: pubTok ? `${new URL(c.req.url).origin}/api/public/invoices/${pubTok}` : null,
      },
    };
    await afterBusinessMutation(c.env.CACHE);
    if (idemKey) await idempotencyPut(c.env.DB, `wr:${idemKey}`, 'POST /remboursement', 201, payload);
    return c.json(payload, 201);
  } catch (e: any) {
    console.error('POST /api/invoices/remboursement', e);
    return c.json({
      success: false,
      error: 'Impossible de créer le remboursement pour le moment. Vérifiez la facture d’origine et réessayez.',
      code: 'REFUND_FAILED',
      detail: String(e?.message || e),
    }, 500);
  }
});

app.patch('/api/invoices/:id/status', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { status, amount_paid } = body;
  const allowed = ['draft', 'sent', 'paid', 'partial', 'cancelled', 'overdue', 'quote', 'remboursement'];
  if (!allowed.includes(status)) return c.json({ success: false, error: 'Statut invalide' }, 400);

  const inv = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first() as any;
  if (!inv) return c.json({ success: false, error: 'Facture introuvable' }, 404);

  // Formal void (Phase 0): cancel keeps sequential number; reason stored for CGI audit
  if (status === 'cancelled' && inv.status !== 'cancelled') {
    await ensureVoidColumns(c.env.DB);
    const voidReason = String(body.void_reason || body.reason || '').trim();
    if (voidReason.length < 5) {
      return c.json({
        success: false,
        error: 'Motif d’annulation obligatoire (min. 5 caractères). Le numéro de document est conservé (pas de trou de série).',
        code: 'VOID_REASON_REQUIRED',
      }, 400);
    }
    const sess = sessionUserFromHeader(c.req.header('Authorization'));
    try {
      await c.env.DB.prepare(
        `UPDATE invoices SET void_reason = ?, voided_at = datetime('now'), voided_by = ? WHERE id = ?`
      ).bind(voidReason.slice(0, 500), sess.username || '', id).run();
    } catch { /* columns may miss on very old DB until ensure */ }
  }

  // Cancelling a real invoice restores stock; quotes never touched stock
  const wasQuote = inv.status === 'quote' || inv.status === 'devis';
  if (status === 'cancelled' && !wasQuote && inv.status !== 'cancelled') {
    const { results: items } = await c.env.DB.prepare(
      `SELECT product_id, quantity FROM invoice_items WHERE invoice_id = ?`
    ).bind(id).all();
    for (const it of (items || []) as any[]) {
      if (it.product_id) {
        await applyStockDelta(c.env.DB, it.product_id, Number(it.quantity || 0), 'Facture annulée (retour stock)', inv.number);
      }
    }
  }

  const updates = [`status = ?`, `updated_at = datetime('now')`];
  const values: any[] = [status];
  if (amount_paid !== undefined) {
    updates.push(`amount_paid = ?`);
    values.push(amount_paid);
  }
  values.push(id);
  await c.env.DB.prepare(`UPDATE invoices SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  const invoice = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first();
  return c.json({
    success: true,
    data: invoice,
    message: status === 'cancelled' && !wasQuote
      ? ((inv.doc_kind === 'quick_sale' || inv.doc_kind === 'ticket' || String(inv.number || '').startsWith('VR'))
        ? 'Ticket VR annulé — stock rétabli, numéro conservé.'
        : 'Facture annulée — stock rétabli.')
      : 'Statut mis à jour dans la base de données.',
  });
});


/** Record a payment (partial or full). Auto-sets status paid/partial and can create receipt. */

/** Edit invoice / quote — client fields always; full lines for devis or unpaid invoices */
app.put('/api/invoices/:id', async (c) => {
  const id = c.req.param('id');
  await ensureInvoiceItemPromoColumns(c.env.DB);
  await ensureInvoiceTaxExempt(c.env.DB);
  await ensureProductBulkDiscounts(c.env.DB);
  await ensureClientTaxExempt(c.env.DB);

  const body = await c.req.json().catch(() => ({}));
  const inv = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first() as any;
  if (!inv) return c.json({ success: false, error: 'Facture introuvable' }, 404);

  const isQuote = inv.status === 'quote' || inv.status === 'devis';
  const paid = Number(inv.amount_paid || 0);
  const isUnpaid = !isQuote && paid <= 0.0001 && inv.status !== 'paid' && inv.status !== 'cancelled';
  const canEditLines = isQuote || isUnpaid;

  const fields: string[] = [];
  const values: any[] = [];
  const allowed = [
    'client_name', 'client_ice', 'client_address', 'client_city', 'client_email', 'client_phone',
    'notes', 'issue_date', 'due_date', 'client_id',
  ];
  for (const k of allowed) {
    if (body[k] !== undefined) {
      fields.push(`${k} = ?`);
      values.push(body[k]);
    }
  }

  // Tax exempt toggle
  let taxExempt = inv.tax_exempt ? true : false;
  if (body.tax_exempt !== undefined) {
    taxExempt = !!body.tax_exempt;
    fields.push(`tax_exempt = ?`);
    values.push(taxExempt ? 1 : 0);
  } else if (body.client_id) {
    const cl = await c.env.DB.prepare(`SELECT tax_exempt FROM clients WHERE id = ?`).bind(body.client_id).first() as any;
    if (cl?.tax_exempt) {
      taxExempt = true;
      fields.push(`tax_exempt = ?`);
      values.push(1);
    }
  }

  let message = 'Document mis à jour.';

  if (Array.isArray(body.items)) {
    if (!canEditLines) {
      return c.json({
        success: false,
        error: 'Les lignes ne peuvent plus être modifiées : des paiements existent déjà ou la facture est soldée/annulée. Créez un avoir ou une nouvelle facture.',
        code: 'LINES_LOCKED',
      }, 400);
    }
    if (!body.items.length) {
      return c.json({ success: false, error: 'Au moins une ligne est obligatoire.' }, 400);
    }

    try { await ensureHrSettings(c.env.DB); } catch { /* */ }
    const settings = await c.env.DB.prepare(`SELECT tax_rate FROM company_settings WHERE id = 1`).first() as any;
    const defaultTax = Number(settings?.tax_rate ?? 20);
    let subtotal = 0;
    let taxAmount = 0;
    const normalized: any[] = [];

    for (const raw of body.items) {
      const name = String(raw.product_name || '').trim();
      if (!name) continue;
      const qty = Number(raw.quantity || 0);
      if (qty <= 0) continue;
      let listPrice = Number(raw.list_price ?? raw.catalog_price ?? 0);
      let unitPrice = Number(raw.unit_price ?? listPrice);
      if (raw.client_price !== undefined && raw.client_price !== null && raw.client_price !== '') {
        unitPrice = Number(raw.client_price);
      }

      if (raw.product_id) {
        const prod = await c.env.DB.prepare(`SELECT price, bulk_discounts FROM products WHERE id = ?`).bind(raw.product_id).first() as any;
        if (prod) {
          const catalog = Number(prod.price || 0);
          if (!listPrice || listPrice < 0.001) listPrice = catalog || unitPrice;
          if (catalog > unitPrice && listPrice < catalog) listPrice = catalog;
          if (listPrice > 0 && Math.abs(unitPrice - listPrice) < 0.001) {
            const bulk = applyBulkDiscount(listPrice, qty, prod.bulk_discounts);
            if (bulk.bulk_percent > 0) unitPrice = bulk.unit_price;
          }
        }
      }
      if (!listPrice) listPrice = unitPrice;

      let taxRate = Number(raw.tax_rate ?? defaultTax);
      if (taxExempt) taxRate = 0;

      const discountAmount = Math.max(0, listPrice - unitPrice) * qty;
      const discountPercent = listPrice > 0 ? Math.max(0, ((listPrice - unitPrice) / listPrice) * 100) : 0;
      const lineHt = qty * unitPrice;
      const lineTax = lineHt * (taxRate / 100);
      const lineTotal = lineHt + lineTax;
      subtotal += lineHt;
      taxAmount += lineTax;
      normalized.push({
        product_id: raw.product_id || null,
        product_name: name,
        sku: raw.sku || '',
        quantity: qty,
        list_price: listPrice,
        unit_price: unitPrice,
        discount_amount: discountAmount,
        discount_percent: discountPercent,
        tax_rate: taxRate,
        line_total: lineTotal,
      });
    }
    if (!normalized.length) {
      return c.json({ success: false, error: 'Aucune ligne valide.' }, 400);
    }

    const total = subtotal + taxAmount;

    // --- Stock sync for REAL invoices only (quotes never touch stock) ---
    // Only apply NET quantity deltas per product. If qty unchanged → leave stock alone
    // (no restock + re-sale noise in the audit log).
    let stockTouched = false;
    if (!isQuote) {
      const { results: oldItems } = await c.env.DB.prepare(
        `SELECT product_id, quantity FROM invoice_items WHERE invoice_id = ?`
      ).bind(id).all();

      const oldByProduct = new Map<number, number>();
      for (const old of (oldItems || []) as any[]) {
        const pid = Number(old.product_id || 0);
        if (!pid) continue;
        oldByProduct.set(pid, (oldByProduct.get(pid) || 0) + Number(old.quantity || 0));
      }

      const newByProduct = new Map<number, number>();
      for (const it of normalized) {
        const pid = Number(it.product_id || 0);
        if (!pid) continue;
        newByProduct.set(pid, (newByProduct.get(pid) || 0) + Number(it.quantity || 0));
      }

      const allPids = new Set<number>([...oldByProduct.keys(), ...newByProduct.keys()]);
      for (const pid of allPids) {
        const oldQty = oldByProduct.get(pid) || 0;
        const newQty = newByProduct.get(pid) || 0;
        // stockDelta > 0 → restock (qty reduced or line removed)
        // stockDelta < 0 → sale (qty increased or line added)
        const stockDelta = oldQty - newQty;
        if (Math.abs(stockDelta) < 1e-9) continue; // quantity unchanged — do not touch stock
        stockTouched = true;
        if (stockDelta > 0) {
          await applyStockDelta(c.env.DB, pid, stockDelta, 'Modification facture (qté ↓ / ligne retirée)', inv.number);
        } else {
          await applyStockDelta(c.env.DB, pid, stockDelta, 'Modification facture (qté ↑ / ligne ajoutée)', inv.number);
        }
      }
    }

    await c.env.DB.prepare(`DELETE FROM invoice_items WHERE invoice_id = ?`).bind(id).run();
    for (const it of normalized) {
      await c.env.DB.prepare(
        `INSERT INTO invoice_items (invoice_id, product_id, product_name, sku, quantity, unit_price, tax_rate, line_total, list_price, discount_amount, discount_percent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, it.product_id, it.product_name, it.sku, it.quantity, it.unit_price, it.tax_rate, it.line_total, it.list_price, it.discount_amount, it.discount_percent).run();
    }
    fields.push(`subtotal = ?`, `tax_amount = ?`, `total = ?`);
    values.push(subtotal, taxAmount, total);
    if (isQuote) {
      message = 'Devis mis à jour (lignes, prix et promo) — stock non modifié.';
    } else if (stockTouched) {
      message = 'Facture impayée mise à jour — quantités modifiées, stock synchronisé.';
    } else {
      message = 'Facture impayée mise à jour (prix / promo / infos) — stock inchangé (quantités identiques).';
    }
  }

  if (!fields.length) return c.json({ success: false, error: 'Aucun champ à modifier' }, 400);
  fields.push(`updated_at = datetime('now')`);
  values.push(id);
  await c.env.DB.prepare(`UPDATE invoices SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
  const updated = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first();
  const { results: items } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).bind(id).all();
  return c.json({ success: true, data: { ...updated, items }, message });
});

app.post('/api/invoices/:id/payments', async (c) => {
  const id = c.req.param('id');
  await ensurePaymentHistoryTable(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const idemKey = extractIdempotencyKey(c, body);
  if (idemKey) {
    const cached = await idempotencyGet(c.env.DB, `pay:${id}:${idemKey}`);
    if (cached) return c.json(cached.body, cached.status as any);
  }
  const amount = Number(body.amount || 0);
  const payment_method = String(body.payment_method || 'cash');
  const payee = String(body.payee || 'company'); // company | owner
  const note = String(body.note || '');
  // v258 — tenant-local day (Africa/Casablanca), never the UTC date: a payment
  // made just after local midnight used to land in the previous month's finance
  // period because substr(paid_at,1,10) read a UTC day.
  const paid_at = String(body.paid_at || moroccoTodayStr()).slice(0, 10);
  if (!amount || amount <= 0) return c.json({ success: false, error: 'Montant de paiement invalide' }, 400);
  const allowedMethods = [
    'cash', 'bank_company', 'bank_owner', 'check_company', 'check_owner', 'card', 'other',
    'bank', 'check', // legacy
  ];
  const method = allowedMethods.includes(payment_method) ? payment_method : 'cash';
  const who = payee === 'owner' ? 'owner' : 'company';

  const inv = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first() as any;
  if (!inv) return c.json({ success: false, error: 'Facture introuvable' }, 404);
  if (inv.status === 'quote' || inv.status === 'devis') {
    return c.json({ success: false, error: "Convertissez d'abord le devis en facture" }, 400);
  }
  if (inv.status === 'cancelled') return c.json({ success: false, error: 'Facture annulée' }, 400);
  if (inv.status === 'remboursement' || inv.doc_kind === 'remboursement') {
    return c.json({ success: false, error: 'Impossible d’enregistrer un paiement sur un avoir WR.', code: 'WR_NO_PAYMENT' }, 400);
  }

  const prev = Number(inv.amount_paid || 0);
  const total = Number(inv.total || 0);
  const remainingBefore = Math.max(0, total - prev);
  if (remainingBefore <= 0.001) {
    return c.json({ success: false, error: 'Cette facture est déjà soldée (reste = 0).', code: 'ALREADY_PAID' }, 400);
  }
  // Partial payments only add the amount paid now — never overwrite previous payments
  const applied = Math.min(amount, remainingBefore);
  if (applied <= 0) return c.json({ success: false, error: 'Montant de paiement invalide' }, 400);
  const next = prev + applied;
  const remaining = Math.max(0, total - next);
  const status = remaining <= 0.001 ? 'paid' : 'partial';

  // Each payment is a permanent history row (never deleted/hidden by later payments)
  await c.env.DB.prepare(
    `INSERT INTO invoice_payments (invoice_id, amount, payment_method, payee, note, paid_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, applied, method, who, note, paid_at).run();

  // Ledger (Solde): encaissement appears in historique with cash/bank mode
  await ensureExpenseTypeColumn(c.env.DB);
  const ledgerMethod =
    method === 'cash' || method === 'card' ? 'cash' :
    method.startsWith('bank') ? 'bank' :
    method.startsWith('check') ? 'check' : 'other';
  const whoLabel = who === 'owner' ? 'propriétaire' : 'société';
  const methodLabel =
    method === 'cash' ? 'espèces' :
    method === 'card' ? 'carte' :
    method === 'bank_company' ? 'virement société' :
    method === 'bank_owner' ? 'virement propriétaire' :
    method === 'check_company' ? 'chèque société' :
    method === 'check_owner' ? 'chèque propriétaire' :
    method === 'bank' ? 'virement' :
    method === 'check' ? 'chèque' : method;
  const ledgerDesc = `Encaissement facture ${inv.number} (${methodLabel} → ${whoLabel})${note ? ' — ' + note : ''}`;
  // Ledger only for the amount actually applied
  if (applied > 0) {
    await c.env.DB.prepare(
      `INSERT INTO expenses (category, description, amount, payment_method, expense_date, vendor_name, reference, notes, entry_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'income')`
    ).bind(
      'Encaissement client',
      ledgerDesc,
      applied,
      ledgerMethod,
      paid_at,
      inv.client_name || '',
      inv.number || '',
      `invoice_id:${id}|payee:${who}|method:${method}`,
    ).run();
  }

  await c.env.DB.prepare(
    `UPDATE invoices SET amount_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(next, status, id).run();
  await invalidateDashboardCache(c.env.CACHE);

  // v254 — notify authorized finance recipients that a client payment was
  // recorded (deduped by the durable outbox; re-checks role at delivery).
  // Best-effort: a push failure must NEVER fail or roll back the payment.
  try {
    await notifyPaymentRecorded(c.env, {
      invoiceId: Number(id),
      number: String(inv.number || ''),
      clientName: String(inv.client_name || ''),
      amount: applied,
      remaining,
      status,
    });
  } catch (e) {
    console.error('finance_payment_notify_err', String((e as any)?.message || e));
  }

  // Receipt rules (Part 5):
  // - Created ONLY when remaining balance reaches 0 (status === 'paid')
  // - At most ONE receipt per invoice (never on partial payments)
  // - Invoice stays in the invoices list forever (never deleted/hidden)
  // - Manual receipts remain available under /receipts for independent use
  let receipt = null;
  if (status === 'paid') {
    await ensureReceiptsTable(c.env.DB);
    receipt = await c.env.DB.prepare(
      `SELECT * FROM receipts WHERE invoice_id = ? ORDER BY id DESC LIMIT 1`
    ).bind(id).first();
    if (!receipt) {
      try {
        const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
        const number = await nextDocumentNumber(c.env.DB, 'receipt', settings, c.env);
        await c.env.DB.prepare(
          `INSERT INTO receipts (number, invoice_id, client_name, amount, payment_method, issue_date, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(number, id, inv.client_name, total, method, paid_at, note || `Règlement complet facture ${inv.number}`).run();
        receipt = await c.env.DB.prepare(
          `SELECT * FROM receipts WHERE number = ? LIMIT 1`
        ).bind(number).first();
      } catch (e) {
        console.error('receipt create failed', e);
        // Fallback: try simple number
        try {
          const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
          const prefix = settings?.receipt_prefix || 'RCP-';
          const nextNum = Number(settings?.next_receipt_number || 1);
          const number = `${prefix}${String(nextNum).padStart(5, '0')}`;
          await c.env.DB.prepare(
            `INSERT OR IGNORE INTO receipts (number, invoice_id, client_name, amount, payment_method, issue_date, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).bind(number, id, inv.client_name, total, method, paid_at, note || `Règlement complet facture ${inv.number}`).run();
          await c.env.DB.prepare(
            `UPDATE company_settings SET next_receipt_number = COALESCE(next_receipt_number, 1) + 1 WHERE id = 1`
          ).run();
          receipt = await c.env.DB.prepare(`SELECT * FROM receipts WHERE number = ? LIMIT 1`).bind(number).first();
        } catch (e2) {
          console.error('receipt create fallback failed', e2);
        }
      }
    }
  }

  const { results: history } = await c.env.DB.prepare(
    `SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY paid_at DESC, id DESC`
  ).bind(id).all();
  const updated = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first();
  const payload = {
    success: true,
    data: updated,
    remaining,
    history: history || [],
    receipt,
    message: status === 'paid'
      ? `Facture soldée. Total payé ${next}. Reçu généré.`
      : `Paiement enregistré (${applied}). Cumul ${next} · Reste ${remaining}.`,
  };
  await afterBusinessMutation(c.env.CACHE);
  if (idemKey) await idempotencyPut(c.env.DB, `pay:${id}:${idemKey}`, 'POST /payments', 200, payload);
  return c.json(payload);
});

app.get('/api/invoices/:id/payments', async (c) => {
  const id = c.req.param('id');
  await ensurePaymentHistoryTable(c.env.DB);
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY paid_at DESC, id DESC`
  ).bind(id).all();
  return c.json({ success: true, data: results || [] });
});

/** Convert a devis (quote) into a real invoice: deduct stock, set status sent, new invoice number optional keep same */
app.post('/api/invoices/:id/convert-quote', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({} as any));
  const target = String(body?.target || body?.to || 'invoice').toLowerCase();
  const asQuickSale = target === 'quick_sale' || target === 'vr' || target === 'vente_rapide';

  const inv = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first() as any;
  if (!inv) return c.json({ success: false, error: 'Document introuvable' }, 404);
  if (inv.doc_kind === 'quick_sale' || inv.doc_kind === 'ticket' || String(inv.number || '').startsWith('VR')) {
    return c.json({ success: false, error: 'Un ticket de vente rapide ne peut pas être converti.' }, 400);
  }
  if (inv.status !== 'quote' && inv.status !== 'devis') {
    return c.json({ success: false, error: 'Seuls les devis peuvent être convertis' }, 400);
  }

  // Credit limit (invoice path only — VR is cash-oriented)
  if (!asQuickSale) {
    await ensureClientCreditLimit(c.env.DB);
    const credit = await checkClientCreditLimit(c.env.DB, {
      clientId: inv.client_id ? Number(inv.client_id) : null,
      clientName: inv.client_name,
      clientIce: inv.client_ice,
      addAmount: Number(inv.total || 0),
    });
    if (!credit.ok) {
      return c.json({
        success: false,
        error: credit.message || 'Limite de crédit dépassée',
        code: 'CREDIT_LIMIT',
        data: { outstanding: credit.outstanding, limit: credit.limit },
      }, 400);
    }
  }

  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const kind = asQuickSale ? 'quick_sale' : 'invoice';
  const newNumber = await nextDocumentNumber(c.env.DB, kind as any, settings, c.env);
  const { results: items } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).bind(id).all();
  for (const item of (items || []) as any[]) {
    if (!item.product_id) continue;
    try {
      await applyStockDelta(
        c.env.DB,
        item.product_id,
        -Number(item.quantity || 0),
        asQuickSale ? 'Devis→VR' : 'Devis→Facture',
        newNumber,
        { type: 'sale' },
      );
    } catch (stErr: any) {
      return c.json({
        success: false,
        error: stErr?.message || 'Stock insuffisant pour convertir le devis',
        code: stErr?.code || 'INSUFFICIENT_STOCK',
      }, 400);
    }
  }

  if (asQuickSale) {
    // Zero tax lines for VR tickets
    try {
      await c.env.DB.prepare(`UPDATE invoice_items SET tax_rate = 0 WHERE invoice_id = ?`).bind(id).run();
    } catch { /* */ }
    await c.env.DB.prepare(
      `UPDATE invoices SET status = 'sent', number = ?, doc_kind = 'quick_sale', tax_exempt = 1, updated_at = datetime('now') WHERE id = ?`,
    ).bind(newNumber, id).run();
  } else {
    await c.env.DB.prepare(
      `UPDATE invoices SET status = 'sent', number = ?, doc_kind = 'invoice', updated_at = datetime('now') WHERE id = ?`,
    ).bind(newNumber, id).run();
  }

  await afterBusinessMutation(c.env.CACHE);
  const updated = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first();
  const msg = asQuickSale
    ? `Devis converti en vente rapide ${newNumber}. Stock mis à jour.`
    : `Devis converti en facture ${newNumber}. Stock mis à jour.`;
  return c.json({ success: true, data: updated, message: msg });
});

app.get('/api/invoices/:id/print', async (c) => {
  const id = c.req.param('id');
  await ensureInvoicePublicToken(c.env.DB);
  let invoice = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first() as any;
  if (!invoice) return c.json({ success: false, error: 'Facture introuvable' }, 404);
  if (!invoice.public_token) {
    const tok = makePublicToken();
    await c.env.DB.prepare(`UPDATE invoices SET public_token = ? WHERE id = ?`).bind(tok, id).run();
    invoice = { ...invoice, public_token: tok };
  }
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const { results: items } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).bind(id).all();
  const origin = new URL(c.req.url).origin;
  // Secure HMAC QR payload (no expiry for printed archive documents)
  const secure = await makeSecureQrPayload(c.env, 'invoice', invoice.public_token, 0, c.env.DB);
  invoice.public_url = `${origin}/api/public/verify?p=${encodeURIComponent(secure)}`;
  invoice.public_token_raw = invoice.public_token;
  const st = invoice.status;
  let docTitle = 'FACTURE';
  if (st === 'quote' || st === 'devis') docTitle = 'DEVIS';
  else if (st === 'remboursement' || invoice.doc_kind === 'remboursement') docTitle = 'REMBOURSEMENT (WR)';
  else if (st === 'paid') docTitle = 'FACTURE';
  if (docTitle.includes('WR') && invoice.refund_of_invoice_id) {
    try {
      const src = await c.env.DB.prepare(`SELECT number FROM invoices WHERE id = ?`).bind(invoice.refund_of_invoice_id).first() as any;
      if (src?.number) invoice._source_number = src.number;
    } catch { /* */ }
  }
  return c.html(generateInvoiceHTML(settings, invoice, items as any[], docTitle));
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
  const ORANGE = '#f4590c';
  const SALMON = '#ee8b6c';
  const GREY = '#8b93a3';
  const rows = [
    meta?.username ? ['Compte', meta.username] : null,
    meta?.ip ? ['Adresse IP', meta.ip] : null,
    meta?.ua ? ['Appareil', meta.ua.slice(0, 120)] : null,
    meta?.fingerprint ? ['Empreinte', meta.fingerprint.slice(0, 24)] : null,
  ].filter(Boolean) as [string, string][];
  const deviceBlock = rows.length
    ? `<div style="margin:26px 0 0;background:#f7f7f9;border:1px solid #e7e7ec;border-radius:12px;padding:12px 16px">${rows
        .map(
          ([k, v]) =>
            `<div style="display:flex;justify-content:space-between;gap:16px;padding:4px 0;font-size:12px"><span style="color:${GREY}">${k}</span><span style="color:#3d4453;font-weight:600;text-align:right">${v}</span></div>`,
        )
        .join('')}</div>`
    : '';
  const button = meta?.verifyUrl
    ? `<a href="${meta.verifyUrl}" style="display:block;width:100%;box-sizing:border-box;background:${ORANGE};border-radius:10px;padding:18px 12px;text-align:center;color:#ffffff;font-size:15px;font-weight:800;letter-spacing:1.5px;text-decoration:none;text-transform:uppercase">Vérifier &amp; continuer</a>`
    : '';
  const social = (href: string, d: string) =>
    `<a href="${href}" style="display:inline-block;margin-left:14px;text-decoration:none"><svg width="17" height="17" viewBox="0 0 24 24" fill="#8b93a3" xmlns="http://www.w3.org/2000/svg"><path d="${d}"/></svg></a>`;
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${tag}</title></head>
<body style="margin:0;padding:0;background:#f1f1f4;font-family:-apple-system,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#101114">
  <div style="display:none;max-height:0;overflow:hidden">Votre code : ${otp}</div>
  <div style="max-width:600px;margin:0 auto;padding:38px 22px 30px;text-align:center">
    <div style="font-size:30px;line-height:1">🏬</div>
    <div style="margin-top:8px;font-size:24px;font-weight:800;letter-spacing:-0.3px;color:#101114">Atlas Commerce</div>
    <div style="height:34px"></div>
    <div style="font-size:12px;font-weight:800;letter-spacing:2px;color:${SALMON};text-transform:uppercase">${tag}</div>
    <h1 style="margin:14px 0 0;font-size:33px;line-height:1.18;font-weight:800;color:#101114">${h1} <em style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-weight:600;color:${SALMON}">compte</em></h1>
    <p style="margin:18px auto 0;max-width:420px;font-size:15px;line-height:1.7;color:${GREY}">${intro}</p>
    <div style="margin:30px 0 0;background:#f7f7f9;border:1px solid #e7e7ec;border-radius:12px;padding:30px 16px">
      <div style="font-size:34px;font-weight:800;letter-spacing:3px;color:#8a93a6">${otp}</div>
    </div>
    <div style="margin:22px 0 0">${button}</div>
    ${deviceBlock}
    <p style="margin:28px auto 0;max-width:380px;font-size:14px;line-height:1.65;color:${GREY}">Vous n’êtes pas à l’origine de cette demande ? Ignorez simplement ce message.</p>
    <p style="margin:10px auto 0;max-width:420px;font-size:12px;line-height:1.6;color:#a6adbb">Code à usage unique, valable 10 minutes. Ne le partagez jamais, y compris avec un membre de votre équipe. · ${companyName}</p>
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
      <div style="margin-top:14px;font-size:12px;line-height:1.6;color:#7c8494">Atlas Commerce — stock.afmarbre.com<br/>© 2026 loxdpsy · MIT</div>
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
    } catch (e) {
      console.error('otp_resend_error', String((e as any)?.message || e));
    }
  }
  if (env.EMAIL?.send) {
    console.log('[otp-mail] Resend unavailable or failed — using the CF Send-Email binding fallback');
    try {
      await env.EMAIL.send({ to: opts.to, from: opts.from, subject: opts.subject, html: opts.html, text: opts.text });
      return true;
    } catch (e) {
      console.error('otp_binding_failed', String((e as any)?.message || e));
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

app.post('/api/invoices/:id/request-delete-otp', async (c) => {
  const id = c.req.param('id');
  const invoice = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first() as any;
  if (!invoice) return c.json({ success: false, error: 'Facture introuvable' }, 404);

  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await c.env.DB.prepare(
    `INSERT INTO otp_codes (code, resource_type, resource_id, expires_at) VALUES (?, 'invoice', ?, ?)
     ON CONFLICT(resource_type, resource_id) DO UPDATE SET code = ?, expires_at = ?, created_at = datetime('now')`
  ).bind(otp, id, expiresAt, otp, expiresAt).run();

  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const companyName = settings?.company_name || 'Atlas Commerce';
  const fromAddr = c.env.OTP_FROM || 'noreply@afmarbre.com';
  const toAddr = c.env.OTP_TO || 'security@afmarbre.com';

  try {
    await c.env.EMAIL.send({
      to: toAddr,
      from: fromAddr,
      subject: `Code de suppression — Facture ${invoice.number}`,
      html: otpEmailHTML(otp, `Facture ${invoice.number}`, companyName),
      text: `Code de confirmation pour supprimer la facture ${invoice.number} : ${otp}. Ce code est valable 10 minutes.`,
    });
  } catch (e: any) {
    return c.json({ success: false, error: 'Impossible d\'envoyer le code par e-mail. Vérifiez la configuration Email Routing.', detail: e.message }, 500);
  }

  return c.json({ success: true, message: `Code envoyé à ${toAddr}. Vérifiez votre boîte de réception.` });
});

app.get('/api/invoices/:id/links', async (c) => {
  const id = c.req.param('id');
  const links = await getInvoiceLinks(c.env.DB, id);
  if (!links) return c.json({ success: false, error: 'Facture introuvable' }, 404);
  return c.json({
    success: true,
    data: {
      invoice: { id: links.invoice.id, number: links.invoice.number, status: links.invoice.status },
      payments_count: links.payments.length,
      receipts: links.receipts.map((r: any) => ({ id: r.id, number: r.number, amount: r.amount })),
      expenses: links.expenses.map((e: any) => ({ id: e.id, description: e.description, amount: e.amount })),
      disclaimer: links.receipts.length || links.expenses.length || links.payments.length
        ? 'La suppression de cette facture effacera aussi les reçus, paiements et écritures de solde liés.'
        : null,
    },
  });
});

app.delete('/api/invoices/:id', async (c) => {
  try {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
    if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);

    const links = await getInvoiceLinks(c.env.DB, id);
    if (!links) return c.json({ success: false, error: 'Facture introuvable' }, 404);

    await cascadeDeleteInvoice(c.env.DB, id);
    await afterBusinessMutation(c.env.CACHE);

    await writeAudit(c.env.DB, {
      username: gate.username,
      role: gate.role,
      action: 'invoice.delete',
      entity: 'invoices',
      entity_id: id,
      detail: links.invoice.number || '',
      ip: c.req.header('cf-connecting-ip') || '',
    });

    const parts: string[] = [`Facture ${links.invoice.number}`];
    if (links.receipts.length) parts.push(`${links.receipts.length} reçu(s)`);
    if (links.expenses.length) parts.push(`${links.expenses.length} écriture(s) solde`);
    if (links.payments.length) parts.push(`${links.payments.length} paiement(s)`);

    const isWr =
      links.invoice.status === 'remboursement' || links.invoice.doc_kind === 'remboursement';
    const isVr =
      links.invoice.doc_kind === 'quick_sale' ||
      links.invoice.doc_kind === 'ticket' ||
      String(links.invoice.number || '').startsWith('VR');
    return c.json({
      success: true,
      message: isWr
        ? `Avoir ${links.invoice.number} supprimé — stock re-déduit, solde d’origine rétabli.`
        : isVr
          ? `Ticket ${links.invoice.number} supprimé — stock rétabli, paiements et reçus liés effacés.`
          : `Supprimé : ${parts.join(', ')}.`,
      deleted: {
        invoice: links.invoice.number,
        receipts: links.receipts.length,
        expenses: links.expenses.length,
        payments: links.payments.length,
        was_remboursement: isWr,
      },
    });
  } catch (e: any) {
    console.error('invoice delete', e);
    return c.json({ success: false, error: e?.message || 'Échec de la suppression', code: 'DELETE_FAILED' }, 400);
  }
});

/* ─── Bills ─── */



/** Server-side PDF (binary) — zero external runtime deps */
async function invoiceToPdfInput(settings: any, inv: any, items: any[], title: string) {
  const integrityHash = await documentIntegrityHash({
    title,
    number: inv.number,
    issue_date: inv.issue_date,
    client: inv.client_name || inv.vendor_name,
    total: Number(inv.total || 0),
    paid: Number(inv.amount_paid || 0),
    status: inv.status,
    lines: (items || []).length,
  });
  let signatureValid: boolean | undefined;
  if (inv.client_signature) {
    const check = await validateStoredSignature(inv);
    signatureValid = check.present && check.imageOk && check.digestOk && check.docUnchanged;
  }
  return {
    title,
    number: String(inv.number || ''),
    issueDate: String(inv.issue_date || ''),
    dueDate: inv.due_date ? String(inv.due_date) : undefined,
    company: {
      name: settings?.company_name || '',
      address: settings?.address,
      city: [settings?.city, settings?.postal_code].filter(Boolean).join(' '),
      phone: settings?.phone,
      email: settings?.email,
      ice: settings?.ice,
      if_number: settings?.if_number,
      rc: settings?.rc,
      patente: settings?.patente,
      cnss: settings?.cnss,
      legal_form: settings?.legal_form,
      bank_name: settings?.bank_name,
      bank_iban: settings?.bank_iban,
    },
    party: {
      label: title.includes('ACHAT') ? 'Fournisseur' : 'Client',
      name: inv.client_name || inv.vendor_name || '',
      ice: inv.client_ice || inv.vendor_ice || '',
      address: inv.client_address || inv.vendor_address || '',
      city: inv.client_city || '',
      email: inv.client_email || '',
      phone: inv.client_phone || '',
    },
    items: (items || []).map((it: any) => {
      const qty = Number(it.quantity || 0);
      const unitSold = Number(it.unit_price ?? it.unit_cost ?? 0);
      const list = Number(it.list_price || 0);
      const pu = list > unitSold ? list : (list > 0 ? list : unitSold);
      return {
        name: it.product_name || '',
        qty,
        unit: pu,
        taxRate: Number(it.tax_rate ?? settings?.tax_rate ?? 0),
        total: qty * pu,
        listPrice: list,
        unitSold,
        discount: Number(it.discount_amount || 0),
      };
    }),
    subtotal: Number(inv.subtotal || 0),
    discountTotal: (items || []).reduce((s: number, it: any) => {
      const qty = Number(it.quantity || 0);
      const list = Number(it.list_price || 0);
      const unit = Number(it.unit_price ?? it.unit_cost ?? 0);
      const discAmt = Number(it.discount_amount || 0);
      const fromList = list > unit ? (list - unit) * qty : 0;
      return s + (discAmt > 0 ? discAmt : fromList);
    }, 0),
    taxAmount: Number(inv.tax_amount || 0),
    total: Number(inv.total || 0),
    amountPaid: Number(inv.amount_paid || 0),
    currency: settings?.currency || 'MAD',
    notes: inv.notes || '',
    refundReason: inv.refund_reason || undefined,
    sourceInvoiceNumber: inv._source_number || undefined,
    // Always attach refund policy on sales invoices + WR (old + new documents)
    refundPolicy:
      title === 'DEVIS' || title.includes('ACHAT')
        ? undefined
        : REFUND_POLICY_TEXT,
    status: inv.status,
    publicUrl: inv.public_url || undefined,
    watermark: title,
    integrityHash,
    clientSignaturePresent: !!(inv.client_signature),
    signedAt: inv.signed_at || undefined,
    signatureValid,
    timestampAt: inv.timestamp_at || undefined,
  };
}

function pdfResponse(bytes: Uint8Array, filename: string) {
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

app.get('/api/invoices/:id/pdf', async (c) => {
  // Same visual source as /print — one HTML template for screen, print, and "Save as PDF".
  // Avoids pdf-lib layout/encoding drift (accents, spaces, QR, promo lines).
  // Magasinier: no money/PDF documents
  {
    const session = sessionUserFromHeader(c.req.header('Authorization'));
    if (normalizeRole(session.role) === 'stock') {
      return c.json({ success: false, error: 'Rôle magasinier : PDF facture non autorisé.', code: 'FORBIDDEN_ROLE' }, 403);
    }
  }
  const id = c.req.param('id');
  await ensureInvoicePublicToken(c.env.DB);
  let invoice = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first() as any;
  if (!invoice) return c.json({ success: false, error: 'Facture introuvable' }, 404);
  if (!invoice.public_token) {
    const tok = makePublicToken();
    await c.env.DB.prepare(`UPDATE invoices SET public_token = ? WHERE id = ?`).bind(tok, id).run();
    invoice = { ...invoice, public_token: tok };
  }
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const { results: items } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).bind(id).all();
  const origin = new URL(c.req.url).origin;
  const secure = await makeSecureQrPayload(c.env, 'invoice', invoice.public_token, 0, c.env.DB);
  invoice.public_url = `${origin}/api/public/verify?p=${encodeURIComponent(secure)}`;
  invoice.public_token_raw = invoice.public_token;
  const st = invoice.status;
  let docTitle = 'FACTURE';
  if (st === 'quote' || st === 'devis') docTitle = 'DEVIS';
  else if (st === 'remboursement' || invoice.doc_kind === 'remboursement') docTitle = 'REMBOURSEMENT (WR)';
  if (docTitle.includes('WR') && invoice.refund_of_invoice_id) {
    try {
      const src = await c.env.DB.prepare(`SELECT number FROM invoices WHERE id = ?`).bind(invoice.refund_of_invoice_id).first() as any;
      if (src?.number) invoice._source_number = src.number;
    } catch { /* */ }
  }
  // Seal timestamp when generating archive view (same as previous PDF path intent)
  if (!invoice.timestamp_token) {
    try {
      const docHash = await sha256Hex(invoiceDocHashPayload(invoice));
      const ts = await createAtlasTimestampToken(c.env, docHash, c.env.DB);
      await c.env.DB.prepare(
        `UPDATE invoices SET signed_doc_hash = COALESCE(signed_doc_hash, ?), timestamp_token = ?, timestamp_at = ? WHERE id = ?`,
      ).bind(docHash, ts.compact, ts.issuedAt, id).run();
    } catch { /* optional */ }
  }
  const html = generateInvoiceHTML(settings, invoice, items as any[], docTitle, true);
  const fname = String(invoice.number || id).replace(/[^\w.-]+/g, '_') + '.html';
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `inline; filename="${fname}"`,
      'Cache-Control': 'no-store',
    },
  });
});

/**
 * Thermal receipt ESC/POS (58mm width=32, 80mm width=48).
 * GET /api/print/thermal/:id?width=32
 * APK: write body bytes to Bluetooth/USB thermal printer.
 */
app.get('/api/print/thermal/:id', async (c) => {
  const id = c.req.param('id');
  const width = Number(c.req.query('width') || 32) === 48 ? 48 : 32;
  const invoice = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first() as any;
  if (!invoice) return c.json({ success: false, error: 'Document introuvable' }, 404);
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const { results: items } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).bind(id).all();
  const company = String(settings?.company_name || 'Société');
  const currency = String(settings?.currency || 'MAD');
  const ESC = '\x1b';
  const GS = '\x1d';
  const line = (t: string) => String(t || '').slice(0, width) + '\n';
  const hr = (ch = '-') => ch.repeat(width) + '\n';
  const pair = (l: string, r: string) => {
    const gap = Math.max(1, width - l.length - r.length);
    return l + ' '.repeat(gap) + r + '\n';
  };
  let out = ESC + '@';
  out += ESC + 'a\x01';
  out += ESC + 'E\x01';
  out += GS + '!\x01';
  out += line(company);
  out += GS + '!\x00';
  out += ESC + 'E\x00';
  out += line(String(invoice.number || ''));
  out += line(String(invoice.issue_date || ''));
  out += hr();
  out += ESC + 'a\x00';
  out += line(`Client: ${invoice.client_name || ''}`);
  out += hr();
  for (const it of (items || []) as any[]) {
    out += line(String(it.product_name || ''));
    const tot = Number(it.line_total ?? (Number(it.quantity || 0) * Number(it.unit_price || 0)));
    out += pair(`  x${it.quantity}`, tot);
  }
  out += hr('=');
  out += ESC + 'E\x01';
  out += pair('TOTAL', `${Number(invoice.total || 0)} ${currency}`);
  out += ESC + 'E\x00';
  out += ESC + 'a\x01';
  out += line('');
  out += line('Merci de votre visite');
  out += line('');
  out += GS + 'V\x00';
  return new Response(out, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="ticket-${String(invoice.number || id).replace(/[^\w.-]+/g, '_')}.bin"`,
      'X-Thermal-Width': String(width),
      'Cache-Control': 'no-store',
    },
  });
});


/** M1 — UBL clearance-ready (local snapshot + status; no live DGI submit yet) */
async function ensureUblClearance(db: D1Database) {
  await schemaOnce('ensureUblClearance', async () => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS invoice_ubl_clearance (
      invoice_id INTEGER PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'draft',
      validation_ok INTEGER DEFAULT 0,
      errors_json TEXT DEFAULT '[]',
      warnings_json TEXT DEFAULT '[]',
      xml_snapshot TEXT,
      xml_sha256 TEXT,
      prepared_at TEXT,
      submitted_at TEXT,
      decided_at TEXT,
      external_ref TEXT,
      note TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
  await addColumnIfMissing(db, 'invoices', 'dgi_status', `TEXT DEFAULT ''`);

  });
}


app.get('/api/invoices/:id/ubl', async (c) => {
  const id = c.req.param('id');
  const invoice = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first() as any;
  if (!invoice) return c.json({ success: false, error: 'Facture introuvable' }, 404);
  if (invoice.status === 'quote' || invoice.status === 'devis') {
    return c.json({ success: false, error: 'Les devis ne sont pas exportés en UBL (réservé aux factures).' }, 400);
  }
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const { results: items } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).bind(id).all();
  const input = invoiceToUblInput(settings, invoice, items as any[]);
  const validation = validateUblInvoice(input);
  if (c.req.query('validate_only') === '1') {
    return c.json({ success: true, data: validation });
  }
  // Optional strict mode: block download if structural errors
  if (c.req.query('strict') === '1' && !validation.ok) {
    return c.json({
      success: false,
      error: 'Export UBL refusé : champs obligatoires manquants.',
      code: 'UBL_VALIDATION_FAILED',
      data: validation,
    }, 400);
  }
  const xml = buildUblInvoiceXml(input);
  const safe = String(invoice.number || id).replace(/[^\w.-]+/g, '_');
  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safe}.ubl.xml"`,
      'Cache-Control': 'no-store',
      'X-UBL-Status': validation.ok ? 'preview-dgi-ready' : 'preview-with-warnings',
      'X-UBL-Errors': String(validation.errors.length),
      'X-UBL-Warnings': String(validation.warnings.length),
    },
  });
});

app.get('/api/invoices/:id/ubl/validate', async (c) => {
  const id = c.req.param('id');
  const invoice = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first() as any;
  if (!invoice) return c.json({ success: false, error: 'Facture introuvable' }, 404);
  if (invoice.status === 'quote' || invoice.status === 'devis') {
    return c.json({ success: false, error: 'Les devis ne sont pas validés en UBL.', code: 'UBL_QUOTE' }, 400);
  }
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const { results: items } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).bind(id).all();
  const validation = validateUblInvoice(invoiceToUblInput(settings, invoice, items as any[]));
  // Phase 6: persist readiness flag (not live DGI submit — decree-dependent)
  const dgiStatus = validation.ok
    ? (validation.warnings.length ? 'ubl_ok_warnings' : 'ubl_ready')
    : 'ubl_errors';
  await addColumnIfMissing(c.env.DB, 'invoices', 'dgi_status', `TEXT DEFAULT ''`);
  try {
    await c.env.DB.prepare(
      `UPDATE invoices SET dgi_status = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(dgiStatus, id).run();
  } catch { /* */ }
  return c.json({
    success: true,
    data: {
      ...validation,
      dgi_status: dgiStatus,
      clearance: 'not_submitted',
      note: 'Validation structurelle locale. Soumission DGI / PDP lorsque le décret et les credentials sont stables.',
    },
    message: validation.ok
      ? (validation.warnings.length ? `UBL structure OK · ${validation.warnings.length} avertissement(s)` : 'UBL structure OK — prêt pour clearance')
      : `UBL invalide · ${validation.errors.length} erreur(s)`,
  });
});

/** M1: prepare UBL snapshot + status draft|ready (no live DGI) */
app.post('/api/invoices/:id/ubl/prepare', async (c) => {
  const gate = requireBizMutator(c);
  if (!gate.ok) return gate.response;
  const id = Number(c.req.param('id'));
  if (!id) return c.json({ success: false, error: 'id invalide' }, 400);
  await ensureUblClearance(c.env.DB);
  const invoice = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first() as any;
  if (!invoice) return c.json({ success: false, error: 'Facture introuvable' }, 404);
  if (invoice.status === 'quote' || invoice.status === 'devis') {
    return c.json({ success: false, error: 'Les devis ne sont pas en clearance UBL.', code: 'UBL_QUOTE' }, 400);
  }
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const { results: items } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).bind(id).all();
  const input = invoiceToUblInput(settings, invoice, items as any[]);
  const validation = validateUblInvoice(input);
  const xml = buildUblInvoiceXml(input);
  const hash = await sha256Hex(xml);
  const status = validation.ok ? 'ready' : 'draft';
  const dgiStatus = validation.ok
    ? (validation.warnings.length ? 'ubl_ok_warnings' : 'ubl_ready')
    : 'ubl_errors';
  await c.env.DB.prepare(
    `INSERT INTO invoice_ubl_clearance (
      invoice_id, status, validation_ok, errors_json, warnings_json, xml_snapshot, xml_sha256, prepared_at, note, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, datetime('now'))
    ON CONFLICT(invoice_id) DO UPDATE SET
      status = excluded.status,
      validation_ok = excluded.validation_ok,
      errors_json = excluded.errors_json,
      warnings_json = excluded.warnings_json,
      xml_snapshot = excluded.xml_snapshot,
      xml_sha256 = excluded.xml_sha256,
      prepared_at = excluded.prepared_at,
      note = excluded.note,
      updated_at = datetime('now')`
  ).bind(
    id,
    status,
    validation.ok ? 1 : 0,
    JSON.stringify(validation.errors || []),
    JSON.stringify(validation.warnings || []),
    xml,
    hash,
    validation.ok
      ? 'Snapshot UBL local — prêt (pas encore soumis à DGI/PDP)'
      : 'Snapshot UBL local — corriger les erreurs avant ready',
  ).run();
  try {
    await c.env.DB.prepare(`UPDATE invoices SET dgi_status = ?, updated_at = datetime('now') WHERE id = ?`).bind(dgiStatus, id).run();
  } catch { /* */ }
  return c.json({
    success: true,
    data: {
      invoice_id: id,
      status,
      validation_ok: validation.ok,
      errors: validation.errors || [],
      warnings: validation.warnings || [],
      xml_sha256: hash,
      dgi_status: dgiStatus,
      clearance_live: false,
    },
    message: validation.ok
      ? 'UBL préparé (status: ready). Soumission live DGI non activée.'
      : `UBL en draft — ${validation.errors?.length || 0} erreur(s)`,
  });
});

/** M1: read clearance record */
app.get('/api/invoices/:id/ubl/clearance', async (c) => {
  const id = Number(c.req.param('id'));
  if (!id) return c.json({ success: false, error: 'id invalide' }, 400);
  await ensureUblClearance(c.env.DB);
  const row = await c.env.DB.prepare(`SELECT * FROM invoice_ubl_clearance WHERE invoice_id = ?`).bind(id).first() as any;
  if (!row) {
    return c.json({
      success: true,
      data: {
        invoice_id: id,
        status: 'draft',
        validation_ok: false,
        note: 'Aucun snapshot — lancer « Préparer UBL ».',
        clearance_live: false,
      },
    });
  }
  let errors: any[] = [];
  let warnings: any[] = [];
  try { errors = JSON.parse(row.errors_json || '[]'); } catch { /* */ }
  try { warnings = JSON.parse(row.warnings_json || '[]'); } catch { /* */ }
  return c.json({
    success: true,
    data: {
      invoice_id: id,
      status: row.status,
      validation_ok: !!row.validation_ok,
      errors,
      warnings,
      xml_sha256: row.xml_sha256,
      prepared_at: row.prepared_at,
      submitted_at: row.submitted_at,
      decided_at: row.decided_at,
      external_ref: row.external_ref,
      note: row.note,
      has_snapshot: !!(row.xml_snapshot && String(row.xml_snapshot).length > 20),
      clearance_live: false,
    },
  });
});

/**
 * M1: set clearance status manually / for future PDP webhook.
 * Allowed: submitted | accepted | rejected (and ready if re-open after fix).
 * Does NOT call DGI — placeholder until credentials exist.
 */
app.post('/api/invoices/:id/ubl/status', async (c) => {
  const gate = requireBizMutator(c);
  if (!gate.ok) return gate.response;
  const id = Number(c.req.param('id'));
  if (!id) return c.json({ success: false, error: 'id invalide' }, 400);
  await ensureUblClearance(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const next = String(body.status || '').toLowerCase().trim();
  const allowed = ['draft', 'ready', 'submitted', 'accepted', 'rejected'];
  if (!allowed.includes(next)) {
    return c.json({ success: false, error: `status invalide (${allowed.join(', ')})` }, 400);
  }
  const existing = await c.env.DB.prepare(`SELECT * FROM invoice_ubl_clearance WHERE invoice_id = ?`).bind(id).first() as any;
  if (!existing || !existing.xml_snapshot) {
    return c.json({ success: false, error: 'Préparez d’abord le snapshot UBL (POST …/ubl/prepare).' }, 400);
  }
  if ((next === 'submitted' || next === 'accepted') && !existing.validation_ok) {
    return c.json({ success: false, error: 'UBL invalide — impossible de marquer soumis/accepté.' }, 400);
  }
  const external_ref = body.external_ref != null ? String(body.external_ref).slice(0, 120) : existing.external_ref;
  const note = body.note != null ? String(body.note).slice(0, 400) : existing.note;
  const submitted_at = next === 'submitted' || next === 'accepted' || next === 'rejected'
    ? (existing.submitted_at || new Date().toISOString())
    : existing.submitted_at;
  const decided_at = next === 'accepted' || next === 'rejected' ? new Date().toISOString() : existing.decided_at;
  await c.env.DB.prepare(
    `UPDATE invoice_ubl_clearance SET
      status = ?, external_ref = ?, note = ?,
      submitted_at = ?, decided_at = ?, updated_at = datetime('now')
     WHERE invoice_id = ?`
  ).bind(next, external_ref || null, note || null, submitted_at || null, decided_at || null, id).run();
  const dgiMap: Record<string, string> = {
    draft: 'ubl_errors',
    ready: 'ubl_ready',
    submitted: 'ubl_submitted',
    accepted: 'ubl_accepted',
    rejected: 'ubl_rejected',
  };
  try {
    await c.env.DB.prepare(`UPDATE invoices SET dgi_status = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(dgiMap[next] || next, id).run();
  } catch { /* */ }
  return c.json({
    success: true,
    data: {
      invoice_id: id,
      status: next,
      external_ref,
      clearance_live: false,
      note: note || 'Statut local uniquement — pas d’appel DGI/PDP.',
    },
    message: `Statut clearance → ${next}`,
  });
});

/** Download last prepared snapshot (archive) */
app.get('/api/invoices/:id/ubl/snapshot', async (c) => {
  const id = Number(c.req.param('id'));
  if (!id) return c.json({ success: false, error: 'id invalide' }, 400);
  await ensureUblClearance(c.env.DB);
  const row = await c.env.DB.prepare(`SELECT xml_snapshot, xml_sha256, status FROM invoice_ubl_clearance WHERE invoice_id = ?`).bind(id).first() as any;
  if (!row?.xml_snapshot) {
    return c.json({ success: false, error: 'Aucun snapshot — POST /ubl/prepare d’abord.' }, 404);
  }
  const inv = await c.env.DB.prepare(`SELECT number FROM invoices WHERE id = ?`).bind(id).first() as any;
  const safe = String(inv?.number || id).replace(/[^\w.-]+/g, '_');
  return new Response(row.xml_snapshot, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safe}.ubl.snapshot.xml"`,
      'Cache-Control': 'no-store',
      'X-UBL-Clearance-Status': String(row.status || ''),
      'X-UBL-SHA256': String(row.xml_sha256 || ''),
    },
  });
});

app.get('/api/receipts/:id/pdf', async (c) => {
  const id = c.req.param('id');
  await ensureReceiptsTable(c.env.DB);
  const receipt = await c.env.DB.prepare(`SELECT * FROM receipts WHERE id = ?`).bind(id).first() as any;
  if (!receipt) return c.json({ success: false, error: 'Reçu introuvable' }, 404);
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  // Represent receipt as a simple single-line document
  const invLike = {
    number: receipt.number,
    issue_date: receipt.issue_date,
    client_name: receipt.client_name,
    client_ice: '',
    client_address: '',
    client_city: '',
    client_email: '',
    client_phone: '',
    subtotal: Number(receipt.amount || 0),
    tax_amount: 0,
    total: Number(receipt.amount || 0),
    amount_paid: Number(receipt.amount || 0),
    notes: receipt.notes || `Reglement — mode ${receipt.payment_method || ''}`,
    status: 'paid',
  };
  const items = [{ product_name: 'Encaissement client', quantity: 1, unit_price: Number(receipt.amount || 0), tax_rate: 0, line_total: Number(receipt.amount || 0) }];
  const input = await invoiceToPdfInput(settings, invLike, items, 'RECU');
  let bytes: Uint8Array;
  try {
    bytes = await buildInvoicePdfLib(input);
  } catch (e) {
    console.error(JSON.stringify({ event: 'pdf_lib_failed', err: String((e as any)?.message || e), number: (input as any)?.number, title: (input as any)?.title }));
    bytes = buildInvoicePdf(input);
  }
  const safe = String(receipt.number || id).replace(/[^\w.-]+/g, '_');
  return pdfResponse(bytes, `${safe}.pdf`);
});

app.get('/api/bills', async (c) => {
  const status = c.req.query('status');
  let sql = `SELECT * FROM bills`;
  if (status) sql += ` WHERE status = ?`;
  sql += ` ORDER BY created_at DESC`;
  const stmt = status ? c.env.DB.prepare(sql).bind(status) : c.env.DB.prepare(sql);
  const { results } = await stmt.all();
  return c.json({ success: true, data: results });
});

app.get('/api/bills/:id', async (c) => {
  const id = c.req.param('id');
  const bill = await c.env.DB.prepare(`SELECT * FROM bills WHERE id = ?`).bind(id).first();
  if (!bill) return c.json({ success: false, error: 'Facture d\'achat introuvable' }, 404);
  const { results: items } = await c.env.DB.prepare(`SELECT * FROM bill_items WHERE bill_id = ?`).bind(id).all();
  return c.json({ success: true, data: { ...bill, items } });
});

/* ─── Bills: OCR / document parse (photo or scan → prefilled fields, human reviews) ─── */
function parseBillText(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const t = text.replace(/\r/g, '');
  const ice = t.match(/\b(\d{15})\b/);
  if (ice) out.ice = ice[1];
  const num = t.match(/(?:facture|invoice|n[°o]|number)[:\s#]*([A-Za-z0-9\-/]{3,20})/i);
  if (num) out.bill_number = num[1];
  const date = t.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (date) {
    let y = date[3];
    if (y.length === 2) y = '20' + y;
    out.issue_date = `${y}-${date[2].padStart(2, '0')}-${date[1].padStart(2, '0')}`;
  }
  const total = t.match(/(?:total\s*(?:ttc|à payer|a payer|due|net)?|montant(?:\s*ttc)?)[:\s]*([\d\s.,]+)\s*(?:dh|mad|dhs)?/i);
  if (total) {
    const v = total[1].replace(/[^\d.,]/g, '').replace(/\s/g, '').replace(',', '.');
    const n = Number(v);
    if (n > 0) out.total = String(n);
  }
  const vendor = t.match(/^\s*([A-ZÀ-Ý][\wÀ-ÿ&.'\- ]{2,60})\s*$/m);
  if (vendor && !/facture|total|date|ice|tva|t[ée]l|phone|adresse|address|devise|page/i.test(vendor[1])) {
    out.vendor_name = vendor[1].trim();
  }
  return out;
}

app.post('/api/bills/parse-document', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const dataUrl = String(body.data_url || body.dataUrl || '');
  const textHint = String(body.text || '');
  let fields: Record<string, string> = {};
  let items: any[] = [];
  let source = 'none';

  if (textHint.trim()) {
    fields = parseBillText(textHint);
    source = 'text';
  }

  // Optional Workers AI vision when the binding exists (same pattern as employee ID parse)
  try {
    const ai = (c.env as any).AI;
    if (ai && dataUrl.startsWith('data:image')) {
      const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (m) {
        const result = await ai.run('@cf/llava-hf/llava-1.5-7b-hf', {
          image: [...Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0))],
          prompt:
            'This is a supplier bill/invoice photo. Extract JSON only: {"vendor_name": string, "issue_date": "YYYY-MM-DD", "bill_number": string, "ice": string, "total": number, "items": [{"product_name": string, "quantity": number, "unit_cost": number}]}. Missing field: use "" or 0.',
          max_tokens: 700,
        });
        const raw = String(result?.description || result?.response || result || '');
        const jm = raw.match(/\{[\s\S]*\}/);
        if (jm) {
          try {
            const j = JSON.parse(jm[0]);
            fields = {
              vendor_name: String(j.vendor_name || fields.vendor_name || ''),
              issue_date: /^\d{4}-\d{2}-\d{2}$/.test(String(j.issue_date || ''))
                ? String(j.issue_date)
                : fields.issue_date || '',
              bill_number: String(j.bill_number || fields.bill_number || ''),
              ice: String(j.ice || fields.ice || ''),
              total: String(j.total || fields.total || ''),
            };
            if (Array.isArray(j.items)) {
              items = j.items
                .slice(0, 30)
                .map((it: any) => ({
                  product_name: String(it?.product_name || it?.name || ''),
                  quantity: Math.max(1, Number(it?.quantity || 1)),
                  unit_cost: Math.max(0, Number(it?.unit_cost || it?.cost || it?.unit_price || 0)),
                }))
                .filter((it: any) => it.product_name);
            }
            source = 'ai';
          } catch {
            fields = { ...fields, ...parseBillText(raw) };
            source = 'ai-text';
          }
        } else {
          fields = { ...fields, ...parseBillText(raw) };
          source = 'ai-text';
        }
      }
    }
  } catch (e) {
    console.log('parse-bill ai', e);
  }

  return c.json({
    success: true,
    data: {
      fields,
      items,
      source,
      review_message:
        'Champs extraits automatiquement — vérifiez fournisseur, date, lignes et total avant d’enregistrer.',
    },
  });
});

app.post('/api/bills', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const verr = validateBillWrite(body);
  if (verr) return apiFail(c, Object.values(verr)[0] || 'Validation', 'VALIDATION', verr);
  const lockCheck = await assertPeriodOpen(c.env.DB, body.issue_date);
  if (!lockCheck.ok) return c.json({ success: false, error: lockCheck.error, code: 'PERIOD_LOCKED' }, 403);
  const { vendor_id, vendor_name, vendor_ice = '', vendor_address = '', issue_date, due_date = null, notes = '', items = [], status = 'sent' } = body;
  if (!vendor_name || !items.length) return c.json({ success: false, error: 'Le nom du fournisseur et au moins une ligne sont obligatoires' }, 400);
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const number = await nextDocumentNumber(c.env.DB, 'bill', settings, c.env);
  let subtotal = 0, tax_amount = 0;
  const lineItems: any[] = [];
  for (const item of items) {
    // Purchase price can be lower or higher than catalog cost — always take the line unit_cost.
    const unitCost = Number(item.unit_cost ?? item.cost ?? item.unit_price ?? 0);
    const qty = Number(item.quantity || 0);
    const taxRate = Number(item.tax_rate ?? settings?.tax_rate ?? 0);
    const lineHt = qty * unitCost;
    const lineTax = lineHt * (taxRate / 100);
    subtotal += lineHt;
    tax_amount += lineTax;
    lineItems.push({
      ...item,
      unit_cost: unitCost,
      quantity: qty,
      tax_rate: taxRate,
      line_total: roundDh(lineHt + lineTax),
      update_product_cost: !!item.update_product_cost,
    });
  }
  subtotal = roundDh(subtotal); tax_amount = roundDh(tax_amount); const total = roundDh(subtotal + tax_amount);
  const billResult = await c.env.DB.prepare(`INSERT INTO bills (number, vendor_id, vendor_name, vendor_ice, vendor_address, issue_date, due_date, status, subtotal, tax_amount, total, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(number, vendor_id || null, vendor_name, vendor_ice, vendor_address, issue_date || new Date().toISOString().slice(0, 10), due_date, status, subtotal, tax_amount, total, notes).run();
  const billId = billResult.meta.last_row_id;
  for (const item of lineItems) {
    await c.env.DB.prepare(`INSERT INTO bill_items (bill_id, product_id, product_name, sku, quantity, unit_cost, tax_rate, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(billId, item.product_id || null, item.product_name, item.sku || '', item.quantity, item.unit_cost, item.tax_rate, item.line_total).run();
    if (item.product_id) {
      // Cost only on bill create — stock is added once on réception (3-way match).
      await applyMovingAverageCost(c.env.DB, item.product_id, Number(item.quantity || 0), Number(item.unit_cost || 0), number);
    }
  }
  await c.env.DB.prepare(`UPDATE company_settings SET next_bill_number = COALESCE(next_bill_number, 1) + 1 WHERE id = 1`).run();
  const bill = await c.env.DB.prepare(`SELECT * FROM bills WHERE id = ?`).bind(billId).first();
  const { results: billItems } = await c.env.DB.prepare(`SELECT * FROM bill_items WHERE bill_id = ?`).bind(billId).all();
  return c.json({
    success: true,
    data: { ...bill, items: billItems },
    message: 'Facture d\'achat enregistrée. Le stock sera mis à jour à la réception.',
  }, 201);
});

app.patch('/api/bills/:id/status', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const { status, amount_paid } = body;
    const allowed = ['draft', 'sent', 'paid', 'partial', 'cancelled'];
    if (!allowed.includes(status)) return c.json({ success: false, error: 'Statut invalide' }, 400);
    const prev = await c.env.DB.prepare(`SELECT * FROM bills WHERE id = ?`).bind(id).first() as any;
    if (!prev) return c.json({ success: false, error: 'Facture d\'achat introuvable' }, 404);

    // Cancelling reverses only what was actually received (not ordered qty)
    if (status === 'cancelled' && prev.status !== 'cancelled') {
      await ensureBillReceive(c.env.DB);
      const { results: items } = await c.env.DB.prepare(
        `SELECT product_id, COALESCE(qty_received, 0) as qty_received FROM bill_items WHERE bill_id = ?`
      ).bind(id).all();
      for (const it of (items || []) as any[]) {
        const recv = Number(it.qty_received || 0);
        if (it.product_id && recv > 0) {
          await applyStockDelta(
            c.env.DB,
            it.product_id,
            -recv,
            'Achat annulé (retrait stock reçu)',
            prev.number,
            { type: 'purchase_cancel' }
          );
        }
      }
      try {
        await c.env.DB.prepare(`UPDATE bill_items SET qty_received = 0 WHERE bill_id = ?`).bind(id).run();
        await c.env.DB.prepare(`UPDATE bills SET receive_status = 'pending' WHERE id = ?`).bind(id).run();
      } catch { /* */ }
    }
    // Re-activating a cancelled bill does NOT re-add stock — réception again if needed

    const updates = [`status = ?`, `updated_at = datetime('now')`];
    const values: any[] = [status];
    if (amount_paid !== undefined) {
      updates.push(`amount_paid = ?`);
      values.push(amount_paid);
    }
    values.push(id);
    await c.env.DB.prepare(`UPDATE bills SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
    await afterBusinessMutation(c.env.CACHE);
    const bill = await c.env.DB.prepare(`SELECT * FROM bills WHERE id = ?`).bind(id).first();
    return c.json({
      success: true,
      data: bill,
      message:
        status === 'cancelled'
          ? 'Facture d\'achat annulée — stock réajusté.'
          : 'Statut de la facture d\'achat mis à jour dans la base de données.',
    });
  } catch (e: any) {
    console.error('bill status', e);
    return c.json({ success: false, error: e?.message || 'Échec mise à jour', code: 'UPDATE_FAILED' }, 400);
  }
});

/** Bill payment history (split payments like invoices) */
async function ensureBillPaymentsTable(db: D1Database) {
  await schemaOnce('ensureBillPaymentsTable', async () => {
  await db.prepare(`CREATE TABLE IF NOT EXISTS bill_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT DEFAULT 'cash',
    payee TEXT DEFAULT 'company',
    note TEXT DEFAULT '',
    paid_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_bill_payments_bill ON bill_payments(bill_id)`).run();
  } catch { /* */ }

  });
}

app.post('/api/bills/:id/payments', async (c) => {
  const gate = requireBizMutator(c);
  if (!gate.ok) return gate.response;
  const id = c.req.param('id');
  await ensureBillPaymentsTable(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const idemKey = extractIdempotencyKey(c, body);
  if (idemKey) {
    const cached = await idempotencyGet(c.env.DB, `billpay:${id}:${idemKey}`);
    if (cached) return c.json(cached.body, cached.status as any);
  }
  const amount = Number(body.amount || 0);
  const payment_method = String(body.payment_method || 'cash');
  const payee = String(body.payee || 'company');
  const note = String(body.note || '');
  // v258 — tenant-local day (Africa/Casablanca), never the UTC date: a payment
  // made just after local midnight used to land in the previous month's finance
  // period because substr(paid_at,1,10) read a UTC day.
  const paid_at = String(body.paid_at || moroccoTodayStr()).slice(0, 10);
  if (!amount || amount <= 0) return c.json({ success: false, error: 'Montant de paiement invalide' }, 400);
  const allowedMethods = [
    'cash', 'bank_company', 'bank_owner', 'check_company', 'check_owner', 'card', 'other',
    'bank', 'check',
  ];
  const method = allowedMethods.includes(payment_method) ? payment_method : 'cash';
  const who = payee === 'owner' ? 'owner' : 'company';

  const bill = await c.env.DB.prepare(`SELECT * FROM bills WHERE id = ?`).bind(id).first() as any;
  if (!bill) return c.json({ success: false, error: 'Facture d\'achat introuvable' }, 404);
  if (bill.status === 'cancelled') return c.json({ success: false, error: 'Facture d\'achat annulée' }, 400);

  const prev = Number(bill.amount_paid || 0);
  const total = Number(bill.total || 0);
  const remainingBefore = Math.max(0, total - prev);
  if (remainingBefore <= 0.001) {
    return c.json({ success: false, error: 'Cette facture d\'achat est déjà soldée (reste = 0).', code: 'ALREADY_PAID' }, 400);
  }
  const applied = Math.min(amount, remainingBefore);
  if (applied <= 0) return c.json({ success: false, error: 'Montant de paiement invalide' }, 400);
  const next = prev + applied;
  const remaining = Math.max(0, total - next);
  const status = remaining <= 0.001 ? 'paid' : 'partial';

  await c.env.DB.prepare(
    `INSERT INTO bill_payments (bill_id, amount, payment_method, payee, note, paid_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, applied, method, who, note, paid_at).run();

  // Ledger: purchase payment = expense outflow (not income)
  try {
    await ensureExpenseTypeColumn(c.env.DB);
    const ledgerMethod =
      method === 'cash' || method === 'card' ? 'cash' :
      method.startsWith('bank') ? 'bank' :
      method.startsWith('check') ? 'check' : 'other';
    const whoLabel = who === 'owner' ? 'propriétaire' : 'société';
    const methodLabel =
      method === 'cash' ? 'espèces' :
      method === 'card' ? 'carte' :
      method === 'bank_company' ? 'virement société' :
      method === 'bank_owner' ? 'virement propriétaire' :
      method === 'check_company' ? 'chèque société' :
      method === 'check_owner' ? 'chèque propriétaire' :
      method === 'bank' ? 'virement' :
      method === 'check' ? 'chèque' : method;
    const ledgerDesc = `Règlement achat ${bill.number} (${methodLabel} → ${whoLabel})${note ? ' — ' + note : ''}`;
    await c.env.DB.prepare(
      `INSERT INTO expenses (category, description, amount, payment_method, expense_date, vendor_name, reference, notes, entry_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'expense')`
    ).bind(
      'Règlement fournisseur',
      ledgerDesc,
      applied,
      ledgerMethod,
      paid_at,
      bill.vendor_name || '',
      bill.number || '',
      `bill_id:${id}|payee:${who}|method:${method}`,
    ).run();
  } catch (e) {
    console.error('bill payment ledger', e);
  }

  await c.env.DB.prepare(
    `UPDATE bills SET amount_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(next, status, id).run();
  await afterBusinessMutation(c.env.CACHE);

  const payload = {
    success: true,
    data: await c.env.DB.prepare(`SELECT * FROM bills WHERE id = ?`).bind(id).first(),
    applied,
    remaining: Math.max(0, total - next),
    message:
      status === 'paid'
        ? `Paiement de ${applied} MAD enregistré — facture d'achat soldée.`
        : `Paiement partiel de ${applied} MAD enregistré — reste ${Math.max(0, total - next)} MAD.`,
  };
  if (idemKey) {
    try {
      await idempotencyPut(c.env.DB, `billpay:${id}:${idemKey}`, 'POST /bills/payments', 200, payload);
    } catch { /* */ }
  }
  return c.json(payload);
});

app.get('/api/bills/:id/payments', async (c) => {
  await ensureBillPaymentsTable(c.env.DB);
  const id = c.req.param('id');
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM bill_payments WHERE bill_id = ? ORDER BY paid_at DESC, id DESC`
  ).bind(id).all();
  return c.json({ success: true, data: results || [] });
});

app.get('/api/bills/:id/print', async (c) => {
  const id = c.req.param('id');
  const bill = await c.env.DB.prepare(`SELECT * FROM bills WHERE id = ?`).bind(id).first();
  if (!bill) return c.json({ success: false, error: 'Facture d\'achat introuvable' }, 404);
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const { results: items } = await c.env.DB.prepare(`SELECT * FROM bill_items WHERE bill_id = ?`).bind(id).all();
  await ensureDocAssetColumns(c.env.DB);
  return c.html(generateInvoiceHTML(settings, bill as any, items as any[], 'FACTURE D\'ACHAT'));
});

app.post('/api/bills/:id/request-delete-otp', async (c) => {
  const id = c.req.param('id');
  const bill = await c.env.DB.prepare(`SELECT * FROM bills WHERE id = ?`).bind(id).first() as any;
  if (!bill) return c.json({ success: false, error: 'Facture d\'achat introuvable' }, 404);
  const label = `Facture d'achat ${bill.number}`;
  const result = await issueDeleteOtp(c.env, 'bill', String(id), label, `Code de suppression — ${label}`);
  return c.json({ success: true, message: result.message, emailed: result.emailed, otp: result.emailed ? undefined : result.otp });
});

app.delete('/api/bills/:id', async (c) => {
  try {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
    if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);
    const bill = await c.env.DB.prepare(`SELECT * FROM bills WHERE id = ?`).bind(id).first() as any;
    if (!bill) return c.json({ success: false, error: 'Facture fournisseur introuvable' }, 404);
    // Reverse only received qty (stock is applied on réception, not on create)
    if (bill.status !== 'cancelled') {
      await ensureBillReceive(c.env.DB);
      const { results: items } = await c.env.DB.prepare(
        `SELECT product_id, COALESCE(qty_received, 0) as qty_received FROM bill_items WHERE bill_id = ?`
      ).bind(id).all();
      for (const it of (items || []) as any[]) {
        const recv = Number(it.qty_received || 0);
        if (it.product_id && recv > 0) {
          await applyStockDelta(
            c.env.DB,
            it.product_id,
            -recv,
            'Achat supprimé (retrait stock reçu)',
            bill.number,
            { type: 'purchase_delete' }
          );
        }
      }
    }
    await c.env.DB.prepare(`DELETE FROM bill_items WHERE bill_id = ?`).bind(id).run();
    await c.env.DB.prepare(`DELETE FROM bills WHERE id = ?`).bind(id).run();
    await afterBusinessMutation(c.env.CACHE);
    await writeAudit(c.env.DB, {
      username: gate.username, role: gate.role, action: 'bill.delete',
      entity: 'bills', entity_id: id, detail: bill.number || '',
      ip: c.req.header('cf-connecting-ip') || '',
    });
    return c.json({ success: true, message: `Facture fournisseur ${bill.number} supprimée.` });
  } catch (e: any) {
    console.error('bill delete', e);
    return c.json({ success: false, error: e?.message || 'Échec de la suppression', code: 'DELETE_FAILED' }, 400);
  }
});

app.post('/api/bills/request-bulk-delete-otp', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const ids: number[] = Array.isArray(body.ids) ? body.ids.map((x: any) => Number(x)).filter((n: number) => n > 0) : [];
  if (!ids.length) return c.json({ success: false, error: 'Aucune facture d\'achat sélectionnée' }, 400);
  const placeholders = ids.map(() => '?').join(',');
  const { results: bills } = await c.env.DB.prepare(`SELECT id, number FROM bills WHERE id IN (${placeholders})`).bind(...ids).all();
  if (!bills?.length) return c.json({ success: false, error: 'Aucune facture d\'achat trouvée' }, 404);
  const resourceId = ids.slice().sort((a, b) => a - b).join(',');
  const label = `${bills.length} facture(s) d'achat : ${(bills as any[]).map((x) => x.number).join(', ')}`;
  const result = await issueDeleteOtp(c.env, 'bills_bulk', resourceId, label, `Code de suppression — ${bills.length} facture(s) d'achat`);
  return c.json({ success: true, message: result.message, emailed: result.emailed, otp: result.emailed ? undefined : result.otp, count: bills.length });
});

app.post('/api/bills/bulk-delete', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const ids: number[] = Array.isArray(body.ids) ? body.ids.map((x: any) => Number(x)).filter((n: number) => n > 0) : [];
    if (!ids.length) return c.json({ success: false, error: 'Aucune facture d\'achat sélectionnée' }, 400);
  const resourceId = ids.slice().sort((a, b) => a - b).join(',');
  const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
  if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);
  const placeholders = ids.map(() => '?').join(',');
  await c.env.DB.prepare(`DELETE FROM bill_items WHERE bill_id IN (${placeholders})`).bind(...ids).run();
  await c.env.DB.prepare(`DELETE FROM bills WHERE id IN (${placeholders})`).bind(...ids).run();
  return c.json({ success: true, message: `${ids.length} facture(s) d'achat supprimée(s) de la base de données.` });
});

app.get('/api/receipts', async (c) => {
  await ensureReceiptSituationColumn(c.env.DB);
  await ensureReceiptsTable(c.env.DB);
  let results: any[] = [];
  try {
    const q = await c.env.DB.prepare(
      `SELECT r.*, i.number AS invoice_number, i.status AS invoice_status
       FROM receipts r
       LEFT JOIN invoices i ON i.id = r.invoice_id
       ORDER BY COALESCE(r.issue_date, r.created_at) DESC, r.id DESC`
    ).all();
    results = q.results || [];
  } catch {
    const q = await c.env.DB.prepare(`SELECT * FROM receipts ORDER BY id DESC`).all();
    results = q.results || [];
  }
  return c.json({ success: true, data: results, count: results.length });
});

app.post('/api/receipts', async (c) => {
  await ensureReceiptsTable(c.env.DB);
  await ensureExpenseTypeColumn(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const verr = validateReceiptWrite(body);
  if (verr) return apiFail(c, Object.values(verr)[0] || 'Validation', 'VALIDATION', verr);
  const { invoice_id, client_name, amount, payment_method = 'cash', issue_date, notes = '' } = body;
  if (!client_name || amount == null || Number(amount) <= 0) {
    return c.json({ success: false, error: 'Le nom du client et le montant sont obligatoires' }, 400);
  }
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const paidAt = issue_date || new Date().toISOString().slice(0, 10);
  const method = String(payment_method || 'cash');
  let number = await nextDocumentNumber(c.env.DB, 'receipt', settings, c.env);
  let result: any;
  try {
    result = await c.env.DB.prepare(
      `INSERT INTO receipts (number, invoice_id, client_name, amount, payment_method, issue_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(number, invoice_id || null, client_name, Number(amount), method, paidAt, notes).run();
  } catch (e: any) {
    // Retry once with timestamp suffix if unique collision
    number = `${number}-${Date.now().toString(36).slice(-4)}`;
    result = await c.env.DB.prepare(
      `INSERT INTO receipts (number, invoice_id, client_name, amount, payment_method, issue_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(number, invoice_id || null, client_name, Number(amount), method, paidAt, notes).run();
  }

  // If linked to invoice: record payment history (no double amount_paid if already paid via payments API)
  if (invoice_id) {
    await ensurePaymentHistoryTable(c.env.DB);
    const inv = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(invoice_id).first() as any;
    if (inv) {
      const prev = Number(inv.amount_paid || 0);
      const total = Number(inv.total || 0);
      const applied = Math.min(Number(amount), Math.max(0, total - prev));
      if (applied > 0.001 && inv.status !== 'paid') {
        await c.env.DB.prepare(
          `INSERT INTO invoice_payments (invoice_id, amount, payment_method, payee, note, paid_at) VALUES (?, ?, ?, ?, ?, ?)`
        ).bind(invoice_id, applied, method, 'company', notes || `Reçu ${number}`, paidAt).run();
        const next = prev + applied;
        const status = next >= total - 0.001 ? 'paid' : 'partial';
        await c.env.DB.prepare(
          `UPDATE invoices SET amount_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
        ).bind(next, status, invoice_id).run();
      }
    }
  }

  // Ledger entry for solde (caisse/banque) — always for manual receipts
  const ledgerMethod =
    method === 'cash' || method === 'card' ? 'cash' :
    String(method).startsWith('bank') || method === 'bank' ? 'bank' :
    String(method).startsWith('check') || method === 'check' ? 'check' : 'other';
  await c.env.DB.prepare(
    `INSERT INTO expenses (category, description, amount, payment_method, expense_date, vendor_name, reference, notes, entry_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'income')`
  ).bind(
    'Encaissement client',
    `Reçu ${number}${invoice_id ? '' : ' (manuel)'} — ${client_name}`,
    Number(amount),
    ledgerMethod,
    paidAt,
    client_name,
    number,
    invoice_id ? `invoice_id:${invoice_id}|receipt:${result.meta.last_row_id}` : `receipt:${result.meta.last_row_id}`,
  ).run();

  const receipt = await c.env.DB.prepare(`SELECT * FROM receipts WHERE id = ?`).bind(result.meta.last_row_id).first();
  return c.json({ success: true, data: receipt, message: `Reçu ${number} enregistré et visible dans la liste.` }, 201);
});


app.put('/api/receipts/:id', async (c) => {
  const id = c.req.param('id');
  await ensureReceiptsTable(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const r = await c.env.DB.prepare(`SELECT * FROM receipts WHERE id = ?`).bind(id).first();
  if (!r) return c.json({ success: false, error: 'Reçu introuvable' }, 404);
  const fields: string[] = [];
  const values: any[] = [];
  for (const k of ['client_name', 'amount', 'payment_method', 'issue_date', 'notes']) {
    if (body[k] !== undefined) {
      fields.push(`${k} = ?`);
      values.push(body[k]);
    }
  }
  if (!fields.length) return c.json({ success: false, error: 'Aucun champ à modifier' }, 400);
  values.push(id);
  await c.env.DB.prepare(`UPDATE receipts SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
  const updated = await c.env.DB.prepare(`SELECT * FROM receipts WHERE id = ?`).bind(id).first();
  return c.json({ success: true, data: updated, message: 'Reçu mis à jour.' });
});

app.get('/api/receipts/:id/print', async (c) => {
  const id = c.req.param('id');
  await ensureReceiptsTable(c.env.DB);
  await ensureDocAssetColumns(c.env.DB);
  await ensureReceiptPublicToken(c.env.DB);
  let receipt = await c.env.DB.prepare(
    `SELECT r.*, i.number AS invoice_number, i.client_ice, i.client_address, i.client_city, i.client_id
     FROM receipts r
     LEFT JOIN invoices i ON i.id = r.invoice_id
     WHERE r.id = ?`
  ).bind(id).first() as any;
  if (!receipt) return c.json({ success: false, error: 'Reçu introuvable' }, 404);
  if (!receipt.public_token) {
    const tok = makePublicToken();
    await c.env.DB.prepare(`UPDATE receipts SET public_token = ? WHERE id = ?`).bind(tok, id).run();
    receipt = { ...receipt, public_token: tok };
  }
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const origin = new URL(c.req.url).origin;
  // QR 1: secure verify this receipt (HMAC)
  const secureReceipt = await makeSecureQrPayload(c.env, 'receipt', receipt.public_token, 0, c.env.DB);
  const verifyUrl = `${origin}/api/public/verify?p=${encodeURIComponent(secureReceipt)}`;
  // QR 2: client account status (paid + unpaid)
  const clientKey = String(receipt.client_name || '').trim().toLowerCase();
  let clientIce = receipt.client_ice || '';
  if (!clientIce && receipt.invoice_id) {
    try {
      const linkedInv = await c.env.DB.prepare(`SELECT client_ice FROM invoices WHERE id = ?`).bind(receipt.invoice_id).first() as any;
      clientIce = linkedInv?.client_ice || '';
    } catch { /* ignore */ }
  }
  // Situation QR must resolve via invoices.public_token (client-status lookup).
  // Prefer linked invoice token; mint if missing. Fallback: receipt token + client-status receipt path.
  let statusPublicToken = '';
  let statusSignType: 'invoice' | 'receipt' = 'invoice';
  await ensureInvoicePublicToken(c.env.DB);
  if (receipt.invoice_id) {
    try {
      let invTok = await c.env.DB.prepare(`SELECT public_token FROM invoices WHERE id = ?`).bind(receipt.invoice_id).first() as any;
      statusPublicToken = String(invTok?.public_token || '').trim();
      if (!statusPublicToken) {
        statusPublicToken = makePublicToken();
        await c.env.DB.prepare(`UPDATE invoices SET public_token = ? WHERE id = ?`).bind(statusPublicToken, receipt.invoice_id).run();
      }
      statusSignType = 'invoice';
    } catch { /* */ }
  }
  if (!statusPublicToken) {
    statusPublicToken = String((receipt as any).public_token || '').trim();
    statusSignType = 'receipt';
  }
  let statusUrl = '';
  await ensureQrPrivacySettings(c.env.DB);
  await ensureReceiptSituationColumn(c.env.DB);
  const qrSitGlobal = Number((settings as any)?.qr_client_situation ?? 0) === 1;
  const qrSitReceipt = Number((receipt as any)?.include_client_situation ?? 0) === 1;
  const qrSitOn = qrSitGlobal || qrSitReceipt;
  if (qrSitOn && statusPublicToken) {
    try {
      const ttlDays = Math.max(7, Math.min(365, Number((settings as any)?.qr_situation_ttl_days ?? 90) || 90));
      const ttlSec = ttlDays * 86400;
      const signedStatus = await makeSecureQrPayload(c.env, statusSignType, statusPublicToken, ttlSec, c.env.DB);
      statusUrl = `${origin}/api/public/verify?doc=client&t=${encodeURIComponent(signedStatus)}`;
    } catch {
      statusUrl = '';
    }
  }
  // Optional product lines from linked invoice (full layout)
  let lineItems: any[] = [];
  if (receipt.invoice_id) {
    try {
      const { results } = await c.env.DB.prepare(
        `SELECT product_name, sku, quantity, unit_price, tax_rate, line_total
         FROM invoice_items WHERE invoice_id = ? ORDER BY id`
      ).bind(receipt.invoice_id).all();
      lineItems = results || [];
    } catch { lineItems = []; }
  }
  const layout = String(c.req.query('layout') || c.req.query('mode') || 'full').toLowerCase();
  const html = layout === 'minimal' || layout === 'simple' || layout === 'ticket'
    ? generateReceiptHTMLMinimal(settings, receipt, statusUrl, verifyUrl)
    : generateReceiptHTML(settings, { ...receipt, _line_items: lineItems }, statusUrl, verifyUrl);
  return c.html(html);
});

app.post('/api/receipts/:id/request-delete-otp', async (c) => {
  const id = c.req.param('id');
  const receipt = await c.env.DB.prepare(`SELECT * FROM receipts WHERE id = ?`).bind(id).first() as any;
  if (!receipt) return c.json({ success: false, error: 'Reçu introuvable' }, 404);

  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await c.env.DB.prepare(
    `INSERT INTO otp_codes (code, resource_type, resource_id, expires_at) VALUES (?, 'receipt', ?, ?)
     ON CONFLICT(resource_type, resource_id) DO UPDATE SET code = ?, expires_at = ?, created_at = datetime('now')`
  ).bind(otp, id, expiresAt, otp, expiresAt).run();

  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const companyName = settings?.company_name || 'Atlas Commerce';
  const fromAddr = c.env.OTP_FROM || 'noreply@afmarbre.com';
  const toAddr = c.env.OTP_TO || 'security@afmarbre.com';

  try {
    await c.env.EMAIL.send({
      to: toAddr,
      from: fromAddr,
      subject: `Code de suppression — Reçu ${receipt.number}`,
      html: otpEmailHTML(otp, `Reçu ${receipt.number}`, companyName),
      text: `Code de confirmation pour supprimer le reçu ${receipt.number} : ${otp}. Ce code est valable 10 minutes.`,
    });
  } catch (e: any) {
    return c.json({ success: false, error: 'Impossible d\'envoyer le code par e-mail. Vérifiez la configuration Email Routing.', detail: e.message }, 500);
  }

  return c.json({ success: true, message: `Code envoyé à ${toAddr}. Vérifiez votre boîte de réception.` });
});

app.get('/api/receipts/:id/links', async (c) => {
  await ensureReceiptsTable(c.env.DB);
  const id = c.req.param('id');
  const receipt = await c.env.DB.prepare(`SELECT * FROM receipts WHERE id = ?`).bind(id).first() as any;
  if (!receipt) return c.json({ success: false, error: 'Reçu introuvable' }, 404);
  const expenses = await expensesLinkedToReceipt(c.env.DB, receipt);
  let invoice = null;
  if (receipt.invoice_id) {
    invoice = await c.env.DB.prepare(`SELECT id, number, status FROM invoices WHERE id = ?`).bind(receipt.invoice_id).first();
  }
  return c.json({
    success: true,
    data: {
      receipt: { id: receipt.id, number: receipt.number },
      invoice,
      expenses: expenses.map((e: any) => ({ id: e.id, description: e.description, amount: e.amount })),
      disclaimer: (invoice || expenses.length)
        ? 'La suppression de ce reçu efface les écritures de solde liées.' + (invoice ? ' Option cascade : supprimer aussi la facture liée.' : '')
        : null,
    },
  });
});


/** Recalculate invoice/VR amount_paid + status from remaining payment rows. */
async function recalcInvoicePaidFromPayments(db: D1Database, invoiceId: number | string) {
  const inv = await db.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(invoiceId).first() as any;
  if (!inv) return null;
  const sumRow = await db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS s FROM invoice_payments WHERE invoice_id = ?`,
  ).bind(invoiceId).first() as any;
  const paid = Math.max(0, Number(sumRow?.s || 0));
  const total = Number(inv.total || 0);
  let status = String(inv.status || 'sent');
  const locked = ['cancelled', 'quote', 'devis', 'remboursement'].includes(status)
    || inv.doc_kind === 'remboursement';
  if (!locked) {
    if (paid <= 0.001) status = 'sent';
    else if (paid + 0.001 >= total) status = 'paid';
    else status = 'partial';
  }
  await db.prepare(
    `UPDATE invoices SET amount_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(paid, status, invoiceId).run();
  return { paid, status, total };
}

/**
 * Void payments totaling `amount` (newest first) and reopen AR on FA/VR.
 * Also removes matching income ledger rows for the invoice.
 */
async function reversePaymentsOnInvoice(
  db: D1Database,
  invoiceId: number | string,
  amountToReverse: number,
) {
  const target = Math.max(0, Number(amountToReverse || 0));
  if (target <= 0.001) {
    return recalcInvoicePaidFromPayments(db, invoiceId);
  }
  const { results: pays } = await db.prepare(
    `SELECT id, amount FROM invoice_payments WHERE invoice_id = ? ORDER BY paid_at DESC, id DESC`,
  ).bind(invoiceId).all();
  let left = target;
  for (const p of (pays || []) as any[]) {
    if (left <= 0.001) break;
    const amt = Number(p.amount || 0);
    if (amt <= left + 0.001) {
      await db.prepare(`DELETE FROM invoice_payments WHERE id = ?`).bind(p.id).run();
      left = Math.max(0, left - amt);
    } else {
      // Split: reduce payment row
      const next = Math.max(0, amt - left);
      await db.prepare(`UPDATE invoice_payments SET amount = ? WHERE id = ?`).bind(next, p.id).run();
      left = 0;
    }
  }
  // Remove income ledger entries for this invoice (encaissement)
  try {
    const { results: inc } = await db.prepare(
      `SELECT id FROM expenses WHERE entry_type = 'income' AND (notes LIKE ? OR reference IN (SELECT number FROM invoices WHERE id = ?))`,
    ).bind(`%invoice_id:${invoiceId}%`, invoiceId).all();
    for (const e of (inc || []) as any[]) {
      await db.prepare(`DELETE FROM expenses WHERE id = ?`).bind(e.id).run();
    }
  } catch { /* */ }
  return recalcInvoicePaidFromPayments(db, invoiceId);
}


/** Void a single payment row → reopen AR on FA/VR */
app.delete('/api/invoices/:id/payments/:paymentId', async (c) => {
  try {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const invId = c.req.param('id');
    const paymentId = c.req.param('paymentId');
    const body = await c.req.json().catch(() => ({}));
    const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
    if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);

    const pay = await c.env.DB.prepare(
      `SELECT * FROM invoice_payments WHERE id = ? AND invoice_id = ?`,
    ).bind(paymentId, invId).first() as any;
    if (!pay) return c.json({ success: false, error: 'Paiement introuvable' }, 404);

    const amt = Number(pay.amount || 0);
    await c.env.DB.prepare(`DELETE FROM invoice_payments WHERE id = ?`).bind(paymentId).run();
    // Remove proportional income ledger if exact match
    try {
      const { results: inc } = await c.env.DB.prepare(
        `SELECT id, amount FROM expenses WHERE entry_type = 'income' AND notes LIKE ? ORDER BY id DESC`,
      ).bind(`%invoice_id:${invId}%`).all();
      let left = amt;
      for (const e of (inc || []) as any[]) {
        if (left <= 0.001) break;
        if (Math.abs(Number(e.amount || 0) - left) < 0.02 || Number(e.amount || 0) <= left + 0.001) {
          left -= Number(e.amount || 0);
          await c.env.DB.prepare(`DELETE FROM expenses WHERE id = ?`).bind(e.id).run();
        }
      }
    } catch { /* */ }

    const ar = await recalcInvoicePaidFromPayments(c.env.DB, invId);
    await afterBusinessMutation(c.env.CACHE);
    return c.json({
      success: true,
      message: `Paiement annulé (${amt}). Dette rétablie — payé ${ar?.paid ?? 0} / ${ar?.total ?? 0}.`,
      data: ar,
    });
  } catch (e: any) {
    console.error('payment void', e);
    return c.json({ success: false, error: e?.message || 'Échec annulation paiement' }, 400);
  }
});

app.delete('/api/receipts/:id', async (c) => {
  try {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
  if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);

  await ensureReceiptsTable(c.env.DB);
  const receipt = await c.env.DB.prepare(`SELECT * FROM receipts WHERE id = ?`).bind(id).first() as any;
  if (!receipt) return c.json({ success: false, error: 'Reçu introuvable' }, 404);

  const expenses = await expensesLinkedToReceipt(c.env.DB, receipt);
  for (const e of expenses) {
    await c.env.DB.prepare(`DELETE FROM expenses WHERE id = ?`).bind(e.id).run();
  }

  let invMsg = '';
  let ar: any = null;
  if (body.cascade_invoice && receipt.invoice_id) {
    await cascadeDeleteInvoice(c.env.DB, receipt.invoice_id);
    invMsg = ' Facture/ticket lié et paiements également supprimés.';
  } else if (receipt.invoice_id) {
    // Master rule: void receipt → reopen exact unpaid AR on FA or VR
    const reverseAmt = Number(receipt.amount || 0);
    ar = await reversePaymentsOnInvoice(c.env.DB, receipt.invoice_id, reverseAmt);
    invMsg = ar
      ? ` Solde document rétabli (payé ${ar.paid} / ${ar.total}, statut ${ar.status}).`
      : ' Dette client rétablie sur le document lié.';
  }

  await c.env.DB.prepare(`DELETE FROM receipts WHERE id = ?`).bind(id).run();

  await afterBusinessMutation(c.env.CACHE);
  return c.json({
    success: true,
    message: `Reçu ${receipt.number} supprimé` + (expenses.length ? ` et ${expenses.length} écriture(s) solde.` : '.') + invMsg,
    deleted: {
      receipt: receipt.number,
      expenses: expenses.length,
      invoice_cascaded: !!(body.cascade_invoice && receipt.invoice_id),
      ar_reopened: ar,
    },
  });
  } catch (e: any) {
    console.error('receipt delete', e);
    return c.json({ success: false, error: e?.message || 'Échec de la suppression', code: 'DELETE_FAILED' }, 400);
  }
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

/* ─── Dashboard ─── */

/** Phase 0 — integrity snapshot (owner diagnostic, not cached). */
app.get('/api/integrity/status', async (c) => {
  try {
    await ensureInvoiceRefundColumns(c.env.DB);
    await ensurePaymentHistoryTable(c.env.DB);
    await ensureIdempotencyTable(c.env.DB);
    await ensurePeriodLockColumn(c.env.DB);
    const negStock = await c.env.DB.prepare(
      `SELECT COUNT(*) as c FROM products WHERE is_active = 1 AND track_inventory = 1 AND stock_quantity < 0`
    ).first() as any;
    const wrCount = await c.env.DB.prepare(
      `SELECT COUNT(*) as c FROM invoices WHERE status = 'remboursement' OR doc_kind = 'remboursement'`
    ).first() as any;
    const dupNumbers = await c.env.DB.prepare(
      `SELECT number, COUNT(*) as c FROM invoices GROUP BY number HAVING c > 1 LIMIT 5`
    ).all();
    const payOnWr = await c.env.DB.prepare(
      `SELECT COUNT(*) as c FROM invoice_payments p
       INNER JOIN invoices i ON i.id = p.invoice_id
       WHERE i.status = 'remboursement' OR i.doc_kind = 'remboursement'`
    ).first() as any;
    const lock = await c.env.DB.prepare(`SELECT fiscal_locked_through FROM company_settings WHERE id = 1`).first() as any;
    return c.json({
      success: true,
      data: {
        negative_stock_products: Number(negStock?.c || 0),
        wr_documents: Number(wrCount?.c || 0),
        duplicate_invoice_numbers: (dupNumbers.results || []).length,
        payments_on_wr: Number(payOnWr?.c || 0),
        fiscal_locked_through: lock?.fiscal_locked_through || null,
        atomic_stock: true,
        idempotency_table: true,
        phase: '0+1',
        ok:
          Number(negStock?.c || 0) === 0 &&
          (dupNumbers.results || []).length === 0,
      },
    });
  } catch (e: any) {
    return c.json({ success: false, error: e?.message || 'integrity check failed' }, 500);
  }
});

/**
 * Phase 0 regression — owner only.
 * Creates ephemeral product + invoice + payment + WR (restock + no-restock) then cleans up.
 * Does not leave durable commercial data when successful.
 */
app.post('/api/integrity/regression', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  const steps: { name: string; ok: boolean; detail?: string }[] = [];
  const tag = `REG-${Date.now()}`;
  let productId = 0;
  let invoiceId = 0;
  let wrId = 0;
  try {
    await ensureIdempotencyTable(c.env.DB);
    await ensureInvoiceRefundColumns(c.env.DB);
    await ensurePaymentHistoryTable(c.env.DB);

    // 1) Product with stock 10
    const pr = await c.env.DB.prepare(
      `INSERT INTO products (sku, name, price, cost, stock_quantity, track_inventory, is_active, unit, category)
       VALUES (?, ?, 100, 40, 0, 1, 1, 'u', 'test')`
    ).bind(`SKU-${tag}`, `Produit ${tag}`).run();
    productId = Number(pr.meta.last_row_id);
    await applyStockDelta(c.env.DB, productId, 10, 'Regression seed', tag, { type: 'initial' });
    const st0 = await c.env.DB.prepare(`SELECT stock_quantity FROM products WHERE id = ?`).bind(productId).first() as any;
    steps.push({ name: 'seed_stock', ok: Number(st0?.stock_quantity) === 10, detail: String(st0?.stock_quantity) });

    // 2) Sale qty 5
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const number = await nextDocumentNumber(c.env.DB, 'invoice', settings, c.env);
    const invIns = await c.env.DB.prepare(
      `INSERT INTO invoices (number, client_name, issue_date, status, subtotal, tax_amount, total, amount_paid)
       VALUES (?, 'Client REG', date('now'), 'sent', 500, 0, 500, 0)`
    ).bind(number).run();
    invoiceId = Number(invIns.meta.last_row_id);
    await c.env.DB.prepare(
      `INSERT INTO invoice_items (invoice_id, product_id, product_name, sku, quantity, unit_price, tax_rate, line_total)
       VALUES (?, ?, ?, ?, 5, 100, 0, 500)`
    ).bind(invoiceId, productId, `Produit ${tag}`, `SKU-${tag}`).run();
    await applyStockDelta(c.env.DB, productId, -5, 'Facture', number, { type: 'sale' });
    const st1 = await c.env.DB.prepare(`SELECT stock_quantity FROM products WHERE id = ?`).bind(productId).first() as any;
    steps.push({ name: 'sale_stock_5', ok: Number(st1?.stock_quantity) === 5, detail: String(st1?.stock_quantity) });

    // 3) Oversell reject
    let oversellBlocked = false;
    try {
      await applyStockDelta(c.env.DB, productId, -99, 'Oversell test', tag, { type: 'sale' });
    } catch (e: any) {
      oversellBlocked = e?.code === 'INSUFFICIENT_STOCK';
    }
    steps.push({ name: 'oversell_blocked', ok: oversellBlocked });

    // 4) Payment
    await c.env.DB.prepare(
      `INSERT INTO invoice_payments (invoice_id, amount, payment_method, payee, note, paid_at)
       VALUES (?, 500, 'cash', 'company', 'REG pay', date('now'))`
    ).bind(invoiceId).run();
    await c.env.DB.prepare(`UPDATE invoices SET amount_paid = 500, status = 'paid' WHERE id = ?`).bind(invoiceId).run();
    steps.push({ name: 'payment', ok: true });

    // 5) WR restock 2
    const wrNum = await nextDocumentNumber(c.env.DB, 'credit_note', settings, c.env);
    const wrIns = await c.env.DB.prepare(
      `INSERT INTO invoices (number, client_name, issue_date, status, subtotal, tax_amount, total, amount_paid, doc_kind, refund_of_invoice_id)
       VALUES (?, 'Client REG', date('now'), 'remboursement', 200, 0, 200, 0, 'remboursement', ?)`
    ).bind(wrNum, invoiceId).run();
    wrId = Number(wrIns.meta.last_row_id);
    await c.env.DB.prepare(
      `INSERT INTO invoice_items (invoice_id, product_id, product_name, sku, quantity, unit_price, tax_rate, line_total)
       VALUES (?, ?, ?, ?, 2, 100, 0, 200)`
    ).bind(wrId, productId, `Produit ${tag}`, `src_item:0|restock:1`).run();
    await applyStockDelta(c.env.DB, productId, 2, `WR ${wrNum} — retour stock`, wrNum, { type: 'refund_restock' });
    const st2 = await c.env.DB.prepare(`SELECT stock_quantity FROM products WHERE id = ?`).bind(productId).first() as any;
    steps.push({ name: 'wr_restock', ok: Number(st2?.stock_quantity) === 7, detail: String(st2?.stock_quantity) });

    // 6) Delete WR reverses restock
    await applyStockDelta(c.env.DB, productId, -2, 'WR deleted', wrNum, { type: 'sale' });
    await c.env.DB.prepare(`DELETE FROM invoice_items WHERE invoice_id = ?`).bind(wrId).run();
    await c.env.DB.prepare(`DELETE FROM invoices WHERE id = ?`).bind(wrId).run();
    wrId = 0;
    const st3 = await c.env.DB.prepare(`SELECT stock_quantity FROM products WHERE id = ?`).bind(productId).first() as any;
    steps.push({ name: 'wr_delete_reverse', ok: Number(st3?.stock_quantity) === 5, detail: String(st3?.stock_quantity) });

    // Cleanup invoice + product
    await c.env.DB.prepare(`DELETE FROM invoice_payments WHERE invoice_id = ?`).bind(invoiceId).run();
    await c.env.DB.prepare(`DELETE FROM invoice_items WHERE invoice_id = ?`).bind(invoiceId).run();
    await c.env.DB.prepare(`DELETE FROM invoices WHERE id = ?`).bind(invoiceId).run();
    invoiceId = 0;
    await applyStockDelta(c.env.DB, productId, -Number(st3?.stock_quantity || 0), 'REG cleanup', tag, { allowNegative: true, type: 'adjustment' });
    await c.env.DB.prepare(`DELETE FROM stock_movements WHERE product_id = ?`).bind(productId).run();
    await c.env.DB.prepare(`DELETE FROM products WHERE id = ?`).bind(productId).run();
    productId = 0;

    const allOk = steps.every((s) => s.ok);
    return c.json({ success: allOk, data: { steps, tag }, message: allOk ? 'Regression OK' : 'Regression FAILED' }, allOk ? 200 : 500);
  } catch (e: any) {
    // best-effort cleanup
    try {
      if (wrId) {
        await c.env.DB.prepare(`DELETE FROM invoice_items WHERE invoice_id = ?`).bind(wrId).run();
        await c.env.DB.prepare(`DELETE FROM invoices WHERE id = ?`).bind(wrId).run();
      }
      if (invoiceId) {
        await c.env.DB.prepare(`DELETE FROM invoice_payments WHERE invoice_id = ?`).bind(invoiceId).run();
        await c.env.DB.prepare(`DELETE FROM invoice_items WHERE invoice_id = ?`).bind(invoiceId).run();
        await c.env.DB.prepare(`DELETE FROM invoices WHERE id = ?`).bind(invoiceId).run();
      }
      if (productId) {
        await c.env.DB.prepare(`DELETE FROM stock_movements WHERE product_id = ?`).bind(productId).run();
        await c.env.DB.prepare(`DELETE FROM products WHERE id = ?`).bind(productId).run();
      }
    } catch { /* */ }
    return c.json({ success: false, error: e?.message || 'regression failed', steps }, 500);
  }
});

/** Phase 1 — period lock */
app.get('/api/fiscal/period-lock', async (c) => {
  await ensurePeriodLockColumn(c.env.DB);
  const row = await c.env.DB.prepare(`SELECT fiscal_locked_through FROM company_settings WHERE id = 1`).first() as any;
  return c.json({ success: true, data: { fiscal_locked_through: row?.fiscal_locked_through || null } });
});

app.put('/api/fiscal/period-lock', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  await ensurePeriodLockColumn(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  let through = String(body.fiscal_locked_through || body.locked_through || '').trim();
  if (through && !/^\d{4}-\d{2}$/.test(through)) {
    return c.json({ success: false, error: 'Format attendu : YYYY-MM (ex. 2026-07)', code: 'INVALID_PERIOD' }, 400);
  }
  if (body.clear) through = '';
  await c.env.DB.prepare(`UPDATE company_settings SET fiscal_locked_through = ? WHERE id = 1`).bind(through).run();
  await afterBusinessMutation(c.env.CACHE);
  return c.json({
    success: true,
    data: { fiscal_locked_through: through || null },
    message: through ? `Période clôturée jusqu’à ${through}` : 'Clôture fiscale annulée',
  });
});

/** Phase 1 — client aging */

/** Short-lived signed ticket for printable report deep-links (not a session JWT). */
async function mintReportLinkTicket(env: any, pathPrefix = '/api/'): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 30 * 60; // 30 min
  // pathPrefix scopes the ticket; default /api/ covers reports + employee/invoice print
  const payload = `rtl1|${exp}|${pathPrefix}`;
  const secret = String(env.JWT_SECRET || env.ADMIN_PASSWORD || 'atlas-report-link').trim();
  const key = await crypto.subtle.importKey(
    'raw',
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`report-link|${secret}`)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
  const b64 = btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${exp}.${b64}`;
}

async function verifyReportLinkTicket(env: any, ticket: string | null | undefined, path: string): Promise<boolean> {
  try {
    if (!ticket || !path.startsWith('/api/')) return false;
    // Only print/report style paths (never mutate endpoints)
    const printOk =
      path.startsWith('/api/reports/') ||
      path === '/api/employees/form/print' ||
      /^\/api\/employees\/\d+\/form\/print$/.test(path) ||
      /^\/api\/invoices\/\d+\/(print|pdf)$/.test(path) ||
      /^\/api\/bills\/\d+\/(print|pdf)$/.test(path) ||
      /^\/api\/receipts\/\d+\/(print|pdf)$/.test(path) ||
      path === '/api/settings/invoice-preview' ||
      path.startsWith('/api/attendance/export');
    if (!printOk) return false;
    const [expS, sigB64] = String(ticket).split('.');
    const exp = Number(expS);
    if (!exp || !sigB64 || exp < Math.floor(Date.now() / 1000)) return false;
    const secret = String(env.JWT_SECRET || env.ADMIN_PASSWORD || 'atlas-report-link').trim();
    const key = await crypto.subtle.importKey(
      'raw',
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`report-link|${secret}`)),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const pad = sigB64.length % 4 === 0 ? '' : '='.repeat(4 - (sigB64.length % 4));
    const raw = atob(sigB64.replace(/-/g, '+').replace(/_/g, '/') + pad);
    const sig = new Uint8Array([...raw].map((c) => c.charCodeAt(0)));
    // Current scope + legacy report-only tickets
    for (const payload of [`rtl1|${exp}|/api/`, `rtl1|${exp}|/api/reports/`]) {
      if (await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(payload))) return true;
    }
    return false;
  } catch {
    return false;
  }
}


app.get('/api/reports/link-ticket', async (c) => {
  // Authenticated session required (Authorization header) — returns short-lived rt for refreshable report URLs
  try {
    const rt = await mintReportLinkTicket(c.env);
    return c.json({ success: true, data: { rt, expires_in: 1800 } });
  } catch (e: any) {
    return c.json({ success: false, error: e?.message || 'ticket' }, 500);
  }
});

app.get('/api/reports/aging', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, number, client_name, issue_date, due_date, total, amount_paid, status,
            ROUND(total - COALESCE(amount_paid, 0), 2) as remaining
     FROM invoices
     WHERE status NOT IN ('quote', 'devis', 'cancelled', 'remboursement', 'paid')
       AND COALESCE(doc_kind, '') != 'remboursement'
       AND (total - COALESCE(amount_paid, 0)) > 0.001
     ORDER BY COALESCE(due_date, issue_date) ASC`
  ).all();
  const today = new Date().toISOString().slice(0, 10);
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  const rows = (results || []).map((r: any) => {
    const rem = Number(r.remaining || 0);
    const due = String(r.due_date || r.issue_date || today);
    const days = Math.floor((Date.parse(today) - Date.parse(due)) / 86400000);
    let bucket = 'current';
    if (days > 90) { bucket = 'd90_plus'; buckets.d90_plus += rem; }
    else if (days > 60) { bucket = 'd61_90'; buckets.d61_90 += rem; }
    else if (days > 30) { bucket = 'd31_60'; buckets.d31_60 += rem; }
    else if (days > 0) { bucket = 'd1_30'; buckets.d1_30 += rem; }
    else { buckets.current += rem; }
    return { ...r, days_overdue: Math.max(0, days), bucket, remaining: rem };
  });
  return c.json({ success: true, data: { rows, buckets, as_of: today } });
});

app.get('/api/reports/aging.csv', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, number, client_name, issue_date, due_date, total, amount_paid, status,
            ROUND(total - COALESCE(amount_paid, 0), 2) as remaining
     FROM invoices
     WHERE status NOT IN ('quote', 'devis', 'cancelled', 'remboursement', 'paid')
       AND COALESCE(doc_kind, '') != 'remboursement'
       AND (total - COALESCE(amount_paid, 0)) > 0.001
     ORDER BY COALESCE(due_date, issue_date) ASC`
  ).all();
  const today = new Date().toISOString().slice(0, 10);
  const esc = (v: any) => {
    const s = String(v ?? '');
    if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = ['Numero;Client;Emission;Echeance;Jours_retard;Reste;Bucket;Total;Paye'];
  for (const r of (results || []) as any[]) {
    const rem = Number(r.remaining || 0);
    const due = String(r.due_date || r.issue_date || today);
    const days = Math.max(0, Math.floor((Date.parse(today) - Date.parse(due)) / 86400000));
    let bucket = 'courant';
    if (days > 90) bucket = '90+';
    else if (days > 60) bucket = '61-90';
    else if (days > 30) bucket = '31-60';
    else if (days > 0) bucket = '1-30';
    lines.push([r.number, r.client_name, r.issue_date, r.due_date, days, rem, bucket, r.total, r.amount_paid].map(esc).join(';'));
  }
  const bom = '\uFEFF';
  return new Response(bom + lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="balance-agee-${today}.csv"`,
    },
  });
});

/** Phase 1 — TVA summary by rate */
app.get('/api/reports/tva', async (c) => {
  try {
  const from = c.req.query('from') || '';
  const to = c.req.query('to') || '';
  const settings = await c.env.DB.prepare(`SELECT tax_rate FROM company_settings WHERE id = 1`).first() as any;
  const defaultTax = Number(settings?.tax_rate ?? 20);

  // Ensure line tax_rate exists (older DBs may lack it). invoices has tax_amount/subtotal, not tax_rate.
  await addColumnIfMissing(c.env.DB, 'invoice_items', 'tax_rate', `REAL DEFAULT 0`);

  // Rate = line tax_rate when set, else company default. Never reference i.tax_rate (column does not exist).
  let sql = `
    SELECT COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) as tax_rate,
           SUM(
             CASE
               WHEN ii.line_total IS NOT NULL AND COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) > 0
                 THEN ii.line_total / (1.0 + COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) / 100.0)
               WHEN ii.line_total IS NOT NULL
                 THEN ii.line_total
               ELSE COALESCE(ii.quantity, 0) * COALESCE(ii.unit_price, 0)
             END
           ) as base_ht,
           SUM(
             CASE
               WHEN ii.line_total IS NOT NULL AND COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) > 0
                 THEN ii.line_total - (ii.line_total / (1.0 + COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) / 100.0))
               ELSE COALESCE(ii.quantity, 0) * COALESCE(ii.unit_price, 0) * COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) / 100.0
             END
           ) as tva
    FROM invoice_items ii
    INNER JOIN invoices i ON i.id = ii.invoice_id
    WHERE i.status NOT IN ('quote', 'devis', 'cancelled', 'remboursement')
      AND COALESCE(i.doc_kind, '') != 'remboursement'`;
  const binds: any[] = [];
  if (from) { sql += ` AND i.issue_date >= ?`; binds.push(from); }
  if (to) { sql += ` AND i.issue_date <= ?`; binds.push(to); }
  sql += ` GROUP BY 1 ORDER BY 1`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();

  let sqlWr = `
    SELECT COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) as tax_rate,
           SUM(COALESCE(ii.quantity, 0) * COALESCE(ii.unit_price, 0)) as base_ht,
           SUM(COALESCE(ii.quantity, 0) * COALESCE(ii.unit_price, 0) * COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) / 100.0) as tva
    FROM invoice_items ii
    INNER JOIN invoices i ON i.id = ii.invoice_id
    WHERE (i.status = 'remboursement' OR COALESCE(i.doc_kind, '') = 'remboursement')`;
  const bindsWr: any[] = [];
  if (from) { sqlWr += ` AND i.issue_date >= ?`; bindsWr.push(from); }
  if (to) { sqlWr += ` AND i.issue_date <= ?`; bindsWr.push(to); }
  sqlWr += ` GROUP BY 1`;
  const wr = await c.env.DB.prepare(sqlWr).bind(...bindsWr).all();

  const sales = (results || []).map((r: any) => ({
    tax_rate: Number(r.tax_rate),
    base_ht: Number(r.base_ht || 0),
    tva: Number(r.tva || 0),
  }));
  const credits = (wr.results || []).map((r: any) => ({
    tax_rate: Number(r.tax_rate),
    base_ht: Number(r.base_ht || 0),
    tva: Number(r.tva || 0),
  }));
  const totalSalesTva = sales.reduce((s: number, r: any) => s + r.tva, 0);
  const totalCreditsTva = credits.reduce((s: number, r: any) => s + r.tva, 0);

  return c.json({
    success: true,
    data: {
      sales,
      credits,
      net_tva: totalSalesTva - totalCreditsTva,
      total_sales_tva: totalSalesTva,
      total_credits_tva: totalCreditsTva,
      default_tax_rate: defaultTax,
      from: from || null,
      to: to || null,
    },
  });
  } catch (e: any) {
    console.error('tva report', e);
    return c.json({ success: false, error: e?.message || 'Erreur rapport TVA' }, 500);
  }
});

/** Phase 4 — printable Aging HTML (open / print / save as PDF) */

app.get('/api/reports/tva.csv', async (c) => {
  const from = c.req.query('from') || '';
  const to = c.req.query('to') || '';
  // Reuse JSON logic via internal fetch-like: call same computations
  const settings = await c.env.DB.prepare(`SELECT tax_rate FROM company_settings WHERE id = 1`).first() as any;
  const defaultTax = Number(settings?.tax_rate ?? 20);
  await addColumnIfMissing(c.env.DB, 'invoice_items', 'tax_rate', `REAL DEFAULT 0`);
  let sql = `
    SELECT COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) as tax_rate,
           SUM(CASE WHEN ii.line_total IS NOT NULL AND COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) > 0
                 THEN ii.line_total / (1.0 + COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) / 100.0)
               WHEN ii.line_total IS NOT NULL THEN ii.line_total
               ELSE COALESCE(ii.quantity, 0) * COALESCE(ii.unit_price, 0) END) as base_ht,
           SUM(CASE WHEN ii.line_total IS NOT NULL AND COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) > 0
                 THEN ii.line_total - (ii.line_total / (1.0 + COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) / 100.0))
               ELSE COALESCE(ii.quantity, 0) * COALESCE(ii.unit_price, 0) * COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) / 100.0 END) as tva
    FROM invoice_items ii INNER JOIN invoices i ON i.id = ii.invoice_id
    WHERE i.status NOT IN ('quote', 'devis', 'cancelled', 'remboursement')
      AND COALESCE(i.doc_kind, '') != 'remboursement'`;
  const binds: any[] = [];
  if (from) { sql += ` AND i.issue_date >= ?`; binds.push(from); }
  if (to) { sql += ` AND i.issue_date <= ?`; binds.push(to); }
  sql += ` GROUP BY 1 ORDER BY 1`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  let sqlWr = `
    SELECT COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) as tax_rate,
           SUM(COALESCE(ii.quantity, 0) * COALESCE(ii.unit_price, 0)) as base_ht,
           SUM(COALESCE(ii.quantity, 0) * COALESCE(ii.unit_price, 0) * COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) / 100.0) as tva
    FROM invoice_items ii INNER JOIN invoices i ON i.id = ii.invoice_id
    WHERE (i.status = 'remboursement' OR COALESCE(i.doc_kind, '') = 'remboursement')`;
  const bindsWr: any[] = [];
  if (from) { sqlWr += ` AND i.issue_date >= ?`; bindsWr.push(from); }
  if (to) { sqlWr += ` AND i.issue_date <= ?`; bindsWr.push(to); }
  sqlWr += ` GROUP BY 1`;
  const wr = await c.env.DB.prepare(sqlWr).bind(...bindsWr).all();
  const esc = (v: any) => {
    const s = String(v ?? '');
    if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = ['Type;Taux_TVA;Base_HT;TVA'];
  for (const r of (results || []) as any[]) {
    lines.push(['Vente', r.tax_rate, Number(r.base_ht||0).toFixed(2), Number(r.tva||0).toFixed(2)].map(esc).join(';'));
  }
  for (const r of (wr.results || []) as any[]) {
    lines.push(['Avoir_WR', r.tax_rate, Number(r.base_ht||0).toFixed(2), Number(r.tva||0).toFixed(2)].map(esc).join(';'));
  }
  const period = [from || 'debut', to || 'fin'].join('_');
  const bom = '\uFEFF';
  return new Response(bom + lines.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="tva-${period}.csv"`,
    },
  });
});

app.get('/api/reports/aging.html', async (c) => {
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const cur = settings?.currency || 'MAD';
  const fmtN = (n: number) => Math.round(Number(n || 0)).toLocaleString('fr-FR');
  const { results } = await c.env.DB.prepare(
    `SELECT id, number, client_name, issue_date, due_date, total, amount_paid, status,
            ROUND(total - COALESCE(amount_paid, 0), 2) as remaining
     FROM invoices
     WHERE status NOT IN ('quote', 'devis', 'cancelled', 'remboursement', 'paid')
       AND COALESCE(doc_kind, '') != 'remboursement'
       AND (total - COALESCE(amount_paid, 0)) > 0.001
     ORDER BY COALESCE(due_date, issue_date) ASC`
  ).all();
  const today = new Date().toISOString().slice(0, 10);
  const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  const rows = (results || []).map((r: any) => {
    const rem = Number(r.remaining || 0);
    const due = String(r.due_date || r.issue_date || today);
    const days = Math.floor((Date.parse(today) - Date.parse(due)) / 86400000);
    if (days > 90) buckets.d90_plus += rem;
    else if (days > 60) buckets.d61_90 += rem;
    else if (days > 30) buckets.d31_60 += rem;
    else if (days > 0) buckets.d1_30 += rem;
    else buckets.current += rem;
    return { ...r, days_overdue: Math.max(0, days), remaining: rem };
  });
  const total = rows.reduce((s: number, r: any) => s + r.remaining, 0);
  const table = rows.map((r: any) => `<tr>
    <td>${r.number || ''}</td>
    <td>${r.client_name || ''}</td>
    <td>${r.due_date || r.issue_date || '—'}</td>
    <td>${r.days_overdue}</td>
    <td class="out">${fmtN(r.remaining)} ${cur}</td>
  </tr>`).join('') || `<tr><td colspan="5">Aucune créance ouverte</td></tr>`;
  const body = `
  <div class="actions"><button onclick="window.print()">Imprimer / PDF</button></div>
  <div class="grid">
    <div class="stat"><div class="l">Total créances</div><div class="v out">${fmtN(total)} ${cur}</div></div>
    <div class="stat"><div class="l">Courant</div><div class="v">${fmtN(buckets.current)}</div></div>
    <div class="stat"><div class="l">1–30 j</div><div class="v">${fmtN(buckets.d1_30)}</div></div>
    <div class="stat"><div class="l">31–60 j</div><div class="v">${fmtN(buckets.d31_60)}</div></div>
    <div class="stat"><div class="l">61–90 j</div><div class="v">${fmtN(buckets.d61_90)}</div></div>
    <div class="stat"><div class="l">90+ j</div><div class="v out">${fmtN(buckets.d90_plus)}</div></div>
  </div>
  <h2>Détail des créances — au ${today}</h2>
  <table>
    <thead><tr><th>N°</th><th>Client</th><th>Échéance</th><th>Jours</th><th>Reste dû</th></tr></thead>
    <tbody>${table}</tbody>
  </table>`;
  return c.html(reportShell('Balance âgée clients', settings?.company_name || 'Atlas Commerce', `Au ${today}`, body, settings?.report_footer || settings?.notes));
});

/** Phase 4 — printable TVA HTML */
app.get('/api/reports/tva.html', async (c) => {
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const cur = settings?.currency || 'MAD';
  const fmtN = (n: number) => Math.round(Number(n || 0)).toLocaleString('fr-FR');
  const from = c.req.query('from') || '';
  const to = c.req.query('to') || '';
  const defaultTax = Number(settings?.tax_rate ?? 20);
  await addColumnIfMissing(c.env.DB, 'invoice_items', 'tax_rate', `REAL DEFAULT 0`);

  let sql = `
    SELECT COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) as tax_rate,
           SUM(
             CASE
               WHEN ii.line_total IS NOT NULL AND COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) > 0
                 THEN ii.line_total / (1.0 + COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) / 100.0)
               WHEN ii.line_total IS NOT NULL THEN ii.line_total
               ELSE COALESCE(ii.quantity, 0) * COALESCE(ii.unit_price, 0)
             END
           ) as base_ht,
           SUM(
             CASE
               WHEN ii.line_total IS NOT NULL AND COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) > 0
                 THEN ii.line_total - (ii.line_total / (1.0 + COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) / 100.0))
               ELSE COALESCE(ii.quantity, 0) * COALESCE(ii.unit_price, 0) * COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) / 100.0
             END
           ) as tva
    FROM invoice_items ii
    INNER JOIN invoices i ON i.id = ii.invoice_id
    WHERE i.status NOT IN ('quote','devis','cancelled','remboursement')
      AND COALESCE(i.doc_kind, '') != 'remboursement'`;
  const binds: any[] = [];
  if (from) { sql += ` AND i.issue_date >= ?`; binds.push(from); }
  if (to) { sql += ` AND i.issue_date <= ?`; binds.push(to); }
  sql += ` GROUP BY 1 ORDER BY 1`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();

  let sqlWr = `
    SELECT COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) as tax_rate,
           SUM(COALESCE(ii.quantity, 0) * COALESCE(ii.unit_price, 0)) as base_ht,
           SUM(COALESCE(ii.quantity, 0) * COALESCE(ii.unit_price, 0) * COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) / 100.0) as tva
    FROM invoice_items ii
    INNER JOIN invoices i ON i.id = ii.invoice_id
    WHERE (i.status = 'remboursement' OR COALESCE(i.doc_kind, '') = 'remboursement')`;
  const bindsWr: any[] = [];
  if (from) { sqlWr += ` AND i.issue_date >= ?`; bindsWr.push(from); }
  if (to) { sqlWr += ` AND i.issue_date <= ?`; bindsWr.push(to); }
  sqlWr += ` GROUP BY 1`;
  const wr = await c.env.DB.prepare(sqlWr).bind(...bindsWr).all();

  const sales = (results || []).map((r: any) => ({
    tax_rate: Number(r.tax_rate),
    base_ht: Number(r.base_ht || 0),
    tva: Number(r.tva || 0),
  }));
  const credits = (wr.results || []).map((r: any) => ({
    tax_rate: Number(r.tax_rate),
    base_ht: Number(r.base_ht || 0),
    tva: Number(r.tva || 0),
  }));
  const totalSalesTva = sales.reduce((s, r) => s + r.tva, 0);
  const totalCreditsTva = credits.reduce((s, r) => s + r.tva, 0);
  const periodLabel = [from || '…', to || '…'].join(' → ');

  const salesRows = sales.map((r) => `<tr><td>${r.tax_rate} %</td><td class="num">${fmtN(r.base_ht)}</td><td class="num">${fmtN(r.tva)}</td></tr>`).join('')
    || `<tr><td colspan="3">Aucune vente</td></tr>`;
  const creditRows = credits.map((r) => `<tr><td>${r.tax_rate} %</td><td class="num">${fmtN(r.base_ht)}</td><td class="num">${fmtN(r.tva)}</td></tr>`).join('')
    || `<tr><td colspan="3">Aucun avoir</td></tr>`;

  const body = `
  <div class="actions"><button onclick="window.print()">Imprimer / PDF</button></div>
  <div class="grid">
    <div class="stat"><div class="l">TVA collectée</div><div class="v in">${fmtN(totalSalesTva)} ${cur}</div></div>
    <div class="stat"><div class="l">TVA avoirs WR</div><div class="v out">${fmtN(totalCreditsTva)} ${cur}</div></div>
    <div class="stat"><div class="l">Net à déclarer</div><div class="v">${fmtN(totalSalesTva - totalCreditsTva)} ${cur}</div></div>
    <div class="stat"><div class="l">Période</div><div class="v" style="font-size:13px">${periodLabel}</div></div>
  </div>
  <h2>Ventes par taux</h2>
  <table><thead><tr><th>Taux</th><th>Base HT</th><th>TVA</th></tr></thead><tbody>${salesRows}</tbody></table>
  <h2>Avoirs / WR (à déduire)</h2>
  <table><thead><tr><th>Taux</th><th>Base HT</th><th>TVA</th></tr></thead><tbody>${creditRows}</tbody></table>`;
  return c.html(reportShell('Récapitulatif TVA', settings?.company_name || 'Atlas Commerce', periodLabel, body, settings?.report_footer || settings?.notes));
});

/** Phase 1 — reorder list */
app.get('/api/inventory/reorder', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, sku, name, stock_quantity, low_stock_threshold, cost, price, category
     FROM products
     WHERE is_active = 1 AND track_inventory = 1
       AND stock_quantity <= low_stock_threshold
     ORDER BY (stock_quantity - low_stock_threshold) ASC, name ASC
     LIMIT 200`
  ).all();
  return c.json({
    success: true,
    data: (results || []).map((p: any) => ({
      ...p,
      qty_to_order: Math.max(0, Number(p.low_stock_threshold || 0) * 2 - Number(p.stock_quantity || 0)),
    })),
  });
});

/** Phase 3 — create draft purchase bill from low-stock list */
app.post('/api/inventory/reorder/draft-bill', async (c) => {
  const gate = requireBizMutator(c);
  if (!gate.ok) return gate.response;
  const body = await c.req.json().catch(() => ({}));
  const filterIds = Array.isArray(body.product_ids)
    ? body.product_ids.map((x: any) => Number(x)).filter((n: number) => n > 0)
    : [];
  let sql = `
    SELECT id, sku, name, stock_quantity, low_stock_threshold, cost, price, category
    FROM products
    WHERE is_active = 1 AND track_inventory = 1
      AND stock_quantity <= low_stock_threshold`;
  const binds: any[] = [];
  if (filterIds.length) {
    sql += ` AND id IN (${filterIds.map(() => '?').join(',')})`;
    binds.push(...filterIds);
  }
  sql += ` ORDER BY name ASC LIMIT 100`;
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  const products = (results || []) as any[];
  if (!products.length) {
    return c.json({ success: false, error: 'Aucun produit à commander (seuil OK).' }, 400);
  }
  const vendor_name = String(body.vendor_name || 'Fournisseur (réappro)').slice(0, 120);
  const issue_date = new Date().toISOString().slice(0, 10);
  // next bill number
  await ensureStockLocations(c.env.DB);
  const settings = await c.env.DB.prepare(
    `SELECT bill_prefix, next_bill_number, numbering_pad FROM company_settings WHERE id = 1`
  ).first() as any;
  const prefix = String(settings?.bill_prefix || 'FA-');
  let next = Number(settings?.next_bill_number || 1);
  const pad = Math.min(8, Math.max(3, Number(settings?.numbering_pad || 4)));
  const year = new Date().getFullYear();
  let number = `${prefix}${year}-${String(next).padStart(pad, '0')}`;
  // uniqueness
  for (let i = 0; i < 20; i++) {
    const exists = await c.env.DB.prepare(`SELECT id FROM bills WHERE number = ?`).bind(number).first();
    if (!exists) break;
    next += 1;
    number = `${prefix}${year}-${String(next).padStart(pad, '0')}`;
  }
  let subtotal = 0;
  const lineItems: any[] = [];
  for (const p of products) {
    const qty = Math.max(1, Math.ceil(Number(p.low_stock_threshold || 0) * 2 - Number(p.stock_quantity || 0)));
    const unit_cost = Number(p.cost || 0);
    const line_total = Math.round(qty * unit_cost * 100) / 100;
    subtotal += line_total;
    lineItems.push({
      product_id: p.id,
      product_name: p.name,
      sku: p.sku || '',
      quantity: qty,
      unit_cost,
      tax_rate: 0,
      line_total,
    });
  }
  subtotal = Math.round(subtotal * 100) / 100;
  const billResult = await c.env.DB.prepare(
    `INSERT INTO bills (number, vendor_id, vendor_name, vendor_ice, vendor_address, issue_date, due_date, status, subtotal, tax_amount, total, notes)
     VALUES (?, NULL, ?, '', '', ?, ?, 'draft', ?, 0, ?, ?)`
  ).bind(
    number,
    vendor_name,
    issue_date,
    issue_date,
    subtotal,
    subtotal,
    'Brouillon auto — réapprovisionnement stock bas',
  ).run();
  const billId = billResult.meta.last_row_id;
  for (const item of lineItems) {
    await c.env.DB.prepare(
      `INSERT INTO bill_items (bill_id, product_id, product_name, sku, quantity, unit_cost, tax_rate, line_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(billId, item.product_id, item.product_name, item.sku, item.quantity, item.unit_cost, 0, item.line_total).run();
  }
  await c.env.DB.prepare(`UPDATE company_settings SET next_bill_number = ? WHERE id = 1`).bind(next + 1).run();
  await afterBusinessMutation(c.env.CACHE);
  return c.json({
    success: true,
    data: { id: billId, number, lines: lineItems.length, total: subtotal },
    message: `Brouillon d'achat ${number} créé (${lineItems.length} lignes). Validez puis réceptionnez le stock.`,
  }, 201);
});


/* Phase1 extras loaded from phase1-extra.ts via inline routes below */

async function ensureWarehouseSettings(db: D1Database) {
  await schemaOnce('ensureWarehouseSettings', async () => {
  for (const sql of [
    `ALTER TABLE company_settings ADD COLUMN multi_warehouse INTEGER DEFAULT 1`,
    `ALTER TABLE company_settings ADD COLUMN sales_location_id INTEGER`,
    `ALTER TABLE company_settings ADD COLUMN purchase_location_id INTEGER`,
  ]) {
    try { await db.prepare(sql).run(); } catch { /* */ }
  }

  });
}


async function ensureMarbleUnits(db: D1Database) {
  await schemaOnce('ensureMarbleUnits', async () => {
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS units (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, symbol TEXT, created_at TEXT DEFAULT (datetime('now')))`).run();
  } catch { /* */ }
  for (const u of ['m²', 'ML', 'm2', 'unité', 'pièce', 'forfait']) {
    try {
      await db.prepare(`INSERT OR IGNORE INTO units (name) VALUES (?)`).bind(u).run();
    } catch {
      try { await db.prepare(`INSERT INTO units (name) VALUES (?)`).bind(u).run(); } catch { /* dup */ }
    }
  }

  });
}

async function ensureStockLocations(db: D1Database) {
  await schemaOnce('stock_locations', async () => {
    await db.prepare(`CREATE TABLE IF NOT EXISTS stock_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      is_default INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')))`).run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS stock_location_qty (
      location_id INTEGER NOT NULL, product_id INTEGER NOT NULL, quantity REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (location_id, product_id))`).run();
    await addColumnIfMissing(db, 'stock_locations', 'is_active', 'INTEGER DEFAULT 1');
    await addColumnIfMissing(db, 'stock_locations', 'is_default', 'INTEGER DEFAULT 0');
    const n = await db.prepare(`SELECT COUNT(*) as c FROM stock_locations`).first() as any;
    if (!Number(n?.c)) {
      await db.prepare(`INSERT INTO stock_locations (code, name, is_default, is_active) VALUES ('MAG', 'Magasin principal', 1, 1)`).run();
      await db.prepare(`INSERT INTO stock_locations (code, name, is_default, is_active) VALUES ('RES', 'Réserve', 0, 1)`).run();
    }
    await ensureWarehouseSettings(db);
  });
}


/** Put full product qty on default warehouse (replaces prior placements). */
async function placeProductStockOnDefault(db: D1Database, productId: number, qty: number) {
  await ensureStockLocations(db);
  let defId: number | null = null;
  try {
    const def = await db.prepare(`SELECT id FROM stock_locations WHERE is_default = 1 ORDER BY id LIMIT 1`).first() as any;
    defId = def?.id ? Number(def.id) : null;
    if (!defId) {
      const any = await db.prepare(`SELECT id FROM stock_locations ORDER BY id LIMIT 1`).first() as any;
      defId = any?.id ? Number(any.id) : null;
    }
  } catch { /* */ }
  if (!defId) return;
  await db.prepare(`DELETE FROM stock_location_qty WHERE product_id = ?`).bind(productId).run();
  if (qty > 0.0001) {
    await db.prepare(
      `INSERT INTO stock_location_qty (location_id, product_id, quantity) VALUES (?, ?, ?)`
    ).bind(defId, productId, qty).run();
  }
}

/** Align stock_location_qty with products.stock_quantity (source of truth for unallocated stock). */
async function reconcileStockLocations(db: D1Database) {
  // Drop rows pointing at deleted products
  try {
    await db.prepare(
      `DELETE FROM stock_location_qty WHERE product_id NOT IN (SELECT id FROM products)`
    ).run();
  } catch { /* */ }

  let defId: number | null = null;
  try {
    const settings = await db.prepare(`SELECT sales_location_id FROM company_settings WHERE id = 1`).first() as any;
    if (settings?.sales_location_id) {
      const ok = await db.prepare(`SELECT id FROM stock_locations WHERE id = ? AND COALESCE(is_active,1)=1`).bind(settings.sales_location_id).first();
      if (ok) defId = Number(settings.sales_location_id);
    }
    if (!defId) {
      const def = await db.prepare(`SELECT id FROM stock_locations WHERE is_default = 1 ORDER BY id LIMIT 1`).first() as any;
      if (def?.id) defId = Number(def.id);
    }
    if (!defId) {
      const any = await db.prepare(`SELECT id FROM stock_locations ORDER BY id LIMIT 1`).first() as any;
      if (any?.id) defId = Number(any.id);
    }
  } catch { /* */ }
  if (!defId) return;

  // All active tracked products
  let products: any[] = [];
  try {
    const r = await db.prepare(
      `SELECT id, COALESCE(stock_quantity, 0) as stock_quantity,
              COALESCE(track_inventory, 1) as track_inventory,
              COALESCE(is_active, 1) as is_active
       FROM products`
    ).all();
    products = (r.results || []) as any[];
  } catch {
    try {
      const r = await db.prepare(`SELECT id, COALESCE(stock_quantity, 0) as stock_quantity FROM products`).all();
      products = ((r.results || []) as any[]).map((p) => ({ ...p, track_inventory: 1, is_active: 1 }));
    } catch { return; }
  }

  for (const p of products) {
    const pid = Number(p.id);
    if (!pid) continue;
    const track = Number(p.track_inventory ?? 1) !== 0;
    const active = Number(p.is_active ?? 1) !== 0;
    const productQty = Number(p.stock_quantity || 0);

    let sumLoc = 0;
    try {
      const s = await db.prepare(
        `SELECT COALESCE(SUM(quantity), 0) as s FROM stock_location_qty WHERE product_id = ?`
      ).bind(pid).first() as any;
      sumLoc = Number(s?.s || 0);
    } catch { sumLoc = 0; }

    // Inactive or not tracked: zero out placements
    if (!active || !track) {
      if (sumLoc !== 0) {
        try {
          await db.prepare(`DELETE FROM stock_location_qty WHERE product_id = ?`).bind(pid).run();
        } catch { /* */ }
      }
      continue;
    }

    // No warehouse rows but product has stock → put everything in default depot
    if (sumLoc <= 0.0001 && productQty > 0.0001) {
      try {
        const existing = await db.prepare(
          `SELECT quantity FROM stock_location_qty WHERE location_id = ? AND product_id = ?`
        ).bind(defId, pid).first() as any;
        if (existing) {
          await db.prepare(
            `UPDATE stock_location_qty SET quantity = ? WHERE location_id = ? AND product_id = ?`
          ).bind(productQty, defId, pid).run();
        } else {
          await db.prepare(
            `INSERT INTO stock_location_qty (location_id, product_id, quantity) VALUES (?, ?, ?)`
          ).bind(defId, pid, productQty).run();
        }
      } catch (e) {
        console.error('reconcile insert default', pid, e);
      }
      continue;
    }

    // Product stock is 0 but locations still hold qty → clear placements (stale data)
    if (productQty <= 0.0001 && sumLoc > 0.0001) {
      try {
        await db.prepare(`DELETE FROM stock_location_qty WHERE product_id = ?`).bind(pid).run();
      } catch { /* */ }
      continue;
    }

    // Both non-zero but mismatch: trust product total, scale default location
    // Only auto-fix when a single location holds all stock (typical MAG-only setup)
    if (productQty > 0.0001 && Math.abs(sumLoc - productQty) > 0.01) {
      try {
        const rows = await db.prepare(
          `SELECT location_id, quantity FROM stock_location_qty WHERE product_id = ? AND quantity != 0`
        ).bind(pid).all();
        const list = (rows.results || []) as any[];
        if (list.length <= 1) {
          // Single (or zero) placement → set default to product qty
          await db.prepare(`DELETE FROM stock_location_qty WHERE product_id = ?`).bind(pid).run();
          await db.prepare(
            `INSERT INTO stock_location_qty (location_id, product_id, quantity) VALUES (?, ?, ?)`
          ).bind(defId, pid, productQty).run();
        }
        // Multi-location intentional split: leave as-is (ops manage transfers)
      } catch { /* */ }
    }
  }
}

async function getDefaultLocationId(db: D1Database): Promise<number | null> {
  await ensureStockLocations(db);
  const settings = await db.prepare(`SELECT sales_location_id FROM company_settings WHERE id = 1`).first() as any;
  if (settings?.sales_location_id) {
    const ok = await db.prepare(`SELECT id FROM stock_locations WHERE id = ? AND COALESCE(is_active,1)=1`).bind(settings.sales_location_id).first();
    if (ok) return Number(settings.sales_location_id);
  }
  const def = await db.prepare(`SELECT id FROM stock_locations WHERE is_default = 1 ORDER BY id LIMIT 1`).first() as any;
  if (def?.id) return Number(def.id);
  const any = await db.prepare(`SELECT id FROM stock_locations ORDER BY id LIMIT 1`).first() as any;
  return any?.id ? Number(any.id) : null;
}

/** Sync products.stock_quantity = SUM(location qty) when multi-warehouse is on. */
async function syncProductTotalFromLocations(db: D1Database, productId: number | string) {
  const sum = await db.prepare(
    `SELECT COALESCE(SUM(quantity), 0) as s FROM stock_location_qty WHERE product_id = ?`
  ).bind(productId).first() as any;
  const total = Number(sum?.s || 0);
  await db.prepare(`UPDATE products SET stock_quantity = ?, updated_at = datetime('now') WHERE id = ?`).bind(total, productId).run();
  return total;
}

/**
 * Adjust qty at a location and keep product total in sync.
 * If product has global stock but no location rows, seeds default location first.
 */
async function adjustLocationStock(
  db: D1Database,
  productId: number | string,
  locationId: number,
  delta: number,
  opts?: { allowNegative?: boolean },
): Promise<{ location_qty: number; product_total: number }> {
  await ensureStockLocations(db);
  // Seed: if no placement rows and product has stock, put all on default
  const existing = await db.prepare(
    `SELECT COUNT(*) as c FROM stock_location_qty WHERE product_id = ?`
  ).bind(productId).first() as any;
  if (!Number(existing?.c)) {
    const prod = await db.prepare(`SELECT stock_quantity, track_inventory FROM products WHERE id = ?`).bind(productId).first() as any;
    if (prod?.track_inventory && Number(prod.stock_quantity || 0) > 0) {
      const def = (await getDefaultLocationId(db)) || locationId;
      await db.prepare(
        `INSERT INTO stock_location_qty (location_id, product_id, quantity) VALUES (?, ?, ?)`
      ).bind(def, productId, Number(prod.stock_quantity || 0)).run();
    }
  }
  const row = await db.prepare(
    `SELECT quantity FROM stock_location_qty WHERE location_id = ? AND product_id = ?`
  ).bind(locationId, productId).first() as any;
  const prev = Number(row?.quantity || 0);
  let next = prev + delta;
  if (!opts?.allowNegative && next < -1e-9) {
    const err: any = new Error(`Stock insuffisant sur cet emplacement (dispo ${prev}, demandé ${Math.abs(delta)}).`);
    err.code = 'INSUFFICIENT_STOCK';
    err.available = prev;
    throw err;
  }
  if (next < 0 && !opts?.allowNegative) next = 0;
  if (row) {
    await db.prepare(
      `UPDATE stock_location_qty SET quantity = ? WHERE location_id = ? AND product_id = ?`
    ).bind(next, locationId, productId).run();
  } else {
    await db.prepare(
      `INSERT INTO stock_location_qty (location_id, product_id, quantity) VALUES (?, ?, ?)`
    ).bind(locationId, productId, next).run();
  }
  const total = await syncProductTotalFromLocations(db, productId);
  return { location_qty: next, product_total: total };
}

app.get('/api/inventory/locations', async (c) => {
  try {
    await ensureStockLocations(c.env.DB);
    // reconcile only on stock mutations — not on every GET
    let results: any[] = [];
    try {
      const r = await c.env.DB.prepare(
        `SELECT l.id, l.code, l.name, l.is_default, COALESCE(l.is_active, 1) as is_active,
          (SELECT COALESCE(SUM(q.quantity),0) FROM stock_location_qty q WHERE q.location_id = l.id) as total_units,
          (SELECT COUNT(*) FROM stock_location_qty q WHERE q.location_id = l.id AND q.quantity > 0) as sku_count
         FROM stock_locations l
         ORDER BY COALESCE(l.is_default, 0) DESC, l.name`
      ).all();
      results = (r.results || []).filter((x: any) => Number(x.is_active ?? 1) === 1);
    } catch (e1: any) {
      // Fallback without is_active / subqueries
      console.error('locations query fallback', e1?.message);
      const r2 = await c.env.DB.prepare(`SELECT * FROM stock_locations ORDER BY name`).all();
      results = r2.results || [];
    }
    return c.json({ success: true, data: results });
  } catch (e: any) {
    console.error('locations 500', e);
    return c.json({ success: false, error: e?.message || 'Erreur emplacements', code: 'LOCATIONS_FAILED' }, 500);
  }
});

app.post('/api/inventory/locations', async (c) => {
  const gate = requireBizMutator(c);
  if (!gate.ok) return gate.response;
  await ensureStockLocations(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const code = String(body.code || '').trim().toUpperCase().slice(0, 16);
  const name = String(body.name || '').trim().slice(0, 80);
  if (!code || !name) return c.json({ success: false, error: 'Code et nom obligatoires' }, 400);
  try {
    await c.env.DB.prepare(`INSERT INTO stock_locations (code, name, is_default) VALUES (?, ?, 0)`).bind(code, name).run();
  } catch {
    return c.json({ success: false, error: 'Code déjà utilisé' }, 409);
  }
  const row = await c.env.DB.prepare(`SELECT * FROM stock_locations WHERE code = ?`).bind(code).first();
  return c.json({ success: true, data: row }, 201);
});

app.patch('/api/inventory/locations/:id', async (c) => {
  const gate = requireBizMutator(c);
  if (!gate.ok) return gate.response;
  await ensureStockLocations(c.env.DB);
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  if (body.is_default) {
    await c.env.DB.prepare(`UPDATE stock_locations SET is_default = 0`).run();
    await c.env.DB.prepare(`UPDATE stock_locations SET is_default = 1 WHERE id = ?`).bind(id).run();
  }
  if (body.name !== undefined) {
    await c.env.DB.prepare(`UPDATE stock_locations SET name = ? WHERE id = ?`).bind(String(body.name).slice(0, 80), id).run();
  }
  if (body.is_active !== undefined) {
    await c.env.DB.prepare(`UPDATE stock_locations SET is_active = ? WHERE id = ?`).bind(body.is_active ? 1 : 0, id).run();
  }
  const row = await c.env.DB.prepare(`SELECT * FROM stock_locations WHERE id = ?`).bind(id).first();
  return c.json({ success: true, data: row });
});

app.delete('/api/inventory/locations/:id', async (c) => {
  const gate = requireBizMutator(c);
  if (!gate.ok) return gate.response;
  await ensureStockLocations(c.env.DB);
  const id = Number(c.req.param('id'));
  const loc = await c.env.DB.prepare(`SELECT * FROM stock_locations WHERE id = ?`).bind(id).first() as any;
  if (!loc) return c.json({ success: false, error: 'Emplacement introuvable' }, 404);
  const count = await c.env.DB.prepare(`SELECT COUNT(*) as c FROM stock_locations`).first() as any;
  if (Number(count?.c || 0) <= 1) {
    return c.json({ success: false, error: 'Impossible de supprimer le dernier emplacement.' }, 400);
  }
  const qty = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(quantity),0) as s FROM stock_location_qty WHERE location_id = ?`
  ).bind(id).first() as any;
  if (Number(qty?.s || 0) > 1e-9) {
    return c.json({
      success: false,
      error: `Stock encore présent (${Number(qty.s)} unités). Transférez vers un autre entrepôt avant suppression.`,
      code: 'LOCATION_NOT_EMPTY',
    }, 400);
  }
  // Move default if needed
  if (loc.is_default) {
    const other = await c.env.DB.prepare(
      `SELECT id FROM stock_locations WHERE id != ? ORDER BY id LIMIT 1`
    ).bind(id).first() as any;
    if (other?.id) {
      await c.env.DB.prepare(`UPDATE stock_locations SET is_default = 1 WHERE id = ?`).bind(other.id).run();
    }
  }
  await c.env.DB.prepare(`DELETE FROM stock_location_qty WHERE location_id = ?`).bind(id).run();
  await c.env.DB.prepare(`DELETE FROM stock_locations WHERE id = ?`).bind(id).run();
  // Clear settings pointing to this location
  try {
    await c.env.DB.prepare(
      `UPDATE company_settings SET sales_location_id = NULL WHERE sales_location_id = ?`
    ).bind(id).run();
    await c.env.DB.prepare(
      `UPDATE company_settings SET purchase_location_id = NULL WHERE purchase_location_id = ?`
    ).bind(id).run();
  } catch { /* */ }
  await afterBusinessMutation(c.env.CACHE);
  return c.json({ success: true, message: `Emplacement « ${loc.name} » supprimé.` });
});

/** Product placements (qty per warehouse) */
app.get('/api/inventory/products/:id/placements', async (c) => {
  await ensureStockLocations(c.env.DB);
  const productId = c.req.param('id');
  // Seed from global if needed
  const prod = await c.env.DB.prepare(`SELECT id, name, stock_quantity, track_inventory, category, cost FROM products WHERE id = ?`).bind(productId).first() as any;
  if (!prod) return c.json({ success: false, error: 'Produit introuvable' }, 404);
  const cnt = await c.env.DB.prepare(`SELECT COUNT(*) as c FROM stock_location_qty WHERE product_id = ?`).bind(productId).first() as any;
  if (!Number(cnt?.c) && prod.track_inventory && Number(prod.stock_quantity || 0) > 0) {
    const def = await getDefaultLocationId(c.env.DB);
    if (def) {
      await c.env.DB.prepare(
        `INSERT OR REPLACE INTO stock_location_qty (location_id, product_id, quantity) VALUES (?, ?, ?)`
      ).bind(def, productId, Number(prod.stock_quantity || 0)).run();
    }
  }
  const { results } = await c.env.DB.prepare(
    `SELECT l.id as location_id, l.code, l.name, l.is_default, COALESCE(q.quantity, 0) as quantity
     FROM stock_locations l
     LEFT JOIN stock_location_qty q ON q.location_id = l.id AND q.product_id = ?
     ORDER BY COALESCE(l.is_default, 0) DESC, l.name`
  ).bind(productId).all();
  const placements = (results || []).map((r: any) => ({
    location_id: r.location_id,
    code: r.code,
    name: r.name,
    is_default: !!r.is_default,
    quantity: Number(r.quantity || 0),
  }));
  const total = placements.reduce((s: number, p: any) => s + p.quantity, 0);
  return c.json({
    success: true,
    data: {
      product_id: Number(productId),
      product_name: prod.name,
      category: prod.category || '',
      total,
      placements,
    },
  });
});

/**
 * Stock report by warehouse and/or category.
 * Query: location_id=all|number, group=category|product
 */
app.get('/api/inventory/stock-report', async (c) => {
  try {
  await ensureStockLocations(c.env.DB);
  const locParam = c.req.query('location_id') || 'all';
  const group = c.req.query('group') || 'product'; // product | category

  const { results: locs } = await c.env.DB.prepare(
    `SELECT id, code, name, is_default FROM stock_locations WHERE COALESCE(is_active,1)=1 ORDER BY is_default DESC, name`
  ).all();
  const locations = (locs || []) as any[];

  // Ensure products with only global stock are visible under default location
  const defId = await getDefaultLocationId(c.env.DB);
  if (defId) {
    const orphans = await c.env.DB.prepare(
      `SELECT p.id, p.stock_quantity FROM products p
       WHERE p.track_inventory = 1 AND p.is_active = 1 AND p.stock_quantity > 0
         AND NOT EXISTS (SELECT 1 FROM stock_location_qty q WHERE q.product_id = p.id)`
    ).all();
    for (const o of (orphans.results || []) as any[]) {
      await c.env.DB.prepare(
        `INSERT INTO stock_location_qty (location_id, product_id, quantity) VALUES (?, ?, ?)`
      ).bind(defId, o.id, Number(o.stock_quantity || 0)).run();
    }
  }

  let locationFilterSql = '';
  const binds: any[] = [];
  if (locParam !== 'all' && Number(locParam) > 0) {
    locationFilterSql = ' AND q.location_id = ? ';
    binds.push(Number(locParam));
  }

  const { results: rows } = await c.env.DB.prepare(
    `SELECT q.location_id, l.code as location_code, l.name as location_name,
            p.id as product_id, p.name as product_name, p.sku, p.category, p.cost,
            q.quantity, (q.quantity * COALESCE(p.cost, 0)) as value
     FROM stock_location_qty q
     INNER JOIN stock_locations l ON l.id = q.location_id
     INNER JOIN products p ON p.id = q.product_id
     WHERE p.is_active = 1 AND p.track_inventory = 1
       AND q.quantity != 0
       ${locationFilterSql}
     ORDER BY l.is_default DESC, l.name, p.category, p.name`
  ).bind(...binds).all();

  const lines = (rows || []).map((r: any) => ({
    location_id: r.location_id,
    location_code: r.location_code,
    location_name: r.location_name,
    product_id: r.product_id,
    product_name: r.product_name,
    sku: r.sku,
    category: r.category || 'Sans catégorie',
    quantity: Number(r.quantity || 0),
    unit_cost: Number(r.cost || 0),
    value: Number(r.value || 0),
  }));

  // Category totals (for selected scope)
  const byCategory: Record<string, { qty: number; value: number; products: number }> = {};
  for (const ln of lines) {
    const k = ln.category;
    if (!byCategory[k]) byCategory[k] = { qty: 0, value: 0, products: 0 };
    byCategory[k].qty += ln.quantity;
    byCategory[k].value += ln.value;
    byCategory[k].products += 1;
  }

  // Per warehouse summary
  const byWarehouse: Record<string, { location_id: number; name: string; code: string; qty: number; value: number; skus: number }> = {};
  for (const ln of lines) {
    const k = String(ln.location_id);
    if (!byWarehouse[k]) {
      byWarehouse[k] = {
        location_id: ln.location_id,
        name: ln.location_name,
        code: ln.location_code,
        qty: 0,
        value: 0,
        skus: 0,
      };
    }
    byWarehouse[k].qty += ln.quantity;
    byWarehouse[k].value += ln.value;
    byWarehouse[k].skus += 1;
  }

  // Category × warehouse matrix
  const categoryByWarehouse: { category: string; location_id: number; location_name: string; qty: number; value: number }[] = [];
  const matrixKey: Record<string, { category: string; location_id: number; location_name: string; qty: number; value: number }> = {};
  for (const ln of lines) {
    const k = `${ln.category}::${ln.location_id}`;
    if (!matrixKey[k]) {
      matrixKey[k] = {
        category: ln.category,
        location_id: ln.location_id,
        location_name: ln.location_name,
        qty: 0,
        value: 0,
      };
    }
    matrixKey[k].qty += ln.quantity;
    matrixKey[k].value += ln.value;
  }
  for (const v of Object.values(matrixKey)) categoryByWarehouse.push(v);

  const total_qty = lines.reduce((s, l) => s + l.quantity, 0);
  const total_value = lines.reduce((s, l) => s + l.value, 0);

  return c.json({
    success: true,
    data: {
      scope: locParam === 'all' ? 'all_warehouses' : `location_${locParam}`,
      location_id: locParam === 'all' ? null : Number(locParam),
      locations,
      lines: group === 'category' ? [] : lines,
      by_category: Object.entries(byCategory).map(([category, v]) => ({ category, ...v })),
      by_warehouse: Object.values(byWarehouse),
      category_by_warehouse: categoryByWarehouse,
      totals: { qty: total_qty, value: total_value, lines: lines.length },
    },
  });
  } catch (e: any) {
    console.error('stock-report 500', e);
    return c.json({ success: false, error: e?.message || 'Erreur rapport stock', code: 'STOCK_REPORT_FAILED' }, 500);
  }
});

app.post('/api/inventory/transfer', async (c) => {
  const gate = requireFloorStock(c);
  if (!gate.ok) return gate.response;
  await ensureStockLocations(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const productId = Number(body.product_id);
  const qty = Number(body.quantity || 0);
  const fromId = Number(body.from_location_id || 0);
  const toId = Number(body.to_location_id || 0);
  const note = String(body.note || '').slice(0, 200);
  if (!productId || qty <= 0) return c.json({ success: false, error: 'Produit et quantité requis' }, 400);
  if (!toId) return c.json({ success: false, error: 'Destination requise' }, 400);
  if (fromId === toId) return c.json({ success: false, error: 'Source et destination identiques' }, 400);
  try {
    const fromLoc = fromId || (await getDefaultLocationId(c.env.DB));
    if (!fromLoc) return c.json({ success: false, error: 'Aucun emplacement source' }, 400);
    await adjustLocationStock(c.env.DB, productId, fromLoc, -qty);
    await adjustLocationStock(c.env.DB, productId, toId, qty, { allowNegative: false });
    await applyStockDelta(
      c.env.DB,
      productId,
      0,
      `Transfert emplacement ${fromLoc}→${toId} ×${qty}${note ? ' — ' + note : ''}`,
      'transfer',
      { type: 'adjustment', skipLocation: true },
    );
  } catch (e: any) {
    return c.json({ success: false, error: e?.message || 'Transfert impossible', code: e?.code }, 400);
  }
  await afterBusinessMutation(c.env.CACHE);
  return c.json({ success: true, message: `Transfert de ${qty} enregistré entre emplacements.` });
});

app.post('/api/inventory/cycle-count', async (c) => {
  const gate = requireFloorStock(c);
  if (!gate.ok) return gate.response;
  const body = await c.req.json().catch(() => ({}));
  const productId = Number(body.product_id);
  const counted = Number(body.counted_qty);
  const note = String(body.note || 'Inventaire').slice(0, 200);
  if (!productId || !Number.isFinite(counted) || counted < 0) {
    return c.json({ success: false, error: 'Produit et quantité comptée requis' }, 400);
  }
  const prod = await c.env.DB.prepare(`SELECT stock_quantity, track_inventory, name FROM products WHERE id = ?`).bind(productId).first() as any;
  if (!prod?.track_inventory) return c.json({ success: false, error: 'Produit non suivi' }, 400);
  const theoretical = Number(prod.stock_quantity || 0);
  const delta = counted - theoretical;
  if (Math.abs(delta) < 1e-9) {
    return c.json({ success: true, message: 'Aucun écart.', data: { delta: 0 } });
  }
  try {
    await applyStockDelta(c.env.DB, productId, delta, `Inventaire ${theoretical}→${counted} — ${note}`, 'cycle-count', {
      type: 'adjustment',
      allowNegative: true,
    });
  } catch (e: any) {
    return c.json({ success: false, error: e?.message || 'Ajustement impossible' }, 400);
  }
  await afterBusinessMutation(c.env.CACHE);
  return c.json({ success: true, message: `Écart ${delta > 0 ? '+' : ''}${delta} sur « ${prod.name} ».`, data: { delta, counted, theoretical } });
});

app.get('/api/inventory/valuation', async (c) => {
  try {
    await ensureStockLocations(c.env.DB);
    const locParam = c.req.query('location_id') || 'all';
    let results: any[] = [];
    if (locParam !== 'all' && Number(locParam) > 0) {
      const r = await c.env.DB.prepare(
        `SELECT p.id as product_id, p.name, p.sku, p.category,
                q.quantity as qty, p.cost as unit_cost,
                (q.quantity * COALESCE(p.cost, 0)) as value
         FROM stock_location_qty q
         INNER JOIN products p ON p.id = q.product_id
         WHERE q.location_id = ? AND p.is_active = 1 AND p.track_inventory = 1 AND q.quantity > 0
         ORDER BY value DESC LIMIT 500`
      ).bind(Number(locParam)).all();
      results = r.results || [];
    } else {
      // Prefer product totals (always reliable); location sum when present
      const r = await c.env.DB.prepare(
        `SELECT p.id as product_id, p.name, p.sku, p.category,
                p.stock_quantity as qty, p.cost as unit_cost,
                (p.stock_quantity * COALESCE(p.cost, 0)) as value
         FROM products p
         WHERE p.is_active = 1 AND p.track_inventory = 1 AND p.stock_quantity > 0
         ORDER BY value DESC LIMIT 500`
      ).all();
      results = r.results || [];
    }
    const lines = (results || []).map((r: any) => ({
      product_id: r.product_id,
      name: r.name,
      sku: r.sku,
      category: r.category || 'Sans catégorie',
      qty: Number(r.qty || 0),
      unit_cost: Number(r.unit_cost || 0),
      value: Number(r.value || 0),
    }));
    const byCat: Record<string, number> = {};
    for (const l of lines) byCat[l.category] = (byCat[l.category] || 0) + l.value;
    let method: string = 'average';
    try { method = await getValuationMethod(c.env.DB); } catch { /* */ }
    return c.json({
      success: true,
      data: {
        lines,
        total_value: lines.reduce((s, l) => s + l.value, 0),
        by_category: Object.entries(byCat).map(([category, value]) => ({ category, value })),
        method,
        location_id: locParam === 'all' ? null : Number(locParam),
      },
    });
  } catch (e: any) {
    console.error('valuation 500', e);
    return c.json({ success: false, error: e?.message || 'Erreur valorisation', code: 'VALUATION_FAILED' }, 500);
  }
});


app.get('/api/inventory/auto-transfer-rules', async (c) => {
  await ensureValuationTables(c.env.DB);
  const { results } = await c.env.DB.prepare(`SELECT * FROM auto_transfer_rules ORDER BY id DESC`).all();
  return c.json({ success: true, data: results || [] });
});

app.post('/api/inventory/auto-transfer-rules', async (c) => {
  const gate = requireBizMutator(c);
  if (!gate.ok) return gate.response;
  await ensureValuationTables(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name || 'Réappro auto').slice(0, 80);
  const from_location_id = Number(body.from_location_id);
  const to_location_id = Number(body.to_location_id);
  if (!from_location_id || !to_location_id) {
    return c.json({ success: false, error: 'Emplacements source et destination obligatoires.' }, 400);
  }
  await c.env.DB.prepare(
    `INSERT INTO auto_transfer_rules (name, product_id, from_location_id, to_location_id, trigger_type, threshold, transfer_qty, is_active)
     VALUES (?, ?, ?, ?, 'low_stock', ?, ?, 1)`
  ).bind(
    name,
    body.product_id ? Number(body.product_id) : null,
    from_location_id,
    to_location_id,
    Number(body.threshold ?? 5),
    Number(body.transfer_qty ?? 10),
  ).run();
  const row = await c.env.DB.prepare(`SELECT * FROM auto_transfer_rules ORDER BY id DESC LIMIT 1`).first();
  return c.json({ success: true, data: row, message: 'Règle de transfert automatique créée.' }, 201);
});

app.delete('/api/inventory/auto-transfer-rules/:id', async (c) => {
  const gate = requireBizMutator(c);
  if (!gate.ok) return gate.response;
  await c.env.DB.prepare(`DELETE FROM auto_transfer_rules WHERE id = ?`).bind(c.req.param('id')).run();
  return c.json({ success: true, message: 'Règle supprimée.' });
});

app.post('/api/inventory/auto-transfer-rules/run', async (c) => {
  const gate = requireBizMutator(c);
  if (!gate.ok) return gate.response;
  const body = await c.req.json().catch(() => ({}));
  let pids: any[] = Array.isArray(body.product_ids) ? body.product_ids : [];
  if (!pids.length) {
    const { results } = await c.env.DB.prepare(
      `SELECT id FROM products WHERE is_active = 1 AND track_inventory = 1 LIMIT 500`
    ).all();
    pids = (results || []).map((r: any) => r.id);
  }
  const result = await runAutoTransfers(c.env.DB, pids);
  await afterBusinessMutation(c.env.CACHE);
  return c.json({
    success: true,
    data: result,
    message: result.transferred
      ? `${result.transferred} transfert(s) automatique(s) effectué(s).`
      : 'Aucun transfert nécessaire (seuils OK ou stock source insuffisant).',
  });
});


async function ensureApiIntegrations(db: D1Database) {
  await schemaOnce('ensureApiIntegrations', async () => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      scopes TEXT DEFAULT 'read',
      is_active INTEGER DEFAULT 1,
      last_used_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      events TEXT DEFAULT 'invoice.created,payment.created',
      secret TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();

  });
}

function hashApiKey(raw: string): string {
  // Simple stable hash for free-tier (not crypto.subtle sync) — SHA-256 via Web Crypto in handlers
  return raw;
}

app.get('/api/integrations/keys', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  await ensureApiIntegrations(c.env.DB);
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, key_prefix, scopes, is_active, last_used_at, created_at FROM api_keys ORDER BY id DESC`
  ).all();
  return c.json({ success: true, data: results || [] });
});

app.post('/api/integrations/keys', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  await ensureApiIntegrations(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name || 'Clé API').slice(0, 80);
  const scopes = String(body.scopes || 'read,write').slice(0, 120);
  const raw = `atlas_${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const prefix = raw.slice(0, 12);
  const dig = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hash = [...new Uint8Array(dig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  await c.env.DB.prepare(
    `INSERT INTO api_keys (name, key_prefix, key_hash, scopes) VALUES (?, ?, ?, ?)`
  ).bind(name, prefix, hash, scopes).run();
  const row = await c.env.DB.prepare(`SELECT id, name, key_prefix, scopes, created_at FROM api_keys ORDER BY id DESC LIMIT 1`).first();
  return c.json({
    success: true,
    data: { ...row, key: raw },
    message: 'Clé créée — copiez-la maintenant, elle ne sera plus affichée.',
  }, 201);
});

app.delete('/api/integrations/keys/:id', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  await c.env.DB.prepare(`DELETE FROM api_keys WHERE id = ?`).bind(c.req.param('id')).run();
  return c.json({ success: true, message: 'Clé révoquée.' });
});

app.get('/api/integrations/webhooks', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  await ensureApiIntegrations(c.env.DB);
  const { results } = await c.env.DB.prepare(`SELECT * FROM webhooks ORDER BY id DESC`).all();
  return c.json({ success: true, data: results || [] });
});

app.post('/api/integrations/webhooks', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  await ensureApiIntegrations(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const url = String(body.url || '').trim();
  if (!url.startsWith('https://')) {
    return c.json({ success: false, error: 'URL HTTPS obligatoire.' }, 400);
  }
  const events = String(body.events || 'invoice.created,payment.created,stock.adjusted').slice(0, 200);
  const secret = String(body.secret || crypto.randomUUID()).slice(0, 64);
  await c.env.DB.prepare(
    `INSERT INTO webhooks (url, events, secret) VALUES (?, ?, ?)`
  ).bind(url, events, secret).run();
  const row = await c.env.DB.prepare(`SELECT * FROM webhooks ORDER BY id DESC LIMIT 1`).first();
  return c.json({ success: true, data: row, message: 'Webhook enregistré.' }, 201);
});

app.delete('/api/integrations/webhooks/:id', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  await c.env.DB.prepare(`DELETE FROM webhooks WHERE id = ?`).bind(c.req.param('id')).run();
  return c.json({ success: true, message: 'Webhook supprimé.' });
});

/** FIFO / valuation COGS snapshot for P&amp;L */
app.get('/api/reports/cogs', async (c) => {
  await ensureValuationTables(c.env.DB);
  const method = await getValuationMethod(c.env.DB);
  const from = c.req.query('from') || '';
  const to = c.req.query('to') || '';
  let sql = `
    SELECT sm.product_id, p.name, p.sku, p.cost as unit_cost,
           SUM(CASE WHEN sm.type IN ('sale','out') THEN sm.quantity ELSE 0 END) as qty_sold,
           SUM(CASE WHEN sm.type IN ('sale','out') THEN sm.quantity * COALESCE(p.cost,0) ELSE 0 END) as cogs_approx
    FROM stock_movements sm
    INNER JOIN products p ON p.id = sm.product_id
    WHERE 1=1`;
  const binds: any[] = [];
  if (from) { sql += ` AND date(sm.created_at) >= date(?)`; binds.push(from); }
  if (to) { sql += ` AND date(sm.created_at) <= date(?)`; binds.push(to); }
  sql += ` GROUP BY sm.product_id HAVING qty_sold > 0 ORDER BY cogs_approx DESC LIMIT 200`;
  let lines: any[] = [];
  try {
    const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
    lines = (results || []).map((r: any) => ({
      product_id: r.product_id,
      name: r.name,
      sku: r.sku,
      qty_sold: Number(r.qty_sold || 0),
      unit_cost: Number(r.unit_cost || 0),
      cogs: Number(r.cogs_approx || 0),
    }));
  } catch (e) {
    console.error('cogs report', e);
  }
  // FIFO layers remaining value
  let layers_value = 0;
  let layers_qty = 0;
  try {
    const { results: layers } = await c.env.DB.prepare(
      `SELECT SUM(quantity_remaining * unit_cost) as v, SUM(quantity_remaining) as q FROM stock_cost_layers WHERE quantity_remaining > 0`
    ).all();
    layers_value = Number((layers || [])[0]?.v || 0);
    layers_qty = Number((layers || [])[0]?.q || 0);
  } catch { /* */ }
  const total_cogs = lines.reduce((s, l) => s + l.cogs, 0);
  return c.json({
    success: true,
    data: {
      method,
      lines,
      total_cogs,
      fifo_layers_qty: layers_qty,
      fifo_layers_value: layers_value,
      from: from || null,
      to: to || null,
      note: method === 'fifo'
        ? 'COGS approximé via coût affiché produit ; couches FIFO restantes listées séparément.'
        : 'COGS = qté vendue × coût unitaire produit (CMP ou standard).',
    },
  });
});

async function ensureDeliveryNotes(db: D1Database) {
  await schemaOnce('ensureDeliveryNotes', async () => {
  await db.prepare(`CREATE TABLE IF NOT EXISTS delivery_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT, number TEXT NOT NULL UNIQUE, invoice_id INTEGER,
    client_name TEXT DEFAULT '', issue_date TEXT, notes TEXT DEFAULT '', status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT (datetime('now')))`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS delivery_note_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT, delivery_note_id INTEGER NOT NULL, product_id INTEGER,
    product_name TEXT, quantity REAL NOT NULL, unit TEXT DEFAULT 'u')`).run();

  });
}

app.get('/api/delivery-notes', async (c) => {
  await ensureDeliveryNotes(c.env.DB);
  const { results } = await c.env.DB.prepare(`SELECT * FROM delivery_notes ORDER BY id DESC LIMIT 100`).all();
  return c.json({ success: true, data: results || [] });
});

app.post('/api/delivery-notes', async (c) => {
  const gate = requireBizMutator(c);
  if (!gate.ok) return gate.response;
  await ensureDeliveryNotes(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const invoiceId = Number(body.invoice_id || 0);
  const inv = invoiceId ? await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(invoiceId).first() as any : null;
  if (invoiceId && !inv) return c.json({ success: false, error: 'Facture introuvable' }, 404);
  const year = new Date().getFullYear();
  const { results: existing } = await c.env.DB.prepare(`SELECT number FROM delivery_notes WHERE number LIKE ?`).bind(`BL-${year}-%`).all();
  let max = 0;
  for (const r of (existing || []) as any[]) {
    const m = String(r.number).match(/(\d+)$/);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  const number = `BL-${year}-${String(max + 1).padStart(4, '0')}`;
  const issue_date = String(body.issue_date || new Date().toISOString().slice(0, 10));
  const client_name = inv?.client_name || String(body.client_name || '');
  const ins = await c.env.DB.prepare(
    `INSERT INTO delivery_notes (number, invoice_id, client_name, issue_date, notes, status) VALUES (?, ?, ?, ?, ?, 'confirmed')`
  ).bind(number, invoiceId || null, client_name, issue_date, String(body.notes || '')).run();
  const dnId = ins.meta.last_row_id;
  let items: any[] = Array.isArray(body.items) ? body.items : [];
  if (!items.length && invoiceId) {
    const { results: invItems } = await c.env.DB.prepare(
      `SELECT product_id, product_name, quantity FROM invoice_items WHERE invoice_id = ?`
    ).bind(invoiceId).all();
    items = invItems || [];
  }
  for (const it of items) {
    await c.env.DB.prepare(
      `INSERT INTO delivery_note_items (delivery_note_id, product_id, product_name, quantity) VALUES (?, ?, ?, ?)`
    ).bind(dnId, it.product_id || null, it.product_name || it.name || '', Number(it.quantity || 0)).run();
  }
  const row = await c.env.DB.prepare(`SELECT * FROM delivery_notes WHERE id = ?`).bind(dnId).first();
  return c.json({ success: true, data: row, message: `Bon de livraison ${number} créé.` }, 201);
});

app.get('/api/delivery-notes/:id/print', async (c) => {
  await ensureDeliveryNotes(c.env.DB);
  const id = c.req.param('id');
  const dn = await c.env.DB.prepare(`SELECT * FROM delivery_notes WHERE id = ?`).bind(id).first() as any;
  if (!dn) return c.json({ success: false, error: 'BL introuvable' }, 404);
  const { results: items } = await c.env.DB.prepare(`SELECT * FROM delivery_note_items WHERE delivery_note_id = ?`).bind(id).all();
  const settings = await c.env.DB.prepare(`SELECT company_name FROM company_settings WHERE id = 1`).first() as any;
  const rows = (items || []).map((it: any) =>
    `<tr><td>${String(it.product_name || '').replace(/</g, '&lt;')}</td><td style="text-align:right">${it.quantity}</td></tr>`
  ).join('');
  return c.html(`<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/><title>${dn.number}</title>
  <style>body{font-family:system-ui;max-width:720px;margin:24px auto}table{width:100%;border-collapse:collapse}
  td,th{border-bottom:1px solid #ddd;padding:8px;text-align:left}</style></head><body>
  <h1>Bon de livraison ${dn.number}</h1>
  <p>${settings?.company_name || ''}<br/>Client : <strong>${dn.client_name || '—'}</strong><br/>Date : ${dn.issue_date || ''}</p>
  <table><thead><tr><th>Article</th><th style="text-align:right">Qté</th></tr></thead><tbody>${rows}</tbody></table>
  <p style="margin-top:12px">Réception — signature : _______________</p>
  <script>window.onload=()=>window.print()</script></body></html>`);
});

async function ensureBillReceive(db: D1Database) {
  await schemaOnce('ensureBillReceive', async () => {
  await addColumnIfMissing(db, 'bill_items', 'qty_received', `REAL DEFAULT 0`);
  await addColumnIfMissing(db, 'bills', 'receive_status', `TEXT DEFAULT 'pending'`);

  });
}

app.post('/api/bills/:id/receive', async (c) => {
  const gate = requireBizMutator(c);
  if (!gate.ok) return gate.response;
  await ensureBillReceive(c.env.DB);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const bill = await c.env.DB.prepare(`SELECT * FROM bills WHERE id = ?`).bind(id).first() as any;
  if (!bill) return c.json({ success: false, error: 'Facture d’achat introuvable' }, 404);
  let locationId = body.location_id ? Number(body.location_id) : null;
  if (!locationId) {
    try { locationId = await getDefaultLocationId(c.env.DB); } catch { locationId = null; }
  }
  const { results: items } = await c.env.DB.prepare(`SELECT * FROM bill_items WHERE bill_id = ?`).bind(id).all();
  const byId = new Map((items || []).map((it: any) => [Number(it.id), it]));
  for (const raw of (Array.isArray(body.items) ? body.items : [])) {
    const src = byId.get(Number(raw.bill_item_id || raw.id));
    if (!src) continue;
    const add = Number(raw.qty_received || raw.quantity || 0);
    if (add <= 0) continue;
    const prevRecv = Number(src.qty_received || 0);
    const nextRecv = Math.min(Number(src.quantity || 0), prevRecv + add);
    const delta = nextRecv - prevRecv;
    await c.env.DB.prepare(`UPDATE bill_items SET qty_received = ? WHERE id = ?`).bind(nextRecv, src.id).run();
    if (src.product_id && delta > 0) {
      await applyStockDelta(c.env.DB, src.product_id, delta, `Réception ${bill.number}`, bill.number, {
        type: 'purchase',
        locationId: locationId || undefined,
      });
    }
  }
  const { results: after } = await c.env.DB.prepare(`SELECT quantity, qty_received FROM bill_items WHERE bill_id = ?`).bind(id).all();
  let all = true, any = false;
  for (const it of (after || []) as any[]) {
    if (Number(it.qty_received || 0) > 0) any = true;
    if (Number(it.qty_received || 0) + 1e-9 < Number(it.quantity || 0)) all = false;
  }
  const receive_status = all ? 'matched' : any ? 'partial' : 'pending';
  try { await c.env.DB.prepare(`UPDATE bills SET receive_status = ? WHERE id = ?`).bind(receive_status, id).run(); } catch { /* */ }
  await afterBusinessMutation(c.env.CACHE);
  return c.json({
    success: true,
    data: await c.env.DB.prepare(`SELECT * FROM bills WHERE id = ?`).bind(id).first(),
    message: receive_status === 'matched' ? 'Réception complète — 3 voies OK.' : `Réception ${receive_status}.`,
  });
});

app.get('/api/bills/:id/match', async (c) => {
  await ensureBillReceive(c.env.DB);
  const id = c.req.param('id');
  const bill = await c.env.DB.prepare(`SELECT * FROM bills WHERE id = ?`).bind(id).first() as any;
  if (!bill) return c.json({ success: false, error: 'Introuvable' }, 404);
  const { results: items } = await c.env.DB.prepare(
    `SELECT bi.*, p.sku as product_sku, p.barcode as product_barcode, p.id as resolved_product_id
     FROM bill_items bi
     LEFT JOIN products p ON p.id = bi.product_id OR (bi.product_id IS NULL AND lower(p.name) = lower(bi.product_name))
     WHERE bi.bill_id = ?`
  ).bind(id).all();
  const lines = (items || []).map((it: any) => {
    const ordered = Number(it.quantity || 0);
    const received = Number(it.qty_received || 0);
    return {
      id: it.id,
      product_id: it.product_id || it.resolved_product_id || null,
      product_name: it.product_name,
      sku: it.product_sku || it.sku || null,
      barcode: it.product_barcode || it.barcode || null,
      ordered,
      received,
      billed: ordered,
      match: Math.abs(ordered - received) < 1e-6,
    };
  });
  return c.json({ success: true, data: { bill, lines, three_way_ok: lines.every((l: any) => l.match) } });
});

app.post('/api/bank/reconcile-csv', async (c) => {
  const gate = requireBizMutator(c);
  if (!gate.ok) return gate.response;
  const body = await c.req.json().catch(() => ({}));
  const csv = String(body.csv || body.text || '');
  const dateWindowDays = Math.min(60, Math.max(0, Number(body.date_window_days ?? 7)));
  if (!csv.trim()) return c.json({ success: false, error: 'Coller le CSV (date;libellé;montant)' }, 400);

  const parsed: { date: string; label: string; amount: number; line: number }[] = [];
  let lineNo = 0;
  for (const line of csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    lineNo++;
    if (/^date/i.test(line) || /libell/i.test(line) || /^amount/i.test(line)) continue;
    const parts = line.split(/[;,\t]/);
    if (parts.length < 2) continue;
    const amountRaw = parts[parts.length - 1].replace(/\s/g, '').replace(/MAD/gi, '').replace(',', '.');
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount)) continue;
    let date = parts[0].trim().slice(0, 10);
    const dm = date.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
    if (dm) date = `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
    parsed.push({
      date,
      label: parts.slice(1, -1).join(' ').trim() || parts[1] || '',
      amount,
      line: lineNo,
    });
  }

  await ensurePaymentHistoryTable(c.env.DB);
  try { await ensureBillPaymentsTable(c.env.DB); } catch { /* */ }

  const { results: expenses } = await c.env.DB.prepare(
    `SELECT id, amount, description, expense_date, entry_type, reference, notes, payment_method
     FROM expenses ORDER BY id DESC LIMIT 2000`
  ).all();
  const { results: invPays } = await c.env.DB.prepare(
    `SELECT p.id, p.amount, p.paid_at, p.payment_method, p.note, i.number as invoice_number, i.client_name
     FROM invoice_payments p LEFT JOIN invoices i ON i.id = p.invoice_id
     ORDER BY p.id DESC LIMIT 1000`
  ).all();
  let billPays: any[] = [];
  try {
    const bp = await c.env.DB.prepare(
      `SELECT p.id, p.amount, p.paid_at, p.payment_method, p.note, b.number as bill_number, b.vendor_name
       FROM bill_payments p LEFT JOIN bills b ON b.id = p.bill_id
       ORDER BY p.id DESC LIMIT 1000`
    ).all();
    billPays = (bp.results || []) as any[];
  } catch { billPays = []; }

  type Cand = {
    kind: 'expense' | 'invoice_payment' | 'bill_payment';
    id: number;
    amount: number;
    date: string;
    label: string;
    ref: string;
    entry_type?: string;
  };
  const candidates: Cand[] = [];
  for (const e of (expenses || []) as any[]) {
    candidates.push({
      kind: 'expense',
      id: Number(e.id),
      amount: Number(e.amount || 0),
      date: String(e.expense_date || '').slice(0, 10),
      label: `${e.description || ''} ${e.reference || ''} ${e.notes || ''}`,
      ref: String(e.reference || ''),
      entry_type: String(e.entry_type || ''),
    });
  }
  for (const p of (invPays || []) as any[]) {
    candidates.push({
      kind: 'invoice_payment',
      id: Number(p.id),
      amount: Number(p.amount || 0),
      date: String(p.paid_at || '').slice(0, 10),
      label: `${p.invoice_number || ''} ${p.client_name || ''} ${p.note || ''}`,
      ref: String(p.invoice_number || ''),
    });
  }
  for (const p of billPays) {
    candidates.push({
      kind: 'bill_payment',
      id: Number(p.id),
      amount: Number(p.amount || 0),
      date: String(p.paid_at || '').slice(0, 10),
      label: `${p.bill_number || ''} ${p.vendor_name || ''} ${p.note || ''}`,
      ref: String(p.bill_number || ''),
    });
  }

  const dayMs = 86400000;
  const used = new Set<string>();
  const matches: any[] = [];
  const unmatched: any[] = [];
  const norm = (s: string) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  for (const row of parsed) {
    const amt = Math.abs(row.amount);
    const bankDate = Date.parse(row.date);
    const bankLabel = norm(row.label);
    const docHint = (row.label.match(/(?:FA|ACHAT|BL|DEV|FAC)[-\s]?\d{4}[-\s]?\d+/i) || [])[0] || '';
    const docNorm = norm(docHint);

    let best: { score: number; c: Cand; reasons: string[] } | null = null;
    for (const cand of candidates) {
      const key = `${cand.kind}:${cand.id}`;
      if (used.has(key)) continue;
      const amtDiff = Math.abs(Math.abs(cand.amount) - amt);
      if (amtDiff > 0.51) continue;

      let score = 40;
      const reasons = [`montant±${amtDiff.toFixed(2)}`];

      if (row.amount > 0 && (cand.kind === 'invoice_payment' || (cand.kind === 'expense' && String(cand.entry_type || '').includes('income')))) {
        score += 8;
        reasons.push('sens crédit');
      }
      if (row.amount < 0 && (cand.kind === 'bill_payment' || cand.kind === 'expense')) {
        score += 8;
        reasons.push('sens débit');
      }

      if (cand.date && Number.isFinite(bankDate)) {
        const d = Date.parse(cand.date);
        if (Number.isFinite(d)) {
          const days = Math.abs(bankDate - d) / dayMs;
          if (days <= dateWindowDays) {
            score += Math.max(0, 25 - days * 2);
            reasons.push(`date±${Math.round(days)}j`);
          } else {
            score -= 15;
          }
        }
      }

      const cLabel = norm(cand.label);
      if (docNorm && (cLabel.includes(docNorm) || norm(cand.ref).includes(docNorm))) {
        score += 35;
        reasons.push('n° document');
      } else if (bankLabel && cLabel) {
        const words = bankLabel.split(' ').filter((w) => w.length > 3);
        let hits = 0;
        for (const w of words.slice(0, 8)) {
          if (cLabel.includes(w)) hits++;
        }
        if (hits >= 2) {
          score += 12 + hits;
          reasons.push(`libellé×${hits}`);
        } else if (hits === 1) {
          score += 5;
          reasons.push('libellé partiel');
        }
      }

      if (!best || score > best.score) best = { score, c: cand, reasons };
    }

    if (best && best.score >= 45) {
      used.add(`${best.c.kind}:${best.c.id}`);
      matches.push({
        bank: row,
        match: {
          kind: best.c.kind,
          id: best.c.id,
          amount: best.c.amount,
          date: best.c.date,
          label: best.c.label.slice(0, 120),
          ref: best.c.ref,
        },
        score: Math.round(best.score),
        reasons: best.reasons,
        expense_id: best.c.kind === 'expense' ? best.c.id : null,
      });
    } else {
      unmatched.push(row);
    }
  }

  return c.json({
    success: true,
    data: {
      parsed: parsed.length,
      matched: matches.length,
      unmatched_count: unmatched.length,
      date_window_days: dateWindowDays,
      matches: matches.slice(0, 150),
      unmatched: unmatched.slice(0, 150),
      rules: [
        'Montant ±0,50 MAD',
        `Date ±${dateWindowDays} jours (bonus)`,
        'N° document dans le libellé (FA-/ACHAT-…)',
        'Mots du libellé (fuzzy)',
        'Sens crédit/débit',
        'Un mouvement Atlas n’est utilisé qu’une fois',
      ],
    },
    message: `${matches.length} rapprochée(s), ${unmatched.length} sans correspondance.`,
  });
});

/** Lightweight counts for sidebar / phone nav badges */
app.get('/api/nav-badges', async (c) => {
  try {
    const badgeKey = `nav-badges:${await getCacheGen(c.env.CACHE)}`;
    const cached = await kvGetJson<any>(c.env.CACHE, badgeKey);
    if (cached) {
      return c.json({ success: true, data: cached, meta: { cache: 'hit' } }, 200, {
        'Cache-Control': 'private, max-age=20',
      });
    }
    const [unpaidInvoices, unpaidBills, lowStock, pendingActions, openQuotes, billsReceive, vrOpen, _empActive] = await Promise.all([
      c.env.DB.prepare(
        `SELECT COUNT(*) as n FROM invoices
         WHERE status NOT IN ('quote','devis','cancelled','remboursement','paid')
           AND COALESCE(doc_kind,'') NOT IN ('remboursement','quick_sale','ticket')
           AND IFNULL(number,'') NOT LIKE 'VR-%'
           AND IFNULL(number,'') NOT LIKE 'VR/%'
           AND (total - COALESCE(amount_paid, 0)) > 0.001`
      ).first() as Promise<any>,
      c.env.DB.prepare(
        `SELECT COUNT(*) as n FROM bills
         WHERE status NOT IN ('cancelled','paid')
           AND (total - COALESCE(amount_paid, 0)) > 0.001`
      ).first() as Promise<any>,
      c.env.DB.prepare(
        `SELECT COUNT(*) as n FROM products
         WHERE is_active = 1 AND track_inventory = 1
           AND stock_quantity <= COALESCE(low_stock_threshold, 0)`
      ).first() as Promise<any>,
      c.env.DB.prepare(
        `SELECT COUNT(*) as n FROM mobile_actions WHERE status = 'pending'`
      ).first().catch(() => ({ n: 0 })) as Promise<any>,
      c.env.DB.prepare(
        `SELECT COUNT(*) as n FROM invoices WHERE status IN ('quote','devis')`
      ).first() as Promise<any>,
      c.env.DB.prepare(
        `SELECT COUNT(*) as n FROM bills
         WHERE status NOT IN ('cancelled')
           AND COALESCE(receive_status, 'pending') IN ('pending', 'partial')`
      ).first().catch(() => ({ n: 0 })) as Promise<any>,
      c.env.DB.prepare(
        `SELECT COUNT(*) as n FROM invoices
         WHERE status NOT IN ('cancelled','paid')
           AND (
             COALESCE(doc_kind,'') IN ('quick_sale','ticket')
             OR IFNULL(number,'') LIKE 'VR-%'
             OR IFNULL(number,'') LIKE 'VR/%'
           )
           AND (total - COALESCE(amount_paid, 0)) > 0.001`
      ).first().catch(() => ({ n: 0 })) as Promise<any>,
      c.env.DB.prepare(
        `SELECT COUNT(*) as n FROM employees
         WHERE COALESCE(active, 1) = 1 AND COALESCE(pay_amount, 0) > 0.001`
      ).first().catch(() => ({ n: 0 })) as Promise<any>,
    ]);

    // employees_pay_due — same rules as Employees page (nextDue + Morocco TZ)
    let employees_pay_due = 0;
    try {
      employees_pay_due = await countEmployeesPayDue(c.env.DB);
    } catch { /* table may not exist yet */ }

    const data = {
      invoices_unpaid: Number(unpaidInvoices?.n || 0),
      bills_unpaid: Number(unpaidBills?.n || 0),
      bills_receive: Number(billsReceive?.n || 0),
      products_low: Number(lowStock?.n || 0),
      actions_pending: Number(pendingActions?.n || 0),
      quotes_open: Number(openQuotes?.n || 0),
      vr_open: Number(vrOpen?.n || 0),
      employees_pay_due,
    };
    await kvPutJson(c.env.CACHE, badgeKey, data, 30);
    return c.json({ success: true, data }, 200, { 'Cache-Control': 'private, max-age=20' });
  } catch (e: any) {
    console.error('nav-badges', e);
    return c.json({
      success: true,
      data: {
        invoices_unpaid: 0,
        bills_unpaid: 0,
        bills_receive: 0,
        products_low: 0,
        actions_pending: 0,
        quotes_open: 0,
        vr_open: 0,
        employees_pay_due: 0,
      },
    });
  }
});

app.get('/api/dashboard', async (c) => {
  // KV short cache reduces D1 free-tier read volume (many heavy aggregates).
  const ttl = Math.max(120, Math.min(1800, Number(c.env.CACHE_TTL_SECONDS || DEFAULT_CACHE_TTL)));
  const cached = await kvGetJson<any>(c.env.CACHE, await dashboardCacheKey(c.env.CACHE));
  if (cached) {
    return c.json({ success: true, data: cached, meta: { cache: 'hit' } });
  }

  const settings = await c.env.DB.prepare(`SELECT starting_balance, currency FROM company_settings WHERE id = 1`).first() as any;
  const [
    products,
    lowStock,
    unpaidSales,
    unpaidSalesOpen,
    unpaidSalesOverdue,
    unpaidPurchases,
    unpaidPurchasesOpen,
    unpaidPurchasesOverdue,
  ] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(stock_quantity * cost), 0) as stock_value FROM products WHERE is_active = 1`).first(),
    c.env.DB.prepare(`SELECT COUNT(*) as count FROM products WHERE is_active = 1 AND track_inventory = 1 AND stock_quantity <= low_stock_threshold`).first(),
    c.env.DB.prepare(
      `SELECT COUNT(*) as count, COALESCE(SUM(total - COALESCE(amount_paid, 0)), 0) as total FROM invoices
       WHERE status IN ('sent', 'partial', 'overdue', 'draft')
         AND status NOT IN ('quote', 'devis', 'cancelled', 'remboursement')
         AND COALESCE(doc_kind, '') != 'remboursement'`
    ).first(),
    c.env.DB.prepare(
      `SELECT COUNT(*) as count, COALESCE(SUM(total - COALESCE(amount_paid, 0)), 0) as total FROM invoices
       WHERE status IN ('sent', 'partial', 'draft')
         AND status NOT IN ('quote', 'devis', 'cancelled', 'remboursement')
         AND COALESCE(doc_kind, '') != 'remboursement'
         AND (due_date IS NULL OR due_date >= date('now'))`
    ).first(),
    c.env.DB.prepare(
      `SELECT COUNT(*) as count, COALESCE(SUM(total - COALESCE(amount_paid, 0)), 0) as total FROM invoices
       WHERE status IN ('sent', 'partial', 'overdue')
         AND status NOT IN ('quote', 'devis', 'cancelled', 'remboursement')
         AND COALESCE(doc_kind, '') != 'remboursement'
         AND due_date IS NOT NULL AND due_date < date('now')`
    ).first(),
    c.env.DB.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(total - COALESCE(amount_paid, 0)), 0) as total FROM bills WHERE status IN ('sent', 'partial', 'draft')`).first(),
    c.env.DB.prepare(
      `SELECT COUNT(*) as count, COALESCE(SUM(total - COALESCE(amount_paid, 0)), 0) as total FROM bills
       WHERE status IN ('sent', 'partial', 'draft') AND (due_date IS NULL OR due_date >= date('now'))`
    ).first(),
    c.env.DB.prepare(
      `SELECT COUNT(*) as count, COALESCE(SUM(total - COALESCE(amount_paid, 0)), 0) as total FROM bills
       WHERE status IN ('sent', 'partial', 'draft') AND due_date IS NOT NULL AND due_date < date('now')`
    ).first(),
  ]);
  await ensurePaymentHistoryTable(c.env.DB);
  await ensureInvoiceRefundColumns(c.env.DB);
  // Entrées ventes = vrais encaissements uniquement (pas les avoirs WR, pas les lignes « Avoir … »)
  let salesReceivedNet = 0;
  try {
    const fromPayments = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(p.amount), 0) as total
       FROM invoice_payments p
       INNER JOIN invoices i ON i.id = p.invoice_id
       WHERE COALESCE(i.status, '') NOT IN ('quote', 'devis', 'cancelled', 'remboursement')
         AND COALESCE(i.doc_kind, '') != 'remboursement'
         AND COALESCE(p.note, '') NOT LIKE 'Avoir %'`
    ).first() as any;
    salesReceivedNet = Number(fromPayments?.total || 0);
  } catch {
    // Fallback if payments table empty / missing
    const salesPaid = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(amount_paid), 0) as total FROM invoices
       WHERE status IN ('paid', 'partial')
         AND COALESCE(status, '') != 'remboursement'
         AND COALESCE(doc_kind, '') != 'remboursement'`
    ).first() as any;
    salesReceivedNet = Number(salesPaid?.total || 0);
  }
  const refundsIssued = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(total), 0) as total FROM invoices
     WHERE status = 'remboursement' OR doc_kind = 'remboursement'`
  ).first().catch(() => ({ total: 0 }));
  const purchasesPaid = await c.env.DB.prepare(`SELECT COALESCE(SUM(amount_paid), 0) as total FROM bills WHERE status IN ('paid', 'partial')`).first();
  await ensureExpenseTypeColumn(c.env.DB);
  const expensesTotal = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE COALESCE(entry_type, 'expense') = 'expense'`
  ).first();
  const otherIncomeTotal = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total FROM expenses
     WHERE entry_type = 'income' AND COALESCE(category, '') != 'Encaissement client'`
  ).first();
  const ownerDrawTotal = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE entry_type = 'owner_draw'`
  ).first();
  const ownerContribTotal = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE entry_type = 'owner_contrib'`
  ).first();
  const starting = settings?.starting_balance || 0;
  // Remboursements client (expense) sortent déjà du solde ; les WR ne sont jamais des entrées.
  const balance = starting
    + salesReceivedNet
    + (otherIncomeTotal?.total || 0)
    + (ownerContribTotal?.total || 0)
    - (purchasesPaid?.total || 0)
    - (expensesTotal?.total || 0)
    - (ownerDrawTotal?.total || 0);
  const recentInvoices = await c.env.DB.prepare(`SELECT * FROM invoices ORDER BY created_at DESC LIMIT 5`).all();
  const recentBills = await c.env.DB.prepare(`SELECT * FROM bills ORDER BY created_at DESC LIMIT 5`).all();
  const recentExpenses = await c.env.DB.prepare(`SELECT * FROM expenses ORDER BY expense_date DESC LIMIT 8`).all();
  const unpaidInvoiceList = await c.env.DB.prepare(`SELECT id, number, client_name, issue_date, due_date, total, amount_paid, status FROM invoices WHERE status IN ('sent', 'partial', 'overdue', 'draft') AND status != 'quote' ORDER BY due_date ASC NULLS LAST, issue_date ASC LIMIT 10`).all();
  const unpaidBillList = await c.env.DB.prepare(`SELECT id, number, vendor_name, issue_date, due_date, total, amount_paid, status FROM bills WHERE status IN ('sent', 'partial', 'draft') ORDER BY due_date ASC NULLS LAST, issue_date ASC LIMIT 10`).all();

  // Up to 36 months so chart presets (1m / 6m / 1y / 2y / ytd) always have points
  const monthKeys: string[] = [];
  const monthLabels: string[] = [];
  const frMonths = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
  const now = new Date();
  for (let i = 35; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthKeys.push(key);
    monthLabels.push(`${frMonths[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`);
  }
  let salesByMonth: { results?: any[] } = { results: [] };
  try {
    salesByMonth = await c.env.DB.prepare(
      `SELECT substr(replace(COALESCE(p.paid_at, p.created_at, ''), 'T', ' '), 1, 7) as ym, COALESCE(SUM(p.amount), 0) as total
       FROM invoice_payments p
       INNER JOIN invoices i ON i.id = p.invoice_id
       WHERE COALESCE(i.status, '') NOT IN ('quote', 'devis', 'cancelled', 'remboursement')
         AND COALESCE(i.doc_kind, '') != 'remboursement'
         AND COALESCE(p.note, '') NOT LIKE 'Avoir %'
       GROUP BY ym`
    ).all();
  } catch {
    salesByMonth = await c.env.DB.prepare(
      `SELECT substr(replace(COALESCE(issue_date, created_at, ''), 'T', ' '), 1, 7) as ym, COALESCE(SUM(amount_paid), 0) as total
       FROM invoices
       WHERE status IN ('paid', 'partial')
         AND COALESCE(status, '') != 'remboursement'
         AND COALESCE(doc_kind, '') != 'remboursement'
       GROUP BY ym`
    ).all();
  }
  const purchasesByMonth = await c.env.DB.prepare(
    `SELECT substr(replace(COALESCE(issue_date, created_at, ''), 'T', ' '), 1, 7) as ym, COALESCE(SUM(amount_paid), 0) as total
     FROM bills WHERE status IN ('paid', 'partial') GROUP BY ym`
  ).all();
  const expensesByMonth = await c.env.DB.prepare(
    `SELECT substr(replace(COALESCE(expense_date, created_at, ''), 'T', ' '), 1, 7) as ym, COALESCE(SUM(amount), 0) as total
     FROM expenses WHERE COALESCE(entry_type, 'expense') = 'expense' GROUP BY ym`
  ).all();
  // Only non-invoice income (exclude 'Encaissement client' which already appears in invoices.amount_paid).
  // Otherwise monthly Entrées / Profit are doubled: the same paid amount is counted twice.
  const incomeByMonth = await c.env.DB.prepare(
    `SELECT substr(replace(COALESCE(expense_date, created_at, ''), 'T', ' '), 1, 7) as ym, COALESCE(SUM(amount), 0) as total
     FROM expenses
     WHERE entry_type = 'income'
       AND COALESCE(category, '') != 'Encaissement client'
     GROUP BY ym`
  ).all();
  // Owner capital movements — same ledger as Balance page (must feed charts)
  let ownerContribByMonth: { results?: any[] } = { results: [] };
  let ownerDrawByMonth: { results?: any[] } = { results: [] };
  try {
    ownerContribByMonth = await c.env.DB.prepare(
      `SELECT substr(replace(COALESCE(expense_date, created_at, ''), 'T', ' '), 1, 7) as ym, COALESCE(SUM(amount), 0) as total
       FROM expenses WHERE entry_type = 'owner_contrib' GROUP BY ym`
    ).all();
  } catch { /* */ }
  try {
    ownerDrawByMonth = await c.env.DB.prepare(
      `SELECT substr(replace(COALESCE(expense_date, created_at, ''), 'T', ' '), 1, 7) as ym, COALESCE(SUM(amount), 0) as total
       FROM expenses WHERE entry_type = 'owner_draw' GROUP BY ym`
    ).all();
  } catch { /* */ }
  const salesMap: Record<string, number> = {};
  const spendMap: Record<string, number> = {};
  for (const r of (salesByMonth.results || []) as any[]) salesMap[r.ym] = Number(r.total || 0);
  for (const r of (incomeByMonth.results || []) as any[]) salesMap[r.ym] = (salesMap[r.ym] || 0) + Number(r.total || 0);
  for (const r of (ownerContribByMonth.results || []) as any[]) salesMap[r.ym] = (salesMap[r.ym] || 0) + Number(r.total || 0);
  for (const r of (purchasesByMonth.results || []) as any[]) spendMap[r.ym] = (spendMap[r.ym] || 0) + Number(r.total || 0);
  for (const r of (expensesByMonth.results || []) as any[]) spendMap[r.ym] = (spendMap[r.ym] || 0) + Number(r.total || 0);
  for (const r of (ownerDrawByMonth.results || []) as any[]) spendMap[r.ym] = (spendMap[r.ym] || 0) + Number(r.total || 0);

  // Domain breakdowns for richer dashboard charts
  const salaryMap: Record<string, number> = {};
  const faMap: Record<string, number> = {};
  const vrMap: Record<string, number> = {};
  const billMap: Record<string, number> = {};
  const clientMap: Record<string, number> = {};
  const receiptMap: Record<string, number> = {};
  try {
    const sal = await c.env.DB.prepare(
      `SELECT substr(replace(COALESCE(expense_date, created_at, ''), 'T', ' '), 1, 7) as ym, COALESCE(SUM(amount),0) as total
       FROM expenses WHERE COALESCE(entry_type,'expense')='expense' AND (category='Salaire' OR notes LIKE 'employee_id:%')
       GROUP BY ym`
    ).all();
    for (const r of (sal.results || []) as any[]) salaryMap[r.ym] = Number(r.total || 0);
  } catch { /* */ }
  try {
    const fa = await c.env.DB.prepare(
      `SELECT substr(replace(COALESCE(issue_date, created_at, ''), 'T', ' '), 1, 7) as ym, COALESCE(SUM(total),0) as total
       FROM invoices WHERE status NOT IN ('cancelled','quote','devis','remboursement')
         AND COALESCE(doc_kind,'') NOT IN ('quick_sale','ticket','remboursement')
         AND IFNULL(number,'') NOT LIKE 'VR-%' AND IFNULL(number,'') NOT LIKE 'VR/%'
       GROUP BY ym`
    ).all();
    for (const r of (fa.results || []) as any[]) faMap[r.ym] = Number(r.total || 0);
  } catch { /* */ }
  try {
    const vr = await c.env.DB.prepare(
      `SELECT substr(replace(COALESCE(issue_date, created_at, ''), 'T', ' '), 1, 7) as ym, COALESCE(SUM(total),0) as total
       FROM invoices WHERE status NOT IN ('cancelled')
         AND (COALESCE(doc_kind,'') IN ('quick_sale','ticket') OR IFNULL(number,'') LIKE 'VR-%' OR IFNULL(number,'') LIKE 'VR/%')
       GROUP BY ym`
    ).all();
    for (const r of (vr.results || []) as any[]) vrMap[r.ym] = Number(r.total || 0);
  } catch { /* */ }
  try {
    const bi = await c.env.DB.prepare(
      `SELECT substr(replace(COALESCE(issue_date, bill_date, created_at, ''), 'T', ' '), 1, 7) as ym, COALESCE(SUM(total),0) as total
       FROM bills WHERE status NOT IN ('cancelled') GROUP BY ym`
    ).all();
    for (const r of (bi.results || []) as any[]) billMap[r.ym] = Number(r.total || 0);
  } catch { /* */ }
  try {
    const cl = await c.env.DB.prepare(
      `SELECT substr(replace(COALESCE(created_at, ''), 'T', ' '), 1, 7) as ym, COUNT(*) as total FROM clients GROUP BY ym`
    ).all();
    for (const r of (cl.results || []) as any[]) clientMap[r.ym] = Number(r.total || 0);
  } catch { /* */ }
  try {
    const rc = await c.env.DB.prepare(
      `SELECT substr(replace(COALESCE(payment_date, created_at, ''), 'T', ' '), 1, 7) as ym, COALESCE(SUM(amount),0) as total
       FROM payments GROUP BY ym`
    ).all();
    for (const r of (rc.results || []) as any[]) receiptMap[r.ym] = Number(r.total || 0);
  } catch {
    try {
      const rc2 = await c.env.DB.prepare(
        `SELECT substr(replace(COALESCE(paid_at, created_at, ''), 'T', ' '), 1, 7) as ym, COALESCE(SUM(amount),0) as total
         FROM invoice_payments GROUP BY ym`
      ).all();
      for (const r of (rc2.results || []) as any[]) receiptMap[r.ym] = Number(r.total || 0);
    } catch { /* */ }
  }

  const monthlySeries = monthKeys.map((k, i) => ({
    key: k,
    label: monthLabels[i],
    sales: salesMap[k] || 0,
    expenses: spendMap[k] || 0,
    profit: (salesMap[k] || 0) - (spendMap[k] || 0),
    income: salesMap[k] || 0,
    expense: spendMap[k] || 0,
    salaries: salaryMap[k] || 0,
    invoices_fa: faMap[k] || 0,
    sales_vr: vrMap[k] || 0,
    bills: billMap[k] || 0,
    clients_new: clientMap[k] || 0,
    receipts: receiptMap[k] || 0,
    owner_contrib: Number((ownerContribByMonth.results || []).find((r: any) => r.ym === k)?.total || 0),
    owner_draw: Number((ownerDrawByMonth.results || []).find((r: any) => r.ym === k)?.total || 0),
  }));
  // Charges only: never mix income rows (e.g. Encaissement client) into expense breakdown
  const expenseCats = await c.env.DB.prepare(
    `SELECT COALESCE(category, 'Autre') as category, COALESCE(SUM(amount), 0) as total
     FROM expenses
     WHERE COALESCE(entry_type, 'expense') = 'expense'
     GROUP BY category
     ORDER BY total DESC
     LIMIT 8`
  ).all();

  const payload = {
      currency: settings?.currency || 'MAD',
      startingBalance: starting,
      currentBalance: balance,
      productCount: products?.count || 0,
      stockValue: products?.stock_value || 0,
      lowStockCount: lowStock?.count || 0,
      unpaidSales: {
        count: unpaidSales?.count || 0,
        total: unpaidSales?.total || 0,
        open: Number(unpaidSalesOpen?.total || 0),
        overdue: Number(unpaidSalesOverdue?.total || 0),
      },
      unpaidPurchases: {
        count: unpaidPurchases?.count || 0,
        total: unpaidPurchases?.total || 0,
        open: Number(unpaidPurchasesOpen?.total || 0),
        overdue: Number(unpaidPurchasesOverdue?.total || 0),
      },
      salesReceived: salesReceivedNet,
      refundsTotal: Number((refundsIssued as any)?.total || 0),
      purchasesPaid: purchasesPaid?.total || 0,
      expensesTotal: expensesTotal?.total || 0,
      otherIncomeTotal: otherIncomeTotal?.total || 0,
      ownerDrawTotal: ownerDrawTotal?.total || 0,
      ownerContribTotal: ownerContribTotal?.total || 0,
      recentInvoices: recentInvoices.results || [],
      recentBills: recentBills.results || [],
      recentExpenses: recentExpenses.results || [],
      unpaidInvoiceList: unpaidInvoiceList.results || [],
      unpaidBillList: unpaidBillList.results || [],
      monthlySeries,
      expenseCategories: (expenseCats.results || []).map((r: any) => ({
        category: r.category,
        total: Number(r.total || 0),
      })),
      expenseByCategory: (expenseCats.results || []).map((r: any) => ({
        category: r.category,
        total: Number(r.total || 0),
      })),
    };
  await kvPutJson(c.env.CACHE, await dashboardCacheKey(c.env.CACHE), payload, ttl);
  return c.json({
    success: true,
    data: payload,
    meta: { cache: 'miss' },
  });
});

/* ─── Send Invoice Email ─── */

app.post('/api/invoices/:id/send-email', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const to = String(body.to || '').trim();
  if (!to || !to.includes('@')) {
    return c.json({ success: false, error: 'Adresse e-mail du destinataire invalide' }, 400);
  }
  const apiKey = c.env.RESEND_API_KEY;
  if (!apiKey) {
    return c.json({ success: false, error: 'L\'envoi d\'e-mails n\'est pas disponible. Veuillez contacter l\'administrateur.', code: 'EMAIL_NOT_CONFIGURED' }, 503);
  }
  const invoice = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first() as any;
  if (!invoice) return c.json({ success: false, error: 'Facture introuvable' }, 404);
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const { results: items } = await c.env.DB.prepare(`SELECT * FROM invoice_items WHERE invoice_id = ?`).bind(id).all();
  const from = c.env.RESEND_FROM || 'onboarding@resend.dev';
  const company = settings?.company_name || 'Company';
  const html = generateInvoiceEmailHTML(settings, invoice, items as any[], company);
  const resendUrl = assertSafeOutboundUrl('https://api.resend.com/emails');
  const res = await fetch(resendUrl.toString(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: `Facture ${invoice.number} — ${company}`, html }),
  });
  const data = await res.json().catch(() => ({})) as any;
  if (!res.ok) {
    return c.json({ success: false, error: data.message || 'Échec de l\'envoi via Resend', details: data }, 502);
  }
  try { await ensureMailSchema(c.env.DB); } catch { /* table optional */ }
  try {
    await c.env.DB.prepare(
      `INSERT INTO mail_messages (direction, mailbox, from_addr, to_addr, subject, body_html, resend_id, status, meta_json)
       VALUES ('out', ?, ?, ?, ?, ?, ?, 'sent', ?)`
    ).bind(
      from.includes('afmarbre') ? from : 'admin@afmarbre.com',
      from,
      to,
      `Facture ${invoice.number} — ${company}`,
      html.slice(0, 200000),
      String(data.id || ''),
      JSON.stringify({ type: 'invoice', invoice_id: id }),
    ).run();
  } catch { /* */ }
  return c.json({ success: true, data: { id: data.id, to } });
});


/* ─── Printable reports (open in browser → Enregistrer en PDF) ─── */

function reportShell(title: string, company: string, subtitle: string, body: string, footerText?: string): string {
  const generated = new Date().toLocaleString('fr-FR');
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<title>${title} — ${company}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:"Segoe UI",system-ui,-apple-system,sans-serif;color:#111;max-width:920px;margin:0 auto;padding:8px 12px;font-size:12px;line-height:1.35;position:relative}
  .watermark{position:fixed;inset:0;pointer-events:none;z-index:0;display:flex;align-items:center;justify-content:center;font-size:64px;font-weight:800;letter-spacing:0.1em;opacity:0.05;transform:rotate(-28deg);text-transform:uppercase;color:#111}
  .sheet{position:relative;z-index:1}
  table thead{display:table-header-group}
  table tr,.keep{page-break-inside:avoid;break-inside:avoid}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:12px;margin-bottom:18px}
  .hdr h1{font-size:20px;margin:0 0 4px;font-weight:700;letter-spacing:-0.02em}
  .hdr .co{font-size:14px;font-weight:600}
  .muted{color:#444;font-size:11.5px}
  h2{font-size:13px;margin:22px 0 8px;border-bottom:1px solid #111;padding-bottom:4px;text-transform:uppercase;letter-spacing:.06em}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}
  .stat{border:1px solid #333;padding:10px 12px}
  .stat .l{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#333}
  .stat .v{font-size:16px;font-weight:700;margin-top:4px}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th,td{text-align:left;padding:7px 8px;border-bottom:1px solid #ccc;font-size:11.5px}
  th{border-bottom:2px solid #111;font-size:10px;text-transform:uppercase;letter-spacing:.04em;font-weight:700}
  .in{font-weight:700}
  .out{font-weight:700}
  .actions{margin:0 0 16px}
  button{background:#111;color:#fff;border:0;padding:10px 16px;border-radius:4px;cursor:pointer;font-size:13px}
  .sign-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:16px;page-break-inside:avoid}
  .sign-box{min-height:90px;border:1px solid #333;padding:10px}
  .sign-box .t{font-size:10px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;font-weight:700}
  .sign-box .line{margin-top:16px;border-top:1px solid #111;padding-top:6px;font-size:10px;color:#333}
  .footer{margin-top:10px;padding-top:10px;border-top:1px solid #999;font-size:10px;color:#444;display:flex;justify-content:space-between}
  
  .cat-block{margin:18px 0 22px;page-break-inside:avoid}
  .cat-title{font-size:14px;margin:0 0 8px;padding:8px 10px;background:#f0ebe3;border-left:4px solid #1a1814;display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
  .cat-meta{font-size:11px;font-weight:400;color:#5c574f}
  .badge-low{font-size:10px;background:#fce8e8;color:#8b2e2e;padding:2px 6px;border-radius:4px;margin-left:6px}
  tr.low td{background:#fff8f8}
  .grid-4{grid-template-columns:repeat(4,1fr)}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  table{width:100%;border-collapse:collapse;font-size:11.5px;margin-bottom:4px}
  th,td{border-bottom:1px solid #e5e0d6;padding:7px 8px;text-align:left}
  th{background:#f7f4ee;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#5c574f}
  .stat{background:#fff;border:1px solid #e0d9cc;border-radius:8px;padding:12px 14px}
  .stat .l{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#7a756c}
  .stat .v{font-size:18px;font-weight:700;margin-top:4px}
  .in{color:#6366f1}.out{color:#8b2e2e}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
  @media(max-width:800px){.grid,.grid-4{grid-template-columns:1fr 1fr}}
.page-num{position:fixed;bottom:8mm;right:12mm;font-size:10px;color:#444}
  .cat-totals{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:8px 0 0;padding:10px;background:#faf8f4;border:1px solid #e5e0d6;border-radius:6px}
  .cat-totals .ct{font-size:11px}
  .cat-totals .ct b{display:block;font-size:13px;margin-top:2px}
  @media print{
    .actions{display:none!important}
    body{padding:0;max-width:none}
    .stat,.sign-box{border-color:#000}
    a{color:#000;text-decoration:none}
    @page{size:A4;margin:10mm 10mm 12mm 10mm}
    @page{@bottom-center{content:"Page " counter(page) " / " counter(pages);font-size:9pt;color:#444}}
    table tr{page-break-inside:avoid;break-inside:avoid}
    thead{display:table-header-group}
    .sign-row,.cat-block{page-break-inside:avoid}
    .page-num{display:none}
  }
  @media (max-width:700px){.grid{grid-template-columns:1fr 1fr}.sign-row{grid-template-columns:1fr}.cat-totals{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>
  <div class="watermark" aria-hidden="true">RAPPORT</div>
  <div class="sheet">
  <div class="actions"><button type="button" onclick="window.print()">Imprimer / Enregistrer en PDF</button></div>
  <div class="hdr">
    <div>
      <div class="co">${company}</div>
      <h1>${title}</h1>
      <p class="muted">${subtitle}</p>
    </div>
    <div class="muted" style="text-align:right">
      Document comptable<br/>Généré le ${generated}<br/>Impression N&amp;B recommandée
    </div>
  </div>
  ${body}
  <div class="sign-row keep">
    <div class="sign-box">
      <div class="t">Préparé par</div>
      <div class="line">Nom / signature</div>
    </div>
    <div class="sign-box">
      <div class="t">Vérifié / Approuvé</div>
      <div class="line">Nom / signature</div>
    </div>
    <div class="sign-box">
      <div class="t">Cachet de l'entreprise</div>
      <div class="line">Tampon / sceau</div>
    </div>
  </div>
  <div class="footer">
    <span>${company} — Gestion stock &amp; comptabilité</span>
    <span>${footerText || 'Document comptable · Impression noir et blanc · À conserver'}</span>
  </div>
  </div>
  <div class="page-num" id="pn"></div>
  <script>
    (function(){
      // Screen preview: approximate page count from content height
      function upd(){
        var el=document.getElementById('pn');
        if(!el)return;
        var h=document.body.scrollHeight;
        var ph=1122; // ~A4 px at 96dpi
        var pages=Math.max(1,Math.ceil(h/ph));
        el.textContent='Page 1–'+pages+' (aperçu · numérotation exacte à l\\'impression)';
      }
      upd();
      window.addEventListener('load',upd);
    })();
  </script>
</body>
</html>`;
}

function fmtN(n: any) {
  return Math.round(Number(n || 0)).toLocaleString('fr-FR');
}

/**
 * Report period bounds (v262) — relative windows AND strictly validated
 * `YYYY-MM` months, anchored on the company's finance timezone
 * (company_settings.finance_timezone, default Africa/Casablanca): the current
 * month stops at TODAY in that timezone, past months use the full calendar
 * month. Pure logic lives in lib/report-period.ts (unit-tested). `periodKey`
 * is the normalized period propagated to every section link.
 */
function periodBounds(c: any, timezone?: string): { from: string; to: string; label: string; periodKey: string } {
  const tz = String(timezone || '').trim() || 'Africa/Casablanca';
  return computePeriodBounds(
    { period: c.req.query('period'), from: c.req.query('from'), to: c.req.query('to') },
    { todayYmd: localTodayYmd(tz) },
  );
}

app.get('/api/reports/balance', async (c) => {
  await ensureExpenseTypeColumn(c.env.DB);
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const { from, to, label } = periodBounds(c, settings?.finance_timezone);
  const cur = settings?.currency || 'MAD';
  const { results: entries } = await c.env.DB.prepare(
    `SELECT * FROM expenses WHERE expense_date >= ? AND expense_date <= ? ORDER BY expense_date ASC, id ASC`
  ).bind(from, to).all();

  const rows = (entries || []) as any[];
  const isIn = (e: any) => e.entry_type === 'income' || e.entry_type === 'owner_contrib';
  const isOut = (e: any) => !isIn(e);

  const sum = (pred: (e: any) => boolean) => rows.filter(pred).reduce((s, e) => s + Number(e.amount || 0), 0);
  const isCashMethod = (m: any) => !m || m === 'cash';
  const cashIn = sum((e) => isIn(e) && isCashMethod(e.payment_method));
  const cashOut = sum((e) => isOut(e) && isCashMethod(e.payment_method));
  const bankIn = sum((e) => isIn(e) && !isCashMethod(e.payment_method));
  const bankOut = sum((e) => isOut(e) && !isCashMethod(e.payment_method));
  const ownerDraw = sum((e) => e.entry_type === 'owner_draw');
  const ownerContrib = sum((e) => e.entry_type === 'owner_contrib');
  const income = sum((e) => e.entry_type === 'income');
  const expense = sum((e) => e.entry_type === 'expense' || !e.entry_type);

  const typeLabel = (e: any) => {
    if (e.entry_type === 'income') return 'Recette';
    if (e.entry_type === 'owner_draw') return 'Prélèvement propriétaire';
    if (e.entry_type === 'owner_contrib') return 'Apport propriétaire';
    return 'Dépense';
  };

  const tableRows = rows.map((e) => {
    const inn = isIn(e);
    return `<tr>
      <td>${e.expense_date || ''}</td>
      <td>${typeLabel(e)}</td>
      <td>${e.description || ''}</td>
      <td>${e.category || ''}</td>
      <td>${e.payment_method || '—'}</td>
      <td class="${inn ? 'in' : 'out'}">${inn ? '+' : '−'}${fmtN(e.amount)} ${cur}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="6">Aucune écriture sur la période</td></tr>`;

  const body = `
  <div class="grid">
    <div class="stat"><div class="l">Espèces entrées</div><div class="v in">+${fmtN(cashIn)}</div></div>
    <div class="stat"><div class="l">Espèces sorties</div><div class="v out">−${fmtN(cashOut)}</div></div>
    <div class="stat"><div class="l">Banque entrées</div><div class="v in">+${fmtN(bankIn)}</div></div>
    <div class="stat"><div class="l">Banque sorties</div><div class="v out">−${fmtN(bankOut)}</div></div>
  </div>
  <div class="grid">
    <div class="stat"><div class="l">Recettes</div><div class="v in">+${fmtN(income)}</div></div>
    <div class="stat"><div class="l">Dépenses</div><div class="v out">−${fmtN(expense)}</div></div>
    <div class="stat"><div class="l">Apports propriétaire</div><div class="v in">+${fmtN(ownerContrib)}</div></div>
    <div class="stat"><div class="l">Prélèvements propriétaire</div><div class="v out">−${fmtN(ownerDraw)}</div></div>
  </div>
  <h2>Détail des mouvements</h2>
  <table>
    <thead><tr><th>Date</th><th>Type</th><th>Libellé</th><th>Catégorie</th><th>Mode</th><th>Montant</th></tr></thead>
    <tbody>${tableRows}</tbody>
  </table>`;

  return c.html(reportShell(`Rapport solde & mouvements`, settings?.company_name || 'Atlas Commerce', label, body, settings?.report_footer || settings?.notes));
});

app.get('/api/reports/stock', async (c) => {
  await ensureStockLocations(c.env.DB);
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const cur = settings?.currency || 'MAD';
  const locParam = c.req.query('location_id') || '';
  // Carry forward short-lived report ticket (and legacy token) so warehouse form submits stay authorized
  let rt = c.req.query('rt') || '';
  const token = c.req.query('token') || '';
  if (!rt) {
    try { rt = await mintReportLinkTicket(c.env); } catch { rt = ''; }
  }

  const locs = await c.env.DB.prepare(
    `SELECT id, code, name, is_default FROM stock_locations WHERE COALESCE(is_active,1)=1 ORDER BY COALESCE(is_default,0) DESC, name`
  ).all();
  const locations = (locs.results || []) as any[];

  // Ask for warehouse if not specified
  if (!locParam) {
    const opts = locations.map((l: any) =>
      `<option value="${l.id}">${l.name || l.code}${l.is_default ? ' (défaut)' : ''}</option>`
    ).join('');
    const esc = (s: string) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    let formOrigin = '';
    try { formOrigin = new URL(c.req.url).origin; } catch { formOrigin = ''; }
    const body = `
    <div class="actions" style="margin-bottom:20px">
      <form method="get" action="${formOrigin}/api/reports/stock" style="display:flex;flex-wrap:wrap;gap:12px;align-items:end">
        <input type="hidden" name="rt" value="${esc(rt)}" />
        ${token ? `<input type="hidden" name="token" value="${esc(token)}" />` : ''}
        <div>
          <label style="display:block;font-size:11px;text-transform:uppercase;margin-bottom:4px">Entrepôt / magasin</label>
          <select name="location_id" style="padding:8px 12px;font-size:14px;min-width:220px">
            <option value="all">Tous les emplacements (total)</option>
            ${opts}
          </select>
        </div>
        <button type="submit">Générer le rapport</button>
      </form>
    </div>
    <p class="muted">Choisissez un magasin pour valoriser le stock de cet emplacement uniquement, ou « Tous » pour le total produit.</p>`;
    return c.html(reportShell(
      'Rapport stock — choisir l’entrepôt',
      settings?.company_name || 'Atlas Commerce',
      'Sélectionnez le magasin avant impression',
      body,
      settings?.report_footer || settings?.notes,
    ));
  }

  let products: any[] = [];
  let locLabel = 'Tous les emplacements';
  if (locParam !== 'all' && Number(locParam) > 0) {
    const loc = locations.find((l: any) => Number(l.id) === Number(locParam));
    locLabel = loc ? `${loc.name} (${loc.code})` : `Emplacement #${locParam}`;
    const r = await c.env.DB.prepare(
      `SELECT p.id, p.sku, p.name, p.category, p.cost, p.price, p.track_inventory, p.low_stock_threshold,
              COALESCE(q.quantity, 0) as stock_quantity
       FROM products p
       LEFT JOIN stock_location_qty q ON q.product_id = p.id AND q.location_id = ?
       WHERE p.is_active = 1
       ORDER BY COALESCE(p.category, 'zzz'), p.name`
    ).bind(Number(locParam)).all();
    products = (r.results || []) as any[];
  } else {
    const r = await c.env.DB.prepare(
      `SELECT id, sku, name, category, cost, price, stock_quantity, track_inventory, low_stock_threshold
       FROM products WHERE is_active = 1 ORDER BY COALESCE(category, 'zzz'), name`
    ).all();
    products = (r.results || []) as any[];
  }

  const groups = new Map<string, any[]>();
  for (const p of products) {
    const cat = (p.category && String(p.category).trim()) || 'Sans catégorie';
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(p);
  }

  let costTotal = 0, sellTotal = 0, lowCount = 0, qtyTotal = 0;
  const sections: string[] = [];
  let catIndex = 0;

  for (const [cat, list] of groups) {
    catIndex++;
    let catCost = 0, catSell = 0, catQty = 0, catLow = 0;
    const rows = list.map((p) => {
      const qty = Number(p.stock_quantity || 0);
      const cost = Number(p.cost || 0);
      const price = Number(p.price || 0);
      const costVal = qty * cost;
      const sellVal = qty * price;
      const gain = sellVal - costVal;
      costTotal += costVal;
      sellTotal += sellVal;
      catCost += costVal;
      catSell += sellVal;
      if (p.track_inventory) {
        catQty += qty;
        qtyTotal += qty;
      }
      const low = p.track_inventory && qty <= Number(p.low_stock_threshold || 0);
      if (low) { lowCount++; catLow++; }
      return `<tr class="${low ? 'low' : ''}">
        <td>${p.sku || '—'}</td>
        <td><strong>${p.name || ''}</strong>${low ? ' <span class="badge-low">Stock bas</span>' : ''}</td>
        <td class="num">${p.track_inventory ? qty : '—'}</td>
        <td class="num">${fmtN(cost)}</td>
        <td class="num">${fmtN(price)}</td>
        <td class="num">${fmtN(costVal)}</td>
        <td class="num">${fmtN(sellVal)}</td>
        <td class="num ${gain >= 0 ? 'in' : 'out'}">${fmtN(gain)}</td>
      </tr>`;
    }).join('');
    const catMargin = catSell - catCost;
    const marginPct = catCost > 0 ? ((catMargin / catCost) * 100).toFixed(1) : '—';

    sections.push(`
    <div class="cat-block">
      <h2 class="cat-title">
        <span>${catIndex}. ${cat}</span>
        <span class="cat-meta">${list.length} réf. · Qté ${fmtN(catQty)}</span>
      </h2>
      <table>
        <thead><tr>
          <th>Réf.</th><th>Produit</th><th class="num">Qté</th>
          <th class="num">Coût unit.</th><th class="num">Prix unit.</th>
          <th class="num">Valeur coût</th><th class="num">Valeur vente</th><th class="num">Marge</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="cat-totals">
        <div class="ct">Qté totale<strong>${fmtN(catQty)}</strong></div>
        <div class="ct">Total coût<strong>${fmtN(catCost)} ${cur}</strong></div>
        <div class="ct">Total vente<strong>${fmtN(catSell)} ${cur}</strong></div>
        <div class="ct">Marge catégorie<strong class="${catMargin >= 0 ? 'in' : 'out'}">${fmtN(catMargin)} ${cur} <span class="muted">(${marginPct}%)</span></strong></div>
      </div>
      ${catLow ? `<p class="muted" style="margin:6px 0 0">${catLow} alerte(s) stock bas dans cette catégorie</p>` : ''}
    </div>`);
  }

  const gainTotal = sellTotal - costTotal;
  // Always carry rt (short-lived report ticket). Never open unauthenticated /api/reports/stock.
  if (!rt) {
    try { rt = await mintReportLinkTicket(c.env); } catch { /* */ }
  }
  const changeQs = new URLSearchParams();
  if (rt) changeQs.set('rt', rt);
  if (token) changeQs.set('token', token);
  // Absolute URL: report tab is often about:blank after document.write
  let origin = '';
  try { origin = new URL(c.req.url).origin; } catch { origin = ''; }
  const changeLink = `${origin}/api/reports/stock?${changeQs.toString()}`;
  const body = `
  <p class="muted" style="margin:0 0 8px">Entrepôt : <strong>${locLabel}</strong>
    · <a href="${changeLink}">Changer</a></p>
  <div class="grid grid-4">
    <div class="stat"><div class="l">Valeur au coût</div><div class="v">${fmtN(costTotal)} ${cur}</div></div>
    <div class="stat"><div class="l">Valeur à la vente</div><div class="v">${fmtN(sellTotal)} ${cur}</div></div>
    <div class="stat"><div class="l">Marge potentielle</div><div class="v ${gainTotal >= 0 ? 'in' : 'out'}">${fmtN(gainTotal)} ${cur}</div></div>
    <div class="stat"><div class="l">Alertes stock bas</div><div class="v ${lowCount ? 'out' : ''}">${lowCount}</div></div>
  </div>
  <p class="muted" style="margin-bottom:16px">${products.length} références · ${groups.size} catégorie(s) · Qté ${fmtN(qtyTotal)}</p>
  ${sections.join('') || '<p>Aucun produit actif sur cet emplacement.</p>'}`;

  return c.html(reportShell(
    'Rapport stock par catégories',
    settings?.company_name || 'Atlas Commerce',
    `Inventaire valorisé · ${locLabel}`,
    body,
    settings?.report_footer || settings?.notes,
  ));
});


app.get('/api/reports/receivables', async (c) => {
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const cur = settings?.currency || 'MAD';
  const { results } = await c.env.DB.prepare(
    `SELECT id, number, client_name, issue_date, due_date, total, amount_paid, status
     FROM invoices WHERE status IN ('sent', 'partial', 'overdue', 'draft') AND status != 'quote'
     ORDER BY due_date ASC NULLS LAST, issue_date ASC`
  ).all();
  const rows = (results || []) as any[];
  let total = 0;
  const table = rows.map((inv) => {
    const rest = Number(inv.total || 0) - Number(inv.amount_paid || 0);
    total += rest;
    return `<tr>
      <td>${inv.number || ''}</td>
      <td>${inv.client_name || ''}</td>
      <td>${inv.issue_date || ''}</td>
      <td>${inv.due_date || '—'}</td>
      <td>${inv.status || ''}</td>
      <td class="out">${fmtN(rest)} ${cur}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="6">Aucune créance</td></tr>`;

  const body = `
  <div class="grid">
    <div class="stat"><div class="l">Total à recevoir</div><div class="v out">${fmtN(total)} ${cur}</div></div>
    <div class="stat"><div class="l">Factures</div><div class="v">${rows.length}</div></div>
  </div>
  <h2>Factures de vente impayées</h2>
  <table>
    <thead><tr><th>N°</th><th>Client</th><th>Émission</th><th>Échéance</th><th>Statut</th><th>Reste dû</th></tr></thead>
    <tbody>${table}</tbody>
  </table>`;
  return c.html(reportShell('Rapport créances clients', settings?.company_name || 'Atlas Commerce', 'À encaisser', body, settings?.report_footer || settings?.notes));
});

app.get('/api/reports/payables', async (c) => {
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const cur = settings?.currency || 'MAD';
  const { results } = await c.env.DB.prepare(
    `SELECT id, number, vendor_name, issue_date, due_date, total, amount_paid, status
     FROM bills WHERE status IN ('sent', 'partial', 'draft')
     ORDER BY due_date ASC NULLS LAST, issue_date ASC`
  ).all();
  const rows = (results || []) as any[];
  let total = 0;
  const table = rows.map((b) => {
    const rest = Number(b.total || 0) - Number(b.amount_paid || 0);
    total += rest;
    return `<tr>
      <td>${b.number || ''}</td>
      <td>${b.vendor_name || ''}</td>
      <td>${b.issue_date || ''}</td>
      <td>${b.due_date || '—'}</td>
      <td>${b.status || ''}</td>
      <td class="out">${fmtN(rest)} ${cur}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="6">Aucune dette</td></tr>`;

  const body = `
  <div class="grid">
    <div class="stat"><div class="l">Total à payer</div><div class="v out">${fmtN(total)} ${cur}</div></div>
    <div class="stat"><div class="l">Factures d'achat</div><div class="v">${rows.length}</div></div>
  </div>
  <h2>Factures d'achat impayées</h2>
  <table>
    <thead><tr><th>N°</th><th>Fournisseur</th><th>Émission</th><th>Échéance</th><th>Statut</th><th>Reste dû</th></tr></thead>
    <tbody>${table}</tbody>
  </table>`;
  return c.html(reportShell('Rapport dettes fournisseurs', settings?.company_name || 'Atlas Commerce', 'À régler', body, settings?.report_footer || settings?.notes));
});


/** LLM assistant — Groq only. Key: GROQ_API_KEY on Worker. */


/** Store one Atlas Agent turn on R2 (JSON) — avoids heavy D1 rows for chat history. */
/**
 * Atlas Agent conversation on R2 (not D1).
 * One encrypted file per conversation: agent-chats/v2/{user}/{threadId}.conv
 * Format after decrypt: plain lines (not JSON)
 *   U|ISO|user text
 *   A|ISO|assistant text
 * Encrypted with AES-GCM jeton derived from BACKUP_ENCRYPTION_KEY / ADMIN_BACKUP_TOKEN
 * (same family as .abk backups) so files are opaque on R2 and included in backup key listing.
 */

/** Delete Atlas Agent conversation blobs older than `days` (default 30) from R2. */
async function purgeAgentConversationsOlderThan(env: any, days = 30): Promise<{ deleted: number }> {
  let deleted = 0;
  if (!env?.IMAGES) return { deleted: 0 };
  const cutoff = Date.now() - Math.max(1, days) * 86400000;
  const prefixes = ['agent/', 'agent-chats/'];
  for (const prefix of prefixes) {
    try {
      let cursor: string | undefined;
      do {
        const listed = await env.IMAGES.list({ prefix, limit: 100, cursor });
        for (const o of listed.objects || []) {
          const uploaded = o.uploaded ? new Date(o.uploaded).getTime() : 0;
          if (uploaded && uploaded < cutoff) {
            try {
              await env.IMAGES.delete(o.key);
              deleted++;
            } catch { /* */ }
          }
        }
        cursor = listed.truncated;
      } while (cursor);
    } catch (e) {
      console.error('purgeAgentConversations', prefix, e);
    }
  }
  return { deleted };
}

async function agentChatCryptoKey(env: any): Promise<CryptoKey | null> {
  const secret = String(
    (env as any).AGENT_CHAT_SECRET ||
    (env as any).BACKUP_ENCRYPTION_KEY ||
    (env as any).ADMIN_BACKUP_TOKEN ||
    '',
  ).trim();
  if (!secret) {
    // deterministic weak fallback only for continuity — prefer setting a secret
    const raw = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode('atlas-agent-chat-fallback-v1'),
    );
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }
  const raw = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode('atlas-agent-chat-v2:' + secret),
  );
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptAgentConv(env: any, plainText: string): Promise<Uint8Array | null> {
  const key = await agentChatCryptoKey(env);
  if (!key) return null;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plainText),
  );
  const magic = new TextEncoder().encode('ACH2');
  const out = new Uint8Array(4 + 12 + ct.byteLength);
  out.set(magic, 0);
  out.set(iv, 4);
  out.set(new Uint8Array(ct), 16);
  return out;
}

async function decryptAgentConv(env: any, bytes: ArrayBuffer | Uint8Array): Promise<string | null> {
  try {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8.length < 20) return null;
    const magic = new TextDecoder().decode(u8.slice(0, 4));
    if (magic !== 'ACH2') {
      // legacy JSON single-turn — return as opaque marker
      try {
        return new TextDecoder().decode(u8);
      } catch {
        return null;
      }
    }
    const key = await agentChatCryptoKey(env);
    if (!key) return null;
    const iv = u8.slice(4, 16);
    const ct = u8.slice(16);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

function agentConvKey(username: string, threadId: string): string {
  const u = String(username || 'anon').replace(/[^a-zA-Z0-9._@-]/g, '_').slice(0, 64);
  const t = String(threadId || 'live').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  return `agent-chats/v2/${u}/${t}.conv`;
}

/* v233 — token-cheap conversation memory: last turns, heavily truncated, from the encrypted R2 transcript */
async function loadCompactHistory(env: Env, username: string, thread: string, maxTurns = 6): Promise<string> {
  if (!env.IMAGES) return '';
  try {
    const obj = await env.IMAGES.get(agentConvKey(username, thread));
    if (!obj) return '';
    const buf = await obj.arrayBuffer();
    const plain = await decryptAgentConv(env, buf);
    if (!plain || plain.trimStart().startsWith('{')) return '';
    const lines = plain.split('\n').filter((l) => l.startsWith('U|') || l.startsWith('A|'));
    if (!lines.length) return '';
    return lines
      .slice(-maxTurns * 2)
      .map((l) => {
        const parts = l.split('|');
        const who = parts[0] === 'U' ? 'U' : 'A';
        const txt = String(parts.slice(2).join('|')).trim();
        return `${who}: ${txt.slice(0, who === 'U' ? 160 : 200)}`;
      })
      .join('\n');
  } catch { return ''; }
}

async function putAgentChatTurn(
  env: Env,
  row: {
    username: string;
    role: string;
    message: string;
    reply: string;
    tools?: string;
    model?: string;
    thread_id?: string;
  },
) {
  try {
    if (!env.IMAGES) return;
    const thread = row.thread_id || 'live';
    const key = agentConvKey(row.username, thread);
    const ts = new Date().toISOString();
    const userLine = `U|${ts}|${String(row.message || '').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 4000)}`;
    const asstLine = `A|${ts}|${String(row.reply || '').replace(/\|/g, '/').replace(/\n/g, ' ').slice(0, 8000)}`;
    let body = '';
    try {
      const existing = await env.IMAGES.get(key);
      if (existing) {
        const buf = await existing.arrayBuffer();
        const prev = await decryptAgentConv(env, buf);
        if (prev && !prev.trimStart().startsWith('{')) body = prev;
      }
    } catch { /* */ }
    if (body && !body.endsWith('\n')) body += '\n';
    body += userLine + '\n' + asstLine + '\n';
    // Cap file size (~400KB plain) — drop oldest lines
    const maxChars = 400_000;
    if (body.length > maxChars) {
      const lines = body.split('\n');
      while (lines.join('\n').length > maxChars && lines.length > 4) lines.shift();
      body = lines.join('\n');
      if (!body.endsWith('\n')) body += '\n';
    }
    const enc = await encryptAgentConv(env, body);
    if (!enc) return;
    await env.IMAGES.put(key, enc, {
      httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store' },
      customMetadata: {
        username: String(row.username).slice(0, 64),
        thread: String(thread).slice(0, 80),
        fmt: 'ACH2',
        role: String(row.role || '').slice(0, 32),
      },
    });
  } catch {
    /* never break chat */
  }
}

/** List recent Atlas Agent transcripts from R2 (owner/admin or own user) */
app.get('/api/assist/transcripts', async (c) => {
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  if (!session.username) return c.json({ success: false, error: 'Non authentifié' }, 401);
  if (!c.env.IMAGES) return c.json({ success: true, data: [], meta: { note: 'R2 indisponible' } });
  const isAdmin = session.role === 'owner' || session.role === 'admin';
  const userFilter = (c.req.query('username') || session.username).slice(0, 64);
  if (!isAdmin && userFilter !== session.username) {
    return c.json({ success: false, error: 'Interdit' }, 403);
  }
  const prefixes = [`agent-chats/v2/${userFilter}/`, `agent-chats/${userFilter}/`];
  try {
    const items: any[] = [];
    const seen = new Set<string>();
    for (const prefix of prefixes) {
      const listed = await c.env.IMAGES.list({ prefix, limit: 50 });
      for (const o of listed.objects || []) {
        if (seen.has(o.key)) continue;
        seen.add(o.key);
        items.push({ key: o.key, size: o.size, uploaded: o.uploaded, fmt: String(o.key).endsWith('.conv') ? 'ACH2' : 'legacy' });
      }
    }
    items.sort((a, b) => String(b.uploaded || '').localeCompare(String(a.uploaded || '')));
    return c.json({ success: true, data: items.slice(0, 50) });
  } catch (e: any) {
    return c.json({ success: false, error: e?.message || 'R2 list failed' }, 500);
  }
});

app.get('/api/assist/transcripts/get', async (c) => {
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  if (!session.username) return c.json({ success: false, error: 'Non authentifié' }, 401);
  if (!c.env.IMAGES) return c.json({ success: false, error: 'R2 indisponible' }, 503);
  const key = String(c.req.query('key') || '');
  if (!key.startsWith('agent-chats/')) return c.json({ success: false, error: 'Clé invalide' }, 400);
  const isAdmin = session.role === 'owner' || session.role === 'admin';
  if (!isAdmin && !key.startsWith(`agent-chats/${session.username}/`) && !key.startsWith(`agent-chats/v2/${session.username}/`)) {
    return c.json({ success: false, error: 'Interdit' }, 403);
  }
  const obj = await c.env.IMAGES.get(key);
  if (!obj) return c.json({ success: false, error: 'Introuvable' }, 404);
  try {
    if (key.endsWith('.conv')) {
      const buf = await obj.arrayBuffer();
      const plain = await decryptAgentConv(c.env, buf);
      if (plain == null) return c.json({ success: false, error: 'Déchiffrement impossible (jeton?)' }, 500);
      const turns = plain.split('\n').filter(Boolean).map((line) => {
        const [kind, ts, ...rest] = line.split('|');
        return { role: kind === 'A' ? 'assistant' : 'user', ts: ts || '', text: rest.join('|') };
      });
      return c.json({ success: true, data: { key, format: 'ACH2', turns, raw: plain } });
    }
    const text = await obj.text();
    try {
      return c.json({ success: true, data: { key, format: 'legacy-json', ...JSON.parse(text) } });
    } catch {
      return c.json({ success: true, data: { key, format: 'text', raw: text } });
    }
  } catch (e: any) {
    return c.json({ success: false, error: e?.message || 'Lecture R2' }, 500);
  }
});

app.post('/api/assist/chat', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: tr(pickUiLang(c.req.header('Accept-Language')), 'auth_required') }, 401);
  }
  const session = sessionUserFromHeader(authHeader);
  const role = normalizeRole(session.role || 'user');
  const username = String(session.username || 'user');
  // v0.7 — stable error messages localized from Accept-Language (fr/en/ar).
  const uiLang = pickUiLang(c.req.header('Accept-Language'));

  // Atlas Agent: Groq only (Mistral/Gemini removed from product).
  let provider = 'groq' as const;
  const groqKey = String((c.env as any).GROQ_API_KEY || '').trim();
  if (!groqKey) {
    return c.json({
      success: false,
      error: tr(uiLang, 'agent_no_key'),
      code: 'no_key',
    }, 503);
  }

  let body: any = {};
  try { body = await c.req.json(); } catch { body = {}; }
  const message = String(body.message || body.prompt || '').trim().slice(0, 2500);
  // v232 — attached images travel to the vision model as data-URL parts
  const images = Array.isArray(body.images)
    ? body.images.filter((x: any) => typeof x === 'string' && x.startsWith('data:image/')).slice(0, 4).map((x: string) => x.slice(0, 3_500_000))
    : [];
  if (!message) return c.json({ success: false, error: tr(uiLang, 'message_empty') }, 400);
  // v264 — server-side access verdict: blocked accounts and exhausted token
  // quotas are refused HERE (until now the check lived only in the SPA).
  const verdict = await agentAccessVerdict(c.env, c.env.DB, username, role);
  if (!verdict.ok) return c.json(verdict.payload, verdict.status as 403);
  // v264 — bounded, MIME-validated document extraction (PDF/text). A rejected
  // document fails the WHOLE request with stable codes — never silently dropped.
  const docsRes = await parseAgentDocumentsAsync((body as any).documents);
  if (!docsRes.ok) {
    return c.json({ success: false, error: docsRes.errors[0]?.error || 'Document refusé', code: 'DOC_INVALID', details: docsRes.errors }, 400);
  }
  const docSection = agentDocumentPromptSection(docsRes.docs);
  const docsMeta = docsRes.docs.map((d) => ({ name: d.name, mime: d.mime, kind: d.kind, pages: d.pages, chars: d.chars, truncated: d.truncated, extraction: d.extraction }));
  // Raw user text (without page template) — used for local shortcuts only
  const userMessage = String(body.user_message || body.userMessage || '').trim().slice(0, 2500) || message;

  const task = String(body.task || 'general').toLowerCase();
  // v0.7 — client-selected response language (Android app language): allowlisted
  // here, enforced in the shared system prompt below. Unknown/absent → legacy rule.
  const responseLanguage = normalizeResponseLanguage((body as any).response_language ?? (body as any).responseLanguage);

  // Greetings / small-talk → always LLM (never canned page tips)
  const isGreeting = /^(bonjour|bonsoir|salut|hello|hi|hey|coucou|salam|bonne\s*(journée|soirée)|merci)[\s!.?]*$/i.test(
    userMessage.trim(),
  );

  // Deterministic short answers with live D1 data — only on the raw user message,
  // and only when French is acceptable (the canned hints are French; en/ar go
  // through the LLM so quick prompts honor the selected language too).
  if (!isGreeting && (task === 'general' || !task) && (responseLanguage === null || responseLanguage === 'fr')) {
    try {
      const snap = await loadQuickSnap(c.env);
      const quick = quickAssistHint(userMessage, snap);
      if (quick) {
        return c.json({
          success: true,
          data: { reply: quick, model: 'local', provider: 'local', tool_trace: [], proposals: [], task },
        });
      }
    } catch { /* fall through to LLM */ }
  }

  const tz = String(body.timezone || body.tz || 'Africa/Casablanca').slice(0, 64);
  const source = String(body.source || body.client || c.req.header('x-atlas-client') || 'web').slice(0, 32);
  const sourceRefined = source;
  const model = String(body.model || (c.env as any).GROQ_MODEL || 'openai/gpt-oss-20b').slice(0, 80);
  const threadId = String((body as any)?.thread_id || (body as any)?.threadId || 'live').slice(0, 80);

  try {
    const system = atlasAgentSystem({ role, username, timezone: tz, source: sourceRefined, responseLanguage });
    // v233 — compact memory: the agent reads its recent conversation without replaying full turns
    const history = await loadCompactHistory(c.env, username, threadId, 6);
    const finalMessage = (history
      ? `Historique récent de la conversation (contexte uniquement — ne pas recopier):\n${history}\n\n${message}`
      : message) + docSection;
    const outGq = await groqChat({
      apiKey: groqKey,
      model: images.length ? '' : model,
      system,
      message: finalMessage,
      maxTokens: images.length ? 1200 : isGreeting ? 300 : 700,
      images,
    });
    const replyGq = scrubVendorNames(String(outGq.reply || '').trim());
    // v233 — charge REAL tokens (prompt+completion) server-side instead of client guesses
    const usedTokens = Math.max(0, Number(outGq.usage?.prompt || 0) + Number(outGq.usage?.completion || 0));
    if (usedTokens > 0 && role !== 'owner' && role !== 'admin') {
      try { await agentQuotaAdd(c.env, c.env.DB, username, usedTokens); } catch { /* quota best-effort */ }
    }
    await auditAssist(c.env, { username, role, message, tools: 'groq', ok: true });
    await putAgentChatTurn(c.env, {
      username, role, message, reply: replyGq, tools: 'groq', model: outGq.model, thread_id: threadId,
    });
    await writeAudit(c.env.DB, {
      username, role, action: 'assist.chat', entity: 'atlas_agent', detail: 'groq', ip: clientIp(c),
    });
    return c.json({
      success: true,
      data: {
        reply: replyGq,
        model: outGq.model,
        provider: 'groq',
        usage: outGq.usage || null,
        history_turns: history ? history.split('\n').length : 0,
        documents: docsMeta,
        tool_trace: [],
        proposals: [],
        task,
      },
    });
  } catch (e: any) {
    await auditAssist(c.env, { username, role, message, tools: 'error', ok: false });
    return c.json({ success: false, error: tr(uiLang, 'agent_upstream'), code: 'assist_upstream' }, 502);
  }
});

/* v264 — SSE streaming twin of POST /api/assist/chat. Identical gates
 * (verified session, server-side blocked/quota verdict, bounded MIME-validated
 * documents); tokens stream as `event: token`, the turn ends with `event: done`
 * (full reply + model + REAL usage + document metadata) or `event: error`.
 * Quota is charged from the real usage of the final Groq chunk — a streamed
 * turn costs exactly what a buffered turn costs. Turns WITH images take the
 * buffered vision path and arrive as a single token event. */
app.post('/api/assist/chat/stream', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: tr(pickUiLang(c.req.header('Accept-Language')), 'auth_required') }, 401);
  }
  const session = sessionUserFromHeader(authHeader);
  const role = normalizeRole(session.role || 'user');
  const username = String(session.username || 'user');
  // v0.7 — same localized stable messages as the buffered twin.
  const uiLang = pickUiLang(c.req.header('Accept-Language'));
  const groqKey = String((c.env as any).GROQ_API_KEY || '').trim();
  if (!groqKey) {
    return c.json({ success: false, error: tr(uiLang, 'agent_no_key'), code: 'no_key' }, 503);
  }
  let body: any = {};
  try { body = await c.req.json(); } catch { body = {}; }
  const message = String(body.message || body.prompt || '').trim().slice(0, 2500);
  if (!message) return c.json({ success: false, error: tr(uiLang, 'message_empty') }, 400);
  const images = Array.isArray(body.images)
    ? body.images.filter((x: any) => typeof x === 'string' && x.startsWith('data:image/')).slice(0, 4).map((x: string) => x.slice(0, 3_500_000))
    : [];
  const verdict = await agentAccessVerdict(c.env, c.env.DB, username, role);
  if (!verdict.ok) return c.json(verdict.payload, verdict.status as 403);
  const docsRes = await parseAgentDocumentsAsync(body.documents);
  if (!docsRes.ok) {
    return c.json({ success: false, error: docsRes.errors[0]?.error || 'Document refusé', code: 'DOC_INVALID', details: docsRes.errors }, 400);
  }
  const docSection = agentDocumentPromptSection(docsRes.docs);
  const docsMeta = docsRes.docs.map((d) => ({ name: d.name, mime: d.mime, kind: d.kind, pages: d.pages, chars: d.chars, truncated: d.truncated, extraction: d.extraction }));

  const tz = String(body.timezone || body.tz || 'Africa/Casablanca').slice(0, 64);
  const source = String(body.source || body.client || c.req.header('x-atlas-client') || 'web').slice(0, 32);
  const model = String(body.model || (c.env as any).GROQ_MODEL || 'openai/gpt-oss-20b').slice(0, 80);
  const threadId = String(body?.thread_id || body?.threadId || 'live').slice(0, 80);
  // v0.7 — same allowlisted response_language as the buffered twin (stream +
  // vision fallback share this `system` prompt).
  const responseLanguage = normalizeResponseLanguage(body.response_language ?? body.responseLanguage);

  const enc = new TextEncoder();
  const sseStream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try { controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); } catch { /* client gone */ }
      };
      try {
        const system = atlasAgentSystem({ role, username, timezone: tz, source, responseLanguage });
        const history = await loadCompactHistory(c.env, username, threadId, 6);
        const finalMessage = (history
          ? `Historique récent de la conversation (contexte uniquement — ne pas recopier):\n${history}\n\n${message}`
          : message) + docSection;
        let reply = '';
        let usedModel = model;
        let usage: { prompt: number; completion: number } | undefined;
        if (images.length) {
          // Buffered vision fallback — the whole reply arrives as one token event.
          const out = await groqChat({ apiKey: groqKey, model: '', system, message: finalMessage, maxTokens: 1200, images });
          reply = scrubVendorNames(String(out.reply || '').trim());
          usedModel = out.model;
          usage = out.usage;
          if (reply) send('token', { t: reply });
        } else {
          const out = await groqChatStream({
            apiKey: groqKey,
            model,
            system,
            message: finalMessage,
            maxTokens: 700,
            onToken: (delta) => send('token', { t: delta }),
          });
          reply = scrubVendorNames(out.reply);
          usedModel = out.model;
          usage = out.usage;
        }
        const usedTokens = Math.max(0, Number(usage?.prompt || 0) + Number(usage?.completion || 0));
        if (usedTokens > 0 && role !== 'owner' && role !== 'admin') {
          try { await agentQuotaAdd(c.env, c.env.DB, username, usedTokens); } catch { /* quota best-effort */ }
        }
        await auditAssist(c.env, { username, role, message, tools: 'groq-stream', ok: true });
        await putAgentChatTurn(c.env, {
          username, role, message, reply, tools: 'groq-stream', model: usedModel, thread_id: threadId,
        });
        await writeAudit(c.env.DB, {
          username, role, action: 'assist.chat.stream', entity: 'atlas_agent', detail: 'groq', ip: clientIp(c),
        });
        send('done', { reply, model: usedModel, provider: 'groq', usage: usage || null, documents: docsMeta, thread_id: threadId });
      } catch (e: any) {
        try { await auditAssist(c.env, { username, role, message, tools: 'error', ok: false }); } catch { /* */ }
        send('error', { code: 'assist_upstream', error: tr(uiLang, 'agent_upstream') });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });
  return new Response(sseStream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});


/** Ranked “what should I do next” — mostly deterministic, optional AI polish later */
app.get('/api/assist/next-actions', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Authentification requise.' }, 401);
  }
  const session = sessionUserFromHeader(authHeader);
  const role = normalizeRole(session.role || 'user');
  try {
    const items = await buildNextActions(c.env, role);
    return c.json({ success: true, data: { items } }, 200, { 'Cache-Control': 'private, max-age=15' });
  } catch (e: any) {
    return c.json({ success: false, error: e?.message || 'Erreur' }, 500);
  }
});

/** Approve a proposed action (inventory adjustment → mobile_actions pending for PC) */

async function notifyAssistApproval(env: Env, username: string, title: string, body: string, data?: Record<string, string>) {
  return fcmNotifyAssistApproval(env as any, username, title, body, data);
}




/** Register Android FCM device token (upsert into D1). */
// v0.7 — extracted to worker/routes/deviceToken.ts (safe error codes, tested)
registerDeviceTokenRoutes(app, sessionUserFromHeader);


app.post('/api/assist/approve', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Authentification requise.' }, 401);
  }
  const session = sessionUserFromHeader(authHeader);
  const role = normalizeRole(session.role || 'user');
  if (!canMutateBusiness(role) && role !== 'stock') {
    return c.json({ success: false, error: 'Rôle non autorisé.' }, 403);
  }

  let body: any = {};
  try { body = await c.req.json(); } catch { body = {}; }
  const proposalId = String(body.proposal_id || '').trim();
  if (!proposalId || !c.env.CACHE) {
    return c.json({ success: false, error: 'proposal_id requis (ou CACHE indisponible).' }, 400);
  }
  const raw = await c.env.CACHE.get(`assist_prop:${proposalId}`);
  if (!raw) return c.json({ success: false, error: 'Proposition expirée ou inconnue.' }, 404);
  let prop: any = {};
  try { prop = JSON.parse(raw); } catch {
    return c.json({ success: false, error: 'Proposition invalide.' }, 400);
  }

  if (prop.type === 'inventory_adjustment') {
    // Queue as pending mobile action for PC desk (same pattern as phone proposals)
    try {
      const payload = JSON.stringify({
        source: 'assist',
        product_id: prop.product_id,
        sku: prop.sku,
        delta: prop.delta,
        note: prop.note,
        product_name: prop.product_name,
      });
      await c.env.DB.prepare(
        `INSERT INTO mobile_actions (type, status, payload, created_at, created_by)
         VALUES ('stock_adjust_propose', 'pending', ?, datetime('now'), ?)`,
      )
        .bind(payload, String(session.username || 'assist'))
        .run();
    } catch (e: any) {
      // schema may differ — try minimal columns
      try {
        await c.env.DB.prepare(
          `INSERT INTO mobile_actions (type, status, payload, created_at)
           VALUES ('stock_adjust_propose', 'pending', ?, datetime('now'))`,
        )
          .bind(JSON.stringify(prop))
          .run();
      } catch (e2: any) {
        return c.json({ success: false, error: e2?.message || e?.message || 'Insert action échoué' }, 500);
      }
    }
    await c.env.CACHE.delete(`assist_prop:${proposalId}`);
    try {
      await notifyAssistApproval(
        c.env,
        String(session.username || ''),
        'Atlas Agent',
        'Une proposition assistant a été traitée — ouvrez Boîte d’actions.',
        {
          type: 'assist_approval',
          action_id: String(proposalId || ''),
        },
      );
    } catch { /* */ }
    try { await syncMobileHub(c.env); } catch { /* */ }
    return c.json({
      success: true,
      data: {
        queued: true,
        message: 'Ajustement proposé — visible dans la boîte d’actions jusqu’à validation PC.',
      },
    });
  }

  return c.json({ success: false, error: 'Type de proposition non supporté.' }, 400);
});


app.post('/api/push/register', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Authentification requise.' }, 401);
  }
  const session = sessionUserFromHeader(authHeader);
  const body = await c.req.json().catch(() => ({}));
  const token = String(body.token || '').trim().slice(0, 512);
  if (!token) return c.json({ success: false, error: 'token requis' }, 400);
  const platform = String(body.platform || 'android').slice(0, 32);
  try {
    await c.env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS push_tokens (
        token TEXT PRIMARY KEY,
        username TEXT,
        platform TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )`
    ).run();
    await c.env.DB.prepare(
      `INSERT INTO push_tokens (token, username, platform, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(token) DO UPDATE SET username = excluded.username, platform = excluded.platform, updated_at = datetime('now')`
    ).bind(token, String(session.username || ''), platform).run();
  } catch (e: any) {
    return c.json({ success: false, error: e?.message || 'push register failed' }, 500);
  }
  return c.json({ success: true, data: { registered: true }, message: 'Jeton enregistré (FCM envoi: secret FCM_SERVER_KEY optionnel).' });
});

app.get('/api/assist/status', async (c) => {
  const provider = 'groq';
  const groqKey = String((c.env as any).GROQ_API_KEY || '').trim();
  const model = String((c.env as any).GROQ_MODEL || 'openai/gpt-oss-20b');
  const configured = !!groqKey;
  return c.json({
    success: true,
    data: {
      configured,
      provider,
      model,
      groqConfigured: configured,
      mistralConfigured: false,
      geminiConfigured: false,
      hint: configured
        ? 'Assistant IA actif (Groq)'
        : 'Définissez: npx wrangler secret put GROQ_API_KEY',
    },
  });
});

/** Admin: Atlas Agent provider (Groq only). */
app.get('/api/settings/assist-provider', async (c) => {
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  if (!session.username) return c.json({ success: false, error: 'Non authentifié' }, 401);
  const groqConfigured = !!String((c.env as any).GROQ_API_KEY || '').trim();
  return c.json({
    success: true,
    data: {
      provider: 'groq',
      groqConfigured,
      mistralConfigured: false,
      geminiConfigured: false,
    },
  });
});

app.put('/api/settings/assist-provider', async (c) => {
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  if (!session.username) return c.json({ success: false, error: 'Non authentifié' }, 401);
  const role = normalizeRole(session.role || 'user');
  if (role !== 'owner' && role !== 'admin') {
    return c.json({ success: false, error: 'Réservé admin/owner' }, 403);
  }
  let body: any = {};
  try { body = await c.req.json(); } catch { body = {}; }
  const provider = 'groq';
  const providerStore = 'groq';
  try {
    await c.env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT)`
    ).run();
    await c.env.DB.prepare(
      `INSERT INTO app_config (key, value) VALUES ('assist_llm_provider', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).bind(typeof providerStore !== 'undefined' ? providerStore : provider).run();
  } catch (e: any) {
    return c.json({ success: false, error: e?.message || 'DB error' }, 500);
  }
  return c.json({ success: true, data: { provider }, message: `Fournisseur IA: ${provider}` });
});

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
const APP_UPDATE_JSON_KEY = 'app-updates/android/latest.json';
const APP_UPDATE_APK_KEY = 'app-updates/android/latest.apk';
const APP_UPDATE_APK_MIME = 'application/vnd.android.package-archive';

function appUpdateCdnBase(env: any): string {
  return String(env.CDN_BASE || 'https://cdn1.afmarbre.com').replace(/\/+$/, '');
}

/** owner/admin gate shared by the admin app-update routes. */
function gateAppUpdateAdmin(c: any): { ok: true; username: string } | { ok: false; status: number; error: string } {
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  if (!session.username) return { ok: false, status: 401, error: 'Non authentifié' };
  const role = normalizeRole(session.role || 'user');
  if (role !== 'owner' && role !== 'admin') return { ok: false, status: 403, error: 'Réservé admin/owner' };
  return { ok: true, username: session.username };
}

/** Read manifest (R2 first, app_config fallback — same order as public check) + R2 object info. */
async function readAppUpdateState(env: any) {
  let manifest: any = null;
  let source: 'r2' | 'db' | null = null;
  let jsonMeta: { size: number; uploaded: string | null } | null = null;
  if (env.IMAGES) {
    try {
      const head = await env.IMAGES.head(APP_UPDATE_JSON_KEY);
      if (head) jsonMeta = { size: head.size, uploaded: head.uploaded ? new Date(head.uploaded).toISOString() : null };
      const obj = await env.IMAGES.get(APP_UPDATE_JSON_KEY);
      if (obj) { manifest = JSON.parse(await obj.text()); source = 'r2'; }
    } catch { /* */ }
  }
  if (!manifest) {
    try {
      const rows = await env.DB.prepare(`SELECT key, value FROM app_config WHERE key LIKE 'android_update_%'`).all();
      const map: Record<string, string> = {};
      for (const r of (rows?.results || []) as any[]) map[String(r.key)] = String(r.value || '');
      if (map.android_update_version_code || map.android_update_apk_url) {
        manifest = {
          versionCode: Number(map.android_update_version_code || 0),
          versionName: map.android_update_version_name || '',
          apkUrl: map.android_update_apk_url || '',
          mandatory: map.android_update_mandatory === '1' || map.android_update_mandatory === 'true',
          notes: map.android_update_notes || '',
        };
        source = 'db';
      }
    } catch { /* */ }
  }
  let apk: { size: number; uploaded: string | null } | null = null;
  if (env.IMAGES) {
    try {
      const h = await env.IMAGES.head(APP_UPDATE_APK_KEY);
      if (h) apk = { size: h.size, uploaded: h.uploaded ? new Date(h.uploaded).toISOString() : null };
    } catch { /* */ }
  }
  return { manifest, source, jsonMeta, apk };
}

/** Mirror manifest into app_config so the DB fallback never goes stale. */
async function mirrorAppUpdateConfig(db: D1Database, m: any): Promise<void> {
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT)`).run();
    const rows: [string, string][] = [
      ['android_update_version_code', String(Number(m.versionCode || 0))],
      ['android_update_version_name', String(m.versionName || '')],
      ['android_update_apk_url', String(m.apkUrl || '')],
      ['android_update_mandatory', m.mandatory ? '1' : '0'],
      ['android_update_notes', String(m.notes || '')],
    ];
    for (const [k, v] of rows) {
      await db
        .prepare(`INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
        .bind(k, v)
        .run();
    }
  } catch { /* best-effort */ }
}

/** R2 key when the URL is served by our own CDN base; null for external URLs. */
function cdnKeyForUrl(env: any, url: string): string | null {
  const base = appUpdateCdnBase(env);
  const u = String(url || '').trim();
  if (!u.startsWith(base + '/')) return null;
  return decodeURIComponent(u.slice(base.length + 1));
}

/** v0.7 — does the APK the manifest points at actually exist on our CDN?
 * Saving latest.json never uploads the binary: the admin UI must say so. */
async function cdnApkExists(env: any, url: string): Promise<boolean | null> {
  if (!env?.IMAGES) return null;
  const key = cdnKeyForUrl(env, url);
  if (!key) return null;
  try {
    return !!(await env.IMAGES.head(key));
  } catch {
    return null;
  }
}

/** Current manifest + R2 object metadata for the admin UI. */
app.get('/api/admin/app-update', async (c) => {
  const gate = gateAppUpdateAdmin(c);
  if (!gate.ok) return c.json({ success: false, error: gate.error }, gate.status as any);
  const { manifest, source, jsonMeta, apk } = await readAppUpdateState(c.env);
  const base = appUpdateCdnBase(c.env);
  const policy = await readMinVersionPolicy(c.env.DB, { bypassCache: true });
  return c.json({
    success: true,
    data: {
      minimumVersionEnabled: policy.enabled,
      minimumSupportedVersionCode: policy.code,
      manifest: manifest || {
        versionCode: 0,
        versionName: '',
        apkUrl: `${base}/${APP_UPDATE_APK_KEY}`,
        mandatory: false,
        notes: '',
      },
      source,
      json: { key: APP_UPDATE_JSON_KEY, url: `${base}/${APP_UPDATE_JSON_KEY}`, size: jsonMeta?.size ?? null, uploaded: jsonMeta?.uploaded ?? null },
      apk: { key: APP_UPDATE_APK_KEY, url: `${base}/${APP_UPDATE_APK_KEY}`, size: apk?.size ?? null, uploaded: apk?.uploaded ?? null },
      apkUrlExists: await cdnApkExists(c.env, manifest?.apkUrl || ''),
      maxApkBytes: APP_UPDATE_MAX_APK_BYTES,
    },
  });
});

/** Save (create/replace) latest.json on R2 + mirror to app_config. */
app.put('/api/admin/app-update', async (c) => {
  const gate = gateAppUpdateAdmin(c);
  if (!gate.ok) return c.json({ success: false, error: gate.error }, gate.status as any);
  let body: any = {};
  try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'JSON invalide' }, 400); }
  const versionCode = Math.floor(Number(body.versionCode));
  if (!Number.isFinite(versionCode) || versionCode < 1) {
    return c.json({ success: false, error: 'versionCode invalide (entier ≥ 1)' }, 400);
  }
  const versionName = String(body.versionName || '').trim().slice(0, 64);
  if (!versionName) return c.json({ success: false, error: 'versionName obligatoire' }, 400);
  let apkUrl = String(body.apkUrl || '').trim();
  if (!apkUrl) apkUrl = `${appUpdateCdnBase(c.env)}/${APP_UPDATE_APK_KEY}`;
  if (!/^https:\/\/\S+$/i.test(apkUrl)) return c.json({ success: false, error: 'apkUrl doit être une URL https://' }, 400);
  const manifest = {
    versionCode,
    versionName,
    apkUrl,
    mandatory: body.mandatory === true || body.mandatory === 'true' || body.mandatory === 1,
    notes: String(body.notes || '').slice(0, 4000),
  };
  // v0.7 — minimum supported Android version. Keys absent → keep current
  // policy (a manifest rewrite must never drop it). Keys present → validate
  // against the release being saved, then persist (app_config = truth) and
  // mirror into the manifest so the public check echoes it.
  const currentPolicy = await readMinVersionPolicy(c.env.DB, { bypassCache: true });
  const hasPolicyKeys =
    body.minimumVersionEnabled !== undefined || body.minimumSupportedVersionCode !== undefined;
  const requestedPolicy: MinVersionPolicy = hasPolicyKeys
    ? parseMinVersionPolicy(
        body.minimumVersionEnabled !== undefined
          ? body.minimumVersionEnabled
          : currentPolicy.enabled,
        body.minimumSupportedVersionCode !== undefined
          ? body.minimumSupportedVersionCode
          : currentPolicy.code,
      )
    : currentPolicy;
  const policyError = validateMinVersionPolicy(requestedPolicy, manifest);
  if (policyError) return c.json({ success: false, error: policyError }, 400);
  const manifestWithMin = manifestWithPolicy(manifest, requestedPolicy);
  if (hasPolicyKeys || requestedPolicy.enabled) {
    try {
      await writeMinVersionPolicy(c.env.DB, requestedPolicy);
    } catch (e: any) {
      console.error('[app-update] policy persist failed', String(e?.message || e).slice(0, 200));
      return c.json({ success: false, error: 'Échec persistance de la politique' }, 500);
    }
  }
  if (c.env.IMAGES) {
    try {
      await c.env.IMAGES.put(APP_UPDATE_JSON_KEY, JSON.stringify(manifestWithMin, null, 2), {
        httpMetadata: { contentType: 'application/json', cacheControl: 'no-cache, max-age=0, must-revalidate' },
        customMetadata: { updated_by: gate.username, updated_at: new Date().toISOString() },
      });
    } catch (e: any) {
      return c.json({ success: false, error: `Échec écriture R2 : ${e?.message || e}` }, 502);
    }
  }
  await mirrorAppUpdateConfig(c.env.DB, manifestWithMin);
  return c.json({
    success: true,
    data: {
      manifest: manifestWithMin,
      minimumVersionEnabled: requestedPolicy.enabled,
      minimumSupportedVersionCode: requestedPolicy.code,
      storage: c.env.IMAGES ? 'r2+db' : 'db',
      apkUrlExists: await cdnApkExists(c.env, manifest.apkUrl),
    },
  });
});

/** Upload latest.apk (raw binary body streamed to R2 — no full buffering). */
app.post('/api/admin/app-update/apk', async (c) => {
  const gate = gateAppUpdateAdmin(c);
  if (!gate.ok) return c.json({ success: false, error: gate.error }, gate.status as any);
  if (!c.env.IMAGES) return c.json({ success: false, error: 'Binding R2 (IMAGES) absent' }, 501);
  const len = Number(c.req.header('Content-Length') || 0);
  if (len > APP_UPDATE_MAX_APK_BYTES) return c.json({ success: false, error: 'APK trop lourd (max 200 Mo)' }, 413);
  const stream = c.req.raw.body;
  if (!stream) return c.json({ success: false, error: 'Corps APK absent' }, 400);
  try {
    await c.env.IMAGES.put(APP_UPDATE_APK_KEY, stream as any, {
      httpMetadata: { contentType: APP_UPDATE_APK_MIME, cacheControl: 'no-cache, max-age=0, must-revalidate' },
      customMetadata: { updated_by: gate.username, updated_at: new Date().toISOString() },
    });
  } catch (e: any) {
    return c.json({ success: false, error: `Échec upload R2 : ${e?.message || e}` }, 502);
  }
  const head = await c.env.IMAGES.head(APP_UPDATE_APK_KEY).catch(() => null);
  const base = appUpdateCdnBase(c.env);
  // If the manifest exists but has no apkUrl yet, point it at the APK we just stored.
  try {
    const { manifest } = await readAppUpdateState(c.env);
    if (manifest && !String(manifest.apkUrl || '').trim()) {
      manifest.apkUrl = `${base}/${APP_UPDATE_APK_KEY}`;
      if (c.env.IMAGES) {
        await c.env.IMAGES.put(APP_UPDATE_JSON_KEY, JSON.stringify(manifest, null, 2), {
          httpMetadata: { contentType: 'application/json', cacheControl: 'public, max-age=60' },
          customMetadata: { updated_by: gate.username, updated_at: new Date().toISOString() },
        });
      }
      await mirrorAppUpdateConfig(c.env.DB, manifest);
    }
  } catch { /* best-effort */ }
  return c.json({
    success: true,
    data: { key: APP_UPDATE_APK_KEY, size: head?.size ?? len, url: `${base}/${APP_UPDATE_APK_KEY}` },
  });
});

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
  try { body = await c.req.json(); } catch { return c.json({ success: false, error: 'JSON invalide' }, 400); }
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
  if (dataUrl.startsWith('data:image') && c.env.IMAGES) {
    const mime = (/^data:(image\/[a-z0-9+.-]+);base64,/i.exec(dataUrl) || [])[1]?.toLowerCase() || 'image/jpeg';
    const key = `product-requests/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${mimeToExt(mime)}`;
    photoUrl = (await uploadDataUrlImage(c.env.IMAGES, c.env, dataUrl, key)) || '';
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

/** D1 snapshot → R2 every 4 hours (00,04,08,12,16,20 UTC). */

/** Derive AES-256 key from backup secret (ADMIN_BACKUP_TOKEN or BACKUP_ENCRYPTION_KEY). */
async function backupCryptoKey(env: any): Promise<CryptoKey | null> {
  const secret = String(
    (env as any).BACKUP_ENCRYPTION_KEY || (env as any).ADMIN_BACKUP_TOKEN || '',
  ).trim();
  if (!secret) return null;
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('atlas-bkp-v1:' + secret));
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function b64encode(buf: ArrayBuffer | Uint8Array): string {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/**
 * Encrypt plain JSON → binary .abk (ABK1 + IV + AES-GCM ciphertext).
 * Opaque on CDN: no readable JSON if the object is public.
 */
async function encryptBackupBody(
  env: any,
  plainJson: string,
): Promise<{ ok: true; bytes: Uint8Array; envelopeJson: string } | { ok: false; error: string }> {
  const key = await backupCryptoKey(env);
  if (!key) {
    return { ok: false, error: 'ADMIN_BACKUP_TOKEN (ou BACKUP_ENCRYPTION_KEY) requis pour chiffrer les sauvegardes' };
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      new TextEncoder().encode(plainJson),
    ),
  );
  // Binary: magic "ABK1" (4) + iv (12) + ciphertext
  const magic = new TextEncoder().encode('ABK1');
  const bytes = new Uint8Array(4 + 12 + ct.length);
  bytes.set(magic, 0);
  bytes.set(iv, 4);
  bytes.set(ct, 16);
  // Optional download-friendly envelope (never written to public CDN as sole format)
  const envelopeJson = JSON.stringify({
    fmt: 'atlas-backup-enc-v1',
    alg: 'AES-256-GCM',
    iv: b64encode(iv),
    ct: b64encode(ct),
    app: 'atlas-commerce',
    exported_at: new Date().toISOString(),
  });
  return { ok: true, bytes, envelopeJson };
}

async function decryptBackupBytes(env: any, data: ArrayBuffer | Uint8Array | string): Promise<any | null> {
  const key = await backupCryptoKey(env);
  // Binary ABK1
  if (typeof data !== 'string') {
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (u8.length > 16 && u8[0] === 0x41 && u8[1] === 0x42 && u8[2] === 0x4b && u8[3] === 0x31) {
      if (!key) return null;
      try {
        const iv = u8.slice(4, 16);
        const ct = u8.slice(16);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
        return JSON.parse(new TextDecoder().decode(plain));
      } catch {
        return null;
      }
    }
    // try as text
    data = new TextDecoder().decode(u8);
  }
  const trimmed = String(data || '').trim();
  if (!trimmed) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  // Legacy plaintext
  if (parsed?.tables && typeof parsed.tables === 'object' && !parsed.fmt) {
    return parsed;
  }
  if (parsed?.fmt !== 'atlas-backup-enc-v1' || !parsed.iv || !parsed.ct) {
    return null;
  }
  if (!key) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64decode(String(parsed.iv)) },
      key,
      b64decode(String(parsed.ct)),
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}

/** @deprecated name kept for callers */
async function decryptBackupBody(env: any, raw: string): Promise<any | null> {
  return decryptBackupBytes(env, raw);
}

async function runDailyBackup(env: any): Promise<{ ok: boolean; key?: string; error?: string; bytes?: number; r2_keys?: number }> {
  try {
    if (!env.IMAGES) return { ok: false, error: 'R2 IMAGES binding missing' };
    // Full snapshot — every business + Atlas table we know about (missing tables are skipped)
    const tables = [
      'products', 'product_images', 'product_categories', 'product_units', 'product_catalog',
      'categories', 'units', 'catalog_settings',
      'clients', 'vendors',
      'invoices', 'invoice_items', 'invoice_payments', 'invoice_ubl_clearance',
      'quotes', 'bills', 'bill_items', 'bill_payments', 'purchase_orders',
      'receipts', 'expenses', 'delivery_notes', 'delivery_note_items',
      'company_settings', 'app_config', 'app_users', 'document_counters', 'audit_log',
      'stock_locations', 'stock_levels', 'stock_movements', 'stock_location_qty',
      'stock_cost_layers', 'warehouse_stock', 'warehouses',
      'mobile_actions', 'reorder_suggestions', 'auto_transfer_rules',
      'assist_audit', 'assist_approval', 'assist_prop',
      'push_tokens', 'webhooks', 'api_keys', 'idempotency_keys',
      'trusted_devices', 'webauthn_credentials',
      // security noise optional but kept for full restore
      'login_attempts', 'ip_reputation',
    ];
    const payload: Record<string, any> = {
      exported_at: new Date().toISOString(),
      version: 2,
      app: 'atlas-commerce',
      tables: {},
      r2_object_keys: [] as string[],
    };
    for (const t of tables) {
      try {
        const { results } = await env.DB.prepare(`SELECT * FROM ${t} LIMIT 200000`).all();
        payload.tables[t] = results || [];
      } catch {
        payload.tables[t] = { error: 'table_missing_or_skip' };
      }
    }
    // Index of R2 objects (images + prior backups) — not full binary re-copy
    try {
      let cursor: string | undefined;
      let listed = 0;
      do {
        const page: any = await env.IMAGES.list({ cursor, limit: 500, prefix: '' });
        for (const obj of page.objects || []) {
          if (String(obj.key || '').startsWith('backups/')) continue; // skip nested backup noise
          payload.r2_object_keys.push(obj.key);
          listed++;
          if (listed >= 5000) break;
        }
        cursor = page.truncated ? page.cursor : undefined;
        if (listed >= 5000) break;
      } while (cursor);
    } catch { /* */ }

    const plain = JSON.stringify(payload);
    const enc = await encryptBackupBody(env, plain);
    if (!enc.ok) return { ok: false, error: enc.error };
    const now = new Date();
    const stamp = now.toISOString().replace(/[:.]/g, '-');
    // Flat 30-minute folder only — no daily/ subdir, no manifest.json, no plain JSON
    const key = `backups/30m/atlas-${stamp}.abk`;
    await env.IMAGES.put(key, enc.bytes, {
      httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store' },
      customMetadata: { type: 'backup_30m_enc', version: '4', fmt: 'ABK1' },
    });
    // Latest pointer (encrypted binary) — does not touch unrelated R2 objects
    await env.IMAGES.put('backups/latest.abk', enc.bytes, {
      httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store' },
      customMetadata: { type: 'backup_latest_enc', version: '4', source: key },
    });
    return { ok: true, key, bytes: enc.bytes.length, r2_keys: payload.r2_object_keys.length };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'backup failed' };
  }
}


/* ─── Backup / restore HMAC gate + 14-day retention ─── */

function backupTokenFromRequest(c: any): string {
  return String(
    c.req.header('X-Admin-Backup-Token') ||
    c.req.header('x-admin-backup-token') ||
    '',
  ).trim();
}

async function verifyBackupAccess(
  c: any,
  opts?: { requireBackupToken?: boolean },
): Promise<
  { ok: true; username: string } | { ok: false; response: Response }
> {
  const owner = requireOwner(c);
  if (!owner.ok) return owner;

  // UI (Settings): owner session is enough for backup-now / status / list.
  // Destructive restore still requires ADMIN_BACKUP_TOKEN when configured.
  const requireToken = opts?.requireBackupToken !== false;
  if (!requireToken) {
    return { ok: true, username: owner.username };
  }

  const token = backupTokenFromRequest(c);
  const expected = String((c.env as any).ADMIN_BACKUP_TOKEN || '').trim();
  if (!expected) {
    // Token not configured → owner session alone is accepted (Settings restore still works for owner)
    return { ok: true, username: owner.username };
  }
  if (!token || token !== expected) {
    return {
      ok: false,
      response: c.json({
        success: false,
        error: 'Jeton X-Admin-Backup-Token invalide ou manquant. (wrangler secret put ADMIN_BACKUP_TOKEN)',
        code: 'BACKUP_TOKEN_INVALID',
      }, 403),
    };
  }

  // Optional HMAC: X-Backup-Signature = hex HMAC-SHA256(timestamp + method + path, token)
  const sig = String(c.req.header('X-Backup-Signature') || '').trim().toLowerCase();
  const ts = String(c.req.header('X-Backup-Timestamp') || '').trim();
  if (sig || ts) {
    if (!ts || !sig) {
      return {
        ok: false,
        response: c.json({ success: false, error: 'Signature HMAC incomplète.', code: 'BACKUP_HMAC_INCOMPLETE' }, 403),
      };
    }
    const age = Math.abs(Date.now() - Number(ts));
    if (!Number.isFinite(Number(ts)) || age > 5 * 60 * 1000) {
      return {
        ok: false,
        response: c.json({ success: false, error: 'Horodatage HMAC expiré (>5 min).', code: 'BACKUP_HMAC_EXPIRED' }, 403),
      };
    }
    const path = new URL(c.req.url).pathname;
    const msg = `${ts}.${c.req.method.toUpperCase()}.${path}`;
    const expectSig = await hmacSha256Hex(expected, msg);
    if (expectSig !== sig) {
      return {
        ok: false,
        response: c.json({ success: false, error: 'Signature HMAC invalide.', code: 'BACKUP_HMAC_INVALID' }, 403),
      };
    }
  }

  return { ok: true, username: owner.username };
}

/** Purge encrypted 30m + pre-revert backups older than 7 days. Does not touch unrelated R2 objects. */
async function purgeExpiredBackups(env: any): Promise<{ deleted: number }> {
  if (!env.IMAGES) return { deleted: 0 };
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let deleted = 0;
  const prefixes = ['backups/30m/', 'backups/pre-revert/'];
  for (const prefix of prefixes) {
    let cursor: string | undefined;
    do {
      const page: any = await env.IMAGES.list({ prefix, cursor, limit: 500 });
      for (const obj of page.objects || []) {
        const key = String(obj.key || '');
        if (key.endsWith('manifest.json')) {
          try { await env.IMAGES.delete(key); deleted++; } catch { /* */ }
          continue;
        }
        const uploaded = obj.uploaded ? new Date(obj.uploaded).getTime() : 0;
        if (uploaded && uploaded < cutoff) {
          try { await env.IMAGES.delete(key); deleted++; } catch { /* */ }
        }
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
  // Clean any leftover plain manifests under backups/
  try {
    let cursor: string | undefined;
    do {
      const page: any = await env.IMAGES.list({ prefix: 'backups/', cursor, limit: 500 });
      for (const obj of page.objects || []) {
        const key = String(obj.key || '');
        if (key.includes('manifest.json')) {
          try { await env.IMAGES.delete(key); deleted++; } catch { /* */ }
        }
      }
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  } catch { /* */ }
  return { deleted };
}

async function loadBackupJson(env: any, key: string): Promise<any | null> {
  if (!env.IMAGES) return null;
  const obj = await env.IMAGES.get(key);
  if (!obj) return null;
  try {
    const buf = await obj.arrayBuffer();
    return await decryptBackupBytes(env, buf);
  } catch {
    return null;
  }
}

/** Restore tables from a snapshot payload (best-effort clear+insert per table).
 *  Uses D1 batch() in chunks so large tables do not blow Worker CPU / waitUntil limits
 *  (previous row-by-row await loop often died after product_units ~38%).
 */
async function restoreFromBackupPayload(
  db: D1Database,
  payload: any,
  onProgress?: (info: { table: string; index: number; total: number; rows: number; message: string; progress: number }) => Promise<void> | void,
): Promise<{ tables: string[]; rows: number }> {
  const tables = payload?.tables || {};
  // Prefer a stable order so progress is predictable; unknown tables appended at the end
  const preferred = [
    'product_units', 'units', 'categories', 'product_categories', 'product_catalog', 'catalog_settings',
    'warehouses', 'stock_locations',
    'products', 'product_images',
    'clients', 'vendors',
    'invoices', 'invoice_items', 'invoice_payments', 'invoice_ubl_clearance',
    'quotes', 'bills', 'bill_items', 'bill_payments', 'purchase_orders',
    'receipts', 'expenses', 'delivery_notes', 'delivery_note_items',
    'stock_levels', 'stock_movements', 'stock_location_qty', 'stock_cost_layers', 'warehouse_stock',
    'company_settings', 'app_config', 'app_users', 'document_counters',
    'mobile_actions', 'reorder_suggestions', 'auto_transfer_rules',
    'assist_audit', 'assist_approval', 'assist_prop',
    'push_tokens', 'webhooks', 'api_keys', 'idempotency_keys',
    'trusted_devices', 'webauthn_credentials',
    'login_attempts', 'ip_reputation', 'audit_log',
  ];
  const allNames = Object.keys(tables).filter((t) => Array.isArray(tables[t]) && (tables[t] as any[]).length > 0);
  const ordered: string[] = [];
  for (const t of preferred) if (allNames.includes(t)) ordered.push(t);
  for (const t of allNames) if (!ordered.includes(t)) ordered.push(t);

  const total = Math.max(1, ordered.length);
  const restored: string[] = [];
  let rows = 0;
  let index = 0;
  for (const table of ordered) {
    index += 1;
    const data = tables[table] as any[];
    if (!Array.isArray(data) || !data.length) continue;
    const sample = data[0];
    if (!sample || typeof sample !== 'object') continue;
    const cols = Object.keys(sample);
    if (!cols.length) continue;
    // Skip columns that are pure SQLite rowid aliases if present oddly
    const label = tableLabelFr(table);
    const basePct = Math.min(92, Math.round(20 + (index / total) * 72));
    if (onProgress) {
      try {
        await onProgress({
          table, index, total, rows,
          message: `Restauration « ${label} » (${index}/${total})…`,
          progress: basePct,
        });
      } catch { /* progress must not abort restore */ }
    }

    // Merge mode: do not wipe table — INSERT OR IGNORE skips existing PKs (faster, safer re-run).
    // Probe table exists with a no-op select.
    try {
      await db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).first();
    } catch (e: any) {
      if (onProgress) {
        try {
          await onProgress({
            table, index, total, rows,
            message: `« ${label} » ignoré (table absente)`,
            progress: basePct,
          });
        } catch { /* */ }
      }
      continue;
    }

    const colList = cols.join(', ');
    const nCols = cols.length;
    // D1 max ~100 bound params/query → pack as many rows as fit per statement
    const rowsPerStmt = Math.max(1, Math.min(20, Math.floor(100 / Math.max(1, nCols))));
    // Batch of multi-row statements (fewer round-trips)
    const STMT_BATCH = 40;
    let tableRows = 0;

    try {
      // Optional: defer FK checks for speed/safety during bulk merge
      try { await db.prepare('PRAGMA defer_foreign_keys = true').run(); } catch { /* */ }

      for (let i = 0; i < data.length; i += rowsPerStmt * STMT_BATCH) {
        const stmts: D1PreparedStatement[] = [];
        const outerEnd = Math.min(data.length, i + rowsPerStmt * STMT_BATCH);
        for (let j = i; j < outerEnd; j += rowsPerStmt) {
          const slice = data.slice(j, Math.min(j + rowsPerStmt, outerEnd));
          if (!slice.length) continue;
          const valueGroups: string[] = [];
          const vals: any[] = [];
          for (const row of slice) {
            valueGroups.push(`(${cols.map(() => '?').join(',')})`);
            for (const c of cols) {
              const v = row[c];
              vals.push(v === undefined ? null : v);
            }
          }
          try {
            const sql = `INSERT OR IGNORE INTO ${table} (${colList}) VALUES ${valueGroups.join(',')}`;
            stmts.push(db.prepare(sql).bind(...vals));
          } catch {
            /* skip malformed multi-row build */
          }
        }
        if (!stmts.length) continue;
        try {
          const results = await db.batch(stmts);
          for (const r of results) {
            // meta.changes is rows actually inserted (OR IGNORE skips = 0)
            const ch = Number((r as any)?.meta?.changes ?? 0);
            if (ch > 0) {
              tableRows += ch;
              rows += ch;
            } else {
              // still advance progress for ignored rows
              tableRows += 1;
              rows += 1;
            }
          }
        } catch {
          // Fallback: one-by-one for this range if multi-row batch fails
          for (let k = i; k < outerEnd; k++) {
            const row = data[k];
            try {
              const singleVals = cols.map((c) => (row[c] === undefined ? null : row[c]));
              const singleSql = `INSERT OR IGNORE INTO ${table} (${colList}) VALUES (${cols.map(() => '?').join(',')})`;
              await db.prepare(singleSql).bind(...singleVals).run();
              tableRows++;
              rows++;
            } catch { /* skip bad row */ }
          }
        }
        // Mid-table progress so UI does not freeze on large tables
        if (data.length > rowsPerStmt && onProgress && outerEnd < data.length) {
          const frac = Math.min(1, outerEnd / data.length);
          try {
            await onProgress({
              table, index, total, rows,
              message: `Restauration « ${label} »… ${outerEnd}/${data.length}`,
              progress: Math.min(94, basePct + Math.round(frac * 2)),
            });
          } catch { /* */ }
        }
      }
      try { await db.prepare('PRAGMA defer_foreign_keys = false').run(); } catch { /* */ }
      restored.push(table);
      if (onProgress) {
        try {
          await onProgress({
            table, index, total, rows,
            message: `« ${label} » restauré (${tableRows} lignes)`,
            progress: Math.min(96, basePct + 2),
          });
        } catch { /* */ }
      }
    } catch (e: any) {
      // Whole table failed — continue with remaining tables
      if (onProgress) {
        try {
          await onProgress({
            table, index, total, rows,
            message: `« ${label} » partiel/erreur — suite…`,
            progress: basePct,
          });
        } catch { /* */ }
      }
    }
  }
  return { tables: restored, rows };
}

function tableLabelFr(table: string): string {
  const map: Record<string, string> = {
    products: 'Produits',
    clients: 'Clients',
    vendors: 'Fournisseurs',
    invoices: 'Factures',
    invoice_lines: 'Lignes de facture',
    quotes: 'Devis',
    quote_lines: 'Lignes de devis',
    payments: 'Paiements',
    bills: 'Achats',
    bill_lines: 'Lignes d’achat',
    stock_moves: 'Mouvements de stock',
    users: 'Utilisateurs',
    app_config: 'Configuration',
    settings: 'Paramètres',
    expenses: 'Dépenses',
    locations: 'Entrepôts',
    categories: 'Catégories',
    audit_log: 'Journal d’audit',
    assist_audit: 'Audit agent',
  };
  return map[table] || table;
}

app.post('/api/admin/backup-now', async (c) => {
  const gate = await verifyBackupAccess(c, { requireBackupToken: false });
  if (!gate.ok) return gate.response;
  const result = await runDailyBackup(c.env);
  if (!result.ok) return c.json({ success: false, error: result.error }, 500);
  // Background: purge old backups without blocking the response
  try {
    enqueue(c.executionCtx as any, async () => {
      await purgeExpiredBackups(c.env);
    });
  } catch { /* */ }
  return c.json({ success: true, data: result, message: `Sauvegarde créée: ${result.key}` });
});

app.get('/api/admin/backup-status', async (c) => {
  const gate = await verifyBackupAccess(c, { requireBackupToken: false });
  if (!gate.ok) return gate.response;
  try {
    const obj = await c.env.IMAGES.head('backups/latest.abk');
    return c.json({
      success: true,
      data: {
        has_latest: !!obj,
        uploaded: (obj as any)?.uploaded?.toString?.() || null,
        size: (obj as any)?.size || null,
      },
    });
  } catch {
    return c.json({ success: true, data: { has_latest: false } });
  }
});

app.get('/api/admin/backups', async (c) => {
  const gate = await verifyBackupAccess(c, { requireBackupToken: false });
  if (!gate.ok) return gate.response;
  if (!c.env.IMAGES) return c.json({ success: false, error: 'R2 indisponible' }, 503);
  const items: any[] = [];
  let cursor: string | undefined;
  do {
    const page: any = await c.env.IMAGES.list({ prefix: 'backups/', cursor, limit: 200 });
    for (const obj of page.objects || []) {
      const key = String(obj.key || '');
      // UI list: only encrypted .abk under 30m + latest pointer.
      // pre-revert safety copies stay on R2 but are hidden from the restore dropdown.
      if (key.includes('manifest')) continue;
      if (!key.endsWith('.abk')) continue;
      if (key !== 'backups/latest.abk' && !key.startsWith('backups/30m/')) continue;
      items.push({
        key,
        size: obj.size,
        uploaded: obj.uploaded ? new Date(obj.uploaded).toISOString() : null,
      });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  // Always surface latest pointer if present
  try {
    const latest = await c.env.IMAGES.head('backups/latest.abk');
    if (latest && !items.some((x) => x.key === 'backups/latest.abk')) {
      items.unshift({
        key: 'backups/latest.abk',
        size: (latest as any).size,
        uploaded: (latest as any).uploaded ? new Date((latest as any).uploaded).toISOString() : null,
      });
    }
  } catch { /* */ }
  items.sort((a, b) => {
    if (a.key === 'backups/latest.abk') return -1;
    if (b.key === 'backups/latest.abk') return 1;
    return String(b.uploaded || '').localeCompare(String(a.uploaded || ''));
  });
  return c.json({ success: true, data: items.slice(0, 100) });
});

/** Download backup JSON via API only (never public R2 URL). */
app.get('/api/admin/backups/download', async (c) => {
  const gate = await verifyBackupAccess(c);
  if (!gate.ok) return gate.response;
  const key = String(c.req.query('key') || 'backups/latest.abk').trim();
  if (!key.startsWith('backups/') || key.includes('..')) {
    return c.json({ success: false, error: 'Clé invalide', code: 'BAD_KEY' }, 400);
  }
  const obj = await c.env.IMAGES.get(key);
  if (!obj) return c.json({ success: false, error: 'Sauvegarde introuvable' }, 404);
  const body = await obj.text();
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${key.split('/').pop()}"`,
      'Cache-Control': 'no-store',
    },
  });
});


async function setRestoreJob(env: any, job: {
  id: string; status: string; message?: string; progress?: number;
  safety_key?: string | null; source_key?: string; error?: string;
  started_at?: string; finished_at?: string; tables?: string[]; rows?: number;
  work_key?: string | null; table_index?: number; table_order?: string[]; cancel?: boolean;
}) {
  try {
    if (env.CACHE) {
      await env.CACHE.put(`restore_job:${job.id}`, JSON.stringify(job), { expirationTtl: 3600 * 6 });
      await env.CACHE.put('restore_job:latest', job.id, { expirationTtl: 3600 * 6 });
    }
  } catch { /* */ }
  // Durable Object progress (survives isolate recycling during long restores)
  try {
    if (env.RESTORE_HUB) {
      const id = env.RESTORE_HUB.idFromName('restore:global');
      const stub = env.RESTORE_HUB.get(id);
      await stub.fetch('https://restore-hub/job', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(job),
      });
    }
  } catch { /* */ }
}

async function getRestoreJob(env: any, id?: string): Promise<any | null> {
  try {
    let jid = id || '';
    if (!jid && env.CACHE) {
      jid = (await env.CACHE.get('restore_job:latest')) || '';
    }
    if (env.CACHE && jid) {
      const raw = await env.CACHE.get(`restore_job:${jid}`);
      if (raw) {
        try { return JSON.parse(raw); } catch { /* */ }
      }
    }
    // Fallback Durable Object
    if (env.RESTORE_HUB) {
      try {
        const stub = env.RESTORE_HUB.get(env.RESTORE_HUB.idFromName('restore:global'));
        const res = await stub.fetch('https://restore-hub/status');
        if (res.ok) {
          const j = await res.json() as any;
          const job = j?.data;
          if (job && (!id || job.id === id)) return job;
        }
      } catch { /* */ }
    }
    return null;
  } catch {
    return null;
  }
}


app.get('/api/admin/backups/restore-status', async (c) => {
  const gate = await verifyBackupAccess(c, { requireBackupToken: false });
  if (!gate.ok) return gate.response;
  const id = String(c.req.query('id') || '').trim();
  let job = await getRestoreJob(c.env, id || undefined);
  // Auto-fail zombie jobs (Worker isolate recycled / R2 source deleted mid-run)
  if (job && (job.status === 'running' || job.status === 'pending')) {
    const started = job.started_at ? Date.parse(job.started_at) : 0;
    const ageMs = started ? Date.now() - started : 0;
    if (ageMs > 25 * 60 * 1000) { // > 25 minutes
      job = {
        ...job,
        status: 'failed',
        message: 'Restauration interrompue (délai dépassé ou source indisponible). Vous pouvez réessayer.',
        error: 'STALE_JOB',
        progress: 100,
        finished_at: new Date().toISOString(),
      };
      await setRestoreJob(c.env, job);
    }
  }
  return c.json({ success: true, data: job });
});

/** Force-end a stuck restore job (e.g. R2 file deleted, isolate recycled). */
app.post('/api/admin/backups/restore-cancel', async (c) => {
  const gate = await verifyBackupAccess(c, { requireBackupToken: false });
  if (!gate.ok) return gate.response;
  const body = await c.req.json().catch(() => ({}));
  const id = String(body.id || c.req.query('id') || '').trim();
  const existing = await getRestoreJob(c.env, id || undefined);
  const jobId = id || existing?.id || 'unknown';
  const finished = new Date().toISOString();
  await setRestoreJob(c.env, {
    id: jobId,
    status: 'failed',
    message: body.message || 'Restauration annulée — source supprimée ou job interrompu. Vous pouvez réessayer.',
    error: 'CANCELLED',
    progress: 100,
    source_key: existing?.source_key,
    safety_key: existing?.safety_key,
    started_at: existing?.started_at,
    finished_at: finished,
  });
  // Also clear "latest" pointer so UI does not keep picking it up
  try {
    if (c.env.CACHE) {
      await c.env.CACHE.delete('restore_job:latest');
      if (jobId) await c.env.CACHE.delete(`restore_job:${jobId}`);
    }
  } catch { /* */ }
  try {
    if (c.env.RESTORE_HUB) {
      const stub = c.env.RESTORE_HUB.get(c.env.RESTORE_HUB.idFromName('restore:global'));
      await stub.fetch('https://restore-hub/cancel', { method: 'POST' });
    }
  } catch { /* */ }
  // Cleanup work payload if present
  try {
    if (c.env.IMAGES && existing?.work_key) {
      await c.env.IMAGES.delete(existing.work_key);
    }
  } catch { /* */ }
  return c.json({
    success: true,
    message: 'Job de restauration terminé / annulé',
    data: { id: jobId, status: 'failed' },
  });
});

app.post('/api/admin/backups/restore', async (c) => {
  // Owner session — returns job_id immediately; work continues via waitUntil so UI can poll progress.
  const gate = await verifyBackupAccess(c, { requireBackupToken: false });
  if (!gate.ok) return gate.response;
  const body = await c.req.json().catch(() => ({}));
  const key = String(body.key || c.req.query('key') || '').trim();
  const inline = body.payload && typeof body.payload === 'object' ? body.payload : null;
  const abkB64 = typeof body.abk_base64 === 'string' ? body.abk_base64.trim() : '';
  const jobId = `rj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const started = new Date().toISOString();
  const env = c.env;
  const username = gate.username;
  const ip = c.req.header('cf-connecting-ip') || '';

  if (!inline && !abkB64 && (!key.startsWith('backups/') || key.includes('..'))) {
    return c.json({ success: false, error: 'Clé R2 invalide ou payload manquant', code: 'BAD_KEY' }, 400);
  }

  await setRestoreJob(env, {
    id: jobId, status: 'running', message: 'Vérification des droits et du jeton…', progress: 5,
    source_key: key || 'upload', started_at: started,
  });

  const runRestore = async () => {
    try {
      await setRestoreJob(env, {
        id: jobId, status: 'running', message: 'Création du point de sécurité…', progress: 8,
        source_key: key || 'upload', started_at: started,
      });

      const safety = await runDailyBackup(env);
      const safetyKey = safety.ok
        ? `backups/pre-revert/atlas-prerevert-${new Date().toISOString().replace(/[:.]/g, '-')}.abk`
        : null;
      if (safety.ok && safetyKey && env.IMAGES && safety.key) {
        try {
          const snap = await env.IMAGES.get(safety.key) || await env.IMAGES.get('backups/latest.abk');
          if (snap) {
            await env.IMAGES.put(safetyKey, await snap.arrayBuffer(), {
              httpMetadata: { contentType: 'application/octet-stream', cacheControl: 'private, no-store' },
              customMetadata: { type: 'pre_revert_enc', by: username, fmt: 'ABK1' },
            });
          }
        } catch { /* */ }
      }

      await setRestoreJob(env, {
        id: jobId, status: 'running', message: 'Lecture et déchiffrement du snapshot…', progress: 15,
        source_key: key || 'upload', safety_key: safetyKey, started_at: started,
      });

      let payload: any = null;
      if (abkB64) {
        try {
          const bin = Uint8Array.from(atob(abkB64), (ch) => ch.charCodeAt(0));
          payload = await decryptBackupBytes(env, bin);
        } catch {
          payload = null;
        }
      } else if (inline) {
        if (inline.tables) payload = inline;
        else if (inline.fmt === 'atlas-backup-enc' || inline.ciphertext) {
          try {
            payload = await decryptBackupBody(env, JSON.stringify(inline));
          } catch { payload = null; }
        } else payload = inline;
      } else if (key) {
        payload = await loadBackupJson(env, key);
      }

      if (!payload || typeof payload !== 'object') {
        await setRestoreJob(env, {
          id: jobId, status: 'failed',
          message: 'Snapshot illisible ou vide',
          error: 'BACKUP_INVALID', progress: 100, started_at: started, finished_at: new Date().toISOString(),
          source_key: key || 'upload', safety_key: safetyKey,
        });
        return;
      }

      const isAtlas =
        payload.app === 'atlas-commerce' ||
        payload.version === 2 ||
        payload.version === 1 ||
        (payload.exported_at && typeof payload.tables === 'object');
      if (!isAtlas) {
        await setRestoreJob(env, {
          id: jobId, status: 'failed', message: 'Fichier non compatible (pas une sauvegarde Atlas)',
          error: 'BACKUP_INCOMPATIBLE', progress: 100, started_at: started, finished_at: new Date().toISOString(),
          source_key: key || 'upload', safety_key: safetyKey,
        });
        return;
      }

      const preferred = [
        'product_units', 'units', 'categories', 'product_categories', 'product_catalog', 'catalog_settings',
        'warehouses', 'stock_locations',
        'products', 'product_images',
        'clients', 'vendors',
        'invoices', 'invoice_items', 'invoice_payments', 'invoice_ubl_clearance',
        'quotes', 'bills', 'bill_items', 'bill_payments', 'purchase_orders',
        'receipts', 'expenses', 'delivery_notes', 'delivery_note_items',
        'stock_levels', 'stock_movements', 'stock_location_qty', 'stock_cost_layers', 'warehouse_stock',
        'company_settings', 'app_config', 'app_users', 'document_counters',
        'mobile_actions', 'reorder_suggestions', 'auto_transfer_rules',
        'assist_audit', 'assist_approval', 'assist_prop',
        'push_tokens', 'webhooks', 'api_keys', 'idempotency_keys',
        'trusted_devices', 'webauthn_credentials',
        'login_attempts', 'ip_reputation', 'audit_log',
      ];
      const allNames = Object.keys(payload.tables || {}).filter(
        (tn) => Array.isArray(payload.tables[tn]) && (payload.tables[tn] as any[]).length > 0,
      );
      const tableOrder: string[] = [];
      for (const t of preferred) if (allNames.includes(t)) tableOrder.push(t);
      for (const t of allNames) if (!tableOrder.includes(t)) tableOrder.push(t);

      if (!tableOrder.length) {
        await setRestoreJob(env, {
          id: jobId, status: 'failed', message: 'Aucune table exploitable dans le snapshot',
          error: 'BACKUP_EMPTY', progress: 100, started_at: started, finished_at: new Date().toISOString(),
          source_key: key || 'upload', safety_key: safetyKey,
        });
        return;
      }

      // Persist decrypted work payload on R2 so the Durable Object can process table-by-table
      const workKey = `backups/restore-work/${jobId}.json`;
      if (!env.IMAGES) {
        await setRestoreJob(env, {
          id: jobId, status: 'failed', message: 'R2 indisponible pour le travail de restauration',
          error: 'NO_R2', progress: 100, started_at: started, finished_at: new Date().toISOString(),
        });
        return;
      }
      await env.IMAGES.put(workKey, JSON.stringify({ tables: payload.tables, exported_at: payload.exported_at }), {
        httpMetadata: { contentType: 'application/json', cacheControl: 'private, no-store' },
        customMetadata: { type: 'restore_work', job: jobId },
      });

      await setRestoreJob(env, {
        id: jobId, status: 'running',
        message: `Démarrage — ${tableOrder.length} tables (une par une)…`,
        progress: 20,
        source_key: key || 'upload', safety_key: safetyKey, started_at: started,
        work_key: workKey, table_index: 0, table_order: tableOrder, tables: [], rows: 0,
      });

      // Hand off to RestoreHub DO — each alarm processes ONE table then schedules the next
      if (env.RESTORE_HUB) {
        try {
          const stub = env.RESTORE_HUB.get(env.RESTORE_HUB.idFromName('restore:global'));
          await stub.fetch('https://restore-hub/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: jobId,
              status: 'running',
              message: `Table 1/${tableOrder.length}…`,
              progress: 22,
              source_key: key || 'upload',
              safety_key: safetyKey,
              started_at: started,
              work_key: workKey,
              table_index: 0,
              table_order: tableOrder,
              tables: [],
              rows: 0,
              start: true,
            }),
          });
        } catch (e: any) {
          console.error('restore_do_start_failed', String(e?.message || e));
          // Fall through to single-shot batch restore below
          const result = await restoreFromBackupPayload(env.DB, payload, async (info) => {
            await setRestoreJob(env, {
              id: jobId, status: 'running', message: info.message, progress: info.progress,
              table: info.table, index: info.index, total: info.total, rows: info.rows,
              source_key: key || 'upload', safety_key: safetyKey, started_at: started,
            });
          });
          try { await afterBusinessMutation(env.CACHE); } catch { /* */ }
          await setRestoreJob(env, {
            id: jobId, status: 'ok',
            message: `Terminé — ${result.tables.length} tables, ${result.rows} lignes`,
            progress: 100, tables: result.tables, rows: result.rows,
            source_key: key || 'upload', safety_key: safetyKey,
            started_at: started, finished_at: new Date().toISOString(),
          });
          return;
        }
      } else {
        // Fallback: single-shot (may hit CPU limits on large DBs)
        const result = await restoreFromBackupPayload(env.DB, payload, async (info) => {
          await setRestoreJob(env, {
            id: jobId, status: 'running', message: info.message, progress: info.progress,
            table: info.table, index: info.index, total: info.total, rows: info.rows,
            source_key: key || 'upload', safety_key: safetyKey, started_at: started,
          });
        });
        try { await afterBusinessMutation(env.CACHE); } catch { /* */ }
        await setRestoreJob(env, {
          id: jobId, status: 'ok',
          message: `Terminé — ${result.tables.length} tables, ${result.rows} lignes`,
          progress: 100, tables: result.tables, rows: result.rows,
          source_key: key || 'upload', safety_key: safetyKey,
          started_at: started, finished_at: new Date().toISOString(),
        });
      }

      try {
        await writeAudit(env.DB, {
          username, role: 'owner', action: 'backup.restore', entity: 'backups',
          entity_id: (key || 'upload').split('/').pop() || 'upload',
          detail: `Restauration démarrée (${tableOrder.length} tables)`,
          ip,
        });
      } catch { /* */ }
    } catch (e: any) {
      const msg = e?.message || 'Erreur restauration';
      await setRestoreJob(env, {
        id: jobId, status: 'failed', message: msg, error: msg, progress: 100,
        source_key: key || 'upload', started_at: started, finished_at: new Date().toISOString(),
      });
    }
  };

  // Bootstrap only (decrypt + hand off to DO). DO alarms do the heavy lifting table by table.
  try {
    const ctx = (c as any).executionCtx;
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(runRestore());
    } else {
      await runRestore();
    }
  } catch {
    await runRestore();
  }

  return c.json({
    success: true,
    message: 'Restauration démarrée — tables traitées une par une',
    data: { job_id: jobId, status: 'running' },
  });
});


app.post('/api/admin/backups/purge-expired', async (c) => {
  const gate = await verifyBackupAccess(c);
  if (!gate.ok) return gate.response;
  const r = await purgeExpiredBackups(c.env);
  return c.json({ success: true, data: r, message: `${r.deleted} sauvegarde(s) >14 j purgée(s).` });
});

/* ─── Atomic import pre-validation (reject-all) ─── */

type ImportIssue = { file: string; line?: number; field?: string; rule: string; message: string };

function validateImportClients(rows: any[]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  rows.forEach((r, i) => {
    const line = i + 1;
    const name = String(r.name || r.client_name || '').trim();
    if (!name) issues.push({ file: 'clients', line, field: 'name', rule: 'REQUIRED', message: 'Nom client obligatoire' });
    if (r.email && !String(r.email).includes('@')) {
      issues.push({ file: 'clients', line, field: 'email', rule: 'EMAIL', message: `Email invalide: ${r.email}` });
    }
  });
  return issues;
}

function validateImportProducts(rows: any[]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  rows.forEach((r, i) => {
    const line = i + 1;
    const name = String(r.name || '').trim();
    if (!name) issues.push({ file: 'products', line, field: 'name', rule: 'REQUIRED', message: 'Nom produit obligatoire' });
    const price = Number(r.price ?? r.unit_price);
    if (r.price != null && (!Number.isFinite(price) || price < 0)) {
      issues.push({ file: 'products', line, field: 'price', rule: 'NUMBER', message: `Prix invalide: ${r.price}` });
    }
    const stock = Number(r.stock_quantity ?? r.stock);
    if (r.stock_quantity != null && (!Number.isFinite(stock) || stock < 0)) {
      issues.push({ file: 'products', line, field: 'stock_quantity', rule: 'STOCK', message: `Stock négatif ou invalide: ${r.stock_quantity}` });
    }
  });
  return issues;
}

function validateImportLedger(rows: any[]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  rows.forEach((r, i) => {
    const line = i + 1;
    const amount = Number(r.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      issues.push({ file: 'ledger', line, field: 'amount', rule: 'AMOUNT', message: `Montant invalide: ${r.amount}` });
    }
    if (!String(r.description || r.category || '').trim()) {
      issues.push({ file: 'ledger', line, field: 'description', rule: 'REQUIRED', message: 'Description obligatoire' });
    }
  });
  return issues;
}

function validateImportInvoices(rows: any[]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  rows.forEach((r, i) => {
    const line = i + 1;
    const items = Array.isArray(r.items) ? r.items : [];
    if (!items.length) {
      issues.push({ file: 'invoices', line, field: 'items', rule: 'LINES', message: 'Au moins une ligne requise' });
      return;
    }
    let ht = 0;
    let tax = 0;
    items.forEach((it: any, j: number) => {
      const qty = Number(it.quantity);
      const unit = Number(it.unit_price);
      const rate = Number(it.tax_rate ?? 0);
      if (!Number.isFinite(qty) || qty <= 0) {
        issues.push({ file: 'invoices', line, field: `items[${j}].quantity`, rule: 'QTY', message: 'Quantité invalide' });
      }
      if (!Number.isFinite(unit) || unit < 0) {
        issues.push({ file: 'invoices', line, field: `items[${j}].unit_price`, rule: 'PRICE', message: 'Prix invalide' });
      }
      const lineHt = (Number.isFinite(qty) ? qty : 0) * (Number.isFinite(unit) ? unit : 0);
      ht += lineHt;
      tax += lineHt * ((Number.isFinite(rate) ? rate : 0) / 100);
    });
    const declared = Number(r.total);
    if (Number.isFinite(declared) && Math.abs(declared - (ht + tax)) > 0.5) {
      issues.push({
        file: 'invoices',
        line,
        field: 'total',
        rule: 'MATH',
        message: `Total déclaré ${declared} ≠ HT+TVA ${(ht + tax).toFixed(2)}`,
      });
    }
  });
  return issues;
}

/** Dry-run: never writes. Reject-all if any issue. */
app.post('/api/import/validate', async (c) => {
  const gate = requireBizMutator(c);
  if (!gate.ok) return gate.response;
  const body = await c.req.json().catch(() => ({}));
  const issues: ImportIssue[] = [];

  if (Array.isArray(body.clients)) issues.push(...validateImportClients(body.clients));
  if (Array.isArray(body.products)) issues.push(...validateImportProducts(body.products));
  if (Array.isArray(body.ledger) || Array.isArray(body.expenses)) {
    issues.push(...validateImportLedger(body.ledger || body.expenses));
  }
  if (Array.isArray(body.invoices)) issues.push(...validateImportInvoices(body.invoices));

  // Relational checks against live DB (clients referenced by invoices)
  if (Array.isArray(body.invoices)) {
    for (let i = 0; i < body.invoices.length; i++) {
      const inv = body.invoices[i];
      const cid = inv.client_id != null ? Number(inv.client_id) : null;
      if (cid) {
        const exists = await c.env.DB.prepare(`SELECT id FROM clients WHERE id = ?`).bind(cid).first();
        if (!exists) {
          issues.push({
            file: 'invoices',
            line: i + 1,
            field: 'client_id',
            rule: 'FK',
            message: `Client #${cid} introuvable`,
          });
        }
      }
      for (let j = 0; j < (inv.items || []).length; j++) {
        const pid = inv.items[j]?.product_id != null ? Number(inv.items[j].product_id) : null;
        if (pid) {
          const p = await c.env.DB.prepare(`SELECT id, stock_quantity, track_inventory FROM products WHERE id = ?`).bind(pid).first() as any;
          if (!p) {
            issues.push({
              file: 'invoices',
              line: i + 1,
              field: `items[${j}].product_id`,
              rule: 'FK',
              message: `Produit #${pid} introuvable`,
            });
          } else if (Number(p.track_inventory) && Number(inv.items[j].quantity) > Number(p.stock_quantity || 0) + 0.001) {
            issues.push({
              file: 'invoices',
              line: i + 1,
              field: `items[${j}].quantity`,
              rule: 'STOCK',
              message: `Stock insuffisant produit #${pid} (dispo ${p.stock_quantity}, demandé ${inv.items[j].quantity})`,
            });
          }
        }
      }
    }
  }

  if (!Array.isArray(body.clients) && !Array.isArray(body.products) && !Array.isArray(body.ledger) && !Array.isArray(body.expenses) && !Array.isArray(body.invoices)) {
    return c.json({
      success: false,
      error: 'Payload vide. Envoyez { clients, products, ledger, invoices }.',
      code: 'EMPTY_IMPORT',
    }, 400);
  }

  if (issues.length) {
    return c.json({
      success: false,
      error: `Import refusé: ${issues.length} erreur(s). Aucune donnée écrite.`,
      code: 'IMPORT_REJECTED',
      issues,
    }, 400);
  }

  return c.json({
    success: true,
    message: 'Validation OK — aucune écriture. Vous pouvez appeler /api/import/commit.',
    data: {
      counts: {
        clients: Array.isArray(body.clients) ? body.clients.length : 0,
        products: Array.isArray(body.products) ? body.products.length : 0,
        ledger: Array.isArray(body.ledger || body.expenses) ? (body.ledger || body.expenses).length : 0,
        invoices: Array.isArray(body.invoices) ? body.invoices.length : 0,
      },
    },
  });
});

/** Commit only after validate would pass — re-validates then writes atomically (reject-all). */
app.post('/api/import/commit', async (c) => {
  const gate = requireBizMutator(c);
  if (!gate.ok) return gate.response;
  const body = await c.req.json().catch(() => ({}));

  // Re-run same validation — never trust client "already validated"
  const issues: ImportIssue[] = [];
  if (Array.isArray(body.clients)) issues.push(...validateImportClients(body.clients));
  if (Array.isArray(body.products)) issues.push(...validateImportProducts(body.products));
  if (Array.isArray(body.ledger) || Array.isArray(body.expenses)) {
    issues.push(...validateImportLedger(body.ledger || body.expenses));
  }
  if (Array.isArray(body.invoices)) issues.push(...validateImportInvoices(body.invoices));
  if (issues.length) {
    return c.json({
      success: false,
      error: `Import refusé: ${issues.length} erreur(s). Aucune donnée écrite.`,
      code: 'IMPORT_REJECTED',
      issues,
    }, 400);
  }

  let inserted = 0;
  try {
    if (Array.isArray(body.clients)) {
      for (const r of body.clients) {
        await c.env.DB.prepare(
          `INSERT INTO clients (name, ice, email, phone, address, city) VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(
          String(r.name || r.client_name || '').trim(),
          r.ice || '',
          r.email || '',
          r.phone || '',
          r.address || '',
          r.city || '',
        ).run();
        inserted++;
      }
    }
    if (Array.isArray(body.products)) {
      for (const r of body.products) {
        await c.env.DB.prepare(
          `INSERT INTO products (name, sku, barcode, price, stock_quantity, is_active, track_inventory) VALUES (?, ?, ?, ?, ?, 1, 1)`,
        ).bind(
          String(r.name || '').trim(),
          r.sku || '',
          r.barcode || '',
          Number(r.price ?? r.unit_price ?? 0),
          Number(r.stock_quantity ?? r.stock ?? 0),
        ).run();
        inserted++;
      }
    }
    if (Array.isArray(body.ledger) || Array.isArray(body.expenses)) {
      await ensureExpenseTypeColumn(c.env.DB);
      for (const r of body.ledger || body.expenses) {
        await c.env.DB.prepare(
          `INSERT INTO expenses (category, description, amount, payment_method, expense_date, vendor_name, reference, notes, entry_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          r.category || 'Import',
          r.description || 'Import',
          Number(r.amount),
          r.payment_method || 'cash',
          String(r.date || r.expense_date || new Date().toISOString().slice(0, 10)).slice(0, 10),
          r.vendor || '',
          r.reference || 'import',
          r.notes || '',
          r.entry_type === 'income' ? 'income' : 'expense',
        ).run();
        inserted++;
      }
    }
  } catch (e: any) {
    return c.json({
      success: false,
      error: e?.message || 'Échec écriture — vérifiez les données',
      code: 'IMPORT_WRITE_FAILED',
    }, 400);
  }

  await afterBusinessMutation(c.env.CACHE);
  return c.json({
    success: true,
    message: `Import terminé: ${inserted} enregistrement(s).`,
    count: inserted,
  });
});


app.get('/api/reports/client-situation', async (c) => {
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const cur = settings?.currency || 'MAD';
  const fmtN = (n: number) => Math.round(Number(n || 0)).toLocaleString('fr-FR');
  const name = String(c.req.query('name') || '').trim();
  const ice = String(c.req.query('ice') || '').trim();
  const clientId = String(c.req.query('client_id') || '').trim();

  if (!name && !ice && !clientId) {
    return c.html(reportShell(
      'Situation client',
      settings?.company_name || 'Atlas Commerce',
      'Paramètre manquant',
      '<p>Indiquez <code>name</code>, <code>ice</code> ou <code>client_id</code> dans l’URL, ou ouvrez depuis la fiche client.</p>',
      settings?.report_footer || settings?.notes,
    ));
  }

  let clientRow: any = null;
  if (clientId) {
    clientRow = await c.env.DB.prepare(`SELECT * FROM clients WHERE id = ?`).bind(clientId).first();
  }
  if (!clientRow && ice) {
    clientRow = await c.env.DB.prepare(`SELECT * FROM clients WHERE ice = ?`).bind(ice).first();
  }
  if (!clientRow && name) {
    clientRow = await c.env.DB.prepare(`SELECT * FROM clients WHERE lower(name) = lower(?)`).bind(name).first();
  }

  const matchName = clientRow?.name || name;
  const matchIce = clientRow?.ice || ice;

  let invoices: any[] = [];
  if (matchIce) {
    const { results } = await c.env.DB.prepare(
      `SELECT id, number, issue_date, due_date, status, total, amount_paid, client_name, client_ice, doc_kind, refund_of_invoice_id
       FROM invoices WHERE client_ice = ? AND status NOT IN ('quote','devis','cancelled')
       ORDER BY issue_date DESC, id DESC LIMIT 200`
    ).bind(matchIce).all();
    invoices = results || [];
  }
  if (!invoices.length && matchName) {
    const { results } = await c.env.DB.prepare(
      `SELECT id, number, issue_date, due_date, status, total, amount_paid, client_name, client_ice, doc_kind, refund_of_invoice_id
       FROM invoices WHERE lower(client_name) = lower(?) AND status NOT IN ('quote','devis','cancelled')
       ORDER BY issue_date DESC, id DESC LIMIT 200`
    ).bind(matchName).all();
    invoices = results || [];
    if (!invoices.length) {
      const { results: fuzzy } = await c.env.DB.prepare(
        `SELECT id, number, issue_date, due_date, status, total, amount_paid, client_name, client_ice, doc_kind, refund_of_invoice_id
         FROM invoices WHERE lower(client_name) LIKE lower(?) AND status NOT IN ('quote','devis','cancelled')
         ORDER BY issue_date DESC, id DESC LIMIT 200`
      ).bind('%' + matchName + '%').all();
      invoices = fuzzy || [];
    }
  }

  // Receipts for this client
  let receipts: any[] = [];
  try {
    await ensureReceiptsTable(c.env.DB);
    if (matchName) {
      const { results } = await c.env.DB.prepare(
        `SELECT number, issue_date, amount, payment_method, invoice_id FROM receipts
         WHERE lower(client_name) = lower(?) OR lower(client_name) LIKE lower(?)
         ORDER BY issue_date DESC LIMIT 100`
      ).bind(matchName, '%' + matchName + '%').all();
      receipts = results || [];
    }
  } catch { /* ignore */ }

  const displayName = invoices[0]?.client_name || clientRow?.name || matchName || matchIce || 'Client';
  const detail = String(c.req.query('detail') || '').toLowerCase() === 'full'
    || String(c.req.query('mode') || '').toLowerCase() === 'detail';
  const isCreditDoc = (inv: any) =>
    inv.status === 'remboursement' ||
    inv.doc_kind === 'remboursement' ||
    String(inv.number || '').toUpperCase().startsWith('WR');
  const isVrDoc = (inv: any) =>
    inv.doc_kind === 'quick_sale' ||
    inv.doc_kind === 'ticket' ||
    String(inv.number || '').toUpperCase().startsWith('VR');

  let totalDue = 0, totalPaid = 0, totalTTC = 0, totalCredits = 0;
  const invRows = invoices.map((inv: any) => {
    const paid = Number(inv.amount_paid || 0);
    const total = Number(inv.total || 0);
    const credit = isCreditDoc(inv);
    if (credit) {
      totalCredits += total;
      // Avoir WR : ne gonfle pas le reste dû client (déjà appliqué sur la pièce d'origine)
      const st = 'Avoir (WR)';
      const typeHint = inv.refund_of_invoice_id ? ` · lié #${inv.refund_of_invoice_id}` : '';
      return `<tr>
      <td>${inv.number || ''}<div class="muted" style="font-size:11px">Avoir / remboursement${typeHint}</div></td>
      <td>${inv.issue_date || ''}</td>
      <td class="num" style="color:#2a3040">−${fmtN(total)}</td>
      <td class="num">—</td>
      <td class="num" style="font-weight:700;color:#6366f1">0</td>
      <td>${st}</td>
    </tr>`;
    }
    const due = Math.max(0, total - paid);
    totalPaid += paid;
    totalTTC += total;
    totalDue += due;
    let st = due <= 0.001 ? 'Soldée' : inv.status === 'partial' ? 'Partielle' : inv.status === 'paid' ? 'Soldée' : 'En cours';
    if (isVrDoc(inv) && st === 'Soldée') st = 'Ticket VR soldé';
    else if (isVrDoc(inv)) st = due <= 0.001 ? 'Ticket VR soldé' : 'Ticket VR';
    const kind = isVrDoc(inv) ? '<div class="muted" style="font-size:11px">Vente rapide</div>' : '';
    return `<tr>
      <td>${inv.number || ''}${kind}</td>
      <td>${inv.issue_date || ''}</td>
      <td class="num">${fmtN(total)}</td>
      <td class="num">${fmtN(paid)}</td>
      <td class="num" style="font-weight:700;color:${due > 0.001 ? '#8b2e2e' : '#6366f1'}">${fmtN(due)}</td>
      <td>${st}</td>
    </tr>`;
  }).join('');

  const payModeFr = (m: string) => {
    const x = String(m || '').toLowerCase();
    if (x === 'cash' || x === 'espèces' || x === 'especes') return 'Espèces';
    if (x === 'card' || x === 'carte') return 'Carte';
    if (x === 'transfer' || x === 'virement') return 'Virement';
    if (x === 'cheque' || x === 'chèque') return 'Chèque';
    return m || '—';
  };
  const recRows = receipts.map((r: any) =>
    `<tr><td>${r.number || ''}</td><td>${r.issue_date || ''}</td><td class="num">${fmtN(Number(r.amount))}</td><td>${payModeFr(r.payment_method)}</td></tr>`
  ).join('');

  // Detailed mode: product lines per invoice
  let detailBlocks = '';
  if (detail && invoices.length) {
    const chunks: string[] = [];
    for (const inv of invoices.slice(0, 80)) {
      let items: any[] = [];
      try {
        const { results } = await c.env.DB.prepare(
          `SELECT product_name, sku, quantity, unit_price, tax_rate, line_total
           FROM invoice_items WHERE invoice_id = ? ORDER BY id`
        ).bind(inv.id).all();
        items = results || [];
      } catch { items = []; }
      const paid = Number(inv.amount_paid || 0);
      const total = Number(inv.total || 0);
      const credit = isCreditDoc(inv);
      const due = credit ? 0 : Math.max(0, total - paid);
      const lineRows = items.map((it: any) => {
        const qty = Number(it.quantity || 0);
        const pu = Number(it.unit_price || 0);
        const lt = Number(it.line_total != null ? it.line_total : qty * pu);
        return `<tr>
          <td>${it.product_name || '—'}${it.sku ? ` <span class="muted">(${it.sku})</span>` : ''}</td>
          <td class="num">${qty}</td>
          <td class="num">${fmtN(pu)}</td>
          <td class="num">${fmtN(Number(it.tax_rate || 0))}%</td>
          <td class="num">${fmtN(lt)}</td>
        </tr>`;
      }).join('');
      chunks.push(`
        <div class="card" style="margin:16px 0;padding:12px 14px;border:1px solid var(--line,#ddd);border-radius:10px;page-break-inside:avoid">
          <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:8px">
            <div>
              <strong style="font-size:15px">${inv.number || '—'}</strong>
              <span class="muted"> · ${inv.issue_date || ''}</span>
            </div>
            <div class="muted">TTC ${fmtN(total)} · Payé ${fmtN(paid)} · <strong style="color:${due > 0.001 ? '#8b2e2e' : '#6366f1'}">Reste ${fmtN(due)} ${cur}</strong></div>
          </div>
          <table>
            <thead><tr><th>Produit / service</th><th class="num">Qté</th><th class="num">P.U.</th><th class="num">TVA</th><th class="num">Total</th></tr></thead>
            <tbody>${lineRows || '<tr><td colspan="5">Aucune ligne produit</td></tr>'}</tbody>
          </table>
        </div>`);
    }
    detailBlocks = `<h2>Détail produits par facture</h2>${chunks.join('')}`;
  }

  const body = `
  <div class="grid" style="grid-template-columns:repeat(4,1fr)">
    <div class="stat"><div class="l">Total facturé TTC</div><div class="v">${fmtN(totalTTC)} ${cur}</div></div>
    <div class="stat"><div class="l">Avoirs (WR)</div><div class="v" style="color:#2a3040">${fmtN(totalCredits)} ${cur}</div></div>
    <div class="stat"><div class="l">Déjà payé</div><div class="v in">${fmtN(totalPaid)} ${cur}</div></div>
    <div class="stat"><div class="l">Reste dû</div><div class="v ${totalDue > 0.001 ? 'out' : 'in'}">${fmtN(totalDue)} ${cur}</div></div>
  </div>
  <p class="muted"><strong>${displayName}</strong>
    ${matchIce ? ' · ICE ' + matchIce : ''}
    ${clientRow?.phone ? ' · ' + clientRow.phone : ''}
    ${clientRow?.email ? ' · ' + clientRow.email : ''}
    ${clientRow?.address ? ' · ' + clientRow.address : ''}
    ${clientRow?.city ? ' · ' + clientRow.city : ''}
  </p>
  <p class="muted">${detail
    ? 'Vue <strong>détaillée</strong> : chaque pièce avec ses lignes produits.'
    : 'Vue <strong>synthèse</strong> : numéros et montants uniquement. Ouvrez la version « Détail produits » depuis la fiche client pour le détail des articles.'}</p>
  <h2>Pièces (factures, tickets VR, avoirs WR)</h2>
  <table>
    <thead><tr><th>N°</th><th>Date</th><th class="num">TTC</th><th class="num">Payé</th><th class="num">Reste</th><th>Statut</th></tr></thead>
    <tbody>${invRows || '<tr><td colspan="6">Aucune pièce pour ce client</td></tr>'}</tbody>
  </table>
  ${detailBlocks}
  <h2>Reçus d’encaissement</h2>
  <table>
    <thead><tr><th>N°</th><th>Date</th><th class="num">Montant</th><th>Mode</th></tr></thead>
    <tbody>${recRows || '<tr><td colspan="4">Aucun reçu</td></tr>'}</tbody>
  </table>
  <p class="muted" style="margin-top:14px;font-size:12px">Les avoirs WR réduisent le solde client et n’apparaissent pas comme une dette. Le reste dû ne compte que les factures FA et tickets VR non soldés.</p>`;

  return c.html(reportShell(
    (detail ? 'Situation client (détail) — ' : 'Situation client — ') + displayName,
    settings?.company_name || 'Atlas Commerce',
    (detail ? 'Détail des produits · ' : 'Synthèse · ') + 'Rapport interne · ' + new Date().toLocaleDateString('fr-FR'),
    body,
    settings?.report_footer || settings?.notes,
  ));
});




app.get('/api/reports/employee-blank-form', async (c) => {
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  return c.html(generateEmployeeFormHTML(settings, null, { autoPrint: true }));
});


app.get('/api/reports/employee-situation', async (c) => {
  const id = Number(c.req.query('employee_id') || c.req.query('id') || 0);
  if (!id) return c.html('<!DOCTYPE html><html><body><p>Employé manquant (employee_id).</p></body></html>', 400);
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const emp = await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(id).first() as any;
  if (!emp) return c.html('<!DOCTYPE html><html><body><p>Employé introuvable.</p></body></html>', 404);
  const cur = settings?.currency || 'MAD';
  const name = [emp.first_name, emp.last_name].filter(Boolean).join(' ') || emp.name || '—';
  let payRows: any[] = [];
  try {
    const payments = await c.env.DB.prepare(
      `SELECT amount, paid_at, period_label, note FROM employee_payments WHERE employee_id = ? ORDER BY paid_at DESC LIMIT 36`
    ).bind(id).all();
    payRows = (payments.results || []) as any[];
  } catch { payRows = []; }
  const rows = payRows.map((p: any) =>
    `<tr><td>${String(p.paid_at || '').slice(0, 10)}</td><td style="text-align:right">${Number(p.amount || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2 })} ${cur}</td><td>${p.period_label || '—'}</td><td>${p.note || '—'}</td></tr>`
  ).join('') || '<tr><td colspan="4">Aucun paiement enregistré</td></tr>';
  const cycle = emp.pay_cycle_type === 'days' ? `Tous les ${emp.pay_cycle_days || 7} jours` : 'Mensuel (30 j)';
  const body = `
  <h2 style="margin-top:0">${name}</h2>
  <p class="muted">${emp.emp_number || ''} · ${emp.role_title || '—'} · ${emp.contract_type || 'CDI'} · ${emp.nationality || '—'}</p>
  <div class="grid">
    <div class="stat"><div class="l">Salaire / cycle</div><div class="v">${Number(emp.pay_amount || 0).toLocaleString('fr-FR')} ${cur}</div></div>
    <div class="stat"><div class="l">Cycle</div><div class="v">${cycle}</div></div>
    <div class="stat"><div class="l">Entrée</div><div class="v">${emp.joined_date || '—'}</div></div>
    <div class="stat"><div class="l">Dernier paiement</div><div class="v">${emp.last_paid_at ? String(emp.last_paid_at).slice(0, 10) : 'Jamais'}</div></div>
  </div>
  <table>
    <tbody>
      <tr><th>CIN / ID</th><td>${emp.national_id || '—'}</td><th>CNSS</th><td>${emp.cnss_number || emp.social_insurance || '—'}</td></tr>
      <tr><th>RIB</th><td colspan="3">${emp.rib || '—'}</td></tr>
      <tr><th>Adresse</th><td colspan="3">${[emp.address, emp.city, emp.country].filter(Boolean).join(', ') || '—'}</td></tr>
      <tr><th>Horaires</th><td>${emp.weekly_hours || 44} h / sem.</td><th>Essai</th><td>${emp.trial_days ?? '—'} j</td></tr>
      <tr><th>Fonctions</th><td colspan="3">${emp.job_description || '—'}</td></tr>
    </tbody>
  </table>
  <h2>Historique des paiements de salaire</h2>
  <table><thead><tr><th>Date</th><th>Montant</th><th>Période</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>`;
  return c.html(reportShell(`Situation employé — ${name}`, settings?.company_name || 'Atlas Commerce', emp.emp_number || String(id), body, settings?.report_footer || settings?.notes));
});

app.get('/api/reports/employees', async (c) => {
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const cur = settings?.currency || 'MAD';
  let rows: any[] = [];
  try {
    const r = await c.env.DB.prepare(
      `SELECT emp_number, first_name, last_name, role_title, pay_amount, pay_cycle_type, pay_cycle_days,
              last_paid_at, COALESCE(active,1) as active, joined_date
       FROM employees ORDER BY COALESCE(active,1) DESC, last_name, first_name`
    ).all();
    rows = (r.results || []) as any[];
  } catch {
    rows = [];
  }
  const fmtN = (n: number) => Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const active = rows.filter((e) => Number(e.active) !== 0);
  const payroll = active.reduce((s, e) => s + Number(e.pay_amount || 0), 0);
  const table = rows.map((e) => {
    const name = [e.first_name, e.last_name].filter(Boolean).join(' ') || '—';
    const cycle = e.pay_cycle_type === 'days' ? `tous les ${e.pay_cycle_days || 7} j` : 'mensuel';
    return `<tr>
      <td>${e.emp_number || '—'}</td>
      <td>${name}</td>
      <td>${e.role_title || '—'}</td>
      <td style="text-align:right">${fmtN(e.pay_amount)} ${cur}</td>
      <td>${cycle}</td>
      <td>${e.last_paid_at ? String(e.last_paid_at).slice(0, 10) : '—'}</td>
      <td>${Number(e.active) !== 0 ? 'Actif' : 'Démissionné'}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="7">Aucun employé</td></tr>`;
  const body = `
  <div class="grid">
    <div class="stat"><div class="l">Effectif actif</div><div class="v">${active.length}</div></div>
    <div class="stat"><div class="l">Masse salariale (cycles)</div><div class="v">${fmtN(payroll)} ${cur}</div></div>
    <div class="stat"><div class="l">Total fiches</div><div class="v">${rows.length}</div></div>
  </div>
  <h2>Registre du personnel</h2>
  <table>
    <thead><tr><th>N°</th><th>Nom</th><th>Poste</th><th>Salaire</th><th>Cycle</th><th>Dernier paiement</th><th>Statut</th></tr></thead>
    <tbody>${table}</tbody>
  </table>`;
  return c.html(reportShell('Rapport employés & paie', settings?.company_name || 'Atlas Commerce', new Date().toISOString().slice(0, 10), body, settings?.report_footer || settings?.notes));
});


app.get('/api/reports/combined', async (c) => {
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  // v262 — validated period (relative or strict YYYY-MM) in the company's
  // finance timezone; periodKey (normalized) propagates to every section link.
  const { from, to, label, periodKey } = periodBounds(c, settings?.finance_timezone);
  const cur = settings?.currency || 'MAD';
  const fmt = (n: number) => Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });

  // Short-lived signed ticket for working links (30 min) — not the session JWT.
  // Raw user input never reaches the links: only rt + the validated periodKey.
  const rt = await mintReportLinkTicket(c.env);
  const qs = (extra: Record<string, string> = {}) => buildReportLinkQuery(rt, periodKey, extra);
  const href = (path: string, extra?: Record<string, string>) => `${path}${qs(extra || {})}`;

  let balanceHtml = '<p class="muted">Solde non disponible</p>';
  try {
    const exp = await c.env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN COALESCE(entry_type,'expense')='expense' THEN amount ELSE 0 END),0) as out,
      COALESCE(SUM(CASE WHEN entry_type='income' OR entry_type='owner_contrib' THEN amount ELSE 0 END),0) as inn FROM expenses
      WHERE expense_date >= ? AND expense_date <= ?`).bind(from, to).first() as any;
    balanceHtml = `<div class="grid">
      <div class="stat"><div class="l">Sorties (dépenses)</div><div class="v out">−${fmt(exp?.out)} ${cur}</div></div>
      <div class="stat"><div class="l">Entrées hors ventes</div><div class="v in">+${fmt(exp?.inn)} ${cur}</div></div>
    </div>`;
  } catch { /* */ }

  let empHtml = '<p class="muted">Aucun employé</p>';
  try {
    const em = await c.env.DB.prepare(
      `SELECT id, emp_number, first_name, last_name, name, role_title, pay_amount, pay_cycle_type, pay_cycle_days, last_paid_at, COALESCE(active,1) as active
       FROM employees ORDER BY COALESCE(active,1) DESC, id LIMIT 50`
    ).all();
    const rows = ((em.results || []) as any[]).map((e) => {
      const nm = [e.first_name, e.last_name].filter(Boolean).join(' ') || e.name || '—';
      const cy = e.pay_cycle_type === 'days' ? `${e.pay_cycle_days || 7} j` : 'mensuel';
      const sit = href('/api/reports/employee-situation', { employee_id: String(e.id) });
      return `<tr><td>${e.emp_number || '—'}</td><td>${nm}</td><td>${e.role_title || '—'}</td>
        <td style="text-align:right">${fmt(e.pay_amount)} ${cur}</td><td>${cy}</td>
        <td>${e.last_paid_at ? String(e.last_paid_at).slice(0,10) : '—'}</td>
        <td>${Number(e.active) ? 'Actif' : 'Démissionné'}</td>
        <td><a href="${sit}">Situation</a></td></tr>`;
    }).join('') || '<tr><td colspan="8">Aucun</td></tr>';
    empHtml = `<table><thead><tr><th>N°</th><th>Nom</th><th>Poste</th><th>Salaire</th><th>Cycle</th><th>Dernier paiement</th><th>Statut</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  } catch { /* */ }

  let recvHtml = '<p class="muted">—</p>';
  try {
    const r = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(total - COALESCE(amount_paid,0)),0) as due FROM invoices
       WHERE status NOT IN ('cancelled','paid','quote','devis') AND (total - COALESCE(amount_paid,0)) > 0.001`
    ).first() as any;
    recvHtml = `<div class="stat"><div class="l">Créances clients ouvertes</div><div class="v">${fmt(r?.due)} ${cur}</div></div>`;
  } catch { /* */ }

  let payHtml = '<p class="muted">—</p>';
  try {
    const r = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(total - COALESCE(amount_paid,0)),0) as due FROM bills
       WHERE status NOT IN ('cancelled','paid') AND (total - COALESCE(amount_paid,0)) > 0.001`
    ).first() as any;
    payHtml = `<div class="stat"><div class="l">Dettes fournisseurs ouvertes</div><div class="v">${fmt(r?.due)} ${cur}</div></div>`;
  } catch { /* */ }

  const body = `
  <p class="muted">Période : <strong>${label}</strong> (du ${from} au ${to}). Cliquez un lien pour le détail — même période, valide 30 minutes.</p>
  <ul style="font-size:15px;line-height:1.8">
    <li><a href="${href('/api/reports/balance')}">Solde &amp; mouvements</a></li>
    <li><a href="${href('/api/reports/stock')}">Stock &amp; valorisation</a></li>
    <li><a href="${href('/api/reports/receivables')}">Créances clients</a></li>
    <li><a href="${href('/api/reports/payables')}">Dettes fournisseurs</a></li>
    <li><a href="${href('/api/reports/employees')}">Employés &amp; paie</a></li>
    <li><a href="${href('/api/reports/aging.html')}">Balance âgée</a></li>
    <li><a href="${href('/api/reports/tva.html')}">Récapitulatif TVA</a></li>
  </ul>
  <h2>1. Solde & mouvements (synthèse)</h2>
  ${balanceHtml}
  <h2>2. Créances clients</h2>
  ${recvHtml}
  <h2>3. Dettes fournisseurs</h2>
  ${payHtml}
  <h2>4. Employés & paie</h2>
  ${empHtml}`;
  return c.html(reportShell('Rapports combinés', settings?.company_name || 'Atlas Commerce', label, body, settings?.report_footer || settings?.notes));
});




/* ── Employee attendance (pointage) — CloudAttend-inspired ── */
async function ensureAttendanceSchema(db: D1Database) {
  await schemaOnce('attendance', async () => {
  await db.prepare(`CREATE TABLE IF NOT EXISTS employee_attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_id INTEGER NOT NULL,
    work_date TEXT NOT NULL,
    check_in TEXT,
    check_out TEXT,
    status TEXT DEFAULT '',
    note TEXT DEFAULT '',
    created_at TEXT,
    updated_at TEXT,
    UNIQUE(employee_id, work_date)
  )`).run();
  // SQLite ALTER cannot use non-constant defaults — plain TEXT columns only
  for (const col of [
    `ALTER TABLE employee_attendance ADD COLUMN status TEXT DEFAULT ''`,
    `ALTER TABLE employee_attendance ADD COLUMN updated_at TEXT`,
    `ALTER TABLE employee_attendance ADD COLUMN created_at TEXT`,
  ]) {
    try { await db.prepare(col).run(); } catch { /* exists */ }
  }
  try { await db.prepare(`CREATE INDEX IF NOT EXISTS idx_att_date ON employee_attendance(work_date)`).run(); } catch { /* */ }
  try { await db.prepare(`CREATE INDEX IF NOT EXISTS idx_att_emp ON employee_attendance(employee_id)`).run(); } catch { /* */ }
  });
}

function moroccoTodayStr(): string {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Casablanca' });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function moroccoNowTime(): string {
  try {
    return new Date().toLocaleTimeString('fr-FR', {
      timeZone: 'Africa/Casablanca',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return new Date().toISOString().slice(11, 16);
  }
}

/** Parse HH:MM or HH:MM:SS → minutes from midnight, or null */
function timeToMinutes(t: string | null | undefined): number | null {
  const m = String(t || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Derive status from clock times.
 * - No check-in → absent (unless forced excused/absent)
 * - Check-in after 09:15 → late (full day)
 * - Half day: ~3–5.5h, e.g. 09:00–13:00 or 14:00–18:00
 * forced: only 'absent' | 'excused' stick; present/late/half always follow times when times exist
 */
function deriveAttendanceStatus(checkIn: string | null, checkOut: string | null, forced?: string | null): string {
  const f = String(forced || '').toLowerCase().trim();
  if (f === 'absent' || f === 'excused') return f;

  const inM = timeToMinutes(checkIn);
  if (inM == null) return 'absent';

  const outM = timeToMinutes(checkOut);
  if (outM != null && outM > inM) {
    const duration = outM - inM;
    // Classic half shifts: morning ~9–13 or afternoon ~14–18, or any span 3h–5h30
    const morningHalf = inM <= 10 * 60 + 30 && outM <= 14 * 60 && duration >= 3 * 60 && duration <= 5 * 60 + 30;
    const afternoonHalf = inM >= 12 * 60 && inM <= 15 * 60 && duration >= 3 * 60 && duration <= 5 * 60 + 30;
    const shortDay = duration >= 3 * 60 && duration < 5 * 60 + 30;
    if (morningHalf || afternoonHalf || shortDay) {
      // Half day that started after 09:15 still counts as half (not "late full day")
      return 'half';
    }
  }

  // Full day (or open shift without checkout): late if arrived after 09:15
  if (inM > 9 * 60 + 15) return 'late';
  return 'present';
}

/** Attendance weight for pay: present/late/excused=1, half=0.5, absent=0 */
function parseHmToMinutes(hm: string): number {
  const m = String(hm || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Minutes late after threshold (0 if on time / no check-in). */
function lateMinutesAfterThreshold(checkIn: string | null | undefined, threshold: string): number {
  if (!checkIn) return 0;
  const inM = parseHmToMinutes(checkIn);
  const th = parseHmToMinutes(threshold || '09:15');
  return Math.max(0, inM - th);
}

function disciplineHint(lateCount: number, rules: { warn_late_count?: number; blame_late_count?: number }): string | null {
  const blame = Number(rules.blame_late_count ?? 6);
  const warn = Number(rules.warn_late_count ?? 3);
  if (lateCount >= blame) return 'blame';
  if (lateCount >= warn) return 'avertissement';
  return null;
}

/** @deprecated Kept for old formula; default path no longer uses % late salary cuts. */
function latePenaltyFromRate(
  lateDays: number,
  totalDays: number,
  dailyRate: number,
  rules?: { grace_pct?: number; block_pct?: number; half_days?: number },
) {
  return { late_pct: totalDays > 0 ? lateDays / totalDays : 0, free_pct: 0.25, excess_pct: 0, penalty_units: 0, deduction: 0 };
}


function attendancePayWeight(status: string): number {
  switch (String(status || '').toLowerCase()) {
    case 'present':
    case 'late':
    case 'excused':
      return 1;
    case 'half':
      return 0.5;
    case 'absent':
    default:
      return 0;
  }
}


async function requireAttendanceEnabled(c: any): Promise<Response | null> {
  try {
    await ensureHrSettings(c.env.DB);
    const s = await c.env.DB.prepare(`SELECT attendance_enabled FROM company_settings WHERE id = 1`).first() as any;
    if (Number(s?.attendance_enabled) !== 1) {
      return c.json({
        success: false,
        error: 'Module présence désactivé',
        code: 'ATTENDANCE_DISABLED',
      }, 403);
    }
  } catch {
    return c.json({ success: false, error: 'Module présence indisponible', code: 'ATTENDANCE_DISABLED' }, 403);
  }
  return null;
}

app.get('/api/attendance', async (c) => {
  { const off = await requireAttendanceEnabled(c); if (off) return off; }

  await ensureAttendanceSchema(c.env.DB);
  try { await ensureEmployeeTeamColumn(c.env.DB); } catch { /* */ }
  const attRules = await loadAttendanceRules(c.env.DB);
  const date = String(c.req.query('date') || moroccoTodayStr()).slice(0, 10);
  let employees: { results?: any[] };
  try {
    employees = await c.env.DB.prepare(
      `SELECT id, emp_number, first_name, last_name, name, role_title, team, COALESCE(active,1) as active,
              pay_amount, pay_cycle_type, pay_cycle_days, last_paid_at, joined_date, returned_at
       FROM employees WHERE COALESCE(active,1)=1 ORDER BY last_name, first_name, id`
    ).all();
  } catch {
    employees = await c.env.DB.prepare(
      `SELECT id, emp_number, first_name, last_name, name, role_title, COALESCE(active,1) as active,
              pay_amount, pay_cycle_type, pay_cycle_days, last_paid_at, joined_date
       FROM employees WHERE COALESCE(active,1)=1 ORDER BY last_name, first_name, id`
    ).all();
  }
  const att = await c.env.DB.prepare(
    `SELECT * FROM employee_attendance WHERE work_date = ?`
  ).bind(date).all();
  const byEmp = new Map<number, any>();
  for (const r of (att.results || []) as any[]) byEmp.set(Number(r.employee_id), r);

  // Rates for the *current pay cycle* of each employee (reset after each payment)
  const dayDiff = (a: string, b: string) => {
    const t0 = new Date(a + 'T12:00:00Z').getTime();
    const t1 = new Date(b + 'T12:00:00Z').getTime();
    return Math.max(0, Math.round((t1 - t0) / 86400000));
  };
  const cycleStartFor = (e: any): string => {
    const last = e.last_paid_at ? String(e.last_paid_at).slice(0, 10) : '';
    const ret = e.returned_at ? String(e.returned_at).slice(0, 10) : '';
    const joined = e.joined_date ? String(e.joined_date).slice(0, 10) : '';
    if (last && /^\d{4}-\d{2}-\d{2}$/.test(last) && (!ret || last >= ret)) {
      const d = new Date(last + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    }
    if (ret && /^\d{4}-\d{2}-\d{2}$/.test(ret)) return ret;
    if (joined && /^\d{4}-\d{2}-\d{2}$/.test(joined)) return joined;
    return date.slice(0, 8) + '01';
  };
  // Load attendance from earliest cycle start among employees through date
  let earliest = date;
  for (const e of (employees.results || []) as any[]) {
    const cs = cycleStartFor(e);
    if (cs < earliest) earliest = cs;
  }
  const ratesRaw = await c.env.DB.prepare(
    `SELECT employee_id, work_date, status, check_in, check_out FROM employee_attendance
     WHERE work_date >= ? AND work_date <= ?`
  ).bind(earliest, date).all();
  const rateMap = new Map<number, { days: number; weight: number; present: number; absent: number; late: number; from: string }>();
  // group by emp then filter by that emp's cycle start
  const byEmpAtt = new Map<number, any[]>();
  for (const r of (ratesRaw.results || []) as any[]) {
    const id = Number(r.employee_id);
    if (!byEmpAtt.has(id)) byEmpAtt.set(id, []);
    byEmpAtt.get(id)!.push(r);
  }
  for (const e of (employees.results || []) as any[]) {
    const id = Number(e.id);
    const from = cycleStartFor(e);
    const cur = { days: 0, weight: 0, present: 0, absent: 0, late: 0, from };
    for (const r of byEmpAtt.get(id) || []) {
      if (String(r.work_date).slice(0, 10) < from) continue;
      const st = deriveAttendanceStatus(
        r.check_in,
        r.check_out,
        ['absent', 'excused'].includes(String(r.status || '').toLowerCase()) ? r.status : null,
      );
      cur.days += 1;
      cur.weight += attendancePayWeight(st);
      if (st === 'absent') cur.absent += 1;
      else if (st === 'late') cur.late += 1;
      else if (st === 'present' || st === 'half' || st === 'excused') cur.present += 1;
    }
    rateMap.set(id, cur);
  }

  const rows = ((employees.results || []) as any[]).map((e) => {
    const a = byEmp.get(Number(e.id));
    const status = deriveAttendanceStatus(a?.check_in || null, a?.check_out || null, ['absent','excused'].includes(String(a?.status||'').toLowerCase()) ? a?.status : null);
    const rate = rateMap.get(Number(e.id));
    const ratePct = rate && rate.days > 0 ? Math.round((rate.weight / rate.days) * 1000) / 10 : null;
    const payAmt = Number(e.pay_amount || 0);
    const cycle = e.pay_cycle_type === 'days' ? Math.max(1, Number(e.pay_cycle_days || 7)) : 30;
    const today = date;
    const periodFrom = rate?.from || cycleStartFor(e);
    const daily = cycle > 0 ? payAmt / cycle : 0;
    // A) Presence-based pay: worked days in cycle (late still counts as worked)
    const worked = rate?.weight || 0;
    let suggested = 0;
    if (payAmt > 0 && cycle > 0) {
      if (attRules.pay_mode === 'calendar') {
        const elapsed = Math.max(0, Math.round(
          (new Date(today + 'T12:00:00Z').getTime() - new Date(periodFrom + 'T12:00:00Z').getTime()) / 86400000,
        )) + 1;
        suggested = Math.round(payAmt * (Math.min(elapsed, cycle * 12) / cycle) * 100) / 100;
      } else {
        // presence (default): daily × sum of attendance weights in cycle
        suggested = Math.round(Math.min(worked, cycle * 12) * daily * 100) / 100;
      }
    }
    // B) Optional: deduct unpaid late minutes after threshold (this cycle)
    let minuteDeduction = 0;
    let lateMinutesTotal = 0;
    if (attRules.minute_deduct && attRules.enabled && daily > 0) {
      const dayRows = byEmpAtt.get(Number(e.id)) || [];
      const from = periodFrom;
      for (const r of dayRows) {
        if (String(r.work_date).slice(0, 10) < from) continue;
        const st = deriveAttendanceStatus(
          r.check_in,
          r.check_out,
          ['absent', 'excused'].includes(String(r.status || '').toLowerCase()) ? r.status : null,
        );
        if (st === 'late' || st === 'present') {
          const lm = lateMinutesAfterThreshold(r.check_in, attRules.late_threshold);
          lateMinutesTotal += lm;
        }
      }
      const dayMins = Math.max(60, attRules.workday_hours * 60);
      minuteDeduction = Math.round((lateMinutesTotal / dayMins) * daily * 100) / 100;
      suggested = Math.max(0, Math.round((suggested - minuteDeduction) * 100) / 100);
    }
    const lateDays = rate?.late || 0;
    const logged = rate?.days || 0;
    const disc = disciplineHint(lateDays, attRules);
    const pen = { deduction: minuteDeduction, late_pct: logged > 0 ? lateDays / logged : 0, penalty_units: 0 };
    return {
      employee_id: e.id,
      emp_number: e.emp_number,
      name: [e.first_name, e.last_name].filter(Boolean).join(' ') || e.name || '—',
      role_title: e.role_title || '',
      team: e.team || '',
      pay_amount: payAmt,
      work_date: date,
      check_in: a?.check_in || null,
      check_out: a?.check_out || null,
      status,
      note: a?.note || '',
      attendance_id: a?.id || null,
      month_rate_pct: ratePct,
      month_days_logged: rate?.days || 0,
      month_present: rate?.present || 0,
      month_absent: rate?.absent || 0,
      month_late: rate?.late || 0,
      suggested_pay: suggested,
      period_from: periodFrom,
      accrued_days: worked,
      worked_days: worked,
      late_pct: pen.late_pct,
      late_penalty: minuteDeduction,
      late_minutes: lateMinutesTotal,
      late_penalty_units: 0,
      cycle_from: rate?.from || periodFrom,
      discipline_hint: disc,
      cycle_late: lateDays,
    };
  });

  const summary = {
    present: rows.filter((r) => r.status === 'present' || r.status === 'late' || r.status === 'half').length,
    absent: rows.filter((r) => r.status === 'absent').length,
    late: rows.filter((r) => r.status === 'late').length,
    excused: rows.filter((r) => r.status === 'excused').length,
    total: rows.length,
  };

  return c.json({ success: true, data: { date, rows, summary, period_note: 'cycle' } });
});

app.post('/api/attendance/check-in', async (c) => {
  await ensureAttendanceSchema(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const employee_id = Number(body.employee_id || 0);
  if (!employee_id) return c.json({ success: false, error: 'Employé requis' }, 400);
  const date = String(body.date || moroccoTodayStr()).slice(0, 10);
  const time = String(body.time || moroccoNowTime()).slice(0, 8);
  const status = deriveAttendanceStatus(time, null, null);
  await c.env.DB.prepare(
    `INSERT INTO employee_attendance (employee_id, work_date, check_in, status, note, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(employee_id, work_date) DO UPDATE SET
       check_in = excluded.check_in,
       status = excluded.status,
       note = COALESCE(excluded.note, employee_attendance.note),
       updated_at = datetime('now')`
  ).bind(employee_id, date, time, status, String(body.note || '')).run();
  return c.json({ success: true, data: { check_in: time, work_date: date, status } });
});

app.post('/api/attendance/check-out', async (c) => {
  await ensureAttendanceSchema(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const employee_id = Number(body.employee_id || 0);
  if (!employee_id) return c.json({ success: false, error: 'Employé requis' }, 400);
  const date = String(body.date || moroccoTodayStr()).slice(0, 10);
  const time = String(body.time || moroccoNowTime()).slice(0, 8);
  const existing = await c.env.DB.prepare(
    `SELECT id, check_in, status FROM employee_attendance WHERE employee_id = ? AND work_date = ?`
  ).bind(employee_id, date).first() as any;
  const checkIn = existing?.check_in || time;
  const status = deriveAttendanceStatus(checkIn, time, null);
  if (!existing) {
    await c.env.DB.prepare(
      `INSERT INTO employee_attendance (employee_id, work_date, check_in, check_out, status, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`
    ).bind(employee_id, date, checkIn, time, status).run();
  } else {
    await c.env.DB.prepare(
      `UPDATE employee_attendance SET check_out = ?, status = ?, updated_at = datetime('now')
       WHERE employee_id = ? AND work_date = ?`
    ).bind(time, status, employee_id, date).run();
  }
  return c.json({ success: true, data: { check_out: time, work_date: date, status } });
});

/** Edit times / status / note for a day (manual correction) */
app.put('/api/attendance', async (c) => {
  { const off = await requireAttendanceEnabled(c); if (off) return off; }

  await ensureAttendanceSchema(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const employee_id = Number(body.employee_id || 0);
  if (!employee_id) return c.json({ success: false, error: 'Employé requis' }, 400);
  const date = String(body.date || moroccoTodayStr()).slice(0, 10);
  const check_in = body.check_in != null ? String(body.check_in).slice(0, 8) : null;
  const check_out = body.check_out != null ? String(body.check_out).slice(0, 8) : null;
  const note = body.note != null ? String(body.note).slice(0, 500) : '';
  const forced =
    body.force_status || ['absent', 'excused'].includes(String(body.status || '').toLowerCase())
      ? body.status
      : null;
  const status = deriveAttendanceStatus(check_in, check_out, forced);
  await c.env.DB.prepare(
    `INSERT INTO employee_attendance (employee_id, work_date, check_in, check_out, status, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(employee_id, work_date) DO UPDATE SET
       check_in = excluded.check_in,
       check_out = excluded.check_out,
       status = excluded.status,
       note = excluded.note,
       updated_at = datetime('now')`
  ).bind(employee_id, date, check_in, check_out, status, note).run();
  return c.json({ success: true, data: { employee_id, work_date: date, check_in, check_out, status, note } });
});

/** Mark all without entry as absent for the day */
app.post('/api/attendance/mark-absent-missing', async (c) => {
  await ensureAttendanceSchema(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const date = String(body.date || moroccoTodayStr()).slice(0, 10);
  const employees = await c.env.DB.prepare(
    `SELECT id FROM employees WHERE COALESCE(active,1)=1`
  ).all();
  let n = 0;
  for (const e of (employees.results || []) as any[]) {
    const exists = await c.env.DB.prepare(
      `SELECT id FROM employee_attendance WHERE employee_id = ? AND work_date = ?`
    ).bind(e.id, date).first();
    if (!exists) {
      await c.env.DB.prepare(
        `INSERT INTO employee_attendance (employee_id, work_date, status, note, updated_at)
         VALUES (?, ?, 'absent', 'Marqué absent (auto)', datetime('now'))`
      ).bind(e.id, date).run();
      n += 1;
    }
  }
  return c.json({ success: true, data: { marked: n, date } });
});


/** Individual attendance record: scope=cycle|career */
app.get('/api/attendance/record/:employeeId', async (c) => {
  { const off = await requireAttendanceEnabled(c); if (off) return off; }

  await ensureAttendanceSchema(c.env.DB);
  try { await ensureEmployeeTeamColumn(c.env.DB); } catch { /* */ }
  const employeeId = Number(c.req.param('employeeId') || 0);
  if (!employeeId) return c.json({ success: false, error: 'Employé requis' }, 400);
  const scope = String(c.req.query('scope') || 'cycle').toLowerCase() === 'career' ? 'career' : 'cycle';
  const emp = await c.env.DB.prepare(
    `SELECT id, emp_number, first_name, last_name, name, role_title, team,
            pay_amount, pay_cycle_type, pay_cycle_days, last_paid_at, joined_date, returned_at
     FROM employees WHERE id = ?`
  ).bind(employeeId).first() as any;
  if (!emp) return c.json({ success: false, error: 'Employé introuvable' }, 404);

  const today = moroccoTodayStr();
  const cycle = emp.pay_cycle_type === 'days' ? Math.max(1, Number(emp.pay_cycle_days || 7)) : 30;
  const last = emp.last_paid_at ? String(emp.last_paid_at).slice(0, 10) : '';
  const joined = emp.joined_date ? String(emp.joined_date).slice(0, 10) : '';
  const ret = emp.returned_at ? String(emp.returned_at).slice(0, 10) : '';

  let from: string;
  if (scope === 'career') {
    from = joined || '2000-01-01';
  } else {
    // current pay cycle window
    if (last && /^\d{4}-\d{2}-\d{2}$/.test(last)) {
      const d = new Date(last + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + 1);
      from = d.toISOString().slice(0, 10);
    } else if (ret && /^\d{4}-\d{2}-\d{2}$/.test(ret)) {
      from = ret;
    } else {
      from = joined || today;
    }
  }

  const { results } = await c.env.DB.prepare(
    `SELECT work_date, check_in, check_out, status, note
     FROM employee_attendance
     WHERE employee_id = ? AND work_date >= ? AND work_date <= ?
     ORDER BY work_date DESC`
  ).bind(employeeId, from, today).all();

  const days = ((results || []) as any[]).map((r) => {
    const st = deriveAttendanceStatus(
      r.check_in,
      r.check_out,
      ['absent', 'excused'].includes(String(r.status || '').toLowerCase()) ? r.status : null,
    );
    return {
      work_date: r.work_date,
      check_in: r.check_in,
      check_out: r.check_out,
      status: st,
      note: r.note || '',
    };
  });

  let present = 0, late = 0, absent = 0, half = 0, excused = 0;
  for (const d of days) {
    if (d.status === 'late') late += 1;
    else if (d.status === 'absent') absent += 1;
    else if (d.status === 'half') half += 1;
    else if (d.status === 'excused') excused += 1;
    else if (d.status === 'present') present += 1;
  }
  const logged = days.length;
  const weight = present + late + excused + half * 0.5;
  const rate_pct = logged > 0 ? Math.round((weight / logged) * 1000) / 10 : 0;
  const payAmt = Number(emp.pay_amount || 0);
  const daily = cycle > 0 ? payAmt / cycle : 0;
  const rules = await loadAttendanceRules(c.env.DB);
  const disc = disciplineHint(late, rules);
  let lateMinutesTotal = 0;
  for (const d of days) {
    if (d.status === 'late' || d.status === 'present') {
      lateMinutesTotal += lateMinutesAfterThreshold(d.check_in, rules.late_threshold);
    }
  }
  const dayMins = Math.max(60, rules.workday_hours * 60);
  const minuteDeduction = rules.minute_deduct && daily > 0
    ? Math.round((lateMinutesTotal / dayMins) * daily * 100) / 100
    : 0;
  const presencePay = Math.round(Math.min(weight, cycle * 12) * daily * 100) / 100;
  const netSuggested = Math.max(0, Math.round((presencePay - minuteDeduction) * 100) / 100);
  const name = [emp.first_name, emp.last_name].filter(Boolean).join(' ') || emp.name || '—';

  return c.json({
    success: true,
    data: {
      employee: {
        id: emp.id,
        emp_number: emp.emp_number,
        name,
        role_title: emp.role_title,
        team: emp.team,
        pay_amount: payAmt,
        cycle_days: cycle,
      },
      scope,
      from,
      to: today,
      rules: {
        late_threshold: rules.late_threshold,
        pay_mode: rules.pay_mode,
        minute_deduct: rules.minute_deduct,
        warn_late_count: rules.warn_late_count,
        blame_late_count: rules.blame_late_count,
        workday_hours: rules.workday_hours,
      },
      summary: {
        logged,
        present,
        late,
        half,
        excused,
        absent,
        rate_pct,
        late_pct: logged > 0 ? Math.round((late / logged) * 1000) / 10 : 0,
        worked_days: weight,
        late_minutes: lateMinutesTotal,
        late_penalty: minuteDeduction,
        daily_rate: Math.round(daily * 100) / 100,
        net_suggested: netSuggested,
        discipline_hint: disc,
      },
      days,
    },
  });
});

app.get('/api/attendance/weekly', async (c) => {
  { const off = await requireAttendanceEnabled(c); if (off) return off; }

  await ensureAttendanceSchema(c.env.DB);
  try { await ensureEmployeeTeamColumn(c.env.DB); } catch { /* */ }
  const end = String(c.req.query('end') || moroccoTodayStr()).slice(0, 10);
  const daysN = Math.min(31, Math.max(7, Number(c.req.query('days') || 7)));
  const employeeId = Number(c.req.query('employee_id') || 0) || 0;
  const endD = new Date(end + 'T12:00:00Z');
  const days: { date: string; present: number; late: number; absent: number; total: number }[] = [];
  for (let i = daysN - 1; i >= 0; i--) {
    const d = new Date(endD);
    d.setUTCDate(d.getUTCDate() - i);
    const ds = d.toISOString().slice(0, 10);
    let att;
    if (employeeId) {
      att = await c.env.DB.prepare(
        `SELECT status, check_in, check_out FROM employee_attendance WHERE work_date = ? AND employee_id = ?`
      ).bind(ds, employeeId).all();
    } else {
      att = await c.env.DB.prepare(
        `SELECT status, check_in, check_out FROM employee_attendance WHERE work_date = ?`
      ).bind(ds).all();
    }
    let present = 0, late = 0, absent = 0;
    for (const r of (att.results || []) as any[]) {
      const st = deriveAttendanceStatus(
        r.check_in,
        r.check_out,
        ['absent', 'excused'].includes(String(r.status || '').toLowerCase()) ? r.status : null,
      );
      if (st === 'late') late += 1;
      else if (st === 'absent') absent += 1;
      else if (st === 'present' || st === 'half' || st === 'excused') present += 1;
    }
    let total = 1;
    if (!employeeId) {
      const empCount = await c.env.DB.prepare(
        `SELECT COUNT(*) as n FROM employees WHERE COALESCE(active,1)=1`
      ).first() as any;
      total = Number(empCount?.n || 0);
    }
    days.push({ date: ds, present, late, absent, total });
  }
  return c.json({ success: true, data: { days, employee_id: employeeId || null } });
});

app.get('/api/attendance/export', async (c) => {
  { const off = await requireAttendanceEnabled(c); if (off) return off; }

  await ensureAttendanceSchema(c.env.DB);
  const from = String(c.req.query('from') || moroccoTodayStr().slice(0, 8) + '01').slice(0, 10);
  const to = String(c.req.query('to') || moroccoTodayStr()).slice(0, 10);
  const format = String(c.req.query('format') || 'csv').toLowerCase();
  const { results } = await c.env.DB.prepare(
    `SELECT a.work_date, a.check_in, a.check_out, a.status, a.note,
            e.emp_number, e.first_name, e.last_name, e.name, e.role_title
     FROM employee_attendance a
     LEFT JOIN employees e ON e.id = a.employee_id
     WHERE a.work_date >= ? AND a.work_date <= ?
     ORDER BY a.work_date DESC, e.last_name, e.first_name`
  ).bind(from, to).all();
  const rows = (results || []) as any[];
  if (format === 'csv') {
    const header = 'date,emp_number,name,status,check_in,check_out,note';
    const lines = rows.map((r) => {
      const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.name || '';
      const st = deriveAttendanceStatus(r.check_in, r.check_out, ['absent','excused'].includes(String(r.status||'').toLowerCase()) ? r.status : null);
      const esc = (s: any) => `"${String(s ?? '').replace(/"/g, '""')}"`;
      return [r.work_date, r.emp_number, name, st, r.check_in, r.check_out, r.note].map(esc).join(',');
    });
    const body = [header, ...lines].join('\n');
    return new Response(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="presence_${from}_${to}.csv"`,
      },
    });
  }
  // HTML report for print/PDF
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const tr = rows.map((r) => {
    const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.name || '—';
    const st = deriveAttendanceStatus(r.check_in, r.check_out, ['absent','excused'].includes(String(r.status||'').toLowerCase()) ? r.status : null);
    return `<tr><td>${r.work_date}</td><td>${r.emp_number || ''}</td><td>${name}</td><td>${st}</td><td>${r.check_in || '—'}</td><td>${r.check_out || '—'}</td><td>${r.note || ''}</td></tr>`;
  }).join('');
  const body = `
  <p class="muted">Période ${from} → ${to} · ${rows.length} ligne(s)</p>
  <table>
    <thead><tr><th>Date</th><th>N°</th><th>Nom</th><th>Statut</th><th>Entrée</th><th>Sortie</th><th>Note</th></tr></thead>
    <tbody>${tr || '<tr><td colspan="7">Aucune donnée</td></tr>'}</tbody>
  </table>`;
  return c.html(reportShell('Rapport présence', settings?.company_name || 'Atlas Commerce', `${from} → ${to}`, body, settings?.report_footer));
});

app.post('/api/attendance/self-check', async (c) => {
  { const off = await requireAttendanceEnabled(c); if (off) return off; }

  await ensureAttendanceSchema(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const employee_id = Number(body.employee_id || 0);
  const action = String(body.action || 'in'); // in | out
  if (!employee_id) return c.json({ success: false, error: 'Employé requis' }, 400);
  const date = moroccoTodayStr();
  const time = moroccoNowTime();
  if (action === 'out') {
    const existing = await c.env.DB.prepare(
      `SELECT check_in, status FROM employee_attendance WHERE employee_id = ? AND work_date = ?`
    ).bind(employee_id, date).first() as any;
    const checkIn = existing?.check_in || time;
    const status = deriveAttendanceStatus(checkIn, time, existing?.status);
    await c.env.DB.prepare(
      `INSERT INTO employee_attendance (employee_id, work_date, check_in, check_out, status, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(employee_id, work_date) DO UPDATE SET
         check_out = excluded.check_out, status = excluded.status, updated_at = datetime('now')`
    ).bind(employee_id, date, checkIn, time, status).run();
    return c.json({ success: true, data: { action: 'out', check_out: time, date, status } });
  }
  const status = deriveAttendanceStatus(time, null, null);
  await c.env.DB.prepare(
    `INSERT INTO employee_attendance (employee_id, work_date, check_in, status, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(employee_id, work_date) DO UPDATE SET
       check_in = COALESCE(employee_attendance.check_in, excluded.check_in),
       status = excluded.status, updated_at = datetime('now')`
  ).bind(employee_id, date, time, status).run();
  return c.json({ success: true, data: { action: 'in', check_in: time, date, status } });
});



/* ─── Import bills (from seller invoice / Excel review) ─── */
app.post('/api/bills/import', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return c.json({ success: false, error: 'Aucune facture d\'achat à importer' }, 400);
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  let inserted = 0;
  const created: any[] = [];
  for (const row of rows) {
    const vendor_name = String(row.vendor_name || row.fournisseur || row.seller || '').trim();
    if (!vendor_name) continue;
    const items = Array.isArray(row.items) ? row.items : [];
    if (!items.length && !(row.total || row.montant)) continue;
    let subtotal = 0, tax_amount = 0;
    const lineItems: any[] = [];
    if (items.length) {
      for (const it of items) {
        const qty = Number(it.quantity || it.qte || 1);
        const price = Number(it.unit_price || it.prix || it.price || 0);
        const taxRate = Number(it.tax_rate ?? settings?.tax_rate ?? 0);
        const ht = qty * price;
        const tax = ht * (taxRate / 100);
        subtotal += ht; tax_amount += tax;
        lineItems.push({ product_name: it.product_name || it.designation || it.name || 'Article', quantity: qty, unit_price: price, tax_rate: taxRate, line_total: roundDh(ht + tax), sku: it.sku || '' });
      }
    } else {
      const total = Number(row.total || row.montant || 0);
      subtotal = total;
      lineItems.push({ product_name: row.description || 'Import facture fournisseur', quantity: 1, unit_price: total, tax_rate: 0, line_total: total, sku: '' });
    }
    subtotal = roundDh(subtotal); tax_amount = roundDh(tax_amount); const total = roundDh(subtotal + tax_amount);
    const prefix = settings?.bill_prefix || 'BILL-';
    const nextNum = settings?.next_bill_number || 1;
    const number = `${prefix}${String(nextNum).padStart(5, '0')}`;
    const issue_date = String(row.issue_date || row.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const due_date = row.due_date || null;
    const status = row.status === 'paid' ? 'paid' : 'sent';
    const amount_paid = status === 'paid' ? total : Number(row.amount_paid || 0);
    const result = await c.env.DB.prepare(
      `INSERT INTO bills (number, vendor_id, vendor_name, issue_date, due_date, status, subtotal, tax_amount, total, amount_paid, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(number, null, vendor_name, issue_date, due_date, status, subtotal, tax_amount, total, amount_paid, row.notes || 'Import').run();
    const billId = result.meta.last_row_id;
    for (const it of lineItems) {
      await c.env.DB.prepare(
        `INSERT INTO bill_items (bill_id, product_id, product_name, sku, quantity, unit_price, tax_rate, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(billId, null, it.product_name, it.sku, it.quantity, it.unit_price, it.tax_rate, it.line_total).run();
    }
    await c.env.DB.prepare(`UPDATE company_settings SET next_bill_number = COALESCE(next_bill_number, 1) + 1 WHERE id = 1`).run();
    created.push({ id: billId, number, vendor_name, total });
    inserted++;
  }
  return c.json({ success: true, message: `${inserted} facture(s) d'achat importée(s).`, count: inserted, data: created });
});


/* ─── Excel / CSV exports (Excel FR: BOM + séparateur ;) ─── */
function csvEscape(v: any): string {
  if (v == null) return '';
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Excel FR expects comma decimals when using ; separator
    const s = String(v).replace('.', ',');
    return s;
  }
  const s = String(v);
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function toCsv(headers: string[], rows: any[][]): string {
  const bom = '\uFEFF';
  const lines = [headers.map(csvEscape).join(';')];
  for (const r of rows) lines.push(r.map(csvEscape).join(';'));
  return bom + lines.join('\r\n');
}
function csvFilename(base: string): string {
  const d = new Date().toISOString().slice(0, 10);
  return `${base}-${d}.csv`;
}

app.get('/api/export/invoices', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT number, client_name, issue_date, due_date, status, subtotal, tax_amount, total, amount_paid,
            (total - COALESCE(amount_paid,0)) as remaining, notes FROM invoices ORDER BY issue_date DESC, id DESC`
  ).all();
  const statusFr: Record<string, string> = {
    draft: 'Brouillon', quote: 'Devis', devis: 'Devis', sent: 'Envoyee', partial: 'Partielle',
    paid: 'Payee', overdue: 'En retard', cancelled: 'Annulee',
  };
  const rows = ((results || []) as any[]).map((r) => [
    r.number, r.client_name, r.issue_date, r.due_date, statusFr[r.status] || r.status,
    Number(r.subtotal || 0), Number(r.tax_amount || 0), Number(r.total || 0),
    Number(r.amount_paid || 0), Number(r.remaining || 0), r.notes || '',
  ]);
  const csv = toCsv(
    ['Numero', 'Client', 'Date emission', 'Echeance', 'Statut', 'Montant HT', 'TVA', 'Total TTC', 'Deja paye', 'Reste a payer', 'Notes'],
    rows,
  );
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="factures.csv"',
    },
  });
});

app.get('/api/export/products', async (c) => {
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  if (!session.username) {
    return c.json({ success: false, error: 'Authentification requise.' }, 401);
  }
  let results: any[] = [];
  try {
    const q = await c.env.DB.prepare(
      `SELECT sku, barcode, name, description, category, unit, cost, price, tax_rate,
              stock_quantity, low_stock_threshold, track_inventory, is_active,
              variant_label, parent_id
       FROM products
       ORDER BY COALESCE(category,''), name COLLATE NOCASE`
    ).all();
    results = (q.results || []) as any[];
  } catch {
    // Older schema without optional columns
    const q = await c.env.DB.prepare(
      `SELECT sku, name, category, unit, cost, price, stock_quantity, low_stock_threshold, is_active
       FROM products ORDER BY name`
    ).all();
    results = (q.results || []) as any[];
  }
  const rows = results.map((r) => {
    const stock = Number(r.stock_quantity ?? 0);
    const seuil = Number(r.low_stock_threshold ?? 0);
    const track = r.track_inventory == null || Number(r.track_inventory) === 1;
    let alerte = '';
    if (track) {
      if (stock <= 0) alerte = 'Rupture';
      else if (stock <= seuil) alerte = 'Stock bas';
      else alerte = 'OK';
    } else {
      alerte = 'Non suivi';
    }
    return [
      r.sku || '',
      r.barcode || '',
      r.name || '',
      r.description || '',
      r.category || '',
      r.unit || 'unité',
      r.variant_label || '',
      Number(r.cost ?? 0),
      Number(r.price ?? 0),
      r.tax_rate != null && r.tax_rate !== '' ? Number(r.tax_rate) : '',
      stock,
      seuil,
      track ? 'Oui' : 'Non',
      Number(r.is_active) === 0 ? 'Non' : 'Oui',
      alerte,
    ];
  });
  const csv = toCsv(
    [
      'SKU',
      'Code-barres',
      'Nom',
      'Description',
      'Catégorie',
      'Unité',
      'Variante',
      'Coût',
      'Prix vente',
      'TVA %',
      'Stock',
      'Seuil bas',
      'Suivi stock',
      'Actif',
      'Alerte',
    ],
    rows,
  );
  const fname = csvFilename('produits');
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fname}"`,
      'Cache-Control': 'no-store',
    },
  });
});

app.get('/api/export/expenses', async (c) => {
  await ensureExpenseTypeColumn(c.env.DB);
  const { results } = await c.env.DB.prepare(
    `SELECT expense_date, entry_type, category, description, amount, payment_method, vendor_name, notes FROM expenses ORDER BY expense_date DESC`
  ).all();
  const rows = ((results || []) as any[]).map((r) => [
    r.expense_date, r.entry_type, r.category, r.description, r.amount, r.payment_method, r.vendor_name, r.notes,
  ]);
  const csv = toCsv(
    ['Date', 'Type', 'Categorie', 'Libelle', 'Montant', 'Mode', 'Tiers', 'Notes'],
    rows,
  );
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="solde-mouvements.csv"',
    },
  });
});

app.get('/api/export/clients', async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT name, ice, if_number, address, city, phone, email FROM clients ORDER BY name`).all();
  const rows = ((results || []) as any[]).map((r) => [r.name, r.ice, r.if_number, r.address, r.city, r.phone, r.email]);
  const csv = toCsv(['Nom', 'ICE', 'IF', 'Adresse', 'Ville', 'Telephone', 'Email'], rows);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="clients.csv"',
    },
  });
});

app.get('/api/export/payments', async (c) => {
  await ensurePaymentHistoryTable(c.env.DB);
  const { results } = await c.env.DB.prepare(
    `SELECT p.paid_at, i.number, i.client_name, p.amount, p.payment_method, p.payee, p.note
     FROM invoice_payments p LEFT JOIN invoices i ON i.id = p.invoice_id
     ORDER BY p.paid_at DESC, p.id DESC`
  ).all();
  const rows = ((results || []) as any[]).map((r) => [
    r.paid_at, r.number, r.client_name, r.amount, r.payment_method, r.payee, r.note,
  ]);
  const csv = toCsv(['Date', 'Facture', 'Client', 'Montant', 'Mode', 'Beneficiaire', 'Note'], rows);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="paiements.csv"',
    },
  });
});

/**
 * Phase 5 — month pack for accountant / owner peace of mind.
 * JSON bundle: invoices, payments, stock moves, solde snapshot for YYYY-MM.
 * Optional format=csv returns a multi-section CSV (still one file).
 */
app.get('/api/export/month-pack', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  await ensurePaymentHistoryTable(c.env.DB);
  const month = String(c.req.query('month') || new Date().toISOString().slice(0, 7));
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return c.json({ success: false, error: 'Paramètre month=YYYY-MM requis' }, 400);
  }
  const from = `${month}-01`;
  // last day of month
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const to = `${month}-${String(last).padStart(2, '0')}`;
  const format = String(c.req.query('format') || 'json').toLowerCase();

  // invoices has tax_amount (not tax_rate) — tax_rate lives on line items / settings
  const invoices = await c.env.DB.prepare(
    `SELECT id, number, client_name, issue_date, due_date, status, total, amount_paid,
            COALESCE(tax_amount, 0) AS tax_amount, doc_kind
     FROM invoices WHERE issue_date >= ? AND issue_date <= ?
     ORDER BY issue_date, id`
  ).bind(from, to).all();

  const payments = await c.env.DB.prepare(
    `SELECT p.id, p.paid_at, p.amount, p.payment_method, p.payee, p.note, i.number as invoice_number, i.client_name
     FROM invoice_payments p
     LEFT JOIN invoices i ON i.id = p.invoice_id
     WHERE substr(p.paid_at, 1, 10) >= ? AND substr(p.paid_at, 1, 10) <= ?
     ORDER BY p.paid_at, p.id`
  ).bind(from, to).all();

  let stockMoves: any[] = [];
  try {
    const sm = await c.env.DB.prepare(
      `SELECT m.id, m.created_at, m.type, m.quantity, m.previous_quantity, m.new_quantity, m.reason, m.reference, p.name as product_name, p.sku
       FROM stock_movements m
       LEFT JOIN products p ON p.id = m.product_id
       WHERE substr(m.created_at, 1, 10) >= ? AND substr(m.created_at, 1, 10) <= ?
       ORDER BY m.created_at, m.id
       LIMIT 5000`
    ).bind(from, to).all();
    stockMoves = sm.results || [];
  } catch {
    stockMoves = [];
  }

  let expenses: any[] = [];
  try {
    const ex = await c.env.DB.prepare(
      `SELECT id, expense_date, entry_type, category, description, amount, payment_method, vendor_name
       FROM expenses WHERE expense_date >= ? AND expense_date <= ?
       ORDER BY expense_date, id`
    ).bind(from, to).all();
    expenses = ex.results || [];
  } catch {
    expenses = [];
  }

  const settings = await c.env.DB.prepare(`SELECT company_name, currency, starting_balance FROM company_settings WHERE id = 1`).first() as any;
  const invRows = (invoices.results || []) as any[];
  const payRows = (payments.results || []) as any[];
  const salesTotal = invRows
    .filter((i) => i.status !== 'cancelled' && i.status !== 'quote' && i.status !== 'devis' && i.doc_kind !== 'remboursement' && i.status !== 'remboursement')
    .reduce((s, i) => s + Number(i.total || 0), 0);
  const paidTotal = payRows.reduce((s, p) => s + Number(p.amount || 0), 0);
  const expenseTotal = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);

  const pack = {
    meta: {
      month,
      from,
      to,
      generated_at: new Date().toISOString(),
      company: settings?.company_name || 'Atlas Commerce',
      currency: settings?.currency || 'MAD',
      app: 'Atlas Commerce',
      phase: 5,
    },
    summary: {
      invoices_count: invRows.length,
      payments_count: payRows.length,
      stock_moves_count: stockMoves.length,
      expenses_count: expenses.length,
      sales_total: salesTotal,
      payments_total: paidTotal,
      expenses_total: expenseTotal,
      starting_balance: Number(settings?.starting_balance || 0),
    },
    invoices: invRows,
    payments: payRows,
    stock_moves: stockMoves,
    expenses,
  };

  if (format === 'csv') {
    const sections: string[] = [];
    sections.push('### RESUME');
    sections.push(toCsv(
      ['Mois', 'Factures', 'Paiements', 'Mvt stock', 'Depenses', 'CA', 'Encaisse', 'Depenses MAD'],
      [[month, pack.summary.invoices_count, pack.summary.payments_count, pack.summary.stock_moves_count, pack.summary.expenses_count, salesTotal, paidTotal, expenseTotal]],
    ));
    sections.push('\n### FACTURES');
    sections.push(toCsv(
      ['Numero', 'Client', 'Date', 'Echeance', 'Statut', 'Total', 'Paye'],
      invRows.map((r) => [r.number, r.client_name, r.issue_date, r.due_date, r.status, r.total, r.amount_paid]),
    ));
    sections.push('\n### PAIEMENTS');
    sections.push(toCsv(
      ['Date', 'Facture', 'Client', 'Montant', 'Mode', 'Beneficiaire', 'Note'],
      payRows.map((r) => [r.paid_at, r.invoice_number, r.client_name, r.amount, r.payment_method, r.payee, r.note]),
    ));
    sections.push('\n### STOCK');
    sections.push(toCsv(
      ['Date', 'Produit', 'SKU', 'Type', 'Qte', 'Avant', 'Apres', 'Raison', 'Ref'],
      stockMoves.map((r: any) => [r.created_at, r.product_name, r.sku, r.type, r.quantity, r.previous_quantity, r.new_quantity, r.reason, r.reference]),
    ));
    const csv = sections.join('\n');
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="atlas-pack-${month}.csv"`,
      },
    });
  }

  const body = JSON.stringify(pack, null, 2);
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="atlas-pack-${month}.json"`,
    },
  });
});

/* ─── SPA Fallback ─── */


/* ─── Mobile handoffs (phone floor → PC operator) ─── */

async function ensureMobileActionsTable(db: D1Database) {
  await schemaOnce('ensureMobileActionsTable', async () => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS mobile_actions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('scan','stock_check','new_product','invoice')),
      title TEXT NOT NULL,
      detail TEXT DEFAULT '',
      barcode TEXT DEFAULT '',
      product_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','cancelled')),
      source TEXT DEFAULT 'mobile',
      created_by TEXT DEFAULT '',
      completed_by TEXT DEFAULT '',
      completed_at TEXT,
      meta_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_mobile_actions_status ON mobile_actions(status)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_mobile_actions_created ON mobile_actions(created_at DESC)`).run();

  });
}

/** List actions for PC inbox / phone "sent today" */
app.get('/api/mobile-actions', async (c) => {
  await ensureMobileActionsTable(c.env.DB);
  const status = c.req.query('status'); // pending | done | all
  const limit = Math.min(Number(c.req.query('limit') || 50), 200);
  const compact = c.req.query('compact') !== '0';
  let sql = `SELECT * FROM mobile_actions`;
  const binds: any[] = [];
  if (status && status !== 'all') {
    sql += ` WHERE status = ?`;
    binds.push(status);
  }
  sql += ` ORDER BY datetime(created_at) DESC LIMIT ?`;
  binds.push(limit);
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
  const rows = (results || []).map((row: any) => {
    if (!compact || !row?.meta_json) return row;
    try {
      const meta = JSON.parse(row.meta_json);
      let hasImage = false;
      const slim: any = { ...meta };
      if (typeof slim.image_data_url === 'string' && slim.image_data_url.length > 40) {
        hasImage = true;
        slim.has_image = true;
        delete slim.image_data_url;
      }
      if (slim.create_product_body && typeof slim.create_product_body === 'object') {
        slim.create_product_body = { ...slim.create_product_body };
        if (typeof slim.create_product_body.image_data_url === 'string' && slim.create_product_body.image_data_url.length > 40) {
          hasImage = true;
          slim.create_product_body.has_image = true;
          delete slim.create_product_body.image_data_url;
        }
      }
      return { ...row, meta_json: JSON.stringify(slim), has_image: hasImage };
    } catch {
      return row;
    }
  });
  return c.json({ success: true, data: rows, meta: { compact } }, 200, {
    'Cache-Control': 'private, max-age=8',
  });
});

app.get('/api/mobile-actions/stats', async (c) => {
  await ensureMobileActionsTable(c.env.DB);
  let pendingN: number | null = null;
  try {
    if (c.env.MOBILE_HUB) {
      const id = c.env.MOBILE_HUB.idFromName('atlas-main');
      const stub = c.env.MOBILE_HUB.get(id);
      const res = await stub.fetch('https://do/stats');
      if (res.ok) {
        const j = await res.json() as any;
        if (j?.data?.pending != null) pendingN = Number(j.data.pending);
      }
    }
  } catch { /* fall through to D1 */ }
  if (pendingN == null) {
    const pending = await c.env.DB.prepare(
      `SELECT COUNT(*) as n FROM mobile_actions WHERE status = 'pending'`
    ).first() as any;
    pendingN = Number(pending?.n || 0);
  }
  const today = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM mobile_actions WHERE date(created_at) = date('now')`
  ).first() as any;
  return c.json({
    success: true,
    data: {
      pending: pendingN,
      today: Number(today?.n || 0),
      source: pendingN != null ? 'do-or-d1' : 'd1',
    },
  });
});

app.get('/api/mobile-actions/:id', async (c) => {
  await ensureMobileActionsTable(c.env.DB);
  const id = Number(c.req.param('id'));
  if (!id) return c.json({ success: false, error: 'id invalide' }, 400);
  const row = await c.env.DB.prepare(`SELECT * FROM mobile_actions WHERE id = ?`).bind(id).first();
  if (!row) return c.json({ success: false, error: 'Action introuvable' }, 404);
  return c.json({ success: true, data: row });
});

/** Phone creates a handoff (scan unknown, stock check, new product request, invoice draft) */
app.post('/api/mobile-actions', async (c) => {
  await ensureMobileActionsTable(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const type = String(body.type || 'scan');
  if (!['scan', 'stock_check', 'new_product', 'invoice'].includes(type)) {
    return c.json({ success: false, error: 'type invalide' }, 400);
  }
  // Magasinier may scan / propose product / stock_check — not invoice / quick sale
  {
    const session = sessionUserFromHeader(c.req.header('Authorization'));
    if (normalizeRole(session.role) === 'stock' && type === 'invoice') {
      return c.json({
        success: false,
        error: 'Rôle magasinier : pas de vente rapide / facture. Demandez à un secrétaire.',
        code: 'FORBIDDEN_ROLE',
      }, 403);
    }
  }
  const title = String(body.title || '').trim();
  if (!title) return c.json({ success: false, error: 'title obligatoire' }, 400);
  const detail = String(body.detail || '');
  const barcode = String(body.barcode || '');
  const product_id = body.product_id != null ? Number(body.product_id) : null;
  // Promote large data-URL photos to R2 so list/D1 stay small and PC approve still sees the image
  let meta: any = body.meta && typeof body.meta === 'object' ? { ...body.meta } : {};
  try {
    const rawImg =
      (typeof meta.image_data_url === 'string' && meta.image_data_url) ||
      (meta.create_product_body && typeof meta.create_product_body.image_data_url === 'string'
        ? meta.create_product_body.image_data_url
        : '') ||
      '';
    if (rawImg.startsWith('data:image') && c.env.IMAGES) {
      const key = `pending/mobile/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const cdn = await uploadDataUrlImage(c.env.IMAGES, c.env, rawImg, key);
      if (cdn) {
        meta.image_url = cdn;
        meta.has_image = true;
        delete meta.image_data_url;
        if (meta.create_product_body && typeof meta.create_product_body === 'object') {
          meta.create_product_body = { ...meta.create_product_body };
          meta.create_product_body.image_url = cdn;
          delete meta.create_product_body.image_data_url;
        }
      }
    }
  } catch (e) {
    console.error('mobile_action_image_upload', e);
  }
  const meta_json = JSON.stringify(meta || {});
  const created_by = String(body.created_by || 'mobile');
  const source = String(body.source || 'mobile').toLowerCase().slice(0, 32);
  const sourceNorm = ['android', 'web', 'mobile', 'assist'].includes(source) ? source : 'mobile';
  const r = await c.env.DB.prepare(
    `INSERT INTO mobile_actions (type, title, detail, barcode, product_id, status, source, created_by, meta_json)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
  ).bind(type, title, detail, barcode, product_id, sourceNorm, created_by, meta_json).run();
  const row = await c.env.DB.prepare(`SELECT * FROM mobile_actions WHERE id = ?`).bind(r.meta.last_row_id).first();
  await syncMobileHub(c.env, {
    lastBarcode: barcode || null,
    lastProductId: product_id,
  });
  return c.json({ success: true, data: row }, 201);
});

/** PC operator completes a handoff (optionally applies stock from mobile count) */
app.post('/api/mobile-actions/:id/complete', async (c) => {
  await ensureMobileActionsTable(c.env.DB);
  const id = Number(c.req.param('id'));
  if (!id) return c.json({ success: false, error: 'id invalide' }, 400);
  const body = await c.req.json().catch(() => ({}));
  const completed_by = String(body.completed_by || 'pc');
  const existing = await c.env.DB.prepare(`SELECT * FROM mobile_actions WHERE id = ?`).bind(id).first() as any;
  if (!existing) return c.json({ success: false, error: 'Action introuvable' }, 404);
  if (existing.status === 'done') return c.json({ success: true, data: existing, message: 'Déjà traitée' });

  // Cycle batch (H) or single stock_check apply
  let metaParsed: any = {};
  try { metaParsed = existing.meta_json ? JSON.parse(existing.meta_json) : {}; } catch { /* */ }
  if (body.apply_stock && metaParsed.cycle_batch && Array.isArray(metaParsed.lines)) {
    for (const line of metaParsed.lines.slice(0, 200)) {
      const productId = Number(line.product_id);
      const counted = Number(line.counted_qty);
      if (!productId || !Number.isFinite(counted) || counted < 0) continue;
      const prod = await c.env.DB.prepare(
        `SELECT stock_quantity, track_inventory, name FROM products WHERE id = ?`
      ).bind(productId).first() as any;
      if (!prod?.track_inventory) continue;
      const prev = Number(prod.stock_quantity || 0);
      const delta = counted - prev;
      if (Math.abs(delta) > 1e-9) {
        await applyStockDelta(
          c.env.DB,
          productId,
          delta,
          `Inventaire lot mobile → PC (${prev}→${counted})`,
          `mobile_action:${id}`,
          { createdBy: completed_by, type: 'adjustment', allowNegative: true, env: c.env }
        );
      }
    }
  } else if (body.apply_stock && (body.product_id || existing.product_id)) {
    const productId = Number(body.product_id || existing.product_id);
    let proposed = body.proposed_stock != null ? Number(body.proposed_stock) : NaN;
    if (!Number.isFinite(proposed) && metaParsed.proposed_stock != null) {
      proposed = Number(metaParsed.proposed_stock);
    }
    if (Number.isFinite(proposed) && proposed >= 0 && productId) {
      const prod = await c.env.DB.prepare(
        `SELECT stock_quantity, track_inventory FROM products WHERE id = ?`
      ).bind(productId).first() as any;
      if (prod) {
        const prev = Number(prod.stock_quantity || 0);
        const delta = proposed - prev;
        if (Math.abs(delta) > 1e-9) {
          await applyStockDelta(
            c.env.DB,
            productId,
            delta,
            'Ajustement stock (mobile → PC)',
            `mobile_action:${id}`,
            { createdBy: completed_by, type: 'adjustment', allowNegative: false, env: c.env }
          );
        } else {
          await c.env.DB.prepare(
            `UPDATE products SET updated_at = datetime('now') WHERE id = ?`
          ).bind(productId).run();
        }
      }
    }
  }

  await c.env.DB.prepare(
    `UPDATE mobile_actions SET status = 'done', completed_by = ?, completed_at = datetime('now') WHERE id = ?`
  ).bind(completed_by, id).run();
  if (body.apply_stock) {
    await invalidateDashboardCache(c.env.CACHE);
  }
  await syncMobileHubPending(c.env);
  const row = await c.env.DB.prepare(`SELECT * FROM mobile_actions WHERE id = ?`).bind(id).first() as any;
  // Push to the phone user who created the request
  try {
    const target = String(existing.created_by || '').trim();
    if (target) {
      await notifyAssistApproval(
        c.env,
        target,
        'Action validée',
        String(existing.title || 'Votre demande a été traitée sur le PC.'),
        { type: 'action_approved', action_id: String(id) },
      );
    }
  } catch (e) {
    console.error('action_approved_push', e);
  }
  return c.json({ success: true, data: row });
});

/** PC rejects a handoff — phone sees cancelled + reason */
app.post('/api/mobile-actions/:id/reject', async (c) => {
  const gate = requireBizMutator(c);
  if (!gate.ok) return gate.response;
  await ensureMobileActionsTable(c.env.DB);
  const id = Number(c.req.param('id'));
  if (!id) return c.json({ success: false, error: 'id invalide' }, 400);
  const body = await c.req.json().catch(() => ({}));
  const reason = String(body.reason || body.reject_reason || '').trim().slice(0, 400);
  if (!reason) return c.json({ success: false, error: 'Motif de refus obligatoire' }, 400);
  const existing = await c.env.DB.prepare(`SELECT * FROM mobile_actions WHERE id = ?`).bind(id).first() as any;
  if (!existing) return c.json({ success: false, error: 'Action introuvable' }, 404);
  if (existing.status === 'done') {
    return c.json({ success: false, error: 'Déjà traitée — impossible de refuser' }, 400);
  }
  if (existing.status === 'cancelled') {
    return c.json({ success: true, data: existing, message: 'Déjà refusée' });
  }
  let meta: any = {};
  try { meta = existing.meta_json ? JSON.parse(existing.meta_json) : {}; } catch { meta = {}; }
  meta.reject_reason = reason;
  meta.rejected_at = new Date().toISOString();
  meta.rejected_by = gate.username;
  await c.env.DB.prepare(
    `UPDATE mobile_actions
     SET status = 'cancelled', completed_by = ?, completed_at = datetime('now'), meta_json = ?,
         detail = CASE WHEN detail IS NULL OR detail = '' THEN ? ELSE detail || ' | Refus: ' || ? END
     WHERE id = ?`
  ).bind(gate.username, JSON.stringify(meta), `Refus: ${reason}`, reason, id).run();
  await syncMobileHubPending(c.env);
  const row = await c.env.DB.prepare(`SELECT * FROM mobile_actions WHERE id = ?`).bind(id).first();
  return c.json({ success: true, data: row, message: 'Demande refusée.' });
});

/**
 * Batch cycle-count from phone (magasinier).
 * body: { lines: [{ product_id, counted_qty }], note?, apply?: boolean }
 * If apply=false (default for stock role), queues one mobile-action for PC.
 * If apply=true (secretaire/owner), applies immediately.
 */
app.post('/api/inventory/cycle-count/batch', async (c) => {
  const gate = requireFloorStock(c);
  if (!gate.ok) return gate.response;
  const body = await c.req.json().catch(() => ({}));
  const lines = Array.isArray(body.lines) ? body.lines : [];
  if (!lines.length) return c.json({ success: false, error: 'Aucune ligne à compter' }, 400);
  const note = String(body.note || 'Inventaire lot').slice(0, 200);
  const forceApply = body.apply === true && canMutateBusiness(gate.role);

  if (!forceApply) {
    await ensureMobileActionsTable(c.env.DB);
    const detail = lines
      .slice(0, 40)
      .map((l: any) => `p${l.product_id}=${l.counted_qty}`)
      .join('; ');
    const r = await c.env.DB.prepare(
      `INSERT INTO mobile_actions (type, title, detail, barcode, product_id, status, source, created_by, meta_json)
       VALUES ('stock_check', ?, ?, '', NULL, 'pending', 'mobile', ?, ?)`
    ).bind(
      `Inventaire ${lines.length} produit(s)`,
      detail.slice(0, 500),
      gate.username,
      JSON.stringify({ cycle_batch: true, lines, note }),
    ).run();
    await syncMobileHubPending(c.env);
    const row = await c.env.DB.prepare(`SELECT * FROM mobile_actions WHERE id = ?`).bind(r.meta.last_row_id).first();
    return c.json({ success: true, data: row, message: 'Inventaire envoyé au PC pour validation.', queued: true }, 201);
  }

  const results: any[] = [];
  for (const line of lines.slice(0, 200)) {
    const productId = Number(line.product_id);
    const counted = Number(line.counted_qty);
    if (!productId || !Number.isFinite(counted) || counted < 0) continue;
    const prod = await c.env.DB.prepare(`SELECT stock_quantity, track_inventory, name FROM products WHERE id = ?`).bind(productId).first() as any;
    if (!prod?.track_inventory) continue;
    const theoretical = Number(prod.stock_quantity || 0);
    const delta = counted - theoretical;
    if (Math.abs(delta) < 1e-9) {
      results.push({ product_id: productId, delta: 0 });
      continue;
    }
    await applyStockDelta(c.env.DB, productId, delta, `Inventaire ${theoretical}→${counted} — ${note}`, 'cycle-count', {
      type: 'adjustment',
      allowNegative: true,
      createdBy: gate.username,
      env: c.env,
    });
    results.push({ product_id: productId, delta, counted, theoretical });
  }
  await afterBusinessMutation(c.env.CACHE);
  return c.json({ success: true, data: results, message: `${results.length} ligne(s) inventoriée(s).` });
});

/** Dashboard counters including pending mobile handoffs */

app.get('/api/hub/snapshot', async (c) => {
  try {
    if (c.env.MOBILE_HUB) {
      const id = c.env.MOBILE_HUB.idFromName('atlas-main');
      const stub = c.env.MOBILE_HUB.get(id);
      const res = await stub.fetch('https://do/snapshot');
      if (res.ok) {
        const j = await res.json() as any;
        return c.json({ success: true, data: j.data || j, meta: { source: 'do' } });
      }
    }
  } catch { /* fall through */ }
  // D1 fallback
  await ensureMobileActionsTable(c.env.DB);
  const pending = await c.env.DB.prepare(`SELECT COUNT(*) as n FROM mobile_actions WHERE status = 'pending'`).first() as any;
  const products = await c.env.DB.prepare(
    `SELECT COUNT(*) as count,
            COALESCE(SUM(CASE WHEN is_active = 1 AND track_inventory = 1 AND stock_quantity <= low_stock_threshold THEN 1 ELSE 0 END), 0) as low,
            COALESCE(SUM(CASE WHEN is_active = 1 THEN stock_quantity * cost ELSE 0 END), 0) as stock_value
     FROM products`
  ).first() as any;
  return c.json({
    success: true,
    data: {
      pending: Number(pending?.n || 0),
      productCount: Number(products?.count || 0),
      lowStock: Number(products?.low || 0),
      stockValue: Number(products?.stock_value || 0),
      lastBarcode: null,
      lastProductId: null,
      lastActionAt: null,
      updatedAt: null,
    },
    meta: { source: 'd1' },
  });
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


/* ─── Invoice HTML Template ─── */


async function ensureDocAssetColumns(db: D1Database) {
  await schemaOnce('doc_asset_cols', async () => {
    for (const col of ['company_signature_url', 'company_stamp_url', 'numbering_style', 'numbering_pad', 'next_bill_number']) {
      await addColumnIfMissing(db, 'company_settings', col, 'TEXT');
    }
  });
}

function companyStampBlock(settings: any): string {
  const parts: string[] = [];
  // Company signature / stamp only — no client signature placeholder on print/PDF
  if (settings?.company_signature_url) {
    parts.push(`<div style="text-align:center"><img src="${settings.company_signature_url}" alt="Signature" style="max-height:64px;max-width:160px"/><div style="font-size:10px;margin-top:4px">Signature société</div></div>`);
  } else {
    parts.push(`<div style="text-align:center;min-width:140px"><div style="height:64px;border-bottom:1px solid #333;margin:0 8px"></div><div style="font-size:10px;margin-top:6px">Signature société</div></div>`);
  }
  if (settings?.company_stamp_url) {
    parts.push(`<div style="text-align:center"><img src="${settings.company_stamp_url}" alt="Cachet" style="max-height:72px;max-width:120px"/><div style="font-size:10px;margin-top:4px">Cachet</div></div>`);
  } else {
    parts.push(`<div style="text-align:center;min-width:100px"><div style="height:72px;width:90px;margin:0 auto;border:1px dashed #999;border-radius:50%;width:56px;height:56px"></div><div style="font-size:9px;margin-top:4px">Cachet</div></div>`);
  }
  return `<div style="display:flex;gap:16px;justify-content:flex-end;align-items:flex-end;margin-top:8px;page-break-inside:avoid">${parts.join('')}</div>`;
}

/** REÇU — Phase 3 Jobber-style proof of payment (QR kept) */

function generateReceiptHTMLMinimal(settings: any, r: any, clientStatusUrl?: string, verifyUrl?: string): string {
  const formatDate = (d: string) => {
    if (!d) return '';
    const [y, m, day] = String(d).split('-');
    return day && m && y ? `${day}/${m}/${y}` : d;
  };
  const cur = settings?.currency || 'MAD';
  const fmt = (n: number) => Math.round(Number(n || 0)).toLocaleString('fr-FR');
  const methodLabel = ({
    cash: 'Espèces', bank: 'Virement', bank_company: 'Virement', bank_owner: 'Virement',
    check: 'Chèque', check_company: 'Chèque', check_owner: 'Chèque', card: 'Carte', other: 'Autre',
  } as Record<string, string>)[r.payment_method || ''] || (r.payment_method || '—');
  const verifyQr = verifyUrl ? atlasQrImg('', verifyUrl, 88) : '';

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/><title>Reçu ${r.number || ''}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"Courier New",Courier,monospace;color:#111;background:#fff;padding:16px;max-width:320px;margin:0 auto;font-size:12px;line-height:1.35}
h1{font-size:14px;text-align:center;margin-bottom:6px;text-transform:uppercase;letter-spacing:.06em}
.center{text-align:center}
.muted{color:#444;font-size:11px}
.hr{border:0;border-top:1px dashed #333;margin:10px 0}
.row{display:flex;justify-content:space-between;gap:8px;margin:3px 0}
.big{font-size:18px;font-weight:700;text-align:center;margin:10px 0}
.no-print button{background:#111;color:#fff;border:0;padding:8px 12px;width:100%;font-weight:600;cursor:pointer;margin-bottom:10px}
@media print{.no-print{display:none!important} body{padding:0;max-width:none} @page{size:A4;margin:7mm} .qr-card{padding:6px!important;margin-top:8px!important} .sign-area{margin-top:10px!important}}
</style></head><body>
<div class="no-print"><button type="button" onclick="window.print()">Imprimer ticket minimal</button></div>
<h1>${settings?.company_name || 'Reçu'}</h1>
<p class="center muted">${settings?.city || ''}</p>
<hr class="hr"/>
<div class="row"><span>N° reçu</span><strong>${r.number || '—'}</strong></div>
<div class="row"><span>Date</span><span>${formatDate(r.issue_date || '')}</span></div>
<div class="row"><span>Client</span><span>${r.client_name || '—'}</span></div>
${r.invoice_number ? `<div class="row"><span>Facture</span><span>${r.invoice_number}</span></div>` : ''}
<div class="row"><span>Mode</span><span>${methodLabel}</span></div>
<hr class="hr"/>
<div class="big">${fmt(Number(r.amount))} ${cur}</div>
<p class="center muted">Montant reçu</p>
<hr class="hr"/>
${verifyQr ? `<p class="center"><img src="${verifyQr}" width="80" height="80" alt="QR"/><br/><span class="muted">Vérification</span></p>
<p class="muted" style="font-size:10px;margin-top:8px"><a href="/privacy">Confidentialité</a> · QR situation optionnel et limité dans le temps</p>` : ''}
<p class="center muted" style="margin-top:10px">Merci · ticket simplifié</p>
<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script>
</body></html>`;
}

function generateReceiptHTML(settings: any, r: any, clientStatusUrl?: string, verifyUrl?: string): string {
  const formatDate = (d: string) => {
    if (!d) return '';
    const [y, m, day] = String(d).split('-');
    return day && m && y ? `${day}/${m}/${y}` : d;
  };
  const cur = settings?.currency || 'MAD';
  const fmt = (n: number) => Math.round(Number(n || 0)).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const logoBlock = settings?.logo_url
    ? `<img src="${settings.logo_url}" alt="logo" style="max-height:52px;max-width:160px;display:block;margin-bottom:6px" />`
    : '';
  const methodLabel = ({
    cash: 'Espèces (caisse)', bank: 'Virement', bank_company: 'Virement société', bank_owner: 'Virement propriétaire',
    check: 'Chèque', check_company: 'Chèque société', check_owner: 'Chèque propriétaire', card: 'Carte', other: 'Autre',
  } as Record<string, string>)[r.payment_method || ''] || (r.payment_method || '—');
  const sellerIds = [['ICE', settings?.ice], ['IF', settings?.if_number], ['RC', settings?.rc], ['TP', settings?.patente]]
    .filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ');

  const verifyQr = verifyUrl ? atlasQrImg('', verifyUrl, 100) : '';
  const statusQr = clientStatusUrl ? atlasQrImg('', clientStatusUrl, 100) : '';

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/><title>Reçu ${r.number || ''}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;padding:6px 10px;max-width:720px;margin:0 auto;font-size:12px;line-height:1.3}
.zone{border:1px solid #000;border-radius:2px;padding:8px 10px;margin-bottom:8px}
.zone h3{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#355;margin-bottom:8px;font-weight:700}
.top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:8px}
.co-name{font-size:18px;font-weight:800}
.co-meta{font-size:12px;color:#355;margin-top:4px}
.receipt-pill{background:#000;color:#fff;padding:8px 12px;border-radius:2px;min-width:160px}
.receipt-pill .t{font-size:11px;text-transform:uppercase;letter-spacing:.08em;opacity:.9}
.receipt-pill .n{font-size:18px;font-weight:800;margin-top:4px}
.receipt-pill .d{font-size:12px;margin-top:4px;opacity:.9}
.paid{text-align:center;padding:10px;border:2px solid #000;background:#fff;margin:8px 0}
.paid .l{font-size:11px;text-transform:uppercase;letter-spacing:.1em}
.paid .v{font-size:32px;font-weight:800;margin-top:6px}
table.lines{width:100%;border-collapse:collapse;margin:4px 0 8px}
table.lines th{background:#1a1d26;color:#fff;text-align:left;padding:9px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
table.lines td{padding:9px 10px;border-bottom:1px solid #e2e8f0;font-size:12.5px}
.num{text-align:right;font-variant-numeric:tabular-nums}
.pay-box{border:1px solid #000;padding:14px 16px;background:#fafcfb}
.pay-box h3{font-size:12px;margin-bottom:8px}
.pay-row{display:flex;justify-content:space-between;padding:5px 0;font-size:13px;border-bottom:1px solid #e0ebe5}
.pay-row:last-child{border:0;font-weight:700;font-size:15px;padding-top:8px}
.thanks{font-size:11px;font-style:italic;color:#333;margin:6px 0}
.qr-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
.qr-card{display:flex;gap:6px;align-items:center;padding:4px 6px;border:1px solid #000;border-radius:2px;background:#fff;margin-top:4px}
.qr-card img{border:2px solid #fff;box-shadow:0 0 0 1px #1a1d26;flex-shrink:0}
.qr-card .meta{font-size:11.5px;line-height:1.4}
.footer{margin-top:8px;padding-top:6px;border-top:1px solid #000;font-size:9px;color:#333;display:flex;justify-content:space-between;gap:8px}
.watermark{position:fixed;inset:0;pointer-events:none;z-index:0;display:flex;align-items:center;justify-content:center;font-size:40px;font-weight:800;letter-spacing:0.12em;opacity:0.06;transform:rotate(-28deg);color:#000;text-transform:uppercase}
.sheet{position:relative;z-index:1}
.keep,.zone,.paid,.pay-box,.qr-grid,.qr-card{page-break-inside:avoid;break-inside:avoid}
table.lines thead{display:table-header-group}
table.lines tr{page-break-inside:avoid;break-inside:avoid}
@media print{
@page{size:A4;margin:6mm}
body{padding:0;max-width:none;font-size:11px;color:#000!important;background:#fff!important}
.no-print{display:none!important}
.watermark{display:none!important}
.zone,.paid,.pay-box,.qr-card{border-color:#000!important;background:#fff!important;box-shadow:none!important}
.receipt-pill,table.lines th{background:#000!important;color:#fff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.qr-card img{width:100px!important;height:100px!important}
.sign-area{margin-top:6px!important}
.thanks{margin:4px 0!important}
}
</style></head><body>
<div class="watermark" aria-hidden="true">RECU</div>
<div class="sheet">
<!-- Structure document: 1.En-tete 2.Parties 3.Lignes 4.Totaux 5.Notes/BPA 6.Verification QR 7.Signatures -->
<div class="no-print" style="margin-bottom:12px"><button type="button" onclick="window.print()" style="background:#1a1d26;color:#fff;border:0;padding:10px 16px;cursor:pointer;font-weight:600">Imprimer / PDF</button></div>

<!-- 1. Business details -->
<div class="top">
  <div>
    ${logoBlock}
    <div class="co-name">${settings?.company_name || ''}</div>
    <div class="co-meta">${[settings?.address, settings?.city, settings?.postal_code].filter(Boolean).join(', ')}</div>
    <div class="co-meta">${[settings?.phone, settings?.email].filter(Boolean).join(' · ')}</div>
    ${sellerIds ? `<div class="co-meta" style="margin-top:4px">${sellerIds}</div>` : ''}
  </div>
  <!-- 3. Receipt number + date -->
  <div class="receipt-pill">
    <div class="t">Reçu de paiement</div>
    <div class="n">${r.number || '—'}</div>
    <div class="d">Date : ${formatDate(r.issue_date || '')}</div>
  </div>
</div>

<!-- 2. Customer -->
<div class="zone">
  <h3>Client (destinataire)</h3>
  <strong style="font-size:15px">${r.client_name || '—'}</strong>
  ${r.client_ice ? `<div class="co-meta">ICE : ${r.client_ice}</div>` : ''}
  ${[r.client_address, r.client_city].filter(Boolean).length ? `<div class="co-meta">${[r.client_address, r.client_city].filter(Boolean).join(', ')}</div>` : ''}
  ${r.invoice_number ? `<div class="co-meta" style="margin-top:6px">Facture liée : <strong>${r.invoice_number}</strong></div>` : ''}
</div>

<!-- Amount highlight -->
<div class="paid">
  <div class="l">Montant reçu</div>
  <div class="v">${fmt(Number(r.amount))} ${cur}</div>
</div>

<!-- 4. Products / service line -->
${(() => {
  const items = Array.isArray(r._line_items) ? r._line_items : [];
  if (items.length) {
    const rows = items.map((it: any) => {
      const qty = Number(it.quantity || 0);
      const pu = Number(it.unit_price || 0);
      const lt = Number(it.line_total != null ? it.line_total : qty * pu);
      return `<tr>
        <td><strong>${it.product_name || '—'}</strong>${it.sku ? `<div class="co-meta">${it.sku}</div>` : ''}<div class="co-meta">${qty} × ${fmt(pu)} ${cur}</div></td>
        <td class="num">${fmt(lt)} ${cur}</td>
      </tr>`;
    }).join('');
    return `<table class="lines">
  <thead><tr><th>Désignation (détail facture)</th><th class="num" style="width:120px">Montant</th></tr></thead>
  <tbody>${rows}
    <tr><td><strong>Total encaissé sur ce reçu</strong>${r.invoice_number ? `<div class="co-meta">Facture ${r.invoice_number}</div>` : ''}</td>
    <td class="num"><strong>${fmt(Number(r.amount))} ${cur}</strong></td></tr>
  </tbody></table>`;
  }
  return `<table class="lines">
  <thead><tr><th>Désignation</th><th class="num" style="width:120px">Montant</th></tr></thead>
  <tbody>
    <tr>
      <td>
        <strong>Encaissement client</strong>
        ${r.invoice_number ? `<div class="co-meta">Règlement facture ${r.invoice_number}</div>` : `<div class="co-meta">Reçu de paiement</div>`}
      </td>
      <td class="num">${fmt(Number(r.amount))} ${cur}</td>
    </tr>
  </tbody>
</table>`;
})()}

<!-- 5. Thanks / notes -->
${r.notes ? `<div class="zone"><h3>Notes</h3><p>${r.notes}</p></div>` : ''}
<p class="thanks">Merci pour votre confiance.</p>

<!-- 6. Receipt for payment summary -->
<div class="pay-box">
  <h3>Récapitulatif de paiement</h3>
  <div class="pay-row"><span>Sous-total</span><span>${fmt(Number(r.amount))} ${cur}</span></div>
  <div class="pay-row"><span>Mode</span><span>${methodLabel}</span></div>
  <div class="pay-row"><span>Total reçu</span><span>${fmt(Number(r.amount))} ${cur}</span></div>
</div>

<!-- QR codes (kept) -->
<div class="qr-grid">
  ${verifyQr ? `<div class="qr-card">
    <img src="${verifyQr}" width="100" height="100" alt="QR vérification reçu" style="width:100px;height:100px;object-fit:contain"/>
    <div class="meta"><strong>Scanner — vérifier ce reçu</strong><br/>Authentifie le n° ${r.number || ''}<br/>Montant ${fmt(Number(r.amount))} ${cur}</div>
  </div>` : ''}
  ${statusQr ? `<div class="qr-card">
    <img src="${statusQr}" width="100" height="100" alt="QR situation" style="width:100px;height:100px;object-fit:contain"/>
    <div class="meta"><strong>Situation client</strong><br/>Factures payées et impayées de ce client.</div>
  </div>` : ''}
</div>

${companyStampBlock(settings)}
<div class="footer">
  <span>${sellerIds || ''}</span>
  <span>Preuve de paiement · Conservez ce reçu</span>
</div>
</div><!-- /.sheet -->
<script>window.onload=function(){setTimeout(function(){window.print()},350)}</script>
</body></html>`;
}


/**
 * Unified generator with clearly different skins:
 * - DEVIS: dashed, estimate, validity, no QR, no payment demand
 * - FACTURE: formal request for payment, due date, optional verification QR
 * - FACTURE D'ACHAT (bill): purchase from vendor, no QR
 */
/** Politique remboursement — affichée sur toute facture de vente (anciennes + nouvelles). */
const REFUND_POLICY_HTML = `
<div class="terms keep" style="margin-top:20px">
  <h3>Politique de remboursement</h3>
  <p><strong>Un remboursement sans motif valable n’est pas accepté</strong>, quelle que soit la situation.</p>
  <p>Motifs acceptés uniquement :</p>
  <ul style="margin:6px 0 6px 18px;padding:0">
    <li>Erreur de notre part (commande / facturation)</li>
    <li>Article cassé ou défectueux à l’envoi — non causé par le client</li>
    <li>Mauvais article / non conforme envoyé</li>
    <li>Quantité manquante à la livraison</li>
    <li>Dommage constaté à la réception (transport)</li>
  </ul>
  <p>Tout retour ou avoir (document WR) exige une explication détaillée. Sans justification claire, la demande est refusée.</p>
</div>`;

const REFUND_POLICY_TEXT =
  'Politique de remboursement : un remboursement sans motif valable n’est pas accepté. ' +
  'Motifs acceptés : erreur de notre part ; article cassé/défectueux envoyé (pas de votre fait) ; ' +
  'mauvais article / non conforme ; quantité manquante ; dommage transport. ' +
  'Une explication détaillée est obligatoire pour tout avoir WR.';


/** French amount in words (MAD) — for "Arrêté la présente facture…" */
function amountInWordsFr(n: number, currency = 'MAD'): string {
  const ones = ['zéro','un','deux','trois','quatre','cinq','six','sept','huit','neuf','dix','onze','douze','treize','quatorze','quinze','seize','dix-sept','dix-huit','dix-neuf'];
  const tens = ['','','vingt','trente','quarante','cinquante','soixante','soixante','quatre-vingt','quatre-vingt'];
  const under100 = (x: number): string => {
    if (x < 20) return ones[x];
    if (x < 70) {
      const t = Math.floor(x / 10), u = x % 10;
      if (u === 0) return tens[t];
      if (u === 1 && t !== 8) return tens[t] + ' et un';
      return tens[t] + '-' + ones[u];
    }
    if (x < 80) return 'soixante' + (x === 71 ? ' et onze' : '-' + ones[x - 60]);
    if (x < 100) {
      const u = x - 80;
      if (u === 0) return 'quatre-vingts';
      return 'quatre-vingt-' + ones[u];
    }
    return String(x);
  };
  const under1000 = (x: number): string => {
    if (x < 100) return under100(x);
    const h = Math.floor(x / 100), r = x % 100;
    const hs = h === 1 ? 'cent' : ones[h] + ' cent' + (r === 0 ? 's' : '');
    return r ? hs + ' ' + under100(r) : hs;
  };
  const abs = Math.round(Math.abs(Number(n) || 0));
  if (abs === 0) return `zéro ${currency === 'MAD' ? 'dirham' : currency}`;
  let s = '';
  const millions = Math.floor(abs / 1_000_000);
  const thousands = Math.floor((abs % 1_000_000) / 1000);
  const rest = abs % 1000;
  if (millions) s += (millions === 1 ? 'un million' : under1000(millions) + ' millions');
  if (thousands) {
    if (s) s += ' ';
    s += thousands === 1 ? 'mille' : under1000(thousands) + ' mille';
  }
  if (rest || !s) {
    if (s) s += ' ';
    s += under1000(rest);
  }
  const unit = currency === 'MAD' ? (abs > 1 ? 'dirhams' : 'dirham') : currency;
  return `${s} ${unit}`.replace(/\s+/g, ' ').trim();
}


/** Employee hire / dossier form — same visual language as invoice print (A4 commercial doc). */
function generateEmployeeFormHTML(settings: any, emp: any | null, opts?: { autoPrint?: boolean }): string {
  const eh = (s: any) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const filled = !!emp;
  const company = eh(settings?.company_name || 'Atlas Commerce');
  const logoSrc =
    typeof safeImageSrc === 'function' ? safeImageSrc(settings?.logo_url) : settings?.logo_url || '';
  // Small logo only — B&W print friendly (no colored chrome)
  const logoBlock = logoSrc
    ? `<img src="${logoSrc}" alt="" class="logo" />`
    : '';
  const cell = (key: string) => {
    const val = emp?.[key];
    if (filled && val != null && String(val).trim() !== '') {
      return `<span class="f">${eh(val)}</span>`;
    }
    return '<span class="b"></span>';
  };
  const name = filled
    ? eh([emp.first_name, emp.last_name].filter(Boolean).join(' ') || emp.name || '')
    : '';
  const pay =
    filled && emp?.pay_amount != null
      ? `${Number(emp.pay_amount).toLocaleString('fr-FR')} MAD`
      : '';
  const cycle = filled
    ? emp.pay_cycle_type === 'days'
      ? `Tous les ${emp.pay_cycle_days || 7} j`
      : 'Mensuel'
    : '';
  const autoPrint = opts?.autoPrint !== false;
  const title = filled ? 'FICHE EMPLOYÉ' : 'DOSSIER D’EMBAUCHE';
  const sub = filled
    ? 'Dossier du personnel'
    : 'À remplir avant embauche · CNSS / Code du travail';

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/><title>${title}${filled && emp?.emp_number ? ' ' + eh(emp.emp_number) : ''}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
@page{size:A4;margin:10mm}
html,body{height:100%}
body{
  font-family:Arial,Helvetica,sans-serif;
  color:#000;background:#fff;
  padding:0;max-width:190mm;margin:0 auto;
  font-size:8.5pt;line-height:1.25;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;
}
.sheet{min-height:277mm;display:flex;flex-direction:column}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;
  padding-bottom:6px;border-bottom:2px solid #000;margin-bottom:6px}
.logo{max-height:28px;max-width:90px;display:block;margin-bottom:3px;filter:grayscale(1)}
.company{font-size:10pt;font-weight:700;letter-spacing:0.02em}
.meta{font-size:7.5pt;color:#222;margin-top:2px;line-height:1.3}
.badge{text-align:right}
.badge .t{font-size:12pt;font-weight:800;letter-spacing:0.06em}
.badge .s{font-size:7.5pt;margin-top:2px}
.band{border:1px solid #000;padding:3px 6px;font-size:7.5pt;font-weight:600;
  margin-bottom:6px;background:#fff}
h2{font-size:8pt;font-weight:700;margin:6px 0 3px;padding:2px 0;
  border-bottom:1px solid #000;text-transform:uppercase;letter-spacing:0.04em}
table{width:100%;border-collapse:collapse;table-layout:fixed}
th,td{border:1px solid #000;padding:3px 5px;vertical-align:middle;font-size:8pt}
th{width:18%;text-align:left;font-weight:600;background:#fff}
td{height:16px}
.b{display:block;border-bottom:1px solid #000;min-height:12px;width:100%}
.f{font-weight:600}
.note{font-size:7pt;margin-top:6px;line-height:1.3;color:#111}
.sigs{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:8px}
.sig{border:1px solid #000;height:48px;padding:4px 6px}
.sig .l{font-size:7pt;font-weight:600;text-transform:uppercase}
.foot{margin-top:auto;padding-top:6px;border-top:1px solid #000;font-size:7pt;color:#333;
  display:flex;justify-content:space-between}
.actions{position:fixed;top:8px;right:8px;z-index:20}
.actions button{font-family:inherit;font-size:12px;padding:6px 12px;border:1px solid #000;
  background:#fff;color:#000;cursor:pointer;border-radius:4px}
@media print{
  body{padding:0;max-width:none}
  .actions{display:none!important}
  .sheet{min-height:auto}
  th,td,.band,.sig,.top{border-color:#000!important;background:#fff!important}
}
</style></head>
<body>
  <div class="actions"><button type="button" onclick="window.print()">Imprimer / PDF</button></div>
  <div class="sheet">
    <div class="top">
      <div>
        ${logoBlock}
        <div class="company">${company}</div>
        <div class="meta">
          ${settings?.address ? eh(settings.address) + ' · ' : ''}${[settings?.city, settings?.country].filter(Boolean).map(eh).join(' · ')}
          ${settings?.ice ? ' · ICE ' + eh(settings.ice) : ''}${settings?.tax_id ? ' · IF ' + eh(settings.tax_id) : ''}
        </div>
      </div>
      <div class="badge">
        <div class="t">${title}</div>
        <div class="s">${filled && emp?.emp_number ? 'N° ' + eh(emp.emp_number) : 'Document RH'}</div>
        <div class="s">${new Date().toLocaleDateString('fr-FR')}</div>
      </div>
    </div>
    <div class="band">${sub}</div>

    <h2>1. Identité</h2>
    <table>
      <tr><th>Nom</th><td>${cell('last_name')}</td><th>Prénom</th><td>${cell('first_name')}</td></tr>
      <tr><th>Nom complet</th><td colspan="3">${filled ? `<span class="f">${name}</span>` : '<span class="b"></span>'}</td></tr>
      <tr><th>Naissance</th><td>${cell('date_of_birth')}</td><th>Sexe</th><td>${cell('gender')}</td></tr>
      <tr><th>Nationalité</th><td>${cell('nationality')}</td><th>Situation fam.</th><td>${cell('marital_status')}</td></tr>
      <tr><th>CIN / ID</th><td>${cell('national_id')}</td><th>N° fiscal</th><td>${cell('tax_id')}</td></tr>
      <tr><th>Adresse</th><td colspan="3">${cell('address')}</td></tr>
      <tr><th>Ville</th><td>${cell('city')}</td><th>Tél. / E-mail</th><td>${cell('phone')}${filled && emp?.email ? ' · ' + eh(emp.email) : filled ? '' : ' / '}</td></tr>
    </table>

    <h2>2. CNSS &amp; banque</h2>
    <table>
      <tr><th>N° CNSS</th><td>${cell('cnss_number') || cell('social_insurance')}</td><th>AMO / assur.</th><td>${cell('health_insurance')}</td></tr>
      <tr><th>RIB</th><td colspan="3">${cell('rib')}</td></tr>
    </table>

    <h2>3. Emploi</h2>
    <table>
      <tr><th>Poste</th><td colspan="3">${cell('role_title')}</td></tr>
      <tr><th>Contrat</th><td>${cell('contract_type')}</td><th>Entrée</th><td>${cell('joined_date')}</td></tr>
      <tr><th>Essai (j)</th><td>${cell('trial_days')}</td><th>H / semaine</th><td>${cell('weekly_hours')}</td></tr>
      <tr><th>Salaire</th><td>${pay ? `<span class="f">${eh(pay)}</span>` : '<span class="b"></span>'}</td>
          <th>Cycle</th><td>${cycle ? `<span class="f">${eh(cycle)}</span>` : '<span class="b"></span>'}</td></tr>
      <tr><th>Fonctions</th><td colspan="3">${cell('job_description')}</td></tr>
    </table>

    <p class="note">${
      filled
        ? 'Document Atlas Commerce — dossier personnel. Vérifier CIN / RIB avant déclaration CNSS.'
        : 'Je certifie l’exactitude des informations et fournirai CIN/passeport, RIB et certificat d’aptitude pour la CNSS.'
    }</p>
    <div class="sigs">
      <div class="sig"><div class="l">Date</div></div>
      <div class="sig"><div class="l">${filled ? 'Signature salarié' : 'Signature candidat'}</div></div>
      <div class="sig"><div class="l">Visa employeur</div></div>
    </div>
    <div class="foot">
      <span>${company} — document interne</span>
      <span>Impression N&amp;B recommandée · 1 page A4</span>
    </div>
  </div>
  ${autoPrint ? '<script>window.addEventListener("load",function(){setTimeout(function(){try{window.print()}catch(e){}},350)});</script>' : ''}
</body></html>`;
}

app.get('/api/employees/form/print', async (c) => {
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  return c.html(generateEmployeeFormHTML(settings, null, { autoPrint: true }));
});

app.get('/api/employees/:id/form/print', async (c) => {
  const id = Number(c.req.param('id') || 0);
  if (!id) return c.html('<p>Employé manquant</p>', 400);
  const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
  const emp = await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(id).first() as any;
  if (!emp) return c.html('<p>Employé introuvable</p>', 404);
  return c.html(generateEmployeeFormHTML(settings, emp, { autoPrint: true }));
});


function generateInvoiceHTML(settings: any, inv: any, items: any[], title = 'FACTURE', autoPrint = true): string {
  const eh = escapeHtml;
  const pdfShow = (key: string, def = true) => {
    const v = settings?.[key];
    if (v === undefined || v === null || v === '') return def;
    return !(v === 0 || v === '0' || v === false || v === 'false');
  };
  const formatDate = (d: string) => {
    if (!d) return '';
    const [y, m, day] = String(d).split('-');
    if ((settings?.date_format || 'DD/MM/YYYY') === 'DD/MM/YYYY' && day && m) return `${day}/${m}/${y}`;
    if (settings?.date_format === 'MM/DD/YYYY' && day && m) return `${m}/${day}/${y}`;
    return d;
  };
  const cur = settings?.currency || 'MAD';
  const fmt = (n: number) => {
    const v = Math.round(Number(n || 0) * 100) / 100;
    const s = v.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${s} ${cur === 'MAD' ? 'MAD' : cur}`;
  };
  const isQuote = title === 'DEVIS' || inv.status === 'quote' || inv.status === 'devis';
  const isBill = title.includes('ACHAT') || !!inv.vendor_name;
  const isRefund =
    title.includes('REMBOURS') ||
    title.includes('WR') ||
    inv.status === 'remboursement' ||
    inv.doc_kind === 'remboursement';
  const isInvoice = !isQuote && !isBill;
  const partyName = inv.client_name || inv.vendor_name || '';
  const partyIce = inv.client_ice || inv.vendor_ice || '';
  const partyAddr = inv.client_address || inv.vendor_address || '';
  const partyCity = inv.client_city || '';
  const logoSrc = safeImageSrc(settings?.logo_url);
  const logoBlock = (pdfShow('pdf_show_logo', true) && logoSrc)
    ? `<img src="${logoSrc}" alt="logo" style="max-height:52px;max-width:160px;display:block;margin-bottom:8px" />`
    : '';
  const paidAmt = Number(inv.amount_paid || 0);
  const totalAmt = Number(inv.total || 0);
  const dueAmt = Math.max(0, totalAmt - paidAmt);
  const footerNote = settings?.pdf_footer_text || settings?.document_footer_note || settings?.report_footer || settings?.notes || '';

  // Theme per document type (custom accent overrides default)
  let accent = (settings?.pdf_accent_color && String(settings.pdf_accent_color).startsWith('#'))
    ? String(settings.pdf_accent_color)
    : '#1a1814';
  let ribbon = 'Facture — demande de règlement';
  let docLabel = 'FACTURE';
  let bodyExtra = '';
  if (isQuote) {
    accent = '#5c4a1f';
    ribbon = 'Devis — estimation (non facturé)';
    docLabel = 'DEVIS';
    bodyExtra = 'quote';
  } else if (isBill) {
    accent = '#1e3a5f';
    ribbon = "Facture d'achat — fournisseur";
    docLabel = "FACTURE D'ACHAT";
    bodyExtra = 'bill';
  } else if (isRefund) {
    accent = '#8a5520';
    ribbon = 'Remboursement / avoir (WR)';
    docLabel = 'REMBOURSEMENT (WR)';
    bodyExtra = 'refund';
  } else if (inv.doc_kind === 'quick_sale' || inv.doc_kind === 'ticket' || String(inv.number || '').startsWith('VR')) {
    accent = '#1a1d26';
    ribbon = inv.status === 'paid' ? 'Vente rapide — encaissée' : 'Vente rapide (caisse)';
    docLabel = 'VENTE RAPIDE';
    bodyExtra = 'quick_sale';
  } else {
    accent = '#1a1814';
    ribbon = inv.status === 'paid' ? 'Facture soldée' : 'Facture — à régler';
    docLabel = 'FACTURE';
    bodyExtra = 'invoice';
  }
  // B&W print-friendly (laser / N&B)
  accent = '#000';

  // QR on sales invoices, or any preview that passes preview_qr_text
  let qrBlock = '';
  const qrSource = String(inv.public_url || inv.preview_qr_text || '');
  if (qrSource && (isInvoice || inv.preview_qr) && pdfShow('pdf_show_qr', true)) {
    // public_url is already set to /api/public/verify?p=v1.invoice… by print route
    const qrPayload = qrSource;
    const qrUrl = atlasQrImg('', qrPayload, 100);
    qrBlock = `
    <div class="qr-panel">
      <img src="${qrUrl}" width="96" height="96" alt="QR verification ${inv.number || ''}" class="qr-img" style="width:96px;height:96px"/>
      <div class="qr-meta">
        <strong>Scanner pour vérifier ce document</strong>
        <div>${docLabel} <strong>${inv.number || ''}</strong>${bodyExtra === 'quick_sale' ? ' · ticket caisse VR' : ''}</div>
        <div>Client : ${eh(partyName || '—')} ${partyIce ? '· ICE ' + eh(partyIce) : ''}</div>
        <div>Total ${fmt(totalAmt)} ${cur} · Payé ${fmt(paidAmt)} · Reste ${fmt(dueAmt)}</div>
        <div class="qr-hint">${inv.preview_qr ? 'Scannez : le lecteur affiche le résumé (type, numéro, partie, total) tel qu’il est imprimé. Aperçu non contractuel.' : 'Page officielle de vérification (soldes à jour). Ce QR mène uniquement vers le domaine Atlas de l’émetteur — ne scannez pas d’autres codes.'}</div>
      </div>
    </div>`;
  }

  // v0.7 — second QR card: « situation client » sample on receipt previews
  let qrSitBlock = '';
  if (inv.preview_situation_qr && inv.preview_situation_text) {
    const sitUrl = atlasQrImg('', String(inv.preview_situation_text), 100);
    qrSitBlock = `
    <div class="qr-panel">
      <img src="${sitUrl}" width="96" height="96" alt="QR situation client (aperçu)" class="qr-img" style="width:96px;height:96px"/>
      <div class="qr-meta">
        <strong>Situation client</strong>
        <div>Factures payées et impayées de cette partie — tel qu'imprimé sur le reçu réel quand l'option est activée.</div>
        <div class="qr-hint">Aperçu non contractuel.</div>
      </div>
    </div>`;
  }

  const validity = isQuote && inv.due_date
    ? `<div style="margin-top:6px">Validité jusqu'au <strong>${formatDate(inv.due_date)}</strong></div>`
    : '';

  const paymentBox = isRefund
    ? `<div class="amount-banner quote" style="border-color:${accent};background:#fdf8f3">
          <span class="ab-label">Avoir / crédit</span>
          <span class="ab-value">Crédit client ${fmt(totalAmt)} ${cur}</span>
          <span class="ab-sub">Document miroir d’une facture — réduit le solde dû (ou rembourse si déjà payé). Stock rétabli pour les quantités listées.</span>
        </div>`
    : isInvoice
    ? `<div class="amount-banner ${dueAmt <= 0.001 ? 'paid' : 'due'}">
        ${dueAmt <= 0.001
          ? `<span class="ab-label">Statut</span><span class="ab-value">Payée intégralement</span>`
          : `<span class="ab-label">Reste dû</span><span class="ab-value">${fmt(dueAmt)} ${cur}</span>
             <span class="ab-sub">Payé ${fmt(paidAmt)} ${cur} sur ${fmt(totalAmt)} ${cur}</span>
             <span class="ab-sub" style="margin-top:6px"><strong>Réf. de paiement :</strong> ${inv.number || '—'} — indiquer cette référence sur le virement.</span>
             ${settings?.bank_iban ? `<span class="ab-sub"><strong>RIB / IBAN :</strong> ${settings.bank_iban}${settings?.bank_name ? ' · ' + settings.bank_name : ''}</span>` : ''}`}
      </div>`
    : isQuote
      ? `<div class="amount-banner quote">
          <span class="ab-label">Devis</span>
          <span class="ab-value">Document estimatif — non facturé</span>
          ${validity}
        </div>`
      : '';

  const partyLabel = isBill ? 'Fournisseur' : 'Client / Facturation';
  const sellerIds = [['ICE', settings?.ice], ['IF', settings?.if_number], ['RC', settings?.rc], ['TP', settings?.patente], ['CNSS', settings?.cnss]]
    .filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' · ');

  const docTax = Number(inv.tax_amount || 0);
  const isQuickDoc = bodyExtra === 'quick_sale' || inv.doc_kind === 'quick_sale' || inv.doc_kind === 'ticket' || String(inv.number || '').startsWith('VR');
  const showTax = !isQuickDoc && (docTax > 0.001 || (!inv.tax_exempt && Number(settings?.tax_rate || 20) > 0));
  const promoDiscount = (items || []).reduce((s: number, it: any) => {
    const qty = Number(it.quantity || 0);
    const list = Number(it.list_price || 0);
    const unit = Number(it.unit_price ?? it.unit_cost ?? 0);
    const discAmt = Number(it.discount_amount || 0);
    const fromList = list > unit ? (list - unit) * qty : 0;
    return s + (discAmt > 0 ? discAmt : fromList);
  }, 0);

  const lineRows = (items || []).map((it: any) => {
    const qty = Number(it.quantity || 0);
    const unitSold = Number(it.unit_price ?? it.unit_cost ?? 0);
    const list = Number(it.list_price || 0);
    const tax = isQuickDoc ? 0 : (it.tax_rate != null ? Number(it.tax_rate) : (showTax ? (Number(settings?.tax_rate) || 20) : 0));
    // Formal docs: prices HT + TVA breakdown (Moroccan commercial norm). VR: flat amounts.
    const puHt = list > unitSold ? list : (list > 0 ? list : unitSold);
    const factor = tax > 0 ? (1 + tax / 100) : 1;
    const lineHt = qty * puHt;
    const lineTtc = Number(it.line_total) > 0 ? Number(it.line_total) : (isQuickDoc ? qty * unitSold : lineHt * factor);
    const unitLabel = it.unit ? String(it.unit) : '';
    if (isQuickDoc || !showTax) {
      return `<tr>
      <td>
        <div class="prod-name">${eh(it.product_name || '—')}</div>
        ${it.sku ? `<div class="prod-sku">SKU ${eh(it.sku)}</div>` : ''}
      </td>
      <td class="center">${qty}${unitLabel ? ` ${eh(unitLabel)}` : ''}</td>
      <td class="num">${fmt(isQuickDoc ? unitSold : puHt)}</td>
      <td class="num">${fmt(lineTtc)}</td>
    </tr>`;
    }
    return `<tr>
      <td>
        <div class="prod-name">${eh(it.product_name || '—')}</div>
        ${it.sku ? `<div class="prod-sku">SKU ${eh(it.sku)}</div>` : ''}
      </td>
      <td class="center">${qty}${unitLabel ? ` ${eh(unitLabel)}` : ''}</td>
      <td class="num">${fmt(puHt)}</td>
      <td class="num">${fmt(lineHt)}</td>
      <td class="center">${tax}%</td>
      <td class="num">${fmt(lineTtc)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="${isQuickDoc || !showTax ? 4 : 6}">Aucune ligne</td></tr>`;

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"/><title>${docLabel} ${inv.number || ''}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;padding:10mm 12mm;max-width:210mm;margin:0 auto;font-size:10pt;line-height:1.3;-webkit-print-color-adjust:exact;print-color-adjust:exact}
/* Screen preview: mild sticky footer without forcing a full blank second page */
.sheet{
  position:relative;z-index:1;
  min-height:auto;
  display:block;
  padding:0;
  box-sizing:border-box;
}
.doc-main{display:block}
.doc-foot{display:block;margin-top:12px;padding-top:8px}
/* Default: allow natural page flow — do NOT avoid breaks on large wrappers */
.sheet,.doc-main,.doc-foot,.totals-wrap,.notes,.terms,.cgi-strip,.qr-panel,.amount-banner,.grid2,.top{
  break-inside:auto;page-break-inside:auto;
  break-before:auto;page-break-before:auto;
}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:4px}
.doc-title{font-size:20px;font-weight:800;letter-spacing:0.03em;color:#000;line-height:1.1}
${bodyExtra === 'quick_sale' ? `
.vr-banner{background:#000;color:#fff;padding:6px 10px;border-radius:2px;margin:0 0 8px;font-size:12px;display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;border:1px solid #000}
.vr-banner strong{font-size:13px;letter-spacing:.03em}
.vr-pill{display:inline-block;background:#fff;color:#000;font-weight:800;font-size:10px;padding:2px 8px;border:1px solid #000;border-radius:2px;text-transform:uppercase;letter-spacing:.04em}
table.lines th{background:#000!important}
.totals .grand{border-bottom-color:#000!important;color:#000}
` : ''}
.meta-table{font-size:12.5px;border-collapse:collapse}
.meta-table td{padding:2px 0 2px 16px;text-align:right}
.meta-table td:first-child{color:#666;font-weight:600;text-align:left;padding-left:0}
.rule{height:1px;background:#000;margin:6px 0 8px;border:0}
.seller{font-size:11px;margin-bottom:8px}
.seller .name{font-size:15px;font-weight:700}
.seller .ids{color:#555;font-size:11px;margin-top:4px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px}
.box h3{font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:#555;margin-bottom:8px;border-bottom:1px solid #ddd;padding-bottom:4px}
.box strong{font-size:14px}
.box div{font-size:12.5px;color:#333}
.amount-banner{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 12px;padding:6px 10px;margin:0 0 8px;border-radius:2px;border:1px solid #000;background:#fff}
.amount-banner.due{border-color:#000;background:#fff}
.amount-banner.paid{border-color:#000;background:#fff}
.amount-banner.quote{border-style:dashed;border-color:${accent}}
.ab-label{font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#666;font-weight:600}
.ab-value{font-size:15px;font-weight:800;color:#000}
.ab-sub{font-size:12px;color:#555;width:100%}
table.lines{width:100%;border-collapse:collapse;margin-top:4px}
table.lines th{background:#000;color:#fff;text-align:left;padding:5px 6px;font-size:10px;text-transform:uppercase;letter-spacing:0.04em;font-weight:600}
table.lines td{padding:4px 6px;border-bottom:1px solid #ccc;font-size:11px;vertical-align:top}
table.lines tr:nth-child(even) td{background:#fff}
.prod-name{font-weight:600}
.prod-sku{font-size:11px;color:#666;margin-top:2px}
.num{text-align:right;font-variant-numeric:tabular-nums}.center{text-align:center}
.totals-wrap{display:flex;justify-content:flex-end;margin-top:6px}
.totals{width:280px}
.totals .row{display:flex;justify-content:space-between;padding:3px 0;font-size:11px;border-bottom:1px solid #ddd}
.totals .grand{font-weight:800;font-size:13px;border-bottom:2px solid #000;padding-top:4px;margin-top:2px}
.notes{margin-top:8px;padding-top:6px;border-top:1px solid #000;font-size:11px}
.notes h3{font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#555;margin-bottom:6px}
.qr-panel{display:flex;gap:8px;align-items:center;margin-top:6px;padding:4px 6px;border:1px solid #000;border-radius:2px;background:#fff}
.qr-img{border:3px solid #fff;box-shadow:0 0 0 1px #0f1b2d;flex-shrink:0}
.qr-meta{font-size:12.5px;line-height:1.5}
.qr-hint{font-size:11px;color:#666;margin-top:4px}
.amount-words{margin:14px 0 0;font-size:12px;color:#333;line-height:1.45;max-width:100%}
.cgi-strip{margin-top:10px;font-size:10.5px;color:#555;line-height:1.4}
.terms{margin-top:6px;padding-top:6px;border-top:1px solid #000;font-size:9px;color:#333;line-height:1.35}
.terms h3{font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#333;margin-bottom:6px}
.bpa{margin-top:8px;padding:8px;border:1px dashed #000;border-radius:2px;background:#fff}
.bpa h3{font-size:13px;margin:0 0 6px;text-transform:uppercase;letter-spacing:.06em}
.bpa-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:8px}
.bpa-l{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#666;margin-bottom:6px}
.bpa-line{border-bottom:1px solid #333;min-height:28px}
.bpa-line.tall{min-height:56px}
.footer{margin-top:6px;font-size:9px;color:#777;display:flex;justify-content:space-between;gap:12px}
.watermark{
  position:fixed;inset:0;pointer-events:none;z-index:0;
  display:flex;align-items:center;justify-content:center;
  font-size:40px;font-weight:800;letter-spacing:0.12em;opacity:0.06;
  transform:rotate(-28deg);color:#111;text-transform:uppercase;
  user-select:none;
}
/* Only atomic units avoid mid-split — not whole sections */
.keep-tight{page-break-inside:avoid;break-inside:avoid}
table.lines thead{display:table-header-group}
table.lines tfoot{display:table-footer-group}
table.lines tr{page-break-inside:avoid;break-inside:avoid}
/* Signature box alone may stay together; large containers flow */
.bpa{page-break-inside:avoid;break-inside:avoid}

@media print{
  .no-print{display:none!important}
  html,body{height:auto!important}
  body{padding:0;margin:0;max-width:none;font-size:10.5px;color:#000!important;background:#fff!important}
  .sheet,.doc-main,.doc-foot{
    min-height:0!important;
    height:auto!important;
    display:block!important;
    margin-top:0!important;
    padding:0!important;
    /* Fill current page; break only when content exceeds bottom margin */
    break-inside:auto!important;
    page-break-inside:auto!important;
    break-before:auto!important;
    page-break-before:auto!important;
  }
  @page{size:A4;margin:10mm 12mm 10mm 12mm}
  .watermark{display:none!important}
  a{color:inherit;text-decoration:none}
  table.lines th,.vr-banner{background:#000!important;color:#fff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .amount-banner,.qr-panel,.bpa,.box,.notes{background:#fff!important;border-color:#000!important}
  .qr-img{width:88px!important;height:88px!important}
  .doc-title{font-size:18px!important}
  table.lines td{padding:3px 5px!important}
  /* Only the signature card stays unsplit — not the whole footer stack */
  .bpa,.keep-tight{page-break-inside:avoid;break-inside:avoid}
  table.lines tr{page-break-inside:avoid;break-inside:avoid}
}
@media(max-width:700px){.grid2,.top{grid-template-columns:1fr;flex-direction:column}.meta-table td{text-align:left!important}}
</style></head><body data-doc="${bodyExtra}">
<div class="watermark" aria-hidden="true">${docLabel}</div>
<div class="sheet">
${inv.preview_banner ? `<div style="border:1px solid #000;background:#fff8e8;color:#1a1814;padding:8px 10px;margin-bottom:10px;font-size:12px;line-height:1.45"><strong>Avertissement.</strong> ${eh(String(inv.preview_banner))}</div>` : ''}
<!-- 1. EN-TETE · 2. PARTIES · 3. LIGNES · 4. TOTAUX · 5. NOTES · 6. FOOT (conditions/BPA/QR/footer) -->
${autoPrint ? '' : `<div class="no-print" style="margin-bottom:12px"><button type="button" onclick="window.print()" style="background:${accent};color:#fff;border:0;padding:10px 18px;cursor:pointer;font-weight:600">Imprimer / PDF</button></div>`}
<div class="doc-main">
<div class="top">
  <div>
    ${logoBlock}
    <div class="doc-title">${docLabel}</div>
    ${bodyExtra === 'quick_sale' ? `<div class="vr-banner" style="margin-top:12px"><div><span class="vr-pill">Caisse · VR</span><div style="margin-top:6px;font-size:12px;opacity:.95">Ticket de vente rapide — stock déduit, encaissement immédiat.<br/>Série <strong>VR</strong> distincte des factures formalisées (FA).</div></div></div>` : ''}
    <div class="seller" style="margin-top:10px">
      <div class="name">${eh(settings?.company_name || '')}${settings?.legal_form ? ` · ${eh(settings.legal_form)}` : ''}</div>
      <div>${[settings?.address, settings?.city, settings?.postal_code].filter(Boolean).join(', ')}</div>
      <div>${[settings?.phone, settings?.email].filter(Boolean).join(' · ')}</div>
      ${sellerIds ? `<div class="ids">${sellerIds}</div>` : ''}
    </div>
  </div>
  <div>
    <table class="meta-table">
      <tr><td>N° document</td><td><strong>${inv.number || '—'}</strong></td></tr>
      <tr><td>Date d'émission</td><td>${formatDate(inv.issue_date || '')}</td></tr>
      ${isRefund && inv.refund_of_invoice_id ? `<tr><td>Facture d’origine</td><td><strong>#${inv.refund_of_invoice_id}${inv._source_number ? ' · ' + inv._source_number : ''}</strong></td></tr>` : ''}
      ${isRefund && inv._source_number ? `<tr><td>Réf. facture</td><td><strong>${inv._source_number}</strong></td></tr>` : ''}
      ${!isQuote && !isRefund && inv.due_date ? `<tr><td>Échéance</td><td><strong>${formatDate(inv.due_date)}</strong></td></tr>` : ''}
      ${isQuote && inv.due_date ? `<tr><td>Validité</td><td>${formatDate(inv.due_date)}</td></tr>` : ''}
      <tr><td>Devise</td><td>${cur}</td></tr>
      ${isRefund ? `<tr><td>Type</td><td><strong>AVOIR / CRÉDIT (WR)</strong></td></tr>` : ''}
    </table>
  </div>
</div>
<hr class="rule"/>

<div class="grid2">
  <div class="box">
    <h3>${partyLabel}</h3>
    <strong>${eh(partyName || '—')}</strong>
    ${partyIce ? `<div>ICE : ${eh(partyIce)}</div>` : ''}
    ${partyAddr ? `<div>${eh(partyAddr)}</div>` : ''}
    ${partyCity ? `<div>${eh(partyCity)}</div>` : ''}
    ${inv.client_email ? `<div>${eh(inv.client_email)}</div>` : ''}
    ${inv.client_phone ? `<div>${eh(inv.client_phone)}</div>` : ''}
  </div>
  <div class="box">
    <h3>${isBill ? 'Référence' : 'Coordonnées de paiement'}</h3>
    ${!isBill && pdfShow('pdf_show_bank', true) && settings?.bank_name ? `<div><strong>Banque</strong> — ${settings.bank_name}</div>` : ''}
    ${!isBill && pdfShow('pdf_show_bank', true) && settings?.bank_iban ? `<div><strong>RIB / IBAN</strong> — ${settings.bank_iban}</div>` : ''}
    ${isBill ? `<div>Document d'achat fournisseur</div>` : (settings?.bank_iban ? '' : `<div>Règlement selon les conditions convenues.</div>`)}
  </div>
</div>

${paymentBox}

<table class="lines">
  <thead>
    <tr>
      <th>Désignation</th>
      <th class="center" style="width:56px">Qté</th>
      ${isQuickDoc || !showTax ? `
      <th class="num" style="width:100px">P.U.</th>
      <th class="num" style="width:110px">Total</th>` : `
      <th class="num" style="width:90px">P.U. HT</th>
      <th class="num" style="width:100px">Montant HT</th>
      <th class="center" style="width:56px">TVA</th>
      <th class="num" style="width:100px">Total TTC</th>`}
    </tr>
  </thead>
  <tbody>${lineRows}</tbody>
</table>

<div class="totals-wrap">
  <div class="totals">
    <div class="row"><span>${showTax ? 'TOTAL HT' : 'Sous-total'}</span><span>${fmt(Number(inv.subtotal) + (promoDiscount > 0 ? promoDiscount : 0))} ${cur}</span></div>
    ${promoDiscount > 0.001 && pdfShow('pdf_show_promo', true) ? `<div class="row" style="color:#b45309"><span>Promo / remise</span><span>−${fmt(promoDiscount)} ${cur}</span></div>` : ''}
    ${showTax ? `<div class="row"><span>T.V.A ${(() => { const ht = Number(inv.subtotal)||0; const ta = Number(inv.tax_amount)||0; if (ht > 0.01) return Math.round((ta/ht)*100); return Number(settings?.tax_rate)||20; })()}%</span><span>${fmt(Number(inv.tax_amount))} ${cur}</span></div>` : ''}
    <div class="row grand"><span>${isRefund ? (showTax ? 'TOTAL T.T.C crédit' : 'Total crédit') : (showTax ? 'TOTAL T.T.C' : 'Total')}</span><span>${isRefund ? '−' : ''}${fmt(Number(inv.total))} ${cur}</span></div>
    ${isInvoice && !isRefund && paidAmt > 0 ? `<div class="row"><span>Déjà payé</span><span>${fmt(paidAmt)} ${cur}</span></div><div class="row"><span>Reste</span><span><strong>${fmt(dueAmt)} ${cur}</strong></span></div>` : ''}
  </div>
</div>
${isInvoice || isRefund ? `<p class="amount-words">Arrêté ${isRefund ? 'le présent avoir' : isQuickDoc ? 'le présent ticket de vente' : 'la présente facture'} à la somme de <strong>${amountInWordsFr(Math.abs(Number(inv.total) || 0), cur)}</strong>.</p>` : ''}

${isRefund ? `<div class="notes" style="border:1px solid #000;background:#fff;padding:6px 8px;border-radius:2px">
  <h3>Motif du crédit / remboursement</h3>
  <p>${eh(inv.refund_reason || inv.notes || '—').replace(/\n/g, '<br/>')}</p>
  <p style="margin-top:8px;font-size:11px;color:#5c3d1e">Ce crédit s’applique au solde du client ou donne lieu à un remboursement selon la situation de paiement de la facture d’origine. Les quantités listées sont réintégrées au stock.</p>
</div>` : ''}
${inv.notes && !isRefund ? `<div class="notes"><h3>Notes</h3><p>${eh(inv.notes)}</p></div>` : ''}
</div><!-- /.doc-main -->
<div class="doc-foot">
${isQuote ? `<div class="terms notes"><h3>Conditions du devis</h3>
  <p>Document <strong>estimatif</strong> — non facturé, non comptabilisé, stock non modifié tant qu'il n'est pas converti en facture.</p>
  ${validity}
  <p style="margin-top:8px">Validité commerciale : selon la date indiquée sur ce document. Les devis et factures actifs restent conservés ; seuls les documents <strong>déjà annulés</strong> peuvent être purgés après délai (politique interne).</p>
</div>
<div class="bpa keep-tight">
  <h3>Bon pour accord</h3>
  <p style="font-size:12px;color:#555;margin-bottom:14px">En signant, le client accepte le présent devis (sous réserve de conversion en facture).</p>
  <div class="bpa-grid">
    <div class="bpa-box"><div class="bpa-l">Date</div><div class="bpa-line"></div></div>
    <div class="bpa-box"><div class="bpa-l">Nom / qualité</div><div class="bpa-line"></div></div>
    <div class="bpa-box"><div class="bpa-l">Signature client</div><div class="bpa-line tall"></div></div>
    <div class="bpa-box"><div class="bpa-l">Cachet (si société)</div><div class="bpa-line tall"></div></div>
  </div>
</div>` : ''}
${/* Sales invoices + WR: always show refund policy (covers old docs when re-printed) */ ''}
${isInvoice && !isBill ? REFUND_POLICY_HTML : ''}
${(isInvoice || isQuote) && sellerIds ? `<div class="cgi-strip"><strong>Mentions légales émetteur</strong> — ${sellerIds}${settings?.address ? ' · ' + settings.address : ''}${settings?.city ? ', ' + settings.city : ''}. Document généré automatiquement — ne pas modifier.</div>` : ''}

${qrBlock}
${qrSitBlock}
${!isQuote ? companyStampBlock(settings) : ''}

<div class="footer">
  <span>${sellerIds || ''}</span>
  <span>${footerNote || (isQuote ? 'Devis' : isBill ? 'Achat' : isRefund ? 'Avoir WR' : 'Document de vente')}</span>
</div>
</div><!-- /.doc-foot -->
</div><!-- /.sheet -->
${autoPrint ? '<script>window.onload=function(){setTimeout(function(){window.print()},400)}</script>' : ''}
</body></html>`;
}


/** Build absolute public URL for a document token */
function publicDocUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/api/public/invoices/${token}`;
}

/**
 * Notify client by email (Resend) and/or return a WhatsApp deep-link when phone is present.
 * Non-blocking: failures are returned as warnings, never fail the main request.
 */
async function notifyClientDocument(
  env: Env,
  opts: {
    origin: string;
    token: string;
    number: string;
    docLabel: string; // Facture | Devis
    clientName: string;
    clientEmail?: string;
    clientPhone?: string;
    companyName: string;
    total?: number;
    currency?: string;
  },
): Promise<{ emailed: boolean; whatsapp_url?: string; error?: string }> {
  const link = publicDocUrl(opts.origin, opts.token);
  const result: { emailed: boolean; whatsapp_url?: string; error?: string } = { emailed: false };

  const phone = String(opts.clientPhone || '').replace(/[^\d+]/g, '');
  if (phone.length >= 8) {
    // Normalize Moroccan numbers to international without +
    let digits = phone.replace(/^\+/, '');
    if (digits.startsWith('0') && digits.length === 10) digits = '212' + digits.slice(1);
    const text = encodeURIComponent(
      `Bonjour${opts.clientName ? ' ' + opts.clientName : ''},\n\nVoici votre ${opts.docLabel} ${opts.number} de ${opts.companyName}.\n\nConsultez / téléchargez le PDF ici :\n${link}\n\nMerci.`,
    );
    result.whatsapp_url = `https://wa.me/${digits}?text=${text}`;
  }

  const email = String(opts.clientEmail || '').trim();
  if (email.includes('@')) {
    const apiKey = (env as any).RESEND_API_KEY;
    if (apiKey) {
      try {
        const from = (env as any).RESEND_FROM || 'onboarding@resend.dev';
        const subject = `${opts.docLabel} ${opts.number} — ${opts.companyName}`;
        const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1a1814;line-height:1.5">
  <h2 style="margin:0 0 12px">${opts.docLabel} ${opts.number}</h2>
  <p>Bonjour${opts.clientName ? ' <strong>' + opts.clientName + '</strong>' : ''},</p>
  <p>Votre document est disponible en ligne. Vous pouvez le consulter et l'enregistrer en PDF depuis votre navigateur.</p>
  <p style="margin:24px 0"><a href="${link}" style="display:inline-block;padding:12px 20px;background:#1a1814;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Voir le document / PDF</a></p>
  <p style="font-size:13px;color:#666">Lien direct :<br/><a href="${link}">${link}</a></p>
  <p style="font-size:12px;color:#999;margin-top:10px;border-top:1px solid #eee;padding-top:12px">${opts.companyName}</p>
</div>`;
        const resendUrl = assertSafeOutboundUrl('https://api.resend.com/emails');
  const res = await fetch(resendUrl.toString(), {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [email], subject, html }),
        });
        if (res.ok) result.emailed = true;
        else {
          const data = await res.json().catch(() => ({})) as any;
          result.error = data.message || `Resend HTTP ${res.status}`;
        }
      } catch (e: any) {
        result.error = String(e?.message || e);
      }
    } else {
      result.error = 'RESEND_API_KEY non configuré';
    }
  }

  // SMS if phone present and gateway configured
  if (phone.length >= 8) {
    try {
      const smsBody = documentSmsBody({
        company: opts.companyName,
        docLabel: opts.docLabel,
        number: opts.number,
        link,
      });
      const sms = await sendSms(env as any, phone, smsBody);
      (result as any).sms_sent = sms.sent;
      (result as any).sms_provider = sms.provider;
      if (sms.error && !sms.sent) {
        result.error = (result.error ? result.error + ' · ' : '') + 'SMS: ' + sms.error;
      }
    } catch (e: any) {
      result.error = (result.error ? result.error + ' · ' : '') + String(e?.message || e);
    }
  }

  return result;
}

function generateInvoiceEmailHTML(settings: any, invoice: any, items: any[], company: string): string {
  const cur = settings?.currency || 'MAD';
  const fmt = (n: number) => Math.round(Number(n || 0)).toLocaleString('fr-FR');
  const lines = items.map((it: any) => `<tr><td style="padding:8px;border-bottom:1px solid #eee">${it.product_name}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${it.quantity}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${fmt(it.unit_price)}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${fmt(it.line_total)}</td></tr>`).join('');
  return `<div style="font-family:'DM Sans',system-ui,sans-serif;max-width:640px;margin:0 auto;color:#1a1814">
    <div style="border-bottom:3px solid #b87333;padding-bottom:20px;margin-bottom:10px">
      <h1 style="font-family:'Instrument Serif',Georgia,serif;font-size:28px;color:#b87333;margin:0">Facture ${invoice.number}</h1>
      <p style="margin-top:8px"><strong>${company}</strong></p>
    </div>
    <p><strong>Facturé à :</strong> ${invoice.client_name}<br/>Date : ${invoice.issue_date}</p>
    <table width="100%" cellpadding="0" style="border-collapse:collapse;margin:16px 0">
      <thead><tr style="background:#faf8f4"><th align="left" style="padding:10px 8px;border-bottom:2px solid #1a1814;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#7a756c">Désignation</th><th style="padding:10px 8px;border-bottom:2px solid #1a1814;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#7a756c">Qté</th><th align="right" style="padding:10px 8px;border-bottom:2px solid #1a1814;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#7a756c">Prix unitaire</th><th align="right" style="padding:10px 8px;border-bottom:2px solid #1a1814;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#7a756c">Total</th></tr></thead>
      <tbody>${lines}</tbody>
    </table>
    <p style="font-size:18px;margin-top:16px"><strong>Total : ${fmt(invoice.total)} ${cur}</strong></p>
    ${settings?.bank_name ? `<p style="font-size:13px;color:#7a756c;margin-top:16px">Banque : ${settings.bank_name} · RIB/IBAN : ${settings.bank_iban || '—'} · SWIFT : ${settings.bank_swift || '—'}</p>` : ''}
    <p style="color:#999;font-size:11px;margin-top:24px;border-top:1px solid #eee;padding-top:12px">${settings?.company_name || ''} · ${settings?.email || ''} · ${settings?.phone || ''}</p>
  </div>`;
}

export { MobileHub, RestoreHub, NumberHub };

/** Cron: 03:00 UTC daily → JSON snapshot D1 (+ index clés R2) dans le bucket IMAGES */

/**
 * Free-tier cron bypass: external scheduler (GitHub Actions, cron-job.org, etc.)
 * POST /api/cron/backup-execute
 * Authorization: Bearer <CRON_SECRET>
 */
app.post('/api/cron/backup-execute', async (c) => {
  const auth = String(c.req.header('Authorization') || '').trim();
  const secret = String((c.env as any).CRON_SECRET || '').trim();
  if (!secret) {
    return c.json({
      success: false,
      error: 'CRON_SECRET non configuré. Exécutez: npx wrangler secret put CRON_SECRET',
      code: 'CRON_SECRET_MISSING',
    }, 503);
  }
  const bearer = auth.toLowerCase().startsWith('bearer ')
    ? auth.slice(7).trim()
    : '';
  const headerToken = String(c.req.header('X-Cron-Secret') || '').trim();
  if (bearer !== secret && headerToken !== secret) {
    return c.json({ success: false, error: 'Unauthorized', code: 'CRON_UNAUTHORIZED' }, 401);
  }

  const started = new Date().toISOString();
  try {
    const backup = await runDailyBackup(c.env);
    if (!backup.ok) {
      console.error('cron_backup_fail', backup.error);
      return c.json({
        success: false,
        error: backup.error || 'Backup failed',
        code: 'BACKUP_FAILED',
        timestamp: started,
      }, 500);
    }
    let purge = { deleted: 0 };
    try {
      purge = await purgeExpiredBackups(c.env);
    } catch (e: any) {
      console.error('cron_purge_err', String(e));
    }
    let agentPurge = { deleted: 0 };
    try {
      agentPurge = await purgeAgentConversationsOlderThan(c.env, 30);
    } catch (e: any) {
      console.error('cron_agent_purge_err', String(e));
    }
    const finished = new Date().toISOString();
    console.log('cron_backup_ok', JSON.stringify({ key: backup.key, purge, agentPurge }));
    return c.json({
      success: true,
      message: 'Backup + purge backups + conversations agent >30j',
      timestamp: finished,
      started,
      backup_id: backup.key || null,
      bytes: backup.bytes ?? null,
      purge_deleted: purge.deleted,
      agent_chats_purged: agentPurge.deleted,
      data: backup,
    });
  } catch (e: any) {
    console.error('cron_backup_exception', e);
    return c.json({
      success: false,
      error: e?.message || 'Internal error',
      code: 'CRON_EXECUTE_FAILED',
      timestamp: started,
    }, 500);
  }
});



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
        console.error('api_fetch_fatal', String(err?.message || err));
        return new Response(
          JSON.stringify({
            success: false,
            error: String(err?.message || 'Erreur interne').slice(0, 300),
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
