import type { AtlasApp } from './types';
import type { Env } from '../env';
import { getWorkerFinanceHealthStats } from '../lib/financeCore';
import { addColumnIfMissing } from '../lib/schema';
import { normalizeRole } from '../lib/rbac';
import { normalizeInventoryRole, roleCanSeeFinancial } from '../lib/inventory-policy';
import { nextDocumentNumber } from '../lib/numbering';
import { normalizeProductImageReference } from '../lib/product-images';
import { proactiveFtsHealth } from '../lib/reliability';
import { afterBusinessMutation, listR2Prefix } from '../lib/delete-coord';
import {
  cascadeDeleteInvoice,
  ensurePaymentHistoryTable,
  ensureReceiptsTable,
  hmacSha256Hex,
} from '../lib/ledgerHelpers';

export interface LedgerMiscDeps {
  WAF_STATS?: any;
  authFailReason?: any;
  clientIp?: any;
  dbPrimaryFlag?: any;
  setDbPrimaryCache?: any;
  getConfig?: any;
  issueDeleteOtp?: any;
  requireOwner?: any;
  sessionUserFromHeader?: any;
  setConfig?: any;
  userMail?: any;
  verifyDeleteOtp?: any;
  writeAudit?: any;
  checkConfirmPassword?: any;
  ensureExpenseTypeColumn?: any;
  requireBizMutator?: any;
  productImageFailure?: any;
  readProductImageJson?: any;
}

