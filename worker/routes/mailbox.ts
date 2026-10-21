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

  app.get('/api/admin/mailbox', async (c) => {
    // Fast path only — never call Resend here (avoids timeouts / HTML error pages).
    const gate = await verifyBackupAccess(c, { requireBackupToken: false });
    if (!gate.ok) return gate.response;
    try {
      await ensureMailSchema(c.env.DB);
    } catch (e: any) {
      return c.json({ success: false, error: 'Schema mail: ' + (e?.message || e) }, 500);
    }
    const dir = String(c.req.query('direction') || '').trim();
    const statusFilter = String(c.req.query('status') || '').trim().toLowerCase();
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 50)));
    const offset = Math.max(0, Number(c.req.query('offset') || 0));
    const qRaw = String(c.req.query('q') || '').trim();

    // Parse Gmail-like operators from q
    let fromOp = '';
    let toOp = '';
    let subjectOp = '';
    let hasAttach = false;
    let isUnread = false;
    let afterOp = '';
    let beforeOp = '';
    let freeText = qRaw;
    if (qRaw) {
      const take = (re: RegExp) => {
        const m = freeText.match(re);
        if (!m) return '';
        freeText = freeText.replace(re, ' ').replace(/\s+/g, ' ').trim();
        return (m[1] || '').trim();
      };
      fromOp = take(/\bfrom:(\S+)/i);
      toOp = take(/\bto:(\S+)/i);
      subjectOp = take(/\bsubject:("([^"]+)"|(\S+))/i) || take(/\bsubject:(\S+)/i);
      // subject capture may include quotes group
      const subjM = qRaw.match(/\bsubject:("([^"]+)"|(\S+))/i);
      if (subjM) subjectOp = (subjM[2] || subjM[3] || '').trim();
      if (/\bhas:attachment\b/i.test(qRaw)) {
        hasAttach = true;
        freeText = freeText.replace(/\bhas:attachment\b/gi, ' ').replace(/\s+/g, ' ').trim();
      }
      if (/\bis:(unread|non[\s-]?lu)\b/i.test(qRaw)) {
        isUnread = true;
        freeText = freeText.replace(/\bis:(unread|non[\s-]?lu)\b/gi, ' ').replace(/\s+/g, ' ').trim();
      }
      afterOp = take(/\bafter:(\d{4}-\d{2}-\d{2})\b/i);
      beforeOp = take(/\bbefore:(\d{4}-\d{2}-\d{2})\b/i);
      // strip operator tokens left in freeText
      freeText = freeText
        .replace(/\bfrom:\S+/gi, ' ')
        .replace(/\bto:\S+/gi, ' ')
        .replace(/\bsubject:("([^"]+)"|\S+)/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    }

    let where = ` WHERE 1=1`;
    const binds: any[] = [];
    if (dir === 'in' || dir === 'out') {
      where += ` AND direction = ?`;
      binds.push(dir);
    }
    if (
      statusFilter === 'unmatched' ||
      statusFilter === 'sent' ||
      statusFilter === 'received' ||
      statusFilter === 'delivered' ||
      statusFilter === 'bounced' ||
      statusFilter === 'spam' ||
      statusFilter === 'archived' ||
      statusFilter === 'read'
    ) {
      where += ` AND lower(ifnull(status,'')) = ?`;
      binds.push(statusFilter);
    } else if (statusFilter === 'all' || statusFilter === '*') {
      // Explicit: every folder including spam & archived
    } else if (!statusFilter) {
      // Default inbox: hide spam & archived unless explicitly filtered
      where += ` AND lower(ifnull(status,'')) NOT IN ('spam','archived')`;
    }
    if (fromOp) {
      where += ` AND ifnull(from_addr,'') LIKE ?`;
      binds.push(`%${fromOp}%`);
    }
    if (toOp) {
      where += ` AND ifnull(to_addr,'') LIKE ?`;
      binds.push(`%${toOp}%`);
    }
    if (subjectOp) {
      where += ` AND ifnull(subject,'') LIKE ?`;
      binds.push(`%${subjectOp}%`);
    }
    if (hasAttach) {
      where += ` AND ifnull(meta_json,'') LIKE '%"attachments"%' AND ifnull(meta_json,'') LIKE '%r2_key%'`;
    }
    if (isUnread) {
      where += ` AND direction = 'in' AND lower(ifnull(status,'')) NOT IN ('read','spam','archived')`;
    }
    if (afterOp) {
      where += ` AND date(replace(ifnull(created_at,''), 'T', ' ')) >= date(?)`;
      binds.push(afterOp);
    }
    if (beforeOp) {
      where += ` AND date(replace(ifnull(created_at,''), 'T', ' ')) <= date(?)`;
      binds.push(beforeOp);
    }
    if (freeText) {
      // Multi-word AND across subject/from/to/body
      const tokens = freeText.split(/\s+/).filter(Boolean).slice(0, 8);
      for (const tok of tokens) {
        where += ` AND (ifnull(subject,'') LIKE ? OR ifnull(from_addr,'') LIKE ? OR ifnull(to_addr,'') LIKE ? OR ifnull(body_text,'') LIKE ?)`;
        const like = `%${tok}%`;
        binds.push(like, like, like, like);
      }
    }

    const selectSql = `SELECT id, direction, mailbox, from_addr, to_addr, cc_addr, subject, status, resend_id, r2_key, thread_key, created_at,
      CASE WHEN body_text IS NOT NULL AND length(body_text) > 0 THEN substr(body_text, 1, 280)
           WHEN body_html IS NOT NULL THEN substr(replace(body_html, '<', ' <'), 1, 280)
           ELSE '' END as preview,
      CASE WHEN ifnull(meta_json,'') LIKE '%"attachments"%' AND ifnull(meta_json,'') LIKE '%r2_key%' THEN 1 ELSE 0 END as has_attachments
      FROM mail_messages${where}
      ORDER BY datetime(replace(ifnull(created_at,''), 'T', ' ')) DESC, id DESC
      LIMIT ? OFFSET ?`;

    try {
      const countRow = await c.env.DB.prepare(`SELECT COUNT(*) as c FROM mail_messages${where}`)
        .bind(...binds)
        .first() as any;
      const total = Number(countRow?.c || 0);
      const { results } = await c.env.DB.prepare(selectSql)
        .bind(...binds, limit, offset)
        .all();
      return c.json({
        success: true,
        data: results || [],
        meta: { total, limit, offset, page: Math.floor(offset / limit) + 1, dir: dir || 'all' },
      });
    } catch (e: any) {
      try {
        const { results } = await c.env.DB.prepare(
          `SELECT id, direction, mailbox, from_addr, to_addr, subject, status, created_at, '' as preview, 0 as has_attachments
           FROM mail_messages ORDER BY id DESC LIMIT ? OFFSET ?`,
        )
          .bind(limit, offset)
          .all();
        return c.json({
          success: true,
          data: results || [],
          meta: { total: (results || []).length, limit, offset, degraded: true },
        });
      } catch (e2: any) {
        return c.json({ success: false, error: e2?.message || e?.message || 'Erreur mailbox' }, 500);
      }
    }
  });

  app.get('/api/admin/mailbox/attachment', async (c) => {
    const gate = await verifyBackupAccess(c, { requireBackupToken: false });
    if (!gate.ok) return gate.response;
    if (!c.env.IMAGES) return c.json({ success: false, error: 'R2 indisponible' }, 503);
    let key = String(c.req.query('key') || '').trim();
    try { key = decodeURIComponent(key); } catch { /* already decoded */ }
    // Attachments are only ever written under mail/ — refuse anything else outright.
    if (!key.startsWith('mail/')) return c.json({ success: false, error: 'Clé invalide' }, 400);
    let obj = await c.env.IMAGES.get(key);
    // Fallback: if exact key missing, try listing the message folder (sanitized name drift)
    if (!obj) {
      const parts = key.split('/');
      // mail/{mailbox}/{msgId}/{i-name}
      if (parts.length >= 4) {
        const prefix = parts.slice(0, 3).join('/') + '/';
        const idxPrefix = parts[3].split('-')[0] + '-'; // "0-"
        try {
          const listed = await c.env.IMAGES.list({ prefix, limit: 50 });
          const match = (listed.objects || []).find((o) => o.key === key || o.key.startsWith(prefix + idxPrefix));
          if (match) obj = await c.env.IMAGES.get(match.key);
        } catch { /* */ }
      }
    }
    if (!obj) {
      return c.json({
        success: false,
        error: 'Pièce jointe introuvable dans le stockage (fichier absent ou non enregistré à la réception).',
        code: 'ATTACHMENT_MISSING',
        key,
      }, 404);
    }
    const filename = String(c.req.query('filename') || key.split('/').pop() || 'piece-jointe').replace(/[\r\n"]/g, '');
    const inline = c.req.query('inline') === '1' || c.req.query('inline') === 'true';
    const guessMime = (name: string, stored?: string) => {
      const s = (stored || '').toLowerCase();
      if (s && s !== 'application/octet-stream' && s !== 'application/octetstream') return stored as string;
      const n = name.toLowerCase();
      if (n.endsWith('.mp4') || n.endsWith('.m4v')) return 'video/mp4';
      if (n.endsWith('.webm')) return 'video/webm';
      if (n.endsWith('.mov')) return 'video/quicktime';
      if (n.endsWith('.mp3')) return 'audio/mpeg';
      if (n.endsWith('.wav')) return 'audio/wav';
      if (n.endsWith('.ogg')) return 'audio/ogg';
      if (n.endsWith('.pdf')) return 'application/pdf';
      if (n.endsWith('.png')) return 'image/png';
      if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
      if (n.endsWith('.gif')) return 'image/gif';
      if (n.endsWith('.webp')) return 'image/webp';
      if (n.endsWith('.svg')) return 'image/svg+xml';
      return stored || 'application/octet-stream';
    };
    const ct = guessMime(filename, obj.httpMetadata?.contentType);
    // RFC 5987 for non-ASCII filenames
    const asciiName = filename.replace(/[^\x20-\x7E]/g, '_') || 'file';
    const disp = `${inline ? 'inline' : 'attachment'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
    return new Response(obj.body, {
      headers: {
        'Content-Type': ct,
        'Content-Disposition': disp,
        'Cache-Control': 'private, max-age=60',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });

  app.post('/api/admin/mailbox/attachment-preview-url', async (c) => {
    const gate = await verifyBackupAccess(c, { requireBackupToken: false });
    if (!gate.ok) return gate.response;
    if (!c.env.IMAGES) return c.json({ success: false, error: 'R2 indisponible' }, 503);
    const body = await c.req.json().catch(() => ({}));
    const key = String(body.key || '');
    const filename = String(body.filename || key.split('/').pop() || 'file').replace(/[\r\n"]/g, '');
    if (!key.startsWith('mail/')) return c.json({ success: false, error: 'Clé invalide' }, 400);
    const obj = await c.env.IMAGES.head(key);
    if (!obj) return c.json({ success: false, error: 'Pièce jointe introuvable' }, 404);
    const storedCt = obj.httpMetadata?.contentType || 'application/octet-stream';
    const contentType = officeMimeFromName(filename, storedCt);
    const exp = Date.now() + 15 * 60 * 1000;
    const token = await signMailPreviewToken(c.env, { key, filename, contentType, exp });
    const origin = new URL(c.req.url).origin;
    const publicUrl = `${origin}/api/public/mail-preview?token=${encodeURIComponent(token)}`;
    // Google Docs Viewer — no API key. Google's servers must GET publicUrl (signed token).
    const googleUrl = `https://docs.google.com/gview?url=${encodeURIComponent(publicUrl)}&embedded=true`;
    const googleUrlAlt = `https://docs.google.com/viewer?url=${encodeURIComponent(publicUrl)}&embedded=true`;
    return c.json({
      success: true,
      data: {
        public_url: publicUrl,
        google_viewer_url: googleUrl,
        google_viewer_url_alt: googleUrlAlt,
        expires_in: 900,
        content_type: contentType,
      },
    });
  });

  app.options('/api/public/mail-preview', (c) =>
    new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Range',
        'Access-Control-Max-Age': '86400',
      },
    }),
  );

  app.on(['HEAD'], '/api/public/mail-preview', async (c) => {
    const token = String(c.req.query('token') || '').trim();
    if (!token || token.length < 16) return new Response(null, { status: 400 });
    const entry = await verifyMailPreviewToken(c.env, token);
    if (!entry) return new Response(null, { status: 410 });
    if (!c.env.IMAGES) return new Response(null, { status: 503 });
    const obj = await c.env.IMAGES.head(entry.key);
    if (!obj) return new Response(null, { status: 404 });
    const ct = officeMimeFromName(entry.filename, entry.contentType || obj.httpMetadata?.contentType || 'application/octet-stream');
    return new Response(null, {
      status: 200,
      headers: {
        'Content-Type': ct,
        'Content-Length': String(obj.size || 0),
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': 'private, max-age=120',
      },
    });
  });

  app.get('/api/public/mail-preview', async (c) => {
    const token = String(c.req.query('token') || '').trim();
    if (!token || token.length < 16) {
      return new Response('Invalid token', { status: 400, headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' } });
    }
    const entry = await verifyMailPreviewToken(c.env, token);
    if (!entry) {
      return new Response('Preview link expired', { status: 410, headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' } });
    }
    if (!c.env.IMAGES) return new Response('Storage unavailable', { status: 503, headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' } });
    const obj = await c.env.IMAGES.get(entry.key);
    if (!obj) return new Response('File not found', { status: 404, headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' } });
    const ct = officeMimeFromName(entry.filename, entry.contentType || obj.httpMetadata?.contentType || 'application/octet-stream');
    const asciiName = entry.filename.replace(/[^\x20-\x7E]/g, '_') || 'file';
    return new Response(obj.body, {
      headers: {
        'Content-Type': ct,
        'Content-Disposition': `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(entry.filename)}`,
        'Cache-Control': 'private, max-age=120',
        'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Type, Content-Length, Content-Disposition',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    });
  });

  app.get('/api/admin/mailbox/:id/signed-link', async (c) => {
    const gate = await verifyBackupAccess(c, { requireBackupToken: false });
    if (!gate.ok) return gate.response;
    const id = c.req.param('id');
    if (!/^\d+$/.test(id)) return c.json({ success: false, error: 'ID invalide' }, 400);
    const row = await c.env.DB.prepare(`SELECT id FROM mail_messages WHERE id = ?`).bind(id).first();
    if (!row) return c.json({ success: false, error: 'Message introuvable' }, 404);
    const exp = Math.floor(Date.now() / 1000) + 7 * 24 * 3600; // 7 days
    const sig = await signMailLink(c.env, id, exp);
    const origin = new URL(c.req.url).origin;
    const path = `/mailbox/m/${id}?e=${exp}&s=${sig}`;
    return c.json({ success: true, data: { url: origin + path, path, exp, sig } });
  });

  app.get('/api/admin/mailbox/:id/open-signed', async (c) => {
    const gate = await verifyBackupAccess(c, { requireBackupToken: false });
    if (!gate.ok) return gate.response;
    const id = c.req.param('id');
    const exp = Number(c.req.query('e') || 0);
    const sig = String(c.req.query('s') || '');
    if (!/^\d+$/.test(id)) return c.json({ success: false, error: 'ID invalide' }, 400);
    if (!(await verifyMailLink(c.env, id, exp, sig))) {
      return c.json({ success: false, error: 'Lien expiré ou signature invalide', code: 'BAD_MAIL_LINK' }, 403);
    }
    await ensureMailSchema(c.env.DB);
    const row = await c.env.DB.prepare(`SELECT * FROM mail_messages WHERE id = ?`).bind(id).first() as any;
    if (!row) return c.json({ success: false, error: 'Message introuvable' }, 404);
    if (row.r2_key && c.env.IMAGES) {
      try {
        const body = await loadMailBodyR2(c.env, String(row.r2_key));
        if (body?.html) row.body_html = body.html;
        if (body?.text) row.body_text = body.text;
      } catch { /* */ }
    }
    return c.json({ success: true, data: row, meta: { signed: true } });
  });

  /** AI draft / reply helper (uses same assist stack if available) */
  app.post('/api/admin/mailbox/ai-draft', async (c) => {
    const gate = await verifyBackupAccess(c, { requireBackupToken: false });
    if (!gate.ok) return gate.response;
    const body = await c.req.json().catch(() => ({}));
    const instruction = String(body.instruction || body.prompt || '').trim().slice(0, 4000);
    const mode = String(body.mode || 'compose'); // compose | reply
    const context = String(body.context || '').slice(0, 12000);
    const lang = String(body.lang || 'fr').slice(0, 8);
    if (!instruction) return c.json({ success: false, error: 'Instruction requise' }, 400);
    const system = mode === 'reply'
      ? `Tu rédiges une réponse e-mail professionnelle en ${lang}. Tiens compte du fil fourni. Réponds UNIQUEMENT avec le corps du message (pas de sujet sauf si demandé). Ton poli, clair, concis.`
      : `Tu rédiges un nouvel e-mail professionnel en ${lang} selon l'instruction. Réponds en JSON {"subject":"...","body":"..."} uniquement.`;
    // Prefer Mistral/Groq via existing env if present
    const apiKey = String((c.env as any).GROQ_API_KEY || '').trim();
    if (!apiKey) {
      // Deterministic fallback templates
      if (mode === 'reply') {
        return c.json({
          success: true,
          data: {
            body: `Bonjour,\n\nMerci pour votre message. ${instruction}\n\nCordialement,\nAF Marbre`,
            source: 'template',
          },
        });
      }
      return c.json({
        success: true,
        data: {
          subject: instruction.slice(0, 80),
          body: `Bonjour,\n\n${instruction}\n\nCordialement,\nAF Marbre`,
          source: 'template',
        },
      });
    }
    try {
      const isGroq = true;
      const url = 'https://api.groq.com/openai/v1/chat/completions';
      const model = String((c.env as any).GROQ_MODEL || 'openai/gpt-oss-20b');
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.4,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: (context ? `Fil / contexte:\n${context}\n\n` : '') + `Instruction:\n${instruction}` },
          ],
        }),
      });
      const j = await res.json().catch(() => ({})) as any;
      const raw = String(j?.choices?.[0]?.message?.content || '').trim();
      if (!res.ok || !raw) return c.json({ success: false, error: j?.error?.message || 'IA indisponible' }, 502);
      if (mode === 'reply') return c.json({ success: true, data: { body: raw, source: 'groq' } });
      try {
        const m = raw.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(m ? m[0] : raw);
        return c.json({ success: true, data: { subject: String(parsed.subject || ''), body: String(parsed.body || raw), source: 'groq' } });
      } catch {
        return c.json({ success: true, data: { subject: instruction.slice(0, 80), body: raw, source: 'groq' } });
      }
    } catch (e: any) {
      return c.json({ success: false, error: e?.message || 'IA erreur' }, 500);
    }
  });

  /** Lightweight translate (LibreTranslate public or AI fallback) */
  /** Split long text into chunks that free translate endpoints accept. */
  function chunkTextForTranslate(text: string, maxLen = 1500): string[] {
    const t = String(text || '');
    if (t.length <= maxLen) return [t];
    const parts: string[] = [];
    let i = 0;
    while (i < t.length) {
      let end = Math.min(i + maxLen, t.length);
      if (end < t.length) {
        const slice = t.slice(i, end);
        const br = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('. '), slice.lastIndexOf(' '));
        if (br > maxLen * 0.4) end = i + br + 1;
      }
      parts.push(t.slice(i, end));
      i = end;
    }
    return parts;
  }

  /** Official Google Cloud Translation API v2 (needs GOOGLE_TRANSLATE_API_KEY). */
  async function translateGoogleCloud(text: string, target: string, source: string, apiKey: string): Promise<string | null> {
    try {
      const chunks = chunkTextForTranslate(text, 4000);
      const out: string[] = [];
      for (const chunk of chunks) {
        const body: Record<string, unknown> = {
          q: chunk,
          target,
          format: 'text',
        };
        if (source && source !== 'auto') body.source = source;
        const r = await fetch(`https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const err = await r.text().catch(() => '');
          console.log('google cloud translate fail', r.status, err.slice(0, 200));
          return null;
        }
        const j = await r.json().catch(() => ({})) as any;
        const translated = String(j?.data?.translations?.[0]?.translatedText || '').trim();
        if (!translated) return null;
        out.push(translated);
      }
      return out.join('').trim() || null;
    } catch {
      return null;
    }
  }

  /** Google Translate (unofficial gtx client) — no API key. */
  async function translateGoogleGtx(text: string, target: string, source: string): Promise<string | null> {
    const chunks = chunkTextForTranslate(text, 1500);
    const out: string[] = [];
    for (const chunk of chunks) {
      const params = new URLSearchParams({
        client: 'gtx',
        sl: source === 'auto' ? 'auto' : source,
        tl: target,
        dt: 't',
        q: chunk,
      });
      const r = await fetch(`https://translate.googleapis.com/translate_a/single?${params.toString()}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 AtlasCommerce/1.0', Accept: 'application/json' },
      });
      if (!r.ok) return null;
      const j = await r.json().catch(() => null) as any;
      // Response shape: [[["translated","original",...],...], ...]
      const segs = Array.isArray(j?.[0]) ? j[0] : [];
      const piece = segs.map((s: any) => (Array.isArray(s) ? String(s[0] || '') : '')).join('');
      if (!piece.trim()) return null;
      out.push(piece);
    }
    return out.join('').trim() || null;
  }

  async function translateLibre(text: string, target: string, source: string): Promise<string | null> {
    try {
      const r = await fetch('https://libretranslate.com/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          q: text.slice(0, 5000),
          source: source === 'auto' ? 'auto' : source,
          target,
          format: 'text',
        }),
      });
      if (!r.ok) return null;
      const j = await r.json().catch(() => ({})) as any;
      const translated = String(j?.translatedText || '').trim();
      return translated || null;
    } catch {
      return null;
    }
  }

  async function translateLingva(text: string, target: string): Promise<string | null> {
    try {
      // Lingva is a Google Translate proxy; several public instances
      const hosts = ['https://lingva.ml', 'https://lingva.thedaviddelta.com'];
      const q = encodeURIComponent(text.slice(0, 4000));
      for (const host of hosts) {
        try {
          const r = await fetch(`${host}/api/v1/auto/${encodeURIComponent(target)}/${q}`, {
            headers: { Accept: 'application/json' },
          });
          if (!r.ok) continue;
          const j = await r.json().catch(() => ({})) as any;
          const translated = String(j?.translation || '').trim();
          if (translated) return translated;
        } catch { /* try next host */ }
      }
      return null;
    } catch {
      return null;
    }
  }

  async function translateMyMemory(text: string, target: string, source: string): Promise<string | null> {
    try {
      const langpair = `${source === 'auto' ? 'en' : source}|${target}`;
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 450))}&langpair=${encodeURIComponent(langpair)}`;
      const r = await fetch(url);
      const j = await r.json().catch(() => ({})) as any;
      const translated = String(j?.responseData?.translatedText || '').trim();
      // MyMemory returns quota warnings as the "translation"
      if (!translated || /MYMEMORY WARNING|YOU USED ALL AVAILABLE/i.test(translated)) return null;
      return translated;
    } catch {
      return null;
    }
  }

  app.post('/api/admin/mailbox/translate', async (c) => {
    const gate = await verifyBackupAccess(c, { requireBackupToken: false });
    if (!gate.ok) return gate.response;
    const body = await c.req.json().catch(() => ({}));
    const textIn = String(body.text || '').slice(0, 12000);
    const target = String(body.target || 'fr').slice(0, 8).toLowerCase();
    if (!textIn.trim()) {
      return c.json({ success: false, error: 'Texte vide', code: 'EMPTY' }, 400);
    }

    const groqKey = String((c.env as any).GROQ_API_KEY || '').trim();
    if (!groqKey) {
      return c.json({
        success: false,
        error: 'Traduction IA non configurée. Exécutez: npx wrangler secret put GROQ_API_KEY',
        code: 'NO_AI_KEY',
      }, 503);
    }

    const model = String((c.env as any).GROQ_MODEL || 'openai/gpt-oss-20b').slice(0, 80);
    const system =
      `Tu es un traducteur professionnel. Traduis le texte vers « ${target} ». ` +
      `Réponds UNIQUEMENT avec la traduction. Pas de préambule, pas de guillemets, pas de notes.`;

    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${groqKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          max_tokens: 4096,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: textIn },
          ],
        }),
      });
      const j = await res.json().catch(() => ({})) as any;
      const raw = String(j?.choices?.[0]?.message?.content || '').trim();
      if (res.ok && raw) {
        return c.json({ success: true, data: { text: raw, engine: 'groq', model } });
      }
      // Fallback models if preferred id is gone
      for (const fb of ['openai/gpt-oss-20b', 'llama-3.3-70b-versatile']) {
        if (fb === model) continue;
        const r2 = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: fb,
            temperature: 0.1,
            max_tokens: 4096,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: textIn },
            ],
          }),
        });
        const j2 = await r2.json().catch(() => ({})) as any;
        const raw2 = String(j2?.choices?.[0]?.message?.content || '').trim();
        if (r2.ok && raw2) {
          return c.json({ success: true, data: { text: raw2, engine: 'groq', model: fb } });
        }
      }
      return c.json({
        success: false,
        error: j?.error?.message || 'Traduction IA échouée (Groq).',
        code: 'TRANSLATE_AI_FAIL',
      }, 502);
    } catch (e: any) {
      return c.json({
        success: false,
        error: e?.message || 'Erreur traduction IA',
        code: 'TRANSLATE_ERROR',
      }, 500);
    }
  });

  /** AI résumé d'un e-mail (style Gmail « Résumer cet e-mail ») */
  app.post('/api/admin/mailbox/summarize', async (c) => {
    const gate = await verifyBackupAccess(c, { requireBackupToken: false });
    if (!gate.ok) return gate.response;
    const body = await c.req.json().catch(() => ({}));
    const textIn = String(body.text || body.body || '').slice(0, 16000);
    const subject = String(body.subject || '').slice(0, 300);
    const lang = String(body.lang || 'fr').slice(0, 8);
    if (!textIn.trim()) return c.json({ success: false, error: 'Message vide', code: 'EMPTY' }, 400);

    const apiKey = String((c.env as any).GROQ_API_KEY || '').trim();
    if (!apiKey) {
      // Lightweight extractive fallback (no LLM key)
      const lines = textIn.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      const pick = lines.slice(0, 4).join(' ');
      const summary = (subject ? subject + ' — ' : '') + pick.slice(0, 400);
      return c.json({ success: true, data: { summary, engine: 'extractive' } });
    }
    try {
      const isGroq = true;
      const url = 'https://api.groq.com/openai/v1/chat/completions';
      const model = String((c.env as any).GROQ_MODEL || 'openai/gpt-oss-20b');
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content:
                `Tu résumes des e-mails en ${lang}. Produis 3 à 6 puces claires (• ) : objet, points clés, actions demandées, délais. Pas d'introduction ni de conclusion. Reste fidèle au message.`,
            },
            {
              role: 'user',
              content: (subject ? `Sujet: ${subject}\n\n` : '') + textIn,
            },
          ],
        }),
      });
      const j = await res.json().catch(() => ({})) as any;
      const raw = String(j?.choices?.[0]?.message?.content || '').trim();
      if (res.ok && raw) {
        return c.json({ success: true, data: { summary: raw, engine: isGroq ? 'groq' : 'mistral' } });
      }
    } catch { /* fall through to extractive */ }
    const lines = textIn.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const pick = lines.slice(0, 5).join(' ');
    const summary = ((subject ? '• Sujet : ' + subject + '\n' : '') + '• ' + pick).slice(0, 800);
    return c.json({ success: true, data: { summary, engine: 'extractive' } });
  });

  app.patch('/api/admin/mailbox/:id/status', async (c) => {
    const gate = await verifyBackupAccess(c, { requireBackupToken: false });
    if (!gate.ok) return gate.response;
    await ensureMailSchema(c.env.DB);
    const id = c.req.param('id');
    if (!/^\d+$/.test(String(id))) return c.json({ success: false, error: 'ID invalide' }, 400);
    const body = await c.req.json().catch(() => ({}));
    const status = String(body.status || '').trim().toLowerCase();
    const allowed = new Set(['received', 'sent', 'read', 'unread', 'spam', 'archived']);
    if (!allowed.has(status)) return c.json({ success: false, error: 'Statut invalide' }, 400);
    await c.env.DB.prepare(`UPDATE mail_messages SET status = ? WHERE id = ?`).bind(status, id).run();
    return c.json({ success: true, data: { id: Number(id), status } });
  });


  app.post('/api/admin/mailbox/sync-resend', async (c) => {
    const gate = await verifyBackupAccess(c, { requireBackupToken: false });
    if (!gate.ok) return gate.response;
    const apiKey = String((c.env as any).RESEND_API_KEY || '').trim();
    if (!apiKey) {
      return c.json({
        success: false,
        error: 'Service e-mail non configuré (clé API manquante).',
        code: 'EMAIL_NOT_CONFIGURED',
      }, 503);
    }
    const body = await c.req.json().catch(() => ({}));
    const limit = Math.min(200, Math.max(10, Number(body.limit || 100)));
    try {
      const result = await syncResendHistory(c.env, { limit });
      return c.json({
        success: true,
        data: result,
        message: `Synchronisation terminée : ${result.imported} importé(s), ${result.skipped} déjà présent(s).`,
      });
    } catch (e: any) {
      return c.json({
        success: false,
        error: e?.message || 'Échec de la synchronisation',
      }, 502);
    }
  });

  app.get('/api/admin/mailbox/:id', async (c) => {
    const gate = await verifyBackupAccess(c, { requireBackupToken: false });
    if (!gate.ok) return gate.response;
    await ensureMailSchema(c.env.DB);
    const id = c.req.param('id');
    if (id === 'sync-resend') return c.json({ success: false, error: 'Use POST' }, 405);
    if (id === 'attachment' || id === 'attachment-preview-url' || id === 'send') {
      return c.json({ success: false, error: 'Route réservée' }, 404);
    }
    if (!/^\d+$/.test(String(id))) {
      return c.json({ success: false, error: 'Message introuvable' }, 404);
    }
    const row = await c.env.DB.prepare(`SELECT * FROM mail_messages WHERE id = ?`).bind(id).first() as any;
    if (!row) return c.json({ success: false, error: 'Message introuvable' }, 404);
    // Prefer encrypted R2 body; D1 body columns are legacy / empty
    if (row.r2_key && c.env.IMAGES) {
      try {
        const body = await loadMailBodyR2(c.env, String(row.r2_key));
        if (body?.html != null) row.body_html = body.html;
        if (body?.text != null) row.body_text = body.text;
      } catch { /* */ }
    } else if (row.body_html || row.body_text) {
      // Migrate-on-read: move legacy D1 body to R2
      try {
        const key = await persistMailBodyR2Only(c.env, row.id, String(row.body_html || ''), String(row.body_text || ''));
        if (key) row.r2_key = key;
      } catch { /* */ }
    }
    return c.json({ success: true, data: row });
  });

  app.post('/api/admin/mailbox/send', async (c) => {
    const gate = await verifyBackupAccess(c, { requireBackupToken: false });
    if (!gate.ok) return gate.response;
    await ensureMailSchema(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const to = String(body.to || '').trim();
    const subject = String(body.subject || '').trim().slice(0, 500);
    const text = String(body.text || body.body || '').trim();
    const html = String(body.html || '').trim() || `<pre style="font-family:system-ui,sans-serif;white-space:pre-wrap">${text.replace(/</g, '&lt;')}</pre>`;
    const replyToId = body.reply_to_id != null ? Number(body.reply_to_id) : null;
    // Optional attachments: [{ filename, mimeType?, content_base64 }] — max 5, ~1.5MB each decoded
    const rawAtts = Array.isArray(body.attachments) ? body.attachments.slice(0, 5) : [];
    if (!to.includes('@') || !subject) {
      return c.json({ success: false, error: 'Destinataire et sujet requis' }, 400);
    }
    const apiKey = c.env.RESEND_API_KEY;
    if (!apiKey) {
      return c.json({ success: false, error: 'RESEND_API_KEY manquant', code: 'EMAIL_NOT_CONFIGURED' }, 503);
    }
    const from = c.env.RESEND_FROM || ADMIN_MAILBOX;
    let threadKey = '';
    if (replyToId) {
      const prev = await c.env.DB.prepare(`SELECT thread_key, from_addr, subject FROM mail_messages WHERE id = ?`).bind(replyToId).first() as any;
      if (prev) threadKey = prev.thread_key || `thread-${replyToId}`;
    }

    type OutAtt = { filename: string; mimeType: string; size: number; contentBase64: string };
    const outAtts: OutAtt[] = [];
    for (const a of rawAtts) {
      const filename = String(a?.filename || 'fichier').replace(/[^a-zA-Z0-9._\- \u00C0-\u024F]/g, '_').slice(0, 180) || 'fichier';
      const mimeType = String(a?.mimeType || a?.content_type || 'application/octet-stream').slice(0, 120);
      let b64 = String(a?.content_base64 || a?.content || '').replace(/^data:[^;]+;base64,/, '').trim();
      if (!b64) continue;
      // rough size check (~1.5 MiB decoded)
      if (b64.length > 35_000_000) {
        return c.json({ success: false, error: `Pièce jointe trop volumineuse: ${filename} (max ~25 Mo décodés)` }, 413);
      }
      outAtts.push({ filename, mimeType, size: Math.floor(b64.length * 0.75), contentBase64: b64 });
    }

    const resendPayload: any = {
      from,
      to: [to],
      subject,
      html,
      text: text || undefined,
      reply_to: ADMIN_MAILBOX,
    };
    if (outAtts.length) {
      resendPayload.attachments = outAtts.map((a) => ({
        filename: a.filename,
        content: a.contentBase64,
        content_type: a.mimeType,
      }));
    }

    const resendUrl = assertSafeOutboundUrl('https://api.resend.com/emails');
    const res = await fetch(resendUrl.toString(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(resendPayload),
    });
    const data = await res.json().catch(() => ({})) as any;
    if (!res.ok) {
      return c.json({ success: false, error: data.message || 'Échec Resend', details: data }, 502);
    }

    const ins = await c.env.DB.prepare(
      `INSERT INTO mail_messages (direction, mailbox, from_addr, to_addr, subject, body_text, body_html, resend_id, thread_key, status, meta_json)
       VALUES ('out', ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?)`
    ).bind(
      ADMIN_MAILBOX, from, to, subject, '', '',  // body only on encrypted R2
      String(data.id || ''), threadKey || '', JSON.stringify({ reply_to_id: replyToId, attachments: [] }),
    ).run();
    const newId = String(ins.meta?.last_row_id || '');
    if (newId) {
      await persistMailBodyR2Only(c.env, newId, html, text);
    }

    // Persist outbound attachments to R2 so they appear in the mailbox like inbound ones
    const stored: { filename: string; mimeType: string; size: number; r2_key: string }[] = [];
    if (newId && c.env.IMAGES && outAtts.length) {
      for (let i = 0; i < outAtts.length; i++) {
        const a = outAtts[i];
        try {
          const bin = Uint8Array.from(atob(a.contentBase64), (c) => c.charCodeAt(0));
          const safeName = a.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
          const key = `mail/${ADMIN_MAILBOX}/${newId}/${i}-${safeName}`;
          await c.env.IMAGES.put(key, bin, {
            httpMetadata: { contentType: a.mimeType || 'application/octet-stream' },
          });
          stored.push({ filename: a.filename, mimeType: a.mimeType, size: bin.byteLength, r2_key: key });
        } catch (e) {
          console.error('out_attachment_store_err', String((e as any)?.message || e));
        }
      }
      if (stored.length) {
        try {
          await c.env.DB.prepare(`UPDATE mail_messages SET meta_json = ? WHERE id = ?`)
            .bind(JSON.stringify({ reply_to_id: replyToId, source: 'outbound', attachments: stored }), newId)
            .run();
        } catch { /* */ }
      }
    }

    return c.json({ success: true, data: { id: newId, resend_id: data.id, to, attachments: stored.length } });
  });



  /* ── Atlas Agent conversations — encrypted R2 only (no message text in D1) ── */
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


  app.delete('/api/admin/mailbox/:id', async (c) => {
    const gate = await verifyBackupAccess(c, { requireBackupToken: false });
    if (!gate.ok) return gate.response;
    await ensureMailSchema(c.env.DB);
    const id = c.req.param('id');
    const row = await c.env.DB.prepare(`SELECT r2_key FROM mail_messages WHERE id = ?`).bind(id).first() as any;
    if (row?.r2_key && c.env.IMAGES) {
      try { await c.env.IMAGES.delete(row.r2_key); } catch { /* */ }
    }
    await c.env.DB.prepare(`DELETE FROM mail_messages WHERE id = ?`).bind(id).run();
    return c.json({ success: true });
  });
}
