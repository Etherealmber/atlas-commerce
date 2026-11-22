import type { Env } from '../env';
import { schemaOnce, addColumnIfMissing } from './schema';
import { ensureMovementApprover } from './inventory-actors';
import { notifyLowStock as fcmNotifyLowStock } from './fcm';
import {
  applyBulkDiscount as coreApplyBulkDiscount,
  computeMovingAverageCost,
  parseBulkDiscounts as coreParseBulkDiscounts,
  roundTo,
  subMoneyAmounts,
  validateCreditPrefixCore,
  validateNextCreditNumberCore,
} from './financeCore';
import {
  ensureStockLocations,
  getDefaultLocationId,
  adjustLocationStock,
} from '../routes';

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function ensurePaymentHistoryTable(db: D1Database) {
  await schemaOnce('ensurePaymentHistoryTable', async () => {
  await db.prepare(`CREATE TABLE IF NOT EXISTS invoice_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    invoice_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    payment_method TEXT DEFAULT 'cash',
    payee TEXT DEFAULT 'company',
    note TEXT DEFAULT '',
    paid_at TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();

  });
}

export async function ensureReceiptsTable(db: D1Database) {
  await schemaOnce('ensureReceiptsTable', async () => {
  await db.prepare(`CREATE TABLE IF NOT EXISTS receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL UNIQUE,
    invoice_id INTEGER,
    client_name TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    payment_method TEXT DEFAULT 'cash',
    issue_date TEXT,
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();

  });
}

/** Find ledger expenses linked to an invoice (via notes invoice_id:N) */
export async function expensesLinkedToInvoice(db: D1Database, invoiceId: string | number) {
  const { results } = await db.prepare(
    `SELECT * FROM expenses WHERE notes LIKE ? OR reference = (SELECT number FROM invoices WHERE id = ?) ORDER BY id`
  ).bind(`%invoice_id:${invoiceId}%`, invoiceId).all();
  return results || [];
}

export async function expensesLinkedToReceipt(db: D1Database, receipt: any) {
  if (!receipt) return [];
  const invId = receipt.invoice_id;
  if (invId) return expensesLinkedToInvoice(db, invId);
  // Manual receipt: match by reference = receipt number or description
  const { results } = await db.prepare(
    `SELECT * FROM expenses WHERE reference = ? OR notes LIKE ? ORDER BY id`
  ).bind(receipt.number || '', `%receipt:${receipt.id}%`).all();
  return results || [];
}

export async function getInvoiceLinks(db: D1Database, invoiceId: string | number) {
  await ensureReceiptsTable(db);
  await ensurePaymentHistoryTable(db);
  const invoice = await db.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(invoiceId).first() as any;
  if (!invoice) return null;
  const { results: payments } = await db.prepare(
    `SELECT * FROM invoice_payments WHERE invoice_id = ? ORDER BY id`
  ).bind(invoiceId).all();
  const { results: receipts } = await db.prepare(
    `SELECT * FROM receipts WHERE invoice_id = ? ORDER BY id`
  ).bind(invoiceId).all();
  const expenses = await expensesLinkedToInvoice(db, invoiceId);
  return {
    invoice,
    payments: payments || [],
    receipts: receipts || [],
    expenses,
  };
}

export async function cascadeDeleteInvoice(db: D1Database, invoiceId: string | number) {
  await ensureInvoiceRefundColumns(db);
  const links = await getInvoiceLinks(db, invoiceId);
  if (!links) return null;
  const inv = links.invoice;
  const wasQuote = inv.status === 'quote' || inv.status === 'devis';
  const isRefund = inv.status === 'remboursement' || inv.doc_kind === 'remboursement';
  const { results: items } = await db.prepare(
    `SELECT product_id, quantity FROM invoice_items WHERE invoice_id = ?`
  ).bind(invoiceId).all();

  if (isRefund) {
    // 1) Stock: reverse only lines that were restocked on WR create (sku restock:0 = no return)
    for (const it of (items || []) as any[]) {
      if (!it.product_id) continue;
      const sku = String(it.sku || '');
      const noRestock = /restock:0\b/.test(sku);
      if (noRestock) continue;
      await applyStockDelta(
        db,
        it.product_id,
        -Number(it.quantity || 0),
        'WR deleted (annuler retour stock)',
        inv.number,
        { type: 'sale' },
      );
    }

    const sourceId = inv.refund_of_invoice_id;
    const wrTotal = Number(inv.total || 0);

    // 2) Balance: remove cash-outflow expenses created for this WR (money returns to caisse/banque)
    let cashRefundAmount = 0;
    try {
      const { results: wrExp } = await db.prepare(
        `SELECT id, amount FROM expenses WHERE notes LIKE ? OR reference = ?`
      ).bind(`%credit_id:${invoiceId}%`, inv.number || '').all();
      for (const e of (wrExp || []) as any[]) {
        cashRefundAmount += Number(e.amount || 0);
        await db.prepare(`DELETE FROM expenses WHERE id = ?`).bind(e.id).run();
      }
    } catch { /* */ }

    // 3) Source invoice still exists → undo credit applied to amount_paid (unpaid portion only)
    //    cash portion never changed amount_paid on create; only creditVsDebt did.
    if (sourceId && wrTotal > 0.001) {
      const source = await db.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(sourceId).first() as any;
      if (source) {
        const creditVsDebt = Math.max(0, subMoneyAmounts(wrTotal, cashRefundAmount, 2));
        const paid = Number(source.amount_paid || 0);
        const srcTotal = Number(source.total || 0);
        const nextPaid = Math.max(0, Math.min(srcTotal, paid - creditVsDebt));
        let newStatus = source.status;
        if (source.status === 'cancelled') {
          newStatus = 'cancelled';
        } else if (nextPaid <= 0.001) {
          newStatus = 'sent';
        } else if (nextPaid + 0.001 >= srcTotal) {
          newStatus = 'paid';
        } else {
          newStatus = 'partial';
        }
        await db.prepare(
          `UPDATE invoices SET amount_paid = ?, status = ?, updated_at = datetime('now') WHERE id = ?`
        ).bind(nextPaid, newStatus, sourceId).run();
        try {
          await db.prepare(
            `DELETE FROM invoice_payments WHERE invoice_id = ? AND (note LIKE ? OR note LIKE ?)`
          ).bind(sourceId, `%${inv.number}%`, `%Avoir ${inv.number}%`).run();
        } catch { /* */ }
      }
      // source already deleted → nothing to restore on AR; expenses already removed above
    }
  } else if (!wasQuote && inv.status !== 'cancelled') {
    // Normal sale invoice: deleting restores stock
    for (const it of (items || []) as any[]) {
      if (it.product_id) {
        await applyStockDelta(db, it.product_id, Number(it.quantity || 0), 'Ticket / facture supprimé (retour stock)', inv.number);
      }
    }
  }
  // expenses linked to invoice
  for (const e of links.expenses) {
    await db.prepare(`DELETE FROM expenses WHERE id = ?`).bind(e.id).run();
  }
  for (const r of links.receipts) {
    await db.prepare(`DELETE FROM receipts WHERE id = ?`).bind(r.id).run();
  }
  await db.prepare(`DELETE FROM invoice_payments WHERE invoice_id = ?`).bind(invoiceId).run();
  await db.prepare(`DELETE FROM invoice_items WHERE invoice_id = ?`).bind(invoiceId).run();
  await db.prepare(`DELETE FROM invoices WHERE id = ?`).bind(invoiceId).run();
  return links;
}





export async function publicRateLimit(env: any, key: string, limit = 30, windowTtl = 60): Promise<boolean> {
  try {
    if (!env.CACHE) return false;
    const k = `pub_rl:${key}`;
    const n = Number((await env.CACHE.get(k)) || 0);
    if (n >= limit) return true;
    await env.CACHE.put(k, String(n + 1), { expirationTtl: windowTtl });
    return false;
  } catch { return false; }
}

export async function ensureReceiptSituationColumn(db: D1Database) {
  await schemaOnce('ensureReceiptSituationColumn', async () => {
  await addColumnIfMissing(db, 'receipts', 'include_client_situation', `INTEGER DEFAULT 0`);

  });
}

export async function ensureQrPrivacySettings(db: D1Database) {
  await schemaOnce('ensureQrPrivacySettings', async () => {
  await addColumnIfMissing(db, 'company_settings', 'qr_client_situation', `INTEGER DEFAULT 0`);
  await addColumnIfMissing(db, 'company_settings', 'qr_situation_ttl_days', `INTEGER DEFAULT 90`);
  await addColumnIfMissing(db, 'company_settings', 'client_data_retention_days', `INTEGER DEFAULT 1825`);

  });
}

export async function ensureInvoicePublicToken(db: D1Database) {
  await schemaOnce('ensureInvoicePublicToken', async () => {
  await addColumnIfMissing(db, 'invoices', 'public_token', `TEXT`);
  await addColumnIfMissing(db, 'invoices', 'client_signature', `TEXT`);
  await addColumnIfMissing(db, 'invoices', 'signed_at', `TEXT`);
  await addColumnIfMissing(db, 'invoices', 'signature_digest', `TEXT`);
  await addColumnIfMissing(db, 'invoices', 'signed_doc_hash', `TEXT`);
  await addColumnIfMissing(db, 'invoices', 'timestamp_token', `TEXT`);
  await addColumnIfMissing(db, 'invoices', 'timestamp_at', `TEXT`);

  });
}

export function makePublicToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

/**
 * HMAC secrets — automated rotation (DB) + optional env bootstrap.
 *
 * Storage (company_settings):
 *   hmac_secret_current, hmac_secret_previous, hmac_rotated_at, hmac_rotate_days
 *
 * Auto-rotate every hmac_rotate_days (default 90) on first print/verify after expiry.
 * Manual: POST /api/admin/rotate-hmac-keys (owner only).
 *
 * Env bootstrap (optional): PUBLIC_TOKEN_SECRET / PUBLIC_TOKEN_SECRET_PREVIOUS
 * used only until DB secrets exist.
 */
export function envBootstrapSecrets(env: Env): { current: string; previous: string | null } {
  const current = String(
    (env as any).PUBLIC_TOKEN_SECRET || (env as any).JWT_SECRET || '',
  ).trim();
  const prevRaw = (env as any).PUBLIC_TOKEN_SECRET_PREVIOUS;
  const previous = prevRaw != null && String(prevRaw).trim() !== '' ? String(prevRaw) : null;
  return { current, previous };
}

export function randomHmacSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function ensureHmacKeyColumns(db: D1Database) {
  await schemaOnce('hmac_key_cols', async () => {
    await addColumnIfMissing(db, 'company_settings', 'hmac_secret_current', 'TEXT');
    await addColumnIfMissing(db, 'company_settings', 'hmac_secret_previous', 'TEXT');
    await addColumnIfMissing(db, 'company_settings', 'hmac_rotated_at', 'TEXT');
    await addColumnIfMissing(db, 'company_settings', 'hmac_rotate_days', 'INTEGER DEFAULT 90');
  });
}

/** Resolve secrets; auto-rotate if stale. Always returns at least current. */
export async function publicTokenSecretsAsync(
  env: Env,
  db?: D1Database,
  opts?: { forceRotate?: boolean },
): Promise<{ current: string; previous: string | null; rotated: boolean; rotatedAt: string | null }> {
  const boot = envBootstrapSecrets(env);
  if (!db) {
    return { current: boot.current, previous: boot.previous, rotated: false, rotatedAt: null };
  }
  await ensureHmacKeyColumns(db);
  let row = await db.prepare(
    `SELECT hmac_secret_current, hmac_secret_previous, hmac_rotated_at, hmac_rotate_days FROM company_settings WHERE id = 1`,
  ).first() as any;

  // Bootstrap DB from env if empty — never use a hardcoded fallback secret
  if (!row?.hmac_secret_current) {
    const now = new Date().toISOString();
    const seed = boot.current || randomHmacSecret();
    try {
      await db.prepare(
        `UPDATE company_settings SET hmac_secret_current = ?, hmac_secret_previous = ?, hmac_rotated_at = ?, hmac_rotate_days = COALESCE(hmac_rotate_days, 90) WHERE id = 1`,
      ).bind(seed, boot.previous, now).run();
    } catch {
      /* ignore */
    }
    row = {
      hmac_secret_current: seed,
      hmac_secret_previous: boot.previous,
      hmac_rotated_at: now,
      hmac_rotate_days: 90,
    };
  }

  const days = Math.max(7, Number(row.hmac_rotate_days || 90));
  const rotatedAt = row.hmac_rotated_at ? new Date(row.hmac_rotated_at).getTime() : 0;
  const ageMs = Date.now() - rotatedAt;
  const stale = !rotatedAt || ageMs > days * 24 * 60 * 60 * 1000;
  let rotated = false;
  let current = String(row.hmac_secret_current || boot.current);
  let previous = row.hmac_secret_previous ? String(row.hmac_secret_previous) : boot.previous;
  let newRotatedAt = row.hmac_rotated_at || null;

  if (opts?.forceRotate || stale) {
    const next = randomHmacSecret();
    previous = current;
    current = next;
    newRotatedAt = new Date().toISOString();
    try {
      await db.prepare(
        `UPDATE company_settings SET hmac_secret_current = ?, hmac_secret_previous = ?, hmac_rotated_at = ? WHERE id = 1`,
      ).bind(current, previous, newRotatedAt).run();
      rotated = true;
    } catch (e) {
      console.error('hmac auto-rotate failed', e);
      // keep old keys
      current = String(row.hmac_secret_current || boot.current);
      previous = row.hmac_secret_previous ? String(row.hmac_secret_previous) : boot.previous;
      rotated = false;
    }
  }

  return { current, previous, rotated, rotatedAt: newRotatedAt };
}

/** Sync helper for call sites that still expect sync shape — prefer publicTokenSecretsAsync. */
export function publicTokenSecrets(env: Env): { current: string; previous: string | null } {
  return envBootstrapSecrets(env);
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function b64urlEncode(str: string): string {
  return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str: string): string {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return decodeURIComponent(escape(atob(s)));
}

/**
 * Secure QR payload:
 * - v2.<type>.<token>.<exp>.<kid>.<hmac16>  (kid 1 = current, 0 = previous)
 * - v1.<type>.<token>.<exp>.<hmac16>        (legacy, verified against current then previous)
 */
export async function makeSecureQrPayload(
  env: Env,
  type: 'invoice' | 'receipt',
  dbToken: string,
  ttlSeconds = 0,
  db?: D1Database,
): Promise<string> {
  const exp = ttlSeconds > 0 ? Math.floor(Date.now() / 1000) + ttlSeconds : 0;
  const kid = 1; // always sign with current key
  const secrets = await publicTokenSecretsAsync(env, db);
  const msg = `v2|${type}|${dbToken}|${exp}|${kid}`;
  const mac = await hmacSha256Hex(secrets.current, msg);
  return `v2.${type}.${dbToken}.${exp}.${kid}.${mac.slice(0, 16)}`;
}

type SecureQrParse =
  | { ok: true; type: 'invoice' | 'receipt'; token: string; exp: number; kid?: number }
  | { ok: false; reason: string };

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function parseSecureQrPayload(env: Env, raw: string, db?: D1Database): Promise<SecureQrParse> {
  const s = String(raw || '').trim();
  if (!s) return { ok: false, reason: 'empty' };
  const secrets = await publicTokenSecretsAsync(env, db);
  const secretsToTry = [secrets.current, secrets.previous].filter(Boolean) as string[];

  // v2 with key id
  if (s.startsWith('v2.')) {
    const parts = s.split('.');
    if (parts.length !== 6) return { ok: false, reason: 'bad_format' };
    const [, type, token, expStr, kidStr, mac] = parts;
    if (type !== 'invoice' && type !== 'receipt') return { ok: false, reason: 'bad_type' };
    if (!/^[a-z0-9]{16,48}$/i.test(token)) return { ok: false, reason: 'bad_token' };
    const exp = Number(expStr);
    const kid = Number(kidStr);
    if (!Number.isFinite(exp) || exp < 0) return { ok: false, reason: 'bad_exp' };
    if (exp > 0 && Math.floor(Date.now() / 1000) > exp) return { ok: false, reason: 'expired' };
    if (kid !== 0 && kid !== 1) return { ok: false, reason: 'bad_kid' };
    const msg = `v2|${type}|${token}|${exp}|${kid}`;
    // Prefer matching kid: 1 → current, 0 → previous; still try all secrets
    const ordered =
      kid === 1
        ? secretsToTry
        : secrets.previous
          ? [secrets.previous, secrets.current]
          : secretsToTry;
    for (const sec of ordered) {
      const expected = (await hmacSha256Hex(sec, msg)).slice(0, 16);
      if (timingSafeEqual(expected, mac)) {
        return { ok: true, type, token, exp, kid };
      }
    }
    return { ok: false, reason: 'bad_mac' };
  }

  // v1 legacy
  if (s.startsWith('v1.')) {
    const parts = s.split('.');
    if (parts.length !== 5) return { ok: false, reason: 'bad_format' };
    const [, type, token, expStr, mac] = parts;
    if (type !== 'invoice' && type !== 'receipt') return { ok: false, reason: 'bad_type' };
    if (!/^[a-z0-9]{16,48}$/i.test(token)) return { ok: false, reason: 'bad_token' };
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp < 0) return { ok: false, reason: 'bad_exp' };
    if (exp > 0 && Math.floor(Date.now() / 1000) > exp) return { ok: false, reason: 'expired' };
    const msg = `v1|${type}|${token}|${exp}`;
    for (const sec of secretsToTry) {
      const expected = (await hmacSha256Hex(sec, msg)).slice(0, 16);
      if (timingSafeEqual(expected, mac)) {
        return { ok: true, type, token, exp };
      }
    }
    return { ok: false, reason: 'bad_mac' };
  }

  // Bare DB token (very old prints)
  if (/^[a-z0-9]{16,48}$/i.test(s)) {
    return { ok: true, type: 'invoice', token: s, exp: 0 };
  }
  return { ok: false, reason: 'unsupported' };
}


/** Canonical integrity fingerprint for a sales/purchase document (PDF seal). */
export async function documentIntegrityHash(parts: Record<string, string | number | null | undefined>): Promise<string> {
  const keys = Object.keys(parts).sort();
  const payload = keys.map((k) => `${k}=${parts[k] ?? ''}`).join('|');
  return sha256Hex(payload);
}

/**
 * Cryptographic timestamp (PAdES-T intent / ETSI EN 319 142 B-T aligned).
 *
 * Full Adobe PAdES-B-T embeds an RFC 3161 TSA token inside a CMS signature
 * in the PDF. Workers cannot hold a commercial TSA private key by default.
 * We issue an **Atlas Timestamp Token (ATT)** bound by HMAC-SHA256 to:
 *   - document integrity hash
 *   - UTC time (ISO-8601)
 *   - nonce
 * Verifiable offline against current/previous HMAC keys.
 * Structure is stable so a future RFC 3161 TSA can replace the inner proof
 * without changing public APIs.
 */
type AtlasTimestampToken = {
  v: 1;
  alg: 'HMAC-SHA256';
  /** ISO-8601 UTC */
  t: string;
  /** Document hash being timestamped */
  h: string;
  /** Random nonce (hex) */
  n: string;
  /** HMAC over v|t|h|n */
  mac: string;
  /** Key id 1=current 0=previous at issue time */
  kid: number;
  /** Human label */
  profile: 'PAdES-B-T-aligned';
};

export async function createAtlasTimestampToken(
  env: Env,
  docHash: string,
  db?: D1Database,
): Promise<{ token: AtlasTimestampToken; compact: string; issuedAt: string }> {
  const secrets = await publicTokenSecretsAsync(env, db);
  const issuedAt = new Date().toISOString();
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const n = Array.from(nonceBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  const h = String(docHash || '').toLowerCase();
  const msg = `att1|${issuedAt}|${h}|${n}`;
  const mac = (await hmacSha256Hex(secrets.current, msg)).slice(0, 32);
  const token: AtlasTimestampToken = {
    v: 1,
    alg: 'HMAC-SHA256',
    t: issuedAt,
    h,
    n,
    mac,
    kid: 1,
    profile: 'PAdES-B-T-aligned',
  };
  const compact = b64urlEncode(JSON.stringify(token));
  return { token, compact, issuedAt };
}

export async function verifyAtlasTimestampToken(
  env: Env,
  compactOrJson: string,
  expectedHash?: string,
  db?: D1Database,
): Promise<{ ok: boolean; reason?: string; token?: AtlasTimestampToken }> {
  let token: AtlasTimestampToken;
  try {
    const raw = compactOrJson.trim().startsWith('{')
      ? compactOrJson
      : b64urlDecode(compactOrJson.trim());
    token = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'bad_token_encoding' };
  }
  if (!token || token.v !== 1 || token.alg !== 'HMAC-SHA256') {
    return { ok: false, reason: 'bad_token_version' };
  }
  if (expectedHash && token.h && token.h.toLowerCase() !== expectedHash.toLowerCase()) {
    return { ok: false, reason: 'hash_mismatch' };
  }
  const msg = `att1|${token.t}|${token.h}|${token.n}`;
  const secrets = await publicTokenSecretsAsync(env, db);
  const trySecrets = [secrets.current, secrets.previous].filter(Boolean) as string[];
  for (const sec of trySecrets) {
    const expected = (await hmacSha256Hex(sec, msg)).slice(0, 32);
    if (timingSafeEqual(expected, token.mac)) {
      return { ok: true, token };
    }
  }
  return { ok: false, reason: 'bad_mac' };
}


/** Canonical document snapshot at signature time (detect later total changes). */
export function invoiceDocHashPayload(inv: any): string {
  return [
    inv.number || '',
    inv.client_name || '',
    Number(inv.total || 0),
    Number(inv.amount_paid || 0),
    inv.issue_date || '',
    inv.status || '',
  ].join('|');
}

export async function digestSignatureImage(dataUrl: string): Promise<string> {
  // Hash the base64 body only (stable fingerprint of the drawing)
  const i = dataUrl.indexOf(',');
  const body = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  return sha256Hex(body.slice(0, 200_000));
}

export async function validateStoredSignature(inv: any): Promise<{
  present: boolean;
  imageOk: boolean;
  digestOk: boolean;
  docUnchanged: boolean;
  signedAt: string | null;
  message: string;
}> {
  const present = !!(inv.client_signature && String(inv.client_signature).startsWith('data:image'));
  if (!present) {
    return {
      present: false,
      imageOk: false,
      digestOk: false,
      docUnchanged: true,
      signedAt: null,
      message: 'Aucune signature client enregistrée.',
    };
  }
  const imageOk =
    inv.client_signature.startsWith('data:image/png') ||
    inv.client_signature.startsWith('data:image/jpeg') ||
    inv.client_signature.startsWith('data:image/jpg') ||
    inv.client_signature.startsWith('data:image/webp');
  let digestOk = true;
  if (inv.signature_digest) {
    const d = await digestSignatureImage(String(inv.client_signature));
    digestOk = d === inv.signature_digest;
  }
  let docUnchanged = true;
  if (inv.signed_doc_hash) {
    const h = await sha256Hex(invoiceDocHashPayload(inv));
    docUnchanged = h === inv.signed_doc_hash;
  }
  let message = 'Signature client valide.';
  if (!imageOk) message = 'Format de signature non reconnu.';
  else if (!digestOk) message = 'Signature altérée (empreinte ne correspond pas).';
  else if (!docUnchanged) message = 'Attention : montants ou statut modifiés après la signature.';
  else message = `Signature client valide${inv.signed_at ? ' · ' + inv.signed_at : ''}.`;
  return {
    present: true,
    imageOk,
    digestOk,
    docUnchanged,
    signedAt: inv.signed_at || null,
    message,
  };
}

/** Ensure invoice_items promo columns exist */
export async function ensureInvoiceItemPromoColumns(db: D1Database) {
  await schemaOnce('ensureInvoiceItemPromoColumns', async () => {
  await addColumnIfMissing(db, 'invoice_items', 'list_price', `REAL DEFAULT 0`);
  await addColumnIfMissing(db, 'invoice_items', 'discount_amount', `REAL DEFAULT 0`);
  await addColumnIfMissing(db, 'invoice_items', 'discount_percent', `REAL DEFAULT 0`);

  });
}

/* client schema helpers → lib/clients-schema.ts */



/** Invoice-level tax exempt */
export async function ensureInvoiceTaxExempt(db: D1Database) {
  await schemaOnce('ensureInvoiceTaxExempt', async () => {
  await addColumnIfMissing(db, 'invoices', 'tax_exempt', `INTEGER DEFAULT 0`);

  });
}

/** Remboursement / avoir (WR-) columns */
export async function ensureInvoiceRefundColumns(db: D1Database) {
  await schemaOnce('invoice_refund_cols', async () => {
    await addColumnIfMissing(db, 'invoices', 'doc_kind', "TEXT DEFAULT 'invoice'");
    await addColumnIfMissing(db, 'invoices', 'refund_of_invoice_id', 'INTEGER');
    await addColumnIfMissing(db, 'invoices', 'refund_reason', "TEXT DEFAULT ''");
    await addColumnIfMissing(db, 'invoices', 'refund_reason_code', "TEXT DEFAULT ''");
    await addColumnIfMissing(db, 'company_settings', 'next_credit_number', 'INTEGER DEFAULT 1');
    await addColumnIfMissing(db, 'company_settings', 'credit_prefix', "TEXT DEFAULT 'WR-'");
    await addColumnIfMissing(db, 'company_settings', 'quick_sale_prefix', "TEXT DEFAULT 'VR-'");
    await addColumnIfMissing(db, 'company_settings', 'next_quick_sale_number', 'INTEGER DEFAULT 1');
  });
}

export const REFUND_REASON_CODES: Record<string, string> = {
  our_error: 'Erreur de notre part (erreur de commande / facturation)',
  defective_shipped: 'Article cassé ou défectueux à l’envoi — non causé par le client',
  wrong_item: 'Mauvais article / non conforme envoyé',
  missing_qty: 'Quantité manquante à la livraison',
  damaged_transit: 'Dommage constaté à la réception (transport)',
};

export function validateRefundReason(code: string, detail: string): { ok: true; label: string; full: string } | { ok: false; error: string } {
  const c = String(code || '').trim();
  const d = String(detail || '').trim();
  if (!c || !REFUND_REASON_CODES[c]) {
    return {
      ok: false,
      error:
        'Un motif de remboursement valide est obligatoire. Choisissez : erreur de notre part, article défectueux envoyé, mauvais article, quantité manquante, ou dommage transport. Un remboursement sans explication valable n’est pas accepté.',
    };
  }
  if (d.length < 12) {
    return {
      ok: false,
      error:
        'Précisez le motif (min. 12 caractères). Un remboursement sans explication détaillée n’est pas accepté, quel que soit le cas.',
    };
  }
  // Reject lazy placeholders
  const low = d.toLowerCase();
  const bad = ['test', 'xxx', 'n/a', 'na', 'aucune', 'rien', 'ok', 'oui', 'non'];
  if (bad.includes(low) || low.length < 12) {
    return { ok: false, error: 'Explication trop vague. Décrivez clairement le problème (ex. article reçu cassé, erreur de référence…).' };
  }
  const label = REFUND_REASON_CODES[c];
  return { ok: true, label, full: `${label}. Détail : ${d}` };
}

/** Préfixe WR / avoir : 1–12 car. lettres, chiffres, - ou / */
export function validateCreditPrefix(raw: unknown): { ok: true; value: string } | { ok: false; error: string; code: string } {
  return validateCreditPrefixCore(raw);
}

export function validateNextCreditNumber(raw: unknown): { ok: true; value: number } | { ok: false; error: string; code: string } {
  return validateNextCreditNumberCore(raw);
}

/**
 * Product bulk discount tiers stored as JSON text:
 * [{"min_qty":10,"percent":5},{"min_qty":50,"percent":10}]
 * Highest matching min_qty wins.
 */
export async function ensureProductBulkDiscounts(db: D1Database) {
  try {
    await schemaOnce('ensureProductBulkDiscounts', async () => {
      await addColumnIfMissing(db, 'products', 'bulk_discounts', `TEXT DEFAULT '[]'`);
    });
  } catch (e) {
    // Never 500 a product save because of an optional column migration.
    console.error('ensureProductBulkDiscounts_err', String((e as any)?.message || e).slice(0, 300));
  }
}

/** Lowercased column names of a table, or null when PRAGMA is unavailable. */
export async function tableColumns(db: D1Database, table: string): Promise<Set<string> | null> {
  try {
    const info = await db.prepare(`PRAGMA table_info(${table})`).all();
    return new Set(((info?.results || []) as { name?: string }[]).map((r) => String(r.name || '').toLowerCase()));
  } catch {
    return null;
  }
}

/** True when the column exists (or PRAGMA unavailable — assume yes). */
export async function hasColumn(db: D1Database, table: string, column: string): Promise<boolean> {
  try {
    const info = await db.prepare(`PRAGMA table_info(${table})`).all();
    return ((info?.results || []) as { name?: string }[]).some((r) => String(r.name || '').toLowerCase() === column.toLowerCase());
  } catch {
    return true;
  }
}

export function parseBulkDiscounts(raw: any): { min_qty: number; percent: number }[] {
  return coreParseBulkDiscounts(raw);
}

/** Apply bulk discount to list price given quantity; returns unit price after best tier */
export function applyBulkDiscount(listPrice: number, qty: number, bulkRaw: any): { unit_price: number; bulk_percent: number } {
  return coreApplyBulkDiscount(listPrice, qty, bulkRaw);
}

/**
 * ── Inventory audit log (stock_movements) ──────────────────────────────
 * Every REAL quantity change on tracked products writes one row:
 *   product_id, type, quantity (absolute), previous_quantity, new_quantity,
 *   reason, reference, created_by, created_at
 *
 * Zero-delta rule: if the signed quantity is 0 (or near-zero), nothing is
 * written and stock is not updated. Invoice edit uses NET deltas per product
 * so saving the same quantities (price/promo/notes only) leaves stock + audit
 * untouched.
 *
 * Types (normalized):
 *   sale | purchase | in | out | adjustment | restock | initial
 *
 * Writers:
 *   - product create (initial stock > 0) → initial
 *   - POST /api/products/:id/adjust-stock → body.type
 *   - invoice create → sale (per line product)
 *   - invoice edit → sale | restock only for products whose qty changed
 *   - invoice cancel / delete → restock (if not already cancelled / not quote)
 *   - quote→invoice convert → sale
 *   - bill create → purchase
 * Quotes never write movements.
 *
 * Readers:
 *   GET /api/products/:id/movements?limit=50 — last N for one product
 *   GET /api/stock/movements?product_id=&type=&q=&limit=&offset= — global audit
 * History is retained when a product is deleted (orphan rows allowed).
 */

export async function ensureStockMovementsTable(db: D1Database) {
  await schemaOnce('ensureStockMovementsTable', async () => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER,
      type TEXT NOT NULL DEFAULT 'adjustment',
      quantity REAL NOT NULL DEFAULT 0,
      previous_quantity REAL NOT NULL DEFAULT 0,
      new_quantity REAL NOT NULL DEFAULT 0,
      reason TEXT DEFAULT '',
      reference TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
  await addColumnIfMissing(db, 'stock_movements', 'reference', `TEXT DEFAULT ''`);
  await addColumnIfMissing(db, 'stock_movements', 'created_by', `TEXT DEFAULT ''`);

  });
}

