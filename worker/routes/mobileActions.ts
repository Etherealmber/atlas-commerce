import type { Hono } from 'hono';
import { invalidateDashboardCache } from '../lib/cache';
import { afterBusinessMutation } from '../lib/delete-coord';
import { canMutateBusiness, normalizeRole } from '../lib/rbac';

export interface MobileActionsRouteDeps {
  schemaOnce: (key: string, fn: () => Promise<void>) => Promise<void>;
  refreshLimitGate: (c: any, endpoint: string, maxPerMinute?: number) => Response | null;
  readProductImageJson: (c: any) => Promise<any>;
  productImageFailure: (c: any, e: unknown) => Response;
  normalizeProductImageReference: (env: any, productId: any, source: string) => Promise<{ url: string }>;
  sessionUserFromHeader: (authHeader?: string) => { username?: string; role?: string };
  syncMobileHub: (env: any, extra?: { lastBarcode?: string | null; lastProductId?: number | null }) => Promise<void>;
  syncMobileHubPending: (env: any) => Promise<void>;
  applyStockDelta: (db: D1Database, productId: number, delta: number, reason: string, ref: string, opts?: any) => Promise<any>;
  notifyAssistApproval: (env: any, target: string, title: string, body: string, data: any) => Promise<any>;
  requireBizMutator: (c: any) => { ok: true; username: string; role: string } | { ok: false; response: Response };
  requireFloorStock: (c: any) => { ok: true; username: string; role?: string } | { ok: false; response: Response };
}