export function registerCanaryHealthRoutes(app: AtlasApp, deps: LedgerMiscDeps) {
  const {
    WAF_STATS,
    authFailReason,
    clientIp,
    dbPrimaryFlag,
    setDbPrimaryCache,
    getConfig,
    issueDeleteOtp,
    requireOwner,
    sessionUserFromHeader,
    setConfig,
    userMail,
    verifyDeleteOtp,
    writeAudit,
  } = deps;

/* ── v232 — canary endpoint: deploy smoke + subsystem health + WAF stats (no secrets) ── */
app.get('/api/canary', async (c) => {
  const t0 = Date.now();
  const checks: Record<string, { ok: boolean; ms: number }> = {};
  try {
    const a = Date.now();
    await c.env.DB.prepare(`SELECT 1 AS ok`).first();
    checks.d1 = { ok: true, ms: Date.now() - a };
  } catch { checks.d1 = { ok: false, ms: Date.now() - t0 }; }
  if (c.env.CACHE) {
    try {
      const a = Date.now();
      await c.env.CACHE.get('canary-ping');
      checks.kv = { ok: true, ms: Date.now() - a };
    } catch { checks.kv = { ok: false, ms: Date.now() - t0 }; }
  } else checks.kv = { ok: false, ms: 0 };
  if (c.env.IMAGES) {
    try {
      const a = Date.now();
      await c.env.IMAGES.head('__canary_ping__');
      checks.r2 = { ok: true, ms: Date.now() - a };
    } catch { checks.r2 = { ok: false, ms: Date.now() - t0 }; }
  } else checks.r2 = { ok: false, ms: 0 };
  const allOk = Object.values(checks).every((k) => k.ok);
  return c.json({
    success: allOk,
    data: {
      version: '0.4.9-beta',
      environment: String((c.env as any).ENVIRONMENT || 'unknown'),
      ts: new Date().toISOString(),
      totalMs: Date.now() - t0,
      checks,
      waf: { blocked: WAF_STATS.blocked, lastAt: WAF_STATS.lastAt, lastSig: WAF_STATS.lastSig },
      dbTarget: { bound: !!c.env.DB_TARGET, primary: c.env.DB_TARGET ? await dbPrimaryFlag(c.env) : 'source' },
    },
  }, allOk ? 200 : 503);
});

/* ── v232 — D1 → D1 migration tooling (owner only). Target binding optional. ── */
// Private game scores must not appear in admin migration counts or copy summaries.
const MIG_SKIP = /^(sqlite_|d1_|_cf_|snake_personal_best$|work_status_report_owners$|user_report_dedup$|user_report_delivery_leases$)/;
async function migTables(db: D1Database): Promise<{ name: string; rows: number }[]> {
  const list = (await db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name`).all()) as any;
  const out: { name: string; rows: number }[] = [];
  for (const r of list.results || []) {
    const name = String(r.name || '');
    if (!name || MIG_SKIP.test(name)) continue;
    try {
      const c = (await db.prepare(`SELECT COUNT(*) AS c FROM \`${name}\``).first()) as any;
      out.push({ name, rows: Number(c?.c || 0) });
    } catch { out.push({ name, rows: -1 }); }
  }
  return out;
}
app.get('/api/admin/db-migrate/status', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  const target = (c.env as any).DB_TARGET as D1Database | undefined;
  return c.json({
    success: true,
    data: {
      enabled: !!target,
      primary: target ? await dbPrimaryFlag(c.env) : 'source',
      source: await migTables(((c.env as any).DB_SOURCE || c.env.DB) as D1Database),
      target: target ? await migTables(target) : [],
    },
  });
});
app.post('/api/admin/db-migrate/copy', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  const target = (c.env as any).DB_TARGET as D1Database | undefined;
  if (!target) return c.json({ success: false, error: 'Binding D1 « DB_TARGET » absente — ajoutez-la (atlas-db) puis redéployez.', code: 'NO_TARGET' }, 400);
  const body = await c.req.json().catch(() => ({}));
  const only = Array.isArray(body.tables) ? body.tables.map((t: any) => String(t)).slice(0, 80) : null;
  const cursorIn = body.cursor && typeof body.cursor === 'object' ? body.cursor : {};
  const copied: Record<string, number> = {};
  const cursor: Record<string, number> = { ...cursorIn };
  const done: string[] = [];
  let budget = 1500; // rows per call (Workers CPU-friendly)
  const physSrc = ((c.env as any).DB_SOURCE || c.env.DB) as D1Database;
  const tables = await migTables(physSrc);
  for (const t of tables) {
    if (only && !only.includes(t.name)) continue;
    const name = t.name;
    const ddl = (await physSrc.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).bind(name).first()) as any;
    if (!ddl?.sql) continue;
    try { await target.prepare(String(ddl.sql)).run(); } catch { /* exists or incompatible → skip table */ }
    const cols = (await physSrc.prepare(`PRAGMA table_info(\`${name}\`)`).all()) as any;
    const colNames = (cols.results || []).map((r: any) => `\`${String(r.name)}\``).join(', ');
    if (!colNames) { done.push(name); continue; }
    let last = Number(cursor[name] || 0);
    let guard = 0;
    while (budget > 0 && guard < 40) {
      guard += 1;
      const batch = (await physSrc.prepare(`SELECT rowid AS __rid, * FROM \`${name}\` WHERE rowid > ? ORDER BY rowid LIMIT 200`).bind(last).all()) as any;
      const rows = batch.results || [];
      if (!rows.length) { done.push(name); delete cursor[name]; break; }
      for (const row of rows) {
        const { __rid, ...rest } = row as any;
        const vals = Object.keys(rest).map((k) => (rest as any)[k]);
        const places = Object.keys(rest).map(() => '?').join(', ');
        const keys = Object.keys(rest).map((k) => `\`${k}\``).join(', ');
        try { await target.prepare(`INSERT OR REPLACE INTO \`${name}\` (${keys}) VALUES (${places})`).bind(...vals).run(); } catch { /* row-level skip */ }
        last = Number(__rid);
        budget -= 1;
      }
      cursor[name] = last;
      copied[name] = (copied[name] || 0) + rows.length;
      if (rows.length < 200) { done.push(name); delete cursor[name]; break; }
    }
    if (budget <= 0) break;
  }
  return c.json({ success: true, data: { copied, cursor, done, remainingBudget: budget } });
});
app.post('/api/admin/db-migrate/cutover', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  const target = (c.env as any).DB_TARGET as D1Database | undefined;
  if (!target) return c.json({ success: false, error: 'Binding D1 « DB_TARGET » absente.', code: 'NO_TARGET' }, 400);
  const body = await c.req.json().catch(() => ({}));
  const on = body.on === true || body.on === 'true';
  const value = on ? 'target' : 'source';
  const stamp = new Date().toISOString();
  const physicalSource = ((c.env as any).DB_SOURCE || c.env.DB) as D1Database;
  for (const db of [physicalSource, target]) {
    try {
      await db.prepare(`INSERT INTO app_config (key, value, updated_at) VALUES ('db_primary', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(value, stamp).run();
    } catch { /* best effort per side */ }
  }
  setDbPrimaryCache({ value, at: Date.now() });
  return c.json({ success: true, data: { primary: value } });
});

/* ── Account deletion (OTP-gated) ── */
app.post('/api/settings/account/request-delete-otp', async (c) => {
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), c.req.header('X-Device-Fingerprint') || '');
  if (reason !== 'ok') return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const username = String(session.username || '').toLowerCase();
  const res = await issueDeleteOtp(c.env, 'account-delete', username, 'votre compte Atlas Commerce', 'Code de confirmation — suppression de compte', { toEmail: await userMail(c.env.DB, username) });
  return c.json({ success: true, emailed: res.emailed, message: res.message, otp: res.emailed ? undefined : res.otp });
});

app.post('/api/settings/account/delete', async (c) => {
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), c.req.header('X-Device-Fingerprint') || '');
  if (reason !== 'ok') return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  const username = String(session.username || '').toLowerCase();
  if (session.role === 'owner') return c.json({ success: false, error: 'Le compte propriétaire ne peut pas être supprimé ici.' }, 400);
  const body = await c.req.json().catch(() => ({}));
  const check = await verifyDeleteOtp(c.env.DB, 'account-delete', username, String(body.otp || ''));
  if (!check.ok) return c.json({ success: false, error: check.error }, check.status as any);
  await c.env.DB.prepare(`DELETE FROM app_users WHERE lower(username) = ?`).bind(username).run();
  await c.env.DB.prepare(`DELETE FROM trusted_devices WHERE lower(username) = ?`).bind(username).run();
  await c.env.DB.prepare(`DELETE FROM webauthn_credentials WHERE lower(username) = ?`).bind(username).run();
  await writeAudit(c.env.DB, { username, role: session.role, action: 'account.delete', entity: username, detail: 'otp-verified' });
  return c.json({ success: true });
});

/* ── 2FA (OTP at every login, even trusted devices) ── */
app.get('/api/settings/2fa', async (c) => {
  const reason = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), c.req.header('X-Device-Fingerprint') || '');
  if (reason !== 'ok') return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
  const v = await getConfig(c.env.DB, 'twofa_enabled', '0');
  return c.json({ success: true, data: { enabled: v === '1' } });
});

app.put('/api/settings/2fa', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  const body = await c.req.json().catch(() => ({}));
  const enabled = body.enabled ? '1' : '0';
  await setConfig(c.env.DB, 'twofa_enabled', enabled);
  await writeAudit(c.env.DB, { username: gate.username, role: 'owner', action: 'security.2fa_toggle', entity: 'auth', detail: enabled === '1' ? 'enabled' : 'disabled' });
  return c.json({ success: true, data: { enabled: enabled === '1' } });
});

/* ── Logged-in devices (every user sees their own; revoke supported) ── */

/** Phase 3: health / bindings observability (no secrets). */
app.get('/api/health', async (c) => {
  void proactiveFtsHealth(c.env.DB);
  let d1 = false;
  try {
    await c.env.DB.prepare('SELECT 1 as ok').first();
    d1 = true;
  } catch { /* */ }
  let cacheStatus = null;
  try {
    if (c.env.CACHE) {
      const raw = await c.env.CACHE.get('meta:cache_status', 'text');
      cacheStatus = raw ? JSON.parse(raw) : null;
    }
  } catch { /* */ }
  const fc = getWorkerFinanceHealthStats(c.env);
  return c.json({
    success: true,
    data: {
      ok: true,
      d1,
      kv: !!c.env.CACHE,
      r2: !!c.env.IMAGES,
      cdn: c.env.CDN_BASE || 'https://cdn1.afmarbre.com',
      environment: c.env.ENVIRONMENT || 'unknown',
      finance_core: {
        contract_version: fc.contractVersion,
        engine: fc.engine,
        status: fc.status,
        abi_version: fc.abiVersion,
        wasm_bundled: fc.wasmBundled,
        exports_verified: fc.requiredExportsVerified,
      },
      cache_status: cacheStatus,
      time: new Date().toISOString(),
    },
  });
});

/** List R2 objects under products/ (owner) — inventory of stored images (not Iceberg catalog). */
app.get('/api/admin/r2/images', async (c) => {
  const gate = requireOwner(c);
  if (!gate.ok) return gate.response;
  const prefix = (c.req.query('prefix') || 'products/').slice(0, 64);
  const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') || 50)));
  const objects = await listR2Prefix(c.env.IMAGES, prefix, limit);
  return c.json({
    success: true,
    data: objects,
    meta: {
      bucket: 'company-stock-images',
      cdn: c.env.CDN_BASE || 'https://cdn1.afmarbre.com',
      note: 'R2 object inventory. R2 Data Catalog (Iceberg) is optional analytics, not required for product images.',
    },
  });
});

}

export function registerLedgerMiscRoutes(app: AtlasApp, deps: LedgerMiscDeps) {
  const {
    checkConfirmPassword,
    ensureExpenseTypeColumn,
    requireBizMutator,
    sessionUserFromHeader,
  } = deps;

app.get('/api/expenses/:id/links', async (c) => {
  if (sessionUserFromHeader) {
    const role = normalizeInventoryRole(sessionUserFromHeader(c.req.header('Authorization'))?.role);
    if (!roleCanSeeFinancial(role)) {
      return c.json({ success: false, error: 'Accès réservé owner/admin.', code: 'FORBIDDEN_ROLE' }, 403);
    }
  }
  const id = c.req.param('id');
  const expense = await c.env.DB.prepare(`SELECT * FROM expenses WHERE id = ?`).bind(id).first() as any;
  if (!expense) return c.json({ success: false, error: 'Écriture introuvable' }, 404);
  const notes = String(expense.notes || '');
  const m = notes.match(/invoice_id:(\d+)/);
  let invoice = null;
  let receipts: any[] = [];
  if (m) {
    invoice = await c.env.DB.prepare(`SELECT id, number, status FROM invoices WHERE id = ?`).bind(m[1]).first();
    const { results } = await c.env.DB.prepare(`SELECT id, number FROM receipts WHERE invoice_id = ?`).bind(m[1]).all();
    receipts = results || [];
  }
  const rm = notes.match(/receipt:(\d+)/);
  if (rm && !receipts.length) {
    const r = await c.env.DB.prepare(`SELECT id, number FROM receipts WHERE id = ?`).bind(rm[1]).first();
    if (r) receipts = [r];
  }
  return c.json({
    success: true,
    data: {
      expense: { id: expense.id, description: expense.description, amount: expense.amount },
      invoice,
      receipts,
      disclaimer: (invoice || receipts.length)
        ? 'Cette écriture est liée à une facture/reçu. La supprimer n\'efface pas la facture ni le reçu (solde seulement).'
        : null,
    },
  });
});

app.delete('/api/expenses/:id', async (c) => {
  try {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
    if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);

    const expense = await c.env.DB.prepare(`SELECT * FROM expenses WHERE id = ?`).bind(id).first() as any;
    if (!expense) return c.json({ success: false, error: 'Écriture introuvable' }, 404);

    // Optional cascade: if body.cascade_linked and linked invoice requested
    if (body.cascade_linked) {
      const notes = String(expense.notes || '');
      const m = notes.match(/invoice_id:(\d+)/);
      if (m) {
        try {
          await cascadeDeleteInvoice(c.env.DB, m[1]);
        } catch (cascadeErr) {
          console.error('cascadeDeleteInvoice failed', cascadeErr);
          // Still remove the expense entry even if cascade partially fails
          await c.env.DB.prepare(`DELETE FROM expenses WHERE id = ?`).bind(id).run();
          return c.json({
            success: true,
            message: 'Écriture solde supprimée. La cascade facture a rencontré une erreur partielle.',
          });
        }
        return c.json({
          success: true,
          message: 'Écriture, facture liée, reçus et paiements supprimés.',
        });
      }
    }

    await c.env.DB.prepare(`DELETE FROM expenses WHERE id = ?`).bind(id).run();
    await afterBusinessMutation(c.env.CACHE);
    return c.json({ success: true, message: 'Écriture solde supprimée. Le solde a été recalculé.' });
  } catch (err: any) {
    console.error('DELETE /api/expenses/:id', err);
    return c.json({
      success: false,
      error: err?.message || 'Impossible de supprimer l\'écriture de solde.',
      code: 'DELETE_FAILED',
      detail: String(err?.message || err),
    }, 400);
  }
});

/** Ledger reconciliation: match invoice payments vs solde entries */
app.get('/api/ledger/reconcile', async (c) => {
  if (sessionUserFromHeader) {
    const role = normalizeInventoryRole(sessionUserFromHeader(c.req.header('Authorization'))?.role);
    if (!roleCanSeeFinancial(role)) {
      return c.json({ success: false, error: 'Accès réservé owner/admin.', code: 'FORBIDDEN_ROLE' }, 403);
    }
  }
  await ensurePaymentHistoryTable(c.env.DB);
  await ensureExpenseTypeColumn(c.env.DB);
  await ensureReceiptsTable(c.env.DB);

  const { results: payments } = await c.env.DB.prepare(
    `SELECT p.*, i.number AS invoice_number, i.client_name
     FROM invoice_payments p
     LEFT JOIN invoices i ON i.id = p.invoice_id
     ORDER BY p.paid_at DESC, p.id DESC`
  ).all();

  const { results: ledger } = await c.env.DB.prepare(
    `SELECT * FROM expenses WHERE entry_type = 'income' AND (notes LIKE '%invoice_id:%' OR category = 'Encaissement client')
     ORDER BY expense_date DESC, id DESC`
  ).all();

  const { results: receipts } = await c.env.DB.prepare(`SELECT * FROM receipts ORDER BY id DESC`).all();

  const unmatchedPayments: any[] = [];
  for (const p of (payments || [])) {
    const found = (ledger || []).find((e: any) =>
      String(e.notes || '').includes(`invoice_id:${p.invoice_id}`) &&
      Math.abs(Number(e.amount) - Number(p.amount)) < 0.02
    );
    if (!found) unmatchedPayments.push(p);
  }

  const orphanLedger: any[] = [];
  for (const e of (ledger || [])) {
    const m = String(e.notes || '').match(/invoice_id:(\d+)/);
    if (m) {
      const inv = await c.env.DB.prepare(`SELECT id FROM invoices WHERE id = ?`).bind(m[1]).first();
      if (!inv) orphanLedger.push(e);
    }
  }

  // Paid invoices without receipt
  const { results: paidNoReceipt } = await c.env.DB.prepare(
    `SELECT i.id, i.number, i.client_name, i.total, i.amount_paid
     FROM invoices i
     WHERE i.status = 'paid'
       AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.invoice_id = i.id)`
  ).all();

  return c.json({
    success: true,
    data: {
      payments_count: (payments || []).length,
      ledger_income_count: (ledger || []).length,
      receipts_count: (receipts || []).length,
      unmatched_payments: unmatchedPayments,
      orphan_ledger: orphanLedger,
      paid_without_receipt: paidNoReceipt || [],
      summary: {
        ok: unmatchedPayments.length === 0 && orphanLedger.length === 0,
        message: unmatchedPayments.length || orphanLedger.length || (paidNoReceipt || []).length
          ? 'Des écarts de rapprochement ont été détectés.'
          : 'Solde et paiements sont cohérents.',
      },
    },
  });
});

/** Create missing receipts for paid invoices */
app.post('/api/ledger/fix-receipts', async (c) => {
  if (sessionUserFromHeader) {
    const role = normalizeInventoryRole(sessionUserFromHeader(c.req.header('Authorization'))?.role);
    if (!roleCanSeeFinancial(role)) {
      return c.json({ success: false, error: 'Accès réservé owner/admin.', code: 'FORBIDDEN_ROLE' }, 403);
    }
  }
  await ensureReceiptsTable(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
  if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);

  const { results: paidNoReceipt } = await c.env.DB.prepare(
    `SELECT i.* FROM invoices i
     WHERE i.status = 'paid'
       AND COALESCE(i.doc_kind, '') != 'remboursement'
       AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.invoice_id = i.id)`
  ).all();

  let created = 0;
  for (const inv of (paidNoReceipt || []) as any[]) {
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const number = await nextDocumentNumber(c.env.DB, 'receipt', settings, c.env);
    await c.env.DB.prepare(
      `INSERT INTO receipts (number, invoice_id, client_name, amount, payment_method, issue_date, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(number, inv.id, inv.client_name, inv.total, 'cash', inv.issue_date || new Date().toISOString().slice(0, 10), 'Reçu généré (rapprochement)').run();
    created++;
  }
  return c.json({ success: true, message: `${created} reçu(s) créé(s) pour factures payées sans reçu.`, count: created });
});



}