export function normalizeMovementType(qtySigned: number, reason: string, explicit?: string): string {
  if (explicit) {
    const t = String(explicit).toLowerCase().trim();
    if (['sale', 'purchase', 'in', 'out', 'adjustment', 'restock', 'initial', 'refund_restock', 'refund_no_restock'].includes(t)) return t;
  }
  const r = (reason || '').toLowerCase();
  if (qtySigned < 0) {
    if (r.includes('sale') || r.includes('invoice') || r.includes('facture') || r.includes('qty up') || r.includes('line added')) return 'sale';
    return 'out';
  }
  if (r.includes('purchase') || r.includes('bill') || r.includes('achat')) return 'purchase';
  if (
    r.includes('restock') ||
    r.includes('rétabli') ||
    r.includes('retabli') ||
    r.includes('cancel') ||
    r.includes('annul') ||
    r.includes('deleted') ||
    r.includes('qty down') ||
    r.includes('line removed') ||
    r.includes('rembours') ||
    r.includes('retour stock')
  ) return 'restock';
  if (r.includes('initial') || r.includes('stock initial')) return 'initial';
  if (r.includes('réception') || r.includes('reception')) return 'in';
  return 'adjustment';
}

/**
 * Stock movement helper + audit writer.
 * qtySigned > 0 → stock in | qtySigned < 0 → stock out
 * Near-zero qtySigned → no-op (no product update, no audit row).
 * Quotes must never call this.
 */
