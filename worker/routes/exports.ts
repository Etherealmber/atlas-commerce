import type { Hono } from 'hono';
import {
  aggregateDocumentTotals,
  computeBillLine,
  getCurrencySpec,
  roundCurrency,
  sanitizeNonNegativeAmount,
  sumMoneyAmounts,
} from '../lib/financeCore';
import { canMutateBusiness, normalizeRole } from '../lib/rbac';
import { roleCanSeeFinancial, roleCanSeeSellPrices } from '../lib/inventory-policy';

export interface ExportRouteDeps {
  roundDh: (n: number) => number;
  sessionUserFromHeader: (authHeader?: string) => { username?: string; role?: string };
  requireOwner: (c: any) => { ok: true; username: string; role?: string } | { ok: false; response: Response };
  ensureExpenseTypeColumn: (db: D1Database) => Promise<void>;
  ensurePaymentHistoryTable: (db: D1Database) => Promise<void>;
}

export function csvEscape(v: any): string {
  if (v == null) return '';
  if (typeof v === 'number' && Number.isFinite(v)) {
    return String(v).replace('.', ',');
  }
  let s = String(v);
  // Neutralize CSV formula injection (Excel/LibreOffice/Google Sheets) on untrusted strings
  if (/^[=+\t\r@]/.test(s) || (s.startsWith('-') && !/^-\d+([.,]\d+)?$/.test(s))) {
    s = `'${s}`;
  }
  if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers: string[], rows: any[][]): string {
  const bom = '\uFEFF';
  const lines = [headers.map(csvEscape).join(';')];
  for (const r of rows) lines.push(r.map(csvEscape).join(';'));
  return bom + lines.join('\r\n');
}

function csvFilename(base: string): string {
  const d = new Date().toISOString().slice(0, 10);
  return `${base}-${d}.csv`;
}

