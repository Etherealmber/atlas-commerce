// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PhoneBalance from '../mobile/PhoneBalance';
import { api } from '../api';

const bucket = { total_outstanding: 500, total_overdue: 100, count: 1, truncated: false, documents: [{ id: 1, number: 'FAC-1', party: 'Client', remaining: 500, state: 'unpaid' }] };
const monthly = (period = '2026-10') => ({ period, currency: 'MAD', opening_balance: 100, closing_balance: 175, sales_received: 100, expenses: 20, payroll_paid: 5, supplier_paid: 0, receivables: bucket, payables: bucket, payroll: { total_due: 0, employees: 0 } });
const detail = { inflows: { cash: 100, bank: 0, total: 100 }, outflows: { cash: 25, bank: 0, total: 25, not_recorded: 0 }, owner: { contributions: { total: 0 }, withdrawals: { total: 0 } }, expense_categories: [], categories_truncated: false, statement: { balanced: true, consistent_with_breakdown: true } };
const statement = (page = 1, period = '2026-10') => ({ period, page, page_size: 50, total: 2, has_more: page === 1, rows: [{ id: page, source: 'expense', type: 'expense', label: `Facture ${page}`, ref: `REF${page}`, credit: 0, debit: 25, ts: '2026-10-01', running_balance: 175 }], totals: { credits: 100, debits: 25 }, reconciliation: { balanced: true }, status: 'open', as_of: '2026-10-20' });
let host: HTMLDivElement; let root: Root;
const click = async (el: Element) => { await act(async () => { (el as HTMLElement).click(); }); };
const button = (text: string) => [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  vi.spyOn(api, 'getFinanceMonthly').mockImplementation(async (period) => ({ data: monthly(period) }));
  vi.spyOn(api, 'getFinancePeriod').mockResolvedValue({ data: detail });
  vi.spyOn(api, 'getFinanceStatement').mockImplementation(async (period, page = 1) => ({ data: statement(page, period) }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function render() { await act(async () => root.render(createElement(MemoryRouter, { children: createElement(PhoneBalance) }))); }

describe('mobile admin balance', () => {
  it('shows server monthly totals, loads statement pages and shows accounts and reports', async () => {
    await render();
    expect(host.textContent).toContain('175,00 MAD');
    expect(host.textContent).toContain('Facture 1');
    await click(button('Charger plus'));
    expect(api.getFinanceStatement).toHaveBeenLastCalledWith('2026-10', 2);
    expect(host.textContent).toContain('Facture 2');
    await click(button('Comptes'));
    expect(host.textContent).toContain('Client');
    expect(host.textContent).toContain('500,00 MAD');
    await click(button('Rapports'));
    expect(host.textContent).toContain('Télécharger et lire le PDF');
    expect(host.textContent).toContain('balance web complète');
  });
  it('switches months and requests matching statement and breakdown', async () => {
    await render();
    const select = document.querySelector('[aria-label="Choisir un mois"]') as unknown as { value: string; dispatchEvent: (event: Event) => boolean };
    await act(async () => { select.value = '2026-09'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(api.getFinanceMonthly).toHaveBeenLastCalledWith('2026-09');
    expect(api.getFinancePeriod).toHaveBeenLastCalledWith('2026-09');
    expect(api.getFinanceStatement).toHaveBeenLastCalledWith('2026-09');
  });
  it('ignores a late response from the previous month', async () => {
    await render();
    let finish!: (value: { data: ReturnType<typeof monthly> }) => void;
    vi.mocked(api.getFinanceMonthly).mockImplementation((period) => period === '2026-09'
      ? new Promise((resolve) => { finish = resolve; })
      : Promise.resolve({ data: monthly(period) }));
    const select = document.querySelector('[aria-label="Choisir un mois"]') as unknown as { value: string; dispatchEvent: (event: Event) => boolean };
    await act(async () => { select.value = '2026-09'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => { select.value = '2026-08'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => finish({ data: { ...monthly('2026-09'), closing_balance: 9999 } }));
    expect(api.getFinanceStatement).toHaveBeenLastCalledWith('2026-08');
    expect(host.textContent).not.toContain('9 999');
  });
  it('does not fabricate a breakdown when its endpoint fails', async () => {
    vi.mocked(api.getFinancePeriod).mockRejectedValue(new Error('unavailable'));
    await render();
    expect(host.textContent).toContain('Ventilation caisse/banque indisponible');
    expect(host.textContent).toContain('175,00 MAD');
    expect(host.textContent).not.toContain('CaisseEntrées');
  });
  it('allows retry after a failed monthly load', async () => {
    vi.mocked(api.getFinanceMonthly).mockRejectedValueOnce(new Error('offline'));
    await render();
    expect(host.textContent).toContain('Impossible de charger les données financières');
    await click(button('Réessayer'));
    expect(host.textContent).toContain('175,00 MAD');
  });
  it('posts a new expense and refreshes the monthly snapshot', async () => {
    const create = vi.spyOn(api, 'createExpense').mockResolvedValue({});
    await render(); await click(button('+ Dépense'));
    const form = document.querySelector<HTMLFormElement>('.pb-form')!;
    (form.elements.namedItem('description') as HTMLInputElement).value = 'Fournitures';
    (form.elements.namedItem('amount') as HTMLInputElement).value = '12.50';
    await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ description: 'Fournitures', amount: 12.5, entry_type: 'expense' }));
    expect(host.textContent).toContain('Écriture enregistrée');
    expect(api.getFinanceMonthly).toHaveBeenCalledTimes(2);
  });
});
