/**
 * Mailbox domain — peeled from worker/index.ts
 * HTTP: /api/admin/mailbox/*
 * Helpers: ensureMailSchema, R2 body crypto, Resend sync
 */
import type { Hono } from 'hono';
import { assertSafeOutboundUrl } from '../lib/security';
import { apiFail } from '../lib/api-response';
import { upstreamFetch } from '../lib/upstream';
import { enqueue } from '../lib/job-queue';

export type MailboxRouteDeps = {
  verifyBackupAccess: (
    c: any,
    opts?: { requireBackupToken?: boolean },
  ) => Promise<{ ok: true; username: string } | { ok: false; response: Response }>;
  sessionUserFromHeader: (authHeader: string | undefined) => { username: string; role: string };
};

export const ADMIN_MAILBOX = 'admin@afmarbre.com';

export async function ensureMailSchema(db: D1Database): Promise<void> {
  await db.prepare(`CREATE TABLE IF NOT EXISTS mail_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    direction TEXT NOT NULL DEFAULT 'out',
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
  try { await db.prepare(`CREATE INDEX IF NOT EXISTS idx_mail_resend_id ON mail_messages(resend_id)`).run(); } catch { /* */ }
  // Also ensure optional tables that backup/export may touch (avoids noisy "no such table" logs)
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS push_tokens (
      token TEXT PRIMARY KEY,
      username TEXT,
      platform TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )`).run();
  } catch { /* */ }
}

/** Magic header for encrypted mail blobs stored in R2 (`.mail` files). */
const MAIL_BLOB_MAGIC = new TextEncoder().encode('ATLASMAIL1'); // 10 bytes

/** Derive a 32-byte AES key for mail body encryption. */
async function mailBodyCryptoKey(env: any, usage: KeyUsage[]): Promise<CryptoKey> {
  const explicit = String(env.MAIL_BODY_ENCRYPTION_KEY || '').trim();
  const material = explicit.length >= 16
    ? explicit
    : `atlas-mail-v1|${String(env.ADMIN_PASSWORD || env.JWT_SECRET || 'atlas-mail-fallback').trim()}`;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, usage);
}

/**
 * Persist full mail body to R2 as an encrypted `.mail` blob (AES-GCM).
 * Old messages may still point at plain `.json` — those remain readable via loadMailBodyR2.
 */
export async function storeMailBodyR2(env: any, id: string, html: string, text: string): Promise<string | null> {
  try {
    if (!env.IMAGES) return null;
    const key = `mail/${ADMIN_MAILBOX}/${id}.mail`;
    const payload = JSON.stringify({
      html: String(html || ''),
      text: String(text || ''),
      stored_at: new Date().toISOString(),
      v: 1,
    });
    const cryptoKey = await mailBodyCryptoKey(env, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, new TextEncoder().encode(payload))
    );
    // layout: magic(10) + iv(12) + ciphertext
    const out = new Uint8Array(MAIL_BLOB_MAGIC.length + iv.length + cipher.length);
    out.set(MAIL_BLOB_MAGIC, 0);
    out.set(iv, MAIL_BLOB_MAGIC.length);
    out.set(cipher, MAIL_BLOB_MAGIC.length + iv.length);
    await env.IMAGES.put(key, out, {
      httpMetadata: { contentType: 'application/vnd.atlas.mail', cacheControl: 'private, no-store' },
      customMetadata: { encrypted: 'aes-gcm-v1', format: 'mail' },
    });
    return key;
  } catch (e) {
    console.error('storeMailBodyR2_err', String((e as any)?.message || e));
    return null;
  }
}

/**
 * Load a mail body from R2.
 * Supports:
 *  - new encrypted `.mail` blobs (ATLASMAIL1 + AES-GCM)
 *  - legacy plain `.json` objects `{ html, text }`
 */

/** Write body only to R2; keep D1 columns empty (metadata + r2_key only). */
async function persistMailBodyR2Only(
  env: any,
  msgId: string | number,
  html: string,
  text: string,
): Promise<string | null> {
  const key = await storeMailBodyR2(env, String(msgId), html || '', text || '');
  if (!key) return null;
  try {
    await env.DB.prepare(
      `UPDATE mail_messages SET r2_key = ?, body_html = '', body_text = '' WHERE id = ?`,
    )
      .bind(key, msgId)
      .run();
  } catch {
    try {
      await env.DB.prepare(`UPDATE mail_messages SET r2_key = ? WHERE id = ?`).bind(key, msgId).run();
    } catch { /* */ }
  }
  return key;
}

