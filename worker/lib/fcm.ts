import { fetchWithTimeout } from './http-client';

/** Schema readiness is per D1 binding, not shared across databases. */
let pushSchemaReady = new WeakSet<object>();

/** Test-only: clears schema readiness between in-process DBs. */
export function resetLocalSchemaOnceForTests(): void {
  pushSchemaReady = new WeakSet<object>();
}

/**
 * FCM HTTP v1 dispatcher for Cloudflare Workers.
 * Secrets (wrangler secret put):
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY   (PEM, newlines as \n)
 *
 * Legacy fallback: FCM_SERVER_KEY (deprecated legacy HTTP API).
 */

export type FcmEnv = {
  DB: D1Database;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_CLIENT_EMAIL?: string;
  FIREBASE_PRIVATE_KEY?: string;
  FCM_SERVER_KEY?: string;
  FIREBASE_SERVER_KEY?: string;
  CACHE?: KVNamespace;
};

export type FcmDataPayload = Record<string, string>;

type PushRow = { token: string; username?: string; platform?: string };

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\s+/g, '');
  const raw = atob(b64);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf.buffer;
}

function b64url(data: ArrayBuffer | string): string {
  let bytes: Uint8Array;
  if (typeof data === 'string') {
    bytes = new TextEncoder().encode(data);
  } else {
    bytes = new Uint8Array(data);
  }
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function getGoogleAccessToken(env: FcmEnv): Promise<string | null> {
  const email = String(env.FIREBASE_CLIENT_EMAIL || '').trim();
  const keyPem = String(env.FIREBASE_PRIVATE_KEY || '').trim();
  if (!email || !keyPem) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({
      iss: email,
      sub: email,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
    }),
  );
  const unsigned = `${header}.${claim}`;

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(keyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned),
  );
  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    // OAuth responses can contain sensitive diagnostic text. Never log the body.
    console.error('[fcm-oauth]', { http_status: res.status, outcome: 'rejected' });
    return null;
  }
  return String(data.access_token);
}

