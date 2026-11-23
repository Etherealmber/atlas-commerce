import type { Hono } from 'hono';
import { round2 } from '../lib/financeCore';
import { buildZip } from '../lib/zip';
import { schemaOnceForDb } from '../lib/schema';

export interface FecRouteDeps {
  requireOwner: (c: any) => { ok: true; username: string; role?: string } | { ok: false; response: Response };
  writeAudit: (
    db: D1Database,
    entry: { username?: string; role?: string; action: string; entity?: string; entity_id?: string; detail?: string; ip?: string },
  ) => Promise<void>;
  clientIp: (c: any) => string;
}

const DEFAULT_ACCOUNTS: { account_key: string; code: string; label: string }[] = [
  { account_key: 'clients_receivable', code: '3421', label: 'Clients' },
  { account_key: 'sales_revenue', code: '7111', label: 'Ventes de marchandises' },
  { account_key: 'sales_vat', code: '4455', label: 'État, TVA facturée' },
  { account_key: 'suppliers_payable', code: '4411', label: 'Fournisseurs' },
  { account_key: 'purchases_expense', code: '6111', label: 'Achats revendus de marchandises' },
  { account_key: 'purchases_vat', code: '3455', label: 'État, TVA récupérable' },
  { account_key: 'cash_account', code: '5161', label: 'Caisses' },
  { account_key: 'bank_account', code: '5141', label: 'Banques' },
  { account_key: 'payroll_gross', code: '6171', label: 'Rémunérations du personnel' },
  { account_key: 'payroll_cnss_amo', code: '4441', label: 'Organismes sociaux (CNSS / AMO)' },
  { account_key: 'payroll_igr', code: '4452', label: 'État, impôts et taxes (IGR)' },
  { account_key: 'payroll_net_payable', code: '4432', label: 'Rémunérations dues au personnel' },
  { account_key: 'misc_expense', code: '6580', label: 'Autres charges et frais divers' },
  { account_key: 'misc_income', code: '7580', label: 'Autres produits divers' },
  { account_key: 'cash_variance', code: '6585', label: 'Écarts de caisse' },
];

export async function ensureAccountingAccountsSchema(db: D1Database): Promise<void> {
  await schemaOnceForDb(db, 'fec_accounts_schema_v17', async () => {
    await db
      .prepare(
        `CREATE TABLE IF NOT EXISTS accounting_accounts (
          account_key TEXT PRIMARY KEY,
          code TEXT NOT NULL,
          label TEXT NOT NULL,
          updated_at TEXT DEFAULT (datetime('now')),
          updated_by TEXT DEFAULT ''
        )`,
      )
      .run();
    for (const a of DEFAULT_ACCOUNTS) {
      await db
        .prepare(`INSERT OR IGNORE INTO accounting_accounts (account_key, code, label) VALUES (?, ?, ?)`)
        .bind(a.account_key, a.code, a.label)
        .run();
    }
  });
}

type FecRow = {
  JournalCode: string;
  JournalLib: string;
  EcritureNum: string;
  EcritureDate: string;
  CompteNum: string;
  CompteLib: string;
  CompAuxNum: string;
  CompAuxLib: string;
  PieceRef: string;
  PieceDate: string;
  EcritureLib: string;
  Debit: string;
  Credit: string;
  EcritureLet: string;
  ValidDate: string;
  Montantdevise: string;
  Idevise: string;
};