/**
 * Moving Weighted Average Cost (MAC) — industry-standard for mixed purchase prices.
 * new_cost = (qty_on_hand * old_cost + qty_bought * buy_price) / (qty_on_hand + qty_bought)
 * If stock was empty, cost becomes the purchase price.
 * Also stores last_purchase_cost when column exists.
 */
export async function ensureValuationTables(db: D1Database) {
  await schemaOnce('ensureValuationTables', async () => {
  await addColumnIfMissing(db, 'company_settings', 'inventory_valuation_method', `TEXT DEFAULT 'average'`);
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS stock_cost_layers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      quantity_remaining REAL NOT NULL,
      unit_cost REAL NOT NULL,
      source_ref TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS auto_transfer_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      product_id INTEGER,
      from_location_id INTEGER NOT NULL,
      to_location_id INTEGER NOT NULL,
      trigger_type TEXT NOT NULL DEFAULT 'low_stock',
      threshold REAL NOT NULL DEFAULT 5,
      transfer_qty REAL NOT NULL DEFAULT 10,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();

  });
}

export async function getValuationMethod(db: D1Database): Promise<'average' | 'fifo' | 'standard'> {
  await ensureValuationTables(db);
  const row = await db.prepare(`SELECT inventory_valuation_method FROM company_settings WHERE id = 1`).first() as any;
  const m = String(row?.inventory_valuation_method || 'average').toLowerCase();
  if (m === 'fifo' || m === 'standard') return m;
  return 'average';
}