async function ensurePushTable(db: D1Database) {
  if (pushSchemaReady.has(db)) return;

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS device_push_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        token TEXT NOT NULL,
        platform TEXT DEFAULT 'android',
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(username, token)
      )`,
    )
    .run();

  pushSchemaReady.add(db);
}

/** Upsert FCM registration token for a user. */
export async function upsertDeviceToken(
  db: D1Database,
  username: string,
  token: string,
  platform = 'android',
): Promise<void> {
  await ensurePushTable(db);
  await db
    .prepare(
      `INSERT INTO device_push_tokens (username, token, platform, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(username, token) DO UPDATE SET
         updated_at = datetime('now'),
         platform = excluded.platform`,
    )
    .bind(username, token, platform)
    .run();
}

export async function deleteDeviceToken(db: D1Database, token: string): Promise<boolean> {
  try {
    const result = await db.prepare(`DELETE FROM device_push_tokens WHERE token = ?`).bind(token).run();
    return Number(result.meta?.changes || 0) > 0;
  } catch {
    console.error('[fcm-token]', { outcome: 'purge_failed' });
    return false;
  }
}

export async function listDeviceTokens(
  db: D1Database,
  username: string,
  platform = 'android',
  limit = 5,
): Promise<PushRow[]> {
  await ensurePushTable(db);
  const rows = await db
    .prepare(
      `SELECT token, platform FROM device_push_tokens
       WHERE username = ? AND platform = ?
       ORDER BY updated_at DESC, id DESC LIMIT ?`,
    )
    .bind(username, platform, limit)
    .all();
  return (rows?.results || []) as PushRow[];
}

/** Firebase tokens are opaque: neither their project nor their freshness can
 * be inferred from their string. Only an explicitly typed FCM error permits
 * deletion. HTTP 404 / NOT_FOUND alone can also mean a bad project or URL. */
const FCM_ERROR_TYPE = 'type.googleapis.com/google.firebase.fcm.v1.FcmError';
const FCM_CODES = new Set(['UNSPECIFIED_ERROR', 'INVALID_ARGUMENT', 'UNREGISTERED', 'SENDER_ID_MISMATCH', 'QUOTA_EXCEEDED', 'APNS_AUTH_ERROR', 'THIRD_PARTY_AUTH_ERROR', 'UNAVAILABLE', 'INTERNAL']);
const RPC_CODES = new Set(['OK', 'INVALID_ARGUMENT', 'NOT_FOUND', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'RESOURCE_EXHAUSTED', 'UNAVAILABLE', 'INTERNAL', 'DEADLINE_EXCEEDED', 'FAILED_PRECONDITION', 'UNKNOWN']);

function responseCodes(body: any): { status: string; fcm_codes: string[] } {
  const status = RPC_CODES.has(body?.error?.status) ? body.error.status : 'UNKNOWN';
  const details = Array.isArray(body?.error?.details) ? body.error.details : [];
  const codes: string[] = details
    .filter((d: any) => d?.['@type'] === FCM_ERROR_TYPE && FCM_CODES.has(d?.errorCode))
    .map((d: any) => d.errorCode);
  return { status, fcm_codes: [...new Set(codes)] };
}

/** Accept only the expected resource shape; never log arbitrary response text. */
function acceptedMessageId(body: any, project: string): string | null {
  const prefix = `projects/${project}/messages/`;
  if (typeof body?.name !== 'string' || !body.name.startsWith(prefix)) return null;
  const id = body.name.slice(prefix.length);
  return /^[A-Za-z0-9_:%.~-]{1,256}$/.test(id) ? id : null;
}

/** `sent` means accepted by FCM, NOT displayed or delivered to Android.
 * Only an explicit UNREGISTERED (legacy: NotRegistered) permits purging. */
export async function sendFcmToUser(
  env: FcmEnv,
  username: string,
  opts: {
    title: string;
    body: string;
    data?: FcmDataPayload;
    platform?: string;
    /** HIGH for time-sensitive, user-visible alerts; NORMAL for nonurgent work. */
    priority?: 'HIGH' | 'NORMAL';
  },
): Promise<{ sent: number; purged: number }> {
  const title = String(opts.title || '').trim();
  const body = String(opts.body || '').trim();
  if (!title || !body) {
    console.error('[fcm-send]', { outcome: 'invalid_notification' });
    return { sent: 0, purged: 0 };
  }
  const tokens = await listDeviceTokens(env.DB, username, opts.platform || 'android');
  if (!tokens.length) return { sent: 0, purged: 0 };

  const projectId = String(env.FIREBASE_PROJECT_ID || '').trim();
  let accessToken: string | null = null;
  if (projectId) {
    try { accessToken = await getGoogleAccessToken(env); }
    catch { console.error('[fcm-oauth]', { outcome: 'unavailable' }); }
    // Do not silently switch projects/transports after a configured v1 failure.
    if (!accessToken) {
      console.error('[fcm-send]', { transport: 'v1', outcome: 'credentials_unavailable' });
      return { sent: 0, purged: 0 };
    }
  }
  const legacyKey = env.FCM_SERVER_KEY || env.FIREBASE_SERVER_KEY;
  if (!projectId && !legacyKey) {
    console.error('[fcm-send]', { outcome: 'not_configured' });
    return { sent: 0, purged: 0 };
  }
  const priority = opts.priority || 'HIGH';
  const data = {
    ...opts.data,
    event: opts.data?.event?.trim() || opts.data?.type?.trim() || opts.data?.kind?.trim() || 'atlas_notification',
    click_action: 'ATLAS_ASSIST_APPROVAL',
  };
  let sent = 0;
  let purged = 0;

  for (const row of tokens) {
    const token = String(row.token || '');
    if (!token) continue;
    const transport = projectId ? 'v1' : 'legacy';
    try {
      if (projectId && accessToken) {
        const res = await fetchWithTimeout(
          `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: {
                token,
                notification: { title, body },
                data,
                android: {
                  priority,
                  notification: { channel_id: 'atlas_assist', click_action: 'ATLAS_ASSIST_APPROVAL' },
                },
              },
            }),
          },
        );
        // Inspect every response, including 2xx. A status alone is not an ack.
        const reply: any = await res.json().catch(() => null);
        const messageId = res.ok ? acceptedMessageId(reply, projectId) : null;
        if (res.ok && messageId) {
          sent++;
          console.info('[fcm-send]', { transport, http_status: res.status, status: 'OK', outcome: 'accepted', message_id: messageId });
          continue;
        }
        const codes = responseCodes(reply);
        const unregistered = !res.ok && codes.fcm_codes.includes('UNREGISTERED');
        console.warn('[fcm-send]', { transport, http_status: res.status, ...codes, outcome: unregistered ? 'unregistered' : res.ok ? 'invalid_response' : 'rejected' });
        if (unregistered && await deleteDeviceToken(env.DB, token)) purged++;
        continue;
      }

      // Compatibility only for deployments explicitly configured for legacy.
      // Parse its per-recipient result too: HTTP 200 can contain a send error.
      const res = await fetchWithTimeout('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: { Authorization: `key=${legacyKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: token,
          priority: priority.toLowerCase(),
          notification: { title, body, sound: 'default', android_channel_id: 'atlas_assist', click_action: 'ATLAS_ASSIST_APPROVAL' },
          data,
        }),
      });
      const reply: any = await res.json().catch(() => null);
      const result = reply?.results?.[0];
      const id = result?.message_id ?? reply?.message_id;
      const messageId = typeof id === 'string' || typeof id === 'number' ? String(id) : '';
      const unregistered = result?.error === 'NotRegistered';
      if (res.ok && !result?.error && /^[A-Za-z0-9_:%.~-]{1,256}$/.test(messageId)) {
        sent++;
        console.info('[fcm-send]', { transport, http_status: res.status, outcome: 'accepted', message_id: messageId });
      } else {
        console.warn('[fcm-send]', { transport, http_status: res.status, outcome: unregistered ? 'unregistered' : 'rejected' });
        if (unregistered && await deleteDeviceToken(env.DB, token)) purged++;
      }
    } catch {
      // Exception messages/response bodies may echo a token or credential.
      console.error('[fcm-send]', { transport, outcome: 'network_or_response_failure' });
      // Continue with the other registered devices; never purge on a timeout.
    }
  }
  return { sent, purged };
}

