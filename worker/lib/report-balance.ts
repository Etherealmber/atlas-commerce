/**
 * Shared data model for the existing combined-report balance section.
 * Keep the legacy classifications and arithmetic unchanged; the printable
 * view and any future archive must use the same source rows and totals.
 */
export type BalanceEntry = {
  entry_type?: string | null;
  payment_method?: string | null;
  amount?: number | string | null;
  [key: string]: unknown;
};

export function balanceIsIncome(e: BalanceEntry): boolean {
  return e.entry_type === 'income' || e.entry_type === 'owner_contrib';
}

export function summarizeBalance<T extends BalanceEntry>(rows: T[]) {
  const sum = (pred: (e: T) => boolean) => rows.filter(pred).reduce((s, e) => s + Number(e.amount || 0), 0);
  const cash = (e: T) => !e.payment_method || e.payment_method === 'cash';
  return {
    rows,
    cashIn: sum(e => balanceIsIncome(e) && cash(e)),
    cashOut: sum(e => !balanceIsIncome(e) && cash(e)),
    bankIn: sum(e => balanceIsIncome(e) && !cash(e)),
    bankOut: sum(e => !balanceIsIncome(e) && !cash(e)),
    ownerDraw: sum(e => e.entry_type === 'owner_draw'),
    ownerContrib: sum(e => e.entry_type === 'owner_contrib'),
    income: sum(e => e.entry_type === 'income'),
    expense: sum(e => e.entry_type === 'expense' || !e.entry_type),
  };
}

export async function readBalanceReport(db: D1Database, from: string, to: string) {
  const { results } = await db.prepare(
    `SELECT * FROM expenses WHERE expense_date >= ? AND expense_date <= ? ORDER BY expense_date ASC, id ASC`
  ).bind(from, to).all();
  return summarizeBalance((results || []) as BalanceEntry[]);
}