export function registerProductRequestRoutes(app: AtlasApp, deps: LedgerMiscDeps) {
  const {
    productImageFailure,
    readProductImageJson,
    sessionUserFromHeader,
    writeAudit,
  } = deps;

/* ────────────────────────────────────────────────────────────────────────────
 * Product creation requests — scan page: unknown barcode → phone user sends a
 * request (code + optional photo/name, NO price); a PC user (admin/owner) or
 * stock role creates the product later with the price.
 * ────────────────────────────────────────────────────────────────────────── */
async function ensureProductRequestsTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS product_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        photo_url TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'open',
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        closed_at TEXT,
        product_id INTEGER
      )`,
    )
    .run();
  await db
    .prepare(`CREATE INDEX IF NOT EXISTS idx_product_requests_status ON product_requests(status, id DESC)`)
    .run();
  // v1.4.5 — scan requests carry the full minimal product sheet
  await addColumnIfMissing(db, 'product_requests', 'sku', `TEXT NOT NULL DEFAULT ''`);
  await addColumnIfMissing(db, 'product_requests', 'unit', `TEXT NOT NULL DEFAULT ''`);
  await addColumnIfMissing(db, 'product_requests', 'quantity', `REAL NOT NULL DEFAULT 0`);
  await addColumnIfMissing(db, 'product_requests', 'category', `TEXT NOT NULL DEFAULT ''`);
}

/** stock / admin / owner only (phone floor operators have the stock role). */
function gateStockRole(c: any): { ok: true; username: string } | { ok: false; status: number; error: string } {
  const session = sessionUserFromHeader(c.req.header('Authorization'));
  if (!session.username) return { ok: false, status: 401, error: 'Non authentifié' };
  const role = normalizeRole(session.role || 'user');
  if (role !== 'owner' && role !== 'admin' && role !== 'stock') {
    return { ok: false, status: 403, error: 'Réservé aux rôles stock/admin/owner' };
  }
  return { ok: true, username: session.username };
}

/* v209-A (S7/M2): alert center — low stock, expired lots, overdue invoices, open requests */
app.get('/api/alerts', async (c) => {
  const gate = gateStockRole(c);
  if (!gate.ok) return c.json({ success: false, error: gate.error }, gate.status as any);
  const db = c.env.DB;
  await ensureProductRequestsTable(db);
  await db.prepare(`CREATE TABLE IF NOT EXISTS stock_lots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    lot TEXT NOT NULL DEFAULT '',
    expiry TEXT DEFAULT '',
    quantity REAL NOT NULL DEFAULT 0,
    warehouse_id INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  )`).run();
  const alerts: any[] = [];
  const today = new Date().toISOString().slice(0, 10);
  try {
    const low = await db.prepare(`SELECT id, name, sku, stock_quantity, low_stock_threshold FROM products WHERE is_active = 1 AND track_inventory = 1 AND stock_quantity <= low_stock_threshold ORDER BY stock_quantity ASC LIMIT 20`).all();
    for (const p0 of (low as any).results || []) {
      alerts.push({ kind: Number(p0.stock_quantity) <= 0 ? 'rupture' : 'stock_bas', severity: Number(p0.stock_quantity) <= 0 ? 'high' : 'medium', label: `${p0.name} — ${Number(p0.stock_quantity) <= 0 ? 'rupture' : 'stock bas'} (${p0.stock_quantity})`, href: '/products', meta: { product_id: p0.id, sku: p0.sku } });
    }
    const lots = await db.prepare(`SELECT id, product_id, lot, expiry, quantity FROM stock_lots WHERE expiry != '' AND quantity > 0`).all();
    for (const l of (lots as any).results || []) {
      if (String(l.expiry) <= today) alerts.push({ kind: 'lot_expire', severity: 'high', label: `Lot ${l.lot || l.id} expiré (produit #${l.product_id})`, href: '/products', meta: l });
      else if (String(l.expiry) <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10)) alerts.push({ kind: 'lot_bientot', severity: 'medium', label: `Lot ${l.lot || l.id} expire le ${l.expiry}`, href: '/products', meta: l });
    }
    const overdue = await db.prepare(`SELECT id, number, client_name, total, due_date FROM invoices WHERE COALESCE(doc_kind,'invoice') NOT IN ('quick_sale','ticket','remboursement') AND IFNULL(number,'') NOT LIKE 'VR-%' AND IFNULL(number,'') NOT LIKE 'WR-%' AND status != 'paid' AND status != 'cancelled' AND due_date != '' AND due_date < ? ORDER BY due_date ASC LIMIT 20`).bind(today).all();
    for (const inv of (overdue as any).results || []) {
      alerts.push({ kind: 'facture_echue', severity: 'medium', label: `${inv.number} — ${inv.client_name} échue le ${inv.due_date} (${inv.total} MAD)`, href: `/invoices/${inv.id}`, meta: inv });
    }
    const reqs = await db.prepare(`SELECT id, code, name, quantity FROM product_requests WHERE status = 'open' ORDER BY id DESC LIMIT 10`).all();
    for (const r of (reqs as any).results || []) {
      alerts.push({ kind: 'demande_produit', severity: 'low', label: `Demande scan : ${r.name} (x${r.quantity})`, href: '/products', meta: r });
    }
  } catch { /* tables may be missing on fresh DBs */ }
  const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
  alerts.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
  return c.json({ success: true, data: alerts.slice(0, 40), meta: { count: alerts.length, today } });
});