export function registerExportRoutes(app: Hono<any>, deps: ExportRouteDeps): void {
  const {
    sessionUserFromHeader,
    requireOwner,
    ensureExpenseTypeColumn,
    ensurePaymentHistoryTable,
  } = deps;

  function requireExportBizRole(c: any): Response | null {
    const sess = sessionUserFromHeader(c.req.header('Authorization'));
    const role = normalizeRole(sess?.role);
    if (!sess?.username || !canMutateBusiness(role)) {
      return c.json({
        success: false,
        error: 'Votre rôle ne permet pas cette action.',
        code: 'FORBIDDEN_ROLE',
        role,
      }, 403);
    }
    return null;
  }

  /* ─── Import bills (from seller invoice / Excel review) ─── */
  app.post('/api/bills/import', async (c) => {
    const denied = requireExportBizRole(c);
    if (denied) return denied;
    const body = await c.req.json().catch(() => ({}));
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) return c.json({ success: false, error: "Aucune facture d'achat à importer" }, 400);
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const currency = String(settings?.currency || settings?.finance_currency || 'MAD');
    let inserted = 0;
    const created: any[] = [];
    for (const row of rows) {
      const vendor_name = String(row.vendor_name || row.fournisseur || row.seller || '').trim();
      if (!vendor_name) continue;
      const items = Array.isArray(row.items) ? row.items : [];
      if (!items.length && !(row.total || row.montant)) continue;
      let subtotal = 0, tax_amount = 0;
      const lineItems: any[] = [];
      let invalidRow = false;
      if (items.length) {
        for (const it of items) {
          const qty = Number(it.quantity ?? it.qte ?? 1);
          const price = Number(it.unit_price ?? it.prix ?? it.price ?? 0);
          const taxRate = Number(it.tax_rate ?? settings?.tax_rate ?? 0);
          if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price < 0 || !Number.isFinite(taxRate) || taxRate < 0) {
            invalidRow = true;
            break;
          }
          const calc = computeBillLine({ quantity: qty, unitCost: price, taxRate, defaultTax: Number(settings?.tax_rate ?? 0), currency });
          subtotal += calc.line_ht;
          tax_amount += calc.line_tax;
          lineItems.push({ product_name: it.product_name || it.designation || it.name || 'Article', quantity: calc.quantity, unit_price: calc.unit_cost, tax_rate: calc.tax_rate, line_total: calc.line_total, sku: it.sku || '' });
        }
      } else {
        const safeTotal = sanitizeNonNegativeAmount(row.total ?? row.montant ?? 0, { max: 1e12, decimals: 2 });
        if (safeTotal == null || safeTotal <= 0) invalidRow = true;
        else {
          const calc = computeBillLine({ quantity: 1, unitCost: roundCurrency(safeTotal, currency, 'invoice'), taxRate: 0, defaultTax: 0, currency });
          subtotal = calc.line_ht;
          lineItems.push({ product_name: row.description || 'Import facture fournisseur', quantity: 1, unit_price: calc.unit_cost, tax_rate: 0, line_total: calc.line_total, sku: '' });
        }
      }
      if (invalidRow || !lineItems.length) continue;
      const billTotals = aggregateDocumentTotals([{ line_ht: subtotal, line_tax_real: tax_amount }], currency);
      subtotal = billTotals.subtotal; tax_amount = billTotals.tax_amount; const total = billTotals.total;
      const prefix = settings?.bill_prefix || 'BILL-';
      const nextNum = settings?.next_bill_number || 1;
      const number = `${prefix}${String(nextNum).padStart(5, '0')}`;
      const issue_date = String(row.issue_date || row.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
      const due_date = row.due_date || null;
      const status = row.status === 'paid' ? 'paid' : 'sent';
      const rawPaid = sanitizeNonNegativeAmount(row.amount_paid ?? 0, { max: total, decimals: 2 }) ?? 0;
      const amount_paid = status === 'paid' ? total : Math.min(total, rawPaid);
      const result = await c.env.DB.prepare(
        `INSERT INTO bills (number, vendor_id, vendor_name, issue_date, due_date, status, subtotal, tax_amount, total, amount_paid, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(number, null, vendor_name, issue_date, due_date, status, subtotal, tax_amount, total, amount_paid, row.notes || 'Import').run();
      const billId = result.meta.last_row_id;
      for (const it of lineItems) {
        await c.env.DB.prepare(
          `INSERT INTO bill_items (bill_id, product_id, product_name, sku, quantity, unit_cost, tax_rate, line_total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(billId, null, it.product_name, it.sku, it.quantity, it.unit_cost ?? it.unit_price, it.tax_rate, it.line_total).run();
      }
      await c.env.DB.prepare(`UPDATE company_settings SET next_bill_number = COALESCE(next_bill_number, 1) + 1 WHERE id = 1`).run();
      created.push({ id: billId, number, vendor_name, total });
      inserted++;
    }
    return c.json({ success: true, message: `${inserted} facture(s) d'achat importée(s).`, count: inserted, data: created });
  });

  app.get('/api/export/invoices', async (c) => {
    const denied = requireExportBizRole(c);
    if (denied) return denied;
    const { results } = await c.env.DB.prepare(
      `SELECT number, client_name, issue_date, due_date, status, subtotal, tax_amount, total, amount_paid,
              (total - COALESCE(amount_paid,0)) as remaining, notes FROM invoices ORDER BY issue_date DESC, id DESC`,
    ).all();
    const statusFr: Record<string, string> = {
      draft: 'Brouillon', quote: 'Devis', devis: 'Devis', sent: 'Envoyee', partial: 'Partielle',
      paid: 'Payee', overdue: 'En retard', cancelled: 'Annulee',
    };
    const rows = ((results || []) as any[]).map((r) => [
      r.number, r.client_name, r.issue_date, r.due_date, statusFr[r.status] || r.status,
      Number(r.subtotal || 0), Number(r.tax_amount || 0), Number(r.total || 0),
      Number(r.amount_paid || 0), Number(r.remaining || 0), r.notes || '',
    ]);
    const csv = toCsv(
      ['Numero', 'Client', 'Date emission', 'Echeance', 'Statut', 'Montant HT', 'TVA', 'Total TTC', 'Deja paye', 'Reste a payer', 'Notes'],
      rows,
    );
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="factures.csv"',
      },
    });
  });

  app.get('/api/export/products', async (c) => {
    const session = sessionUserFromHeader(c.req.header('Authorization'));
    if (!session.username) {
      return c.json({ success: false, error: 'Authentification requise.' }, 401);
    }
    let results: any[] = [];
    try {
      const q = await c.env.DB.prepare(
        `SELECT sku, barcode, name, description, category, unit, cost, price, tax_rate,
                stock_quantity, low_stock_threshold, track_inventory, is_active,
                variant_label, parent_id
         FROM products
         ORDER BY COALESCE(category,''), name COLLATE NOCASE`,
      ).all();
      results = (q.results || []) as any[];
    } catch {
      const q = await c.env.DB.prepare(
        `SELECT sku, name, category, unit, cost, price, stock_quantity, low_stock_threshold, is_active
         FROM products ORDER BY name`,
      ).all();
      results = (q.results || []) as any[];
    }
    const canFinancial = roleCanSeeFinancial(session.role || '');
    const canSell = roleCanSeeSellPrices(session.role || '');
    const rows = results.map((r) => {
      const stock = Number(r.stock_quantity ?? 0);
      const seuil = Number(r.low_stock_threshold ?? 0);
      const track = r.track_inventory == null || Number(r.track_inventory) === 1;
      let alerte = '';
      if (track) {
        if (stock <= 0) alerte = 'Rupture';
        else if (stock <= seuil) alerte = 'Stock bas';
        else alerte = 'OK';
      } else {
        alerte = 'Non suivi';
      }
      return [
        r.sku || '',
        r.barcode || '',
        r.name || '',
        r.description || '',
        r.category || '',
        r.unit || 'unité',
        r.variant_label || '',
        canFinancial ? Number(r.cost ?? 0) : '',
        canSell ? Number(r.price ?? 0) : '',
        r.tax_rate != null && r.tax_rate !== '' ? Number(r.tax_rate) : '',
        stock,
        seuil,
        track ? 'Oui' : 'Non',
        Number(r.is_active) === 0 ? 'Non' : 'Oui',
        alerte,
      ];
    });
    const csv = toCsv(
      [
        'SKU', 'Code-barres', 'Nom', 'Description', 'Catégorie', 'Unité', 'Variante',
        'Coût', 'Prix vente', 'TVA %', 'Stock', 'Seuil bas', 'Suivi stock', 'Actif', 'Alerte',
      ],
      rows,
    );
    const fname = csvFilename('produits');
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fname}"`,
        'Cache-Control': 'no-store',
      },
    });
  });

  app.get('/api/export/expenses', async (c) => {
    const denied = requireExportBizRole(c);
    if (denied) return denied;
    await ensureExpenseTypeColumn(c.env.DB);
    const { results } = await c.env.DB.prepare(
      `SELECT expense_date, entry_type, category, description, amount, payment_method, vendor_name, notes FROM expenses ORDER BY expense_date DESC`,
    ).all();
    const rows = ((results || []) as any[]).map((r) => [
      r.expense_date, r.entry_type, r.category, r.description, r.amount, r.payment_method, r.vendor_name, r.notes,
    ]);
    const csv = toCsv(
      ['Date', 'Type', 'Categorie', 'Libelle', 'Montant', 'Mode', 'Tiers', 'Notes'],
      rows,
    );
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="solde-mouvements.csv"',
      },
    });
  });

  app.get('/api/export/clients', async (c) => {
    const denied = requireExportBizRole(c);
    if (denied) return denied;
    const { results } = await c.env.DB.prepare(`SELECT name, ice, if_number, address, city, phone, email FROM clients ORDER BY name`).all();
    const rows = ((results || []) as any[]).map((r) => [r.name, r.ice, r.if_number, r.address, r.city, r.phone, r.email]);
    const csv = toCsv(['Nom', 'ICE', 'IF', 'Adresse', 'Ville', 'Telephone', 'Email'], rows);
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="clients.csv"',
      },
    });
  });

  app.get('/api/export/payments', async (c) => {
    const denied = requireExportBizRole(c);
    if (denied) return denied;
    await ensurePaymentHistoryTable(c.env.DB);
    const { results } = await c.env.DB.prepare(
      `SELECT p.paid_at, i.number, i.client_name, p.amount, p.payment_method, p.payee, p.note
       FROM invoice_payments p LEFT JOIN invoices i ON i.id = p.invoice_id
       ORDER BY p.paid_at DESC, p.id DESC`,
    ).all();
    const rows = ((results || []) as any[]).map((r) => [
      r.paid_at, r.number, r.client_name, r.amount, r.payment_method, r.payee, r.note,
    ]);
    const csv = toCsv(['Date', 'Facture', 'Client', 'Montant', 'Mode', 'Beneficiaire', 'Note'], rows);
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="paiements.csv"',
      },
    });
  });

  app.get('/api/export/month-pack', async (c) => {
    const gate = requireOwner(c);
    if (!gate.ok) return gate.response;
    await ensurePaymentHistoryTable(c.env.DB);
    const month = String(c.req.query('month') || new Date().toISOString().slice(0, 7));
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return c.json({ success: false, error: 'Paramètre month=YYYY-MM requis' }, 400);
    }
    const from = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    const to = `${month}-${String(last).padStart(2, '0')}`;
    const format = String(c.req.query('format') || 'json').toLowerCase();

    const invoices = await c.env.DB.prepare(
      `SELECT id, number, client_name, issue_date, due_date, status, total, amount_paid,
              COALESCE(tax_amount, 0) AS tax_amount, doc_kind
       FROM invoices WHERE issue_date >= ? AND issue_date <= ?
       ORDER BY issue_date, id`,
    ).bind(from, to).all();

    const payments = await c.env.DB.prepare(
      `SELECT p.id, p.paid_at, p.amount, p.payment_method, p.payee, p.note, i.number as invoice_number, i.client_name
       FROM invoice_payments p
       LEFT JOIN invoices i ON i.id = p.invoice_id
       WHERE substr(p.paid_at, 1, 10) >= ? AND substr(p.paid_at, 1, 10) <= ?
       ORDER BY p.paid_at, p.id`,
    ).bind(from, to).all();

    let stockMoves: any[] = [];
    try {
      const sm = await c.env.DB.prepare(
        `SELECT m.id, m.created_at, m.type, m.quantity, m.previous_quantity, m.new_quantity, m.reason, m.reference, p.name as product_name, p.sku
         FROM stock_movements m
         LEFT JOIN products p ON p.id = m.product_id
         WHERE substr(m.created_at, 1, 10) >= ? AND substr(m.created_at, 1, 10) <= ?
         ORDER BY m.created_at, m.id
         LIMIT 5000`,
      ).bind(from, to).all();
      stockMoves = sm.results || [];
    } catch {
      stockMoves = [];
    }

    let expenses: any[] = [];
    try {
      const ex = await c.env.DB.prepare(
        `SELECT id, expense_date, entry_type, category, description, amount, payment_method, vendor_name
         FROM expenses WHERE expense_date >= ? AND expense_date <= ?
         ORDER BY expense_date, id`,
      ).bind(from, to).all();
      expenses = ex.results || [];
    } catch {
      expenses = [];
    }

    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const currency = String(settings?.currency || settings?.finance_currency || 'MAD');
    const finDecimals = getCurrencySpec(currency).minorDecimals;
    const invRows = (invoices.results || []) as any[];
    const payRows = (payments.results || []) as any[];
    const salesTotal = sumMoneyAmounts(
      invRows
        .filter((i) => i.status !== 'cancelled' && i.status !== 'quote' && i.status !== 'devis' && i.doc_kind !== 'remboursement' && i.status !== 'remboursement')
        .map((i) => Number(i.total || 0)),
      finDecimals,
    );
    const paidTotal = sumMoneyAmounts(payRows.map((p) => Number(p.amount || 0)), finDecimals);
    const expenseTotal = sumMoneyAmounts(expenses.map((e) => Number(e.amount || 0)), finDecimals);

    const pack = {
      meta: {
        month, from, to,
        generated_at: new Date().toISOString(),
        company: settings?.company_name || 'Atlas Commerce',
        currency,
        app: 'Atlas Commerce',
        phase: 5,
      },
      summary: {
        invoices_count: invRows.length,
        payments_count: payRows.length,
        stock_moves_count: stockMoves.length,
        expenses_count: expenses.length,
        sales_total: salesTotal,
        payments_total: paidTotal,
        expenses_total: expenseTotal,
        starting_balance: Number(settings?.starting_balance || 0),
      },
      invoices: invRows,
      payments: payRows,
      stock_moves: stockMoves,
      expenses,
    };

    if (format === 'csv') {
      const sections: string[] = [];
      sections.push('### RESUME');
      sections.push(toCsv(
        ['Mois', 'Factures', 'Paiements', 'Mvt stock', 'Depenses', 'CA', 'Encaisse', `Depenses ${currency}`],
        [[month, pack.summary.invoices_count, pack.summary.payments_count, pack.summary.stock_moves_count, pack.summary.expenses_count, salesTotal, paidTotal, expenseTotal]],
      ));
      sections.push('\n### FACTURES');
      sections.push(toCsv(
        ['Numero', 'Client', 'Date', 'Echeance', 'Statut', 'Total', 'Paye'],
        invRows.map((r) => [r.number, r.client_name, r.issue_date, r.due_date, r.status, r.total, r.amount_paid]),
      ));
      sections.push('\n### PAIEMENTS');
      sections.push(toCsv(
        ['Date', 'Facture', 'Client', 'Montant', 'Mode', 'Beneficiaire', 'Note'],
        payRows.map((r) => [r.paid_at, r.invoice_number, r.client_name, r.amount, r.payment_method, r.payee, r.note]),
      ));
      sections.push('\n### STOCK');
      sections.push(toCsv(
        ['Date', 'Produit', 'SKU', 'Type', 'Qte', 'Avant', 'Apres', 'Raison', 'Ref'],
        stockMoves.map((r: any) => [r.created_at, r.product_name, r.sku, r.type, r.quantity, r.previous_quantity, r.new_quantity, r.reason, r.reference]),
      ));
      const csv = sections.join('\n');
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="atlas-pack-${month}.csv"`,
        },
      });
    }

    const body = JSON.stringify(pack, null, 2);
    return new Response(body, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="atlas-pack-${month}.json"`,
      },
    });
  });
}
