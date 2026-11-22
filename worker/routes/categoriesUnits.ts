import type { Hono } from 'hono';

export interface CategoriesUnitsRouteDeps {
  ensureCategoriesTable: (db: D1Database) => Promise<void>;
  ensureUnitsTable: (db: D1Database) => Promise<void>;
  checkConfirmPassword: (env: any, db: D1Database, authHeader: string | undefined, body: any) => Promise<any>;
}

export function registerCategoriesUnitsRoutes(app: Hono<any>, deps: CategoriesUnitsRouteDeps): void {
  const { ensureCategoriesTable, ensureUnitsTable, checkConfirmPassword } = deps;

  app.get('/api/categories', async (c) => {
    await ensureCategoriesTable(c.env.DB);
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM product_categories ORDER BY sort_order ASC, name ASC`,
    ).all();
    const { results: used } = await c.env.DB.prepare(
      `SELECT DISTINCT category as name FROM products WHERE category IS NOT NULL AND TRIM(category) != '' ORDER BY category`,
    ).all();
    const names = new Set((results || []).map((r: any) => String(r.name).toLowerCase()));
    const extra = ((used || []) as any[])
      .filter((u) => u.name && !names.has(String(u.name).toLowerCase()))
      .map((u) => ({ id: null, name: u.name, description: '', sort_order: 999, from_products: true }));
    return c.json({ success: true, data: [...(results || []), ...extra] });
  });

  app.post('/api/categories', async (c) => {
    await ensureCategoriesTable(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const name = String(body.name || '').trim();
    if (!name) return c.json({ success: false, error: 'Nom de catégorie obligatoire' }, 400);
    try {
      const r = await c.env.DB.prepare(
        `INSERT INTO product_categories (name, description, sort_order) VALUES (?, ?, ?)`,
      ).bind(name, String(body.description || ''), Number(body.sort_order || 0)).run();
      const row = await c.env.DB.prepare(`SELECT * FROM product_categories WHERE id = ?`).bind(r.meta.last_row_id).first();
      return c.json({ success: true, data: row, message: 'Catégorie créée.' }, 201);
    } catch (e: any) {
      if (String(e?.message || e).includes('UNIQUE')) {
        return c.json({ success: false, error: 'Cette catégorie existe déjà.', code: 'DUPLICATE_CATEGORY' }, 409);
      }
      throw e;
    }
  });

  app.put('/api/categories/:id', async (c) => {
    await ensureCategoriesTable(c.env.DB);
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const existing = await c.env.DB.prepare(`SELECT * FROM product_categories WHERE id = ?`).bind(id).first() as any;
    if (!existing) return c.json({ success: false, error: 'Catégorie introuvable' }, 404);
    const name = body.name !== undefined ? String(body.name).trim() : existing.name;
    if (!name) return c.json({ success: false, error: 'Nom obligatoire' }, 400);
    const description = body.description !== undefined ? String(body.description) : existing.description;
    const sort_order = body.sort_order !== undefined ? Number(body.sort_order) : existing.sort_order;
    await c.env.DB.prepare(
      `UPDATE product_categories SET name = ?, description = ?, sort_order = ? WHERE id = ?`,
    ).bind(name, description, sort_order, id).run();
    if (name !== existing.name) {
      await c.env.DB.prepare(`UPDATE products SET category = ? WHERE category = ?`).bind(name, existing.name).run();
    }
    const row = await c.env.DB.prepare(`SELECT * FROM product_categories WHERE id = ?`).bind(id).first();
    return c.json({ success: true, data: row, message: 'Catégorie mise à jour.' });
  });

  app.delete('/api/categories/:id', async (c) => {
    await ensureCategoriesTable(c.env.DB);
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
    if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);

    if (id === 'by-name' || id === '0') {
      const name = String(body.name || '').trim();
      if (!name) return c.json({ success: false, error: 'Nom de catégorie obligatoire' }, 400);
      const row = await c.env.DB.prepare(`SELECT * FROM product_categories WHERE LOWER(name) = LOWER(?)`).bind(name).first() as any;
      if (row) {
        await c.env.DB.prepare(`UPDATE products SET category = NULL WHERE category = ? OR LOWER(category) = LOWER(?)`).bind(row.name, row.name).run();
        await c.env.DB.prepare(`DELETE FROM product_categories WHERE id = ?`).bind(row.id).run();
        return c.json({ success: true, message: `Catégorie « ${row.name} » supprimée.` });
      }
      const cleared = await c.env.DB.prepare(
        `UPDATE products SET category = NULL WHERE category = ? OR LOWER(category) = LOWER(?)`,
      ).bind(name, name).run();
      return c.json({
        success: true,
        message: `Libellé « ${name} » retiré des produits.`,
        cleared: cleared.meta?.changes || 0,
      });
    }

    const existing = await c.env.DB.prepare(`SELECT * FROM product_categories WHERE id = ?`).bind(id).first() as any;
    if (!existing) return c.json({ success: false, error: 'Catégorie introuvable' }, 404);
    await c.env.DB.prepare(
      `UPDATE products SET category = NULL WHERE category = ? OR LOWER(category) = LOWER(?)`,
    ).bind(existing.name, existing.name).run();
    await c.env.DB.prepare(`DELETE FROM product_categories WHERE id = ?`).bind(id).run();
    return c.json({ success: true, message: `Catégorie « ${existing.name} » supprimée.` });
  });

  app.get('/api/units', async (c) => {
    await ensureUnitsTable(c.env.DB);
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM product_units ORDER BY sort_order ASC, name ASC`,
    ).all();
    const { results: used } = await c.env.DB.prepare(
      `SELECT DISTINCT unit as name FROM products WHERE unit IS NOT NULL AND TRIM(unit) != '' ORDER BY unit`,
    ).all();
    const names = new Set((results || []).map((r: any) => String(r.name).toLowerCase()));
    const extra = ((used || []) as any[])
      .filter((u) => u.name && !names.has(String(u.name).toLowerCase()))
      .map((u) => ({ id: null, name: u.name, symbol: '', sort_order: 999, from_products: true }));
    return c.json({ success: true, data: [...(results || []), ...extra] });
  });

  app.post('/api/units', async (c) => {
    await ensureUnitsTable(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const name = String(body.name || '').trim();
    if (!name) return c.json({ success: false, error: "Nom d'unité obligatoire" }, 400);
    try {
      const r = await c.env.DB.prepare(
        `INSERT INTO product_units (name, symbol, sort_order) VALUES (?, ?, ?)`,
      ).bind(name, String(body.symbol || ''), Number(body.sort_order || 0)).run();
      const row = await c.env.DB.prepare(`SELECT * FROM product_units WHERE id = ?`).bind(r.meta.last_row_id).first();
      return c.json({ success: true, data: row, message: 'Unité créée.' }, 201);
    } catch (e: any) {
      if (String(e?.message || e).includes('UNIQUE')) {
        return c.json({ success: false, error: 'Cette unité existe déjà.', code: 'DUPLICATE_UNIT' }, 409);
      }
      throw e;
    }
  });

  app.put('/api/units/:id', async (c) => {
    await ensureUnitsTable(c.env.DB);
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const existing = await c.env.DB.prepare(`SELECT * FROM product_units WHERE id = ?`).bind(id).first() as any;
    if (!existing) return c.json({ success: false, error: 'Unité introuvable' }, 404);
    const name = body.name !== undefined ? String(body.name).trim() : existing.name;
    if (!name) return c.json({ success: false, error: 'Nom obligatoire' }, 400);
    const symbol = body.symbol !== undefined ? String(body.symbol) : existing.symbol;
    const sort_order = body.sort_order !== undefined ? Number(body.sort_order) : existing.sort_order;
    await c.env.DB.prepare(
      `UPDATE product_units SET name = ?, symbol = ?, sort_order = ? WHERE id = ?`,
    ).bind(name, symbol, sort_order, id).run();
    if (name !== existing.name) {
      await c.env.DB.prepare(`UPDATE products SET unit = ? WHERE unit = ?`).bind(name, existing.name).run();
    }
    const row = await c.env.DB.prepare(`SELECT * FROM product_units WHERE id = ?`).bind(id).first();
    return c.json({ success: true, data: row, message: 'Unité mise à jour.' });
  });

  app.delete('/api/units/:id', async (c) => {
    await ensureUnitsTable(c.env.DB);
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const pw = await checkConfirmPassword(c.env, c.env.DB, c.req.header('Authorization'), body);
    if (!pw.ok) return c.json({ success: false, error: pw.error, code: pw.code }, pw.status);

    if (id === 'by-name' || id === '0') {
      const name = String(body.name || '').trim();
      if (!name) return c.json({ success: false, error: "Nom d'unité obligatoire" }, 400);
      const row = await c.env.DB.prepare(`SELECT * FROM product_units WHERE LOWER(name) = LOWER(?)`).bind(name).first() as any;
      if (row) {
        await c.env.DB.prepare(`UPDATE products SET unit = 'unité' WHERE unit = ? OR LOWER(unit) = LOWER(?)`).bind(row.name, row.name).run();
        await c.env.DB.prepare(`DELETE FROM product_units WHERE id = ?`).bind(row.id).run();
        return c.json({ success: true, message: `Unité « ${row.name} » supprimée.` });
      }
      await c.env.DB.prepare(`UPDATE products SET unit = 'unité' WHERE unit = ? OR LOWER(unit) = LOWER(?)`).bind(name, name).run();
      return c.json({ success: true, message: `Libellé unité « ${name} » retiré des produits.` });
    }

    const existing = await c.env.DB.prepare(`SELECT * FROM product_units WHERE id = ?`).bind(id).first() as any;
    if (!existing) return c.json({ success: false, error: 'Unité introuvable' }, 404);
    await c.env.DB.prepare(`UPDATE products SET unit = 'unité' WHERE unit = ? OR LOWER(unit) = LOWER(?)`).bind(existing.name, existing.name).run();
    await c.env.DB.prepare(`DELETE FROM product_units WHERE id = ?`).bind(id).run();
    return c.json({ success: true, message: `Unité « ${existing.name} » supprimée.` });
  });
}
