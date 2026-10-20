/**
 * Partner API v1 — health, catalog reads, scoped keys, idempotent invoice create, OpenAPI.
 */
import type { Hono } from 'hono';
import { apiFail, apiOk } from '../lib/api-response';
import { rateLimit, clientIpFromRequest } from '../lib/security';
import { nextDocumentNumber } from '../lib/numbering';
import { validateInvoiceWrite } from '../lib/validate';

const _localSchemaOnce = new Set<string>();

async function ensurePartnerTables(db: D1Database) {
  if (_localSchemaOnce.has('ensurePartnerTables')) return;

  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS partner_api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_hash TEXT NOT NULL UNIQUE,
      label TEXT DEFAULT '',
      scopes TEXT DEFAULT 'read',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS partner_idempotency (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_hash TEXT NOT NULL,
      idem_key TEXT NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(key_hash, idem_key)
    )`,
    )
    .run();

  _localSchemaOnce.add('ensurePartnerTables');
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type PartnerCtx = { keyHash: string; scopes: Set<string> };

function envKeys(env: any): string[] {
  const raw = String(env.PARTNER_API_KEY || env.PARTNER_API_KEYS || '').trim();
  if (!raw) return [];
  return raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

function extractKey(c: any): string {
  const h = c.req.header('X-Api-Key') || '';
  if (h) return h.trim();
  const auth = c.req.header('Authorization') || '';
  if (auth.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  return '';
}

async function resolvePartner(c: any): Promise<{ ok: true; ctx: PartnerCtx } | { ok: false; res: Response }> {
  await ensurePartnerTables(c.env.DB);
  const key = extractKey(c);
  if (!key) {
    return { ok: false, res: apiFail(c, 'Clé API manquante (X-Api-Key)', 'UNAUTHORIZED') };
  }
  const hash = await sha256Hex(key);

  const row = (await c.env.DB.prepare(
    `SELECT key_hash, scopes, active FROM partner_api_keys WHERE key_hash = ? LIMIT 1`,
  )
    .bind(hash)
    .first()) as any;
  if (row && Number(row.active) === 1) {
    const scopes = new Set(
      String(row.scopes || 'read')
        .split(/[,\s]+/)
        .map((s: string) => s.trim())
        .filter(Boolean),
    );
    const ip = clientIpFromRequest(c) || 'unknown';
    const rl = await rateLimit(c.env.CACHE, `partner:${hash.slice(0, 12)}:${ip}`, 120, 60);
    if (!rl.ok) {
      return {
        ok: false,
        res: apiFail(c, 'Trop de requêtes', 'RATE_LIMITED', { retry_after: rl.retryAfter }),
      };
    }
    return { ok: true, ctx: { keyHash: hash, scopes } };
  }

  const keys = envKeys(c.env);
  if (keys.includes(key)) {
    const ip = clientIpFromRequest(c) || 'unknown';
    const rl = await rateLimit(c.env.CACHE, `partner:env:${hash.slice(0, 12)}:${ip}`, 120, 60);
    if (!rl.ok) {
      return {
        ok: false,
        res: apiFail(c, 'Trop de requêtes', 'RATE_LIMITED', { retry_after: rl.retryAfter }),
      };
    }
    return {
      ok: true,
      ctx: { keyHash: hash, scopes: new Set(['read', 'write_invoices', 'write_stock']) },
    };
  }

  if (!keys.length) {
    return {
      ok: false,
      res: apiFail(c, 'Partner API non configurée (PARTNER_API_KEY ou partner_api_keys)', 'SERVICE_UNAVAILABLE'),
    };
  }
  return { ok: false, res: apiFail(c, 'Clé API invalide', 'UNAUTHORIZED') };
}

function requireScope(ctx: PartnerCtx, scope: string): boolean {
  if (ctx.scopes.has('*') || ctx.scopes.has('admin')) return true;
  if (ctx.scopes.has(scope)) return true;
  if (scope.startsWith('write_') && ctx.scopes.has('write')) return true;
  return false;
}

export function registerPartnerV1Routes(app: Hono<any>): void {
  app.get('/api/v1/openapi.json', async (c) => {
    c.header('Cache-Control', 'public, max-age=300');
    return c.json(OPENAPI_V1);
  });

  app.get('/api/v1/health', async (c) => {
    const auth = await resolvePartner(c);
    if (!auth.ok) return auth.res;
    if (!requireScope(auth.ctx, 'read')) return apiFail(c, 'Scope read requis', 'FORBIDDEN');
    let d1 = false;
    try {
      await c.env.DB.prepare('SELECT 1 as ok').first();
      d1 = true;
    } catch {
      /* */
    }
    return apiOk(c, { ok: true, d1, version: 'v1', scopes: [...auth.ctx.scopes] });
  });

  app.get('/api/v1/products', async (c) => {
    const auth = await resolvePartner(c);
    if (!auth.ok) return auth.res;
    if (!requireScope(auth.ctx, 'read')) return apiFail(c, 'Scope read requis', 'FORBIDDEN');
    const q = String(c.req.query('q') || '').trim().toLowerCase();
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 50)));
    const cursor = Math.max(0, Number(c.req.query('cursor') || 0));
    let sql = `SELECT id, sku, name, category, unit, price, cost, stock_quantity, low_stock_threshold, barcode, is_active FROM products WHERE 1=1`;
    const binds: any[] = [];
    if (q) {
      sql += ` AND (LOWER(name) LIKE ? OR LOWER(sku) LIKE ? OR barcode LIKE ?)`;
      const like = `%${q}%`;
      binds.push(like, like, like);
    }
    sql += ` ORDER BY id LIMIT ? OFFSET ?`;
    binds.push(limit, cursor);
    try {
      const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
      const rows = results || [];
      return apiOk(c, { items: rows, next_cursor: rows.length === limit ? cursor + limit : null });
    } catch (e: any) {
      return apiFail(c, e?.message || 'Liste produits impossible', 'INTERNAL');
    }
  });

  app.get('/api/v1/products/:id', async (c) => {
    const auth = await resolvePartner(c);
    if (!auth.ok) return auth.res;
    if (!requireScope(auth.ctx, 'read')) return apiFail(c, 'Scope read requis', 'FORBIDDEN');
    const row = await c.env.DB.prepare(
      `SELECT id, sku, name, description, category, unit, price, cost, stock_quantity, low_stock_threshold, barcode, is_active FROM products WHERE id = ?`,
    )
      .bind(c.req.param('id'))
      .first();
    if (!row) return apiFail(c, 'Produit introuvable', 'NOT_FOUND');
    return apiOk(c, row);
  });

  app.get('/api/v1/clients', async (c) => {
    const auth = await resolvePartner(c);
    if (!auth.ok) return auth.res;
    if (!requireScope(auth.ctx, 'read')) return apiFail(c, 'Scope read requis', 'FORBIDDEN');
    const q = String(c.req.query('q') || '').trim().toLowerCase();
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || 50)));
    const cursor = Math.max(0, Number(c.req.query('cursor') || 0));
    let sql = `SELECT id, name, ice, city, phone, email, tax_exempt, credit_limit FROM clients WHERE 1=1`;
    const binds: any[] = [];
    if (q) {
      sql += ` AND (LOWER(name) LIKE ? OR ice LIKE ? OR city LIKE ?)`;
      const like = `%${q}%`;
      binds.push(like, like, like);
    }
    sql += ` ORDER BY id LIMIT ? OFFSET ?`;
    binds.push(limit, cursor);
    try {
      const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
      const rows = results || [];
      return apiOk(c, { items: rows, next_cursor: rows.length === limit ? cursor + limit : null });
    } catch (e: any) {
      return apiFail(c, e?.message || 'Liste clients impossible', 'INTERNAL');
    }
  });

  app.get('/api/v1/invoices', async (c) => {
    const auth = await resolvePartner(c);
    if (!auth.ok) return auth.res;
    if (!requireScope(auth.ctx, 'read')) return apiFail(c, 'Scope read requis', 'FORBIDDEN');
    const limit = Math.min(50, Math.max(1, Number(c.req.query('limit') || 25)));
    const cursor = Math.max(0, Number(c.req.query('cursor') || 0));
    const status = String(c.req.query('status') || '').trim();
    let sql = `SELECT id, number, client_name, status, total, amount_paid, issue_date, doc_kind FROM invoices WHERE COALESCE(doc_kind,'') != 'remboursement'`;
    const binds: any[] = [];
    if (status) {
      sql += ` AND status = ?`;
      binds.push(status);
    }
    sql += ` ORDER BY id DESC LIMIT ? OFFSET ?`;
    binds.push(limit, cursor);
    try {
      const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
      const rows = results || [];
      return apiOk(c, { items: rows, next_cursor: rows.length === limit ? cursor + limit : null });
    } catch (e: any) {
      return apiFail(c, e?.message || 'Liste factures impossible', 'INTERNAL');
    }
  });

  app.post('/api/v1/invoices', async (c) => {
    const auth = await resolvePartner(c);
    if (!auth.ok) return auth.res;
    if (!requireScope(auth.ctx, 'write_invoices')) {
      return apiFail(c, 'Scope write_invoices requis', 'FORBIDDEN');
    }
    const idem = String(c.req.header('Idempotency-Key') || c.req.header('idempotency-key') || '').trim().slice(0, 128);
    if (idem) {
      const prev = (await c.env.DB.prepare(
        `SELECT response_json FROM partner_idempotency WHERE key_hash = ? AND idem_key = ?`,
      )
        .bind(auth.ctx.keyHash, idem)
        .first()) as any;
      if (prev?.response_json) {
        try {
          return c.json(JSON.parse(prev.response_json), 200);
        } catch {
          /* recreate */
        }
      }
    }

    const body = await c.req.json().catch(() => ({}));
    const verr = validateInvoiceWrite(body);
    if (verr) return apiFail(c, Object.values(verr)[0] || 'Validation', 'VALIDATION', verr);

    const client_name = String(body.client_name || '').trim();
    const client_id = body.client_id != null ? Number(body.client_id) : null;
    const items = Array.isArray(body.items) ? body.items : [];
    const notes = String(body.notes || '').slice(0, 2000);
    const settings = (await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first()) as any;
    const number = await nextDocumentNumber(c.env.DB, 'invoice', settings, c.env);

    let subtotal = 0;
    let tax_amount = 0;
    const defaultTax = Number(settings?.tax_rate ?? 20) || 20;
    const lineRows: any[] = [];
    for (const item of items) {
      const qty = Number(item.quantity || 0);
      if (qty <= 0) continue;
      const unitP = Number(item.unit_price ?? item.price ?? 0);
      const tax = item.tax_rate != null ? Number(item.tax_rate) : defaultTax;
      const line = Math.round(qty * unitP * 100) / 100;
      const lineTax = Math.round(line * (tax / 100) * 100) / 100;
      subtotal += line;
      tax_amount += lineTax;
      lineRows.push({
        product_name: String(item.product_name || item.name || 'Ligne').slice(0, 200),
        sku: String(item.sku || '').slice(0, 80),
        quantity: qty,
        unit_price: unitP,
        tax_rate: tax,
        line_total: line + lineTax,
      });
    }
    if (!lineRows.length) return apiFail(c, 'Aucune ligne valide', 'VALIDATION');
    const total = Math.round((subtotal + tax_amount) * 100) / 100;
    const issue = String(body.issue_date || new Date().toISOString().slice(0, 10)).slice(0, 10);

    const ins = await c.env.DB.prepare(
      `INSERT INTO invoices (number, client_id, client_name, status, subtotal, tax_amount, total, amount_paid, issue_date, notes, doc_kind)
       VALUES (?, ?, ?, 'sent', ?, ?, ?, 0, ?, ?, 'invoice')`,
    )
      .bind(number, client_id, client_name, subtotal, tax_amount, total, issue, notes)
      .run();
    const invId = ins.meta.last_row_id;
    for (const ln of lineRows) {
      try {
        await c.env.DB.prepare(
          `INSERT INTO invoice_items (invoice_id, product_name, sku, quantity, unit_price, tax_rate, line_total)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
          .bind(invId, ln.product_name, ln.sku, ln.quantity, ln.unit_price, ln.tax_rate, ln.line_total)
          .run();
      } catch {
        /* schema variants */
      }
    }
    const inv = await c.env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(invId).first();
    const payload = { success: true, data: inv, message: 'Facture créée (partner v1)' };
    if (idem) {
      try {
        await c.env.DB.prepare(
          `INSERT OR REPLACE INTO partner_idempotency (key_hash, idem_key, response_json) VALUES (?, ?, ?)`,
        )
          .bind(auth.ctx.keyHash, idem, JSON.stringify(payload))
          .run();
      } catch {
        /* */
      }
    }
    return c.json(payload, 201);
  });
}

const OPENAPI_V1 = {
  openapi: '3.0.3',
  info: {
    title: 'Atlas Commerce Partner API',
    version: '1.0.0',
    description: 'Stable partner surface. Auth: X-Api-Key. Scopes: read, write_invoices, write_stock.',
  },
  servers: [{ url: '/api/v1' }],
  paths: {
    '/health': { get: { security: [{ ApiKey: [] }], responses: { '200': { description: 'OK' } } } },
    '/products': { get: { security: [{ ApiKey: [] }], responses: { '200': { description: 'Product list' } } } },
    '/products/{id}': { get: { security: [{ ApiKey: [] }], responses: { '200': { description: 'Product' } } } },
    '/clients': { get: { security: [{ ApiKey: [] }], responses: { '200': { description: 'Clients' } } } },
    '/invoices': {
      get: { security: [{ ApiKey: [] }], responses: { '200': { description: 'Invoices' } } },
      post: {
        security: [{ ApiKey: [] }],
        parameters: [{ name: 'Idempotency-Key', in: 'header', schema: { type: 'string' } }],
        responses: { '201': { description: 'Created' } },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKey: { type: 'apiKey', in: 'header', name: 'X-Api-Key' },
    },
  },
};
