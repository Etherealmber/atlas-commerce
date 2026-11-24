/**
 * Shared data model for the existing combined-report balance section.
 * Keep the legacy classifications and arithmetic unchanged; the printable
 * view and any future archive must use the same source rows and totals.
 */
import { summarizeBalanceTotals } from './financeCore';

type BalanceEntry = {
  entry_type?: string | null;
  payment_method?: string | null;
  amount?: number | string | null;
  [key: string]: unknown;
};

export function balanceIsIncome(e: BalanceEntry): boolean {
  return e.entry_type === 'income' || e.entry_type === 'owner_contrib';
}

export function summarizeBalance<T extends BalanceEntry>(rows: T[]) {
  return summarizeBalanceTotals(rows);
}

export async function readBalanceReport(db: D1Database, from: string, to: string) {
  const { results } = await db.prepare(
    `SELECT * FROM expenses WHERE expense_date >= ? AND expense_date <= ? ORDER BY expense_date ASC, id ASC`
  ).bind(from, to).all();
  return summarizeBalance((results || []) as BalanceEntry[]);
}
