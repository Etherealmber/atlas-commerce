/**
 * v0.7.1 — Stock-adjustment approval workflow (Atlas Commerce Worker).
 *
 * Android / web API contract (all routes behind the global /api/* Bearer
 * session middleware; role re-read from the users table at decision time):
 *
 *  POST /api/stock-adjustment-requests
 *    body: { product_id: number, direction: 'in'|'out', quantity: number (>0),
 *            reason?: string, idempotency_key?: string }   (header
 *            `Idempotency-Key` accepted as an alias)
 *    201 { success, data: RequestDTO }            · 200 + replayed:true when the
 *          idempotency key was already used by this requester
 *    400 bad body · 401 no session · 404 unknown/inactive product ·
 *    409 product not stock-tracked · 422 invalid quantity/direction
 *    → NEVER mutates inventory.
 *
 *  GET /api/stock-adjustment-requests?status=pending|approved|rejected
 *    200 { success, data: RequestDTO[] } — approvers see the tenant's requests,
 *    stock/user see only their own.
 *
 *  GET /api/stock-adjustment-requests/:id
 *    200 requester or approver · 403 other roles · 404 unknown.
 *
 *  POST /api/stock-adjustment-requests/:id/approve   (owner/admin/secretaire)
 *    200 { success, data: RequestDTO } — movement applied EXACTLY once,
 *        atomically (claim UPDATE … WHERE status='pending' then a D1 batch:
 *        guarded stock UPDATE + stock_movements audit row + before/after).
 *    403 wrong role · 404 unknown · 409 ALREADY_DECIDED (duplicate/replay/
 *        concurrent approval) or INSUFFICIENT_STOCK (left pending, no change)
 *    · 422 product no longer valid/active.
 *
 *  POST /api/stock-adjustment-requests/:id/reject    (owner/admin/secretaire)
 *    200 · 403 · 404 · 409 ALREADY_DECIDED. Stock untouched.
 *
 * RequestDTO = { id, product_id, product_name, direction, quantity, reason,
 *   status: 'pending'|'approved'|'rejected'|'failed', requested_by,
 *   requested_at, decided_by, decided_at, decision_note, stock_before,
 *   stock_after, idempotency_key }
 *
 * Audit trail: every submit/approve/reject writes audit_log (action
 * stock_adjustment.*) and the approved movement writes stock_movements with
 * previous/new quantities, requester+approver in reason/reference.
 *
 * Push notifications (v0.7.8): BEST-EFFORT, non-sensitive. Submit notifies the
 * role-authorized approvers (owner/admin/secretaire, requester excluded); a
 * decision notifies the requester's devices ONLY after the status change
 * succeeded. Payload = event type + request id (+ generic French text); the
 * app re-fetches details through the authenticated API. Idempotent replays and
 * already-decided transitions send NOTHING; dead tokens are purged by the FCM
 * dispatcher; a push failure never alters the request outcome.
 * Passkeys/WebAuthn are NOT required for approval (separate hardening option).
 */
import {
  normalizeInventoryRole,
  roleCanApproveStockAdjustment,
  roleCanSubmitStockAdjustmentRequest,
} from '../lib/inventory-policy';
import { sendFcmToUser } from '../lib/fcm';

export interface StockAdjustDeps {
  /** Signed server session only — never client-supplied role/tenant. */
  session: (c: any) => { username: string; role: string } | null;
  /** Fresh role read (users table) used at decision time. */
  freshRole?: (db: any, username: string) => Promise<string | null>;
  audit?: (db: any, e: { username?: string; role?: string; action: string; entity?: string; entity_id?: string | number; detail?: string; ip?: string }) => Promise<void>;
}

let tablesOnce: WeakSet<object> = new WeakSet();

