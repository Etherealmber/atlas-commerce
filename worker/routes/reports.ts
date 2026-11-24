import type { Hono } from 'hono';
import type { Env } from '../env';
import { escapeHtml } from '../lib/security';
import { addColumnIfMissing } from '../lib/schema';
import { mintScopedReportTicket, mintScopedPrintTicket } from '../lib/report-ticket';
import { verifyArchiveIdentity } from '../lib/finance-report-archive-validation';
import { readBalanceReport, balanceIsIncome } from '../lib/report-balance';
import { localTodayYmd } from '../lib/finance';
import {
  addMoneyAmounts,
  classifyDoc,
  computeInventoryValuation,
  daysBetweenYmd,
  getCurrencySpec,
  round2,
  roundCurrency,
  subMoneyAmounts,
} from '../lib/financeCore';
import { computePeriodBounds } from '../lib/report-period';
import { generateEmployeeFormHTML } from '../lib/printTemplates';

interface ReportRouteDeps {
  reportTicketEnvironment: (env: any) => any;
  authFailReason: (header: string | undefined, env: any, db: D1Database, ip: string, fp?: string) => Promise<string>;
  sessionUserFromHeader: (header: string | undefined) => any;
  getOwnerUsername: (env: any) => string | null;
  getPassword: (env: any) => string | null;
  parseToken: (token: string) => any;
  clientIp: (c: any) => string;
  ensureStockLocations: (db: D1Database) => Promise<void>;
  ensureExpenseTypeColumn: (db: D1Database) => Promise<void>;
  ensureReceiptsTable: (db: D1Database) => Promise<void>;
  ensureValuationTables: (db: D1Database) => Promise<void>;
  getValuationMethod: (db: D1Database) => Promise<'average' | 'fifo' | 'standard'>;
}

function combinedBackUrl(c: any): string {
  try {
    const u = new URL(c.req.url);
    const rt = u.searchParams.get('rt') || '';
    if (!rt) return '';
    const q = new URLSearchParams();
    for (const key of ['rt', 'period', 'from', 'to']) { const value = u.searchParams.get(key); if (value) q.set(key, value); }
    return `/api/reports/combined?${q.toString()}`;
  } catch { return ''; }
}