export function registerMobileActionsRoutes(app: Hono<any>, deps: MobileActionsRouteDeps): void {
  const {
    schemaOnce,
    refreshLimitGate,
    readProductImageJson,
    productImageFailure,
    normalizeProductImageReference,
    sessionUserFromHeader,
    syncMobileHub,
    syncMobileHubPending,
    applyStockDelta,
    notifyAssistApproval,
    requireBizMutator,
    requireFloorStock,
  } = deps;

  async function ensureMobileActionsTable(db: D1Database) {
    await schemaOnce('ensureMobileActionsTable', async () => {
      await db.prepare(`
        CREATE TABLE IF NOT EXISTS mobile_actions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL CHECK(type IN ('scan','stock_check','new_product','invoice')),
          title TEXT NOT NULL,
          detail TEXT DEFAULT '',
          barcode TEXT DEFAULT '',
          product_id INTEGER,
          status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','cancelled')),
          source TEXT DEFAULT 'mobile',
          created_by TEXT DEFAULT '',
          completed_by TEXT DEFAULT '',
          completed_at TEXT,
          meta_json TEXT DEFAULT '{}',
          created_at TEXT DEFAULT (datetime('now'))
        )
      `).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_mobile_actions_status ON mobile_actions(status)`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_mobile_actions_created ON mobile_actions(created_at DESC)`).run();
    });
  }

  /** List actions for PC inbox / phone "sent today" */
  app.get('/api/mobile-actions', async (c) => {
    const limited = refreshLimitGate(c, 'mobile-actions', 60);
    if (limited) return limited;
    await ensureMobileActionsTable(c.env.DB);
    const status = c.req.query('status');
    const limit = Math.min(Number(c.req.query('limit') || 50), 200);
    const compact = c.req.query('compact') !== '0';
    let sql = `SELECT * FROM mobile_actions`;
    const binds: any[] = [];
    if (status && status !== 'all') {
      sql += ` WHERE status = ?`;
      binds.push(status);
    }
    sql += ` ORDER BY datetime(created_at) DESC LIMIT ?`;
    binds.push(limit);
    const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
    const rows = (results || []).map((row: any) => {
      if (!compact || !row?.meta_json) return row;
      try {
        const meta = JSON.parse(row.meta_json);
        let hasImage = false;
        const slim: any = { ...meta };
        if (typeof slim.image_data_url === 'string' && slim.image_data_url.length > 40) {
          hasImage = true;
          slim.has_image = true;
          delete slim.image_data_url;
        }
        if (slim.create_product_body && typeof slim.create_product_body === 'object') {
          slim.create_product_body = { ...slim.create_product_body };
          if (typeof slim.create_product_body.image_data_url === 'string' && slim.create_product_body.image_data_url.length > 40) {
            hasImage = true;
            slim.create_product_body.has_image = true;
            delete slim.create_product_body.image_data_url;
          }
        }
        return { ...row, meta_json: JSON.stringify(slim), has_image: hasImage };
      } catch {
        return row;
      }
    });
    return c.json({ success: true, data: rows, meta: { compact } }, 200, {
      'Cache-Control': 'private, max-age=8',
    });
  });

  app.get('/api/mobile-actions/stats', async (c) => {
    const limited = refreshLimitGate(c, 'mobile-actions-stats', 60);
    if (limited) return limited;
    await ensureMobileActionsTable(c.env.DB);
    let pendingN: number | null = null;
    try {
      if (c.env.MOBILE_HUB) {
        const id = c.env.MOBILE_HUB.idFromName('atlas-main');
        const stub = c.env.MOBILE_HUB.get(id);
        const res = await stub.fetch('https://do/stats');
        if (res.ok) {
          const j = await res.json() as any;
          if (j?.data?.pending != null) pendingN = Number(j.data.pending);
        }
      }
    } catch { /* fall through to D1 */ }
    if (pendingN == null) {
      const pending = await c.env.DB.prepare(
        `SELECT COUNT(*) as n FROM mobile_actions WHERE status = 'pending'`,
      ).first() as any;
      pendingN = Number(pending?.n || 0);
    }
    const today = await c.env.DB.prepare(
      `SELECT COUNT(*) as n FROM mobile_actions WHERE date(created_at) = date('now')`,
    ).first() as any;
    return c.json({
      success: true,
      data: {
        pending: pendingN,
        today: Number(today?.n || 0),
        source: pendingN != null ? 'do-or-d1' : 'd1',
      },
    });
  });

  app.get('/api/mobile-actions/:id', async (c) => {
    await ensureMobileActionsTable(c.env.DB);
    const id = Number(c.req.param('id'));
    if (!id) return c.json({ success: false, error: 'id invalide' }, 400);
    const row = await c.env.DB.prepare(`SELECT * FROM mobile_actions WHERE id = ?`).bind(id).first();
    if (!row) return c.json({ success: false, error: 'Action introuvable' }, 404);
    return c.json({ success: true, data: row });
  });

  /** Phone creates a handoff (scan unknown, stock check, new product request, invoice draft) */
  app.post('/api/mobile-actions', async (c) => {
    await ensureMobileActionsTable(c.env.DB);
    let body: any;
    try { body = await readProductImageJson(c); } catch (e) { return productImageFailure(c, e); }
    const type = String(body.type || 'scan');
    if (!['scan', 'stock_check', 'new_product', 'invoice'].includes(type)) {
      return c.json({ success: false, error: 'type invalide' }, 400);
    }
    {
      const session = sessionUserFromHeader(c.req.header('Authorization'));
      if (normalizeRole(session.role) === 'stock' && type === 'invoice') {
        return c.json({
          success: false,
          error: 'Rôle magasinier : pas de vente rapide / facture. Demandez à un secrétaire.',
          code: 'FORBIDDEN_ROLE',
        }, 403);
      }
    }
    const title = String(body.title || '').trim();
    if (!title) return c.json({ success: false, error: 'title obligatoire' }, 400);
    const detail = String(body.detail || '');
    const barcode = String(body.barcode || '');
    const product_id = body.product_id != null ? Number(body.product_id) : null;
    let meta: any = body.meta && typeof body.meta === 'object' ? { ...body.meta } : {};
    try {
      const rawImg =
        (typeof meta.image_data_url === 'string' && meta.image_data_url) ||
        (meta.create_product_body && typeof meta.create_product_body.image_data_url === 'string'
          ? meta.create_product_body.image_data_url
          : '') ||
        '';
      if (rawImg) {
        const cdn = (await normalizeProductImageReference(c.env, product_id || 0, rawImg)).url;
        if (cdn) {
          meta.image_url = cdn;
          meta.has_image = true;
          delete meta.image_data_url;
          if (meta.create_product_body && typeof meta.create_product_body === 'object') {
            meta.create_product_body = { ...meta.create_product_body };
            meta.create_product_body.image_url = cdn;
            delete meta.create_product_body.image_data_url;
          }
        }
      }
    } catch (e) {
      return productImageFailure(c, e);
    }
    const meta_json = JSON.stringify(meta || {});
    const created_by = sessionUserFromHeader(c.req.header('Authorization')).username || '';
    const source = String(body.source || 'mobile').toLowerCase().slice(0, 32);
    const sourceNorm = ['android', 'web', 'mobile', 'assist'].includes(source) ? source : 'mobile';
    const r = await c.env.DB.prepare(
      `INSERT INTO mobile_actions (type, title, detail, barcode, product_id, status, source, created_by, meta_json)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    ).bind(type, title, detail, barcode, product_id, sourceNorm, created_by, meta_json).run();
    const row = await c.env.DB.prepare(`SELECT * FROM mobile_actions WHERE id = ?`).bind(r.meta.last_row_id).first();
    await syncMobileHub(c.env, {
      lastBarcode: barcode || null,
      lastProductId: product_id,
    });
    return c.json({ success: true, data: row }, 201);
  });

  /** PC operator completes a handoff (optionally applies stock from mobile count) */
  app.post('/api/mobile-actions/:id/complete', async (c) => {
    await ensureMobileActionsTable(c.env.DB);
    const id = Number(c.req.param('id'));
    if (!id) return c.json({ success: false, error: 'id invalide' }, 400);
    const body = await c.req.json().catch(() => ({}));
    const completed_by = sessionUserFromHeader(c.req.header('Authorization')).username || '';
    const existing = await c.env.DB.prepare(`SELECT * FROM mobile_actions WHERE id = ?`).bind(id).first() as any;
    if (!existing) return c.json({ success: false, error: 'Action introuvable' }, 404);
    if (existing.status === 'done') return c.json({ success: true, data: existing, message: 'Déjà traitée' });

    let metaParsed: any = {};
    try { metaParsed = existing.meta_json ? JSON.parse(existing.meta_json) : {}; } catch { /* */ }
    if (body.apply_stock && metaParsed.cycle_batch && Array.isArray(metaParsed.lines)) {
      for (const line of metaParsed.lines.slice(0, 200)) {
        const productId = Number(line.product_id);
        const counted = Number(line.counted_qty);
        if (!productId || !Number.isFinite(counted) || counted < 0) continue;
        const prod = await c.env.DB.prepare(
          `SELECT stock_quantity, track_inventory, name FROM products WHERE id = ?`,
        ).bind(productId).first() as any;
        if (!prod?.track_inventory) continue;
        const prev = Number(prod.stock_quantity || 0);
        const delta = counted - prev;
        if (Math.abs(delta) > 1e-9) {
          await applyStockDelta(
            c.env.DB,
            productId,
            delta,
            `Inventaire lot mobile → PC (${prev}→${counted})`,
            `mobile_action:${id}`,
            { createdBy: completed_by, approvedBy: completed_by, type: 'adjustment', allowNegative: true, env: c.env },
          );
        }
      }
    } else if (body.apply_stock && (body.product_id || existing.product_id)) {
      const productId = Number(body.product_id || existing.product_id);
      let proposed = body.proposed_stock != null ? Number(body.proposed_stock) : NaN;
      if (!Number.isFinite(proposed) && metaParsed.proposed_stock != null) {
        proposed = Number(metaParsed.proposed_stock);
      }
      if (Number.isFinite(proposed) && proposed >= 0 && productId) {
        const prod = await c.env.DB.prepare(
          `SELECT stock_quantity, track_inventory FROM products WHERE id = ?`,
        ).bind(productId).first() as any;
        if (prod) {
          const prev = Number(prod.stock_quantity || 0);
          const delta = proposed - prev;
          if (Math.abs(delta) > 1e-9) {
            await applyStockDelta(
              c.env.DB,
              productId,
              delta,
              'Ajustement stock (mobile → PC)',
              `mobile_action:${id}`,
              { createdBy: completed_by, approvedBy: completed_by, type: 'adjustment', allowNegative: false, env: c.env },
            );
          } else {
            await c.env.DB.prepare(
              `UPDATE products SET updated_at = datetime('now') WHERE id = ?`,
            ).bind(productId).run();
          }
        }
      }
    }

    await c.env.DB.prepare(
      `UPDATE mobile_actions SET status = 'done', completed_by = ?, completed_at = datetime('now') WHERE id = ?`,
    ).bind(completed_by, id).run();
    if (body.apply_stock) {
      await invalidateDashboardCache(c.env.CACHE, c.env.MOBILE_HUB);
    }
    await syncMobileHubPending(c.env);
    const row = await c.env.DB.prepare(`SELECT * FROM mobile_actions WHERE id = ?`).bind(id).first() as any;
    try {
      const target = String(existing.created_by || '').trim();
      if (target) {
        await notifyAssistApproval(
          c.env,
          target,
          'Action validée',
          String(existing.title || 'Votre demande a été traitée sur le PC.'),
          { type: 'action_approved', action_id: String(id) },
        );
      }
    } catch (e) {
      console.error('action_approved_push', e);
    }
    return c.json({ success: true, data: row });
  });

  /** PC rejects a handoff — phone sees cancelled + reason */
  app.post('/api/mobile-actions/:id/reject', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    await ensureMobileActionsTable(c.env.DB);
    const id = Number(c.req.param('id'));
    if (!id) return c.json({ success: false, error: 'id invalide' }, 400);
    const body = await c.req.json().catch(() => ({}));
    const reason = String(body.reason || body.reject_reason || '').trim().slice(0, 400);
    if (!reason) return c.json({ success: false, error: 'Motif de refus obligatoire' }, 400);
    const existing = await c.env.DB.prepare(`SELECT * FROM mobile_actions WHERE id = ?`).bind(id).first() as any;
    if (!existing) return c.json({ success: false, error: 'Action introuvable' }, 404);
    if (existing.status === 'done') {
      return c.json({ success: false, error: 'Déjà traitée — impossible de refuser' }, 400);
    }
    if (existing.status === 'cancelled') {
      return c.json({ success: true, data: existing, message: 'Déjà refusée' });
    }
    let meta: any = {};
    try { meta = existing.meta_json ? JSON.parse(existing.meta_json) : {}; } catch { meta = {}; }
    meta.reject_reason = reason;
    meta.rejected_at = new Date().toISOString();
    meta.rejected_by = gate.username;
    await c.env.DB.prepare(
      `UPDATE mobile_actions
       SET status = 'cancelled', completed_by = ?, completed_at = datetime('now'), meta_json = ?,
           detail = CASE WHEN detail IS NULL OR detail = '' THEN ? ELSE detail || ' | Refus: ' || ? END
       WHERE id = ?`,
    ).bind(gate.username, JSON.stringify(meta), `Refus: ${reason}`, reason, id).run();
    await syncMobileHubPending(c.env);
    const row = await c.env.DB.prepare(`SELECT * FROM mobile_actions WHERE id = ?`).bind(id).first();
    return c.json({ success: true, data: row, message: 'Demande refusée.' });
  });

  app.post('/api/inventory/cycle-count/batch', async (c) => {
    const gate = requireFloorStock(c);
    if (!gate.ok) return gate.response;
    const body = await c.req.json().catch(() => ({}));
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!lines.length) return c.json({ success: false, error: 'Aucune ligne à compter' }, 400);
    const note = String(body.note || 'Inventaire lot').slice(0, 200);
    const forceApply = body.apply === true && canMutateBusiness(gate.role);

    if (!forceApply) {
      await ensureMobileActionsTable(c.env.DB);
      const detail = lines
        .slice(0, 40)
        .map((l: any) => `p${l.product_id}=${l.counted_qty}`)
        .join('; ');
      const r = await c.env.DB.prepare(
        `INSERT INTO mobile_actions (type, title, detail, barcode, product_id, status, source, created_by, meta_json)
         VALUES ('stock_check', ?, ?, '', NULL, 'pending', 'mobile', ?, ?)`,
      ).bind(
        `Inventaire ${lines.length} produit(s)`,
        detail.slice(0, 500),
        gate.username,
        JSON.stringify({ cycle_batch: true, lines, note }),
      ).run();
      await syncMobileHubPending(c.env);
      const row = await c.env.DB.prepare(`SELECT * FROM mobile_actions WHERE id = ?`).bind(r.meta.last_row_id).first();
      return c.json({ success: true, data: row, message: 'Inventaire envoyé au PC pour validation.', queued: true }, 201);
    }

    const results: any[] = [];
    for (const line of lines.slice(0, 200)) {
      const productId = Number(line.product_id);
      const counted = Number(line.counted_qty);
      if (!productId || !Number.isFinite(counted) || counted < 0) continue;
      const prod = await c.env.DB.prepare(`SELECT stock_quantity, track_inventory, name FROM products WHERE id = ?`).bind(productId).first() as any;
      if (!prod?.track_inventory) continue;
      const theoretical = Number(prod.stock_quantity || 0);
      const delta = counted - theoretical;
      if (Math.abs(delta) < 1e-9) {
        results.push({ product_id: productId, delta: 0 });
        continue;
      }
      await applyStockDelta(c.env.DB, productId, delta, `Inventaire ${theoretical}→${counted} — ${note}`, 'cycle-count', {
        type: 'adjustment',
        allowNegative: true,
        createdBy: gate.username,
        env: c.env,
      });
      results.push({ product_id: productId, delta, counted, theoretical });
    }
    await afterBusinessMutation(c.env.CACHE);
    return c.json({ success: true, data: results, message: `${results.length} ligne(s) inventoriée(s).` });
  });

  /** Dashboard counters including pending mobile handoffs */
  app.get('/api/hub/snapshot', async (c) => {
    const limited = refreshLimitGate(c, 'hub-snapshot', 60);
    if (limited) return limited;
    try {
      if (c.env.MOBILE_HUB) {
        const id = c.env.MOBILE_HUB.idFromName('atlas-main');
        const stub = c.env.MOBILE_HUB.get(id);
        const res = await stub.fetch('https://do/snapshot');
        if (res.ok) {
          const j = await res.json() as any;
          return c.json({ success: true, data: j.data || j, meta: { source: 'do' } });
        }
      }
    } catch { /* fall through */ }
    await ensureMobileActionsTable(c.env.DB);
    const pending = await c.env.DB.prepare(`SELECT COUNT(*) as n FROM mobile_actions WHERE status = 'pending'`).first() as any;
    const products = await c.env.DB.prepare(
      `SELECT COUNT(*) as count,
              COALESCE(SUM(CASE WHEN is_active = 1 AND track_inventory = 1 AND stock_quantity <= low_stock_threshold THEN 1 ELSE 0 END), 0) as low,
              COALESCE(SUM(CASE WHEN is_active = 1 THEN stock_quantity * cost ELSE 0 END), 0) as stock_value
       FROM products`,
    ).first() as any;
    return c.json({
      success: true,
      data: {
        pending: Number(pending?.n || 0),
        productCount: Number(products?.count || 0),
        lowStock: Number(products?.low || 0),
        stockValue: Number(products?.stock_value || 0),
        lastBarcode: null,
        lastProductId: null,
        lastActionAt: null,
        updatedAt: null,
      },
      meta: { source: 'd1' },
    });
  });
}
