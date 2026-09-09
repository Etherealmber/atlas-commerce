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

type PushRow = { token: string; platform?: string };

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

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    console.error('FCM OAuth failed', res.status, data?.error || data);
    return null;
  }
  return String(data.access_token);
}

async function ensurePushTable(db: D1Database) {
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

export async function deleteDeviceToken(db: D1Database, token: string): Promise<void> {
  try {
    await db.prepare(`DELETE FROM device_push_tokens WHERE token = ?`).bind(token).run();
  } catch { /* */ }
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
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .bind(username, platform, limit)
    .all();
  return (rows?.results || []) as PushRow[];
}

/**
 * Send FCM HTTP v1 data+notification message.
 * Purges token if FCM reports UNREGISTERED / NOT_FOUND.
 */
export async function sendFcmToUser(
  env: FcmEnv,
  username: string,
  opts: {
    title: string;
    body: string;
    data?: FcmDataPayload;
    platform?: string;
  },
): Promise<{ sent: number; purged: number }> {
  const tokens = await listDeviceTokens(env.DB, username, opts.platform || 'android');
  if (!tokens.length) return { sent: 0, purged: 0 };

  const projectId = String(env.FIREBASE_PROJECT_ID || '').trim();
  const accessToken = projectId ? await getGoogleAccessToken(env) : null;

  let sent = 0;
  let purged = 0;

  for (const row of tokens) {
    const token = String(row.token || '');
    if (!token) continue;

    if (accessToken && projectId) {
      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token,
              notification: {
                title: opts.title,
                body: opts.body,
              },
              data: {
                ...(opts.data || {}),
                click_action: 'ATLAS_ASSIST_APPROVAL',
              },
              android: {
                priority: 'HIGH',
                notification: {
                  channel_id: 'atlas_assist',
                  click_action: 'ATLAS_ASSIST_APPROVAL',
                },
              },
            },
          }),
        },
      );
      if (res.ok) {
        sent++;
        continue;
      }
      const errBody: any = await res.json().catch(() => ({}));
      const status = String(errBody?.error?.details?.[0]?.errorCode || errBody?.error?.status || res.status);
      if (
        res.status === 404 ||
        status.includes('UNREGISTERED') ||
        status.includes('NOT_FOUND') ||
        status === '404'
      ) {
        await deleteDeviceToken(env.DB, token);
        purged++;
      } else {
        console.error('FCM v1 send failed', res.status, status);
      }
      continue;
    }

    // Legacy HTTP API fallback
    const legacyKey = env.FCM_SERVER_KEY || env.FIREBASE_SERVER_KEY;
    if (!legacyKey) continue;
    const res = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        Authorization: `key=${legacyKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: token,
        priority: 'high',
        notification: { title: opts.title, body: opts.body, sound: 'default' },
        data: opts.data || {},
      }),
    });
    if (res.ok) {
      sent++;
    } else if (res.status === 404 || res.status === 410) {
      await deleteDeviceToken(env.DB, token);
      purged++;
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
    data: data || { type: 'assist_approval' },
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
