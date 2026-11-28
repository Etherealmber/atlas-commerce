/**
 * Mailbox domain — peeled from worker/index.ts
 * HTTP: /api/admin/mailbox/*
 * Helpers: ensureMailSchema, R2 body crypto, Resend sync
 */
import type { Hono } from 'hono';
import { getAgentImageDraft, putAgentImageDraft } from '../../experiments/agent-storage/images';
import { schemaOnceForDb } from '../lib/schema';
import { agentAccountId, agentUploadFenceDraft, AgentStorageConflict, getAgentDraft, listAgentDraft, putAgentDraft, tombstoneAgentDraft, useAgentStoragePreview } from '../lib/agentSupabaseDraft';

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

  async function listAgentThreadKeys(env: any, userKey: string): Promise<Array<{ id: string; uploaded: number }>> {
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
    return objects.sort((a, b) => b.uploaded - a.uploaded).slice(0, 40);
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
    if (useAgentStoragePreview(c.env)) {
      try { return c.json({ success: true, data: await listAgentDraft(c.env, gate.username), meta: { unreadable_count: 0, pending_count: 0, storage: 'supabase-preview' } }); }
      catch { return c.json({ success: false, code: 'AGENT_STORAGE_UNAVAILABLE', error: 'Historique de test indisponible.' }, 503); }
    }
    let objects: Array<{ id: string; uploaded: number }>;
    try { objects = await listAgentThreadKeys(c.env, gate.userKey); } catch { return c.json({ success: false, code: 'AGENT_STORAGE_UNAVAILABLE', error: 'Historique R2 indisponible.' }, 503); }
    // Mobile clients have a short startup deadline. Return all discovered IDs
    // even if slow R2 reads prevent some encrypted summaries from loading in time.
    // The detail endpoint remains authoritative; no conversation is overwritten.
    const threads: any[] = objects.map(({ id, uploaded }) => ({ id, title: id, updated_at: uploaded ? new Date(uploaded).toISOString() : null, message_count: 0, summary_pending: true }));
    let next = 0; let expired = false;
    const readSummaries = async () => {
      while (next < objects.length) {
        if (expired) break;
        const index = next++; const id = objects[index].id;
        try {
          const loaded = await loadAgentThreadR2(c.env, gate.userKey, id);
          if (expired) return;
          if (!loaded?.data) { threads[index] = { ...threads[index], summary_pending: false, unreadable: true }; continue; }
          const data = loaded.data;
          const messages = Array.isArray(data.messages) ? data.messages : [];
          const firstUser = messages.find((message: any) => message?.role === 'user' && typeof message.text === 'string' && message.text.trim());
          const title = String(data.title || '').trim();
          threads[index] = { id, title: !title || title === 'Sans titre' ? String(firstUser?.text || title || 'Sans titre').trim().slice(0, 48) : title, updated_at: data.updated_at || data.stored_at || threads[index].updated_at, message_count: messages.length };
        } catch {
          if (!expired) threads[index] = { ...threads[index], summary_pending: false, unreadable: true };
        }
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all(Array.from({ length: Math.min(5, objects.length) }, readSummaries)),
      new Promise<void>(resolve => { timer = setTimeout(() => { expired = true; resolve(); }, 1800); }),
    ]);
    expired = true; if (timer) clearTimeout(timer);
    threads.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    return c.json({ success: true, data: threads, meta: { unreadable_count: threads.filter(t => t.unreadable).length, pending_count: threads.filter(t => t.summary_pending).length } });
  });

  app.get('/api/admin/agent/threads/:id', async (c) => {
    const gate = agentUserKeyFromRequest(c);
    if (!gate.ok) return gate.response;
    const id = String(c.req.param('id') || '');
    if (!validAgentThreadId(id)) return c.json({ success: false, error: 'Identifiant invalide.' }, 400);
    if (useAgentStoragePreview(c.env)) {
      try {
        const result = await getAgentDraft(c.env, gate.username, id);
        if (!result) return c.json({ success: true, data: { title: 'Sans titre', messages: [], updated_at: null }, meta: { empty: true, version: null, storage: 'supabase-preview' } });
        const data = JSON.parse(result.payload);
        if (!data || typeof data.title !== 'string' || !Array.isArray(data.messages)) throw new Error('invalid history');
        return c.json({ success: true, data, meta: { version: result.version, storage: 'supabase-preview' } });
      } catch { return c.json({ success: false, code: 'AGENT_STORAGE_UNAVAILABLE', error: 'Lecture de test indisponible.' }, 503); }
    }
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
    if (useAgentStoragePreview(c.env)) {
      // Image persistence and Android version support are not implemented in
      // this isolated preview. Reject rather than put image data in Supabase.
      if (!Object.prototype.hasOwnProperty.call(body, 'expected_version')) return c.json({ success: false, code: 'AGENT_VERSION_REQUIRED', error: 'Version requise pour ce test.' }, 409);
      if (/data:image\//i.test(JSON.stringify(body.messages))) return c.json({ success: false, code: 'AGENT_IMAGE_UNAVAILABLE', error: 'Images indisponibles dans ce test.' }, 422);
      try {
        const version = await putAgentDraft(c.env, gate.username, id, JSON.stringify(payload), body.expected_version, { title: payload.title, message_count: payload.messages.length });
        return c.json({ success: true, data: { id, title: payload.title, storage: 'supabase-preview', version } });
      } catch (error) {
        if (error instanceof AgentStorageConflict) return c.json({ success: false, code: 'AGENT_THREAD_CONFLICT', error: 'Cette conversation a été modifiée ailleurs.' }, 409);
        return c.json({ success: false, code: 'AGENT_STORAGE_UNAVAILABLE', error: 'Sauvegarde de test indisponible.' }, 503);
      }
    }
    try {
      const version = await storeAgentThreadR2(c.env, gate.userKey, id, payload, body.expected_version);
      return c.json({ success: true, data: { id, title: payload.title, storage: 'r2', version } });
    } catch (error) {
      if (error instanceof Error && error.message === 'thread too large') return c.json({ success: false, code: 'AGENT_THREAD_TOO_LARGE', error: 'Conversation trop volumineuse.' }, 413);
      if (error instanceof Error && error.message === 'conflict') return c.json({ success: false, code: 'AGENT_THREAD_CONFLICT', error: 'Cette conversation a été modifiée ailleurs. Les changements locaux sont conservés.' }, 409);
      return c.json({ success: false, code: 'AGENT_STORAGE_UNAVAILABLE', error: 'Impossible de sauvegarder la conversation sur R2.' }, 503);
    }
  });

  // Isolated preview only. Objects are encrypted and never served directly by R2.
  app.post('/api/admin/agent/threads/:id/images', async (c) => {
    if (!useAgentStoragePreview(c.env)) return c.json({ success: false, error: 'Indisponible.' }, 404);
    const gate = agentUserKeyFromRequest(c);
    if (!gate.ok) return gate.response;
    const id = String(c.req.param('id') || '');
    if (!validAgentThreadId(id)) return c.json({ success: false, error: 'Identifiant invalide.' }, 400);
    if (!c.env.IMAGES || !c.env.AGENT_HISTORY_ENCRYPTION_KEY) return c.json({ success: false, code: 'AGENT_STORAGE_UNAVAILABLE', error: 'Stockage indisponible.' }, 503);
    // Enforce a byte limit even when Content-Length is missing or misleading.
    const stream = c.req.raw.body;
    if (!stream) return c.json({ success: false, error: 'Image invalide.' }, 400);
    const reader = stream.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > 1_340_000) { await reader.cancel(); return c.json({ success: false, error: 'Image trop volumineuse.' }, 413); }
        chunks.push(part.value);
      }
    } catch { return c.json({ success: false, error: 'Image invalide.' }, 400); }
    let dataUrl: unknown;
    try {
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      dataUrl = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).data_url;
    } catch { return c.json({ success: false, error: 'Image invalide.' }, 400); }
    if (typeof dataUrl !== 'string' || !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(dataUrl)) return c.json({ success: false, error: 'Image invalide.' }, 400);
    try {
      const account = await agentAccountId(gate.username);
      const imageId = await putAgentImageDraft(c.env.IMAGES, agentUploadFenceDraft(c.env), c.env.AGENT_HISTORY_ENCRYPTION_KEY, account, id, dataUrl);
      return c.json({ success: true, data: { id: imageId } }, 200, { 'Cache-Control': 'private, no-store' });
    } catch { return c.json({ success: false, code: 'AGENT_STORAGE_UNAVAILABLE', error: 'Image indisponible.' }, 503); }
  });

  app.get('/api/admin/agent/threads/:id/images/:image', async (c) => {
    if (!useAgentStoragePreview(c.env)) return c.json({ success: false, error: 'Indisponible.' }, 404);
    const gate = agentUserKeyFromRequest(c);
    if (!gate.ok) return gate.response;
    const id = String(c.req.param('id') || ''); const imageId = String(c.req.param('image') || '');
    if (!validAgentThreadId(id) || !/^[a-f0-9]{32}$/.test(imageId)) return c.json({ success: false, error: 'Identifiant invalide.' }, 400);
    if (!c.env.IMAGES || !c.env.AGENT_HISTORY_ENCRYPTION_KEY) return c.json({ success: false, code: 'AGENT_STORAGE_UNAVAILABLE', error: 'Stockage indisponible.' }, 503);
    try {
      if (!await getAgentDraft(c.env, gate.username, id)) return c.json({ success: false, error: 'Introuvable.' }, 404, { 'Cache-Control': 'private, no-store' });
      const account = await agentAccountId(gate.username);
      const dataUrl = await getAgentImageDraft(c.env.IMAGES, c.env.AGENT_HISTORY_ENCRYPTION_KEY, account, id, imageId);
      if (!dataUrl || !await getAgentDraft(c.env, gate.username, id)) return c.json({ success: false, error: 'Introuvable.' }, 404, { 'Cache-Control': 'private, no-store' });
      return c.json({ success: true, data: { data_url: dataUrl } }, 200, { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    } catch { return c.json({ success: false, code: 'AGENT_STORAGE_UNAVAILABLE', error: 'Image indisponible.' }, 503); }
  });

  app.delete('/api/admin/agent/threads/:id', async (c) => {
    const gate = agentUserKeyFromRequest(c);
    if (!gate.ok) return gate.response;
    const id = String(c.req.param('id') || '');
    if (!validAgentThreadId(id)) return c.json({ success: false, error: 'Identifiant invalide.' }, 400);
    if (useAgentStoragePreview(c.env)) {
      try { await tombstoneAgentDraft(c.env, gate.username, id); return c.json({ success: true, meta: { preview: true, image_cleanup_pending: true } }); }
      catch { return c.json({ success: false, code: 'AGENT_STORAGE_UNAVAILABLE', error: 'Suppression de test indisponible.' }, 503); }
    }
    try {
      if (!c.env.IMAGES) throw new Error('storage unavailable');
      // The UI snapshot and model-context transcript have different user-key
      // encodings. Delete only this authenticated user's exact thread objects.
      const transcriptUser = gate.username.replace(/[^a-zA-Z0-9._@-]/g, '_').slice(0, 64);
      await c.env.IMAGES.delete([`agent/${gate.userKey}/${id}.agent`, `agent-chats/v2/${transcriptUser}/${id}.conv`]);
      return c.json({ success: true });
    } catch { return c.json({ success: false, code: 'AGENT_STORAGE_UNAVAILABLE', error: 'Impossible de supprimer la conversation R2.' }, 503); }
  });


}
