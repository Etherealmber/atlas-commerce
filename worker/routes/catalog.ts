import type { Hono } from 'hono';
import { normalizeInventoryRole, scrubProductForRole } from '../lib/inventory-policy';

interface CatalogRouteDeps {
  ensureCatalogTables: (db: D1Database) => Promise<void>;
  readProductImageJson: (c: any) => Promise<any>;
  productImageFailure: (c: any, e: unknown) => Response;
  isAllowedImageUrl: (raw: string) => boolean;
  keyFromCdnUrl: (env: any, raw: string) => string | null;
  deleteR2Object: (bucket: any, key: string) => Promise<void>;
  normalizeProductImageReference: (env: any, productId: any, source: string) => Promise<{ url: string }>;
  isNormalizedProductUrl: (env: any, url: string) => boolean;
  migrateProductImagePage: (db: D1Database, env: any, phase: 'products' | 'images', after: number, limit: number) => Promise<any>;
  afterBusinessMutation: (kv: any, hub?: any) => Promise<void>;
  sessionUserFromHeader: (authHeader?: string) => { username?: string; role?: string };
  authFailReason: (authHeader: string | undefined, env: any, db: D1Database, ip: string, fp: string) => Promise<string>;
  clientIp: (c: any) => string;
  getOwnerUsername: (env: any) => string;
  requireBizMutator?: (c: any) => { ok: true; username: string; role: string } | { ok: false; response: Response };
}