export async function pushFifoLayer(db: D1Database, productId: number | string, qty: number, unitCost: number, ref: string) {
  await ensureValuationTables(db);
  await db.prepare(
    `INSERT INTO stock_cost_layers (product_id, quantity_remaining, unit_cost, source_ref) VALUES (?, ?, ?, ?)`
  ).bind(productId, qty, unitCost, ref || '').run();
}

export async function runAutoTransfers(
  db: D1Database,
  productIds: (number | string)[],
): Promise<{ transferred: number; details: string[] }> {
  await ensureValuationTables(db);
  await ensureStockLocations(db);
  const details: string[] = [];
  let transferred = 0;
  const { results: rules } = await db.prepare(
    `SELECT * FROM auto_transfer_rules WHERE is_active = 1 AND trigger_type = 'low_stock'`
  ).all();
  if (!(rules || []).length) return { transferred: 0, details: [] };

  for (const pid of productIds) {
    if (!pid) continue;
    for (const rule of (rules || []) as any[]) {
      if (rule.product_id && Number(rule.product_id) !== Number(pid)) continue;
      const toId = Number(rule.to_location_id);
      const fromId = Number(rule.from_location_id);
      if (!toId || !fromId || toId === fromId) continue;
      const toRow = await db.prepare(
        `SELECT quantity FROM stock_location_qty WHERE location_id = ? AND product_id = ?`
      ).bind(toId, pid).first() as any;
      const toQty = Number(toRow?.quantity || 0);
      const threshold = Number(rule.threshold || 0);
      if (toQty > threshold) continue;
      const fromRow = await db.prepare(
        `SELECT quantity FROM stock_location_qty WHERE location_id = ? AND product_id = ?`
      ).bind(fromId, pid).first() as any;
      const fromQty = Number(fromRow?.quantity || 0);
      let move = Number(rule.transfer_qty || 0);
      if (move <= 0) move = Math.max(1, threshold - toQty + 1);
      move = Math.min(move, fromQty);
      if (move <= 1e-9) continue;
      try {
        await adjustLocationStock(db, pid, fromId, -move);
        await adjustLocationStock(db, pid, toId, move);
        await applyStockDelta(db, pid, 0, `Transfert auto règle#${rule.id} ×${move}`, 'auto-transfer', {
          type: 'adjustment',
          skipLocation: true,
        });
        transferred += 1;
        details.push(`Produit ${pid}: ${move} de loc ${fromId} → ${toId}`);
      } catch (e) {
        console.error('auto transfer', e);
      }
    }
  }
  return { transferred, details };
}