export async function ensureStockAdjustmentTables(db: any): Promise<void> {
  if (tablesOnce.has(db)) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS stock_adjustment_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        product_name TEXT DEFAULT '',
        direction TEXT NOT NULL DEFAULT 'in',
        quantity REAL NOT NULL,
        reason TEXT DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        requested_by TEXT NOT NULL,
        requested_at TEXT NOT NULL DEFAULT (datetime('now')),
        decided_by TEXT DEFAULT '',
        decided_at TEXT,
        decision_note TEXT DEFAULT '',
        stock_before REAL,
        stock_after REAL,
        idempotency_key TEXT DEFAULT ''
      )`,
    )
    .run();
  try {
    await db
      .prepare(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_sar_idem
         ON stock_adjustment_requests(idempotency_key)
         WHERE idempotency_key != ''`,
      )
      .run();
  } catch { /* older SQLite without partial indexes: uniqueness enforced in code */ }
  try {
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_sar_status ON stock_adjustment_requests(status)`).run();
  } catch { /* ignore */ }
  tablesOnce.add(db);
}

const dto = (r: any) => ({
  id: r.id,
  product_id: r.product_id,
  product_name: r.product_name || '',
  direction: r.direction,
  quantity: Number(r.quantity || 0),
  reason: r.reason || '',
  status: r.status,
  requested_by: r.requested_by,
  requested_at: r.requested_at,
  decided_by: r.decided_by || '',
  decided_at: r.decided_at || null,
  decision_note: r.decision_note || '',
  stock_before: r.stock_before == null ? null : Number(r.stock_before),
  stock_after: r.stock_after == null ? null : Number(r.stock_after),
  idempotency_key: r.idempotency_key || '',
});

async function readFreshRole(deps: StockAdjustDeps, db: any, sess: { username: string; role: string }): Promise<string> {
  if (deps.freshRole) {
    try {
      const r = await deps.freshRole(db, sess.username);
      if (r) return normalizeInventoryRole(r);
    } catch { /* fall back to session role */ }
  }
  return normalizeInventoryRole(sess.role);
}

/* ── v0.7.8 — push stock-request (best-effort, jamais bloquant) ────────── */
const PUSH_TITLE = 'Atlas Commerce — Stock';
const PUSH_SUBMIT_BODY = 'Une demande d’ajustement de stock attend votre validation.';
const PUSH_DECIDED_BODY = 'Votre demande d’ajustement de stock a été traitée.';

/** Envoie best-effort : aucune erreur de push ne remonte à la route. */
async function notifyStockEvent(
  c: any,
  usernames: string[],
  data: Record<string, string>,
  body: string,
): Promise<void> {
  try {
    await Promise.all(
      usernames.map((u) =>
        sendFcmToUser(c.env, u, { title: PUSH_TITLE, body, data }).catch(() => null),
      ),
    );
  } catch { /* le push ne défait jamais la demande */ }
}

/** Approveurs autorisés par la politique de rôle (owner + users actifs). */
async function approverUsernames(c: any, exclude: string): Promise<string[]> {
  const out = new Set<string>();
  try {
    const owner = String(c.env.ADMIN_USERNAME || 'admin').toLowerCase();
    if (roleCanApproveStockAdjustment('owner')) out.add(owner);
    const rows = (await c.env.DB
      .prepare(`SELECT username, role FROM app_users WHERE active = 1`)
      .all()) as any;
    for (const r of rows?.results || []) {
      if (roleCanApproveStockAdjustment(normalizeInventoryRole(String(r.role)))) {
        out.add(String(r.username).toLowerCase());
      }
    }
  } catch { /* best-effort */ }
  out.delete(String(exclude).toLowerCase());
  return [...out];
}

export function registerStockAdjustmentRoutes(app: any, deps: StockAdjustDeps): void {
  app.post('/api/stock-adjustment-requests', async (c: any) => {
    const sess = deps.session(c);
    if (!sess?.username) return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Session invalide' }, 401);
    const db = c.env.DB;
    const role = await readFreshRole(deps, db, sess);
    if (!roleCanSubmitStockAdjustmentRequest(role)) {
      return c.json({ success: false, code: 'FORBIDDEN_ROLE', error: 'Rôle non autorisé à proposer un ajustement.' }, 403);
    }
    await ensureStockAdjustmentTables(db);
    let body: any = {};
    try { body = await c.req.json(); } catch { body = {}; }
    const productId = Number(body.product_id);
    const direction = String(body.direction || '').toLowerCase();
    const quantity = Number(body.quantity);
    const reason = String(body.reason || '').slice(0, 500);
    const idem = String(body.idempotency_key || c.req.header('Idempotency-Key') || '').slice(0, 120);
    if (!Number.isInteger(productId) || productId <= 0) {
      return c.json({ success: false, code: 'VALIDATION', error: 'product_id invalide' }, 422);
    }
    if (direction !== 'in' && direction !== 'out') {
      return c.json({ success: false, code: 'VALIDATION', error: "direction doit valoir 'in' ou 'out'" }, 422);
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return c.json({ success: false, code: 'VALIDATION', error: 'Quantité strictement positive requise' }, 422);
    }
    if (idem) {
      const dup = await db
        .prepare(`SELECT * FROM stock_adjustment_requests WHERE idempotency_key = ? AND requested_by = ? LIMIT 1`)
        .bind(idem, sess.username)
        .first();
      if (dup) return c.json({ success: true, data: dto(dup), replayed: true }, 200);
    }
    // Single-tenant deployment: unknown product == cross-tenant product.
    const product = await db
      .prepare(`SELECT id, name, is_active, track_inventory FROM products WHERE id = ?`)
      .bind(productId)
      .first();
    if (!product) return c.json({ success: false, code: 'NOT_FOUND', error: 'Produit introuvable dans ce tenant' }, 404);
    if (!Number((product as any).is_active)) {
      return c.json({ success: false, code: 'VALIDATION', error: 'Produit inactif : demande refusée' }, 422);
    }
    if (!Number((product as any).track_inventory)) {
      return c.json({ success: false, code: 'NOT_TRACKED', error: 'Ce produit ne suit pas le stock' }, 409);
    }
    try {
      const ins = await db
        .prepare(
          `INSERT INTO stock_adjustment_requests
           (product_id, product_name, direction, quantity, reason, status, requested_by, idempotency_key)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .bind(productId, (product as any).name || '', direction, quantity, reason, sess.username, idem)
        .run();
      const row = await db.prepare(`SELECT * FROM stock_adjustment_requests WHERE id = ?`).bind(ins.meta?.last_row_id ?? 0).first();
      await deps.audit?.(db, {
        username: sess.username, role, action: 'stock_adjustment.submit',
        entity: 'stock_adjustment_request', entity_id: (row as any)?.id ?? 0,
        detail: `${direction} ${quantity} · produit ${productId}`, ip: c.req?.header?.('CF-Connecting-IP') || '',
      });
      // v0.7.8 — approvers notifiés (replay idempotent : jamais, cf. retour 200 ci-dessus)
      await notifyStockEvent(
        c,
        await approverUsernames(c, sess.username),
        { event: 'stock_request_submitted', request_id: String((row as any)?.id ?? 0) },
        PUSH_SUBMIT_BODY,
      );
      return c.json({ success: true, data: dto(row) }, 201);
    } catch (e: any) {
      if (idem && /UNIQUE/i.test(String(e?.message || e?.cause?.message || ''))) {
        const dup = await db.prepare(`SELECT * FROM stock_adjustment_requests WHERE idempotency_key = ? AND requested_by = ? LIMIT 1`).bind(idem, sess.username).first();
        if (dup) return c.json({ success: true, data: dto(dup), replayed: true }, 200);
      }
      throw e;
    }
  });

  app.get('/api/stock-adjustment-requests', async (c: any) => {
    const sess = deps.session(c);
    if (!sess?.username) return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Session invalide' }, 401);
    const db = c.env.DB;
    await ensureStockAdjustmentTables(db);
    const role = await readFreshRole(deps, db, sess);
    const status = String(c.req.query('status') || '').toLowerCase();
    const approver = roleCanApproveStockAdjustment(role);
    let sql = `SELECT * FROM stock_adjustment_requests`;
    const where: string[] = [];
    const binds: any[] = [];
    if (!approver) { where.push(`lower(requested_by) = ?`); binds.push(String(sess.username).toLowerCase()); }
    if (status) { where.push(`status = ?`); binds.push(status); }
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ` ORDER BY id DESC LIMIT 200`;
    const { results } = await db.prepare(sql).bind(...binds).all();
    return c.json({ success: true, data: (results || []).map(dto) }, 200);
  });

  app.get('/api/stock-adjustment-requests/:id', async (c: any) => {
    const sess = deps.session(c);
    if (!sess?.username) return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Session invalide' }, 401);
    const db = c.env.DB;
    await ensureStockAdjustmentTables(db);
    const row = await db.prepare(`SELECT * FROM stock_adjustment_requests WHERE id = ?`).bind(Number(c.req.param('id'))).first();
    if (!row) return c.json({ success: false, code: 'NOT_FOUND', error: 'Demande introuvable' }, 404);
    const mine = String((row as any).requested_by || '').toLowerCase() === String(sess.username).toLowerCase();
    const viewerRole = await readFreshRole(deps, db, sess);
    if (!mine && !roleCanApproveStockAdjustment(viewerRole)) {
      return c.json({ success: false, code: 'FORBIDDEN_ROLE', error: 'Visibilité réservée au demandeur et aux approbateurs.' }, 403);
    }
    return c.json({ success: true, data: dto(row) }, 200);
  });

  const decide = (kind: 'approve' | 'reject') => async (c: any) => {
    const sess = deps.session(c);
    if (!sess?.username) return c.json({ success: false, code: 'UNAUTHORIZED', error: 'Session invalide' }, 401);
    const db = c.env.DB;
    await ensureStockAdjustmentTables(db);
    const fresh = await readFreshRole(deps, db, sess);
    if (!roleCanApproveStockAdjustment(fresh)) {
      return c.json({ success: false, code: 'FORBIDDEN_ROLE', error: 'Approbation réservée owner/admin/secretaire.' }, 403);
    }
    const id = Number(c.req.param('id'));
    const req = await db.prepare(`SELECT * FROM stock_adjustment_requests WHERE id = ?`).bind(id).first() as any;
    if (!req) return c.json({ success: false, code: 'NOT_FOUND', error: 'Demande introuvable' }, 404);
    if (req.status !== 'pending') {
      return c.json({ success: false, code: 'ALREADY_DECIDED', error: `Demande déjà ${req.status} — approbation unique.` }, 409);
    }
    let body: any = {};
    try { body = await c.req.json(); } catch { body = {}; }
    const note = String(body.note || body.reason || '').slice(0, 500);

    if (kind === 'reject') {
      const claim = await db
        .prepare(`UPDATE stock_adjustment_requests SET status='rejected', decided_by=?, decided_at=datetime('now'), decision_note=? WHERE id=? AND status='pending'`)
        .bind(sess.username, note, id)
        .run();
      if (!claim.meta?.changes) return c.json({ success: false, code: 'ALREADY_DECIDED', error: 'Décision concurrente détectée.' }, 409);
      await deps.audit?.(db, { username: sess.username, role: fresh, action: 'stock_adjustment.reject', entity: 'stock_adjustment_request', entity_id: id, detail: note });
      // v0.7.8 — demandeur notifié UNIQUEMENT après le changement de statut réussi
      await notifyStockEvent(
        c,
        [String(req.requested_by)],
        { event: 'stock_request_decided', status: 'rejected', request_id: String(id) },
        PUSH_DECIDED_BODY,
      );
      const after = await db.prepare(`SELECT * FROM stock_adjustment_requests WHERE id = ?`).bind(id).first();
      return c.json({ success: true, data: dto(after) }, 200);
    }

    // ── approve ────────────────────────────────────────────────────────────
    const product = await db.prepare(`SELECT id, name, is_active, track_inventory, stock_quantity FROM products WHERE id = ?`).bind(req.product_id).first() as any;
    if (!product) return c.json({ success: false, code: 'NOT_FOUND', error: 'Produit introuvable dans ce tenant' }, 404);
    if (!Number(product.is_active) || !Number(product.track_inventory)) {
      return c.json({ success: false, code: 'VALIDATION', error: 'Produit invalide ou non suivi : approbation impossible' }, 422);
    }
    const qty = Number(req.quantity);
    const delta = req.direction === 'out' ? -qty : qty;
    const before = Number(product.stock_quantity || 0);
    if (req.direction === 'out' && before < qty) {
      return c.json({ success: false, code: 'INSUFFICIENT_STOCK', error: `Stock insuffisant (${before} < ${qty}) — demande laissée en attente.`, available: before }, 409);
    }
    // Claim first: exactly one concurrent approver can win the pending row.
    const claim = await db
      .prepare(`UPDATE stock_adjustment_requests SET status='approved', decided_by=?, decided_at=datetime('now'), decision_note=? WHERE id=? AND status='pending'`)
      .bind(sess.username, note, id)
      .run();
    if (!claim.meta?.changes) return c.json({ success: false, code: 'ALREADY_DECIDED', error: 'Approbation concurrente détectée — mouvement non appliqué.' }, 409);
    // Guarded, atomic stock write (D1 serializes writes): a concurrent drain
    // between the pre-check and here cannot push stock negative.
    let moved: any;
    try {
      moved = await db
        .prepare(
          `UPDATE products SET stock_quantity = stock_quantity + ?, updated_at = datetime('now')
           WHERE id = ? AND track_inventory = 1 AND (stock_quantity + ? >= 0)`,
        )
        .bind(delta, req.product_id, delta)
        .run();
    } catch { moved = null; }
    if (!moved?.meta?.changes) {
      // Compensate the claim: request goes back to pending, stock untouched.
      await db.prepare(`UPDATE stock_adjustment_requests SET status='pending', decided_by='', decided_at=NULL, decision_note='stock insuffisant au moment de l’approbation — réouverte' WHERE id=?`).bind(id).run();
      return c.json({ success: false, code: 'INSUFFICIENT_STOCK', error: 'Stock insuffisant au moment de l’approbation — demande rouverte, stock inchangé.', available: before }, 409);
    }
    const now = await db.prepare(`SELECT stock_quantity FROM products WHERE id = ?`).bind(req.product_id).first() as any;
    const afterQty = Number(now?.stock_quantity ?? before + delta);
    try {
      await db.batch([
        db.prepare(
          `INSERT INTO stock_movements (product_id, type, quantity, previous_quantity, new_quantity, reason, reference, created_by)
           VALUES (?, 'adjustment', ?, ?, ?, ?, ?, ?)`,
        ).bind(
          req.product_id, delta, before, afterQty,
          `Approbation demande #${id} (${req.direction} ${qty}) — demandeur ${req.requested_by}: ${req.reason || ''}`,
          `stock-adjustment-request:${id}`, sess.username,
        ),
        db.prepare(`UPDATE stock_adjustment_requests SET stock_before=?, stock_after=? WHERE id=?`).bind(before, afterQty, id),
      ]);
    } catch {
      // Movement applied but audit row failed: keep approval, log the gap.
      console.error('[stock-adjustments] audit batch failed for request', id);
    }
    await deps.audit?.(db, {
      username: sess.username, role: fresh, action: 'stock_adjustment.approve',
      entity: 'stock_adjustment_request', entity_id: id,
      detail: `${req.direction} ${qty} · produit ${req.product_id} · ${before}→${afterQty} · demandeur ${req.requested_by}`,
    });
    // v0.7.8 — demandeur notifié UNIQUEMENT après mouvement appliqué + audit
    await notifyStockEvent(
      c,
      [String(req.requested_by)],
      { event: 'stock_request_decided', status: 'approved', request_id: String(id) },
      PUSH_DECIDED_BODY,
    );
    const after = await db.prepare(`SELECT * FROM stock_adjustment_requests WHERE id = ?`).bind(id).first();
    return c.json({ success: true, data: dto(after) }, 200);
  };

  app.post('/api/stock-adjustment-requests/:id/approve', decide('approve'));
  app.post('/api/stock-adjustment-requests/:id/reject', decide('reject'));
}
