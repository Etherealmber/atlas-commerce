/**
 * v254 — Finance, payroll & monthly report endpoints.
 *
 * Server-authoritative rules (never trust the client):
 *  - identity/role come ONLY from the verified session (Authorization header,
 *    re-validated here with authFailReason even though the /api/* middleware
 *    already ran — defense in depth inside every endpoint);
 *  - owner/admin pass financeGate(); secretaire/stock/user get 403 with the
 *    stable code FIN_FORBIDDEN (secretaire keeps its existing invoice/client
 *    access on the other routes — payroll & treasury are NOT part of it);
 *  - every amount is computed from persisted ledger rows (see lib/finance.ts
 *    calculation rules) — client-sent totals are never read;
 *  - responses are additive: existing invoice/bill/employee routes are
 *    untouched, nothing here renames or removes a field.
 */
import type { AtlasApp } from './types';
import {
  computeMonthlySummary,
  computePayrollObligations,
  computePeriodBreakdown,
  computeStatement,
  ensureFinanceSchema,
  financeGate,
  getFinanceContext,
  isValidPeriod,
  monthBounds,
  payrollObligation,
  round2,
  runFinanceReminders,
} from '../lib/finance';
import { addColumnIfMissing } from '../lib/schema';
import { buildFinanceReportPdf } from '../pdf';

export type FinanceRouteDeps = {
  sessionUserFromHeader(authHeader: string | undefined): { username: string; role: string };
  authFailReason(
    authHeader: string | undefined,
    env: any,
    db: D1Database,
    ip: string,
    fingerprint: string | undefined,
  ): Promise<string>;
  clientIp(c: any): string;
  writeAudit(
    db: D1Database,
    opts: { username?: string; role?: string; action: string; entity?: string; entity_id?: string | number; detail?: string; ip?: string },
  ): Promise<void>;
};

const MAX_PAGE_SIZE = 200;
const MAX_DOCS = 200;

function resolvePeriod(c: any, fallback: string): string | null {
  const p = String(c.req.query('period') || '').trim();
  if (!p) return fallback;
  return isValidPeriod(p) ? p : null;
}