app.get('/api/stock/product-requests', async (c) => {
  const gate = gateStockRole(c);
  if (!gate.ok) return c.json({ success: false, error: gate.error }, gate.status as any);
  const status = String(c.req.query('status') || 'open');
  await ensureProductRequestsTable(c.env.DB);
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM product_requests WHERE status = ? ORDER BY id DESC LIMIT 100`,
  ).bind(status).all();
  return c.json({ success: true, data: results || [] });
});

app.post('/api/stock/product-requests', async (c) => {
  const gate = gateStockRole(c);
  if (!gate.ok) return c.json({ success: false, error: gate.error }, gate.status as any);
  let body: any = {};
  try { body = await readProductImageJson(c); } catch (e) { return productImageFailure(c, e); }
  const code = String(body.code || '').trim().slice(0, 120);
  if (!code) return c.json({ success: false, error: 'Code obligatoire' }, 400);
  const name = String(body.name || '').trim().slice(0, 120);
  const note = String(body.note || '').trim().slice(0, 500);
  const sku = String(body.sku || '').trim().slice(0, 120);
  const unit = String(body.unit || '').trim().slice(0, 40);
  const quantity = Number(body.quantity);
  const category = String(body.category || '').trim().slice(0, 120);
  // Minimal required sheet: name + unit + quantity (price stays out of scan flow)
  if (!name) return c.json({ success: false, error: 'Nom obligatoire', code: 'NAME_REQUIRED' }, 400);
  if (!unit) return c.json({ success: false, error: 'Unité obligatoire', code: 'UNIT_REQUIRED' }, 400);
  if (!Number.isFinite(quantity) || quantity < 0) {
    return c.json({ success: false, error: 'Quantité obligatoire', code: 'QTY_REQUIRED' }, 400);
  }
  let photoUrl = '';
  const dataUrl = String(body.photo_data_url || '').trim();
  if (dataUrl) {
    try { photoUrl = (await normalizeProductImageReference(c.env, 0, dataUrl)).url; }
    catch (e) { return productImageFailure(c, e); }
  }
  await ensureProductRequestsTable(c.env.DB);
  const ins = await c.env.DB.prepare(
    `INSERT INTO product_requests (code, name, note, photo_url, created_by, sku, unit, quantity, category)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(code, name, note, photoUrl, gate.username, sku || code, unit, quantity, category).run();
  const row = await c.env.DB.prepare(`SELECT * FROM product_requests WHERE id = ?`).bind(ins.meta.last_row_id).first();
  return c.json({ success: true, data: row }, 201);
});

app.post('/api/stock/product-requests/:id/close', async (c) => {
  const gate = gateStockRole(c);
  if (!gate.ok) return c.json({ success: false, error: gate.error }, gate.status as any);
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id) || id < 1) return c.json({ success: false, error: 'ID invalide' }, 400);
  let body: any = {};
  try { body = await c.req.json(); } catch { body = {}; }
  const status = body.status === 'done' ? 'done' : 'dismissed';
  const productId = Number(body.product_id || 0) || null;
  await ensureProductRequestsTable(c.env.DB);
  await c.env.DB.prepare(
    `UPDATE product_requests SET status = ?, product_id = ?, closed_at = datetime('now') WHERE id = ?`,
  ).bind(status, productId, id).run();
  return c.json({ success: true, data: { id, status, product_id: productId } });
});
}

