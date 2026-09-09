import { getToken, clearToken } from './auth';
import { getCachedFingerprint } from './fingerprint';
import { getApiBase } from './config';
import { uiToast } from './components/AppDialogs';
import { dedupedGet, invalidateGetCache } from './lib/perf';
import { demoApiIntercept, isDemoMode } from './lib/demoMode';

/** Resolve on each use so Capacitor native is detected reliably */
export function getBase(): string {
  return getApiBase();
}
/** @deprecated use getBase() — kept for existing imports */
export const BASE = getApiBase();

/** TTL for low-volatility GET responses (settings, categories, units). */
const GET_CACHE_TTL: Record<string, number> = {
  '/api/settings': 60_000,
  '/api/categories': 120_000,
  '/api/units': 120_000,
  '/api/stock-locations': 60_000,
};

function cacheTtlForPath(path: string): number {
  const base = path.split('?')[0];
  return GET_CACHE_TTL[base] ?? 0;
}

async function requestRaw<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const fp = await getCachedFingerprint().catch(() => 'none');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Device-Fingerprint': fp,
    ...(options?.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${getApiBase()}${path}`, { ...options, headers });
  } catch {
    const msg = 'Pas de connexion réseau — vérifiez internet ou réessayez';
    try { uiToast(msg, 'error'); } catch { /* */ }
    throw new Error(msg);
  }
  const text = await res.text();
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    // Server returned non-JSON (HTML login page, empty body, etc.)
    const preview = (text || '').slice(0, 80).replace(/\s+/g, ' ');
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        clearToken();
        if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
          window.location.href = '/login?reason=UNAUTHORIZED';
        }
        const msg = 'Session expirée ou accès refusé. Reconnectez-vous.';
        try { uiToast(msg, 'error'); } catch { /* */ }
        throw new Error(msg);
      }
      const msg =
        res.status >= 500
          ? `Erreur serveur (${res.status}). Réessayez plus tard.`
          : `Réponse invalide du serveur (${res.status}). Vérifiez la connexion API.`;
      try { uiToast(msg, 'error'); } catch { /* */ }
      throw new Error(msg);
    }
    if (/<!DOCTYPE|<html/i.test(text || '')) {
      if (res.status === 429) {
        throw new Error('Limite Cloudflare atteinte. Réessayez dans quelques minutes.');
      }
      if (res.status >= 500 || res.status === 0) {
        throw new Error(`Erreur serveur (${res.status || 'réseau'}). Réessayez plus tard.`);
      }
      // SPA index.html served for /api/* means the Worker route missed the path
      throw new Error(
        'L’API a renvoyé une page HTML au lieu de JSON (route Worker manquante ou timeout). Rechargez après déploiement.',
      );
    }
    throw new Error(
      preview
        ? `Réponse invalide du serveur. (${preview}…)`
        : 'Réponse invalide du serveur. Vérifiez le réseau et l\'URL API.',
    );
  }

  if (res.status === 401) {
    const code = data.code || 'UNAUTHORIZED';
    // Wrong password on a confirm-action must NOT destroy the session
    if (code === 'BAD_PASSWORD' || code === 'PASSWORD_REQUIRED') {
      const err: any = new Error(
        code === 'PASSWORD_REQUIRED'
          ? 'Veuillez saisir votre mot de passe.'
          : 'Mot de passe incorrect. Vérifiez et réessayez.',
      );
      err.code = code;
      err.status = 401;
      err.body = data;
      throw err;
    }
    clearToken();
    try {
      sessionStorage.setItem('atlas_session_toast', data.error || 'Session expirée. Reconnectez-vous.');
    } catch { /* */ }
    if (!window.location.pathname.includes('/login')) {
      window.location.href = '/login?reason=' + encodeURIComponent(code);
    }
    const err: any = new Error(data.error || 'Session expirée. Reconnectez-vous.');
    err.code = code;
    err.status = 401;
    throw err;
  }
  // 403: password / role failures must NOT destroy the session
  if (res.status === 403) {
    const code = data.code || '';
    if (code === 'BAD_PASSWORD' || code === 'PASSWORD_REQUIRED') {
      const err: any = new Error(
        code === 'PASSWORD_REQUIRED'
          ? 'Veuillez saisir votre mot de passe.'
          : 'Mot de passe incorrect. Vérifiez et réessayez.',
      );
      err.code = code;
      err.status = 403;
      err.body = data;
      throw err;
    }
    if (code === 'FORBIDDEN_ROLE' || code === 'OWNER_ONLY') {
      const err: any = new Error(data.error || 'Action non autorisée pour votre rôle.');
      err.code = code;
      err.status = 403;
      throw err;
    }
    const err: any = new Error(data.error || 'Accès refusé');
    err.code = code;
    err.status = 403;
    throw err;
  }
  if (res.status === 429) {
    const msg = data.error || 'Trop de requêtes — réessayez dans une minute';
    try { uiToast(msg, 'error'); } catch { /* */ }
    throw new Error(msg);
  }
  if (!res.ok || data.success === false) {
    const msg = data.error || `Erreur (${res.status})`;
    // Toast for server / rate / network-class failures (not every 400 validation)
    if (res.status >= 500 || res.status === 0) {
      try { uiToast(msg, 'error'); } catch { /* */ }
    }
    const err: any = new Error(msg);
    err.code = data.code;
    err.status = res.status;
    err.duplicate = data.duplicate;
    err.matches = data.matches;
    err.force_required = data.force_required;
    err.hint = data.hint;
    err.body = data;
    throw err;
  }
  return data;
}

/**
 * Public request helper:
 * - GET: in-flight dedupe + optional short TTL cache for reference data
 * - Mutations: invalidate related GET caches
 */
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const method = (options?.method || 'GET').toUpperCase();
  // Demo sandbox: intercept list/create for clients/products/invoices — never hits live DB
  if (isDemoMode()) {
    let body: unknown;
    if (options?.body && typeof options.body === 'string') {
      try { body = JSON.parse(options.body); } catch { body = undefined; }
    }
    const hit = demoApiIntercept(method, path, body);
    if (hit) {
      if ((hit as any).success === false) {
        const err: any = new Error((hit as any).error || 'Erreur démo');
        err.status = 400;
        throw err;
      }
      return hit as T;
    }
  }
  if (method === 'GET') {
    const ttl = cacheTtlForPath(path);
    return dedupedGet(`GET:${path}`, () => requestRaw<T>(path, options), ttl);
  }
  const result = await requestRaw<T>(path, options);
  // Invalidate list/reference caches after writes
  if (path.includes('/products')) invalidateGetCache('GET:/api/products');
  if (path.includes('/categories')) invalidateGetCache('GET:/api/categories');
  if (path.includes('/units')) invalidateGetCache('GET:/api/units');
  if (path.includes('/settings')) invalidateGetCache('GET:/api/settings');
  if (path.includes('/stock-locations')) invalidateGetCache('GET:/api/stock-locations');
  if (path.includes('/invoices')) invalidateGetCache('GET:/api/invoices');
  return result;
}

export const api = {

  listWebAuthnCredentials: (all = false) =>
    request<{ data: any[]; meta?: any }>(`/api/auth/webauthn/credentials${all ? '?all=1' : ''}`),
  renameWebAuthnCredential: (id: string, label: string) =>
    request(`/api/auth/webauthn/credentials/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ label }),
    }),
  deleteWebAuthnCredential: (id: string) =>
    request(`/api/auth/webauthn/credentials/delete`, {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),
  getHubSnapshot: () => request<{ data: any }>('/api/hub/snapshot'),
  getDashboard: () => request<{ data: any }>('/api/dashboard'),
  importValidate: (body: any) =>
    request('/api/import/validate', { method: 'POST', body: JSON.stringify(body) }),
  importCommit: (body: any) =>
    request('/api/import/commit', { method: 'POST', body: JSON.stringify(body) }),
  assistStatus: () => request<{ data: { configured: boolean; provider?: string; model?: string; hint?: string } }>('/api/assist/status'),
  getAssistProvider: () =>
    request<{ data: { provider: string; mistralConfigured?: boolean; geminiConfigured?: boolean; mistralModel?: string; geminiModel?: string } }>(
      '/api/settings/assist-provider',
    ),
  setAssistProvider: (provider: 'gemini' | 'mistral' | 'groq') =>
    request<{ data: { provider: string }; message?: string }>('/api/settings/assist-provider', {
      method: 'PUT',
      body: JSON.stringify({ provider }),
    }),
  assistChat: (message: string, opts?: { task?: string; timezone?: string; thread_id?: string }) =>
    request<{
      data: {
        reply: string;
        model?: string;
        provider?: string;
        local_time?: string;
        tool_trace?: { name: string; ok: boolean; error?: string; data?: unknown }[];
        proposals?: Array<Record<string, unknown> & { proposal_id?: string | null }>;
      };
    }>('/api/assist/chat', {
      method: 'POST',
      body: JSON.stringify({
        message,
        task: opts?.task || 'general',
        timezone: opts?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Casablanca',
        thread_id: opts?.thread_id || 'live',
      }),
    }),
  assistNextActions: () =>
    request<{ data: { items: { priority: number; title: string; detail: string; href?: string }[] } }>(
      '/api/assist/next-actions',
    ),
  assistApprove: (proposal_id: string) =>
    request<{ data: { queued?: boolean; message?: string } }>('/api/assist/approve', {
      method: 'POST',
      body: JSON.stringify({ proposal_id }),
    }),
  backupNow: () => request<{ data: any; message?: string }>('/api/admin/backup-now', { method: 'POST' }),
  revokePublicToken: (invoiceId: number) =>
    request<{ message?: string }>('/api/admin/revoke-public-token', {
      method: 'POST',
      body: JSON.stringify({ invoice_id: invoiceId }),
    }),
  backupStatus: () => request<{ data: { has_latest?: boolean; uploaded?: string | null; size?: number | null } }>('/api/admin/backup-status'),
  backupList: () => request<{ data: { key: string; size?: number; uploaded?: string | null }[] }>('/api/admin/backups'),
  backupRestoreStatus: (id?: string) =>
    request<{ data: any }>(`/api/admin/backups/restore-status${id ? `?id=${encodeURIComponent(id)}` : ''}`),
  backupRestore: (body: { key?: string; payload?: any; abk_base64?: string }, backupToken?: string) =>
    request<{ data: any; message?: string }>('/api/admin/backups/restore', {
      method: 'POST',
      headers: backupToken ? { 'X-Admin-Backup-Token': backupToken } : undefined,
      body: JSON.stringify(body),
    }),
  backupRestoreCancel: (id?: string) =>
    request<{ data: any; message?: string }>('/api/admin/backups/restore-cancel', {
      method: 'POST',
      body: JSON.stringify(id ? { id } : {}),
    }),
  mailboxList: (params?: { direction?: string; q?: string; limit?: number; sync?: boolean; status?: string }) => {
    const sp = new URLSearchParams();
    if (params?.direction) sp.set('direction', params.direction);
    if (params?.status) sp.set('status', params.status);
    if (params?.q) sp.set('q', params.q);
    if (params?.limit) sp.set('limit', String(params.limit));
    if (params?.sync) sp.set('sync', '1');
    const qs = sp.toString();
    return request<{ data: any[] }>(`/api/admin/mailbox${qs ? `?${qs}` : ''}`);
  },
  mailboxGet: (id: string | number) => request<{ data: any }>(`/api/admin/mailbox/${id}`),
  mailboxSend: (body: {
    to: string;
    subject: string;
    text?: string;
    html?: string;
    reply_to_id?: number;
    attachments?: { filename: string; mimeType?: string; content_base64: string }[];
  }) =>
    request<{ data: any }>('/api/admin/mailbox/send', { method: 'POST', body: JSON.stringify(body) }),
  mailboxDelete: (id: string | number) =>
    request<{ success: boolean }>(`/api/admin/mailbox/${id}`, { method: 'DELETE' }),
  mailboxSyncResend: (limit?: number) =>
    request<{ data: any; message?: string; messages?: any[] }>('/api/admin/mailbox/sync-resend', {
      method: 'POST',
      body: JSON.stringify({ limit: limit ?? 100 }),
    }),
  mailboxDownloadAttachment: (key: string, filename?: string) => (async () => {
    const fp = await getCachedFingerprint().catch(() => 'none');
    const res = await fetch(
      `${getApiBase()}/api/admin/mailbox/attachment?key=${encodeURIComponent(key)}&filename=${encodeURIComponent(filename || '')}`,
      { headers: { Authorization: `Bearer ${getToken()}`, 'X-Device-Fingerprint': fp || 'none' } },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).error || `Téléchargement échoué (${res.status})`);
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || key.split('/').pop() || 'piece-jointe';
    a.click();
    URL.revokeObjectURL(a.href);
  })(),
  /** Fetch attachment as blob for in-app preview (inline). */
  mailboxFetchAttachmentBlob: async (key: string, filename?: string) => {
    const fp = await getCachedFingerprint().catch(() => 'none');
    const res = await fetch(
      `${getApiBase()}/api/admin/mailbox/attachment?key=${encodeURIComponent(key)}&inline=1&filename=${encodeURIComponent(filename || '')}`,
      { headers: { Authorization: `Bearer ${getToken()}`, 'X-Device-Fingerprint': fp || 'none' } },
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as any).error || `Prévisualisation échouée (${res.status})`);
    }
    const blob = await res.blob();
    const contentType = res.headers.get('Content-Type') || blob.type || 'application/octet-stream';
    return { blob, contentType };
  },
  mailboxSignedLink: (id: string | number) =>
    request<{ data: { url: string; path: string; exp: number; sig: string } }>(`/api/admin/mailbox/${id}/signed-link`),
  mailboxOpenSigned: (id: string | number, e: number | string, s: string) =>
    request<{ data: any }>(`/api/admin/mailbox/${id}/open-signed?e=${encodeURIComponent(String(e))}&s=${encodeURIComponent(s)}`),
  mailboxAiDraft: (body: { instruction: string; mode?: 'compose' | 'reply'; context?: string; lang?: string }) =>
    request<{ data: { subject?: string; body: string; source?: string } }>('/api/admin/mailbox/ai-draft', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  mailboxTranslate: (body: { text: string; target?: string; source?: string }) =>
    request<{ data: { text: string; engine?: string } }>('/api/admin/mailbox/translate', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  mailboxAttachmentPreviewUrl: (key: string, filename?: string) =>
    request<{ data: { public_url: string; google_viewer_url: string; expires_in: number; content_type: string } }>(
      '/api/admin/mailbox/attachment-preview-url',
      { method: 'POST', body: JSON.stringify({ key, filename }) },
    ),


  getNavBadges: () =>
    request<{
      data: {
        invoices_unpaid: number;
        bills_unpaid: number;
        bills_receive: number;
        products_low: number;
        actions_pending: number;
        quotes_open: number;
      };
    }>('/api/nav-badges'),
  getSettings: () => request<{ data: any }>('/api/settings'),
  updateSettings: (body: any) => request('/api/settings', { method: 'PUT', body: JSON.stringify(body) }),

  getProducts: (params?: { q?: string; category?: string; parent_id?: number; include_variants?: boolean; fields?: 'mobile' | 'light' | string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.category) qs.set('category', params.category);
    if (params?.parent_id) qs.set('parent_id', String(params.parent_id));
    if (params?.include_variants) qs.set('include_variants', '1');
    if (params?.fields) qs.set('fields', params.fields);
    if (params?.limit) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return request<{ data: any[] }>(`/api/products${q ? `?${q}` : ''}`);
  },
  getProduct: (id: number) => request<{ data: any }>(`/api/products/${id}`),
  createProduct: (body: any) => request('/api/products', { method: 'POST', body: JSON.stringify(body) }),
  updateProduct: (id: number, body: any) => request(`/api/products/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteProduct: (id: number, confirm_password: string) =>
    request(`/api/products/${id}`, { method: 'DELETE', body: JSON.stringify({ confirm_password }) }),
  bulkDeleteProducts: (ids: number[], confirm_password: string) =>
    request('/api/products/bulk-delete', { method: 'POST', body: JSON.stringify({ ids, confirm_password }) }),
  getProductMovements: (id: number, limit = 50) =>
    request<{ data: any[]; meta?: any }>(`/api/products/${id}/movements?limit=${limit}`),
  /** Global inventory audit log */
  getStockMovements: (params?: { product_id?: number; type?: string; q?: string; limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.product_id) qs.set('product_id', String(params.product_id));
    if (params?.type) qs.set('type', params.type);
    if (params?.q) qs.set('q', params.q);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return request<{ data: any[]; meta?: any }>(`/api/stock/movements${q ? `?${q}` : ''}`);
  },
  adjustStock: (id: number, body: { quantity: number; type?: string; reason?: string; location_id?: number; reference?: string }) =>
    request(`/api/products/${id}/adjust-stock`, { method: 'POST', body: JSON.stringify(body) }),
  createReorderBill: (body?: { product_ids?: number[]; vendor_name?: string }) =>
    request('/api/inventory/reorder/draft-bill', { method: 'POST', body: JSON.stringify(body || {}) }),

  // Variants
  getVariants: (productId: number) => request<{ data: any[]; parent?: any }>(`/api/products/${productId}/variants`),
  createVariant: (productId: number, body: any) =>
    request(`/api/products/${productId}/variants`, { method: 'POST', body: JSON.stringify(body) }),
  updateVariant: (variantId: number, body: any) =>
    request(`/api/products/variants/${variantId}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteVariant: (variantId: number, body?: any) =>
    request(`/api/products/variants/${variantId}`, { method: 'DELETE', body: JSON.stringify(body || {}) }),

  // Barcode scan (mobile APK)
  scanBarcode: (code: string) =>
    request<{ data: any }>(`/api/scan/barcode/${encodeURIComponent(code)}`),
  quickProductFromBarcode: (body: any) =>
    request('/api/scan/quick-product', { method: 'POST', body: JSON.stringify(body) }),

  getClients: () => request<{ data: any[] }>('/api/clients'),
  createClient: (body: any) => request('/api/clients', { method: 'POST', body: JSON.stringify(body) }),
  updateClient: (id: number, body: any) => request(`/api/clients/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteClient: (id: number, confirm_password: string) =>
    request(`/api/clients/${id}`, { method: 'DELETE', body: JSON.stringify({ confirm_password }) }),
  bulkDeleteClients: (ids: number[], confirm_password: string) =>
    request('/api/clients/bulk-delete', { method: 'POST', body: JSON.stringify({ ids, confirm_password }) }),
  importClientsPreview: (rows: any[]) =>
    request<{ data: { rows: any[]; stats: any } }>('/api/clients/import/preview', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    }),
  importClients: (rows: any[]) =>
    request<{ data: any }>('/api/clients/import', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    }),
  getCatalogSettings: () => request<{ data: any }>('/api/catalog/settings'),
  updateCatalogSettings: (body: any) =>
    request('/api/catalog/settings', { method: 'PUT', body: JSON.stringify(body) }),
  getCatalogProducts: () => request<{ data: any[] }>('/api/catalog/products'),
  updateCatalogProduct: (id: number, body: any) =>
    request(`/api/catalog/products/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  getProductImages: (id: number) => request<{ data: any[] }>(`/api/catalog/products/${id}/images`),
  addProductImage: (id: number, body: any) =>
    request(`/api/catalog/products/${id}/images`, { method: 'POST', body: JSON.stringify(body) }),
  updateProductImage: (id: number, imageId: number, body: any) =>
    request(`/api/catalog/products/${id}/images/${imageId}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteProductImage: (id: number, imageId: number) =>
    request(`/api/catalog/products/${id}/images/${imageId}`, { method: 'DELETE' }),

  getVendors: () => request<{ data: any[] }>('/api/vendors'),
  createVendor: (body: any) => request('/api/vendors', { method: 'POST', body: JSON.stringify(body) }),
  deleteVendor: (id: number, confirm_password: string) =>
    request(`/api/vendors/${id}`, { method: 'DELETE', body: JSON.stringify({ confirm_password }) }),

  getInvoices: (status?: string, opts?: { kind?: string }) => {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    if (opts?.kind) q.set('kind', opts.kind);
    const qs = q.toString();
    return request<{ data: any[] }>(qs ? `/api/invoices?${qs}` : '/api/invoices');
  },
  getInvoice: (id: number) => request<{ data: any }>(`/api/invoices/${id}`),
  createInvoice: (body: any) => {
    const idempotency_key =
      body?.idempotency_key ||
      (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `inv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    return request('/api/invoices', {
      method: 'POST',
      body: JSON.stringify({ ...body, idempotency_key }),
      headers: { 'Idempotency-Key': idempotency_key },
    });
  },
  getIntegrityStatus: () => request<{ data: any }>('/api/integrity/status'),
  runIntegrityRegression: () => request('/api/integrity/regression', { method: 'POST' }),
  /** Phase 5 — accountant month pack (JSON or multi-section CSV) */
  exportMonthPack: (month: string, format: 'json' | 'csv' = 'json') => {
    const qs = new URLSearchParams({ month, format });
    return (async () => {
      const { getToken } = await import('./auth');
      const { getApiBase } = await import('./config');
      const { getCachedFingerprint } = await import('./fingerprint');
      const token = getToken();
      const fp = await getCachedFingerprint();
      const res = await fetch(`${getApiBase()}/api/export/month-pack?${qs}`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'X-Device-Fingerprint': fp || '',
        },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `atlas-pack-${month}.${format === 'csv' ? 'csv' : 'json'}`;
      a.click();
      URL.revokeObjectURL(a.href);
      return { success: true };
    })();
  },
  getPeriodLock: () => request<{ data: any }>('/api/fiscal/period-lock'),
  setPeriodLock: (body: { fiscal_locked_through?: string; clear?: boolean }) =>
    request('/api/fiscal/period-lock', { method: 'PUT', body: JSON.stringify(body) }),
  getAgingReport: () => request<{ data: any }>('/api/reports/aging'),
  getTvaReport: (from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const s = q.toString();
    return request<{ data: any }>(`/api/reports/tva${s ? `?${s}` : ''}`);
  },
  
  listApiKeys: () => request<{ data: any[] }>('/api/integrations/keys'),
  createApiKey: (body: { name?: string; scopes?: string }) =>
    request('/api/integrations/keys', { method: 'POST', body: JSON.stringify(body) }),
  deleteApiKey: (id: number) => request(`/api/integrations/keys/${id}`, { method: 'DELETE' }),
  listWebhooks: () => request<{ data: any[] }>('/api/integrations/webhooks'),
  createWebhook: (body: { url: string; events?: string; secret?: string }) =>
    request('/api/integrations/webhooks', { method: 'POST', body: JSON.stringify(body) }),
  deleteWebhook: (id: number) => request(`/api/integrations/webhooks/${id}`, { method: 'DELETE' }),
  getCogsReport: (from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const s = q.toString();
    return request<{ data: any }>(`/api/reports/cogs${s ? `?${s}` : ''}`);
  },
  getReorderList: () => request<{ data: any[] }>('/api/inventory/reorder'),
  getStockLocations: () => request<{ data: any[] }>('/api/inventory/locations'),
  createStockLocation: (body: { code: string; name: string }) =>
    request('/api/inventory/locations', { method: 'POST', body: JSON.stringify(body) }),
  updateStockLocation: (id: number, body: { name?: string; is_default?: boolean; is_active?: boolean }) =>
    request(`/api/inventory/locations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteStockLocation: (id: number) =>
    request(`/api/inventory/locations/${id}`, { method: 'DELETE' }),
  stockTransfer: (body: any) =>
    request('/api/inventory/transfer', { method: 'POST', body: JSON.stringify(body) }),
  stockCycleCount: (body: any) =>
    request('/api/inventory/cycle-count', { method: 'POST', body: JSON.stringify(body) }),
  getStockValuation: (locationId?: string | number) => {
    const q = locationId !== undefined && locationId !== '' && locationId !== 'all' ? `?location_id=${locationId}` : '';
    return request<{ data: any }>(`/api/inventory/valuation${q}`);
  },
  getProductPlacements: (productId: number) =>
    request<{ data: any }>(`/api/inventory/products/${productId}/placements`),
  getAutoTransferRules: () => request<{ data: any[] }>('/api/inventory/auto-transfer-rules'),
  createAutoTransferRule: (body: any) =>
    request('/api/inventory/auto-transfer-rules', { method: 'POST', body: JSON.stringify(body) }),
  deleteAutoTransferRule: (id: number) =>
    request(`/api/inventory/auto-transfer-rules/${id}`, { method: 'DELETE' }),
  runAutoTransfers: (product_ids?: number[]) =>
    request('/api/inventory/auto-transfer-rules/run', { method: 'POST', body: JSON.stringify({ product_ids }) }),
  getStockReport: (opts?: { location_id?: string | number; group?: string }) => {
    const q = new URLSearchParams();
    if (opts?.location_id !== undefined) q.set('location_id', String(opts.location_id));
    if (opts?.group) q.set('group', opts.group);
    const s = q.toString();
    return request<{ data: any }>(`/api/inventory/stock-report${s ? `?${s}` : ''}`);
  },
  getDeliveryNotes: () => request<{ data: any[] }>('/api/delivery-notes'),
  createDeliveryNote: (body: any) =>
    request('/api/delivery-notes', { method: 'POST', body: JSON.stringify(body) }),
  receiveBill: (id: number, body: any) =>
    request(`/api/bills/${id}/receive`, { method: 'POST', body: JSON.stringify(body) }),
  getBillMatch: (id: number) => request<{ data: any }>(`/api/bills/${id}/match`),
  reconcileBankCsv: (csv: string, opts?: { date_window_days?: number }) =>
    request('/api/bank/reconcile-csv', {
      method: 'POST',
      body: JSON.stringify({ csv, date_window_days: opts?.date_window_days }),
    }),
  validateInvoiceUbl: (id: number) =>
    request<{ data: any; message?: string }>(`/api/invoices/${id}/ubl/validate`),

  ublPrepare: (id: number) =>
    request<{ data: any; message?: string }>(`/api/invoices/${id}/ubl/prepare`, { method: 'POST' }),
  ublClearance: (id: number) =>
    request<{ data: any }>(`/api/invoices/${id}/ubl/clearance`),
  ublSetStatus: (id: number, body: { status: string; external_ref?: string; note?: string }) =>
    request<{ data: any; message?: string }>(`/api/invoices/${id}/ubl/status`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  ublSnapshotUrl: (id: number) => `/api/invoices/${id}/ubl/snapshot`,
  createRemboursement: (body: any) => {
    const idempotency_key =
      body?.idempotency_key ||
      (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `wr-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    return request('/api/invoices/remboursement', {
      method: 'POST',
      body: JSON.stringify({ ...body, idempotency_key }),
      headers: { 'Idempotency-Key': idempotency_key },
    });
  },
  updateInvoiceStatus: (id: number, body: { status: string; amount_paid?: number; void_reason?: string }) =>
    request(`/api/invoices/${id}/status`, { method: 'PATCH', body: JSON.stringify(body) }),
  sendInvoiceEmail: (id: number, to: string) =>
    request(`/api/invoices/${id}/send-email`, { method: 'POST', body: JSON.stringify({ to }) }),
  deleteInvoice: (id: number, confirm_password: string) =>
    request(`/api/invoices/${id}`, { method: 'DELETE', body: JSON.stringify({ confirm_password }) }),
  convertQuoteToInvoice: (id: number, opts?: { target?: 'invoice' | 'quick_sale' }) =>
    request(`/api/invoices/${id}/convert-quote`, {
      method: 'POST',
      body: JSON.stringify({ target: opts?.target || 'invoice' }),
    }),
  recordInvoicePayment: (
    id: number,
    body: { amount: number; payment_method?: string; payee?: string; note?: string; paid_at?: string; idempotency_key?: string },
  ) => {
    const idempotency_key =
      body?.idempotency_key ||
      (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `pay-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    return request(`/api/invoices/${id}/payments`, {
      method: 'POST',
      body: JSON.stringify({ ...body, idempotency_key }),
      headers: { 'Idempotency-Key': idempotency_key },
    });
  },
  getInvoicePayments: (id: number) =>
    request<{ data: any[] }>(`/api/invoices/${id}/payments`),
  deleteInvoicePayment: (invoiceId: number, paymentId: number, confirm_password: string) =>
    request(`/api/invoices/${invoiceId}/payments/${paymentId}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirm_password }),
    }),

  getBills: (status?: string) =>
    request<{ data: any[] }>(status ? `/api/bills?status=${status}` : '/api/bills'),
  getBill: (id: number) => request<{ data: any }>(`/api/bills/${id}`),
  createBill: (body: any) => request('/api/bills', { method: 'POST', body: JSON.stringify(body) }),
  updateBillStatus: (id: number, body: { status: string; amount_paid?: number }) =>
    request(`/api/bills/${id}/status`, { method: 'PATCH', body: JSON.stringify(body) }),
  recordBillPayment: (
    id: number,
    body: { amount: number; payment_method?: string; payee?: string; note?: string; paid_at?: string; idempotency_key?: string },
  ) => {
    const idempotency_key =
      body?.idempotency_key ||
      (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `billpay-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    return request(`/api/bills/${id}/payments`, {
      method: 'POST',
      body: JSON.stringify({ ...body, idempotency_key }),
      headers: { 'Idempotency-Key': idempotency_key },
    });
  },
  getBillPayments: (id: number) => request<{ data: any[] }>(`/api/bills/${id}/payments`),
  deleteBill: (id: number, confirm_password: string) =>
    request(`/api/bills/${id}`, { method: 'DELETE', body: JSON.stringify({ confirm_password }) }),
  bulkDeleteBills: (ids: number[], confirm_password: string) =>
    request('/api/bills/bulk-delete', { method: 'POST', body: JSON.stringify({ ids, confirm_password }) }),

  getReceipts: () => request<{ data: any[] }>('/api/receipts'),
  createReceipt: (body: any) => request('/api/receipts', { method: 'POST', body: JSON.stringify(body) }),
  deleteReceipt: (id: number, confirm_password: string, cascade_invoice = false) =>
    request(`/api/receipts/${id}`, { method: 'DELETE', body: JSON.stringify({ confirm_password, cascade_invoice }) }),

  getExpenses: () => request<{ data: any[] }>('/api/expenses'),
  createExpense: (body: any) => request('/api/expenses', { method: 'POST', body: JSON.stringify(body) }),
  deleteExpense: (id: number, confirm_password: string, cascade_linked = false) =>
    request(`/api/expenses/${id}`, { method: 'DELETE', body: JSON.stringify({ confirm_password, cascade_linked }) }),
  updateInvoice: (id: number, body: any) =>
    request(`/api/invoices/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  updateReceipt: (id: number, body: any) =>
    request(`/api/receipts/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  importExpenses: (rows: any[]) =>
    request('/api/expenses/import', { method: 'POST', body: JSON.stringify({ rows }) }),

  getAdminUsers: () => request<{ data: any }>('/api/admin/users'),
  createAdminUser: (body: any) =>
    request('/api/admin/users', { method: 'POST', body: JSON.stringify(body) }),
  deleteAdminUser: (id: number, confirm_password: string) =>
    request(`/api/admin/users/${id}`, { method: 'DELETE', body: JSON.stringify({ confirm_password }) }),
  updateAdminUser: (id: number, body: any) =>
    request(`/api/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  getAuditLog: (params?: {
    limit?: number;
    cursor?: string | null;
    action?: string;
    username?: string;
    q?: string;
    range?: string;
    stats?: boolean;
  }) => {
    const qs = new URLSearchParams();
    if (params?.limit != null) qs.set('limit', String(params.limit));
    if (params?.cursor) qs.set('cursor', String(params.cursor));
    if (params?.action) qs.set('action', params.action);
    if (params?.username) qs.set('username', params.username);
    if (params?.q) qs.set('q', params.q);
    if (params?.range) qs.set('range', params.range);
    if (params?.stats) qs.set('stats', '1');
    const q = qs.toString();
    return request<{
      data: any[];
      meta?: {
        limit: number;
        has_more: boolean;
        next_cursor: string | null;
        cursor: string | null;
        range?: string;
        stats?: {
          total: number;
          unique_actors: number;
          top_actions: { action: string; n: number }[];
          range: string;
          capped?: boolean;
        } | null;
      };
    }>(`/api/admin/audit${q ? `?${q}` : ''}`);
  },
  exportAuditLog: (format: 'csv' | 'json' = 'csv', limit = 500) => {
    const qs = new URLSearchParams({ format, limit: String(limit) });
    if (format === 'json') {
      return request<{ data: any[]; meta?: any }>(`/api/admin/audit/export?${qs}`);
    }
    // CSV: return blob download via fetch with auth
    return (async () => {
      const { getToken } = await import('./auth');
      const { getApiBase } = await import('./config');
      const token = getToken();
      const res = await fetch(`${getApiBase()}/api/admin/audit/export?${qs}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error || `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      return { success: true };
    })();
  },
  getAgentPermissions: () =>
    request<{ data: { mode: string; tools: string[]; available: string[]; groups?: Record<string, string[]> } }>(
      '/api/admin/agent-permissions',
    ),
  updateAgentPermissions: (body: { mode: string; tools?: string[] }) =>
    request('/api/admin/agent-permissions', { method: 'PUT', body: JSON.stringify(body) }),
  getAdminConfig: () => request<{ data: any }>('/api/admin/config'),
  updateAdminConfig: (body: any) =>
    request('/api/admin/config', { method: 'PUT', body: JSON.stringify(body) }),

  getInvoiceLinks: (id: number) => request<{ data: any }>(`/api/invoices/${id}/links`),
  setReceiptClientSituation: (id: number, enabled: boolean) =>
    request<{ data?: { include_client_situation: number }; message?: string }>(`/api/receipts/${id}/client-situation`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
  getReceiptLinks: (id: number) => request<{ data: any }>(`/api/receipts/${id}/links`),
  getExpenseLinks: (id: number) => request<{ data: any }>(`/api/expenses/${id}/links`),
  getLedgerReconcile: () => request<{ data: any }>('/api/ledger/reconcile'),
  fixMissingReceipts: (confirm_password: string) =>
    request('/api/ledger/fix-receipts', { method: 'POST', body: JSON.stringify({ confirm_password }) }),
  getMe: () => request<{ data: any }>('/api/auth/me'),
  updateMe: (body: any) => request('/api/auth/me', { method: 'PATCH', body: JSON.stringify(body) }),

  getCategories: () => request<{ data: any[] }>('/api/categories'),
  createCategory: (body: any) => request('/api/categories', { method: 'POST', body: JSON.stringify(body) }),
  updateCategory: (id: number, body: any) =>
    request(`/api/categories/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteCategory: (id: number | string | null, confirm_password: string, name?: string) =>
    request(`/api/categories/${id || 'by-name'}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirm_password, name }),
    }),

  getUnits: () => request<{ data: any[] }>('/api/units'),
  createUnit: (body: any) => request('/api/units', { method: 'POST', body: JSON.stringify(body) }),
  updateUnit: (id: number, body: any) =>
    request(`/api/units/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteUnit: (id: number | string | null, confirm_password: string, name?: string) =>
    request(`/api/units/${id || 'by-name'}`, {
      method: 'DELETE',
      body: JSON.stringify({ confirm_password, name }),
    }),

  // Mobile floor → PC handoffs (shared D1)
  listMobileActions: (params?: { status?: string; limit?: number; compact?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.compact !== false) qs.set('compact', '1');
    const q = qs.toString();
    return request<{ data: any[] }>(`/api/mobile-actions${q ? `?${q}` : ''}`);
  },
  getMobileAction: (id: number) => request<{ data: any }>(`/api/mobile-actions/${id}`),
  createMobileAction: (body: {
    type: 'scan' | 'stock_check' | 'new_product' | 'invoice' | string;
    title: string;
    detail?: string;
    barcode?: string;
    product_id?: number;
    meta?: Record<string, unknown>;
    created_by?: string;
    source?: 'android' | 'web' | 'mobile' | string;
  }) => request('/api/mobile-actions', {
    method: 'POST',
    body: JSON.stringify({ source: 'android', ...body }),
  }),
  completeMobileAction: (
    id: number,
    body?: {
      completed_by?: string;
      apply_stock?: boolean;
      product_id?: number;
      proposed_stock?: number;
    }
  ) => request(`/api/mobile-actions/${id}/complete`, { method: 'POST', body: JSON.stringify(body || {}) }),
  rejectMobileAction: (id: number, reason: string) =>
    request(`/api/mobile-actions/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  cycleCountBatch: (body: {
    lines: { product_id: number; counted_qty: number }[];
    note?: string;
    apply?: boolean;
  }) => request('/api/inventory/cycle-count/batch', { method: 'POST', body: JSON.stringify(body) }),
  getMobileActionStats: () => request<{ data: { pending: number; today: number } }>('/api/mobile-actions/stats'),

  /** Thermal ESC/POS ticket — download bytes for printer bridge */
  registerPushToken: (body: { token: string; platform?: string }) =>
    request('/api/push/register', { method: 'POST', body: JSON.stringify(body) }),
  thermalPrintUrl: (invoiceId: number, width: 32 | 48 = 32) =>
    `/api/print/thermal/${invoiceId}?width=${width}`,
};