export async function loadMailBodyR2(
  env: any,
  r2Key: string
): Promise<{ html?: string; text?: string } | null> {
  try {
    if (!env.IMAGES || !r2Key) return null;
    const obj = await env.IMAGES.get(r2Key);
    if (!obj) return null;

    // Legacy plain JSON
    const ct = (obj.httpMetadata?.contentType || '').toLowerCase();
    const isLegacyJson =
      r2Key.endsWith('.json') ||
      ct.includes('application/json') ||
      (obj.customMetadata?.encrypted !== 'aes-gcm-v1' && !r2Key.endsWith('.mail'));

    if (isLegacyJson && !r2Key.endsWith('.mail')) {
      try {
        const j = (await obj.json()) as any;
        if (j && (j.html != null || j.text != null)) {
          return { html: j.html ? String(j.html) : undefined, text: j.text ? String(j.text) : undefined };
        }
      } catch { /* fall through to binary path */ }
    }

    const buf = new Uint8Array(await obj.arrayBuffer());
    // Encrypted .mail with magic header
    if (buf.length > 22) {
      let magicOk = true;
      for (let i = 0; i < MAIL_BLOB_MAGIC.length; i++) {
        if (buf[i] !== MAIL_BLOB_MAGIC[i]) { magicOk = false; break; }
      }
      if (magicOk) {
        const iv = buf.subarray(10, 22);
        const cipher = buf.subarray(22);
        const cryptoKey = await mailBodyCryptoKey(env, ['decrypt']);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, cipher);
        const j = JSON.parse(new TextDecoder().decode(plain)) as any;
        return {
          html: j?.html != null ? String(j.html) : undefined,
          text: j?.text != null ? String(j.text) : undefined,
        };
      }
    }

    // Older encrypted layout without magic (iv + cipher only) — try if metadata says encrypted
    if (obj.customMetadata?.encrypted === 'aes-gcm-v1' && buf.length > 12) {
      try {
        const iv = buf.subarray(0, 12);
        const cipher = buf.subarray(12);
        const cryptoKey = await mailBodyCryptoKey(env, ['decrypt']);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, cipher);
        const j = JSON.parse(new TextDecoder().decode(plain)) as any;
        return {
          html: j?.html != null ? String(j.html) : undefined,
          text: j?.text != null ? String(j.text) : undefined,
        };
      } catch { /* */ }
    }

    // Last resort: treat body as UTF-8 JSON
    try {
      const j = JSON.parse(new TextDecoder().decode(buf)) as any;
      if (j && (j.html != null || j.text != null)) {
        return { html: j.html ? String(j.html) : undefined, text: j.text ? String(j.text) : undefined };
      }
    } catch { /* */ }
    return null;
  } catch (e) {
    console.error('loadMailBodyR2_err', String((e as any)?.message || e));
    return null;
  }
}

function normalizeAddrList(v: any): string {
  if (Array.isArray(v)) return v.map(String).filter(Boolean).join(', ');
  return String(v || '').trim();
}

