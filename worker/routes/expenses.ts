/**
 * v264 — Ledger WRITE routes (owner/admin only), extracted from the monolith
 * so the authorization contract is integration-tested (worker/__tests__/expenses-auth.test.ts).
 *
 * Audit finding fixed here: POST /api/expenses and POST /api/expenses/import
 * sat behind the generic /api/* authentication middleware ONLY — any
 * authenticated role (including 'stock' and plain 'user') could insert ledger
 * rows, and even owner movements (entry_type owner_contrib / owner_draw),
 * while DELETE /api/expenses/:id was already gated (requireBizMutator +
 * password confirm). Both write routes now enforce owner/admin explicitly —
 * the same contract as requireOwner() in the monolith (403 OWNER_ONLY) — with
 * defense-in-depth session re-validation (authFailReason) exactly like
 * routes/finance.ts does for every finance surface.
 *
 * Read routes (GET /api/expenses, /:id/links) and DELETE stay where they are;
 * response shapes, French messages and validation codes are unchanged.
 */
import type { AtlasApp } from './types';
import { validateExpenseWrite } from '../lib/validate';
import { normalizeRole } from '../lib/rbac';
import { apiFail } from '../lib/api-response';

export type ExpenseWriteDeps = {
  sessionUserFromHeader(authHeader: string | undefined): { username: string; role: string };
  authFailReason(
    authHeader: string | undefined,
    env: any,
    db: D1Database,
    ip: string,
    fingerprint: string | undefined,
  ): Promise<string>;
  clientIp(c: any): string;
  ensureExpenseTypeColumn(db: D1Database): Promise<void>;
  invalidateDashboardCache(cache: any): Promise<void>;
  writeAudit(
    db: D1Database,
    opts: { username?: string; role?: string; action: string; entity?: string; entity_id?: string | number; detail?: string; ip?: string },
  ): Promise<void>;
};

/** Ledger writes are owner/admin only — secretaire keeps invoice/client access
 *  on the other routes but never touches the treasury journal directly. */
const LEDGER_WRITE_ROLES = ['owner', 'admin'];

export function registerExpenseWriteRoutes(app: AtlasApp, deps: ExpenseWriteDeps): void {
  /** Shared gate: verified session (401) + owner/admin role (403 OWNER_ONLY). */
  async function requireLedgerWriter(c: any): Promise<{ username: string; role: string } | Response> {
    const authHeader = c.req.header('Authorization');
    const reason = await deps.authFailReason(
      authHeader, c.env, c.env.DB, deps.clientIp(c), c.req.header('X-Device-Fingerprint') || undefined,
    );
    if (reason !== 'ok') {
      return c.json({
        success: false,
        error: reason === 'ip_changed' ? 'Adresse IP modifiée — reconnexion requise'
          : reason === 'fp_changed' ? 'Appareil différent — reconnexion requise'
          : 'Non autorisé',
        code: reason === 'ip_changed' ? 'IP_CHANGED' : reason === 'fp_changed' ? 'DEVICE_CHANGED' : 'UNAUTHORIZED',
      }, 401);
    }
    const session = deps.sessionUserFromHeader(authHeader);
    const role = normalizeRole(session.role);
    if (!LEDGER_WRITE_ROLES.includes(role)) {
      return c.json(
        { success: false, error: 'Réservé à l\'administrateur principal', code: 'OWNER_ONLY', role },
        403,
      );
    }
    return { username: String(session.username || 'user'), role };
  }

  /* ─── POST /api/expenses — create a ledger entry (owner/admin) ─── */
  app.post('/api/expenses', async (c) => {
    const gate = await requireLedgerWriter(c);
    if (gate instanceof Response) return gate;
    await deps.ensureExpenseTypeColumn(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const verr = validateExpenseWrite(body);
    if (verr) return apiFail(c, Object.values(verr)[0] || 'Validation', 'VALIDATION', verr);
    const {
      category = 'General',
      description,
      amount,
      payment_method = 'cash',
      expense_date,
      vendor_name = '',
      reference = '',
      notes = '',
      entry_type = 'expense',
    } = body;
    if (!description || amount == null) return c.json({ success: false, error: 'La description et le montant sont obligatoires' }, 400);
    const allowedTypes = ['expense', 'income', 'owner_draw', 'owner_contrib'];
    const type = allowedTypes.includes(entry_type) ? entry_type : 'expense';
    const result = await c.env.DB.prepare(
      `INSERT INTO expenses (category, description, amount, payment_method, expense_date, vendor_name, reference, notes, entry_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      category,
      description,
      amount,
      payment_method,
      expense_date || new Date().toISOString().slice(0, 10),
      vendor_name,
      reference,
      notes,
      type,
    ).run();
    const expense = await c.env.DB.prepare(`SELECT * FROM expenses WHERE id = ?`).bind(result.meta.last_row_id).first();
    await deps.invalidateDashboardCache(c.env.CACHE);
    void deps.writeAudit(c.env.DB, {
      username: gate.username, role: gate.role, action: 'expense.create', entity: 'expenses',
      entity_id: String((expense as any)?.id ?? ''), detail: `${type}:${Number(amount)}`, ip: deps.clientIp(c),
    });
    const msg = type === 'income' ? 'Recette enregistrée dans la base de données.' : 'Dépense enregistrée dans la base de données.';
    return c.json({ success: true, data: expense, message: msg }, 201);
  });

  /* ─── POST /api/expenses/import — bulk ledger import (owner/admin) ─── */
  app.post('/api/expenses/import', async (c) => {
    const gate = await requireLedgerWriter(c);
    if (gate instanceof Response) return gate;
    await deps.ensureExpenseTypeColumn(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) return c.json({ success: false, error: 'Aucune ligne à importer' }, 400);
    let inserted = 0;
    for (const row of rows) {
      const amount = Number(row.amount || row.montant || 0);
      if (!amount || amount <= 0) continue;
      const entryType = row.entry_type || row.type || (row.direction === 'in' || row.direction === 'entrée' || row.direction === 'دخول' ? 'income' : 'expense');
      const type = ['expense', 'income', 'owner_draw', 'owner_contrib'].includes(entryType) ? entryType : (Number(row.in || row['دخول'] || 0) > 0 ? 'income' : 'expense');
      const amt = amount || Number(row.in || row['دخول'] || row.out || row['خروج'] || 0);
      if (!amt) continue;
      const description = String(row.description || row.label || row.libelle || row['معلومات'] || 'Import').trim();
      const category = String(row.category || row.categorie || 'Import Excel').trim();
      const payment_method = String(row.payment_method || row.mode || 'cash');
      const expense_date = String(row.date || row.expense_date || row['التاريخ'] || new Date().toISOString().slice(0, 10)).slice(0, 10);
      await c.env.DB.prepare(
        `INSERT INTO expenses (category, description, amount, payment_method, expense_date, vendor_name, reference, notes, entry_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(category, description, amt, payment_method, expense_date, row.vendor || '', row.reference || 'import', row.notes || '', type).run();
      inserted++;
    }
    void deps.writeAudit(c.env.DB, {
      username: gate.username, role: gate.role, action: 'expense.import', entity: 'expenses',
      detail: `inserted=${inserted}`, ip: deps.clientIp(c),
    });
    return c.json({ success: true, message: `${inserted} écriture(s) importée(s).`, count: inserted });
  });
}
