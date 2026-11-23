import type { Hono } from 'hono';
import { afterBusinessMutation } from '../lib/delete-coord';
import { roleCanSeeFinancial } from '../lib/inventory-policy';
import { roundCurrency, sanitizeNonNegativeAmount, sanitizePositiveAmount } from '../lib/financeCore';

export interface DataImportRouteDeps {
  requireBizMutator: (c: any) => { ok: true; username: string; role: string } | { ok: false; response: Response };
  ensureExpenseTypeColumn: (db: D1Database) => Promise<void>;
}

type ImportIssue = { file: string; line?: number; field?: string; rule: string; message: string };

function validateImportClients(rows: any[]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  rows.forEach((r, i) => {
    const line = i + 1;
    const name = String(r.name || r.client_name || '').trim();
    if (!name) issues.push({ file: 'clients', line, field: 'name', rule: 'REQUIRED', message: 'Nom client obligatoire' });
    if (r.email && !String(r.email).includes('@')) {
      issues.push({ file: 'clients', line, field: 'email', rule: 'EMAIL', message: `Email invalide: ${r.email}` });
    }
  });
  return issues;
}

function validateImportProducts(rows: any[]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  rows.forEach((r, i) => {
    const line = i + 1;
    const name = String(r.name || '').trim();
    if (!name) issues.push({ file: 'products', line, field: 'name', rule: 'REQUIRED', message: 'Nom produit obligatoire' });
    const price = Number(r.price ?? r.unit_price);
    if (r.price != null && (!Number.isFinite(price) || price < 0)) {
      issues.push({ file: 'products', line, field: 'price', rule: 'NUMBER', message: `Prix invalide: ${r.price}` });
    }
    const cost = Number(r.cost);
    if (r.cost != null && (!Number.isFinite(cost) || cost < 0)) {
      issues.push({ file: 'products', line, field: 'cost', rule: 'NUMBER', message: `Coût invalide: ${r.cost}` });
    }
    const stock = Number(r.stock_quantity ?? r.stock);
    if (r.stock_quantity != null && (!Number.isFinite(stock) || stock < 0)) {
      issues.push({ file: 'products', line, field: 'stock_quantity', rule: 'STOCK', message: `Stock négatif ou invalide: ${r.stock_quantity}` });
    }
  });
  return issues;
}

function validateImportLedger(rows: any[]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  rows.forEach((r, i) => {
    const line = i + 1;
    const amount = Number(r.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      issues.push({ file: 'ledger', line, field: 'amount', rule: 'AMOUNT', message: `Montant invalide: ${r.amount}` });
    }
    if (!String(r.description || r.category || '').trim()) {
      issues.push({ file: 'ledger', line, field: 'description', rule: 'REQUIRED', message: 'Description obligatoire' });
    }
  });
  return issues;
}

function validateImportInvoices(rows: any[]): ImportIssue[] {
  const issues: ImportIssue[] = [];
  rows.forEach((r, i) => {
    const line = i + 1;
    const items = Array.isArray(r.items) ? r.items : [];
    if (!items.length) {
      issues.push({ file: 'invoices', line, field: 'items', rule: 'LINES', message: 'Au moins une ligne requise' });
      return;
    }
    let ht = 0;
    let tax = 0;
    items.forEach((it: any, j: number) => {
      const qty = Number(it.quantity);
      const unit = Number(it.unit_price);
      const rate = Number(it.tax_rate ?? 0);
      if (!Number.isFinite(qty) || qty <= 0) {
        issues.push({ file: 'invoices', line, field: `items[${j}].quantity`, rule: 'QTY', message: 'Quantité invalide' });
      }
      if (!Number.isFinite(unit) || unit < 0) {
        issues.push({ file: 'invoices', line, field: `items[${j}].unit_price`, rule: 'PRICE', message: 'Prix invalide' });
      }
      const lineHt = (Number.isFinite(qty) ? qty : 0) * (Number.isFinite(unit) ? unit : 0);
      ht += lineHt;
      tax += lineHt * ((Number.isFinite(rate) ? rate : 0) / 100);
    });
    const declared = Number(r.total);
    if (Number.isFinite(declared) && Math.abs(declared - (ht + tax)) > 0.5) {
      issues.push({
        file: 'invoices',
        line,
        field: 'total',
        rule: 'MATH',
        message: `Total déclaré ${declared} ≠ HT+TVA ${(ht + tax).toFixed(2)}`,
      });
    }
  });
  return issues;
}

