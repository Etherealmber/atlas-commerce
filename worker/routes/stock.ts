const _localSchemaOnce = new Set<string>();

import type { AtlasApp } from './types';
import { withInventoryActors } from '../lib/inventory-actors';
import {
  buildIdempotencyInsertStmt,
  ensureOfflineOpsSchema,
  hashCanonicalPayload,
  scheduleOfflineIdempotencyPurge,
  withIdempotency,
  type IdempotentHandlerResult,
} from '../lib/idempotency';
import { ensureStockLocations, getDefaultLocationId } from './inventoryOps';
import { afterBusinessMutation } from '../lib/delete-coord';

async function ensureStockMovementsTable(db: D1Database): Promise<void> {
  if (_localSchemaOnce.has('ensureStockMovementsTable')) return;
  _localSchemaOnce.add('ensureStockMovementsTable');
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      type TEXT DEFAULT '',
      quantity REAL DEFAULT 0,
      previous_quantity REAL DEFAULT 0,
      new_quantity REAL DEFAULT 0,
      reason TEXT DEFAULT '',
      reference TEXT DEFAULT '',
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    )
    .run();
}

export interface StockRoutesDeps {
  requireFloorStock?: (c: any) => { ok: true; username: string; role: string } | { ok: false; response: Response };
  sessionUserFromHeader?: (authHeader?: string) => { username?: string; role?: string };
}

type OfflineOpName = 'receive' | 'issue' | 'count';

interface OfflineOpInput {
  op?: string;
  product_id?: string | number;
  location_id?: string | number;
  quantity?: number;
  counted_on_hand?: number;
  expected_revision?: number;
  idempotency_key?: string;
  client_ts?: string;
  reason?: string;
  reference?: string;
}

interface OfflineOpResult {
  op: string;
  idempotency_key: string;
  status: 'applied' | 'replayed' | 'conflict' | 'rejected';
  http: number;
  revision?: number;
  quantity?: number;
  current_quantity?: number;
  code?: string;
  message: string;
}

function opCanonicalBody(op: OfflineOpInput) {
  return {
    op: String(op.op || '').trim().toLowerCase(),
    product_id: op.product_id != null ? String(op.product_id).trim() : '',
    location_id: op.location_id != null ? String(op.location_id).trim() : '',
    quantity: op.quantity != null ? Number(op.quantity) : null,
    counted_on_hand: op.counted_on_hand != null ? Number(op.counted_on_hand) : null,
    expected_revision: op.expected_revision != null ? Number(op.expected_revision) : null,
    reason: op.reason != null ? String(op.reason) : '',
    reference: op.reference != null ? String(op.reference) : '',
  };
}

