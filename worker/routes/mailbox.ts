/**
 * Mailbox domain — peeled from worker/index.ts
 * HTTP: /api/admin/mailbox/*
 * Helpers: ensureMailSchema, R2 body crypto, Resend sync
 */
import type { Hono } from 'hono';
import { schemaOnceForDb } from '../lib/schema';

type MailboxRouteDeps = {
  verifyBackupAccess: (
    c: any,
    opts?: { requireBackupToken?: boolean },
  ) => Promise<{ ok: true; username: string } | { ok: false; response: Response }>;
  sessionUserFromHeader: (authHeader: string | undefined) => { username: string; role: string };
};


/** Once per D1 binding per isolate — the DDL below is idempotent, so
 *  re-running it on every request only cost D1 round-trips. */
export async function ensureMailSchema(db: D1Database): Promise<void> {
  await schemaOnceForDb(db, 'ensureMailSchema', () => ensureMailSchemaBody(db));
}

async function ensureMailSchemaBody(db: D1Database): Promise<void> {
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
new TextEncoder().encode('ATLASMAIL1'); // 10 bytes








export function registerMailboxRoutes(app: Hono<any>, deps: MailboxRouteDeps): void {
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