export async function applyMovingAverageCost(
  db: D1Database,
  productId: number | string,
  qtyBought: number,
  unitCost: number,
  ref = '',
): Promise<number | null> {
  const qty = Number(qtyBought);
  const price = Number(unitCost);
  if (!productId || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price < 0) return null;
  const method = await getValuationMethod(db);

  if (method === 'fifo') {
    await pushFifoLayer(db, productId, qty, price, ref);
    const { results } = await db.prepare(
      `SELECT quantity_remaining, unit_cost FROM stock_cost_layers WHERE product_id = ? AND quantity_remaining > 0`
    ).bind(productId).all();
    let q = 0, c = 0;
    for (const r of (results || []) as any[]) {
      q += Number(r.quantity_remaining || 0);
      c += Number(r.quantity_remaining || 0) * Number(r.unit_cost || 0);
    }
    const avg = q > 0 ? roundTo(c / q, 4) : price;
    try {
      await db.prepare(`UPDATE products SET cost = ?, last_purchase_cost = ?, updated_at = datetime('now') WHERE id = ?`).bind(avg, price, productId).run();
    } catch {
      await db.prepare(`UPDATE products SET cost = ?, updated_at = datetime('now') WHERE id = ?`).bind(avg, productId).run();
    }
    return avg;
  }

  if (method === 'standard') {
    try {
      await db.prepare(`UPDATE products SET last_purchase_cost = ?, updated_at = datetime('now') WHERE id = ?`).bind(price, productId).run();
    } catch { /* */ }
    const pstd = await db.prepare(`SELECT cost FROM products WHERE id = ?`).bind(productId).first() as any;
    return Number(pstd?.cost || price);
  }

  const prod = await db.prepare(
    `SELECT stock_quantity, cost FROM products WHERE id = ?`
  ).bind(productId).first() as any;
  if (!prod) return null;
  // stock_quantity here is BEFORE this purchase is applied — caller order matters
  const newCost = computeMovingAverageCost(prod.stock_quantity, prod.cost, qty, price);
  if (newCost == null) return null;
  try {
    await db.prepare(
      `UPDATE products SET cost = ?, last_purchase_cost = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(newCost, price, productId).run();
  } catch {
    await db.prepare(
      `UPDATE products SET cost = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(newCost, productId).run();
  }
  return newCost;
}

/**
 * Atomic stock mutation (Phase 0).
 * - Decrements use conditional UPDATE so concurrent sales cannot oversell.
 * - Insufficient stock → throws { code: 'INSUFFICIENT_STOCK' } unless allowNegative.
 * - qty 0 + explicit type (e.g. refund_no_restock) → audit movement only, no qty change.
 */
export async function applyStockDelta(
  db: D1Database,
  productId: number | string | null | undefined,
  qtySigned: number,
  reason: string,
  reference: string,
  opts?: { createdBy?: string; approvedBy?: string;
    /** When set, may send FCM low-stock push */
    env?: any; type?: string; allowNegative?: boolean; locationId?: number | null; skipLocation?: boolean },
) {
  if (!productId) return null;
  const delta = Number(qtySigned);
  if (!Number.isFinite(delta)) return null;
  await ensureStockMovementsTable(db);
  if (opts?.approvedBy) await ensureMovementApprover(db);

  const prod = await db.prepare(
    `SELECT id, stock_quantity, track_inventory, name FROM products WHERE id = ?`
  ).bind(productId).first() as any;
  if (!prod) return null;
  if (!prod.track_inventory) return null;

  const prev = Number(prod.stock_quantity || 0);
  const type = normalizeMovementType(delta, reason, opts?.type);

  // Audit-only (no stock change) — e.g. WR hors stock
  if (Math.abs(delta) < 1e-9) {
    await db.prepare(
      `INSERT INTO stock_movements (product_id, type, quantity, previous_quantity, new_quantity, reason, reference, created_by)
       VALUES (?, ?, 0, ?, ?, ?, ?, ?)`
    ).bind(productId, type || 'adjustment', prev, prev, reason || '', reference || '', opts?.createdBy || '').run();
    return { previous_quantity: prev, new_quantity: prev, type: type || 'adjustment', audit_only: true };
  }

  if (delta < 0 && !opts?.allowNegative) {
    // Atomic: only succeed if enough stock at write time
    const need = Math.abs(delta);
    const res = await db.prepare(
      `UPDATE products
       SET stock_quantity = stock_quantity + ?, updated_at = datetime('now')
       WHERE id = ? AND track_inventory = 1 AND stock_quantity >= ?`
    ).bind(delta, productId, need).run();
    if (!res.meta?.changes) {
      const err: any = new Error(
        `Stock insuffisant pour « ${prod.name || productId} » (disponible : ${prev}, demandé : ${need}).`
      );
      err.code = 'INSUFFICIENT_STOCK';
      err.available = prev;
      err.requested = need;
      err.product_id = productId;
      throw err;
    }
  } else {
    // Restock / force negative / positive
    await db.prepare(
      `UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = datetime('now') WHERE id = ? AND track_inventory = 1`
    ).bind(delta, productId).run();
  }

  const after = await db.prepare(`SELECT stock_quantity FROM products WHERE id = ?`).bind(productId).first() as any;
  const newQty = Number(after?.stock_quantity ?? prev + delta);

  // Mirror onto warehouse placement (default / sales location) so reports show real places
  if (!opts?.skipLocation) {
    try {
      await ensureStockLocations(db);
      let locId = opts?.locationId ?? null;
      if (!locId) locId = await getDefaultLocationId(db);
      if (locId) {
        const cnt = await db.prepare(
          `SELECT COUNT(*) as c FROM stock_location_qty WHERE product_id = ?`
        ).bind(productId).first() as any;
        if (!Number(cnt?.c) && prev > 0) {
          // Seed previous global stock onto default before applying delta
          await db.prepare(
            `INSERT INTO stock_location_qty (location_id, product_id, quantity) VALUES (?, ?, ?)`
          ).bind(locId, productId, prev).run();
        }
        const row = await db.prepare(
          `SELECT quantity FROM stock_location_qty WHERE location_id = ? AND product_id = ?`
        ).bind(locId, productId).first() as any;
        const locPrev = Number(row?.quantity || 0);
        let locNext = locPrev + delta;
        if (!opts?.allowNegative && locNext < 0) locNext = 0;
        if (row) {
          await db.prepare(
            `UPDATE stock_location_qty SET quantity = ? WHERE location_id = ? AND product_id = ?`
          ).bind(locNext, locId, productId).run();
        } else {
          await db.prepare(
            `INSERT INTO stock_location_qty (location_id, product_id, quantity) VALUES (?, ?, ?)`
          ).bind(locId, productId, Math.max(0, locNext)).run();
        }
      }
    } catch (e) {
      console.error('location mirror', e);
    }
  }

  await db.prepare(
    `INSERT INTO stock_movements (product_id, type, quantity, previous_quantity, new_quantity, reason, reference, created_by${opts?.approvedBy ? ', approved_by' : ''})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?${opts?.approvedBy ? ', ?' : ''})`
  ).bind(
    productId,
    type,
    Math.abs(delta),
    prev,
    newQty,
    reason || '',
    reference || '',
    opts?.createdBy || '',
    ...(opts?.approvedBy ? [opts.approvedBy] : []),
  ).run();
  // Optional push when crossing into low / rupture
  try {
    const envAny = (opts as any)?.env;
    if (envAny && Number.isFinite(newQty)) {
      const prod = await db
        .prepare(
          `SELECT name, sku, low_stock_threshold, track_inventory FROM products WHERE id = ?`,
        )
        .bind(productId)
        .first() as any;
      if (prod && Number(prod.track_inventory) === 1) {
        const th = Number(prod.low_stock_threshold || 0);
        const wasOk = prev > th;
        const nowLow = newQty <= th;
        if (nowLow && (wasOk || newQty <= 0)) {
          await fcmNotifyLowStock(envAny, {
            id: Number(productId),
            name: String(prod.name || ''),
            sku: String(prod.sku || ''),
            stock: newQty,
            threshold: th,
          });
        }
      }
    }
  } catch (e) {
    console.error('low_stock_notify', e);
  }
  return { previous_quantity: prev, new_quantity: newQty, type };
}


/** Delete expired / stale security rows from D1 (OTP, WebAuthn challenges, old login attempts, idempotency). */
export async function purgeEphemeralSecurityData(db: D1Database): Promise<{
  otp: number;
  webauthn_challenges: number;
  login_attempts: number;
  idempotency: number;
}> {
  const out = { otp: 0, webauthn_challenges: 0, login_attempts: 0, idempotency: 0 };
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS otp_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL,
      resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
      expires_at TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(resource_type, resource_id)
    )`).run();
    const r1 = await db.prepare(
      `DELETE FROM otp_codes WHERE datetime(expires_at) < datetime('now')`
    ).run();
    out.otp = Number(r1.meta?.changes || 0);
  } catch (e) {
    console.log('purge otp', e);
  }
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS webauthn_challenges (
      id TEXT PRIMARY KEY, challenge TEXT NOT NULL, fingerprint TEXT NOT NULL,
      purpose TEXT NOT NULL, expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`).run();
    const r2 = await db.prepare(
      `DELETE FROM webauthn_challenges WHERE datetime(expires_at) < datetime('now')`
    ).run();
    out.webauthn_challenges = Number(r2.meta?.changes || 0);
  } catch (e) {
    console.log('purge webauthn_challenges', e);
  }
  try {
    // Keep 14 days of login attempt history for rate-limit / reputation
    const r3 = await db.prepare(
      `DELETE FROM login_attempts WHERE datetime(created_at) < datetime('now', '-14 days')`
    ).run();
    out.login_attempts = Number(r3.meta?.changes || 0);
  } catch (e) {
    console.log('purge login_attempts', e);
  }
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY, route TEXT NOT NULL DEFAULT '',
      response_json TEXT NOT NULL DEFAULT '', status_code INTEGER DEFAULT 200,
      created_at TEXT DEFAULT (datetime('now'))
    )`).run();
    const r4 = await db.prepare(
      `DELETE FROM idempotency_keys WHERE datetime(created_at) < datetime('now', '-7 days')`
    ).run();
    out.idempotency = Number(r4.meta?.changes || 0);
  } catch (e) {
    console.log('purge idempotency', e);
  }
  return out;
}

/** Idempotency store — prevents double-post on retry (payment, WR, invoice). */
export async function ensureIdempotencyTable(db: D1Database) {
  await schemaOnce('ensureIdempotencyTable', async () => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      route TEXT NOT NULL DEFAULT '',
      response_json TEXT NOT NULL DEFAULT '',
      status_code INTEGER DEFAULT 200,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();

  });
}

export function extractIdempotencyKey(c: any, body: any): string {
  const h = c.req.header('Idempotency-Key') || c.req.header('idempotency-key') || '';
  const b = body?.idempotency_key || body?.idempotencyKey || '';
  return String(h || b || '').trim().slice(0, 128);
}

export async function idempotencyGet(db: D1Database, key: string): Promise<{ status: number; body: any } | null> {
  if (!key) return null;
  await ensureIdempotencyTable(db);
  const row = await db.prepare(`SELECT response_json, status_code FROM idempotency_keys WHERE key = ?`).bind(key).first() as any;
  if (!row) return null;
  try {
    return { status: Number(row.status_code || 200), body: JSON.parse(row.response_json || '{}') };
  } catch {
    return null;
  }
}

export async function idempotencyPut(db: D1Database, key: string, route: string, status: number, body: any) {
  if (!key) return;
  await ensureIdempotencyTable(db);
  try {
    await db.prepare(
      `INSERT OR REPLACE INTO idempotency_keys (key, route, response_json, status_code, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    ).bind(key, route, JSON.stringify(body).slice(0, 100000), status).run();
  } catch (e) {
    console.error('idempotencyPut', e);
  }
}