export function registerFinanceRoutes(app: AtlasApp, deps: FinanceRouteDeps): void {
  /**
   * Shared gate for every finance surface. Returns the session on success,
   * or a ready JSON error response (401 UNAUTHORIZED / 403 FIN_FORBIDDEN).
   */
  async function requireFinanceAdmin(c: any): Promise<{ username: string; role: string } | Response> {
    const authHeader = c.req.header('Authorization');
    const reason = await deps.authFailReason(authHeader, c.env, c.env.DB, deps.clientIp(c), c.req.header('X-Device-Fingerprint') || '');
    if (reason !== 'ok') {
      return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED', reason }, 401);
    }
    const session = deps.sessionUserFromHeader(authHeader);
    const gate = financeGate(session.role, session.username);
    if (!gate.ok) {
      return c.json({ success: false, error: gate.error, code: gate.code }, 403);
    }
    return session;
  }

  /* ─── GET /api/admin/finance/monthly?period=YYYY-MM ─── */
  app.get('/api/admin/finance/monthly', async (c) => {
    const auth = await requireFinanceAdmin(c);
    if (auth instanceof Response) return auth;
    try {
      await ensureFinanceSchema(c.env.DB);
      const ctx = await getFinanceContext(c.env.DB);
      const period = resolvePeriod(c, ctx.today.slice(0, 7));
      if (!period) {
        return c.json({ success: false, error: 'Période invalide — format attendu YYYY-MM.', code: 'BAD_PERIOD' }, 400);
      }
      const summary = await computeMonthlySummary(c.env.DB, period, ctx);
      const recvCount = summary.receivables.documents.length;
      const payCount = summary.payables.documents.length;
      summary.receivables.documents = summary.receivables.documents.slice(0, MAX_DOCS);
      summary.payables.documents = summary.payables.documents.slice(0, MAX_DOCS);
      return c.json({
        success: true,
        data: {
          ...summary,
          receivables: { ...summary.receivables, count: recvCount, truncated: recvCount > MAX_DOCS },
          payables: { ...summary.payables, count: payCount, truncated: payCount > MAX_DOCS },
        },
      });
    } catch (e: any) {
      console.error('finance_monthly_err', String(e?.message || e));
      return c.json({ success: false, error: 'Calcul mensuel impossible', code: 'FINANCE_ERROR' }, 500);
    }
  });

  /* ─── GET /api/admin/employees/payroll?period=YYYY-MM&page=1&page_size=50&due_before=YYYY-MM-DD ───
   * Fields are deliberately minimal (privacy): employee_id, display_name,
   * amount_due, pay_period, due_date, status, last_payment. Never phone,
   * national id, sales figures or balances. */
  app.get('/api/admin/employees/payroll', async (c) => {
    const auth = await requireFinanceAdmin(c);
    if (auth instanceof Response) return auth;
    try {
      await ensureFinanceSchema(c.env.DB);
      const ctx = await getFinanceContext(c.env.DB);
      const period = resolvePeriod(c, ctx.today.slice(0, 7));
      if (!period) {
        return c.json({ success: false, error: 'Période invalide — format attendu YYYY-MM.', code: 'BAD_PERIOD' }, 400);
      }
      const page = Math.max(1, Number(c.req.query('page') || 1) || 1);
      const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(c.req.query('page_size') || 50) || 50));
      const dueBefore = String(c.req.query('due_before') || '').slice(0, 10);
      const b = monthBounds(period);
      // For a past period, obligations are frozen at the period end; for the
      // current/future period, accrual runs to today (never into the future).
      const asOf = ctx.today < b.end ? ctx.today : b.end;
      const obligations = await computePayrollObligations(c.env.DB, asOf);

      const rows = [];
      for (const ob of obligations) {
        if (!ob) continue;
        if (dueBefore && (!ob.due_date || ob.due_date > dueBefore)) continue;
        let lastPayment: { amount: number; paid_at: string; period_label: string } | null = null;
        try {
          const lp = await c.env.DB.prepare(
            `SELECT amount, paid_at, period_label FROM employee_payments
             WHERE employee_id = ? ORDER BY substr(paid_at,1,10) DESC, id DESC LIMIT 1`,
          ).bind(ob.employee_id).first() as any;
          if (lp) {
            lastPayment = {
              amount: round2(Number(lp.amount || 0)),
              paid_at: String(lp.paid_at || '').slice(0, 10),
              period_label: String(lp.period_label || ''),
            };
          }
        } catch { /* table may lag */ }
        const unpaid = !!ob.due_date && ob.due_date <= asOf && ob.amount_due > 0.005;
        rows.push({
          employee_id: ob.employee_id,
          display_name: ob.display_name,
          amount_due: ob.amount_due,
          pay_period: ob.pay_period,
          due_date: ob.due_date,
          status: unpaid ? 'unpaid' : 'paid',
          last_payment: lastPayment,
        });
      }
      rows.sort((x, y) => String(x.due_date || '9999').localeCompare(String(y.due_date || '9999')) || x.employee_id - y.employee_id);

      const total = rows.length;
      const start = (page - 1) * pageSize;
      const slice = rows.slice(start, start + pageSize);
      return c.json({
        success: true,
        data: {
          period,
          as_of: asOf,
          timezone: ctx.timezone,
          currency: ctx.currency,
          totals: {
            amount_due: round2(rows.reduce((s, r) => s + (r.status === 'unpaid' ? r.amount_due : 0), 0)),
            unpaid_count: rows.filter((r) => r.status === 'unpaid').length,
            count: total,
          },
          page,
          page_size: pageSize,
          total,
          has_more: start + slice.length < total,
          rows: slice,
        },
      });
    } catch (e: any) {
      console.error('finance_payroll_err', String(e?.message || e));
      return c.json({ success: false, error: 'Calcul de paie impossible', code: 'FINANCE_ERROR' }, 500);
    }
  });

  /* ─── GET /api/me/payroll ───
   * v256 — employee-SELF pay date. ANY authenticated session (user, stock,
   * secretaire, admin…) reads the payroll obligation of the ONE employee file
   * linked to its own login (employees.user_username) — nothing else. The
   * username comes only from the verified session; there is no query param, no
   * list, and no admin data on this route. Unlinked account → 404
   * PAYROLL_NOT_LINKED; two files linked to one login → 409 PAYROLL_AMBIGUOUS. */
  app.get('/api/me/payroll', async (c) => {
    const authHeader = c.req.header('Authorization');
    const reason = await deps.authFailReason(authHeader, c.env, c.env.DB, deps.clientIp(c), c.req.header('X-Device-Fingerprint') || '');
    if (reason !== 'ok') {
      return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED', reason }, 401);
    }
    const session = deps.sessionUserFromHeader(authHeader);
    const username = String(session.username || '').trim().toLowerCase();
    if (!username) return c.json({ success: false, error: 'Session invalide', code: 'UNAUTHORIZED' }, 401);
    try {
      await addColumnIfMissing(c.env.DB, 'employees', 'user_username', "TEXT DEFAULT ''");
      const found = await c.env.DB.prepare(
        `SELECT id, emp_number, name, first_name, last_name, pay_amount, pay_cycle_type,
                pay_cycle_days, last_paid_at, joined_date, active
         FROM employees WHERE LOWER(TRIM(COALESCE(user_username,''))) = ? LIMIT 2`,
      ).bind(username).all() as any;
      const rows = found?.results || [];
      if (!rows.length) {
        return c.json({ success: false, error: 'Aucune fiche employé liée à ce compte.', code: 'PAYROLL_NOT_LINKED' }, 404);
      }
      if (rows.length > 1) {
        return c.json({ success: false, error: 'Plusieurs fiches employé liées à ce compte — contactez un administrateur.', code: 'PAYROLL_AMBIGUOUS' }, 409);
      }
      const row = rows[0];
      const ctx = await getFinanceContext(c.env.DB);
      const asOf = ctx.today;
      let advances = 0;
      try {
        const anchorDay = String(row.last_paid_at || row.joined_date || '').slice(0, 10) || '2000-01-01';
        const r = await c.env.DB.prepare(
          `SELECT COALESCE(SUM(amount),0) s FROM employee_payments
           WHERE employee_id = ? AND substr(paid_at,1,10) >= ? AND substr(paid_at,1,10) <= ?
             AND (period_label LIKE 'Acompte%' OR note LIKE '%[acompte]%')`,
        ).bind(Number(row.id), anchorDay, asOf).first() as any;
        advances = Number(r?.s || 0);
      } catch { /* advances table may lag */ }
      let lastPayment: { amount: number; paid_at: string; period_label: string } | null = null;
      try {
        const lp = await c.env.DB.prepare(
          `SELECT amount, paid_at, period_label FROM employee_payments
           WHERE employee_id = ? ORDER BY substr(paid_at,1,10) DESC, id DESC LIMIT 1`,
        ).bind(Number(row.id)).first() as any;
        if (lp) {
          lastPayment = {
            amount: round2(Number(lp.amount || 0)),
            paid_at: String(lp.paid_at || '').slice(0, 10),
            period_label: String(lp.period_label || ''),
          };
        }
      } catch { /* table may lag */ }
      const ob = payrollObligation(row, asOf, advances);
      if (!ob) {
        // Linked file but payroll not configured (no pay_amount / no anchor):
        // expose the link only — never other employees' data.
        return c.json({
          success: true,
          data: {
            linked: true,
            payroll_configured: false,
            employee_id: Number(row.id),
            as_of: asOf,
            timezone: ctx.timezone,
            currency: ctx.currency,
            last_payment: lastPayment,
          },
        });
      }
      const unpaid = !!ob.due_date && ob.due_date <= asOf && ob.amount_due > 0.005;
      return c.json({
        success: true,
        data: {
          linked: true,
          payroll_configured: true,
          employee_id: ob.employee_id,
          display_name: ob.display_name,
          amount_due: ob.amount_due,
          pay_period: ob.pay_period,
          due_date: ob.due_date,
          daily_rate: ob.daily_rate,
          status: unpaid ? 'unpaid' : 'paid',
          last_payment: lastPayment,
          as_of: asOf,
          timezone: ctx.timezone,
          currency: ctx.currency,
        },
      });
    } catch (e: any) {
      console.error('me_payroll_err', String(e?.message || e));
      return c.json({ success: false, error: 'Lecture de paie impossible', code: 'FINANCE_ERROR' }, 500);
    }
  });

  /* ─── GET /api/admin/finance/statement?period=YYYY-MM&page=1&page_size=50 ───
   * v258 — server-backed monthly statement (owner/admin): opening balance,
   * chronological cash rows (sale / refund / expense / payroll / supplier) with
   * running balance, totals and the reconciliation invariant. Same canonical
   * filtered queries as the monthly summary and the PDF, so the three can never
   * disagree. Mirror ledger rows and « Avoir » audit trails are excluded here
   * exactly as in the summary (see lib/finance.ts SQL filters). */
  app.get('/api/admin/finance/statement', async (c) => {
    const auth = await requireFinanceAdmin(c);
    if (auth instanceof Response) return auth;
    try {
      await ensureFinanceSchema(c.env.DB);
      const ctx = await getFinanceContext(c.env.DB);
      const period = resolvePeriod(c, ctx.today.slice(0, 7));
      if (!period) {
        return c.json({ success: false, error: 'Période invalide — format attendu YYYY-MM.', code: 'BAD_PERIOD' }, 400);
      }
      const page = Math.max(1, Number(c.req.query('page') || 1) || 1);
      const pageSize = Math.min(200, Math.max(1, Number(c.req.query('page_size') || 50) || 50));
      const stmt = await computeStatement(c.env.DB, period, ctx, page, pageSize);
      return c.json({ success: true, data: stmt });
    } catch (e: any) {
      console.error('finance_statement_err', String(e?.message || e));
      return c.json({ success: false, error: 'Relevé impossible à calculer', code: 'FINANCE_ERROR' }, 500);
    }
  });

  /* ─── GET /api/admin/finance/period?period=YYYY-MM ───
   * v264 — owner/admin cash & bank breakdown of the selected period:
   * inflows/outflows split by payment method (canonical caisse/banque rule),
   * owner contributions/withdrawals, expense-category totals and the
   * statement invariant. Computed ONLY from persisted ledger rows with the
   * SAME timezone + canonical filters as GET /api/admin/finance/statement —
   * missing methods are reported as `not_recorded`, never inferred. */
  app.get('/api/admin/finance/period', async (c) => {
    const auth = await requireFinanceAdmin(c);
    if (auth instanceof Response) return auth;
    try {
      await ensureFinanceSchema(c.env.DB);
      const ctx = await getFinanceContext(c.env.DB);
      const period = resolvePeriod(c, ctx.today.slice(0, 7));
      if (!period) {
        return c.json({ success: false, error: 'Période invalide — format attendu YYYY-MM.', code: 'BAD_PERIOD' }, 400);
      }
      const data = await computePeriodBreakdown(c.env.DB, period, ctx);
      return c.json({ success: true, data });
    } catch (e: any) {
      console.error('finance_period_err', String(e?.message || e));
      return c.json({ success: false, error: 'Ventilation de période impossible à calculer', code: 'FINANCE_ERROR' }, 500);
    }
  });

  /* ─── GET /api/admin/finance/monthly/report.pdf?period=YYYY-MM ───
   * Generated on demand, streamed, never stored, never publicly enumerable
   * (no R2 object, no stable URL — the period alone yields nothing without a
   * verified owner/admin session). Audit-logged per download. */
  app.get('/api/admin/finance/monthly/report.pdf', async (c) => {
    const auth = await requireFinanceAdmin(c);
    if (auth instanceof Response) return auth;
    try {
      await ensureFinanceSchema(c.env.DB);
      const ctx = await getFinanceContext(c.env.DB);
      const period = resolvePeriod(c, ctx.today.slice(0, 7));
      if (!period) {
        return c.json({ success: false, error: 'Période invalide — format attendu YYYY-MM.', code: 'BAD_PERIOD' }, 400);
      }
      const summary = await computeMonthlySummary(c.env.DB, period, ctx);
      const bytes = buildFinanceReportPdf({
        companyName: ctx.companyName,
        currency: ctx.currency,
        period,
        generatedAt: summary.reconciliation.generated_at,
        openingBalance: summary.opening_balance,
        closingBalance: summary.closing_balance,
        salesReceived: summary.sales_received,
        expenses: summary.expenses,
        refunds: summary.refunds,
        payrollPaid: summary.payroll_paid,
        supplierPaid: summary.supplier_paid,
        receivablesTotal: summary.receivables.total_outstanding,
        receivablesOverdue: summary.receivables.total_overdue,
        payablesTotal: summary.payables.total_outstanding,
        payablesOverdue: summary.payables.total_overdue,
        payrollDue: summary.payroll.total_due,
        payrollCount: summary.payroll.employees,
        receivableDocs: summary.receivables.documents.slice(0, 14),
        receivableDocsTotal: summary.receivables.documents.length,
        payableDocs: summary.payables.documents.slice(0, 14),
        payableDocsTotal: summary.payables.documents.length,
      });
      void deps.writeAudit(c.env.DB, {
        username: auth.username,
        role: auth.role,
        action: 'finance_report_pdf',
        entity: 'finance_report',
        entity_id: period,
        detail: 'Rapport mensuel PDF téléchargé',
        ip: deps.clientIp(c),
      });
      return new Response(bytes as unknown as BodyInit, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="rapport-mensuel-${period}.pdf"`,
          'Cache-Control': 'no-store',
        },
      });
    } catch (e: any) {
      console.error('finance_pdf_err', String(e?.message || e));
      return c.json({ success: false, error: 'Génération du rapport impossible', code: 'FINANCE_ERROR' }, 500);
    }
  });

  /* ─── POST /api/cron/finance-reminders ───
   * Manual/external trigger for the same idempotent run the wrangler cron
   * performs. CRON_SECRET-gated exactly like /api/cron/backup-execute; the
   * /api/* auth middleware exempts /api/cron/* so this handler is the gate. */
  app.post('/api/cron/finance-reminders', async (c) => {
    const auth = String(c.req.header('Authorization') || '').trim();
    const secret = String((c.env as any).CRON_SECRET || '').trim();
    if (!secret) {
      return c.json({
        success: false,
        error: 'CRON_SECRET non configuré. Exécutez: npx wrangler secret put CRON_SECRET',
        code: 'CRON_SECRET_MISSING',
      }, 503);
    }
    const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    const headerToken = String(c.req.header('X-Cron-Secret') || '').trim();
    if (bearer !== secret && headerToken !== secret) {
      return c.json({ success: false, error: 'Unauthorized', code: 'CRON_UNAUTHORIZED' }, 401);
    }
    try {
      const report = await runFinanceReminders(c.env);
      return c.json({ success: true, data: report });
    } catch (e: any) {
      console.error('finance_cron_err', String(e?.message || e));
      return c.json({ success: false, error: String(e?.message || e).slice(0, 200), code: 'FINANCE_CRON_ERROR' }, 500);
    }
  });
}
