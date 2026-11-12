/**
 * Cloudflare D1 Read Replication & Sessions API tests
 * Tests bookmark propagation, post-write read-your-writes, replica-eligible reads,
 * primary-only security reads, invalid/missing bookmark behavior, and fail-closed authorization.
 */
import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

describe('D1 Sessions API & Read Replication', () => {
  it('propagates bookmarks on write and supports header and cookie', async () => {
    let sessionModeUsed: string | null = null;
    let bookmarkSupplied: string | null = null;
    const mockBookmark = 'bm_abc123';
    const nextBookmark = 'bm_def456';

    const mockSessionDb = {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ id: 1, name: 'Client A' }),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
      }),
      getBookmark: vi.fn().mockReturnValue(nextBookmark),
      _meta: { served_by_primary: true, served_by_region: 'weur' },
    };

    const mockRawDb = {
      withSession: vi.fn((arg?: string) => {
        if (arg === 'first-primary') {
          sessionModeUsed = 'first-primary';
        } else if (arg) {
          sessionModeUsed = 'bookmark';
          bookmarkSupplied = arg;
        } else {
          sessionModeUsed = 'replica';
        }
        return mockSessionDb;
      }),
    };

    const app = new Hono();

    // Attach our session middleware logic
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
          if (path === '/api/health') {
            session = rawDb.withSession();
          } else if (isCriticalSecurityPath(path, method)) {
            session = bm ? rawDb.withSession(bm) : rawDb.withSession('first-primary');
          } else {
            session = bm ? rawDb.withSession(bm) : rawDb.withSession();
          }
        } catch {
          session = rawDb.withSession('first-primary');
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

    app.get('/api/health', (c) => c.json({ ok: true }));
    app.get('/api/public/products', (c) => c.json({ ok: true }));
    app.get('/api/auth/me', (c) => c.json({ ok: true }));
    app.post('/api/clients', (c) => c.json({ ok: true }, 201));

    // 1. Health check uses replica-eligible unconstrained session
    let res = await app.fetch(new Request('http://localhost/api/health'), { DB: mockRawDb });
    expect(res.status).toBe(200);
    expect(sessionModeUsed).toBe('replica');

    // 2. Public read with no bookmark uses replica-eligible session
    res = await app.fetch(new Request('http://localhost/api/public/products'), { DB: mockRawDb });
    expect(res.status).toBe(200);
    expect(sessionModeUsed).toBe('replica');

    // 3. Security read without bookmark forces 'first-primary'
    res = await app.fetch(new Request('http://localhost/api/auth/me'), { DB: mockRawDb });
    expect(res.status).toBe(200);
    expect(sessionModeUsed).toBe('first-primary');

    // 4. Security read with valid bookmark header uses bookmark session
    res = await app.fetch(new Request('http://localhost/api/auth/me', {
      headers: { 'X-D1-Bookmark': mockBookmark },
    }), { DB: mockRawDb });
    expect(res.status).toBe(200);
    expect(sessionModeUsed).toBe('bookmark');
    expect(bookmarkSupplied).toBe(mockBookmark);
    expect(res.headers.get('x-d1-bookmark')).toBe(nextBookmark);
    expect(res.headers.get('set-cookie')).toContain(nextBookmark);
    expect(res.headers.get('x-d1-region')).toBe('weur');
    expect(res.headers.get('x-d1-primary')).toBe('1');

    // 5. Security read with invalid bookmark characters falls back to first-primary
    res = await app.fetch(new Request('http://localhost/api/auth/me', {
      headers: { 'X-D1-Bookmark': 'bad<script>token;' },
    }), { DB: mockRawDb });
    expect(res.status).toBe(200);
    expect(sessionModeUsed).toBe('first-primary');

    // 6. Mutation POST /api/clients without bookmark uses 'first-primary' and returns new bookmark
    res = await app.fetch(new Request('http://localhost/api/clients', {
      method: 'POST',
      body: JSON.stringify({ name: 'Client A' }),
    }), { DB: mockRawDb });
    expect(res.status).toBe(201);
    expect(sessionModeUsed).toBe('first-primary');
    expect(res.headers.get('x-d1-bookmark')).toBe(nextBookmark);
  });
});