export function registerDataImportRoutes(app: Hono<any>, deps: DataImportRouteDeps): void {
  const { requireBizMutator, ensureExpenseTypeColumn } = deps;

  /** Dry-run: never writes. Reject-all if any issue. */
  app.post('/api/import/validate', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const body = await c.req.json().catch(() => ({}));
    const issues: ImportIssue[] = [];

    if (Array.isArray(body.clients)) issues.push(...validateImportClients(body.clients));
    if (Array.isArray(body.products)) issues.push(...validateImportProducts(body.products));
    if (Array.isArray(body.ledger) || Array.isArray(body.expenses)) {
      issues.push(...validateImportLedger(body.ledger || body.expenses));
    }
    if (Array.isArray(body.invoices)) issues.push(...validateImportInvoices(body.invoices));

    if (Array.isArray(body.invoices)) {
      for (let i = 0; i < body.invoices.length; i++) {
        const inv = body.invoices[i];
        const cid = inv.client_id != null ? Number(inv.client_id) : null;
        if (cid) {
          const exists = await c.env.DB.prepare(`SELECT id FROM clients WHERE id = ?`).bind(cid).first();
          if (!exists) {
            issues.push({
              file: 'invoices',
              line: i + 1,
              field: 'client_id',
              rule: 'FK',
              message: `Client #${cid} introuvable`,
            });
          }
        }
        for (let j = 0; j < (inv.items || []).length; j++) {
          const pid = inv.items[j]?.product_id != null ? Number(inv.items[j].product_id) : null;
          if (pid) {
            const p = await c.env.DB.prepare(`SELECT id, stock_quantity, track_inventory FROM products WHERE id = ?`).bind(pid).first() as any;
            if (!p) {
              issues.push({
                file: 'invoices',
                line: i + 1,
                field: `items[${j}].product_id`,
                rule: 'FK',
                message: `Produit #${pid} introuvable`,
              });
            } else if (Number(p.track_inventory) && Number(inv.items[j].quantity) > Number(p.stock_quantity || 0) + 0.001) {
              issues.push({
                file: 'invoices',
                line: i + 1,
                field: `items[${j}].quantity`,
                rule: 'STOCK',
                message: `Stock insuffisant produit #${pid} (dispo ${p.stock_quantity}, demandé ${inv.items[j].quantity})`,
              });
            }
          }
        }
      }
    }

    if (!Array.isArray(body.clients) && !Array.isArray(body.products) && !Array.isArray(body.ledger) && !Array.isArray(body.expenses) && !Array.isArray(body.invoices)) {
      return c.json({
        success: false,
        error: 'Payload vide. Envoyez { clients, products, ledger, invoices }.',
        code: 'EMPTY_IMPORT',
      }, 400);
    }

    if (issues.length) {
      return c.json({
        success: false,
        error: `Import refusé: ${issues.length} erreur(s). Aucune donnée écrite.`,
        code: 'IMPORT_REJECTED',
        issues,
      }, 400);
    }

    return c.json({
      success: true,
      message: 'Validation OK — aucune écriture. Vous pouvez appeler /api/import/commit.',
      data: {
        counts: {
          clients: Array.isArray(body.clients) ? body.clients.length : 0,
          products: Array.isArray(body.products) ? body.products.length : 0,
          ledger: Array.isArray(body.ledger || body.expenses) ? (body.ledger || body.expenses).length : 0,
          invoices: Array.isArray(body.invoices) ? body.invoices.length : 0,
        },
      },
    });
  });

  /** Commit only after validate would pass — re-validates then writes atomically (reject-all). */
  app.post('/api/import/commit', async (c) => {
    const gate = requireBizMutator(c);
    if (!gate.ok) return gate.response;
    const body = await c.req.json().catch(() => ({}));
    const hasLedger = Array.isArray(body.ledger) || Array.isArray(body.expenses);
    if (hasLedger && !roleCanSeeFinancial(gate.role)) {
      return c.json({
        success: false,
        error: 'Import de trésorerie réservé au propriétaire ou administrateur.',
        code: 'FORBIDDEN_ROLE',
      }, 403);
    }

    const issues: ImportIssue[] = [];
    if (Array.isArray(body.clients)) issues.push(...validateImportClients(body.clients));
    if (Array.isArray(body.products)) issues.push(...validateImportProducts(body.products));
    if (hasLedger) {
      issues.push(...validateImportLedger(body.ledger || body.expenses));
    }
    if (Array.isArray(body.invoices)) issues.push(...validateImportInvoices(body.invoices));
    if (issues.length) {
      return c.json({
        success: false,
        error: `Import refusé: ${issues.length} erreur(s). Aucune donnée écrite.`,
        code: 'IMPORT_REJECTED',
        issues,
      }, 400);
    }

    let currency = 'MAD';
    try {
      const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
      currency = String(settings?.currency || settings?.finance_currency || 'MAD');
    } catch { /* default MAD */ }

    const stmts: D1PreparedStatement[] = [];
    if (Array.isArray(body.clients)) {
      for (const r of body.clients) {
        stmts.push(
          c.env.DB.prepare(
            `INSERT INTO clients (name, ice, email, phone, address, city) VALUES (?, ?, ?, ?, ?, ?)`,
          ).bind(
            String(r.name || r.client_name || '').trim(),
            String(r.ice || ''),
            String(r.email || ''),
            String(r.phone || ''),
            String(r.address || ''),
            String(r.city || ''),
          ),
        );
      }
    }
    if (Array.isArray(body.products)) {
      for (const r of body.products) {
        const priceVal = sanitizeNonNegativeAmount(r.price ?? r.unit_price ?? 0, { decimals: 2 });
        const costVal = r.cost != null ? sanitizeNonNegativeAmount(r.cost, { decimals: 2 }) : 0;
        if (priceVal == null || costVal == null) {
          return c.json({ success: false, error: 'Prix ou coût produit invalide.', code: 'IMPORT_REJECTED' }, 400);
        }
        stmts.push(
          c.env.DB.prepare(
            `INSERT INTO products (name, sku, barcode, price, cost, stock_quantity, is_active, track_inventory) VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
          ).bind(
            String(r.name || '').trim(),
            String(r.sku || ''),
            String(r.barcode || ''),
            roundCurrency(priceVal, currency, 'invoice'),
            roundCurrency(costVal, currency, 'invoice'),
            Number(r.stock_quantity ?? r.stock ?? 0),
          ),
        );
      }
    }
    if (hasLedger) {
      await ensureExpenseTypeColumn(c.env.DB);
      for (const r of body.ledger || body.expenses) {
        const amt = sanitizePositiveAmount(r.amount, { decimals: 2 });
        if (amt == null) {
          return c.json({ success: false, error: `Montant invalide: ${r.amount}`, code: 'IMPORT_REJECTED' }, 400);
        }
        const entryType = r.entry_type === 'income' ? 'income' : 'expense';
        stmts.push(
          c.env.DB.prepare(
            `INSERT INTO expenses (category, description, amount, payment_method, expense_date, vendor_name, reference, notes, entry_type)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            String(r.category || 'Import'),
            String(r.description || 'Import'),
            roundCurrency(amt, currency, 'ledger'),
            String(r.payment_method || 'cash'),
            String(r.date || r.expense_date || new Date().toISOString().slice(0, 10)).slice(0, 10),
            String(r.vendor || ''),
            String(r.reference || 'import'),
            String(r.notes || ''),
            entryType,
          ),
        );
      }
    }

    const inserted = stmts.length;
    try {
      for (let i = 0; i < stmts.length; i += 100) {
        await c.env.DB.batch(stmts.slice(i, i + 100));
      }
    } catch (e: any) {
      return c.json({
        success: false,
        error: e?.message || 'Échec écriture — vérifiez les données',
        code: 'IMPORT_WRITE_FAILED',
      }, 400);
    }

    await afterBusinessMutation(c.env.CACHE);
    return c.json({
      success: true,
      message: `Import terminé: ${inserted} enregistrement(s).`,
      count: inserted,
    });
  });
}