export function registerCatalogRoutes(app: Hono<any>, deps: CatalogRouteDeps): void {
  const {
    ensureCatalogTables,
    readProductImageJson,
    productImageFailure,
    isAllowedImageUrl,
    keyFromCdnUrl,
    deleteR2Object,
    normalizeProductImageReference,
    isNormalizedProductUrl,
    migrateProductImagePage,
    afterBusinessMutation,
    sessionUserFromHeader,
    authFailReason,
    clientIp,
    getOwnerUsername,
    requireBizMutator,
  } = deps;

  app.get('/api/catalog/settings', async (c) => {
    await ensureCatalogTables(c.env.DB);
    const row = await c.env.DB.prepare(`SELECT * FROM catalog_settings WHERE id = 1`).first();
    return c.json({ success: true, data: row });
  });

  app.put('/api/catalog/settings', async (c) => {
    if (requireBizMutator) {
      const gate = requireBizMutator(c);
      if (!gate.ok) return gate.response;
    }
    await ensureCatalogTables(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const fields = ['site_title', 'site_tagline', 'public_base_url', 'show_prices', 'show_stock', 'contact_email', 'contact_phone'];
    const updates: string[] = [];
    const values: any[] = [];
    for (const f of fields) {
      if (body[f] !== undefined) {
        updates.push(`${f} = ?`);
        values.push(body[f]);
      }
    }
    if (!updates.length) return c.json({ success: false, error: 'Aucun champ' }, 400);
    updates.push(`updated_at = datetime('now')`);
    await c.env.DB.prepare(`UPDATE catalog_settings SET ${updates.join(', ')} WHERE id = 1`).bind(...values).run();
    const row = await c.env.DB.prepare(`SELECT * FROM catalog_settings WHERE id = 1`).first();
    return c.json({ success: true, data: row, message: 'Paramètres catalogue enregistrés.' });
  });

  app.get('/api/catalog/products', async (c) => {
    await ensureCatalogTables(c.env.DB);
    const callerRole = normalizeInventoryRole(sessionUserFromHeader(c.req.header('Authorization')).role);
    const { results } = await c.env.DB.prepare(`
      SELECT p.id, p.sku, p.name, p.category, p.price, p.stock_quantity, p.image_url,
             COALESCE(c.is_public, p.is_public, 0) as is_public,
             COALESCE(c.is_featured, 0) as is_featured,
             COALESCE(c.short_description, p.short_description, p.description, '') as short_description,
             c.long_description, c.slug as catalog_slug, p.slug as product_slug
      FROM products p
      LEFT JOIN product_catalog c ON c.product_id = p.id
      WHERE p.is_active = 1
      ORDER BY p.name
    `).all();
    return c.json({ success: true, data: (results || []).map((r: any) => scrubProductForRole(r, callerRole)) });
  });

  app.put('/api/catalog/products/:id', async (c) => {
    if (requireBizMutator) {
      const gate = requireBizMutator(c);
      if (!gate.ok) return gate.response;
    }
    await ensureCatalogTables(c.env.DB);
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const prod = await c.env.DB.prepare(`SELECT id, name FROM products WHERE id = ?`).bind(id).first();
    if (!prod) return c.json({ success: false, error: 'Produit introuvable' }, 404);

    const slug = body.slug !== undefined
      ? String(body.slug).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '')
      : undefined;
    const short_description = body.short_description !== undefined ? String(body.short_description) : undefined;
    const long_description = body.long_description !== undefined ? String(body.long_description) : undefined;
    const is_public = body.is_public !== undefined ? (body.is_public ? 1 : 0) : undefined;
    const is_featured = body.is_featured !== undefined ? (body.is_featured ? 1 : 0) : undefined;

    const existing = await c.env.DB.prepare(`SELECT product_id FROM product_catalog WHERE product_id = ?`).bind(id).first();
    if (existing) {
      const sets: string[] = [];
      const vals: any[] = [];
      if (slug !== undefined) { sets.push('slug = ?'); vals.push(slug || null); }
      if (short_description !== undefined) { sets.push('short_description = ?'); vals.push(short_description); }
      if (long_description !== undefined) { sets.push('long_description = ?'); vals.push(long_description); }
      if (is_public !== undefined) { sets.push('is_public = ?'); vals.push(is_public); }
      if (is_featured !== undefined) { sets.push('is_featured = ?'); vals.push(is_featured); }
      sets.push(`updated_at = datetime('now')`);
      if (is_public === 1) sets.push(`published_at = COALESCE(published_at, datetime('now'))`);
      vals.push(id);
      if (sets.length > 1) {
        await c.env.DB.prepare(`UPDATE product_catalog SET ${sets.join(', ')} WHERE product_id = ?`).bind(...vals).run();
      }
    } else {
      await c.env.DB.prepare(`
        INSERT INTO product_catalog (product_id, slug, short_description, long_description, is_public, is_featured, published_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        id,
        slug || null,
        short_description || '',
        long_description || '',
        is_public ?? 0,
        is_featured ?? 0,
        is_public === 1 ? new Date().toISOString() : null,
      ).run();
    }

    if (is_public !== undefined || slug !== undefined || short_description !== undefined) {
      const psets: string[] = [];
      const pvals: any[] = [];
      if (is_public !== undefined) { psets.push('is_public = ?'); pvals.push(is_public); }
      if (slug !== undefined) { psets.push('slug = ?'); pvals.push(slug || null); }
      if (short_description !== undefined) { psets.push('short_description = ?'); pvals.push(short_description); }
      if (psets.length) {
        pvals.push(id);
        try {
          await c.env.DB.prepare(`UPDATE products SET ${psets.join(', ')} WHERE id = ?`).bind(...pvals).run();
        } catch { /* columns may not exist on very old DB */ }
      }
    }

    return c.json({ success: true, message: 'Fiche catalogue mise à jour.' });
  });

  /** Same-origin image proxy — allows PC crop/rotate without CDN CORS issues */
  app.get('/api/media/proxy', async (c) => {
    const raw = String(c.req.query('url') || '').trim();
    if (!raw) {
      return c.json({ success: false, error: 'URL manquante' }, 400);
    }
    if (raw.startsWith('data:image/')) {
      return c.json({ success: false, error: 'data URL — pas de proxy' }, 400);
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(raw);
    } catch {
      return c.json({ success: false, error: 'URL invalide' }, 400);
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return c.json({ success: false, error: 'Protocole URL non autorisé' }, 400);
    }
    const host = parsedUrl.hostname.toLowerCase();
    const isTrustedHost =
      host === 'afmarbre.com' ||
      host.endsWith('.afmarbre.com') ||
      host === 'r2.dev' ||
      host.endsWith('.r2.dev');
    if (!isAllowedImageUrl(raw) && !isTrustedHost) {
      return c.json({ success: false, error: 'URL image non autorisée' }, 400);
    }
    try {
      const key = keyFromCdnUrl(c.env, raw);
      if (key && (key.startsWith('backups/') || key.includes('/backups/'))) {
        return c.json({ success: false, error: 'Accès interdit' }, 403);
      }
      if (key && c.env.IMAGES) {
        const obj = await c.env.IMAGES.get(key);
        if (obj) {
          const buf = await obj.arrayBuffer();
          const ct = obj.httpMetadata?.contentType || 'image/jpeg';
          return new Response(buf, {
            status: 200,
            headers: {
              'Content-Type': ct,
              'Cache-Control': 'private, max-age=600',
              'Access-Control-Allow-Origin': 'https://stock.afmarbre.com',
              'Vary': 'Origin',
            },
          });
        }
      }
      const res = await fetch(raw, {
        redirect: 'follow',
        headers: { Accept: 'image/*,*/*' },
      });
      if (!res.ok) {
        return c.json({ success: false, error: `Image inaccessible (${res.status})` }, 502);
      }
      const buf = await res.arrayBuffer();
      if (!buf || buf.byteLength < 32) {
        return c.json({ success: false, error: 'Image vide' }, 502);
      }
      let ct = res.headers.get('Content-Type') || 'image/jpeg';
      if (!ct.startsWith('image/')) ct = 'image/jpeg';
      return new Response(buf, {
        status: 200,
        headers: {
          'Content-Type': ct,
          'Cache-Control': 'private, max-age=600',
          'Access-Control-Allow-Origin': 'https://stock.afmarbre.com',
          'Vary': 'Origin',
        },
      });
    } catch (e: any) {
      return c.json({ success: false, error: e?.message || 'Proxy image échoué' }, 502);
    }
  });

  app.post('/api/admin/product-images/normalize', async (c) => {
    const session = sessionUserFromHeader(c.req.header('Authorization'));
    const auth = await authFailReason(c.req.header('Authorization'), c.env, c.env.DB, clientIp(c), c.req.header('X-Device-Fingerprint') || '');
    if (auth !== 'ok' || session.username !== getOwnerUsername(c.env) || session.role !== 'owner') {
      return c.json({ success: false, code: 'FORBIDDEN', error: 'Réservé au propriétaire.' }, 403);
    }
    if (!c.env.IMAGES) return c.json({ success: false, code: 'STORAGE_UNAVAILABLE' }, 503);
    const body = await c.req.json().catch(() => ({}));
    if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ success: false, code: 'VALIDATION' }, 400);
    const phase = body.phase ?? 'images';
    const after = body.after ?? 0, limit = body.limit ?? 3;
    if (!['images', 'products'].includes(phase) || !Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 5) {
      return c.json({ success: false, code: 'VALIDATION' }, 400);
    }
    try {
      const result = await migrateProductImagePage(c.env.DB, c.env, phase, after, limit);
      if (result.updated) await afterBusinessMutation(c.env.CACHE, c.env.MOBILE_HUB);
      return c.json({ success: true, data: result });
    } catch { return c.json({ success: false, code: 'SERVICE_UNAVAILABLE' }, 503); }
  });

  app.get('/api/catalog/products/:id/images', async (c) => {
    await ensureCatalogTables(c.env.DB);
    const id = c.req.param('id');
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM product_images WHERE product_id = ? ORDER BY is_primary DESC, sort_order ASC, id ASC`,
    ).bind(id).all();
    return c.json({ success: true, data: (results || []).map((row: any) => isNormalizedProductUrl(c.env, String(row.url || '')) ? { ...row, content_type: 'image/webp' } : row) });
  });

  app.post('/api/catalog/products/:id/images', async (c) => {
    await ensureCatalogTables(c.env.DB);
    const id = c.req.param('id');
    let body: any;
    try { body = await readProductImageJson(c); } catch (e) { return productImageFailure(c, e); }
    let url = String(body.url || '').trim();
    const dataUrl = String(body.data_url || body.dataUrl || '').trim();
    const prod = await c.env.DB.prepare(`SELECT id FROM products WHERE id = ?`).bind(id).first();
    if (!prod) return c.json({ success: false, error: 'Produit introuvable' }, 404);

    const source = dataUrl || url;
    if (!source) return c.json({ success: false, error: 'URL image ou data_url obligatoire' }, 400);
    try { url = (await normalizeProductImageReference(c.env, id, source)).url; }
    catch (e) { return productImageFailure(c, e); }

    const is_primary = body.is_primary ? 1 : 0;
    const insert = c.env.DB.prepare(
      `INSERT INTO product_images (product_id, url, alt_text, sort_order, is_primary)
       SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM products WHERE id = ?)`,
    ).bind(id, url, String(body.alt_text || ''), Number(body.sort_order || 0), is_primary, id);
    let ins: D1Result;
    if (is_primary) {
      const results = await c.env.DB.batch([
        c.env.DB.prepare(`UPDATE product_images SET is_primary = 0 WHERE product_id = ? AND EXISTS (SELECT 1 FROM products WHERE id = ?)`).bind(id, id),
        insert,
        c.env.DB.prepare(`UPDATE products SET image_url = ? WHERE id = ?`).bind(url, id),
      ]);
      ins = results[1];
    } else ins = await insert.run();
    if (!ins.meta?.changes) return c.json({ success: false, error: 'Produit introuvable' }, 404);
    const newId = Number(ins.meta.last_row_id || 0);
    const row = newId
      ? await c.env.DB.prepare(`SELECT * FROM product_images WHERE id = ?`).bind(newId).first()
      : await c.env.DB.prepare(
          `SELECT * FROM product_images WHERE product_id = ? AND url = ? ORDER BY id DESC LIMIT 1`,
        ).bind(id, url).first();
    await afterBusinessMutation(c.env.CACHE, c.env.MOBILE_HUB);
    return c.json({ success: true, data: row ? { ...row, content_type: 'image/webp' } : row, meta: { storage: 'r2', content_type: 'image/webp' } }, 201);
  });

  app.put('/api/catalog/products/:id/images/:imageId', async (c) => {
    await ensureCatalogTables(c.env.DB);
    const productId = c.req.param('id');
    const imageId = c.req.param('imageId');
    const existing = await c.env.DB.prepare(
      `SELECT * FROM product_images WHERE id = ? AND product_id = ?`,
    ).bind(imageId, productId).first() as any;
    if (!existing) return c.json({ success: false, error: 'Image introuvable' }, 404);
    let body: any;
    try { body = await readProductImageJson(c); } catch (e) { return productImageFailure(c, e); }
    let url = String(body.url || existing.url || '').trim();
    const dataUrl = String(body.data_url || body.dataUrl || '').trim();
    if (dataUrl || body.url !== undefined) {
      const source = dataUrl || url;
      if (!source) return c.json({ success: false, code: 'INVALID_IMAGE' }, 400);
      try { url = (await normalizeProductImageReference(c.env, productId, source)).url; }
      catch (e) { return productImageFailure(c, e); }
    }
    const is_primary = body.is_primary ? 1 : Number(existing.is_primary || 0);
    const previousPrimary = Number(existing.is_primary || 0);
    const update = c.env.DB.prepare(
      `UPDATE product_images SET url = ?, alt_text = ?, is_primary = ? WHERE id = ? AND product_id = ? AND url = ? AND COALESCE(is_primary, 0) = ?`,
    ).bind(url, body.alt_text != null ? String(body.alt_text) : existing.alt_text || '', is_primary, imageId, productId, existing.url, previousPrimary);
    const statements: D1PreparedStatement[] = [];
    if (body.is_primary) statements.push(c.env.DB.prepare(`UPDATE product_images SET is_primary = 0 WHERE product_id = ? AND id != ? AND EXISTS (SELECT 1 FROM product_images WHERE id = ? AND product_id = ? AND url = ? AND COALESCE(is_primary, 0) = ?)`)
      .bind(productId, imageId, imageId, productId, existing.url, previousPrimary));
    const updateIndex = statements.length;
    statements.push(update);
    if (is_primary) statements.push(c.env.DB.prepare(`UPDATE products SET image_url = ? WHERE id = ? AND EXISTS (SELECT 1 FROM product_images WHERE id = ? AND product_id = ? AND url = ? AND is_primary = 1)`)
      .bind(url, productId, imageId, productId, url));
    const result = await c.env.DB.batch(statements);
    if (!result[updateIndex].meta?.changes) return c.json({ success: false, code: 'CONFLICT', error: 'Image modifiée entre-temps.' }, 409);
    const row = await c.env.DB.prepare(`SELECT * FROM product_images WHERE id = ?`).bind(imageId).first();
    await afterBusinessMutation(c.env.CACHE, c.env.MOBILE_HUB);
    const normalized = isNormalizedProductUrl(c.env, url);
    return c.json({ success: true, data: row && normalized ? { ...row, content_type: 'image/webp' } : row, message: 'Image mise à jour.' });
  });

  app.delete('/api/catalog/products/:id/images/:imageId', async (c) => {
    await ensureCatalogTables(c.env.DB);
    const imageId = c.req.param('imageId');
    const productId = c.req.param('id');
    const existing = await c.env.DB.prepare(
      `SELECT * FROM product_images WHERE id = ? AND product_id = ?`,
    ).bind(imageId, productId).first() as any;
    if (existing?.url) {
      const key = keyFromCdnUrl(c.env, String(existing.url));
      if (key) await deleteR2Object(c.env.IMAGES, key);
    }
    await c.env.DB.prepare(`DELETE FROM product_images WHERE id = ? AND product_id = ?`)
      .bind(imageId, productId).run();
    if (existing?.is_primary) {
      const next = await c.env.DB.prepare(
        `SELECT url FROM product_images WHERE product_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1`,
      ).bind(productId).first() as any;
      try {
        await c.env.DB.prepare(`UPDATE products SET image_url = ? WHERE id = ?`).bind(next?.url || '', productId).run();
        if (next?.url) {
          await c.env.DB.prepare(`UPDATE product_images SET is_primary = 1 WHERE product_id = ? AND url = ?`).bind(productId, next.url).run();
        }
      } catch { /* */ }
    }
    await afterBusinessMutation(c.env.CACHE, c.env.MOBILE_HUB);
    return c.json({ success: true, message: 'Image supprimée.' });
  });

  /** Public catalog list (no auth) — for future website */
  app.get('/api/public/catalog', async (c) => {
    await ensureCatalogTables(c.env.DB);
    const settings = await c.env.DB.prepare(`SELECT * FROM catalog_settings WHERE id = 1`).first() as any;
    const { results } = await c.env.DB.prepare(`
      SELECT p.id, p.sku, p.name, p.category, p.unit,
             CASE WHEN COALESCE(s.show_prices, 1) = 1 THEN p.price ELSE NULL END as price,
             CASE WHEN COALESCE(s.show_stock, 0) = 1 THEN p.stock_quantity ELSE NULL END as stock_quantity,
             COALESCE(c.slug, p.slug) as slug,
             COALESCE(c.short_description, p.short_description, p.description, '') as short_description,
             c.long_description,
             COALESCE(c.is_featured, 0) as is_featured,
             (SELECT url FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.sort_order LIMIT 1) as image_url
      FROM products p
      LEFT JOIN product_catalog c ON c.product_id = p.id
      CROSS JOIN catalog_settings s
      WHERE p.is_active = 1 AND COALESCE(c.is_public, p.is_public, 0) = 1
      ORDER BY COALESCE(c.is_featured, 0) DESC, p.name
    `).all();
    return c.json({
      success: true,
      data: {
        settings: {
          site_title: settings?.site_title,
          site_tagline: settings?.site_tagline,
          show_prices: settings?.show_prices,
          contact_email: settings?.contact_email,
          contact_phone: settings?.contact_phone,
        },
        products: results || [],
      },
    });
  });
}
