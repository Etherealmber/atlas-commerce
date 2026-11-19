import { describe, expect, it } from 'vitest';
import { balanceIsIncome, readBalanceReport, summarizeBalance } from '../lib/report-balance';

const rows = [
  { id: 1, entry_type: 'income', payment_method: 'cash', amount: 12.5 },
  { id: 2, entry_type: 'owner_contrib', payment_method: 'transfer', amount: 7 },
  { id: 3, entry_type: 'owner_draw', payment_method: null, amount: '3.5' },
  { id: 4, entry_type: 'expense', payment_method: 'card', amount: 5 },
  { id: 5, entry_type: null, payment_method: null, amount: 2 },
  { id: 6, entry_type: 'other', payment_method: 'cash', amount: 9 },
];
describe('balance report data model', () => {
  it('retains all rows and the printable section classifications', () => {
    expect(summarizeBalance(rows)).toEqual({ rows, cashIn: 12.5, cashOut: 14.5, bankIn: 7, bankOut: 5, ownerDraw: 3.5, ownerContrib: 7, income: 12.5, expense: 7 });
    expect(rows.map(balanceIsIncome)).toEqual([true, true, false, false, false, false]);
    expect(summarizeBalance([])).toMatchObject({ rows: [], cashIn: 0, cashOut: 0 });
  });
  it('uses the legacy inclusive dates and stable ordering', async () => {
    let query = ''; let args: string[] = [];
    const db = { prepare(sql: string) { query = sql; return { bind(...values: string[]) { args = values; return { all: async () => ({ results: rows }) }; } }; } } as unknown as D1Database;
    expect(await readBalanceReport(db, '2026-01-01', '2026-01-31')).toEqual(summarizeBalance(rows));
    expect(args).toEqual(['2026-01-01', '2026-01-31']);
    expect(query).toContain('expense_date >= ? AND expense_date <= ? ORDER BY expense_date ASC, id ASC');
  });
});