/** Phase 1 — period lock (YYYY-MM). Mutations with issue_date <= locked month blocked. */
export async function ensurePeriodLockColumn(db: D1Database) {
  await schemaOnce('ensurePeriodLockColumn', async () => {
  await addColumnIfMissing(db, 'company_settings', 'fiscal_locked_through', `TEXT DEFAULT ''`);

  });
}

export async function assertPeriodOpen(
  db: D1Database,
  issueDate?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await ensurePeriodLockColumn(db);
  const row = await db.prepare(`SELECT fiscal_locked_through FROM company_settings WHERE id = 1`).first() as any;
  const locked = String(row?.fiscal_locked_through || '').trim(); // YYYY-MM
  if (!locked) return { ok: true };
  const d = String(issueDate || new Date().toISOString().slice(0, 10)).slice(0, 7);
  if (d && d <= locked) {
    return {
      ok: false,
      error: `Période clôturée jusqu’à ${locked}. Impossible de créer ou modifier un document daté ${d}. Rouvrez la période (owner) si nécessaire.`,
    };
  }
  return { ok: true };
}

/** Formal void: cancel keeps number forever; void_reason required for audit (CGI no gaps). */
export async function ensureVoidColumns(db: D1Database) {
  await schemaOnce('ensureVoidColumns', async () => {
  await addColumnIfMissing(db, 'invoices', 'void_reason', `TEXT DEFAULT ''`);
  await addColumnIfMissing(db, 'invoices', 'voided_at', `TEXT`);
  await addColumnIfMissing(db, 'invoices', 'voided_by', `TEXT DEFAULT ''`);

  });
}

