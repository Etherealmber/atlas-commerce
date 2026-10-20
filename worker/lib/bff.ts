/**
 * Multi-BFF style routing without separate Nest apps.
 * Same Worker, different contracts by client surface:
 *   - web:     session Bearer, full UI API /api/*
 *   - mobile:  same API + /m/* SPA; X-Atlas-Client: mobile
 *   - partner: /api/v1/* + API key
 *
 * Nginx is unnecessary on Cloudflare (edge TLS + routing).
 * Redis → KV. gRPC → JSON/HTTP (Workers-friendly).
 */

export type BffSurface = 'web' | 'mobile' | 'partner' | 'public';

export function detectBffSurface(c: { req: { header: (n: string) => string | undefined; url: string } }): BffSurface {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/api/v1')) return 'partner';
  if (path.startsWith('/api/public')) return 'public';
  const client = (c.req.header('x-atlas-client') || c.req.header('X-Atlas-Client') || '').toLowerCase();
  if (client === 'mobile' || client === 'capacitor' || client === 'android') return 'mobile';
  if (path.startsWith('/m/') || path.startsWith('/m')) return 'mobile';
  return 'web';
}