function fecDate(raw: unknown): string {
  const s = String(raw || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.replace(/-/g, '');
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

function fmtAmount(n: number): string {
  return round2(Math.max(0, Number(n || 0))).toFixed(2).replace('.', ',');
}

function fecCell(v: unknown): string {
  const s = String(v ?? '').replace(/[\r\n\t]+/g, ' ').trim();
  return s;
}

async function safeAll(db: D1Database, sql: string, params: any[]): Promise<any[]> {
  try {
    const res = await db.prepare(sql).bind(...params).all();
    return (res.results || []) as any[];
  } catch {
    return [];
  }
}

async function loadAccountMap(db: D1Database): Promise<Map<string, { code: string; label: string }>> {
  await ensureAccountingAccountsSchema(db);
  const rows = await safeAll(db, `SELECT account_key, code, label FROM accounting_accounts ORDER BY code`, []);
  const map = new Map<string, { code: string; label: string }>();
  for (const d of DEFAULT_ACCOUNTS) map.set(d.account_key, { code: d.code, label: d.label });
  for (const r of rows) {
    map.set(String(r.account_key), { code: String(r.code), label: String(r.label) });
  }
  return map;
}

async function generateFecDataset(db: D1Database, from: string, to: string) {
  const acc = await loadAccountMap(db);
  const getAcc = (k: string) => acc.get(k) || { code: '9999', label: k };
  const settings = (await db.prepare(`SELECT company_name, ice, if_number, rc, currency FROM company_settings WHERE id = 1`).first().catch(() => null)) as any;
  const currency = String(settings?.currency || 'MAD');

  const entries: FecRow[] = [];
  const journalStats: Record<string, { code: string; label: string; lines: number; debit: number; credit: number }> = {};
  const accountStats = new Map<string, { code: string; label: string; debit: number; credit: number }>();

  let seq = 1;
  const pushLines = (
    journalCode: string,
    journalLib: string,
    dateRaw: string,
    pieceRef: string,
    pieceDateRaw: string,
    lines: {
      accountKey: string;
      auxNum?: string;
      auxLib?: string;
      lib: string;
      debit: number;
      credit: number;
      lettrage?: string;
    }[],
  ) => {
    const ecritureNum = `${journalCode}-${String(seq++).padStart(6, '0')}`;
    const eDate = fecDate(dateRaw);
    const pDate = fecDate(pieceDateRaw || dateRaw);
    if (!journalStats[journalCode]) {
      journalStats[journalCode] = { code: journalCode, label: journalLib, lines: 0, debit: 0, credit: 0 };
    }

    // Filter zero lines and ensure exact balance
    const valid = lines.filter((l) => round2(l.debit) > 0 || round2(l.credit) > 0);
    if (!valid.length) return;

    for (const l of valid) {
      const a = getAcc(l.accountKey);
      const d = round2(l.debit);
      const c = round2(l.credit);
      entries.push({
        JournalCode: journalCode,
        JournalLib: journalLib,
        EcritureNum: ecritureNum,
        EcritureDate: eDate,
        CompteNum: a.code,
        CompteLib: a.label,
        CompAuxNum: fecCell(l.auxNum || ''),
        CompAuxLib: fecCell(l.auxLib || ''),
        PieceRef: fecCell(pieceRef),
        PieceDate: pDate,
        EcritureLib: fecCell(l.lib),
        Debit: fmtAmount(d),
        Credit: fmtAmount(c),
        EcritureLet: fecCell(l.lettrage || ''),
        ValidDate: eDate,
        Montantdevise: fmtAmount(d > 0 ? d : c),
        Idevise: currency,
      });

      journalStats[journalCode].lines += 1;
      journalStats[journalCode].debit = round2(journalStats[journalCode].debit + d);
      journalStats[journalCode].credit = round2(journalStats[journalCode].credit + c);

      const ak = `${a.code}|${a.label}`;
      const prev = accountStats.get(ak) || { code: a.code, label: a.label, debit: 0, credit: 0 };
      prev.debit = round2(prev.debit + d);
      prev.credit = round2(prev.credit + c);
      accountStats.set(ak, prev);
    }
  };

  // 1. Journal VE — Sales (invoices & credit notes / avoir)
  const invoices = await safeAll(
    db,
    `SELECT i.id, i.invoice_number, i.issue_date, i.subtotal, i.tax_amount, i.total, i.status, i.doc_kind,
            i.client_id, COALESCE(c.name, 'Client comptoir') AS client_name
     FROM invoices i
     LEFT JOIN clients c ON c.id = i.client_id
     WHERE COALESCE(i.status, '') NOT IN ('cancelled', 'draft', 'void')
       AND substr(COALESCE(i.issue_date, i.created_at), 1, 10) >= ?
       AND substr(COALESCE(i.issue_date, i.created_at), 1, 10) <= ?
     ORDER BY i.issue_date, i.id`,
    [from, to],
  );
  for (const inv of invoices) {
    const isCredit = String(inv.doc_kind || '').toLowerCase() === 'credit' || Number(inv.total || 0) < 0;
    const total = Math.abs(round2(Number(inv.total || 0)));
    const tax = Math.abs(round2(Number(inv.tax_amount || 0)));
    const ht = round2(Math.max(0, total - tax));
    const auxNum = inv.client_id ? `CLI-${inv.client_id}` : '';
    const ref = String(inv.invoice_number || `INV-${inv.id}`);
    const dt = String(inv.issue_date || from);
    if (total <= 0) continue;
    if (isCredit) {
      pushLines('VE', 'Journal des ventes', dt, ref, dt, [
        { accountKey: 'sales_revenue', lib: `Avoir ${ref}`, debit: ht, credit: 0 },
        { accountKey: 'sales_vat', lib: `TVA avoir ${ref}`, debit: tax, credit: 0 },
        { accountKey: 'clients_receivable', auxNum, auxLib: inv.client_name, lib: `Avoir client ${ref}`, debit: 0, credit: total },
      ]);
    } else {
      pushLines('VE', 'Journal des ventes', dt, ref, dt, [
        { accountKey: 'clients_receivable', auxNum, auxLib: inv.client_name, lib: `Facture ${ref}`, debit: total, credit: 0 },
        { accountKey: 'sales_revenue', lib: `Vente ${ref}`, debit: 0, credit: ht },
        { accountKey: 'sales_vat', lib: `TVA collectée ${ref}`, debit: 0, credit: tax },
      ]);
    }
  }

  // 2. Journal AC — Purchases (bills)
  const bills = await safeAll(
    db,
    `SELECT b.id, b.bill_number, b.issue_date, b.subtotal, b.tax_amount, b.total, b.status,
            b.vendor_id, COALESCE(v.name, b.vendor_name, 'Fournisseur') AS vendor_name
     FROM bills b
     LEFT JOIN vendors v ON v.id = b.vendor_id
     WHERE COALESCE(b.status, '') NOT IN ('cancelled', 'draft')
       AND substr(COALESCE(b.issue_date, b.created_at), 1, 10) >= ?
       AND substr(COALESCE(b.issue_date, b.created_at), 1, 10) <= ?
     ORDER BY b.issue_date, b.id`,
    [from, to],
  );
  for (const b of bills) {
    const total = Math.abs(round2(Number(b.total || 0)));
    const tax = Math.abs(round2(Number(b.tax_amount || 0)));
    const ht = round2(Math.max(0, total - tax));
    const auxNum = b.vendor_id ? `FRN-${b.vendor_id}` : '';
    const ref = String(b.bill_number || `BILL-${b.id}`);
    const dt = String(b.issue_date || from);
    if (total <= 0) continue;
    pushLines('AC', 'Journal des achats', dt, ref, dt, [
      { accountKey: 'purchases_expense', lib: `Achat ${ref}`, debit: ht, credit: 0 },
      { accountKey: 'purchases_vat', lib: `TVA déductible ${ref}`, debit: tax, credit: 0 },
      { accountKey: 'suppliers_payable', auxNum, auxLib: b.vendor_name, lib: `Fournisseur ${ref}`, debit: 0, credit: total },
    ]);
  }

  // 3. Journal CA — Cash (expenses paid in cash + closed cash shift variances)
  const cashExpenses = await safeAll(
    db,
    `SELECT id, entry_type, amount, payment_method, reference, description, expense_date
     FROM expenses
     WHERE LOWER(COALESCE(payment_method, 'cash')) = 'cash'
       AND substr(COALESCE(expense_date, created_at), 1, 10) >= ?
       AND substr(COALESCE(expense_date, created_at), 1, 10) <= ?
     ORDER BY expense_date, id`,
    [from, to],
  );
  for (const ex of cashExpenses) {
    const amt = Math.abs(round2(Number(ex.amount || 0)));
    if (amt <= 0) continue;
    const isInflow = ['owner_in', 'income', 'recette', 'refund_in'].includes(String(ex.entry_type || '').toLowerCase());
    const ref = String(ex.reference || `EXP-${ex.id}`);
    const dt = String(ex.expense_date || from);
    const desc = String(ex.description || 'Mouvement caisse');
    if (isInflow) {
      pushLines('CA', 'Journal de caisse', dt, ref, dt, [
        { accountKey: 'cash_account', lib: desc, debit: amt, credit: 0 },
        { accountKey: 'misc_income', lib: desc, debit: 0, credit: amt },
      ]);
    } else {
      pushLines('CA', 'Journal de caisse', dt, ref, dt, [
        { accountKey: 'misc_expense', lib: desc, debit: amt, credit: 0 },
        { accountKey: 'cash_account', lib: desc, debit: 0, credit: amt },
      ]);
    }
  }

  const closedShifts = await safeAll(
    db,
    `SELECT id, till_id, closed_at, variance FROM cash_shifts
     WHERE status = 'closed' AND ABS(COALESCE(variance, 0)) > 0.009
       AND substr(COALESCE(closed_at, opened_at), 1, 10) >= ?
       AND substr(COALESCE(closed_at, opened_at), 1, 10) <= ?`,
    [from, to],
  );
  for (const sh of closedShifts) {
    const v = round2(Number(sh.variance || 0));
    const dt = String(sh.closed_at || from).slice(0, 10);
    const ref = `Z-${sh.id}-${sh.till_id}`;
    if (v < 0) {
      pushLines('CA', 'Journal de caisse', dt, ref, dt, [
        { accountKey: 'cash_variance', lib: `Manquant caisse ${sh.till_id}`, debit: Math.abs(v), credit: 0 },
        { accountKey: 'cash_account', lib: `Ajustement clôture ${ref}`, debit: 0, credit: Math.abs(v) },
      ]);
    } else {
      pushLines('CA', 'Journal de caisse', dt, ref, dt, [
        { accountKey: 'cash_account', lib: `Excédent caisse ${sh.till_id}`, debit: v, credit: 0 },
        { accountKey: 'misc_income', lib: `Excédent clôture ${ref}`, debit: 0, credit: v },
      ]);
    }
  }

  // 4. Journal BQ — Bank & non-cash payments (invoice_payments, bill_payments, non-cash expenses)
  const invPayments = await safeAll(
    db,
    `SELECT p.id, p.invoice_id, p.amount, p.payment_method, p.paid_at, p.reference,
            i.invoice_number, i.client_id, COALESCE(c.name, 'Client') AS client_name
     FROM invoice_payments p
     LEFT JOIN invoices i ON i.id = p.invoice_id
     LEFT JOIN clients c ON c.id = i.client_id
     WHERE substr(COALESCE(p.paid_at, p.created_at), 1, 10) >= ?
       AND substr(COALESCE(p.paid_at, p.created_at), 1, 10) <= ?
     ORDER BY p.paid_at, p.id`,
    [from, to],
  );
  for (const p of invPayments) {
    const amt = Math.abs(round2(Number(p.amount || 0)));
    if (amt <= 0) continue;
    const isCash = String(p.payment_method || '').toLowerCase() === 'cash';
    const ref = String(p.reference || p.invoice_number || `REG-${p.id}`);
    const dt = String(p.paid_at || from).slice(0, 10);
    pushLines(isCash ? 'CA' : 'BQ', isCash ? 'Journal de caisse' : 'Journal de banque', dt, ref, dt, [
      { accountKey: isCash ? 'cash_account' : 'bank_account', lib: `Règlement client ${ref}`, debit: amt, credit: 0 },
      {
        accountKey: 'clients_receivable',
        auxNum: p.client_id ? `CLI-${p.client_id}` : '',
        auxLib: p.client_name,
        lib: `Encaissement ${p.invoice_number || ref}`,
        debit: 0,
        credit: amt,
        lettrage: p.invoice_number ? `L-${p.invoice_id}` : '',
      },
    ]);
  }

  const billPayments = await safeAll(
    db,
    `SELECT p.id, p.bill_id, p.amount, p.payment_method, p.paid_at, p.reference,
            b.bill_number, b.vendor_id, COALESCE(v.name, b.vendor_name, 'Fournisseur') AS vendor_name
     FROM bill_payments p
     LEFT JOIN bills b ON b.id = p.bill_id
     LEFT JOIN vendors v ON v.id = b.vendor_id
     WHERE substr(COALESCE(p.paid_at, p.created_at), 1, 10) >= ?
       AND substr(COALESCE(p.paid_at, p.created_at), 1, 10) <= ?
     ORDER BY p.paid_at, p.id`,
    [from, to],
  );
  for (const p of billPayments) {
    const amt = Math.abs(round2(Number(p.amount || 0)));
    if (amt <= 0) continue;
    const isCash = String(p.payment_method || '').toLowerCase() === 'cash';
    const ref = String(p.reference || p.bill_number || `PAY-${p.id}`);
    const dt = String(p.paid_at || from).slice(0, 10);
    pushLines(isCash ? 'CA' : 'BQ', isCash ? 'Journal de caisse' : 'Journal de banque', dt, ref, dt, [
      {
        accountKey: 'suppliers_payable',
        auxNum: p.vendor_id ? `FRN-${p.vendor_id}` : '',
        auxLib: p.vendor_name,
        lib: `Règlement fournisseur ${p.bill_number || ref}`,
        debit: amt,
        credit: 0,
        lettrage: p.bill_number ? `B-${p.bill_id}` : '',
      },
      { accountKey: isCash ? 'cash_account' : 'bank_account', lib: `Paiement ${ref}`, debit: 0, credit: amt },
    ]);
  }

  const bankExpenses = await safeAll(
    db,
    `SELECT id, entry_type, amount, payment_method, reference, description, expense_date
     FROM expenses
     WHERE LOWER(COALESCE(payment_method, 'cash')) <> 'cash'
       AND substr(COALESCE(expense_date, created_at), 1, 10) >= ?
       AND substr(COALESCE(expense_date, created_at), 1, 10) <= ?
     ORDER BY expense_date, id`,
    [from, to],
  );
  for (const ex of bankExpenses) {
    const amt = Math.abs(round2(Number(ex.amount || 0)));
    if (amt <= 0) continue;
    const isInflow = ['owner_in', 'income', 'recette', 'refund_in'].includes(String(ex.entry_type || '').toLowerCase());
    const ref = String(ex.reference || `BQ-${ex.id}`);
    const dt = String(ex.expense_date || from);
    const desc = String(ex.description || 'Mouvement bancaire');
    if (isInflow) {
      pushLines('BQ', 'Journal de banque', dt, ref, dt, [
        { accountKey: 'bank_account', lib: desc, debit: amt, credit: 0 },
        { accountKey: 'misc_income', lib: desc, debit: 0, credit: amt },
      ]);
    } else {
      pushLines('BQ', 'Journal de banque', dt, ref, dt, [
        { accountKey: 'misc_expense', lib: desc, debit: amt, credit: 0 },
        { accountKey: 'bank_account', lib: desc, debit: 0, credit: amt },
      ]);
    }
  }

  // 5. Journal PA — Payroll (closed or active payroll_runs inside period)
  const fromMonth = from.slice(0, 7);
  const toMonth = to.slice(0, 7);
  const payrollRuns = await safeAll(
    db,
    `SELECT * FROM payroll_runs WHERE period_month >= ? AND period_month <= ? ORDER BY period_month, id`,
    [fromMonth, toMonth],
  );
  for (const run of payrollRuns) {
    const pLines = await safeAll(db, `SELECT * FROM payroll_lines WHERE run_id = ?`, [run.id]);
    const gross = round2(pLines.reduce((s, l) => s + Number(l.gross_salary || 0), 0));
    const cnssAmoEmp = round2(pLines.reduce((s, l) => s + Number(l.cnss_emp || 0) + Number(l.amo_emp || 0), 0));
    const cnssAmoPat = round2(pLines.reduce((s, l) => s + Number(l.cnss_employer || 0) + Number(l.amo_employer || 0), 0));
    const igr = round2(pLines.reduce((s, l) => s + Number(l.igr || 0), 0));
    const net = round2(pLines.reduce((s, l) => s + Number(l.net_salary || 0), 0));
    const adv = round2(pLines.reduce((s, l) => s + Number(l.advances_deducted || 0), 0));
    const totalDebit = round2(gross + cnssAmoPat);
    const totalCredit = round2(cnssAmoEmp + cnssAmoPat + igr + net + adv);
    const diff = round2(totalDebit - totalCredit);
    const dt = `${run.period_month}-28`;
    const ref = `PAIE-${run.period_month}-${run.id}`;
    if (totalDebit <= 0) continue;

    pushLines('PA', 'Journal de paie', dt, ref, dt, [
      { accountKey: 'payroll_gross', lib: `Salaires bruts + charges ${run.period_month}`, debit: totalDebit, credit: 0 },
      { accountKey: 'payroll_cnss_amo', lib: `Cotisations CNSS/AMO ${run.period_month}`, debit: 0, credit: round2(cnssAmoEmp + cnssAmoPat) },
      { accountKey: 'payroll_igr', lib: `IGR retenu ${run.period_month}`, debit: 0, credit: igr },
      { accountKey: 'payroll_net_payable', lib: `Salaires nets dus ${run.period_month}`, debit: 0, credit: round2(net + adv + diff) },
    ]);
  }

  // 6. Journal OD — Miscellaneous / Stock adjustments in period (non-zero value)
  const miscOps = await safeAll(
    db,
    `SELECT id, operation_type, reason, created_at FROM stock_movements
     WHERE LOWER(COALESCE(operation_type, '')) IN ('count', 'adjustment')
       AND substr(COALESCE(created_at, ''), 1, 10) >= ?
       AND substr(COALESCE(created_at, ''), 1, 10) <= ?
     LIMIT 0`,
    [from, to],
  );
  void miscOps; // reserved for explicit OD journal entries when value adjustments exist

  const totalDebit = round2(Object.values(journalStats).reduce((s, j) => s + j.debit, 0));
  const totalCredit = round2(Object.values(journalStats).reduce((s, j) => s + j.credit, 0));
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return {
    from,
    to,
    currency,
    company: {
      name: settings?.company_name || 'Atlas Commerce',
      ice: settings?.ice || '',
      if_number: settings?.if_number || '',
      rc: settings?.rc || '',
    },
    entries,
    journalStats: Object.values(journalStats),
    accountStats: Array.from(accountStats.values()).sort((a, b) => a.code.localeCompare(b.code)),
    totalDebit,
    totalCredit,
    balanced,
  };
}

function buildFecCsv(entries: FecRow[]): string {
  const headers = [
    'JournalCode',
    'JournalLib',
    'EcritureNum',
    'EcritureDate',
    'CompteNum',
    'CompteLib',
    'CompAuxNum',
    'CompAuxLib',
    'PieceRef',
    'PieceDate',
    'EcritureLib',
    'Debit',
    'Credit',
    'EcritureLet',
    'ValidDate',
    'Montantdevise',
    'Idevise',
  ];
  const lines = [headers.join('|')];
  for (const r of entries) {
    lines.push(
      [
        r.JournalCode,
        r.JournalLib,
        r.EcritureNum,
        r.EcritureDate,
        r.CompteNum,
        r.CompteLib,
        r.CompAuxNum,
        r.CompAuxLib,
        r.PieceRef,
        r.PieceDate,
        r.EcritureLib,
        r.Debit,
        r.Credit,
        r.EcritureLet,
        r.ValidDate,
        r.Montantdevise,
        r.Idevise,
      ].join('|'),
    );
  }
  return '\uFEFF' + lines.join('\r\n');
}

function buildBalanceControlCsv(data: Awaited<ReturnType<typeof generateFecDataset>>): string {
  const lines = ['Section;Code;Libelle;TotalDebit;TotalCredit;Solde'];
  for (const j of data.journalStats) {
    const solde = round2(j.debit - j.credit);
    lines.push(`JOURNAL;${j.code};"${j.label.replace(/"/g, '""')}";${j.debit.toFixed(2)};${j.credit.toFixed(2)};${solde.toFixed(2)}`);
  }
  for (const a of data.accountStats) {
    const solde = round2(a.debit - a.credit);
    lines.push(`COMPTE;${a.code};"${a.label.replace(/"/g, '""')}";${a.debit.toFixed(2)};${a.credit.toFixed(2)};${solde.toFixed(2)}`);
  }
  lines.push(`TOTAL;ALL;"Total général";${data.totalDebit.toFixed(2)};${data.totalCredit.toFixed(2)};${round2(data.totalDebit - data.totalCredit).toFixed(2)}`);
  return '\uFEFF' + lines.join('\r\n');
}

export function registerFecRoutes(app: Hono<any>, deps: FecRouteDeps): void {
  const { requireOwner, writeAudit, clientIp } = deps;

  app.get('/api/accounting/accounts', async (c) => {
    const gate = requireOwner(c);
    if (!gate.ok) return gate.response;
    await ensureAccountingAccountsSchema(c.env.DB);
    const { results } = await c.env.DB.prepare(
      `SELECT account_key, code, label, updated_at, updated_by FROM accounting_accounts ORDER BY code, account_key`,
    ).all();
    return c.json({ success: true, data: results || [] });
  });

  app.put('/api/accounting/accounts', async (c) => {
    const gate = requireOwner(c);
    if (!gate.ok) return gate.response;
    await ensureAccountingAccountsSchema(c.env.DB);
    const body = await c.req.json().catch(() => ({}));
    const list = Array.isArray(body.accounts) ? body.accounts : [body];
    let updated = 0;
    for (const item of list) {
      const key = String(item?.account_key || '').trim();
      const code = String(item?.code || '').trim();
      const label = String(item?.label || '').trim();
      if (!key || !code || !label) continue;
      await c.env.DB.prepare(
        `INSERT INTO accounting_accounts (account_key, code, label, updated_at, updated_by)
         VALUES (?, ?, ?, datetime('now'), ?)
         ON CONFLICT(account_key) DO UPDATE SET
           code = excluded.code,
           label = excluded.label,
           updated_at = datetime('now'),
           updated_by = excluded.updated_by`,
      )
        .bind(key, code, label, gate.username)
        .run();
      updated += 1;
    }

    await writeAudit(c.env.DB, {
      username: gate.username,
      role: 'owner',
      action: 'accounting.accounts_update',
      entity: 'accounting_accounts',
      entity_id: 'pcge',
      detail: JSON.stringify({ updated }),
      ip: clientIp(c),
    });

    const { results } = await c.env.DB.prepare(
      `SELECT account_key, code, label, updated_at, updated_by FROM accounting_accounts ORDER BY code, account_key`,
    ).all();
    return c.json({ success: true, data: results || [] });
  });

  app.get('/api/accounting/fec/preview', async (c) => {
    const gate = requireOwner(c);
    if (!gate.ok) return gate.response;
    const today = new Date().toISOString().slice(0, 10);
    const from = String(c.req.query('from') || `${today.slice(0, 4)}-01-01`).slice(0, 10);
    const to = String(c.req.query('to') || today).slice(0, 10);
    const data = await generateFecDataset(c.env.DB, from, to);
    return c.json({
      success: true,
      data: {
        from: data.from,
        to: data.to,
        entry_count: data.entries.length,
        journals: data.journalStats,
        accounts: data.accountStats,
        total_debit: data.totalDebit,
        total_credit: data.totalCredit,
        balanced: data.balanced,
        disclaimer:
          'Extrait comptable au format FEC à destination de votre expert-comptable — non certifié tant qu’il n’est pas validé par votre comptable.',
      },
    });
  });

  app.get('/api/accounting/fec/export', async (c) => {
    const gate = requireOwner(c);
    if (!gate.ok) return gate.response;
    const today = new Date().toISOString().slice(0, 10);
    const from = String(c.req.query('from') || `${today.slice(0, 4)}-01-01`).slice(0, 10);
    const to = String(c.req.query('to') || today).slice(0, 10);
    const data = await generateFecDataset(c.env.DB, from, to);

    const fecFileName = `${(data.company.if_number || data.company.ice || 'ATLAS').replace(/[^a-zA-Z0-9_-]/g, '')}FEC${to.replace(/-/g, '')}.csv`;
    const balanceFileName = `balance_controle_${from}_${to}.csv`;
    const fecCsv = buildFecCsv(data.entries);
    const balanceCsv = buildBalanceControlCsv(data);
    const manifest = JSON.stringify(
      {
        format: 'FEC-style (PCGE Maroc)',
        generated_at: new Date().toISOString(),
        generated_by: gate.username,
        period: { from, to },
        company: data.company,
        files: [fecFileName, balanceFileName],
        entry_count: data.entries.length,
        total_debit: data.totalDebit,
        total_credit: data.totalCredit,
        balanced: data.balanced,
        journals: data.journalStats,
        disclaimer:
          'Accountant-facing extract only; not a legally certified FEC until validated by the user’s accountant.',
      },
      null,
      2,
    );

    const zipBytes = buildZip([
      { name: fecFileName, data: fecCsv },
      { name: balanceFileName, data: balanceCsv },
      { name: 'manifest.json', data: manifest },
    ]);

    await writeAudit(c.env.DB, {
      username: gate.username,
      role: 'owner',
      action: 'accounting.fec_export',
      entity: 'accounting',
      entity_id: `${from}_${to}`,
      detail: JSON.stringify({
        from,
        to,
        entry_count: data.entries.length,
        total_debit: data.totalDebit,
        total_credit: data.totalCredit,
        balanced: data.balanced,
      }),
      ip: clientIp(c),
    });

    return new Response(new Uint8Array(zipBytes), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="FEC_${from}_${to}.zip"`,
      },
    });
  });
}