export async function syncResendHistory(env: any, opts?: { limit?: number }): Promise<{ imported: number; skipped: number; errors: number; total_listed: number }> {
  const apiKey = String(env.RESEND_API_KEY || '').trim();
  if (!apiKey) return { imported: 0, skipped: 0, errors: 0, total_listed: 0 };
  await ensureMailSchema(env.DB);
  const max = Math.min(200, Math.max(10, Number(opts?.limit || 100)));
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  let total_listed = 0;
  let after: string | null = null;

  for (let page = 0; page < 15 && total_listed < max; page++) {
    const url = new URL('https://api.resend.com/emails');
    url.searchParams.set('limit', String(Math.min(100, max - total_listed)));
    if (after) url.searchParams.set('after', after);
    const listRes = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (!listRes.ok) {
      errors++;
      break;
    }
    const listJson = await listRes.json().catch(() => ({})) as any;
    const items: any[] = Array.isArray(listJson?.data) ? listJson.data : [];
    if (!items.length) break;
    total_listed += items.length;

    for (const item of items) {
      const rid = String(item.id || '').trim();
      if (!rid) continue;
      try {
        const existing = await env.DB.prepare(
          `SELECT id FROM mail_messages WHERE resend_id = ? LIMIT 1`
        ).bind(rid).first();
        if (existing) {
          skipped++;
          continue;
        }

        let detail: any = item;
        try {
          // Soft rate-limit: Resend free tier is ~10 req/s; pause briefly between detail fetches
          await new Promise((r) => setTimeout(r, 120));
          const dRes = await fetch(`https://api.resend.com/emails/${encodeURIComponent(rid)}`, {
            headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
          });
          if (dRes.ok) {
            const dj = await dRes.json().catch(() => null);
            // Resend may wrap as { data: {...} }
            if (dj?.data && typeof dj.data === 'object') detail = dj.data;
            else if (dj) detail = dj;
          } else if (dRes.status === 429) {
            // Hit rate limit — stop further detail fetches this run
            errors++;
            break;
          }
        } catch { /* use list item */ }

        const from = String(detail.from || item.from || env.RESEND_FROM || ADMIN_MAILBOX);
        const to = normalizeAddrList(detail.to ?? item.to);
        const cc = normalizeAddrList(detail.cc ?? item.cc);
        const subject = String(detail.subject || item.subject || '(sans objet)').slice(0, 500);
        const html = String(detail.html || '').slice(0, 200000);
        const text = String(detail.text || '').slice(0, 50000);
        const createdRaw = String(detail.created_at || item.created_at || new Date().toISOString());
        const created = createdRaw.includes('T')
          ? createdRaw.replace('T', ' ').replace(/\.\d+Z?$/, '').slice(0, 19)
          : createdRaw.slice(0, 19);
        const status = String(detail.last_event || item.last_event || 'sent');

        const ins = await env.DB.prepare(
          `INSERT INTO mail_messages (direction, mailbox, from_addr, to_addr, cc_addr, subject, body_text, body_html, resend_id, status, meta_json, created_at)
           VALUES ('out', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          ADMIN_MAILBOX,
          from,
          to,
          cc,
          subject,
          text || (html ? html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000) : ''),
          html,
          rid,
          status,
          JSON.stringify({ source: 'resend_sync', last_event: status }),
          created,
        ).run();
        const newId = String(ins.meta?.last_row_id || '');
        if (newId && (html || text)) {
          await persistMailBodyR2Only(env, newId, html, text);
        }
        imported++;
      } catch {
        errors++;
      }
    }

    const lastId = items[items.length - 1]?.id;
    if (listJson?.has_more && lastId) {
      after = String(lastId);
    } else {
      break;
    }
  }

  // Also try Resend receiving (inbound) API if available on the account
  try {
    const rUrl = new URL('https://api.resend.com/emails/receiving');
    rUrl.searchParams.set('limit', '50');
    const rRes = await fetch(rUrl.toString(), {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (rRes.ok) {
      const rj = await rRes.json().catch(() => ({})) as any;
      const rItems: any[] = Array.isArray(rj?.data) ? rj.data : [];
      total_listed += rItems.length;
      for (const item of rItems) {
        const rid = String(item.id || '').trim();
        if (!rid) continue;
        try {
          const existing = await env.DB.prepare(`SELECT id FROM mail_messages WHERE resend_id = ? LIMIT 1`).bind(`recv-${rid}`).first();
          if (existing) { skipped++; continue; }
          const from = String(item.from || '');
          const to = normalizeAddrList(item.to) || ADMIN_MAILBOX;
          const subject = String(item.subject || '(sans objet)').slice(0, 500);
          const createdRaw = String(item.created_at || new Date().toISOString());
          const created = createdRaw.includes('T')
            ? createdRaw.replace('T', ' ').replace(/\.\d+Z?$/, '').slice(0, 19)
            : createdRaw.slice(0, 19);
          await env.DB.prepare(
            `INSERT INTO mail_messages (direction, mailbox, from_addr, to_addr, subject, body_text, resend_id, status, meta_json, created_at)
             VALUES ('in', ?, ?, ?, ?, ?, ?, 'received', ?, ?)`
          ).bind(
            ADMIN_MAILBOX, from, to, subject,
            String(item.text || item.html || '').replace(/<[^>]+>/g, ' ').slice(0, 5000),
            `recv-${rid}`,
            JSON.stringify({ source: 'resend_receiving' }),
            created,
          ).run();
          imported++;
        } catch { errors++; }
      }
    }
  } catch { /* receiving API may not be enabled */ }

  return { imported, skipped, errors, total_listed };
}


export function registerMailboxRoutes(app: Hono<any>, deps: MailboxRouteDeps): void {
  const verifyBackupAccess = deps.verifyBackupAccess;
  const sessionUserFromHeader = deps.sessionUserFromHeader;

  const AGENT_BLOB_MAGIC = new TextEncoder().encode('ATLASAGNT1');

  async function agentCryptoKey(env: any, usage: KeyUsage[]): Promise<CryptoKey> {
    const material = String(
      env.AGENT_CHAT_SECRET || env.MAIL_BODY_ENCRYPTION_KEY || env.JWT_SECRET || env.ADMIN_PASSWORD || 'atlas-agent',
    ).trim();
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`atlas-agent-v1|${material}`));
    return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, usage);
  }

  async function storeAgentThreadR2(env: any, userKey: string, threadId: string, payload: any): Promise<boolean> {
    const body = { ...payload, stored_at: new Date().toISOString(), v: 1 };
    try {
      if (env.IMAGES) {
        const key = `agent/${userKey}/${threadId}.agent`;
        const plain = new TextEncoder().encode(JSON.stringify(body));
        if (plain.byteLength > 1_500_000) return false; // v231: refuse oversized blobs, keep local copy
        const cryptoKey = await agentCryptoKey(env, ['encrypt']);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, plain));
        const out = new Uint8Array(AGENT_BLOB_MAGIC.length + iv.length + cipher.length);
        out.set(AGENT_BLOB_MAGIC, 0);
        out.set(iv, AGENT_BLOB_MAGIC.length);
        out.set(cipher, AGENT_BLOB_MAGIC.length + iv.length);
        await env.IMAGES.put(key, out, {
          httpMetadata: { contentType: 'application/vnd.atlas.agent', cacheControl: 'private, no-store' },
          customMetadata: { encrypted: 'aes-gcm-agent-v1', thread: String(threadId).slice(0, 64) },
        });
        return true;
      }
      // Fallback: KV (no R2 binding in this env) — still no plaintext in D1
      if (env.CACHE) {
        const k = `agent-thread:${userKey}:${threadId}`;
        await env.CACHE.put(k, JSON.stringify(body), { expirationTtl: 60 * 60 * 24 * 30 });
        // index of thread ids
        const idxKey = `agent-thread-idx:${userKey}`;
        let ids: string[] = [];
        try {
          const raw = await env.CACHE.get(idxKey);
          if (raw) ids = JSON.parse(raw);
        } catch { /* */ }
        if (!Array.isArray(ids)) ids = [];
        if (!ids.includes(threadId)) ids.unshift(threadId);
        await env.CACHE.put(idxKey, JSON.stringify(ids.slice(0, 40)), { expirationTtl: 60 * 60 * 24 * 30 });
        return true;
      }
      return false;
    } catch (e) {
      console.error('storeAgentThreadR2', String((e as any)?.message || e));
      return false;
    }
  }

  async function loadAgentThreadR2(env: any, userKey: string, threadId: string): Promise<any | null> {
    try {
      if (env.IMAGES) {
        const key = `agent/${userKey}/${threadId}.agent`;
        const obj = await env.IMAGES.get(key);
        if (obj) {
          const buf = new Uint8Array(await obj.arrayBuffer());
          if (buf.length >= AGENT_BLOB_MAGIC.length + 12 + 1) {
            const magicOk = AGENT_BLOB_MAGIC.every((b, i) => buf[i] === b);
            if (magicOk) {
              const iv = buf.subarray(AGENT_BLOB_MAGIC.length, AGENT_BLOB_MAGIC.length + 12);
              const cipher = buf.subarray(AGENT_BLOB_MAGIC.length + 12);
              const cryptoKey = await agentCryptoKey(env, ['decrypt']);
              const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, cryptoKey, cipher);
              return JSON.parse(new TextDecoder().decode(plain));
            }
          }
        }
      }
      if (env.CACHE) {
        const raw = await env.CACHE.get(`agent-thread:${userKey}:${threadId}`);
        if (raw) return JSON.parse(raw);
      }
      return null;
    } catch (e) {
      console.error('loadAgentThreadR2', String((e as any)?.message || e));
      return null;
    }
  }

  async function listAgentThreadKeys(env: any, userKey: string): Promise<string[]> {
    const ids: string[] = [];
    try {
      if (env.IMAGES) {
        const listed = await env.IMAGES.list({ prefix: `agent/${userKey}/`, limit: 50 });
        const cutoff = Date.now() - 30 * 86400000;
        for (const o of listed.objects || []) {
          const k = String(o.key || '');
          if (!k.endsWith('.agent')) continue;
          const uploaded = o.uploaded ? new Date(o.uploaded).getTime() : 0;
          if (uploaded && uploaded < cutoff) {
            try { await env.IMAGES.delete(k); } catch { /* */ }
            continue;
          }
          ids.push(k.replace(`agent/${userKey}/`, '').replace(/\.agent$/, ''));
        }
      }
    } catch { /* */ }
    try {
      if (env.CACHE) {
        const raw = await env.CACHE.get(`agent-thread-idx:${userKey}`);
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            for (const id of arr) {
              if (id && !ids.includes(id)) ids.push(String(id));
            }
          }
        }
      }
    } catch { /* */ }
    return ids.slice(0, 50);
  }

  function agentUserKeyFromRequest(c: any): { ok: true; userKey: string; username: string } | { ok: false; response: Response } {
    const authHeader = c.req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return { ok: false, response: c.json({ success: false, error: 'Authentification requise.' }, 401) };
    }
    const session = sessionUserFromHeader(authHeader);
    const username = String(session.username || '').trim();
    if (!username) {
      return { ok: false, response: c.json({ success: false, error: 'Session invalide.' }, 401) };
    }
    const userKey = username.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64) || 'user';
    return { ok: true, userKey, username };
  }

  app.get('/api/admin/agent/threads', async (c) => {
    const gate = agentUserKeyFromRequest(c);
    if (!gate.ok) return gate.response;
    const ids = await listAgentThreadKeys(c.env, gate.userKey);
    const threads: any[] = [];
    for (const id of ids.slice(0, 40)) {
      const data = await loadAgentThreadR2(c.env, gate.userKey, id);
      if (data) {
        threads.push({
          id,
          title: data.title || 'Sans titre',
          updated_at: data.updated_at || data.stored_at || null,
          message_count: Array.isArray(data.messages) ? data.messages.length : 0,
        });
      } else {
        threads.push({ id, title: id, updated_at: null, message_count: 0 });
      }
    }
    threads.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    return c.json({ success: true, data: threads });
  });

  app.get('/api/admin/agent/threads/:id', async (c) => {
    const gate = agentUserKeyFromRequest(c);
    if (!gate.ok) return gate.response;
    const id = String(c.req.param('id') || '').slice(0, 80);
    if (!id) return c.json({ success: false, error: 'id requis' }, 400);
    const data = await loadAgentThreadR2(c.env, gate.userKey, id);
    if (!data) {
      return c.json({
        success: true,
        data: { title: 'Sans titre', messages: [], updated_at: null },
        meta: { empty: true },
      });
    }
    return c.json({ success: true, data });
  });

  app.put('/api/admin/agent/threads/:id', async (c) => {
    const gate = agentUserKeyFromRequest(c);
    if (!gate.ok) return gate.response;
    const id = String(c.req.param('id') || '').slice(0, 80);
    if (!id) return c.json({ success: false, error: 'id requis' }, 400);
    const body = await c.req.json().catch(() => ({}));
    const payload = {
      title: String(body.title || 'Sans titre').slice(0, 200),
      messages: Array.isArray(body.messages) ? body.messages.slice(-80) : [],
      updated_at: new Date().toISOString(),
    };
    const ok = await storeAgentThreadR2(c.env, gate.userKey, id, payload);
    if (!ok) {
      // Do not spam clients with 503 — conversation still lives in browser sessionStorage
      return c.json({
        success: true,
        data: { id, title: payload.title, storage: 'local_only' },
        meta: { note: 'Persistance serveur indisponible — historique local uniquement' },
      });
    }
    return c.json({ success: true, data: { id, title: payload.title, storage: c.env.IMAGES ? 'r2' : 'kv' } });
  });

  app.delete('/api/admin/agent/threads/:id', async (c) => {
    const gate = agentUserKeyFromRequest(c);
    if (!gate.ok) return gate.response;
    const id = String(c.req.param('id') || '').slice(0, 80);
    try {
      if (c.env.IMAGES) await c.env.IMAGES.delete(`agent/${gate.userKey}/${id}.agent`);
    } catch { /* */ }
    return c.json({ success: true });
  });


}
