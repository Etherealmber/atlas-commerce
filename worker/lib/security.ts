/**
 * Phase 2 hardening helpers — rate limits, SSRF allow-list, write guards.
 * Designed for Cloudflare Workers free tier (minimal D1/KV pressure).
 */

/** Hosts allowed for server-side outbound fetch (SSRF protection). */
const ALLOWED_FETCH_HOSTS = new Set([
  'api.resend.com',
  'cdn1.afmarbre.com',
  'catalog.cloudflarestorage.com',
]);

export function assertSafeOutboundUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('URL invalide');
  }
  if (u.protocol !== 'https:') {
    throw new Error('Seules les URLs HTTPS sont autorisées');
  }
  const host = u.hostname.toLowerCase();
  // Block private / link-local / metadata
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host === '169.254.169.254' ||
    host === 'metadata.google.internal'
  ) {
    throw new Error('Hôte privé ou réservé interdit');
  }
  if (!ALLOWED_FETCH_HOSTS.has(host)) {
    throw new Error(`Hôte non autorisé pour les requêtes sortantes: ${host}`);
  }
  return u;
}

export function isAllowedImageUrl(raw: string): boolean {
  if (!raw || typeof raw !== 'string') return false;
  if (raw.startsWith('data:image/')) return true;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return (
      h === 'cdn1.afmarbre.com' ||
      h === 'stock.afmarbre.com' ||
      h.endsWith('.afmarbre.com') ||
      h.endsWith('.r2.dev') ||
      h.endsWith('.cloudflarestorage.com') ||
      ALLOWED_FETCH_HOSTS.has(h)
    );
  } catch {
    return false;
  }
}

/**
 * In-memory rate limit only (per isolate).
 * Avoids KV ops on every auth/admin request (free-tier daily cap).
 */
const memBuckets = new Map<string, { count: number; resetAt: number }>();

export async function rateLimit(
  _kv: KVNamespace | undefined,
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ ok: boolean; remaining: number; retryAfter?: number }> {
  const now = Math.floor(Date.now() / 1000);
  const windowKey = `rl:${key}:${Math.floor(now / windowSeconds)}`;

  const bucket = memBuckets.get(windowKey);
  if (bucket && bucket.resetAt > now) {
    if (bucket.count >= limit) {
      return { ok: false, remaining: 0, retryAfter: bucket.resetAt - now };
    }
    bucket.count += 1;
    return { ok: true, remaining: Math.max(0, limit - bucket.count) };
  }
  memBuckets.set(windowKey, { count: 1, resetAt: now + windowSeconds });
  if (memBuckets.size > 500) {
    for (const [k, v] of memBuckets) {
      if (v.resetAt <= now) memBuckets.delete(k);
    }
  }
  return { ok: true, remaining: limit - 1 };
}

/** Reject SQL-like strings that look like mass UPDATE/DELETE without WHERE (defense in depth for dynamic builders). */
export function assertHasWhereClause(sql: string): void {
  const s = sql.replace(/\s+/g, ' ').trim().toUpperCase();
  if (s.startsWith('UPDATE ') || s.startsWith('DELETE ')) {
    if (!/\bWHERE\b/.test(s)) {
      throw new Error('Requête d\'écriture refusée: clause WHERE obligatoire');
    }
  }
}

export function clientIpFromRequest(c: { req: { header: (n: string) => string | undefined } }): string {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    '0.0.0.0'
  );
}

/**
 * HTML entity escape for server-rendered HTML (public verify pages, invoice HTML).
 * Prevents XSS when interpolating user-controlled fields (names, notes, addresses).
 */
export function escapeHtml(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Safe href/src for images — only https (or data:image) on allow-listed hosts. */
export function safeImageSrc(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (!isAllowedImageUrl(s)) return '';
  // Attribute-safe: block quotes that could break out of src="..."
  return s.replace(/"/g, '%22').replace(/'/g, '%27');
}