/** Stock read APIs (movements) + offline-operations contract. */
export function registerStockReadRoutes(app: AtlasApp, deps?: StockRoutesDeps): void {
  app.get('/api/products/:id/movements', async (c) => {
    await ensureStockMovementsTable(c.env.DB);
    const id = c.req.param('id');
    const full = c.req.query('full') === '1' || c.req.query('all') === '1';
    const limit = Math.min(full ? 2000 : 200, Math.max(1, Number(c.req.query('limit') || (full ? 500 : 50))));
    const offset = Math.max(0, Number(c.req.query('offset') || 0));
    const windowSql = full ? '' : `AND datetime(created_at) >= datetime('now', '-90 days')`;
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM stock_movements
       WHERE product_id = ?
         ${windowSql}
       ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
      .bind(id, limit, offset)
      .all();
    return c.json({
      success: true,
      data: (results || []).map((row: any) => withInventoryActors(row)),
      meta: {
        product_id: Number(id),
        limit,
        offset,
        count: results?.length || 0,
        window: full ? 'all' : '90d',
      },
    });
  });

  app.get('/api/stock/movements', async (c) => {
    await ensureStockMovementsTable(c.env.DB);
    const productId = c.req.query('product_id');
    const type = c.req.query('type');
    const q = String(c.req.query('q') || '').trim();
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit') || 50)));
    const offset = Math.max(0, Number(c.req.query('offset') || 0));
    const clauses: string[] = [];
    const binds: any[] = [];
    if (productId) {
      clauses.push('product_id = ?');
      binds.push(productId);
    }
    if (type) {
      clauses.push('type = ?');
      binds.push(type);
    }
    if (q) {
      clauses.push('(reason LIKE ? OR reference LIKE ?)');
      binds.push(`%${q}%`, `%${q}%`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM stock_movements ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
      .bind(...binds, limit, offset)
      .all();
    return c.json({
      success: true,
      data: (results || []).map((row: any) => withInventoryActors(row)),
      meta: { limit, offset, count: results?.length || 0 },
    });
  });

  app.post('/api/inventory/offline-operations', async (c) => {
    const gate = deps?.requireFloorStock
      ? deps.requireFloorStock(c)
      : { ok: true as const, username: deps?.sessionUserFromHeader?.(c.req.header('Authorization')).username || 'user', role: 'owner' };
    if (!gate.ok) return gate.response;

    const rawBody = (await c.req.json().catch(() => null)) as {
      device_id?: string;
      client_ts?: string;
      operations?: OfflineOpInput[];
    } | null;
    if (!rawBody || !Array.isArray(rawBody.operations)) {
      return c.json(
        {
          success: false,
          code: 'INVALID_BODY',
          error: 'Le corps doit contenir un tableau operations.',
        },
        400,
      );
    }
    if (rawBody.operations.length > 200) {
      return c.json(
        {
          success: false,
          code: 'TOO_MANY_OPERATIONS',
          error: 'Maximum 200 opérations par lot.',
        },
        400,
      );
    }

    const executeBatch = async (): Promise<IdempotentHandlerResult> => {
      const db = c.env.DB;
      await ensureStockLocations(db);
      await ensureOfflineOpsSchema(db);

      const batchDeviceId = String(rawBody.device_id || 'unknown').trim().slice(0, 128) || 'unknown';
      const batchClientTs = String(rawBody.client_ts || new Date().toISOString()).slice(0, 64);
      const results: OfflineOpResult[] = [];
      let anyApplied = false;

      for (const item of rawBody.operations || []) {
        const opName = String(item?.op || '').trim().toLowerCase() as OfflineOpName;
        const idemKey = String(item?.idempotency_key || '').trim();
        const opClientTs = String(item?.client_ts || batchClientTs).slice(0, 64);

        if (!idemKey) {
          results.push({
            op: opName || 'unknown',
            idempotency_key: '',
            status: 'rejected',
            http: 400,
            code: 'MISSING_IDEMPOTENCY_KEY',
            message: 'Clé idempotency_key obligatoire pour chaque opération.',
          });
          continue;
        }

        if (opName !== 'receive' && opName !== 'issue' && opName !== 'count') {
          results.push({
            op: opName || 'unknown',
            idempotency_key: idemKey,
            status: 'rejected',
            http: 400,
            code: 'INVALID_OP',
            message: 'Opération non supportée (attendu : receive, issue ou count).',
          });
          continue;
        }

        const canonical = opCanonicalBody(item);
        const opHash = await hashCanonicalPayload(canonical);

        // 1. Check per-operation idempotency
        const existingIdem = (await db
          .prepare(`SELECT request_hash, status, response FROM offline_idempotency WHERE key = ?`)
          .bind(idemKey)
          .first()) as { request_hash: string; status: number; response: string } | null;

        if (existingIdem) {
          if (existingIdem.request_hash !== opHash) {
            results.push({
              op: opName,
              idempotency_key: idemKey,
              status: 'rejected',
              http: 409,
              code: 'IDEMPOTENCY_MISMATCH',
              message: 'Clé d’idempotence déjà utilisée avec un contenu différent.',
            });
            continue;
          }
          try {
            const stored = JSON.parse(existingIdem.response) as OfflineOpResult;
            results.push({
              ...stored,
              status: 'replayed',
              http: 200,
            });
          } catch {
            results.push({
              op: opName,
              idempotency_key: idemKey,
              status: 'replayed',
              http: 200,
              message: 'Opération déjà appliquée (rejouée).',
            });
          }
          continue;
        }

        // 2. Validate required location_id and product_id
        const rawLocId = canonical.location_id;
        if (!rawLocId) {
          results.push({
            op: opName,
            idempotency_key: idemKey,
            status: 'rejected',
            http: 400,
            code: 'LOCATION_REQUIRED',
            message: 'Emplacement (location_id) obligatoire.',
          });
          continue;
        }
        const locNum = Number(rawLocId);
        const locRow = (Number.isInteger(locNum) && locNum > 0
          ? await db
              .prepare(`SELECT id, code, name, COALESCE(is_active, 1) AS is_active FROM stock_locations WHERE id = ?`)
              .bind(locNum)
              .first()
          : await db
              .prepare(`SELECT id, code, name, COALESCE(is_active, 1) AS is_active FROM stock_locations WHERE code = ?`)
              .bind(rawLocId)
              .first()) as { id: number; code: string; name: string; is_active: number } | null;

        if (!locRow || Number(locRow.is_active ?? 1) !== 1) {
          results.push({
            op: opName,
            idempotency_key: idemKey,
            status: 'rejected',
            http: 404,
            code: 'INVALID_LOCATION',
            message: 'Emplacement inconnu ou inactif.',
          });
          continue;
        }

        const prodIdNum = Number(canonical.product_id);
        if (!canonical.product_id || !Number.isInteger(prodIdNum) || prodIdNum <= 0) {
          results.push({
            op: opName,
            idempotency_key: idemKey,
            status: 'rejected',
            http: 400,
            code: 'INVALID_PRODUCT',
            message: 'Produit (product_id) invalide.',
          });
          continue;
        }

        const prodRow = (await db
          .prepare(`SELECT id, name, COALESCE(stock_quantity, 0) AS stock_quantity, COALESCE(track_inventory, 1) AS track_inventory FROM products WHERE id = ?`)
          .bind(prodIdNum)
          .first()) as { id: number; name: string; stock_quantity: number; track_inventory: number } | null;

        if (!prodRow) {
          results.push({
            op: opName,
            idempotency_key: idemKey,
            status: 'rejected',
            http: 404,
            code: 'PRODUCT_NOT_FOUND',
            message: 'Produit introuvable.',
          });
          continue;
        }

        const locIdNum = Number(locRow.id);
        const locIdText = String(locIdNum);
        const prodIdText = String(prodIdNum);

        // Seed unallocated product stock onto default location if needed before computing location balance
        const locCountRow = (await db
          .prepare(`SELECT COUNT(*) AS c FROM stock_location_qty WHERE product_id = ?`)
          .bind(prodIdNum)
          .first()) as { c: number } | null;
        const preStatements: D1PreparedStatement[] = [];
        let seededDefaultQty = 0;
        let seededLocId = 0;
        if (!Number(locCountRow?.c || 0) && Number(prodRow.stock_quantity || 0) > 0) {
          const defId = (await getDefaultLocationId(db)) || locIdNum;
          seededDefaultQty = Number(prodRow.stock_quantity || 0);
          seededLocId = defId;
          preStatements.push(
            db
              .prepare(`INSERT INTO stock_location_qty (location_id, product_id, quantity) VALUES (?, ?, ?)`)
              .bind(defId, prodIdNum, seededDefaultQty),
          );
        }

        const qtyRow = (await db
          .prepare(`SELECT quantity FROM stock_location_qty WHERE location_id = ? AND product_id = ?`)
          .bind(locIdNum, prodIdNum)
          .first()) as { quantity: number } | null;
        const prevLocQty = qtyRow ? Number(qtyRow.quantity || 0) : seededLocId === locIdNum ? seededDefaultQty : 0;
        const prevProdQty = Number(prodRow.stock_quantity || 0);

        const revRow = (await db
          .prepare(`SELECT revision FROM stock_location_revisions WHERE product_id = ? AND location_id = ?`)
          .bind(prodIdText, locIdText)
          .first()) as { revision: number } | null;
        const currentRev = revRow ? Number(revRow.revision) : 1;

        let delta = 0;
        let nextLocQty = prevLocQty;
        let movementType = 'adjustment';
        let movementReason = canonical.reason || '';

        if (opName === 'receive') {
          const qty = Number(canonical.quantity);
          if (!Number.isFinite(qty) || qty <= 0) {
            results.push({
              op: opName,
              idempotency_key: idemKey,
              status: 'rejected',
              http: 400,
              code: 'INVALID_QUANTITY',
              message: 'La quantité reçue doit être strictement positive.',
            });
            continue;
          }
          delta = qty;
          nextLocQty = prevLocQty + delta;
          movementType = 'in';
          movementReason = movementReason || `Réception hors-ligne (${locRow.name})`;
        } else if (opName === 'issue') {
          const qty = Number(canonical.quantity);
          if (!Number.isFinite(qty) || qty <= 0) {
            results.push({
              op: opName,
              idempotency_key: idemKey,
              status: 'rejected',
              http: 400,
              code: 'INVALID_QUANTITY',
              message: 'La quantité sortie doit être strictement positive.',
            });
            continue;
          }
          if (prevLocQty - qty < -1e-9) {
            results.push({
              op: opName,
              idempotency_key: idemKey,
              status: 'rejected',
              http: 422,
              revision: currentRev,
              current_quantity: prevLocQty,
              code: 'INSUFFICIENT_STOCK',
              message: `Stock insuffisant sur ${locRow.name} (disponible : ${prevLocQty}, demandé : ${qty}).`,
            });
            continue;
          }
          delta = -qty;
          nextLocQty = Math.max(0, prevLocQty + delta);
          movementType = 'out';
          movementReason = movementReason || `Sortie hors-ligne (${locRow.name})`;
        } else {
          const counted = Number(canonical.counted_on_hand);
          const expectedRev = Number(canonical.expected_revision);
          if (!Number.isFinite(counted) || counted < 0) {
            results.push({
              op: opName,
              idempotency_key: idemKey,
              status: 'rejected',
              http: 400,
              code: 'INVALID_QUANTITY',
              message: 'La quantité comptée (counted_on_hand) doit être ≥ 0.',
            });
            continue;
          }
          if (!Number.isInteger(expectedRev) || expectedRev < 1) {
            results.push({
              op: opName,
              idempotency_key: idemKey,
              status: 'rejected',
              http: 400,
              code: 'INVALID_REVISION',
              message: 'Révision attendue (expected_revision) invalide.',
            });
            continue;
          }
          if (expectedRev !== currentRev) {
            results.push({
              op: opName,
              idempotency_key: idemKey,
              status: 'conflict',
              http: 409,
              revision: currentRev,
              quantity: prevLocQty,
              current_quantity: prevLocQty,
              code: 'REVISION_CONFLICT',
              message: `Conflit de révision : attendu ${expectedRev}, révision actuelle ${currentRev} (quantité ${prevLocQty}).`,
            });
            continue;
          }
          delta = counted - prevLocQty;
          nextLocQty = counted;
          movementType = 'cycle-count';
          movementReason = movementReason || `Comptage hors-ligne ${prevLocQty}→${counted} (${locRow.name})`;
        }

        const nextProdQty = Math.max(0, prevProdQty + delta);
        const nextRev = currentRev + 1;
        const nowIso = new Date().toISOString();
        const opResult: OfflineOpResult = {
          op: opName,
          idempotency_key: idemKey,
          status: 'applied',
          http: 200,
          revision: nextRev,
          quantity: nextLocQty,
          message: 'Opération appliquée.',
        };

        const stmts: D1PreparedStatement[] = [
          ...preStatements,
          db
            .prepare(
              `INSERT INTO stock_location_qty (location_id, product_id, quantity)
               VALUES (?, ?, ?)
               ON CONFLICT(location_id, product_id) DO UPDATE SET quantity = excluded.quantity`,
            )
            .bind(locIdNum, prodIdNum, nextLocQty),
          db
            .prepare(`UPDATE products SET stock_quantity = ?, updated_at = datetime('now') WHERE id = ?`)
            .bind(nextProdQty, prodIdNum),
          db
            .prepare(
              `INSERT INTO stock_location_revisions (product_id, location_id, revision, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(product_id, location_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at`,
            )
            .bind(prodIdText, locIdText, nextRev, nowIso),
          db
            .prepare(
              `INSERT INTO stock_movements (product_id, type, quantity, previous_quantity, new_quantity, reason, reference, created_by, location_id, device_id, client_ts)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              prodIdNum,
              movementType,
              delta,
              prevLocQty,
              nextLocQty,
              movementReason,
              canonical.reference || `offline:${idemKey}`,
              gate.username || 'user',
              locIdText,
              batchDeviceId,
              opClientTs,
            ),
          buildIdempotencyInsertStmt(db, {
            key: idemKey,
            deviceId: batchDeviceId,
            op: opName,
            requestHash: opHash,
            status: 200,
            responseJson: JSON.stringify(opResult),
            createdAt: nowIso,
          }),
        ];

        await db.batch(stmts);
        anyApplied = true;
        results.push(opResult);
      }

      if (anyApplied) {
        await afterBusinessMutation(c.env.CACHE, c.env.MOBILE_HUB);
      }
      let execCtx: { waitUntil: (p: Promise<unknown>) => void } | undefined;
      try {
        execCtx = c.executionCtx;
      } catch {
        execCtx = undefined;
      }
      scheduleOfflineIdempotencyPurge(execCtx, db);

      return {
        status: 200,
        body: {
          success: true,
          device_id: batchDeviceId,
          data: results,
        },
        persist: true,
      };
    };

    if (c.req.header('Idempotency-Key')) {
      return withIdempotency(c, {
        op: 'offline-operations-batch',
        deviceId: String(rawBody.device_id || 'unknown'),
        payload: rawBody,
        handler: async () => executeBatch(),
      });
    }

    const res = await executeBatch();
    return c.json(res.body, res.status as any);
  });
}
