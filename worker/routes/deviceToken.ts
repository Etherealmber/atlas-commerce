/**
 * v0.7 — FCM device-token registration route, extracted for testability.
 * POST /api/assist/device-token : authenticated user upserts an Android push
 * token. Schema is ensured by worker/lib/fcm (upsertDeviceToken). Errors are
 * returned as a stable code — never raw exception text or stack details.
 */
import type { Hono } from 'hono';
import { upsertDeviceToken } from '../lib/fcm';
import { pickUiLang, tr } from '../lib/error-i18n';

export function registerDeviceTokenRoutes(
  app: Hono<any>,
  getSession: (authHeader: string | undefined) => { username: string; role: string },
): void {
  app.post('/api/assist/device-token', async (c) => {
    const lang = pickUiLang(c.req.header('Accept-Language'));
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json({ success: false, error: tr(lang, 'auth_required'), code: 'UNAUTHORIZED' }, 401);
    }
    const session = getSession(authHeader);
    const user = String(session.username || '').trim();
    if (!user) {
      return c.json({ success: false, error: tr(lang, 'auth_required'), code: 'UNAUTHORIZED' }, 401);
    }

    const body = await c.req.json().catch(() => ({}));
    const token = String(body.token || body.fcm_token || '').trim().slice(0, 512);
    const platform = String(body.platform || 'android').slice(0, 32);
    if (!token) return c.json({ success: false, error: tr(lang, 'token_required'), code: 'TOKEN_REQUIRED' }, 400);
    try {
      await upsertDeviceToken(c.env.DB, user, token, platform);
      return c.json({ success: true, data: { registered: true } });
    } catch (e: any) {
      // Detailed cause server-side only (no secrets, truncated).
      console.error('[device-token] upsert failed', String(e?.message || e).slice(0, 300));
      return c.json(
        {
          success: false,
          error: tr(lang, 'token_store_error'),
          code: 'DEVICE_TOKEN_STORE_ERROR',
        },
        500,
      );
    }
  });
}
