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

  function agentThreadSecrets(env: any, legacy = false): string[] {
    const secrets = [...new Set<string>([env.AGENT_CHAT_SECRET, env.MAIL_BODY_ENCRYPTION_KEY, env.JWT_SECRET, env.ADMIN_PASSWORD, env.BACKUP_ENCRYPTION_KEY, env.ADMIN_BACKUP_TOKEN].map(value => String(value || '').trim()).filter(Boolean))];
    return secrets.length || !legacy ? secrets : ['atlas-agent'];
  }
  async function agentCryptoKey(material: string, usage: KeyUsage[]): Promise<CryptoKey> {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`atlas-agent-v1|${material}`));
    return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, usage);
  }

  async function storeAgentThreadR2(env: any, userKey: string, threadId: string, payload: any, expectedVersion?: string | null): Promise<string> {
    if (!env.IMAGES) throw new Error('storage unavailable');
    const key = `agent/${userKey}/${threadId}.agent`;
    const plain = new TextEncoder().encode(JSON.stringify({ ...payload, stored_at: new Date().toISOString(), v: 1 }));
    if (plain.byteLength > 1_500_000) throw new Error('thread too large');
    const material = agentThreadSecrets(env)[0];
    if (!material) throw new Error('encryption unavailable');
    const cryptoKey = await agentCryptoKey(material, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, plain));
    const out = new Uint8Array(AGENT_BLOB_MAGIC.length + iv.length + cipher.length);
    out.set(AGENT_BLOB_MAGIC, 0); out.set(iv, AGENT_BLOB_MAGIC.length); out.set(cipher, AGENT_BLOB_MAGIC.length + iv.length);
    const written = await env.IMAGES.put(key, out, {
      ...(expectedVersion === undefined ? {} : { onlyIf: expectedVersion === null ? new Headers({ 'If-None-Match': '*' }) : { etagMatches: expectedVersion } }),
      httpMetadata: { contentType: 'application/vnd.atlas.agent', cacheControl: 'private, no-store' },
      customMetadata: { encrypted: 'aes-gcm-agent-v1', thread: threadId.slice(0, 64) },
    });
    if (!written) throw new Error('conflict');
    if (!written.etag) throw new Error('missing version');
    return String(written.etag);
  }

  async function loadAgentThreadR2(env: any, userKey: string, threadId: string): Promise<{ data: any; version: string } | null> {
    if (!env.IMAGES) throw new Error('storage unavailable');
    const obj = await env.IMAGES.get(`agent/${userKey}/${threadId}.agent`);
    if (!obj) return null;
    const buf = new Uint8Array(await obj.arrayBuffer());
    if (buf.length < AGENT_BLOB_MAGIC.length + 12 + 16 || !AGENT_BLOB_MAGIC.every((b, i) => buf[i] === b) || !obj.etag) throw new Error('invalid thread');
    for (const material of agentThreadSecrets(env, true)) {
      try {
        const cryptoKey = await agentCryptoKey(material, ['decrypt']);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.subarray(AGENT_BLOB_MAGIC.length, AGENT_BLOB_MAGIC.length + 12) }, cryptoKey, buf.subarray(AGENT_BLOB_MAGIC.length + 12));
        return { data: JSON.parse(new TextDecoder().decode(plain)), version: String(obj.etag) };
      } catch { /* try previously configured keys, never return corrupt data */ }
    }
    throw new Error('thread decryption failed');
  }

  async function listAgentThreadKeys(env: any, userKey: string): Promise<string[]> {
    if (!env.IMAGES) throw new Error('storage unavailable');
    const objects: Array<{ id: string; uploaded: number }> = [];
    let cursor: string | undefined;
    // Bounded scan. Do not delete objects as a side effect of listing history.
    for (let page = 0; page < 10; page++) {
      const listed = await env.IMAGES.list({ prefix: `agent/${userKey}/`, limit: 100, ...(cursor ? { cursor } : {}) });
      for (const o of listed.objects || []) {
        const key = String(o.key || '');
        if (key.endsWith('.agent')) objects.push({ id: key.slice(`agent/${userKey}/`.length, -6), uploaded: o.uploaded ? new Date(o.uploaded).getTime() : 0 });
      }
      if (!listed.truncated || !listed.cursor) break;
      cursor = listed.cursor;
    }
    return objects.sort((a, b) => b.uploaded - a.uploaded).slice(0, 40).map(o => o.id);
  }

  const validAgentThreadId = (id: string) => /^[a-zA-Z0-9._-]{1,80}$/.test(id) && id !== '.' && id !== '..';

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
    let ids: string[];
    try { ids = await listAgentThreadKeys(c.env, gate.userKey); } catch { return c.json({ success: false, code: 'AGENT_STORAGE_UNAVAILABLE', error: 'Historique R2 indisponible.' }, 503); }
    const threads: any[] = [];
    // Loading sequentially made opening history wait for up to 40 R2 reads.
    // Keep concurrency bounded while preserving the existing 40-item limit.
    for (let offset = 0; offset < Math.min(ids.length, 40); offset += 5) {
      const chunk = await Promise.all(ids.slice(offset, offset + 5).map(async (id) => {
        const loaded = await loadAgentThreadR2(c.env, gate.userKey, id).catch(() => null);
        const data = loaded?.data;
        if (!data) return { id, title: id, updated_at: null, message_count: 0, unreadable: true };
        const messages = Array.isArray(data.messages) ? data.messages : [];
        const firstUser = messages.find((message: any) => message?.role === 'user' && typeof message.text === 'string' && message.text.trim());
        const title = String(data.title || '').trim();
        return {
          id,
          title: !title || title === 'Sans titre' ? String(firstUser?.text || title || 'Sans titre').trim().slice(0, 48) : title,
          updated_at: data.updated_at || data.stored_at || null,
          message_count: messages.length,
        };
      }));
      threads.push(...chunk);
    }
    threads.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    return c.json({ success: true, data: threads, meta: { unreadable_count: threads.filter(t => t.unreadable).length } });
  });

  app.get('/api/admin/agent/threads/:id', async (c) => {
    const gate = agentUserKeyFromRequest(c);
    if (!gate.ok) return gate.response;
    const id = String(c.req.param('id') || '');
    if (!validAgentThreadId(id)) return c.json({ success: false, error: 'Identifiant invalide.' }, 400);
    try {
      const result = await loadAgentThreadR2(c.env, gate.userKey, id);
      if (!result) return c.json({ success: true, data: { title: 'Sans titre', messages: [], updated_at: null }, meta: { empty: true, version: null } });
      return c.json({ success: true, data: result.data, meta: { version: result.version } });
    } catch { return c.json({ success: false, code: 'AGENT_STORAGE_UNAVAILABLE', error: 'Impossible de lire la conversation R2.' }, 503); }
  });

  app.put('/api/admin/agent/threads/:id', async (c) => {
    const gate = agentUserKeyFromRequest(c);
    if (!gate.ok) return gate.response;
    const id = String(c.req.param('id') || '');
    if (!validAgentThreadId(id)) return c.json({ success: false, error: 'Identifiant invalide.' }, 400);
    const body = await c.req.json().catch(() => ({}));
    if ('expected_version' in body && body.expected_version !== null && (typeof body.expected_version !== 'string' || body.expected_version.length > 128)) return c.json({ success: false, error: 'Version invalide.' }, 400);
    if (!Array.isArray(body.messages)) return c.json({ success: false, error: 'Messages invalides.' }, 400);
    if (body.messages.length > 500) return c.json({ success: false, code: 'AGENT_THREAD_TOO_LARGE', error: 'Conversation trop volumineuse.' }, 413);
    const payload = { title: String(body.title || 'Sans titre').slice(0, 200), messages: body.messages, updated_at: new Date().toISOString() };
    try {
      const version = await storeAgentThreadR2(c.env, gate.userKey, id, payload, body.expected_version);
      return c.json({ success: true, data: { id, title: payload.title, storage: 'r2', version } });
    } catch (error) {
      if (error instanceof Error && error.message === 'thread too large') return c.json({ success: false, code: 'AGENT_THREAD_TOO_LARGE', error: 'Conversation trop volumineuse.' }, 413);
      if (error instanceof Error && error.message === 'conflict') return c.json({ success: false, code: 'AGENT_THREAD_CONFLICT', error: 'Cette conversation a été modifiée ailleurs. Les changements locaux sont conservés.' }, 409);
      return c.json({ success: false, code: 'AGENT_STORAGE_UNAVAILABLE', error: 'Impossible de sauvegarder la conversation sur R2.' }, 503);
    }
  });

  app.delete('/api/admin/agent/threads/:id', async (c) => {
    const gate = agentUserKeyFromRequest(c);
    if (!gate.ok) return gate.response;
    const id = String(c.req.param('id') || '');
    if (!validAgentThreadId(id)) return c.json({ success: false, error: 'Identifiant invalide.' }, 400);
    try {
      if (!c.env.IMAGES) throw new Error('storage unavailable');
      await c.env.IMAGES.delete(`agent/${gate.userKey}/${id}.agent`);
      return c.json({ success: true });
    } catch { return c.json({ success: false, code: 'AGENT_STORAGE_UNAVAILABLE', error: 'Impossible de supprimer la conversation R2.' }, 503); }
  });


}