/** Convenience for assist approval / proposal flows */
export async function notifyAssistApproval(
  env: FcmEnv,
  username: string,
  title: string,
  body: string,
  data?: FcmDataPayload,
) {
  return sendFcmToUser(env, username, {
    title,
    body,
    data: { ...data, event: data?.event || 'assist_approval' },
  });
}


/** Notify every registered device (owners / warehouse). Used for low stock. */
export async function sendFcmToAllDevices(
  env: FcmEnv,
  opts: { title: string; body: string; data?: FcmDataPayload },
): Promise<{ sent: number; purged: number }> {
  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS push_tokens (
        token TEXT PRIMARY KEY,
        username TEXT,
        platform TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
    ).run();
  } catch { /* */ }
  const rows = await env.DB.prepare(
    `SELECT DISTINCT token, username, platform FROM push_tokens ORDER BY updated_at DESC LIMIT 80`,
  ).all();
  const list = (rows?.results || []) as PushRow[];
  let sent = 0;
  let purged = 0;
  for (const row of list) {
    const user = String(row.username || '').trim();
    if (!user) continue;
    const r = await sendFcmToUser(env, user, {
      title: opts.title,
      body: opts.body,
      data: opts.data,
      platform: row.platform || 'android',
    });
    sent += r.sent;
    purged += r.purged;
  }
  return { sent, purged };
}

export async function notifyLowStock(
  env: FcmEnv,
  product: { id: number; name?: string; sku?: string; stock?: number; threshold?: number },
) {
  const name = product.name || `Produit #${product.id}`;
  const qty = product.stock ?? 0;
  const th = product.threshold ?? 0;
  const title = qty <= 0 ? 'Rupture de stock' : 'Stock bas';
  const body =
    qty <= 0
      ? `${name} est en rupture.`
      : `${name} : ${qty} restant(s) (seuil ${th}).`;
  return sendFcmToAllDevices(env, {
    title,
    body,
    data: {
      type: 'low_stock',
      product_id: String(product.id),
      stock: String(qty),
    },
  });
}