/**
 * ── Duplicate handling API (products) ──────────────────────────────────
 *
 * Endpoints:
 *   POST /api/products          — create
 *   PUT  /api/products/:id      — update
 *
 * Collision fields checked (any one match is enough):
 *   | field   | match rule                         | when empty |
 *   |---------|------------------------------------|------------|
 *   | sku     | case-insensitive exact             | skipped    |
 *   | barcode | exact string match                 | skipped    |
 *   | name    | case-insensitive exact             | always checked (name required) |
 *
 * PUT excludes the row being edited (`id != :id`).
 *
 * On conflict → HTTP 409 Conflict:
 * {
 *   "success": false,
 *   "code": "DUPLICATE_PRODUCT",
 *   "force_required": true,
 *   "error": "Produit en doublon (SKU) : « … » (id N). Passez force_duplicate=true …",
 *   "hint": "Envoyez force_duplicate=true pour forcer, ou mettez à jour le produit existant…",
 *   "duplicate": { "id": N, "name": "…", "sku": "…", "barcode": "…" },  // first match
 *   "matches": [
 *     { "on": "SKU"|"code-barres"|"nom", "id": N, "name": "…", "sku": "…", "barcode": "…" },
 *     …
 *   ]
 * }
 *
 * Override:
 *   body.force_duplicate = true  → create/update proceeds despite collisions.
 *
 * Client UI should:
 *   1. Show matches list (which field collided, with existing id/name).
 *   2. Offer “Open existing” (navigate to product id) or “Force create”.
 *   3. On force, resubmit same payload with force_duplicate: true.
 *
 * Related (clients import — separate flow):
 *   POST /api/clients/import/preview → soft matches on ICE / email / name
 *   with suggested action skip | create | update.
 */