export function reportShell(title: string, company: string, subtitle: string, body: string, footerText?: string, backUrl?: string): string {
  const generated = new Date().toLocaleString('fr-FR');
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(title)} — ${escapeHtml(company)}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:"Segoe UI",system-ui,-apple-system,sans-serif;color:#111;max-width:920px;margin:0 auto;padding:8px 12px;font-size:12px;line-height:1.35;position:relative}
  .watermark{position:fixed;inset:0;pointer-events:none;z-index:0;display:flex;align-items:center;justify-content:center;font-size:64px;font-weight:800;letter-spacing:0.1em;opacity:0.05;transform:rotate(-28deg);text-transform:uppercase;color:#111}
  .sheet{position:relative;z-index:1;min-width:0}
  .report-content{overflow-x:auto;max-width:100%;-webkit-overflow-scrolling:touch}
  .report-content table{min-width:520px}
  @media print{.report-content{overflow:visible}.report-content table{min-width:0}}
  table thead{display:table-header-group}
  table tr,.keep{page-break-inside:avoid;break-inside:avoid}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:12px;margin-bottom:18px}
  .hdr h1{font-size:20px;margin:0 0 4px;font-weight:700;letter-spacing:-0.02em}
  .hdr .co{font-size:14px;font-weight:600}
  .muted{color:#444;font-size:11.5px}
  h2{font-size:13px;margin:22px 0 8px;border-bottom:1px solid #111;padding-bottom:4px;text-transform:uppercase;letter-spacing:.06em}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}
  .stat{border:1px solid #333;padding:10px 12px}
  .stat .l{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#333}
  .stat .v{font-size:16px;font-weight:700;margin-top:4px}
  table{width:100%;border-collapse:collapse;margin-top:6px}
  th,td{text-align:left;padding:7px 8px;border-bottom:1px solid #ccc;font-size:11.5px}
  th{border-bottom:2px solid #111;font-size:10px;text-transform:uppercase;letter-spacing:.04em;font-weight:700}
  .in{font-weight:700}
  .out{font-weight:700}
  .actions{margin:0 0 16px}
  .actions .backlink{display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:4px;text-decoration:none;font-size:13px;margin-right:8px}
  button{background:#111;color:#fff;border:0;padding:10px 16px;border-radius:4px;cursor:pointer;font-size:13px}
  .sign-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:16px;page-break-inside:avoid}
  .sign-box{min-height:90px;border:1px solid #333;padding:10px}
  .sign-box .t{font-size:10px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;font-weight:700}
  .sign-box .line{margin-top:16px;border-top:1px solid #111;padding-top:6px;font-size:10px;color:#333}
  .footer{margin-top:10px;padding-top:10px;border-top:1px solid #999;font-size:10px;color:#444;display:flex;justify-content:space-between}
  
  .cat-block{margin:18px 0 22px;page-break-inside:avoid}
  .cat-title{font-size:14px;margin:0 0 8px;padding:8px 10px;background:#f0ebe3;border-left:4px solid #1a1814;display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
  .cat-meta{font-size:11px;font-weight:400;color:#5c574f}
  .badge-low{font-size:10px;background:#fce8e8;color:#8b2e2e;padding:2px 6px;border-radius:4px;margin-left:6px}
  tr.low td{background:#fff8f8}
  .grid-4{grid-template-columns:repeat(4,1fr)}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  table{width:100%;border-collapse:collapse;font-size:11.5px;margin-bottom:4px}
  th,td{border-bottom:1px solid #e5e0d6;padding:7px 8px;text-align:left}
  th{background:#f7f4ee;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#5c574f}
  .stat{background:#fff;border:1px solid #e0d9cc;border-radius:8px;padding:12px 14px}
  .stat .l{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#7a756c}
  .stat .v{font-size:18px;font-weight:700;margin-top:4px}
  .in{color:#6366f1}.out{color:#8b2e2e}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
  @media(max-width:800px){.grid,.grid-4{grid-template-columns:1fr 1fr}}
.page-num{margin-top:8px;text-align:right;font-size:10px;color:#444}
  .cat-totals{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:8px 0 0;padding:10px;background:#faf8f4;border:1px solid #e5e0d6;border-radius:6px}
  .cat-totals .ct{font-size:11px}
  .cat-totals .ct b{display:block;font-size:13px;margin-top:2px}
  @media print{
    .actions{display:none!important}
    body{padding:0;max-width:none}
    .stat,.sign-box{border-color:#000}
    a{color:#000;text-decoration:none}
    @page{size:A4;margin:10mm 10mm 12mm 10mm}
    @page{@bottom-center{content:"Page " counter(page) " / " counter(pages);font-size:9pt;color:#444}}
    table tr{page-break-inside:avoid;break-inside:avoid}
    thead{display:table-header-group}
    .sign-row{page-break-inside:avoid}.cat-block{page-break-inside:auto}
    .page-num{display:none}
  }
  @media (max-width:700px){.grid{grid-template-columns:1fr 1fr}.sign-row{grid-template-columns:1fr}.cat-totals{grid-template-columns:1fr 1fr}}
</style>
</head>
<body>
  <div class="watermark" aria-hidden="true">RAPPORT</div>
  <div class="sheet">
  <div class="actions">${backUrl ? `<a class="backlink" href="${escapeHtml(backUrl)}">← Retour aux rapports combinés</a>` : ''}</div>
  <div class="hdr">
    <div>
      <div class="co">${escapeHtml(company)}</div>
      <h1>${escapeHtml(title)}</h1>
      <p class="muted">${escapeHtml(subtitle)}</p>
    </div>
    <div class="muted" style="text-align:right">
      Document comptable<br/>Généré le ${generated}<br/>Impression N&amp;B recommandée
    </div>
  </div>
  <!-- report-content-start -->
  <main class="report-content">${body}</main>
  <!-- report-content-end -->
  <div class="sign-row keep">
    <div class="sign-box">
      <div class="t">Préparé par</div>
      <div class="line">Nom / signature</div>
    </div>
    <div class="sign-box">
      <div class="t">Vérifié / Approuvé</div>
      <div class="line">Nom / signature</div>
    </div>
    <div class="sign-box">
      <div class="t">Cachet de l'entreprise</div>
      <div class="line">Tampon / sceau</div>
    </div>
  </div>
  <div class="footer">
    <span>${escapeHtml(company)} — Gestion stock &amp; comptabilité</span>
    <span>${escapeHtml(footerText || 'Document comptable · Impression noir et blanc · À conserver')}</span>
  </div>
  </div>
</body>
</html>`;
}

function fmtN(n: any) {
  return Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 3 });
}

/**
 * Report period bounds (v262) — relative windows AND strictly validated
 * `YYYY-MM` months, anchored on the company's finance timezone
 * (company_settings.finance_timezone, default Africa/Casablanca): the current
 * month stops at TODAY in that timezone, past months use the full calendar
 * month. Pure logic lives in lib/report-period.ts (unit-tested). `periodKey`
 * is the normalized period propagated to every section link.
 */
function periodBounds(c: any, timezone?: string): { from: string; to: string; label: string; periodKey: string } {
  const tz = String(timezone || '').trim() || 'Africa/Casablanca';
  return computePeriodBounds(
    { period: c.req.query('period'), from: c.req.query('from'), to: c.req.query('to') },
    { todayYmd: localTodayYmd(tz) },
  );
}

export function registerReportRoutes(app: Hono<any>, deps: ReportRouteDeps): void {
  const {
    reportTicketEnvironment,
    authFailReason,
    sessionUserFromHeader,
    getOwnerUsername,
    getPassword,
    parseToken,
    clientIp,
    ensureStockLocations,
    ensureExpenseTypeColumn,
    ensureReceiptsTable,
    ensureValuationTables,
    getValuationMethod,
  } = deps;

  app.get('/api/reports/link-ticket', async (c) => {
    try {
      const ticket = await mintScopedReportTicket(reportTicketEnvironment(c.env), (c as any).get('reportIdentity'), getOwnerUsername(c.env) || '');
      return c.json({ success: true, data: ticket });
    } catch {
      return c.json({ success: false, error: 'Ticket indisponible', code: 'REPORT_TICKET_UNAVAILABLE' }, 503);
    }
  });
  
  // The legacy document-print ticket remains separate from the finance capability.
  app.get('/api/print/link-ticket', async (c) => {
    const identity = await verifyArchiveIdentity(c.env, c.req.header('Authorization'), clientIp(c), c.req.header('X-Device-Fingerprint'), {
      authFailReason: (header, env, db, ip, fp) => authFailReason(header, env as Env, db, ip, fp),
      sessionUserFromHeader,
      ownerUsername: env => getOwnerUsername(env as Env) || '',
      allowSecretaire: true,
    });
    if (!identity.ok) return c.json({ success: false, code: identity.code, error: 'Accès refusé' }, identity.status);
    try {
      if (!String(c.env.JWT_SECRET || getPassword(c.env) || '').trim()) throw new Error('missing secret');
      const bearer = c.req.header('Authorization') || '';
      const parsed = bearer.startsWith('Bearer ') ? parseToken(bearer.slice(7)) : null;
      // Pilot tokens have separate revocation semantics and cannot mint this legacy-browser capability.
      if (!parsed || parsed.version !== 2) throw new Error('Unsupported print session');
      return c.json({ success: true, data: await mintScopedPrintTicket(reportTicketEnvironment(c.env), identity.identity as any, getOwnerUsername(c.env) || '', parsed.fingerprint) });
    } catch {
      return c.json({ success: false, error: 'Ticket indisponible', code: 'PRINT_TICKET_UNAVAILABLE' }, 503);
    }
  });
  
  app.get('/api/reports/aging', async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT id, number, client_name, issue_date, due_date, total, amount_paid, status,
              ROUND(total - COALESCE(amount_paid, 0), 2) as remaining
       FROM invoices
       WHERE status NOT IN ('quote', 'devis', 'cancelled', 'remboursement', 'paid')
         AND COALESCE(doc_kind, '') != 'remboursement'
         AND (total - COALESCE(amount_paid, 0)) > 0.001
       ORDER BY COALESCE(due_date, issue_date) ASC`
    ).all();
    const today = localTodayYmd('Africa/Casablanca');
    const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
    const rows = (results || []).map((r: any) => {
      const rem = Math.max(0, subMoneyAmounts(Number(r.total || 0), Number(r.amount_paid || 0), 2));
      const due = String(r.due_date || r.issue_date || today).slice(0, 10);
      const cls = classifyDoc(Number(r.total || 0), Number(r.amount_paid || 0), due, today);
      const rawDays = daysBetweenYmd(due, today);
      const days = rawDays ?? 0;
      let bucket = 'current';
      if (days > 90) { bucket = 'd90_plus'; buckets.d90_plus = addMoneyAmounts(buckets.d90_plus, rem, 2); }
      else if (days > 60) { bucket = 'd61_90'; buckets.d61_90 = addMoneyAmounts(buckets.d61_90, rem, 2); }
      else if (days > 30) { bucket = 'd31_60'; buckets.d31_60 = addMoneyAmounts(buckets.d31_60, rem, 2); }
      else if (days > 0) { bucket = 'd1_30'; buckets.d1_30 = addMoneyAmounts(buckets.d1_30, rem, 2); }
      else { buckets.current = addMoneyAmounts(buckets.current, rem, 2); }
      return { ...r, days_overdue: cls.overdue ? Math.max(0, days) : Math.max(0, days), bucket, remaining: rem };
    });
    return c.json({ success: true, data: { rows, buckets, as_of: today } });
  });
  
  app.get('/api/reports/aging.csv', async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT id, number, client_name, issue_date, due_date, total, amount_paid, status,
              ROUND(total - COALESCE(amount_paid, 0), 2) as remaining
       FROM invoices
       WHERE status NOT IN ('quote', 'devis', 'cancelled', 'remboursement', 'paid')
         AND COALESCE(doc_kind, '') != 'remboursement'
         AND (total - COALESCE(amount_paid, 0)) > 0.001
       ORDER BY COALESCE(due_date, issue_date) ASC`
    ).all();
    const today = localTodayYmd('Africa/Casablanca');
    const esc = (v: any) => {
      const s = String(v ?? '');
      if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = ['Numero;Client;Emission;Echeance;Jours_retard;Reste;Bucket;Total;Paye'];
    for (const r of (results || []) as any[]) {
      const rem = Math.max(0, subMoneyAmounts(Number(r.total || 0), Number(r.amount_paid || 0), 2));
      const due = String(r.due_date || r.issue_date || today).slice(0, 10);
      const days = Math.max(0, daysBetweenYmd(due, today) ?? 0);
      let bucket = 'courant';
      if (days > 90) bucket = '90+';
      else if (days > 60) bucket = '61-90';
      else if (days > 30) bucket = '31-60';
      else if (days > 0) bucket = '1-30';
      lines.push([r.number, r.client_name, r.issue_date, r.due_date, days, rem, bucket, r.total, r.amount_paid].map(esc).join(';'));
    }
    const bom = '\uFEFF';
    return new Response(bom + lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="balance-agee-${today}.csv"`,
      },
    });
  });
  
  /** Phase 1 — TVA summary by rate */
  app.get('/api/reports/tva', async (c) => {
    try {
    const from = c.req.query('from') || '';
    const to = c.req.query('to') || '';
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const defaultTax = Number(settings?.tax_rate ?? 20);
    const cur = String(settings?.currency || settings?.finance_currency || 'MAD');

    // Ensure line tax_rate and invoice tax_exempt exist (older DBs may lack them).
    await addColumnIfMissing(c.env.DB, 'invoice_items', 'tax_rate', `REAL DEFAULT 0`);
    await addColumnIfMissing(c.env.DB, 'invoices', 'tax_exempt', `INTEGER DEFAULT 0`);

    const rateExpr = `CASE WHEN COALESCE(i.tax_exempt, 0) = 1 OR COALESCE(i.doc_kind, '') IN ('quick_sale', 'ticket') OR COALESCE(i.number, '') LIKE 'VR%' THEN 0 ELSE COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) END`;
    let sql = `
      SELECT ${rateExpr} as tax_rate,
             SUM(
               CASE
                 WHEN ii.line_total IS NOT NULL AND (${rateExpr}) > 0
                   THEN ii.line_total / (1.0 + (${rateExpr}) / 100.0)
                 WHEN ii.line_total IS NOT NULL
                   THEN ii.line_total
                 ELSE COALESCE(ii.quantity, 0) * COALESCE(ii.unit_price, 0)
               END
             ) as base_ht,
             SUM(
               CASE
                 WHEN ii.line_total IS NOT NULL AND (${rateExpr}) > 0
                   THEN ii.line_total - (ii.line_total / (1.0 + (${rateExpr}) / 100.0))
                 ELSE COALESCE(ii.quantity, 0) * COALESCE(ii.unit_price, 0) * (${rateExpr}) / 100.0
               END
             ) as tva
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.status NOT IN ('quote', 'devis', 'cancelled', 'remboursement')
        AND COALESCE(i.doc_kind, '') != 'remboursement'`;
    const binds: any[] = [];
    if (from) { sql += ` AND i.issue_date >= ?`; binds.push(from); }
    if (to) { sql += ` AND i.issue_date <= ?`; binds.push(to); }
    sql += ` GROUP BY 1 ORDER BY 1`;
    const { results } = await c.env.DB.prepare(sql).bind(...binds).all();

    const wrRateExpr = `CASE WHEN COALESCE(i.tax_exempt, 0) = 1 THEN 0 ELSE COALESCE(ii.tax_rate, ${defaultTax}) END`;
    let sqlWr = `
      SELECT ${wrRateExpr} as tax_rate,
             SUM(
               CASE
                 WHEN ii.line_total IS NOT NULL AND (${wrRateExpr}) > 0
                   THEN ii.line_total / (1.0 + (${wrRateExpr}) / 100.0)
                 WHEN ii.line_total IS NOT NULL
                   THEN ii.line_total
                 ELSE COALESCE(ii.quantity, 0) * COALESCE(ii.unit_price, 0)
               END
             ) as base_ht,
             SUM(
               CASE
                 WHEN ii.line_total IS NOT NULL AND (${wrRateExpr}) > 0
                   THEN ii.line_total - (ii.line_total / (1.0 + (${wrRateExpr}) / 100.0))
                 ELSE COALESCE(ii.quantity, 0) * COALESCE(ii.unit_price, 0) * (${wrRateExpr}) / 100.0
               END
             ) as tva
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.status != 'cancelled'
        AND (i.status = 'remboursement' OR COALESCE(i.doc_kind, '') = 'remboursement')`;
    const bindsWr: any[] = [];
    if (from) { sqlWr += ` AND i.issue_date >= ?`; bindsWr.push(from); }
    if (to) { sqlWr += ` AND i.issue_date <= ?`; bindsWr.push(to); }
    sqlWr += ` GROUP BY 1`;
    const wr = await c.env.DB.prepare(sqlWr).bind(...bindsWr).all();

    const sales = (results || []).map((r: any) => ({
      tax_rate: Number(r.tax_rate),
      base_ht: roundCurrency(Number(r.base_ht || 0), cur, 'ledger'),
      tva: roundCurrency(Number(r.tva || 0), cur, 'ledger'),
    }));
    const credits = (wr.results || []).map((r: any) => ({
      tax_rate: Number(r.tax_rate),
      base_ht: roundCurrency(Number(r.base_ht || 0), cur, 'ledger'),
      tva: roundCurrency(Number(r.tva || 0), cur, 'ledger'),
    }));
    const totalSalesTva = sales.reduce((s: number, r: any) => addMoneyAmounts(s, r.tva, cur), 0);
    const totalCreditsTva = credits.reduce((s: number, r: any) => addMoneyAmounts(s, r.tva, cur), 0);

    return c.json({
      success: true,
      data: {
        sales,
        credits,
        net_tva: subMoneyAmounts(totalSalesTva, totalCreditsTva, cur),
        total_sales_tva: totalSalesTva,
        total_credits_tva: totalCreditsTva,
        default_tax_rate: defaultTax,
        from: from || null,
        to: to || null,
      },
    });
    } catch {
      return c.json({ success: false, error: 'Rapport TVA indisponible', code: 'REPORT_GENERATION_FAILED' }, 500);
    }
  });
  
  /** Phase 4 — printable Aging HTML (open / print / save as PDF) */
  
  app.get('/api/reports/tva.csv', async (c) => {
    const from = c.req.query('from') || '';
    const to = c.req.query('to') || '';
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const defaultTax = Number(settings?.tax_rate ?? 20);
    const cur = String(settings?.currency || settings?.finance_currency || 'MAD');
    const dec = getCurrencySpec(cur).minorDecimals;
    await addColumnIfMissing(c.env.DB, 'invoice_items', 'tax_rate', `REAL DEFAULT 0`);
    await addColumnIfMissing(c.env.DB, 'invoices', 'tax_exempt', `INTEGER DEFAULT 0`);
    const rateExpr = `CASE WHEN COALESCE(i.tax_exempt, 0) = 1 OR COALESCE(i.doc_kind, '') IN ('quick_sale', 'ticket') OR COALESCE(i.number, '') LIKE 'VR%' THEN 0 ELSE COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) END`;
    let sql = `
      SELECT ${rateExpr} as tax_rate,
             SUM(CASE WHEN ii.line_total IS NOT NULL AND (${rateExpr}) > 0
                   THEN ii.line_total / (1.0 + (${rateExpr}) / 100.0)
                 WHEN ii.line_total IS NOT NULL THEN ii.line_total
                 ELSE COALESCE(ii.quantity, 0) * COALESCE(ii.unit_price, 0) END) as base_ht,
             SUM(CASE WHEN ii.line_total IS NOT NULL AND (${rateExpr}) > 0
                   THEN ii.line_total - (ii.line_total / (1.0 + (${rateExpr}) / 100.0))
                 ELSE COALESCE(ii.quantity, 0) * COALESCE(ii.unit_price, 0) * (${rateExpr}) / 100.0 END) as tva
      FROM invoice_items ii INNER JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.status NOT IN ('quote', 'devis', 'cancelled', 'remboursement')
        AND COALESCE(i.doc_kind, '') != 'remboursement'`;
    const binds: any[] = [];
    if (from) { sql += ` AND i.issue_date >= ?`; binds.push(from); }
    if (to) { sql += ` AND i.issue_date <= ?`; binds.push(to); }
    sql += ` GROUP BY 1 ORDER BY 1`;
    const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
    const wrRateExpr = `CASE WHEN COALESCE(i.tax_exempt, 0) = 1 THEN 0 ELSE COALESCE(ii.tax_rate, ${defaultTax}) END`;
    let sqlWr = `
      SELECT ${wrRateExpr} as tax_rate,
             SUM(CASE WHEN ii.line_total IS NOT NULL AND (${wrRateExpr}) > 0 THEN ii.line_total / (1.0 + (${wrRateExpr}) / 100.0)
                 WHEN ii.line_total IS NOT NULL THEN ii.line_total
                 ELSE COALESCE(ii.quantity, 0) * COALESCE(ii.unit_price, 0) END) as base_ht,
             SUM(CASE WHEN ii.line_total IS NOT NULL AND (${wrRateExpr}) > 0 THEN ii.line_total - (ii.line_total / (1.0 + (${wrRateExpr}) / 100.0))
                 ELSE COALESCE(ii.quantity, 0) * COALESCE(ii.unit_price, 0) * (${wrRateExpr}) / 100.0 END) as tva
      FROM invoice_items ii INNER JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.status != 'cancelled'
        AND (i.status = 'remboursement' OR COALESCE(i.doc_kind, '') = 'remboursement')`;
    const bindsWr: any[] = [];
    if (from) { sqlWr += ` AND i.issue_date >= ?`; bindsWr.push(from); }
    if (to) { sqlWr += ` AND i.issue_date <= ?`; bindsWr.push(to); }
    sqlWr += ` GROUP BY 1`;
    const wr = await c.env.DB.prepare(sqlWr).bind(...bindsWr).all();
    const esc = (v: any) => {
      const s = String(v ?? '');
      if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = ['Type;Taux_TVA;Base_HT;TVA'];
    for (const r of (results || []) as any[]) {
      lines.push(['Vente', r.tax_rate, roundCurrency(Number(r.base_ht || 0), cur, 'ledger').toFixed(dec), roundCurrency(Number(r.tva || 0), cur, 'ledger').toFixed(dec)].map(esc).join(';'));
    }
    for (const r of (wr.results || []) as any[]) {
      lines.push(['Avoir_WR', r.tax_rate, roundCurrency(Number(r.base_ht || 0), cur, 'ledger').toFixed(dec), roundCurrency(Number(r.tva || 0), cur, 'ledger').toFixed(dec)].map(esc).join(';'));
    }
    const period = [from || 'debut', to || 'fin'].join('_');
    const bom = '\uFEFF';
    return new Response(bom + lines.join('\n'), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="tva-${period}.csv"`,
      },
    });
  });
  
  app.get('/api/reports/aging.html', async (c) => {
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const cur = String(settings?.currency || settings?.finance_currency || 'MAD');
    const curDec = getCurrencySpec(cur).invoiceDecimals;
    const fmtMoney = (n: number) => roundCurrency(Number(n || 0), cur, 'invoice').toLocaleString('fr-FR', { minimumFractionDigits: curDec, maximumFractionDigits: curDec });
    const { results } = await c.env.DB.prepare(
      `SELECT id, number, client_name, issue_date, due_date, total, amount_paid, status,
              ROUND(total - COALESCE(amount_paid, 0), 2) as remaining
       FROM invoices
       WHERE status NOT IN ('quote', 'devis', 'cancelled', 'remboursement', 'paid')
         AND COALESCE(doc_kind, '') != 'remboursement'
         AND (total - COALESCE(amount_paid, 0)) > 0.001
       ORDER BY COALESCE(due_date, issue_date) ASC`
    ).all();
    const today = localTodayYmd('Africa/Casablanca');
    const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
    let total = 0;
    const rows = (results || []).map((r: any) => {
      const rem = Math.max(0, subMoneyAmounts(Number(r.total || 0), Number(r.amount_paid || 0), cur));
      const due = String(r.due_date || r.issue_date || today).slice(0, 10);
      const days = daysBetweenYmd(due, today) ?? 0;
      if (days > 90) buckets.d90_plus = addMoneyAmounts(buckets.d90_plus, rem, cur);
      else if (days > 60) buckets.d61_90 = addMoneyAmounts(buckets.d61_90, rem, cur);
      else if (days > 30) buckets.d31_60 = addMoneyAmounts(buckets.d31_60, rem, cur);
      else if (days > 0) buckets.d1_30 = addMoneyAmounts(buckets.d1_30, rem, cur);
      else buckets.current = addMoneyAmounts(buckets.current, rem, cur);
      total = addMoneyAmounts(total, rem, cur);
      return { ...r, days_overdue: Math.max(0, days), remaining: rem };
    });
    const table = rows.map((r: any) => `<tr>
      <td>${escapeHtml(String(r.number || ''))}</td>
      <td>${escapeHtml(String(r.client_name || ''))}</td>
      <td>${escapeHtml(r.due_date || r.issue_date || '—')}</td>
      <td>${r.days_overdue}</td>
      <td class="out">${fmtMoney(r.remaining)} ${escapeHtml(String(cur))}</td>
    </tr>`).join('') || `<tr><td colspan="5">Aucune créance ouverte</td></tr>`;
    const body = `
    <div class="grid">
      <div class="stat"><div class="l">Total créances</div><div class="v out">${fmtMoney(total)} ${escapeHtml(String(cur))}</div></div>
      <div class="stat"><div class="l">Courant</div><div class="v">${fmtMoney(buckets.current)}</div></div>
      <div class="stat"><div class="l">1–30 j</div><div class="v">${fmtMoney(buckets.d1_30)}</div></div>
      <div class="stat"><div class="l">31–60 j</div><div class="v">${fmtMoney(buckets.d31_60)}</div></div>
      <div class="stat"><div class="l">61–90 j</div><div class="v">${fmtMoney(buckets.d61_90)}</div></div>
      <div class="stat"><div class="l">90+ j</div><div class="v out">${fmtMoney(buckets.d90_plus)}</div></div>
    </div>
    <h2>Détail des créances — au ${today}</h2>
    <table>
      <thead><tr><th>N°</th><th>Client</th><th>Échéance</th><th>Jours</th><th>Reste dû</th></tr></thead>
      <tbody>${table}</tbody>
    </table>`;
    return c.html(reportShell('Balance âgée clients', settings?.company_name || 'Atlas Commerce', `Au ${today}`, body, settings?.report_footer || settings?.notes, combinedBackUrl(c)));
  });
  
  /** Phase 4 — printable TVA HTML */
  app.get('/api/reports/tva.html', async (c) => {
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const cur = String(settings?.currency || settings?.finance_currency || 'MAD');
    const curDec = getCurrencySpec(cur).invoiceDecimals;
    const fmtMoney = (n: number) => roundCurrency(Number(n || 0), cur, 'invoice').toLocaleString('fr-FR', { minimumFractionDigits: curDec, maximumFractionDigits: curDec });
    const bounds = c.req.query('period') ? periodBounds(c, settings?.finance_timezone) : null;
    const from = bounds?.from || c.req.query('from') || '';
    const to = bounds?.to || c.req.query('to') || '';
    const defaultTax = Number(settings?.tax_rate ?? 20);
    await addColumnIfMissing(c.env.DB, 'invoice_items', 'tax_rate', `REAL DEFAULT 0`);
    await addColumnIfMissing(c.env.DB, 'invoices', 'tax_exempt', `INTEGER DEFAULT 0`);

    const rateExpr = `CASE WHEN COALESCE(i.tax_exempt, 0) = 1 OR COALESCE(i.doc_kind, '') IN ('quick_sale', 'ticket') OR COALESCE(i.number, '') LIKE 'VR%' THEN 0 ELSE COALESCE(NULLIF(ii.tax_rate, 0), ${defaultTax}) END`;
    let sql = `
      SELECT ${rateExpr} as tax_rate,
             SUM(
               CASE
                 WHEN ii.line_total IS NOT NULL AND (${rateExpr}) > 0
                   THEN ii.line_total / (1.0 + (${rateExpr}) / 100.0)
                 WHEN ii.line_total IS NOT NULL THEN ii.line_total
                 ELSE COALESCE(ii.quantity, 0) * COALESCE(ii.unit_price, 0)
               END
             ) as base_ht,
             SUM(
               CASE
                 WHEN ii.line_total IS NOT NULL AND (${rateExpr}) > 0
                   THEN ii.line_total - (ii.line_total / (1.0 + (${rateExpr}) / 100.0))
                 ELSE COALESCE(ii.quantity, 0) * COALESCE(ii.unit_price, 0) * (${rateExpr}) / 100.0
               END
             ) as tva
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.status NOT IN ('quote','devis','cancelled','remboursement')
        AND COALESCE(i.doc_kind, '') != 'remboursement'`;
    const binds: any[] = [];
    if (from) { sql += ` AND i.issue_date >= ?`; binds.push(from); }
    if (to) { sql += ` AND i.issue_date <= ?`; binds.push(to); }
    sql += ` GROUP BY 1 ORDER BY 1`;
    const { results } = await c.env.DB.prepare(sql).bind(...binds).all();

    const wrRateExpr = `CASE WHEN COALESCE(i.tax_exempt, 0) = 1 THEN 0 ELSE COALESCE(ii.tax_rate, ${defaultTax}) END`;
    let sqlWr = `
      SELECT ${wrRateExpr} as tax_rate,
             SUM(CASE WHEN ii.line_total IS NOT NULL AND (${wrRateExpr}) > 0 THEN ii.line_total / (1.0 + (${wrRateExpr}) / 100.0)
                 WHEN ii.line_total IS NOT NULL THEN ii.line_total
                 ELSE COALESCE(ii.quantity, 0) * COALESCE(ii.unit_price, 0) END) as base_ht,
             SUM(CASE WHEN ii.line_total IS NOT NULL AND (${wrRateExpr}) > 0 THEN ii.line_total - (ii.line_total / (1.0 + (${wrRateExpr}) / 100.0))
                 ELSE COALESCE(ii.quantity, 0) * COALESCE(ii.unit_price, 0) * (${wrRateExpr}) / 100.0 END) as tva
      FROM invoice_items ii
      INNER JOIN invoices i ON i.id = ii.invoice_id
      WHERE i.status != 'cancelled'
        AND (i.status = 'remboursement' OR COALESCE(i.doc_kind, '') = 'remboursement')`;
    const bindsWr: any[] = [];
    if (from) { sqlWr += ` AND i.issue_date >= ?`; bindsWr.push(from); }
    if (to) { sqlWr += ` AND i.issue_date <= ?`; bindsWr.push(to); }
    sqlWr += ` GROUP BY 1`;
    const wr = await c.env.DB.prepare(sqlWr).bind(...bindsWr).all();

    const sales: { tax_rate: number; base_ht: number; tva: number }[] = (results || []).map((r: any) => ({
      tax_rate: Number(r.tax_rate),
      base_ht: roundCurrency(Number(r.base_ht || 0), cur, 'ledger'),
      tva: roundCurrency(Number(r.tva || 0), cur, 'ledger'),
    }));
    const credits: { tax_rate: number; base_ht: number; tva: number }[] = (wr.results || []).map((r: any) => ({
      tax_rate: Number(r.tax_rate),
      base_ht: roundCurrency(Number(r.base_ht || 0), cur, 'ledger'),
      tva: roundCurrency(Number(r.tva || 0), cur, 'ledger'),
    }));
    const totalSalesTva = sales.reduce((s, r) => addMoneyAmounts(s, r.tva, cur), 0);
    const totalCreditsTva = credits.reduce((s, r) => addMoneyAmounts(s, r.tva, cur), 0);
    const periodLabel = [from || '…', to || '…'].join(' → ');
  
    const salesRows = sales.map((r) => `<tr><td>${r.tax_rate} %</td><td class="num">${fmtMoney(r.base_ht)}</td><td class="num">${fmtMoney(r.tva)}</td></tr>`).join('')
      || `<tr><td colspan="3">Aucune vente</td></tr>`;
    const creditRows = credits.map((r) => `<tr><td>${r.tax_rate} %</td><td class="num">${fmtMoney(r.base_ht)}</td><td class="num">${fmtMoney(r.tva)}</td></tr>`).join('')
      || `<tr><td colspan="3">Aucun avoir</td></tr>`;
  
    const body = `
    <div class="grid">
      <div class="stat"><div class="l">TVA collectée</div><div class="v in">${fmtMoney(totalSalesTva)} ${escapeHtml(String(cur))}</div></div>
      <div class="stat"><div class="l">TVA avoirs WR</div><div class="v out">${fmtMoney(totalCreditsTva)} ${escapeHtml(String(cur))}</div></div>
      <div class="stat"><div class="l">Net à déclarer</div><div class="v">${fmtMoney(totalSalesTva - totalCreditsTva)} ${escapeHtml(String(cur))}</div></div>
      <div class="stat"><div class="l">Période</div><div class="v" style="font-size:13px">${escapeHtml(periodLabel)}</div></div>
    </div>
    <h2>Ventes par taux</h2>
    <table><thead><tr><th>Taux</th><th>Base HT</th><th>TVA</th></tr></thead><tbody>${salesRows}</tbody></table>
    <h2>Avoirs / WR (à déduire)</h2>
    <table><thead><tr><th>Taux</th><th>Base HT</th><th>TVA</th></tr></thead><tbody>${creditRows}</tbody></table>`;
    return c.html(reportShell('Récapitulatif TVA', settings?.company_name || 'Atlas Commerce', periodLabel, body, settings?.report_footer || settings?.notes, combinedBackUrl(c)));
  });
  
  /** Phase 1 — reorder list */
  
  app.get('/api/reports/cogs', async (c) => {
    await ensureValuationTables(c.env.DB);
    const method = await getValuationMethod(c.env.DB);
    const from = c.req.query('from') || '';
    const to = c.req.query('to') || '';
    let sql = `
      SELECT sm.product_id, p.name, p.sku, p.cost as unit_cost,
             SUM(CASE WHEN sm.type IN ('sale','out') THEN sm.quantity ELSE 0 END) as qty_sold,
             SUM(CASE WHEN sm.type IN ('sale','out') THEN sm.quantity * COALESCE(p.cost,0) ELSE 0 END) as cogs_approx
      FROM stock_movements sm
      INNER JOIN products p ON p.id = sm.product_id
      WHERE 1=1`;
    const binds: any[] = [];
    if (from) { sql += ` AND date(sm.created_at) >= date(?)`; binds.push(from); }
    if (to) { sql += ` AND date(sm.created_at) <= date(?)`; binds.push(to); }
    sql += ` GROUP BY sm.product_id HAVING qty_sold > 0 ORDER BY cogs_approx DESC LIMIT 200`;
    let lines: any[] = [];
    try {
      const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
      lines = (results || []).map((r: any) => ({
        product_id: r.product_id,
        name: r.name,
        sku: r.sku,
        qty_sold: Number(r.qty_sold || 0),
        unit_cost: Number(r.unit_cost || 0),
        cogs: Number(r.cogs_approx || 0),
      }));
    } catch {
      // Do not log report query data or tickets.
    }
    // FIFO layers remaining value
    let layers_value = 0;
    let layers_qty = 0;
    try {
      const { results: layers } = await c.env.DB.prepare(
        `SELECT SUM(quantity_remaining * unit_cost) as v, SUM(quantity_remaining) as q FROM stock_cost_layers WHERE quantity_remaining > 0`
      ).all();
      layers_value = Number((layers || [])[0]?.v || 0);
      layers_qty = Number((layers || [])[0]?.q || 0);
    } catch { /* */ }
    const total_cogs = lines.reduce((s, l) => s + l.cogs, 0);
    return c.json({
      success: true,
      data: {
        method,
        lines,
        total_cogs,
        fifo_layers_qty: layers_qty,
        fifo_layers_value: layers_value,
        from: from || null,
        to: to || null,
        note: method === 'fifo'
          ? 'COGS approximé via coût affiché produit ; couches FIFO restantes listées séparément.'
          : 'COGS = qté vendue × coût unitaire produit (CMP ou standard).',
      },
    });
  });
  
  
  app.get('/api/reports/balance', async (c) => {
    await ensureExpenseTypeColumn(c.env.DB);
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const { from, to, label } = periodBounds(c, settings?.finance_timezone);
    const cur = settings?.currency || 'MAD';
    const { rows, cashIn, cashOut, bankIn, bankOut, ownerDraw, ownerContrib, income, expense } =
      await readBalanceReport(c.env.DB, from, to);
  
    const typeLabel = (e: any) => {
      if (e.entry_type === 'income') return 'Recette';
      if (e.entry_type === 'owner_draw') return 'Prélèvement propriétaire';
      if (e.entry_type === 'owner_contrib') return 'Apport propriétaire';
      return 'Dépense';
    };
  
    const tableRows = rows.map((e) => {
      const inn = balanceIsIncome(e);
      return `<tr>
        <td>${escapeHtml(e.expense_date || '')}</td>
        <td>${typeLabel(e)}</td>
        <td>${escapeHtml(String(e.description || ''))}</td>
        <td>${escapeHtml(String(e.category || ''))}</td>
        <td>${escapeHtml(String(e.payment_method || '—'))}</td>
        <td class="${inn ? 'in' : 'out'}">${inn ? '+' : '−'}${fmtN(e.amount)} ${escapeHtml(String(cur))}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="6">Aucune écriture sur la période</td></tr>`;
  
    const body = `
    <div class="grid">
      <div class="stat"><div class="l">Espèces entrées</div><div class="v in">+${fmtN(cashIn)}</div></div>
      <div class="stat"><div class="l">Espèces sorties</div><div class="v out">−${fmtN(cashOut)}</div></div>
      <div class="stat"><div class="l">Banque entrées</div><div class="v in">+${fmtN(bankIn)}</div></div>
      <div class="stat"><div class="l">Banque sorties</div><div class="v out">−${fmtN(bankOut)}</div></div>
    </div>
    <div class="grid">
      <div class="stat"><div class="l">Recettes</div><div class="v in">+${fmtN(income)}</div></div>
      <div class="stat"><div class="l">Dépenses</div><div class="v out">−${fmtN(expense)}</div></div>
      <div class="stat"><div class="l">Apports propriétaire</div><div class="v in">+${fmtN(ownerContrib)}</div></div>
      <div class="stat"><div class="l">Prélèvements propriétaire</div><div class="v out">−${fmtN(ownerDraw)}</div></div>
    </div>
    <h2>Détail des mouvements</h2>
    <table>
      <thead><tr><th>Date</th><th>Type</th><th>Libellé</th><th>Catégorie</th><th>Mode</th><th>Montant</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>`;
  
    return c.html(reportShell(`Rapport solde & mouvements`, settings?.company_name || 'Atlas Commerce', label, body, settings?.report_footer || settings?.notes, combinedBackUrl(c)));
  });
  
  app.get('/api/reports/stock', async (c) => {
    await ensureStockLocations(c.env.DB);
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const cur = settings?.currency || 'MAD';
    const locParam = c.req.query('location_id') || 'all';
    const rt = (c as any).get('reportTicket') || '';
    if (locParam !== 'all' && !/^[1-9]\d*$/.test(locParam)) {
      return c.json({ success: false, code: 'BAD_LOCATION', error: 'Emplacement invalide' }, 400);
    }
    const locs = await c.env.DB.prepare(
      `SELECT id, code, name, is_default FROM stock_locations WHERE COALESCE(is_active,1)=1 ORDER BY COALESCE(is_default,0) DESC, name`
    ).all();
    const locations = (locs.results || []) as any[];
    if (locParam !== 'all' && !locations.some((l: any) => String(l.id) === locParam)) {
      return c.json({ success: false, code: 'BAD_LOCATION', error: 'Emplacement introuvable' }, 404);
    }
  
    let products: any[] = [];
    let locLabel = 'Tous les emplacements';
    if (locParam !== 'all' && Number(locParam) > 0) {
      const loc = locations.find((l: any) => Number(l.id) === Number(locParam));
      locLabel = loc ? `${loc.name} (${loc.code})` : `Emplacement #${locParam}`;
      const r = await c.env.DB.prepare(
        `SELECT p.id, p.sku, p.name, p.category, p.cost, p.price, p.track_inventory, p.low_stock_threshold,
                COALESCE(q.quantity, 0) as stock_quantity
         FROM products p
         LEFT JOIN stock_location_qty q ON q.product_id = p.id AND q.location_id = ?
         WHERE p.is_active = 1
         ORDER BY COALESCE(p.category, 'zzz'), p.name`
      ).bind(Number(locParam)).all();
      products = (r.results || []) as any[];
    } else {
      const r = await c.env.DB.prepare(
        `SELECT id, sku, name, category, cost, price, stock_quantity, track_inventory, low_stock_threshold
         FROM products WHERE is_active = 1 ORDER BY COALESCE(category, 'zzz'), name`
      ).all();
      products = (r.results || []) as any[];
    }
  
    const groups = new Map<string, any[]>();
    for (const p of products) {
      const cat = (p.category && String(p.category).trim()) || 'Sans catégorie';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(p);
    }
  
    let costTotal = 0, sellTotal = 0, lowCount = 0, qtyTotal = 0;
    const sections: string[] = [];
    let catIndex = 0;
  
    for (const [cat, list] of groups) {
      catIndex++;
      let catCost = 0, catSell = 0, catQty = 0, catLow = 0;
      const rows = list.map((p) => {
        const qty = Number(p.stock_quantity || 0);
        const cost = Number(p.cost || 0);
        const price = Number(p.price || 0);
        const val = computeInventoryValuation([p], cur);
        const costVal = val.cost_total;
        const sellVal = val.sell_total;
        const gain = val.potential_margin;
        costTotal = round2(costTotal + costVal);
        sellTotal = round2(sellTotal + sellVal);
        catCost = round2(catCost + costVal);
        catSell = round2(catSell + sellVal);
        if (p.track_inventory) {
          catQty += qty;
          qtyTotal += qty;
        }
        const low = p.track_inventory && qty <= Number(p.low_stock_threshold || 0);
        if (low) { lowCount++; catLow++; }
        return `<tr class="${low ? 'low' : ''}">
          <td>${escapeHtml(String(p.sku || '—'))}</td>
          <td><strong>${escapeHtml(String(p.name || ''))}</strong>${low ? ' <span class="badge-low">Stock bas</span>' : ''}</td>
          <td class="num">${p.track_inventory ? qty : '—'}</td>
          <td class="num">${fmtN(cost)}</td>
          <td class="num">${fmtN(price)}</td>
          <td class="num">${fmtN(costVal)}</td>
          <td class="num">${fmtN(sellVal)}</td>
          <td class="num ${gain >= 0 ? 'in' : 'out'}">${fmtN(gain)}</td>
        </tr>`;
      }).join('');
      const catMargin = catSell - catCost;
      const marginPct = catCost > 0 ? ((catMargin / catCost) * 100).toFixed(1) : '—';
  
      sections.push(`
      <div class="cat-block">
        <h2 class="cat-title">
          <span>${catIndex}. ${escapeHtml(cat)}</span>
          <span class="cat-meta">${list.length} réf. · Qté ${fmtN(catQty)}</span>
        </h2>
        <table>
          <thead><tr>
            <th>Réf.</th><th>Produit</th><th class="num">Qté</th>
            <th class="num">Coût unit.</th><th class="num">Prix unit.</th>
            <th class="num">Valeur coût</th><th class="num">Valeur vente</th><th class="num">Marge</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="cat-totals">
          <div class="ct">Qté totale<strong>${fmtN(catQty)}</strong></div>
          <div class="ct">Total coût<strong>${fmtN(catCost)} ${escapeHtml(String(cur))}</strong></div>
          <div class="ct">Total vente<strong>${fmtN(catSell)} ${escapeHtml(String(cur))}</strong></div>
          <div class="ct">Marge catégorie<strong class="${catMargin >= 0 ? 'in' : 'out'}">${fmtN(catMargin)} ${escapeHtml(String(cur))} <span class="muted">(${marginPct}%)</span></strong></div>
        </div>
        ${catLow ? `<p class="muted" style="margin:6px 0 0">${catLow} alerte(s) stock bas dans cette catégorie</p>` : ''}
      </div>`);
    }
  
    const gainTotal = sellTotal - costTotal;
    const opts = locations.map((l: any) => `<option value="${Number(l.id)}"${String(l.id) === locParam ? ' selected' : ''}>${escapeHtml(l.name || l.code || '')}</option>`).join('');
    const body = `
    <form method="get" action="/api/reports/stock" class="actions">
      <input type="hidden" name="rt" value="${escapeHtml(rt)}" />
      <label>Entrepôt : <select name="location_id"><option value="all">Tous les emplacements</option>${opts}</select></label>
      <button type="submit">Afficher</button>
    </form>
    <p class="muted">Entrepôt : <strong>${escapeHtml(locLabel)}</strong></p>
    <div class="grid grid-4">
      <div class="stat"><div class="l">Valeur au coût</div><div class="v">${fmtN(costTotal)} ${escapeHtml(String(cur))}</div></div>
      <div class="stat"><div class="l">Valeur à la vente</div><div class="v">${fmtN(sellTotal)} ${escapeHtml(String(cur))}</div></div>
      <div class="stat"><div class="l">Marge potentielle</div><div class="v ${gainTotal >= 0 ? 'in' : 'out'}">${fmtN(gainTotal)} ${escapeHtml(String(cur))}</div></div>
      <div class="stat"><div class="l">Alertes stock bas</div><div class="v ${lowCount ? 'out' : ''}">${lowCount}</div></div>
    </div>
    <p class="muted" style="margin-bottom:16px">${products.length} références · ${groups.size} catégorie(s) · Qté ${fmtN(qtyTotal)}</p>
    ${sections.join('') || '<p>Aucun produit actif sur cet emplacement.</p>'}`;
  
    return c.html(reportShell(
      'Rapport stock par catégories',
      settings?.company_name || 'Atlas Commerce',
      `Inventaire valorisé · ${locLabel}`,
      body,
      settings?.report_footer || settings?.notes,
      combinedBackUrl(c),
    ));
  });
  
  
  app.get('/api/reports/receivables', async (c) => {
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const cur = settings?.currency || settings?.finance_currency || 'MAD';
    const { results } = await c.env.DB.prepare(
      `SELECT id, number, client_name, issue_date, due_date, total, amount_paid, status
       FROM invoices WHERE status IN ('sent', 'partial', 'overdue', 'draft') AND status != 'quote'
       ORDER BY due_date ASC NULLS LAST, issue_date ASC`
    ).all();
    const rows = (results || []) as any[];
    let total = 0;
    const table = rows.map((inv) => {
      const rest = Math.max(0, subMoneyAmounts(Number(inv.total || 0), Number(inv.amount_paid || 0), cur));
      total = addMoneyAmounts(total, rest, cur);
      return `<tr>
        <td>${escapeHtml(String(inv.number || ''))}</td>
        <td>${escapeHtml(String(inv.client_name || ''))}</td>
        <td>${escapeHtml(String(inv.issue_date || ''))}</td>
        <td>${escapeHtml(String(inv.due_date || '—'))}</td>
        <td>${escapeHtml(String(inv.status || ''))}</td>
        <td class="out">${fmtN(rest)} ${escapeHtml(String(cur))}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="6">Aucune créance</td></tr>`;
  
    const body = `
    <div class="grid">
      <div class="stat"><div class="l">Total à recevoir</div><div class="v out">${fmtN(total)} ${escapeHtml(String(cur))}</div></div>
      <div class="stat"><div class="l">Factures</div><div class="v">${rows.length}</div></div>
    </div>
    <h2>Factures de vente impayées</h2>
    <table>
      <thead><tr><th>N°</th><th>Client</th><th>Émission</th><th>Échéance</th><th>Statut</th><th>Reste dû</th></tr></thead>
      <tbody>${table}</tbody>
    </table>`;
    return c.html(reportShell('Rapport créances clients', settings?.company_name || 'Atlas Commerce', 'À encaisser', body, settings?.report_footer || settings?.notes, combinedBackUrl(c)));
  });
  
  app.get('/api/reports/payables', async (c) => {
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const cur = settings?.currency || settings?.finance_currency || 'MAD';
    const { results } = await c.env.DB.prepare(
      `SELECT id, number, vendor_name, issue_date, due_date, total, amount_paid, status
       FROM bills WHERE status IN ('sent', 'partial', 'draft')
       ORDER BY due_date ASC NULLS LAST, issue_date ASC`
    ).all();
    const rows = (results || []) as any[];
    let total = 0;
    const table = rows.map((b) => {
      const rest = Math.max(0, subMoneyAmounts(Number(b.total || 0), Number(b.amount_paid || 0), cur));
      total = addMoneyAmounts(total, rest, cur);
      return `<tr>
        <td>${escapeHtml(String(b.number || ''))}</td>
        <td>${escapeHtml(String(b.vendor_name || ''))}</td>
        <td>${escapeHtml(String(b.issue_date || ''))}</td>
        <td>${escapeHtml(String(b.due_date || '—'))}</td>
        <td>${escapeHtml(String(b.status || ''))}</td>
        <td class="out">${fmtN(rest)} ${escapeHtml(String(cur))}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="6">Aucune dette</td></tr>`;
  
    const body = `
    <div class="grid">
      <div class="stat"><div class="l">Total à payer</div><div class="v out">${fmtN(total)} ${escapeHtml(String(cur))}</div></div>
      <div class="stat"><div class="l">Factures d'achat</div><div class="v">${rows.length}</div></div>
    </div>
    <h2>Factures d'achat impayées</h2>
    <table>
      <thead><tr><th>N°</th><th>Fournisseur</th><th>Émission</th><th>Échéance</th><th>Statut</th><th>Reste dû</th></tr></thead>
      <tbody>${table}</tbody>
    </table>`;
    return c.html(reportShell('Rapport dettes fournisseurs', settings?.company_name || 'Atlas Commerce', 'À régler', body, settings?.report_footer || settings?.notes, combinedBackUrl(c)));
  });
  
  
  
  app.get('/api/reports/client-situation', async (c) => {
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const cur = String(settings?.currency || settings?.finance_currency || 'MAD');
    const curDec = getCurrencySpec(cur).invoiceDecimals;
    const fmtMoney = (n: number) => roundCurrency(Number(n || 0), cur, 'invoice').toLocaleString('fr-FR', { minimumFractionDigits: curDec, maximumFractionDigits: curDec });
    const name = String(c.req.query('name') || '').trim();
    const ice = String(c.req.query('ice') || '').trim();
    const clientId = String(c.req.query('client_id') || '').trim();
  
    if (!name && !ice && !clientId) {
      return c.html(reportShell(
        'Situation client',
        settings?.company_name || 'Atlas Commerce',
        'Paramètre manquant',
        '<p>Indiquez <code>name</code>, <code>ice</code> ou <code>client_id</code> dans l’URL, ou ouvrez depuis la fiche client.</p>',
        settings?.report_footer || settings?.notes,
      ));
    }
  
    let clientRow: any = null;
    if (clientId) {
      clientRow = await c.env.DB.prepare(`SELECT * FROM clients WHERE id = ?`).bind(clientId).first();
    }
    if (!clientRow && ice) {
      clientRow = await c.env.DB.prepare(`SELECT * FROM clients WHERE ice = ?`).bind(ice).first();
    }
    if (!clientRow && name) {
      clientRow = await c.env.DB.prepare(`SELECT * FROM clients WHERE lower(name) = lower(?)`).bind(name).first();
    }
  
    const matchName = clientRow?.name || name;
    const matchIce = clientRow?.ice || ice;
  
    let invoices: any[] = [];
    if (matchIce) {
      const { results } = await c.env.DB.prepare(
        `SELECT id, number, issue_date, due_date, status, total, amount_paid, client_name, client_ice, doc_kind, refund_of_invoice_id
         FROM invoices WHERE client_ice = ? AND status NOT IN ('quote','devis','cancelled')
         ORDER BY issue_date DESC, id DESC LIMIT 200`
      ).bind(matchIce).all();
      invoices = results || [];
    }
    if (!invoices.length && matchName) {
      const { results } = await c.env.DB.prepare(
        `SELECT id, number, issue_date, due_date, status, total, amount_paid, client_name, client_ice, doc_kind, refund_of_invoice_id
         FROM invoices WHERE lower(client_name) = lower(?) AND status NOT IN ('quote','devis','cancelled')
         ORDER BY issue_date DESC, id DESC LIMIT 200`
      ).bind(matchName).all();
      invoices = results || [];
      if (!invoices.length) {
        const { results: fuzzy } = await c.env.DB.prepare(
          `SELECT id, number, issue_date, due_date, status, total, amount_paid, client_name, client_ice, doc_kind, refund_of_invoice_id
           FROM invoices WHERE lower(client_name) LIKE lower(?) AND status NOT IN ('quote','devis','cancelled')
           ORDER BY issue_date DESC, id DESC LIMIT 200`
        ).bind('%' + matchName + '%').all();
        invoices = fuzzy || [];
      }
    }
  
    // Receipts for this client
    let receipts: any[] = [];
    try {
      await ensureReceiptsTable(c.env.DB);
      if (matchName) {
        const { results } = await c.env.DB.prepare(
          `SELECT number, issue_date, amount, payment_method, invoice_id FROM receipts
           WHERE lower(client_name) = lower(?) OR lower(client_name) LIKE lower(?)
           ORDER BY issue_date DESC LIMIT 100`
        ).bind(matchName, '%' + matchName + '%').all();
        receipts = results || [];
      }
    } catch { /* ignore */ }
  
    const displayName = invoices[0]?.client_name || clientRow?.name || matchName || matchIce || 'Client';
    const detail = String(c.req.query('detail') || '').toLowerCase() === 'full'
      || String(c.req.query('mode') || '').toLowerCase() === 'detail';
    const isCreditDoc = (inv: any) =>
      inv.status === 'remboursement' ||
      inv.doc_kind === 'remboursement' ||
      String(inv.number || '').toUpperCase().startsWith('WR');
    const isVrDoc = (inv: any) =>
      inv.doc_kind === 'quick_sale' ||
      inv.doc_kind === 'ticket' ||
      String(inv.number || '').toUpperCase().startsWith('VR');
  
    let totalDue = 0, totalPaid = 0, totalTTC = 0, totalCredits = 0;
    const invRows = invoices.map((inv: any) => {
      const paid = Number(inv.amount_paid || 0);
      const total = Number(inv.total || 0);
      const credit = isCreditDoc(inv);
      const numSafe = escapeHtml(String(inv.number || ''));
      const dateSafe = escapeHtml(String(inv.issue_date || ''));
      if (credit) {
        totalCredits = addMoneyAmounts(totalCredits, total, cur);
        // Avoir WR : ne gonfle pas le reste dû client (déjà appliqué sur la pièce d'origine)
        const st = 'Avoir (WR)';
        const typeHint = inv.refund_of_invoice_id ? ` · lié #${Number(inv.refund_of_invoice_id)}` : '';
        return `<tr>
        <td>${numSafe}<div class="muted" style="font-size:11px">Avoir / remboursement${typeHint}</div></td>
        <td>${dateSafe}</td>
        <td class="num" style="color:#2a3040">−${fmtMoney(total)}</td>
        <td class="num">—</td>
        <td class="num" style="font-weight:700;color:#6366f1">0</td>
        <td>${st}</td>
      </tr>`;
      }
      const due = Math.max(0, subMoneyAmounts(total, paid, cur));
      totalPaid = addMoneyAmounts(totalPaid, paid, cur);
      totalTTC = addMoneyAmounts(totalTTC, total, cur);
      totalDue = addMoneyAmounts(totalDue, due, cur);
      let st = due <= 0.001 ? 'Soldée' : inv.status === 'partial' ? 'Partielle' : inv.status === 'paid' ? 'Soldée' : 'En cours';
      if (isVrDoc(inv) && st === 'Soldée') st = 'Ticket VR soldé';
      else if (isVrDoc(inv)) st = due <= 0.001 ? 'Ticket VR soldé' : 'Ticket VR';
      const kind = isVrDoc(inv) ? '<div class="muted" style="font-size:11px">Vente rapide</div>' : '';
      return `<tr>
        <td>${numSafe}${kind}</td>
        <td>${dateSafe}</td>
        <td class="num">${fmtMoney(total)}</td>
        <td class="num">${fmtMoney(paid)}</td>
        <td class="num" style="font-weight:700;color:${due > 0.001 ? '#8b2e2e' : '#6366f1'}">${fmtMoney(due)}</td>
        <td>${st}</td>
      </tr>`;
    }).join('');
  
    const payModeFr = (m: string) => {
      const x = String(m || '').toLowerCase();
      if (x === 'cash' || x === 'espèces' || x === 'especes') return 'Espèces';
      if (x === 'card' || x === 'carte') return 'Carte';
      if (x === 'transfer' || x === 'virement') return 'Virement';
      if (x === 'cheque' || x === 'chèque') return 'Chèque';
      return escapeHtml(String(m || '—'));
    };
    const recRows = receipts.map((r: any) =>
      `<tr><td>${escapeHtml(String(r.number || ''))}</td><td>${escapeHtml(String(r.issue_date || ''))}</td><td class="num">${fmtMoney(Number(r.amount))}</td><td>${payModeFr(r.payment_method)}</td></tr>`
    ).join('');
  
    // Detailed mode: product lines per invoice
    let detailBlocks = '';
    if (detail && invoices.length) {
      const chunks: string[] = [];
      for (const inv of invoices.slice(0, 80)) {
        let items: any[] = [];
        try {
          const { results } = await c.env.DB.prepare(
            `SELECT product_name, sku, quantity, unit_price, tax_rate, line_total
             FROM invoice_items WHERE invoice_id = ? ORDER BY id`
          ).bind(inv.id).all();
          items = results || [];
        } catch { items = []; }
        const paid = Number(inv.amount_paid || 0);
        const total = Number(inv.total || 0);
        const credit = isCreditDoc(inv);
        const due = credit ? 0 : Math.max(0, subMoneyAmounts(total, paid, cur));
        const lineRows = items.map((it: any) => {
          const qty = Number(it.quantity || 0);
          const pu = Number(it.unit_price || 0);
          const lt = Number(it.line_total != null ? it.line_total : qty * pu);
          return `<tr>
            <td>${escapeHtml(String(it.product_name || '—'))}${it.sku ? ` <span class="muted">(${escapeHtml(String(it.sku))})</span>` : ''}</td>
            <td class="num">${qty}</td>
            <td class="num">${fmtMoney(pu)}</td>
            <td class="num">${fmtMoney(Number(it.tax_rate || 0))}%</td>
            <td class="num">${fmtMoney(lt)}</td>
          </tr>`;
        }).join('');
        chunks.push(`
          <div class="card" style="margin:16px 0;padding:12px 14px;border:1px solid var(--line,#ddd);border-radius:10px;page-break-inside:avoid">
            <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:8px">
              <div>
                <strong style="font-size:15px">${escapeHtml(String(inv.number || '—'))}</strong>
                <span class="muted"> · ${escapeHtml(String(inv.issue_date || ''))}</span>
              </div>
              <div class="muted">TTC ${fmtMoney(total)} · Payé ${fmtMoney(paid)} · <strong style="color:${due > 0.001 ? '#8b2e2e' : '#6366f1'}">Reste ${fmtMoney(due)} ${escapeHtml(cur)}</strong></div>
            </div>
            <table>
              <thead><tr><th>Produit / service</th><th class="num">Qté</th><th class="num">P.U.</th><th class="num">TVA</th><th class="num">Total</th></tr></thead>
              <tbody>${lineRows || '<tr><td colspan="5">Aucune ligne produit</td></tr>'}</tbody>
            </table>
          </div>`);
      }
      detailBlocks = `<h2>Détail produits par facture</h2>${chunks.join('')}`;
    }
  
    const curSafe = escapeHtml(cur);
    const displaySafe = escapeHtml(String(displayName));
    const body = `
    <div class="grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat"><div class="l">Total facturé TTC</div><div class="v">${fmtMoney(totalTTC)} ${curSafe}</div></div>
      <div class="stat"><div class="l">Avoirs (WR)</div><div class="v" style="color:#2a3040">${fmtMoney(totalCredits)} ${curSafe}</div></div>
      <div class="stat"><div class="l">Déjà payé</div><div class="v in">${fmtMoney(totalPaid)} ${curSafe}</div></div>
      <div class="stat"><div class="l">Reste dû</div><div class="v ${totalDue > 0.001 ? 'out' : 'in'}">${fmtMoney(totalDue)} ${curSafe}</div></div>
    </div>
    <p class="muted"><strong>${displaySafe}</strong>
      ${matchIce ? ' · ICE ' + escapeHtml(String(matchIce)) : ''}
      ${clientRow?.phone ? ' · ' + escapeHtml(String(clientRow.phone)) : ''}
      ${clientRow?.email ? ' · ' + escapeHtml(String(clientRow.email)) : ''}
      ${clientRow?.address ? ' · ' + escapeHtml(String(clientRow.address)) : ''}
      ${clientRow?.city ? ' · ' + escapeHtml(String(clientRow.city)) : ''}
    </p>
    <p class="muted">${detail
      ? 'Vue <strong>détaillée</strong> : chaque pièce avec ses lignes produits.'
      : 'Vue <strong>synthèse</strong> : numéros et montants uniquement. Ouvrez la version « Détail produits » depuis la fiche client pour le détail des articles.'}</p>
    <h2>Pièces (factures, tickets VR, avoirs WR)</h2>
    <table>
      <thead><tr><th>N°</th><th>Date</th><th class="num">TTC</th><th class="num">Payé</th><th class="num">Reste</th><th>Statut</th></tr></thead>
      <tbody>${invRows || '<tr><td colspan="6">Aucune pièce pour ce client</td></tr>'}</tbody>
    </table>
    ${detailBlocks}
    <h2>Reçus d’encaissement</h2>
    <table>
      <thead><tr><th>N°</th><th>Date</th><th class="num">Montant</th><th>Mode</th></tr></thead>
      <tbody>${recRows || '<tr><td colspan="4">Aucun reçu</td></tr>'}</tbody>
    </table>
    <p class="muted" style="margin-top:14px;font-size:12px">Les avoirs WR réduisent le solde client et n’apparaissent pas comme une dette. Le reste dû ne compte que les factures FA et tickets VR non soldés.</p>`;
  
    return c.html(reportShell(
      (detail ? 'Situation client (détail) — ' : 'Situation client — ') + displayName,
      settings?.company_name || 'Atlas Commerce',
      (detail ? 'Détail des produits · ' : 'Synthèse · ') + 'Rapport interne · ' + new Date().toLocaleDateString('fr-FR'),
      body,
      settings?.report_footer || settings?.notes,
    ));
  });
  
  
  
  
  app.get('/api/reports/employee-blank-form', async (c) => {
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    return c.html(generateEmployeeFormHTML(settings, null, { autoPrint: true }));
  });
  
  
  app.get('/api/reports/employee-situation', async (c) => {
    const id = Number(c.req.query('employee_id') || c.req.query('id') || 0);
    if (!id) return c.html('<!DOCTYPE html><html><body><p>Employé manquant (employee_id).</p></body></html>', 400);
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const emp = await c.env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(id).first() as any;
    if (!emp) return c.html('<!DOCTYPE html><html><body><p>Employé introuvable.</p></body></html>', 404);
    const cur = String(settings?.currency || settings?.finance_currency || 'MAD');
    const curDec = getCurrencySpec(cur).minorDecimals;
    const fmtEmp = (n: number) => roundCurrency(Number(n || 0), cur, 'ledger').toLocaleString('fr-FR', { minimumFractionDigits: curDec, maximumFractionDigits: curDec });
    const name = [emp.first_name, emp.last_name].filter(Boolean).join(' ') || emp.name || '—';
    let payRows: any[] = [];
    try {
      const payments = await c.env.DB.prepare(
        `SELECT amount, paid_at, period_label, note FROM employee_payments WHERE employee_id = ? ORDER BY paid_at DESC LIMIT 36`
      ).bind(id).all();
      payRows = (payments.results || []) as any[];
    } catch { payRows = []; }
    const rows = payRows.map((p: any) =>
      `<tr><td>${escapeHtml(String(p.paid_at || '').slice(0, 10))}</td><td style="text-align:right">${fmtEmp(Number(p.amount || 0))} ${escapeHtml(cur)}</td><td>${escapeHtml(String(p.period_label || '—'))}</td><td>${escapeHtml(String(p.note || '—'))}</td></tr>`
    ).join('') || '<tr><td colspan="4">Aucun paiement enregistré</td></tr>';
    const cycle = emp.pay_cycle_type === 'days' ? `Tous les ${emp.pay_cycle_days || 7} jours` : 'Mensuel (30 j)';
    const body = `
    <h2 style="margin-top:0">${escapeHtml(name)}</h2>
    <p class="muted">${escapeHtml(String(emp.emp_number || ''))} · ${escapeHtml(String(emp.role_title || '—'))} · ${escapeHtml(String(emp.contract_type || 'CDI'))} · ${escapeHtml(String(emp.nationality || '—'))}</p>
    <div class="grid">
      <div class="stat"><div class="l">Salaire / cycle</div><div class="v">${fmtEmp(Number(emp.pay_amount || 0))} ${escapeHtml(cur)}</div></div>
      <div class="stat"><div class="l">Cycle</div><div class="v">${escapeHtml(cycle)}</div></div>
      <div class="stat"><div class="l">Entrée</div><div class="v">${escapeHtml(String(emp.joined_date || '—'))}</div></div>
      <div class="stat"><div class="l">Dernier paiement</div><div class="v">${escapeHtml(emp.last_paid_at ? String(emp.last_paid_at).slice(0, 10) : 'Jamais')}</div></div>
    </div>
    <table>
      <tbody>
        <tr><th>CIN / ID</th><td>${escapeHtml(String(emp.national_id || '—'))}</td><th>CNSS</th><td>${escapeHtml(String(emp.cnss_number || emp.social_insurance || '—'))}</td></tr>
        <tr><th>RIB</th><td colspan="3">${escapeHtml(String(emp.rib || '—'))}</td></tr>
        <tr><th>Adresse</th><td colspan="3">${escapeHtml([emp.address, emp.city, emp.country].filter(Boolean).join(', ') || '—')}</td></tr>
        <tr><th>Horaires</th><td>${escapeHtml(String(emp.weekly_hours || 44))} h / sem.</td><th>Essai</th><td>${escapeHtml(String(emp.trial_days ?? '—'))} j</td></tr>
        <tr><th>Fonctions</th><td colspan="3">${escapeHtml(String(emp.job_description || '—'))}</td></tr>
      </tbody>
    </table>
    <h2>Historique des paiements de salaire</h2>
    <table><thead><tr><th>Date</th><th>Montant</th><th>Période</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>`;
    return c.html(reportShell(`Situation employé — ${name}`, settings?.company_name || 'Atlas Commerce', emp.emp_number || String(id), body, settings?.report_footer || settings?.notes, combinedBackUrl(c)));
  });
  
  app.get('/api/reports/employees', async (c) => {
    const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
    const cur = String(settings?.currency || settings?.finance_currency || 'MAD');
    let rows: any[] = [];
    try {
      const r = await c.env.DB.prepare(
        `SELECT emp_number, first_name, last_name, role_title, pay_amount, pay_cycle_type, pay_cycle_days,
                last_paid_at, COALESCE(active,1) as active, joined_date
         FROM employees ORDER BY COALESCE(active,1) DESC, last_name, first_name`
      ).all();
      rows = (r.results || []) as any[];
    } catch {
      return c.json({ success: false, code: 'REPORT_GENERATION_FAILED', error: 'Rapport employés indisponible' }, 500);
    }
    const curDec = getCurrencySpec(cur).minorDecimals;
    const fmtMoney = (n: number) => roundCurrency(Number(n || 0), cur, 'ledger').toLocaleString('fr-FR', { minimumFractionDigits: curDec, maximumFractionDigits: curDec });
    const active = rows.filter((e) => Number(e.active) !== 0);
    const payroll = active.reduce((s, e) => s + Number(e.pay_amount || 0), 0);
    const table = rows.map((e) => {
      const name = [e.first_name, e.last_name].filter(Boolean).join(' ') || '—';
      const cycle = e.pay_cycle_type === 'days' ? `tous les ${e.pay_cycle_days || 7} j` : 'mensuel';
      return `<tr>
        <td>${escapeHtml(String(e.emp_number || '—'))}</td>
        <td>${escapeHtml(name)}</td>
        <td>${escapeHtml(String(e.role_title || '—'))}</td>
        <td style="text-align:right">${fmtMoney(e.pay_amount)} ${escapeHtml(String(cur))}</td>
        <td>${escapeHtml(cycle)}</td>
        <td>${escapeHtml(e.last_paid_at ? String(e.last_paid_at).slice(0, 10) : '—')}</td>
        <td>${Number(e.active) !== 0 ? 'Actif' : 'Démissionné'}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="7">Aucun employé</td></tr>`;
    const body = `
    <div class="grid">
      <div class="stat"><div class="l">Effectif actif</div><div class="v">${active.length}</div></div>
      <div class="stat"><div class="l">Masse salariale (cycles)</div><div class="v">${fmtMoney(payroll)} ${escapeHtml(String(cur))}</div></div>
      <div class="stat"><div class="l">Total fiches</div><div class="v">${rows.length}</div></div>
    </div>
    <h2>Registre du personnel</h2>
    <table>
      <thead><tr><th>N°</th><th>Nom</th><th>Poste</th><th>Salaire</th><th>Cycle</th><th>Dernier paiement</th><th>Statut</th></tr></thead>
      <tbody>${table}</tbody>
    </table>`;
    return c.html(reportShell('Rapport employés & paie', settings?.company_name || 'Atlas Commerce', new Date().toISOString().slice(0, 10), body, settings?.report_footer || settings?.notes, combinedBackUrl(c)));
  });
  
  
  app.get('/api/reports/combined', async (c) => {
    const supported: Record<string, { path: string; label: string }> = {
      balance: { path: '/api/reports/balance', label: 'Solde & mouvements' },
      stock: { path: '/api/reports/stock', label: 'Stock & valorisation' },
      receivables: { path: '/api/reports/receivables', label: 'Créances clients' },
      payables: { path: '/api/reports/payables', label: 'Dettes fournisseurs' },
      employees: { path: '/api/reports/employees', label: 'Employés & paie' },
      aging: { path: '/api/reports/aging.html', label: 'Balance âgée' },
      tva: { path: '/api/reports/tva.html', label: 'Récapitulatif TVA' },
    };
    const selected = c.req.query('sections') === undefined ? Object.keys(supported) : String(c.req.query('sections')).split(',');
    if (!selected.length || selected.some((key) => !Object.hasOwn(supported, key)) || new Set(selected).size !== selected.length) {
      return c.json({ success: false, code: 'UNSUPPORTED_REPORT', error: 'Section de rapport non prise en charge' }, 400);
    }
    try {
      const settings = await c.env.DB.prepare(`SELECT * FROM company_settings WHERE id = 1`).first() as any;
      const { from, to, label, periodKey } = periodBounds(c, settings?.finance_timezone);
      const rt = String((c as any).get('reportTicket') || '');
      if (!rt) return c.json({ success: false, code: 'REPORT_TICKET_UNAVAILABLE', error: 'Ticket indisponible' }, 503);
      const queryFor = (key: string) => {
        const q = new URLSearchParams({ rt, period: periodKey });
        if (periodKey === 'custom') { q.set('from', from); q.set('to', to); }
        if (key === 'tva') { q.set('from', from); q.set('to', to); }
        if (key === 'stock') q.set('location_id', 'all');
        return q;
      };
      const sections: string[] = [];
      const links: string[] = [];
      for (const key of selected) {
        const section = supported[key];
        const path = `${section.path}?${queryFor(key).toString()}`;
        // Dispatch to the real handler, using its complete server-rendered output.
        // No credentials are fetched from a remote origin and no figures are recalculated here.
        const request = new Request(new URL(path, c.req.url), { headers: { 'CF-Connecting-IP': clientIp(c) } });
        const response = await app.fetch(request, c.env, c.executionCtx);
        if (response.status === 401) {
          const failure = await response.json().catch(() => null) as { code?: string } | null;
          const code = failure?.code === 'TICKET_EXPIRED' ? 'TICKET_EXPIRED' : 'INVALID_TICKET';
          return c.json({ success: false, code, error: 'Accès au rapport refusé' }, 401);
        }
        if (!response.ok || !(response.headers.get('content-type') || '').includes('text/html')) throw new Error('section unavailable');
        const html = await response.text();
        const match = html.match(/<!-- report-content-start -->\s*<main class="report-content">([\s\S]*?)<\/main>\s*<!-- report-content-end -->/);
        if (!match || !match[1].trim()) throw new Error('empty section');
        links.push(`<li><a href="${escapeHtml(path)}">${escapeHtml(section.label)}</a></li>`);
        sections.push(`<section><h2>${escapeHtml(section.label)}</h2>${match[1]}</section>`);
      }
      const body = `<p>Période : ${escapeHtml(label)} (${escapeHtml(from)} – ${escapeHtml(to)}).</p>
        <nav class="actions" aria-label="Sections"><ul>${links.join('')}</ul></nav>${sections.join('')}`;
      return c.html(reportShell('Rapports combinés', settings?.company_name || 'Atlas Commerce', label, body, settings?.report_footer || settings?.notes));
    } catch {
      return c.json({ success: false, code: 'REPORT_GENERATION_FAILED', error: 'Rapport combiné indisponible' }, 500);
    }
  });
  
  
}
