export type FinanceDocument = { id: number; number: string; party: string; remaining: number; due_date?: string | null; state: string };
export type FinanceBucket = { total_outstanding: number; total_overdue: number; count: number; truncated: boolean; documents: FinanceDocument[] };
export type FinanceMonthly = {
  period: string; currency: string; opening_balance: number; closing_balance: number;
  sales_received: number; expenses: number; payroll_paid: number; supplier_paid: number;
  receivables: FinanceBucket; payables: FinanceBucket; payroll: { total_due: number; employees: number };
};
export type FinancePeriod = {
  inflows: { cash: number; bank: number; total: number };
  outflows: { cash: number; bank: number; total: number; not_recorded: number };
  owner: { contributions: { total: number }; withdrawals: { total: number } };
  expense_categories: { category: string; total: number; count: number }[];
  categories_truncated: boolean;
  statement: { balanced: boolean; consistent_with_breakdown: boolean };
};
export type FinanceRow = { id: number; source: string; type: string; label: string; ref: string; debit: number; credit: number; ts: string; running_balance: number };
export type FinanceStatement = { period: string; page: number; page_size: number; total: number; has_more: boolean; rows: FinanceRow[]; totals: { credits: number; debits: number }; reconciliation: { balanced: boolean }; status: string; as_of: string };