/**
 * Morocco-compliant sequential numbering (art. 145 CGI).
 * Styles (numbering_style setting):
 *   - prefix_pad5   → FA-00001 (legacy default)
 *   - year_seq      → 2026-0001
 *   - prefix_year   → FA-2026-0001  (recommended Morocco)
 *   - year_slash    → 2026/0001
 *   - prefix_year_slash → FA/2026/0001
 * Each document type (invoice, quote, bill, receipt) has its own prefix + counter.
 */

/** 10-year style archive: immutable JSON snapshot of invoice on R2 (best-effort). */
export async function archiveInvoiceSnapshot(env: Env, inv: any, items: any[]): Promise<void> {
  try {
    if (!env.IMAGES || !inv?.number) return;
    const key = `archives/invoices/${String(inv.number).replace(/[^a-zA-Z0-9._-]+/g, '_')}.json`;
    const body = JSON.stringify({
      archived_at: new Date().toISOString(),
      retention_years: 10,
      invoice: inv,
      items: items || [],
    });
    await env.IMAGES.put(key, body, {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: {
        type: 'invoice_archive',
        number: String(inv.number),
        retention: '10y',
      },
    });
  } catch (e) {
    console.log('archiveInvoiceSnapshot', e);
  }
}

export async function ensureClientPricesTable(db: D1Database): Promise<void> {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS client_product_prices (
      client_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (client_id, product_id)
    )
  `).run();
}

/* nextDocumentNumber → worker/lib/numbering.ts */
/** Nullable attribution: legacy rows and workflows without approval remain unknown. */
export async function ensureDocumentActors(db: D1Database, table: 'invoices' | 'bills' | 'receipts') {
  await addColumnIfMissing(db, table, 'created_by', 'TEXT DEFAULT NULL');
  await addColumnIfMissing(db, table, 'approved_by', 'TEXT DEFAULT NULL');
}

